'use strict';

// Simulates visitors against made-up "true" conversion rates to show how Thompson
// sampling shifts traffic, and what happens when a new (AI-generated) variant joins mid-run.
//   node scripts/simulate.js [visitors] [seed]

const { chooseArm, expectedShare } = require('../lib/bandit');

const VISITORS = Number(process.argv[2]) || 6000;
let seed = Number(process.argv[3]) || 42;
// mulberry32, so runs are reproducible
const rng = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const TRUE_RATE = { stack: 0.048, grid: 0.031, carousel: 0.039, index: 0.024, 'ai-v1': 0.056 };
const NEW_ARM_AT = Math.floor(VISITORS / 2);
const WINDOW = Math.floor(VISITORS / 12);

const arms = ['stack', 'grid', 'carousel', 'index'].map((id) => ({ id, trials: 0, successes: 0 }));
let windowCounts = {};

const pad = (s, n) => String(s).padEnd(n);
const header = () => console.log(pad('visitors', 10) + arms.map((a) => pad(a.id, 10)).join(''));
header();

for (let i = 1; i <= VISITORS; i++) {
  if (i === NEW_ARM_AT) {
    arms.push({ id: 'ai-v1', trials: 0, successes: 0 });
    console.log(`--- visitor ${i}: new variant "ai-v1" goes live ---`);
    header();
  }
  const id = chooseArm(arms, { rng });
  const arm = arms.find((a) => a.id === id);
  arm.trials++;
  if (rng() < TRUE_RATE[id]) arm.successes++;
  windowCounts[id] = (windowCounts[id] || 0) + 1;

  if (i % WINDOW === 0) {
    const total = Object.values(windowCounts).reduce((a, b) => a + b, 0);
    console.log(pad(i, 10) + arms.map((a) => pad(`${(((windowCounts[a.id] || 0) / total) * 100).toFixed(0)}%`, 10)).join(''));
    windowCounts = {};
  }
}

const { pBest } = expectedShare(arms, { rng });
console.log('\nfinal          visits  conv    true    P(best)');
for (const a of arms) {
  console.log(
    pad(a.id, 15) + pad(a.trials, 8) + pad(`${((a.successes / a.trials) * 100).toFixed(1)}%`, 8) +
      pad(`${(TRUE_RATE[a.id] * 100).toFixed(1)}%`, 8) + `${(pBest[a.id] * 100).toFixed(0)}%`,
  );
}
