// Повтор раунда: все игроки на карте, следы, события (раскрытия, поимки, задания), сужение зоны, шкала времени.
import { t, getLang } from './i18n.js';
import { I } from './icons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (s) => { s = Math.max(0, Math.round(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const HUNT = '#f26d7d', HIDE = '#5fd38d';

/** Превращает старый повтор (только мой трек) в формат rec. */
function normalize(r) {
  if (r.rec && r.rec.frames && r.rec.frames.length) return r.rec;
  const frames = (r.track || []).map((p, i) => [i * 3, p[0], p[1], p[2]]);
  return { v: 0, frames, events: [], players: [{ n: r.name || '—', c: '#ffffff', me: true }], poly: null, hideSec: 0, huntSec: r.duration || frames.length * 3, shrinkTo: 1 };
}

export function renderReplay(el, r, { onBack }) {
  const rec = normalize(r);
  const P = rec.players, F = rec.frames, N = P.length;
  const T0 = F.length ? F[0][0] : 0, T1 = F.length ? F[F.length - 1][0] : 0;
  const kx = 111320 * Math.cos(r.center.lat * Math.PI / 180), ky = 110540;
  const ll = (x, y) => [r.center.lat + y / ky, r.center.lng + x / kx];
  const ru = getLang() === 'ru';
  let tNow = T0, playing = false, speed = 8, raf = 0, lastTs = 0, follow = -1;
  const hidden = new Set();

  el.innerHTML = `<div id="game"><div id="map"></div>
    <div class="hud-top"><div class="hud-bar">
      <button class="hb" data-a="back" aria-label="back">${I.arrowL}</button><div class="sep"></div>
      <div class="tm"><div class="k">${ru ? 'Повтор' : 'Replay'}</div><div class="v" id="rT">00:00</div></div><div class="sep"></div>
      <div class="tm"><div class="k" id="rPh"></div><div class="v" id="rCnt" style="font-size:16px"></div></div><div class="sep"></div>
      <button class="hb" data-a="fit" aria-label="zone">${I.north}</button>
    </div><div id="rEv"></div></div>
    <div class="hud-bottom">
      <div class="tray" id="rLeg">${P.map((p, i) => `<button class="pw" data-p="${i}" style="width:auto;padding:8px 12px;display:flex;align-items:center;gap:8px"><i class="dotc" id="lg${i}"></i>${esc(p.n)}${p.me ? ' ★' : ''}</button>`).join('')}</div>
      <div class="hud-more" style="gap:8px">
        <input type="range" class="range" id="rSl" min="${T0}" max="${T1}" step="1" value="${T0}">
        <div class="row" style="justify-content:space-between;flex-wrap:nowrap">
          <button class="btn" data-a="back10">−10с</button>
          <button class="btn primary" data-a="play" id="rPlay" style="flex:1">${I.play}</button>
          <button class="btn" data-a="fwd10">+10с</button>
          <button class="btn" data-a="speed" id="rSp">×${speed}</button>
        </div>
      </div>
    </div></div>`;

  const map = L.map(el.querySelector('#map'), { zoomControl: false, zoomSnap: 0.25 }).setView([r.center.lat, r.center.lng], 15);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  map.attributionControl.setPrefix(false);
  const zst = { color: '#2c7a4b', weight: 4, dashArray: '12 10', fill: false, interactive: false };
  const zone = rec.poly ? L.polygon(rec.poly.map((q) => ll(q[0], q[1])), zst).addTo(map) : L.circle([r.center.lat, r.center.lng], { radius: r.R, ...zst }).addTo(map);
  const fit = () => map.fitBounds(rec.poly ? zone.getBounds() : L.latLng(r.center.lat, r.center.lng).toBounds(r.R * 2.1), { padding: [30, 30] });
  fit();
  const zoneScale = (tt) => {
    if (rec.shrinkTo >= 1 || tt <= rec.hideSec) return 1;
    return 1 - (1 - rec.shrinkTo) * Math.min(1, (tt - rec.hideSec) / rec.huntSec);
  };

  // слои игроков
  const trails = P.map(() => L.layerGroup().addTo(map));
  const marks = P.map((p, i) => L.marker(ll(0, 0), { interactive: false, zIndexOffset: p.me ? 1000 : 0 }).addTo(map));
  const evLayer = L.layerGroup().addTo(map);
  const roleKey = P.map(() => -1);

  const frameAt = (tt) => { let lo = 0, hi = F.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (F[m][0] <= tt) lo = m; else hi = m - 1; } return lo; };
  const posAt = (i, tt) => {
    const k = frameAt(tt), a = F[k], b = F[Math.min(k + 1, F.length - 1)];
    const f = b[0] > a[0] ? Math.min(1, Math.max(0, (tt - a[0]) / (b[0] - a[0]))) : 0;
    const o = 1 + i * 3;
    return { x: a[o] + (b[o] - a[o]) * f, y: a[o + 1] + (b[o + 1] - a[o + 1]) * f, role: a[o + 2] };
  };

  let lastDrawnK = -1;
  function drawTrails(k) {
    for (let i = 0; i < N; i++) {
      trails[i].clearLayers();
      if (hidden.has(i)) continue;
      let seg = [], role = null;
      const flush = () => { if (seg.length > 1) L.polyline(seg, { color: role ? HUNT : (P[i].me ? '#2fae66' : HIDE), weight: P[i].me ? 5 : 3, opacity: P[i].me ? 0.95 : 0.7, interactive: false }).addTo(trails[i]); };
      for (let j = 0; j <= k; j++) {
        const o = 1 + i * 3, rl = F[j][o + 2];
        if (role !== null && rl !== role) { flush(); seg = [seg[seg.length - 1]]; }
        role = rl; seg.push(ll(F[j][o], F[j][o + 1]));
      }
      flush();
    }
  }

  function drawEvents(tt) {
    evLayer.clearLayers();
    const shown = [];
    for (const e of rec.events) {
      if (e.t > tt) continue;
      const age = tt - e.t;
      if (e.k === 'r' && age < 90) L.circle(ll(e.x, e.y), { radius: e.r, color: '#b8323f', weight: 2, fillColor: '#dc505a', fillOpacity: 0.18 * (1 - age / 90), opacity: 1 - age / 100, interactive: false }).addTo(evLayer);
      if (e.k === 'c') L.marker(ll(e.x, e.y), { interactive: false, icon: L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13], html: `<div class="rp-catch">✕</div>` }) }).addTo(evLayer);
      if (e.k === 'm') {
        const end = rec.events.find((x) => (x.k === 'md' || x.k === 'mf') && x.t >= e.t);
        if (!end || end.t > tt) L.circle(ll(e.x, e.y), { radius: e.r, color: '#e8b52a', weight: 3, fillColor: '#f3c13a', fillOpacity: 0.18, interactive: false }).addTo(evLayer);
      }
      if (age < 6) shown.push(e);
    }
    const txt = (e) => e.k === 'c' ? `${I.target}<span>${t('caughtBy', { a: esc(P[e.a]?.n), b: esc(P[e.b]?.n) })}</span>`
      : e.k === 'r' ? `${I.signal}<span>${ru ? 'Раскрытие' : 'Reveal'}: ${esc(P[e.p]?.n)}</span>`
      : e.k === 'f' ? `${I.snow}<span>${t('freezeSent', { n: e.n })}</span>`
      : e.k === 'm' ? `${I.diamond}<span>${ru ? 'Новое задание' : 'New mission'}</span>`
      : e.k === 'md' ? `${I.trophy}<span>${ru ? 'Задание выполнено' : 'Mission complete'}</span>`
      : e.k === 'ch' ? `${I.sparkle}<span>🎲 ${t('chaos_' + e.e)}</span>`
      : e.k === 'fr' ? `${I.shield}<span>${ru ? 'Пленников выручили: ' + e.n : 'Prisoners freed: ' + e.n}</span>`
      : `${I.eye}<span>${ru ? 'Задание провалено' : 'Mission failed'}</span>`;
    const box = el.querySelector('#rEv');
    const html = shown.slice(-2).map((e) => `<div class="banner ${e.k === 'c' || e.k === 'mf' ? 'red' : e.k === 'm' || e.k === 'md' ? 'yellow' : e.k === 'fr' ? 'green' : 'blue'}"><div class="bi">${txt(e).split('<span>')[0]}</div><div>${txt(e).split('<span>')[1].replace('</span>', '')}</div></div>`).join('');
    if (box.innerHTML !== html) box.innerHTML = html;
  }

  function draw() {
    const k = frameAt(tNow);
    if (k !== lastDrawnK) { drawTrails(k); lastDrawnK = k; }
    let hunters = 0;
    for (let i = 0; i < N; i++) {
      const p = posAt(i, tNow);
      if (p.role) hunters++;
      marks[i].setLatLng(ll(p.x, p.y));
      marks[i].setOpacity(hidden.has(i) ? 0.25 : 1);
      if (roleKey[i] !== p.role) {
        roleKey[i] = p.role;
        const col = p.role ? HUNT : (P[i].c === '#ffffff' ? HIDE : P[i].c);
        marks[i].setIcon(L.divIcon({ className: '', iconSize: [20, 20], iconAnchor: [10, 10], html: `<div class="mk"><div class="mk-pl" style="background:${col}${P[i].me ? ';border-color:#111;box-shadow:0 0 0 3px #fff' : ''}"></div><div class="mk-name">${esc(P[i].n)}</div></div>` }));
        const lg = el.querySelector('#lg' + i); if (lg) lg.style.background = col;
      }
    }
    if (follow >= 0) { const p = posAt(follow, tNow); map.panTo(ll(p.x, p.y), { animate: false }); }
    const sc = zoneScale(tNow);
    if (rec.poly) zone.setLatLngs(rec.poly.map((q) => ll(q[0] * sc, q[1] * sc))); else zone.setRadius(r.R * sc);
    drawEvents(tNow);
    el.querySelector('#rT').textContent = fmt(tNow - T0);
    el.querySelector('#rPh').textContent = tNow < rec.hideSec ? t('hideTime') : t('hunt');
    el.querySelector('#rCnt').innerHTML = `<span style="color:${HUNT}">${hunters}</span> · <span style="color:${HIDE}">${N - hunters}</span>`;
    el.querySelector('#rSl').value = tNow;
  }

  const loop = (ts) => {
    if (!playing) return;
    if (lastTs) tNow = Math.min(T1, tNow + (ts - lastTs) / 1000 * speed);
    lastTs = ts;
    draw();
    if (tNow >= T1) { setPlay(false); return; }
    raf = requestAnimationFrame(loop);
  };
  const setPlay = (v) => {
    playing = v; lastTs = 0; cancelAnimationFrame(raf);
    el.querySelector('#rPlay').innerHTML = v ? '❚❚' : I.play;
    if (v) { if (tNow >= T1) tNow = T0; raf = requestAnimationFrame(loop); }
  };
  el.querySelector('#rSl').oninput = (e) => { tNow = +e.target.value; draw(); };
  el.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => {
    const a = b.dataset.a;
    if (a === 'back') { setPlay(false); map.remove(); onBack(); }
    else if (a === 'fit') { follow = -1; fit(); }
    else if (a === 'play') setPlay(!playing);
    else if (a === 'back10') { tNow = Math.max(T0, tNow - 10); draw(); }
    else if (a === 'fwd10') { tNow = Math.min(T1, tNow + 10); draw(); }
    else if (a === 'speed') { speed = { 1: 4, 4: 8, 8: 16, 16: 32, 32: 1 }[speed]; el.querySelector('#rSp').textContent = '×' + speed; }
  });
  // касание по игроку в легенде: следить → скрыть → показать
  el.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => {
    const i = +b.dataset.p;
    if (follow === i) { follow = -1; hidden.add(i); b.style.opacity = 0.45; b.style.outline = ''; }
    else if (hidden.has(i)) { hidden.delete(i); b.style.opacity = 1; }
    else { follow = i; el.querySelectorAll('[data-p]').forEach((x) => x.style.outline = ''); b.style.outline = '2px solid var(--accent)'; }
    lastDrawnK = -1; draw();
  });
  draw();
  setTimeout(() => setPlay(true), 400);
  return () => { setPlay(false); try { map.remove(); } catch {} };
}
