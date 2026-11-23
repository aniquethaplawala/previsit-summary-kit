/**
 * The whole pipeline for one chart:
 *   1. Text to JSON on each text source that has no cached extraction (in parallel, max 4 at once)
 *   2. merge facts and find flags (plain code)
 *   3. M1 writes the one-page summary; the server validates citations and flag coverage
 *
 * Never runs twice at once for the same chart, and never retries a billable request.
 */
import { EXTRACT_CONCURRENCY, isDemoMode } from "./config";
import { toAppError } from "./errors";
import { emptyExtraction, extractionInput, extractionKey, extractSource } from "./extract";
import { mergeFacts } from "./facts";
import { demoExtractions } from "./samples";
import { demoCall, SullyError, TEXT_TO_JSON_PATH } from "./sully";
import { getChart, updateChart } from "./store";
import { demoSummary, writeSummary } from "./summary";
import type { AppError, Chart, SourceDoc } from "./types";
import { EXTRACTION_SCHEMA } from "./extract";

const STALE_MS = 5 * 60_000;

export function needsExtraction(s: SourceDoc): boolean {
  return !s.structured && s.extraction?.textHash !== extractionKey(s);
}

/** Marks the summary as running. Returns false if a run is already in progress. */
export async function claimRun(id: string): Promise<boolean> {
  let claimed = false;
  await updateChart(id, (c) => {
    const running = c.summary.status === "running" && c.summary.startedAt && Date.now() - new Date(c.summary.startedAt).getTime() < STALE_MS;
    if (running) return;
    const todo = c.sources.filter(needsExtraction).length;
    c.summary = { ...c.summary, status: "running", startedAt: new Date().toISOString(), finishedAt: undefined, error: undefined, progress: todo ? `Reading 0 of ${todo} documents` : "Writing the summary" };
    claimed = true;
  });
  return claimed;
}

export async function runSummary(id: string): Promise<Chart | undefined> {
  const start = await getChart(id);
  if (!start) return undefined;
  const demo = isDemoMode();
  const todo = start.sources.filter(needsExtraction);
  const errors: AppError[] = [];
  let done = 0;

  // 1. Text to JSON per source
  const fixtures = demo ? await demoExtractions() : undefined;
  const queue = [...todo];
  const worker = async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      const source = s;
      const textHash = extractionKey(source);
      try {
        let data, call;
        if (demo) {
          data = fixtures?.get(textHash) ?? emptyExtraction();
          call = demoCall(`Extract facts · ${source.id} ${source.title}`, { text: extractionInput(source), schema: EXTRACTION_SCHEMA }, { data }, TEXT_TO_JSON_PATH);
          if (!fixtures?.has(textHash)) call.note = "Demo mode: no recorded extraction for this document, so nothing was extracted. Add your Sully keys to extract it.";
        } else {
          ({ data, call } = await extractSource(source));
        }
        done++;
        await updateChart(id, (c) => {
          const target = c.sources.find((x) => x.id === source.id);
          if (target) target.extraction = { textHash, data, requestId: call.requestId, at: new Date().toISOString() };
          c.calls.push(call);
          c.summary.progress = `Reading ${done} of ${todo.length} documents`;
        });
      } catch (err) {
        errors.push({ ...toAppError(err), title: `${source.id} ${source.title}: ${toAppError(err).title}` });
        if (err instanceof SullyError) await updateChart(id, (c) => void c.calls.push(err.call));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(EXTRACT_CONCURRENCY, todo.length) }, worker));

  // 2. Merge
  const chart = (await getChart(id))!;
  const facts = mergeFacts(chart.sources, chart.patient.visitDate);
  if (errors.length) {
    return updateChart(id, (c) => {
      c.facts = facts;
      c.summary = {
        ...c.summary,
        status: "error",
        finishedAt: new Date().toISOString(),
        progress: undefined,
        error: { ...errors[0], message: `${errors.length} of ${todo.length} documents could not be read. ${errors[0].message} Documents that worked are saved; run the summary again to retry only the failed ones.` },
      };
    });
  }
  await updateChart(id, (c) => {
    c.facts = facts;
    c.summary.progress = "Writing the summary";
  });

  // 3. Summary
  try {
    const { result, call } = demo ? demoSummary(chart, facts) : await writeSummary(chart, facts);
    return await updateChart(id, (c) => {
      c.summary = { status: "done", startedAt: c.summary.startedAt, finishedAt: new Date().toISOString(), result };
      c.stale = false;
      c.calls.push(call);
    });
  } catch (err) {
    return await updateChart(id, (c) => {
      c.summary = { ...c.summary, status: "error", finishedAt: new Date().toISOString(), progress: undefined, error: toAppError(err) };
      if (err instanceof SullyError) c.calls.push(err.call);
    });
  }
}
