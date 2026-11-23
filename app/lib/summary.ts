/**
 * Step 3 of the pipeline: Sully M1 writes the one-page summary.
 *
 * One non-streaming M1 call with JSON output. Every bullet must cite source ids
 * with a short exact quote. The server then:
 *   1. drops any bullet with no valid source id (reported as "dropped"),
 *   2. checks each quote really appears in the cited source (for highlighting),
 *   3. checks every app flag (conflicts, worsening labs, open referrals) is
 *      covered, and adds a plain "app" bullet for any M1 missed.
 */
import { chat, demoCall, M1_MODEL, SullyError, type ChatRequest } from "./sully";
import { itemTokens, LAB_SHORT } from "./facts";
import { findQuote, normalizeForMatch } from "./quote";
import type { ApiCall, Chart, Cite, Facts, Flag, SourceDoc, SummaryBullet, SummaryCite, SummaryResult, SummarySection, SummarySectionKey } from "./types";

export const SECTIONS: Array<{ key: SummarySectionKey; title: string; rule: string }> = [
  { key: "reason", title: "Why they're coming in", rule: "The scheduled reason, plus what the last note said to follow up on. 1 to 2 bullets." },
  { key: "problems", title: "Active problems", rule: "Active problems that matter for this visit, most relevant first, each with its current status in a few words. Up to 5." },
  { key: "changes", title: "Since the last visit", rule: "What changed since the most recent prior visit note: medication changes, new results, new diagnoses, ED visits or hospital stays, new symptoms reported." },
  { key: "medications", title: "Medications", rule: "Current medications with dose, recent starts, stops and dose changes with dates, and any disagreement between a note and the medication list." },
  { key: "labs", title: "Results to look at", rule: "Abnormal or trending results with values and dates in order, e.g. 'eGFR 58 → 52 → 45 (2025-01-14 to 2026-09-30)'. Scores like PHQ-9 or ACT count." },
  { key: "allergies", title: "Allergies", rule: "Allergies with reactions, and any disagreement between sources (for example one source says NKDA)." },
  { key: "open_loops", title: "Open loops", rule: "Referrals, tests or screenings that were ordered or due with no record of completion, and questions left open." },
  { key: "ask_today", title: "Worth asking today", rule: "3 to 5 short questions to ask or things to confirm today, each tied to something in the chart. Questions and checks only: no orders, treatments or dose suggestions." },
];

const MAX_BULLETS = 5;
const MAX_SOURCE_CHARS = 150_000;

export const SUMMARY_SYSTEM_PROMPT = `You write a one-page pre-visit chart summary for a clinician who has one minute before walking into the room.

You get the patient's chart as dated source documents, each with an id like S3, plus facts the app has already merged and a list of flags.

Rules:
- Use only what the source documents say. Never add diagnoses, assessments, interpretations of cause, recommendations, orders or new plans. Do not write "consider", "recommend", "should", "start", "increase" or similar advice. You may restate a plan that a source wrote, with its date.
- Every bullet cites at least one source: its id and a quote of 3 to 15 words copied exactly, character for character, from that source.
- When a bullet combines facts from several documents (a series of values, an allergy in one source and NKDA in another, a referral placed then re-sent), cite every one of those documents.
- Routine "return in N weeks" instructions are not open loops (today's visit is usually that return). Open loops are referrals, tests, screenings and questions with no record of completion.
- Never claim something did not happen ("no ED visits since", "no changes") unless a source says so. Missing from the chart is not the same as did not happen.
- Every flag under "Flags to cover" must appear in at least one bullet that cites the flag's sources and names its subject.
- Keep it to one page: each bullet 25 words or fewer, at most ${MAX_BULLETS} bullets per section, about 350 words in total.
- Write dates as YYYY-MM-DD. Do not write source ids in the bullet text; the app shows them from "sources".
- Clinical shorthand is fine (HTN, T2DM, BID). Do not use gendered pronouns unless the chart states the patient's sex; otherwise say "the patient" or use the name.
- If a section has nothing, return an empty bullets array. Do not write "none" bullets.

Sections, in this order:
${SECTIONS.map((s) => `- ${s.key} (${s.title}): ${s.rule}`).join("\n")}

Return JSON only, in exactly this shape:
{"sections":[{"key":"reason","bullets":[{"text":"...","sources":[{"id":"S4","quote":"exact words from S4"}]}]}]}`;

/** The user message: visit, flags, merged facts, then every source in full. */
export function summaryInput(chart: Chart, facts: Facts): string {
  const p = chart.patient;
  const visit = [
    `Patient: ${p.name}`,
    p.dob ? `Date of birth: ${p.dob}` : null,
    p.sex ? `Sex: ${p.sex}` : null,
    `Visit date: ${p.visitDate ?? "not given"}`,
    `Scheduled reason: ${p.visitReason ?? "not given"}`,
    `Clinician: ${chart.provider.name}, ${chart.provider.credentials} (${chart.provider.specialty})`,
  ]
    .filter(Boolean)
    .join("\n");
  const flags = facts.flags.length
    ? facts.flags.map((f) => `- ${f.id} [${f.type}] ${f.text} Sources: ${f.cites.map((c) => c.sourceId).join(", ")}`).join("\n")
    : "- none";
  const compact = {
    medications: facts.medications.map((m) => ({ name: m.name, status: m.status, dose: m.dose, frequency: m.frequency, events: m.events.map((e) => `${e.date} ${e.action}${e.dose ? ` ${e.dose}` : ""} (${e.sourceId})`) })),
    labs: facts.labs.map((l) => ({ name: l.name, unit: l.unit, trend: l.trend, values: l.points.map((x) => `${x.date}: ${x.value}${x.abnormal ? " (abnormal)" : ""} (${x.sourceId})`) })),
    problems: facts.problems.map((x) => ({ name: x.name, status: x.status, sources: x.cites.map((c) => c.sourceId) })),
    allergies: facts.allergies.map((a) => ({ substance: a.substance, reactions: a.reactions, sources: a.cites.map((c) => c.sourceId) })),
    no_known_allergies_in: facts.nkda.map((c) => c.sourceId),
    open_items: facts.openItems.map((o) => ({ item: o.item, kind: o.kind, status: o.status, sources: o.cites.map((c) => c.sourceId) })),
  };
  let budget = MAX_SOURCE_CHARS;
  const docs = [...chart.sources]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((s) => {
      const text = s.text.slice(0, Math.max(0, budget));
      budget -= text.length;
      return `<source id="${s.id}" date="${s.date}" kind="${s.kind}" title="${s.title.replace(/"/g, "'")}">\n${text}${text.length < s.text.length ? "\n[truncated]" : ""}\n</source>`;
    })
    .join("\n\n");
  return `## Visit\n${visit}\n\n## Flags to cover\n${flags}\n\n## Merged facts (from the app)\n${JSON.stringify(compact)}\n\n## Source documents\n${docs}`;
}

export function summaryRequest(chart: Chart, facts: Facts): ChatRequest {
  return {
    model: M1_MODEL,
    messages: [
      { role: "system", content: SUMMARY_SYSTEM_PROMPT },
      { role: "user", content: summaryInput(chart, facts) },
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
    max_completion_tokens: 3000,
    reasoning_effort: "none",
  };
}

export async function writeSummary(chart: Chart, facts: Facts): Promise<{ result: SummaryResult; call: ApiCall }> {
  const { content, call } = await chat(summaryRequest(chart, facts), "Write the pre-visit summary");
  const raw = parseJson(content);
  if (!raw) {
    throw new SullyError(
      { title: "Summary could not be read", message: "M1 did not return valid JSON. Try again; the request is in the API calls panel.", requestId: call.requestId },
      call,
    );
  }
  return { result: { ...validateSummary(raw, chart.sources, facts), requestId: call.requestId }, call };
}

// ---------- Validation ----------

function parseJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(t.slice(a, b + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

function cleanText(t: string): string {
  return t
    .replace(/\[\s*S\d+[^\]]*\]/g, "")
    .replace(/\(\s*S\d+(\s*,\s*S\d+)*\s*\)/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;])/g, "$1")
    .trim()
    .slice(0, 400);
}

export function validateSummary(raw: unknown, sources: SourceDoc[], facts: Facts): Omit<SummaryResult, "requestId"> {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const dropped: SummaryResult["dropped"] = [];
  const rawSections = Array.isArray((raw as { sections?: unknown })?.sections) ? ((raw as { sections: unknown[] }).sections as Array<Record<string, unknown>>) : [];

  const sections: SummarySection[] = SECTIONS.map(({ key, title }) => {
    const found = rawSections.find((s) => s && s.key === key);
    const bullets: SummaryBullet[] = [];
    for (const b of Array.isArray(found?.bullets) ? (found.bullets as Array<Record<string, unknown>>) : []) {
      const text = typeof b?.text === "string" ? cleanText(b.text) : "";
      if (!text) continue;
      const cites: SummaryCite[] = [];
      for (const c of Array.isArray(b.sources) ? b.sources : []) {
        const id = typeof c === "string" ? c : typeof c?.id === "string" ? c.id : "";
        const source = byId.get(id.trim().toUpperCase());
        if (!source || cites.some((x) => x.sourceId === source.id)) continue;
        const quote = typeof c?.quote === "string" ? c.quote.slice(0, 300) : null;
        cites.push({ sourceId: source.id, date: source.date, quote, found: Boolean(findQuote(source.text, quote)) });
      }
      if (!cites.length) {
        dropped.push({ section: title, text, why: "No valid source citation" });
        continue;
      }
      completeCites(text, cites, facts, byId);
      bullets.push({ text, cites, by: "m1" });
    }
    return { key, title, bullets: bullets.slice(0, MAX_BULLETS) };
  });

  // Every app flag must be covered. Add the flag's own text for any M1 missed.
  let addedByApp = 0;
  for (const f of facts.flags) {
    if (sections.some((s) => s.bullets.some((b) => covers(b, f)))) continue;
    const target = sections.find((s) => s.key === flagSection(f))!;
    target.bullets.push({
      text: f.text,
      by: "app",
      cites: f.cites.map((c) => {
        const source = byId.get(c.sourceId);
        return { sourceId: c.sourceId, date: c.date, quote: c.quote ?? null, found: Boolean(source && findQuote(source.text, c.quote)) };
      }),
    });
    addedByApp++;
  }
  return { sections, dropped, addedByApp };
}

function wordIn(text: string, word: string): boolean {
  const w = normalizeForMatch(word);
  if (w.length < 2) return false;
  return new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(text);
}

function valueIn(text: string, value: string): boolean {
  const v = normalizeForMatch(value);
  return v.length > 0 && new RegExp(`(^|[^0-9.])${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^0-9]|$)`).test(text);
}

/**
 * Adds the sources M1 left out for facts a line states: every result value in a
 * trend, every dated medication event, both sides of an allergy conflict, every
 * dated step of an open item. Each added cite is a fact the app merged from that
 * exact source, so the line stays traceable end to end.
 */
function completeCites(text: string, cites: SummaryCite[], facts: Facts, byId: Map<string, SourceDoc>): void {
  const t = normalizeForMatch(text);
  const dates = new Set(text.match(/\d{4}-\d{2}-\d{2}/g) ?? []);
  const add = (c: Cite) => {
    const source = byId.get(c.sourceId);
    if (!source || cites.some((x) => x.sourceId === c.sourceId)) return;
    cites.push({ sourceId: c.sourceId, date: source.date, quote: c.quote ?? null, found: Boolean(findQuote(source.text, c.quote)), auto: true });
  };
  const named = (words: string[]) => words.some((w) => wordIn(t, w));
  for (const l of facts.labs) {
    if (!named([...subjectWords(l.name), l.key, ...(LAB_SHORT[l.key] ?? [])])) continue;
    for (const p of l.points) if (valueIn(t, p.value) || dates.has(p.date)) add(p);
  }
  for (const m of facts.medications) {
    if (!named([m.key, ...subjectWords(m.name)])) continue;
    for (const e of m.events) if (dates.has(e.date)) add(e);
  }
  const nkdaMentioned = /\bnkda\b|no known (drug )?allerg/.test(t);
  for (const a of facts.allergies) {
    if (!named(subjectWords(a.substance))) continue;
    a.cites.forEach(add);
    if (nkdaMentioned) facts.nkda.forEach(add);
  }
  for (const o of facts.openItems) {
    if (!named(itemTokens(o.item).filter((w) => w.length >= 3))) continue;
    for (const c of o.cites) if (dates.has(c.date)) add(c);
  }
  cites.sort((a, b) => a.date.localeCompare(b.date));
}

function subjectWords(subject: string): string[] {
  return normalizeForMatch(subject)
    .split(/[^a-z0-9-]+/)
    .filter((w) => w.length >= 3 && !["referral", "repeat", "the", "and", "for", "test", "exam", "with"].includes(w));
}

/** A bullet covers a flag when it names the subject and cites at least one of the flag's sources. */
export function covers(b: SummaryBullet, f: Flag): boolean {
  const text = normalizeForMatch(b.text);
  const words = subjectWords(f.subject);
  const aliases = (f.aliases ?? []).map((a) => normalizeForMatch(a)).filter((a) => a.length >= 2);
  const named =
    (words.length === 0 && aliases.length === 0) ||
    words.some((w) => text.includes(w)) ||
    aliases.some((a) => new RegExp(`(^|[^a-z0-9])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(text));
  return named && b.cites.some((c) => f.cites.some((fc) => fc.sourceId === c.sourceId));
}

function flagSection(f: Flag): SummarySectionKey {
  if (f.type === "med_conflict" || f.type === "med_change") return "medications";
  if (f.type === "allergy_conflict") return "allergies";
  if (f.type === "open_item") return "open_loops";
  return "labs";
}

// ---------- Demo mode ----------

/** Without keys: a summary built from the merged facts by plain rules, same shape and citations. */
export function demoSummary(chart: Chart, facts: Facts): { result: SummaryResult; call: ApiCall } {
  const byId = new Map(chart.sources.map((s) => [s.id, s]));
  const cite = (c: { sourceId: string; date: string; quote?: string | null }): SummaryCite => {
    const src = byId.get(c.sourceId);
    return { sourceId: c.sourceId, date: c.date, quote: c.quote ?? null, found: Boolean(src && findQuote(src.text, c.quote)) };
  };
  const notes = chart.sources.filter((s) => s.kind === "note").sort((a, b) => a.date.localeCompare(b.date));
  const last = notes[notes.length - 1];
  const raw: Record<SummarySectionKey, SummaryBullet[]> = { reason: [], problems: [], changes: [], medications: [], labs: [], allergies: [], open_loops: [], ask_today: [] };
  const add = (k: SummarySectionKey, text: string, cites: SummaryCite[]) => cites.length && raw[k].push({ text, cites, by: "m1" });

  if (last) add("reason", `${chart.patient.visitReason ?? "Follow-up visit"}; last seen ${last.date}${last.extraction?.data.visit_reason ? ` for ${last.extraction.data.visit_reason}` : ""}.`, [cite({ sourceId: last.id, date: last.date })]);
  for (const p of facts.problems.filter((x) => x.status !== "resolved").slice(0, 5)) add("problems", p.name, [cite(p.cites[p.cites.length - 1])]);
  for (const f of facts.flags.filter((x) => x.type === "med_change")) add("changes", f.text, f.cites.map(cite));
  for (const m of facts.medications.filter((x) => x.status !== "stopped").slice(0, 5)) {
    const e = m.events[m.events.length - 1];
    add("medications", `${m.name}${m.dose ? ` ${m.dose}` : ""}${m.frequency ? ` ${m.frequency}` : ""}`, [cite(e)]);
  }
  for (const f of facts.flags.filter((x) => x.type === "med_conflict")) add("medications", f.text, f.cites.map(cite));
  for (const f of facts.flags.filter((x) => x.type === "lab_worsening" || x.type === "lab_abnormal").slice(0, 5)) add("labs", f.text, f.cites.map(cite));
  for (const a of facts.allergies) add("allergies", `${a.substance}${a.reactions.length ? ` (${a.reactions.join(", ")})` : ""}`, a.cites.map(cite));
  for (const f of facts.flags.filter((x) => x.type === "allergy_conflict")) add("allergies", f.text, f.cites.map(cite));
  for (const f of facts.flags.filter((x) => x.type === "open_item").slice(0, 5)) add("open_loops", f.text, f.cites.map(cite));
  for (const f of facts.flags.slice(0, 4)) {
    const q =
      f.type === "med_conflict" ? `Is the patient still taking ${f.subject}?`
      : f.type === "allergy_conflict" ? `Confirm the ${f.subject} allergy and reaction.`
      : f.type === "open_item" ? `Did the ${f.subject} happen?`
      : f.type === "med_change" ? `How is it going since the ${f.subject} change?`
      : `Any new symptoms since the last ${f.subject} result?`;
    add("ask_today", q, f.cites.slice(-1).map(cite));
  }

  const result: SummaryResult = {
    sections: SECTIONS.map(({ key, title }) => ({ key, title, bullets: raw[key].slice(0, MAX_BULLETS) })),
    dropped: [],
    addedByApp: 0,
  };
  const call = demoCall("Write the pre-visit summary", summaryRequest(chart, facts), { note: "Built from the merged facts by plain rules in demo mode." });
  return { result, call };
}
