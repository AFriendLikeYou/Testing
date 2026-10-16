'use strict';

const PROJECTS = [
  { slug: 'commerce', title: 'Commerce Design System', meta: 'Design system · 2025', bg: 'linear-gradient(160deg,#1d3fd6,#0a1f8f)' },
  { slug: 'magazine', title: 'Magazine Redesign', meta: 'Editorial · 2025', bg: 'linear-gradient(160deg,#2b2b2b,#111)' },
  { slug: 'audio', title: 'Audio Brand Launch', meta: 'Campaign · 2024', bg: 'linear-gradient(160deg,#1fb84a,#0d6b2a)' },
  { slug: 'museum', title: 'Museum Wayfinding', meta: 'Spatial · 2024', bg: 'linear-gradient(160deg,#f2c230,#c98a00)' },
  { slug: 'fitness', title: 'Fitness App', meta: 'Product · 2023', bg: 'linear-gradient(160deg,#c46cf2,#7a2bb3)' },
  { slug: 'bank', title: 'Neobank Onboarding', meta: 'Product · 2023', bg: 'linear-gradient(160deg,#e2534a,#9b1f18)' },
];

const params = new URLSearchParams(location.search);
const work = document.getElementById('work');

// ---------- tracking ----------

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
const sent = new Set();
let tracking = false;

function track(type) {
  if (!tracking || sent.has(type)) return;
  sent.add(type);
  if (type === 'converted') sent.add('engaged');
  const body = JSON.stringify({ visitorId, type });
  if (!navigator.sendBeacon?.('/api/event', body)) {
    fetch('/api/event', { method: 'POST', body, keepalive: true }).catch(() => {});
  }
}

// Engagement must mean the same thing in every layout, otherwise the metric favours
// whichever layout happens to make it easy (e.g. scroll depth favours the tall Stack page).
// So: 20s of visible time, or any interaction with a project.
function watchEngagement() {
  let active = 0;
  setInterval(() => {
    if (document.visibilityState === 'visible' && (active += 1) >= 20) track('engaged');
  }, 1000);
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-convert]')) track('converted');
});

// ---------- layouts ----------

function cardHtml(p) {
  return `<article class="card" style="--card-bg:${p.bg}" data-slug="${p.slug}">
    <a class="open" href="#case/${p.slug}" data-convert>View case ↗</a>
    <h3>${p.title}</h3><p>${p.meta}</p>
  </article>`;
}

const LAYOUTS = {
  stack(el) {
    el.className = 'layout-stack';
    el.innerHTML = `<div class="stack-pile"></div><p class="stack-hint muted">Drag a card away to see the next one</p>`;
    const pile = el.querySelector('.stack-pile');
    const order = [...PROJECTS];

    function paint() {
      pile.innerHTML = order.map(cardHtml).reverse().join('');
      [...pile.children].reverse().forEach((card, i) => {
        card.style.zIndex = order.length - i;
        card.style.transform = `translateY(${i * 10}px) scale(${1 - i * 0.04}) rotate(${i % 2 ? 1.5 : -1.5}deg)`;
        if (i === 0) makeThrowable(card);
      });
    }

    function makeThrowable(card) {
      let startX = 0;
      let startY = 0;
      let dx = 0;
      let dy = 0;
      card.addEventListener('pointerdown', (e) => {
        if (e.target.closest('a')) return;
        startX = e.clientX;
        startY = e.clientY;
        card.setPointerCapture(e.pointerId);
        card.classList.add('dragging');
      });
      card.addEventListener('pointermove', (e) => {
        if (!card.classList.contains('dragging')) return;
        dx = e.clientX - startX;
        dy = e.clientY - startY;
        card.style.transform = `translate(${dx}px,${dy}px) rotate(${dx / 20}deg)`;
      });
      card.addEventListener('pointerup', () => {
        card.classList.remove('dragging');
        if (Math.hypot(dx, dy) > 120) {
          track('engaged');
          card.style.transform = `translate(${dx * 4}px,${dy * 4}px) rotate(${dx / 8}deg)`;
          setTimeout(() => {
            order.push(order.shift());
            paint();
          }, 250);
        } else {
          paint();
        }
        dx = dy = 0;
      });
    }

    paint();
  },

  grid(el) {
    el.className = 'layout-grid';
    el.innerHTML = PROJECTS.map(cardHtml).join('');
  },

  carousel(el) {
    el.className = 'layout-carousel';
    el.innerHTML = PROJECTS.map(cardHtml).join('');
    el.addEventListener('scroll', () => {
      if (el.scrollLeft > el.clientWidth * 0.5) track('engaged');
    }, { passive: true });
  },

  index(el) {
    el.className = 'layout-index';
    el.innerHTML = PROJECTS.map((p) => `<div class="index-row">
      <header><span>${p.title}</span><span class="muted">${p.meta}</span></header>
      ${cardHtml(p)}
    </div>`).join('');
  },
};

function render(layout) {
  (LAYOUTS[layout] || LAYOUTS.grid)(work);
  document.documentElement.dataset.layout = layout;
}

// ---------- dashboard ----------

const dash = document.getElementById('dashboard');
const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
const tone = (rank, n) => (rank === 0 ? 'var(--good)' : rank === n - 1 ? 'var(--bad)' : 'var(--mid)');

function metric(label, value, max, color) {
  const w = max ? Math.min(100, (value / max) * 100) : 0;
  return `<div class="metric" style="color:${color}">
    <div class="row"><span class="muted">${label}</span><span>${pct(value)}</span></div>
    <div class="bar"><i style="width:${w}%"></i></div>
  </div>`;
}

let previewsBuilt = false;

async function refreshDashboard() {
  const res = await fetch('/api/stats');
  const s = await res.json();
  document.getElementById('dash-meta').textContent =
    `optimising ${s.reward === 'converted' ? 'conversion' : 'engagement'} · ${pct(s.explore, 0)} exploration floor`;

  const n = s.arms.length;
  const rankBy = (key) => [...s.arms].sort((a, b) => b[key] - a[key]).map((a) => a.id);
  const convRank = rankBy('conversion');
  const engRank = rankBy('engagement');
  const maxConv = Math.max(...s.arms.map((a) => a.conversion), 0.0001);

  const grid = document.getElementById('dash-grid');
  if (!previewsBuilt || grid.children.length !== n) {
    grid.innerHTML = s.arms.map((a, i) => `<div class="arm" data-id="${a.id}">
      <div class="arm-title"><span class="muted">${String(i + 1).padStart(2, '0')}</span>
        <span class="name">${a.name}</span><span class="muted">— ${a.tagline}</span>
        <span class="badge" hidden>Top</span><span class="visits muted"></span></div>
      <div class="metrics"></div>
      <div class="bandit-line muted"></div>
      <div class="preview"><iframe src="/?layout=${a.id}" loading="lazy" tabindex="-1"></iframe>
        <a href="/?layout=${a.id}" target="_blank">Use this layout ↗</a></div>
    </div>`).join('');
    previewsBuilt = true;
  }

  for (const a of s.arms) {
    const el = grid.querySelector(`[data-id="${a.id}"]`);
    el.querySelector('.badge').hidden = a.id !== s.top;
    el.querySelector('.visits').textContent = `${a.visits.toLocaleString('en')} visits`;
    el.querySelector('.metrics').innerHTML =
      metric('Conversion', a.conversion, maxConv, tone(convRank.indexOf(a.id), n)) +
      metric('Engagement', a.engagement, 1, tone(engRank.indexOf(a.id), n));
    el.querySelector('.bandit-line').textContent =
      `P(best) ${pct(a.pBest, 0)} · gets ${pct(a.share, 0)} of new traffic`;
  }
}

function openDashboard() {
  dash.hidden = false;
  refreshDashboard();
  openDashboard.timer ||= setInterval(refreshDashboard, 3000);
}

function closeDashboard() {
  dash.hidden = true;
  clearInterval(openDashboard.timer);
  openDashboard.timer = null;
}

document.getElementById('dash-close').addEventListener('click', closeDashboard);
document.addEventListener('keydown', (e) => {
  if (e.key === 'd' && !e.metaKey && !e.ctrlKey && e.target === document.body) {
    dash.hidden ? openDashboard() : closeDashboard();
  }
});

// ---------- boot ----------

async function boot() {
  const forced = params.get('layout');
  if (forced) {
    // Preview mode: show a specific layout without assigning or counting anything.
    render(forced);
  } else {
    try {
      const res = await fetch('/api/assign', {
        method: 'POST',
        body: JSON.stringify({ visitorId }),
      });
      const { layout } = await res.json();
      tracking = true;
      render(layout);
      watchEngagement();
    } catch {
      render('grid');
    }
  }
  if (params.has('dashboard')) openDashboard();
}

boot();
