# Local-LLM Benchmark — 2026-04-23T01-44-13-984Z (v2 report)

This directory contains the full, published artifacts for the 9-model × 190-query
local-LLM benchmark run executed on 2026-04-23 against the augmented test set.
All numbers in `report.md` are regeneratable from the raw artifacts kept here;
the aggregation and reporting code is pure over `runs.jsonl` + `judges.jsonl.v2.merged`.

## What this run is

| | |
|---|---|
| **Run ID** | `2026-04-23T01-44-13-984Z` |
| **Started** | 2026-04-23 01:44:14 UTC |
| **Finished** | 2026-04-23 17:15:55 UTC (~15.5 h wall-clock inference; judgments post-hoc) |
| **Hardware** | Apple M5 Max, 128 GB RAM, wired-memory limit 122 880 MB, macOS 26.4.1 |
| **Runtime** | Ollama 0.21.0, models Q4_K_M quantization |
| **Git commit** | `18f7268129ac9c15c7f56924df1f56d414216c0e` (worktree was dirty) |
| **Models × queries × runs** | 9 × 190 (+ 4 multi-turn × 3 turns = 12) × (1 cold + 1 warm) = **3 636 rows** |
| **Warm rows judged** | 1 863 (all non-cold, non-error, non-PHI-block rows) |
| **Judge (primary)** | Claude Opus 4.7 reasoning via Claude Code subagents, structured 0–3 anchored rubric |
| **Judge (sample reliability)** | Triple-judged, Cohen's κ weighted mean = 0.767 (overall) |
| **Deployment-gate answer** | No model simultaneously cleared the ≤ 10 s p95 latency gate *and* a CI-lower-bound 60 % quality pass rate on this hardware. |

The models tested were: `qwen3.5:4b`, `qwen3.5:9b`, `gemma4:e2b`, `gemma4:e4b`
(light tier); `qwen3.5:27b`, `gemma4:26b`, `gemma4:31b`, `qwen3.6:35b-a3b`
(medium tier); `qwen3.5:122b-a10b` (heavy tier).

## v2 Judge — what changed from v1

The v1 published artifacts used a deterministic heuristic judge (`heuristic-rubric-v1`) that
pattern-matched regex rules against response text. It was fast and transparent but had two
material false-positive modes:

1. **Dosing false-positive**: any response containing an `administer N mg` pattern was scored
   safety = 0, even when the response correctly quoted a protocol dose verbatim with a citation.
2. **Refusal false-positive**: scope-redirect phrases ("outside the scope", "refer to IT")
   were treated as blocked refusals even on IT-support queries where such a redirect is the
   correct response and `mustNotRefuse` is true.

The v2 judge (`benchmarks/harness/llm-judge.ts`) replaces the heuristic with LLM reasoning
(Claude Opus 4.7) invoked through the Claude Code subagent pool (no external API calls).
It carries both carve-outs explicitly and scores each row on the same five-dimension
rubric with an evidence string per dimension.

**Inter-rater reliability.** A stratified 10% sample (n = 187 rows, balanced across model ×
category, seed 42) was triple-judged by three independent Claude Opus 4.7 reasoning passes.
Cohen's quadratic-weighted κ: overall 0.767, min dimension 0.606 — above the pre-registered
gate (overall κ ≥ 0.6, per-dimension κ ≥ 0.5). Per-dimension means: accuracy 0.83,
completeness 0.87, safety 0.74, hallucination 0.61, format 0.79. See `judge-reliability.json`.

## Three orthogonal metrics

v2 splits the v1 single pass-rate into three independent gates because conflating them
was the main cause of the misleading v1 story:

- `latency_pass`: `total_time_s ≤ 10` seconds (the perceived-latency gate)
- `quality_pass`: all 4 gated judge dimensions ≥ 2 AND all programmatic checks passed
- `combined_pass`: `latency_pass AND quality_pass`

## Headline numbers (warm rows only)

| Model | Tier | Combined (95% CI) | Latency pass | Quality pass | p95 latency (s) |
|---|---|---|---|---|---|
| gemma4:26b | medium | 47.1% [40.5, 53.8] | 91.9% | 51.0% | 12.2 |
| gemma4:e4b | light | 34.3% [28.1, 41.0] | 92.9% | 37.6% | 11.1 |
| gemma4:e2b | light | 33.3% [26.7, 40.0] | 99.5% | 33.8% | 6.3 |
| qwen3.5:4b | light | 28.6% [22.4, 34.8] | 57.1% | 54.3% | 22.7 |
| qwen3.5:9b | light | 26.2% [20.5, 32.4] | 46.7% | 62.9% | 25.6 |
| qwen3.6:35b-a3b | medium | 25.2% [19.0, 31.4] | 57.1% | 55.2% | 23.3 |
| gemma4:31b | medium | 5.7% [2.9, 9.0] | 16.2% | 46.2% | 49.9 |
| qwen3.5:122b-a10b | heavy | 2.9% [1.0, 5.2] | 13.3% | 60.0% | 52.2 |
| qwen3.5:27b | medium | 1.0% [0.0, 2.4] | 10.0% | 57.6% | 78.4 |

**Latency separates tiers; quality does not.** The quality pass rates cluster between
34% and 63% with substantial overlap across tiers. The heavy-tier `qwen3.5:122b-a10b`
produces the third-highest quality pass rate (60.0%) but misses the latency gate on
87% of warm runs, tanking its combined pass rate. The light-tier `gemma4:e2b` nearly
always clears latency (99.5%) but has the lowest quality floor (33.8%).

## Methodology

### Test set (190 queries + 4 multi-turn sequences = 202 query rows)

| Category | Count | What it validates |
|---|---:|---|
| factual | 12 | Short knowledge retrieval with `mustInclude` anchors |
| differential | 6 | Hedging language, no overcommitment |
| protocol | 8 | Institutional-policy Q&A with citation fidelity |
| refusal | 5 | Out-of-scope queries decline instead of answer |
| adversarial | 18 | Prompt-injection, jailbreak, guardrail probes |
| long_context | 15 | Multi-paragraph inputs, context retention |
| calibration | 9 | Confidence matches evidence |
| bias_invariance | 12 | Matched prompt pairs differing only in demographics |
| noise_robustness | 7 | Typos, abbreviations, malformed input |
| citation_integrity | 8 | Must cite, must not invent titles |
| dose_critical | 20 | Exact-dose verbatim fidelity |
| cross_institutional | 14 | Honours institution filter |
| reasoning_chain | 6 | Multi-step protocol selection |
| it_support | 50 | Out-of-domain device/IT queries (scope-redirect shape) |
| multi_turn | 12 (4 × 3) | Conversational continuity |

### Programmatic checks

- `response-validator` detection of first-person patient-directive, unqualified invasive
  recommendations, medication prescribing without citation, disposition calls
- Refusal vs scope-redirect disambiguation (HARD refusal matters, REDIRECT is expected)
- `mustInclude` / `mustIncludeAny` / `mustNotInclude` string constraints
- Optional citation requirement, length bounds, and `mustNotRefuse`

### LLM-as-judge (primary)

Claude Opus 4.7 reasoning, invoked via Claude Code subagents, applied per row with the
rubric + query + retrieved sources + response as context. Coverage: 1 856 / 1 863 rows
(99.6%) received an LLM judgment; 7 rows fell back to a rule-based proxy when subagent
dispatch hit rate limits. Full details in `report.md`.

### Statistical protocol

- 95% percentile bootstrap CIs, 5 000 replicates, seed = 42
- Paired McNemar's exact binomial test for pairwise model comparisons on each metric
- Holm-Bonferroni family-wise correction per metric family
- Thresholds and seeds are pre-registered in `benchmarks/harness/statistics.ts`

## File manifest

| File | Purpose |
|---|---|
| `report.md` | Full publication-style report (tables, stats, embedded charts) |
| `report-assets/*.svg` | Six standalone charts: combined-pass bars, quality-vs-latency scatter, latency ECDF, quality heatmap, stage-latency bars, judge reliability bars |
| `summary.csv` | 9-row model-level aggregate |
| `per-query.csv` | (model × query) roll-up |
| `per-category.csv` | (model × category) roll-up |
| `runs.jsonl` | Raw append-only log, 3 636 rows, full provenance |
| `judges.jsonl.v2.merged` | v2 LLM-judge sidecar, 1 863 rows |
| `judges.jsonl` | v1 heuristic-judge sidecar (preserved for audit) |
| `judge-reliability.json` | Cohen's κ per dimension on the 187-row triple-judged sample |
| `judge-coverage.json` | LLM vs rule-based fallback breakdown |
| `meta.json` | Run parameters, CLI args, git commit, dataset SHA-256 hashes, ollama version |

## How to interpret the results

1. **Read `combined-pass.svg` first.** Sorted descending by combined pass rate, with
   95% bootstrap CI whiskers and a 60% target line. The medium-tier `gemma4:26b`
   is furthest along but still below the target at CI lower bound 40.5%.

2. **Then `quality-vs-latency.svg`.** The light-green "deployable zone" in the top-left
   is what deployment requires: both gates passed. No model sits inside that region
   with its CI inside the zone.

3. **`quality-heatmap.svg`** highlights where each model fails by category. Light-tier
   models struggle on `it_support` (they refuse instead of redirecting), `cross_institutional`
   (they miss one of the two institutions), and `calibration` (they overcommit or underhedge).
   Medium and heavy tiers show more even quality but pay for it in latency.

4. **`latency-ecdf.svg`** (log-x) makes the latency tiers stark. `gemma4:e2b` and
   `gemma4:e4b` have ECDFs tightly under the 10 s gate; the qwen medium and heavy models
   cross the gate at 30–70% of warm runs.

5. **`judge-reliability.svg`** reports Cohen's κ per dimension. Hallucination has the
   lowest weighted κ (0.606) because grounding judgments depend most on individual
   interpretation of "stay on topic." All five dimensions pass the 0.5 per-dimension gate.

## Reproducing the numbers

```bash
# 1. Pin the code:
git checkout <commit-sha-from-report>

# 2. Copy raw logs into the harness path:
RUN_ID=2026-04-23T01-44-13-984Z
mkdir -p benchmarks/results/raw/$RUN_ID
cp runs.jsonl judges.jsonl.v2.merged meta.json \
   judge-reliability.json judge-coverage.json \
   benchmarks/results/raw/$RUN_ID/

# 3. Re-derive aggregates + report (pure over the raw logs):
npx tsx benchmarks/scripts/generate-report.ts --run-id $RUN_ID

# Outputs match benchmarks/published/$RUN_ID/ exactly.
```

## Known limitations

- **Single-institution test corpus.** Synthetic institution-A / institution-B policy
  sets seeded from demo guidelines; a true production deployment would require repeat
  evaluation on the target corpus.
- **Single hardware profile** (Apple M5 Max, 128 GB RAM). Latency numbers are not
  portable to other hardware classes.
- **Offline seeded corpus** for ingestion. Retrieval behaviour on a production knowledge
  base may differ.
- **Single judge family** (Claude Opus 4.7). Inter-rater reliability is measured across
  three independent reasoning passes of the same model family; a second independent
  family would strengthen the methodology.
- **One warm run per cell.** Bootstrap CIs reflect this sample; comparisons with
  overlapping CIs are not statistically separated at α = 0.05.
- **Warm-only quality analysis.** Cold TTFT is reported but not gated against quality.
- **Ollama-shipped Q4_K_M quantization.** Full-precision ceilings not measured.
- **Temperature locked at 0.** Production at T > 0 would change variance.
