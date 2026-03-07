/**
 * IT Systems Troubleshooting Knowledge Base
 *
 * Template - replace with your institution's data
 *
 * Systems covered (examples):
 *   EMR (e.g., Epic, Cerner)
 *   PACS (e.g., Vue PACS, Sectra, Visage)
 *   Radiology Information System
 *   Dictation / Speech Recognition
 *
 * @module troubleshooting-data
 */

// ── Source Reliability ──────────────────────────────────────────────

export type SourceReliability =
  | 'VERIFIED_PUBLIC'
  | 'VERIFIED_GATED'
  | 'COMMUNITY'
  | 'INFERRED'
  | 'UNVERIFIED';

// ── Severity ────────────────────────────────────────────────────────

export type TroubleshootingSeverity =
  | 'CRITICAL'
  | 'HIGH'
  | 'MEDIUM'
  | 'LOW';

// ── System Identifiers ──────────────────────────────────────────────
// Template - replace with your institution's clinical systems

export type ClinicalSystem =
  | 'EMR'
  | 'EMR_MOBILE'
  | 'EMR_RADIOLOGY_MODULE'
  | 'PACS'
  | 'PACS_MOBILE'
  | 'RIS'
  | 'DICTATION'
  | 'DICTATION_RADIOLOGY'
  | 'INTEGRATION';

// ── Failure Categories ──────────────────────────────────────────────

export type FailureCategory =
  | 'LOGIN_AUTH'
  | 'DISPLAY_RENDERING'
  | 'PERFORMANCE'
  | 'CONNECTIVITY'
  | 'INTEGRATION_BOUNDARY'
  | 'DICOM_COMMUNICATION'
  | 'HL7_INTERFACE'
  | 'HANGING_PROTOCOL'
  | 'PRIOR_RETRIEVAL'
  | 'MICROPHONE_AUDIO'
  | 'SPEECH_RECOGNITION'
  | 'REPORT_ROUTING'
  | 'CONTEXT_LAUNCH'
  | 'WORKLIST'
  | 'ORDER_ROUTING'
  | 'CLIENT_CRASH'
  | 'DOWNTIME_PROCEDURE'
  | 'MOBILE_APP'
  | 'SECURITY_VULNERABILITY'
  | 'CONFIGURATION'
  | 'HARDWARE'
  | 'OTHER';

// ── Core Troubleshooting Entry ──────────────────────────────────────

export interface TroubleshootingEntry {
  id: string;
  system: ClinicalSystem;
  secondarySystem?: ClinicalSystem;
  category: FailureCategory;
  severity: TroubleshootingSeverity;
  title: string;
  symptoms: string[];
  probableCauses: string[];
  resolution: string[];
  escalationPath: string;
  tags: string[];
  relatedEntries: string[];
  downtimeProcedure: boolean;
  sourceReliability: SourceReliability;
  sourceDescription: string;
  lastVerified: string;
  brandingNotes?: string;
  institution: 'INSTITUTION_A' | 'INSTITUTION_B' | 'SHARED';
}

// ── Section (groups entries for chunking) ───────────────────────────

export interface TroubleshootingSection {
  id: string;
  title: string;
  systems: ClinicalSystem[];
  description: string;
  entries: TroubleshootingEntry[];
}

// ═══════════════════════════════════════════════════════════════════
// EXAMPLE ENTRIES
// Template - replace with your institution's troubleshooting data
// ═══════════════════════════════════════════════════════════════════

const EXAMPLE_ENTRIES: TroubleshootingEntry[] = [
  {
    id: 'EMR_001',
    system: 'EMR',
    category: 'LOGIN_AUTH',
    severity: 'HIGH',
    title: 'EMR login fails or is extremely slow',
    symptoms: [
      'Login screen hangs for 30-60+ seconds',
      'Incorrect login error despite correct credentials',
      'Application eventually launches but takes several minutes',
    ],
    probableCauses: [
      'Network configuration issue causing authentication delays',
      'Cached credential mismatch after password change',
      'Session pre-launch not configured, causing cold-start delays',
    ],
    resolution: [
      'Clear cached credentials and re-enter password manually.',
      'Verify network connectivity and VPN status if remote.',
      'Contact IT to check authentication server responsiveness.',
    ],
    escalationPath: 'IT Service Desk (L1). Application Support (L2). Vendor Technical Services (L3).',
    tags: ['emr', 'login', 'slow', 'password', 'authentication'],
    relatedEntries: ['EMR_002'],
    downtimeProcedure: false,
    sourceReliability: 'COMMUNITY',
    sourceDescription: 'Template example entry - replace with verified institutional data.',
    lastVerified: '2026-01-01',
    institution: 'SHARED',
  },
  {
    id: 'PACS_001',
    system: 'PACS',
    category: 'DISPLAY_RENDERING',
    severity: 'HIGH',
    title: 'PACS viewer displays black or blank images',
    symptoms: [
      'Image viewport shows black rectangle instead of study images',
      'Thumbnails load but full-resolution images do not render',
      'Some series display correctly while others are blank',
    ],
    probableCauses: [
      'GPU driver incompatibility with PACS viewer rendering engine',
      'Insufficient GPU memory for large studies (e.g., CT with 1000+ slices)',
      'Browser cache corruption (for web-based viewers)',
    ],
    resolution: [
      'Update GPU drivers to the latest version recommended by PACS vendor.',
      'Close other GPU-intensive applications and retry.',
      'For web viewers: clear browser cache and reload.',
      'If persistent: escalate to PACS support with study accession number.',
    ],
    escalationPath: 'PACS Support Team (L1). Vendor Support (L2).',
    tags: ['pacs', 'display', 'black', 'blank', 'rendering', 'gpu'],
    relatedEntries: [],
    downtimeProcedure: false,
    sourceReliability: 'COMMUNITY',
    sourceDescription: 'Template example entry - replace with verified institutional data.',
    lastVerified: '2026-01-01',
    institution: 'SHARED',
  },
  {
    id: 'DICT_001',
    system: 'DICTATION',
    category: 'SPEECH_RECOGNITION',
    severity: 'MEDIUM',
    title: 'Dictation system fails to recognize speech or produces garbled text',
    symptoms: [
      'Microphone icon shows active but no text appears',
      'Recognized text is highly inaccurate or garbled',
      'System intermittently stops recognizing mid-dictation',
    ],
    probableCauses: [
      'Microphone not set as default input device in OS settings',
      'Background noise exceeding speech recognition threshold',
      'Voice profile needs retraining after system or microphone change',
    ],
    resolution: [
      'Verify correct microphone is selected in both OS and dictation application settings.',
      'Retrain voice profile from dictation application preferences.',
      'Test with a different USB microphone to rule out hardware failure.',
      'Ensure dictation server connectivity (check status indicator in application).',
    ],
    escalationPath: 'IT Service Desk (L1). Dictation Application Support (L2).',
    tags: ['dictation', 'speech', 'microphone', 'recognition', 'voice'],
    relatedEntries: [],
    downtimeProcedure: false,
    sourceReliability: 'COMMUNITY',
    sourceDescription: 'Template example entry - replace with verified institutional data.',
    lastVerified: '2026-01-01',
    institution: 'SHARED',
  },
];

// ═══════════════════════════════════════════════════════════════════
// EXPORTED SECTIONS
// Template - replace with your institution's system sections
// ═══════════════════════════════════════════════════════════════════

export const TROUBLESHOOTING_SECTIONS: TroubleshootingSection[] = [
  {
    id: 'emr',
    title: 'EMR Troubleshooting',
    systems: ['EMR', 'EMR_MOBILE', 'EMR_RADIOLOGY_MODULE'],
    description: 'Common issues with the electronic medical record system',
    entries: EXAMPLE_ENTRIES.filter((e) => e.system.startsWith('EMR')),
  },
  {
    id: 'pacs',
    title: 'PACS Troubleshooting',
    systems: ['PACS', 'PACS_MOBILE'],
    description: 'Common issues with the picture archiving and communication system',
    entries: EXAMPLE_ENTRIES.filter((e) => e.system.startsWith('PACS')),
  },
  {
    id: 'dictation',
    title: 'Dictation / Speech Recognition Troubleshooting',
    systems: ['DICTATION', 'DICTATION_RADIOLOGY'],
    description: 'Common issues with dictation and speech recognition systems',
    entries: EXAMPLE_ENTRIES.filter((e) => e.system.startsWith('DICT')),
  },
];

// Flat export for ingestion scripts
export const ALL_TROUBLESHOOTING_ENTRIES: TroubleshootingEntry[] = EXAMPLE_ENTRIES;
