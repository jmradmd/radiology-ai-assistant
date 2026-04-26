# Radiology AI Assistant Development Guidelines

> Radiology Clinical Decision Support Framework

---

## Project Identity

**Radiology AI Assistant** is a mobile-first clinical decision support app for radiology departments featuring a RAG-powered protocol + knowledge assistant (multi-provider chat + embeddings, emergency detection), PDF document ingestion with automatic categorization, coordinator workflow routing with priority escalation, real-time messaging (typing indicators, read receipts), and on-call schedule management by subspecialty.

**Critical constraint:** NO-PHI architecture. All user input is scanned; patient identifiers are blocked at input layer.

---

## Architecture Overview

Monorepo layout:
- `apps/web/` — Next.js 14 (static export → Capacitor)
- `apps/desktop/` — Electron tray app
- `packages/api/` — tRPC routers + RAG lib
- `packages/db/` — Prisma schema + pgvector
- `packages/shared/` — Types, schemas, constants, PHI filter
- `scripts/` — Ingestion + seeding scripts
- `evaluation/` — Gold-standard dataset + runners
- `institution-a-policies/`, `institution-b-policies/` — Policy PDFs
- `teams_standard_docs/` — Departmental team standards
- `config/` — Project config, schema SQL, branding assets

### Tech Stack

Next.js 14 + React 18 + Tailwind + shadcn/ui on the web; Capacitor 6 for mobile; Electron 29 tray app for desktop. API via tRPC 11 (react-query). Postgres + pgvector (Supabase) with Supabase Auth + Realtime. RAG: Claude Haiku (default) / Sonnet / Opus / GPT / DeepSeek / Gemini / MiniMax / Kimi / Local (LM Studio / Ollama), plus multi-provider embeddings (OpenAI / Local) with auto-detection. PDF parsing via pdf-parse / mammoth / pptx-parser; markdown via react-markdown + remark-gfm; icons via lucide-react; state via Zustand (persisted); validation via Zod; dates via date-fns.

---

## Multi-Institution Support

Three institutions: `INSTITUTION_A` (folder `institution-a-policies/`, hospital-wide policies), `INSTITUTION_B` (folder `institution-b-policies/`, department protocols), `SHARED` (cross-institutional, no folder). Institution config (displayName, shortName, sourceFolder, colors) lives in `packages/shared/src/constants.ts` → `INSTITUTION_CONFIG`.

Users can filter protocol queries by institution (All Sources default, or a specific institution). Filter is applied at the vector search level via SQL: `AND d.institution = 'INSTITUTION_A'::"Institution"`.

---

## Monorepo Packages

### `@rad-assist/web` (apps/web)
Next.js frontend. Key directories:
- `src/app/` — App Router pages with route groups: `(auth)`, `(dashboard)`
- `src/components/ui/` — shadcn/ui primitives
- `src/components/dashboard/` — App-specific components
- `src/components/chat/` — RAG chat components (history, search, settings, institution toggle)
- `src/lib/trpc/client.ts` — tRPC React client
- `src/lib/supabase/client.ts` — Supabase browser client
- `src/lib/rag/search.ts` — RAG utilities (embedding, RRF fusion, prompt building, chunking)
- `src/lib/routing/classifier.ts` — Intent classification
- `src/stores/auth.ts` — Zustand auth store with persistence
- `src/stores/preferences.ts` — Zustand preferences store (output style, department, display options)
- `src/hooks/useRealtime.ts` — Supabase realtime hooks

### `@rad-assist/api` (packages/api)
tRPC backend. Routers under `src/routers/` (user, conversation, request, schedule, rag, message, system). `src/routers/system.ts` exposes `healthCheck` (publicProcedure). `src/trpc.ts` defines the procedure hierarchy; `src/context.ts` builds request context (prisma, user).

Key `src/lib/` modules:
- `rag-config.ts` — Thresholds, emergency keywords
- `llm-client.ts` — Multi-provider LLM. Cloud uses fallback chain; local uses `LOCAL_LLM_URL` and fails explicitly on local errors
- `embedding-client.ts` — Multi-provider embeddings. Hierarchy: real `OPENAI_API_KEY` → OpenAI, else `LOCAL_LLM_URL` → local; overridable via `EMBEDDING_PROVIDER`. `isRealApiKey()` rejects placeholders. For nomic-embed-text, `applyNomicPrefix()` prepends `search_query:` / `search_document:`. Sets `encoding_format: 'float'` for LM Studio. Exports `EmbeddingTask` (`'query'` | `'document'`). Callers format vectors as `` `[${embedding.join(',')}]` `` for pgvector raw SQL
- `emergency-detection.ts` — Clinical urgency detection
- `abbreviation-detector.ts` + `medical-abbreviations.ts` — Abbreviation disambiguation (150+ entries)
- `topic-detector.ts` — Topic detection + category boost suggestions
- `query-analyzer.ts` — LLM-based query analysis
- `query-domain-classifier.ts` — `PROTOCOL`/`KNOWLEDGE`/`HYBRID` classification
- `query-routing-safety.ts` — Emergency safety override for knowledge-only routes
- `response-validator.ts` — Post-gen policy validation (exports `validateCitations` for local-model `[S#]` handle checks)
- `concise-format.ts` — Concise-mode formatting
- `phi-audit.ts` — PHI audit logging
- `clarification-guard.ts` — Clarification gating/dedup
- `source-relevance.ts` — Source relevance scoring + filtering
- `discrepancy-detection.ts` — Institutional policy discrepancy detection (planned)
- `provider-health.ts` — Health + local model discovery. `discoverLocalModels()` queries GET /v1/models (3s timeout, 60s cache). `checkProviderHealth()` returns status/provider/model/message per provider

### `@rad-assist/db` (packages/db)
Prisma ORM:
- `prisma/schema.prisma` — Full schema with pgvector extension
- Exports Prisma client from `src/index.ts`

### `@rad-assist/shared` (packages/shared)
Shared utilities:
- `src/types.ts` — TypeScript types (mirrors Prisma enums)
- `src/schemas.ts` — Zod validation schemas
- `src/constants.ts` — App config, RAG settings, priority times
- `src/phi-filter.ts` — PHI detection utilities
- `src/index.ts` — Re-exports all

### `@rad-assist/desktop` (apps/desktop)
Electron desktop tray app. Key files:
- `src/main/` — Electron main process: `main.ts` (lifecycle, single-instance lock, global hotkey), `tray.ts`, `window.ts` (420x600 popup), `store.ts` (electron-store + safeStorage), `ipc.ts`, `preload.ts`, `updater.ts`
- `src/renderer/` — React frontend with `components/`, `stores/`, `lib/trpc.ts` pointing to production API
- `build/` — macOS entitlements; `scripts/notarize.js` — Apple notarization

**Key behaviors:** Global hotkey `Ctrl/Cmd+Shift+P`; window hides on blur or Escape; auth tokens encrypted via OS keychain; emergency detection triggers native notifications + amber tray icon.

---

## PDF Ingestion Pipeline

### Running Ingestion

```bash
npm run ingest:institution-a / ingest:institution-b / ingest:all / ingest:all:clean
npm run ingest:guidelines                          # National guidelines from ./Guidelines
npm run ingest:teams-abdominal[:clean|:dry-run]    # Departmental team standards
```

`scripts/ingest-institution.ts` scans folder → classifies by folder + filename patterns → sets `institution` on Document/DocumentChunk → extracts text via `pdf-parse` with page-aware chunking → chunks 512 tokens / 100 overlap → generates embeddings → stores with institution metadata.

CLI: `--institution INSTITUTION_A|INSTITUTION_B|ALL`, `--clean` (DANGEROUS), `--dry-run`, `--verbose`.

Team standard documents are parsed from PDF (`pdf-parse`), DOCX (`mammoth`), PPTX (`pptx-parser`), TXT/Markdown.

### Document Category Taxonomy

```typescript
type PrimaryCategory =
  | "CONTRAST" | "MRI_SAFETY" | "CT_PROTOCOL" | "MAMMO" | "ULTRASOUND"
  | "MEDICATION" | "NURSING" | "PEDIATRIC" | "PREGNANCY" | "RENAL"
  | "SAFETY" | "WORKFLOW" | "CRITICAL" | "COMPLIANCE" | "GENERAL";

type DocumentPriority = "CRITICAL" | "HIGH" | "STANDARD";
```

- **CRITICAL**: Contrast reactions, MRI safety, emergency protocols
- **HIGH**: Cardiac protocols, pediatric, medication administration
- **STANDARD**: Workflow, administrative, general guidelines

### Classification Rules

Documents are classified by folder name (→ primary category) + filename regex patterns. Example:
```typescript
/contrast\s*reaction/i -> { category: "CONTRAST", priority: "CRITICAL" }
/pacemaker|icd|defibrillator/i -> { category: "MRI_SAFETY", subspecialties: ["CARDIAC"] }
/egfr|creatinine|nephro/i -> { category: "RENAL", priority: "CRITICAL" }
```

### Adding New Documents

1. Place PDFs in appropriate subfolder under institution's policy folder
2. Run institution-specific ingestion script
3. Auto-classification runs on folder/filename patterns
4. Edit `KEYWORD_RULES` in `scripts/ingest-institution.ts` for custom rules

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

Vector similarity via raw SQL:
```sql
SELECT *, 1 - (embedding <=> $1::vector) as similarity
FROM "DocumentChunk"
ORDER BY embedding <=> $1::vector
LIMIT 5;
```

---

## tRPC Procedure Hierarchy

In `packages/api/src/trpc.ts`: `publicProcedure` (no auth), `protectedProcedure` (authenticated user), `coordinatorProcedure` (ADMIN or COORDINATOR), `adminProcedure` (ADMIN only). Middleware: `isAuthed` throws UNAUTHORIZED if `!ctx.user`; `isCoordinator`/`isAdmin` throw FORBIDDEN on role mismatch.

`createContext({ req })` (`packages/api/src/context.ts`) extracts the Bearer token, handles demo-token in dev, verifies via Supabase `auth.getUser()`, auto-creates the user in the DB if present in Supabase but not locally, and returns `{ prisma, user, req }`.

---

## RAG Implementation

### Model Configuration (`packages/shared/src/types.ts`)

`LLM_MODELS` entries (id / provider / modelId): `local`/`local`/`local-model`, `claude-opus`/`anthropic`/`claude-opus-4-6`, `claude-sonnet`/`anthropic`/`claude-sonnet-4-6`, `claude-haiku`/`anthropic`/`claude-haiku-4-5` **(default)**, `gpt`/`openai`/`gpt-latest`, `deepseek-r1`/`deepseek`/`deepseek-reasoner`, `gemini`/`gemini`/`gemini-flash-preview`, `minimax`/`minimax`/`MiniMax-latest`, `kimi`/`moonshot`/`kimi-latest`.

- `DEFAULT_MODEL_ID = "claude-haiku"`
- Cloud fallback chain: requested → Sonnet → GPT → DeepSeek → Gemini → MiniMax → Haiku → Kimi → Opus
- Local: uses `LOCAL_LLM_URL` and throws on local-server failures (no silent cloud fallback)

### RAG Configuration (`packages/api/src/lib/rag-config.ts`)

```typescript
RAG_CONFIG = {
  // Embedding config is managed by embedding-client.ts.
  // EMBEDDING_MODEL defaults to 'text-embedding-3-small' for OpenAI; must be set explicitly for local.
  EMBEDDING_MODEL: 'text-embedding-3-small',
  EMBEDDING_DIMENSIONS: undefined,
  MIN_CONFIDENCE_THRESHOLD: 0.50,
  HIGH_CONFIDENCE_THRESHOLD: 0.70,
  MAX_SEARCH_RESULTS: 8,
  MAX_VERBATIM_SOURCES: 3,
  MIN_DISPLAY_SIMILARITY: 0.52,
  MIN_DISPLAY_SIMILARITY_KNOWLEDGE: 0.55,
  MAX_CONTEXT_TOKENS: 8000,
  EMERGENCY_KEYWORDS: [...],
  SEVERITY_ESCALATORS: [...],
  CRITICAL_THRESHOLDS: { O2_SAT_LOW: 92, BP_SYSTOLIC_LOW: 90 },
  TEAMS_TIER_CONFIG: { SOURCE_COLLECTION: "teams_standard", TRIGGER_KEYWORDS: [...],
    REFERENCE_BONUS: 0.05, EDUCATIONAL_PENALTY: -0.03, CLINICAL_ADJUSTMENT: 0 },
}
```

### RAG Router Endpoints

```typescript
// packages/api/src/routers/rag.ts
rag.search         // Vector similarity search, returns ranked chunks
rag.chat           // Full RAG with hybrid response (summary + verbatim sources)
rag.listDocuments  // List all active documents with filters
rag.uploadDocument // Admin: upload and embed new document

// packages/api/src/routers/system.ts
system.healthCheck // Provider config validation (public). Returns llm/embedding status, provider, model, human-readable messages, and overall healthy boolean.
```

### Hybrid Response Architecture

`rag.chat` returns AI summary + verbatim protocol text:

```typescript
interface ChatResponse {
  summary: string;
  citationSources: Array<{ title: string; domain: "protocol" | "knowledge"; sourceLabel?: string; url: string | null }>;
  verbatimSources: Array<{ title: string; content: string; category: string; domain: "protocol" | "knowledge";
    sourceLabel?: string; similarity: number; url: string | null; institution?: Institution }>;
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
  retrievalDebug?: { effectiveQuery: string; queryRoute?: "PROTOCOL" | "KNOWLEDGE" | "HYBRID";
    expandedQuery?: string; abbreviationsDetected?: string[]; abbreviationsExpanded?: Record<string, string> };
}
```

### RAG Chat Flow

1. **PHI Validation + Override Gate** — block unresolved spans; allow explicit per-span overrides
2. **Query Domain Routing** — classify into `PROTOCOL` / `KNOWLEDGE` / `HYBRID`
3. **Emergency Safety Override** — upgrade `KNOWLEDGE` → `HYBRID` for urgent/emergency severity
4. **Emergency Assessment** — detect urgency via keywords/vitals patterns
5. **LLM Query Analysis** — detect topic, ambiguity, intervention risk, clarification needs
6. **Conversation Context** — retrieve prior messages, expand referential follow-ups
7. **Abbreviation Expansion** — expand resolved abbreviations for better embedding recall
8. **Generate Embedding** — query → configured provider
9. **Vector Search** — domain-aware pgvector retrieval with category boost + tier scoring
10. **Confidence + Source Filtering** — apply similarity thresholds before display
11. **Prompt Construction** — cloud branches: knowledge-only / hybrid / emergency / routine / low-confidence. Local path uses source-card prompting with `[S#]` handles
12. **LLM Generation** — selected model (or fallback) with context-aware system prompt
13. **Post-Generation Validation** — run response-policy validation; regenerate once on critical violations. For local, also validate `[S#]` handles against allowed set
14. **Return Hybrid Response** — summary + citation sources + verbatim sources + emergency/model metadata

### Citation Link Policy

Inline citations use `[Source: "..."]` format, rendered as compact icons client-side. Source links restricted to internal policy files (`/api/policies/...`) when available; outbound external source links are disabled in runtime chat UX.

### Local-Model Source-Card Prompting

Local 9B-26B models cannot reliably cite free-text titles in `[SOURCE n | DOMAIN: "Title"]` form. For `provider === "local"`, retrieved chunks are repackaged as structured source cards with stable handles `[S1]`, `[S2]`, ... `buildLocalSystemPrompt` produces a short template with few-shot examples (supported, no-source, conflicting, partial-answer). A post-gen citation validator rejects any handle not in the allowed set. Cloud prompt path is untouched. `benchmark.ts` imports `buildLocalSystemPrompt` + `formatSourceCards` from `rag.ts` so benchmark runs stay in sync with production.

### RAG System Prompt Behavior

Adapts by emergency assessment:
- **Emergency/Urgent:** Leads with the most critical action using direct commands; doses quoted exactly; structured IMMEDIATE ACTIONS → MONITORING → ESCALATION
- **Routine:** Summary of relevant guidance; references by exact title `[Source: Document Title]`; quotes dosing exactly; acknowledges missing guidance
- **Low Confidence:** Acknowledges uncertainty; recommends consulting on-call radiologist; suggests verifying with original documents

---

## Emergency Detection

`packages/api/src/lib/emergency-detection.ts`:

```typescript
interface EmergencyAssessment {
  isEmergency: boolean;
  severity: 'routine' | 'urgent' | 'emergency';
  triggers: string[]; escalators: string[]; numericAlerts: string[];
}
```

Detection rules:
1. **Emergency Keywords** — Respiratory (desaturation, airway), Cardiovascular (hypotension, shock), Anaphylaxis
2. **Severity Escalators** — "not responding to", "worsening", "despite treatment"
3. **Numeric Thresholds** — O2 sat < 92%, BP systolic < 90 mmHg
4. **Escalation**: single trigger → `urgent`; multiple triggers/escalators/critical vitals → `emergency`; high-severity keywords (anaphylaxis, code, cardiac arrest) → immediate `emergency`

---

## Medical Abbreviation Handling

`packages/api/src/lib/abbreviation-detector.ts`, `medical-abbreviations.ts`. Abbreviations are ambiguous ("MS" → multiple sclerosis / mitral stenosis / morphine sulfate). The system detects abbreviations, flags high-risk ambiguous ones, requests clarification when context is insufficient, and expands resolved abbreviations for better retrieval.

```typescript
interface AbbreviationEntry { meanings: string[]; category?: string; dangerous?: boolean }

'MS':   { meanings: ['multiple sclerosis', 'mitral stenosis', 'morphine sulfate'], dangerous: true }
'EGFR': { meanings: ['estimated glomerular filtration rate', 'epidermal growth factor receptor'], dangerous: true }
'PE':   { meanings: ['pulmonary embolism', 'physical examination', 'pleural effusion'], dangerous: true }
```

Context-based resolution picks a meaning from nearby words (e.g. "MS" + "neuro/brain" → multiple sclerosis; "EGFR" + "renal" → GFR). When resolution fails, `rag.chat` returns `needsAbbreviationClarification: true` with options; UI prompts; follow-up query runs with resolved context.

---

## Topic Detection

`packages/api/src/lib/topic-detector.ts` identifies protocol topics from keywords/patterns and suggests category boosts for vector search. Handles special cases (e.g. Symptom + Contrast → Contrast Reaction).

```typescript
interface TopicDefinition { name: string; keywords: string[]; patterns: RegExp[]; boostCategory: PrimaryCategory }
```

---

## tRPC Router Endpoints

**Conversation:** `list` (optional type filter), `listRagChats` (with search), `getRagChatMessages`, `delete`, `getById`, `create`, `getOrCreateDirect`, `markRead`, `createRagChat`.

**User:** `syncFromAuth` (after login), `me`, `getById`, `list`, `listProviders`, `updateProfile`; admin-only: `updateUser`, `create`.

**Schedule:** `getCurrentOnCall`, `getSchedule`, `todaySummary`; coordinator-only: `create`, `addAssignment`, `removeAssignment`, `bulkImport`.

**Message:** `list`, `send` (with per-span PHI override support), `unreadCount`.

**Request:** `create` (with PHI override support), `list` (role-based filtering), `getById` (with escalations), `updateStatus` (coordinator or assignee), `assign` (coordinator only), `counts` (dashboard by status/priority).

**PDF Serving API:** `GET /api/policies/{filename}` (`apps/web/src/app/api/policies/[filename]/route.ts`) — recursive, case-insensitive search for internal document files. Blocks directory traversal. Supports .pdf/.docx/.pptx/.txt/.md. Returns file stream with 24hr cache.

---

## Chat UI Features

### Category Chips

The chat page includes chips for filtering protocol queries: `all | contrast | mri-safety | ct-protocol | renal | mammo | peds | safety | nursing`. Each maps to a `PrimaryCategory` (except `all`) and a lucide icon. Selected category gets a 20% boost in vector search relevance.

### Chat Components (`apps/web/src/components/chat/`)

Kebab-case files matching PascalCase component names: `chat-input.tsx` (PHI detection + send button), `loading-indicator.tsx`, `discrepancy-alert.tsx` (institutional policy conflicts), `empty-state.tsx` (example queries), `history-sidebar.tsx`, `institution-toggle.tsx`, `model-selector.tsx`, `search-modal.tsx`, `settings-panel.tsx`, `side-by-side-response.tsx` (summary + verbatim sources), `config-banner.tsx` (polls `system.healthCheck` every 30s; hidden when healthy, red for critical errors, amber for warnings; auto-clears when healthy).

### Dashboard Pages

| Route | Page | Purpose |
|-------|------|---------|
| `/chat` | `(dashboard)/chat/page.tsx` | RAG protocol assistant |
| `/dashboard` | `(dashboard)/dashboard/page.tsx` | Main dashboard |
| `/profile` | `(dashboard)/profile/page.tsx` | User profile and settings |
| `/queue` | `(dashboard)/queue/page.tsx` | Request queue list |
| `/queue/new` | `(dashboard)/queue/new/page.tsx` | Create new request form |
| `/schedule` | `(dashboard)/schedule/page.tsx` | On-call schedule viewer |

---

## Intent Classification & Routing

`apps/web/src/lib/routing/classifier.ts`:
- `classifyIntent(message)` — STAT rule (conf 1.0) → URGENT rule (0.9) → pattern-based (0.75) → ADMINISTRATIVE fallback (0.5)
- `determinePriority(intent)` — `URGENT_STAT` OR conf === 1.0 → `STAT`; `SPEAK_TO_RADIOLOGIST` AND conf >= 0.8 → `URGENT`; else `ROUTINE`

Subspecialty extraction patterns:
```typescript
ABDOMINAL: /abdomen|liver|kidney|GI|bowel/i
NEURO:     /brain|neuro|head|spine|stroke/i
MSK:       /musculoskeletal|MSK|bone|joint/i
CHEST:     /chest|lung|thoracic|pulmonary/i
IR:        /interventional|IR |biopsy|drain/i
```

---

## Request Workflow

Lifecycle: `PENDING → ASSIGNED → ACKNOWLEDGED → IN_PROGRESS → RESOLVED` (with `ESCALATED` / `CANCELLED` branches).

Role-based access: ADMIN (full access, can assign, view all); COORDINATOR (can assign, view all); ATTENDING/FELLOW (view own + assigned); RESIDENT/TECH/STAFF (view own only).

---

## Code Patterns

### tRPC Router Pattern

Routers use `protectedProcedure` (or `coordinatorProcedure`/`adminProcedure`) from `../trpc`, with `.input(zodSchema)` and `.query()` or `.mutation()`. Always wrap free-text inputs with `validateNoPHI`/`detectPotentialPHI` from `@rad-assist/shared` and throw `TRPCError` on violations.

```typescript
export const exampleRouter = router({
  list: protectedProcedure
    .input(z.object({ limit: z.number().default(20) }))
    .query(({ ctx, input }) => ctx.prisma.example.findMany({ take: input.limit })),

  assign: coordinatorProcedure
    .input(z.object({ id: z.string().uuid(), userId: z.string().uuid() }))
    .mutation(({ ctx, input }) => ctx.prisma.example.update({
      where: { id: input.id }, data: { assignedToId: input.userId },
    })),
});
```

### PHI Validation Pattern

```typescript
import { detectPotentialPHI, getUnresolvedBlockingSpans } from "@rad-assist/shared";
import { logPHIDetectionEvent } from "../lib/phi-audit";

const phiResult = detectPotentialPHI(input.content);
const unresolved = getUnresolvedBlockingSpans(phiResult, input.phiOverrides);

if (phiResult.hasPHI) {
  await logPHIDetectionEvent({ prisma: ctx.prisma, userId: ctx.user?.id || null,
    endpoint: "message.send", phiResult, overrides: input.phiOverrides });
}
if (unresolved.length > 0) {
  throw new TRPCError({ code: "BAD_REQUEST",
    message: "Protected health information detected. Override each highlighted span to proceed." });
}
```

### Frontend Component Pattern

`"use client"` components use `trpc.*.useQuery()`/`.useMutation()` from `@/lib/trpc/client`. Any user-typed input runs through `detectPotentialPHI()` for real-time warnings; production inputs use `PhiHighlightedInput`/`PhiHighlightedTextarea` which handle highlighting + per-span override state automatically.

### Zustand Store Pattern

Persisted stores use `persist` middleware with `partialize` to control what's written to storage:
- Auth store (`apps/web/src/stores/auth.ts`): persists `user`, `accessToken`, `isAuthenticated`, `rememberMe` under `rad-assist-auth`
- Preferences store (`stores/preferences.ts`): persists `outputStyle`, `department`, `selectedModelId`, etc. under `rad-assist-preferences`

```typescript
export type OutputStyle = "concise" | "detailed" | "auto";
export type Department = "ABDOMINAL" | "NEURO" | "MSK" | "CHEST" | "IR" | "PEDS"
  | "BREAST" | "NUCLEAR" | "CARDIAC" | "EMERGENCY" | "GENERAL";
```

---

## UI Components (shadcn/ui)

Components live in `apps/web/src/components/ui/`. Primitives: Avatar, Badge, Button, Card, Checkbox, Input, Markdown, PhiHighlightedInput/Textarea, ScrollArea, Select, Separator, Tabs, Textarea, ThemeToggle, Toast/Toaster.

### Button Variants

Custom priority variants: `<Button variant="stat">` (red), `variant="urgent"` (amber), `variant="routine"` (green).

### Tailwind Custom Colors

```typescript
rad-assist: { 50-950 }    // Primary brand color
stat:      "#dc2626"      // Red for STAT priority
urgent:    "#f59e0b"      // Amber for urgent
routine:   "#22c55e"      // Green for routine
emergency: { 50-700 }     // Amber scale for clinical urgency (distinct from system errors)
success:   { 50-700 }     // Green scale for positive states
error:     { 50-700 }     // Red scale for system errors only
```

Clinical urgency uses amber (`emergency-*`) to differentiate from system errors (red).

---

## PHI Compliance

### What's Blocked

`detectPotentialPHI()` in `@rad-assist/shared` scans for:

| Pattern | Examples |
|---------|----------|
| MRN | 7-10 digit numbers, "MRN: 12345678" |
| SSN | XXX-XX-XXXX patterns |
| DATE | "DOB: 01/15/1980", date patterns with clinical context |
| Patient Names | Name pairs/honorifics with context, powered by generated first/last-name DB + eponym exclusions |
| Contact IDs | PHONE, EMAIL, URL, IP_ADDRESS, ACCOUNT/PLAN identifiers |

### Implementation Points

1. **Client-side highlighting**: `PhiHighlightedInput` / `PhiHighlightedTextarea` for real-time red/amber overlays
2. **Per-span override workflow**: Require explicit acknowledged overrides for each blocked span before send
3. **Server-side enforcement + logging**: Recompute PHI, verify unresolved spans, log via `PHIDetectionLog`
4. **Never store raw PHI**: Only hashed/audit metadata persisted

### Safe Content

- Employee names (Dr. Smith, Nurse Jones)
- Protocol questions (generic procedures)
- Schedule information
- Room/location without patient context

---

## Priority & Routing

```typescript
PRIORITY_RESPONSE_TIMES = { STAT: 2, URGENT: 5, ROUTINE: 30 } // minutes
ESCALATION_TIMES = { STAT: 2, URGENT: 5, ROUTINE: 30 }

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
"@/*"              -> "src/*"
"@rad-assist/api"    -> "packages/api"
"@rad-assist/db"     -> "packages/db"
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
npx tsx scripts/build-name-database.ts                             # Regenerate name DB for PHI

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

1. **Schema** (`packages/db/prisma/schema.prisma`): add model, run `npm run db:generate && npm run db:push`
2. **Zod schema** (`packages/shared/src/schemas.ts`): export `createNewThingSchema = z.object({...})`
3. **tRPC router** (`packages/api/src/routers/new-thing.ts`): wrap free-text mutations in `validateNoPHI`
4. **Frontend page** (`apps/web/src/app/(dashboard)/new-thing/page.tsx`): `"use client"` calling `trpc.newThing.*`

---

## Local Development Startup

1. **Database**: Docker (`docker start rad-assist-postgres`; verify `docker port rad-assist-postgres 5432/tcp`) or hosted (set `DATABASE_URL` + `DIRECT_URL`).
2. **Environment**: verify `DATABASE_URL`, `DIRECT_URL`, and one of `OPENAI_API_KEY` / `LOCAL_LLM_URL` are non-empty.
3. **Start**: `npm run dev`; confirm http://localhost:3000 responds, no Prisma auth errors.
4. **Failure policy**: if Prisma shows `Authentication failed against database server`, stop and resolve DB credentials before UI debugging.

---

## Testing Checklist

When modifying features, verify:

- [ ] PHI detection blocks MRN/SSN/DATE/NAME with span-level highlights and logs to `PHIDetectionLog`
- [ ] Per-span PHI override UX works; unresolved spans still block submit
- [ ] tRPC mutations validate input with Zod schemas; protected/coordinator procedures check authorization
- [ ] Real-time subscriptions update correctly; mobile layout works at 375px width
- [ ] Priority colors display correctly (STAT=red, URGENT=amber, ROUTINE=green)
- [ ] RAG: citations include source documents; emergency detection triggers on clinical urgency; verbatim sources display alongside AI summary; institution filter limits results; abbreviation clarification prompts for ambiguous terms
- [ ] LLM model selector switches providers; local model requests fail explicitly when unavailable (no silent cloud fallback)
- [ ] Query domain routing behaves as expected (PROTOCOL/KNOWLEDGE/HYBRID)
- [ ] User preferences persist across sessions; auth hydration prevents flash of unauthenticated content

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

Each module has a colocated `*.test.ts`: emergency severity (`emergency-detection`), PHI sensitivity/specificity (`phi-filter`), emergency safety override (`query-routing-safety`), source relevance scoring (`source-relevance`), concise-mode formatting (`concise-format`), clarification gating (`clarification-guard`), clarification parsing (`clarification-parser`), intent classification (`classifier`).

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

**New unit test:** Create a `.test.ts` file next to the module using `node:test` and `node:assert/strict`.

See [evaluation/EVALUATION.md](evaluation/EVALUATION.md) for full documentation including dataset extension, institutional data, and CI integration.

---

## Code Style Rules

1. **Explicit over clever** — No magic, prefer readable code
2. **Comments explain "why", not "what"** — Code should be self-documenting
3. **Validate at boundaries** — Use Zod schemas at API layer
4. **Fail fast on PHI** — Block before processing, not after
5. **Type everything** — Leverage TypeScript + Prisma generated types
6. **Use existing components** — Don't recreate shadcn primitives
7. **Mobile-first CSS** — Default styles for mobile, use `md:` breakpoints for desktop
8. **Raw SQL for vectors** — Prisma doesn't support pgvector natively, use `$queryRaw`

---

## UI Consistency Rules

1. **Chat submit button styling is locked** — Enabled send button must remain `bg-slate-800 dark:bg-slate-700` with `text-rad-assist-400`. Do not change to bright fills.
2. **Chat text alignment must use shared metrics** — Textarea text, PHI overlay text, and animated placeholder must share padding, font-size, line-height, font-family. Baseline: `text-[15px]`, `leading-[24px]`, `font-sans`.
3. **No destructive git restore without explicit user consent** — Never run `git checkout --` or equivalent restore commands on user-modified files unless explicitly asked.

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

```bash
pkill -f "next dev" && rm -rf apps/web/.next node_modules/.cache && npm install && npm run dev
```

---

## Security Reminders

- **Never log PHI**; audit logs must be sanitized
- **Row-level security** — Supabase RLS policies enforce data access
- **Session timeout**: 30 minutes (configurable); **TLS only** for all connections
- **Audit everything**: CREATE, READ, UPDATE, DELETE, LOGIN, LOGOUT, EXPORT, SEARCH
- **Demo token** works only in development
