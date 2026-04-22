#!/usr/bin/env npx tsx

import { runBenchmark } from "../harness/runner";
import type { BenchmarkRunOptions } from "../harness/types";

function readFlag(flag: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return fallback;
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const options: BenchmarkRunOptions = {
    modelsSpec: readFlag("--models", "all")!,
    runs: Number(readFlag("--runs", "3")),
    queriesSpec: readFlag("--queries", "all")!,
    dryRun: process.argv.includes("--dry-run"),
    skipJudge: process.argv.includes("--skip-judge"),
    outputDir: readFlag("--output-dir"),
    resumeRunId: readFlag("--resume"),
    seed: Number(readFlag("--seed", String(Math.floor(Math.random() * 1_000_000)))),
    verbose: process.argv.includes("--verbose"),
  };

  const result = await runBenchmark(options);
  console.log(`Benchmark run ${result.runId} complete.`);
  console.log(`Raw rows: ${result.rawPath}`);
  console.log(`Meta: ${result.metaPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
