/**
 * Backfill institution field for existing documents
 * Safe to run multiple times (idempotent)
 *
 * Run with: npx tsx scripts/backfill-institution.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Starting institution backfill...\n");

  // Step 1: Update all existing Documents to Institution B (they came from institution-b-policies-legacy)
  console.log("Step 1: Updating Documents without institution to Institution B...");

  // Note: Prisma doesn't support filtering by undefined enum, so we use raw SQL
  const docResult = await prisma.$executeRaw`
    UPDATE "Document"
    SET institution = 'INSTITUTION_B'::"Institution"
    WHERE institution IS NULL
  `;
  console.log(`   Updated ${docResult} documents to Institution B`);

  // Step 2: Backfill DocumentChunk.institution from parent Document
  console.log("\nStep 2: Backfilling DocumentChunk institutions from parent Documents...");

  const chunkResult = await prisma.$executeRaw`
    UPDATE "DocumentChunk" dc
    SET institution = d.institution
    FROM "Document" d
    WHERE dc."documentId" = d.id
      AND dc.institution IS NULL
  `;
  console.log(`   Updated ${chunkResult} document chunks`);

  // Step 3: Verify
  console.log("\nStep 3: Verification...");

  const nullInstitutionDocs = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*) as count FROM "Document" WHERE institution IS NULL
  `;
  const nullInstitutionChunks = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*) as count FROM "DocumentChunk" WHERE institution IS NULL
  `;

  const nullDocs = Number(nullInstitutionDocs[0]?.count || 0);
  const nullChunks = Number(nullInstitutionChunks[0]?.count || 0);

  if (nullDocs > 0 || nullChunks > 0) {
    console.error(
      `   WARNING: ${nullDocs} docs and ${nullChunks} chunks still have null institution`
    );
  } else {
    console.log("   All documents and chunks have institution set");
  }

  // Step 4: Summary
  console.log("\nInstitution distribution:");

  const summary = await prisma.$queryRaw<
    Array<{ institution: string; count: bigint }>
  >`
    SELECT institution::text, COUNT(*) as count
    FROM "Document"
    GROUP BY institution
    ORDER BY count DESC
  `;

  summary.forEach((s) => {
    console.log(`   ${s.institution || "NULL"}: ${s.count} documents`);
  });

  console.log("\nBackfill complete!");
}

main()
  .catch((e) => {
    console.error("Backfill failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
