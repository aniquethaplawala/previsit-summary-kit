import { NextResponse } from "next/server";
import { requireChartAccess } from "@/lib/auth";
import { deleteChart } from "@/lib/store";

export async function GET(_request: Request, ctx: RouteContext<"/api/charts/[id]">) {
  const access = await requireChartAccess((await ctx.params).id);
  if (access instanceof NextResponse) return access;
  return NextResponse.json({ chart: access.chart });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/charts/[id]">) {
  const access = await requireChartAccess((await ctx.params).id, true);
  if (access instanceof NextResponse) return access;
  await deleteChart(access.chart.id);
  return new NextResponse(null, { status: 204 });
}
