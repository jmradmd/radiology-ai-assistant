/**
 * Embedding Client
 *
 * Provider-agnostic embedding generation with auto-detection:
 *   1. EMBEDDING_PROVIDER env var explicitly selects "openai" | "local"
 *   2. "auto" (default): prefer OpenAI when OPENAI_API_KEY is set,
 *      fall back to LOCAL_LLM_URL, or throw if neither is available.
 *
 * Both providers use the `openai` npm package (local servers expose an
 * OpenAI-compatible /v1/embeddings endpoint).
 */

import OpenAI from 'openai';

function isRealApiKey(key: string | undefined): boolean {
  if (!key) return false;
  if (key.includes('...')) return false;
  if (key.includes('your-')) return false;
  if (key.includes('your_')) return false;
  if (key.length < 20) return false;
  return true;
}

// ════════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ════════════════════════════════════════════════════════════════════════════════

type EmbeddingProvider = 'openai' | 'local';

const DEFAULT_MODEL = 'text-embedding-3-small';
const MAX_INPUT_CHARS = 32_000;

function resolveConfig() {
  const explicit = (process.env.EMBEDDING_PROVIDER || 'auto').toLowerCase();
  const model = process.env.EMBEDDING_MODEL || DEFAULT_MODEL;
  const dimensions = process.env.EMBEDDING_DIMENSIONS
    ? parseInt(process.env.EMBEDDING_DIMENSIONS, 10)
    : undefined;

  let provider: EmbeddingProvider;

  if (explicit === 'openai') {
    provider = 'openai';
  } else if (explicit === 'local') {
    provider = 'local';
  } else {
    // auto-detect
    const hasOpenAI = isRealApiKey(process.env.OPENAI_API_KEY);
    const hasLocal =
      typeof process.env.LOCAL_LLM_URL === 'string' &&
      process.env.LOCAL_LLM_URL.trim().length > 0;

    if (hasOpenAI) {
      provider = 'openai';
    } else if (hasLocal) {
      provider = 'local';
    } else {
      throw new Error(
        '[embedding] No embedding provider available. Set OPENAI_API_KEY or LOCAL_LLM_URL.'
      );
    }
  }

  return { provider, model, dimensions };
}

// ════════════════════════════════════════════════════════════════════════════════
// CLIENT SINGLETON (lazy init)
// ════════════════════════════════════════════════════════════════════════════════

let _client: OpenAI | null = null;
let _provider: EmbeddingProvider | null = null;
let _model: string | null = null;
let _dimensions: number | undefined = undefined;
let _initialized = false;
let _logged = false;

function getClient(): { client: OpenAI; provider: EmbeddingProvider; model: string; dimensions: number | undefined } {
  if (_initialized && _client && _provider && _model) {
    return { client: _client, provider: _provider, model: _model, dimensions: _dimensions };
  }

  const config = resolveConfig();
  _provider = config.provider;
  _model = config.model;
  _dimensions = config.dimensions;
  _initialized = true;

  if (config.provider === 'local') {
    const baseURL = process.env.LOCAL_LLM_URL || 'http://localhost:1234/v1';
    _client = new OpenAI({ apiKey: 'no-key', baseURL });
  } else {
    _client = new OpenAI();
  }

  if (!_logged) {
    console.log(
      `[embedding] Provider: ${config.provider}, Model: ${config.model}, Dimensions: ${config.dimensions ?? 'native'}`
    );
    _logged = true;
  }

  return { client: _client, provider: _provider, model: _model, dimensions: _dimensions };
}

// ════════════════════════════════════════════════════════════════════════════════
// ERROR HELPERS
// ════════════════════════════════════════════════════════════════════════════════

function sanitizeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED_KEY]')
    .replace(/key-[A-Za-z0-9_-]+/g, '[REDACTED_KEY]')
    .replace(/Bearer\s+[A-Za-z0-9_.-]+/g, 'Bearer [REDACTED]');
}

// ════════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ════════════════════════════════════════════════════════════════════════════════

export type EmbeddingTask = 'query' | 'document';

/** Nomic models require task-specific prefixes for cosine similarity to work. */
function applyNomicPrefix(text: string, model: string, task: EmbeddingTask): string {
  if (!/nomic/i.test(model)) return text;
  return task === 'query' ? `search_query: ${text}` : `search_document: ${text}`;
}

/**
 * Generate a single embedding vector for the given text.
 * Input is truncated to 32 000 characters for safety.
 */
export async function generateEmbedding(text: string, task: EmbeddingTask = 'query'): Promise<number[]> {
  const truncated = text.slice(0, MAX_INPUT_CHARS);
  const { client, model, dimensions } = getClient();
  const input = applyNomicPrefix(truncated, model, task);

  try {
    const response = await client.embeddings.create({
      model,
      input,
      encoding_format: 'float',
      ...(dimensions != null && { dimensions }),
    });
    return response.data[0].embedding;
  } catch (error) {
    const msg = sanitizeError(error);
    console.error(`[embedding] failed message="${msg}"`);
    throw new Error(`Failed to generate embedding: ${msg}`);
  }
}

/**
 * Generate embeddings for multiple texts in a single API call.
 * Each text is truncated to 32 000 characters.
 */
export async function generateEmbeddings(texts: string[], task: EmbeddingTask = 'query'): Promise<number[][]> {
  const truncated = texts.map((t) => t.slice(0, MAX_INPUT_CHARS));
  const { client, model, dimensions } = getClient();
  const input = truncated.map((t) => applyNomicPrefix(t, model, task));

  try {
    const response = await client.embeddings.create({
      model,
      input,
      encoding_format: 'float',
      ...(dimensions != null && { dimensions }),
    });
    return response.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  } catch (error) {
    const msg = sanitizeError(error);
    console.error(`[embedding] batch failed message="${msg}"`);
    throw new Error(`Failed to generate embeddings: ${msg}`);
  }
}

/**
 * Return the resolved embedding configuration (useful for diagnostics).
 */
export function getEmbeddingConfig(): {
  provider: EmbeddingProvider;
  model: string;
  dimensions: number | undefined;
} {
  const { provider, model, dimensions } = getClient();
  return { provider, model, dimensions };
}
