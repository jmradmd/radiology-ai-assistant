import { generateCompletion } from "./llm-client";

export type QueryDomainRoute = "PROTOCOL" | "KNOWLEDGE" | "HYBRID";

export interface QueryDomainClassification {
  route: QueryDomainRoute;
  usedLlmFallback: boolean;
  matchedProtocolSignals: string[];
  matchedKnowledgeSignals: string[];
}

const PROTOCOL_SIGNAL_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "protocol", pattern: /\bprotocol(s)?\b/i },
  { label: "policy", pattern: /\bpolicy|policies|institutional\b/i },
  { label: "department workflow", pattern: /\bour\s+(department|hospital)|what do we do when|standing order\b/i },
  { label: "threshold or cutoff", pattern: /\bthreshold|cutoff|cut-off|dose|dosing|premedication|screening form\b/i },
  { label: "operations", pattern: /\bon-?call|scheduling|consent|nursing procedure|workflow|who to call\b/i },
  { label: "directory contact", pattern: /\bphone\s*(number|#)|contact\s*(number|info|information)|directory|who\s*(do\s*i|should\s*i|to)\s*call\b/i },
  {
    label: "discrepancy communication",
    pattern:
      /\b(discrepanc(?:y|ies)|interval\s+change|compared?\s+to\s+prior|prior\s+(ct|mri|ultrasound|exam|study)|critical\s+results?\s+communication|communication\s+policy|addendum)\b/i,
  },
  { label: "institution mention", pattern: /\bInstitution A|Institution B|Department\b/i },
  { label: "contrast policy intent", pattern: /\begfr\s*(threshold|cutoff)|contrast\s*reaction(\s*protocol)?\b/i },
  { label: "anaphylaxis emergency", pattern: /\banaphylaxis|anaphylactic\b/i },
  { label: "contrast allergy emergency", pattern: /\bcontrast\s*allerg(?:y|ic)|contrast\s*media\s*reaction|allergic\s*reaction\s*to\s*contrast\b/i },
  { label: "extravasation emergency", pattern: /\bextravasation\b/i },
  { label: "contrast-induced kidney injury", pattern: /\bcontrast[-\s]*induced\b.*\b(nephropathy|aki|acute\s*kidney\s*injury)\b|\b(nephropathy|aki|acute\s*kidney\s*injury)\b.*\bcontrast[-\s]*induced\b/i },
  { label: "premedication intent", pattern: /\bpremedicat(?:e|ion)|premed\s*protocol\b/i },
  {
    label: "clinical code response intent",
    pattern: /\b(?:code|rapid\s*response)\b.*\b(?:contrast|anaphylaxis|anaphylactic|allergy|allergic|extravasation|reaction)\b|\b(?:contrast|anaphylaxis|anaphylactic|allergy|allergic|extravasation|reaction)\b.*\b(?:code|rapid\s*response)\b/i,
  },
];

const KNOWLEDGE_SIGNAL_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "differential", pattern: /\bdifferential\b/i },
  { label: "classification", pattern: /\bclassification|score|staging|criteria\b/i },
  { label: "report phrasing", pattern: /\bhow do i phrase|report language|impression wording|dictate\b/i },
  { label: "findings", pattern: /\bimaging findings|appearance on|imaging features|what does this look like\b/i },
  { label: "radiology systems", pattern: /\bBosniak|LI-?RADS|TI-?RADS|BI-?RADS|PI-?RADS|Fleischner\b/i },
  { label: "science", pattern: /\banatomy|pathology|artifact|physics|teaching case|board review\b/i },
  // IT systems troubleshooting
  { label: "PACS", pattern: /\b(vue\s*)?pacs|carestream|philips\s*(vue|pacs)/i },
  { label: "Epic/EMR", pattern: /\bepic|haiku|radiant|hyperspace|hyperdrive|emr\b/i },
  { label: "dictation", pattern: /\bfluency|dictation|speech\s*recognition|m\*?modal|voice\s*(command|recognition)|microphone|dictate\b/i },
  { label: "Medicalis", pattern: /\bmedicalis|worklist|siemens\s*(healthineers)?\b/i },
  { label: "IT troubleshoot", pattern: /\b(monitor|display|screen)\s*(setup|config|layout|arrangement|issue|problem|fix)|multi[\s-]?monitor|dual[\s-]?monitor|hanging\s*protocol|black\s*screen|won'?t\s*(load|open|start|connect|display)|frozen|crash|error\s*(code|message)|login\s*(issue|problem|fail)|can'?t\s*(log\s*in|connect|access)|not\s*(working|loading|responding|connecting|displaying)/i },
  { label: "IT systems", pattern: /\bdowntime|vpn|citrix|remote\s*desktop|thin\s*client|workstation\b/i },
  { label: "IT contact", pattern: /\b(it|i\.?t\.?)\s*(service\s*desk|help\s*desk|support|hotline|number|phone)|\bservice\s*desk|help\s*desk\b/i },
];

const CLASSIFIER_SYSTEM_PROMPT =
  "You are a query router for a radiology department assistant. Classify the query into exactly one label: PROTOCOL, KNOWLEDGE, or HYBRID.";

/** Detect if a query is primarily about IT systems (PACS, Epic, dictation, workstation) */
export function isITQuery(query: string): boolean {
  return KNOWLEDGE_SIGNAL_PATTERNS
    .filter(p => ["PACS", "Epic/EMR", "dictation", "Medicalis", "IT troubleshoot", "IT systems", "IT contact"].includes(p.label))
    .some(({ pattern }) => pattern.test(query));
}

function inferFromRules(query: string) {
  const matchedProtocolSignals = PROTOCOL_SIGNAL_PATTERNS.filter(({ pattern }) => pattern.test(query)).map(
    ({ label }) => label
  );
  const matchedKnowledgeSignals = KNOWLEDGE_SIGNAL_PATTERNS.filter(({ pattern }) => pattern.test(query)).map(
    ({ label }) => label
  );

  const hasDiscrepancyCommunicationSignal = matchedProtocolSignals.includes("discrepancy communication");
  const hasReportPhrasingSignal = matchedKnowledgeSignals.includes("report phrasing");

  // Report-language questions tied to interval/discrepancy communication usually require
  // both institution policy and phrasing support; force HYBRID to avoid unstable routing.
  if (hasDiscrepancyCommunicationSignal && hasReportPhrasingSignal) {
    return { route: "HYBRID" as const, matchedProtocolSignals, matchedKnowledgeSignals, ambiguous: false };
  }

  if (matchedProtocolSignals.length > 0 && matchedKnowledgeSignals.length === 0) {
    return { route: "PROTOCOL" as const, matchedProtocolSignals, matchedKnowledgeSignals, ambiguous: false };
  }
  if (matchedKnowledgeSignals.length > 0 && matchedProtocolSignals.length === 0) {
    return { route: "KNOWLEDGE" as const, matchedProtocolSignals, matchedKnowledgeSignals, ambiguous: false };
  }

  return { route: "HYBRID" as const, matchedProtocolSignals, matchedKnowledgeSignals, ambiguous: true };
}

async function inferFromLlm(query: string): Promise<QueryDomainRoute> {
  const result = await generateCompletion({
    systemPrompt: CLASSIFIER_SYSTEM_PROMPT,
    userMessage: `You are a query router for a radiology department assistant. Classify this query into one of three categories:

PROTOCOL — institutional policy, department procedures, specific thresholds or doses at the user's hospital, admin processes, or workflow guidance.
KNOWLEDGE — clinical radiology knowledge, imaging findings, differentials, report phrasing, classification systems, anatomy, pathology, teaching, OR IT systems troubleshooting (PACS, Epic, dictation, workstation, monitor setup, error codes, connectivity issues).
HYBRID — the query needs both institutional protocols and clinical knowledge.

Query: "${query}"

Respond with exactly one word: PROTOCOL, KNOWLEDGE, or HYBRID.`,
    maxTokens: 12,
    temperature: 0,
    modelId: "claude-haiku",
  });

  const normalized = result.content.trim().toUpperCase();
  if (normalized.includes("PROTOCOL")) return "PROTOCOL";
  if (normalized.includes("KNOWLEDGE")) return "KNOWLEDGE";
  return "HYBRID";
}

export async function classifyQueryDomain(query: string): Promise<QueryDomainClassification> {
  const rules = inferFromRules(query);
  if (!rules.ambiguous) {
    return {
      route: rules.route,
      usedLlmFallback: false,
      matchedProtocolSignals: rules.matchedProtocolSignals,
      matchedKnowledgeSignals: rules.matchedKnowledgeSignals,
    };
  }

  try {
    const llmRoute = await inferFromLlm(query);
    return {
      route: llmRoute,
      usedLlmFallback: true,
      matchedProtocolSignals: rules.matchedProtocolSignals,
      matchedKnowledgeSignals: rules.matchedKnowledgeSignals,
    };
  } catch {
    return {
      route: "HYBRID",
      usedLlmFallback: true,
      matchedProtocolSignals: rules.matchedProtocolSignals,
      matchedKnowledgeSignals: rules.matchedKnowledgeSignals,
    };
  }
}
