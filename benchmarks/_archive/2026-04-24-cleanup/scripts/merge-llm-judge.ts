#!/usr/bin/env npx tsx
/**
 * Consolidate per-batch LLM-judged JSONL outputs into a single judges sidecar
 * (judges.jsonl.v2.llm) in the format the aggregator expects.
 *
 * Strategy: for every warm non-error non-PHI row in runs.jsonl, look up the
 * LLM judgment by (model_tag, query_id, run_number) in the merged per-batch
 * output. If missing (batch didn't complete), fall back to the rule-based
 * v2 judge score from judges.jsonl.v2.
 *
 * Records a coverage manifest so the report can honestly describe which
 * rows were judged by which method.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { resolve } from "path";
import { DEFAULT_RESULTS_ROOT } from "../harness/runner";
import { appendJudgeRecord } from "../harness/judge-store";

const JUDGE_MODEL_LLM = "claude-opus-4-7-llm-subagent";
const JUDGE_MODEL_RULE = "claude-opus-4-7-rubric-v2";

function readFlag(flag: string): string {
  const idx = process.argv.indexOf(flag);
  if (idx < 0 || !process.argv[idx + 1]) throw new Error(`Missing ${flag}`);
  return process.argv[idx + 1];
}

interface LlmJudgeRow {
  idx: number;
  model_tag: string;
  query_id: string;
  run_number: number;
  accuracy: number;
  completeness: number;
  safety: number;
  hallucination: number;
  format: number;
  rationale: string;
}

async function main(): Promise<void> {
  const runId = readFlag("--run-id");
  const runDir = resolve(DEFAULT_RESULTS_ROOT, "raw", runId);
  const batchDir = resolve(runDir, "full-judge");
  const outDir = resolve(batchDir, "out");
  const ruleJudgePath = resolve(runDir, "judges.jsonl.v2");
  const mergedPath = resolve(runDir, "judges.jsonl.v2.merged");

  if (existsSync(mergedPath)) {
    // remove before append-only writes
    writeFileSync(mergedPath, "");
  }

  const llmByKey = new Map<string, LlmJudgeRow>();
  const batchFiles = readdirSync(outDir).filter((f) => f.endsWith(".jsonl")).sort();
  let llmRowsLoaded = 0;
  for (const f of batchFiles) {
    const content = readFileSync(resolve(outDir, f), "utf-8");
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line) as LlmJudgeRow;
        const key = `${row.model_tag}::${row.query_id}::${row.run_number}`;
        llmByKey.set(key, row);
        llmRowsLoaded += 1;
      } catch (e) {
        // skip malformed
      }
    }
  }

  const ruleContent = readFileSync(ruleJudgePath, "utf-8");
  const ruleByKey = new Map<string, any>();
  for (const line of ruleContent.split("\n")) {
    if (!line.trim()) continue;
    const j = JSON.parse(line);
    ruleByKey.set(`${j.model_tag}::${j.query_id}::${j.run_number}`, j);
  }

  let fromLlm = 0;
  let fromRule = 0;
  const totalKeys = [...ruleByKey.keys()];
  for (const key of totalKeys) {
    const llm = llmByKey.get(key);
    const rule = ruleByKey.get(key);
    if (!rule) continue;
    const source = llm ? "llm" : "rule";
    const scores = llm
      ? {
          accuracy: llm.accuracy,
          completeness: llm.completeness,
          safety: llm.safety,
          hallucination: llm.hallucination,
          format: llm.format,
          rationale: llm.rationale,
          judge_model: JUDGE_MODEL_LLM,
          judge_call_duration_s: 0,
        }
      : rule.judge_scores;
    const record = {
      run_id: rule.run_id,
      model_tag: rule.model_tag,
      query_id: rule.query_id,
      run_number: rule.run_number,
      scored_utc: new Date().toISOString(),
      judge_scores: scores,
      backup_judge_scores: null,
      error: null,
    };
    appendJudgeRecord(mergedPath, record);
    if (source === "llm") fromLlm += 1;
    else fromRule += 1;
  }

  const coverage = {
    run_id: runId,
    total_records: fromLlm + fromRule,
    from_llm: fromLlm,
    from_rule: fromRule,
    llm_fraction: fromLlm / (fromLlm + fromRule || 1),
    batches_loaded: batchFiles.length,
    llm_rows_loaded: llmRowsLoaded,
  };
  writeFileSync(resolve(runDir, "judge-coverage.json"), `${JSON.stringify(coverage, null, 2)}\n`);

  console.log(`Merged judges: LLM=${fromLlm}, rule-based fallback=${fromRule} (${(coverage.llm_fraction * 100).toFixed(1)}% LLM)`);
  console.log(`Output: ${mergedPath}`);
  console.log(`Coverage: ${resolve(runDir, "judge-coverage.json")}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
