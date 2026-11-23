// Builds test-data/chf-followup/fhir-bundle.json: a hand-written, Synthea-style
// FHIR R4 Bundle for a synthetic patient. The two clinic notes in fhir-src/ are
// embedded as base64 text/plain DocumentReference attachments.
// Run: node scripts/build-fhir-sample.mjs
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const dir = path.join(process.cwd(), "test-data", "chf-followup");
const pid = "pt-whitfield";
const ref = { reference: `Patient/${pid}` };
let n = 0;
const id = (p) => `${p}-${++n}`;
const cc = (system, code, display) => ({ coding: [{ system, code, display }], text: display });
const SNOMED = "http://snomed.info/sct";
const LOINC = "http://loinc.org";
const RX = "http://www.nlm.nih.gov/research/umls/rxnorm";

const resources = [
  {
    resourceType: "Patient",
    id: pid,
    name: [{ given: ["Dolores"], family: "Whitfield" }],
    gender: "female",
    birthDate: "1947-07-02",
  },
];

const condition = (code, display, status, onset) => ({
  resourceType: "Condition",
  id: id("cond"),
  subject: ref,
  clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: status }] },
  code: cc(SNOMED, code, display),
  onsetDateTime: onset,
  recordedDate: onset,
});
resources.push(
  condition("703272007", "Heart failure with reduced ejection fraction", "active", "2023-04-11"),
  condition("440059007", "Persistent atrial fibrillation", "active", "2022-09-30"),
  condition("38341003", "Essential hypertension", "active", "2015-02-02"),
  condition("40930008", "Hypothyroidism", "active", "2018-06-19"),
  condition("14669001", "Acute kidney injury", "resolved", "2023-04-15"),
);

const med = (rxcui, display, dosage, status, authored) => ({
  resourceType: "MedicationRequest",
  id: id("medrx"),
  subject: ref,
  status,
  intent: "order",
  medicationCodeableConcept: cc(RX, rxcui, display),
  authoredOn: authored,
  dosageInstruction: [{ text: dosage }],
});
resources.push(
  med("1656354", "Sacubitril/valsartan 49/51 mg tablet", "1 tablet twice daily", "active", "2024-01-09"),
  med("866427", "Metoprolol succinate ER 100 mg tablet", "100 mg once daily", "active", "2023-05-02"),
  // Trap: stopped in the 2026-05-14 note, never ended in the EHR list.
  med("313096", "Spironolactone 25 mg tablet", "25 mg once daily", "active", "2023-05-02"),
  // Trap: raised to twice daily in the 2026-10-28 note; the order was not updated.
  med("310429", "Furosemide 40 mg tablet", "40 mg once daily", "active", "2023-04-20"),
  med("1364445", "Apixaban 5 mg tablet", "5 mg twice daily", "active", "2022-10-03"),
  med("966247", "Levothyroxine 75 mcg tablet", "75 mcg once daily", "active", "2018-06-19"),
  med("314076", "Lisinopril 10 mg tablet", "10 mg once daily", "stopped", "2023-05-02"),
);

resources.push({
  resourceType: "AllergyIntolerance",
  id: id("allergy"),
  patient: ref,
  clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: "active" }] },
  verificationStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification", code: "confirmed" }] },
  code: cc(SNOMED, "764146007", "Penicillin"),
  reaction: [{ manifestation: [cc(SNOMED, "247472004", "Hives")] }],
  recordedDate: "2009-03-12",
});

const obs = (loinc, display, value, unit, date, range, interp) => ({
  resourceType: "Observation",
  id: id("obs"),
  status: "final",
  subject: ref,
  code: cc(LOINC, loinc, display),
  effectiveDateTime: date,
  valueQuantity: { value, unit },
  ...(range ? { referenceRange: [{ text: range }] } : {}),
  ...(interp ? { interpretation: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", code: interp }] }] } : {}),
});
const bp = (sys, dia, date) => ({
  resourceType: "Observation",
  id: id("obs"),
  status: "final",
  subject: ref,
  code: cc(LOINC, "85354-9", "Blood pressure"),
  effectiveDateTime: date,
  component: [
    { code: cc(LOINC, "8480-6", "Systolic blood pressure"), valueQuantity: { value: sys, unit: "mmHg" } },
    { code: cc(LOINC, "8462-4", "Diastolic blood pressure"), valueQuantity: { value: dia, unit: "mmHg" } },
  ],
});
for (const [date, bnp, bnpFlag, k, kFlag, cr, wt, sys, dia] of [
  ["2025-12-02", 1450, "H", 4.8, null, 1.0, 68.2, 116, 70],
  ["2026-05-14", 2100, "H", 5.6, "H", 1.1, 69.0, 118, 68],
  ["2026-10-28", 3380, "H", 4.6, null, 1.3, 72.4, 126, 74],
]) {
  resources.push(
    obs("33762-6", "NT-proBNP", bnp, "pg/mL", date, "<450", bnpFlag),
    obs("2823-3", "Potassium", k, "mmol/L", date, "3.5-5.1", kFlag),
    obs("2160-0", "Creatinine", cr, "mg/dL", date, "0.5-1.1", cr > 1.1 ? "H" : null),
    obs("29463-7", "Body weight", wt, "kg", date),
    bp(sys, dia, date),
  );
}
resources.push(obs("10230-1", "Left ventricular ejection fraction (echo)", 30, "%", "2025-12-02", "52-74", "L"));

const encounter = (date, type, reason) => ({
  resourceType: "Encounter",
  id: id("enc"),
  status: "finished",
  class: { code: "AMB" },
  subject: ref,
  type: [{ text: type }],
  reasonCode: [{ text: reason }],
  period: { start: date, end: date },
});
resources.push(
  encounter("2025-12-02", "Cardiology clinic visit", "Heart failure follow-up and echocardiogram"),
  encounter("2026-05-14", "Cardiology clinic visit", "Heart failure follow-up"),
  encounter("2026-10-28", "Heart failure clinic visit", "Worsening shortness of breath"),
);

const doc = (file, date, description) => ({
  resourceType: "DocumentReference",
  id: id("doc"),
  status: "current",
  subject: ref,
  type: cc(LOINC, "11488-4", "Consult note"),
  date: `${date}T17:00:00Z`,
  description,
  content: [{ attachment: { contentType: "text/plain", data: Buffer.from(readFileSync(path.join(dir, "fhir-src", file), "utf8")).toString("base64") } }],
});
resources.push(
  doc("2026-05-14-cardiology.md", "2026-05-14", "Cardiology clinic note"),
  doc("2026-10-28-hf-clinic.md", "2026-10-28", "Heart failure clinic note"),
);

const bundle = {
  resourceType: "Bundle",
  id: "whitfield-export",
  type: "collection",
  timestamp: "2026-11-20T09:00:00Z",
  entry: resources.map((resource) => ({ fullUrl: `urn:uuid:${resource.id}`, resource })),
};
writeFileSync(path.join(dir, "fhir-bundle.json"), JSON.stringify(bundle, null, 2) + "\n");
console.log(`Wrote ${resources.length} resources to test-data/chf-followup/fhir-bundle.json`);
