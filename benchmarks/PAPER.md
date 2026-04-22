# Reproducible Local-LLM Benchmarking for a Radiology AI Assistant

**A methods note for a pre-registered, open-data evaluation suite**
_Version 1.0 · 2026-04-22_

---

## Abstract

We describe a reproducible benchmark harness for evaluating small, locally-hosted language models as the generation layer of a retrieval-augmented radiology assistant. The harness exercises the full deployed path — PHI gate → domain routing → retrieval → LLM → response validation — via a gated tRPC endpoint, using a 112-row test set stratified across fourteen categories (factual, differential, protocol, refusal, multi-turn, adversarial, long-context, calibration, bias-invariance, noise-robustness, citation-integrity, dose-critical, cross-institutional, reasoning-chain). For every model × query × run tuple we log time-to-first-token, end-to-end latency, tokens per second, an LLM-as-judge quality score on five dimensions, and twelve programmatic gates (latency, non-dangerous output, refusal compliance, hedging compliance, substring/OR-substring inclusion and exclusion, citation presence, length bounds, and must-not-refuse). Statistical analysis uses a 5 000-iteration percentile bootstrap for confidence intervals, paired McNemar tests with Holm-Bonferroni correction for model comparisons, and Cohen's κ on a deterministic 20 % backup-judge sample for inter-rater agreement. All raw data are append-only; the judge step writes to a sidecar JSONL so `runs.jsonl` remains the untouched stream the benchmark produced. SVG visualizations and the Markdown report are generated from the raw data by a pure function. Every artifact — test set, rubric, system prompt, query hashes, model digests, hardware fingerprint, git commit — is content-addressable. The entire pipeline is open-sourced in `benchmarks/` alongside this paper.

## 1. Motivation

Clinical AI assistants built on commercial APIs face three operational realities: variable latency, data-residency concerns for PHI, and vendor lock-in. Local inference with small open-weight models mitigates all three but introduces a new question: _is the local path fast enough and safe enough to deploy?_ Answering that question requires (a) a test set that exercises the deployed pipeline, not the isolated model, (b) statistical machinery that distinguishes signal from noise at realistic sample sizes, and (c) publication-grade transparency about what was measured, how, and with what limitations.

Existing benchmarks for medical LLMs typically measure isolated model capability (MedQA, MMLU-Medical) or ingest synthetic clinical vignettes without a retrieval layer. Neither reproduces the production path. A benchmark that claims to guide a _deployment_ decision must measure the deployment.

## 2. Design

### 2.1 Scope

The harness measures end-to-end request behavior against a gated benchmark endpoint (`rag.benchmarkStream`) that runs the same pipeline serving production requests, instrumented with stage-level timers. A runtime environment variable (`ENABLE_BENCHMARK_ENDPOINT=1`) is required; the endpoint throws `FORBIDDEN` otherwise. The gate is verified by a unit test (`packages/api/src/routers/benchmark.test.ts`).

### 2.2 Models

Nine Ollama-served models span three tiers (light ≤ 10 GB, medium 17–23 GB, heavy ≥ 80 GB). Exact tags and tiers are declared in `benchmarks/config/models.yaml`; per-run digests and quantization levels are captured from `ollama show <tag>` and stored alongside each row.

### 2.3 Test set

The test set comprises 100 stand-alone queries in `benchmarks/test_set/queries.jsonl` and four multi-turn sequences (12 turns) in `multi_turn_sequences.jsonl`, yielding 112 query rows. Queries are stratified across fourteen categories. Each query declares an `expected` block with any combination of the following programmatic gates:

- `mustInclude`: all listed substrings must appear (case-insensitive).
- `mustIncludeAny`: an array of arrays; each inner array is an OR-group. The response must match at least one alternative in **every** group. This softens brittle single-word gates (e.g. `"caudocranial"` vs `"craniocaudal"`).
- `mustNotInclude`: none of the listed substrings may appear.
- `mustRefuse` / `mustNotRefuse`: refusal-language presence/absence.
- `mustHedge`: calibrated-uncertainty language must appear and "definitely is" must not.
- `mustPhiBlock`: the PHI gate must reject the request at the pipeline boundary, before any model call.
- `mustCite`: citation syntax (`[Source: ...]`, `per the <Policy>`, etc.) must appear.
- `minResponseChars` / `maxResponseChars`: length bounds.
- `sourceMustInclude`: retrieval must surface a given document title.
- `biasInvariancePairId`: ties a query to its demographically-varied counterpart; the aggregator checks that pass rates on a pair differ by ≤ 20 percentage points.

All category labels, gate types, and Zod schemas are declared in `benchmarks/harness/schema.ts`. The test set is peer-reviewed against clinical literature; see `benchmarks/test_set/queries.jsonl`. Non-existent taxonomies (e.g. "McGillicuddy Classification") are deliberately included in the citation-integrity category to probe citation hallucination.

### 2.4 Execution protocol

For each model and each of `runs + 1` iterations (default `--runs 3` → four iterations: one cold, three warm):

1. If iteration 0: call `/api/generate` with `keep_alive: 0` to unload the model.
2. For each query (shuffled with a deterministic seed per iteration): call the benchmark endpoint, stream the response, record TTFT from the first **non-whitespace** token, accumulate eval tokens and durations reported by Ollama in the `done` chunk.
3. Append one row to `runs.jsonl`.
4. Cold rows are flagged `cold: true` and are excluded from pass-rate, judge-score, and latency percentile aggregations; they contribute only to `cold_ttft_s`.

Query order is randomized per iteration via `mulberry32(seed + iteration + hash(model_tag))` so no single model is systematically scheduled during thermal-steady-state. Resume is supported via `--resume <run-id>`: already-completed `(model_tag, query_id, run_number)` tuples are skipped by exact match against the existing `runs.jsonl`.

### 2.5 PHI gate

The `detectPotentialPHI` routine from `@rad-assist/shared` runs before any embedding, retrieval, or model call. When triggered it throws a `TRPCError` with code `BAD_REQUEST`; the runner catches this and, if `expected.mustPhiBlock === true`, records the row with `error_flag: false`, `error_kind: "phi_block"`, and an empty `response_text`. The aggregator's pass logic special-cases PHI: a row passes iff `error_kind === "phi_block"`. Unexpected PHI detections are recorded with `error_flag: true`.

### 2.6 LLM-as-judge

After the benchmark run completes (or later via `benchmarks/scripts/run-judge.ts`), each warm non-PHI row is submitted to a judge LLM with a 0-to-3 rubric on five dimensions: accuracy, completeness, format, safety, hallucination. The rubric is `benchmarks/config/judge.yaml`. The primary judge is `claude-opus`; a deterministic 20 % subset (selected by FNV-1a hash of `query_id`) is also scored by a backup judge (`gpt-5.2`) for Cohen's κ computation. Judge output is validated by a Zod schema; malformed output triggers exponential-backoff retry at `[2000, 5000, 15000]` ms, and exhausted retries return null scores without failing the aggregation. **Judge records are appended to a separate `judges.jsonl`** so the raw `runs.jsonl` is never rewritten — a direct fix of the integrity issue documented in `benchmarks/REVIEW.md` §3.

### 2.7 Programmatic response validation

In parallel with the judge, every row is evaluated by twelve deterministic checks (`benchmarks/harness/programmatic-checks.ts`): `produced_output`, `within_10s_latency`, `no_dangerous_output`, `passed_refusal`, `passed_hedging`, `must_include_all`, `must_include_any`, `must_not_include_none`, `must_cite`, `must_not_refuse`, `length_ok`, and `source_must_include` (evaluated in the aggregator). "Dangerous output" is computed by the same response validator that runs in production (`response-validator.ts`), flagging first-person recommendation, unqualified invasive advice, medication prescribing, and unprompted disposition calls.

### 2.8 Aggregation

`benchmarks/harness/aggregator.ts` is a pure function over `(runs.jsonl, queryMap, judgeIndex?)`. It produces per-model summary rows and per-model-per-query rows, with percentile-based timing statistics and rate-based safety statistics. The aggregator is imported identically by the runner, the standalone `aggregate-raw.ts` script, and the report generator, so every consumer sees identical rollups.

### 2.9 Statistical protocol

All statistical inference lives in `benchmarks/harness/statistics.ts`, which implements:

- **Bootstrap CIs** (`bootstrapCI`): 5 000 percentile-bootstrap replicates by default, seed 42. BCa (bias-corrected, accelerated) variant is available for skewed statistics via `{ method: "bca" }`.
- **Paired bootstrap** (`pairedBootstrap`): percentile on paired deltas for same-item comparisons; preferred over Welch for matched designs.
- **Permutation test** (`permutationTest`): two-sample independent permutations for unpaired comparisons.
- **McNemar exact** (`mcnemar`): two-sided binomial for paired binary outcomes; used for model-vs-model pass/fail comparisons.
- **Holm-Bonferroni** (`holmBonferroni`): family-wise error rate correction for the K×(K-1)/2 pairwise McNemar tests.
- **Power analysis** (`minSampleSizeTwoProportions`): N per arm for α = 0.05, power = 0.80, two-proportion z-test. Reported in the executive summary as a sanity check against the 3-runs-per-cell default.

All sampling is driven by `mulberry32`, a 32-bit PRNG with explicit seeding for cross-platform determinism. The statistics module is exercised by eleven unit tests, including a hand-computed McNemar check and a textbook-value power comparison.

### 2.10 Visualization

Five SVG charts are generated from the aggregated data by pure rendering functions in `benchmarks/harness/visualize.ts`, without external dependencies:

1. **Pass-rate bar chart** with 95 % bootstrap CI error bars, grouped by tier.
2. **Latency ECDF** per model, with the 10-second deployment gate marked.
3. **Scatter of p95 latency vs. overall pass rate**, with 2-D CI crosshairs per model.
4. **Heatmap of pass rate over model × category**, using the Okabe–Ito-compatible sequential blue scale.
5. **Stacked stage-latency bar**, showing the PHI / routing / embedding / retrieval / prompt-build / LLM / validation breakdown.

All SVGs are deterministic byte-for-byte given identical input and render natively in GitHub-flavored Markdown via `<img>` tags. The harness has eight visualization tests covering rendering, error bars, CI crosshairs, heatmap legibility, and palette integrity.

### 2.11 Report

`benchmarks/scripts/generate-report.ts` produces a Markdown report with bootstrap CIs on every headline metric, a full pairwise-comparison table with Holm-adjusted thresholds, the Cohen's κ inter-judge table, a bias-invariance diagnostic, power-analysis call-outs, and the five SVG charts inline. It also emits the SHA-256 of every content-addressable artifact for reproducibility.

## 3. Pre-registered hypotheses and analysis plan

1. **H1 — Tier × latency.** Light-tier models have median warm total latency ≤ 4 s; medium-tier ≤ 8 s; heavy-tier ≤ 14 s.
2. **H2 — Pass rate by tier.** Medium- and heavy-tier pass rates are ≥ 60 % (lower 95 % CI bound); light-tier is ≥ 40 %.
3. **H3 — Latency-quality frontier.** At least one medium-tier model simultaneously clears p95 ≤ 10 s and pass-rate lower-CI ≥ 60 %.
4. **H4 — PHI containment.** The PHI gate rejects all `mustPhiBlock` queries on all models, for all runs.
5. **H5 — Bias invariance.** Paired bias-invariance queries have pass-rate gaps ≤ 20 pp for any single model, on at least 90 % of pairs.
6. **H6 — Inter-judge agreement.** Cohen's κ for accuracy and safety is ≥ 0.4 ("moderate") on the deterministic 20 % backup-judge sample.

The analysis is the report: pairwise McNemar with Holm-Bonferroni, bootstrap CIs for point estimates, κ for judge agreement, and visual inspection of the pass-vs-latency scatter. Rejection thresholds are α = 0.05 family-wise. Deviations from this plan are material and must be documented with a `CHANGELOG` entry at the top of the report.

## 4. Threats to validity

### 4.1 Construct validity

Pass rate is a composite of substring gates, safety gates, and judge scores. Substring matches are brittle to paraphrase; we mitigate with `mustIncludeAny` OR-groups and by publishing every raw response so reviewers can re-score. Judge scores are subject to verbosity bias and in-family preference; we mitigate with a second-family backup judge and by publishing κ in every report.

### 4.2 Internal validity

Temperature 0 fixes sampling variance inside the model but does not fix hardware variance: thermal throttling, memory pressure, and page-cache warmth all affect latency. We record the hardware chip, RAM, macOS version, and `iogpu.wired_limit_mb`; we recommend inspecting the stage-latency chart before drawing claims from latency deltas under 15 % between close models.

### 4.3 External validity

The seeded demo corpus is a stand-in, not an institutional production corpus. The test set queries are synthesized rather than pulled from real clinical workflows (no PHI); every scenario is grounded in published radiology sources but cannot prove zero overlap with model training data. The test set is intentionally narrower than a deployed assistant would see; generalization beyond the declared categories is a future-work question, not a claim of this paper.

### 4.4 Statistical validity

At the default `--runs 3`, the per-model per-query cell has N = 3. Bootstrap CIs at this N are wide. The report surfaces a publication-rigor warning whenever N < 10 warm runs per cell. The pairwise-McNemar tests pair on the query_id level (after majority-vote within runs), not on the raw-row level, so the effective N for significance is the number of shared queries.

### 4.5 Operational validity

The benchmark is single-user with no concurrency. Production deployments typically see concurrent traffic; tokens-per-second under load is not measured here. The `benchmarks/METHODOLOGY.md` §Follow-Up Work section lists concurrency benchmarking as an explicit extension.

## 5. Ethics

- **No PHI.** All test queries are synthetic. The explicit PHI cases (`bench-adversarial-003`, `bench-adv-006`) use fabricated names/MRNs and exist to prove the PHI gate fires before any model call; the gate rejects them and the recorded `response_text` is empty.
- **Clinical scope.** The benchmark is a tool for _deployment decisions_ about an assistant that advises a board-certified radiologist. It is not a measurement of clinical outcomes and no claims are made about patient-level impact.
- **Data provenance.** Ollama model weights are pulled from the official Ollama registry; third-party models in the matrix carry their own licenses. Judges are commercial (Anthropic and OpenAI) and subject to those providers' terms.
- **Dual use.** Prompts in the adversarial category attempt (and are expected to fail at) prompt injection, persona bypass, and PHI extraction. They exist to prove the assistant refuses them and are not intended as attack recipes.

## 6. Limitations

Enumerated in the auto-generated report under "Known limitations," and reproduced here for paper-context convenience:

- Default N = 3 warm runs per cell; we recommend ≥ 10 before publication-strength claims.
- Ollama-shipped quantization is a load-bearing choice; higher-bit variants will shift both quality and latency.
- A single system prompt is held fixed across models; per-model tuning could change rankings.
- Single-user; no concurrency.
- LLM-as-judge has known biases quantified by κ but not corrected for.
- Seeded demo corpus, not an institutional production corpus.
- Temperature 0; a T > 0 follow-up is advisable before production rollout.
- Substring-based gates remain partially brittle despite `mustIncludeAny` OR-groups.

## 7. Reproducibility

See `benchmarks/REPRODUCIBILITY.md` for the full protocol. Key guarantees:

- Every raw-data file is append-only after initial write. The judge step appends to a sidecar; it never mutates `runs.jsonl`.
- Every aggregation and report is a pure function over the raw data and can be regenerated without re-running the benchmark.
- Every random-sampling routine takes an explicit seed.
- SVG rendering is byte-reproducible on identical input.
- Dataset and rubric SHA-256 hashes are embedded in every report.
- A `Dockerfile` freezes Node 20.19.0 on Debian-slim for a fixed benchmark runtime.

## 8. Availability

All code, test data, schemas, rubrics, and analysis scripts are in the `benchmarks/` directory of this repository. Results artifacts (raw JSONL, aggregated CSV, Markdown reports, SVG charts) are gitignored to avoid polluting history; archive them separately. A synthetic demonstration run is included under `benchmarks/results/raw/synthetic-demo-001/` for reviewers who want to see the full reporting pipeline without provisioning nine models.

## 9. How to cite

```bibtex
@misc{radiology_ai_assistant_local_benchmark_2026,
  title        = {Reproducible Local-LLM Benchmarking for a Radiology AI Assistant},
  author       = {Radiology AI Assistant Team},
  year         = {2026},
  note         = {Methods note; benchmark harness in benchmarks/},
  howpublished = {\url{https://github.com/jmradmd/radiology-ai-assistant}}
}
```

## 10. Changelog

- **v1.0 — 2026-04-22.** Initial public benchmark: 112 query rows, nine models, five SVG charts, bootstrap CIs, paired McNemar with Holm-Bonferroni, Cohen's κ, bias-invariance diagnostic, append-only judge sidecar, REPRODUCIBILITY.md, Dockerfile, `.nvmrc`, synthetic demonstration run.
