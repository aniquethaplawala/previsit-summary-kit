"use client";

import { FlaskConical } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { Field, Input, Select } from "@/components/ui/Field";
import { asAppError, postJson } from "@/lib/client";
import type { AppError } from "@/lib/types";
import { blankSource, draftsToPayload, SourceEditor, type SourceDraft } from "./SourceEditor";

export type SampleCard = { slug: string; name: string; specialty: string; visitReason: string; blurb: string; documents: number };

export function NewChartForm({ samples }: { samples: SampleCard[] }) {
  const router = useRouter();
  const [patientName, setPatientName] = useState("");
  const [dob, setDob] = useState("");
  const [sex, setSex] = useState("");
  const [visitDate, setVisitDate] = useState("");
  const [visitReason, setVisitReason] = useState("");
  const [sources, setSources] = useState<SourceDraft[]>([blankSource()]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);

  async function create(body: unknown, key: string) {
    setBusy(key);
    setError(null);
    try {
      const { id } = await postJson<{ id: string }>("/api/charts", body);
      router.push(`/charts/${id}`);
    } catch (err) {
      setError(asAppError(err));
      setBusy(null);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void create({ patientName, dob, sex, visitDate, visitReason, sources: draftsToPayload(sources) }, "form");
  }

  return (
    <div className="flex flex-col gap-10">
      {samples.length ? (
        <section className="flex flex-col gap-4" aria-labelledby="samples-heading">
          <div className="flex items-center gap-2">
            <FlaskConical aria-hidden className="h-5 w-5" strokeWidth={1.5} />
            <h2 id="samples-heading" className="text-[24px] font-medium tracking-[-0.02em]">
              Start with a sample patient
            </h2>
          </div>
          <p className="text-[14px] text-graphite">Synthetic charts written for this kit. Each one hides a few things a busy clinician could miss.</p>
          <ul className="grid gap-3 md:grid-cols-2">
            {samples.map((s) => (
              <li key={s.slug} className="flex flex-col gap-3 rounded-[16px] border border-fog bg-paper p-5">
                <div className="flex flex-col gap-1">
                  <span className="text-[16px] font-medium">{s.name}</span>
                  <span className="text-[14px] text-graphite">{s.visitReason}</span>
                </div>
                <p className="text-[14px]">{s.blurb}</p>
                <div className="mt-auto flex flex-wrap items-center gap-2">
                  <Badge tone="outline">{s.specialty}</Badge>
                  <Badge tone="outline">{s.documents} files</Badge>
                  <Button size="sm" className="ml-auto" disabled={busy !== null} onClick={() => create({ sample: s.slug }, s.slug)}>
                    {busy === s.slug ? "Loading..." : "Load chart"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {error ? <ErrorNotice error={error} /> : null}

      <form onSubmit={submit} className="flex flex-col gap-6" aria-labelledby="own-heading">
        <h2 id="own-heading" className="text-[24px] font-medium tracking-[-0.02em]">
          Or add your own
        </h2>
        <div className="flex flex-col gap-5 rounded-[16px] bg-paper p-6 md:p-8">
          <div className="grid gap-5 md:grid-cols-[1.5fr_1fr_1fr]">
            <Field label="Patient name" htmlFor="patient-name" hint="Can be left empty when a FHIR Bundle has the patient.">
              <Input id="patient-name" value={patientName} onChange={(e) => setPatientName(e.target.value)} maxLength={120} />
            </Field>
            <Field label="Date of birth (optional)" htmlFor="dob">
              <Input id="dob" type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
            </Field>
            <Field label="Sex (optional)" htmlFor="sex">
              <Select id="sex" value={sex} onChange={(e) => setSex(e.target.value)}>
                <option value="">Not given</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="other">Other</option>
              </Select>
            </Field>
          </div>
          <div className="grid gap-5 md:grid-cols-[1fr_2fr]">
            <Field label="Visit date" htmlFor="visit-date">
              <Input id="visit-date" type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} />
            </Field>
            <Field label="Reason for visit" htmlFor="visit-reason" hint="From scheduling, for example: 3-month diabetes follow-up.">
              <Input id="visit-reason" value={visitReason} onChange={(e) => setVisitReason(e.target.value)} maxLength={300} />
            </Field>
          </div>
        </div>
        <SourceEditor sources={sources} onChange={setSources} />
        <Button type="submit" disabled={busy !== null || sources.length === 0}>
          {busy === "form" ? "Saving..." : "Save chart"}
        </Button>
      </form>
    </div>
  );
}
