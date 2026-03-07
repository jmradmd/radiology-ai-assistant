import test from "node:test";
import assert from "node:assert/strict";
import {
  detectPotentialPHI,
  getUnresolvedBlockingSpans,
  hasFullPHIOverride,
  type PHIOverrideSelection,
} from "./phi-filter";

test("detects names with honorific in mixed casing", () => {
  const lowerCaseHonorific = detectPotentialPHI("dr. Barbara Jackson reviewed the chart");
  const upperCaseHonorific = detectPotentialPHI("Dr. Barbara Jackson reviewed the chart");

  assert.equal(lowerCaseHonorific.hasPHI, true);
  assert.equal(upperCaseHonorific.hasPHI, true);
  assert.equal(lowerCaseHonorific.detections.some((d) => d.type === "NAME"), true);
  assert.equal(upperCaseHonorific.detections.some((d) => d.type === "NAME"), true);
});

test("detects lowercase and mixed-case first+last name pairs", () => {
  const lowercaseFullName = detectPotentialPHI("katie johnson needs protocol guidance");
  const mixedSequence = detectPotentialPHI("katie Katie johnson Johnson");
  const firstNameSequence = detectPotentialPHI("alex Alex johnson Johnson");

  assert.equal(lowercaseFullName.hasPHI, true);
  assert.equal(mixedSequence.hasPHI, true);
  assert.equal(firstNameSequence.hasPHI, true);
  assert.equal(mixedSequence.detectionSpans.some((span) => /katie|johnson/i.test(span.text)), true);
});

test("detects uncatalogued but plausible full names", () => {
  const result = detectPotentialPHI("John Doe needs protocol guidance");

  assert.equal(result.hasPHI, true);
  assert.equal(result.detectionSpans.some((span) => /John Doe/.test(span.text)), true);
});

test("detects lowercase uncatalogued names when patient context is present", () => {
  const result = detectPotentialPHI("patient xavier quill has mild symptoms");

  assert.equal(result.hasPHI, true);
  assert.equal(result.detectionSpans.some((span) => /xavier quill/i.test(span.text)), true);
});

test("does not flag common eponym-heavy clinical phrasing as a patient name", () => {
  const result = detectPotentialPHI(
    "s/p whipple with ill defined soft tissue at the porta hepatis despite negative margins on pathology. next steps?"
  );

  assert.equal(result.hasPHI, false);
});

test("detects major high-risk identifiers (MRN + phone + email)", () => {
  const result = detectPotentialPHI(
    "MRN: 12345678, call at (212) 555-1212, email jane.doe@example.com"
  );

  const detectedTypes = new Set(result.detections.map((d) => d.type));
  assert.equal(detectedTypes.has("MRN"), true);
  assert.equal(detectedTypes.has("PHONE"), true);
  assert.equal(detectedTypes.has("EMAIL"), true);
});

test("requires explicit per-span overrides before unblocking", () => {
  const result = detectPotentialPHI("Patient Barbara Jackson requires callback.");
  assert.equal(result.hasPHI, true);
  assert.equal(result.detectionSpans.length > 0, true);

  const unresolvedWithoutOverrides = getUnresolvedBlockingSpans(result, []);
  assert.equal(unresolvedWithoutOverrides.length, result.detectionSpans.length);
  assert.equal(hasFullPHIOverride(result, []), false);

  const partialOverrides: PHIOverrideSelection[] = result.detectionSpans.slice(0, 1).map((span) => ({
    spanId: span.id,
    type: span.type,
    inputHash: result.inputHash,
    acknowledged: true,
  }));
  assert.equal(hasFullPHIOverride(result, partialOverrides), result.detectionSpans.length === 1);

  const fullOverrides: PHIOverrideSelection[] = result.detectionSpans.map((span) => ({
    spanId: span.id,
    type: span.type,
    inputHash: result.inputHash,
    acknowledged: true,
  }));
  assert.equal(getUnresolvedBlockingSpans(result, fullOverrides).length, 0);
  assert.equal(hasFullPHIOverride(result, fullOverrides), true);
});

test("does not flag medical eponyms as names", () => {
  const eponymPhrases = [
    "Fleischner Society guidelines recommend follow-up",
    "Virchow Node enlargement noted",
    "Foley Catheter was placed",
    "Doppler Waveform shows normal flow",
    "Hounsfield units measured at 45",
    "Swan Ganz catheter positioned",
    "Bosniak III cystic renal lesion",
    "Baker cyst in popliteal fossa",
  ];

  for (const phrase of eponymPhrases) {
    const result = detectPotentialPHI(phrase);
    assert.equal(result.hasPHI, false, `Expected no PHI for phrase: ${phrase}`);
  }
});

test("does not flag staff references as names", () => {
  const staffPhrases = [
    "Dr. Smith recommends MRI safety screening",
    "Dr. Johnson ordered CT with contrast",
    "attending Dr. Williams reviewed the case",
    "resident Dr. Chen performed the procedure",
    "tech Martinez confirmed the protocol",
  ];

  for (const phrase of staffPhrases) {
    const result = detectPotentialPHI(phrase);
    assert.equal(result.hasPHI, false, `Expected no PHI for phrase: ${phrase}`);
  }
});

test("does not flag clinical values as geographic PHI", () => {
  const clinicalPhrases = [
    "Patient has eGFR of 28 for CT",
    "eGFR of 45 and needs CT with contrast",
    "ordered CT for evaluation",
    "prior MR shows no change",
  ];

  for (const phrase of clinicalPhrases) {
    const result = detectPotentialPHI(phrase);
    const geographicSpans = result.detectionSpans.filter((span) => span.type === "GEOGRAPHIC");
    assert.equal(geographicSpans.length, 0, `Expected no GEOGRAPHIC spans for phrase: ${phrase}`);
  }
});

test("does not flag clinical IT system names as patient names", () => {
  const itQueries = [
    "Epic Hyperspace login is extremely slow, spinning for over a minute",
    "Dictation speech recognition is not working",
    "Citrix Workspace session is frozen",
    "Carestream Vue PACS is showing error 902",
    "Medicalis workflow queue is stuck",
    "SystemX lookup failed for this accession",
    "Dragon Medical dictation is lagging",
    "Imprivata Single Sign On is down",
    "Aidoc flagged a critical finding",
  ];

  for (const query of itQueries) {
    const result = detectPotentialPHI(query);
    assert.equal(
      result.hasPHI,
      false,
      `FALSE POSITIVE: "${query}" was flagged as PHI. Spans: ${JSON.stringify(
        result.detectionSpans.map((s) => ({ text: s.text, type: s.type }))
      )}`
    );
  }
});

test("still catches real PHI after changes", () => {
  assert.equal(detectPotentialPHI("MRN 1234567").hasPHI, true);
  assert.equal(detectPotentialPHI("DOB 01/15/1980").hasPHI, true);
  assert.equal(detectPotentialPHI("SSN 123-45-6789").hasPHI, true);
  assert.equal(detectPotentialPHI("patient John Smith").hasPHI, true);
  assert.equal(detectPotentialPHI("123 Main Street").hasPHI, true);
});
