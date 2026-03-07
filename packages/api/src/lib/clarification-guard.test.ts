import test from "node:test";
import assert from "node:assert/strict";
import { resolveAbbreviationClarificationCandidate } from "./clarification-guard";

test("rejects non-abbreviation clarification candidates", () => {
  const result = resolveAbbreviationClarificationCandidate({
    term: "which",
    possibleMeanings: [
      "delayed hypersensitivity reaction",
      "unrelated coincidental rash",
    ],
  });

  assert.equal(result, null);
});

test("accepts valid abbreviation candidates and normalizes term", () => {
  const result = resolveAbbreviationClarificationCandidate({
    term: "ms",
    possibleMeanings: ["mitral stenosis", "multiple sclerosis", "made up meaning"],
  });

  assert.deepEqual(result, {
    abbreviation: "MS",
    meanings: ["mitral stenosis", "multiple sclerosis"],
  });
});

test("falls back to dictionary meanings when model meanings are invalid", () => {
  const result = resolveAbbreviationClarificationCandidate({
    term: "EGFR",
    possibleMeanings: ["estimated glomerular filtration rate"],
  });

  assert.deepEqual(result, {
    abbreviation: "EGFR",
    meanings: [
      "estimated glomerular filtration rate",
      "epidermal growth factor receptor",
    ],
  });
});
