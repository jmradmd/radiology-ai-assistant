import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { createConversationSchema } from "@rad-assist/shared";

export const conversationRouter = router({
  // List user's conversations
  list: protectedProcedure
    .input(
      z.object({
        type: z
          .enum(["DIRECT", "GROUP", "RAG_CHAT", "BROADCAST"])
          .optional(),
        limit: z.number().min(1).max(50).default(20),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const conversations = await ctx.prisma.conversation.findMany({
        where: {
          participants: {
            some: { userId: ctx.user.id },
          },
          ...(input.type && { type: input.type }),
        },
        include: {
          participants: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  avatarUrl: true,
                  role: true,
                },
              },
            },
          },
          messages: {
            take: 1,
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              content: true,
              createdAt: true,
              senderId: true,
            },
          },
        },
        take: input.limit + 1,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        orderBy: { updatedAt: "desc" },
      });

      let nextCursor: string | undefined;
      if (conversations.length > input.limit) {
        const nextItem = conversations.pop();
        nextCursor = nextItem?.id;
      }

      return { conversations, nextCursor };
    }),

  // List RAG chat history with search
  listRagChats: protectedProcedure
    .input(
      z.object({
        search: z.string().optional(),
        limit: z.number().min(1).max(50).default(20),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { search, limit, cursor } = input;
      const searchTerm = search?.trim();

      console.log('[listRagChats] Search term:', searchTerm, 'User ID:', ctx.user.id);

      let conversations;

      if (searchTerm) {
        // Use raw query for reliable full-text search across messages
        // This searches both conversation title and all message content
        // Escape ILIKE wildcards to prevent injection of % and _ characters
        const escaped = searchTerm.replace(/[%_]/g, '\\$&');
        const searchPattern = `%${escaped}%`;
        
        console.log('[listRagChats] Running raw SQL search with pattern:', searchPattern);
        
        try {
          // Use Prisma.sql for proper UUID handling
          const userId = ctx.user.id;
          const results = await ctx.prisma.$queryRaw<Array<{
            id: string;
            title: string | null;
            createdAt: Date;
            updatedAt: Date;
          }>>`
            SELECT DISTINCT c.id, c.title, c."createdAt", c."updatedAt"
            FROM "Conversation" c
            INNER JOIN "ConversationParticipant" cp ON cp."conversationId" = c.id
            LEFT JOIN "Message" m ON m."conversationId" = c.id
            WHERE c.type = 'RAG_CHAT'
              AND cp."userId"::text = ${userId}
              AND (
                c.title ILIKE ${searchPattern}
                OR m.content ILIKE ${searchPattern}
              )
            ORDER BY c."updatedAt" DESC
            LIMIT ${limit + 1}
          `;
          
          console.log('[listRagChats] Raw SQL returned:', results.length, 'results');

          // Get message counts and first messages for the found conversations
          const conversationIds = results.map(r => r.id);
          
          if (conversationIds.length === 0) {
            return { conversations: [], nextCursor: undefined };
          }

          const fullConversations = await ctx.prisma.conversation.findMany({
            where: {
              id: { in: conversationIds },
            },
            include: {
              messages: {
                take: 1,
                orderBy: { createdAt: "asc" },
                select: {
                  content: true,
                  createdAt: true,
                },
              },
              _count: {
                select: { messages: true },
              },
            },
            orderBy: { updatedAt: "desc" },
          });

          conversations = fullConversations;
        } catch (err) {
          console.error('[listRagChats] Raw SQL error:', err);
          // Fall back to Prisma query
          console.log('[listRagChats] Falling back to Prisma query');
          const fallbackConversations = await ctx.prisma.conversation.findMany({
            where: {
              type: "RAG_CHAT",
              participants: {
                some: { userId: ctx.user.id },
              },
              OR: [
                { title: { contains: searchTerm, mode: 'insensitive' } },
                { messages: { some: { content: { contains: searchTerm, mode: 'insensitive' } } } },
              ],
            },
            include: {
              messages: {
                take: 1,
                orderBy: { createdAt: "asc" },
                select: {
                  content: true,
                  createdAt: true,
                },
              },
              _count: {
                select: { messages: true },
              },
            },
            take: limit + 1,
            orderBy: { updatedAt: "desc" },
          });
          conversations = fallbackConversations;
        }
      } else {
        // No search - simple query
        conversations = await ctx.prisma.conversation.findMany({
          where: {
            type: "RAG_CHAT",
            participants: {
              some: { userId: ctx.user.id },
            },
          },
          include: {
            messages: {
              take: 1,
              orderBy: { createdAt: "asc" },
              select: {
                content: true,
                createdAt: true,
              },
            },
            _count: {
              select: { messages: true },
            },
          },
          take: limit + 1,
          cursor: cursor ? { id: cursor } : undefined,
          orderBy: { updatedAt: "desc" },
        });
      }

      let nextCursor: string | undefined;
      if (conversations.length > limit) {
        const nextItem = conversations.pop();
        nextCursor = nextItem?.id;
      }

      return {
        conversations: conversations.map((c) => ({
          id: c.id,
          title:
            c.title ||
            (c.messages[0]?.content.slice(0, 60) + "...") ||
            "New conversation",
          messageCount: c._count.messages,
          createdAt: c.messages[0]?.createdAt || c.createdAt,
          updatedAt: c.updatedAt,
        })),
        nextCursor,
      };
    }),

  // Get RAG chat messages
  getRagChatMessages: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const conversation = await ctx.prisma.conversation.findFirst({
        where: {
          id: input.id,
          type: "RAG_CHAT",
          participants: {
            some: { userId: ctx.user.id },
          },
        },
        include: {
          messages: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              content: true,
              contentType: true,
              metadata: true,
              createdAt: true,
            },
          },
        },
      });

      if (!conversation) {
        return null;
      }

      return {
        id: conversation.id,
        title: conversation.title,
        messages: conversation.messages.map((m) => {
          const metadata = m.metadata as Record<string, unknown> | null;
          const abbreviationOptions = Array.isArray(metadata?.abbreviationOptions)
            ? metadata.abbreviationOptions
                .map((option) =>
                  typeof option === "string" ? option.trim() : ""
                )
                .filter((option) => option.length > 0)
            : undefined;

          return {
            id: m.id,
            role: m.contentType === "RAG_RESPONSE" ? "assistant" : "user",
            content: m.content,
            citations: metadata?.citations || null,
            citationSources: metadata?.citationSources || null,
            verbatimSources: metadata?.verbatimSources || null,
            guidelineContext: metadata?.guidelineContext || null,
            emergencyAssessment: metadata?.emergencyAssessment || null,
            confidence: metadata?.confidence as number | undefined,
            modelInfo: metadata?.modelInfo || null,
            memoryContext: metadata?.memoryContext || null,
            needsAbbreviationClarification:
              metadata?.needsAbbreviationClarification === true,
            abbreviation:
              typeof metadata?.abbreviation === "string"
                ? metadata.abbreviation
                : null,
            abbreviationOptions:
              abbreviationOptions && abbreviationOptions.length > 0
                ? abbreviationOptions
                : null,
            needsTopicClarification: metadata?.needsTopicClarification === true,
            suggestedTopics: Array.isArray(metadata?.suggestedTopics)
              ? metadata.suggestedTopics
              : null,
            timestamp: m.createdAt,
          };
        }),
      };
    }),

  // Delete a conversation
  delete: protectedProcedure
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      // Verify user owns this conversation
      const conversation = await ctx.prisma.conversation.findFirst({
        where: {
          id: input,
          participants: {
            some: { userId: ctx.user.id },
          },
        },
      });

      if (!conversation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }

      await ctx.prisma.conversation.delete({
        where: { id: input },
      });

      return { success: true };
    }),

  // Get single conversation with messages
  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const conversation = await ctx.prisma.conversation.findFirst({
        where: {
          id: input.id,
          participants: {
            some: { userId: ctx.user.id },
          },
        },
        include: {
          participants: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  avatarUrl: true,
                  role: true,
                  subspecialty: true,
                },
              },
            },
          },
        },
      });

      return conversation;
    }),

  // Create new conversation
  create: protectedProcedure
    .input(createConversationSchema)
    .mutation(async ({ ctx, input }) => {
      // Include current user in participants
      const participantIds = [...new Set([ctx.user.id, ...(input.participantIds || [])])];

      const conversation = await ctx.prisma.conversation.create({
        data: {
          type: input.type,
          title: input.title,
          participants: {
            create: participantIds.map((userId) => ({
              userId,
              isAdmin: userId === ctx.user.id,
            })),
          },
        },
        include: {
          participants: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  avatarUrl: true,
                },
              },
            },
          },
        },
      });

      return conversation;
    }),

  // Get or create direct conversation with another user
  getOrCreateDirect: protectedProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Find existing direct conversation
      const existing = await ctx.prisma.conversation.findFirst({
        where: {
          type: "DIRECT",
          AND: [
            { participants: { some: { userId: ctx.user.id } } },
            { participants: { some: { userId: input.userId } } },
          ],
        },
        include: {
          participants: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  avatarUrl: true,
                },
              },
            },
          },
        },
      });

      if (existing) return existing;

      // Create new conversation
      return ctx.prisma.conversation.create({
        data: {
          type: "DIRECT",
          participants: {
            create: [{ userId: ctx.user.id }, { userId: input.userId }],
          },
        },
        include: {
          participants: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  avatarUrl: true,
                },
              },
            },
          },
        },
      });
    }),

  // Mark conversation as read
  markRead: protectedProcedure
    .input(z.object({ conversationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.conversationParticipant.update({
        where: {
          conversationId_userId: {
            conversationId: input.conversationId,
            userId: ctx.user.id,
          },
        },
        data: { lastReadAt: new Date() },
      });
    }),

  // Create RAG chat conversation
  createRagChat: protectedProcedure.mutation(async ({ ctx }) => {
    return ctx.prisma.conversation.create({
      data: {
        type: "RAG_CHAT",
        title: "Assistant",
        participants: {
          create: [{ userId: ctx.user.id }],
        },
      },
    });
  }),
});
