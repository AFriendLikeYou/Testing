'use strict';

// How large must a difference be to be detectable with our traffic, and how long does it take?
//   node analysis/power.js [--daily 50000] [--variants 4] [--alpha 0.05] [--power 0.8]
// --daily is paywall impressions per day across all variants.

const { normInv } = require('./stats');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const daily = Number(args.daily ?? 50000);
const variants = Number(args.variants ?? 4);
const alpha = Number(args.alpha ?? 0.05);
const power = Number(args.power ?? 0.8);

// Each non-control variant is compared with control; Bonferroni keeps the family-wise error at alpha.
const comparisons = Math.max(1, variants - 1);
const zA = normInv(1 - alpha / comparisons / 2);
const zB = normInv(power);

function nPerArm(p0, lift) {
  const p1 = p0 * (1 + lift);
  return Math.ceil(((zA + zB) ** 2 * (p0 * (1 - p0) + p1 * (1 - p1))) / (p1 - p0) ** 2);
}

const baselines = [0.002, 0.005, 0.01, 0.02];
const lifts = [0.02, 0.05, 0.1, 0.2];
const pad = (s, n) => String(s).padStart(n);

console.log(`Impressions per day: ${daily.toLocaleString('de-DE')} across ${variants} variants · alpha ${alpha} (Bonferroni, ${comparisons} comparisons) · power ${power}\n`);
console.log('Days until a relative lift is detectable (impressions per arm in brackets)\n');
console.log(pad('baseline', 9) + lifts.map((l) => pad(`+${l * 100}%`, 22)).join(''));
for (const p0 of baselines) {
  const cells = lifts.map((l) => {
    const n = nPerArm(p0, l);
    const days = n / (daily / variants);
    const d = days > 365 ? '>1 year' : `${days.toFixed(days < 10 ? 1 : 0)} d`;
    return pad(`${d} (${(n / 1000).toFixed(0)}k)`, 22);
  });
  console.log(pad(`${(p0 * 100).toFixed(1)}%`, 9) + cells.join(''));
}
