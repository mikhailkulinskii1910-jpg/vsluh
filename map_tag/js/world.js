// Мир игры: объекты на карте (куст, радар, сундук, камера, ускоритель, портал, колокол),
// зоны из редактора (безопасная, смертельная, зона выбывших) и выбывание за границей зоны:
// дольше 30 секунд вне зоны или слишком далеко — игрок выбывает.
import { t } from './i18n.js';
import { pwById, pwName } from './content.js';
import { playFx } from './sound.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const inPoly = (x, y, P) => { let ins = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i].y > y) !== (P[j].y > y) && x < (P[j].x - P[i].x) * (y - P[i].y) / (P[j].y - P[i].y) + P[i].x) ins = !ins; return ins; };
export const OUT_LIMIT = 30;           // секунд вне зоны до выбывания
const SAFE_MAX = 20, SAFE_CD = 60;     // защита в безопасной зоне: 20 с подряд, потом 60 с перерыв
const MARGIN = 7;                      // объекты не ближе 7 м к стенам
export const OBJ = {
  bush: { ic: '🌳', r: 8, col: '#3d9b4f' },      // прячущийся внутри не виден охотникам (кроме вплотную) и не попадает в «Раскрытие»
  radar: { ic: '📡', r: 8, col: '#6fb7ff' },     // постоять 4 с — видно охотников 15 с
  chest: { ic: '🎁', r: 6, col: '#f3c13a' },     // случайный бонус, перезарядка 90 с
  camera: { ic: '📹', r: 16, col: '#f26d7d' },   // прячущиеся в обзоре видны охотникам
  boost: { ic: '⚡', r: 6, col: '#ffd84a' },     // полная выносливость и ускорение на 10 с
  portal: { ic: '🌀', r: 5, col: '#b48cff' },    // переносит к парному порталу (только демо)
  bell: { ic: '🔔', r: 6, col: '#ff9f43' },      // охотник звонит: прячущиеся в 60 м слышат звонок и видны 5 с
};
export const OBJ_KINDS = Object.keys(OBJ);

export const worldMixin = {
  /** До создания игроков: зоны редактора в локальных координатах. */
  worldInit() {
    const cfg = this.cfg;
    const toXY = (w) => w.map((q) => this.xy(q[0] != null ? q[0] : q.lat, q[1] != null ? q[1] : q.lng));
    const polys = (a) => (a || []).filter((w) => w && w.length >= 3).map(toXY);
    this.safeZ = polys(cfg.safeZones); this.killZ = polys(cfg.killZones); this.graveZ = polys(cfg.graveZones);
    this.objs = []; this.objsMade = false;
    this.farLimit = Math.max(60, this.R * 0.5);
    this.radarCd = {}; this.boostCd = {}; this.camSeen = 0; this.lastOutSec = null;
  },

  // ---------- проверки ----------
  inSafe(p) { return this.safeZ.some((P) => inPoly(p.x, p.y, P)); },
  inKill(p) { return this.killZ.some((P) => inPoly(p.x, p.y, P)); },
  inGrave(p) { return this.graveZ.some((P) => inPoly(p.x, p.y, P)); },
  /** Можно ли поставить объект / игрока: не в стене и не ближе MARGIN к ней, не в смертельной зоне. */
  spotOk(pt, m = MARGIN) {
    if (this.killZ && this.killZ.length && this.inKill(pt)) return false;
    if (!this.walls || !this.walls.length) return true;
    if (this.inWall(pt)) return false;
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; if (this.inWall({ x: pt.x + Math.cos(a) * m, y: pt.y + Math.sin(a) * m })) return false; }
    return true;
  },
  /** Ходить нельзя: стена, а ботам — ещё и смертельная зона. */
  blockedFor(p, pt) { return (this.walls.length && this.inWall(pt)) || (p.bot && this.killZ.length && this.inKill(pt)); },
  inBush(p) { return this.objs.some((o) => o.k === 'bush' && dist(o, p) <= OBJ.bush.r); },
  hiddenInBush(h, d) { return h.role === 'hider' && d > 6 && this.inBush(h); },
  safeOn(h) { return !!h.safeOn; },
  polyCenter(P) { return { x: P.reduce((s, q) => s + q.x, 0) / P.length, y: P.reduce((s, q) => s + q.y, 0) / P.length }; },
  nearestGrave(p) { let best = null; for (const P of this.graveZ) { const c = this.polyCenter(P), d = dist(c, p); if (!best || d < best.d) best = { c, d }; } return best; },

  // ---------- объекты ----------
  worldMakeObjects() {   // организатор / офлайн
    this.objsMade = true;
    const cfg = this.cfg, list = [];
    const fixed = (cfg.objs || []).filter((o) => OBJ[o.k]);
    if (fixed.length) {
      fixed.forEach((o, i) => list.push({ id: 'o' + i, k: o.k, ...this.xy(o.lat, o.lng), readyAt: 0 }));
    } else if (cfg.objects !== false && !this.indoor()) {
      const k = Math.max(0.6, Math.min(2.2, this.R / 300));
      const want = { bush: Math.round(4 * k), radar: Math.max(1, Math.round(k)), chest: this.hasPowerups ? Math.max(1, Math.round(1.5 * k)) : 0, camera: Math.max(1, Math.round(k)), boost: Math.round(2 * k), bell: Math.max(1, Math.round(k)), portal: cfg.mode === 'demo' ? 2 : 0 };
      const gap = Math.max(25, this.R * 0.12);
      let n = 0;
      for (const [kind, cnt] of Object.entries(want)) for (let i = 0; i < cnt; i++) {
        let pt = null;
        for (let a = 0; a < 40 && !pt; a++) { const q = this.randZone(0.9, 0.08); if (this.spotOk(q) && !list.some((o) => dist(o, q) < gap)) pt = q; }
        if (pt) list.push({ id: 'o' + n++, k: kind, x: Math.round(pt.x), y: Math.round(pt.y), readyAt: 0 });
      }
    }
    // порталы — парами по порядку
    const ps = list.filter((o) => o.k === 'portal');
    for (let i = 0; i + 1 < ps.length; i += 2) { ps[i].pair = ps[i + 1].id; ps[i + 1].pair = ps[i].id; }
    if (ps.length % 2) ps[ps.length - 1].k = 'boost';
    this.objs = list;
  },
  objById(id) { return this.objs.find((o) => o.id === id); },

  /** Шаг организатора / офлайн: сундуки, безопасные зоны, смертельные зоны и порталы для ботов. */
  worldStep(dt) {
    if (!this.objsMade) this.worldMakeObjects();
    const T = this.t, hunt = this.phase() === 'hunt';
    // безопасные зоны
    for (const h of this.players) {
      if (h.role !== 'hider' || !this.safeZ.length) { h.safeOn = false; continue; }
      if (this.inSafe(h) && T >= (h.safeCdUntil || 0)) {
        if (h.safeSince == null) h.safeSince = T;
        if (T - h.safeSince > SAFE_MAX) { h.safeCdUntil = T + SAFE_CD; h.safeSince = null; h.safeOn = false; } else h.safeOn = true;
      } else { if (!this.inSafe(h)) h.safeSince = null; h.safeOn = false; }
    }
    if (!hunt) return;
    // сундуки
    for (const o of this.objs) {
      if (o.k !== 'chest' || T < o.readyAt) continue;
      const p = this.players.find((q) => (q.role === 'hider' || q.role === 'hunter') && dist(q, o) <= OBJ.chest.r);
      if (!p) continue;
      const pool = this.enabledPw.filter((id) => { const pw = pwById(id); return pw && (pw.side === 'both' || pw.side === p.role); });
      if (!pool.length) continue;
      const id = pool[Math.floor(Math.random() * pool.length)];
      o.readyAt = T + 90;
      if (p.remote) this.netSend('picked', { by: p.id, pw: id });
      else { p.powerups.push(id); if (p === this.me) { this.stats.supplies++; this.alert('green', t('chestGot', { p: pwName(pwById(id)) }), 'supply'); this.vibrate([60]); this.renderHud(true); } }
    }
    // боты: смертельная зона (если всё-таки забрели) и порталы / ускорители
    for (const p of this.players) {
      if (!p.bot || !p.sim || p.role === 'dead') continue;
      if (this.killZ.length && this.inKill(p) && (p.role === 'hider' || p.role === 'hunter')) { this.eliminate(p, 'kill'); continue; }
      this.useObjects(p);
    }
    // конец: все охотники выбыли
    if (!this.social() && !this.ended && this.hunters().length === 0 && this.players.some((p) => p.role === 'hider')) this.finish('hiders');
  },

  /** Порталы и ускорители — для себя и ботов (физика у того, кто двигает игрока). */
  useObjects(p) {
    const T = this.t;
    for (const o of this.objs) {
      const d = dist(o, p);
      if (o.k === 'portal' && d <= OBJ.portal.r && T >= (p.portalCd || 0) && o.pair) {
        const q = this.objById(o.pair); if (!q) continue;
        p.portalCd = T + 15; p.x = q.x + 7; p.y = q.y; p.target = null;
        if (p === this.me) { this.alert('blue', t('portalUsed'), 'swap'); playFx && playFx('boo'); this.follow = true; }
        return;
      }
      if (o.k === 'boost' && d <= OBJ.boost.r && T >= ((this.boostCd[p.id || p.name] || 0))) {
        this.boostCd[p.id || p.name] = T + 30; p.boostUntil = T + 10; p.stamina = 100;
        if (p === this.me) { this.alert('green', t('boostOn'), 'bolt'); this.vibrate([80]); }
      }
    }
  },

  /** Каждый телефон: выбывание за зоной, смертельная зона, радар, камеры, объекты для себя. */
  worldLocal(dt) {
    const me = this.me, T = this.t, ph = this.phase();
    if (me.role === 'dead' || me.role === 'spectator' || me.role === 'escaped') { this.outLeft = null; return; }
    if (!this.isClient && !this.objsMade) this.worldMakeObjects();
    if (!me.bot) this.useObjects(me);
    // безопасная зона у себя (для подсказки; решает организатор)
    if (this.isClient && me.role === 'hider' && this.safeZ.length) {
      if (this.inSafe(me) && T >= (me.safeCdUntil || 0)) { if (me.safeSince == null) me.safeSince = T; if (T - me.safeSince > SAFE_MAX) { me.safeCdUntil = T + SAFE_CD; me.safeSince = null; } me.safeOn = me.safeSince != null; }
      else { if (!this.inSafe(me)) me.safeSince = null; me.safeOn = false; }
    }
    // радар
    if (me.role === 'hider' && ph === 'hunt') {
      const r = this.objs.find((o) => o.k === 'radar' && dist(o, me) <= OBJ.radar.r && T >= (this.radarCd[o.id] || 0));
      if (r) { this.radarT = (this.radarT || 0) + dt; if (this.radarT >= 4) { this.radarT = 0; this.radarCd[r.id] = T + 60; this.showHuntersUntil = Math.max(this.showHuntersUntil, T + 15); this.alert('blue', t('radarOn'), 'eye'); this.vibrate([60, 40, 60]); } }
      else this.radarT = 0;
    }
    // камеры: охотник видит прячущихся в обзоре; прячущегося предупреждаем
    if (ph === 'hunt') for (const o of this.objs) {
      if (o.k !== 'camera') continue;
      if (me.role === 'hunter') {
        const hits = this.hiders().filter((h) => dist(h, o) <= OBJ.camera.r && !this.inBush(h));
        hits.forEach((h) => { h.exposedUntil = Math.max(h.exposedUntil || 0, T + 2); });
        if (hits.length && T - this.camSeen > 15) { this.camSeen = T; this.alert('blue', t('camSaw', { n: hits.map((h) => h.name).join(', ') }), 'eye'); }
      } else if (me.role === 'hider' && dist(me, o) <= OBJ.camera.r && T - this.camSeen > 10) { this.camSeen = T; this.alert('red', t('camYou'), 'eye'); this.vibrate([120]); }
    }
    if (ph !== 'hunt' || this.indoor() || this.ch.noout) { this.outLeft = null; return; }
    // смертельная зона
    if (this.killZ.length && this.inKill(me)) { this.selfElim('kill'); return; }
    // вне зоны: 30 секунд или сразу, если слишком далеко
    if (me.outSince != null) {
      if ((me.outDist || 0) > this.farLimit) { this.selfElim('far'); return; }
      const left = OUT_LIMIT - (T - Math.max(me.outSince, this.cfg.hideSec));
      this.outLeft = left;
      if (left <= 0) { this.selfElim('out'); return; }
      const s = Math.ceil(left);
      if (s !== this.lastOutSec) { this.lastOutSec = s; this.vibrate(s <= 10 ? [250, 100, 250] : [200]); if (s <= 5) playFx('drum'); }
    } else { this.outLeft = null; this.lastOutSec = null; }
  },

  // ---------- выбывание ----------
  selfElim(r) {
    const me = this.me;
    if (me.role === 'dead') return;
    if (this.isClient) this.netSend('elimreq', { r });
    this.eliminate(me, r, this.isClient);
  },
  /** Игрок выбывает. local=true — только у себя (сообщение уже ушло организатору / пришло от него). */
  eliminate(p, r, local) {
    if (!p || p.role === 'dead' || p.role === 'spectator') return;
    p.prevRole = p.role; p.role = 'dead'; p.elim = r; p.caughtAt = this.t; p.caughtBy = '⚠'; p.running = false; p.target = null; p.safeOn = false;
    this.events.push({ k: 'e', t: Math.round(this.t), b: this.players.indexOf(p), x: Math.round(p.x), y: Math.round(p.y) });
    if (!this.isClient && !local) this.netSend('elim', { id: p.id, r });
    const why = t('elim_' + r);
    if (p === this.me) {
      this.outLeft = null;
      if (this.social()) this.alert('red', t('elimYou', { r: why }), 'target');
      this.vibrate([600, 150, 600]); playFx('horn');
      const gEl = this.root && this.root.querySelector('#game'); if (gEl) gEl.classList.remove('out-alarm');
      this.stats.timesCaught++;
      if (this.opts.onDead) this.opts.onDead();
    } else this.alert('yellow', t('elimOther', { n: p.name, r: why }), 'target');
    this.renderHud(true);
  },

  /** Перед поимкой: безопасная зона. */
  preCatchWorld(hunter, h) {
    if (h.safeOn) { if (hunter === this.me) this.alert('yellow', t('safeBlock', { n: h.name }), 'shield'); return true; }
    return false;
  },
  /** Видимость: прячущийся в кусте не виден охотнику (кроме вплотную). */
  visWorld(p, d, show) {
    const me = this.me;
    if (me.role === 'dead') return true;
    if (me.role === 'hunter' && !this.ch.wall && this.hiddenInBush(p, d)) return false;
    return show;
  },
  /** Колокол: охотник рядом звонит — прячущиеся в 60 м слышат и видны 5 с. */
  ringBell(by) {
    const T = this.t;
    const b = this.objs.find((o) => o.k === 'bell' && dist(o, by) <= OBJ.bell.r + 4 && T >= o.readyAt);
    if (!b) return false;
    b.readyAt = T + 60;
    const hits = this.hiders().filter((h) => dist(h, b) <= 60);
    hits.forEach((h) => { h.exposedUntil = Math.max(h.exposedUntil || 0, T + 5); });
    this.netSend('bell', { o: b.id, ids: hits.map((h) => h.id), by: by.name });
    this.onBell(b.id, hits.map((h) => h.id), by.name);
    return true;
  },
  onBell(oid, ids, by) {
    const b = this.objById(oid); if (b) b.readyAt = this.t + 60;
    ids.forEach((id) => { const h = this.players.find((q) => q.id === id); if (h) h.exposedUntil = Math.max(h.exposedUntil || 0, this.t + 5); });
    if (ids.includes(this.me.id)) { this.alert('red', t('bellYou'), 'signal'); this.vibrate([300, 100, 300]); playFx('horn'); }
    else if (this.me.role === 'hunter') this.alert('blue', t('bellRang', { k: ids.length }), 'signal');
  },
  bellNear() { return this.me.role === 'hunter' && this.phase() === 'hunt' && this.objs.some((o) => o.k === 'bell' && dist(o, this.me) <= OBJ.bell.r + 4 && this.t >= o.readyAt); },
  /** Укрытие для бота-прячущегося рядом с охотником: безопасная зона или куст в 50 м. */
  botRefuge(p) {
    let best = null;
    for (const o of this.objs) if (o.k === 'bush') { const d = dist(o, p); if (d < 50 && (!best || d < best.d)) best = { d, x: o.x, y: o.y }; }
    for (const P of this.safeZ) { const c = this.polyCenter(P), d = dist(c, p); if (d < 60 && T0(p) && (!best || d < best.d)) best = { d, x: c.x, y: c.y }; }
    return best ? { x: best.x, y: best.y } : null;
  },

  // ---------- сеть ----------
  worldState() {
    return { ob: this.objs.map((o) => [o.id, o.k, o.x, o.y, Math.round(o.readyAt), o.pair || 0]), dd: this.players.map((p, i) => (p.role === 'dead' ? i : -1)).filter((i) => i >= 0), sf: this.players.map((p, i) => (p.safeOn ? i : -1)).filter((i) => i >= 0) };
  },
  worldApply(d) {
    if (!d) return;
    if (d.ob) this.objs = d.ob.map(([id, k, x, y, readyAt, pair]) => ({ id, k, x, y, readyAt, pair: pair || null }));
    (d.dd || []).forEach((i) => { const p = this.players[i]; if (p && p.role !== 'dead' && !this.social()) this.eliminate(p, p.elim || 'out', true); });
    if (d.sf) this.players.forEach((p, i) => { if (p !== this.me) p.safeOn = d.sf.includes(i); });
  },
  worldNet(type, d, from) {
    const P = (id) => this.players.find((q) => q.id === id);
    if (type === 'elimreq' && this.isHost) { const p = P(from); if (p) this.eliminate(p, d.r); return true; }
    if (type === 'elim' && this.isClient) { const p = P(d.id); if (p) this.eliminate(p, d.r, true); return true; }
    if (type === 'bellreq' && this.isHost) { const p = P(from); if (p && p.role === 'hunter') this.ringBell(p); return true; }
    if (type === 'bell' && this.isClient) { this.onBell(d.o, d.ids, d.by); return true; }
    if (type === 'setrole') { if (this.isHost && from) { const p = P(from); if (p) { this.applyRole(p, d.r); this.netSend('setrole', { id: p.id, r: d.r }); } } else if (this.isClient) { const p = P(d.id); if (p && p !== this.me) this.applyRole(p, d.r); } return true; }
    if (type === 'spawn' && this.isHost) { this.spawnAt(d.k, { x: d.x, y: d.y }); return true; }
    return false;
  },

  // ---------- читы ----------
  applyRole(p, r) {
    p.role = r; p.target = null; p.jailed = false; p.frozenUntil = 0; p.warnUntil = 0; p.stunUntil = 0;
    if (r === 'hider') { p.alive = true; p.stamina = 100; }
    if (p === this.me) { this.meRole = null; this.outLeft = null; this.renderHud(true); }
  },
  cheatRole(r) {
    this.applyRole(this.me, r);
    if (this.net) this.netSend('setrole', { id: this.me.id, r });
  },
  /** Чит: предмет или объект у себя под ногами. */
  spawnAt(k, pos) {
    const at = { x: Math.round(pos.x + (Math.random() - 0.5) * 6), y: Math.round(pos.y + (Math.random() - 0.5) * 6) };
    if (this.isClient) { this.netSend('spawn', { k, ...at }); return; }
    if (k === 'supply') { const s = this.newSupply(); Object.assign(s, at); this.supplies.push(s); return; }
    if (!OBJ[k]) return;
    const o = { id: 'o' + Math.random().toString(36).slice(2, 7), k, ...at, readyAt: 0 };
    if (k === 'portal') { const q = { id: 'o' + Math.random().toString(36).slice(2, 7), k, x: at.x + 60, y: at.y, readyAt: 0, pair: o.id }; o.pair = q.id; this.objs.push(q); }
    this.objs.push(o);
    this.objsMade = true;
  },

  // ---------- интерфейс ----------
  worldRender() {
    const map = this.map;
    if (!this.wzLayer) {
      this.wzLayer = L.layerGroup().addTo(map);
      const pg = (P, st) => L.polygon(P.map((q) => this.ll(q)), { interactive: false, ...st }).addTo(this.wzLayer);
      this.safeZ.forEach((P) => pg(P, { color: '#3fb6ff', weight: 2, fillColor: '#3fb6ff', fillOpacity: 0.18 }));
      this.killZ.forEach((P) => pg(P, { color: '#7a0010', weight: 3, fillColor: '#b0001a', fillOpacity: 0.35, dashArray: '2 6' }));
      this.graveZ.forEach((P) => pg(P, { color: '#8a8f99', weight: 2, fillColor: '#8a8f99', fillOpacity: 0.25, dashArray: '6 6' }));
      const lab = (P, ic) => L.marker(this.ll(this.polyCenter(P)), { interactive: false, icon: L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13], html: `<div class="mk-zone">${ic}</div>` }) }).addTo(this.wzLayer);
      this.safeZ.forEach((P) => lab(P, '🛡')); this.killZ.forEach((P) => lab(P, '☠')); this.graveZ.forEach((P) => lab(P, '🪦'));
      this.objLayer = L.layerGroup().addTo(map); this.objSig = '';
    }
    const T = this.t, me = this.me;
    const vis = this.objs.filter((o) => !(o.k === 'camera' && false));
    const sig = vis.map((o) => o.id + (T < o.readyAt ? 'w' : '')).join(',');
    if (sig !== this.objSig) {
      this.objSig = sig; this.objLayer.clearLayers();
      for (const o of vis) {
        const def = OBJ[o.k], wait = T < o.readyAt;
        if (o.k === 'bush' || o.k === 'camera') L.circle(this.ll(o), { radius: def.r, color: def.col, weight: o.k === 'camera' ? 1 : 0, dashArray: '3 5', fillColor: def.col, fillOpacity: o.k === 'bush' ? 0.35 : 0.1, interactive: false }).addTo(this.objLayer);
        L.marker(this.ll(o), { interactive: false, icon: L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13], html: `<div class="mk-obj k-${o.k} ${wait ? 'wait' : ''}">${def.ic}</div>` }) }).addTo(this.objLayer);
      }
    }
    // вне зоны — красная рамка экрана
    const g = this.root && this.root.querySelector('#game');
    if (g) g.classList.toggle('out-alarm', this.outLeft != null && me.role !== 'dead');
    const ot = this.root && this.root.querySelector('#outT');
    if (ot && this.outLeft != null) ot.textContent = '0:' + String(Math.max(0, Math.ceil(this.outLeft))).padStart(2, '0');
    const gd = this.root && this.root.querySelector('#graveD');
    if (gd) { const n = this.nearestGrave(me); gd.textContent = n ? (this.inGrave(me) ? t('graveIn') : Math.round(n.d) + ' ' + t('m')) : ''; }
  },
  worldBanner() {
    const me = this.me, out = [];
    if (this.outLeft != null && me.role !== 'dead') out.push(`<div class="out-timer"><div class="ot-ic"><span id="outArrow" style="display:inline-block">⬆</span></div><div class="ot-tx"><b>${t('outBack')}</b><span>${t('outRule', { s: OUT_LIMIT })} · <b id="outDist"></b></span></div><div class="ot-num" id="outT">0:${String(Math.max(0, Math.ceil(this.outLeft))).padStart(2, '0')}</div></div>`);
    if (me.role === 'dead' && !this.social()) out.push(`<div class="banner red"><div class="bi">☠</div><div>${t('elimYou', { r: t('elim_' + (me.elim || 'out')) })}${this.graveZ.length ? `<br><b>🪦 ${t('graveGo')} · <span id="graveD"></span></b>` : ''}</div></div>`);
    if (me.role === 'hider' && me.safeOn) out.push(`<div class="banner blue"><div class="bi">🛡</div><div>${t('safeOn', { s: Math.max(0, Math.ceil(SAFE_MAX - (this.t - (me.safeSince != null ? me.safeSince : this.t)))) })}</div></div>`);
    if (me.role === 'hider' && this.inBush(me)) out.push(`<div class="banner green"><div class="bi">🌳</div><div>${t('bushOn')}</div></div>`);
    return out.join('');
  },
  worldButtons() {
    const me = this.me;
    if (me.role === 'dead' && !this.social()) return `<div class="ab" style="cursor:default">☠<span class="t">${t('deadT')}</span><span class="s">${t('deadS')}</span></div>`;
    if (this.bellNear()) return `<button class="ab" data-a="bell" style="color:#ff9f43">🔔<span class="t">${t('bell')}</span><span class="s">${t('ready')}</span></button>`;
    return '';
  },
  worldSig() { const me = this.me; return [this.outLeft != null, me.safeOn ? 1 : 0, me.role === 'hider' && this.inBush(me), this.bellNear()].join(''); },
};
const T0 = (p) => p.role === 'hider';
