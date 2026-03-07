import test from "node:test";
import assert from "node:assert/strict";
import { classifyIntent, determinePriority } from "./classifier";

test("does not classify gestational as STAT", () => {
  const result = classifyIntent(
    "Positive beta-HCG but no gestational sac on ultrasound. Next step?"
  );

  assert.notEqual(result.intent, "URGENT_STAT");
  assert.equal(determinePriority(result), "ROUTINE");
});

test("classifies explicit stat requests as URGENT_STAT", () => {
  const result = classifyIntent("Need a stat read for code stroke CTA.");

  assert.equal(result.intent, "URGENT_STAT");
  assert.equal(determinePriority(result), "STAT");
});
