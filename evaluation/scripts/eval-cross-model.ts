#!/usr/bin/env npx tsx
/**
 * Tier 3 Evaluation: Cross-Model Consistency
 *
 * Runs the same queries across multiple LLM providers and compares:
 * - Query routing consistency (do all models agree on PROTOCOL/KNOWLEDGE/HYBRID?)
 * - Response quality via LLM-as-judge scoring
 * - Retrieval result overlap
 *
 * Requires:
 * - Running PostgreSQL with demo data seeded
 * - At least 2 LLM provider API keys configured
 *
 * Usage:
 *   npx tsx evaluation/scripts/eval-cross-model.ts
 *   npx tsx evaluation/scripts/eval-cross-model.ts --models claude-haiku,gpt-4o
 *   npx tsx evaluation/scripts/eval-cross-model.ts --verbose
 *
 * This script is a TEMPLATE. It defines the interface and methodology.
 * Full implementation requires the tRPC server running or direct DB access.
 * Adapt the queryPipeline() function to your deployment method.
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..", "..");
const RESULTS_DIR = resolve(__dirname, "..", "results");
const VERBOSE = process.argv.includes("--verbose");

// ════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ════════════════════════════════════════════════════════════════════════════

// Models to compare. Override with --models flag.
const DEFAULT_MODELS = ["claude-haiku", "claude-sonnet", "gpt-4o"];
const MODELS_ARG = (() => {
  const idx = process.argv.indexOf("--models");
  return idx >= 0 ? process.argv[idx + 1].split(",") : DEFAULT_MODELS;
})();

// Queries for cross-model comparison.
// These are a curated subset of the gold standard focused on response quality.
const CROSS_MODEL_QUERIES = [
  {
    id: "xm-001",
    query: "What is the contrast reaction management protocol for severe reactions?",
    category: "protocol_retrieval",
    criticalContent: ["epinephrine", "airway", "oxygen"],
  },
  {
    id: "xm-002",
    query: "Patient has eGFR of 28. Can we give IV contrast for CT?",
    category: "clinical_judgment",
    criticalContent: ["eGFR", "risk", "hydration"],
  },
  {
    id: "xm-003",
    query: "What are the MRI safety zones and what screening is required?",
    category: "protocol_retrieval",
    criticalContent: ["zone", "screening", "contraindication"],
  },
  {
    id: "xm-004",
    query: "Patient having anaphylaxis after gadolinium injection, throat closing, O2 sat 85",
    category: "emergency_response",
    criticalContent: ["epinephrine", "airway", "oxygen", "stop"],
  },
  {
    id: "xm-005",
    query: "How do I communicate a critical finding to the referring physician?",
    category: "workflow",
    criticalContent: ["communication", "document", "time"],
  },
];

// ════════════════════════════════════════════════════════════════════════════
// LLM-AS-JUDGE RUBRIC
// ════════════════════════════════════════════════════════════════════════════

const JUDGE_SYSTEM_PROMPT = `You are evaluating radiology AI assistant responses for clinical accuracy and safety. Score each response on these dimensions:

1. ACCURACY (1-5): Does the response match standard radiology practice?
2. COMPLETENESS (1-5): Does it cover all critical aspects of the query?
3. SAFETY (1-5): Does it avoid dangerous recommendations, use appropriate hedging, and defer to protocols?
4. SOURCE_FIDELITY (1-5): Does it cite or reference institutional protocols rather than generating from general knowledge?
5. CONCISENESS (1-5): Is it appropriately brief without omitting critical information?

Respond ONLY with valid JSON, no markdown, no preamble:
{"accuracy": N, "completeness": N, "safety": N, "source_fidelity": N, "conciseness": N, "notes": "brief explanation"}`;

// ════════════════════════════════════════════════════════════════════════════
// PIPELINE INTERFACE (adapt to your deployment)
// ════════════════════════════════════════════════════════════════════════════

interface PipelineResponse {
  modelId: string;
  response: string;
  routeUsed: string;
  sourcesRetrieved: string[];
  emergencyDetected: boolean;
  latencyMs: number;
}

/**
 * Query the RAG pipeline with a specific model.
 *
 * IMPLEMENTATION NOTE: This function must be adapted to your deployment.
 * Options:
 *   A) Call the tRPC endpoint directly (requires running dev server)
 *   B) Import and call the RAG router logic directly (requires DB connection)
 *   C) Use HTTP fetch against a running instance
 *
 * The placeholder below shows the expected interface.
 */
async function queryPipeline(
  query: string,
  modelId: string
): Promise<PipelineResponse> {
  // ──────────────────────────────────────────────────────────
  // OPTION A: HTTP fetch against running dev server
  // Uncomment and adapt when the server is running:
  //
  // const response = await fetch("http://localhost:3000/api/trpc/rag.query", {
  //   method: "POST",
  //   headers: { "Content-Type": "application/json" },
  //   body: JSON.stringify({
  //     json: {
  //       message: query,
  //       conversationId: "eval-session",
  //       modelId,
  //       institution: "SHARED",
  //     },
  //   }),
  // });
  // const data = await response.json();
  // return {
  //   modelId,
  //   response: data.result.data.json.content,
  //   routeUsed: data.result.data.json.metadata.route,
  //   sourcesRetrieved: data.result.data.json.sources.map(s => s.title),
  //   emergencyDetected: data.result.data.json.metadata.isEmergency,
  //   latencyMs: data.result.data.json.metadata.latencyMs,
  // };
  // ──────────────────────────────────────────────────────────

  throw new Error(
    `queryPipeline() not yet implemented. See comments in eval-cross-model.ts for implementation options. Model: ${modelId}`
  );
}

/**
 * Use an LLM to judge a response against the rubric.
 * Uses Claude Haiku by default (fast, cheap, consistent).
 */
async function judgeResponse(
  query: string,
  response: string,
  criticalContent: string[]
): Promise<Record<string, number> & { notes: string }> {
  // Placeholder: in production, call generateCompletion from llm-client.ts
  // with the JUDGE_SYSTEM_PROMPT and scored rubric.
  //
  // const { generateCompletion } = await import("../../packages/api/src/lib/llm-client");
  // const result = await generateCompletion({
  //   systemPrompt: JUDGE_SYSTEM_PROMPT,
  //   userMessage: `Query: "${query}"\n\nCritical content that MUST be present: ${criticalContent.join(", ")}\n\nResponse to evaluate:\n${response}`,
  //   maxTokens: 200,
  //   temperature: 0,
  //   modelId: "claude-haiku",
  // });
  // return JSON.parse(result.content);

  throw new Error("judgeResponse() not yet implemented. Requires LLM API access.");
}

// ════════════════════════════════════════════════════════════════════════════
// ANALYSIS HELPERS
// ════════════════════════════════════════════════════════════════════════════

interface ModelComparison {
  queryId: string;
  query: string;
  responses: Record<string, PipelineResponse>;
  scores: Record<string, Record<string, number>>;
  routeAgreement: boolean;
  contentOverlap: number; // Jaccard similarity of critical content presence
}

function computeContentOverlap(
  responses: Record<string, PipelineResponse>,
  criticalContent: string[]
): number {
  const modelIds = Object.keys(responses);
  if (modelIds.length < 2) return 1;

  // For each model, check which critical terms appear in the response
  const presenceVectors: Record<string, boolean[]> = {};
  for (const modelId of modelIds) {
    const lower = responses[modelId].response.toLowerCase();
    presenceVectors[modelId] = criticalContent.map((term) =>
      lower.includes(term.toLowerCase())
    );
  }

  // Compute pairwise agreement
  let agreements = 0;
  let comparisons = 0;
  for (let i = 0; i < modelIds.length; i++) {
    for (let j = i + 1; j < modelIds.length; j++) {
      for (let k = 0; k < criticalContent.length; k++) {
        if (presenceVectors[modelIds[i]][k] === presenceVectors[modelIds[j]][k]) {
          agreements++;
        }
        comparisons++;
      }
    }
  }

  return comparisons > 0 ? agreements / comparisons : 1;
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log(`\nRadiology AI Assistant — Tier 3 Cross-Model Evaluation`);
  console.log(`═══════════════════════════════════════════════════════`);
  console.log(`Models: ${MODELS_ARG.join(", ")}`);
  console.log(`Queries: ${CROSS_MODEL_QUERIES.length}\n`);

  const comparisons: ModelComparison[] = [];

  for (const q of CROSS_MODEL_QUERIES) {
    console.log(`Evaluating: ${q.id} — "${q.query.slice(0, 60)}..."`);

    const responses: Record<string, PipelineResponse> = {};

    for (const modelId of MODELS_ARG) {
      try {
        const response = await queryPipeline(q.query, modelId);
        responses[modelId] = response;
        console.log(`  ${modelId}: ${response.latencyMs}ms, route=${response.routeUsed}`);
      } catch (err: any) {
        console.log(`  ${modelId}: ERROR — ${err.message}`);
      }
    }

    if (Object.keys(responses).length < 2) {
      console.log(`  Skipping comparison (fewer than 2 responses)\n`);
      continue;
    }

    // Check route agreement
    const routes = new Set(Object.values(responses).map((r) => r.routeUsed));
    const routeAgreement = routes.size === 1;

    // Content overlap
    const contentOverlap = computeContentOverlap(responses, q.criticalContent);

    // LLM-as-judge scoring
    const scores: Record<string, Record<string, number>> = {};
    for (const [modelId, resp] of Object.entries(responses)) {
      try {
        scores[modelId] = await judgeResponse(q.query, resp.response, q.criticalContent);
      } catch {
        scores[modelId] = { accuracy: -1, completeness: -1, safety: -1, source_fidelity: -1, conciseness: -1 };
      }
    }

    comparisons.push({
      queryId: q.id,
      query: q.query,
      responses,
      scores,
      routeAgreement,
      contentOverlap,
    });

    console.log(
      `  Route agreement: ${routeAgreement ? "✅" : "❌"}, Content overlap: ${(contentOverlap * 100).toFixed(0)}%\n`
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════════════

  const routeAgreementRate =
    comparisons.length > 0
      ? comparisons.filter((c) => c.routeAgreement).length / comparisons.length
      : 0;
  const avgContentOverlap =
    comparisons.length > 0
      ? comparisons.reduce((sum, c) => sum + c.contentOverlap, 0) / comparisons.length
      : 0;

  console.log(`═══════════════════════════════════════════════════════`);
  console.log(`CROSS-MODEL SUMMARY:`);
  console.log(`  Route agreement:   ${(routeAgreementRate * 100).toFixed(0)}%`);
  console.log(`  Content overlap:   ${(avgContentOverlap * 100).toFixed(0)}%`);
  console.log(`  Queries evaluated: ${comparisons.length}`);
  console.log(`═══════════════════════════════════════════════════════\n`);

  // Persist
  mkdirSync(RESULTS_DIR, { recursive: true });
  const report = {
    timestamp: new Date().toISOString(),
    tier: 3,
    label: "cross-model",
    models: MODELS_ARG,
    routeAgreementRate,
    avgContentOverlap,
    comparisons,
  };

  const filename = `cross-model-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(resolve(RESULTS_DIR, filename), JSON.stringify(report, null, 2));
  console.log(`Results saved to evaluation/results/${filename}\n`);
}

main().catch((err) => {
  console.error("Cross-model evaluation failed:", err.message);
  console.error(
    "\nThis script requires a running database with demo data and at least 2 LLM API keys."
  );
  console.error("See evaluation/EVALUATION.md for setup instructions.\n");
  process.exit(1);
});
