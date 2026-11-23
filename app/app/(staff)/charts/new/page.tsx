import { connection } from "next/server";
import { NewChartForm } from "@/components/chart/NewChartForm";
import { PageHeading } from "@/components/ui/Card";
import { requirePageUser } from "@/lib/auth";
import { listSamples } from "@/lib/samples";

export default async function NewChartPage() {
  await connection();
  await requirePageUser("provider");
  const samples = (await listSamples()).map(({ slug, name, specialty, visitReason, blurb, sources }) => ({ slug, name, specialty, visitReason, blurb, documents: sources.length }));
  return (
    <div className="flex flex-col">
      <section className="mx-auto w-full max-w-[1200px] px-6 pt-10 pb-12">
        <PageHeading before="New" highlight="chart">
          Add the patient&apos;s prior notes, results and medication list, or a FHIR Bundle. Then run the summary.
        </PageHeading>
      </section>
      <section className="bg-cream">
        <div className="mx-auto w-full max-w-[880px] px-6 py-12">
          <NewChartForm samples={samples} />
        </div>
      </section>
    </div>
  );
}
