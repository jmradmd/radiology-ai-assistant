# Content Ingestion Guide

This guide explains how to add your own institutional content to the RAG knowledge base.

---

## Overview

The system supports multiple content types, each with its own ingestion pipeline:

| Content Type | Script | Directory | Description |
|-------------|--------|-----------|-------------|
| Institutional Policies | `ingest-institution.ts` | `institution-a-policies/`, `institution-b-policies/` | Hospital/department protocol PDFs |
| Clinical Guidelines | `ingest-guidelines.ts` | `guidelines/` | Society/national guideline PDFs |
| Departmental Documents | `ingest-teams-docs.ts` | `teams_standard_docs/` | Team standards (PDF/DOCX/PPTX/TXT/MD) |
| IT Troubleshooting | `ingest-troubleshooting.ts` | (TypeScript data file) | IT systems knowledge base |
| Staff Directory | `ingest-directory.ts` | (TypeScript data file) | Department contacts and on-call info |

---

## 1. Institutional Policies

Place PDF files in the appropriate institution folder:

```
institution-a-policies/
  Contrast Policies/
    Contrast Reaction Protocol.pdf
    Premedication Guidelines.pdf
  MRI Safety/
    MRI Screening Form.pdf
    Implant Safety Policy.pdf
  ...

institution-b-policies/
  CT Protocols/
    Adult CT Abdomen.pdf
  ...
```

### Running Ingestion

```bash
# Ingest Institution A policies
npm run ingest:institution-a

# Ingest Institution B policies
npm run ingest:institution-b

# Ingest all institutions
npm run ingest:all

# Preview what would be ingested (no DB writes)
npx tsx scripts/ingest-institution.ts --institution ALL --dry-run

# Clean and re-ingest everything (CAUTION: deletes existing docs first)
npm run ingest:all:clean
```

### Document Classification

Documents are automatically classified by:
- **Folder name** -- Maps to a primary category (e.g., "Contrast Policies" -> CONTRAST)
- **Filename patterns** -- Regex rules refine category and set priority

To customize classification rules, edit `KEYWORD_RULES` in `scripts/ingest-institution.ts`.

### Categories

Available categories: CONTRAST, MRI_SAFETY, CT_PROTOCOL, MAMMO, ULTRASOUND, MEDICATION, NURSING, PEDIATRIC, PREGNANCY, RENAL, SAFETY, WORKFLOW, CRITICAL, COMPLIANCE, GENERAL.

### Priority Levels

- **CRITICAL** -- Emergency protocols, contrast reactions, MRI safety
- **HIGH** -- Cardiac protocols, pediatric, medication administration
- **STANDARD** -- Workflow, administrative, general guidelines

---

## 2. Clinical Guidelines

Place guideline PDFs in the `guidelines/` directory. Subdirectories are supported and used for panel/category inference.

```
guidelines/
  Appropriateness Criteria/
    Breast/
      Breast Cancer Screening.pdf
    Neurologic/
      Headache.pdf
  Contrast Manual/
    Contrast Manual Chapter 1.pdf
  RADS/
    TI-RADS/
      TI-RADS Guidelines.pdf
```

### Running Ingestion

```bash
# Ingest guidelines
npm run ingest:guidelines

# Preview (dry run)
npx tsx scripts/ingest-guidelines.ts --dry-run

# Use a custom directory
npx tsx scripts/ingest-guidelines.ts --root ./my-guidelines

# Clean existing guidelines first
npx tsx scripts/ingest-guidelines.ts --clean
```

### Customization

The script auto-classifies documents based on directory structure. To adapt classification for your guidelines:
- Edit `classifyGuideline()` in `scripts/ingest-guidelines.ts`
- Modify `mapPanelToCategory()` to map your subdirectory names to categories
- Update `mapRadsToCategory()` for reporting system classifications

---

## 3. Departmental Documents

Place team/departmental documents in `teams_standard_docs/`. Supports PDF, DOCX, PPTX, TXT, and Markdown files.

```
teams_standard_docs/
  Abdominal CT Protocol Standards.pdf
  MRI Safety Training.pptx
  On-Call Procedures.docx
  Quick Reference Guide.md
```

### Running Ingestion

```bash
# Ingest departmental documents
npm run ingest:teams-abdominal

# Preview ingestion plan
npm run ingest:teams-abdominal:dry-run

# Clean and re-ingest
npm run ingest:teams-abdominal:clean

# Use a custom source directory
npx tsx scripts/ingest-teams-docs.ts --source-dir /path/to/docs
```

### Document Tiers

Documents can be tagged with tiers that affect retrieval scoring:
- **reference** -- Authoritative reference material (receives scoring bonus)
- **clinical** -- Clinical practice documents (neutral scoring)
- **educational** -- Teaching/training material (slight scoring penalty in clinical contexts)

---

## 4. IT Troubleshooting Knowledge

IT troubleshooting content is defined as a TypeScript data file rather than ingested from PDFs. This allows structured, searchable entries with severity levels and step-by-step resolution guides.

### Data File Location

```
scripts/it-troubleshooting/troubleshooting-data.ts   # If using the shared package approach
packages/shared/src/data/troubleshooting-data.ts      # Alternative location
```

### Adding Entries

Each troubleshooting entry follows this structure:

```typescript
{
  id: "system-issue-name",
  title: "Descriptive Title",
  system: "PACS",           // Clinical system identifier
  category: "DISPLAY",      // Failure category
  severity: "moderate",     // low | moderate | high | critical
  symptoms: ["Symptom 1", "Symptom 2"],
  quickFix: "Try this first",
  steps: [
    "Step 1: Do this",
    "Step 2: Then this",
  ],
  rootCause: "Why this happens",
  escalation: "Contact support if steps fail",
  tags: ["keyword1", "keyword2"],
}
```

### Running Ingestion

```bash
npm run ingest:troubleshooting
npm run ingest:troubleshooting:dry-run
npm run ingest:troubleshooting:clean
```

---

## 5. Writing Custom Scrapers

If you need to ingest content from web sources or APIs, you can write custom scraper scripts. Place them in the `scripts/` directory.

### Scraper Template

```typescript
// scripts/scrape-my-source.ts
import * as fs from "fs";
import * as path from "path";

interface ScrapedDocument {
  title: string;
  content: string;
  url: string;
  category: string;
}

async function scrape(): Promise<ScrapedDocument[]> {
  // 1. Fetch content from your source
  // 2. Parse and extract text
  // 3. Return structured documents
  return [];
}

async function main() {
  const docs = await scrape();

  // Save as JSONL for ingestion
  const outputPath = path.resolve("scraped-output/documents.jsonl");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const lines = docs.map(doc => JSON.stringify(doc));
  fs.writeFileSync(outputPath, lines.join("\n") + "\n");

  console.log(`Scraped ${docs.length} documents to ${outputPath}`);
}

main().catch(console.error);
```

### Important Considerations

- **Respect copyright and licensing** -- Only scrape content you have rights to use
- **Rate limiting** -- Add delays between requests to avoid overwhelming servers
- **Deduplication** -- Check for existing documents before inserting
- **Embeddings** -- Use `text-embedding-3-small` (1536 dimensions) for consistency with existing vectors
- **Database schema** -- All documents need `institution`, `domain`, and `category` fields

### Embedding Generation

All ingestion scripts use OpenAI's `text-embedding-3-small` model (1536 dimensions). Ensure your `OPENAI_API_KEY` environment variable is set before running any ingestion.

```bash
# Estimate embedding cost before ingesting
# ~$0.02 per 1M tokens, ~500 tokens per chunk
npx tsx scripts/your-ingestion-script.ts --dry-run
```

---

## Environment Setup

Before running any ingestion script, ensure these environment variables are set:

```bash
# Required for all ingestion
DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...
OPENAI_API_KEY=sk-...          # For embedding generation

# Optional
POLICIES_DIR=/custom/path      # Override default policy folder locations
```

See `.env.example` for the full list of environment variables.

---

## Chunking Configuration

All ingestion scripts use consistent chunking parameters:

| Parameter | Default | Description |
|-----------|---------|-------------|
| Chunk size | 512 words | Target chunk size for embedding |
| Chunk overlap | 100 words | Overlap between consecutive chunks |
| Embedding model | text-embedding-3-small | OpenAI embedding model |
| Embedding dimensions | 1536 | Vector dimensions |
| Max context tokens | 8000 | Maximum tokens sent to LLM |

These can be adjusted in individual ingestion scripts or in `packages/api/src/lib/rag-config.ts`.
