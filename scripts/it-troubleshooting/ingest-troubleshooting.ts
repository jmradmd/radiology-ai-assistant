#!/usr/bin/env npx ts-node
/**
 * Ingest IT Systems Troubleshooting Knowledge Base into the Radiology AI Assistant RAG vector store.
 *
 * Usage:
 *   npm run ingest:troubleshooting              # Incremental ingest
 *   npm run ingest:troubleshooting:clean         # Delete existing + re-ingest
 *   npx ts-node scripts/ingest-troubleshooting.ts --dry-run   # Preview without API calls
 *   npx ts-node scripts/ingest-troubleshooting.ts --verbose   # Detailed output
 *   npx ts-node scripts/ingest-troubleshooting.ts --clean     # Delete existing first
 *
 * Pattern: Matches ingest-directory.ts exactly.
 */

import { PrismaClient } from '@prisma/client';
import {
  troubleshootingToChunks,
  troubleshootingToPlainText,
  ALL_TROUBLESHOOTING_ENTRIES,
  TROUBLESHOOTING_SECTIONS,
} from './troubleshooting-data';

// ── CLI Flags ───────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');
const CLEAN = args.includes('--clean');

// ── Constants ───────────────────────────────────────────────────────

const DOC_TITLE = 'IT Systems Troubleshooting Guide - institutional Radiology';
const DOC_SOURCE = 'IT_KNOWLEDGE_BASE';
const DOC_CATEGORY = 'GENERAL'; // Using existing category + metadata approach
const DOC_INSTITUTION = 'SHARED';
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;
const REQUIRED_SECTION_ROUTES: Record<string, string> = {
  EPIC_012: 'epic_worklist',
  PACS_011: 'pacs_connectivity',
  PACS_018: 'pacs_configuration',
  FLU_008: 'fluency_connectivity',
  FLU_010: 'fluency_connectivity',
  FLU_011: 'fluency_client_stability',
  FLU_013: 'fluency_mobile',
  FLU_014: 'fluency_hardware',
  FLU_015: 'fluency_client_stability',
};

// ── Prisma Client ───────────────────────────────────────────────────

const prisma = new PrismaClient();

// ── OpenAI (lazy instantiation for dry-run support) ─────────────────

let openaiClient: any = null;

async function getOpenAI() {
  if (openaiClient) return openaiClient;
  const openaiModule = await import('openai');
  const OpenAI = (openaiModule.default ?? (openaiModule as any).OpenAI) as any;
  openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openaiClient;
}

async function generateEmbedding(text: string): Promise<number[]> {
  const openai = await getOpenAI();
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
    dimensions: EMBEDDING_DIMENSIONS,
  });
  return response.data[0].embedding;
}

interface CoverageValidationResult {
  totalEntries: number;
  sectionCount: number;
}

function findDuplicateIds(ids: string[]): string[] {
  return ids.filter((id, index) => ids.indexOf(id) !== index);
}

function validateSectionCoverage(verbose = false): CoverageValidationResult {
  const canonicalIds = ALL_TROUBLESHOOTING_ENTRIES.map(entry => entry.id);
  const canonicalIdSet = new Set(canonicalIds);
  const duplicateCanonicalIds = Array.from(new Set(findDuplicateIds(canonicalIds)));

  const sectionEntries = TROUBLESHOOTING_SECTIONS.flatMap(section =>
    section.entries.map(entry => ({ sectionId: section.id, entryId: entry.id }))
  );
  const routedEntryIds = sectionEntries.map(item => item.entryId);
  const routedEntrySet = new Set(routedEntryIds);

  const orphanedIds = canonicalIds.filter(id => !routedEntrySet.has(id));
  const unknownRoutedIds = Array.from(routedEntrySet).filter(id => !canonicalIdSet.has(id));

  const sectionToIds = new Map(
    TROUBLESHOOTING_SECTIONS.map(section => [
      section.id,
      new Set(section.entries.map(entry => entry.id)),
    ])
  );

  const routeMismatches = Object.entries(REQUIRED_SECTION_ROUTES).filter(
    ([entryId, sectionId]) => !sectionToIds.get(sectionId)?.has(entryId)
  );

  console.log('Coverage validation:');
  console.log(`  Orphaned entries: ${orphanedIds.length}`);
  console.log(`  Duplicate IDs: ${duplicateCanonicalIds.length}`);
  console.log(`  Final section count: ${TROUBLESHOOTING_SECTIONS.length}`);
  console.log(`  Final entry count: ${canonicalIds.length}`);

  if (verbose) {
    if (orphanedIds.length > 0) {
      console.log(`  Orphan IDs: ${orphanedIds.join(', ')}`);
    }
    if (duplicateCanonicalIds.length > 0) {
      console.log(`  Duplicate IDs: ${duplicateCanonicalIds.join(', ')}`);
    }
    if (unknownRoutedIds.length > 0) {
      console.log(`  Unknown routed IDs: ${unknownRoutedIds.join(', ')}`);
    }
    if (routeMismatches.length > 0) {
      console.log(
        `  Route mismatches: ${routeMismatches
          .map(([entryId, sectionId]) => `${entryId}->${sectionId}`)
          .join(', ')}`
      );
    }
  }

  if (
    orphanedIds.length > 0
    || duplicateCanonicalIds.length > 0
    || unknownRoutedIds.length > 0
    || routeMismatches.length > 0
  ) {
    throw new Error(
      'Troubleshooting coverage validation failed. Resolve orphaned IDs, duplicate IDs, unknown routed IDs, or route mismatches before ingest.'
    );
  }

  return {
    totalEntries: canonicalIds.length,
    sectionCount: TROUBLESHOOTING_SECTIONS.length,
  };
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log('=== IT Systems Troubleshooting Ingestion ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no DB/API calls)' : 'LIVE'}`);
  console.log(`Clean: ${CLEAN ? 'YES (delete existing first)' : 'NO (incremental)'}`);
  console.log('');

  const coverage = validateSectionCoverage(VERBOSE);

  // Generate chunks
  const chunks = troubleshootingToChunks();
  const totalEntries = coverage.totalEntries;

  console.log(`Sections: ${coverage.sectionCount}`);
  console.log(`Total entries: ${totalEntries}`);
  console.log(`Chunks to embed: ${chunks.length}`);
  console.log('');

  if (VERBOSE) {
    console.log('Section breakdown:');
    TROUBLESHOOTING_SECTIONS.forEach(s => {
      console.log(`  ${s.id}: ${s.entries.length} entries (${s.systems.join(', ')})`);
    });
    console.log('');
  }

  if (DRY_RUN) {
    console.log('--- DRY RUN: Chunk Preview ---');
    chunks.forEach((chunk, i) => {
      const tokenEstimate = Math.round(chunk.content.length / 4);
      console.log(`\nChunk ${i + 1}/${chunks.length}: "${chunk.sectionTitle}" (~${tokenEstimate} tokens)`);
      if (VERBOSE) {
        console.log(chunk.content.substring(0, 300) + '...');
      }
    });
    console.log('\n--- DRY RUN COMPLETE ---');
    console.log(`Would create 1 Document record and ${chunks.length} DocumentChunk records.`);
    await prisma.$disconnect();
    return;
  }

  // ── Clean existing (if requested) ─────────────────────────────────

  if (CLEAN) {
    console.log('Cleaning existing IT troubleshooting documents...');
    const existing = await prisma.document.findMany({
      where: { source: DOC_SOURCE },
      select: { id: true },
    });

    if (existing.length > 0) {
      const docIds = existing.map(d => d.id);
      const deletedChunks = await prisma.documentChunk.deleteMany({
        where: { documentId: { in: docIds } },
      });
      const deletedDocs = await prisma.document.deleteMany({
        where: { id: { in: docIds } },
      });
      console.log(`  Deleted ${deletedDocs.count} documents, ${deletedChunks.count} chunks.`);
    } else {
      console.log('  No existing IT troubleshooting documents found.');
    }
  }

  // ── Check for existing document ───────────────────────────────────

  const existingDoc = await prisma.document.findFirst({
    where: { source: DOC_SOURCE },
  });

  if (existingDoc && !CLEAN) {
    console.log(`Document already exists (id: ${existingDoc.id}). Use --clean to re-ingest.`);
    await prisma.$disconnect();
    return;
  }

  // ── Create Document record ────────────────────────────────────────

  console.log('Creating Document record...');
  const fullText = troubleshootingToPlainText();
  const doc = await prisma.document.create({
    data: {
      title: DOC_TITLE,
      source: DOC_SOURCE,
      category: DOC_CATEGORY,
      institution: DOC_INSTITUTION,
      content: fullText,
      isActive: true,
      metadata: {
        contentType: 'IT_TROUBLESHOOTING',
        version: '1.0.0',
        systems: ['EMR', 'PACS', 'WORKLIST', 'DICTATION'],
        sectionCount: TROUBLESHOOTING_SECTIONS.length,
        entryCount: totalEntries,
        generatedAt: new Date().toISOString(),
      },
    },
  });
  console.log(`  Document created: ${doc.id}`);

  // ── Generate embeddings and create chunks ─────────────────────────

  console.log('Generating embeddings and creating chunks...');
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    console.log(`  [${i + 1}/${chunks.length}] ${chunk.sectionTitle}...`);

    const embedding = await generateEmbedding(chunk.content);

    // Use raw SQL for pgvector insertion (Prisma doesn't support vector natively)
    await prisma.$executeRaw`
      INSERT INTO "DocumentChunk" (
        "id", "documentId", "chunkIndex", "content", "embedding",
        "institution", "metadata", "createdAt"
      )
      VALUES (
        gen_random_uuid(),
        ${doc.id},
        ${i},
        ${chunk.content},
        ${embedding}::vector,
        ${DOC_INSTITUTION}::"Institution",
        ${JSON.stringify({
          sectionId: chunk.sectionId,
          contentType: 'IT_TROUBLESHOOTING',
        })}::jsonb,
        NOW()
      )
    `;

    if (VERBOSE) {
      const tokenEstimate = Math.round(chunk.content.length / 4);
      console.log(`    ~${tokenEstimate} tokens, embedding dimensions: ${embedding.length}`);
    }
  }

  console.log('');
  console.log('=== Ingestion Complete ===');
  console.log(`Document: ${doc.id}`);
  console.log(`Chunks created: ${chunks.length}`);
  console.log(`Sections: ${coverage.sectionCount}`);
  console.log(`Total entries: ${totalEntries}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Ingestion failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
