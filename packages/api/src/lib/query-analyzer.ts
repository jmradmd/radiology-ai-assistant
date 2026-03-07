/**
 * LLM-Based Query Analyzer
 * 
 * Uses the LLM to intelligently analyze queries instead of hardcoded keywords.
 * The model understands medical context, abbreviations, and intent far better
 * than any static keyword list.
 */

import { generateCompletion } from './llm-client';

export type InterventionRiskLevel =
  | 'none'
  | 'observation'
  | 'imaging'
  | 'invasive'
  | 'medication';

export interface InterventionRisk {
  level: InterventionRiskLevel;
  detected: boolean;
  triggers: string[];
  isInterventionDecision: boolean;
}

export interface QueryAnalysis {
  // Is this a protocol/policy question?
  isProtocolQuestion: boolean;
  
  // Detected topic area (if any)
  detectedTopic: {
    id: string;
    label: string;
    category: string;
    confidence: number;
  } | null;
  
  // Alternative topics that might be relevant
  alternativeTopics: Array<{
    id: string;
    label: string;
    category: string;
  }>;
  
  // Does the query need clarification?
  needsClarification: boolean;
  clarificationReason?: string;
  
  // Ambiguous terms that could mean multiple things
  ambiguousTerms: Array<{
    term: string;
    possibleMeanings: string[];
    contextSuggestion?: string; // What context suggests it means
  }>;
  
  // Expanded query with abbreviations resolved
  expandedQuery: string;
  
  // Is this an emergency/urgent query?
  isUrgent: boolean;
  urgencyIndicators: string[];

  // Intervention recommendation risk profile (rule-based for speed/determinism)
  interventionRisk: InterventionRisk;
  isInterventionDecision: boolean;
  
  // Raw reasoning from the model
  reasoning: string;
}

export interface AnalyzeQueryOptions {
  conversationContext?: string;
  priorUserMessage?: string;
  priorAssistantMessage?: string;
}

const ANALYSIS_SYSTEM_PROMPT = `You are a medical query analyzer for a radiology department protocol assistant. Your job is to analyze incoming queries and determine:

1. **Is this a protocol question?** - Is the user asking about hospital policies, imaging protocols, contrast guidelines, safety procedures, etc.?

2. **What topic area?** - Classify into one of these categories:
   - CONTRAST: Contrast media, reactions, premedication, extravasation
   - RENAL: eGFR, creatinine, kidney function, dialysis, contrast nephropathy
   - MRI_SAFETY: MRI screening, implants, pacemakers, gadolinium
   - CT_PROTOCOL: CT protocols, CTA, cardiac CT, stroke imaging, PE studies
   - PEDIATRIC: Pediatric-specific protocols
   - PREGNANCY: Imaging during pregnancy, breastfeeding
   - NURSING: IV access, power injection, nursing procedures
   - MAMMO: Mammography, breast imaging
   - SAFETY: Radiation safety, general safety protocols
   - CRITICAL: Critical results, emergency protocols
   - MEDICATION: Sedation, premedication
   - WORKFLOW: Scheduling, add-ons, patient flow

3. **Any ambiguous terms?** - Medical abbreviations or terms that could mean multiple things:
   - CVA: cerebrovascular accident vs costovertebral angle
   - PE: pulmonary embolism vs physical exam vs pleural effusion
   - MS: multiple sclerosis vs mitral stenosis vs morphine sulfate
   - EGFR: glomerular filtration rate vs epidermal growth factor receptor
   - etc.

4. **Should we clarify?** - Only ask for clarification when:
   - The ambiguity could lead to giving wrong information
   - Context doesn't make the meaning clear
   - Multiple valid interpretations exist
   
   Do NOT ask for clarification when:
   - Context makes the meaning obvious (e.g., "stroke" + "CVA" = cerebrovascular accident)
   - The term is unambiguous in radiology context
   - Clarification wouldn't change the answer

5. **Is this urgent?** - Look for emergency indicators like contrast reactions, code situations, critical findings.

Respond in JSON format only.`;

const INVASIVE_PATTERNS: RegExp[] = [
  /\bbiopsy\b/i,
  /\bfna\b/i,
  /\bfine[\s-]?needle\b/i,
  /\baspirat(?:e|ion)\b/i,
  /\bdrain(?:age)?\b/i,
  /\bemboliz(?:e|ation)\b/i,
  /\bablat(?:e|ion)\b/i,
  /\bresection\b/i,
  /\bsurger(?:y|ical)\b/i,
  /\bprocedure\b/i,
  /\btissue\s+sampling\b/i,
  /\bcore\s+needle\b/i,
  /\bexcision\b/i,
];

const MEDICATION_PATTERNS: RegExp[] = [
  /\badminister\b/i,
  /\bprescrib(?:e|ing)\b/i,
  /\bgive\b.{0,30}\b(mg|mcg|ml|dose|dosing|drug|medication)\b/i,
  /\binject(?:ion)?\b/i,
  /\bdos(?:e|ing)\b/i,
  /\bmedication\b/i,
  /\bmedication\s+management\b/i,
];

const IMAGING_PATTERNS: RegExp[] = [
  /\bfollow[\s-]?up\s+imaging\b/i,
  /\bsurveillance\b/i,
  /\brepeat\s+(?:scan|ct|mri|ultrasound|us)\b/i,
  /\bfurther\s+characteri[sz]ation\b/i,
  /\bmri\s+follow[\s-]?up\b/i,
  /\bct\s+follow[\s-]?up\b/i,
  /\bultrasound\s+follow[\s-]?up\b/i,
];

const OBSERVATION_PATTERNS: RegExp[] = [
  /\bwatch(?:ful)?\s+wait(?:ing)?\b/i,
  /\bobserve\b/i,
  /\bmonitor\b/i,
  /\bconservative\s+management\b/i,
  /\bno\s+follow[\s-]?up\s+needed\b/i,
];

const DECISION_PATTERNS: RegExp[] = [
  /\bshould\s+i\b.{0,80}\b(or|vs\.?|versus)\b/i,
  /\bbiopsy\b.{0,80}\b(or|vs\.?|versus)\b/i,
  /\bis\b.{0,60}\b(warranted|indicated)\b/i,
  /\b(decide|decision)\b.{0,40}\bbetween\b/i,
  /\b(?:would\s+you|do\s+you)\b.{0,60}\b(?:biopsy|drain|resect|aspirate|embolize|ablate)\b/i,
  /\bdo\s+(?:i|we)\s+need\s+to\b.{0,60}\b(?:biopsy|drain|resect|aspirate)\b/i,
  /\b(?:recommend|favor)\b.{0,60}\bover\b/i,
  /\bis\s+(?:a\s+)?(?:biopsy|procedure|surgery|fna)\s+(?:necessary|needed)\b/i,
];

function collectPatternTriggers(
  text: string,
  patterns: RegExp[],
  category: string
): string[] {
  const triggers = new Set<string>();
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const value = match[0].trim().slice(0, 60);
    if (value) {
      triggers.add(`${category}:${value}`);
    }
  }
  return [...triggers];
}

export function assessInterventionRisk(
  query: string,
  conversationContext?: string
): InterventionRisk {
  const combinedText = `${query} ${conversationContext || ''}`.trim();

  const invasiveTriggers = collectPatternTriggers(combinedText, INVASIVE_PATTERNS, 'invasive');
  const medicationTriggers = collectPatternTriggers(combinedText, MEDICATION_PATTERNS, 'medication');
  const imagingTriggers = collectPatternTriggers(combinedText, IMAGING_PATTERNS, 'imaging');
  const observationTriggers = collectPatternTriggers(combinedText, OBSERVATION_PATTERNS, 'observation');
  const decisionTriggers = collectPatternTriggers(combinedText, DECISION_PATTERNS, 'decision');

  const hasInvasive = invasiveTriggers.length > 0;
  const hasMedication = medicationTriggers.length > 0;
  const hasImaging = imagingTriggers.length > 0;
  const hasObservation = observationTriggers.length > 0;
  const hasDecisionPattern = decisionTriggers.length > 0;
  const isInterventionDecision = hasInvasive && hasDecisionPattern;

  let level: InterventionRiskLevel = 'none';
  if (hasInvasive) {
    level = 'invasive';
  } else if (hasMedication) {
    level = 'medication';
  } else if (hasImaging) {
    level = 'imaging';
  } else if (hasObservation) {
    level = 'observation';
  }

  return {
    level,
    detected: level !== 'none',
    triggers: [
      ...invasiveTriggers,
      ...medicationTriggers,
      ...imagingTriggers,
      ...observationTriggers,
      ...decisionTriggers,
    ],
    isInterventionDecision,
  };
}

function buildAnalysisUserPrompt(query: string, options?: AnalyzeQueryOptions): string {
  const sections: string[] = [
    `Analyze this radiology query:\n\n"${query}"`,
  ];

  const priorUser = options?.priorUserMessage?.trim();
  const priorAssistant = options?.priorAssistantMessage?.trim();
  const conversationContext = options?.conversationContext?.trim();

  if (priorUser || priorAssistant || conversationContext) {
    const contextLines: string[] = [
      `Prior context is provided to resolve short or follow-up questions. Use it only when relevant.`,
    ];

    if (priorUser) {
      contextLines.push(`Most recent user question: "${priorUser.slice(0, 400)}"`);
    }
    if (priorAssistant) {
      contextLines.push(`Most recent assistant answer: "${priorAssistant.slice(0, 400)}"`);
    }
    if (conversationContext) {
      contextLines.push(`Recent conversation history:\n${conversationContext.slice(0, 1800)}`);
    }

    sections.push(contextLines.join("\n"));
  }

  sections.push(`Respond with JSON only (no markdown):
{
  "isProtocolQuestion": boolean,
  "detectedTopic": { "id": string, "label": string, "category": string, "confidence": number } | null,
  "alternativeTopics": [{ "id": string, "label": string, "category": string }],
  "needsClarification": boolean,
  "clarificationReason": string | null,
  "ambiguousTerms": [{ "term": string, "possibleMeanings": string[], "contextSuggestion": string | null }],
  "expandedQuery": string,
  "isUrgent": boolean,
  "urgencyIndicators": string[],
  "interventionRisk": { "level": "none" | "observation" | "imaging" | "invasive" | "medication", "detected": boolean, "triggers": string[], "isInterventionDecision": boolean },
  "isInterventionDecision": boolean,
  "reasoning": string
}`);

  return sections.join("\n\n");
}

/**
 * Analyze a query using the LLM
 */
export async function analyzeQuery(query: string, options?: AnalyzeQueryOptions): Promise<QueryAnalysis> {
  const interventionRisk = assessInterventionRisk(query, options?.conversationContext);

  try {
    const result = await generateCompletion({
      systemPrompt: ANALYSIS_SYSTEM_PROMPT,
      userMessage: buildAnalysisUserPrompt(query, options),
      maxTokens: 1024,
      temperature: 0.1, // Low temperature for consistent analysis
    });
    
    // Parse JSON response (strip markdown code blocks if present)
    let jsonText = result.content.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }
    
    const rawAnalysis = JSON.parse(jsonText) as Partial<QueryAnalysis>;
    
    console.log(`[QueryAnalyzer] Analysis completed using ${result.provider}/${result.model}`);

    return {
      isProtocolQuestion: rawAnalysis.isProtocolQuestion ?? true,
      detectedTopic: rawAnalysis.detectedTopic ?? null,
      alternativeTopics: rawAnalysis.alternativeTopics ?? [],
      needsClarification: rawAnalysis.needsClarification ?? false,
      clarificationReason: rawAnalysis.clarificationReason,
      ambiguousTerms: rawAnalysis.ambiguousTerms ?? [],
      expandedQuery: rawAnalysis.expandedQuery ?? query,
      isUrgent: rawAnalysis.isUrgent ?? false,
      urgencyIndicators: rawAnalysis.urgencyIndicators ?? [],
      interventionRisk,
      isInterventionDecision: interventionRisk.isInterventionDecision,
      reasoning: rawAnalysis.reasoning ?? 'Analysis completed',
    };
  } catch (error) {
    console.error('Query analysis failed:', error);
    
    // Return safe defaults on failure - don't block the query
    // For invasive queries, default to requesting clarification since
    // proceeding without context on invasive decisions poses patient safety risk.
    const safeClarification = interventionRisk.level === 'invasive';
    return {
      isProtocolQuestion: true, // Assume yes to be safe
      detectedTopic: null,
      alternativeTopics: [],
      needsClarification: safeClarification,
      clarificationReason: safeClarification
        ? 'Query analysis unavailable; clarification requested for invasive-level query as a safety precaution.'
        : undefined,
      ambiguousTerms: [],
      expandedQuery: query,
      isUrgent: false,
      urgencyIndicators: [],
      interventionRisk,
      isInterventionDecision: interventionRisk.isInterventionDecision,
      reasoning: safeClarification
        ? 'Analysis failed; requesting clarification for invasive-level query'
        : 'Analysis failed, proceeding with original query',
    };
  }
}

/**
 * Quick check if query likely needs analysis
 * (to avoid LLM call for simple queries)
 */
export function shouldAnalyzeQuery(query: string): boolean {
  // Always analyze if query contains potential medical abbreviations
  // This is a lightweight pre-filter, not the actual analysis
  const hasUppercaseWords = /\b[A-Z]{2,}\b/.test(query);
  const hasMedicalContext = /\b(patient|contrast|scan|ct|mri|protocol|dose|injection|imaging)\b/i.test(query);
  const isQuestion = /\?|what|how|when|where|which|can|should|do i|is there/i.test(query);
  
  return hasUppercaseWords || hasMedicalContext || isQuestion;
}
