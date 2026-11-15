'use strict';

// Small statistics helpers for the analysis scripts (no dependencies).

const { sampleBeta } = require('../lib/bandit');

// mulberry32, so runs are reproducible
function makeRng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randn(rng) {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

// Acklam's approximation of the standard normal quantile function.
function normInv(p) {
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - lo) return -normInv(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// Binomial draw. Exact for small n, normal approximation otherwise (fine for daily traffic volumes).
function binomial(n, p, rng) {
  if (n <= 0 || p <= 0) return 0;
  if (n < 50) {
    let k = 0;
    for (let i = 0; i < n; i++) if (rng() < p) k++;
    return k;
  }
  const k = Math.round(n * p + Math.sqrt(n * p * (1 - p)) * randn(rng));
  return Math.min(n, Math.max(0, k));
}

// Two-proportion z statistic (variant vs. control).
function zStat(x1, n1, x0, n0) {
  if (!n1 || !n0) return 0;
  const p = (x1 + x0) / (n1 + n0);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n0));
  return se ? (x1 / n1 - x0 / n0) / se : 0;
}

// Monte Carlo P(arm has the highest rate) under Beta(1+x, 1+n-x) posteriors.
function probBest(arms, rng, draws = 2000) {
  const wins = new Array(arms.length).fill(0);
  for (let d = 0; d < draws; d++) {
    let best = 0;
    let bestDraw = -1;
    arms.forEach((a, i) => {
      const v = sampleBeta(1 + a.x, 1 + a.n - a.x, rng);
      if (v > bestDraw) {
        bestDraw = v;
        best = i;
      }
    });
    wins[best]++;
  }
  return wins.map((w) => w / draws);
}

module.exports = { makeRng, randn, normInv, binomial, zStat, probBest };
