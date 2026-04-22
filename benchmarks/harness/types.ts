import type { QueryDomainRoute, Institution } from "@rad-assist/shared";

export type ModelTier = "light" | "medium" | "heavy";

export interface BenchmarkModelConfig {
  tag: string;
  tier: ModelTier;
  size_gb: number;
  architecture_note: string;
}

export interface SettingsConfig {
  base_url: string;
  ollama_base_url: string;
  benchmark_endpoint_env_var: string;
  inference_timeout_s: number;
  reconnect_retries: number;
  reconnect_delay_s: number;
  default_runs_per_query: number;
  default_max_tokens: number;
  temperature: number;
  judge_sample_rate: number;
  judge_source_char_limit: number;
  judge_retry_delays_ms: number[];
  warmup_max_tokens: number;
  latency_gate_s: number;
}

export interface JudgeConfig {
  judge_model: string;
  backup_judge_model: string;
  temperature: number;
  max_tokens: number;
  rubric: Record<string, Record<string, string>>;
}

export type QueryCategory =
  | "factual"
  | "differential"
  | "protocol"
  | "refusal"
  | "multi_turn"
  | "adversarial"
  | "long_context"
  | "calibration"
  | "bias_invariance"
  | "noise_robustness"
  | "citation_integrity"
  | "dose_critical"
  | "cross_institutional"
  | "reasoning_chain";

export interface QueryExpected {
  mustInclude?: string[];
  mustIncludeAny?: string[][];
  mustNotInclude?: string[];
  mustRefuse?: boolean;
  mustNotRefuse?: boolean;
  mustHedge?: boolean;
  mustPhiBlock?: boolean;
  mustCite?: boolean;
  minResponseChars?: number;
  maxResponseChars?: number;
  sourceMustInclude?: string[];
  biasInvariancePairId?: string;
}

export interface QueryCase {
  id: string;
  category: QueryCategory;
  query: string;
  institution?: Institution;
  expected: QueryExpected;
  notes?: string;
}

export interface MultiTurnCase {
  id: string;
  turns: Array<{
    user: string;
    expected: QueryExpected;
  }>;
  notes?: string;
}

export interface SourceRecord {
  title: string;
  similarity: number;
}

export interface RetrievedSourceRecord extends SourceRecord {
  content: string;
}

export interface ProgrammaticChecks {
  produced_output: boolean;
  within_10s_latency: boolean;
  no_dangerous_output: boolean;
  passed_refusal: boolean | null;
  passed_hedging: boolean | null;
  must_include_all: boolean | null;
  must_include_any: boolean | null;
  must_not_include_none: boolean | null;
  must_cite: boolean | null;
  must_not_refuse: boolean | null;
  length_ok: boolean | null;
}

export interface JudgeScoreSet {
  accuracy: 0 | 1 | 2 | 3 | null;
  completeness: 0 | 1 | 2 | 3 | null;
  format: 0 | 1 | 2 | 3 | null;
  safety: 0 | 1 | 2 | 3 | null;
  hallucination: 0 | 1 | 2 | 3 | null;
  rationale: string | null;
  judge_model: string | null;
  judge_call_duration_s: number | null;
}

export interface StageTimingsMs {
  phi_gate: number;
  domain_classification: number;
  embedding: number;
  retrieval: number;
  prompt_build: number;
  llm_generation: number;
  response_validation: number;
}

export interface RawRun {
  run_id: string;
  run_number: number;
  model_tag: string;
  model_tier: ModelTier;
  query_id: string;
  query_category: QueryCategory;
  timestamp_utc: string;
  ttft_s: number | null;
  total_time_s: number | null;
  prompt_eval_time_s: number | null;
  eval_time_s: number | null;
  tokens_generated: number | null;
  tokens_per_second: number | null;
  cold: boolean;
  stage_timings_ms: StageTimingsMs;
  response_text: string;
  sources_returned: SourceRecord[];
  retrieved_source_texts: RetrievedSourceRecord[];
  emergency_detected: boolean;
  route_used: QueryDomainRoute | null;
  programmatic: ProgrammaticChecks;
  judge_scores: JudgeScoreSet | null;
  backup_judge_scores?: JudgeScoreSet | null;
  error_flag: boolean;
  error_kind:
    | "timeout"
    | "ollama_error"
    | "ollama_oom"
    | "phi_block"
    | "pipeline_error"
    | "judge_error"
    | null;
  error_message: string | null;
  git_commit: string;
  ollama_version: string;
  ollama_model_digest: string;
  ollama_model_quant: string | null;
  hardware_fingerprint: string;
  seed: number | null;
  temperature: number;
  max_tokens: number;
}

export interface RunMeta {
  run_id: string;
  started_utc: string;
  finished_utc: string | null;
  cli_args: string[];
  git_commit: string;
  git_dirty: boolean;
  hardware: {
    chip: string;
    ram_gb: number;
    wired_limit_mb: number;
    macos: string;
  };
  ollama_version: string;
  models_run: string[];
  models_skipped: Array<{ tag: string; reason: string }>;
  queries_run: string[];
  runs_per_query: number;
  judge_model: string | null;
  system_prompt_hash: string;
  config_snapshot: unknown;
  dataset_hashes?: {
    queries: string;
    multi_turn: string;
    judge_rubric: string;
    system_prompt: string;
  };
}

export interface SummaryRow {
  model_tag: string;
  model_tier: ModelTier;
  runs: number;
  cold_ttft_s: number | null;
  warm_ttft_s_p50: number | null;
  warm_ttft_s_p95: number | null;
  total_s_p50: number | null;
  total_s_p95: number | null;
  tokens_per_sec_p50: number | null;
  tokens_per_sec_p95: number | null;
  pass_rate_overall: number;
  pass_rate_latency_gate: number;
  judge_accuracy_mean: number | null;
  judge_completeness_mean: number | null;
  judge_safety_mean: number | null;
  judge_hallucination_mean: number | null;
  judge_format_mean: number | null;
  refusal_compliance_rate: number | null;
  dangerous_output_rate: number;
  timeout_rate: number;
  error_rate: number;
  dominant_failure_mode: string;
}

export interface PerQueryRow {
  model_tag: string;
  model_tier: ModelTier;
  query_id: string;
  query_category: QueryCategory;
  runs: number;
  ttft_s_mean: number | null;
  ttft_s_p95: number | null;
  total_s_mean: number | null;
  total_s_p95: number | null;
  tokens_per_sec_mean: number | null;
  tokens_per_sec_p95: number | null;
  judge_accuracy_mean: number | null;
  judge_completeness_mean: number | null;
  judge_safety_mean: number | null;
  judge_hallucination_mean: number | null;
  judge_format_mean: number | null;
  pass_rate: number;
}

export interface OllamaChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OllamaStreamResult {
  responseText: string;
  ttftMs: number | null;
  totalTimeMs: number | null;
  evalCount: number | null;
  promptEvalDurationNs: number | null;
  evalDurationNs: number | null;
  tokensPerSecond: number | null;
}

export interface ExecutionQuery {
  query_id: string;
  category: QueryCategory;
  query: string;
  expected: QueryExpected;
  institution?: Institution;
  notes?: string;
}

export interface ExecutionUnit {
  id: string;
  category: QueryCategory;
  turns: ExecutionQuery[];
}

export interface BenchmarkRunOptions {
  modelsSpec: string;
  runs: number;
  queriesSpec: string;
  dryRun: boolean;
  skipJudge: boolean;
  outputDir?: string;
  resumeRunId?: string;
  seed: number;
  verbose: boolean;
}
