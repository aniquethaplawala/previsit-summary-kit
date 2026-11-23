"use client";

import { ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { CopyButton } from "@/components/ui/CopyButton";
import { formatDay } from "@/lib/format";
import type { Chart } from "@/lib/types";
import { CiteChip } from "./CiteChip";
import type { OpenSource } from "./SourceDrawer";
import { Panel } from "./Panel";

function toText(chart: Chart): string {
  const r = chart.summary.result!;
  const lines = [`Pre-visit summary: ${chart.patient.name}${chart.patient.visitDate ? `, visit ${chart.patient.visitDate}` : ""}`];
  for (const s of r.sections) {
    if (!s.bullets.length) continue;
    lines.push("", s.title);
    for (const b of s.bullets) lines.push(`- ${b.text} [${b.cites.map((c) => `${c.sourceId}, ${c.date}`).join("; ")}]`);
  }
  lines.push("", "Sources:");
  for (const src of [...chart.sources].sort((a, b) => a.date.localeCompare(b.date))) lines.push(`${src.id} ${src.date} ${src.title}`);
  return lines.join("\n");
}

export function SummaryPanel({ chart, onCite }: { chart: Chart; onCite: (o: OpenSource) => void }) {
  const r = chart.summary.result;
  if (!r) {
    return (
      <Panel title="Summary">
        <p className="text-graphite">{chart.summary.status === "running" ? "The summary is being written." : "Run the summary to see it here."}</p>
      </Panel>
    );
  }
  const bullets = r.sections.reduce((n, s) => n + s.bullets.length, 0);
  return (
    <Panel title="Pre-visit summary" actions={<CopyButton text={toText(chart)} label="Copy with citations" />}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="outline">
          <ShieldCheck aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
          {bullets} lines, every one cited
        </Badge>
        <Badge tone="outline">From the chart only · review before use</Badge>
        {chart.summary.finishedAt ? <Badge tone="outline">Written {formatDay(chart.summary.finishedAt.slice(0, 10))}</Badge> : null}
      </div>
      <div className="grid gap-x-10 gap-y-6 md:grid-cols-2">
        {r.sections.map((s) => (
          <section key={s.key} className={`flex flex-col gap-2 border-t border-fog pt-4 ${s.key === "ask_today" ? "md:col-span-2" : ""}`}>
            <h3 className="text-[14px] font-semibold tracking-[0.02em] uppercase">{s.title}</h3>
            {s.bullets.length ? (
              <ul className="flex flex-col gap-2">
                {s.bullets.map((b, i) => (
                  <li key={i} className="flex gap-2 text-[15px] leading-relaxed">
                    <span aria-hidden className="mt-[11px] h-1 w-1 shrink-0 rounded-full bg-graphite" />
                    <span>
                      {b.text}{" "}
                      {b.by === "app" ? (
                        <Badge tone="fog" className="mr-1 align-baseline">
                          Added by app check
                        </Badge>
                      ) : null}
                      <span className="inline-flex flex-wrap gap-1 align-baseline">
                        {b.cites.map((c) => (
                          <CiteChip key={c.sourceId} sourceId={c.sourceId} date={c.date} quote={c.quote} auto={c.auto} onOpen={onCite} missing={!chart.sources.some((x) => x.id === c.sourceId)} />
                        ))}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[14px] text-graphite">Nothing in the chart.</p>
            )}
          </section>
        ))}
      </div>
      {r.dropped.length ? (
        <details className="rounded-[16px] bg-cream p-4 text-[14px]">
          <summary className="cursor-pointer font-medium">
            {r.dropped.length} {r.dropped.length === 1 ? "line" : "lines"} removed because they had no valid citation
          </summary>
          <ul className="mt-3 flex flex-col gap-2">
            {r.dropped.map((d, i) => (
              <li key={i}>
                <span className="text-graphite">{d.section}:</span> {d.text}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {r.addedByApp ? (
        <p className="text-[14px] text-graphite">
          {r.addedByApp} {r.addedByApp === 1 ? "line was" : "lines were"} added by the app because M1 left out something its rules flagged (see the Facts tab).
        </p>
      ) : null}
    </Panel>
  );
}
