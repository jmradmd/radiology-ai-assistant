#!/usr/bin/env npx tsx
/**
 * Build the stratified 10% reliability sample (~187 rows) and prepare
 * per-row judge prompts for LLM-subagent re-judging.
 *
 * Sampling: stratified by (model_tag × category), deterministic seed.
 *   - target total: 187 rows (10% of 1863)
 *   - cells iterated in (model_tag, category) order
 *   - within cell: deterministic picker using mulberry32(seed=42)
 */
import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import {
  DEFAULT_RESULTS_ROOT,
  buildQueryLookup,
  buildStandaloneUnits,
  loadExistingRuns,
  parseJsonlQueries,
} from "../harness/runner";
import { buildLlmJudgePrompt } from "../harness/llm-judge";
import { mulberry32 } from "../harness/statistics";
import type { RawRun } from "../harness/types";

function readFlag(flag: string, fallback: string | null = null): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx < 0 || !process.argv[idx + 1]) return fallback;
  return process.argv[idx + 1];
}

function shuffleInPlace<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

async function main(): Promise<void> {
  const runId = readFlag("--run-id")!;
  const targetTotal = Number(readFlag("--total", "187"));
  const batchSize = Number(readFlag("--batch-size", "15"));
  const seed = Number(readFlag("--seed", "42"));

  const rawPath = resolve(DEFAULT_RESULTS_ROOT, "raw", runId, "runs.jsonl");
  const runs = loadExistingRuns(rawPath);
  const { standalone, multiTurn } = parseJsonlQueries();
  const queryLookup = buildQueryLookup([...buildStandaloneUnits(standalone), ...multiTurn]);

  // Keep only warm, non-error, non-PHI rows
  const eligible = runs.filter((r) => {
    if (r.cold || r.error_flag) return false;
    const q = queryLookup.get(r.query_id);
    if (!q) return false;
    if (q.expected.mustPhiBlock) return false;
    return true;
  });

  // Stratify by (model × category)
  const cells = new Map<string, RawRun[]>();
  for (const r of eligible) {
    const q = queryLookup.get(r.query_id)!;
    const key = `${r.model_tag}::${q.category}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key)!.push(r);
  }

  // Proportional allocation per cell
  const total = eligible.length;
  const allocations: Array<{ key: string; n: number; cell: RawRun[] }> = [];
  let allocatedSum = 0;
  const keys = [...cells.keys()].sort();
  for (const key of keys) {
    const cell = cells.get(key)!;
    const frac = cell.length / total;
    const target = Math.max(1, Math.round(frac * targetTotal));
    allocations.push({ key, n: Math.min(target, cell.length), cell });
    allocatedSum += Math.min(target, cell.length);
  }
  // Trim if over; add if under — deterministic by largest cells
  if (allocatedSum > targetTotal) {
    const over = allocatedSum - targetTotal;
    // take from largest cells first
    const sorted = [...allocations].sort((a, b) => b.cell.length - a.cell.length);
    for (let i = 0; i < over; i += 1) {
      sorted[i % sorted.length].n = Math.max(1, sorted[i % sorted.length].n - 1);
    }
  } else if (allocatedSum < targetTotal) {
    const under = targetTotal - allocatedSum;
    const sorted = [...allocations].sort((a, b) => b.cell.length - a.cell.length);
    for (let i = 0; i < under; i += 1) {
      const slot = sorted[i % sorted.length];
      if (slot.n < slot.cell.length) slot.n += 1;
    }
  }

  const rng = mulberry32(seed);
  const sampled: RawRun[] = [];
  for (const alloc of allocations) {
    const pool = [...alloc.cell];
    shuffleInPlace(pool, rng);
    for (let i = 0; i < alloc.n; i += 1) sampled.push(pool[i]);
  }

  console.log(`Sampled ${sampled.length} rows (target ${targetTotal}) from ${eligible.length} eligible.`);

  // Per-model × per-category breakdown
  const breakdown = new Map<string, number>();
  for (const r of sampled) {
    const q = queryLookup.get(r.query_id)!;
    breakdown.set(`${r.model_tag}::${q.category}`, (breakdown.get(`${r.model_tag}::${q.category}`) ?? 0) + 1);
  }

  // Build prompt batches
  const outDir = resolve(DEFAULT_RESULTS_ROOT, "raw", runId, "reliability");
  mkdirSync(outDir, { recursive: true });

  type RowTask = {
    idx: number;
    model_tag: string;
    query_id: string;
    run_number: number;
    category: string;
    prompt: string;
  };
  const tasks: RowTask[] = sampled.map((r, idx) => {
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
        maxSourceChars: 1200,
      }),
    };
  });

  const manifest = {
    run_id: runId,
    seed,
    n_sampled: sampled.length,
    target_total: targetTotal,
    eligible_total: eligible.length,
    breakdown: Object.fromEntries(breakdown),
    tasks: tasks.map(({ idx, model_tag, query_id, run_number, category }) => ({
      idx,
      model_tag,
      query_id,
      run_number,
      category,
    })),
  };
  writeFileSync(resolve(outDir, "sample-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  // Split tasks into batches for subagent processing
  const batches: RowTask[][] = [];
  for (let i = 0; i < tasks.length; i += batchSize) {
    batches.push(tasks.slice(i, i + batchSize));
  }

  for (let bi = 0; bi < batches.length; bi += 1) {
    const batch = batches[bi];
    const file = resolve(outDir, `batch-${String(bi + 1).padStart(2, "0")}.json`);
    writeFileSync(file, `${JSON.stringify(batch, null, 2)}\n`);
  }

  console.log(`Wrote ${batches.length} batch files (size ${batchSize}) to ${outDir}`);
  console.log(`Manifest: ${resolve(outDir, "sample-manifest.json")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
