/* Прямая связь телефонов без своего сервера (WebRTC).
   Знакомство — через открытые трекеры WebTorrent (простой JSON-протокол): они только пересылают
   зашифрованные предложения соединения. Позиции и сообщения идут напрямую между телефонами.
   Предложения шифруются ключом из кода лобби (AES-GCM), поэтому трекер не видит адреса. */
(function (root) {
  const TRACKERS = ['wss://tracker.openwebtorrent.com', 'wss://tracker.webtorrent.dev'];
  const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];
  const OFFERS = 4;               // сколько предложений отправлять за раз
  const ANNOUNCE_MS = 12000;      // как часто напоминать о себе трекеру
  const GATHER_MS = 2500;         // ждать сбора адресов не дольше (на некоторых сетях сбор «зависает»)
  const CHUNK = 48000;            // большие сообщения режем на части
  const enc = new TextEncoder(), dec = new TextDecoder();

  const rnd20 = () => Array.from(crypto.getRandomValues(new Uint8Array(20)), b => String.fromCharCode(33 + (b % 94))).join('');
  const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  async function sha(alg, text) { return new Uint8Array(await crypto.subtle.digest(alg, enc.encode(text))); }

  class TrackerMesh {
    /**
     * roomId — код лобби; на него завязаны и «рой» на трекере, и ключ шифрования.
     * onPeerJoin(id), onPeerLeave(id), onMessage(obj, id)
     */
    constructor({ roomId, trackers = TRACKERS, iceServers = ICE, onPeerJoin, onPeerLeave, onMessage }) {
      this.roomId = roomId;
      this.trackers = trackers;
      this.iceServers = iceServers;
      this.cb = { join: onPeerJoin || (() => {}), leave: onPeerLeave || (() => {}), msg: onMessage || (() => {}) };
      this.selfId = rnd20();
      this.peers = new Map();    // id → { pc, dc }
      this.pending = new Map();  // offerId → { pc, dc, at }
      this.answering = new Set();
      this.sockets = [];
      this.parts = new Map();    // сборка больших сообщений
      this.stopped = false;
    }

    async start() {
      const h = await sha('SHA-1', 'velokarta:' + this.roomId);
      this.infoHash = String.fromCharCode(...h);
      this.key = await crypto.subtle.importKey('raw', await sha('SHA-256', 'velokarta-key:' + this.roomId), 'AES-GCM', false, ['encrypt', 'decrypt']);
      for (const url of this.trackers) this.openTracker(url);
      this.timer = setInterval(() => this.announce(), ANNOUNCE_MS);
    }

    openTracker(url) {
      if (this.stopped) return;
      const ws = new WebSocket(url);
      ws.onopen = () => this.announce(ws, true);
      ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } this.onTracker(m, ws); };
      ws.onclose = () => {
        this.sockets = this.sockets.filter(s => s !== ws);
        if (!this.stopped) setTimeout(() => this.openTracker(url), 5000);
      };
      ws.onerror = () => {};
      this.sockets.push(ws);
    }

    async encrypt(text) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.key, enc.encode(text));
      return b64(iv) + '.' + b64(data);
    }

    async decrypt(s) {
      const [iv, data] = String(s).split('.');
      return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, this.key, unb64(data)));
    }

    newPc() { return new RTCPeerConnection({ iceServers: this.iceServers }); }

    /** Ждём сбор адресов: до завершения или GATHER_MS, если хоть один адрес уже есть. */
    gathered(pc) {
      return new Promise(res => {
        let got = 0, done = false;
        const finish = () => { if (!done) { done = true; res(); } };
        if (pc.iceGatheringState === 'complete') return finish();
        pc.addEventListener('icecandidate', e => { if (e.candidate) got++; else finish(); });
        pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') finish(); });
        const t = setInterval(() => { if (got > 0) { clearInterval(t); finish(); } }, GATHER_MS);
        setTimeout(() => { clearInterval(t); finish(); }, GATHER_MS * 3);
      });
    }

    sendTracker(obj, only) {
      const s = JSON.stringify(obj);
      for (const ws of only ? [only] : this.sockets) if (ws.readyState === 1) ws.send(s);
    }

    /** Отправить трекеру пачку свежих предложений соединения. */
    async announce(only, first) {
      if (this.stopped || !this.infoHash) return;
      const now = Date.now();
      for (const [id, p] of this.pending) if (now - p.at > 60000) { p.pc.close(); this.pending.delete(id); }
      const offers = [];
      for (let i = 0; i < OFFERS; i++) {
        const pc = this.newPc();
        const dc = pc.createDataChannel('velo');
        await pc.setLocalDescription(await pc.createOffer());
        await this.gathered(pc);
        const offerId = rnd20();
        this.pending.set(offerId, { pc, dc, at: Date.now() });
        offers.push({ offer: { type: 'offer', sdp: await this.encrypt(pc.localDescription.sdp) }, offer_id: offerId });
      }
      this.sendTracker({ action: 'announce', info_hash: this.infoHash, peer_id: this.selfId, numwant: OFFERS, offers, ...(first ? { event: 'started' } : {}) }, only);
    }

    async onTracker(m, ws) {
      if (m.info_hash !== this.infoHash || !m.peer_id || m.peer_id === this.selfId) return;
      const from = m.peer_id;
      try {
        if (m.offer && m.offer_id) {
          if (this.peers.has(from) || this.answering.has(from)) return;
          this.answering.add(from);
          const sdp = await this.decrypt(m.offer.sdp); // чужое лобби — не расшифруется, пропускаем
          const pc = this.newPc();
          pc.ondatachannel = e => this.bind(from, pc, e.channel);
          await pc.setRemoteDescription({ type: 'offer', sdp });
          await pc.setLocalDescription(await pc.createAnswer());
          await this.gathered(pc);
          this.sendTracker({ action: 'announce', info_hash: this.infoHash, peer_id: this.selfId, to_peer_id: from, offer_id: m.offer_id,
            answer: { type: 'answer', sdp: await this.encrypt(pc.localDescription.sdp) } }, ws);
          setTimeout(() => this.answering.delete(from), 20000);
        } else if (m.answer && m.offer_id) {
          const p = this.pending.get(m.offer_id);
          if (!p || this.peers.has(from)) return;
          this.pending.delete(m.offer_id);
          await p.pc.setRemoteDescription({ type: 'answer', sdp: await this.decrypt(m.answer.sdp) });
          this.bind(from, p.pc, p.dc);
        }
      } catch { this.answering.delete(from); }
    }

    /** Канал данных к игроку: при открытии — «игрок подключился». Дубли соединений закрываем. */
    bind(id, pc, dc) {
      dc.onopen = () => {
        if (this.peers.has(id)) { pc.close(); return; }
        this.peers.set(id, { pc, dc });
        this.answering.delete(id);
        this.cb.join(id);
      };
      dc.onmessage = e => this.receive(e.data, id);
      const gone = () => {
        const cur = this.peers.get(id);
        if (cur && cur.pc === pc) { this.peers.delete(id); this.cb.leave(id); }
      };
      dc.onclose = gone;
      pc.addEventListener('connectionstatechange', () => { if (['failed', 'closed'].includes(pc.connectionState)) gone(); });
    }

    receive(raw, id) {
      let m;
      try { m = JSON.parse(raw); } catch { return; }
      if (m && m.__c) { // часть большого сообщения
        const k = id + m.__c;
        const buf = this.parts.get(k) || [];
        buf[m.i] = m.d;
        this.parts.set(k, buf);
        if (buf.filter(x => x != null).length === m.n) { this.parts.delete(k); this.receive(buf.join(''), id); }
        return;
      }
      this.cb.msg(m, id);
    }

    /** Отправить объект одному игроку или всем. */
    send(obj, to) {
      const s = JSON.stringify(obj);
      const targets = to ? [this.peers.get(to)].filter(Boolean) : [...this.peers.values()];
      for (const { dc } of targets) {
        if (dc.readyState !== 'open') continue;
        if (s.length <= CHUNK) { dc.send(s); continue; }
        const id = Math.random().toString(36).slice(2), n = Math.ceil(s.length / CHUNK);
        for (let i = 0; i < n; i++) dc.send(JSON.stringify({ __c: id, i, n, d: s.slice(i * CHUNK, (i + 1) * CHUNK) }));
      }
    }

    peerIds() { return [...this.peers.keys()]; }

    stop() {
      this.stopped = true;
      clearInterval(this.timer);
      for (const ws of this.sockets) { try { ws.close(); } catch { /* */ } }
      for (const { pc } of this.peers.values()) pc.close();
      for (const { pc } of this.pending.values()) pc.close();
      this.peers.clear(); this.pending.clear();
    }
  }

  root.VeloMesh = { TrackerMesh };
})(window);
