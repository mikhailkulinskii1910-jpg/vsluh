/* Геометрия для «Велокарты». Один файл работает и в браузере (window.VeloGeo),
   и на сервере (require('../js/geo.js')) — сервер считает прогресс гонки по тем же формулам. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VeloGeo = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const R = 6371008.8; // средний радиус Земли, м
  const rad = d => (d * Math.PI) / 180;
  const deg = r => (r * 180) / Math.PI;

  /** Расстояние по большому кругу между двумя точками, м. */
  function distance(lat1, lon1, lat2, lon2) {
    const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /** Азимут от точки 1 к точке 2, градусы 0..360 (0 — север). */
  function bearing(lat1, lon1, lat2, lon2) {
    const p1 = rad(lat1), p2 = rad(lat2), dl = rad(lon2 - lon1);
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (deg(Math.atan2(y, x)) + 360) % 360;
  }

  /** Длина ломаной coords = [[lat, lon], ...], м. */
  function lineLength(coords) {
    let total = 0;
    for (let i = 1; i < coords.length; i++) total += distance(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
    return total;
  }

  /**
   * Проекция точки на ломаную.
   * Возвращает: dist — расстояние от точки до ломаной (м), along — пройденная длина вдоль ломаной до ближайшей точки (м), total — длина ломаной (м).
   */
  function projectOnPolyline(coords, lat, lon) {
    if (!coords.length) return { dist: Infinity, along: 0, total: 0 };
    if (coords.length === 1) return { dist: distance(lat, lon, coords[0][0], coords[0][1]), along: 0, total: 0 };
    let best = { dist: Infinity, along: 0 }, acc = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      const [aLat, aLon] = coords[i], [bLat, bLon] = coords[i + 1];
      const segLen = distance(aLat, aLon, bLat, bLon);
      // локальные плоские координаты (м) относительно начала отрезка
      const k = Math.cos(rad(aLat));
      const bx = rad(bLon - aLon) * R * k, by = rad(bLat - aLat) * R;
      const px = rad(lon - aLon) * R * k, py = rad(lat - aLat) * R;
      const len2 = bx * bx + by * by;
      let t = len2 ? (px * bx + py * by) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - bx * t, py - by * t);
      if (d < best.dist) best = { dist: d, along: acc + segLen * t };
      acc += segLen;
    }
    return { dist: best.dist, along: best.along, total: acc };
  }

  /** Форматирование: метры → «850 м» / «12.4 км». */
  function formatDistance(m) {
    if (!isFinite(m)) return '—';
    if (m < 1000) return Math.round(m) + ' м';
    return (m / 1000).toFixed(m < 10000 ? 2 : 1) + ' км';
  }

  /** Секунды → «1 ч 05 мин» / «12:34». */
  function formatDuration(sec) {
    if (!isFinite(sec) || sec < 0) return '—';
    sec = Math.round(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h) return `${h} ч ${String(m).padStart(2, '0')} мин`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  /** м/с → км/ч, одна цифра после запятой. */
  function formatSpeed(ms) {
    if (ms == null || !isFinite(ms)) return '—';
    return (ms * 3.6).toFixed(1) + ' км/ч';
  }

  /* ---- Тайлы OpenStreetMap (схема XYZ) ---- */

  function lonLatToTile(lat, lon, z) {
    const n = 2 ** z;
    const x = Math.floor(((lon + 180) / 360) * n);
    const latR = rad(Math.max(-85.0511, Math.min(85.0511, lat)));
    const y = Math.floor(((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n);
    return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
  }

  /** Список тайлов, покрывающих прямоугольник bounds = {south, west, north, east} на зумах zmin..zmax. */
  function tilesForBounds(bounds, zmin, zmax) {
    const out = [];
    for (let z = zmin; z <= zmax; z++) {
      const a = lonLatToTile(bounds.north, bounds.west, z); // верхний левый
      const b = lonLatToTile(bounds.south, bounds.east, z); // нижний правый
      for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) out.push({ z, x, y });
    }
    return out;
  }

  /** Точка на ломаной на расстоянии d (м) от начала. */
  function pointAlong(coords, cum, d) {
    if (d <= 0) return coords[0];
    const last = coords.length - 1;
    if (d >= cum[last]) return coords[last];
    let lo = 0, hi = last;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= d) lo = mid; else hi = mid; }
    const seg = cum[hi] - cum[lo] || 1, t = (d - cum[lo]) / seg;
    return [coords[lo][0] + (coords[hi][0] - coords[lo][0]) * t, coords[lo][1] + (coords[hi][1] - coords[lo][1]) * t];
  }

  /** Накопленные расстояния вдоль ломаной. */
  function cumulative(coords) {
    const cum = [0];
    for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + distance(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]));
    return cum;
  }

  /**
   * Повороты по геометрии маршрута (без названий улиц).
   * Возвращает [{along (м от старта), dir: 'left'|'right', kind: 'slight'|'turn'|'sharp'|'uturn'}].
   */
  function findTurns(coords, minDeg = 35, look = 25) {
    if (coords.length < 3) return [];
    const cum = cumulative(coords), total = cum[cum.length - 1];
    const samples = [];
    for (let i = 1; i < coords.length - 1; i++) {
      const d = cum[i];
      if (d < look * 0.5 || d > total - look * 0.5) continue;
      const a = pointAlong(coords, cum, d - look), b = pointAlong(coords, cum, d + look);
      const b1 = bearing(a[0], a[1], coords[i][0], coords[i][1]);
      const b2 = bearing(coords[i][0], coords[i][1], b[0], b[1]);
      samples.push({ along: d, delta: ((b2 - b1 + 540) % 360) - 180 });
    }
    // склеиваем соседние отклонения одного знака в один поворот
    const groups = [];
    let g = null;
    for (const s of samples) {
      if (Math.abs(s.delta) < 6) continue;
      if (g && Math.sign(g.sum) === Math.sign(s.delta) && s.along - g.last <= 40) {
        g.sum += s.delta; g.last = s.along;
        if (Math.abs(s.delta) > Math.abs(g.peak)) { g.peak = s.delta; g.along = s.along; }
      } else {
        if (g) groups.push(g);
        g = { sum: s.delta, peak: s.delta, along: s.along, last: s.along };
      }
    }
    if (g) groups.push(g);
    return groups
      .filter(t => Math.abs(t.sum) >= minDeg)
      .map(t => {
        const a = Math.abs(t.sum);
        const kind = a < 55 ? 'slight' : a < 120 ? 'turn' : a < 165 ? 'sharp' : 'uturn';
        return { along: t.along, dir: t.sum > 0 ? 'right' : 'left', kind };
      });
  }

  return { R, distance, bearing, lineLength, projectOnPolyline, formatDistance, formatDuration, formatSpeed, lonLatToTile, tilesForBounds, cumulative, pointAlong, findTurns };
});
