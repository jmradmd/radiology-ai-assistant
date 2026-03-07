import {
  isKnownFirstName,
  isKnownLastName,
  isLikelyMedicalEponym,
  normalizeCandidateToken,
} from "./data/name-database";

/**
 * HIPAA-Compliant PHI Detection
 *
 * Based on 45 CFR §164.514(b) - Safe Harbor De-identification Standard
 *
 * BLOCKS only when one or more of the 18 HIPAA identifiers is detected.
 * ALLOWS demographics, diagnoses, symptoms, procedures, lab values
 * (these are NOT PHI without identifiers).
 *
 * The 18 identifiers are exhaustive. If information doesn't contain any
 * of these identifiers, it is considered de-identified under HIPAA Safe Harbor.
 */

// ============================================
// TYPES
// ============================================

export type PHIType =
  | "NAME"
  | "DATE"
  | "PHONE"
  | "FAX"
  | "EMAIL"
  | "SSN"
  | "MRN"
  | "HEALTH_PLAN_ID"
  | "ACCOUNT_NUMBER"
  | "LICENSE_NUMBER"
  | "VEHICLE_ID"
  | "DEVICE_ID"
  | "URL"
  | "IP_ADDRESS"
  | "BIOMETRIC"
  | "PHOTO"
  | "OTHER_UNIQUE_ID"
  | "AGE_OVER_89"
  | "GEOGRAPHIC";

export type WarningType =
  | "TEMPORAL_IDENTIFIER"
  | "LOCATION_CONTEXT"
  | "RARE_CONDITION";

export interface PHIDetection {
  type: PHIType;
  pattern: string; // Which pattern matched (sanitized description)
  message: string;
}

export interface PHIDetectionSpan {
  id: string;
  type: PHIType;
  start: number;
  end: number;
  text: string;
  ruleId: string;
  confidence: number;
}

export interface PHIWarning {
  type: WarningType | PHIType; // Support both for backward compatibility
  message: string;
  match?: string;
  severity?: "error" | "warning" | "info";
}

export interface PHIValidationResult {
  hasPHI: boolean; // True if actual HIPAA identifier found
  hasWarning: boolean; // True if re-identification risk exists
  detections: PHIDetection[];
  warnings: PHIWarning[];
  detectionSpans: PHIDetectionSpan[];
  inputHash: string;
  summary: string;
  // Legacy compatibility fields
  hasPotentialPHI: boolean; // Alias for hasPHI
  isBlocked: boolean; // Alias for hasPHI
  signals: string[]; // Empty for new implementation
  sanitizedText: string | null;
}

// Legacy interface for backward compatibility
export interface PHIDetectionResult {
  hasPotentialPHI: boolean;
  warnings: PHIWarning[];
  detectionSpans?: PHIDetectionSpan[];
  sanitizedText: string | null;
}

export interface PHIOverrideSelection {
  spanId: string;
  type: PHIType;
  inputHash: string;
  acknowledged: boolean;
}

// ============================================
// KNOWN MEDICAL ACRONYMS WHITELIST
// These should NOT be flagged as patient names
// ============================================

const KNOWN_MEDICAL_ACRONYMS = new Set([
  // Institutions
  "INSTITUTION_A", "Institution B", "Institution BC", "MSK", "MSKCC", "HSS", "MGH", "BWH", "UCSF", "UCLA", "USC",
  "NYU", "CUMC", "CPMC", "LIJ", "NSUH", "SIUH", "BMC", "BIDMC", "JHH", "CCF",

  // Professional organizations
  "ACR", "RSNA", "ARRS", "SIR", "ASNR", "AMA", "AHA", "ACC", "AAPM", "ISMRM",

  // Clinical acronyms (commonly appear in queries)
  "MRI", "CT", "CTA", "MRA", "PET", "SPECT", "US", "XR", "IR", "GI", "GU",
  "ICU", "ED", "OR", "PACU", "CCU", "NICU", "PICU", "BMT", "OB", "GYN",
  "IV", "IM", "PO", "PR", "SQ", "SC", "IO", "IT", "INR", "PT", "PTT",
  "CBC", "BMP", "CMP", "LFT", "TSH", "HCG", "PSA", "CEA", "AFP", "BNP",
  "EKG", "ECG", "EEG", "EMG", "ABG", "VBG", "CSF", "BAL",
  "EGFR", "GFR", "BUN", "SCR", "ALT", "AST", "ALP", "GGT", "LDH",
  "DVT", "PE", "MI", "CVA", "TIA", "CHF", "COPD", "DM", "HTN", "CKD", "AKI",
  "STAT", "PRN", "QD", "BID", "TID", "QID", "QHS", "AC", "PC", "NPO",

  // Contrast/medication related
  "GBCA", "LOCM", "HOCM", "IOCM", "NSF", "CIN",

  // Safety/protocols
  "MR", "RF", "SAR", "FDA", "CDC", "OSHA", "JCAHO", "TJC", "CMS", "HIPAA", "PHI",

  // Radiology specific
  "PACS", "RIS", "HIS", "EMR", "EHR", "HL7", "DICOM", "MQSA", "BIRADS",
]);

// ============================================
// COMMON WORDS WHITELIST
// These should NOT be flagged as patient names
// ============================================

const COMMON_WORDS_NOT_NAMES = new Set([
  // Common English words (sentence starters, etc.)
  "with", "has", "had", "is", "was", "who", "that", "this", "needs", "need",
  "requires", "required", "presents", "presented", "presenting", "shows",
  "showing", "reports", "reported", "reporting", "complains", "complained",
  "having", "experiencing", "developed", "developing", "received", "receiving",
  "undergoing", "underwent", "scheduled", "waiting", "arrived", "arriving",
  "came", "comes", "coming", "here", "there", "these", "those", "now", "today", "yesterday",
  "allergic", "allergies", "allergy", "history", "no", "not", "does", "did",
  "can", "cannot", "will", "would", "should", "could", "may", "might", "must",
  "being", "been", "about", "for", "from", "after", "before", "during", "on",
  "in", "at", "to", "the", "a", "an", "and", "or", "but", "if", "then", "when",
  "where", "why", "how", "what", "which", "whom", "whose", "also", "still",
  "already", "just", "only", "very", "really", "currently", "previously",
  "recently", "always", "never", "sometimes", "usually", "often", "rarely",
  "please", "thanks", "thank", "hello", "yes", "okay", "sure", "right",
  "question", "questions", "asking", "asked", "wondering", "wondering",

  // Common English words frequently capitalized at sentence start (false-positive magnets)
  "however", "therefore", "although", "because", "regarding", "concerning",
  "following", "according", "including", "excluding", "considering", "assuming",
  "given", "based", "noted", "seen", "found", "observed", "detected", "identified",
  "confirmed", "suspected", "likely", "unlikely", "possible", "probable",
  "testing", "test", "tests", "tested", "person", "persons", "people",
  "thing", "things", "type", "types", "kind", "class", "category", "categories",
  "example", "examples", "instance", "cases", "case", "scenario", "situation",
  "above", "below", "over", "under", "between", "within", "without", "through",
  "several", "multiple", "various", "different", "similar", "same", "other",
  "first", "second", "third", "last", "next", "previous", "initial", "final",
  "best", "worst", "most", "least", "more", "less", "better", "worse",
  "new", "old", "recent", "prior", "earlier", "later", "current", "former",
  "good", "bad", "large", "small", "long", "short", "wide", "narrow",
  "many", "few", "each", "every", "all", "both", "either", "neither",
  "another", "such", "own", "same", "enough", "much", "even",

  // Clinical severity/status terms
  "stable", "unstable", "critical", "acute", "chronic", "severe", "mild",
  "moderate", "normal", "abnormal", "positive", "negative", "elevated", "low",
  "high", "increased", "decreased", "improving", "worsening", "declining",
  "emergent", "urgent", "routine", "stat", "immediate", "pending", "complete",

  // Medical/clinical terms (commonly capitalized at sentence start)
  "group", "groups", // e.g., "Group II agents", "Group I contrast"
  "patient", "patients", "protocol", "protocols", "procedure", "procedures",
  "contrast", "iodinated", "gadolinium", "injection", "infusion", "dose", "dosing",
  "medication", "medications", "drug", "drugs", "treatment", "treatments",
  "reaction", "reactions", "allergy", "allergies", "allergic", "anaphylaxis",
  "premedication", "premedicate", "hydration", "steroid", "steroids",
  "screening", "screen", "consent", "consented", "verify", "verified",
  "scan", "scans", "study", "studies", "exam", "exams", "imaging", "image",
  "radiology", "radiologist", "technologist", "tech", "nurse", "nursing",
  "doctor", "physician", "attending", "resident", "fellow", "coordinator",
  "diagnosis", "diagnostic", "prognosis", "clinical", "indication", "indicated",
  "contraindication", "contraindicated",

  // Anatomy/body parts
  "chest", "abdomen", "abdominal", "pelvis", "pelvic", "head", "brain", "spine",
  "spinal", "neck", "cervical", "thoracic", "lumbar", "extremity", "extremities",
  "cardiac", "heart", "pulmonary", "lung", "lungs", "liver", "kidney", "kidneys",
  "renal", "hepatic", "splenic", "spleen", "pancreas", "pancreatic", "bowel",
  "intestine", "intestinal", "colon", "rectal", "bladder", "prostate", "uterus",
  "ovary", "ovarian", "breast", "thyroid", "adrenal", "bone", "bones", "joint",
  "joints", "muscle", "muscles", "vascular", "vessel", "vessels", "artery",
  "arteries", "vein", "veins", "aorta", "aortic",

  // Radiology-specific terms (high false-positive rate)
  "coronal", "sagittal", "axial", "oblique", "lateral", "medial",
  "anterior", "posterior", "superior", "inferior", "proximal", "distal",
  "bilateral", "unilateral", "contralateral", "ipsilateral",
  "diffusion", "restricted", "arterial", "venous", "portal",
  "hepatocellular", "metastatic", "carcinoma", "adenoma", "lymphoma", "melanoma",
  "sarcoma", "adenocarcinoma", "meningioma", "glioma", "glioblastoma",
  "fibrosis", "cirrhosis", "necrosis", "sclerosis", "calcification",
  "hemorrhagic", "ischemic", "thrombotic", "embolic", "infarction",
  "hypertension", "hypotension", "tachycardia", "bradycardia",
  "catheterization", "embolization", "ablation", "biopsy", "resection",
  "intubation", "extubation", "ventilation",
  "fluoroscopy", "tomography", "ultrasound", "mammography", "angiography",
  "cholangiography", "myelography", "arthrography", "urography",
  "intermediate", "hyperintense", "hypointense", "isointense",
  "heterogeneous", "homogeneous", "enhancing",

  // Symptoms/conditions
  "pain", "painful", "swelling", "swollen", "bleeding", "hemorrhage", "mass",
  "lesion", "lesions", "tumor", "tumors", "cancer", "malignancy", "benign",
  "infection", "infected", "fever", "febrile", "nausea", "vomiting", "diarrhea",
  "constipation", "obstruction", "stenosis", "occlusion", "thrombosis", "embolism",
  "fracture", "fractured", "dislocation", "inflammation", "inflammatory",
  "edema", "effusion", "ascites", "pneumonia", "atelectasis", "consolidation",
  "nodule", "nodules", "cyst", "cystic", "polyp", "polyps", "abscess",
  "stricture", "fistula", "hernia", "aneurysm", "dissection", "perforation",

  // Lab values and measurements
  "creatinine", "egfr", "gfr", "bun", "hemoglobin", "hematocrit", "platelets",
  "glucose", "potassium", "sodium", "calcium", "magnesium", "lactate",
  "troponin", "bnp", "inr", "ptt", "level", "levels", "value", "values",
  "result", "results", "findings", "finding", "impression", "recommendation",

  // Imaging modalities and equipment
  "scanner", "machine", "coil", "table", "bore", "field", "strength", "tesla",
  "sequence", "sequences", "weighted", "enhancement", "enhancing", "enhanced",
  "attenuation", "density", "signal", "artifact", "artifacts", "motion",
  "resolution", "slice", "slices", "phase", "delayed", "dynamic",

  // Age descriptors (NOT PHI)
  "middle", "aged", "elderly", "geriatric", "pediatric", "young", "adult", "older",
  "younger", "senior", "infant", "toddler", "child", "children", "adolescent", "teenage",
  "neonatal", "neonate", "newborn", "year", "years", "old", "month", "months",

  // Body descriptors (NOT PHI)
  "male", "female", "man", "woman", "boy", "girl", "obese", "thin", "muscular",
  "overweight", "underweight", "pregnant", "pregnancy", "gravid",

  // Workflow/administrative
  "care", "safety", "information", "education", "consent", "identification",
  "weight", "age", "demographics", "assessment", "evaluation", "monitoring",
  "management", "therapy", "preparation", "positioning", "sedation", "anesthesia",
  "recovery", "discharge", "transfer", "transport", "isolation", "precautions",
  "instructions", "communication", "documentation", "order", "orders", "ordered",
  "schedule", "appointment", "slot", "available", "availability", "waiting",
  "room", "suite", "department", "floor", "unit", "bay", "area", "location",

  // Common medical question starters
  "what", "when", "where", "why", "how", "which", "does", "can", "should",
  "would", "could", "will", "are", "there", "any", "some", "need", "give",
  "use", "using", "used", "recommended", "recommend", "indication", "indicated",
  "contraindication", "contraindicated", "safe", "unsafe", "risk", "risks",
  "benefit", "benefits", "alternative", "alternatives", "option", "options",

  // Contrast agent brand names (avoid false positives)
  "omnipaque", "isovue", "visipaque", "optiray", "ultravist", "iomeron",
  "gadavist", "dotarem", "prohance", "multihance", "eovist", "magnevist",
  "clariscan", "gadovist", "primovist",

  // Other medical product/drug names commonly mentioned
  "benadryl", "diphenhydramine", "epinephrine", "epipen", "solumedrol",
  "prednisone", "methylprednisolone", "hydrocortisone", "famotidine", "pepcid",
  "zofran", "ondansetron", "atropine", "narcan", "naloxone", "versed",
  "midazolam", "fentanyl", "propofol", "ketamine", "morphine", "dilaudid",
  "toradol", "ketorolac", "tylenol", "acetaminophen", "ibuprofen", "aspirin",
  "heparin", "lovenox", "coumadin", "warfarin", "metformin", "insulin",

  // ── Clinical IT system / product names (false positive sources) ──
  "epic", "hyperspace", "hyperdrive", "haiku", "radiant",
  "citrix", "workspace", "receiver",
  "fluency", "direct",
  "carestream", "vue",
  "medicalis",
  "systemx",
  "powerscribe", "nuance", "dragon",
  "imprivata",
  "kronos",
  "cerner", "millennium",
  "meditech",
  "sectra",
  "intelerad",
  "syngo",
  "aidoc",
  "qgenda", "amion",
  "vocera",
  "pagerduty",
  "deepseek",

  // ── Common English words that appear in product names (capitalized) ──
  "power", "scribe", "smart", "link", "point", "view", "space", "drive",
  "studio", "flash", "pulse", "fusion", "connect", "bridge", "cloud",
  "edge", "mobile", "portal", "server", "client", "agent", "console",
  "desktop", "monitor", "viewer", "express", "premier", "advance",
  "enterprise", "standard", "login", "spinning", "slow", "frozen",
  "stuck", "error", "down", "working", "loading", "queue",
  "single", "sign", "medical", "lookup", "session", "failed",
]);

const GEOGRAPHIC_STREET_SUFFIX_MEDICAL_ABBREVIATIONS = new Set([
  "CT",
  "MR",
  "MRI",
  "DR",
  "US",
  "NM",
  "IR",
  "PET",
  "SPECT",
  "CTA",
  "MRA",
  "DSA",
]);

const STAFF_CONTEXT_PRECEDING_CHARS = 20;
const STAFF_CONTEXT_FOLLOWING_CHARS = 40;
const STAFF_CONTEXT_PRECEDING_PATTERN =
  /\b(?:attending|fellow|resident|technologist|tech|nurse|coordinator|scheduler|per)\b/i;
const STAFF_CONTEXT_FOLLOWING_PATTERN =
  /\b(?:recommends|recommended|suggests|suggested|ordered|reviewed|interpreted|dictated|reported|signed|approved|confirmed|cleared|performed|consulted|supervised|attending|fellow|resident|technologist|tech|nurse|coordinator|scheduler|on(?:\s*-\s*|\s+)call|reading\s+with|staffed\s+by|per\s+dr\.?)\b/i;

// ============================================
// HELPER FUNCTIONS
// ============================================

function isKnownAcronym(word: string): boolean {
  return KNOWN_MEDICAL_ACRONYMS.has(word.toUpperCase());
}

function isCommonWord(word: string): boolean {
  return COMMON_WORDS_NOT_NAMES.has(word.toLowerCase());
}

function looksLikeAcronym(word: string): boolean {
  return /^[A-Z]{2,6}$/.test(word);
}

function shouldSuppressGeographicStreetSuffixMatch(matchText: string): boolean {
  const words = matchText.match(/[A-Za-z]+/g);
  if (!words || words.length === 0) return false;
  const trailingToken = words[words.length - 1]?.toUpperCase();
  return trailingToken ? GEOGRAPHIC_STREET_SUFFIX_MEDICAL_ABBREVIATIONS.has(trailingToken) : false;
}

function buildSpanId(type: PHIType, start: number, end: number): string {
  return `${type}:${start}:${end}`;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function getRegexMatches(input: string, pattern: RegExp): Array<{ text: string; index: number }> {
  const patternCopy = new RegExp(pattern.source, pattern.flags);
  const matches: Array<{ text: string; index: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = patternCopy.exec(input)) !== null) {
    if (typeof match.index === "number") {
      matches.push({ text: match[0], index: match.index });
    }
    if (match[0] === "") {
      patternCopy.lastIndex += 1;
    }
  }
  return matches;
}

function getAdjacentWordPairCandidates(input: string): Array<{ text: string; index: number }> {
  const wordRegex = /\b[a-zA-Z][a-zA-Z'-]{2,}\b/g;
  const words: Array<{ text: string; start: number; end: number }> = [];

  let match: RegExpExecArray | null;
  while ((match = wordRegex.exec(input)) !== null) {
    words.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  const candidates: Array<{ text: string; index: number }> = [];
  for (let i = 0; i < words.length - 1; i += 1) {
    const first = words[i];
    const second = words[i + 1];
    const between = input.slice(first.end, second.start);
    if (!/^\s+$/.test(between)) continue;
    candidates.push({
      text: input.slice(first.start, second.end),
      index: first.start,
    });
  }

  return candidates;
}

function isCapitalizedToken(value: string): boolean {
  return /^[A-Z][a-z'-]{1,}$/.test(value);
}

function scoreNameMatch(
  matchText: string,
  startIndex: number,
  input: string
): { accepted: boolean; confidence: number } {
  const trimmed = matchText.trim();
  const matchEnd = startIndex + matchText.length;
  const leadingContext = input.slice(Math.max(0, startIndex - 24), startIndex);
  const precedingStaffContext = input.slice(
    Math.max(0, startIndex - STAFF_CONTEXT_PRECEDING_CHARS),
    startIndex
  );
  const followingStaffContext = input.slice(matchEnd, matchEnd + STAFF_CONTEXT_FOLLOWING_CHARS);
  const hasLeadingPatientContext = /\b(?:patient|pt|pts)\.?\s*$/i.test(leadingContext);
  const hasPrecedingStaffContext = STAFF_CONTEXT_PRECEDING_PATTERN.test(precedingStaffContext);
  const hasFollowingStaffContext = STAFF_CONTEXT_FOLLOWING_PATTERN.test(followingStaffContext);
  const hasInlineStaffContext = STAFF_CONTEXT_FOLLOWING_PATTERN.test(trimmed);
  const hasStaffContext = hasPrecedingStaffContext || hasFollowingStaffContext || hasInlineStaffContext;
  const nameContextTokens = new Set([
    "mr", "mrs", "ms", "miss", "dr", "mister", "missus", "patient", "pt", "pts",
    "the", "case", "scan", "study", "chart", "file",
  ]);
  const hasHonorific = /\b(?:mr|mrs|ms|miss|dr|mister|missus)\.?\b/i.test(trimmed);
  const hasPatientContext = /\b(?:patient|pt|pts)\b/i.test(trimmed) || hasLeadingPatientContext;
  const hasCaseContext = /\b(?:case|scan|study|chart|file)\b/i.test(trimmed);
  const isEmrFormat = /^[A-Z]{2,}(?:[-'][A-Z]+)?,\s*[A-Z][A-Za-z'-]+$/.test(trimmed);
  const hasContext = hasHonorific || hasPatientContext || hasCaseContext || isEmrFormat;

  const tokens = trimmed
    .split(/[\s,]+/)
    .map((token) => normalizeCandidateToken(token))
    .filter(Boolean)
    .filter((token) => !nameContextTokens.has(token));

  const rawNameTokens = trimmed
    .split(/[\s,]+/)
    .map((token) => token.replace(/[.,!?;:'"]/g, ""))
    .filter(Boolean)
    .filter((token) => !nameContextTokens.has(normalizeCandidateToken(token)));

  if (tokens.length === 0) {
    return { accepted: false, confidence: 0 };
  }

  const firstToken = tokens[0];
  const lastToken = tokens[tokens.length - 1];
  const firstNameKnown = isKnownFirstName(firstToken);
  const lastNameKnown = isKnownLastName(lastToken);
  const hasKnownPair = firstNameKnown && lastNameKnown;
  const knownNameTokenCount = tokens.filter(
    (token) => isKnownFirstName(token) || isKnownLastName(token)
  ).length;
  const allTokensAreKnownNames = tokens.length >= 2 && knownNameTokenCount === tokens.length;
  const allCapitalized = trimmed
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => isCapitalizedToken(token.replace(/[.,!?;:'"]/g, "")) || /^(?:mr|mrs|ms|miss|dr)\.?$/i.test(token));
  const hasTwoTokenNameShape =
    rawNameTokens.length === 2 && rawNameTokens.every((token) => isCapitalizedToken(token));
  const hasAcronymLikeToken = rawNameTokens.some(
    (token) => isKnownAcronym(token) || looksLikeAcronym(token)
  );
  const containsEponym = tokens.some((token) => isLikelyMedicalEponym(token));
  const sentenceStart = isAtSentenceStart(startIndex, input);
  const hasLikelyUnknownFullName =
    hasTwoTokenNameShape &&
    !hasAcronymLikeToken &&
    !tokens.some((token) => isCommonWord(token) || hasMedicalOrCommonSuffix(token) || isLikelyMedicalEponym(token));

  let score = 0.15;

  if (hasHonorific) score += 0.4;
  if (hasPatientContext) score += 0.3;
  if (isEmrFormat) score += 0.45;
  if (hasCaseContext) score += 0.2;
  if (firstNameKnown) score += 0.2;
  if (lastNameKnown) score += 0.2;
  if (hasKnownPair) score += 0.2;
  if (allTokensAreKnownNames) score += 0.4;
  if (tokens.length >= 3 && knownNameTokenCount >= 2) score += 0.15;
  if (tokens.length >= 2 && allCapitalized) score += 0.1;
  if (hasLikelyUnknownFullName) score += 0.45;
  if (hasPatientContext && tokens.length >= 2 && !tokens.some((token) => isCommonWord(token))) {
    score += 0.15;
  }

  if (tokens.some((token) => hasMedicalOrCommonSuffix(token))) score -= 0.35;
  if (containsEponym) score -= 0.45;
  if (tokens.some((token) => isCommonWord(token))) score -= 0.45;
  if (sentenceStart && !hasContext && !hasKnownPair && !hasLikelyUnknownFullName) score -= 0.25;
  if (tokens.length === 1 && !hasContext && !hasKnownPair) score -= 0.2;
  if (hasStaffContext) score -= 0.3;

  const confidence = clampScore(score);
  return { accepted: confidence >= 0.55, confidence };
}

function rightRotate(value: number, shift: number): number {
  return (value >>> shift) | (value << (32 - shift));
}

const SHA_256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function toUtf8Bytes(input: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of input) {
    const codePoint = char.codePointAt(0);
    if (typeof codePoint !== "number") continue;

    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6));
      bytes.push(0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(0xe0 | (codePoint >> 12));
      bytes.push(0x80 | ((codePoint >> 6) & 0x3f));
      bytes.push(0x80 | (codePoint & 0x3f));
    } else {
      bytes.push(0xf0 | (codePoint >> 18));
      bytes.push(0x80 | ((codePoint >> 12) & 0x3f));
      bytes.push(0x80 | ((codePoint >> 6) & 0x3f));
      bytes.push(0x80 | (codePoint & 0x3f));
    }
  }
  return Uint8Array.from(bytes);
}

function sha256Hex(input: string): string {
  const bytes = toUtf8Bytes(input);
  const bitLength = bytes.length * 8;
  const totalLength = (((bytes.length + 9) + 63) >> 6) << 6;
  const padded = new Uint8Array(totalLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const view = new DataView(padded.buffer);
  const highBits = Math.floor(bitLength / 0x100000000);
  const lowBits = bitLength >>> 0;
  view.setUint32(totalLength - 8, highBits, false);
  view.setUint32(totalLength - 4, lowBits, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  for (let chunkStart = 0; chunkStart < totalLength; chunkStart += 64) {
    const w = new Uint32Array(64);
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getUint32(chunkStart + i * 4, false);
    }

    for (let i = 16; i < 64; i += 1) {
      const s0 = rightRotate(w[i - 15], 7) ^ rightRotate(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rightRotate(w[i - 2], 17) ^ rightRotate(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i += 1) {
      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ ((~e) & g);
      const temp1 = (h + s1 + ch + SHA_256_K[i] + w[i]) >>> 0;
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((value) => value.toString(16).padStart(8, "0"))
    .join("");
}

/**
 * Check if a word has a medical or common English suffix that makes it
 * very unlikely to be a person's name. This is a generative approach
 * that catches terms not in the explicit whitelist.
 */
function hasMedicalOrCommonSuffix(word: string): boolean {
  const lower = word.toLowerCase();
  // Medical suffixes (almost never appear in names)
  const medicalSuffixes = [
    "itis", "osis", "emia", "emia", "ectomy", "otomy", "ostomy", "plasty",
    "graphy", "gram", "scopy", "oscopy", "pathy", "algia", "ology",
    "oma", "ular", "ical", "ogenic", "genic",
  ];
  // Common English suffixes that are rarely in names (4+ chars to avoid short-name collisions)
  const englishSuffixes = [
    "tion", "sion", "ment", "ness", "ance", "ence", "ible", "able",
    "ical", "ious", "eous", "ular", "ular", "ative", "itive",
    "ized", "ised", "izing", "ising", "ated", "ating",
  ];
  for (const suffix of medicalSuffixes) {
    if (lower.length > suffix.length + 2 && lower.endsWith(suffix)) return true;
  }
  for (const suffix of englishSuffixes) {
    if (lower.length > suffix.length + 2 && lower.endsWith(suffix)) return true;
  }
  return false;
}

/**
 * Check if a match occurs at the start of a sentence in the input text.
 * Sentence starts are almost always false positives for name detection.
 */
function isAtSentenceStart(matchIndex: number, input: string): boolean {
  if (matchIndex === 0) return true;
  // Look backwards from the match for sentence-ending punctuation
  const before = input.slice(0, matchIndex);
  const trimmedBefore = before.trimEnd();
  if (trimmedBefore.length === 0) return true;
  const lastChar = trimmedBefore[trimmedBefore.length - 1];
  return lastChar === '.' || lastChar === '!' || lastChar === '?' || lastChar === '\n' || lastChar === ':' || lastChar === ';';
}

/**
 * Check if a potential name match is actually NOT a real name.
 * Returns true if this is an acronym, common word, or other false positive.
 */
function isNotARealName(match: string): boolean {
  const trimmed = match.trim();

  // EMR LASTNAME, FIRSTNAME format - check if parts are known acronyms
  const emrPattern = /^[A-Z]{2,}(?:[-'][A-Z]+)?,\s*[A-Z][A-Za-z]+$/;
  if (emrPattern.test(trimmed)) {
    const [lastName, firstName] = trimmed.split(/,\s*/);
    return isKnownAcronym(lastName) || isKnownAcronym(firstName);
  }

  // Extract potential name words (skip context words from patterns)
  const words = trimmed.split(/\s+/);
  const contextWords = new Set([
    "patient", "pt", "pts", "the", "a", "an", "mr", "mrs", "ms", "miss", "dr",
    "mister", "missus",
    // Context words captured by "the [Name] case/scan" pattern
    "case", "scan", "study", "chart", "file",
  ]);
  const potentialNameWords = words.filter((w) => {
    const lower = w.toLowerCase().replace(/[.,!?;:'"]/g, "");
    return !contextWords.has(lower);
  });

  // If ALL words were filtered out (e.g., just "Patient"), it's NOT a real name
  if (potentialNameWords.length === 0) {
    return true;
  }

  // If any "name" words are common English/medical words, this is a false positive
  for (const word of potentialNameWords) {
    const cleanWord = word.replace(/[.,!?;:'"]/g, "");
    if (isCommonWord(cleanWord)) {
      return true;
    }
    // Check for medical/common suffixes (catches terms not in the explicit whitelist)
    if (hasMedicalOrCommonSuffix(cleanWord)) {
      return true;
    }
  }

  // Check for acronyms on remaining candidate name words only.
  return potentialNameWords.some((word) => {
    const cleanWord = word.replace(/[.,!?;:'"]/g, "");
    return isKnownAcronym(cleanWord) || looksLikeAcronym(cleanWord);
  });
}

function hashInput(input: string): string {
  return sha256Hex(input);
}

// ============================================
// THE 18 HIPAA IDENTIFIERS - PATTERNS
// ============================================

interface IdentifierPattern {
  type: PHIType;
  patterns: RegExp[];
  message: string;
}

const HIPAA_IDENTIFIERS: IdentifierPattern[] = [
  // 1. NAMES
  // NOTE: Standalone single-capitalized-word pattern removed — it caused rampant
  // false positives on medical terms, common English words, and any sentence-starting
  // word not in the whitelist. The remaining patterns are context-aware and high-precision.
  {
    type: "NAME",
    patterns: [
      // First Last name (e.g., "John Smith", "Mary Smith")
      // Filtered by isNotARealName() to exclude medical terms, common words, acronyms
      /\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b/g,
      // Honorific + Name
      /\b(?:mr|mrs|ms|miss|dr|mister|missus)\.?\s+[A-Za-z][a-z]+(?:\s+[A-Za-z][a-z]+)?\b/gi,
      // "patient [Name]" or "pt [Name]" where Name is capitalized (3+ chars)
      // NOTE: Uses /g not /gi — the 'i' flag makes [A-Z] match lowercase, causing over-matching
      /\b(?:[Pp]atient|[Pp]t|[Pp]ts)\.?\s+[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]+)?\b/g,
      // "[Name] patient" (not "middle aged patient")
      /\b[A-Z][a-z]{3,}\s+(?:patient|pt)\b/g,
      // LASTNAME, FIRSTNAME (EMR copy-paste format)
      /\b[A-Z]{2,}(?:[-'][A-Z]+)?,\s*[A-Z][A-Za-z]+\b/g,
      // "the [Name] case" or "the [Name]'s scan"
      // NOTE: Uses /g not /gi — see patient pattern note above
      /\b[Tt]he\s+[A-Z][a-z]{2,}(?:'s)?\s+(?:case|patient|scan|study|chart|file)\b/g,
    ],
    message: "Patient name detected",
  },

  // 2. GEOGRAPHIC (smaller than state)
  {
    type: "GEOGRAPHIC",
    patterns: [
      // Full street address
      /\b\d{1,5}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Ct|Court)\b/gi,
      // City, State ZIP pattern
      /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,?\s+[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/g,
      // Full 5-digit ZIP with context
      /\bzip(?:\s*code)?[:\s]*\d{5}(?:-\d{4})?\b/gi,
    ],
    message: "Geographic identifier detected",
  },

  // 3. DATES (with DOB/birth context) and AGES OVER 89
  {
    type: "DATE",
    patterns: [
      // Full dates with DOB/born context
      /\b(?:DOB|date\s*of\s*birth|born|birthday)[:\s]*\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/gi,
      /\b(?:DOB|born)[:\s]*(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[.\s]*\d{1,2}[,\s]*\d{4}\b/gi,
      // Admission/discharge dates with full date
      /\b(?:admitted|discharged|admission|discharge)\s*(?:date)?[:\s]*\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/gi,
    ],
    message: "Date (potential DOB or admission date) detected",
  },
  {
    type: "AGE_OVER_89",
    patterns: [
      // Ages 90 and over are PHI under HIPAA
      /\b(?:age[d]?\s*)?(?:9[0-9]|1[0-9]{2})\s*(?:year|yr|y\.?o\.?|yo)s?\s*(?:old)?\b/gi,
      /\b(?:9[0-9]|1[0-9]{2})\s*[-\s]?\s*(?:year|yr|y\.?o\.?|yo)[-\s]*(?:old)?\s*(?:male|female|m|f|man|woman)?\b/gi,
    ],
    message: "Age over 89 detected (HIPAA protected)",
  },

  // 4. PHONE NUMBERS
  {
    type: "PHONE",
    patterns: [
      // Phone with explicit context
      /\b(?:phone|cell|mobile|tel|contact|call|reach|callback|number)[:\s]*\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/gi,
      // Phone pattern with "at" or "is"
      /\b(?:at|is)\s+\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/gi,
      // Family contact phone
      /\b(?:wife|husband|spouse|mother|father|daughter|son|family|emergency\s*contact)(?:'s)?\s+(?:phone|number|cell)?[:\s]*\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/gi,
    ],
    message: "Phone number detected",
  },

  // 5. FAX NUMBERS
  {
    type: "FAX",
    patterns: [
      /\b(?:fax|facsimile)[:\s]*\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/gi,
    ],
    message: "Fax number detected",
  },

  // 6. EMAIL ADDRESSES
  {
    type: "EMAIL",
    patterns: [
      /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
    ],
    message: "Email address detected",
  },

  // 7. SOCIAL SECURITY NUMBERS
  {
    type: "SSN",
    patterns: [
      /\b\d{3}[-.\s]\d{2}[-.\s]\d{4}\b/g,
      /\bssn[:\s#]*\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/gi,
      /\bsocial\s*security[:\s#]*\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/gi,
      // Partially masked SSN is still PHI
      /\b[*xX]{3}[-.\s]?[*xX]{2}[-.\s]?\d{4}\b/g,
    ],
    message: "Social Security Number detected",
  },

  // 8. MEDICAL RECORD NUMBERS
  {
    type: "MRN",
    patterns: [
      /\bMRN[:\s#.\-]*\d{5,}/gi,
      /\bmedical\s*record\s*(?:number|no|#)?[:\s#.\-]*\d{5,}/gi,
      /\bpatient\s*id[:\s#.\-]*\d{5,}/gi,
      /\brecord\s*(?:number|no|#)[:\s#.\-]*\d{5,}/gi,
      /\bcase\s*(?:number|no|#)[:\s#.\-]*\d{6,}/gi,
      /\baccession[:\s#.\-]*\d{5,}/gi,
      /\bacc\s*#?[:\s]*\d{5,}/gi,
      /\bencounter[:\s#.\-]*\d{5,}/gi,
      /\benc[:\s#.\-]*\d{5,}/gi,
      /\bvisit\s*(?:number|no|#)?[:\s#.\-]*\d{5,}/gi,
      /\bfin[:\s#.\-]*\d{5,}/gi,
      /\bcsn[:\s#.\-]*\d{5,}/gi,
      // Formatted MRNs: RAD-2024-0847362
      /\b(?:RAD|IMG|CT|MR|US|NM)[-\s]?\d{4}[-\s]?\d{5,}/gi,
    ],
    message: "Medical record number or case number detected",
  },

  // 9. HEALTH PLAN BENEFICIARY NUMBERS
  {
    type: "HEALTH_PLAN_ID",
    patterns: [
      /\b(?:insurance|policy|member|beneficiary|plan)\s*(?:id|number|no|#)[:\s#.\-]*[A-Z0-9]{6,}/gi,
    ],
    message: "Health plan ID detected",
  },

  // 10. ACCOUNT NUMBERS
  {
    type: "ACCOUNT_NUMBER",
    patterns: [
      /\b(?:account|acct|billing)\s*(?:number|no|#)[:\s#.\-]*\d{6,}/gi,
    ],
    message: "Account number detected",
  },

  // 11-17: Less common in clinical chat, but included for completeness
  {
    type: "LICENSE_NUMBER",
    patterns: [
      /\b(?:license|certificate|cert)\s*(?:number|no|#)[:\s#.\-]*[A-Z0-9]{5,}/gi,
      /\bdriver'?s?\s*license[:\s#.\-]*[A-Z0-9]{5,}/gi,
    ],
    message: "License or certificate number detected",
  },

  {
    type: "VEHICLE_ID",
    patterns: [
      /\b(?:license\s*plate|VIN|vehicle\s*id)[:\s#.\-]*[A-Z0-9]{5,}/gi,
    ],
    message: "Vehicle identifier detected",
  },

  {
    type: "DEVICE_ID",
    patterns: [
      /\b(?:device|serial|UDI)\s*(?:number|no|#|id)[:\s#.\-]*[A-Z0-9]{6,}/gi,
    ],
    message: "Device identifier detected",
  },

  {
    type: "IP_ADDRESS",
    patterns: [
      /\b(?:IP|ip\s*address)[:\s]*\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/gi,
    ],
    message: "IP address detected",
  },
];

// ============================================
// WARNING PATTERNS (Not PHI, but risk)
// ============================================

interface WarningPattern {
  type: WarningType;
  patterns: RegExp[];
  message: string;
}

const WARNING_PATTERNS: WarningPattern[] = [
  // Temporal + clinical event (could identify in small department)
  {
    type: "TEMPORAL_IDENTIFIER",
    patterns: [
      /\b(?:yesterday|today|this\s*morning|last\s*night|tuesday|wednesday|monday|thursday|friday|saturday|sunday)'?s?\s+(?:patient|pt|case|contrast\s*reaction|code|anaphylaxis|emergency)/gi,
      /\bthe\s+(?:patient|pt|one)\s+(?:from\s+)?(?:yesterday|this\s*morning|last\s*night|earlier|today)/gi,
    ],
    message: "Time-based reference may be identifying in small department. Consider removing temporal context.",
  },

  // Rare conditions (small population = higher re-identification risk)
  {
    type: "RARE_CONDITION",
    patterns: [
      /\b(?:our|the)\s+(?:only|sole)\s+(?:patient|pt|case)\s+with/gi,
      /\bthe\s+(?:patient|pt)\s+who\s+(?:coded|arrested|died|had\s+anaphylaxis)/gi,
    ],
    message: "Unique clinical event reference may be identifying. Consider generalizing.",
  },

  // Room/bed numbers (identifying in real-time context)
  {
    type: "LOCATION_CONTEXT",
    patterns: [
      /\b(?:room|rm|bed|bay|slot)\s*#?\s*[A-Z]?\d{1,4}[A-Z]?\s+(?:patient|pt)/gi,
      /\b(?:patient|pt)\s+(?:in\s+)?(?:room|rm|bed|bay)\s*#?\s*[A-Z]?\d{1,4}[A-Z]?\b/gi,
    ],
    message: "Room or bed number may identify current patients. Consider removing location.",
  },
];

// ============================================
// MAIN DETECTION FUNCTION
// ============================================

export function detectPotentialPHI(
  input: string,
  _options: {
    strictMode?: boolean;
    debug?: boolean;
    includePositions?: boolean;
  } = {}
): PHIValidationResult {
  const detections: PHIDetection[] = [];
  const warnings: PHIWarning[] = [];
  const detectionSpans: PHIDetectionSpan[] = [];
  const inputHash = hashInput(input);
  const seenSpanIds = new Set<string>();

  // Check for HIPAA identifiers (these are PHI - must block)
  for (const identifier of HIPAA_IDENTIFIERS) {
    identifier.patterns.forEach((pattern, patternIndex) => {
      const matches = getRegexMatches(input, pattern);
      if (matches.length === 0) return;

      for (const match of matches) {
        if (identifier.type === "NAME") {
          if (isNotARealName(match.text)) continue;
          const score = scoreNameMatch(match.text, match.index, input);
          if (!score.accepted) continue;

          const spanId = buildSpanId(identifier.type, match.index, match.index + match.text.length);
          if (seenSpanIds.has(spanId)) continue;
          seenSpanIds.add(spanId);
          detectionSpans.push({
            id: spanId,
            type: identifier.type,
            start: match.index,
            end: match.index + match.text.length,
            text: match.text,
            ruleId: `${identifier.type.toLowerCase()}-${patternIndex + 1}`,
            confidence: score.confidence,
          });
          continue;
        }

        if (
          identifier.type === "GEOGRAPHIC" &&
          patternIndex === 0 &&
          shouldSuppressGeographicStreetSuffixMatch(match.text)
        ) {
          continue;
        }

        const spanId = buildSpanId(identifier.type, match.index, match.index + match.text.length);
        if (seenSpanIds.has(spanId)) continue;
        seenSpanIds.add(spanId);
        detectionSpans.push({
          id: spanId,
          type: identifier.type,
          start: match.index,
          end: match.index + match.text.length,
          text: match.text,
          ruleId: `${identifier.type.toLowerCase()}-${patternIndex + 1}`,
          confidence: 0.98,
        });
      }
    });

    // Additional pass for overlapping adjacent word pairs.
    // Regex global matching is non-overlapping, so this catches mixed/lowercase
    // full names embedded in longer text (e.g., "katie Katie johnson Johnson").
    if (identifier.type === "NAME") {
      const pairCandidates = getAdjacentWordPairCandidates(input);
      for (const candidate of pairCandidates) {
        if (isNotARealName(candidate.text)) continue;
        const score = scoreNameMatch(candidate.text, candidate.index, input);
        if (!score.accepted) continue;

        const spanId = buildSpanId(identifier.type, candidate.index, candidate.index + candidate.text.length);
        if (seenSpanIds.has(spanId)) continue;
        seenSpanIds.add(spanId);
        detectionSpans.push({
          id: spanId,
          type: identifier.type,
          start: candidate.index,
          end: candidate.index + candidate.text.length,
          text: candidate.text,
          ruleId: "name-adjacent-pair",
          confidence: score.confidence,
        });
      }
    }

    if (detectionSpans.some((span) => span.type === identifier.type)) {
      detections.push({
        type: identifier.type,
        pattern: identifier.type,
        message: identifier.message,
      });
    }
  }

  // Check for warning patterns (not PHI, but re-identification risk)
  for (const warning of WARNING_PATTERNS) {
    for (const pattern of warning.patterns) {
      pattern.lastIndex = 0;
      if (pattern.test(input)) {
        if (!warnings.some((w) => w.type === warning.type)) {
          warnings.push({
            type: warning.type,
            message: warning.message,
          });
        }
        break;
      }
    }
  }

  // Build summary
  let summary = "";
  if (detections.length > 0) {
    summary = `${detections[0].message}. Remove patient identifiers before sending.`;
  } else if (warnings.length > 0) {
    summary = warnings[0].message;
  }

  const hasPHI = detections.length > 0;
  const hasWarning = warnings.length > 0;

  return {
    hasPHI,
    hasWarning,
    detections,
    warnings,
    detectionSpans,
    inputHash,
    summary,
    // Legacy compatibility fields
    hasPotentialPHI: hasPHI,
    isBlocked: hasPHI,
    signals: [],
    sanitizedText: null,
  };
}

// ============================================
// CONVENIENCE EXPORTS
// ============================================

export class PHIDetectedError extends Error {
  public readonly detections: PHIDetection[];
  public readonly inputHash: string;
  public readonly warnings: PHIWarning[];

  constructor(result: PHIValidationResult) {
    super(result.summary || "Protected health information detected");
    this.name = "PHIDetectedError";
    this.detections = result.detections;
    this.inputHash = result.inputHash;
    this.warnings = result.detections.map((d) => ({
      type: d.type,
      message: d.message,
    }));
  }
}

/**
 * Throws if actual HIPAA identifiers are found.
 * Warnings do NOT throw - they're informational only.
 */
export function validateNoPHI(
  input: string,
  _options: { strictMode?: boolean } = {}
): string {
  const result = detectPotentialPHI(input);
  if (result.hasPHI) {
    throw new PHIDetectedError(result);
  }
  return input;
}

/**
 * Quick check for UI - returns blocking status and message
 */
export function quickPHICheck(input: string): {
  isBlocked: boolean;
  hasWarning: boolean;
  message: string | null;
} {
  const result = detectPotentialPHI(input);
  return {
    isBlocked: result.hasPHI,
    hasWarning: result.hasWarning,
    message: result.summary || null,
  };
}

/**
 * Checks if text is safe (no PHI detected) - legacy compatibility
 */
export function isSafeText(text: string): boolean {
  return !detectPotentialPHI(text).hasPHI;
}

/**
 * Prepare sanitized data for audit logging
 */
export function prepareAuditData(result: PHIValidationResult): {
  inputHash: string;
  detectionTypes: PHIType[];
  detectionSpanIds: string[];
  warningTypes: WarningType[];
  blocked: boolean;
} {
  return {
    inputHash: result.inputHash,
    detectionTypes: result.detections.map((d) => d.type),
    detectionSpanIds: result.detectionSpans.map((span) => span.id),
    warningTypes: result.warnings.map((w) => w.type as WarningType),
    blocked: result.hasPHI,
  };
}

// Product policy: all PHI types are override-capable when users explicitly acknowledge.
const OVERRIDABLE_PHI_TYPES: Set<PHIType> = new Set([
  "NAME",
  "DATE",
  "PHONE",
  "FAX",
  "EMAIL",
  "SSN",
  "MRN",
  "HEALTH_PLAN_ID",
  "ACCOUNT_NUMBER",
  "LICENSE_NUMBER",
  "VEHICLE_ID",
  "DEVICE_ID",
  "URL",
  "IP_ADDRESS",
  "BIOMETRIC",
  "PHOTO",
  "OTHER_UNIQUE_ID",
  "AGE_OVER_89",
  "GEOGRAPHIC",
]);

function normalizeOverrideSelections(
  overrides: PHIOverrideSelection[] | undefined
): PHIOverrideSelection[] {
  if (!overrides || overrides.length === 0) return [];
  return overrides.filter((override) => {
    return (
      override.acknowledged === true &&
      typeof override.spanId === "string" &&
      typeof override.type === "string" &&
      typeof override.inputHash === "string"
    );
  });
}

/**
 * Check if a PHI detection result can be overridden by the user.
 * Current policy allows override for all PHI types when explicit acknowledgements are present.
 * Returns true when all detected PHI types are in the overridable policy set.
 */
export function isOverridableBlock(result: PHIValidationResult): boolean {
  if (!result.hasPHI) return false;
  return result.detections.every((d) => OVERRIDABLE_PHI_TYPES.has(d.type));
}

export function getUnresolvedBlockingSpans(
  result: PHIValidationResult,
  overrides?: PHIOverrideSelection[]
): PHIDetectionSpan[] {
  if (!result.hasPHI) return [];
  const normalizedOverrides = normalizeOverrideSelections(overrides);
  const acknowledgedSpanIds = new Set(
    normalizedOverrides
      .filter((override) => override.inputHash === result.inputHash)
      .map((override) => override.spanId)
  );

  return result.detectionSpans.filter((span) => !acknowledgedSpanIds.has(span.id));
}

export function hasFullPHIOverride(
  result: PHIValidationResult,
  overrides?: PHIOverrideSelection[]
): boolean {
  if (!result.hasPHI) return true;
  if (!isOverridableBlock(result)) return false;
  return getUnresolvedBlockingSpans(result, overrides).length === 0;
}
