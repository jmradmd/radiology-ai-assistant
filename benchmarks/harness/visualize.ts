/**
 * Pure-TS SVG chart generator. Zero external deps.
 *
 * All chart functions return a complete <svg>...</svg> string that embeds
 * correctly in GitHub-flavored Markdown (via `<img src="...svg">` or inline).
 * Text uses system-ui; colors are color-blind-safe (Okabe–Ito). Every chart
 * includes axis labels, a legend, and a baseline grid.
 *
 * The rendering is deterministic: identical input produces identical SVG
 * (useful for diffing chart snapshots).
 */

export interface ChartDimensions {
  width: number;
  height: number;
  padding: { top: number; right: number; bottom: number; left: number };
}

const DEFAULT_DIMS: ChartDimensions = {
  width: 960,
  height: 480,
  padding: { top: 40, right: 24, bottom: 64, left: 80 },
};

// Okabe–Ito palette, colorblind-safe.
export const PALETTE = [
  "#0072B2", // blue
  "#D55E00", // vermillion
  "#009E73", // bluish green
  "#CC79A7", // reddish purple
  "#E69F00", // orange
  "#56B4E9", // sky blue
  "#F0E442", // yellow
  "#000000", // black
  "#888888", // neutral grey
];

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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

function svgHeader(dims: ChartDimensions, title: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dims.width} ${dims.height}" role="img" aria-label="${escapeText(
    title,
  )}" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="13"><rect width="${dims.width}" height="${dims.height}" fill="#fff"/>`;
}

function titleText(dims: ChartDimensions, title: string): string {
  return `<text x="${dims.padding.left}" y="24" font-size="16" font-weight="600" fill="#111">${escapeText(title)}</text>`;
}

function gridAndAxes(
  dims: ChartDimensions,
  xTicks: Array<{ value: number; label: string }>,
  yTicks: Array<{ value: number; label: string }>,
  xRange: [number, number],
  yRange: [number, number],
  xLabel: string,
  yLabel: string,
): string {
  const { padding, width, height } = dims;
  const plotLeft = padding.left;
  const plotRight = width - padding.right;
  const plotTop = padding.top;
  const plotBottom = height - padding.bottom;

  const xScale = (value: number) =>
    plotLeft + ((value - xRange[0]) / (xRange[1] - xRange[0] || 1)) * (plotRight - plotLeft);
  const yScale = (value: number) =>
    plotBottom - ((value - yRange[0]) / (yRange[1] - yRange[0] || 1)) * (plotBottom - plotTop);

  const parts: string[] = [];
  for (const tick of yTicks) {
    const y = yScale(tick.value);
    parts.push(`<line x1="${plotLeft}" x2="${plotRight}" y1="${y}" y2="${y}" stroke="#e5e7eb" stroke-width="1"/>`);
    parts.push(`<text x="${plotLeft - 8}" y="${y + 4}" text-anchor="end" fill="#374151">${escapeText(tick.label)}</text>`);
  }
  for (const tick of xTicks) {
    const x = xScale(tick.value);
    parts.push(
      `<text x="${x}" y="${plotBottom + 18}" text-anchor="middle" fill="#374151">${escapeText(tick.label)}</text>`,
    );
  }
  parts.push(
    `<line x1="${plotLeft}" x2="${plotRight}" y1="${plotBottom}" y2="${plotBottom}" stroke="#9ca3af" stroke-width="1"/>`,
  );
  parts.push(
    `<line x1="${plotLeft}" x2="${plotLeft}" y1="${plotTop}" y2="${plotBottom}" stroke="#9ca3af" stroke-width="1"/>`,
  );
  parts.push(
    `<text x="${(plotLeft + plotRight) / 2}" y="${height - 12}" text-anchor="middle" fill="#111" font-size="13">${escapeText(xLabel)}</text>`,
  );
  parts.push(
    `<text x="20" y="${(plotTop + plotBottom) / 2}" text-anchor="middle" transform="rotate(-90, 20, ${(plotTop + plotBottom) / 2})" fill="#111" font-size="13">${escapeText(yLabel)}</text>`,
  );
  return parts.join("");
}

function renderLegend(
  dims: ChartDimensions,
  entries: Array<{ label: string; color: string }>,
): string {
  const parts: string[] = [];
  const topY = 12;
  let x = dims.padding.left + 180;
  for (const entry of entries) {
    parts.push(`<rect x="${x}" y="${topY}" width="12" height="12" fill="${entry.color}"/>`);
    parts.push(`<text x="${x + 18}" y="${topY + 10}" fill="#111">${escapeText(entry.label)}</text>`);
    x += 18 + entry.label.length * 7 + 24;
  }
  return parts.join("");
}

// ───────── Bar chart with error bars ─────────
export interface BarWithErrorDatum {
  label: string;
  value: number;
  lower?: number;
  upper?: number;
  group?: string;
}

export function renderBarWithErrors(
  title: string,
  data: BarWithErrorDatum[],
  options: {
    yLabel?: string;
    xLabel?: string;
    yMin?: number;
    yMax?: number;
    dims?: ChartDimensions;
    asPercent?: boolean;
  } = {},
): string {
  const dims = options.dims ?? DEFAULT_DIMS;
  const { padding, width, height } = dims;
  const plotLeft = padding.left;
  const plotRight = width - padding.right;
  const plotTop = padding.top;
  const plotBottom = height - padding.bottom;
  const innerWidth = plotRight - plotLeft;

  const values = data.flatMap((d) => [d.value, d.lower ?? d.value, d.upper ?? d.value].filter((v) => Number.isFinite(v)));
  const dataMax = values.length ? Math.max(...values) : 1;
  const dataMin = values.length ? Math.min(...values) : 0;
  const yMax = options.yMax ?? (options.asPercent ? 1 : Math.max(dataMax * 1.1, dataMax + 0.01));
  const yMin = options.yMin ?? Math.min(0, dataMin);

  const barWidth = Math.max(4, innerWidth / (data.length * 1.4));
  const step = innerWidth / Math.max(1, data.length);

  const yScale = (value: number) =>
    plotBottom - ((value - yMin) / (yMax - yMin || 1)) * (plotBottom - plotTop);

  const groups = new Map<string, string>();
  let colorIndex = 0;
  for (const d of data) {
    const key = d.group ?? "default";
    if (!groups.has(key)) groups.set(key, PALETTE[colorIndex++ % PALETTE.length]);
  }

  const yTickValues = niceTicks(yMin, yMax, 5);
  const yTicks = yTickValues.map((value) => ({
    value,
    label: options.asPercent ? `${Math.round(value * 100)}%` : roundTo(value, 2),
  }));
  const xTicks = data.map((d, i) => ({
    value: plotLeft + step * (i + 0.5),
    label: d.label,
  }));

  const parts: string[] = [svgHeader(dims, title), titleText(dims, title)];
  // Custom axes because x is categorical.
  for (const tick of yTicks) {
    const y = yScale(tick.value);
    parts.push(`<line x1="${plotLeft}" x2="${plotRight}" y1="${y}" y2="${y}" stroke="#e5e7eb" stroke-width="1"/>`);
    parts.push(`<text x="${plotLeft - 8}" y="${y + 4}" text-anchor="end" fill="#374151">${escapeText(tick.label)}</text>`);
  }
  parts.push(`<line x1="${plotLeft}" x2="${plotRight}" y1="${plotBottom}" y2="${plotBottom}" stroke="#9ca3af"/>`);
  parts.push(`<line x1="${plotLeft}" x2="${plotLeft}" y1="${plotTop}" y2="${plotBottom}" stroke="#9ca3af"/>`);

  for (let i = 0; i < data.length; i += 1) {
    const d = data[i];
    const cx = plotLeft + step * (i + 0.5);
    const color = groups.get(d.group ?? "default") ?? PALETTE[0];
    const barTop = yScale(d.value);
    parts.push(
      `<rect x="${cx - barWidth / 2}" y="${barTop}" width="${barWidth}" height="${plotBottom - barTop}" fill="${color}" fill-opacity="0.85"/>`,
    );
    if (Number.isFinite(d.lower) && Number.isFinite(d.upper)) {
      const errTop = yScale(d.upper!);
      const errBot = yScale(d.lower!);
      parts.push(
        `<line x1="${cx}" x2="${cx}" y1="${errTop}" y2="${errBot}" stroke="#111" stroke-width="1.5"/>`,
      );
      parts.push(
        `<line x1="${cx - 5}" x2="${cx + 5}" y1="${errTop}" y2="${errTop}" stroke="#111" stroke-width="1.5"/>`,
      );
      parts.push(
        `<line x1="${cx - 5}" x2="${cx + 5}" y1="${errBot}" y2="${errBot}" stroke="#111" stroke-width="1.5"/>`,
      );
    }
    // x-axis label, rotated for readability.
    const labelY = plotBottom + 16;
    parts.push(
      `<text x="${cx}" y="${labelY}" text-anchor="end" fill="#374151" transform="rotate(-35 ${cx} ${labelY})">${escapeText(d.label)}</text>`,
    );
    // Value annotation above bar.
    parts.push(
      `<text x="${cx}" y="${Math.max(plotTop + 10, barTop - 6)}" text-anchor="middle" fill="#111" font-size="11">${options.asPercent ? `${Math.round(d.value * 100)}%` : roundTo(d.value, 2)}</text>`,
    );
  }

  if (options.yLabel) {
    parts.push(
      `<text x="20" y="${(plotTop + plotBottom) / 2}" text-anchor="middle" transform="rotate(-90, 20, ${(plotTop + plotBottom) / 2})" fill="#111">${escapeText(options.yLabel)}</text>`,
    );
  }

  if (groups.size > 1) {
    parts.push(renderLegend(dims, [...groups.entries()].map(([label, color]) => ({ label, color }))));
  }

  parts.push("</svg>");
  return parts.join("");
}

// ───────── ECDF / latency CDF ─────────
export interface EcdfSeries {
  label: string;
  values: number[];
}

export function renderEcdf(
  title: string,
  series: EcdfSeries[],
  options: {
    xLabel?: string;
    xMin?: number;
    xMax?: number;
    thresholdLine?: number;
    dims?: ChartDimensions;
  } = {},
): string {
  const dims = options.dims ?? DEFAULT_DIMS;
  const { padding, width, height } = dims;
  const plotLeft = padding.left;
  const plotRight = width - padding.right;
  const plotTop = padding.top;
  const plotBottom = height - padding.bottom;

  const allValues = series.flatMap((s) => s.values.filter((v) => Number.isFinite(v)));
  const xMin = options.xMin ?? (allValues.length ? Math.min(...allValues) : 0);
  const xMax = options.xMax ?? (allValues.length ? Math.max(...allValues) * 1.05 : 1);

  const xScale = (value: number) =>
    plotLeft + ((value - xMin) / (xMax - xMin || 1)) * (plotRight - plotLeft);
  const yScale = (value: number) => plotBottom - value * (plotBottom - plotTop);

  const parts: string[] = [svgHeader(dims, title), titleText(dims, title)];
  const xTickValues = niceTicks(xMin, xMax, 6);
  parts.push(
    gridAndAxes(
      dims,
      xTickValues.map((v) => ({ value: xScale(v), label: roundTo(v, 1) })),
      [0, 0.25, 0.5, 0.75, 1].map((v) => ({ value: v, label: `${Math.round(v * 100)}%` })),
      [xMin, xMax],
      [0, 1],
      options.xLabel ?? "seconds",
      "cumulative %",
    ),
  );

  if (options.thresholdLine !== undefined && options.thresholdLine >= xMin && options.thresholdLine <= xMax) {
    const x = xScale(options.thresholdLine);
    parts.push(
      `<line x1="${x}" x2="${x}" y1="${plotTop}" y2="${plotBottom}" stroke="#D55E00" stroke-width="1.5" stroke-dasharray="6,4"/>`,
    );
    parts.push(
      `<text x="${x + 4}" y="${plotTop + 14}" fill="#D55E00" font-size="11">${options.thresholdLine}s gate</text>`,
    );
  }

  const legendEntries: Array<{ label: string; color: string }> = [];
  for (let i = 0; i < series.length; i += 1) {
    const s = series[i];
    const color = PALETTE[i % PALETTE.length];
    legendEntries.push({ label: s.label, color });
    const sorted = [...s.values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    if (sorted.length === 0) continue;
    const path: string[] = [];
    path.push(`M ${xScale(sorted[0])} ${yScale(0)}`);
    for (let j = 0; j < sorted.length; j += 1) {
      const cumFrac = (j + 1) / sorted.length;
      path.push(`L ${xScale(sorted[j])} ${yScale(cumFrac)}`);
    }
    parts.push(
      `<path d="${path.join(" ")}" stroke="${color}" stroke-width="2" fill="none"/>`,
    );
  }
  parts.push(renderLegend(dims, legendEntries));
  parts.push("</svg>");
  return parts.join("");
}

// ───────── Scatter: latency vs pass-rate ─────────
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
    xLabel: string;
    yLabel: string;
    xThreshold?: number;
    yThreshold?: number;
    xAsPercent?: boolean;
    yAsPercent?: boolean;
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
    return `${svgHeader(dims, title)}${titleText(dims, title)}<text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="#6b7280">no data</text></svg>`;
  }

  const allXs = points.flatMap((p) => [p.x, p.xLower ?? p.x, p.xUpper ?? p.x]);
  const allYs = points.flatMap((p) => [p.y, p.yLower ?? p.y, p.yUpper ?? p.y]);
  const xMin = Math.min(...allXs);
  const xMax = Math.max(...allXs) * 1.05 || 1;
  const yMin = Math.min(0, Math.min(...allYs));
  const yMax = options.yAsPercent ? 1 : Math.max(...allYs) * 1.1 || 1;

  const xScale = (value: number) =>
    plotLeft + ((value - xMin) / (xMax - xMin || 1)) * (plotRight - plotLeft);
  const yScale = (value: number) =>
    plotBottom - ((value - yMin) / (yMax - yMin || 1)) * (plotBottom - plotTop);

  const parts: string[] = [svgHeader(dims, title), titleText(dims, title)];
  const xTicks = niceTicks(xMin, xMax, 6).map((v) => ({
    value: xScale(v),
    label: options.xAsPercent ? `${Math.round(v * 100)}%` : roundTo(v, 1),
  }));
  const yTicks = niceTicks(yMin, yMax, 5).map((v) => ({
    value: v,
    label: options.yAsPercent ? `${Math.round(v * 100)}%` : roundTo(v, 2),
  }));
  parts.push(gridAndAxes(dims, xTicks, yTicks, [xMin, xMax], [yMin, yMax], options.xLabel, options.yLabel));

  if (options.xThreshold !== undefined) {
    const x = xScale(options.xThreshold);
    parts.push(
      `<line x1="${x}" x2="${x}" y1="${plotTop}" y2="${plotBottom}" stroke="#D55E00" stroke-width="1.5" stroke-dasharray="6,4"/>`,
    );
  }
  if (options.yThreshold !== undefined) {
    const y = yScale(options.yThreshold);
    parts.push(
      `<line x1="${plotLeft}" x2="${plotRight}" y1="${y}" y2="${y}" stroke="#D55E00" stroke-width="1.5" stroke-dasharray="6,4"/>`,
    );
  }

  const groups = new Map<string, string>();
  let colorIndex = 0;
  for (const p of points) {
    const key = p.group ?? "default";
    if (!groups.has(key)) groups.set(key, PALETTE[colorIndex++ % PALETTE.length]);
  }

  for (const p of points) {
    const color = groups.get(p.group ?? "default") ?? PALETTE[0];
    const cx = xScale(p.x);
    const cy = yScale(p.y);
    if (Number.isFinite(p.xLower) && Number.isFinite(p.xUpper)) {
      parts.push(
        `<line x1="${xScale(p.xLower!)}" x2="${xScale(p.xUpper!)}" y1="${cy}" y2="${cy}" stroke="${color}" stroke-width="1" opacity="0.55"/>`,
      );
    }
    if (Number.isFinite(p.yLower) && Number.isFinite(p.yUpper)) {
      parts.push(
        `<line x1="${cx}" x2="${cx}" y1="${yScale(p.yLower!)}" y2="${yScale(p.yUpper!)}" stroke="${color}" stroke-width="1" opacity="0.55"/>`,
      );
    }
    parts.push(`<circle cx="${cx}" cy="${cy}" r="6" fill="${color}" fill-opacity="0.9" stroke="#fff" stroke-width="1.5"/>`);
    parts.push(`<text x="${cx + 9}" y="${cy - 9}" font-size="11" fill="#111">${escapeText(p.label)}</text>`);
  }

  if (groups.size > 1) {
    parts.push(renderLegend(dims, [...groups.entries()].map(([label, color]) => ({ label, color }))));
  }
  parts.push("</svg>");
  return parts.join("");
}

// ───────── Heatmap: model × category ─────────
export interface HeatmapCell {
  row: string;
  column: string;
  value: number;
  annotation?: string;
}

export function renderHeatmap(
  title: string,
  cells: HeatmapCell[],
  options: {
    rowLabel?: string;
    columnLabel?: string;
    valueLabel?: string;
    min?: number;
    max?: number;
    asPercent?: boolean;
    dims?: ChartDimensions;
  } = {},
): string {
  const rows = [...new Set(cells.map((c) => c.row))];
  const columns = [...new Set(cells.map((c) => c.column))];
  const dims = options.dims ?? {
    width: Math.max(640, 160 + columns.length * 110),
    height: Math.max(360, 120 + rows.length * 44),
    padding: { top: 48, right: 60, bottom: 72, left: 180 },
  };
  const { padding, width, height } = dims;
  const plotLeft = padding.left;
  const plotRight = width - padding.right;
  const plotTop = padding.top;
  const plotBottom = height - padding.bottom;
  const cellWidth = (plotRight - plotLeft) / Math.max(1, columns.length);
  const cellHeight = (plotBottom - plotTop) / Math.max(1, rows.length);

  const values = cells.map((c) => c.value).filter((v) => Number.isFinite(v));
  const vMin = options.min ?? (values.length ? Math.min(...values) : 0);
  const vMax = options.max ?? (values.length ? Math.max(...values) : 1);

  const parts: string[] = [svgHeader(dims, title), titleText(dims, title)];

  for (let c = 0; c < columns.length; c += 1) {
    const x = plotLeft + cellWidth * (c + 0.5);
    parts.push(`<text x="${x}" y="${plotTop - 8}" text-anchor="middle" fill="#374151">${escapeText(columns[c])}</text>`);
  }
  for (let r = 0; r < rows.length; r += 1) {
    const y = plotTop + cellHeight * (r + 0.5) + 4;
    parts.push(
      `<text x="${plotLeft - 10}" y="${y}" text-anchor="end" fill="#374151">${escapeText(rows[r])}</text>`,
    );
  }

  for (const cell of cells) {
    const r = rows.indexOf(cell.row);
    const c = columns.indexOf(cell.column);
    if (r < 0 || c < 0) continue;
    const normalized = Number.isFinite(cell.value)
      ? Math.min(1, Math.max(0, (cell.value - vMin) / (vMax - vMin || 1)))
      : 0;
    // Sequential blue scale.
    const color = interpolateBlues(normalized);
    const x = plotLeft + cellWidth * c;
    const y = plotTop + cellHeight * r;
    parts.push(
      `<rect x="${x}" y="${y}" width="${cellWidth - 2}" height="${cellHeight - 2}" fill="${color}" stroke="#ffffff"/>`,
    );
    const annotation = cell.annotation ??
      (Number.isFinite(cell.value)
        ? options.asPercent
          ? `${Math.round(cell.value * 100)}%`
          : roundTo(cell.value, 2)
        : "—");
    const textColor = normalized > 0.6 ? "#ffffff" : "#111";
    parts.push(
      `<text x="${x + cellWidth / 2}" y="${y + cellHeight / 2 + 4}" text-anchor="middle" fill="${textColor}" font-size="12">${escapeText(annotation)}</text>`,
    );
  }

  if (options.columnLabel) {
    parts.push(
      `<text x="${(plotLeft + plotRight) / 2}" y="${height - 16}" text-anchor="middle" fill="#111">${escapeText(options.columnLabel)}</text>`,
    );
  }
  if (options.rowLabel) {
    parts.push(
      `<text x="24" y="${(plotTop + plotBottom) / 2}" text-anchor="middle" transform="rotate(-90, 24, ${(plotTop + plotBottom) / 2})" fill="#111">${escapeText(options.rowLabel)}</text>`,
    );
  }

  // Color scale legend.
  const legendX = plotRight - 12;
  const legendTop = plotTop;
  const legendHeight = plotBottom - plotTop;
  const segments = 20;
  for (let i = 0; i < segments; i += 1) {
    const t = i / (segments - 1);
    const color = interpolateBlues(1 - t);
    parts.push(
      `<rect x="${legendX}" y="${legendTop + (legendHeight * i) / segments}" width="12" height="${legendHeight / segments + 1}" fill="${color}"/>`,
    );
  }
  parts.push(
    `<text x="${legendX + 14}" y="${legendTop + 10}" fill="#111" font-size="11">${options.asPercent ? "100%" : roundTo(vMax, 2)}</text>`,
  );
  parts.push(
    `<text x="${legendX + 14}" y="${plotBottom}" fill="#111" font-size="11">${options.asPercent ? "0%" : roundTo(vMin, 2)}</text>`,
  );

  parts.push("</svg>");
  return parts.join("");
}

function interpolateBlues(t: number): string {
  // Light-to-dark blue sequential scale with color-blind safety.
  const stops: Array<[number, [number, number, number]]> = [
    [0, [247, 251, 255]],
    [0.3, [198, 219, 239]],
    [0.6, [107, 174, 214]],
    [0.85, [33, 113, 181]],
    [1, [8, 48, 107]],
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
  return "rgb(8, 48, 107)";
}

// ───────── Stage-latency stacked bar ─────────
export interface StageBarDatum {
  label: string;
  stages: Record<string, number>;
}

export function renderStackedStages(
  title: string,
  data: StageBarDatum[],
  stageOrder: string[],
  options: { yLabel?: string; dims?: ChartDimensions } = {},
): string {
  const dims = options.dims ?? DEFAULT_DIMS;
  const { padding, width, height } = dims;
  const plotLeft = padding.left;
  const plotRight = width - padding.right;
  const plotTop = padding.top;
  const plotBottom = height - padding.bottom;
  const innerWidth = plotRight - plotLeft;
  const step = innerWidth / Math.max(1, data.length);
  const barWidth = Math.max(4, step * 0.7);

  const totals = data.map((d) => stageOrder.reduce((sum, s) => sum + (d.stages[s] ?? 0), 0));
  const yMax = Math.max(1, Math.max(...totals) * 1.1);

  const yScale = (value: number) => plotBottom - (value / yMax) * (plotBottom - plotTop);

  const parts: string[] = [svgHeader(dims, title), titleText(dims, title)];
  const yTicks = niceTicks(0, yMax, 5);
  for (const t of yTicks) {
    const y = yScale(t);
    parts.push(`<line x1="${plotLeft}" x2="${plotRight}" y1="${y}" y2="${y}" stroke="#e5e7eb"/>`);
    parts.push(`<text x="${plotLeft - 8}" y="${y + 4}" text-anchor="end" fill="#374151">${roundTo(t, 1)}</text>`);
  }
  parts.push(`<line x1="${plotLeft}" x2="${plotRight}" y1="${plotBottom}" y2="${plotBottom}" stroke="#9ca3af"/>`);
  parts.push(`<line x1="${plotLeft}" x2="${plotLeft}" y1="${plotTop}" y2="${plotBottom}" stroke="#9ca3af"/>`);

  const legendEntries: Array<{ label: string; color: string }> = [];
  for (let s = 0; s < stageOrder.length; s += 1) {
    legendEntries.push({ label: stageOrder[s], color: PALETTE[s % PALETTE.length] });
  }

  for (let i = 0; i < data.length; i += 1) {
    const d = data[i];
    const cx = plotLeft + step * (i + 0.5);
    let cumulative = 0;
    for (let s = 0; s < stageOrder.length; s += 1) {
      const stage = stageOrder[s];
      const value = d.stages[stage] ?? 0;
      const color = PALETTE[s % PALETTE.length];
      const segTop = yScale(cumulative + value);
      const segBot = yScale(cumulative);
      parts.push(
        `<rect x="${cx - barWidth / 2}" y="${segTop}" width="${barWidth}" height="${segBot - segTop}" fill="${color}"/>`,
      );
      cumulative += value;
    }
    const labelY = plotBottom + 16;
    parts.push(
      `<text x="${cx}" y="${labelY}" text-anchor="end" fill="#374151" transform="rotate(-35 ${cx} ${labelY})">${escapeText(d.label)}</text>`,
    );
  }

  if (options.yLabel) {
    parts.push(
      `<text x="20" y="${(plotTop + plotBottom) / 2}" text-anchor="middle" transform="rotate(-90, 20, ${(plotTop + plotBottom) / 2})" fill="#111">${escapeText(options.yLabel)}</text>`,
    );
  }

  parts.push(renderLegend(dims, legendEntries));
  parts.push("</svg>");
  return parts.join("");
}

// ───────── Helper: write SVG to file ─────────
export function svgAsDataUri(svg: string): string {
  const encoded = encodeURIComponent(svg).replace(/'/g, "%27").replace(/"/g, "%22");
  return `data:image/svg+xml;charset=utf-8,${encoded}`;
}
