# Pilot Benchmark Run — 2026-04-22T23-31-46-575Z

## What this run is

This is a **pilot run** of the Radiology AI Assistant local-LLM benchmark suite on the 190-query augmented test set. It covers 2 light-tier Ollama models (`qwen3.5:4b`, `qwen3.5:9b`) restricted to the 12 `factual` queries, with 1 warm + 1 cold run per cell and no LLM-as-judge scoring. 46 raw benchmark rows were collected before the smoke test was terminated to start a larger run. The purpose is to validate the end-to-end pipeline on the augmented test set (now 190 queries across 15 categories including the new 50-query `it_support` category) and produce a reviewable report-generation artifact. Full 9-model × 190-query × 10-run data is **not** included here.

## Scope and known limitations

- **Models covered:** `qwen3.5:4b` (12 warm rows), `qwen3.5:9b` (10 warm rows). The 7 remaining models from `benchmarks/config/models.yaml` (`gemma4:e2b`, `gemma4:e4b`, `qwen3.5:27b`, `gemma4:26b`, `gemma4:31b`, `qwen3.6:35b-a3b`, `qwen3.5:122b-a10b`) were not exercised in this pilot.
- **Queries covered:** 12 of 190 (`factual` category only). The new categories (`it_support`, `long_context`, `cross_institutional`, `dose_critical`, and additional `adversarial` queries) were loaded and validated but were not reached.
- **Runs per cell:** 1 warm run (spec calls for ≥ 10 for publication-grade CIs). All bootstrap CIs in the report reflect this sample size and are annotated as underpowered.
- **Judge disabled:** `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` were not configured in the run environment. `judges.jsonl` is present but empty. Cohen's κ cells are `n/a`.
- **Knowledge corpus not indexed:** The seeded demo database in this environment exposes `PROTOCOL`-domain documents only. Knowledge-route queries (including most `factual`, `differential`, `calibration`, `reasoning_chain`, and `it_support` items) hit the pipeline's "no sources indexed" fallback and do not exercise the Ollama model. This is a property of the demo corpus, not of the harness, and is explicitly documented in `benchmarks/METHODOLOGY.md`.

## How to regenerate the numbers in `report.md`

From `runs.jsonl` and `judges.jsonl` (both append-only) plus the queries/multi-turn datasets whose hashes are pinned in `meta.json`:

```bash
# Using the same git commit recorded in meta.json:
git checkout $(jq -r '.git_commit' meta.json)

# Copy the raw logs back into the harness's expected path:
RUN_ID=$(jq -r '.run_id' meta.json)
mkdir -p benchmarks/results/raw/$RUN_ID
cp runs.jsonl meta.json benchmarks/results/raw/$RUN_ID/
cp judges.jsonl benchmarks/results/raw/$RUN_ID/   # empty here; no judge data

# Re-derive aggregates and the report (pure functions over the raw logs):
npx tsx benchmarks/scripts/aggregate-raw.ts --run-id $RUN_ID
npx tsx benchmarks/scripts/generate-report.ts --run-id $RUN_ID
```

`summary.csv` and `per-query.csv` in this directory are the outputs of `aggregate-raw.ts`. The SVGs in `report-assets/` are the outputs of `generate-report.ts`.

## How to run the full, publication-grade benchmark

The pilot did not run the full spec. To execute the full 9-model × 190-query × 10-warm + 1-cold benchmark as intended:

```bash
# 1. Preflight (reads config/models.yaml, checks wired memory, ollama, embedding provider)
npx tsx benchmarks/scripts/validate-setup.ts

# 2. Start the app server with the benchmark endpoint enabled
ENABLE_BENCHMARK_ENDPOINT=1 npm run dev   # leave running in another terminal

# 3. Kick off the full run (expect ~30-150 hours wall-clock on an M5 Max with Q4_K_M quants;
#    heavy-tier rows dominate. The harness is resumable via --resume <run-id>.)
npx tsx benchmarks/scripts/run-benchmark.ts --models all --runs 10 --seed 20260422

# 4. After the run completes, with ANTHROPIC_API_KEY and OPENAI_API_KEY exported:
npx tsx benchmarks/scripts/run-judge.ts --run-id <run-id>

# 5. Regenerate aggregates and the final report:
npx tsx benchmarks/scripts/aggregate-raw.ts --run-id <run-id>
npx tsx benchmarks/scripts/generate-report.ts --run-id <run-id>
```

Expected judge-scoring cost at 9 × 190 × 10 warm rows plus the deterministic 20% sample: approximately USD 80-120 for Claude Opus primary + GPT backup.

## File manifest

| File | Purpose |
|---|---|
| `report.md` | Generated publication-style report with statistics, tables, and embedded charts |
| `report-assets/*.svg` | Standalone vector charts (pass-rate bars with CIs, latency ECDF, pass-vs-latency scatter, model × category heatmap, stage-latency stacked bars) |
| `summary.csv` | Model-level aggregates (latency percentiles, pass rate, judge means, failure rates) |
| `per-query.csv` | (model × query) aggregates |
| `runs.jsonl` | Raw append-only row log — full provenance, one JSON object per `(model × query × run_number)` attempt |
| `judges.jsonl` | Judge-score sidecar — empty in this pilot |
| `meta.json` | Run parameters, hardware fingerprint, git commit, dataset SHA-256 hashes, ollama version, system-prompt hash |

## Augmented test set — 190 queries

| Category | Count |
|---|---:|
| adversarial | 18 |
| bias_invariance | 12 |
| calibration | 9 |
| citation_integrity | 8 |
| cross_institutional | 14 |
| differential | 6 |
| dose_critical | 20 |
| factual | 12 |
| it_support | 50 (new) |
| long_context | 15 |
| noise_robustness | 7 |
| protocol | 8 |
| reasoning_chain | 6 |
| refusal | 5 |
| **Total** | **190** |

Plus 4 multi-turn sequences (12 turns). The `it_support` category is introduced in this augmentation — see `benchmarks/harness/schema.ts` for the enum and `benchmarks/test_set/queries.jsonl` for the 50 IT-support queries (`bench-it-001` through `bench-it-050`).
