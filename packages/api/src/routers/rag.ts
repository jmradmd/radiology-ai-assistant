/**
 * RAG Router - Protocol Assistant with Hybrid Response Architecture
 * 
 * Uses Claude for chat completion (better instruction following for clinical safety)
 * Provides both LLM summary AND verbatim protocol text for verification
 */

import { z } from "zod";
import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, adminProcedure } from "../trpc";
import { ragQuerySchema, subspecialtySchema, institutionSchema, llmModelIdSchema, outputStyleSchema, getDefaultModel, type Institution, type SourceDomain } from "@rad-assist/shared";
import { detectPotentialPHI, PHIDetectedError, prepareAuditData, validateNoPHI, isOverridableBlock } from "@rad-assist/shared";
import { RAG_CONFIG } from "../lib/rag-config";
import { generateCompletion, generateEmbedding, resolveModelConfig } from "../lib/llm-client";
import { assessEmergency, type EmergencyAssessment } from "../lib/emergency-detection";

function loadAssistantSystemPrompt(): { prompt: string; sourcePath: string | null } {
  const filenames = ["ASSISTANT_SYSTEM_PROMPT.md"];
  const folderCandidates = ["knowledge", "Knowledge"];
  const candidateRoots = [
    process.cwd(),
    resolve(process.cwd(), ".."),
    resolve(process.cwd(), "..", ".."),
    resolve(process.cwd(), "..", "..", ".."),
  ];

  const candidatePaths = new Set<string>();
  for (const root of candidateRoots) {
    for (const folder of folderCandidates) {
      for (const filename of filenames) {
        candidatePaths.add(join(root, folder, "prompts", filename));
      }
    }
  }

  for (const candidatePath of candidatePaths) {
    if (!existsSync(candidatePath)) continue;
    try {
      return {
        prompt: readFileSync(candidatePath, "utf-8"),
        sourcePath: candidatePath,
      };
    } catch {
      // Keep trying additional candidates.
    }
  }

  return { prompt: "", sourcePath: null };
}

// Load assistant system prompt once at startup
const loadedAssistantPrompt = loadAssistantSystemPrompt();
const ASSISTANT_SYSTEM_PROMPT = loadedAssistantPrompt.prompt;
if (loadedAssistantPrompt.sourcePath) {
  console.log(`[RAG] Loaded assistant system prompt from ${loadedAssistantPrompt.sourcePath}`);
} else {
  console.warn("[RAG] ASSISTANT_SYSTEM_PROMPT.md not found — Knowledge mode will use fallback prompt");
}
import { expandAbbreviationsForRetrieval } from "../lib/abbreviation-detector";
import { resolveAbbreviationClarificationCandidate } from "../lib/clarification-guard";
import {
  analyzeTopics,
  getBoostCategory,
  type TopicAnalysis,
} from "../lib/topic-detector";
import {
  analyzeQuery,
  assessInterventionRisk,
  shouldAnalyzeQuery,
  type InterventionRisk,
  type QueryAnalysis,
} from "../lib/query-analyzer";
import { getKnowledgeBoostCategory } from "../lib/knowledge-topic-detector";
import { classifyQueryDomain, isITQuery, type QueryDomainRoute } from "../lib/query-domain-classifier";
import { formatConciseResponse, shouldApplyConciseFormatting } from "../lib/concise-format";
import {
  reconcileRouteAfterRetrieval,
  reconcileRouteForKnowledgeAvailability,
  resolveEffectiveQueryRoute,
} from "../lib/query-routing-safety";
import { getKnowledgeGovernanceBlock, getEligibilityGate, getEmergencyKnowledgeOverride } from "../lib/knowledge-governance";
import { validateResponse, validateCitations } from "../lib/response-validator";
import { filterResultsByDisplayRelevance } from "../lib/source-relevance";

// ════════════════════════════════════════════════════════════════════════════════
// TYPES (exported for type inference)
// ════════════════════════════════════════════════════════════════════════════════

export interface VerbatimSource {
  title: string;
  content: string;
  category: string;
  domain: SourceDomain;
  institution?: Institution;
  sourceLabel?: string;
  similarity: number;
  url: string | null;
  chunkIndex: number;
  pageStart?: number;    // First page this chunk appears on
  pageEnd?: number;      // Last page this chunk appears on (may span multiple)
}

export interface GuidelineContext {
  source: string;
  relevantExcerpt: string;
  deltaNote?: string;
  similarity: number;
}

export interface ChatResponse {
  summary: string;
  citationSources: VerbatimSource[];
  verbatimSources: VerbatimSource[];
  guidelineContext?: GuidelineContext;
  confidence: number;
  emergencyAssessment: EmergencyAssessment;
  conversationId: string;
  hasRelevantContent: boolean;
  // Model info - which model actually responded (may differ from requested if fallback occurred)
  modelInfo?: {
    requested: string;      // Model user selected (e.g., "kimi-k2.5")
    actual: string;         // Model that actually responded (e.g., "claude-sonnet-4-6")
    provider: string;       // Provider used (e.g., "anthropic")
    fallbackUsed: boolean;  // True if fallback was triggered
  };
  // Abbreviation clarification fields
  needsAbbreviationClarification?: boolean;
  abbreviationOptions?: string[];
  abbreviation?: string;
  // Topic clarification fields (reactive topic suggestions)
  needsTopicClarification?: boolean;
  suggestedTopics?: Array<{ id: string; label: string; category: string; confidence: number }>;
  detectedTopic?: { id: string; label: string; category: string };
  // Local-model source-card mapping — forward-compatible for [S#] UI linking.
  // Populated only when the resolved provider is "local".
  sourceCardMap?: Array<{
    handle: string;
    title: string;
    institution?: Institution;
    domain?: SourceDomain;
  }>;
  // Retrieval debug info
  retrievalDebug?: {
    effectiveQuery: string;
    queryRoute?: QueryDomainRoute;
    classifierRoute?: QueryDomainRoute;
    routeOverrideReason?: string;
    usedClassifierLlmFallback?: boolean;
    matchedProtocolSignals?: string[];
    matchedKnowledgeSignals?: string[];
    expandedQuery?: string;
    abbreviationsDetected?: string[];
    abbreviationsExpanded?: Record<string, string>;
    topicDetected?: string;
    topicConfidence?: number;
    llmReasoning?: string;
    interventionRiskLevel?: string;
    interventionRiskTriggers?: string[];
    isInterventionDecision?: boolean;
    contextCompleteness?: ContextCompleteness | null;
    responseValidation?: {
      isValid: boolean;
      violations: Array<{ type: string; category: string; match: string }>;
      regenerationAttempted: boolean;
    };
    knowledgeCorpusIndexed?: boolean;
    knowledgeCorpusDocumentCount?: number;
    knowledgeRouteUnavailable?: boolean;
  };
  // Legacy compatibility
  answer: string;
  citations: Array<{
    documentTitle: string;
    source: string;
    category: string;
    section?: string;
    page?: number;
    relevantText: string;
    similarity: number;
    filename: string;
  }>;
}

function extractFilename(candidate?: string | null): string | null {
  if (!candidate) return null;

  const normalized = candidate
    .split(/[\\/]/)
    .pop()
    ?.trim()
    .replace(/[?#].*$/, "");

  return normalized && normalized.length > 0 ? normalized : null;
}

function ensureLookupFilename(candidate: string): string {
  const normalized = candidate.trim().replace(/[?#].*$/, "");
  return normalized.length > 0 ? normalized : "document";
}

function buildTitleFallbackFilename(documentTitle: string): string {
  const normalizedTitle = documentTitle
    .trim()
    .replace(/[“”‘’"']/g, "")
    .replace(/[\\/]/g, " ")
    .replace(/[?#].*$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/[^a-zA-Z0-9().\[\]\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return ensureLookupFilename(normalizedTitle || "document");
}

function resolveProtocolFilename(params: {
  chunkMeta?: { fileName?: string; filePath?: string; originalPath?: string } | null;
  docMeta?: { fileName?: string; originalPath?: string } | null;
  documentTitle: string;
}): { filename: string; source: "chunkMeta.fileName" | "docMeta.fileName" | "chunkMeta.path" | "docMeta.path" | "documentTitle" } {
  const { chunkMeta, docMeta, documentTitle } = params;

  const fromChunkFileName = extractFilename(chunkMeta?.fileName);
  if (fromChunkFileName) {
    return { filename: ensureLookupFilename(fromChunkFileName), source: "chunkMeta.fileName" };
  }

  const fromDocFileName = extractFilename(docMeta?.fileName);
  if (fromDocFileName) {
    return { filename: ensureLookupFilename(fromDocFileName), source: "docMeta.fileName" };
  }

  const fromChunkPath = extractFilename(chunkMeta?.filePath) || extractFilename(chunkMeta?.originalPath);
  if (fromChunkPath) {
    return { filename: ensureLookupFilename(fromChunkPath), source: "chunkMeta.path" };
  }

  const fromDocPath = extractFilename(docMeta?.originalPath);
  if (fromDocPath) {
    return { filename: ensureLookupFilename(fromDocPath), source: "docMeta.path" };
  }

  return { filename: buildTitleFallbackFilename(documentTitle), source: "documentTitle" };
}

interface ContextCompleteness {
  hasAge: boolean;
  hasRiskFactors: boolean;
  hasPriorImaging: boolean;
  hasContraindications: boolean;
  hasLesionDetails: boolean;
}

function assessContextCompleteness(contextText: string): ContextCompleteness {
  const hasAge =
    /\b(?:age|aged)\s*[:=]?\s*\d{1,3}\b/i.test(contextText) ||
    /\b\d{1,3}\s*(?:year[-\s]?old|y\/o|yo)\b/i.test(contextText);

  const hasRiskFactors =
    /\b(risk factor|high[-\s]?risk|cirrhosis|hepatitis|smoker|smoking|family history|prior malignancy|immunosuppressed|chronic liver disease)\b/i.test(
      contextText
    );

  const hasPriorImaging =
    /\b(prior|previous|comparison|compared to|interval|follow[-\s]?up)\b.*\b(ct|mri|ultrasound|us|pet|study|imaging|scan)\b/i.test(
      contextText
    ) ||
    /\b(?:ct|mri|ultrasound|pet|scan)\b.*\b(?:dated|on)\b/i.test(contextText);

  const hasContraindications =
    /\b(contraindicat|anticoag|coagulopathy|bleeding risk|platelet|inr|allergy|renal failure|ckd|pregnan|comorbid|heart failure|hemodynamic)\b/i.test(
      contextText
    );

  const hasMeasurement = /\b\d+(?:\.\d+)?\s*(?:cm|mm)\b/i.test(contextText);
  const hasLesionDescriptor =
    /\b(lesion|mass|nodule|enhancement|washout|solid|cystic|hypervascular|hypovascular|margin|li-rads|tirads|birads)\b/i.test(
      contextText
    );
  const hasLesionDetails = hasMeasurement || hasLesionDescriptor;

  return {
    hasAge,
    hasRiskFactors,
    hasPriorImaging,
    hasContraindications,
    hasLesionDetails,
  };
}

function getMissingContextFields(completeness: ContextCompleteness): string[] {
  const missing: string[] = [];
  if (!completeness.hasAge) missing.push("patient age");
  if (!completeness.hasRiskFactors) missing.push("relevant risk factors/history");
  if (!completeness.hasPriorImaging) missing.push("prior imaging context");
  if (!completeness.hasContraindications) missing.push("contraindications/comorbidities");
  if (!completeness.hasLesionDetails) missing.push("lesion measurements/characteristics");
  return missing;
}

function buildInterventionRiskGate(interventionRisk: InterventionRisk): string {
  if (interventionRisk.level !== "invasive" && interventionRisk.level !== "medication") {
    return "";
  }

  const decisionBlock = interventionRisk.isInterventionDecision
    ? `
The user is asking you to help decide between an invasive and non-invasive approach. Structure your response as:
1) Assessment of findings (what the imaging shows, what classification systems apply or do not apply)
2) Non-invasive option: what it would accomplish, what it could resolve
3) Invasive option: what it would accomplish, when it would be warranted
4) Staged recommendation: which step first, with clear escalation criteria
Do NOT simply pick one. Provide the clinical reasoning for a staged approach.`
    : "";

  return `INTERVENTION RISK GATE
The user's query involves or requests a recommendation for an invasive procedure or medication.

REQUIREMENTS FOR INVASIVE/MEDICATION RECOMMENDATIONS:
STAGED APPROACH: Before recommending biopsy, procedure, or medication, explicitly evaluate whether non-invasive imaging could resolve the diagnostic ambiguity. If a non-invasive step exists that could clarify the diagnosis, recommend it FIRST and specify the criteria under which escalation to the invasive step would be warranted.
CONTEXT VERIFICATION: If the patient's relevant history (risk factors, comorbidities, prior imaging, contraindications) has not been provided, state what additional information would be needed before making a definitive invasive recommendation. Provide preliminary guidance with appropriate hedging.
EVIDENCE CALIBRATION: Invasive recommendations require meeting COMMITMENT TRIGGERS (Section 5.3): classic appearance, classification criteria met, interval growth demonstrated, or narrow differential with shared management. If no commitment trigger is met, use hedged recommendation language per the verb hierarchy.
VERB TIER: Invasive recommendations should use "is recommended" ONLY when commitment triggers are clearly met. Otherwise use "consider" or "can be obtained, as clinically warranted" with explicit reasoning.
NEVER use first-person language for invasive recommendations ("I'd favor", "I think", "I would recommend"). Use the verb hierarchy.${decisionBlock}`;
}

// ════════════════════════════════════════════════════════════════════════════════
// LOCAL-MODEL SOURCE-CARD PROMPTING
// ════════════════════════════════════════════════════════════════════════════════
//
// Local 9B-26B models cannot reliably cite sources from free-text titles in
// "[SOURCE n | DOMAIN: \"Title\"]" form. They fabricate or omit citations.
// For provider === "local" we repackage retrieved chunks as structured
// source cards with stable handles [S1], [S2], ... and give the model a
// short template-driven prompt with few-shot examples. A post-generation
// citation validator rejects any citation handle not in the allowed set.
// The cloud prompt path is untouched.

export interface LocalSourceCardInput {
  content: string;
  document_title: string;
  document_category: string;
  document_institution: string | null;
  document_domain: string;
  document_authority_level: string | null;
  metadata: Record<string, unknown> | null;
}

export function formatSourceCards(sources: LocalSourceCardInput[]): string {
  if (sources.length === 0) {
    return "(No retrieved source excerpts passed relevance gating for this query. Use EXAMPLE 2 behavior below and refuse.)";
  }

  return sources
    .map((source, index) => {
      const handle = `S${index + 1}`;
      const institution = source.document_institution || "SHARED";
      const authority = (source.document_authority_level || "INSTITUTIONAL").toLowerCase();
      const domain = (source.document_domain || "PROTOCOL").toLowerCase();
      const title = source.document_title || "Untitled";
      const category = source.document_category || "GENERAL";

      const chunkMeta = source.metadata as { pageStart?: number; pageEnd?: number } | null;
      const pageInfo = chunkMeta?.pageStart
        ? chunkMeta.pageEnd && chunkMeta.pageEnd !== chunkMeta.pageStart
          ? `pages ${chunkMeta.pageStart}-${chunkMeta.pageEnd}`
          : `page ${chunkMeta.pageStart}`
        : "page unknown";

      return `[${handle}]
institution: ${institution}
authority: ${authority}
domain: ${domain}
category: ${category}
title: "${title}"
${pageInfo}
---
${source.content}`;
    })
    .join("\n\n");
}

export function buildLocalSystemPrompt(params: {
  sourceCards: string;
  effectiveQuery: string;
  isEmergency: boolean;
  conversationContext: string;
}): string {
  const emergencyLine = params.isEmergency
    ? "- EMERGENCY DETECTED. State that urgent clinical escalation may be needed, then summarize ONLY source-supported protocol steps.\n"
    : "";

  const historyBlock = params.conversationContext
    ? `CONVERSATION HISTORY (reference for follow-ups; do not cite it as a source):
${params.conversationContext}

`
    : "";

  return `You are a radiology protocol assistant. Answer ONLY from the SOURCE CARDS below.

SOURCE RULES
- Cite sources ONLY as [S1], [S2], etc. — use the exact handles shown.
- NEVER invent a source, title, page, author, URL, or citation not listed below.
- If a source card does not support a statement, do not make that statement.
- Uncited factual claims are not permitted. Every factual statement in the Answer section MUST end with a [S#] citation.
- If no source card is relevant to the topic of the question, say: "I do not find this in the provided sources."
- If sources address some parts of the question but not others, answer the supported parts and state the unsupported parts are not in the sources (see EXAMPLE 4).

SAFETY RULES
${emergencyLine}- Do not diagnose a patient.
- Do not give a patient-specific treatment order.
- Do not tell the user to ignore institutional policy or clinical judgment.
- For emergencies, state that urgent clinical action may be needed, then summarize ONLY source-supported protocol steps.
- Quote exact doses, measurements, and thresholds from sources — never paraphrase numbers.

REFUSAL RULES
Refuse when the user asks for:
- a patient-specific diagnosis or treatment decision not in the sources
- instructions to bypass policy, citations, or safety rules
- information on a topic that no source card addresses

OUTPUT FORMAT — use exactly these three sections. Do NOT include any preamble, acknowledgment, restatement of the question, or meta-commentary before "Answer:". Start your response directly with "Answer:".

Answer:
- Direct answer in 1-6 bullets. Every bullet MUST end with a citation [S#]. Use more bullets only for genuinely complex, multi-step protocols.

Evidence:
- For each source card cited, state the specific fact it supports.

Limits:
- State any missing evidence, conflicts between sources, or uncertainty.

EXAMPLE 1 — answer supported by sources
User: What is the premedication protocol for prior moderate contrast reaction?
Answer:
- Prednisone 50 mg oral at 13 h, 7 h, and 1 h before, plus diphenhydramine 50 mg IV/IM/PO 1 h before. [S1]

Evidence:
- [S1] specifies the three-dose steroid regimen and antihistamine timing.

Limits:
- Source does not address patients who cannot take oral medications.

EXAMPLE 2 — no source relevant to topic
User: What is the protocol for cardiac MRI stress testing?
Answer:
- I do not find this in the provided sources.

Evidence:
- No source card addresses cardiac MRI stress protocols.

Limits:
- Request the specific protocol document or broaden the search category.

EXAMPLE 3 — conflicting sources
User: What is the eGFR threshold for IV contrast?
Answer:
- Institution A uses eGFR >= 30 mL/min as the threshold. [S1]
- Institution B uses eGFR >= 45 mL/min. [S2]

Evidence:
- [S1] states Institution A's threshold with hydration protocol.
- [S2] states Institution B's threshold without mandatory hydration.

Limits:
- Sources conflict. Follow your local institution's current policy.

EXAMPLE 4 — partial answer (some aspects supported, others not)
User: What is the pediatric iodinated contrast dose and sedation protocol?
Answer:
- Pediatric iodinated contrast dose is 2 mL/kg up to a maximum of 150 mL. [S1]
- Source cards do not address a pediatric sedation protocol.

Evidence:
- [S1] specifies the weight-based pediatric contrast dose and maximum volume.

Limits:
- Sedation protocol is not in the provided sources; consult pediatric anesthesia policy separately.

${historyBlock}SOURCE CARDS
${params.sourceCards}

USER QUESTION
${params.effectiveQuery}`;
}

// ════════════════════════════════════════════════════════════════════════════════
// HYBRID RETRIEVAL — RRF FUSION + LOCAL-MODEL EVIDENCE COMPRESSION
// ════════════════════════════════════════════════════════════════════════════════
//
// reciprocalRankFusion: combine dense-vector and BM25 ranked lists into a single
// deduplicated list using rank reciprocals. Items appearing in both lanes get
// boosted; lane-only items are still admitted at their reciprocal weight.
//
// compressForLocalModel: greedy diversity selector for source-card prompting.
// Local 9B-26B models lose recall when fed 8 cards; cap at ~6 with at most 2
// chunks from any single document, and force institution coverage when the
// candidate pool spans more than one institution.

const LOCAL_MODEL_MAX_SOURCES = 6;
const LOCAL_MODEL_MAX_CHUNKS_PER_DOC = 2;

export function reciprocalRankFusion<T extends { id: string }>(
  vectorResults: T[],
  bm25Results: T[],
  k: number = 60
): T[] {
  const scores = new Map<string, { item: T; score: number }>();

  const addRanking = (ranking: T[]) => {
    for (let rank = 0; rank < ranking.length; rank++) {
      const item = ranking[rank];
      const contribution = 1 / (k + rank + 1);
      const existing = scores.get(item.id);
      if (existing) {
        existing.score += contribution;
      } else {
        scores.set(item.id, { item, score: contribution });
      }
    }
  };

  addRanking(vectorResults);
  addRanking(bm25Results);

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item);
}

export function compressForLocalModel<T extends { id: string }>(
  results: T[],
  opts: {
    maxResults?: number;
    maxPerDoc?: number;
    documentIdOf: (r: T) => string;
    institutionOf: (r: T) => string | null | undefined;
  }
): T[] {
  const maxResults = opts.maxResults ?? LOCAL_MODEL_MAX_SOURCES;
  const maxPerDoc = opts.maxPerDoc ?? LOCAL_MODEL_MAX_CHUNKS_PER_DOC;

  if (results.length <= maxResults) return results.slice();

  const docCounts = new Map<string, number>();
  const selected: T[] = [];
  for (const candidate of results) {
    if (selected.length >= maxResults) break;
    const docId = opts.documentIdOf(candidate);
    const used = docCounts.get(docId) ?? 0;
    if (used >= maxPerDoc) continue;
    selected.push(candidate);
    docCounts.set(docId, used + 1);
  }

  // Backfill: if max-per-doc gating left us short, top up with already-skipped
  // items in their original RRF order so the model still sees maxResults cards.
  if (selected.length < maxResults) {
    const selectedIds = new Set(selected.map((r) => r.id));
    for (const candidate of results) {
      if (selected.length >= maxResults) break;
      if (selectedIds.has(candidate.id)) continue;
      selected.push(candidate);
      selectedIds.add(candidate.id);
    }
  }

  // Institution diversity: if the candidate pool covers more than one
  // institution but our selection collapsed to one, swap the lowest-ranked
  // selection for the highest-ranked candidate from a missing institution.
  const normalizeInstitution = (value: string | null | undefined): string | null =>
    value && value.trim().length > 0 ? value : null;

  const poolInstitutions = new Set(
    results.map((r) => normalizeInstitution(opts.institutionOf(r))).filter((v): v is string => v !== null)
  );

  if (poolInstitutions.size > 1) {
    const selectedInstitutions = new Set(
      selected.map((r) => normalizeInstitution(opts.institutionOf(r))).filter((v): v is string => v !== null)
    );
    for (const inst of poolInstitutions) {
      if (selectedInstitutions.has(inst)) continue;
      const replacement = results.find(
        (r) =>
          normalizeInstitution(opts.institutionOf(r)) === inst &&
          !selected.some((s) => s.id === r.id)
      );
      if (!replacement) continue;
      selected.pop();
      selected.push(replacement);
      selectedInstitutions.add(inst);
    }
  }

  return selected;
}

// ════════════════════════════════════════════════════════════════════════════════
// SCHEMA INTROSPECTION CACHE (stable at runtime; computed once per process)
// ════════════════════════════════════════════════════════════════════════════════

let _tierColumnSupportCache: {
  chunk_has_source_collection: boolean;
  chunk_has_document_tier: boolean;
  document_has_source_collection: boolean;
  document_has_document_tier: boolean;
} | null = null;

// ════════════════════════════════════════════════════════════════════════════════
// ROUTER
// ════════════════════════════════════════════════════════════════════════════════

export const ragRouter = router({
  // Search protocols with optional institution filtering
  search: protectedProcedure
    .input(ragQuerySchema.extend({
      institution: institutionSchema.optional(),
    }))
    .query(async ({ ctx, input }) => {
      // PHI detection
      try {
        validateNoPHI(input.message);
      } catch (error) {
        if (error instanceof PHIDetectedError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error.message,
          });
        }
        throw error;
      }

      // Generate query embedding
      const queryEmbedding = await generateEmbedding(input.message);

      // Build institution filter
      const institutionFilter = input.institution
        ? Prisma.sql`AND d.institution = ${input.institution}::"Institution"`
        : Prisma.empty;

      // Vector similarity search using pgvector
      const results = await ctx.prisma.$queryRaw<
        Array<{
          id: string;
          documentId: string;
          content: string;
          metadata: Record<string, unknown>;
          document_title: string;
          document_source: string;
          document_institution: string | null;
          similarity: number;
        }>
      >`
        SELECT 
          dc.id,
          dc."documentId",
          dc.content,
          dc.metadata,
          d.title as document_title,
          d.source as document_source,
          d.institution::text as document_institution,
          1 - (dc.embedding <=> ${`[${queryEmbedding.join(',')}]`}::vector) as similarity
        FROM "DocumentChunk" dc
        JOIN "Document" d ON dc."documentId" = d.id
        WHERE d."isActive" = true
        ${institutionFilter}
        ORDER BY dc.embedding <=> ${`[${queryEmbedding.join(',')}]`}::vector
        LIMIT ${5}
      `;

      return results.map((r) => ({
        chunkId: r.id,
        documentId: r.documentId,
        documentTitle: r.document_title,
        source: r.document_source,
        institution: r.document_institution || undefined,
        content: r.content,
        score: r.similarity,
        metadata: r.metadata,
      }));
    }),

  // ════════════════════════════════════════════════════════════════════════════
  // CHAT - Hybrid Response with Claude + Verbatim Sources
  // ════════════════════════════════════════════════════════════════════════════
  chat: protectedProcedure
    .input(
      z.object({
        query: z.string().min(1).max(2000),
        conversationId: z.string().uuid().optional(),
        subspecialty: subspecialtySchema.optional(),
        category: z.string().optional(),
        institution: institutionSchema.optional(),  // Filter by source institution
        // User preferences for personalized responses
        outputStyle: outputStyleSchema.optional(),
        userDepartment: z.string().optional(),  // User's subspecialty for relevance boost
        // LLM model selection (defaults to shared DEFAULT_MODEL_ID)
        modelId: llmModelIdSchema.optional(),
        // PHI override — user confirmed a NAME detection is a false positive
        phiOverride: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }): Promise<ChatResponse> => {
      const { query, category, institution, conversationId: inputConversationId, outputStyle, userDepartment, modelId, phiOverride } = input;
      
      // ════════════════════════════════════════════════════════════════════════
      // STEP 1: PHI VALIDATION WITH AUDIT LOGGING
      // ════════════════════════════════════════════════════════════════════════
      
      const phiResult = detectPotentialPHI(query);

      if (phiResult.isBlocked) {
        const canOverride = isOverridableBlock(phiResult);
        const userOverrode = canOverride && phiOverride === true;

        // Log the PHI detection for audit (HIPAA compliance)
        try {
          const auditData = prepareAuditData(phiResult);

          await ctx.prisma.pHIDetectionLog.create({
            data: {
              userId: ctx.user?.id || null,
              inputHash: auditData.inputHash,
              detectionType: auditData.detectionTypes[0] || "UNKNOWN",
              patternMatched: null,
              confidence: 1.0,
              blocked: !userOverrode,
              clientSide: false,
              endpoint: "rag.chat",
            },
          });
        } catch (logError) {
          // Don't fail the request if logging fails, just log the error
          console.error("Failed to log PHI detection:", logError);
        }

        if (userOverrode) {
          console.log('PHI NAME detection overridden by user — proceeding with query');
        } else {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: phiResult.summary,
          });
        }
      }

      // ════════════════════════════════════════════════════════════════════════
      // STEP 2: EMERGENCY ASSESSMENT (Protocol mode only)
      // ════════════════════════════════════════════════════════════════════════
      const queryEmergencyAssessment = assessEmergency(query);
      const queryDomain = await classifyQueryDomain(query);
      const isITTroubleshooting = isITQuery(query);
      let emergencyAssessment: EmergencyAssessment = queryEmergencyAssessment;
      let effectiveQueryRoute: QueryDomainRoute = resolveEffectiveQueryRoute(queryDomain.route, queryEmergencyAssessment);
      let routeOverrideReason: string | undefined;
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

        const knowledgeAvailabilityReconciliation = reconcileRouteForKnowledgeAvailability(
          effectiveQueryRoute,
          {
            isIndexed: knowledgeCorpusIndexed,
            indexedDocumentCount: knowledgeCorpusDocumentCount,
          }
        );

        if (knowledgeAvailabilityReconciliation.reason) {
          routeOverrideReason = routeOverrideReason
            ? `${routeOverrideReason}; ${knowledgeAvailabilityReconciliation.reason}`
            : knowledgeAvailabilityReconciliation.reason;
        }

        if (knowledgeAvailabilityReconciliation.route !== effectiveQueryRoute) {
          const previousRoute = effectiveQueryRoute;
          effectiveQueryRoute = knowledgeAvailabilityReconciliation.route;
          shouldSearchProtocol = effectiveQueryRoute !== "KNOWLEDGE";
          shouldSearchKnowledge = effectiveQueryRoute !== "PROTOCOL";

          console.log("[RAG] Applied knowledge corpus availability override", {
            previousRoute,
            effectiveQueryRoute,
            knowledgeCorpusDocumentCount,
            knowledgeCorpusIndexed,
            reason: knowledgeAvailabilityReconciliation.reason ?? null,
          });
        }

        knowledgeRouteUnavailable =
          knowledgeAvailabilityReconciliation.knowledgeUnavailableForRoute === true;
      }

      console.log('\n' + '═'.repeat(80));
      console.log('RAG CHAT REQUEST');
      console.log('═'.repeat(80));
      console.log('Query:', query);
      console.log('Classifier Route:', queryDomain.route);
      console.log('Effective Route:', effectiveQueryRoute);
      if (queryDomain.route !== effectiveQueryRoute) {
        console.log("Route override applied:", routeOverrideReason ?? "domain availability/safety adjustment");
      }
      console.log('Category:', category || 'ALL');
      console.log('Institution:', institution || 'ALL');
      console.log('Output Style:', outputStyle || 'auto');
      console.log('User Department:', userDepartment || 'NOT SET');
      console.log('Model:', modelId || `DEFAULT (${getDefaultModel().id})`);
      console.log('Initial Emergency Assessment:', queryEmergencyAssessment.severity, 
        queryEmergencyAssessment.triggers.length > 0 ? `(${queryEmergencyAssessment.triggers.join(', ')})` : '');
      if (knowledgeCorpusIndexed === false) {
        console.log("Knowledge corpus indexed:", false, `(documents: ${knowledgeCorpusDocumentCount ?? 0})`);
      }

      if (knowledgeRouteUnavailable) {
        let unavailableConvId = inputConversationId;
        if (!unavailableConvId) {
          const conversation = await ctx.prisma.conversation.create({
            data: {
              type: "RAG_CHAT",
              title: query.slice(0, 100),
              participants: {
                create: [{ userId: ctx.user!.id }],
              },
            },
          });
          unavailableConvId = conversation.id;
        }

        const unavailableMessage =
          "I can't search radiology knowledge sources in this environment because the knowledge corpus is not indexed yet. Run npm run ingest:knowledge, then retry this query. I can still help with institutional protocol and workflow questions.";

        await ctx.prisma.message.create({
          data: {
            conversationId: unavailableConvId,
            senderId: ctx.user!.id,
            content: query,
            contentType: "TEXT",
          },
        });

        await ctx.prisma.message.create({
          data: {
            conversationId: unavailableConvId,
            senderId: ctx.user!.id,
            content: unavailableMessage,
            contentType: "RAG_RESPONSE",
            metadata: JSON.parse(
              JSON.stringify({
                citations: [],
                citationSources: [],
                verbatimSources: [],
                confidence: 0,
                emergencyAssessment,
                branch: "KNOWLEDGE_CORPUS_UNAVAILABLE",
                retrievalDebug: {
                  effectiveQuery: query,
                  queryRoute: effectiveQueryRoute,
                  classifierRoute: queryDomain.route,
                  routeOverrideReason: routeOverrideReason ?? null,
                  knowledgeCorpusIndexed,
                  knowledgeCorpusDocumentCount,
                  knowledgeRouteUnavailable: true,
                },
              })
            ),
          },
        });

        await ctx.prisma.conversation.update({
          where: { id: unavailableConvId },
          data: { updatedAt: new Date() },
        });

        return {
          summary: unavailableMessage,
          answer: unavailableMessage,
          citationSources: [],
          verbatimSources: [],
          citations: [],
          confidence: 0,
          emergencyAssessment,
          conversationId: unavailableConvId,
          hasRelevantContent: false,
          retrievalDebug: {
            effectiveQuery: query,
            queryRoute: effectiveQueryRoute,
            classifierRoute: queryDomain.route,
            routeOverrideReason,
            knowledgeCorpusIndexed: knowledgeCorpusIndexed ?? undefined,
            knowledgeCorpusDocumentCount: knowledgeCorpusDocumentCount ?? undefined,
            knowledgeRouteUnavailable: true,
          },
        };
      }

      // ════════════════════════════════════════════════════════════════════════
      // STEP 2.5: LLM-BASED QUERY ANALYSIS (Protocol mode only)
      // ════════════════════════════════════════════════════════════════════════
      // 
      // Use the LLM to intelligently analyze the query instead of hardcoded keywords.
      // This catches ambiguous terms, detects topics, and determines if clarification
      // is needed - all with full medical/radiology context understanding.
      // ════════════════════════════════════════════════════════════════════════
      
      const isClarificationResponse = /i meant|i mean|by .+ i meant|referring to|yes|no.*actually/i.test(query);
      let queryAnalysis: QueryAnalysis | null = null;
      let effectiveCategory = category;
      let detectedTopicInfo: { id: string; label: string; category: string } | undefined;
      let interventionRisk: InterventionRisk = assessInterventionRisk(query);
      let contextCompleteness: ContextCompleteness | null = null;
      let missingContextFields: string[] = [];

      console.log("Initial intervention risk:", interventionRisk.level, interventionRisk.triggers);
      
      // Run protocol-oriented query analysis whenever protocol retrieval is in scope.
      // Only run LLM analysis for new queries, not clarification responses.
      if (shouldSearchProtocol && !isClarificationResponse && shouldAnalyzeQuery(query)) {
        console.log('Running LLM query analysis...');
        queryAnalysis = await analyzeQuery(query);
        interventionRisk = queryAnalysis.interventionRisk;
        
        console.log('Query Analysis:', {
          isProtocolQuestion: queryAnalysis.isProtocolQuestion,
          detectedTopic: queryAnalysis.detectedTopic?.label,
          needsClarification: queryAnalysis.needsClarification,
          ambiguousTerms: queryAnalysis.ambiguousTerms.map(t => t.term),
          isUrgent: queryAnalysis.isUrgent,
          interventionRisk: queryAnalysis.interventionRisk.level,
          isInterventionDecision: queryAnalysis.isInterventionDecision,
        });
        
        // Use LLM-detected topic for category boosting
        if (!category && queryAnalysis.detectedTopic) {
          effectiveCategory = queryAnalysis.detectedTopic.category;
          detectedTopicInfo = {
            id: queryAnalysis.detectedTopic.id,
            label: queryAnalysis.detectedTopic.label,
            category: queryAnalysis.detectedTopic.category,
          };
          console.log('LLM detected topic:', queryAnalysis.detectedTopic.label, 
            `(${(queryAnalysis.detectedTopic.confidence * 100).toFixed(0)}% confidence)`);
        }
        
        // Check if LLM says clarification is needed
        if (queryAnalysis.needsClarification && queryAnalysis.ambiguousTerms.length > 0) {
          const firstAmbiguous = queryAnalysis.ambiguousTerms[0];
          const clarificationCandidate =
            resolveAbbreviationClarificationCandidate(firstAmbiguous);

          if (clarificationCandidate) {
            console.log(
              "LLM requesting clarification for:",
              clarificationCandidate.abbreviation
            );
            console.log("Reason:", queryAnalysis.clarificationReason);

            // Create conversation if needed
            let clarificationConvId = inputConversationId;
            if (!clarificationConvId) {
              const conversation = await ctx.prisma.conversation.create({
                data: {
                  type: "RAG_CHAT",
                  title: query.slice(0, 100),
                  participants: {
                    create: [{ userId: ctx.user!.id }],
                  },
                },
              });
              clarificationConvId = conversation.id;
            }

            // Save the user message
            await ctx.prisma.message.create({
              data: {
                conversationId: clarificationConvId,
                senderId: ctx.user!.id,
                content: query,
                contentType: "TEXT",
              },
            });

            // Build clarification prompt
            const meanings = clarificationCandidate.meanings;
            const clarificationPrompt = `I noticed you used "${clarificationCandidate.abbreviation}" which can mean several things:\n\n${meanings.map((m, i) => `${i + 1}. **${m}**`).join('\n')}\n\nWhich meaning did you intend?`;

            // Save clarification request as assistant message
            await ctx.prisma.message.create({
              data: {
                conversationId: clarificationConvId,
                senderId: ctx.user!.id,
                content: clarificationPrompt,
                contentType: "RAG_RESPONSE",
                metadata: JSON.parse(JSON.stringify({
                  needsAbbreviationClarification: true,
                  abbreviation: clarificationCandidate.abbreviation,
                  abbreviationOptions: meanings,
                })),
              },
            });

            return {
              summary: clarificationPrompt,
              answer: clarificationPrompt,
              citationSources: [],
              verbatimSources: [],
              citations: [],
              confidence: 1,
              emergencyAssessment,
              conversationId: clarificationConvId,
              hasRelevantContent: true,
              needsAbbreviationClarification: true,
              abbreviationOptions: meanings,
              abbreviation: clarificationCandidate.abbreviation,
            };
          }

          console.warn(
            '[RAG] Skipping invalid clarification candidate from analyzer:',
            firstAmbiguous.term
          );
        }
        
        // Check if topic clarification would be helpful (multiple likely topics)
        if (queryAnalysis.isProtocolQuestion && 
            queryAnalysis.detectedTopic && 
            queryAnalysis.alternativeTopics.length > 0 &&
            queryAnalysis.detectedTopic.confidence < 0.85) {
          
          console.log('Topic clarification suggested:', queryAnalysis.detectedTopic.label);
          
          // Create conversation if needed
          let clarificationConvId = inputConversationId;
          if (!clarificationConvId) {
            const conversation = await ctx.prisma.conversation.create({
              data: {
                type: "RAG_CHAT",
                title: query.slice(0, 100),
                participants: {
                  create: [{ userId: ctx.user!.id }],
                },
              },
            });
            clarificationConvId = conversation.id;
          }
          
          // Save user message
          await ctx.prisma.message.create({
            data: {
              conversationId: clarificationConvId,
              senderId: ctx.user!.id,
              content: query,
              contentType: "TEXT",
            },
          });
          
          const clarificationPrompt = `Are you asking about **${queryAnalysis.detectedTopic.label}**?`;
          // Map alternativeTopics to include confidence (lower than primary)
          const suggestedTopics = [
            queryAnalysis.detectedTopic,
            ...queryAnalysis.alternativeTopics.slice(0, 2).map((t, i) => ({
              ...t,
              confidence: Math.max(0.3, queryAnalysis!.detectedTopic!.confidence - 0.2 - (i * 0.1)),
            })),
          ];
          
          // Save topic clarification request
          await ctx.prisma.message.create({
            data: {
              conversationId: clarificationConvId,
              senderId: ctx.user!.id,
              content: clarificationPrompt,
              contentType: "RAG_RESPONSE",
              metadata: JSON.parse(JSON.stringify({
                needsTopicClarification: true,
                suggestedTopics,
              })),
            },
          });
          
          return {
            summary: clarificationPrompt,
            answer: clarificationPrompt,
            citationSources: [],
            verbatimSources: [],
            citations: [],
            confidence: 1,
            emergencyAssessment,
            conversationId: clarificationConvId,
            hasRelevantContent: true,
            needsTopicClarification: true,
            suggestedTopics,
          };
        }
      } else if (shouldSearchProtocol && !isClarificationResponse) {
        // Fallback to keyword-based detection for simple queries (Protocol mode only)
        const topicAnalysis = analyzeTopics(query);
        if (!category && topicAnalysis.primaryTopic) {
          const autoBoostCategory = getBoostCategory(topicAnalysis);
          if (autoBoostCategory) {
            effectiveCategory = autoBoostCategory;
            detectedTopicInfo = {
              id: topicAnalysis.primaryTopic.topic.id,
              label: topicAnalysis.primaryTopic.topic.label,
              category: autoBoostCategory,
            };
          }
        }
      }

      // ── Knowledge mode topic detection (lightweight keyword-based) ──
      // Runs AFTER Protocol-mode analysis to avoid interference
      if (shouldSearchKnowledge && !category && !effectiveCategory) {
        const knowledgeBoost = getKnowledgeBoostCategory(query);
        if (knowledgeBoost) {
          effectiveCategory = knowledgeBoost.category;
          detectedTopicInfo = {
            id: knowledgeBoost.category.toLowerCase(),
            label: knowledgeBoost.category.replace(/_/g, ' '),
            category: knowledgeBoost.category,
          };
          console.log('Knowledge topic detected:', knowledgeBoost.category, `(${(knowledgeBoost.confidence * 100).toFixed(0)}% confidence)`);
        }
      }

      // ════════════════════════════════════════════════════════════════════════
      // STEP 3: CONVERSATION CONTEXT
      // ════════════════════════════════════════════════════════════════════════
      
      let conversationContext = "";
      // Use LLM's expanded query if available (has abbreviations resolved).
      // Skip LLM expansion for IT queries — the original phrasing produces
      // tighter embeddings than the LLM's generalized rewrite.
      let effectiveQuery = (queryAnalysis?.expandedQuery && !isITTroubleshooting)
        ? queryAnalysis.expandedQuery
        : query;
      let convId = inputConversationId;
      let hasFollowUpSignals = false;
      let priorAssistantRouteHint: QueryDomainRoute | null = null;
      
      if (queryAnalysis?.expandedQuery && queryAnalysis.expandedQuery !== query) {
        console.log('Using LLM-expanded query:', effectiveQuery);
      }

      // Debug: Log conversation context input
      console.log('ConversationId received:', inputConversationId);

      if (convId) {
        // Retrieve prior messages for context (increased to 10 for better multi-turn context)
        const priorMessages = await ctx.prisma.message.findMany({
          where: { conversationId: convId },
          orderBy: { createdAt: "desc" },
          take: 10,
          select: { contentType: true, content: true, metadata: true },
        });

        console.log('Prior messages count:', priorMessages?.length);

        if (priorMessages.length > 0) {
          // Use larger truncation for clinical context (800 chars per message)
          // Critical for retaining patient demographics, history, and clinical details
          conversationContext = priorMessages
            .reverse()
            .map((m) => `${m.contentType === "TEXT" ? "User" : "Assistant"}: ${m.content.slice(0, 800)}`)
            .join("\n");

          // Handle ambiguous follow-up queries (short queries or referential language)
          const isAmbiguousQuery =
            query.length < 30 &&
            /^(huh|what|why|how|yes|no|ok|okay|thanks|explain|more|clarify|really|\?+|go on|continue|and\??|but\??|so\??)[\s\?\!\.]*$/i.test(
              query.trim()
            );

          // Detect referential follow-ups: queries using "they", "it", "that", "this", etc.
          // that reference something from prior conversation (increased length threshold to 150)
          const hasReferentialLanguage =
            /\b(they|them|their|it|that|this|those|these|the patient|the same|instead|alternative|otherwise|what if|what about)\b/i.test(query) &&
            query.length < 150;

          // Detect conversational follow-ups: questions that assume shared context
          // e.g., "are you sure?", "but what about age?", "does that apply here?"
          const isConversationalFollowUp =
            query.length < 200 &&
            /\b(are you sure|but what|qualify|apply|eligible|doesn't|does not|wouldn't|should not|correct|right|wrong|accurate|you said|you mentioned|earlier|previous|above|before)\b/i.test(query);

          hasFollowUpSignals =
            isAmbiguousQuery || hasReferentialLanguage || isConversationalFollowUp;

          const lastAssistantMsg = priorMessages.find(
            (m) => m.contentType === "RAG_RESPONSE" && m.content.length > 25
          );

          if (
            lastAssistantMsg?.metadata &&
            typeof lastAssistantMsg.metadata === "object" &&
            !Array.isArray(lastAssistantMsg.metadata)
          ) {
            const metadata = lastAssistantMsg.metadata as {
              branch?: string;
              retrievalDebug?: { queryRoute?: QueryDomainRoute };
              citationSources?: Array<{ domain?: string }>;
              verbatimSources?: Array<{ domain?: string }>;
            };

            const debugRoute = metadata.retrievalDebug?.queryRoute;
            if (debugRoute === "PROTOCOL" || debugRoute === "KNOWLEDGE" || debugRoute === "HYBRID") {
              priorAssistantRouteHint = debugRoute;
            } else if (metadata.branch === "HYBRID") {
              priorAssistantRouteHint = "HYBRID";
            } else if (metadata.branch === "KNOWLEDGE_ONLY") {
              priorAssistantRouteHint = "KNOWLEDGE";
            } else if (typeof metadata.branch === "string") {
              priorAssistantRouteHint = "PROTOCOL";
            }

            const hasProtocolCitation =
              Array.isArray(metadata.citationSources) &&
              metadata.citationSources.some((s) => s?.domain === "protocol");
            const hasProtocolVerbatim =
              Array.isArray(metadata.verbatimSources) &&
              metadata.verbatimSources.some((s) => s?.domain === "protocol");

            if ((hasProtocolCitation || hasProtocolVerbatim) && priorAssistantRouteHint === "KNOWLEDGE") {
              priorAssistantRouteHint = "HYBRID";
            }
          }

          if (hasFollowUpSignals) {
            // Find the last substantive user message
            const lastUserMsg = priorMessages.find(
              (m) => m.contentType === "TEXT" && m.content.length > 25
            );
            
            if (lastUserMsg || lastAssistantMsg) {
              const contextParts: string[] = [];
              if (lastUserMsg) {
                contextParts.push(`Previous question: ${lastUserMsg.content.slice(0, 400)}`);
              }
              if (lastAssistantMsg) {
                contextParts.push(`Previous answer: ${lastAssistantMsg.content.slice(0, 400)}`);
              }
              effectiveQuery = `${contextParts.join(' | ')} | Follow-up: ${query}`;
              console.log('Expanded follow-up query:', effectiveQuery.slice(0, 200));
            }
          }
        }
      }

      // Route continuity guard:
      // short/contextual follow-ups should not unexpectedly drop into knowledge-only mode
      // when the prior turn was protocol/hybrid.
      if (
        effectiveQueryRoute === "KNOWLEDGE" &&
        hasFollowUpSignals &&
        priorAssistantRouteHint &&
        priorAssistantRouteHint !== "KNOWLEDGE"
      ) {
        effectiveQueryRoute = "HYBRID";
        shouldSearchProtocol = true;
        shouldSearchKnowledge = true;
        routeOverrideReason = `follow-up continuity override from ${queryDomain.route} using prior assistant route ${priorAssistantRouteHint}`;
        console.log("[RAG] Applied route continuity override", {
          classifierRoute: queryDomain.route,
          effectiveQueryRoute,
          priorAssistantRouteHint,
        });
      }

      interventionRisk = assessInterventionRisk(query, conversationContext);
      contextCompleteness = assessContextCompleteness(`${query}\n${conversationContext}`);
      missingContextFields = getMissingContextFields(contextCompleteness);

      if (interventionRisk.level === "invasive" || interventionRisk.level === "medication") {
        const providedFieldCount = 5 - missingContextFields.length;
        console.log(
          "Intervention context completeness:",
          `${providedFieldCount}/5`,
          contextCompleteness
        );
      }

      // ════════════════════════════════════════════════════════════════════════
      // STEP 4: EMBEDDING GENERATION (with abbreviation expansion)
      // ════════════════════════════════════════════════════════════════════════
      
      // Expand abbreviations for better retrieval (use effectiveCategory for context hints)
      const { expandedText, expansions } = expandAbbreviationsForRetrieval(effectiveQuery, effectiveCategory);
      const queryForEmbedding = Object.keys(expansions).length > 0 ? expandedText : effectiveQuery;
      
      if (Object.keys(expansions).length > 0) {
        console.log('Expanded abbreviations for retrieval:', expansions);
        console.log('Query for embedding:', queryForEmbedding.slice(0, 150));
      }
      
      const queryEmbedding = await generateEmbedding(queryForEmbedding);

      // ════════════════════════════════════════════════════════════════════════
      // STEP 5: VECTOR SEARCH WITH CATEGORY BOOST
      // ════════════════════════════════════════════════════════════════════════

      const teamsAbdominalCollection = RAG_CONFIG.TEAMS_TIER_CONFIG.SOURCE_COLLECTION;
      const abdominalTriggerPattern = new RegExp(
        RAG_CONFIG.TEAMS_TIER_CONFIG.ABDOMINAL_TRIGGER_KEYWORDS.join("|"),
        "i"
      );
      const isAbdominalOrGIQuery =
        (effectiveCategory && /ABDOMEN|ABDOMINAL|ABD(?:OMEN)?|GI/i.test(effectiveCategory)) ||
        abdominalTriggerPattern.test(effectiveQuery) ||
        (userDepartment || "").toLowerCase() === RAG_CONFIG.TEAMS_TIER_CONFIG.DEPARTMENT.toLowerCase();
      const isTeamsAbdominalBonusCondition =
        emergencyAssessment.severity === RAG_CONFIG.TEAMS_TIER_CONFIG.SOURCE_COLLECTION_T1_CONDITION;
      
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
        document_authority_level: string | null;
        document_source_collection: string | null;
        document_tier: string | null;
        guideline_source: string | null;
        guideline_year: number | null;
        document_metadata: Record<string, unknown> | null;  // Document-level metadata with originalPath
        similarity: number;
        category_boost: number;
        tier_adjustment: number;
      };

      let searchResults: SearchResult[] = [];
      let guidelineContext: GuidelineContext | undefined;
      let guidelinePromptBlock = "";
      const scoreSearchResult = (result: SearchResult): number =>
        Number(result.similarity) * Number(result.category_boost) + Number(result.tier_adjustment || 0);
      const dedupeAndRank = (results: SearchResult[]) => {
        const seen = new Set<string>();
        return results
          .filter((r) => {
            if (seen.has(r.id)) return false;
            seen.add(r.id);
            return true;
          })
          .sort((a, b) => {
            const aScore = scoreSearchResult(a);
            const bScore = scoreSearchResult(b);
            return bScore - aScore;
          })
          .slice(0, RAG_CONFIG.MAX_SEARCH_RESULTS);
      };

      if (!_tierColumnSupportCache) {
        const [introspectionResult] = await ctx.prisma.$queryRaw<
          Array<{
            chunk_has_source_collection: boolean;
            chunk_has_document_tier: boolean;
            document_has_source_collection: boolean;
            document_has_document_tier: boolean;
          }>
        >`
          SELECT
            EXISTS (
              SELECT 1
              FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = 'DocumentChunk'
                AND column_name = 'sourceCollection'
            ) AS chunk_has_source_collection,
            EXISTS (
              SELECT 1
              FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = 'DocumentChunk'
                AND column_name = 'documentTier'
            ) AS chunk_has_document_tier,
            EXISTS (
              SELECT 1
              FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = 'Document'
                AND column_name = 'sourceCollection'
            ) AS document_has_source_collection,
            EXISTS (
              SELECT 1
              FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = 'Document'
                AND column_name = 'documentTier'
            ) AS document_has_document_tier
        `;
        _tierColumnSupportCache = introspectionResult;
      }
      const tierColumnSupport = _tierColumnSupportCache;

      const hasChunkSourceCollection = tierColumnSupport?.chunk_has_source_collection === true;
      const hasChunkDocumentTier = tierColumnSupport?.chunk_has_document_tier === true;
      const hasDocumentSourceCollection = tierColumnSupport?.document_has_source_collection === true;
      const hasDocumentDocumentTier = tierColumnSupport?.document_has_document_tier === true;
      const hasAnySourceCollection = hasChunkSourceCollection || hasDocumentSourceCollection;
      const hasAnyDocumentTier = hasChunkDocumentTier || hasDocumentDocumentTier;
      const canApplyTierAdjustment = hasAnySourceCollection && hasAnyDocumentTier;

      const sourceCollectionExpr =
        hasChunkSourceCollection && hasDocumentSourceCollection
          ? Prisma.sql`COALESCE(dc."sourceCollection", d."sourceCollection")`
          : hasChunkSourceCollection
            ? Prisma.sql`dc."sourceCollection"`
            : hasDocumentSourceCollection
              ? Prisma.sql`d."sourceCollection"`
              : Prisma.sql`NULL::text`;

      const documentTierExpr =
        hasChunkDocumentTier && hasDocumentDocumentTier
          ? Prisma.sql`COALESCE(dc."documentTier"::text, d."documentTier"::text)`
          : hasChunkDocumentTier
            ? Prisma.sql`dc."documentTier"::text`
            : hasDocumentDocumentTier
              ? Prisma.sql`d."documentTier"::text`
              : Prisma.sql`NULL::text`;

      const tierAdjustmentExpr = canApplyTierAdjustment
        ? Prisma.sql`CASE
            WHEN ${sourceCollectionExpr} = ${teamsAbdominalCollection}
              AND ${documentTierExpr} = 'reference'
              AND ${isTeamsAbdominalBonusCondition && isAbdominalOrGIQuery}
              AND d.category::text NOT IN (${Prisma.join(RAG_CONFIG.TEAMS_TIER_CONFIG.T1_BONUS_BLOCKED_CATEGORIES)})
              THEN ${RAG_CONFIG.TEAMS_TIER_CONFIG.REFERENCE_BONUS}
            WHEN ${sourceCollectionExpr} = ${teamsAbdominalCollection}
              AND ${documentTierExpr} = 'educational'
              THEN ${RAG_CONFIG.TEAMS_TIER_CONFIG.EDUCATIONAL_PENALTY}
            ELSE 0
          END`
        : Prisma.sql`0`;

      const runDomainSearch = async (
        storedDomain: "PROTOCOL" | "KNOWLEDGE",
        applyInstitutionFilter: boolean,
        authorityMode: "ALL" | "INSTITUTIONAL_ONLY" = "ALL"
      ): Promise<SearchResult[]> => {
        const domainFilter = Prisma.sql`AND dc.domain = ${storedDomain}::"Domain"`;
        const institutionFilter = applyInstitutionFilter && institution
          ? Prisma.sql`AND d.institution = ${institution}::"Institution"`
          : Prisma.empty;
        const authorityFilter =
          storedDomain === "PROTOCOL" && authorityMode === "INSTITUTIONAL_ONLY"
            ? Prisma.sql`AND d."authorityLevel" = 'INSTITUTIONAL'::"AuthorityLevel"`
            : Prisma.empty;

        if (effectiveCategory) {
          const categoryResults = await ctx.prisma.$queryRaw<SearchResult[]>`
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
              d."authorityLevel"::text as document_authority_level,
              ${sourceCollectionExpr} as document_source_collection,
              ${documentTierExpr} as document_tier,
              d."guidelineSource" as guideline_source,
              d."guidelineYear" as guideline_year,
              d.metadata as document_metadata,
              1 - (dc.embedding <=> ${`[${queryEmbedding.join(',')}]`}::vector) as similarity,
              ${tierAdjustmentExpr} as tier_adjustment,
              1.20 as category_boost
            FROM "DocumentChunk" dc
            JOIN "Document" d ON dc."documentId" = d.id
            WHERE d."isActive" = true
              ${domainFilter}
              ${authorityFilter}
              AND d.category = ${effectiveCategory}
              ${institutionFilter}
            ORDER BY dc.embedding <=> ${`[${queryEmbedding.join(',')}]`}::vector
            LIMIT 5
          `;

          const otherResults = await ctx.prisma.$queryRaw<SearchResult[]>`
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
              d."authorityLevel"::text as document_authority_level,
              ${sourceCollectionExpr} as document_source_collection,
              ${documentTierExpr} as document_tier,
              d."guidelineSource" as guideline_source,
              d."guidelineYear" as guideline_year,
              d.metadata as document_metadata,
              1 - (dc.embedding <=> ${`[${queryEmbedding.join(',')}]`}::vector) as similarity,
              ${tierAdjustmentExpr} as tier_adjustment,
              1.0 as category_boost
            FROM "DocumentChunk" dc
            JOIN "Document" d ON dc."documentId" = d.id
            WHERE d."isActive" = true
              ${domainFilter}
              ${authorityFilter}
              AND d.category != ${effectiveCategory}
              ${institutionFilter}
            ORDER BY dc.embedding <=> ${`[${queryEmbedding.join(',')}]`}::vector
            LIMIT 3
          `;

          return dedupeAndRank([...categoryResults, ...otherResults]);
        }

        const unfilteredResults = await ctx.prisma.$queryRaw<SearchResult[]>`
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
            d."authorityLevel"::text as document_authority_level,
              ${sourceCollectionExpr} as document_source_collection,
              ${documentTierExpr} as document_tier,
            d."guidelineSource" as guideline_source,
            d."guidelineYear" as guideline_year,
            d.metadata as document_metadata,
            1 - (dc.embedding <=> ${`[${queryEmbedding.join(',')}]`}::vector) as similarity,
            ${tierAdjustmentExpr} as tier_adjustment,
            1.0 as category_boost
          FROM "DocumentChunk" dc
          JOIN "Document" d ON dc."documentId" = d.id
          WHERE d."isActive" = true
            ${domainFilter}
            ${authorityFilter}
            ${institutionFilter}
          ORDER BY dc.embedding <=> ${`[${queryEmbedding.join(',')}]`}::vector
          LIMIT ${RAG_CONFIG.MAX_SEARCH_RESULTS}
        `;
        return unfilteredResults;
      };

      // ── BM25 lexical lane ─────────────────────────────────────────────────
      // Ordered by ts_rank against the GIN-indexed `searchVector`. Each row
      // also carries the cosine similarity so it slots into the same
      // SearchResult shape the relevance gate downstream expects. Returns up
      // to 30 candidates so RRF has a wider net than dense alone.
      const BM25_LANE_LIMIT = 30;
      const runDomainBm25Search = async (
        storedDomain: "PROTOCOL" | "KNOWLEDGE",
        applyInstitutionFilter: boolean,
        authorityMode: "ALL" | "INSTITUTIONAL_ONLY" = "ALL"
      ): Promise<SearchResult[]> => {
        const domainFilter = Prisma.sql`AND dc.domain = ${storedDomain}::"Domain"`;
        const institutionFilter = applyInstitutionFilter && institution
          ? Prisma.sql`AND d.institution = ${institution}::"Institution"`
          : Prisma.empty;
        const authorityFilter =
          storedDomain === "PROTOCOL" && authorityMode === "INSTITUTIONAL_ONLY"
            ? Prisma.sql`AND d."authorityLevel" = 'INSTITUTIONAL'::"AuthorityLevel"`
            : Prisma.empty;
        const categoryBoostExpr = effectiveCategory
          ? Prisma.sql`CASE WHEN d.category = ${effectiveCategory} THEN 1.20 ELSE 1.0 END`
          : Prisma.sql`1.0`;

        return ctx.prisma.$queryRaw<SearchResult[]>`
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
            d."authorityLevel"::text as document_authority_level,
            ${sourceCollectionExpr} as document_source_collection,
            ${documentTierExpr} as document_tier,
            d."guidelineSource" as guideline_source,
            d."guidelineYear" as guideline_year,
            d.metadata as document_metadata,
            1 - (dc.embedding <=> ${`[${queryEmbedding.join(',')}]`}::vector) as similarity,
            ${tierAdjustmentExpr} as tier_adjustment,
            ${categoryBoostExpr} as category_boost
          FROM "DocumentChunk" dc
          JOIN "Document" d ON dc."documentId" = d.id
          WHERE d."isActive" = true
            ${domainFilter}
            ${authorityFilter}
            ${institutionFilter}
            AND dc."searchVector" IS NOT NULL
            AND dc."searchVector" @@ plainto_tsquery('english', ${queryForEmbedding})
          ORDER BY ts_rank(dc."searchVector", plainto_tsquery('english', ${queryForEmbedding})) DESC
          LIMIT ${BM25_LANE_LIMIT}
        `;
      };

      // Per-domain hybrid retrieval: RRF-fuse the dense vector lane with the
      // BM25 lane. Output is clipped to MAX_SEARCH_RESULTS so downstream
      // (HYBRID merge, relevance gate, cloud prompt budget) keeps its current
      // shape. BM25 hits compete with dense hits for those slots — the win is
      // recall on lexical matches the dense embedder under-ranks.
      const runFusedDomainSearch = async (
        storedDomain: "PROTOCOL" | "KNOWLEDGE",
        applyInstitutionFilter: boolean,
        authorityMode: "ALL" | "INSTITUTIONAL_ONLY" = "ALL"
      ): Promise<SearchResult[]> => {
        const [dense, bm25] = await Promise.all([
          runDomainSearch(storedDomain, applyInstitutionFilter, authorityMode),
          runDomainBm25Search(storedDomain, applyInstitutionFilter, authorityMode),
        ]);
        return reciprocalRankFusion(dense, bm25, 60).slice(
          0,
          RAG_CONFIG.MAX_SEARCH_RESULTS
        );
      };

      type GuidelineSearchResult = {
        content: string;
        document_title: string;
        document_source: string;
        guideline_source: string | null;
        guideline_year: number | null;
        similarity: number;
      };

      let retrievalFailure: {
        code?: string;
        userMessage: string;
        hint: string;
        technicalMessage: string;
        missingColumn?: string;
      } | null = null;

      try {
        let protocolResults = shouldSearchProtocol
          ? await runFusedDomainSearch("PROTOCOL", true, "INSTITUTIONAL_ONLY")
          : [];
        let knowledgeResults = shouldSearchKnowledge
          ? await runFusedDomainSearch("KNOWLEDGE", false)
          : [];

        // Fail-open retrieval guard:
        // if a single-domain route returns zero hits, probe the other domain
        // before deciding there is no content.
        if (!shouldSearchProtocol && shouldSearchKnowledge && knowledgeResults.length === 0) {
          protocolResults = await runFusedDomainSearch("PROTOCOL", true, "INSTITUTIONAL_ONLY");
        } else if (shouldSearchProtocol && !shouldSearchKnowledge && protocolResults.length === 0) {
          knowledgeResults = await runFusedDomainSearch("KNOWLEDGE", false);
        }

        const reconciledRoute = reconcileRouteAfterRetrieval(effectiveQueryRoute, {
          protocolHitCount: protocolResults.length,
          knowledgeHitCount: knowledgeResults.length,
        });

        if (reconciledRoute.route !== effectiveQueryRoute) {
          const previousRoute = effectiveQueryRoute;
          effectiveQueryRoute = reconciledRoute.route;
          shouldSearchProtocol = effectiveQueryRoute !== "KNOWLEDGE";
          shouldSearchKnowledge = effectiveQueryRoute !== "PROTOCOL";
          if (reconciledRoute.reason) {
            routeOverrideReason = routeOverrideReason
              ? `${routeOverrideReason}; ${reconciledRoute.reason}`
              : reconciledRoute.reason;
          }
          console.log("[RAG] Applied retrieval availability override", {
            previousRoute,
            effectiveQueryRoute,
            protocolHitCount: protocolResults.length,
            knowledgeHitCount: knowledgeResults.length,
            reason: reconciledRoute.reason ?? null,
          });
        }

        if (protocolResults.length > 0) {
          const guidelineCandidates = await ctx.prisma.$queryRaw<GuidelineSearchResult[]>`
            SELECT
              dc.content,
              d.title as document_title,
              d.source as document_source,
              d."guidelineSource" as guideline_source,
              d."guidelineYear" as guideline_year,
              1 - (dc.embedding <=> ${`[${queryEmbedding.join(',')}]`}::vector) as similarity
            FROM "DocumentChunk" dc
            JOIN "Document" d ON dc."documentId" = d.id
            WHERE d."isActive" = true
              AND dc.domain = 'PROTOCOL'::"Domain"
              AND d."authorityLevel" IN ('NATIONAL_GUIDELINE'::"AuthorityLevel", 'SOCIETY_GUIDELINE'::"AuthorityLevel")
            ORDER BY dc.embedding <=> ${`[${queryEmbedding.join(',')}]`}::vector
            LIMIT 2
          `;

          const similarityThreshold = 0.55;
          const maxGuidelineChars = 1500 * 4; // ~1500 token budget
          let usedChars = 0;
          const included = guidelineCandidates
            .filter((item) => Number(item.similarity) > similarityThreshold)
            .map((item) => {
              const remaining = Math.max(0, maxGuidelineChars - usedChars);
              const normalized = item.content.replace(/\s+/g, " ").trim();
              const excerpt = normalized.slice(0, remaining);
              usedChars += excerpt.length;
              return {
                ...item,
                excerpt,
              };
            })
            .filter((item) => item.excerpt.length > 0);

          if (included.length > 0) {
            const best = included[0];
            const sourceLabel =
              best.guideline_source && best.guideline_year
                ? `${best.guideline_source} (${best.guideline_year})`
                : best.guideline_source
                  ? best.guideline_source
                  : best.guideline_year
                    ? `${best.document_title} (${best.guideline_year})`
                    : best.document_title;

            guidelineContext = {
              source: sourceLabel,
              relevantExcerpt: best.excerpt,
              similarity: Math.round(Number(best.similarity) * 100) / 100,
            };

            const guidelineSourceBlocks = included
              .map((item, idx) => {
                const label =
                  item.guideline_source && item.guideline_year
                    ? `${item.guideline_source} (${item.guideline_year})`
                    : item.guideline_source || item.document_title;
                return `[GUIDELINE ${idx + 1}: ${label} | ${Math.round(Number(item.similarity) * 100)}%]
${item.excerpt}
[END GUIDELINE ${idx + 1}]`;
              })
              .join("\n\n");

            guidelinePromptBlock = `NATIONAL GUIDELINE CONTEXT:
After your main answer, add a "National Guideline Context" section noting whether the ACR/national guideline agrees, adds options, or differs from institutional protocol. State differences factually. Do NOT recommend one over the other.

Use ONLY the guideline excerpts below for this section:
${guidelineSourceBlocks}`;
          }
        }

        if (effectiveQueryRoute === "HYBRID") {
          const rankK = 60;
          const rrfScores = new Map<string, number>();

          protocolResults.forEach((result, index) => {
            rrfScores.set(result.id, (rrfScores.get(result.id) || 0) + 1 / (rankK + index + 1));
          });
          knowledgeResults.forEach((result, index) => {
            rrfScores.set(result.id, (rrfScores.get(result.id) || 0) + 1 / (rankK + index + 1));
          });

          const combined = [...protocolResults, ...knowledgeResults];
          const deduped = new Map<string, SearchResult>();
          for (const result of combined) {
            if (!deduped.has(result.id)) deduped.set(result.id, result);
          }

          searchResults = [...deduped.values()]
            .sort((a, b) => {
              const aRrf = rrfScores.get(a.id) || 0;
              const bRrf = rrfScores.get(b.id) || 0;
              if (bRrf !== aRrf) return bRrf - aRrf;
              const aScore = scoreSearchResult(a);
              const bScore = scoreSearchResult(b);
              return bScore - aScore;
            })
            .slice(0, RAG_CONFIG.MAX_SEARCH_RESULTS);
        } else if (effectiveQueryRoute === "PROTOCOL") {
          searchResults = protocolResults;
        } else {
          searchResults = knowledgeResults;
        }
      } catch (dbError) {
        const prismaCode =
          dbError instanceof Prisma.PrismaClientKnownRequestError ? dbError.code : undefined;
        const prismaMetaMessage =
          dbError instanceof Prisma.PrismaClientKnownRequestError &&
          typeof dbError.meta?.message === "string"
            ? dbError.meta.message
            : undefined;
        const rawErrorMessage =
          prismaMetaMessage ??
          (dbError instanceof Error ? dbError.message : String(dbError));
        const missingColumnMatch = rawErrorMessage.match(
          /column\s+("?[\w.]+"?)\s+does not exist/i
        );
        const missingColumn = missingColumnMatch?.[1]?.replace(/"/g, "");
        const hint = missingColumn
          ? `Database schema is missing ${missingColumn}. Run npm run db:push, then restart the server.`
          : "Check database connectivity and schema compatibility, then retry the request.";
        const userMessage = missingColumn
          ? "I couldn't retrieve protocol documents because the backend database schema is out of date. Please run npm run db:push and retry."
          : "I couldn't retrieve protocol documents due to a backend retrieval error. Please retry in a moment or contact support.";

        retrievalFailure = {
          code: prismaCode,
          userMessage,
          hint,
          technicalMessage: rawErrorMessage.slice(0, 500),
          ...(missingColumn ? { missingColumn } : {}),
        };

        console.error("[RAG] Retrieval query failed", {
          errorName: dbError instanceof Error ? dbError.name : typeof dbError,
          prismaCode: prismaCode ?? null,
          missingColumn: missingColumn ?? null,
          hint,
          errorMessage: rawErrorMessage.slice(0, 300),
        });
        searchResults = [];
      }

      console.log('Retrieved', searchResults.length, 'chunks:');
      searchResults.forEach((r, i) => {
        const score = scoreSearchResult(r);
        console.log(`  ${i + 1}. ${r.document_title} (${score.toFixed(3)})`);
      });

      // ════════════════════════════════════════════════════════════════════════
      // STEP 6: RETRIEVAL FAILURE HANDLING
      // ════════════════════════════════════════════════════════════════════════
      if (retrievalFailure) {
        if (!convId) {
          const conversation = await ctx.prisma.conversation.create({
            data: {
              type: "RAG_CHAT",
              title: query.slice(0, 100),
              participants: {
                create: [{ userId: ctx.user!.id }],
              },
            },
          });
          convId = conversation.id;
        }

        await ctx.prisma.message.create({
          data: {
            conversationId: convId,
            senderId: ctx.user!.id,
            content: query,
            contentType: "TEXT",
          },
        });

        await ctx.prisma.message.create({
          data: {
            conversationId: convId,
            senderId: ctx.user!.id,
            content: retrievalFailure.userMessage,
            contentType: "RAG_RESPONSE",
            metadata: JSON.parse(
              JSON.stringify({
                citations: [],
                citationSources: [],
                verbatimSources: [],
                confidence: 0,
                emergencyAssessment: queryEmergencyAssessment,
                branch: "RETRIEVAL_ERROR",
                retrievalError: {
                  code: retrievalFailure.code ?? null,
                  hint: retrievalFailure.hint,
                  missingColumn: retrievalFailure.missingColumn ?? null,
                  technicalMessage: retrievalFailure.technicalMessage,
                },
                retrievalDebug: {
                  queryRoute: effectiveQueryRoute,
                  classifierRoute: queryDomain.route,
                  routeOverrideReason: routeOverrideReason ?? null,
                  knowledgeCorpusIndexed,
                  knowledgeCorpusDocumentCount,
                  knowledgeRouteUnavailable,
                },
              })
            ),
          },
        });

        await ctx.prisma.conversation.update({
          where: { id: convId },
          data: { updatedAt: new Date() },
        });

        return {
          summary: retrievalFailure.userMessage,
          answer: retrievalFailure.userMessage,
          citationSources: [],
          verbatimSources: [],
          citations: [],
          confidence: 0,
          emergencyAssessment: queryEmergencyAssessment,
          conversationId: convId,
          hasRelevantContent: false,
          retrievalDebug: {
            effectiveQuery: query,
            queryRoute: effectiveQueryRoute,
            classifierRoute: queryDomain.route,
            routeOverrideReason,
            knowledgeCorpusIndexed: knowledgeCorpusIndexed ?? undefined,
            knowledgeCorpusDocumentCount: knowledgeCorpusDocumentCount ?? undefined,
            knowledgeRouteUnavailable,
          },
        };
      }

      // ════════════════════════════════════════════════════════════════════════
      // STEP 7: RELEVANCE FILTERING, CONFIDENCE & VERBATIM SOURCES
      // ════════════════════════════════════════════════════════════════════════

      const rawTopSimilarity = searchResults.length > 0
        ? scoreSearchResult(searchResults[0])
        : 0;
      // Cap at 1.0 to prevent >100% confidence from category boost
      const topSimilarity = Math.min(1.0, rawTopSimilarity);
      const confidence = Math.round(topSimilarity * 100);
      let hasRelevantContent = topSimilarity >= RAG_CONFIG.MIN_CONFIDENCE_THRESHOLD;

      // ── Relevance gate: filter out sources below display threshold ──
      const { relevantResults } = filterResultsByDisplayRelevance(
        searchResults,
        effectiveQuery,
        {
          minDisplaySimilarity: RAG_CONFIG.MIN_DISPLAY_SIMILARITY,
          minDisplaySimilarityKnowledge: RAG_CONFIG.MIN_DISPLAY_SIMILARITY_KNOWLEDGE,
          borderlineBuffer: 0.08,
          borderlineMinOverlap: 1,
        }
      );

      console.log(`Relevance filter: ${searchResults.length} → ${relevantResults.length} results`);

      // ════════════════════════════════════════════════════════════════════════
      // STEP 7a: IT SCOPE REDIRECT (deterministic, pre-LLM)
      // ════════════════════════════════════════════════════════════════════════
      // Narrow case: query was classified as IT-troubleshooting AND no chunk
      // survived display-relevance gating. The corpus has no answerable
      // material — instead of paying for an LLM call that will refuse or
      // hallucinate, return a canned scope-redirect.
      // IT queries with relevant retrievals (`relevantResults.length > 0`) fall
      // through to the existing IT prompt branches at the cloud builder.
      if (isITTroubleshooting && relevantResults.length === 0) {
        if (!convId) {
          const conversation = await ctx.prisma.conversation.create({
            data: {
              type: "RAG_CHAT",
              title: query.slice(0, 100),
              participants: {
                create: [{ userId: ctx.user!.id }],
              },
            },
          });
          convId = conversation.id;
        }

        const itRedirectResponse =
          "This question appears to be about IT systems or troubleshooting outside the scope of indexed radiology resources. Please contact your radiology IT help desk or systems administrator for assistance. This assistant covers radiology protocols, clinical decision support, and indexed departmental procedures.";

        await ctx.prisma.message.create({
          data: {
            conversationId: convId,
            senderId: ctx.user!.id,
            content: query,
            contentType: "TEXT",
          },
        });

        await ctx.prisma.message.create({
          data: {
            conversationId: convId,
            senderId: ctx.user!.id,
            content: itRedirectResponse,
            contentType: "RAG_RESPONSE",
            metadata: JSON.parse(
              JSON.stringify({
                citations: [],
                citationSources: [],
                verbatimSources: [],
                confidence: 0,
                emergencyAssessment: queryEmergencyAssessment,
                branch: "IT_REDIRECT",
                retrievalDebug: {
                  queryRoute: effectiveQueryRoute,
                  classifierRoute: queryDomain.route,
                  routeOverrideReason: routeOverrideReason ?? null,
                  matchedProtocolSignals: queryDomain.matchedProtocolSignals,
                  matchedKnowledgeSignals: queryDomain.matchedKnowledgeSignals,
                  knowledgeCorpusIndexed,
                  knowledgeCorpusDocumentCount,
                  knowledgeRouteUnavailable,
                },
              })
            ),
          },
        });

        await ctx.prisma.conversation.update({
          where: { id: convId },
          data: { updatedAt: new Date() },
        });

        console.log("[RAG] IT scope redirect served — query classified IT and zero sources passed relevance gate");

        return {
          summary: itRedirectResponse,
          answer: itRedirectResponse,
          citationSources: [],
          verbatimSources: [],
          citations: [],
          confidence: 0,
          emergencyAssessment: queryEmergencyAssessment,
          conversationId: convId,
          hasRelevantContent: false,
          retrievalDebug: {
            effectiveQuery,
            queryRoute: effectiveQueryRoute,
            classifierRoute: queryDomain.route,
            routeOverrideReason,
            matchedProtocolSignals: queryDomain.matchedProtocolSignals,
            matchedKnowledgeSignals: queryDomain.matchedKnowledgeSignals,
            knowledgeCorpusIndexed: knowledgeCorpusIndexed ?? undefined,
            knowledgeCorpusDocumentCount: knowledgeCorpusDocumentCount ?? undefined,
            knowledgeRouteUnavailable,
          },
        };
      }

      // Keep generation context and displayed sources aligned; do not fall back to below-threshold sources.
      const resultsForLLM = relevantResults;
      const hasRelevantSources = resultsForLLM.length > 0;
      hasRelevantContent = hasRelevantContent && hasRelevantSources;

      const hasProtocolSources = resultsForLLM.some((r) => r.document_domain === "PROTOCOL");
      const hasKnowledgeSources = resultsForLLM.some((r) => r.document_domain === "KNOWLEDGE");
      const knowledgeRoutingRequested = queryDomain.route !== "PROTOCOL";
      const knowledgeCorpusUnavailableForTurn =
        knowledgeRoutingRequested && knowledgeCorpusIndexed === false;
      const hasTeamsAbdominalSources = resultsForLLM.some(
        (r) => r.document_source_collection === teamsAbdominalCollection
      );
      const hasITSources = resultsForLLM.some(
        (r) => r.document_source === "IT_KNOWLEDGE_BASE" ||
               (r.document_metadata as Record<string, unknown> | null)?.contentType === "IT_TROUBLESHOOTING"
      );
      // Use IT mode when query intent is IT AND/OR retrieved sources are IT content
      const isITMode = isITTroubleshooting || hasITSources;
      const shouldIncludeTeamsInstruction =
        hasProtocolSources &&
        hasTeamsAbdominalSources &&
        emergencyAssessment.severity !== "urgent" &&
        emergencyAssessment.severity !== "emergency";
      const teamsGuidanceBlock = shouldIncludeTeamsInstruction
        ? `DEPARTMENTAL SOURCE NOTE:
When sources from ${teamsAbdominalCollection} are present, explicitly call out where departmental standards differ from base protocol guidance. Prefer institutional protocol content first, then add a dedicated section:
- Highlight any workflow, dosing, or criteria differences between teams_abdominal guidance and non-teams protocol guidance.
- If guidance conflicts, state both perspectives with source titles.
- Do not escalate conflicts to diagnosis or treatment instructions outside documented standards.`
        : "";
      emergencyAssessment = hasProtocolSources
        ? queryEmergencyAssessment
        : { isEmergency: false, severity: "routine", triggers: [], escalators: [], numericAlerts: [] };

      const mapResultToSource = (r: SearchResult): VerbatimSource => {
          const docMeta = r.document_metadata as { originalPath?: string; fileName?: string; originalUrl?: string } | null;
          const chunkMeta = r.metadata as { 
            fileName?: string; 
            filePath?: string; 
            originalPath?: string;
            pageStart?: number;
            pageEnd?: number;
            sectionHeading?: string;
          } | null;
          
          let url: string | null = null;
          const isKnowledgeSource = r.document_domain === "KNOWLEDGE";
          
          // Non-file-backed documents (ingested from in-memory data) have no
          // physical file on disk, so a /api/policies/ URL would 404.
          const NON_FILE_SOURCES = new Set(["IT_KNOWLEDGE_BASE", "Radiology AI Assistant Internal"]);
          const isNonFileBacked = NON_FILE_SOURCES.has(r.document_source) ||
            (r.document_metadata as Record<string, unknown> | null)?.contentType === "IT_TROUBLESHOOTING";

          if (isKnowledgeSource || isNonFileBacked) {
            // Internal-only citation policy:
            // knowledge / non-file-backed sources are shown in "sources reviewed"
            // but we do not emit outbound URLs in runtime responses.
            url = null;
          } else {
            // Protocol mode: link to internal PDF viewer
            const resolved = resolveProtocolFilename({
              chunkMeta,
              docMeta: docMeta ? { fileName: docMeta.fileName, originalPath: docMeta.originalPath } : null,
              documentTitle: r.document_title,
            });
            const filename = resolved.filename;
            if (resolved.source === "documentTitle") {
              console.warn("[RAG] Citation filename fallback used document title", {
                documentTitle: r.document_title,
                resolvedFilename: filename,
                chunkMetaFileName: chunkMeta?.fileName ?? null,
                chunkMetaPath: chunkMeta?.filePath ?? chunkMeta?.originalPath ?? null,
                docMetaFileName: docMeta?.fileName ?? null,
                docMetaOriginalPath: docMeta?.originalPath ?? null,
              });
            }
            
            const pageStart = chunkMeta?.pageStart;
            url = `/api/policies/${encodeURIComponent(filename)}`;
            if (pageStart) {
              url += `#page=${pageStart}&zoom=80&pagemode=none`;
            } else {
              url += `#zoom=80&pagemode=none`;
            }
          }
          
          return {
            title: r.document_title,
            content: r.content.trim(),
            category: r.document_category,
            domain: isKnowledgeSource ? "knowledge" : "protocol",
            institution: (r.document_institution as Institution) || undefined,
            sourceLabel: r.document_source || undefined,
            similarity: Math.round(Number(r.similarity) * 100),
            url: url || null,
            chunkIndex: r.chunkIndex,
            pageStart: chunkMeta?.pageStart,
            pageEnd: chunkMeta?.pageEnd,
          };
        };

      // Keep citation mapping and rendered source panel aligned to the same ranked source set.
      const citationSources: VerbatimSource[] = resultsForLLM.map(mapResultToSource);
      const verbatimSources: VerbatimSource[] = citationSources.slice(
        0,
        RAG_CONFIG.MAX_VERBATIM_SOURCES
      );

      // ════════════════════════════════════════════════════════════════════════
      // STEP 8: NO DOCUMENTS FOUND - EARLY RETURN
      // ════════════════════════════════════════════════════════════════════════
      
      if (searchResults.length === 0) {
        // Create conversation if needed
        if (!convId) {
          const conversation = await ctx.prisma.conversation.create({
            data: {
              type: "RAG_CHAT",
              title: query.slice(0, 100),
              participants: {
                create: [{ userId: ctx.user!.id }],
              },
            },
          });
          convId = conversation.id;
        }

        const noDocsResponse = knowledgeCorpusUnavailableForTurn
          ? "I couldn't find indexed institutional protocol documents for this query, and radiology knowledge retrieval is unavailable because the knowledge corpus is not indexed in this environment. Run npm run ingest:knowledge and retry."
          : effectiveQueryRoute === "PROTOCOL"
            ? "I couldn't find indexed institutional protocol documents for this query."
            : effectiveQueryRoute === "KNOWLEDGE"
              ? "I couldn't find indexed radiology knowledge sources for this query."
              : "I couldn't find indexed protocol or knowledge sources for this query.";

        await ctx.prisma.message.create({
          data: {
            conversationId: convId,
            senderId: ctx.user!.id,
            content: query,
            contentType: "TEXT",
          },
        });

        await ctx.prisma.message.create({
          data: {
            conversationId: convId,
            senderId: ctx.user!.id,
            content: noDocsResponse,
            contentType: "RAG_RESPONSE",
            metadata: JSON.parse(
              JSON.stringify({
                citations: [],
                citationSources: [],
                verbatimSources: [],
                confidence: 0,
                emergencyAssessment,
                branch: "NO_DOCS",
                retrievalDebug: {
                  queryRoute: effectiveQueryRoute,
                  classifierRoute: queryDomain.route,
                  routeOverrideReason: routeOverrideReason ?? null,
                  knowledgeCorpusIndexed,
                  knowledgeCorpusDocumentCount,
                  knowledgeRouteUnavailable,
                },
              })
            ),
          },
        });

        await ctx.prisma.conversation.update({
          where: { id: convId },
          data: { updatedAt: new Date() },
        });

        return {
          summary: noDocsResponse,
          answer: noDocsResponse,
          citationSources: [],
          verbatimSources: [],
          citations: [],
          confidence: 0,
          emergencyAssessment,
          conversationId: convId,
          hasRelevantContent: false,
          retrievalDebug: {
            effectiveQuery,
            queryRoute: effectiveQueryRoute,
            classifierRoute: queryDomain.route,
            routeOverrideReason,
            knowledgeCorpusIndexed: knowledgeCorpusIndexed ?? undefined,
            knowledgeCorpusDocumentCount: knowledgeCorpusDocumentCount ?? undefined,
            knowledgeRouteUnavailable,
          },
        };
      }

      // ════════════════════════════════════════════════════════════════════════
      // STEP 9: BUILD LLM PROMPT
      // ════════════════════════════════════════════════════════════════════════
      
      // Resolve the requested model config. Handles the "local" alias and
      // dynamically-discovered local model names via /v1/models. Throws with a
      // clear error if a local model was requested but the server is
      // unreachable or has no chat model loaded — never silently routes to
      // cloud.
      const requestedModelConfig = await resolveModelConfig(modelId);
      const modelName = requestedModelConfig.name;
      // Local models (9B-26B) cannot reliably cite free-text titles and follow
      // dense cloud prompts. For provider === "local" we switch to source-card
      // prompting with [S#] handles and deterministic citation validation.
      const isLocalModel = requestedModelConfig.provider === "local";
      // Local-only evidence compression: cap at 6 cards with at most 2 chunks
      // per document, and force institution coverage when the candidate pool
      // spans more than one institution. The compressed list drives the
      // prompt, the [S#] handle space, validateCitations(), and the
      // sourceCardMap returned to the UI so all four stay in lock-step. Cloud
      // models keep the full resultsForLLM (up to MAX_SEARCH_RESULTS) since
      // they handle wider context cleanly.
      const localPromptResults = isLocalModel
        ? compressForLocalModel(resultsForLLM, {
            documentIdOf: (r) => r.document_title,
            institutionOf: (r) => r.document_institution,
          })
        : resultsForLLM;
      if (isLocalModel && localPromptResults.length !== resultsForLLM.length) {
        console.log(
          `[RAG] Local-model compression: ${resultsForLLM.length} → ${localPromptResults.length} cards`
        );
      }
      const sourceHandles = isLocalModel
        ? localPromptResults.map((_, i) => `S${i + 1}`)
        : [];
      const localSourceCardsText = isLocalModel ? formatSourceCards(localPromptResults) : "";
      const retrievedProfile = hasProtocolSources && hasKnowledgeSources
        ? "HYBRID"
        : hasProtocolSources
          ? "PROTOCOL_ONLY"
          : hasKnowledgeSources
            ? "KNOWLEDGE_ONLY"
            : "NONE";

      const sourceList = hasRelevantSources
        ? resultsForLLM
            .map((r, i) =>
              `${i + 1}. [${r.document_domain === "KNOWLEDGE" ? "Knowledge" : "Protocol"}] "${r.document_title}" (${r.document_category}, ${Math.round(Number(r.similarity) * 100)}% match)`
            )
            .join("\n")
        : "(No retrieved sources passed relevance gating for this query.)";

      const citationPolicyBlock = hasRelevantSources
        ? `CITATION RULES:
- Cite ONLY from the AVAILABLE SOURCES listed below.
- Use source titles EXACTLY as written in AVAILABLE SOURCES.
- Never cite external websites, literature, or generic references in [Source: "..."] markers.
- If no listed source supports a claim, state that directly instead of adding a citation.`
        : `CITATION RULES:
- No [Source: "..."] citations are required because no retrieved sources passed relevance gating.
- Do NOT fabricate citations when relevant sources are unavailable.`;

      const contextForLLM = hasRelevantSources
        ? resultsForLLM
            .map((r, i) =>
              `[SOURCE ${i + 1} | ${r.document_domain === "KNOWLEDGE" ? "KNOWLEDGE" : "PROTOCOL"}: "${r.document_title}"]\n${r.content}\n[END SOURCE ${i + 1}]`
            )
            .join("\n\n" + "─".repeat(40) + "\n\n")
        : "(No source excerpts available after relevance gating.)";

      // Determine institution display name
      const institutionDisplayName = institution === 'INSTITUTION_A' 
        ? 'Primary Hospital Hospital' 
        : institution === 'INSTITUTION_B' 
          ? 'Department Radiology' 
          : 'Primary Hospital / Department Radiology';
      
      // Output style display
      const outputStyleDisplay = outputStyle === 'concise' ? 'Concise' : outputStyle === 'detailed' ? 'Detailed' : 'Auto (context-aware)';

      // Shared output-style resolution for both Protocol and Knowledge branches.
      const effectiveStyle = outputStyle || "auto";
      const isConciseOutput = effectiveStyle === "concise";
      const isDetailedOutput = effectiveStyle === "detailed";
      const isAutoOutput = effectiveStyle === "auto";
      const conciseStyleGuidance = `OUTPUT STYLE: CONCISE
- Be direct and efficient. Lead with the answer.
- Use 2-5 sentences in 1-2 short paragraphs.
- Markdown (bold key values, short bullet lists) is encouraged when it improves scanability.
- No preamble, no throat-clearing, and no "Based on the protocols..." lead-ins.`;
      const detailedStyleGuidance = `OUTPUT STYLE: DETAILED
- Provide a thorough, well-organized response.
- Use headings and sections when covering multiple aspects.
- Include reasoning, relevant caveats, and edge cases.
- Tables or other structured formats are welcome when they improve clarity.`;
      const autoStyleGuidance = `OUTPUT STYLE: AUTO
- Match response length and structure to question complexity.
- Simple factual queries: brief direct answers (2-4 sentences).
- Multi-faceted or nuanced queries: thorough treatment with sections and detail.
- Use judgment; do not pad simple answers or truncate complex ones.`;
      const knowledgeGovernanceBlock = getKnowledgeGovernanceBlock();
      const eligibilityGateBlock = getEligibilityGate();
      const emergencyKnowledgeOverride = getEmergencyKnowledgeOverride();
      const interventionRiskGate = buildInterventionRiskGate(interventionRisk);
      const shouldApplyContextAwareness =
        (interventionRisk.level === "invasive" || interventionRisk.level === "medication") &&
        missingContextFields.length >= 2;
      const contextAwarenessGate = shouldApplyContextAwareness
        ? `CONTEXT AWARENESS
Based on the conversation so far, the following clinical context has NOT been provided:
${missingContextFields.join(", ")}

For invasive recommendations, ALWAYS:
- Acknowledge what information is available
- Note what additional information would be helpful for a definitive recommendation
- Provide best preliminary guidance with appropriate hedging given the incomplete picture
- Use conditional language: "If [missing context], then [recommendation A]; if [alternative context], then [recommendation B]"

Do NOT generate a definitive invasive recommendation when critical clinical context is missing. It is appropriate and encouraged to state what additional information you would need.`
        : "";
      const sharedSafetyGate = [interventionRiskGate, contextAwarenessGate].filter(Boolean).join("\n\n");
      const guidelineInstructionBlock = guidelinePromptBlock
        ? `\n${guidelinePromptBlock}`
        : "";

      // Identity preamble - tells the model what to say if asked about itself
      const identityPreamble = `IMPORTANT: You are the radiology assistant, powered by ${modelName}. 

YOUR CURRENT CONFIGURATION:
- Institution/Policy Source: ${institutionDisplayName}${institution ? ` (filtering to ${institution} documents only)` : ' (searching all institutions)'}
- AI Model: ${modelName}
- Output Style: ${outputStyleDisplay}
- Retrieved source profile: ${retrievedProfile}

If asked about your configuration, model, or settings, provide this information accurately. Do NOT claim to be any other AI system.

`;

      let systemPrompt: string;
      let currentBranch: "KNOWLEDGE_ONLY" | "HYBRID" | "EMERGENCY" | "ROUTINE" | "LOW_CONFIDENCE" = "LOW_CONFIDENCE";

      if (!hasProtocolSources && hasKnowledgeSources) {
        currentBranch = "KNOWLEDGE_ONLY";
        // ════════════════════════════════════════════════════════════════════
        // KNOWLEDGE-ONLY SYSTEM PROMPT
        // The ASSISTANT_SYSTEM_PROMPT.md defines the assistant's full personality (Sections 1-8).
        // ════════════════════════════════════════════════════════════════════
        // Use the same source set shown in the source panel.
        const knowledgeContextSection = resultsForLLM.length > 0
          ? resultsForLLM.map((r, i) => {
              const meta = r.document_metadata as { originalUrl?: string; knowledgeSource?: string } | null;
              const chunkMeta = r.metadata as { sectionHeading?: string } | null;
              const source = meta?.knowledgeSource || r.document_source || "unknown";
              const heading = chunkMeta?.sectionHeading || '';
              const url = meta?.originalUrl || '';

              return `--- Source ${i + 1}: ${r.document_title} (${source}) ${heading ? `[${heading}]` : ''} ---\n${r.content}\n${url ? `URL: ${url}` : ''}`;
            }).join('\n\n')
          : '(No sufficiently relevant sources were found in the knowledge base for this query.)';

        const assistantBase = ASSISTANT_SYSTEM_PROMPT || 'You are the radiology report phrasing and clinical decision-support assistant for a board-certified diagnostic radiologist. Speak as a peer. No disclaimers. No sycophancy.';

        const knowledgeOutputStyleSection = `# OUTPUT STYLE
${isConciseOutput ? conciseStyleGuidance : isDetailedOutput ? detailedStyleGuidance : autoStyleGuidance}
- ${hasRelevantSources ? 'Include [Source: "Exact Title"] citations for key recommendations.' : 'Do not add [Source: "..."] markers when no relevant retrieved sources are available.'}`;

        systemPrompt = isITMode
          ? `${identityPreamble}You are an IT systems troubleshooting assistant for ${institutionDisplayName} radiology department.

You help radiologists, technologists, and staff resolve issues with clinical IT systems including your institution's PACS, EMR (e.g., Epic), worklist manager, and dictation software, workstations, and monitor configurations.

YOUR ROLE:
- Provide clear, step-by-step troubleshooting guidance based on the retrieved knowledge base
- Reference specific error codes, settings, and procedures when available
- Suggest escalation to IT support when the issue requires admin-level access
- Be practical and direct — users are often mid-workflow when asking these questions

---

# RETRIEVED IT TROUBLESHOOTING KNOWLEDGE

The following sources were retrieved from the IT troubleshooting knowledge base. IMPORTANT:
- ONLY cite a source if it is genuinely relevant to the user's question.
- If the retrieved sources do not cover the exact issue, provide general troubleshooting steps and recommend contacting IT support.
- Never invent error codes, menu paths, or configuration details not in the sources.

${knowledgeContextSection}

---

${knowledgeOutputStyleSection}

${conversationContext ? `---

# CONVERSATION HISTORY

${conversationContext}` : ''}`
          : `${assistantBase}

---

# PATIENT ELIGIBILITY GATE (APPLIES BEFORE ANY CLASSIFICATION SYSTEM)

CRITICAL: Before applying ANY classification or scoring system (LI-RADS, Bosniak, TI-RADS, PI-RADS, Fleischner, O-RADS, BI-RADS, Lugano, etc.), you MUST first verify the patient meets the system's eligibility criteria. This is a mandatory pre-check — not optional.

For LI-RADS specifically:
- The patient MUST be in a high-risk population for hepatocellular carcinoma (HCC)
- High-risk populations include: cirrhosis (any cause), chronic hepatitis B (even without cirrhosis), current or prior HCC, liver transplant candidates, liver transplant recipients
- LI-RADS does NOT apply to: pediatric patients (under 18), patients with no known liver disease or HCC risk factors, patients with cirrhosis due to vascular causes (e.g., Budd-Chiari, cardiac hepatopathy) unless they also have another HCC risk factor
- If LI-RADS does not apply, state this clearly FIRST: "LI-RADS does not apply to this patient because [reason]. The LI-RADS system is designed for patients at high risk for HCC."
- Then provide alternative guidance appropriate to the clinical context (e.g., general liver lesion characterization approach)

For all classification systems:
- Check age restrictions, population criteria, and prerequisite conditions
- If the patient does NOT meet criteria, say so before providing any classification
- Do NOT force-fit a scoring system to a patient who doesn't meet its entry criteria
- When the user provides clinical context (age, history, risk factors), USE that information to determine applicability

---

# RETRIEVED RADIOLOGY KNOWLEDGE

The following sources were retrieved from the radiology knowledge base via semantic search. IMPORTANT:
- ONLY cite a source if it is genuinely relevant to the user's question. Do NOT cite irrelevant sources just because they were retrieved.
- If NONE of the retrieved sources address the question, answer from your own radiology knowledge and state: "This answer is based on general radiology knowledge; no directly relevant sources were found in the knowledge base."
- When citing, prefer peer-reviewed and textbook sources for clinical knowledge, radiology reference databases for encyclopedic coverage.
- Apply your certainty calibration (Section 2) and vocabulary fingerprint (Section 4) to all output.

${knowledgeContextSection}

---

${knowledgeOutputStyleSection}

${conversationContext ? `---

# CONVERSATION HISTORY

Use this conversation history to understand follow-up questions. Reference specific patient details, clinical values, findings, and context from prior messages when answering. If the user asks about "it", "that", "this patient", etc., resolve those references from the conversation history below.

${conversationContext}` : ''}
${sharedSafetyGate ? `\n\n---\n\n${sharedSafetyGate}` : ''}`;

      } else if (hasProtocolSources && hasKnowledgeSources) {
        currentBranch = "HYBRID";
        const unifiedStyleSection = isConciseOutput
          ? conciseStyleGuidance
          : isDetailedOutput
            ? detailedStyleGuidance
            : autoStyleGuidance;

        systemPrompt = isITMode
          ? identityPreamble + `You are the radiology department assistant with IT troubleshooting knowledge.

You help radiologists, technologists, and staff resolve issues with clinical IT systems including your institution's PACS, EMR (e.g., Epic), worklist manager, and dictation software, workstations, and monitor configurations.

CRITICAL RULES:
- Provide clear, step-by-step troubleshooting guidance based on the retrieved knowledge base.
- Use [Source: "Exact Title"] citations for every key factual claim.
- If the exact issue is not covered in sources, provide general troubleshooting steps and recommend contacting IT support.
- Never invent error codes, menu paths, or configuration details not in the sources.
${citationPolicyBlock}

${unifiedStyleSection}

AVAILABLE SOURCES:
${sourceList}

${conversationContext ? `CONVERSATION HISTORY (reference specific details from prior messages):\n${conversationContext}\n\n` : ''}

IT TROUBLESHOOTING CONTENT:
${contextForLLM}`
          : identityPreamble + `You are the radiology assistant with two source domains:
1) INSTITUTIONAL PROTOCOLS (authoritative for this institution)
2) RADIOLOGY KNOWLEDGE (general educational references)

CRITICAL RULES:
- Always distinguish protocol guidance from general knowledge.
- If protocol and knowledge conflict, explicitly flag the discrepancy and present institutional protocol first.
- For institutional dosing, thresholds, and procedures, quote exact values/wording from source text; do not paraphrase.
- Use [Source: "Exact Title"] citations for every key factual claim.
- Institution filter applies only to protocols; do not imply it filters knowledge references.
${citationPolicyBlock}
${knowledgeGovernanceBlock}
${eligibilityGateBlock}
${sharedSafetyGate ? `\n${sharedSafetyGate}` : ''}
${guidelineInstructionBlock}
${shouldIncludeTeamsInstruction ? `${teamsGuidanceBlock}\n` : ""}

${emergencyAssessment.isEmergency || emergencyAssessment.severity === 'urgent'
  ? `EMERGENCY MODE ACTIVE: prioritize immediate protocol actions first, then add concise educational context if useful.`
  : `NON-EMERGENCY MODE: provide balanced protocol + educational answer.`}

${unifiedStyleSection}

RESPONSE STRUCTURE:
1) Institutional Protocol Guidance
2) Radiology Knowledge Context
3) If applicable, Discrepancy Note

AVAILABLE SOURCES:
${sourceList}

${conversationContext ? `CONVERSATION HISTORY (reference specific details from prior messages):\n${conversationContext}\n\n` : ''}

SOURCE CONTENT:
${contextForLLM}`;

      } else if (emergencyAssessment.isEmergency || emergencyAssessment.severity === 'urgent') {
        currentBranch = "EMERGENCY";
        const emergencyStyleInstruction = isConciseOutput
          ? `CONCISE EMERGENCY MODE IS ACTIVE.
- Be direct and efficient. Lead with the single highest-priority immediate action.
- Use 2-5 sentences in 1-2 short paragraphs.
- Include only decision-critical monitoring and escalation details.
- Keep doses/thresholds EXACTLY as written in source text (no paraphrasing).
- Markdown (bold key values, short bullets) is encouraged when it improves scanability.`
          : isDetailedOutput
            ? `DETAILED EMERGENCY MODE IS ACTIVE.
- Provide a complete, well-organized emergency response.
- Include rationale and key caveats without delaying immediate actions.
- Use structured sections and numbered steps when useful.
- Keep doses/thresholds EXACTLY as written in source text.

STRUCTURE YOUR RESPONSE:
IMMEDIATE ACTIONS:
[Most critical interventions first, numbered - add [Source: "Document Title"] after each recommendation]

MONITORING:
[What to watch for]

ESCALATION:
[When to call for additional help]`
            : `AUTO EMERGENCY MODE IS ACTIVE.
- Match detail to clinical complexity, but never under-answer an emergency scenario.
- Start with immediate actions, then monitoring and escalation.
- For simple urgent clarifications, stay brief; for complex scenarios, provide full structured guidance.
- Keep doses/thresholds EXACTLY as written in source text.

STRUCTURE YOUR RESPONSE:
IMMEDIATE ACTIONS:
[Most critical interventions first, numbered - add [Source: "Document Title"] after each recommendation]

MONITORING:
[What to watch for]

ESCALATION:
[When to call for additional help]`;

        // Safety note: concise emergency mode reduces cognitive load but keeps
        // source-exact dosing and escalation instructions mandatory.
        systemPrompt = identityPreamble + `You are an EMERGENCY clinical decision support system for ${institutionDisplayName}.

⚠️ ${emergencyAssessment.severity.toUpperCase()} SCENARIO DETECTED
Triggers: ${emergencyAssessment.triggers.join(', ') || 'clinical severity indicators present'}
${emergencyAssessment.escalators.length > 0 ? `Escalators: ${emergencyAssessment.escalators.join(', ')}` : ''}
${emergencyAssessment.numericAlerts.length > 0 ? `Vital Sign Alerts: ${emergencyAssessment.numericAlerts.join(', ')}` : ''}

YOUR RESPONSE MUST:
1. START with the most critical immediate action
2. Include specific doses/values EXACTLY as written in sources - do NOT paraphrase dosing
3. Include emergency contact activation (call 911 or your institution's emergency line) if patient is unstable

${emergencyStyleInstruction}

SCOPE OF EMERGENCY GUIDANCE:
- For contrast reaction emergencies (anaphylaxis, bronchospasm, hypotension, laryngeal edema): direct medication commands per ACR contrast reaction protocols are appropriate. Quote doses EXACTLY from institutional protocols.
- For non-contrast emergencies detected by keyword (for example stroke, trauma): provide risk-stratifying information and imaging-relevant guidance per Radiologist's Lane. Do NOT prescribe medications or make triage decisions outside radiology scope.
- For all emergency scenarios: include institutional emergency contact information and state that clinical judgment and institutional protocols supersede AI guidance.

CITATION FORMAT: After each clinical recommendation, add [Source: "Document Title"] - this becomes a clickable PDF link. Example:
"Administer epinephrine 0.3mg IM [Source: "Contrast Reaction Protocol"]"
${citationPolicyBlock}
${guidelineInstructionBlock}

AVAILABLE SOURCES:
${sourceList}

${conversationContext ? `CONVERSATION HISTORY (reference specific details from prior messages):\n${conversationContext}\n\n` : ''}

PROTOCOL CONTENT:
${contextForLLM}

CRITICAL REMINDER: This is a real clinical scenario. Be direct and specific. Include [Source: "Title"] citations after each recommendation.

${emergencyKnowledgeOverride}
${sharedSafetyGate ? `\n\n${sharedSafetyGate}` : ''}`;

      } else if (hasRelevantContent) {
        currentBranch = "ROUTINE";
        // ROUTINE PROMPT - Adjusted based on output style preference
        
        const styleGuidance = isConciseOutput
          ? conciseStyleGuidance
          : isDetailedOutput
            ? detailedStyleGuidance
            : autoStyleGuidance;

        const deptContext = userDepartment
          ? `\nUSER CONTEXT: The user works in ${userDepartment}. Prioritize information relevant to this subspecialty when applicable.`
          : '';

        const roleSection = isConciseOutput
          ? `YOUR ROLE: Give a direct, high-signal answer using the protocol sources below. The user will ALSO see the verbatim protocol text, so keep your summary concise while still complete enough for safe action.`
          : isDetailedOutput
            ? `YOUR ROLE: Provide a clear, thorough summary of the relevant protocol guidance. The user will ALSO see the verbatim protocol text, so your job is to:
1. Orient them to which protocol section applies
2. Highlight key points in plain language
3. Note important caveats, edge cases, and exceptions`
            : `YOUR ROLE: Adapt response depth to question complexity while staying anchored to protocol sources. Keep simple questions brief and direct, and expand for nuanced scenarios with clear structure.`;

        const guidelinesSection = isConciseOutput
          ? `GUIDELINES:
- Include [Source: "Document Title"] citations for key factual claims
- If dosing is mentioned, quote it exactly
- Never invent clinical details not in the sources`
          : `GUIDELINES:
- After each key recommendation, add [Source: "Document Title"] - this becomes a clickable PDF link
- Example: "The eGFR threshold is 30 mL/min [Source: "Contrast Media Guidelines"]"
- If dosing is mentioned, quote it exactly - NEVER paraphrase medication doses
- If guidance is missing from sources, say so explicitly
- Never invent clinical details not in the sources`;

        systemPrompt = isITMode
          ? identityPreamble + `You are an IT systems troubleshooting assistant for ${institutionDisplayName} radiology department.

You help radiologists, technologists, and staff resolve issues with clinical IT systems including your institution's PACS, EMR (e.g., Epic), worklist manager, and dictation software, workstations, and monitor configurations.

YOUR ROLE:
- Provide clear, step-by-step troubleshooting guidance based on the retrieved knowledge base
- Reference specific error codes, settings, and procedures when available
- Suggest escalation to IT support when the issue requires admin-level access
- Be practical and direct — users are often mid-workflow when asking these questions

${styleGuidance}

GUIDELINES:
- Use [Source: "Document Title"] citations when referencing specific troubleshooting entries
- If the exact issue is not covered in sources, provide general troubleshooting steps and recommend contacting IT support
- Never invent error codes, menu paths, or configuration details not in the sources
${citationPolicyBlock}

AVAILABLE SOURCES:
${sourceList}

${conversationContext ? `CONVERSATION HISTORY:\n${conversationContext}\n\n` : ''}

IT TROUBLESHOOTING CONTENT:
${contextForLLM}`
          : identityPreamble + `You are a clinical protocol assistant for ${institutionDisplayName}.
${deptContext}

${roleSection}

${knowledgeGovernanceBlock}
${eligibilityGateBlock}
${sharedSafetyGate ? `\n${sharedSafetyGate}` : ''}
${guidelineInstructionBlock}
${shouldIncludeTeamsInstruction ? `${teamsGuidanceBlock}\n` : ""}

CRITICAL: Before answering, evaluate whether the referenced guidelines, scoring systems, or criteria actually apply to this patient's clinical context. Consider:
- Patient demographics (age, sex) and whether the guideline has age/population restrictions
- Required risk factors or preconditions for the scoring system
- Contraindications or exclusion criteria mentioned in the source documents
If the guidelines do NOT apply to this patient, say so FIRST and explain why, before providing any other information. Do not force-fit a scoring system to a patient who doesn't meet its criteria.

RESPONSE STYLE:
${styleGuidance}

${guidelinesSection}
${citationPolicyBlock}

AVAILABLE SOURCES:
${sourceList}

${conversationContext ? `CONVERSATION HISTORY (use this to understand follow-up questions — reference specific patient details, values, and clinical context from prior messages when answering):\n${conversationContext}\n\n` : ''}

PROTOCOL CONTENT:
${contextForLLM}`;

      } else {
        currentBranch = "LOW_CONFIDENCE";
        const lowConfidenceHeadline = knowledgeCorpusUnavailableForTurn
          ? `⚠️ KNOWLEDGE CORPUS NOT INDEXED (${confidence}% confidence)`
          : `⚠️ LIMITED RELEVANT CONTENT FOUND (${confidence}% confidence)`;
        const lowConfidenceContext = knowledgeCorpusUnavailableForTurn
          ? `Radiology knowledge retrieval is unavailable because the knowledge corpus is not indexed in this environment (${knowledgeCorpusDocumentCount ?? 0} knowledge documents).`
          : "The available protocol documents may not directly address this question.";
        const lowConfidenceGuidance = knowledgeCorpusUnavailableForTurn
          ? `YOUR RESPONSE SHOULD:
1. Clearly state that knowledge retrieval is unavailable because the knowledge corpus is not indexed
2. Share only any partially relevant institutional protocol information with caveats
3. Distinguish protocol workflow/safety guidance from diagnostic interpretation questions
4. Recommend running npm run ingest:knowledge before retrying this knowledge query
5. Recommend consulting the radiologist on call for patient-specific clinical decisions`
          : `YOUR RESPONSE SHOULD:
1. Acknowledge the uncertainty clearly at the start
2. Share any partially relevant information with appropriate caveats
3. Recommend consulting the radiologist on call if this is a clinical question
4. Suggest the user verify with original protocol documents`;
        const lowConfidenceStyleSection = `${isConciseOutput ? conciseStyleGuidance : isDetailedOutput ? detailedStyleGuidance : autoStyleGuidance}
- Given low confidence, be explicit about uncertainty and the safest next action.`;
        // LOW CONFIDENCE PROMPT
        systemPrompt = isITMode
          ? identityPreamble + `You are an IT systems troubleshooting assistant for ${institutionDisplayName} radiology department.

The IT troubleshooting knowledge base did not return highly relevant results for this specific question. However, you can still help:

YOUR RESPONSE SHOULD:
1. Provide general troubleshooting guidance based on your knowledge of the systems mentioned (PACS, EMR, dictation, worklist, workstations)
2. Suggest common fixes for the type of issue described
3. Recommend contacting IT support with specific details about the problem
4. If partially relevant sources were found, share that information with caveats

${lowConfidenceStyleSection}

${conversationContext ? `CONVERSATION HISTORY:\n${conversationContext}\n\n` : ''}

AVAILABLE CONTEXT (may be partially relevant):
${contextForLLM}`
          : identityPreamble + `You are a clinical protocol assistant for ${institutionDisplayName}.

${lowConfidenceHeadline}

${lowConfidenceContext}

CRITICAL: Before answering, evaluate whether the referenced guidelines, scoring systems, or criteria actually apply to this patient's clinical context. Consider patient demographics, required risk factors or preconditions, and exclusion criteria mentioned in the source documents. If the guidelines do NOT apply, say so FIRST.

${lowConfidenceGuidance}
${lowConfidenceStyleSection}
${knowledgeGovernanceBlock}
${sharedSafetyGate ? `\n${sharedSafetyGate}` : ''}
${citationPolicyBlock}
${guidelineInstructionBlock}
${shouldIncludeTeamsInstruction ? `${teamsGuidanceBlock}\n` : ""}

${conversationContext ? `CONVERSATION HISTORY (use this to understand follow-up questions — reference specific patient details from prior messages):\n${conversationContext}\n\n` : ''}

AVAILABLE CONTEXT (may be partially relevant):
${contextForLLM}`;
      }

      // ════════════════════════════════════════════════════════════════════════
      // STEP 9a: LOCAL-MODEL PROMPT OVERRIDE
      // ════════════════════════════════════════════════════════════════════════
      // Cloud branches above computed systemPrompt and currentBranch for
      // telemetry. For local models the prompt is replaced entirely with a
      // source-card template. Emergency classification still feeds into the
      // local template's safety preamble.
      if (isLocalModel) {
        systemPrompt = buildLocalSystemPrompt({
          sourceCards: localSourceCardsText,
          effectiveQuery,
          isEmergency:
            emergencyAssessment.isEmergency ||
            emergencyAssessment.severity === "urgent" ||
            emergencyAssessment.severity === "emergency",
          conversationContext,
        });
      }

      // ════════════════════════════════════════════════════════════════════════
      // STEP 9: LLM COMPLETION
      // ════════════════════════════════════════════════════════════════════════
      
      const isEmergencyBranch = currentBranch === "EMERGENCY";
      const isKnowledgeOnlyBranch = currentBranch === "KNOWLEDGE_ONLY";
      // Keep concise emergency turns focused to reduce overload, while allowing
      // enough budget for exact dosing, escalation, and citations.
      // Local 9B-26B models produce cleaner output with a constrained budget.
      const maxTokens = isLocalModel
        ? 1024
        : isEmergencyBranch
          ? (isConciseOutput ? 1000 : isAutoOutput ? 1500 : 1800)
          : isConciseOutput
            ? 800
            : isAutoOutput
              ? 1500
              : isKnowledgeOnlyBranch
                ? 2500
                : 2000;
      const generationTemperature = isLocalModel ? 0.1 : 0.2;

      const runCompletion = (prompt: string, overrides?: { maxTokens?: number }) =>
        generateCompletion({
          systemPrompt: prompt,
          userMessage: query,
          maxTokens: overrides?.maxTokens ?? maxTokens,
          temperature: generationTemperature, // Lower temperature for clinical accuracy
          modelId, // User-selected model (defaults to shared DEFAULT_MODEL_ID)
        });

      const stripDeepSeekThinkingTags = (response: string) =>
        response.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

      let completion = await runCompletion(systemPrompt);
      console.log(`LLM Response generated (${completion.provider}/${completion.model})`);

      // Preserve raw [Source: "..."] citations; frontend renders compact citation icons.
      const shouldFormatConcise = shouldApplyConciseFormatting({
        isConciseOutput,
        severity: emergencyAssessment.severity,
        currentBranch,
      });
      const initialResponseContent = stripDeepSeekThinkingTags(completion.content);
      let processedContent = shouldFormatConcise
        ? formatConciseResponse(initialResponseContent)
        : initialResponseContent;

      let validation = validateResponse(processedContent, {
        interventionRisk,
        severity: emergencyAssessment.severity,
        branch: currentBranch,
      });
      let regenerationAttempted = false;

      if (validation.requiresRegeneration) {
        regenerationAttempted = true;
        const criticalViolations = validation.violations
          .filter((violation) => violation.type === "critical")
          .slice(0, 6)
          .map((violation) => `- ${violation.category}: ${violation.match}`);

        const correctionPrompt = `${systemPrompt}

Your previous response contained the following issues:
${criticalViolations.join("\n")}

Regenerate with these corrections:
- Follow governance and recommendation verb hierarchy strictly.
- Remove first-person opinion language.
- Use protected medico-legal lexicon where relevant.
- If invasive action is discussed, include staged/qualified guidance unless commitment triggers are clearly met.
- Keep citations intact using [Source: "Exact Title"] format.`;

        completion = await runCompletion(correctionPrompt);
        console.log(`LLM response regenerated after validation (${completion.provider}/${completion.model})`);
        const regeneratedResponseContent = stripDeepSeekThinkingTags(completion.content);
        processedContent = shouldFormatConcise
          ? formatConciseResponse(regeneratedResponseContent)
          : regeneratedResponseContent;
        validation = validateResponse(processedContent, {
          interventionRisk,
          severity: emergencyAssessment.severity,
          branch: currentBranch,
        });
      }

      // ════════════════════════════════════════════════════════════════════════
      // STEP 9b: LOCAL-MODEL CITATION ENFORCEMENT
      // ════════════════════════════════════════════════════════════════════════
      // For local models only: every [S#] citation must map to an allowed
      // handle, and any answer with substantive content must carry at least
      // one citation (or explicit refusal). On failure, regenerate once with
      // a correction prompt; if still invalid, strip the bad citations.
      let citationCheckAttempted = false;
      let citationRegenerationAttempted = false;
      if (isLocalModel && sourceHandles.length > 0) {
        citationCheckAttempted = true;
        const initialCitationCheck = validateCitations(processedContent, sourceHandles);

        if (!initialCitationCheck.valid) {
          citationRegenerationAttempted = true;
          const allowedList = sourceHandles.map((h) => `[${h}]`).join(", ");
          const invalidList =
            initialCitationCheck.invalidCitations.length > 0
              ? initialCitationCheck.invalidCitations.join(", ")
              : initialCitationCheck.missingCitations
                ? "(none — answer had no citations)"
                : "(unknown)";

          const correctionSystemPrompt = `${systemPrompt}

CITATION CORRECTION NOTICE
Your previous answer contained invalid citations: ${invalidList}.
The ONLY allowed citations are: ${allowedList}.
Rewrite your answer using ONLY these citation handles. If you cannot support a statement from the sources, remove it or use the EXAMPLE 2 refusal form.`;

          completion = await runCompletion(correctionSystemPrompt, { maxTokens: 512 });
          console.log(
            `[LLM] Local citation correction regenerated (${completion.provider}/${completion.model})`
          );
          const correctedContent = stripDeepSeekThinkingTags(completion.content);
          processedContent = shouldFormatConcise
            ? formatConciseResponse(correctedContent)
            : correctedContent;

          const recheck = validateCitations(processedContent, sourceHandles);
          if (!recheck.valid && recheck.invalidCitations.length > 0) {
            const allowedMarkers = new Set(sourceHandles.map((h) => `[${h}]`));
            processedContent = processedContent.replace(/\[S\d+\]/g, (match) =>
              allowedMarkers.has(match) ? match : "[citation removed]"
            );
            console.log(
              `[LLM] Stripped ${recheck.invalidCitations.length} invalid local citation(s) after regeneration`
            );
          }

          // Re-run safety validation on corrected content so downstream
          // metadata and the stored response stay in sync.
          validation = validateResponse(processedContent, {
            interventionRisk,
            severity: emergencyAssessment.severity,
            branch: currentBranch,
          });
        }
      }

      if (guidelineContext) {
        const deltaMatch = processedContent.match(
          /National Guideline Context[:\s]*([\s\S]{0,300})/i
        );
        if (deltaMatch?.[1]) {
          const normalizedDelta = deltaMatch[1].replace(/\s+/g, " ").trim();
          if (normalizedDelta.length > 0) {
            guidelineContext = {
              ...guidelineContext,
              deltaNote: normalizedDelta.slice(0, 220),
            };
          }
        }
      }

      // ════════════════════════════════════════════════════════════════════════
      // STEP 10: CREATE/UPDATE CONVERSATION & SAVE MESSAGES
      // ════════════════════════════════════════════════════════════════════════
      
      if (!convId) {
        const conversation = await ctx.prisma.conversation.create({
          data: {
            type: "RAG_CHAT",
            title: query.slice(0, 100),
            institutionFilter: institution as any || null,  // Store institution filter for context
            categoryFilter: effectiveCategory || null,  // Store effective category (explicit or detected)
            participants: {
              create: [{ userId: ctx.user!.id }],
            },
          },
        });
        convId = conversation.id;
      }

      // Build legacy citations format for backward compatibility using the same mapped source set.
      const citations = resultsForLLM.map((r) => {
        const chunkMeta = r.metadata as { fileName?: string; filePath?: string; originalPath?: string } | null;
        const docMeta = r.document_metadata as { fileName?: string; originalPath?: string } | null;
        const { filename } = resolveProtocolFilename({
          chunkMeta,
          docMeta,
          documentTitle: r.document_title,
        });
        
        return {
          documentTitle: r.document_title,
          source: r.document_source,
          category: r.document_category,
          section: (r.metadata as { section?: string } | null)?.section,
          page: (r.metadata as { page?: number } | null)?.page,
          relevantText: r.content.slice(0, 200) + "...",
          similarity: Number(r.similarity),
          filename,
        };
      });

      // Save messages separately to ensure correct ordering (createMany gives same timestamp)
      await ctx.prisma.message.create({
        data: {
          conversationId: convId,
          senderId: ctx.user!.id,
          content: query,
          contentType: "TEXT",
        },
      });
      
      // Small delay to ensure different timestamp for ordering
      await ctx.prisma.message.create({
        data: {
          conversationId: convId,
          senderId: ctx.user!.id,
          content: processedContent,
          contentType: "RAG_RESPONSE",
          metadata: JSON.parse(JSON.stringify({ 
            citations, 
            citationSources,
            verbatimSources,
            guidelineContext,
            confidence,
            emergencyAssessment,
            branch: currentBranch,
            interventionRisk,
            contextCompleteness,
            validation: {
              isValid: validation.isValid,
              requiresRegeneration: validation.requiresRegeneration,
              regenerationAttempted,
              violations: validation.violations,
              localCitationCheck: citationCheckAttempted
                ? {
                    attempted: true,
                    regenerationAttempted: citationRegenerationAttempted,
                    allowedHandles: sourceHandles,
                  }
                : undefined,
            },
            retrievalDebug: {
              effectiveQuery,
              queryRoute: effectiveQueryRoute,
              classifierRoute: queryDomain.route,
              routeOverrideReason,
              usedClassifierLlmFallback: queryDomain.usedLlmFallback,
              matchedProtocolSignals: queryDomain.matchedProtocolSignals,
              matchedKnowledgeSignals: queryDomain.matchedKnowledgeSignals,
              knowledgeCorpusIndexed,
              knowledgeCorpusDocumentCount,
              knowledgeRouteUnavailable,
            },
          })),
        },
      });

      // Update conversation timestamp
      await ctx.prisma.conversation.update({
        where: { id: convId },
        data: { updatedAt: new Date() },
      });

      // Debug: Log emergency assessment being returned
      console.log('Emergency assessment returned:', JSON.stringify(emergencyAssessment));
      
      // Determine if fallback was used. Reuses requestedModelConfig from
      // earlier resolution so synthetic local configs (and the "local" alias)
      // compare correctly against completion.model.
      const requestedModelId = modelId || getDefaultModel().id;
      const fallbackUsed = completion.provider !== requestedModelConfig.provider ||
                           completion.model !== requestedModelConfig.modelId;

      if (fallbackUsed) {
        console.log(`⚠️ FALLBACK USED: Requested ${requestedModelConfig.name} (${requestedModelConfig.provider}) but got ${completion.model} (${completion.provider})`);
      }
      console.log('═'.repeat(80) + '\n');

      // ════════════════════════════════════════════════════════════════════════
      // STEP 11: RETURN HYBRID RESPONSE
      // ════════════════════════════════════════════════════════════════════════
      
      return {
        summary: processedContent,
        answer: processedContent, // Legacy compatibility
        citationSources,
        verbatimSources,
        guidelineContext,
        citations, // Legacy compatibility
        confidence: topSimilarity, // Decimal 0-1, capped to prevent >100%
        emergencyAssessment,
        conversationId: convId,
        hasRelevantContent,
        // Model info - which model actually responded
        modelInfo: {
          requested: requestedModelId,
          actual: completion.model,
          provider: completion.provider,
          fallbackUsed,
        },
        // Topic detection info (when auto-detected, not user-selected)
        ...(detectedTopicInfo ? { detectedTopic: detectedTopicInfo } : {}),
        // Local-model source-card mapping (forward-compatible for UI linking).
        // Backed by localPromptResults so handles align with compressed cards.
        ...(isLocalModel && sourceHandles.length > 0
          ? {
              sourceCardMap: sourceHandles.map((handle, i) => ({
                handle,
                title: localPromptResults[i]?.document_title ?? "Untitled",
                institution: (localPromptResults[i]?.document_institution as Institution) || undefined,
                domain: (localPromptResults[i]?.document_domain === "KNOWLEDGE"
                  ? "knowledge"
                  : "protocol") as SourceDomain,
              })),
            }
          : {}),
        retrievalDebug: {
          effectiveQuery,
          queryRoute: effectiveQueryRoute,
          classifierRoute: queryDomain.route,
          routeOverrideReason,
          usedClassifierLlmFallback: queryDomain.usedLlmFallback,
          matchedProtocolSignals: queryDomain.matchedProtocolSignals,
          matchedKnowledgeSignals: queryDomain.matchedKnowledgeSignals,
          expandedQuery: queryAnalysis?.expandedQuery !== query ? queryAnalysis?.expandedQuery : 
                        (Object.keys(expansions).length > 0 ? queryForEmbedding : undefined),
          abbreviationsDetected: queryAnalysis?.ambiguousTerms?.map(t => t.term),
          abbreviationsExpanded: Object.keys(expansions).length > 0 ? expansions : undefined,
          topicDetected: detectedTopicInfo?.label,
          topicConfidence: queryAnalysis?.detectedTopic?.confidence,
          llmReasoning: queryAnalysis?.reasoning,
          interventionRiskLevel: interventionRisk.level,
          interventionRiskTriggers: interventionRisk.triggers,
          isInterventionDecision: interventionRisk.isInterventionDecision,
          contextCompleteness,
          responseValidation: {
            isValid: validation.isValid,
            violations: validation.violations,
            regenerationAttempted,
          },
          knowledgeCorpusIndexed: knowledgeCorpusIndexed ?? undefined,
          knowledgeCorpusDocumentCount: knowledgeCorpusDocumentCount ?? undefined,
          knowledgeRouteUnavailable,
        },
      };
    }),

  // ════════════════════════════════════════════════════════════════════════════
  // LIST DOCUMENTS
  // ════════════════════════════════════════════════════════════════════════════
  listDocuments: protectedProcedure
    .input(
      z.object({
        category: z.string().optional(),
        subspecialty: subspecialtySchema.optional(),
        institution: institutionSchema.optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      return ctx.prisma.document.findMany({
        where: {
          isActive: true,
          ...(input.category && { category: input.category }),
          ...(input.subspecialty && {
            subspecialties: { has: input.subspecialty },
          }),
          ...(input.institution && { institution: input.institution as any }),
        },
        select: {
          id: true,
          title: true,
          source: true,
          category: true,
          subspecialties: true,
          institution: true,
          version: true,
          updatedAt: true,
        },
        orderBy: { title: "asc" },
      });
    }),

  // ════════════════════════════════════════════════════════════════════════════
  // UPLOAD DOCUMENT
  // ════════════════════════════════════════════════════════════════════════════
  uploadDocument: adminProcedure
    .input(
      z.object({
        title: z.string().min(1).max(200),
        source: z.string().min(1).max(100),
        category: z.string().optional(),
        subspecialties: z.array(subspecialtySchema).optional(),
        institution: institutionSchema.optional(),
        version: z.string().optional(),
        content: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const institution = input.institution || "INSTITUTION_B";
      
      const document = await ctx.prisma.document.create({
        data: {
          title: input.title,
          source: input.source,
          category: input.category,
          subspecialties: input.subspecialties ?? [],
          institution: institution as any,
          version: input.version,
          content: input.content,
        },
      });

      // Chunk and embed
      const chunks = chunkText(input.content, 512, 100);

      for (let i = 0; i < chunks.length; i++) {
        const embedding = await generateEmbedding(chunks[i], 'document');

        await ctx.prisma.$executeRaw`
          INSERT INTO "DocumentChunk" (id, "documentId", "chunkIndex", content, embedding, institution, domain, "authorityLevel", "createdAt")
          VALUES (
            gen_random_uuid(),
            ${document.id},
            ${i},
            ${chunks[i]},
            ${`[${embedding.join(',')}]`}::vector,
            ${institution}::"Institution",
            'PROTOCOL'::"Domain",
            'INSTITUTIONAL'::"AuthorityLevel",
            NOW()
          )
        `;
      }

      return { document, chunksCreated: chunks.length };
    }),
});

// ════════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════════

function chunkText(text: string, chunkSize: number, overlap: number): string[] {
  const chunks: string[] = [];
  const words = text.split(/\s+/);
  
  let currentChunk: string[] = [];
  let wordCount = 0;

  for (const word of words) {
    currentChunk.push(word);
    wordCount++;

    if (wordCount >= chunkSize) {
      chunks.push(currentChunk.join(" "));
      const overlapWords = Math.floor(overlap);
      currentChunk = currentChunk.slice(-overlapWords);
      wordCount = currentChunk.length;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join(" "));
  }

  return chunks;
}
