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
  brainEvery: 2,        // мозг считается на каждом N-м шаге физики (2 → 30 раз в секунду)
  sensoryFeedback: 0.02,// во сколько раз ослаблены синапсы НА рецепторные нейроны (у мухи они
                        // регулируют силу сигнала, а не гасят разряд)
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
  // обучение дофамином (правило трёх факторов: вход × след × дофамин)
  learning: 1,          // 1 — обучаемые синапсы меняются, 0 — заморожены
  learnRate: 0.15,
  weightDecay: 0.002,   // медленное забывание выученного, доля в секунду
  eligTau: 1.0,         // время жизни следа активности синапса, с
  explore: 0.5,         // сила случайных проб в повороте и подъёме
  exploreTau: 0.35,
  learnTurnGain: 3.0,   // сила выученного поворота, рад/с
  learnClimbGain: 0.9,  // сила выученного подъёма, ед./с
  daTau: 0.3,           // как быстро затухает всплеск дофамина, с
  daBaselineTau: 8,     // ожидание награды (вычитается из дофамина)
  daFood: 1.5,          // всплеск при посадке на фрукт
  daFeed: 0.4,          // дофамин в секунду, пока муха ест
  daOdor: 6.0,          // за усиление запаха (врождённая тяга к запаху фруктов)
  daBump: -2.0,         // провал при ударе о стену, камень или стебель
  daThreat: -0.6,       // провал рядом со стрекозой (в секунду)
  daInject: 0.5,        // ток в дофаминовые нейроны подсети при всплеске
  // разные мухи
  traitSpread: 0.25,    // разброс индивидуальных качеств (±25%)
  inherit: 1,           // новая муха наследует выученные синапсы лучшей мухи
  mutation: 0.15,       // шум при наследовании (доля от размаха весов)
  // врождённые рефлексы поиска еды по запаху (по данным о поведении дрозофилы;
  // этих цепей нет в подсети, поэтому они заданы правилами и их можно выключить)
  reflexes: 0,          // 1 — включены (для сравнения), 0 — муха учится сама
  odorDetect: 0.03,     // порог, с которого муха замечает запах
  tropoGain: 2.5,       // поворот к антенне, где запах сильнее
  surgeGain: 3.0,       // разворот против ветра, пока запах чувствуется
  castTime: 3.0,        // сколько секунд муха прочёсывает поперёк ветра после потери шлейфа
  approachDist: 0.9,    // с какого расстояния муха видит фрукт и подлетает к нему
  // энергия и еда
  energyMax: 100,
  energyDrain: 0.25,    // расход в полёте без движения, ед./с
  moveCost: 0.35,       // дополнительный расход на скорость 1, ед./с
  feedRate: 22,         // сколько энергии муха получает за секунду еды
  foodAmount: 70,       // средний запас фрукта
  foodRegrow: 14,       // через сколько секунд вырастает новый фрукт
  foodCount: 44,
  // запах и ветер
  plumeSpread: 0.25,    // ширина шлейфа у источника
  plumeGrowth: 0.3,     // расширение шлейфа на единицу расстояния по ветру
  plumeLength: 3.5,     // затухание шлейфа по ветру
  odorNear: 0.4,        // радиус запаха против ветра
  windSpeed: 0.35,
  antennaOffset: 0.1,
  // мир
  arenaHalf: 8.0,
  arenaTop: 2.5,
  stoneCount: 24,
  plantCount: 14,
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
  const daIdx = [];
  for (let i = 0; i < N; i++) if (data.nt_list[data.nt[i]] === 'dopamine') daIdx.push(i);
  groups.da = Int32Array.from(daIdx);
  // входы обучаемого выхода: средняя активность популяций нейронов слева и справа
  const cls = (name) => data.cls_list.indexOf(name);
  const popDefs = [
    ['Рецепторы запаха', (i) => data.group[i] === 0],
    ['Проекционные нейроны', (i) => data.group[i] === 3 && data.cls[i] === cls('ALPN')],
    ['Локальные нейроны', (i) => data.group[i] === 3 && data.cls[i] === cls('ALLN')],
    ['Механорецепторы', (i) => data.group[i] === 1],
    ['Восходящие нейроны', (i) => data.group[i] === 3 && data.cls[i] === cls('AN')],
    ['Остальные нейроны', (i) => data.group[i] === 3 && ![cls('ALPN'), cls('ALLN'), cls('AN')].includes(data.cls[i])],
  ];
  groups.populations = [];
  for (const [name, test] of popDefs) {
    for (const [side, label] of [[0, 'слева'], [1, 'справа']]) {
      const idx = [];
      for (let i = 0; i < N; i++) if (data.side[i] === side && test(i)) idx.push(i);
      if (idx.length) groups.populations.push({ name: `${name} ${label}`, idx: Int32Array.from(idx) });
    }
  }
  const net = { N, off, tgt, edge, groups };
  byMode.set(mode, net);
  return net;
}

// Таблица равномерного шума [0,1) для нейронов (общая для всех мух)
const NOISE_MASK = 65535;
const NOISE_TABLE = (() => {
  const r = mulberry32(4242);
  const t = new Float32Array(NOISE_MASK + 1);
  for (let i = 0; i < t.length; i++) t[i] = r();
  return t;
})();
function addTo(I, idx, val) {
  for (let q = 0; q < idx.length; q++) I[idx[q]] += val;
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
    const fb = cfg.sensoryFeedback ?? 1;
    for (let k = 0; k < w.length; k++) {
      const e = net.edge[k];
      const toSensory = data.group[net.tgt[k]] <= 1;
      w[k] = (data.inhibitory[e] ? -1 : 1) * Math.min(data.syn[e], cfg.maxSyn) * cfg.weightScale * (toSensory ? fb : 1);
    }
  }

  reset() {
    this.v.fill(0); this.spike.fill(0); this.refr.fill(0); this.rate.fill(0);
    this.nActive = 0;
  }

  // inp: сила входа для обонятельных и механосенсорных групп слева и справа
  // every: сколько шагов физики покрывает этот шаг мозга (постоянные времени пересчитываются)
  step(inp, rng, every = 1) {
    const { net, I, v, spike, refr, rate, w, cfg, active } = this;
    const { off, tgt, N, groups } = net;
    // фоновый шум: из общей таблицы со случайного места (быстрее, чем rng на каждый нейрон)
    const sIn = every === 1 ? 1 : (1 - Math.pow(cfg.decay, every)) / (1 - cfg.decay);
    const noise = cfg.noise * sIn;
    let p = (rng() * NOISE_MASK) | 0;
    for (let i = 0; i < N; i++) { I[i] = noise * NOISE_TABLE[p]; p = (p + 1) & NOISE_MASK; }
    for (let a = 0, na = this.nActive; a < na; a++) {
      const i = active[a];
      for (let k = off[i], end = off[i + 1]; k < end; k++) I[tgt[k]] += w[k];
    }
    addTo(I, groups.olfL, inp.olfL * sIn);
    addTo(I, groups.olfR, inp.olfR * sIn);
    addTo(I, groups.mechL, inp.mechL * sIn);
    addTo(I, groups.mechR, inp.mechR * sIn);
    if (inp.da) addTo(I, groups.da, inp.da * sIn);
    let n = 0;
    const decay = every === 1 ? cfg.decay : Math.pow(cfg.decay, every);
    const threshold = cfg.threshold;
    const refractory = Math.max(0, Math.ceil(cfg.refractory / every));
    const keep = every === 1 ? 0.95 : Math.pow(0.95, every), gain = 1 - keep;
    // при редком счёте один спайк заменяет every шагов, поэтому вклад в частоту делим
    const sv = 1 / every;
    for (let i = 0; i < N; i++) {
      let s = 0;
      if (refr[i] > 0) {
        refr[i]--;
      } else {
        const vi = v[i] * decay + I[i];
        if (vi >= threshold) { s = 1; v[i] = 0; refr[i] = refractory; active[n++] = i; }
        else v[i] = vi;
      }
      spike[i] = s;
      rate[i] = rate[i] * keep + gain * s * sv;
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

// Нормальное распределение (Бокс — Мюллер)
function normal(rng) {
  return Math.sqrt(-2 * Math.log(rng() + 1e-12)) * Math.cos(TAU * rng());
}

// ---- обучаемый выход ------------------------------------------------------------
// Синапсы от всех нейронов подсети к двум командам: «поворот» и «подъём».
// Аналог выходных синапсов грибовидного тела, которые у мухи меняет дофамин.
// Правило трёх факторов (REINFORCE): след = вход × случайная проба;
// изменение веса = скорость × (дофамин − ожидание) × след.
export class Learner {
  // populations: пары популяций [слева, справа]. Поворот учится на разнице сторон
  // (двусторонняя симметрия), подъём — на их сумме и постоянном смещении.
  constructor(populations) {
    const pairs = [];
    for (let j = 0; j + 1 < populations.length; j += 2) {
      pairs.push({ name: populations[j].name.replace(/ слева$/, ''), L: populations[j].idx, R: populations[j + 1].idx });
    }
    this.pairs = pairs;
    const p = pairs.length;
    this.p = p;
    this.nT = p;            // веса поворота: по разнице сторон
    this.nC = p + 1;        // веса подъёма: по сумме сторон + смещение
    this.W = new Float32Array(this.nT + this.nC);
    this.E = new Float32Array(this.nT + this.nC);
    this.mean = new Float32Array(2 * p);
    this.vari = new Float32Array(2 * p).fill(1e-4);
    this.x = new Float32Array(this.nT + this.nC);
    this.noise = [0, 0];
    this.action = [0, 0];
    this.out = [0, 0];
  }

  randomize(rng, scale) {
    for (let k = 0; k < this.W.length; k++) this.W[k] = (rng() * 2 - 1) * scale;
    this.resetTraces();
  }

  // Наследование: копия весов родителя с небольшим шумом
  copyFrom(parent, rng, mutation) {
    let range = 0;
    for (let k = 0; k < parent.W.length; k++) range = Math.max(range, Math.abs(parent.W[k]));
    const sigma = mutation * Math.max(range, 0.05);
    for (let k = 0; k < this.W.length; k++) this.W[k] = parent.W[k] + normal(rng) * sigma;
    this.resetTraces();
  }

  resetTraces() {
    this.E.fill(0);
    this.mean.fill(0);
    this.vari.fill(1e-4);
    this.noise = [0, 0];
  }

  norm() {
    let s = 0;
    for (let k = 0; k < this.W.length; k++) s += this.W[k] * this.W[k];
    return Math.sqrt(s);
  }

  // нормированная активность популяции (отклонение от среднего за ~4 с)
  feature(rate, idx, j, a) {
    let r = 0;
    for (let q = 0; q < idx.length; q++) r += rate[idx[q]];
    r /= idx.length;
    const m = this.mean[j] + (r - this.mean[j]) * a;
    this.mean[j] = m;
    const d = r - m;
    this.vari[j] += (d * d - this.vari[j]) * a;
    return d / Math.sqrt(this.vari[j] + 1e-6);
  }

  step(rate, cfg, explore, dt, rng) {
    const { p, nT, W, E, x, pairs } = this;
    const a = Math.min(1, dt / 4);
    for (let j = 0; j < p; j++) {
      const l = this.feature(rate, pairs[j].L, 2 * j, a);
      const r = this.feature(rate, pairs[j].R, 2 * j + 1, a);
      x[j] = (l - r) * 0.7;          // разница сторон → поворот
      x[nT + j] = (l + r) * 0.5;     // сумма сторон → подъём
    }
    x[nT + p] = 1;                   // смещение подъёма
    let o0 = 0, o1 = 0;
    for (let k = 0; k < nT; k++) o0 += W[k] * x[k];
    for (let k = nT; k < W.length; k++) o1 += W[k] * x[k];
    const tau = cfg.exploreTau;
    for (let k = 0; k < 2; k++) {
      this.noise[k] += -this.noise[k] / tau * dt + Math.sqrt(2 * dt / tau) * normal(rng);
    }
    const sig = cfg.explore * explore;
    const n0 = sig * this.noise[0], n1 = sig * this.noise[1];
    this.out = [o0, o1];
    this.action = [o0 + n0, o1 + n1];
    const lam = Math.exp(-dt / cfg.eligTau);
    for (let k = 0; k < nT; k++) E[k] = E[k] * lam + x[k] * n0;
    for (let k = nT; k < W.length; k++) E[k] = E[k] * lam + x[k] * n1;
  }

  learn(delta, lr, decay, dt) {
    const k = lr * delta * dt;
    const keep = 1 - decay * dt;
    const { W, E } = this;
    for (let j = 0; j < W.length; j++) {
      const w = W[j] * keep + k * E[j];
      W[j] = w > 4 ? 4 : w < -4 ? -4 : w;
    }
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
    this.totalBumps = 0;
    this.feedBuckets = [];   // посадки на фрукты по 30-секундным интервалам (кривая обучения)
    this.bumpBuckets = [];   // удары о стены и препятствия по тем же интервалам
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

  // Лучшая муха по еде за жизнь (для сохранения выученного)
  bestFly() {
    return this.bestParent(null) || this.flies[0];
  }

  // Засеять всех мух сохранёнными синапсами (с небольшими отличиями)
  seedLearners(W, generation = 1) {
    if (!W || W.length !== this.flies[0].learner.W.length) return false;
    const src = { W: Float32Array.from(W) };
    for (const f of this.flies) {
      f.learner.copyFrom(src, this.rng, this.cfg.mutation);
      f.generation = generation + 1;
    }
    return true;
  }

  // Кривая обучения: посадок на фрукт в минуту на одну муху по 30-секундным интервалам
  learningCurve() {
    const n = Math.floor(this.time / 30);
    const out = [];
    for (let b = 0; b < n; b++) out.push({ t: (b + 1) * 30, feed: (this.feedBuckets[b] || 0) * 2 / this.flies.length, bumps: (this.bumpBuckets[b] || 0) * 2 / this.flies.length });
    return out;
  }

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
      learner: new Learner(this.net.groups.populations),
      lives: 0, eaten: 0, deaths: { starve: 0, predator: 0 },
      generation: 1, bumps: 0,
    };
    this.respawn(f, null);
    return f;
  }

  // Лучшая живая муха колонии: больше всего еды за время жизни
  bestParent(except) {
    let best = null, bs = -1;
    for (const o of this.flies || []) {
      if (o === except) continue;
      const score = o.eatenLife / Math.max(o.lifeTime, 30);
      if (score > bs) { bs = score; best = o; }
    }
    return bs > 0 ? best : null;
  }

  respawn(f, cause) {
    const cfg = this.cfg;
    if (cause) {
      f.deaths[cause] += 1;
      this.totalDeaths += 1;
      this.logEvent(`Муха ${f.id + 1}: ${cause === 'predator' ? 'поймала стрекоза' : 'умерла от голода'}`);
    }
    // Новая муха: свои качества и либо выученные синапсы лучшей мухи с мутациями,
    // либо почти нулевые синапсы (наивная муха)
    const parent = cause && cfg.inherit ? this.bestParent(f) : null;
    if (parent) {
      f.learner.copyFrom(parent.learner, this.rng, cfg.mutation);
      f.generation = parent.generation + 1;
      f.parent = parent.id;
      this.logEvent(`Родилась муха ${f.id + 1}: потомок мухи ${parent.id + 1}, поколение ${f.generation}`);
    } else {
      f.learner.randomize(this.rng, 0.002);
      f.generation = cause ? 1 : (f.generation || 1);
      f.parent = null;
    }
    const sp = cfg.traitSpread;
    const trait = () => 1 + sp * (this.rng() * 2 - 1);
    f.traits = { odor: trait(), contact: trait(), motor: trait(), learn: trait(), explore: trait() };
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
      lifeTime: 0, eatenLife: 0,
      da: 0, daBar: 0, prevOdor: 0, delta: 0, climb: 0,
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
      if (along > 6 * cfg.plumeLength || along < -4 * cfg.odorNear) continue;   // слишком далеко
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

  // Отскок от камней и стеблей: курс отражается от поверхности
  bounceObstacles(f, pad) {
    let hit = false;
    for (const o of this.obstacles) {
      if (f.y > o.height + 0.03) continue;
      const dx = f.x - o.x, dz = f.z - o.z;
      const d = Math.hypot(dx, dz);
      const min = o.r + pad;
      if (d < min) {
        hit = true;
        const nx = d > 1e-6 ? dx / d : 1, nz = d > 1e-6 ? dz / d : 0;
        f.x = o.x + nx * min; f.z = o.z + nz * min;
        let vx = Math.sin(f.heading), vz = Math.cos(f.heading);
        const dot = vx * nx + vz * nz;
        if (dot < 0) { vx -= 2 * dot * nx; vz -= 2 * dot * nz; f.heading = Math.atan2(vx, vz); }
      }
    }
    return hit;
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
    const tr = f.traits;
    // Плавное кодирование: без стимула рецептор молчит, с ростом стимула частота
    // растёт и насыщается (как у настоящих рецепторных нейронов)
    const olf = (o) => 0.07 + 0.4 * cfg.odorGain * tr.odor * o / (o + 0.15) + hunger * cfg.hungerGain * 0.15;
    const mech = (c, t) => 0.07 + 0.3 * (c * cfg.contactGain * tr.contact + t * cfg.predatorGain);
    const every = Math.max(1, cfg.brainEvery | 0);
    f.brainTick = (f.brainTick || 0) + 1;
    const brainNow = f.brainTick % every === 0;
    if (brainNow) {
      f.brain.step({
        olfL: olf(f.odorL),
        olfR: olf(f.odorR),
        mechL: mech(f.contactL, f.threatL),
        mechR: mech(f.contactR, f.threatR),
        da: Math.max(0, f.da) * cfg.daInject,
      }, this.rng, every);
    }
    const wasFlying = f.state === 'fly';
    let daAdd = 0;
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
      let target = clamp(cfg.motorSpeed * tr.motor * (rL + rR) / 2, 0, 1.5) * activity;
      let drive = cfg.motorTurn * tr.motor * (rL - rR);
      // выученные команды: поворот и подъём
      if (brainNow) f.learner.step(f.brain.rate, cfg, tr.explore, dt * every, this.rng);
      const learnedTurn = cfg.learnTurnGain * Math.tanh(f.learner.action[0]);
      const learnedClimb = cfg.learnClimbGain * Math.tanh(f.learner.action[1]);
      drive += learnedTurn;
      f.climb = learnedClimb;
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
      // высота: при подсказках-рефлексах — правило, иначе выученная команда подъёма
      const food = this.nearestFood(f);
      if (cfg.reflexes) {
        targetY = 0.55 + 0.35 * Math.sin(this.time * 0.2 + f.phase);
        if (food && f.odorL + f.odorR > 0.25) targetY = food.y + food.size + 0.08;
      } else {
        targetY = f.y + f.climb;   // при подъёме 1.5×(target − y) даёт скорость ≈ climb
      }
      // посадка по касанию: лапки чувствуют сахар, муха садится и выпускает хоботок
      if (food) {
        const d3 = Math.hypot(food.x - f.x, food.z - f.z, (food.y + food.size * 0.75) - f.y);
        if (d3 < cfg.landRadius && hunger > 0.12) {
          f.state = 'feed'; f.stateTime = 0; f.feedFood = food;
          f.feedDX = (this.rng() - 0.5) * food.size * 0.8;
          f.feedDZ = (this.rng() - 0.5) * food.size * 0.8;
          f.eaten += 1;
          f.eatenLife += 1;
          this.totalEaten += 1;
          daAdd += cfg.daFood;
          const b = Math.floor(this.time / 30);
          this.feedBuckets[b] = (this.feedBuckets[b] || 0) + 1;
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
      // отскок от бортиков: курс отражается, скорость падает
      const h = cfg.arenaHalf - 0.05;
      let bump = false;
      if (f.x > h || f.x < -h) { f.x = clamp(f.x, -h, h); f.heading = -f.heading; bump = true; }
      if (f.z > h || f.z < -h) { f.z = clamp(f.z, -h, h); f.heading = Math.PI - f.heading; bump = true; }
      if (this.bounceObstacles(f, 0.07)) bump = true;
      if (bump && f.state !== 'rest') {
        f.speed *= 0.5;
        f.bumps += 1;
        this.totalBumps += 1;
        daAdd += cfg.daBump;
        const b = Math.floor(this.time / 30);
        this.bumpBuckets[b] = (this.bumpBuckets[b] || 0) + 1;
      }
    }

    // ---- дофамин: награда за еду и запах, провал за удары и стрекозу ----
    const odorNow = (f.odorL + f.odorR) / 2;
    if (wasFlying) daAdd += cfg.daOdor * (odorNow - f.prevOdor) * (0.3 + hunger);
    f.prevOdor = odorNow;
    if (f.state === 'feed') daAdd += cfg.daFeed * dt;
    daAdd += cfg.daThreat * threat * dt;
    f.da = f.da * Math.exp(-dt / cfg.daTau) + daAdd;
    f.daBar += (f.da - f.daBar) * Math.min(1, dt / cfg.daBaselineTau);
    f.delta = f.da - f.daBar;
    if (cfg.learning && wasFlying) f.learner.learn(f.delta, cfg.learnRate * tr.learn, cfg.weightDecay, dt);

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
    // мухи не проходят сквозь друг друга
    const fl = this.flies;
    for (let i = 0; i < fl.length; i++) {
      for (let j = i + 1; j < fl.length; j++) {
        const a = fl[i], b = fl[j];
        if (a.state === 'feed' || b.state === 'feed') continue;
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const d = Math.hypot(dx, dy, dz);
        if (d < 0.14 && d > 1e-6) {
          const push = (0.14 - d) / 2;
          a.x -= dx / d * push; a.y -= dy / d * push; a.z -= dz / d * push;
          b.x += dx / d * push; b.y += dy / d * push; b.z += dz / d * push;
        }
      }
    }
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
