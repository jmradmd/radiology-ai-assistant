import type { InterventionRisk } from "./query-analyzer";

export interface ValidationViolation {
  type: "critical" | "warning";
  category:
    | "banned_phrase"
    | "verb_hierarchy"
    | "first_person"
    | "protected_lexicon"
    | "unqualified_invasive"
    | "double_hedge"
    | "defensive_stacking"
    | "medication_prescribing"
    | "disposition_recommendation";
  match: string;
  suggestion?: string;
}

export interface ValidationResult {
  isValid: boolean;
  violations: ValidationViolation[];
  requiresRegeneration: boolean;
}

interface ValidationContext {
  interventionRisk: InterventionRisk;
  severity: string;
  branch: string;
}

const FIRST_PERSON_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bi['’]d\s+favor\b/i, label: "I'd favor" },
  { pattern: /\bi\s+think\b/i, label: "I think" },
  { pattern: /\bi\s+would\s+recommend\b/i, label: "I would recommend" },
  { pattern: /\bi['’]d\s+suggest\b/i, label: "I'd suggest" },
  { pattern: /\bin\s+my\s+opinion\b/i, label: "in my opinion" },
  { pattern: /\bi\s+believe\b/i, label: "I believe" },
  { pattern: /\bmy\s+recommendation\b/i, label: "my recommendation" },
  { pattern: /\bi['’]d\s+lean\s+toward\b/i, label: "I'd lean toward" },
];

const BANNED_RECOMMENDATION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  {
    // Exclude "suggestive of" to avoid false positive.
    pattern: /\bsuggest(?:ed|s|ing)?\b(?!\s+of)/i,
    label: "suggest",
  },
  { pattern: /\bmay\s+benefit\s+from\b/i, label: "may benefit from" },
  { pattern: /\bmight\s+want\s+to\b/i, label: "might want to" },
  { pattern: /\bcould\s+potentially\b/i, label: "could potentially" },
];

const PROTECTED_LEXICON_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /(?<!(?:dose|appointment)\s)\bmissed\b/i, label: "missed" },
  { pattern: /\boverlooked\b/i, label: "overlooked" },
  { pattern: /(?<!(?:measurement|margin of|standard)\s)\berror\b/i, label: "error" },
  { pattern: /\bmistake\b/i, label: "mistake" },
  { pattern: /\bfailed\s+to\s+identify\b/i, label: "failed to identify" },
  { pattern: /\bobvious(?:ly)?\s+present\b/i, label: "obvious/obviously present" },
  { pattern: /\bshould\s+have\s+been\s+seen\b/i, label: "should have been seen" },
  { pattern: /\bunfortunately\b/i, label: "unfortunately" },
];

const DOUBLE_HEDGE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bpossibly\s+suggestive\s+of\b/i, label: "possibly suggestive of" },
  { pattern: /\bmay\s+potentially\b/i, label: "may potentially" },
  { pattern: /\bmight\s+possibly\b/i, label: "might possibly" },
  { pattern: /\bcould\s+potentially\s+suggest\b/i, label: "could potentially suggest" },
];

// Medication prescribing: verbs + dose units suggesting direct medication recommendations
const MEDICATION_PRESCRIBING_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(?:administer|give|inject)\b.{0,40}\b(?:\d+\s*(?:mg|mcg|ml|units|g)\b)/i, label: "medication dosing recommendation" },
  { pattern: /\bprescribe\b/i, label: "prescribe" },
  { pattern: /\bstart\b.{0,30}\b(?:drip|infusion|bolus)\b/i, label: "start drip/infusion" },
  { pattern: /\b(?:administer|give)\b.{0,40}\b(?:epinephrine|epi|atropine|adenosine|amiodarone|dopamine|norepinephrine|vasopressin|heparin|tpa|alteplase)\b/i, label: "direct medication administration" },
];

// Disposition language suggesting triage/admission/discharge decisions
const DISPOSITION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\badmit\s+(?:the\s+)?patient\b/i, label: "admit the patient" },
  { pattern: /\badmit\s+to\b/i, label: "admit to" },
  { pattern: /\bdischarge\s+(?:the\s+)?patient\b/i, label: "discharge the patient" },
  { pattern: /\bsend\s+(?:the\s+patient\s+)?to\s+(?:the\s+)?(?:ED|ER|emergency)\b/i, label: "send to ED" },
  { pattern: /\btransfer\s+(?:the\s+patient\s+)?to\s+(?:the\s+)?(?:ICU|MICU|SICU|CCU|PICU|NICU)\b/i, label: "transfer to ICU" },
];

const INVASIVE_TERM_PATTERN =
  /\b(biopsy|fna|fine[-\s]?needle|aspirat(?:e|ion)|drain(?:age)?|emboliz(?:e|ation)|ablat(?:e|ion)|resection|surgery|procedure|core needle|excision)\b/i;

const INVASIVE_QUALIFIER_PATTERN =
  /\b(consider|can be obtained|further characteri[sz]ation|non-invasive|mri|ultrasound|follow-up imaging)\b/i;

function countCommaSeparatedItems(segment: string): number {
  return segment
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean).length;
}

export function validateResponse(response: string, context: ValidationContext): ValidationResult {
  const violations: ValidationViolation[] = [];
  const normalized = response.trim();

  for (const { pattern, label } of FIRST_PERSON_PATTERNS) {
    if (!pattern.test(normalized)) continue;
    violations.push({
      type: "critical",
      category: "first_person",
      match: label,
      suggestion: "Use neutral peer-radiologist language with no first-person phrasing.",
    });
  }

  for (const { pattern, label } of BANNED_RECOMMENDATION_PATTERNS) {
    if (!pattern.test(normalized)) continue;
    violations.push({
      type: "warning",
      category: "verb_hierarchy",
      match: label,
      suggestion: "Use governance verb hierarchy: is recommended / consider / can be obtained.",
    });
  }

  for (const { pattern, label } of PROTECTED_LEXICON_PATTERNS) {
    if (!pattern.test(normalized)) continue;
    violations.push({
      type: "warning",
      category: "protected_lexicon",
      match: label,
      suggestion: "Use protected medico-legal alternatives (for example, retrospectively visible).",
    });
  }

  for (const { pattern, label } of DOUBLE_HEDGE_PATTERNS) {
    if (!pattern.test(normalized)) continue;
    violations.push({
      type: "warning",
      category: "double_hedge",
      match: label,
      suggestion: "Use a single calibrated hedge, not stacked qualifiers.",
    });
  }

  if (context.interventionRisk.level === "invasive" && INVASIVE_TERM_PATTERN.test(normalized)) {
    const hasQualifier = INVASIVE_QUALIFIER_PATTERN.test(normalized);
    if (!hasQualifier) {
      violations.push({
        type: "critical",
        category: "unqualified_invasive",
        match: "invasive recommendation without staged/qualified alternative",
        suggestion:
          "Provide staged logic with non-invasive options and criteria for escalation to invasive action.",
      });
    }
  }

  const defensiveStackingMatch = normalized.match(
    /\bdifferential(?:\s+diagnosis|\s+considerations)?\s+(?:includes?|are)\s+([^.\n]+)/i
  );
  if (defensiveStackingMatch) {
    const count = countCommaSeparatedItems(defensiveStackingMatch[1]);
    if (count >= 5) {
      violations.push({
        type: "warning",
        category: "defensive_stacking",
        match: defensiveStackingMatch[0].slice(0, 120),
        suggestion: "Prefer 2-3 realistic alternatives or state indeterminate with next step.",
      });
    }
  }

  // Medication prescribing check (only warn outside emergency context)
  if (context.severity !== "emergency" && context.severity !== "urgent") {
    for (const { pattern, label } of MEDICATION_PRESCRIBING_PATTERNS) {
      if (!pattern.test(normalized)) continue;
      violations.push({
        type: "warning",
        category: "medication_prescribing",
        match: label,
        suggestion:
          "The assistant does not prescribe medications or doses outside emergency protocol context. Reference the protocol source instead.",
      });
    }
  }

  // Disposition recommendation check (all contexts)
  for (const { pattern, label } of DISPOSITION_PATTERNS) {
    if (!pattern.test(normalized)) continue;
    violations.push({
      type: "warning",
      category: "disposition_recommendation",
      match: label,
      suggestion:
        "The assistant does not make disposition or triage decisions. Defer to clinical judgment.",
    });
  }

  const criticalCount = violations.filter((v) => v.type === "critical").length;
  const requiresRegeneration = criticalCount >= 2;

  return {
    isValid: violations.length === 0,
    violations,
    requiresRegeneration,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// CITATION VALIDATION (local-model source-card prompting)
// ════════════════════════════════════════════════════════════════════════════════

export interface CitationValidationResult {
  valid: boolean;
  invalidCitations: string[];
  missingCitations: boolean;
  citationsFound: string[];
}

const CITATION_PATTERN = /\[S(\d+)\]/g;
const REFUSAL_MARKERS = [
  "I do not find this in the provided sources",
  "I cannot answer that from the provided sources",
  "No source card addresses",
  "No source card directly addresses",
];

export function validateCitations(
  response: string,
  allowedHandles: string[]
): CitationValidationResult {
  const matches = [...response.matchAll(CITATION_PATTERN)].map((m) => m[0]);
  const citationsFound = [...new Set(matches)];

  const allowedSet = new Set(allowedHandles.map((h) => `[${h}]`));
  const invalidCitations = citationsFound.filter((c) => !allowedSet.has(c));

  // Extract the Answer section (between "Answer:" and next slot header or end).
  const answerSection = response.match(
    /Answer:\s*\n?([\s\S]*?)(?=\n\s*(?:Evidence|Limits)\s*:|$)/i
  );
  const answerBody = answerSection ? answerSection[1].trim() : "";
  const hasAnswerContent = answerBody.length > 0;
  const hasRefusal = REFUSAL_MARKERS.some((marker) =>
    response.toLowerCase().includes(marker.toLowerCase())
  );

  const missingCitations = hasAnswerContent && !hasRefusal && citationsFound.length === 0;

  return {
    valid: invalidCitations.length === 0 && !missingCitations,
    invalidCitations,
    missingCitations,
    citationsFound,
  };
}
