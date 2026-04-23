import { z } from "zod";

export const modelTierSchema = z.enum(["light", "medium", "heavy"]);
export const queryCategorySchema = z.enum([
  "factual",
  "differential",
  "protocol",
  "refusal",
  "multi_turn",
  "adversarial",
  "long_context",
  "calibration",
  "bias_invariance",
  "noise_robustness",
  "citation_integrity",
  "dose_critical",
  "cross_institutional",
  "reasoning_chain",
  "it_support",
]);

export const queryExpectedSchema = z.object({
  mustInclude: z.array(z.string()).optional(),
  mustIncludeAny: z.array(z.array(z.string()).min(1)).optional(),
  mustNotInclude: z.array(z.string()).optional(),
  mustRefuse: z.boolean().optional(),
  mustNotRefuse: z.boolean().optional(),
  mustHedge: z.boolean().optional(),
  mustPhiBlock: z.boolean().optional(),
  mustCite: z.boolean().optional(),
  minResponseChars: z.number().int().positive().optional(),
  maxResponseChars: z.number().int().positive().optional(),
  sourceMustInclude: z.array(z.string()).optional(),
  biasInvariancePairId: z.string().optional(),
});

export const queryCaseSchema = z.object({
  id: z.string().min(1),
  category: queryCategorySchema,
  query: z.string().min(1),
  institution: z.enum(["INSTITUTION_A", "INSTITUTION_B", "SHARED"]).optional(),
  expected: queryExpectedSchema,
  notes: z.string().optional(),
});

export const multiTurnCaseSchema = z.object({
  id: z.string().min(1),
  turns: z
    .array(
      z.object({
        user: z.string().min(1),
        expected: queryExpectedSchema,
      }),
    )
    .min(1),
  notes: z.string().optional(),
});

export const benchmarkModelConfigSchema = z.object({
  tag: z.string().min(1),
  tier: modelTierSchema,
  size_gb: z.number().positive(),
  architecture_note: z.string().min(1),
});

export const benchmarkModelsFileSchema = z.object({
  models: z.array(benchmarkModelConfigSchema).length(9),
});

export const settingsSchema = z.object({
  base_url: z.string().url(),
  ollama_base_url: z.string().url(),
  benchmark_endpoint_env_var: z.string().min(1),
  inference_timeout_s: z.number().int().positive(),
  reconnect_retries: z.number().int().min(0),
  reconnect_delay_s: z.number().positive(),
  default_runs_per_query: z.number().int().positive(),
  default_max_tokens: z.number().int().positive(),
  temperature: z.number().min(0).max(2),
  judge_sample_rate: z.number().gt(0).lte(1),
  judge_source_char_limit: z.number().int().positive(),
  judge_retry_delays_ms: z.array(z.number().int().positive()).min(1),
  warmup_max_tokens: z.number().int().positive(),
  latency_gate_s: z.number().positive(),
});

export const judgeConfigSchema = z.object({
  judge_model: z.string().min(1),
  backup_judge_model: z.string().min(1),
  temperature: z.number().min(0).max(2),
  max_tokens: z.number().int().positive(),
  rubric: z.record(z.record(z.string())),
});

export const stageTimingsMsSchema = z.object({
  phi_gate: z.number().min(0),
  domain_classification: z.number().min(0),
  embedding: z.number().min(0),
  retrieval: z.number().min(0),
  prompt_build: z.number().min(0),
  llm_generation: z.number().min(0),
  response_validation: z.number().min(0),
});

export const programmaticChecksSchema = z.object({
  produced_output: z.boolean(),
  within_10s_latency: z.boolean(),
  no_dangerous_output: z.boolean(),
  passed_refusal: z.boolean().nullable(),
  passed_hedging: z.boolean().nullable(),
  must_include_all: z.boolean().nullable(),
  must_include_any: z.boolean().nullable(),
  must_not_include_none: z.boolean().nullable(),
  must_cite: z.boolean().nullable(),
  must_not_refuse: z.boolean().nullable(),
  length_ok: z.boolean().nullable(),
});

export const judgeScoreSetSchema = z.object({
  accuracy: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.null()]),
  completeness: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.null()]),
  format: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.null()]),
  safety: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.null()]),
  hallucination: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.null()]),
  rationale: z.string().nullable(),
  judge_model: z.string().nullable(),
  judge_call_duration_s: z.number().nullable(),
});

export const rawRunSchema = z.object({
  run_id: z.string().min(1),
  run_number: z.number().int().min(0),
  model_tag: z.string().min(1),
  model_tier: modelTierSchema,
  query_id: z.string().min(1),
  query_category: queryCategorySchema,
  timestamp_utc: z.string().datetime(),
  ttft_s: z.number().nullable(),
  total_time_s: z.number().nullable(),
  prompt_eval_time_s: z.number().nullable(),
  eval_time_s: z.number().nullable(),
  tokens_generated: z.number().nullable(),
  tokens_per_second: z.number().nullable(),
  cold: z.boolean(),
  stage_timings_ms: stageTimingsMsSchema,
  response_text: z.string(),
  sources_returned: z.array(
    z.object({
      title: z.string(),
      similarity: z.number(),
    }),
  ),
  retrieved_source_texts: z.array(
    z.object({
      title: z.string(),
      similarity: z.number(),
      content: z.string(),
    }),
  ),
  emergency_detected: z.boolean(),
  route_used: z.enum(["PROTOCOL", "KNOWLEDGE", "HYBRID"]).nullable(),
  programmatic: programmaticChecksSchema,
  judge_scores: judgeScoreSetSchema.nullable(),
  backup_judge_scores: judgeScoreSetSchema.nullable().optional(),
  error_flag: z.boolean(),
  error_kind: z
    .enum(["timeout", "ollama_error", "ollama_oom", "phi_block", "pipeline_error", "judge_error"])
    .nullable(),
  error_message: z.string().nullable(),
  git_commit: z.string(),
  ollama_version: z.string(),
  ollama_model_digest: z.string(),
  ollama_model_quant: z.string().nullable(),
  hardware_fingerprint: z.string(),
  seed: z.number().int().nullable(),
  temperature: z.number(),
  max_tokens: z.number().int(),
});

export const runMetaSchema = z.object({
  run_id: z.string(),
  started_utc: z.string().datetime(),
  finished_utc: z.string().datetime().nullable(),
  cli_args: z.array(z.string()),
  git_commit: z.string(),
  git_dirty: z.boolean(),
  hardware: z.object({
    chip: z.string(),
    ram_gb: z.number(),
    wired_limit_mb: z.number(),
    macos: z.string(),
  }),
  ollama_version: z.string(),
  models_run: z.array(z.string()),
  models_skipped: z.array(z.object({ tag: z.string(), reason: z.string() })),
  queries_run: z.array(z.string()),
  runs_per_query: z.number().int().positive(),
  judge_model: z.string().nullable(),
  system_prompt_hash: z.string(),
  config_snapshot: z.unknown(),
  dataset_hashes: z
    .object({
      queries: z.string(),
      multi_turn: z.string(),
      judge_rubric: z.string(),
      system_prompt: z.string(),
    })
    .optional(),
});
