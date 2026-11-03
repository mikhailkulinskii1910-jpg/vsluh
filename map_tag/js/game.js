// Игровой движок: карта, боты, способности, задания, тайники
import { t } from './i18n.js';
import { I } from './icons.js';
import { POWERUPS, pwById, pwName, pwDesc } from './content.js';
import { beep } from './sound.js';
import { netMixin } from './gamenet.js';

export const BOT_NAMES = {
  ru: ['Лиса', 'Ёж', 'Сова', 'Барсук', 'Рысь', 'Белка', 'Енот', 'Филин', 'Куница', 'Заяц'],
  en: ['Fox', 'Hedgehog', 'Owl', 'Badger', 'Lynx', 'Squirrel', 'Raccoon', 'Hawk', 'Marten', 'Hare'],
};
const COLORS = ['#ffb86b', '#8fd0ff', '#c3a6ff', '#ffd66b', '#7ee0c3', '#ff9ec7', '#b4e06b', '#f7a07a', '#9fb4ff', '#e0c08a'];

const rnd = (a, b) => a + Math.random() * (b - a);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const fmt = (s) => { s = Math.max(0, Math.ceil(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Game {
  constructor(cfg, opts) {
    this.cfg = cfg;
    this.opts = opts; // { lang, onEnd, openRules, modal, toast }
    this.pace = cfg.mode === 'demo' ? 2.5 : 1;
    this.c0 = cfg.center;
    this.kx = 111320 * Math.cos(this.c0.lat * Math.PI / 180);
    this.ky = 110540;
    this.R = cfg.radius;
    this.poly = cfg.polygon && cfg.polygon.length >= 3 ? cfg.polygon.map((q) => this.xy(q.lat, q.lng)) : null;
    if (this.poly) this.pbox = { x0: Math.min(...this.poly.map((q) => q.x)), x1: Math.max(...this.poly.map((q) => q.x)), y0: Math.min(...this.poly.map((q) => q.y)), y1: Math.max(...this.poly.map((q) => q.y)) };
    this.ch = cfg.cheats || {};
    this.net = cfg.net || null;                       // { room, role: 'host'|'client', myId, startAt }
    this.isHost = !!(this.net && this.net.role === 'host');
    this.isClient = !!(this.net && this.net.role === 'client');
    if (this.net) this.ch.skiphide = false;
    this.t = cfg.cheats && cfg.cheats.skiphide ? cfg.hideSec : 0;
    this.last = performance.now();
    this.alerts = [];
    this.prints = [];
    this.circles = [];
    this.supplies = [];
    this.mission = null;
    this.nextMissionAt = cfg.features === 'spice' ? cfg.hideSec + 60 : Infinity;
    this.revealReadyAt = cfg.hideSec;
    this.freezeReadyAt = cfg.hideSec + 30;
    this.revealCd = cfg.revealCd;
    this.freezeCd = cfg.freezeCd;
    this.hasFreeze = cfg.features !== 'tutorial';
    this.hasPowerups = cfg.features === 'spice';
    this.enabledPw = (cfg.powerups && cfg.powerups.length ? cfg.powerups : POWERUPS.map((p) => p.id));
    this.flare = null;
    this.showHuntersUntil = 0;
    this.trayOpen = false;
    this.moreOpen = false;
    this.follow = true;
    this.ended = false;
    this.stats = { dist: 0, caught: 0, missions: 0, supplies: 0, powers: 0, timeHunt: 0, timeHide: 0, timesCaught: 0 };
    this.track = [];
    this.lastTrackT = -10;
    this.frames = [];
    this.events = [];
    this.lastPlayerReveal = 0;
    this.lastPlayerFreeze = 0;
    this.shrinkWarned = false;
    this.makePlayers();
    if (this.ch.skiphide) for (const p of this.players) if (p.role === 'hider' && (p.bot || cfg.mode === 'demo')) Object.assign(p, this.randZone(0.85, 0.35));
    if (this.hasPowerups && !this.isClient) for (let i = 0; i < 6 + Math.round(this.R / 150); i++) this.supplies.push(this.newSupply());
    if (this.isClient) this.nextMissionAt = Infinity;
    if (this.net) this.netInit();
  }

  // ---------- координаты ----------
  ll(p) { return [this.c0.lat + p.y / this.ky, this.c0.lng + p.x / this.kx]; }
  xy(lat, lng) { return { x: (lng - this.c0.lng) * this.kx, y: (lat - this.c0.lat) * this.ky }; }
  zoneScale() { return this.zoneR() / this.R; }
  inZone(p, f = 1) {
    const k = this.zoneScale() * f;
    if (!this.poly) return Math.hypot(p.x, p.y) <= this.R * k;
    const x = p.x / k, y = p.y / k, P = this.poly; let ins = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      if ((P[i].y > y) !== (P[j].y > y) && x < (P[j].x - P[i].x) * (y - P[i].y) / (P[j].y - P[i].y) + P[i].x) ins = !ins;
    }
    return ins;
  }
  randZone(fMax, fMin = 0) {
    const k = this.zoneScale();
    if (!this.poly) return this.randIn(this.R * k * fMax, this.R * k * fMin);
    const b = this.pbox;
    for (let i = 0; i < 300; i++) {
      const pt = { x: rnd(b.x0, b.x1) * k * fMax, y: rnd(b.y0, b.y1) * k * fMax };
      if (this.inZone(pt, fMax) && (!fMin || !this.inZone(pt, fMin))) return pt;
    }
    return { x: 0, y: 0 };
  }
  zoneLatLngs() { const k = this.zoneScale(); return this.poly.map((q) => this.ll({ x: q.x * k, y: q.y * k })); }
  randIn(rMax, rMin = 0) { const a = rnd(0, Math.PI * 2), r = Math.sqrt(rnd((rMin / rMax) ** 2, 1)) * rMax; return { x: Math.cos(a) * r, y: Math.sin(a) * r }; }
  zoneR() {
    const { hideSec, huntSec, shrinkTo } = this.cfg;
    if (this.t <= hideSec) return this.R;
    const p = Math.min(1, (this.t - hideSec) / huntSec);
    return this.R * (1 - (1 - shrinkTo) * p);
  }
  phase() { const { hideSec, huntSec } = this.cfg; return this.t < hideSec ? 'hide' : this.t < hideSec + huntSec ? 'hunt' : 'end'; }

  makePlayers() {
    const names = BOT_NAMES[this.opts.lang] || BOT_NAMES.ru;
    const total = 1 + this.cfg.bots;
    let hunters = Math.min(Math.max(1, this.cfg.hunters), total - 1 || 1);
    let myRole = this.cfg.myRole;
    if (myRole === 'random') myRole = Math.random() < hunters / total ? 'hunter' : 'hider';
    if (total === 1) myRole = 'hider';
    const roles = [];
    let botHunters = hunters - (myRole === 'hunter' ? 1 : 0);
    for (let i = 0; i < this.cfg.bots; i++) roles.push(i < botHunters ? 'hunter' : 'hider');
    roles.sort(() => Math.random() - 0.5);
    const mk = (id, name, role, bot, color) => ({
      id, name, role, bot, color, x: rnd(-15, 15), y: rnd(-15, 15), stamina: 100, running: false, alive: true,
      wards: 0, jams: 0, misdirect: false, ghostUntil: 0, smokeUntil: 0, silenceUntil: 0, exposedUntil: 0,
      warnUntil: 0, frozenUntil: 0, powerups: [], target: null, think: 0, lastPrint: null, speed: 0, outSince: null,
      wasCaught: false, holdMission: false,
    });
    if (Array.isArray(this.cfg.roles) && this.cfg.roles.length && this.cfg.roles[0].id) {
      // онлайн: у каждого id; ботов считает организатор
      this.players = [];
      let bi = 0;
      for (const r of this.cfg.roles) {
        const mine = r.id === this.cfg.myId;
        const p = mk(r.id, r.name, r.role, !!r.bot, mine ? '#ffffff' : COLORS[bi++ % COLORS.length]);
        p.remote = !mine && !r.bot;
        this.players.push(p);
        if (mine) this.me = p;
      }
      myRole = this.me.role;
    } else if (Array.isArray(this.cfg.roles) && this.cfg.roles.length) {
      // роли назначены вручную в «Ваша команда»: [{ name, role, bot }]
      const meR = this.cfg.roles.find((r) => !r.bot);
      myRole = meR ? meR.role : myRole;
      this.me = mk('me', this.cfg.name, myRole, false, '#ffffff');
      this.players = [this.me];
      this.cfg.roles.filter((r) => r.bot).forEach((r, i) => this.players.push(mk('b' + i, r.name, r.role, true, COLORS[i % COLORS.length])));
      if (!this.players.some((p) => p.role === 'hider')) this.me.role = myRole = 'hider';
    } else {
      this.me = mk('me', this.cfg.name, myRole, false, '#ffffff');
      this.players = [this.me];
      roles.forEach((r, i) => this.players.push(mk('b' + i, names[i % names.length], r, true, COLORS[i % COLORS.length])));
    }
    this.me.startRole = myRole;
    this.players.forEach((p) => { p.startRole = p.role; p.sim = p === this.me || (p.bot && !this.isClient); });
    // все стартуют у центра одинаково (позиции остальных придут по сети)
    if (this.net) this.players.forEach((p, i) => { p.x = Math.cos(i * 2.4) * 10; p.y = Math.sin(i * 2.4) * 10; p.nx = p.x; p.ny = p.y; });
  }

  // ---------- запуск ----------
  mount(root) {
    this.root = root;
    root.innerHTML = `<div id="game"><div id="map"></div><div class="hud-top" id="hudTop"></div><div class="hud-bottom" id="hudBot"></div><div id="cover"></div></div>`;
    const map = this.map = L.map(root.querySelector('#map'), { zoomControl: false, attributionControl: true, zoomSnap: 0.25 }).setView(this.ll({ x: 0, y: 0 }), this.R > 450 ? 15 : 16);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
    map.attributionControl.setPrefix(false);
    const zst = { color: '#2c7a4b', weight: 4, dashArray: '12 10', fill: false, interactive: false };
    this.zoneLayer = (this.poly ? L.polygon(this.zoneLatLngs(), zst) : L.circle(this.ll({ x: 0, y: 0 }), { radius: this.R, ...zst })).addTo(map);
    const tint = document.createElement('div'); tint.className = 'map-tint'; root.querySelector('#map').appendChild(tint);
    this.layers = { players: new Map(), circles: new Map(), prints: new Map(), supplies: new Map(), flare: [] };
    this.meMarker = L.marker(this.ll(this.me), { icon: this.meIcon(), zIndexOffset: 1000, interactive: false }).addTo(map);
    map.fitBounds(this.zoneLayer.getBounds(), { padding: [20, 20] });
    map.on('click', (e) => this.onMapTap(e));
    map.on('dragstart', () => { this.follow = false; });

    if (this.cfg.mode === 'gps') this.startGps();
    try { window.MapTagNative && window.MapTagNative.gameStart('Map Tag — ' + (this.me.role === 'hunter' ? t('hunter') : t('hider'))); } catch {}
    this.requestWakeLock();
    this.renderHud(true);
    this.timer = setInterval(() => this.tick(), 250);
    this.alert('blue', this.me.role === 'hunter' ? t('waitHint') : (this.cfg.mode === 'demo' ? t('demoTap') : t('hideTime') + '!'), 'map');
  }

  destroy() {
    clearInterval(this.timer);
    window.__nativeLoc = null;
    try { window.MapTagNative && window.MapTagNative.gameStop(); } catch {}
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    try { this.wakeLock && this.wakeLock.release(); } catch {}
    if (this.map) this.map.remove();
  }

  async requestWakeLock() { try { this.wakeLock = await navigator.wakeLock.request('screen'); } catch {} }

  startGps() {
    if (!navigator.geolocation) { this.switchDemo(t('noGps')); return; }
    let first = true;
    const onPos = (pos) => {
      if (this.cfg.mode !== 'gps' || this.ended) return;
      this.gotFix = true;
      if (this.ch.spoof) return;   // чит: настоящее гео игнорируется
      const p = this.xy(pos.coords.latitude, pos.coords.longitude);
      const now = this.t;
      if (first) {
        first = false;
        if (!this.poly && !this.net && Math.hypot(p.x, p.y) > this.R * 2) {
          // центр игры далеко — переносим зону к игроку
          this.c0 = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          this.zoneLayer.setLatLng(this.ll({ x: 0, y: 0 }));
          this.players.forEach((pl) => { pl.x = rnd(-15, 15); pl.y = rnd(-15, 15); });
          this.supplies = this.supplies.map(() => this.newSupply());
          this.alert('yellow', t('gpsFar'), 'map');
          this.map.fitBounds(this.zoneLayer.getBounds());
          this.me.x = 0; this.me.y = 0; this.gpsPrev = { x: 0, y: 0, t: now };
          return;
        }
      }
      const prev = this.gpsPrev;
      if (prev) {
        const d = Math.hypot(p.x - prev.x, p.y - prev.y), dt = Math.max(0.5, now - prev.t);
        if (pos.coords.accuracy < 50 || d > pos.coords.accuracy) {
          const sp = pos.coords.speed != null && !isNaN(pos.coords.speed) ? pos.coords.speed : d / dt;
          this.me.speed = this.me.speed * 0.5 + sp * 0.5;
          this.moveTo(this.me, p.x, p.y);
        }
      } else { this.me.x = p.x; this.me.y = p.y; }
      this.gpsPrev = { x: this.me.x, y: this.me.y, t: now };
    };
    // в APK позиции идут ещё и из фоновой службы (телефон в кармане, экран выключен)
    window.__nativeLoc = (lat, lng, acc, sp) => onPos({ coords: { latitude: lat, longitude: lng, accuracy: acc, speed: sp >= 0 ? sp : null } });
    this.watchId = navigator.geolocation.watchPosition(onPos, () => { if (!this.gotFix) this.switchDemo(t('noGps')); }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
  }

  switchDemo(msg) {
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    this.cfg.mode = 'demo'; this.pace = 2.5;
    if (msg) this.alert('yellow', msg, 'phone');
    this.renderHud(true);
  }

  onMapTap(e) {
    const spoof = this.cfg.mode === 'gps' && this.ch.spoof;
    if (this.cfg.mode !== 'demo' && !spoof) return;
    if (this.me.role === 'hunter' && this.phase() === 'hide' && !spoof) return;
    const p = this.xy(e.latlng.lat, e.latlng.lng);
    if (spoof && this.ch.teleport) { this.me.x = p.x; this.me.y = p.y; this.me.target = null; this.render(); return; }
    this.me.target = p;
  }
  /** Читы поменялись прямо в игре. */
  cheatsChanged() {
    if (this.ch.skiphide && this.phase() === 'hide') this.t = this.cfg.hideSec;
    if (this.ch.allpw && this.phase() === 'hunt') this.allGiven = false;
    this.renderHud(true); this.render();
  }

  // ---------- сущности ----------
  newSupply() { const zr = this.zoneR(); return { id: 's' + Math.random().toString(36).slice(2, 8), ...this.randZone(0.92, 0.1) }; }
  hiders() { return this.players.filter((p) => p.role === 'hider' && p.alive); }
  hunters() { return this.players.filter((p) => p.role === 'hunter'); }
  isFrozen(p) { return this.t < p.frozenUntil && this.t >= p.warnUntil; }

  moveTo(p, x, y) {
    const d = Math.hypot(x - p.x, y - p.y);
    if (p === this.me) {
      this.stats.dist += d;
      if (this.isFrozen(p)) {
        p.frozenDrift = (p.frozenDrift || 0) + d;
        if (p.frozenDrift > 10 && !p.frozenPenalty) {
          p.frozenPenalty = true; p.exposedUntil = Math.max(p.exposedUntil, this.t + 30);
          this.alert('red', t('movedFrozen'), 'snow');
        }
      }
    }
    // следы при беге
    if (p.role === 'hider' && p.running && this.t >= p.ghostUntil && this.phase() !== 'end') {
      if (!p.lastPrint || Math.hypot(x - p.lastPrint.x, y - p.lastPrint.y) >= 12) {
        const a = Math.atan2(x - p.x, y - p.y) * 180 / Math.PI;
        this.addPrint({ x, y, a, owner: p.id });
        p.lastPrint = { x, y };
      }
    }
    p.x = x; p.y = y;
  }

  addPrint(pr, fromNet) {
    if (this.net && !fromNet) (this.outPrints = this.outPrints || []).push(pr);
    if (!fromNet) { pr.id = 'f' + Math.random().toString(36).slice(2, 9); pr.t = this.t; }
    this.prints.push(pr);
    if (this.prints.length > 500) this.prints.shift();
  }

  step(p, target, run, dt) {
    if (!target) return false;
    const dx = target.x - p.x, dy = target.y - p.y, d = Math.hypot(dx, dy);
    if (d < 1.5) { p.running = false; return true; }
    const canRun = run && p.stamina > 3;
    p.running = canRun;
    const v = (canRun ? 3.6 : 1.5) * this.pace * (p === this.me && this.ch.speed ? 3 : 1);
    const s = Math.min(d, v * dt);
    this.moveTo(p, p.x + dx / d * s, p.y + dy / d * s);
    p.speed = s / dt;
    return s >= d - 0.01;
  }

  // ---------- главный цикл ----------
  tick() {
    const now = performance.now();
    let total = Math.min(600, (now - this.last) / 1000);
    this.last = now;
    if (this.net) {
      const target = this.netClockT();
      if (target < 0) { this.renderCountdown(-target); return; }
      total = Math.min(600, target - this.t);
      if (total < 0) return;
    }
    // в фоне браузер может вызывать таймер реже — прогоняем пропущенное время шагами по секунде
    while (total > 1 && !this.ended) { this.stepSim(1, false); total -= 1; }
    if (!this.ended) this.stepSim(total, true);
  }

  stepSim(dt, draw) {
    if (this.ended) return;
    this.t += dt;
    const ph = this.phase();
    if (ph === 'end') {
      if (this.isClient) { if (this.t > this.cfg.hideSec + this.cfg.huntSec + 25) this.finish(this.hiders().length > 0 ? 'hiders' : 'hunters'); if (draw) this.render(); return; }
      this.finish(this.hiders().length > 0 ? 'hiders' : 'hunters'); return;
    }

    // перемещение игрока
    const me = this.me;
    if (this.cfg.mode === 'demo' || this.ch.spoof) {
      if (!this.ch.spoof && (this.isFrozen(me) || (me.role === 'hunter' && ph === 'hide'))) { me.running = false; me.speed = 0; }
      else if (me.target) { if (this.step(me, me.target, this.runToggle, dt)) me.target = null; }
      else { me.running = false; me.speed = 0; }
    } else {
      me.running = me.speed > 2.8;
      if (this.gpsPrev && this.t - this.gpsPrev.t > 4) me.speed *= 0.7;
      this.checkVehicle(dt);
    }
    this.updateStamina(me, dt);
    if (this.ch.stamina) me.stamina = 100;
    if (this.ch.allpw && ph === 'hunt' && !this.allGiven) { this.allGiven = true; for (const id of this.enabledPw) { const pw = pwById(id); if (pw && (pw.side === 'both' || pw.side === me.role)) me.powerups.push(id, id); } this.renderHud(true); }

    // боты
    for (const p of this.players) if (p.bot && p.sim) this.botThink(p, dt, ph);
    for (const p of this.players) if (p.bot && p.sim) this.updateStamina(p, dt);
    if (this.net) this.netStep(dt);

    if (ph === 'hunt') {
      if (!this.isClient) { this.checkCatches(); this.checkSupplies(); this.updateMission(dt); this.botAbilities(); }
      this.checkZone(dt);
      if (!this.shrinkWarned && this.t > this.cfg.hideSec + 5) { this.shrinkWarned = true; this.alert('green', t('zoneShrink'), 'target'); }
      if (!this.isClient && this.hiders().length === 0) { this.finish('hunters'); return; }
    }
    if (this.flare && this.t >= this.flare.at && !this.flare.shown) { this.flare.shown = true; this.alert('blue', t('flareShow'), 'flare'); }
    if (this.flare && this.t > this.flare.at + 30) this.flare = null;

    // статистика и трек
    if (ph === 'hunt') { if (me.role === 'hunter') this.stats.timeHunt += dt; else this.stats.timeHide += dt; }
    if (this.t - this.lastTrackT >= 3) {
      this.lastTrackT = this.t;
      this.track.push([Math.round(me.x), Math.round(me.y), me.role === 'hunter' ? 1 : 0]);
      // кадр повтора: [t, x0, y0, роль0, x1, y1, роль1, …] по всем игрокам
      const fr = [Math.round(this.t)];
      for (const p of this.players) fr.push(Math.round(p.x), Math.round(p.y), p.role === 'hunter' ? 1 : 0);
      this.frames.push(fr);
    }

    // чистка
    this.prints = this.prints.filter((f) => this.t - f.t < 120);
    this.circles = this.circles.filter((c) => this.t - c.t < 90);
    this.alerts = this.alerts.filter((a) => this.t < a.until);

    if (draw) this.render();
  }

  /** Скорость как у транспорта (> 7 м/с дольше 8 с): прячущимся нельзя, охотникам — если выключено в настройках. */
  checkVehicle(dt) {
    const me = this.me, banned = me.role === 'hider' || this.cfg.transport === false;
    if (!banned || this.phase() === 'end' || this.ch.spoof) { this.vehT = 0; return; }
    this.vehT = me.speed > 7 ? (this.vehT || 0) + dt : Math.max(0, (this.vehT || 0) - dt);
    if (this.vehT > 8) {
      this.vehT = 0;
      if (me.role === 'hider') { me.exposedUntil = Math.max(me.exposedUntil, this.t + 30); this.alert('red', t('noVehicleHider'), 'run'); }
      else this.alert('yellow', t('noVehicleHunter'), 'run');
      this.vibrate([200, 100, 200]);
    }
  }

  updateStamina(p, dt) {
    if (p.role !== 'hider') { p.stamina = 100; return; }
    if (p.running) {
      p.stamina = Math.max(0, p.stamina - 7 * dt);
      if (p.stamina <= 0) {
        p.running = false;
        if (p === this.me) { this.runToggle = false; if (!this.staminaWarned) { this.staminaWarned = true; this.alert('yellow', t('stopRun'), 'run'); this.vibrate([80, 60, 80]); } }
      }
    } else {
      p.stamina = Math.min(100, p.stamina + (p.speed < 0.3 ? 9 : 5) * dt);
      if (p.stamina > 30) this.staminaWarned = false;
    }
  }

  checkZone(dt) {
    const me = this.me, zr = this.zoneR();
    const out = !this.inZone(me);
    if (out) {
      if (me.outSince == null) { me.outSince = this.t; if (me.role === 'hider') this.alert('red', t('outZone'), 'target'); }
      if (me.role === 'hider' && this.t - me.outSince > 20) {
        if (me.exposedUntil < this.t + 1) this.alert('red', t('outExposed'), 'eye');
        me.exposedUntil = this.t + 15;
      }
    } else me.outSince = null;
  }

  // ---------- ИИ ботов ----------
  botThink(p, dt, ph) {
    const zr = this.zoneR();
    if (p.role === 'hider') {
      if (!p.alive) return;
      if (this.isFrozen(p)) { p.running = false; p.speed = 0; return; }
      const threats = this.hunters().filter((h) => !(h.bot === false && ph === 'hide'));
      const near = ph === 'hunt' ? threats.map((h) => [h, dist(h, p)]).filter(([, d]) => d < 35).sort((a, b) => a[1] - b[1])[0] : null;
      p.think -= dt;
      if (near) {
        const [h, d] = near;
        const away = { x: p.x + (p.x - h.x) / d * 60, y: p.y + (p.y - h.y) / d * 60 };
        for (let k = 0; k < 12 && !this.inZone(away, 0.95); k++) { away.x *= 0.8; away.y *= 0.8; }
        p.target = away; p.flee = true;
        if (p.powerups.includes('ghost') && p.stamina > 30) this.botUse(p, 'ghost');
      } else if (p.think <= 0) {
        p.think = rnd(4, 9); p.flee = false;
        const m = this.mission;
        if (m && ph === 'hunt' && (p.holdMission || (!this.hiders().some((h) => h.holdMission) && this.nearestHiderTo(m) === p))) {
          p.holdMission = true; p.target = { x: m.x + rnd(-15, 15), y: m.y + rnd(-15, 15) };
        } else {
          p.holdMission = false;
          const sup = ph === 'hunt' && this.supplies.find((s) => dist(s, p) < 90);
          if (sup) p.target = { x: sup.x, y: sup.y };
          else if (!p.target && (ph === 'hide' || Math.random() < 0.18 || !this.inZone(p, 0.92))) p.target = this.randZone(0.85, 0.25);
        }
      }
      if (p.target) {
        const run = p.flee || (ph === 'hide' && Math.random() < 0.02) || (p.holdMission && this.mission && this.t > this.mission.deadline - 40);
        if (this.step(p, p.target, run, dt)) p.target = null;
      } else { p.running = false; p.speed = 0; }
      return;
    }
    // охотник-бот
    if (ph === 'hide') { p.speed = 0; return; }
    p.think -= dt;
    const seen = this.hiders().map((h) => [h, dist(h, p)]).filter(([h, d]) => d < 25 || this.t < h.exposedUntil || this.flareShows(h)).sort((a, b) => a[1] - b[1])[0];
    if (seen) { p.target = { x: seen[0].x, y: seen[0].y }; p.chase = true; }
    else if (p.think <= 0 || !p.target) {
      p.think = rnd(3, 6); p.chase = false;
      const m = this.mission;
      const fresh = this.prints.filter((f) => this.t - f.t < 50 && dist(f, p) < 70).sort((a, b) => b.t - a.t)[0];
      const circ = this.circles.filter((c) => this.t - c.t < 80).sort((a, b) => dist(a, p) - dist(b, p))[0];
      if (m && m.started) p.target = { x: m.x + rnd(-20, 20), y: m.y + rnd(-20, 20) };
      else if (fresh) p.target = { x: fresh.x, y: fresh.y };
      else if (circ) { const o = this.randIn(circ.r * 0.9); p.target = { x: circ.x + o.x, y: circ.y + o.y }; }
      else p.target = this.randZone(0.85);
    }
    if (this.step(p, p.target, p.chase, dt)) p.target = null;
  }

  nearestHiderTo(pt) { return this.hiders().filter((h) => h.bot).sort((a, b) => dist(a, pt) - dist(b, pt))[0]; }

  botAbilities() {
    const bots = this.hunters().filter((h) => h.bot);
    if (!bots.length) return;
    const meHunter = this.hunters().some((h) => !h.bot);
    // «Раскрытие»: если игрок охотник — ждём его 45 с после готовности
    if (this.t >= this.revealReadyAt + (meHunter ? 45 : rnd(3, 12))) this.doReveal(bots[0]);
    if (this.hasFreeze && this.t >= this.freezeReadyAt + (meHunter ? 60 : 5)) {
      const range = this.freezeRange();
      const any = this.hiders().some((h) => this.hunters().some((u) => dist(u, h) < range * 0.8));
      if (any && Math.random() < 0.05) this.doFreeze(bots[0]);
    }
  }

  freezeRange() { return Math.max(110, this.R * 0.28); }
  catchRange() { return this.ch.reach ? 250 : this.cfg.mode === 'gps' ? 30 : 18; }
  flareShows(p) { return this.flare && this.flare.shown && this.flare.pos[p.id]; }

  // ---------- способности ----------
  doReveal(by) {
    if (this.phase() !== 'hunt' || this.t < this.revealReadyAt) return;
    this.revealReadyAt = this.t + this.revealCd;
    const r = Math.min(110, Math.max(50, this.R * 0.16));
    let n = 0;
    const made = [];
    for (const h of this.hiders()) {
      if (h === this.me && this.ch.immune) continue;
      if (h.remote && h.netCh && h.netCh.i) continue;
      let miss = false;
      if (this.t < h.smokeUntil) miss = true;
      else if (h.jams > 0) { h.jams--; miss = true; }
      else if (this.t < h.silenceUntil && h.speed < 0.4) miss = true;
      if (miss) { if (h === this.me) this.alert('green', t('revealMissed'), 'shield'); continue; }
      let cx = h.x, cy = h.y;
      if (h.misdirect) { h.misdirect = false; const a = rnd(0, 6.28); cx += Math.cos(a) * 150; cy += Math.sin(a) * 150; }
      const o = this.randIn(r * 0.75);
      const c = { id: 'c' + Math.random().toString(36).slice(2, 8), x: cx + o.x, y: cy + o.y, r, t: this.t, owner: h.id };
      this.circles.push(c); made.push(c);
      this.events.push({ k: 'r', t: Math.round(this.t), x: Math.round(cx + o.x), y: Math.round(cy + o.y), r: Math.round(r), p: this.players.indexOf(h) });
      n++;
      if (h === this.me) { this.alert('red', t('revealedYou'), 'signal'); this.vibrate([200, 80, 200]); }
    }
    if (this.me.role === 'hunter') this.alert('blue', n ? t('revealSent') : t('revealNone'), 'signal');
    if (this.isHost) this.netSend('reveal', { c: made.map((c) => [c.id, Math.round(c.x), Math.round(c.y), Math.round(c.r), c.owner]), rr: this.revealReadyAt });
  }

  doFreeze(by) {
    if (!this.hasFreeze || this.phase() !== 'hunt' || this.t < this.freezeReadyAt) return;
    this.freezeReadyAt = this.t + this.freezeCd;
    const range = this.freezeRange();
    let n = 0;
    const ids = [], warded = [];
    for (const h of this.hiders()) {
      if (h === this.me && this.ch.immune) continue;
      if (h.remote && h.netCh && h.netCh.i) continue;
      if (!this.hunters().some((u) => dist(u, h) < range)) continue;
      if (h.wards > 0) { h.wards--; warded.push(h.id); if (h === this.me) this.alert('green', t('wardSaved'), 'shield'); continue; }
      h.warnUntil = this.t + 8; h.frozenUntil = this.t + 8 + 25; n++; ids.push(h.id);
      if (h === this.me) { h.frozenDrift = 0; h.frozenPenalty = false; this.runToggle = false; this.vibrate([300, 100, 300]); }
    }
    if (n) this.events.push({ k: 'f', t: Math.round(this.t), n });
    if (this.me.role === 'hunter') this.alert('blue', n ? t('freezeSent', { n }) : t('freezeNone'), 'snow');
    if (this.isHost) this.netSend('freeze', { ids, warded, wu: this.t + 8, fu: this.t + 33, fr: this.freezeReadyAt });
  }

  catchPlayer(hunter, h, fromNet) {
    if (h.role !== 'hider') return;
    if (this.isHost && !fromNet) this.netSend('caught', { a: hunter.id, b: h.id });
    h.caughtAt = this.t; h.caughtBy = hunter.name; hunter.catches = (hunter.catches || 0) + 1;
    this.events.push({ k: 'c', t: Math.round(this.t), a: this.players.indexOf(hunter), b: this.players.indexOf(h), x: Math.round(h.x), y: Math.round(h.y) });
    h.wasCaught = true; h.role = 'hunter'; h.running = false; h.target = null; h.holdMission = false;
    h.frozenUntil = 0; h.warnUntil = 0;
    if (hunter === this.me) { this.stats.caught++; this.alert('green', t('youCaughtX', { b: h.name }), 'target'); }
    else if (h === this.me) { this.stats.timesCaught++; this.alert('red', t('youCaught'), 'target'); this.vibrate([400]); this.trayOpen = false; }
    else this.alert('red', t('caughtBy', { a: hunter.name, b: h.name }), 'target');
    this.renderHud(true);
  }

  checkCatches() {
    const cr = this.cfg.mode === 'gps' ? 12 : 9;
    for (const u of this.hunters()) {
      if (!u.bot) continue;
      for (const h of this.hiders()) if (dist(u, h) < cr && !(h === this.me && this.ch.untouch) && !(h.remote && h.netCh && h.netCh.u)) this.catchPlayer(u, h);
    }
  }

  checkSupplies() {
    if (!this.hasPowerups) return;
    for (const s of [...this.supplies]) {
      for (const p of this.players) {
        if (dist(p, s) > ((p === this.me && this.ch.magnet) || (p.remote && p.netCh && p.netCh.m) ? 90 : 18)) continue;
        const pool = this.enabledPw.map(pwById).filter((x) => x && (x.side === 'both' || x.side === p.role));
        if (!pool.length) break;
        const pw = pool[Math.floor(Math.random() * pool.length)];
        this.supplies = this.supplies.filter((x) => x !== s);
        setTimeout(() => { if (!this.ended) this.supplies.push(this.newSupply()); }, 45000);
        if (p === this.me) { this.stats.supplies++; this.me.powerups.push(pw.id); this.alert('green', t('pickedUp', { p: pwName(pw) }), 'supply'); this.vibrate([60]); this.renderHud(true); }
        else if (p.remote) this.netSend('picked', { by: p.id, pw: pw.id });
        else this.botGain(p, pw.id);
        break;
      }
    }
  }

  botGain(p, id) {
    if (['ward', 'jam', 'revealBoost', 'freezeBoost'].includes(id)) this.botUse(p, id, true);
    else if (['ghost', 'smoke'].includes(id)) p.powerups.push(id);
  }
  botUse(p, id, direct) {
    if (!direct) { const i = p.powerups.indexOf(id); if (i < 0) return; p.powerups.splice(i, 1); }
    this.applyPower(p, id);
  }

  applyPower(p, id) {
    const T = this.t;
    switch (id) {
      case 'revealBoost': this.revealReadyAt = Math.max(T, this.revealReadyAt - this.revealCd / 2); break;
      case 'freezeBoost': this.freezeReadyAt = Math.max(T, this.freezeReadyAt - this.freezeCd / 2); break;
      case 'ghost': p.ghostUntil = T + 60; break;
      case 'ward': p.wards++; break;
      case 'lookout': if (p === this.me) { this.showHuntersUntil = T + 20; this.alert('blue', t('lookoutOn', { s: 20 }), 'eye'); } break;
      case 'decoy': {
        let s = this.randZone(0.8); const a = rnd(0, 6.28);
        for (let i = 0; i < 10; i++) { s = { x: s.x + Math.cos(a) * 12, y: s.y + Math.sin(a) * 12 }; this.addPrint({ x: s.x, y: s.y, a: 90 - a * 180 / Math.PI, owner: 'decoy' }); }
        if (p === this.me) this.alert('green', t('decoyOn'), 'copy');
        break;
      }
      case 'smoke': p.smokeUntil = T + 60; break;
      case 'silence': p.silenceUntil = T + 90; break;
      case 'jam': p.jams++; break;
      case 'misdirect': p.misdirect = true; break;
      case 'flare': {
        const pos = {}; this.players.forEach((q) => { pos[q.id] = { x: q.x, y: q.y, role: q.role, name: q.name }; });
        this.flare = { at: T + 10, pos, shown: false };
        this.alert('blue', t('flareFired'), 'flare');
        if (this.isHost) this.netSend('flare', { at: T + 10, pos });
        break;
      }
    }
  }

  usePower(id) {
    const i = this.me.powerups.indexOf(id);
    if (i < 0) return;
    const pw = pwById(id);
    if (id === 'scan') {
      this.opts.modal(`<h2>${t('scanPick')}</h2><div class="opts c3" style="margin-top:12px">${[100, 200, 300].map((d) => `<button class="opt" data-d="${d}"><span class="t">${d} ${t('m')}</span></button>`).join('')}</div>`, (box, close) => {
        box.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => {
          const d = +b.dataset.d;
          const other = this.me.role === 'hunter' ? this.hiders() : this.hunters().filter((x) => x !== this.me);
          const n = other.filter((o) => dist(o, this.me) <= d).length;
          this.me.powerups.splice(this.me.powerups.indexOf(id), 1); this.stats.powers++;
          close(); this.alert('blue', t('scanRes', { d, n }), 'scan'); this.renderHud(true);
        });
      });
      return;
    }
    this.me.powerups.splice(i, 1);
    this.stats.powers++;
    if (this.isClient && id === 'flare') { this.netSend('power', { id }); this.renderHud(true); return; }
    this.applyPower(this.me, id);
    if (this.isClient && ['revealBoost', 'freezeBoost', 'ward', 'jam', 'smoke', 'silence', 'misdirect', 'ghost'].includes(id)) this.netSend('power', { id });
    if (!['lookout', 'decoy', 'flare'].includes(id)) this.alert('green', t('usedPw', { p: pwName(pw) }), pw.icon);
    this.renderHud(true);
  }

  // ---------- задания ----------
  updateMission(dt) {
    if (!this.mission && this.t >= this.nextMissionAt) {
      const pt = this.randZone(0.75, 0.15);
      this.mission = { ...pt, r: 50, deadline: this.t + 150, need: 60, progress: 0, started: false };
      this.events.push({ k: 'm', t: Math.round(this.t), x: Math.round(pt.x), y: Math.round(pt.y), r: 50 });
      this.netSend('mnew', {});
      if (this.me.role === 'hider') this.alert('yellow', t('missionNew'), 'diamond');
      this.renderHud(true);
    }
    const m = this.mission;
    if (!m) return;
    const inside = this.hiders().filter((h) => dist(h, m) <= m.r);
    if (inside.length) {
      if (!m.started) {
        m.started = true;
        this.netSend('mheld', {});
        if (this.me.role === 'hunter') this.alert('yellow', t('missionSeen'), 'diamond');
        else this.alert('yellow', t('missionHeld'), 'diamond');
      }
      m.progress += dt;
      if (m.progress >= m.need) {
        const rewards = {};
        for (const h of inside) {
          const pool = this.enabledPw.map(pwById).filter((x) => x && x.side !== 'hunter');
          for (let k = 0; k < 2 && pool.length; k++) {
            const id = pool[Math.floor(Math.random() * pool.length)].id;
            if (h === this.me) this.me.powerups.push(id); else if (h.remote) (rewards[h.id] = rewards[h.id] || []).push(id); else this.botGain(h, id);
          }
          if (h === this.me) this.stats.missions++;
        }
        if (this.me.role === 'hider') this.alert('green', t('missionDone'), 'trophy');
        this.hiders().forEach((h) => h.holdMission = false);
        this.events.push({ k: 'md', t: Math.round(this.t) });
        this.netSend('mdone', { rw: rewards });
        this.mission = null; this.nextMissionAt = this.t + 90; this.renderHud(true);
        return;
      }
    } else if (this.t > m.deadline) {
      for (const h of this.hiders()) h.exposedUntil = this.t + 60;
      this.alert('red', this.me.role === 'hider' ? t('missionFail') : t('exposedAll'), 'eye');
      this.hiders().forEach((h) => h.holdMission = false);
      this.events.push({ k: 'mf', t: Math.round(this.t) });
      this.netSend('mfail', { until: this.t + 60 });
      this.mission = null; this.nextMissionAt = this.t + 90; this.renderHud(true);
    }
  }

  // ---------- оповещения ----------
  alert(kind, text, icon) {
    this.alerts = this.alerts.filter((a) => a.text !== text);
    this.alerts.push({ kind, text, icon, until: this.t + 6 });
    if (this.alerts.length > 2) this.alerts.shift();
    this.alertsDirty = true;
    beep(kind);
  }
  vibrate(p) {
    try { if (navigator.vibrate && navigator.vibrate(p)) return; } catch {}
    try { window.MapTagNative && window.MapTagNative.vibrate(Array.isArray(p) ? p.reduce((a, b) => a + b, 0) : p); } catch {}
  }

  // ---------- конец ----------
  finish(winner) {
    if (this.ended) return;
    this.ended = true;
    clearInterval(this.timer);
    const me = this.me;
    const won = (winner === 'hiders' && me.role === 'hider') || (winner === 'hunters' && me.role === 'hunter');
    const result = {
      winner, won, role: me.role, startRole: me.startRole, survivors: this.hiders().length,
      duration: Math.round(this.t), stats: { ...this.stats }, mode: this.cfg.mode,
      replay: { center: this.c0, R: this.R, track: this.track, date: Date.now(), name: me.name },
      players: this.players.map((p) => ({ name: p.name, me: p === me, bot: p.bot, startRole: p.startRole || (p.wasCaught ? 'hider' : p.role), role: p.role, caughtAt: p.caughtAt != null ? Math.round(p.caughtAt) : null, caughtBy: p.caughtBy || null, catches: p.catches || 0, color: p === me ? '#ffffff' : p.color })),
    };
    // полный повтор: кадры всех игроков, события, геометрия зоны
    const last = [Math.round(this.t)]; for (const p of this.players) last.push(Math.round(p.x), Math.round(p.y), p.role === 'hunter' ? 1 : 0);
    this.frames.push(last);
    result.replay.rec = {
      v: 1, frames: this.frames, events: this.events, players: result.players.map((p) => ({ n: p.name, c: p.color, me: p.me })),
      poly: this.poly ? this.poly.map((q) => [Math.round(q.x), Math.round(q.y)]) : null,
      hideSec: this.cfg.hideSec, huntSec: this.cfg.huntSec, shrinkTo: this.cfg.shrinkTo, winner,
    };
    if (this.isHost) this.netSend('end', { w: winner, res: this.players.map((p) => ({ id: p.id, caughtAt: p.caughtAt != null ? Math.round(p.caughtAt) : null, caughtBy: p.caughtBy || null, catches: p.catches || 0 })) });
    this.opts.onEnd(result);
  }

  // ---------- отрисовка ----------
  meIcon() {
    const c = this.me.role === 'hunter' ? '#f26d7d' : '#5fd38d';
    return L.divIcon({ className: '', iconSize: [22, 22], iconAnchor: [11, 11], html: `<div class="mk-me" style="background:${c}"></div>` });
  }

  render() {
    const me = this.me, T = this.t, map = this.map;
    if (this.poly) this.zoneLayer.setLatLngs(this.zoneLatLngs()); else this.zoneLayer.setRadius(this.zoneR());
    this.meMarker.setLatLng(this.ll(me));
    if (this.meRole !== me.role) { this.meRole = me.role; this.meMarker.setIcon(this.meIcon()); }
    if (this.follow && this.cfg.mode === 'gps') map.panTo(this.ll(me), { animate: false });

    // кого видно
    const vis = new Set();
    for (const p of this.players) {
      if (p === me) continue;
      const d = dist(p, me);
      let show = false;
      if (me.role === 'hunter') show = p.role === 'hunter' || d < 25 || T < p.exposedUntil;
      else show = p.role === 'hider' || d < 40 || T < this.showHuntersUntil;
      if (show || this.ch.wall) vis.add(p.id);
    }
    for (const p of this.players) {
      if (p === me) continue;
      let m = this.layers.players.get(p.id);
      if (vis.has(p.id)) {
        const col = p.role === 'hunter' ? '#f26d7d' : p.color;
        const key = p.role + (T < p.frozenUntil ? 'f' : '');
        if (!m) { m = L.marker(this.ll(p), { interactive: false }).addTo(map); this.layers.players.set(p.id, m); }
        if (m._key !== key) { m._key = key; m.setIcon(L.divIcon({ className: '', iconSize: [20, 20], iconAnchor: [10, 10], html: `<div class="mk"><div class="mk-pl" style="background:${col}${T < p.frozenUntil && T >= p.warnUntil ? ';box-shadow:0 0 0 5px rgba(140,190,255,.6)' : ''}"></div><div class="mk-name">${esc(p.name)}</div></div>` })); }
        m.setLatLng(this.ll(p));
      } else if (m) { m.remove(); this.layers.players.delete(p.id); }
    }

    // круги «Раскрытия» и следы — только охотникам
    const huntView = me.role === 'hunter' || this.ch.wall;
    const cIds = new Set(huntView ? this.circles.map((c) => c.id) : []);
    for (const [id, l] of this.layers.circles) if (!cIds.has(id)) { l.remove(); this.layers.circles.delete(id); }
    if (huntView) for (const c of this.circles) {
      let l = this.layers.circles.get(c.id);
      const op = Math.max(0.15, 1 - (T - c.t) / 90);
      if (!l) { l = L.circle(this.ll(c), { radius: c.r, color: '#b8323f', weight: 3, fillColor: '#dc505a', fillOpacity: 0.22, interactive: false }).addTo(map); this.layers.circles.set(c.id, l); }
      l.setStyle({ opacity: op, fillOpacity: 0.22 * op });
    }
    const fIds = new Set(huntView ? this.prints.map((f) => f.id) : []);
    for (const [id, l] of this.layers.prints) if (!fIds.has(id)) { l.remove(); this.layers.prints.delete(id); }
    if (huntView) for (const f of this.prints) {
      if (this.layers.prints.has(f.id)) { this.layers.prints.get(f.id).setOpacity(Math.max(0.2, 1 - (T - f.t) / 120)); continue; }
      const l = L.marker(this.ll(f), { interactive: false, icon: L.divIcon({ className: '', iconSize: [9, 14], iconAnchor: [4, 7], html: `<div class="mk-foot" style="transform:rotate(${f.a}deg)"></div>` }) }).addTo(map);
      this.layers.prints.set(f.id, l);
    }

    // тайники
    const sIds = new Set(this.supplies.map((s) => s.id));
    for (const [id, l] of this.layers.supplies) if (!sIds.has(id)) { l.remove(); this.layers.supplies.delete(id); }
    for (const s of this.supplies) if (!this.layers.supplies.has(s.id)) {
      this.layers.supplies.set(s.id, L.marker(this.ll(s), { interactive: false, icon: L.divIcon({ className: '', iconSize: [22, 22], iconAnchor: [11, 11], html: '<div class="mk-dia"></div>' }) }).addTo(map));
    }

    // задание
    const m = this.mission;
    if (m) {
      if (!this.misLayer || this.misLayer._m !== m) {
        this.clearMission();
        this.misLayer = L.circle(this.ll(m), { radius: m.r, color: '#e8b52a', weight: 4, fillColor: '#f3c13a', fillOpacity: 0.18, interactive: false }).addTo(map);
        this.misLayer._m = m;
        this.misMark = L.marker(this.ll(m), { interactive: false }).addTo(map);
      }
      const held = m.started;
      const key = held ? 'h' + Math.ceil(m.need - m.progress) : 'o';
      if (this.misMark._key !== key) {
        this.misMark._key = key;
        this.misMark.setIcon(held
          ? L.divIcon({ className: '', iconSize: [44, 44], iconAnchor: [22, 22], html: `<div class="mk-hold">${Math.ceil(m.need - m.progress)}</div>` })
          : L.divIcon({ className: '', iconSize: [24, 24], iconAnchor: [12, 12], html: '<div class="mk"><div class="mk-mis"></div><div class="mk-x2">×2</div></div>' }));
      }
    } else this.clearMission();

    // ракета
    this.layers.flare.forEach((l) => l.remove()); this.layers.flare = [];
    if (this.flare && this.flare.shown) for (const id in this.flare.pos) {
      if (id === this.me.id) continue;
      const q = this.flare.pos[id];
      this.layers.flare.push(L.marker(this.ll(q), { interactive: false, icon: L.divIcon({ className: '', iconSize: [18, 18], iconAnchor: [9, 9], html: `<div class="mk"><div class="mk-ghost" style="border-color:${q.role === 'hunter' ? '#f26d7d' : '#5fd38d'}"></div><div class="mk-name">${esc(q.name)}</div></div>` }) }).addTo(map));
    }

    this.renderHud(false);
  }

  clearMission() { if (this.misLayer) { this.misLayer.remove(); this.misMark.remove(); this.misLayer = null; this.misMark = null; } }

  // ---------- HUD ----------
  renderHud(full) {
    const top = this.root.querySelector('#hudTop'), bot = this.root.querySelector('#hudBot'), cover = this.root.querySelector('#cover');
    const me = this.me, T = this.t, ph = this.phase();
    const hunter = me.role === 'hunter';

    // верхняя панель
    let gameK, gameV;
    if (ph === 'hide') { gameK = t('hideTime'); gameV = fmt(this.cfg.hideSec - T); }
    else { gameK = t('game'); gameV = fmt(this.cfg.hideSec + this.cfg.huntSec - T); }
    let msK = t('nextMission'), msV = '—', idle = true;
    const m = this.mission;
    if (m && !m.started) { msK = t('enterBy'); msV = fmt(m.deadline - T); idle = false; }
    else if (m && m.started) { msK = t('holding'); msV = fmt(m.need - m.progress); idle = false; }
    else if (this.nextMissionAt < Infinity && ph === 'hunt') { msV = fmt(this.nextMissionAt - T); idle = false; }

    const alive = this.hiders().length, hcount = this.hunters().length;
    const frozenNow = this.isFrozen(me), warnNow = T < me.warnUntil && T < me.frozenUntil;
    const sig = [full, this.alertsDirty, this.moreOpen, frozenNow, warnNow, me.role, this.cfg.mode, alive].join('|');
    if (full || sig !== this.topSig) {
      this.topSig = sig; this.alertsDirty = false;
      top.innerHTML = `
        <div class="hud-bar">
          <button class="hb" data-a="fit" aria-label="zone">${I.north}</button>
          <button class="hb" data-a="me" aria-label="me">${I.locate}</button>
          <button class="hb" data-a="help" aria-label="help">${I.help}</button>
          <div class="sep"></div>
          <div class="tm" data-a="secret"><div class="k" id="gK"></div><div class="v" id="gV"></div></div>
          <div class="sep"></div>
          <div class="tm ms" id="msBox"><div class="k">${I.diamond.replace('<svg', '<svg width="12" height="12"')}<span id="mK"></span></div><div class="v" id="mV"></div></div>
          <div class="sep"></div>
          <button class="hb" data-a="more">${this.moreOpen ? I.chevU : I.chevD}</button>
        </div>
        ${this.moreOpen ? `<div class="hud-more">
          <div class="line-row"><span>${t('role')}</span><b style="color:${hunter ? 'var(--hunter)' : 'var(--hider)'}">${hunter ? t('hunter') : t('hider')}</b></div>
          <div class="line-row"><span>${t('alive')}</span><b>${t('hider')}: ${alive} · ${t('hunters')}: ${hcount}</b></div>
          <div class="line-row"><span>${t('zoneR')}</span><b id="zR"></b></div>
          <div class="line-row"><span>${t('moveMode')}</span><div class="seg"><button data-a="gps" class="${this.cfg.mode === 'gps' ? 'on' : ''}">${t('gps')}</button><button data-a="demo" class="${this.cfg.mode === 'demo' ? 'on' : ''}">${t('demo')}</button></div></div>
          ${this.opts.cheatsUnlocked && this.opts.cheatsUnlocked() ? `<button class="btn block" data-a="cheats" style="color:var(--hunter)">${I.lock}${t('cheats')}</button>` : ''}
          <button class="btn danger block" data-a="leave">${I.leave}${t('leaveGame')}</button>
        </div>` : ''}
        ${warnNow ? `<div class="frozen warn"><div><div class="t1">${t('freezeWarn')}</div><div class="t2">${t('freezeWarnS')}</div></div><div class="num" id="fzN"></div></div>` : ''}
        ${frozenNow ? `<div class="frozen"><div><div class="t1">${t('frozenT')}</div><div class="t2">${t('frozenS')}</div></div><div class="num" id="fzN"></div></div>` : ''}
        ${this.alerts.map((a) => `<div class="banner ${a.kind}"><div class="bi">${I[a.icon] || I.signal}</div><div>${esc(a.text)}</div></div>`).join('')}
      `;
      top.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => this.hudAction(b.dataset.a));
    }
    top.querySelector('#gK').textContent = gameK;
    top.querySelector('#gV').textContent = gameV;
    top.querySelector('#mK').textContent = msK;
    top.querySelector('#mV').textContent = msV;
    top.querySelector('#msBox').classList.toggle('idle', idle);
    const zr = top.querySelector('#zR'); if (zr) zr.textContent = Math.round(this.zoneR()) + ' ' + t('m');
    const fz = top.querySelector('#fzN'); if (fz) fz.textContent = Math.ceil(warnNow ? me.warnUntil - T : me.frozenUntil - T);

    // ожидание охотника
    if (hunter && ph === 'hide') {
      if (!cover.querySelector('#wBig')) cover.innerHTML = `<div class="wait-cover"><div><div style="font-size:20px">${t('huntStartsIn')}</div><div class="big" id="wBig"></div><div style="color:#c8d1e0;max-width:280px">${t('waitHint')}</div></div></div>`;
      cover.querySelector('#wBig').textContent = fmt(this.cfg.hideSec - T);
    } else if (cover.firstChild) cover.innerHTML = '';

    // нижняя панель
    const rLeft = this.revealReadyAt - T, fLeft = this.freezeReadyAt - T;
    const bsig = [full, me.role, this.trayOpen, me.powerups.join(), this.cfg.mode, this.runToggle, ph, this.hasFreeze, !!this.ch.spoof].join('|');
    if (full || bsig !== this.botSig) {
      this.botSig = bsig;
      const counts = {}; me.powerups.forEach((id) => counts[id] = (counts[id] || 0) + 1);
      const tray = this.trayOpen && me.powerups.length ? `<div class="tray">${Object.keys(counts).map((id) => { const p = pwById(id); return `<button class="pw" data-pw="${id}">${counts[id] > 1 ? `<span class="x">×${counts[id]}</span>` : ''}${I[p.icon]}${esc(pwName(p))}</button>`; }).join('')}</div>` : '';
      const side = this.hasPowerups ? `<div class="side-col"><button class="sq" data-a="tray" style="color:var(--supply)">${I.bolt}${me.powerups.length ? `<span class="cnt">${me.powerups.length}</span>` : ''}</button><button class="sq" data-a="tray">${this.trayOpen ? I.chevD : I.chevU}</button></div>` : '';
      if (hunter) {
        bot.innerHTML = `${this.ch.spoof ? `<div class="demo-hint">${t('spoofHint')}</div>` : ''}${tray}<div class="act-row">${side}
          <button class="ab reveal" data-a="reveal">${I.signal}<span class="t">${t('reveal')}</span><span class="s" id="rS"></span></button>
          ${this.hasFreeze ? `<button class="ab freeze" data-a="freeze">${I.snow}<span class="t">${t('freeze')}</span><span class="s" id="fS"></span></button>` : ''}
          <button class="ab catch" data-a="catch">${I.crosshair}<span class="t">${t('catch')}</span><span class="s">${t('choosePlayer')}</span></button>
        </div>`;
      } else {
        bot.innerHTML = `${this.cfg.mode === 'demo' || this.ch.spoof ? `<div class="demo-hint">${this.ch.spoof ? t('spoofHint') : t('demoTap')}</div>` : ''}${tray}
          <div class="stamina" id="stBox"><span>${t('stamina')}</span><div class="bar"><i id="stBar"></i></div></div>
          <div class="act-row">${side}
            ${this.cfg.mode === 'demo'
              ? `<button class="ab run ${this.runToggle ? 'on' : ''}" data-a="run">${I.run}<span class="t">${this.runToggle ? t('run') : t('walk')}</span><span class="s">${this.runToggle ? t('walk') + ' ↔' : t('run') + ' ↔'}</span></button>`
              : `<div class="ab run" id="runInfo">${I.run}<span class="t" id="runT"></span></div>`}
          </div>`;
      }
      bot.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => this.hudAction(b.dataset.a));
      bot.querySelectorAll('[data-pw]').forEach((b) => b.onclick = () => this.pwModal(b.dataset.pw));
    }
    const rS = bot.querySelector('#rS');
    if (rS) { const ok = ph === 'hunt' && (rLeft <= 0 || this.ch.nocd); rS.textContent = ok ? t('ready') : fmt(ph === 'hide' ? this.cfg.hideSec - T : rLeft); rS.parentElement.classList.toggle('wait', !ok); }
    const fS = bot.querySelector('#fS');
    if (fS) { const ok = ph === 'hunt' && (fLeft <= 0 || this.ch.nocd); fS.textContent = ok ? t('ready') : fmt(ph === 'hide' ? this.freezeReadyAt - T : fLeft); fS.parentElement.classList.toggle('wait', !ok); }
    const st = bot.querySelector('#stBar');
    if (st) { st.style.width = me.stamina + '%'; bot.querySelector('#stBox').classList.toggle('low', me.stamina < 25); }
    const rt = bot.querySelector('#runT'); if (rt) rt.textContent = me.running ? t('run') : t('walk');
  }

  hudAction(a) {
    const me = this.me;
    switch (a) {
      case 'fit': this.map.fitBounds(this.zoneLayer.getBounds(), { padding: [20, 20] }); this.follow = false; break;
      case 'me': this.follow = true; this.map.setView(this.ll(me), Math.max(this.map.getZoom(), 17)); break;
      case 'help': this.opts.openRules(); break;
      case 'more': this.moreOpen = !this.moreOpen; this.renderHud(true); break;
      case 'gps': if (this.cfg.mode !== 'gps') { this.cfg.mode = 'gps'; this.pace = 1; this.gpsPrev = null; this.startGps(); this.renderHud(true); } break;
      case 'demo': if (this.cfg.mode !== 'demo') this.switchDemo(); break;
      case 'secret': {
        const now = Date.now();
        this.secTaps = now - (this.secLast || 0) < 1500 ? (this.secTaps || 0) + 1 : 1; this.secLast = now;
        if (this.secTaps >= 5) { this.secTaps = 0; this.opts.openCheats(); }
        break;
      }
      case 'cheats': this.opts.openCheats(); break;
      case 'leave': this.opts.confirm(t('leaveConfirm'), () => { this.netSend(this.isHost ? 'abort' : 'bye', {}); this.ended = true; this.opts.onLeave(); }); break;
      case 'tray': this.trayOpen = !this.trayOpen; this.renderHud(true); break;
      case 'run': this.runToggle = !this.runToggle; this.renderHud(true); break;
      case 'reveal': if (this.phase() === 'hunt' && (this.t >= this.revealReadyAt || this.ch.nocd)) { if (this.isClient) { this.netSend('req', { k: 'reveal' }); break; } if (this.ch.nocd) this.revealReadyAt = this.t; this.doReveal(me); } break;
      case 'freeze': if (this.phase() === 'hunt' && (this.t >= this.freezeReadyAt || this.ch.nocd)) { if (this.isClient) { this.netSend('req', { k: 'freeze' }); break; } if (this.ch.nocd) this.freezeReadyAt = this.t; this.doFreeze(me); } break;
      case 'catch': this.catchModal(); break;
    }
  }

  catchModal() {
    if (this.phase() !== 'hunt') return;
    const cr = this.catchRange();
    const list = this.hiders().map((h) => [h, dist(h, this.me)]).sort((a, b) => a[1] - b[1]);
    const anyNear = list.some(([, d]) => d <= cr);
    this.opts.modal(`<h2>${t('catchWho')}</h2>
      ${anyNear ? '' : `<p style="color:var(--muted)">${t('nobodyNear', { d: cr })}</p>`}
      <div class="player-list">${list.filter(([, d]) => d <= cr).map(([h, d]) => `<button class="player" data-id="${h.id}" style="cursor:pointer;text-align:left"><div class="av" style="background:${h.color}">${esc(h.name[0])}</div><div class="nm">${esc(h.name)}</div><div class="tag">${t('far', { d: Math.round(d) })}</div></button>`).join('')}</div>
      <button class="btn block" data-x style="margin-top:16px">${t('cancel')}</button>`, (box, close) => {
      box.querySelector('[data-x]').onclick = close;
      box.querySelectorAll('[data-id]').forEach((b) => b.onclick = () => {
        const h = this.players.find((p) => p.id === b.dataset.id);
        close();
        if (h && h.role === 'hider') { if (this.isClient) this.netSend('req', { k: 'catch', h: h.id, r: !!this.ch.reach }); else this.catchPlayer(this.me, h); }
      });
    });
  }

  pwModal(id) {
    const p = pwById(id);
    this.opts.modal(`<div class="pw-item" style="border:0;padding:0;background:none"><div class="pw-ico ${p.cls}">${I[p.icon]}</div><div><h3>${esc(pwName(p))}</h3><p>${esc(pwDesc(p))}</p></div></div>
      <div class="row" style="margin-top:18px"><button class="btn" data-x style="flex:1">${t('cancel')}</button><button class="btn primary" data-u style="flex:1">${t('use')}</button></div>`, (box, close) => {
      box.querySelector('[data-x]').onclick = close;
      box.querySelector('[data-u]').onclick = () => { close(); this.usePower(id); };
    });
  }
}

Object.assign(Game.prototype, netMixin);

export { fmt };
