# Pre-Visit Summary app

The Next.js app for the [Pre-Visit Summary Kit](../README.md).

## Setup

```bash
cp .env.example .env.local
npm install
npm run dev
```

| Variable | What it does |
|---|---|
| `SULLY_ACCOUNT_ID`, `SULLY_API_KEY` | Your Sully API credentials from [dashboard.api.sully.ai](https://dashboard.api.sully.ai). Leave the key empty for demo mode. |
| `SULLY_API_BASE_URL` | `https://api.sully.ai` |
| `SESSION_SECRET` | Signs the staff session cookie. Use `openssl rand -hex 32`. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | The admin account created on first run. |

## Logins

| Role | Default login | Can do |
|---|---|---|
| Admin | `admin@example.com` / `change-me` | Manage provider accounts, view every chart (read only) |
| Provider | `dr.chen@example.com` / `change-me` | Load charts, run summaries, view and manage their own |

Change both passwords before anyone else can reach the app.

## Routes

| Route | Who | What |
|---|---|---|
| `/` | staff | Upcoming visits: charts with status, source count and flags |
| `/charts/new` | provider | Load a sample patient, or add notes, results, medication lists and FHIR Bundles |
| `/charts/[id]` | staff | Summary with citations, merged facts, sources, API calls |
| `/admin` | admin | Provider accounts |
| `POST /api/charts` | provider | Create a chart from `{sample}` or `{patientName, ..., sources}` |
| `POST /api/charts/[id]/sources` | provider | Add documents (marks an existing summary as out of date) |
| `DELETE /api/charts/[id]/sources/[sourceId]` | provider | Remove a document |
| `POST /api/charts/[id]/summarize` | provider | Run the pipeline in the background; poll `GET /api/charts/[id]` |

## The pipeline

| Step | File | API |
|---|---|---|
| FHIR Bundle to dated sources | [`lib/fhir.ts`](lib/fhir.ts) | none (already structured) |
| Facts from each text source | [`lib/extract.ts`](lib/extract.ts) | Sully Text to JSON, one request per document, cached by text + schema |
| Merge, trends, conflicts, open loops | [`lib/facts.ts`](lib/facts.ts) | none (plain code) |
| One-page summary, citation checks | [`lib/summary.ts`](lib/summary.ts) | Sully M1, one call |
| Orchestration, locking, progress | [`lib/pipeline.ts`](lib/pipeline.ts) | |

## Sample patients and the eval

`test-data/` holds five synthetic patients (primary care diabetes and CKD, heart failure as a FHIR Bundle, pediatric asthma, prenatal, depression). Each `patient.json` lists planted traps: a drug stopped in a note but still on the list, a result getting worse, allergy sources that disagree, a referral never closed.

```bash
pip install certifi
python3 scripts/eval.py --base http://localhost:3000
```

The eval drives the running app, checks every trap shows up, that no line is uncited, that cited quotes exist in their sources, and asks a second M1 call to judge each line against its sources. Results go to `eval/RESULTS.md`. Add `--record-demo` to save the extractions that demo mode replays.

`node scripts/build-fhir-sample.mjs` rebuilds the heart failure FHIR Bundle from the notes in `test-data/chf-followup/fhir-src/`.

## Demo mode

With `SULLY_API_KEY` empty, nothing is sent. The sample patients use recorded Text to JSON results, facts are merged as usual, and the summary is built from the merged facts by plain rules. Your own pasted documents are not extracted in demo mode.

## Limitations

- Data is stored in JSON files under `./data`. Replace `lib/store.ts` with a database for production.
- Text only: PDFs and scanned documents need text extraction first. FHIR notes must be `text/plain` or `text/markdown` attachments.
- Trend direction ("worsening") is only known for common tests listed in `lib/facts.ts`. Other tests show rising or falling.
- The summary draws only on the documents you load. It cannot know what is missing from them.
