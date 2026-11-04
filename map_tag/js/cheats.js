// Секретная вкладка «Читы» (вход по паролю) и колесо рандома с подкруткой для выбора водящего
import { getLang } from './i18n.js';
import { I } from './icons.js';
import { POWERUPS, pwName } from './content.js';
import { OBJ, OBJ_KINDS } from './world.js';

const ru = () => getLang() === 'ru';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const PASS_HASH = 'ddbd24d7691d4bba3ab4dbf6671a9c5b526db3a83357bdb9a44f3326d3271bb1';

// SHA-256 без crypto.subtle (работает и вне https)
function sha256(str) {
  const K = [], H = [];
  const frac = (x) => ((x - Math.floor(x)) * 0x100000000) | 0;
  for (let n = 2, c = 0; c < 64; n++) { let p = true; for (let d = 2; d * d <= n; d++) if (n % d === 0) { p = false; break; } if (p) { if (c < 8) H[c] = frac(Math.pow(n, 1 / 2)); K[c++] = frac(Math.pow(n, 1 / 3)); } }
  const bytes = new TextEncoder().encode(str), l = bytes.length;
  const words = new Array(((l + 9 + 63) >> 6) << 4).fill(0);
  for (let i = 0; i < l; i++) words[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
  words[l >> 2] |= 0x80 << (24 - (l % 4) * 8);
  words[words.length - 1] = l * 8;
  const r = (x, n) => (x >>> n) | (x << (32 - n));
  for (let j = 0; j < words.length; j += 16) {
    const w = words.slice(j, j + 16);
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      if (i >= 16) { const s0 = r(w[i - 15], 7) ^ r(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = r(w[i - 2], 17) ^ r(w[i - 2], 19) ^ (w[i - 2] >>> 10); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0; }
      const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    [a, b, c, d, e, f, g, h].forEach((v, i) => { H[i] = (H[i] + v) | 0; });
  }
  return H.map((v) => (v >>> 0).toString(16).padStart(8, '0')).join('');
}
const roleName = (r) => ({ hunter: ru() ? 'Охотник' : 'Hunter', hider: ru() ? 'Прячущийся' : 'Hider', spectator: ru() ? 'Зритель' : 'Spectator', dead: ru() ? 'Выбыл' : 'Out', escaped: ru() ? 'Спасён' : 'Escaped' })[r] || r;
const objName = (k) => ({ bush: ['Куст', 'Bush'], radar: ['Радар', 'Radar'], chest: ['Сундук', 'Chest'], camera: ['Камера', 'Camera'], boost: ['Ускоритель', 'Booster'], portal: ['Портал', 'Portal'], bell: ['Колокол', 'Bell'], mine: ['Мина', 'Mine'], smoke: ['Дымовая шашка', 'Smoke bomb'], lighthouse: ['Маяк', 'Lighthouse'], medkit: ['Аптечка', 'Medkit'], snare: ['Капкан', 'Snare'], compass: ['Компас', 'Compass'], radio: ['Радиовышка', 'Radio tower'], flarebox: ['Ящик ракет', 'Flare box'], mirror: ['Зеркало', 'Mirror'], clock: ['Часы', 'Clock'], clover: ['Клевер', 'Clover'], freezer: ['Морозилка', 'Freezer'], target: ['Мишень', 'Target'] })[k][ru() ? 0 : 1];
export const checkPass = (p) => sha256(String(p).trim()) === PASS_HASH;

export const CHEATS = [
  ['wall', 'Видеть всех', 'See everyone', 'Все игроки, круги «Раскрытия» и следы видны на карте.', 'Every player, reveal circle and footprint is shown.', 'eye'],
  ['stamina', 'Бесконечная выносливость', 'Infinite stamina', 'Бег не тратит выносливость.', 'Running never drains stamina.', 'run'],
  ['nocd', 'Без перезарядки', 'No cooldowns', '«Раскрытие» и «Заморозка» всегда готовы.', 'Reveal and Freeze are always ready.', 'clock'],
  ['noout', 'Зона не выбивает', 'Zone never eliminates', 'Можно сколько угодно быть за границей зоны и в смертельных зонах.', 'Stay outside the zone and in deadly zones as long as you like.', 'map'],
  ['untouch', 'Неуловимость', 'Untouchable', 'Боты не могут вас поймать.', 'Bots cannot catch you.', 'shield'],
  ['immune', 'Иммунитет', 'Immunity', '«Раскрытие» и «Заморозка» вас не задевают.', 'Reveal and Freeze never hit you.', 'snow'],
  ['speed', 'Скорость ×3', 'Speed ×3', 'В демо-режиме вы ходите втрое быстрее.', 'You move three times faster in demo mode.', 'bolt'],
  ['magnet', 'Магнит тайников', 'Cache magnet', 'Тайники подбираются с 90 м.', 'Caches are picked up from 90 m.', 'supply'],
  ['allpw', 'Все бонусы', 'All power-ups', 'С началом охоты — по 2 каждого бонуса.', 'Two of every power-up when the hunt starts.', 'sparkle'],
  ['reach', 'Длинные руки', 'Long arms', '«Поймал» достаёт до 250 м.', 'Catch reaches 250 m.', 'crosshair'],
  ['radar', 'Точный радар', 'Exact radar', 'Компас и детектор включены всегда, показывают точные метры и обновляются без задержки.', 'Compass and detector always on, with exact metres and no delay.', 'scan'],
  ['spoof', 'Подмена гео', 'Fake location', 'В режиме GPS настоящее гео игнорируется — вы ходите касаниями карты.', 'In GPS mode your real location is ignored — you walk by tapping the map.', 'locate'],
  ['teleport', 'Телепорт', 'Teleport', 'Вместе с подменой гео касание карты мгновенно переносит вас.', 'With fake location, a map tap moves you instantly.', 'swap'],
  ['stealth', 'Стелс', 'Stealth', 'Боты вас не замечают, а ваш бег не оставляет следов.', 'Bots never notice you and your running leaves no footprints.', 'ghost'],
  ['xray', 'Рентген', 'X-ray', 'Ваше «Раскрытие» ставит маленький круг прямо на прячущегося.', 'Your Reveal puts a tiny circle right on the Hider.', 'crosshair'],
  ['infpw', 'Бесконечные бонусы', 'Endless power-ups', 'Бонусы не тратятся при использовании.', 'Power-ups are not used up.', 'sparkle'],
  ['autocatch', 'Автопоимка', 'Auto-catch', 'Охотником вы сами ловите ботов в 30 м.', 'As a Hunter you auto-catch bots within 30 m.', 'target'],
  ['slowmo', 'Замедление', 'Slow motion', 'Время идёт вдвое медленнее (только офлайн).', 'Time runs at half speed (offline only).', 'clock'],
  ['skiphide', 'Без пряток', 'Skip hiding', 'Охота начинается сразу.', 'The hunt starts right away.', 'play'],
];

// ---------- колесо ----------
const WCOL = ['#ff8a5b', '#a99bff', '#4fd1c5', '#f6c453', '#f26d7d', '#5fd38d', '#8fd0ff', '#ff9ec7', '#c3e06b', '#ffb86b'];

/** Колесо в модальном окне. names — список, rig — имя победителя (подкрутка) или null. onResult(name). */
export function openWheel(modal, { names, rig, title, onResult, onRole }) {
  names = names.filter(Boolean);
  if (names.length < 2) names = [...names, ru() ? 'Игрок 2' : 'Player 2'];
  const n = names.length, seg = 360 / n;
  const R = 150;
  const arc = (i) => {
    const a0 = (i * seg - 90) * Math.PI / 180, a1 = ((i + 1) * seg - 90) * Math.PI / 180;
    const big = seg > 180 ? 1 : 0;
    return `M0 0L${R * Math.cos(a0)} ${R * Math.sin(a0)}A${R} ${R} 0 ${big} 1 ${R * Math.cos(a1)} ${R * Math.sin(a1)}Z`;
  };
  const label = (i, s) => { const a = (i + 0.5) * seg; return `<text transform="rotate(${a}) translate(0 ${-R * 0.62}) rotate(90)" text-anchor="middle" dominant-baseline="middle" font-size="${n > 8 ? 12 : 15}" font-weight="700" fill="#10141f" font-family="sans-serif">${esc(s.length > 12 ? s.slice(0, 11) + '…' : s)}</text>`; };
  const svg = `<svg viewBox="-160 -160 320 320" style="width:100%;max-width:320px;display:block;margin:0 auto">
    <g id="wh" style="transition:transform 5.2s cubic-bezier(.12,.68,.08,1)">${names.map((s, i) => `<path d="${arc(i)}" fill="${WCOL[i % WCOL.length]}" stroke="#10141f" stroke-width="2"/>${label(i, s)}`).join('')}</g>
    <circle r="22" fill="#10141f" stroke="#fff" stroke-width="3"/><path d="M-12 -158 12 -158 0 -128z" fill="#fff" stroke="#10141f" stroke-width="2"/></svg>`;
  modal(`<h2>${esc(title || (ru() ? 'Кто водит?' : 'Who is it?'))}</h2>${svg}
    <div id="wres" style="text-align:center;font-size:26px;font-weight:700;min-height:40px;margin:12px 0"></div>
    <div class="row"><button class="btn" data-x style="flex:1">${ru() ? 'Закрыть' : 'Close'}</button><button class="btn primary" data-spin style="flex:2">${I.play}${ru() ? 'Крутить' : 'Spin'}</button></div>
    <div id="wrole" style="margin-top:10px"></div>`, (box, close) => {
    const g = box.querySelector('#wh');
    let rot = 0, busy = false;
    box.querySelector('[data-x]').onclick = close;
    box.querySelector('[data-spin]').onclick = () => {
      if (busy) return; busy = true;
      box.querySelector('#wres').textContent = ''; box.querySelector('#wrole').innerHTML = '';
      const win = rig && names.includes(rig) ? names.indexOf(rig) : Math.floor(Math.random() * n);
      // сектор win должен остановиться под стрелкой (сверху): угол центра сектора = (win+0.5)*seg
      const jitter = (Math.random() - 0.5) * seg * 0.7;
      const target = 360 - ((win + 0.5) * seg + jitter);
      rot += 360 * (5 + Math.floor(Math.random() * 3)) + ((target - rot % 360) + 360) % 360;
      g.style.transform = `rotate(${rot}deg)`;
      setTimeout(() => {
        busy = false;
        box.querySelector('#wres').innerHTML = `${I.trophy.replace('<svg', '<svg width="26" height="26" style="vertical-align:-4px"')} ${esc(names[win])}`;
        try { navigator.vibrate && navigator.vibrate(120); } catch {}
        onResult && onResult(names[win]);
        if (onRole) onRole(names[win], box.querySelector('#wrole'), close);
      }, 5300);
    };
  });
}

/** Экран «Читы»: S — состояние приложения, save() — сохранить, ctx = { modal, toast, topbar, bindCommon, defaultNames } */
export function renderCheats(el, S, save, ctx) {
  S.cheats = S.cheats || {};
  S.wheel = S.wheel || { names: ctx.defaultNames(), rig: '' };
  const w = S.wheel;
  const draw = () => {
    const on = CHEATS.filter(([k]) => S.cheats[k]).length;
    el.innerHTML = `${ctx.topbar()}
      <div class="kicker" style="color:var(--hunter)">${I.lock.replace('<svg', '<svg width="16" height="16" style="vertical-align:-3px"')} ${ru() ? 'Секретная вкладка' : 'Secret tab'}</div>
      <h1 style="font-size:32px;margin-bottom:6px">${ru() ? 'Читы' : 'Cheats'}</h1>
      <p style="color:var(--muted);margin-top:0">${ru() ? 'Работают в играх с ботами. Включено' : 'Work in bot games. Enabled'}: ${on}/${CHEATS.length}</p>
      <div class="card" style="padding:4px 16px">${CHEATS.map(([k, r, e, dr, de, ic]) => `<label class="line-row" style="cursor:pointer"><span class="row" style="flex:1;flex-wrap:nowrap;gap:12px"><span style="color:var(--accent)">${I[ic].replace('<svg', '<svg width="24" height="24"')}</span><span><b>${ru() ? r : e}</b><br><span style="color:var(--muted);font-size:14px">${ru() ? dr : de}</span></span></span><input type="checkbox" data-ch="${k}" ${S.cheats[k] ? 'checked' : ''} style="width:26px;height:26px;accent-color:var(--accent);flex:none"></label>`).join('')}</div>
      <div class="row" style="margin-top:10px"><button class="btn" id="chAll" style="flex:1">${ru() ? 'Включить всё' : 'Enable all'}</button><button class="btn" id="chNone" style="flex:1">${ru() ? 'Выключить всё' : 'Disable all'}</button></div>

      <h3 class="h-sect">${ru() ? 'Колесо рандома: кто водит' : 'Random wheel: who is it'}</h3>
      <div class="card">
        <p style="color:var(--muted);margin-top:0">${ru() ? 'Это же колесо открывается в лобби («Кто водит?»). Подкрутка действует там незаметно.' : 'The same wheel opens in the lobby (“Who is it?”). The rig applies there silently.'}</p>
        <div class="player-list" id="wnames">${w.names.map((nm, i) => `<div class="player"><div class="av" style="background:${WCOL[i % WCOL.length]}">${esc((nm || '?')[0])}</div><input class="input" data-wn="${i}" value="${esc(nm)}" maxlength="20" style="min-height:40px;font-size:16px;flex:1"><button class="btn" data-wdel="${i}" style="min-height:40px;padding:0 12px">${I.close.replace('<svg', '<svg width="18" height="18"')}</button></div>`).join('')}</div>
        <div class="row" style="margin-top:10px"><button class="btn" id="wAdd" style="flex:1">+ ${ru() ? 'Добавить' : 'Add'}</button><button class="btn" id="wReset" style="flex:1">${ru() ? 'Игроки лобби' : 'Lobby players'}</button></div>
        <div class="line-row" style="margin-top:8px"><span><b>${ru() ? 'Подкрутка' : 'Rig'}</b><br><span style="color:var(--muted);font-size:14px">${ru() ? 'Кто выпадет на колесе' : 'Who the wheel lands on'}</span></span>
          <select id="wRig" class="input" style="width:auto;max-width:55%;min-height:44px;font-size:16px;padding:0 10px"><option value="">${ru() ? 'Честно (случайно)' : 'Fair (random)'}</option>${w.names.filter(Boolean).map((nm) => `<option ${w.rig === nm ? 'selected' : ''}>${esc(nm)}</option>`).join('')}</select></div>
        <button class="btn primary big block" id="wSpin" style="margin-top:12px">${I.play}${ru() ? 'Крутить колесо' : 'Spin the wheel'}</button>
      </div>
      <button class="btn danger block" id="chLock" style="margin-top:22px">${I.lock}${ru() ? 'Скрыть вкладку' : 'Hide this tab'}</button>`;
    ctx.bindCommon(el);
    el.querySelectorAll('[data-ch]').forEach((cb) => cb.onchange = () => { S.cheats[cb.dataset.ch] = cb.checked; save(); draw(); });
    el.querySelector('#chAll').onclick = () => { CHEATS.forEach(([k]) => S.cheats[k] = true); save(); draw(); };
    el.querySelector('#chNone').onclick = () => { S.cheats = {}; save(); draw(); };
    el.querySelectorAll('[data-wn]').forEach((inp) => inp.onchange = () => { const old = w.names[+inp.dataset.wn]; w.names[+inp.dataset.wn] = inp.value.trim(); if (w.rig === old) w.rig = inp.value.trim(); save(); draw(); });
    el.querySelectorAll('[data-wdel]').forEach((b) => b.onclick = () => { const [rm] = w.names.splice(+b.dataset.wdel, 1); if (w.rig === rm) w.rig = ''; save(); draw(); });
    el.querySelector('#wAdd').onclick = () => { w.names.push((ru() ? 'Игрок ' : 'Player ') + (w.names.length + 1)); save(); draw(); };
    el.querySelector('#wReset').onclick = () => { w.names = ctx.defaultNames(); w.rig = ''; save(); draw(); };
    el.querySelector('#wRig').onchange = (e) => { w.rig = e.target.value; save(); };
    el.querySelector('#wSpin').onclick = () => openWheel(ctx.modal, { names: w.names, rig: w.rig });
    el.querySelector('#chLock').onclick = () => { S.cheatsUnlocked = false; save(); ctx.go('home'); };
  };
  draw();
}

/** Читы прямо в игре: те же переключатели (действуют сразу) и быстрые действия. */
export function openGameCheats(modal, S, save, game) {
  S.cheats = S.cheats || {};
  modal('', (box, close) => {
    const draw = () => {
      box.innerHTML = `<div class="mhead"><span class="k" style="color:var(--hunter)">${I.lock.replace('<svg', '<svg width="18" height="18" style="vertical-align:-3px"')} ${ru() ? 'Читы' : 'Cheats'}</span><button class="icon-btn" data-x>${I.close}</button></div>
        <div class="cheat-grid" style="margin:6px 0 6px">
          <button class="btn" data-act="center" style="flex:1;padding:0 8px;font-size:14px;gap:6px">${I.locate}${ru() ? 'В центр' : 'To centre'}</button>
          <button class="btn" data-act="cd" style="flex:1;padding:0 8px;font-size:14px;gap:6px">${I.clock}${ru() ? 'Перезарядить' : 'Recharge'}</button>
          <button class="btn" data-act="pw" style="flex:1;padding:0 8px;font-size:14px;gap:6px">${I.sparkle}${ru() ? 'Бонусы' : 'Power-ups'}</button>
        </div>
        <div class="cheat-grid" style="margin:0 0 6px">
          <button class="btn" data-act="freezebots" style="flex:1;padding:0 6px;font-size:13px">❄ ${ru() ? 'Боты-охотники замрут' : 'Freeze bot hunters'}</button>
          <button class="btn" data-act="tpnear" style="flex:1;padding:0 6px;font-size:13px">🎯 ${ru() ? 'К ближайшему' : 'To nearest'}</button>
        </div>
        ${game.isClient ? '' : `<div class="cheat-grid" style="margin:0 0 6px">
          <button class="btn" data-act="plus60" style="flex:1;padding:0 6px;font-size:13px">⏱ +60 ${ru() ? 'с к игре' : 's to game'}</button>
          <button class="btn" data-act="winnow" style="flex:1;padding:0 6px;font-size:13px">🏆 ${ru() ? 'Победить сейчас' : 'Win now'}</button>
        </div>`}
        <h3 style="margin:4px 0 8px">${ru() ? 'Роль' : 'Role'} <span style="color:var(--muted);font-size:14px;font-weight:500">· ${ru() ? 'сейчас' : 'now'}: ${esc(roleName(game.me.role))}</span></h3>
        <div class="cheat-grid">${['hunter', 'hider', 'spectator', 'dead'].map((r) => `<button class="btn ${game.me.role === r ? 'primary' : ''}" data-role="${r}">${{ hunter: '🔴', hider: '🟢', spectator: '👁', dead: '☠' }[r]} ${esc(roleName(r))}</button>`).join('')}</div>
        <h3 style="margin:14px 0 8px">${ru() ? 'Спавн предметов' : 'Spawn items'} <span style="color:var(--muted);font-size:14px;font-weight:500">· ${ru() ? 'рядом с вами' : 'next to you'}</span></h3>
        <div class="cheat-grid">${[['supply', '◆', ru() ? 'Тайник' : 'Cache'], ...OBJ_KINDS.map((k) => [k, OBJ[k].ic, objName(k)])].map(([k, ic, n]) => `<button class="btn" data-spawn="${k}">${ic} ${esc(n)}</button>`).join('')}</div>
        <h3 style="margin:14px 0 8px">${ru() ? 'Способности себе' : 'Give yourself abilities'}</h3>
        <div class="cheat-grid">${POWERUPS.map((p) => `<button class="btn" data-give="${p.id}">${I[p.icon] ? I[p.icon].replace('<svg', '<svg width="18" height="18"') : ''} ${esc(pwName(p))}</button>`).join('')}<button class="btn" data-give="@drone">🛸 ${ru() ? 'Дрон' : 'Drone'}</button><button class="btn" data-give="@shield3">🛡 ${ru() ? 'Щит ×3' : 'Shield ×3'}</button></div>
        <h3 style="margin:14px 0 8px">${ru() ? 'Розыгрыши' : 'Pranks'}</h3>
        ${prankBlock(game.players.filter((p) => p.remote).map((p) => ({ id: p.id, name: p.name })))}
        <h3 style="margin:14px 0 8px">${ru() ? 'Читы' : 'Cheats'}</h3>
        <div class="card" style="padding:2px 14px">${CHEATS.map(([k, r, e, dr, de, ic]) => `<label class="line-row" style="cursor:pointer"><span class="row" style="flex:1;flex-wrap:nowrap;gap:10px"><span style="color:var(--accent)">${I[ic].replace('<svg', '<svg width="22" height="22"')}</span><span><b>${ru() ? r : e}</b><br><span style="color:var(--muted);font-size:13px">${ru() ? dr : de}</span></span></span><input type="checkbox" data-ch="${k}" ${game.ch[k] ? 'checked' : ''} style="width:26px;height:26px;accent-color:var(--accent);flex:none"></label>`).join('')}</div>
        ${game.cfg.mode !== 'gps' ? `<p style="color:var(--muted);font-size:14px">${ru() ? 'Подмена гео нужна в режиме GPS: в демо вы и так ходите касаниями.' : 'Fake location matters in GPS mode; in demo you already walk by tapping.'}</p>` : ''}`;
      box.querySelector('[data-x]').onclick = close;
      box.querySelectorAll('[data-ch]').forEach((cb) => cb.onchange = () => { game.ch[cb.dataset.ch] = cb.checked; S.cheats[cb.dataset.ch] = cb.checked; save(); game.cheatsChanged(); });
      box.querySelectorAll('[data-prank]').forEach((b) => b.onclick = () => { const to = box.querySelector('#prTo').value; game.netSend('prank', { k: b.dataset.prank }, to); b.textContent = '✓ ' + prankName(b.dataset.prank); });
      box.querySelectorAll('[data-role]').forEach((b) => b.onclick = () => { game.cheatRole(b.dataset.role); draw(); });
      box.querySelectorAll('[data-spawn]').forEach((b) => b.onclick = () => { game.spawnAt(b.dataset.spawn, game.me); b.classList.add('primary'); setTimeout(() => b.classList.remove('primary'), 400); game.render(); });
      box.querySelectorAll('[data-give]').forEach((b) => b.onclick = () => {
        const id = b.dataset.give;
        if (id === '@drone') { game.cfg.drone = true; game.droneReadyAt = game.t; }
        else if (id === '@shield3') game.me.shield = (game.me.shield || 0) + 3;
        else { game.me.powerups.push(id); game.hasPowerups = true; }
        b.textContent = '✓ ' + b.textContent.trim(); game.renderHud(true);
      });
      box.querySelectorAll('[data-act]').forEach((b) => b.onclick = () => {
        const a = b.dataset.act;
        if (a === 'center') { game.me.x = 0; game.me.y = 0; game.me.target = null; game.render(); }
        if (a === 'cd') { game.revealReadyAt = game.t; game.freezeReadyAt = game.t; }
        if (a === 'pw') { for (const id of game.enabledPw) game.me.powerups.push(id); }
        if (a === 'freezebots') game.players.filter((p) => p.bot && p.role === 'hunter').forEach((p) => { p.frozenUntil = game.t + 30; p.target = null; });
        if (a === 'tpnear') { const others = game.players.filter((p) => p !== game.me && p.role !== game.me.role && p.role !== 'spectator'); const n = others.sort((x, y) => Math.hypot(x.x - game.me.x, x.y - game.me.y) - Math.hypot(y.x - game.me.x, y.y - game.me.y))[0]; if (n) { game.me.x = n.x + 15; game.me.y = n.y; game.me.target = null; } }
        if (a === 'plus60') { game.cfg.huntSec += 60; game.netSend('ext', { huntSec: game.cfg.huntSec }); }
        if (a === 'winnow') { close(); game.finish(game.me.role === 'hunter' ? 'hunters' : 'hiders'); return; }
        game.renderHud(true); close();
      });
    };
    draw();
  });
}

// ---------- розыгрыши (онлайн, секретно) ----------
export const PRANKS = [['alarm', '🚨'], ['flip', '🙃'], ['shake', '📳'], ['fakecatch', '🎯'], ['blind', '🌫']];
/** Блок «Розыгрыши» в панели читов: players — [{ id, name }], send(k, to) */
export function prankBlock(players) {
  if (!players.length) return `<p style="color:var(--muted);font-size:14px">${ru() ? 'Розыгрыши работают в онлайн-игре с друзьями.' : 'Pranks work in online games with friends.'}</p>`;
  return `<div class="card" style="padding:10px 14px">
    <select class="input" id="prTo" style="min-height:44px;font-size:16px;margin-bottom:8px">${players.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
    <div class="prankrow">${PRANKS.map(([k, ic]) => `<button class="btn" data-prank="${k}">${ic} ${prankName(k)}</button>`).join('')}</div></div>`;
}
export const prankName = (k) => ({ alarm: ru() ? 'Ложная тревога' : 'Fake alarm', flip: ru() ? 'Перевернуть экран' : 'Flip screen', shake: ru() ? 'Тряска' : 'Shake', fakecatch: ru() ? 'Фейк-поимка' : 'Fake catch', blind: ru() ? 'Туман' : 'Fog' })[k];
/** Применить розыгрыш у себя. */
export function applyPrank(k, game, toast) {
  const root = document.documentElement;
  const tmp = (cls, ms) => { root.classList.add(cls); setTimeout(() => root.classList.remove(cls), ms); };
  if (k === 'flip') tmp('prank-flip', 10000);
  if (k === 'shake') tmp('prank-shake', 3000);
  if (k === 'blind') tmp('prank-blind', 8000);
  if (k === 'alarm') { if (game) { game.alert('red', ru() ? 'Вас засекли. У охотников круг вокруг места, где вы стояли.' : 'You were revealed. The Hunters have a circle around where you stood.', 'signal'); game.vibrate([200, 80, 200]); } else toast('🚨'); }
  if (k === 'fakecatch') { if (game) { game.alert('red', ru() ? 'Вас поймали! Теперь вы охотник.' : 'You were caught! You are a Hunter now.', 'target'); game.vibrate([400]); setTimeout(() => game.alert('green', ru() ? 'Шутка! Это был розыгрыш 😜' : 'Just kidding! It was a prank 😜', 'sparkle'), 4000); } else toast('🎯'); }
}
