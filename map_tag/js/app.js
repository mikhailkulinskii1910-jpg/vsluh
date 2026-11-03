// Map Tag — экраны приложения
import { t, setLang, getLang } from './i18n.js';
import { I } from './icons.js';
import { POWERUPS, pwName, pwDesc, tutorialSteps, PATCH_NOTES } from './content.js';
import { Game, fmt } from './game.js';

const VERSION = '1.0';
const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- хранилище ----------
const DEF = {
  name: '', onboarded: false, dev: false, seenNotes: '', heard: null,
  lobby: null,
  stats: { dist: 0, games: 0, time: 0, caught: 0, missions: 0, supplies: 0, powers: 0, timeHunt: 0, timeHide: 0, timesCaught: 0, wins: 0 },
  replays: [],
};
let S;
try { S = { ...DEF, ...JSON.parse(localStorage.getItem('mt_state') || '{}') }; } catch { S = { ...DEF }; }
S.stats = { ...DEF.stats, ...S.stats };
const save = () => { try { localStorage.setItem('mt_state', JSON.stringify(S)); } catch {} };

// ---------- параметры игры ----------
const SIZES = { small: { r: 350, min: 15, icon: 'sprout' }, medium: { r: 500, min: 20, icon: 'tree' }, large: { r: 650, min: 25, icon: 'mountain' } };
const VIS = { forest: 0.85, mixed: 1, city: 1.15 };
const LIGHT = { day: 1, dark: 0.85 };
const defaultLobby = () => ({
  code: genCode(), size: 'medium', vis: 'mixed', light: 'day', extra: 'spice', step: 1,
  center: null, bots: 5, hunters: 2, myRole: 'random', mode: 'demo',
  revealCd: null, freezeCd: null, huntMin: null, powerups: POWERUPS.map((p) => p.id),
});
function genCode() { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)]; return s; }
function calc(lb) {
  const sz = SIZES[lb.size];
  const radius = Math.round(sz.r * Math.sqrt(VIS[lb.vis] * LIGHT[lb.light]) / 10) * 10;
  const huntMin = lb.huntMin || sz.min;
  return {
    radius, huntSec: huntMin * 60, huntMin, hideSec: Math.round(huntMin * 12), shrinkTo: 0.7,
    revealCd: lb.revealCd || (lb.extra === 'tutorial' ? 120 : 90), freezeCd: lb.freezeCd || 150,
  };
}

// ---------- общие элементы ----------
function toast(msg) {
  let host = document.querySelector('.toast-host');
  if (!host) { host = document.createElement('div'); host.className = 'toast-host'; document.body.appendChild(host); }
  const el = document.createElement('div'); el.className = 'toast'; el.textContent = msg; host.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
function modal(html, init, opts = {}) {
  const wrap = document.createElement('div'); wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal">${html}</div>`;
  document.body.appendChild(wrap);
  const close = () => { wrap.remove(); opts.onClose && opts.onClose(); };
  wrap.addEventListener('click', (e) => { if (e.target === wrap && !opts.sticky) close(); });
  init && init(wrap.querySelector('.modal'), close);
  return close;
}
function confirmBox(msg, ok) {
  modal(`<p style="font-size:18px">${esc(msg)}</p><div class="row" style="margin-top:16px"><button class="btn" data-n style="flex:1">${t('cancel')}</button><button class="btn danger" data-y style="flex:1">OK</button></div>`, (b, close) => {
    b.querySelector('[data-n]').onclick = close;
    b.querySelector('[data-y]').onclick = () => { close(); ok(); };
  });
}
function topbar(withBack = true) {
  const unseen = S.seenNotes !== VERSION;
  return `<div class="topbar"><div class="brand">${I.logo}<span>${t('appName')}</span></div>
    <button class="icon-btn" data-top="notes" aria-label="notes">${I.mail}${unseen ? '<span class="dot"></span>' : ''}</button>
    <button class="icon-btn" data-top="rules" aria-label="rules">${I.help}</button>
    <button class="icon-btn" data-top="settings" aria-label="settings">${I.gear}</button></div>
    ${withBack ? `<button class="btn" data-go="home" style="margin-bottom:18px">${I.arrowL}${t('back')}</button>` : ''}`;
}
function supportBlock() {
  return `<details class="support"><summary>${t('support')}</summary><div class="box">${t('supportText', { v: VERSION })}</div></details>`;
}
function bindCommon(root) {
  root.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => go(b.dataset.go));
  root.querySelectorAll('[data-top]').forEach((b) => b.onclick = () => {
    const a = b.dataset.top;
    if (a === 'notes') openNotes(); else if (a === 'rules') openRules(); else openSettings();
  });
}

// ---------- навигация ----------
let current = 'home';
let game = null;
function go(screen, arg) {
  if (game) { game.destroy(); game = null; }
  current = screen;
  const fn = SCREENS[screen] || SCREENS.home;
  $app.innerHTML = '';
  const el = document.createElement('div');
  el.className = screen === 'game' ? '' : 'screen screen-enter';
  $app.appendChild(el);
  fn(el, arg);
  window.scrollTo(0, 0);
}

const SCREENS = {
  home(el) {
    el.innerHTML = `${topbar(false)}
      <h1 class="home-title">${t('homeTitle')}</h1>
      <div class="home-sub">${t('homeSub')}</div>
      <div class="menu">
        <button class="menu-btn m-join" data-go="join"><span class="mi">${I.users}</span><span class="lbl">${t('join')}</span><span class="arr">${I.arrowR}</span></button>
        <button class="menu-btn m-host" data-go="host"><span class="mi">${I.map}</span><span class="lbl">${t('host')}</span><span class="arr">${I.arrowR}</span></button>
        <button class="menu-btn m-stats" data-go="stats"><span class="mi">${I.user}</span><span class="lbl">${t('stats')}</span><span class="arr">${I.arrowR}</span></button>
        <button class="menu-btn m-learn" data-go="learn"><span class="mi">${I.book}</span><span class="lbl">${t('learn')}</span><span class="arr">${I.arrowR}</span></button>
      </div>${supportBlock()}`;
    bindCommon(el);
  },

  host(el) {
    if (S.lobby) return go('lobby');
    el.innerHTML = `${topbar()}
      <div class="card host"><div class="card-ico" style="color:var(--violet)">${I.map}</div>
        <h2>${t('host')}</h2><p class="lead">${t('hostLead')}</p>
        <label class="field">${t('yourName')}</label><input class="input" id="nm" maxlength="20" placeholder="${t('namePh')}" value="${esc(S.name)}">
        <button class="btn violet big block" id="go" style="margin-top:28px">${t('createLobby')}</button></div>
      ${supportBlock()}`;
    bindCommon(el);
    el.querySelector('#go').onclick = () => {
      const n = el.querySelector('#nm').value.trim();
      if (!n) return toast(t('enterName'));
      S.name = n; S.lobby = defaultLobby(); save(); go('lobby');
    };
  },

  join(el, code) {
    el.innerHTML = `${topbar()}
      <div class="card join"><div class="card-ico" style="color:var(--accent)">${I.users}</div>
        <h2>${t('joinTitle')}</h2><p class="lead">${t('joinLead')}</p>
        <label class="field">${t('yourName')}</label><input class="input" id="nm" maxlength="20" placeholder="${t('namePh')}" value="${esc(S.name)}">
        <button class="btn" id="scan" style="margin-top:16px">${I.qr}${t('scanQr')}</button>
        <label class="field">${t('lobbyCode')}</label><input class="input code-input" id="cd" maxlength="6" placeholder="ABC123" autocomplete="off" value="${esc(code || '')}">
        <button class="btn primary big block" id="go" style="margin-top:28px">${t('joinLobby')}</button></div>
      ${supportBlock()}<p class="hint">${t('joinHint')}</p>`;
    bindCommon(el);
    const cd = el.querySelector('#cd');
    cd.oninput = () => { cd.value = cd.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); };
    el.querySelector('#scan').onclick = () => scanQr((c) => { cd.value = c; });
    el.querySelector('#go').onclick = () => {
      const n = el.querySelector('#nm').value.trim();
      if (!n) return toast(t('enterName'));
      if (cd.value.length !== 6) return toast(t('enterCode'));
      S.name = n; save();
      if (S.lobby && S.lobby.code === cd.value) return go('lobby');
      modal(`<p style="font-size:18px">${t('noLobby', { c: esc(cd.value) })}</p><div class="row" style="margin-top:16px"><button class="btn" data-n style="flex:1">${t('cancel')}</button><button class="btn violet" data-y style="flex:1">${t('host')}</button></div>`, (b, close) => {
        b.querySelector('[data-n]').onclick = close;
        b.querySelector('[data-y]').onclick = () => { close(); S.lobby = defaultLobby(); save(); go('lobby'); };
      });
    };
  },

  lobby(el) {
    const lb = S.lobby;
    if (!lb) return go('host');
    const c = calc(lb);
    const pct = (f) => (f > 1 ? '+' : '−') + Math.round(Math.abs(1 - f) * 100) + '%';
    const opt = (group, key, icon, title, sub, on) => `<button class="opt ${on ? 'on' : ''}" data-g="${group}" data-k="${key}">${I[icon]}<span class="t">${title}</span>${sub ? `<span class="s">${sub}</span>` : ''}</button>`;
    const sizeSub = (k) => `${lb.huntMin || SIZES[k].min} ${t('min')} · ${Math.round(SIZES[k].r * Math.sqrt(VIS[lb.vis] * LIGHT[lb.light]) / 10) * 10} ${t('m')}`;

    const step1 = `
      <div class="sect">${t('sizeLen')}</div>
      <div class="opts c3">${opt('size', 'small', 'sprout', t('small'), sizeSub('small'), lb.size === 'small')}${opt('size', 'medium', 'tree', t('medium'), sizeSub('medium'), lb.size === 'medium')}${opt('size', 'large', 'mountain', t('large'), sizeSub('large'), lb.size === 'large')}</div>
      <div class="sect">${t('visibility')}<button class="qbtn" data-q="vis">${I.help}</button></div>
      <div class="opts c3">${opt('vis', 'forest', 'forest', t('forest'), t('areaPct', { p: pct(VIS.forest) }), lb.vis === 'forest')}${opt('vis', 'mixed', 'house', t('mixed'), '', lb.vis === 'mixed')}${opt('vis', 'city', 'city', t('openCity'), t('areaPct', { p: pct(VIS.city) }), lb.vis === 'city')}</div>
      <div class="sect">${t('lighting')}</div>
      <div class="opts c2">${opt('light', 'day', 'sun', t('day'), '', lb.light === 'day')}${opt('light', 'dark', 'moon', t('dark'), t('areaPct', { p: pct(LIGHT.dark) }), lb.light === 'dark')}</div>
      <div class="sect">${t('extras')}<button class="qbtn" data-q="extra">${I.help}</button></div>
      <div class="opts c3">${opt('extra', 'tutorial', 'book', t('tutorial'), '', lb.extra === 'tutorial')}${opt('extra', 'simple', 'sparkle', t('simple'), '', lb.extra === 'simple')}${opt('extra', 'spice', 'pepper', t('spice'), '', lb.extra === 'spice')}</div>
      ${S.dev ? devTuning(lb, c) : ''}
      <div class="summary"><div class="l">${t('radius')}</div><div class="l">${t('huntDur')}</div>
        <div class="v">${c.radius} ${t('m')}</div><div class="v">${c.huntMin} ${t('min')}</div>
        <div class="sub">${t('toHide', { t: fmt(c.hideSec) })} · ${t('shrinks', { p: 70 })}</div>
        <div class="saved">${t('saved')}</div></div>
      <button class="btn primary big block next-btn" data-step="2"><span>${t('next')}</span>${I.arrowR}</button>`;

    const total = 1 + lb.bots;
    const step2 = `
      <div class="sect">${t('place')}</div>
      <div class="pick-map" id="pmap"></div>
      <div class="row" style="margin-top:10px;justify-content:space-between"><span style="color:var(--muted);font-size:14px;flex:1">${t('placeHint')}</span><button class="btn" id="myloc">${I.locate}${t('myLocation')}</button></div>
      <div class="sect">${t('players')}</div>
      <div class="card" style="padding:8px 16px">
        <div class="line-row"><span>${t('bots')}</span><div class="stepper"><button class="btn" data-st="bots:-1">−</button><span class="val">${lb.bots}</span><button class="btn" data-st="bots:1">+</button></div></div>
        <div class="line-row"><span>${t('hunters')}</span><div class="stepper"><button class="btn" data-st="hunters:-1">−</button><span class="val">${Math.min(lb.hunters, Math.max(1, total - 1))}</span><button class="btn" data-st="hunters:1">+</button></div></div>
        <div class="line-row"><span>${t('yourRole')}</span><div class="seg">${['random', 'hider', 'hunter'].map((r) => `<button data-role="${r}" class="${lb.myRole === r ? 'on' : ''}">${t(r)}</button>`).join('')}</div></div>
        <div class="line-row"><span>${t('moveMode')}</span><div class="seg">${['gps', 'demo'].map((r) => `<button data-mode="${r}" class="${lb.mode === r ? 'on' : ''}">${t(r)}</button>`).join('')}</div></div>
      </div>
      ${lb.mode === 'demo' ? `<p style="color:var(--muted);font-size:14px">${t('demoHelp')}</p>` : ''}
      <div class="player-list">
        <div class="player"><div class="av" style="background:var(--accent)">${esc((S.name || '?')[0])}</div><div class="nm">${esc(S.name)}</div><div class="tag">${t('you')}</div></div>
        ${Array.from({ length: lb.bots }, (_, i) => `<div class="player"><div class="av" style="background:#4a5672;color:#fff">${I.users.replace('<svg', '<svg width="18" height="18"')}</div><div class="nm">${t('bot')} ${i + 1}</div><div class="tag">${t('bot')}</div></div>`).join('')}
      </div>
      <div class="row" style="margin-top:16px"><button class="btn big" data-step="1" style="flex:1">${I.arrowL}${t('back2')}</button><button class="btn primary big" id="start" style="flex:2">${I.play}${t('startGame')}</button></div>`;

    el.innerHTML = `${topbar(false)}
      <div class="lobby-code-lbl">${t('lobbyCodeLbl')}</div>
      <div class="lobby-code">${lb.code}</div>
      <div class="row">
        <button class="btn danger" id="leave">${I.leave}${t('leave')}</button>
        <button class="btn" id="share">${t('share')}</button>
        <button class="btn" id="qr">QR</button>
      </div>
      <div class="make-yours"><div><div class="k">${t('makeYours')}</div><h2>${t('hostGame')}</h2></div><button class="btn" id="howrun">${t('helpRun')}</button></div>
      <div class="steps"><button class="step ${lb.step === 1 ? 'on' : ''}" data-step="1"><span class="n">1</span>${t('step1')}</button><button class="step ${lb.step === 2 ? 'on' : ''}" data-step="2"><span class="n">2</span>${t('step2')}</button></div>
      ${lb.step === 1 ? step1 : step2}`;
    bindCommon(el);

    const rerender = () => { save(); const y = window.scrollY; go('lobby'); window.scrollTo(0, y); };
    el.querySelectorAll('[data-g]').forEach((b) => b.onclick = () => { lb[b.dataset.g] = b.dataset.k; rerender(); });
    el.querySelectorAll('[data-step]').forEach((b) => b.onclick = () => { lb.step = +b.dataset.step; save(); go('lobby'); });
    el.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => modal(`<p>${b.dataset.q === 'vis' ? t('visHelp') : t('extraHelp')}</p><button class="btn block" data-x>${t('done')}</button>`, (m, close) => m.querySelector('[data-x]').onclick = close));
    el.querySelector('#leave').onclick = () => { S.lobby = null; save(); go('home'); };
    el.querySelector('#share').onclick = () => shareLobby(lb.code);
    el.querySelector('#qr').onclick = () => showQr(lb.code);
    el.querySelector('#howrun').onclick = () => modal(`<h2>${t('howRun')}</h2><ol>${t('howRunList').map((x) => `<li>${esc(x)}</li>`).join('')}</ol><button class="btn block" data-x>${t('done')}</button>`, (m, close) => m.querySelector('[data-x]').onclick = close);
    el.querySelectorAll('[data-tune]').forEach((r) => r.oninput = () => { lb[r.dataset.tune] = +r.value; el.querySelector(`#v_${r.dataset.tune}`).textContent = r.value; });
    el.querySelectorAll('[data-tune]').forEach((r) => r.onchange = rerender);
    el.querySelectorAll('[data-pwt]').forEach((cb) => cb.onchange = () => { const id = cb.dataset.pwt; lb.powerups = cb.checked ? [...new Set([...lb.powerups, id])] : lb.powerups.filter((x) => x !== id); save(); });

    if (lb.step === 2) {
      el.querySelectorAll('[data-st]').forEach((b) => b.onclick = () => {
        const [k, d] = b.dataset.st.split(':');
        lb[k] = Math.max(k === 'bots' ? 0 : 1, Math.min(k === 'bots' ? 9 : 9, lb[k] + +d));
        lb.hunters = Math.min(lb.hunters, Math.max(1, lb.bots));
        rerender();
      });
      el.querySelectorAll('[data-role]').forEach((b) => b.onclick = () => { lb.myRole = b.dataset.role; rerender(); });
      el.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => { lb.mode = b.dataset.mode; rerender(); });
      const center = lb.center || { lat: 55.7520, lng: 37.6175 };
      const pm = L.map(el.querySelector('#pmap'), { zoomControl: false, attributionControl: true }).setView([center.lat, center.lng], 15);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(pm);
      pm.attributionControl.setPrefix(false);
      const circ = L.circle([center.lat, center.lng], { radius: c.radius, color: '#2c7a4b', weight: 3, dashArray: '10 8', fillColor: '#5fd38d', fillOpacity: 0.08 }).addTo(pm);
      const setC = (lat, lng, fit) => { lb.center = { lat, lng }; save(); circ.setLatLng([lat, lng]); if (fit) pm.fitBounds(circ.getBounds()); };
      pm.fitBounds(circ.getBounds());
      pm.on('click', (e) => setC(e.latlng.lat, e.latlng.lng));
      const locate = (quiet) => navigator.geolocation && navigator.geolocation.getCurrentPosition((p) => setC(p.coords.latitude, p.coords.longitude, true), () => { if (!quiet) toast(t('noGps').split('—')[0]); }, { enableHighAccuracy: true, timeout: 15000 });
      el.querySelector('#myloc').onclick = () => locate(false);
      if (!lb.center) locate(true);
      el.querySelector('#start').onclick = () => {
        const cc = calc(lb);
        go('game', {
          center: lb.center || center, radius: cc.radius, huntSec: cc.huntSec, hideSec: cc.hideSec, shrinkTo: cc.shrinkTo,
          features: lb.extra, powerups: lb.powerups, revealCd: cc.revealCd, freezeCd: cc.freezeCd,
          bots: lb.bots, hunters: Math.min(lb.hunters, Math.max(1, lb.bots)), myRole: lb.myRole, mode: lb.mode, name: S.name,
        });
      };
    }
  },

  game(el, cfg) {
    game = new Game(cfg, {
      lang: getLang(), modal, toast, confirm: confirmBox,
      openRules: () => openRules(),
      onLeave: () => go('lobby'),
      onEnd: (res) => endGame(res, cfg),
    });
    game.mount(el);
  },

  stats(el) {
    const st = S.stats;
    const maxA = Math.max(1, st.caught, st.missions, st.supplies, st.powers);
    const tile = (icon, col, v, l) => `<div class="tile act"><span style="color:${col}">${I[icon]}</span><div class="v" style="color:${col}">${v}</div><div class="l">${l}</div><div class="bar"><i style="width:${v / maxA * 100}%;background:${col}"></i></div></div>`;
    const tot = st.timeHunt + st.timeHide;
    const C = 2 * Math.PI * 70, huntLen = tot ? st.timeHunt / tot * C : 0;
    el.innerHTML = `${topbar()}
      <div class="kicker">${t('lifetime')}</div>
      <div class="hero-stat">${I.run}<div class="big">${fmtDist(st.dist)}</div><div class="l">${t('distance')}</div><div class="s">${t('aboutSteps', { n: Math.round(st.dist / 0.75).toLocaleString(getLang()) })}</div></div>
      <div class="duo"><div class="tile purple">${I.users}<div class="v">${st.games}</div><div class="l">${t('gamesFin')}</div></div>
        <div class="tile amber">${I.clock}<div class="v">${fmtLong(st.time)}</div><div class="l">${t('timePlayed')}</div></div></div>
      <h3 class="h-sect">${t('inAction')}</h3>
      <div class="duo" style="margin-top:0">${tile('target', '#f26d7d', st.caught, t('caught'))}${tile('diamond', '#f6c453', st.missions, t('missionsDone'))}${tile('supply', '#8fd0ff', st.supplies, t('supplies'))}${tile('sparkle', '#c3a6ff', st.powers, t('powersSpent'))}</div>
      <p style="color:var(--muted)">${t('sameScale')}</p>
      <div class="card"><h3 style="font-size:22px;margin-bottom:14px">${t('bothSides')}</h3>
        <div class="donut-card"><svg width="150" height="150" viewBox="0 0 170 170"><circle cx="85" cy="85" r="70" fill="none" stroke="#3a4762" stroke-width="22"/>
          ${tot ? `<circle cx="85" cy="85" r="70" fill="none" stroke="#5fd38d" stroke-width="22" transform="rotate(-90 85 85)"/><circle cx="85" cy="85" r="70" fill="none" stroke="#f26d7d" stroke-width="22" stroke-dasharray="${huntLen} ${C}" transform="rotate(-90 85 85)"/>` : ''}</svg>
          <div class="lines"><div><div class="l">${t('timeHunting')}</div><div class="v" style="color:#f26d7d">${fmtLong(st.timeHunt)}</div></div>
            <div><div class="l">${t('timeRunning')}</div><div class="v" style="color:#5fd38d">${fmtLong(st.timeHide)}</div></div>
            <div><div class="l">${t('timesCaught')}</div><div class="v">${st.timesCaught}</div></div></div></div></div>
      <div class="story">${st.games ? t('storyGo') : t('storyStart')}</div>
      <h3 class="row" style="font-size:24px;margin-bottom:14px">${I.user.replace('<svg', '<svg width="30" height="30"')} ${esc(S.name || '—')}</h3>
      <details class="acc"><summary>${I.gear}${t('privacy')}<span class="chev">${I.chevD}</span></summary><div class="in"><p>${t('privacyText')}</p>
        <div class="row"><button class="btn" id="exp">${t('exportData')}</button><button class="btn danger" id="rst">${t('resetStats')}</button></div></div></details>
      <hr style="border:0;border-top:1px solid var(--line);margin:26px 0">
      <div class="row" style="gap:16px;align-items:flex-start"><span style="color:var(--gold)">${I.book.replace('<svg', '<svg width="46" height="46"')}</span><div><div class="kicker" style="margin:0">${t('advKeep')}</div><h2 style="font-size:32px">${t('replays')}</h2></div></div>
      <div id="reps" style="margin-top:16px">${S.replays.length ? S.replays.map((r, i) => `<div class="replay" data-rep="${i}"><div class="r-ico" style="background:${r.won ? '#1f3a2c' : '#3a222a'};color:${r.won ? 'var(--hider)' : 'var(--hunter)'}">${r.won ? I.trophy : I.target}</div><div style="flex:1"><b>${r.won ? t('won') : t('lost')}</b> · ${r.role === 'hunter' ? t('asHunter') : t('asHider')}<div style="color:var(--muted);font-size:14px">${new Date(r.date).toLocaleString(getLang(), { dateStyle: 'medium', timeStyle: 'short' })} · ${fmt(r.duration)} · ${fmtDist(r.dist)}</div></div>${I.arrowR.replace('<svg', '<svg width="22" height="22"')}</div>`).join('')
        : `<div class="empty">${I.map}<h3>${t('replayEmptyT')}</h3><p>${t('replayEmptyS')}</p></div>`}</div>
      <button class="btn block big" id="refresh">${t('refresh')}</button>
      <div class="card" style="margin-top:22px"><h3 style="font-size:24px">${t('heard')}</h3><p style="color:var(--muted);margin:8px 0 0">${t('optional')}</p>
        <div class="chips">${t('heardOpts').map((o, i) => `<button class="chip ${i === 8 ? 'wide' : ''} ${S.heard === i ? 'on' : ''}" data-h="${i}">${esc(o)}</button>`).join('')}</div></div>
      ${supportBlock()}`;
    bindCommon(el);
    el.querySelector('#refresh').onclick = () => go('stats');
    el.querySelector('#rst').onclick = () => confirmBox(t('resetConfirm'), () => { S.stats = { ...DEF.stats }; S.replays = []; save(); go('stats'); });
    el.querySelector('#exp').onclick = () => {
      const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'map_tag_data.json'; a.click();
    };
    el.querySelectorAll('[data-h]').forEach((b) => b.onclick = () => { S.heard = +b.dataset.h; save(); el.querySelectorAll('[data-h]').forEach((x) => x.classList.toggle('on', x === b)); toast(t('thanks')); });
    el.querySelectorAll('[data-rep]').forEach((b) => b.onclick = () => openReplay(S.replays[+b.dataset.rep]));
  },

  learn(el) {
    el.innerHTML = `${topbar()}
      <button class="menu-btn m-learn" id="rules" style="margin-bottom:12px"><span class="mi">${I.book}</span><span class="lbl">${t('basicRules')}</span><span class="arr">${I.arrowR}</span></button>
      <button class="menu-btn m-stats" id="howrun" style="margin-bottom:22px"><span class="mi">${I.map}</span><span class="lbl">${t('howRun')}</span><span class="arr">${I.arrowR}</span></button>
      <h3 class="h-sect">${t('powerupsIn')}</h3>
      ${POWERUPS.map((p) => `<div class="pw-item"><div class="pw-ico ${p.cls}">${I[p.icon]}</div><div><h3>${esc(pwName(p))}</h3><p>${esc(pwDesc(p))}</p></div></div>`).join('')}
      ${supportBlock()}`;
    bindCommon(el);
    el.querySelector('#rules').onclick = () => openRules();
    el.querySelector('#howrun').onclick = () => modal(`<h2>${t('howRun')}</h2><ol>${t('howRunList').map((x) => `<li>${esc(x)}</li>`).join('')}</ol><button class="btn block" data-x>${t('done')}</button>`, (m, close) => m.querySelector('[data-x]').onclick = close);
  },
};

function devTuning(lb, c) {
  const rng = (k, min, max, step, val, label, unit) => `<div class="line-row" style="display:block"><div class="row" style="justify-content:space-between"><span>${label}</span><b><span id="v_${k}">${val}</span> ${unit}</b></div><input type="range" class="range" data-tune="${k}" min="${min}" max="${max}" step="${step}" value="${val}"></div>`;
  return `<div class="sect">${t('tuning')}</div><div class="card" style="padding:8px 16px">
    ${rng('huntMin', 3, 40, 1, c.huntMin, t('huntDur'), t('min'))}
    ${rng('revealCd', 30, 240, 10, c.revealCd, t('revealCd'), t('sec'))}
    ${rng('freezeCd', 30, 300, 10, c.freezeCd, t('freezeCd'), t('sec'))}</div>
    ${lb.extra === 'spice' ? `<div class="sect">${t('powerupsIn')}</div><div class="card" style="padding:8px 16px">${POWERUPS.map((p) => `<label class="line-row"><span class="row">${I[p.icon].replace('<svg', '<svg width="20" height="20"')} ${esc(pwName(p))}</span><input type="checkbox" data-pwt="${p.id}" ${lb.powerups.includes(p.id) ? 'checked' : ''} style="width:24px;height:24px;accent-color:var(--accent)"></label>`).join('')}</div>` : ''}`;
}

function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(m >= 10000 ? 0 : 1).replace('.', getLang() === 'ru' ? ',' : '.') + (getLang() === 'ru' ? ' км' : ' km') : Math.round(m) + (getLang() === 'ru' ? ' м' : ' m'); }
function fmtLong(s) { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`; }

// ---------- конец игры ----------
function endGame(res, cfg) {
  const st = S.stats, g = res.stats;
  st.dist += g.dist; st.games++; st.time += res.duration; st.caught += g.caught; st.missions += g.missions; st.supplies += g.supplies;
  st.powers += g.powers; st.timeHunt += g.timeHunt; st.timeHide += g.timeHide; st.timesCaught += g.timesCaught; if (res.won) st.wins++;
  S.replays.unshift({ ...res.replay, won: res.won, role: res.role, duration: res.duration, dist: g.dist, winner: res.winner });
  S.replays = S.replays.slice(0, 10);
  save();
  modal(`<div style="text-align:center"><div style="color:${res.won ? 'var(--hider)' : 'var(--hunter)'}">${I.trophy.replace('<svg', '<svg width="64" height="64"')}</div>
    <div style="color:var(--muted);margin-top:6px">${t('endT')}</div>
    <h2 style="margin:6px 0">${res.winner === 'hiders' ? t('endHiders') : t('endHunters')}</h2>
    <p style="color:var(--muted)">${t('survivors', { n: res.survivors })}</p></div>
    <div class="card" style="margin:14px 0"><b>${t('yourGame')}: ${res.won ? t('won') : t('lost')}</b>
      <div class="line-row"><span>${t('distance')}</span><b>${fmtDist(g.dist)}</b></div>
      <div class="line-row"><span>${t('caught')}</span><b>${g.caught}</b></div>
      <div class="line-row"><span>${t('missionsDone')}</span><b>${g.missions}</b></div>
      <div class="line-row"><span>${t('supplies')}</span><b>${g.supplies}</b></div>
      <div class="line-row"><span>${t('powersSpent')}</span><b>${g.powers}</b></div></div>
    <div class="row"><button class="btn" data-m style="flex:1">${t('toMenu')}</button><button class="btn primary" data-a style="flex:1">${t('again')}</button></div>`, (b, close) => {
    b.querySelector('[data-m]').onclick = () => { close(); go('home'); };
    b.querySelector('[data-a]').onclick = () => { close(); go('game', cfg); };
  }, { sticky: true });
}

function openReplay(r) {
  if (!r) return;
  modal(`<h2>${r.won ? t('won') : t('lost')}</h2><p style="color:var(--muted);margin-top:0">${new Date(r.date).toLocaleString(getLang())} · ${fmt(r.duration)}</p><div id="rmap" style="height:360px;border-radius:18px;overflow:hidden"></div><button class="btn block" data-x style="margin-top:14px">${t('done')}</button>`, (b, close) => {
    b.querySelector('[data-x]').onclick = close;
    const kx = 111320 * Math.cos(r.center.lat * Math.PI / 180), ky = 110540;
    const ll = (p) => [r.center.lat + p[1] / ky, r.center.lng + p[0] / kx];
    const m = L.map(b.querySelector('#rmap'), { zoomControl: false }).setView([r.center.lat, r.center.lng], 15);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
    const z = L.circle([r.center.lat, r.center.lng], { radius: r.R, color: '#2c7a4b', weight: 3, dashArray: '10 8', fill: false }).addTo(m);
    let seg = [], role = null;
    const flush = () => { if (seg.length > 1) L.polyline(seg, { color: role ? '#f26d7d' : '#2fae66', weight: 5 }).addTo(m); };
    for (const p of r.track || []) { if (role !== null && p[2] !== role) { flush(); seg = [seg[seg.length - 1]]; } role = p[2]; seg.push(ll(p)); }
    flush();
    setTimeout(() => { m.invalidateSize(); m.fitBounds(z.getBounds()); }, 50);
  });
}

// ---------- модальные окна ----------
function openRules(startAt = 0) {
  const steps = tutorialSteps();
  let i = startAt;
  modal('', (box, close) => {
    const draw = () => {
      const s = steps[i];
      box.innerHTML = `<div class="mhead"><span class="k">${t('basicRules')}</span><button class="icon-btn" data-x>${I.close}</button></div>
        <h2>${s.t}</h2>${s.sub ? `<div style="color:var(--muted);margin:-6px 0 8px">${s.sub}</div>` : ''}
        ${s.html}
        ${s.cards ? `<div class="pw-item"><div class="pw-ico" style="color:var(--hider);background:none;border:0">${I.run}</div><div><h3>${t('hider')}</h3><p>${getLang() === 'ru' ? 'Не попадайтесь до конца времени. Если уцелел хоть один — прячущиеся побеждают.' : 'Stay free until time runs out. If even one Hider survives, the Hiders win.'}</p></div></div>
          <div class="pw-item"><div class="pw-ico" style="color:var(--hunter);background:none;border:0">${I.target}</div><div><h3>${t('hunter')}</h3><p>${getLang() === 'ru' ? 'Найдите и поймайте всех прячущихся до конца времени.' : 'Find and catch every Hider before time runs out.'}</p></div></div>` : ''}
        ${s.art ? `<div class="tut-art">${s.art}</div><div class="tut-cap">${s.cap}</div><div style="font-size:13px;color:var(--dim)">${getLang() === 'ru' ? 'Схема' : 'Diagram'} · Map Tag</div>` : ''}
        <div class="progress">${steps.map((_, k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('')}</div>
        <div style="color:var(--muted)">${t('stepOf', { a: i + 1, b: steps.length })}</div>
        <div class="tut-foot"><button class="btn big" data-b ${i === 0 ? 'disabled' : ''}>${t('back2')}</button><button class="btn primary big" data-n>${i === steps.length - 1 ? t('done') : t('next')}</button>
        <button class="btn full" data-p>${t('patchNotes')}</button></div>`;
      box.scrollTop = 0;
      box.querySelector('[data-x]').onclick = done;
      box.querySelector('[data-b]').onclick = () => { if (i > 0) { i--; draw(); } };
      box.querySelector('[data-n]').onclick = () => { if (i < steps.length - 1) { i++; draw(); } else done(); };
      box.querySelector('[data-p]').onclick = openNotes;
    };
    const done = () => { S.onboarded = true; save(); close(); };
    draw();
  }, { sticky: true });
}

function openNotes() {
  S.seenNotes = VERSION; save();
  document.querySelectorAll('[data-top="notes"] .dot').forEach((d) => d.remove());
  const notes = PATCH_NOTES[getLang()] || PATCH_NOTES.ru;
  modal(`<h2>${t('patchNotes')}</h2>${notes.map(([v, list]) => `<h3>${v}</h3><ul>${list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`).join('')}<button class="btn block" data-x>${t('done')}</button>`, (m, close) => m.querySelector('[data-x]').onclick = close);
}

const FLAG_RU = `<svg class="flag" viewBox="0 0 9 6"><rect width="9" height="2" fill="#fff"/><rect y="2" width="9" height="2" fill="#1c57a7"/><rect y="4" width="9" height="2" fill="#d52b1e"/></svg>`;
const FLAG_EN = `<svg class="flag" viewBox="0 0 60 30"><rect width="60" height="30" fill="#012169"/><path d="M0 0l60 30M60 0 0 30" stroke="#fff" stroke-width="6"/><path d="M0 0l60 30M60 0 0 30" stroke="#C8102E" stroke-width="3"/><path d="M30 0v30M0 15h60" stroke="#fff" stroke-width="10"/><path d="M30 0v30M0 15h60" stroke="#C8102E" stroke-width="6"/></svg>`;

function openSettings() {
  modal('', (box, close) => {
    const draw = () => {
      box.innerHTML = `<h2>${t('settings')}</h2>
        <div style="color:var(--muted);margin-left:4px">${t('language')}</div>
        <div class="lang"><button class="opt ${getLang() === 'ru' ? 'on' : ''}" data-l="ru">${FLAG_RU}<span class="t">Русский</span></button><button class="opt ${getLang() === 'en' ? 'on' : ''}" data-l="en">${FLAG_EN}<span class="t">English</span></button></div>
        <label class="set-row"><div><div class="tt">${t('devSettings')}</div><div class="ss">${t('devSettingsS')}</div></div><input type="checkbox" id="dev" ${S.dev ? 'checked' : ''}></label>
        <button class="set-row" data-s="privacy"><div><div class="tt">${t('privacy')}</div><div class="ss">${t('privacyText')}</div></div></button>
        <button class="set-row" data-s="perms"><div><div class="tt">${t('checkPerms')}</div><div class="ss">${t('checkPermsS')}</div></div></button>
        <button class="set-row" data-s="onb"><div><div class="tt">${t('resetOnb')}</div><div class="ss">${t('resetOnbS')}</div></div></button>
        <p style="margin:16px 4px"><a href="#" data-s="pn">${t('privacyNotice')}</a> · <a href="#" data-s="terms">${t('terms')}</a></p>
        <button class="btn block big" data-x>${t('done')}</button>`;
      box.querySelectorAll('[data-l]').forEach((b) => b.onclick = () => { setLang(b.dataset.l); draw(); });
      box.querySelector('#dev').onchange = (e) => { S.dev = e.target.checked; save(); };
      box.querySelector('[data-x]').onclick = () => { close(); if (current !== 'game') go(current); };
      box.querySelectorAll('[data-s]').forEach((b) => b.onclick = (e) => {
        e.preventDefault();
        const s = b.dataset.s;
        if (s === 'privacy' || s === 'pn') { close(); go('stats'); setTimeout(() => { const d = document.querySelector('details.acc'); if (d) { d.open = true; d.scrollIntoView({ behavior: 'smooth' }); } }, 50); }
        else if (s === 'perms') openPerms();
        else if (s === 'onb') { S.onboarded = false; save(); close(); openRules(); }
        else if (s === 'terms') modal(`<h2>${t('terms')}</h2><p>${t('termsText')}</p><button class="btn block" data-x>${t('done')}</button>`, (m, c2) => m.querySelector('[data-x]').onclick = c2);
      });
    };
    draw();
  });
}

async function openPerms() {
  const q = async (name) => { try { return (await navigator.permissions.query({ name })).state; } catch { return 'unknown'; } };
  const [geo, cam, notif] = await Promise.all([q('geolocation'), q('camera'), q('notifications')]);
  const row = (label, st, key) => `<div class="line-row"><span>${label}</span><span class="row"><b style="color:${st === 'granted' ? 'var(--hider)' : st === 'denied' ? 'var(--hunter)' : 'var(--muted)'}">${t(st)}</b>${st !== 'granted' ? `<button class="btn" data-ask="${key}" style="min-height:38px">${t('ask')}</button>` : ''}</span></div>`;
  modal(`<h2>${t('checkPerms')}</h2><div class="card" style="padding:6px 16px">${row(t('permGeo'), geo, 'geo')}${row(t('permCam'), cam, 'cam')}${row(t('permNotif'), notif, 'notif')}</div><button class="btn block" data-x style="margin-top:14px">${t('done')}</button>`, (m, close) => {
    m.querySelector('[data-x]').onclick = close;
    m.querySelectorAll('[data-ask]').forEach((b) => b.onclick = async () => {
      const k = b.dataset.ask;
      try {
        if (k === 'geo') await new Promise((res) => navigator.geolocation.getCurrentPosition(res, res));
        if (k === 'cam') { const s = await navigator.mediaDevices.getUserMedia({ video: true }); s.getTracks().forEach((x) => x.stop()); }
        if (k === 'notif') await Notification.requestPermission();
      } catch {}
      close(); openPerms();
    });
  });
}

// ---------- поделиться и QR ----------
function joinUrl(code) { return location.href.split('#')[0].replace(/^file:.*|^https:\/\/appassets\.androidplatform\.net.*/, 'https://mikhailkulinskii1910-jpg.github.io/vsluh/map_tag/') + '#join=' + code; }
async function shareLobby(code) {
  const url = joinUrl(code), text = t('shareText', { c: code });
  if (window.MapTagNative) { window.MapTagNative.share(text + ' ' + url); return; }
  try { if (navigator.share) { await navigator.share({ title: 'Map Tag', text, url }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(text + ' ' + url); toast(t('copied')); } catch { toast(text); }
}
function showQr(code) {
  const qr = qrcode(0, 'M'); qr.addData(joinUrl(code)); qr.make();
  modal(`<h2>${t('qrTitle')}</h2><p style="color:var(--muted)">${t('qrLead')}</p><div class="qr-box">${qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true })}</div><div class="lobby-code" style="text-align:center;font-size:36px">${code}</div><button class="btn block" data-x>${t('done')}</button>`, (m, close) => m.querySelector('[data-x]').onclick = close);
}
function scanQr(onCode) {
  let stream, raf, stopped = false;
  const stop = () => { stopped = true; cancelAnimationFrame(raf); stream && stream.getTracks().forEach((x) => x.stop()); };
  modal(`<h2>${t('scanTitle')}</h2><video class="scan" playsinline muted></video><button class="btn block" data-x style="margin-top:14px">${t('cancel')}</button>`, async (m, close) => {
    m.querySelector('[data-x]').onclick = close;
    const v = m.querySelector('video');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      v.srcObject = stream; await v.play();
    } catch { close(); toast(t('noCamera')); return; }
    const cv = document.createElement('canvas'), ctx = cv.getContext('2d', { willReadFrequently: true });
    const det = 'BarcodeDetector' in window ? new BarcodeDetector({ formats: ['qr_code'] }) : null;
    const found = (txt) => {
      const mm = /join=([A-Z0-9]{6})/.exec(txt) || /^([A-Z0-9]{6})$/.exec(txt.trim().toUpperCase());
      if (mm) { close(); onCode(mm[1]); return true; }
      return false;
    };
    const loop = async () => {
      if (stopped) return;
      if (v.videoWidth) {
        try {
          if (det) { const r = await det.detect(v); if (r[0] && found(r[0].rawValue)) return; }
          else {
            cv.width = v.videoWidth; cv.height = v.videoHeight; ctx.drawImage(v, 0, 0);
            const r = jsQR(ctx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height);
            if (r && found(r.data)) return;
          }
        } catch {}
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
  }, { onClose: stop });
}

// ---------- старт ----------
setLang(getLang());
const hash = /#join=([A-Z0-9]{6})/i.exec(location.hash);
if (hash) { history.replaceState(null, '', location.pathname); go('join', hash[1].toUpperCase()); }
else go('home');
if (!S.onboarded) setTimeout(() => openRules(), 300);
if ('serviceWorker' in navigator && location.protocol === 'https:' && !location.host.includes('appassets')) navigator.serviceWorker.register('sw.js').catch(() => {});
document.addEventListener('backbutton-press', () => { if (document.querySelector('.modal-wrap')) document.querySelector('.modal-wrap').remove(); else if (current !== 'home') go('home'); else window.MapTagNative && window.MapTagNative.exit(); });
// для отладки из консоли
window.__mt = { get game() { return game; }, go };
