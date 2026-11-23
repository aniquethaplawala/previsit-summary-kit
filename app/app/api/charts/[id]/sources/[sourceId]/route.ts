import { NextResponse } from "next/server";
import { requireChartAccess } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { updateChart } from "@/lib/store";

/** DELETE /api/charts/[id]/sources/[sourceId]: remove one document. Owner only. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/charts/[id]/sources/[sourceId]">) {
  const { id, sourceId } = await ctx.params;
  const access = await requireChartAccess(id, true);
  if (access instanceof NextResponse) return access;
  if (access.chart.summary.status === "running") return errorResponse({ title: "Busy", message: "Wait for the summary to finish." }, 409);
  if (!access.chart.sources.some((s) => s.id === sourceId)) return errorResponse({ title: "Not found", message: "That source does not exist." }, 404);
  if (access.chart.sources.length === 1) return errorResponse({ title: "Keep one source", message: "A chart needs at least one source." }, 409);
  const chart = await updateChart(id, (c) => {
    c.sources = c.sources.filter((s) => s.id !== sourceId);
    c.stale = c.summary.status === "done";
  });
  return NextResponse.json({ chart });
}
