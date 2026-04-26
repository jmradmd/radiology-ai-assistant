# Local LLM Benchmark Suite

## What this is

This folder contains a reproducible benchmark harness for the Radiology AI Assistant. It measures the full assistant pipeline against locally hosted Ollama models, captures raw row-level logs, derives aggregated latency and quality summaries, and generates a publication-ready markdown report.

## What it answers

The benchmark answers the core deployment-gate question in plain English: which local Ollama models are fast enough to feel sub-10-second in practice while still keeping radiology answers clinically safe and high quality.

## Prerequisites

- macOS with Ollama installed and reachable at `http://localhost:11434`
- The benchmark models from `benchmarks/config/models.yaml` already pulled into Ollama
- The repo dependencies installed with `npm ci`
- `benchmarks/` dependencies installed with `npm install --prefix benchmarks`
- `iogpu.wired_limit_mb` configured to at least `100000`
- `DATABASE_URL` set so the API can query the retrieval database
- An embedding provider configured:
  - `OPENAI_API_KEY`, or
  - `LOCAL_LLM_URL=http://localhost:11434/v1` plus `EMBEDDING_MODEL` such as `qwen3-embedding:0.6b`
- The app server running with `ENABLE_BENCHMARK_ENDPOINT=1`
- `ANTHROPIC_API_KEY` set if you want LLM-as-judge scoring

Recommended startup sequence:

1. `npm ci`
2. `npm install --prefix benchmarks`
3. `ENABLE_BENCHMARK_ENDPOINT=1 LOCAL_LLM_URL=http://localhost:11434/v1 EMBEDDING_PROVIDER=local EMBEDDING_MODEL=qwen3-embedding:0.6b npm run dev`
4. `npx tsx benchmarks/scripts/validate-setup.ts`

## One-command run

```bash
npx tsx benchmarks/scripts/run-benchmark.ts --models all --runs 3
```

Useful variants:

- `npx tsx benchmarks/scripts/run-benchmark.ts --models light --runs 1 --queries factual --skip-judge`
- `npx tsx benchmarks/scripts/run-benchmark.ts --dry-run`
- `npx tsx benchmarks/scripts/run-benchmark.ts --resume <run-id>`

## Interpreting the report

The report is generated from the raw rows and highlights three things:

- Latency: warm `p50` shows the typical feel; warm `p95` tells you whether the model is stable enough for deployment.
- Quality: pass rate is the practical gate because it combines latency, deterministic safety checks, retrieval expectations, and judge scores.
- Failure modes: timeouts, dangerous-output rate, and dominant failure mode tell you why a model misses the gate.

Numbers to trust most:

- Warm `total_s_p95`
- Overall pass rate
- Judge safety mean
- Dangerous-output rate

Numbers to distrust if they look too clean:

- Any single cold-start result
- Judge-only improvements without corresponding programmatic gains
- A model whose median passes the latency gate but whose `p95` does not

## Re-running only the judge after a failure

```bash
npx tsx benchmarks/scripts/run-judge.ts --run-id <run-id>
```

This rescans `runs.jsonl`, finds warm rows without `judge_scores`, and fills them in atomically.

## Adding a model

1. Add the exact Ollama tag to `benchmarks/config/models.yaml`.
2. Pull the model into Ollama.
3. Re-run `validate-setup.ts` to confirm it appears in `ollama list`.
4. Run a focused smoke benchmark before including it in an all-model report.

## Adding a query

1. Add a standalone case to `benchmarks/test_set/queries.jsonl`, or add a sequence to `multi_turn_sequences.jsonl`.
2. Keep the schema valid and add explicit expected behavior fields.
3. If the query depends on a specific seeded document, add `sourceMustInclude`.
4. Re-run `npm run test:bench`, then a narrow dry run such as `--queries <new-id>`.

## Troubleshooting

- Ollama OOM or `unable to load model`: reduce model tier or close other GPU users; the harness will log `ollama_oom`.
- Endpoint returns `FORBIDDEN`: start the app with `ENABLE_BENCHMARK_ENDPOINT=1`.
- Judge rate limits or missing scores: re-run `run-judge.ts` after restoring API access.
- `DATABASE_URL` missing: the benchmark endpoint can start but every row will fail at retrieval; export the database URL before starting the app.
- Embedding provider missing: set either `OPENAI_API_KEY` or local embedding env vars before starting the server.
- Missing model warnings in setup: the harness will skip missing tags instead of crashing the full run.
- No knowledge answers: if the knowledge corpus is not indexed, knowledge-route rows will degrade or return unavailability messaging.

## Citation

BibTeX stub:

```bibtex
@misc{radiology_ai_assistant_local_benchmark_2026,
  title        = {Reproducible Local-LLM Benchmarking for a Radiology AI Assistant},
  author       = {Radiology AI Assistant Team},
  year         = {2026},
  note         = {Methods note benchmark harness in benchmarks/}
}
```

## Workflow Summary

1. Validate the machine with `validate-setup.ts`.
2. Start the app with the benchmark endpoint enabled.
3. Run the benchmark.
4. If needed, backfill judges with `run-judge.ts`.
5. Regenerate aggregates with `aggregate-raw.ts`.
6. Generate the paper-facing markdown with `generate-report.ts`.
