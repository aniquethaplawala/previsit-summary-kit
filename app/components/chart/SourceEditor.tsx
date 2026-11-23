"use client";

import { FileJson, Plus, Trash2, Upload } from "lucide-react";
import { useRef, type ChangeEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { KIND_LABELS } from "@/lib/format";
import type { SourceKind } from "@/lib/types";

export type SourceDraft = { key: string; kind: SourceKind | "fhir"; title: string; date: string; text: string; origin: "pasted" | "upload"; fileName?: string };

const KINDS = Object.entries(KIND_LABELS) as Array<[SourceKind, string]>;

let counter = 0;
export function blankSource(): SourceDraft {
  return { key: `d${++counter}`, kind: "note", title: "", date: "", text: "", origin: "pasted" };
}

/** Guess a date from a file name like 2026-08-14-follow-up.md. */
function dateFromName(name: string): string {
  return name.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? "";
}

function titleFromName(name: string): string {
  const base = name.replace(/\.[a-z]+$/i, "").replace(/\d{4}-\d{2}-\d{2}[-_ ]?/, "").replace(/[-_]+/g, " ").trim();
  return base ? base[0].toUpperCase() + base.slice(1) : "Document";
}

function guessKind(name: string, text: string): SourceKind {
  const s = `${name} ${text.slice(0, 300)}`.toLowerCase();
  if (/med(ication)?s?[ -_]?list|medication list/.test(s)) return "meds";
  if (/\blab|result|panel/.test(s)) return "labs";
  if (/allerg/.test(s)) return "allergies";
  if (/problem list/.test(s)) return "problems";
  return "note";
}

/** Editable list of source documents: paste text, or upload .txt / .md files and FHIR Bundle .json files. */
export function SourceEditor({ sources, onChange }: { sources: SourceDraft[]; onChange: (next: SourceDraft[]) => void }) {
  const fileInput = useRef<HTMLInputElement>(null);

  const update = (key: string, patch: Partial<SourceDraft>) => onChange(sources.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const remove = (key: string) => onChange(sources.filter((s) => s.key !== key));

  async function onFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    const added: SourceDraft[] = [];
    for (const f of files) {
      const text = await f.text();
      if (/\.json$/i.test(f.name)) {
        added.push({ ...blankSource(), kind: "fhir", title: f.name, text, origin: "upload", fileName: f.name });
      } else {
        added.push({ ...blankSource(), kind: guessKind(f.name, text), title: titleFromName(f.name), date: dateFromName(f.name), text, origin: "upload", fileName: f.name });
      }
    }
    // Replace a single untouched blank row instead of leaving it empty.
    const keep = sources.filter((s) => s.text.trim() || s.title.trim());
    onChange([...keep, ...added]);
    e.target.value = "";
  }

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-col gap-4">
        {sources.map((s, i) => (
          <li key={s.key} className="flex flex-col gap-4 rounded-[16px] border border-fog bg-paper p-5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[14px] font-medium">Document {i + 1}</span>
              <button type="button" onClick={() => remove(s.key)} className="inline-flex items-center gap-1.5 text-[14px] text-graphite hover:text-ink" aria-label={`Remove document ${i + 1}`}>
                <Trash2 aria-hidden className="h-4 w-4" strokeWidth={1.5} />
                Remove
              </button>
            </div>
            {s.kind === "fhir" ? (
              <div className="flex items-center gap-3 rounded-[4px] bg-cream p-3 text-[14px]">
                <FileJson aria-hidden className="h-5 w-5 shrink-0" strokeWidth={1.5} />
                <span className="flex-1">
                  <span className="font-medium">FHIR Bundle</span> · {s.fileName} · {(s.text.length / 1024).toFixed(0)} KB. Conditions, medications, allergies, results and notes become separate sources.
                </span>
              </div>
            ) : (
              <>
                <div className="grid gap-4 md:grid-cols-[1fr_1.4fr_1fr]">
                  <Field label="Type" htmlFor={`kind-${s.key}`}>
                    <Select id={`kind-${s.key}`} value={s.kind} onChange={(e) => update(s.key, { kind: e.target.value as SourceKind })}>
                      {KINDS.map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Title" htmlFor={`title-${s.key}`}>
                    <Input id={`title-${s.key}`} value={s.title} onChange={(e) => update(s.key, { title: e.target.value })} placeholder="e.g. Follow-up visit" maxLength={120} required />
                  </Field>
                  <Field label="Date" htmlFor={`date-${s.key}`}>
                    <Input id={`date-${s.key}`} type="date" value={s.date} onChange={(e) => update(s.key, { date: e.target.value })} required />
                  </Field>
                </div>
                <Field label="Text" htmlFor={`text-${s.key}`} hint={s.fileName ? `From ${s.fileName}` : "Paste the note, lab report or medication list."}>
                  <Textarea id={`text-${s.key}`} value={s.text} onChange={(e) => update(s.key, { text: e.target.value })} rows={6} required />
                </Field>
              </>
            )}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => onChange([...sources, blankSource()])}>
          <Plus aria-hidden className="h-4 w-4" strokeWidth={1.5} />
          Paste a document
        </Button>
        <Button variant="secondary" size="sm" onClick={() => fileInput.current?.click()}>
          <Upload aria-hidden className="h-4 w-4" strokeWidth={1.5} />
          Upload files
        </Button>
        <input ref={fileInput} type="file" accept=".txt,.md,.json,text/plain,text/markdown,application/json,application/fhir+json" multiple className="hidden" onChange={onFiles} />
      </div>
      <p className="text-[12px] text-graphite">Text files (.txt, .md) and FHIR R4 Bundles (.json). PDFs: copy the text in. Up to 30 documents, 40,000 characters each.</p>
    </div>
  );
}

export function draftsToPayload(sources: SourceDraft[]) {
  return sources.map((s) => (s.kind === "fhir" ? { kind: "fhir", text: s.text, origin: "upload" } : { kind: s.kind, title: s.title, date: s.date, text: s.text, origin: s.origin }));
}
