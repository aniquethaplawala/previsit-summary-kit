/** Finding a cited quote inside a source. Shared by the server (validation) and the browser (highlighting). */

export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’“”"'`]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Where a quote sits in the source text (for highlighting), or null. Ignores case, quotes and extra spaces. */
export function findQuote(text: string, quote: string | null | undefined): { start: number; end: number } | null {
  if (!quote) return null;
  const q = normalizeForMatch(quote).replace(/[.;,]+$/, "");
  if (q.length < 3) return null;
  // Build a normalized copy of the text with a map back to original offsets.
  const map: number[] = [];
  let norm = "";
  let lastSpace = false;
  for (let i = 0; i < text.length; i++) {
    let ch = text[i].toLowerCase();
    if (/[‘’“”"'`]/.test(ch)) continue;
    if (/[–—]/.test(ch)) ch = "-";
    if (/\s/.test(ch)) {
      if (lastSpace || norm.length === 0) continue;
      ch = " ";
      lastSpace = true;
    } else lastSpace = false;
    norm += ch;
    map.push(i);
  }
  const at = norm.indexOf(q);
  if (at < 0) return null;
  return { start: map[at], end: map[at + q.length - 1] + 1 };
}
