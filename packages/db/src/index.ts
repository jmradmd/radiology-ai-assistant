import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// Explicit re-exports only (wildcard "export * from @prisma/client" breaks Next.js webpack)
export type { PrismaClient, User, Conversation, Message, Document, DocumentChunk, Schedule, ScheduleAssignment, Request, RequestEscalation, Notification, AuditLog, PHIDetectionLog, ConversationParticipant, Prisma } from "@prisma/client";
export { UserRole, Subspecialty, ConversationType, MessageType, ShiftType, CoverageType, Priority, RequestStatus, RequestType, NotificationType, NotificationStatus, AuditAction, Institution, Domain, AuthorityLevel, DocumentTier } from "@prisma/client";
