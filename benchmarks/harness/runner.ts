import { createHash } from "crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import YAML from "yaml";
import { listModels, showModel, unload } from "./ollama-client";
import { callBenchmarkStream, PipelineClientError } from "./pipeline-client";
import { evaluateProgrammaticChecks } from "./programmatic-checks";
import { aggregateRuns } from "./aggregator";
import { buildJudgeIndex, loadJudgeRecords } from "./judge-store";
import { benchmarkModelsFileSchema, judgeConfigSchema, multiTurnCaseSchema, queryCaseSchema, rawRunSchema, runMetaSchema, settingsSchema } from "./schema";
import type {
  BenchmarkModelConfig,
  BenchmarkRunOptions,
  ExecutionQuery,
  ExecutionUnit,
  JudgeConfig,
  QueryCase,
  RawRun,
  RunMeta,
  SettingsConfig,
} from "./types";

const HARNESS_DIR = fileURLToPath(new URL(".", import.meta.url));
export const BENCHMARK_ROOT = resolve(HARNESS_DIR, "..");
export const REPO_ROOT = resolve(BENCHMARK_ROOT, "..");
export const DEFAULT_RESULTS_ROOT = resolve(BENCHMARK_ROOT, "results");

function readYamlFile<T>(path: string, schema: { parse: (value: unknown) => T }): T {
  return schema.parse(YAML.parse(readFileSync(path, "utf-8")));
}

function readJsonl<T>(path: string, parser: (line: unknown) => T): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => parser(JSON.parse(line)));
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function slugifyRunId(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function nowUtc(): string {
  return new Date().toISOString();
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function parseJsonlQueries(): { standalone: QueryCase[]; multiTurn: ExecutionUnit[] } {
  const standalonePath = resolve(BENCHMARK_ROOT, "test_set", "queries.jsonl");
  const multiTurnPath = resolve(BENCHMARK_ROOT, "test_set", "multi_turn_sequences.jsonl");

  const standalone = readJsonl(standalonePath, (line) => queryCaseSchema.parse(line));
  const multiTurnCases = readJsonl(multiTurnPath, (line) => multiTurnCaseSchema.parse(line));

  const multiTurn: ExecutionUnit[] = multiTurnCases.map((sequence) => ({
    id: sequence.id,
    category: "multi_turn",
    turns: sequence.turns.map((turn, index) => ({
      query_id: `${sequence.id}.turn-${index + 1}`,
      category: "multi_turn",
      query: turn.user,
      expected: turn.expected,
      notes: sequence.notes,
    })),
  }));

  return { standalone, multiTurn };
}

export function buildStandaloneUnits(cases: QueryCase[]): ExecutionUnit[] {
  return cases.map((query) => ({
    id: query.id,
    category: query.category,
    turns: [
      {
        query_id: query.id,
        category: query.category,
        query: query.query,
        expected: query.expected,
        institution: query.institution,
        notes: query.notes,
      },
    ],
  }));
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], seed: number): T[] {
  const rng = mulberry32(seed);
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function getGitCommit(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf-8" }).trim();
}

function isGitDirty(): boolean {
  const output = execFileSync("git", ["status", "--porcelain"], { cwd: REPO_ROOT, encoding: "utf-8" });
  return output.trim().length > 0;
}

function getSystemPromptHash(): string {
  const promptCandidates = [
    resolve(REPO_ROOT, "knowledge", "prompts", "ASSISTANT_SYSTEM_PROMPT.md"),
    resolve(REPO_ROOT, "Knowledge", "prompts", "ASSISTANT_SYSTEM_PROMPT.md"),
  ];
  for (const candidate of promptCandidates) {
    if (existsSync(candidate)) return sha256(readFileSync(candidate, "utf-8"));
  }
  return sha256("");
}

function getOllamaVersion(): string {
  try {
    return execFileSync("ollama", ["--version"], { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

function getHardwareSnapshot(): RunMeta["hardware"] {
  const chip = execFileSync("sysctl", ["-n", "machdep.cpu.brand_string"], { encoding: "utf-8" }).trim();
  const ramBytes = Number(execFileSync("sysctl", ["-n", "hw.memsize"], { encoding: "utf-8" }).trim());
  const wiredLimitMb = Number(execFileSync("sysctl", ["-n", "iogpu.wired_limit_mb"], { encoding: "utf-8" }).trim());
  const macosVersion = execFileSync("sw_vers", ["-productVersion"], { encoding: "utf-8" }).trim();

  return {
    chip,
    ram_gb: Math.round((ramBytes / 1024 ** 3) * 10) / 10,
    wired_limit_mb: wiredLimitMb,
    macos: macosVersion,
  };
}

function getHardwareFingerprint(hardware: RunMeta["hardware"]): string {
  return sha256(JSON.stringify({ chip: hardware.chip, total_ram: hardware.ram_gb, wired_limit_mb: hardware.wired_limit_mb }));
}

function hashFile(path: string): string {
  try {
    return sha256(readFileSync(path, "utf-8"));
  } catch {
    return "missing";
  }
}

function computeDatasetHashes(): RunMeta["dataset_hashes"] {
  return {
    queries: hashFile(resolve(BENCHMARK_ROOT, "test_set", "queries.jsonl")),
    multi_turn: hashFile(resolve(BENCHMARK_ROOT, "test_set", "multi_turn_sequences.jsonl")),
    judge_rubric: hashFile(resolve(BENCHMARK_ROOT, "config", "judge.yaml")),
    system_prompt: (() => {
      const candidates = [
        resolve(REPO_ROOT, "knowledge", "prompts", "ASSISTANT_SYSTEM_PROMPT.md"),
        resolve(REPO_ROOT, "Knowledge", "prompts", "ASSISTANT_SYSTEM_PROMPT.md"),
      ];
      for (const candidate of candidates) {
        if (existsSync(candidate)) return sha256(readFileSync(candidate, "utf-8"));
      }
      return sha256("");
    })(),
  };
}

export function loadConfig(): { models: BenchmarkModelConfig[]; settings: SettingsConfig; judge: JudgeConfig } {
  const modelFile = readYamlFile(resolve(BENCHMARK_ROOT, "config", "models.yaml"), benchmarkModelsFileSchema);
  const parsedSettings = readYamlFile(resolve(BENCHMARK_ROOT, "config", "settings.yaml"), settingsSchema);
  const settings = {
    ...parsedSettings,
    base_url: process.env.BENCHMARK_BASE_URL || parsedSettings.base_url,
    ollama_base_url: process.env.OLLAMA_BASE_URL || parsedSettings.ollama_base_url,
  };
  const judge = readYamlFile(resolve(BENCHMARK_ROOT, "config", "judge.yaml"), judgeConfigSchema);
  return { models: modelFile.models, settings, judge };
}

function selectModels(models: BenchmarkModelConfig[], spec: string): BenchmarkModelConfig[] {
  if (spec === "all") return models;
  if (spec === "light" || spec === "medium" || spec === "heavy") {
    return models.filter((model) => model.tier === spec);
  }
  const requested = new Set(spec.split(",").map((item) => item.trim()).filter(Boolean));
  return models.filter((model) => requested.has(model.tag));
}

function selectUnits(spec: string, standaloneUnits: ExecutionUnit[], multiTurnUnits: ExecutionUnit[]): ExecutionUnit[] {
  const allUnits = [...standaloneUnits, ...multiTurnUnits];
  if (spec === "all") return allUnits;

  const categories = new Set(["factual", "differential", "protocol", "refusal", "multi_turn", "adversarial", "long_context"]);
  if (categories.has(spec)) {
    return allUnits.filter((unit) => unit.category === spec);
  }

  const requested = new Set(spec.split(",").map((item) => item.trim()).filter(Boolean));
  return allUnits.filter((unit) => requested.has(unit.id) || unit.turns.some((turn) => requested.has(turn.query_id)));
}

export function loadExistingRuns(path: string): RawRun[] {
  return readJsonl(path, (line) => rawRunSchema.parse(line));
}

function appendRun(path: string, run: RawRun): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  appendFileSync(path, `${JSON.stringify(run)}\n`);
}

function updateMeta(path: string, updater: (meta: RunMeta) => RunMeta): void {
  const next = updater(runMetaSchema.parse(JSON.parse(readFileSync(path, "utf-8"))) as RunMeta);
  writeJson(path, next);
}

export function buildQueryLookup(units: ExecutionUnit[]): Map<string, QueryCase> {
  const lookup = new Map<string, QueryCase>();
  for (const unit of units) {
    for (const turn of unit.turns) {
      lookup.set(turn.query_id, {
        id: turn.query_id,
        category: turn.category,
        query: turn.query,
        institution: turn.institution,
        expected: turn.expected,
        notes: turn.notes,
      });
    }
  }
  return lookup;
}

function completedKeys(runs: RawRun[]): Set<string> {
  return new Set(runs.map((run) => `${run.model_tag}::${run.query_id}::${run.run_number}`));
}

function classifyError(error: unknown): RawRun["error_kind"] {
  const message = error instanceof Error ? error.message : String(error);
  if (/timed out/i.test(message)) return "timeout";
  if (/unable to load model|out of memory|oom/i.test(message)) return "ollama_oom";
  if (/phi/i.test(message)) return "phi_block";
  return "pipeline_error";
}

function printProgress(modelTag: string, completed: number, total: number, rows: RawRun[]): void {
  const modelRows = rows.filter((row) => row.model_tag === modelTag && !row.cold);
  const meanTtft = modelRows.length > 0 ? modelRows.reduce((sum, row) => sum + (row.ttft_s ?? 0), 0) / modelRows.length : 0;
  const passRate =
    modelRows.length > 0
      ? modelRows.filter((row) => !row.error_flag && row.programmatic.within_10s_latency && row.programmatic.no_dangerous_output).length / modelRows.length
      : 0;
  console.log(
    `${modelTag.padEnd(20)} ${String(completed).padStart(3)}/${String(total).padEnd(3)} mean TTFT=${meanTtft.toFixed(2)}s pass=${(passRate * 100).toFixed(1)}%`,
  );
}

export async function runBenchmark(options: BenchmarkRunOptions): Promise<{
  runId: string;
  metaPath: string;
  rawPath: string;
}> {
  const { models, settings, judge } = loadConfig();
  const { standalone, multiTurn } = parseJsonlQueries();
  const standaloneUnits = buildStandaloneUnits(standalone);
  const selectedUnits = selectUnits(options.queriesSpec, standaloneUnits, multiTurn);
  const queryLookup = buildQueryLookup(selectedUnits);
  const selectedModels = selectModels(models, options.modelsSpec);
  const runId = options.resumeRunId ?? slugifyRunId();
  const rawRoot = options.outputDir
    ? resolve(options.outputDir)
    : resolve(DEFAULT_RESULTS_ROOT, "raw", runId);
  const rawPath = resolve(rawRoot, "runs.jsonl");
  const metaPath = resolve(rawRoot, "meta.json");
  const existingRuns = options.resumeRunId ? loadExistingRuns(rawPath) : [];
  const done = completedKeys(existingRuns);
  const hardware = getHardwareSnapshot();
  const hardwareFingerprint = getHardwareFingerprint(hardware);
  const modelsAvailable = new Set((await listModels(settings.ollama_base_url)).map((model) => model.name));
  const modelsRun = selectedModels.filter((model) => modelsAvailable.has(model.tag));
  const modelsSkipped = selectedModels
    .filter((model) => !modelsAvailable.has(model.tag))
    .map((model) => ({ tag: model.tag, reason: "missing from ollama list" }));

  const configSnapshot = {
    settings,
    models: modelsRun,
    judge,
  };

  const meta: RunMeta = {
    run_id: runId,
    started_utc: nowUtc(),
    finished_utc: null,
    cli_args: process.argv.slice(2),
    git_commit: getGitCommit(),
    git_dirty: isGitDirty(),
    hardware,
    ollama_version: getOllamaVersion(),
    models_run: modelsRun.map((model) => model.tag),
    models_skipped: modelsSkipped,
    queries_run: [...queryLookup.keys()],
    runs_per_query: options.runs,
    judge_model: options.skipJudge ? null : judge.judge_model,
    system_prompt_hash: getSystemPromptHash(),
    config_snapshot: configSnapshot,
    dataset_hashes: computeDatasetHashes(),
  };

  mkdirSync(rawRoot, { recursive: true });
  if (!existsSync(metaPath)) {
    writeJson(metaPath, meta);
  }

  if (options.dryRun) {
    console.log(`Run ID: ${runId}`);
    console.log(`Models: ${modelsRun.map((model) => model.tag).join(", ") || "(none)"}`);
    console.log(`Queries: ${selectedUnits.map((unit) => unit.id).join(", ")}`);
    console.log(`Output: ${rawRoot}`);
    console.log(`Judge: ${options.skipJudge ? "disabled" : judge.judge_model}`);
    return { runId, metaPath, rawPath };
  }

  const liveRuns = [...existingRuns];
  for (const model of modelsRun) {
    const modelInfo = await showModel(settings.ollama_base_url, model.tag);
    const totalTuples = selectedUnits.reduce((sum, unit) => sum + unit.turns.length * (options.runs + 1), 0);
    let completedForModel = liveRuns.filter((run) => run.model_tag === model.tag).length;

    for (let runNumber = 0; runNumber <= options.runs; runNumber += 1) {
      const unitOrder = shuffled(selectedUnits, options.seed + runNumber + model.tag.length);
      console.log(`Model ${model.tag} run ${runNumber}: ${unitOrder.map((unit) => unit.id).join(", ")}`);

      for (const unit of unitOrder) {
        const shouldColdUnload = runNumber === 0;
        if (shouldColdUnload) {
          try {
            await unload(settings.ollama_base_url, model.tag);
          } catch (error) {
            console.warn(`Unable to unload ${model.tag}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }

        const conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
        for (let turnIndex = 0; turnIndex < unit.turns.length; turnIndex += 1) {
          const turn = unit.turns[turnIndex];
          const cold = runNumber === 0 && turnIndex === 0;
          const key = `${model.tag}::${turn.query_id}::${runNumber}`;
          if (done.has(key)) {
            const prior = liveRuns.find(
              (run) => run.model_tag === model.tag && run.query_id === turn.query_id && run.run_number === runNumber,
            );
            if (prior) {
              if (prior.response_text.trim().length > 0) {
                conversationHistory.push({ role: "user", content: turn.query });
                conversationHistory.push({ role: "assistant", content: prior.response_text });
              }
            }
            continue;
          }

          const startedAt = Date.now();
          let row: RawRun;

          try {
            const result = await callBenchmarkStream(settings.base_url, {
              query: turn.query,
              ollamaModel: model.tag,
              institution: turn.institution,
              conversationHistory,
              outputStyle: "auto",
              maxTokens: settings.default_max_tokens,
              temperature: settings.temperature,
              seed: options.seed + runNumber,
            });

            const totalTimeS = (Date.now() - startedAt) / 1000;
            const responseText = result.responseText as string;
            const programmatic = evaluateProgrammaticChecks({
              query: turn.query,
              category: turn.category,
              expected: turn.expected,
              responseText,
              totalTimeSeconds: totalTimeS,
              emergencyDetected: Boolean(result.emergencyDetected),
              routeUsed: result.routeUsed as string | null,
            });

            row = rawRunSchema.parse({
              run_id: runId,
              run_number: runNumber,
              model_tag: model.tag,
              model_tier: model.tier,
              query_id: turn.query_id,
              query_category: turn.category,
              timestamp_utc: nowUtc(),
              ttft_s: result.timings?.ttft_ms != null ? result.timings.ttft_ms / 1000 : null,
              total_time_s: totalTimeS,
              prompt_eval_time_s:
                result.timings?.prompt_eval_duration_ns != null ? result.timings.prompt_eval_duration_ns / 1e9 : null,
              eval_time_s: result.timings?.eval_duration_ns != null ? result.timings.eval_duration_ns / 1e9 : null,
              tokens_generated: result.timings?.eval_count ?? null,
              tokens_per_second: result.timings?.tokens_per_second ?? null,
              cold,
              stage_timings_ms: result.stageTimingsMs,
              response_text: responseText,
              sources_returned: (result.sources ?? []).map((source: { title: string; similarity: number }) => ({
                title: source.title,
                similarity: source.similarity,
              })),
              retrieved_source_texts: (result.sources ?? []).map(
                (source: { title: string; similarity: number; content: string }) => ({
                  title: source.title,
                  similarity: source.similarity,
                  content: source.content,
                }),
              ),
              emergency_detected: Boolean(result.emergencyDetected),
              route_used: result.routeUsed ?? null,
              programmatic,
              judge_scores: null,
              backup_judge_scores: null,
              error_flag: false,
              error_kind: null,
              error_message: null,
              git_commit: meta.git_commit,
              ollama_version: meta.ollama_version,
              ollama_model_digest: modelInfo.digest,
              ollama_model_quant: modelInfo.details?.quantization_level ?? null,
              hardware_fingerprint: hardwareFingerprint,
              seed: options.seed,
              temperature: settings.temperature,
              max_tokens: settings.default_max_tokens,
            });
          } catch (error) {
            const pipelineError = error as PipelineClientError;
            const isExpectedPhiBlock = turn.expected.mustPhiBlock && pipelineError.code === "BAD_REQUEST";
            const totalTimeS = (Date.now() - startedAt) / 1000;

            row = rawRunSchema.parse({
              run_id: runId,
              run_number: runNumber,
              model_tag: model.tag,
              model_tier: model.tier,
              query_id: turn.query_id,
              query_category: turn.category,
              timestamp_utc: nowUtc(),
              ttft_s: null,
              total_time_s: totalTimeS,
              prompt_eval_time_s: null,
              eval_time_s: null,
              tokens_generated: null,
              tokens_per_second: null,
              cold,
              stage_timings_ms: {
                phi_gate: 0,
                domain_classification: 0,
                embedding: 0,
                retrieval: 0,
                prompt_build: 0,
                llm_generation: 0,
                response_validation: 0,
              },
              response_text: "",
              sources_returned: [],
              retrieved_source_texts: [],
              emergency_detected: false,
              route_used: null,
              programmatic: evaluateProgrammaticChecks({
                query: turn.query,
                category: turn.category,
                expected: turn.expected,
                responseText: "",
                totalTimeSeconds: totalTimeS,
                emergencyDetected: false,
                routeUsed: null,
              }),
              judge_scores: null,
              backup_judge_scores: null,
              error_flag: !isExpectedPhiBlock,
              error_kind: isExpectedPhiBlock ? "phi_block" : classifyError(error),
              error_message: error instanceof Error ? error.message : String(error),
              git_commit: meta.git_commit,
              ollama_version: meta.ollama_version,
              ollama_model_digest: modelInfo.digest,
              ollama_model_quant: modelInfo.details?.quantization_level ?? null,
              hardware_fingerprint: hardwareFingerprint,
              seed: options.seed,
              temperature: settings.temperature,
              max_tokens: settings.default_max_tokens,
            });
          }

          appendRun(rawPath, row);
          liveRuns.push(row);
          done.add(key);
          completedForModel += 1;
          if (row.response_text.trim().length > 0) {
            conversationHistory.push({ role: "user", content: turn.query });
            conversationHistory.push({ role: "assistant", content: row.response_text });
          }
          printProgress(model.tag, completedForModel, totalTuples, liveRuns);
        }
      }
    }
  }

  updateMeta(metaPath, (current) => ({ ...current, finished_utc: nowUtc() } as RunMeta));

  const aggregatedRoot = resolve(DEFAULT_RESULTS_ROOT, "aggregated", runId);
  mkdirSync(aggregatedRoot, { recursive: true });
  const judgeIndex = buildJudgeIndex(loadJudgeRecords(resolve(rawRoot, "judges.jsonl")));
  const { summaryCsv, perQueryCsv } = aggregateRuns(liveRuns, queryLookup, judgeIndex);
  writeFileSync(resolve(aggregatedRoot, "summary.csv"), summaryCsv);
  writeFileSync(resolve(aggregatedRoot, "per-query.csv"), perQueryCsv);

  return { runId, metaPath, rawPath };
}
