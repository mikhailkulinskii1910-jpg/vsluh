/* «Велокарта»: карта, GPS, запись поездок, маршруты (BRouter), офлайн-пакеты.
   Лобби, гонки и погони — в lobby.js; обмениваются через window.VeloApp. */
(function (root) {
  const G = root.VeloGeo, S = root.VeloStore, OFF = root.VeloOffline;
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const kmh = ms => (ms == null ? '—' : Math.round(ms * 3.6));
  const listeners = {};
  const emit = (type, data) => (listeners[type] || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } });

  /* ---------- состояние ---------- */
  const state = {
    fix: null,           // последняя позиция {lat, lon, acc, t, spd, hdg}
    follow: true,        // карта следует за мной
    battery: { level: null, charging: null },
    rec: null,           // активная запись поездки
    wake: null,          // WakeLock экрана
    lobbyAwake: false,   // экран не гаснет, пока игрок в лобби
    tab: 'map',
  };
  const plan = {          // текущий маршрут в планировщике
    wps: [], coords: null, distance: 0, time: 0, ascent: 0,
    profile: S.settings.get().profile, name: '', id: null,
  };
  let buildSeq = 0, routeTimer = 0;
  const overlays = new Map(); // ключ → слой на карте (показанные поездки и маршруты)

  /* ---------- карта ---------- */
  const map = L.map('map', { zoomControl: false, worldCopyJump: true }).setView([55.75, 37.62], 11); // зум — жестами
  let tileLayer = L.tileLayer(S.settings.get().tileUrl, { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(map);
  const planLayer = L.layerGroup().addTo(map);
  let planLine = null;
  const meMarker = L.marker([55.75, 37.62], { icon: markerIcon({ color: '#1f6feb', name: 'Я', me: true }), zIndexOffset: 1000, interactive: false }).addTo(map);
  meMarker.setOpacity(0);

  map.on('dragstart', () => { state.follow = false; renderFollow(); });
  map.on('click', e => { if (state.tab === 'route') addWaypoint(e.latlng); });

  /** Иконка игрока: цветная точка, стрелка направления движения, подпись со скоростью. */
  function markerIcon({ color, name, heading, speedMs, me }) {
    const arrow = heading == null ? '' :
      `<div class="arrow" style="transform:rotate(${Math.round(heading)}deg)"><i style="border-bottom-color:${color}"></i></div>`;
    const sub = speedMs != null ? ` · ${kmh(speedMs)} км/ч` : '';
    return L.divIcon({
      className: 'vmk',
      iconSize: [0, 0],
      html: `<div class="vm${me ? ' me' : ''}">${arrow}<span class="dot" style="background:${color}"></span><span class="tag">${esc(name)}${sub}</span></div>`,
    });
  }

  function renderFollow() {
    const b = $('#btn-follow');
    b.classList.toggle('on', state.follow);
    b.textContent = state.follow ? '◎ Слежу' : '◎ Центр';
  }

  /* ---------- HUD и GPS ---------- */
  function setGps(text) { $('#gps').textContent = text; }

  function updateHud() {
    const f = state.fix;
    $('#spd').textContent = f && f.spd != null ? kmh(f.spd) : '--';
    setGps(f ? `GPS ±${Math.round(f.acc || 0)} м` : 'GPS: поиск…');
    const b = state.battery;
    $('#bat').textContent = b.level == null ? '🔋 —' : `🔋 ${Math.round(b.level * 100)}%${b.charging ? ' ⚡' : ''}`;
  }

  function updateMe() {
    const f = state.fix;
    if (!f) return;
    meMarker.setLatLng([f.lat, f.lon]).setOpacity(1);
    meMarker.setIcon(markerIcon({ color: '#1f6feb', name: 'Я', heading: f.hdg, speedMs: f.spd, me: true }));
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
    if (spd != null && spd < 0.5) spd = 0;            // GPS дрожит на стоянке
    const fix = { lat: c.latitude, lon: c.longitude, acc: c.accuracy, alt: c.altitude, t: p.timestamp, spd, hdg: hdg ?? (prev ? prev.hdg : null) };
    const first = !state.fix;
    state.fix = fix;
    if (first) map.setView([fix.lat, fix.lon], 15);
    else if (state.follow) map.panTo([fix.lat, fix.lon], { animate: true, duration: 0.4 });
    if (state.rec) recordPoint(fix);
    updateMe();
    updateHud();
    emit('fix', fix);
  }

  function onGeoError(e) {
    const msg = e.code === 1 ? 'нет доступа к геолокации' : e.code === 2 ? 'позиция недоступна' : 'таймаут GPS';
    setGps('GPS: ' + msg);
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

  /* ---------- экран не гаснет (во время записи и в лобби) ---------- */
  async function syncWake() {
    if (!('wakeLock' in navigator)) return;
    const want = state.lobbyAwake || !!state.rec;
    try {
      if (want && !state.wake) {
        state.wake = await navigator.wakeLock.request('screen');
        state.wake.addEventListener('release', () => { state.wake = null; });
      } else if (!want && state.wake) {
        await state.wake.release();
        state.wake = null;
      }
    } catch { /* браузер не разрешил — не критично */ }
  }
  function keepAwake(on) { state.lobbyAwake = !!on; syncWake(); }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncWake(); });

  /* ---------- запись поездки ---------- */
  function recordPoint(f) {
    const r = state.rec, pts = r.track.points, last = pts[pts.length - 1];
    if (f.acc != null && f.acc > 50) return;          // плохой сигнал не пишем
    if (last) {
      const d = G.distance(last.lat, last.lon, f.lat, f.lon);
      if (d < 2 && f.t - last.t < 5000) return;        // стоим — не плодим точки
      if (d < 300) r.track.distance += d;              // скачки GPS не считаем
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
    b.textContent = state.rec ? '■ Остановить запись' : '● Записать поездку';
    b.classList.toggle('danger', !!state.rec);
    $('#rec-info').textContent = state.rec
      ? `Идёт запись: ${G.formatDistance(state.rec.track.distance)}, макс. ${kmh(state.rec.track.maxSpd)} км/ч`
      : 'Запись не идёт. Поездки сохраняются на телефоне и доступны во вкладке «Поездки».';
  }

  /** Поездка, не закрытая из-за перезагрузки страницы, закрывается по последней точке. */
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
      plan.coords = null;
      if (planLine) { planLine.remove(); planLine = null; }
      renderPlan();
      return;
    }
    routeTimer = setTimeout(buildRoute, 350);
  }

  async function buildRoute() {
    const my = ++buildSeq;
    const s = S.settings.get();
    const lonlats = plan.wps.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join('|');
    const url = `${s.routerUrl}?lonlats=${lonlats}&profile=${encodeURIComponent(plan.profile)}&alternativeidx=0&format=geojson`;
    renderPlan('Строю маршрут…');
    try {
      const res = await fetch(url);
      const text = await res.text();
      if (!res.ok) throw new Error(text.trim().slice(0, 160) || `HTTP ${res.status}`);
      const f = JSON.parse(text).features[0];
      if (my !== buildSeq) return;
      plan.coords = f.geometry.coordinates.map(c => [c[1], c[0]]);
      plan.distance = +f.properties['track-length'] || G.lineLength(plan.coords);
      plan.time = +f.properties['total-time'] || 0;
      plan.ascent = +f.properties['filtered ascend'] || 0;
      drawPlan();
      renderPlan();
    } catch (e) {
      if (my === buildSeq) {
        plan.coords = null;
        renderPlan('Не удалось построить маршрут: ' + e.message);
      }
    }
  }

  function drawPlan() {
    if (planLine) planLine.remove();
    planLine = plan.coords ? L.polyline(plan.coords, { color: '#1f6feb', weight: 5, opacity: 0.85 }).addTo(map) : null;
  }

  function fitTo(coords) {
    if (coords && coords.length) map.fitBounds(L.latLngBounds(coords), { padding: [30, 30] });
  }

  function renderPlan(status) {
    const info = status || (plan.coords
      ? `${G.formatDistance(plan.distance)} · ~${G.formatDuration(plan.time)} · подъём ${Math.round(plan.ascent)} м`
      : plan.wps.length ? 'Поставьте ещё одну точку' : 'Нажимайте на карту, чтобы поставить точки маршрута');
    $('#plan-info').textContent = info;
    $('#plan-profile').value = plan.profile;
  }

  function clearPlan() {
    plan.wps = []; plan.coords = null; plan.id = null; plan.name = '';
    redrawWps(); scheduleRoute(); drawPlan();
  }

  async function saveRoute() {
    if (!plan.coords) return toast('Сначала постройте маршрут');
    const name = prompt('Название маршрута', plan.name || 'Маршрут ' + new Date().toLocaleDateString('ru'));
    if (!name) return;
    const r = {
      id: plan.id || 'rt-' + Date.now(), name, createdAt: Date.now(), profile: plan.profile,
      coords: plan.coords, distance: plan.distance, time: plan.time, wps: plan.wps.map(p => [p.lat, p.lng]),
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
    plan.coords = r.coords; plan.distance = r.distance; plan.time = r.time; plan.ascent = 0;
    plan.profile = r.profile || plan.profile; plan.id = r.id; plan.name = r.name;
    redrawWps(); drawPlan(); renderPlan(); fitTo(r.coords);
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

  /* ---------- экспорт GPX ---------- */
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

  /* ---------- список поездок ---------- */
  async function renderTracks() {
    const list = $('#track-list');
    const tracks = (await S.all('tracks')).sort((a, b) => b.startedAt - a.startedAt);
    if (!tracks.length) { list.innerHTML = '<p class="muted">Пока нет поездок. Включите запись на вкладке «Карта».</p>'; return; }
    list.innerHTML = tracks.map(t => {
      const end = t.endedAt || Date.now();
      const dur = (end - t.startedAt) / 1000;
      const avg = dur > 0 ? (t.distance / dur) * 3.6 : 0;
      const live = !t.endedAt ? ' <span class="badge">идёт запись</span>' : '';
      return `<article class="item">
        <div class="item-h"><b>${esc(t.name)}</b>${live}</div>
        <div class="stats">
          <span>${G.formatDistance(t.distance)}</span><span>${G.formatDuration(dur)}</span>
          <span>ср. ${avg.toFixed(1)} км/ч</span><span>макс. ${kmh(t.maxSpd)} км/ч</span>
        </div>
        <div class="row">
          <button data-act="show-track" data-id="${esc(t.id)}" class="${overlays.has('trk:' + t.id) ? 'on' : ''}">${overlays.has('trk:' + t.id) ? 'Скрыть' : 'Показать'}</button>
          <button data-act="gpx-track" data-id="${esc(t.id)}">GPX</button>
          <button data-act="del-track" data-id="${esc(t.id)}" class="danger">Удалить</button>
        </div></article>`;
    }).join('');
  }

  /* ---------- сохранённые маршруты ---------- */
  async function renderRoutes() {
    const list = $('#route-list');
    const routes = (await S.all('routes')).sort((a, b) => b.createdAt - a.createdAt);
    if (!routes.length) { list.innerHTML = '<p class="muted">Сохранённых маршрутов пока нет.</p>'; return; }
    list.innerHTML = routes.map(r => `<article class="item">
        <div class="item-h"><b>${esc(r.name)}</b></div>
        <div class="stats"><span>${G.formatDistance(r.distance)}</span><span>~${G.formatDuration(r.time)}</span><span>${esc(r.profile)}</span></div>
        <div class="row">
          <button data-act="open-route" data-id="${esc(r.id)}">Открыть</button>
          <button data-act="show-route" data-id="${esc(r.id)}" class="${overlays.has('rt:' + r.id) ? 'on' : ''}">${overlays.has('rt:' + r.id) ? 'Скрыть' : 'Показать'}</button>
          <button data-act="gpx-route" data-id="${esc(r.id)}">GPX</button>
          <button data-act="del-route" data-id="${esc(r.id)}" class="danger">Удалить</button>
        </div></article>`).join('');
  }

  /* ---------- офлайн-карты ---------- */
  let dl = null; // { abort, pack }

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
    $('#pack-est').textContent = `${e.count} тайлов · ~${OFF.fmtMb(e.sizeMb)}` + (over ? ` — больше лимита ${OFF.MAX_TILES}, уменьшите зум или область` : '');
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
    const name = currentArea() === 'view' ? 'Текущий вид' : OFF.AREAS[currentArea()].title;
    const zmin = +$('#pack-zmin').value, zmax = +$('#pack-zmax').value;
    const ac = new AbortController();
    dl = { abort: ac };
    $('#pack-progress').hidden = false;
    $('#btn-pack-cancel').hidden = false;
    $('#btn-pack-go').disabled = true;
    try {
      const pack = await OFF.download({
        name, bounds: packBounds(), zmin, zmax, signal: ac.signal,
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
        <div class="row"><button data-act="del-pack" data-id="${esc(p.id)}" class="danger">Удалить</button></div></article>`;
    }).join('') : '<p class="muted">Офлайн-карт пока нет. Выберите область и скачайте.</p>';
    const si = await OFF.storageInfo().catch(() => null);
    $('#storage-info').textContent = si ? `Занято приложением и кэшем: ${si.usedMb.toFixed(0)} МБ из ~${(si.quotaMb / 1024).toFixed(1)} ГБ доступно браузеру` : '';
  }

  /* ---------- общие подсказки ---------- */
  let toastTimer = 0;
  function toast(text, ms = 3000) {
    const t = $('#toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }

  /* ---------- вкладки ---------- */
  function showTab(name) {
    state.tab = name;
    $$('.tab').forEach(t => { t.hidden = t.dataset.tab !== name; });
    $$('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
    if (name === 'tracks') renderTracks();
    if (name === 'route') { renderPlan(); renderRoutes(); }
    if (name === 'offline') { renderPacks(); onAreaChange(); }
    emit('tab', name);
  }

  /* ---------- обработчики интерфейса ---------- */
  function bindUi() {
    $$('.tabbar button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
    $('#btn-follow').addEventListener('click', () => {
      state.follow = !state.follow;
      renderFollow();
      if (state.follow && state.fix) map.panTo([state.fix.lat, state.fix.lon]);
    });
    $('#btn-rec').addEventListener('click', toggleRec);
    $('#btn-undo').addEventListener('click', () => { plan.wps.pop(); redrawWps(); scheduleRoute(); });
    $('#btn-clear').addEventListener('click', clearPlan);
    $('#btn-save-route').addEventListener('click', saveRoute);
    $('#btn-gpx-plan').addEventListener('click', () => plan.coords ? download(plan.name || 'маршрут', toGpx(plan.name || 'Маршрут', plan.coords.map(([lat, lon]) => ({ lat, lon })))) : toast('Сначала постройте маршрут'));
    $('#btn-my-start').addEventListener('click', () => {
      if (!state.fix) return toast('Нет GPS-позиции');
      if (!plan.wps.length) addWaypoint(L.latLng(state.fix.lat, state.fix.lon));
      else { plan.wps.unshift(L.latLng(state.fix.lat, state.fix.lon)); redrawWps(); scheduleRoute(); }
    });
    $('#plan-profile').addEventListener('change', e => { plan.profile = e.target.value; S.settings.set({ profile: plan.profile }); if (plan.wps.length >= 2) scheduleRoute(); });

    $('#track-list').addEventListener('click', async e => {
      const b = e.target.closest('button'); if (!b) return;
      const id = b.dataset.id;
      if (b.dataset.act === 'show-track') {
        const t = await S.get('tracks', id);
        if (!t) return;
        const on = toggleOverlay('trk:' + id, t.points.map(p => [p.lat, p.lon]), '#e53935', true);
        if (!on) return renderTracks();
        renderTracks();
      } else if (b.dataset.act === 'gpx-track') {
        const t = await S.get('tracks', id);
        if (t) download(t.name, toGpx(t.name, t.points));
      } else if (b.dataset.act === 'del-track') {
        if (!confirm('Удалить поездку?')) return;
        if (overlays.has('trk:' + id)) { overlays.get('trk:' + id).remove(); overlays.delete('trk:' + id); }
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
        if (overlays.has('rt:' + id)) { overlays.get('rt:' + id).remove(); overlays.delete('rt:' + id); }
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
      map.removeLayer(tileLayer);
      tileLayer = L.tileLayer(tileUrl, { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(map);
      toast('Настройки сохранены');
    });

    window.addEventListener('resize', () => map.invalidateSize());
    window.addEventListener('online', updateHud);
    window.addEventListener('offline', () => setGps('нет сети — работают только офлайн-карты'));
  }

  /* ---------- запуск ---------- */
  function init() {
    bindUi();
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
    map, toast, showTab, fitTo, keepAwake, toGpx, download,
    on(type, fn) { (listeners[type] ||= []).push(fn); },
    getFix: () => state.fix,
    getBattery: () => state.battery,
    getPlanRoute: () => (plan.coords ? { name: plan.name || 'Текущий маршрут', coords: plan.coords, total: plan.distance } : null),
    listRoutes: () => S.all('routes'),
    getRoute: id => S.get('routes', id),
    markerIcon, toggleOverlay, esc,
  };

  document.addEventListener('DOMContentLoaded', init);
})(window);
