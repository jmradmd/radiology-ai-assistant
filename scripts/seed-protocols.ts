import { PrismaClient, Institution } from "@prisma/client";
import { generateEmbedding } from "../packages/api/src/lib/embedding-client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

// Protocol documents to seed - add your actual protocols here
// Each protocol should have: title, source, category, subspecialties, content, institution
const SAMPLE_PROTOCOLS: Array<{
  title: string;
  source: string;
  category: string;
  subspecialties: string[];
  content: string;
  institution?: Institution;
}> = [
  // Add your actual protocol documents here
  // Example:
  // {
  //   title: "Protocol Name",
  //   source: "ACR" or "institutional",
  //   category: "CONTRAST" | "SAFETY" | "PROTOCOL" | "PREP",
  //   subspecialties: ["ABDOMINAL", "NEURO", etc.],
  //   content: "Full protocol text content...",
  // },
];

// Text chunking function
function chunkText(text: string, chunkSize: number, overlap: number): string[] {
  const chunks: string[] = [];
  const lines = text.split("\n");
  let currentChunk: string[] = [];
  let currentSize = 0;

  for (const line of lines) {
    const words = line.split(/\s+/).filter((w) => w.length > 0);

    for (const word of words) {
      currentChunk.push(word);
      currentSize++;

      if (currentSize >= chunkSize) {
        chunks.push(currentChunk.join(" "));

        // Keep overlap words
        const overlapCount = Math.floor(overlap);
        currentChunk = currentChunk.slice(-overlapCount);
        currentSize = currentChunk.length;
      }
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join(" "));
  }

  return chunks;
}

async function seedProtocols() {
  console.log("Starting protocol seeding...\n");

  for (const protocol of SAMPLE_PROTOCOLS) {
    console.log(`Processing: ${protocol.title}`);

    // Check if document already exists
    const existing = await prisma.document.findFirst({
      where: { title: protocol.title },
    });

    if (existing) {
      console.log(`  Already exists, skipping...\n`);
      continue;
    }

    // Create document
    const institution = protocol.institution || "INSTITUTION_B";
    const document = await prisma.document.create({
      data: {
        title: protocol.title,
        source: protocol.source,
        category: protocol.category,
        subspecialties: protocol.subspecialties,
        content: protocol.content,
        institution,
        isActive: true,
      },
    });

    console.log(`  Created document: ${document.id}`);

    // Chunk the content
    const chunks = chunkText(protocol.content, 512, 100);
    console.log(`  Created ${chunks.length} chunks`);

    // Generate embeddings and store
    for (let i = 0; i < chunks.length; i++) {
      try {
        const embedding = await generateEmbedding(chunks[i], 'document');

        // Insert using raw SQL for vector type
        await prisma.$executeRawUnsafe(
          `INSERT INTO "DocumentChunk" (id, "documentId", "chunkIndex", content, embedding, institution, "createdAt")
           VALUES (gen_random_uuid(), $1, $2, $3, $4::vector, $5::"Institution", NOW())`,
          document.id,
          i,
          chunks[i],
          `[${embedding.join(",")}]`,
          institution
        );

        process.stdout.write(`  Embedded chunk ${i + 1}/${chunks.length}\r`);
      } catch (error: any) {
        console.error(`\n  Error embedding chunk ${i}: ${error.message}`);
      }
    }

    console.log(`\n  Completed: ${protocol.title}\n`);
  }

  console.log("Protocol seeding complete!");
}

async function main() {
  try {
    await seedProtocols();
  } catch (error) {
    console.error("Error seeding protocols:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
