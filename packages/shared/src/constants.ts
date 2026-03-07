import type { Institution, Domain, DocumentTier, Subspecialty } from "./types";
import type { UserRole, ShiftType } from "./schemas";

export const TEAMS_STANDARD_DOCS_SOURCE_COLLECTION = "teams_abdominal";

export const TEAMS_TIER_MAP: Record<DocumentTier, string[]> = {
  reference: [
    "reference",
    "guideline",
    "standard",
    "dept standard",
    "departmental",
    "policy",
  ],
  clinical: [
    "protocol",
    "clinical",
    "workflow",
    "procedure",
    "operation",
    "practical",
  ],
  educational: [
    "education",
    "training",
    "learning",
    "lecture",
    "module",
    "artifact",
    "overview",
  ],
};

export const TEAMS_COLLECTION_CONFIG = {
  TEAMS_STANDARD_DOCS: {
    collectionName: TEAMS_STANDARD_DOCS_SOURCE_COLLECTION,
    sourceFolder: "teams_standard_docs",
    allowedTiers: ["reference", "clinical", "educational"] as DocumentTier[],
    defaultTier: "clinical" as DocumentTier,
  },
} as const;

// ============================================
// INSTITUTION CONFIGURATION
// ============================================

export const INSTITUTION_CONFIG = {
  INSTITUTION_A: {
    id: "INSTITUTION_A" as Institution,
    displayName: "Primary Hospital",
    shortName: "HOSP_A",
    description: "Hospital-wide policies and procedures",
    sourceFolder: "institution-a-policies", // EXACT case-sensitive folder name
    // Visual styling
    colors: {
      primary: "#1E40AF", // Blue-700
      background: "#DBEAFE", // Blue-100
      border: "#3B82F6", // Blue-500
      text: "#1E3A8A", // Blue-900
    },
    icon: "Building2", // Lucide icon name
    badgeVariant: "default" as const,
  },
  INSTITUTION_B: {
    id: "INSTITUTION_B" as Institution,
    displayName: "Department / Subspecialty",
    shortName: "DEPT",
    description: "Department-specific protocols",
    sourceFolder: "institution-b-policies", // EXACT case-sensitive folder name
    // Visual styling
    colors: {
      primary: "#B91C1C", // Red-700
      background: "#FEE2E2", // Red-100
      border: "#EF4444", // Red-500
      text: "#7F1D1D", // Red-900
    },
    icon: "GraduationCap", // Lucide icon name
    badgeVariant: "destructive" as const,
  },
  SHARED: {
    id: "SHARED" as Institution,
    displayName: "Shared Policy",
    shortName: "Shared",
    description: "Applies to all configured institutions",
    sourceFolder: null, // Manual assignment only
    colors: {
      primary: "#6B7280", // Gray-500
      background: "#F3F4F6", // Gray-100
      border: "#9CA3AF", // Gray-400
      text: "#374151", // Gray-700
    },
    icon: "Share2",
    badgeVariant: "secondary" as const,
  },
} as const;

export type InstitutionConfig =
  (typeof INSTITUTION_CONFIG)[keyof typeof INSTITUTION_CONFIG];

// Helper function to get config
export function getInstitutionConfig(
  institution: Institution
): InstitutionConfig {
  return INSTITUTION_CONFIG[institution];
}

// All source folders for PDF lookup
export const ALL_POLICY_FOLDERS = [
  INSTITUTION_CONFIG.INSTITUTION_A.sourceFolder,
  INSTITUTION_CONFIG.INSTITUTION_B.sourceFolder,
  TEAMS_COLLECTION_CONFIG.TEAMS_STANDARD_DOCS.sourceFolder,
].filter(Boolean) as string[];

// ============================================
// DOMAIN CONFIGURATION (Protocol vs Knowledge)
// ============================================

export const DOMAIN_CONFIG = {
  PROTOCOL: {
    id: "PROTOCOL" as Domain,
    label: "Protocol Assistant",
    shortLabel: "Protocols",
    description: "Search institutional protocols and policies",
    color: "#3B82F6", // blue-500
  },
  KNOWLEDGE: {
    id: "KNOWLEDGE" as Domain,
    label: "Radiology Knowledge",
    shortLabel: "Knowledge",
    description: "Radiology knowledge base with report phrasing assistance",
    color: "#8B5CF6", // violet-500
  },
} as const;

// ============================================
// PRIORITY CONFIGURATION
// ============================================

// Priority response times (in minutes)
export const PRIORITY_RESPONSE_TIMES = {
  STAT: 2,
  URGENT: 5,
  ROUTINE: 30,
} as const;

// Escalation times (in minutes)
export const ESCALATION_TIMES = {
  STAT: 2,
  URGENT: 5,
  ROUTINE: 30,
} as const;

// Notification channels by priority
export const NOTIFICATION_CHANNELS = {
  STAT: ["PUSH", "SMS", "CALL"] as const,
  URGENT: ["PUSH", "SMS"] as const,
  ROUTINE: ["PUSH"] as const,
} as const;

// Subspecialty display names (satisfies ensures all keys are present; Record<string, string> allows dynamic indexing)
export const SUBSPECIALTY_DISPLAY_NAMES: Record<string, string> = {
  ABDOMINAL: "Abdominal",
  NEURO: "Neuro",
  MSK: "MSK",
  CHEST: "Chest",
  IR: "IR",
  PEDS: "Pediatrics",
  BREAST: "Breast",
  NUCLEAR: "Nuclear Medicine",
  CARDIAC: "Cardiac",
  EMERGENCY: "Emergency",
} satisfies Record<Subspecialty, string>;

// Role display names
export const ROLE_DISPLAY_NAMES: Record<string, string> = {
  ADMIN: "Administrator",
  COORDINATOR: "Coordinator",
  ATTENDING: "Attending",
  FELLOW: "Fellow",
  RESIDENT: "Resident",
  TECHNICIAN: "Technician",
  STAFF: "Staff",
} satisfies Record<UserRole, string>;

// Shift display names
export const SHIFT_DISPLAY_NAMES: Record<string, string> = {
  DAY: "Day Shift",
  EVENING: "Evening Shift",
  NIGHT: "Night Shift",
  WEEKEND_DAY: "Weekend Day",
  WEEKEND_NIGHT: "Weekend Night",
  CALL: "On Call",
} satisfies Record<ShiftType, string>;

// Default shift times
export const DEFAULT_SHIFT_TIMES: Record<string, { start: string; end: string }> = {
  DAY: { start: "07:00", end: "17:00" },
  EVENING: { start: "17:00", end: "22:00" },
  NIGHT: { start: "22:00", end: "07:00" },
  WEEKEND_DAY: { start: "07:00", end: "19:00" },
  WEEKEND_NIGHT: { start: "19:00", end: "07:00" },
  CALL: { start: "00:00", end: "23:59" },
} satisfies Record<ShiftType, { start: string; end: string }>;

/** @deprecated Use RAG_CONFIG from packages/api/src/lib/rag-config.ts instead. This copy has stale threshold values. */
export const RAG_CONFIG = {
  EMBEDDING_MODEL: "text-embedding-3-small",
  EMBEDDING_DIMENSIONS: 1536,
  LLM_MODEL: "claude-haiku",
  MAX_CONTEXT_TOKENS: 8000,
  CHUNK_SIZE: 512,
  CHUNK_OVERLAP: 100,
  MIN_CONFIDENCE_THRESHOLD: 0.6,
  MAX_SEARCH_RESULTS: 5,
} as const;

// Intent classification
export const URGENCY_KEYWORDS = {
  STAT: [
    "stat",
    "code",
    "critical",
    "emergent",
    "stroke",
    "trauma",
    "emergency",
    "immediately",
    "now",
    "life-threatening",
  ],
  URGENT: ["urgent", "asap", "priority", "soon", "quickly"],
} as const;

export const INTENT_CATEGORIES = [
  "PROTOCOL_QUESTION",
  "SPEAK_TO_RADIOLOGIST",
  "SCHEDULE_INQUIRY",
  "URGENT_STAT",
  "ADMINISTRATIVE",
] as const;

// Session configuration
export const SESSION_CONFIG = {
  TIMEOUT_MINUTES: 30,
  REFRESH_THRESHOLD_MINUTES: 5,
} as const;

// Audit log retention (in days)
export const AUDIT_LOG_RETENTION_DAYS = 2190; // 6 years for HIPAA

// App metadata
export const APP_CONFIG = {
  NAME: "Radiology AI Assistant",
  DESCRIPTION: "Radiology Communication Platform",
  VERSION: "0.1.0",
} as const;
