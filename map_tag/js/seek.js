// Помощники поиска: компас на ближайшего соперника и детектор расстояния («холодно — горячо»).
import { t } from './i18n.js';
import { beep } from './sound.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const BANDS = [[50, 'veryHot', '#ff3b30'], [150, 'hot', '#ff8a3d'], [300, 'warm', '#f6c453'], [Infinity, 'cold', '#6fb7ff']];
const COMPASS_EVERY = 20, DETECTOR_EVERY = 3;

const FOG_R = 120;

export const seekMixin = {
  fogOn() { const v = this.cfg.fog || 'off'; return !this.ch.wall && this.me.role !== 'spectator' && (v === 'all' || (v === 'hunters' && this.me.role === 'hunter')); },
  /** «Туман войны»: карта видна только рядом с игроком. Отдельная панель Leaflet под кругами и маркерами. */
  drawFog() {
    if (!this.fogOn()) { if (this.fogEl) this.fogEl.style.display = 'none'; return; }
    if (!this.fogEl) {
      const pane = this.map.createPane('fog'); pane.style.zIndex = 350; pane.style.pointerEvents = 'none';
      this.fogEl = document.createElement('div'); this.fogEl.className = 'fog'; pane.appendChild(this.fogEl);
    }
    const c = this.map.latLngToLayerPoint(this.ll(this.me));
    const e = this.map.latLngToLayerPoint(this.ll({ x: this.me.x + FOG_R, y: this.me.y }));
    const r = Math.max(30, Math.abs(e.x - c.x)), S = 8000;
    Object.assign(this.fogEl.style, { display: '', left: (c.x - S / 2) + 'px', top: (c.y - S / 2) + 'px', width: S + 'px', height: S + 'px',
      background: `radial-gradient(circle at 50% 50%, transparent ${r * 0.75}px, rgba(8,10,16,.93) ${r}px)` });
  },

  seekOn(kind) {
    const v = this.cfg[kind] || 'off';
    if (this.ch.radar) return true;
    // «Невидимки» и «Зомби»: у охотников всегда детектор
    if (kind === 'detector' && (this.cfg.gmode === 'ghosts' || this.cfg.gmode === 'zombie' || this.cfg.gmode === 'predator') && this.me.role === 'hunter') return true;
    return v === 'all' || (v === 'hunters' && this.me.role === 'hunter');
  },
  seekActive() { return this.me.role !== 'spectator' && this.phase() === 'hunt' && (this.seekOn('compass') || this.seekOn('detector')); },
  seekTarget() {
    const me = this.me;
    const others = me.role === 'hunter' ? this.hiders() : this.hunters().filter((p) => p !== me);
    let best = null, bd = Infinity;
    for (const p of others) { if (p.left) continue; const d = dist(p, me); if (d < bd) { bd = d; best = p; } }
    return best ? { p: best, d: bd } : null;
  },

  startHeading() {
    if (this.headingOn) return;
    this.headingOn = true;
    this.onOrient = (e) => {
      let h = null;
      if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
      else if (e.absolute && typeof e.alpha === 'number') h = (360 - e.alpha) % 360;
      if (h != null) { this.heading = h; this.headingAt = Date.now(); }
    };
    window.addEventListener('deviceorientationabsolute', this.onOrient);
    window.addEventListener('deviceorientation', this.onOrient);
  },
  stopHeading() {
    if (!this.onOrient) return;
    window.removeEventListener('deviceorientationabsolute', this.onOrient);
    window.removeEventListener('deviceorientation', this.onOrient);
  },
  async askHeading() {
    try { if (window.DeviceOrientationEvent && DeviceOrientationEvent.requestPermission) await DeviceOrientationEvent.requestPermission(); } catch {}
    this.startHeading();
  },

  seekHtml() {
    if (!this.seekActive()) return '';
    const c = this.seekOn('compass'), d = this.seekOn('detector');
    return `<div class="seek">
      ${c ? `<button class="seek-c" data-a="heading" aria-label="compass"><svg viewBox="-50 -50 100 100"><circle r="46" class="ring"/><text y="-33" text-anchor="middle" class="n" id="skN">N</text><g id="skArrow"><path d="M0 -36 L11 6 L0 0 L-11 6 Z" class="arr"/><path d="M0 0 L11 6 L0 30 L-11 6 Z" class="tail"/></g><circle r="4" class="hub"/></svg></button>` : ''}
      <div class="seek-i">
        <div class="seek-k">${this.me.role === 'hunter' ? t('seekToHider') : t('seekToHunter')}</div>
        ${d ? `<div class="seek-band" id="skBand">—</div><div class="seek-bars" id="skBars"><i></i><i></i><i></i><i></i></div>` : ''}
        <div class="seek-s" id="skSub"></div>
      </div></div>`;
  },

  seekUpdate() {
    const box = this.root.querySelector('.seek');
    if (!box) return;
    const tg = this.seekTarget();
    const exact = !!this.ch.radar;
    const sub = box.querySelector('#skSub');
    if (!tg) { sub.textContent = t('seekNone'); return; }
    // компас: направление «замораживается» на 20 с (с читом — живое)
    if (this.seekOn('compass')) {
      if (exact || !this.cmpFix || this.t - this.cmpFix.t >= COMPASS_EVERY) this.cmpFix = { t: this.t, x: tg.p.x, y: tg.p.y };
      const f = this.cmpFix, me = this.me;
      const bearing = Math.atan2(f.x - me.x, f.y - me.y) * 180 / Math.PI;
      const live = this.heading != null && Date.now() - (this.headingAt || 0) < 3000;
      const rot = bearing - (live ? this.heading : 0);
      box.querySelector('#skArrow').setAttribute('transform', `rotate(${rot.toFixed(1)})`);
      box.querySelector('#skN').setAttribute('transform', `rotate(${live ? -this.heading : 0}) `);
      const left = exact ? 0 : Math.ceil(COMPASS_EVERY - (this.t - f.t));
      sub.textContent = (exact ? `${Math.round(tg.d)} ${t('m')} · ${tg.p.name}` : t('seekNext', { s: left })) + (live ? '' : ' · ' + t('seekNorth'));
    } else sub.textContent = exact ? `${Math.round(tg.d)} ${t('m')} · ${tg.p.name}` : '';
    // детектор: полоса расстояния, обновляется раз в 3 с
    if (this.seekOn('detector')) {
      if (exact || !this.detFix || this.t - this.detFix.t >= DETECTOR_EVERY) {
        const bi = BANDS.findIndex(([lim]) => tg.d < lim);
        const prev = this.detFix ? this.detFix.bi : 99;
        this.detFix = { t: this.t, bi };
        if (bi < prev && bi <= 2) { beep(bi <= 1 ? 'red' : 'yellow'); this.vibrate(bi === 0 ? [120, 60, 120, 60, 120] : [120]); }
        else if (bi === 0 && Math.round(this.t) % 6 === 0) beep('red');
      }
      const [, key, col] = BANDS[this.detFix.bi];
      const band = box.querySelector('#skBand');
      band.textContent = t('det_' + key) + (exact ? ` · ${Math.round(tg.d)} ${t('m')}` : '');
      band.style.color = col;
      box.querySelectorAll('#skBars i').forEach((el, i) => { el.style.background = 3 - i >= this.detFix.bi ? col : ''; });
    }
  },
};
