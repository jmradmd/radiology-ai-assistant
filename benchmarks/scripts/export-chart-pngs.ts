#!/usr/bin/env npx tsx
/**
 * Rasterize benchmark report SVG charts to PNG.
 *
 * Previously this script tried to disable the dark-mode media query so that
 * resvg would pick up the :root light-mode CSS custom properties. That did not
 * work — resvg's CSS support does not resolve `var(--fg)` across the document,
 * so every text element rendered with no fill and came out invisible.
 *
 * The robust fix: strip the entire <style> block and inline concrete light-mode
 * colors onto every element that referenced a chart-* class. After that, resvg
 * only needs to handle fill/stroke attributes, which it does correctly. This
 * does not modify the SVG source files — the transformation is done in memory.
 */
import { Resvg } from "@resvg/resvg-js";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "fs";
import { basename, dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ASSET_DIR = resolve(
  __dirname,
  "..",
  "published",
  "2026-04-23T01-44-13-984Z",
  "report-assets",
);
const PNG_DIR = resolve(ASSET_DIR, "png");
const SCALE = 2;

// ── Light-mode color inlining ────────────────────────────────────────────────

const CLASS_ATTRS: Record<string, Record<string, string>> = {
  "chart-bg": { fill: "#FFFFFF" },
  "chart-title": {
    fill: "#111827",
    "font-size": "22",
    "font-weight": "700",
  },
  "chart-subtitle": {
    fill: "#6B7280",
    "font-size": "14",
    "font-weight": "400",
  },
  "chart-axis-title": {
    fill: "#111827",
    "font-size": "14",
    "font-weight": "600",
  },
  "chart-tick": { fill: "#4B5563", "font-size": "12", "font-weight": "400" },
  "chart-value-label": {
    fill: "#111827",
    "font-size": "11",
    "font-weight": "600",
  },
  "chart-bar-value-label": {
    fill: "#111827",
    "font-size": "11",
    "font-weight": "600",
  },
  "chart-point-label": {
    fill: "#111827",
    "font-size": "12",
    "font-weight": "500",
  },
  "chart-legend-label": {
    fill: "#4B5563",
    "font-size": "13",
    "font-weight": "500",
  },
  "chart-note": { fill: "#6B7280", "font-size": "11", "font-weight": "400" },
  "chart-value-pill": { fill: "#FFFFFF" },
  "chart-legend-box": {
    fill: "#FFFFFF",
    stroke: "#E5E7EB",
    "stroke-width": "1",
  },
  "chart-acceptable-zone": { fill: "#F0FDF4", "fill-opacity": "0.3" },
  "chart-acceptable-label": {
    fill: "#166534",
    "font-size": "11",
    "font-weight": "600",
  },
  "chart-zero-baseline": { stroke: "#D1D5DB", "stroke-width": "1.5" },
  "chart-gridline": { stroke: "#F3F4F6", "stroke-width": "1" },
  "chart-axis": { stroke: "#6B7280", "stroke-width": "1" },
  "chart-gate": {
    stroke: "#B91C1C",
    "stroke-width": "1.5",
    "stroke-dasharray": "6,4",
  },
  "chart-gate-label": {
    fill: "#B91C1C",
    "font-size": "11",
    "font-weight": "600",
  },
  "chart-bar-light": { fill: "#4C78A8" },
  "chart-bar-medium": { fill: "#E45756" },
  "chart-bar-heavy": { fill: "#54A24B" },
  "chart-line": { fill: "none", "stroke-width": "2" },
  "chart-errbar": { stroke: "#111827", "stroke-width": "1.5" },
  "chart-scatter-stroke": { stroke: "#FFFFFF", "stroke-width": "1.5" },
  "chart-zone": { fill: "#D1FAE5", "fill-opacity": "0.5" },
  "chart-zone-label": {
    fill: "#166534",
    "font-size": "12",
    "font-weight": "600",
  },
};

function stripStyleBlock(svg: string): string {
  return svg.replace(/<style[\s\S]*?<\/style>/g, "");
}

// Some elements inline `fill="var(--bg)"` / `stroke="var(--grid)"` directly as
// attributes (e.g. the ECDF legend background rect). resvg cannot resolve
// these once the <style> block is stripped, so replace each var() reference
// with its concrete light-mode color.
const VAR_COLORS: Record<string, string> = {
  "--bg": "#FFFFFF",
  "--fg": "#111827",
  "--fg2": "#4B5563",
  "--subtitle": "#6B7280",
  "--axis": "#6B7280",
  "--grid": "#F3F4F6",
  "--legend-border": "#E5E7EB",
  "--tier-light": "#4C78A8",
  "--tier-medium": "#E45756",
  "--tier-heavy": "#54A24B",
  "--gate": "#B91C1C",
  "--zone-fill": "#D1FAE5",
  "--zone-fill-opacity": "0.5",
  "--zone-text": "#166534",
};

function inlineVarReferences(svg: string): string {
  return svg.replace(/var\((--[a-z0-9-]+)\)/gi, (match, name) => {
    return VAR_COLORS[name] ?? match;
  });
}

function inlineClassStyles(svg: string): string {
  // Match every element opening tag that has a `class="..."` attribute.
  // Group 1 = tag name, 2 = attrs before class, 3 = class value, 4 = attrs
  // after class, 5 = optional `/` for self-closing.
  const re = /<(\w[\w-]*)\b([^>]*?)\s+class="([^"]*)"([^>]*?)(\/?)>/g;
  return svg.replace(re, (_match, tag, pre, classValue, post, selfClose) => {
    const classes = String(classValue)
      .split(/\s+/)
      .filter(Boolean);
    const newAttrs: Record<string, string> = {};
    for (const cls of classes) {
      const mapping = CLASS_ATTRS[cls];
      if (!mapping) continue;
      for (const [k, v] of Object.entries(mapping)) {
        if (!(k in newAttrs)) newAttrs[k] = v;
      }
    }

    // Collect existing attribute names from the rest of the tag so we don't
    // overwrite something the SVG generator already set inline (e.g. a path
    // with explicit stroke="#4C78A8" for a specific line color).
    const otherAttrs = `${pre} ${post}`;
    const existingAttrNames = new Set<string>();
    const nameRe = /\s([\w:-]+)\s*=\s*"/g;
    let m: RegExpExecArray | null;
    while ((m = nameRe.exec(otherAttrs)) !== null) {
      existingAttrNames.add(m[1]);
    }

    const injected: string[] = [];
    for (const [k, v] of Object.entries(newAttrs)) {
      if (existingAttrNames.has(k)) continue;
      injected.push(`${k}="${v}"`);
    }

    const injectedStr = injected.length > 0 ? ` ${injected.join(" ")}` : "";
    return `<${tag}${pre}${injectedStr}${post}${selfClose}>`;
  });
}

function ensureBackgroundRect(svg: string): string {
  // If a chart-bg rect was already inlined to fill="#FFFFFF" we're fine. But
  // if for some reason none exists, inject one as the first child of <svg>.
  if (/fill="#FFFFFF"[^>]*\/>\s*<text/.test(svg)) return svg;
  return svg.replace(/(<svg[^>]*>)/, `$1<rect width="100%" height="100%" fill="#FFFFFF"/>`);
}

function prepareSvg(raw: string): string {
  const withoutStyle = stripStyleBlock(raw);
  const varsResolved = inlineVarReferences(withoutStyle);
  const classesInlined = inlineClassStyles(varsResolved);
  return ensureBackgroundRect(classesInlined);
}

// ── Pixel-level validation ───────────────────────────────────────────────────

interface RenderedPixels {
  width: number;
  height: number;
  pixels: Uint8Array;
}

function sampleBoxStats(
  img: RenderedPixels,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): { mean: [number, number, number]; darkFraction: number; total: number } {
  let r = 0;
  let g = 0;
  let b = 0;
  let dark = 0;
  let total = 0;
  const xClampStart = Math.max(0, Math.floor(x0));
  const yClampStart = Math.max(0, Math.floor(y0));
  const xClampEnd = Math.min(img.width, Math.floor(x1));
  const yClampEnd = Math.min(img.height, Math.floor(y1));
  for (let y = yClampStart; y < yClampEnd; y += 1) {
    for (let x = xClampStart; x < xClampEnd; x += 1) {
      const idx = (y * img.width + x) * 4;
      const pr = img.pixels[idx];
      const pg = img.pixels[idx + 1];
      const pb = img.pixels[idx + 2];
      r += pr;
      g += pg;
      b += pb;
      if (pr < 150 && pg < 150 && pb < 150) dark += 1;
      total += 1;
    }
  }
  if (total === 0) {
    return { mean: [0, 0, 0], darkFraction: 0, total: 0 };
  }
  return {
    mean: [r / total, g / total, b / total],
    darkFraction: dark / total,
    total,
  };
}

interface ValidationResult {
  name: string;
  ok: boolean;
  checks: Array<{ name: string; pass: boolean; detail: string }>;
}

function validateRender(
  name: string,
  img: RenderedPixels,
): ValidationResult {
  const checks: ValidationResult["checks"] = [];
  // Corner (padding) — should be near-white
  const corner = sampleBoxStats(img, 5, 5, 80, 80);
  const cornerWhite =
    corner.mean[0] > 240 && corner.mean[1] > 240 && corner.mean[2] > 240;
  checks.push({
    name: "corner is near-white",
    pass: cornerWhite,
    detail: `mean RGB = (${corner.mean.map((v) => v.toFixed(0)).join(", ")})`,
  });

  // Top-center (title region) — should contain dark text pixels
  const titleBox = sampleBoxStats(
    img,
    img.width * 0.1,
    img.height * 0.02,
    img.width * 0.9,
    img.height * 0.1,
  );
  const titleHasText = titleBox.darkFraction > 0.005;
  checks.push({
    name: "title region has dark text pixels",
    pass: titleHasText,
    detail: `darkFraction = ${(titleBox.darkFraction * 100).toFixed(3)}%`,
  });

  // Bottom-left axis labels — should contain SOME dark pixels (text glyphs).
  // Mean RGB is a bad metric here because small text glyphs in a large
  // whitespace region pull the mean close to 255 even when text is present.
  // Use darkFraction instead (any non-trivial dark pixels = text rendered).
  const axisBox = sampleBoxStats(
    img,
    img.width * 0.02,
    img.height * 0.7,
    img.width * 0.18,
    img.height * 0.98,
  );
  const axisHasInk = axisBox.darkFraction > 0.0005;
  checks.push({
    name: "axis label region has text glyphs",
    pass: axisHasInk,
    detail: `darkFraction = ${(axisBox.darkFraction * 100).toFixed(4)}%`,
  });

  // Full image — overall ink proportion sanity check. Even the sparsest chart
  // (a reliability bar chart with 5 dimensions) should have > 0.5% dark pixels.
  const full = sampleBoxStats(img, 0, 0, img.width, img.height);
  const fullHasContent = full.darkFraction > 0.005;
  checks.push({
    name: "overall image has non-trivial content",
    pass: fullHasContent,
    detail: `darkFraction = ${(full.darkFraction * 100).toFixed(3)}%`,
  });

  return {
    name,
    ok: checks.every((c) => c.pass),
    checks,
  };
}

// ── Main render loop ─────────────────────────────────────────────────────────

function renderSvgToPng(
  svgString: string,
): { png: Buffer; pixels: RenderedPixels } {
  const resvg = new Resvg(svgString, {
    background: "#FFFFFF",
    fitTo: { mode: "zoom", value: SCALE },
    font: { loadSystemFonts: true },
  });
  const rendered = resvg.render();
  const png = rendered.asPng();
  const pixels: RenderedPixels = {
    width: rendered.width,
    height: rendered.height,
    pixels: new Uint8Array(rendered.pixels),
  };
  return { png, pixels };
}

function main(): void {
  if (!existsSync(ASSET_DIR)) {
    console.error(`Assets directory not found: ${ASSET_DIR}`);
    process.exit(1);
  }
  mkdirSync(PNG_DIR, { recursive: true });

  const svgs = readdirSync(ASSET_DIR)
    .filter((name) => name.endsWith(".svg"))
    .sort();

  if (svgs.length === 0) {
    console.error(`No SVG files found in ${ASSET_DIR}`);
    process.exit(1);
  }

  const allResults: Array<{
    name: string;
    bytes: number;
    validation: ValidationResult;
  }> = [];
  const allOk = { value: true };

  for (const name of svgs) {
    const sourcePath = resolve(ASSET_DIR, name);
    const targetPath = resolve(PNG_DIR, name.replace(/\.svg$/, ".png"));
    const raw = readFileSync(sourcePath, "utf-8");
    const prepared = prepareSvg(raw);
    const { png, pixels } = renderSvgToPng(prepared);
    writeFileSync(targetPath, png);
    const size = statSync(targetPath).size;
    const validation = validateRender(basename(targetPath), pixels);
    allResults.push({ name: basename(targetPath), bytes: size, validation });
    if (!validation.ok) allOk.value = false;
    console.log(
      `  ${validation.ok ? "✓" : "✗"} ${basename(targetPath)}  ${(size / 1024).toFixed(1)} KB  ${pixels.width}×${pixels.height}`,
    );
    for (const c of validation.checks) {
      console.log(`      ${c.pass ? "·" : "!"} ${c.name}: ${c.detail}`);
    }
  }

  console.log(
    `\nRendered ${allResults.length} chart${allResults.length === 1 ? "" : "s"} to ${PNG_DIR}`,
  );
  if (!allOk.value) {
    const diagnosticPath = "/tmp/png-export-diagnostic.md";
    const lines: string[] = [];
    lines.push("# PNG Export Diagnostic");
    lines.push("");
    lines.push(`One or more chart validations failed. See details below.`);
    lines.push("");
    for (const r of allResults) {
      lines.push(`## ${r.name} (${r.validation.ok ? "OK" : "FAIL"})`);
      lines.push("");
      for (const c of r.validation.checks) {
        lines.push(`- ${c.pass ? "PASS" : "FAIL"} — ${c.name}: ${c.detail}`);
      }
      lines.push("");
    }
    writeFileSync(diagnosticPath, lines.join("\n"));
    console.error(`\nValidation failed. See ${diagnosticPath}`);
    process.exit(2);
  }
}

main();
