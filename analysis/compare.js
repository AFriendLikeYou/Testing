'use strict';

// Compares a classic A/B test, a sequential A/B test and the bandit on simulated campaigns.
//   node analysis/compare.js [--daily 50000] [--days 28] [--test-days 14] [--variants 4]
//                            [--base 0.005] [--sigma 0,0.03,0.1] [--runs 100] [--holdout 0.1]
//
// True rates are *drawn*, not fixed: control converts at --base, every other variant at
// base × exp(sigma × N(0,1)). sigma is the spread of true lifts (from analysis/archive.js);
// sigma 0 is the "no real difference" scenario. Each campaign lasts --days; the A/B tests use
// the first --test-days to decide and roll the winner out for the rest.

const { makeRng, randn, normInv, binomial, zStat, probBest } = require('./stats');

const raw = process.argv.slice(2);
const arg = (k, d) => (raw.includes(`--${k}`) ? raw[raw.indexOf(`--${k}`) + 1] : d);
const P = {
  daily: Number(arg('daily', 50000)),
  days: Number(arg('days', 28)),
  testDays: Number(arg('test-days', 14)),
  variants: Number(arg('variants', 4)),
  base: Number(arg('base', 0.005)),
  sigmas: String(arg('sigma', '0,0.03,0.1')).split(',').map(Number),
  runs: Number(arg('runs', 100)),
  holdout: Number(arg('holdout', 0.1)),
  explore: Number(arg('explore', 0.05)),
  draws: 500,
};

const K = P.variants;
const zFinal = normInv(1 - 0.05 / (K - 1) / 2);
// O'Brien–Fleming-style boundary for daily looks. The constant is approximated by inflating the
// fixed-horizon critical value by 5%; good enough to show the behaviour, not for production.
const obf = (day) => zFinal * 1.05 * Math.sqrt(P.testDays / day);

function serve(arms, alloc, rates, n, rng, totals) {
  for (let i = 0; i < K; i++) {
    const ni = Math.round(n * alloc[i]);
    const xi = binomial(ni, rates[i], rng);
    arms[i].n += ni;
    arms[i].x += xi;
    totals.subs += xi;
  }
}

const even = Array(K).fill(1 / K);
const only = (i) => Array.from({ length: K }, (_, j) => (j === i ? 1 : 0));

// Classic: fixed test period, Bonferroni z-test vs. control (arm 0), then roll out.
function abTest(rates, rng) {
  const arms = rates.map(() => ({ n: 0, x: 0 }));
  const totals = { subs: 0 };
  for (let d = 0; d < P.testDays; d++) serve(arms, even, rates, P.daily, rng, totals);
  let pick = 0;
  for (let i = 1; i < K; i++) {
    const z = zStat(arms[i].x, arms[i].n, arms[0].x, arms[0].n);
    if (z > zFinal && arms[i].x / arms[i].n > arms[pick].x / arms[pick].n) pick = i;
  }
  for (let d = P.testDays; d < P.days; d++) serve(arms, only(pick), rates, P.daily, rng, totals);
  return { subs: totals.subs, pick };
}

// Sequential: same test, but checked daily against a boundary that is strict early on.
function sequential(rates, rng) {
  const arms = rates.map(() => ({ n: 0, x: 0 }));
  const totals = { subs: 0 };
  let pick = 0;
  let d = 0;
  for (; d < P.testDays; d++) {
    serve(arms, even, rates, P.daily, rng, totals);
    let best = 0;
    for (let i = 1; i < K; i++) {
      const z = zStat(arms[i].x, arms[i].n, arms[0].x, arms[0].n);
      if (z > obf(d + 1) && (!best || arms[i].x / arms[i].n > arms[best].x / arms[best].n)) best = i;
    }
    if (best) {
      pick = best;
      d++;
      break;
    }
  }
  for (; d < P.days; d++) serve(arms, only(pick), rates, P.daily, rng, totals);
  return { subs: totals.subs, pick };
}

// Bandit: fixed holdout for control, Thompson sampling (posterior refreshed daily) for the rest.
// Declares a winner at the end only if P(best among all arms) > 0.95.
function bandit(rates, rng) {
  const arms = rates.map(() => ({ n: 0, x: 0 }));
  const totals = { subs: 0 };
  for (let d = 0; d < P.days; d++) {
    const pb = probBest(arms.slice(1), rng, P.draws);
    const alloc = [P.holdout, ...pb.map((p) => (1 - P.holdout) * ((1 - P.explore) * p + P.explore / (K - 1)))];
    serve(arms, alloc, rates, P.daily, rng, totals);
  }
  const pAll = probBest(arms, rng, 2000);
  const top = pAll.indexOf(Math.max(...pAll));
  return { subs: totals.subs, pick: pAll[top] > 0.95 ? top : 0, top, pTop: pAll[top] };
}

const STRATEGIES = { 'A/B test': abTest, 'sequential A/B': sequential, bandit };
const calibration = [];

function scenario(sigma) {
  const res = Object.fromEntries(Object.keys(STRATEGIES).map((k) => [k, { gain: 0, correct: 0, harmful: 0, falseWin: 0 }]));
  let oracleGain = 0;
  for (let r = 0; r < P.runs; r++) {
    const rng = makeRng(7919 * (r + 1) + Math.round(sigma * 1e4));
    const rates = [P.base, ...Array.from({ length: K - 1 }, () => P.base * Math.exp(sigma * randn(rng)))];
    const best = rates.indexOf(Math.max(...rates));
    const controlSubs = P.base * P.daily * P.days;
    const oracle = (rates[best] - P.base) * P.daily * P.days;
    oracleGain += oracle / P.runs;
    for (const [name, fn] of Object.entries(STRATEGIES)) {
      const out = fn(rates, makeRng(r * 31 + name.length));
      const s = res[name];
      s.gain += (out.subs - controlSubs) / P.runs;
      if (out.pick === best) s.correct += 1 / P.runs;
      if (rates[out.pick] < P.base) s.harmful += 1 / P.runs;
      if (out.pick !== 0) s.falseWin += sigma === 0 ? 1 / P.runs : 0;
      if (name === 'bandit' && sigma > 0) calibration.push({ p: out.pTop, hit: out.top === best });
    }
  }
  return { res, oracleGain };
}

const fmt = (x) => Math.round(x).toLocaleString('de-DE');
const pctf = (x) => `${(x * 100).toFixed(0)}%`;
const pad = (s, n) => String(s).padEnd(n);

console.log(`${P.daily.toLocaleString('de-DE')} impressions/day · ${P.days} days · ${K} variants incl. control · base rate ${(P.base * 100).toFixed(2)}% · ${P.runs} runs per scenario`);
console.log(`A/B tests decide after ${P.testDays} days · bandit: ${pctf(P.holdout)} holdout, ${pctf(P.explore)} floor, daily updates\n`);

for (const sigma of P.sigmas) {
  const { res, oracleGain } = scenario(sigma);
  console.log(sigma === 0
    ? 'Scenario: no real difference between variants (sigma 0)'
    : `Scenario: true lifts spread ±${(sigma * 100).toFixed(0)}% (sigma ${sigma}) · best possible gain ${fmt(oracleGain)} subs`);
  console.log('  ' + pad('', 16) + pad('extra subs', 12) + pad('of possible', 13) + pad('picked best', 13) + (sigma === 0 ? 'false winner' : 'picked worse than control'));
  for (const [name, s] of Object.entries(res)) {
    console.log('  ' + pad(name, 16) + pad(fmt(s.gain), 12) + pad(sigma === 0 ? '–' : pctf(s.gain / oracleGain), 13) +
      pad(sigma === 0 ? '–' : pctf(s.correct), 13) + pctf(sigma === 0 ? s.falseWin : s.harmful));
  }
  console.log();
}

if (calibration.length) {
  console.log('Calibration of the bandit: when it says P(best) = x, how often is that arm really best?');
  const bins = [[0, 0.5], [0.5, 0.8], [0.8, 0.95], [0.95, 1.01]];
  for (const [lo, hi] of bins) {
    const inBin = calibration.filter((c) => c.p >= lo && c.p < hi);
    if (!inBin.length) continue;
    const said = inBin.reduce((s, c) => s + c.p, 0) / inBin.length;
    const real = inBin.filter((c) => c.hit).length / inBin.length;
    console.log(`  says ${pctf(said).padStart(4)} → really best ${pctf(real).padStart(4)}   (${inBin.length} campaigns)`);
  }
}
