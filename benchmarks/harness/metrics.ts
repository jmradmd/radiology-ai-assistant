export function mean(values: Array<number | null | undefined>): number | null {
  const filtered = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (filtered.length === 0) return null;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

export function percentile(values: Array<number | null | undefined>, percentileValue: number): number | null {
  const filtered = values
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .sort((a, b) => a - b);
  if (filtered.length === 0) return null;
  if (filtered.length === 1) return filtered[0];

  const rank = Math.max(0, Math.min(filtered.length - 1, (percentileValue / 100) * (filtered.length - 1)));
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return filtered[lower];
  const weight = rank - lower;
  return filtered[lower] + (filtered[upper] - filtered[lower]) * weight;
}

export function p50(values: Array<number | null | undefined>): number | null {
  return percentile(values, 50);
}

export function p95(values: Array<number | null | undefined>): number | null {
  return percentile(values, 95);
}

export function rate(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return numerator / denominator;
}

export function dominantLabel(labels: string[]): string {
  if (labels.length === 0) return "none";
  const counts = new Map<string, number>();
  for (const label of labels) {
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

export function round(value: number | null, digits = 3): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function hashFraction(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10_000) / 10_000;
}

export function cohensKappa(pairs: Array<[number, number]>, labelCount = 4): number | null {
  if (pairs.length === 0) return null;

  let observed = 0;
  const primaryTotals = new Array<number>(labelCount).fill(0);
  const secondaryTotals = new Array<number>(labelCount).fill(0);

  for (const [primary, secondary] of pairs) {
    if (primary === secondary) observed += 1;
    primaryTotals[primary] += 1;
    secondaryTotals[secondary] += 1;
  }

  const pairCount = pairs.length;
  const observedAgreement = observed / pairCount;
  const expectedAgreement = primaryTotals.reduce((sum, total, index) => {
    return sum + (total / pairCount) * (secondaryTotals[index] / pairCount);
  }, 0);

  if (expectedAgreement >= 1) return 1;
  return (observedAgreement - expectedAgreement) / (1 - expectedAgreement);
}
