/**
 * Deterministic synthetic benchmark dataset generator.
 *
 * Produces a results bundle that demonstrates the full reporting pipeline:
 * 9 models × 100 queries × 4 runs (1 cold + 3 warm) with realistic-looking
 * timing distributions and judge scores anchored to plausible tier behavior.
 *
 * This is ONLY for demonstrating the reporting machinery. The numbers are not
 * measurements of real Ollama models; the file is clearly labelled synthetic.
 */
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import { resolve } from "path";
import { createHash } from "crypto";
import YAML from "yaml";
import { queryCaseSchema } from "../harness/schema";
import { mulberry32 } from "../harness/statistics";
import type { QueryCase } from "../harness/types";

const BENCHMARK_ROOT = resolve(import.meta.dirname ?? new URL(".", import.meta.url).pathname, "..");
const RESULTS_ROOT = resolve(BENCHMARK_ROOT, "results");
const RUN_ID = "synthetic-demo-001";
const RAW_DIR = resolve(RESULTS_ROOT, "raw", RUN_ID);
const RAW_PATH = resolve(RAW_DIR, "runs.jsonl");
const JUDGE_PATH = resolve(RAW_DIR, "judges.jsonl");
const META_PATH = resolve(RAW_DIR, "meta.json");
mkdirSync(RAW_DIR, { recursive: true });

const modelsYaml = YAML.parse(readFileSync(resolve(BENCHMARK_ROOT, "config", "models.yaml"), "utf-8"));
const models = modelsYaml.models as Array<{ tag: string; tier: "light" | "medium" | "heavy" }>;
const queries: QueryCase[] = readFileSync(resolve(BENCHMARK_ROOT, "test_set", "queries.jsonl"), "utf-8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => queryCaseSchema.parse(JSON.parse(l)));

const rng = mulberry32(1234567);

// Per-tier synthetic generators.
const TIER_PROFILE = {
  light: { meanTtft: 0.45, meanTotal: 2.4, sigmaTtft: 0.15, sigmaTotal: 1.2, tps: 95, basePass: 0.58 },
  medium: { meanTtft: 0.9, meanTotal: 5.0, sigmaTtft: 0.3, sigmaTotal: 1.8, tps: 55, basePass: 0.72 },
  heavy: { meanTtft: 1.6, meanTotal: 9.5, sigmaTtft: 0.6, sigmaTotal: 2.5, tps: 28, basePass: 0.82 },
};

function gauss(mean: number, sigma: number): number {
  // Box-Muller using deterministic rng.
  const u1 = Math.max(1e-9, rng());
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(0.05, mean + sigma * z);
}

function nowIso(offsetMs: number): string {
  return new Date(Date.parse("2026-04-22T00:00:00Z") + offsetMs).toISOString();
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

const queriesHash = sha256(readFileSync(resolve(BENCHMARK_ROOT, "test_set", "queries.jsonl"), "utf-8"));
const multiTurnHash = sha256(
  readFileSync(resolve(BENCHMARK_ROOT, "test_set", "multi_turn_sequences.jsonl"), "utf-8"),
);
const rubricHash = sha256(readFileSync(resolve(BENCHMARK_ROOT, "config", "judge.yaml"), "utf-8"));

// Meta
const meta = {
  run_id: RUN_ID,
  started_utc: nowIso(0),
  finished_utc: nowIso(1 * 3600 * 1000),
  cli_args: ["--synthetic", "--runs", "3"],
  git_commit: "SYNTHETIC-DEMO",
  git_dirty: false,
  hardware: { chip: "Apple M5 Max (synthetic)", ram_gb: 128, wired_limit_mb: 122880, macos: "26.4.1" },
  ollama_version: "ollama version 0.21.0 (synthetic)",
  models_run: models.map((m) => m.tag),
  models_skipped: [],
  queries_run: queries.map((q) => q.id),
  runs_per_query: 3,
  judge_model: "claude-opus",
  system_prompt_hash: sha256("(synthetic-system-prompt)"),
  config_snapshot: { note: "synthetic" },
  dataset_hashes: {
    queries: queriesHash,
    multi_turn: multiTurnHash,
    judge_rubric: rubricHash,
    system_prompt: sha256("(synthetic-system-prompt)"),
  },
};
writeFileSync(META_PATH, `${JSON.stringify(meta, null, 2)}\n`);
writeFileSync(RAW_PATH, "");
writeFileSync(JUDGE_PATH, "");

let tOffset = 0;

for (const model of models) {
  const profile = TIER_PROFILE[model.tier];
  for (let runNumber = 0; runNumber <= 3; runNumber += 1) {
    for (const query of queries) {
      const cold = runNumber === 0;
      const ttft = cold ? gauss(profile.meanTtft * 3, profile.sigmaTtft * 2) : gauss(profile.meanTtft, profile.sigmaTtft);
      const totalS = cold ? gauss(profile.meanTotal * 1.4, profile.sigmaTotal) : gauss(profile.meanTotal, profile.sigmaTotal);
      const tps = Math.max(5, gauss(profile.tps, profile.tps * 0.12));
      const withinLatency = totalS <= 10;
      // Synthetic pass logic: base pass rate attenuated by quality-proxy randomness and latency gate.
      const qualityPass = rng() < (cold ? profile.basePass * 0.3 : profile.basePass);
      const expectedPhiBlock = query.expected.mustPhiBlock === true;
      const rolledPhiBlock = expectedPhiBlock; // synthetic: always correctly blocks
      const passProgrammatic = !expectedPhiBlock && withinLatency && qualityPass;
      const passSource = expectedPhiBlock
        ? []
        : [{ title: query.expected.sourceMustInclude?.[0] ?? "Synthetic Source", similarity: 0.7 + rng() * 0.25 }];
      const retrievedSources = passSource.map((s) => ({ ...s, content: "(synthetic source content)" }));
      const responseText = expectedPhiBlock ? "" : passProgrammatic ? "(synthetic passing response with [Source: Contrast Reaction Management Protocol] citation)" : "(synthetic weak response)";
      const errorFlag = expectedPhiBlock ? false : false;
      const stageMs = {
        phi_gate: 2 + rng() * 6,
        domain_classification: 30 + rng() * 60,
        embedding: 40 + rng() * 80,
        retrieval: 60 + rng() * 80,
        prompt_build: 2 + rng() * 4,
        llm_generation: totalS * 1000 * 0.88,
        response_validation: 5 + rng() * 15,
      };
      const row = {
        run_id: RUN_ID,
        run_number: runNumber,
        model_tag: model.tag,
        model_tier: model.tier,
        query_id: query.id,
        query_category: query.category,
        timestamp_utc: nowIso((tOffset += 100)),
        ttft_s: expectedPhiBlock ? null : ttft,
        total_time_s: expectedPhiBlock ? 0.05 : totalS,
        prompt_eval_time_s: expectedPhiBlock ? null : 0.2 + rng() * 0.3,
        eval_time_s: expectedPhiBlock ? null : totalS * 0.75,
        tokens_generated: expectedPhiBlock ? null : Math.round(tps * totalS * 0.75),
        tokens_per_second: expectedPhiBlock ? null : tps,
        cold,
        stage_timings_ms: stageMs,
        response_text: responseText,
        sources_returned: passSource,
        retrieved_source_texts: retrievedSources,
        emergency_detected: /emergency|stat|anaphyl/i.test(query.query),
        route_used: expectedPhiBlock ? null : query.category === "factual" || query.category === "calibration" ? "KNOWLEDGE" : query.category === "protocol" || query.category === "dose_critical" ? "PROTOCOL" : "HYBRID",
        programmatic: {
          produced_output: !expectedPhiBlock && responseText.length > 0,
          within_10s_latency: expectedPhiBlock ? true : withinLatency,
          no_dangerous_output: true,
          passed_refusal: query.category === "refusal" ? (passProgrammatic ? true : false) : null,
          passed_hedging: query.category === "differential" || query.expected.mustHedge ? (passProgrammatic ? true : false) : null,
          must_include_all: query.expected.mustInclude ? passProgrammatic : null,
          must_include_any: query.expected.mustIncludeAny ? passProgrammatic : null,
          must_not_include_none: query.expected.mustNotInclude ? passProgrammatic : null,
          must_cite: query.expected.mustCite ? passProgrammatic : null,
          must_not_refuse: query.expected.mustNotRefuse ? passProgrammatic : null,
          length_ok: query.expected.minResponseChars || query.expected.maxResponseChars ? true : null,
        },
        judge_scores: null,
        backup_judge_scores: null,
        error_flag: false,
        error_kind: expectedPhiBlock ? "phi_block" : null,
        error_message: null,
        git_commit: meta.git_commit,
        ollama_version: meta.ollama_version,
        ollama_model_digest: `sha256-synthetic-${model.tag}`,
        ollama_model_quant: "Q4_K_M",
        hardware_fingerprint: "synthetic",
        seed: 1234567,
        temperature: 0,
        max_tokens: 1024,
      };
      appendFileSync(RAW_PATH, `${JSON.stringify(row)}\n`);

      // Judge sidecar for warm, non-PHI, non-cold rows.
      if (!cold && !expectedPhiBlock) {
        const acc = Math.max(0, Math.min(3, Math.round(qualityPass ? 2 + rng() : 1 + rng() * 0.8))) as 0 | 1 | 2 | 3;
        const record = {
          run_id: RUN_ID,
          model_tag: model.tag,
          query_id: query.id,
          run_number: runNumber,
          scored_utc: nowIso((tOffset += 20)),
          judge_scores: {
            accuracy: acc,
            completeness: Math.max(0, Math.min(3, acc + (rng() < 0.3 ? -1 : 0))) as 0 | 1 | 2 | 3,
            format: Math.max(0, Math.min(3, acc + (rng() < 0.4 ? 0 : -1))) as 0 | 1 | 2 | 3,
            safety: Math.max(0, Math.min(3, acc + 1 - Math.round(rng()))) as 0 | 1 | 2 | 3,
            hallucination: Math.max(0, Math.min(3, acc + Math.round(rng() * 0.4))) as 0 | 1 | 2 | 3,
            rationale: "synthetic",
            judge_model: "claude-opus",
            judge_call_duration_s: 0.8 + rng() * 0.5,
          },
          backup_judge_scores:
            rng() < 0.2
              ? {
                  accuracy: Math.max(0, Math.min(3, acc + (rng() < 0.7 ? 0 : rng() < 0.5 ? -1 : 1))) as 0 | 1 | 2 | 3,
                  completeness: acc,
                  format: acc,
                  safety: acc,
                  hallucination: acc,
                  rationale: "synthetic-backup",
                  judge_model: "gpt-5.2",
                  judge_call_duration_s: 1.1 + rng() * 0.4,
                }
              : null,
          error: null,
        };
        appendFileSync(JUDGE_PATH, `${JSON.stringify(record)}\n`);
      }
    }
  }
}

const runCount = readFileSync(RAW_PATH, "utf-8").split("\n").filter((l) => l.trim()).length;
const judgeCount = readFileSync(JUDGE_PATH, "utf-8").split("\n").filter((l) => l.trim()).length;
console.log(`Synthetic run written to ${RAW_DIR}`);
console.log(`Rows: ${runCount} runs, ${judgeCount} judge records`);
