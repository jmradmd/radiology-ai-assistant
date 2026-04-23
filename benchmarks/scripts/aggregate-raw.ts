#!/usr/bin/env npx tsx

import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { aggregateRuns } from "../harness/aggregator";
import {
  DEFAULT_RESULTS_ROOT,
  buildQueryLookup,
  buildStandaloneUnits,
  loadExistingRuns,
  parseJsonlQueries,
} from "../harness/runner";
import { buildJudgeIndex, loadJudgeRecords } from "../harness/judge-store";

function readFlag(flag: string): string {
  const index = process.argv.indexOf(flag);
  if (index < 0 || !process.argv[index + 1]) {
    throw new Error(`Missing required flag ${flag}`);
  }
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const runId = readFlag("--run-id");
  const rawPath = resolve(DEFAULT_RESULTS_ROOT, "raw", runId, "runs.jsonl");
  const judgePath = resolve(DEFAULT_RESULTS_ROOT, "raw", runId, "judges.jsonl");
  const runs = loadExistingRuns(rawPath);
  const judgeIndex = buildJudgeIndex(loadJudgeRecords(judgePath));
  const { standalone, multiTurn } = parseJsonlQueries();
  const queryLookup = buildQueryLookup([...buildStandaloneUnits(standalone), ...multiTurn]);
  const aggregated = aggregateRuns(runs, queryLookup, judgeIndex);
  const outputDir = resolve(DEFAULT_RESULTS_ROOT, "aggregated", runId);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "summary.csv"), aggregated.summaryCsv);
  writeFileSync(resolve(outputDir, "per-query.csv"), aggregated.perQueryCsv);
  console.log(
    `Aggregated ${runs.length} raw rows (${judgeIndex.size} judged) into ${outputDir}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
