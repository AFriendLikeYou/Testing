'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chooseArm } = require('../lib/bandit');
const { MODES } = require('../lib/modes');

const { rewards } = MODES.paywall;
const arm = (id, visits, checkout, subscribed, value) => ({ id, visits, checkout, subscribed, value });

function winShare(arms, sampler, id, n = 2000) {
  let wins = 0;
  for (let i = 0; i < n; i++) if (chooseArm(arms, { explore: 0, sampler }) === id) wins++;
  return wins / n;
}

test('revenue reward prefers fewer but more valuable subscriptions', () => {
  const arms = [arm('cheap', 10000, 400, 100, 40), arm('premium', 10000, 200, 60, 150)];
  assert.ok(winShare(arms, rewards.revenue(arms), 'premium') > 0.95);
  assert.ok(winShare(arms, rewards.subscribed(arms), 'cheap') > 0.95);
});

test('checkout reward discounts variants whose checkouts do not complete', () => {
  // "clicky" sends more people into checkout, but few of them subscribe.
  const arms = [arm('clicky', 10000, 600, 60, 80), arm('solid', 10000, 400, 160, 80)];
  assert.ok(winShare(arms, rewards.checkout(arms), 'solid') > 0.95);
});

test('server: holdout, sticky assignment, events and propensity log', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bandit-'));
  Object.assign(process.env, { MODE: 'paywall', DATA_DIR: dir, HOLDOUT: '0.2' });
  const { server } = require('../server');
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const post = (p, body) => fetch(base + p, { method: 'POST', body: JSON.stringify(body) });

  try {
    const ids = Array.from({ length: 500 }, (_, i) => `visitor-${String(i).padStart(4, '0')}`);
    const assigned = [];
    for (const visitorId of ids) assigned.push((await (await post('/api/assign', { visitorId })).json()).variant);

    const again = await (await post('/api/assign', { visitorId: ids[0] })).json();
    assert.strictEqual(again.variant, assigned[0], 'assignment is sticky');
    assert.strictEqual(again.how, 'returning');

    const controlShare = assigned.filter((v) => v === 'control').length / assigned.length;
    assert.ok(controlShare > 0.12 && controlShare < 0.28, `control share ${controlShare}`);

    assert.strictEqual((await post('/api/event', { visitorId: ids[1], type: 'subscribed' })).status, 200);
    assert.strictEqual((await post('/api/event', { visitorId: ids[1], type: 'bogus' })).status, 400);

    const stats = await (await fetch(base + '/api/stats')).json();
    const a = stats.arms.find((x) => x.id === assigned[1]);
    assert.ok(a.metrics[0] > 0 && a.metrics[1] > 0, 'subscribed implies checkout');
    assert.strictEqual(stats.arms.find((x) => x.control).pBest, null);

    const log = fs.readFileSync(path.join(dir, 'impressions-paywall.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.strictEqual(log.length, 500);
    assert.ok(log.every((l) => l.propensity > 0 && l.propensity <= 1));
  } finally {
    server.close();
  }
});
