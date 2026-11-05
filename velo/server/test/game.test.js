'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../../js/geo.js');
const game = require('../../js/game.js');

// 1 градус широты ≈ 111.2 км; смещение 0.0001° ≈ 11.1 м
const DEG_PER_M = 1 / 111195;
const at = (lat, m) => lat + m * DEG_PER_M; // сдвиг по широте на m метров

function roomWith(members, mode) {
  const room = game.createRoom('TEST01', 0);
  room.config.mode = mode;
  const ids = members.map(name => game.createMember(room, name, 'tok-' + name, name, 0).id);
  return { room, ids };
}

function fix(lat, lon, extra = {}) {
  return { lat, lon, acc: 3, t: 0, ...extra };
}

test('geo: расстояние Москва — Санкт-Петербург ≈ 634 км', () => {
  const d = G.distance(55.7558, 37.6173, 59.9343, 30.3351);
  assert.ok(Math.abs(d - 633000) < 3000, `получилось ${d}`);
});

test('geo: проекция точки на ломаную и пройденная длина', () => {
  const route = [[55, 37], [55 + 1000 * DEG_PER_M, 37]]; // 1 км на север
  const p = G.projectOnPolyline(route, 55 + 400 * DEG_PER_M, 37 + 20 * DEG_PER_M * 1 / Math.cos(55 * Math.PI / 180));
  assert.ok(Math.abs(p.along - 400) < 2, `along=${p.along}`);
  assert.ok(Math.abs(p.dist - 20) < 2, `dist=${p.dist}`);
  assert.ok(Math.abs(p.total - 1000) < 2);
});

test('geo: количество тайлов на зуме', () => {
  const tiles = G.tilesForBounds({ south: 55.5, north: 55.8, west: 37.4, east: 37.9 }, 10, 10);
  assert.ok(tiles.length >= 1 && tiles.every(t => t.z === 10));
});

test('sanitizeFix отбрасывает некорректные координаты', () => {
  assert.equal(game.sanitizeFix({ lat: 200, lon: 0 }), null);
  assert.equal(game.sanitizeFix({ lat: '55', lon: 37 }), null);
  assert.equal(game.sanitizeFix(null), null);
  assert.equal(game.sanitizeFix({ lat: 55, lon: 37 }).lat, 55);
});

test('гонка: старт нельзя без маршрута', () => {
  const { room } = roomWith(['a'], 'race');
  assert.match(game.startGame(room, 0), /маршрут/);
});

test('гонка: прогресс по маршруту и финиш первого игрока', () => {
  const { room, ids } = roomWith(['a', 'b'], 'race');
  const route = { name: 'Тест', coords: [[55, 37], [at(55, 1000), 37]] }; // 1 км
  assert.equal(game.setRoute(room, route), null);
  assert.equal(game.startGame(room, 0), null);
  assert.equal(room.game.status, 'countdown');
  game.tick(room, game.START_DELAY_MS);
  assert.equal(room.game.status, 'running');

  const [a, b] = ids;
  game.updateState(room, a, fix(at(55, 500), 37), 20000);
  assert.ok(room.members.get(a).progress > 480);
  assert.equal(room.members.get(b).progress, 0);

  // a доезжает до финиша первым
  const ev = game.updateState(room, a, fix(at(55, 990), 37), 30000);
  assert.ok(ev.some(e => e.type === 'finished' && e.place === 1));
  // b доезжает позже
  game.updateState(room, b, fix(at(55, 995), 37), 40000);
  const snap = game.snapshot(room, 40000);
  assert.equal(snap.game.results[0].id, a);
  assert.equal(snap.game.results.length, 2);
  assert.equal(snap.game.status, 'finished');
});

test('гонка: точки далеко от маршрута не дают прогресса', () => {
  const { room, ids } = roomWith(['a'], 'race');
  game.setRoute(room, { name: 'x', coords: [[55, 37], [at(55, 1000), 37]] });
  game.startGame(room, 0); game.tick(room, game.START_DELAY_MS);
  game.updateState(room, ids[0], fix(55.0, 37.01), 20000); // ~650 м в сторону
  assert.equal(room.members.get(ids[0]).progress, 0);
});

test('погоня: догонял на 2 м в течение 2 с — побеждает', () => {
  const { room, ids } = roomWith(['chaser', 'runner'], 'chase');
  room.config.chaserIds = [ids[0]];
  assert.equal(game.startGame(room, 0), null);
  game.tick(room, game.START_DELAY_MS);
  const [c, r] = ids;
  let t = game.START_DELAY_MS + 1000;
  game.updateState(room, r, fix(at(55, 500), 37), t);       // беглец далеко
  game.updateState(room, c, fix(at(55, 0), 37), t);        // догоняющий ещё далеко — дистанция 500 м
  t += 500;
  game.updateState(room, c, fix(at(55, 499), 37), t);      // ~1 м
  assert.equal(room.game.status, 'running');
  let ev = game.updateState(room, r, fix(at(55, 500), 37), t + 1000);  // контакт с этого момента, 1.0 с
  assert.equal(room.game.status, 'running');
  ev = game.updateState(room, c, fix(at(55, 499.5), 37), t + 2100);    // 2.1 с → поймал
  assert.ok(ev.some(e => e.type === 'caught'));
  assert.equal(room.game.status, 'finished');
  assert.equal(room.game.winnerRole, 'chaser');
  assert.equal(room.game.winnerId, c);
});

test('погоня: отрыв больше 2 м сбрасывает таймер контакта', () => {
  const { room, ids } = roomWith(['chaser', 'runner'], 'chase');
  room.config.chaserIds = [ids[0]];
  game.startGame(room, 0); game.tick(room, game.START_DELAY_MS);
  const [c, r] = ids;
  let t = 11000;
  game.updateState(room, r, fix(55, 37), t);
  game.updateState(room, c, fix(55, 37), t);           // контакт начался
  t += 1500;
  game.updateState(room, c, fix(at(55, 10), 37), t);   // отрыв 10 м — сброс
  t += 1000;
  game.updateState(room, c, fix(55, 37), t);           // снова рядом, таймер заново
  t += 1500;
  game.updateState(room, c, fix(55, 37), t);           // всего 1.5 с с последнего контакта
  assert.equal(room.game.status, 'running');
});

test('погоня: время вышло — побеждают беглецы', () => {
  const { room, ids } = roomWith(['chaser', 'runner'], 'chase');
  room.config.chaserIds = [ids[0]];
  room.config.timeLimitSec = 60;
  game.startGame(room, 0); game.tick(room, game.START_DELAY_MS);
  game.tick(room, game.START_DELAY_MS + 60000 + 1);
  assert.equal(room.game.status, 'finished');
  assert.equal(room.game.winnerRole, 'runner');
});

test('погоня: нужны догоняющие и хотя бы один беглец', () => {
  const { room, ids } = roomWith(['a', 'b'], 'chase');
  assert.match(game.startGame(room, 0), /догоняющих/);
  room.config.chaserIds = ids;
  assert.match(game.startGame(room, 0), /догоняющих/);
});

test('сброс контакта, если позиция соперника устарела', () => {
  const { room, ids } = roomWith(['chaser', 'runner'], 'chase');
  room.config.chaserIds = [ids[0]];
  game.startGame(room, 0); game.tick(room, game.START_DELAY_MS);
  const [c, r] = ids;
  game.updateState(room, r, fix(55, 37), 11000);
  game.updateState(room, c, fix(55, 37), 11000);
  assert.equal(room.game.contacts.size, 1);
  game.tick(room, 20000); // позиции старше 4 с
  assert.equal(room.game.contacts.size, 0);
});

test('setConfig проверяет режим и диапазоны', () => {
  const { room } = roomWith(['a'], 'race');
  assert.match(game.setConfig(room, { mode: 'boat' }), /режим/);
  assert.equal(game.setConfig(room, { catchM: 2, catchS: 2 }), null);
  game.setConfig(room, { catchM: 9999 });
  assert.equal(room.config.catchM, 2); // вне диапазона — не меняется
});

test('гонка: после первого финиша ждём остальных, затем заканчиваем', () => {
  const { room, ids } = roomWith(['a', 'b'], 'race');
  game.setRoute(room, { name: 'x', coords: [[55, 37], [at(55, 500), 37]] });
  game.setConfig(room, { graceSec: 30 });
  game.startGame(room, 0); game.tick(room, game.START_DELAY_MS);
  game.updateState(room, ids[0], fix(at(55, 495), 37), 20000);   // a финишировал
  assert.equal(room.game.status, 'running');
  game.tick(room, 20000 + 29000);
  assert.equal(room.game.status, 'running');                       // ещё ждём b
  game.tick(room, 20000 + 30000);
  assert.equal(room.game.status, 'finished');
  assert.equal(room.game.reason, 'grace');
  assert.equal(game.snapshot(room, 50000).game.results[0].id, ids[0]);
});

test('гонка: после финиша сохраняется повтор с траекториями и курсорами', () => {
  const { room, ids } = roomWith(['a', 'b'], 'race');
  game.setRoute(room, { name: 'x', coords: [[55, 37], [at(55, 400), 37]] });
  game.setConfig(room, { graceSec: 0 });
  game.startGame(room, 0); game.tick(room, game.START_DELAY_MS);
  game.updateState(room, ids[0], { ...fix(55, 37), skin: 'dino' }, 10000);
  game.updateState(room, ids[0], fix(at(55, 200), 37), 12500);
  game.updateState(room, ids[0], fix(at(55, 398), 37), 14000);   // финиш
  game.tick(room, 14000);                                        // окно ожидания 0 с — заезд закрыт
  assert.equal(room.game.status, 'finished');
  assert.ok(room.replay, 'повтор должен быть сохранён');
  const a = room.replay.members.find(m => m.id === ids[0]);
  assert.equal(a.skin, 'dino');
  assert.equal(a.place, 1);
  assert.ok(a.trail.length >= 2 && a.trail[0][0] >= 0);
  assert.equal(a.finishedMs, 14000 - 10000);
});

test('неверный курсор отбрасывается, остаётся прежний', () => {
  const { room, ids } = roomWith(['a'], 'race');
  game.updateState(room, ids[0], { ...fix(55, 37), skin: 'drop table;' }, 1000);
  assert.equal(room.members.get(ids[0]).skin, 'car');
  game.updateState(room, ids[0], { ...fix(55, 37), skin: 'ufo' }, 2000);
  assert.equal(room.members.get(ids[0]).skin, 'ufo');
  game.updateState(room, ids[0], fix(55, 37), 3000);
  assert.equal(room.members.get(ids[0]).skin, 'ufo');
});

test('навигация: повороты по геометрии маршрута', () => {
  const pts = [[55, 37]];
  let lat = 55, lon = 37;
  const step = (dn, de) => { lat += dn / 111195; lon += de / (111195 * Math.cos(lat * Math.PI / 180)); pts.push([lat, lon]); };
  for (let i = 0; i < 20; i++) step(50, 0);   // север 1 км
  for (let i = 0; i < 10; i++) step(0, 50);   // поворот направо и 500 м на восток
  const turns = G.findTurns(pts);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].dir, 'right');
  assert.ok(Math.abs(turns[0].along - 1000) < 60, `along=${turns[0].along}`);
  const straight = [[55, 37]];
  for (let i = 1; i <= 40; i++) straight.push([55 + (i * 50) / 111195, 37]);
  assert.deepEqual(G.findTurns(straight), []);
});

test('хост без связи дольше 30 с — права переходят игроку на связи', () => {
  const { room, ids } = roomWith(['host', 'b'], 'race');
  const [h, b] = ids;
  room.members.get(h).online = false;
  room.members.get(h).seenAt = 0;
  room.members.get(b).seenAt = 40000;
  game.tick(room, 20000);
  assert.equal(room.hostId, h);              // 20 с — ещё ждём
  const ev = game.tick(room, 31000);
  assert.equal(room.hostId, b);
  assert.ok(ev.some(e => e.type === 'host' && e.id === b));
});
