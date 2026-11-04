// Map Tag — экраны приложения
import { t, setLang, getLang } from './i18n.js';
import { I } from './icons.js';
import { POWERUPS, pwName, pwDesc, tutorialSteps, PATCH_NOTES } from './content.js';
import { Game, fmt, BOT_NAMES } from './game.js';
import { applyTheme, themePicker } from './themes.js';
import { checkPass, renderCheats, openWheel, openGameCheats, applyPrank } from './cheats.js';
import { beep, soundOn, setSound } from './sound.js';
import { renderReplay } from './replay.js';
import { Room, newId } from './net.js';
import { renderMapEditor, drawMapExtras, mapPoints, buildingAt, lineBand } from './mapeditor.js';
import { OBJ, OBJ_KINDS, OUT_LIMIT, ZX, ZX_KINDS } from './world.js';
import { DEFAULT_ROOMS } from './indoor.js';
import { CHAT, chatInit, chatHandle, chatReset, openChat, sendPing, sendSos } from './chat.js';
import { VOICE, voiceInit, voiceHandle, voiceLeave, voiceMute } from './voice.js';

const VERSION = '3.1';
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
  center: null, bots: 5, hunters: 2, myRole: 'random', mode: 'gps', adv: {},
  revealCd: null, freezeCd: null, powerups: POWERUPS.map((p) => p.id),
});
function genCode() { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)]; return s; }
function calc(lb) {
  const sz = SIZES[lb.size], a = lb.adv || {}, blitz = lb.gmode === 'blitz';
  const radius = a.radius || Math.round(sz.r * Math.sqrt(VIS[lb.vis] * LIGHT[lb.light]) * (blitz ? 0.75 : 1) / 10) * 10;
  const huntSec = a.total || (blitz ? 300 : sz.min * 60);
  return {
    radius, huntSec, huntMin: Math.round(huntSec / 60), hideSec: a.head != null ? a.head : blitz ? 45 : Math.round(sz.min * 12),
    shrinkTo: a.shrink === false ? 1 : (a.final || (blitz ? 55 : 70)) / 100,
    revealCd: lb.revealCd || (blitz ? 40 : lb.extra === 'tutorial' ? 120 : 90), freezeCd: lb.freezeCd || (blitz ? 60 : 150),
  };
}
/** Список игроков лобби: вы + боты с ролями. */
function ensurePlayers(lb) {
  if (Array.isArray(lb.players) && lb.players.some((p) => !p.bot && !p.remote)) { lb.players.forEach((p) => { if (!p.id) p.id = p.bot ? 'b' + newId() : myNetId(); }); return; }
  const names = BOT_NAMES[getLang()] || BOT_NAMES.ru;
  const n = lb.bots ?? 5, h = Math.max(1, Math.min(lb.hunters ?? 2, n));
  lb.players = [{ id: myNetId(), role: 'hider', bot: false }, ...Array.from({ length: n }, (_, i) => ({ id: 'b' + newId(), name: names[i % names.length], role: i < h ? 'hunter' : 'hider', bot: true }))];
}
function myNetId() { if (!S.netId) { S.netId = newId(); save(); } return S.netId; }

// ================= онлайн =================
// NET: { room, role: 'host'|'client', code, myId, hostId, offs[], status }
let NET = null;
const netOffset = () => (NET && NET.offs && NET.offs.length ? Math.max(...NET.offs) : 0);
function netSample(ts) { if (!NET) return; NET.offs = NET.offs || []; NET.offs.push(ts - Date.now()); if (NET.offs.length > 20) NET.offs.shift(); }
function netStatusHtml() {
  const st = NET ? NET.room.status : 'off';
  const map = { online: ['var(--hider)', t('netOnline')], connecting: ['var(--gold)', t('netConnecting')], error: ['var(--hunter)', t('netError')], off: ['var(--muted)', t('netOff')] };
  const [c, txt] = map[st] || map.off;
  return `<span class="net-pill" id="netPill"><i style="background:${c}"></i>${txt}</span>`;
}
function netRefreshPill() { const el = document.getElementById('netPill'); if (el) el.outerHTML = netStatusHtml(); }
function netClose() { if (!NET) return; voiceLeave(); clearInterval(NET.ping); try { NET.room.disconnect(); } catch {} NET = null; chatReset(); }
function myRoleNow() {
  if (game) return game.me.role;
  if (NET && NET.role === 'client') { const p = ((NET.lobby || {}).players || []).find((x) => x.id === NET.myId); return p ? p.role : 'hider'; }
  const p = S.lobby && (S.lobby.players || []).find((x) => !x.bot && !x.remote); return p ? p.role : 'hider';
}
function chatBadges() { document.querySelectorAll('.chat-badge').forEach((b) => { b.textContent = CHAT.unread || ''; b.style.display = CHAT.unread ? '' : 'none'; }); }
const chatBtnHtml = () => `<button class="btn block chat-btn" data-chat>💬 ${t('chat')} <span class="chat-badge" style="display:${CHAT.unread ? '' : 'none'}">${CHAT.unread}</span></button>`;

/** Сообщения комнаты: в игре — движку, иначе — лобби. */
function netRoute(type, d, from, ts) {
  if (!NET) return;
  if (NET.role === 'client' && from === NET.hostId) netSample(ts);
  if (type === 'chat') { chatHandle(d, from); return; }
  if (type === 'prank') { applyPrank(d.k, game, toast); return; }
  if (/^v(join|here|sig|relay|leave|chunk|talk)$/.test(type)) { voiceHandle(type, d, from); return; }
  if (game && game.net) { if (type !== 'lobby' && type !== 'hello' && type !== 'ping') game.netHandle(type, d, from, ts); if (type === 'lobby') return; }
  if (NET.role === 'host') hostOnMsg(type, d, from, ts); else clientOnMsg(type, d, from, ts);
}

// ---------- организатор ----------
async function hostEnsure(lb) {
  if (NET && NET.role === 'host' && NET.code === lb.code) return;
  netClose();
  NET = { role: 'host', code: lb.code, myId: myNetId(), hostId: myNetId(), offs: [] };
  NET.room = new Room(lb.code, NET.myId, netRoute);
  NET.room.onStatus = netRefreshPill;
  try { await NET.room.host(); hostPublish(); } catch { netRefreshPill(); }
  NET.ping = setInterval(() => { if (!NET || NET.role !== 'host' || !S.lobby) return; hostPrune(); }, 10000);
}
let pubTimer = 0;
function hostPublish(status) {
  if (!NET || NET.role !== 'host' || !S.lobby) return;
  if (status) NET.lobbyStatus = status;
  clearTimeout(pubTimer);
  pubTimer = setTimeout(() => {
    const lb = S.lobby; if (!lb || !NET) return;
    const c = calc(lb);
    NET.room.setLobby({
      status: NET.lobbyStatus || 'lobby', hostId: NET.myId, host: S.name, code: lb.code,
      set: { gmode: lb.gmode || 'classic', map: lb.map || null, size: lb.size, vis: lb.vis, light: lb.light, extra: lb.extra, shape: lb.shape || 'circle', center: lb.center || { lat: 55.7520, lng: 37.6175 }, poly: lb.shape === 'custom' ? lb.poly : null, radius: c.radius, huntSec: c.huntSec, hideSec: c.hideSec, shrinkTo: c.shrinkTo, transport: lb.transport !== false, compass: lb.compass || 'off', detector: lb.detector || 'off' },
      players: lb.players.map((p) => ({ id: p.id, name: p.bot ? p.name : p.remote ? p.name : S.name, role: p.role, bot: !!p.bot, host: !p.bot && !p.remote, avatar: p.bot ? null : p.remote ? p.avatar || null : S.avatar || null })),
    });
  }, 250);
}
function hostPrune() {
  const lb = S.lobby; if (!lb) return;
  const now = Date.now(), before = lb.players.length;
  lb.players = lb.players.filter((p) => !p.remote || now - (p.seen || 0) < 45000);
  if (lb.players.length !== before) { save(); hostPublish(); if (current === 'lobby') rerenderLobby(); }
}
function rerenderLobby() { const y = window.scrollY; go('lobby'); window.scrollTo(0, y); }
function hostOnMsg(type, d, from) {
  const lb = S.lobby; if (!lb) return;
  if (type === 'hello' || type === 'ping') {
    let p = lb.players.find((x) => x.id === from);
    if (!p && type === 'hello') {
      if (NET.lobbyStatus === 'playing') return;
      const n = lb.players.length + 1, hunt = lb.players.filter((x) => x.role === 'hunter').length;
      p = { id: from, name: String(d.name || '?').slice(0, 16), role: hunt < Math.max(1, Math.round(n / 3)) ? 'hunter' : 'hider', bot: false, remote: true };
      lb.players.push(p); toast(t('netJoined', { n: p.name }));
    }
    if (!p) { if (type === 'ping') NET.room.send('who', {}, from); return; }
    if (d.name) p.name = String(d.name).slice(0, 16);
    if (d.avatar !== undefined) p.avatar = d.avatar ? String(d.avatar).slice(0, 4) : null;
    p.seen = Date.now();
    if (type === 'hello') { save(); hostPublish(); if (current === 'lobby') rerenderLobby(); }
  } else if (type === 'bye') {
    const i = lb.players.findIndex((x) => x.id === from && x.remote);
    if (i >= 0) { toast(t('playerLeft', { n: lb.players[i].name })); lb.players.splice(i, 1); save(); hostPublish(); if (current === 'lobby') rerenderLobby(); }
  }
}

// ---------- участник ----------
async function clientJoin(code, name) {
  netClose();
  NET = { role: 'client', code, myId: myNetId(), offs: [] };
  NET.room = new Room(code, NET.myId, netRoute);
  NET.room.onStatus = netRefreshPill;
  let snap = null;
  try { snap = await NET.room.join(); } catch { snap = null; }
  if (!snap) { netClose(); return { err: 'notFound' }; }
  if (snap.status === 'playing') { netClose(); return { err: 'playing' }; }
  NET.hostId = snap.hostId; NET.lobby = snap;
  if (NET.room.lobbyTs) netSample(NET.room.lobbyTs);
  NET.room.send('hello', { name, avatar: S.avatar || null });
  NET.ping = setInterval(() => { if (NET && NET.role === 'client') NET.room.send('ping', { name: S.name }); }, 8000);
  return { ok: true };
}
function clientOnMsg(type, d, from, ts) {
  if (type === 'lobby') {
    if (d.status === 'closed') { netClose(); toast(t('hostLeft')); if (current === 'clientLobby') go('home'); return; }
    NET.lobby = d; if (from === NET.hostId) netSample(ts);
    if (current === 'clientLobby') { const y = window.scrollY; go('clientLobby'); window.scrollTo(0, y); }
  } else if (type === 'who') NET.room.send('hello', { name: S.name });
  else if (type === 'kick' && (!d.id || d.id === NET.myId)) { netClose(); toast(t('netKicked')); go('home'); }
  else if (type === 'abort' && !game) { netClose(); toast(t('hostLeft')); go('home'); }
  else if (type === 'start' && from === NET.hostId) {
    netSample(ts);
    const cfg = { ...d.cfg, avatar: S.avatar || null, myId: NET.myId, name: S.name, mode: S.clientMode || 'gps', cheats: S.cheatsUnlocked ? { ...(S.cheats || {}) } : {} };
    go('game', { ...cfg, net: { room: NET.room, role: 'client', myId: NET.myId, hostId: NET.hostId, startAt: d.startAt, offset: netOffset() } });
  }
}
const parseTime = (s) => { s = String(s).trim(); if (!s) return null; const p = s.split(':').map(Number); if (p.some(isNaN)) return null; return p.length === 1 ? p[0] * 60 : p.length === 2 ? p[0] * 60 + p[1] : p[0] * 3600 + p[1] * 60 + p[2]; };

function advancedBlock(lb, c) {
  const a = lb.adv || {};
  const shrink = a.shrink !== false;
  const row = (k, label, val, min, max, step, txt, unit, hint) => `<div class="adv-row"><div class="row" style="justify-content:space-between"><b>${label}</b><b id="av_${k}">${txt}</b></div>
    <div class="row" style="flex-wrap:nowrap;margin-top:8px"><input type="range" class="range" data-av="${k}" min="${min}" max="${max}" step="${step}" value="${val}" style="flex:1"><input class="input adv-in" data-ai="${k}" value="${unit === 'time' ? txt : val}" inputmode="${unit === 'time' ? 'text' : 'numeric'}">${unit && unit !== 'time' ? `<span style="color:var(--muted)">${unit}</span>` : ''}</div>
    ${hint ? `<div class="adv-hint">${hint}</div>` : ''}</div>`;
  return `<label class="adv-row row" style="justify-content:space-between;flex-wrap:nowrap;cursor:pointer"><span><b>${t('shrinkArea')}</b><br><span class="adv-hint">${t('shrinkAreaS')}</span></span><input type="checkbox" id="advShrink" ${shrink ? 'checked' : ''} style="width:30px;height:30px;accent-color:var(--accent);flex:none"></label>
    <label class="adv-row row" style="justify-content:space-between;flex-wrap:nowrap;cursor:pointer"><span><b>${t('catchCode')}</b><br><span class="adv-hint">${t('catchCodeS')}</span></span><input type="checkbox" id="advCode" ${lb.catchCode !== false ? 'checked' : ''} style="width:30px;height:30px;accent-color:var(--accent);flex:none"></label>
    <label class="adv-row row" style="justify-content:space-between;flex-wrap:nowrap;cursor:pointer"><span><b>${t('transportOk')}</b><br><span class="adv-hint">${t('transportOkS')}</span></span><input type="checkbox" id="advTransport" ${lb.transport !== false ? 'checked' : ''} style="width:30px;height:30px;accent-color:var(--accent);flex:none"></label>
    <div class="adv-row"><b>${t('outLimit')}</b><div class="adv-hint">${t('outLimitS')}</div><div class="seg" style="display:flex;margin-top:8px">${[15, 30, 60, 0].map((v) => `<button data-ol="${v}" class="${(lb.outLimit != null ? lb.outLimit : 30) === v ? 'on' : ''}" style="flex:1">${v ? v + ' ' + t('sec') : t('hv_off')}</button>`).join('')}</div></div>
    <div class="adv-row"><b>${t('botLevel')}</b><div class="seg" style="display:flex;margin-top:8px">${['easy', 'normal', 'hard'].map((v) => `<button data-bl="${v}" class="${(lb.botLevel || 'normal') === v ? 'on' : ''}" style="flex:1">${t('bl_' + v)}</button>`).join('')}</div></div>
    ${row('radius', t('areaRadius'), c.radius, 100, 2000, 10, c.radius + ' ' + t('m'), t('m'))}
    ${shrink ? row('final', t('finalRadius'), Math.round(c.shrinkTo * 100), 30, 100, 1, Math.round(c.shrinkTo * 100) + '%', '%', t('finalRadiusS')) : ''}
    ${row('total', t('totalLen'), c.huntSec, 180, 5400, 30, fmt(c.huntSec), 'time', t('timeFmt'))}
    ${row('head', t('headStart'), c.hideSec, 0, 900, 15, fmt(c.hideSec), 'time', t('timeFmt'))}
    ${S.dev ? devTuning(lb, c) : ''}
    <button class="btn block" id="advReset" style="margin-top:12px">${t('resetAdv')}</button>`;
}
function bindAdvanced(el, lb, rerender) {
  lb.adv = lb.adv || {};
  const set = (k, v) => { lb.adv[k] = v; };
  const show = (k, v) => { const o = el.querySelector('#av_' + k), i = el.querySelector(`[data-ai="${k}"]`); const txt = k === 'radius' ? v + ' ' + t('m') : k === 'final' ? v + '%' : fmt(v); if (o) o.textContent = txt; if (i && document.activeElement !== i) i.value = k === 'total' || k === 'head' ? txt : v; };
  el.querySelectorAll('[data-av]').forEach((r) => { r.oninput = () => { set(r.dataset.av, +r.value); show(r.dataset.av, +r.value); }; r.onchange = rerender; });
  el.querySelectorAll('[data-ai]').forEach((inp) => inp.onchange = () => {
    const k = inp.dataset.ai; let v = k === 'total' || k === 'head' ? parseTime(inp.value) : parseInt(inp.value, 10);
    if (v == null || isNaN(v)) return rerender();
    const lim = { radius: [50, 5000], final: [10, 100], total: [60, 4 * 3600], head: [0, 3600] }[k];
    set(k, Math.max(lim[0], Math.min(lim[1], v))); rerender();
  });
  el.querySelectorAll('[data-bl]').forEach((b) => b.onclick = () => { lb.botLevel = b.dataset.bl; rerender(); });
  el.querySelectorAll('[data-ol]').forEach((b) => b.onclick = () => { lb.outLimit = +b.dataset.ol; rerender(); });
  const cc = el.querySelector('#advCode'); if (cc) cc.onchange = () => { lb.catchCode = cc.checked; save(); };
  const tr = el.querySelector('#advTransport'); if (tr) tr.onchange = () => { lb.transport = tr.checked; save(); };
  const sh = el.querySelector('#advShrink'); if (sh) sh.onchange = () => { set('shrink', sh.checked); rerender(); };
  const rs = el.querySelector('#advReset'); if (rs) rs.onclick = () => { lb.adv = {}; rerender(); };
  el.querySelectorAll('[data-tune]').forEach((r) => { r.oninput = () => { lb[r.dataset.tune] = +r.value; el.querySelector(`#v_${r.dataset.tune}`).textContent = r.value; }; r.onchange = rerender; });
  el.querySelectorAll('[data-pwt]').forEach((cb) => cb.onchange = () => { const id = cb.dataset.pwt; lb.powerups = cb.checked ? [...new Set([...lb.powerups, id])] : lb.powerups.filter((x) => x !== id); save(); });
}
// ---------- сохранённые пресеты (расширенные настройки) ----------
function presetsBlock() {
  const ps = S.presets || [];
  return `<div class="sect">${t('presets')}</div><div class="card" style="padding:10px 14px">
    ${ps.length ? ps.map((p, i) => `<div class="line-row"><button class="btn ghost" data-pload="${i}" style="flex:1;justify-content:flex-start;padding:0">${esc(p.name)}</button><button class="btn" data-pdel="${i}" style="min-height:36px;padding:0 10px">${I.close.replace('<svg', '<svg width="16" height="16"')}</button></div>`).join('') : `<div style="color:var(--muted)">${t('noPresets')}</div>`}
    <button class="btn block" id="psave" style="margin-top:10px">${t('savePreset')}</button></div>`;
}
function bindPresets(el, lb) {
  const keys = ['gmode', 'map', 'size', 'vis', 'light', 'extra', 'compass', 'detector', 'fog', 'chaos', 'drone', 'drift', 'objects', 'adv', 'revealCd', 'freezeCd', 'powerups', 'shape', 'poly', 'center'];
  const sv = el.querySelector('#psave');
  if (sv) sv.onclick = () => modal(`<h2>${t('savePreset')}</h2><input class="input" id="pname" maxlength="24" placeholder="${t('presetName')}"><div class="row" style="margin-top:14px"><button class="btn" data-x style="flex:1">${t('cancel')}</button><button class="btn primary" data-ok style="flex:1">OK</button></div>`, (b, close) => {
    b.querySelector('[data-x]').onclick = close;
    b.querySelector('[data-ok]').onclick = () => { const name = b.querySelector('#pname').value.trim() || t('presets') + ' ' + ((S.presets || []).length + 1); const data = {}; keys.forEach((k) => data[k] = JSON.parse(JSON.stringify(lb[k] ?? null))); S.presets = [...(S.presets || []), { name, data }]; save(); close(); go('lobby'); };
  });
  el.querySelectorAll('[data-pload]').forEach((b) => b.onclick = () => { const p = S.presets[+b.dataset.pload]; Object.assign(lb, JSON.parse(JSON.stringify(p.data))); save(); toast(p.name); go('lobby'); });
  el.querySelectorAll('[data-pdel]').forEach((b) => b.onclick = () => { S.presets.splice(+b.dataset.pdel, 1); save(); go('lobby'); });
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
  root.querySelectorAll('[data-chat]').forEach((b) => b.onclick = () => openChat(modal));
  // секретный вход: 5 касаний по логотипу
  const brand = root.querySelector('.brand');
  if (brand) brand.onclick = () => {
    const now = Date.now();
    secretTaps = now - secretLast < 1500 ? secretTaps + 1 : 1; secretLast = now;
    if (secretTaps >= 5) { secretTaps = 0; if (S.cheatsUnlocked) go('cheats'); else askPassword(); }
  };
}
let secretTaps = 0, secretLast = 0;
function askPassword(onOk) {
  modal(`<h2>${I.lock.replace('<svg', '<svg width="26" height="26" style="vertical-align:-3px"')} ${t('password')}</h2>
    <input class="input code-input" id="pw" type="password" inputmode="numeric" autocomplete="off" style="letter-spacing:.2em">
    <div class="row" style="margin-top:16px"><button class="btn" data-x style="flex:1">${t('cancel')}</button><button class="btn primary" data-ok style="flex:1">${t('enter')}</button></div>`, (b, close) => {
    const inp = b.querySelector('#pw'); setTimeout(() => inp.focus(), 50);
    const ok = () => { if (checkPass(inp.value)) { S.cheatsUnlocked = true; save(); close(); onOk ? onOk() : go('cheats'); } else { inp.value = ''; toast(t('wrongPass')); } };
    b.querySelector('[data-x]').onclick = close; b.querySelector('[data-ok]').onclick = ok;
    inp.onkeydown = (e) => { if (e.key === 'Enter') ok(); };
  });
}

// ---------- навигация ----------
let current = 'home';
let game = null;
let stopReplay = null;
function go(screen, arg) {
  if (game) { game.destroy(); game = null; }
  if (stopReplay) { stopReplay(); stopReplay = null; }
  current = screen;
  const fn = SCREENS[screen] || SCREENS.home;
  $app.innerHTML = '';
  const el = document.createElement('div');
  el.className = screen === 'game' || screen === 'replay' || screen === 'mapEditor' ? '' : 'screen screen-enter';
  $app.appendChild(el);
  fn(el, arg);
  window.scrollTo(0, 0);
}

const SCREENS = {
  home(el) {
    const st = S.stats, lb = S.lobby;
    // уровень игрока из статистики
    const xp = st.games * 20 + st.wins * 30 + st.caught * 10 + st.missions * 15;
    const lvl = Math.floor(Math.sqrt(xp / 50)) + 1, lo = (lvl - 1) ** 2 * 50, hi = lvl ** 2 * 50;
    const pct = Math.round((xp - lo) / Math.max(1, hi - lo) * 100);
    // режим дня — одинаковый у всех в этот день
    const MODES = [['classic', '🏃'], ['jail', '⛓'], ['treasure', '🪙'], ['sardines', '🐟'], ['hill', '⛰'], ['ghosts', '👻'], ['zombie', '🧟'], ['vip', '👑'], ['bomb', '💣'], ['tag', '🏷'], ['predator', '🦖'], ['royale', '🎯'], ['blind', '🙈'], ['impostor', '🔪'], ['mimic', '🎭'], ['phantom', '🫥'], ['flag', '🚩'], ['infection', '💉'], ['bounty', '🎯'], ['checkpoint', '🏴'], ['lastman', '🏆'], ['stalker', '🕶']];
    const day = Math.floor(Date.now() / 864e5), [dm, di] = MODES[(day * 7 + 3) % MODES.length];
    const tip = t('tip' + ((day % 8) + 1));
    const km = (st.dist / 1000).toFixed(1);
    el.innerHTML = `${topbar(false)}
      <div class="hero-card">
        <div class="hc-top">
          <div class="hc-av">${S.avatar || esc((S.name || '?')[0].toUpperCase())}</div>
          <div class="hc-who"><div class="hc-hi">${S.name ? t('hiName', { n: esc(S.name) }) : t('homeTitle')}</div><div class="hc-sub">${t('homeSub')}</div></div>
          <div class="hc-lvl"><b>${lvl}</b><span>${t('lvl')}</span></div>
        </div>
        <div class="hc-xp"><i style="width:${pct}%"></i></div>
        <div class="hc-stats"><div><b>${st.games}</b><span>${t('hsGames')}</span></div><div><b>${st.wins}</b><span>${t('hsWins')}</span></div><div><b>${st.caught}</b><span>${t('hsCaught')}</span></div><div><b>${km}</b><span>${t('hsKm')}</span></div></div>
      </div>
      ${lb ? `<button class="resume" data-go="lobby"><span class="rs-ic">🎮</span><span class="rs-t"><b>${t('resumeLobby')}</b><small>${t('gm_' + (lb.gmode || 'classic'))} · ${t('playersN', { n: (lb.players || []).length })}</small></span><span class="arr">${I.arrowR}</span></button>` : ''}
      <div class="big2">
        <button class="big-tile bt-host" data-go="host"><span class="bt-ic">${I.map}</span><b>${t('host')}</b><small>${t('hostS')}</small></button>
        <button class="big-tile bt-join" data-go="join"><span class="bt-ic">${I.users}</span><b>${t('join')}</b><small>${t('joinS')}</small></button>
      </div>
      <button class="day-card" id="dayMode"><span class="dc-ic">${di}</span><span class="dc-t"><small>${t('modeOfDay')}</small><b>${t('gm_' + dm)}</b><span>${t('gm_' + dm + 'S')}</span></span><span class="dc-go">${t('play')}</span></button>
      <div class="tiles4">
        <button class="tile4" id="quick"><span>⚡</span><b>${t('quickGame')}</b><small>${t('quickGameS')}</small></button>
        <button class="tile4" id="homeEd"><span>🗺</span><b>${t('mapEditor')}</b><small>${t('homeEdS')}</small></button>
        <button class="tile4" data-go="stats"><span>🏅</span><b>${t('profileShort')}</b><small>${t('achTitle')} · ${Object.keys(S.ach || {}).length}</small></button>
        <button class="tile4" data-go="learn"><span>📖</span><b>${t('rulesShort')}</b><small>${t('rulesS')}</small></button>
      </div>
      <div class="tip-card"><span>💡</span><div><b>${t('tipTitle')}</b><p>${tip}</p></div></div>
      ${supportBlock()}`;
    bindCommon(el);
    el.querySelector('#quick').onclick = () => SCREENS.quick();
    const needLobby = () => { if (!S.name) S.name = t('playerDefault'); if (!S.lobby) S.lobby = defaultLobby(); };
    el.querySelector('#dayMode').onclick = () => { needLobby(); S.lobby.gmode = dm; S.lobby.adv = {}; S.lobby.step = 1; save(); go('lobby'); };
    el.querySelector('#homeEd').onclick = () => { needLobby(); save(); go('mapEditor'); };
  },

  quick() {
    // быстрая игра: блиц с ботами в демо-режиме, у вас или в центре Москвы
    const start = (center) => {
      const lb = { ...defaultLobby(), gmode: 'blitz', mode: 'demo', center, step: 2 };
      ensurePlayers(lb);
      const cc = calc(lb);
      go('game', { center, radius: cc.radius, polygon: null, huntSec: cc.huntSec, hideSec: cc.hideSec, shrinkTo: cc.shrinkTo, features: 'spice', powerups: lb.powerups,
        revealCd: cc.revealCd, freezeCd: cc.freezeCd, bots: 5, hunters: 2, roles: lb.players.map((p) => ({ name: p.bot ? p.name : S.name, role: p.role, bot: !!p.bot })),
        myRole: 'hider', mode: 'demo', name: S.name || 'Я', transport: true, compass: 'off', detector: 'all', gmode: 'classic', nogo: [], points: {}, blitz: true, cheats: S.cheatsUnlocked ? { ...(S.cheats || {}) } : {} });
    };
    const fallback = { lat: 55.7520, lng: 37.6175 };
    if (!navigator.geolocation) return start(fallback);
    let done = false; const go2 = (c) => { if (!done) { done = true; start(c); } };
    navigator.geolocation.getCurrentPosition((p) => go2({ lat: p.coords.latitude, lng: p.coords.longitude }), () => go2(fallback), { timeout: 4000 });
    setTimeout(() => go2(fallback), 4500);
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
      const btn = el.querySelector('#go'); btn.disabled = true; btn.textContent = t('netSearching');
      clientJoin(cd.value, n).then((r) => {
        btn.disabled = false; btn.textContent = t('joinLobby');
        if (r.ok) return go('clientLobby');
        if (r.err === 'playing') return toast(t('netPlaying'));
      modal(`<p style="font-size:18px">${t('noLobbyNet', { c: esc(cd.value) })}</p><div class="row" style="margin-top:16px"><button class="btn" data-n style="flex:1">${t('cancel')}</button><button class="btn violet" data-y style="flex:1">${t('host')}</button></div>`, (b, close) => {
        b.querySelector('[data-n]').onclick = close;
        b.querySelector('[data-y]').onclick = () => { close(); S.lobby = defaultLobby(); save(); go('lobby'); };
      });
      });
    };
  },

  clientLobby(el) {
    if (!NET || NET.role !== 'client' || !NET.lobby) return go('home');
    const L0 = NET.lobby, st = L0.set || {}, ru = getLang() === 'ru';
    const meP = (L0.players || []).find((p) => p.id === NET.myId);
    const badge = (r) => `<span class="rbadge ${r}">${t(r)}</span>`;
    el.innerHTML = `
      <div class="lobby-code-lbl" style="margin-top:8px">${t('lobbyCodeLbl')}</div>
      <div class="lobby-code">${esc(L0.code || NET.code)}</div>
      <div class="row lobby-btns">
        <button class="btn danger" id="cLeave">${I.leave}${t('leave')}</button>
        ${netStatusHtml()}
        <button class="icon-btn" data-top="rules" aria-label="rules" style="margin-left:auto">${I.help}</button>
        <button class="icon-btn" data-top="settings" aria-label="settings">${I.gear}</button>
      </div>
      <div class="make-yours"><div><div class="k">${t('netHostIs')}</div><h2>${esc(L0.host || '—')}</h2></div></div>
      ${chatBtnHtml()}
      <div class="card wait-card">${I.clock}<div><b>${t('netWaiting')}</b><div style="color:var(--muted);font-size:15px;margin-top:4px">${meP ? t('netYourRole', { r: t(meP.role) }) : t('netNotListed')}</div></div></div>
      <div class="set-sum" style="cursor:default">${I.gear}<b>${t('settings')}</b><span>${[t('gm_' + (st.gmode || 'classic')), t(st.size || 'medium'), t(st.vis === 'city' ? 'openCity' : st.vis || 'mixed'), t(st.light || 'day'), t(st.extra || 'spice'), ...(st.compass && st.compass !== 'off' ? [t('compass') + ': ' + t('hv_' + st.compass)] : []), ...(st.detector && st.detector !== 'off' ? [t('detector') + ': ' + t('hv_' + st.detector)] : [])].join(' · ')}</span></div>
      <div class="summary"><div class="l">${t('radius')}</div><div class="l">${t('huntDur')}</div>
        <div class="v">${Math.round(st.radius || 0)} ${t('m')}</div><div class="v">${fmt(st.huntSec || 0)}</div>
        <div class="sub">${t('toHide', { t: fmt(st.hideSec || 0) })} · ${st.shrinkTo < 1 ? t('shrinks', { p: Math.round(st.shrinkTo * 100) }) : t('noShrink')}${st.transport !== false ? ' · ' + t('transportShort') : ''}</div></div>
      <div class="map-card"><div class="pick-map" id="cmap"></div><div class="map-cap">${t('netAreaCap')}</div></div>
      <div class="card crew">
        <div class="kicker2">${t('yourCrew')}</div>
        <h2 class="row" style="font-size:28px">${I.users.replace('<svg', '<svg width="26" height="26"')} ${t('playersN', { n: (L0.players || []).length })}</h2>
        <div class="crew-list" style="margin-top:12px">${(L0.players || []).map((p) => `<div class="crew-row">${badge(p.role)}<span class="nm">${p.avatar ? p.avatar + ' ' : ''}${esc(p.name)} <span class="tag">· ${p.id === NET.myId ? t('you') : p.host ? t('netHostTag') : p.bot ? t('bot') : t('netOnlineTag')}</span></span></div>`).join('')}</div>
        <div class="line-row" style="margin-top:8px"><span>${t('moveMode')}</span><div class="seg">${['gps', 'demo'].map((r) => `<button data-cm="${r}" class="${(S.clientMode || 'gps') === r ? 'on' : ''}">${t(r)}</button>`).join('')}</div></div>
      </div>`;
    bindCommon(el);
    el.querySelector('#cLeave').onclick = () => { if (NET) NET.room.send('bye', {}); setTimeout(netClose, 300); go('home'); };
    el.querySelectorAll('[data-cm]').forEach((b) => b.onclick = () => { S.clientMode = b.dataset.cm; save(); const y = window.scrollY; go('clientLobby'); window.scrollTo(0, y); });
    if (st.center) {
      const m = L.map(el.querySelector('#cmap'), { preferCanvas: true, zoomControl: false, dragging: true }).setView([st.center.lat, st.center.lng], 15);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
      m.attributionControl.setPrefix(false);
      const zst = { color: '#2c7a4b', weight: 3, dashArray: '10 8', fillColor: '#5fd38d', fillOpacity: 0.08 };
      const z = st.poly && st.poly.length >= 3 ? L.polygon(st.poly.map((q) => [q.lat, q.lng]), zst).addTo(m) : null;
      setTimeout(() => { m.invalidateSize(); m.fitBounds(z ? z.getBounds() : L.latLng(st.center.lat, st.center.lng).toBounds(st.radius * 2)); if (!z) L.circle([st.center.lat, st.center.lng], { radius: st.radius, ...zst }).addTo(m); if (st.map) drawMapExtras(m, { map: st.map }); }, 60);
    } else el.querySelector('#cmap').innerHTML = `<div class="empty">${t('netNoPlace')}</div>`;
  },

  lobby(el) {
    const lb = S.lobby;
    if (!lb) return go('host');
    ensurePlayers(lb);
    const c = calc(lb);
    const ru = getLang() === 'ru';
    const pct = (f) => (f > 1 ? '+' : '−') + Math.round(Math.abs(1 - f) * 100) + '%';
    const opt = (group, key, icon, title, sub, on) => `<button class="opt ${on ? 'on' : ''}" data-g="${group}" data-k="${key}">${I[icon]}<span class="t">${title}</span>${sub ? `<span class="s">${sub}</span>` : ''}</button>`;
    const sizeSub = (k) => `${SIZES[k].min} ${t('min')} · ${Math.round(SIZES[k].r * Math.sqrt(VIS[lb.vis] * LIGHT[lb.light]) / 10) * 10} ${t('m')}`;
    const summary = `<div class="summary"><div class="l">${t('radius')}</div><div class="l">${t('huntDur')}</div>
        <div class="v">${c.radius} ${t('m')}</div><div class="v">${fmt(c.huntSec)}</div>
        <div class="sub">${t('toHide', { t: fmt(c.hideSec) })} · ${c.shrinkTo < 1 ? t('shrinks', { p: Math.round(c.shrinkTo * 100) }) : t('noShrink')}</div>
        <div class="saved">${t('saved')}</div></div>`;

    const step1 = `
      <div class="sect">${t('gmode')}<button class="qbtn" data-q="gmode">${I.help}</button><button class="chip" id="randMode" style="margin-left:auto;min-height:36px;padding:0 12px">🎲 ${t('randMode')}</button></div>
      <div class="opts c2 gmodes">${[['classic', '🏃'], ['jail', '⛓'], ['treasure', '🪙'], ['sardines', '🐟'], ['hill', '⛰'], ['ghosts', '👻'], ['zombie', '🧟'], ['vip', '👑'], ['bomb', '💣'], ['tag', '🏷'], ['predator', '🦖'], ['royale', '🎯'], ['blind', '🙈'], ['indoor', '🏠'], ['impostor', '🔪'], ['mimic', '🎭'], ['phantom', '🫥'], ['flag', '🚩'], ['infection', '💉'], ['bounty', '🎯'], ['checkpoint', '🏴'], ['lastman', '🏆'], ['stalker', '🕶'], ['blitz', '⚡']].map(([k, ic]) => `<button class="opt ${(lb.gmode || 'classic') === k ? 'on' : ''}" data-gm="${k}"><span style="font-size:28px">${ic}</span><span class="t">${t('gm_' + k)}</span><span class="s">${t('gm_' + k + 'S')}</span></button>`).join('')}</div>
      <div class="sect">${t('sizeLen')}</div>
      <div class="opts c3">${opt('size', 'small', 'sprout', t('small'), sizeSub('small'), lb.size === 'small')}${opt('size', 'medium', 'tree', t('medium'), sizeSub('medium'), lb.size === 'medium')}${opt('size', 'large', 'mountain', t('large'), sizeSub('large'), lb.size === 'large')}</div>
      <div class="sect">${t('visibility')}<button class="qbtn" data-q="vis">${I.help}</button></div>
      <div class="opts c3">${opt('vis', 'forest', 'forest', t('forest'), t('areaPct', { p: pct(VIS.forest) }), lb.vis === 'forest')}${opt('vis', 'mixed', 'house', t('mixed'), '', lb.vis === 'mixed')}${opt('vis', 'city', 'city', t('openCity'), t('areaPct', { p: pct(VIS.city) }), lb.vis === 'city')}</div>
      <div class="sect">${t('lighting')}</div>
      <div class="opts c2">${opt('light', 'day', 'sun', t('day'), '', lb.light === 'day')}${opt('light', 'dark', 'moon', t('dark'), t('areaPct', { p: pct(LIGHT.dark) }), lb.light === 'dark')}</div>
      <div class="sect">${t('extras')}<button class="qbtn" data-q="extra">${I.help}</button></div>
      <div class="opts c3">${opt('extra', 'tutorial', 'book', t('tutorial'), '', lb.extra === 'tutorial')}${opt('extra', 'simple', 'sparkle', t('simple'), '', lb.extra === 'simple')}${opt('extra', 'spice', 'pepper', t('spice'), '', lb.extra === 'spice')}</div>
      <div class="sect">${t('helpers')}<button class="qbtn" data-q="helpers">${I.help}</button></div>
      <div class="card" style="padding:4px 16px">
        ${['compass', 'detector', 'fog'].map((k) => `<div class="line-row helper-row"><span class="row" style="gap:10px;flex-wrap:nowrap">${I[k === 'compass' ? 'north' : k === 'fog' ? 'cloud' : 'scan'].replace('<svg', '<svg width="22" height="22" style="color:var(--accent)"')}<b>${t(k)}</b></span><div class="seg">${['off', 'hunters', 'all'].map((v) => `<button data-hk="${k}:${v}" class="${(lb[k] || 'off') === v ? 'on' : ''}">${t('hv_' + v)}</button>`).join('')}</div></div>`).join('')}
        ${[['objects', '🎁'], ['drone', '🛸'], ['drift', '🌀']].map(([k, ic]) => `<div class="line-row helper-row"><span class="row" style="gap:10px;flex-wrap:nowrap"><span style="font-size:20px">${ic}</span><b>${t('opt_' + k)}</b></span><div class="seg">${['off', 'on'].map((v) => `<button data-opt="${k}:${v}" class="${((k === 'objects' ? lb[k] !== false : lb[k]) ? 'on' : 'off') === v ? 'on' : ''}">${t(v === 'on' ? 'chaosOn' : 'hv_off')}</button>`).join('')}</div></div>`).join('')}
        <div class="line-row helper-row"><span class="row" style="gap:10px;flex-wrap:nowrap"><span style="font-size:20px">🎲</span><b>${t('chaos')}</b></span><div class="seg">${['off', 'on'].map((v) => `<button data-chaos="${v}" class="${(lb.chaos ? 'on' : 'off') === v ? 'on' : ''}">${t(v === 'on' ? 'chaosOn' : 'hv_off')}</button>`).join('')}</div></div>
      </div>
      ${S.dev ? presetsBlock() : ''}
      ${summary}
      <button class="btn primary big block next-btn" data-step="2"><span>${t('next')}</span>${I.arrowR}</button>`;

    const hunters = lb.players.filter((p) => p.role === 'hunter').length, hiders = lb.players.filter((p) => p.role === 'hider').length;
    const badge = (r) => `<span class="rbadge ${r}">${t(r)}</span>`;
    const crewRows = lb.players.map((p, i) => lb.manage
      ? `<div class="crew-row manage"><div class="row" style="justify-content:space-between;width:100%">${badge(p.role)}${p.bot || p.remote ? `<button class="btn" data-rm="${i}" style="min-height:36px;padding:0 10px">${I.close.replace('<svg', '<svg width="16" height="16"')}</button>` : ''}</div>
          <div class="nm">${p.bot ? `<input class="input" data-pn="${i}" value="${esc(p.name)}" maxlength="16" style="min-height:40px;font-size:16px">` : p.remote ? `${esc(p.name)} <span class="tag">· ${t('netOnlineTag')}</span>` : `${esc(S.name)} <span class="tag">· ${t('hostYou')}</span>`}</div>
          <div class="row" style="justify-content:flex-end;width:100%"><button class="btn ${p.role === 'hunter' ? 'primary' : ''}" data-pr="${i}:hunter" style="min-height:40px">${t('hunter')}</button><button class="btn ${p.role === 'hider' ? 'primary' : ''}" data-pr="${i}:hider" style="min-height:40px">${t('hider')}</button>${p.bot ? '' : `<button class="btn ${p.role === 'spectator' ? 'primary' : ''}" data-pr="${i}:spectator" style="min-height:40px">👁</button>`}</div></div>`
      : `<div class="crew-row">${badge(p.role)}<span class="nm">${p.bot ? '' : (p.remote ? p.avatar || '' : S.avatar || '') + ' '}${esc(p.bot || p.remote ? p.name : S.name)} <span class="tag">· ${p.bot ? t('bot') : p.remote ? `<span style="color:var(--hider)">●</span> ${t('netOnlineTag')}` : t('hostYou')}</span></span></div>`).join('');

    const step2 = `
      <button class="set-sum" data-step="1">${I.gear}<b>${t('settings')}</b><span>${[t('gm_' + (lb.gmode || 'classic')), t(lb.size), t(lb.vis === 'city' ? 'openCity' : lb.vis), t(lb.light), t(lb.extra), ...(lb.compass && lb.compass !== 'off' ? [t('compass')] : []), ...(lb.detector && lb.detector !== 'off' ? [t('detector')] : []), ...(lb.fog && lb.fog !== 'off' ? [t('fog')] : []), ...(lb.chaos ? ['🎲 ' + t('chaos')] : [])].join(' · ')}</span></button>
      ${summary}
      ${lb.gmode === 'indoor' ? `<div class="card bld-card"><div class="row" style="flex-wrap:nowrap;gap:12px"><span style="font-size:30px">🏢</span><div style="flex:1;min-width:0"><div class="kicker2">${t('bldTitle')}</div><b>${lb.building ? esc(lb.building.name || t('bldNoName')) : t('bldNone')}</b></div><button class="btn" id="bldAuto" style="flex:none">${I.crosshair}${t('bldAuto')}</button></div><p style="color:var(--muted);font-size:14px;margin:8px 0 0">${t('bldHint')}</p><label class="field" style="margin-top:12px">🚪 ${t('roomsLbl')}</label><input class="input" id="roomsIn" maxlength="240" value="${esc((lb.rooms || DEFAULT_ROOMS[getLang() === 'en' ? 'en' : 'ru']).join(', '))}"><p style="color:var(--muted);font-size:13px;margin:6px 0 0">${t('roomsHint')}</p></div>` : ''}
      <div class="map-card">
        <div class="map-tools"><button class="icon-btn" id="pFit" aria-label="zone">${I.north}</button><button class="icon-btn" id="myloc" aria-label="me">${I.crosshair}</button><button class="btn" id="mapEd" style="min-height:48px;padding:0 12px">✏️ ${t('mapEditor')}</button>
          <div class="seg" style="margin-left:auto">${['circle', 'custom'].map((z) => `<button data-zs="${z}" class="${(lb.shape || 'circle') === z ? 'on' : ''}">${t(z === 'circle' ? 'shapeCircle' : 'shapeCustom')}</button>`).join('')}</div></div>
        <div class="pick-map" id="pmap"></div>
        ${lb.shape === 'custom'
          ? `<div class="map-cap"><div>${t('customHint')}</div><div class="row" style="margin-top:8px"><span id="polyInfo" style="flex:1"></span><button class="btn" id="pUndo">${t('undoPt')}</button><button class="btn danger" id="pClear">${t('clearPts')}</button></div></div>`
          : `<div class="map-cap">${t('playground')}</div>`}
      </div>
      <div class="card crew">
        <div class="kicker2">${t('yourCrew')}</div>
        <h2 class="row" style="font-size:28px">${I.users.replace('<svg', '<svg width="26" height="26"')} ${t('playersN', { n: lb.players.length })}</h2>
        <div class="row" style="justify-content:space-between;margin:10px 0 14px"><span style="color:var(--muted)">${t('crewCount', { h: hunters, d: hiders })}</span><button class="btn" id="manage">${lb.manage ? t('done') : t('managePlayers')}</button></div>
        <div class="quick-add"><input class="input" id="qaName" maxlength="120" placeholder="${t('quickAddPh')}" enterkeyhint="done"><button class="btn primary" id="qaAdd">+ ${t('add')}</button></div>
        <div class="row" style="gap:8px;margin:0 0 12px"><button class="chip" data-qb="1" style="flex:1;text-align:center">+1 ${t('bot')}</button><button class="chip" data-qb="3" style="flex:1;text-align:center">+3</button><button class="chip" data-qb="5" style="flex:1;text-align:center">+5</button><button class="chip" data-qb="-1" style="flex:1;text-align:center">−1</button></div>
        <div class="crew-list">${crewRows}</div>
        ${lb.manage ? `<div class="row" style="margin-top:12px"><button class="btn" id="addBot" style="flex:1">+ ${t('addBot')}</button><button class="btn" id="shuffle" style="flex:1">${I.swap}${t('shuffle')}</button></div>` : ''}
        <button class="btn block" id="wheel" style="margin-top:12px">${I.target}${t('whoIsIt')}</button>
        <div class="line-row" style="margin-top:6px"><span>${t('moveMode')}</span><div class="seg">${['gps', 'demo'].map((r) => `<button data-mode="${r}" class="${lb.mode === r ? 'on' : ''}">${t(r)}</button>`).join('')}</div></div>
        <p style="color:var(--muted);font-size:14px;margin:6px 0 0">${lb.mode === 'demo' ? t('demoHelp') : t('gpsHelp')}</p>
      </div>
      <details class="adv" ${lb.advOpen ? 'open' : ''}><summary>${t('advanced')}</summary>${advancedBlock(lb, c)}</details>
      <p style="color:var(--muted)">${t('replayNote')}</p>
      <div class="bottom-bar"><div class="in"><button class="btn primary big block" id="start">${t('startGame')}</button><div class="hint2">${t('inviteHint')}</div></div></div>`;

    el.classList.toggle('has-bar', lb.step === 2);
    el.innerHTML = `
      <div class="lobby-code-lbl" style="margin-top:8px">${t('lobbyCodeLbl')}</div>
      <div class="lobby-code">${lb.code}</div>
      <div style="margin:-6px 0 12px">${netStatusHtml()}</div>
      ${lb.players.some((p) => p.remote) ? chatBtnHtml() : ''}
      <div class="row lobby-btns">
        <button class="btn danger" id="leave">${I.leave}${t('leave')}</button>
        <button class="btn" id="share">${t('share')}</button>
        <button class="btn ${lb.showQr ? 'primary' : ''}" id="qr">QR</button>
        <button class="icon-btn" data-top="rules" aria-label="rules">${I.help}</button>
        <button class="icon-btn" data-top="settings" aria-label="settings">${I.gear}</button>
      </div>
      ${lb.showQr ? `<div class="qr-inline"><div class="qr-box">${qrSvg(lb.code)}</div><p>${t('qrInline')}</p><code>${esc(joinUrl(lb.code))}</code></div>` : ''}
      <div class="make-yours"><div><div class="k">${t('makeYours')}</div><h2>${lb.step === 1 ? t('hostGame') : t('choosePlace')}</h2></div><button class="btn" id="howrun">${t('helpRun')}</button></div>
      <div class="steps"><button class="step ${lb.step === 1 ? 'on' : 'done'}" data-step="1"><span class="n">${lb.step === 2 ? '✓' : '1'}</span>${t('step1')}</button><button class="step ${lb.step === 2 ? 'on' : ''}" data-step="2"><span class="n">2</span>${t('step2')}</button></div>
      ${lb.step === 1 ? step1 : step2}`;
    bindCommon(el);

    const rerender = () => { save(); hostPublish(); const y = window.scrollY; go('lobby'); window.scrollTo(0, y); };
    hostEnsure(lb).then(() => { if (NET && NET.lobbyStatus === 'playing' && !game) hostPublish('lobby'); });
    hostPublish();
    el.querySelectorAll('[data-g]').forEach((b) => b.onclick = () => { lb[b.dataset.g] = b.dataset.k; lb.adv = {}; rerender(); });
    el.querySelectorAll('[data-step]').forEach((b) => b.onclick = () => { lb.step = +b.dataset.step; save(); go('lobby'); });
    el.querySelectorAll('[data-opt]').forEach((b) => b.onclick = () => { const [k, v] = b.dataset.opt.split(':'); lb[k] = v === 'on'; rerender(); });
    el.querySelectorAll('[data-chaos]').forEach((b) => b.onclick = () => { lb.chaos = b.dataset.chaos === 'on'; rerender(); });
    el.querySelectorAll('[data-gm]').forEach((b) => b.onclick = () => { lb.gmode = b.dataset.gm; lb.adv = {}; rerender(); });
    const rg = el.querySelector('#randMode'); if (rg) rg.onclick = () => { const all = [...el.querySelectorAll('[data-gm]')].map((b) => b.dataset.gm).filter((g) => g !== lb.gmode); lb.gmode = all[Math.floor(Math.random() * all.length)]; lb.adv = {}; toast('🎲 ' + t('gm_' + lb.gmode)); rerender(); };
    el.querySelectorAll('[data-hk]').forEach((b) => b.onclick = () => { const [k, v] = b.dataset.hk.split(':'); lb[k] = v; rerender(); });
    el.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => modal(`<p>${b.dataset.q === 'vis' ? t('visHelp') : b.dataset.q === 'helpers' ? t('helpersHelp') : b.dataset.q === 'gmode' ? t('gmodeHelp') : t('extraHelp')}</p><button class="btn block" data-x>${t('done')}</button>`, (m, close) => m.querySelector('[data-x]').onclick = close));
    el.querySelector('#leave').onclick = () => { if (NET && NET.role === 'host') { NET.room.send('abort', {}); NET.room.clearLobby(); setTimeout(netClose, 500); } S.lobby = null; save(); go('home'); };
    el.querySelector('#share').onclick = () => shareLobby(lb.code);
    el.querySelector('#qr').onclick = () => { lb.showQr = !lb.showQr; rerender(); };
    el.querySelector('#howrun').onclick = () => modal(`<h2>${t('runGame')}</h2><ol>${t('runGameList').map((x) => `<li>${esc(x)}</li>`).join('')}</ol><p style="color:var(--muted)">${t('firstGame')}</p><button class="btn primary big block" data-x>${t('letsSet')}</button>`, (m, close) => m.querySelector('[data-x]').onclick = () => { close(); lb.step = 1; save(); go('lobby'); });
    bindPresets(el, lb);

    if (lb.step !== 2) return;
    // --- игроки ---
    el.querySelector('#manage').onclick = () => { lb.manage = !lb.manage; rerender(); };
    el.querySelectorAll('[data-pr]').forEach((b) => b.onclick = () => { const [i, r] = b.dataset.pr.split(':'); lb.players[+i].role = r; rerender(); });
    el.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { const [rm] = lb.players.splice(+b.dataset.rm, 1); if (rm && rm.remote && NET) NET.room.send('kick', { id: rm.id }, rm.id); rerender(); });
    el.querySelectorAll('[data-pn]').forEach((inp) => inp.onchange = () => { lb.players[+inp.dataset.pn].name = inp.value.trim() || lb.players[+inp.dataset.pn].name; save(); });
    // быстрое добавление: имена через запятую / с новой строки, роли балансируются автоматически (≈ треть охотников)
    const addPlayers = (names) => {
      for (const nm of names) {
        if (lb.players.length >= 16) { toast(t('maxPlayers')); break; }
        const n = lb.players.length + 1, hunt = lb.players.filter((p) => p.role === 'hunter').length;
        lb.players.push({ name: nm, role: hunt < Math.max(1, Math.round(n / 3)) ? 'hunter' : 'hider', bot: true });
      }
      rerender();
    };
    const freeName = () => { const used = new Set(lb.players.map((p) => p.name)); return (BOT_NAMES[getLang()] || BOT_NAMES.ru).find((n) => !used.has(n)) || (t('bot') + ' ' + (lb.players.length + 1)); };
    const qa = el.querySelector('#qaName');
    const qaGo = () => { const names = qa.value.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean).map((x) => x.slice(0, 16)); addPlayers(names.length ? names : [freeName()]); };
    el.querySelector('#qaAdd').onclick = qaGo;
    qa.onkeydown = (e) => { if (e.key === 'Enter') qaGo(); };
    el.querySelectorAll('[data-qb]').forEach((b) => b.onclick = () => {
      const k = +b.dataset.qb;
      if (k < 0) { const i = lb.players.map((p) => p.bot).lastIndexOf(true); if (i >= 0) { lb.players.splice(i, 1); rerender(); } return; }
      const used = new Set(lb.players.map((p) => p.name)), pool = BOT_NAMES[getLang()] || BOT_NAMES.ru, names = [];
      for (let j = 0; j < k; j++) { const nm = pool.find((n) => !used.has(n)) || (t('bot') + ' ' + (lb.players.length + names.length + 1)); used.add(nm); names.push(nm); }
      addPlayers(names);
    });
    const addBot = el.querySelector('#addBot');
    if (addBot) addBot.onclick = () => { if (lb.players.length >= 12) return; const used = new Set(lb.players.map((p) => p.name)); const nm = (BOT_NAMES[getLang()] || BOT_NAMES.ru).find((n) => !used.has(n)) || (t('bot') + ' ' + lb.players.length); lb.players.push({ name: nm, role: 'hider', bot: true }); rerender(); };
    const shuffle = el.querySelector('#shuffle');
    if (shuffle) shuffle.onclick = () => { const h = Math.max(1, Math.round(lb.players.length / 3)); const idx = lb.players.map((_, i) => i).sort(() => Math.random() - 0.5); lb.players.forEach((p) => p.role = 'hider'); idx.slice(0, h).forEach((i) => lb.players[i].role = 'hunter'); rerender(); };
    el.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => { lb.mode = b.dataset.mode; rerender(); });
    el.querySelectorAll('[data-zs]').forEach((b) => b.onclick = () => { lb.shape = b.dataset.zs; rerender(); });
    el.querySelector('#wheel').onclick = () => {
      const names = S.wheel && S.wheel.names.filter(Boolean).length >= 2 ? S.wheel.names : lb.players.map((p) => p.bot ? p.name : S.name);
      openWheel(modal, { names, rig: S.wheel ? S.wheel.rig : '', onRole: (win, box) => {
        const pl = lb.players.find((p) => (p.bot ? p.name : S.name) === win);
        if (!pl) return;
        box.innerHTML = `<button class="btn primary block">${t('makeHunter', { n: esc(win) })}</button>`;
        box.firstChild.onclick = () => { pl.role = 'hunter'; save(); toast(t('makeHunterDone', { n: win })); };
      } });
    };
    // --- расширенные настройки ---
    const adv = el.querySelector('details.adv');
    adv.ontoggle = () => { lb.advOpen = adv.open; save(); };
    bindAdvanced(el, lb, rerender);

    // --- карта ---
    const center = lb.center || { lat: 55.7520, lng: 37.6175 };
    const pm = L.map(el.querySelector('#pmap'), { preferCanvas: true, zoomControl: false, attributionControl: true, zoomSnap: 0.25 }).setView([center.lat, center.lng], 15);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(pm);
    pm.attributionControl.setPrefix(false);
    const zst = { color: '#2c7a4b', weight: 3, dashArray: '10 8', fillColor: '#5fd38d', fillOpacity: 0.08 };
    const custom = lb.shape === 'custom';
    lb.poly = lb.poly || [];
    const circ = L.circle([center.lat, center.lng], { radius: c.radius, ...zst });
    const poly = L.polygon([], zst), dots = L.layerGroup();
    const circBounds = () => L.latLng((lb.center || center).lat, (lb.center || center).lng).toBounds(c.radius * 2);
    const drawPoly = () => {
      poly.setLatLngs(lb.poly.map((q) => [q.lat, q.lng])); dots.clearLayers();
      lb.poly.forEach((q, i) => L.circleMarker([q.lat, q.lng], { radius: 7, color: '#fff', weight: 3, fillColor: i === 0 ? '#ff8a5b' : '#2c7a4b', fillOpacity: 1 }).addTo(dots));
      const info = el.querySelector('#polyInfo');
      if (info) { const g = polyGeo(lb.poly); info.textContent = lb.poly.length < 3 ? t('ptsNeed', { n: lb.poly.length }) : t('ptsInfo', { n: lb.poly.length, a: (g.area / 10000).toFixed(1), r: Math.round(g.radius) }); }
    };
    const fit = () => { if (custom && lb.poly.length >= 3) pm.fitBounds(poly.getBounds(), { padding: [20, 20] }); else pm.fitBounds(circBounds()); };
    const setC = (lat, lng, doFit) => { lb.center = { lat, lng }; save(); circ.setLatLng([lat, lng]); if (doFit) fit(); };
    if (custom) {
      poly.addTo(pm); dots.addTo(pm); drawPoly();
      pm.on('click', (e) => { lb.poly.push({ lat: e.latlng.lat, lng: e.latlng.lng }); save(); drawPoly(); });
      el.querySelector('#pUndo').onclick = () => { lb.poly.pop(); save(); drawPoly(); };
      el.querySelector('#pClear').onclick = () => { lb.poly = []; save(); drawPoly(); };
    } else {
      circ.addTo(pm);
      pm.on('click', (e) => setC(e.latlng.lat, e.latlng.lng));
    }
    setTimeout(() => { pm.invalidateSize(); fit(); }, 60);
    setTimeout(() => pm.invalidateSize(), 400);   // после анимации экрана — иначе серые квадраты вместо карты
    el.querySelector('#pFit').onclick = fit;
    el.querySelector('#mapEd').onclick = () => go('mapEditor');
    drawMapExtras(pm, lb);
    const locate = (quiet) => navigator.geolocation && navigator.geolocation.getCurrentPosition((p) => {
      if (custom) pm.setView([p.coords.latitude, p.coords.longitude], 16); else setC(p.coords.latitude, p.coords.longitude, true);
    }, () => { if (!quiet) toast(t('noGps').split('—')[0]); }, { enableHighAccuracy: true, timeout: 15000 });
    el.querySelector('#myloc').onclick = () => locate(false);
    if (!lb.center) locate(true);
    // «В помещении»: здание под точкой — сразу граница карты
    const pickBuilding = async (lat, lng, quiet) => {
      if (!quiet) toast(t('bldSearch'));
      try {
        const b = await buildingAt(lat, lng);
        if (!b) { if (!quiet) toast(t('bldNotFound')); return; }
        if (current !== 'lobby' || S.lobby !== lb) return;   // ответ пришёл, когда игра уже началась — ничего не трогаем
        lb.shape = 'custom'; lb.poly = b.poly; lb.building = { name: b.name, lat, lng }; save(); rerender();
        toast(t('bldPicked', { n: b.name || t('bldNoName') }));
      } catch { if (!quiet && current === 'lobby') toast(t('edBuildingsFail')); }
    };
    const ri = el.querySelector('#roomsIn'); if (ri) ri.onchange = () => { lb.rooms = ri.value.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 12); if (lb.rooms.length < 2) lb.rooms = null; save(); hostPublish(); };
    const ba = el.querySelector('#bldAuto');
    if (ba) {
      ba.onclick = () => {
        const c0 = lb.center || center;
        if (navigator.geolocation) navigator.geolocation.getCurrentPosition((p) => pickBuilding(p.coords.latitude, p.coords.longitude), () => pickBuilding(c0.lat, c0.lng), { enableHighAccuracy: true, timeout: 8000 });
        else pickBuilding(c0.lat, c0.lng);
      };
      if (!lb.building && !lb._bldTried) { lb._bldTried = true; const c0 = lb.center || center; pickBuilding(c0.lat, c0.lng, true); }
    }

    if (S._autoStart) { delete S._autoStart; setTimeout(() => { const b = el.querySelector('#start'); if (b) b.click(); }, 700); }
    el.querySelector('#start').onclick = () => {
      const cc = calc(lb);
      if (!lb.players.some((p) => p.role === 'hider')) return toast(t('needHider'));
      let zc = lb.center || center, zr = cc.radius, polygon = null;
      if (custom) {
        if (lb.poly.length < 3) return toast(t('ptsNeed', { n: lb.poly.length }));
        const g = polyGeo(lb.poly); zc = g.center; zr = g.radius; polygon = lb.poly.slice();
      }
      const online = NET && NET.role === 'host' && NET.room.status === 'online' && lb.players.some((p) => p.remote);
      // тайный охотник: один случайный охотник, остальные прячутся (роли из лобби не меняем)
      let players = lb.players;
      if (['impostor', 'mimic', 'phantom'].includes(lb.gmode)) {
        const pool = lb.players.filter((p) => p.role !== 'spectator' && (online || !p.remote));
        const imp = pool[Math.floor(Math.random() * pool.length)];
        players = lb.players.map((p) => (p.role === 'spectator' ? p : { ...p, role: p === imp ? 'hunter' : 'hider' }));
      }
      const base = {
        center: zc, radius: zr, polygon,
        huntSec: cc.huntSec, hideSec: cc.hideSec, shrinkTo: cc.shrinkTo,
        features: lb.extra, powerups: lb.powerups, revealCd: cc.revealCd, freezeCd: cc.freezeCd,
        bots: players.filter((p) => p.bot).length, hunters: players.filter((p) => p.role === 'hunter').length,
        roles: players.map((p) => ({ id: online ? p.id : undefined, name: p.bot || p.remote ? p.name : S.name, role: p.role, bot: !!p.bot, avatar: p.bot ? null : p.remote ? p.avatar || null : S.avatar || null })),
        myRole: (players.find((p) => !p.bot && !p.remote) || {}).role || 'hider', transport: lb.transport !== false,
        compass: lb.compass || 'off', detector: lb.detector || 'off', fog: lb.fog || 'off', botLevel: lb.botLevel || 'normal', outLimit: lb.outLimit != null ? lb.outLimit : 30, chaos: !!lb.chaos, catchCode: lb.catchCode !== false, drone: !!lb.drone, drift: !!lb.drift, objects: lb.objects !== false, buildingName: lb.gmode === 'indoor' && lb.building ? lb.building.name || '' : '', rooms: lb.rooms || null,
        zonesX: Object.fromEntries(ZX_KINDS.map((k) => [k, zoneArr(zl(lb, k))])),
        safeZones: zoneArr(zl(lb, 'safe')), killZones: zoneArr(zl(lb, 'kill')), graveZones: zoneArr(zl(lb, 'grave')),
        objs: ((lb.map || {}).objs || []).map((o) => ({ k: o.k, lat: Math.round(o.lat * 1e6) / 1e6, lng: Math.round(o.lng * 1e6) / 1e6 })), walls: [...((lb.map || {}).walls || []), ...((lb.map || {}).barriers || []), ...lineZones(lb, 'barriers', 1.5)].map((w) => w.map((q) => [Math.round(q.lat * 1e6) / 1e6, Math.round(q.lng * 1e6) / 1e6])),
        gmode: lb.gmode === 'blitz' ? 'classic' : (lb.gmode || 'classic'), blitz: lb.gmode === 'blitz', nogo: zl(lb, 'nogo'), points: mapPoints(lb),
      };
      base.avatar = S.avatar || null;
      if (!online) return go('game', { ...base, roles: players.filter((p) => !p.remote).map((p) => ({ name: p.bot ? p.name : S.name, role: p.role, bot: !!p.bot })), cheats: S.cheatsUnlocked ? { ...(S.cheats || {}) } : {}, mode: lb.mode, name: S.name });
      const startAt = Date.now() + 5000;
      NET.room.send('start', { cfg: base, startAt });
      hostPublish('playing');
      go('game', { ...base, myId: NET.myId, name: S.name, mode: lb.mode, cheats: S.cheatsUnlocked ? { ...(S.cheats || {}) } : {}, net: { room: NET.room, role: 'host', myId: NET.myId, hostId: NET.myId, startAt } });
    };
  },

  onboarding(el, startStep) {
    let i = startStep || 0;
    const N = 6;
    const draw = async () => {
      const ru = getLang() === 'ru';
      let body = '', canNext = true;
      if (i === 0) body = `<h2>${t('onbWelcome')}</h2><p>${t('onbWelcomeS')}</p>`;
      else if (i === 1) body = `<h2>${t('onbRules')}</h2><p>${t('onbRulesS')}</p>
        <div class="pw-item"><div class="pw-ico" style="color:var(--hider);background:none;border:0">${I.run}</div><div><h3>${t('hider')}</h3><p>${ru ? 'Не попадайтесь до конца времени.' : 'Stay free until time runs out.'}</p></div></div>
        <div class="pw-item"><div class="pw-ico" style="color:var(--hunter);background:none;border:0">${I.target}</div><div><h3>${t('hunter')}</h3><p>${ru ? 'Найдите и поймайте всех прячущихся.' : 'Find and catch every Hider.'}</p></div></div>
        <button class="btn block" id="fullRules">${I.book}${t('fullRules')}</button>`;
      else if (i === 2) body = `<h2>${t('perms')}</h2><p>${t('permsS')}</p><div style="color:var(--muted);border-bottom:1px solid var(--line);padding-bottom:8px">${t('needs')}</div><div id="permList">…</div>`;
      else if (i === 3) { body = `<h2>${t('onbSafety')}</h2>${tutorialSteps().slice(-1)[0].html}<label class="agree"><input type="checkbox" id="agree" ${S.agreed ? 'checked' : ''}><b>${t('agreeSafety')}</b></label>`; canNext = !!S.agreed; }
      else if (i === 4) body = `<h2>${t('onbData')}</h2><p>${t('onbDataS')}</p><label class="agree"><input type="checkbox" id="saveRep" ${S.saveReplays !== false ? 'checked' : ''}><b>${t('saveReplays')}</b></label>`;
      else body = `<h2>${t('onbName')}</h2><p>${t('onbNameS')}</p><input class="input" id="onbName" maxlength="20" placeholder="${t('namePh')}" value="${esc(S.name)}">`;
      el.innerHTML = `<div class="onb">
        <div class="lang">${['ru', 'en'].map((l) => `<button class="opt ${getLang() === l ? 'on' : ''}" data-l="${l}">${l === 'ru' ? FLAG_RU : FLAG_EN}<span class="t">${l === 'ru' ? 'Русский' : 'English'}</span></button>`).join('')}</div>
        <div class="brand-big">${I.logo}<span>Map Tag</span></div>
        <div class="modal" style="max-height:none">${body}
          <div class="progress">${Array.from({ length: N }, (_, k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('')}</div>
          <div style="color:var(--muted)">${t('stepOf', { a: i + 1, b: N })}</div>
          <div class="tut-foot"><button class="btn big" data-b ${i === 0 ? 'disabled' : ''}>${t('back2')}</button><button class="btn primary big" data-n ${canNext ? '' : 'disabled'}>${i === N - 1 ? t('letsGo') : t('next')}</button></div>
        </div></div>`;
      el.querySelectorAll('[data-l]').forEach((b) => b.onclick = () => { setLang(b.dataset.l); draw(); });
      el.querySelector('[data-b]').onclick = () => { if (i > 0) { i--; draw(); } };
      el.querySelector('[data-n]').onclick = () => {
        if (i === N - 1) {
          const n = el.querySelector('#onbName').value.trim();
          if (!n) return toast(t('enterName'));
          S.name = n; S.onboarded = true; save(); window.__permChanged = null; go('home'); return;
        }
        i++; draw();
      };
      const fr = el.querySelector('#fullRules'); if (fr) fr.onclick = () => openRules();
      const ag = el.querySelector('#agree'); if (ag) ag.onchange = () => { S.agreed = ag.checked; save(); el.querySelector('[data-n]').disabled = !ag.checked; };
      const sr = el.querySelector('#saveRep'); if (sr) sr.onchange = () => { S.saveReplays = sr.checked; save(); };
      if (i === 2) { window.__permChanged = () => renderPerms(el.querySelector('#permList')); renderPerms(el.querySelector('#permList')); }
      else window.__permChanged = null;
      window.scrollTo(0, 0);
    };
    draw();
  },

  results(el, { res, cfg, rep }) {
    const ru = getLang() === 'ru', g = res.stats;
    const players = res.players || [];
    const hidersWin = res.winner === 'hiders';
    const survivors = players.filter((p) => p.startRole === 'hider' && p.caughtAt == null);
    const caughtList = players.filter((p) => p.caughtAt != null).sort((a, b) => b.caughtAt - a.caughtAt);
    const longest = survivors.length ? null : caughtList[0];
    const topHunter = players.filter((p) => p.catches > 0).sort((a, b) => b.catches - a.catches)[0];
    const row = (p) => {
      const surv = p.startRole === 'hider' && p.caughtAt == null;
      const status = p.startRole === 'hunter' ? (p.catches ? t('resCatches', { n: p.catches }) : t('hunter'))
        : surv ? t('resSurvived') : t('resCaughtAt', { t: fmt(Math.max(0, p.caughtAt - cfg.hideSec)), b: esc(p.caughtBy || '') });
      return `<div class="crew-row"><span class="rbadge ${p.startRole}">${t(p.startRole)}</span><span class="nm">${esc(p.name)}${p.me ? ` <span class="tag">· ${t('you')}</span>` : ''}<br><span class="tag">${status}</span></span>${surv ? `<span style="color:var(--hider)">${I.trophy.replace('<svg', '<svg width="24" height="24"')}</span>` : ''}</div>`;
    };
    el.innerHTML = `
      <div class="res-hero ${hidersWin ? 'hid' : 'hun'}">
        <div class="ic">${I.trophy}</div>
        <div class="k">${t('endT')} · ${fmt(res.duration)}</div>
        <h1>${res.gmode === 'tag' ? t('tagEnd', { n: esc(res.lastSeeker || '—') }) : res.gmode === 'vip' ? (hidersWin ? t('vipWin') : t('vipLost')) : res.gmode === 'bomb' && hidersWin ? t('bombWin') : res.gmode === 'sardines' ? (res.lastSeeker ? t('sardEnd', { n: esc(res.lastSeeker) }) : t('sardEndAll')) : res.gmode === 'treasure' && hidersWin ? t('trWin') : hidersWin ? t('endHiders') : t('endHunters')}</h1>
        <div class="you ${res.won ? 'w' : 'l'}">${res.role === 'spectator' ? t('resWatched') : `${res.won ? t('resYouWon') : t('resYouLost')} · ${t(res.role)}`}</div>
      </div>
      <div class="duo">
        <div class="tile"><span style="color:var(--hider)">${I.run}</span><div class="v">${survivors.length}</div><div class="l">${t('resSurvivors')}</div></div>
        <div class="tile"><span style="color:var(--hunter)">${I.target}</span><div class="v">${caughtList.length}</div><div class="l">${t('resCaught')}</div></div>
      </div>
      ${topHunter || longest ? `<div class="card" style="margin-top:14px">
        ${topHunter ? `<div class="line-row"><span>${I.crosshair.replace('<svg', '<svg width="20" height="20" style="vertical-align:-4px;color:var(--hunter)"')} ${t('resTopHunter')}</span><b>${esc(topHunter.name)} · ${topHunter.catches}</b></div>` : ''}
        ${longest ? `<div class="line-row"><span>${I.clock.replace('<svg', '<svg width="20" height="20" style="vertical-align:-4px;color:var(--hider)"')} ${t('resLongest')}</span><b>${esc(longest.name)} · ${fmt(longest.caughtAt - cfg.hideSec)}</b></div>` : ''}
      </div>` : ''}
      <h3 class="h-sect">${t('players')}</h3>
      <div class="crew-list">${players.map(row).join('')}</div>
      ${awardsHtml(res)}
      ${telHtml(res.tel)}
      <h3 class="h-sect">${t('yourGame')}</h3>
      <div class="card" style="padding:6px 18px">
        <div class="line-row"><span>${t('distance')}</span><b>${fmtDist(g.dist)}</b></div>
        <div class="line-row"><span>${t('caught')}</span><b>${g.caught}</b></div>
        <div class="line-row"><span>${t('missionsDone')}</span><b>${g.missions}</b></div>
        <div class="line-row"><span>${t('supplies')}</span><b>${g.supplies}</b></div>
        <div class="line-row"><span>${t('powersSpent')}</span><b>${g.powers}</b></div></div>
      <div class="bottom-bar"><div class="in">
        <button class="btn block" id="rShare" style="margin-bottom:8px">📤 ${t('shareResult')}</button>
        <button class="btn primary big block" id="rWatch">${I.play}${t('watchReplay')}</button>
        <div class="row" style="margin-top:10px;flex-wrap:nowrap"><button class="btn" id="rLobby" style="flex:1">${t('toLobby')}</button>${cfg.net ? (cfg.net.role === 'host' ? `<button class="btn" id="rRematch" style="flex:1">🔁 ${t('rematch')}</button>` : '') : `<button class="btn" id="rAgain" style="flex:1">${t('again')}</button>`}<button class="btn" id="rMenu" style="flex:1">${t('toMenu')}</button></div>
      </div></div>`;
    el.classList.add('has-bar', 'res');
    el.querySelector('#rShare').onclick = async () => {
      const txt = t('shareResultText', { w: el.querySelector('.res-hero h1').textContent, d: fmt(res.duration), r: t(res.startRole || res.role), km: fmtDist(g.dist), c: g.caught });
      if (window.MapTagNative) return window.MapTagNative.share(txt);
      try { if (navigator.share) return await navigator.share({ title: 'Map Tag', text: txt }); } catch (e) { if (e && e.name === 'AbortError') return; }
      try { await navigator.clipboard.writeText(txt); toast(t('copied')); } catch { toast(txt); }
    };
    el.querySelector('#rWatch').onclick = () => go('replay', { ...rep, _back: ['results', { res, cfg, rep }] });
    el.querySelector('#rLobby').onclick = () => go(NET && NET.role === 'client' ? 'clientLobby' : S.lobby ? 'lobby' : 'home');
    const ag = el.querySelector('#rAgain'); if (ag) ag.onclick = () => go('game', cfg);
    const rm = el.querySelector('#rRematch'); if (rm) rm.onclick = () => { S._autoStart = true; go('lobby'); };
    el.querySelector('#rMenu').onclick = () => go('home');
  },

  replay(el, r) {
    const back = r._back;
    stopReplay = renderReplay(el, r, { onBack: () => { stopReplay = null; back ? go(back[0], back[1]) : go('stats'); } });
  },

  game(el, cfg) {
    game = new Game({ ...cfg, eco: !!S.eco, announce: S.announce !== false }, {
      lang: getLang(), modal, toast, confirm: confirmBox,
      openRules: () => openRules(),
      openLegend: () => openLegend(),
      cheatsUnlocked: () => !!S.cheatsUnlocked,
      openChat: () => openChat(modal),
      onDead: () => { voiceLeave(); },
      ping: (x, y) => sendPing(x, y),
      sos: () => confirmBox(t('sosConfirm'), async () => {
        const g = game; if (!g) return;
        const [lat, lng] = g.ll(g.me), link = `https://maps.google.com/?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
        const txt = `🆘 SOS Map Tag — ${S.name}: ${t('sosMsg')} ${link}`;
        if (NET && g.net) { sendSos(Math.round(g.me.x), Math.round(g.me.y), link); toast(t('sosSent')); }
        if (window.MapTagNative) return window.MapTagNative.share(txt);
        try { if (navigator.share) return await navigator.share({ title: 'SOS', text: txt }); } catch (e) { if (e && e.name === 'AbortError') return; }
        try { await navigator.clipboard.writeText(txt); toast(t('copied')); } catch { toast(txt); }
      }),
      voice: () => ({ on: VOICE.on, mic: VOICE.mic, talk: VOICE.speaking.size > 0 }),
      voiceMute: () => voiceMute(),
      chatUnread: () => CHAT.unread,
      openCheats: () => { const open = () => { game && openGameCheats(modal, S, save, game); game && game.renderHud(true); }; if (S.cheatsUnlocked) open(); else askPassword(open); },
      onLeave: () => go(NET && NET.role === 'client' ? (NET.lobby ? 'clientLobby' : 'home') : 'lobby'),
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
      ${Object.keys(S.board || {}).length ? `<h3 class="h-sect">🏅 ${t('boardTitle')}</h3><div class="card" style="padding:4px 16px">${Object.entries(S.board).sort((a, b) => b[1].wins - a[1].wins || b[1].catches - a[1].catches).slice(0, 10).map(([n, b], i) => `<div class="line-row"><span>${['🥇', '🥈', '🥉'][i] || (i + 1) + '.'} <b>${esc(n)}</b></span><span style="color:var(--muted);font-size:14px">${t('boardRow', { w: b.wins, g: b.games, c: b.catches })}</span></div>`).join('')}</div>` : ''}
      ${S.rec && Object.keys(S.rec).length ? `<h3 class="h-sect">🏆 ${t('recTitle')}</h3><div class="duo" style="margin-top:0">
        <div class="tile"><span style="color:var(--hider)">${I.clock}</span><div class="v" style="font-size:26px">${fmt(S.rec.survive || 0)}</div><div class="l">${t('recSurvive')}</div></div>
        <div class="tile"><span style="color:var(--hunter)">${I.target}</span><div class="v" style="font-size:26px">${S.rec.catches || 0}</div><div class="l">${t('recCatches')}</div></div>
        <div class="tile"><span style="color:var(--teal)">${I.run}</span><div class="v" style="font-size:26px">${fmtDist(S.rec.dist || 0)}</div><div class="l">${t('recDist')}</div></div>
        <div class="tile"><span style="color:var(--gold)">${I.bolt}</span><div class="v" style="font-size:26px">${S.rec.fastWin ? fmt(S.rec.fastWin) : '—'}</div><div class="l">${t('recFast')}</div></div></div>` : ''}
      <h3 class="h-sect">${t('achTitle')} · ${Object.keys(S.ach || {}).length}/${ACH.length}</h3>
      <div class="ach">${ACH.map(([id, ic]) => `<div class="a ${(S.ach || {})[id] ? 'on' : ''}"><span class="i">${ic}</span>${t('ach_' + id)}</div>`).join('')}</div>
      <h3 class="row" style="font-size:24px;margin-bottom:10px">${S.avatar ? `<span style="font-size:30px">${S.avatar}</span>` : I.user.replace('<svg', '<svg width="30" height="30"')} ${esc(S.name || '—')}</h3>
      <div class="avatars">${['🦊','🐼','🐸','🐯','🦁','🐵','🐙','🦄','🐧','🐢','👽','🤖','👻','🥷','🦸','🧙'].map((a) => `<button class="av-b ${S.avatar === a ? 'on' : ''}" data-av="${a}">${a}</button>`).join('')}<button class="av-b ${!S.avatar ? 'on' : ''}" data-av="">✕</button></div>
      <details class="acc"><summary>${I.gear}${t('privacy')}<span class="chev">${I.chevD}</span></summary><div class="in"><p>${t('privacyText')}</p>
        <div class="row"><button class="btn" id="exp">${t('exportData')}</button><button class="btn danger" id="rst">${t('resetStats')}</button></div></div></details>
      <hr style="border:0;border-top:1px solid var(--line);margin:26px 0">
      <div class="row" style="gap:16px;align-items:flex-start"><span style="color:var(--gold)">${I.book.replace('<svg', '<svg width="46" height="46"')}</span><div><div class="kicker" style="margin:0">${t('advKeep')}</div><h2 style="font-size:32px">${t('replays')}</h2></div></div>
      <div id="reps" style="margin-top:16px">${S.replays.length ? S.replays.map((r, i) => `<div class="replay" data-rep="${i}"><div class="r-ico" style="background:${r.won ? '#1f3a2c' : '#3a222a'};color:${r.won ? 'var(--hider)' : 'var(--hunter)'}">${r.won ? I.trophy : I.target}</div><div style="flex:1"><b>${r.won ? t('won') : t('lost')}</b> · ${r.role === 'hunter' ? t('asHunter') : t('asHider')}<div style="color:var(--muted);font-size:14px">${new Date(r.date).toLocaleString(getLang(), { dateStyle: 'medium', timeStyle: 'short' })} · ${fmt(r.duration)} · ${fmtDist(r.dist)}${r.rec ? ` · ${t('playersN', { n: r.rec.players.length })}` : ''}</div></div>${I.arrowR.replace('<svg', '<svg width="22" height="22"')}</div>`).join('')
        : `<div class="empty">${I.map}<h3>${t('replayEmptyT')}</h3><p>${t('replayEmptyS')}</p></div>`}</div>
      <button class="btn block big" id="refresh">${t('refresh')}</button>
      <div class="card" style="margin-top:22px"><h3 style="font-size:24px">${t('heard')}</h3><p style="color:var(--muted);margin:8px 0 0">${t('optional')}</p>
        <div class="chips">${t('heardOpts').map((o, i) => `<button class="chip ${i === 8 ? 'wide' : ''} ${S.heard === i ? 'on' : ''}" data-h="${i}">${esc(o)}</button>`).join('')}</div></div>
      ${supportBlock()}`;
    bindCommon(el);
    el.querySelector('#refresh').onclick = () => go('stats');
    el.querySelectorAll('[data-av]').forEach((b) => b.onclick = () => { S.avatar = b.dataset.av || null; save(); const y = window.scrollY; go('stats'); window.scrollTo(0, y); });
    el.querySelector('#rst').onclick = () => confirmBox(t('resetConfirm'), () => { S.stats = { ...DEF.stats }; S.replays = []; save(); go('stats'); });
    el.querySelector('#exp').onclick = () => {
      const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'map_tag_data.json'; a.click();
    };
    el.querySelectorAll('[data-h]').forEach((b) => b.onclick = () => { S.heard = +b.dataset.h; save(); el.querySelectorAll('[data-h]').forEach((x) => x.classList.toggle('on', x === b)); toast(t('thanks')); });
    el.querySelectorAll('[data-rep]').forEach((b) => b.onclick = () => openReplay(S.replays[+b.dataset.rep]));
  },

  mapEditor(el) {
    S._calcRadius = () => (S.lobby ? calc(S.lobby).radius : 500);
    renderMapEditor(el, { S, save, go, toast, modal });
  },

  cheats(el) {
    if (!S.cheatsUnlocked) return go('home');
    renderCheats(el, S, save, { modal, toast, topbar: () => topbar(), bindCommon, defaultNames, go });
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
    ${rng('revealCd', 30, 240, 10, c.revealCd, t('revealCd'), t('sec'))}
    ${rng('freezeCd', 30, 300, 10, c.freezeCd, t('freezeCd'), t('sec'))}</div>
    ${lb.extra === 'spice' ? `<div class="sect">${t('powerupsIn')}</div><div class="card" style="padding:8px 16px">${POWERUPS.map((p) => `<label class="line-row"><span class="row">${I[p.icon].replace('<svg', '<svg width="20" height="20"')} ${esc(pwName(p))}</span><input type="checkbox" data-pwt="${p.id}" ${lb.powerups.includes(p.id) ? 'checked' : ''} style="width:24px;height:24px;accent-color:var(--accent)"></label>`).join('')}</div>` : ''}`;
}

function polyGeo(pts) {
  if (pts.length < 3) return { area: 0, radius: 0, center: pts[0] || null };
  const lat0 = pts.reduce((a, q) => a + q.lat, 0) / pts.length, lng0 = pts.reduce((a, q) => a + q.lng, 0) / pts.length;
  const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
  const P = pts.map((q) => [(q.lng - lng0) * kx, (q.lat - lat0) * ky]);
  let A = 0, cx = 0, cy = 0;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const f = P[j][0] * P[i][1] - P[i][0] * P[j][1]; A += f; cx += (P[j][0] + P[i][0]) * f; cy += (P[j][1] + P[i][1]) * f; }
  A /= 2;
  const area = Math.abs(A);
  if (area < 1) return { area: 0, radius: 0, center: { lat: lat0, lng: lng0 } };
  cx /= 6 * A; cy /= 6 * A;
  return { area, radius: Math.sqrt(area / Math.PI), center: { lat: lat0 + cy / ky, lng: lng0 + cx / kx } };
}
function defaultNames() { const n = (S.lobby && S.lobby.bots) || 3; return [S.name || (getLang() === 'ru' ? 'Я' : 'Me'), ...(BOT_NAMES[getLang()] || BOT_NAMES.ru).slice(0, n)]; }

/** Награды раунда: лучший охотник, последний выживший, первый пойманный. */
function awardsHtml(res) {
  const ps = res.players || [];
  if (ps.length < 2) return '';
  const nm = (p) => esc(p.me ? t('you') : p.name);
  const out = [];
  const top = ps.filter((p) => p.catches > 0).sort((a, b) => b.catches - a.catches)[0];
  if (top) out.push(['🏹', t('awHunter'), `${nm(top)} · ${top.catches}`]);
  const hid = ps.filter((p) => p.startRole === 'hider');
  const surv = hid.filter((p) => p.caughtAt == null);
  const last = surv.length ? surv : hid.filter((p) => p.caughtAt != null).sort((a, b) => b.caughtAt - a.caughtAt).slice(0, 1);
  if (last.length) out.push(['🦎', surv.length ? t('awSurvivor') : t('awLast'), last.slice(0, 3).map(nm).join(', ') + (surv.length ? '' : ' · ' + fmt(last[0].caughtAt))]);
  const first = hid.filter((p) => p.caughtAt != null).sort((a, b) => a.caughtAt - b.caughtAt)[0];
  if (first && hid.length > 1) out.push(['🐣', t('awFirst'), `${nm(first)} · ${fmt(first.caughtAt)}`]);
  if (res.stats && res.stats.dist > 50) out.push(['👟', t('awDist'), fmtDist(res.stats.dist)]);
  return out.length ? `<h3 class="h-sect">🏅 ${t('awards')}</h3><div class="awards">${out.map(([ic, k, v]) => `<div class="aw"><div class="aw-ic">${ic}</div><div class="aw-k">${k}</div><div class="aw-v">${v}</div></div>`).join('')}</div>` : '';
}

/** Графики высоты, скорости и заряда батареи за раунд. */
function telHtml(tel) {
  if (!tel || tel.length < 2) return '';
  const spark = (idx, col, unit, label) => {
    const pts = tel.filter((r) => r[idx] != null);
    if (pts.length < 2) return `<div class="tel"><div class="tl">${label}</div><div class="tn">${t('telNone')}</div></div>`;
    const t0 = tel[0][0], t1 = tel[tel.length - 1][0] || 1, vs = pts.map((r) => r[idx]), mn = Math.min(...vs), mx = Math.max(...vs), rg = mx - mn || 1;
    const d = pts.map((r) => `${((r[0] - t0) / Math.max(1, t1 - t0) * 300).toFixed(1)},${(56 - (r[idx] - mn) / rg * 50).toFixed(1)}`).join(' ');
    return `<div class="tel"><div class="row" style="justify-content:space-between"><span class="tl">${label}</span><span class="tv" style="color:${col}">${Math.round(mn)}–${Math.round(mx)} ${unit}</span></div><svg viewBox="0 0 300 60" preserveAspectRatio="none"><polyline points="${d}" fill="none" stroke="${col}" stroke-width="2.5" vector-effect="non-scaling-stroke"/></svg></div>`;
  };
  return `<h3 class="h-sect">📈 ${t('telTitle')}</h3><div class="card" style="padding:12px 16px">${spark(1, '#8fd0ff', t('m'), t('telAlt'))}${spark(2, '#5fd38d', t('kmh'), t('telSpeed'))}${spark(3, '#f6c453', '%', t('telBat'))}</div>`;
}

function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(m >= 10000 ? 0 : 1).replace('.', getLang() === 'ru' ? ',' : '.') + (getLang() === 'ru' ? ' км' : ' km') : Math.round(m) + (getLang() === 'ru' ? ' м' : ' m'); }
function fmtLong(s) { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`; }

// ---------- конец игры ----------
const ACH = [
  ['first', '🎉', (st) => st.games >= 1], ['win', '🏆', (st) => st.wins >= 1], ['catch1', '🎯', (st) => st.caught >= 1],
  ['catch10', '🦅', (st) => st.caught >= 10], ['survivor', '🥷', (st, r) => r && r.won && r.startRole === 'hider' && !r.stats.timesCaught],
  ['missions5', '⭐', (st) => st.missions >= 5], ['caches10', '💎', (st) => st.supplies >= 10], ['km5', '👟', (st) => st.dist >= 5000],
  ['treasure', '🪙', (st, r) => r && (r.stats.treasures || 0) >= 1], ['blitz', '⚡', (st, r) => r && r.won && r.blitz], ['online', '🌐', (st, r) => r && r.online],
  ['games10', '🔥', (st) => st.games >= 10],
];
function checkAch(r) {
  S.ach = S.ach || {};
  const fresh = [];
  for (const [id, , fn] of ACH) if (!S.ach[id] && fn(S.stats, r)) { S.ach[id] = Date.now(); fresh.push(id); }
  return fresh;
}
function confetti() {
  const c = document.createElement('div'); c.className = 'confetti';
  const cols = ['#ff8a5b', '#5fd38d', '#f6c453', '#a99bff', '#4fd1c5', '#f26d7d'];
  c.innerHTML = Array.from({ length: 70 }, () => `<i style="left:${Math.random() * 100}%;background:${cols[Math.floor(Math.random() * cols.length)]};animation-delay:${Math.random() * 0.8}s;animation-duration:${2 + Math.random() * 1.6}s"></i>`).join('');
  document.body.appendChild(c); setTimeout(() => c.remove(), 4500);
}

function endGame(res, cfg) {
  const st = S.stats, g = res.stats;
  st.dist += g.dist; st.games++; st.time += res.duration; st.caught += g.caught; st.missions += g.missions; st.supplies += g.supplies;
  st.powers += g.powers; st.timeHunt += g.timeHunt; st.timeHide += g.timeHide; st.timesCaught += g.timesCaught; if (res.won) st.wins++;
  const rep = { ...res.replay, won: res.won, role: res.role, duration: res.duration, dist: g.dist, winner: res.winner, players: res.players, stats: g };
  // рейтинг друзей: живые игроки онлайн-игр (без ботов)
  if (cfg.net && Array.isArray(res.players)) {
    S.board = S.board || {};
    for (const p of res.players) {
      if (p.bot || p.startRole === 'spectator') continue;
      const won = (res.winner === 'hiders' && p.role === 'hider') || (res.winner === 'hunters' && p.role === 'hunter');
      const b = S.board[p.name] = S.board[p.name] || { games: 0, wins: 0, catches: 0 };
      b.games++; if (won) b.wins++; b.catches += p.catches || 0;
    }
  }
  S.rec = S.rec || {};
  const R = S.rec, survived = res.startRole === 'hider' && !g.timesCaught ? res.duration - (cfg.hideSec || 0) : 0;
  if (survived > (R.survive || 0)) R.survive = Math.round(survived);
  if (g.caught > (R.catches || 0)) R.catches = g.caught;
  if (g.dist > (R.dist || 0)) R.dist = Math.round(g.dist);
  if (res.won && res.role === 'hunter' && (!R.fastWin || res.duration < R.fastWin)) R.fastWin = res.duration;
  const freshAch = checkAch({ ...res, blitz: cfg.blitz || (S.lobby && S.lobby.gmode === 'blitz'), online: !!cfg.net });
  setTimeout(() => { if (res.won) confetti(); freshAch.forEach((id, i) => setTimeout(() => toast(`${ACH.find((a) => a[0] === id)[1]} ${t('achNew')}: ${t('ach_' + id)}`), 600 + i * 1600)); }, 300);
  if (S.saveReplays !== false) {
    S.replays.unshift(rep);
    S.replays = S.replays.slice(0, 10);
    // localStorage ограничен: если не влезло — отбрасываем старые повторы
    for (;;) { try { localStorage.setItem('mt_state', JSON.stringify(S)); break; } catch { if (S.replays.length <= 1) { S.replays.forEach((r) => { if (r.rec) r.rec.frames = r.rec.frames.filter((_, i) => i % 2 === 0); }); try { localStorage.setItem('mt_state', JSON.stringify(S)); } catch {} break; } S.replays.pop(); } }
  } else save();
  go('results', { res, cfg, rep });
}

function openReplay(r) { if (r) go('replay', r); }

// ---------- модальные окна ----------
/** Зоны-линии из редактора → узкие полосы для игры (w — полуширина, м). */
function lineZones(lb, key, w) { return (((lb.map || {})[key + 'L']) || []).filter((l) => l.length >= 2).map((l) => lineBand(l, w)); }
/** Многоугольники зоны + её линии. */
function zl(lb, key) { return [...(((lb.map || {})[key]) || []), ...lineZones(lb, key, 4)]; }

/** Многоугольники зон из редактора → [[lat, lng], …]. */
function zoneArr(a) { return (a || []).filter((w) => w && w.length >= 3).map((w) => w.map((q) => [Math.round(q.lat * 1e6) / 1e6, Math.round(q.lng * 1e6) / 1e6])); }

/** Легенда: объекты и зоны на карте. */
function openLegend() {
  const row = (ic, n, d) => `<div class="leg-row"><span class="leg-ic">${ic}</span><div><b>${n}</b><div class="leg-d">${d}</div></div></div>`;
  modal(`<div class="mhead"><span class="k">🗺 ${t('legend')}</span><button class="icon-btn" data-x>${I.close}</button></div>
    <h3 class="h-sect" style="margin-top:4px">${t('legObjs')}</h3>
    ${OBJ_KINDS.map((k) => row(OBJ[k].ic, t('obj_' + k), t('objD_' + k))).join('')}
    <h3 class="h-sect">${t('legZones')}</h3>
    ${row('🛡', t('ed_safe'), t('zoneD_safe'))}${row('☠', t('ed_kill'), t('zoneD_kill'))}${row('🪦', t('ed_grave'), t('zoneD_grave'))}${row('🧱', t('ed_barrier'), t('zoneD_barrier'))}${ZX_KINDS.map((k) => row(ZX[k].ic, t('ed_' + k), t('zoneD_' + k))).join('')}
    ${row('⏱', t('legOut'), t('legOutD', { s: OUT_LIMIT }))}`, (b, close) => { b.querySelector('[data-x]').onclick = close; });
}

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
        <div style="color:var(--muted);margin:16px 0 0 4px">${t('theme')}</div><div id="thp"></div>
        ${S.cheatsUnlocked ? `<button class="set-row" data-s="cheats" style="border-color:var(--hunter)"><div><div class="tt" style="color:var(--hunter)">${I.lock.replace('<svg', '<svg width="18" height="18" style="vertical-align:-3px"')} ${t('cheats')}</div><div class="ss">${t('cheatsS')}</div></div></button>` : ''}
        <label class="set-row"><div><div class="tt">${t('announce')}</div><div class="ss">${t('announceS')}</div></div><input type="checkbox" id="ann" ${S.announce !== false ? 'checked' : ''}></label>
        <label class="set-row"><div><div class="tt">${t('darkMap')}</div><div class="ss">${t('darkMapS')}</div></div><input type="checkbox" id="dkm" ${S.darkMap ? 'checked' : ''}></label>
        <label class="set-row"><div><div class="tt">${t('bigText')}</div><div class="ss">${t('bigTextS')}</div></div><input type="checkbox" id="bigT" ${S.bigText ? 'checked' : ''}></label>
        <label class="set-row"><div><div class="tt">${t('eco')}</div><div class="ss">${t('ecoS')}</div></div><input type="checkbox" id="eco" ${S.eco ? 'checked' : ''}></label>
        <label class="set-row"><div><div class="tt">${t('sound')}</div><div class="ss">${t('soundS')}</div></div><input type="checkbox" id="snd" ${soundOn() ? 'checked' : ''}></label>
        <button class="set-row" data-s="turn"><div><div class="tt">${t('turn')}</div><div class="ss">${t('turnS')}</div></div></button>
        <label class="set-row"><div><div class="tt">${t('devSettings')}</div><div class="ss">${t('devSettingsS')}</div></div><input type="checkbox" id="dev" ${S.dev ? 'checked' : ''}></label>
        <button class="set-row" data-s="privacy"><div><div class="tt">${t('privacy')}</div><div class="ss">${t('privacyText')}</div></div></button>
        <button class="set-row" data-s="perms"><div><div class="tt">${t('checkPerms')}</div><div class="ss">${t('checkPermsS')}</div></div></button>
        <button class="set-row" data-s="onb"><div><div class="tt">${t('resetOnb')}</div><div class="ss">${t('resetOnbS')}</div></div></button>
        <p style="margin:16px 4px"><a href="#" data-s="pn">${t('privacyNotice')}</a> · <a href="#" data-s="terms">${t('terms')}</a></p>
        <button class="btn block big" data-x>${t('done')}</button>`;
      box.querySelectorAll('[data-l]').forEach((b) => b.onclick = () => { setLang(b.dataset.l); draw(); });
      themePicker(box.querySelector('#thp'));
      box.querySelector('#dev').onchange = (e) => { S.dev = e.target.checked; save(); };
      box.querySelector('#ann').onchange = (e) => { S.announce = e.target.checked; save(); };
      box.querySelector('#dkm').onchange = (e) => { S.darkMap = e.target.checked; save(); applyPrefs(); };
      box.querySelector('#bigT').onchange = (e) => { S.bigText = e.target.checked; save(); applyPrefs(); };
      box.querySelector('#eco').onchange = (e) => { S.eco = e.target.checked; save(); applyPrefs(); };
      box.querySelector('#snd').onchange = (e) => { setSound(e.target.checked); if (e.target.checked) beep('green'); };
      box.querySelector('[data-x]').onclick = () => { close(); if (current !== 'game') go(current); };
      box.querySelectorAll('[data-s]').forEach((b) => b.onclick = (e) => {
        e.preventDefault();
        const s = b.dataset.s;
        if (s === 'privacy' || s === 'pn') { close(); go('stats'); setTimeout(() => { const d = document.querySelector('details.acc'); if (d) { d.open = true; d.scrollIntoView({ behavior: 'smooth' }); } }, 50); }
        else if (s === 'perms') modal(`<h2>${t('checkPerms')}</h2><div id="permList">…</div><button class="btn block" data-x style="margin-top:14px">${t('done')}</button>`, (m, c2) => { m.querySelector('[data-x]').onclick = () => { window.__permChanged = null; c2(); }; window.__permChanged = () => renderPerms(m.querySelector('#permList')); renderPerms(m.querySelector('#permList')); });
        else if (s === 'cheats') { close(); go('cheats'); }
        else if (s === 'turn') {
          let cur = {}; try { cur = JSON.parse(localStorage.getItem('mt_turn') || '{}') || {}; } catch {}
          modal(`<h2>${t('turn')}</h2><p style="color:var(--muted)">${t('turnS')}</p>
            <input class="input" id="tu" placeholder="turn:example.com:3478" value="${esc(cur.url || '')}" style="margin-bottom:8px">
            <input class="input" id="tus" placeholder="username" value="${esc(cur.user || '')}" style="margin-bottom:8px">
            <input class="input" id="tup" placeholder="password" value="${esc(cur.pass || '')}">
            <div class="row" style="margin-top:14px"><button class="btn" data-x style="flex:1">${t('cancel')}</button><button class="btn primary" data-ok style="flex:1">OK</button></div>`, (m, c2) => {
            m.querySelector('[data-x]').onclick = c2;
            m.querySelector('[data-ok]').onclick = () => { const v = { url: m.querySelector('#tu').value.trim(), user: m.querySelector('#tus').value.trim(), pass: m.querySelector('#tup').value }; try { v.url ? localStorage.setItem('mt_turn', JSON.stringify(v)) : localStorage.removeItem('mt_turn'); } catch {} c2(); };
          });
        }
        else if (s === 'onb') { S.onboarded = false; save(); close(); go('onboarding'); }
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

// ---------- проверка разрешений (онбординг и настройки) ----------
async function permStatus() {
  const N = window.MapTagNative;
  if (N && N.permState) {
    try { const p = JSON.parse(N.permState()); return { native: true, on: p.on, always: p.bg, precise: p.fine, vol: p.vol >= 0.5, notif: p.notif, coarse: p.coarse }; } catch {}
  }
  let geo = 'unknown';
  try { geo = (await navigator.permissions.query({ name: 'geolocation' })).state; } catch {}
  let acc = null;
  if (geo === 'granted') acc = await new Promise((res) => navigator.geolocation.getCurrentPosition((p) => res(p.coords.accuracy), () => res(null), { enableHighAccuracy: true, timeout: 8000 }));
  return { native: false, on: geo === 'granted' ? acc != null : null, always: null, precise: geo === 'granted' ? (acc != null && acc < 100) : null, vol: null, notif: null, geo };
}
async function renderPerms(box) {
  if (!box) return;
  const st = await permStatus();
  const item = (ok, title, sub, fix) => {
    const cls = ok === true ? '' : ok === false ? 'bad' : 'warn';
    return `<div class="perm ${cls}"><div style="flex:1"><div class="pt">${title}</div><div class="ps">${sub}</div></div><div class="st">${ok === true ? `<span style="color:var(--hider);font-size:24px">✓</span>` : fix ? `<button class="fix" data-fix="${fix}">${t('fix')}</button>${ok === false ? `<span style="color:var(--hunter);font-size:24px">✕</span>` : ''}` : ''}</div></div>`;
  };
  const web = !st.native;
  box.innerHTML = [
    item(st.on, t('pLocOn'), t('pLocOnS'), st.native ? (st.precise || st.coarse ? 'gps' : 'fine') : 'fine'),
    item(st.always, t('pAlways'), web ? t('webOnly') : t('pAlwaysS'), web ? null : 'bg'),
    item(st.precise, t('pPrecise'), t('pPreciseS'), st.native ? 'fine' : 'fine'),
    item(st.vol, t('pVolume'), t('pVolumeS'), web ? null : 'volume'),
    ...(st.native ? [item(st.notif, t('pNotif'), t('pNotifS'), 'notif')] : []),
  ].join('');
  box.querySelectorAll('[data-fix]').forEach((b) => b.onclick = () => {
    const k = b.dataset.fix;
    if (window.MapTagNative && window.MapTagNative.requestPerm) window.MapTagNative.requestPerm(k === 'fine' && st.precise === false && (st.coarse) ? 'app' : k);
    else navigator.geolocation.getCurrentPosition(() => renderPerms(box), () => renderPerms(box), { enableHighAccuracy: true, timeout: 15000 });
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
function qrSvg(code) { const qr = qrcode(0, 'M'); qr.addData(joinUrl(code)); qr.make(); return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); }
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
applyTheme();
function applyPrefs() { document.documentElement.classList.toggle('big-text', !!S.bigText); document.documentElement.classList.toggle('eco', !!S.eco); document.documentElement.classList.toggle('dark-map', !!S.darkMap); }
applyPrefs();
chatInit({
  send: (m) => NET && NET.room.send('chat', m),
  me: () => ({ id: myNetId(), name: S.name, role: myRoleNow() }),
  mask: () => (game && game.chatMask ? game.chatMask() : null),
  inGame: () => (game && game.net ? game : null),
  canTalk: () => !game || !game.canTalk || game.canTalk(),
  toast, onUnread: chatBadges,
});
voiceInit({
  canTalk: () => !game || !game.canTalk || game.canTalk(),
  send: (type, data, to) => NET && NET.room.send(type, data, to),
  myId: () => myNetId(), myName: () => S.name, myRole: () => myRoleNow(), toast,
});
VOICE.onChange = () => {
  if (CHAT.open) CHAT.open.redraw();
  if (game) game.renderHud(true);
};
const hash = /#join=([A-Z0-9]{6})/i.exec(location.hash);
if (hash) { history.replaceState(null, '', location.pathname); go('join', hash[1].toUpperCase()); }
else go(S.onboarded ? 'home' : 'onboarding');
if ('serviceWorker' in navigator && location.protocol === 'https:' && !location.host.includes('appassets')) navigator.serviceWorker.register('sw.js').catch(() => {});
document.addEventListener('backbutton-press', () => { if (document.querySelector('.modal-wrap')) document.querySelector('.modal-wrap').remove(); else if (current !== 'home') go('home'); else window.MapTagNative && window.MapTagNative.exit(); });
// для отладки из консоли
window.__mt = { get game() { return game; }, get S() { return S; }, go };
