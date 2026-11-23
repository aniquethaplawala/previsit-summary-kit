import { TopBar } from "@/components/TopBar";
import { getCurrentUser } from "@/lib/auth";
import { isDemoMode } from "@/lib/config";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return (
    <>
      <TopBar demo={isDemoMode()} user={user} />
      <main className="flex flex-1 flex-col">{children}</main>
      <footer className="mx-auto w-full max-w-[1200px] px-6 py-10 text-[14px] text-graphite">
        Built on Sully Text to JSON and Sully M1. The summary is a draft drawn only from the chart you loaded. Check every line against its source; it is not medical advice.
      </footer>
    </>
  );
}
