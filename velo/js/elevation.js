/* Высоты: тайлы рельефа (Terrain Tiles, формат terrarium), профиль маршрута, сложность и слой «перепады высот».
   Источник: открытые данные Mapzen/AWS (elevation-tiles-prod). */
(function (root) {
  const G = root.VeloGeo;
  const TILE = 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png';
  const cache = new Map();
  const SAMPLE_Z = 13;

  function url(z, x, y) { return TILE.replace('{z}', z).replace('{x}', x).replace('{y}', y); }

  /** Загружает тайл и возвращает Float32Array высот 256×256 (м). */
  function loadTile(z, x, y) {
    const key = `${z}/${x}/${y}`;
    if (cache.has(key)) return cache.get(key);
    const p = new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = c.height = 256;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, 256, 256).data;
        const h = new Float32Array(256 * 256);
        for (let i = 0; i < h.length; i++) h[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
        resolve(h);
      };
      img.onerror = () => { cache.delete(key); reject(new Error('нет данных о высотах')); };
      img.src = url(z, x, y);
    });
    cache.set(key, p);
    return p;
  }

  /** Высота в точке (м). */
  async function elevationAt(lat, lon, z = SAMPLE_Z) {
    const n = 2 ** z;
    const fx = ((lon + 180) / 360) * n;
    const latR = (lat * Math.PI) / 180;
    const fy = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n;
    const x = Math.floor(fx), y = Math.floor(fy);
    const px = Math.min(255, Math.floor((fx - x) * 256)), py = Math.min(255, Math.floor((fy - y) * 256));
    const h = await loadTile(z, x, y);
    return h[py * 256 + px];
  }

  /** Точки маршрута через каждые stepM метров с высотами. */
  async function sampleRoute(coords, stepM = 50) {
    const cum = G.cumulative(coords), total = cum[cum.length - 1];
    const n = Math.max(2, Math.ceil(total / stepM) + 1);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const d = Math.min(total, (i * total) / (n - 1));
      const [lat, lon] = G.pointAlong(coords, cum, d);
      pts.push({ d, lat, lon });
    }
    // подгружаем нужные тайлы параллельно, потом читаем высоты
    await Promise.all([...new Set(pts.map(p => {
      const nn = 2 ** SAMPLE_Z, fx = ((p.lon + 180) / 360) * nn, lr = (p.lat * Math.PI) / 180;
      const fy = ((1 - Math.log(Math.tan(lr) + 1 / Math.cos(lr)) / Math.PI) / 2) * nn;
      return `${Math.floor(fx)}/${Math.floor(fy)}`;
    }))].map(k => { const [x, y] = k.split('/').map(Number); return loadTile(SAMPLE_Z, x, y); }));
    for (const p of pts) p.ele = await elevationAt(p.lat, p.lon);
    return pts;
  }

  /** Сглаживание высот скользящим средним (убирает шум DEM). */
  function smooth(values, win = 5) {
    const out = [];
    for (let i = 0; i < values.length; i++) {
      let s = 0, c = 0;
      for (let j = Math.max(0, i - win); j <= Math.min(values.length - 1, i + win); j++) { s += values[j]; c++; }
      out.push(s / c);
    }
    return out;
  }

  const LEVELS = [
    { max: 8, label: 'Лёгкий', tone: 'ok' },
    { max: 15, label: 'Средний', tone: 'mid' },
    { max: 25, label: 'Сложный', tone: 'hard' },
    { max: 40, label: 'Очень сложный', tone: 'vhard' },
    { max: Infinity, label: 'Экстрим', tone: 'extreme' },
  ];

  /**
   * Статистика профиля: подъём/спуск, уклоны, сложность.
   * Сложность — подъём на километр, с поправкой на крутизну самого крутого участка.
   */
  function profileStats(samples) {
    if (!samples || samples.length < 2) return null;
    const length = samples[samples.length - 1].d;
    const ele = smooth(samples.map(s => s.ele));
    let ascent = 0, descent = 0;
    for (let i = 1; i < ele.length; i++) {
      const dh = ele[i] - ele[i - 1];
      if (dh > 0) ascent += dh; else descent -= dh;
    }
    // максимальный уклон на окнах ~100 м
    let maxGrade = 0;
    const step = Math.max(1, Math.round(100 / ((length / (samples.length - 1)) || 50)));
    for (let i = step; i < ele.length; i++) {
      const dd = samples[i].d - samples[i - step].d;
      if (dd > 0) maxGrade = Math.max(maxGrade, Math.abs((ele[i] - ele[i - step]) / dd) * 100);
    }
    const km = length / 1000 || 1;
    const perKm = ascent / km;
    let idx = LEVELS.findIndex(l => perKm < l.max);
    if (maxGrade > 12) idx = Math.min(LEVELS.length - 1, idx + 1);
    const lvl = LEVELS[idx];
    return {
      length: Math.round(length),
      ascent: Math.round(ascent),
      descent: Math.round(descent),
      minEle: Math.round(Math.min(...ele)),
      maxEle: Math.round(Math.max(...ele)),
      maxGrade: Math.round(maxGrade),
      perKm: Math.round(perKm),
      level: idx,
      label: lvl.label,
      tone: lvl.tone,
      profile: samples.map((s, i) => [Math.round(s.d), Math.round(ele[i])]),
    };
  }

  /** SVG-профиль высот: линия и заливка. */
  function profileSvg(profile, w = 320, h = 90) {
    if (!profile || profile.length < 2) return '';
    const maxD = profile[profile.length - 1][0] || 1;
    const eles = profile.map(p => p[1]);
    const minE = Math.min(...eles), maxE = Math.max(...eles), span = maxE - minE || 1;
    const pts = profile.map(([d, e]) => `${((d / maxD) * w).toFixed(1)},${(h - 6 - ((e - minE) / span) * (h - 12)).toFixed(1)}`);
    const line = 'M' + pts.join(' L');
    return `<svg class="profile" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Профиль высот">
      <path d="${line} L${w},${h} L0,${h} Z" fill="currentColor" fill-opacity=".14"/>
      <path d="${line}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
  }

  /* ---------- слой «перепады высот» (тени рельефа + цвет по высоте) ---------- */
  const RAMP = [[-50, [43, 108, 176]], [0, [76, 175, 80]], [200, [205, 220, 57]], [500, [255, 193, 7]], [1000, [255, 112, 67]], [2000, [141, 110, 99]], [3000, [238, 238, 238]]];
  function rampColor(h) {
    if (h <= RAMP[0][0]) return RAMP[0][1];
    for (let i = 1; i < RAMP.length; i++) {
      if (h <= RAMP[i][0]) {
        const [h0, c0] = RAMP[i - 1], [h1, c1] = RAMP[i];
        const t = (h - h0) / (h1 - h0);
        return [0, 1, 2].map(k => c0[k] + (c1[k] - c0[k]) * t);
      }
    }
    return RAMP[RAMP.length - 1][1];
  }

  function makeLayer() {
    const Layer = L.GridLayer.extend({
      options: { maxZoom: 15, opacity: 0.55, minZoom: 6 },
      createTile(coords, done) {
        const canvas = L.DomUtil.create('canvas', 'elev-tile');
        canvas.width = canvas.height = 256;
        const ctx = canvas.getContext('2d');
        const out = ctx.createImageData(256, 256);
        const z = coords.z;
        loadTile(z, coords.x, coords.y).then(h => {
          const latC = (2 * Math.atan(Math.exp(Math.PI * (1 - (2 * (coords.y + 0.5)) / 2 ** z))) - Math.PI / 2);
          const res = (40075016.686 * Math.cos(latC)) / (256 * 2 ** z); // м на пиксель
          const at = (x, y) => h[Math.min(255, Math.max(0, y)) * 256 + Math.min(255, Math.max(0, x))];
          const lx = -0.6, ly = 0.6, lz = 0.55, ln = Math.hypot(lx, ly, lz);
          for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
            const dzdx = (at(x + 1, y) - at(x - 1, y)) / (2 * res);
            const dzdy = (at(x, y + 1) - at(x, y - 1)) / (2 * res);
            const nl = Math.hypot(dzdx, dzdy, 1);
            const shade = Math.max(0, (-dzdx * lx - dzdy * ly + lz) / (nl * ln));
            const [r, g, b] = rampColor(at(x, y));
            const k = 0.45 + 0.55 * shade;
            const i = (y * 256 + x) * 4;
            out.data[i] = r * k; out.data[i + 1] = g * k; out.data[i + 2] = b * k; out.data[i + 3] = 255;
          }
          ctx.putImageData(out, 0, 0);
          done(null, canvas);
        }).catch(() => done(null, canvas));
        return canvas;
      },
    });
    return new Layer();
  }

  root.VeloElevation = { elevationAt, sampleRoute, profileStats, profileSvg, makeLayer, LEVELS };
})(window);
