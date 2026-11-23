"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Badge } from "@/components/ui/Badge";
import { formatDay, KIND_LABELS } from "@/lib/format";
import { findQuote } from "@/lib/quote";
import type { Chart } from "@/lib/types";

export type OpenSource = { sourceId: string; quote: string | null };

/** Side panel with the full source text and the cited words highlighted. */
export function SourceDrawer({ chart, open, onClose }: { chart: Chart; open: OpenSource; onClose: () => void }) {
  const source = chart.sources.find((s) => s.id === open.sourceId);
  const markRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    markRef.current?.scrollIntoView({ block: "center" });
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const at = source ? findQuote(source.text, open.quote) : null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
      <button type="button" aria-label="Close source" className="absolute inset-0 bg-ink/20" onClick={onClose} tabIndex={-1} />
      <aside className="relative flex h-full w-full max-w-[640px] flex-col bg-paper shadow-none md:border-l md:border-fog">
        <header className="flex items-start gap-3 border-b border-fog p-6">
          <div className="flex flex-1 flex-col gap-2">
            <h2 id="drawer-title" className="text-[18px] font-medium">
              {source ? `${source.id} · ${source.title}` : `${open.sourceId} (removed)`}
            </h2>
            {source ? (
              <div className="flex flex-wrap gap-2">
                <Badge tone="outline">{formatDay(source.date)}</Badge>
                <Badge tone="outline">{KIND_LABELS[source.kind]}</Badge>
                {source.origin === "fhir" ? <Badge tone="outline">From FHIR</Badge> : null}
              </div>
            ) : null}
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className="rounded-full p-2 hover:bg-cream" aria-label="Close">
            <X aria-hidden className="h-5 w-5" strokeWidth={1.5} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-6">
          {open.quote ? (
            <p className="mb-4 text-[14px] text-graphite">
              {at ? "Highlighted: the words the summary cites." : `The cited words were not found word for word in this source: "${open.quote}"`}
            </p>
          ) : null}
          {source ? (
            <pre className="font-sans text-[15px] leading-relaxed whitespace-pre-wrap">
              {at ? (
                <>
                  {source.text.slice(0, at.start)}
                  <mark ref={markRef} className="rounded-[4px] bg-sky/60 px-0.5 text-ink">
                    {source.text.slice(at.start, at.end)}
                  </mark>
                  {source.text.slice(at.end)}
                </>
              ) : (
                source.text
              )}
            </pre>
          ) : (
            <p className="text-graphite">This source was removed from the chart after the summary was written.</p>
          )}
        </div>
      </aside>
    </div>
  );
}
