/**
 * Directory Data Ingestion Script
 *
 * Ingests the department directory into the RAG vector store
 * so the assistant can answer questions like "what is the Institution B IT number?"
 *
 * Usage:
 *   npx tsx scripts/ingest-directory.ts
 *   npx tsx scripts/ingest-directory.ts --clean   (delete existing first)
 *   npx tsx scripts/ingest-directory.ts --dry-run  (show what would be done)
 */

import { PrismaClient } from "@prisma/client";
import OpenAI from "openai";
import { directoryToPlainText, DIRECTORY_SECTIONS } from "../packages/shared/src/data/directory-data";

const prisma = new PrismaClient();

const DOCUMENT_TITLE = "institutional Radiology Department Directory";
const DOCUMENT_SOURCE = "Radiology AI Assistant Internal";
const DOCUMENT_CATEGORY = "GENERAL";
const INSTITUTION = "SHARED"; // Applies to both Institution A and Institution B

// Matches chunking parameters from uploadDocument in rag.ts
const CHUNK_SIZE = 512;
const CHUNK_OVERLAP = 100;

/**
 * Simple word-based chunking (same approach as chunkText in rag.ts)
 */
function chunkText(text: string, maxWords: number, overlapWords: number): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  let i = 0;

  while (i < words.length) {
    const chunk = words.slice(i, i + maxWords).join(" ");
    if (chunk.trim().length > 0) {
      chunks.push(chunk);
    }
    i += maxWords - overlapWords;
  }

  return chunks;
}

async function main() {
  const isClean = process.argv.includes("--clean");
  const isDryRun = process.argv.includes("--dry-run");

  console.log("=== Directory Data Ingestion ===");
  console.log(`Clean mode: ${isClean}`);
  console.log(`Dry run: ${isDryRun}`);

  // Delete existing directory document if --clean
  if (isClean && !isDryRun) {
    const deleted = await prisma.document.deleteMany({
      where: { title: DOCUMENT_TITLE },
    });
    console.log(`Deleted ${deleted.count} existing directory document(s)`);
  }

  // Check if already exists
  const existing = await prisma.document.findFirst({
    where: { title: DOCUMENT_TITLE },
  });

  if (existing && !isClean) {
    console.log("Directory document already exists. Use --clean to re-ingest.");
    console.log(`Document ID: ${existing.id}`);
    await prisma.$disconnect();
    process.exit(0);
  }

  // Generate plain text from directory data
  const plainText = directoryToPlainText();
  console.log(`Generated ${plainText.length} characters of directory text`);
  console.log(`Sections: ${DIRECTORY_SECTIONS.length}`);

  // Generate one chunk per INDIVIDUAL contact/system entry for precise retrieval.
  // Each entry gets its own embedding so "PACS support number" directly matches
  // the PACS entry rather than being diluted across an entire section.
  const chunks: string[] = [];
  for (const section of DIRECTORY_SECTIONS) {
    const sectionHeader = `${section.label} — ${section.description}`;

    if (section.type === "contacts" && section.contacts) {
      for (const c of section.contacts) {
        const lines: string[] = [sectionHeader, "", `### ${c.name}`];
        if (c.phone) lines.push(`- Phone: ${c.phone}`);
        if (c.phoneAlt) lines.push(`- Alternate phone: ${c.phoneAlt}`);
        if (c.email) lines.push(`- Email: ${c.email}`);
        if (c.hours) lines.push(`- Hours: ${c.hours}`);
        if (c.location) lines.push(`- Location: ${c.location}`);
        if (c.url) lines.push(`- Portal: ${c.url}`);
        if (c.notes) lines.push(`- Notes: ${c.notes}`);
        if (c.institution) lines.push(`- Institution: ${c.institution}`);
        chunks.push(lines.join("\n"));
      }
    }

    if (section.type === "systems" && section.systems) {
      for (const s of section.systems) {
        const lines: string[] = [sectionHeader, "", `### ${s.name}`];
        lines.push(`- Purpose: ${s.purpose}`);
        if (s.accessUrl) lines.push(`- Access: ${s.accessUrl}`);
        if (s.loginMethod) lines.push(`- Login: ${s.loginMethod}`);
        if (s.supportContact) lines.push(`- Support contact: ${s.supportContact}`);
        if (s.supportPhone) lines.push(`- Support phone: ${s.supportPhone}`);
        if (s.manualLocation) lines.push(`- Manual/documentation: ${s.manualLocation}`);
        if (s.notes) lines.push(`- Notes: ${s.notes}`);
        if (s.institution) lines.push(`- Institution: ${s.institution}`);
        chunks.push(lines.join("\n"));
      }
    }
  }
  console.log(`Split into ${chunks.length} per-entry chunks`);

  if (isDryRun) {
    console.log("\n--- DRY RUN: No changes made ---");
    console.log(`Would create 1 document + ${chunks.length} chunks`);
    chunks.forEach((chunk, i) => {
      console.log(`  Chunk ${i}: ${chunk.slice(0, 80)}...`);
    });
    await prisma.$disconnect();
    return;
  }

  // Only instantiate OpenAI when we actually need embeddings
  const openai = new OpenAI();

  const generateEmbedding = async (text: string): Promise<number[]> => {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
      dimensions: 1536,
    });
    return response.data[0].embedding;
  };

  // Create document record
  const document = await prisma.document.create({
    data: {
      title: DOCUMENT_TITLE,
      source: DOCUMENT_SOURCE,
      category: DOCUMENT_CATEGORY,
      institution: INSTITUTION as any,
      content: plainText,
      metadata: {
        type: "directory",
        generatedAt: new Date().toISOString(),
        sectionCount: DIRECTORY_SECTIONS.length,
      } as any,
    },
  });

  console.log(`Created document: ${document.id}`);

  // Embed and store each chunk
  // SQL matches uploadDocument pattern: id, documentId, chunkIndex, content, embedding, institution, createdAt
  for (let i = 0; i < chunks.length; i++) {
    process.stdout.write(`  Embedding chunk ${i + 1}/${chunks.length}...`);

    const embedding = await generateEmbedding(chunks[i]);

    await prisma.$executeRaw`
      INSERT INTO "DocumentChunk" (id, "documentId", "chunkIndex", content, embedding, institution, "createdAt")
      VALUES (
        gen_random_uuid(),
        ${document.id},
        ${i},
        ${chunks[i]},
        ${embedding}::vector,
        ${INSTITUTION}::"Institution",
        NOW()
      )
    `;

    console.log(" done");
  }

  console.log(`\nSuccess! Ingested ${chunks.length} chunks for "${DOCUMENT_TITLE}"`);
  console.log(`Document ID: ${document.id}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Ingestion failed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
