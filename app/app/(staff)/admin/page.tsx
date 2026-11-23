import { connection } from "next/server";
import { ProviderManager } from "@/components/admin/ProviderManager";
import { PageHeading } from "@/components/ui/Card";
import { requirePageUser } from "@/lib/auth";
import { listProviders } from "@/lib/store";

export default async function AdminPage() {
  await connection();
  await requirePageUser("admin");
  const providers = await listProviders();
  return (
    <div className="flex flex-col">
      <section className="mx-auto w-full max-w-[1200px] px-6 pt-10 pb-12">
        <PageHeading before="Manage" highlight="providers" />
      </section>
      <section className="bg-cream">
        <div className="mx-auto w-full max-w-[1200px] px-6 py-12">
          <ProviderManager initialProviders={providers} />
        </div>
      </section>
    </div>
  );
}
