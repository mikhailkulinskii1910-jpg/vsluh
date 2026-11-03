// Онлайн-комната поверх публичного MQTT-брокера (WebSocket). Регистрация не нужна.
// Всё содержимое шифруется AES-GCM ключом, выведенным из кода лобби, а имя топика —
// это хэш кода: брокер и посторонние видят только шифротекст.

export const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];
const enc = new TextEncoder(), dec = new TextDecoder();

function brokerList() {
  try { const o = localStorage.getItem('mt_broker'); if (o) return [o]; } catch {}
  return BROKERS;
}
async function sha256hex(s) {
  const h = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function deriveKey(code) {
  const base = await crypto.subtle.importKey('raw', enc.encode('maptag:' + code.toUpperCase()), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: enc.encode('maptag-room-v1'), iterations: 40000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export const newId = () => Math.random().toString(36).slice(2, 10);

export class Room {
  /** code — код лобби, myId — id этого телефона, onMsg(type, data, from, ts) */
  constructor(code, myId, onMsg) {
    this.code = code.toUpperCase(); this.myId = myId; this.onMsg = onMsg;
    this.client = null; this.broker = null; this.status = 'off'; this.onStatus = null;
    this.lobby = null; // последний закреплённый снимок лобби
  }
  setStatus(s) { this.status = s; this.onStatus && this.onStatus(s); }

  async init() {
    if (!window.crypto || !crypto.subtle) throw new Error('crypto');
    if (typeof mqtt === 'undefined') throw new Error('mqtt');
    this.key = await deriveKey(this.code);
    const h = await sha256hex('maptag-topic:' + this.code);
    this.base = 'maptag/v1/' + h.slice(0, 24);
  }

  async seal(obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.key, enc.encode(JSON.stringify(obj))));
    const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
    return out;
  }
  async open(buf) {
    const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (u.length < 13) return null;
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.slice(0, 12) }, this.key, u.slice(12));
    return JSON.parse(dec.decode(pt));
  }

  /** Подключиться к первому доступному брокеру (организатор). */
  async host() {
    await this.init();
    for (const url of brokerList()) {
      if (await this.tryConnect(url, 7000)) return url;
    }
    this.setStatus('error');
    throw new Error('no broker');
  }

  /** Найти лобби: на каждом брокере ждём закреплённый снимок. Возвращает снимок или null. */
  async join(waitMs = 6000) {
    await this.init();
    for (const url of brokerList()) {
      if (!(await this.tryConnect(url, 7000))) continue;
      const snap = await new Promise((res) => {
        if (this.lobby) return res(this.lobby);
        const t = setTimeout(() => res(null), waitMs);
        this._lobbyWait = (l) => { clearTimeout(t); res(l); };
      });
      this._lobbyWait = null;
      if (snap && snap.status !== 'closed') return snap;
      this.disconnect();
    }
    this.setStatus('error');
    return null;
  }

  tryConnect(url, timeout) {
    return new Promise((res) => {
      this.setStatus('connecting');
      let done = false;
      const c = mqtt.connect(url, { connectTimeout: timeout, reconnectPeriod: 3000, keepalive: 30, clean: true, clientId: 'mt_' + this.myId + '_' + Math.random().toString(36).slice(2, 6) });
      const fail = () => { if (done) return; done = true; try { c.end(true); } catch {} res(false); };
      const timer = setTimeout(fail, timeout + 500);
      c.on('connect', () => {
        this.setStatus('online');
        if (done) return;
        c.subscribe([this.base + '/lobby', this.base + '/ev'], { qos: 0 }, (err) => {
          if (err) return fail();
          done = true; clearTimeout(timer);
          this.client = c; this.broker = url; res(true);
        });
      });
      c.on('reconnect', () => this.setStatus('connecting'));
      c.on('offline', () => this.setStatus('connecting'));
      c.on('error', () => { if (!done) fail(); });
      c.on('message', (topic, payload) => this.handle(topic, payload));
    });
  }

  async handle(topic, payload) {
    let m;
    try { m = await this.open(payload); } catch { return; }   // чужой ключ или мусор
    if (!m) return;
    if (topic.endsWith('/lobby')) {
      this.lobby = m.d; this.lobbyTs = m.ts;
      this._lobbyWait && this._lobbyWait(m.d);
      if (m.f !== this.myId) this.onMsg && this.onMsg('lobby', m.d, m.f, m.ts);
      return;
    }
    if (m.f === this.myId) return;
    if (m.to && m.to !== this.myId) return;
    this.onMsg && this.onMsg(m.t, m.d, m.f, m.ts);
  }

  async send(type, data, to) {
    if (!this.client) return;
    const p = await this.seal({ t: type, d: data, f: this.myId, ts: Date.now(), to: to || undefined });
    this.client.publish(this.base + '/ev', p, { qos: 0 });
  }
  /** Закреплённый снимок лобби: его сразу получают новые участники. */
  async setLobby(data) {
    if (!this.client) return;
    this.lobby = data;
    const p = await this.seal({ t: 'lobby', d: data, f: this.myId, ts: Date.now() });
    this.client.publish(this.base + '/lobby', p, { qos: 1, retain: true });
  }
  async clearLobby() {
    if (!this.client) return;
    await this.setLobby({ status: 'closed' });
    // пустое закреплённое сообщение удаляет снимок с брокера
    this.client.publish(this.base + '/lobby', new Uint8Array(0), { qos: 1, retain: true });
  }
  disconnect() { try { this.client && this.client.end(true); } catch {} this.client = null; this.lobby = null; this.setStatus('off'); }
}
