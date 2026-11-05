// Ядро симуляции мухи: нейросеть на основе подсети FlyWire + простой мир.
// Не зависит от DOM, поэтому работает и в браузере, и в Node, и в Web Worker.

export const CONFIG = {
  // нейроны
  decay: 0.85,          // утечка мембраны за шаг
  threshold: 0.6,       // порог возбуждения
  refractory: 2,        // шагов без спайков после разряда
  weightScale: 0.3,     // вес синапса = min(число синапсов, maxSyn) * weightScale
  maxSyn: 20,
  noise: 0.01,          // фоновый шум на каждый нейрон
  // входы
  odorGain: 0.6,        // сила обонятельного входа
  contactGain: 0.8,     // сила механосенсорного входа от стен
  hungerGain: 0.15,     // голод усиливает обонятельные входы
  predatorGain: 0.9,    // сила механосенсорного входа от воздушного возмущения хищника
  predatorSense: 0.8,   // радиус, на котором муха чувствует хищника
  // мир
  energyMax: 100,
  energyDrain: 0.5,     // расход энергии в покое, ед./с
  moveCost: 0.8,        // дополнительный расход на движение, ед./с при скорости 1
  foodGain: 45,
  eatRadius: 0.22,
  foodCount: 12,
  odorSigma: 1.2,
  antennaOffset: 0.1,
  arenaHalf: 2.0,
  arenaTop: 1.4,
  predatorSpeed: 0.35,
  predatorKill: 0.22,
  // моторы
  motorSpeed: 3.0,      // скорость полёта на единицу активности моторных нейронов
  motorTurn: 3.0,       // скорость поворота (рад/с) на единицу разницы L и R
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

export class FlySim {
  // data — объект из fly_network.json
  // mode: 'connectome' — настоящие связи; 'random' — те же нейроны и веса,
  //       но цели синапсов перемешаны (контрольный эксперимент)
  constructor(data, { mode = 'connectome', seed = 1, config = {} } = {}) {
    this.cfg = { ...CONFIG, ...config };
    this.data = data;
    this.mode = mode;
    this.rng = mulberry32(seed);
    this.N = data.ids.length;
    this.buildNetwork();
    this.updateWeights();
    this.buildGroups();

    this.time = 0;
    this.lives = 0;
    this.eaten = 0;
    this.deaths = { starve: 0, predator: 0 };
    this.events = [];
    this.history = [];
    this.historyTimer = 0;
    this.food = [];
    for (let k = 0; k < this.cfg.foodCount; k++) this.food.push(this.randomFood());
    this.predator = this.randomPredator();
    this.resetFly(null);
  }

  // Меняет параметры на лету, без сброса мира (нужно для эволюции в браузере)
  setConfig(config) {
    this.cfg = { ...CONFIG, ...config };
    this.updateWeights();
  }

  buildNetwork() {
    const { data } = this;
    const src = Int32Array.from(data.src);
    const dst = Int32Array.from(data.dst);
    if (this.mode === 'random') {
      // Перемешиваем цели, сохраняя источники и знаки
      for (let i = dst.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        const t = dst[i]; dst[i] = dst[j]; dst[j] = t;
      }
    }
    this.src = src;
    this.dst = dst;
    this.w = new Float32Array(src.length);
    this.I = new Float32Array(this.N);
    this.v = new Float32Array(this.N);
    this.spike = new Uint8Array(this.N);
    this.refr = new Uint8Array(this.N);
    this.rate = new Float32Array(this.N);
  }

  updateWeights() {
    const { data, w, cfg } = this;
    for (let e = 0; e < w.length; e++) {
      const sign = data.inhibitory[e] ? -1 : 1;
      w[e] = sign * Math.min(data.syn[e], cfg.maxSyn) * cfg.weightScale;
    }
  }

  buildGroups() {
    const { data } = this;
    const pick = (group, side) => {
      const out = [];
      for (let i = 0; i < this.N; i++) {
        if (data.group[i] === group && data.side[i] === side) out.push(i);
      }
      return Int32Array.from(out);
    };
    // group: 0 olfactory, 1 mechanosensory, 2 motor, 3 hidden; side: 0 left, 1 right
    this.olfL = pick(0, 0); this.olfR = pick(0, 1);
    this.mechL = pick(1, 0); this.mechR = pick(1, 1);
    this.motL = pick(2, 0); this.motR = pick(2, 1);
  }

  // ---- мир ---------------------------------------------------------------

  randomFood() {
    const h = this.cfg.arenaHalf - 0.3;
    return {
      x: (this.rng() * 2 - 1) * h,
      y: 0.15 + this.rng() * 0.6,
      z: (this.rng() * 2 - 1) * h,
    };
  }

  randomPredator() {
    const h = this.cfg.arenaHalf - 0.4;
    return {
      x: (this.rng() * 2 - 1) * h,
      y: 0.5,
      z: (this.rng() * 2 - 1) * h,
      heading: this.rng() * Math.PI * 2,
    };
  }

  logEvent(text) {
    this.events.push({ t: this.time, text });
    if (this.events.length > 8) this.events.shift();
  }

  resetFly(cause) {
    if (cause) {
      this.deaths[cause] += 1;
      this.logEvent(cause === 'predator' ? 'Хищник поймал муху' : 'Муха умерла от голода');
    }
    const h = this.cfg.arenaHalf - 0.5;
    this.fly = {
      x: (this.rng() * 2 - 1) * h,
      y: 0.6,
      z: (this.rng() * 2 - 1) * h,
      heading: this.rng() * Math.PI * 2,
      speed: 0,
      energy: this.cfg.energyMax,
      odorL: 0, odorR: 0,
      contactL: 0, contactR: 0,
      threatL: 0, threatR: 0,
      trail: [],
    };
    // нейронная сеть сбрасывается в покой
    this.v.fill(0); this.spike.fill(0); this.refr.fill(0); this.rate.fill(0);
    this.lives += 1;
  }

  odorAt(x, y, z) {
    const s2 = 2 * this.cfg.odorSigma * this.cfg.odorSigma;
    let s = 0;
    for (const f of this.food) {
      const d2 = (x - f.x) ** 2 + (y - f.y) ** 2 + (z - f.z) ** 2;
      s += Math.exp(-d2 / s2);
    }
    return s;
  }

  wallProximity(x, z) {
    const h = this.cfg.arenaHalf;
    const d = Math.min(h - Math.abs(x), h - Math.abs(z));
    return Math.max(0, 1 - d / 0.35);
  }

  // Входы от мира в сенсорные нейроны
  sense() {
    const f = this.fly;
    const a = this.cfg.antennaOffset;
    const rx = Math.cos(f.heading), rz = -Math.sin(f.heading); // вектор «вправо»
    const pts = [
      [f.x + rx * a, f.y, f.z + rz * a],
      [f.x - rx * a, f.y, f.z - rz * a],
    ];
    const p = this.predator;
    const sense = this.cfg.predatorSense;
    const threat = (q) => Math.max(0, 1 - Math.hypot(q[0] - p.x, q[1] - p.y, q[2] - p.z) / sense);
    f.odorL = this.odorAt(...pts[0]);
    f.odorR = this.odorAt(...pts[1]);
    f.contactL = this.wallProximity(pts[0][0], pts[0][2]);
    f.contactR = this.wallProximity(pts[1][0], pts[1][2]);
    f.threatL = threat(pts[0]);
    f.threatR = threat(pts[1]);
  }

  // ---- нейросеть -----------------------------------------------------------

  neuralStep() {
    const { N, src, dst, w, spike, I, v, refr, rate, cfg } = this;
    I.fill(0);
    // синаптическая передача: спайки предыдущего шага
    for (let e = 0; e < src.length; e++) {
      if (spike[src[e]]) I[dst[e]] += w[e];
    }
    // внешние входы
    const f = this.fly;
    const hunger = 1 - f.energy / cfg.energyMax;
    const odorDriveL = f.odorL * cfg.odorGain + hunger * cfg.hungerGain;
    const odorDriveR = f.odorR * cfg.odorGain + hunger * cfg.hungerGain;
    for (const i of this.olfL) I[i] += odorDriveL;
    for (const i of this.olfR) I[i] += odorDriveR;
    const mechL = f.contactL * cfg.contactGain + f.threatL * cfg.predatorGain;
    const mechR = f.contactR * cfg.contactGain + f.threatR * cfg.predatorGain;
    for (const i of this.mechL) I[i] += mechL;
    for (const i of this.mechR) I[i] += mechR;

    // фоновый шум и обновление мембран
    for (let i = 0; i < N; i++) {
      I[i] += cfg.noise * this.rng();
      if (refr[i] > 0) {
        refr[i]--;
        spike[i] = 0;
      } else {
        v[i] = v[i] * cfg.decay + I[i];
        if (v[i] >= cfg.threshold) {
          spike[i] = 1; v[i] = 0; refr[i] = cfg.refractory;
        } else {
          spike[i] = 0;
        }
      }
      rate[i] = rate[i] * 0.95 + 0.05 * spike[i];
    }
  }

  meanRate(arr) {
    if (!arr.length) return 0;
    let s = 0;
    for (const i of arr) s += this.rate[i];
    return s / arr.length;
  }

  // ---- шаг мира ------------------------------------------------------------

  stepPredator(dt) {
    const p = this.predator;
    const h = this.cfg.arenaHalf - 0.1;
    p.heading += (this.rng() - 0.5) * 2.5 * dt;
    p.x += Math.sin(p.heading) * this.cfg.predatorSpeed * dt;
    p.z += Math.cos(p.heading) * this.cfg.predatorSpeed * dt;
    if (Math.abs(p.x) > h || Math.abs(p.z) > h) {
      p.heading += Math.PI;
      p.x = clamp(p.x, -h, h);
      p.z = clamp(p.z, -h, h);
    }
    p.y = 0.55 + 0.25 * Math.sin(this.time * 1.3);
  }

  step(dt = 1 / 60) {
    const cfg = this.cfg;
    this.time += dt;
    this.stepPredator(dt);
    this.sense();
    this.neuralStep();

    const f = this.fly;
    const rL = this.meanRate(this.motL);
    const rR = this.meanRate(this.motR);
    f.speed = clamp(cfg.motorSpeed * (rL + rR) / 2, 0, 1.5);
    f.heading += cfg.motorTurn * (rL - rR) * dt;

    // Перемещение в горизонтальной плоскости
    f.x += Math.sin(f.heading) * f.speed * dt;
    f.z += Math.cos(f.heading) * f.speed * dt;
    const h = cfg.arenaHalf - 0.05;
    f.x = clamp(f.x, -h, h);
    f.z = clamp(f.z, -h, h);

    // Высота: коннектом не управляет ею. Муха снижается к ближайшей еде.
    let targetY = 0.6 + 0.3 * Math.sin(this.time * 0.25);
    if (f.odorL + f.odorR > 0.3) {
      let best = null, bd = Infinity;
      for (const food of this.food) {
        const d = (food.x - f.x) ** 2 + (food.z - f.z) ** 2;
        if (d < bd) { bd = d; best = food; }
      }
      if (best) targetY = best.y;
    }
    f.y = clamp(f.y + clamp(1.5 * (targetY - f.y), -0.8, 0.8) * dt, 0.08, cfg.arenaTop);

    // Хищник
    const p = this.predator;
    if (Math.hypot(p.x - f.x, p.y - f.y, p.z - f.z) < cfg.predatorKill) {
      this.resetFly('predator');
      this.predator = this.randomPredator();
      return this.afterStep(dt, rL, rR);
    }

    // Энергия и еда
    f.energy -= (cfg.energyDrain + cfg.moveCost * f.speed) * dt;
    for (let k = 0; k < this.food.length; k++) {
      const food = this.food[k];
      if (Math.hypot(food.x - f.x, food.y - f.y, food.z - f.z) < cfg.eatRadius) {
        f.energy = Math.min(cfg.energyMax, f.energy + cfg.foodGain);
        this.eaten += 1;
        this.logEvent('Муха съела еду');
        this.food[k] = this.randomFood();
      }
    }
    if (f.energy <= 0) this.resetFly('starve');

    return this.afterStep(dt, rL, rR);
  }

  afterStep(dt, rL, rR) {
    const f = this.fly;
    f.lifeTime = (f.lifeTime || 0) + dt;
    f.trail.push([f.x, f.y, f.z]);
    if (f.trail.length > 240) f.trail.shift();
    this.historyTimer += dt;
    if (this.historyTimer >= 0.1) {
      this.historyTimer = 0;
      const sensory = (this.meanRate(this.olfL) + this.meanRate(this.olfR)
        + this.meanRate(this.mechL) + this.meanRate(this.mechR)) / 4;
      this.history.push({ motor: (rL + rR) / 2, sensory, energy: f.energy });
      if (this.history.length > 400) this.history.shift();
    }
  }
}
