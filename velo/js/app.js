/* «Велокарта»: карта (схема, спутник, тёмная тема, перепады высот), GPS, навигация,
   маршруты с оценкой сложности, запись поездок, офлайн-пакеты.
   Лобби, гонки и повтор финиша — в lobby.js; обмен через window.VeloApp. */
(function (root) {
  const G = root.VeloGeo, S = root.VeloStore, OFF = root.VeloOffline;
  const IC = root.VeloIcons, SK = root.VeloSkins, EL = root.VeloElevation;
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const kmh = ms => (ms == null ? '—' : Math.round(ms * 3.6));
  const icon = (n, size = 18) => IC.icon(n, size);
  const listeners = {};
  const emit = (type, data) => (listeners[type] || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } });

  const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const BASES = {
    osm: { title: 'Схема', attribution: '© OpenStreetMap' },
    sat: { title: 'Спутник', attribution: 'Tiles © Esri — Esri, Maxar, Earthstar Geographics' },
  };

  /* ---------- состояние ---------- */
  const cfg = S.settings.get();
  const state = {
    fix: null,
    follow: true,
    battery: { level: null, charging: null },
    rec: null,
    wake: null,
    lobbyAwake: false,
    tab: 'map',
    base: cfg.base === 'sat' ? 'sat' : 'osm',
    theme: ['light', 'night', 'graphite'].includes(cfg.theme) ? cfg.theme : 'night',
    elev: !!cfg.elev,
  };
  const plan = {
    wps: [], coords: null, distance: 0, time: 0, ascent: 0, stats: null,
    profile: cfg.profile || 'trekking', name: '', id: null,
  };
  const nav = { active: false, coords: null, cum: null, total: 0, turns: [], dest: null, along: 0, off: 0, rerouting: false };
  let buildSeq = 0, routeTimer = 0, searchTimer = 0;
  const overlays = new Map();

  /* ---------- карта ---------- */
  const map = L.map('map', { zoomControl: false, worldCopyJump: true }).setView([55.75, 37.62], 11);
  let baseLayer = null, elevLayer = null;
  const planLayer = L.layerGroup().addTo(map);
  let planLine = null;
  const meMarker = L.marker([55.75, 37.62], { icon: L.divIcon({ className: 'vmk', iconSize: [0, 0], html: '' }), zIndexOffset: 1000, interactive: false }).addTo(map);
  meMarker.setOpacity(0);

  function baseTemplate(base = state.base) {
    return base === 'sat' ? ESRI : S.settings.get().tileUrl;
  }

  function applyBase() {
    if (baseLayer) map.removeLayer(baseLayer);
    baseLayer = L.tileLayer(baseTemplate(), { maxZoom: 18, attribution: BASES[state.base].attribution }).addTo(map);
    document.body.classList.toggle('base-osm', state.base === 'osm');
    $$('#layer-pop button').forEach(b => b.classList.toggle('on', b.dataset.base === state.base));
    S.settings.set({ base: state.base });
  }

  const THEME_NAMES = { light: 'светлая', night: 'ночная', graphite: 'графит' };
  const NEXT_THEME = { light: 'night', night: 'graphite', graphite: 'light' };

  function applyTheme() {
    const b = document.body.classList;
    b.toggle('theme-light', state.theme === 'light');
    b.toggle('theme-dark', state.theme !== 'light');
    b.toggle('theme-night', state.theme === 'night');
    b.toggle('theme-graphite', state.theme === 'graphite');
    const btn = $('#btn-theme');
    btn.classList.toggle('on', state.theme !== 'light');
    btn.title = 'Тема: ' + THEME_NAMES[state.theme];
    S.settings.set({ theme: state.theme });
    // акцентный цвет берём из темы: линия маршрута и свой маркер
    if (typeof drawPlan === 'function') drawPlan();
    if (state.fix) updateMe();
  }

  /** Акцентный цвет текущей темы (линии маршрута, свой курсор). */
  function accent() { return getComputedStyle(document.body).getPropertyValue('--blue').trim() || '#1f6feb'; }

  function applyElev() {
    if (state.elev) {
      if (!elevLayer) elevLayer = EL.makeLayer();
      elevLayer.addTo(map);
    } else if (elevLayer) map.removeLayer(elevLayer);
    $('#btn-elev').classList.toggle('on', state.elev);
    S.settings.set({ elev: state.elev });
  }

  map.on('dragstart', () => { state.follow = false; renderFollow(); });
  map.on('click', e => { if (state.tab === 'route') addWaypoint(e.latlng); });
  window.addEventListener('resize', () => map.invalidateSize());

  /** Курсор игрока: скин, повёрнутый по направлению движения, и подпись. */
  function skinIcon({ color, skin, heading, name, me, off, speedMs }) {
    const svg = SK.get(skin).svg;
    const sub = speedMs != null ? ` · ${kmh(speedMs)} км/ч` : '';
    return L.divIcon({
      className: 'vmk',
      iconSize: [0, 0],
      html: `<div class="vm${me ? ' me' : ''}${off ? ' off' : ''}"><div class="skin" style="color:${color};transform:rotate(${Math.round(heading || 0)}deg)">${svg}</div>` +
        `<span class="tag">${esc(name)}${sub}</span></div>`,
    });
  }

  function renderFollow() {
    $('#btn-follow').classList.toggle('on', state.follow);
  }

  /* ---------- HUD и GPS ---------- */
  function setGps(text) { $('#gps').textContent = text; }

  function updateHud() {
    const f = state.fix;
    $('#spd').textContent = f && f.spd != null ? kmh(f.spd) : '--';
    setGps(f ? `GPS ±${Math.round(f.acc || 0)} м` : 'GPS: поиск…');
    const b = state.battery;
    $('#bat').innerHTML = b.level == null ? `${icon('battery', 16)} —` : `${icon(b.charging ? 'bolt' : 'battery', 16)} ${Math.round(b.level * 100)}%`;
  }

  function updateMe() {
    const f = state.fix;
    if (!f) return;
    meMarker.setLatLng([f.lat, f.lon]).setOpacity(1);
    meMarker.setIcon(skinIcon({ color: accent(), skin: S.settings.get().skin || SK.DEFAULT, heading: f.hdg, name: 'Я', me: true, speedMs: f.spd }));
  }

  function onPos(p) {
    const c = p.coords, prev = state.fix;
    let spd = c.speed != null && c.speed >= 0 ? c.speed : null;
    let hdg = c.heading != null && !isNaN(c.heading) && (spd == null || spd > 0.8) ? c.heading : null;
    if (prev) {
      const dt = (p.timestamp - prev.t) / 1000;
      const d = G.distance(prev.lat, prev.lon, c.latitude, c.longitude);
      if (dt > 0 && spd == null) spd = d / dt;
      if (hdg == null && d > 4) hdg = G.bearing(prev.lat, prev.lon, c.latitude, c.longitude);
    }
    if (spd != null && spd < 0.5) spd = 0;
    const fix = { lat: c.latitude, lon: c.longitude, acc: c.accuracy, alt: c.altitude, t: p.timestamp, spd, hdg: hdg ?? (prev ? prev.hdg : null) };
    const first = !state.fix;
    state.fix = fix;
    if (first) map.setView([fix.lat, fix.lon], 15);
    else if (state.follow) map.panTo([fix.lat, fix.lon], { animate: true, duration: 0.4 });
    if (state.rec) recordPoint(fix);
    if (nav.active) updateNav();
    updateMe();
    updateHud();
    emit('fix', fix);
  }

  function onGeoError(e) {
    setGps('GPS: ' + (e.code === 1 ? 'нет доступа к геолокации' : e.code === 2 ? 'позиция недоступна' : 'таймаут GPS'));
  }

  function startGps() {
    if (!navigator.geolocation) return setGps('GPS недоступен в этом браузере');
    navigator.geolocation.watchPosition(onPos, onGeoError, { enableHighAccuracy: true, maximumAge: 1000, timeout: 30000 });
  }

  if (navigator.getBattery) {
    navigator.getBattery().then(b => {
      const update = () => {
        state.battery = { level: b.level, charging: b.charging };
        updateHud();
        emit('battery', state.battery);
      };
      update();
      b.addEventListener('levelchange', update);
      b.addEventListener('chargingchange', update);
    }).catch(() => {});
  }

  /* ---------- экран не гаснет ---------- */
  async function syncWake() {
    if (!('wakeLock' in navigator)) return;
    const want = state.lobbyAwake || !!state.rec || nav.active;
    try {
      if (want && !state.wake) {
        state.wake = await navigator.wakeLock.request('screen');
        state.wake.addEventListener('release', () => { state.wake = null; });
      } else if (!want && state.wake) {
        await state.wake.release();
        state.wake = null;
      }
    } catch { /* не критично */ }
  }
  function keepAwake(on) { state.lobbyAwake = !!on; syncWake(); }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncWake(); });

  /* ---------- навигация ---------- */
  const TURN_ICON = { slight: ['slightLeft', 'slightRight'], turn: ['turnLeft', 'turnRight'], sharp: ['turnLeft', 'turnRight'], uturn: ['uturn', 'uturn'] };
  const TURN_TEXT = { slight: ['Держитесь левее', 'Держитесь правее'], turn: ['Налево', 'Направо'], sharp: ['Резко налево', 'Резко направо'], uturn: ['Разворот', 'Разворот'] };

  function fmtClock(ms) { return new Date(ms).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }); }

  function startNav() {
    if (!plan.coords) return toast('Сначала постройте маршрут');
    nav.coords = plan.coords;
    nav.cum = G.cumulative(nav.coords);
    nav.total = nav.cum[nav.cum.length - 1];
    nav.turns = G.findTurns(nav.coords);
    nav.dest = plan.wps[plan.wps.length - 1] || null;
    nav.along = 0; nav.off = 0;
    nav.active = true;
    state.follow = true;
    renderFollow();
    $('#nav-bar').hidden = false;
    $('#nav-card').hidden = false;
    syncWake();
    showTab('map');
    if (state.fix) updateNav(); else toast('Жду GPS-сигнал…');
    toast('Маршрут начат');
  }

  function stopNav(silent) {
    nav.active = false;
    $('#nav-bar').hidden = true;
    $('#nav-card').hidden = true;
    syncWake();
    if (!silent) toast('Навигация остановлена');
  }

  function updateNav() {
    const f = state.fix;
    if (!nav.active || !f) return;
    const pr = G.projectOnPolyline(nav.coords, f.lat, f.lon);
    if (pr.dist > 60) {
      nav.off++;
      if (nav.off === 3) toast('Вы сошли с маршрута, перестраиваю…');
      if (nav.off >= 3 && !nav.rerouting) reroute(f);
    } else {
      nav.off = 0;
      nav.along = Math.max(nav.along, pr.along);
    }
    const left = Math.max(0, nav.total - nav.along);
    if (left < 25 && nav.dest) {
      toast('Вы на месте!', 4000);
      return stopNav(true);
    }
    const next = nav.turns.find(t => t.along > nav.along + 8);
    if (next) {
      const idx = next.dir === 'left' ? 0 : 1;
      $('#turn-ico').innerHTML = icon(TURN_ICON[next.kind][idx], 34);
      $('#turn-label').textContent = TURN_TEXT[next.kind][idx];
      $('#turn-dist').textContent = G.formatDistance(next.along - nav.along);
    } else {
      $('#turn-ico').innerHTML = icon('flag', 34);
      $('#turn-label').textContent = 'Финиш';
      $('#turn-dist').textContent = G.formatDistance(left);
    }
    const speed = f.spd && f.spd > 1 ? f.spd : 4.2; // без скорости считаем ~15 км/ч
    $('#nav-left').textContent = G.formatDistance(left);
    $('#nav-eta').textContent = fmtClock(Date.now() + (left / speed) * 1000);
  }

  async function reroute(f) {
    nav.rerouting = true;
    try {
      const r = await fetchRoute([[f.lat, f.lon], [nav.dest.lat, nav.dest.lng]]);
      Object.assign(plan, { coords: r.coords, distance: r.distance, time: r.time, ascent: r.ascent, stats: null });
      nav.coords = r.coords; nav.cum = G.cumulative(r.coords); nav.total = nav.cum[nav.cum.length - 1];
      nav.turns = G.findTurns(r.coords); nav.along = 0; nav.off = 0;
      drawPlan(); renderPlan();
      toast('Маршрут перестроен');
    } catch (e) {
      toast('Не удалось перестроить: ' + e.message, 4000);
      nav.off = 0;
    } finally { nav.rerouting = false; }
  }

  /* ---------- запись поездки ---------- */
  function recordPoint(f) {
    const r = state.rec, pts = r.track.points, last = pts[pts.length - 1];
    if (f.acc != null && f.acc > 50) return;
    if (last) {
      const d = G.distance(last.lat, last.lon, f.lat, f.lon);
      if (d < 2 && f.t - last.t < 5000) return;
      if (d < 300) r.track.distance += d;
    }
    pts.push({ lat: f.lat, lon: f.lon, t: f.t, spd: f.spd, acc: f.acc, alt: f.alt });
    if (f.spd != null && f.spd > r.track.maxSpd) r.track.maxSpd = f.spd;
    if (Date.now() - r.saveAt > 10000) saveRec();
  }

  async function saveRec() {
    if (!state.rec) return;
    state.rec.saveAt = Date.now();
    try { await S.put('tracks', state.rec.track); } catch (e) { console.error(e); }
  }

  async function toggleRec() {
    if (state.rec) {
      const t = state.rec.track;
      t.endedAt = Date.now();
      state.rec = null;
      await S.put('tracks', t);
      toast(`Поездка сохранена: ${G.formatDistance(t.distance)}`);
    } else {
      const startedAt = Date.now();
      const name = 'Поездка ' + new Date(startedAt).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      state.rec = { track: { id: 'trk-' + startedAt, name, startedAt, endedAt: null, points: [], distance: 0, maxSpd: 0 }, saveAt: 0 };
      await saveRec();
      toast('Запись поездки начата');
    }
    syncWake();
    renderRec();
    renderTracks();
  }

  function renderRec() {
    const b = $('#btn-rec');
    b.innerHTML = state.rec ? `${icon('stop', 18)} Остановить запись` : `${icon('rec', 18)} Записать поездку`;
    b.classList.toggle('danger', !!state.rec);
    b.classList.toggle('primary', !state.rec);
    $('#rec-info').textContent = state.rec
      ? `Идёт запись: ${G.formatDistance(state.rec.track.distance)}, макс. ${kmh(state.rec.track.maxSpd)} км/ч`
      : 'Запись не идёт. Поездки сохраняются на телефоне — вкладка «Поездки».';
  }

  async function recoverTracks() {
    const tracks = await S.all('tracks');
    for (const t of tracks) {
      if (!t.endedAt && !(state.rec && state.rec.track.id === t.id)) {
        t.endedAt = t.points.length ? t.points[t.points.length - 1].t : t.startedAt;
        await S.put('tracks', t);
      }
    }
  }

  /* ---------- маршрут: планировщик и BRouter ---------- */
  async function fetchRoute(points) {
    const s = S.settings.get();
    const lonlats = points.map(([lat, lon]) => `${lon.toFixed(6)},${lat.toFixed(6)}`).join('|');
    const url = `${s.routerUrl}?lonlats=${lonlats}&profile=${encodeURIComponent(plan.profile)}&alternativeidx=0&format=geojson`;
    const res = await fetch(url);
    const text = await res.text();
    if (!res.ok) throw new Error(text.trim().slice(0, 160) || `HTTP ${res.status}`);
    const f = JSON.parse(text).features[0];
    const coords = f.geometry.coordinates.map(c => [c[1], c[0]]);
    return {
      coords,
      distance: +f.properties['track-length'] || G.lineLength(coords),
      time: +f.properties['total-time'] || 0,
      ascent: +f.properties['filtered ascend'] || 0,
    };
  }

  function addWaypoint(ll) { plan.wps.push(ll); redrawWps(); scheduleRoute(); }

  function redrawWps() {
    planLayer.clearLayers();
    plan.wps.forEach((p, i) => L.marker(p, {
      icon: L.divIcon({ className: '', html: `<div class="wp">${i + 1}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
    }).addTo(planLayer));
  }

  function scheduleRoute() {
    clearTimeout(routeTimer);
    if (plan.wps.length < 2) {
      plan.coords = null; plan.stats = null;
      if (planLine) { planLine.remove(); planLine = null; }
      renderPlan();
      return;
    }
    routeTimer = setTimeout(buildRoute, 350);
  }

  async function buildRoute() {
    const my = ++buildSeq;
    renderPlan('Строю маршрут…');
    try {
      const r = await fetchRoute(plan.wps.map(p => [p.lat, p.lng]));
      if (my !== buildSeq) return;
      Object.assign(plan, { coords: r.coords, distance: r.distance, time: r.time, ascent: r.ascent, stats: null });
      drawPlan();
      renderPlan();
      loadDifficulty(my);
    } catch (e) {
      if (my === buildSeq) {
        plan.coords = null; plan.stats = null;
        renderPlan('Не удалось построить маршрут: ' + e.message);
      }
    }
  }

  /** Сложность по высотам — подгружается после построения маршрута. */
  async function loadDifficulty(my) {
    try {
      const samples = await EL.sampleRoute(plan.coords, 50);
      if (my !== buildSeq) return;
      plan.stats = EL.profileStats(samples);
      renderPlan();
    } catch (e) {
      console.warn('высоты недоступны', e);
    }
  }

  function drawPlan() {
    if (planLine) planLine.remove();
    planLine = plan.coords ? L.polyline(plan.coords, { color: accent(), weight: 5, opacity: 0.85 }).addTo(map) : null;
  }

  function fitTo(coords) {
    if (coords && coords.length) map.fitBounds(L.latLngBounds(coords), { padding: [30, 30] });
  }

  function difficultyHtml(st) {
    if (!st) return '';
    return `<span class="diff-tag ${st.tone}">${esc(st.label)}</span>
      <span class="diff-stats">подъём ${st.ascent} м · спуск ${st.descent} м · макс. уклон ${st.maxGrade}%</span>`;
  }

  function renderPlan(status) {
    const info = status || (plan.coords
      ? `${G.formatDistance(plan.distance)} · ~${G.formatDuration(plan.time)}`
      : plan.wps.length ? 'Поставьте ещё одну точку' : 'Нажимайте на карту или введите адрес сверху');
    $('#plan-info').textContent = info;
    $('#plan-profile').value = plan.profile;
    const d = $('#plan-difficulty');
    d.hidden = !plan.stats;
    d.innerHTML = difficultyHtml(plan.stats);
    const c = $('#plan-profile-chart');
    c.hidden = !plan.stats;
    c.innerHTML = plan.stats ? EL.profileSvg(plan.stats.profile) + `<small>высоты ${plan.stats.minEle}–${plan.stats.maxEle} м</small>` : '';
    $('#btn-go').disabled = !plan.coords;
  }

  function clearPlan() {
    plan.wps = []; plan.coords = null; plan.id = null; plan.name = ''; plan.stats = null;
    redrawWps(); scheduleRoute(); drawPlan();
  }

  async function saveRoute() {
    if (!plan.coords) return toast('Сначала постройте маршрут');
    const name = prompt('Название маршрута', plan.name || 'Маршрут ' + new Date().toLocaleDateString('ru'));
    if (!name) return;
    const r = {
      id: plan.id || 'rt-' + Date.now(), name, createdAt: Date.now(), profile: plan.profile,
      coords: plan.coords, distance: plan.distance, time: plan.time, wps: plan.wps.map(p => [p.lat, p.lng]),
      stats: plan.stats,
    };
    await S.put('routes', r);
    plan.id = r.id; plan.name = name;
    toast('Маршрут сохранён');
    renderRoutes();
  }

  async function openRoute(id) {
    const r = await S.get('routes', id);
    if (!r) return;
    plan.wps = r.wps.map(([lat, lon]) => L.latLng(lat, lon));
    Object.assign(plan, { coords: r.coords, distance: r.distance, time: r.time, ascent: 0, stats: r.stats || null, profile: r.profile || plan.profile, id: r.id, name: r.name });
    redrawWps(); drawPlan(); renderPlan(); fitTo(r.coords);
    showTab('route');
  }

  /* ---------- поиск адреса (Nominatim) ---------- */
  async function searchPlaces(q) {
    const list = $('#search-results');
    if (!q || q.length < 3) { list.hidden = true; return; }
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=6&accept-language=ru&q=${encodeURIComponent(q)}`);
      const items = await res.json();
      list.innerHTML = items.length ? items.map((it, i) =>
        `<li data-i="${i}">${esc(it.display_name.split(',').slice(0, 3).join(','))}<small>${esc(it.type || '')}</small></li>`).join('')
        : '<li>Ничего не найдено</li>';
      list._items = items;
    } catch {
      list.innerHTML = '<li>Поиск недоступен (нет сети)</li>';
    }
    list.hidden = false;
  }

  function chooseDestination(it) {
    const dest = L.latLng(+it.lat, +it.lon);
    plan.name = it.display_name.split(',')[0];
    plan.wps = state.fix ? [L.latLng(state.fix.lat, state.fix.lon), dest] : [dest];
    if (!state.fix) toast('Нет GPS: старт не задан — отметьте его нажатием на карту', 4500);
    $('#search-results').hidden = true;
    $('#search-input').value = plan.name;
    redrawWps(); scheduleRoute();
    map.setView(dest, 14);
    showTab('route');
  }

  /* ---------- показ поездок и маршрутов на карте ---------- */
  function toggleOverlay(key, coords, color, fit) {
    if (overlays.has(key)) { overlays.get(key).remove(); overlays.delete(key); return false; }
    const layer = L.polyline(coords, { color, weight: 4, opacity: 0.85 }).addTo(map);
    overlays.set(key, layer);
    if (fit) fitTo(coords);
    return true;
  }
  function dropOverlay(key) { if (overlays.has(key)) { overlays.get(key).remove(); overlays.delete(key); } }

  /* ---------- GPX ---------- */
  function toGpx(name, pts) {
    const trkpts = pts.map(p => {
      const time = p.t ? `<time>${new Date(p.t).toISOString()}</time>` : '';
      return `<trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">${time}</trkpt>`;
    }).join('');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Велокарта" xmlns="http://www.topografix.com/GPX/1/1">\n<trk><name>${esc(name)}</name><trkseg>${trkpts}</trkseg></trk>\n</gpx>\n`;
  }

  function download(filename, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/gpx+xml' }));
    a.download = filename.replace(/[\\/:*?"<>|]+/g, '_') + '.gpx';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------- списки ---------- */
  async function renderTracks() {
    const list = $('#track-list');
    const tracks = (await S.all('tracks')).sort((a, b) => b.startedAt - a.startedAt);
    if (!tracks.length) { list.innerHTML = '<p class="muted">Пока нет поездок. Включите запись на вкладке «Карта».</p>'; return; }
    list.innerHTML = tracks.map(t => {
      const end = t.endedAt || Date.now();
      const dur = (end - t.startedAt) / 1000;
      const avg = dur > 0 ? (t.distance / dur) * 3.6 : 0;
      const live = !t.endedAt ? ' <span class="badge red">идёт запись</span>' : '';
      const shown = overlays.has('trk:' + t.id);
      return `<article class="item">
        <div class="item-h"><b>${esc(t.name)}</b>${live}</div>
        <div class="stats">
          <span>${G.formatDistance(t.distance)}</span><span>${G.formatDuration(dur)}</span>
          <span>ср. ${avg.toFixed(1)} км/ч</span><span>макс. ${kmh(t.maxSpd)} км/ч</span>
        </div>
        <div class="row">
          <button data-act="show-track" data-id="${esc(t.id)}" class="${shown ? 'on' : ''}">${shown ? 'Скрыть' : 'Показать'}</button>
          <button data-act="gpx-track" data-id="${esc(t.id)}">${icon('file', 16)} GPX</button>
          <button data-act="del-track" data-id="${esc(t.id)}" class="danger">${icon('trash', 16)}</button>
        </div></article>`;
    }).join('');
  }

  async function renderRoutes() {
    const list = $('#route-list');
    const routes = (await S.all('routes')).sort((a, b) => b.createdAt - a.createdAt);
    if (!routes.length) { list.innerHTML = '<p class="muted">Сохранённых маршрутов пока нет.</p>'; return; }
    list.innerHTML = routes.map(r => {
      const shown = overlays.has('rt:' + r.id);
      return `<article class="item">
        <div class="item-h"><b>${esc(r.name)}</b></div>
        ${r.stats ? `<div class="difficulty">${difficultyHtml(r.stats)}</div>` : ''}
        <div class="stats"><span>${G.formatDistance(r.distance)}</span><span>~${G.formatDuration(r.time)}</span><span>${esc(r.profile)}</span></div>
        <div class="row">
          <button data-act="open-route" data-id="${esc(r.id)}">Открыть</button>
          <button data-act="show-route" data-id="${esc(r.id)}" class="${shown ? 'on' : ''}">${shown ? 'Скрыть' : 'Показать'}</button>
          <button data-act="gpx-route" data-id="${esc(r.id)}">${icon('file', 16)} GPX</button>
          <button data-act="del-route" data-id="${esc(r.id)}" class="danger">${icon('trash', 16)}</button>
        </div></article>`;
    }).join('');
  }

  /* ---------- офлайн-карты ---------- */
  let dl = null;

  function currentArea() { return $('#pack-area').value; }

  function packBounds() {
    const a = currentArea();
    if (a === 'view') { const b = map.getBounds(); return { south: b.getSouth(), north: b.getNorth(), west: b.getWest(), east: b.getEast() }; }
    return OFF.AREAS[a].bounds;
  }

  function updatePackEstimate() {
    const zmin = +$('#pack-zmin').value, zmax = +$('#pack-zmax').value;
    if (!(zmin >= 0 && zmax <= 18 && zmin <= zmax)) { $('#pack-est').textContent = 'Проверьте уровни зума (0–18)'; return; }
    const e = OFF.estimate(packBounds(), zmin, zmax);
    const over = e.count > OFF.MAX_TILES;
    $('#pack-est').textContent = `${e.count} тайлов · ~${OFF.fmtMb(e.sizeMb)} · слой: ${BASES[state.base].title}` +
      (over ? ` — больше лимита ${OFF.MAX_TILES}, уменьшите зум или область` : '');
    $('#btn-pack-go').disabled = over || !!dl;
  }

  function onAreaChange() {
    const a = currentArea();
    if (a === 'view') {
      const z = Math.round(map.getZoom());
      $('#pack-zmin').value = Math.max(0, z - 1);
      $('#pack-zmax').value = Math.min(16, z + 2);
    } else {
      $('#pack-zmin').value = OFF.AREAS[a].zmin;
      $('#pack-zmax').value = OFF.AREAS[a].zmax;
    }
    updatePackEstimate();
  }

  async function startPack() {
    const name = (currentArea() === 'view' ? 'Текущий вид' : OFF.AREAS[currentArea()].title) + ' · ' + BASES[state.base].title;
    const zmin = +$('#pack-zmin').value, zmax = +$('#pack-zmax').value;
    const ac = new AbortController();
    dl = { abort: ac };
    $('#pack-progress').hidden = false;
    $('#btn-pack-cancel').hidden = false;
    $('#btn-pack-go').disabled = true;
    try {
      const pack = await OFF.download({
        name, bounds: packBounds(), zmin, zmax, template: baseTemplate(), signal: ac.signal,
        onProgress: (done, total) => {
          $('#pack-bar').style.width = Math.round((done / total) * 100) + '%';
          $('#pack-status').textContent = `Скачано ${done} из ${total}`;
        },
      });
      toast(`Карта «${pack.name}» сохранена${pack.failed ? `, не загружено тайлов: ${pack.failed}` : ''}`);
    } catch (e) {
      toast(e.name === 'AbortError' ? 'Загрузка отменена' : 'Ошибка: ' + e.message, 4000);
    } finally {
      dl = null;
      $('#pack-progress').hidden = true;
      $('#pack-bar').style.width = '0%';
      $('#btn-pack-cancel').hidden = true;
      renderPacks();
      updatePackEstimate();
    }
  }

  async function renderPacks() {
    const list = $('#pack-list');
    const packs = (await S.all('packs')).sort((a, b) => b.createdAt - a.createdAt);
    list.innerHTML = packs.length ? packs.map(p => {
      const e = OFF.estimate(p.bounds, p.zmin, p.zmax);
      return `<article class="item">
        <div class="item-h"><b>${esc(p.name)}</b></div>
        <div class="stats"><span>зум ${p.zmin}–${p.zmax}</span><span>${p.tiles} тайлов</span><span>~${OFF.fmtMb(e.sizeMb)}</span>${p.failed ? `<span>ошибок: ${p.failed}</span>` : ''}</div>
        <div class="row"><button data-act="del-pack" data-id="${esc(p.id)}" class="danger">${icon('trash', 16)} Удалить</button></div></article>`;
    }).join('') : '<p class="muted">Офлайн-карт пока нет. Выберите область и скачайте.</p>';
    const si = await OFF.storageInfo().catch(() => null);
    $('#storage-info').textContent = si ? `Занято приложением и кэшем: ${OFF.fmtMb(si.usedMb)} · доступно браузеру ~${(si.quotaMb / 1024).toFixed(1)} ГБ` : '';
  }

  /* ---------- подсказки ---------- */
  let toastTimer = 0;
  function toast(text, ms = 3000) {
    const t = $('#toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }

  /* ---------- панель: свернуть / развернуть ---------- */
  function setPanelCollapsed(c) {
    document.body.classList.toggle('panel-collapsed', c);
    S.settings.set({ panelCollapsed: c });
    setTimeout(() => map.invalidateSize(), 260); // карта занимает освободившееся место
  }

  function bindPanelHandle() {
    const h = $('#panel-toggle');
    h.addEventListener('click', () => setPanelCollapsed(!document.body.classList.contains('panel-collapsed')));
    // жест: провести вниз — свернуть, вверх — развернуть
    let y0 = null;
    h.addEventListener('touchstart', e => { y0 = e.touches[0].clientY; }, { passive: true });
    h.addEventListener('touchend', e => {
      if (y0 == null) return;
      const dy = e.changedTouches[0].clientY - y0;
      if (Math.abs(dy) > 30) setPanelCollapsed(dy > 0);
      y0 = null;
    });
  }

  /* ---------- вкладки ---------- */
  function showTab(name) {
    state.tab = name;
    if (document.body.classList.contains('panel-collapsed')) setPanelCollapsed(false); // выбрали вкладку — панель открывается
    $$('.tab').forEach(t => { t.hidden = t.dataset.tab !== name; });
    $$('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
    if (name === 'tracks') renderTracks();
    if (name === 'route') { renderPlan(); renderRoutes(); }
    if (name === 'offline') { renderPacks(); onAreaChange(); }
    emit('tab', name);
  }

  /* ---------- интерфейс ---------- */
  function bindUi() {
    $$('.tabbar button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

    $('#btn-follow').addEventListener('click', () => {
      state.follow = !state.follow;
      renderFollow();
      if (state.follow && state.fix) map.panTo([state.fix.lat, state.fix.lon]);
    });
    $('#btn-layers').addEventListener('click', () => { $('#layer-pop').hidden = !$('#layer-pop').hidden; });
    $$('#layer-pop button').forEach(b => b.addEventListener('click', () => {
      state.base = b.dataset.base;
      applyBase();
      $('#layer-pop').hidden = true;
    }));
    $('#btn-elev').addEventListener('click', () => { state.elev = !state.elev; applyElev(); if (state.elev) toast('Перепады высот: светлее — выше'); });
    $('#btn-theme').addEventListener('click', () => { state.theme = NEXT_THEME[state.theme]; applyTheme(); });

    const si = $('#search-input');
    si.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => searchPlaces(si.value.trim()), 700); });
    si.addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(searchTimer); searchPlaces(si.value.trim()); } });
    $('#search-results').addEventListener('click', e => {
      const li = e.target.closest('li[data-i]');
      if (li) chooseDestination($('#search-results')._items[+li.dataset.i]);
    });

    $('#btn-rec').addEventListener('click', toggleRec);
    $('#btn-go').addEventListener('click', startNav);
    $('#btn-nav-stop').addEventListener('click', () => stopNav());
    $('#btn-undo').addEventListener('click', () => { plan.wps.pop(); redrawWps(); scheduleRoute(); });
    $('#btn-clear').addEventListener('click', clearPlan);
    $('#btn-save-route').addEventListener('click', saveRoute);
    $('#btn-gpx-plan').addEventListener('click', () => plan.coords
      ? download(plan.name || 'маршрут', toGpx(plan.name || 'Маршрут', plan.coords.map(([lat, lon]) => ({ lat, lon }))))
      : toast('Сначала постройте маршрут'));
    $('#btn-my-start').addEventListener('click', () => {
      if (!state.fix) return toast('Нет GPS-позиции');
      if (!plan.wps.length) addWaypoint(L.latLng(state.fix.lat, state.fix.lon));
      else { plan.wps.unshift(L.latLng(state.fix.lat, state.fix.lon)); redrawWps(); scheduleRoute(); }
    });
    $('#plan-profile').addEventListener('change', e => {
      plan.profile = e.target.value;
      S.settings.set({ profile: plan.profile });
      if (plan.wps.length >= 2) scheduleRoute();
    });

    $('#track-list').addEventListener('click', async e => {
      const b = e.target.closest('button'); if (!b) return;
      const id = b.dataset.id;
      if (b.dataset.act === 'show-track') {
        const t = await S.get('tracks', id);
        if (t) { toggleOverlay('trk:' + id, t.points.map(p => [p.lat, p.lon]), '#e53935', true); renderTracks(); }
      } else if (b.dataset.act === 'gpx-track') {
        const t = await S.get('tracks', id);
        if (t) download(t.name, toGpx(t.name, t.points));
      } else if (b.dataset.act === 'del-track') {
        if (!confirm('Удалить поездку?')) return;
        dropOverlay('trk:' + id);
        await S.del('tracks', id);
        renderTracks();
      }
    });

    $('#route-list').addEventListener('click', async e => {
      const b = e.target.closest('button'); if (!b) return;
      const id = b.dataset.id, act = b.dataset.act;
      if (act === 'open-route') return openRoute(id);
      const r = await S.get('routes', id);
      if (!r) return;
      if (act === 'show-route') { toggleOverlay('rt:' + id, r.coords, '#8e24aa', true); renderRoutes(); }
      else if (act === 'gpx-route') download(r.name, toGpx(r.name, r.coords.map(([lat, lon]) => ({ lat, lon }))));
      else if (act === 'del-route') {
        if (!confirm('Удалить маршрут?')) return;
        dropOverlay('rt:' + id);
        await S.del('routes', id);
        renderRoutes();
      }
    });

    $('#pack-area').addEventListener('change', onAreaChange);
    $('#pack-zmin').addEventListener('input', updatePackEstimate);
    $('#pack-zmax').addEventListener('input', updatePackEstimate);
    map.on('moveend', () => { if (currentArea() === 'view' && state.tab === 'offline' && !dl) updatePackEstimate(); });
    $('#btn-pack-go').addEventListener('click', startPack);
    $('#btn-pack-cancel').addEventListener('click', () => dl && dl.abort.abort());
    $('#pack-list').addEventListener('click', async e => {
      const b = e.target.closest('button'); if (!b || b.dataset.act !== 'del-pack') return;
      if (!confirm('Удалить офлайн-карту? Тайлы, которые входят и в другие пакеты, тоже будут удалены.')) return;
      const p = await S.get('packs', b.dataset.id);
      if (p) await OFF.removePack(p);
      renderPacks();
    });

    const s = S.settings.get();
    $('#set-tile').value = s.tileUrl;
    $('#set-router').value = s.routerUrl;
    $('#btn-save-settings').addEventListener('click', () => {
      const tileUrl = $('#set-tile').value.trim() || S.DEFAULTS.tileUrl;
      const routerUrl = $('#set-router').value.trim() || S.DEFAULTS.routerUrl;
      if (!tileUrl.includes('{z}') || !tileUrl.includes('{x}') || !tileUrl.includes('{y}')) return toast('В адресе тайлов должны быть {z} {x} {y}', 4000);
      S.settings.set({ tileUrl, routerUrl });
      applyBase();
      toast('Настройки сохранены');
    });

    window.addEventListener('online', updateHud);
    window.addEventListener('offline', () => setGps('нет сети — работают офлайн-карты и сохранённые маршруты'));
  }

  /* ---------- запуск ---------- */
  function init() {
    IC.hydrate(document);
    bindUi();
    bindPanelHandle();
    if (cfg.panelCollapsed) document.body.classList.add('panel-collapsed');
    applyBase();
    applyTheme();
    applyElev();
    renderFollow();
    renderRec();
    renderPlan();
    showTab('map');
    recoverTracks().catch(console.error);
    startGps();
    setInterval(updateHud, 1000);
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  root.VeloApp = {
    map, toast, showTab, fitTo, keepAwake, toGpx, download, esc,
    on(type, fn) { (listeners[type] ||= []).push(fn); },
    getFix: () => state.fix,
    getBattery: () => state.battery,
    getPlanRoute: () => (plan.coords ? { name: plan.name || 'Текущий маршрут', coords: plan.coords, total: plan.distance } : null),
    listRoutes: () => S.all('routes'),
    getRoute: id => S.get('routes', id),
    skinIcon, toggleOverlay,
    isNavigating: () => nav.active,
  };

  document.addEventListener('DOMContentLoaded', init);
})(window);
