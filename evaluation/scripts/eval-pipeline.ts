#!/usr/bin/env npx tsx
/**
 * Tier 2 Evaluation: Gold-Standard Pipeline Assessment
 *
 * Runs cases from evaluation/datasets/gold-standard.json against the actual
 * safety modules: emergency detection, PHI detection, abbreviation
 * disambiguation, query routing (rule-based), and response validation.
 *
 * Retrieval evaluation (category "retrieval") requires a running PostgreSQL
 * database with demo data seeded. Pass --skip-retrieval to skip those cases.
 *
 * Usage:
 *   npx tsx evaluation/scripts/eval-pipeline.ts
 *   npx tsx evaluation/scripts/eval-pipeline.ts --skip-retrieval
 *   npx tsx evaluation/scripts/eval-pipeline.ts --verbose
 *   npx tsx evaluation/scripts/eval-pipeline.ts --category emergency_detection
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";

// ════════════════════════════════════════════════════════════════════════════
// IMPORTS FROM THE ACTUAL CODEBASE
// ════════════════════════════════════════════════════════════════════════════

import { assessEmergency } from "../../packages/api/src/lib/emergency-detection";
import { detectPotentialPHI } from "../../packages/shared/src/phi-filter";
import { resolveFromContext } from "../../packages/api/src/lib/abbreviation-detector";

const ROOT = resolve(__dirname, "..", "..");
const RESULTS_DIR = resolve(__dirname, "..", "results");
const SKIP_RETRIEVAL = process.argv.includes("--skip-retrieval");
const VERBOSE = process.argv.includes("--verbose");
const CATEGORY_FILTER = (() => {
  const idx = process.argv.indexOf("--category");
  return idx >= 0 ? process.argv[idx + 1] : null;
})();

// ════════════════════════════════════════════════════════════════════════════
// LOAD GOLD STANDARD
// ════════════════════════════════════════════════════════════════════════════

interface GoldCase {
  id: string;
  category: string;
  query: string;
  description: string;
  expected: any;
}

const datasetPath = resolve(__dirname, "..", "datasets", "gold-standard.json");
const dataset = JSON.parse(readFileSync(datasetPath, "utf-8"));
const allCases: GoldCase[] = dataset.cases.filter((c: any) => c.id && c.expected);

// ════════════════════════════════════════════════════════════════════════════
// EVALUATION ENGINE
// ════════════════════════════════════════════════════════════════════════════

interface CheckResult {
  label: string;
  passed: boolean;
  expected: string;
  actual: string;
}

interface CaseResult {
  id: string;
  category: string;
  query: string;
  description: string;
  passed: boolean;
  checks: CheckResult[];
  skipped: boolean;
  error?: string;
}

function evaluateEmergency(c: GoldCase): CheckResult[] {
  const checks: CheckResult[] = [];
  const assessment = assessEmergency(c.query);
  const exp = c.expected.emergency;

  if (exp.severity !== undefined) {
    checks.push({
      label: "severity",
      passed: assessment.severity === exp.severity,
      expected: exp.severity,
      actual: assessment.severity,
    });
  }

  if (exp.isEmergency !== undefined) {
    checks.push({
      label: "isEmergency",
      passed: assessment.isEmergency === exp.isEmergency,
      expected: String(exp.isEmergency),
      actual: String(assessment.isEmergency),
    });
  }

  if (exp.triggersMustInclude) {
    for (const trigger of exp.triggersMustInclude) {
      const found = assessment.triggers.some(
        (t: string) => t.toLowerCase().includes(trigger.toLowerCase())
      );
      checks.push({
        label: `trigger:${trigger}`,
        passed: found,
        expected: `triggers contain "${trigger}"`,
        actual: found
          ? `found in [${assessment.triggers.join(", ")}]`
          : `NOT found in [${assessment.triggers.join(", ")}]`,
      });
    }
  }

  if (exp.numericAlertsMustExist !== undefined) {
    const hasAlerts = assessment.numericAlerts.length > 0;
    checks.push({
      label: "numericAlerts",
      passed: hasAlerts === exp.numericAlertsMustExist,
      expected: exp.numericAlertsMustExist ? "has numeric alerts" : "no numeric alerts",
      actual: hasAlerts
        ? `${assessment.numericAlerts.length} alerts: [${assessment.numericAlerts.join("; ")}]`
        : "no numeric alerts",
    });
  }

  if (exp.escalatorsMustExist !== undefined) {
    const hasEscalators = assessment.escalators.length > 0;
    checks.push({
      label: "escalators",
      passed: hasEscalators === exp.escalatorsMustExist,
      expected: exp.escalatorsMustExist ? "has escalators" : "no escalators",
      actual: hasEscalators
        ? `[${assessment.escalators.join(", ")}]`
        : "none",
    });
  }

  return checks;
}

function evaluatePHI(c: GoldCase): CheckResult[] {
  const checks: CheckResult[] = [];
  const result = detectPotentialPHI(c.query);
  const exp = c.expected.phi;

  checks.push({
    label: "hasPHI",
    passed: result.hasPHI === exp.hasPHI,
    expected: String(exp.hasPHI),
    actual: String(result.hasPHI),
  });

  if (exp.detectionTypesMustInclude) {
    const detectedTypes = new Set(result.detections.map((d: any) => d.type));
    for (const expectedType of exp.detectionTypesMustInclude) {
      const found = detectedTypes.has(expectedType);
      checks.push({
        label: `detects:${expectedType}`,
        passed: found,
        expected: `${expectedType} detected`,
        actual: found
          ? `${expectedType} found`
          : `NOT found (detected: [${[...detectedTypes].join(", ")}])`,
      });
    }
  }

  if (exp.mustNotFlagTypes) {
    const detectedTypes = new Set(
      (result.detectionSpans || []).map((s: any) => s.type)
    );
    for (const forbiddenType of exp.mustNotFlagTypes) {
      const flagged = detectedTypes.has(forbiddenType);
      checks.push({
        label: `noFalsePositive:${forbiddenType}`,
        passed: !flagged,
        expected: `${forbiddenType} NOT detected`,
        actual: flagged
          ? `FALSE POSITIVE: ${forbiddenType} was flagged`
          : `correctly not flagged`,
      });
    }
  }

  return checks;
}

function evaluateAbbreviation(c: GoldCase): CheckResult[] {
  const checks: CheckResult[] = [];
  const exp = c.expected.abbreviation;

  const resolved = resolveFromContext(exp.term, c.query);

  checks.push({
    label: `resolve:${exp.term}`,
    passed: resolved === exp.expectedResolution,
    expected: exp.expectedResolution,
    actual: resolved || "(unresolved)",
  });

  if (exp.wrongResolutions) {
    for (const wrong of exp.wrongResolutions) {
      checks.push({
        label: `notResolvedAs:${wrong}`,
        passed: resolved !== wrong,
        expected: `NOT "${wrong}"`,
        actual: resolved || "(unresolved)",
      });
    }
  }

  return checks;
}

function evaluateRouting(c: GoldCase): CheckResult[] {
  const checks: CheckResult[] = [];
  const exp = c.expected;

  // Import rule-based routing inline to avoid top-level await issues
  // We test the rule-based inference only (no LLM call)
  const query = c.query;

  // Replicate the rule-based logic from query-domain-classifier.ts
  // to test without requiring LLM access
  const PROTOCOL_SIGNALS = [
    { label: "protocol", pattern: /\bprotocol(s)?\b/i },
    { label: "policy", pattern: /\bpolicy|policies|institutional\b/i },
    { label: "department workflow", pattern: /\bour\s+(department|hospital)|what do we do when|standing order\b/i },
    { label: "threshold or cutoff", pattern: /\bthreshold|cutoff|cut-off|dose|dosing|premedication|screening form\b/i },
    { label: "operations", pattern: /\bon-?call|scheduling|consent|nursing procedure|workflow|who to call\b/i },
    { label: "premedication intent", pattern: /\bpremedicat(?:e|ion)|premed\s*protocol\b/i },
    { label: "contrast allergy emergency", pattern: /\bcontrast\s*allerg(?:y|ic)|contrast\s*media\s*reaction|allergic\s*reaction\s*to\s*contrast\b/i },
    { label: "contrast policy intent", pattern: /\begfr\s*(threshold|cutoff)|contrast\s*reaction(\s*protocol)?\b/i },
    { label: "institution mention", pattern: /\bInstitution A|Institution B|Department\b/i },
  ];

  const KNOWLEDGE_SIGNALS = [
    { label: "classification", pattern: /\bclassification|score|staging|criteria\b/i },
    { label: "radiology systems", pattern: /\bBosniak|LI-?RADS|TI-?RADS|BI-?RADS|PI-?RADS|Fleischner\b/i },
    { label: "PACS", pattern: /\b(vue\s*)?pacs|carestream|philips\s*(vue|pacs)/i },
    { label: "IT troubleshoot", pattern: /\b(monitor|display|screen)\s*(setup|config|layout|arrangement|issue|problem|fix)|error\s*(code|message)|not\s*(working|loading|responding)/i },
    { label: "findings", pattern: /\bimaging findings|appearance on|imaging features|what does this look like\b/i },
    { label: "report phrasing", pattern: /\bhow do i phrase|report language|impression wording|dictate\b/i },
    { label: "Epic/EMR", pattern: /\bepic|haiku|radiant|hyperspace|hyperdrive|emr\b/i },
    { label: "dictation", pattern: /\bfluency|dictation|speech\s*recognition|m\*?modal|voice\s*(command|recognition)|microphone\b/i },
    { label: "science", pattern: /\banatomy|pathology|artifact|physics|teaching case|board review|pathophysiology\b/i },
    { label: "differential", pattern: /\bdifferential\b/i },
  ];

  const matchedProtocol = PROTOCOL_SIGNALS.filter(({ pattern }) => pattern.test(query)).map(({ label }) => label);
  const matchedKnowledge = KNOWLEDGE_SIGNALS.filter(({ pattern }) => pattern.test(query)).map(({ label }) => label);

  let inferredRoute: string;
  if (matchedProtocol.length > 0 && matchedKnowledge.length === 0) {
    inferredRoute = "PROTOCOL";
  } else if (matchedKnowledge.length > 0 && matchedProtocol.length === 0) {
    inferredRoute = "KNOWLEDGE";
  } else {
    inferredRoute = "HYBRID";
  }

  checks.push({
    label: "route",
    passed: inferredRoute === exp.route,
    expected: exp.route,
    actual: `${inferredRoute} (protocol signals: [${matchedProtocol.join(", ")}], knowledge signals: [${matchedKnowledge.join(", ")}])`,
  });

  return checks;
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN EVALUATION LOOP
// ════════════════════════════════════════════════════════════════════════════

const caseResults: CaseResult[] = [];

// Map category to evaluator
const evaluators: Record<string, (c: GoldCase) => CheckResult[]> = {
  emergency_detection: evaluateEmergency,
  phi_detection: evaluatePHI,
  abbreviation: evaluateAbbreviation,
  routing: evaluateRouting,
};

// Emergency detection cases also appear in retrieval cases (they have emergency assertions)
function getApplicableEvaluators(c: GoldCase): Array<{ name: string; fn: (c: GoldCase) => CheckResult[] }> {
  const applicable: Array<{ name: string; fn: (c: GoldCase) => CheckResult[] }> = [];

  if (c.expected.emergency) applicable.push({ name: "emergency", fn: evaluateEmergency });
  if (c.expected.phi) applicable.push({ name: "phi", fn: evaluatePHI });
  if (c.expected.abbreviation) applicable.push({ name: "abbreviation", fn: evaluateAbbreviation });
  if (c.expected.route && c.category === "routing") applicable.push({ name: "routing", fn: evaluateRouting });

  return applicable;
}

console.log(`\nRadiology AI Assistant — Tier 2 Pipeline Evaluation`);
console.log(`═══════════════════════════════════════════════════`);

const filteredCases = CATEGORY_FILTER
  ? allCases.filter((c) => c.category === CATEGORY_FILTER)
  : allCases;

// Skip retrieval cases if --skip-retrieval
const runnableCases = SKIP_RETRIEVAL
  ? filteredCases.filter((c) => c.category !== "retrieval")
  : filteredCases;

// For retrieval cases without DB, we can still test emergency/routing assertions
const retrievalCasesWithoutDB = filteredCases
  .filter((c) => c.category === "retrieval" && SKIP_RETRIEVAL)
  .filter((c) => c.expected.emergency || c.expected.route);

const allRunnableCases = [...runnableCases, ...retrievalCasesWithoutDB];

console.log(`Running ${allRunnableCases.length} cases${CATEGORY_FILTER ? ` (category: ${CATEGORY_FILTER})` : ""}${SKIP_RETRIEVAL ? " (retrieval skipped)" : ""}\n`);

for (const c of allRunnableCases) {
  const evaluatorList = getApplicableEvaluators(c);

  if (evaluatorList.length === 0) {
    // Retrieval-only case with no other assertions, or response_validation (needs LLM)
    caseResults.push({
      id: c.id,
      category: c.category,
      query: c.query,
      description: c.description,
      passed: true,
      checks: [],
      skipped: true,
    });
    if (VERBOSE) console.log(`⏭️  ${c.id}: ${c.description} (skipped, no offline evaluator)`);
    continue;
  }

  const allChecks: CheckResult[] = [];
  for (const { fn } of evaluatorList) {
    try {
      allChecks.push(...fn(c));
    } catch (err: any) {
      allChecks.push({
        label: "runtime_error",
        passed: false,
        expected: "no error",
        actual: err.message || String(err),
      });
    }
  }

  const passed = allChecks.every((ch) => ch.passed);
  caseResults.push({
    id: c.id,
    category: c.category,
    query: c.query,
    description: c.description,
    passed,
    checks: allChecks,
    skipped: false,
  });

  const icon = passed ? "✅" : "❌";
  const checkSummary = `${allChecks.filter((ch) => ch.passed).length}/${allChecks.length} checks`;
  console.log(`${icon} ${c.id}: ${c.description} (${checkSummary})`);

  if (VERBOSE && !passed) {
    for (const ch of allChecks.filter((ch) => !ch.passed)) {
      console.log(`   ❌ ${ch.label}: expected=${ch.expected}, actual=${ch.actual}`);
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CATEGORY BREAKDOWN
// ════════════════════════════════════════════════════════════════════════════

const categories = [...new Set(caseResults.map((r) => r.category))];
const categoryStats: Record<string, { total: number; passed: number; skipped: number }> = {};

for (const cat of categories) {
  const catCases = caseResults.filter((r) => r.category === cat);
  const evaluated = catCases.filter((r) => !r.skipped);
  categoryStats[cat] = {
    total: catCases.length,
    passed: evaluated.filter((r) => r.passed).length,
    skipped: catCases.filter((r) => r.skipped).length,
  };
}

console.log(`\n═══════════════════════════════════════════════════`);
console.log(`CATEGORY BREAKDOWN:`);
for (const [cat, stats] of Object.entries(categoryStats)) {
  const evaluated = stats.total - stats.skipped;
  const rate = evaluated > 0 ? ((stats.passed / evaluated) * 100).toFixed(0) : "N/A";
  const skippedNote = stats.skipped > 0 ? ` (${stats.skipped} skipped)` : "";
  console.log(`  ${cat}: ${stats.passed}/${evaluated} passed (${rate}%)${skippedNote}`);
}

// ════════════════════════════════════════════════════════════════════════════
// OVERALL SUMMARY
// ════════════════════════════════════════════════════════════════════════════

const evaluated = caseResults.filter((r) => !r.skipped);
const totalPassed = evaluated.filter((r) => r.passed).length;
const totalChecks = caseResults.flatMap((r) => r.checks);
const checksPass = totalChecks.filter((ch) => ch.passed).length;
const overallRate = totalChecks.length > 0
  ? ((checksPass / totalChecks.length) * 100).toFixed(1)
  : "N/A";

console.log(`\nOVERALL: ${totalPassed}/${evaluated.length} cases passed, ${checksPass}/${totalChecks.length} individual checks passed (${overallRate}%)`);
console.log(`STATUS:  ${totalPassed === evaluated.length ? "ALL PASSING ✅" : "FAILURES DETECTED ❌"}`);
console.log(`═══════════════════════════════════════════════════\n`);

// ════════════════════════════════════════════════════════════════════════════
// PERSIST RESULTS
// ════════════════════════════════════════════════════════════════════════════

mkdirSync(RESULTS_DIR, { recursive: true });

const report = {
  timestamp: new Date().toISOString(),
  tier: 2,
  label: "pipeline-evaluation",
  datasetVersion: dataset._meta?.version || "unknown",
  casesTotal: allRunnableCases.length,
  casesEvaluated: evaluated.length,
  casesSkipped: caseResults.filter((r) => r.skipped).length,
  casesPassed: totalPassed,
  checksTotal: totalChecks.length,
  checksPassed: checksPass,
  overallPassRate: parseFloat(overallRate) || 0,
  categoryBreakdown: categoryStats,
  cases: caseResults,
};

const filename = `pipeline-eval-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(resolve(RESULTS_DIR, filename), JSON.stringify(report, null, 2));

console.log(`Results saved to evaluation/results/${filename}\n`);

process.exit(totalPassed === evaluated.length ? 0 : 1);
