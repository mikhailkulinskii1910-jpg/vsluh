/* Комната лобби на телефоне хоста (режим без сервера, до 10 игроков).
   Та же логика, что у сервера, но для одного лобби: правила — из js/game.js, доставка — через send(key, obj),
   где key — 'local' (сам хост) или id соседа в прямой связи. Работает в браузере (window.VeloRoomHost) и в Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VeloRoomHost = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const BROADCAST_MS = 1000;
  const MAX_P2P = 10;

  function randomHex(bytes) {
    const a = new Uint8Array(bytes);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(a);
    else require('crypto').randomFillSync(a);
    return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
  }

  class RoomHost {
    /** game — модуль правил; room — готовая комната (createRoom); send(key, obj) — доставка. */
    constructor({ game, room, send, now = () => Date.now(), maxMembers = MAX_P2P }) {
      this.game = game;
      this.room = room;
      this.send = send;
      this.now = now;
      this.max = maxMembers;
      this.keyToMember = new Map();
      this.lastBroadcast = 0;
      this.pending = [];
      this.dirty = true;
    }

    static create({ game, code, send, now, maxMembers }) {
      const t = (now || Date.now)();
      return new RoomHost({ game, room: game.createRoom(code, t), send, now, maxMembers });
    }

    /**
     * Новая комната из последнего состояния (права хоста перешли этому телефону).
     * selfMemberId — игрок нового хоста; он становится хостом игры.
     */
    static fromSnapshot({ game, snapshot, route, replay, selfMemberId, send, now, maxMembers }) {
      const t = (now || Date.now)();
      const room = game.createRoom(snapshot.code, t);
      Object.assign(room.config, snapshot.config || {});
      for (const m of snapshot.members) {
        const mem = game.createMember(room, m.id, randomHex(16), m.name, t);
        Object.assign(mem, {
          color: m.color, skin: m.skin || mem.skin, lat: m.lat, lon: m.lon, acc: m.acc, spd: m.spd, hdg: m.hdg,
          bat: m.bat, charging: m.charging, role: m.role, progress: m.progress || 0, place: m.place || null,
          online: m.id === selfMemberId, seenAt: t,
        });
      }
      room.nextColor = snapshot.members.length;
      room.hostId = selfMemberId;
      if (route && route.coords) game.setRoute(room, route);
      const g = snapshot.game || {};
      if (g.status === 'running') {
        room.game.status = 'running';
        room.game.endsAt = t + (g.timeLeftMs || 0);
        room.game.startAt = room.game.endsAt - room.config.timeLimitSec * 1000;
        if (g.graceLeftMs > 0) room.game.graceEndsAt = t + g.graceLeftMs;
        for (const m of snapshot.members) {
          if (m.finishedMs != null) room.members.get(m.id).finishedAt = room.game.startAt + m.finishedMs;
        }
      } else if (g.status === 'countdown') {
        room.game.status = 'countdown';
        room.game.startAt = t + (g.countdownLeftMs || 0);
      } else if (g.status === 'finished') {
        Object.assign(room.game, { status: 'finished', reason: g.reason, winnerRole: g.winnerRole, winnerId: g.winnerId, caught: g.caught });
      }
      if (replay) { room.replay = replay; room.replaySent = replay.id; }
      return new RoomHost({ game, room, send, now, maxMembers });
    }

    get code() { return this.room.code; }

    out(key, obj) { try { this.send(key, obj); } catch (e) { /* сосед отключился */ } }

    broadcast(extra = {}) {
      const t = this.now();
      const payload = { type: 'room', room: this.game.snapshot(this.room, t), ...extra };
      for (const key of new Set(this.keyToMember.keys())) this.out(key, payload);
      if (this.room.replay && this.room.replaySent !== this.room.replay.id) {
        for (const key of this.keyToMember.keys()) this.out(key, { type: 'replay', replay: this.room.replay });
        this.room.replaySent = this.room.replay.id;
      }
      this.lastBroadcast = t;
      this.dirty = false;
      this.pending = [];
    }

    attach(key, m) {
      for (const [k, id] of this.keyToMember) if (id === m.id && k !== key) this.keyToMember.delete(k);
      this.keyToMember.set(key, m.id);
      m.online = true;
      m.seenAt = this.now();
      this.out(key, { type: 'joined', code: this.room.code, you: m.id, token: m.token, room: this.game.snapshot(this.room, this.now()), p2p: true });
      if (this.room.route) this.out(key, { type: 'route', route: this.room.route });
      if (this.room.replay) this.out(key, { type: 'replay', replay: this.room.replay });
      this.dirty = true;
    }

    fail(key, message) { this.out(key, { type: 'error', message }); }

    /** Сообщение от игрока (key — 'local' или id соседа). */
    handle(key, msg) {
      if (!msg || typeof msg !== 'object') return;
      const t = this.now();
      const name = typeof msg.name === 'string' ? msg.name.trim().slice(0, 20) : '';
      const memberId = this.keyToMember.get(key);
      const m = memberId && this.room.members.get(memberId);
      switch (msg.type) {
        case 'join':
        case 'rejoin': {
          const known = msg.memberId && this.room.members.get(msg.memberId);
          if (known) return this.attach(key, known);
          if (m) return this.attach(key, m);
          if (this.room.members.size >= this.max) return this.fail(key, `В лобби уже ${this.max} игроков — это максимум для лобби без сервера`);
          return this.attach(key, this.game.createMember(this.room, randomHex(6), randomHex(16), name, t));
        }
        case 'state': {
          if (!m) return;
          const events = this.game.updateState(this.room, m.id, msg.fix, t);
          if (!events) return;
          this.dirty = true;
          this.pending.push(...events);
          if (events.length) this.broadcast({ events: this.pending });
          return;
        }
        case 'leave': {
          if (!m) return;
          this.room.members.delete(m.id);
          this.keyToMember.delete(key);
          if (this.room.hostId === m.id) this.room.hostId = this.game.pickHost(this.room);
          this.broadcast();
          return;
        }
        case 'route': case 'config': case 'start': case 'stop': {
          if (!m) return this.fail(key, 'Сначала войдите в лобби');
          if (this.room.hostId !== m.id) return this.fail(key, 'Только хост лобби может это сделать');
          let err = null;
          if (msg.type === 'route') err = this.game.setRoute(this.room, msg.route);
          if (msg.type === 'config') err = this.game.setConfig(this.room, msg.config);
          if (msg.type === 'start') err = this.game.startGame(this.room, t);
          if (msg.type === 'stop') err = this.game.stopGame(this.room, t);
          if (err) return this.fail(key, err);
          if (msg.type === 'route') for (const k of this.keyToMember.keys()) this.out(k, { type: 'route', route: this.room.route });
          this.broadcast();
          return;
        }
        default:
      }
    }

    /** Сосед пропал из прямой связи. */
    disconnect(key) {
      const id = this.keyToMember.get(key);
      if (!id) return;
      this.keyToMember.delete(key);
      if (![...this.keyToMember.values()].includes(id)) {
        const m = this.room.members.get(id);
        if (m) { m.online = false; this.dirty = true; }
      }
    }

    /** Вызывать примерно 4 раза в секунду: отсчёт, таймеры, рассылка состояния. */
    tick() {
      const t = this.now();
      const events = this.game.tick(this.room, t);
      if (events.length) { this.dirty = true; this.pending.push(...events); }
      if (this.dirty || t - this.lastBroadcast >= BROADCAST_MS) this.broadcast(this.pending.length ? { events: this.pending } : {});
    }
  }

  return { RoomHost, MAX_P2P, randomHex };
});
