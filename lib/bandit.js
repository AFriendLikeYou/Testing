'use strict';

// Beta-Bernoulli Thompson sampling. An arm is { id, trials, successes }.

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

// With probability `explore` pick uniformly, otherwise pick the arm with the highest posterior draw.
// The floor keeps losing arms observable so a shift in visitor behaviour can still be detected.
function chooseArm(arms, { explore = 0.05, prior = DEFAULT_PRIOR, rng = Math.random } = {}) {
  if (!arms.length) throw new Error('chooseArm: no arms');
  if (rng() < explore) return arms[Math.floor(rng() * arms.length)].id;
  let best = arms[0].id;
  let bestDraw = -1;
  for (const arm of arms) {
    const p = posterior(arm, prior);
    const draw = sampleBeta(p.a, p.b, rng);
    if (draw > bestDraw) {
      bestDraw = draw;
      best = arm.id;
    }
  }
  return best;
}

// Monte Carlo estimate of P(arm is best). Also equals the share of traffic Thompson
// sampling sends to each arm right now (before the exploration floor).
function probabilityBest(arms, { draws = 4000, prior = DEFAULT_PRIOR, rng = Math.random } = {}) {
  const wins = Object.fromEntries(arms.map((a) => [a.id, 0]));
  if (!arms.length) return wins;
  const posts = arms.map((a) => ({ id: a.id, ...posterior(a, prior) }));
  for (let i = 0; i < draws; i++) {
    let best = posts[0].id;
    let bestDraw = -1;
    for (const p of posts) {
      const draw = sampleBeta(p.a, p.b, rng);
      if (draw > bestDraw) {
        bestDraw = draw;
        best = p.id;
      }
    }
    wins[best]++;
  }
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

module.exports = { sampleBeta, posterior, chooseArm, probabilityBest, expectedShare };
