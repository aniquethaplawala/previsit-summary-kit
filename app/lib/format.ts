import type { Chart, SourceKind } from "./types";

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/** "2026-08-14" -> "Aug 14, 2026" (no time zone shift). */
export function formatDay(day: string): string {
  const m = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return day;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export const KIND_LABELS: Record<SourceKind, string> = {
  note: "Visit note",
  labs: "Results",
  meds: "Medication list",
  problems: "Problem list",
  allergies: "Allergy list",
  other: "Other",
};

export type ChartStatus = "draft" | "running" | "ready" | "stale" | "error";

export function chartStatus(chart: Pick<Chart, "summary" | "stale">): ChartStatus {
  if (chart.summary.status === "running") return "running";
  if (chart.summary.status === "error") return "error";
  if (chart.summary.status === "done") return chart.stale ? "stale" : "ready";
  return "draft";
}

export const STATUS_LABELS: Record<ChartStatus, string> = {
  draft: "Not summarized",
  running: "Summarizing",
  ready: "Summary ready",
  stale: "Sources changed",
  error: "Needs attention",
};
