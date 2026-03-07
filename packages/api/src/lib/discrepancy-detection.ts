/**
 * Discrepancy Detection Module
 * 
 * Detects clinically significant differences between Institution A and Institution B protocols.
 * Uses a two-tier approach:
 * 1. Quick regex-based detection for common patterns
 * 2. LLM-based analysis for nuanced comparison
 */

import type {
  DiscrepancyType,
  Institution,
} from "@rad-assist/shared";
import { DEFAULT_MODEL_ID } from "@rad-assist/shared";

// ==================== RESULT TYPES ====================
// These types are defined locally since they are only used by this module.

interface DiscrepancyDetectionResult {
  hasDiscrepancy: boolean;
  type: DiscrepancyType | null;
  summary: string | null;
  confidence: number;
  institutionAKeyPoints: string[];
  institutionBKeyPoints: string[];
}

interface QuickDiscrepancyCheckResult {
  likely: boolean;
  signals: string[];
}

// ==================== TYPES ====================

interface DocumentResult {
  content: string;
  title: string;
  institution: string | null;
  similarity: number;
}

interface DetectDiscrepancyParams {
  query: string;
  institutionAResults: DocumentResult[];
  institutionBResults: DocumentResult[];
}

// ==================== LLM PROMPT ====================

const DISCREPANCY_DETECTION_PROMPT = `You are a clinical protocol analyst. Your job is to compare medical protocols from two institutions and identify any discrepancies that could affect patient care.

Given protocols from Institution A (Primary Hospital) and Institution B (Department), analyze them for differences in:
1. DOSING - Different drug amounts (e.g., 50mg vs 32mg)
2. TIMING - Different schedules or intervals (e.g., 13/7/1 hr vs 12/2 hr)
3. DRUG - Different medications for same indication (e.g., Prednisone vs Methylprednisolone)
4. THRESHOLD - Different cutoff values (e.g., eGFR <30 vs eGFR <45)
5. PROCEDURE - Different steps or workflow
6. CONTRAINDICATION - Different exclusion criteria

IMPORTANT: Minor wording differences are NOT discrepancies. Only flag differences that would change clinical decision-making.

Respond ONLY with valid JSON in this exact format:
{
  "hasDiscrepancy": true,
  "type": "DOSING",
  "summary": "Brief description of the key difference",
  "confidence": 0.85,
  "institutionAKeyPoints": ["key point 1", "key point 2"],
  "institutionBKeyPoints": ["key point 1", "key point 2"]
}

If no clinically significant discrepancy exists:
{
  "hasDiscrepancy": false,
  "type": null,
  "summary": null,
  "confidence": 0.95,
  "institutionAKeyPoints": [],
  "institutionBKeyPoints": []
}`;

// ==================== QUICK DETECTION PATTERNS ====================

/**
 * Drug patterns for quick detection
 * Maps drug names to their category for comparison
 */
const DRUG_PATTERNS: Array<{ pattern: RegExp; name: string; category: string }> = [
  // Corticosteroids
  { pattern: /prednisone/i, name: "prednisone", category: "corticosteroid" },
  { pattern: /methylprednisolone|medrol|solu-medrol/i, name: "methylprednisolone", category: "corticosteroid" },
  { pattern: /hydrocortisone/i, name: "hydrocortisone", category: "corticosteroid" },
  { pattern: /dexamethasone/i, name: "dexamethasone", category: "corticosteroid" },
  
  // Antihistamines
  { pattern: /diphenhydramine|benadryl/i, name: "diphenhydramine", category: "antihistamine" },
  { pattern: /cetirizine|zyrtec/i, name: "cetirizine", category: "antihistamine" },
  { pattern: /loratadine|claritin/i, name: "loratadine", category: "antihistamine" },
  
  // H2 blockers
  { pattern: /famotidine|pepcid/i, name: "famotidine", category: "h2_blocker" },
  { pattern: /ranitidine|zantac/i, name: "ranitidine", category: "h2_blocker" },
  
  // Emergency meds
  { pattern: /epinephrine|epi\b|adrenaline/i, name: "epinephrine", category: "emergency" },
  { pattern: /atropine/i, name: "atropine", category: "emergency" },
  
  // Sedation
  { pattern: /propofol/i, name: "propofol", category: "sedation" },
  { pattern: /ketamine/i, name: "ketamine", category: "sedation" },
  { pattern: /midazolam|versed/i, name: "midazolam", category: "sedation" },
  { pattern: /fentanyl/i, name: "fentanyl", category: "sedation" },
  
  // Contrast agents
  { pattern: /gadolinium|gd-/i, name: "gadolinium", category: "contrast" },
  { pattern: /iohexol|omnipaque/i, name: "iohexol", category: "contrast" },
  { pattern: /iopamidol|isovue/i, name: "iopamidol", category: "contrast" },
];

/**
 * Timing patterns to detect (hours before/after procedures)
 */
const TIMING_PATTERNS = [
  /(\d+)\s*(?:hours?|hr|hrs)\s*(?:before|prior|pre)/gi,
  /(\d+)\s*(?:hours?|hr|hrs)\s*(?:after|post)/gi,
  /(\d+)\s*(?:minutes?|min|mins)\s*(?:before|prior|pre)/gi,
];

/**
 * Threshold patterns (eGFR, age, weight, etc.)
 */
const THRESHOLD_PATTERNS = [
  /egfr\s*[<>≤≥]?\s*(\d+)/gi,
  /gfr\s*[<>≤≥]?\s*(\d+)/gi,
  /creatinine\s*[<>≤≥]?\s*([\d.]+)/gi,
  /age\s*[<>≤≥]?\s*(\d+)/gi,
  /weight\s*[<>≤≥]?\s*(\d+)/gi,
  /bmi\s*[<>≤≥]?\s*(\d+)/gi,
];

/**
 * Dose patterns (mg, ml, mcg, etc.)
 */
const DOSE_PATTERNS = [
  /(\d+(?:\.\d+)?)\s*(?:mg|milligrams?)/gi,
  /(\d+(?:\.\d+)?)\s*(?:ml|mL|milliliters?)/gi,
  /(\d+(?:\.\d+)?)\s*(?:mcg|micrograms?)/gi,
  /(\d+(?:\.\d+)?)\s*(?:units?|IU)/gi,
];

// ==================== QUICK DETECTION ====================

/**
 * Performs fast regex-based detection for common discrepancy patterns.
 * Run this before expensive LLM calls to determine if detailed analysis is needed.
 */
export function quickDiscrepancyCheck(
  institutionAContent: string,
  institutionBContent: string
): QuickDiscrepancyCheckResult {
  const signals: string[] = [];

  // 1. Check for different drugs in the same category
  const institutionADrugs = new Map<string, string[]>();
  const institutionBDrugs = new Map<string, string[]>();

  for (const drug of DRUG_PATTERNS) {
    if (drug.pattern.test(institutionAContent)) {
      const existing = institutionADrugs.get(drug.category) || [];
      existing.push(drug.name);
      institutionADrugs.set(drug.category, existing);
    }
    if (drug.pattern.test(institutionBContent)) {
      const existing = institutionBDrugs.get(drug.category) || [];
      existing.push(drug.name);
      institutionBDrugs.set(drug.category, existing);
    }
  }

  // Check for same-category drugs with different names
  for (const [category, institutionADrugList] of institutionADrugs) {
    const institutionBDrugList = institutionBDrugs.get(category);
    if (institutionBDrugList) {
      // Both have drugs in this category - check if they differ
      const institutionASet = new Set(institutionADrugList);
      const institutionBSet = new Set(institutionBDrugList);
      
      // If the drug sets don't overlap, that's a potential discrepancy
      const hasOverlap = [...institutionASet].some(d => institutionBSet.has(d));
      if (!hasOverlap) {
        signals.push(`Different ${category}: Institution A uses ${[...institutionASet].join(", ")}, Institution B uses ${[...institutionBSet].join(", ")}`);
      }
    }
  }

  // 2. Check for different doses (same number with mg/ml/etc)
  const institutionADoses = extractPatternValues(institutionAContent, DOSE_PATTERNS);
  const institutionBDoses = extractPatternValues(institutionBContent, DOSE_PATTERNS);
  
  // Find doses that appear in one but not the other
  const institutionAOnlyDoses = institutionADoses.filter(d => !institutionBDoses.includes(d));
  const institutionBOnlyDoses = institutionBDoses.filter(d => !institutionADoses.includes(d));
  
  if (institutionAOnlyDoses.length > 0 && institutionBOnlyDoses.length > 0) {
    signals.push(`Different doses: Institution A has ${institutionAOnlyDoses.join(", ")}, Institution B has ${institutionBOnlyDoses.join(", ")}`);
  }

  // 3. Check for different timing
  const institutionATiming = extractPatternValues(institutionAContent, TIMING_PATTERNS);
  const institutionBTiming = extractPatternValues(institutionBContent, TIMING_PATTERNS);
  
  if (institutionATiming.length > 0 && institutionBTiming.length > 0) {
    const institutionATimingSet = new Set(institutionATiming);
    const institutionBTimingSet = new Set(institutionBTiming);
    
    const hasTimingOverlap = [...institutionATimingSet].some(t => institutionBTimingSet.has(t));
    if (!hasTimingOverlap) {
      signals.push(`Different timing: Institution A ${[...institutionATimingSet].join(", ")}, Institution B ${[...institutionBTimingSet].join(", ")}`);
    }
  }

  // 4. Check for different thresholds (eGFR, age, etc.)
  const institutionAThresholds = extractThresholds(institutionAContent);
  const institutionBThresholds = extractThresholds(institutionBContent);
  
  for (const [metric, institutionAValues] of Object.entries(institutionAThresholds)) {
    const institutionBValues = institutionBThresholds[metric];
    if (institutionBValues && institutionBValues.length > 0 && institutionAValues.length > 0) {
      // Check if any values differ
      const institutionASet = new Set(institutionAValues);
      const institutionBSet = new Set(institutionBValues);
      const hasOverlap = [...institutionASet].some(v => institutionBSet.has(v));
      
      if (!hasOverlap) {
        signals.push(`Different ${metric} threshold: Institution A=${institutionAValues.join(",")}, Institution B=${institutionBValues.join(",")}`);
      }
    }
  }

  return {
    likely: signals.length > 0,
    signals,
  };
}

/**
 * Extract values matching patterns from content
 */
function extractPatternValues(content: string, patterns: RegExp[]): string[] {
  const values: string[] = [];
  
  for (const pattern of patterns) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    
    let match;
    while ((match = pattern.exec(content)) !== null) {
      if (match[0]) {
        values.push(match[0].toLowerCase().replace(/\s+/g, ""));
      }
    }
  }
  
  return [...new Set(values)];
}

/**
 * Extract threshold values by metric type
 */
function extractThresholds(content: string): Record<string, string[]> {
  const thresholds: Record<string, string[]> = {};
  
  for (const pattern of THRESHOLD_PATTERNS) {
    pattern.lastIndex = 0;
    
    let match;
    while ((match = pattern.exec(content)) !== null) {
      // Determine metric from match
      const fullMatch = match[0].toLowerCase();
      let metric = "unknown";
      
      if (fullMatch.includes("egfr") || fullMatch.includes("gfr")) {
        metric = "eGFR";
      } else if (fullMatch.includes("creatinine")) {
        metric = "creatinine";
      } else if (fullMatch.includes("age")) {
        metric = "age";
      } else if (fullMatch.includes("weight")) {
        metric = "weight";
      } else if (fullMatch.includes("bmi")) {
        metric = "BMI";
      }
      
      if (!thresholds[metric]) {
        thresholds[metric] = [];
      }
      
      if (match[1]) {
        thresholds[metric].push(match[1]);
      }
    }
  }
  
  return thresholds;
}

// ==================== LLM-BASED DETECTION ====================

/**
 * Performs LLM-based discrepancy detection.
 * Only call this after quickDiscrepancyCheck signals potential differences.
 * 
 * @param generateCompletion - Function to call LLM (injected to avoid circular deps)
 */
export async function detectDiscrepancy(
  params: DetectDiscrepancyParams,
  generateCompletion: (params: {
    model: string;
    systemPrompt: string;
    userMessage: string;
    maxTokens?: number;
  }) => Promise<{ content: string; model: string; provider: string }>
): Promise<DiscrepancyDetectionResult> {
  const { query, institutionAResults, institutionBResults } = params;

  // If either institution has no results, no discrepancy possible
  if (institutionAResults.length === 0 || institutionBResults.length === 0) {
    return {
      hasDiscrepancy: false,
      type: null,
      summary: null,
      confidence: 1.0,
      institutionAKeyPoints: [],
      institutionBKeyPoints: [],
    };
  }

  // Build context from both institutions
  const institutionAContext = institutionAResults
    .map((r) => `[${r.title}]\n${r.content}`)
    .join("\n\n---\n\n");

  const institutionBContext = institutionBResults
    .map((r) => `[${r.title}]\n${r.content}`)
    .join("\n\n---\n\n");

  const userMessage = `Clinical Question: ${query}

## Institution A Protocols:
${institutionAContext}

## Institution B Protocols:
${institutionBContext}

Analyze these protocols for clinically significant discrepancies. Respond with JSON only.`;

  try {
    const response = await generateCompletion({
      model: DEFAULT_MODEL_ID,
      systemPrompt: DISCREPANCY_DETECTION_PROMPT,
      userMessage,
      maxTokens: 1000,
    });

    // Extract JSON from response
    const text = response.content;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as DiscrepancyDetectionResult;
      
      // Validate the parsed result
      if (typeof parsed.hasDiscrepancy === "boolean") {
        return {
          hasDiscrepancy: parsed.hasDiscrepancy,
          type: parsed.type || null,
          summary: parsed.summary || null,
          confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
          institutionAKeyPoints: Array.isArray(parsed.institutionAKeyPoints) ? parsed.institutionAKeyPoints : [],
          institutionBKeyPoints: Array.isArray(parsed.institutionBKeyPoints) ? parsed.institutionBKeyPoints : [],
        };
      }
    }
  } catch (error) {
    console.error("Failed to parse discrepancy response:", error);
  }

  // Default: no discrepancy detected
  return {
    hasDiscrepancy: false,
    type: null,
    summary: null,
    confidence: 0.5,
    institutionAKeyPoints: [],
    institutionBKeyPoints: [],
  };
}

// ==================== COMBINED DETECTION ====================

/**
 * Performs full discrepancy detection using both quick check and LLM analysis.
 * 
 * Flow:
 * 1. Run quick check on combined content
 * 2. If signals found, run LLM analysis
 * 3. Return result with confidence
 */
export async function detectInstitutionalDiscrepancy(
  params: DetectDiscrepancyParams,
  generateCompletion: (params: {
    model: string;
    systemPrompt: string;
    userMessage: string;
    maxTokens?: number;
  }) => Promise<{ content: string; model: string; provider: string }>
): Promise<DiscrepancyDetectionResult> {
  const { institutionAResults, institutionBResults } = params;

  // Combine content for quick check
  const institutionAContent = institutionAResults.map((r) => r.content).join("\n\n");
  const institutionBContent = institutionBResults.map((r) => r.content).join("\n\n");

  // Step 1: Quick check
  const quickResult = quickDiscrepancyCheck(institutionAContent, institutionBContent);

  // If no signals, return early
  if (!quickResult.likely) {
    return {
      hasDiscrepancy: false,
      type: null,
      summary: null,
      confidence: 0.9, // High confidence there's no discrepancy
      institutionAKeyPoints: [],
      institutionBKeyPoints: [],
    };
  }

  // Step 2: LLM analysis for confirmed detection
  const llmResult = await detectDiscrepancy(params, generateCompletion);

  // Boost confidence if quick check and LLM agree
  if (llmResult.hasDiscrepancy && quickResult.signals.length > 0) {
    llmResult.confidence = Math.min(1.0, llmResult.confidence + 0.1);
  }

  return llmResult;
}

// ==================== EXPORTS ====================

export type { DetectDiscrepancyParams, DocumentResult };
