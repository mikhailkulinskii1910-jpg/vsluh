// Социальные режимы «как в Among Us»:
//  • impostor — охотник неизвестен; у всех туман (видно только рядом), охотник видит всех;
//  • mimic    — то же, но охотник выглядит как другой игрок (после поимки — как пойманный);
//  • phantom  — то же, но охотника не видно вообще.
// Пойманный выбывает и не может писать и говорить. Любой может созвать собрание и голосовать:
// выгнали не того — он выбывает; выгнали охотника — он оглушён на 10 с, появляется точка эвакуации,
// у охотника пропадает перезарядка и он видит всех, у игроков пропадает туман (видят всех, кроме охотника).
// Игроки, дошедшие до эвакуации, спасены.
import { t } from './i18n.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const FOG = 30, KILL_CD = 30, MEET_CD = 60, VOTE_S = 30, EVAC_R = 20;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const socialMixin = {
  social() { return ['impostor', 'mimic', 'phantom'].includes(this.gmode); },
  socialInit() {
    if (!this.social()) return;
    this.hasPowerups = false; this.supplies = []; this.nextMissionAt = Infinity; this.hasFreeze = false;
    this.killReadyAt = (this.cfg.hideSec || 0) + KILL_CD; this.meetReadyAt = (this.cfg.hideSec || 0) + 20;
    this.evac = null; this.votes = null; this.escaped = 0;
    const h = this.hunters()[0];
    if (h && this.gmode === 'mimic') this.mimicAs(this.hiders()[0]);
  },
  mimicAs(p) { if (p) this.mimic = { name: p.name, color: p.color, avatar: p.avatar || null }; },
  dead(p) { return p.role === 'dead'; },

  // ---------- видимость и вид ----------
  visSocial(p, d, show) {
    if (!this.social()) return show;
    const me = this.me;
    if (me.role === 'hunter' || me.role === 'dead' || me.role === 'escaped' || me.role === 'spectator') return p.role !== 'escaped';
    if (p.role === 'dead' || p.role === 'escaped') return false;
    if (p.role === 'hunter') { if (this.gmode === 'phantom' || this.evac) return false; return d < FOG; }
    return this.evac ? true : d < FOG;
  },
  /** Как выглядит игрок для меня: охотник для прячущихся — как обычный игрок (или чужой облик у мимика). */
  lookSocial(p) {
    if (!this.social() || this.me.role === 'hunter' || this.me.role === 'dead') return null;
    if (p.role === 'hunter' && this.gmode === 'mimic' && this.mimic) return { name: this.mimic.name, color: this.mimic.color, avatar: this.mimic.avatar, role: 'hider' };
    if (p.role === 'hunter') return { name: p.name, color: p.color, avatar: p.avatar, role: 'hider' };
    return null;
  },
  canTalk() { return this.me.role !== 'dead'; },
  /** Мимик пишет в чат чужим именем: его облик или любой живой прячущийся. */
  chatMask() {
    if (this.gmode !== 'mimic' || this.me.role !== 'hunter') return null;
    const names = [...new Set([...(this.mimic ? [this.mimic.name] : []), ...this.hiders().map((h) => h.name)])];
    return names.length ? { names } : null;
  },

  // ---------- поимка ----------
  preCatchSocial(hunter, h) {
    if (!this.social()) return false;
    if (this.t < this.killReadyAt && !this.evac) { if (hunter === this.me) this.alert('yellow', t('killCd', { s: Math.ceil(this.killReadyAt - this.t) }), 'clock'); return true; }
    return false;
  },
  socialCatch(hunter, h) {
    h.role = 'dead'; h.caughtAt = this.t; h.caughtBy = hunter.name; hunter.catches = (hunter.catches || 0) + 1;
    h.running = false; h.target = null;
    this.killReadyAt = this.evac ? this.t : this.t + KILL_CD;
    if (this.gmode === 'mimic') this.mimicAs(h);
    this.events.push({ k: 'c', t: Math.round(this.t), a: this.players.indexOf(hunter), b: this.players.indexOf(h), x: Math.round(h.x), y: Math.round(h.y) });
    if (h === this.me) { this.stats.timesCaught++; this.alert('red', t('deadYou'), 'target'); this.vibrate([500]); this.opts.onDead && this.opts.onDead(); }
    else if (hunter === this.me) { this.stats.caught++; this.alert('green', t('killYou', { n: h.name }), 'target'); }
    else this.alert('red', t('deadOther', { n: h.name }), 'target');
    this.renderHud(true);
  },

  // ---------- собрание и голосование ----------
  callMeeting() {
    if (!this.social() || this.phase() !== 'hunt' || this.me.role === 'dead' || this.me.role === 'escaped' || this.votes || this.evac) return;
    if (this.t < this.meetReadyAt) { this.alert('yellow', t('meetCd', { s: Math.ceil(this.meetReadyAt - this.t) }), 'clock'); return; }
    if (this.isClient) this.netSend('meetreq', {}); else this.startMeeting(this.me.name);
  },
  startMeeting(by) {   // организатор / офлайн
    this.votes = { by, until: this.t + VOTE_S, v: {} };
    this.meetReadyAt = this.t + VOTE_S + MEET_CD;
    this.netSend('meet', { by, until: this.votes.until });
    this.openVote(by);
    // боты голосуют случайно (иногда пропускают)
    for (const p of this.players) if (p.bot && (p.role === 'hider' || p.role === 'hunter')) {
      const pool = this.players.filter((q) => q !== p && (q.role === 'hider' || q.role === 'hunter'));
      this.votes.v[p.id] = Math.random() < 0.3 || !pool.length ? 'skip' : pool[Math.floor(Math.random() * pool.length)].id;
    }
  },
  openVote(by) {
    const alive = this.players.filter((q) => q.role === 'hider' || q.role === 'hunter');
    if (this.me.role === 'dead' || this.me.role === 'escaped') { this.alert('blue', t('meetDeadNote', { n: by }), 'users'); return; }
    this.opts.modal(`<h2>📢 ${t('meetTitle', { n: esc(by) })}</h2><p style="color:var(--muted)">${t('meetHint')}</p>
      <div class="player-list">${alive.filter((q) => q !== this.me).map((q) => { const lk = this.lookSocial(q); return `<button class="player" data-vote="${q.id}" style="cursor:pointer;text-align:left"><div class="av" style="background:${(lk || q).color}">${esc(((lk || q).name || '?')[0])}</div><div class="nm">${esc((lk || q).name)}</div></button>`; }).join('')}</div>
      <button class="btn block" data-vote="skip" style="margin-top:10px">${t('voteSkip')}</button>`, (box, close) => {
      box.querySelectorAll('[data-vote]').forEach((b) => b.onclick = () => {
        const v = b.dataset.vote; close();
        if (this.isClient) this.netSend('vote', { v }); else if (this.votes) this.votes.v[this.me.id] = v;
        this.alert('blue', t('voteSent'), 'users');
      });
    }, { sticky: true });
  },
  socialStep() {   // организатор / офлайн
    if (!this.social() || this.phase() !== 'hunt') return;
    if (this.votes) {
      const voters = this.players.filter((q) => q.role === 'hider' || q.role === 'hunter');
      const done = voters.every((q) => this.votes.v[q.id]) || this.t >= this.votes.until;
      if (done) {
        const tally = {}; Object.values(this.votes.v).forEach((v) => { tally[v] = (tally[v] || 0) + 1; });
        const top = Object.entries(tally).sort((a, b) => b[1] - a[1]);
        const tie = top.length > 1 && top[0][1] === top[1][1];
        const target = !top.length || tie || top[0][0] === 'skip' ? null : top[0][0];
        this.votes = null;
        this.netSend('verdict', { target });
        this.applyVerdict(target);
      }
    }
    if (this.evac) {
      for (const p of this.hiders()) if (dist(p, this.evac) <= EVAC_R) { p.role = 'escaped'; this.escaped++; this.netSend('escaped', { id: p.id }); this.onEscaped(p); }
    }
    if (!this.hiders().length) { this.finish(this.escaped > 0 ? 'hiders' : 'hunters'); }
  },
  applyVerdict(target) {
    // закрыть окно голосования, если ещё открыто
    document.querySelectorAll('.modal-wrap').forEach((w) => { if (w.querySelector('[data-vote]')) w.remove(); });
    if (!target) { this.alert('blue', t('verdictNone'), 'users'); return; }
    const p = this.players.find((q) => q.id === target); if (!p) return;
    if (p.role === 'hunter') {
      p.stunUntil = this.t + 10; p.target = null;
      this.killReadyAt = 0;                              // у охотника пропадает перезарядка
      if (!this.evac) this.evac = this.evacPoint || this.randZone(0.7, 0.3);
      this.alert(this.me === p ? 'red' : 'green', this.me === p ? t('verdictYouHunter') : t('verdictHunter', { n: p.name }), 'target');
      this.vibrate([300, 100, 300]);
    } else {
      p.role = 'dead';
      if (p === this.me) { this.alert('red', t('verdictYouOut'), 'target'); this.opts.onDead && this.opts.onDead(); }
      else this.alert('yellow', t('verdictInnocent', { n: p.name }), 'users');
    }
    this.renderHud(true);
  },
  onEscaped(p) { this.alert(p === this.me ? 'green' : 'blue', p === this.me ? t('escYou') : t('escOther', { n: p.name }), 'shield'); this.renderHud(true); },

  // ---------- сеть ----------
  socialState() { return this.social() ? { ev: this.evac ? [Math.round(this.evac.x), Math.round(this.evac.y)] : null, kr: Math.round(this.killReadyAt * 10) / 10, rl: this.players.map((p) => ({ hunter: 'h', hider: 'p', dead: 'd', escaped: 'e', spectator: 's' }[p.role] || 'p')).join('') } : null; },
  socialApply(d) {
    if (!d) return;
    if (d.ev) this.evac = { x: d.ev[0], y: d.ev[1] };
    if (d.kr != null) this.killReadyAt = d.kr;
    if (d.rl) [...d.rl].forEach((c, i) => { const p = this.players[i]; if (!p) return; const r = { h: 'hunter', p: 'hider', d: 'dead', e: 'escaped', s: 'spectator' }[c]; if (r && p.role !== r) { const wasMe = p === this.me && p.role !== 'dead' && r === 'dead'; p.role = r; if (wasMe) this.opts.onDead && this.opts.onDead(); if (p === this.me) this.renderHud(true); } });
  },
  socialNet(type, d, from) {
    if (type === 'meetreq' && this.isHost) { const p = this.players.find((q) => q.id === from); if (p && (p.role === 'hider' || p.role === 'hunter') && !this.votes && this.t >= this.meetReadyAt) this.startMeeting(p.name); return true; }
    if (type === 'meet' && this.isClient) { this.votes = { until: d.until }; this.openVote(d.by); return true; }
    if (type === 'vote' && this.isHost) { if (this.votes) this.votes.v[from] = d.v; return true; }
    if (type === 'verdict' && this.isClient) { this.votes = null; this.applyVerdict(d.target); return true; }
    if (type === 'escaped' && this.isClient) { const p = this.players.find((q) => q.id === d.id); if (p) { p.role = 'escaped'; this.onEscaped(p); } return true; }
    return false;
  },

  // ---------- интерфейс ----------
  socialRender() {
    if (!this.social()) return;
    if (this.evac && !this.evacLayer) {
      this.evacLayer = L.layerGroup().addTo(this.map);
      L.circle(this.ll(this.evac), { radius: EVAC_R, color: '#5fd38d', weight: 4, fillColor: '#5fd38d', fillOpacity: 0.2, interactive: false }).addTo(this.evacLayer);
      L.marker(this.ll(this.evac), { interactive: false, icon: L.divIcon({ className: '', iconSize: [40, 40], iconAnchor: [20, 20], html: '<div class="mk-evac">🚁</div>' }) }).addTo(this.evacLayer);
    }
  },
  socialButtons() {
    if (!this.social() || this.phase() !== 'hunt') return '';
    const me = this.me;
    if (me.role === 'dead' || me.role === 'escaped') return `<div class="ab" style="cursor:default">👻<span class="t">${t(me.role === 'dead' ? 'deadT' : 'escT')}</span><span class="s">${t('deadS')}</span></div>`;
    const ok = this.t >= this.meetReadyAt && !this.votes && !this.evac;
    return `<button class="ab ${ok ? '' : 'wait'}" data-a="meet" style="color:var(--gold)">📢<span class="t">${t('meet')}</span><span class="s">${ok ? t('ready') : this.evac ? '🚁' : Math.ceil(Math.max(0, this.meetReadyAt - this.t)) + ' ' + t('sec')}</span></button>`;
  },
  socialBanner() {
    if (!this.social()) return '';
    const me = this.me;
    if (me.role === 'hunter' && !this.evac) return `<div class="banner red"><div class="bi">🔪</div><div>${t('impYou')} ${this.t < this.killReadyAt ? '· ' + t('killCdShort', { s: Math.ceil(this.killReadyAt - this.t) }) : '· ' + t('ready')}</div></div>`;
    if (this.evac && (me.role === 'hider')) return `<div class="banner green"><div class="bi">🚁</div><div>${t('evacGo')}</div></div>`;
    if (me.role === 'hider') return `<div class="banner blue"><div class="bi">🌫</div><div>${t('fogHint')}</div></div>`;
    return '';
  },
};
