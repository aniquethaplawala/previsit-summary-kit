# Build your own pre-visit chart summary with one prompt

Copy the prompt below into an AI coding agent (Claude Code, Cursor, Codex, Windsurf or similar), started in an empty folder. It builds the same app that lives in [`app/`](app/): clinic logins, a chart loader for notes, results, medication lists and FHIR Bundles, fact extraction with [Sully Text to JSON](https://docs.sully.ai/text-to-json.md), rule-based conflict and trend checks, and a one-page summary written by [Sully M1](https://sully.ai/api) where every line cites its source.

**Before you start**

- Node.js 20 or newer, Python 3 (for the eval), and git
- A Sully API account ID and API key from [dashboard.api.sully.ai](https://dashboard.api.sully.ai). You can skip this; the app runs in demo mode without keys.
- About 30 to 45 minutes of agent time

After the build, follow [Part 2](#part-2-after-the-build) to log in, load your first chart and get it ready for real use.

---

## Part 1: the prompt

````text
Build a production-quality pre-visit chart summary web app on the Sully API. Clinic staff load a patient's chart before a visit (prior visit notes, lab reports, medication lists, or a FHIR R4 Bundle). The app pulls typed facts out of every document with Sully Text to JSON, merges them across documents with plain code (trends, conflicts, open loops), and Sully M1 writes a one-page summary in which every line cites the document it came from. The clinician clicks a citation and sees the source with the cited words highlighted. Work step by step, run the code as you go, and do not stop until every check in "Verify" passes.

## 1. Read first

Read the Sully docs before writing API code: https://docs.sully.ai/llms.txt, then https://docs.sully.ai/text-to-json.md and https://docs.sully.ai/sully-m1.md. Follow them exactly for endpoints, headers and errors.
- Text to JSON: POST {SULLY_API_BASE_URL}/v1/utils/text-to-json with {text, schema}, headers X-Account-Id and X-Api-Key. text up to 50,000 characters; the schema's nesting depth at most 10. Returns {data}. Each success is billed per request.
- M1: POST {SULLY_API_BASE_URL}/openai/v1/chat/completions, model "sully-m1". Always send reasoning_effort "none" (reasoning tokens count against max_completion_tokens).
- Never auto-retry either one: every request is billable.

## 2. Stack

Next.js (App Router, TypeScript), Tailwind CSS v4, lucide-react (strokeWidth 1.5). Plain fetch for Sully (no SDK) so every request maps 1:1 to a curl. Local storage in JSON files under ./data (gitignored), behind one store module so it can be swapped for Postgres later, with a process-wide write lock and atomic writes (write temp file, rename). All Sully calls happen in server code; keys never reach the browser. Config in .env.local with a committed .env.example: SULLY_ACCOUNT_ID, SULLY_API_KEY, SULLY_API_BASE_URL=https://api.sully.ai, SESSION_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD.

## 3. Staff accounts

- Two roles: admin and provider. Every page and API route except /login requires login. Enforce it in middleware (proxy) AND inside each route, and reload the account on every request so a deleted account stops working at once.
- Passwords hashed with node:crypto scrypt and a per-user salt; compare with timingSafeEqual. Session = httpOnly, SameSite=Lax, Secure-in-production cookie, HMAC-signed with SESSION_SECRET, 12-hour expiry. If SESSION_SECRET is missing in development, generate one into ./data and warn.
- First run seeds the admin from ADMIN_EMAIL / ADMIN_PASSWORD (default admin@example.com / change-me, with a loud console warning) and one demo provider dr.chen@example.com / change-me (Maya Chen, MD, Family Medicine).
- Admin (/admin): create, edit, reset password and delete provider accounts (name, unique email with 409 on duplicate, password min 8, credentials MD/DO/NP/PA, specialty, optional 10-digit NPI). Deleting keeps their charts, labelled "Former provider". The admin sees every chart read-only (403 on any change).
- Providers see only their own charts; anyone else's returns 404 from pages and APIs.

## 4. Charts and sources

- A chart = patient (name, optional DOB, sex, visit date, reason for visit), a list of sources, merged facts, the summary step, and a log of API calls.
- A source = {id, kind, title, date YYYY-MM-DD, text, origin}. kind is one of note, labs, meds, problems, allergies, other. Ids are S1, S2, ... assigned in date order when added and never reused, because the summary cites them. Limits: 30 sources per chart, 40,000 characters each.
- /charts/new (providers): patient fields plus a source editor: paste a document (type, title, date, text) or upload files (.txt and .md become sources with the date and title guessed from a file name like 2026-08-14-follow-up.md; .json files are FHIR Bundles). Also cards for the sample patients in ./test-data with a "Load chart" button.
- FHIR R4 Bundle: flatten it on the server. Patient fills empty name/DOB/sex. Conditions become one "Problem list (FHIR)" source; MedicationRequest/MedicationStatement one "Medication list (FHIR)" source (status stopped/completed/cancelled/on-hold = stopped, else taking); AllergyIntolerance one "Allergy list (FHIR)" source (skip refuted); Observations one "Results <date> (FHIR)" source per date (blood pressure from its systolic/diastolic components; interpretation H/L/A = abnormal); Encounters one "Visit history" source; each DocumentReference with a text/plain or text/markdown base64 attachment becomes its own note source. The grouped sources get readable text (one line per item, so citations can be highlighted) AND a ready-made structured extraction, so they skip Text to JSON. Date grouped lists by Bundle.timestamp when present. Report resource types you skipped.
- Owners can add and remove sources later; that marks an existing summary as out of date ("Sources changed").

## 5. Step 1: Text to JSON per source

For every text source without a cached extraction, call Text to JSON with this schema (additionalProperties false everywhere, every property required, nullable where shown). Put the extraction rules in property descriptions:
- document_date (string|null, YYYY-MM-DD), visit_reason (string|null)
- problems[] {name, status: active|resolved|historical|null, quote}
- medications[] {name (no dose), dose, frequency, action: taking|started|changed|stopped, date, reason, quote}. "stopped" includes held or the patient stopped it; "taking" = continued or simply listed.
- labs[] {name, value (as written), unit, reference_range, date, abnormal: boolean|null, quote}: lab tests, vitals (blood pressure as one "138/86" value), scores (PHQ-9, GAD-7, ACT), spirometry, ejection fraction.
- allergies[] {substance, reaction, quote}; no_known_allergies (boolean|null, true only if the document says NKDA)
- open_items[] {item, kind: referral|test|screening|follow_up|question|other, status: pending|done, due, quote}. Placing, ordering, sending or re-sending a referral or test is pending; done only if the patient was seen or the test resulted.
- quote: 3 to 15 words copied exactly from the document.
Send the text with a short header ("Document type / title / date") before the document. Run at most 4 requests at once. Cache each result on the source keyed by a hash of the input text plus the schema, so a re-run only pays for changed sources and a schema edit re-extracts. Clean the result defensively: trim, drop placeholders ("unknown", "n/a", "not stated"), keep only real YYYY-MM-DD dates, move "NKDA" written as an allergy into no_known_allergies, and turn a "done" referral back into "pending" when its quote only says placed/ordered/sent/referred.

## 6. Step 2: merge facts (plain code, no model)

- Medications: one row per drug (key = lowercase first word without salts like HCl/ER/sodium; keep two words for "insulin X"). Events sorted by date; a "taking" event is dated by its document (a list says "active as of this date"), other events by their own date or the document's. Drop a "stopped" event that only repeats an earlier stop. Flags: (a) med_conflict when a note stopped a drug and a later list (meds/problems/allergies kind, or FHIR) still shows it taking with no restart in between; (b) med_conflict when a note changed the dose or times per day and a later list shows a different regimen (compare dose text and times per day: BID/twice = 2, daily/once/nightly = 1; missing details never count); (c) med_change for starts, changes and stops in the most recent note.
- Labs: one series per test with aliases (A1c, eGFR, creatinine, UACR, NT-proBNP vs BNP kept separate, LDL, potassium, blood pressure, weight, PHQ-9, GAD-7, ACT, FEV1, ejection fraction, glucose tolerance, hemoglobin, TSH). Sort points by date; drop a duplicate value on the same date, and drop a note's undated re-mention of a value already recorded in the last 90 days. Trend from numbers (blood pressure uses systolic): change under 10% = stable; the last step must not reverse direction; for tests where higher is worse (A1c, creatinine, UACR, BNPs, LDL, BP, PHQ-9, GAD-7, glucose, TSH) or lower is worse (eGFR, ACT, FEV1, EF, peak flow, hemoglobin), say worsening or improving, else rising or falling. Flags: lab_worsening; lab_abnormal for an abnormal latest value within 6 months of the visit date.
- Allergies: one row per substance with all reactions and sources. allergy_conflict when any source says NKDA and another lists an allergy, when reactions differ, or when a later allergy list leaves a known allergy out.
- Problems: dedupe by name; latest status wins.
- Open items: merge mentions across documents by content words (drop words like referral, order, repeat, clinic, pediatric, sent, placed; map synonyms: ophthalmology/eye, echocardiogram/echo, CBT/counseling/behavioral/therapy, allergist/allergy, rehabilitation/rehab). Later mentions update status. A pending test is closed by a later result for it (a generic "labs" order by any later results). Flag open_item for pending referrals, tests and screenings ("first noted <date>, no record that it was completed"). Routine follow-up visits are not flagged.
- Every fact and flag keeps its citations: {sourceId, date, quote}. Each flag also has a subject and aliases (e.g. "BP", "UACR") used to check coverage.

## 7. Step 3: the summary (M1)

One non-streaming M1 call: temperature 0.1, max_completion_tokens 3000, response_format json_object. User message = visit details, "Flags to cover" (id, type, text, source ids), the merged facts as compact JSON, then every source in full as <source id date kind title> blocks (cap 150,000 characters). Output: {"sections":[{"key","bullets":[{"text","sources":[{"id","quote"}]}]}]} with these sections in order: reason (why they're coming in), problems (active problems), changes (since the last visit), medications, labs (results to look at, values in order with dates, e.g. "eGFR 58 → 52 → 45 (2025-01-14 to 2026-09-30)"), allergies, open_loops, ask_today (3 to 5 questions or things to confirm).

System prompt rules (write them out in full): use only the sources; never add diagnoses, interpretations of cause, recommendations, orders or new plans, and no "consider/should/start/increase" (restating a dated plan from a source is fine); every bullet cites at least one source with a 3 to 15 word exact quote; a bullet that combines facts from several documents cites every one of them; every flag must appear in a bullet that names its subject and cites its sources; each bullet 25 words or fewer, at most 5 per section, about 350 words in total; dates as YYYY-MM-DD; no source ids in the text; routine "return in N weeks" is not an open loop; never claim something did not happen unless a source says so; no gendered pronouns unless the chart states sex; empty sections stay empty.

Then validate on the server:
1. Strip any "[S3]" style ids from bullet text. Keep only cites whose id exists. A bullet with no valid cite is dropped and listed under "removed: no valid citation".
2. For each kept cite, check the quote appears in the source (ignore case, curly quotes and extra spaces) and keep the match offsets for highlighting.
3. Complete citations: when a bullet names a test and contains its values or dates, a drug and an event date, an allergen (plus NKDA), or an open item and a date, add the sources of those merged facts that M1 did not cite.
4. Coverage: a flag is covered when a bullet names its subject (or an alias) and cites one of its sources. For any flag M1 missed, add the flag's own text as a bullet in the matching section, marked "Added by app check".
If the reply is not JSON, show an error with the request ID; do not retry.

## 8. Running it

POST /api/charts/[id]/summarize (owner only) claims a lock (409 if a run started in the last 5 minutes is still going), returns at once, and runs the pipeline with Next.js after(). Progress text ("Reading 3 of 6 documents", "Writing the summary") is saved as it goes; the page polls every 2 seconds. If any Text to JSON request fails, keep the ones that worked, save the facts so far, and show "<n> of <m> documents could not be read" with the error; a re-run retries only those. Before the first run, show "Ready to summarize <n> sources" with the number of Text to JSON requests and the estimated cost ($0.05 each plus about $0.04 for M1).

## 9. Screens

- Home (/): "Upcoming visits" list (a provider sees their own; admin sees all): patient, reason, visit date, provider, status (Not summarized, Summarizing, Summary ready, Sources changed, Needs attention), source count, "<n> to check" badge.
- /charts/[id]: heading "<First name>'s pre-visit summary", badges, Run again / Update summary and Delete. Tabs:
  - Summary: one white card, sections in two columns on desktop (Worth asking today spans both). Each bullet ends with citation chips "S3 · Aug 14, 2026"; "Added by app check" badge where relevant. Header badges "<n> lines, every one cited" and "From the chart only · review before use". "Copy with citations" button (plain text with [S3, date] after each line and a source list). A collapsible list of removed lines.
  - Facts: a "Worth a look" box with every flag and its chips; a medications table (latest status, dose, dated event history with chips); a results table (values oldest first, abnormal in bold, trend badge, range); problems; allergies (and the NKDA sources); open items; a collapsible JSON viewer with copy and download.
  - Sources: sorted by date, with id, title, kind, date, size, and "Read by Text to JSON · n facts" / "Structured (FHIR)" / "Not read yet"; add and remove for the owner.
- Clicking any chip opens a side panel with the full source text, the cited quote highlighted and scrolled into view; Escape closes it; if the quote is not found word for word, say so.
- A collapsible "API calls" panel listing every Sully request: label, endpoint, status, latency, request ID (x-request-id), headers with the key redacted, request body truncated to 2 KB, response preview, and a copyable curl using $SULLY_ACCOUNT_ID and $SULLY_API_KEY. Under it: "<n> Text to JSON requests · <n> M1 calls · <tokens> M1 tokens".
- Map errors to plain messages: 400, 401, 402 insufficient credits, 404, 409 billing conflict, 429, 5xx, network errors; show Sully's request ID.

## 10. Sample patients and demo mode

Create ./test-data with five synthetic patients (no real data), each a folder with patient.json (name, DOB, sex optional, visitDate, visitReason, specialty, one-line blurb, sources [{file, kind, title, date}], traps [{id, description, all: [regex...], sections}], optional forbid [regex]) and the files: (1) primary care type 2 diabetes with CKD: 4 notes, a lab report, a pharmacy list; (2) heart failure as a FHIR Bundle (build it with a small node script from two text notes) plus one pasted ED note; (3) pediatric asthma: well visit, ED visit, follow-ups, a medication list sent to school; (4) prenatal care at 32 weeks with consistent gestational dates; (5) depression medication management with no sex recorded. Plant in each: a drug stopped in a note but still on a later list; a result getting worse; an allergy one source lists and another calls NKDA; a referral or test never closed.
Demo mode (SULLY_API_KEY empty): no network calls. Text to JSON results for the sample patients are replayed from test-data/<slug>/demo-extractions.json (keyed by the same hash as the cache); other documents extract nothing with a note saying so; the summary is built from the merged facts by plain rules in the same shape with citations; API calls are recorded as "Demo: not sent". Show a "Demo mode: add your Sully keys in .env.local" badge.

## 11. Design

Quiet, editorial clinical look. Colors only: ink #28262a (text), graphite #4a4a4c (secondary text), white #ffffff (cards), parchment #f3f1eb (second surface), fog #dddcdd (hairlines, badge fill), sky #97cde5 (one highlighted word in a page heading, warning badges, the source highlight), sage #c8dfaa (primary button fill only). No red: things to check use an ink border and a warning icon. Inter for UI with negative tracking; Source Serif 4 only for page headings 40px and up. 8px grid. Cards: white, 16px radius, 1px fog border, no shadows. Pill buttons and badges; primary = sage fill with ink text. Footer: "Built on Sully Text to JSON and Sully M1. The summary is a draft drawn only from the chart you loaded. Check every line against its source; it is not medical advice." Labelled inputs and visible focus states.

## 12. Verify

- npm run build passes with no type errors; eslint is clean.
- Demo mode: load each sample patient, run the summary, open a citation and see the highlight.
- With keys: write scripts/eval.py that logs in, loads each sample, runs the summary, polls until done, and checks: every trap regex matches a summary line (report whether M1 wrote it or the app check added it); zero dropped lines; cited quotes found; forbid patterns absent; then a second M1 call judges each M1-written line against the sources it cites plus the visit details (supported? advice or diagnosis?). Report cost (Text to JSON count x $0.05 + M1 tokens at $1.50 / $4.60 per 1M) and time per summary. Iterate on the prompt, schema and merge rules until all five pass twice in a row. Add --record-demo to write demo-extractions.json.
- Security: a second provider gets 404 for the first provider's chart (page and API); the admin can view but gets 403 on changes; two summarize requests at once give one 409; uploads larger than the limits are refused with a plain message.
- Clean up test accounts and charts; keep the seeded admin and demo provider.

## 13. Finish

Write README.md (setup, roles, default logins with a warning to change them, the pipeline, the eval and its latest results, cost per summary, demo mode, limitations). Then tell me how to start the app, the URL, the default logins, and the first three things to do: change the admin password, load a sample patient and run the summary, then load a real (de-identified) chart of your own.
````

---

## Part 2: after the build

### Run it

```bash
npm run dev
```

Open http://localhost:3000.

### Your first summary

1. Log in as **dr.chen@example.com / change-me**.
2. Click **New chart** and **Load chart** on a sample patient. Or fill in the patient, then paste notes, results and a medication list, or upload a FHIR Bundle.
3. Click **Summarize chart**. Text to JSON reads each document, then M1 writes the summary. About 20 seconds.
4. Click any citation chip to see the words it came from. Open the **Facts** tab for the medication history, result trends and everything the rules flagged.

To manage staff, log in as **admin@example.com / change-me** and open **Providers**. Change both default passwords first.

### Before real patients use it

This app is a working starting point, not a finished medical product. Before it touches real patient data:

| Area | What to do |
|---|---|
| **Agreements** | Sign a Business Associate Agreement (BAA) with Sully (self-serve in the Sully API dashboard) and with every other vendor that touches patient data: your host, database and logging. |
| **Clinical review** | Have clinicians review the summary prompt, the extraction schema descriptions, the rules in `lib/facts.ts` (which tests count as worsening, what counts as a conflict) and the sample output for your specialty. |
| **Source of truth** | The summary only knows the documents you load. Make it clear in your workflow that missing documents mean missing facts, and that clinicians check cited lines before acting on them. |
| **EHR connection** | Pull documents from your EHR with your own FHIR app registration (SMART on FHIR) instead of uploads, and keep provenance (document ids) so citations link back to the EHR. |
| **Scanned documents** | PDFs and faxes need OCR before they can be sources. Keep the original next to the text so clinicians can check it. |
| **Secrets** | Set a long random `SESSION_SECRET` (`openssl rand -hex 32`) and strong admin passwords. Keep `.env.local` out of git; rotate the Sully key if it is ever exposed. |
| **Hosting and database** | Deploy on a host that signs a BAA, HTTPS only. Replace the JSON files in `./data` with a managed database with encryption at rest and backups. The store module is the only file to change. |
| **Logins and audit** | Add MFA or single sign-on, lockout after failed logins, and an audit log of who viewed each chart. |
| **API calls panel** | It stores request bodies, which contain chart text. Turn it off or limit it to admins in production. |
| **Retention** | Decide how long charts and summaries are kept and delete them on schedule. |

Learn more about the [Sully API](https://sully.ai/api). Questions: [docs.sully.ai](https://docs.sully.ai/).
