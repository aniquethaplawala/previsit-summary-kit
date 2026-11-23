"use client";

import { Braces, FileStack, FileText, LoaderCircle, Play, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type KeyboardEvent } from "react";
import { Badge, DemoBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { api, asAppError, postJson } from "@/lib/client";
import { chartStatus, formatDay, STATUS_LABELS } from "@/lib/format";
import type { AppError, Chart, SourceDoc } from "@/lib/types";
import { ApiCallsPanel } from "./ApiCallsPanel";
import { FactsPanel } from "./FactsPanel";
import { SourceDrawer, type OpenSource } from "./SourceDrawer";
import { SourcesPanel } from "./SourcesPanel";
import { SummaryPanel } from "./SummaryPanel";

type Tab = "summary" | "facts" | "sources";
type ChartResponse = { chart: Chart };

const TEXT_TO_JSON_PRICE = 0.05;

/** Needs Text to JSON: text sources without a cached extraction (approximate; the server decides). */
function toRead(sources: SourceDoc[]): number {
  return sources.filter((s) => !s.structured && !s.extraction).length;
}

/**
 * One chart for staff. `readOnly` (the admin, or a former provider's chart)
 * shows saved results without changing anything.
 */
export function ChartView({ initialChart, readOnly, formerProvider }: { initialChart: Chart; readOnly: boolean; formerProvider: boolean }) {
  const router = useRouter();
  const [chart, setChart] = useState(initialChart);
  const [tab, setTab] = useState<Tab>(initialChart.summary.result ? "summary" : "sources");
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<OpenSource | null>(null);

  const running = chart.summary.status === "running";
  const status = chartStatus(chart);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(async () => {
      try {
        const next = (await api<ChartResponse>(`/api/charts/${chart.id}`)).chart;
        setChart(next);
        if (next.summary.status === "done") setTab("summary");
      } catch {
        // keep the last known state
      }
    }, 2000);
    return () => clearInterval(t);
  }, [running, chart.id]);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(asAppError(err));
    } finally {
      setBusy(false);
    }
  }

  const summarize = () => act(async () => setChart((await postJson<ChartResponse>(`/api/charts/${chart.id}/summarize`, {})).chart));
  const remove = () =>
    act(async () => {
      if (!window.confirm("Delete this chart? This cannot be undone.")) return;
      await api(`/api/charts/${chart.id}`, { method: "DELETE" });
      router.push("/");
      router.refresh();
    });

  const tabs: Array<{ id: Tab; label: string; icon: typeof FileText; running?: boolean }> = [
    { id: "summary", label: "Summary", icon: FileText, running },
    { id: "facts", label: `Facts${chart.facts?.flags.length ? ` · ${chart.facts.flags.length} to check` : ""}`, icon: Braces },
    { id: "sources", label: `Sources · ${chart.sources.length}`, icon: FileStack },
  ];
  function onTabKey(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = (index + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
    setTab(tabs[next].id);
    document.getElementById(`tab-${tabs[next].id}`)?.focus();
  }

  const firstName = chart.patient.name.split(" ")[0];
  const reads = toRead(chart.sources);
  const estimate = reads * TEXT_TO_JSON_PRICE + 0.04;
  const calls = chart.calls.filter((c) => !c.demo);
  const tokens = calls.reduce((n, c) => n + (c.usage ? c.usage.promptTokens + c.usage.completionTokens : 0), 0);
  const okCalls = calls.filter((c) => c.ok);
  const spent =
    okCalls.filter((c) => c.path.includes("text-to-json")).length * TEXT_TO_JSON_PRICE +
    okCalls.reduce((n, c) => n + (c.usage ? (c.usage.promptTokens * 1.5 + c.usage.completionTokens * 4.6) / 1_000_000 : 0), 0);

  return (
    <div className="flex flex-col">
      <section className="mx-auto flex w-full max-w-[1200px] flex-col gap-5 px-6 pt-10 pb-10">
        <p className="text-[14px] text-graphite">{chart.patient.visitDate ? `Visit ${formatDay(chart.patient.visitDate)}` : "No visit date"}</p>
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <h1 className="font-serif text-[40px] leading-[1.1] tracking-[-0.03em] md:text-[48px]">
            {firstName}&apos;s pre-visit <span className="text-sky">summary</span>
          </h1>
          {readOnly ? null : (
            <div className="flex flex-wrap gap-2">
              {chart.summary.result || chart.summary.status === "error" ? (
                <Button variant="secondary" size="sm" onClick={summarize} disabled={busy || running}>
                  <RotateCcw aria-hidden className="h-4 w-4" strokeWidth={1.5} />
                  {chart.stale ? "Update summary" : "Run again"}
                </Button>
              ) : null}
              <Button variant="secondary" size="sm" onClick={remove} disabled={busy || running}>
                <Trash2 aria-hidden className="h-4 w-4" strokeWidth={1.5} />
                Delete
              </Button>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="outline">{STATUS_LABELS[status]}</Badge>
          {chart.patient.visitReason ? <Badge tone="outline">{chart.patient.visitReason}</Badge> : null}
          {chart.patient.dob ? <Badge tone="outline">DOB {formatDay(chart.patient.dob)}</Badge> : null}
          {chart.patient.sex ? <Badge tone="outline">{chart.patient.sex[0].toUpperCase() + chart.patient.sex.slice(1)}</Badge> : null}
          <Badge tone="outline">
            {chart.provider.name}, {chart.provider.credentials}
          </Badge>
          {formerProvider ? <Badge>Former provider</Badge> : null}
          {readOnly ? <Badge tone="outline">Read only</Badge> : null}
          {chart.demo ? <DemoBadge /> : null}
        </div>
      </section>

      <section className="bg-cream">
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-6 py-10">
          {running ? (
            <div role="status" className="flex items-center gap-3 rounded-[16px] border border-fog bg-paper p-6">
              <LoaderCircle aria-hidden className="h-5 w-5 animate-spin" strokeWidth={1.5} />
              <div className="flex flex-col">
                <span className="font-medium">{chart.summary.progress ?? "Working"}...</span>
                <span className="text-[14px] text-graphite">Text to JSON reads each document, then Sully M1 writes the summary. Usually under a minute.</span>
              </div>
            </div>
          ) : null}

          {!running && !chart.summary.result && chart.summary.status !== "error" && !readOnly ? (
            <div className="flex flex-col gap-4 rounded-[16px] border border-fog bg-paper p-6 md:flex-row md:items-center md:p-8">
              <div className="flex flex-1 flex-col gap-1">
                <h2 className="text-[18px] font-medium">Ready to summarize {chart.sources.length} sources</h2>
                <p className="text-[14px] text-graphite">
                  {reads} {reads === 1 ? "document goes" : "documents go"} through Text to JSON{chart.sources.length > reads ? `; ${chart.sources.length - reads} FHIR sources are already structured` : ""}. Then one M1 call writes the summary.
                  {chart.demo ? " Demo mode: nothing is sent." : ` About $${estimate.toFixed(2)} at list prices.`}
                </p>
              </div>
              <Button onClick={summarize} disabled={busy}>
                <Play aria-hidden className="h-4 w-4" strokeWidth={1.5} />
                Summarize chart
              </Button>
            </div>
          ) : null}

          {chart.stale && !running ? (
            <div className="flex items-center gap-3 rounded-[16px] border border-ink bg-paper p-5 text-[14px]">
              <TriangleAlert aria-hidden className="h-5 w-5 shrink-0" strokeWidth={1.5} />
              Sources changed after this summary was written. {readOnly ? "" : "Update the summary before you rely on it."}
            </div>
          ) : null}

          {chart.summary.status === "error" && chart.summary.error ? <ErrorNotice error={chart.summary.error} /> : null}
          {error ? <ErrorNotice error={error} /> : null}

          <div role="tablist" aria-label="Chart" className="flex flex-wrap gap-1 rounded-full border border-fog bg-paper p-1 md:w-fit">
            {tabs.map((t, i) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  id={`tab-${t.id}`}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls={`panel-${t.id}`}
                  tabIndex={active ? 0 : -1}
                  onClick={() => setTab(t.id)}
                  onKeyDown={(e) => onTabKey(e, i)}
                  className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-[14px] ${active ? "bg-ink font-medium text-paper" : "text-ink hover:bg-cream"}`}
                >
                  {t.running ? <LoaderCircle aria-label="Loading" className="h-4 w-4 animate-spin" strokeWidth={1.5} /> : <Icon aria-hidden className="h-4 w-4" strokeWidth={1.5} />}
                  {t.label}
                </button>
              );
            })}
          </div>

          <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
            {tab === "summary" ? <SummaryPanel chart={chart} onCite={setOpen} /> : null}
            {tab === "facts" ? <FactsPanel chart={chart} onCite={setOpen} /> : null}
            {tab === "sources" ? (
              <SourcesPanel chart={chart} readOnly={readOnly || running} onChange={setChart} onOpen={setOpen} onError={setError} />
            ) : null}
          </div>

          <ApiCallsPanel calls={chart.calls} />
          {calls.length ? (
            <p className="text-[14px] text-graphite">
              {calls.filter((c) => c.path.includes("text-to-json")).length} Text to JSON requests · {calls.filter((c) => c.path.includes("chat")).length} M1 calls
              {tokens ? ` · ${tokens.toLocaleString()} M1 tokens` : ""} · about ${spent.toFixed(2)} at list prices
            </p>
          ) : null}
        </div>
      </section>

      {open ? <SourceDrawer chart={chart} open={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
