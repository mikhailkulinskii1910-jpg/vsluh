/* Лобби «Велокарты»: создание и вход по коду, живые позиции игроков, гонка и погоня. */
(function (root) {
  const G = root.VeloGeo, S = root.VeloStore, App = root.VeloApp;
  const $ = (sel) => document.querySelector(sel);
  const esc = App.esc;
  const net = new root.VeloLobby.Lobby();

  const ui = { R: null, you: null, routeLine: null, finishMarker: null, routeCoords: null, sig: '', lastSend: 0, deadline: 0, deadlineKind: '' };
  const markers = new Map(); // id → маркер соперника
  const COLORS_BY_ROLE = { chaser: '🎯', runner: '🏃' };

  /* ---------- экран: настройка / комната ---------- */
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
    return ($('#lb-server').value.trim() || S.settings.get().serverUrl || defaultServerUrl());
  }

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
    App.keepAwake(false);
    showRoom(false);
    setStatus('');
  }

  /* ---------- сообщения сервера ---------- */
  function applyRoom(room) {
    ui.R = room;
    const me = room.members.find(m => m.id === ui.you);
    if (ui.you && !me) { leave(); App.toast('Вы больше не в лобби'); return; }
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
  net.on('room', m => { applyRoom(m.room); handleEvents(m.events); });
  net.on('route', m => drawRoute(m.route));
  net.on('error', m => {
    setStatus(m.message, true);
    App.toast(m.message, 4000);
  });
  net.on('disconnected', () => { if (ui.R) renderHeader('Связь потеряна, переподключаюсь…'); });
  net.on('connected', () => { if (ui.R) renderHeader(); });

  /* ---------- шапка комнаты ---------- */
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
    const list = $('#lb-members');
    const rows = R.members.map(m => {
      const dist = fix && m.lat != null ? G.distance(fix.lat, fix.lon, m.lat, m.lon) : null;
      const stale = !m.online || m.seenAgoMs > 5000;
      const bat = m.bat == null ? '—' : `${Math.round(m.bat * 100)}%${m.charging ? ' ⚡' : ''}`;
      const role = m.role === 'chaser' ? '<span class="badge red">догоняет</span>' : m.role === 'runner' ? '<span class="badge">беглец</span>' : '';
      const place = m.place ? `<span class="badge gold">${m.place} место</span>` : '';
      const dir = m.hdg == null ? '' : `<span class="dir" style="transform:rotate(${Math.round(m.hdg)}deg)">➤</span>`;
      return `<li class="${stale ? 'stale' : ''}">
        <span class="sw" style="background:${m.color}"></span>
        <div class="who"><b>${esc(m.name)}${m.id === ui.you ? ' (вы)' : ''}${m.host ? ' 👑' : ''}</b>
          <small>${stale ? 'нет связи' : `${m.spd == null ? '—' : Math.round(m.spd * 3.6)} км/ч`} · 🔋 ${bat}${dist != null && m.id !== ui.you ? ` · ${G.formatDistance(dist)}` : ''}</small>
        </div>
        <div class="tags">${dir}${role}${place}</div>
      </li>`;
    });
    list.innerHTML = rows.join('') || '<li class="muted">Пока никого</li>';
  }

  /* ---------- управление хоста ---------- */
  async function renderControls() {
    const R = ui.R, isHost = R.hostId === ui.you;
    const saved = await App.listRoutes().catch(() => []);
    const plan = App.getPlanRoute();
    const sig = JSON.stringify({
      isHost, mode: R.config.mode, status: R.game.status, route: R.route && R.route.name,
      saved: saved.map(r => r.id + r.name), plan: !!plan, members: R.members.map(m => m.id + m.name),
      chasers: R.config.chaserIds,
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
        <button id="lb-start" class="primary" ${busy ? 'disabled' : ''}>▶ Старт (отсчёт 10 с)</button>
        <button id="lb-stop" class="danger" ${busy ? '' : 'disabled'}>■ Стоп</button>
      </div>`;
    if (R.config.mode === 'race' && R.route) {
      const sel = $('#lb-route');
      if (sel && ui.routeKey) sel.value = ui.routeKey;
    }
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

  /* ---------- игра: таблица, отсчёт, итоги ---------- */
  function renderGame() {
    const R = ui.R, g = R.game, box = $('#lb-game');
    const kind = g.status;
    ui.deadlineKind = kind === 'countdown' || kind === 'running' ? kind : '';
    if (kind === 'countdown') ui.deadline = Date.now() + g.countdownLeftMs;
    if (kind === 'running') ui.deadline = Date.now() + (g.graceLeftMs > 0 ? g.graceLeftMs : g.timeLeftMs);

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
          <span class="bp">${m.place ? m.place + ' 🏁' : pct + '%'}</span></div>`;
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
    let head;
    if (R.config.mode === 'race') {
      head = g.results.length ? 'Результаты гонки' : 'Гонка завершена';
      const rows = g.results.map(r => `<li><b>${r.place}.</b> ${esc(r.name)} <small>${G.formatDuration(r.finishedMs / 1000)}</small></li>`).join('');
      box.innerHTML = `<div class="big">${head}</div><ol class="results">${rows || '<li class="muted">Никто не финишировал</li>'}</ol>${endReason(g)}`;
    } else {
      const w = g.winnerRole === 'chaser' ? 'Догоняющие поймали беглеца!' : g.winnerRole === 'runner' ? 'Беглецы продержались до конца!' : 'Игра остановлена';
      head = w;
      box.innerHTML = `<div class="big">${head}</div>${endReason(g)}`;
    }
  }

  function endReason(g) {
    const map = { caught: 'Беглец пойман', time: 'Время вышло', grace: 'Первый финишировал, остальным время вышло', all: 'Все финишировали', stopped: 'Остановлено хостом' };
    return `<p class="muted">${map[g.reason] || ''}</p>`;
  }

  /** Обновляет таймеры на экране раз в 250 мс по локальным дедлайнам. */
  function tickTimers() {
    const el = document.querySelector('#lb-game [data-timer]');
    if (!el || !ui.deadline) return;
    const left = Math.max(0, ui.deadline - Date.now());
    el.textContent = ui.deadlineKind === 'countdown' ? Math.ceil(left / 1000) + ' с' : G.formatDuration(left / 1000);
  }

  /* ---------- карта: маркеры соперников и маршрут гонки ---------- */
  function updateMarkers() {
    const R = ui.R;
    const seen = new Set();
    for (const m of R.members) {
      if (m.id === ui.you || m.lat == null) continue;
      seen.add(m.id);
      const tag = m.role ? `${COLORS_BY_ROLE[m.role]} ` : '';
      const icon = App.markerIcon({ color: m.color, name: tag + m.name, heading: m.hdg, speedMs: m.spd });
      let mk = markers.get(m.id);
      if (!mk) {
        mk = L.marker([m.lat, m.lon], { icon, zIndexOffset: 500 }).addTo(App.map);
        markers.set(m.id, mk);
      } else {
        mk.setLatLng([m.lat, m.lon]).setIcon(icon);
      }
      mk.setOpacity(m.online ? 1 : 0.4);
    }
    for (const [id, mk] of markers) if (!seen.has(id)) { mk.remove(); markers.delete(id); }
  }

  function drawRoute(route) {
    clearRoute();
    if (!route) return;
    ui.routeCoords = route.coords;
    ui.routeLine = L.polyline(route.coords, { color: '#f57c00', weight: 6, opacity: 0.8, dashArray: '2 8' }).addTo(App.map);
    const last = route.coords[route.coords.length - 1];
    ui.finishMarker = L.marker(last, { icon: L.divIcon({ className: '', html: '<div class="finish">🏁</div>', iconSize: [28, 28], iconAnchor: [14, 26] }) }).addTo(App.map);
  }

  function clearRoute() {
    if (ui.routeLine) ui.routeLine.remove();
    if (ui.finishMarker) ui.finishMarker.remove();
    ui.routeLine = ui.finishMarker = null;
    ui.routeCoords = null;
  }

  /* ---------- отправка своей позиции ---------- */
  function sendFix(fix) {
    if (!ui.you || !net.connected) return;
    ui.lastSend = Date.now();
    const b = App.getBattery();
    net.send({
      type: 'state',
      fix: { lat: fix.lat, lon: fix.lon, acc: fix.acc, spd: fix.spd, hdg: fix.hdg, t: fix.t, bat: b.level, charging: b.charging },
    });
  }
  function sendIntervalMs() { return ui.R && ui.R.game.status === 'running' ? 500 : 1000; }
  App.on('fix', fix => { if (Date.now() - ui.lastSend >= sendIntervalMs()) sendFix(fix); });
  // Если GPS молчит дольше пары секунд, позицию не шлём повторно — игрок станет «нет связи»
  setInterval(() => {
    const fix = App.getFix();
    if (fix && ui.you && Date.now() - fix.t < 5000 && Date.now() - ui.lastSend >= sendIntervalMs()) sendFix(fix);
  }, 500);

  App.on('battery', () => { if (ui.R) renderPlayers(); });

  /* ---------- привязка интерфейса ---------- */
  function bind() {
    const s = S.settings.get();
    $('#lb-name').value = s.name || '';
    $('#lb-server').value = s.serverUrl || defaultServerUrl();
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
      if (t.id === 'lb-route') pickRoute(t.value);
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
    document.querySelectorAll('.tabbar button[data-tab="lobby"]').forEach(b => b.addEventListener('click', () => { ui.sig = ''; renderControlsSafe(); }));
  }

  function renderControlsSafe() { if (ui.R) renderControls(); }

  /* Восстанавливаем лобби после перезагрузки страницы (сессия хранится в sessionStorage). */
  function restore() {
    showRoom(false);
    if (net.session && serverUrl()) {
      setStatus('Возвращаюсь в лобби…');
      connect().catch(e => setStatus(e.message, true));
    }
  }

  document.addEventListener('DOMContentLoaded', () => { bind(); restore(); });
})(window);
