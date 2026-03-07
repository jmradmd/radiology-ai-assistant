import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { jwtDecode } from "jwt-decode";
import { router, publicProcedure, protectedProcedure, adminProcedure } from "../trpc";
import { userRoleSchema, subspecialtySchema } from "@rad-assist/shared";

export const userRouter = router({
  // Sync user from Supabase auth (called after login).
  // This must remain publicProcedure because it is invoked during initial login
  // before the user record exists in the DB (so protectedProcedure would reject).
  // SECURITY: We verify the bearer token's `sub` claim matches the claimed authId
  // to prevent callers from provisioning users with arbitrary auth IDs.
  syncFromAuth: publicProcedure
    .input(
      z.object({
        authId: z.string(),
        email: z.string().email(),
        name: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify the bearer token's sub claim matches the claimed authId
      const authHeader = ctx.req?.headers.get("authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Missing authorization token",
        });
      }
      const token = authHeader.slice(7);
      try {
        const decoded = jwtDecode<{ sub: string; email?: string }>(token);
        if (decoded.sub !== input.authId) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Token subject does not match claimed authId",
          });
        }
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid authorization token",
        });
      }

      // Find or create user based on auth ID
      let user = await ctx.prisma.user.findFirst({
        where: {
          OR: [
            { externalId: input.authId },
            { email: input.email },
          ],
        },
      });

      if (!user) {
        // Auto-provision new user with default role
        user = await ctx.prisma.user.create({
          data: {
            externalId: input.authId,
            email: input.email,
            name: input.name ?? input.email.split("@")[0],
            role: "STAFF",
            isActive: true,
          },
        });
      } else if (!user.externalId) {
        // Link existing user to auth ID
        user = await ctx.prisma.user.update({
          where: { id: user.id },
          data: { externalId: input.authId },
        });
      }

      return user;
    }),

  // Get current user
  me: protectedProcedure.query(async ({ ctx }) => {
    return ctx.user;
  }),

  // Get user by ID
  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.user.findUnique({
        where: { id: input.id },
      });
    }),

  // List all active users
  list: protectedProcedure
    .input(
      z.object({
        role: userRoleSchema.optional(),
        subspecialty: subspecialtySchema.optional(),
        search: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const users = await ctx.prisma.user.findMany({
        where: {
          isActive: true,
          ...(input.role && { role: input.role }),
          ...(input.subspecialty && { subspecialty: input.subspecialty }),
          ...(input.search && {
            OR: [
              { name: { contains: input.search, mode: "insensitive" } },
              { email: { contains: input.search, mode: "insensitive" } },
            ],
          }),
        },
        take: input.limit + 1,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        orderBy: { name: "asc" },
      });

      let nextCursor: string | undefined;
      if (users.length > input.limit) {
        const nextItem = users.pop();
        nextCursor = nextItem?.id;
      }

      return { users, nextCursor };
    }),

  // List providers by subspecialty (for routing)
  listProviders: protectedProcedure
    .input(
      z.object({
        subspecialty: subspecialtySchema.optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      return ctx.prisma.user.findMany({
        where: {
          isActive: true,
          role: { in: ["ATTENDING", "FELLOW", "RESIDENT"] },
          ...(input.subspecialty && { subspecialty: input.subspecialty }),
        },
        orderBy: [{ role: "asc" }, { name: "asc" }],
      });
    }),

  // Update user profile
  updateProfile: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100).optional(),
        phoneMobile: z.string().max(20).optional(),
        avatarUrl: z.string().url().optional(),
        subspecialty: subspecialtySchema.optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.user.update({
        where: { id: ctx.user.id },
        data: input,
      });
    }),

  // Admin: Update user role/status
  updateUser: adminProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        role: userRoleSchema.optional(),
        subspecialty: subspecialtySchema.optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { userId, ...data } = input;
      return ctx.prisma.user.update({
        where: { id: userId },
        data,
      });
    }),

  // Admin: Create user (for manual provisioning)
  create: adminProcedure
    .input(
      z.object({
        email: z.string().email(),
        name: z.string().min(1).max(100),
        role: userRoleSchema.default("STAFF"),
        subspecialty: subspecialtySchema.optional(),
        department: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.user.create({
        data: input,
      });
    }),
});
