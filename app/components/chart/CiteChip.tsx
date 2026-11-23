"use client";

import { formatDay } from "@/lib/format";
import type { OpenSource } from "./SourceDrawer";

/** A clickable citation: "S3 · Aug 14, 2026". Opens the source with the quote highlighted. */
export function CiteChip({ sourceId, date, quote, onOpen, missing, auto }: { sourceId: string; date: string; quote?: string | null; onOpen: (o: OpenSource) => void; missing?: boolean; auto?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => onOpen({ sourceId, quote: quote ?? null })}
      className={`inline-flex items-center gap-1 rounded-[30px] border px-2 py-0.5 align-baseline font-mono text-[11px] whitespace-nowrap hover:border-ink ${missing ? "border-dashed border-silver text-graphite" : "border-fog bg-cream text-ink"}`}
      title={`${auto ? "Added by the app: this line states a fact from this source. " : ""}${quote ? `"${quote}"` : "Open source"}`}
      aria-label={`Open source ${sourceId}, ${formatDay(date)}${quote ? `, quote: ${quote}` : ""}`}
    >
      <span className="font-semibold">{sourceId}</span>
      <span>· {formatDay(date)}</span>
    </button>
  );
}
