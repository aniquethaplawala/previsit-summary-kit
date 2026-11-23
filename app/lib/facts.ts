/**
 * Step 2 of the pipeline: merge the facts from every source. Plain code, no model.
 *
 * - Medications: one row per drug with a dated event history. Flags a drug that
 *   a note stopped but a medication list still shows, and changes in the latest note.
 * - Labs: one series per test, sorted by date, with a trend. Flags a test that is
 *   getting worse (direction known for common tests) and abnormal latest values.
 * - Allergies: flags sources that disagree (an allergy in one, NKDA in another,
 *   or different reactions).
 * - Open items: referrals, tests and screenings with no later record of completion.
 *
 * The flags are handed to M1 as "must mention" items, and the server checks the
 * summary covers each one (see summary.ts).
 */
import type { AllergyFact, Cite, Extraction, Facts, Flag, LabFact, MedFact, OpenItemFact, ProblemFact, SourceDoc } from "./types";

type Extracted = { source: SourceDoc; data: Extraction };

const LIST_KINDS = new Set(["meds", "problems", "allergies"]);

export function extractionOf(source: SourceDoc): Extraction | undefined {
  return source.structured ?? source.extraction?.data;
}

/**
 * `asOf` is the visit date (or today): abnormal results older than 6 months are
 * not flagged, since they are history rather than something to act on now.
 */
export function mergeFacts(sources: SourceDoc[], asOf?: string): Facts {
  const items: Extracted[] = sources
    .map((source) => ({ source, data: extractionOf(source) }))
    .filter((x): x is Extracted => Boolean(x.data))
    .sort((a, b) => a.source.date.localeCompare(b.source.date) || a.source.id.localeCompare(b.source.id, undefined, { numeric: true }));

  const flags: Flag[] = [];
  const flag = (type: Flag["type"], subject: string, text: string, cites: Cite[], aliases: string[] = []) =>
    flags.push({ id: `F${flags.length + 1}`, type, subject, aliases, text, cites: uniqueCites(cites) });
  const refDate = asOf ?? sources.map((s) => s.date).sort().pop() ?? new Date().toISOString().slice(0, 10);

  // ---------- Medications ----------
  const meds = new Map<string, MedFact>();
  for (const { source, data } of items) {
    for (const m of data.medications) {
      const key = medKey(m.name);
      if (!key) continue;
      const fact = meds.get(key) ?? { key, name: m.name, status: m.action, dose: null, frequency: null, events: [] };
      // "taking" means "taking as of this document", so it carries the document's date
      // (a FHIR list's authoredOn is when it was first prescribed, not when it was last confirmed).
      const date = m.action === "taking" ? source.date : (m.date ?? source.date);
      fact.events.push({ action: m.action, dose: m.dose, frequency: m.frequency, reason: m.reason, sourceId: source.id, date, quote: m.quote });
      meds.set(key, fact);
    }
  }
  const latestNote = [...items].reverse().find((x) => x.source.kind === "note");
  for (const fact of meds.values()) {
    fact.events.sort((a, b) => a.date.localeCompare(b.date));
    // A later note saying "since X was stopped" is not a second stop.
    fact.events = fact.events.filter((e, i, all) => !(e.action === "stopped" && all.slice(0, i).reverse().find((p) => p.action !== "taking" || p.date < e.date)?.action === "stopped"));
    const sourceKind = (id: string) => sources.find((s) => s.id === id)?.kind ?? "other";
    const lastStop = [...fact.events].reverse().find((e) => e.action === "stopped" && !LIST_KINDS.has(sourceKind(e.sourceId)));
    const restartedAfter = lastStop && fact.events.some((e) => e.date >= lastStop.date && e.action === "started" && e !== lastStop);
    const listedAfter = lastStop
      ? fact.events.filter((e) => e.date >= lastStop.date && e.action === "taking" && LIST_KINDS.has(sourceKind(e.sourceId)))
      : [];
    const last = fact.events[fact.events.length - 1];
    const withDose = [...fact.events].reverse().find((e) => e.dose);
    fact.dose = withDose?.dose ?? null;
    fact.frequency = withDose?.frequency ?? null;
    if (lastStop && !restartedAfter && listedAfter.length) {
      fact.status = "stopped";
      const list = listedAfter[listedAfter.length - 1];
      flag(
        "med_conflict",
        fact.name,
        `${fact.name} was stopped on ${lastStop.date}${lastStop.reason ? ` (${lastStop.reason})` : ""} but is still listed as active on the medication list dated ${list.date}.`,
        [lastStop, list],
      );
    } else {
      fact.status = last?.action ?? "taking";
      // A dose change in a note that a later list does not reflect.
      const lastChange = [...fact.events].reverse().find((e) => (e.action === "changed" || e.action === "started") && !LIST_KINDS.has(sourceKind(e.sourceId)));
      const laterList = lastChange
        ? [...fact.events].reverse().find((e) => e.date > lastChange.date && e.action === "taking" && LIST_KINDS.has(sourceKind(e.sourceId)))
        : undefined;
      if (lastChange && laterList && !sameRegimen(lastChange, laterList)) {
        flag(
          "med_conflict",
          fact.name,
          `${fact.name} was changed to ${regimen(lastChange)} on ${lastChange.date}, but the medication list dated ${laterList.date} says ${regimen(laterList)}.`,
          [lastChange, laterList],
        );
      }
    }
    if (latestNote) {
      const changes = fact.events.filter((e) => e.sourceId === latestNote.source.id && e.action !== "taking" && e.date >= latestNote.source.date);
      for (const c of changes) {
        flag("med_change", fact.name, `${fact.name} ${c.action}${c.dose ? ` (${c.dose}${c.frequency ? ` ${c.frequency}` : ""})` : ""} at the last visit on ${latestNote.source.date}${c.reason ? `: ${c.reason}` : ""}.`, [c]);
      }
    }
  }

  // ---------- Labs ----------
  const labs = new Map<string, LabFact>();
  for (const { source, data } of items) {
    for (const l of data.labs) {
      const key = labKey(l.name);
      if (!key) continue;
      const fact = labs.get(key) ?? { key, name: l.name, unit: l.unit, reference_range: l.reference_range, points: [], trend: "single" as const, abnormal: false };
      const date = l.date ?? source.date;
      // The same value on the same date from two sources is one result. A note that
      // re-mentions an earlier result ("reviewed: glucose 152") is not a new result either.
      const remention =
        (!l.date && source.kind === "note" && fact.points.some((p) => p.value === l.value && daysBetween(p.date, date) <= 90)) ||
        fact.points.some((p) => p.value === l.value && daysBetween(p.date, date) <= 31);
      if (!remention) {
        fact.points.push({ value: l.value, num: toNumber(l.value), abnormal: l.abnormal, sourceId: source.id, date, quote: l.quote });
      }
      fact.unit ??= l.unit;
      fact.reference_range ??= l.reference_range;
      labs.set(key, fact);
    }
  }
  for (const fact of labs.values()) {
    fact.points.sort((a, b) => a.date.localeCompare(b.date));
    const latest = fact.points[fact.points.length - 1];
    fact.abnormal = latest?.abnormal === true;
    fact.trend = trendOf(fact);
    const series = fact.points.map((p) => p.value).join(" → ");
    const aliases = [fact.key, ...(LAB_SHORT[fact.key] ?? [])];
    if (fact.trend === "worsening") {
      flag("lab_worsening", fact.name, `${fact.name} is getting worse: ${series}${fact.unit ? ` ${fact.unit}` : ""} (${fact.points[0].date} to ${latest.date}).`, fact.points, aliases);
    } else if (fact.abnormal && daysBetween(latest.date, refDate) <= 183) {
      flag("lab_abnormal", fact.name, `${fact.name} ${latest.value}${fact.unit ? ` ${fact.unit}` : ""} on ${latest.date} is marked abnormal.`, [latest], aliases);
    }
  }

  // ---------- Allergies ----------
  const allergies = new Map<string, AllergyFact>();
  const nkda: Cite[] = [];
  for (const { source, data } of items) {
    if (data.no_known_allergies) nkda.push({ sourceId: source.id, date: source.date, quote: null });
    for (const a of data.allergies) {
      const key = a.substance.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const fact = allergies.get(key) ?? { key, substance: a.substance, reactions: [], cites: [] };
      if (a.reaction && !fact.reactions.some((r) => r.toLowerCase() === a.reaction!.toLowerCase())) fact.reactions.push(a.reaction);
      fact.cites.push({ sourceId: source.id, date: source.date, quote: a.quote });
      allergies.set(key, fact);
    }
  }
  for (const fact of allergies.values()) {
    if (nkda.length) {
      flag("allergy_conflict", fact.substance, `${fact.substance} allergy${fact.reactions.length ? ` (${fact.reactions.join(", ")})` : ""} is recorded, but other sources say no known drug allergies.`, [...fact.cites, ...nkda]);
    } else if (fact.reactions.length > 1) {
      flag("allergy_conflict", fact.substance, `${fact.substance} allergy has different reactions across sources: ${fact.reactions.join(" vs ")}.`, fact.cites);
    }
  }
  // An allergy that appears in some sources but is missing from a later allergy list.
  const allergyLists = items.filter((x) => x.source.kind === "allergies" || x.source.kind === "meds");
  for (const fact of allergies.values()) {
    for (const l of allergyLists) {
      const listed = l.data.allergies.some((a) => a.substance.toLowerCase().includes(fact.key.split(" ")[0]));
      if (!listed && l.data.allergies.length && fact.cites.every((c) => c.sourceId !== l.source.id) && !nkda.length) {
        flag("allergy_conflict", fact.substance, `${fact.substance} allergy is missing from the allergy list dated ${l.source.date}.`, [...fact.cites, { sourceId: l.source.id, date: l.source.date, quote: null }]);
        break;
      }
    }
  }

  // ---------- Problems ----------
  const problems = new Map<string, ProblemFact>();
  for (const { source, data } of items) {
    for (const p of data.problems) {
      const key = p.name.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();
      const fact = problems.get(key) ?? { key, name: p.name, status: p.status, cites: [] };
      fact.status = p.status ?? fact.status; // latest source wins
      fact.cites.push({ sourceId: source.id, date: source.date, quote: p.quote });
      problems.set(key, fact);
    }
  }

  // ---------- Open items ----------
  const openItems: OpenItemFact[] = [];
  for (const { source, data } of items) {
    for (const o of data.open_items) {
      const tokens = itemTokens(o.item);
      const match = openItems.find((f) => similar(tokens, itemTokens(f.item)));
      const cite = { sourceId: source.id, date: source.date, quote: o.quote };
      if (match) {
        if (!match.cites.some((c) => c.sourceId === cite.sourceId)) match.cites.push(cite);
        // Later sources win: a later "done" closes it, a later "pending" re-opens it.
        match.status = o.status;
        match.due = o.due ?? match.due;
      } else {
        openItems.push({ key: tokens.join(" "), item: o.item, kind: o.kind, status: o.status, due: o.due, cites: [cite] });
      }
    }
  }
  // A test is closed by a later result for it (or, for a generic "labs" order, by any later results).
  for (const o of openItems) {
    if (o.status !== "pending" || o.kind !== "test") continue;
    const last = o.cites[o.cites.length - 1].date;
    const tokens = itemTokens(o.item);
    const generic = tokens.every((t) => GENERIC_LAB_WORDS.has(t));
    const later = items.filter((x) => x.source.date > last && x.data.labs.length);
    if (later.some((x) => generic || x.data.labs.some((l) => similar(tokens, itemTokens(l.name)) || tokens.includes(labKey(l.name))))) o.status = "done";
  }
  for (const o of openItems) {
    if (o.status === "pending" && (o.kind === "referral" || o.kind === "test" || o.kind === "screening")) {
      const first = o.cites[0];
      flag("open_item", o.item, `${o.item}: first noted ${first.date}, no record that it was completed.`, o.cites, itemTokens(o.item));
    }
  }

  return {
    problems: [...problems.values()],
    medications: [...meds.values()].sort((a, b) => a.name.localeCompare(b.name)),
    labs: [...labs.values()].sort((a, b) => a.name.localeCompare(b.name)),
    allergies: [...allergies.values()],
    nkda,
    openItems,
    flags,
  };
}

// ---------- Helpers ----------

function uniqueCites(cites: Cite[]): Cite[] {
  const seen = new Set<string>();
  return cites
    .map((c) => ({ sourceId: c.sourceId, date: c.date, quote: c.quote ?? null }))
    .filter((c) => (seen.has(c.sourceId) ? false : (seen.add(c.sourceId), true)));
}

type Regimen = { dose: string | null; frequency: string | null };

function regimen(e: Regimen): string {
  return [e.dose, e.frequency].filter(Boolean).join(" ") || "no dose stated";
}

function normDose(d: string | null): string {
  return (d ?? "").toLowerCase().replace(/\s+/g, "").replace(/tablets?|tabs?/g, "");
}

function timesPerDay(f: string | null): number | null {
  const t = (f ?? "").toLowerCase();
  if (!t) return null;
  if (/\b(bid|twice|2 times|two times|every 12)/.test(t)) return 2;
  if (/\b(tid|three times|3 times|every 8)/.test(t)) return 3;
  if (/\b(qid|four times|4 times|every 6)/.test(t)) return 4;
  if (/\b(daily|once|qd|every day|nightly|at bedtime|qhs|each morning|in the morning)\b/.test(t)) return 1;
  return null;
}

/** Same dose and same times per day, when both sides say. Missing details never count as a conflict. */
function sameRegimen(a: Regimen, b: Regimen): boolean {
  const da = normDose(a.dose);
  const db = normDose(b.dose);
  if (da && db && da !== db) return false;
  const fa = timesPerDay(a.frequency ?? a.dose);
  const fb = timesPerDay(b.frequency ?? b.dose);
  return fa === null || fb === null || fa === fb;
}

const SALT = /\b(hydrochloride|hcl|sodium|potassium|calcium|succinate|tartrate|besylate|maleate|er|xl|xr|sr|cr|dr|extended[- ]release|tablets?|capsules?|oral|inhaler|hfa|mdi)\b/g;

/** "Metformin ER 500 mg" -> "metformin"; "insulin glargine" stays two words. */
export function medKey(name: string): string {
  const clean = name
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[\d.,]+\s*(mg|mcg|g|units?|ml|%)?/g, " ")
    .replace(SALT, " ")
    .replace(/[^a-z\s-]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!clean.length) return "";
  return clean[0] === "insulin" || clean[0] === "vitamin" ? clean.slice(0, 2).join(" ") : clean[0];
}

const LAB_ALIASES: Array<[RegExp, string]> = [
  [/\b(hb)?a1c\b|hemoglobin a1c|glycated/i, "a1c"],
  [/\begfr\b|glomerular/i, "egfr"],
  [/creatinine(?!.*ratio)/i, "creatinine"],
  [/albumin.*creatinine|\buacr\b|\bacr\b|microalbumin/i, "uacr"],
  [/nt-?pro ?bnp/i, "ntprobnp"],
  [/\bbnp\b|natriuretic/i, "bnp"],
  [/\bldl\b/i, "ldl"],
  [/potassium|\bk\+?\b/i, "potassium"],
  [/blood pressure|^bp\b/i, "bp"],
  [/\bweight\b/i, "weight"],
  [/phq-?9/i, "phq9"],
  [/gad-?7/i, "gad7"],
  [/asthma control test|^act\b/i, "act"],
  [/fev1/i, "fev1"],
  [/ejection fraction|\blvef\b|^ef\b/i, "ef"],
  [/peak (expiratory )?flow|\bpef\b/i, "pef"],
  [/glucose tolerance|\bgtt\b|glucose challenge/i, "gtt"],
  [/hemoglobin(?! a1c)|^hgb\b|^hb\b/i, "hgb"],
  [/\btsh\b/i, "tsh"],
];

export function labKey(name: string): string {
  for (const [re, key] of LAB_ALIASES) if (re.test(name)) return key;
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Short names a summary may use for a test. */
export const LAB_SHORT: Record<string, string[]> = {
  a1c: ["a1c"], egfr: ["egfr"], uacr: ["uacr", "albumin"], ntprobnp: ["bnp", "nt-probnp"], bnp: ["bnp"], bp: ["bp", "blood pressure"],
  phq9: ["phq"], gad7: ["gad"], act: ["act", "asthma control"], fev1: ["fev1"], ef: ["ef", "ejection"], pef: ["peak flow"],
  gtt: ["glucose", "gtt", "gct"], hgb: ["hemoglobin", "hgb", "hb"], weight: ["weight", "kg"],
};

/** Which way is worse, for common tests. Unknown tests only get rising/falling. */
const HIGHER_IS_WORSE = new Set(["a1c", "creatinine", "uacr", "ntprobnp", "bnp", "ldl", "bp", "phq9", "gad7", "gtt", "tsh"]);
const LOWER_IS_WORSE = new Set(["egfr", "act", "fev1", "ef", "pef", "hgb"]);

function toNumber(value: string): number | null {
  const m = value.replace(/,/g, "").match(/-?\d+(\.\d+)?/); // "138/86" -> systolic 138
  return m ? Number(m[0]) : null;
}

function trendOf(fact: LabFact): LabFact["trend"] {
  const nums = fact.points.filter((p) => p.num !== null).map((p) => p.num as number);
  if (nums.length < 2) return "single";
  const first = nums[0];
  const last = nums[nums.length - 1];
  const prev = nums[nums.length - 2];
  const change = (last - first) / (Math.abs(first) || 1);
  if (Math.abs(change) < 0.1) return "stable";
  const direction = change > 0 ? "rising" : "falling";
  // The last step must not reverse the overall direction.
  if ((direction === "rising" && last < prev) || (direction === "falling" && last > prev)) return direction;
  if (HIGHER_IS_WORSE.has(fact.key)) return direction === "rising" ? "worsening" : "improving";
  if (LOWER_IS_WORSE.has(fact.key)) return direction === "falling" ? "worsening" : "improving";
  return direction;
}

const ITEM_STOPWORDS = new Set([
  "referral", "refer", "referred", "to", "for", "the", "a", "an", "of", "and", "with", "consult", "consultation", "order", "ordered",
  "evaluation", "eval", "appointment", "visit", "repeat", "follow", "up", "followup", "schedule", "scheduled", "test", "testing", "in", "at", "on", "pending",
  "clinic", "pediatric", "peds", "specialist", "outpatient", "sent", "re-sent", "resent", "placed", "new", "outside", "local",
]);

/** Different words for the same follow-up, so "diabetic eye exam" and "ophthalmology referral" merge. */
const ITEM_SYNONYMS: Record<string, string> = {
  ophthalmology: "eye", optometry: "eye", retinal: "eye", retinopathy: "eye", eyes: "eye",
  rehabilitation: "rehab", echocardiogram: "echo", echocardiography: "echo",
  cbt: "therapy", counseling: "therapy", psychotherapy: "therapy", behavioral: "therapy", therapist: "therapy",
  allergist: "allergy", allergies: "allergy", sonogram: "ultrasound", us: "ultrasound",
};
const GENERIC_LAB_WORDS = new Set(["labs", "lab", "bloodwork", "blood", "work", "recheck", "check", "bmp", "cmp", "panel", "draw"]);

export function itemTokens(item: string): string[] {
  return [
    ...new Set(
      item
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/\s+/)
        .filter((t) => t && !ITEM_STOPWORDS.has(t))
        .map((t) => t.replace(/(ology|ologist|ological)$/, "ology"))
        .map((t) => ITEM_SYNONYMS[t] ?? t),
    ),
  ];
}

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000;
}

function similar(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return false;
  const shared = a.filter((t) => b.includes(t)).length;
  return shared / Math.min(a.length, b.length) >= 0.6;
}
