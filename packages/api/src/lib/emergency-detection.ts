/**
 * Emergency Detection Utility
 * 
 * Analyzes user messages to detect emergency/urgent clinical scenarios.
 * This is critical for patient safety - emergency scenarios get:
 * - Direct, action-oriented language
 * - Higher priority in response
 * - More verbose protocol content
 */

import { RAG_CONFIG } from './rag-config';

export interface EmergencyAssessment {
  isEmergency: boolean;
  severity: 'routine' | 'urgent' | 'emergency';
  triggers: string[];
  escalators: string[];
  numericAlerts: string[];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasKeywordMatch(input: string, keyword: string): boolean {
  const escaped = escapeRegex(keyword.trim());
  // Match whole words/phrases only to avoid false positives like "geSTATional".
  const phrase = escaped.replace(/\s+/g, "[\\s\\-/]+");
  const pattern = new RegExp(`(?:^|[^a-z0-9])${phrase}(?:$|[^a-z0-9])`, "i");
  return pattern.test(input);
}

/**
 * Assess if a message describes an emergency clinical scenario
 */
export function assessEmergency(message: string): EmergencyAssessment {
  const lower = message.toLowerCase();
  
  const triggers: string[] = [];
  const escalators: string[] = [];
  const numericAlerts: string[] = [];
  
  // Check for emergency keywords
  for (const keyword of RAG_CONFIG.EMERGENCY_KEYWORDS) {
    if (hasKeywordMatch(lower, keyword.toLowerCase())) {
      triggers.push(keyword);
    }
  }
  
  // Check for severity escalators
  for (const escalator of RAG_CONFIG.SEVERITY_ESCALATORS) {
    if (hasKeywordMatch(lower, escalator.toLowerCase())) {
      escalators.push(escalator);
    }
  }
  
  // Check for numeric thresholds
  // O2 sat patterns: "sat 88", "o2 88", "spo2 88%", "oxygen 88"
  const o2Patterns = [
    /(?:oxygen\s*saturation|o2\s*saturation|sat(?:uration)?|spo2|o2|oxygen)[:\s]+(?:is\s+)?(?:at\s+|of\s+)?(\d{2})%?/gi,
    /(\d{2})%?\s*(?:oxygen\s*saturation|o2\s*saturation|sat(?:uration)?|spo2|o2|oxygen)/gi,
    /(?:sat|spo2|o2|oxygen)\s+(?:dropped?|went|fell|down)\s+(?:to\s+)?(\d{2})/gi,
  ];
  
  for (const pattern of o2Patterns) {
    const matches = Array.from(message.matchAll(pattern));
    for (const match of matches) {
      const o2Value = parseInt(match[1]);
      if (o2Value >= 50 && o2Value < RAG_CONFIG.CRITICAL_THRESHOLDS.O2_SAT_LOW) {
        numericAlerts.push(`O2 sat ${o2Value}% (critical: <${RAG_CONFIG.CRITICAL_THRESHOLDS.O2_SAT_LOW}%)`);
      }
    }
  }
  
  // BP patterns: "bp 85/50", "blood pressure 70/40"
  const bpPatterns = [
    /(?:bp|blood\s*pressure)[:\s]+(?:is\s+)?(\d{2,3})\/(\d{2,3})/gi,
    /(\d{2,3})\/(\d{2,3})\s*(?:bp|blood\s*pressure|mmhg)/gi,
  ];
  
  for (const pattern of bpPatterns) {
    const matches = Array.from(message.matchAll(pattern));
    for (const match of matches) {
      const systolic = parseInt(match[1]);
      const diastolic = parseInt(match[2]);
      // Basic validation - systolic should be higher than diastolic
      if (systolic > diastolic && systolic < RAG_CONFIG.CRITICAL_THRESHOLDS.BP_SYSTOLIC_LOW) {
        numericAlerts.push(`BP ${systolic}/${diastolic} (critical: systolic <${RAG_CONFIG.CRITICAL_THRESHOLDS.BP_SYSTOLIC_LOW})`);
      }
    }
  }
  
  // HR patterns: "HR 180", "pulse 35", "heart rate 180", "hr 35 bpm"
  const hrPatterns = [
    /(?:heart\s*rate|hr|pulse)[:\s]+(?:is\s+)?(?:at\s+|of\s+)?(\d{2,3})\s*(?:bpm)?/gi,
    /(\d{2,3})\s*bpm\b/gi,
    /(?:heart\s*rate|hr|pulse)\s+(?:dropped?|went|rose|increased|spiked)\s+(?:to\s+)?(\d{2,3})/gi,
  ];

  for (const pattern of hrPatterns) {
    const matches = Array.from(message.matchAll(pattern));
    for (const match of matches) {
      const hrValue = parseInt(match[1]);
      // Plausibility guard: HR must be 20-250 to be a valid heart rate
      if (hrValue >= 20 && hrValue <= 250) {
        if (hrValue > RAG_CONFIG.CRITICAL_THRESHOLDS.HR_HIGH) {
          numericAlerts.push(`HR ${hrValue} bpm (critical: >${RAG_CONFIG.CRITICAL_THRESHOLDS.HR_HIGH} bpm)`);
        } else if (hrValue < RAG_CONFIG.CRITICAL_THRESHOLDS.HR_LOW) {
          numericAlerts.push(`HR ${hrValue} bpm (critical: <${RAG_CONFIG.CRITICAL_THRESHOLDS.HR_LOW} bpm)`);
        }
      }
    }
  }

  // Determine severity
  let severity: 'routine' | 'urgent' | 'emergency' = 'routine';
  
  // High-severity keywords that immediately indicate emergency
  const highSeverityKeywords = [
    'anaphylaxis', 'anaphylactic', 'code', 'unresponsive',
    'cardiac arrest', 'can\'t breathe', 'throat closing',
    'airway', 'stridor', 'crashing', 'shock',
    'pulseless', 'apnea', 'not breathing', 'tension pneumothorax',
    'status epilepticus', 'hemorrhage', 'exsanguinating',
  ];
  
  const hasHighSeverity = highSeverityKeywords.some((kw) => hasKeywordMatch(lower, kw));
  
  if (triggers.length > 0 || numericAlerts.length > 0) {
    severity = 'urgent';
    
    // Escalate to emergency if:
    // - Multiple triggers present
    // - Escalators present (symptoms progressing/not responding to treatment)
    // - High-severity keywords
    // - Critical numeric values
    const shouldEscalate = 
      triggers.length >= 2 || 
      escalators.length > 0 || 
      hasHighSeverity ||
      numericAlerts.length > 0;
    
    if (shouldEscalate) {
      severity = 'emergency';
    }
  }
  
  return {
    isEmergency: severity === 'emergency',
    severity,
    triggers,
    escalators,
    numericAlerts,
  };
}

/**
 * Get a severity label for display
 */
export function getSeverityLabel(assessment: EmergencyAssessment): string {
  switch (assessment.severity) {
    case 'emergency':
      return '🚨 EMERGENCY';
    case 'urgent':
      return '⚠️ URGENT';
    default:
      return 'Routine';
  }
}
