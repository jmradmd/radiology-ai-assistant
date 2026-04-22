import test from "node:test";
import assert from "node:assert/strict";
import { TRPCError } from "@trpc/server";
import { appRouter } from "../router";
import { createCallerFactory } from "../trpc";

test("rag.benchmarkStream is forbidden when env flag is absent", async () => {
  const previous = process.env.ENABLE_BENCHMARK_ENDPOINT;
  delete process.env.ENABLE_BENCHMARK_ENDPOINT;

  const createCaller = createCallerFactory(appRouter);
  const caller = createCaller({
    prisma: {} as never,
    user: null,
  });

  await assert.rejects(
    () =>
      caller.rag.benchmarkStream({
        query: "What is the contrast reaction management protocol?",
        ollamaModel: "qwen3.5:4b",
      }),
    (error: unknown) =>
      error instanceof TRPCError && error.code === "FORBIDDEN" && error.message === "Benchmark endpoint disabled",
  );

  if (previous) {
    process.env.ENABLE_BENCHMARK_ENDPOINT = previous;
  }
});
