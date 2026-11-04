// «В помещении» 2.0: комнаты. Прячущийся тайно отмечает, в какой комнате прячется (видит только организатор).
// Охотник проверяет комнату (раз в 30 с): «тепло» — кто-то есть, «пусто» — никого; те, кто в ней, получают тревогу.
// Каждые 75 с охотникам подсказка: комната, где кто-то есть. Перебежка в другую комнату во время охоты — охотники
// узнают, что кто-то перебежал. Поимка — как раньше, по коду с экрана пойманного.
import { t } from './i18n.js';
import { playFx } from './sound.js';

const CHK_CD = 30, HINT_EVERY = 75;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const DEFAULT_ROOMS = { ru: ['Кухня', 'Гостиная', 'Спальня', 'Ванная', 'Коридор', 'Балкон'], en: ['Kitchen', 'Living room', 'Bedroom', 'Bathroom', 'Hallway', 'Balcony'] };

export const indoorMixin = {
  roomsInit() {
    this.rooms = (this.cfg.rooms && this.cfg.rooms.length ? this.cfg.rooms : DEFAULT_ROOMS[this.opts.lang === 'en' ? 'en' : 'ru']).slice(0, 12);
    this.roomRes = {}; this.roomChkAt = 0; this.nextHint = (this.cfg.hideSec || 0) + HINT_EVERY;
    if (!this.indoor()) return;
    this.botIndoorAt = (this.cfg.hideSec || 0) + 30 + Math.random() * 20;
    for (const p of this.players) p.room = p.bot && p.role === 'hider' ? Math.floor(Math.random() * this.rooms.length) : -1;
  },
  rn(i) { return this.rooms[i] || '?'; },

  // ---------- действия ----------
  pickRoom(i) {
    const me = this.me; if (me.role !== 'hider' || i === me.room) return;
    const moved = this.phase() === 'hunt' && me.room >= 0;
    me.room = i;
    if (this.isClient) this.netSend('room', { r: i }); else if (moved) this.onRoomMove(me);
    this.alert('green', t('roomSet', { r: this.rn(i) }), 'house');
    this.renderIndoor();
  },
  onRoomMove(p) {   // организатор / офлайн
    this.netSend('roommove', {});
    if (this.me.role === 'hunter') this.alert('yellow', t('roomMoved'), 'run');
  },
  checkRoom(i) {
    if (this.me.role !== 'hunter' || this.phase() !== 'hunt' || this.t < this.roomChkAt) return;
    this.roomChkAt = this.t + CHK_CD;
    if (this.isClient) this.netSend('roomchk', { r: i }); else this.doCheck(this.me, i);
    this.renderIndoor();
  },
  doCheck(by, i) {   // организатор / офлайн
    const n = this.hiders().filter((h) => h.room === i).length;
    this.netSend('roomres', { r: i, n, by: by.name });
    this.onRoomRes(i, n, by.name);
  },
  onRoomRes(i, n, by) {
    this.roomRes[i] = { n, t: this.t };
    const me = this.me;
    if (me.role === 'hunter') this.alert(n ? 'green' : 'blue', n ? t('roomHot', { r: this.rn(i), n }) : t('roomCold', { r: this.rn(i) }), 'scan');
    else if (me.room === i) { this.alert('red', t('roomChecked', { r: this.rn(i), n: by }), 'signal'); this.vibrate([400, 150, 400]); playFx('drum'); }
    this.renderIndoor();
  },
  onRoomHint(i) {
    this.roomRes[i] = { n: 1, t: this.t, hint: true };
    if (this.me.role === 'hunter') this.alert('green', t('roomHint', { r: this.rn(i) }), 'eye');
    else if (this.me.room === i) { this.alert('red', t('roomHintYou'), 'eye'); this.vibrate([200]); }
    this.renderIndoor();
  },

  // ---------- шаги ----------
  roomsStep() {   // организатор / офлайн
    if (!this.indoor() || this.phase() !== 'hunt') return;
    // кто не выбрал комнату — случайная
    for (const h of this.hiders()) if (h.room < 0 && !h.remote) { h.room = Math.floor(Math.random() * this.rooms.length); if (h === this.me) { this.alert('yellow', t('roomAuto', { r: this.rn(h.room) }), 'house'); this.renderIndoor(); } }
    if (this.t >= this.nextHint) {
      this.nextHint = this.t + HINT_EVERY;
      const occ = [...new Set(this.hiders().filter((h) => h.room >= 0).map((h) => h.room))];
      if (occ.length) { const r = occ[Math.floor(Math.random() * occ.length)]; this.netSend('roomhint', { r }); this.onRoomHint(r); }
    }
  },
  /** Бот-охотник: проверяет комнату (горячую или случайную) и ловит там одного. */
  indoorBotStep() {
    if (!this.indoor() || this.isClient || this.phase() !== 'hunt' || this.t < this.botIndoorAt) return;
    this.botIndoorAt = this.t + 30 + Math.random() * 25;
    const u = this.hunters().find((x) => x.bot); if (!u) return;
    const hot = Object.keys(this.roomRes).map(Number).filter((i) => this.roomRes[i].n > 0 && this.t - this.roomRes[i].t < 120);
    const r = hot.length && Math.random() < 0.6 ? hot[Math.floor(Math.random() * hot.length)] : Math.floor(Math.random() * this.rooms.length);
    this.doCheck(u, r);
    const pool = this.hiders().filter((h) => h.room === r && !(h === this.me && this.ch.untouch) && !h.remote);
    if (pool.length && Math.random() < 0.7) setTimeout(() => { if (!this.ended && pool[0].role === 'hider') this.catchPlayer(u, pool[0]); }, 4000);
  },

  // ---------- сеть ----------
  indoorNet(type, d, from) {
    const P = this.players.find((q) => q.id === from);
    if (type === 'room' && this.isHost) { if (P) { const moved = this.phase() === 'hunt' && P.room >= 0 && P.room !== d.r; P.room = d.r; if (moved) this.onRoomMove(P); } return true; }
    if (type === 'roomchk' && this.isHost) { if (P && P.role === 'hunter') this.doCheck(P, d.r); return true; }
    if (type === 'roomres' && this.isClient) { this.onRoomRes(d.r, d.n, d.by); return true; }
    if (type === 'roomhint' && this.isClient) { this.onRoomHint(d.r); return true; }
    if (type === 'roommove' && this.isClient) { if (this.me.role === 'hunter') this.alert('yellow', t('roomMoved'), 'run'); return true; }
    return false;
  },

  // ---------- интерфейс ----------
  roomsHtml() {
    const me = this.me, T = this.t;
    if (me.role === 'hider') {
      return `<div class="rooms-h">${me.room >= 0 ? t('roomYour', { r: esc(this.rn(me.room)) }) : t('roomPick')}</div>
        <div class="rooms">${this.rooms.map((r, i) => `<button class="room ${me.room === i ? 'on' : ''}" data-room="${i}">${esc(r)}${this.roomRes[i] && T - this.roomRes[i].t < 20 ? ' ⚠' : ''}</button>`).join('')}</div>
        <div class="rooms-note">${t('roomNoteH')}</div>`;
    }
    if (me.role === 'hunter') {
      const cd = Math.max(0, Math.ceil(this.roomChkAt - T)), ph = this.phase() === 'hunt';
      return `<div class="rooms-h">${ph ? (cd ? t('roomCd', { s: cd }) : t('roomCheck')) : t('roomWait')}</div>
        <div class="rooms">${this.rooms.map((r, i) => { const rr = this.roomRes[i], fresh = rr && T - rr.t < 120; return `<button class="room ${fresh ? (rr.n ? 'hot' : 'cold') : ''}" data-chk="${i}" ${!ph || cd ? 'disabled' : ''}>${esc(r)}${fresh ? (rr.n ? ' 🔥' : ' ❄') : ''}</button>`; }).join('')}</div>
        <div class="rooms-note">${t('roomNoteU')}</div>`;
    }
    return '';
  },
  renderIndoor() { if (this.indoor() && this.root) { const el = this.root.querySelector('.indoor-cover'); if (el) el._html = null; } },
  bindIndoor(el) {
    if (el._bound) return; el._bound = true;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-room],[data-chk]'); if (!b || b.disabled) return;
      if (b.dataset.room != null) this.pickRoom(+b.dataset.room); else this.checkRoom(+b.dataset.chk);
    });
  },
};
