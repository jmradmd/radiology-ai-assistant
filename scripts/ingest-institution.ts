/**
 * Multi-Institution Document Ingestion Script
 *
 * Features:
 * - Ingests from multiple source folders
 * - Supports incremental updates (no DELETE by default)
 * - Institution-aware classification
 * - Preserves existing documents
 *
 * Usage:
 *   npx tsx scripts/ingest-institution.ts --institution Institution A
 *   npx tsx scripts/ingest-institution.ts --institution INSTITUTION_B
 *   npx tsx scripts/ingest-institution.ts --all
 *   npx tsx scripts/ingest-institution.ts --all --clean  # Dangerous: clears first
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";
import pdfParse from "pdf-parse";
import { generateEmbedding } from "../packages/api/src/lib/embedding-client";

const prisma = new PrismaClient();

// Institution type (matches Prisma enum)
type Institution = "INSTITUTION_A" | "INSTITUTION_B" | "SHARED";

// Institution configuration (mirrors @rad-assist/shared)
const INSTITUTION_CONFIG: Record<
  Institution,
  { displayName: string; shortName: string; sourceFolder: string | null }
> = {
  Institution A: {
    displayName: "Primary Hospital",
    shortName: "INSTITUTION_A",
    sourceFolder: "institution-a-policies",
  },
  INSTITUTION_B: {
    displayName: "Department/Institution B Radiology",
    shortName: "Institution B",
    sourceFolder: "institution-b-policies",
  },
  SHARED: {
    displayName: "Shared Policy",
    shortName: "Shared",
    sourceFolder: null,
  },
};

// ============================================
// CLI ARGUMENT PARSING
// ============================================

interface CliArgs {
  institution: Institution | "ALL";
  clean: boolean;
  dryRun: boolean;
  verbose: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    institution: "ALL",
    clean: false,
    dryRun: false,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--institution":
      case "-i":
        const inst = args[++i]?.toUpperCase();
        if (inst === "INSTITUTION_A" || inst === "INSTITUTION_B" || inst === "SHARED") {
          result.institution = inst;
        } else if (inst === "ALL") {
          result.institution = "ALL";
        } else {
          console.error(
            `Invalid institution: ${inst}. Use INSTITUTION_A, INSTITUTION_B, or ALL`
          );
          process.exit(1);
        }
        break;
      case "--clean":
        result.clean = true;
        break;
      case "--dry-run":
        result.dryRun = true;
        break;
      case "--verbose":
      case "-v":
        result.verbose = true;
        break;
      case "--all":
        result.institution = "ALL";
        break;
      case "--help":
      case "-h":
        console.log(`
Multi-Institution Document Ingestion

Usage:
  npx tsx scripts/ingest-institution.ts [options]

Options:
  --institution, -i <INSTITUTION_A|INSTITUTION_B|ALL>  Institution to ingest (default: ALL)
  --all                                Ingest all institutions
  --clean                              DELETE existing docs for institution first (DANGEROUS)
  --dry-run                            Show what would be done without making changes
  --verbose, -v                        Show detailed progress
  --help, -h                           Show this help message

Examples:
  npx tsx scripts/ingest-institution.ts --institution Institution A
  npx tsx scripts/ingest-institution.ts --all
  npx tsx scripts/ingest-institution.ts --institution INSTITUTION_B --clean
        `);
        process.exit(0);
    }
  }

  return result;
}

// ============================================
// DOCUMENT CLASSIFICATION
// ============================================

interface DocumentClassification {
  category: string;
  priority: "CRITICAL" | "HIGH" | "STANDARD";
  subspecialties: string[];
  tags: string[];
}

const CLASSIFICATION_RULES: Array<{
  pattern: RegExp;
  category?: string;
  priority?: "CRITICAL" | "HIGH" | "STANDARD";
  subspecialties?: string[];
  tags?: string[];
}> = [
  // Critical - Emergency protocols
  {
    pattern: /contrast\s*reaction|anaphyla/i,
    category: "CONTRAST",
    priority: "CRITICAL",
    tags: ["emergency"],
  },
  {
    pattern: /code\s*blue|cardiac\s*arrest|emergency/i,
    category: "CRITICAL",
    priority: "CRITICAL",
    tags: ["emergency"],
  },
  { pattern: /mri\s*safety|mr\s*conditional/i, category: "MRI_SAFETY", priority: "CRITICAL" },
  {
    pattern: /fire\s*safety|evacuation/i,
    category: "SAFETY",
    priority: "CRITICAL",
    tags: ["emergency"],
  },

  // High - Important clinical protocols
  {
    pattern: /gadolinium|gbca/i,
    category: "CONTRAST",
    priority: "HIGH",
    subspecialties: ["MRI_SAFETY"],
  },
  {
    pattern: /iodinated|iodine\s*contrast/i,
    category: "CONTRAST",
    priority: "HIGH",
    subspecialties: ["CT_PROTOCOL"],
  },
  {
    pattern: /premedication|pre-?med|steroid/i,
    category: "CONTRAST",
    priority: "HIGH",
    tags: ["premedication"],
  },
  {
    pattern: /pacemaker|icd|defibrillator|cied/i,
    category: "MRI_SAFETY",
    priority: "CRITICAL",
    subspecialties: ["CARDIAC"],
  },
  { pattern: /implant|prosthesis|hardware/i, category: "MRI_SAFETY", priority: "HIGH" },
  { pattern: /egfr|gfr|creatinine|renal\s*function/i, category: "RENAL", priority: "CRITICAL" },
  {
    pattern: /aki|acute\s*kidney|contrast.?induced/i,
    category: "RENAL",
    priority: "CRITICAL",
  },
  {
    pattern: /pediatric|paediatric|child|infant/i,
    category: "PEDIATRIC",
    priority: "HIGH",
    subspecialties: ["PEDS"],
  },
  { pattern: /pregnan|gestational|fetal/i, category: "PREGNANCY", priority: "CRITICAL" },
  { pattern: /sedation|conscious\s*sedation/i, category: "MEDICATION", priority: "HIGH" },
  { pattern: /extravasation|infiltration/i, category: "NURSING", priority: "HIGH" },
  {
    pattern: /critical\s*result|critical\s*finding/i,
    category: "CRITICAL",
    priority: "CRITICAL",
  },

  // Standard - Routine protocols
  { pattern: /ct\s*protocol|cta/i, category: "CT_PROTOCOL", priority: "STANDARD" },
  { pattern: /pet.?ct|nuclear/i, category: "CT_PROTOCOL", subspecialties: ["NUCLEAR"] },
  {
    pattern: /mammograph|breast\s*imaging|birads/i,
    category: "MAMMO",
    subspecialties: ["BREAST"],
  },
  { pattern: /ultrasound|sonograph|doppler/i, category: "ULTRASOUND" },
  { pattern: /radiation\s*safety|alara/i, category: "SAFETY", priority: "HIGH" },
  { pattern: /schedul|appointment|add.?on/i, category: "WORKFLOW" },
  { pattern: /mqsa|quality\s*assurance/i, category: "COMPLIANCE" },
  { pattern: /iv\s*access|power\s*inject/i, category: "NURSING" },
  { pattern: /zone\s*[1-4]|screening\s*form/i, category: "MRI_SAFETY" },
];

function classifyDocument(
  filename: string,
  content: string
): DocumentClassification {
  const result: DocumentClassification = {
    category: "GENERAL",
    priority: "STANDARD",
    subspecialties: [],
    tags: [],
  };

  const searchText = `${filename} ${content.substring(0, 5000)}`.toLowerCase();

  for (const rule of CLASSIFICATION_RULES) {
    if (rule.pattern.test(searchText)) {
      if (rule.category && result.category === "GENERAL") {
        result.category = rule.category;
      }
      if (
        rule.priority &&
        getPriorityWeight(rule.priority) > getPriorityWeight(result.priority)
      ) {
        result.priority = rule.priority;
      }
      if (rule.subspecialties) {
        result.subspecialties.push(...rule.subspecialties);
      }
      if (rule.tags) {
        result.tags.push(...rule.tags);
      }
    }
  }

  // Deduplicate
  result.subspecialties = [...new Set(result.subspecialties)];
  result.tags = [...new Set(result.tags)];

  return result;
}

function getPriorityWeight(priority: string): number {
  switch (priority) {
    case "CRITICAL":
      return 3;
    case "HIGH":
      return 2;
    case "STANDARD":
      return 1;
    default:
      return 0;
  }
}

// ============================================
// TEXT PROCESSING
// ============================================

const CHUNK_CONFIG = {
  maxChars: 1500,
  overlapChars: 200,
  minChunkSize: 100,
};

// Page boundary marker used to track page numbers
const PAGE_MARKER = "\n\n<<<PAGE_BREAK>>>\n\n";

interface ChunkWithPage {
  content: string;
  pageStart: number;
  pageEnd: number;
}

/**
 * Parse PDF and extract text with page boundaries preserved
 */
async function parsePDFWithPages(buffer: Buffer): Promise<{ text: string; pages: string[]; numPages: number }> {
  const pages: string[] = [];
  
  // Custom page renderer that collects text per page
  const renderPage = async (pageData: { getTextContent: (opts: object) => Promise<{ items: Array<{ str: string; transform: number[] }> }> }) => {
    const textContent = await pageData.getTextContent({
      normalizeWhitespace: true,
      disableCombineTextItems: false,
    });
    
    let lastY: number | undefined;
    let pageText = "";
    
    for (const item of textContent.items) {
      const y = item.transform[5];
      if (lastY === undefined || Math.abs(y - lastY) < 5) {
        pageText += item.str;
      } else {
        pageText += "\n" + item.str;
      }
      lastY = y;
    }
    
    pages.push(pageText.trim());
    return pageText;
  };
  
  const data = await pdfParse(buffer, { pagerender: renderPage });
  
  // Join pages with markers for tracking
  const textWithMarkers = pages.join(PAGE_MARKER);
  
  return {
    text: data.text,  // Original combined text for backward compat
    pages,
    numPages: data.numpages,
  };
}

/**
 * Chunk text while tracking page numbers for each chunk
 */
function chunkTextWithPages(pages: string[]): ChunkWithPage[] {
  const chunks: ChunkWithPage[] = [];
  
  let currentChunk = "";
  let currentPageStart = 1;
  let currentPage = 1;
  
  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const pageText = pages[pageIdx];
    const pageNum = pageIdx + 1;
    const sentences = pageText.split(/(?<=[.!?])\s+/);
    
    for (const sentence of sentences) {
      if (
        currentChunk.length + sentence.length > CHUNK_CONFIG.maxChars &&
        currentChunk.length > 0
      ) {
        // Save current chunk
        chunks.push({
          content: currentChunk.trim(),
          pageStart: currentPageStart,
          pageEnd: currentPage,
        });
        
        // Keep overlap for context
        const words = currentChunk.split(/\s+/);
        const overlapWords = words.slice(
          -Math.floor(CHUNK_CONFIG.overlapChars / 5)
        );
        currentChunk = overlapWords.join(" ") + " " + sentence;
        currentPageStart = pageNum;  // New chunk starts on this page
      } else {
        currentChunk += (currentChunk ? " " : "") + sentence;
      }
      currentPage = pageNum;
    }
  }
  
  // Don't forget the last chunk
  if (currentChunk.trim().length >= CHUNK_CONFIG.minChunkSize) {
    chunks.push({
      content: currentChunk.trim(),
      pageStart: currentPageStart,
      pageEnd: currentPage,
    });
  }
  
  return chunks;
}

/**
 * Legacy function for backward compatibility
 */
function chunkText(text: string): string[] {
  const chunks: string[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);

  let currentChunk = "";

  for (const sentence of sentences) {
    if (
      currentChunk.length + sentence.length > CHUNK_CONFIG.maxChars &&
      currentChunk.length > 0
    ) {
      chunks.push(currentChunk.trim());

      // Keep overlap
      const words = currentChunk.split(/\s+/);
      const overlapWords = words.slice(
        -Math.floor(CHUNK_CONFIG.overlapChars / 5)
      );
      currentChunk = overlapWords.join(" ") + " " + sentence;
    } else {
      currentChunk += (currentChunk ? " " : "") + sentence;
    }
  }

  if (currentChunk.trim().length >= CHUNK_CONFIG.minChunkSize) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

// generateEmbedding imported from embedding-client

// ============================================
// FILE DISCOVERY
// ============================================

function findPDFs(directory: string): string[] {
  const pdfs: string[] = [];

  function scan(dir: string) {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      // Skip hidden files
      if (entry.name.startsWith(".") || entry.name.startsWith("~")) continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        scan(fullPath);
      } else if (
        entry.isFile() &&
        entry.name.toLowerCase().endsWith(".pdf")
      ) {
        pdfs.push(fullPath);
      }
    }
  }

  scan(directory);
  return pdfs;
}

// ============================================
// MAIN INGESTION LOGIC
// ============================================

async function ingestInstitution(
  institution: Institution,
  options: { clean: boolean; dryRun: boolean; verbose: boolean }
) {
  const config = INSTITUTION_CONFIG[institution];

  if (!config.sourceFolder) {
    console.log(
      `   Institution ${institution} has no source folder configured, skipping`
    );
    return;
  }

  const sourceDir = path.resolve(process.cwd(), config.sourceFolder);

  if (!fs.existsSync(sourceDir)) {
    console.error(`   Source folder not found: ${sourceDir}`);
    return;
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`   Ingesting ${config.displayName} (${institution})`);
  console.log(`   Source: ${sourceDir}`);
  console.log(`${"=".repeat(60)}`);

  // Find PDFs
  const pdfFiles = findPDFs(sourceDir);
  console.log(`   Found ${pdfFiles.length} PDF files`);

  if (pdfFiles.length === 0) {
    console.log("   Nothing to ingest");
    return;
  }

  // Clean if requested
  if (options.clean) {
    console.log(
      `\n   CLEAN MODE: Deleting existing ${institution} documents...`
    );

    if (!options.dryRun) {
      // First delete chunks, then documents (referential integrity)
      await prisma.$executeRaw`
        DELETE FROM "DocumentChunk"
        WHERE institution = ${institution}::"Institution"
      `;
      const deleted = await prisma.$executeRaw`
        DELETE FROM "Document"
        WHERE institution = ${institution}::"Institution"
      `;
      console.log(`   Deleted ${deleted} documents`);
    } else {
      const count = await prisma.document.count({
        where: { institution: institution as any },
      });
      console.log(`   [DRY RUN] Would delete ${count} documents`);
    }
  }

  // Get existing documents for deduplication
  const existingDocs = await prisma.document.findMany({
    where: { institution: institution as any },
    select: { id: true, title: true, metadata: true },
  });

  const existingPaths = new Set(
    existingDocs
      .map((d) => (d.metadata as any)?.originalPath)
      .filter(Boolean)
  );

  // Process each PDF
  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (const pdfPath of pdfFiles) {
    const relativePath = path.relative(sourceDir, pdfPath);
    const filename = path.basename(pdfPath, ".pdf");

    // Check for duplicates
    if (existingPaths.has(relativePath)) {
      if (options.verbose) {
        console.log(`      Skipping (exists): ${relativePath}`);
      }
      skipped++;
      continue;
    }

    try {
      if (options.verbose) {
        console.log(`      Processing: ${relativePath}`);
      }

      // Read PDF with page-aware parsing
      const buffer = fs.readFileSync(pdfPath);
      const { text, pages, numPages } = await parsePDFWithPages(buffer);

      if (!text || text.trim().length < 100) {
        console.log(`      Skipping (no content): ${relativePath}`);
        skipped++;
        continue;
      }

      // Classify
      const classification = classifyDocument(filename, text);

      if (options.dryRun) {
        console.log(`   [DRY RUN] Would create: ${filename}`);
        console.log(
          `             Category: ${classification.category}, Priority: ${classification.priority}, Pages: ${numPages}`
        );
        processed++;
        continue;
      }

      // Create document
      const document = await prisma.document.create({
        data: {
          title: filename,
          source: config.shortName,
          category: classification.category,
          content: text,
          institution: institution as any,
          authorityLevel: "INSTITUTIONAL" as any,
          metadata: {
            priority: classification.priority,
            subspecialties: classification.subspecialties,
            tags: classification.tags,
            originalPath: relativePath,
            sourceFolder: config.sourceFolder,
            numPages: numPages,
            ingestedAt: new Date().toISOString(),
          },
          isActive: true,
        },
      });

      // Chunk with page tracking
      const chunksWithPages = chunkTextWithPages(pages);

      for (let i = 0; i < chunksWithPages.length; i++) {
        const chunk = chunksWithPages[i];
        const embedding = await generateEmbedding(chunk.content, 'document');

        await prisma.$executeRaw`
          INSERT INTO "DocumentChunk" (id, "documentId", "chunkIndex", content, embedding, institution, domain, "authorityLevel", metadata, "createdAt")
          VALUES (
            gen_random_uuid(),
            ${document.id},
            ${i},
            ${chunk.content},
            ${embedding}::vector,
            ${institution}::"Institution",
            'PROTOCOL'::"Domain",
            'INSTITUTIONAL'::"AuthorityLevel",
            ${JSON.stringify({
              section: i + 1,
              totalSections: chunksWithPages.length,
              pageStart: chunk.pageStart,
              pageEnd: chunk.pageEnd,
              numPages: numPages,
            })}::jsonb,
            NOW()
          )
        `;
      }

      if (options.verbose) {
        console.log(`      Created: ${filename} (${chunksWithPages.length} chunks, ${numPages} pages)`);
      }

      processed++;

      // Rate limiting for OpenAI API
      await new Promise((r) => setTimeout(r, 100));
    } catch (error) {
      console.error(`      Error processing ${relativePath}:`, error);
      errors++;
    }
  }

  // Summary
  console.log(`\n   ${institution} Summary:`);
  console.log(`   Processed: ${processed}`);
  console.log(`   Skipped:   ${skipped}`);
  console.log(`   Errors:    ${errors}`);
}

// ============================================
// ENTRY POINT
// ============================================

async function main() {
  const args = parseArgs();

  console.log(" Multi-Institution Document Ingestion");
  console.log(`   Mode: ${args.dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`   Clean: ${args.clean ? "YES (DANGEROUS)" : "NO (incremental)"}`);

  const institutions: Institution[] =
    args.institution === "ALL" ? ["INSTITUTION_A", "INSTITUTION_B"] : [args.institution];

  for (const inst of institutions) {
    await ingestInstitution(inst, {
      clean: args.clean,
      dryRun: args.dryRun,
      verbose: args.verbose,
    });
  }

  // Final summary
  console.log(`\n${"=".repeat(60)}`);
  console.log(" Final Document Counts:");

  const counts = await prisma.$queryRaw<
    Array<{ institution: string; count: bigint }>
  >`
    SELECT institution::text, COUNT(*) as count
    FROM "Document"
    GROUP BY institution
    ORDER BY count DESC
  `;

  for (const count of counts) {
    console.log(`   ${count.institution}: ${count.count} documents`);
  }

  const totalChunks = await prisma.documentChunk.count();
  console.log(`   Total chunks: ${totalChunks}`);
  console.log(`${"=".repeat(60)}`);
}

main()
  .catch((e) => {
    console.error("Ingestion failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
