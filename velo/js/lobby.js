/* Лобби «Велокарты»: код и вход, курсоры игроков, гонка и погоня, повтор финиша. */
(function (root) {
  const G = root.VeloGeo, S = root.VeloStore, App = root.VeloApp, IC = root.VeloIcons, SK = root.VeloSkins;
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];
  const esc = App.esc;
  const icon = (n, s = 16) => IC.icon(n, s);
  const net = new root.VeloLobby.Lobby();

  const ui = {
    R: null, you: null, sig: '', lastSend: 0, deadline: 0, deadlineKind: '', routeKey: '',
    routeCoords: null, routeLine: null, finishMarker: null, replayId: null, replayRaf: 0, replayTimers: [],
  };
  const markers = new Map();

  /* ---------- экран ---------- */
  function showRoom(on) {
    $('#lobby-setup').hidden = on;
    $('#lobby-room').hidden = !on;
  }

  function setStatus(text, isErr) {
    const el = $('#lb-status');
    el.textContent = text || '';
    el.classList.toggle('err', !!isErr);
  }

  function defaultServerUrl() {
    const { protocol, host, hostname } = location;
    if (!protocol.startsWith('http') || hostname.endsWith('github.io')) return '';
    return (protocol === 'https:' ? 'wss://' : 'ws://') + host + '/ws';
  }

  function serverUrl() {
    return $('#lb-server').value.trim() || S.settings.get().serverUrl || defaultServerUrl();
  }

  function mySkin() { return S.settings.get().skin || SK.DEFAULT; }

  async function connect() {
    const url = serverUrl();
    if (!url) throw new Error('Укажите адрес сервера лобби (например wss://example.com/ws)');
    S.settings.set({ serverUrl: url, name: $('#lb-name').value.trim() });
    if (net.connected && net.url === url) return;
    if (net.ws) { net.wanted = false; net.ws.close(); net.wanted = true; }
    await net.connect(url);
  }

  async function create() {
    setStatus('Подключаюсь…');
    try {
      await connect();
      net.send({ type: 'create', name: $('#lb-name').value.trim() });
      setStatus('');
    } catch (e) { setStatus(e.message, true); }
  }

  async function join() {
    const code = $('#lb-code').value.trim().toUpperCase();
    if (code.length < 4) return setStatus('Введите код лобби', true);
    setStatus('Подключаюсь…');
    try {
      await connect();
      net.send({ type: 'join', code, name: $('#lb-name').value.trim() });
      setStatus('');
    } catch (e) { setStatus(e.message, true); }
  }

  function leave() {
    net.send({ type: 'leave' });
    net.clearSession();
    ui.R = null; ui.you = null; ui.sig = '';
    clearRoute();
    markers.forEach(m => m.remove()); markers.clear();
    stopReplay();
    App.keepAwake(false);
    showRoom(false);
    setStatus('');
  }

  /* ---------- сообщения сервера ---------- */
  function applyRoom(room) {
    ui.R = room;
    if (ui.you && !room.members.find(m => m.id === ui.you)) { leave(); App.toast('Вы больше не в лобби'); return; }
    renderHeader();
    renderPlayers();
    renderControls();
    renderGame();
    updateMarkers();
  }

  function handleEvents(events) {
    const R = ui.R;
    const name = id => (R && R.members.find(m => m.id === id) || {}).name || 'Игрок';
    for (const ev of events || []) {
      if (ev.type === 'started') { App.toast('Старт!'); buzz([200]); }
      else if (ev.type === 'finished') {
        if (ev.id === ui.you) { App.toast(`Финиш! Ваше место: ${ev.place}`, 5000); buzz([200, 100, 200]); }
        else App.toast(`${name(ev.id)} финишировал(а) — ${ev.place} место`);
      } else if (ev.type === 'caught') {
        const mine = ev.chaserId === ui.you || ev.runnerId === ui.you;
        App.toast(`${name(ev.chaserId)} поймал(а) ${name(ev.runnerId)}!`, 5000);
        if (mine) buzz([300, 100, 300]);
      } else if (ev.type === 'host') {
        App.toast(`Новый хост: ${name(ev.id)}`);
      }
    }
  }

  function buzz(p) { if (navigator.vibrate) navigator.vibrate(p); }

  net.on('joined', m => {
    ui.you = m.you;
    applyRoom(m.room);
    showRoom(true);
    App.keepAwake(true);
    App.toast(`Вы в лобби ${m.code}`);
  });
  net.on('room', m => {
    applyRoom(m.room);
    handleEvents(m.events);
    if (m.replay) playReplay(m.replay);
  });
  net.on('replay', m => playReplay(m.replay));
  net.on('route', m => drawRoute(m.route));
  net.on('error', m => { setStatus(m.message, true); App.toast(m.message, 4000); });
  net.on('disconnected', () => { if (ui.R) renderHeader('Связь потеряна, переподключаюсь…'); });
  net.on('connected', () => { if (ui.R) renderHeader(); });

  /* ---------- шапка ---------- */
  function renderHeader(warn) {
    const R = ui.R;
    if (!R) return;
    $('#lb-code-big').textContent = R.code;
    const me = R.members.find(m => m.id === ui.you);
    const host = R.members.find(m => m.id === R.hostId);
    const modeName = R.config.mode === 'race' ? 'Гонка' : 'Погоня';
    $('#lb-meta').textContent = warn || `${modeName} · ${R.members.length} в лобби · хост: ${host ? host.name : '—'}${me && me.id === R.hostId ? ' (вы)' : ''}`;
    $('#lb-meta').classList.toggle('warn', !!warn);
  }

  /* ---------- список игроков ---------- */
  function renderPlayers() {
    const R = ui.R, fix = App.getFix();
    const rows = R.members.map(m => {
      const dist = fix && m.lat != null ? G.distance(fix.lat, fix.lon, m.lat, m.lon) : null;
      const stale = !m.online || m.seenAgoMs > 5000;
      const bat = m.bat == null ? '—' : `${Math.round(m.bat * 100)}%${m.charging ? ' +' : ''}`;
      const role = m.role === 'chaser' ? `<span class="badge red">догоняет</span>`
        : m.role === 'runner' ? `<span class="badge">беглец</span>` : '';
      const place = m.place ? `<span class="badge gold">${m.place} место</span>` : '';
      return `<li class="${stale ? 'stale' : ''}">
        <span class="sw" style="background:${m.color}"></span>
        <div class="who"><b>${esc(m.name)}${m.id === ui.you ? ' (вы)' : ''}${m.host ? ' · хост' : ''}</b>
          <small>${stale ? 'нет связи' : `${m.spd == null ? '—' : Math.round(m.spd * 3.6)} км/ч`} · ${bat}${dist != null && m.id !== ui.you ? ` · ${G.formatDistance(dist)}` : ''}</small>
        </div>
        <div class="tags">${role}${place}</div>
      </li>`;
    });
    $('#lb-members').innerHTML = rows.join('') || '<li class="muted">Пока никого</li>';
    $('#lb-skin-name').textContent = (SK.get(mySkin()).name);
  }

  /* ---------- управление хоста ---------- */
  async function renderControls() {
    const R = ui.R, isHost = R.hostId === ui.you;
    const saved = await App.listRoutes().catch(() => []);
    const plan = App.getPlanRoute();
    const sig = JSON.stringify({
      isHost, mode: R.config.mode, status: R.game.status, route: R.route && R.route.name,
      saved: saved.map(r => r.id + r.name), plan: !!plan, members: R.members.map(m => m.id + m.name),
      chasers: R.config.chaserIds, grace: R.config.graceSec, time: R.config.timeLimitSec,
    });
    if (sig === ui.sig) return;
    ui.sig = sig;
    const box = $('#lb-host');
    const busy = R.game.status === 'running' || R.game.status === 'countdown';
    if (!isHost) {
      const modeName = R.config.mode === 'race' ? 'Гонка' : 'Погоня';
      box.innerHTML = `<p class="muted">Режим: <b>${modeName}</b>${R.route ? `, маршрут «${esc(R.route.name)}» (${G.formatDistance(R.route.total)})` : ''}. Настраивает хост.</p>`;
      return;
    }
    const chasers = new Set(R.config.chaserIds);
    box.innerHTML = `
      <div class="seg">
        <button data-mode="race" class="${R.config.mode === 'race' ? 'on' : ''}" ${busy ? 'disabled' : ''}>Гонка</button>
        <button data-mode="chase" class="${R.config.mode === 'chase' ? 'on' : ''}" ${busy ? 'disabled' : ''}>Погоня</button>
      </div>
      ${R.config.mode === 'race' ? `
        <label class="field">Маршрут
          <select id="lb-route" ${busy ? 'disabled' : ''}>
            <option value="">— выберите —</option>
            ${plan ? '<option value="plan">Текущий маршрут (вкладка «Маршрут»)</option>' : ''}
            ${saved.map(r => `<option value="saved:${esc(r.id)}">${esc(r.name)} (${G.formatDistance(r.distance)})</option>`).join('')}
          </select>
        </label>
        <label class="field">Ждать остальных после первого финиша, с
          <input id="lb-grace" type="number" min="0" max="600" value="${R.config.graceSec}" ${busy ? 'disabled' : ''}>
        </label>` : `
        <div class="field"><span>Догоняющие</span>
          <div class="chips">${R.members.map(m => `<label class="chip"><input type="checkbox" data-chaser="${esc(m.id)}" ${chasers.has(m.id) ? 'checked' : ''} ${busy ? 'disabled' : ''}> ${esc(m.name)}</label>`).join('')}</div>
        </div>
        <div class="grid3">
          <label class="field">Минут<input id="lb-time" type="number" min="1" max="240" value="${Math.round(R.config.timeLimitSec / 60)}" ${busy ? 'disabled' : ''}></label>
          <label class="field">Ловим, м<input id="lb-catchm" type="number" min="0.5" max="20" step="0.5" value="${R.config.catchM}" ${busy ? 'disabled' : ''}></label>
          <label class="field">Держать, с<input id="lb-catchs" type="number" min="0.5" max="30" step="0.5" value="${R.config.catchS}" ${busy ? 'disabled' : ''}></label>
        </div>`}
      <div class="row">
        <button id="lb-start" class="primary grow" ${busy ? 'disabled' : ''}>Старт (отсчёт 10 с)</button>
        <button id="lb-stop" class="danger" ${busy ? '' : 'disabled'}>Стоп</button>
      </div>`;
    if (R.config.mode === 'race' && ui.routeKey) { const sel = $('#lb-route'); if (sel) sel.value = ui.routeKey; }
  }

  function sendConfig(patch) { net.send({ type: 'config', config: patch }); }

  async function pickRoute(key) {
    ui.routeKey = key;
    let route = null;
    if (key === 'plan') route = App.getPlanRoute();
    else if (key && key.startsWith('saved:')) {
      const r = await App.getRoute(key.slice(6));
      if (r) route = { name: r.name, coords: r.coords };
    }
    if (!route) return;
    net.send({ type: 'route', route: { name: route.name, coords: route.coords } });
  }

  /* ---------- игра ---------- */
  function renderGame() {
    const R = ui.R, g = R.game, box = $('#lb-game');
    ui.deadlineKind = g.status === 'countdown' || g.status === 'running' ? g.status : '';
    if (g.status === 'countdown') ui.deadline = Date.now() + g.countdownLeftMs;
    if (g.status === 'running') ui.deadline = Date.now() + (g.graceLeftMs > 0 ? g.graceLeftMs : g.timeLeftMs);

    if (g.status === 'idle') {
      box.innerHTML = R.config.mode === 'race'
        ? `<p class="muted">Гонка: первый, кто доедет до финиша маршрута, побеждает.${R.route ? ` Маршрут: ${esc(R.route.name)}, ${G.formatDistance(R.route.total)}.` : ' Хост ещё не выбрал маршрут.'}</p>`
        : `<p class="muted">Погоня: догоняющий должен подъехать к беглецу ближе ${R.config.catchM} м и продержаться ${R.config.catchS} с. Беглецы выигрывают, если время выйдет.</p>`;
      return;
    }
    if (g.status === 'countdown') {
      box.innerHTML = `<div class="big">Старт через <span data-timer></span></div>`;
      return;
    }
    if (g.status === 'running' && R.config.mode === 'race') {
      const total = R.route ? R.route.total : 0;
      const rows = [...R.members].sort((a, b) => (a.place || 99) - (b.place || 99) || b.progress - a.progress);
      const label = g.graceLeftMs > 0 ? 'до конца заезда' : 'гонка';
      box.innerHTML = `<div class="big">${label} · <span data-timer></span></div>` + rows.map(m => {
        const pct = total ? Math.min(100, Math.round((m.progress / total) * 100)) : 0;
        return `<div class="bar-row"><span class="bn">${esc(m.name)}</span>
          <div class="bar"><i style="width:${m.place ? 100 : pct}%;background:${m.color}"></i></div>
          <span class="bp">${m.place ? m.place + ' место' : pct + '%'}</span></div>`;
      }).join('');
      return;
    }
    if (g.status === 'running') {
      const me = R.members.find(m => m.id === ui.you);
      const role = me && me.role === 'chaser' ? 'Вы догоняете' : me && me.role === 'runner' ? 'Вы убегаете' : 'Вы наблюдаете';
      const name = id => (R.members.find(m => m.id === id) || {}).name || '?';
      const contacts = g.contacts.map(c => {
        const pct = Math.min(100, (c.ms / (R.config.catchS * 1000)) * 100);
        return `<div class="bar-row"><span class="bn">${esc(name(c.chaserId))} → ${esc(name(c.runnerId))}</span>
          <div class="bar"><i style="width:${pct}%"></i></div><span class="bp">${(c.ms / 1000).toFixed(1)} с</span></div>`;
      }).join('');
      box.innerHTML = `<div class="big">Погоня · <span data-timer></span></div><p class="muted">${role}</p>
        ${contacts || '<p class="muted">Контакта пока нет</p>'}`;
      return;
    }
    // finished
    if (R.config.mode === 'race') {
      const rows = g.results.map(r => `<li><b>${r.place}.</b> ${esc(r.name)} <small>${G.formatDuration(r.finishedMs / 1000)}</small></li>`).join('');
      box.innerHTML = `<div class="big">${g.results.length ? 'Результаты гонки' : 'Гонка завершена'}</div><ul class="results">${rows || '<li class="muted">Никто не финишировал</li>'}</ul>${endReason(g)}`;
    } else {
      const w = g.winnerRole === 'chaser' ? 'Догоняющие поймали беглеца!' : g.winnerRole === 'runner' ? 'Беглецы продержались до конца!' : 'Игра остановлена';
      box.innerHTML = `<div class="big">${w}</div>${endReason(g)}`;
    }
  }

  function endReason(g) {
    const map = { caught: 'Беглец пойман', time: 'Время вышло', grace: 'Первый финишировал, остальным время вышло', all: 'Все финишировали', stopped: 'Остановлено хостом' };
    return `<p class="muted">${map[g.reason] || ''}</p>`;
  }

  function tickTimers() {
    const el = document.querySelector('#lb-game [data-timer]');
    if (!el || !ui.deadline) return;
    const left = Math.max(0, ui.deadline - Date.now());
    el.textContent = ui.deadlineKind === 'countdown' ? Math.ceil(left / 1000) + ' с' : G.formatDuration(left / 1000);
  }

  /* ---------- карта: курсоры соперников и маршрут ---------- */
  function updateMarkers() {
    const R = ui.R;
    const seen = new Set();
    for (const m of R.members) {
      if (m.id === ui.you || m.lat == null) continue;
      seen.add(m.id);
      const icn = App.skinIcon({ color: m.color, skin: m.skin, heading: m.hdg, name: m.name, off: !m.online, speedMs: m.spd });
      let mk = markers.get(m.id);
      if (!mk) {
        mk = L.marker([m.lat, m.lon], { icon: icn, zIndexOffset: 500 }).addTo(App.map);
        markers.set(m.id, mk);
      } else {
        mk.setLatLng([m.lat, m.lon]).setIcon(icn);
      }
    }
    for (const [id, mk] of markers) if (!seen.has(id)) { mk.remove(); markers.delete(id); }
  }

  function drawRoute(route) {
    clearRoute();
    if (!route) return;
    ui.routeCoords = route.coords;
    ui.routeLine = L.polyline(route.coords, { color: '#f57c00', weight: 6, opacity: 0.8, dashArray: '2 8' }).addTo(App.map);
    const last = route.coords[route.coords.length - 1];
    ui.finishMarker = L.marker(last, { icon: L.divIcon({ className: '', html: `<div class="finish">${icon('flag', 18)}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }) }).addTo(App.map);
  }

  function clearRoute() {
    if (ui.routeLine) ui.routeLine.remove();
    if (ui.finishMarker) ui.finishMarker.remove();
    ui.routeLine = ui.finishMarker = null;
    ui.routeCoords = null;
  }

  /* ---------- повтор финиша: траектории, парковка у финиша, итоги ---------- */
  /** Позиция и курс на траектории в момент t (мс от старта). */
  function positionAt(trail, t) {
    if (t <= trail[0][0]) return { ll: [trail[0][1], trail[0][2]], hdg: 0 };
    const last = trail[trail.length - 1];
    if (t >= last[0]) return { ll: [last[1], last[2]], hdg: 0 };
    let lo = 0, hi = trail.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (trail[mid][0] <= t) lo = mid; else hi = mid; }
    const a = trail[lo], b = trail[hi];
    const k = (t - a[0]) / ((b[0] - a[0]) || 1);
    return { ll: [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k], hdg: G.bearing(a[1], a[2], b[1], b[2]) };
  }

  function stopReplay() {
    cancelAnimationFrame(ui.replayRaf);
    ui.replayTimers.forEach(clearTimeout);
    ui.replayTimers = [];
    if (ui.replayGroup) { ui.replayGroup.remove(); ui.replayGroup = null; }
    $('#replay').hidden = true;
  }

  function playReplay(rp) {
    if (!rp || !rp.members || ui.replayId === rp.id) return;
    ui.replayId = rp.id;
    stopReplay();
    const members = rp.members.filter(m => m.trail && m.trail.length);
    const replay = $('#replay');
    replay.hidden = false;
    $('#replay-card').hidden = true;
    $('#replay-title').textContent = 'Заезд завершён';
    if (!members.length) { finishCard(rp, members); return; }

    const all = members.flatMap(m => m.trail.map(p => [p[1], p[2]]));
    if (ui.routeCoords) all.push(ui.routeCoords[ui.routeCoords.length - 1]);
    App.map.fitBounds(L.latLngBounds(all), { padding: [40, 160] });

    const dur = Math.max(...members.map(m => m.trail[m.trail.length - 1][0]), 1000);
    const PLAY_MS = 9000;
    const finishLL = ui.routeCoords ? ui.routeCoords[ui.routeCoords.length - 1] : all[all.length - 1];
    const group = L.layerGroup().addTo(App.map);
    ui.replayGroup = group;
    const items = members.map(m => {
      const line = L.polyline([], { color: m.color, weight: 4, opacity: 0.85 }).addTo(group);
      const start = positionAt(m.trail, 0);
      const mk = L.marker(start.ll, { icon: App.skinIcon({ color: m.color, skin: m.skin, heading: 0, name: m.name }), zIndexOffset: 600 }).addTo(group);
      return { m, line, mk, hdg: -1 };
    });
    const parkAt = (k) => {
      const n = Math.max(items.length, 6), ang = (k / n) * Math.PI * 2;
      const r = 14 / 111195;
      return [finishLL[0] + Math.cos(ang) * r, finishLL[1] + (Math.sin(ang) * r) / Math.cos(finishLL[0] * Math.PI / 180)];
    };
    const place = (it) => (it.m.place ? it.m.place - 1 : items.indexOf(it) + items.length);

    const draw = (it, ll, t) => {
      const pos = positionAt(it.m.trail, t);
      it.line.setLatLngs([...it.m.trail.filter(p => p[0] <= t).map(p => [p[1], p[2]]), ll]);
      it.mk.setLatLng(ll);
      const h = Math.round(pos.hdg / 6) * 6;
      if (h !== it.hdg) { it.hdg = h; it.mk.setIcon(App.skinIcon({ color: it.m.color, skin: it.m.skin, heading: h, name: it.m.name })); }
    };

    const t0 = performance.now();
    const frame = now => {
      const p = Math.min(1, (now - t0) / PLAY_MS);
      for (const it of items) draw(it, positionAt(it.m.trail, p * dur).ll, p * dur);
      if (p < 1) { ui.replayRaf = requestAnimationFrame(frame); return; }
      park(0);
    };
    const park = (k) => {
      // заезжают на парковку у финиша по одному
      if (k >= items.length) { ui.replayTimers.push(setTimeout(() => finishCard(rp, members), 500)); return; }
      const it = items[k];
      const from = it.mk.getLatLng();
      const to = parkAt(place(it));
      const s = performance.now();
      const step = now => {
        const q = Math.min(1, (now - s) / 900);
        const ll = [from.lat + (to[0] - from.lat) * q, from.lng + (to[1] - from.lng) * q];
        it.mk.setLatLng(ll);
        it.line.setLatLngs([...it.m.trail.map(p => [p[1], p[2]]), ll]);
        if (q < 1) ui.replayRaf = requestAnimationFrame(step);
        else ui.replayTimers.push(setTimeout(() => park(k + 1), 150));
      };
      ui.replayRaf = requestAnimationFrame(step);
    };
    ui.replaySkip = () => {
      cancelAnimationFrame(ui.replayRaf);
      items.forEach((it, k) => { const to = parkAt(place(it)); it.mk.setLatLng(to); it.line.setLatLngs([...it.m.trail.map(p => [p[1], p[2]]), to]); });
      finishCard(rp, members);
    };
    ui.replayRaf = requestAnimationFrame(frame);
  }

  function finishCard(rp, members) {
    const me = ui.you;
    const results = members.filter(m => m.place).sort((a, b) => a.place - b.place);
    const others = members.filter(m => !m.place);
    const fmt = ms => ms == null ? '—' : G.formatDuration(ms / 1000);
    const rowOf = m => `<li><span class="pl">${m.place || '—'}</span>
      <span><span class="nm">${esc(m.name)}${m.id === me ? ' (вы)' : ''}</span><small>${m.place ? 'финиш ' + fmt(m.finishedMs) : 'не финишировал'}</small></span>
      <i style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${m.color}"></i></li>`;
    const mine = results.find(m => m.id === me);
    $('#replay-title').textContent = mine ? (mine.place === 1 ? 'Вы первые!' : `Вы — ${mine.place} место`) : 'Заезд завершён';
    $('#replay-card').innerHTML = `<ol>${[...results, ...others].map(rowOf).join('') || '<li class="muted">Нет данных</li>'}</ol>`;
    $('#replay-card').hidden = false;
  }

  $('#replay-skip').addEventListener('click', () => {
    if (ui.replaySkip) { ui.replaySkip(); ui.replaySkip = null; }
    else { stopReplay(); }
    $('#replay-card').hidden = false;
  });

  /* ---------- курсор: выбор ---------- */
  function renderSkinGrid(filter = '') {
    const q = filter.trim().toLowerCase();
    const cur = mySkin();
    $('#skin-grid').innerHTML = SK.list
      .filter(s => !q || s.name.toLowerCase().includes(q) || s.id.includes(q))
      .map(s => `<button class="skin-opt ${s.id === cur ? 'on' : ''}" data-skin="${s.id}">${s.svg}<span>${esc(s.name)}</span></button>`)
      .join('') || '<p class="muted">Ничего не найдено</p>';
  }

  function openSkins() {
    $('#modal-title').textContent = `Мой курсор (${SK.count})`;
    $('#skin-search').value = '';
    renderSkinGrid();
    $('#modal').hidden = false;
  }

  function closeSkins() { $('#modal').hidden = true; }

  function chooseSkin(id) {
    S.settings.set({ skin: id });
    $('#lb-skin-name').textContent = SK.get(id).name;
    closeSkins();
    App.toast(`Курсор: ${SK.get(id).name}`);
    if (ui.you) sendFix(App.getFix(), true);
    if (ui.R) renderPlayers();
  }

  /* ---------- отправка позиции ---------- */
  function sendFix(fix, force) {
    if (!fix || !ui.you || !net.connected) return;
    if (!force && Date.now() - ui.lastSend < sendIntervalMs()) return;
    ui.lastSend = Date.now();
    const b = App.getBattery();
    net.send({
      type: 'state',
      fix: { lat: fix.lat, lon: fix.lon, acc: fix.acc, spd: fix.spd, hdg: fix.hdg, t: fix.t, bat: b.level, charging: b.charging, skin: mySkin() },
    });
  }
  function sendIntervalMs() { return ui.R && ui.R.game.status === 'running' ? 500 : 1000; }

  App.on('fix', fix => sendFix(fix, false));
  setInterval(() => {
    const fix = App.getFix();
    if (fix && ui.you && Date.now() - fix.t < 5000) sendFix(fix, false); // heartbeat: GPS молчит — позицию не шлём повторно
  }, 500);
  App.on('battery', () => { if (ui.R) renderPlayers(); });

  /* ---------- привязка интерфейса ---------- */
  function bind() {
    const s = S.settings.get();
    $('#lb-name').value = s.name || '';
    $('#lb-server').value = s.serverUrl || defaultServerUrl();
    $('#lb-skin-name').textContent = SK.get(mySkin()).name;
    $('#lb-code').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); });
    $('#lb-create').addEventListener('click', create);
    $('#lb-join').addEventListener('click', join);
    $('#lb-leave').addEventListener('click', () => { if (confirm('Выйти из лобби?')) leave(); });
    $('#lb-share').addEventListener('click', async () => {
      const text = `Присоединяйся к велозаезду в Велокарте! Код лобби: ${ui.R.code}`;
      try {
        if (navigator.share) await navigator.share({ title: 'Велокарта', text });
        else { await navigator.clipboard.writeText(text); App.toast('Код скопирован'); }
      } catch { /* отмена шаринга */ }
    });
    $('#lb-skin').addEventListener('click', openSkins);
    $('#modal-close').addEventListener('click', closeSkins);
    $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeSkins(); });
    $('#skin-search').addEventListener('input', e => renderSkinGrid(e.target.value));
    $('#skin-grid').addEventListener('click', e => {
      const b = e.target.closest('[data-skin]');
      if (b) chooseSkin(b.dataset.skin);
    });

    $('#lb-host').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.mode) { ui.sig = ''; sendConfig({ mode: b.dataset.mode }); }
      else if (b.id === 'lb-start') {
        if (ui.R.config.mode === 'race' && !ui.R.route) return App.toast('Сначала выберите маршрут');
        net.send({ type: 'start' });
      } else if (b.id === 'lb-stop') net.send({ type: 'stop' });
    });
    $('#lb-host').addEventListener('change', e => {
      const t = e.target;
      if (t.id === 'lb-route') { ui.routeKey = t.value; pickRoute(t.value); }
      else if (t.dataset.chaser !== undefined) {
        const ids = [...document.querySelectorAll('[data-chaser]:checked')].map(x => x.dataset.chaser);
        sendConfig({ chaserIds: ids });
      } else if (['lb-time', 'lb-catchm', 'lb-catchs', 'lb-grace'].includes(t.id)) {
        const v = parseFloat(t.value);
        if (!isFinite(v)) return;
        const patch = { 'lb-time': { timeLimitSec: v * 60 }, 'lb-catchm': { catchM: v }, 'lb-catchs': { catchS: v }, 'lb-grace': { graceSec: v } }[t.id];
        sendConfig(patch);
      }
    });

    setInterval(tickTimers, 250);
    $$('.tabbar button[data-tab="lobby"]').forEach(b => b.addEventListener('click', () => { ui.sig = ''; if (ui.R) renderControls(); }));
  }

  /* Восстанавливаем лобби после перезагрузки страницы (сессия в sessionStorage). */
  function restore() {
    showRoom(false);
    if (net.session && serverUrl()) {
      setStatus('Возвращаюсь в лобби…');
      connect().catch(e => setStatus(e.message, true));
    }
  }

  document.addEventListener('DOMContentLoaded', () => { bind(); restore(); });
})(window);
