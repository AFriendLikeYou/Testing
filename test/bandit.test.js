'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { sampleBeta, chooseArm, probabilityBest, expectedShare } = require('../lib/bandit');

test('sampleBeta has the right mean', () => {
  let sum = 0;
  const n = 20000;
  for (let i = 0; i < n; i++) sum += sampleBeta(3, 7);
  assert.ok(Math.abs(sum / n - 0.3) < 0.01);
});

test('sampleBeta works for shape < 1', () => {
  for (let i = 0; i < 1000; i++) {
    const x = sampleBeta(0.5, 0.5);
    assert.ok(x >= 0 && x <= 1);
  }
});

test('chooseArm favours the clearly better arm', () => {
  const arms = [
    { id: 'good', trials: 1000, successes: 60 },
    { id: 'bad', trials: 1000, successes: 20 },
  ];
  let good = 0;
  for (let i = 0; i < 1000; i++) if (chooseArm(arms, { explore: 0 }) === 'good') good++;
  assert.ok(good > 990);
});

test('exploration floor keeps sending traffic to losers', () => {
  const arms = [
    { id: 'good', trials: 1000, successes: 60 },
    { id: 'bad', trials: 1000, successes: 20 },
  ];
  let bad = 0;
  for (let i = 0; i < 10000; i++) if (chooseArm(arms, { explore: 0.1 }) === 'bad') bad++;
  assert.ok(bad > 350 && bad < 650); // ~5%
});

test('a brand-new arm gets explored', () => {
  const arms = [
    { id: 'old', trials: 5000, successes: 200 },
    { id: 'new', trials: 0, successes: 0 },
  ];
  const p = probabilityBest(arms);
  assert.ok(p.new > 0.8, `new arm P(best)=${p.new}`);
});

test('shares sum to 1', () => {
  const arms = [
    { id: 'a', trials: 100, successes: 5 },
    { id: 'b', trials: 100, successes: 4 },
    { id: 'c', trials: 10, successes: 0 },
  ];
  const { pBest, share } = expectedShare(arms, { explore: 0.05 });
  const sum = (o) => Object.values(o).reduce((x, y) => x + y, 0);
  assert.ok(Math.abs(sum(pBest) - 1) < 1e-9);
  assert.ok(Math.abs(sum(share) - 1) < 1e-9);
});
