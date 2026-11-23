"use client";

import { TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { CopyButton, DownloadButton } from "@/components/ui/CopyButton";
import { JsonTree } from "@/components/ui/JsonTree";
import type { Chart, Flag, LabFact } from "@/lib/types";
import { CiteChip } from "./CiteChip";
import { Panel } from "./Panel";
import type { OpenSource } from "./SourceDrawer";

const FLAG_LABELS: Record<Flag["type"], string> = {
  med_conflict: "Medication conflict",
  med_change: "Medication change",
  allergy_conflict: "Allergy conflict",
  lab_worsening: "Getting worse",
  lab_abnormal: "Abnormal result",
  open_item: "Open loop",
};

const TREND_LABELS: Record<LabFact["trend"], string> = {
  worsening: "Worsening",
  improving: "Improving",
  rising: "Rising",
  falling: "Falling",
  stable: "Stable",
  single: "One result",
};

function Th({ children }: { children: React.ReactNode }) {
  return <th className="border-b border-fog py-2 pr-4 text-left text-[12px] font-medium tracking-[0.02em] text-graphite uppercase">{children}</th>;
}

/** Everything the app merged from the sources, plus the rule-based flags. */
export function FactsPanel({ chart, onCite }: { chart: Chart; onCite: (o: OpenSource) => void }) {
  const f = chart.facts;
  if (!f) {
    return (
      <Panel title="Facts">
        <p className="text-graphite">Facts appear after the documents are read.</p>
      </Panel>
    );
  }
  const json = JSON.stringify(f, null, 2);
  return (
    <div className="flex flex-col gap-6">
      {f.flags.length ? (
        <div className="flex flex-col gap-3 rounded-[16px] border border-ink bg-paper p-6">
          <div className="flex items-center gap-2">
            <TriangleAlert aria-hidden className="h-5 w-5" strokeWidth={1.5} />
            <h2 className="text-[18px] font-medium">Worth a look ({f.flags.length})</h2>
          </div>
          <p className="text-[14px] text-graphite">Found by plain rules across the sources, not by the model. The summary must mention each one.</p>
          <ul className="flex flex-col gap-3">
            {f.flags.map((x) => (
              <li key={x.id} className="flex flex-col gap-1.5 text-[14px] md:flex-row md:items-start md:gap-3">
                <Badge tone={x.type === "med_conflict" || x.type === "allergy_conflict" || x.type === "lab_worsening" ? "sky" : "fog"} className="w-fit">
                  {FLAG_LABELS[x.type]}
                </Badge>
                <span className="flex-1">{x.text}</span>
                <span className="flex flex-wrap gap-1">
                  {x.cites.map((c) => (
                    <CiteChip key={c.sourceId} {...c} onOpen={onCite} />
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Panel title="Medications">
        {f.medications.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead>
                <tr>
                  <Th>Medication</Th>
                  <Th>Latest</Th>
                  <Th>Dose</Th>
                  <Th>History</Th>
                </tr>
              </thead>
              <tbody>
                {f.medications.map((m) => (
                  <tr key={m.key} className="border-b border-fog align-top">
                    <td className="py-3 pr-4 font-medium">{m.name}</td>
                    <td className="py-3 pr-4">
                      <Badge tone={m.status === "stopped" ? "fog" : "outline"}>{m.status === "taking" ? "Taking" : m.status[0].toUpperCase() + m.status.slice(1)}</Badge>
                    </td>
                    <td className="py-3 pr-4">{[m.dose, m.frequency].filter(Boolean).join(" ") || <span className="text-graphite">Not stated</span>}</td>
                    <td className="py-3">
                      <ol className="flex flex-col gap-1">
                        {m.events.map((e, i) => (
                          <li key={i} className="flex flex-wrap items-center gap-2">
                            <span className="w-[88px] font-mono text-[12px] text-graphite">{e.date}</span>
                            <span>
                              {e.action}
                              {e.dose ? ` ${e.dose}` : ""}
                              {e.reason ? <span className="text-graphite"> · {e.reason}</span> : null}
                            </span>
                            <CiteChip sourceId={e.sourceId} date={e.date} quote={e.quote} onOpen={onCite} />
                          </li>
                        ))}
                      </ol>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-graphite">No medications found.</p>
        )}
      </Panel>

      <Panel title="Results">
        {f.labs.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead>
                <tr>
                  <Th>Test</Th>
                  <Th>Values, oldest first</Th>
                  <Th>Trend</Th>
                  <Th>Range</Th>
                </tr>
              </thead>
              <tbody>
                {f.labs.map((l) => (
                  <tr key={l.key} className="border-b border-fog align-top">
                    <td className="py-3 pr-4 font-medium">{l.name}</td>
                    <td className="py-3 pr-4">
                      <ol className="flex flex-wrap gap-x-3 gap-y-1">
                        {l.points.map((p, i) => (
                          <li key={i}>
                            <button type="button" onClick={() => onCite({ sourceId: p.sourceId, quote: p.quote ?? null })} className="text-left hover:underline" title={`${p.sourceId}, ${p.date}`}>
                              <span className={p.abnormal ? "font-semibold" : ""}>{p.value}</span>
                              <span className="ml-1 font-mono text-[11px] text-graphite">{p.date.slice(0, 7)}</span>
                            </button>
                          </li>
                        ))}
                        {l.unit ? <li className="text-graphite">{l.unit}</li> : null}
                      </ol>
                    </td>
                    <td className="py-3 pr-4">
                      <Badge tone={l.trend === "worsening" ? "sky" : "outline"}>{TREND_LABELS[l.trend]}</Badge>
                    </td>
                    <td className="py-3 text-graphite">{l.reference_range ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-[12px] text-graphite">Bold = marked abnormal in the source. &quot;Worsening&quot; is only used for tests where the app knows which direction is worse.</p>
          </div>
        ) : (
          <p className="text-graphite">No results found.</p>
        )}
      </Panel>

      <div className="grid gap-6 md:grid-cols-2">
        <Panel title="Problems">
          <ul className="flex flex-col gap-2 text-[14px]">
            {f.problems.map((p) => (
              <li key={p.key} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{p.name}</span>
                {p.status ? <Badge tone="outline">{p.status}</Badge> : null}
                <CiteChip {...p.cites[p.cites.length - 1]} onOpen={onCite} />
              </li>
            ))}
            {f.problems.length ? null : <li className="text-graphite">No problems found.</li>}
          </ul>
        </Panel>
        <Panel title="Allergies">
          <ul className="flex flex-col gap-2 text-[14px]">
            {f.allergies.map((a) => (
              <li key={a.key} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{a.substance}</span>
                {a.reactions.length ? <span className="text-graphite">{a.reactions.join(", ")}</span> : null}
                {a.cites.map((c) => (
                  <CiteChip key={c.sourceId} {...c} onOpen={onCite} />
                ))}
              </li>
            ))}
            {f.nkda.length ? (
              <li className="flex flex-wrap items-center gap-2">
                <span className="font-medium">No known drug allergies</span>
                {f.nkda.map((c) => (
                  <CiteChip key={c.sourceId} {...c} onOpen={onCite} />
                ))}
              </li>
            ) : null}
            {f.allergies.length || f.nkda.length ? null : <li className="text-graphite">No allergy information found.</li>}
          </ul>
        </Panel>
      </div>

      <Panel title="Open items">
        <ul className="flex flex-col gap-2 text-[14px]">
          {f.openItems.map((o) => (
            <li key={o.key} className="flex flex-wrap items-center gap-2">
              <Badge tone={o.status === "pending" ? "outline" : "fog"}>{o.status === "pending" ? "Open" : "Done"}</Badge>
              <span className="font-medium">{o.item}</span>
              <span className="text-graphite">{o.kind.replace("_", " ")}</span>
              {o.cites.map((c) => (
                <CiteChip key={c.sourceId} {...c} onOpen={onCite} />
              ))}
            </li>
          ))}
          {f.openItems.length ? null : <li className="text-graphite">No open items found.</li>}
        </ul>
      </Panel>

      <Panel
        title="JSON"
        actions={
          <>
            <CopyButton text={json} label="Copy JSON" />
            <DownloadButton text={json} filename={`facts-${chart.id.slice(0, 8)}.json`} label="Download JSON" />
          </>
        }
      >
        <JsonTree value={f} />
      </Panel>
    </div>
  );
}
