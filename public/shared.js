'use strict';

// Shared by every mode's page: visitor id, assignment, event tracking and the dashboard.

const Bandit = (() => {
  const params = new URLSearchParams(location.search);
  let tracking = false;
  const sent = new Set();

  function getVisitorId() {
    try {
      let id = localStorage.getItem('pb-visitor');
      if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem('pb-visitor', id);
      }
      return id;
    } catch {
      return crypto.randomUUID();
    }
  }

  const visitorId = getVisitorId();

  function track(type) {
    if (!tracking || sent.has(type)) return;
    sent.add(type);
    const body = JSON.stringify({ visitorId, type });
    if (!navigator.sendBeacon?.('/api/event', body)) {
      fetch('/api/event', { method: 'POST', body, keepalive: true }).catch(() => {});
    }
  }

  // ?variant=<id> is preview mode: show that variant without assigning or counting anything.
  async function assign(fallback) {
    const forced = params.get('variant');
    if (forced) return forced;
    try {
      const res = await fetch('/api/assign', { method: 'POST', body: JSON.stringify({ visitorId }) });
      const { variant } = await res.json();
      tracking = true;
      return variant;
    } catch {
      return fallback;
    }
  }

  // ---------- dashboard ----------

  const FORMAT = {
    pct: (x) => `${(x * 100).toFixed(1)}%`,
    pct2: (x) => `${(x * 100).toFixed(2)}%`,
    eur: (x) => `${x.toFixed(0)} €`,
  };
  const pct0 = (x) => `${(x * 100).toFixed(0)}%`;
  const tone = (rank, n) => (rank === 0 ? 'var(--good)' : rank === n - 1 ? 'var(--bad)' : 'var(--mid)');

  function metricHtml(label, text, width, color) {
    return `<div class="metric" style="color:${color}">
      <div class="row"><span class="muted">${label}</span><span>${text}</span></div>
      <div class="bar"><i style="width:${width}%"></i></div>
    </div>`;
  }

  let built = '';
  let timer = null;

  function build() {
    const root = document.getElementById('dashboard');
    if (root.dataset.built) return;
    root.dataset.built = '1';
    root.innerHTML = `<div class="dash-panel">
      <div class="dash-head">
        <span class="muted">Variant performance</span>
        <span id="dash-meta" class="muted"></span>
        <button id="dash-close" class="dash-close" aria-label="Close">×</button>
      </div>
      <div id="dash-grid" class="dash-grid"></div>
    </div>`;
    root.querySelector('#dash-close').addEventListener('click', closeDashboard);
  }

  async function refresh() {
    const s = await (await fetch('/api/stats')).json();
    build();
    const meta = [`optimising ${s.reward}`, `${pct0(s.explore)} exploration floor`];
    if (s.holdout) meta.push(`${pct0(s.holdout)} control group`);
    document.getElementById('dash-meta').textContent = meta.join(' · ');

    const grid = document.getElementById('dash-grid');
    const key = s.arms.map((a) => a.id).join();
    if (built !== key) {
      grid.innerHTML = s.arms.map((a, i) => `<div class="arm" data-id="${a.id}">
        <div class="arm-title"><span class="muted">${String(i + 1).padStart(2, '0')}</span>
          <span class="name">${a.name}</span><span class="muted">— ${a.tagline}</span>
          ${a.control ? '<span class="badge control">Control</span>' : '<span class="badge" hidden>Top</span>'}
          <span class="visits muted"></span></div>
        <div class="metrics" style="grid-template-columns:repeat(${s.metrics.length},1fr)"></div>
        <div class="bandit-line muted"></div>
        <div class="preview"><iframe src="/?variant=${a.id}" loading="lazy" tabindex="-1"></iframe>
          <a href="/?variant=${a.id}" target="_blank">Preview ↗</a></div>
      </div>`).join('');
      built = key;
    }

    const n = s.arms.length;
    const ranks = s.metrics.map((_, m) => [...s.arms].sort((a, b) => b.metrics[m] - a.metrics[m]).map((a) => a.id));
    const maxes = s.metrics.map((_, m) => Math.max(...s.arms.map((a) => a.metrics[m]), 1e-9));

    for (const a of s.arms) {
      const el = grid.querySelector(`[data-id="${a.id}"]`);
      if (!a.control) el.querySelector('.badge').hidden = a.id !== s.top;
      el.querySelector('.visits').textContent = `${a.visits.toLocaleString('en')} visits`;
      el.querySelector('.metrics').innerHTML = s.metrics.map((m, i) =>
        metricHtml(m.label, FORMAT[m.format](a.metrics[i]), (a.metrics[i] / maxes[i]) * 100, tone(ranks[i].indexOf(a.id), n)),
      ).join('');
      const parts = a.control
        ? [`fixed ${pct0(a.share)} of traffic`, 'baseline for uplift']
        : [`P(best) ${pct0(a.pBest)}`, `gets ${pct0(a.share)} of new traffic`];
      if (a.uplift !== null) parts.push(`${a.uplift >= 0 ? '+' : ''}${pct0(a.uplift)} vs. control`);
      el.querySelector('.bandit-line').textContent = parts.join(' · ');
    }
  }

  function openDashboard() {
    document.getElementById('dashboard').hidden = false;
    refresh();
    timer ||= setInterval(refresh, 3000);
  }

  function closeDashboard() {
    document.getElementById('dashboard').hidden = true;
    clearInterval(timer);
    timer = null;
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'd' && !e.metaKey && !e.ctrlKey && e.target === document.body) {
      document.getElementById('dashboard').hidden ? openDashboard() : closeDashboard();
    }
  });
  if (params.has('dashboard')) addEventListener('DOMContentLoaded', openDashboard);

  return { visitorId, track, assign, params, isTracking: () => tracking };
})();
