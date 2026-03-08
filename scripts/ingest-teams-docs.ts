/**
 * Teams Departmental Document Ingestion
 *
 * Ingests non-PDF content from:
 * - teams_standard_docs/ (default, sibling to repo)
 *
 * Supported formats:
 * - PDF (pdf-parse)
 * - DOCX (mammoth)
 * - PPTX (pptx-parser)
 * - TXT, MD (UTF-8 text read)
 */

import { PrismaClient } from "@prisma/client";
import { detectPotentialPHI, TEAMS_COLLECTION_CONFIG, TEAMS_TIER_MAP } from "@rad-assist/shared";
import { generateEmbedding } from "../packages/api/src/lib/embedding-client";
import * as fs from "fs";
import * as path from "path";
import * as pdfParse from "pdf-parse";
import mammoth from "mammoth";

const prisma = new PrismaClient();

type DocumentPriority = "CRITICAL" | "HIGH" | "STANDARD";

interface CliOptions {
  clean: boolean;
  dryRun: boolean;
  verbose: boolean;
}

interface DocumentClassification {
  category: string;
  priority: DocumentPriority;
  subspecialties: string[];
  tags: string[];
  documentTier: "reference" | "clinical" | "educational";
}

const SOURCE_COLLECTION = TEAMS_COLLECTION_CONFIG.TEAMS_STANDARD_DOCS.collectionName;
const INSTITUTION = "INSTITUTION_B";
const DEFAULT_SOURCE = "teams_standard_docs";

const SOURCE_DIR = resolveTeamsSourceDir();

const KEYWORD_RULES: Array<{
  pattern: RegExp;
  category?: string;
  priority?: DocumentPriority;
  subspecialties?: string[];
  tags?: string[];
}> = [
  {
    pattern: /contrast\s*reaction|anaphyla|premed|iodine\s*contrast|gadolinium/i,
    category: "CONTRAST",
    priority: "CRITICAL",
    tags: ["contrast"],
  },
  {
    pattern: /\bcontrast\b|\bgadolinium\b/i,
    category: "CONTRAST",
    priority: "HIGH",
    tags: ["contrast"],
  },
  {
    pattern: /\bMRI\s*safety\b|\bMRI.*safety\b|\bmri\s*conditional/i,
    category: "MRI_SAFETY",
    priority: "HIGH",
    tags: ["mri"],
  },
  {
    pattern: /\bultrasound\b|\bsonograph/i,
    category: "ULTRASOUND",
    priority: "STANDARD",
  },
];

const MRI_SAFETY_EXCLUSION_PATTERN =
  /\bmri\s*(training|artifact|quiz|education|teaching|module|lecture|curriculum|review)/i;

const SUPPORTED_EXTENSIONS = new Set([
  ".pdf",
  ".docx",
  ".pptx",
  ".txt",
  ".md",
]);

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    clean: false,
    dryRun: false,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--clean":
        options.clean = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--verbose":
      case "-v":
        options.verbose = true;
        break;
      case "--help":
      case "-h":
        console.log(`
Teams document ingestion

Usage:
  npx tsx scripts/ingest-teams-docs.ts [options]

Options:
  --clean     Delete existing teams_abdominal documents before ingest
  --dry-run   Report changes without writing
  --verbose   Show detailed progress
  --help      Show this help
        `);
        process.exit(0);
    }
  }

  return options;
}

function resolveTeamsSourceDir(): string {
  const override = process.env.TEAMS_STANDARD_DOCS_DIR;
  const fallback = path.resolve(process.cwd(), "..", "teams_standard_docs");
  return path.resolve(override ?? fallback);
}

const CHUNK_CONFIG = {
  maxChars: 1500,
  overlapChars: 200,
  minChunkSize: 100,
};

interface ChunkWithMetadata {
  content: string;
  pageStart: number;
  pageEnd: number;
}

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
      const words = currentChunk.split(/\s+/);
      const overlapWords = words.slice(-Math.floor(CHUNK_CONFIG.overlapChars / 5));
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

function chunkTextWithPages(pages: string[]): ChunkWithMetadata[] {
  const chunks: ChunkWithMetadata[] = [];
  let currentChunk = "";
  let currentPageStart = 1;
  let currentPage = 1;

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const pageNum = pageIdx + 1;
    const sentences = pages[pageIdx].split(/(?<=[.!?])\s+/);

    for (const sentence of sentences) {
      if (
        currentChunk.length + sentence.length > CHUNK_CONFIG.maxChars &&
        currentChunk.length > 0
      ) {
        chunks.push({
          content: currentChunk.trim(),
          pageStart: currentPageStart,
          pageEnd: currentPage,
        });

        const words = currentChunk.split(/\s+/);
        const overlapWords = words.slice(
          -Math.floor(CHUNK_CONFIG.overlapChars / 5)
        );
        currentChunk = overlapWords.join(" ") + " " + sentence;
        currentPageStart = pageNum;
      } else {
        currentChunk += (currentChunk ? " " : "") + sentence;
      }
      currentPage = pageNum;
    }
  }

  if (currentChunk.trim().length >= CHUNK_CONFIG.minChunkSize) {
    chunks.push({
      content: currentChunk.trim(),
      pageStart: currentPageStart,
      pageEnd: currentPage,
    });
  }

  return chunks;
}

// generateEmbedding imported from embedding-client

function classifyDocument(filename: string, content: string): DocumentClassification {
  let category = "ABDOMINAL";
  let priority: DocumentPriority = "STANDARD";
  const subspecialties: string[] = [];
  const tags: string[] = [];

  const searchText = `${filename} ${content}`.toLowerCase();
  for (const rule of KEYWORD_RULES) {
    if (!rule.pattern.test(searchText)) continue;
    if (
      rule.pattern.source.includes("MRI") &&
      MRI_SAFETY_EXCLUSION_PATTERN.test(searchText)
    ) {
      continue;
    }
    if (rule.category && category === "ABDOMINAL") {
      category = rule.category;
    }
    if (rule.priority && getPriorityWeight(rule.priority) > getPriorityWeight(priority)) {
      priority = rule.priority;
    }
    if (rule.subspecialties) {
      subspecialties.push(...rule.subspecialties);
    }
    if (rule.tags) {
      tags.push(...rule.tags);
    }
  }

  const documentTier = inferDocumentTier(searchText);
  return {
    category,
    priority,
    subspecialties: [...new Set(subspecialties)],
    tags: [...new Set(tags)],
    documentTier,
  };
}

function getPriorityWeight(priority: DocumentPriority): number {
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

function inferDocumentTier(searchText: string): "reference" | "clinical" | "educational" {
  const text = searchText.toLowerCase();
  for (const keyword of TEAMS_TIER_MAP.reference) {
    if (text.includes(keyword)) return "reference";
  }
  for (const keyword of TEAMS_TIER_MAP.educational) {
    if (text.includes(keyword)) return "educational";
  }
  return TEAMS_COLLECTION_CONFIG.TEAMS_STANDARD_DOCS.defaultTier;
}

function buildMetadata(relativePath: string, filename: string, sourceType: string) {
  return {
    sourceType,
    sourceFolder: DEFAULT_SOURCE,
    originalPath: relativePath,
    sourceCollection: SOURCE_COLLECTION,
    ingestionMode: "teams-docs",
    filename,
    ingestedAt: new Date().toISOString(),
    sourcePathType: sourceType,
  };
}

async function parsePptx(buffer: Buffer, sourcePath: string): Promise<string> {
  const parser: Record<string, unknown> = await import("pptx-parser");
  const candidate =
    typeof (parser as { fromBuffer?: unknown }).fromBuffer === "function"
      ? await (parser as { fromBuffer: (value: Buffer) => Promise<{ text?: string; slides?: string[] }> }).fromBuffer(buffer)
      : typeof (parser as { parsePptx?: unknown }).parsePptx === "function"
      ? await (parser as { parsePptx: (value: Buffer, options?: { output?: string }) => Promise<unknown> }).parsePptx(
          buffer,
          { output: "text" }
        )
      : typeof (parser as { parse?: unknown }).parse === "function"
      ? await (parser as { parse: (value: string) => Promise<unknown> }).parse(sourcePath)
      : null;

  if (!candidate) {
    return "";
  }

  if (typeof candidate === "string") {
    return candidate.trim();
  }

  const maybe = candidate as {
    text?: string;
    slides?: Array<{ text?: string }>;
    result?: { text?: string };
  };

  if (typeof maybe.text === "string" && maybe.text.trim().length > 0) {
    return maybe.text.trim();
  }

  if (typeof maybe.result?.text === "string") {
    return maybe.result.text.trim();
  }

  if (Array.isArray(maybe.slides)) {
    const joined = maybe.slides
      .map((slide) =>
        typeof slide === "string"
          ? slide
          : typeof slide?.text === "string"
            ? slide.text
            : ""
      )
      .join("\n\n");
    return joined.trim();
  }

  return "";
}

async function extractText(filePath: string): Promise<{ text: string; sourceType: string }> {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".pdf") {
    const buffer = fs.readFileSync(filePath);
    const parsed = await pdfParse(buffer);
    return { text: parsed.text || "", sourceType: "pdf" };
  }

  if (extension === ".docx") {
    const buffer = fs.readFileSync(filePath);
    const parsed = await mammoth.extractRawText({ buffer });
    return { text: parsed.value || "", sourceType: "docx" };
  }

  if (extension === ".pptx") {
    const buffer = fs.readFileSync(filePath);
    const extracted = await parsePptx(buffer, filePath);
    return { text: extracted || "", sourceType: "pptx" };
  }

  if (extension === ".txt" || extension === ".md") {
    const text = fs.readFileSync(filePath, "utf8");
    return { text, sourceType: extension.substring(1) };
  }

  return { text: "", sourceType: "unsupported" };
}

function findSupportedFiles(directory: string): string[] {
  const files: string[] = [];

  function scan(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name.startsWith("~")) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!SUPPORTED_EXTENSIONS.has(ext)) {
          continue;
        }
        files.push(fullPath);
      }
    }
  }

  scan(directory);
  return files;
}

async function processFile(
  filePath: string,
  rootDir: string,
  existing: Set<string>,
  options: CliOptions
): Promise<boolean> {
  const relativePath = path.relative(rootDir, filePath);
  const filename = path.basename(filePath);
  const dedupeKey = `${filename}|${INSTITUTION}|${SOURCE_COLLECTION}`;

  if (existing.has(dedupeKey)) {
    if (options.verbose) {
      console.log(`      Skipping (dedupe): ${relativePath}`);
    }
    return false;
  }

  const { text, sourceType } = await extractText(filePath);
  if (!text || text.trim().length < 100) {
    if (options.verbose) {
      console.log(`      Skipping (too short): ${relativePath}`);
    }
    return false;
  }

  const detection = detectPotentialPHI(text);
  if (detection.hasPotentialPHI) {
    console.log(`      PHI warning (${filename}): ${detection.warnings[0]?.message ?? "Potential PHI detected"}`);
  }

  const classification = classifyDocument(relativePath, text);
  if (options.verbose) {
    console.log(
      `      Classified: ${classification.category} / ${classification.documentTier} (${sourceType})`
    );
  }

  if (options.dryRun) {
    console.log(`      [DRY RUN] Would ingest: ${relativePath}`);
    existing.add(dedupeKey);
    return true;
  }

  const document = await prisma.document.create({
    data: {
      title: path.basename(filePath, path.extname(filePath)),
      source: DEFAULT_SOURCE,
      sourceCollection: SOURCE_COLLECTION,
      documentTier: classification.documentTier as any,
      category: classification.category,
      content: text,
      institution: INSTITUTION as any,
      authorityLevel: "INSTITUTIONAL" as any,
      url: relativePath,
      metadata: buildMetadata(relativePath, filename, sourceType),
      isActive: true,
    },
  });

  const pages = sourceType === "pdf" ? text.split("\n\n<<<PAGE_BREAK>>>\n\n") : [];
  const chunks = pages.length > 0 ? chunkTextWithPages(pages) : chunkText(text).map((chunk) => ({
    content: chunk,
    pageStart: 1,
    pageEnd: 1,
  }));

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const embedding = await generateEmbedding(chunk.content, 'document');
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
        "sourceCollection",
        "documentTier",
        "createdAt"
      )
      VALUES (
        gen_random_uuid(),
        ${document.id},
        ${i},
        ${chunk.content},
        ${embedding}::vector,
        ${INSTITUTION}::"Institution",
        'PROTOCOL'::"Domain",
        'INSTITUTIONAL'::"AuthorityLevel",
        ${JSON.stringify({
          sourcePath: relativePath,
          sourceFile: filename,
          sourceType,
          sourceCollection: SOURCE_COLLECTION,
          documentTier: classification.documentTier,
          pageStart: chunk.pageStart,
          pageEnd: chunk.pageEnd,
          documentTitle: path.basename(filePath, path.extname(filePath)),
          originalSource: filePath,
          documentPriority: classification.priority,
          category: classification.category,
          subspecialties: classification.subspecialties,
          tags: classification.tags,
          ingestedAt: new Date().toISOString(),
        })}::jsonb,
        ${SOURCE_COLLECTION},
        ${classification.documentTier}::"DocumentTier",
        NOW()
      )
    `;
  }

  existing.add(dedupeKey);
  return true;
}

async function main() {
  const options = parseArgs();

  if (!fs.existsSync(SOURCE_DIR)) {
    console.error(`Source directory not found: ${SOURCE_DIR}`);
    process.exit(1);
  }

  console.log(" Teams abdominal ingestion");
  console.log(` Source: ${SOURCE_DIR}`);
  console.log(` Dry run: ${options.dryRun}`);
  console.log(` Clean: ${options.clean}`);
  console.log(` Source collection: ${SOURCE_COLLECTION}`);

  if (options.clean) {
    if (!options.dryRun) {
      console.log(`\nCLEAN: removing existing ${SOURCE_COLLECTION} documents`);
      await prisma.$executeRaw`
        DELETE FROM "DocumentChunk"
        WHERE "sourceCollection" = ${SOURCE_COLLECTION}::text
          AND institution = ${INSTITUTION}::"Institution"
      `;
      const deleted = await prisma.$executeRaw`
        DELETE FROM "Document"
        WHERE "sourceCollection" = ${SOURCE_COLLECTION}::text
          AND institution = ${INSTITUTION}::"Institution"
      `;
      console.log(`Deleted ${deleted} documents`);
    } else {
      const count = await prisma.document.count({
        where: {
          institution: INSTITUTION as any,
          sourceCollection: SOURCE_COLLECTION,
        },
      });
      console.log(`DRY RUN: would delete ${count} documents`);
    }
  }

  const existingDocs = await prisma.document.findMany({
    where: {
      institution: INSTITUTION as any,
      sourceCollection: SOURCE_COLLECTION,
    },
    select: { title: true, metadata: true },
  });

  const existingKeys = new Set(
    existingDocs.map((doc) => {
      const metadata = doc.metadata as Record<string, unknown> | null;
      const metaFilename =
        typeof metadata?.filename === "string" ? metadata.filename : undefined;
      const fallback = path.basename(doc.title);
      const filename = metaFilename || `${fallback}`;
      return `${filename}|${INSTITUTION}|${SOURCE_COLLECTION}`;
    })
  );

  const files = findSupportedFiles(SOURCE_DIR);
  console.log(`Found ${files.length} candidate files`);

  let processed = 0;
  let skipped = 0;
  let errors = 0;
  for (const filePath of files) {
    try {
      const didProcess = await processFile(filePath, SOURCE_DIR, existingKeys, options);
      if (didProcess) {
        processed++;
      } else {
        skipped++;
      }
    } catch (error) {
      errors++;
      console.error(`Error processing ${filePath}:`, error);
    }
  }

  console.log(`\nSummary: processed=${processed}, skipped=${skipped}, errors=${errors}`);
  console.log(`Current ${SOURCE_COLLECTION} docs:`);
  const totals = await prisma.document.count({
    where: { institution: INSTITUTION as any, sourceCollection: SOURCE_COLLECTION },
  });
  console.log(`  Document count: ${totals}`);
}

main()
  .catch((error) => {
    console.error("Ingestion failed:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
