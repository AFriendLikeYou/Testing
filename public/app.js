'use strict';

const PROJECTS = [
  { slug: 'commerce', title: 'Commerce Design System', meta: 'Design system · 2025', bg: 'linear-gradient(160deg,#1d3fd6,#0a1f8f)' },
  { slug: 'magazine', title: 'Magazine Redesign', meta: 'Editorial · 2025', bg: 'linear-gradient(160deg,#2b2b2b,#111)' },
  { slug: 'audio', title: 'Audio Brand Launch', meta: 'Campaign · 2024', bg: 'linear-gradient(160deg,#1fb84a,#0d6b2a)' },
  { slug: 'museum', title: 'Museum Wayfinding', meta: 'Spatial · 2024', bg: 'linear-gradient(160deg,#f2c230,#c98a00)' },
  { slug: 'fitness', title: 'Fitness App', meta: 'Product · 2023', bg: 'linear-gradient(160deg,#c46cf2,#7a2bb3)' },
  { slug: 'bank', title: 'Neobank Onboarding', meta: 'Product · 2023', bg: 'linear-gradient(160deg,#e2534a,#9b1f18)' },
];

const work = document.getElementById('work');

// ---------- tracking ----------

const track = Bandit.track;

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

// ---------- boot ----------

Bandit.assign('grid').then((layout) => {
  render(layout);
  if (Bandit.isTracking()) watchEngagement();
});
