// Режимы игры и элементы своей карты.
//  • classic  — пойманный становится охотником;
//  • jail     — «Тюрьма»: пойманный сидит в тюрьме, свободный прячущийся выручает всех, простояв 8 с у тюрьмы;
//  • treasure — «Кладоискатели»: прячущиеся побеждают, если соберут все сокровища;
//  • blitz    — «Блиц»: короткая игра с быстрыми способностями (настраивается в лобби).
// Карта из редактора: запретные зоны, свои точки тайников, заданий, тюрьмы и сокровищ.
import { t } from './i18n.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const RESCUE_R = 25, RESCUE_NEED = 8, TREASURE_R = 15, HILL_R = 30;
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
    // VIP — первый прячущийся по порядку списка (одинаково у всех телефонов)
    this.vipId = this.gmode === 'vip' ? ((this.players.find((p) => p.role === 'hider') || {}).id || null) : null;
    this.fuse = Math.round(Math.max(90, Math.min(180, (cfg.huntSec || 1200) * 0.15)));
    this.fuseEnd = this.gmode === 'bomb' ? (cfg.hideSec || 0) + this.fuse : Infinity;
    if (this.gmode === 'predator') { this.revealCd = Math.round(this.revealCd * 0.5); this.freezeCd = Math.round(this.freezeCd * 0.6); }
    this.royaleStage = 0;
    this.hill = this.gmode === 'hill' ? (pts.hill ? this.xy(pts.hill.lat, pts.hill.lng) : { x: 0, y: 0 }) : null;
    this.hillProg = 0; this.hillNeed = Math.round(Math.min(180, Math.max(60, (cfg.huntSec || 1200) * 0.2)));
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
    if (this.cfg.chaos) {
      if (this.nextChaos == null) this.nextChaos = this.cfg.hideSec + 90 + Math.random() * 60;
      if (this.t >= this.nextChaos) {
        this.nextChaos = this.t + 120 + Math.random() * 60;
        const kinds = ['blind', 'siren', 'rain', 'surge'].concat(this.hasPowerups ? [] : []).filter((k) => k !== 'rain' || this.hasPowerups);
        const k = kinds[Math.floor(Math.random() * kinds.length)];
        this.chaosApply(k, true);
        this.netSend('chaos', { k, t: this.t });
      }
    }
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
    if (this.gmode === 'vip' && this.vipId) {
      const v = this.players.find((p) => p.id === this.vipId);
      if (v && v.role !== 'hider') { this.netSend('vipdown', {}); this.modesNet('vipdown', {}); this.finish('hunters'); return; }
    }
    if (this.gmode === 'bomb' && this.t >= this.fuseEnd) { this.netSend('boom', {}); this.modesNet('boom', {}); this.finish('hiders'); return; }
    if (this.gmode === 'hill') {
      const inside = this.hiders().filter((h) => dist(h, this.hill) <= HILL_R).length;
      const guards = this.hunters().filter((h) => dist(h, this.hill) <= HILL_R).length;
      if (inside && !guards) {
        const before = Math.floor(this.hillProg / 30);
        this.hillProg += dt;
        if (Math.floor(this.hillProg / 30) > before) { this.netSend('hillp', { p: this.hillProg }); this.modesNet('hillp', { p: this.hillProg }); }
      }
      if (this.hillProg >= this.hillNeed) { this.finish('hiders'); return; }
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
  /** Салки: водящий передаёт роль пойманному; обратно — не раньше чем через 15 с. */
  tagCatch(hunter, h) {
    hunter.role = 'hider'; h.role = 'hunter'; h.target = null; hunter.target = null;
    h.noTagBack = { id: hunter.id, until: this.t + 15 };
    h.timesIt = (h.timesIt || 0) + 1; hunter.catches = (hunter.catches || 0) + 1;
    this.events.push({ k: 'c', t: Math.round(this.t), a: this.players.indexOf(hunter), b: this.players.indexOf(h), x: Math.round(h.x), y: Math.round(h.y) });
    if (h === this.me) { this.stats.timesCaught++; this.alert('red', t('tagYou'), 'target'); this.vibrate([300, 100, 300]); }
    else if (hunter === this.me) { this.stats.caught++; this.alert('green', t('tagPassed', { n: h.name }), 'target'); }
    else this.alert('yellow', t('tagOther', { a: hunter.name, b: h.name }), 'target');
    this.renderHud(true);
  },
  /** Бомба: поимка сбрасывает фитиль. */
  bombReset(hunter) {
    this.fuseEnd = this.t + this.fuse;
    this.alert(this.me.role === 'hunter' ? 'green' : 'yellow', t('bombReset', { s: this.fuse }), 'bolt');
  },
  /** Королевская битва: зона сжимается рывками 100% → 75% → 50% → 30% (переход 20 с). */
  royaleK() {
    const hunt = this.cfg.huntSec, el = Math.max(0, this.t - this.cfg.hideSec), K = [1, 0.75, 0.5, 0.3];
    const stageLen = hunt / 4, i = Math.min(3, Math.floor(el / stageLen)), into = el - i * stageLen;
    if (i === 0) return 1;
    const f = Math.min(1, into / 20);
    return K[i - 1] + (K[i] - K[i - 1]) * f;
  },
  royaleLocal() {
    if (this.gmode !== 'royale' || this.phase() !== 'hunt') return;
    const stageLen = this.cfg.huntSec / 4, el = this.t - this.cfg.hideSec, i = Math.min(3, Math.floor(el / stageLen));
    if (i > this.royaleStage) { this.royaleStage = i; this.alert('red', t('royaleNow', { p: [100, 75, 50, 30][i] }), 'target'); this.vibrate([200, 100, 200]); }
    const next = (i + 1) * stageLen - el;
    if (i < 3 && next <= 30 && next > 29 && this.royaleWarned !== i) { this.royaleWarned = i; this.alert('yellow', t('royaleSoon', { p: [75, 50, 30][i] }), 'target'); }
  },

  /** Кто побеждает, когда вышло время. */
  timeoutWinner() {
    if (this.social && this.social()) return this.hiders().length || this.escaped ? 'hiders' : 'hunters';
    if (this.gmode === 'tag') return 'hiders';
    if (this.gmode === 'vip') return this.players.some((p) => p.id === this.vipId && p.role === 'hider') ? 'hiders' : 'hunters';
    if (this.gmode === 'treasure' || this.gmode === 'hill') return 'hunters';   // не успели собрать / удержать
    if (this.gmode === 'sardines') return 'hiders';
    return this.hiders().length > 0 ? 'hiders' : 'hunters';
  },

  /** Случайное событие («хаос»). host — эффекты, которые решает организатор. */
  chaosApply(k, host) {
    const T = this.t;
    if (k === 'blind' && host) this.revealReadyAt = Math.max(this.revealReadyAt, T + 30);
    if (k === 'siren') for (const h of this.hiders()) h.exposedUntil = Math.max(h.exposedUntil || 0, T + 10);
    if (k === 'rain' && host) for (let i = 0; i < 5; i++) this.supplies.push(this.newSupply());
    if (k === 'surge') for (const h of this.players) if (h.sim && h.role === 'hider') h.stamina = 100;
    const mine = { blind: this.me.role === 'hunter' ? 'red' : 'green', siren: this.me.role === 'hider' ? 'red' : 'green', rain: 'green', surge: this.me.role === 'hider' ? 'green' : 'yellow' }[k];
    this.alert(mine, '🎲 ' + t('chaos_' + k), 'sparkle');
    this.vibrate([100, 60, 100]);
    this.events.push({ k: 'ch', t: Math.round(T), e: k });
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
    this.royaleLocal();
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
    if (this.gmode === 'hill') {
      const r = (Math.random() - 0.5) * HILL_R;
      if (p.role === 'hider' && Math.random() < 0.45) return { x: this.hill.x + r, y: this.hill.y + r };
      if (p.role === 'hunter' && Math.random() < 0.35) return { x: this.hill.x + r * 2, y: this.hill.y - r * 2 };
    }
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
    return { fe: this.fuseEnd === Infinity ? -1 : Math.round(this.fuseEnd * 10) / 10, hp: Math.round(this.hillProg), jl: this.players.map((p) => (p.jailed ? 1 : 0)).join(''), rs: Math.round(this.rescue * 10) / 10, tr: this.treasures.map((q) => [q.id, Math.round(q.x), Math.round(q.y)]), tg: this.treasureGot };
  },
  modesApply(d) {
    if (d.hp != null && this.hill) this.hillProg = d.hp;
    if (d.fe != null && d.fe >= 0) this.fuseEnd = d.fe;
    if (d.jl != null) [...d.jl].forEach((c, i) => { const p = this.players[i]; if (p) p.jailed = c === '1'; });
    if (d.rs != null) this.rescue = d.rs;
    if (d.tr) this.treasures = d.tr.map(([id, x, y]) => ({ id, x, y }));
    if (d.tg != null) this.treasureGot = d.tg;
  },
  modesNet(type, d) {
    const P = (id) => this.players.find((p) => p.id === id);
    if (type === 'tpick') { this.treasures = this.treasures.filter((x) => x.id !== d.id); this.treasureGot++; const h = P(d.by); if (h) this.onTreasure(h); return true; }
    if (type === 'freed') { const h = P(d.by); this.freeAll(h || { name: '?' }); return true; }
    if (type === 'chaos') { this.chaosApply(d.k, false); return true; }
    if (type === 'vipdown') { this.alert(this.me.role === 'hunter' ? 'green' : 'red', t('vipDown'), 'target'); return true; }
    if (type === 'boom') { this.alert(this.me.role === 'hunter' ? 'red' : 'green', t('bombBoom'), 'bolt'); this.vibrate([500]); return true; }
    if (type === 'hillp') { this.hillProg = d.p; this.alert(this.me.role === 'hider' ? 'green' : 'red', t('hillProg', { a: Math.floor(d.p), b: this.hillNeed }), 'mountain'); return true; }
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
      if (this.hill) {
        L.circle(this.ll(this.hill), { radius: HILL_R, color: '#c08a3e', weight: 3, fillColor: '#f6c453', fillOpacity: 0.18, interactive: false }).addTo(this.modeLayer);
        this.hillMark = L.marker(this.ll(this.hill), { interactive: false }).addTo(this.modeLayer);
      }
    }
    if (this.hillMark) {
      const html = `<div class="mk-jail" style="border-color:#c08a3e">⛰ ${Math.floor(this.hillProg)}/${this.hillNeed}</div>`;
      if (html !== this.hillHtml) { this.hillHtml = html; this.hillMark.setIcon(L.divIcon({ className: '', iconSize: [70, 34], iconAnchor: [35, 17], html })); }
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
    if (this.gmode === 'hill') return { k: t('hillCell'), v: `${Math.floor(this.hillProg)}/${this.hillNeed}` };
    if (this.gmode === 'bomb' && this.phase() === 'hunt') { const s = Math.max(0, Math.ceil(this.fuseEnd - this.t)); return { k: '💣 ' + t('bombCell'), v: String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0') }; }
    if (this.gmode === 'royale' && this.phase() === 'hunt') { const sl = this.cfg.huntSec / 4, el = this.t - this.cfg.hideSec, i = Math.min(3, Math.floor(el / sl)); if (i < 3) { const s = Math.max(0, Math.ceil((i + 1) * sl - el)); return { k: t('royaleCell'), v: String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0') }; } return { k: t('royaleCell'), v: '30%' }; }
    if (this.gmode === 'tag') { const it = this.hunters()[0]; return { k: '🏷 ' + t('tagCell'), v: it ? (it === this.me ? t('you') : it.name).slice(0, 8) : '—' }; }
    if (this.gmode === 'vip') return { k: '👑 VIP', v: this.players.some((p) => p.id === this.vipId && p.role === 'hider') ? t('vipAlive') : '✕' };
    return null;
  },
  modesBanner() {
    if (this.gmode === 'vip' && this.me.id === this.vipId && this.me.role === 'hider') return `<div class="banner yellow"><div class="bi">👑</div><div>${t('vipYou')}</div></div>`;
    if (this.gmode === 'jail' && this.me.jailed) return `<div class="frozen"><div><div class="t1">${t('jailT')}</div><div class="t2">${t('jailS')}</div></div><div class="num">⛓</div></div>`;
    return '';
  },
};
