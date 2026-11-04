// Радар для режима «В помещении»: вместо карты — круг, в центре вы, точки — другие игроки по направлению
// (с учётом компаса телефона) и расстоянию. Обновляется «лучом» каждые 5 секунд.
// Этажи: высота по барометру (в APK) или по GPS; разница с другим игроком — в этажах (3 м на этаж).
// Охотник может поставить под собой капкан (например, в дверном проёме).
import { t } from './i18n.js';

const SWEEP = 5, RMAX = 40, FLOOR_H = 3, TRAP_CD = 45, TRAP_MAX = 3;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export const radarMixin = {
  radarInit() {
    this.heading = null; this.sweepAt = -99; this.blips = []; this.h0 = null; this.myH = null; this.trapAt = 0;
    if (!this.indoor()) return;
    // компас телефона
    const onOri = (e) => {
      let h = null;
      if (e.webkitCompassHeading != null) h = e.webkitCompassHeading;
      else if (e.absolute && e.alpha != null) h = 360 - e.alpha;
      if (h != null) { this.heading = h; if (!this.hasCompass) { this.hasCompass = true; if (this.root) { const el = this.root.querySelector('.indoor-cover'); if (el) el._html = null; } } }
    };
    this.oriFn = onOri;
    window.addEventListener('deviceorientationabsolute', onOri);
    window.addEventListener('deviceorientation', onOri);
    // боты — на разных этажах
    for (const p of this.players) if (p.bot) p.hOff = FLOOR_H * (Math.floor(Math.random() * 3) - 1);
  },
  radarStop() { if (this.oriFn) { window.removeEventListener('deviceorientationabsolute', this.oriFn); window.removeEventListener('deviceorientation', this.oriFn); } },
  /** Высота, м: барометр (APK) точнее GPS. */
  readHeight() {
    try { const p = window.MapTagNative && window.MapTagNative.pressure ? Number(window.MapTagNative.pressure()) : 0; if (p > 300) return 44330 * (1 - Math.pow(p / 1013.25, 0.1903)); } catch {}
    return this.lastAlt != null ? this.lastAlt : null;
  },
  floorOf(h) { return this.h0 == null || h == null ? 0 : Math.round((h - this.h0) / FLOOR_H); },
  radarLocal() {
    if (!this.indoor()) return;
    // поворот по компасу — напрямую, без перерисовки панели (иначе кнопки не нажимаются)
    const g = this.root && this.root.querySelector('.radar .rot'); if (g && this.heading != null) g.setAttribute('transform', `rotate(${(-this.heading).toFixed(0)} 100 100)`);
    const h = this.readHeight();
    if (h != null) { this.myH = this.myH == null ? h : this.myH * 0.7 + h * 0.3; if (this.h0 == null) { this.h0 = this.myH; for (const p of this.players) if (p.bot && p.hOff != null) p.h = this.h0 + p.hOff; } this.me.h = this.myH; }
    if (this.t - this.sweepAt >= SWEEP) {
      this.sweepAt = this.t;
      const me = this.me;
      this.blips = this.players.filter((p) => p !== me && (p.role === 'hider' || p.role === 'hunter')).map((p) => {
        const d = dist(p, me), ang = Math.atan2(p.x - me.x, p.y - me.y) * 180 / Math.PI;
        const df = p.h != null && me.h != null ? Math.round((p.h - me.h) / FLOOR_H) : 0;
        return { name: p.name, role: p.role, d, ang, df, exp: this.t < (p.exposedUntil || 0) };
      });
      if (this.root) { const el = this.root.querySelector('.indoor-cover'); if (el) el._html = null; }
    }
  },
  radarHtml() {
    const me = this.me;
    const dots = this.blips.map((b) => {
      const r = Math.min(1, b.d / RMAX) * 92, a = b.ang * Math.PI / 180;
      const x = 100 + Math.sin(a) * r, y = 100 - Math.cos(a) * r;
      const col = b.role === 'hunter' ? '#f26d7d' : '#5fd38d';
      const fl = b.df ? `<text x="${x + 7}" y="${y + 4}" class="rf">${b.df > 0 ? '↑' : '↓'}${Math.abs(b.df)}</text>` : '';
      return `<circle class="blip" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${b.exp ? 7 : 5}" fill="${col}" ${b.exp ? 'stroke="#fff" stroke-width="2"' : ''}/>${fl}`;
    }).join('');
    const fl = this.floorOf(me.h);
    return `<div class="radar-wrap"><svg class="radar" viewBox="0 0 200 200">
      <circle cx="100" cy="100" r="96" class="rr"/><circle cx="100" cy="100" r="64" class="rr"/><circle cx="100" cy="100" r="32" class="rr"/>
      <line x1="100" y1="4" x2="100" y2="196" class="rl"/><line x1="4" y1="100" x2="196" y2="100" class="rl"/>
      <g class="sweep" style="animation-duration:${SWEEP}s"><path d="M100 100 L100 4 A96 96 0 0 1 168 32 Z" fill="url(#sw)"/></g>
      <defs><linearGradient id="sw" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5fd38d" stop-opacity=".0"/><stop offset="1" stop-color="#5fd38d" stop-opacity=".35"/></linearGradient></defs>
      <g class="rot"><text x="100" y="14" class="rn">N</text>${dots}</g><circle cx="100" cy="100" r="6" fill="#fff"/></svg>
      <div class="radar-info"><span>${t('radarScale', { m: RMAX })}</span><span>${this.hasCompass ? '🧭 ' + t('radarCompass') : '🧭 ' + t('radarNoCompass')}</span><span>🏢 ${t('floorNow', { f: fl > 0 ? '+' + fl : fl })}</span></div></div>`;
  },

  // ---------- капкан охотника ----------
  trapAvailable() { return this.me.role === 'hunter' && this.phase() === 'hunt' && (this.indoor() || this.cfg.mode === 'gps'); },
  placeTrap() {
    if (!this.trapAvailable() || this.t < this.trapAt) return;
    if ((this.myTraps || 0) >= TRAP_MAX) { this.alert('yellow', t('trapMax', { n: TRAP_MAX }), 'lock'); return; }
    this.trapAt = this.t + TRAP_CD;
    this.spawnAt('snare', this.me);
    this.myTraps = (this.myTraps || 0) + 1;
    this.alert('green', t('trapPlaced'), 'lock'); this.vibrate([80]); this.renderHud(true);
  },
  trapButton() {
    if (!this.trapAvailable()) return '';
    const ok = this.t >= this.trapAt;
    return `<button class="ab ${ok ? '' : 'wait'}" data-a="trap" style="color:#c0c0c0">🕸<span class="t">${t('obj_snare')}</span><span class="s">${ok ? t('ready') : Math.ceil(this.trapAt - this.t) + ' ' + t('sec')}</span></button>`;
  },
};
