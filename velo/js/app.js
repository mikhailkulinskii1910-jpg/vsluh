/* «Велокарта»: карта (схема, спутник, тёмная тема, перепады высот), GPS, навигация,
   маршруты с оценкой сложности, запись поездок, офлайн-пакеты.
   Лобби, гонки и повтор финиша — в lobby.js; обмен через window.VeloApp. */
(function (root) {
  const G = root.VeloGeo, S = root.VeloStore;
  const IC = root.VeloIcons, SK = root.VeloSkins, EL = root.VeloElevation;
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const kmh = ms => (ms == null ? '—' : Math.round(ms * 3.6));
  const icon = (n, size = 18, cls = '') => IC.icon(n, size, cls);
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
    elev: !!cfg.elev,
    bike: cfg.bike !== false,
  };
  const plan = {
    wps: [], coords: null, distance: 0, time: 0, ascent: 0, stats: null,
    profile: cfg.routeMode2 ? (cfg.profile || 'best') : 'best', name: '', id: null,
    bikeShare: null, bikeFlags: null, extraM: null, candidates: 1,
  };
  const nav = { active: false, coords: null, cum: null, total: 0, turns: [], dest: null, along: 0, off: 0, rerouting: false };
  let buildSeq = 0, routeTimer = 0, searchTimer = 0;
  const overlays = new Map();

  /* ---------- карта ---------- */
  // подпись источников карты обязательна по лицензиям: она вынесена в панель (кнопка «©»), а не лежит поверх карты
  const map = L.map('map', { zoomControl: false, worldCopyJump: true, attributionControl: false }).setView([55.75, 37.62], 11);
  // панель меняет высоту под содержимое — карта должна пересчитать свой размер
  if (window.ResizeObserver) new ResizeObserver(() => map.invalidateSize()).observe(document.getElementById('map'));
  let baseLayer = null, elevLayer = null;
  const planLayer = L.layerGroup().addTo(map);
  let planLine = null;
  const meMarker = L.marker([55.75, 37.62], {
    icon: L.divIcon({ className: 'vmk', iconSize: [0, 0], html: `<div class="me-arrow">${icon('arrow', 28)}</div>` }),
    zIndexOffset: 1000, interactive: false,
  }).addTo(map);
  meMarker.setOpacity(0);

  function baseTemplate(base = state.base) {
    return base === 'sat' ? ESRI : S.settings.get().tileUrl;
  }

  /** Источники данных для текущих слоёв (показываются по кнопке «©» в панели). */
  function renderAttribution() {
    const parts = [state.base === 'sat' ? 'Снимки © Esri, Maxar, Earthstar Geographics'
      : vectorOn ? 'Карта © OpenFreeMap, OpenMapTiles, участники OpenStreetMap' : 'Карта © участники OpenStreetMap'];
    if (state.bike) parts.push('велополосы и веломаршруты: CyclOSM');
    if (state.elev) parts.push('высоты: Terrain Tiles (Mapzen, AWS)');
    parts.push('маршруты: BRouter', 'поиск: Photon (komoot)');
    const el = document.getElementById('attr-text');
    if (el) el.textContent = parts.join(' · ');
  }

  /** Слой велодорожек CyclOSM поверх любой подложки (выделяет велодорожки и велополосы). */
  let bikeLayer = null;
  /**
   * Режим «Велодорожки» выделяет всю велоинфраструктуру:
   * векторная схема — велодорожки, совмещённые вело-пешеходные и пути, где можно ехать (bicycle=yes);
   * слой CyclOSM — то, чего нет в векторных тайлах: велополосы на дорогах и веломаршруты.
   */
  function applyBikeLayer() {
    if (bikeLayer) { map.removeLayer(bikeLayer); bikeLayer = null; }
    if (vectorOn) {
      const m = baseLayer.getMaplibreMap && baseLayer.getMaplibreMap();
      const setVis = () => VS.BIKE_LAYERS.forEach(id => { if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', state.bike ? 'visible' : 'none'); });
      if (m) { if (m.isStyleLoaded()) setVis(); else m.once('styledata', setVis); }
    }
    if (state.bike) {
      bikeLayer = L.tileLayer('https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm-lite/{z}/{x}/{y}.png', { subdomains: 'abc', maxZoom: 19, className: 'bike-tiles', zIndex: 5 }).addTo(map);
    }
    const b = document.querySelector('#layer-pop [data-bike]');
    if (b) b.classList.toggle('on', state.bike);
    const lg = document.getElementById('bike-legend');
    if (lg) lg.hidden = !state.bike;
    S.settings.set({ bike: state.bike });
    renderAttribution();
  }

  /* Схема — векторная (MapLibre, OpenFreeMap): чёткая на любом экране. Без WebGL — растровая OSM. */
  const VS = root.VeloVectorStyle;
  let vectorOn = false;

  function applyBase() {
    if (baseLayer) map.removeLayer(baseLayer);
    vectorOn = state.base === 'osm' && !!(VS && VS.supported() && L.maplibreGL);
    if (vectorOn) {
      // без задержки + синхронная перерисовка: векторная подложка двигается в том же кадре, что маршрут
      // и стрелка, иначе при слежении за позицией карта «отстаёт» и линия маршрута съезжает с дорог
      baseLayer = L.maplibreGL({ style: VS.build({ bike: state.bike }), interactive: false });
      baseLayer._throttledUpdate = baseLayer._update; // без задержки (у плагина по умолчанию раз в 32 мс)
      const transform = baseLayer._transformGL;
      baseLayer._transformGL = function (gl) { transform.call(this, gl); if (gl.isStyleLoaded()) gl.redraw(); };
      baseLayer.addTo(map);
    } else {
      baseLayer = L.tileLayer(baseTemplate(), { maxZoom: 19, className: 'base-tiles' }).addTo(map);
    }
    applyBikeLayer();
    document.body.classList.toggle('base-osm', state.base === 'osm' && !vectorOn); // фильтр инверсии — только для растровой схемы
    $$('#layer-pop [data-base]').forEach(b => b.classList.toggle('on', b.dataset.base === state.base));
    S.settings.set({ base: state.base });
    renderAttribution();
  }


  function applyElev() {
    if (state.elev) {
      if (!elevLayer) elevLayer = EL.makeLayer();
      elevLayer.addTo(map);
    } else if (elevLayer) map.removeLayer(elevLayer);
    $('#btn-elev').classList.toggle('on', state.elev);
    S.settings.set({ elev: state.elev });
    renderAttribution();
  }

  map.on('dragstart', () => { state.follow = false; renderFollow(); });
  map.on('click', e => {
    $('#search-results').hidden = true;
    if (Date.now() - longPressAt < 800) return; // это было долгое нажатие — открыто меню точки
    if (state.tab === 'route') addWaypoint(e.latlng);
  });
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

  /** Своя позиция — простая стрелка, повёрнутая по направлению движения. */
  /*
   * Куда смотрит стрелка (как в Яндекс Картах): в движении — по курсу GPS (в навигации — по линии маршрута),
   * стоя на месте или медленно — по компасу телефона, поэтому стрелка поворачивается вместе с телефоном.
   */
  const compass = { hdg: null, raf: 0 };
  let arrowDeg = null; // накопленный угол без скачков 359° → 0°

  function arrowHeading() {
    const f = shownPos();
    const moving = f && f.spd != null && f.spd > 1.5 && f.hdg != null;
    if (moving) return f.hdg;
    if (compass.hdg != null) return compass.hdg;
    return f ? f.hdg : null;
  }

  function applyArrow() {
    const el = meMarker.getElement() && meMarker.getElement().querySelector('.me-arrow');
    const h = arrowHeading();
    if (!el || h == null) return;
    if (arrowDeg == null) arrowDeg = h;
    else arrowDeg += ((h - arrowDeg) % 360 + 540) % 360 - 180; // кратчайший поворот
    el.style.transform = `rotate(${arrowDeg.toFixed(1)}deg)`;
  }

  function onOrientation(e) {
    let h = null;
    if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading; // iOS
    else if (e.alpha != null && (e.absolute || e.type === 'deviceorientationabsolute')) h = 360 - e.alpha;
    if (h == null || isNaN(h)) return;
    const scr = (screen.orientation && screen.orientation.angle) || root.orientation || 0;
    h = (h + scr + 360) % 360;
    // сглаживание: дрожание датчика не должно трясти стрелку
    if (compass.hdg == null) compass.hdg = h;
    else compass.hdg = (compass.hdg + ((((h - compass.hdg) % 360) + 540) % 360 - 180) * 0.25 + 360) % 360;
    if (!compass.raf) compass.raf = requestAnimationFrame(() => { compass.raf = 0; applyArrow(); });
  }

  let compassOn = false, compassListening = false;
  function startCompass() {
    if (compassOn) return;
    const D = root.DeviceOrientationEvent;
    if (!D) return;
    if (!compassListening) {
      compassListening = true;
      if ('ondeviceorientationabsolute' in root) root.addEventListener('deviceorientationabsolute', onOrientation);
      else root.addEventListener('deviceorientation', onOrientation);
    }
    // iOS присылает данные компаса только после разрешения, а спросить его можно только по нажатию —
    // поэтому повторяем запрос при нажатии на кнопку местоположения, пока не разрешат
    if (typeof D.requestPermission === 'function') {
      D.requestPermission().then(r => { if (r === 'granted') compassOn = true; }).catch(() => {});
    } else compassOn = true;
  }

  function renderFollow() {
    $('#btn-follow').classList.toggle('on', state.follow);
    $('#btn-follow').setAttribute('aria-pressed', String(state.follow));
  }

  /* ---------- HUD и GPS ---------- */
  function setGps(text) { $('#gps').textContent = text; }

  function updateHud() {
    const f = state.fix;
    $('#spd').textContent = f && f.spd != null ? kmh(f.spd) : '--';
    setGps(f ? `GPS ±${Math.round(f.acc || 0)} м` : 'GPS: поиск…');
    const b = state.battery;
    $('#bat').innerHTML = b.level == null ? '—' : `${Math.round(b.level * 100)}%${b.charging ? ' ' + icon('bolt', 12, 'charging') : ''}`;
  }

  /** Где рисовать стрелку: во время навигации — на линии маршрута (как в навигаторах), иначе — сырой GPS. */
  function shownPos() {
    return (nav.active && nav.snap) || state.fix;
  }

  function updateMe() {
    const f = shownPos();
    if (!f) return;
    meMarker.setLatLng([f.lat, f.lon]).setOpacity(1);
    applyArrow();
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
    if (state.rec) recordPoint(fix);
    if (nav.active) updateNav();
    const at = shownPos();
    if (first) map.setView([at.lat, at.lon], 15);
    else if (state.follow) map.panTo([at.lat, at.lon], { animate: true, duration: 0.4 });
    updateMe();
    updateHud();
    emit('fix', fix);
  }

  function onGeoError(e) {
    setGps('GPS: ' + (e.code === 1 ? 'нет доступа к геолокации' : e.code === 2 ? 'позиция недоступна' : 'таймаут GPS'));
  }

  /* GPS: в браузере — watchPosition; в Android-приложении во время записи, навигации и лобби —
     фоновая служба (плагин background-geolocation), чтобы позиция шла и при выключенном экране. */
  const CAP = root.Capacitor;
  const NATIVE_BG = !!(CAP && CAP.isNativePlatform && CAP.isNativePlatform() && CAP.isPluginAvailable && CAP.isPluginAvailable('BackgroundGeolocation'));
  let gpsAllowed = false, webWatch = null, bgWatch = null, bgPending = false;

  function startWebGps() {
    if (webWatch != null || !navigator.geolocation) return;
    webWatch = navigator.geolocation.watchPosition(onPos, onGeoError, { enableHighAccuracy: true, maximumAge: 1000, timeout: 30000 });
  }
  function stopWebGps() {
    if (webWatch == null) return;
    navigator.geolocation.clearWatch(webWatch);
    webWatch = null;
  }

  /** Включает фоновую службу геолокации, когда идёт запись, навигация или лобби; иначе — обычный GPS. */
  async function syncBackgroundGps() {
    if (!NATIVE_BG || !gpsAllowed || bgPending) return;
    const want = state.lobbyAwake || !!state.rec || nav.active;
    if (want && bgWatch == null) {
      bgPending = true;
      try {
        bgWatch = CAP.nativeCallback('BackgroundGeolocation', 'addWatcher', {
          backgroundTitle: 'Велокарта',
          backgroundMessage: 'Запись поездки и позиция в лобби продолжаются',
          requestPermissions: true,
          stale: false,
          distanceFilter: 2,
        }, (loc, err) => {
          if (err) { onGeoError({ code: err.code === 'NOT_AUTHORIZED' ? 1 : 2 }); return; }
          if (!loc) return;
          onPos({
            coords: { latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy, altitude: loc.altitude, speed: loc.speed, heading: loc.bearing },
            timestamp: loc.time || Date.now(),
          });
        });
        stopWebGps(); // фоновая служба уже присылает позиции — второй источник не нужен
      } catch (e) {
        console.warn('фоновая геолокация недоступна', e);
        bgWatch = null;
        startWebGps();
      } finally { bgPending = false; }
    } else if (!want && bgWatch != null) {
      const id = bgWatch;
      bgWatch = null;
      startWebGps();
      try { await CAP.nativePromise('BackgroundGeolocation', 'removeWatcher', { id }); } catch { /* уже снят */ }
    }
  }

  function startGps() {
    if (!navigator.geolocation && !NATIVE_BG) return setGps('GPS недоступен в этом браузере');
    gpsAllowed = true;
    startCompass();
    startWebGps();
    syncBackgroundGps();
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
    syncBackgroundGps();
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
    document.body.classList.add('navigating');
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
    nav.snap = null;
    document.body.classList.remove('navigating');
    $('#nav-bar').hidden = true;
    $('#nav-card').hidden = true;
    syncWake();
    if (!silent) toast('Навигация остановлена');
  }

  function updateNav() {
    const f = state.fix;
    if (!nav.active || !f) return;
    const pr = G.projectOnPolyline(nav.coords, f.lat, f.lon);
    // GPS в городе гуляет на 10–30 м: если мы рядом с маршрутом, ставим стрелку на линию маршрута
    const snapR = Math.min(35, Math.max(15, f.acc || 0));
    if (pr.dist <= snapR) {
      const p = G.pointAlong(nav.coords, nav.cum, pr.along);
      const q = G.pointAlong(nav.coords, nav.cum, Math.min(nav.total, pr.along + 15));
      const hdg = pr.along + 1 < nav.total ? G.bearing(p[0], p[1], q[0], q[1]) : f.hdg;
      nav.snap = Object.assign({}, f, { lat: p[0], lon: p[1], hdg });
    } else nav.snap = null;
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
      applyRoute(r);
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
    renderRec(); // дистанция и скорость во время записи обновляются сразу
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
    b.textContent = state.rec ? 'Остановить запись' : 'Записать поездку';
    b.classList.toggle('danger', !!state.rec);
    b.classList.toggle('primary', !state.rec);
    const info = $('#rec-info');
    info.hidden = !state.rec;
    info.textContent = state.rec ? `${G.formatDistance(state.rec.track.distance)} · макс. ${kmh(state.rec.track.maxSpd)} км/ч` : '';
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
  const RT = root.VeloRouting;

  /** Один запрос к BRouter: профиль и номер альтернативы. */
  async function fetchOne(points, profile, alt = 0) {
    const s2 = S.settings.get();
    const lonlats = points.map(([lat, lon]) => `${lon.toFixed(6)},${lat.toFixed(6)}`).join('|');
    const url = `${s2.routerUrl}?lonlats=${lonlats}&profile=${encodeURIComponent(profile)}&alternativeidx=${alt}&format=geojson`;
    const res = await fetch(url);
    const text = await res.text();
    if (!res.ok) throw new Error(text.trim().slice(0, 160) || `HTTP ${res.status}`);
    const r = RT.parseBRouter(JSON.parse(text));
    if (!r.distance) r.distance = G.lineLength(r.coords);
    return r;
  }

  /*
   * Свой городской профиль (js/velo.brf): тротуары и велодорожки вместо проезжей части больших улиц.
   * Стандартные профили BRouter считают тротуар «велосипеду нельзя» (×5 к стоимости) и уводят на проспекты.
   * Профиль загружается на сервер маршрутов один раз за запуск; сервер со временем удаляет такие профили —
   * тогда загружаем заново.
   */
  let veloProfile = null, veloProfileId = null;
  function uploadVeloProfile(staleId) {
    if (veloProfile && (!staleId || staleId !== veloProfileId)) return veloProfile;
    veloProfile = (async () => {
      const brf = await (await fetch('js/velo.brf')).text();
      const res = await fetch(S.settings.get().routerUrl.replace(/\/$/, '') + '/profile', {
        method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: brf,
      });
      const j = await res.json();
      if (!j.profileid) throw new Error(j.error || 'профиль маршрутов не загрузился');
      return (veloProfileId = j.profileid);
    })().catch(e => { veloProfile = null; throw e; });
    return veloProfile;
  }
  async function fetchVelo(points, alt = 0) {
    const id = await uploadVeloProfile();
    try { return await fetchOne(points, id, alt); }
    catch { return fetchOne(points, await uploadVeloProfile(id), alt); } // профиль удалён с сервера — загружаем снова
  }

  /**
   * Маршрут по выбранному режиму. «Велодорожки без потери времени» (best): строим варианты своего профиля
   * (с альтернативами) и safety параллельно и берём тот, где больше всего велодорожек, если он не дороже
   * самого выгодного (допуск 0%). Если свой профиль недоступен — стандартные профили BRouter.
   */
  async function fetchRoute(points) {
    if (plan.profile === 'velo') return fetchVelo(points).catch(() => fetchOne(points, 'safety'));
    if (plan.profile !== 'best') return fetchOne(points, plan.profile);
    const two = points.length === 2; // альтернативы BRouter строит только для двух точек
    const jobs = [() => fetchVelo(points, 0), () => fetchOne(points, 'safety', 0)];
    if (two) jobs.push(() => fetchVelo(points, 1), () => fetchVelo(points, 2));
    let settled = await Promise.allSettled(jobs.map(j => j()));
    if (!settled.some(x => x.status === 'fulfilled')) {
      settled = await Promise.allSettled([fetchOne(points, 'safety', 0), fetchOne(points, 'trekking', 0)]);
    }
    const cands = settled.filter(x => x.status === 'fulfilled').map(x => x.value);
    if (!cands.length) throw settled[0].reason || new Error('сервер маршрутов недоступен');
    return RT.pickBest(cands);
  }

  /** Записать построенный маршрут в план. */
  function applyRoute(r) {
    Object.assign(plan, {
      coords: r.coords, distance: r.distance, time: r.time, ascent: r.ascent, stats: null,
      bikeShare: r.bikeShare, bikeFlags: r.bikeFlags, extraM: r.extraM ?? null, candidates: r.candidates || 1,
    });
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
      applyRoute(r);
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

  const BIKE_COLOR = '#4ade80';
  /** Маршрут на карте: участки по велодорожкам — зелёные, остальные — белые. */
  function drawPlan() {
    if (planLine) planLine.remove();
    planLine = null;
    if (!plan.coords) return;
    planLine = L.layerGroup(RT.splitByBike(plan.coords, plan.bikeFlags).map(run =>
      L.polyline(run.coords, { color: run.bike ? BIKE_COLOR : '#ffffff', weight: run.bike ? 7 : 5, opacity: 1 }))).addTo(map);
  }

  function fitTo(coords) {
    if (coords && coords.length) map.fitBounds(L.latLngBounds(coords), { padding: [30, 30] });
  }

  function routeSummary() {
    const parts = [G.formatDistance(plan.distance), '~' + G.formatDuration(plan.time)];
    if (plan.bikeShare != null) parts.push(`велодорожки ${Math.round(plan.bikeShare * 100)}%`);
    if (plan.profile === 'best' && plan.extraM != null && plan.candidates > 1) {
      const min = Math.round(plan.extraM / 266); // ≈16 км/ч
      parts.push(min < 1 ? 'без потери времени' : `+${min} мин ради велодорожек`);
    }
    return parts.join(' · ');
  }

  function difficultyHtml(st) {
    if (!st) return '';
    return `<span class="diff-tag ${st.tone}">${esc(st.label)}</span>
      <span class="diff-stats">подъём ${st.ascent} м · спуск ${st.descent} м · макс. уклон ${st.maxGrade}%</span>`;
  }

  function renderPlan(status) {
    const info = status || (plan.coords
      ? routeSummary()
      : plan.wps.length ? 'Поставьте ещё одну точку на карте или найдите адрес' : 'Нажимайте на карту или введите адрес сверху');
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
    plan.wps = []; plan.coords = null; plan.id = null; plan.name = ''; plan.stats = null; plan.bikeFlags = null; plan.bikeShare = null;
    redrawWps(); scheduleRoute(); drawPlan();
  }

  async function saveRoute() {
    if (!plan.coords) return toast('Сначала постройте маршрут');
    const name = prompt('Название маршрута', plan.name || 'Маршрут ' + new Date().toLocaleDateString('ru'));
    if (!name) return;
    const r = {
      id: plan.id || 'rt-' + Date.now(), name, createdAt: Date.now(), profile: plan.profile,
      coords: plan.coords, distance: plan.distance, time: plan.time, wps: plan.wps.map(p => [p.lat, p.lng]),
      stats: plan.stats, bikeShare: plan.bikeShare ?? null, bikeFlags: plan.bikeFlags || null,
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
    Object.assign(plan, { coords: r.coords, distance: r.distance, time: r.time, ascent: 0, stats: r.stats || null, profile: r.profile || plan.profile, id: r.id, name: r.name, bikeShare: r.bikeShare ?? null, bikeFlags: r.bikeFlags || null, extraM: null, candidates: 1 });
    redrawWps(); drawPlan(); renderPlan(); fitTo(r.coords);
    showTab('route');
  }

  /* ---------- поиск: подсказки (Photon) и мои места ---------- */
  /* Публичный Nominatim запрещает поиск «по мере ввода», поэтому подсказки идут через Photon (komoot) —
     сервис именно для этого, на тех же данных OpenStreetMap. */
  let places = [];
  const placesLayer = L.layerGroup().addTo(map);
  let suggestAbort = null, longPressAt = 0;
  const RECENT_KEY = 'velo-recent';

  function loadRecent() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; } }
  function pushRecent(it) {
    const list = loadRecent().filter(r => !(Math.abs(r.lat - it.lat) < 1e-5 && Math.abs(r.lon - it.lon) < 1e-5));
    list.unshift({ name: it.name, sub: it.sub || '', lat: +it.lat, lon: +it.lon });
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 6))); } catch { /* приватный режим */ }
  }

  function localMatches(q) {
    const s2 = q.toLowerCase();
    const pl = places.filter(p => !s2 || p.name.toLowerCase().includes(s2)).slice(0, 5)
      .map(p => ({ kind: 'place', name: p.name, sub: 'моё место', lat: p.lat, lon: p.lon }));
    const rc = loadRecent().filter(r => !s2 || r.name.toLowerCase().includes(s2)).slice(0, s2 ? 3 : 6)
      .map(r => ({ kind: 'recent', name: r.name, sub: r.sub, lat: r.lat, lon: r.lon }));
    return pl.concat(rc);
  }

  function renderSuggestions(items, note) {
    const list = $('#search-results');
    const f = state.fix;
    const head = { place: 'Мои места', recent: 'Недавние', geo: 'Адреса и места' };
    let html = '', last = '';
    items.forEach((it, i) => {
      if (it.kind !== last) { html += `<li class="sr-head">${head[it.kind]}</li>`; last = it.kind; }
      const d = f ? G.formatDistance(G.distance(f.lat, f.lon, it.lat, it.lon)) : '';
      html += `<li data-i="${i}">${esc(it.name)}<small>${esc([it.sub, d].filter(Boolean).join(' · '))}</small></li>`;
    });
    if (note) html += `<li class="sr-head">${esc(note)}</li>`;
    list._items = items;
    list.innerHTML = html;
    list.hidden = !html;
  }

  function photonItem(f) {
    const p = f.properties || {}, [lon, lat] = f.geometry.coordinates;
    const street = [p.street, p.housenumber].filter(Boolean).join(', ');
    const name = p.name || street || p.city || 'Точка';
    const sub = [p.name && street ? street : '', p.district || p.locality || '', p.city || p.county || '']
      .filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(' · ');
    return { kind: 'geo', name, sub, lat, lon };
  }

  /** Подсказки: сначала мои места и недавние (сразу), потом адреса из Photon с учётом позиции. */
  async function suggest(q) {
    if (suggestAbort) { suggestAbort.abort(); suggestAbort = null; } // ответ на прежний текст уже не нужен
    const local = localMatches(q);
    if (q.length < 2) return renderSuggestions(local);
    renderSuggestions(local, 'Ищу…');
    suggestAbort = new AbortController();
    const f = state.fix, c = map.getCenter();
    const bias = `&lat=${(f ? f.lat : c.lat).toFixed(4)}&lon=${(f ? f.lon : c.lng).toFixed(4)}`;
    try {
      const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=10&lang=default${bias}`, { signal: suggestAbort.signal });
      const data = await res.json();
      if (q !== $('#search-input').value.trim()) return; // пока ждали, текст изменился
      const seen = new Set();
      const geo = (data.features || []).map(photonItem).filter(it => {
        const k = it.name + '|' + it.sub; // одна улица приходит несколькими отрезками — оставляем один
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      }).slice(0, 6);
      renderSuggestions(local.concat(geo), geo.length || local.length ? '' : 'Ничего не найдено');
    } catch (e) {
      if (e.name !== 'AbortError') renderSuggestions(local, 'Поиск недоступен — нет сети');
    }
  }

  /* ---------- мои места: сохранённые точки на карте ---------- */
  async function loadPlaces() {
    places = (await S.all('places').catch(() => [])).sort((x, y) => y.createdAt - x.createdAt);
    renderPlacesOnMap();
    renderPlacesList();
  }

  function renderPlacesOnMap() {
    placesLayer.clearLayers();
    for (const p of places) {
      L.marker([p.lat, p.lon], { icon: L.divIcon({ className: 'vmk', iconSize: [0, 0], html: `<div class="place-pin"></div><span class="place-tag">${esc(p.name)}</span>` }), zIndexOffset: 300 })
        .on('click', () => openPointMenu(L.latLng(p.lat, p.lon), p))
        .addTo(placesLayer);
    }
  }

  function renderPlacesList() {
    const box = $('#place-list');
    if (!box) return;
    const f = state.fix;
    box.innerHTML = places.length ? places.map(p => `<article class="item">
        <div class="item-h"><b>${esc(p.name)}</b></div>
        <div class="stats">${f ? `<span>${G.formatDistance(G.distance(f.lat, f.lon, p.lat, p.lon))}</span>` : ''}<span>${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}</span></div>
        <div class="row">
          <button class="ghost" data-act="go-place" data-id="${esc(p.id)}">Маршрут</button>
          <button class="ghost" data-act="show-place" data-id="${esc(p.id)}">На карте</button>
          <button class="ghost danger" data-act="del-place" data-id="${esc(p.id)}">Удалить</button>
        </div></article>`).join('')
      : '<p class="muted small">Долгое нажатие на карту — сохранить точку.</p>';
  }

  async function savePlace(latlng, suggested) {
    const name = prompt('Название места', suggested || `Место ${places.length + 1}`);
    if (!name || !name.trim()) return;
    await S.put('places', { id: 'pl-' + Date.now(), name: name.trim().slice(0, 40), lat: latlng.lat, lon: latlng.lng, createdAt: Date.now() });
    await loadPlaces();
    toast('Место сохранено');
  }

  async function deletePlace(id) {
    if (!confirm('Удалить место?')) return;
    await S.del('places', id);
    await loadPlaces();
  }

  /** Меню точки: долгое нажатие на карту или нажатие на сохранённое место. */
  let menuPoint = null;
  function openPointMenu(latlng, place) {
    menuPoint = { latlng, place };
    $('#pm-title').textContent = place ? place.name : `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
    $('#pm-save').hidden = !!place;
    $('#pm-del').hidden = !place;
    $('#point-menu').hidden = false;
  }
  function closePointMenu() { $('#point-menu').hidden = true; menuPoint = null; }

  /** Долгое нажатие на карту. На iPhone событие contextmenu не приходит, поэтому считаем касание сами. */
  function bindLongPress() {
    const el = map.getContainer();
    let timer = 0, start = null;
    el.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) { clearTimeout(timer); return; }
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY };
      clearTimeout(timer);
      timer = setTimeout(() => {
        const r = el.getBoundingClientRect();
        longPressAt = Date.now();
        openPointMenu(map.containerPointToLatLng([start.x - r.left, start.y - r.top]));
        if (navigator.vibrate) navigator.vibrate(20);
      }, 600);
    }, { passive: true });
    el.addEventListener('touchmove', e => {
      const t = e.touches[0];
      if (start && Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10) clearTimeout(timer);
    }, { passive: true });
    el.addEventListener('touchend', () => clearTimeout(timer), { passive: true });
    map.on('contextmenu', e => { if (Date.now() - longPressAt > 800) { longPressAt = Date.now(); openPointMenu(e.latlng); } });
  }

  function chooseDestination(it) {
    const dest = L.latLng(+it.lat, +it.lon);
    plan.name = it.name || it.display_name.split(',')[0];
    plan.wps = state.fix ? [L.latLng(state.fix.lat, state.fix.lon), dest] : [dest];
    pushRecent({ name: plan.name, sub: it.sub || '', lat: +it.lat, lon: +it.lon });
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
          <button data-act="gpx-track" data-id="${esc(t.id)}">GPX</button>
          <button data-act="del-track" data-id="${esc(t.id)}" class="danger">Удалить</button>
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
          <button data-act="gpx-route" data-id="${esc(r.id)}">GPX</button>
          <button data-act="del-route" data-id="${esc(r.id)}" class="danger">Удалить</button>
        </div></article>`;
    }).join('');
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
    if (name === 'route') { renderPlan(); renderRoutes(); renderPlacesList(); }
    emit('tab', name);
  }

  /* ---------- интерфейс ---------- */
  function bindUi() {
    $$('.tabbar button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

    $('#btn-follow').addEventListener('click', () => {
      startCompass(); // на iOS разрешение на компас даётся только по нажатию
      state.follow = !state.follow;
      renderFollow();
      if (state.follow && state.fix) { const at = shownPos(); map.panTo([at.lat, at.lon]); }
    });
    $('#btn-layers').addEventListener('click', () => { $('#layer-pop').hidden = !$('#layer-pop').hidden; });
    $$('#layer-pop [data-base]').forEach(b => b.addEventListener('click', () => {
      state.base = b.dataset.base;
      applyBase();
      $('#layer-pop').hidden = true;
    }));
    $('#layer-pop [data-bike]').addEventListener('click', () => { state.bike = !state.bike; applyBikeLayer(); });
    $('#btn-elev').addEventListener('click', () => { state.elev = !state.elev; applyElev(); if (state.elev) toast('Перепады высот: светлее — выше'); });

    const si = $('#search-input');
    si.addEventListener('focus', () => suggest(si.value.trim()));
    si.addEventListener('blur', () => setTimeout(() => { $('#search-results').hidden = true; }, 250)); // задержка — чтобы нажатие на подсказку успело сработать
    si.addEventListener('input', () => {
      clearTimeout(searchTimer);
      const q = si.value.trim();
      renderSuggestions(localMatches(q), q.length >= 2 ? 'Ищу…' : '');
      searchTimer = setTimeout(() => suggest(q), 300);
    });
    si.addEventListener('keydown', e => {
      if (e.key === 'Enter') { clearTimeout(searchTimer); suggest(si.value.trim()); }
      if (e.key === 'Escape') { $('#search-results').hidden = true; si.blur(); }
    });
    $('#pm-route').addEventListener('click', () => { if (menuPoint) chooseDestination({ lat: menuPoint.latlng.lat, lon: menuPoint.latlng.lng, name: menuPoint.place ? menuPoint.place.name : 'Точка на карте' }); closePointMenu(); });
    $('#pm-save').addEventListener('click', () => { const p = menuPoint; closePointMenu(); if (p) savePlace(p.latlng); });
    $('#pm-del').addEventListener('click', () => { const p = menuPoint; closePointMenu(); if (p && p.place) deletePlace(p.place.id); });
    $('#pm-close').addEventListener('click', closePointMenu);
    $('#btn-save-dest').addEventListener('click', () => {
      const last = plan.wps[plan.wps.length - 1];
      if (!last) return toast('Сначала поставьте точку или найдите адрес');
      savePlace(last, plan.name || '');
    });
    $('#place-list').addEventListener('click', e => {
      const b2 = e.target.closest('button'); if (!b2) return;
      const p = places.find(x => x.id === b2.dataset.id); if (!p) return;
      if (b2.dataset.act === 'go-place') chooseDestination({ lat: p.lat, lon: p.lon, name: p.name });
      else if (b2.dataset.act === 'show-place') { map.setView([p.lat, p.lon], 16); showTab('map'); }
      else if (b2.dataset.act === 'del-place') deletePlace(p.id);
    });
    bindLongPress();
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
      S.settings.set({ profile: plan.profile, routeMode2: true });
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

    window.addEventListener('online', updateHud);
    window.addEventListener('offline', () => setGps('нет сети: карта и маршруты недоступны'));
  }

  /* ---------- запуск ---------- */
  function init() {
    IC.hydrate(document);
    bindUi();
    bindPanelHandle();
    loadPlaces();
    $('#attr-btn').addEventListener('click', () => { renderAttribution(); const t = $('#attr-text'); t.hidden = !t.hidden; });
    if (cfg.panelCollapsed) document.body.classList.add('panel-collapsed');
    applyBase();
    applyElev();
    renderFollow();
    renderRec();
    renderPlan();
    showTab('map');
    recoverTracks().catch(console.error);
    // офлайн-режим удалён: убираем старый service worker и кэш тайлов у тех, кто открывал прежние версии
    if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {});
    if (window.caches) caches.keys().then(ks => ks.filter(k => k.startsWith('velo-')).forEach(k => caches.delete(k))).catch(() => {});
    root.VeloLegal.mountConsent({ onAccept: startGps });
    setInterval(updateHud, 1000);
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
