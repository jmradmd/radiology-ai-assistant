export interface ProviderHealthResult {
  llm: {
    status: "ok" | "no_provider" | "no_api_key" | "server_unreachable" | "no_chat_model";
    provider: string | null;
    model: string | null;
    message: string | null;
  };
  embedding: {
    status: "ok" | "no_provider" | "server_unreachable" | "no_embedding_model";
    provider: string | null;
    model: string | null;
    message: string | null;
  };
  healthy: boolean;
}

export interface DiscoveredModels {
  chatModels: string[];
  embeddingModels: string[];
  raw: Array<{ id: string; type?: string }>;
  timestamp: number;
}

class LocalServerError extends Error {
  constructor(
    public reason: "unreachable" | "unexpected_response",
    message: string,
  ) {
    super(message);
    this.name = "LocalServerError";
  }
}

function isRealApiKey(key: string | undefined): boolean {
  if (!key) return false;
  if (key.includes("...")) return false;
  if (key.includes("your-")) return false;
  if (key.includes("your_")) return false;
  if (key.length < 20) return false;
  return true;
}

let cachedDiscovery: DiscoveredModels | null = null;

export function clearModelCache(): void {
  cachedDiscovery = null;
}

export async function discoverLocalModels(
  baseUrl: string,
): Promise<DiscoveredModels> {
  if (cachedDiscovery && Date.now() - cachedDiscovery.timestamp < 60_000) {
    return cachedDiscovery;
  }

  let normalized = baseUrl.replace(/\/+$/, "");
  if (!normalized.endsWith("/v1")) {
    normalized += "/v1";
  }
  const url = `${normalized}/models`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);

  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (err: any) {
    throw new LocalServerError(
      "unreachable",
      `Cannot reach local server at ${baseUrl}: ${err.message ?? err}`,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new LocalServerError(
      "unexpected_response",
      `Local server returned HTTP ${response.status}`,
    );
  }

  let json: any;
  try {
    json = await response.json();
  } catch {
    throw new LocalServerError(
      "unexpected_response",
      "Local server returned invalid JSON",
    );
  }

  const data: Array<{ id: string; type?: string }> = Array.isArray(json?.data)
    ? json.data
    : [];

  const chatModels: string[] = [];
  const embeddingModels: string[] = [];

  for (const model of data) {
    if (model.type === "embedding") {
      embeddingModels.push(model.id);
    } else if (model.type != null) {
      chatModels.push(model.id);
    } else {
      // Ollama compatibility: no type field
      if (/embed/i.test(model.id)) {
        embeddingModels.push(model.id);
      } else {
        chatModels.push(model.id);
      }
    }
  }

  const result: DiscoveredModels = {
    chatModels,
    embeddingModels,
    raw: data,
    timestamp: Date.now(),
  };

  cachedDiscovery = result;
  return result;
}

export async function checkProviderHealth(): Promise<ProviderHealthResult> {
  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;
    const MOONSHOT_API_KEY = process.env.MOONSHOT_API_KEY;
    const LOCAL_LLM_URL = process.env.LOCAL_LLM_URL;
    const EMBEDDING_PROVIDER = process.env.EMBEDDING_PROVIDER;
    const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL;

    // Step 1: Probe local server (if configured)
    let localDiscovery: DiscoveredModels | null = null;
    let localError: LocalServerError | null = null;

    if (LOCAL_LLM_URL && LOCAL_LLM_URL.trim().length > 0) {
      try {
        localDiscovery = await discoverLocalModels(LOCAL_LLM_URL);
      } catch (err) {
        if (err instanceof LocalServerError) {
          localError = err;
        } else {
          localError = new LocalServerError(
            "unreachable",
            `Unexpected error: ${err}`,
          );
        }
      }
    }

    // Step 2: Embedding health check
    type EmbeddingStatus = ProviderHealthResult["embedding"];
    let embeddingResult: EmbeddingStatus;

    const useOpenAIEmbeddings =
      EMBEDDING_PROVIDER === "openai" ||
      ((!EMBEDDING_PROVIDER || EMBEDDING_PROVIDER === "auto") &&
        isRealApiKey(OPENAI_API_KEY));

    const useLocalEmbeddings =
      EMBEDDING_PROVIDER === "local" ||
      ((!EMBEDDING_PROVIDER || EMBEDDING_PROVIDER === "auto") &&
        !isRealApiKey(OPENAI_API_KEY));

    if (useOpenAIEmbeddings) {
      embeddingResult = {
        status: "ok",
        provider: "openai",
        model: EMBEDDING_MODEL || "text-embedding-3-small",
        message: null,
      };
    } else if (useLocalEmbeddings) {
      if (!LOCAL_LLM_URL || LOCAL_LLM_URL.trim().length === 0) {
        embeddingResult = {
          status: "no_provider",
          provider: null,
          model: null,
          message:
            "No embedding provider configured. Set OPENAI_API_KEY for cloud embeddings or LOCAL_LLM_URL for local embeddings.",
        };
      } else if (localError) {
        embeddingResult = {
          status: "server_unreachable",
          provider: "local",
          model: null,
          message: `Cannot reach local server at ${LOCAL_LLM_URL}. Start LM Studio or Ollama and load a model.`,
        };
      } else if (
        localDiscovery &&
        localDiscovery.embeddingModels.length === 0
      ) {
        embeddingResult = {
          status: "no_embedding_model",
          provider: "local",
          model: null,
          message:
            "Local server is running but no embedding model is loaded. Load an embedding model (e.g., nomic-embed-text) in LM Studio.",
        };
      } else {
        embeddingResult = {
          status: "ok",
          provider: "local",
          model:
            EMBEDDING_MODEL ||
            localDiscovery?.embeddingModels[0] ||
            null,
          message: null,
        };
      }
    } else {
      embeddingResult = {
        status: "no_provider",
        provider: null,
        model: null,
        message:
          "No embedding provider configured. Set OPENAI_API_KEY for cloud embeddings or LOCAL_LLM_URL for local embeddings.",
      };
    }

    // Step 3: LLM health check
    type LLMStatus = ProviderHealthResult["llm"];
    let llmResult: LLMStatus | null = null;

    const PROVIDER_KEYS = [
      { provider: "anthropic", key: ANTHROPIC_API_KEY, label: "Claude" },
      { provider: "openai", key: OPENAI_API_KEY, label: "GPT" },
      { provider: "deepseek", key: DEEPSEEK_API_KEY, label: "DeepSeek" },
      { provider: "gemini", key: GEMINI_API_KEY, label: "Gemini" },
      { provider: "minimax", key: MINIMAX_API_KEY, label: "MiniMax" },
      { provider: "moonshot", key: MOONSHOT_API_KEY, label: "Kimi" },
    ];

    // Check local first
    if (localDiscovery && localDiscovery.chatModels.length > 0) {
      llmResult = {
        status: "ok",
        provider: "local",
        model: localDiscovery.chatModels[0],
        message: null,
      };
    }

    // Fall through to cloud check if no local chat model
    if (!llmResult) {
      const availableCloud = PROVIDER_KEYS.filter((p) =>
        isRealApiKey(p.key),
      );

      if (availableCloud.length === 0) {
        if (LOCAL_LLM_URL && LOCAL_LLM_URL.trim().length > 0 && localError) {
          llmResult = {
            status: "server_unreachable",
            provider: null,
            model: null,
            message: `Cannot reach local server at ${LOCAL_LLM_URL} and no cloud API keys are configured. Start LM Studio or Ollama, or add a cloud API key to .env.local.`,
          };
        } else if (
          LOCAL_LLM_URL &&
          LOCAL_LLM_URL.trim().length > 0 &&
          localDiscovery &&
          localDiscovery.chatModels.length === 0
        ) {
          llmResult = {
            status: "no_chat_model",
            provider: "local",
            model: null,
            message:
              "Local server is running but no chat model is loaded. Load a chat model (e.g., DeepSeek, Llama) in LM Studio.",
          };
        } else {
          llmResult = {
            status: "no_provider",
            provider: null,
            model: null,
            message:
              "No LLM provider configured. Add at least one API key (e.g., ANTHROPIC_API_KEY) to .env.local or start a local server.",
          };
        }
      } else {
        if (isRealApiKey(ANTHROPIC_API_KEY)) {
          llmResult = {
            status: "ok",
            provider: "anthropic",
            model: "claude-haiku",
            message: null,
          };
        } else {
          const firstAvailable = availableCloud[0];
          llmResult = {
            status: "ok",
            provider: firstAvailable.provider,
            model: null,
            message: `Default model Claude Haiku requires ANTHROPIC_API_KEY. The system will fall back to ${firstAvailable.label}.`,
          };
        }
      }
    }

    // Step 4: Combine and return
    const healthy =
      embeddingResult.status === "ok" && llmResult.status === "ok";
    return { llm: llmResult, embedding: embeddingResult, healthy };
  } catch {
    // A broken health check must never block the app
    return {
      llm: { status: "ok", provider: null, model: null, message: null },
      embedding: { status: "ok", provider: null, model: null, message: null },
      healthy: true,
    };
  }
}
