/**
 * Statistical inference utilities for the benchmark.
 *
 * Design goals:
 * - Deterministic: every routine takes an explicit seed; identical inputs produce
 *   identical outputs across runs and across machines.
 * - Framework-agnostic: no external stats library; Mulberry32 PRNG for reproducibility.
 * - Conservative: percentile bootstrap with BCa-style bias correction available,
 *   paired-bootstrap (not Welch) for model comparisons because cells are paired
 *   on (query_id, run_number).
 *
 * All p-values are two-sided unless noted.
 */

export interface ConfidenceInterval {
  point: number;
  lower: number;
  upper: number;
  n: number;
  method: "percentile" | "bca" | "exact";
}

export interface ComparisonResult {
  delta: number;
  ci: ConfidenceInterval;
  pValue: number;
  nPairs: number;
  method: "paired_bootstrap" | "permutation" | "mcnemar";
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  if (sorted.length === 1) return sorted[0];
  const rank = Math.max(0, Math.min(sorted.length - 1, q * (sorted.length - 1)));
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  const weight = rank - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * weight;
}

function drawSample<T>(source: T[], n: number, rng: () => number): T[] {
  const out = new Array<T>(n);
  for (let i = 0; i < n; i += 1) {
    out[i] = source[Math.floor(rng() * source.length)];
  }
  return out;
}

export function bootstrapCI(
  values: number[],
  options: {
    statistic?: (sample: number[]) => number;
    iterations?: number;
    alpha?: number;
    seed?: number;
    method?: "percentile" | "bca";
  } = {},
): ConfidenceInterval {
  const statistic = options.statistic ?? ((s) => s.reduce((a, b) => a + b, 0) / s.length);
  const iterations = options.iterations ?? 5000;
  const alpha = options.alpha ?? 0.05;
  const seed = options.seed ?? 42;
  const method = options.method ?? "percentile";

  if (values.length === 0) {
    return { point: Number.NaN, lower: Number.NaN, upper: Number.NaN, n: 0, method };
  }
  if (values.length === 1) {
    return { point: values[0], lower: values[0], upper: values[0], n: 1, method };
  }

  const point = statistic(values);
  const rng = mulberry32(seed);
  const replicates = new Array<number>(iterations);
  for (let i = 0; i < iterations; i += 1) {
    replicates[i] = statistic(drawSample(values, values.length, rng));
  }
  replicates.sort((a, b) => a - b);

  if (method === "bca") {
    // Bias-corrected percentile — requires jackknife for acceleration.
    // Compute bias-correction z0.
    const below = replicates.filter((v) => v < point).length;
    const z0 = normalInvCdf(below / iterations);
    // Jackknife for acceleration.
    const n = values.length;
    const jackMeans = new Array<number>(n);
    for (let i = 0; i < n; i += 1) {
      const sample = values.filter((_, idx) => idx !== i);
      jackMeans[i] = statistic(sample);
    }
    const jackMean = jackMeans.reduce((a, b) => a + b, 0) / n;
    const num = jackMeans.reduce((acc, m) => acc + Math.pow(jackMean - m, 3), 0);
    const den = 6 * Math.pow(jackMeans.reduce((acc, m) => acc + Math.pow(jackMean - m, 2), 0), 1.5);
    const a = den === 0 ? 0 : num / den;
    const zAlpha = normalInvCdf(alpha / 2);
    const zOneMinusAlpha = normalInvCdf(1 - alpha / 2);
    const alphaLower = normalCdf(z0 + (z0 + zAlpha) / (1 - a * (z0 + zAlpha)));
    const alphaUpper = normalCdf(z0 + (z0 + zOneMinusAlpha) / (1 - a * (z0 + zOneMinusAlpha)));
    return {
      point,
      lower: percentile(replicates, clamp(alphaLower, 0, 1)),
      upper: percentile(replicates, clamp(alphaUpper, 0, 1)),
      n: values.length,
      method: "bca",
    };
  }

  return {
    point,
    lower: percentile(replicates, alpha / 2),
    upper: percentile(replicates, 1 - alpha / 2),
    n: values.length,
    method: "percentile",
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// Moro 1995 approximation to inverse standard-normal CDF.
// Good to ~4 decimal places over [1e-6, 1 - 1e-6]. Sufficient for BCa bootstrap.
function normalInvCdf(p: number): number {
  if (p <= 0 || p >= 1) return p <= 0 ? -Infinity : Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  const phigh = 1 - plow;
  let q: number;
  let r: number;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= phigh) {
    q = p - 0.5;
    r = q * q;
    return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

function normalCdf(x: number): number {
  // Abramowitz & Stegun 7.1.26 approximation to erf.
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

/**
 * Paired-bootstrap comparison of two models on the same query cells.
 * pairs[i] = [modelA_value_on_item_i, modelB_value_on_item_i]
 */
export function pairedBootstrap(
  pairs: Array<[number, number]>,
  options: {
    iterations?: number;
    alpha?: number;
    seed?: number;
    statistic?: (values: number[]) => number;
  } = {},
): ComparisonResult {
  const iterations = options.iterations ?? 5000;
  const alpha = options.alpha ?? 0.05;
  const seed = options.seed ?? 42;
  const statistic = options.statistic ?? ((s) => s.reduce((a, b) => a + b, 0) / s.length);

  if (pairs.length === 0) {
    return {
      delta: Number.NaN,
      ci: { point: Number.NaN, lower: Number.NaN, upper: Number.NaN, n: 0, method: "percentile" },
      pValue: 1,
      nPairs: 0,
      method: "paired_bootstrap",
    };
  }

  const deltas = pairs.map(([a, b]) => a - b);
  const observedDelta = statistic(deltas);
  const rng = mulberry32(seed);
  const replicates = new Array<number>(iterations);
  for (let i = 0; i < iterations; i += 1) {
    replicates[i] = statistic(drawSample(deltas, deltas.length, rng));
  }
  replicates.sort((a, b) => a - b);

  // Two-sided percentile p-value: fraction of replicates whose sign differs from observed.
  const crossings = observedDelta >= 0
    ? replicates.filter((v) => v <= 0).length
    : replicates.filter((v) => v >= 0).length;
  const pValue = Math.max(1 / iterations, (2 * crossings) / iterations);

  return {
    delta: observedDelta,
    ci: {
      point: observedDelta,
      lower: percentile(replicates, alpha / 2),
      upper: percentile(replicates, 1 - alpha / 2),
      n: pairs.length,
      method: "percentile",
    },
    pValue: Math.min(1, pValue),
    nPairs: pairs.length,
    method: "paired_bootstrap",
  };
}

/**
 * Two-sample permutation test of means for independent samples.
 */
export function permutationTest(
  a: number[],
  b: number[],
  options: { iterations?: number; seed?: number } = {},
): { delta: number; pValue: number; nPermutations: number } {
  const iterations = options.iterations ?? 5000;
  const seed = options.seed ?? 42;

  if (a.length === 0 || b.length === 0) {
    return { delta: Number.NaN, pValue: 1, nPermutations: 0 };
  }

  const meanA = a.reduce((s, v) => s + v, 0) / a.length;
  const meanB = b.reduce((s, v) => s + v, 0) / b.length;
  const observed = meanA - meanB;

  const pooled = [...a, ...b];
  const rng = mulberry32(seed);
  let extreme = 0;
  for (let i = 0; i < iterations; i += 1) {
    const shuffled = [...pooled];
    for (let j = shuffled.length - 1; j > 0; j -= 1) {
      const k = Math.floor(rng() * (j + 1));
      [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]];
    }
    const resampledA = shuffled.slice(0, a.length);
    const resampledB = shuffled.slice(a.length);
    const mA = resampledA.reduce((s, v) => s + v, 0) / resampledA.length;
    const mB = resampledB.reduce((s, v) => s + v, 0) / resampledB.length;
    if (Math.abs(mA - mB) >= Math.abs(observed)) extreme += 1;
  }
  return { delta: observed, pValue: Math.max(1 / iterations, extreme / iterations), nPermutations: iterations };
}

/**
 * McNemar's exact binomial test for paired binary outcomes.
 * pairs[i] = [modelA_pass_bool, modelB_pass_bool]
 */
export function mcnemar(
  pairs: Array<[boolean, boolean]>,
): { b: number; c: number; pValue: number; nPairs: number } {
  let b = 0; // A pass, B fail
  let c = 0; // A fail, B pass
  for (const [aVal, bVal] of pairs) {
    if (aVal && !bVal) b += 1;
    else if (!aVal && bVal) c += 1;
  }
  const n = b + c;
  if (n === 0) return { b: 0, c: 0, pValue: 1, nPairs: pairs.length };
  // Two-sided exact binomial: P(X <= min(b, c)) * 2 under Bin(n, 0.5).
  const k = Math.min(b, c);
  let cumulative = 0;
  for (let i = 0; i <= k; i += 1) {
    cumulative += binomialPmf(i, n, 0.5);
  }
  return { b, c, pValue: Math.min(1, 2 * cumulative), nPairs: pairs.length };
}

function binomialPmf(k: number, n: number, p: number): number {
  // log-space for numerical stability.
  const logComb = lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);
  return Math.exp(logComb + k * Math.log(p) + (n - k) * Math.log(1 - p));
}

function lgamma(x: number): number {
  // Stirling + Lanczos for log Γ(x). Accurate enough for small-n exact McNemar.
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  }
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i += 1) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/**
 * Approximate minimum sample size (per cell) to detect a given proportion
 * difference at alpha = 0.05, power = 0.80 for two-proportion z-test.
 */
export function minSampleSizeTwoProportions(
  p1: number,
  p2: number,
  alpha = 0.05,
  power = 0.8,
): number {
  if (p1 === p2) return Infinity;
  const zAlpha = normalInvCdf(1 - alpha / 2);
  const zBeta = normalInvCdf(power);
  const pBar = (p1 + p2) / 2;
  const num = zAlpha * Math.sqrt(2 * pBar * (1 - pBar)) + zBeta * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2));
  return Math.ceil((num * num) / Math.pow(p1 - p2, 2));
}

/**
 * Holm-Bonferroni correction for m pairwise comparisons.
 * Returns the adjusted alpha threshold for each sorted p-value; useful for
 * converting raw p-values into reject/accept calls in reports.
 */
export function holmBonferroni(
  pValues: number[],
  familyAlpha = 0.05,
): Array<{ pValue: number; threshold: number; reject: boolean; rank: number }> {
  const indexed = pValues.map((p, i) => ({ p, i }));
  indexed.sort((a, b) => a.p - b.p);
  const m = pValues.length;
  const out = new Array<{ pValue: number; threshold: number; reject: boolean; rank: number }>(m);
  let allPrior = true;
  for (let rank = 0; rank < m; rank += 1) {
    const threshold = familyAlpha / (m - rank);
    const reject = allPrior && indexed[rank].p <= threshold;
    if (!reject) allPrior = false;
    out[indexed[rank].i] = { pValue: indexed[rank].p, threshold, reject, rank: rank + 1 };
  }
  return out;
}
