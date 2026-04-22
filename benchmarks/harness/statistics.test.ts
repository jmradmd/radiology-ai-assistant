import test from "node:test";
import assert from "node:assert/strict";
import {
  bootstrapCI,
  holmBonferroni,
  mcnemar,
  minSampleSizeTwoProportions,
  mulberry32,
  pairedBootstrap,
  permutationTest,
} from "./statistics";

test("mulberry32 is deterministic and uniform-ish", () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 100; i += 1) assert.equal(a(), b());
  const rng = mulberry32(7);
  const samples = Array.from({ length: 10_000 }, () => rng());
  const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
  assert.ok(Math.abs(mean - 0.5) < 0.02, `bad mean: ${mean}`);
});

test("bootstrapCI covers the point estimate and brackets known mean", () => {
  const values = Array.from({ length: 50 }, (_, i) => 10 + Math.sin(i) * 3);
  const trueMean = values.reduce((s, v) => s + v, 0) / values.length;
  const ci = bootstrapCI(values, { iterations: 2000, seed: 1, alpha: 0.05 });
  assert.ok(ci.point === trueMean);
  assert.ok(ci.lower <= ci.point && ci.point <= ci.upper);
  assert.ok(ci.upper - ci.lower < 2, `CI too wide: ${ci.upper - ci.lower}`);
});

test("bootstrapCI handles singleton and empty inputs gracefully", () => {
  const single = bootstrapCI([3.14], { seed: 1 });
  assert.equal(single.lower, 3.14);
  assert.equal(single.upper, 3.14);
  const empty = bootstrapCI([], { seed: 1 });
  assert.ok(Number.isNaN(empty.point));
  assert.equal(empty.n, 0);
});

test("bootstrapCI BCa variant returns finite bounds", () => {
  const values = Array.from({ length: 40 }, (_, i) => (i * 37) % 11);
  const ci = bootstrapCI(values, { iterations: 2000, seed: 1, method: "bca" });
  assert.equal(ci.method, "bca");
  assert.ok(Number.isFinite(ci.lower) && Number.isFinite(ci.upper));
  assert.ok(ci.lower <= ci.point && ci.point <= ci.upper);
});

test("pairedBootstrap detects a real difference in paired data", () => {
  const pairs: Array<[number, number]> = Array.from({ length: 40 }, (_, i) => [1 + (i % 3) * 0.1, 0.5 + (i % 3) * 0.1]);
  const result = pairedBootstrap(pairs, { iterations: 2000, seed: 1 });
  assert.ok(result.delta > 0.4, `observed delta too small: ${result.delta}`);
  assert.ok(result.pValue < 0.01, `p-value too large: ${result.pValue}`);
  assert.ok(result.ci.lower > 0);
});

test("pairedBootstrap returns non-significant when pairs are equal", () => {
  const pairs: Array<[number, number]> = Array.from({ length: 20 }, (_, i) => [i, i]);
  const result = pairedBootstrap(pairs, { iterations: 1000, seed: 1 });
  assert.equal(result.delta, 0);
  assert.ok(result.pValue >= 0.5);
});

test("permutationTest rejects for different populations", () => {
  const a = Array.from({ length: 30 }, (_, i) => 1 + (i * 0.01));
  const b = Array.from({ length: 30 }, (_, i) => 2 + (i * 0.01));
  const result = permutationTest(a, b, { iterations: 2000, seed: 1 });
  assert.ok(result.delta < -0.5);
  assert.ok(result.pValue < 0.01);
});

test("mcnemar matches a small hand-computed example", () => {
  // A passes, B fails on 5 items; A fails, B passes on 1 item; rest agree.
  const pairs: Array<[boolean, boolean]> = [
    ...Array.from({ length: 5 }, () => [true, false] as [boolean, boolean]),
    [false, true] as [boolean, boolean],
    ...Array.from({ length: 10 }, () => [true, true] as [boolean, boolean]),
  ];
  const result = mcnemar(pairs);
  assert.equal(result.b, 5);
  assert.equal(result.c, 1);
  // Two-sided exact binomial(6, 0.5) P(X<=1) * 2 = 2 * (1/64 + 6/64) = 14/64 ≈ 0.21875
  assert.ok(Math.abs(result.pValue - 14 / 64) < 1e-9, `p=${result.pValue}`);
});

test("mcnemar handles tied disagreement counts", () => {
  const pairs: Array<[boolean, boolean]> = [
    [true, false],
    [true, false],
    [false, true],
    [false, true],
  ];
  const result = mcnemar(pairs);
  assert.equal(result.b, 2);
  assert.equal(result.c, 2);
  assert.ok(result.pValue > 0.99);
});

test("minSampleSizeTwoProportions matches textbook value for 0.5 vs 0.7", () => {
  const n = minSampleSizeTwoProportions(0.5, 0.7);
  // Classic textbook answer ≈ 93 per arm.
  assert.ok(Math.abs(n - 93) <= 3, `got ${n}`);
});

test("holmBonferroni rejects the smallest p when under alpha/m", () => {
  const pValues = [0.001, 0.01, 0.04, 0.5];
  const results = holmBonferroni(pValues, 0.05);
  assert.equal(results[0].reject, true);
  assert.equal(results[1].reject, true);
  assert.equal(results[3].reject, false);
  // Thresholds: 0.0125, 0.01667, 0.025, 0.05
  assert.ok(Math.abs(results[0].threshold - 0.0125) < 1e-9);
});
