/**
 * LLM Client Wrapper
 * 
 * Provides a unified interface for multiple LLM providers:
 * - Anthropic (Claude Opus/Sonnet/Haiku)
 * - OpenAI (GPT-5.2)
 * - Google Gemini (Gemini 3.0 Flash Preview)
 * - MiniMax (MiniMax-M2.5)
 * - Moonshot (Kimi K2.5)
 * - DeepSeek (R1)
 * - Local (LM Studio / Ollama)
 *
 * Fallback chain: Selected Model → Sonnet 4.6 → GPT-5.2 → DeepSeek →
 * Gemini 3.0 → MiniMax-M2.5 → Haiku 4.5 → Kimi K2.5 → Opus 4.6
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import {
  getModelConfig,
  getDefaultModel,
  buildSyntheticLocalModelConfig,
  type LLMModelConfig,
  type LLMProvider,
} from '@rad-assist/shared';
import { discoverLocalModels } from './provider-health';

// ════════════════════════════════════════════════════════════════════════════════
// CLIENT INITIALIZATION (Lazy to avoid crash on missing env vars)
// ════════════════════════════════════════════════════════════════════════════════

let _anthropic: Anthropic | null = null;
let _openai: OpenAI | null = null;
let _moonshot: OpenAI | null = null;
let _deepseek: OpenAI | null = null;
let _gemini: OpenAI | null = null;
let _minimax: OpenAI | null = null;
let _local: OpenAI | null = null;

function hasEnvValue(name: string): boolean {
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0;
}

function getAnthropicClient(): Anthropic | null {
  if (_anthropic === null && process.env.ANTHROPIC_API_KEY) {
    _anthropic = new Anthropic();
  }
  return _anthropic;
}

function getOpenAIClient(): OpenAI {
  if (_openai === null) {
    _openai = new OpenAI();  // Uses OPENAI_API_KEY env var
  }
  return _openai;
}

function getMoonshotClient(): OpenAI | null {
  if (_moonshot === null && hasEnvValue('MOONSHOT_API_KEY')) {
    _moonshot = new OpenAI({
      apiKey: process.env.MOONSHOT_API_KEY,
      baseURL: 'https://api.moonshot.ai/v1',
    });
  }
  return _moonshot;
}

function getDeepSeekClient(): OpenAI | null {
  if (_deepseek === null && hasEnvValue('DEEPSEEK_API_KEY')) {
    _deepseek = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: 'https://api.deepseek.com',
    });
  }
  return _deepseek;
}

function getGeminiClient(): OpenAI | null {
  if (_gemini === null && hasEnvValue('GEMINI_API_KEY')) {
    _gemini = new OpenAI({
      apiKey: process.env.GEMINI_API_KEY,
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    });
  }
  return _gemini;
}

function getMiniMaxClient(): OpenAI | null {
  if (_minimax === null && hasEnvValue('MINIMAX_API_KEY')) {
    _minimax = new OpenAI({
      apiKey: process.env.MINIMAX_API_KEY,
      baseURL: 'https://api.minimax.io/v1',
    });
  }
  return _minimax;
}

function getLocalClient(): OpenAI | null {
  if (_local === null) {
    const baseURL = process.env.LOCAL_LLM_URL || 'http://localhost:1234/v1';
    // No API key needed for local inference servers.
    // OpenAI SDK requires a non-empty string, so use a placeholder.
    _local = new OpenAI({
      apiKey: 'not-needed',
      baseURL,
    });
  }
  return _local;
}

// ════════════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════════════

export interface LLMCompletionParams {
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
  temperature?: number;
  modelId?: string;  // Optional model override (from user preference)
}

export interface LLMCompletionResult {
  content: string;
  provider: LLMProvider;
  model: string;
  requestedModel?: string;  // What user requested (may differ if fallback occurred)
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// PROVIDER-SPECIFIC COMPLETION FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════════

// Helper to add timeout to any promise
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

const LLM_TIMEOUT_MS = 30000; // 30 second timeout for LLM calls

function classifyFailureReason(error: unknown): 'timeout' | 'provider_error' {
  if (error instanceof Error && /timed out/i.test(error.message)) {
    return 'timeout';
  }
  return 'provider_error';
}

async function completeDeepSeek(
  params: LLMCompletionParams,
  modelId: string
): Promise<LLMCompletionResult | null> {
  const client = getDeepSeekClient();
  if (!client) {
    console.log('[LLM][deepseek] unavailable reason=missing_key');
    return null;
  }

  try {
    // DeepSeek R1 (reasoner) uses OpenAI-compatible API
    const response = await withTimeout(
      client.chat.completions.create({
        model: modelId,
        messages: [
          { role: 'system', content: params.systemPrompt },
          { role: 'user', content: params.userMessage },
        ],
        max_tokens: params.maxTokens ?? 2048,  // R1 benefits from higher token limit for reasoning
        temperature: params.temperature ?? 0.3,
      }),
      LLM_TIMEOUT_MS,
      'DeepSeek API'
    );

    return {
      content: response.choices[0].message.content || 'Unable to generate response.',
      provider: 'deepseek',
      model: modelId,
      usage: response.usage ? {
        inputTokens: response.usage.prompt_tokens,
        outputTokens: response.usage.completion_tokens,
      } : undefined,
    };
  } catch (error) {
    const reason = classifyFailureReason(error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[LLM][deepseek] failed reason=${reason} message="${errorMessage}"`);
    return null;
  }
}

async function completeMoonshot(
  params: LLMCompletionParams,
  modelId: string
): Promise<LLMCompletionResult | null> {
  const client = getMoonshotClient();
  if (!client) {
    console.log('[LLM][moonshot] unavailable reason=missing_key');
    return null;
  }

  try {
    // Disable thinking mode so Kimi K2.5 returns output in standard content field.
    // With thinking enabled, Kimi puts everything in reasoning_content and content is empty.
    const createParams: Record<string, unknown> = {
      model: modelId,
      messages: [
        { role: 'system', content: params.systemPrompt },
        { role: 'user', content: params.userMessage },
      ],
      max_tokens: params.maxTokens ?? 4096,
      thinking: { type: 'disabled' },
    };

    const response = await withTimeout(
      client.chat.completions.create(createParams as any),
      LLM_TIMEOUT_MS,
      'Moonshot API'
    );

    const choice = response.choices[0];
    const msg = choice?.message as unknown as Record<string, unknown>;
    // Prefer content; fall back to reasoning_content if thinking was somehow still on
    const textContent = (msg?.content as string)
      || (msg?.reasoning_content as string)
      || '';

    return {
      content: textContent || 'Unable to generate response.',
      provider: 'moonshot',
      model: modelId,
      usage: response.usage ? {
        inputTokens: response.usage.prompt_tokens,
        outputTokens: response.usage.completion_tokens,
      } : undefined,
    };
  } catch (error) {
    const reason = classifyFailureReason(error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[LLM][moonshot] failed reason=${reason} message="${errorMessage}"`);
    return null;
  }
}

async function completeGemini(
  params: LLMCompletionParams,
  modelId: string
): Promise<LLMCompletionResult | null> {
  const client = getGeminiClient();
  if (!client) {
    console.log('[LLM][gemini] unavailable reason=missing_key');
    return null;
  }

  try {
    const response = await withTimeout(
      client.chat.completions.create({
        model: modelId,
        messages: [
          { role: 'system', content: params.systemPrompt },
          { role: 'user', content: params.userMessage },
        ],
        max_tokens: params.maxTokens ?? 2048,
        temperature: params.temperature ?? 0.2,
      }),
      LLM_TIMEOUT_MS,
      'Gemini API'
    );

    return {
      content: response.choices[0].message.content || 'Unable to generate response.',
      provider: 'gemini',
      model: modelId,
      usage: response.usage ? {
        inputTokens: response.usage.prompt_tokens,
        outputTokens: response.usage.completion_tokens,
      } : undefined,
    };
  } catch (error) {
    const reason = classifyFailureReason(error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[LLM][gemini] failed reason=${reason} message="${errorMessage}"`);
    return null;
  }
}

async function completeMiniMax(
  params: LLMCompletionParams,
  modelId: string
): Promise<LLMCompletionResult | null> {
  const client = getMiniMaxClient();
  if (!client) {
    console.log('[LLM][minimax] unavailable reason=missing_key');
    return null;
  }

  try {
    const response = await withTimeout(
      client.chat.completions.create({
        model: modelId,
        messages: [
          { role: 'system', content: params.systemPrompt },
          { role: 'user', content: params.userMessage },
        ],
        max_tokens: params.maxTokens ?? 2048,
        temperature: params.temperature ?? 0.2,
      }),
      LLM_TIMEOUT_MS,
      'MiniMax API'
    );

    return {
      content: response.choices[0].message.content || 'Unable to generate response.',
      provider: 'minimax',
      model: modelId,
      usage: response.usage ? {
        inputTokens: response.usage.prompt_tokens,
        outputTokens: response.usage.completion_tokens,
      } : undefined,
    };
  } catch (error) {
    const reason = classifyFailureReason(error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[LLM][minimax] failed reason=${reason} message="${errorMessage}"`);
    return null;
  }
}

async function completeAnthropic(
  params: LLMCompletionParams,
  modelId: string
): Promise<LLMCompletionResult | null> {
  const client = getAnthropicClient();
  if (!client) {
    console.log('[LLM][anthropic] unavailable reason=missing_key');
    return null;
  }

  try {
    const response = await withTimeout(
      client.messages.create({
        model: modelId,
        max_tokens: params.maxTokens ?? 1024,
        temperature: params.temperature ?? 0.2,
        system: params.systemPrompt,
        messages: [
          { role: 'user', content: params.userMessage },
        ],
      }),
      LLM_TIMEOUT_MS,
      'Anthropic API'
    );

    const textContent = response.content.find(c => c.type === 'text');

    return {
      content: textContent?.text || 'Unable to generate response.',
      provider: 'anthropic',
      model: modelId,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  } catch (error) {
    const reason = classifyFailureReason(error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[LLM][anthropic] failed reason=${reason} message="${errorMessage}"`);
    return null;
  }
}

async function completeOpenAI(
  params: LLMCompletionParams,
  modelId: string
): Promise<LLMCompletionResult | null> {
  if (!hasEnvValue('OPENAI_API_KEY')) {
    console.log('[LLM][openai] unavailable reason=missing_key');
    return null;
  }
  const client = getOpenAIClient();

  try {
    const response = await withTimeout(
      client.chat.completions.create({
        model: modelId,
        messages: [
          { role: 'system', content: params.systemPrompt },
          { role: 'user', content: params.userMessage },
        ],
        max_completion_tokens: params.maxTokens ?? 1024,
        temperature: params.temperature ?? 0.3,
      }),
      LLM_TIMEOUT_MS,
      'OpenAI API'
    );

    return {
      content: response.choices[0].message.content || 'Unable to generate response.',
      provider: 'openai',
      model: modelId,
      usage: response.usage ? {
        inputTokens: response.usage.prompt_tokens,
        outputTokens: response.usage.completion_tokens,
      } : undefined,
    };
  } catch (error) {
    const reason = classifyFailureReason(error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[LLM][openai] failed reason=${reason} message="${errorMessage}"`);
    return null;
  }
}

async function completeLocal(
  params: LLMCompletionParams,
  modelId: string
): Promise<LLMCompletionResult | null> {
  const client = getLocalClient();
  if (!client) return null;

  try {
    const response = await withTimeout(
      client.chat.completions.create({
        model: modelId,
        messages: [
          { role: 'system', content: params.systemPrompt },
          { role: 'user', content: params.userMessage },
        ],
        max_tokens: params.maxTokens ?? 2048,
        temperature: params.temperature ?? 0.3,
      }),
      120_000,
      'Local LLM'
    );

    return {
      content: response.choices[0].message.content || 'Unable to generate response.',
      provider: 'local',
      model: modelId,
      usage: response.usage ? {
        inputTokens: response.usage.prompt_tokens,
        outputTokens: response.usage.completion_tokens,
      } : undefined,
    };
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    // Sanitize to remove server-internal details that should not reach clients
    const sanitizedMessage = rawMessage
      .replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED_KEY]')
      .replace(/key-[A-Za-z0-9_-]+/g, '[REDACTED_KEY]')
      .replace(/Bearer\s+[A-Za-z0-9_.-]+/g, 'Bearer [REDACTED]')
      .slice(0, 200);

    if (/ECONNREFUSED|fetch failed|network|socket|connection error/i.test(rawMessage)) {
      console.error('[LLM][local] server not reachable. Is LM Studio or Ollama running?');
      throw new Error(
        'Local model unavailable: connection refused. Start LM Studio or Ollama and load a model, then retry.'
      );
    }

    const reason = classifyFailureReason(error);
    console.error(`[LLM][local] failed reason=${reason} message="${sanitizedMessage}"`);
    // Throw to prevent silent fallback to cloud providers for local-only requests.
    throw new Error(`Local model error: ${sanitizedMessage}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// MODEL RESOLUTION (static + dynamic local discovery)
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Resolve a model selection (which may be a static id, the "local" alias, or a
 * dynamically-discovered local model name) into a concrete LLMModelConfig.
 *
 * - Static cloud configs are returned unchanged.
 * - The "local" alias substitutes the first chat model reported by the local
 *   server. If the local server is unreachable or has no chat model loaded,
 *   throws a clear error rather than silently falling back to cloud.
 * - An unknown id resolves to a synthetic local config when the local server
 *   reports it among its chatModels. Otherwise throws.
 */
export async function resolveModelConfig(
  modelId: string | undefined,
): Promise<LLMModelConfig> {
  if (!modelId) return getDefaultModel();

  const staticConfig = getModelConfig(modelId);

  // Cloud (or any non-local) static configs pass through.
  if (staticConfig && staticConfig.provider !== "local") {
    return staticConfig;
  }

  // Either modelId === "local" (legacy alias) or a static config with
  // provider="local". Both must resolve to a real chat model name via discovery.
  if (modelId === "local" || staticConfig?.provider === "local") {
    const baseUrl = process.env.LOCAL_LLM_URL;
    if (!baseUrl || baseUrl.trim().length === 0) {
      throw new Error(
        "Local model selected but LOCAL_LLM_URL is not configured. Set LOCAL_LLM_URL or choose a cloud model.",
      );
    }
    let discovery;
    try {
      discovery = await discoverLocalModels(baseUrl);
    } catch {
      throw new Error(
        "No local models found — start your local server and load a model.",
      );
    }
    if (discovery.chatModels.length === 0) {
      throw new Error(
        "No local models found — start your local server and load a model.",
      );
    }
    return buildSyntheticLocalModelConfig(discovery.chatModels[0], baseUrl);
  }

  // No static match. Try treating it as a dynamic local model name.
  const baseUrl = process.env.LOCAL_LLM_URL;
  if (baseUrl && baseUrl.trim().length > 0) {
    try {
      const discovery = await discoverLocalModels(baseUrl);
      if (discovery.chatModels.includes(modelId)) {
        return buildSyntheticLocalModelConfig(modelId, baseUrl);
      }
    } catch {
      // Fall through to the unknown-id error below.
    }
  }

  throw new Error(
    `Unknown model ID "${modelId}". Select a known model or load this model on your local server.`,
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN COMPLETION FUNCTION WITH FALLBACK CHAIN
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Generate a chat completion with automatic fallback chain.
 *
 * Fallback order: Selected Model → Sonnet 4.6 → GPT-5.2 → DeepSeek R1 →
 * Gemini 3.0 → MiniMax-M2.5 → Haiku 4.5 → Kimi K2.5 → Opus 4.6
 *
 * @param params - Completion parameters including optional modelId
 * @returns Completion result with provider info
 */
export async function generateCompletion(params: LLMCompletionParams): Promise<LLMCompletionResult> {
  const requestedModelId = params.modelId || getDefaultModel().id;
  const modelConfig = await resolveModelConfig(requestedModelId);

  console.log(`[LLM] Requested model: ${modelConfig.name} (${modelConfig.provider}/${modelConfig.modelId})`);

  // Try the requested provider first
  let result: LLMCompletionResult | null = null;

  switch (modelConfig.provider) {
    case 'deepseek':
      result = await completeDeepSeek(params, modelConfig.modelId);
      break;
    case 'moonshot':
      result = await completeMoonshot(params, modelConfig.modelId);
      break;
    case 'anthropic':
      result = await completeAnthropic(params, modelConfig.modelId);
      break;
    case 'gemini':
      result = await completeGemini(params, modelConfig.modelId);
      break;
    case 'minimax':
      result = await completeMiniMax(params, modelConfig.modelId);
      break;
    case 'openai':
      result = await completeOpenAI(params, modelConfig.modelId);
      break;
    case 'local':
      result = await completeLocal(params, modelConfig.modelId);
      break;
  }

  if (result) {
    result.requestedModel = requestedModelId;
    return result;
  }

  // Fallback chain excludes removed models and spreads provider families.
  const fallbackChain: Array<{ name: string; modelId: string; fn: (p: LLMCompletionParams, m: string) => Promise<LLMCompletionResult | null> }> = [
    { name: 'Claude Sonnet 4.6', modelId: 'claude-sonnet-4-6', fn: completeAnthropic },
    { name: 'GPT-5.2', modelId: 'gpt-5.2', fn: completeOpenAI },
    { name: 'DeepSeek R1', modelId: 'deepseek-reasoner', fn: completeDeepSeek },
    { name: 'Gemini 3.0', modelId: 'gemini-3-flash-preview', fn: completeGemini },
    { name: 'MiniMax-M2.5', modelId: 'MiniMax-M2.5', fn: completeMiniMax },
    { name: 'Claude Haiku 4.5', modelId: 'claude-haiku-4-5', fn: completeAnthropic },
    { name: 'Kimi K2.5', modelId: 'kimi-k2.5', fn: completeMoonshot },
    { name: 'Claude Opus 4.6', modelId: 'claude-opus-4-6', fn: completeAnthropic },
  ];

  for (const fallback of fallbackChain) {
    // Skip if this is the model we already tried
    if (fallback.modelId === modelConfig.modelId) continue;

    console.log(`[LLM] Falling back to ${fallback.name}...`);
    result = await fallback.fn(params, fallback.modelId);
    if (result) {
      result.requestedModel = requestedModelId;
      console.log(`[LLM] ${fallback.name} fallback succeeded`);
      return result;
    }
  }

  // If we get here, all providers failed
  throw new Error('All LLM providers failed. Check API keys and connectivity.');
}

// ════════════════════════════════════════════════════════════════════════════════
// EMBEDDINGS (delegated to embedding-client.ts)
// ════════════════════════════════════════════════════════════════════════════════

export { generateEmbedding, generateEmbeddings, getEmbeddingConfig } from './embedding-client';
