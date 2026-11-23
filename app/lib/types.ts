// Shared types used by the server and the browser.

export type Credential = "MD" | "DO" | "NP" | "PA";

export type Role = "admin" | "provider";

export type ProviderProfile = {
  credentials: Credential;
  specialty: string;
  npi?: string;
};

/** A logged-in account as the app sees it (never includes the password hash). */
export type User = {
  id: string;
  role: Role;
  email: string;
  name: string;
  createdAt: string;
} & Partial<ProviderProfile>;

/** A provider account: a user with a clinical profile. */
export type Provider = User & ProviderProfile & { role: "provider" };

/** What is saved in data/accounts.json. */
export type StoredAccount = User & { passwordHash: string };

/** A friendly error that is safe to show in the UI. */
export type AppError = {
  title: string;
  message: string;
  status?: number | null;
  code?: string;
  requestId?: string;
};

/** One request made to Sully, recorded for the developer panel. */
export type ApiCall = {
  id: string;
  label: string;
  method: string;
  path: string;
  requestHeaders: Record<string, string>;
  requestBody?: string; // truncated for display
  status: number | null;
  ok: boolean;
  latencyMs: number;
  requestId?: string;
  responsePreview?: string;
  error?: string;
  curl: string;
  demo: boolean;
  note?: string;
  usage?: { promptTokens: number; completionTokens: number };
  at: string;
};

// ---------- Chart sources ----------

export type SourceKind = "note" | "labs" | "meds" | "problems" | "allergies" | "other";

/** One dated document from the patient's chart. Its id ("S3") is what the summary cites. */
export type SourceDoc = {
  id: string; // S1, S2, ...
  kind: SourceKind;
  title: string;
  date: string; // YYYY-MM-DD
  text: string;
  origin: "pasted" | "upload" | "fhir" | "sample";
  /** Facts already structured (FHIR resources). These skip Text to JSON. */
  structured?: Extraction;
  /** Text to JSON result for this source, cached by text hash so a re-run does not pay twice. */
  extraction?: { textHash: string; data: Extraction; requestId?: string; at: string };
};

// ---------- What Text to JSON pulls out of each source ----------

export type MedAction = "taking" | "started" | "changed" | "stopped";
export type ExtractedMed = {
  name: string;
  dose: string | null;
  frequency: string | null;
  action: MedAction;
  date: string | null;
  reason: string | null;
  quote: string | null;
};
export type ExtractedLab = {
  name: string;
  value: string;
  unit: string | null;
  reference_range: string | null;
  date: string | null;
  abnormal: boolean | null;
  quote: string | null;
};
export type ExtractedProblem = { name: string; status: "active" | "resolved" | "historical" | null; quote: string | null };
export type ExtractedAllergy = { substance: string; reaction: string | null; quote: string | null };
export type OpenItemKind = "referral" | "test" | "screening" | "follow_up" | "question" | "other";
export type ExtractedOpenItem = {
  item: string;
  kind: OpenItemKind;
  status: "pending" | "done";
  due: string | null;
  quote: string | null;
};

export type Extraction = {
  document_date: string | null;
  visit_reason: string | null;
  problems: ExtractedProblem[];
  medications: ExtractedMed[];
  labs: ExtractedLab[];
  allergies: ExtractedAllergy[];
  no_known_allergies: boolean | null;
  open_items: ExtractedOpenItem[];
};

// ---------- Facts merged across every source (computed by the server, no model) ----------

/** Where a fact came from. */
export type Cite = { sourceId: string; date: string; quote?: string | null };

export type MedFact = {
  key: string;
  name: string;
  status: MedAction; // the latest event
  dose: string | null;
  frequency: string | null;
  events: Array<{ action: MedAction; dose: string | null; frequency: string | null; reason: string | null } & Cite>;
};

export type LabFact = {
  key: string;
  name: string;
  unit: string | null;
  reference_range: string | null;
  points: Array<{ value: string; num: number | null; abnormal: boolean | null } & Cite>;
  trend: "worsening" | "improving" | "rising" | "falling" | "stable" | "single";
  abnormal: boolean; // latest value
};

export type AllergyFact = { key: string; substance: string; reactions: string[]; cites: Cite[] };
export type ProblemFact = { key: string; name: string; status: "active" | "resolved" | "historical" | null; cites: Cite[] };
export type OpenItemFact = { key: string; item: string; kind: OpenItemKind; status: "pending" | "done"; due: string | null; cites: Cite[] };

/** Something the clinician should look at: found by plain rules, not by the model. */
export type Flag = {
  id: string;
  type: "med_conflict" | "med_change" | "allergy_conflict" | "lab_worsening" | "lab_abnormal" | "open_item";
  subject: string; // the drug, test, allergen or item the flag is about
  aliases: string[]; // other names a summary line may use for the subject (e.g. "BP", "UACR")
  text: string;
  cites: Cite[];
};

export type Facts = {
  problems: ProblemFact[];
  medications: MedFact[];
  labs: LabFact[];
  allergies: AllergyFact[];
  nkda: Cite[]; // sources that say "no known drug allergies"
  openItems: OpenItemFact[];
  flags: Flag[];
};

// ---------- The one-page summary M1 writes ----------

export type SummarySectionKey = "reason" | "problems" | "changes" | "medications" | "labs" | "allergies" | "open_loops" | "ask_today";

/** `auto`: added by the server because the line states a fact from that source that M1 did not cite. */
export type SummaryCite = { sourceId: string; date: string; quote: string | null; found: boolean; auto?: boolean };
export type SummaryBullet = { text: string; cites: SummaryCite[]; by: "m1" | "app" };
export type SummarySection = { key: SummarySectionKey; title: string; bullets: SummaryBullet[] };

export type SummaryResult = {
  sections: SummarySection[];
  /** Lines M1 wrote without a valid citation. They are not shown in the summary. */
  dropped: Array<{ section: string; text: string; why: string }>;
  /** App flags M1 did not mention, added by the server as "app" bullets. */
  addedByApp: number;
  requestId?: string;
};

export type Step<T> = {
  status: "idle" | "running" | "done" | "error";
  startedAt?: string;
  finishedAt?: string;
  progress?: string;
  result?: T;
  error?: AppError;
};

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

// ---------- Charts ----------

export type Chart = {
  id: string;
  createdAt: string;
  updatedAt: string;
  demo: boolean;
  provider: Pick<Provider, "id" | "name" | "credentials" | "specialty">;
  patient: { name: string; dob?: string; sex?: string; visitDate?: string; visitReason?: string };
  sample?: string; // test-data slug when loaded from a sample patient
  sources: SourceDoc[];
  nextSourceNumber: number;
  facts?: Facts;
  summary: Step<SummaryResult>;
  /** True when sources changed after the last summary. */
  stale: boolean;
  calls: ApiCall[];
};
