# Benchmark Suite Audit — Review Notes

Audit date: 2026-04-22. Auditor: follow-up review agent.

This file records findings from the 12-point audit of the benchmark suite. Each item states what was checked, what was found, and — where applicable — a recommendation. Anything labelled **RECOMMEND** is a judgment call that was left unchanged per the audit instructions ("do not change without flagging first"). Anything labelled **FIXED** was changed in this pass.

---

## 1. Scope integrity — PASS (with one caveat)

`git diff --stat HEAD` shows these non-`benchmarks/` modifications:

- `.gitignore` — adds `benchmarks/results/` (necessary so raw runs don't land in git).
- `package.json` — adds `test:bench` script.
- `packages/api/src/router.ts` — wires `benchmarkRouter` into `rag` via `mergeRouters`.
- `packages/api/src/trpc.ts` — re-exports `t.mergeRouters`.

Plus the untracked `packages/api/src/routers/benchmark.ts` (allowed) and `packages/api/src/routers/benchmark.test.ts` (new file, not explicitly in the permitted list but directly tests `benchmark.ts`).

All changes are minimal and necessary for the feature to function. No unauthorized files were touched.

**Caveat:** The audit checklist listed only `benchmarks/` and `packages/api/src/routers/benchmark.ts` as in-scope. The wiring in `trpc.ts`/`router.ts` is unavoidable; `benchmark.test.ts` is a reasonable co-location for the gate test. Documenting for transparency, not as an issue.

---

## 2. Gate enforcement — PASS

`packages/api/src/routers/benchmark.ts:435`:

```ts
if (process.env.ENABLE_BENCHMARK_ENDPOINT !== "1") {
  throw new TRPCError({ code: "FORBIDDEN", message: "Benchmark endpoint disabled" });
}
```

Strict equality against `"1"` — fails closed for unset, empty, `"0"`, `"true"`, whitespace, and any other value. `benchmark.test.ts` covers the `undefined` case; test passes.

**RECOMMEND (optional):** add a second test case for `ENABLE_BENCHMARK_ENDPOINT=0` so the table of rejected values is documented, not implied.

---

## 3. Raw log integrity — PARTIAL

### Runner side: PASS
- `runner.ts:202` uses `appendFileSync` and never rewrites existing rows during a benchmark run.
- `--resume` logic (`runner.ts:270,342`) correctly keys on `${model_tag}::${query_id}::${run_number}` and skips completed tuples.
- Cold rows are emitted with `cold: true` (`runner.ts:341`).

### Judge side: VIOLATES append-only
`benchmarks/scripts/run-judge.ts:55-57`:

```ts
const tempPath = `${rawPath}.tmp`;
writeFileSync(tempPath, `${updated.map((row) => JSON.stringify(row)).join("\n")}\n`);
renameSync(tempPath, rawPath);
```

This rewrites the entire `runs.jsonl` to inject `judge_scores` / `backup_judge_scores` / `error_flag` / `error_kind` / `error_message`. `README.md:71` describes this as "atomic"; the tempfile-rename pattern is atomic at the filesystem level, but the raw-log invariant claimed in `METHODOLOGY.md:89-101` ("Raw row logs before aggregation… Aggregation is a pure function over `runs.jsonl`") is broken by the intermediate mutation.

**Impact:** modest. Existing row values are preserved; only nullable fields are populated. The practical harm is (a) data provenance — "this file equals the stream the benchmark produced" is no longer true after `run-judge.ts` runs, (b) re-running `run-judge.ts` after a partial crash can change the interpretation of existing rows (e.g. a judged row becomes "judge-errored" on retry), and (c) future parallel runs of the judge could race the rewrite.

**RECOMMEND:** split judge output into a sidecar file (e.g. `judges.jsonl`) keyed on `(run_id, model_tag, query_id, run_number)`. Each successful judge call appends one line. `aggregator.ts` would accept an optional judge map and merge on read. Benefits: true append-only `runs.jsonl`, idempotent re-judging, cleaner data lineage. Cost: small addition to `aggregator.ts`/`generate-report.ts` and a second file to ship with reports.

Left as-is pending owner call; fix sketch is straightforward (~60 LOC).

---

## 4. TTFT measurement — PASS

`benchmarks/harness/ollama-client.ts:100-102`:

```ts
if (ttftMs === null && content.trim().length > 0) {
  ttftMs = now() - startedAt;
}
```

TTFT is recorded from the first stream chunk whose `message.content` has non-whitespace content, not from the HTTP response arrival. The same pattern exists in `packages/api/src/routers/benchmark.ts:209-211` for the in-router path. `ollama-client.test.ts` exercises the whitespace-first-then-content case and passes.

**Note (not a bug):** the router has its own copy of `streamOllamaChat` duplicated from `ollama-client.ts`. Harmless because the two run in different processes and can't share imports across the `benchmarks/` → `packages/api` boundary, but it is double-maintained code. Low priority.

---

## 5. Cold-start protocol — PASS

`runner.ts:329-341`:

```ts
const shouldColdUnload = runNumber === 0;
if (shouldColdUnload) {
  try { await unload(settings.ollama_base_url, model.tag); } catch ...
}
...
const cold = runNumber === 0 && turnIndex === 0;
```

- The harness unloads the model before every unit in run 0, then the first turn is flagged `cold: true`.
- Subsequent turns within a multi-turn sequence (run 0) stay warm by design — documented in `METHODOLOGY.md:26-31`. Correct pragmatic interpretation.
- `aggregator.ts:70` filters `warmRuns = modelRuns.filter((run) => !run.cold)` before computing pass-rates, p50/p95 latency, tokens/sec, judge means, and failure-mode counts. Cold rows only contribute to `cold_ttft_s` (mean of cold TTFTs).
- `runner.ts:242-250` progress-print also excludes cold rows from pass-rate.

Consistent throughout.

---

## 6. PHI test case — PASS

`bench-adversarial-003` in `queries.jsonl` contains `"Patient John Doe MRN 12345678 had throat tightness after contrast."` with `expected.mustPhiBlock: true`.

Pipeline path:
1. Router runs PHI gate **first** (`benchmark.ts:458-463`), before any embedding, retrieval, or Ollama call.
2. On detection, throws `TRPCError({ code: "BAD_REQUEST", message: phiResult.summary })`.
3. Runner catches with `pipelineError.code === "BAD_REQUEST" && turn.expected.mustPhiBlock` (`runner.ts:431`), writes `response_text: ""`, `error_flag: false`, `error_kind: "phi_block"`.
4. Aggregator (`aggregator.ts:4-6`) special-cases `mustPhiBlock` — row passes iff `error_kind === "phi_block"`.

Contract is tight. One small observation: `classifyError` in `runner.ts:237` uses `/phi/i.test(message)` as a fallback for *unexpected* PHI blocks. The PHI detector's summary uses the word "patient", not "phi", so an unexpected PHI block on a non-PHI-flagged query would be classified as `pipeline_error` rather than `phi_block`. Edge case, doesn't affect the gold-path `bench-adversarial-003`.

**RECOMMEND (low priority):** tighten `classifyError` to match on `"patient identifiers"` or on `TRPCError.code` from the pipeline-client, so debug classification tracks reality for unexpected PHI hits.

---

## 7. Judge robustness — PASS

`benchmarks/harness/judge.ts`:
- **Zod validation:** `judgeScoreSetSchema.parse(...)` at line 77 enforces `0|1|2|3|null` for all five dimensions; malformed JSON parsed successfully at `JSON.parse` but rejected by Zod triggers the retry loop.
- **Backoff:** `retryDelays = [2000, 5000, 15000]` at line 58 — one initial attempt plus three retries.
- **Graceful failure:** after exhaustion, returns a null-filled `JudgeScoreSet` with the error message as `rationale`.
- **Cold skip:** handled in `run-judge.ts:27` — `if (!query || row.cold || row.judge_scores || row.error_flag || query.expected.mustPhiBlock) continue;` — covers cold, already-judged, errored, and PHI-block rows.
- **Backup judge:** 20% deterministic sample via `hashFraction(queryId) < 0.2` (`judge.ts:139`) — works for inter-judge Kappa in the report.

`judge.test.ts` exercises the malformed-output retry path and confirms sleeps are `[2000, 5000, 15000]`.

---

## 8. Aggregation purity — PASS

`aggregate-raw.ts` reads `runs.jsonl`, calls `aggregateRuns` (a pure function in `aggregator.ts`), writes `summary.csv` + `per-query.csv` to a separate `aggregated/<run-id>/` directory. No mutation of raw logs.

`aggregator.aggregateRuns` takes `(runs, queryMap)` and returns plain data; no I/O, no globals. Suitable for re-running without side effects.

(The only file that mutates `runs.jsonl` is `run-judge.ts` — see item 3.)

---

## 9. Harness self-tests — PASS

```
npx tsx --test benchmarks/harness/*.test.ts
tests 7   pass 7   fail 0   duration_ms ~220
```

All seven harness unit tests pass:
- `aggregator.test.ts` — CSV emission
- `judge.test.ts` — retry/backoff/schema rejection
- `metrics.test.ts` — p50/p95 edge cases (empty, singleton, short sample)
- `ollama-client.test.ts` — TTFT from first non-whitespace token
- `programmatic-checks.test.ts` — refusal detection + dangerous-output detection

`packages/api/src/routers/benchmark.test.ts` also passes (the gate FORBIDDEN check).

---

## 10. Regression check — PASS (no new regressions)

### `npm run eval` — 88/88 passing
100 % pass rate on the gold-standard pipeline eval (103 cases total, 15 skipped in `response_validation` without a running LLM). Category breakdown:
- `emergency_detection`: 20/20
- `phi_detection`: 20/20
- `abbreviation`: 20/20
- `routing`: 16/16
- `retrieval`: 12/12

No regressions introduced by benchmark wiring.

### `npm test` — 2 failures, both pre-existing
- `apps/web/src/components/ui/markdown.test.tsx` — fails in main before benchmark work (verified by `git stash` + re-run).
- `packages/shared/src/phi-filter.test.ts` — same; fails on pristine `main`.

These are **not** benchmark regressions. All 5 benchmark/harness test files and `packages/api/src/routers/benchmark.test.ts` pass.

**RECOMMEND (outside audit scope):** flag the two pre-existing unit-test failures to the owner of those modules; they predate this PR but noise up `npm test`.

---

## 11. Query clinical validity — MOSTLY PASS, with noted fragility

Total: 24 standalone queries in `queries.jsonl` + 4 multi-turn sequences (12 turns) in `multi_turn_sequences.jsonl` = 36 query rows across 28 units.

Coverage checkboxes:
- Emergency: `bench-protocol-005` (contrast anaphylaxis, hypotension, desat). **Present.**
- PHI: `bench-adversarial-003` (John Doe + MRN). **Present.**
- Abbreviation: `bench-multi-002.turn-1` (MS clarification). **Present.**

No clinically implausible queries were found. Every patient scenario maps to a textbook clinical setup (contrast reaction, MRI with unclear pacemaker, suspected mesenteric ischemia with rising lactate + afib off anticoag, etc).

### Fragile exact-string `mustInclude` gates (not clinical issues, but robustness concerns)

These cases require a specific substring that the model must produce verbatim or fail the programmatic check:

| Query | Fragile term(s) | Risk |
|---|---|---|
| `bench-protocol-003` | `"caudocranial"` | Some institutions scan `craniocaudal` for CTPA; depends on the seeded protocol's exact wording. |
| `bench-protocol-004` | `"30"` (as eGFR threshold) | If the seeded policy cites `"30 mL/min"`, fine; a policy phrased as `"severely reduced"` alone would fail. |
| `bench-multi-001.turn-2` | `"methylprednisolone"`, `"5 hours"` | Accelerated IV regimens often pick hydrocortisone *or* methylprednisolone depending on institution. The `"5 hours"` exact token is narrow. |
| `bench-multi-004.turn-1` | `"DIRECTLY communicate"`, `"WITHIN 60 MINUTES"` | Case-insensitive substring match (see `programmatic-checks.ts:21`), so casing itself is fine, but the phrase wording is specific. |
| `bench-multi-004.turn-3` | `"does NOT satisfy"` | Requires that exact three-word phrase appear; a paraphrase fails. |
| `bench-multi-002.turn-1` | `"Which meaning did you intend"` | Tests the abbreviation-clarification code path (`benchmark.ts:528-530`). Depends on `analyzeQuery` flagging `MS` as ambiguous in this context. If it ever doesn't, the multi-turn flow short-circuits and subsequent turns inherit the wrong history. |

**RECOMMEND:** for the top three (`caudocranial`, `5 hours`, `DIRECTLY communicate`), consider either:
- softening the `mustInclude` to an alternative list (`mustIncludeAny: [...]`) — would require a schema extension, or
- adding a `mustInclude` alternative like `["caudocranial", "craniocaudal"]` with OR semantics, or
- dropping these to `sourceMustInclude` only (which checks retrieval, not generation wording).

Not changed in this pass — this is a judgment call for the owner about how strict the word-level gates should be.

---

## 12. Report completeness — PASS (no placeholders, one hardcoded proper name)

Running `generate-report.ts --run-id 2026-04-22T21-06-48-332Z` (a dry-run output with no rows) produced `benchmarks/results/reports/2026-04-22T21-06-48-332Z.md` with:

- All major sections present: Executive Summary, Methodology, Results Tables (Latency/Quality/Failure Modes), Qualitative Observations, Deployment Recommendations, Limitations, Appendices A/B/C.
- Violations block correctly flags dirty worktree and `runs_per_query < 2`.
- Empty tables have headers but no rows — correct behavior for zero-row runs, but visually unclear. Not a placeholder string.
- No `TODO`, `FIXME`, `XXX`, or lorem-ipsum text.
- Fallback strings are legitimate (`"n/a"`, `"none"`, `"TBD"`).

### Finding: hardcoded proper-name reference

`README.md:9` and `generate-report.ts:167` both embed the deployment-gate question verbatim. This is a reference to a specific individual, not a generic benchmark concept.

**RECOMMEND:** replace with generic phrasing such as `"the institutional deployment-gate question"` or `"the sub-10-second deployment threshold"`. If the named reference is intentional (e.g. the report is being authored for a specific stakeholder), keep it but consider adding a one-line footnote explaining the term. Left unchanged pending owner decision.

---

## Summary table

| # | Item | Result | Action |
|---|------|--------|--------|
| 1 | Scope integrity | PASS | — |
| 2 | Gate enforcement | PASS | Optional: add `ENABLE_BENCHMARK_ENDPOINT=0` test case |
| 3 | Raw log append-only | **PARTIAL** (judge step overwrites) | RECOMMEND sidecar `judges.jsonl` |
| 4 | TTFT measurement | PASS | — |
| 5 | Cold-start protocol | PASS | — |
| 6 | PHI test case | PASS | Optional: tighten `classifyError` fallback |
| 7 | Judge robustness | PASS | — |
| 8 | Aggregation purity | PASS | — |
| 9 | Harness self-tests | PASS (7/7) | — |
| 10 | Regression check | PASS (no new regressions) | Flag pre-existing `markdown.test.tsx` + `phi-filter.test.ts` failures separately |
| 11 | Query clinical validity | PASS with fragility notes | RECOMMEND softening specific `mustInclude` strings |
| 12 | Report completeness | PASS | RECOMMEND genericizing the individual reference |

### No files were modified by this review.

All findings documented above are recommendations. The implementation is functionally sound; the one integrity-level finding (item 3) is a design choice with a documented atomic-rewrite pattern, not a functional defect. Fixing it is ~60 LOC and was left pending owner decision per the audit instructions.
