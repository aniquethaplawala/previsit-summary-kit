import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { listSamples } from "@/lib/samples";

/** GET /api/samples: the synthetic sample patients in test-data/. */
export async function GET() {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  const samples = await listSamples();
  return NextResponse.json({ samples: samples.map(({ slug, name, specialty, visitReason, blurb, sources }) => ({ slug, name, specialty, visitReason, blurb, documents: sources.length })) });
}
