/**
 * Validates sources sent by the browser and turns FHIR Bundles into sources.
 * Each source gets a stable id (S1, S2, ...) that the summary cites.
 */
import { MAX_SOURCE_CHARS, MAX_SOURCES } from "./config";
import { flattenFhirBundle, type NewSource } from "./fhir";
import type { Chart, SourceDoc, SourceKind } from "./types";

const KINDS: SourceKind[] = ["note", "labs", "meds", "problems", "allergies", "other"];

export type SourceInput = { kind?: unknown; title?: unknown; date?: unknown; text?: unknown; origin?: unknown };
export type ParsedSources = { sources: NewSource[]; patient: { name?: string; dob?: string; sex?: string }; notes: string[] };

function validDay(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

/**
 * One input is either a text document {kind, title, date, text} or a FHIR
 * Bundle {kind: "fhir", text: "<bundle JSON>"}. Returns an error message on bad input.
 */
export function parseSources(inputs: unknown): ParsedSources | { error: string } {
  if (!Array.isArray(inputs) || inputs.length === 0) return { error: "Add at least one source document." };
  const out: ParsedSources = { sources: [], patient: {}, notes: [] };
  for (const [i, raw] of inputs.entries()) {
    const input = (raw ?? {}) as SourceInput;
    const n = i + 1;
    const text = String(input.text ?? "").replace(/\r\n/g, "\n").trim();
    if (!text) return { error: `Source ${n} is empty.` };
    if (input.kind === "fhir") {
      if (text.length > 5_000_000) return { error: `Source ${n}: the FHIR Bundle is larger than 5 MB.` };
      try {
        const fhir = flattenFhirBundle(text);
        out.sources.push(...fhir.sources.map((s) => ({ ...s, origin: input.origin === "sample" ? ("sample" as const) : s.origin })));
        out.patient = { ...fhir.patient, ...out.patient };
        const skipped = Object.entries(fhir.skipped);
        if (skipped.length) out.notes.push(`FHIR: skipped ${skipped.map(([t, c]) => `${c} ${t}`).join(", ")}.`);
      } catch (err) {
        return { error: `Source ${n}: ${err instanceof Error ? err.message : String(err)}` };
      }
      continue;
    }
    const kind = String(input.kind ?? "") as SourceKind;
    if (!KINDS.includes(kind)) return { error: `Source ${n}: pick a document type.` };
    const date = validDay(input.date);
    if (!date) return { error: `Source ${n}: enter the document date as YYYY-MM-DD.` };
    const title = String(input.title ?? "").trim().slice(0, 120);
    if (!title) return { error: `Source ${n}: add a title, for example "Follow-up visit".` };
    if (text.length > MAX_SOURCE_CHARS) return { error: `Source ${n} is longer than ${MAX_SOURCE_CHARS.toLocaleString()} characters. Split it into smaller documents.` };
    const origin = input.origin === "upload" || input.origin === "sample" ? input.origin : "pasted";
    out.sources.push({ kind, title, date, text, origin });
  }
  for (const s of out.sources) {
    if (s.text.length > MAX_SOURCE_CHARS) s.text = s.text.slice(0, MAX_SOURCE_CHARS);
  }
  return out;
}

/** Adds new sources to a chart with the next ids. Returns an error if the chart would be too big. */
export function addSources(chart: Pick<Chart, "sources" | "nextSourceNumber">, sources: NewSource[]): { sources: SourceDoc[]; next: number } | { error: string } {
  if (chart.sources.length + sources.length > MAX_SOURCES) return { error: `A chart can have at most ${MAX_SOURCES} sources.` };
  let next = chart.nextSourceNumber;
  const added = [...sources]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((s) => ({ ...s, id: `S${next++}` }));
  return { sources: [...chart.sources, ...added], next };
}
