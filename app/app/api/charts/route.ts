import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { isDemoMode } from "@/lib/config";
import { errorResponse, readJsonBody } from "@/lib/http";
import { loadSample } from "@/lib/samples";
import { addSources, parseSources } from "@/lib/sources";
import { getProvider, saveChart } from "@/lib/store";
import type { Chart } from "@/lib/types";

const day = (v: unknown) => {
  const s = String(v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
};

/**
 * POST /api/charts: create a chart (providers only).
 *   {sample: "<slug>"}  loads a sample patient from test-data/
 *   {patientName, dob?, sex?, visitDate?, visitReason?, sources: [{kind, title, date, text} | {kind: "fhir", text}]}
 */
export async function POST(request: Request) {
  const user = await requireApiUser("provider");
  if (user instanceof NextResponse) return user;
  const provider = await getProvider(user.id);
  if (!provider) return errorResponse({ title: "Not allowed", message: "Only providers can add charts." }, 403);
  const body = await readJsonBody(request);
  if (!body) return errorResponse({ title: "Check the form", message: "Send the chart as JSON." });

  let patient: Chart["patient"];
  let rawSources: unknown;
  let sample: string | undefined;
  if (typeof body.sample === "string") {
    const loaded = await loadSample(body.sample);
    if (!loaded) return errorResponse({ title: "Not found", message: "That sample patient does not exist." }, 404);
    const m = loaded.manifest;
    patient = { name: m.name, dob: m.dob, sex: m.sex, visitDate: m.visitDate, visitReason: m.visitReason };
    rawSources = loaded.inputs;
    sample = m.slug;
  } else {
    patient = {
      name: String(body.patientName ?? "").trim().slice(0, 120),
      dob: day(body.dob),
      sex: String(body.sex ?? "").trim().slice(0, 20) || undefined,
      visitDate: day(body.visitDate),
      visitReason: String(body.visitReason ?? "").trim().slice(0, 300) || undefined,
    };
    rawSources = body.sources;
  }

  const parsed = parseSources(rawSources);
  if ("error" in parsed) return errorResponse({ title: "Check the sources", message: parsed.error });
  // A FHIR Patient fills in what the form left empty.
  patient.name ||= parsed.patient.name ?? "";
  patient.dob ??= parsed.patient.dob;
  patient.sex ??= parsed.patient.sex;
  if (!patient.name) return errorResponse({ title: "Check the form", message: "Add the patient's name." });

  const added = addSources({ sources: [], nextSourceNumber: 1 }, parsed.sources);
  if ("error" in added) return errorResponse({ title: "Too many sources", message: added.error });
  const now = new Date().toISOString();
  const chart: Chart = {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    demo: isDemoMode(),
    provider: { id: provider.id, name: provider.name, credentials: provider.credentials, specialty: provider.specialty },
    patient,
    sample,
    sources: added.sources,
    nextSourceNumber: added.next,
    summary: { status: "idle" },
    stale: false,
    calls: [],
  };
  await saveChart(chart);
  return NextResponse.json({ id: chart.id, notes: parsed.notes }, { status: 201 });
}
