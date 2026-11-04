// Онлайн-режим движка. Организатор (host) — единственный, кто решает: боты, тайники, задания,
// раскрытия, заморозки, поимки и конец игры. Участники (client) присылают свою позицию и запросы.
// Время у всех общее: от момента старта по часам организатора.
import { t } from './i18n.js';
import { pwById, pwName } from './content.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const r1 = (v) => Math.round(v * 10) / 10;

export const netMixin = {
  netInit() {
    this.netOff = this.isHost ? 0 : (this.net.offset || 0);   // часы организатора − мои часы, мс
    this.offs = [];
    this.lastNetSend = -10;
    this.outPrints = [];
  },

  /** Игровое время по общим часам. Отрицательное — до старта. */
  netClockT() { return (Date.now() + this.netOff - this.net.startAt) / 1000; },
  netClock(ts) {
    // ts − now = смещение − задержка; берём максимум последних замеров (минимальная задержка)
    this.offs.push(ts - Date.now()); if (this.offs.length > 20) this.offs.shift();
    this.netOff = Math.max(...this.offs);
  },

  renderCountdown(sec) {
    const cover = this.root && this.root.querySelector('#cover');
    if (!cover) return;
    if (!cover.querySelector('#cdBig')) cover.innerHTML = `<div class="wait-cover"><div><div style="font-size:20px">${t('startIn')}</div><div class="big" id="cdBig" style="color:var(--accent)"></div></div></div>`;
    cover.querySelector('#cdBig').textContent = Math.ceil(sec);
  },

  netSend(type, data, to) { if (this.net && this.net.room) this.net.room.send(type, data, to); },

  netStep(dt) {
    // плавно подтягиваем чужие позиции
    const k = Math.min(1, dt * 3);
    for (const p of this.players) if (!p.sim && p.nx != null) { p.x += (p.nx - p.x) * k; p.y += (p.ny - p.y) * k; }
    if (this.t - this.lastNetSend >= 1) { this.lastNetSend = this.t; this.netSendState(); }
  },

  netSendState() {
    const pr = this.outPrints.splice(0).map((f) => [f.id, Math.round(f.x), Math.round(f.y), Math.round(f.a), f.owner, r1(f.t)]);
    if (this.isHost) {
      const m = this.mission;
      this.netSend('st', {
        p: this.players.filter((p) => p.sim).map((p) => [p.id, Math.round(p.x), Math.round(p.y), p.running ? 1 : 0, r1(p.exposedUntil || 0)]),
        ro: this.players.map((p) => (p.role === 'hunter' ? 1 : 0)).join(''),
        s: this.supplies.map((q) => [q.id, Math.round(q.x), Math.round(q.y)]),
        m: m ? [Math.round(m.x), Math.round(m.y), m.r, r1(m.deadline), m.need, r1(m.progress), m.started ? 1 : 0] : null,
        rr: r1(this.revealReadyAt), fr: r1(this.freezeReadyAt), nm: this.nextMissionAt === Infinity ? -1 : r1(this.nextMissionAt), pr,
        md: this.modesState(), ex: this.extrasState(), so: this.socialState(), wo: this.worldState(), ar: this.arenaState(),
      });
    } else {
      const me = this.me;
      this.netSend('pos', { x: Math.round(me.x), y: Math.round(me.y), iv: r1(me.invisUntil || 0), h: me.h != null ? r1(me.h) : null, r: me.running ? 1 : 0, ex: r1(me.exposedUntil || 0), pr, ch: { u: !!this.ch.untouch, i: !!this.ch.immune, m: !!this.ch.magnet } });
    }
  },

  netPrints(arr) {
    for (const [id, x, y, a, owner, tt] of arr || []) if (!this.prints.some((f) => f.id === id)) this.addPrint({ id, x, y, a, owner, t: tt }, true);
  },

  netPlayer(id) { return this.players.find((p) => p.id === id); },

  netHandle(type, d, from, ts) {
    if (this.ended) return;
    const P = (id) => this.netPlayer(id);
    if (this.isClient && from === this.net.hostId) this.netClock(ts);
    const me = this.me;
    if (this.isClient && ['tpick', 'freed', 'rescuing', 'chaos'].includes(type)) { this.modesNet(type, d); return; }
    if (this.codeNet(type, d, from)) return;
    if (this.extrasNet(type, d, from)) return;
    if (this.socialNet(type, d, from)) return;
    if (this.worldNet(type, d, from)) return;
    if (this.arenaNet(type, d)) return;
    if (this.indoorNet(type, d, from)) return;
    if (type === 'ext' && this.isClient) { this.cfg.huntSec = d.huntSec; return; }
    switch (type) {
      case 'pos': {   // позиция участника — получают все
        const p = P(from); if (!p || p.sim) break;
        if (p.lastPos) { const dtt = Math.max(0.5, this.t - p.lastPos.t); p.speed = Math.hypot(d.x - p.lastPos.x, d.y - p.lastPos.y) / dtt; }
        p.lastPos = { x: d.x, y: d.y, t: this.t };
        p.nx = d.x; p.ny = d.y; p.running = !!d.r; p.exposedUntil = Math.max(p.exposedUntil || 0, d.ex || 0); p.netCh = d.ch || {}; p.invisUntil = d.iv || 0; if (d.h != null) p.h = d.h; p.lastSeen = this.t; p.left = false;
        this.netPrints(d.pr);
        break;
      }
      case 'st': {    // состояние мира от организатора
        if (!this.isClient) break;
        for (const [id, x, y, r, ex] of d.p) { const p = P(id); if (!p || p.sim) continue; p.nx = x; p.ny = y; p.running = !!r; p.exposedUntil = Math.max(p.exposedUntil || 0, ex); }
        // роли сверяем на случай потерянного сообщения о поимке
        [...(d.ro || '')].forEach((c, i) => { const p = this.players[i]; if (p && c === '1' && p.role === 'hider') { p.role = 'hunter'; p.wasCaught = true; if (p === me) this.renderHud(true); } });
        this.supplies = d.s.map(([id, x, y]) => ({ id, x, y }));
        if (d.m) {
          const [x, y, r, deadline, need, progress, started] = d.m;
          const fresh = !this.mission || Math.abs(this.mission.x - x) > 1 || Math.abs(this.mission.y - y) > 1;
          this.mission = fresh ? { x, y, r, deadline, need, progress, started: !!started } : Object.assign(this.mission, { deadline, need, progress, started: !!started });
        } else this.mission = null;
        if (d.md) this.modesApply(d.md);
        if (d.ex) this.extrasApply(d.ex);
        if (d.so) this.socialApply(d.so);
        if (d.wo) this.worldApply(d.wo);
        if (d.ar) this.arenaApply(d.ar);
        this.revealReadyAt = d.rr; this.freezeReadyAt = d.fr; this.nextMissionAt = d.nm < 0 ? Infinity : d.nm;
        this.netPrints(d.pr);
        break;
      }
      case 'reveal': {
        if (!this.isClient) break;
        this.revealReadyAt = d.rr;
        let mine = false;
        for (const [id, x, y, r, owner] of d.c) {
          this.circles.push({ id, x, y, r, t: this.t, owner });
          const p = P(owner); this.events.push({ k: 'r', t: Math.round(this.t), x, y, r, p: this.players.indexOf(p) });
          if (owner === me.id) mine = true;
        }
        if (mine) { this.alert('red', t('revealedYou'), 'signal'); this.vibrate([200, 80, 200]); }
        if (me.role === 'hunter') this.alert('blue', d.c.length ? t('revealSent') : t('revealNone'), 'signal');
        break;
      }
      case 'freeze': {
        if (!this.isClient) break;
        this.freezeReadyAt = d.fr;
        for (const id of d.ids) { const p = P(id); if (!p) continue; p.warnUntil = d.wu; p.frozenUntil = d.fu; if (p === me) { me.frozenDrift = 0; me.frozenPenalty = false; this.runToggle = false; this.vibrate([300, 100, 300]); } }
        if (d.warded.includes(me.id)) { me.wards = Math.max(0, me.wards - 1); this.alert('green', t('wardSaved'), 'shield'); }
        if (d.ids.length) this.events.push({ k: 'f', t: Math.round(this.t), n: d.ids.length });
        if (me.role === 'hunter') this.alert('blue', d.ids.length ? t('freezeSent', { n: d.ids.length }) : t('freezeNone'), 'snow');
        break;
      }
      case 'caught': { if (!this.isClient) break; const a = P(d.a), b = P(d.b); if (a && b) this.catchPlayer(a, b, true); break; }
      case 'nocatch': this.alert('yellow', t('nobodyNear', { d: this.catchRange() }), 'target'); break;
      case 'picked': {
        if (!this.isClient || d.by !== me.id) break;
        const pw = pwById(d.pw); if (!pw) break;
        this.stats.supplies++; me.powerups.push(pw.id); this.alert('green', t('pickedUp', { p: pwName(pw) }), 'supply'); this.vibrate([60]); this.renderHud(true);
        break;
      }
      case 'flare': if (this.isClient) { this.flare = { at: d.at, pos: d.pos, shown: false }; this.alert('blue', t('flareFired'), 'flare'); } break;
      case 'mnew': if (this.isClient && me.role === 'hider') this.alert('yellow', t('missionNew'), 'diamond'); break;
      case 'mheld': if (this.isClient) this.alert('yellow', me.role === 'hunter' ? t('missionSeen') : t('missionHeld'), 'diamond'); break;
      case 'mdone': {
        if (!this.isClient) break;
        const mineRw = (d.rw || {})[me.id];
        if (mineRw) { me.powerups.push(...mineRw); this.stats.missions++; }
        if (me.role === 'hider') this.alert('green', t('missionDone'), 'trophy');
        this.events.push({ k: 'md', t: Math.round(this.t) }); this.mission = null; this.renderHud(true);
        break;
      }
      case 'mfail': {
        if (!this.isClient) break;
        for (const h of this.hiders()) h.exposedUntil = d.until;
        this.alert('red', me.role === 'hider' ? t('missionFail') : t('exposedAll'), 'eye');
        this.events.push({ k: 'mf', t: Math.round(this.t) }); this.mission = null; this.renderHud(true);
        break;
      }
      case 'req': {   // запрос участника — решает организатор
        if (!this.isHost) break;
        const p = P(from); if (!p || this.phase() !== 'hunt') break;
        if (d.k === 'reveal' && p.role === 'hunter' && this.t >= this.revealReadyAt) this.doReveal(p);
        else if (d.k === 'freeze' && p.role === 'hunter' && this.t >= this.freezeReadyAt) this.doFreeze(p);
        else if (d.k === 'catch') {
          const h = P(d.h), lim = d.r ? 260 : this.cfg.mode === 'gps' ? 45 : 30;
          if (p.role === 'hunter' && h && h.role === 'hider' && dist(p, h) <= lim) this.catchPlayer(p, h);
          else this.netSend('nocatch', {}, from);
        }
        break;
      }
      case 'power': {
        if (!this.isHost) break;
        const p = P(from); if (!p) break;
        this.applyPower(p, d.id);
        break;
      }
      case 'end': {
        if (!this.isClient) break;
        for (const r of d.res || []) { const p = P(r.id); if (p) { p.caughtAt = r.caughtAt; p.caughtBy = r.caughtBy; p.catches = r.catches; } }
        this.finish(d.w);
        break;
      }
      case 'pause': if (this.isClient) { this.paused = true; } break;
      case 'resume': if (this.isClient) { this.net.startAt = d.startAt; this.paused = false; this.last = performance.now(); const c = this.root.querySelector('#cover'); if (c) c.innerHTML = ''; } break;
      case 'abort': if (this.isClient && from === this.net.hostId) { this.ended = true; this.opts.toast(t('hostLeft')); this.opts.onLeave(); } break;
      case 'bye': { const p = P(from); if (p) { p.left = true; this.alert('yellow', t('playerLeft', { n: p.name }), 'users'); } break; }
    }
  },
};
