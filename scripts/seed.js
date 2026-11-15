'use strict';

// Sends simulated test visitors to a running server so the dashboard has something to show.
//   node scripts/seed.js [--port 3000] [--visitors 3000]
// Each variant gets a made-up "true" rate (printed at the start). Test data only.

const raw = process.argv.slice(2);
const arg = (k, d) => (raw.includes(`--${k}`) ? raw[raw.indexOf(`--${k}`) + 1] : d);
const base = `http://localhost:${arg('port', process.env.PORT || 3000)}`;
const visitors = Number(arg('visitors', 3000));

// Rates are exaggerated compared to real paywalls so that differences show up within a few
// thousand visitors.
const EVENTS = {
  paywall: { first: 'checkout', second: 'subscribed', rate: 0.08, completion: 0.3 },
  portfolio: { first: 'engaged', second: 'converted', rate: 0.5, completion: 0.08 },
};

const post = (p, body) => fetch(base + p, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json());

async function main() {
  let stats;
  try {
    stats = await (await fetch(`${base}/api/stats`)).json();
  } catch {
    console.error(`No server at ${base}. Start it first (npm start or npm run start:paywall).`);
    process.exit(1);
  }
  const ev = EVENTS[stats.mode];
  // Spread the variants ±40 % around the base rate so there is something to find.
  const truth = Object.fromEntries(stats.arms.map((a, i) => {
    const lift = 0.6 + (0.8 * i) / Math.max(1, stats.arms.length - 1);
    return [a.id, { first: ev.rate * lift, second: ev.rate * lift * ev.completion }];
  }));
  console.log(`Seeding ${visitors} test visitors into ${stats.mode} mode at ${base}`);
  for (const [id, t] of Object.entries(truth)) {
    console.log(`  ${id.padEnd(12)} ${ev.first} ${(t.first * 100).toFixed(1)} %  ${ev.second} ${(t.second * 100).toFixed(2)} %`);
  }

  for (let i = 0; i < visitors; i++) {
    const visitorId = `seed-${Date.now().toString(36)}-${i}`;
    const { variant } = await post('/api/assign', { visitorId });
    const t = truth[variant];
    // Variants added after seeding started have no truth; treat them like the average.
    const first = t?.first ?? ev.rate;
    const second = t?.second ?? ev.rate * ev.completion;
    if (Math.random() < first) {
      await post('/api/event', { visitorId, type: ev.first });
      if (Math.random() < second / first) await post('/api/event', { visitorId, type: ev.second });
    }
    if ((i + 1) % 500 === 0) console.log(`  ${i + 1} visitors`);
  }
  console.log('Done. Open the Dashboard tab.');
}

main();
