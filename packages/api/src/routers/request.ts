import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, coordinatorProcedure } from "../trpc";
import {
  createRequestSchema,
  updateRequestStatusSchema,
  prioritySchema,
  requestTypeSchema,
  subspecialtySchema,
} from "@rad-assist/shared";
import {
  detectPotentialPHI,
  getUnresolvedBlockingSpans,
  isOverridableBlock,
  type PHIOverrideSelection,
} from "@rad-assist/shared";
import { logPHIDetectionEvent } from "../lib/phi-audit";

const phiOverrideSelectionSchema = z.object({
  spanId: z.string().min(1),
  type: z.string().min(1),
  inputHash: z.string().min(1),
  acknowledged: z.literal(true),
});

const requestPHIOverrideSchema = z.object({
  subject: z.array(phiOverrideSelectionSchema).optional(),
  description: z.array(phiOverrideSelectionSchema).optional(),
}).optional();

export const requestRouter = router({
  // Create a new request
  create: protectedProcedure
    .input(createRequestSchema.extend({ phiOverrides: requestPHIOverrideSchema }))
    .mutation(async ({ ctx, input }) => {
      const subjectResult = detectPotentialPHI(input.subject);
      const descriptionValue = (input.description ?? input.content ?? "").trim();
      if (!descriptionValue) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Request details are required",
        });
      }
      const descriptionResult = descriptionValue ? detectPotentialPHI(descriptionValue) : null;

      const subjectOverrides = (input.phiOverrides?.subject ?? []) as PHIOverrideSelection[];
      const descriptionOverrides = (input.phiOverrides?.description ?? []) as PHIOverrideSelection[];

      const subjectUnresolved = getUnresolvedBlockingSpans(subjectResult, subjectOverrides);
      const descriptionUnresolved = descriptionResult
        ? getUnresolvedBlockingSpans(descriptionResult, descriptionOverrides)
        : [];

      if (subjectResult.hasPHI) {
        try {
          await logPHIDetectionEvent({
            prisma: ctx.prisma,
            userId: ctx.user?.id || null,
            endpoint: "request.create.subject",
            phiResult: subjectResult,
            overrides: subjectOverrides,
          });
        } catch (logError) {
          console.error("Failed to log PHI detection for request subject:", logError);
        }
      }

      if (descriptionResult?.hasPHI) {
        try {
          await logPHIDetectionEvent({
            prisma: ctx.prisma,
            userId: ctx.user?.id || null,
            endpoint: "request.create.description",
            phiResult: descriptionResult,
            overrides: descriptionOverrides,
          });
        } catch (logError) {
          console.error("Failed to log PHI detection for request description:", logError);
        }
      }

      const subjectBlocked = subjectUnresolved.length > 0 || (subjectResult.hasPHI && !isOverridableBlock(subjectResult));
      const descriptionBlocked =
        descriptionUnresolved.length > 0 ||
        (descriptionResult?.hasPHI === true && !isOverridableBlock(descriptionResult));

      if (subjectBlocked || descriptionBlocked) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Protected health information detected. Hover over highlighted text and explicitly override each blocked item to continue.",
        });
      }

      const request = await ctx.prisma.request.create({
        data: {
          type: input.type,
          priority: input.priority,
          subject: input.subject,
          description: descriptionValue || null,
          location: input.location ?? null,
          subspecialty: input.subspecialty,
          requestedById: ctx.user.id,
        },
        include: {
          requestedBy: {
            select: { id: true, name: true, role: true },
          },
        },
      });

      // TODO: Trigger routing logic and notifications
      return request;
    }),

  // List requests (coordinators see all, others see their own)
  list: protectedProcedure
    .input(
      z.object({
        status: z
          .enum([
            "PENDING",
            "ASSIGNED",
            "ACKNOWLEDGED",
            "IN_PROGRESS",
            "RESOLVED",
            "ESCALATED",
            "CANCELLED",
          ])
          .optional(),
        priority: prioritySchema.optional(),
        type: requestTypeSchema.optional(),
        subspecialty: subspecialtySchema.optional(),
        assignedToMe: z.boolean().optional(),
        limit: z.number().min(1).max(100).default(20),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const isCoordinator = ["ADMIN", "COORDINATOR"].includes(ctx.user.role);

      const requests = await ctx.prisma.request.findMany({
        where: {
          ...(input.status && { status: input.status }),
          ...(input.priority && { priority: input.priority }),
          ...(input.type && { type: input.type }),
          ...(input.subspecialty && { subspecialty: input.subspecialty }),
          ...(input.assignedToMe && { assignedToId: ctx.user.id }),
          ...(!isCoordinator && !input.assignedToMe && {
            OR: [
              { requestedById: ctx.user.id },
              { assignedToId: ctx.user.id },
            ],
          }),
        },
        include: {
          requestedBy: {
            select: { id: true, name: true, role: true },
          },
          assignedTo: {
            select: { id: true, name: true, role: true, subspecialty: true },
          },
        },
        take: input.limit + 1,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        orderBy: [
          { priority: "asc" }, // STAT first
          { createdAt: "desc" },
        ],
      });

      let nextCursor: string | undefined;
      if (requests.length > input.limit) {
        const nextItem = requests.pop();
        nextCursor = nextItem?.id;
      }

      return { requests, nextCursor };
    }),

  // Get request by ID
  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const request = await ctx.prisma.request.findUnique({
        where: { id: input.id },
        include: {
          requestedBy: {
            select: { id: true, name: true, role: true, phoneMobile: true },
          },
          assignedTo: {
            select: {
              id: true,
              name: true,
              role: true,
              subspecialty: true,
              phoneMobile: true,
            },
          },
          escalations: {
            orderBy: { escalatedAt: "desc" },
          },
        },
      });

      if (!request) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Request not found",
        });
      }

      // Authorization: only coordinators/admins, the creator, or the assignee may view
      const isCoordinator = ["ADMIN", "COORDINATOR"].includes(ctx.user.role);
      const isCreator = request.requestedBy?.id === ctx.user.id;
      const isAssignee = request.assignedTo?.id === ctx.user.id;

      if (!isCoordinator && !isCreator && !isAssignee) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have access to this request",
        });
      }

      return request;
    }),

  // Update request status (coordinator or assigned user)
  updateStatus: protectedProcedure
    .input(updateRequestStatusSchema)
    .mutation(async ({ ctx, input }) => {
      const request = await ctx.prisma.request.findUnique({
        where: { id: input.id },
      });

      if (!request) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Request not found",
        });
      }

      const isCoordinator = ["ADMIN", "COORDINATOR"].includes(ctx.user.role);
      const isAssigned = request.assignedToId === ctx.user.id;

      if (!isCoordinator && !isAssigned) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You cannot update this request",
        });
      }

      const updateData: Record<string, unknown> = {
        status: input.status,
      };

      // Only coordinators/admins may reassign — silently drop assignedToId for others
      if (input.assignedToId !== undefined && isCoordinator) {
        updateData.assignedToId = input.assignedToId;
      }

      if (input.status === "ACKNOWLEDGED") {
        updateData.acknowledgedAt = new Date();
      } else if (input.status === "RESOLVED") {
        updateData.resolvedAt = new Date();
      }

      return ctx.prisma.request.update({
        where: { id: input.id },
        data: updateData,
        include: {
          requestedBy: {
            select: { id: true, name: true, role: true },
          },
          assignedTo: {
            select: { id: true, name: true, role: true, subspecialty: true },
          },
        },
      });
    }),

  // Assign request to provider (coordinator only)
  assign: coordinatorProcedure
    .input(
      z.object({
        requestId: z.string().uuid(),
        assignedToId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.request.update({
        where: { id: input.requestId },
        data: {
          assignedToId: input.assignedToId,
          status: "ASSIGNED",
        },
        include: {
          assignedTo: {
            select: { id: true, name: true, role: true },
          },
        },
      });
    }),

  // Get request counts by status (for dashboard)
  counts: protectedProcedure.query(async ({ ctx }) => {
    const isCoordinator = ["ADMIN", "COORDINATOR"].includes(ctx.user.role);

    const whereClause = isCoordinator
      ? {}
      : {
          OR: [
            { requestedById: ctx.user.id },
            { assignedToId: ctx.user.id },
          ],
        };

    const [pending, stat, urgent, resolved] = await Promise.all([
      ctx.prisma.request.count({
        where: { ...whereClause, status: "PENDING" },
      }),
      ctx.prisma.request.count({
        where: { ...whereClause, priority: "STAT", status: { not: "RESOLVED" } },
      }),
      ctx.prisma.request.count({
        where: { ...whereClause, priority: "URGENT", status: { not: "RESOLVED" } },
      }),
      ctx.prisma.request.count({
        where: { ...whereClause, status: "RESOLVED" },
      }),
    ]);

    return { pending, stat, urgent, resolved };
  }),
});
