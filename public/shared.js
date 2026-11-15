'use strict';

// Shared by every mode's page: visitor id, assignment, event tracking, and the tab bar with
// the visitor view, the dashboard and the explainer.

const Bandit = (() => {
  const params = new URLSearchParams(location.search);
  // Dashboard previews load the page in an iframe with ?embed: no tab bar there.
  const embed = params.has('embed');
  let tracking = false;
  let assignment = null;
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
    if (forced) {
      assignment = { variant: forced, how: 'preview' };
    } else {
      try {
        const res = await fetch('/api/assign', { method: 'POST', body: JSON.stringify({ visitorId }) });
        assignment = await res.json();
        tracking = true;
      } catch {
        assignment = { variant: fallback, how: 'offline' };
      }
    }
    renderChip();
    return assignment.variant;
  }

  // ---------- helpers ----------

  const $ = (id) => document.getElementById(id);
  const pct0 = (x) => `${Math.round(x * 100)} %`;
  const FORMAT = {
    pct: (x) => `${(x * 100).toFixed(1)} %`,
    pct2: (x) => `${(x * 100).toFixed(2)} %`,
    eur: (x) => `${x.toFixed(0)} €`,
  };
  const REWARD_LABEL = {
    revenue: 'Umsatz pro Impression',
    subscribed: 'Abschlüsse pro Impression',
    checkout: 'Einstiege in die Bestellstrecke, gewichtet mit der Abschlussquote',
    converted: 'Conversion',
    engagement: 'Engagement',
  };
  const tone = (rank, n) => (rank === 0 ? 'var(--good)' : rank === n - 1 ? 'var(--bad)' : 'var(--mid)');

  let variantsCache = null;
  async function variantName(id) {
    try {
      variantsCache ||= await (await fetch('/api/variants')).json();
    } catch {
      return id;
    }
    return variantsCache.find((v) => v.id === id)?.name || id;
  }

  // ---------- tabs ----------

  const VIEWS = [
    { id: 'besucher', label: 'Als Besucher' },
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'erklaerung', label: "Worum geht's" },
  ];
  let timer = null;

  async function renderChip() {
    const chip = $('app-chip');
    if (!chip || !assignment) return;
    const name = await variantName(assignment.variant);
    const why = {
      preview: 'Vorschau, wird nicht gezählt',
      offline: 'Server nicht erreichbar',
      returning: 'du warst schon hier und behältst deine Variante',
      control: 'du bist in der Kontrollgruppe',
      bandit: 'vom Bandit zugewiesen',
    }[assignment.how] || '';
    chip.innerHTML = `Du siehst <b>${name}</b> · ${why}`;
  }

  function buildShell() {
    const nav = document.createElement('nav');
    nav.className = 'app-tabs';
    nav.setAttribute('role', 'tablist');
    nav.innerHTML = VIEWS.map((v) =>
      `<button class="app-tab" role="tab" id="tab-${v.id}" aria-controls="view-${v.id}">${v.label}</button>`,
    ).join('') + '<span class="app-chip" id="app-chip"></span>';
    document.body.prepend(nav);

    // The page's own content is the visitor view; dashboard and explainer are added here.
    $('view-visit').id = 'view-besucher';
    for (const id of ['dashboard', 'erklaerung']) {
      const section = document.createElement('section');
      section.id = `view-${id}`;
      section.className = 'app-view';
      section.hidden = true;
      document.body.append(section);
    }

    for (const v of VIEWS) $(`tab-${v.id}`).addEventListener('click', () => show(v.id));
    nav.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const i = VIEWS.findIndex((v) => $(`tab-${v.id}`).getAttribute('aria-selected') === 'true');
      const next = VIEWS[(i + (e.key === 'ArrowRight' ? 1 : VIEWS.length - 1)) % VIEWS.length].id;
      show(next);
      $(`tab-${next}`).focus();
    });
    document.addEventListener('click', (e) => {
      const go = e.target.closest('[data-go]');
      if (go) show(go.dataset.go);
    });
    addEventListener('hashchange', () => show(location.hash.slice(1), false));
  }

  function show(view, updateHash = true) {
    if (!VIEWS.some((v) => v.id === view)) view = 'besucher';
    for (const v of VIEWS) {
      $(`view-${v.id}`).hidden = v.id !== view;
      $(`tab-${v.id}`).setAttribute('aria-selected', String(v.id === view));
      $(`tab-${v.id}`).tabIndex = v.id === view ? 0 : -1;
    }
    if (updateHash && location.hash.slice(1) !== view) history.replaceState(null, '', `#${view}`);
    clearInterval(timer);
    timer = null;
    if (view === 'dashboard') {
      refreshDashboard();
      timer = setInterval(refreshDashboard, 3000);
    }
    if (view === 'erklaerung') renderExplainer();
    scrollTo({ top: 0 });
  }

  // ---------- dashboard ----------

  function metricHtml(label, text, width, color) {
    return `<div class="metric" style="color:${color}">
      <div class="row"><span class="muted">${label}</span><span>${text}</span></div>
      <div class="bar"><i style="width:${width}%"></i></div>
    </div>`;
  }

  function narrate(s) {
    const visits = s.arms.reduce((sum, a) => sum + a.visits, 0);
    if (!visits) {
      return {
        story: 'Noch keine Besucher. Sobald jemand die Seite öffnet, wird ihm eine Variante zugewiesen und hier gezählt.',
        hint: 'Tipp: Starte in einem zweiten Terminal „npm run seed“, das schickt simulierte Testbesucher. Oder öffne den Tab „Als Besucher“ in mehreren privaten Fenstern.',
      };
    }
    const bandit = s.arms.filter((a) => !a.control);
    const sorted = [...bandit].sort((a, b) => b.pBest - a.pBest);
    const [top, second] = sorted;
    const parts = [`Bisher ${visits.toLocaleString('de-DE')} Besucher. Der Bandit optimiert auf: ${REWARD_LABEL[s.reward] || s.reward}.`];
    if (!second || top.pBest >= 0.6) {
      parts.push(`${top.name} liegt vorne: Der Bandit ist sich zu ${pct0(top.pBest)} sicher und gibt ihr ${pct0(top.share)} der neuen Besucher.`);
      if (top.uplift !== null) parts.push(`Gegenüber der Kontrollgruppe: ${top.uplift >= 0 ? '+' : ''}${pct0(top.uplift)}.`);
    } else {
      parts.push(`Noch ist offen, wer vorne liegt: ${top.name} und ${second.name} sind fast gleichauf, deshalb verteilt der Bandit noch breit.`);
    }
    if (s.holdout) parts.push(`Die Kontrollgruppe (${pct0(s.holdout)}) sieht immer die Standard-Variante.`);
    const few = visits < 1000 * s.arms.length;
    return {
      story: parts.join(' '),
      hint: few ? 'Achtung: Mit so wenigen Besuchern sind die Zahlen noch sehr unsicher.' : '',
    };
  }

  let built = '';

  async function refreshDashboard() {
    const root = $('view-dashboard');
    let s;
    try {
      s = await (await fetch('/api/stats')).json();
    } catch {
      root.innerHTML = '<p>Der Server antwortet nicht. Läuft <code>npm start</code> noch?</p>';
      built = '';
      return;
    }
    const key = s.arms.map((a) => a.id).join();
    if (built !== key || !root.querySelector('#dash-grid')) {
      root.innerHTML = `
        <div class="dash-head"><h2>Dashboard</h2><span class="muted" id="dash-meta"></span></div>
        <div class="app-box story" aria-live="polite">
          <span class="label muted">Was gerade passiert</span>
          <p id="dash-story"></p>
          <p class="muted" id="dash-hint"></p>
        </div>
        <div id="dash-grid" class="dash-grid">${s.arms.map((a, i) => `
          <div class="arm" data-id="${a.id}">
            <div class="arm-title"><span class="muted">${String(i + 1).padStart(2, '0')}</span>
              <span class="name">${a.name}</span><span class="muted">— ${a.tagline}</span>
              ${a.control ? '<span class="badge control">Kontrollgruppe</span>' : '<span class="badge" hidden>Vorne</span>'}
              <span class="visits muted"></span></div>
            <div class="metrics" style="grid-template-columns:repeat(${s.metrics.length},1fr)"></div>
            <div class="bandit-line muted"></div>
            <div class="preview"><iframe src="/?variant=${a.id}&embed" loading="lazy" tabindex="-1" title="Vorschau ${a.name}"></iframe>
              <a href="/?variant=${a.id}#besucher" target="_blank">Vorschau öffnen ↗</a></div>
          </div>`).join('')}</div>`;
      built = key;
    }

    const meta = [`${pct0(s.explore)} Exploration`];
    if (s.holdout) meta.push(`${pct0(s.holdout)} Kontrollgruppe`);
    $('dash-meta').textContent = meta.join(' · ');
    const { story, hint } = narrate(s);
    $('dash-story').textContent = story;
    $('dash-hint').textContent = hint;

    const n = s.arms.length;
    const ranks = s.metrics.map((_, m) => [...s.arms].sort((a, b) => b.metrics[m] - a.metrics[m]).map((a) => a.id));
    const maxes = s.metrics.map((_, m) => Math.max(...s.arms.map((a) => a.metrics[m]), 1e-9));
    for (const a of s.arms) {
      const el = root.querySelector(`[data-id="${a.id}"]`);
      if (!a.control) el.querySelector('.badge').hidden = !(a.id === s.top && a.pBest >= 0.6);
      el.querySelector('.visits').textContent = `${a.visits.toLocaleString('de-DE')} Besucher`;
      el.querySelector('.metrics').innerHTML = s.metrics.map((m, i) =>
        metricHtml(m.label, FORMAT[m.format](a.metrics[i]), (a.metrics[i] / maxes[i]) * 100, tone(ranks[i].indexOf(a.id), n)),
      ).join('');
      const parts = a.control
        ? [`bekommt fest ${pct0(a.share)} der Besucher`, 'Vergleichsbasis']
        : [`Chance, die beste zu sein: ${pct0(a.pBest)}`, `bekommt ${pct0(a.share)} der neuen Besucher`];
      if (a.uplift !== null) parts.push(`${a.uplift >= 0 ? '+' : ''}${pct0(a.uplift)} ggü. Kontrollgruppe`);
      el.querySelector('.bandit-line').textContent = parts.join(' · ');
    }
  }

  // ---------- explainer ----------

  async function renderExplainer() {
    const root = $('view-erklaerung');
    if (root.dataset.built) return;
    root.dataset.built = '1';
    let mode = 'portfolio';
    try {
      mode = (await (await fetch('/api/stats')).json()).mode;
    } catch {}
    const paywall = mode === 'paywall';
    const what = paywall ? 'Paywall' : 'Layout';
    root.innerHTML = `
      <h2>Worum geht's</h2>
      <p class="muted">${paywall
        ? 'Welche Paywall bringt die meisten Abos? Statt das in einem festen A/B-Test herauszufinden, lernt ein Algorithmus beim Ausspielen mit und schickt mehr Leser zu der Variante, die besser läuft.'
        : 'Welches Portfolio-Layout führt zu den meisten Kontaktaufnahmen? Ein Algorithmus lernt beim Ausspielen mit und schickt mehr Besucher zu dem Layout, das besser läuft.'}</p>
      <div class="app-cols">
        <div class="app-box"><span class="label muted">Heute</span><h3>Klassischer A/B-Test</h3>
          <p>Jede Variante bekommt gleich viele Besucher, bis der Test vorbei ist. Erst danach wird der Gewinner ausgerollt.</p></div>
        <div class="app-box"><span class="label muted">Mit Bandit</span><h3>Lernt beim Ausspielen</h3>
          <p>Mit jedem Klick wird die Schätzung genauer, und der Traffic verschiebt sich schrittweise zur besseren Variante. Schwache Varianten bekommen nur noch wenig, ein kleiner Teil (Exploration) bleibt zufällig verteilt.</p></div>
        <div class="app-box"><span class="label muted">Sicherheitsnetz</span><h3>Kontrollgruppe</h3>
          <p>${paywall
            ? 'Ein fester Teil der Besucher sieht immer die Standard-Paywall. Daran wird gemessen, ob der Bandit insgesamt mehr bringt als der Status quo.'
            : 'Im Portfolio-Modus gibt es keine Kontrollgruppe. Im Paywall-Modus sieht ein fester Teil immer die Standard-Variante.'}</p></div>
      </div>
      <div class="app-box">
        <h3>So benutzt du die App</h3>
        <dl class="app-terms">
          <dt>Als Besucher</dt><dd>Die Seite, wie ein echter Besucher sie sieht. Oben rechts steht, welche ${what}-Variante du bekommen hast und warum. Deine Klicks zählen mit.</dd>
          <dt>Dashboard</dt><dd>Wie viele Besucher jede Variante hatte, wie gut sie läuft und wie sicher sich der Bandit ist. Aktualisiert sich alle 3 Sekunden.</dd>
          <dt>Testbesucher</dt><dd><code>npm run seed</code> in einem zweiten Terminal schickt simulierte Besucher mit erfundenen Raten. Das ist nur zum Ausprobieren gedacht.</dd>
          <dt>Neue Variante</dt><dd>Einen Eintrag in <code>${paywall ? 'paywalls.json' : 'layouts.json'}</code> mit <code>"active": true</code> anlegen. Sie geht ohne Neustart live.</dd>
          <dt>Von vorn</dt><dd>Server stoppen und den Ordner <code>data/</code> löschen.</dd>
        </dl>
      </div>
      <button class="app-btn" data-go="dashboard">Zum Dashboard</button>`;
  }

  // ---------- boot ----------

  if (!embed) {
    const boot = () => {
      buildShell();
      const legacy = params.has('dashboard') ? 'dashboard' : null;
      show(location.hash.slice(1) || legacy || 'besucher', false);
      renderChip();
    };
    if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot);
    else boot();
  }

  return { visitorId, track, assign, params, isTracking: () => tracking };
})();
