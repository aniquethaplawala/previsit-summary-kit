/**
 * FHIR R4 Bundle -> dated source documents.
 *
 * FHIR resources are already structured, so they skip Text to JSON: each group
 * (problem list, medication list, allergy list, results by date) becomes one
 * source with readable text (so citations can be shown and highlighted) and a
 * ready-made `structured` extraction. Clinical notes inside DocumentReference
 * resources (text/plain attachments) become normal note sources and do go
 * through Text to JSON.
 *
 * Supported: Patient, Condition, MedicationRequest, MedicationStatement,
 * Observation, AllergyIntolerance, Encounter, DocumentReference.
 */
import { emptyExtraction } from "./extract";
import type { ExtractedLab, ExtractedMed, MedAction, SourceDoc } from "./types";

export type NewSource = Omit<SourceDoc, "id" | "extraction">;
export type FhirResult = {
  patient: { name?: string; dob?: string; sex?: string };
  sources: NewSource[];
  skipped: Record<string, number>;
};

type R = Record<string, unknown>;

const isObj = (v: unknown): v is R => typeof v === "object" && v !== null && !Array.isArray(v);
const list = (v: unknown): R[] => (Array.isArray(v) ? v.filter(isObj) : []);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const day = (v: unknown): string | undefined => str(v)?.match(/^\d{4}-\d{2}-\d{2}/)?.[0];

function concept(v: unknown): string | undefined {
  if (!isObj(v)) return undefined;
  return str(v.text) ?? str(list(v.coding)[0]?.display) ?? str(list(v.coding)[0]?.code);
}

function code(v: unknown): string | undefined {
  return isObj(v) ? str(list(v.coding)[0]?.code) : undefined;
}

function quantity(v: unknown): { value?: string; unit?: string } {
  if (!isObj(v) || (typeof v.value !== "number" && typeof v.value !== "string")) return {};
  return { value: String(v.value), unit: str(v.unit) ?? str(v.code) };
}

function latest(dates: Array<string | undefined>, fallback: string): string {
  const d = dates.filter((x): x is string => Boolean(x)).sort();
  return d[d.length - 1] ?? fallback;
}

/** Parses a FHIR Bundle (JSON text). Throws a plain-language Error when it is not one. */
export function flattenFhirBundle(json: string, today = new Date().toISOString().slice(0, 10)): FhirResult {
  let bundle: unknown;
  try {
    bundle = JSON.parse(json);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  if (!isObj(bundle) || bundle.resourceType !== "Bundle") throw new Error("Expected a FHIR R4 Bundle (resourceType \"Bundle\").");
  const resources = list(bundle.entry).map((e) => e.resource).filter(isObj);
  const exportDate = day(bundle.timestamp) ?? day(isObj(bundle.meta) ? bundle.meta.lastUpdated : undefined);
  const by = (type: string) => resources.filter((r) => r.resourceType === type);
  const skipped: Record<string, number> = {};
  const known = new Set(["Patient", "Condition", "MedicationRequest", "MedicationStatement", "Observation", "AllergyIntolerance", "Encounter", "DocumentReference"]);
  for (const r of resources) {
    const t = String(r.resourceType);
    if (!known.has(t)) skipped[t] = (skipped[t] ?? 0) + 1;
  }

  const patient: FhirResult["patient"] = {};
  const p = by("Patient")[0];
  if (p) {
    const n = list(p.name)[0];
    if (n) patient.name = str(n.text) ?? [...(Array.isArray(n.given) ? n.given : []), n.family].filter((x) => typeof x === "string").join(" ");
    patient.dob = day(p.birthDate);
    patient.sex = str(p.gender);
  }

  const sources: NewSource[] = [];

  // Problem list
  const conditions = by("Condition");
  if (conditions.length) {
    const x = emptyExtraction();
    const lines: string[] = [];
    const dates: Array<string | undefined> = [];
    for (const c of conditions) {
      const name = concept(c.code);
      if (!name) continue;
      const clinical = code(c.clinicalStatus);
      const status = clinical === "active" || clinical === "recurrence" || clinical === "relapse" ? "active" : clinical === "resolved" || clinical === "remission" ? "resolved" : clinical === "inactive" ? "historical" : null;
      const onset = day(c.onsetDateTime) ?? day(c.recordedDate);
      dates.push(day(c.recordedDate) ?? onset);
      const line = `${name}: ${clinical ?? "status not recorded"}${onset ? `, since ${onset}` : ""}`;
      lines.push(`- ${line}`);
      x.problems.push({ name, status, quote: line });
    }
    const date = exportDate ?? latest(dates, today);
    x.document_date = date;
    sources.push({ kind: "problems", title: "Problem list (FHIR)", date, text: `Problem list exported from the EHR on ${date}.\n${lines.join("\n")}`, origin: "fhir", structured: x });
  }

  // Medication list
  const meds = [...by("MedicationRequest"), ...by("MedicationStatement")];
  if (meds.length) {
    const x = emptyExtraction();
    const lines: string[] = [];
    const dates: Array<string | undefined> = [];
    for (const m of meds) {
      const name = concept(m.medicationCodeableConcept) ?? (isObj(m.medicationReference) ? str(m.medicationReference.display) : undefined);
      if (!name) continue;
      const status = str(m.status) ?? "unknown";
      const action: MedAction = ["stopped", "completed", "cancelled", "entered-in-error", "on-hold", "not-taken"].includes(status) ? "stopped" : "taking";
      const dosage = str(list(m.dosageInstruction)[0]?.text) ?? str(list(m.dosage)[0]?.text);
      const authored = day(m.authoredOn) ?? day(m.effectiveDateTime) ?? (isObj(m.effectivePeriod) ? day(m.effectivePeriod.start) : undefined);
      dates.push(authored);
      const line = `${name}${dosage ? ` ${dosage}` : ""}: status ${status}${authored ? `, prescribed ${authored}` : ""}`;
      lines.push(`- ${line}`);
      const parts = dosage?.match(/^([\d.,]+\s*(?:mg|mcg|g|units?|mL|puffs?)\b)?\s*(.*)$/i);
      const med: ExtractedMed = {
        name,
        dose: parts?.[1]?.trim() || null,
        frequency: parts?.[2]?.trim() || null,
        action,
        date: authored ?? null,
        reason: null,
        quote: line,
      };
      x.medications.push(med);
    }
    const date = exportDate ?? latest(dates, today);
    x.document_date = date;
    sources.push({ kind: "meds", title: "Medication list (FHIR)", date, text: `Medication list exported from the EHR on ${date}.\n${lines.join("\n")}`, origin: "fhir", structured: x });
  }

  // Allergies
  const allergies = by("AllergyIntolerance");
  if (allergies.length) {
    const x = emptyExtraction();
    const lines: string[] = [];
    const dates: Array<string | undefined> = [];
    for (const a of allergies) {
      if (code(a.verificationStatus) === "refuted" || code(a.verificationStatus) === "entered-in-error") continue;
      const substance = concept(a.code);
      if (!substance) continue;
      const reaction = concept(list(list(a.reaction)[0]?.manifestation)[0]);
      dates.push(day(a.recordedDate));
      if (/no known (drug )?allerg|nkda/i.test(substance)) {
        x.no_known_allergies = true;
        lines.push("- No known drug allergies");
        continue;
      }
      const line = `${substance}${reaction ? `, reaction: ${reaction}` : ""}`;
      lines.push(`- ${line}`);
      x.allergies.push({ substance, reaction: reaction ?? null, quote: line });
    }
    const date = exportDate ?? latest(dates, today);
    x.document_date = date;
    sources.push({ kind: "allergies", title: "Allergy list (FHIR)", date, text: `Allergy list exported from the EHR on ${date}.\n${lines.join("\n") || "- None recorded"}`, origin: "fhir", structured: x });
  }

  // Observations, one source per date
  const byDate = new Map<string, R[]>();
  for (const o of by("Observation")) {
    const d = day(o.effectiveDateTime) ?? (isObj(o.effectivePeriod) ? day(o.effectivePeriod.start) : undefined) ?? day(o.issued) ?? today;
    byDate.set(d, [...(byDate.get(d) ?? []), o]);
  }
  for (const [date, obs] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const x = emptyExtraction();
    x.document_date = date;
    const lines: string[] = [];
    for (const o of obs) {
      const name = concept(o.code);
      if (!name) continue;
      let { value, unit } = quantity(o.valueQuantity);
      value ??= str(o.valueString) ?? concept(o.valueCodeableConcept) ?? (typeof o.valueInteger === "number" ? String(o.valueInteger) : undefined);
      const comps = list(o.component);
      if (!value && comps.length >= 2) {
        // Blood pressure: systolic/diastolic components.
        const sys = comps.find((c) => /systolic|8480-6/i.test(JSON.stringify(c.code)));
        const dia = comps.find((c) => /diastolic|8462-4/i.test(JSON.stringify(c.code)));
        if (sys && dia) {
          value = `${quantity(sys.valueQuantity).value}/${quantity(dia.valueQuantity).value}`;
          unit = quantity(sys.valueQuantity).unit ?? "mmHg";
        }
      }
      if (!value) continue;
      const rr = list(o.referenceRange)[0];
      const range = rr ? str(rr.text) ?? [quantity(rr.low).value, quantity(rr.high).value].filter(Boolean).join("-") : undefined;
      const interp = code(list(o.interpretation)[0]);
      const abnormal = interp ? ["H", "HH", "L", "LL", "A", "AA", "HU", "LU"].includes(interp) : null;
      const line = `${name}: ${value}${unit ? ` ${unit}` : ""}${range ? ` (ref ${range})` : ""}${abnormal ? ` [${interp}]` : ""}`;
      lines.push(`- ${line}`);
      const lab: ExtractedLab = { name, value, unit: unit ?? null, reference_range: range ?? null, date, abnormal, quote: line };
      x.labs.push(lab);
    }
    if (lines.length) sources.push({ kind: "labs", title: `Results ${date} (FHIR)`, date, text: `Results from ${date}.\n${lines.join("\n")}`, origin: "fhir", structured: x });
  }

  // Encounters: one visit history source (dates and reasons only)
  const encounters = by("Encounter");
  if (encounters.length) {
    const x = emptyExtraction();
    const lines = encounters
      .map((e) => {
        const start = isObj(e.period) ? day(e.period.start) : undefined;
        const type = concept(list(e.type)[0]) ?? "Visit";
        const reason = concept(list(e.reasonCode)[0]);
        return { start, line: `${start ?? "date unknown"}: ${type}${reason ? `, reason: ${reason}` : ""}` };
      })
      .sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));
    const date = latest(lines.map((l) => l.start), today);
    x.document_date = date;
    sources.push({ kind: "other", title: "Visit history (FHIR)", date, text: `Visit history.\n${lines.map((l) => `- ${l.line}`).join("\n")}`, origin: "fhir", structured: x });
  }

  // Clinical notes: text/plain or text/markdown attachments become note sources.
  for (const d of by("DocumentReference")) {
    const att = list(d.content).map((c) => c.attachment).filter(isObj)[0];
    if (!att) continue;
    const type = str(att.contentType) ?? "";
    if (!/^text\/(plain|markdown)/.test(type) || typeof att.data !== "string") {
      skipped["DocumentReference (not plain text)"] = (skipped["DocumentReference (not plain text)"] ?? 0) + 1;
      continue;
    }
    const text = Buffer.from(att.data, "base64").toString("utf8").trim();
    if (!text) continue;
    const date = day(d.date) ?? (isObj(d.context) && isObj(d.context.period) ? day(d.context.period.start) : undefined) ?? today;
    sources.push({ kind: "note", title: str(d.description) ?? concept(d.type) ?? str(att.title) ?? "Clinical note", date, text, origin: "fhir" });
  }

  if (!sources.length) throw new Error("No supported resources found in the Bundle.");
  return { patient, sources, skipped };
}
