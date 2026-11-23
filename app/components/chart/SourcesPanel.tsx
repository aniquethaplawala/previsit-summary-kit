"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { api, asAppError, postJson } from "@/lib/client";
import { formatDay, KIND_LABELS } from "@/lib/format";
import type { AppError, Chart, SourceDoc } from "@/lib/types";
import { Panel } from "./Panel";
import { blankSource, draftsToPayload, SourceEditor, type SourceDraft } from "./SourceEditor";
import type { OpenSource } from "./SourceDrawer";

function readStatus(s: SourceDoc): string {
  if (s.structured) return "Structured (FHIR)";
  if (s.extraction) {
    const d = s.extraction.data;
    const n = d.medications.length + d.labs.length + d.problems.length + d.allergies.length + d.open_items.length;
    return `Read by Text to JSON · ${n} facts`;
  }
  return "Not read yet";
}

export function SourcesPanel({
  chart,
  readOnly,
  onChange,
  onOpen,
  onError,
}: {
  chart: Chart;
  readOnly: boolean;
  onChange: (c: Chart) => void;
  onOpen: (o: OpenSource) => void;
  onError: (e: AppError | null) => void;
}) {
  const [adding, setAdding] = useState<SourceDraft[] | null>(null);
  const [busy, setBusy] = useState(false);
  const sources = [...chart.sources].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id, undefined, { numeric: true }));

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    onError(null);
    try {
      await fn();
    } catch (err) {
      onError(asAppError(err));
    } finally {
      setBusy(false);
    }
  }
  const remove = (s: SourceDoc) =>
    run(async () => {
      if (!window.confirm(`Remove ${s.id} ${s.title}?`)) return;
      onChange((await api<{ chart: Chart }>(`/api/charts/${chart.id}/sources/${s.id}`, { method: "DELETE" })).chart);
    });
  const save = () =>
    run(async () => {
      onChange((await postJson<{ chart: Chart }>(`/api/charts/${chart.id}/sources`, { sources: draftsToPayload(adding ?? []) })).chart);
      setAdding(null);
    });

  return (
    <Panel
      title="Sources"
      actions={
        readOnly || adding ? null : (
          <Button variant="secondary" size="sm" onClick={() => setAdding([blankSource()])}>
            <Plus aria-hidden className="h-4 w-4" strokeWidth={1.5} />
            Add documents
          </Button>
        )
      }
    >
      {adding ? (
        <div className="flex flex-col gap-4 rounded-[16px] bg-cream p-4 md:p-6">
          <SourceEditor sources={adding} onChange={setAdding} />
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={busy || adding.length === 0}>
              {busy ? "Saving..." : "Add to chart"}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setAdding(null)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      <ol className="flex flex-col gap-3">
        {sources.map((s) => (
          <li key={s.id} className="flex flex-col gap-3 rounded-[16px] border border-fog p-4 md:flex-row md:items-center">
            <span className="w-fit rounded-[4px] bg-cream px-2 py-0.5 font-mono text-[13px] font-semibold">{s.id}</span>
            <div className="flex flex-1 flex-col gap-1">
              <button type="button" onClick={() => onOpen({ sourceId: s.id, quote: null })} className="text-left text-[16px] font-medium hover:underline">
                {s.title}
              </button>
              <span className="text-[14px] text-graphite">
                {formatDay(s.date)} · {KIND_LABELS[s.kind]} · {s.text.length.toLocaleString()} characters
              </span>
            </div>
            <Badge tone="outline">{readStatus(s)}</Badge>
            {readOnly ? null : (
              <button type="button" onClick={() => remove(s)} disabled={busy} className="inline-flex items-center gap-1.5 text-[14px] text-graphite hover:text-ink" aria-label={`Remove ${s.id}`}>
                <Trash2 aria-hidden className="h-4 w-4" strokeWidth={1.5} />
              </button>
            )}
          </li>
        ))}
      </ol>
    </Panel>
  );
}
