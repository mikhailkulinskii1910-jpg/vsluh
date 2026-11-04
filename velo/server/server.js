'use strict';
/* Сервер «Велокарты»: раздаёт приложение (папка velo/) и WebSocket для лобби на /ws.
   Запуск: cd velo/server && npm install && npm start  →  http://localhost:8080 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const game = require('./game.js');

const PORT = Number(process.env.PORT) || 8080;
const ROOT = path.resolve(__dirname, '..');
const ROOM_IDLE_MS = 10 * 60 * 1000;
const BROADCAST_MS = 1000;
const MAX_MSG_PER_SEC = 20;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const rooms = new Map();   // code → room
const sockets = new Set(); // все WebSocket-соединения

/* ---------- статика ---------- */
const server = http.createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); return res.end(); }
  if (urlPath === '/') urlPath = '/index.html';
  if (urlPath.startsWith('/server/') || urlPath.startsWith('/node_modules/') || urlPath.includes('..')) {
    res.writeHead(404); return res.end('Not found');
  }
  const file = path.join(ROOT, urlPath);
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
});

/* ---------- WebSocket ---------- */
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 32 * 1024 });

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function roomOf(ws) {
  return ws.roomCode ? rooms.get(ws.roomCode) : null;
}

function memberOf(ws) {
  const room = roomOf(ws);
  return room && ws.memberId ? room.members.get(ws.memberId) : null;
}

function broadcastRoom(room, extra = {}) {
  const now = Date.now();
  const payload = JSON.stringify({ type: 'room', room: game.snapshot(room, now), ...extra });
  for (const ws of sockets) {
    if (ws.roomCode === room.code && ws.readyState === ws.OPEN) ws.send(payload);
  }
  // повтор заезда отправляем один раз, когда гонка закончилась
  if (room.replay && room.replaySent !== room.replay.id) {
    const rp = JSON.stringify({ type: 'replay', replay: room.replay });
    for (const ws of sockets) if (ws.roomCode === room.code && ws.readyState === ws.OPEN) ws.send(rp);
    room.replaySent = room.replay.id;
  }
  room.lastBroadcast = now;
  room.dirty = false;
  room.pendingEvents = [];
}

function attach(ws, room, member) {
  ws.roomCode = room.code;
  ws.memberId = member.id;
  member.online = true;
  room.lastActivity = Date.now();
  send(ws, { type: 'joined', code: room.code, you: member.id, token: member.token, room: game.snapshot(room, Date.now()) });
  if (room.route) send(ws, { type: 'route', route: room.route });
  if (room.replay) send(ws, { type: 'replay', replay: room.replay });
  room.dirty = true;
}

function newToken() {
  return require('crypto').randomBytes(16).toString('hex');
}

function fail(ws, message) {
  send(ws, { type: 'error', message });
}

wss.on('connection', (ws) => {
  sockets.add(ws);
  ws.isAlive = true;
  ws.msgCount = 0;
  ws.msgWindow = Date.now();
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('close', () => {
    sockets.delete(ws);
    const m = memberOf(ws), room = roomOf(ws);
    if (m) { m.online = false; room.dirty = true; room.lastActivity = Date.now(); }
  });

  ws.on('message', (raw) => {
    const now = Date.now();
    if (now - ws.msgWindow > 1000) { ws.msgWindow = now; ws.msgCount = 0; }
    if (++ws.msgCount > MAX_MSG_PER_SEC) return;
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return fail(ws, 'Некорректное сообщение'); }
    if (!msg || typeof msg !== 'object') return;
    const name = typeof msg.name === 'string' ? msg.name.trim().slice(0, 20) : '';

    switch (msg.type) {
      case 'create': {
        if (roomOf(ws)) return fail(ws, 'Вы уже в лобби');
        const code = game.newCode(rooms);
        const room = game.createRoom(code, now);
        room.lastActivity = now;
        rooms.set(code, room);
        const m = game.createMember(room, newId(), newToken(), name, now);
        attach(ws, room, m);
        return;
      }
      case 'join': {
        if (roomOf(ws)) return fail(ws, 'Вы уже в лобби');
        const code = typeof msg.code === 'string' ? msg.code.trim().toUpperCase() : '';
        const room = rooms.get(code);
        if (!room) return fail(ws, 'Лобби с таким кодом не найдено');
        if (room.members.size >= game.MAX_MEMBERS) return fail(ws, 'В лобби уже максимум игроков');
        const m = game.createMember(room, newId(), newToken(), name, now);
        attach(ws, room, m);
        return;
      }
      case 'rejoin': {
        if (roomOf(ws)) return;
        const room = rooms.get(String(msg.code || '').toUpperCase());
        const m = room && [...room.members.values()].find(x => x.token === msg.token);
        if (!m) return fail(ws, 'Не удалось вернуться в лобби');
        attach(ws, room, m);
        return;
      }
      case 'state': {
        const room = roomOf(ws), m = memberOf(ws);
        if (!room || !m) return;
        const events = game.updateState(room, m.id, msg.fix, now);
        if (!events) return;
        room.lastActivity = now;
        room.dirty = true;
        room.pendingEvents = [...(room.pendingEvents || []), ...events];
        if (events.length) broadcastRoom(room, { events: room.pendingEvents });
        return;
      }
      case 'leave': {
        const room = roomOf(ws), m = memberOf(ws);
        if (!room || !m) return;
        room.members.delete(m.id);
        ws.roomCode = null; ws.memberId = null;
        room.lastActivity = now;
        if (room.hostId === m.id) room.hostId = room.members.keys().next().value || null;
        if (room.members.size) broadcastRoom(room);
        return;
      }
      default:
        return hostOnly(ws, msg);
    }
  });
});

/** Команды, которые может давать только хост лобби. */
function hostOnly(ws, msg) {
  const room = roomOf(ws), m = memberOf(ws);
  if (!room || !m) return fail(ws, 'Сначала создайте или войдите в лобби');
  if (room.hostId !== m.id) return fail(ws, 'Только хост лобби может это сделать');
  const now = Date.now();
  let err = null;
  switch (msg.type) {
    case 'route': {
      err = game.setRoute(room, msg.route);
      if (!err) { room.dirty = true; for (const s of sockets) if (s.roomCode === room.code) send(s, { type: 'route', route: room.route }); }
      break;
    }
    case 'config': err = game.setConfig(room, msg.config); room.dirty = true; break;
    case 'start': err = game.startGame(room, now); room.dirty = true; break;
    case 'stop': err = game.stopGame(room, now); room.dirty = true; break;
    default: return;
  }
  if (err) return fail(ws, err);
  broadcastRoom(room);
}

function newId() {
  return require('crypto').randomBytes(6).toString('hex');
}

/* ---------- фоновый цикл: отсчёт, таймеры, рассылка, уборка ---------- */
setInterval(() => {
  const now = Date.now();
  for (const room of [...rooms.values()]) {
    const events = game.tick(room, now);
    if (events.length) { room.dirty = true; room.pendingEvents = [...(room.pendingEvents || []), ...events]; }
    const hasOnline = [...room.members.values()].some(m => m.online);
    if (!hasOnline && now - (room.lastActivity || 0) > ROOM_IDLE_MS) { rooms.delete(room.code); continue; }
    if (room.dirty || now - (room.lastBroadcast || 0) >= BROADCAST_MS) {
      broadcastRoom(room, room.pendingEvents && room.pendingEvents.length ? { events: room.pendingEvents } : {});
    }
  }
}, 250);

/* Пинг, чтобы мёртвые соединения не висели. */
setInterval(() => {
  for (const ws of sockets) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 25000);

server.listen(PORT, () => {
  console.log(`Велокарта: http://localhost:${PORT}  (WebSocket: /ws)`);
});

module.exports = { server };
