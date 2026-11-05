/* Лобби без сервера (до 10 игроков): телефоны связаны напрямую (js/mesh.js),
   правила считает телефон хоста (js/roomhost.js). Тот же интерфейс, что у WebSocket-клиента (js/net.js):
   on / send / connected / session / clearSession — поэтому экран лобби не знает, какой режим включён.
   Если хост пропал, права переходят игроку на связи с наименьшим id, и он поднимает комнату из последнего состояния. */
(function (root) {
  const SESSION_KEY = 'velo-p2p-session';
  const HOST_WAIT_MS = 30000;   // сколько ждать хоста при входе по коду
  const ELECT_DELAY_MS = 3000;  // пауза перед выбором нового хоста

  const load = () => { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; } };
  const save = s => { try { s ? sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)) : sessionStorage.removeItem(SESSION_KEY); } catch { /* */ } };

  class P2PLobby {
    constructor() {
      this.handlers = {};
      this.session = load();     // { code, memberId } — чтобы вернуться после перезагрузки
      this.mesh = null;
      this.host = null;          // RoomHost, если этот телефон — хост
      this.hostPeer = null;      // id соседа-хоста
      this.code = null;
      this.you = null;
      this.name = '';
      this.lastRoom = null; this.lastRoute = null; this.lastReplay = null;
    }

    on(type, fn) { (this.handlers[type] ||= []).push(fn); }
    emit(type, data) { (this.handlers[type] || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } }); }

    get connected() { return !!this.host || (!!this.mesh && !!this.hostPeer); }
    get isHost() { return !!this.host; }
    clearSession() { this.session = null; save(null); }

    async startMesh(code) {
      if (this.mesh && this.code === code) return;
      this.stopMesh();
      this.code = code;
      this.mesh = new root.VeloMesh.TrackerMesh({
        roomId: code,
        // свои TURN-серверы (для мобильного интернета, где прямое соединение не проходит) — в config.js
        ...(root.VELO_CONFIG && Array.isArray(root.VELO_CONFIG.iceServers) && root.VELO_CONFIG.iceServers.length
          ? { iceServers: root.VeloMesh.ICE.concat(root.VELO_CONFIG.iceServers) } : {}),
        onPeerJoin: id => this.onPeerJoin(id),
        onPeerLeave: id => this.onPeerLeave(id),
        onMessage: (m, id) => this.onMessage(m, id),
      });
      await this.mesh.start();
    }

    stopMesh() {
      clearInterval(this.tickTimer); clearTimeout(this.hostTimer); clearTimeout(this.electTimer);
      if (this.mesh) this.mesh.stop();
      this.mesh = null; this.host = null; this.hostPeer = null;
    }

    /** Этот телефон становится хостом: запускает комнату и сообщает об этом соседям. */
    becomeHost(roomHost) {
      this.host = roomHost;
      this.hostPeer = null;
      clearInterval(this.tickTimer);
      this.tickTimer = setInterval(() => { if (this.host) this.host.tick(); }, 250);
      for (const id of this.mesh.peerIds()) this.mesh.send({ type: 'hello', host: true }, id);
    }

    hostSend(key, obj) {
      if (key === 'local') this.deliver(obj);
      else if (this.mesh) this.mesh.send(obj, key);
    }

    /** Сообщение от комнаты — экрану лобби. */
    deliver(m) {
      if (m.type === 'joined') {
        this.you = m.you;
        this.session = { code: m.code, memberId: m.you };
        save(this.session);
        this.emit('connected');
      }
      if (m.type === 'room') this.lastRoom = m.room;
      if (m.type === 'route') this.lastRoute = m.route;
      if (m.type === 'replay') this.lastReplay = m.replay;
      this.emit(m.type, m);
    }

    async send(obj) {
      const G = root.VeloGame, RH = root.VeloRoomHost.RoomHost;
      switch (obj.type) {
        case 'create': {
          this.name = obj.name || '';
          const code = G.newCode(new Map());
          await this.startMesh(code);
          this.becomeHost(RH.create({ game: G, code, send: (k, o) => this.hostSend(k, o) }));
          this.host.handle('local', { type: 'join', name: this.name });
          return;
        }
        case 'join': {
          this.name = obj.name || '';
          await this.startMesh(String(obj.code).toUpperCase());
          this.waitHost();
          return;
        }
        case 'leave': {
          if (this.host) {
            this.mesh.send({ type: 'hostleft' }); // соседи выберут нового хоста
            this.host.handle('local', obj);
          } else if (this.hostPeer) this.mesh.send(obj, this.hostPeer);
          this.clearSession();
          setTimeout(() => this.stopMesh(), 400);
          return;
        }
        default:
          if (this.host) this.host.handle('local', obj);
          else if (this.hostPeer && this.mesh) this.mesh.send(obj, this.hostPeer);
      }
    }

    waitHost() {
      clearTimeout(this.hostTimer);
      this.hostTimer = setTimeout(() => {
        if (this.hostPeer || this.host) return;
        const message = this.mesh && this.mesh.sawPeer
          ? 'Лобби найдено, но сеть не пропускает прямое соединение между телефонами (так бывает в мобильном интернете). ' +
            'Подключите оба телефона к одному Wi-Fi или раздайте интернет с одного из них и попробуйте снова.'
          : 'Лобби не найдено: проверьте код и что у создателя лобби открыто приложение и есть интернет';
        this.emit('error', { type: 'error', message });
        this.stopMesh();
      }, HOST_WAIT_MS);
    }

    onPeerJoin(id) {
      if (this.host) this.mesh.send({ type: 'hello', host: true }, id);
    }

    onMessage(m, id) {
      if (!m || typeof m !== 'object') return;
      if (this.host) {
        if (m.type !== 'hello' && m.type !== 'hostleft') this.host.handle(id, m);
        return;
      }
      if (m.type === 'hello' && m.host) {
        const changed = this.hostPeer !== id;
        this.hostPeer = id;
        clearTimeout(this.hostTimer); clearTimeout(this.electTimer);
        if (changed) {
          const back = this.session && this.session.code === this.code;
          this.mesh.send(back ? { type: 'rejoin', memberId: this.session.memberId, name: this.name } : { type: 'join', name: this.name }, id);
        }
        return;
      }
      if (m.type === 'hostleft' && id === this.hostPeer) {
        this.hostLeftId = this.lastRoom && this.lastRoom.hostId; // хост вышел сам — в новой комнате его не будет
        return this.hostGone();
      }
      if (id === this.hostPeer) this.deliver(m);
    }

    onPeerLeave(id) {
      if (this.host) { this.host.disconnect(id); return; }
      if (id === this.hostPeer) this.hostGone();
    }

    hostGone() {
      this.hostPeer = null;
      this.emit('disconnected');
      clearTimeout(this.electTimer);
      this.electTimer = setTimeout(() => this.elect(), ELECT_DELAY_MS);
    }

    /** Новый хост — игрок на связи с наименьшим id (все считают одинаково по последнему состоянию). */
    elect() {
      if (this.host || this.hostPeer || !this.mesh) return;
      if (!this.lastRoom || !this.you) return this.waitHost();
      const oldHost = this.lastRoom.hostId;
      const ids = this.lastRoom.members.filter(m => m.online && m.id !== oldHost).map(m => m.id);
      ids.push(this.you);
      const leader = [...new Set(ids)].sort()[0];
      if (leader !== this.you) return this.waitHost(); // ждём «hello» от нового хоста
      const G = root.VeloGame, RH = root.VeloRoomHost.RoomHost;
      // вышедший сам хост в новую комнату не переносится; пропавший по связи — остаётся и может вернуться
      const snapshot = this.hostLeftId
        ? { ...this.lastRoom, members: this.lastRoom.members.filter(m => m.id !== this.hostLeftId) }
        : this.lastRoom;
      this.hostLeftId = null;
      this.becomeHost(RH.fromSnapshot({
        game: G, snapshot, route: this.lastRoute, replay: this.lastReplay,
        selfMemberId: this.you, send: (k, o) => this.hostSend(k, o),
      }));
      this.host.handle('local', { type: 'rejoin', memberId: this.you, name: this.name });
      this.emit('host-moved', { you: true });
    }
  }

  root.VeloP2P = { P2PLobby };
})(window);
