import test from "node:test";
import assert from "node:assert/strict";
import { scoreBenchmarkResponse } from "./judge";

test("judge schema rejects malformed output and returns null scores after retries", async () => {
  const sleeps: number[] = [];
  const result = await scoreBenchmarkResponse(
    {
      queryId: "bench-judge-001",
      query: "What is LI-RADS?",
      expected: {},
      sources: [],
      responseText: "LI-RADS is a liver reporting system.",
      judgeConfig: {
        judge_model: "claude-opus",
        backup_judge_model: "gpt-5.2",
        temperature: 0,
        max_tokens: 100,
        rubric: {},
      },
      maxSourceChars: 1000,
    },
    {
      generateCompletionFn: async () => ({
        content: '{"accuracy": 99}',
        provider: "anthropic",
        model: "claude-opus-4-6",
      }),
      sleepFn: async (ms) => {
        sleeps.push(ms);
      },
      now: (() => {
        let value = 0;
        return () => {
          value += 100;
          return value;
        };
      })(),
    },
  );

  assert.equal(result.judge_scores.accuracy, null);
  assert.deepEqual(sleeps, [2000, 5000, 15000]);
});
