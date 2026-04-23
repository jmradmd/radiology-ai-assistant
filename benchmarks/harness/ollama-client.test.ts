import test from "node:test";
import assert from "node:assert/strict";
import { streamChat } from "./ollama-client";

function makeStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line));
      }
      controller.close();
    },
  });
}

test("streamChat measures TTFT from first non-whitespace token", async () => {
  const clockValues = [0, 50, 120, 180];
  const fetchImpl: typeof fetch = async () =>
    new Response(
      makeStream([
        '{"message":{"content":"   "}}\n',
        '{"message":{"content":"Hello"}}\n',
        '{"done":true,"eval_count":10,"eval_duration":1000000000,"prompt_eval_duration":500000000}\n',
      ]),
      { status: 200 },
    );

  const result = await streamChat({
    baseUrl: "http://localhost:11434",
    model: "qwen3.5:4b",
    messages: [{ role: "user", content: "ping" }],
    maxTokens: 1,
    temperature: 0,
    fetchImpl,
    now: () => clockValues.shift() ?? 180,
  });

  assert.equal(result.ttftMs, 50);
  assert.equal(result.responseText, "   Hello");
  assert.equal(result.tokensPerSecond, 10);
});
