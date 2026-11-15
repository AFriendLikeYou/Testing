'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chooseArm, expectedShare } = require('./lib/bandit');
const { getMode } = require('./lib/modes');

const PORT = Number(process.env.PORT) || 3000;
// --mode=<name> works on every OS; MODE=<name> as an environment variable works too.
const modeArg = process.argv.find((a) => a.startsWith('--mode='));
const MODE_NAME = modeArg?.slice('--mode='.length) || process.env.MODE || 'portfolio';
const MODE = getMode(MODE_NAME);
const REWARD = process.env.REWARD || MODE.defaultReward;
if (!MODE.rewards[REWARD]) {
  throw new Error(`Unknown REWARD "${REWARD}" for mode ${MODE_NAME}. Use one of: ${Object.keys(MODE.rewards).join(', ')}`);
}
const EXPLORE = Number(process.env.EXPLORE ?? 0.05);
// Share of traffic that always sees the control variant, outside the bandit.
const HOLDOUT = Number(process.env.HOLDOUT ?? MODE.holdout);
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, `state-${MODE_NAME}.json`);
// One line per assignment with the probability it was chosen with, so effects can later
// be estimated without the bias adaptive allocation introduces (inverse propensity weighting).
const IMPRESSION_LOG = path.join(DATA_DIR, `impressions-${MODE_NAME}.jsonl`);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function loadVariants() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, MODE.variantsFile), 'utf8'));
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { arms: {}, visitors: {} };
  }
}

const state = loadState();
fs.mkdirSync(DATA_DIR, { recursive: true });

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.writeFileSync(DATA_FILE, JSON.stringify(state));
  }, 500);
}

function armStats(id) {
  if (!state.arms[id]) state.arms[id] = Object.fromEntries(['visits', ...MODE.events].map((k) => [k, 0]));
  return state.arms[id];
}

// The variants file is re-read on every request so new variants go live without a restart.
function activeArms() {
  return loadVariants()
    .filter((v) => v.active)
    .map((v) => ({ ...v, ...armStats(v.id) }));
}

function splitArms(arms) {
  const control = HOLDOUT > 0 ? arms.find((a) => a.control) : undefined;
  return { control, bandit: arms.filter((a) => a !== control) };
}

function shares(banditArms) {
  return expectedShare(banditArms, { explore: EXPLORE, sampler: MODE.rewards[REWARD](banditArms) });
}

// Thompson sampling has no closed-form choice probability, so the propensity logged with each
// impression is the Monte Carlo share, refreshed every few seconds.
let shareCache = { at: 0, share: {} };
function cachedShare(banditArms) {
  if (Date.now() - shareCache.at > 5000) shareCache = { at: Date.now(), share: shares(banditArms).share };
  return shareCache.share;
}

function assign(visitorId) {
  const arms = activeArms();
  const known = state.visitors[visitorId];
  // Sticky: a returning visitor keeps their variant as long as it is still running.
  if (known && arms.some((a) => a.id === known.arm)) return { arm: known.arm, how: 'returning' };

  const { control, bandit } = splitArms(arms);
  let arm;
  let propensity;
  let how = 'bandit';
  if (control && (Math.random() < HOLDOUT || !bandit.length)) {
    arm = control.id;
    how = 'control';
    propensity = bandit.length ? HOLDOUT : 1;
  } else {
    arm = chooseArm(bandit, { explore: EXPLORE, sampler: MODE.rewards[REWARD](bandit) });
    propensity = (control ? 1 - HOLDOUT : 1) * (cachedShare(bandit)[arm] ?? 1 / bandit.length);
  }

  state.visitors[visitorId] = { arm, events: {}, ts: Date.now() };
  armStats(arm).visits++;
  fs.appendFileSync(IMPRESSION_LOG, JSON.stringify({ ts: Date.now(), visitorId, arm, propensity }) + '\n');
  scheduleSave();
  return { arm, how };
}

function record(visitorId, type) {
  const v = state.visitors[visitorId];
  if (!v || !MODE.events.includes(type)) return false;
  // Older state files stored events as top-level booleans.
  v.events ||= {};
  for (const e of [type, ...(MODE.implies[type] || [])]) {
    if (v.events[e]) continue;
    v.events[e] = true;
    armStats(v.arm)[e]++;
  }
  scheduleSave();
  return true;
}

function stats() {
  const arms = activeArms();
  const { control, bandit } = splitArms(arms);
  const { pBest, share } = bandit.length ? shares(bandit) : { pBest: {}, share: {} };
  const top = bandit.reduce((best, a) => (pBest[a.id] > (pBest[best?.id] ?? -1) ? a : best), null);
  const controlValue = control?.visits ? MODE.upliftValue(control) : null;

  return {
    mode: MODE_NAME,
    reward: REWARD,
    explore: EXPLORE,
    holdout: control ? HOLDOUT : 0,
    top: top?.id ?? null,
    metrics: MODE.metrics.map((m) => ({ label: m.label, format: m.format })),
    arms: arms.map((a) => ({
      id: a.id,
      name: a.name,
      tagline: a.tagline,
      control: a === control,
      visits: a.visits,
      metrics: MODE.metrics.map((m) => m.value(a)),
      uplift: controlValue && a !== control && a.visits ? MODE.upliftValue(a) / controlValue - 1 : null,
      pBest: a === control ? null : pBest[a.id],
      share: a === control ? HOLDOUT : (1 - (control ? HOLDOUT : 0)) * share[a.id],
    })),
  };
}

function readJson(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 10_000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

function send(res, status, data) {
  res.writeHead(status, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(PUBLIC_DIR, urlPath === '/' ? MODE.page : urlPath);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

const VALID_ID = /^[a-zA-Z0-9-]{8,64}$/;

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/assign') {
    const { visitorId } = await readJson(req);
    if (!VALID_ID.test(visitorId || '')) return send(res, 400, { error: 'visitorId' });
    const { arm, how } = assign(visitorId);
    // `how` tells the page why it got this variant: returning visitor, control group or bandit.
    return send(res, 200, { variant: arm, how });
  }
  if (req.method === 'POST' && req.url === '/api/event') {
    const { visitorId, type } = await readJson(req);
    return send(res, record(visitorId, type) ? 200 : 400, {});
  }
  if (req.method === 'GET' && req.url === '/api/stats') return send(res, 200, stats());
  if (req.method === 'GET' && req.url === '/api/variants') return send(res, 200, loadVariants());
  if (req.method === 'GET') return serveStatic(req, res);
  send(res, 405, { error: 'method' });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Bandit (${MODE_NAME}) on http://localhost:${PORT}  reward: ${REWARD}, explore: ${EXPLORE}, holdout: ${HOLDOUT}`);
    console.log(`Dashboard: http://localhost:${PORT}/?dashboard`);
  });
}

module.exports = { server };
