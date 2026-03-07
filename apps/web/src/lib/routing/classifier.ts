import { URGENCY_KEYWORDS, INTENT_CATEGORIES } from "@rad-assist/shared";

export interface IntentResult {
  intent: (typeof INTENT_CATEGORIES)[number];
  confidence: number;
  subspecialty?: string;
  source: "rule" | "llm" | "fallback";
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasKeywordMatch(input: string, keyword: string): boolean {
  const escaped = escapeRegex(keyword.trim());
  const phrase = escaped.replace(/\s+/g, "[\\s\\-/]+");
  const pattern = new RegExp(`(?:^|[^a-z0-9])${phrase}(?:$|[^a-z0-9])`, "i");
  return pattern.test(input);
}

/**
 * Intent classification for request routing
 */
export function classifyIntent(message: string): IntentResult {
  const lowerMessage = message.toLowerCase();

  // Rule-based urgency detection (high confidence)
  for (const keyword of URGENCY_KEYWORDS.STAT) {
    if (hasKeywordMatch(lowerMessage, keyword)) {
      return {
        intent: "URGENT_STAT",
        confidence: 1.0,
        source: "rule",
      };
    }
  }

  for (const keyword of URGENCY_KEYWORDS.URGENT) {
    if (hasKeywordMatch(lowerMessage, keyword)) {
      // Check for additional context to determine intent
      const intent = determineIntentFromMessage(lowerMessage);
      return {
        intent,
        confidence: 0.9,
        source: "rule",
      };
    }
  }

  // Pattern-based classification
  const patterns = {
    PROTOCOL_QUESTION: [
      /contrast/i,
      /protocol/i,
      /sequence/i,
      /prep/i,
      /allergy/i,
      /dose/i,
      /GFR/i,
      /renal/i,
      /eGFR/i,
    ],
    SPEAK_TO_RADIOLOGIST: [
      /speak to/i,
      /talk to/i,
      /consult/i,
      /discuss/i,
      /call radiologist/i,
      /need.*radiologist/i,
    ],
    SCHEDULE_INQUIRY: [
      /schedule/i,
      /appointment/i,
      /slot/i,
      /available/i,
      /add.?on/i,
      /status/i,
    ],
    ADMINISTRATIVE: [
      /prior.*image/i,
      /outside.*image/i,
      /transfer/i,
      /report/i,
      /result/i,
      /technical/i,
    ],
  };

  for (const [intent, intentPatterns] of Object.entries(patterns)) {
    for (const pattern of intentPatterns) {
      if (pattern.test(lowerMessage)) {
        return {
          intent: intent as (typeof INTENT_CATEGORIES)[number],
          confidence: 0.75,
          subspecialty: extractSubspecialty(lowerMessage),
          source: "rule",
        };
      }
    }
  }

  // Default fallback
  return {
    intent: "ADMINISTRATIVE",
    confidence: 0.5,
    source: "rule",
  };
}

/**
 * LLM-based intent classification prompt
 */
export function getIntentClassificationPrompt(message: string): string {
  return `Classify the following radiology department message into one of these categories:
- PROTOCOL_QUESTION: Questions about imaging protocols, contrast, sequences, prep
- SPEAK_TO_RADIOLOGIST: Request to consult/speak with a radiologist
- SCHEDULE_INQUIRY: Questions about exam status, scheduling, add-ons
- URGENT_STAT: Critical/emergent situations (code stroke, trauma, etc.)
- ADMINISTRATIVE: Technical issues, prior images, reports

Also identify the relevant subspecialty if mentioned:
- ABDOMINAL, NEURO, MSK, CHEST, IR, PEDS, BREAST, NUCLEAR, CARDIAC, EMERGENCY

Message: "${message}"

Respond in JSON format:
{
  "intent": "CATEGORY",
  "confidence": 0.0-1.0,
  "subspecialty": "SUBSPECIALTY or null",
  "reasoning": "brief explanation"
}`;
}

function determineIntentFromMessage(message: string): (typeof INTENT_CATEGORIES)[number] {
  if (/protocol|contrast|sequence|dose/i.test(message)) {
    return "PROTOCOL_QUESTION";
  }
  if (/speak|talk|consult|radiologist/i.test(message)) {
    return "SPEAK_TO_RADIOLOGIST";
  }
  return "URGENT_STAT";
}

function extractSubspecialty(message: string): string | undefined {
  const subspecialtyPatterns: Record<string, RegExp[]> = {
    ABDOMINAL: [/abdomen/i, /abdominal/i, /liver/i, /kidney/i, /GI/i, /bowel/i],
    NEURO: [/brain/i, /neuro/i, /head/i, /spine/i, /stroke/i],
    MSK: [/musculoskeletal/i, /MSK/i, /bone/i, /joint/i, /orthopedic/i],
    CHEST: [/chest/i, /lung/i, /thoracic/i, /pulmonary/i],
    IR: [/interventional/i, /IR /i, /biopsy/i, /drain/i],
    PEDS: [/pediatric/i, /peds/i, /child/i, /infant/i],
    BREAST: [/breast/i, /mammo/i, /mammography/i],
    NUCLEAR: [/nuclear/i, /PET/i, /SPECT/i],
    CARDIAC: [/cardiac/i, /heart/i, /coronary/i],
    EMERGENCY: [/emergency/i, /ED /i, /trauma/i],
  };

  for (const [subspecialty, patterns] of Object.entries(subspecialtyPatterns)) {
    for (const pattern of patterns) {
      if (pattern.test(message)) {
        return subspecialty;
      }
    }
  }

  return undefined;
}

/**
 * Determine routing priority based on classification
 */
export function determinePriority(
  intent: IntentResult
): "STAT" | "URGENT" | "ROUTINE" {
  if (intent.intent === "URGENT_STAT" || intent.confidence === 1.0) {
    return "STAT";
  }

  if (intent.intent === "SPEAK_TO_RADIOLOGIST" && intent.confidence >= 0.8) {
    return "URGENT";
  }

  return "ROUTINE";
}
