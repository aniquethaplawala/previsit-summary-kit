import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ChartView } from "@/components/chart/ChartView";
import { canView, requirePageUser } from "@/lib/auth";
import { getChart, getProvider } from "@/lib/store";

export default async function ChartPage({ params }: PageProps<"/charts/[id]">) {
  await connection();
  const user = await requirePageUser();
  const { id } = await params;
  const chart = await getChart(id);
  // Another provider's chart looks exactly like a missing one.
  if (!chart || !canView(user, chart)) notFound();
  const formerProvider = !(await getProvider(chart.provider.id));
  return <ChartView initialChart={chart} readOnly={chart.provider.id !== user.id} formerProvider={formerProvider} />;
}
