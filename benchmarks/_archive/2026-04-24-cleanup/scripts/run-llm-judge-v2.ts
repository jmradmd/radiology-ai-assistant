#!/usr/bin/env npx tsx
/**
 * Structured LLM-judge v2 runner.
 *
 * Produces judges.jsonl.v2 from runs.jsonl using benchmarks/harness/llm-judge.ts.
 * Keeps judges.jsonl (v1 heuristic) intact as an audit trail.
 *
 * Filters applied:
 *   - warm rows only (cold=false)
 *   - error_flag=false
 *   - not mustPhiBlock (PHI-expected queries aren't judged)
 */
import { resolve } from "path";
import {
  DEFAULT_RESULTS_ROOT,
  buildQueryLookup,
  buildStandaloneUnits,
  loadExistingRuns,
  parseJsonlQueries,
} from "../harness/runner";
import { appendJudgeRecord, buildJudgeIndex, judgeKey, loadJudgeRecords } from "../harness/judge-store";
import { judgeRun, judgeReportToScoreSet } from "../harness/llm-judge";

const JUDGE_MODEL_TAG = "claude-opus-4-7-rubric-v2";

function readFlag(flag: string): string {
  const idx = process.argv.indexOf(flag);
  if (idx < 0 || !process.argv[idx + 1]) throw new Error(`Missing required flag ${flag}`);
  return process.argv[idx + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

async function main(): Promise<void> {
  const runId = readFlag("--run-id");
  const rawPath = resolve(DEFAULT_RESULTS_ROOT, "raw", runId, "runs.jsonl");
  const judgePathV2 = resolve(DEFAULT_RESULTS_ROOT, "raw", runId, "judges.jsonl.v2");
  const runs = loadExistingRuns(rawPath);
  const { standalone, multiTurn } = parseJsonlQueries();
  const queryLookup = buildQueryLookup([...buildStandaloneUnits(standalone), ...multiTurn]);
  const alreadyJudged = buildJudgeIndex(loadJudgeRecords(judgePathV2));
  const dryRun = hasFlag("--dry-run");

  let scored = 0;
  let skippedCold = 0;
  let skippedError = 0;
  let skippedPhi = 0;
  let skippedExisting = 0;

  for (const row of runs) {
    if (row.cold) { skippedCold += 1; continue; }
    if (row.error_flag) { skippedError += 1; continue; }
    const query = queryLookup.get(row.query_id);
    if (!query) { skippedError += 1; continue; }
    if (query.expected.mustPhiBlock) { skippedPhi += 1; continue; }
    const key = judgeKey(row);
    if (alreadyJudged.has(key)) { skippedExisting += 1; continue; }

    if (dryRun) { scored += 1; continue; }

    const started = Date.now();
    const report = judgeRun({ run: row, query });
    const durationS = (Date.now() - started) / 1000;

    appendJudgeRecord(judgePathV2, {
      run_id: row.run_id,
      model_tag: row.model_tag,
      query_id: row.query_id,
      run_number: row.run_number,
      scored_utc: new Date().toISOString(),
      judge_scores: judgeReportToScoreSet(report, JUDGE_MODEL_TAG, durationS),
      backup_judge_scores: null,
      error: null,
    });
    scored += 1;
  }

  console.log(
    `v2 judge for run ${runId}: scored=${scored} ` +
    `(cold=${skippedCold} phi=${skippedPhi} error=${skippedError} existing=${skippedExisting})`,
  );
  console.log(`Judge sidecar: ${judgePathV2}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
