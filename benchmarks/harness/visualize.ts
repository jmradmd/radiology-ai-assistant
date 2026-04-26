/**
 * Publication-grade SVG chart generator (v2).
 *
 * Redesign principles:
 *   - Canvas sized per chart type (see DIMS below).
 *   - Margins: 80 top / 60 right / 100 bottom / 100 left.
 *   - Inter-first typography stack, consistent font sizing.
 *   - Tier-aware colour mapping (light/medium/heavy) via semantic palette.
 *   - Dark-mode friendly: colours exposed as CSS custom properties, with a
 *     prefers-color-scheme media query swap inside the <style> block.
 *   - Text rendered as <text> elements (screen-reader-friendly), not paths.
 *   - aria-label on the root, plus <title> + <desc> for accessibility.
 *   - Every datum includes data-* attributes for programmatic inspection.
 *
 * Statistics are NOT computed here — they are injected by generate-report.ts
 * (bootstrap CIs, McNemar, Holm-Bonferroni). This module only renders.
 */

export interface ChartDimensions {
  width: number;
  height: number;
  padding: { top: number; right: number; bottom: number; left: number };
}

const DEFAULT_DIMS: ChartDimensions = {
  width: 1200,
  height: 700,
  padding: { top: 92, right: 60, bottom: 100, left: 100 },
};

const BAR_DIMS: ChartDimensions = {
  width: DEFAULT_DIMS.width,
  height: DEFAULT_DIMS.height,
  padding: { ...DEFAULT_DIMS.padding, right: DEFAULT_DIMS.padding.right + 30 },
};

const HEATMAP_DIMS: ChartDimensions = {
  width: 1400,
  height: 880,
  padding: { top: 192, right: 120, bottom: 100, left: 220 },
};

const ECDF_DIMS: ChartDimensions = {
  width: 1200,
  height: 680,
  padding: { top: 92, right: 60, bottom: 120, left: 100 },
};

// Stacked-stage bars need extra left padding because warm-run model tags
// can reach 17+ characters (e.g. "qwen3.5:122b-a10b"). DEFAULT_DIMS.left = 100
// clips the first 2–3 characters at 12px Inter.
const STAGE_DIMS: ChartDimensions = {
  width: 1200,
  height: 700,
  padding: { top: 92, right: 60, bottom: 100, left: 160 },
};

// Backwards-compat palette (kept for any legacy callers). Internal callers
// should use semantic TIER_COLORS below.
export const PALETTE = [
  "#4C78A8",
  "#E45756",
  "#54A24B",
  "#F2A93B",
  "#79706E",
  "#72B7B2",
  "#B279A2",
  "#FF9DA7",
  "#9D755D",
];

export const TIER_COLORS: Record<"light" | "medium" | "heavy", string> = {
  light: "#4C78A8",
  medium: "#E45756",
  heavy: "#54A24B",
};

const PRIMARY_TEXT = "#111827";
const SECONDARY_TEXT = "#4B5563";
const SUBTITLE_TEXT = "#6B7280";
const AXIS = "#6B7280";
const GRID = "#F3F4F6";
const LEGEND_BORDER = "#E5E7EB";
const GATE = "#B91C1C";
const DEPLOYABLE_ZONE = "#D1FAE5";
const DEPLOYABLE_ZONE_OPACITY = "0.5";
const TITLE_Y = 46;
const SUBTITLE_Y = 70;
const LEGEND_BASELINE_Y = TITLE_Y + 32;
const AXIS_TITLE_OFFSET = 40;

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return escapeText(String(s));
}

function roundTo(value: number, digits: number): string {
  if (!Number.isFinite(value)) return "n/a";
  const factor = 10 ** digits;
  return String(Math.round(value * factor) / factor);
}

function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min];
  const range = max - min;
  const rough = range / count;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalized = rough / pow;
  const step = (normalized < 1.5 ? 1 : normalized < 3 ? 2 : normalized < 7 ? 5 : 10) * pow;
  const start = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + 1e-9; v += step) out.push(Number(v.toFixed(12)));
  return out;
}

function logTicks(min: number, max: number): number[] {
  const candidates = [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
  return candidates.filter((t) => t >= min * 0.99 && t <= max * 1.01);
}

function formatLogTick(value: number): string {
  if (value < 0.01) return value.toFixed(3);
  if (value < 1) return String(value);
  return roundTo(value, 1);
}

// ─────────── SVG boilerplate with dark-mode-aware style block ───────────

function svgHeader(
  dims: ChartDimensions,
  title: string,
  ariaLabel: string,
  subtitle?: string,
): string {
  const bg = `
    <style>
      :root {
        --bg: #FFFFFF;
        --fg: ${PRIMARY_TEXT};
        --fg2: ${SECONDARY_TEXT};
        --subtitle: ${SUBTITLE_TEXT};
        --axis: ${AXIS};
        --grid: ${GRID};
        --legend-border: ${LEGEND_BORDER};
        --tier-light: ${TIER_COLORS.light};
        --tier-medium: ${TIER_COLORS.medium};
        --tier-heavy: ${TIER_COLORS.heavy};
        --gate: ${GATE};
        --zone-fill: ${DEPLOYABLE_ZONE};
        --zone-fill-opacity: ${DEPLOYABLE_ZONE_OPACITY};
        --zone-text: #166534;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #0D1117;
          --fg: #F3F4F6;
          --fg2: #9CA3AF;
          --subtitle: #9CA3AF;
          --axis: #9CA3AF;
          --grid: #30363D;
          --legend-border: #374151;
          --gate: #F87171;
          --zone-fill: #14532D;
          --zone-fill-opacity: 0.45;
          --zone-text: #86EFAC;
        }
      }
      .chart-bg { fill: var(--bg); }
      .chart-title { fill: var(--fg); font-size: 22px; font-weight: 700; }
      .chart-subtitle { fill: var(--subtitle); font-size: 14px; font-weight: 400; }
      .chart-axis-title { fill: var(--fg); font-size: 14px; font-weight: 600; }
      .chart-tick { fill: var(--fg2); font-size: 12px; font-weight: 400; }
      .chart-value-label { fill: var(--fg); font-size: 11px; font-weight: 600; }
      .chart-bar-value-label { fill: ${PRIMARY_TEXT}; font-size: 11px; font-weight: 600; }
      .chart-point-label { fill: var(--fg); font-size: 12px; font-weight: 500; }
      .chart-legend-label { fill: var(--fg2); font-size: 13px; font-weight: 500; }
      .chart-note { fill: var(--subtitle); font-size: 11px; font-weight: 400; }
      .chart-value-pill { fill: #FFFFFF; }
      .chart-legend-box { fill: #FFFFFF; stroke: ${LEGEND_BORDER}; stroke-width: 1; }
      .chart-acceptable-zone { fill: #F0FDF4; fill-opacity: 0.3; }
      .chart-acceptable-label { fill: #166534; font-size: 11px; font-weight: 600; }
      .chart-zero-baseline { stroke: #D1D5DB; stroke-width: 1.5; }
      .chart-gridline { stroke: var(--grid); stroke-width: 1; }
      .chart-axis { stroke: var(--axis); stroke-width: 1; }
      .chart-gate { stroke: var(--gate); stroke-width: 1.5; stroke-dasharray: 6,4; }
      .chart-gate-label { fill: var(--gate); font-size: 11px; font-weight: 600; }
      .chart-zone { fill: var(--zone-fill); fill-opacity: var(--zone-fill-opacity); }
      .chart-zone-label { fill: var(--zone-text); font-size: 12px; font-weight: 600; }
      .chart-bar-light { fill: var(--tier-light); }
      .chart-bar-medium { fill: var(--tier-medium); }
      .chart-bar-heavy { fill: var(--tier-heavy); }
      .chart-errbar { stroke: var(--fg); stroke-width: 1.5; }
      .chart-scatter-stroke { stroke: var(--bg); stroke-width: 1.5; }
      .chart-line { fill: none; }
    </style>`;
  const desc = subtitle ? `<desc>${escapeText(subtitle)}</desc>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dims.width} ${dims.height}" role="img" aria-label="${escapeAttr(
    ariaLabel,
  )}" font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"><title>${escapeText(
    title,
  )}</title>${desc}${bg}<rect class="chart-bg" width="${dims.width}" height="${dims.height}"/>`;
}

function titleBlock(dims: ChartDimensions, title: string, subtitle?: string): string {
  const parts = [`<text class="chart-title" x="${dims.padding.left}" y="${TITLE_Y}">${escapeText(title)}</text>`];
  if (subtitle) {
    parts.push(`<text class="chart-subtitle" x="${dims.padding.left}" y="${SUBTITLE_Y}">${escapeText(subtitle)}</text>`);
  }
  return parts.join("");
}

// ─────────── Bar chart with error bars, tier-colored ───────────

export interface BarWithErrorDatum {
  label: string;
  value: number;
  lower?: number;
  upper?: number;
  group?: string; // tier key
}

export function renderBarWithErrors(
  title: string,
  data: BarWithErrorDatum[],
  options: {
    subtitle?: string;
    yLabel?: string;
    xLabel?: string;
    yMin?: number;
    yMax?: number;
    asPercent?: boolean;
    gateY?: number;
    gateLabel?: string;
    dims?: ChartDimensions;
  } = {},
): string {
  const dims = options.dims ?? BAR_DIMS;
  const { padding, width, height } = dims;
  const plotLeft = padding.left;
  const plotRight = width - padding.right;
  const plotTop = padding.top;
  const plotBottom = height - padding.bottom;

  const yMin = options.yMin ?? 0;
  const yMax = options.yMax ?? (options.asPercent ? 1 : Math.max(...data.map((d) => d.upper ?? d.value), 1));

  const step = (plotRight - plotLeft) / Math.max(1, data.length);
  const barWidth = Math.min(48, step * 0.6);
  const yScale = (v: number) => plotBottom - ((v - yMin) / (yMax - yMin || 1)) * (plotBottom - plotTop);

  const parts: string[] = [svgHeader(dims, title, title, options.subtitle), titleBlock(dims, title, options.subtitle)];

  // gridlines + y tick labels
  const yTicks = niceTicks(yMin, yMax, 5);
  for (const t of yTicks) {
    const y = yScale(t);
    parts.push(`<line class="chart-gridline" x1="${plotLeft}" x2="${plotRight}" y1="${y}" y2="${y}"/>`);
    parts.push(
      `<text class="chart-tick" x="${plotLeft - 10}" y="${y + 4}" text-anchor="end">${
        options.asPercent ? `${Math.round(t * 100)}%` : roundTo(t, 2)
      }</text>`,
    );
  }
  parts.push(
    `<line class="chart-axis" x1="${plotLeft}" x2="${plotRight}" y1="${plotBottom}" y2="${plotBottom}"/>`,
  );
  parts.push(
    `<line class="chart-axis" x1="${plotLeft}" x2="${plotLeft}" y1="${plotTop}" y2="${plotBottom}"/>`,
  );

  // gate line
  if (options.gateY !== undefined && options.gateY >= yMin && options.gateY <= yMax) {
    const y = yScale(options.gateY);
    parts.push(`<line class="chart-gate" x1="${plotLeft}" x2="${plotRight}" y1="${y}" y2="${y}"/>`);
    if (options.gateLabel) {
      parts.push(`<text class="chart-gate-label" x="${plotRight - 10}" y="${y - 6}" text-anchor="end">${escapeText(options.gateLabel)}</text>`);
    }
  }

  // bars
  for (let i = 0; i < data.length; i += 1) {
    const d = data[i];
    const cx = plotLeft + step * (i + 0.5);
    const tierClass = d.group === "heavy" ? "chart-bar-heavy" : d.group === "medium" ? "chart-bar-medium" : "chart-bar-light";
    const barTop = yScale(d.value);
    parts.push(
      `<rect class="${tierClass}" data-label="${escapeAttr(d.label)}" data-value="${d.value}" x="${cx - barWidth / 2}" y="${barTop}" width="${barWidth}" height="${plotBottom - barTop}" fill-opacity="0.85"/>`,
    );
    let valueAnchorY = barTop - 8;
    if (Number.isFinite(d.lower) && Number.isFinite(d.upper)) {
      const errTop = yScale(d.upper!);
      const errBot = yScale(d.lower!);
      parts.push(`<line class="chart-errbar" x1="${cx}" x2="${cx}" y1="${errTop}" y2="${errBot}"/>`);
      parts.push(`<line class="chart-errbar" x1="${cx - 5}" x2="${cx + 5}" y1="${errTop}" y2="${errTop}"/>`);
      parts.push(`<line class="chart-errbar" x1="${cx - 5}" x2="${cx + 5}" y1="${errBot}" y2="${errBot}"/>`);
      // Lift value label above the upper CI whisker so text does not sit on the error bar.
      valueAnchorY = Math.min(valueAnchorY, errTop - 6);
    }
    // x-axis label, rotated
    const tickLabelY = plotBottom + 20;
    parts.push(
      `<text class="chart-tick" x="${cx}" y="${tickLabelY}" text-anchor="end" transform="rotate(-35 ${cx} ${tickLabelY})">${escapeText(d.label)}</text>`,
    );
    // value label — clamped inside the plot area
    const valueText = options.asPercent ? `${Math.round(d.value * 100)}%` : roundTo(d.value, 2);
    // If the gate line is within 14px of the value label, shift the label upward.
    if (options.gateY !== undefined) {
      const gateLineY = yScale(options.gateY);
      if (Math.abs(gateLineY - valueAnchorY) < 14) {
        valueAnchorY = Math.min(valueAnchorY, gateLineY - 14);
      }
    }
    const labelY = Math.max(plotTop + 12, valueAnchorY);
    const pillWidth = valueText.length * 6.8 + 8;
    const pillHeight = 15;
    parts.push(
      `<rect class="chart-value-pill" x="${cx - pillWidth / 2}" y="${labelY - 11.5}" width="${pillWidth}" height="${pillHeight}" rx="3"/>`,
    );
    parts.push(
      `<text class="chart-bar-value-label" x="${cx}" y="${labelY}" text-anchor="middle">${valueText}</text>`,
    );
  }

  if (options.yLabel) {
    parts.push(
      `<text class="chart-axis-title" x="24" y="${(plotTop + plotBottom) / 2}" text-anchor="middle" transform="rotate(-90 24 ${(plotTop + plotBottom) / 2})">${escapeText(options.yLabel)}</text>`,
    );
  }
  if (options.xLabel) {
    parts.push(
      `<text class="chart-axis-title" x="${(plotLeft + plotRight) / 2}" y="${plotBottom + AXIS_TITLE_OFFSET}" text-anchor="middle">${escapeText(options.xLabel)}</text>`,
    );
  }

  // tier legend
  parts.push(renderTierLegend(dims));
  parts.push("</svg>");
  return parts.join("");
}

function renderTierLegend(dims: ChartDimensions): string {
  const textY = LEGEND_BASELINE_Y;
  const rectY = textY - 11;
  let x = dims.width - dims.padding.right - 300;
  const items: Array<{ label: string; cls: string }> = [
    { label: "light tier", cls: "chart-bar-light" },
    { label: "medium tier", cls: "chart-bar-medium" },
    { label: "heavy tier", cls: "chart-bar-heavy" },
  ];
  const parts: string[] = [];
  for (const it of items) {
    parts.push(`<rect class="${it.cls}" x="${x}" y="${rectY}" width="14" height="14"/>`);
    parts.push(`<text class="chart-legend-label" x="${x + 20}" y="${textY}">${escapeText(it.label)}</text>`);
    x += 20 + it.label.length * 7.2 + 24;
  }
  return parts.join("");
}

// ─────────── ECDF (cumulative distribution) ───────────

export interface EcdfSeries {
  label: string;
  values: number[];
  group?: string; // tier key
}

export function renderEcdf(
  title: string,
  series: EcdfSeries[],
  options: {
    subtitle?: string;
    xLabel?: string;
    xMin?: number;
    xMax?: number;
    thresholdLine?: number;
    dims?: ChartDimensions;
    logX?: boolean;
  } = {},
): string {
  const dims = options.dims ?? ECDF_DIMS;
  const { padding, width, height } = dims;
  const plotLeft = padding.left;
  const plotRight = width - padding.right;
  const plotTop = padding.top;
  const plotBottom = height - padding.bottom;

  const allValues = series.flatMap((s) => s.values.filter((v) => Number.isFinite(v) && v > 0));
  const xMin = options.xMin ?? Math.max(0.5, Math.min(...(allValues.length ? allValues : [0.5])));
  const xMax = options.xMax ?? (allValues.length ? Math.max(...allValues) * 1.05 : 100);
  const logX = options.logX ?? true;
  const logVal = (v: number) => Math.log10(Math.max(xMin / 10, v));

  const xScale = (v: number) => {
    if (logX) {
      return plotLeft + ((logVal(v) - logVal(xMin)) / (logVal(xMax) - logVal(xMin) || 1)) * (plotRight - plotLeft);
    }
    return plotLeft + ((v - xMin) / (xMax - xMin || 1)) * (plotRight - plotLeft);
  };
  const yScale = (v: number) => plotBottom - v * (plotBottom - plotTop);

  const parts: string[] = [svgHeader(dims, title, title, options.subtitle), titleBlock(dims, title, options.subtitle)];

  // y grid
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const y = yScale(t);
    parts.push(`<line class="chart-gridline" x1="${plotLeft}" x2="${plotRight}" y1="${y}" y2="${y}"/>`);
    parts.push(`<text class="chart-tick" x="${plotLeft - 10}" y="${y + 4}" text-anchor="end">${Math.round(t * 100)}%</text>`);
  }
  // x grid (draw gridlines first, then axis lines, then tick LABELS last so
  // labels paint on top and cannot be masked by any later axis stroke).
  const xTicks = logX ? logTicks(xMin, xMax) : niceTicks(xMin, xMax, 6);
  for (const t of xTicks) {
    const x = xScale(t);
    parts.push(`<line class="chart-gridline" x1="${x}" x2="${x}" y1="${plotTop}" y2="${plotBottom}"/>`);
  }
  parts.push(`<line class="chart-axis" x1="${plotLeft}" x2="${plotRight}" y1="${plotBottom}" y2="${plotBottom}"/>`);
  parts.push(`<line class="chart-axis" x1="${plotLeft}" x2="${plotLeft}" y1="${plotTop}" y2="${plotBottom}"/>`);
  // x tick labels — emit explicit inline fill and font-size so rendering is
  // independent of whether a downstream consumer resolves the chart-tick class.
  // resvg v2 does not reliably resolve CSS class selectors across the doc; the
  // PNG export script inlines these anyway, but making them explicit here means
  // any direct-SVG consumer (browser preview, PDF export, etc.) also gets the
  // correct visual weight instead of falling back to the renderer's default.
  for (const t of xTicks) {
    const x = xScale(t);
    parts.push(
      `<text x="${x}" y="${plotBottom + 22}" text-anchor="middle" fill="${SECONDARY_TEXT}" font-size="12" font-weight="400">${formatLogTick(t)}</text>`,
    );
  }

  // threshold line
  if (options.thresholdLine !== undefined && options.thresholdLine >= xMin && options.thresholdLine <= xMax) {
    const x = xScale(options.thresholdLine);
    parts.push(`<line class="chart-gate" x1="${x}" x2="${x}" y1="${plotTop}" y2="${plotBottom}"/>`);
    parts.push(`<text class="chart-gate-label" x="${x + 6}" y="${plotTop + 16}">${options.thresholdLine}s gate</text>`);
  }

  // series lines. Paths are explicitly stroked with no fill — the previous
  // `class="chart-bar-*"` attribute applied a CSS fill that overrode the
  // fill="none" attribute and turned every line into a filled area shape.
  const drawn: EcdfSeries[] = [];
  for (const s of series) {
    const values = [...s.values].filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
    if (values.length === 0) continue;
    const color = s.group === "heavy" ? TIER_COLORS.heavy : s.group === "medium" ? TIER_COLORS.medium : TIER_COLORS.light;
    const pathParts: string[] = [`M ${xScale(xMin)} ${yScale(0)}`];
    let previousY = 0;
    for (let j = 0; j < values.length; j += 1) {
      const x = xScale(Math.min(xMax, Math.max(xMin, values[j])));
      const nextY = (j + 1) / values.length;
      pathParts.push(`L ${x} ${yScale(previousY)}`);
      pathParts.push(`L ${x} ${yScale(nextY)}`);
      previousY = nextY;
    }
    pathParts.push(`L ${xScale(xMax)} ${yScale(previousY)}`);
    parts.push(
      `<path class="chart-line" data-series="${escapeAttr(s.label)}" d="${pathParts.join(" ")}" stroke="${color}" stroke-width="2" fill="none" opacity="0.85"/>`,
    );
    drawn.push(s);
  }
  // Dedicated legend in the upper-left of the plot, grouped by tier. This
  // replaces inline end-labels that used to pile up in the upper-right corner
  // where every ECDF terminates at 100 %.
  if (drawn.length > 0) {
    const tierOrder: Array<"heavy" | "medium" | "light"> = ["heavy", "medium", "light"];
    const byTier = tierOrder.map((tier) => ({
      tier,
      items: drawn.filter((s) => (s.group ?? "light") === tier),
    })).filter((g) => g.items.length > 0);
    const rowH = 19;
    const headerH = 16;
    const totalRows = byTier.reduce((acc, g) => acc + g.items.length, 0);
    const totalHeaders = byTier.length;
    const legendPadding = 8;
    const legendHeight = totalHeaders * headerH + totalRows * rowH + legendPadding * 2;
    const legendWidth = 170;
    const legendX = plotLeft + 14;
    const legendY = plotTop + 14;
    parts.push(
      `<rect class="chart-legend-box" x="${legendX - legendPadding}" y="${legendY - legendPadding}" width="${legendWidth}" height="${legendHeight}" rx="3"/>`,
    );
    let cursorY = legendY + 6;
    for (const grp of byTier) {
      parts.push(
        `<text class="chart-legend-label" x="${legendX}" y="${cursorY}" font-weight="600">${escapeText(`${grp.tier} tier`)}</text>`,
      );
      cursorY += headerH;
      for (const s of grp.items) {
        const color = grp.tier === "heavy" ? TIER_COLORS.heavy : grp.tier === "medium" ? TIER_COLORS.medium : TIER_COLORS.light;
        parts.push(
          `<line x1="${legendX}" x2="${legendX + 22}" y1="${cursorY - 3}" y2="${cursorY - 3}" stroke="${color}" stroke-width="2"/>`,
        );
        parts.push(
          `<text class="chart-legend-label" x="${legendX + 30}" y="${cursorY}">${escapeText(s.label)}</text>`,
        );
        cursorY += rowH;
      }
    }
  }

  if (options.xLabel) {
    parts.push(
      `<text class="chart-axis-title" x="${(plotLeft + plotRight) / 2}" y="${plotBottom + AXIS_TITLE_OFFSET}" text-anchor="middle">${escapeText(options.xLabel)}</text>`,
    );
  }
  parts.push(
    `<text class="chart-axis-title" x="24" y="${(plotTop + plotBottom) / 2}" text-anchor="middle" transform="rotate(-90 24 ${(plotTop + plotBottom) / 2})">cumulative %</text>`,
  );
  parts.push("</svg>");
  return parts.join("");
}

// ─────────── Scatter with CI whiskers ───────────

export interface ScatterPoint {
  label: string;
  x: number;
  y: number;
  xLower?: number;
  xUpper?: number;
  yLower?: number;
  yUpper?: number;
  group?: string;
}

export function renderScatterWithCI(
  title: string,
  points: ScatterPoint[],
  options: {
    subtitle?: string;
    xLabel: string;
    yLabel: string;
    xThreshold?: number;
    yThreshold?: number;
    xAsPercent?: boolean;
    yAsPercent?: boolean;
    xLogScale?: boolean;
    deployableShading?: boolean;
    dims?: ChartDimensions;
  },
): string {
  const dims = options.dims ?? DEFAULT_DIMS;
  const { padding, width, height } = dims;
  const plotLeft = padding.left;
  const plotRight = width - padding.right;
  const plotTop = padding.top;
  const plotBottom = height - padding.bottom;
  if (points.length === 0) {
    return `${svgHeader(dims, title, title)}${titleBlock(dims, title, options.subtitle)}<text class="chart-tick" x="${width / 2}" y="${height / 2}" text-anchor="middle">no data</text></svg>`;
  }
  const allX = points.flatMap((p) => [p.x, p.xLower ?? p.x, p.xUpper ?? p.x]).filter((v) => Number.isFinite(v) && v > 0);
  const allY = points.flatMap((p) => [p.y, p.yLower ?? p.y, p.yUpper ?? p.y]).filter(Number.isFinite);
  const xMin = Math.max(0.5, Math.min(...allX));
  const xMax = Math.max(...allX) * 1.1;
  const yMin = Math.min(0, Math.min(...allY));
  const yMax = options.yAsPercent ? 1 : Math.max(...allY) * 1.1 || 1;
  const logX = options.xLogScale ?? true;
  const logVal = (v: number) => Math.log10(Math.max(xMin / 10, v));

  const xScale = (v: number) => {
    if (logX) return plotLeft + ((logVal(v) - logVal(xMin)) / (logVal(xMax) - logVal(xMin) || 1)) * (plotRight - plotLeft);
    return plotLeft + ((v - xMin) / (xMax - xMin || 1)) * (plotRight - plotLeft);
  };
  const yScale = (v: number) => plotBottom - ((v - yMin) / (yMax - yMin || 1)) * (plotBottom - plotTop);

  const parts: string[] = [svgHeader(dims, title, title, options.subtitle), titleBlock(dims, title, options.subtitle)];

  // Optional deployable shading (upper-left quadrant if both thresholds set).
  // Fill and label both use CSS custom props so they remain visible in dark mode.
  if (options.deployableShading && options.xThreshold !== undefined && options.yThreshold !== undefined) {
    const xT = xScale(options.xThreshold);
    const yT = yScale(options.yThreshold);
    parts.push(
      `<rect class="chart-zone" x="${plotLeft}" y="${plotTop}" width="${xT - plotLeft}" height="${yT - plotTop}"/>`,
    );
    parts.push(
      `<text class="chart-zone-label" x="${plotLeft + 28}" y="${plotTop + 30}">deployable zone</text>`,
    );
  }

  // grid
  const xTicks = logX ? logTicks(xMin, xMax) : niceTicks(xMin, xMax, 6);
  const yTicks = niceTicks(yMin, yMax, 5);
  for (const t of yTicks) {
    const y = yScale(t);
    parts.push(`<line class="chart-gridline" x1="${plotLeft}" x2="${plotRight}" y1="${y}" y2="${y}"/>`);
    parts.push(
      `<text class="chart-tick" x="${plotLeft - 10}" y="${y + 4}" text-anchor="end">${options.yAsPercent ? `${Math.round(t * 100)}%` : roundTo(t, 2)}</text>`,
    );
  }
  for (const t of xTicks) {
    const x = xScale(t);
    parts.push(`<line class="chart-gridline" x1="${x}" x2="${x}" y1="${plotTop}" y2="${plotBottom}"/>`);
    parts.push(`<text class="chart-tick" x="${x}" y="${plotBottom + 20}" text-anchor="middle">${roundTo(t, 1)}</text>`);
  }
  parts.push(`<line class="chart-axis" x1="${plotLeft}" x2="${plotRight}" y1="${plotBottom}" y2="${plotBottom}"/>`);
  parts.push(`<line class="chart-axis" x1="${plotLeft}" x2="${plotLeft}" y1="${plotTop}" y2="${plotBottom}"/>`);

  if (options.xThreshold !== undefined) {
    const x = xScale(options.xThreshold);
    parts.push(`<line class="chart-gate" x1="${x}" x2="${x}" y1="${plotTop}" y2="${plotBottom}"/>`);
    parts.push(`<text class="chart-gate-label" x="${x + 6}" y="${plotBottom - 8}">${options.xThreshold}s gate</text>`);
  }
  if (options.yThreshold !== undefined) {
    const y = yScale(options.yThreshold);
    parts.push(`<line class="chart-gate" x1="${plotLeft}" x2="${plotRight}" y1="${y}" y2="${y}"/>`);
    parts.push(
      `<text class="chart-gate-label" x="${plotLeft + 8}" y="${y - 6}">${options.yAsPercent ? `${Math.round(options.yThreshold * 100)}%` : options.yThreshold} quality gate</text>`,
    );
  }

  // First pass: draw circles + CI whiskers and record anchor points for each label.
  interface LabelPlacement {
    label: string;
    anchorX: number;
    anchorY: number;
    labelX: number;
    labelY: number;
    width: number;
    height: number;
  }
  const labelPlacements: LabelPlacement[] = [];
  for (const p of points) {
    const tierClass = p.group === "heavy" ? "chart-bar-heavy" : p.group === "medium" ? "chart-bar-medium" : "chart-bar-light";
    const color = p.group === "heavy" ? TIER_COLORS.heavy : p.group === "medium" ? TIER_COLORS.medium : TIER_COLORS.light;
    const cx = xScale(p.x);
    const cy = yScale(p.y);
    if (Number.isFinite(p.xLower) && Number.isFinite(p.xUpper)) {
      parts.push(
        `<line x1="${xScale(p.xLower!)}" x2="${xScale(p.xUpper!)}" y1="${cy}" y2="${cy}" stroke="${color}" stroke-width="1.2" opacity="0.55"/>`,
      );
    }
    if (Number.isFinite(p.yLower) && Number.isFinite(p.yUpper)) {
      parts.push(
        `<line x1="${cx}" x2="${cx}" y1="${yScale(p.yLower!)}" y2="${yScale(p.yUpper!)}" stroke="${color}" stroke-width="1.2" opacity="0.55"/>`,
      );
    }
    parts.push(
      `<circle class="chart-scatter-stroke ${tierClass}" cx="${cx}" cy="${cy}" r="9" fill="${color}" data-model="${escapeAttr(p.label)}" data-x="${p.x}" data-y="${p.y}"/>`,
    );
    const approxWidth = p.label.length * 6.5 + 4;
    labelPlacements.push({
      label: p.label,
      anchorX: cx,
      anchorY: cy,
      labelX: cx + 12,
      labelY: cy + 4,
      width: approxWidth,
      // bump height past the glyph box to force a few px of breathing room
      // between adjacent labels after the anti-overlap pass settles.
      height: 16,
    });
  }
  // Keep model labels consistently 12px to the right of each point, nudging
  // only vertically when two labels would otherwise touch.
  const labelOverlaps = (a: LabelPlacement, b: LabelPlacement): boolean =>
    !(
      a.labelX + a.width < b.labelX ||
      a.labelX > b.labelX + b.width ||
      a.labelY < b.labelY - b.height ||
      a.labelY - a.height > b.labelY
    );
  for (let iter = 0; iter < 80; iter += 1) {
    let moved = false;
    for (let i = 0; i < labelPlacements.length; i += 1) {
      for (let j = i + 1; j < labelPlacements.length; j += 1) {
        const a = labelPlacements[i];
        const b = labelPlacements[j];
        if (!labelOverlaps(a, b)) continue;
        // Nudge the upper label up and the lower label down by 2px each.
        const aIsAbove = a.labelY <= b.labelY;
        if (aIsAbove) {
          a.labelY -= 2;
          b.labelY += 2;
        } else {
          a.labelY += 2;
          b.labelY -= 2;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
  // Clamp labels inside the plotting area.
  for (const lp of labelPlacements) {
    lp.labelX = Math.min(Math.max(lp.labelX, plotLeft + 2), width - lp.width - 8);
    lp.labelY = Math.min(Math.max(lp.labelY, plotTop + lp.height + 2), plotBottom - 4);
  }
  if (options.yThreshold !== undefined) {
    const gateLineY = yScale(options.yThreshold);
    for (const lp of labelPlacements) {
      const labelTop = lp.labelY - lp.height;
      const labelBottom = lp.labelY + 2;
      if (gateLineY >= labelTop && gateLineY <= labelBottom) {
        lp.labelY = lp.anchorY <= gateLineY ? gateLineY - 8 : gateLineY + lp.height + 4;
      }
    }
  }
  for (const lp of labelPlacements) {
    const dx = lp.labelX - (lp.anchorX + 12);
    const dy = lp.labelY - (lp.anchorY + 4);
    if (Math.hypot(dx, dy) > 18) {
      parts.push(
        `<line stroke="var(--axis)" stroke-width="0.75" opacity="0.5" x1="${lp.anchorX}" x2="${lp.labelX - 2}" y1="${lp.anchorY}" y2="${lp.labelY - 3}"/>`,
      );
    }
    parts.push(
      `<text class="chart-point-label" x="${lp.labelX}" y="${lp.labelY}">${escapeText(lp.label)}</text>`,
    );
  }
  parts.push(
    `<text class="chart-axis-title" x="${(plotLeft + plotRight) / 2}" y="${plotBottom + AXIS_TITLE_OFFSET}" text-anchor="middle">${escapeText(options.xLabel)}</text>`,
  );
  parts.push(
    `<text class="chart-axis-title" x="24" y="${(plotTop + plotBottom) / 2}" text-anchor="middle" transform="rotate(-90 24 ${(plotTop + plotBottom) / 2})">${escapeText(options.yLabel)}</text>`,
  );
  parts.push(renderTierLegend(dims));
  parts.push("</svg>");
  return parts.join("");
}

// ─────────── Heatmap (green sequential) ───────────

export interface HeatmapCell {
  row: string;
  column: string;
  value: number;
  annotation?: string;
  group?: string; // row tier — used for the tier bracket axis
}

export function renderHeatmap(
  title: string,
  cells: HeatmapCell[],
  options: {
    subtitle?: string;
    rowLabel?: string;
    columnLabel?: string;
    valueLabel?: string;
    min?: number;
    max?: number;
    asPercent?: boolean;
    dims?: ChartDimensions;
    rowOrder?: string[];
    columnOrder?: string[];
    rowTierGroups?: Record<string, string>; // row -> tier
  } = {},
): string {
  const rows = options.rowOrder ?? [...new Set(cells.map((c) => c.row))];
  const columns = options.columnOrder ?? [...new Set(cells.map((c) => c.column))];
  const dims = options.dims ?? HEATMAP_DIMS;
  const { padding, width, height } = dims;
  const plotLeft = padding.left;
  const plotRight = width - padding.right;
  const plotTop = padding.top;
  const plotBottom = height - padding.bottom;
  const cellWidth = (plotRight - plotLeft) / Math.max(1, columns.length);
  const cellHeight = (plotBottom - plotTop) / Math.max(1, rows.length);
  const vMin = options.min ?? 0;
  const vMax = options.max ?? 1;

  const parts: string[] = [svgHeader(dims, title, title, options.subtitle), titleBlock(dims, title, options.subtitle)];

  // Column labels hang from the top axis and rotate up from the cell centers.
  const colLabelAnchorY = plotTop - 8;
  for (let c = 0; c < columns.length; c += 1) {
    const x = plotLeft + cellWidth * (c + 0.5);
    parts.push(
      `<text class="chart-tick" x="${x}" y="${colLabelAnchorY}" text-anchor="start" dominant-baseline="text-after-edge" transform="rotate(-40 ${x} ${colLabelAnchorY})">${escapeText(columns[c])}</text>`,
    );
  }
  for (let r = 0; r < rows.length; r += 1) {
    const y = plotTop + cellHeight * (r + 0.5) + 4;
    parts.push(
      `<text class="chart-tick" x="${plotLeft - 12}" y="${y}" text-anchor="end">${escapeText(rows[r])}</text>`,
    );
  }

  // Tier brackets on the left. Bracket and tier text sit outside the row-
  // label zone so tier labels never share an x-range with a model name.
  if (options.rowTierGroups) {
    const tiers: Array<{ tier: string; startRow: number; endRow: number }> = [];
    let current: { tier: string; startRow: number; endRow: number } | null = null;
    for (let r = 0; r < rows.length; r += 1) {
      const tier = options.rowTierGroups[rows[r]] ?? "light";
      if (!current || current.tier !== tier) {
        if (current) tiers.push(current);
        current = { tier, startRow: r, endRow: r };
      } else {
        current.endRow = r;
      }
    }
    if (current) tiers.push(current);
    const bracketX = plotLeft - 150;
    const tierLabelX = plotLeft - 160;
    for (const grp of tiers) {
      const y0 = plotTop + cellHeight * grp.startRow + 4;
      const y1 = plotTop + cellHeight * (grp.endRow + 1) - 4;
      const cls = grp.tier === "heavy" ? "chart-bar-heavy" : grp.tier === "medium" ? "chart-bar-medium" : "chart-bar-light";
      parts.push(`<rect class="${cls}" x="${bracketX}" y="${y0}" width="6" height="${y1 - y0}" opacity="0.85"/>`);
      // Centre tier label on the bracket; with rows at x=plotLeft-12 and
      // bracket at plotLeft-150 there is ~130 px of clear horizontal space
      // for a short tier word.
      const labelY = (y0 + y1) / 2 + 4;
      parts.push(
        `<text class="chart-tick" x="${tierLabelX}" y="${labelY}" text-anchor="end" font-weight="600">${escapeText(grp.tier)}</text>`,
      );
    }
  }

  for (const cell of cells) {
    const r = rows.indexOf(cell.row);
    const c = columns.indexOf(cell.column);
    if (r < 0 || c < 0) continue;
    const normalized = Number.isFinite(cell.value)
      ? Math.min(1, Math.max(0, (cell.value - vMin) / (vMax - vMin || 1)))
      : 0;
    const color = interpolateGreens(normalized);
    const x = plotLeft + cellWidth * c;
    const y = plotTop + cellHeight * r;
    const cellGap = 1.5;
    parts.push(
      `<rect x="${x + cellGap / 2}" y="${y + cellGap / 2}" width="${Math.max(0, cellWidth - cellGap)}" height="${Math.max(0, cellHeight - cellGap)}" fill="${color}" data-row="${escapeAttr(cell.row)}" data-column="${escapeAttr(cell.column)}" data-value="${cell.value}" stroke="#ffffff" stroke-width="${cellGap}"/>`,
    );
    const annotation = cell.annotation ??
      (Number.isFinite(cell.value)
        ? options.asPercent
          ? `${Math.round(cell.value * 100)}%`
          : roundTo(cell.value, 2)
        : "—");
    // Pick text color from relative luminance of the cell fill rather than
    // the normalized [0,1] value.
    const textColor = relativeLuminance(color) < 0.5 ? "#ffffff" : PRIMARY_TEXT;
    parts.push(
      `<text x="${x + cellWidth / 2}" y="${y + cellHeight / 2 + 4}" text-anchor="middle" fill="${textColor}" font-size="12" font-weight="500">${escapeText(annotation)}</text>`,
    );
  }

  if (options.columnLabel) {
    parts.push(
      `<text class="chart-axis-title" x="${(plotLeft + plotRight) / 2}" y="${plotBottom + AXIS_TITLE_OFFSET}" text-anchor="middle">${escapeText(options.columnLabel)}</text>`,
    );
  }
  if (options.rowLabel) {
    parts.push(
      `<text class="chart-axis-title" x="24" y="${(plotTop + plotBottom) / 2}" text-anchor="middle" transform="rotate(-90 24 ${(plotTop + plotBottom) / 2})">${escapeText(options.rowLabel)}</text>`,
    );
  }

  // colorbar
  const legendX = plotRight + 20;
  const legendTop = plotTop;
  const legendHeight = plotBottom - plotTop;
  const segments = 20;
  for (let i = 0; i < segments; i += 1) {
    const t = i / (segments - 1);
    const color = interpolateGreens(1 - t);
    parts.push(
      `<rect x="${legendX}" y="${legendTop + (legendHeight * i) / segments}" width="14" height="${legendHeight / segments + 1}" fill="${color}"/>`,
    );
  }
  for (const t of [1, 0.75, 0.5, 0.25, 0]) {
    const y = legendTop + (1 - t) * legendHeight;
    const labelY = Math.min(plotBottom, Math.max(legendTop + 10, y + 4));
    const value = vMin + t * (vMax - vMin);
    const label = options.asPercent ? `${Math.round(value * 100)}%` : roundTo(value, 2);
    parts.push(`<line x1="${legendX + 14}" x2="${legendX + 20}" y1="${y}" y2="${y}" stroke="${AXIS}" stroke-width="1"/>`);
    parts.push(`<text class="chart-tick" x="${legendX + 24}" y="${labelY}">${label}</text>`);
  }

  parts.push("</svg>");
  return parts.join("");
}

function relativeLuminance(rgb: string): number {
  const match = rgb.match(/rgb\((\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\)/);
  if (!match) return 1;
  const toLinear = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const r = toLinear(Number(match[1]));
  const g = toLinear(Number(match[2]));
  const b = toLinear(Number(match[3]));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function interpolateGreens(t: number): string {
  const stops: Array<[number, [number, number, number]]> = [
    [0, [240, 253, 244]], // #F0FDF4 very light mint
    [0.25, [187, 247, 208]],
    [0.5, [134, 239, 172]],
    [0.75, [74, 222, 128]],
    [0.9, [34, 197, 94]],
    [1, [20, 83, 45]], // #14532D deep emerald
  ];
  const clamped = Math.min(1, Math.max(0, t));
  for (let i = 0; i < stops.length - 1; i += 1) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (clamped >= t0 && clamped <= t1) {
      const frac = (clamped - t0) / (t1 - t0 || 1);
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * frac);
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * frac);
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * frac);
      return `rgb(${r}, ${g}, ${b})`;
    }
  }
  return "rgb(20, 83, 45)";
}

// ─────────── Stacked stage-latency bars (horizontal) ───────────

export interface StageBarDatum {
  label: string;
  stages: Record<string, number>;
  group?: string;
}

export function renderStackedStages(
  title: string,
  data: StageBarDatum[],
  stageOrder: string[],
  options: {
    subtitle?: string;
    yLabel?: string;
    xLabel?: string;
    gateX?: number;
    dims?: ChartDimensions;
  } = {},
): string {
  const dims = options.dims ?? STAGE_DIMS;
  const { padding, width, height } = dims;
  const plotLeft = padding.left;
  const plotRight = width - padding.right;
  const plotTop = padding.top;
  const plotBottom = height - padding.bottom;
  const step = (plotBottom - plotTop) / Math.max(1, data.length);
  const barHeight = Math.max(12, step * 0.7);

  const totals = data.map((d) => stageOrder.reduce((s, k) => s + (d.stages[k] ?? 0), 0));
  const xMax = Math.max(1, Math.max(...totals) * 1.1);
  const xScale = (v: number) => plotLeft + (v / xMax) * (plotRight - plotLeft);

  const parts: string[] = [svgHeader(dims, title, title, options.subtitle), titleBlock(dims, title, options.subtitle)];

  const xTicks = niceTicks(0, xMax, 6);
  for (const t of xTicks) {
    const x = xScale(t);
    parts.push(`<line class="chart-gridline" x1="${x}" x2="${x}" y1="${plotTop}" y2="${plotBottom}"/>`);
    parts.push(`<text class="chart-tick" x="${x}" y="${plotBottom + 20}" text-anchor="middle">${roundTo(t, 1)}</text>`);
  }
  parts.push(`<line class="chart-axis" x1="${plotLeft}" x2="${plotRight}" y1="${plotBottom}" y2="${plotBottom}"/>`);
  parts.push(`<line class="chart-axis" x1="${plotLeft}" x2="${plotLeft}" y1="${plotTop}" y2="${plotBottom}"/>`);

  if (options.gateX !== undefined) {
    const x = xScale(options.gateX);
    parts.push(`<line class="chart-gate" x1="${x}" x2="${x}" y1="${plotTop}" y2="${plotBottom}"/>`);
    parts.push(`<text class="chart-gate-label" x="${x + 6}" y="${plotTop + 16}">${options.gateX}s gate</text>`);
  }

  const stageColors = [
    "#4C78A8",
    "#E45756",
    "#54A24B",
    "#F2A93B",
    "#79706E",
    "#72B7B2",
    "#B279A2",
  ];

  for (let i = 0; i < data.length; i += 1) {
    const d = data[i];
    const cy = plotTop + step * (i + 0.5);
    let cumulative = 0;
    for (let s = 0; s < stageOrder.length; s += 1) {
      const stage = stageOrder[s];
      const value = d.stages[stage] ?? 0;
      const color = stageColors[s % stageColors.length];
      parts.push(
        `<rect x="${xScale(cumulative)}" y="${cy - barHeight / 2}" width="${xScale(cumulative + value) - xScale(cumulative)}" height="${barHeight}" fill="${color}" data-stage="${escapeAttr(stage)}" data-seconds="${value}"/>`,
      );
      cumulative += value;
    }
    // total label at bar end. Nudge right if it would overlap the gate line.
    const totalText = `${roundTo(totals[i], 2)}s`;
    const totalTextWidth = totalText.length * 6.5;
    let labelX = xScale(totals[i]) + 6;
    if (options.gateX !== undefined) {
      const gateLineX = xScale(options.gateX);
      if (labelX < gateLineX + 4 && labelX + totalTextWidth > gateLineX - 4) {
        labelX = gateLineX + 6;
      }
    }
    parts.push(
      `<text class="chart-value-label" x="${labelX}" y="${cy + 4}">${totalText}</text>`,
    );
    // y label
    parts.push(
      `<text class="chart-tick" x="${plotLeft - 12}" y="${cy + 4}" text-anchor="end">${escapeText(d.label)}</text>`,
    );
  }

  if (options.xLabel) {
    parts.push(
      `<text class="chart-axis-title" x="${(plotLeft + plotRight) / 2}" y="${plotBottom + AXIS_TITLE_OFFSET}" text-anchor="middle">${escapeText(options.xLabel)}</text>`,
    );
  }

  // legend: stages
  let lx = plotLeft;
  const ly = plotBottom + 58;
  for (let s = 0; s < stageOrder.length; s += 1) {
    const color = stageColors[s % stageColors.length];
    parts.push(`<rect x="${lx}" y="${ly}" width="12" height="12" fill="${color}"/>`);
    parts.push(`<text class="chart-legend-label" x="${lx + 18}" y="${ly + 10}">${escapeText(stageOrder[s])}</text>`);
    lx += 18 + stageOrder[s].length * 7.3 + 20;
  }
  parts.push(
    `<text class="chart-note" x="${plotLeft}" y="${ly + 32}">${escapeText("Only llm_generation is visible; upstream stages (phi_gate, domain_classification, embedding, retrieval, prompt_build, response_validation) collectively < 0.1s and are not visible at this scale.")}</text>`,
  );

  parts.push("</svg>");
  return parts.join("");
}

// ─────────── Judge reliability bars ───────────

export interface ReliabilityBar {
  dimension: string;
  kappa: number;
  threshold?: number;
  group?: string;
}

export function renderReliabilityBars(
  title: string,
  bars: ReliabilityBar[],
  options: { subtitle?: string; threshold?: number; dims?: ChartDimensions; yMin?: number; yMax?: number } = {},
): string {
  const dims = options.dims ?? DEFAULT_DIMS;
  const { padding, width, height } = dims;
  const plotLeft = padding.left;
  const plotRight = width - padding.right;
  const plotTop = padding.top;
  const plotBottom = height - padding.bottom;

  const yMin = options.yMin ?? -0.1;
  const yMax = options.yMax ?? 1;
  const step = (plotRight - plotLeft) / Math.max(1, bars.length);
  const barWidth = Math.min(64, step * 0.5) * 0.7;
  const yScale = (v: number) => plotBottom - ((v - yMin) / (yMax - yMin || 1)) * (plotBottom - plotTop);

  const parts: string[] = [svgHeader(dims, title, title, options.subtitle), titleBlock(dims, title, options.subtitle)];
  if (options.threshold !== undefined) {
    const thresholdY = yScale(options.threshold);
    const zoneTop = yScale(Math.min(1, yMax));
    parts.push(
      `<rect class="chart-acceptable-zone" x="${plotLeft}" y="${zoneTop}" width="${plotRight - plotLeft}" height="${thresholdY - zoneTop}"/>`,
    );
    parts.push(
      `<text class="chart-acceptable-label" x="${plotRight - 10}" y="${zoneTop + 18}" text-anchor="end">Acceptable: κ ≥ ${options.threshold}</text>`,
    );
  }
  const yTicks = niceTicks(yMin, yMax, 6);
  for (const t of yTicks) {
    const y = yScale(t);
    parts.push(`<line class="chart-gridline" x1="${plotLeft}" x2="${plotRight}" y1="${y}" y2="${y}"/>`);
    parts.push(`<text class="chart-tick" x="${plotLeft - 10}" y="${y + 4}" text-anchor="end">${roundTo(t, 2)}</text>`);
  }
  parts.push(`<line class="chart-axis" x1="${plotLeft}" x2="${plotRight}" y1="${plotBottom}" y2="${plotBottom}"/>`);
  parts.push(`<line class="chart-axis" x1="${plotLeft}" x2="${plotLeft}" y1="${plotTop}" y2="${plotBottom}"/>`);
  parts.push(`<line class="chart-zero-baseline" x1="${plotLeft}" x2="${plotRight}" y1="${yScale(0)}" y2="${yScale(0)}"/>`);

  if (options.threshold !== undefined) {
    const y = yScale(options.threshold);
    parts.push(`<line class="chart-gate" x1="${plotLeft}" x2="${plotRight}" y1="${y}" y2="${y}"/>`);
    // Anchor the threshold label on the LEFT so it cannot collide with a
    // near-threshold bar's value label on the right (the hallucination bar
    // sits at 0.606, right below the line on the far-right side of the chart).
    parts.push(`<text class="chart-gate-label" x="${plotLeft + 10}" y="${y - 6}" text-anchor="start">κ ≥ ${options.threshold}</text>`);
  }

  const thresholdY = options.threshold !== undefined ? yScale(options.threshold) : undefined;
  for (let i = 0; i < bars.length; i += 1) {
    const b = bars[i];
    const cx = plotLeft + step * (i + 0.5);
    const barTop = yScale(Math.max(0, b.kappa));
    const barBot = yScale(0);
    const color = b.kappa >= (options.threshold ?? 0.6) ? TIER_COLORS.heavy : b.kappa >= 0.4 ? TIER_COLORS.medium : TIER_COLORS.light;
    parts.push(
      `<rect x="${cx - barWidth / 2}" y="${Math.min(barTop, barBot)}" width="${barWidth}" height="${Math.abs(barBot - barTop)}" fill="${color}" fill-opacity="0.85" data-dim="${escapeAttr(b.dimension)}" data-kappa="${b.kappa}"/>`,
    );
    parts.push(
      `<text class="chart-tick" x="${cx}" y="${plotBottom + 20}" text-anchor="middle">${escapeText(b.dimension)}</text>`,
    );
    // Lift the value label above the threshold line if it would sit within
    // 12 px of it, so near-threshold bars stay readable.
    let labelY = Math.min(barTop, barBot) - 6;
    if (thresholdY !== undefined && Math.abs(labelY - thresholdY) < 12) {
      labelY = Math.min(labelY, thresholdY - 12);
    }
    parts.push(
      `<text class="chart-value-label" x="${cx}" y="${Math.max(plotTop + 12, labelY)}" text-anchor="middle">${roundTo(b.kappa, 3)}</text>`,
    );
  }

  parts.push(
    `<text class="chart-axis-title" x="24" y="${(plotTop + plotBottom) / 2}" text-anchor="middle" transform="rotate(-90 24 ${(plotTop + plotBottom) / 2})">Cohen's κ</text>`,
  );

  parts.push("</svg>");
  return parts.join("");
}

// ─────────── Utilities ───────────

export function svgAsDataUri(svg: string): string {
  const encoded = encodeURIComponent(svg).replace(/'/g, "%27").replace(/"/g, "%22");
  return `data:image/svg+xml;charset=utf-8,${encoded}`;
}
