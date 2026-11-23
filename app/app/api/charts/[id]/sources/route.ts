import { NextResponse } from "next/server";
import { requireChartAccess } from "@/lib/auth";
import { errorResponse, readJsonBody } from "@/lib/http";
import { addSources, parseSources } from "@/lib/sources";
import { updateChart } from "@/lib/store";

/** POST /api/charts/[id]/sources {sources: [...]}: add documents to a chart. Owner only. */
export async function POST(request: Request, ctx: RouteContext<"/api/charts/[id]/sources">) {
  const access = await requireChartAccess((await ctx.params).id, true);
  if (access instanceof NextResponse) return access;
  if (access.chart.summary.status === "running") return errorResponse({ title: "Busy", message: "Wait for the summary to finish." }, 409);
  const body = await readJsonBody(request);
  const parsed = parseSources(body?.sources);
  if ("error" in parsed) return errorResponse({ title: "Check the sources", message: parsed.error });
  let error: string | undefined;
  const chart = await updateChart(access.chart.id, (c) => {
    const added = addSources(c, parsed.sources);
    if ("error" in added) {
      error = added.error;
      return;
    }
    c.sources = added.sources;
    c.nextSourceNumber = added.next;
    c.stale = c.summary.status === "done";
  });
  if (error) return errorResponse({ title: "Too many sources", message: error });
  return NextResponse.json({ chart, notes: parsed.notes });
}
