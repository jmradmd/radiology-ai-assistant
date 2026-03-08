import { PrismaClient, Institution } from "@prisma/client";
import { generateEmbedding } from "../packages/api/src/lib/embedding-client";
import * as fs from "fs";
import * as path from "path";
import pdf from "pdf-parse";
import { INSTITUTION_CONFIG } from "@rad-assist/shared";

const prisma = new PrismaClient();

// Root folders to ingest - maps to institution based on INSTITUTION_CONFIG.sourceFolder
const ROOT_FOLDERS = ["./institution-b-policies", "./institution-a-policies"];

/**
 * Detect institution from file path by matching against INSTITUTION_CONFIG.sourceFolder
 */
function detectInstitution(filePath: string): Institution {
  const normalizedPath = filePath.replace(/\\/g, "/");
  
  for (const [instId, config] of Object.entries(INSTITUTION_CONFIG)) {
    if (config.sourceFolder && normalizedPath.includes(config.sourceFolder)) {
      return instId as Institution;
    }
  }
  
  // Default to Institution B if no match
  return "INSTITUTION_B";
}

// ============================================================================
// CATEGORY TAXONOMY - Based on actual Institution B folder structure
// ============================================================================

type PrimaryCategory =
  | "CONTRAST" // Contrast media, reactions, gadolinium, premedication
  | "MRI_SAFETY" // MRI safety, implants, zones, screening
  | "CT_PROTOCOL" // CT, CTA, PET, cardiac imaging, radiation protocols
  | "MAMMO" // Mammography, breast imaging, MQSA
  | "ULTRASOUND" // Ultrasound protocols
  | "MEDICATION" // Sedation, premedication, drug administration
  | "NURSING" // IV access, extravasation, nursing procedures
  | "PEDIATRIC" // Pediatric-specific protocols
  | "PREGNANCY" // Pregnancy screening, imaging in pregnancy
  | "RENAL" // Renal function, eGFR, contrast nephropathy
  | "SAFETY" // Radiation safety, fire, infection control
  | "WORKFLOW" // Scheduling, patient flow, add-ons
  | "CRITICAL" // Critical results, emergency protocols
  | "COMPLIANCE" // MQSA, regulatory, documentation
  | "GENERAL"; // Administrative, HR, general policies

type Subspecialty =
  | "ABDOMINAL"
  | "NEURO"
  | "MSK"
  | "CHEST"
  | "IR"
  | "PEDS"
  | "BREAST"
  | "NUCLEAR"
  | "CARDIAC"
  | "EMERGENCY"
  | "ALL"; // Applies to all subspecialties

interface DocumentMetadata {
  category: PrimaryCategory;
  subspecialties: Subspecialty[];
  priority: "CRITICAL" | "HIGH" | "STANDARD";
  tags: string[];
}

// ============================================================================
// FOLDER-BASED PRIMARY CATEGORIZATION
// ============================================================================

const FOLDER_CATEGORY_MAP: Record<string, Partial<DocumentMetadata>> = {
  "Contrast Policies": {
    category: "CONTRAST",
    subspecialties: ["ALL"],
    priority: "CRITICAL",
    tags: ["contrast", "iodine", "gadolinium", "reaction", "allergy"],
  },
  "CT,PET, X-Ray, Dexa": {
    category: "CT_PROTOCOL",
    subspecialties: ["ALL"],
    priority: "HIGH",
    tags: ["ct", "pet", "xray", "dexa", "radiation"],
  },
  "CT, PET, X-Ray, Dexa": {
    category: "CT_PROTOCOL",
    subspecialties: ["ALL"],
    priority: "HIGH",
    tags: ["ct", "pet", "xray", "dexa", "radiation"],
  },
  MRI: {
    category: "MRI_SAFETY",
    subspecialties: ["ALL"],
    priority: "CRITICAL",
    tags: ["mri", "magnet", "implant", "pacemaker", "safety"],
  },
  "MRI Checklist and PowerPoint": {
    category: "MRI_SAFETY",
    subspecialties: ["ALL"],
    priority: "HIGH",
    tags: ["mri", "checklist", "screening"],
  },
  Mammo: {
    category: "MAMMO",
    subspecialties: ["BREAST"],
    priority: "HIGH",
    tags: ["mammography", "breast", "mqsa", "screening"],
  },
  Nurses: {
    category: "NURSING",
    subspecialties: ["ALL"],
    priority: "HIGH",
    tags: ["nursing", "iv", "medication", "patient care"],
  },
  Ultrasound: {
    category: "ULTRASOUND",
    subspecialties: ["ABDOMINAL", "CARDIAC"],
    priority: "STANDARD",
    tags: ["ultrasound", "sonography", "doppler"],
  },
  "General Guidelines & Procedures": {
    category: "WORKFLOW",
    subspecialties: ["ALL"],
    priority: "STANDARD",
    tags: ["workflow", "procedure", "guideline"],
  },
  "General Policies": {
    category: "GENERAL",
    subspecialties: ["ALL"],
    priority: "STANDARD",
    tags: ["policy", "administrative"],
  },
  "Emergency Plans": {
    category: "SAFETY",
    subspecialties: ["ALL"],
    priority: "CRITICAL",
    tags: ["emergency", "safety", "evacuation"],
  },
  "Fire Safety Plans": {
    category: "SAFETY",
    subspecialties: ["ALL"],
    priority: "CRITICAL",
    tags: ["fire", "safety", "evacuation"],
  },
};

// ============================================================================
// FILENAME KEYWORD PATTERN MATCHING (Override/Refine folder category)
// ============================================================================

interface KeywordRule {
  patterns: RegExp[];
  category: PrimaryCategory;
  subspecialties?: Subspecialty[];
  priority?: "CRITICAL" | "HIGH" | "STANDARD";
  tags: string[];
}

const KEYWORD_RULES: KeywordRule[] = [
  // ========== CONTRAST (CRITICAL) ==========
  {
    patterns: [/contrast\s*reaction/i, /management\s*of\s*contrast/i, /anaphyla/i],
    category: "CONTRAST",
    priority: "CRITICAL",
    tags: ["contrast", "reaction", "emergency", "anaphylaxis"],
  },
  {
    patterns: [
      /history\s*of\s*reaction/i,
      /prior\s*reaction/i,
      /allergy.*contrast/i,
      /contrast.*allergy/i,
    ],
    category: "CONTRAST",
    priority: "CRITICAL",
    tags: ["contrast", "allergy", "history", "premedication"],
  },
  {
    patterns: [/premedication/i, /pre-medication/i, /pre\s*med/i, /steroid\s*prep/i],
    category: "CONTRAST",
    priority: "CRITICAL",
    tags: ["premedication", "prophylaxis", "steroid", "contrast"],
  },
  {
    patterns: [/gadolinium/i, /gbca/i, /gd-/i],
    category: "CONTRAST",
    subspecialties: ["NEURO", "MSK", "ABDOMINAL"],
    priority: "HIGH",
    tags: ["gadolinium", "mri", "contrast"],
  },
  {
    patterns: [/iodinated/i, /iodine/i, /omnipaque/i, /isovue/i, /visipaque/i],
    category: "CONTRAST",
    priority: "HIGH",
    tags: ["iodinated", "ct", "contrast"],
  },
  {
    patterns: [/contrast.*oral/i, /oral.*contrast/i, /peg.*contrast/i, /rectal.*contrast/i, /enema/i],
    category: "CONTRAST",
    subspecialties: ["ABDOMINAL"],
    priority: "STANDARD",
    tags: ["oral", "rectal", "gi", "contrast"],
  },
  {
    patterns: [/breastfeeding/i, /breast\s*feeding/i, /lactation.*contrast/i, /nursing\s*mother/i],
    category: "CONTRAST",
    priority: "HIGH",
    tags: ["breastfeeding", "lactation", "contrast", "pregnancy"],
  },

  // ========== RENAL (CRITICAL) ==========
  {
    patterns: [/renal\s*function/i, /egfr/i, /creatinine/i, /kidney/i, /nephro/i, /aki/i, /contrast.induced/i],
    category: "RENAL",
    priority: "CRITICAL",
    tags: ["renal", "kidney", "egfr", "creatinine", "nephropathy"],
  },
  {
    patterns: [/metformin/i, /glucophage/i],
    category: "RENAL",
    priority: "HIGH",
    tags: ["metformin", "diabetes", "renal", "contrast"],
  },

  // ========== MRI SAFETY (CRITICAL) ==========
  {
    patterns: [/mri\s*safety/i, /mr\s*safety/i, /magnet.*safety/i],
    category: "MRI_SAFETY",
    priority: "CRITICAL",
    tags: ["mri", "safety", "screening"],
  },
  {
    patterns: [/pacemaker/i, /icd/i, /defibrillator/i, /cardiac\s*device/i, /cied/i],
    category: "MRI_SAFETY",
    subspecialties: ["CARDIAC"],
    priority: "CRITICAL",
    tags: ["pacemaker", "cardiac", "implant", "mri"],
  },
  {
    patterns: [/implant.*mri/i, /mri.*implant/i, /stent/i, /tissue\s*expander/i, /prosthes/i],
    category: "MRI_SAFETY",
    priority: "CRITICAL",
    tags: ["implant", "stent", "prosthesis", "mri"],
  },
  {
    patterns: [/mri.*zone/i, /zone.*mri/i, /ferromagnetic/i, /metal.*free/i, /projectile/i],
    category: "MRI_SAFETY",
    priority: "CRITICAL",
    tags: ["zone", "ferromagnetic", "safety", "mri"],
  },
  {
    patterns: [/claustrophob/i, /anxiety.*mri/i, /sedation.*mri/i],
    category: "MRI_SAFETY",
    priority: "STANDARD",
    tags: ["claustrophobia", "anxiety", "sedation", "mri"],
  },

  // ========== MRI PROTOCOLS (Non-safety) ==========
  {
    patterns: [/mrcp/i, /secretin/i],
    category: "MRI_SAFETY",
    subspecialties: ["ABDOMINAL"],
    priority: "STANDARD",
    tags: ["mrcp", "pancreas", "biliary", "mri"],
  },
  {
    patterns: [/mre\b/i, /mr\s*enterography/i],
    category: "MRI_SAFETY",
    subspecialties: ["ABDOMINAL"],
    priority: "STANDARD",
    tags: ["mre", "enterography", "gi", "mri"],
  },
  {
    patterns: [/cardiac\s*mri/i, /cmr\b/i, /stress.*mri/i, /regadenoson/i],
    category: "MRI_SAFETY",
    subspecialties: ["CARDIAC"],
    priority: "HIGH",
    tags: ["cardiac", "stress", "mri"],
  },
  {
    patterns: [/defecography/i, /pelvic\s*floor/i],
    category: "MRI_SAFETY",
    subspecialties: ["ABDOMINAL"],
    priority: "STANDARD",
    tags: ["defecography", "pelvic", "mri"],
  },
  {
    patterns: [/pregnan.*mri/i, /mri.*pregnan/i, /fetal\s*mri/i],
    category: "PREGNANCY",
    subspecialties: ["ABDOMINAL", "PEDS"],
    priority: "HIGH",
    tags: ["pregnancy", "fetal", "mri"],
  },

  // ========== CT PROTOCOLS ==========
  {
    patterns: [/cardiac\s*ct/i, /cta\b/i, /ccta/i, /coronary/i, /hr\s*lowering/i, /beta.*block/i],
    category: "CT_PROTOCOL",
    subspecialties: ["CARDIAC"],
    priority: "HIGH",
    tags: ["cardiac", "cta", "coronary", "ct"],
  },
  {
    patterns: [/ct\s*enterography/i, /cte\b/i],
    category: "CT_PROTOCOL",
    subspecialties: ["ABDOMINAL"],
    priority: "STANDARD",
    tags: ["enterography", "gi", "ct"],
  },
  {
    patterns: [/cystogram/i, /vcug/i],
    category: "CT_PROTOCOL",
    subspecialties: ["ABDOMINAL"],
    priority: "STANDARD",
    tags: ["cystogram", "bladder", "ct", "fluoro"],
  },
  {
    patterns: [/pet\b/i, /fdg/i, /nuclear/i],
    category: "CT_PROTOCOL",
    subspecialties: ["NUCLEAR"],
    priority: "HIGH",
    tags: ["pet", "nuclear", "fdg"],
  },
  {
    patterns: [/lung\s*screen/i, /ldct/i, /low.dose.*ct/i],
    category: "CT_PROTOCOL",
    subspecialties: ["CHEST"],
    priority: "STANDARD",
    tags: ["lung", "screening", "ldct", "ct"],
  },

  // ========== MAMMOGRAPHY ==========
  {
    patterns: [/mammo/i, /breast\s*imag/i, /mqsa/i, /birads/i, /bi-rads/i],
    category: "MAMMO",
    subspecialties: ["BREAST"],
    priority: "HIGH",
    tags: ["mammography", "breast", "screening"],
  },
  {
    patterns: [/stereotactic/i, /breast\s*biopsy/i, /tomosynthesis/i],
    category: "MAMMO",
    subspecialties: ["BREAST"],
    priority: "HIGH",
    tags: ["biopsy", "stereotactic", "breast"],
  },

  // ========== MEDICATION / SEDATION ==========
  {
    patterns: [/sedation/i, /conscious\s*sedation/i, /moderate\s*sedation/i, /anxiolysis/i],
    category: "MEDICATION",
    priority: "HIGH",
    tags: ["sedation", "anxiolysis", "medication"],
  },
  {
    patterns: [/insulin\s*pump/i, /glucose/i, /diabet/i],
    category: "MEDICATION",
    priority: "HIGH",
    tags: ["insulin", "diabetes", "glucose", "pump"],
  },
  {
    patterns: [/medication.*expir/i, /drug.*storage/i, /medication.*label/i, /medication.*storage/i],
    category: "MEDICATION",
    priority: "STANDARD",
    tags: ["medication", "storage", "labeling"],
  },
  {
    patterns: [/emergency\s*medication/i, /crash\s*cart/i, /code\s*cart/i],
    category: "MEDICATION",
    priority: "CRITICAL",
    tags: ["emergency", "medication", "crash cart"],
  },

  // ========== NURSING / IV ==========
  {
    patterns: [/iv\s*access/i, /peripheral.*venous/i, /catheter.*insertion/i, /cvc/i, /central.*line/i],
    category: "NURSING",
    priority: "HIGH",
    tags: ["iv", "catheter", "access", "nursing"],
  },
  {
    patterns: [/extravasation/i, /infiltration/i],
    category: "NURSING",
    priority: "CRITICAL",
    tags: ["extravasation", "infiltration", "contrast", "emergency"],
  },
  {
    patterns: [/cardiac\s*arrest/i, /code\s*blue/i, /resuscitation/i, /cpr/i, /aed/i],
    category: "NURSING",
    priority: "CRITICAL",
    tags: ["cardiac arrest", "code", "emergency", "resuscitation"],
  },
  {
    patterns: [/blood\s*glucose/i, /i-stat/i, /point.*care/i],
    category: "NURSING",
    priority: "STANDARD",
    tags: ["glucose", "point of care", "testing"],
  },

  // ========== PEDIATRIC ==========
  {
    patterns: [/peds\b/i, /pediatric/i, /child/i, /infant/i, /neonat/i, /under\s*\d+\s*year/i],
    category: "PEDIATRIC",
    subspecialties: ["PEDS"],
    priority: "HIGH",
    tags: ["pediatric", "child"],
  },

  // ========== PREGNANCY ==========
  {
    patterns: [/pregnan/i, /fetus/i, /fetal/i, /gestational/i, /obstetric/i],
    category: "PREGNANCY",
    priority: "HIGH",
    tags: ["pregnancy", "fetal", "obstetric"],
  },
  {
    patterns: [/radiation.*pregnan/i, /pregnan.*radiation/i, /pregnant\s*employee/i],
    category: "PREGNANCY",
    priority: "HIGH",
    tags: ["pregnancy", "radiation", "employee"],
  },

  // ========== SAFETY ==========
  {
    patterns: [/radiation\s*protection/i, /radiation\s*safety/i, /dosimetry/i, /badge/i],
    category: "SAFETY",
    priority: "HIGH",
    tags: ["radiation", "protection", "safety", "dosimetry"],
  },
  {
    patterns: [/radioactive.*waste/i, /nuclear.*waste/i, /disposal/i],
    category: "SAFETY",
    subspecialties: ["NUCLEAR"],
    priority: "STANDARD",
    tags: ["radioactive", "waste", "disposal"],
  },
  {
    patterns: [/fire/i, /evacuation/i, /emergency\s*plan/i],
    category: "SAFETY",
    priority: "CRITICAL",
    tags: ["fire", "evacuation", "emergency"],
  },
  {
    patterns: [/infection\s*control/i, /hand\s*hygiene/i, /disinfect/i, /steriliz/i],
    category: "SAFETY",
    priority: "HIGH",
    tags: ["infection", "hygiene", "disinfection"],
  },
  {
    patterns: [/body\s*fluid/i, /needle\s*stick/i, /blood.*exposure/i, /sharps/i],
    category: "SAFETY",
    priority: "CRITICAL",
    tags: ["exposure", "needlestick", "bloodborne"],
  },
  {
    patterns: [/clinical\s*waste/i, /biohazard/i, /hazardous.*waste/i],
    category: "SAFETY",
    priority: "STANDARD",
    tags: ["waste", "biohazard", "disposal"],
  },

  // ========== CRITICAL RESULTS ==========
  {
    patterns: [/critical\s*result/i, /critical\s*finding/i, /critical\s*value/i, /urgent.*communicat/i],
    category: "CRITICAL",
    priority: "CRITICAL",
    tags: ["critical", "result", "communication", "urgent"],
  },
  {
    patterns: [/verbal.*result/i, /telephone.*result/i, /read.*back/i],
    category: "CRITICAL",
    priority: "HIGH",
    tags: ["verbal", "communication", "result"],
  },

  // ========== WORKFLOW ==========
  {
    patterns: [/workflow/i, /patient\s*flow/i, /add.on/i, /same.day/i, /urgent.*add/i],
    category: "WORKFLOW",
    priority: "STANDARD",
    tags: ["workflow", "scheduling", "add-on"],
  },
  {
    patterns: [/patient\s*dismissal/i, /discharge/i],
    category: "WORKFLOW",
    priority: "STANDARD",
    tags: ["discharge", "dismissal", "workflow"],
  },
  {
    patterns: [/no.show/i, /cancellation/i, /late.*arrival/i],
    category: "WORKFLOW",
    priority: "STANDARD",
    tags: ["no show", "cancellation", "scheduling"],
  },
  {
    patterns: [/epic/i, /uploading/i, /pacs/i],
    category: "WORKFLOW",
    priority: "STANDARD",
    tags: ["epic", "pacs", "system", "workflow"],
  },
  {
    patterns: [/prep\b/i, /npo/i, /fasting/i, /bowel\s*prep/i],
    category: "WORKFLOW",
    priority: "HIGH",
    tags: ["prep", "npo", "fasting", "preparation"],
  },

  // ========== COMPLIANCE ==========
  {
    patterns: [/consent/i, /waiver/i, /abn\b/i, /authorization/i],
    category: "COMPLIANCE",
    priority: "STANDARD",
    tags: ["consent", "waiver", "authorization"],
  },
  {
    patterns: [/chaperone/i],
    category: "COMPLIANCE",
    priority: "STANDARD",
    tags: ["chaperone", "policy"],
  },
  {
    patterns: [/prescription.*required/i, /order.*required/i],
    category: "COMPLIANCE",
    priority: "STANDARD",
    tags: ["prescription", "order", "compliance"],
  },
  {
    patterns: [/patient.*rights/i, /patient.*responsib/i],
    category: "COMPLIANCE",
    priority: "STANDARD",
    tags: ["patient rights", "responsibilities"],
  },
  {
    patterns: [/verification/i, /identification/i, /timeout/i],
    category: "COMPLIANCE",
    priority: "HIGH",
    tags: ["verification", "identification", "safety"],
  },
];

// ============================================================================
// CLASSIFICATION ENGINE
// ============================================================================

function classifyDocument(filePath: string, filename: string): DocumentMetadata {
  // Start with defaults
  let metadata: DocumentMetadata = {
    category: "GENERAL",
    subspecialties: ["ALL"],
    priority: "STANDARD",
    tags: [],
  };

  // 1. Check parent folder for primary category
  const parentFolder = path.basename(path.dirname(filePath));
  const folderMeta = FOLDER_CATEGORY_MAP[parentFolder];

  if (folderMeta) {
    metadata = {
      ...metadata,
      ...folderMeta,
      tags: [...(folderMeta.tags || [])],
    } as DocumentMetadata;
  }

  // 2. Apply keyword rules (can override folder category if more specific)
  const filenameClean = filename.replace(/\.pdf$/i, "");

  for (const rule of KEYWORD_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(filenameClean)) {
        // More specific rules override
        metadata.category = rule.category;
        if (rule.subspecialties) {
          metadata.subspecialties = rule.subspecialties;
        }
        if (rule.priority) {
          metadata.priority = rule.priority;
        }
        // Accumulate tags
        metadata.tags = [...new Set([...metadata.tags, ...rule.tags])];
        break; // First matching pattern wins for this rule
      }
    }
  }

  // 3. Extract additional keywords from filename for tags
  const additionalTags = extractKeywordsFromFilename(filenameClean);
  metadata.tags = [...new Set([...metadata.tags, ...additionalTags])];

  return metadata;
}

function extractKeywordsFromFilename(filename: string): string[] {
  const tags: string[] = [];
  const lower = filename.toLowerCase();

  // Common radiology terms
  const terms = [
    "ct",
    "mri",
    "pet",
    "xray",
    "ultrasound",
    "mammo",
    "fluoro",
    "contrast",
    "iv",
    "oral",
    "injection",
    "biopsy",
    "safety",
    "emergency",
    "protocol",
    "policy",
    "guideline",
    "pediatric",
    "adult",
    "outpatient",
    "inpatient",
    "cardiac",
    "neuro",
    "abdominal",
    "chest",
    "msk",
    "breast",
  ];

  for (const term of terms) {
    if (lower.includes(term)) {
      tags.push(term);
    }
  }

  return tags;
}

// ============================================================================
// PDF PROCESSING
// ============================================================================

async function extractTextFromPDF(filePath: string): Promise<string> {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdf(dataBuffer);
    return data.text;
  } catch (error) {
    console.error(`   PDF extraction failed: ${error}`);
    return "";
  }
}

function chunkText(text: string, maxChars: number = 1500, overlapChars: number = 200): string[] {
  // Preserve paragraph structure - only normalize line endings
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();

  // If text is short enough, return as single chunk
  if (normalized.length <= maxChars) {
    return normalized.length > 100 ? [normalized] : [];
  }

  const chunks: string[] = [];

  // Split by double newlines (paragraphs)
  const paragraphs = normalized.split(/\n\n+/);

  let currentChunk = "";

  for (const para of paragraphs) {
    const trimmedPara = para.trim();
    if (!trimmedPara) continue;

    // If adding this paragraph exceeds max, save current and start new
    if (currentChunk.length + trimmedPara.length + 2 > maxChars && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());

      // Create overlap from end of previous chunk
      const words = currentChunk.split(/\s+/);
      const overlapWords = words.slice(-Math.ceil(overlapChars / 6)); // ~6 chars per word
      currentChunk = overlapWords.join(" ") + "\n\n" + trimmedPara;
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + trimmedPara;
    }
  }

  // Don't forget the last chunk
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  // If still only 1 chunk and it's very long, force split by sentences
  if (chunks.length === 1 && chunks[0].length > maxChars * 2) {
    return forceSplitLongText(chunks[0], maxChars, overlapChars);
  }

  return chunks.filter((c) => c.length > 100);
}

function forceSplitLongText(text: string, maxChars: number, overlapChars: number): string[] {
  const chunks: string[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);

  let currentChunk = "";

  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length + 1 > maxChars && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());

      // Overlap: take last ~overlapChars characters
      const overlap = currentChunk.slice(-overlapChars);
      currentChunk = overlap + " " + sentence;
    } else {
      currentChunk += (currentChunk ? " " : "") + sentence;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks.filter((c) => c.length > 100);
}

// generateEmbedding imported from embedding-client

// ============================================================================
// FILE SCANNING
// ============================================================================

function getAllPDFs(dir: string): string[] {
  const files: string[] = [];

  try {
    const items = fs.readdirSync(dir);

    for (const item of items) {
      // Skip hidden files and system files
      if (item.startsWith(".") || item.startsWith("~")) continue;

      const fullPath = path.join(dir, item);

      try {
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          files.push(...getAllPDFs(fullPath));
        } else if (item.toLowerCase().endsWith(".pdf")) {
          files.push(fullPath);
        }
      } catch (e) {
        console.warn(`   Skipping inaccessible: ${fullPath}`);
      }
    }
  } catch (e) {
    console.warn(`   Cannot read directory: ${dir}`);
  }

  return files;
}

// ============================================================================
// MAIN INGESTION
// ============================================================================

async function ingestFolder() {
  console.log("\n" + "=".repeat(60));
  console.log("POLICY DOCUMENT INGESTION");
  console.log("=".repeat(60));

  // First, clear existing data
  console.log("\nClearing existing documents...");
  await prisma.$executeRaw`DELETE FROM "DocumentChunk"`;
  await prisma.$executeRaw`DELETE FROM "Document"`;
  console.log("   Done.\n");

  // Collect PDFs from all root folders that exist
  let pdfFiles: string[] = [];
  for (const folder of ROOT_FOLDERS) {
    if (fs.existsSync(folder)) {
      const institution = detectInstitution(folder);
      const files = getAllPDFs(folder);
      console.log(`Found ${files.length} PDFs in ${folder} (${institution})`);
      pdfFiles.push(...files);
    } else {
      console.log(`Skipping ${folder} (not found)`);
    }
  }
  console.log(`Found ${pdfFiles.length} PDF files\n`);

  if (pdfFiles.length === 0) {
    console.log("No PDF files found!");
    return;
  }

  // Group by category for summary
  const categoryStats: Record<string, number> = {};
  let totalChunks = 0;
  let successCount = 0;
  let failCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < pdfFiles.length; i++) {
    const filePath = pdfFiles[i];
    const filename = path.basename(filePath);
    // Calculate relative path from any matching root folder
    let relativePath = filePath;
    for (const folder of ROOT_FOLDERS) {
      if (filePath.startsWith(folder)) {
        relativePath = filePath.slice(folder.length + 1);
        break;
      }
    }
    const institution = detectInstitution(filePath);

    console.log(`\n[${i + 1}/${pdfFiles.length}] [${institution}] ${relativePath}`);

    // Classify
    const metadata = classifyDocument(filePath, filename);
    console.log(`   Institution: ${institution} | Category: ${metadata.category} | Priority: ${metadata.priority}`);
    console.log(`   Subspecialties: ${metadata.subspecialties.join(", ")}`);
    console.log(`   Tags: ${metadata.tags.slice(0, 5).join(", ")}${metadata.tags.length > 5 ? "..." : ""}`);

    try {
      // Extract text
      const text = await extractTextFromPDF(filePath);

      if (text.length < 100) {
        console.log(`   Skipped - insufficient text (${text.length} chars)`);
        skippedCount++;
        continue;
      }

      console.log(`   Extracted: ${text.length} chars`);

      // Chunk
      const chunks = chunkText(text);
      console.log(`   Chunks: ${chunks.length}`);

      if (chunks.length === 0) {
        console.log(`   Skipped - no valid chunks`);
        skippedCount++;
        continue;
      }

      // Clean title from filename
      const title = filename
        .replace(/\.pdf$/i, "")
        .replace(/[_-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      // Create document
      const document = await prisma.document.create({
        data: {
          title,
          source: institution === "INSTITUTION_A" ? "INSTITUTION_A" : "Institution B",
          category: metadata.category,
          content: text,
          institution,
          metadata: {
            priority: metadata.priority,
            subspecialties: metadata.subspecialties,
            tags: metadata.tags,
            originalPath: relativePath,
            fileName: filename,  // Store actual filename for PDF lookup
          },
          isActive: true,
        },
      });

      // Generate embeddings and store chunks
      for (let j = 0; j < chunks.length; j++) {
        process.stdout.write(`   Embedding ${j + 1}/${chunks.length}...\r`);

        const embedding = await generateEmbedding(chunks[j], 'document');

        await prisma.$executeRaw`
          INSERT INTO "DocumentChunk" (id, "documentId", "chunkIndex", content, embedding, metadata, institution, "createdAt")
          VALUES (
            ${crypto.randomUUID()},
            ${document.id},
            ${j},
            ${chunks[j]},
            ${embedding}::vector,
            ${JSON.stringify({
              category: metadata.category,
              tags: metadata.tags,
              priority: metadata.priority,
              fileName: filename,  // Store actual filename for PDF lookup
            })}::jsonb,
            ${institution}::"Institution",
            NOW()
          )
        `;
      }

      console.log(`   Ingested ${chunks.length} chunks                    `);

      totalChunks += chunks.length;
      successCount++;
      categoryStats[metadata.category] = (categoryStats[metadata.category] || 0) + 1;
    } catch (error) {
      console.log(`   Error: ${error instanceof Error ? error.message : "Unknown"}`);
      failCount++;
    }

    // Rate limiting for OpenAI API
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // Print summary
  console.log("\n" + "=".repeat(60));
  console.log("INGESTION COMPLETE");
  console.log("=".repeat(60));
  console.log(`\nDocuments: ${successCount} succeeded, ${failCount} failed, ${skippedCount} skipped`);
  console.log(`Total chunks: ${totalChunks}`);
  console.log("\nBy category:");

  Object.entries(categoryStats)
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat, count]) => {
      console.log(`   ${cat}: ${count} documents`);
    });

  console.log("\n" + "=".repeat(60) + "\n");
}

// Run
ingestFolder()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
