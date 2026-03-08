/**
 * DIAGNOSTIC SCRIPT - Clinical Safety Investigation
 * 
 * This script analyzes the RAG database content for contrast reaction protocols
 * to understand why the system gave passive guidance for an active emergency.
 * 
 * RUN: npx ts-node scripts/diagnostic-contrast.ts
 */

import { PrismaClient } from "@prisma/client";
import { generateEmbedding } from "../packages/api/src/lib/embedding-client";

const prisma = new PrismaClient();

const DIVIDER = "=".repeat(80);
const SUBDIV = "-".repeat(60);

async function runDiagnostics() {
  console.log("\n" + DIVIDER);
  console.log("CLINICAL SAFETY DIAGNOSTIC - CONTRAST REACTION PROTOCOLS");
  console.log(DIVIDER + "\n");

  // ============================================================================
  // DIAGNOSTIC 1: Full Content of Contrast Reaction Protocol
  // ============================================================================
  console.log("\nDIAGNOSTIC 1: CONTRAST REACTION DOCUMENT CHUNKS");
  console.log(DIVIDER);

  const contrastReactionChunks = await prisma.$queryRaw<
    Array<{
      title: string;
      source: string;
      category: string | null;
      chunkIndex: number;
      content: string;
      content_length: number;
    }>
  >`
    SELECT 
      d.title,
      d.source,
      d.category,
      c."chunkIndex",
      c.content,
      LENGTH(c.content) as content_length
    FROM "DocumentChunk" c
    JOIN "Document" d ON c."documentId" = d.id
    WHERE d.title ILIKE '%contrast reaction%'
       OR d.title ILIKE '%Management of Contrast%'
    ORDER BY d.title, c."chunkIndex"
  `;

  if (contrastReactionChunks.length === 0) {
    console.log("NO CONTRAST REACTION DOCUMENT FOUND IN DATABASE!");
    console.log("   This is a critical gap - the Management of Contrast Reactions.pdf");
    console.log("   may not have been ingested.\n");
  } else {
    console.log(`Found ${contrastReactionChunks.length} chunks:\n`);
    
    for (const chunk of contrastReactionChunks) {
      console.log(SUBDIV);
      console.log(`CHUNK ${chunk.chunkIndex} of "${chunk.title}" (${chunk.content_length} chars)`);
      console.log(`Category: ${chunk.category} | Source: ${chunk.source}`);
      console.log(SUBDIV);
      console.log(chunk.content);
      console.log("\n");
    }
  }

  // ============================================================================
  // DIAGNOSTIC 2: Search for Severity-Specific Content
  // ============================================================================
  console.log("\nDIAGNOSTIC 2: SEVERITY-SPECIFIC CONTENT");
  console.log(DIVIDER);

  const severityContent = await prisma.$queryRaw<
    Array<{
      title: string;
      chunkIndex: number;
      content: string;
    }>
  >`
    SELECT 
      d.title,
      c."chunkIndex",
      c.content
    FROM "DocumentChunk" c
    JOIN "Document" d ON c."documentId" = d.id
    WHERE 
      c.content ILIKE '%severe%'
      AND (
        c.content ILIKE '%contrast%' 
        OR c.content ILIKE '%reaction%'
        OR c.content ILIKE '%anaphyla%'
      )
  `;

  console.log(`Found ${severityContent.length} chunks containing "severe" + contrast/reaction terms:\n`);
  
  for (const chunk of severityContent) {
    console.log(SUBDIV);
    console.log(`"${chunk.title}" - Chunk ${chunk.chunkIndex}`);
    console.log(SUBDIV);
    console.log(chunk.content);
    console.log("\n");
  }

  // ============================================================================
  // DIAGNOSTIC 3: Search for O2/Oxygen/Desaturation Guidance
  // ============================================================================
  console.log("\nDIAGNOSTIC 3: O2/OXYGEN/DESATURATION GUIDANCE");
  console.log(DIVIDER);

  const oxygenContent = await prisma.$queryRaw<
    Array<{
      title: string;
      chunkIndex: number;
      content: string;
    }>
  >`
    SELECT 
      d.title,
      c."chunkIndex",
      c.content
    FROM "DocumentChunk" c
    JOIN "Document" d ON c."documentId" = d.id
    WHERE 
      c.content ILIKE '%oxygen%'
      OR c.content ILIKE '%O2 sat%'
      OR c.content ILIKE '%desaturat%'
      OR c.content ILIKE '%SpO2%'
      OR c.content ILIKE '%respiratory%distress%'
      OR c.content ILIKE '%airway%'
      OR c.content ILIKE '%bronchospasm%'
      OR c.content ILIKE '%stridor%'
      OR c.content ILIKE '%wheezing%'
  `;

  console.log(`Found ${oxygenContent.length} chunks with oxygen/saturation/airway guidance:\n`);
  
  for (const chunk of oxygenContent) {
    console.log(SUBDIV);
    console.log(`"${chunk.title}" - Chunk ${chunk.chunkIndex}`);
    console.log(SUBDIV);
    console.log(chunk.content);
    console.log("\n");
  }

  // ============================================================================
  // DIAGNOSTIC 4: Search for Epinephrine Dosing
  // ============================================================================
  console.log("\nDIAGNOSTIC 4: EPINEPHRINE GUIDANCE");
  console.log(DIVIDER);

  const epiContent = await prisma.$queryRaw<
    Array<{
      title: string;
      chunkIndex: number;
      content: string;
    }>
  >`
    SELECT 
      d.title,
      c."chunkIndex",
      c.content
    FROM "DocumentChunk" c
    JOIN "Document" d ON c."documentId" = d.id
    WHERE 
      c.content ILIKE '%epinephrine%'
      OR c.content ILIKE '%epipen%'
      OR c.content ILIKE '%adrenaline%'
  `;

  console.log(`Found ${epiContent.length} chunks with epinephrine guidance:\n`);
  
  for (const chunk of epiContent) {
    console.log(SUBDIV);
    console.log(`"${chunk.title}" - Chunk ${chunk.chunkIndex}`);
    console.log(SUBDIV);
    console.log(chunk.content);
    console.log("\n");
  }

  // ============================================================================
  // DIAGNOSTIC 5: Check if ACR Manual Was Ingested
  // ============================================================================
  console.log("\nDIAGNOSTIC 5: ACR MANUAL STATUS");
  console.log(DIVIDER);

  const acrDocuments = await prisma.$queryRaw<
    Array<{
      id: string;
      title: string;
      source: string;
      category: string | null;
      content_length: number;
      chunk_count: bigint;
    }>
  >`
    SELECT 
      d.id,
      d.title,
      d.source,
      d.category,
      LENGTH(d.content) as content_length,
      COUNT(c.id) as chunk_count
    FROM "Document" d
    LEFT JOIN "DocumentChunk" c ON d.id = c."documentId"
    WHERE d.title ILIKE '%ACR%'
       OR d.title ILIKE '%American College of Radiology%'
    GROUP BY d.id
  `;

  if (acrDocuments.length === 0) {
    console.log("NO ACR MANUAL FOUND IN DATABASE!");
    console.log("   A contrast media reference manual has detailed severity grading.");
    console.log("   This is a major content gap.\n");
  } else {
    console.log(`Found ${acrDocuments.length} ACR document(s):\n`);
    for (const doc of acrDocuments) {
      console.log(`  - "${doc.title}"`);
      console.log(`    Category: ${doc.category} | Source: ${doc.source}`);
      console.log(`    Content: ${doc.content_length} chars | Chunks: ${doc.chunk_count}`);
      console.log("");
    }
  }

  // ============================================================================
  // DIAGNOSTIC 6: All Documents Summary
  // ============================================================================
  console.log("\nDIAGNOSTIC 6: ALL DOCUMENTS IN DATABASE");
  console.log(DIVIDER);

  const allDocs = await prisma.$queryRaw<
    Array<{
      title: string;
      category: string | null;
      content_length: number;
      chunk_count: bigint;
    }>
  >`
    SELECT 
      d.title,
      d.category,
      LENGTH(d.content) as content_length,
      COUNT(c.id) as chunk_count
    FROM "Document" d
    LEFT JOIN "DocumentChunk" c ON d.id = c."documentId"
    GROUP BY d.id
    ORDER BY d.category, d.title
  `;

  console.log(`Total documents: ${allDocs.length}\n`);
  
  let currentCategory = "";
  for (const doc of allDocs) {
    if (doc.category !== currentCategory) {
      currentCategory = doc.category || "UNCATEGORIZED";
      console.log(`\n[${currentCategory}]`);
    }
    console.log(`  - ${doc.title} (${doc.content_length} chars, ${doc.chunk_count} chunks)`);
  }

  // ============================================================================
  // DIAGNOSTIC 7: Simulate RAG Search for Desaturation Query
  // ============================================================================
  console.log("\n\nDIAGNOSTIC 7: SIMULATED RAG SEARCH");
  console.log(DIVIDER);

  const testQuery = "Patient has itching, hives, and scratchy throat after receiving an iodinated contrast 5 minutes ago. Benadryl administered. Patient's oxygen saturation is 99% on room air, originally, and now is at 88%. What do I do?";
  
  console.log("Test Query:");
  console.log(`"${testQuery}"\n`);

  try {
    // Generate embedding for the query
    const queryEmbedding = await generateEmbedding(testQuery);

    // Perform vector search
    const searchResults = await prisma.$queryRaw<
      Array<{
        id: string;
        title: string;
        category: string | null;
        chunkIndex: number;
        content: string;
        similarity: number;
      }>
    >`
      SELECT 
        dc.id,
        d.title,
        d.category,
        dc."chunkIndex",
        dc.content,
        1 - (dc.embedding <=> ${queryEmbedding}::vector) as similarity
      FROM "DocumentChunk" dc
      JOIN "Document" d ON dc."documentId" = d.id
      WHERE d."isActive" = true
      ORDER BY dc.embedding <=> ${queryEmbedding}::vector
      LIMIT 10
    `;

    console.log(`Top ${searchResults.length} retrieved chunks:\n`);

    for (let i = 0; i < searchResults.length; i++) {
      const r = searchResults[i];
      console.log(SUBDIV);
      console.log(`RESULT ${i + 1} - Similarity: ${(Number(r.similarity) * 100).toFixed(1)}%`);
      console.log(`Document: "${r.title}" (Chunk ${r.chunkIndex})`);
      console.log(`Category: ${r.category}`);
      console.log(SUBDIV);
      console.log(r.content);
      console.log("\n");

      // Flag if this chunk contains critical keywords
      const content = r.content.toLowerCase();
      const hasEpinephrine = content.includes("epinephrine");
      const hasSevere = content.includes("severe");
      const hasAirway = content.includes("airway");
      const hasOxygen = content.includes("oxygen") || content.includes("o2");
      const hasAnaphylaxis = content.includes("anaphyla");

      if (hasEpinephrine || hasSevere || hasAirway || hasOxygen || hasAnaphylaxis) {
        console.log("CRITICAL CONTENT FLAGS:");
        if (hasEpinephrine) console.log("   - Contains 'epinephrine'");
        if (hasSevere) console.log("   - Contains 'severe'");
        if (hasAirway) console.log("   - Contains 'airway'");
        if (hasOxygen) console.log("   - Contains 'oxygen/O2'");
        if (hasAnaphylaxis) console.log("   - Contains 'anaphylaxis'");
        console.log("");
      }
    }

    // Analysis
    console.log("\n" + DIVIDER);
    console.log("RETRIEVAL ANALYSIS");
    console.log(DIVIDER);

    const topSimilarity = Number(searchResults[0]?.similarity || 0);
    const hasHighConfidence = topSimilarity >= 0.6;

    console.log(`\nTop similarity score: ${(topSimilarity * 100).toFixed(1)}%`);
    console.log(`Meets confidence threshold (60%): ${hasHighConfidence ? "YES" : "NO"}`);

    // Check if critical content was retrieved
    const allContent = searchResults.map(r => r.content.toLowerCase()).join(" ");
    
    console.log("\nCritical content in top 10 results:");
    console.log(`  - Epinephrine dosing: ${allContent.includes("epinephrine") ? "FOUND" : "MISSING"}`);
    console.log(`  - Severe reaction criteria: ${allContent.includes("severe") ? "FOUND" : "MISSING"}`);
    console.log(`  - Airway management: ${allContent.includes("airway") ? "FOUND" : "MISSING"}`);
    console.log(`  - Oxygen guidance: ${allContent.includes("oxygen") ? "FOUND" : "MISSING"}`);
    console.log(`  - Anaphylaxis protocol: ${allContent.includes("anaphyla") ? "FOUND" : "MISSING"}`);
    console.log(`  - O2 saturation thresholds: ${allContent.includes("saturation") || allContent.includes("spo2") ? "FOUND" : "MISSING"}`);

  } catch (error) {
    console.log("Error running simulated search:", error);
  }

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log("\n\n" + DIVIDER);
  console.log("DIAGNOSTIC SUMMARY");
  console.log(DIVIDER);

  console.log(`
KEY FINDINGS:

1. CONTRAST REACTION DOCUMENT STATUS:
   - Chunks found: ${contrastReactionChunks.length}
   
2. SEVERITY-SPECIFIC CONTENT:
   - Chunks with "severe" + contrast terms: ${severityContent.length}
   
3. OXYGEN/AIRWAY GUIDANCE:
   - Chunks found: ${oxygenContent.length}
   
4. EPINEPHRINE CONTENT:
   - Chunks found: ${epiContent.length}
   
5. ACR MANUAL STATUS:
   - Documents found: ${acrDocuments.length}
   
6. TOTAL DOCUMENTS IN DATABASE:
   - ${allDocs.length} documents

NEXT STEPS:
- Review the full chunk content above to assess chunking quality
- Check if critical decision algorithms are preserved or fragmented
- Verify if O2 sat thresholds are explicitly stated
- Confirm epinephrine dosing instructions are complete
`);

  await prisma.$disconnect();
}

runDiagnostics().catch((error) => {
  console.error("Diagnostic failed:", error);
  prisma.$disconnect();
  process.exit(1);
});
