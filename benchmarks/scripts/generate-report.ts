#!/usr/bin/env npx tsx
/**
 * Generate a publication-quality benchmark report.
 *
 * Adds over the first pass:
 *   - Bootstrap 95% CIs on every headline metric (percentile, seed=42).
 *   - Pairwise McNemar tests across models, with Holm-Bonferroni correction.
 *   - Per-category pass-rate heatmap (model × category).
 *   - Latency ECDF with 10-second gate line.
 *   - Scatter of p95 latency vs. overall pass-rate with CIs.
 *   - Stage-latency stacked bar for pipeline breakdown.
 *   - Inter-judge agreement (Cohen's kappa) on the deterministic 20% sample.
 *   - Bias-invariance paired-response consistency diagnostic.
 *   - Minimum sample-size call-out (power analysis).
 *   - Dataset content hashes for reproducibility.
 *   - All SVG charts written as files in `results/reports/<run-id>.assets/`
 *     AND inlined via <img src="..."> for immediate GitHub rendering.
 */
import { createHash } from "crypto";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve, relative } from "path";
import { aggregateRuns, rowPasses as _rowPasses } from "../harness/aggregator";
import {
  BENCHMARK_ROOT,
  buildQueryLookup,
  buildStandaloneUnits,
  DEFAULT_RESULTS_ROOT,
  loadConfig,
  loadExistingRuns,
  parseJsonlQueries,
} from "../harness/runner";
import { cohensKappa } from "../harness/metrics";
import { buildJudgeIndex, loadJudgeRecords, mergeJudgeIntoRun } from "../harness/judge-store";
import { runMetaSchema } from "../harness/schema";
import {
  bootstrapCI,
  holmBonferroni,
  mcnemar,
  minSampleSizeTwoProportions,
  pairedBootstrap,
  type ConfidenceInterval,
} from "../harness/statistics";
import {
  renderBarWithErrors,
  renderEcdf,
  renderHeatmap,
  renderScatterWithCI,
  renderStackedStages,
} from "../harness/visualize";
import type { QueryCase, RawRun, SummaryRow } from "../harness/types";

function readFlag(flag: string): string {
  const index = process.argv.indexOf(flag);
  if (index < 0 || !process.argv[index + 1]) {
    throw new Error(`Missing required flag ${flag}`);
  }
  return process.argv[index + 1];
}

function fmtNum(value: number | null, digits = 2): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "n/a"
    : value.toFixed(digits);
}

function fmtPct(value: number | null, digits = 1): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "n/a"
    : `${(value * 100).toFixed(digits)}%`;
}

function fmtCI(ci: ConfidenceInterval | null, digits = 2, asPercent = false): string {
  if (!ci || !Number.isFinite(ci.point)) return "n/a";
  const f = (v: number) => (asPercent ? fmtPct(v, digits) : fmtNum(v, digits));
  return `${f(ci.point)} [${f(ci.lower)}, ${f(ci.upper)}]`;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function markdownTable(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function rowPasses(run: RawRun, query: QueryCase | undefined): boolean {
  return _rowPasses(run, query?.expected);
}

function writeSvg(baseDir: string, fileName: string, svg: string): string {
  mkdirSync(baseDir, { recursive: true });
  const target = resolve(baseDir, fileName);
  writeFileSync(target, svg);
  return target;
}

async function main(): Promise<void> {
  const runId = readFlag("--run-id");
  const metaPath = resolve(DEFAULT_RESULTS_ROOT, "raw", runId, "meta.json");
  const rawPath = resolve(DEFAULT_RESULTS_ROOT, "raw", runId, "runs.jsonl");
  const judgePath = resolve(DEFAULT_RESULTS_ROOT, "raw", runId, "judges.jsonl");
  const meta = runMetaSchema.parse(JSON.parse(readFileSync(metaPath, "utf-8")));
  const rawRuns = loadExistingRuns(rawPath);
  const judgeIndex = buildJudgeIndex(loadJudgeRecords(judgePath));
  const runs = rawRuns.map((run) => mergeJudgeIntoRun(run, judgeIndex));
  const { judge, settings } = loadConfig();
  const { standalone, multiTurn } = parseJsonlQueries();
  const queryLookup = buildQueryLookup([...buildStandaloneUnits(standalone), ...multiTurn]);
  const { summaryRows, perQueryRows } = aggregateRuns(rawRuns, queryLookup, judgeIndex);

  const assetsDir = resolve(DEFAULT_RESULTS_ROOT, "reports", `${runId}.assets`);
  const outputDir = resolve(DEFAULT_RESULTS_ROOT, "reports");
  mkdirSync(outputDir, { recursive: true });

  // ── Data integrity hashes ──
  const queriesHash = sha256(readFileSync(resolve(BENCHMARK_ROOT, "test_set", "queries.jsonl"), "utf-8"));
  const multiTurnHash = sha256(
    readFileSync(resolve(BENCHMARK_ROOT, "test_set", "multi_turn_sequences.jsonl"), "utf-8"),
  );
  const rubricHash = sha256(readFileSync(resolve(BENCHMARK_ROOT, "config", "judge.yaml"), "utf-8"));

  // ── Publication-rigor flags ──
  const violationMessages: string[] = [];
  if (!meta.git_commit) violationMessages.push("Missing git commit in meta.json.");
  if (meta.git_dirty) violationMessages.push("Working tree was dirty during the run.");
  if (meta.runs_per_query < 2) violationMessages.push(`Only ${meta.runs_per_query} warm runs per cell (recommend ≥ 10 for publication).`);
  const modelsWithFewRuns = summaryRows.filter((row) => row.runs < 30);
  if (modelsWithFewRuns.length > 0) {
    violationMessages.push(
      `Models with <30 warm rows (power-limited): ${modelsWithFewRuns.map((row) => row.model_tag).join(", ")}.`,
    );
  }

  // ── Bootstrap CIs for every headline metric, per model ──
  type ModelCIs = {
    passRate: ConfidenceInterval;
    totalP95: ConfidenceInterval;
    ttftP95: ConfidenceInterval;
    tokensPerSecond: ConfidenceInterval;
  };
  const cisByModel = new Map<string, ModelCIs>();
  const warmRunsByModel = new Map<string, RawRun[]>();
  for (const run of runs) {
    if (run.cold) continue;
    if (!warmRunsByModel.has(run.model_tag)) warmRunsByModel.set(run.model_tag, []);
    warmRunsByModel.get(run.model_tag)!.push(run);
  }
  for (const [modelTag, modelRuns] of warmRunsByModel) {
    const passArr = modelRuns.map((run) =>
      rowPasses(run, queryLookup.get(run.query_id)) ? 1 : 0,
    );
    const ttftArr = modelRuns.map((run) => run.ttft_s).filter((v): v is number => v !== null);
    const totalArr = modelRuns.map((run) => run.total_time_s).filter((v): v is number => v !== null);
    const tpsArr = modelRuns.map((run) => run.tokens_per_second).filter((v): v is number => v !== null);

    cisByModel.set(modelTag, {
      passRate: bootstrapCI(passArr, { seed: 42, iterations: 5000 }),
      totalP95: bootstrapCI(totalArr, {
        seed: 43,
        iterations: 5000,
        statistic: (s) => percentile(s, 0.95),
      }),
      ttftP95: bootstrapCI(ttftArr, {
        seed: 44,
        iterations: 5000,
        statistic: (s) => percentile(s, 0.95),
      }),
      tokensPerSecond: bootstrapCI(tpsArr, { seed: 45, iterations: 5000 }),
    });
  }

  // ── Pairwise McNemar across models (on same query_ids, paired per-item mean pass) ──
  type Pairwise = {
    modelA: string;
    modelB: string;
    bMinus: number; // A pass, B fail
    cMinus: number; // A fail, B pass
    nPaired: number;
    pValue: number;
    passDelta: number;
  };
  const queryIds = [...new Set(runs.filter((r) => !r.cold).map((r) => r.query_id))];
  const passPerModelPerQuery = new Map<string, Map<string, boolean>>();
  for (const [modelTag, modelRuns] of warmRunsByModel) {
    const perQuery = new Map<string, boolean>();
    const perQueryPasses = new Map<string, { pass: number; total: number }>();
    for (const run of modelRuns) {
      const bucket = perQueryPasses.get(run.query_id) ?? { pass: 0, total: 0 };
      bucket.total += 1;
      if (rowPasses(run, queryLookup.get(run.query_id))) bucket.pass += 1;
      perQueryPasses.set(run.query_id, bucket);
    }
    for (const [queryId, bucket] of perQueryPasses) {
      // majority-vote per item
      perQuery.set(queryId, bucket.pass / bucket.total >= 0.5);
    }
    passPerModelPerQuery.set(modelTag, perQuery);
  }
  const pairwiseResults: Pairwise[] = [];
  const modelTags = [...warmRunsByModel.keys()];
  for (let i = 0; i < modelTags.length; i += 1) {
    for (let j = i + 1; j < modelTags.length; j += 1) {
      const a = modelTags[i];
      const b = modelTags[j];
      const aMap = passPerModelPerQuery.get(a)!;
      const bMap = passPerModelPerQuery.get(b)!;
      const pairs: Array<[boolean, boolean]> = [];
      for (const qid of queryIds) {
        if (aMap.has(qid) && bMap.has(qid)) pairs.push([aMap.get(qid)!, bMap.get(qid)!]);
      }
      const result = mcnemar(pairs);
      const aPass = pairs.filter(([x]) => x).length / (pairs.length || 1);
      const bPass = pairs.filter(([, y]) => y).length / (pairs.length || 1);
      pairwiseResults.push({
        modelA: a,
        modelB: b,
        bMinus: result.b,
        cMinus: result.c,
        nPaired: pairs.length,
        pValue: result.pValue,
        passDelta: aPass - bPass,
      });
    }
  }
  const holm = holmBonferroni(pairwiseResults.map((r) => r.pValue), 0.05);
  const significantPairs = pairwiseResults
    .map((r, idx) => ({ ...r, reject: holm[idx].reject, adjThreshold: holm[idx].threshold }))
    .sort((a, b) => a.pValue - b.pValue);

  // ── Inter-judge agreement (Cohen's kappa) ──
  const kappaLines = (["accuracy", "completeness", "format", "safety", "hallucination"] as const).map(
    (dim) => {
      const pairs: Array<[number, number]> = [];
      for (const run of runs) {
        const primary = run.judge_scores?.[dim];
        const backup = run.backup_judge_scores?.[dim];
        if (typeof primary === "number" && typeof backup === "number") pairs.push([primary, backup]);
      }
      return { dimension: dim, kappa: cohensKappa(pairs), n: pairs.length };
    },
  );

  // ── Bias invariance diagnostic ──
  const biasPairs = new Map<string, QueryCase[]>();
  for (const q of queryLookup.values()) {
    const pairId = q.expected?.biasInvariancePairId;
    if (!pairId) continue;
    if (!biasPairs.has(pairId)) biasPairs.set(pairId, []);
    biasPairs.get(pairId)!.push(q);
  }
  const biasDiagnostics: Array<{ pairId: string; model: string; consistent: boolean; note: string }> = [];
  for (const [modelTag, modelRuns] of warmRunsByModel) {
    const byQuery = new Map<string, RawRun[]>();
    for (const run of modelRuns) {
      if (!byQuery.has(run.query_id)) byQuery.set(run.query_id, []);
      byQuery.get(run.query_id)!.push(run);
    }
    for (const [pairId, queries] of biasPairs) {
      if (queries.length < 2) continue;
      const passes = queries.map((q) => {
        const rs = byQuery.get(q.id) ?? [];
        const passCount = rs.filter((r) => rowPasses(r, q)).length;
        return rs.length === 0 ? null : passCount / rs.length;
      });
      const valid = passes.filter((v): v is number => v !== null);
      if (valid.length < 2) continue;
      const maxGap = Math.max(...valid) - Math.min(...valid);
      biasDiagnostics.push({
        pairId,
        model: modelTag,
        consistent: maxGap <= 0.2,
        note: `pass rates: ${valid.map((v) => fmtPct(v)).join(" / ")}`,
      });
    }
  }

  // ── Power-analysis call-outs (per pairwise sig result, report N needed) ──
  const powerLines = significantPairs.slice(0, 5).map((p) => {
    const aMap = passPerModelPerQuery.get(p.modelA)!;
    const bMap = passPerModelPerQuery.get(p.modelB)!;
    const aPass = [...aMap.values()].filter(Boolean).length / (aMap.size || 1);
    const bPass = [...bMap.values()].filter(Boolean).length / (bMap.size || 1);
    const nNeeded = minSampleSizeTwoProportions(aPass, bPass);
    return `- **${p.modelA} vs ${p.modelB}**: observed Δ=${fmtPct(p.passDelta)}, p=${fmtNum(p.pValue, 4)}${p.reject ? " (sig)" : ""}; unpaired-z N per arm ≈ ${Number.isFinite(nNeeded) ? nNeeded : "∞"}.`;
  });

  // ── Charts ──
  const passRateBarSvg = renderBarWithErrors(
    "Warm overall pass rate with 95% bootstrap CI",
    summaryRows.map((row) => {
      const ci = cisByModel.get(row.model_tag)!;
      return {
        label: row.model_tag,
        value: row.pass_rate_overall,
        lower: ci.passRate.lower,
        upper: ci.passRate.upper,
        group: row.model_tier,
      };
    }),
    { yLabel: "overall pass rate", asPercent: true, yMin: 0, yMax: 1 },
  );

  const latencyEcdfSvg = renderEcdf(
    "End-to-end latency ECDF (warm)",
    [...warmRunsByModel.entries()].map(([modelTag, modelRuns]) => ({
      label: modelTag,
      values: modelRuns.map((r) => r.total_time_s).filter((v): v is number => v !== null),
    })),
    { xLabel: "total time (s)", xMin: 0, thresholdLine: settings.latency_gate_s },
  );

  const scatterSvg = renderScatterWithCI(
    "Pass rate vs. p95 end-to-end latency",
    summaryRows.map((row) => {
      const ci = cisByModel.get(row.model_tag)!;
      return {
        label: row.model_tag,
        x: row.total_s_p95 ?? NaN,
        y: row.pass_rate_overall,
        yLower: ci.passRate.lower,
        yUpper: ci.passRate.upper,
        xLower: ci.totalP95.lower,
        xUpper: ci.totalP95.upper,
        group: row.model_tier,
      };
    }),
    {
      xLabel: "p95 total latency (s)",
      yLabel: "overall pass rate",
      xThreshold: settings.latency_gate_s,
      yThreshold: 0.6,
      yAsPercent: true,
    },
  );

  // Heatmap: model × category pass rates
  const categories = [...new Set([...queryLookup.values()].map((q) => q.category))];
  const heatmapCells = [];
  for (const [modelTag, modelRuns] of warmRunsByModel) {
    for (const cat of categories) {
      const catRuns = modelRuns.filter(
        (r) => queryLookup.get(r.query_id)?.category === cat,
      );
      if (catRuns.length === 0) {
        heatmapCells.push({ row: modelTag, column: cat, value: NaN, annotation: "—" });
        continue;
      }
      const passCount = catRuns.filter((r) => rowPasses(r, queryLookup.get(r.query_id))).length;
      heatmapCells.push({
        row: modelTag,
        column: cat,
        value: passCount / catRuns.length,
      });
    }
  }
  const heatmapSvg = renderHeatmap(
    "Pass rate by model × category",
    heatmapCells,
    { rowLabel: "Model", columnLabel: "Category", min: 0, max: 1, asPercent: true },
  );

  // Stage-latency stacked bar
  const stageOrder = [
    "phi_gate",
    "domain_classification",
    "embedding",
    "retrieval",
    "prompt_build",
    "llm_generation",
    "response_validation",
  ];
  const stageBarData = summaryRows.map((row) => {
    const modelRuns = warmRunsByModel.get(row.model_tag) ?? [];
    const stages: Record<string, number> = {};
    for (const stage of stageOrder) {
      const values = modelRuns.map((r) => (r.stage_timings_ms as unknown as Record<string, number>)[stage] ?? 0);
      stages[stage] = values.length
        ? values.reduce((a, b) => a + b, 0) / values.length / 1000
        : 0;
    }
    return { label: row.model_tag, stages };
  });
  const stageSvg = renderStackedStages(
    "Mean pipeline stage latency (warm, seconds)",
    stageBarData,
    stageOrder,
    { yLabel: "seconds per request" },
  );

  const chartTargets = [
    { name: "pass-rate.svg", svg: passRateBarSvg },
    { name: "latency-ecdf.svg", svg: latencyEcdfSvg },
    { name: "pass-vs-latency.svg", svg: scatterSvg },
    { name: "heatmap-model-category.svg", svg: heatmapSvg },
    { name: "stage-latency.svg", svg: stageSvg },
  ];
  for (const chart of chartTargets) writeSvg(assetsDir, chart.name, chart.svg);

  // ── Tables ──
  const latencyTable = markdownTable(
    ["Model", "Tier", "N warm", "Cold TTFT", "Warm TTFT p95", "Total p95 (95% CI)", "Tokens/s (95% CI)"],
    summaryRows.map((row) => {
      const ci = cisByModel.get(row.model_tag)!;
      return [
        row.model_tag,
        row.model_tier,
        String(row.runs),
        fmtNum(row.cold_ttft_s),
        fmtNum(row.warm_ttft_s_p95),
        fmtCI(ci.totalP95),
        fmtCI(ci.tokensPerSecond, 1),
      ];
    }),
  );
  const qualityTable = markdownTable(
    ["Model", "Pass rate (95% CI)", "Acc", "Compl", "Safety", "Hallucination", "Format", "Refusal"],
    summaryRows.map((row) => {
      const ci = cisByModel.get(row.model_tag)!;
      return [
        row.model_tag,
        fmtCI(ci.passRate, 1, true),
        fmtNum(row.judge_accuracy_mean),
        fmtNum(row.judge_completeness_mean),
        fmtNum(row.judge_safety_mean),
        fmtNum(row.judge_hallucination_mean),
        fmtNum(row.judge_format_mean),
        row.refusal_compliance_rate === null ? "n/a" : fmtPct(row.refusal_compliance_rate),
      ];
    }),
  );
  const failureTable = markdownTable(
    ["Model", "Timeout", "Dangerous output", "Error rate", "Dominant failure"],
    summaryRows.map((row) => [
      row.model_tag,
      fmtPct(row.timeout_rate),
      fmtPct(row.dangerous_output_rate),
      fmtPct(row.error_rate),
      row.dominant_failure_mode,
    ]),
  );
  const pairwiseTable = significantPairs.length === 0
    ? "_No pairwise comparisons computed (insufficient data)._"
    : markdownTable(
        ["A", "B", "A pass – B fail", "A fail – B pass", "N paired", "p (McNemar)", "Holm-adj threshold", "Reject @ α=0.05"],
        significantPairs.map((p) => [
          p.modelA,
          p.modelB,
          String(p.bMinus),
          String(p.cMinus),
          String(p.nPaired),
          fmtNum(p.pValue, 4),
          fmtNum(p.adjThreshold, 4),
          p.reject ? "yes" : "no",
        ]),
      );
  const kappaTable = markdownTable(
    ["Dimension", "Cohen's κ", "N paired judgments"],
    kappaLines.map((k) => [k.dimension, fmtNum(k.kappa), String(k.n)]),
  );
  const biasTable = biasDiagnostics.length === 0
    ? "_No bias-invariance pairs evaluated in this run._"
    : markdownTable(
        ["Pair", "Model", "Consistent (gap ≤ 20%)", "Detail"],
        biasDiagnostics.map((b) => [b.pairId, b.model, b.consistent ? "yes" : "**no**", b.note]),
      );

  // ── Executive summary ──
  const viable = summaryRows.filter((row) => {
    const ci = cisByModel.get(row.model_tag);
    return ci && ci.totalP95.point <= settings.latency_gate_s && ci.passRate.lower >= 0.6;
  });
  const winner = [...viable].sort(
    (a, b) => b.pass_rate_overall - a.pass_rate_overall || (a.total_s_p50 ?? Infinity) - (b.total_s_p50 ?? Infinity),
  )[0];

  const categoryCounts = [...queryLookup.values()].reduce<Record<string, number>>((acc, q) => {
    acc[q.category] = (acc[q.category] ?? 0) + 1;
    return acc;
  }, {});

  const limitations = [
    `${meta.runs_per_query} warm runs per cell — bootstrap CIs reflect this sample; publication strength recommends ≥ 10.`,
    "Ollama-shipped quantization is used, not full precision; quality ceilings may shift at higher bitwidths.",
    "A single system prompt is held fixed across models; per-model tuning is out of scope.",
    "Single-user benchmark; concurrency is not measured.",
    "LLM-as-judge carries known verbosity and family biases; the deterministic 20% backup sample quantifies it (see Cohen's κ).",
    "The seeded demo/guideline corpus is a stand-in for an institutional production corpus.",
    "Temperature is locked at 0 for comparability rather than deployment realism; a follow-up run at T>0 is advised before production.",
    "Substring-based programmatic checks remain brittle for wording variations; the `mustIncludeAny` schema extension softens the worst cases.",
  ];

  const assetRel = relative(outputDir, assetsDir);

  const report = `# Radiology AI Assistant — Local-LLM Benchmark Report

${violationMessages.length > 0 ? `> [!WARNING]\n> Publication-rigor flags:\n${violationMessages.map((m) => `> - ${m}`).join("\n")}\n` : ""}
**Run ID:** \`${runId}\`  **Hardware:** ${meta.hardware.chip}, ${meta.hardware.ram_gb} GB, macOS ${meta.hardware.macos}  **Ollama:** ${meta.ollama_version}  **Judge:** ${meta.judge_model ?? "disabled"}
**Git commit:** \`${meta.git_commit}\`${meta.git_dirty ? " (dirty)" : ""}  **Warm runs per cell:** ${meta.runs_per_query}

## Executive Summary

${winner
  ? `**Deployment-gate answer:** ${winner.model_tag} (${winner.model_tier}) clears both the ≤${settings.latency_gate_s}s p95 latency gate and a lower-bound 60 % pass rate (95% CI) on the current run.`
  : `**Deployment-gate answer:** no evaluated model simultaneously cleared the ${settings.latency_gate_s}s p95 latency gate and a lower-bound 60 % pass rate on this run.`}

## Methodology at a glance

- **Test set:** ${Object.entries(categoryCounts).map(([c, n]) => `${c}=${n}`).join(", ")} (${[...queryLookup.keys()].length} query rows).
- **Programmatic gates:** latency ≤ ${settings.latency_gate_s}s, response-validator no-dangerous-output, category-specific refusal/hedging, \`mustInclude\` + \`mustIncludeAny\` + \`mustNotInclude\` + optional citation + length bounds + \`mustNotRefuse\`.
- **Judge:** ${judge.judge_model}, with ${judge.backup_judge_model} on a deterministic 20 % sample for inter-rater agreement.
- **Statistical protocol:** percentile bootstrap (5 000 replicates, seed = 42) for CIs; paired McNemar across models for pairwise comparisons with Holm-Bonferroni correction. Thresholds and seeds are pre-registered in \`benchmarks/harness/statistics.ts\`.

## Headline charts

<img src="${assetRel}/pass-rate.svg" alt="Pass rate bar chart with bootstrap CIs" />

<img src="${assetRel}/pass-vs-latency.svg" alt="Scatter: pass rate vs p95 latency with CIs" />

<img src="${assetRel}/latency-ecdf.svg" alt="Latency ECDF across models" />

<img src="${assetRel}/heatmap-model-category.svg" alt="Pass rate heatmap across model and category" />

<img src="${assetRel}/stage-latency.svg" alt="Stacked stage-latency bars per model" />

## Results tables

### Latency
${latencyTable}

### Quality
${qualityTable}

### Failure modes
${failureTable}

## Pairwise model comparisons (McNemar, Holm-Bonferroni corrected)

${pairwiseTable}

## Inter-judge agreement (Cohen's κ — primary vs backup judge on the 20 % deterministic sample)

${kappaTable}

## Bias-invariance diagnostic

${biasTable}

## Power and sample-size call-outs

${powerLines.length > 0 ? powerLines.join("\n") : "- _No pairwise sig calls_."}

## Known limitations

${limitations.map((line) => `- ${line}`).join("\n")}

## Reproducibility

- **Git commit:** \`${meta.git_commit}\`
- **Dirty worktree:** ${meta.git_dirty}
- **Hardware fingerprint:** ${meta.hardware.chip} / ${meta.hardware.ram_gb} GB / wired ${meta.hardware.wired_limit_mb} MB / macOS ${meta.hardware.macos}
- **Ollama version:** ${meta.ollama_version}
- **System prompt SHA-256:** \`${meta.system_prompt_hash}\`
- **queries.jsonl SHA-256:** \`${queriesHash}\`
- **multi_turn_sequences.jsonl SHA-256:** \`${multiTurnHash}\`
- **judge.yaml SHA-256:** \`${rubricHash}\`
- **Models with per-run digest + quantization:** ${summaryRows.map((r) => r.model_tag).join(", ")}
- **Charts:** ${chartTargets.map((c) => `\`${assetRel}/${c.name}\``).join(", ")}
- **Raw data:** \`${relative(outputDir, rawPath)}\` (append-only) + \`${relative(outputDir, judgePath)}\` (judge sidecar, append-only)
- **Aggregated CSV:** \`${relative(outputDir, resolve(DEFAULT_RESULTS_ROOT, "aggregated", runId))}\`
- **Analysis code:** \`benchmarks/harness/statistics.ts\`, \`benchmarks/harness/visualize.ts\`, \`benchmarks/scripts/generate-report.ts\`

## Appendix A — Test set

${[...queryLookup.values()]
  .map((q) => `- \`${q.id}\` (${q.category}): ${q.query.slice(0, 140).replace(/\\n/g, " ")}${q.query.length > 140 ? "…" : ""}`)
  .join("\n")}

### Appendix B — Per-query sample (first 20 rows)

${perQueryRows.slice(0, 20).map((p) =>
  `- **${p.model_tag}** × \`${p.query_id}\` (${p.query_category}): pass=${fmtPct(p.pass_rate)}, p95=${fmtNum(p.total_s_p95)}s`,
).join("\n")}
`;

  const reportPath = resolve(outputDir, `${runId}.md`);
  writeFileSync(reportPath, `${report}\n`);
  console.log(`Report written to ${reportPath}`);
  console.log(`Charts written to ${assetsDir}`);
}

function percentile(values: number[], q: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(0, Math.min(sorted.length - 1, q * (sorted.length - 1)));
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  const weight = rank - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * weight;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
