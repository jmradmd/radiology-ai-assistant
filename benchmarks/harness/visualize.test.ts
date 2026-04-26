import test from "node:test";
import assert from "node:assert/strict";
import {
  PALETTE,
  renderBarWithErrors,
  renderEcdf,
  renderHeatmap,
  renderScatterWithCI,
  renderStackedStages,
  renderReliabilityBars,
} from "./visualize";

test("renderBarWithErrors emits well-formed SVG with error bars", () => {
  const svg = renderBarWithErrors(
    "Pass rate",
    [
      { label: "qwen3.5:4b", value: 0.72, lower: 0.65, upper: 0.78, group: "light" },
      { label: "gemma4:e2b", value: 0.55, lower: 0.48, upper: 0.61, group: "light" },
    ],
    { yLabel: "pass rate", asPercent: true },
  );
  assert.match(svg, /^<svg /);
  assert.match(svg, /<\/svg>$/);
  assert.match(svg, /Pass rate/);
  assert.match(svg, /qwen3.5:4b/);
  assert.match(svg, /gemma4:e2b/);
  // Error bars render with CSS class chart-errbar. Expect at least 6 lines
  // (2 bars × 3 segments each: vertical, top cap, bottom cap).
  const capCount = (svg.match(/class="chart-errbar"/g) ?? []).length;
  assert.ok(capCount >= 6, `expected >=6 error-bar segments, got ${capCount}`);
});

test("renderBarWithErrors handles empty input without crashing", () => {
  const svg = renderBarWithErrors("Empty", [], {});
  assert.match(svg, /^<svg /);
  assert.match(svg, /<\/svg>$/);
});

test("renderEcdf draws paths for each series and respects threshold line", () => {
  const svg = renderEcdf(
    "TTFT CDF",
    [
      { label: "A", values: [0.1, 0.2, 0.3, 0.5, 0.8], group: "light" },
      { label: "B", values: [0.05, 0.15, 0.35, 0.6, 1.1], group: "medium" },
    ],
    { thresholdLine: 1, xMin: 0.05, xMax: 1.5 },
  );
  const pathCount = (svg.match(/<path /g) ?? []).length;
  assert.equal(pathCount, 2);
  assert.match(svg, /1s gate/);
});

test("renderScatterWithCI omits CI segments when not provided", () => {
  const svg = renderScatterWithCI(
    "Latency vs pass",
    [
      { label: "A", x: 5, y: 0.7, group: "light" },
      { label: "B", x: 10, y: 0.9, group: "medium" },
    ],
    { xLabel: "seconds", yLabel: "pass rate" },
  );
  assert.match(svg, /<circle /);
});

test("renderScatterWithCI renders CI bars when provided", () => {
  const svg = renderScatterWithCI(
    "Latency vs pass",
    [
      { label: "A", x: 5, y: 0.7, yLower: 0.6, yUpper: 0.8, xLower: 4, xUpper: 6, group: "light" },
    ],
    { xLabel: "s", yLabel: "pass" },
  );
  // CI bars are rendered as <line> with opacity 0.55 — one for each axis.
  const ciCount = (svg.match(/opacity="0.55"/g) ?? []).length;
  assert.equal(ciCount, 2);
});

test("renderHeatmap colors all cells and includes axis labels", () => {
  const svg = renderHeatmap(
    "Model × Category pass rate",
    [
      { row: "qwen3.5:4b", column: "factual", value: 0.8 },
      { row: "qwen3.5:4b", column: "refusal", value: 0.4 },
      { row: "gemma4:e2b", column: "factual", value: 0.6 },
      { row: "gemma4:e2b", column: "refusal", value: 0.7 },
    ],
    { rowLabel: "Model", columnLabel: "Category", asPercent: true },
  );
  assert.match(svg, /Model/);
  assert.match(svg, /Category/);
  const cellCount = (svg.match(/<rect /g) ?? []).length;
  assert.ok(cellCount >= 4);
});

test("renderStackedStages stacks stage values in order", () => {
  const svg = renderStackedStages(
    "Stage latency",
    [
      { label: "qwen3.5:4b", stages: { phi: 5, retrieval: 40, llm: 2000 } },
      { label: "gemma4:e2b", stages: { phi: 3, retrieval: 55, llm: 1800 } },
    ],
    ["phi", "retrieval", "llm"],
  );
  assert.match(svg, /Stage latency/);
  const rectCount = (svg.match(/<rect /g) ?? []).length;
  assert.ok(rectCount >= 6);
});

test("renderReliabilityBars emits bars with kappa values", () => {
  const svg = renderReliabilityBars(
    "Inter-rater reliability",
    [
      { dimension: "accuracy", kappa: 0.83 },
      { dimension: "hallucination", kappa: 0.61 },
    ],
    { threshold: 0.6 },
  );
  assert.match(svg, /Inter-rater reliability/);
  assert.match(svg, /0\.83/);
  assert.match(svg, /accuracy/);
});

test("palette has at least 8 color-blind-safe colors", () => {
  assert.ok(PALETTE.length >= 8);
  for (const color of PALETTE) assert.match(color, /^#[0-9A-Fa-f]{6}$/);
});
