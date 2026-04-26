#!/usr/bin/env npx tsx
/**
 * Compute Cohen's κ between the three independent judge passes on the
 * reliability sample and emit judge-reliability.json.
 *
 * Pass 1 = v2 rule-based judge (deterministic codification)
 * Pass 2 = LLM subagent reasoning, variant A
 * Pass 3 = LLM subagent reasoning, variant B
 *
 * Per-dimension κ: quadratic-weighted for ordinal 0-3 scores, plus the
 * standard unweighted κ, reported side-by-side.
 *
 * Overall κ: mean of the three pairwise weighted κ values across dimensions.
 * Gate: overall κ ≥ 0.6 AND every single dimension κ ≥ 0.5 (per task spec).
 */
import { readFileSync, writeFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { DEFAULT_RESULTS_ROOT } from "../harness/runner";

interface ReliabilityRow {
  idx: number;
  model_tag: string;
  query_id: string;
  run_number: number;
  category?: string;
  accuracy: number;
  completeness: number;
  safety: number;
  hallucination: number;
  format: number;
}

function readFlag(flag: string): string {
  const idx = process.argv.indexOf(flag);
  if (idx < 0 || !process.argv[idx + 1]) throw new Error(`Missing required flag ${flag}`);
  return process.argv[idx + 1];
}

function readJsonlDir(dir: string): ReliabilityRow[] {
  const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort();
  const rows: ReliabilityRow[] = [];
  for (const f of files) {
    const path = resolve(dir, f);
    const content = readFileSync(path, "utf-8");
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      rows.push(JSON.parse(line) as ReliabilityRow);
    }
  }
  return rows;
}

// Standard unweighted Cohen's kappa on integer labels {0,1,2,3}.
function cohensKappa(pairs: Array<[number, number]>, labelCount = 4): number | null {
  if (pairs.length === 0) return null;
  let observed = 0;
  const primaryTotals = new Array<number>(labelCount).fill(0);
  const secondaryTotals = new Array<number>(labelCount).fill(0);
  for (const [a, b] of pairs) {
    if (a === b) observed += 1;
    primaryTotals[a] += 1;
    secondaryTotals[b] += 1;
  }
  const n = pairs.length;
  const po = observed / n;
  const pe = primaryTotals.reduce((s, t, i) => s + (t / n) * (secondaryTotals[i] / n), 0);
  if (pe >= 1) return 1;
  return (po - pe) / (1 - pe);
}

// Quadratic-weighted kappa — appropriate for ordinal 0-3 scores so that
// a disagreement of 1 (e.g. 2 vs 3) is much less severe than a disagreement
// of 3 (e.g. 0 vs 3).
function quadraticWeightedKappa(pairs: Array<[number, number]>, labelCount = 4): number | null {
  if (pairs.length === 0) return null;
  const n = pairs.length;
  const observed: number[][] = Array.from({ length: labelCount }, () => new Array(labelCount).fill(0));
  const hist1 = new Array<number>(labelCount).fill(0);
  const hist2 = new Array<number>(labelCount).fill(0);
  for (const [a, b] of pairs) {
    observed[a][b] += 1;
    hist1[a] += 1;
    hist2[b] += 1;
  }
  const maxDiff = (labelCount - 1) ** 2;
  let num = 0;
  let den = 0;
  for (let i = 0; i < labelCount; i += 1) {
    for (let j = 0; j < labelCount; j += 1) {
      const w = ((i - j) ** 2) / maxDiff;
      const O = observed[i][j] / n;
      const E = (hist1[i] / n) * (hist2[j] / n);
      num += w * O;
      den += w * E;
    }
  }
  if (den === 0) return 1;
  return 1 - num / den;
}

async function main(): Promise<void> {
  const runId = readFlag("--run-id");
  const runDir = resolve(DEFAULT_RESULTS_ROOT, "raw", runId);
  const reliabilityDir = resolve(runDir, "reliability");
  const manifestPath = resolve(reliabilityDir, "sample-manifest.json");
  const passADir = resolve(reliabilityDir, "pass-A");
  const passBDir = resolve(reliabilityDir, "pass-B");
  const judgePathV2 = resolve(runDir, "judges.jsonl.v2");

  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const passAByIdx = new Map<number, ReliabilityRow>();
  const passBByIdx = new Map<number, ReliabilityRow>();
  for (const r of readJsonlDir(passADir)) passAByIdx.set(r.idx, r);
  for (const r of readJsonlDir(passBDir)) passBByIdx.set(r.idx, r);

  // Pass 1 = LLM judgments from the full-corpus run (or rule-based fallback
  // for any batches that didn't complete). We prefer the merged LLM judge
  // file if it exists; otherwise fall back to judges.jsonl.v2 (rule-based).
  const mergedLlmPath = resolve(runDir, "judges.jsonl.v2.merged");
  const judgeSourcePath = (await import("fs")).existsSync(mergedLlmPath) ? mergedLlmPath : judgePathV2;
  const pass1ByKey = new Map<string, { accuracy: number; completeness: number; safety: number; hallucination: number; format: number; judge_model?: string }>();
  const judgeContent = readFileSync(judgeSourcePath, "utf-8");
  for (const line of judgeContent.split("\n")) {
    if (!line.trim()) continue;
    const j = JSON.parse(line);
    const key = `${j.model_tag}::${j.query_id}::${j.run_number}`;
    pass1ByKey.set(key, j.judge_scores);
  }
  console.log(`Pass 1 judge source: ${judgeSourcePath}`);

  // Align the three passes on idx from the manifest
  interface Triplet {
    idx: number;
    model_tag: string;
    query_id: string;
    run_number: number;
    category: string;
    scores: Record<"accuracy" | "completeness" | "safety" | "hallucination" | "format",
      { p1: number | null; p2: number | null; p3: number | null }>;
  }
  const triplets: Triplet[] = [];
  const missing = { p1: 0, p2: 0, p3: 0 };
  for (const task of manifest.tasks as Array<{ idx: number; model_tag: string; query_id: string; run_number: number; category: string }>) {
    const key = `${task.model_tag}::${task.query_id}::${task.run_number}`;
    const p1 = pass1ByKey.get(key);
    const p2 = passAByIdx.get(task.idx);
    const p3 = passBByIdx.get(task.idx);
    if (!p1) missing.p1 += 1;
    if (!p2) missing.p2 += 1;
    if (!p3) missing.p3 += 1;
    if (!p1 || !p2 || !p3) continue;
    triplets.push({
      idx: task.idx,
      model_tag: task.model_tag,
      query_id: task.query_id,
      run_number: task.run_number,
      category: task.category,
      scores: {
        accuracy: { p1: p1.accuracy, p2: p2.accuracy, p3: p3.accuracy },
        completeness: { p1: p1.completeness, p2: p2.completeness, p3: p3.completeness },
        safety: { p1: p1.safety, p2: p2.safety, p3: p3.safety },
        hallucination: { p1: p1.hallucination, p2: p2.hallucination, p3: p3.hallucination },
        format: { p1: p1.format, p2: p2.format, p3: p3.format },
      },
    });
  }

  const dims = ["accuracy", "completeness", "safety", "hallucination", "format"] as const;

  // Per-dimension kappa
  const perDimension: Record<string, any> = {};
  for (const dim of dims) {
    const p12: Array<[number, number]> = [];
    const p13: Array<[number, number]> = [];
    const p23: Array<[number, number]> = [];
    for (const t of triplets) {
      const s = t.scores[dim];
      if (s.p1 !== null && s.p2 !== null) p12.push([s.p1, s.p2]);
      if (s.p1 !== null && s.p3 !== null) p13.push([s.p1, s.p3]);
      if (s.p2 !== null && s.p3 !== null) p23.push([s.p2, s.p3]);
    }
    const k12 = cohensKappa(p12);
    const k13 = cohensKappa(p13);
    const k23 = cohensKappa(p23);
    const qk12 = quadraticWeightedKappa(p12);
    const qk13 = quadraticWeightedKappa(p13);
    const qk23 = quadraticWeightedKappa(p23);
    const meanUn = [k12, k13, k23].filter((v): v is number => v !== null).reduce((s, v, _, arr) => s + v / arr.length, 0);
    const meanQw = [qk12, qk13, qk23].filter((v): v is number => v !== null).reduce((s, v, _, arr) => s + v / arr.length, 0);
    perDimension[dim] = {
      n_pairs: p12.length,
      kappa_unweighted: { rule_vs_llmA: k12, rule_vs_llmB: k13, llmA_vs_llmB: k23, mean: meanUn },
      kappa_quadratic_weighted: { rule_vs_llmA: qk12, rule_vs_llmB: qk13, llmA_vs_llmB: qk23, mean: meanQw },
    };
  }

  // Per-category kappa (on mean pairwise unweighted)
  const byCategory = new Map<string, Triplet[]>();
  for (const t of triplets) {
    if (!byCategory.has(t.category)) byCategory.set(t.category, []);
    byCategory.get(t.category)!.push(t);
  }
  const perCategory: Record<string, any> = {};
  for (const [cat, cells] of byCategory) {
    const byDim: Record<string, number | null> = {};
    for (const dim of dims) {
      const p12: Array<[number, number]> = [];
      const p13: Array<[number, number]> = [];
      const p23: Array<[number, number]> = [];
      for (const t of cells) {
        const s = t.scores[dim];
        if (s.p1 !== null && s.p2 !== null) p12.push([s.p1, s.p2]);
        if (s.p1 !== null && s.p3 !== null) p13.push([s.p1, s.p3]);
        if (s.p2 !== null && s.p3 !== null) p23.push([s.p2, s.p3]);
      }
      const kappas = [cohensKappa(p12), cohensKappa(p13), cohensKappa(p23)].filter(
        (v): v is number => v !== null,
      );
      byDim[dim] = kappas.length > 0 ? kappas.reduce((s, v) => s + v / kappas.length, 0) : null;
    }
    perCategory[cat] = { n: cells.length, kappa_mean_unweighted: byDim };
  }

  // Overall kappa: mean of the three pairwise weighted kappas across dimensions
  const allWeighted: number[] = [];
  for (const dim of dims) {
    const pd = perDimension[dim].kappa_quadratic_weighted;
    for (const k of [pd.rule_vs_llmA, pd.rule_vs_llmB, pd.llmA_vs_llmB]) {
      if (typeof k === "number" && Number.isFinite(k)) allWeighted.push(k);
    }
  }
  const overallWeighted = allWeighted.reduce((s, v) => s + v, 0) / (allWeighted.length || 1);

  const perDimMins = Object.values(perDimension).map(
    (pd: any) => pd.kappa_quadratic_weighted.mean,
  );
  const minDimWeighted = Math.min(...perDimMins);

  const overallGatePass = overallWeighted >= 0.6 && minDimWeighted >= 0.5;

  // Stratification breakdown
  const stratByModel = new Map<string, number>();
  const stratByCat = new Map<string, number>();
  for (const t of triplets) {
    stratByModel.set(t.model_tag, (stratByModel.get(t.model_tag) ?? 0) + 1);
    stratByCat.set(t.category, (stratByCat.get(t.category) ?? 0) + 1);
  }

  const result = {
    run_id: runId,
    n_sampled: triplets.length,
    missing_passes: missing,
    stratification: {
      by_model: Object.fromEntries([...stratByModel.entries()].sort()),
      by_category: Object.fromEntries([...stratByCat.entries()].sort()),
    },
    per_dimension: perDimension,
    per_category: perCategory,
    overall: {
      kappa_weighted_mean: overallWeighted,
      min_dimension_weighted: minDimWeighted,
      gate_passed: overallGatePass,
      thresholds: { overall_min: 0.6, per_dimension_min: 0.5 },
    },
  };

  const outPath = resolve(runDir, "judge-reliability.json");
  writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Wrote ${outPath}`);
  console.log(`Overall weighted κ = ${overallWeighted.toFixed(3)}`);
  console.log(`Min dimension weighted κ = ${minDimWeighted.toFixed(3)}`);
  console.log(`Gate passed: ${overallGatePass}`);
  for (const dim of dims) {
    const d = perDimension[dim].kappa_quadratic_weighted;
    console.log(
      `  ${dim.padEnd(14)} mean=${d.mean.toFixed(3)}  rule↔A=${d.rule_vs_llmA?.toFixed(3) ?? "na"}  rule↔B=${d.rule_vs_llmB?.toFixed(3) ?? "na"}  A↔B=${d.llmA_vs_llmB?.toFixed(3) ?? "na"}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
