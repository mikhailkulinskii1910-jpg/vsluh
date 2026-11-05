// Ядро симуляции: колония мух с мозгом из подсети FlyWire в большом мире.
// Не зависит от DOM: работает в браузере, в Web Worker и в Node.

export const CONFIG = {
  // нейроны
  decay: 0.85,          // утечка мембраны за шаг
  threshold: 0.6,       // порог возбуждения
  refractory: 2,        // шагов без спайков после разряда
  weightScale: 0.3,     // вес синапса = min(число синапсов, maxSyn) * weightScale
  maxSyn: 20,
  noise: 0.01,          // фоновый шум на каждый нейрон
  // входы мозга
  odorGain: 0.6,        // обонятельный вход
  contactGain: 0.8,     // механосенсорный вход от стен, камней и стеблей
  hungerGain: 0.15,     // голод усиливает обонятельный вход
  predatorGain: 0.9,    // механосенсорный вход от потока воздуха от стрекозы
  predatorSense: 1.2,   // радиус, на котором муха чувствует стрекозу
  // моторы и полёт
  motorSpeed: 3.0,      // скорость полёта на единицу активности моторных нейронов
  motorTurn: 3.0,       // сила поворота на единицу разницы активности L и R
  saccadeThreshold: 0.6,// накопленный поворот, после которого муха делает саккаду
  saccadeAngle: 1.6,    // максимальный угол саккады, рад
  saccadeTime: 0.08,    // длительность саккады, с
  landRadius: 0.22,     // на каком расстоянии от фрукта муха садится
  escapeThreshold: 0.45,// сила сигнала угрозы, запускающая рефлекс бегства
  escapeSpeed: 2.4,
  escapeTime: 0.35,
  nightActivity: 0.2,   // доля дневной активности ночью
  // врождённые рефлексы поиска еды по запаху (по данным о поведении дрозофилы;
  // этих цепей нет в подсети, поэтому они заданы правилами и их можно выключить)
  reflexes: 1,          // 1 — включены, 0 — муха управляется только коннектомом
  odorDetect: 0.03,     // порог, с которого муха замечает запах
  tropoGain: 2.5,       // поворот к антенне, где запах сильнее
  surgeGain: 3.0,       // разворот против ветра, пока запах чувствуется
  castTime: 3.0,        // сколько секунд муха прочёсывает поперёк ветра после потери шлейфа
  approachDist: 0.9,    // с какого расстояния муха видит фрукт и подлетает к нему
  // энергия и еда
  energyMax: 100,
  energyDrain: 0.35,    // расход в полёте без движения, ед./с
  moveCost: 0.5,        // дополнительный расход на скорость 1, ед./с
  feedRate: 22,         // сколько энергии муха получает за секунду еды
  foodAmount: 70,       // средний запас фрукта
  foodRegrow: 14,       // через сколько секунд вырастает новый фрукт
  foodCount: 24,
  // запах и ветер
  plumeSpread: 0.25,    // ширина шлейфа у источника
  plumeGrowth: 0.3,     // расширение шлейфа на единицу расстояния по ветру
  plumeLength: 3.5,     // затухание шлейфа по ветру
  odorNear: 0.4,        // радиус запаха против ветра
  windSpeed: 0.35,
  antennaOffset: 0.1,
  // мир
  arenaHalf: 5.0,
  arenaTop: 2.5,
  stoneCount: 12,
  plantCount: 7,
  dayLength: 150,       // секунд на полные сутки
  // хищник (стрекоза)
  predatorSpeed: 0.6,
  predatorChaseSpeed: 1.25,
  predatorChase: 1.6,
  predatorKill: 0.2,
  predatorRest: 12,     // после поимки стрекоза сыта и не охотится
  // колония
  flyCount: 1,
};

// Детерминированный генератор случайных чисел (mulberry32).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (x) => x * x * (3 - 2 * x);
const TAU = Math.PI * 2;

// ---- структура сети ---------------------------------------------------------
// Связи раскладываются по источнику (CSR): на каждом шаге обходятся только связи
// нейронов, которые разрядились. Структура общая для всех мух одного режима.
const structureCache = new WeakMap();

export function getStructure(data, mode) {
  let byMode = structureCache.get(data);
  if (!byMode) { byMode = new Map(); structureCache.set(data, byMode); }
  if (byMode.has(mode)) return byMode.get(mode);

  const N = data.ids.length;
  const E = data.src.length;
  const src = data.src;
  const dst = Int32Array.from(data.dst);
  if (mode === 'random') {
    // контроль: цели связей перемешаны, источники и веса сохранены
    const rng = mulberry32(777);
    for (let i = E - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = dst[i]; dst[i] = dst[j]; dst[j] = t;
    }
  }
  const off = new Int32Array(N + 1);
  for (let e = 0; e < E; e++) off[src[e] + 1]++;
  for (let i = 0; i < N; i++) off[i + 1] += off[i];
  const fill = off.slice(0, N);
  const tgt = new Int32Array(E);
  const edge = new Int32Array(E);
  for (let e = 0; e < E; e++) {
    const k = fill[src[e]]++;
    tgt[k] = dst[e];
    edge[k] = e;
  }
  const pick = (group, side) => {
    const out = [];
    for (let i = 0; i < N; i++) if (data.group[i] === group && data.side[i] === side) out.push(i);
    return Int32Array.from(out);
  };
  // group: 0 olfactory, 1 mechanosensory, 2 motor, 3 hidden; side: 0 left, 1 right
  const groups = {
    olfL: pick(0, 0), olfR: pick(0, 1),
    mechL: pick(1, 0), mechR: pick(1, 1),
    motL: pick(2, 0), motR: pick(2, 1),
  };
  const net = { N, off, tgt, edge, groups };
  byMode.set(mode, net);
  return net;
}

// ---- мозг одной мухи ---------------------------------------------------------
export class Brain {
  constructor(data, net, cfg) {
    this.data = data;
    this.net = net;
    const N = net.N;
    this.w = new Float32Array(net.tgt.length);
    this.I = new Float32Array(N);
    this.v = new Float32Array(N);
    this.spike = new Uint8Array(N);
    this.refr = new Uint8Array(N);
    this.rate = new Float32Array(N);
    this.active = new Int32Array(N);
    this.nActive = 0;
    this.setConfig(cfg);
  }

  setConfig(cfg) {
    this.cfg = cfg;
    const { data, net, w } = this;
    for (let k = 0; k < w.length; k++) {
      const e = net.edge[k];
      w[k] = (data.inhibitory[e] ? -1 : 1) * Math.min(data.syn[e], cfg.maxSyn) * cfg.weightScale;
    }
  }

  reset() {
    this.v.fill(0); this.spike.fill(0); this.refr.fill(0); this.rate.fill(0);
    this.nActive = 0;
  }

  // inp: сила входа для обонятельных и механосенсорных групп слева и справа
  step(inp, rng) {
    const { net, I, v, spike, refr, rate, w, cfg, active } = this;
    const { off, tgt, N, groups } = net;
    I.fill(0);
    for (let a = 0; a < this.nActive; a++) {
      const i = active[a];
      for (let k = off[i], end = off[i + 1]; k < end; k++) I[tgt[k]] += w[k];
    }
    for (const i of groups.olfL) I[i] += inp.olfL;
    for (const i of groups.olfR) I[i] += inp.olfR;
    for (const i of groups.mechL) I[i] += inp.mechL;
    for (const i of groups.mechR) I[i] += inp.mechR;
    let n = 0;
    const { decay, threshold, refractory, noise } = cfg;
    for (let i = 0; i < N; i++) {
      I[i] += noise * rng();
      if (refr[i] > 0) {
        refr[i]--;
        spike[i] = 0;
      } else {
        v[i] = v[i] * decay + I[i];
        if (v[i] >= threshold) {
          spike[i] = 1; v[i] = 0; refr[i] = refractory; active[n++] = i;
        } else {
          spike[i] = 0;
        }
      }
      rate[i] = rate[i] * 0.95 + 0.05 * spike[i];
    }
    this.nActive = n;
  }

  meanRate(arr) {
    if (!arr.length) return 0;
    let s = 0;
    for (const i of arr) s += this.rate[i];
    return s / arr.length;
  }
}

// ---- мир ---------------------------------------------------------------------
export class FlySim {
  // mode: 'connectome' — настоящие связи; 'random' — контроль с перемешанными целями
  constructor(data, { mode = 'connectome', seed = 1, config = {} } = {}) {
    this.cfg = { ...CONFIG, ...config };
    this.data = data;
    this.mode = mode;
    this.rng = mulberry32(seed);
    this.net = getStructure(data, mode);
    this.N = this.net.N;
    Object.assign(this, this.net.groups); // olfL, olfR, mechL, mechR, motL, motR

    this.time = 0;
    this.events = [];
    this.history = [];
    this.historyTimer = 0;
    this.totalEaten = 0;
    this.totalDeaths = 0;
    this.wind = { angle: this.rng() * TAU, x: 0, z: 0, speed: this.cfg.windSpeed };
    this.updateWind(0);
    this.obstacles = this.makeObstacles();
    this.food = [];
    for (let k = 0; k < this.cfg.foodCount; k++) this.food.push(this.randomFood(k % 3));
    this.predator = this.randomPredator();
    this.flies = [];
    for (let i = 0; i < Math.max(1, this.cfg.flyCount); i++) this.flies.push(this.makeFly(i));
    this.hero = 0;
  }

  // Совместимость: «муха» — та, за которой следит камера
  get fly() { return this.flies[this.hero]; }
  get rate() { return this.fly.brain.rate; }
  get lives() { return this.fly.lives; }
  get eaten() { return this.fly.eaten; }
  get deaths() { return this.fly.deaths; }
  meanRate(arr) { return this.fly.brain.meanRate(arr); }

  setConfig(config) {
    this.cfg = { ...CONFIG, flyCount: this.cfg.flyCount, ...config };
    for (const f of this.flies) f.brain.setConfig(this.cfg);
  }

  resetFly(cause) { this.respawn(this.fly, cause); }

  daylight() { return 0.5 + 0.5 * Math.cos(TAU * this.time / this.cfg.dayLength); }

  logEvent(text) {
    this.events.push({ t: this.time, text });
    if (this.events.length > 10) this.events.shift();
  }

  // ---- объекты мира ----------------------------------------------------------

  makeObstacles() {
    const out = [];
    const h = this.cfg.arenaHalf;
    const place = (kind, count, rMin, rMax, hMin, hMax) => {
      let made = 0, tries = 0;
      while (made < count && tries < 2000) {
        tries++;
        const r = rMin + this.rng() * (rMax - rMin);
        const x = (this.rng() * 2 - 1) * (h - r - 0.4);
        const z = (this.rng() * 2 - 1) * (h - r - 0.4);
        if (Math.hypot(x, z) < 0.9) continue;
        if (out.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r + 0.5)) continue;
        out.push({ kind, x, z, r, height: hMin + this.rng() * (hMax - hMin), seed: Math.floor(this.rng() * 1e6) });
        made++;
      }
    };
    place('stone', this.cfg.stoneCount, 0.18, 0.4, 0.18, 0.55);
    place('plant', this.cfg.plantCount, 0.05, 0.08, 1.2, 2.1);
    return out;
  }

  clearOfObstacles(x, z, pad) {
    return !this.obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + pad);
  }

  // Фрукт: kind 0 — половинка яблока, 1 — кружок банана, 2 — виноградина
  randomFood(kind) {
    const size = [0.11, 0.09, 0.06][kind];
    const max = this.cfg.foodAmount * (0.6 + 0.8 * this.rng());
    const h = this.cfg.arenaHalf - 0.4;
    const stones = this.obstacles.filter((o) => o.kind === 'stone');
    let x = 0, z = 0, base = 0;
    if (stones.length && this.rng() < 0.3) {
      const o = stones[Math.floor(this.rng() * stones.length)];
      x = o.x + (this.rng() - 0.5) * o.r * 0.6;
      z = o.z + (this.rng() - 0.5) * o.r * 0.6;
      base = o.height;
    } else {
      for (let k = 0; k < 60; k++) {
        x = (this.rng() * 2 - 1) * h;
        z = (this.rng() * 2 - 1) * h;
        if (this.clearOfObstacles(x, z, 0.15)) break;
      }
    }
    return { kind, x, z, y: base + size * 0.7, base, size, amount: max, max, alive: true, regrowAt: 0 };
  }

  randomPredator() {
    const h = this.cfg.arenaHalf - 0.6;
    return {
      x: (this.rng() * 2 - 1) * h, y: 1.4, z: (this.rng() * 2 - 1) * h,
      heading: this.rng() * TAU, speed: this.cfg.predatorSpeed, cooldown: 4, hunting: false,
    };
  }

  makeFly(id) {
    const f = {
      id,
      brain: new Brain(this.data, this.net, this.cfg),
      lives: 0, eaten: 0, deaths: { starve: 0, predator: 0 },
    };
    this.respawn(f, null);
    return f;
  }

  respawn(f, cause) {
    if (cause) {
      f.deaths[cause] += 1;
      this.totalDeaths += 1;
      this.logEvent(`Муха ${f.id + 1}: ${cause === 'predator' ? 'поймала стрекоза' : 'умерла от голода'}`);
    }
    const h = this.cfg.arenaHalf - 0.8;
    let x = 0, z = 0;
    for (let k = 0; k < 60; k++) {
      x = (this.rng() * 2 - 1) * h;
      z = (this.rng() * 2 - 1) * h;
      if (this.clearOfObstacles(x, z, 0.3)) break;
    }
    Object.assign(f, {
      x, y: 0.7, z,
      heading: this.rng() * TAU,
      speed: 0,
      energy: this.cfg.energyMax,
      state: 'fly', stateTime: 0,
      saccadeAcc: 0, saccadeLeft: 0, saccadeRate: 0,
      feedFood: null, feedDX: 0, feedDZ: 0,
      phase: this.rng() * TAU,
      lastOdor: -1e9, nav: 'search',
      odorL: 0, odorR: 0, contactL: 0, contactR: 0, threatL: 0, threatR: 0,
      rL: 0, rR: 0,
      lifeTime: 0,
      trail: [],
    });
    f.brain.reset();
    f.lives += 1;
  }

  updateWind(dt) {
    const w = this.wind;
    w.angle += (this.rng() - 0.5) * 0.25 * dt;
    w.x = Math.sin(w.angle);
    w.z = Math.cos(w.angle);
  }

  // Запах: шлейф, который ветер сносит от фрукта и постепенно размывает
  odorAt(x, y, z) {
    const cfg = this.cfg;
    const wx = this.wind.x, wz = this.wind.z;
    let s = 0;
    for (const f of this.food) {
      if (!f.alive) continue;
      const dx = x - f.x, dy = y - f.y, dz = z - f.z;
      const along = dx * wx + dz * wz;
      const cx = dx - along * wx, cz = dz - along * wz;
      const cross2 = cx * cx + cz * cz + dy * dy * 0.6;
      const strength = Math.sqrt(f.amount / f.max);
      if (along > 0) {
        const sc = cfg.plumeSpread + cfg.plumeGrowth * along;
        s += strength * (cfg.plumeSpread / sc) * Math.exp(-cross2 / (2 * sc * sc)) * Math.exp(-along / cfg.plumeLength);
      } else {
        s += strength * Math.exp(-(along * along + cross2) / (2 * cfg.odorNear * cfg.odorNear));
      }
    }
    return s;
  }

  wallProximity(x, z) {
    const h = this.cfg.arenaHalf;
    const d = Math.min(h - Math.abs(x), h - Math.abs(z));
    return Math.max(0, 1 - d / 0.35);
  }

  obstacleProx(x, y, z) {
    let best = 0;
    for (const o of this.obstacles) {
      if (y > o.height + 0.1) continue;
      const v = Math.max(0, 1 - (Math.hypot(x - o.x, z - o.z) - o.r) / 0.3);
      if (v > best) best = v;
    }
    return best;
  }

  // Выталкивает объект из камней и стеблей (если он ниже их верхушки)
  pushOut(p, pad) {
    for (const o of this.obstacles) {
      if (p.y > o.height + 0.03) continue;
      const dx = p.x - o.x, dz = p.z - o.z;
      const d = Math.hypot(dx, dz);
      const min = o.r + pad;
      if (d < min) {
        if (d > 1e-6) { p.x = o.x + (dx / d) * min; p.z = o.z + (dz / d) * min; }
        else p.x = o.x + min;
      }
    }
  }

  sense(f) {
    const a = this.cfg.antennaOffset;
    const rx = Math.cos(f.heading), rz = -Math.sin(f.heading); // вектор «вправо»
    const lx = f.x + rx * a, lz = f.z + rz * a;
    const qx = f.x - rx * a, qz = f.z - rz * a;
    f.odorL = this.odorAt(lx, f.y, lz);
    f.odorR = this.odorAt(qx, f.y, qz);
    f.contactL = Math.max(this.wallProximity(lx, lz), this.obstacleProx(lx, f.y, lz));
    f.contactR = Math.max(this.wallProximity(qx, qz), this.obstacleProx(qx, f.y, qz));
    const p = this.predator;
    const sense = this.cfg.predatorSense;
    f.threatL = Math.max(0, 1 - Math.hypot(lx - p.x, f.y - p.y, lz - p.z) / sense);
    f.threatR = Math.max(0, 1 - Math.hypot(qx - p.x, f.y - p.y, qz - p.z) / sense);
  }

  nearestFood(f) {
    let best = null, bd = Infinity;
    for (const food of this.food) {
      if (!food.alive) continue;
      const d = (food.x - f.x) ** 2 + (food.z - f.z) ** 2 + (food.y - f.y) ** 2;
      if (d < bd) { bd = d; best = food; }
    }
    return best;
  }

  // ---- шаг мухи ----------------------------------------------------------------

  stepFly(f, dt, daylight) {
    const cfg = this.cfg;
    const g = this.net.groups;
    this.sense(f);
    const hunger = 1 - f.energy / cfg.energyMax;
    f.brain.step({
      olfL: f.odorL * cfg.odorGain + hunger * cfg.hungerGain,
      olfR: f.odorR * cfg.odorGain + hunger * cfg.hungerGain,
      mechL: f.contactL * cfg.contactGain + f.threatL * cfg.predatorGain,
      mechR: f.contactR * cfg.contactGain + f.threatR * cfg.predatorGain,
    }, this.rng);
    const rL = f.brain.meanRate(g.motL);
    const rR = f.brain.meanRate(g.motR);
    f.rL = rL; f.rR = rR;
    // суточный ритм: днём мухи активны, ночью отдыхают
    const activity = cfg.nightActivity + (1 - cfg.nightActivity) * smooth(clamp((daylight - 0.1) / 0.5, 0, 1));
    const threat = Math.max(f.threatL, f.threatR);
    const p = this.predator;
    f.stateTime += dt;

    // Рефлекс бегства: резкий взлёт в сторону от стрекозы (у настоящей мухи —
    // гигантские волокна). Здесь он задан правилом, а не подсетью коннектома.
    if (threat > cfg.escapeThreshold && f.state !== 'escape') {
      f.state = 'escape';
      f.stateTime = 0;
      f.feedFood = null;
      f.heading = Math.atan2(f.x - p.x, f.z - p.z) + (this.rng() - 0.5) * 0.6;
      if (f.id === this.hero) this.logEvent(`Муха ${f.id + 1} увернулась от стрекозы`);
    }

    let targetY = f.y;
    if (f.state === 'escape') {
      f.speed = cfg.escapeSpeed;
      targetY = Math.min(cfg.arenaTop - 0.2, f.y + 1);
      if (f.stateTime > cfg.escapeTime) { f.state = 'fly'; f.stateTime = 0; }
    } else if (f.state === 'feed') {
      const food = f.feedFood;
      f.speed = 0;
      if (!food || !food.alive) {
        f.state = 'fly'; f.stateTime = 0;
      } else {
        f.x = food.x + f.feedDX;
        f.z = food.z + f.feedDZ;
        f.y = food.y + food.size * 0.75;
        targetY = f.y;
        const gain = Math.min(cfg.feedRate * dt, food.amount);
        f.energy = Math.min(cfg.energyMax, f.energy + gain);
        food.amount -= gain;
        if (food.amount <= 0.01) { food.alive = false; food.amount = 0; food.regrowAt = this.time + cfg.foodRegrow; }
        if (f.energy >= cfg.energyMax * 0.97 || !food.alive) {
          f.state = 'fly'; f.stateTime = 0; f.y += 0.06; f.feedFood = null;
        }
      }
    } else if (f.state === 'rest') {
      f.speed = 0;
      targetY = 0.03;
      if (daylight > 0.35 && f.stateTime > 3) { f.state = 'fly'; f.stateTime = 0; }
    } else {
      // полёт: скорость с инерцией, курс — плавный дрейф плюс саккады
      let target = clamp(cfg.motorSpeed * (rL + rR) / 2, 0, 1.5) * activity;
      let drive = cfg.motorTurn * (rL - rR);
      // врождённые рефлексы: тропотаксис, полёт против ветра по шлейфу, прочёсывание
      const odor = f.odorL + f.odorR;
      f.nav = 'search';
      if (cfg.reflexes && hunger > 0.1) {
        const upwind = Math.atan2(-this.wind.x, -this.wind.z);
        const turnTo = (angle, gain) => {
          let d = angle - f.heading;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          return clamp(d, -1, 1) * gain;
        };
        const near = this.nearestFood(f);
        const nearDist = near ? Math.hypot(near.x - f.x, near.z - f.z) : Infinity;
        if (near && nearDist < cfg.approachDist) {
          // подлёт по зрению: прямо на фрукт и с замедлением перед посадкой
          f.lastOdor = this.time;
          f.nav = 'approach';
          drive += turnTo(Math.atan2(near.x - f.x, near.z - f.z), 5);
          target = clamp(nearDist * 1.2, 0.25, 0.8) * Math.max(activity, 0.5);
        } else if (odor > cfg.odorDetect) {
          f.lastOdor = this.time;
          f.nav = 'surge';
          drive += cfg.tropoGain * (f.odorL - f.odorR) / (odor + 0.05);
          drive += turnTo(upwind, cfg.surgeGain) * (1 - Math.min(1, odor));
          target = Math.max(target, 0.7 * activity);
        } else if (this.time - f.lastOdor < cfg.castTime) {
          f.nav = 'cast';
          const side = Math.sin((this.time - f.lastOdor) * Math.PI) >= 0 ? 1 : -1;
          drive += turnTo(upwind + side * Math.PI / 2, cfg.surgeGain);
          target = Math.max(target, 0.6 * activity);
        }
      }
      f.speed += (target - f.speed) * Math.min(1, dt * 3);
      f.heading += 0.35 * drive * dt * activity;
      f.saccadeAcc = f.saccadeAcc * (1 - dt * 0.8) + drive * dt;
      if (f.saccadeLeft > 0) {
        f.heading += f.saccadeRate * dt;
        f.saccadeLeft -= dt;
      } else if (Math.abs(f.saccadeAcc) > cfg.saccadeThreshold) {
        const ang = Math.sign(f.saccadeAcc) * Math.min(cfg.saccadeAngle, 0.4 + Math.abs(f.saccadeAcc));
        f.saccadeRate = ang / cfg.saccadeTime;
        f.saccadeLeft = cfg.saccadeTime;
        f.saccadeAcc = 0;
      }
      // высота: обычно крейсерская; по сильному запаху — к ближайшему фрукту.
      // Высотой управляет правило, а не подсеть коннектома.
      targetY = 0.55 + 0.35 * Math.sin(this.time * 0.2 + f.phase);
      const food = this.nearestFood(f);
      if (food && f.odorL + f.odorR > 0.25) {
        targetY = food.y + food.size + 0.08;
        const dh = Math.hypot(food.x - f.x, food.z - f.z);
        if (dh < cfg.landRadius && Math.abs(f.y - (food.y + food.size * 0.75)) < 0.3 && hunger > 0.12) {
          f.state = 'feed'; f.stateTime = 0; f.feedFood = food;
          f.feedDX = (this.rng() - 0.5) * food.size * 0.8;
          f.feedDZ = (this.rng() - 0.5) * food.size * 0.8;
          f.eaten += 1;
          this.totalEaten += 1;
          if (f.id === this.hero) this.logEvent(`Муха ${f.id + 1} села на фрукт и ест`);
        }
      }
      if (daylight < 0.15 && this.rng() < dt * 0.4) { f.state = 'rest'; f.stateTime = 0; }
    }

    if (f.state !== 'feed') {
      const climb = f.state === 'escape' ? 1.6 : 0.8;
      f.y = clamp(f.y + clamp(1.5 * (targetY - f.y), -climb, climb) * dt, 0.03, cfg.arenaTop);
      f.x += Math.sin(f.heading) * f.speed * dt;
      f.z += Math.cos(f.heading) * f.speed * dt;
      const h = cfg.arenaHalf - 0.05;
      f.x = clamp(f.x, -h, h);
      f.z = clamp(f.z, -h, h);
      this.pushOut(f, 0.07);
    }

    const drain = (f.state === 'rest' ? cfg.energyDrain * 0.3 : cfg.energyDrain) + cfg.moveCost * f.speed * (f.state === 'escape' ? 0.5 : 1);
    f.energy -= drain * dt;

    const flying = f.state === 'fly' || f.state === 'escape';
    if (flying && p.cooldown <= 0 && Math.hypot(p.x - f.x, p.y - f.y, p.z - f.z) < cfg.predatorKill) {
      p.cooldown = cfg.predatorRest;
      this.respawn(f, 'predator');
      return;
    }
    if (f.energy <= 0) { this.respawn(f, 'starve'); return; }

    f.lifeTime += dt;
    f.trail.push([f.x, f.y, f.z]);
    if (f.trail.length > 240) f.trail.shift();
  }

  // Стрекоза охотится на летящих мух поблизости, иначе патрулирует
  stepPredator(dt) {
    const p = this.predator;
    const cfg = this.cfg;
    p.cooldown = Math.max(0, p.cooldown - dt);
    let target = null, bd = cfg.predatorChase;
    if (p.cooldown <= 0) {
      for (const f of this.flies) {
        if (f.state !== 'fly' && f.state !== 'escape') continue;
        const d = Math.hypot(f.x - p.x, f.y - p.y, f.z - p.z);
        if (d < bd) { bd = d; target = f; }
      }
    }
    p.hunting = !!target;
    if (target) {
      const want = Math.atan2(target.x - p.x, target.z - p.z);
      let diff = want - p.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      p.heading += clamp(diff, -2.6 * dt, 2.6 * dt);
      p.speed += (cfg.predatorChaseSpeed - p.speed) * Math.min(1, dt * 2);
      p.y += clamp(target.y - p.y, -1, 1) * dt * 1.5;
    } else {
      p.heading += (this.rng() - 0.5) * 2.0 * dt;
      p.speed += (cfg.predatorSpeed - p.speed) * Math.min(1, dt);
      p.y += ((1.3 + 0.4 * Math.sin(this.time * 0.4)) - p.y) * dt * 0.8;
    }
    p.x += Math.sin(p.heading) * p.speed * dt;
    p.z += Math.cos(p.heading) * p.speed * dt;
    const h = cfg.arenaHalf - 0.2;
    if (Math.abs(p.x) > h || Math.abs(p.z) > h) {
      p.heading += Math.PI;
      p.x = clamp(p.x, -h, h);
      p.z = clamp(p.z, -h, h);
    }
    p.y = clamp(p.y, 0.25, cfg.arenaTop);
    this.pushOut(p, 0.12);
  }

  step(dt = 1 / 60) {
    this.time += dt;
    const daylight = this.daylight();
    this.updateWind(dt);
    this.stepPredator(dt);
    for (const f of this.flies) this.stepFly(f, dt, daylight);
    for (let k = 0; k < this.food.length; k++) {
      const food = this.food[k];
      if (!food.alive && this.time >= food.regrowAt) this.food[k] = this.randomFood(food.kind);
    }
    this.historyTimer += dt;
    if (this.historyTimer >= 0.1) {
      this.historyTimer = 0;
      const b = this.fly.brain;
      const sensory = (b.meanRate(this.olfL) + b.meanRate(this.olfR) + b.meanRate(this.mechL) + b.meanRate(this.mechR)) / 4;
      this.history.push({ motor: (this.fly.rL + this.fly.rR) / 2, sensory, energy: this.fly.energy });
      if (this.history.length > 400) this.history.shift();
    }
  }
}
