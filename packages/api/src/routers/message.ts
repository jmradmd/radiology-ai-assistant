import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { sendMessageSchema } from "@rad-assist/shared";
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

export const messageRouter = router({
  // Get messages for a conversation
  list: protectedProcedure
    .input(
      z.object({
        conversationId: z.string().uuid(),
        limit: z.number().min(1).max(100).default(50),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      // Verify user is participant
      const participant = await ctx.prisma.conversationParticipant.findUnique({
        where: {
          conversationId_userId: {
            conversationId: input.conversationId,
            userId: ctx.user.id,
          },
        },
      });

      if (!participant) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are not a participant in this conversation",
        });
      }

      const messages = await ctx.prisma.message.findMany({
        where: { conversationId: input.conversationId },
        include: {
          sender: {
            select: {
              id: true,
              name: true,
              avatarUrl: true,
              role: true,
            },
          },
        },
        take: input.limit + 1,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        orderBy: { createdAt: "desc" },
      });

      let nextCursor: string | undefined;
      if (messages.length > input.limit) {
        const nextItem = messages.pop();
        nextCursor = nextItem?.id;
      }

      // Reverse to get chronological order
      return { messages: messages.reverse(), nextCursor };
    }),

  // Send a message
  send: protectedProcedure
    .input(sendMessageSchema.extend({ phiOverrides: z.array(phiOverrideSelectionSchema).optional() }))
    .mutation(async ({ ctx, input }) => {
      // Verify user is participant
      const participant = await ctx.prisma.conversationParticipant.findUnique({
        where: {
          conversationId_userId: {
            conversationId: input.conversationId,
            userId: ctx.user.id,
          },
        },
      });

      if (!participant) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are not a participant in this conversation",
        });
      }

      const phiResult = detectPotentialPHI(input.content);
      const typedOverrides = (input.phiOverrides ?? []) as PHIOverrideSelection[];
      const unresolvedSpans = getUnresolvedBlockingSpans(phiResult, typedOverrides);
      const blocked = unresolvedSpans.length > 0 || (phiResult.hasPHI && !isOverridableBlock(phiResult));

      if (phiResult.hasPHI) {
        try {
          await logPHIDetectionEvent({
            prisma: ctx.prisma,
            userId: ctx.user?.id || null,
            endpoint: "message.send",
            phiResult,
            overrides: typedOverrides,
          });
        } catch (logError) {
          console.error("Failed to log PHI detection for message:", logError);
        }
      }

      if (blocked) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Protected health information detected. Hover over highlighted text and explicitly override each blocked item to continue.",
        });
      }

      // Create message and update conversation
      const [message] = await ctx.prisma.$transaction([
        ctx.prisma.message.create({
          data: {
            conversationId: input.conversationId,
            senderId: ctx.user.id,
            content: input.content,
            contentType: input.type,
            metadata: input.metadata as any, // Prisma JSON type compatibility
          },
          include: {
            sender: {
              select: {
                id: true,
                name: true,
                avatarUrl: true,
                role: true,
              },
            },
          },
        }),
        ctx.prisma.conversation.update({
          where: { id: input.conversationId },
          data: { updatedAt: new Date() },
        }),
      ]);

      return message;
    }),

  // Get unread count for user
  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    const conversations = await ctx.prisma.conversationParticipant.findMany({
      where: { userId: ctx.user.id },
      include: {
        conversation: {
          include: {
            messages: {
              where: {
                senderId: { not: ctx.user.id },
              },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        },
      },
    });

    let unreadCount = 0;
    for (const participant of conversations) {
      const lastMessage = participant.conversation.messages[0];
      if (lastMessage && (!participant.lastReadAt || lastMessage.createdAt > participant.lastReadAt)) {
        unreadCount++;
      }
    }

    return { unreadCount };
  }),
});
