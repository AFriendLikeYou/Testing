'use strict';

// Thompson sampling. An arm is any object with an `id`; a sampler draws one plausible
// value of the arm's reward from its posterior. The default sampler is Beta-Bernoulli
// over { trials, successes }.

const DEFAULT_PRIOR = { a: 1, b: 1 };

function randn(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Marsaglia–Tsang
function sampleGamma(k, rng) {
  if (k < 1) return sampleGamma(k + 1, rng) * Math.pow(rng(), 1 / k);
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x;
    let v;
    do {
      x = randn(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function sampleBeta(a, b, rng = Math.random) {
  const x = sampleGamma(a, rng);
  const y = sampleGamma(b, rng);
  return x / (x + y);
}

function posterior(arm, prior = DEFAULT_PRIOR) {
  return { a: prior.a + arm.successes, b: prior.b + arm.trials - arm.successes };
}

function betaSampler(prior = DEFAULT_PRIOR) {
  return (arm, rng) => {
    const p = posterior(arm, prior);
    return sampleBeta(p.a, p.b, rng);
  };
}

function argmaxDraw(arms, sampler, rng) {
  let best = arms[0].id;
  let bestDraw = -Infinity;
  for (const arm of arms) {
    const draw = sampler(arm, rng);
    if (draw > bestDraw) {
      bestDraw = draw;
      best = arm.id;
    }
  }
  return best;
}

// With probability `explore` pick uniformly, otherwise pick the arm with the highest posterior draw.
// The floor keeps losing arms observable so a shift in visitor behaviour can still be detected.
function chooseArm(arms, { explore = 0.05, prior, sampler = betaSampler(prior), rng = Math.random } = {}) {
  if (!arms.length) throw new Error('chooseArm: no arms');
  if (rng() < explore) return arms[Math.floor(rng() * arms.length)].id;
  return argmaxDraw(arms, sampler, rng);
}

// Monte Carlo estimate of P(arm is best). Also equals the share of traffic Thompson
// sampling sends to each arm right now (before the exploration floor).
function probabilityBest(arms, { draws = 4000, prior, sampler = betaSampler(prior), rng = Math.random } = {}) {
  const wins = Object.fromEntries(arms.map((a) => [a.id, 0]));
  if (!arms.length) return wins;
  for (let i = 0; i < draws; i++) wins[argmaxDraw(arms, sampler, rng)]++;
  for (const id in wins) wins[id] /= draws;
  return wins;
}

function expectedShare(arms, opts = {}) {
  const explore = opts.explore ?? 0.05;
  const pBest = probabilityBest(arms, opts);
  const share = {};
  for (const arm of arms) share[arm.id] = (1 - explore) * pBest[arm.id] + explore / arms.length;
  return { pBest, share };
}

module.exports = { sampleBeta, posterior, betaSampler, chooseArm, probabilityBest, expectedShare };
