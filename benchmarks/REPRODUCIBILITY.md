# Reproducibility Protocol

Every artifact in this benchmark is content-addressable and deterministic given its inputs. This document states what is pinned, how to reproduce a prior run, and what would count as a "successful replication."

## Pinned artifacts

| Artifact | Hash source | Captured in |
|---|---|---|
| `benchmarks/test_set/queries.jsonl` | SHA-256 | `meta.json.dataset_hashes.queries` |
| `benchmarks/test_set/multi_turn_sequences.jsonl` | SHA-256 | `meta.json.dataset_hashes.multi_turn` |
| `benchmarks/config/judge.yaml` | SHA-256 | `meta.json.dataset_hashes.judge_rubric` |
| `knowledge/prompts/ASSISTANT_SYSTEM_PROMPT.md` | SHA-256 | `meta.json.dataset_hashes.system_prompt` |
| Git commit | `git rev-parse HEAD` | `meta.json.git_commit` |
| Dirty working tree | `git status --porcelain` | `meta.json.git_dirty` |
| Ollama model digest | `ollama show <tag>` | `runs.jsonl[*].ollama_model_digest` |
| Ollama quantization | `ollama show <tag>.details` | `runs.jsonl[*].ollama_model_quant` |
| Hardware chip/RAM/macOS | `sysctl`/`sw_vers` | `meta.json.hardware` |
| Ollama CLI version | `ollama --version` | `meta.json.ollama_version` |

## Deterministic machinery

- **PRNG:** Mulberry32, seeded per routine. Any resampling (bootstrap, permutation, query shuffle) takes an explicit seed exposed at the CLI (`--seed` on `run-benchmark.ts`) and defaulted in `statistics.ts`.
- **Bootstrap iterations:** 5 000 replicates per CI; stable to ±0.005 between seeds on 100-item datasets.
- **SVG rendering:** Pure-TS, no randomness, no time-of-day; identical input bytes yield identical SVG bytes.
- **Temperature:** `0` by default; documented limitation (`benchmarks/METHODOLOGY.md`) because it is not representative of deployment realism but is necessary for across-model comparability.

## Environment pins

- Node: `20.19.0` (`benchmarks/.nvmrc`)
- `benchmarks/package.json` + `benchmarks/package-lock.json` pin the harness deps.
- Root `package-lock.json` pins the API and shared-package deps.
- `benchmarks/Dockerfile` produces a byte-reproducible runtime given an immutable base image tag (we use a Debian-slim Node 20.19.0). To achieve byte-level reproducibility across hosts, pin to `node:20.19.0-bookworm-slim@sha256:<digest>`.

## How to replicate a prior run

1. Check out the exact git commit recorded in the target `meta.json`:
   ```bash
   git checkout <meta.git_commit>
   ```
2. Confirm the dataset hashes match your tree:
   ```bash
   shasum -a 256 benchmarks/test_set/queries.jsonl \
                 benchmarks/test_set/multi_turn_sequences.jsonl \
                 benchmarks/config/judge.yaml
   ```
3. Pull the identical Ollama models:
   ```bash
   ollama pull <tag>      # for each tag in meta.models_run
   ollama show <tag>      # confirm digest matches runs.jsonl.ollama_model_digest
   ```
4. Restore the environment:
   ```bash
   nvm use                           # reads benchmarks/.nvmrc
   npm ci                            # pinned via package-lock.json
   npm install --prefix benchmarks
   ```
5. Validate setup:
   ```bash
   npx tsx benchmarks/scripts/validate-setup.ts
   ```
6. Re-run with the same seed recorded in `meta.cli_args`:
   ```bash
   ENABLE_BENCHMARK_ENDPOINT=1 npm run dev &
   npx tsx benchmarks/scripts/run-benchmark.ts --seed <seed> --runs 3
   ```

## What counts as successful replication

Because the underlying model generation is stochastic (Ollama's sampler) and hardware-dependent (kernels, memory pressure, thermal state), bit-identical replication of raw token sequences is not achievable even at temperature 0. The replication threshold we claim is:

- **Latency:** p95 total time within ±20 % on the same hardware class.
- **Pass rate:** overall pass rate within ±one bootstrap 95 % CI half-width (typically ±5 – 7 % at N = 300 warm rows).
- **Inter-judge κ:** κ on each dimension within ±0.15 of the prior run.
- **Pairwise significance:** the same ordered list of Holm-significant pairs, allowing adjacent pairs to swap rank.

A replication that clears all four of these thresholds is considered faithful.

## What is NOT pinned (and why)

- **Ollama runtime:** versions >= `0.21.0` are assumed. The harness logs the version but does not refuse older versions; replication across major-version boundaries is explicitly out of scope.
- **Embedding provider service latency:** OpenAI or a local embedding server. This affects `stage_timings_ms.embedding` but not the quality signal.
- **Thermal state:** sustained Apple Silicon runs can thermal-throttle. We mitigate by unloading between cold rows, but heavy-tier runs still benefit from cooling pauses.
- **Judge model provider service:** Anthropic-hosted `claude-opus` judgments may drift across minor model updates. Where this matters, re-judge the stored raw responses and append to `judges.jsonl` — raw runs are preserved.

## Artifact paths

- Raw runs: `benchmarks/results/raw/<run-id>/runs.jsonl` (append-only)
- Judge sidecar: `benchmarks/results/raw/<run-id>/judges.jsonl` (append-only)
- Meta: `benchmarks/results/raw/<run-id>/meta.json`
- Aggregates: `benchmarks/results/aggregated/<run-id>/{summary,per-query}.csv`
- Report + charts: `benchmarks/results/reports/<run-id>.md` + `<run-id>.assets/*.svg`

All files in `benchmarks/results/` are gitignored so raw runs do not pollute history; archive them separately if you need to publish them with a paper.
