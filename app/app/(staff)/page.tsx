import Link from "next/link";
import { connection } from "next/server";
import { ArrowRight, NotebookText, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { PageHeading } from "@/components/ui/Card";
import { requirePageUser } from "@/lib/auth";
import { chartStatus, formatDate, formatDay, STATUS_LABELS } from "@/lib/format";
import { listCharts, listProviders } from "@/lib/store";
import type { Chart } from "@/lib/types";

export default async function HomePage() {
  await connection();
  const user = await requirePageUser();
  const isAdmin = user.role === "admin";
  const all = await listCharts();
  // Providers see only their own charts; the admin sees everyone's (read only).
  const charts = isAdmin ? all : all.filter((c) => c.provider.id === user.id);
  const activeIds = new Set((await listProviders()).map((p) => p.id));

  return (
    <div className="flex flex-col">
      <section className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-6 pt-10 pb-12 md:flex-row md:items-end md:justify-between">
        <PageHeading before={isAdmin ? "All" : "Upcoming"} highlight="visits">
          Load a patient&apos;s chart and get a one-page summary where every line points back to its source.
        </PageHeading>
        {isAdmin ? null : <ButtonLink href="/charts/new">New chart</ButtonLink>}
      </section>

      <section className="bg-cream">
        <div className="mx-auto w-full max-w-[1200px] px-6 py-12">
          {charts.length === 0 ? <EmptyState isAdmin={isAdmin} /> : <ChartList charts={charts} activeIds={activeIds} />}
        </div>
      </section>
    </div>
  );
}

function ChartList({ charts, activeIds }: { charts: Chart[]; activeIds: Set<string> }) {
  return (
    <ul className="flex flex-col gap-3" aria-label="Charts">
      {charts.map((c) => {
        const flags = c.facts?.flags.length ?? 0;
        const status = chartStatus(c);
        return (
          <li key={c.id}>
            <Link
              href={`/charts/${c.id}`}
              className="group grid grid-cols-1 gap-3 rounded-[16px] border border-fog bg-paper p-5 hover:border-silver md:grid-cols-[1.4fr_1fr_1.2fr_auto] md:items-center md:gap-6 md:px-6"
            >
              <div className="flex flex-col gap-1">
                <span className="text-[16px] font-medium">{c.patient.name}</span>
                <span className="text-[14px] text-graphite">
                  {c.patient.visitReason ? `${c.patient.visitReason} · ` : ""}
                  {c.patient.visitDate ? `Visit ${formatDay(c.patient.visitDate)}` : `Added ${formatDate(c.createdAt)}`}
                </span>
              </div>
              <div className="flex flex-col gap-1 text-[14px]">
                <span>
                  {c.provider.name}, {c.provider.credentials}
                </span>
                <span className="text-graphite">{activeIds.has(c.provider.id) ? c.provider.specialty : "Former provider"}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="outline">{STATUS_LABELS[status]}</Badge>
                <Badge tone="outline">{c.sources.length} sources</Badge>
                {flags ? (
                  <Badge tone="sky">
                    <TriangleAlert aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
                    {flags} to check
                  </Badge>
                ) : null}
                {c.demo ? <Badge>Demo</Badge> : null}
              </div>
              <ArrowRight aria-hidden className="hidden h-5 w-5 text-graphite transition group-hover:translate-x-0.5 md:block" strokeWidth={1.5} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function EmptyState({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-[16px] bg-paper px-6 py-16 text-center">
      <NotebookText aria-hidden className="h-8 w-8 text-graphite" strokeWidth={1.5} />
      <h2 className="text-[24px] font-medium tracking-[-0.02em]">No charts yet</h2>
      {isAdmin ? null : (
        <>
          <p className="max-w-md text-graphite">Start with one of the five sample patients, or paste your own notes, labs and medication list.</p>
          <ButtonLink href="/charts/new">Load your first chart</ButtonLink>
        </>
      )}
    </div>
  );
}
