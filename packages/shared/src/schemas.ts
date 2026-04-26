/**
 * Zod validation schemas used by tRPC routers
 * These are shared between client and server for type safety
 */

import { z } from "zod";

// ════════════════════════════════════════════════════════════════════════════════
// ENUMS
// ════════════════════════════════════════════════════════════════════════════════

export const userRoleSchema = z.enum([
  "ADMIN",
  "COORDINATOR", 
  "ATTENDING",
  "FELLOW",
  "RESIDENT",
  "TECHNICIAN",
  "STAFF",
]);

export const subspecialtySchema = z.enum([
  "ABDOMINAL",
  "NEURO",
  "MSK",
  "CHEST",
  "IR",
  "PEDS",
  "BREAST",
  "NUCLEAR",
  "CARDIAC",
  "EMERGENCY",
]);

export const institutionSchema = z.enum(["INSTITUTION_A", "INSTITUTION_B", "SHARED"]);

export const domainSchema = z.enum(["PROTOCOL", "KNOWLEDGE"]);
export const authorityLevelSchema = z.enum([
  "INSTITUTIONAL",
  "NATIONAL_GUIDELINE",
  "SOCIETY_GUIDELINE",
]);
export const documentTierSchema = z.enum(["reference", "clinical", "educational"]);
export const queryDomainRouteSchema = z.enum(["PROTOCOL", "KNOWLEDGE", "HYBRID"]);
export const sourceDomainSchema = z.enum(["protocol", "knowledge"]);
export const outputStyleSchema = z.enum(["concise", "detailed", "auto"]);

export const prioritySchema = z.enum(["STAT", "URGENT", "ROUTINE"]);

export const requestStatusSchema = z.enum([
  "PENDING",
  "ASSIGNED",
  "ACKNOWLEDGED",
  "IN_PROGRESS",
  "RESOLVED",
  "ESCALATED",
  "CANCELLED",
]);

export const requestTypeSchema = z.enum([
  "PROTOCOL_QUESTION",
  "SPEAK_TO_RADIOLOGIST",
  "SCHEDULE_INQUIRY",
  "URGENT_STAT",
  "ADMINISTRATIVE",
]);

export const documentCategorySchema = z.enum([
  // Protocol categories (existing)
  "CONTRAST",
  "MRI_SAFETY",
  "CT_PROTOCOL",
  "MAMMO",
  "ULTRASOUND",
  "MEDICATION",
  "NURSING",
  "PEDIATRIC",
  "PREGNANCY",
  "RENAL",
  "SAFETY",
  "WORKFLOW",
  "CRITICAL",
  "COMPLIANCE",
  "GENERAL",
  // Anatomical/clinical categories
  "NEURORADIOLOGY",
  "SPINE",
  "HEAD_AND_NECK",
  "CHEST_THORACIC",
  "CARDIAC_VASCULAR",
  "ABDOMEN_GI",
  "GYNECOLOGIC_OBSTETRIC",
  "MUSCULOSKELETAL",
  "INTERVENTIONAL",
  "EMERGENCY",
  "NUCLEAR_MEDICINE",
  "PHYSICS_SAFETY",
  "ANATOMY",
]);

export const discrepancyTypeSchema = z.enum([
  "DOSING",
  "TIMING",
  "DRUG",
  "THRESHOLD",
  "PROCEDURE",
  "CONTRAINDICATION",
]);

export const conversationTypeSchema = z.enum([
  "DIRECT",
  "GROUP",
  "RAG_CHAT",
  "BROADCAST",
]);

export const messageTypeSchema = z.enum([
  "TEXT",
  "RAG_RESPONSE",
  "SYSTEM",
  "FILE",
  "IMAGE",
]);

// ════════════════════════════════════════════════════════════════════════════════
// LLM MODEL SCHEMAS
// ════════════════════════════════════════════════════════════════════════════════

// Static cloud model IDs are kept as a strict enum so typos in known model
// names still get rejected. The string branch exists to admit
// dynamically-discovered local model names (e.g., the result of a /v1/models
// query against a local server). Server-side resolution still verifies that
// any string-branch value resolves to a real local model.
export const llmModelIdSchema = z.union([
  z.enum([
    "claude-opus",
    "claude-sonnet",
    "claude-haiku",
    "gpt-5.2",
    "minimax-m2.5",
    "gemini-3.0",
    "deepseek-r1",
    "kimi-k2.5",
    "local",
  ]),
  z.string().min(1).max(100),
]);

export const llmProviderSchema = z.enum([
  "deepseek",
  "anthropic",
  "moonshot",
  "openai",
  "gemini",
  "minimax",
  "local",
]);

// ════════════════════════════════════════════════════════════════════════════════
// RAG SCHEMAS
// ════════════════════════════════════════════════════════════════════════════════

export const ragQuerySchema = z.object({
  message: z.string().min(1).max(2000),
  conversationId: z.string().uuid().optional(),
  modelId: llmModelIdSchema.optional(),
  category: documentCategorySchema.optional(),
  subspecialty: subspecialtySchema.optional(),
  institution: institutionSchema.optional(),
});

export const ragSearchSchema = z.object({
  query: z.string().min(1).max(500),
  category: documentCategorySchema.optional(),
  subspecialty: subspecialtySchema.optional(),
  institution: institutionSchema.optional(),
  limit: z.number().min(1).max(20).default(5),
});

// ════════════════════════════════════════════════════════════════════════════════
// USER SCHEMAS
// ════════════════════════════════════════════════════════════════════════════════

export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: userRoleSchema.default("STAFF"),
  department: z.string().max(100).optional(),
  subspecialty: subspecialtySchema.optional(),
  externalId: z.string().optional(),
});

export const updateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  role: userRoleSchema.optional(),
  department: z.string().max(100).optional(),
  subspecialty: subspecialtySchema.nullable().optional(),
  phoneWork: z.string().max(20).nullable().optional(),
  phoneMobile: z.string().max(20).nullable().optional(),
  phonePager: z.string().max(20).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const syncFromAuthSchema = z.object({
  authId: z.string(),
  email: z.string().email(),
  name: z.string().optional(),
});

// ════════════════════════════════════════════════════════════════════════════════
// REQUEST SCHEMAS
// ════════════════════════════════════════════════════════════════════════════════

export const createRequestSchema = z.object({
  type: requestTypeSchema,
  priority: prioritySchema.default("ROUTINE"),
  subject: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  // Backward compatibility with older clients
  content: z.string().max(5000).optional(),
  location: z.string().max(100).optional(),
  subspecialty: subspecialtySchema.optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const updateRequestStatusSchema = z.object({
  id: z.string().uuid(),
  status: requestStatusSchema,
  notes: z.string().max(1000).optional(),
  assignedToId: z.string().uuid().nullable().optional(),
});

// ════════════════════════════════════════════════════════════════════════════════
// CONVERSATION SCHEMAS
// ════════════════════════════════════════════════════════════════════════════════

export const createConversationSchema = z.object({
  type: conversationTypeSchema,
  title: z.string().max(200).optional(),
  participantIds: z.array(z.string().uuid()).default([]),
});

export const sendMessageSchema = z.object({
  conversationId: z.string().uuid(),
  content: z.string().min(1).max(10000),
  type: messageTypeSchema.default("TEXT"),
  metadata: z.record(z.unknown()).optional(),
});

// ════════════════════════════════════════════════════════════════════════════════
// SCHEDULE SCHEMAS
// ════════════════════════════════════════════════════════════════════════════════

export const shiftTypeSchema = z.enum(["DAY", "EVENING", "NIGHT", "WEEKEND_DAY", "WEEKEND_NIGHT", "CALL"]);

export const createScheduleSchema = z.object({
  effectiveDate: z.string().datetime(),
  shiftType: shiftTypeSchema,
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  location: z.string().optional(),
});

export const createScheduleAssignmentSchema = z.object({
  scheduleId: z.string().uuid(),
  userId: z.string().uuid(),
  subspecialty: subspecialtySchema,
  isPrimary: z.boolean().default(true),
  coverageType: z.enum(["ON_SITE", "REMOTE", "ON_CALL"]).default("ON_SITE"),
});

export const addAssignmentSchema = z.object({
  scheduleId: z.string().uuid(),
  userId: z.string().uuid(),
  isPrimary: z.boolean().default(true),
});

// ════════════════════════════════════════════════════════════════════════════════
// DOCUMENT SCHEMAS
// ════════════════════════════════════════════════════════════════════════════════

export const uploadDocumentSchema = z.object({
  title: z.string().min(1).max(500),
  source: z.string().max(200).optional(),
  category: documentCategorySchema,
  subspecialties: z.array(subspecialtySchema).optional(),
  institution: institutionSchema.default("INSTITUTION_B"),
  authorityLevel: authorityLevelSchema.default("INSTITUTIONAL"),
  guidelineSource: z.string().max(100).optional(),
  guidelineYear: z.number().int().min(1900).max(2100).optional(),
  content: z.string().min(1),
  filename: z.string().optional(),
});

// ════════════════════════════════════════════════════════════════════════════════
// TYPE EXPORTS
// ════════════════════════════════════════════════════════════════════════════════

export type UserRole = z.infer<typeof userRoleSchema>;
// Institution, Domain, AuthorityLevel, DocumentTier, LLMProvider are defined in types.ts (canonical source)
export type Priority = z.infer<typeof prioritySchema>;
export type RequestStatus = z.infer<typeof requestStatusSchema>;
export type RequestType = z.infer<typeof requestTypeSchema>;
export type DocumentCategory = z.infer<typeof documentCategorySchema>;
export type ConversationType = z.infer<typeof conversationTypeSchema>;
export type MessageType = z.infer<typeof messageTypeSchema>;
export type LLMModelId = z.infer<typeof llmModelIdSchema>;

export type RagQuery = z.infer<typeof ragQuerySchema>;
export type CreateUser = z.infer<typeof createUserSchema>;
export type UpdateUser = z.infer<typeof updateUserSchema>;
export type CreateRequest = z.infer<typeof createRequestSchema>;
export type SendMessage = z.infer<typeof sendMessageSchema>;
export type ShiftType = z.infer<typeof shiftTypeSchema>;
export type CreateSchedule = z.infer<typeof createScheduleSchema>;
export type CreateScheduleAssignment = z.infer<typeof createScheduleAssignmentSchema>;
