/* Маршруты: разбор ответа BRouter, доля велодорожек, выбор варианта
   «максимум велодорожек без потери времени». Работает в браузере (window.VeloRouting) и в Node (тесты). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VeloRouting = api;
})(typeof self !== 'undefined' ? self : this, function () {
  /** Строка тегов BRouter «highway=cycleway surface=asphalt» → объект. */
  function tagsToObj(s) {
    const o = {};
    for (const kv of String(s || '').split(' ')) {
      const i = kv.indexOf('=');
      if (i > 0) o[kv.slice(0, i)] = kv.slice(i + 1);
    }
    return o;
  }

  /** Участок — велоинфраструктура: велодорожка, велополоса, обозначенная велотропа или веломаршрут. */
  function isBikeTags(s) {
    const t = tagsToObj(s);
    if (t.highway === 'cycleway') return true;
    if (t.bicycle === 'designated') return true;
    for (const k of Object.keys(t)) {
      if (k.startsWith('cycleway') && !['no', 'none', 'separate', 'shared_lane'].includes(t[k])) return true;
      if (k.startsWith('route_bicycle_')) return true;
    }
    return false;
  }

  /**
   * Разбор GeoJSON-ответа BRouter.
   * bikeShare — доля длины по велоинфраструктуре (null, если профиль не отдаёт теги, как fastbike);
   * bikeFlags[i] — участок, который заканчивается в точке i, идёт по велоинфраструктуре.
   */
  function parseBRouter(gj) {
    const f = gj.features[0];
    const p = f.properties;
    const coords = f.geometry.coordinates.map(c => [c[1], c[0]]);
    const msgs = p.messages || [];
    let bikeShare = null, bikeFlags = null;
    if (msgs.length > 1) {
      const h = msgs[0];
      const iLon = h.indexOf('Longitude'), iLat = h.indexOf('Latitude'), iD = h.indexOf('Distance'), iT = h.indexOf('WayTags');
      const rows = msgs.slice(1);
      if (iT >= 0 && rows.some(r => /(^| )highway=/.test(r[iT]))) {
        let total = 0, bike = 0;
        for (const r of rows) {
          const d = +r[iD] || 0;
          total += d;
          if (isBikeTags(r[iT])) bike += d;
        }
        bikeShare = total ? bike / total : 0;
        // строка сообщения описывает участок до своей конечной точки
        bikeFlags = new Array(coords.length).fill(false);
        let ri = 0;
        for (let i = 0; i < coords.length; i++) {
          const r = rows[Math.min(ri, rows.length - 1)];
          bikeFlags[i] = isBikeTags(r[iT]);
          const lat = +r[iLat] / 1e6, lon = +r[iLon] / 1e6;
          if (ri < rows.length - 1 && Math.abs(coords[i][0] - lat) < 2e-6 && Math.abs(coords[i][1] - lon) < 2e-6) ri++;
        }
      }
    }
    return {
      coords,
      distance: +p['track-length'] || 0,
      time: +p['total-time'] || 0,
      ascent: +p['filtered ascend'] || 0,
      bikeShare,
      bikeFlags,
    };
  }

  /** Единая «стоимость» для сравнения вариантов разных профилей: метры + подъём (8 м пути за 1 м подъёма). */
  function cost(r) { return r.distance + 8 * r.ascent; }

  /**
   * Выбор варианта: среди тех, что дороже самого выгодного не больше чем на tol (0% — без потери времени),
   * берём вариант с наибольшей долей велодорожек; при равенстве (±1%) — более короткий.
   * extraM — сколько «метров стоимости» добавил выбор по сравнению с самым выгодным.
   */
  function pickBest(cands, tol = 0) {
    const minCost = Math.min(...cands.map(cost));
    const ok = cands.filter(r => r.bikeShare != null && cost(r) <= minCost * (1 + tol));
    let pick;
    if (ok.length) {
      pick = ok.reduce((a, b) => {
        const diff = b.bikeShare - a.bikeShare;
        if (diff > 0.01) return b;
        if (Math.abs(diff) <= 0.01 && cost(b) < cost(a)) return b;
        return a;
      });
    } else {
      pick = cands.reduce((a, b) => (cost(b) < cost(a) ? b : a));
    }
    return Object.assign({}, pick, { extraM: Math.round(cost(pick) - minCost), candidates: cands.length });
  }

  /** Ломаная маршрута → отрезки «велодорожка / обычная дорога» для раскраски. */
  function splitByBike(coords, flags) {
    if (!flags || flags.length !== coords.length) return [{ bike: false, coords }];
    const runs = [];
    let cur = null;
    for (let i = 1; i < coords.length; i++) {
      const b = flags[i];
      if (!cur || cur.bike !== b) {
        cur = { bike: b, coords: [coords[i - 1]] };
        runs.push(cur);
      }
      cur.coords.push(coords[i]);
    }
    return runs.length ? runs : [{ bike: false, coords }];
  }

  return { tagsToObj, isBikeTags, parseBRouter, cost, pickBest, splitByBike };
});
