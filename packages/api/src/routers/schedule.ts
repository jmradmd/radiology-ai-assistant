import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, coordinatorProcedure } from "../trpc";
import {
  createScheduleSchema,
  createScheduleAssignmentSchema,
  shiftTypeSchema,
  subspecialtySchema,
} from "@rad-assist/shared";

export const scheduleRouter = router({
  // Get on-call providers for current time
  getCurrentOnCall: protectedProcedure
    .input(
      z.object({
        subspecialty: subspecialtySchema.optional(),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const subspecialtyFilter = input?.subspecialty;
      const now = new Date();
      const currentTime = now.toTimeString().slice(0, 5); // "HH:MM"
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      // Handle overnight shifts (startTime > endTime, e.g. 22:00-07:00):
      // Use raw SQL for the schedule lookup because Prisma cannot express
      // column-to-column comparisons (endTime < startTime) needed for overnight detection.
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      const matchingIds = await ctx.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Schedule"
        WHERE
          -- Normal (non-overnight) shifts active today
          (
            "effectiveDate" = ${today}
            AND "startTime" <= ${currentTime}
            AND "endTime" >= ${currentTime}
            AND "endTime" >= "startTime"
          )
          OR
          -- Overnight shifts that started today (endTime < startTime means wraps past midnight)
          -- Active when currentTime >= startTime (the late-night portion before midnight)
          (
            "effectiveDate" = ${today}
            AND "endTime" < "startTime"
            AND "startTime" <= ${currentTime}
          )
          OR
          -- Overnight shifts from yesterday still active (early-morning portion)
          -- Active when currentTime <= endTime and the shift is overnight
          (
            "effectiveDate" = ${yesterday}
            AND "endTime" < "startTime"
            AND "endTime" >= ${currentTime}
          )
      `;

      const scheduleIds = matchingIds.map((r) => r.id);

      const schedules = await ctx.prisma.schedule.findMany({
        where: {
          id: { in: scheduleIds },
        },
        include: {
          assignments: {
            where: {
              ...(subspecialtyFilter && { subspecialty: subspecialtyFilter }),
            },
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  role: true,
                  subspecialty: true,
                  phoneMobile: true,
                  phonePager: true,
                },
              },
            },
            orderBy: [{ isPrimary: "desc" }],
          },
        },
      });

      // Flatten to list of on-call providers
      const onCallProviders = schedules.flatMap((schedule) =>
        schedule.assignments.map((assignment) => ({
          ...assignment.user,
          shiftType: schedule.shiftType,
          location: schedule.location,
          isPrimary: assignment.isPrimary,
          coverageType: assignment.coverageType,
          subspecialty: assignment.subspecialty,
        }))
      );

      return onCallProviders;
    }),

  // Get schedule for a date range
  getSchedule: protectedProcedure
    .input(
      z.object({
        startDate: z.string().datetime(),
        endDate: z.string().datetime(),
        subspecialty: subspecialtySchema.optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      return ctx.prisma.schedule.findMany({
        where: {
          effectiveDate: {
            gte: new Date(input.startDate),
            lte: new Date(input.endDate),
          },
        },
        include: {
          assignments: {
            where: {
              ...(input.subspecialty && { subspecialty: input.subspecialty }),
            },
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  role: true,
                  subspecialty: true,
                },
              },
            },
          },
        },
        orderBy: [{ effectiveDate: "asc" }, { startTime: "asc" }],
      });
    }),

  // Create schedule (coordinator only)
  create: coordinatorProcedure
    .input(createScheduleSchema)
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.schedule.create({
        data: {
          effectiveDate: new Date(input.effectiveDate),
          shiftType: input.shiftType,
          startTime: input.startTime,
          endTime: input.endTime,
          location: input.location,
        },
      });
    }),

  // Add assignment to schedule (coordinator only)
  addAssignment: coordinatorProcedure
    .input(createScheduleAssignmentSchema)
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.scheduleAssignment.create({
        data: input,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              role: true,
            },
          },
        },
      });
    }),

  // Remove assignment (coordinator only)
  removeAssignment: coordinatorProcedure
    .input(z.object({ assignmentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.scheduleAssignment.delete({
        where: { id: input.assignmentId },
      });
    }),

  // Bulk import schedule (coordinator only)
  bulkImport: coordinatorProcedure
    .input(
      z.object({
        schedules: z.array(
          z.object({
            effectiveDate: z.string().datetime(),
            shiftType: shiftTypeSchema,
            startTime: z.string().regex(/^\d{2}:\d{2}$/),
            endTime: z.string().regex(/^\d{2}:\d{2}$/),
            location: z.string().optional(),
            assignments: z.array(
              z.object({
                userEmail: z.string().email(),
                subspecialty: subspecialtySchema,
                isPrimary: z.boolean().default(true),
                coverageType: z.enum(["ON_SITE", "REMOTE", "ON_CALL"]).default("ON_SITE"),
              })
            ),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const results = {
        created: 0,
        errors: [] as string[],
      };

      for (const scheduleData of input.schedules) {
        try {
          const schedule = await ctx.prisma.schedule.upsert({
            where: {
              effectiveDate_shiftType_location: {
                effectiveDate: new Date(scheduleData.effectiveDate),
                shiftType: scheduleData.shiftType,
                location: scheduleData.location ?? "",
              },
            },
            create: {
              effectiveDate: new Date(scheduleData.effectiveDate),
              shiftType: scheduleData.shiftType,
              startTime: scheduleData.startTime,
              endTime: scheduleData.endTime,
              location: scheduleData.location,
            },
            update: {
              startTime: scheduleData.startTime,
              endTime: scheduleData.endTime,
            },
          });

          for (const assignment of scheduleData.assignments) {
            const user = await ctx.prisma.user.findUnique({
              where: { email: assignment.userEmail },
            });

            if (!user) {
              results.errors.push(`User not found: ${assignment.userEmail}`);
              continue;
            }

            await ctx.prisma.scheduleAssignment.upsert({
              where: {
                scheduleId_userId_subspecialty: {
                  scheduleId: schedule.id,
                  userId: user.id,
                  subspecialty: assignment.subspecialty,
                },
              },
              create: {
                scheduleId: schedule.id,
                userId: user.id,
                subspecialty: assignment.subspecialty,
                isPrimary: assignment.isPrimary,
                coverageType: assignment.coverageType,
              },
              update: {
                isPrimary: assignment.isPrimary,
                coverageType: assignment.coverageType,
              },
            });
          }

          results.created++;
        } catch (error) {
          results.errors.push(`Failed to import schedule for ${scheduleData.effectiveDate}`);
        }
      }

      return results;
    }),

  // Get today's schedule summary (for dashboard)
  todaySummary: protectedProcedure.query(async ({ ctx }) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const schedules = await ctx.prisma.schedule.findMany({
      where: {
        effectiveDate: today,
      },
      include: {
        assignments: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                role: true,
                subspecialty: true,
              },
            },
          },
        },
      },
      orderBy: { startTime: "asc" },
    });

    // Group by subspecialty
    const bySubspecialty: Record<string, typeof schedules[0]["assignments"]> = {};
    for (const schedule of schedules) {
      for (const assignment of schedule.assignments) {
        if (!bySubspecialty[assignment.subspecialty]) {
          bySubspecialty[assignment.subspecialty] = [];
        }
        bySubspecialty[assignment.subspecialty].push(assignment);
      }
    }

    return bySubspecialty;
  }),
});
