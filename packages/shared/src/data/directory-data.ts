/**
 * Department Directory Data
 *
 * Template - replace with your institution's data
 *
 * Single source of truth for contacts, systems, and emergency lines.
 * Consumed by:
 *   1. /reference page UI (apps/web)
 *   2. RAG ingestion script (scripts/ingest-directory.ts)
 *   3. Chat responses via vector search
 *
 * To update: edit this file, then re-run `npm run ingest:directory`
 */

// ============================================
// TYPES
// ============================================

export type DirectoryCategory =
  | "EMERGENCY"
  | "IT_INSTITUTION_A"
  | "IT_INSTITUTION_B"
  | "RADIOLOGY_DEPT"
  | "PERSONNEL"
  | "CLINICAL_SYSTEMS"
  | "AI_TOOLS"
  | "WORKFLOW_SYSTEMS"
  | "INFRASTRUCTURE";

export interface DirectoryContact {
  name: string;
  phone?: string;
  phoneAlt?: string;
  email?: string;
  location?: string;
  hours?: string;
  notes?: string;
  url?: string;
  institution?: "INSTITUTION_A" | "INSTITUTION_B" | "BOTH";
  priority?: "critical" | "high" | "standard";
}

export interface DirectorySystem {
  name: string;
  purpose: string;
  accessUrl?: string;
  loginMethod?: string;
  supportContact?: string;
  supportPhone?: string;
  manualLocation?: string;
  notes?: string;
  institution?: "INSTITUTION_A" | "INSTITUTION_B" | "BOTH";
}

export interface DirectorySection {
  id: DirectoryCategory;
  label: string;
  description: string;
  icon: string; // Lucide icon name (string), resolved to component in UI
  type: "contacts" | "systems";
  contacts?: DirectoryContact[];
  systems?: DirectorySystem[];
}

// ============================================
// TEMPLATE CONTACT DATA
// ============================================
// Template - replace with your institution's data
// Add your institutional contacts, phone numbers, and system details below.

export const DIRECTORY_SECTIONS: DirectorySection[] = [
  // -- EMERGENCY / ESCALATION --
  {
    id: "EMERGENCY",
    label: "Emergency & Escalation",
    description: "Critical contacts for clinical emergencies and urgent escalation",
    icon: "AlertTriangle",
    type: "contacts",
    contacts: [
      // Template - replace with your institution's data
      {
        name: "Code Blue / Rapid Response",
        phone: "",
        notes: "Replace with your institution's emergency extension",
        institution: "BOTH",
        priority: "critical",
      },
      {
        name: "Radiology Chief On-Call",
        phone: "",
        notes: "After-hours escalation path",
        institution: "INSTITUTION_B",
        priority: "critical",
      },
      {
        name: "MRI Safety Officer",
        phone: "",
        notes: "MRI emergency: zone violations, quench, ferromagnetic incidents",
        institution: "BOTH",
        priority: "critical",
      },
    ],
  },

  // -- Institution A IT --
  {
    id: "IT_INSTITUTION_A",
    label: "Institution A IT",
    description: "Primary hospital IT services",
    icon: "Building2",
    type: "contacts",
    contacts: [
      // Template - replace with your institution's data
      {
        name: "IT Service Desk",
        phone: "",
        email: "",
        hours: "24/7",
        notes: "Replace with your institution's IT help desk contact",
        institution: "INSTITUTION_A",
        priority: "high",
      },
    ],
  },

  // -- Institution B IT (Department) --
  {
    id: "IT_INSTITUTION_B",
    label: "Department IT",
    description: "Department-specific IT services",
    icon: "Monitor",
    type: "contacts",
    contacts: [
      // Template - replace with your institution's data
      {
        name: "Department IT Service Desk",
        phone: "",
        email: "",
        hours: "24/7",
        notes: "Replace with your department's IT help desk contact",
        institution: "INSTITUTION_B",
        priority: "high",
      },
    ],
  },

  // -- CLINICAL SYSTEMS --
  {
    id: "CLINICAL_SYSTEMS",
    label: "Clinical Systems",
    description: "Core clinical and imaging systems",
    icon: "Monitor",
    type: "systems",
    systems: [
      // Template - replace with your institution's data
      {
        name: "EMR System",
        purpose: "Electronic medical records",
        accessUrl: "",
        loginMethod: "Institutional SSO",
        supportContact: "IT Service Desk",
        supportPhone: "",
        notes: "Replace with your EMR system details",
        institution: "BOTH",
      },
      {
        name: "PACS",
        purpose: "Picture archiving and communication system",
        accessUrl: "",
        loginMethod: "Institutional SSO",
        supportContact: "PACS Support",
        supportPhone: "",
        notes: "Replace with your PACS system details",
        institution: "BOTH",
      },
      {
        name: "Dictation System",
        purpose: "Radiology report dictation and speech recognition",
        accessUrl: "",
        loginMethod: "Institutional SSO",
        supportContact: "Dictation Support",
        supportPhone: "",
        notes: "Replace with your dictation system details",
        institution: "BOTH",
      },
    ],
  },

  // -- RADIOLOGY DEPARTMENT --
  {
    id: "RADIOLOGY_DEPT",
    label: "Radiology Department",
    description: "Department contacts and administration",
    icon: "Stethoscope",
    type: "contacts",
    contacts: [
      // Template - replace with your institution's data
      {
        name: "Department Administrator",
        phone: "",
        email: "",
        notes: "Replace with your department administrator contact",
        institution: "INSTITUTION_B",
      },
      {
        name: "Department Chair Office",
        phone: "",
        email: "",
        notes: "Replace with your department chair contact",
        institution: "INSTITUTION_B",
      },
    ],
  },
];
