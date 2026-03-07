import test from "node:test";
import assert from "node:assert/strict";
import {
  type SourceRelevanceCandidate,
  filterResultsByDisplayRelevance,
} from "./source-relevance";

type Candidate = SourceRelevanceCandidate & { id: string };

const DEFAULT_OPTIONS = {
  minDisplaySimilarity: 0.52,
  minDisplaySimilarityKnowledge: 0.55,
  borderlineBuffer: 0.08,
  borderlineMinOverlap: 1,
} as const;

test("returns empty relevant results when all candidates are below thresholds", () => {
  const searchResults: Candidate[] = [
    {
      id: "protocol-low",
      similarity: 0.51,
      document_domain: "PROTOCOL",
      document_title: "Institution Ultrasound Policy",
      content: "Internal workflow details for ultrasound triage.",
    },
    {
      id: "knowledge-low",
      similarity: 0.54,
      document_domain: "KNOWLEDGE",
      document_title: "Educational Obstetric Ultrasound Primer",
      content: "General educational overview.",
    },
  ];

  const selection = filterResultsByDisplayRelevance(
    searchResults,
    "What is the difference between retained products of conception and incomplete miscarriage on ultrasound?",
    DEFAULT_OPTIONS
  );

  assert.equal(selection.relevantResults.length, 0);
});

test("filters borderline candidates without lexical overlap", () => {
  const searchResults: Candidate[] = [
    {
      id: "knowledge-borderline-no-overlap",
      similarity: 0.56, // borderline for knowledge (0.55 + 0.08 window)
      document_domain: "KNOWLEDGE",
      document_title: "MRI Artifact Patterns in the Knee",
      content: "Susceptibility artifact from metallic implants and gradient echo sequences.",
    },
    {
      id: "knowledge-borderline-with-overlap",
      similarity: 0.56,
      document_domain: "KNOWLEDGE",
      document_title: "First-Trimester Ultrasound Pregnancy Loss",
      content:
        "Retained products of conception and incomplete miscarriage may overlap on ultrasound appearance.",
    },
  ];

  const selection = filterResultsByDisplayRelevance(
    searchResults,
    "difference between retained products of conception and incomplete miscarriage on ultrasound",
    DEFAULT_OPTIONS
  );

  assert.deepEqual(
    selection.relevantResults.map((result) => result.id),
    ["knowledge-borderline-with-overlap"]
  );
});
