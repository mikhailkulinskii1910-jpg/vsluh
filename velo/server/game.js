'use strict';
/* Правила лобби, гонки и погони. Чистая логика без сети: сервер (server.js) передаёт сюда
   события и получает обратно изменения состояния, поэтому правила легко тестируются. */

const { randomInt } = require('crypto');
const G = require('../js/geo.js');

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // без похожих символов (0/O, 1/I)
const COLORS = ['#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#00acc1', '#d81b60', '#6d4c41', '#3949ab', '#7cb342'];
const START_DELAY_MS = 10000; // обратный отсчёт перед стартом
const FINISH_RADIUS_M = 30;   // радиус финиша
const ON_ROUTE_M = 60;        // дальше от маршрута — прогресс не засчитывается (сбой GPS)
const STALE_MS = 4000;        // позиция старше — считаем, что игрок не отвечает
const OFFLINE_REMOVE_MS = 120000;
const MAX_MEMBERS = 30;
const MAX_ROUTE_POINTS = 5000;
const TRAIL_EVERY_MS = 2000;  // как часто запоминаем точку для повтора финиша
const TRAIL_MAX = 1800;       // около часа гонки
const DEFAULT_SKIN = 'car';
const HOST_OFFLINE_MS = 30000; // хост без связи дольше — права переходят онлайн-игроку
const DEFAULT_GRACE_SEC = 120; // сколько ждём остальных после первого финиша

function newCode(existing) {
  let code;
  do {
    code = Array.from({ length: 6 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');
  } while (existing.has(code));
  return code;
}

function createRoom(code, now) {
  return {
    code,
    createdAt: now,
    hostId: null,
    members: new Map(),
    route: null, // { name, coords: [[lat, lon]], total }
    config: { mode: 'race', timeLimitSec: 3600, graceSec: DEFAULT_GRACE_SEC, chaserIds: [], catchM: 2, catchS: 2, maxAccM: 15 },
    game: freshGame(),
    nextColor: 0,
  };
}

function freshGame() {
  return { status: 'idle', startAt: 0, endsAt: 0, graceEndsAt: 0, winnerRole: null, winnerId: null, reason: '', caught: null, contacts: new Map() };
}

function createMember(room, id, token, name, now) {
  const m = {
    id, token,
    name: String(name || 'Игрок').slice(0, 20),
    color: COLORS[room.nextColor++ % COLORS.length],
    online: true, seenAt: now, t: 0,
    lat: null, lon: null, acc: null, spd: null, hdg: null, bat: null, charging: null,
    role: null, progress: 0, finishedAt: null, place: null,
    skin: DEFAULT_SKIN, trail: [], lastTrailAt: 0,
  };
  room.members.set(id, m);
  if (!room.hostId) room.hostId = id;
  return m;
}

function num(v, lo, hi) {
  return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null;
}

/** Проверяет присланную позицию; возвращает чистый объект или null. */
function sanitizeFix(f) {
  if (!f || typeof f !== 'object') return null;
  const lat = num(f.lat, -90, 90), lon = num(f.lon, -180, 180);
  if (lat === null || lon === null) return null;
  return {
    lat, lon,
    acc: num(f.acc, 0, 100000),
    spd: num(f.spd, 0, 150), // м/с
    hdg: num(f.hdg, 0, 360),
    bat: num(f.bat, 0, 1),
    charging: typeof f.charging === 'boolean' ? f.charging : null,
    t: num(f.t, 0, 1e15) || 0,
    skin: typeof f.skin === 'string' && /^[a-z0-9]{1,40}$/.test(f.skin) ? f.skin : undefined,
  };
}

/** Обновляет позицию игрока и проверяет гонку/погоню. Возвращает список событий. */
function updateState(room, id, rawFix, now) {
  const m = room.members.get(id);
  const fix = sanitizeFix(rawFix);
  if (!m || !fix) return null;
  for (const k of Object.keys(fix)) if (fix[k] !== undefined) m[k] = fix[k];
  m.seenAt = now;
  m.online = true;
  recordTrail(room, m, now);
  const events = [];
  if (room.config.mode === 'race') updateRace(room, m, now, events);
  else updateChase(room, m, now, events);
  return events;
}

/** Запоминает путь игрока во время заезда — для анимации финиша. */
function recordTrail(room, m, now) {
  const g = room.game;
  if (g.status !== 'running' || m.lat == null || now - m.lastTrailAt < TRAIL_EVERY_MS || m.trail.length >= TRAIL_MAX) return;
  m.lastTrailAt = now;
  m.trail.push([now - g.startAt, +m.lat.toFixed(6), +m.lon.toFixed(6)]);
}

/** Повтор заезда: траектории всех участников и порядок финиша. */
function buildReplay(room, now) {
  const g = room.game;
  return {
    id: now,
    startAt: g.startAt,
    total: room.route ? Math.round(room.route.total) : 0,
    members: [...room.members.values()].filter(m => m.trail.length).map(m => ({
      id: m.id, name: m.name, color: m.color, skin: m.skin, place: m.place,
      finishedMs: m.finishedAt != null ? m.finishedAt - g.startAt : null,
      trail: m.trail,
    })),
  };
}

function updateRace(room, m, now, events) {
  const g = room.game;
  if (g.status !== 'running' || !room.route || m.finishedAt != null) return;
  const p = G.projectOnPolyline(room.route.coords, m.lat, m.lon);
  if (p.dist <= ON_ROUTE_M) m.progress = Math.max(m.progress, p.along);
  const last = room.route.coords[room.route.coords.length - 1];
  const nearFinish = G.distance(m.lat, m.lon, last[0], last[1]) <= FINISH_RADIUS_M;
  const finished = (p.dist <= ON_ROUTE_M && room.route.total - m.progress <= FINISH_RADIUS_M)
    || (nearFinish && m.progress >= room.route.total * 0.8);
  if (!finished) return;
  m.finishedAt = now;
  m.place = [...room.members.values()].filter(o => o.finishedAt != null).length;
  if (!g.graceEndsAt) g.graceEndsAt = now + room.config.graceSec * 1000; // первый финишировал — ждём остальных
  events.push({ type: 'finished', id: m.id, place: m.place });
  const racers = [...room.members.values()];
  if (racers.every(o => o.finishedAt != null)) endGame(room, 'all', null, null, now);
}

function updateChase(room, m, now, events) {
  const g = room.game;
  if (g.status !== 'running' || !m.role) return;
  const maxAcc = room.config.maxAccM;
  for (const o of room.members.values()) {
    if (o.id === m.id || !o.role || o.role === m.role || o.lat == null || now - o.seenAt > STALE_MS) continue;
    const chaser = m.role === 'chaser' ? m : o;
    const runner = m.role === 'chaser' ? o : m;
    const key = `${chaser.id}>${runner.id}`;
    const reliable = (chaser.acc == null || chaser.acc <= maxAcc) && (runner.acc == null || runner.acc <= maxAcc);
    const d = G.distance(chaser.lat, chaser.lon, runner.lat, runner.lon);
    if (d < room.config.catchM && reliable) {
      if (!g.contacts.has(key)) g.contacts.set(key, now);
      if (now - g.contacts.get(key) >= room.config.catchS * 1000) {
        g.caught = { chaserId: chaser.id, runnerId: runner.id };
        events.push({ type: 'caught', chaserId: chaser.id, runnerId: runner.id });
        endGame(room, 'caught', 'chaser', chaser.id, now);
        return;
      }
    } else {
      g.contacts.delete(key);
    }
  }
}

function setRoute(room, route) {
  if (room.game.status === 'running' || room.game.status === 'countdown') return 'Гонка уже идёт';
  if (!route || !Array.isArray(route.coords)) return 'Некорректный маршрут';
  const coords = [];
  for (const p of route.coords.slice(0, MAX_ROUTE_POINTS + 1)) {
    const lat = num(p && p[0], -90, 90), lon = num(p && p[1], -180, 180);
    if (lat !== null && lon !== null) coords.push([lat, lon]);
  }
  if (coords.length < 2) return 'В маршруте меньше двух точек';
  room.route = { name: String(route.name || 'Маршрут').slice(0, 60), coords, total: G.lineLength(coords) };
  return null;
}

function setConfig(room, cfg) {
  if (room.game.status === 'running' || room.game.status === 'countdown') return 'Нельзя менять настройки во время игры';
  if (!cfg || typeof cfg !== 'object') return 'Некорректные настройки';
  if (cfg.mode !== undefined) {
    if (cfg.mode !== 'race' && cfg.mode !== 'chase') return 'Неизвестный режим';
    room.config.mode = cfg.mode;
  }
  const set = (key, v, lo, hi) => { const x = num(v, lo, hi); if (x !== null) room.config[key] = x; };
  set('timeLimitSec', cfg.timeLimitSec, 60, 14400);
  set('graceSec', cfg.graceSec, 0, 600);
  set('catchM', cfg.catchM, 0.5, 20);
  set('catchS', cfg.catchS, 0.5, 30);
  set('maxAccM', cfg.maxAccM, 3, 100);
  if (Array.isArray(cfg.chaserIds)) room.config.chaserIds = cfg.chaserIds.filter(x => typeof x === 'string').slice(0, MAX_MEMBERS);
  return null;
}

/** Запускает обратный отсчёт. Возвращает текст ошибки или null. */
function startGame(room, now) {
  const s = room.game.status;
  if (s === 'running' || s === 'countdown') return 'Игра уже идёт';
  if (room.members.size < 1) return 'В лобби никого нет';
  const members = [...room.members.values()];
  if (room.config.mode === 'race') {
    if (!room.route) return 'Сначала выберите маршрут';
  } else {
    if (members.length < 2) return 'Для погони нужно минимум 2 игрока';
    const chasers = new Set(room.config.chaserIds.filter(id => room.members.has(id)));
    if (!chasers.size || chasers.size >= members.length) return 'Выберите догоняющих (не всех игроков)';
    members.forEach(m => { m.role = chasers.has(m.id) ? 'chaser' : 'runner'; });
  }
  members.forEach(m => { m.progress = 0; m.finishedAt = null; m.place = null; m.trail = []; m.lastTrailAt = 0; if (room.config.mode === 'race') m.role = null; });
  room.replay = null;
  room.game = freshGame();
  room.game.status = 'countdown';
  room.game.startAt = now + START_DELAY_MS;
  return null;
}

function endGame(room, reason, winnerRole, winnerId, now) {
  room.game.status = 'finished';
  room.game.reason = reason;
  room.game.winnerRole = winnerRole;
  room.game.winnerId = winnerId;
  room.game.contacts.clear();
  if (room.config.mode === 'race' && room.game.startAt) room.replay = buildReplay(room, now);
}

function stopGame(room, now = Date.now()) {
  if (room.game.status === 'idle' || room.game.status === 'finished') return null;
  endGame(room, 'stopped', null, null, now);
  return null;
}

/** Периодическая проверка: отсчёт, лимит времени, отключённые игроки. Возвращает события. */
function tick(room, now) {
  const events = [];
  for (const m of [...room.members.values()]) {
    if (!m.online && now - m.seenAt > OFFLINE_REMOVE_MS) {
      room.members.delete(m.id);
      events.push({ type: 'left', id: m.id });
    }
  }
  const host = room.hostId && room.members.get(room.hostId);
  const hostGone = room.hostId && !host;
  const hostAway = host && !host.online && now - host.seenAt > HOST_OFFLINE_MS;
  if (hostGone || hostAway) {
    const next = pickHost(room);
    if (next && next !== room.hostId) { room.hostId = next; events.push({ type: 'host', id: next }); }
    else if (hostGone) room.hostId = next;
  }
  const g = room.game;
  if (g.status === 'countdown' && now >= g.startAt) {
    g.status = 'running';
    g.startAt = now;
    g.endsAt = now + room.config.timeLimitSec * 1000;
    events.push({ type: 'started' });
  }
  if (g.status === 'running') {
    if (room.config.mode === 'chase') {
      for (const key of [...g.contacts.keys()]) {
        const [cId, rId] = key.split('>');
        const c = room.members.get(cId), r = room.members.get(rId);
        const fresh = x => x && x.lat != null && now - x.seenAt <= STALE_MS;
        if (!fresh(c) || !fresh(r)) g.contacts.delete(key);
      }
    }
    if (now >= g.endsAt) {
      if (room.config.mode === 'chase') endGame(room, 'time', 'runner', null, now);
      else endGame(room, 'time', null, null, now);
      events.push({ type: 'ended', reason: 'time' });
    } else if (room.config.mode === 'race' && g.graceEndsAt && now >= g.graceEndsAt) {
      endGame(room, 'grace', null, null, now);
      events.push({ type: 'ended', reason: 'grace' });
    }
  }
  return events;
}

/** Новый хост: первый игрок на связи, иначе любой оставшийся. */
function pickHost(room) {
  const list = [...room.members.values()];
  const online = list.find(m => m.online);
  return (online || list[0] || {}).id || null;
}

function publicMember(room, m, now) {
  return {
    id: m.id, name: m.name, color: m.color, skin: m.skin, online: m.online, host: m.id === room.hostId,
    lat: m.lat, lon: m.lon, acc: m.acc, spd: m.spd, hdg: m.hdg, bat: m.bat, charging: m.charging,
    t: m.t, role: m.role, progress: Math.round(m.progress), place: m.place,
    finishedMs: m.finishedAt != null && room.game.startAt ? m.finishedAt - room.game.startAt : null,
    seenAgoMs: now - m.seenAt,
  };
}

/** Состояние комнаты, которое получают все участники. */
function snapshot(room, now) {
  const g = room.game;
  const members = [...room.members.values()];
  const results = members.filter(m => m.finishedAt != null)
    .sort((a, b) => a.finishedAt - b.finishedAt)
    .map(m => ({ id: m.id, name: m.name, place: m.place, finishedMs: m.finishedAt - g.startAt }));
  return {
    code: room.code,
    hostId: room.hostId,
    config: { ...room.config },
    route: room.route ? { name: room.route.name, total: Math.round(room.route.total) } : null,
    members: members.map(m => publicMember(room, m, now)),
    game: {
      status: g.status,
      countdownLeftMs: g.status === 'countdown' ? Math.max(0, g.startAt - now) : 0,
      timeLeftMs: g.status === 'running' ? Math.max(0, g.endsAt - now) : 0,
      graceLeftMs: g.status === 'running' && g.graceEndsAt ? Math.max(0, g.graceEndsAt - now) : 0,
      winnerRole: g.winnerRole, winnerId: g.winnerId, reason: g.reason,
      caught: g.caught,
      results,
      contacts: [...g.contacts.entries()].map(([k, since]) => {
        const [chaserId, runnerId] = k.split('>');
        return { chaserId, runnerId, ms: now - since };
      }),
    },
  };
}

module.exports = {
  COLORS, START_DELAY_MS, FINISH_RADIUS_M, ON_ROUTE_M, STALE_MS, MAX_MEMBERS,
  newCode, createRoom, createMember, sanitizeFix, updateState, setRoute, setConfig,
  startGame, stopGame, tick, snapshot, publicMember, pickHost, HOST_OFFLINE_MS,
};
