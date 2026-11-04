// Дополнения движка: стены (здания и барьеры), блуждающая зона, дрон охотника, телеметрия
// (высота, скорость, батарея), бонусы «щит», «оглушение», «ловушка», режимы «Слепые прятки» и «В помещении».
import { t } from './i18n.js';
import { beep, playFx } from './sound.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const CELL = 40;                       // ячейка сетки стен, м
const DRONE_SPEED = 3, DRONE_R = 25, DRONE_SCAN = 2, DRONE_LIFE = 60, DRONE_CD = 60;
const TRAP_R = 8, STUN_R = 40, STUN_S = 8, TRAP_STUN = 6;
const inPoly = (x, y, P) => { let ins = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i].y > y) !== (P[j].y > y) && x < (P[j].x - P[i].x) * (y - P[i].y) / (P[j].y - P[i].y) + P[i].x) ins = !ins; return ins; };

export const extrasMixin = {
  /** Стены строим до расстановки игроков и предметов. */
  wallsInit() {
    const cfg = this.cfg;
    // стены: здания из OpenStreetMap + барьеры из редактора; сетка для быстрых проверок
    this.walls = (cfg.walls || []).filter((w) => w.length >= 3).map((w) => {
      const P = w.map((q) => this.xy(q[0] != null ? q[0] : q.lat, q[1] != null ? q[1] : q.lng));
      return { P, x0: Math.min(...P.map((q) => q.x)), x1: Math.max(...P.map((q) => q.x)), y0: Math.min(...P.map((q) => q.y)), y1: Math.max(...P.map((q) => q.y)) };
    });
    this.wallGrid = new Map();
    this.walls.forEach((w, i) => {
      for (let gx = Math.floor(w.x0 / CELL); gx <= Math.floor(w.x1 / CELL); gx++) for (let gy = Math.floor(w.y0 / CELL); gy <= Math.floor(w.y1 / CELL); gy++) {
        const k = gx + ',' + gy; if (!this.wallGrid.has(k)) this.wallGrid.set(k, []); this.wallGrid.get(k).push(i);
      }
    });
  },
  extrasInit() {
    const cfg = this.cfg;
    this.zcTarget = null;
    this.drone = null; this.droneReadyAt = 0; this.droneCtl = false;
    this.traps = []; this.tel = []; this.lastTelT = -10; this.battery = null;
    if (navigator.getBattery) navigator.getBattery().then((b) => { this.batteryObj = b; }).catch(() => {});
    if (this.gmode === 'indoor') { this.nextMissionAt = Infinity; this.hasPowerups = false; this.supplies = []; this.noiseReadyAt = 0; this.hasFreeze = false; this.botIndoorAt = (cfg.hideSec || 0) + 45 + Math.random() * 45; }
  },

  // ---------- стены ----------
  inWall(p) {
    if (!this.walls.length) return false;
    const ids = this.wallGrid.get(Math.floor(p.x / CELL) + ',' + Math.floor(p.y / CELL));
    if (!ids) return false;
    for (const i of ids) { const w = this.walls[i]; if (p.x >= w.x0 && p.x <= w.x1 && p.y >= w.y0 && p.y <= w.y1 && inPoly(p.x, p.y, w.P)) return true; }
    return false;
  },
  /** Шаг с учётом стен: если впереди стена — скользим вдоль неё, иначе стоим. */
  tryMove(p, nx, ny) {
    const B = (q) => this.blockedFor(p, q);
    if ((!this.walls.length && !this.killZ.length && !this.graveZ.length) || !B({ x: nx, y: ny }) || B(p)) { this.moveTo(p, nx, ny); return true; }
    if (!B({ x: nx, y: p.y })) { this.moveTo(p, nx, p.y); return true; }
    if (!B({ x: p.x, y: ny })) { this.moveTo(p, p.x, ny); return true; }
    p.target = null; p.running = false;   // упёрлись — бот выберет новую цель
    return false;
  },

  // ---------- блуждающая зона ----------
  driftStep(dt) {
    if (!this.cfg.drift || this.phase() !== 'hunt') return;
    if (!this.zcTarget || dist(this.zc, this.zcTarget) < 2) {
      const a = Math.random() * 6.28, r = this.R * (0.15 + Math.random() * 0.3);
      this.zcTarget = { x: Math.cos(a) * r, y: Math.sin(a) * r };
    }
    const d = dist(this.zc, this.zcTarget), s = Math.min(d, 1.2 * dt * (this.pace || 1));
    this.zc = { x: this.zc.x + (this.zcTarget.x - this.zc.x) / d * s, y: this.zc.y + (this.zcTarget.y - this.zc.y) / d * s };
  },

  // ---------- дрон ----------
  droneAvailable() { return this.cfg.drone && this.me.role === 'hunter' && this.phase() === 'hunt' && this.gmode !== 'indoor'; },
  droneToggle() {
    if (!this.droneAvailable()) return;
    if (this.drone && this.drone.owner === this.me.id) { this.droneCtl = !this.droneCtl; this.renderHud(true); return; }
    if (this.t < this.droneReadyAt) return;
    this.drone = { owner: this.me.id, x: this.me.x, y: this.me.y, target: null, until: this.t + DRONE_LIFE, nextScan: this.t + DRONE_SCAN };
    this.droneCtl = true;
    this.alert('blue', t('droneUp'), 'eye');
    this.renderHud(true);
  },
  droneStep(dt) {
    const d = this.drone;
    if (!d || d.owner !== this.me.id) return;
    if (this.t >= d.until || this.me.role !== 'hunter') { this.drone = null; this.droneCtl = false; this.droneReadyAt = this.t + DRONE_CD; this.alert('blue', t('droneDown'), 'eye'); this.renderHud(true); return; }
    if (d.target) {
      const dd = dist(d, d.target), s = Math.min(dd, DRONE_SPEED * dt * (this.pace || 1));
      if (dd > 0.5) { d.x += (d.target.x - d.x) / dd * s; d.y += (d.target.y - d.y) / dd * s; } else d.target = null;
    }
    if (this.t >= d.nextScan) {
      d.nextScan = this.t + DRONE_SCAN;
      const hits = this.hiders().filter((h) => !this.jammed(h) && dist(h, d) <= DRONE_R && !(h.shieldDrone));
      if (hits.length) {
        hits.forEach((h) => { h.exposedUntil = Math.max(h.exposedUntil || 0, this.t + 3); });
        this.alert('blue', t('droneHit', { n: hits.map((h) => h.name).join(', ') }), 'eye');
        this.netSend('dronehit', { ids: hits.map((h) => h.id) });
      }
    }
  },

  // ---------- бонусы щит / оглушение / ловушка ----------
  extraPower(p, id) {
    const T = this.t;
    if (id === 'shield') { p.shield = (p.shield || 0) + 1; return true; }
    if (id === 'stun') {
      if (this.isClient && p === this.me) return true;   // оглушение решает организатор
      const hit = this.hunters().filter((u) => dist(u, p) <= STUN_R);
      hit.forEach((u) => { u.stunUntil = T + STUN_S; u.target = null; });
      if (!this.isClient) this.netSend('stun', { ids: hit.map((u) => u.id), until: T + STUN_S, by: p.name });
      this.onStun(hit.map((u) => u.id), T + STUN_S, p.name);
      return true;
    }
    if (id === 'trap') {
      if (this.isClient && p === this.me) return true;   // ловушку ставит организатор по сообщению 'power'
      const tr = { id: 'tr' + Math.random().toString(36).slice(2, 7), x: p.x, y: p.y, owner: p.id };
      this.traps.push(tr);
      if (p === this.me) this.alert('green', t('trapSet'), 'lock');
      return true;
    }
    return false;
  },
  onStun(ids, until, by) {
    const me = this.me;
    ids.forEach((id) => { const u = this.players.find((q) => q.id === id); if (u) { u.stunUntil = until; u.target = null; } });
    if (ids.includes(me.id)) { this.alert('red', t('stunYou', { n: by }), 'bolt'); this.vibrate([300, 100, 300]); }
    else if (ids.length) this.alert(me.role === 'hider' ? 'green' : 'yellow', t('stunOther', { k: ids.length, n: by }), 'bolt');
  },
  isStunned(p) { return this.t < (p.stunUntil || 0); },
  trapStep() {
    if (!this.traps.length) return;
    for (const tr of [...this.traps]) {
      const u = this.hunters().find((q) => dist(q, tr) <= TRAP_R && !this.isStunned(q));
      if (!u) continue;
      this.traps = this.traps.filter((x) => x !== tr);
      this.netSend('stun', { ids: [u.id], until: this.t + TRAP_STUN, by: '🪤', trap: tr.id });
      this.onStun([u.id], this.t + TRAP_STUN, '🪤');
    }
  },

  /** Перед поимкой: щит, оглушённый охотник. true — поимка не состоялась. */
  preCatchExtras(hunter, h) {
    if (this.isStunned(hunter)) { if (hunter === this.me) this.alert('red', t('stunNoCatch'), 'bolt'); return true; }
    if (h.shield > 0) {
      h.shield--;
      if (!this.isClient) this.netSend('shieldhit', { h: h.id, a: hunter.id });
      this.onShield(hunter, h);
      return true;
    }
    return false;
  },
  onShield(hunter, h) {
    if (h === this.me) this.alert('green', t('shieldSaved', { n: hunter.name }), 'shield');
    else if (hunter === this.me) this.alert('red', t('shieldBlocked', { n: h.name }), 'shield');
    hunter.stunUntil = this.t + 3;
  },

  // ---------- телеметрия: высота, скорость, батарея ----------
  telStep() {
    if (this.t - this.lastTelT < 5) return;
    this.lastTelT = this.t;
    const b = window.MapTagNative && window.MapTagNative.battery ? Number(window.MapTagNative.battery()) : this.batteryObj ? Math.round(this.batteryObj.level * 100) : null;
    this.tel.push([Math.round(this.t), this.lastAlt != null ? Math.round(this.lastAlt) : null, Math.round((this.me.speed || 0) * 36) / 10, b != null && b >= 0 ? b : null]);
    if (this.tel.length > 1500) this.tel.shift();
  },

  // ---------- «В помещении» ----------
  indoor() { return this.gmode === 'indoor'; },
  noise() {
    if (!this.indoor() || this.me.role !== 'hunter' || this.t < this.noiseReadyAt || this.phase() !== 'hunt') return;
    this.noiseReadyAt = this.t + 40;
    this.netSend('noise', { by: this.me.name });
    this.alert('blue', t('noiseSent'), 'signal');
    this.renderHud(true);
  },
  onNoise(by) {
    if (this.me.role !== 'hider') return;
    this.alert('red', t('noiseYou', { n: by }), 'signal');
    [0, 500, 1000, 1500, 2000, 2500].forEach((d) => setTimeout(() => playFx('horn'), d));
    this.vibrate([600, 200, 600]);
  },
  indoorBotStep() {
    // офлайн: бот-охотник «находит» кого-то раз в 45–90 с
    if (!this.indoor() || this.isClient || this.phase() !== 'hunt' || this.t < this.botIndoorAt) return;
    this.botIndoorAt = this.t + 45 + Math.random() * 45;
    const u = this.hunters().find((x) => x.bot); const pool = this.hiders().filter((h) => !(h === this.me && this.ch.untouch) && !h.remote);
    if (u && pool.length) this.catchPlayer(u, pool[Math.floor(Math.random() * pool.length)]);
  },
  indoorPanel() {
    if (!this.indoor()) return '';
    const me = this.me, alive = this.hiders().length, hunters = this.hunters().length;
    let plan = '';
    if (this.poly) { const P = this.poly, x0 = Math.min(...P.map((q) => q.x)), x1 = Math.max(...P.map((q) => q.x)), y0 = Math.min(...P.map((q) => q.y)), y1 = Math.max(...P.map((q) => q.y)), s = 200 / Math.max(1, x1 - x0, y1 - y0); plan = `<svg class="bld-plan" viewBox="-10 -10 ${(x1 - x0) * s + 20} ${(y1 - y0) * s + 20}"><polygon points="${P.map((q) => `${((q.x - x0) * s).toFixed(1)},${((y1 - q.y) * s).toFixed(1)}`).join(' ')}"/></svg><div class="bld-name">${this.cfg.buildingName ? this.cfg.buildingName.replace(/[<>&"]/g, '') : ''} · ${Math.round(x1 - x0)}×${Math.round(y1 - y0)} ${t('m')}</div>`; }
    return `<div class="indoor">${plan || '<div class="ic">🏠</div>'}<h2>${t('gm_indoor')}</h2><p>${t('indoorHint')}</p>${this.roomsHtml()}
      <div class="duo" style="margin-top:12px"><div class="tile"><div class="v" style="color:var(--hider)">${alive}</div><div class="l">${t('hidersPl')}</div></div><div class="tile"><div class="v" style="color:var(--hunter)">${hunters}</div><div class="l">${t('huntersPl')}</div></div></div>
      <div class="role-big ${me.role}">${t(me.role)}</div></div>`;
  },

  // ---------- шаги ----------
  extrasStep(dt) {   // организатор / офлайн
    this.driftStep(dt);
    if (this.phase() === 'hunt') { this.trapStep(); this.indoorBotStep(); }
  },
  extrasLocal(dt) {  // каждый телефон
    this.droneStep(dt);
    this.telStep();
  },

  // ---------- видимость ----------
  visExtras(p, show) {
    if (this.gmode === 'blind' && this.me.role === 'hider') return false;   // «Слепые прятки»: прячущиеся не видят никого
    return show;
  },

  // ---------- сеть ----------
  extrasState() { return { zc: [Math.round(this.zc.x), Math.round(this.zc.y)], trp: this.traps.map((q) => [q.id, Math.round(q.x), Math.round(q.y), q.owner]) }; },
  extrasApply(d) {
    if (d.zc) this.zc = { x: d.zc[0], y: d.zc[1] };
    if (d.trp) this.traps = d.trp.map(([id, x, y, owner]) => ({ id, x, y, owner }));
  },
  extrasNet(type, d, from) {
    if (type === 'dronehit') { for (const id of d.ids) { const h = this.players.find((q) => q.id === id); if (h) h.exposedUntil = Math.max(h.exposedUntil || 0, this.t + 3); } if (d.ids.includes(this.me.id)) { this.alert('red', t('droneYou'), 'eye'); this.vibrate([200]); } return true; }
    if (type === 'drone') { const p = this.players.find((q) => q.id === from); if (p) p.droneAt = d.x == null ? null : { x: d.x, y: d.y }; return true; }
    if (type === 'stun' && this.isClient) { if (d.trap) this.traps = this.traps.filter((x) => x.id !== d.trap); this.onStun(d.ids, d.until, d.by); return true; }
    if (type === 'shieldhit' && this.isClient) { const h = this.players.find((q) => q.id === d.h), a = this.players.find((q) => q.id === d.a); if (h && a) { if (h === this.me) h.shield = Math.max(0, (h.shield || 0) - 1); this.onShield(a, h); } return true; }
    if (type === 'noise') { this.onNoise(d.by); return true; }
    return false;
  },

  // ---------- отрисовка ----------
  extrasRender() {
    const map = this.map;
    if (!this.exLayer) {
      this.exLayer = L.layerGroup().addTo(map);
      if (this.walls.length) {
        const wl = L.layerGroup().addTo(map);
        for (const w of this.walls.slice(0, 3000)) L.polygon(w.P.map((q) => this.ll(q)), { color: '#7a5a3a', weight: 1, fillColor: '#8b6b4a', fillOpacity: 0.35, interactive: false }).addTo(wl);
      }
      this.dynLayer = L.layerGroup().addTo(map);
    }
    // зона смещается
    if (!this.poly && this.zoneLayer.setLatLng) this.zoneLayer.setLatLng(this.ll(this.zc));
    // дроны и ловушки
    this.dynLayer.clearLayers();
    const drones = [];
    if (this.drone) drones.push(this.drone);
    for (const p of this.players) if (p !== this.me && p.droneAt) drones.push(p.droneAt);
    for (const d of drones) {
      L.circle(this.ll(d), { radius: DRONE_R, color: '#6fb7ff', weight: 2, dashArray: '4 4', fillColor: '#6fb7ff', fillOpacity: 0.12, interactive: false }).addTo(this.dynLayer);
      L.marker(this.ll(d), { interactive: false, icon: L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15], html: '<div class="mk-drone">🛸</div>' }) }).addTo(this.dynLayer);
    }
    if (this.me.role !== 'hunter') for (const tr of this.traps) L.marker(this.ll(tr), { interactive: false, icon: L.divIcon({ className: '', iconSize: [22, 22], iconAnchor: [11, 11], html: '<div class="mk-trap">🪤</div>' }) }).addTo(this.dynLayer);
    // своя позиция дрона — по сети раз в секунду
    if (this.net && this.drone && this.drone.owner === this.me.id && this.t - (this.lastDroneSend || -9) >= 1) { this.lastDroneSend = this.t; this.netSend('drone', { x: Math.round(this.drone.x), y: Math.round(this.drone.y) }); }
    if (this.net && !this.drone && this.droneWasUp) this.netSend('drone', { x: null });
    this.droneWasUp = !!this.drone;
    // панель «В помещении» закрывает карту
    if (this.indoor()) {
      let el = this.root.querySelector('.indoor-cover');
      if (!el) { el = document.createElement('div'); el.className = 'indoor-cover'; this.root.querySelector('#game').insertBefore(el, this.root.querySelector('.hud-top')); }
      const html = this.indoorPanel(); if (el._html !== html) { el._html = html; el.innerHTML = html; }
      this.bindIndoor(el);
    }
  },
  /** Дополнительные кнопки в нижней панели. */
  extraButtons() {
    const me = this.me, out = [];
    if (this.droneAvailable()) {
      const mine = this.drone && this.drone.owner === me.id;
      const s = mine ? (this.droneCtl ? t('droneCtl') : t('droneWalk')) : this.t < this.droneReadyAt ? Math.ceil(this.droneReadyAt - this.t) + ' ' + t('sec') : t('ready');
      out.push(`<button class="ab ${mine && this.droneCtl ? 'run on' : ''}" data-a="drone" style="color:#6fb7ff">🛸<span class="t">${t('drone')}</span><span class="s">${s}</span></button>`);
    }
    if (this.indoor() && me.role === 'hunter') {
      const ok = this.t >= this.noiseReadyAt && this.phase() === 'hunt';
      out.push(`<button class="ab ${ok ? '' : 'wait'}" data-a="noise" style="color:var(--gold)">📢<span class="t">${t('noise')}</span><span class="s">${ok ? t('ready') : Math.ceil(this.noiseReadyAt - this.t) + ' ' + t('sec')}</span></button>`);
    }
    return out.join('');
  },
  extrasBanner() {
    const me = this.me, out = [];
    if (this.isStunned(me)) out.push(`<div class="frozen warn"><div><div class="t1">${t('stunT')}</div><div class="t2">${t('stunS')}</div></div><div class="num">${Math.ceil(me.stunUntil - this.t)}</div></div>`);
    if (me.shield > 0) out.push(`<div class="banner green"><div class="bi">🛡</div><div>${t('shieldOn', { k: me.shield })}</div></div>`);
    return out.join('');
  },
};
