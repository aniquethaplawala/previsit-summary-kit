/**
 * Step 1 of the pipeline: Sully Text to JSON on each source document.
 *
 * Every text source (a visit note, a pasted lab report, a medication list) is
 * sent once to POST /v1/utils/text-to-json with EXTRACTION_SCHEMA. The result
 * is cached on the source by a hash of its text, so re-running the summary
 * only pays again for sources that changed.
 */
import { createHash } from "node:crypto";
import { textToJson } from "./sully";
import type {
  ApiCall,
  Extraction,
  ExtractedAllergy,
  ExtractedLab,
  ExtractedMed,
  ExtractedOpenItem,
  ExtractedProblem,
  MedAction,
  OpenItemKind,
  SourceDoc,
} from "./types";

const nullableString = (description: string) => ({ type: ["string", "null"], description });
const quote = nullableString(
  "Copy the exact words from the document that state this fact, 3 to 15 words, character for character. Null if you cannot copy them exactly.",
);

/** The JSON Schema sent to Text to JSON. Descriptions carry the extraction rules. */
export const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    document_date: nullableString("The date of this document or visit, as YYYY-MM-DD. Null if not stated."),
    visit_reason: nullableString("Why the patient was seen in this document, in a few words. Null for lab reports and medication lists."),
    problems: {
      type: "array",
      description: "Diagnoses and health problems the document states the patient has or had. Do not infer problems from medications or labs.",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "The problem as written, e.g. 'Type 2 diabetes mellitus'." },
          status: {
            type: ["string", "null"],
            enum: ["active", "resolved", "historical", null],
            description: "active if current, resolved if stated resolved, historical for past history. Null if unclear.",
          },
          quote,
        },
        required: ["name", "status", "quote"],
        additionalProperties: false,
      },
    },
    medications: {
      type: "array",
      description:
        "Every medication named in the document, including ones started, changed or stopped. Include over-the-counter medicines and supplements.",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Medication name without dose, e.g. 'metformin'." },
          dose: nullableString("Dose and units as written, e.g. '1000 mg'."),
          frequency: nullableString("How often, as written, e.g. 'twice daily'."),
          action: {
            type: "string",
            enum: ["taking", "started", "changed", "stopped"],
            description:
              "started = newly prescribed in this document; changed = dose or frequency changed; stopped = discontinued, held or the patient stopped taking it; taking = continued or simply listed.",
          },
          date: nullableString("Date of the start, change or stop as YYYY-MM-DD only if the full date is written, else null."),
          reason: nullableString("Why it was started, changed or stopped, if stated."),
          quote,
        },
        required: ["name", "dose", "frequency", "action", "date", "reason", "quote"],
        additionalProperties: false,
      },
    },
    labs: {
      type: "array",
      description:
        "Lab results, scores and measured values with a number: blood tests, urine tests, vital signs (blood pressure as one value like '138/86', weight, BMI), questionnaire scores (PHQ-9, GAD-7, ACT), spirometry and imaging measurements such as ejection fraction. One entry per value per date.",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Test name, e.g. 'Hemoglobin A1c', 'eGFR', 'Blood pressure', 'PHQ-9'." },
          value: { type: "string", description: "The result exactly as written, e.g. '8.4', '138/86', 'positive'." },
          unit: nullableString("Units, e.g. '%', 'mL/min/1.73m2', 'mmHg'."),
          reference_range: nullableString("Reference range if printed."),
          date: nullableString("Date of the result as YYYY-MM-DD only if the full date is written. Null if only a month or year is given (for example 'in March 2025')."),
          abnormal: {
            type: ["boolean", "null"],
            description: "True if the document marks it high, low or abnormal, or it is outside the printed range. Null if not stated.",
          },
          quote,
        },
        required: ["name", "value", "unit", "reference_range", "date", "abnormal", "quote"],
        additionalProperties: false,
      },
    },
    allergies: {
      type: "array",
      description: "Allergies or intolerances the document lists, with the reaction if stated.",
      items: {
        type: "object",
        properties: {
          substance: { type: "string", description: "e.g. 'penicillin', 'latex'." },
          reaction: nullableString("e.g. 'hives'."),
          quote,
        },
        required: ["substance", "reaction", "quote"],
        additionalProperties: false,
      },
    },
    no_known_allergies: {
      type: ["boolean", "null"],
      description: "True only if the document explicitly says no known allergies or NKDA. Null otherwise.",
    },
    open_items: {
      type: "array",
      description:
        "Things ordered, referred, recommended or asked that need a result or follow-up: referrals, tests ordered, screenings due or overdue, follow-up visits, questions to revisit. Also record items the document says were completed or resulted.",
      items: {
        type: "object",
        properties: {
          item: { type: "string", description: "What it is, e.g. 'Nephrology referral', 'Echocardiogram', 'Diabetic eye exam'." },
          kind: { type: "string", enum: ["referral", "test", "screening", "follow_up", "question", "other"] },
          status: {
            type: "string",
            enum: ["pending", "done"],
            description:
              "done only if the document says the patient was seen, the test was done or resulted, or the screening was completed. Placing, ordering, sending, re-sending or recommending a referral or test is pending.",
          },
          due: nullableString("When it is due, if stated."),
          quote,
        },
        required: ["item", "kind", "status", "due", "quote"],
        additionalProperties: false,
      },
    },
  },
  required: ["document_date", "visit_reason", "problems", "medications", "labs", "allergies", "no_known_allergies", "open_items"],
  additionalProperties: false,
} as const;

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** Cache key for a source's extraction: its input text plus the schema, so editing the schema re-extracts. */
export function extractionKey(source: SourceDoc): string {
  return hashText(`${JSON.stringify(EXTRACTION_SCHEMA)}\n${extractionInput(source)}`);
}

/** The text sent to Text to JSON: a short header so dates and kinds are clear, then the document. */
export function extractionInput(source: SourceDoc): string {
  return `Document type: ${source.kind}\nDocument title: ${source.title}\nDocument date: ${source.date}\n\n${source.text}`;
}

export async function extractSource(source: SourceDoc): Promise<{ data: Extraction; call: ApiCall }> {
  const { data, call } = await textToJson<unknown>(extractionInput(source), EXTRACTION_SCHEMA, `Extract facts · ${source.id} ${source.title}`);
  return { data: cleanExtraction(data), call };
}

// ---------- Defensive cleanup (schema checks structure, not content) ----------

const PLACEHOLDER = /^(n\/?a|none|unknown|not (stated|specified|documented|reported)|null|-+)$/i;

function s(v: unknown, max = 300): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  if (!t || PLACEHOLDER.test(t)) return null;
  return t.slice(0, max);
}

function date(v: unknown): string | null {
  const t = s(v, 40);
  if (!t) return null;
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function arr(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null) : [];
}

function oneOf<T extends string>(v: unknown, options: readonly T[], fallback: T): T {
  return options.includes(v as T) ? (v as T) : fallback;
}

export function cleanExtraction(raw: unknown): Extraction {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const problems: ExtractedProblem[] = arr(r.problems)
    .map((p) => ({
      name: s(p.name, 160) ?? "",
      status: p.status === "active" || p.status === "resolved" || p.status === "historical" ? (p.status as ExtractedProblem["status"]) : null,
      quote: s(p.quote),
    }))
    .filter((p) => p.name);
  const medications: ExtractedMed[] = arr(r.medications)
    .map((m) => ({
      name: s(m.name, 120) ?? "",
      dose: s(m.dose, 80),
      frequency: s(m.frequency, 80),
      action: oneOf<MedAction>(m.action, ["taking", "started", "changed", "stopped"], "taking"),
      date: date(m.date),
      reason: s(m.reason, 200),
      quote: s(m.quote),
    }))
    .filter((m) => m.name);
  const labs: ExtractedLab[] = arr(r.labs)
    .map((l) => ({
      name: s(l.name, 120) ?? "",
      value: s(l.value, 60) ?? "",
      unit: s(l.unit, 40),
      reference_range: s(l.reference_range, 60),
      date: date(l.date),
      abnormal: typeof l.abnormal === "boolean" ? l.abnormal : null,
      quote: s(l.quote),
    }))
    .filter((l) => l.name && l.value);
  const allergies: ExtractedAllergy[] = arr(r.allergies)
    .map((a) => ({ substance: s(a.substance, 120) ?? "", reaction: s(a.reaction, 120), quote: s(a.quote) }))
    // "NKDA" sometimes comes back as an allergy; it belongs in no_known_allergies.
    .filter((a) => a.substance && !/^(nkda|no known (drug )?allergies)$/i.test(a.substance));
  const open_items: ExtractedOpenItem[] = arr(r.open_items)
    .map((o) => ({
      item: s(o.item, 200) ?? "",
      kind: oneOf<OpenItemKind>(o.kind, ["referral", "test", "screening", "follow_up", "question", "other"], "other"),
      status: o.status === "done" && !onlyOrdered(o.quote) ? ("done" as const) : ("pending" as const),
      due: s(o.due, 80),
      quote: s(o.quote),
    }))
    .filter((o) => o.item);
  return {
    document_date: date(r.document_date),
    visit_reason: s(r.visit_reason, 200),
    problems,
    medications,
    labs,
    allergies,
    no_known_allergies: r.no_known_allergies === true ? true : null,
    open_items,
  };
}

/** "Referral placed", "re-sent", "ordered": the order exists, the thing has not happened. */
function onlyOrdered(quote: unknown): boolean {
  const q = typeof quote === "string" ? quote.toLowerCase() : "";
  return /\b(placed|ordered|re-?sent|sent|referred|refer|will|to be scheduled|to schedule|recommended)\b/.test(q) && !/\b(seen|saw|completed|done|attended|resulted|results?|normal|abnormal)\b/.test(q);
}

export function emptyExtraction(): Extraction {
  return {
    document_date: null,
    visit_reason: null,
    problems: [],
    medications: [],
    labs: [],
    allergies: [],
    no_known_allergies: null,
    open_items: [],
  };
}
