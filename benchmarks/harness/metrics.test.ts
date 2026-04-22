import test from "node:test";
import assert from "node:assert/strict";
import { p50, p95 } from "./metrics";

test("p50 handles empty and singleton samples", () => {
  assert.equal(p50([]), null);
  assert.equal(p50([4]), 4);
});

test("p95 handles short samples", () => {
  assert.ok(Math.abs((p95([1, 3]) ?? 0) - 2.9) < 1e-9);
  assert.ok(Math.abs((p95([0, 10, 20, 30]) ?? 0) - 28.5) < 1e-9);
});
