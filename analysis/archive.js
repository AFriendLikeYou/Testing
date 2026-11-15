'use strict';

// Meta-analysis of finished A/B tests: how large are true differences between paywall
// variants typically, and how much of each observed "win" is noise?
//   node analysis/archive.js <file.csv> [--metric subscriptions|checkouts]
// Same CSV as scripts/replay.js; each test needs a row with control=1.
//
// Per variant: relative lift vs. control on the log scale with its sampling variance.
// DerSimonian–Laird estimates tau, the spread of *true* lifts between variants. Each observed
// lift is then shrunk towards the mean; the gap between raw and shrunk is the winner's curse.
// tau is the prior to use in analysis/compare.js (--sigma).

const fs = require('node:fs');

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const metric = args.includes('--metric') ? args[args.indexOf('--metric') + 1] : 'subscriptions';
if (!file) {
  console.error('usage: node analysis/archive.js <file.csv> [--metric subscriptions|checkouts]');
  process.exit(1);
}

const [header, ...rows] = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
const cols = header.split(',').map((c) => c.trim().toLowerCase());
const tests = new Map();
for (const row of rows) {
  const r = Object.fromEntries(cols.map((c, i) => [c, row.split(',')[i]?.trim()]));
  if (!tests.has(r.test)) tests.set(r.test, []);
  tests.get(r.test).push({ id: r.variant, n: Number(r.impressions), x: Number(r[metric]), control: r.control === '1' || r.control === 'true' });
}

const effects = [];
for (const [test, variants] of tests) {
  const control = variants.find((v) => v.control);
  if (!control) {
    console.warn(`skipping ${test}: no control row`);
    continue;
  }
  for (const v of variants) {
    if (v === control || !v.x || !control.x) continue;
    const y = Math.log((v.x / v.n) / (control.x / control.n));
    const variance = 1 / v.x - 1 / v.n + 1 / control.x - 1 / control.n;
    effects.push({ test, id: v.id, y, variance });
  }
}
if (effects.length < 2) {
  console.error('Need at least two variant-vs-control comparisons.');
  process.exit(1);
}

// DerSimonian–Laird random-effects estimate
const w = effects.map((e) => 1 / e.variance);
const sw = w.reduce((a, b) => a + b, 0);
const muFixed = effects.reduce((s, e, i) => s + w[i] * e.y, 0) / sw;
const Q = effects.reduce((s, e, i) => s + w[i] * (e.y - muFixed) ** 2, 0);
const C = sw - w.reduce((s, x) => s + x * x, 0) / sw;
const tau2 = Math.max(0, (Q - (effects.length - 1)) / C);
const wr = effects.map((e) => 1 / (e.variance + tau2));
const mu = effects.reduce((s, e, i) => s + wr[i] * e.y, 0) / wr.reduce((a, b) => a + b, 0);

const pct = (y) => `${y >= 0 ? '+' : ''}${((Math.exp(y) - 1) * 100).toFixed(1)}%`;
const pad = (s, n) => String(s).padEnd(n);

console.log(`metric: ${metric} · ${effects.length} comparisons from ${tests.size} tests\n`);
console.log(pad('test / variant', 34) + pad('observed', 11) + pad('z', 7) + 'shrunk');
let significant = 0;
for (const e of effects) {
  const z = e.y / Math.sqrt(e.variance);
  if (Math.abs(z) > 1.96) significant++;
  const shrunk = mu + (e.y - mu) * (tau2 / (tau2 + e.variance));
  console.log(pad(`${e.test} / ${e.id}`, 34) + pad(pct(e.y), 11) + pad(z.toFixed(1), 7) + pct(shrunk));
}
console.log(`\nmean true lift vs. control: ${pct(mu)}`);
console.log(`spread of true lifts (tau):  ${(Math.sqrt(tau2) * 100).toFixed(1)}%  → use as --sigma ${Math.sqrt(tau2).toFixed(3)} in analysis/compare.js`);
console.log(`significant at 5% (uncorrected): ${significant} of ${effects.length}`);
if (effects.length < 10) console.log('\nCaution: fewer than 10 comparisons, tau is very uncertain.');
