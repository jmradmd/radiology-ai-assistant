#!/usr/bin/env npx tsx

import { resolve } from "path";
import {
  DEFAULT_RESULTS_ROOT,
  buildQueryLookup,
  buildStandaloneUnits,
  loadConfig,
  loadExistingRuns,
  parseJsonlQueries,
} from "../harness/runner";
import { scoreBenchmarkResponse } from "../harness/judge";
import {
  appendJudgeRecord,
  buildJudgeIndex,
  judgeKey,
  loadJudgeRecords,
} from "../harness/judge-store";

function readFlag(flag: string): string {
  const index = process.argv.indexOf(flag);
  if (index < 0 || !process.argv[index + 1]) {
    throw new Error(`Missing required flag ${flag}`);
  }
  return process.argv[index + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

async function main(): Promise<void> {
  const runId = readFlag("--run-id");
  const rawPath = resolve(DEFAULT_RESULTS_ROOT, "raw", runId, "runs.jsonl");
  const judgePath = resolve(DEFAULT_RESULTS_ROOT, "raw", runId, "judges.jsonl");
  const runs = loadExistingRuns(rawPath);
  const { judge, settings } = loadConfig();
  const { standalone, multiTurn } = parseJsonlQueries();
  const queryLookup = buildQueryLookup([...buildStandaloneUnits(standalone), ...multiTurn]);
  const alreadyJudged = buildJudgeIndex(loadJudgeRecords(judgePath));
  const dryRun = hasFlag("--dry-run");

  let scored = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of runs) {
    const query = queryLookup.get(row.query_id);
    const key = judgeKey(row);
    if (!query || row.cold || row.error_flag || query.expected.mustPhiBlock || alreadyJudged.has(key)) {
      skipped += 1;
      continue;
    }

    if (dryRun) {
      console.log(`[dry-run] would judge ${key}`);
      scored += 1;
      continue;
    }

    try {
      const judged = await scoreBenchmarkResponse({
        queryId: row.query_id,
        query: query.query,
        expected: query.expected,
        sources: row.retrieved_source_texts,
        responseText: row.response_text,
        judgeConfig: judge,
        maxSourceChars: settings.judge_source_char_limit,
      });

      const record = {
        run_id: row.run_id,
        model_tag: row.model_tag,
        query_id: row.query_id,
        run_number: row.run_number,
        scored_utc: new Date().toISOString(),
        judge_scores: judged.judge_scores,
        backup_judge_scores: judged.backup_judge_scores,
        error:
          judged.judge_scores.accuracy === null
            ? {
                kind: "judge_error" as const,
                message: judged.judge_scores.rationale ?? "judge returned null scores",
              }
            : null,
      };
      appendJudgeRecord(judgePath, record);
      scored += 1;
      if (record.error) failed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendJudgeRecord(judgePath, {
        run_id: row.run_id,
        model_tag: row.model_tag,
        query_id: row.query_id,
        run_number: row.run_number,
        scored_utc: new Date().toISOString(),
        judge_scores: {
          accuracy: null,
          completeness: null,
          format: null,
          safety: null,
          hallucination: null,
          rationale: message.slice(0, 500),
          judge_model: judge.judge_model,
          judge_call_duration_s: null,
        },
        backup_judge_scores: null,
        error: { kind: "judge_error", message: message.slice(0, 500) },
      });
      scored += 1;
      failed += 1;
    }
  }

  console.log(
    `Judge complete for run ${runId}: scored=${scored} skipped=${skipped} failed=${failed}`,
  );
  console.log(`Judge sidecar: ${judgePath}`);
  console.log("runs.jsonl was NOT modified.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
