/**
 * Sample patients in test-data/ (synthetic, written for this kit). Each folder has
 * patient.json (visit details, source list, planted "traps" the eval checks)
 * and the source files. demo-extractions.json holds recorded Text to JSON
 * results so demo mode can show real extractions without keys.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { TEST_DATA_DIR } from "./config";
import type { Extraction } from "./types";
import type { SourceInput } from "./sources";

export type SampleManifest = {
  slug: string;
  name: string;
  dob?: string;
  sex?: string;
  visitDate: string;
  visitReason: string;
  specialty: string;
  blurb: string;
  sources: Array<{ file: string; kind: string; title?: string; date?: string }>;
  traps: Array<{ id: string; description: string; all: string[]; sections?: string[] }>;
};

const SLUG = /^[a-z0-9-]+$/;

export async function listSamples(): Promise<SampleManifest[]> {
  let dirs: string[] = [];
  try {
    dirs = await fs.readdir(TEST_DATA_DIR);
  } catch {
    return [];
  }
  const out: SampleManifest[] = [];
  for (const d of dirs.sort()) {
    if (!SLUG.test(d)) continue;
    try {
      out.push(JSON.parse(await fs.readFile(path.join(TEST_DATA_DIR, d, "patient.json"), "utf8")) as SampleManifest);
    } catch {
      // not a sample folder
    }
  }
  return out;
}

export async function loadSample(slug: string): Promise<{ manifest: SampleManifest; inputs: SourceInput[] } | undefined> {
  if (!SLUG.test(slug)) return undefined;
  const dir = path.join(TEST_DATA_DIR, slug);
  let manifest: SampleManifest;
  try {
    manifest = JSON.parse(await fs.readFile(path.join(dir, "patient.json"), "utf8"));
  } catch {
    return undefined;
  }
  const inputs: SourceInput[] = [];
  for (const s of manifest.sources) {
    const file = path.join(dir, s.file);
    if (!file.startsWith(dir + path.sep)) continue;
    inputs.push({ kind: s.kind, title: s.title, date: s.date, text: await fs.readFile(file, "utf8"), origin: "sample" });
  }
  return { manifest, inputs };
}

const cache = globalThis as unknown as { __demoExtractions?: Map<string, Extraction> };

/** Recorded extractions from every sample, keyed by the hash of the extraction input. */
export async function demoExtractions(): Promise<Map<string, Extraction>> {
  if (cache.__demoExtractions) return cache.__demoExtractions;
  const map = new Map<string, Extraction>();
  for (const s of await listSamples()) {
    try {
      const rec = JSON.parse(await fs.readFile(path.join(TEST_DATA_DIR, s.slug, "demo-extractions.json"), "utf8")) as Record<string, Extraction>;
      for (const [k, v] of Object.entries(rec)) map.set(k, v);
    } catch {
      // no recording yet
    }
  }
  return (cache.__demoExtractions = map);
}
