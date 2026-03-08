# Radiology AI Assistant

A comprehensive, open-source clinical decision support framework for radiology departments. Radiology AI Assistant provides RAG-powered protocol retrieval, emergency detection, multi-provider LLM chat, real-time messaging, and on-call schedule management -- all built with a strict no-PHI architecture.

---

## WARNING: Not For Clinical Use Without Validation

**This software is provided as a research and development framework. It is NOT approved for clinical use in its current form.** Before deploying Radiology AI Assistant in any clinical environment, you MUST:

- Conduct a thorough validation of all clinical decision support outputs against your institution's approved protocols.
- Obtain all necessary regulatory approvals (institutional review, IT security review, compliance review).
- Validate PHI detection and blocking mechanisms against your institution's HIPAA compliance requirements.
- Perform clinical workflow integration testing with domain experts.
- Establish ongoing monitoring and audit procedures.

**The authors and contributors assume no liability for clinical decisions made using this software. All AI-generated responses must be verified by qualified medical professionals before any clinical action is taken.**

---

## Features

### RAG-Powered Protocol Assistant
- Hybrid response format: AI-generated summary + verbatim protocol excerpts with inline citations
- Multi-provider LLM support (Anthropic Claude, OpenAI GPT, DeepSeek, Google Gemini, MiniMax, Moonshot Kimi, local models via LM Studio/Ollama)
- Provider-aware fallback chain for cloud models; explicit failure mode for local inference
- Domain-aware retrieval routing (PROTOCOL / KNOWLEDGE / HYBRID)
- Confidence scoring with configurable similarity thresholds
- Query domain classification with emergency safety overrides
- Provider health monitoring with persistent UI banner for misconfiguration detection

### Emergency Detection
- Real-time clinical urgency detection via keyword and vital sign pattern matching
- Severity classification: routine, urgent, emergency
- Severity escalators ("not responding to", "worsening", "despite treatment")
- Critical vital sign thresholds (O2 sat, blood pressure)
- Emergency-adapted response formatting with direct action commands

### Medical Abbreviation Safety
- Dictionary of 150+ medical abbreviations with meanings and risk levels
- Context-based disambiguation (e.g., "MS" resolved by surrounding clinical context)
- Interactive clarification flow for high-risk ambiguous abbreviations
- Query expansion with resolved abbreviations for improved retrieval

### PHI Compliance (No-PHI Architecture)
- Client-side real-time PHI detection with highlighted overlays
- Server-side enforcement with per-span override workflow
- Pattern detection for MRN, SSN, DOB, names, phone, email, addresses
- Audit logging via PHIDetectionLog (stores only hashed metadata, never raw PHI)
- Name detection powered by generated first/last-name database with medical eponym exclusions

### Document Ingestion Pipeline
- Multi-institution support with institution-level filtering at retrieval time
- Automatic document classification by folder structure and filename patterns
- Support for PDF, DOCX, PPTX, TXT, and Markdown ingestion
- Configurable chunking (512 tokens, 100 overlap) with multi-provider embeddings
- Document tier scoring (reference, clinical, educational) with category-aware boosts
- National guideline ingestion support

### Desktop Application
- Electron tray app for instant protocol access from clinical workstations
- Global hotkey activation (Ctrl+Shift+P / Cmd+Shift+P)
- OS keychain-encrypted authentication via safeStorage
- Emergency detection triggers native OS notifications
- Auto-update support via electron-updater

### Communication and Workflow
- Real-time messaging with typing indicators and read receipts
- Coordinator workflow routing with priority escalation (STAT / URGENT / ROUTINE)
- On-call schedule management by subspecialty
- Role-based access control (Admin, Coordinator, Attending, Fellow, Resident, Technician, Staff)
- Request lifecycle tracking with escalation chains

---

## Architecture

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14, React 18, Tailwind CSS, shadcn/ui |
| Mobile | Capacitor 6 |
| Desktop | Electron 29 (system tray app) |
| API | tRPC 11 (react-query integration) |
| Database | PostgreSQL + pgvector |
| Auth | Supabase Auth |
| Real-time | Supabase Realtime |
| AI/RAG | Multi-provider LLM (Anthropic / OpenAI / DeepSeek / Gemini / MiniMax / Kimi / Local) + multi-provider embeddings (OpenAI / Local via LM Studio/Ollama) with automatic provider detection and provider health check with auto-detection of local models |
| PDF Parsing | pdf-parse, mammoth, pptx-parser |
| State | Zustand (persisted stores) |
| Validation | Zod (shared schemas between client and server) |

See [CLAUDE.md](CLAUDE.md) for detailed architecture documentation, database schema, API reference, and development guidelines.

---

## Project Structure

```
rad-assist/
├── apps/
│   ├── web/                     # Next.js 14 frontend (static export -> Capacitor)
│   └── desktop/                 # Electron desktop tray app
├── packages/
│   ├── api/                     # tRPC router definitions + RAG library
│   │   └── src/lib/             # Core logic (LLM client, emergency detection,
│   │                            #   abbreviation handling, query routing, PHI audit)
│   ├── db/                      # Prisma schema + pgvector
│   └── shared/                  # Types, Zod schemas, constants, PHI filter
├── scripts/
│   ├── ingest-institution.ts    # Multi-institution PDF ingestion
│   ├── ingest-teams-docs.ts     # Team standards ingestion (PDF/DOCX/PPTX/TXT/MD)
│   ├── ingest-guidelines.ts     # National guideline ingestion
│   ├── ingest-directory.ts      # Department/service directory ingestion
│   ├── build-name-database.ts   # Generate first/last-name DB for PHI detection
│   ├── seed-protocols.ts        # Sample protocol seeding
│   └── archive/                 # Legacy script backups
├── docs/                        # Project documentation
├── validation/                  # Validation and test utilities
├── docker-compose.yml           # Local PostgreSQL + pgvector
└── package.json
```

---

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 15+ with pgvector extension (or Docker)
- npm or pnpm
- At least one LLM provider: local server (LM Studio/Ollama) or cloud API key (Anthropic, OpenAI, etc.)
- At least one embedding provider: local server (LOCAL_LLM_URL) or OpenAI API key

### 1. Clone and Install

```bash
git clone https://github.com/jmradmd/radiology-ai-assistant.git
cd radiology-ai-assistant
npm install
```

### 2. Configure Environment

Copy the example environment file and fill in your values:

```bash
cp .env.example .env.local
```

Required environment variables:

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/rad_assist
DIRECT_URL=postgresql://user:password@localhost:5432/rad_assist

# Local LLM (default path — handles both chat and embeddings)
# Point to LM Studio, Ollama, or any OpenAI-compatible local server.
LOCAL_LLM_URL=http://localhost:1234/v1

# Embedding config (optional — omit EMBEDDING_DIMENSIONS to use model's native size)
# EMBEDDING_PROVIDER=auto          # auto | openai | local
# EMBEDDING_MODEL=text-embedding-nomic-embed-text-v1.5   # must match your loaded model
# EMBEDDING_DIMENSIONS=

# Cloud LLM providers (optional — uncomment and add keys as needed)
# OPENAI_API_KEY=sk-...            # OpenAI (also used for cloud embeddings)
# ANTHROPIC_API_KEY=sk-ant-...     # Claude
# DEEPSEEK_API_KEY=...             # DeepSeek R1
# GEMINI_API_KEY=...               # Gemini
# MINIMAX_API_KEY=...              # MiniMax
# MOONSHOT_API_KEY=...             # Kimi

# Optional: Supabase Auth (not needed for local dev with Demo Login)
# NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
# NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
# SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

> **Local-only deployment (no cloud dependencies):** For a fully local setup with LM Studio, you need **two models loaded simultaneously** — a chat model (e.g. DeepSeek R1) **and** an embedding model (e.g. nomic-embed-text-v1.5). Set `EMBEDDING_MODEL` to match the embedding model name exactly as LM Studio reports it (e.g. `text-embedding-nomic-embed-text-v1.5`). Leave all cloud API keys commented out; the system auto-detects `LOCAL_LLM_URL` and routes both chat and embedding requests to your local server.

### 3. Set Up Database

Using Docker (recommended for local development):

```bash
docker-compose up -d
```

Or connect to an existing PostgreSQL instance with pgvector.

Then copy environment variables where each tool expects them and initialize the database:

```bash
cp .env.local .env              # Seed scripts read from project root
cp .env.local packages/db/.env  # Prisma CLI reads from packages/db/

npm run db:generate
npm run db:push
```

> Prisma CLI reads from `packages/db/.env`, seed scripts read from root `.env`, and Next.js reads from `apps/web/.env.local`. All three locations need the same database connection values.

### 4. Ingest Documents

Place your protocol PDFs in institution-specific folders, then run ingestion:

```bash
# Ingest documents from a specific institution folder
npx tsx scripts/ingest-institution.ts --institution INST_A --verbose

# Or ingest all configured institutions
npx tsx scripts/ingest-institution.ts --institution ALL

# Dry run to preview without writing
npx tsx scripts/ingest-institution.ts --institution ALL --dry-run
```

### 5. Seed Demo Data (Optional)

To populate the knowledge base with sample radiology protocols for testing:

```bash
npx tsx scripts/seed-demo.ts
```

This creates sample documents covering contrast reactions, MRI safety, renal function,
critical results, and CT protocols. Remove with `npx tsx scripts/seed-demo.ts --clean`.

### 6. Start Development Server

```bash
npm run dev
```

The application will be available at `http://localhost:3000`.

---

## Demo Data

Sample radiology protocol documents are included for demonstration purposes. These cover
contrast reaction management, MRI safety, renal function assessment, critical results
communication, and CT protocol selection.

### Seeding Demo Data

After database setup, seed the demo content:

```bash
npx tsx scripts/seed-demo.ts           # Create sample documents with embeddings
npx tsx scripts/seed-demo.ts --dry-run # Preview without writing to database
```

### Removing Demo Data

Demo documents are tagged with `{ demo: true }` in their metadata field and can be
cleanly removed:

```bash
npx tsx scripts/seed-demo.ts --clean   # Remove all demo documents and their chunks
```

### Replacing with Real Content

To use with your institution's protocols:

1. Remove demo data: `npx tsx scripts/seed-demo.ts --clean`
2. Place your PDF protocols in `institution-a-policies/` and/or `institution-b-policies/`
3. Configure institutions in `packages/shared/src/constants.ts`
4. Run ingestion: `npx tsx scripts/ingest-institution.ts --institution ALL`

See [docs/CONTENT-INGESTION.md](docs/CONTENT-INGESTION.md) for detailed ingestion documentation.

### Sample Data Location

| File | Purpose |
|------|---------|
| `scripts/seed-demo.ts` | Demo seeder script with all sample document content |
| `packages/shared/src/data/directory-data.ts` | Department contact directory (template with empty fields) |
| `scripts/it-troubleshooting/troubleshooting-data.ts` | IT troubleshooting entries (template with generic examples) |
| `config/institutions.example.json` | Institution configuration template |

---

## Common Commands

```bash
# Development
npm run dev              # Start Next.js dev server
npm run build            # Production build

# Database
npm run db:generate      # Generate Prisma client
npm run db:push          # Push schema to database
npm run db:studio        # Open Prisma Studio

# Document Ingestion
npx tsx scripts/ingest-institution.ts --institution ALL      # Ingest all institutions
npx tsx scripts/ingest-institution.ts --clean                # Clean re-ingest (destructive)
npx tsx scripts/ingest-institution.ts --dry-run              # Preview ingestion plan
npx tsx scripts/ingest-teams-docs.ts --verbose               # Ingest team standards
npx tsx scripts/build-name-database.ts                       # Regenerate name database for PHI

# Mobile (from apps/web)
npx cap add ios          # Add iOS platform
npx cap copy ios         # Copy web build to iOS
npx cap open ios         # Open in Xcode

# Desktop
npm run dev:desktop      # Start Electron dev mode
npm run build:desktop    # Build desktop app
npm run package:desktop  # Package for current platform
```

---

## Configuration

### Multi-Institution Support

Radiology AI Assistant supports multiple institution document sources with independent retrieval filtering. Configure institutions in `packages/shared/src/constants.ts`:

```typescript
INSTITUTION_CONFIG = {
  INST_A: {
    displayName: "Institution A",
    shortName: "A",
    sourceFolder: "Institution A Policies",
  },
  INST_B: {
    displayName: "Institution B",
    shortName: "B",
    sourceFolder: "Institution B Policies",
  },
}
```

### Document Categories

Documents are automatically classified into categories:

- CONTRAST -- Contrast media, reactions, gadolinium, premedication
- MRI_SAFETY -- MRI safety, implants, zones, screening
- CT_PROTOCOL -- CT, CTA, PET, cardiac imaging
- MAMMO -- Mammography, breast imaging
- ULTRASOUND -- Ultrasound protocols
- MEDICATION -- Sedation, premedication, drug administration
- NURSING -- IV access, extravasation, nursing procedures
- PEDIATRIC -- Pediatric-specific protocols
- PREGNANCY -- Pregnancy screening, imaging in pregnancy
- RENAL -- Renal function, eGFR, contrast nephropathy
- SAFETY -- Radiation safety, fire, infection control
- WORKFLOW -- Scheduling, patient flow
- CRITICAL -- Critical results, emergency protocols
- COMPLIANCE -- Regulatory, documentation
- GENERAL -- Administrative, general policies

### LLM Model Configuration

The default model is Claude Haiku. Cloud models use a fallback chain when the requested provider is unavailable. Local models (LM Studio, Ollama) fail explicitly without cloud fallback.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to contribute to this project.

---

## Security

See [SECURITY.md](SECURITY.md) for vulnerability reporting policy.
