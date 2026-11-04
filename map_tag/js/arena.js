// Режимы 2.5:
//  • flag       — «Захват флага»: прячущиеся несут флаги 🚩 на базу в центре; несущего видно охотникам;
//  • infection  — «Инфекция»: пойманный заражается (становится охотником), но может вылечиться антидотом 💉;
//  • bounty     — «Охота за головами»: один прячущийся — цель 🎯, её видно охотникам; поймать можно только цель,
//                 остальных поимка лишь замораживает на 15 с; цель меняется каждую минуту;
//  • checkpoint — «Чекпоинты»: прячущиеся по очереди захватывают 5 точек (10 с рядом, без охотника в 25 м).
// Всё решает организатор (или офлайн-телефон); участники получают состояние в 'st'.
import { t } from './i18n.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const FLAG_R = 7, BASE_R = 22, ANTI_R = 6, CP_R = 15, CP_NEED = 10, CP_N = 5, BOUNTY_T = 60;
export const ARENA_MODES = ['flag', 'infection', 'bounty', 'checkpoint'];

export const arenaMixin = {
  arena() { return ARENA_MODES.includes(this.gmode); },
  arenaInit() {
    this.flags = []; this.flagGot = 0; this.flagNeed = 0;
    this.antis = []; this.nextAnti = Infinity;
    this.bountyI = -1; this.bountyNext = 0;
    this.cps = []; this.cpI = 0; this.cpProg = 0;
    if (!this.arena()) return;
    const base = this.zc || { x: 0, y: 0 };
    if (this.gmode === 'flag') {
      this.flagNeed = 3;
      if (!this.isClient) for (let i = 0; i < 3; i++) { const p = this.randZone(0.85, 0.5); this.flags.push({ id: 'f' + i, x: p.x, y: p.y, c: -1 }); }
      this.base = { x: base.x, y: base.y };
    }
    if (this.gmode === 'infection') this.nextAnti = (this.cfg.hideSec || 0) + 45;
    if (this.gmode === 'checkpoint' && !this.isClient) for (let i = 0; i < CP_N; i++) { const p = this.randZone(0.85, 0.15); this.cps.push({ x: Math.round(p.x), y: Math.round(p.y) }); }
    if (this.gmode === 'bounty' || this.gmode === 'checkpoint' || this.gmode === 'flag') this.nextMissionAt = Infinity;
  },
  pi(p) { return this.players.indexOf(p); },

  // ---------- организатор / офлайн ----------
  arenaStep(dt) {
    if (!this.arena() || this.phase() !== 'hunt') return;
    const T = this.t;
    if (this.gmode === 'flag') {
      for (const f of this.flags) {
        let c = this.players[f.c];
        if (c && c.role !== 'hider') { f.c = -1; c = null; this.netSend('aev', { k: 'fdrop' }); this.arenaEv('fdrop'); }
        if (!c) { const h = this.hiders().find((q) => dist(q, f) <= FLAG_R); if (h) { f.c = this.pi(h); this.netSend('aev', { k: 'fpick', n: h.name }); this.arenaEv('fpick', h.name); } continue; }
        f.x = c.x; f.y = c.y; if (c.sim) c.exposedUntil = Math.max(c.exposedUntil || 0, T + 2);
        if (dist(c, this.base) <= BASE_R) {
          this.flags = this.flags.filter((x) => x !== f); this.flagGot++;
          this.netSend('aev', { k: 'fdone', n: c.name }); this.arenaEv('fdone', c.name);
          if (this.flagGot >= this.flagNeed) { this.finish('hiders'); return; }
        }
      }
    }
    if (this.gmode === 'infection') {
      if (T >= this.nextAnti && this.antis.length < 3) { const p = this.randZone(0.85, 0.1); this.antis.push({ id: 'a' + Math.round(T), x: Math.round(p.x), y: Math.round(p.y) }); this.nextAnti = T + 45; this.netSend('aev', { k: 'anew' }); this.arenaEv('anew'); }
      for (const a of [...this.antis]) {
        const u = this.hunters().find((q) => q.wasCaught && dist(q, a) <= ANTI_R);
        if (!u) continue;
        this.antis = this.antis.filter((x) => x !== a);
        this.cure(u); this.netSend('aev', { k: 'cured', i: this.pi(u) });
      }
    }
    if (this.gmode === 'bounty') {
      const cur = this.players[this.bountyI];
      if (!cur || cur.role !== 'hider' || T >= this.bountyNext) {
        const pool = this.hiders().filter((h) => h !== cur);
        const nx = pool.length ? pool[Math.floor(Math.random() * pool.length)] : cur && cur.role === 'hider' ? cur : null;
        this.bountyI = nx ? this.pi(nx) : -1; this.bountyNext = T + BOUNTY_T;
        if (nx) { this.netSend('aev', { k: 'bnew', i: this.bountyI }); this.arenaEv('bnew', this.bountyI); }
      }
      const b = this.players[this.bountyI]; if (b && b.sim) b.exposedUntil = Math.max(b.exposedUntil || 0, T + 2);
    }
    if (this.gmode === 'checkpoint') {
      const cp = this.cps[this.cpI]; if (!cp) return;
      const on = this.hiders().some((h) => dist(h, cp) <= CP_R), blocked = this.hunters().some((u) => dist(u, cp) <= 25);
      if (on && !blocked) this.cpProg += dt;
      if (this.cpProg >= CP_NEED) {
        this.cpI++; this.cpProg = 0;
        this.netSend('aev', { k: 'cpdone', i: this.cpI }); this.arenaEv('cpdone', this.cpI);
        if (this.cpI >= this.cps.length) { this.finish('hiders'); return; }
      }
    }
  },
  /** Каждый телефон: несу флаг / я цель — меня видно. */
  arenaLocal() {
    if (!this.arena() || this.phase() !== 'hunt') return;
    const me = this.me, i = this.pi(me);
    if ((this.gmode === 'flag' && this.flags.some((f) => f.c === i)) || (this.gmode === 'bounty' && this.bountyI === i)) me.exposedUntil = Math.max(me.exposedUntil || 0, this.t + 3.5);
  },
  cure(u) {
    u.role = 'hider'; u.alive = true; u.wasCaught = false; u.stamina = 100; u.target = null; u.curedAt = this.t;
    if (u === this.me) { this.alert('green', t('curedYou'), 'sparkle'); this.vibrate([100, 50, 100]); } else this.alert(this.me.role === 'hider' ? 'green' : 'yellow', t('curedOther', { n: u.name }), 'sparkle');
    this.renderHud(true);
  },
  /** Поимка в режимах арены. true — обработано (обычное превращение не нужно). */
  arenaCatch(hunter, h) {
    if (this.gmode !== 'bounty' || this.pi(h) === this.bountyI) return false;
    if (this.t < (h.frozenUntil || 0)) return true;
    h.warnUntil = this.t; h.frozenUntil = this.t + 15; h.target = null;
    if (this.isHost) this.netSend('freeze', { ids: [h.id], wu: this.t, fu: this.t + 15, warded: [], fr: this.freezeReadyAt });
    if (h === this.me) { this.alert('red', t('bountyHit'), 'snow'); this.vibrate([300]); }
    else if (hunter === this.me) this.alert('yellow', t('bountyWrong', { n: h.name }), 'snow');
    this.renderHud(true);
    return true;
  },
  arenaEv(k, a) {
    const me = this.me, hid = me.role === 'hider';
    if (k === 'fpick') this.alert(hid ? 'green' : 'red', t('flagPick', { n: a }), 'flare');
    if (k === 'fdrop') this.alert(hid ? 'red' : 'green', t('flagDrop'), 'flare');
    if (k === 'fdone') { this.alert(hid ? 'green' : 'red', t('flagDone', { n: a, a: this.flagGot, b: this.flagNeed }), 'trophy'); this.vibrate([100]); }
    if (k === 'anew') this.alert(me.role === 'hunter' && me.wasCaught ? 'green' : 'yellow', t('antiNew'), 'sparkle');
    if (k === 'bnew') { const p = this.players[a]; if (p === me) { this.alert('red', t('bountyYou'), 'target'); this.vibrate([300, 100, 300]); } else if (p) this.alert(me.role === 'hunter' ? 'blue' : 'yellow', t('bountyNew', { n: p.name }), 'target'); }
    if (k === 'cpdone') { this.alert(hid ? 'green' : 'red', t('cpDone', { a, b: this.cps.length || CP_N }), 'diamond'); this.vibrate([80]); }
    this.renderHud(true);
  },
  arenaTimeout() {
    if (this.gmode === 'flag' || this.gmode === 'checkpoint') return 'hunters';
    return null;
  },
  arenaBotTarget(p) {
    if (!this.arena() || this.phase() !== 'hunt') return null;
    const i = this.pi(p);
    if (this.gmode === 'flag') {
      if (p.role === 'hider') { if (this.flags.some((f) => f.c === i)) return { ...this.base }; const f = this.flags.filter((q) => q.c < 0).sort((a, b) => dist(a, p) - dist(b, p))[0]; if (f && Math.random() < 0.6) return { x: f.x, y: f.y }; }
      else { const f = this.flags.find((q) => q.c >= 0); if (f) return { x: f.x, y: f.y }; if (Math.random() < 0.4) return { x: this.base.x + (Math.random() - 0.5) * 60, y: this.base.y + (Math.random() - 0.5) * 60 }; }
    }
    if (this.gmode === 'infection' && p.role === 'hunter' && p.wasCaught) { const a = this.antis.sort((x, y) => dist(x, p) - dist(y, p))[0]; if (a && dist(a, p) < 200) return { x: a.x, y: a.y }; }
    if (this.gmode === 'bounty' && p.role === 'hunter') { const b = this.players[this.bountyI]; if (b) return { x: b.x, y: b.y }; }
    if (this.gmode === 'checkpoint') { const cp = this.cps[this.cpI]; if (cp && (p.role === 'hunter' ? Math.random() < 0.5 : Math.random() < 0.4)) return { x: cp.x + (Math.random() - 0.5) * 20, y: cp.y + (Math.random() - 0.5) * 20 }; }
    return null;
  },

  // ---------- сеть ----------
  arenaState() {
    if (!this.arena()) return null;
    return { fl: this.flags.map((f) => [f.id, Math.round(f.x), Math.round(f.y), f.c]), fg: this.flagGot, an: this.antis.map((a) => [a.id, a.x, a.y]), bi: this.bountyI, bn: Math.round(this.bountyNext), cp: this.cps, ci: this.cpI, cg: Math.round(this.cpProg * 10) / 10, ba: this.base ? [Math.round(this.base.x), Math.round(this.base.y)] : null };
  },
  arenaApply(d) {
    if (!d) return;
    this.flags = d.fl.map(([id, x, y, c]) => ({ id, x, y, c })); this.flagGot = d.fg;
    this.antis = d.an.map(([id, x, y]) => ({ id, x, y }));
    this.bountyI = d.bi; this.bountyNext = d.bn; this.cps = d.cp; this.cpI = d.ci; this.cpProg = d.cg;
    if (d.ba) this.base = { x: d.ba[0], y: d.ba[1] };
  },
  arenaNet(type, d) {
    if (type !== 'aev' || !this.isClient) return false;
    if (d.k === 'cured') { const u = this.players[d.i]; if (u) this.cure(u); return true; }
    if (d.k === 'bnew') this.bountyI = d.i;
    if (d.k === 'cpdone') { this.cpI = d.i; this.cpProg = 0; }
    if (d.k === 'fdone') this.flagGot++;
    this.arenaEv(d.k, d.k === 'bnew' || d.k === 'cpdone' ? d.i : d.n);
    return true;
  },

  // ---------- интерфейс ----------
  arenaRender() {
    if (!this.arena()) return;
    if (!this.arLayer) {
      this.arLayer = L.layerGroup().addTo(this.map); this.arDyn = L.layerGroup().addTo(this.map);
      if (this.gmode === 'flag' && this.base) { L.circle(this.ll(this.base), { radius: BASE_R, color: '#5fd38d', weight: 3, fillColor: '#5fd38d', fillOpacity: 0.15, interactive: false }).addTo(this.arLayer); L.marker(this.ll(this.base), { interactive: false, icon: L.divIcon({ className: '', iconSize: [34, 34], iconAnchor: [17, 17], html: '<div class="mk-jail" style="border-color:#5fd38d">🏁</div>' }) }).addTo(this.arLayer); }
    }
    const cp = this.cps[this.cpI];
    const sig = JSON.stringify([this.flags.map((f) => [f.c < 0 ? Math.round(f.x / 3) : f.c, f.c < 0 ? Math.round(f.y / 3) : 0]), this.antis.map((a) => a.id), this.cpI, Math.floor(this.cpProg), this.bountyI]);
    if (sig === this.arSig) return;
    this.arSig = sig; this.arDyn.clearLayers();
    const pin = (q, html, w = 30) => L.marker(this.ll(q), { interactive: false, icon: L.divIcon({ className: '', iconSize: [w, 30], iconAnchor: [w / 2, 15], html }) }).addTo(this.arDyn);
    for (const f of this.flags) if (f.c < 0) pin(f, '<div class="mk-obj" style="border-color:#f26d7d">🚩</div>');
    for (const a of this.antis) pin(a, '<div class="mk-obj" style="border-color:#5fd38d">💉</div>');
    if (cp) { L.circle(this.ll(cp), { radius: CP_R, color: '#f3c13a', weight: 3, fillColor: '#f3c13a', fillOpacity: 0.18, interactive: false }).addTo(this.arDyn); pin(cp, `<div class="mk-jail" style="border-color:#f3c13a">🏴 ${this.cpI + 1}/${this.cps.length} · ${Math.floor(this.cpProg)}</div>`, 96); }
  },
  /** Значок над игроком: флаг у несущего, мишень у цели. */
  arenaBadge(p) {
    const i = this.pi(p);
    if (this.gmode === 'flag' && this.flags.some((f) => f.c === i)) return '🚩';
    if (this.gmode === 'bounty' && this.bountyI === i) return '🎯';
    return '';
  },
  arenaCell() {
    if (!this.arena() || this.phase() !== 'hunt') return null;
    if (this.gmode === 'flag') return { k: '🚩 ' + t('flagCell'), v: `${this.flagGot}/${this.flagNeed}` };
    if (this.gmode === 'checkpoint') return { k: '🏴 ' + t('cpCell'), v: `${this.cpI}/${this.cps.length || CP_N}` };
    if (this.gmode === 'infection') return { k: '💉 ' + t('antiCell'), v: String(this.antis.length) };
    if (this.gmode === 'bounty') { const b = this.players[this.bountyI]; return { k: '🎯 ' + t('bountyCell'), v: b ? (b === this.me ? t('you') : b.name).slice(0, 8) : '—' }; }
    return null;
  },
  arenaBanner() {
    if (!this.arena() || this.phase() !== 'hunt') return '';
    const me = this.me, i = this.pi(me);
    if (this.gmode === 'flag' && this.flags.some((f) => f.c === i)) return `<div class="banner yellow"><div class="bi">🚩</div><div>${t('flagCarry')}</div></div>`;
    if (this.gmode === 'bounty' && this.bountyI === i) return `<div class="banner red"><div class="bi">🎯</div><div>${t('bountyYouS', { s: Math.max(0, Math.ceil(this.bountyNext - this.t)) })}</div></div>`;
    if (this.gmode === 'infection' && me.role === 'hunter' && me.wasCaught) return `<div class="banner green"><div class="bi">💉</div><div>${t('antiHint')}</div></div>`;
    return '';
  },
};
