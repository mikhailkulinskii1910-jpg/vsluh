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
  bell: { ic: '🔔', r: 6, col: '#ff9f43' },
  mine: { ic: '💣', r: 6, col: '#e74c3c' },      // охотник наступил — оглушён на 5 с; охотникам не видна; перезарядка 60 с
  smoke: { ic: '💨', r: 6, col: '#b0b8c4' },     // прячущийся задел — облако дыма 25 м на 30 с (как туман)
  lighthouse: { ic: '🗼', r: 8, col: '#ffd166' }, // охотник постоял 3 с — прячущиеся в 100 м видны 4 с; перезарядка 90 с
  medkit: { ic: '⛑', r: 6, col: '#ff6b81' },
  snare: { ic: '🕸', r: 6, col: '#a0a0a0' },       // капкан: прячущийся попал — виден охотникам 8 с; прячущимся не виден; перезарядка 45 с
  compass: { ic: '🧭', r: 6, col: '#4fc3f7' },     // компас: показывает направление и расстояние до ближайшего соперника; перезарядка 60 с
  radio: { ic: '📻', r: 7, col: '#ffa726' },       // радиовышка: все видят всех 4 с; перезарядка 120 с
  flarebox: { ic: '🎆', r: 6, col: '#ef5350' },
  mirror: { ic: '🪞', r: 6, col: '#b3e5fc' },      // зеркало: прячущийся — охотники 20 с видят его двойника в стороне
  clock: { ic: '⏰', r: 6, col: '#ffcc80' },       // часы: прячущийся −20 с охоты, охотник +20 с
  clover: { ic: '🍀', r: 6, col: '#66bb6a' },      // клевер: прячущемуся — щит
  freezer: { ic: '🥶', r: 6, col: '#81d4fa' },     // морозилка: охотник — прячущиеся в 50 м замерзают на 5 с
  target: { ic: '🎯', r: 6, col: '#ff5252' },      // мишень: охотник — ближайший прячущийся виден 10 с    // ящик ракет: охотник запускает ракету — через 10 с видны все прячущиеся; перезарядка 90 с     // снимает заморозку и оглушение, полная выносливость; перезарядка 45 с      // охотник звонит: прячущиеся в 60 м слышат звонок и видны 5 с
};
export const OBJ_KINDS = Object.keys(OBJ);
/** Дополнительные зоны редактора: цвет, значок. */
export const ZX = {
  swamp: { col: '#6b7d2a', ic: '🟫', op: 0.35 },    // болото: медленнее вдвое, выносливость тает
  shadow: { col: '#2b2440', ic: '🌑', op: 0.45 },   // тень: прячущихся не видно дальше 10 м, «Раскрытие» мимо
  light: { col: '#ffe066', ic: '🔦', op: 0.3 },     // прожектор: прячущиеся внутри видны охотникам
  jam: { col: '#9b59b6', ic: '📵', op: 0.25 },      // глушилка: «Раскрытие», «Заморозка», дрон, камеры и сонар не действуют
  bonus: { col: '#f3c13a', ic: '💰', op: 0.22 },
  fog: { col: '#c9d1dc', ic: '🌫', op: 0.5 },       // туман: внутри видно только на 20 м, снаружи внутрь — тоже 20 м
  ice: { col: '#9fe3ff', ic: '🧊', op: 0.3 },       // лёд: скользко — скорость ×1.5
  alarm: { col: '#ff4757', ic: '🚨', op: 0.18 },    // тревога: прячущийся вошёл — охотники видят его 6 с
  lookout: { col: '#2ecc71', ic: '👁', op: 0.18 },
  electric: { col: '#ffeb3b', ic: '⚡', op: 0.22 },  // электрозона: охотник вошёл — оглушён на 3 с
  echo: { col: '#ce93d8', ic: '🔊', op: 0.2 },      // эхо: бег внутри слышат соперники — с направлением
  arena: { col: '#ff7043', ic: '🎪', op: 0.18 },    // арена: охотник внутри ловит с двойного расстояния
  heal: { col: '#f48fb1', ic: '❤', op: 0.2 },       // лечебная: выносливость быстро восстанавливается, заморозка и оглушение проходят вдвое быстрее
  chaos: { col: '#7e57c2', ic: '🌀', op: 0.22 },    // хаос: кто вошёл — запускает случайное событие (раз в 2 минуты)  // вышка обзора: стоящий внутри видит соперников на 60 м    // сокровищница: 8 с внутри — случайный бонус (раз в 60 с)
};
export const ZX_KINDS = Object.keys(ZX);

export const worldMixin = {
  /** До создания игроков: зоны редактора в локальных координатах. */
  worldInit() {
    const cfg = this.cfg;
    const toXY = (w) => w.map((q) => this.xy(q[0] != null ? q[0] : q.lat, q[1] != null ? q[1] : q.lng));
    const fOf = (w) => { const q = w[0] || {}; const f = q[2] != null ? q[2] : q.f; return f == null ? null : f; };
    const polys = (a) => (a || []).filter((w) => w && w.length >= 3).map((w) => { const P = toXY(w); P.f = fOf(w); return P; });
    this.safeZ = polys(cfg.safeZones); this.killZ = polys(cfg.killZones); this.graveZ = polys(cfg.graveZones);
    this.zx = {}; for (const k of ZX_KINDS) this.zx[k] = polys((cfg.zonesX || {})[k]);
    this.objs = []; this.objsMade = false;
    this.farLimit = Math.max(60, this.R * 0.5);
    this.radarCd = {}; this.boostCd = {}; this.camSeen = 0; this.lastOutSec = null;
  },

  // ---------- проверки ----------
  inSafe(p) { return this.safeZ.some((P) => this.okF(P.f, p) && inPoly(p.x, p.y, P)); },
  inKill(p) { return this.killZ.some((P) => this.okF(P.f, p) && inPoly(p.x, p.y, P)); },
  inZ(k, p) { const L = this.zx && this.zx[k]; return !!(L && L.length && L.some((P) => this.okF(P.f, p) && inPoly(p.x, p.y, P))); },
  inGrave(p) { return this.graveZ.some((P) => this.okF(P.f, p) && inPoly(p.x, p.y, P)); },
  /** Объект рядом и на том же этаже. */
  nearO(a, b, k) { const o = a.k ? a : b, p = a.k ? b : a; return this.okF(o.f, p) && dist(a, b) <= this.objR(k); },
  /** Можно ли поставить объект / игрока: не в стене и не ближе MARGIN к ней, не в смертельной зоне. */
  spotOk(pt, m = MARGIN) {
    if (this.killZ && this.killZ.length && this.inKill(pt)) return false;
    if (this.graveZ && this.graveZ.length && this.inGrave(pt)) return false;
    if (!this.walls || !this.walls.length) return true;
    if (this.inWall(pt)) return false;
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; if (this.inWall({ x: pt.x + Math.cos(a) * m, y: pt.y + Math.sin(a) * m })) return false; }
    return true;
  },
  /** Ходить нельзя: стена, а ботам — ещё и смертельная зона. */
  /** Ходить нельзя: стены; ботам — смертельная зона; живым — зона выбывших. */
  blockedFor(p, pt) { return (this.walls.length && this.inWall(pt, this.flOf(p))) || (p.bot && this.killZ.length && this.inKill(pt)) || (p.role !== 'dead' && p.role !== 'spectator' && this.graveZ.length && this.inGrave(pt)); },
  /** GPS: точность ±10 м, поэтому объекты срабатывают с большего расстояния. */
  gps() { return this.cfg.mode === 'gps' && !this.ch.spoof; },
  objR(k) { const r = OBJ[k].r; return this.gps() ? Math.max(10, Math.round(r * 1.6)) : r; },
  gpsOk() { return !this.gps() || (this.gpsAcc || 0) <= 35; },
  inBush(p) { return this.objs.some((o) => o.k === 'bush' && this.nearO(o, p, 'bush')); },
  hiddenInBush(h, d) { return h.role === 'hider' && ((d > 6 && this.inBush(h)) || (d > 10 && this.inZ('shadow', h)) || (d > 20 && this.foggy(h))); },
  inSmoke(p) { return (this.smokes || []).some((s) => this.t < s.until && dist(s, p) <= 25); },
  foggy(p) { return this.inZ('fog', p) || this.inSmoke(p); },
  jammed(p) { return this.inZ('jam', p); },
  safeOn(h) { return !!h.safeOn; },
  polyCenter(P) { return { x: P.reduce((s, q) => s + q.x, 0) / P.length, y: P.reduce((s, q) => s + q.y, 0) / P.length }; },
  nearestGrave(p) { let best = null; for (const P of this.graveZ) { const c = this.polyCenter(P), d = dist(c, p); if (!best || d < best.d) best = { c, d }; } return best; },

  // ---------- объекты ----------
  worldMakeObjects() {   // организатор / офлайн
    this.objsMade = true;
    const cfg = this.cfg, list = [];
    const fixed = (cfg.objs || []).filter((o) => OBJ[o.k]);
    if (fixed.length) {
      fixed.forEach((o, i) => list.push({ id: 'o' + i, k: o.k, ...this.xy(o.lat, o.lng), readyAt: 0, f: o.f != null ? o.f : null }));
    } else if (cfg.objects !== false && !this.indoor()) {
      const k = Math.max(0.6, Math.min(2.2, this.R / 300));
      const want = { bush: Math.round(4 * k), radar: Math.max(1, Math.round(k)), chest: this.hasPowerups ? Math.max(1, Math.round(1.5 * k)) : 0, camera: Math.max(1, Math.round(k)), boost: Math.round(2 * k), bell: Math.max(1, Math.round(k)), mine: Math.round(1.5 * k), smoke: Math.max(1, Math.round(k)), lighthouse: Math.max(1, Math.round(k)), medkit: Math.round(k), snare: Math.round(1.5 * k), compass: Math.max(1, Math.round(k)), radio: 1, mirror: Math.max(1, Math.round(k)), clock: 1, clover: Math.round(k), freezer: Math.max(1, Math.round(0.7 * k)), target: Math.max(1, Math.round(0.7 * k)), flarebox: Math.max(1, Math.round(0.7 * k)), portal: cfg.mode === 'demo' ? 2 : 0 };
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
    this.smokes = (this.smokes || []).filter((s) => T < s.until);
    if (hunt) for (const o of this.objs) {
      if (T < o.readyAt) continue;
      if (o.k === 'mine') { const u = this.hunters().find((q) => this.nearO(q, o, 'mine') && !this.isStunned(q)); if (u) { o.readyAt = T + 60; this.netSend('stun', { ids: [u.id], until: T + 5, by: '💣' }); this.onStun([u.id], T + 5, '💣'); } }
      if (o.k === 'snare') { const h = this.hiders().find((q) => this.nearO(q, o, 'snare')); if (h) { o.readyAt = T + 45; if (h.sim) h.exposedUntil = Math.max(h.exposedUntil || 0, T + 8); this.netSend('snared', { id: h.id, n: h.name }); this.onSnare(h); } }
      if (o.k === 'radio') { const p = this.players.find((q) => (q.role === 'hider' || q.role === 'hunter') && this.nearO(q, o, 'radio')); if (p) { o.readyAt = T + 120; this.netSend('radio', { n: p.name }); this.onRadio(p.name); } }
      if (o.k === 'mirror') { const h = this.hiders().find((q) => this.nearO(q, o, 'mirror')); if (h) { o.readyAt = T + 60; const a = Math.random() * 6.28, r = 60 + Math.random() * 50; this.fakes = (this.fakes || []).concat([{ x: Math.round(h.x + Math.cos(a) * r), y: Math.round(h.y + Math.sin(a) * r), until: T + 20, name: h.name, c: h.color }]); this.netSend('fx2', { k: 'mirror', n: h.name }); this.onFx2('mirror', h.name); } }
      if (o.k === 'clock') { const p = this.players.find((q) => (q.role === 'hider' || q.role === 'hunter') && this.nearO(q, o, 'clock')); if (p) { o.readyAt = T + 90; const d = p.role === 'hider' ? -20 : 20; this.cfg.huntSec = Math.max(this.t - this.cfg.hideSec + 30, this.cfg.huntSec + d); this.netSend('ext', { huntSec: this.cfg.huntSec }); this.netSend('fx2', { k: 'clock', n: p.name, d }); this.onFx2('clock', p.name, d); } }
      if (o.k === 'clover') { const h = this.hiders().find((q) => this.nearO(q, o, 'clover')); if (h) { o.readyAt = T + 120; h.shield = (h.shield || 0) + 1; this.netSend('fx2', { k: 'clover', n: h.name, id: h.id }); this.onFx2('clover', h.name, h.id); } }
      if (o.k === 'freezer') { const u = this.hunters().find((q) => this.nearO(q, o, 'freezer')); if (u) { o.readyAt = T + 90; const hs = this.hiders().filter((h) => dist(h, u) <= 50 && !this.jammed(h)); hs.forEach((h) => { h.warnUntil = T; h.frozenUntil = T + 5; h.target = null; }); if (this.isHost && hs.length) this.netSend('freeze', { ids: hs.map((h) => h.id), wu: T, fu: T + 5, warded: [], fr: this.freezeReadyAt }); this.netSend('fx2', { k: 'freezer', n: u.name, d: hs.length }); this.onFx2('freezer', u.name, hs.length); } }
      if (o.k === 'target') { const u = this.hunters().find((q) => this.nearO(q, o, 'target')); if (u) { o.readyAt = T + 60; const h = this.hiders().sort((a, b) => dist(a, u) - dist(b, u))[0]; if (h) { if (h.sim) h.exposedUntil = Math.max(h.exposedUntil || 0, T + 10); this.netSend('fx2', { k: 'target', n: h.name, id: h.id }); this.onFx2('target', h.name, h.id); } } }
      if (o.k === 'flarebox') { const u = this.hunters().find((q) => this.nearO(q, o, 'flarebox')); if (u) { o.readyAt = T + 90; this.applyPower(u, 'flare'); } }
      if (o.k === 'smoke') { const h = this.hiders().find((q) => this.nearO(q, o, 'smoke')); if (h) { o.readyAt = T + 90; this.smokes.push({ x: o.x, y: o.y, until: T + 30 }); this.netSend('smokeup', { n: h.name }); this.onSmoke(h.name); } }
    }
    // тревога для ботов
    if (hunt) for (const h of this.hiders()) if (h.sim && h !== this.me) { const a = this.inZ('alarm', h); if (a && !h.inAlarm && T >= (h.alarmCd || 0)) { h.alarmCd = T + 30; h.exposedUntil = Math.max(h.exposedUntil || 0, T + 6); this.netSend('alarm', { n: h.name }); this.onAlarm(h.name, false); } h.inAlarm = a; }
    // зоны: электро (охотникам), хаос (всем), лечебная (ботам)
    this.fakes = (this.fakes || []).filter((f) => T < f.until);
    if (hunt) for (const p of this.players) {
      if (p.role === 'hunter') { const e = this.inZ('electric', p); if (e && !p.inElec && !this.isStunned(p) && T >= (p.elecCd || 0)) { p.elecCd = T + 20; this.netSend('stun', { ids: [p.id], until: T + 3, by: '⚡' }); this.onStun([p.id], T + 3, '⚡'); } p.inElec = e; }
      if (p.role === 'hider' || p.role === 'hunter') { const c = this.inZ('chaos', p); if (c && !p.inChaos && T >= (this.chaosZoneAt || 0)) { this.chaosZoneAt = T + 120; const ks = ['blind', 'siren', 'surge', 'fog', 'frenzy'].concat(this.hasPowerups ? ['rain'] : []); const k = ks[Math.floor(Math.random() * ks.length)]; this.netSend('chaos', { k }); this.chaosApply(k, true); } p.inChaos = c; }
      if (p.bot && this.inZ('heal', p)) p.stamina = Math.min(100, (p.stamina || 0) + 20 * dt);
    }
    // прожектор и сокровищница
    for (const h of this.players) {
      if (h.role !== 'hider') continue;
      if (h.sim && this.inZ('light', h)) h.exposedUntil = Math.max(h.exposedUntil || 0, T + 2);
      if (hunt && this.inZ('bonus', h) && T >= (h.bonusCd || 0)) {
        h.bonusT = (h.bonusT || 0) + dt;
        if (h.bonusT >= 8) {
          h.bonusT = 0; h.bonusCd = T + 60;
          const pool = this.enabledPw.filter((id) => { const pw = pwById(id); return pw && (pw.side === 'both' || pw.side === 'hider'); });
          const id = pool[Math.floor(Math.random() * pool.length)];
          if (id) { if (h.remote) this.netSend('picked', { by: h.id, pw: id }); else { h.powerups.push(id); if (h === this.me) { this.hasPowerups = true; this.alert('green', t('bonusGot', { p: pwName(pwById(id)) }), 'supply'); this.vibrate([60]); this.renderHud(true); } } }
        }
      } else h.bonusT = 0;
    }
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
      const p = this.players.find((q) => (q.role === 'hider' || q.role === 'hunter') && this.nearO(q, o, 'chest'));
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
      if (o.k === 'portal' && d <= this.objR('portal') && T >= (p.portalCd || 0) && o.pair) {
        const q = this.objById(o.pair); if (!q) continue;
        p.portalCd = T + 15; p.x = q.x + 7; p.y = q.y; p.target = null;
        if (p === this.me) { this.alert('blue', t('portalUsed'), 'swap'); playFx && playFx('boo'); this.follow = true; }
        return;
      }
      if (o.k === 'boost' && d <= this.objR('boost') && T >= ((this.boostCd[p.id || p.name] || 0))) {
        this.boostCd[p.id || p.name] = T + 30; p.boostUntil = T + 10; p.stamina = 100;
        if (this.gps() && p === this.me) {
          if (p.role === 'hider') { p.invisUntil = T + 15; this.alert('green', t('boostGpsH'), 'ghost'); } else { this.reachUntil = T + 20; this.alert('green', t('boostGpsU'), 'bolt'); }
          this.vibrate([80]);
        } else if (p === this.me) { this.alert('green', t('boostOn'), 'bolt'); this.vibrate([80]); }
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
    // прожектор: меня видно; болото: выносливость тает
    if (me.role === 'hider' && ph === 'hunt' && this.inZ('light', me)) me.exposedUntil = Math.max(me.exposedUntil || 0, T + 2.5);
    if (me.role === 'hider' && this.inZ('swamp', me)) { me.stamina = Math.max(0, me.stamina - 6 * dt); if (ph === 'hunt' && me.speed > 2.5) { me.exposedUntil = Math.max(me.exposedUntil || 0, T + 3); if (T - (this.splashAt || -99) > 15) { this.splashAt = T; this.alert('red', t('swampRun'), 'run'); } } }
    // тревога, маяк, аптечка — у себя
    if (ph === 'hunt') {
      if (me.role === 'hider') { const a = this.inZ('alarm', me); if (a && !me.inAlarm && T >= (me.alarmCd || 0)) { me.alarmCd = T + 30; me.exposedUntil = Math.max(me.exposedUntil || 0, T + 6); this.netSend('alarm', { n: me.name }); this.onAlarm(me.name, true); } me.inAlarm = a; }
      if (me.role === 'hunter') {
        const lh = this.objs.find((o) => o.k === 'lighthouse' && this.nearO(o, me, 'lighthouse') && T >= (this.radarCd[o.id] || 0));
        if (lh) { this.lhT = (this.lhT || 0) + dt; if (this.lhT >= 3) { this.lhT = 0; this.radarCd[lh.id] = T + 90; const hs = this.hiders().filter((h) => dist(h, lh) <= 100 && !this.jammed(h)); hs.forEach((h) => { h.exposedUntil = Math.max(h.exposedUntil || 0, T + 4); }); this.alert('blue', t('lhOn', { k: hs.length }), 'eye'); } } else this.lhT = 0;
      }
      // лечебная зона и эхо — у себя
      if (this.inZ('heal', me)) { me.stamina = Math.min(100, me.stamina + 20 * dt); if (T < me.frozenUntil) me.frozenUntil -= dt; if (T < (me.stunUntil || 0)) me.stunUntil -= dt; }
      if (this.inZ('echo', me) && (me.running || me.speed > 2.5) && T - (this.echoAt || -99) > 12) { this.echoAt = T; this.netSend('echo', { x: Math.round(me.x), y: Math.round(me.y), r: me.role }); this.alert('yellow', t('echoYou'), 'signal'); }
      const cp = this.objs.find((o) => o.k === 'compass' && this.nearO(o, me, 'compass') && T >= (this.radarCd[o.id] || 0));
      if (cp) {
        this.radarCd[cp.id] = T + 60;
        const foes = (me.role === 'hider' ? this.hunters() : this.hiders()).filter((q) => q !== me);
        const f = foes.sort((a, b) => dist(a, me) - dist(b, me))[0];
        if (f) { const ang = (Math.atan2(f.x - me.x, f.y - me.y) * 180 / Math.PI + 360) % 360; this.alert('blue', t('compassRes', { d: t('dir' + Math.round(ang / 45) % 8), m: Math.round(dist(f, me) / 10) * 10, who: t(me.role === 'hider' ? 'hunter' : 'hider') }), 'north'); this.vibrate([60]); }
      }
      const mk = this.objs.find((o) => o.k === 'medkit' && this.nearO(o, me, 'medkit') && T >= (this.boostCd['m' + o.id] || 0));
      if (mk && (this.isFrozen(me) || this.isStunned(me) || me.stamina < 60 || T < me.warnUntil)) { this.boostCd['m' + mk.id] = T + 45; me.frozenUntil = 0; me.warnUntil = 0; me.stunUntil = 0; me.stamina = 100; this.alert('green', t('medOn'), 'shield'); this.renderHud(true); }
    }
    // радар
    if (me.role === 'hider' && ph === 'hunt') {
      const r = this.objs.find((o) => o.k === 'radar' && this.nearO(o, me, 'radar') && T >= (this.radarCd[o.id] || 0));
      if (r) { this.radarT = (this.radarT || 0) + dt; if (this.radarT >= 4) { this.radarT = 0; this.radarCd[r.id] = T + 60; this.showHuntersUntil = Math.max(this.showHuntersUntil, T + 15); this.alert('blue', t('radarOn'), 'eye'); this.vibrate([60, 40, 60]); } }
      else this.radarT = 0;
    }
    // камеры: охотник видит прячущихся в обзоре; прячущегося предупреждаем
    if (ph === 'hunt') for (const o of this.objs) {
      if (o.k !== 'camera') continue;
      if (me.role === 'hunter') {
        const hits = this.hiders().filter((h) => this.nearO(h, o, 'camera') && !this.inBush(h) && !this.jammed(h));
        hits.forEach((h) => { h.exposedUntil = Math.max(h.exposedUntil || 0, T + 2); });
        if (hits.length && T - this.camSeen > 15) { this.camSeen = T; this.alert('blue', t('camSaw', { n: hits.map((h) => h.name).join(', ') }), 'eye'); }
      } else if (me.role === 'hider' && this.nearO(me, o, 'camera') && T - this.camSeen > 10) { this.camSeen = T; this.alert('red', t('camYou'), 'eye'); this.vibrate([120]); }
    }
    // сердцебиение: охотник ближе 35 м — телефон «стучит», чем ближе, тем чаще
    if (ph === 'hunt' && me.role === 'hider') {
      const d = Math.min(...this.hunters().map((u) => dist(u, me)), 1e9);
      if (d < 35 && T >= (this.beatAt || 0)) { this.beatAt = T + (d < 15 ? 1.2 : 2.5); this.vibrate([60, 90, 60]); if (!this.beatWarned) { this.beatWarned = true; this.alert('red', t('heartbeat'), 'signal'); } }
      if (d > 60) this.beatWarned = false;
    }
    if (ph !== 'hunt' || this.indoor() || this.ch.noout) { this.outLeft = null; return; }
    // зона выбывших: живым нельзя (в GPS — предупреждение, видно всем, через 15 с выбывание)
    if (this.graveZ.length && this.inGrave(me)) {
      if (this.graveSince == null) { this.graveSince = T; this.alert('red', t('graveNo'), 'target'); this.vibrate([300, 100, 300]); }
      me.exposedUntil = Math.max(me.exposedUntil || 0, T + 2);
      if (T - this.graveSince > 15) { this.graveSince = null; this.selfElim('grave'); return; }
    } else this.graveSince = null;
    // смертельная зона
    if (this.killZ.length && this.inKill(me) && this.gpsOk()) { this.killT = (this.killT || 0) + dt; if (!this.gps() || this.killT >= 2) { this.selfElim('kill'); return; } } else this.killT = 0;
    // вне зоны: 30 секунд или сразу, если слишком далеко
    if (me.outSince != null) {
      if (this.cfg.outLimit !== 0 && (me.outDist || 0) > this.farLimit && this.gpsOk()) { this.farT = (this.farT || 0) + dt; if (!this.gps() || this.farT >= 3) { this.selfElim('far'); return; } } else this.farT = 0;
      const lim = this.cfg.outLimit != null ? this.cfg.outLimit : OUT_LIMIT;
      if (!lim) { this.outLeft = null; return; }
      const left = lim - (T - Math.max(me.outSince, this.cfg.hideSec));
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
    if (me.role === 'hunter' && !this.ch.wall && p.role === 'hider' && this.t < (p.invisUntil || 0) && d > 8) return false;
    if (this.gmode === 'stalker' && me.role === 'hider' && p.role === 'hunter' && !this.ch.wall && this.phase() === 'hunt') return (this.t - this.cfg.hideSec) % 30 < 4 || d < 8;
    if (me.role === 'hunter' && !this.ch.wall && p.role === 'hider' && this.t < (this.fogUntil || 0) && d > 15) return false;
    if (!this.ch.wall && me.role !== 'spectator' && d > 20 && (this.foggy(me) || this.foggy(p))) return false;
    if (this.inZ('lookout', me) && d < 60 && p.role !== me.role && (p.role === 'hider' || p.role === 'hunter') && !this.hiddenInBush(p, d)) return true;
    return show;
  },
  /** Колокол: охотник рядом звонит — прячущиеся в 60 м слышат и видны 5 с. */
  ringBell(by) {
    const T = this.t;
    const b = this.objs.find((o) => o.k === 'bell' && this.nearO(o, by, 'bell') + 4 && T >= o.readyAt);
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
  bellNear() { return this.me.role === 'hunter' && this.phase() === 'hunt' && this.objs.some((o) => o.k === 'bell' && dist(o, this.me) <= this.objR('bell') + 4 && this.t >= o.readyAt); },
  /** Укрытие для бота-прячущегося рядом с охотником: безопасная зона или куст в 50 м. */
  botRefuge(p) {
    let best = null;
    for (const o of this.objs) if (o.k === 'bush') { const d = dist(o, p); if (d < 50 && (!best || d < best.d)) best = { d, x: o.x, y: o.y }; }
    for (const P of this.safeZ) { const c = this.polyCenter(P), d = dist(c, p); if (d < 60 && T0(p) && (!best || d < best.d)) best = { d, x: c.x, y: c.y }; }
    return best ? { x: best.x, y: best.y } : null;
  },

  // ---------- сеть ----------
  worldState() {
    return { ob: this.objs.map((o) => [o.id, o.k, o.x, o.y, Math.round(o.readyAt), o.pair || 0, o.f == null ? -1 : o.f]), sm: (this.smokes || []).map((s) => [Math.round(s.x), Math.round(s.y), Math.round(s.until)]), fk: (this.fakes || []).map((f) => [f.x, f.y, Math.round(f.until), f.name, f.c]), dd: this.players.map((p, i) => (p.role === 'dead' ? i : -1)).filter((i) => i >= 0), sf: this.players.map((p, i) => (p.safeOn ? i : -1)).filter((i) => i >= 0) };
  },
  worldApply(d) {
    if (!d) return;
    if (d.sm) this.smokes = d.sm.map(([x, y, until]) => ({ x, y, until }));
    if (d.fk) this.fakes = d.fk.map(([x, y, until, name, c]) => ({ x, y, until, name, c }));
    if (d.ob) this.objs = d.ob.map(([id, k, x, y, readyAt, pair, f]) => ({ id, k, x, y, readyAt, pair: pair || null, f: f == null || f < 0 ? null : f }));
    (d.dd || []).forEach((i) => { const p = this.players[i]; if (p && p.role !== 'dead' && !this.social()) this.eliminate(p, p.elim || 'out', true); });
    if (d.sf) this.players.forEach((p, i) => { if (p !== this.me) p.safeOn = d.sf.includes(i); });
  },
  onAlarm(n, mine) {
    if (mine) { this.alert('red', t('alarmYou'), 'signal'); this.vibrate([300, 100, 300]); }
    else if (this.me.role === 'hunter') this.alert('blue', t('alarmRang', { n }), 'signal');
  },
  /** Эмоция над своей меткой на 4 секунды (видят те, кто видит вас). */
  sendEmote(e) {
    this.me.emote = { e, until: this.t + 4 };
    this.netSend('emote', { e });
    if (this.meEmo) this.meEmo.remove();
    this.meEmo = L.marker(this.ll(this.me), { interactive: false, zIndexOffset: 1000, icon: L.divIcon({ className: '', iconSize: [40, 40], iconAnchor: [20, 46], html: `<div class="mk-emo me">${e}</div>` }) }).addTo(this.map);
    setTimeout(() => { if (this.meEmo) { this.meEmo.remove(); this.meEmo = null; } }, 4000);
  },
  /** События новых объектов (у всех). */
  onFx2(k, n, d) {
    const me = this.me;
    if (k === 'mirror') this.alert(me.role === 'hider' ? 'green' : 'blue', me.role === 'hider' ? t('mirrorH', { n }) : t('mirrorU'), 'copy');
    if (k === 'clock') this.alert(d < 0 ? (me.role === 'hider' ? 'green' : 'red') : (me.role === 'hunter' ? 'green' : 'red'), t(d < 0 ? 'clockH' : 'clockU', { n }), 'clock');
    if (k === 'clover') { const p = this.players.find((q) => q.id === d); if (p === me && this.isClient) me.shield = (me.shield || 0) + 1; this.alert(p === me ? 'green' : 'blue', p === me ? t('cloverYou') : t('cloverOther', { n }), 'shield'); }
    if (k === 'freezer') this.alert(me.role === 'hunter' ? 'green' : 'red', t('freezerOn', { n, k: d }), 'snow');
    if (k === 'target') { const p = this.players.find((q) => q.id === d); if (p === me) { me.exposedUntil = Math.max(me.exposedUntil || 0, this.t + 10); this.alert('red', t('targetYou'), 'target'); this.vibrate([300]); } else if (me.role === 'hunter') { if (p) p.exposedUntil = Math.max(p.exposedUntil || 0, this.t + 10); this.alert('green', t('targetOther', { n }), 'target'); } }
    this.renderHud(true);
  },
  onSnare(h) {
    if (h === this.me) { h.exposedUntil = Math.max(h.exposedUntil || 0, this.t + 8); this.alert('red', t('snareYou'), 'lock'); this.vibrate([400]); }
    else if (this.me.role === 'hunter') this.alert('green', t('snareOther', { n: h.name }), 'lock');
  },
  onRadio(n) {
    const T = this.t;
    for (const p of this.players) p.exposedUntil = Math.max(p.exposedUntil || 0, T + 4);
    this.showHuntersUntil = Math.max(this.showHuntersUntil, T + 4);
    this.alert('yellow', t('radioOn', { n }), 'signal'); this.vibrate([100, 50, 100]);
  },
  onSmoke(n) { this.alert(this.me.role === 'hider' ? 'green' : 'yellow', t('smokeUp', { n }), 'cloud'); },
  worldNet(type, d, from) {
    if (type === 'alarm') { const p = this.players.find((q) => q.id === from); if (p) p.exposedUntil = Math.max(p.exposedUntil || 0, this.t + 6); this.onAlarm(d.n, false); return true; }
    if (type === 'fx2' && this.isClient) { this.onFx2(d.k, d.n, d.d != null ? d.d : d.id); return true; }
    if (type === 'echo') { const me = this.me; if (d.r !== me.role && (me.role === 'hider' || me.role === 'hunter')) { const ang = (Math.atan2(d.x - me.x, d.y - me.y) * 180 / Math.PI + 360) % 360; this.alert('yellow', t('echoHeard', { d: t('dir' + Math.round(ang / 45) % 8), m: Math.round(Math.hypot(d.x - me.x, d.y - me.y) / 10) * 10 }), 'signal'); this.vibrate([80]); } return true; }
    if (type === 'emote') { const p = this.players.find((q) => q.id === from); if (p) p.emote = { e: String(d.e).slice(0, 4), until: this.t + 4 }; return true; }
    if (type === 'snared' && this.isClient) { const h = this.players.find((q) => q.id === d.id); if (h) this.onSnare(h); return true; }
    if (type === 'radio' && this.isClient) { this.onRadio(d.n); return true; }
    if (type === 'smokeup' && this.isClient) { this.onSmoke(d.n); return true; }
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
    const o = { id: 'o' + Math.random().toString(36).slice(2, 7), k, ...at, readyAt: 0, f: pos.f != null ? pos.f : this.flOf(pos) };
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
      for (const k of ZX_KINDS) this.zx[k].forEach((P) => pg(P, { color: ZX[k].col, weight: 2, fillColor: ZX[k].col, fillOpacity: ZX[k].op }));
      const lab = (P, ic) => L.marker(this.ll(this.polyCenter(P)), { interactive: false, icon: L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13], html: `<div class="mk-zone">${ic}${this.floorsOn() && P.f != null ? `<span class="fl-b">${P.f + 1}</span>` : ''}</div>` }) }).addTo(this.wzLayer);
      this.safeZ.forEach((P) => lab(P, '🛡')); this.killZ.forEach((P) => lab(P, '☠')); this.graveZ.forEach((P) => lab(P, '🪦'));
      for (const k of ZX_KINDS) this.zx[k].forEach((P) => lab(P, ZX[k].ic));
      if (this.floorsOn()) for (const w of this.walls) if (w.f != null) L.marker(this.ll(this.polyCenter(w.P)), { interactive: false, icon: L.divIcon({ className: '', iconSize: [20, 20], iconAnchor: [10, 10], html: `<span class="fl-b">${w.f + 1}</span>` }) }).addTo(this.wzLayer);
      this.objLayer = L.layerGroup().addTo(map); this.objSig = '';
    }
    const T = this.t, me = this.me;
    const vis = this.objs.filter((o) => !(o.k === 'mine' && me.role === 'hunter') && !(o.k === 'snare' && me.role === 'hider'));
    const sig = vis.map((o) => o.id + (T < o.readyAt ? 'w' : '')).join(',') + '|' + (this.smokes || []).filter((s) => T < s.until).map((s) => s.x + ',' + s.y).join(';') + '|' + (this.fakes || []).filter((f) => T < f.until).map((f) => f.x).join(';');
    if (sig !== this.objSig) {
      this.objSig = sig; this.objLayer.clearLayers();
      for (const o of vis) {
        const def = OBJ[o.k], wait = T < o.readyAt;
        if (o.k === 'bush' || o.k === 'camera') L.circle(this.ll(o), { radius: this.objR(o.k), color: def.col, weight: o.k === 'camera' ? 1 : 0, dashArray: '3 5', fillColor: def.col, fillOpacity: o.k === 'bush' ? 0.35 : 0.1, interactive: false }).addTo(this.objLayer);
        L.marker(this.ll(o), { interactive: false, icon: L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13], html: `<div class="mk-obj k-${o.k} ${wait ? 'wait' : ''}">${def.ic}${this.floorsOn() && o.f != null ? `<span class="fl-b">${o.f + 1}</span>` : ''}</div>` }) }).addTo(this.objLayer);
      }
      if (me.role === 'hunter') for (const f of (this.fakes || []).filter((q) => T < q.until)) L.marker(this.ll(f), { interactive: false, icon: L.divIcon({ className: '', iconSize: [20, 20], iconAnchor: [10, 10], html: `<div class="mk"><div class="mk-pl" style="background:${f.c || '#5fd38d'}"></div><div class="mk-name">${String(f.name).replace(/[<>&"]/g, '')}</div></div>` }) }).addTo(this.objLayer);
      for (const s of (this.smokes || []).filter((q) => T < q.until)) L.circle(this.ll(s), { radius: 25, color: '#b0b8c4', weight: 0, fillColor: '#c9d1dc', fillOpacity: 0.55, interactive: false }).addTo(this.objLayer);
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
    if (this.outLeft != null && me.role !== 'dead') out.push(`<div class="out-timer"><div class="ot-ic"><span id="outArrow" style="display:inline-block">⬆</span></div><div class="ot-tx"><b>${t('outBack')}</b><span>${t('outRule')} · <b id="outDist"></b></span></div><div class="ot-num" id="outT">0:${String(Math.max(0, Math.ceil(this.outLeft))).padStart(2, '0')}</div></div>`);
    if (me.role === 'dead' && !this.social()) out.push(`<div class="banner red"><div class="bi">☠</div><div>${t('elimYou', { r: t('elim_' + (me.elim || 'out')) })}${this.graveZ.length ? `<br><b>🪦 ${t('graveGo')} · <span id="graveD"></span></b>` : ''}</div></div>`);
    if (me.role === 'hider' && me.safeOn) out.push(`<div class="banner blue"><div class="bi">🛡</div><div>${t('safeOn', { s: Math.max(0, Math.ceil(SAFE_MAX - (this.t - (me.safeSince != null ? me.safeSince : this.t)))) })}</div></div>`);
    const zin = ZX_KINDS.filter((k) => this.inZ(k, me));
    for (const k of zin) out.push(`<div class="banner ${k === 'light' ? 'red' : k === 'swamp' ? 'yellow' : 'blue'}"><div class="bi">${ZX[k].ic}</div><div>${t('zoneIn_' + k)}</div></div>`);
    if (me.role === 'hider' && this.inBush(me)) out.push(`<div class="banner green"><div class="bi">🌳</div><div>${t('bushOn')}</div></div>`);
    return out.join('');
  },
  worldButtons() {
    const me = this.me;
    if (me.role === 'dead' && !this.social()) return `<div class="ab" style="cursor:default">☠<span class="t">${t('deadT')}</span><span class="s">${t('deadS')}</span></div>`;
    if (this.bellNear()) return `<button class="ab" data-a="bell" style="color:#ff9f43">🔔<span class="t">${t('bell')}</span><span class="s">${t('ready')}</span></button>`;
    return '';
  },
  worldSig() { const me = this.me; return [ZX_KINDS.filter((k) => this.inZ(k, me)).join('+'), this.outLeft != null, me.safeOn ? 1 : 0, me.role === 'hider' && this.inBush(me), this.bellNear()].join(''); },
};
const T0 = (p) => p.role === 'hider';
