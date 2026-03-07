import test from "node:test";
import assert from "node:assert/strict";
import { formatConciseResponse, shouldApplyConciseFormatting } from "./concise-format";

test("cleans punctuation artifacts without destroying structure", () => {
  const result = formatConciseResponse(
    "There is no imaging distinction between them:. The terminology difference is clinical/temporal, not radiologic:.\n\nUse ultrasound descriptors.. Avoid redundant qualifiers.."
  );

  assert.equal(result.includes(":."), false);
  assert.equal(result.includes(".."), false);
  assert.equal(result.includes("There is no imaging distinction between them:"), true);
});

test("normalizes excessive whitespace while preserving markdown", () => {
  const result = formatConciseResponse(
    `## Recommendation




Use ultrasound first when indicated.

- Confirm exam indication.
- Correlate with LFTs.`
  );

  assert.equal(result.includes("\n\n\n\n"), false);
  assert.equal(result.includes("## Recommendation"), true);
  assert.equal(result.includes("- Confirm exam indication."), true);
});

test("preserves source citation markers through cleanup", () => {
  const citation = "[Source: \"Contrast Media Guidelines\"]";
  const result = formatConciseResponse(
    `Dose is 0.3 mg IM.. ${citation}

Reassess in 5 minutes if needed.`
  );

  assert.equal(result.includes(citation), true);
  const citationIndex = result.indexOf(citation);
  assert.equal(citationIndex >= 0, true);
  assert.equal(result.indexOf("0.3 mg IM.") < citationIndex, true);
});

test("preserves decimal dosing punctuation", () => {
  const result = formatConciseResponse(
    "For severe contrast reaction, administer epinephrine 0.3 mg IM immediately. Repeat every 5 minutes if needed."
  );

  assert.equal(result.includes("0.3 mg"), true);
  assert.equal(result.includes("0. 3 mg"), false);
});

test("bypasses concise formatting for emergency severity", () => {
  const shouldApply = shouldApplyConciseFormatting({
    isConciseOutput: true,
    severity: "emergency",
    currentBranch: "EMERGENCY",
  });

  assert.equal(shouldApply, false);
});

test("bypasses concise formatting for urgent severity", () => {
  const shouldApply = shouldApplyConciseFormatting({
    isConciseOutput: true,
    severity: "urgent",
    currentBranch: "EMERGENCY",
  });

  assert.equal(shouldApply, false);
});

test("applies concise formatting for routine concise output", () => {
  const shouldApply = shouldApplyConciseFormatting({
    isConciseOutput: true,
    severity: "routine",
    currentBranch: "ROUTINE",
  });

  assert.equal(shouldApply, true);
  assert.equal(shouldApplyConciseFormatting({
    isConciseOutput: true,
    severity: "routine",
    currentBranch: "KNOWLEDGE_ONLY",
  }), true);
});
