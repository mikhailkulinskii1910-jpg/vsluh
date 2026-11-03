// Подтверждение поимки кодом (онлайн, живые игроки).
// Охотник нажимает «Поймал» → организатор присылает прячущемуся 4-значный код, тот видит его на экране →
// охотник вводит код → организатор засчитывает поимку. Боты ловятся сразу, как раньше.
import { t } from './i18n.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const CODE_TTL = 60, MAX_TRIES = 3;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const catchCodeMixin = {
  needCode(hunter, h) { return !!this.net && this.cfg.catchCode !== false && !h.bot && !hunter.bot; },

  /** Охотник выбрал игрока в окне «Поймал». */
  requestCatch(h) {
    if (!this.needCode(this.me, h)) { if (this.isClient) this.netSend('req', { k: 'catch', h: h.id, r: !!this.ch.reach }); else this.catchPlayer(this.me, h); return; }
    if (this.isClient) this.netSend('req', { k: 'catchstart', h: h.id, r: !!this.ch.reach });
    else this.startCatch(this.me, h, !!this.ch.reach);
  },

  // ---------- организатор ----------
  startCatch(hunter, h, reach) {
    const lim = reach ? 260 : this.cfg.mode === 'gps' ? 45 : 30;
    if (hunter.role !== 'hunter' || h.role !== 'hider' || dist(hunter, h) > lim) {
      if (hunter === this.me) this.alert('yellow', t('nobodyNear', { d: this.catchRange() }), 'target'); else this.netSend('nocatch', {}, hunter.id);
      return;
    }
    const code = String(Math.floor(1000 + Math.random() * 9000));
    (this.pendCodes = this.pendCodes || {})[h.id] = { code, hunter: hunter.id, until: this.t + CODE_TTL, tries: 0 };
    if (h === this.me) this.showCode(code, hunter.name); else this.netSend('ccode', { code, by: hunter.name }, h.id);
    if (hunter === this.me) this.askCode(h); else this.netSend('cwait', { h: h.id, n: h.name }, hunter.id);
  },
  confirmCatch(hunter, h, code) {
    const p = (this.pendCodes || {})[h.id];
    if (p && p.hunter === hunter.id && this.t < p.until && String(code).trim() === p.code && h.role === 'hider') {
      delete this.pendCodes[h.id];
      if (h === this.me) this.hideCode(); else this.netSend('cclear', {}, h.id);
      this.catchPlayer(hunter, h);
      return;
    }
    if (p) p.tries++;
    const over = !p || p.tries >= MAX_TRIES || this.t >= p.until;
    if (over && p) { delete this.pendCodes[h.id]; if (h === this.me) this.hideCode(); else this.netSend('cclear', {}, h.id); }
    if (hunter === this.me) this.alert('red', over ? t('codeOver') : t('codeBad'), 'lock'); else this.netSend('cbad', { over }, hunter.id);
    if (!over && hunter === this.me) this.askCode(h);
  },

  // ---------- охотник ----------
  askCode(h) {
    this.opts.modal(`<h2>🔢 ${t('codeAsk', { n: esc(h.name) })}</h2><p style="color:var(--muted)">${t('codeAskS')}</p>
      <input class="input code-input" id="ccIn" inputmode="numeric" maxlength="4" autocomplete="off" style="letter-spacing:.5em;font-size:32px">
      <div class="row" style="margin-top:14px"><button class="btn" data-x style="flex:1">${t('cancel')}</button><button class="btn primary" data-ok style="flex:1">${t('codeOk')}</button></div>`, (box, close) => {
      const inp = box.querySelector('#ccIn'); setTimeout(() => inp.focus(), 60);
      const ok = () => { const v = inp.value.replace(/\D/g, ''); if (v.length !== 4) return; close(); if (this.isClient) this.netSend('req', { k: 'catchconfirm', h: h.id, code: v }); else this.confirmCatch(this.me, h, v); };
      inp.oninput = () => { inp.value = inp.value.replace(/\D/g, '').slice(0, 4); if (inp.value.length === 4) ok(); };
      box.querySelector('[data-ok]').onclick = ok; box.querySelector('[data-x]').onclick = close;
    });
  },

  // ---------- прячущийся ----------
  showCode(code, by) {
    this.hideCode();
    const el = document.createElement('div'); el.className = 'code-cover';
    el.innerHTML = `<div class="code-card"><div class="k">🚨 ${t('codeShow', { n: esc(by) })}</div>
      <div class="digits">${code.split('').map((d) => `<span>${d}</span>`).join('')}</div>
      <div class="s">${t('codeShowS')}</div><div class="tmr" id="ccT"></div>
      <button class="btn" data-x style="margin-top:12px">${t('codeHide')}</button></div>`;
    this.root.querySelector('#game').appendChild(el);
    el.querySelector('[data-x]').onclick = () => this.hideCode();
    const until = Date.now() + CODE_TTL * 1000;
    this.codeTimer = setInterval(() => { const s = Math.ceil((until - Date.now()) / 1000); const tt = el.querySelector('#ccT'); if (tt) tt.textContent = s + ' ' + t('sec'); if (s <= 0) this.hideCode(); }, 250);
    this.vibrate([300, 100, 300, 100, 300]);
  },
  hideCode() { clearInterval(this.codeTimer); const el = this.root && this.root.querySelector('.code-cover'); if (el) el.remove(); },

  /** Сообщения кода поимки. true — обработано. */
  codeNet(type, d, from) {
    const P = (id) => this.players.find((p) => p.id === id);
    if (type === 'ccode') { this.showCode(d.code, d.by); return true; }
    if (type === 'cclear') { this.hideCode(); return true; }
    if (type === 'cwait') { const h = P(d.h); if (h) this.askCode(h); return true; }
    if (type === 'cbad') { this.alert('red', d.over ? t('codeOver') : t('codeBad'), 'lock'); return true; }
    if (type === 'req' && this.isHost && (d.k === 'catchstart' || d.k === 'catchconfirm')) {
      const hunter = P(from), h = P(d.h); if (!hunter || !h || this.phase() !== 'hunt') return true;
      if (d.k === 'catchstart') this.startCatch(hunter, h, d.r); else this.confirmCatch(hunter, h, d.code);
      return true;
    }
    return false;
  },
};
