/**
 * Tiny JSON file store under app/data/ (gitignored). No database to install.
 *
 *   data/accounts.json       the admin and provider logins (hashed passwords)
 *   data/charts/<id>.json    one file per chart (sources, extracted facts, summary, API calls)
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DATA_DIR } from "./config";
import { hashPassword } from "./password";
import type { Chart, Provider, ProviderProfile, StoredAccount, User } from "./types";

const CHARTS_DIR = path.join(DATA_DIR, "charts");
const SAFE_ID = /^[a-zA-Z0-9-]+$/;

// One write lock shared by every route in this Node process, so parallel
// requests never overwrite each other's changes.
const globalLock = globalThis as unknown as { __chartLock?: Promise<unknown> };
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = globalLock.__chartLock ?? Promise.resolve();
  const next = prev.then(fn, fn);
  globalLock.__chartLock = next.catch(() => undefined);
  return next;
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2));
  await fs.rename(tmp, file);
}

// ---------- Accounts (admin + providers) ----------

const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");
const DEFAULT_PASSWORD = "change-me";

/** First run: one admin (from ADMIN_EMAIL / ADMIN_PASSWORD) and one demo provider. */
function seedAccounts(): StoredAccount[] {
  const now = new Date().toISOString();
  const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase() || "admin@example.com";
  const adminPassword = (process.env.ADMIN_PASSWORD ?? "").trim() || DEFAULT_PASSWORD;
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
    console.warn(`[auth] ADMIN_EMAIL or ADMIN_PASSWORD is not set. Created admin ${adminEmail} with the default password. Change it.`);
  }
  console.warn("[auth] Created demo provider dr.chen@example.com with password change-me. Change or delete it in /admin.");
  return [
    { id: randomUUID(), role: "admin", email: adminEmail, name: "Admin", createdAt: now, passwordHash: hashPassword(adminPassword) },
    {
      id: randomUUID(),
      role: "provider",
      email: "dr.chen@example.com",
      name: "Maya Chen",
      credentials: "MD",
      specialty: "Family Medicine",
      npi: "1234567893",
      createdAt: now,
      passwordHash: hashPassword(DEFAULT_PASSWORD),
    },
  ];
}

async function readAccounts(): Promise<StoredAccount[]> {
  const existing = await readJson<StoredAccount[]>(ACCOUNTS_FILE);
  if (existing) return existing;
  return withLock(async () => {
    const again = await readJson<StoredAccount[]>(ACCOUNTS_FILE);
    if (again) return again;
    const seeded = seedAccounts();
    await writeJson(ACCOUNTS_FILE, seeded);
    return seeded;
  });
}

function toUser({ passwordHash: _hash, ...user }: StoredAccount): User {
  void _hash;
  return user;
}

export async function findAccountByEmail(email: string): Promise<StoredAccount | undefined> {
  const e = email.trim().toLowerCase();
  return (await readAccounts()).find((a) => a.email === e);
}

export async function getUser(id: string): Promise<User | undefined> {
  const account = (await readAccounts()).find((a) => a.id === id);
  return account ? toUser(account) : undefined;
}

export async function listProviders(): Promise<Provider[]> {
  return (await readAccounts()).filter((a) => a.role === "provider").map((a) => toUser(a) as Provider);
}

export async function getProvider(id: string): Promise<Provider | undefined> {
  return (await listProviders()).find((p) => p.id === id);
}

export type ProviderInput = ProviderProfile & { name: string; email: string };

export async function createProvider(input: ProviderInput, password: string): Promise<Provider | { error: string }> {
  await readAccounts(); // make sure the seed exists first
  return withLock(async () => {
    const accounts = (await readJson<StoredAccount[]>(ACCOUNTS_FILE)) ?? [];
    if (accounts.some((a) => a.email === input.email)) return { error: "An account with that email already exists." };
    const account: StoredAccount = {
      ...input,
      id: randomUUID(),
      role: "provider",
      createdAt: new Date().toISOString(),
      passwordHash: hashPassword(password),
    };
    await writeJson(ACCOUNTS_FILE, [...accounts, account]);
    return toUser(account) as Provider;
  });
}

export async function updateProvider(id: string, input: ProviderInput): Promise<Provider | { error: string } | undefined> {
  return withLock(async () => {
    const accounts = (await readJson<StoredAccount[]>(ACCOUNTS_FILE)) ?? [];
    const index = accounts.findIndex((a) => a.id === id && a.role === "provider");
    if (index === -1) return undefined;
    if (accounts.some((a) => a.email === input.email && a.id !== id)) return { error: "An account with that email already exists." };
    accounts[index] = { ...accounts[index], ...input };
    await writeJson(ACCOUNTS_FILE, accounts);
    return toUser(accounts[index]) as Provider;
  });
}

export async function setPassword(id: string, password: string): Promise<boolean> {
  return withLock(async () => {
    const accounts = (await readJson<StoredAccount[]>(ACCOUNTS_FILE)) ?? [];
    const account = accounts.find((a) => a.id === id);
    if (!account) return false;
    account.passwordHash = hashPassword(password);
    await writeJson(ACCOUNTS_FILE, accounts);
    return true;
  });
}

/** Removes the provider's login. Their charts stay and show as "former provider". */
export async function deleteProvider(id: string): Promise<boolean> {
  return withLock(async () => {
    const accounts = (await readJson<StoredAccount[]>(ACCOUNTS_FILE)) ?? [];
    const remaining = accounts.filter((a) => !(a.id === id && a.role === "provider"));
    if (remaining.length === accounts.length) return false;
    await writeJson(ACCOUNTS_FILE, remaining);
    return true;
  });
}

// ---------- Charts ----------

function chartFile(id: string): string {
  if (!SAFE_ID.test(id)) throw new Error("Invalid chart id");
  return path.join(CHARTS_DIR, `${id}.json`);
}

export async function listCharts(): Promise<Chart[]> {
  let files: string[] = [];
  try {
    files = await fs.readdir(CHARTS_DIR);
  } catch {
    return [];
  }
  const charts = await Promise.all(files.filter((f) => f.endsWith(".json")).map((f) => readJson<Chart>(path.join(CHARTS_DIR, f))));
  return charts.filter((v): v is Chart => Boolean(v)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getChart(id: string): Promise<Chart | undefined> {
  if (!SAFE_ID.test(id)) return undefined;
  return readJson<Chart>(chartFile(id));
}

export async function saveChart(chart: Chart): Promise<void> {
  await withLock(() => writeJson(chartFile(chart.id), chart));
}

/** Read-modify-write under the lock. Returns the updated chart. */
export async function updateChart(id: string, change: (chart: Chart) => Chart | void): Promise<Chart> {
  return withLock(async () => {
    const chart = await readJson<Chart>(chartFile(id));
    if (!chart) throw new Error("Chart not found");
    const next = change(chart) ?? chart;
    next.updatedAt = new Date().toISOString();
    await writeJson(chartFile(id), next);
    return next;
  });
}

export async function deleteChart(id: string): Promise<void> {
  await withLock(() => fs.rm(chartFile(id), { force: true }));
}
