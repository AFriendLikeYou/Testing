'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chooseArm, expectedShare } = require('./lib/bandit');

const PORT = Number(process.env.PORT) || 3000;
// Which signal the bandit optimises: 'converted' or 'engaged'.
const REWARD = process.env.REWARD === 'engagement' ? 'engaged' : 'converted';
const EXPLORE = Number(process.env.EXPLORE ?? 0.05);
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = path.join(__dirname, 'data', 'state.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function loadLayouts() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'layouts.json'), 'utf8'));
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { arms: {}, visitors: {} };
  }
}

const state = loadState();

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(state));
  }, 500);
}

function armStats(id) {
  if (!state.arms[id]) state.arms[id] = { visits: 0, engaged: 0, converted: 0 };
  return state.arms[id];
}

// layouts.json is re-read on every request so new variants go live without a restart.
function activeArms() {
  return loadLayouts()
    .filter((l) => l.active)
    .map((l) => ({ ...l, ...armStats(l.id) }));
}

function banditArms(arms) {
  return arms.map((a) => ({ id: a.id, trials: a.visits, successes: a[REWARD] }));
}

function assign(visitorId) {
  const arms = activeArms();
  const known = state.visitors[visitorId];
  // Sticky: a returning visitor keeps their layout as long as it is still running.
  if (known && arms.some((a) => a.id === known.arm)) return known.arm;
  const arm = chooseArm(banditArms(arms), { explore: EXPLORE });
  state.visitors[visitorId] = { arm, engaged: false, converted: false, ts: Date.now() };
  armStats(arm).visits++;
  scheduleSave();
  return arm;
}

function record(visitorId, type) {
  const v = state.visitors[visitorId];
  if (!v || (type !== 'engaged' && type !== 'converted')) return false;
  const marks = type === 'converted' ? ['engaged', 'converted'] : ['engaged'];
  for (const m of marks) {
    if (v[m]) continue;
    v[m] = true;
    armStats(v.arm)[m]++;
  }
  scheduleSave();
  return true;
}

function stats() {
  const arms = activeArms();
  const { pBest, share } = expectedShare(banditArms(arms), { explore: EXPLORE });
  const top = arms.reduce((best, a) => (pBest[a.id] > (pBest[best?.id] ?? -1) ? a : best), null);
  return {
    reward: REWARD,
    explore: EXPLORE,
    top: top?.id ?? null,
    arms: arms.map((a) => ({
      id: a.id,
      name: a.name,
      tagline: a.tagline,
      visits: a.visits,
      conversion: a.visits ? a.converted / a.visits : 0,
      engagement: a.visits ? a.engaged / a.visits : 0,
      pBest: pBest[a.id],
      share: share[a.id],
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
  const file = path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath);
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
    return send(res, 200, { layout: assign(visitorId) });
  }
  if (req.method === 'POST' && req.url === '/api/event') {
    const { visitorId, type } = await readJson(req);
    return send(res, record(visitorId, type) ? 200 : 400, {});
  }
  if (req.method === 'GET' && req.url === '/api/stats') return send(res, 200, stats());
  if (req.method === 'GET') return serveStatic(req, res);
  send(res, 405, { error: 'method' });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Portfolio bandit on http://localhost:${PORT}  (reward: ${REWARD}, explore: ${EXPLORE})`);
    console.log(`Dashboard: http://localhost:${PORT}/?dashboard`);
  });
}

module.exports = { server };
