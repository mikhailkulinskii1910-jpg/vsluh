'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const game = require('../../js/game.js');
const { RoomHost } = require('../../js/roomhost.js');

/** Комната с «почтой»: что и кому отправлено. */
function setup(now = { t: 1000 }) {
  const inbox = new Map();
  const send = (key, obj) => { if (!inbox.has(key)) inbox.set(key, []); inbox.get(key).push(obj); };
  const host = RoomHost.create({ game, code: 'P2PTST', send, now: () => now.t });
  const last = (key, type) => (inbox.get(key) || []).filter(m => m.type === type).pop();
  return { host, inbox, last, now };
}

test('хост входит, сосед входит, оба получают состояние лобби', () => {
  const { host, last } = setup();
  host.handle('local', { type: 'join', name: 'Хост' });
  host.handle('peerA', { type: 'join', name: 'Оля' });
  assert.equal(last('local', 'joined').code, 'P2PTST');
  assert.ok(last('peerA', 'joined').you);
  host.tick();
  assert.equal(last('peerA', 'room').room.members.length, 2);
  assert.equal(host.room.hostId, last('local', 'joined').you); // создатель — хост игры
});

test('лимит 10 игроков в лобби без сервера', () => {
  const { host, last } = setup();
  for (let i = 0; i < 10; i++) host.handle('p' + i, { type: 'join', name: 'И' + i });
  host.handle('p10', { type: 'join', name: 'Лишний' });
  assert.match(last('p10', 'error').message, /10 игроков/);
  assert.equal(host.room.members.size, 10);
});

test('повторный вход по id игрока (смена сети) не создаёт дубля', () => {
  const { host, last } = setup();
  host.handle('local', { type: 'join', name: 'Хост' });
  host.handle('peerA', { type: 'join', name: 'Оля' });
  const id = last('peerA', 'joined').you;
  host.disconnect('peerA');
  assert.equal(host.room.members.get(id).online, false);
  host.handle('peerA2', { type: 'rejoin', memberId: id, name: 'Оля' });
  assert.equal(last('peerA2', 'joined').you, id);
  assert.equal(host.room.members.size, 2);
  assert.equal(host.room.members.get(id).online, true);
});

test('только хост игры управляет; не хосту — ошибка', () => {
  const { host, last } = setup();
  host.handle('local', { type: 'join', name: 'Хост' });
  host.handle('peerA', { type: 'join', name: 'Оля' });
  host.handle('peerA', { type: 'start' });
  assert.match(last('peerA', 'error').message, /Только хост/);
  host.handle('local', { type: 'route', route: { name: 'r', coords: [[55, 37], [55.01, 37]] } });
  assert.equal(last('peerA', 'route').route.name, 'r');
});

test('позиции соседа доходят до всех', () => {
  const { host, last, now } = setup();
  host.handle('local', { type: 'join', name: 'Хост' });
  host.handle('peerA', { type: 'join', name: 'Оля' });
  host.handle('peerA', { type: 'state', fix: { lat: 55.75, lon: 37.62, acc: 5, spd: 4, t: 1 } });
  now.t += 1100; host.tick();
  const me = last('local', 'room').room.members.find(m => m.name === 'Оля');
  assert.equal(me.lat, 55.75);
  assert.equal(me.spd, 4);
});

test('передача прав хоста: комната восстанавливается из снимка во время гонки', () => {
  const { host, last, now } = setup();
  host.handle('local', { type: 'join', name: 'Хост' });
  host.handle('peerA', { type: 'join', name: 'Оля' });
  const olya = last('peerA', 'joined').you;
  host.handle('local', { type: 'route', route: { name: 'r', coords: [[55, 37], [55.01, 37]] } });
  host.handle('local', { type: 'start' });
  now.t += game.START_DELAY_MS; host.tick();
  now.t += 5000; host.tick();
  const snap = last('peerA', 'room').room;
  assert.equal(snap.game.status, 'running');
  // хост пропал: права переходят Оле, её телефон поднимает комнату из последнего снимка
  const inbox2 = [];
  const h2 = RoomHost.fromSnapshot({ game, snapshot: snap, route: last('peerA', 'route').route, selfMemberId: olya,
    send: (k, o) => inbox2.push([k, o]), now: () => now.t });
  assert.equal(h2.room.hostId, olya);
  assert.equal(h2.room.members.size, 2);
  assert.equal(h2.room.game.status, 'running');
  assert.ok(h2.room.route && h2.room.route.coords.length === 2);
  h2.handle('local', { type: 'rejoin', memberId: olya });
  assert.ok(inbox2.some(([k, o]) => k === 'local' && o.type === 'joined' && o.you === olya));
});
