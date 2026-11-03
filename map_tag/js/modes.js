// Режимы игры и элементы своей карты.
//  • classic  — пойманный становится охотником;
//  • jail     — «Тюрьма»: пойманный сидит в тюрьме, свободный прячущийся выручает всех, простояв 8 с у тюрьмы;
//  • treasure — «Кладоискатели»: прячущиеся побеждают, если соберут все сокровища;
//  • blitz    — «Блиц»: короткая игра с быстрыми способностями (настраивается в лобби).
// Карта из редактора: запретные зоны, свои точки тайников, заданий, тюрьмы и сокровищ.
import { t } from './i18n.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const RESCUE_R = 25, RESCUE_NEED = 8, TREASURE_R = 15;
const inPoly = (x, y, P) => { let ins = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i].y > y) !== (P[j].y > y) && x < (P[j].x - P[i].x) * (y - P[i].y) / (P[j].y - P[i].y) + P[i].x) ins = !ins; return ins; };

export const modesMixin = {
  modesInit() {
    const cfg = this.cfg, pts = cfg.points || {};
    this.gmode = cfg.gmode || 'classic';
    this.nogo = (cfg.nogo || []).filter((z) => z.length >= 3).map((z) => z.map((q) => this.xy(q.lat, q.lng)));
    this.ptSupply = (pts.supply || []).map((q) => this.xy(q.lat, q.lng));
    this.ptMission = (pts.mission || []).map((q) => this.xy(q.lat, q.lng));
    // без точки из редактора тюрьма — у северного края зоны (у всех одинаково), а не в центре, где все стартуют
    this.jail = this.gmode === 'jail' ? (pts.jail ? this.xy(pts.jail.lat, pts.jail.lng) : { x: 0, y: this.R * (this.poly ? 0.45 : 0.65) }) : null;
    this.rescue = 0;
    this.treasures = [];
    this.treasureGot = 0;
    if (this.gmode === 'treasure') {
      this.nextMissionAt = Infinity;
      if (!this.isClient) {
        const list = (pts.treasure || []).map((q) => this.xy(q.lat, q.lng));
        const n = list.length || Math.max(4, Math.min(10, Math.round(this.R / 80)));
        for (let i = 0; i < n; i++) { const p = list[i] || this.randZone(0.85, 0.2); this.treasures.push({ id: 't' + i, x: p.x, y: p.y }); }
      }
      this.treasureNeed = (pts.treasure || []).length || Math.max(4, Math.min(10, Math.round(this.R / 80)));
    }
  },
  inNogo(p) { return this.nogo && this.nogo.some((z) => inPoly(p.x, p.y, z)); },
  /** Случайная точка из списка редактора (или null). */
  pickPoint(list, avoid = []) {
    if (!list || !list.length) return null;
    const free = list.filter((q) => !avoid.some((a) => dist(a, q) < 5));
    const pool = free.length ? free : list;
    return { ...pool[Math.floor(Math.random() * pool.length)] };
  },

  // ---------- шаг (организатор / офлайн) ----------
  modesStep(dt) {
    if (this.phase() !== 'hunt') return;
    if (this.gmode === 'jail') {
      const jailed = this.players.filter((p) => p.jailed);
      if (!jailed.length) { this.rescue = 0; return; }
      const savers = this.hiders().filter((h) => dist(h, this.jail) <= RESCUE_R);
      if (savers.length) {
        if (!this.rescue) { this.netSend('rescuing', {}); this.modesNet('rescuing', {}); }
        this.rescue += dt;
        if (this.rescue >= RESCUE_NEED) { this.freeAll(savers[0]); this.netSend('freed', { by: savers[0].id }); }
      } else this.rescue = Math.max(0, this.rescue - dt * 2);
    }
    if (this.gmode === 'sardines' && this.hunters().length <= 1 && this.players.length > 2) { this.finish('hiders'); return; }
    if (this.gmode === 'treasure') {
      for (const tr of [...this.treasures]) {
        const h = this.hiders().find((p) => dist(p, tr) <= TREASURE_R);
        if (!h) continue;
        this.treasures = this.treasures.filter((x) => x !== tr);
        this.treasureGot++;
        this.netSend('tpick', { id: tr.id, by: h.id });
        this.onTreasure(h);
      }
      if (this.treasureGot >= this.treasureNeed) { this.finish('hiders'); }
    }
  },
  onTreasure(h) {
    if (h === this.me) { this.stats.treasures = (this.stats.treasures || 0) + 1; this.alert('green', t('trYou', { a: this.treasureGot, b: this.treasureNeed }), 'diamond'); }
    else this.alert(this.me.role === 'hider' ? 'green' : 'red', t('trOther', { n: h.name, a: this.treasureGot, b: this.treasureNeed }), 'diamond');
    this.vibrate([80]);
  },
  freeAll(by) {
    const freed = this.players.filter((p) => p.jailed);
    for (const p of freed) { p.jailed = false; p.role = 'hider'; p.exposedUntil = 0; if (p.sim) { const a = Math.random() * 6.28; p.x = this.jail.x + Math.cos(a) * 40; p.y = this.jail.y + Math.sin(a) * 40; p.target = null; } }
    this.rescue = 0;
    if (freed.includes(this.me)) this.alert('green', t('jailFreedYou', { n: by.name }), 'shield');
    else this.alert(this.me.role === 'hider' ? 'green' : 'red', t('jailFreed', { n: by.name, k: freed.length }), 'shield');
    this.events.push({ k: 'fr', t: Math.round(this.t), n: freed.length });
    this.renderHud(true);
  },
  /** Поимка в особых режимах. Возвращает true, если обработано. */
  jailCatch(hunter, h) {
    if (this.gmode === 'sardines') {
      // нашедший сам становится «сардинкой» и прячется вместе
      hunter.role = 'hider'; hunter.target = null; hunter.sardine = true;
      if (hunter === this.me) this.alert('green', t('sardYou'), 'users');
      else this.alert(this.me.role === 'hider' ? 'green' : 'yellow', t('sardOther', { n: hunter.name, k: this.hunters().length }), 'users');
      this.renderHud(true);
      return true;
    }
    if (this.gmode !== 'jail') return false;
    h.jailed = true; h.running = false; h.target = null; h.holdMission = false; h.frozenUntil = 0; h.warnUntil = 0;
    if (h.sim && (h.bot || this.cfg.mode === 'demo')) { h.x = this.jail.x + (Math.random() - 0.5) * 10; h.y = this.jail.y + (Math.random() - 0.5) * 10; }
    if (h === this.me) this.alert('red', t('jailYou'), 'lock');
    return true;
  },

  // ---------- для каждого телефона ----------
  modesLocal(dt) {
    const me = this.me;
    if (this.nogo.length && this.phase() !== 'end') {
      const inside = this.inNogo(me);
      if (inside) {
        if (me.nogoSince == null) { me.nogoSince = this.t; this.alert('red', t('nogoIn'), 'lock'); this.vibrate([200, 100, 200]); }
        if (me.role === 'hider' && this.t - me.nogoSince > 10) { me.exposedUntil = Math.max(me.exposedUntil, this.t + 10); }
      } else me.nogoSince = null;
    }
  },

  /** Цель бота с учётом режима (или null). */
  modeBotTarget(p) {
    if (this.phase() !== 'hunt') return null;
    if (this.gmode === 'sardines' && p.role === 'hider' && p.sardine) {
      const first = this.players.find((q) => q.role === 'hider' && !q.sardine);
      if (first) return { x: first.x + (Math.random() - 0.5) * 8, y: first.y + (Math.random() - 0.5) * 8 };
    }
    if (this.gmode === 'jail' && p.role === 'hider' && this.players.some((q) => q.jailed)) {
      const nearestHunter = Math.min(...this.hunters().map((u) => dist(u, this.jail)), 9999);
      if (nearestHunter > 60 && Math.random() < 0.5) return { x: this.jail.x, y: this.jail.y };
    }
    if (this.gmode === 'jail' && p.role === 'hunter' && this.players.some((q) => q.jailed) && Math.random() < 0.3) return { x: this.jail.x + (Math.random() - 0.5) * 60, y: this.jail.y + (Math.random() - 0.5) * 60 };
    if (this.gmode === 'treasure' && p.role === 'hider' && this.treasures.length) {
      const tr = this.treasures.slice().sort((a, b) => dist(a, p) - dist(b, p))[0];
      if (tr && Math.random() < 0.55) return { x: tr.x, y: tr.y };
    }
    return null;
  },

  // ---------- сеть ----------
  modesState() {
    return { jl: this.players.map((p) => (p.jailed ? 1 : 0)).join(''), rs: Math.round(this.rescue * 10) / 10, tr: this.treasures.map((q) => [q.id, Math.round(q.x), Math.round(q.y)]), tg: this.treasureGot };
  },
  modesApply(d) {
    if (d.jl != null) [...d.jl].forEach((c, i) => { const p = this.players[i]; if (p) p.jailed = c === '1'; });
    if (d.rs != null) this.rescue = d.rs;
    if (d.tr) this.treasures = d.tr.map(([id, x, y]) => ({ id, x, y }));
    if (d.tg != null) this.treasureGot = d.tg;
  },
  modesNet(type, d) {
    const P = (id) => this.players.find((p) => p.id === id);
    if (type === 'tpick') { this.treasures = this.treasures.filter((x) => x.id !== d.id); this.treasureGot++; const h = P(d.by); if (h) this.onTreasure(h); return true; }
    if (type === 'freed') { const h = P(d.by); this.freeAll(h || { name: '?' }); return true; }
    if (type === 'rescuing') { if (this.me.role === 'hunter') this.alert('yellow', t('jailRescuing'), 'lock'); else if (this.me.jailed) this.alert('green', t('jailRescuingYou'), 'lock'); return true; }
    return false;
  },

  // ---------- отрисовка ----------
  modesRender() {
    const map = this.map;
    if (!this.modeLayer) {
      this.modeLayer = L.layerGroup().addTo(map);
      for (const z of this.nogo) L.polygon(z.map((q) => this.ll(q)), { color: '#d63a4a', weight: 2, fillColor: '#d63a4a', fillOpacity: 0.22, dashArray: '4 6', interactive: false }).addTo(this.modeLayer);
      if (this.jail) {
        this.jailCircle = L.circle(this.ll(this.jail), { radius: RESCUE_R, color: '#8fa0c0', weight: 3, fillColor: '#8fa0c0', fillOpacity: 0.15, interactive: false }).addTo(this.modeLayer);
        this.jailMark = L.marker(this.ll(this.jail), { interactive: false, icon: L.divIcon({ className: '', iconSize: [34, 34], iconAnchor: [17, 17], html: '<div class="mk-jail">⛓</div>' }) }).addTo(this.modeLayer);
      }
      this.trLayer = L.layerGroup().addTo(map);
    }
    const key = this.treasures.map((q) => q.id).join(',');
    if (key !== this.trKey) {
      this.trKey = key; this.trLayer.clearLayers();
      for (const q of this.treasures) L.marker(this.ll(q), { interactive: false, icon: L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13], html: '<div class="mk-tr">🪙</div>' }) }).addTo(this.trLayer);
    }
    if (this.jailCircle) {
      const n = this.players.filter((p) => p.jailed).length;
      const html = `<div class="mk-jail">${n ? '⛓ ' + n : '⛓'}${this.rescue > 0 ? `<b>${Math.ceil(RESCUE_NEED - this.rescue)}</b>` : ''}</div>`;
      if (html !== this.jailHtml) { this.jailHtml = html; this.jailMark.setIcon(L.divIcon({ className: '', iconSize: [34, 34], iconAnchor: [17, 17], html })); }
    }
  },
  /** Ячейка «задание» в верхней панели для режимов. */
  modesCell() {
    if (this.gmode === 'treasure') return { k: t('trCell'), v: `${this.treasureGot}/${this.treasureNeed}` };
    if (this.gmode === 'jail') { const n = this.players.filter((p) => p.jailed).length; return n ? { k: t('jailCell'), v: String(n) } : null; }
    if (this.gmode === 'sardines') return { k: t('sardCell'), v: String(this.hunters().length) };
    return null;
  },
  modesBanner() {
    if (this.gmode === 'jail' && this.me.jailed) return `<div class="frozen"><div><div class="t1">${t('jailT')}</div><div class="t2">${t('jailS')}</div></div><div class="num">⛓</div></div>`;
    return '';
  },
};
