import path from "node:path";

/** Local JSON store for accounts, charts and API call logs (gitignored). */
export const DATA_DIR = path.join(process.cwd(), "data");

/** Sample patients shipped with the kit. */
export const TEST_DATA_DIR = path.join(process.cwd(), "test-data");

/** Limits per chart. Text to JSON accepts up to 50,000 characters per request. */
export const MAX_SOURCES = 30;
export const MAX_SOURCE_CHARS = 40_000;
/** How many Text to JSON requests run at once. */
export const EXTRACT_CONCURRENCY = 4;

export type SullyConfig = {
  accountId: string;
  apiKey: string;
  baseUrl: string;
  demo: boolean;
};

/** Reads Sully settings from .env.local. Without an API key the app runs in demo mode. */
export function getSullyConfig(): SullyConfig {
  const apiKey = (process.env.SULLY_API_KEY ?? "").trim();
  const accountId = (process.env.SULLY_ACCOUNT_ID ?? "").trim();
  const baseUrl = ((process.env.SULLY_API_BASE_URL ?? "").trim() || "https://api.sully.ai").replace(/\/+$/, "");
  return { accountId, apiKey, baseUrl, demo: apiKey === "" };
}

export function isDemoMode(): boolean {
  return getSullyConfig().demo;
}
