#!/usr/bin/env npx tsx
/**
 * Offline rubric judge.
 *
 * Drop-in replacement for run-judge.ts when cloud LLM access is unavailable.
 * Uses harness/heuristic-judge.ts to apply judge.yaml's rubric deterministically
 * and writes records that pass judge-store.ts's schema, so the downstream
 * aggregator and report generator run unchanged.
 */
import { resolve } from "path";
import {
  DEFAULT_RESULTS_ROOT,
  buildQueryLookup,
  buildStandaloneUnits,
  loadExistingRuns,
  parseJsonlQueries,
} from "../harness/runner";
import {
  appendJudgeRecord,
  buildJudgeIndex,
  judgeKey,
  loadJudgeRecords,
} from "../harness/judge-store";
import { scoreRunHeuristic, toJudgeScoreSet } from "../harness/heuristic-judge";
import { hashFraction } from "../harness/metrics";

function readFlag(flag: string): string {
  const idx = process.argv.indexOf(flag);
  if (idx < 0 || !process.argv[idx + 1]) {
    throw new Error(`Missing required flag ${flag}`);
  }
  return process.argv[idx + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function maybeFlag(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx < 0 || !process.argv[idx + 1]) return null;
  return process.argv[idx + 1];
}

const PRIMARY_JUDGE_MODEL = "heuristic-rubric-v1";
const BACKUP_JUDGE_MODEL = "heuristic-rubric-v1-strict";

async function main(): Promise<void> {
  const runId = readFlag("--run-id");
  const modelFilter = maybeFlag("--model");
  const rawPath = resolve(DEFAULT_RESULTS_ROOT, "raw", runId, "runs.jsonl");
  const judgePath = resolve(DEFAULT_RESULTS_ROOT, "raw", runId, "judges.jsonl");
  const runs = loadExistingRuns(rawPath);
  const { standalone, multiTurn } = parseJsonlQueries();
  const queryLookup = buildQueryLookup([...buildStandaloneUnits(standalone), ...multiTurn]);
  const alreadyJudged = buildJudgeIndex(loadJudgeRecords(judgePath));
  const dryRun = hasFlag("--dry-run");

  let scored = 0;
  let skippedCold = 0;
  let skippedError = 0;
  let skippedPhi = 0;
  let skippedExisting = 0;
  let skippedFilter = 0;
  let backupSamples = 0;

  for (const row of runs) {
    if (modelFilter && row.model_tag !== modelFilter) {
      skippedFilter += 1;
      continue;
    }
    if (row.cold) {
      skippedCold += 1;
      continue;
    }
    const query = queryLookup.get(row.query_id);
    if (!query) {
      skippedError += 1;
      continue;
    }
    if (query.expected.mustPhiBlock) {
      skippedPhi += 1;
      continue;
    }
    if (row.error_flag) {
      skippedError += 1;
      continue;
    }
    const key = judgeKey(row);
    if (alreadyJudged.has(key)) {
      skippedExisting += 1;
      continue;
    }

    if (dryRun) {
      scored += 1;
      continue;
    }

    const startedAt = Date.now();
    const primaryRubric = scoreRunHeuristic({ run: row, query }, "primary");
    const primaryDuration = (Date.now() - startedAt) / 1000;
    const needsBackup = hashFraction(row.query_id) < 0.2;
    const backupRubric = needsBackup
      ? scoreRunHeuristic({ run: row, query }, "backup")
      : null;
    const backupDuration = needsBackup ? (Date.now() - startedAt) / 1000 : 0;

    const record = {
      run_id: row.run_id,
      model_tag: row.model_tag,
      query_id: row.query_id,
      run_number: row.run_number,
      scored_utc: new Date().toISOString(),
      judge_scores: toJudgeScoreSet(primaryRubric, PRIMARY_JUDGE_MODEL, primaryDuration),
      backup_judge_scores: backupRubric
        ? toJudgeScoreSet(backupRubric, BACKUP_JUDGE_MODEL, backupDuration)
        : null,
      error: null as null | { kind: "judge_error"; message: string },
    };
    appendJudgeRecord(judgePath, record);
    scored += 1;
    if (needsBackup) backupSamples += 1;
  }

  console.log(
    `Offline judge for run ${runId}: scored=${scored} backup_sampled=${backupSamples} ` +
      `(filtered=${skippedFilter} cold=${skippedCold} phi=${skippedPhi} error=${skippedError} existing=${skippedExisting})`,
  );
  console.log(`Judge sidecar: ${judgePath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
