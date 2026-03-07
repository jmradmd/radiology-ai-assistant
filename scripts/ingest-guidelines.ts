/**
 * Guidelines Ingestion Script
 *
 * Ingests PDF guidelines from a configurable directory tree and stores
 * them as NATIONAL_GUIDELINE authority documents for contextual retrieval.
 * Can be used with any guideline PDF collection (e.g., institutional, society, etc.).
 *
 * Usage:
 *   npx tsx scripts/ingest-guidelines.ts
 *   npx tsx scripts/ingest-guidelines.ts --dry-run
 *   npx tsx scripts/ingest-guidelines.ts --clean
 *   npx tsx scripts/ingest-guidelines.ts --root ./my-guidelines
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";
import pdfParse from "pdf-parse";
import OpenAI from "openai";

const prisma = new PrismaClient();
let openaiClient: OpenAI | null = null;

const CHUNK_SIZE_WORDS = 512;
const CHUNK_OVERLAP_WORDS = 100;
const GUIDELINES_ROOT_DEFAULT = "guidelines";

interface CliArgs {
  dryRun: boolean;
  clean: boolean;
  verbose: boolean;
  rootDir: string;
}

interface GuidelineClassification {
  category: string;
  panel: string | null;
  sourceTree: "CONTRAST_MANUAL" | "RADS" | "APPROPRIATENESS_CRITERIA" | "OTHER";
  taxonomyHint?: string;
  guidelineYear?: number;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    dryRun: false,
    clean: false,
    verbose: false,
    rootDir: GUIDELINES_ROOT_DEFAULT,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--dry-run":
        result.dryRun = true;
        break;
      case "--clean":
        result.clean = true;
        break;
      case "--verbose":
      case "-v":
        result.verbose = true;
        break;
      case "--root":
        result.rootDir = args[++i] || GUIDELINES_ROOT_DEFAULT;
        break;
      case "--help":
      case "-h":
        console.log(`
Guidelines Ingestion

Usage:
  npx tsx scripts/ingest-guidelines.ts [options]

Options:
  --dry-run      Show what would be ingested without DB writes
  --clean        Delete existing guideline docs before ingest
  --verbose      Detailed per-file logging
  --root <path>  Root folder to scan (default: "guidelines")
  --help, -h     Show this help message
`);
        process.exit(0);
    }
  }

  return result;
}

function findPDFs(directory: string): string[] {
  const pdfs: string[] = [];

  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name.startsWith("~")) continue;

      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) {
        pdfs.push(fullPath);
      }
    }
  }

  walk(directory);
  return pdfs;
}

function inferYear(value: string): number | undefined {
  const matches = value.match(/\b(19|20)\d{2}\b/g);
  if (!matches || matches.length === 0) return undefined;

  const years = matches
    .map((m) => Number.parseInt(m, 10))
    .filter((n) => Number.isFinite(n) && n >= 1900 && n <= 2100);
  if (years.length === 0) return undefined;
  return Math.max(...years);
}

function inferPanel(relativePath: string): string | null {
  const normalized = relativePath.replace(/\\/g, "/");
  const marker = "Appropriateness Criteria/";
  const idx = normalized.indexOf(marker);
  if (idx < 0) return null;

  const after = normalized.slice(idx + marker.length);
  const parts = after.split("/");
  return parts[0] ? parts[0].trim() : null;
}

function mapPanelToCategory(panel: string): string {
  const normalized = panel.trim().toLowerCase();
  const mapping: Record<string, string> = {
    breast: "MAMMO",
    cardiac: "CT_PROTOCOL",
    gastrointestinal: "CT_PROTOCOL",
    "gyn and ob": "PREGNANCY",
    musculoskeletal: "CT_PROTOCOL",
    neurologic: "CT_PROTOCOL",
    pediatric: "PEDIATRIC",
    polytrauma: "CRITICAL",
    "systemic oncology": "CT_PROTOCOL",
    thoracic: "CT_PROTOCOL",
    urologic: "CT_PROTOCOL",
    vascular: "CT_PROTOCOL",
    "interventional radiology": "CT_PROTOCOL",
  };

  return mapping[normalized] || "GENERAL";
}

function mapRadsToCategory(relativePath: string): { category: string; taxonomyHint?: string } {
  const normalized = relativePath.toLowerCase();
  if (normalized.includes("bi-rads") || normalized.includes("birads")) {
    return { category: "MAMMO", taxonomyHint: "BI-RADS" };
  }
  if (normalized.includes("li-rads") || normalized.includes("lirads")) {
    return { category: "CT_PROTOCOL", taxonomyHint: "LI-RADS" };
  }
  if (normalized.includes("pi-rads") || normalized.includes("pirads")) {
    return { category: "CT_PROTOCOL", taxonomyHint: "PI-RADS" };
  }
  if (normalized.includes("ti-rads") || normalized.includes("tirads")) {
    return { category: "CT_PROTOCOL", taxonomyHint: "TI-RADS" };
  }
  if (normalized.includes("o-rads") || normalized.includes("orads")) {
    return { category: "PREGNANCY", taxonomyHint: "O-RADS" };
  }

  return { category: "GENERAL", taxonomyHint: "RADS" };
}

function classifyGuideline(relativePath: string, filename: string): GuidelineClassification {
  const normalized = relativePath.replace(/\\/g, "/");
  const lower = normalized.toLowerCase();
  const guidelineYear = inferYear(`${relativePath} ${filename}`);

  if (lower.includes("/contrast manual/")) {
    return {
      category: "CONTRAST",
      panel: null,
      sourceTree: "CONTRAST_MANUAL",
      guidelineYear,
    };
  }

  if (lower.includes("/rads/")) {
    const mapped = mapRadsToCategory(relativePath);
    return {
      category: mapped.category,
      panel: null,
      sourceTree: "RADS",
      taxonomyHint: mapped.taxonomyHint,
      guidelineYear,
    };
  }

  const panel = inferPanel(relativePath);
  if (panel) {
    return {
      category: mapPanelToCategory(panel),
      panel,
      sourceTree: "APPROPRIATENESS_CRITERIA",
      guidelineYear,
    };
  }

  return {
    category: "GENERAL",
    panel: null,
    sourceTree: "OTHER",
    guidelineYear,
  };
}

function chunkTextByWords(
  text: string,
  chunkSize: number = CHUNK_SIZE_WORDS,
  overlap: number = CHUNK_OVERLAP_WORDS
): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length === 0) return [];
  if (words.length <= chunkSize) return [words.join(" ")];

  const chunks: string[] = [];
  let start = 0;

  while (start < words.length) {
    const end = Math.min(start + chunkSize, words.length);
    const chunk = words.slice(start, end).join(" ").trim();
    if (chunk.length > 0) chunks.push(chunk);

    if (end >= words.length) break;
    start = Math.max(0, end - overlap);
  }

  return chunks;
}

async function generateEmbedding(input: string): Promise<number[]> {
  if (!openaiClient) {
    openaiClient = new OpenAI();
  }

  const response = await openaiClient.embeddings.create({
    model: "text-embedding-3-small",
    input: input.slice(0, 32000),
  });

  return response.data[0].embedding;
}

async function main() {
  const args = parseArgs();
  const rootDir = path.resolve(process.cwd(), args.rootDir);

  console.log("Guidelines Ingestion");
  console.log(`Mode: ${args.dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`Root: ${rootDir}`);
  console.log(`Clean: ${args.clean ? "YES" : "NO"}`);
  console.log(
    `Chunking: ${CHUNK_SIZE_WORDS} words with ${CHUNK_OVERLAP_WORDS} overlap (text-embedding-3-small)`
  );
  console.log("");

  if (!fs.existsSync(rootDir)) {
    if (args.dryRun) {
      console.log(`Guidelines root does not exist: ${rootDir}`);
      console.log("Dry run complete. Nothing to ingest.");
      return;
    }
    throw new Error(`Guidelines root does not exist: ${rootDir}`);
  }

  if (args.clean) {
    console.log("Cleaning existing guideline documents...");
    if (!args.dryRun) {
      await prisma.$executeRaw`
        DELETE FROM "DocumentChunk"
        WHERE "documentId" IN (
          SELECT id FROM "Document" WHERE "guidelineSource" = 'ACR'
        )
      `;
      await prisma.$executeRaw`
        DELETE FROM "Document"
        WHERE "guidelineSource" = 'ACR'
      `;
      console.log("Clean complete.");
    } else {
      const count = await prisma.document.count({
        where: { guidelineSource: "ACR" },
      });
      console.log(`[DRY RUN] Would delete ${count} guideline documents.`);
    }
    console.log("");
  }

  const pdfFiles = findPDFs(rootDir);
  console.log(`Discovered ${pdfFiles.length} PDF files.`);
  if (pdfFiles.length === 0) return;

  const existingDocs = await prisma.document.findMany({
    where: { guidelineSource: "ACR" },
    select: { metadata: true },
  });
  const existingPaths = new Set(
    existingDocs
      .map((d) => (d.metadata as { originalPath?: string } | null)?.originalPath)
      .filter((v): v is string => Boolean(v))
  );

  let processed = 0;
  let skipped = 0;
  let failed = 0;
  let createdChunks = 0;

  for (let index = 0; index < pdfFiles.length; index++) {
    const fullPath = pdfFiles[index];
    const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, "/");
    const filename = path.basename(fullPath, ".pdf");

    if (existingPaths.has(relativePath)) {
      skipped++;
      if (args.verbose) {
        console.log(`[SKIP ${index + 1}/${pdfFiles.length}] Exists: ${relativePath}`);
      }
      continue;
    }

    try {
      if (args.verbose) {
        console.log(`[READ ${index + 1}/${pdfFiles.length}] ${relativePath}`);
      }

      const buffer = fs.readFileSync(fullPath);
      const parsed = await pdfParse(buffer);
      const text = parsed.text?.trim() || "";

      if (text.length < 100) {
        skipped++;
        console.log(`[SKIP ${index + 1}/${pdfFiles.length}] Empty/short content: ${relativePath}`);
        continue;
      }

      const classification = classifyGuideline(relativePath, filename);
      const chunks = chunkTextByWords(text, CHUNK_SIZE_WORDS, CHUNK_OVERLAP_WORDS);

      if (chunks.length === 0) {
        skipped++;
        console.log(`[SKIP ${index + 1}/${pdfFiles.length}] No usable chunks: ${relativePath}`);
        continue;
      }

      if (args.dryRun) {
        processed++;
        console.log(
          `[DRY RUN ${index + 1}/${pdfFiles.length}] ${filename} | category=${classification.category} | panel=${classification.panel || "n/a"} | year=${classification.guidelineYear || "n/a"} | chunks=${chunks.length}`
        );
        continue;
      }

      const doc = await prisma.document.create({
        data: {
          title: filename,
          source: "ACR",
          category: classification.category,
          content: text,
          institution: "SHARED" as any,
          domain: "PROTOCOL" as any,
          authorityLevel: "NATIONAL_GUIDELINE" as any,
          guidelineSource: "ACR",
          guidelineYear: classification.guidelineYear ?? null,
          metadata: {
            originalPath: relativePath,
            panel: classification.panel,
            sourceTree: classification.sourceTree,
            taxonomyHint: classification.taxonomyHint ?? null,
            numPages: parsed.numpages,
            chunkConfig: {
              chunkSizeWords: CHUNK_SIZE_WORDS,
              overlapWords: CHUNK_OVERLAP_WORDS,
              embeddingModel: "text-embedding-3-small",
            },
            ingestedAt: new Date().toISOString(),
          },
          isActive: true,
        },
      });

      for (let i = 0; i < chunks.length; i++) {
        const embedding = await generateEmbedding(chunks[i]);
        await prisma.$executeRaw`
          INSERT INTO "DocumentChunk" (
            id,
            "documentId",
            "chunkIndex",
            content,
            embedding,
            institution,
            domain,
            "authorityLevel",
            metadata,
            "createdAt"
          )
          VALUES (
            gen_random_uuid(),
            ${doc.id},
            ${i},
            ${chunks[i]},
            ${embedding}::vector,
            'SHARED'::"Institution",
            'PROTOCOL'::"Domain",
            'NATIONAL_GUIDELINE'::"AuthorityLevel",
            ${JSON.stringify({
              section: i + 1,
              totalSections: chunks.length,
              sourceTree: classification.sourceTree,
              panel: classification.panel,
              taxonomyHint: classification.taxonomyHint ?? null,
            })}::jsonb,
            NOW()
          )
        `;
      }

      createdChunks += chunks.length;
      processed++;
      console.log(
        `[OK ${index + 1}/${pdfFiles.length}] ${relativePath} -> ${classification.category} (${chunks.length} chunks)`
      );

      // Small delay to avoid API burst.
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
      failed++;
      console.error(`[FAIL ${index + 1}/${pdfFiles.length}] ${relativePath}`, error);
    }
  }

  console.log("");
  console.log("Ingestion summary:");
  console.log(`Processed: ${processed}`);
  console.log(`Skipped:   ${skipped}`);
  console.log(`Failed:    ${failed}`);
  console.log(`Chunks:    ${createdChunks}`);

  if (!args.dryRun) {
    const count = await prisma.document.count({
      where: {
        authorityLevel: "NATIONAL_GUIDELINE" as any,
        guidelineSource: "ACR",
      },
    });
    console.log(`Total guideline docs in DB: ${count}`);
  }
}

main()
  .catch((error) => {
    console.error("Guideline ingestion failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
