// Этажи. Перед игрой организатор проходит по этажам и на каждом нажимает «Записать этаж» — сохраняется высота
// (барометр в APK или высота GPS). В игре каждый телефон считает свой этаж: высота относительно старта + высота
// стартового этажа → ближайший записанный этаж. Зоны и объекты с этажом действуют только на игроков того же этажа.
import { t } from './i18n.js';

export const floorsMixin = {
  floorsInit() {
    const f = this.cfg.floors;
    this.floorsRel = Array.isArray(f) && f.length >= 2 ? f : null;
    this.startFloor = Math.max(0, Math.min((this.floorsRel || [0]).length - 1, this.cfg.startFloor || 0));
    this.myFl = this.floorsRel ? this.startFloor : null; this.fh0 = null; this.flCand = null;
    if (this.floorsRel) for (const p of this.players) if (p.bot) p.fl = Math.floor(Math.random() * this.floorsRel.length);
    if (this.me) this.me.fl = this.myFl;
  },
  floorsOn() { return !!this.floorsRel; },
  /** Этаж игрока (индекс) или null, если этажи не настроены. */
  flOf(p) {
    if (!this.floorsRel || !p) return null;
    if (p === this.me) return this.myFl;
    return p.fl != null ? p.fl : this.startFloor;
  },
  /** Предмет/зона с этажом f доступна игроку p? */
  okF(f, p) { if (f == null || !this.floorsRel) return true; const pf = this.flOf(p); return pf == null || pf === f; },
  floorName(i) { return t('floorN', { n: i + 1 }); },
  floorsLocal() {
    if (!this.floorsRel) return;
    const h = this.readHeight(); if (h == null) return;
    this.fhS = this.fhS == null ? h : this.fhS * 0.7 + h * 0.3;
    if (this.fh0 == null) this.fh0 = this.fhS;
    const rel = this.fhS - this.fh0 + this.floorsRel[this.startFloor];
    let best = 0; this.floorsRel.forEach((v, i) => { if (Math.abs(v - rel) < Math.abs(this.floorsRel[best] - rel)) best = i; });
    if (best === this.myFl) { this.flCand = null; return; }
    // смена этажа — только если держится 2 секунды (барометр «плавает»)
    if (!this.flCand || this.flCand.i !== best) { this.flCand = { i: best, t: this.t }; return; }
    if (this.t - this.flCand.t >= 2) {
      this.myFl = best; this.me.fl = best; this.flCand = null;
      this.alert('blue', t('floorNow2', { f: this.floorName(best) }), 'house'); this.vibrate([60]); this.renderHud(true);
    }
  },
};

/** Высота сейчас (для записи этажей в лобби): барометр APK, иначе GPS. */
export function readHeightNow() {
  return new Promise((res) => {
    try { const p = window.MapTagNative && window.MapTagNative.pressure ? Number(window.MapTagNative.pressure()) : 0; if (p > 300) return res({ h: 44330 * (1 - Math.pow(p / 1013.25, 0.1903)), src: 'baro' }); } catch {}
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition((pos) => res(pos.coords.altitude != null ? { h: pos.coords.altitude, src: 'gps' } : null), () => res(null), { enableHighAccuracy: true, timeout: 10000 });
  });
}
