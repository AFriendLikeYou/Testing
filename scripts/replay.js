'use strict';

// Replays finished A/B tests: takes each variant's observed rates as the truth and simulates
// how many subscriptions and how much revenue the same number of impressions would have
// produced with an even split vs. the bandit (incl. control group and exploration floor).
//
//   node scripts/replay.js <file.csv> [--reward revenue|subscribed|checkout] [--runs 20]
//                                     [--holdout 0.1] [--explore 0.05]
//
// CSV columns (header required): test,variant,impressions,checkouts,subscriptions[,value][,control]
// `value` = revenue per subscription (defaults to 1, then revenue = subscriptions).
// `control` = 1 marks the variant that plays the control group.

const fs = require('node:fs');
const { chooseArm } = require('../lib/bandit');
const { MODES } = require('../lib/modes');

function parseArgs(argv) {
  const opts = { reward: 'revenue', runs: 20, holdout: 0.1, explore: 0.05, batch: 50 };
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) opts[argv[i].slice(2)] = argv[++i];
    else files.push(argv[i]);
  }
  for (const k of ['runs', 'holdout', 'explore', 'batch']) opts[k] = Number(opts[k]);
  return { file: files[0], opts };
}

function parseCsv(text) {
  const [header, ...rows] = text.trim().split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  const cols = header.split(',').map((c) => c.trim().toLowerCase());
  const need = ['test', 'variant', 'impressions', 'checkouts', 'subscriptions'];
  for (const c of need) if (!cols.includes(c)) throw new Error(`CSV is missing column "${c}"`);
  const tests = new Map();
  for (const row of rows) {
    const cells = row.split(',').map((c) => c.trim());
    const r = Object.fromEntries(cols.map((c, i) => [c, cells[i]]));
    const v = {
      id: r.variant,
      impressions: Number(r.impressions),
      checkoutRate: Number(r.checkouts) / Number(r.impressions),
      subRate: Number(r.subscriptions) / Number(r.impressions),
      value: r.value ? Number(r.value) : 1,
      control: r.control === '1' || r.control === 'true',
    };
    if (!tests.has(r.test)) tests.set(r.test, []);
    tests.get(r.test).push(v);
  }
  return tests;
}

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

function visit(v, arm, totals, rng) {
  arm.visits++;
  if (rng() < v.checkoutRate) {
    arm.checkout++;
    // P(subscribe | checkout) so that P(subscribe) matches the observed rate.
    if (rng() < v.subRate / v.checkoutRate) {
      arm.subscribed++;
      totals.subs++;
      totals.revenue += v.value;
    }
  }
}

function simulate(variants, total, strategy, opts, rng) {
  const arms = variants.map((v) => ({ id: v.id, value: v.value, visits: 0, checkout: 0, subscribed: 0 }));
  const byId = Object.fromEntries(variants.map((v, i) => [v.id, { v, arm: arms[i] }]));
  const totals = { subs: 0, revenue: 0 };
  const control = variants.find((v) => v.control);
  const banditArms = arms.filter((a) => !control || a.id !== control.id);
  const makeSampler = MODES.paywall.rewards[opts.reward];

  // Posteriors are refreshed in batches, like a production system that recomputes every minute.
  let sampler = makeSampler(banditArms);
  for (let i = 0; i < total; i++) {
    let id;
    if (strategy === 'even') id = variants[i % variants.length].id;
    else if (control && rng() < opts.holdout) id = control.id;
    else id = chooseArm(banditArms, { explore: opts.explore, sampler, rng });
    visit(byId[id].v, byId[id].arm, totals, rng);
    if (strategy === 'bandit' && i % opts.batch === 0) sampler = makeSampler(banditArms);
  }
  return { totals, arms };
}

function main() {
  const { file, opts } = parseArgs(process.argv.slice(2));
  if (!file) {
    console.error('usage: node scripts/replay.js <file.csv> [--reward revenue|subscribed|checkout] [--runs 20]');
    process.exit(1);
  }
  if (!MODES.paywall.rewards[opts.reward]) throw new Error(`Unknown reward "${opts.reward}"`);
  const tests = parseCsv(fs.readFileSync(file, 'utf8'));
  const fmt = (x) => Math.round(x).toLocaleString('de-DE');
  const sum = { even: { subs: 0, revenue: 0 }, bandit: { subs: 0, revenue: 0 } };

  console.log(`reward: ${opts.reward} · holdout: ${opts.holdout} · explore: ${opts.explore} · runs: ${opts.runs}\n`);
  for (const [name, variants] of tests) {
    const total = variants.reduce((s, v) => s + v.impressions, 0);
    const avg = { even: { subs: 0, revenue: 0 }, bandit: { subs: 0, revenue: 0 } };
    const share = Object.fromEntries(variants.map((v) => [v.id, 0]));
    for (let r = 0; r < opts.runs; r++) {
      for (const strategy of ['even', 'bandit']) {
        const { totals, arms } = simulate(variants, total, strategy, opts, makeRng(1000 + r));
        avg[strategy].subs += totals.subs / opts.runs;
        avg[strategy].revenue += totals.revenue / opts.runs;
        if (strategy === 'bandit') for (const a of arms) share[a.id] += a.visits / total / opts.runs;
      }
    }
    for (const s of ['even', 'bandit']) {
      sum[s].subs += avg[s].subs;
      sum[s].revenue += avg[s].revenue;
    }
    const d = (k) => avg.bandit[k] - avg.even[k];
    const p = (k) => (avg.even[k] ? ` (${d(k) >= 0 ? '+' : ''}${((d(k) / avg.even[k]) * 100).toFixed(1)}%)` : '');
    console.log(`${name}: ${fmt(total)} impressions, ${variants.length} variants`);
    console.log(`  even split   ${fmt(avg.even.subs)} subs   ${fmt(avg.even.revenue)} revenue`);
    console.log(`  bandit       ${fmt(avg.bandit.subs)} subs   ${fmt(avg.bandit.revenue)} revenue`);
    console.log(`  difference   ${d('subs') >= 0 ? '+' : ''}${fmt(d('subs'))} subs${p('subs')}   ${d('revenue') >= 0 ? '+' : ''}${fmt(d('revenue'))} revenue${p('revenue')}`);
    console.log(`  bandit traffic: ${variants.map((v) => `${v.id}${v.control ? ' (control)' : ''} ${(share[v.id] * 100).toFixed(0)}%`).join(', ')}\n`);
  }
  if (tests.size > 1) {
    console.log(`all tests: ${fmt(sum.bandit.subs - sum.even.subs)} extra subs, ${fmt(sum.bandit.revenue - sum.even.revenue)} extra revenue`);
  }
}

main();
