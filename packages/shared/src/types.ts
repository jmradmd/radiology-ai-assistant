/**
 * TypeScript type definitions
 * Mirrors Prisma enums and provides additional app types
 * 
 * NOTE: ROLE_DISPLAY_NAMES and SUBSPECIALTY_DISPLAY_NAMES are in constants.ts
 */

// ════════════════════════════════════════════════════════════════════════════════
// INSTITUTION TYPES
// ════════════════════════════════════════════════════════════════════════════════

export type Institution = "INSTITUTION_A" | "INSTITUTION_B" | "SHARED";

export const INSTITUTIONS: Institution[] = ["INSTITUTION_A", "INSTITUTION_B", "SHARED"];

// ════════════════════════════════════════════════════════════════════════════════
// DOMAIN TYPES — Controls which knowledge base and system prompt to use
// ════════════════════════════════════════════════════════════════════════════════

export type Domain = "PROTOCOL" | "KNOWLEDGE";

export const DOMAINS: Domain[] = ["PROTOCOL", "KNOWLEDGE"];

export type AuthorityLevel =
  | "INSTITUTIONAL"
  | "NATIONAL_GUIDELINE"
  | "SOCIETY_GUIDELINE";

export const AUTHORITY_LEVELS: AuthorityLevel[] = [
  "INSTITUTIONAL",
  "NATIONAL_GUIDELINE",
  "SOCIETY_GUIDELINE",
];

export type DocumentTier = "reference" | "clinical" | "educational";
export const DOCUMENT_TIERS: DocumentTier[] = ["reference", "clinical", "educational"];

// Query-time routing for unified assistant behavior
export type QueryDomainRoute = "PROTOCOL" | "KNOWLEDGE" | "HYBRID";
export const QUERY_DOMAIN_ROUTES: QueryDomainRoute[] = ["PROTOCOL", "KNOWLEDGE", "HYBRID"];

// Source provenance exposed to clients for safety labeling
export type SourceDomain = "protocol" | "knowledge";

// User response verbosity preference (shared across web/api/desktop)
export type OutputStyle = "concise" | "detailed" | "auto";
export const OUTPUT_STYLES: OutputStyle[] = ["concise", "detailed", "auto"];

// ════════════════════════════════════════════════════════════════════════════════
// LLM MODEL CONFIGURATION
// ════════════════════════════════════════════════════════════════════════════════

export type LLMProvider =
  | "deepseek"
  | "anthropic"
  | "moonshot"
  | "openai"
  | "gemini"
  | "minimax"
  | "local";

export interface LLMModelConfig {
  id: string;
  name: string;
  provider: LLMProvider;
  modelId: string;
  description: string;
  contextWindow: number;
  inputCostPer1M: number;
  outputCostPer1M: number;
  isDefault?: boolean;
}

export const LLM_MODELS: LLMModelConfig[] = [
  {
    id: "local",
    name: "Local LLM",
    provider: "local",
    modelId: "local-model",
    description: "On-premise via LM Studio. No data leaves the network.",
    contextWindow: 32000,
    inputCostPer1M: 0,
    outputCostPer1M: 0,
  },
  {
    id: "claude-opus",
    name: "Claude Opus 4.6",
    provider: "anthropic",
    modelId: "claude-opus-4-6",
    description: "Use for highest-stakes, multi-step clinical reasoning and policy synthesis.",
    contextWindow: 200000,
    inputCostPer1M: 5.0,
    outputCostPer1M: 25.0,
  },
  {
    id: "claude-sonnet",
    name: "Claude Sonnet 4.6",
    provider: "anthropic",
    modelId: "claude-sonnet-4-6",
    description: "Use for balanced, high-quality protocol answers across most routine workflows.",
    contextWindow: 200000,
    inputCostPer1M: 3.0,
    outputCostPer1M: 15.0,
  },
  {
    id: "claude-haiku",
    name: "Claude Haiku 4.5",
    provider: "anthropic",
    modelId: "claude-haiku-4-5",
    description: "Default for low-latency routing, quick checks, and concise operational responses.",
    contextWindow: 200000,
    inputCostPer1M: 1.0,
    outputCostPer1M: 5.0,
    isDefault: true,
  },
  {
    id: "gpt-5.2",
    name: "GPT-5.2",
    provider: "openai",
    modelId: "gpt-5.2",
    description: "Use for coding-heavy, tool-using, and structured transformation workflows.",
    contextWindow: 400000,
    inputCostPer1M: 1.75,
    outputCostPer1M: 14.0,
  },
  {
    id: "minimax-m2.5",
    name: "MiniMax-M2.5",
    provider: "minimax",
    modelId: "MiniMax-M2.5",
    description: "Use for cost-efficient, long-context engineering and high-throughput sessions.",
    contextWindow: 204800,
    inputCostPer1M: 0,
    outputCostPer1M: 0,
  },
  {
    id: "gemini-3.0",
    name: "Gemini 3.0",
    provider: "gemini",
    modelId: "gemini-3-flash-preview",
    description: "Use for fast multimodal-friendly turns with strong interactive responsiveness.",
    contextWindow: 1000000,
    inputCostPer1M: 0,
    outputCostPer1M: 0,
  },
  {
    id: "deepseek-r1",
    name: "DeepSeek R1",
    provider: "deepseek",
    modelId: "deepseek-reasoner",
    description: "Use for deep protocol reasoning when careful stepwise deliberation is needed.",
    contextWindow: 64000,
    inputCostPer1M: 0.55,
    outputCostPer1M: 2.19,
  },
  {
    id: "kimi-k2.5",
    name: "Kimi K2.5",
    provider: "moonshot",
    modelId: "kimi-k2.5",
    description: "Use for rapid synthesis across very long policy context windows.",
    contextWindow: 256000,
    inputCostPer1M: 0.7,
    outputCostPer1M: 2.8,
  },
];

export const DEFAULT_MODEL_ID = "claude-haiku";

export function getModelConfig(modelId: string): LLMModelConfig | undefined {
  return LLM_MODELS.find((m) => m.id === modelId);
}

export function getDefaultModel(): LLMModelConfig {
  return (
    LLM_MODELS.find((m) => m.isDefault) ||
    LLM_MODELS.find((m) => m.id === DEFAULT_MODEL_ID) ||
    LLM_MODELS[0]
  );
}

// Builds an LLMModelConfig for a model name discovered at runtime from the
// local server's /v1/models endpoint. The returned config has provider="local"
// so the rest of the pipeline (source-card prompting, the local client path)
// recognizes it as a local model. baseUrl is only used in the description.
export function buildSyntheticLocalModelConfig(
  modelId: string,
  baseUrl?: string,
): LLMModelConfig {
  const where = baseUrl && baseUrl.trim().length > 0 ? baseUrl : "local server";
  return {
    id: modelId,
    name: modelId,
    provider: "local",
    modelId,
    description: `Local model via ${where}`,
    contextWindow: 32000,
    inputCostPer1M: 0,
    outputCostPer1M: 0,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// VERBATIM SOURCE TYPE (for RAG responses)
// ════════════════════════════════════════════════════════════════════════════════

export interface VerbatimSource {
  title: string;
  content: string;
  category: string;
  domain?: SourceDomain;
  sourceLabel?: string;
  institution?: Institution;
  authorityLevel?: AuthorityLevel;
  guidelineSource?: string;
  guidelineYear?: number;
  similarity: number;
  url: string | null;
  chunkIndex: number;
  pageStart?: number;
  pageEnd?: number;
}

export interface InstitutionalResponse {
  institution: Institution;
  summary: string;
  keyPoints?: string[];
  verbatimSources: VerbatimSource[];
  confidence: number;
}

// ════════════════════════════════════════════════════════════════════════════════
// DISCREPANCY TYPE
// ════════════════════════════════════════════════════════════════════════════════

export type DiscrepancyType = 
  | "DOSING"
  | "TIMING"
  | "DRUG"
  | "THRESHOLD"
  | "PROCEDURE"
  | "CONTRAINDICATION";

// ════════════════════════════════════════════════════════════════════════════════
// RE-EXPORT SUBSPECIALTY TYPE
// ════════════════════════════════════════════════════════════════════════════════

export type Subspecialty =
  | "ABDOMINAL"
  | "NEURO"
  | "MSK"
  | "CHEST"
  | "IR"
  | "PEDS"
  | "BREAST"
  | "NUCLEAR"
  | "CARDIAC"
  | "EMERGENCY";
