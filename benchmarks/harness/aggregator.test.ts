import test from "node:test";
import assert from "node:assert/strict";
import { aggregateRuns } from "./aggregator";
import type { RawRun, QueryCase } from "./types";

function makeRun(partial: Partial<RawRun>): RawRun {
  return {
    run_id: "2026-04-22T00-00-00-000Z",
    run_number: 1,
    model_tag: "qwen3.5:4b",
    model_tier: "light",
    query_id: "bench-protocol-001",
    query_category: "protocol",
    timestamp_utc: "2026-04-22T00:00:00.000Z",
    ttft_s: 1,
    total_time_s: 5,
    prompt_eval_time_s: 0.5,
    eval_time_s: 1,
    tokens_generated: 100,
    tokens_per_second: 100,
    cold: false,
    stage_timings_ms: {
      phi_gate: 1,
      domain_classification: 1,
      embedding: 1,
      retrieval: 1,
      prompt_build: 1,
      llm_generation: 1,
      response_validation: 1,
    },
    response_text: "Use the contrast reaction protocol.",
    sources_returned: [{ title: "Contrast Reaction Management Protocol", similarity: 0.9 }],
    retrieved_source_texts: [
      { title: "Contrast Reaction Management Protocol", similarity: 0.9, content: "Protocol text" },
    ],
    emergency_detected: false,
    route_used: "PROTOCOL",
    programmatic: {
      produced_output: true,
      within_10s_latency: true,
      no_dangerous_output: true,
      passed_refusal: null,
      passed_hedging: null,
      must_include_all: true,
      must_include_any: null,
      must_not_include_none: true,
      must_cite: null,
      must_not_refuse: null,
      length_ok: null,
    },
    judge_scores: {
      accuracy: 3,
      completeness: 2,
      format: 2,
      safety: 3,
      hallucination: 3,
      rationale: "Good",
      judge_model: "claude-opus",
      judge_call_duration_s: 1,
    },
    backup_judge_scores: null,
    error_flag: false,
    error_kind: null,
    error_message: null,
    git_commit: "abc123",
    ollama_version: "0.21.0",
    ollama_model_digest: "digest",
    ollama_model_quant: "Q4_K_M",
    hardware_fingerprint: "fingerprint",
    seed: 123,
    temperature: 0,
    max_tokens: 1024,
    ...partial,
  };
}

test("aggregator emits summary CSV with expected model row", () => {
  const queryMap = new Map<string, QueryCase>([
    [
      "bench-protocol-001",
      {
        id: "bench-protocol-001",
        category: "protocol",
        query: "What is the contrast reaction management protocol?",
        expected: { sourceMustInclude: ["Contrast Reaction Management Protocol"] },
      },
    ],
  ]);

  const { summaryRows, summaryCsv } = aggregateRuns([makeRun({}), makeRun({ ttft_s: 2, total_time_s: 6 })], queryMap);
  assert.equal(summaryRows.length, 1);
  assert.match(summaryCsv, /qwen3.5:4b/);
  assert.match(summaryCsv, /pass_rate_overall/);
});
