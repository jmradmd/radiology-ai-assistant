/**
 * Re-ingestion script for RAG documents
 * 
 * This script:
 * 1. Clears existing documents and chunks
 * 2. Scans the institution-b-policies-legacy folder for PDFs
 * 3. Extracts text from each PDF
 * 4. Chunks the text properly (multiple chunks per document)
 * 5. Generates embeddings for each chunk
 * 6. Stores everything in the database
 * 
 * Run with: npx tsx scripts/reingest.ts
 */

import { PrismaClient, Institution } from "@prisma/client";
import OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";
import pdf from "pdf-parse";
import { INSTITUTION_CONFIG } from "@rad-assist/shared";

const prisma = new PrismaClient();
const openai = new OpenAI();

// Root folders to ingest with institution mapping
const ROOT_FOLDERS = [
  { path: "./institution-b-policies", institution: "INSTITUTION_B" as Institution },
  { path: "./institution-a-policies", institution: "INSTITUTION_A" as Institution },
];

/**
 * Detect institution from file path
 */
function detectInstitution(filePath: string): Institution {
  const normalizedPath = filePath.replace(/\\/g, "/");
  
  for (const [instId, config] of Object.entries(INSTITUTION_CONFIG)) {
    if (config.sourceFolder && normalizedPath.includes(config.sourceFolder)) {
      return instId as Institution;
    }
  }
  
  return "INSTITUTION_B"; // Default
}
const EMBEDDING_MODEL = "text-embedding-3-small";

// ============================================================================
// CHUNKING FUNCTIONS (FIXED)
// ============================================================================

function chunkText(text: string, maxChars: number = 1500, overlapChars: number = 200): string[] {
  // Preserve paragraph structure
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();

  if (normalized.length <= maxChars) {
    return normalized.length > 100 ? [normalized] : [];
  }

  const chunks: string[] = [];
  const paragraphs = normalized.split(/\n\n+/);
  let currentChunk = "";

  for (const para of paragraphs) {
    const trimmedPara = para.trim();
    if (!trimmedPara) continue;

    if (currentChunk.length + trimmedPara.length + 2 > maxChars && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());

      // Create overlap from end of previous chunk
      const words = currentChunk.split(/\s+/);
      const overlapWords = words.slice(-Math.ceil(overlapChars / 6));
      currentChunk = overlapWords.join(" ") + "\n\n" + trimmedPara;
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + trimmedPara;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  // Force split very long single chunks
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

// ============================================================================
// CATEGORY DETECTION
// ============================================================================

type CategoryKey =
  | "CONTRAST"
  | "MRI_SAFETY"
  | "CT_PROTOCOL"
  | "MAMMO"
  | "NURSING"
  | "MEDICATION"
  | "PEDIATRIC"
  | "PREGNANCY"
  | "RENAL"
  | "SAFETY"
  | "WORKFLOW"
  | "COMPLIANCE"
  | "CRITICAL"
  | "GENERAL";

function detectCategory(filename: string, folderPath: string): CategoryKey {
  const lower = filename.toLowerCase();
  const folder = folderPath.toLowerCase();

  // MRI Safety (specific patterns first)
  if (
    (lower.includes("mri") && (lower.includes("safe") || lower.includes("zone") || lower.includes("implant"))) ||
    lower.includes("metal") && lower.includes("free") ||
    lower.includes("defecography") ||
    lower.includes("secretin") ||
    lower.includes("glucagon") && lower.includes("mre") ||
    lower.includes("regadenoson") ||
    lower.includes("cardiac mri")
  ) {
    return "MRI_SAFETY";
  }
  if (folder.includes("mri")) return "MRI_SAFETY";

  // Contrast
  if (
    lower.includes("contrast") ||
    lower.includes("reaction") ||
    lower.includes("premedication") ||
    lower.includes("gadolinium") ||
    lower.includes("gbca") ||
    lower.includes("iodinated")
  ) {
    return "CONTRAST";
  }
  if (folder.includes("contrast")) return "CONTRAST";

  // Renal
  if (
    lower.includes("renal") ||
    lower.includes("egfr") ||
    lower.includes("creatinine") ||
    lower.includes("metformin") ||
    lower.includes("nephro")
  ) {
    return "RENAL";
  }

  // CT Protocol
  if (
    lower.includes("ct protocol") ||
    lower.includes("cardiac ct") ||
    lower.includes("cta") ||
    lower.includes("ccta") ||
    lower.includes("cystogram") ||
    lower.includes("hr lowering") ||
    lower.includes("lung screen")
  ) {
    return "CT_PROTOCOL";
  }
  if (folder.includes("ct") || folder.includes("pet") || folder.includes("dexa")) return "CT_PROTOCOL";

  // Mammography
  if (
    lower.includes("mammo") ||
    lower.includes("breast") ||
    lower.includes("stereotactic") ||
    lower.includes("mqsa")
  ) {
    return "MAMMO";
  }
  if (folder.includes("mammo")) return "MAMMO";

  // Pediatric
  if (lower.includes("peds") || lower.includes("pediatric") || lower.includes("child")) {
    return "PEDIATRIC";
  }

  // Pregnancy
  if (
    lower.includes("pregnan") ||
    lower.includes("lactation") ||
    lower.includes("breastfeed") ||
    lower.includes("fetal")
  ) {
    return "PREGNANCY";
  }

  // Nursing
  if (
    lower.includes("nursing") ||
    lower.includes("iv access") ||
    lower.includes("catheter") ||
    lower.includes("extravasation") ||
    lower.includes("infiltration") ||
    lower.includes("glucose monitoring") ||
    lower.includes("cardiac arrest") ||
    lower.includes("i-stat") ||
    lower.includes("cvc")
  ) {
    return "NURSING";
  }
  if (folder.includes("nurse")) return "NURSING";

  // Medication
  if (
    lower.includes("medication") ||
    lower.includes("sedation") ||
    lower.includes("insulin pump") ||
    lower.includes("cgm")
  ) {
    return "MEDICATION";
  }

  // Critical Results
  if (lower.includes("critical result") || lower.includes("critical finding")) {
    return "CRITICAL";
  }

  // Compliance
  if (
    lower.includes("consent") ||
    lower.includes("waiver") ||
    lower.includes("abn") ||
    lower.includes("chaperone") ||
    lower.includes("verification") ||
    lower.includes("patient rights")
  ) {
    return "COMPLIANCE";
  }

  // Workflow
  if (
    lower.includes("workflow") ||
    lower.includes("dismissal") ||
    lower.includes("add on") ||
    lower.includes("epic") ||
    lower.includes("pacs") ||
    lower.includes("scheduling") ||
    lower.includes("no show")
  ) {
    return "WORKFLOW";
  }

  // General Safety (fire, infection, etc - NOT MRI safety)
  if (
    lower.includes("fire") ||
    lower.includes("evacuation") ||
    lower.includes("emergency plan") ||
    lower.includes("infection") ||
    lower.includes("hand hygiene") ||
    lower.includes("needle stick") ||
    lower.includes("blood") && lower.includes("body fluid") ||
    lower.includes("waste") ||
    lower.includes("radiation protection") ||
    lower.includes("disinfect")
  ) {
    return "SAFETY";
  }
  if (folder.includes("fire") || folder.includes("emergency")) return "SAFETY";

  // Default
  return "GENERAL";
}

// ============================================================================
// PDF EXTRACTION
// ============================================================================

async function extractPdfText(filePath: string): Promise<string> {
  try {
    const dataBuffer = fs.readFileSync(filePath);

    // Warning for very large PDFs
    const sizeMB = dataBuffer.length / 1024 / 1024;
    if (sizeMB > 50) {
      console.log(`  Large PDF (${sizeMB.toFixed(1)}MB), extraction may take time...`);
    }

    const data = await pdf(dataBuffer, { max: 0 });
    return data.text;
  } catch (error) {
    console.error(`  PDF extraction failed: ${error}`);
    return "";
  }
}

// ============================================================================
// EMBEDDING
// ============================================================================

async function generateEmbedding(text: string): Promise<number[]> {
  // Truncate to ~8000 tokens (~32000 chars) for embedding model limit
  const truncated = text.slice(0, 32000);

  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: truncated,
  });

  return response.data[0].embedding;
}

// ============================================================================
// FILE SCANNING
// ============================================================================

function findPdfs(dir: string): string[] {
  const files: string[] = [];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      // Skip hidden files
      if (entry.name.startsWith(".") || entry.name.startsWith("~")) continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        files.push(...findPdfs(fullPath));
      } else if (entry.name.toLowerCase().endsWith(".pdf")) {
        files.push(fullPath);
      }
    }
  } catch (e) {
    console.warn(`  Cannot read directory: ${dir}`);
  }

  return files;
}

// ============================================================================
// MAIN INGESTION
// ============================================================================

async function reingest() {
  console.log("\n" + "=".repeat(60));
  console.log("RAG DOCUMENT RE-INGESTION");
  console.log("=".repeat(60));

  // Clear existing data
  console.log("\nClearing existing documents and chunks...");
  await prisma.$executeRaw`DELETE FROM "DocumentChunk"`;
  await prisma.$executeRaw`DELETE FROM "Document"`;
  console.log("   Done.\n");

  // Collect PDFs from all root folders
  let pdfFiles: Array<{ path: string; rootDir: string }> = [];
  
  for (const folder of ROOT_FOLDERS) {
    const folderPath = path.join(process.cwd(), folder.path);
    if (fs.existsSync(folderPath)) {
      const files = findPdfs(folderPath);
      console.log(`Found ${files.length} PDFs in ${folder.path} (${folder.institution})`);
      pdfFiles.push(...files.map(f => ({ path: f, rootDir: folderPath })));
    } else {
      console.log(`Skipping ${folder.path} (not found)`);
    }
  }

  console.log(`\nTotal: ${pdfFiles.length} PDF files\n`);

  if (pdfFiles.length === 0) {
    console.log("No PDF files found!");
    return;
  }

  // Stats tracking
  const stats = {
    success: 0,
    failed: 0,
    skipped: 0,
    totalChunks: 0,
    byCategory: {} as Record<string, number>,
  };

  // Process each PDF
  for (let i = 0; i < pdfFiles.length; i++) {
    const { path: filePath, rootDir } = pdfFiles[i];
    const filename = path.basename(filePath);
    const relativePath = path.relative(rootDir, filePath);
    const folderPath = path.dirname(relativePath);
    const institution = detectInstitution(filePath);

    console.log(`\n[${i + 1}/${pdfFiles.length}] [${institution}] ${filename}`);

    try {
      // Extract text
      const text = await extractPdfText(filePath);

      if (text.length < 100) {
        console.log(`   Skipped: insufficient text (${text.length} chars)`);
        stats.skipped++;
        continue;
      }

      // Detect category
      const category = detectCategory(filename, folderPath);
      stats.byCategory[category] = (stats.byCategory[category] || 0) + 1;

      // Chunk the text
      const chunks = chunkText(text, 1500, 200);

      if (chunks.length === 0) {
        console.log(`   Skipped: no valid chunks`);
        stats.skipped++;
        continue;
      }

      console.log(`   ${category} | ${text.length} chars → ${chunks.length} chunks`);

      // Create document with metadata including file path for linking
      const title = filename
        .replace(/\.pdf$/i, "")
        .replace(/[_-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      const doc = await prisma.document.create({
        data: {
          title,
          source: institution === "INSTITUTION_A" ? "INSTITUTION_A" : "Institution B",
          category,
          content: text,
          institution,
          metadata: {
            filePath: relativePath,
            fileName: filename,
            originalPath: filePath,
          },
          isActive: true,
        },
      });

      // Create chunks with embeddings
      for (let j = 0; j < chunks.length; j++) {
        process.stdout.write(`   Embedding ${j + 1}/${chunks.length}...\r`);

        const embedding = await generateEmbedding(chunks[j]);

        await prisma.$executeRaw`
          INSERT INTO "DocumentChunk" (id, "documentId", "chunkIndex", content, embedding, metadata, institution, "createdAt")
          VALUES (
            gen_random_uuid(),
            ${doc.id},
            ${j},
            ${chunks[j]},
            ${embedding}::vector,
            ${JSON.stringify({ chunkIndex: j, totalChunks: chunks.length })}::jsonb,
            ${institution}::"Institution",
            NOW()
          )
        `;

        stats.totalChunks++;
      }

      console.log(`   Ingested ${chunks.length} chunks                    `);
      stats.success++;

      // Rate limit for OpenAI API
      await new Promise((r) => setTimeout(r, 100));
    } catch (error) {
      console.error(`   Error: ${error instanceof Error ? error.message : "Unknown"}`);
      stats.failed++;
    }
  }

  // Print summary
  console.log("\n" + "=".repeat(60));
  console.log("RE-INGESTION COMPLETE");
  console.log("=".repeat(60));
  console.log(`\nDocuments: ${stats.success} succeeded, ${stats.failed} failed, ${stats.skipped} skipped`);
  console.log(`Total chunks: ${stats.totalChunks}`);
  console.log(`Average chunks per doc: ${(stats.totalChunks / Math.max(stats.success, 1)).toFixed(1)}`);
  console.log("\nBy category:");
  Object.entries(stats.byCategory)
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat, count]) => console.log(`   ${cat}: ${count}`));

  console.log("\n" + "=".repeat(60) + "\n");
}

// Run
reingest()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
