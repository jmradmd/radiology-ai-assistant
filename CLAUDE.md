# Radiology AI Assistant Development Guidelines

> Radiology Clinical Decision Support Framework

---

## Project Identity

**Radiology AI Assistant** is a mobile-first clinical decision support app for radiology departments featuring:
- RAG-powered protocol + knowledge assistant (multi-provider chat + multi-provider embeddings, emergency detection)
- PDF document ingestion with automatic categorization
- Coordinator workflow routing with priority escalation
- Real-time messaging with typing indicators and read receipts
- On-call schedule management by subspecialty

**Critical constraint:** NO-PHI architecture. All user input is scanned; patient identifiers are blocked at input layer.

---

## Architecture Overview

```
rad-assist/
├── apps/
│   ├── web/                    # Next.js 14 (static export -> Capacitor)
│   └── desktop/                # Electron desktop tray app
├── packages/
│   ├── api/                    # tRPC router definitions + RAG lib
│   ├── db/                     # Prisma schema + pgvector
│   └── shared/                 # Types, schemas, constants, PHI filter
├── scripts/
│   ├── ingest-institution.ts   # Multi-institution PDF ingestion (RECOMMENDED)
│   ├── ingest-teams-docs.ts    # Team standards ingestion (PDF/DOCX/PPTX/TXT/MD)
│   ├── ingest-guidelines.ts    # National guideline ingestion
│   ├── ingest-directory.ts     # Department/service directory ingestion
│   ├── build-name-database.ts  # Generates shared first/last-name DB for PHI detection
│   ├── backfill-institution.ts # Migration script for existing documents
│   ├── ingest-folder.ts        # Legacy single-folder ingestion (still runnable)
│   ├── reingest.ts             # Legacy re-ingestion helper (still runnable)
│   ├── seed-protocols.ts       # Basic protocol seeding
│   ├── seed-demo.ts            # Demo data seeder with sample protocols
│   └── archive/                # Backup copies of legacy scripts (.bak files)
├── evaluation/
│   ├── datasets/               # Gold-standard test cases (103 cases)
│   ├── scripts/                # Evaluation runners (unit, pipeline, cross-model)
│   └── results/                # Timestamped JSON reports (gitignored)
├── institution-a-policies/     # First institution policy documents
├── institution-b-policies/     # Second institution policy documents
├── teams_standard_docs/        # Departmental team standards
└── config/                     # Project config, schema SQL, and branding assets
```

### Tech Stack

| Layer       | Technology                                         |
|-------------|---------------------------------------------------|
| Frontend    | Next.js 14, React 18, Tailwind CSS, shadcn/ui     |
| Mobile      | Capacitor 6                                        |
| Desktop     | Electron 29 (system tray app)                      |
| API         | tRPC 11 (react-query integration)                  |
| Database    | PostgreSQL + pgvector (Supabase)                   |
| Auth        | Supabase Auth                                      |
| Real-time   | Supabase Realtime                                  |
| AI/RAG      | Claude Haiku (default) / Claude Sonnet/Opus / GPT / DeepSeek / Gemini / MiniMax / Kimi / Local (LM Studio/Ollama) + multi-provider embeddings (OpenAI / Local via LM Studio/Ollama) with automatic provider detection |
| PDF Parsing | pdf-parse, mammoth, pptx-parser                    |
| Markdown    | react-markdown + remark-gfm                        |
| Icons       | lucide-react                                       |
| State       | Zustand (persisted auth store)                     |
| Validation  | Zod (shared schemas between client/server)         |
| Date Utils  | date-fns                                           |

---

## Multi-Institution Support

The system supports policies from multiple institutions:

| Institution    | ID               | Folder                    | Description                |
|---------------|------------------|---------------------------|----------------------------|
| Institution A | `INSTITUTION_A`  | `institution-a-policies/` | Hospital-wide policies     |
| Institution B | `INSTITUTION_B`  | `institution-b-policies/` | Department protocols       |
| Shared        | `SHARED`         | N/A                       | Cross-institutional        |

### Institution Configuration

```typescript
// packages/shared/src/constants.ts
INSTITUTION_CONFIG = {
  INSTITUTION_A: {
    displayName: "Primary Hospital",
    shortName: "HOSP_A",
    sourceFolder: "institution-a-policies",
    colors: { primary: "#1E40AF", background: "#DBEAFE" },
  },
  INSTITUTION_B: {
    displayName: "Department / Subspecialty",
    shortName: "DEPT",
    sourceFolder: "institution-b-policies",
    colors: { primary: "#B91C1C", background: "#FEE2E2" },
  },
}
```

### Institution Filtering in RAG

Users can filter protocol queries by institution:
- **All Sources**: Searches across all institutions (default)
- **Institution A**: Hospital-wide policies only
- **Institution B**: Department protocols only

The filter is applied at the vector search level via SQL:
```sql
AND d.institution = 'INSTITUTION_A'::"Institution"
```

---

## Monorepo Packages

### `@rad-assist/web` (apps/web)
Next.js frontend. Key directories:
- `src/app/` -- App Router pages with route groups: `(auth)`, `(dashboard)`
- `src/components/ui/` -- shadcn/ui primitives (Button, Card, Input, etc.)
- `src/components/dashboard/` -- App-specific components
- `src/components/chat/` -- RAG chat components (history, search, settings, institution toggle)
- `src/lib/trpc/client.ts` -- tRPC React client
- `src/lib/supabase/client.ts` -- Supabase browser client
- `src/lib/rag/search.ts` -- RAG utilities (embedding generation, RRF fusion, prompt building, chunking)
- `src/lib/routing/classifier.ts` -- Intent classification for request routing
- `src/stores/auth.ts` -- Zustand auth store with persistence
- `src/stores/preferences.ts` -- Zustand preferences store (output style, department, display options)
- `src/hooks/useRealtime.ts` -- Supabase realtime hooks

### `@rad-assist/api` (packages/api)
tRPC backend routers:
- `src/router.ts` -- Root router combining all sub-routers
- `src/routers/*.ts` -- Domain routers (user, conversation, request, schedule, rag)
- `src/routers/message.ts` -- Message router (list, send, unreadCount)
- `src/routers/system.ts` -- System router with `healthCheck` query (publicProcedure, no auth required)
- `src/trpc.ts` -- tRPC initialization with procedure hierarchy
- `src/context.ts` -- Request context with auth (prisma, user)
- `src/lib/rag-config.ts` -- RAG configuration (thresholds, emergency keywords)
- `src/lib/llm-client.ts` -- Unified multi-provider LLM client; cloud models use fallback chain, local requests use `LOCAL_LLM_URL` and fail explicitly on local-server errors
- `src/lib/embedding-client.ts` -- Unified embedding provider with automatic provider detection. Auto-detection hierarchy: real `OPENAI_API_KEY` -> OpenAI, else `LOCAL_LLM_URL` -> local, overridable via `EMBEDDING_PROVIDER` env var. Uses `isRealApiKey()` to reject placeholder keys (containing "...", "your-", "your\_", or < 20 chars). For nomic-embed-text models, `applyNomicPrefix()` prepends "search\_query: " (queries) or "search\_document: " (documents). Sets `encoding_format: 'float'` for LM Studio compatibility. Exports `EmbeddingTask` type (`'query'` | `'document'`) to control prefix behavior. Callers format vectors as `[${embedding.join(',')}]` string literals for pgvector raw SQL
- `src/lib/emergency-detection.ts` -- Clinical emergency/urgency detection
- `src/lib/abbreviation-detector.ts` -- Medical abbreviation detection and disambiguation
- `src/lib/medical-abbreviations.ts` -- Dictionary of 150+ medical abbreviations with meanings
- `src/lib/topic-detector.ts` -- Topic detection from user queries with category boost suggestions
- `src/lib/query-analyzer.ts` -- LLM-based query analysis for protocol questions
- `src/lib/query-domain-classifier.ts` -- Query route classification (`PROTOCOL`/`KNOWLEDGE`/`HYBRID`)
- `src/lib/query-routing-safety.ts` -- Emergency safety override for knowledge-only routes
- `src/lib/response-validator.ts` -- Post-generation response policy validation
- `src/lib/concise-format.ts` -- Concise-mode formatting normalization
- `src/lib/phi-audit.ts` -- Shared PHI audit logging helpers
- `src/lib/clarification-guard.ts` -- Clarification prompt gating and deduplication logic
- `src/lib/source-relevance.ts` -- Source relevance scoring and filtering utilities
- `src/lib/discrepancy-detection.ts` -- Institutional policy discrepancy detection (planned)
- `src/lib/provider-health.ts` -- Provider health checking and local model discovery. `discoverLocalModels()` queries GET /v1/models with 3s timeout and 60s cache, classifies models as chat vs embedding (by type field or name heuristic). `checkProviderHealth()` probes local server once, checks embedding and LLM provider config, returns status/provider/model/message for each. Top-level try/catch returns healthy on unexpected errors. Standalone `isRealApiKey()` duplicate.

### `@rad-assist/db` (packages/db)
Prisma ORM:
- `prisma/schema.prisma` -- Full schema with pgvector extension
- Exports Prisma client from `src/index.ts`

### `@rad-assist/shared` (packages/shared)
Shared utilities:
- `src/types.ts` -- TypeScript type definitions (mirrors Prisma enums)
- `src/schemas.ts` -- Zod validation schemas used by tRPC
- `src/constants.ts` -- App configuration, RAG settings, priority times
- `src/phi-filter.ts` -- PHI detection utilities
- `src/index.ts` -- Re-exports all

### `@rad-assist/desktop` (apps/desktop)
Electron desktop tray application for instant protocol access:
- `src/main/` -- Electron main process (Node.js)
  - `main.ts` -- App lifecycle, single instance lock, global hotkey
  - `tray.ts` -- System tray icon and context menu
  - `window.ts` -- 420x600 popup window positioning
  - `store.ts` -- electron-store + safeStorage for encrypted auth
  - `ipc.ts` -- IPC handlers (auth, preferences, notifications)
  - `preload.ts` -- Context bridge exposing Electron APIs
  - `updater.ts` -- Auto-update via electron-updater
- `src/renderer/` -- React frontend (Chromium)
  - `components/` -- Chat UI components (PopupChat, ChatMessage, etc.)
  - `stores/` -- Zustand stores (auth, chat, preferences)
  - `lib/trpc.ts` -- tRPC client pointing to production API
- `build/` -- macOS entitlements for code signing
- `scripts/notarize.js` -- Apple notarization script

**Key behaviors:**
- Global hotkey: `Ctrl+Shift+P` (Windows/Linux) / `Cmd+Shift+P` (macOS)
- Window hides on blur (click outside) or Escape key
- Auth tokens encrypted via OS keychain (safeStorage)
- Emergency detection triggers native notifications + amber tray icon

---

## PDF Ingestion Pipeline

### Running Ingestion

**Recommended (Multi-Institution):**
```bash
npm run ingest:institution-a  # Ingest Institution A Policies only
npm run ingest:institution-b  # Ingest Institution B Policies only
npm run ingest:all            # Ingest all institutions (incremental)
npm run ingest:all:clean      # Clean and re-ingest all (DANGEROUS)
```

**National Guidelines:**
```bash
npm run ingest:guidelines     # Ingest from ./Guidelines
```

**Departmental Team Standards (`teams_standard_docs`):**
```bash
npm run ingest:teams-abdominal          # Ingest departmental standards
npm run ingest:teams-abdominal:clean    # Rebuild all departmental standards (DANGEROUS)
npm run ingest:teams-abdominal:dry-run  # Preview ingestion plan
```

The multi-institution ingestion script (`ingest-institution.ts`):
1. Scans the appropriate folder based on institution
2. Classifies each document by folder + filename patterns
3. Sets the `institution` field on Document and DocumentChunk
4. Extracts text using `pdf-parse` with page-aware chunking
5. Chunks text (512 tokens, 100 overlap)
6. Generates embeddings via configured provider (OpenAI or local)
7. Stores in `Document` and `DocumentChunk` tables with institution metadata

**CLI Options:**
```bash
npx tsx scripts/ingest-institution.ts --institution INSTITUTION_A  # Ingest specific institution
npx tsx scripts/ingest-institution.ts --institution ALL            # Ingest all institutions
npx tsx scripts/ingest-institution.ts --clean                      # DELETE existing docs first (DANGEROUS)
npx tsx scripts/ingest-institution.ts --dry-run                    # Show what would be done without executing
npx tsx scripts/ingest-institution.ts --verbose                    # Detailed progress output
```

Team standard documents are parsed from:
- PDF (`pdf-parse`)
- DOCX (`mammoth`)
- PPTX (`pptx-parser`)
- TXT / Markdown (`fs` text read)

### Document Category Taxonomy

```typescript
type PrimaryCategory =
  | "CONTRAST"      // Contrast media, reactions, gadolinium, premedication
  | "MRI_SAFETY"    // MRI safety, implants, zones, screening
  | "CT_PROTOCOL"   // CT, CTA, PET, cardiac imaging
  | "MAMMO"         // Mammography, breast imaging, MQSA
  | "ULTRASOUND"    // Ultrasound protocols
  | "MEDICATION"    // Sedation, premedication, drug administration
  | "NURSING"       // IV access, extravasation, nursing procedures
  | "PEDIATRIC"     // Pediatric-specific protocols
  | "PREGNANCY"     // Pregnancy screening, imaging in pregnancy
  | "RENAL"         // Renal function, eGFR, contrast nephropathy
  | "SAFETY"        // Radiation safety, fire, infection control
  | "WORKFLOW"      // Scheduling, patient flow, add-ons
  | "CRITICAL"      // Critical results, emergency protocols
  | "COMPLIANCE"    // MQSA, regulatory, documentation
  | "GENERAL";      // Administrative, general policies
```

### Priority Levels

```typescript
type DocumentPriority = "CRITICAL" | "HIGH" | "STANDARD";
```

- **CRITICAL**: Contrast reactions, MRI safety, emergency protocols
- **HIGH**: Cardiac protocols, pediatric, medication administration
- **STANDARD**: Workflow, administrative, general guidelines

### Classification Rules

Documents are classified by:

1. **Folder name** -- Maps to primary category (e.g., "Contrast Policies" -> CONTRAST)
2. **Filename patterns** -- Regex rules refine category and add tags

Example keyword rules:
```typescript
// Contrast reaction -> CRITICAL priority
/contrast\s*reaction/i -> { category: "CONTRAST", priority: "CRITICAL" }

// Pacemaker/ICD -> MRI_SAFETY, CARDIAC subspecialty
/pacemaker|icd|defibrillator/i -> { category: "MRI_SAFETY", subspecialties: ["CARDIAC"] }

// eGFR/creatinine -> RENAL, CRITICAL
/egfr|creatinine|nephro/i -> { category: "RENAL", priority: "CRITICAL" }
```

### Adding New Documents

1. Place PDFs in appropriate subfolder under your institution's policy folder.
2. Run the ingestion script for that institution.
3. Script auto-classifies based on folder/filename patterns.
4. Review console output for category assignments.

To add custom classification rules, edit `KEYWORD_RULES` in `scripts/ingest-institution.ts`.

---

## Database Schema (Prisma)

### Core Models

| Model | Purpose |
|-------|---------|
| `User` | Staff members with roles, subspecialties, contact info |
| `Conversation` | DIRECT, GROUP, RAG_CHAT, or BROADCAST; stores `institutionFilter` and `categoryFilter` |
| `Message` | Text, RAG_RESPONSE, SYSTEM, FILE, or IMAGE; `metadata` JSON for RAG responses |
| `ConversationParticipant` | Junction table with `lastReadAt` for read receipts |
| `Schedule` | Shift definitions (date, type, times, location) |
| `ScheduleAssignment` | User assigned to schedule by subspecialty |
| `Request` | Coordinator workflow items with priority/status |
| `RequestEscalation` | Escalation chain tracking |
| `Notification` | PUSH, SMS, EMAIL with delivery status |
| `Document` | RAG source docs with institution/domain/authority/sourceCollection/documentTier metadata |
| `DocumentChunk` | Embedded chunks with `vector` + denormalized institution/domain/authority/tier fields |
| `AuditLog` | Compliance logging |
| `PHIDetectionLog` | PHI detection audit trail |

### Key Enums

```typescript
UserRole: ADMIN | COORDINATOR | ATTENDING | FELLOW | RESIDENT | TECHNICIAN | STAFF
Subspecialty: ABDOMINAL | NEURO | MSK | CHEST | IR | PEDS | BREAST | NUCLEAR | CARDIAC | EMERGENCY
Institution: INSTITUTION_A | INSTITUTION_B | SHARED
Domain: PROTOCOL | KNOWLEDGE
AuthorityLevel: INSTITUTIONAL | NATIONAL_GUIDELINE | SOCIETY_GUIDELINE
DocumentTier: reference | clinical | educational
ConversationType: DIRECT | GROUP | RAG_CHAT | BROADCAST
MessageType: TEXT | RAG_RESPONSE | SYSTEM | FILE | IMAGE
ShiftType: DAY | EVENING | NIGHT | WEEKEND_DAY | WEEKEND_NIGHT | CALL
CoverageType: ON_SITE | REMOTE | ON_CALL
Priority: STAT | URGENT | ROUTINE
RequestStatus: PENDING | ASSIGNED | ACKNOWLEDGED | IN_PROGRESS | RESOLVED | ESCALATED | CANCELLED
RequestType: PROTOCOL_QUESTION | SPEAK_TO_RADIOLOGIST | SCHEDULE_INQUIRY | URGENT_STAT | ADMINISTRATIVE
NotificationType: PUSH | SMS | EMAIL
NotificationStatus: PENDING | SENT | DELIVERED | READ | ACKNOWLEDGED | FAILED
AuditAction: CREATE | READ | UPDATE | DELETE | LOGIN | LOGOUT | EXPORT | SEARCH
```

### PHI Detection Logging

```prisma
model PHIDetectionLog {
  id             String   @id @default(uuid())
  userId         String?  // Nullable for anonymous/pre-auth
  inputHash      String   // SHA-256 hash - NEVER store actual PHI
  detectionType  String   // "MRN" | "SSN" | "DOB" | "NAME" | "PHONE" | "EMAIL" | "ADDRESS"
  patternMatched String?  // Which regex pattern triggered (for debugging)
  confidence     Float    @default(1.0)
  blocked        Boolean  @default(true)
  clientSide     Boolean  @default(false)
  ipAddress      String?
  userAgent      String?
  endpoint       String?
  createdAt      DateTime @default(now())
}
```

### pgvector Usage

```prisma
model DocumentChunk {
  embedding  Unsupported("vector")?
}
```

Vector similarity search via raw SQL:
```sql
SELECT *, 1 - (embedding <=> $1::vector) as similarity
FROM "DocumentChunk"
ORDER BY embedding <=> $1::vector
LIMIT 5;
```

---

## tRPC Procedure Hierarchy

```typescript
// packages/api/src/trpc.ts

publicProcedure      // No auth required
protectedProcedure   // Requires authenticated user
coordinatorProcedure // Requires ADMIN or COORDINATOR role
adminProcedure       // Requires ADMIN role only
```

### Middleware Chain

```typescript
const isAuthed = middleware(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { ...ctx, user: ctx.user } });
});

const isCoordinator = middleware(({ ctx, next }) => {
  if (!["ADMIN", "COORDINATOR"].includes(ctx.user.role)) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return next({ ctx });
});

const isAdmin = middleware(({ ctx, next }) => {
  if (ctx.user.role !== "ADMIN") {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return next({ ctx });
});
```

### Context Creation

```typescript
// packages/api/src/context.ts
export async function createContext(opts?: { req?: Request }): Promise<Context> {
  // 1. Extract Bearer token from Authorization header
  // 2. Handle demo-token for development
  // 3. Verify via Supabase auth.getUser()
  // 4. Auto-create user if exists in Supabase but not in DB
  return { prisma, user, req };
}
```

---

## RAG Implementation

### Model Configuration (`packages/shared/src/types.ts`)

```typescript
LLM_MODELS = [
  { id: "local", provider: "local", modelId: "local-model" },
  { id: "claude-opus", provider: "anthropic", modelId: "claude-opus-4-6" },
  { id: "claude-sonnet", provider: "anthropic", modelId: "claude-sonnet-4-6" },
  { id: "claude-haiku", provider: "anthropic", modelId: "claude-haiku-4-5", isDefault: true },
  { id: "gpt", provider: "openai", modelId: "gpt-latest" },
  { id: "deepseek-r1", provider: "deepseek", modelId: "deepseek-reasoner" },
  { id: "gemini", provider: "gemini", modelId: "gemini-flash-preview" },
  { id: "minimax", provider: "minimax", modelId: "MiniMax-latest" },
  { id: "kimi", provider: "moonshot", modelId: "kimi-latest" },
]

DEFAULT_MODEL_ID = "claude-haiku"
// Cloud fallback chain: requested model -> Sonnet -> GPT -> DeepSeek -> Gemini -> MiniMax -> Haiku -> Kimi -> Opus
// Local behavior: local requests use LOCAL_LLM_URL and throw on local-server failures (no silent cloud fallback).
```

### RAG Configuration (`packages/api/src/lib/rag-config.ts`)

```typescript
RAG_CONFIG = {
  // Embedding config is now managed by embedding-client.ts (packages/api/src/lib/embedding-client.ts).
  // EMBEDDING_MODEL defaults to 'text-embedding-3-small' for OpenAI; must be set explicitly for local.
  // EMBEDDING_DIMENSIONS defaults to undefined (model's native size).
  EMBEDDING_MODEL: 'text-embedding-3-small',
  EMBEDDING_DIMENSIONS: undefined,

  // Retrieval
  MIN_CONFIDENCE_THRESHOLD: 0.50,
  HIGH_CONFIDENCE_THRESHOLD: 0.70,
  MAX_SEARCH_RESULTS: 8,
  MAX_VERBATIM_SOURCES: 3,
  MIN_DISPLAY_SIMILARITY: 0.52,
  MIN_DISPLAY_SIMILARITY_KNOWLEDGE: 0.55,
  MAX_CONTEXT_TOKENS: 8000,

  // Emergency detection keywords and thresholds
  EMERGENCY_KEYWORDS: [...],
  SEVERITY_ESCALATORS: [...],
  CRITICAL_THRESHOLDS: {
    O2_SAT_LOW: 92,
    BP_SYSTOLIC_LOW: 90,
  },
  TEAMS_TIER_CONFIG: {
    SOURCE_COLLECTION: "teams_standard",
    TRIGGER_KEYWORDS: [...],
    REFERENCE_BONUS: 0.05,
    EDUCATIONAL_PENALTY: -0.03,
    CLINICAL_ADJUSTMENT: 0,
  },
}
```

### RAG Router Endpoints

```typescript
// packages/api/src/routers/rag.ts

rag.search         // Vector similarity search, returns ranked chunks
rag.chat           // Full RAG with hybrid response (summary + verbatim sources)
rag.listDocuments  // List all active documents with filters
rag.uploadDocument // Admin: upload and embed new document
```

```typescript
// packages/api/src/routers/system.ts

system.healthCheck     // Provider configuration validation (public, no auth). Returns llm/embedding status, provider, model, human-readable messages, and overall healthy boolean.
```

### Hybrid Response Architecture

The `rag.chat` endpoint returns both AI summary and verbatim protocol text:

```typescript
interface ChatResponse {
  summary: string;
  citationSources: Array<{
    title: string;
    domain: "protocol" | "knowledge";
    sourceLabel?: string;
    url: string | null;
  }>;
  verbatimSources: Array<{
    title: string;
    content: string;
    category: string;
    domain: "protocol" | "knowledge";
    sourceLabel?: string;
    similarity: number;
    url: string | null;
    institution?: Institution;
  }>;
  confidence: number;
  emergencyAssessment: EmergencyAssessment;
  conversationId: string;
  hasRelevantContent: boolean;
  modelInfo?: { requested: string; actual: string; provider: string; fallbackUsed: boolean };
  needsAbbreviationClarification?: boolean;
  abbreviationOptions?: string[];
  abbreviation?: string;
  needsTopicClarification?: boolean;
  suggestedTopics?: Array<{ id: string; label: string; category: string; confidence: number }>;
  retrievalDebug?: {
    effectiveQuery: string;
    queryRoute?: "PROTOCOL" | "KNOWLEDGE" | "HYBRID";
    expandedQuery?: string;
    abbreviationsDetected?: string[];
    abbreviationsExpanded?: Record<string, string>;
  };
}
```

### RAG Chat Flow

1. **PHI Validation + Override Gate** -- Block unresolved PHI spans; allow explicit per-span overrides
2. **Query Domain Routing** -- Classify request into `PROTOCOL` / `KNOWLEDGE` / `HYBRID`
3. **Emergency Safety Override** -- Upgrade `KNOWLEDGE` route to `HYBRID` for urgent/emergency severity
4. **Emergency Assessment** -- Detect clinical urgency via keywords/vitals patterns
5. **LLM Query Analysis** -- Detect topic, ambiguity, intervention risk, and clarification needs
6. **Conversation Context** -- Retrieve prior messages and expand referential follow-ups
7. **Abbreviation Expansion** -- Expand resolved abbreviations for better embedding recall
8. **Generate Embedding** -- Query -> configured embedding provider
9. **Vector Search** -- Domain-aware pgvector retrieval with category boost and tier scoring
10. **Confidence + Source Filtering** -- Apply similarity thresholds before source display
11. **Prompt Construction** -- Branch into knowledge-only, hybrid, emergency, routine, or low-confidence prompts
12. **LLM Generation** -- Selected model (or fallback) with context-aware system prompt
13. **Post-Generation Validation** -- Run response-policy validation; regenerate once if critical violations
14. **Return Hybrid Response** -- Summary + citation sources + verbatim sources + emergency/model metadata

### Citation Link Policy

- Inline citations use `[Source: "..."]` format and are rendered client-side as compact citation icons.
- Source links are restricted to internal policy files (`/api/policies/...`) when available.
- Outbound external source links are disabled in runtime chat UX.

### RAG System Prompt Behavior

The system prompt adapts based on emergency assessment:

**Emergency/Urgent Scenarios:**
- Starts with most critical immediate action
- Uses direct commands: "Administer...", "Call...", "Activate..."
- Includes specific doses EXACTLY as written (no paraphrasing)
- Structured as: IMMEDIATE ACTIONS -> MONITORING -> ESCALATION

**Routine Queries:**
- Provides clear summary of relevant protocol guidance
- References documents by exact title: [Source: Document Title]
- Quotes dosing exactly, never paraphrases
- Acknowledges if guidance is missing from sources

**Low Confidence:**
- Acknowledges uncertainty at start
- Recommends consulting radiologist on call
- Suggests verifying with original protocol documents

---

## Emergency Detection

### Location

```typescript
// packages/api/src/lib/emergency-detection.ts
```

### Emergency Assessment

```typescript
interface EmergencyAssessment {
  isEmergency: boolean;
  severity: 'routine' | 'urgent' | 'emergency';
  triggers: string[];
  escalators: string[];
  numericAlerts: string[];
}
```

### Detection Rules

1. **Emergency Keywords** -- Respiratory (desaturation, airway), Cardiovascular (hypotension, shock), Anaphylaxis
2. **Severity Escalators** -- "not responding to", "worsening", "despite treatment"
3. **Numeric Thresholds** -- O2 sat < 92%, BP systolic < 90 mmHg
4. **Escalation Logic**:
   - Single trigger -> `urgent`
   - Multiple triggers OR escalators OR critical vitals -> `emergency`
   - High-severity keywords (anaphylaxis, code, cardiac arrest) -> immediate `emergency`

---

## Medical Abbreviation Handling

### Location

```typescript
// packages/api/src/lib/abbreviation-detector.ts
// packages/api/src/lib/medical-abbreviations.ts
```

### Purpose

Medical abbreviations are ambiguous -- "MS" could mean multiple sclerosis, mitral stenosis, or morphine sulfate. Misinterpretation in clinical settings can cause patient harm. The abbreviation system:

1. **Detects** abbreviations in user queries
2. **Identifies** high-risk ambiguous abbreviations
3. **Requests clarification** when meaning is uncertain
4. **Expands** abbreviations for better retrieval

### Abbreviation Dictionary

150+ medical abbreviations with metadata:

```typescript
interface AbbreviationEntry {
  meanings: string[];
  category?: string;
  dangerous?: boolean;
}

// Examples
'MS': { meanings: ['multiple sclerosis', 'mitral stenosis', 'morphine sulfate'], dangerous: true }
'EGFR': { meanings: ['estimated glomerular filtration rate', 'epidermal growth factor receptor'], dangerous: true }
'PE': { meanings: ['pulmonary embolism', 'physical examination', 'pleural effusion'], dangerous: true }
```

### Context-Based Resolution

The system attempts to resolve ambiguous abbreviations from context clues:

```typescript
// "MS" with "neuro" or "brain" context -> multiple sclerosis
// "MS" with "cardiac" or "valve" context -> mitral stenosis
// "EGFR" with "renal" or "contrast" context -> glomerular filtration rate
// "EGFR" with "cancer" or "oncology" context -> epidermal growth factor receptor
```

### Clarification Flow

When high-risk abbreviations cannot be resolved:

1. RAG chat detects ambiguous abbreviation
2. Returns `needsAbbreviationClarification: true` with options
3. UI displays clarification prompt to user
4. User selects intended meaning
5. Follow-up query processed with resolved context

---

## Topic Detection

### Location

```typescript
// packages/api/src/lib/topic-detector.ts
```

### Purpose

Topic detection analyzes user queries to identify protocol topics and suggest category boosts for better retrieval:

1. **Detects** topics from keywords and patterns in queries
2. **Suggests** category boosts for vector search
3. **Handles** special cases (e.g., Symptom + Contrast = Contrast Reaction)

### Topic Definitions

```typescript
interface TopicDefinition {
  name: string;
  keywords: string[];
  patterns: RegExp[];
  boostCategory: PrimaryCategory;
}
```

---

## tRPC Router Endpoints

### Conversation Router

```typescript
conversation.list              // List user's conversations with optional type filter
conversation.listRagChats      // List RAG chat history with search
conversation.getRagChatMessages // Get messages for a specific RAG conversation
conversation.delete            // Delete a conversation
conversation.getById           // Get single conversation with participants
conversation.create            // Create new conversation
conversation.getOrCreateDirect // Get or create direct conversation with user
conversation.markRead          // Mark conversation as read
conversation.createRagChat     // Create new RAG chat conversation
```

### User Router

```typescript
user.syncFromAuth     // Sync user from Supabase auth (called after login)
user.me               // Get current authenticated user
user.getById          // Get user by ID
user.list             // List all active users with filters
user.listProviders    // List providers by subspecialty
user.updateProfile    // Update current user's profile
user.updateUser       // Admin: update user role/status
user.create           // Admin: create user
```

### Schedule Router

```typescript
schedule.getCurrentOnCall   // Get on-call providers for current time
schedule.getSchedule        // Get schedule for a date range
schedule.create             // Create schedule (coordinator only)
schedule.addAssignment      // Add assignment to schedule (coordinator only)
schedule.removeAssignment   // Remove assignment (coordinator only)
schedule.bulkImport         // Bulk import schedules (coordinator only)
schedule.todaySummary       // Get today's schedule by subspecialty
```

### Message Router

```typescript
message.list         // Get messages for a conversation
message.send         // Send message with per-span PHI override support
message.unreadCount  // Get unread count for user
```

### Request Router

```typescript
request.create        // Create request with PHI override support
request.list          // List requests (role-based filtering)
request.getById       // Get request details with escalations
request.updateStatus  // Update status (coordinator or assignee)
request.assign        // Assign to provider (coordinator only)
request.counts        // Dashboard counts by status/priority
```

### PDF Serving API

```typescript
// apps/web/src/app/api/policies/[filename]/route.ts

GET /api/policies/{filename}  // Serves internal document files
                              // Recursive search, case-insensitive
                              // Security: blocks directory traversal
                              // Supports .pdf/.docx/.pptx/.txt/.md
                              // Returns file stream with 24hr cache
```

---

## Chat UI Features

### Category Chips

The chat page includes category chips for filtering protocol queries:

```typescript
const categoryChips = [
  { id: "all", label: "All Topics", category: undefined, icon: Search },
  { id: "contrast", label: "Contrast", category: "CONTRAST", icon: Syringe },
  { id: "mri-safety", label: "MRI Safety", category: "MRI_SAFETY", icon: Magnet },
  { id: "ct-protocol", label: "CT Protocol", category: "CT_PROTOCOL", icon: ScanLine },
  { id: "renal", label: "Renal/eGFR", category: "RENAL", icon: Droplets },
  { id: "mammo", label: "Mammography", category: "MAMMO", icon: Heart },
  { id: "peds", label: "Pediatric", category: "PEDIATRIC", icon: Baby },
  { id: "safety", label: "General Safety", category: "SAFETY", icon: ShieldAlert },
  { id: "nursing", label: "Nursing/IV", category: "NURSING", icon: Pill },
];
```

Selected category gets 20% boost in vector search relevance scoring.

### Chat Components (`apps/web/src/components/chat/`)

| Component | File | Purpose |
|-----------|------|---------|
| `ChatInput` | `chat-input.tsx` | Chat input with PHI detection, send button |
| `LoadingIndicator` | `loading-indicator.tsx` | Animated loading indicator |
| `DiscrepancyAlert` | `discrepancy-alert.tsx` | Alert for institutional policy conflicts |
| `EmptyState` | `empty-state.tsx` | Empty state with example queries |
| `HistorySidebar` | `history-sidebar.tsx` | Sidebar for browsing past RAG conversations |
| `InstitutionToggle` | `institution-toggle.tsx` | Segmented control for filtering by institution |
| `ModelSelector` | `model-selector.tsx` | LLM model selector dropdown |
| `SearchModal` | `search-modal.tsx` | Modal overlay for searching conversation history |
| `SettingsPanel` | `settings-panel.tsx` | Slide-out panel for user preferences |
| `SideBySideResponse` | `side-by-side-response.tsx` | Side-by-side AI summary + verbatim sources |
| `ConfigBanner` | `config-banner.tsx` | Persistent provider health banner. Polls system.healthCheck every 30s, hidden when healthy, red for critical errors (no provider, server unreachable), amber for warnings (fallback). No dismiss button, auto-clears when healthy. |

### Dashboard Pages

| Route | Page | Purpose |
|-------|------|---------|
| `/chat` | `(dashboard)/chat/page.tsx` | RAG protocol assistant |
| `/dashboard` | `(dashboard)/dashboard/page.tsx` | Main dashboard (stats, on-call, recent requests) |
| `/profile` | `(dashboard)/profile/page.tsx` | User profile and settings |
| `/queue` | `(dashboard)/queue/page.tsx` | Request queue list |
| `/queue/new` | `(dashboard)/queue/new/page.tsx` | Create new request form |
| `/schedule` | `(dashboard)/schedule/page.tsx` | On-call schedule viewer |

---

## Intent Classification & Routing

### Location

```typescript
// apps/web/src/lib/routing/classifier.ts
```

### Classification Flow

```typescript
function classifyIntent(message: string): IntentResult {
  // 1. Rule-based STAT detection (confidence: 1.0)
  // 2. Rule-based URGENT detection (confidence: 0.9)
  // 3. Pattern-based classification (confidence: 0.75)
  // 4. Fallback: ADMINISTRATIVE (confidence: 0.5)
}
```

### Priority Determination

```typescript
function determinePriority(intent: IntentResult): "STAT" | "URGENT" | "ROUTINE" {
  if (intent.intent === "URGENT_STAT" || intent.confidence === 1.0) return "STAT";
  if (intent.intent === "SPEAK_TO_RADIOLOGIST" && intent.confidence >= 0.8) return "URGENT";
  return "ROUTINE";
}
```

### Subspecialty Extraction

Patterns detect subspecialty from message:
```typescript
ABDOMINAL: /abdomen|liver|kidney|GI|bowel/i
NEURO: /brain|neuro|head|spine|stroke/i
MSK: /musculoskeletal|MSK|bone|joint/i
CHEST: /chest|lung|thoracic|pulmonary/i
IR: /interventional|IR |biopsy|drain/i
```

---

## Request Workflow

### Request Lifecycle

```
PENDING -> ASSIGNED -> ACKNOWLEDGED -> IN_PROGRESS -> RESOLVED
                                    \-> ESCALATED
                                    \-> CANCELLED
```

### Role-Based Access

| Role | Capabilities |
|------|-------------|
| ADMIN | Full access, can assign, view all |
| COORDINATOR | Can assign, view all requests |
| ATTENDING/FELLOW | View own + assigned requests |
| RESIDENT/TECH/STAFF | View own requests only |

---

## Code Patterns

### tRPC Router Pattern

```typescript
// packages/api/src/routers/example.ts
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, coordinatorProcedure } from "../trpc";
import { validateNoPHI, PHIDetectedError } from "@rad-assist/shared";

export const exampleRouter = router({
  list: protectedProcedure
    .input(z.object({ limit: z.number().default(20) }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.example.findMany({ take: input.limit });
    }),

  assign: coordinatorProcedure
    .input(z.object({ id: z.string().uuid(), userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.example.update({
        where: { id: input.id },
        data: { assignedToId: input.userId },
      });
    }),
});
```

### PHI Validation Pattern

```typescript
import { detectPotentialPHI, getUnresolvedBlockingSpans } from "@rad-assist/shared";
import { logPHIDetectionEvent } from "../lib/phi-audit";

// In mutations that accept user text:
const phiResult = detectPotentialPHI(input.content);
const unresolved = getUnresolvedBlockingSpans(phiResult, input.phiOverrides);

if (phiResult.hasPHI) {
  await logPHIDetectionEvent({
    prisma: ctx.prisma,
    userId: ctx.user?.id || null,
    endpoint: "message.send",
    phiResult,
    overrides: input.phiOverrides,
  });
}

if (unresolved.length > 0) {
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: "Protected health information detected. Override each highlighted span to proceed.",
  });
}
```

### Frontend Component Pattern

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc/client";
import { detectPotentialPHI } from "@rad-assist/shared";
import { cn } from "@/lib/utils";

export function MyComponent() {
  const [input, setInput] = useState("");
  const [phiWarning, setPhiWarning] = useState<string | null>(null);

  const { data, isLoading } = trpc.example.list.useQuery({ limit: 10 });

  const mutation = trpc.example.create.useMutation({
    onSuccess: () => { /* invalidate queries */ },
    onError: (error) => { /* show toast */ },
  });

  const handleInputChange = (value: string) => {
    setInput(value);
    const result = detectPotentialPHI(value);
    setPhiWarning(result.hasPotentialPHI ? result.warnings[0]?.message : null);
  };

  return (
    <div className={cn("flex flex-col gap-4", isLoading && "opacity-50")}>
      {phiWarning && (
        <div className="text-amber-600 text-sm">{phiWarning}</div>
      )}
      {/* ... */}
    </div>
  );
}
```

### Zustand Store Pattern

```typescript
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isHydrated: boolean;
  rememberMe: boolean;
  setUser: (user: User | null, token?: string | null) => void;
  logout: () => void;
  setHydrated: (hydrated: boolean) => void;
  setRememberMe: (remember: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      isAuthenticated: false,
      isHydrated: false,
      rememberMe: true,
      setUser: (user, token = null) => set({
        user,
        accessToken: token,
        isAuthenticated: !!user,
      }),
      logout: () => set({ user: null, accessToken: null, isAuthenticated: false }),
      setHydrated: (hydrated) => set({ isHydrated: hydrated }),
      setRememberMe: (remember) => set({ rememberMe: remember }),
    }),
    {
      name: "rad-assist-auth",
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        isAuthenticated: state.isAuthenticated,
        rememberMe: state.rememberMe,
      }),
    }
  )
);
```

### Preferences Store

```typescript
// apps/web/src/stores/preferences.ts
export type OutputStyle = "concise" | "detailed" | "auto";
export type Department = "ABDOMINAL" | "NEURO" | "MSK" | "CHEST" | "IR" | "PEDS" | "BREAST" | "NUCLEAR" | "CARDIAC" | "EMERGENCY" | "GENERAL";

interface PreferencesState {
  outputStyle: OutputStyle;
  showConfidenceScores: boolean;
  autoExpandSources: boolean;
  department: Department | null;
  selectedModelId: string;
  setOutputStyle: (style: OutputStyle) => void;
  setDepartment: (dept: Department | null) => void;
  setSelectedModelId: (id: string) => void;
  resetPreferences: () => void;
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({ /* ... */ }),
    { name: "rad-assist-preferences", storage: createJSONStorage(() => localStorage) }
  )
);
```

---

## UI Components (shadcn/ui)

Components live in `apps/web/src/components/ui/`. Use existing primitives:

| Component | Import |
|-----------|--------|
| Avatar, AvatarFallback | `@/components/ui/avatar` |
| Badge | `@/components/ui/badge` |
| Button | `@/components/ui/button` |
| Card, CardContent, CardHeader, CardTitle | `@/components/ui/card` |
| Checkbox | `@/components/ui/checkbox` |
| Input | `@/components/ui/input` |
| Markdown | `@/components/ui/markdown` |
| PhiHighlightedInput/Textarea | `@/components/ui/phi-highlight-field` |
| ScrollArea | `@/components/ui/scroll-area` |
| Select, SelectTrigger, SelectContent, SelectItem | `@/components/ui/select` |
| Separator | `@/components/ui/separator` |
| Tabs, TabsList, TabsTrigger, TabsContent | `@/components/ui/tabs` |
| Textarea | `@/components/ui/textarea` |
| ThemeToggle | `@/components/ui/theme-toggle` |
| Toast, Toaster | `@/components/ui/toast`, `@/components/ui/toaster` |

### Button Variants

Custom priority variants:
```tsx
<Button variant="stat">STAT</Button>      // Red
<Button variant="urgent">Urgent</Button>  // Amber
<Button variant="routine">Routine</Button> // Green
```

### Tailwind Custom Colors

```typescript
rad-assist: { 50-950 }    // Primary brand color
stat: "#dc2626"       // Red for STAT priority
urgent: "#f59e0b"     // Amber for urgent
routine: "#22c55e"    // Green for routine
emergency: { 50-700 } // Amber scale for clinical urgency (distinct from system errors)
success: { 50-700 }   // Green scale for positive states
error: { 50-700 }     // Red scale for system errors only
```

Note: Clinical urgency uses amber (`emergency-*`) to differentiate from system errors (red).

---

## PHI Compliance

### What's Blocked

The `detectPotentialPHI()` function in `@rad-assist/shared` scans for:

| Pattern | Examples |
|---------|----------|
| MRN | 7-10 digit numbers, "MRN: 12345678" |
| SSN | XXX-XX-XXXX patterns |
| DATE | "DOB: 01/15/1980", date patterns with clinical context |
| Patient Names | Name pairs/honorifics with context, powered by generated first/last-name DB + eponym exclusions |
| Contact IDs | PHONE, EMAIL, URL, IP_ADDRESS, ACCOUNT/PLAN identifiers |

### Implementation Points

1. **Client-side highlighting**: Use `PhiHighlightedInput` and `PhiHighlightedTextarea` for real-time red/amber overlays
2. **Per-span override workflow**: Require explicit acknowledged overrides for each blocked span before send
3. **Server-side enforcement + logging**: Recompute PHI, verify unresolved spans, and log via `PHIDetectionLog`
4. **Never store raw PHI**: Only hashed/audit metadata is persisted for detections

### Safe Content

- Employee names (Dr. Smith, Nurse Jones)
- Protocol questions (generic procedures)
- Schedule information
- Room/location without patient context

---

## Priority & Routing

### Response Times

```typescript
PRIORITY_RESPONSE_TIMES = { STAT: 2, URGENT: 5, ROUTINE: 30 } // minutes
ESCALATION_TIMES = { STAT: 2, URGENT: 5, ROUTINE: 30 }
```

### Notification Channels

```typescript
NOTIFICATION_CHANNELS = {
  STAT: ["PUSH", "SMS", "CALL"],
  URGENT: ["PUSH", "SMS"],
  ROUTINE: ["PUSH"],
}
```

---

## Import Aliases

```typescript
// apps/web/tsconfig.json
"@/*" -> "src/*"
"@rad-assist/api" -> "packages/api"
"@rad-assist/db" -> "packages/db"
"@rad-assist/shared" -> "packages/shared"
```

Usage:
```typescript
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";
import { validateNoPHI, RAG_CONFIG } from "@rad-assist/shared";
import type { AppRouter } from "@rad-assist/api";
```

---

## Common Commands

```bash
# Development
npm run dev           # Start Next.js dev server
npm run build         # Production build

# Database
npm run db:generate   # Generate Prisma client
npm run db:push       # Push schema to database
npm run db:studio     # Open Prisma Studio

# Document Ingestion
npx tsx scripts/ingest-institution.ts --institution ALL            # Ingest all institutions
npx tsx scripts/ingest-institution.ts --institution INSTITUTION_A  # Ingest specific institution
npx tsx scripts/ingest-institution.ts --clean                      # Clean re-ingest (DANGEROUS)
npx tsx scripts/ingest-institution.ts --dry-run                    # Preview plan
npx tsx scripts/ingest-teams-docs.ts --verbose                     # Ingest team standards
npx tsx scripts/build-name-database.ts                             # Regenerate name database for PHI

# Mobile (from apps/web)
npx cap add ios       # Add iOS platform
npx cap copy ios      # Copy web build to iOS
npx cap open ios      # Open in Xcode

# Desktop
npm run dev:desktop           # Start Electron dev mode
npm run build:desktop         # Build desktop app
npm run package:desktop       # Package for current platform
```

---

## Environment Variables

```env
# Required
DATABASE_URL=
DIRECT_URL=

# Embeddings (at least one of OPENAI_API_KEY or LOCAL_LLM_URL required)
# All API keys are commented out by default in .env.example.
OPENAI_API_KEY=              # Default embedding provider when a real key is set
EMBEDDING_PROVIDER=          # auto | openai | local (default: auto)
EMBEDDING_MODEL=             # Model name (default: text-embedding-3-small for OpenAI; must be set explicitly for local)
EMBEDDING_DIMENSIONS=        # Optional, omit to use model's native dimensions

# LLM Providers (at least one required for chat; default model is Claude Haiku)
ANTHROPIC_API_KEY=           # Claude family
DEEPSEEK_API_KEY=            # DeepSeek R1
GEMINI_API_KEY=              # Gemini
MINIMAX_API_KEY=             # MiniMax
MOONSHOT_API_KEY=            # Kimi
LOCAL_LLM_URL=               # Local OpenAI-compatible endpoint for chat + embeddings (default: http://localhost:1234/v1)

# Optional
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
POLICIES_DIR=                # Custom path to policy folders
TEAMS_STANDARD_DOCS_DIR=     # Override for teams document source directory
```

---

## Adding a New Feature

### 1. Schema (if needed)
```prisma
// packages/db/prisma/schema.prisma
model NewThing {
  id        String   @id @default(uuid())
  name      String
  createdAt DateTime @default(now())
}
```
Run: `npm run db:generate && npm run db:push`

### 2. Zod Schema
```typescript
// packages/shared/src/schemas.ts
export const createNewThingSchema = z.object({
  name: z.string().min(1).max(100),
});
```

### 3. tRPC Router
```typescript
// packages/api/src/routers/new-thing.ts
export const newThingRouter = router({
  create: protectedProcedure
    .input(createNewThingSchema)
    .mutation(async ({ ctx, input }) => {
      validateNoPHI(input.name);
      return ctx.prisma.newThing.create({ data: input });
    }),
});
```

### 4. Frontend Page
```tsx
// apps/web/src/app/(dashboard)/new-thing/page.tsx
"use client";
import { trpc } from "@/lib/trpc/client";
```

---

## Local Development Startup

When starting the development environment, follow this sequence:

### 1. Database Setup

Choose one mode:

**Docker Postgres:**
```bash
docker start rad-assist-postgres
# Verify the mapped port:
docker port rad-assist-postgres 5432/tcp
```

**Hosted Postgres:**
Set `DATABASE_URL` and `DIRECT_URL` to your hosted PostgreSQL URI.

### 2. Environment Validation

Before startup, verify these exist and are non-empty:
- `DATABASE_URL`
- `DIRECT_URL`
- At least one LLM/embedding provider (`OPENAI_API_KEY` or `LOCAL_LLM_URL`)

### 3. Start and Verify

```bash
npm run dev
# Confirm http://localhost:3000 responds
# Confirm no Prisma auth errors in logs
```

### 4. Failure Policy

- If Prisma shows `Authentication failed against database server`, stop and resolve DB target/credentials before further debugging.
- Do not continue with UI debugging while DB auth is failing.

---

## Testing Checklist

When modifying features, verify:

- [ ] PHI detection blocks core identifiers (MRN/SSN/DATE/NAME) with span-level highlights
- [ ] PHI detection logs to `PHIDetectionLog` table when blocked
- [ ] Per-span PHI override UX works and unresolved spans still block submit
- [ ] tRPC mutations validate input with Zod schemas
- [ ] Protected procedures check user authorization
- [ ] Coordinator procedures verify role
- [ ] Real-time subscriptions update correctly
- [ ] Mobile layout works (test at 375px width)
- [ ] Priority colors display correctly (STAT=red, URGENT=amber, ROUTINE=green)
- [ ] RAG citations include source documents
- [ ] RAG emergency detection triggers on clinical urgency keywords
- [ ] Verbatim sources display alongside AI summary
- [ ] Institution filter correctly limits results
- [ ] Abbreviation clarification prompts for high-risk ambiguous terms
- [ ] LLM model selector switches between providers
- [ ] Local model requests fail explicitly when unavailable (no silent cloud fallback)
- [ ] Query domain routing behaves as expected (PROTOCOL/KNOWLEDGE/HYBRID)
- [ ] User preferences persist across sessions (localStorage)
- [ ] Auth hydration check prevents flash of unauthenticated content

---

## Automated Evaluation Framework

### Running Evaluations

```bash
npm test             # Tier 1: Unit tests — pure TypeScript, no setup (~5s)
npm run eval         # Tier 2: Pipeline eval against gold-standard dataset (offline, no DB)
npm run eval:full    # Tier 2: Full pipeline eval with retrieval (requires seeded DB)
```

Tier 3 cross-model comparison requires a running server + multiple API keys:
```bash
npx tsx evaluation/scripts/eval-cross-model.ts --models claude-haiku,gpt-4o
```

### Unit Test Files

| File | Tests |
|------|-------|
| `packages/api/src/lib/emergency-detection.test.ts` | Emergency severity classification and trigger identification |
| `packages/shared/src/phi-filter.test.ts` | PHI detection sensitivity and specificity |
| `packages/api/src/lib/query-routing-safety.test.ts` | Emergency safety override for query routing |
| `packages/api/src/lib/source-relevance.test.ts` | Source relevance scoring and filtering |
| `packages/api/src/lib/concise-format.test.ts` | Concise-mode formatting normalization |
| `packages/api/src/lib/clarification-guard.test.ts` | Clarification prompt gating and deduplication |
| `apps/web/src/lib/chat/clarification-parser.test.ts` | Clarification response parsing |
| `apps/web/src/lib/routing/classifier.test.ts` | Intent classification rules |

Tests use `node:test` and `node:assert/strict`. The Tier 1 runner auto-discovers all `.test.ts` files.

### Gold-Standard Dataset

`evaluation/datasets/gold-standard.json` contains 103 cases across 6 categories:

| Category | Cases | What it validates |
|----------|------:|-------------------|
| `emergency_detection` | 20 | Severity classification, trigger/escalator identification |
| `phi_detection` | 20 | Sensitivity (catches real PHI) and specificity (allows eponyms, clinical terms) |
| `abbreviation` | 20 | Context-dependent disambiguation of ambiguous medical abbreviations |
| `routing` | 16 | PROTOCOL / KNOWLEDGE / HYBRID query classification |
| `response_validation` | 15 | Safety rules (no first-person advice, no unqualified invasive recommendations) |
| `retrieval` | 12 | Correct protocol document retrieved for a given query |

### Adding New Tests

**New gold-standard case:** Add an entry to the `cases` array in `gold-standard.json` with a unique `id` (convention: category prefix + number, e.g. `emrg-009`), a `category`, a `query`, and an `expected` object.

**New unit test:** Create a `.test.ts` file next to the module using `node:test` and `node:assert/strict`. The Tier 1 runner discovers it automatically.

See [evaluation/EVALUATION.md](evaluation/EVALUATION.md) for full documentation including dataset extension, institutional data, and CI integration.

---

## Code Style Rules

1. **Explicit over clever** -- No magic, prefer readable code
2. **Comments explain "why", not "what"** -- Code should be self-documenting
3. **Validate at boundaries** -- Use Zod schemas at API layer
4. **Fail fast on PHI** -- Block before processing, not after
5. **Type everything** -- Leverage TypeScript + Prisma generated types
6. **Use existing components** -- Don't recreate shadcn primitives
7. **Mobile-first CSS** -- Default styles for mobile, use `md:` breakpoints for desktop
8. **Raw SQL for vectors** -- Prisma doesn't support pgvector natively, use `$queryRaw`

---

## UI Consistency Rules

1. **Chat submit button styling is locked** -- The enabled send button must remain `bg-slate-800 dark:bg-slate-700` with `text-rad-assist-400`. Do not change to bright fills.

2. **Chat text alignment must use shared metrics** -- Textarea text, PHI overlay text, and animated placeholder must share the same padding, font-size, line-height, and font-family. Current baseline: `text-[15px]`, `leading-[24px]`, `font-sans`.

3. **No destructive git restore without explicit user consent** -- Never run `git checkout --` or equivalent restore commands on user-modified files unless explicitly asked.

---

## File Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| React components | PascalCase | `ChatMessage.tsx` |
| Pages (App Router) | lowercase `page.tsx` | `app/(dashboard)/chat/page.tsx` |
| Layouts | `layout.tsx` | `app/(dashboard)/layout.tsx` |
| API routes | `route.ts` | `app/api/auth/callback/route.ts` |
| tRPC routers | kebab-case | `routers/message.ts` |
| API lib modules | kebab-case | `lib/rag-config.ts` |
| Scripts | kebab-case | `scripts/ingest-folder.ts` |
| Utilities | kebab-case | `lib/utils.ts` |
| Stores | kebab-case | `stores/auth.ts` |
| Hooks | camelCase | `hooks/useRealtime.ts` |
| Zod schemas | camelCase export | `sendMessageSchema` |

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Cannot find module @rad-assist/shared" | Run `npm install` from root |
| Prisma client out of sync | Run `npm run db:generate` |
| tRPC types not updating | Restart TypeScript server |
| Vector search returning nothing | Ensure embeddings populated via ingestion scripts |
| RAG confidence always low | Check `MIN_CONFIDENCE_THRESHOLD` in `packages/api/src/lib/rag-config.ts` |
| PDF extraction failing | Install system dependencies for `pdf-parse` |
| DeepSeek responses include raw `<think>` tags | Confirm `rag.ts` strips `<think>...</think>` before formatting |
| Local model selection fails | Verify `LOCAL_LLM_URL` points to a running local endpoint |
| Chat history disappears on login | `DATABASE_URL` points to wrong DB; fix connection string |
| Prisma auth failure at localhost | Port collision; verify correct port mapping |
| Emergency detection not triggering | Review `EMERGENCY_KEYWORDS` in rag-config.ts |
| Abbreviation not being detected | Check dictionary in medical-abbreviations.ts |
| PHI detection too aggressive | Review patterns and confidence levels in `phi-filter.ts` |
| Preferences not persisting | Check localStorage for `rad-assist-preferences` key |
| "clientModules" error / static 404s | Corrupted `.next` cache: `rm -rf apps/web/.next && npm run dev` |

### Dev Server Cache Reset

If the dev server gets into a bad state:

```bash
pkill -f "next dev"
rm -rf apps/web/.next
rm -rf node_modules/.cache
npm install
npm run dev
```

---

## Security Reminders

- **Never log PHI** -- Audit logs must be sanitized
- **Row-level security** -- Supabase RLS policies enforce data access
- **Session timeout** -- 30 minutes (configurable)
- **TLS only** -- All connections encrypted
- **Audit everything** -- CREATE, READ, UPDATE, DELETE, LOGIN, LOGOUT, EXPORT, SEARCH
- **Demo token** -- Only works in development
