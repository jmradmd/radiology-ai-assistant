import type { OllamaChatMessage, OllamaStreamResult } from "./types";

export interface OllamaStreamOptions {
  baseUrl: string;
  model: string;
  messages: OllamaChatMessage[];
  maxTokens: number;
  temperature: number;
  seed?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface OllamaModelSummary {
  name: string;
  digest: string;
  size: number;
}

export interface OllamaModelShow {
  digest: string;
  modelfile: string;
  details?: {
    parameter_size?: string;
    quantization_level?: string;
    family?: string;
  };
}

function safeJsonParse(line: string): Record<string, unknown> {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function extractChunkContent(chunk: Record<string, unknown>): string {
  const message = chunk.message;
  if (message && typeof message === "object" && !Array.isArray(message)) {
    const content = (message as Record<string, unknown>).content;
    return typeof content === "string" ? content : "";
  }
  const response = chunk.response;
  return typeof response === "string" ? response : "";
}

export async function streamChat(options: OllamaStreamOptions): Promise<OllamaStreamResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => performance.now());
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 120_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = now();

  try {
    const response = await fetchImpl(`${options.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        stream: true,
        options: {
          temperature: options.temperature,
          num_predict: options.maxTokens,
          seed: options.seed,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      const text = await response.text();
      throw new Error(text || `Ollama returned ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let responseText = "";
    let ttftMs: number | null = null;
    let promptEvalDurationNs: number | null = null;
    let evalDurationNs: number | null = null;
    let evalCount: number | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line.length > 0) {
          const chunk = safeJsonParse(line);
          const content = extractChunkContent(chunk);
          if (ttftMs === null && content.trim().length > 0) {
            ttftMs = now() - startedAt;
          }
          responseText += content;

          if (chunk.done === true) {
            promptEvalDurationNs =
              typeof chunk.prompt_eval_duration === "number" ? chunk.prompt_eval_duration : null;
            evalDurationNs = typeof chunk.eval_duration === "number" ? chunk.eval_duration : null;
            evalCount = typeof chunk.eval_count === "number" ? chunk.eval_count : null;
          }
        }
        newlineIndex = buffer.indexOf("\n");
      }
    }

    const totalTimeMs = now() - startedAt;
    const tokensPerSecond =
      evalCount !== null && evalDurationNs && evalDurationNs > 0
        ? evalCount / (evalDurationNs / 1e9)
        : null;

    return {
      responseText,
      ttftMs,
      totalTimeMs,
      evalCount,
      promptEvalDurationNs,
      evalDurationNs,
      tokensPerSecond,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Ollama stream timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function warmUp(baseUrl: string, model: string, maxTokens = 1): Promise<void> {
  await streamChat({
    baseUrl,
    model,
    messages: [{ role: "user", content: "ping" }],
    maxTokens,
    temperature: 0,
  });
}

export async function unload(baseUrl: string, model: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const response = await fetchImpl(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, keep_alive: 0 }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Failed to unload ${model}`);
  }
}

export async function listModels(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<OllamaModelSummary[]> {
  const response = await fetchImpl(`${baseUrl}/api/tags`);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Failed to list Ollama models (${response.status})`);
  }
  const payload = (await response.json()) as { models?: OllamaModelSummary[] };
  return Array.isArray(payload.models) ? payload.models : [];
}

export async function showModel(baseUrl: string, model: string, fetchImpl: typeof fetch = fetch): Promise<OllamaModelShow> {
  const response = await fetchImpl(`${baseUrl}/api/show`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Failed to inspect Ollama model ${model}`);
  }
  const payload = (await response.json()) as Partial<OllamaModelShow>;
  const derivedDigest =
    payload.digest ||
    payload.modelfile?.match(/sha256-([a-f0-9]+)/i)?.[1] ||
    "unknown";
  return {
    digest: derivedDigest,
    modelfile: payload.modelfile ?? "",
    details: payload.details,
  };
}
