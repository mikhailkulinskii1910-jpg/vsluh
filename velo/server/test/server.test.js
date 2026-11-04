'use strict';
/* Интеграционные тесты: настоящий сервер на случайном порту и WebSocket-клиенты. */
process.env.PORT = '0';
process.env.NODE_ENV = 'test';
process.env.MAX_CONN_PER_IP = '6';
const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const srv = require('../server.js');

let base;
test.before(async () => {
  if (!srv.server.listening) await new Promise(r => srv.server.once('listening', r));
  base = `127.0.0.1:${srv.server.address().port}`;
});
test.after(() => srv.close());

/** Клиент с очередью сообщений: next(type) ждёт следующее сообщение нужного типа. */
function client() {
  const ws = new WebSocket(`ws://${base}/ws`);
  const queue = [], waiters = [];
  ws.on('message', raw => {
    const m = JSON.parse(String(raw));
    const i = waiters.findIndex(w => w.pred(m));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(m); else queue.push(m);
  });
  const next = (type, pred = () => true, ms = 4000) => new Promise((resolve, reject) => {
    const match = m => m.type === type && pred(m);
    const i = queue.findIndex(match);
    if (i >= 0) return resolve(queue.splice(i, 1)[0]);
    const w = { pred: match, resolve };
    waiters.push(w);
    setTimeout(() => { const k = waiters.indexOf(w); if (k >= 0) { waiters.splice(k, 1); reject(new Error('нет сообщения ' + type)); } }, ms);
  });
  const opened = new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  const send = obj => ws.send(JSON.stringify(obj));
  const closed = new Promise(res => ws.once('close', (code) => res(code)));
  return { ws, next, send, opened, closed };
}

test('/healthz отвечает, что сервер жив', async () => {
  const r = await fetch(`http://${base}/healthz`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
});

test('код сервера не раздаётся как статика', async () => {
  assert.equal((await fetch(`http://${base}/server/game.js`)).status, 404);
});

test('создание и вход по коду: оба видят двух игроков', async () => {
  const a = client(); await a.opened;
  a.send({ type: 'create', name: 'Миша' });
  const ja = await a.next('joined');
  assert.match(ja.code, /^[A-Z0-9]{6}$/);
  const b = client(); await b.opened;
  b.send({ type: 'join', code: ja.code.toLowerCase(), name: 'Оля' });
  const jb = await b.next('joined');
  assert.equal(jb.code, ja.code);
  const ra = await a.next('room', m => m.room.members.length === 2);
  assert.deepEqual(ra.room.members.map(m => m.name).sort(), ['Миша', 'Оля']);
  a.ws.close(); b.ws.close();
});

test('неверный код и неверный токен — понятные ошибки', async () => {
  const c = client(); await c.opened;
  c.send({ type: 'join', code: 'ZZZZZZ', name: 'x' });
  assert.match((await c.next('error')).message, /не найдено/);
  c.send({ type: 'rejoin', code: 'ZZZZZZ', token: 'bad' });
  assert.match((await c.next('error')).message, /Не удалось вернуться/);
  c.ws.close();
});

test('возврат по токену при живом старом соединении: старое закрывается, игрок остаётся на связи', async () => {
  const a = client(); await a.opened;
  a.send({ type: 'create', name: 'Хост' });
  const ja = await a.next('joined');
  const b = client(); await b.opened;
  b.send({ type: 'join', code: ja.code, name: 'Телефон' });
  const jb = await b.next('joined');
  // телефон сменил сеть: новое соединение возвращается по токену, старое ещё открыто
  const b2 = client(); await b2.opened;
  b2.send({ type: 'rejoin', code: jb.code, token: jb.token });
  const jb2 = await b2.next('joined');
  assert.equal(jb2.you, jb.you);
  assert.equal(await b.closed, 4000); // старое соединение закрыто сервером
  // игрок по-прежнему «на связи»
  const r = await a.next('room', m => { const me = m.room.members.find(x => x.id === jb.you); return me && me.online; });
  assert.ok(r);
  a.ws.close(); b2.ws.close();
});

test('выход хоста передаёт права, выход последнего удаляет лобби', async () => {
  const a = client(); await a.opened;
  a.send({ type: 'create', name: 'Хост' });
  const ja = await a.next('joined');
  const b = client(); await b.opened;
  b.send({ type: 'join', code: ja.code, name: 'Второй' });
  const jb = await b.next('joined');
  a.send({ type: 'leave' });
  const r = await b.next('room', m => m.room.hostId === jb.you);
  assert.equal(r.room.members.length, 1);
  b.send({ type: 'leave' });
  await new Promise(res => setTimeout(res, 150));
  assert.equal(srv.rooms.has(ja.code), false);
  a.ws.close(); b.ws.close();
});

test('не хост не может запустить игру', async () => {
  const a = client(); await a.opened;
  a.send({ type: 'create', name: 'Хост' });
  const ja = await a.next('joined');
  const b = client(); await b.opened;
  b.send({ type: 'join', code: ja.code, name: 'Гость' });
  await b.next('joined');
  b.send({ type: 'start' });
  assert.match((await b.next('error')).message, /Только хост/);
  a.ws.close(); b.ws.close();
});

test('лимит соединений с одного IP', async () => {
  const many = Array.from({ length: 7 }, () => client());
  const codes = await Promise.all(many.map(c => Promise.race([c.closed, new Promise(r => setTimeout(() => r(null), 800))])));
  assert.ok(codes.includes(1013), 'лишнее соединение должно закрываться с кодом 1013');
  many.forEach(c => c.ws.terminate());
});
