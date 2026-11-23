import { after, NextResponse } from "next/server";
import { requireChartAccess } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { claimRun, runSummary } from "@/lib/pipeline";
import { getChart } from "@/lib/store";

export const maxDuration = 300;

/**
 * POST /api/charts/[id]/summarize: extract facts (Text to JSON), merge them and
 * write the summary (M1). Returns at once; the page polls GET /api/charts/[id].
 * Owner only. A second request while one is running gets 409.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/charts/[id]/summarize">) {
  const access = await requireChartAccess((await ctx.params).id, true);
  if (access instanceof NextResponse) return access;
  if (!(await claimRun(access.chart.id))) return errorResponse({ title: "Already running", message: "This summary is already being written." }, 409);
  after(() => runSummary(access.chart.id));
  return NextResponse.json({ chart: await getChart(access.chart.id) });
}
