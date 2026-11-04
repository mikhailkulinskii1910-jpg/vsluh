/* Клиент лобби: WebSocket с автоматическим переподключением и возвратом в лобби по токену. */
(function (root) {
  const SESSION_KEY = 'velo-session';

  function loadSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
  }
  function saveSession(s) {
    try { s ? sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)) : sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  }

  class Lobby {
    constructor() {
      this.ws = null;
      this.url = '';
      this.wanted = false;   // нужно ли держать соединение
      this.retry = 0;
      this.session = loadSession(); // { code, token } — чтобы вернуться после обрыва сети
      this.handlers = {};
    }

    on(type, fn) { (this.handlers[type] ||= []).push(fn); }
    emit(type, data) { (this.handlers[type] || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } }); }

    /** Открывает соединение. Промис выполняется, когда сокет открыт. */
    connect(url) {
      this.url = url;
      this.wanted = true;
      return this.open();
    }

    open() {
      return new Promise((resolve, reject) => {
        let opened = false;
        let ws;
        try { ws = new WebSocket(this.url); } catch (e) { return reject(e); }
        this.ws = ws;
        const sock = ws; // закрытие старого сокета не должно трогать новый
        ws.onopen = () => {
          opened = true;
          this.retry = 0;
          this.emit('connected');
          if (this.session) this.send({ type: 'rejoin', code: this.session.code, token: this.session.token });
          resolve();
        };
        ws.onmessage = (ev) => {
          let msg;
          try { msg = JSON.parse(ev.data); } catch { return; }
          if (msg.type === 'joined') { this.session = { code: msg.code, token: msg.token }; saveSession(this.session); }
          if (msg.type === 'error' && /Не удалось вернуться/.test(msg.message)) { this.clearSession(); }
          this.emit(msg.type, msg);
        };
        ws.onclose = (ev) => {
          if (this.ws !== sock) { if (!opened) reject(new Error('Соединение закрыто')); return; }
          this.ws = null;
          if (ev && ev.code === 1013) this.emit('error', { type: 'error', message: 'Слишком много подключений с этого адреса, повторю позже' });
          if (!opened) { reject(new Error('Не удалось подключиться к серверу')); }
          this.emit('disconnected');
          if (this.wanted && this.session) {
            const delay = Math.min(15000, 1000 * 2 ** this.retry++);
            setTimeout(() => { if (this.wanted && !this.ws) this.open().catch(() => {}); }, delay);
          }
        };
        ws.onerror = () => { /* причина придёт в onclose */ };
      });
    }

    send(obj) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
      this.ws.send(JSON.stringify(obj));
      return true;
    }

    get connected() { return !!this.ws && this.ws.readyState === WebSocket.OPEN; }

    clearSession() { this.session = null; saveSession(null); }

    close() {
      this.wanted = false;
      this.clearSession();
      if (this.ws) this.ws.close();
    }
  }

  root.VeloLobby = { Lobby };
})(window);
