'use strict';

// The server runs in one mode at a time (MODE=portfolio|paywall). A mode defines its
// variants file, which events exist, what the bandit optimises and what the dashboard shows.

const { sampleBeta, betaSampler } = require('./bandit');

const rate = (a, key) => (a.visits ? a[key] / a.visits : 0);

const bernoulli = (key) => {
  const beta = betaSampler();
  return () => (arm, rng) => beta({ trials: arm.visits, successes: arm[key] }, rng);
};

// Pseudo-observations for the checkout→subscription prior: a variant's own completion rate
// only takes over once it has more checkouts than this.
const COMPLETION_PRIOR_STRENGTH = 20;

const PAYWALL_REWARDS = {
  // Optimise subscriptions per impression.
  subscribed: bernoulli('subscribed'),
  // Optimise expected revenue per impression: P(subscribe) × value of the offer.
  revenue: () => (arm, rng) =>
    sampleBeta(1 + arm.subscribed, 1 + arm.visits - arm.subscribed, rng) * arm.value,
  // Learn fast from checkout starts, but weight them by how often checkouts of *this* variant
  // turn into subscriptions (pooled rate as prior until the variant has its own data).
  checkout: (arms) => {
    const checkouts = arms.reduce((s, a) => s + a.checkout, 0);
    const subs = arms.reduce((s, a) => s + a.subscribed, 0);
    const pooled = checkouts ? subs / checkouts : 0.3;
    const a0 = COMPLETION_PRIOR_STRENGTH * pooled;
    const b0 = COMPLETION_PRIOR_STRENGTH * (1 - pooled);
    return (arm, rng) =>
      sampleBeta(1 + arm.checkout, 1 + arm.visits - arm.checkout, rng) *
      sampleBeta(a0 + arm.subscribed, b0 + arm.checkout - arm.subscribed, rng) *
      arm.value;
  },
};

const MODES = {
  portfolio: {
    variantsFile: 'layouts.json',
    page: 'index.html',
    events: ['engaged', 'converted'],
    implies: { converted: ['engaged'] },
    rewards: { converted: bernoulli('converted'), engagement: bernoulli('engaged') },
    defaultReward: 'converted',
    holdout: 0,
    metrics: [
      { label: 'Conversion', value: (a) => rate(a, 'converted'), format: 'pct' },
      { label: 'Engagement', value: (a) => rate(a, 'engaged'), format: 'pct' },
    ],
    // What "uplift vs. control" is measured in; unused without a control group.
    upliftValue: (a) => rate(a, 'converted'),
  },

  paywall: {
    variantsFile: 'paywalls.json',
    page: 'paywall.html',
    events: ['checkout', 'subscribed'],
    implies: { subscribed: ['checkout'] },
    rewards: PAYWALL_REWARDS,
    defaultReward: 'revenue',
    holdout: 0.1,
    metrics: [
      { label: 'Bestellstrecke', value: (a) => rate(a, 'checkout'), format: 'pct' },
      { label: 'Abschluss', value: (a) => rate(a, 'subscribed'), format: 'pct2' },
      { label: 'Umsatz / 1.000', value: (a) => rate(a, 'subscribed') * a.value * 1000, format: 'eur' },
    ],
    upliftValue: (a) => rate(a, 'subscribed') * a.value,
  },
};

function getMode(name) {
  const mode = MODES[name];
  if (!mode) throw new Error(`Unknown MODE "${name}". Use one of: ${Object.keys(MODES).join(', ')}`);
  return mode;
}

module.exports = { MODES, getMode };
