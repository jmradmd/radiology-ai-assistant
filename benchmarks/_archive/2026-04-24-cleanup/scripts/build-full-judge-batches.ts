#!/usr/bin/env npx tsx
/**
 * Build per-batch judge prompts for the FULL 1863-row LLM judge pass.
 *
 * Each batch holds up to --batch-size rows; subagents consume one batch and
 * emit JSONL judgments. Deterministic ordering by (model_tag, query_id, run_number).
 */
import { mkdirSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import {
  DEFAULT_RESULTS_ROOT,
  buildQueryLookup,
  buildStandaloneUnits,
  loadExistingRuns,
  parseJsonlQueries,
} from "../harness/runner";
import { buildLlmJudgePrompt } from "../harness/llm-judge";

function readFlag(flag: string, fallback: string | null = null): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx < 0 || !process.argv[idx + 1]) return fallback;
  return process.argv[idx + 1];
}

async function main(): Promise<void> {
  const runId = readFlag("--run-id")!;
  const batchSize = Number(readFlag("--batch-size", "50"));

  const rawPath = resolve(DEFAULT_RESULTS_ROOT, "raw", runId, "runs.jsonl");
  const runs = loadExistingRuns(rawPath);
  const { standalone, multiTurn } = parseJsonlQueries();
  const queryLookup = buildQueryLookup([...buildStandaloneUnits(standalone), ...multiTurn]);

  const eligible = runs.filter((r) => {
    if (r.cold || r.error_flag) return false;
    const q = queryLookup.get(r.query_id);
    if (!q) return false;
    if (q.expected.mustPhiBlock) return false;
    return true;
  });

  eligible.sort((a, b) => {
    if (a.model_tag !== b.model_tag) return a.model_tag.localeCompare(b.model_tag);
    if (a.query_id !== b.query_id) return a.query_id.localeCompare(b.query_id);
    return a.run_number - b.run_number;
  });

  const tasks = eligible.map((r, idx) => {
    const q = queryLookup.get(r.query_id)!;
    return {
      idx,
      model_tag: r.model_tag,
      query_id: r.query_id,
      run_number: r.run_number,
      category: q.category,
      prompt: buildLlmJudgePrompt({
        query: q.query,
        category: q.category,
        expected: q.expected,
        response: r.response_text,
        sources: r.retrieved_source_texts,
        maxSourceChars: 900,
      }),
    };
  });

  const outDir = resolve(DEFAULT_RESULTS_ROOT, "raw", runId, "full-judge");
  mkdirSync(outDir, { recursive: true });

  const batches: (typeof tasks)[] = [];
  for (let i = 0; i < tasks.length; i += batchSize) batches.push(tasks.slice(i, i + batchSize));

  for (let i = 0; i < batches.length; i += 1) {
    const filePath = resolve(outDir, `batch-${String(i + 1).padStart(3, "0")}.json`);
    writeFileSync(filePath, `${JSON.stringify(batches[i], null, 2)}\n`);
  }

  writeFileSync(
    resolve(outDir, "manifest.json"),
    `${JSON.stringify({
      run_id: runId,
      total_tasks: tasks.length,
      batch_size: batchSize,
      n_batches: batches.length,
    }, null, 2)}\n`,
  );

  console.log(`${tasks.length} tasks in ${batches.length} batches (size ${batchSize}) -> ${outDir}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
