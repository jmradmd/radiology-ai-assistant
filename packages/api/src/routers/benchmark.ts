import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  detectPotentialPHI,
  institutionSchema,
  outputStyleSchema,
  type Institution,
} from "@rad-assist/shared";
import { expandAbbreviationsForRetrieval } from "../lib/abbreviation-detector";
import { resolveAbbreviationClarificationCandidate } from "../lib/clarification-guard";
import { formatConciseResponse, shouldApplyConciseFormatting } from "../lib/concise-format";
import { assessEmergency, type EmergencyAssessment } from "../lib/emergency-detection";
import { getEmergencyKnowledgeOverride, getEligibilityGate, getKnowledgeGovernanceBlock } from "../lib/knowledge-governance";
import { getKnowledgeBoostCategory } from "../lib/knowledge-topic-detector";
import { generateEmbedding } from "../lib/llm-client";
import {
  analyzeQuery,
  assessInterventionRisk,
  shouldAnalyzeQuery,
  type InterventionRisk,
  type QueryAnalysis,
} from "../lib/query-analyzer";
import { classifyQueryDomain, isITQuery, type QueryDomainRoute } from "../lib/query-domain-classifier";
import {
  reconcileRouteAfterRetrieval,
  reconcileRouteForKnowledgeAvailability,
  resolveEffectiveQueryRoute,
} from "../lib/query-routing-safety";
import { RAG_CONFIG } from "../lib/rag-config";
import { validateResponse } from "../lib/response-validator";
import { filterResultsByDisplayRelevance } from "../lib/source-relevance";
import { analyzeTopics, getBoostCategory } from "../lib/topic-detector";
import { publicProcedure, router } from "../trpc";

type SearchResult = {
  id: string;
  content: string;
  chunkIndex: number;
  metadata: Record<string, unknown> | null;
  document_title: string;
  document_source: string;
  document_category: string;
  document_institution: string | null;
  document_domain: string;
  document_metadata: Record<string, unknown> | null;
  similarity: number;
  category_boost: number;
};

function loadAssistantSystemPrompt(): string {
  const filenames = ["ASSISTANT_SYSTEM_PROMPT.md"];
  const folderCandidates = ["knowledge", "Knowledge"];
  const candidateRoots = [
    process.cwd(),
    resolve(process.cwd(), ".."),
    resolve(process.cwd(), "..", ".."),
    resolve(process.cwd(), "..", "..", ".."),
  ];

  for (const root of candidateRoots) {
    for (const folder of folderCandidates) {
      for (const filename of filenames) {
        const candidate = join(root, folder, "prompts", filename);
        if (!existsSync(candidate)) continue;
        try {
          return readFileSync(candidate, "utf-8");
        } catch {
          // Continue trying candidates.
        }
      }
    }
  }
  return "";
}

const ASSISTANT_SYSTEM_PROMPT = loadAssistantSystemPrompt();

function buildInterventionRiskGate(interventionRisk: InterventionRisk): string {
  if (interventionRisk.level !== "invasive" && interventionRisk.level !== "medication") {
    return "";
  }

  return `INTERVENTION RISK GATE
The user's query involves or requests a recommendation for an invasive procedure or medication.

REQUIREMENTS:
- Prefer staged, non-invasive clarification when a safer next step exists.
- If key context is missing, state what would change the recommendation.
- Avoid first-person recommendation language.
- Keep escalation criteria explicit.`;
}

function buildConversationContext(
  query: string,
  history: Array<{ role: "user" | "assistant"; content: string }> | undefined,
): {
  conversationContext: string;
  effectiveQuery: string;
  hasFollowUpSignals: boolean;
} {
  if (!history || history.length === 0) {
    return { conversationContext: "", effectiveQuery: query, hasFollowUpSignals: false };
  }

  const conversationContext = history
    .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content.slice(0, 800)}`)
    .join("\n");

  const hasFollowUpSignals =
    query.length < 150 &&
    /^(huh|what|why|how|yes|no|ok|okay|thanks|explain|more|clarify|really|\?+|go on|continue|and|but|so)\b/i.test(
      query.trim(),
    );

  if (!hasFollowUpSignals) {
    return { conversationContext, effectiveQuery: query, hasFollowUpSignals };
  }

  const lastUser = [...history].reverse().find((message) => message.role === "user");
  const lastAssistant = [...history].reverse().find((message) => message.role === "assistant");
  const contextParts: string[] = [];
  if (lastUser) contextParts.push(`Previous question: ${lastUser.content.slice(0, 400)}`);
  if (lastAssistant) contextParts.push(`Previous answer: ${lastAssistant.content.slice(0, 400)}`);
  contextParts.push(`Follow-up: ${query}`);

  return {
    conversationContext,
    effectiveQuery: contextParts.join(" | "),
    hasFollowUpSignals,
  };
}

async function streamOllamaChat(params: {
  model: string;
  systemPrompt: string;
  userMessage: string;
  maxTokens: number;
  temperature: number;
  seed?: number;
}): Promise<{
  responseText: string;
  ttft_ms: number | null;
  total_time_ms: number | null;
  prompt_eval_duration_ns: number | null;
  eval_duration_ns: number | null;
  eval_count: number | null;
  tokens_per_second: number | null;
}> {
  const controller = new AbortController();
  const timeoutMs = 120_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: params.model,
        messages: [
          { role: "system", content: params.systemPrompt },
          { role: "user", content: params.userMessage },
        ],
        stream: true,
        options: {
          temperature: params.temperature,
          num_predict: params.maxTokens,
          seed: params.seed,
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
          const chunk = JSON.parse(line) as {
            done?: boolean;
            eval_count?: number;
            eval_duration?: number;
            prompt_eval_duration?: number;
            message?: { content?: string };
          };
          const content = chunk.message?.content ?? "";
          if (ttftMs === null && content.trim().length > 0) {
            ttftMs = Date.now() - startedAt;
          }
          responseText += content;
          if (chunk.done) {
            promptEvalDurationNs = chunk.prompt_eval_duration ?? null;
            evalDurationNs = chunk.eval_duration ?? null;
            evalCount = chunk.eval_count ?? null;
          }
        }
        newlineIndex = buffer.indexOf("\n");
      }
    }

    const totalTimeMs = Date.now() - startedAt;
    const tokensPerSecond =
      evalCount !== null && evalDurationNs && evalDurationNs > 0
        ? evalCount / (evalDurationNs / 1e9)
        : null;

    return {
      responseText,
      ttft_ms: ttftMs,
      total_time_ms: totalTimeMs,
      prompt_eval_duration_ns: promptEvalDurationNs,
      eval_duration_ns: evalDurationNs,
      eval_count: evalCount,
      tokens_per_second: tokensPerSecond,
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

function scoreSearchResult(result: SearchResult): number {
  return Number(result.similarity) * Number(result.category_boost);
}

function buildSystemPrompt(params: {
  query: string;
  route: QueryDomainRoute;
  emergencyAssessment: EmergencyAssessment;
  effectiveQuery: string;
  outputStyle: "concise" | "detailed" | "auto";
  institution?: Institution;
  modelTag: string;
  sources: SearchResult[];
  conversationContext: string;
  interventionRisk: InterventionRisk;
  knowledgeCorpusUnavailable: boolean;
}): { prompt: string; branch: "KNOWLEDGE_ONLY" | "HYBRID" | "EMERGENCY" | "ROUTINE" | "LOW_CONFIDENCE" } {
  const hasProtocolSources = params.sources.some((source) => source.document_domain === "PROTOCOL");
  const hasKnowledgeSources = params.sources.some((source) => source.document_domain === "KNOWLEDGE");
  const sourceList = params.sources
    .map(
      (source, index) =>
        `${index + 1}. [${source.document_domain}] "${source.document_title}" (${source.document_category}, ${Math.round(
          Number(source.similarity) * 100,
        )}% match)`,
    )
    .join("\n");
  const sourceContext = params.sources
    .map(
      (source, index) =>
        `[SOURCE ${index + 1} | ${source.document_domain}: "${source.document_title}"]\n${source.content}\n[END SOURCE ${
          index + 1
        }]`,
    )
    .join("\n\n");

  const styleGuidance =
    params.outputStyle === "concise"
      ? "Be direct and efficient. Use 2-5 sentences unless safety requires more structure."
      : params.outputStyle === "detailed"
        ? "Provide a thorough, well-structured response with sections when useful."
        : "Match response length and structure to the query complexity.";

  const base = ASSISTANT_SYSTEM_PROMPT || "You are the radiology assistant for a board-certified radiologist.";
  const knowledgeGovernanceBlock = getKnowledgeGovernanceBlock();
  const eligibilityGateBlock = getEligibilityGate();
  const emergencyKnowledgeOverride = getEmergencyKnowledgeOverride();
  const interventionRiskGate = buildInterventionRiskGate(params.interventionRisk);
  const identity = `IMPORTANT: You are the radiology assistant powered by local Ollama model ${params.modelTag}.`;
  const conversationBlock = params.conversationContext
    ? `\n\nCONVERSATION HISTORY:\n${params.conversationContext}`
    : "";

  if (!hasProtocolSources && hasKnowledgeSources) {
    return {
      branch: "KNOWLEDGE_ONLY",
      prompt: `${identity}

${base}

Use the retrieved radiology knowledge below. If none of the sources answer the question directly, answer from general radiology knowledge and say so explicitly.

${styleGuidance}

${knowledgeGovernanceBlock}
${eligibilityGateBlock}
${interventionRiskGate ? `\n${interventionRiskGate}` : ""}

AVAILABLE SOURCES:
${sourceList}

SOURCE CONTENT:
${sourceContext}${conversationBlock}`,
    };
  }

  if (hasProtocolSources && hasKnowledgeSources) {
    return {
      branch: "HYBRID",
      prompt: `${identity}

You are the radiology assistant with two source domains:
1. Institutional protocol documents
2. General radiology knowledge references

Always distinguish protocol guidance from general knowledge. If they differ, present institutional protocol first and then note the discrepancy.

${styleGuidance}
${knowledgeGovernanceBlock}
${eligibilityGateBlock}
${interventionRiskGate ? `\n${interventionRiskGate}` : ""}

RESPONSE STRUCTURE:
1. Institutional Protocol Guidance
2. Radiology Knowledge Context
3. Discrepancy Note (if needed)

AVAILABLE SOURCES:
${sourceList}

SOURCE CONTENT:
${sourceContext}${conversationBlock}`,
    };
  }

  if (hasProtocolSources && (params.emergencyAssessment.isEmergency || params.emergencyAssessment.severity === "urgent")) {
    return {
      branch: "EMERGENCY",
      prompt: `${identity}

You are an emergency radiology protocol assistant.
Triggers: ${params.emergencyAssessment.triggers.join(", ") || "none"}

Lead with the most critical immediate action. Keep doses and thresholds exact when cited from protocol sources. Include monitoring and escalation guidance.

${styleGuidance}
${interventionRiskGate ? `\n${interventionRiskGate}` : ""}
${emergencyKnowledgeOverride}

AVAILABLE SOURCES:
${sourceList}

PROTOCOL CONTENT:
${sourceContext}${conversationBlock}`,
    };
  }

  if (hasProtocolSources) {
    return {
      branch: "ROUTINE",
      prompt: `${identity}

You are a clinical protocol assistant for ${params.institution ?? "the institution"}.
Use the protocol sources below. If a scoring system or guideline does not apply to the described patient, say that first before offering alternative guidance.

${styleGuidance}
${knowledgeGovernanceBlock}
${eligibilityGateBlock}
${interventionRiskGate ? `\n${interventionRiskGate}` : ""}

AVAILABLE SOURCES:
${sourceList}

PROTOCOL CONTENT:
${sourceContext}${conversationBlock}`,
    };
  }

  return {
    branch: "LOW_CONFIDENCE",
    prompt: `${identity}

You are a radiology assistant operating with limited retrieved context.
${params.knowledgeCorpusUnavailable ? "Knowledge retrieval is unavailable because the knowledge corpus is not indexed." : "Retrieved sources were limited or weakly relevant."}

State uncertainty explicitly and recommend the safest next step.

${styleGuidance}
${knowledgeGovernanceBlock}
${eligibilityGateBlock}
${interventionRiskGate ? `\n${interventionRiskGate}` : ""}${conversationBlock}`,
  };
}

export const benchmarkRouter = router({
  benchmarkStream: publicProcedure
    .input(
      z.object({
        query: z.string().min(1).max(8000),
        ollamaModel: z.string().regex(/^[a-z0-9][a-z0-9:._/-]{0,80}$/i),
        institution: institutionSchema.optional(),
        outputStyle: outputStyleSchema.optional(),
        conversationHistory: z
          .array(
            z.object({
              role: z.enum(["user", "assistant"]),
              content: z.string(),
            }),
          )
          .max(10)
          .optional(),
        maxTokens: z.number().int().min(1).max(4096).default(1024),
        temperature: z.number().min(0).max(2).default(0),
        seed: z.number().int().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (process.env.ENABLE_BENCHMARK_ENDPOINT !== "1") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Benchmark endpoint disabled" });
      }

      const stageTimingsMs = {
        phi_gate: 0,
        domain_classification: 0,
        embedding: 0,
        retrieval: 0,
        prompt_build: 0,
        llm_generation: 0,
        response_validation: 0,
      };

      const measure = async <T,>(bucket: keyof typeof stageTimingsMs, fn: () => Promise<T> | T): Promise<T> => {
        const startedAt = Date.now();
        try {
          return await fn();
        } finally {
          stageTimingsMs[bucket] = Date.now() - startedAt;
        }
      };

      await measure("phi_gate", () => {
        const phiResult = detectPotentialPHI(input.query);
        if (phiResult.isBlocked) {
          throw new TRPCError({ code: "BAD_REQUEST", message: phiResult.summary });
        }
      });

      const conversationState = buildConversationContext(input.query, input.conversationHistory);

      const domainState = await measure("domain_classification", async () => {
        const queryEmergencyAssessment = assessEmergency(input.query);
        const queryDomain = await classifyQueryDomain(input.query);
        let effectiveQueryRoute: QueryDomainRoute = resolveEffectiveQueryRoute(queryDomain.route, queryEmergencyAssessment);
        let shouldSearchProtocol = effectiveQueryRoute !== "KNOWLEDGE";
        let shouldSearchKnowledge = effectiveQueryRoute !== "PROTOCOL";
        let knowledgeCorpusIndexed: boolean | null = null;
        let knowledgeCorpusDocumentCount: number | null = null;
        let knowledgeRouteUnavailable = false;

        if (shouldSearchKnowledge) {
          const [knowledgeCorpusStats] = await ctx.prisma.$queryRaw<Array<{ document_count: number }>>`
            SELECT COUNT(*)::int AS document_count
            FROM "Document"
            WHERE "isActive" = true
              AND domain = 'KNOWLEDGE'::"Domain"
          `;
          knowledgeCorpusDocumentCount = Number(knowledgeCorpusStats?.document_count ?? 0);
          knowledgeCorpusIndexed = knowledgeCorpusDocumentCount > 0;
          const reconciliation = reconcileRouteForKnowledgeAvailability(effectiveQueryRoute, {
            isIndexed: knowledgeCorpusIndexed,
            indexedDocumentCount: knowledgeCorpusDocumentCount,
          });
          effectiveQueryRoute = reconciliation.route;
          shouldSearchProtocol = effectiveQueryRoute !== "KNOWLEDGE";
          shouldSearchKnowledge = effectiveQueryRoute !== "PROTOCOL";
          knowledgeRouteUnavailable = reconciliation.knowledgeUnavailableForRoute === true;
        }

        return {
          queryEmergencyAssessment,
          queryDomain,
          effectiveQueryRoute,
          shouldSearchProtocol,
          shouldSearchKnowledge,
          knowledgeCorpusIndexed,
          knowledgeCorpusDocumentCount,
          knowledgeRouteUnavailable,
        };
      });

      let queryAnalysis: QueryAnalysis | null = null;
      let effectiveCategory: string | undefined;
      let interventionRisk = assessInterventionRisk(input.query, conversationState.conversationContext);
      const isClarificationResponse = /i meant|i mean|by .+ i meant|referring to|yes|no.*actually/i.test(input.query);
      const isITMode = isITQuery(input.query);
      if (domainState.shouldSearchProtocol && !isClarificationResponse && shouldAnalyzeQuery(input.query)) {
        queryAnalysis = await analyzeQuery(input.query, {
          conversationContext: conversationState.conversationContext,
          priorUserMessage: input.conversationHistory?.filter((message) => message.role === "user").at(-1)?.content,
          priorAssistantMessage: input.conversationHistory?.filter((message) => message.role === "assistant").at(-1)?.content,
        });
        interventionRisk = queryAnalysis.interventionRisk;
        if (queryAnalysis.detectedTopic) {
          effectiveCategory = queryAnalysis.detectedTopic.category;
        }
        if (queryAnalysis.needsClarification && queryAnalysis.ambiguousTerms.length > 0) {
          const clarificationCandidate = resolveAbbreviationClarificationCandidate(queryAnalysis.ambiguousTerms[0]);
          if (clarificationCandidate) {
            return {
              prompt: "",
              responseText: `I noticed you used "${clarificationCandidate.abbreviation}" which can mean several things:\n\n${clarificationCandidate.meanings
                .map((meaning, index) => `${index + 1}. ${meaning}`)
                .join("\n")}\n\nWhich meaning did you intend?`,
              streamId: `bench-${Date.now()}`,
              sources: [],
              timings: {
                ttft_ms: null,
                total_time_ms: null,
                prompt_eval_duration_ns: null,
                eval_duration_ns: null,
                eval_count: null,
                tokens_per_second: null,
              },
              stageTimingsMs,
              validation: null,
              emergencyDetected: false,
              routeUsed: domainState.effectiveQueryRoute,
            };
          }
        }
      } else if (domainState.shouldSearchProtocol) {
        const topicAnalysis = analyzeTopics(input.query);
        const boostCategory = getBoostCategory(topicAnalysis);
        if (boostCategory) effectiveCategory = boostCategory;
      }

      if (!effectiveCategory && domainState.shouldSearchKnowledge) {
        const knowledgeBoost = getKnowledgeBoostCategory(input.query);
        if (knowledgeBoost) effectiveCategory = knowledgeBoost.category;
      }

      const queryForEmbedding = await measure("embedding", async () => {
        const baseQuery = queryAnalysis?.expandedQuery && !isITMode ? queryAnalysis.expandedQuery : conversationState.effectiveQuery;
        const { expandedText, expansions } = expandAbbreviationsForRetrieval(baseQuery, effectiveCategory);
        return Object.keys(expansions).length > 0 ? expandedText : baseQuery;
      });

      const queryEmbedding = await generateEmbedding(queryForEmbedding);

      const searchState = await measure("retrieval", async () => {
        const runDomainSearch = async (
          storedDomain: "PROTOCOL" | "KNOWLEDGE",
          applyInstitutionFilter: boolean,
        ): Promise<SearchResult[]> => {
          const domainFilter = Prisma.sql`AND dc.domain = ${storedDomain}::"Domain"`;
          const institutionFilter =
            applyInstitutionFilter && input.institution
              ? Prisma.sql`AND d.institution = ${input.institution}::"Institution"`
              : Prisma.empty;

          const boostedCategoryFilter = effectiveCategory
            ? Prisma.sql`CASE WHEN d.category = ${effectiveCategory} THEN 1.20 ELSE 1.0 END`
            : Prisma.sql`1.0`;

          const rows = await ctx.prisma.$queryRaw<SearchResult[]>`
            SELECT
              dc.id,
              dc.content,
              dc."chunkIndex",
              dc.metadata,
              d.title as document_title,
              d.source as document_source,
              d.category as document_category,
              d.institution::text as document_institution,
              dc.domain::text as document_domain,
              d.metadata as document_metadata,
              1 - (dc.embedding <=> ${`[${queryEmbedding.join(",")}]`}::vector) as similarity,
              ${boostedCategoryFilter} as category_boost
            FROM "DocumentChunk" dc
            JOIN "Document" d ON dc."documentId" = d.id
            WHERE d."isActive" = true
              ${domainFilter}
              ${institutionFilter}
            ORDER BY dc.embedding <=> ${`[${queryEmbedding.join(",")}]`}::vector
            LIMIT ${RAG_CONFIG.MAX_SEARCH_RESULTS}
          `;
          return rows
            .sort((a, b) => scoreSearchResult(b) - scoreSearchResult(a))
            .slice(0, RAG_CONFIG.MAX_SEARCH_RESULTS);
        };

        let protocolResults = domainState.shouldSearchProtocol ? await runDomainSearch("PROTOCOL", true) : [];
        let knowledgeResults = domainState.shouldSearchKnowledge ? await runDomainSearch("KNOWLEDGE", false) : [];

        if (!domainState.shouldSearchProtocol && domainState.shouldSearchKnowledge && knowledgeResults.length === 0) {
          protocolResults = await runDomainSearch("PROTOCOL", true);
        } else if (domainState.shouldSearchProtocol && !domainState.shouldSearchKnowledge && protocolResults.length === 0) {
          knowledgeResults = await runDomainSearch("KNOWLEDGE", false);
        }

        const reconciledRoute = reconcileRouteAfterRetrieval(domainState.effectiveQueryRoute, {
          protocolHitCount: protocolResults.length,
          knowledgeHitCount: knowledgeResults.length,
        });

        let combinedResults: SearchResult[];
        if (reconciledRoute.route === "HYBRID") {
          combinedResults = [...protocolResults, ...knowledgeResults]
            .sort((a, b) => scoreSearchResult(b) - scoreSearchResult(a))
            .slice(0, RAG_CONFIG.MAX_SEARCH_RESULTS);
        } else if (reconciledRoute.route === "PROTOCOL") {
          combinedResults = protocolResults;
        } else {
          combinedResults = knowledgeResults;
        }

        const { relevantResults } = filterResultsByDisplayRelevance(combinedResults, queryForEmbedding, {
          minDisplaySimilarity: RAG_CONFIG.MIN_DISPLAY_SIMILARITY,
          minDisplaySimilarityKnowledge: RAG_CONFIG.MIN_DISPLAY_SIMILARITY_KNOWLEDGE,
          borderlineBuffer: 0.08,
          borderlineMinOverlap: 1,
        });

        return {
          effectiveQueryRoute: reconciledRoute.route,
          searchResults: relevantResults,
        };
      });

      if (searchState.searchResults.length === 0) {
        return {
          prompt: "",
          responseText: domainState.knowledgeRouteUnavailable
            ? "I couldn't find indexed institutional protocol documents for this query, and radiology knowledge retrieval is unavailable because the knowledge corpus is not indexed in this environment."
            : "I couldn't find indexed sources for this query.",
          streamId: `bench-${Date.now()}`,
          sources: [],
          timings: {
            ttft_ms: null,
            total_time_ms: null,
            prompt_eval_duration_ns: null,
            eval_duration_ns: null,
            eval_count: null,
            tokens_per_second: null,
          },
          stageTimingsMs,
          validation: null,
          emergencyDetected: false,
          routeUsed: searchState.effectiveQueryRoute,
        };
      }

      const promptState = await measure("prompt_build", async () =>
        buildSystemPrompt({
          query: input.query,
          route: searchState.effectiveQueryRoute,
          emergencyAssessment: searchState.searchResults.some((source) => source.document_domain === "PROTOCOL")
            ? domainState.queryEmergencyAssessment
            : { isEmergency: false, severity: "routine", triggers: [], escalators: [], numericAlerts: [] },
          effectiveQuery: queryForEmbedding,
          outputStyle: input.outputStyle ?? "auto",
          institution: input.institution,
          modelTag: input.ollamaModel,
          sources: searchState.searchResults,
          conversationContext: conversationState.conversationContext,
          interventionRisk,
          knowledgeCorpusUnavailable: domainState.knowledgeRouteUnavailable,
        }),
      );

      const generationState = await measure("llm_generation", async () => {
        let totalPromptEvalNs = 0;
        let totalEvalDurationNs = 0;
        let totalEvalCount = 0;
        let totalGenerationMs = 0;
        let firstTokenMs: number | null = null;

        const runCompletion = async (prompt: string) => {
          const result = await streamOllamaChat({
            model: input.ollamaModel,
            systemPrompt: prompt,
            userMessage: input.query,
            maxTokens: input.maxTokens,
            temperature: input.temperature,
            seed: input.seed,
          });

          if (firstTokenMs === null) firstTokenMs = result.ttft_ms;
          totalGenerationMs += result.total_time_ms ?? 0;
          totalPromptEvalNs += result.prompt_eval_duration_ns ?? 0;
          totalEvalDurationNs += result.eval_duration_ns ?? 0;
          totalEvalCount += result.eval_count ?? 0;

          return result;
        };

        const initial = await runCompletion(promptState.prompt);
        const shouldFormatConcise = shouldApplyConciseFormatting({
          isConciseOutput: (input.outputStyle ?? "auto") === "concise",
          severity: domainState.queryEmergencyAssessment.severity,
          currentBranch: promptState.branch,
        });

        let responseText = shouldFormatConcise ? formatConciseResponse(initial.responseText) : initial.responseText;
        let validation = validateResponse(responseText, {
          interventionRisk,
          severity: domainState.queryEmergencyAssessment.severity,
          branch: promptState.branch,
        });

        if (validation.requiresRegeneration) {
          const correctionPrompt = `${promptState.prompt}

Your previous response violated response-governance rules. Regenerate with these corrections:
- Remove first-person recommendation language.
- Use staged or qualified guidance for invasive action.
- Preserve source-grounded claims.
- Keep the answer concise and clinically safe.`;
          const regenerated = await runCompletion(correctionPrompt);
          responseText = shouldFormatConcise ? formatConciseResponse(regenerated.responseText) : regenerated.responseText;
          validation = validateResponse(responseText, {
            interventionRisk,
            severity: domainState.queryEmergencyAssessment.severity,
            branch: promptState.branch,
          });
        }

        return {
          responseText,
          validation,
          timings: {
            ttft_ms: firstTokenMs,
            total_time_ms: totalGenerationMs,
            prompt_eval_duration_ns: totalPromptEvalNs || null,
            eval_duration_ns: totalEvalDurationNs || null,
            eval_count: totalEvalCount || null,
            tokens_per_second: totalEvalCount > 0 && totalEvalDurationNs > 0 ? totalEvalCount / (totalEvalDurationNs / 1e9) : null,
          },
        };
      });

      await measure("response_validation", async () => generationState.validation);

      return {
        prompt: promptState.prompt,
        responseText: generationState.responseText,
        streamId: `bench-${Date.now()}`,
        sources: searchState.searchResults.map((source) => ({
          title: source.document_title,
          similarity: Math.round(Number(source.similarity) * 100),
          content: source.content,
        })),
        timings: generationState.timings,
        stageTimingsMs,
        validation: generationState.validation,
        emergencyDetected: domainState.queryEmergencyAssessment.isEmergency,
        routeUsed: searchState.effectiveQueryRoute,
      };
    }),
});
