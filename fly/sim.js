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
  olfBase: 0.091,       // ток рецепторов запаха без запаха (чуть выше порога: спонтанная активность)
  mechBase: 0.07,       // ток механорецепторов в покое
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
  learnAnneal: 180,     // через сколько секунд жизни скорость обучения падает вдвое (0 — не падает)
  eligTau: 0.7,         // время жизни следа активности синапса, с
  explore: 0.5,         // сила случайных проб в повороте и подъёме
  exploreTau: 0.35,
  learnTurnGain: 3.0,   // сила выученного поворота, рад/с
  learnClimbGain: 0.9,  // сила выученного подъёма, ед./с
  learnSpeed: 1,        // 1 — муха учится и скорости полёта
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
  foodCount: 170,
  // запах и ветер
  plumeSpread: 0.25,    // ширина шлейфа у источника
  plumeGrowth: 0.3,     // расширение шлейфа на единицу расстояния по ветру
  plumeLength: 3.5,     // затухание шлейфа по ветру
  odorNear: 0.4,        // радиус запаха против ветра
  windSpeed: 0.35,
  antennaOffset: 0.2,   // полубаза антенн (шире реальной, чтобы различать стороны в грубом поле запаха)
  // мир
  arenaHalf: 15.0,      // сад 30×30
  arenaTop: 6.0,        // высота полёта над землёй
  stoneCount: 34,
  plantCount: 24,
  treeCount: 22,        // фруктовые деревья
  bushCount: 24,        // кусты с ягодами
  hillCount: 8,         // холмы
  burrowCount: 14,      // норы в земле (у каждого дерева ещё и дупло)
  seasonLength: 300,    // секунд симуляции на сезон (2 суток); год — 20 минут
  owlCount: 1,          // ночные хищники: совы
  foxCount: 1,          // и лиса
  spiderCount: 8,       // паутины между стеблями и кустами
  hawkCount: 1,         // ястреб (днём)
  snakeCount: 2,        // змеи (днём, проникают в норы, зимой спят)
  martenCount: 1,       // куница (в сумерки и ночью, лазает по деревьям)
  treeFoodShare: 0.35,  // доля фруктов, висящих на деревьях
  predatorCount: 3,
  dayLength: 150,       // секунд на полные сутки
  // хищник (стрекоза)
  predatorSpeed: 0.6,
  predatorChaseSpeed: 1.25,
  predatorChase: 1.6,
  predatorKill: 0.2,
  predatorRest: 12,     // после поимки стрекоза сыта и не охотится
  // эволюция тела: морфа 0 — муха … 1 — мышь (игровая механика, не биология)
  morphMutation: 0.04,  // шум морфы у потомка
  morphSpeed: 1,        // ускорение эволюции тела (множитель мутаций)
  forceStage: -1,       // -1 — тело эволюционирует само; 0…4 — всем задать стадию
  // рост новых синапсов (структурная пластичность)
  structural: 1,
  growEvery: 2,         // раз в сколько секунд пробовать вырастить синапсы
  growTries: 6,         // сколько пар одновременно активных нейронов пробовать
  growInit: 0.12,       // начальный вес нового синапса
  growLearn: 0.6,       // скорость изменения новых синапсов дофамином
  growDecay: 0.01,      // забывание: неподкреплённый синапс слабеет
  growHebb: 0.05,       // совместная активность сама укрепляет связь (правило Хебба)
  growMax: 0.5,         // предел силы выросшего синапса
  pruneBelow: 0.08,     // слабее этого — удаляется
  growCap: 1200,        // максимум выросших синапсов на мозг
  // нейрогенез: мозг растёт новыми нейронами
  neurogenesis: 1,
  newCap: 150,          // максимум новых нейронов
  newRate: 0.15,        // вероятность рождения нейрона за попытку (раз в growEvery секунд)
  newLinks: 4,          // входящих и исходящих связей у нового нейрона
  newInit: 0.3,         // их начальный вес
  // новые действия, которые мозг учится запускать сам
  gates: 1,
  gateBias: -7.5,        // исходная склонность: действие почти никогда не запускается
  freezeTime: 0.5,      // замирание, с
  dashTime: 0.25,       // рывок, с
  gateCooldown: 1.5,
  hideRange: 10,        // как далеко особь ищет укрытие
  ethoWindow: 600,      // дневник поведения помнит последние ~10 минут симуляции
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

// Высота рельефа: сумма плавных холмов {x, z, h, r}
export function terrainHeight(hills, x, z) {
  let y = 0;
  for (const H of hills) {
    const d2 = ((x - H.x) ** 2 + (z - H.z) ** 2) / (H.r * H.r);
    if (d2 < 9) y += H.h * Math.exp(-d2);
  }
  return y;
}
const smooth = (x) => x * x * (3 - 2 * x);
const TAU = Math.PI * 2;

// ---- типы еды ------------------------------------------------------------------
// place: где лежит; eat: диапазон морфы, которой еда доступна; energy: сытность
// eaters — какие стадии едят (по номерам STAGES); season — урожай весной, летом, осенью, зимой
const E = (...keys) => keys.map((k) => ['fly', 'bee', 'beetle', 'cricket', 'lizard', 'shrew', 'mouse', 'hedgehog', 'squirrel', 'hare'].indexOf(k));
export const FOOD_TYPES = [
  { key: 'apple', name: 'Яблоко', size: 0.11, energy: 1.0, place: 'fruit', eaters: E('fly', 'beetle', 'mouse', 'hedgehog', 'squirrel'), count: 14, season: [0.1, 0.7, 1, 0.02], perish: true },
  { key: 'banana', name: 'Банан', size: 0.09, energy: 1.0, place: 'fruit', eaters: E('fly', 'beetle', 'mouse', 'hedgehog', 'squirrel'), count: 8, season: [0.1, 0.8, 0.6, 0.02], perish: true },
  { key: 'grape', name: 'Виноград', size: 0.06, energy: 0.9, place: 'fruit', eaters: E('fly', 'bee', 'beetle', 'mouse', 'squirrel'), count: 12, season: [0.05, 0.6, 1, 0.02], perish: true },
  { key: 'nectar', name: 'Нектар цветка', size: 0.05, energy: 0.6, place: 'flower', eaters: E('fly', 'bee'), count: 18, season: [1, 0.8, 0.2, 0], perish: true },
  { key: 'mushroom', name: 'Гриб', size: 0.09, energy: 0.9, place: 'ground', eaters: E('beetle', 'shrew', 'mouse', 'hedgehog', 'squirrel'), count: 16, season: [0.3, 0.4, 1, 0.05] },
  { key: 'seeds', name: 'Семена', size: 0.07, energy: 0.8, place: 'ground', eaters: E('cricket', 'mouse', 'squirrel', 'hare'), count: 20, season: [0.4, 0.7, 1, 0.3] },
  { key: 'acorn', name: 'Жёлудь', size: 0.07, energy: 1.6, place: 'undertree', eaters: E('mouse', 'squirrel'), count: 20, season: [0.05, 0.2, 1, 0.2] },
  { key: 'berry', name: 'Ягоды', size: 0.06, energy: 0.8, place: 'bush', eaters: E('fly', 'beetle', 'cricket', 'mouse', 'hedgehog', 'squirrel', 'hare'), count: 18, season: [0.1, 1, 0.7, 0.05], perish: true },
  { key: 'cheese', name: 'Сыр', size: 0.1, energy: 2.0, place: 'ground', eaters: E('mouse', 'hedgehog', 'squirrel'), count: 4, season: [0.5, 0.5, 0.5, 0.5] },
  { key: 'worm', name: 'Червяки и личинки', size: 0.07, energy: 1.2, place: 'ground', eaters: E('lizard', 'shrew', 'hedgehog'), count: 22, season: [0.8, 1, 0.8, 0.1] },
  { key: 'clover', name: 'Клевер', size: 0.08, energy: 0.7, place: 'ground', eaters: E('cricket', 'mouse', 'hare'), count: 22, season: [0.9, 1, 0.6, 0.05] },
];
export const SEASONS = ['Весна', 'Лето', 'Осень', 'Зима'];

// ---- хищники: имя, радиус поимки, сколько секунд сыт после охоты ----
export const PREDATORS = {
  dragonfly: { name: 'стрекоза', kill: 0.2, rest: 12 },
  spider: { name: 'паук', kill: 0.35, rest: 20 },
  hawk: { name: 'ястреб', kill: 0.45, rest: 80 },
  snake: { name: 'змея', kill: 0.35, rest: 70 },
  owl: { name: 'сова', kill: 0.32, rest: 50 },
  fox: { name: 'лиса', kill: 0.38, rest: 50 },
  marten: { name: 'куница', kill: 0.4, rest: 50 },
};

// ---- паттерны поведения для дневника ------------------------------------------------
// ev — действие, ctx — ситуация; timed — действие длится (считается время, а не случаи)
export const ETHO_PATTERNS = [
  { key: 'freezeThreat', name: 'Замирание при стрекозе', ev: 'freeze', ctx: 'threat', desc: 'замирает, когда рядом стрекоза: она не видит неподвижную добычу' },
  { key: 'dashFood', name: 'Рывок к еде', ev: 'dash', ctx: 'food', desc: 'делает рывок, когда еда близко' },
  { key: 'dashThreat', name: 'Рывок от стрекозы', ev: 'dash', ctx: 'threat', desc: 'делает рывок, когда рядом стрекоза' },
  { key: 'turnLoss', name: 'Развороты после потери запаха', ev: 'saccade', ctx: 'loss', desc: 'резко разворачивается, когда запах пропал' },
  { key: 'descendOdor', name: 'Снижение по запаху', ev: 'descend', ctx: 'rise', timed: true, flyersOnly: true, desc: 'снижается, пока запах усиливается' },
  { key: 'hideNight', name: 'Укрытие в сумерках', ev: 'hide', ctx: 'dark', desc: 'по своему решению прячется в нору или дупло, когда темнеет' },
  { key: 'hideThreat', name: 'Укрытие от хищника', ev: 'hide', ctx: 'threat', desc: 'по своему решению прячется, когда рядом хищник' },
];

// ---- стадии тела ------------------------------------------------------------------
// Стадии эволюции тела. fly — летает; insect — насекомое (мёрзнет зимой); coldBlood — холоднокровное;
// fur — мех; climber — лазает по деревьям; spines — колючки; armor — панцирь; fast — очень быстрый
export const STAGES = [
  { key: 'fly', name: 'Муха', from: 0, fly: true, insect: true },
  { key: 'bee', name: 'Пчела', from: 0.1, fly: true, insect: true },
  { key: 'beetle', name: 'Жук', from: 0.2, fly: true, insect: true, armor: true },
  { key: 'cricket', name: 'Сверчок', from: 0.3, insect: true },
  { key: 'lizard', name: 'Ящерица', from: 0.4, coldBlood: true },
  { key: 'shrew', name: 'Землеройка', from: 0.5, fur: true },
  { key: 'mouse', name: 'Мышь', from: 0.6, fur: true },
  { key: 'hedgehog', name: 'Ёж', from: 0.7, fur: true, spines: true },
  { key: 'squirrel', name: 'Белка', from: 0.8, fur: true, climber: true },
  { key: 'hare', name: 'Заяц', from: 0.9, fur: true, fast: true },
];
export const STAGE_CENTERS = STAGES.map((g, k) => (k + 0.5) / STAGES.length);
export const stageIndex = (key) => STAGES.findIndex((g) => g.key === key);
export function stageOf(m) {
  let k = 0;
  for (let i = 0; i < STAGES.length; i++) if (m >= STAGES[i].from) k = i;
  return k;
}
// Свойства тела по морфе: размер, полёт, скорость, запас и расход энергии
export function bodyOf(m, cfg) {
  const stage = stageOf(m);
  const S = STAGES[stage];
  const walk = !S.fly;
  return {
    morph: m,
    stage,
    key: S.key,
    size: 1 + 5 * m * m,
    walk,
    climber: !!S.climber,
    insect: !!S.insect,
    fur: !!S.fur,
    coldBlood: !!S.coldBlood,
    spines: !!S.spines,
    armor: !!S.armor,
    maxY: walk ? 0.05 : cfg.arenaTop * (1 - m / 0.3 * 0.85),
    speed: (1 + 0.8 * m) * (S.fast ? 1.5 : S.spines ? 0.7 : 1),
    energyMax: cfg.energyMax * (1 + 1.4 * m),
    drain: 1 + 0.9 * m,
    pad: 0.07 + 0.12 * m,
    antenna: cfg.antennaOffset * (1 + 1.5 * m),
  };
}

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
  const tgt = N < 65536 ? new Uint16Array(E) : new Int32Array(E);   // меньше памяти — быстрее обход
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
    // место под новые нейроны (нейрогенез): они получают номера N, N+1, …
    const newCap = cfg.newCap || 150;
    const M = N + newCap;
    this.newCap = newCap;
    this.w = new Float32Array(net.tgt.length);
    this.I = new Float32Array(M);
    this.v = new Float32Array(M);
    this.spike = new Uint8Array(M);
    this.refr = new Uint8Array(M);
    this.rate = new Float32Array(M);
    this.active = new Int32Array(M);
    this.nActive = 0;
    this.nNew = 0;
    this.nPos = new Float32Array(newCap * 3);
    this.nSide = new Uint8Array(newCap);
    this.nAge = new Float32Array(newCap);
    this.born = 0;
    this.died = 0;
    // выросшие синапсы (структурная пластичность)
    const cap = cfg.growCap || 600;
    this.gSrc = new Uint16Array(cap);
    this.gDst = new Uint16Array(cap);
    this.gW = new Float32Array(cap);
    this.gE = new Float32Array(cap);
    this.gAge = new Float32Array(cap);
    this.gN = 0;
    this.formed = 0;
    this.pruned = 0;
    this.setConfig(cfg);
  }

  clearGrown() { this.gN = 0; this.formed = 0; this.pruned = 0; this.nNew = 0; this.born = 0; this.died = 0; }

  // Всё выросшее: синапсы и новые нейроны (для наследования и переноса между потоками)
  exportGrowth() {
    return {
      gN: this.gN, gSrc: this.gSrc.slice(0, this.gN), gDst: this.gDst.slice(0, this.gN), gW: this.gW.slice(0, this.gN),
      nNew: this.nNew, nPos: this.nPos.slice(0, this.nNew * 3), nSide: this.nSide.slice(0, this.nNew),
    };
  }

  // noise — разброс весов у потомка (0 — точная копия)
  importGrowth(o, rng, noise = 0) {
    const N = this.net.N;
    const nNew = Math.min(o.nNew || 0, this.newCap);
    this.nNew = nNew;
    for (let j = 0; j < nNew * 3; j++) this.nPos[j] = o.nPos[j];
    for (let j = 0; j < nNew; j++) { this.nSide[j] = o.nSide[j]; this.nAge[j] = 0; }
    for (let i = N; i < N + this.newCap; i++) { this.v[i] = 0; this.spike[i] = 0; this.refr[i] = 0; this.rate[i] = 0; }
    let n = 0;
    const lim = N + nNew;
    for (let g = 0; g < (o.gN || 0) && n < this.gSrc.length; g++) {
      if (o.gSrc[g] >= lim || o.gDst[g] >= lim) continue;   // ссылки на нейроны, которых нет
      this.gSrc[n] = o.gSrc[g]; this.gDst[n] = o.gDst[g];
      this.gW[n] = o.gW[g] * (noise ? 1 + noise * (rng() * 2 - 1) : 1);
      this.gE[n] = 0; this.gAge[n] = 0;
      n++;
    }
    this.gN = n; this.formed = 0; this.pruned = 0; this.born = 0; this.died = 0;
  }

  addSyn(a, b, w) {
    if (this.gN >= this.gSrc.length || a === b) return;
    const g = this.gN++;
    this.gSrc[g] = a; this.gDst[g] = b; this.gW[g] = w; this.gE[g] = 0; this.gAge[g] = 0;
    this.formed += 1;
  }

  // Нейрогенез: новый нейрон рождается рядом с активным нейроном и получает связи
  // от нескольких активных нейронов и к нескольким другим
  birth(cfg, rng) {
    if (this.nNew >= this.newCap || this.nActive < 4 || this.gN + 2 * cfg.newLinks > this.gSrc.length) return false;
    const N = this.net.N, data = this.data;
    const parent = this.active[Math.floor(rng() * this.nActive)];
    const j = this.nNew++, idx = N + j;
    for (let c = 0; c < 3; c++) {
      const base = parent < N ? data.pos[parent * 3 + c] : this.nPos[(parent - N) * 3 + c];
      this.nPos[j * 3 + c] = base + (rng() - 0.5) * 0.08;
    }
    const side = parent < N ? data.side[parent] : this.nSide[parent - N];
    this.nSide[j] = side <= 1 ? side : (rng() < 0.5 ? 0 : 1);
    this.nAge[j] = 0;
    this.v[idx] = 0; this.spike[idx] = 0; this.refr[idx] = 0; this.rate[idx] = 0;
    for (let k = 0; k < cfg.newLinks; k++) {
      this.addSyn(this.active[Math.floor(rng() * this.nActive)], idx, cfg.newInit);
      this.addSyn(idx, this.active[Math.floor(rng() * this.nActive)], cfg.newInit * (rng() < 0.3 ? -1 : 1));
    }
    this.born += 1;
    return true;
  }

  // Новый нейрон без входов или без выходов погибает; последний переезжает на его место
  cullNeurons(interval) {
    const N = this.net.N;
    if (!this.nNew) return;
    const inC = new Uint16Array(this.nNew), outC = new Uint16Array(this.nNew);
    for (let g = 0; g < this.gN; g++) {
      if (this.gDst[g] >= N) inC[this.gDst[g] - N]++;
      if (this.gSrc[g] >= N) outC[this.gSrc[g] - N]++;
    }
    for (let j = this.nNew - 1; j >= 0; j--) {
      this.nAge[j] += interval;
      if (this.nAge[j] < 30 || (inC[j] && outC[j])) continue;
      const idx = N + j, last = N + this.nNew - 1;
      for (let g = 0; g < this.gN; g++) {
        if (this.gSrc[g] === idx || this.gDst[g] === idx) {
          const l = --this.gN;
          this.gSrc[g] = this.gSrc[l]; this.gDst[g] = this.gDst[l]; this.gW[g] = this.gW[l]; this.gE[g] = this.gE[l]; this.gAge[g] = this.gAge[l];
          g--;
        }
      }
      if (idx !== last) {
        for (let g = 0; g < this.gN; g++) {
          if (this.gSrc[g] === last) this.gSrc[g] = idx;
          if (this.gDst[g] === last) this.gDst[g] = idx;
        }
        const k = this.nNew - 1;
        for (let c = 0; c < 3; c++) this.nPos[j * 3 + c] = this.nPos[k * 3 + c];
        this.nSide[j] = this.nSide[k]; this.nAge[j] = this.nAge[k];
        this.v[idx] = this.v[last]; this.rate[idx] = this.rate[last]; this.refr[idx] = this.refr[last]; this.spike[idx] = 0;
      }
      this.v[last] = 0; this.rate[last] = 0; this.spike[last] = 0;
      this.nNew -= 1;
      this.died += 1;
    }
  }

  // Потомок получает выросшие синапсы родителя (с небольшим шумом весов)
  copyGrownFrom(o, rng) {
    if (o.nNew !== undefined) { this.importGrowth(o, rng, 0.1); return; }
    const n = Math.min(o.gN || 0, this.gSrc.length);
    for (let g = 0; g < n; g++) {
      this.gSrc[g] = o.gSrc[g]; this.gDst[g] = o.gDst[g];
      this.gW[g] = o.gW[g] * (1 + 0.1 * (rng() * 2 - 1));
      this.gE[g] = 0; this.gAge[g] = 0;
    }
    this.gN = n; this.formed = 0; this.pruned = 0;
  }

  // Рост: новые синапсы между нейронами, которые разрядились одновременно; отмирание слабых
  grow(cfg, rng, interval) {
    const { active, nActive } = this;
    for (let g = 0; g < this.gN; g++) {
      this.gAge[g] += interval;
      if (this.gAge[g] > 20 && Math.abs(this.gW[g]) < cfg.pruneBelow) {
        const last = --this.gN;
        this.gSrc[g] = this.gSrc[last]; this.gDst[g] = this.gDst[last];
        this.gW[g] = this.gW[last]; this.gE[g] = this.gE[last]; this.gAge[g] = this.gAge[last];
        this.pruned += 1;
        g--;
      }
    }
    if (nActive < 2) return;
    const room = cfg.neurogenesis ? Math.floor(this.gSrc.length * 0.67) : this.gSrc.length;
    for (let k = 0; k < cfg.growTries && this.gN < room; k++) {
      const a = active[Math.floor(rng() * nActive)], b = active[Math.floor(rng() * nActive)];
      if (a === b) continue;
      const g = this.gN++;
      this.gSrc[g] = a; this.gDst[g] = b; this.gW[g] = cfg.growInit; this.gE[g] = 0; this.gAge[g] = 0;
      this.formed += 1;
    }
  }

  // Дофамин укрепляет или ослабляет выросшие синапсы: след = пресинаптический спайк × постсинаптическая частота
  plasticity(delta, cfg, dt) {
    const lam = Math.exp(-dt / cfg.eligTau);
    const keep = 1 - cfg.growDecay * dt;
    const k = cfg.growLearn * delta * dt;
    const h = (cfg.growHebb || 0) * dt;
    const { spike, rate, gSrc, gDst, gW, gE } = this;
    for (let g = 0; g < this.gN; g++) {
      gE[g] = gE[g] * lam + spike[gSrc[g]] * rate[gDst[g]];
      // дофамин задаёт знак и силу, совместная активность понемногу укрепляет (сохраняя знак)
      const w = gW[g] * keep + k * gE[g] + h * gE[g] * Math.sign(gW[g] || 1);
      const gm = cfg.growMax || 1.5;
      gW[g] = w > gm ? gm : w < -gm ? -gm : w;
    }
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
    const { off, tgt, groups } = net;
    const NC = net.N;              // нейроны коннектома (у них есть связи из FlyWire)
    const N = NC + this.nNew;      // плюс выросшие нейроны
    // фоновый шум: из общей таблицы со случайного места (быстрее, чем rng на каждый нейрон)
    const sIn = every === 1 ? 1 : (1 - Math.pow(cfg.decay, every)) / (1 - cfg.decay);
    const noise = cfg.noise * sIn;
    let p = (rng() * NOISE_MASK) | 0;
    for (let i = 0; i < N; i++) { I[i] = noise * NOISE_TABLE[p]; p = (p + 1) & NOISE_MASK; }
    for (let a = 0, na = this.nActive; a < na; a++) {
      const i = active[a];
      if (i >= NC) continue;
      for (let k = off[i], end = off[i + 1]; k < end; k++) I[tgt[k]] += w[k];
    }
    for (let g = 0, gn = this.gN; g < gn; g++) if (spike[this.gSrc[g]]) I[this.gDst[g]] += this.gW[g];
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
  // populations: пары популяций [слева, справа] из коннектома + динамическая пара «новые нейроны».
  // Признаки x: разница сторон (p), сумма сторон (p) и смещение (1).
  // Команды: поворот (по разнице сторон), подъём и скорость (по сумме и смещению) — непрерывные;
  // замирание и рывок — дискретные действия (да/нет), которые мозг учится запускать сам.
  constructor(populations, gateBias = -6) {
    const pairs = [];
    for (let j = 0; j + 1 < populations.length; j += 2) {
      pairs.push({ name: populations[j].name.replace(/ слева$/, ''), L: populations[j].idx, R: populations[j + 1].idx });
    }
    pairs.push({ name: 'Новые нейроны', dyn: true });
    this.pairs = pairs;
    const p = pairs.length;
    this.p = p;
    // признаки: разница сторон (p) | сумма сторон (p), освещённость, голод, смещение
    const L = p + 3;
    this.extraNames = ['Освещённость', 'Голод'];
    this.nT = p; this.nC = L; this.nS = L;
    // [начало весов, длина, начало признаков, вид: g — непрерывная, b — да/нет, название]
    const names = [['Подъём', 'g'], ['Скорость', 'g'], ['Замирание', 'b'], ['Рывок', 'b'], ['Укрытие', 'b']];
    this.outs = [[0, p, 0, 'g', 'Поворот']];
    names.forEach(([n, k], i) => this.outs.push([p + i * L, L, p, k, n]));
    this.W = new Float32Array(p + names.length * L);
    this.E = new Float32Array(this.W.length);
    this.gateBias = gateBias;
    this.biasIdx = this.outs.filter((o) => o[3] === 'b').map((o) => o[0] + o[1] - 1);   // смещения дискретных действий
    // исходная осторожность: «укрытие» пробуется реже (вылазка в укрытие дорого стоит)
    this.biasVal = this.outs.filter((o) => o[3] === 'b').map((o) => (o[4] === 'Укрытие' ? gateBias - 1.5 : gateBias));
    this.mean = new Float32Array(2 * p);
    this.vari = new Float32Array(2 * p).fill(1e-4);
    this.x = new Float32Array(2 * p + 3);
    const n = this.outs.length;
    this.noise = new Array(n).fill(0);
    this.action = new Array(n).fill(0);
    this.out = new Array(n).fill(0);
    this.prob = new Array(n).fill(0);
  }

  randomize(rng, scale) {
    for (let k = 0; k < this.W.length; k++) this.W[k] = (rng() * 2 - 1) * scale;
    this.biasIdx.forEach((k, i) => { this.W[k] = this.biasVal[i]; });
    this.resetTraces();
  }

  // Наследование: копия весов родителя с небольшим шумом (старые геномы без новых действий тоже подходят)
  copyFrom(parent, rng, mutation) {
    let range = 0;
    for (let k = 0; k < parent.W.length; k++) range = Math.max(range, Math.abs(parent.W[k]));
    const sigma = mutation * Math.min(Math.max(range, 0.05), 2);
    const same = parent.W.length === this.W.length;
    for (let k = 0; k < this.W.length; k++) {
      const bi = this.biasIdx.indexOf(k);
      const base = same ? parent.W[k] : (bi >= 0 ? this.biasVal[bi] : 0);
      this.W[k] = base + normal(rng) * sigma;
    }
    this.resetTraces();
  }

  resetTraces() {
    this.E.fill(0);
    this.mean.fill(0);
    this.vari.fill(1e-4);
    this.noise.fill(0);
  }

  norm() {
    let s = 0;
    for (let k = 0; k < this.W.length; k++) if (!this.biasIdx.includes(k)) s += this.W[k] * this.W[k];
    return Math.sqrt(s);
  }

  // нормированная активность популяции (отклонение от среднего за ~4 с)
  normFeature(r, j, a) {
    const m = this.mean[j] + (r - this.mean[j]) * a;
    this.mean[j] = m;
    const d = r - m;
    this.vari[j] += (d * d - this.vari[j]) * a;
    return d / Math.sqrt(this.vari[j] + 1e-6);
  }

  popRate(brain, pair, side) {
    const rate = brain.rate;
    if (pair.dyn) {
      const N = brain.net.N;
      let r = 0, c = 0;
      for (let j = 0; j < brain.nNew; j++) if (brain.nSide[j] === side) { r += rate[N + j]; c++; }
      return c ? r / c : 0;
    }
    const idx = side === 0 ? pair.L : pair.R;
    let r = 0;
    for (let q = 0; q < idx.length; q++) r += rate[idx[q]];
    return r / idx.length;
  }

  // allowGates: можно ли сейчас запускать замирание и рывок
  // extra: [освещённость 0…1, голод 0…1] — ощущения, которых нет в подсети коннектома
  step(brain, cfg, explore, dt, rng, allowGates = false, extra = [0.5, 0]) {
    const { p, W, E, x, pairs, outs } = this;
    const a = Math.min(1, dt / 4);
    for (let j = 0; j < p; j++) {
      const l = this.normFeature(this.popRate(brain, pairs[j], 0), 2 * j, a);
      const r = this.normFeature(this.popRate(brain, pairs[j], 1), 2 * j + 1, a);
      x[j] = (l - r) * 0.7;
      x[p + j] = (l + r) * 0.5;
    }
    x[2 * p] = (extra[0] - 0.5) * 2;
    x[2 * p + 1] = (extra[1] - 0.5) * 2;
    x[2 * p + 2] = 1;
    const tau = cfg.exploreTau;
    const sig = cfg.explore * explore;
    const lam = Math.exp(-dt / cfg.eligTau);
    for (let c = 0; c < outs.length; c++) {
      const [w0, len, x0, kind] = outs[c];
      let o = 0;
      for (let k = 0; k < len; k++) o += W[w0 + k] * x[x0 + k];
      this.out[c] = o;
      if (kind === 'g') {
        this.noise[c] += -this.noise[c] / tau * dt + Math.sqrt(2 * dt / tau) * normal(rng);
        const nz = sig * this.noise[c] * (c === 2 ? 0.6 : 1);
        this.action[c] = o + nz;
        for (let k = 0; k < len; k++) E[w0 + k] = E[w0 + k] * lam + x[x0 + k] * nz;
      } else {
        // дискретное действие: запуск с вероятностью σ(o); след = вход × (действие − вероятность)
        const pr = 1 / (1 + Math.exp(-o));
        this.prob[c] = pr;
        let act = 0;
        if (allowGates && cfg.gates) {
          act = rng() < pr ? 1 : 0;
          for (let k = 0; k < len; k++) E[w0 + k] = E[w0 + k] * lam + x[x0 + k] * (act - pr);
        } else {
          for (let k = 0; k < len; k++) E[w0 + k] *= lam;
        }
        this.action[c] = act;
      }
    }
  }

  // Непрерывные команды учатся с обычной скоростью. Дискретные действия — медленнее и сильнее
  // тянутся к исходной осторожности: становятся частыми, только если это стабильно вознаграждается.
  learn(delta, lr, decay, dt, gateScale = 0.25, gateDecay = 0.02) {
    const { W, E } = this;
    const k = lr * delta * dt, keep = 1 - decay * dt;
    const kG = k * gateScale, keepG = 1 - gateDecay * dt;
    let bi = 0;
    for (const [w0, len, , kind] of this.outs) {
      if (kind === 'g') {
        for (let j = w0; j < w0 + len; j++) {
          const w = W[j] * keep + k * E[j];
          W[j] = w > 4 ? 4 : w < -4 ? -4 : w;
        }
      } else {
        const b0 = this.biasVal[bi++];
        for (let j = w0; j < w0 + len - 1; j++) {
          const w = W[j] * keepG + kG * E[j];
          W[j] = w > 3 ? 3 : w < -3 ? -3 : w;
        }
        const j = w0 + len - 1;
        const w = b0 + (W[j] - b0) * keepG + kG * E[j];
        W[j] = w > 4 ? 4 : w < -10 ? -10 : w;
      }
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
    this.hills = this.makeHills();
    this.obstacles = this.makeObstacles();
    this.shelters = this.makeShelters();
    this.food = [];
    // еда всех типов: доли по FOOD_TYPES, общее число — foodCount
    const totalW = FOOD_TYPES.reduce((a, t) => a + t.count, 0);
    FOOD_TYPES.forEach((t, kind) => {
      const n = Math.max(1, Math.round(t.count * this.cfg.foodCount / totalW));
      for (let k = 0; k < n; k++) this.food.push(this.randomFood(kind));
    });
    this.predators = [];
    for (let k = 0; k < Math.max(1, this.cfg.predatorCount); k++) this.predators.push(this.randomPredator('dragonfly'));
    for (let k = 0; k < (this.cfg.owlCount || 0); k++) this.predators.push(this.randomPredator('owl'));
    for (let k = 0; k < (this.cfg.foxCount || 0); k++) this.predators.push(this.randomPredator('fox'));
    for (const [kind, n] of [['spider', this.cfg.spiderCount], ['hawk', this.cfg.hawkCount], ['snake', this.cfg.snakeCount], ['marten', this.cfg.martenCount]]) {
      for (let k = 0; k < (n || 0); k++) this.predators.push(this.randomPredator(kind));
    }
    this.flies = [];
    for (let i = 0; i < Math.max(1, this.cfg.flyCount); i++) this.flies.push(this.makeFly(i));
    this.hero = 0;
  }

  // Совместимость: «муха» — та, за которой следит камера
  get fly() { return this.flies[this.hero]; }
  get predator() { return this.predators[0]; }
  get rate() { return this.fly.brain.rate; }
  get lives() { return this.fly.lives; }
  get eaten() { return this.fly.eaten; }
  get deaths() { return this.fly.deaths; }
  meanRate(arr) { return this.fly.brain.meanRate(arr); }

  setConfig(config) {
    this.cfg = { ...CONFIG, flyCount: this.cfg.flyCount, ...config };
    for (const f of this.flies) {
      f.brain.setConfig(this.cfg);
      if (this.cfg.forceStage >= 0) this.setMorph(f, STAGE_CENTERS[this.cfg.forceStage]);
    }
  }

  setMorph(f, m) {
    const ratio = f.energy / f.energyMax;
    f.body = bodyOf(clamp(m, 0, 1), this.cfg);
    f.energyMax = f.body.energyMax;
    f.energy = ratio * f.energyMax;
  }

  // Переселение чемпиона суперэволюции: синапсы обучения, качества, тело и выросшие связи
  seedChampion(ch) {
    if (!ch || !ch.W) return false;
    const parent = {
      id: -1, generation: ch.generation || 1,
      learner: { W: Float32Array.from(ch.W) }, traits: ch.traits,
      body: { morph: ch.morph ?? 0 },
      brain: ch.grown ? { gN: ch.grown.gN, gSrc: ch.grown.gSrc, gDst: ch.grown.gDst, gW: ch.grown.gW } : undefined,
    };
    for (const f of this.flies) this.respawn(f, null, parent);
    return true;
  }

  resetFly(cause) { this.respawn(this.fly, cause); }

  // ---- дневник поведения ----------------------------------------------------------
  // Следит, в какой ситуации особи что делают. Паттерн «освоен», когда действие заметно
  // чаще случается в своей ситуации, чем в среднем: подъём = P(ситуация | действие) / P(ситуация).
  initEtho() {
    this.etho = ETHO_PATTERNS.map((d) => ({ ...d, n: 0, nCtx: 0, ctxT: 0, totT: 0, status: 'нет данных', learnedAt: null, learnedGen: null }));
  }

  observe(f, dt) {
    if (!this.etho) this.initEtho();
    const flying = f.state === 'fly';
    const odor = (f.odorL + f.odorR) / 2;
    f.odorPeak = Math.max(odor, (f.odorPeak || 0) * Math.exp(-dt / 3));
    if (f.odorPeak > 0.05 && odor < 0.4 * f.odorPeak && this.time - (f.lostAt ?? -1e9) > 3) f.lostAt = this.time;
    const trend = (odor - (f.odorPrev2 ?? odor)) / dt;
    f.odorPrev2 = odor;
    f.odorTrend = (f.odorTrend || 0) * 0.9 + trend * 0.1;
    const vy = (f.y - (f.yPrev ?? f.y)) / dt;
    f.yPrev = f.y;
    const ctx = {
      threat: Math.max(f.threatL, f.threatR) > 0.2,
      food: f.nearFoodDist < 1.5,
      loss: this.time - (f.lostAt ?? -1e9) < 2,
      rise: f.odorTrend > 0.002,
      dark: this.daylight() < 0.3,
    };
    const ev = { freeze: !!f.evFreeze, dash: !!f.evDash, saccade: !!f.evSaccade, descend: !f.body.walk && vy < -0.15, hide: !!f.evHide };
    f.evFreeze = f.evDash = f.evSaccade = f.evHide = false;
    if (!flying) return;
    for (const P of this.etho) {
      if (P.flyersOnly && f.body.walk) continue;
      const c = ctx[P.ctx];
      P.totT += dt;
      if (c) P.ctxT += dt;
      // для «длительных» паттернов событие — каждый шаг в этом состоянии
      if (ev[P.ev]) { const wgt = P.timed ? dt : 1; P.n += wgt; if (c) P.nCtx += wgt; }
    }
  }

  decayEtho(dt) {
    if (!this.etho) return;
    const k = Math.exp(-dt / this.cfg.ethoWindow);
    for (const P of this.etho) {
      P.n *= k; P.nCtx *= k; P.ctxT *= k; P.totT *= k;
    }
    this.ethoTimer = (this.ethoTimer || 0) + dt;
    if (this.ethoTimer >= 5) { this.ethoTimer = 0; this.ethogram(); }
  }

  ethogram() {
    if (!this.etho) this.initEtho();
    const maxGen = Math.max(...this.flies.map((f) => f.generation));
    return this.etho.map((P) => {
      const base = P.totT > 0 ? P.ctxT / P.totT : 0;
      const share = P.n > 0 ? P.nCtx / P.n : 0;
      const lift = base > 0.005 ? share / base : 0;
      const enough = P.n >= (P.timed ? 3 : 6);
      let status = 'нет данных';
      if (P.n >= (P.timed ? 1 : 3)) {
        if (enough && lift >= 2.5) status = 'освоен';
        else if (lift >= 1.5) status = 'складывается';
        else if (enough && lift < 0.6) status = 'избегается';
        else status = 'случайно';
      }
      if (status === 'освоен' && !P.learnedAt) {
        P.learnedAt = this.time; P.learnedGen = maxGen;
        this.logEvent(`Колония освоила новый паттерн: ${P.name.toLowerCase()}`);
      }
      P.status = status;
      return { key: P.key, name: P.name, desc: P.desc, events: P.n, lift, base, status, learnedAt: P.learnedAt, learnedGen: P.learnedGen };
    });
  }

  exportEtho() { return this.etho ? this.etho.map((P) => ({ key: P.key, n: P.n, nCtx: P.nCtx, ctxT: P.ctxT, totT: P.totT })) : null; }

  // Сложить наблюдения из турбопотоков
  mergeEtho(list) {
    if (!this.etho) this.initEtho();
    for (const part of list) {
      if (!part) continue;
      for (const q of part) {
        const P = this.etho.find((x) => x.key === q.key);
        if (P) { P.n += q.n; P.nCtx += q.nCtx; P.ctxT += q.ctxT; P.totT += q.totT; }
      }
    }
    this.ethogram();
  }

  // Состояние особей для переноса в турбопоток и обратно (без потерь, без мутаций)
  exportGenomes() {
    return this.flies.map((f) => ({
      W: Float32Array.from(f.learner.W), traits: { ...f.traits }, morph: f.body.morph, generation: f.generation,
      lives: f.lives, eaten: f.eaten, deaths: { ...f.deaths },
      grown: f.brain.exportGrowth(),
    }));
  }

  importGenomes(list) {
    if (!list) return;
    this.flies.forEach((f, i) => {
      const g = list[i];
      if (!g) return;
      if (g.W.length === f.learner.W.length) f.learner.W.set(g.W);
      f.learner.resetTraces();
      f.traits = { ...g.traits };
      f.body = bodyOf(g.morph, this.cfg);
      f.energyMax = f.body.energyMax;
      f.energy = Math.min(f.energy, f.energyMax);
      f.generation = g.generation;
      f.lives = g.lives; f.eaten = g.eaten; f.deaths = { ...g.deaths };
      f.brain.importGrowth(g.grown, this.rng, 0);
    });
  }

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

  // освещённость: летом дни длиннее, зимой короче
  daylight() {
    const base = 0.5 + 0.5 * Math.cos(TAU * this.time / this.cfg.dayLength);
    const shift = [0, 0.15, 0, -0.15][this.season().k];
    return clamp(base + shift, 0, 1);
  }

  logEvent(text) {
    this.events.push({ t: this.time, text });
    if (this.events.length > 10) this.events.shift();
  }

  // ---- объекты мира ----------------------------------------------------------

  makeHills() {
    const out = [];
    const h = this.cfg.arenaHalf;
    for (let k = 0; k < this.cfg.hillCount; k++) {
      out.push({ x: (this.rng() * 2 - 1) * (h - 2), z: (this.rng() * 2 - 1) * (h - 2), h: 0.4 + this.rng() * 1.1, r: 2 + this.rng() * 2.8 });
    }
    return out;
  }

  // высота земли в точке (сумма плавных холмов)
  groundAt(x, z) { return terrainHeight(this.hills, x, z); }

  season() {
    const y = this.time / this.cfg.seasonLength;
    return { k: Math.floor(y) % 4, frac: y % 1, year: Math.floor(y / 4) + 1, day: Math.floor((this.time % this.cfg.seasonLength) / this.cfg.dayLength) + 1 };
  }

  // Укрытия: норы на земле и дупла в деревьях; у лисы своя нора
  makeShelters() {
    const out = [];
    const h = this.cfg.arenaHalf - 1;
    for (let k = 0; k < this.cfg.burrowCount; k++) {
      let x = 0, z = 0;
      for (let t = 0; t < 60; t++) { x = (this.rng() * 2 - 1) * h; z = (this.rng() * 2 - 1) * h; if (this.clearOfObstacles(x, z, 0.4)) break; }
      out.push({ kind: 'burrow', x, z, y: this.groundAt(x, z), heading: this.rng() * TAU, stash: 0 });
    }
    for (const t of this.obstacles) {
      if (t.kind !== 'tree') continue;
      const a = this.rng() * TAU;
      out.push({ kind: 'hollow', x: t.x + Math.cos(a) * (t.r + 0.02), z: t.z + Math.sin(a) * (t.r + 0.02), y: t.base + t.height * 0.55, heading: a, tree: t, stash: 0 });
    }
    return out;
  }

  canUse(f, sh) {
    if (sh.kind === 'burrow') return f.body.walk;
    if (sh.kind === 'hollow') return f.body.climber || !f.body.walk;   // белка; насекомые — в щели коры
    return false;
  }

  nearestShelter(f, maxD, kind = null) {
    let best = null, bd = maxD;
    for (const sh of this.shelters) {
      if (!this.canUse(f, sh) || (kind && sh.kind !== kind)) continue;
      const d = Math.hypot(sh.x - f.x, sh.z - f.z, (sh.y - f.y) * 0.5);
      if (d < bd) { bd = d; best = sh; }
    }
    return best;
  }

  makeObstacles() {
    const out = [];
    const h = this.cfg.arenaHalf;
    const place = (kind, count, rMin, rMax, hMin, hMax, gap = 0.5) => {
      let made = 0, tries = 0;
      while (made < count && tries < 2000) {
        tries++;
        const r = rMin + this.rng() * (rMax - rMin);
        const x = (this.rng() * 2 - 1) * (h - r - 0.4);
        const z = (this.rng() * 2 - 1) * (h - r - 0.4);
        if (Math.hypot(x, z) < 0.9) continue;
        if (out.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r + Math.max(gap, o.gap || 0))) continue;
        const height = hMin + this.rng() * (hMax - hMin);
        const o = { kind, x, z, r, height, gap, seed: Math.floor(this.rng() * 1e6), base: this.groundAt(x, z) };
        if (kind === 'tree') { o.canopy = 1.0 + this.rng() * 0.7; o.canopyY = o.base + height * 0.78; }
        out.push(o);
        made++;
      }
    };
    place('tree', this.cfg.treeCount, 0.22, 0.36, 3.0, 5.0, 2.6);
    place('bush', this.cfg.bushCount, 0.35, 0.7, 0.5, 1.0, 0.8);
    place('stone', this.cfg.stoneCount, 0.18, 0.4, 0.18, 0.55);
    place('plant', this.cfg.plantCount, 0.05, 0.08, 1.2, 2.1);
    return out;
  }

  clearOfObstacles(x, z, pad) {
    return !this.obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + pad);
  }

  // Еда типа kind (см. FOOD_TYPES): фрукты на земле, камнях и ветках, нектар на цветах,
  // грибы, семена и сыр на земле, жёлуди под деревьями, ягоды на кустиках
  randomFood(kind) {
    const T = FOOD_TYPES[kind];
    const size = T.size;
    const max = this.cfg.foodAmount * (0.6 + 0.8 * this.rng());
    const h = this.cfg.arenaHalf - 0.4;
    const pick = (arr) => arr[Math.floor(this.rng() * arr.length)];
    const stones = this.obstacles.filter((o) => o.kind === 'stone');
    const trees = this.obstacles.filter((o) => o.kind === 'tree');
    const plants = this.obstacles.filter((o) => o.kind === 'plant');
    const bushes = this.obstacles.filter((o) => o.kind === 'bush');
    const groundSpot = () => {
      let x = 0, z = 0;
      for (let k = 0; k < 60; k++) {
        x = (this.rng() * 2 - 1) * h; z = (this.rng() * 2 - 1) * h;
        if (this.clearOfObstacles(x, z, 0.15)) break;
      }
      return [x, z];
    };
    let x = 0, z = 0, base = 0, hanging = false;
    if (T.place === 'fruit' && trees.length && this.rng() < this.cfg.treeFoodShare) {
      const t = pick(trees);
      const a = this.rng() * TAU, rr = t.r + 0.25 + this.rng() * (t.canopy * 0.7);
      x = t.x + Math.cos(a) * rr; z = t.z + Math.sin(a) * rr;
      base = t.canopyY - t.canopy * (0.3 + this.rng() * 0.5);
      hanging = true;
    } else if (T.place === 'fruit' && stones.length && this.rng() < 0.3) {
      const o = pick(stones);
      x = o.x + (this.rng() - 0.5) * o.r * 0.6; z = o.z + (this.rng() - 0.5) * o.r * 0.6;
      base = o.base + o.height;
    } else if (T.place === 'flower' && plants.length) {
      const o = pick(plants);
      x = o.x; z = o.z; base = o.base + o.height;
    } else if (T.place === 'undertree' && trees.length) {
      const t = pick(trees);
      const a = this.rng() * TAU, rr = t.r + 0.2 + this.rng() * t.canopy;
      x = t.x + Math.cos(a) * rr; z = t.z + Math.sin(a) * rr;
      base = this.groundAt(x, z);
    } else if (T.place === 'bush' && bushes.length) {
      // ягоды на кусте
      const b = pick(bushes);
      const a = this.rng() * TAU;
      x = b.x + Math.cos(a) * b.r * 0.85; z = b.z + Math.sin(a) * b.r * 0.85;
      base = b.base + b.height * (0.4 + this.rng() * 0.45);
    } else {
      [x, z] = groundSpot();
      base = this.groundAt(x, z);
    }
    return { kind, x, z, y: base + size * 0.7, base, size, amount: max, max, alive: true, regrowAt: 0, hanging };
  }

  canEat(f, food) {
    return FOOD_TYPES[food.kind].eaters.includes(f.body.stage);
  }

  // Хищники: стрекоза (днём, ловит летящих насекомых), сова (ночью, ловит зверьков и крупных
  // насекомых вне укрытий), лиса (в сумерки и ночью, ловит зверьков на земле)
  randomPredator(kind = 'dragonfly') {
    const h = this.cfg.arenaHalf - 0.6;
    const x = (this.rng() * 2 - 1) * h, z = (this.rng() * 2 - 1) * h;
    const p = { kind, x, y: this.groundAt(x, z) + 1.4, z, heading: this.rng() * TAU, speed: this.cfg.predatorSpeed, cooldown: 4, hunting: false, active: true, resting: false };
    if (kind === 'owl') {
      const trees = this.obstacles.filter((o) => o.kind === 'tree');
      const t = trees.length ? trees[Math.floor(this.rng() * trees.length)] : null;
      p.perch = t ? { x: t.x + 0.3, y: t.canopyY + 0.2, z: t.z } : { x, y: 3, z };
      Object.assign(p, p.perch);
    } else if (kind === 'fox') {
      const a = this.rng() * TAU;
      const dx = Math.cos(a) * (h - 0.5), dz = Math.sin(a) * (h - 0.5);
      p.den = { x: dx, z: dz, y: this.groundAt(dx, dz) };
      Object.assign(p, p.den);
      this.shelters.push({ kind: 'den', x: dx, z: dz, y: p.den.y, heading: a + Math.PI, stash: 0 });
    } else if (kind === 'spider') {
      // паутина между стеблем или кустом и соседним местом, на высоте полёта насекомых
      const hosts = this.obstacles.filter((o) => o.kind === 'plant' || o.kind === 'bush');
      const o = hosts.length ? hosts[Math.floor(this.rng() * hosts.length)] : { x, z, base: 0, height: 1, r: 0.1 };
      const a = this.rng() * TAU;
      p.x = o.x + Math.cos(a) * (o.r + 0.35); p.z = o.z + Math.sin(a) * (o.r + 0.35);
      p.y = o.base + 0.35 + this.rng() * Math.max(0.3, o.height * 0.7);
      p.heading = a; p.speed = 0;
    } else if (kind === 'hawk') {
      const trees = this.obstacles.filter((o) => o.kind === 'tree').sort((u, v) => (v.base + v.height) - (u.base + u.height));
      const t = trees[Math.floor(this.rng() * Math.min(3, trees.length))];
      p.perch = t ? { x: t.x, y: t.base + t.height + 0.2, z: t.z } : { x, y: 5, z };
      Object.assign(p, p.perch);
    } else if (kind === 'snake') {
      const burrows = this.shelters.filter((q) => q.kind === 'burrow');
      p.home = burrows.length ? burrows[Math.floor(this.rng() * burrows.length)] : { x, y: this.groundAt(x, z), z };
      Object.assign(p, { x: p.home.x, y: p.home.y, z: p.home.z });
    } else if (kind === 'marten') {
      const hollows = this.shelters.filter((q) => q.kind === 'hollow');
      p.home = hollows.length ? hollows[Math.floor(this.rng() * hollows.length)] : { x, y: this.groundAt(x, z), z };
      Object.assign(p, { x: p.home.x, y: p.home.y, z: p.home.z });
    }
    return p;
  }

  predActive(p, daylight) {
    if (p.kind === 'owl') return daylight < 0.35;
    if (p.kind === 'fox') return daylight < 0.45;
    if (p.kind === 'marten') return daylight < 0.5;
    if (p.kind === 'spider') return true;
    if (p.kind === 'hawk') return daylight > 0.35;
    if (p.kind === 'snake') return daylight > 0.25 && this.season().k !== 3;   // зимой змея спит
    return daylight > 0.3;
  }

  // может ли хищник поймать особь
  // под кроной дерева или у куста особь не видна с высоты
  underCover(f) {
    for (const o of this.obstacles) {
      const d = Math.hypot(o.x - f.x, o.z - f.z);
      if ((o.kind === 'tree' && d < o.canopy * 0.9) || (o.kind === 'bush' && d < o.r + 0.25)) return true;
    }
    return false;
  }

  // ignoreShelter — проверить, опасен ли хищник этой особи вообще (без учёта укрытия)
  canCatch(p, f, ignoreShelter = false) {
    const b = f.body;
    const airborne = !b.walk && (f.state === 'fly' || f.state === 'escape' || f.state === 'hide');
    if (f.state === 'shelter' && !ignoreShelter) {
      // змея проникает в норы за мелкими зверьками
      return p.kind === 'snake' && f.shelter && f.shelter.kind === 'burrow' && b.stage >= 3 && b.stage <= 6;
    }
    switch (p.kind) {
      case 'dragonfly': return airborne && !b.armor;                         // жука с панцирем не берёт
      case 'spider': return airborne && !b.armor;                            // паутина держит мух и пчёл
      case 'owl': return b.stage >= 1 && b.stage !== stageIndex('bee');
      case 'fox': return b.walk && !f.inTree && !b.spines;                   // ежа лиса не берёт
      case 'hawk': return b.walk && !f.inTree && !b.spines && b.stage >= 4 && !this.underCover(f);   // охотится только на открытом месте
      case 'snake': return b.walk && !f.inTree && b.stage >= 3 && b.stage <= 6;
      case 'marten': return b.walk && !b.spines && b.stage >= 5;            // лазает и по деревьям
      default: return false;
    }
  }

  makeFly(id) {
    const f = {
      id,
      brain: new Brain(this.data, this.net, this.cfg),
      learner: new Learner(this.net.groups.populations, this.cfg.gateBias),
      lives: 0, eaten: 0, deaths: { starve: 0, predator: 0, cold: 0 },
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

  // forcedParent: родитель при принудительном отборе (суперэволюция) или мигрант с другого острова
  respawn(f, cause, forcedParent = null) {
    const cfg = this.cfg;
    if (cause) {
      f.deaths[cause] += 1;
      this.totalDeaths += 1;
      const who = (PREDATORS[f.lastKiller] || {}).name || 'хищник';
      const name = f.body ? STAGES[f.body.stage].name : 'Муха';
      this.logEvent(`${name} ${f.id + 1}: ${cause === 'predator' ? `поймала ${who}` : cause === 'cold' ? 'замёрзла' : 'умерла от голода'}`);
    }
    // Новая муха: свои качества и либо выученные синапсы лучшей мухи с мутациями,
    // либо почти нулевые синапсы (наивная муха)
    const parent = forcedParent || (cause && cfg.inherit ? this.bestParent(f) : null);
    if (parent) {
      f.learner.copyFrom(parent.learner, this.rng, cfg.mutation);
      f.generation = parent.generation + 1;
      f.parent = parent.id >= 0 ? parent.id : null;
      if (!forcedParent) this.logEvent(`Родилась муха ${f.id + 1}: потомок мухи ${parent.id + 1}, поколение ${f.generation}`);
    } else {
      f.learner.randomize(this.rng, 0.002);
      f.generation = cause ? 1 : (f.generation || 1);
      f.parent = null;
    }
    // качества: у потомка — родительские с небольшой мутацией (наследуются), иначе случайные
    const sp = cfg.traitSpread;
    const keys = ['odor', 'contact', 'motor', 'learn', 'explore'];
    // морфа тела: у потомка — родительская с мутацией, иначе — муха
    let morph;
    if (cfg.forceStage >= 0) morph = STAGE_CENTERS[cfg.forceStage];
    else if (parent && parent.body) morph = parent.body.morph + normal(this.rng) * cfg.morphMutation * cfg.morphSpeed;
    else morph = Math.abs(normal(this.rng)) * 0.03;
    f.body = bodyOf(clamp(morph, 0, 1), cfg);
    f.energyMax = f.body.energyMax;
    // выросшие синапсы: потомок получает родительские
    if (parent && parent.brain && parent.brain.gN !== undefined) f.brain.copyGrownFrom(parent.brain, this.rng);
    else f.brain.clearGrown();
    f.traits = {};
    for (const k of keys) {
      const v = parent && parent.traits ? parent.traits[k] * (1 + 0.06 * normal(this.rng)) : 1 + sp * (this.rng() * 2 - 1);
      f.traits[k] = clamp(v, 0.5, 1.6);
    }
    const h = this.cfg.arenaHalf - 0.8;
    let x = 0, z = 0;
    for (let k = 0; k < 60; k++) {
      x = (this.rng() * 2 - 1) * h;
      z = (this.rng() * 2 - 1) * h;
      if (this.clearOfObstacles(x, z, 0.3)) break;
    }
    Object.assign(f, {
      x, y: this.groundAt(x, z) + 0.7, z,
      inTree: null, shelter: null, carry: false, home: null,
      heading: this.rng() * TAU,
      speed: 0,
      energy: f.energyMax,
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
  // f — кто нюхает: каждая форма чувствует запах только своей еды
  odorAt(x, y, z, f = null) {
    const cfg = this.cfg;
    const wx = this.wind.x, wz = this.wind.z;
    let s = 0;
    const who = f;
    for (const f of this.food) {
      if (!f.alive) continue;
      if (who && who.body && !this.canEat(who, f)) continue;
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
      if (y > o.base + o.height + 0.1) continue;
      const v = Math.max(0, 1 - (Math.hypot(x - o.x, z - o.z) - o.r) / 0.3);
      if (v > best) best = v;
    }
    return best;
  }

  // Выталкивает объект из камней и стеблей (если он ниже их верхушки)
  pushOut(p, pad) {
    for (const o of this.obstacles) {
      if (p.y > o.base + o.height + 0.03) continue;
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
      if (f.y > o.base + o.height + 0.03) continue;
      if (f.inTree === o) continue;                     // белка на своём дереве
      if ((f.state === 'hide' || f.state === 'cache') && f.shelter && f.shelter.tree === o) continue;   // летит к дуплу в этом дереве
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
    const a = f.body ? f.body.antenna : this.cfg.antennaOffset;
    const rx = Math.cos(f.heading), rz = -Math.sin(f.heading); // вектор «вправо»
    const lx = f.x + rx * a, lz = f.z + rz * a;
    const qx = f.x - rx * a, qz = f.z - rz * a;
    f.odorL = this.odorAt(lx, f.y, lz, f);
    f.odorR = this.odorAt(qx, f.y, qz, f);
    f.contactL = Math.max(this.wallProximity(lx, lz), this.obstacleProx(lx, f.y, lz));
    f.contactR = Math.max(this.wallProximity(qx, qz), this.obstacleProx(qx, f.y, qz));
    // угроза — от ближайшей стрекозы
    let p = this.predators[0], pd = Infinity;
    for (const q of this.predators) {
      if (!q.active || q.kind === 'spider' || q.resting) continue;       // паутину особи не чувствуют
      const d = (q.x - f.x) ** 2 + (q.y - f.y) ** 2 + (q.z - f.z) ** 2;
      if (d < pd) { pd = d; p = q; }
    }
    f.nearPred = p;
    f.nearPredDist = Math.sqrt(pd);
    if (f.state === 'shelter' || !p.active) { f.threatL = 0; f.threatR = 0; return; }
    const sense = this.cfg.predatorSense;
    // зверьки слышат дальше: радиус растёт с размером тела
    const range = sense * (1 + f.body.morph * 1.5);
    f.threatL = Math.max(0, 1 - Math.hypot(lx - p.x, f.y - p.y, lz - p.z) / range);
    f.threatR = Math.max(0, 1 - Math.hypot(qx - p.x, f.y - p.y, qz - p.z) / range);
  }

  nearestFood(f) {
    let best = null, bd = Infinity;
    for (const food of this.food) {
      if (!food.alive || !this.canEat(f, food)) continue;
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
    const hunger = 1 - f.energy / f.energyMax;
    const tr = f.traits;
    // Плавное кодирование: без стимула рецептор молчит, с ростом стимула частота
    // растёт и насыщается (как у настоящих рецепторных нейронов)
    const olf = (o) => cfg.olfBase + 0.4 * cfg.odorGain * tr.odor * o / (o + 0.15) + hunger * cfg.hungerGain * 0.15;
    const mech = (c, t) => cfg.mechBase + 0.3 * (c * cfg.contactGain * tr.contact + t * cfg.predatorGain);
    const physEvery = Math.max(1, cfg.brainEvery | 0);
    const every = physEvery * Math.max(1, Math.round(dt * 60));   // сколько шагов по 1/60 с покрывает шаг мозга
    f.brainTick = (f.brainTick || 0) + 1;
    const brainNow = f.brainTick % physEvery === 0;
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
    let activity = cfg.nightActivity + (1 - cfg.nightActivity) * smooth(clamp((daylight - 0.1) / 0.5, 0, 1));
    if (f.body.coldBlood) activity *= clamp(daylight * 1.4, 0.15, 1);   // ящерица греется на солнце
    const threat = Math.max(f.threatL, f.threatR);
    const p = f.nearPred || this.predators[0];
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
        const gain = Math.min(cfg.feedRate * dt * FOOD_TYPES[food.kind].energy, food.amount);
        f.energy = Math.min(f.energyMax, f.energy + gain);
        food.amount -= gain;
        if (food.amount <= 0.01) { food.alive = false; food.amount = 0; food.regrowAt = this.time + cfg.foodRegrow; }
        if (f.energy >= f.energyMax * 0.97 || !food.alive) {
          f.state = 'fly'; f.stateTime = 0; f.y += 0.06; f.feedFood = null;
        }
      }
    } else if (f.state === 'rest') {
      f.speed = 0;
      targetY = this.groundAt(f.x, f.z) + 0.03;
      if (daylight > 0.35 && f.stateTime > 3) { f.state = 'fly'; f.stateTime = 0; }
    } else if (f.state === 'hide' || f.state === 'cache') {
      // бег (полёт) к укрытию; с жёлудем — к своему дуплу
      const sh = f.shelter;
      const dx = sh.x - f.x, dz = sh.z - f.z, dy = sh.y - f.y;
      const d = Math.hypot(dx, dz, dy * 0.6);
      f.heading = Math.atan2(dx, dz);
      f.speed = Math.min(1.5 * f.body.speed, d * 3 + 0.3);
      if (f.body.climber || !f.body.walk) { f.y += clamp(dy, -1, 1) * Math.min(1, dt * 3); f.inTree = sh.tree || null; }
      targetY = f.y;
      if (d < 0.3) {
        f.x = sh.x; f.z = sh.z; f.y = sh.y;
        if (f.state === 'cache') {
          sh.stash += 1; f.carry = false;
          if (f.id === this.hero) this.logEvent(`Белка ${f.id + 1} спрятала жёлудь в дупле (запас ${sh.stash})`);
          f.state = 'fly'; f.inTree = sh.tree || null;
        } else {
          f.state = 'shelter'; f.safeTime = 0;
        }
        f.stateTime = 0;
      } else if (f.stateTime > 15) { f.state = 'fly'; f.stateTime = 0; f.carry = false; }
    } else if (f.state === 'shelter') {
      // в укрытии: хищники не видят, расход энергии ниже
      const sh = f.shelter;
      f.x = sh.x; f.z = sh.z; f.y = sh.y; f.speed = 0; targetY = f.y;
      // опасны только те хищники, которые ловят такую особь
      let danger = false;
      for (const q of this.predators) {
        if (!q.active || q.kind === 'spider') continue;
        const relevant = this.canCatch(q, f, true);
        const r = q.kind === 'dragonfly' ? 2.5 : 6;   // стрекоза замечает добычу только вблизи
        if (relevant && Math.hypot(q.x - f.x, q.z - f.z) < r) { danger = true; break; }
      }
      f.safeTime = danger ? 0 : (f.safeTime || 0) + dt;
      // белка зимой ест запасы из дупла
      if (sh.kind === 'hollow' && sh.stash > 0 && hunger > 0.4) {
        sh.stash -= 1;
        f.energy = Math.min(f.energyMax, f.energy + 0.5 * f.energyMax);
        f.eaten += 1; f.eatenLife += 1; this.totalEaten += 1;
        if (f.id === this.hero) this.logEvent(`${STAGES[f.body.stage].name} ${f.id + 1} съела запас из дупла (осталось ${sh.stash})`);
      }
      const night = daylight < 0.3;
      if (f.stateTime > 4 && f.safeTime > 3 && (!night || hunger > 0.75 || f.stateTime > 120)) {
        f.state = 'fly'; f.stateTime = 0; f.inTree = sh.kind === 'hollow' ? sh.tree : null;
      }
    } else {
      // полёт: скорость с инерцией, курс — плавный дрейф плюс саккады
      let target = clamp(cfg.motorSpeed * tr.motor * (rL + rR) / 2, 0, 1.5) * activity;
      let drive = cfg.motorTurn * tr.motor * (rL - rR);
      // выученные команды: поворот и подъём
      f.freezeLeft = Math.max(0, (f.freezeLeft || 0) - dt);
      f.dashLeft = Math.max(0, (f.dashLeft || 0) - dt);
      f.gateCool = Math.max(0, (f.gateCool || 0) - dt);
      const canGate = cfg.gates && f.freezeLeft <= 0 && f.dashLeft <= 0 && f.gateCool <= 0;
      if (brainNow) {
        f.learner.step(f.brain, cfg, tr.explore, dt * physEvery, this.rng, canGate, [daylight, hunger]);
        if (canGate && f.learner.action[3]) { f.freezeLeft = cfg.freezeTime; f.gateCool = cfg.gateCooldown; f.evFreeze = true; }
        else if (canGate && f.learner.action[4]) { f.dashLeft = cfg.dashTime; f.gateCool = cfg.gateCooldown; f.evDash = true; }
        else if (canGate && f.learner.action[5]) {
          // выученное решение спрятаться: бежать к ближайшему укрытию
          const sh = this.nearestShelter(f, cfg.hideRange);
          f.gateCool = cfg.gateCooldown; f.evHide = true;
          if (sh) { f.state = 'hide'; f.stateTime = 0; f.shelter = sh; }
        }
      }
      const learnedTurn = cfg.learnTurnGain * Math.tanh(f.learner.action[0]);
      const learnedClimb = cfg.learnClimbGain * Math.tanh(f.learner.action[1]);
      drive += learnedTurn;
      f.climb = learnedClimb;
      // выученная скорость: множитель от 0.55 до 1.8
      if (cfg.learnSpeed) target *= Math.exp(0.6 * Math.tanh(f.learner.action[2]));
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
      target *= f.body.speed;
      // новые действия: замирание — остановка без поворотов, рывок — короткое ускорение
      if (f.freezeLeft > 0) { target = 0; drive = 0; f.climb = 0; }
      else if (f.dashLeft > 0) target = clamp(target * 2.2, 0.9, 2.6);
      f.speed += (target - f.speed) * Math.min(1, dt * (f.freezeLeft > 0 ? 10 : 3));
      f.heading += 0.35 * drive * dt * activity;
      f.saccadeAcc = f.saccadeAcc * (1 - dt * 0.8) + drive * dt;
      if (f.saccadeLeft > 0) {
        f.heading += f.saccadeRate * dt;
        f.saccadeLeft -= dt;
      } else if (Math.abs(f.saccadeAcc) > cfg.saccadeThreshold) {
        f.evSaccade = true;
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
      f.nearFoodDist = food ? Math.hypot(food.x - f.x, food.z - f.z) : Infinity;
      if (food) {
        const d3 = Math.hypot(food.x - f.x, food.z - f.z, (food.y + food.size * 0.75) - f.y);
        const hoard = f.body.climber && food.kind === 6 && this.season().k === 2 && hunger < 0.2;
        if (hoard && d3 < cfg.landRadius * (1 + 1.5 * f.body.morph)) {
          // инстинкт запасания: сытая белка осенью уносит жёлудь в своё дупло
          if (!f.home) f.home = this.nearestShelter(f, 40, 'hollow');
          if (f.home) {
            const take = Math.min(food.amount, 30);
            food.amount -= take;
            if (food.amount <= 0.01) { food.alive = false; food.amount = 0; food.regrowAt = this.time + cfg.foodRegrow; }
            f.carry = true; f.state = 'cache'; f.shelter = f.home; f.stateTime = 0;
          }
        } else if (d3 < cfg.landRadius * (1 + 1.5 * f.body.morph) && hunger > 0.12) {
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
      if (daylight < 0.15 && this.rng() < dt * 0.4) {
        const sh = this.nearestShelter(f, 5);
        if (sh) { f.state = 'hide'; f.shelter = sh; } else f.state = 'rest';
        f.stateTime = 0;
      }
      // белка зимой помнит свой запас и возвращается к нему, когда голодна
      if (f.body.climber && this.season().k === 3 && hunger > 0.5 && f.home && f.home.stash > 0) {
        f.state = 'hide'; f.shelter = f.home; f.stateTime = 0;
      }
    }

    if (f.state !== 'feed') {
      const climb = f.state === 'escape' ? 1.6 : 0.8;
      // бескрылые ходят по земле (по холмам), летуны держатся над землёй; белка может быть на дереве
      const gy = this.groundAt(f.x, f.z);
      if (f.state === 'hide' || f.state === 'cache' || f.state === 'shelter') { /* высота задана выше */ }
      else if (f.inTree) f.y = f.inTree.canopyY - f.inTree.canopy * 0.55;
      else if (f.body.walk) f.y = gy + 0.03 + 0.02 * f.body.size;
      else f.y = clamp(f.y + clamp(1.5 * (targetY - f.y), -climb, climb) * dt, gy + 0.03, gy + f.body.maxY);
      f.x += Math.sin(f.heading) * f.speed * dt;
      f.z += Math.cos(f.heading) * f.speed * dt;
      // отскок от бортиков: курс отражается, скорость падает
      const h = cfg.arenaHalf - 0.05;
      let bump = false;
      if (f.x > h || f.x < -h) { f.x = clamp(f.x, -h, h); f.heading = -f.heading; bump = true; }
      if (f.z > h || f.z < -h) { f.z = clamp(f.z, -h, h); f.heading = Math.PI - f.heading; bump = true; }
      // белка: залезает на дерево, если хочет вверх (выученная команда подъёма), и спускается, если вниз
      if (f.body.climber && f.state === 'fly') {
        if (!f.inTree && f.climb > 0.25) {
          for (const o of this.obstacles) if (o.kind === 'tree' && Math.hypot(o.x - f.x, o.z - f.z) < o.r + 0.5) { f.inTree = o; break; }
        } else if (f.inTree && f.climb < -0.35) f.inTree = null;
        if (f.inTree) {
          const t = f.inTree, dx = f.x - t.x, dz = f.z - t.z, d = Math.hypot(dx, dz), maxR = t.canopy * 0.9;
          if (d > maxR) { f.x = t.x + dx / d * maxR; f.z = t.z + dz / d * maxR; f.heading += Math.PI * 0.8; }
        }
      } else if (!f.body.climber) f.inTree = null;
      if (this.bounceObstacles(f, f.body.pad)) {
        bump = true;
        f.y = Math.min(cfg.arenaTop, f.y + 0.12);   // после удара муха подскакивает вверх
      }
      f.bumpCool = Math.max(0, (f.bumpCool || 0) - dt);
      if (bump && f.bumpCool > 0) bump = false;      // повторный удар сразу после первого не считаем
      if (bump) f.bumpCool = 0.3;
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
    if (cfg.structural && brainNow) {
      f.brain.plasticity(f.delta, cfg, dt * physEvery);
      f.growTimer = (f.growTimer || 0) + dt * physEvery;
      if (f.growTimer >= cfg.growEvery) {
        f.brain.grow(cfg, this.rng, f.growTimer);
        if (cfg.neurogenesis) {
          f.brain.cullNeurons(f.growTimer);
          // рождение нейронов чаще, когда жизнь приносит награду
          const boost = 0.5 + clamp(f.daBar * 4, 0, 2);
          if (this.rng() < cfg.newRate * boost) f.brain.birth(cfg, this.rng);
        }
        f.growTimer = 0;
      }
    }
    if (cfg.learning && wasFlying) {
      // с возрастом муха учится медленнее: молодая ищет, взрослая лишь подстраивается
      const age = cfg.learnAnneal > 0 ? 1 / (1 + f.lifeTime / cfg.learnAnneal) : 1;
      f.learner.learn(f.delta, cfg.learnRate * tr.learn * age, cfg.weightDecay * age, dt);
    }

    const drain = (f.state === 'rest' ? cfg.energyDrain * 0.3 : cfg.energyDrain) + cfg.moveCost * f.speed * (f.state === 'escape' ? 0.5 : 1);
    // холод: зимой расход выше; мех греет; насекомые мёрзнут вне укрытий
    const sk = this.season().k;
    let cold = [1, 1, 1.1, 1.6][sk];
    if (sk === 3 && f.body.fur) cold = 1.25;
    if (sk === 3 && (f.body.insect || f.body.coldBlood) && f.state !== 'shelter') cold = 3.2;
    const bodyDrain = f.body.drain * cold * (f.state === 'shelter' ? 0.4 : 1);
    f.energy -= drain * bodyDrain * dt;

    for (const q of this.predators) {
      if (!q.active || q.cooldown > 0 || !this.canCatch(q, f)) continue;
      const P = PREDATORS[q.kind] || { kill: cfg.predatorKill, rest: cfg.predatorRest };
      const kill = q.kind === 'dragonfly' ? cfg.predatorKill : P.kill;
      const reach = q.kind === 'spider' ? kill : kill * (1 + f.body.morph);
      if (Math.hypot(q.x - f.x, q.y - f.y, q.z - f.z) < reach) {
        q.cooldown = q.kind === 'dragonfly' ? cfg.predatorRest : P.rest;
        f.lastKiller = q.kind;
        this.respawn(f, 'predator');
        return;
      }
    }
    if (f.energy <= 0) { this.respawn(f, 'starve'); return; }

    f.lifeTime += dt;
    f.trail.push([f.x, f.y, f.z]);
    if (f.trail.length > 240) f.trail.shift();
  }

  // Стрекоза охотится на летящих мух поблизости, иначе патрулирует
  stepPredator(p, dt, daylight) {
    const cfg = this.cfg;
    p.cooldown = Math.max(0, p.cooldown - dt);
    p.active = this.predActive(p, daylight);
    const g = this.groundAt(p.x, p.z);
    const h = cfg.arenaHalf - 0.2;
    if (p.kind === 'spider') { p.resting = p.cooldown > 0; p.hunting = false; return; }   // паутина неподвижна
    if (p.kind === 'hawk' || p.kind === 'snake' || p.kind === 'marten') { this.stepHunter(p, dt, g, h); return; }
    if (!p.active) {
      p.hunting = false;
      if (p.kind === 'owl') {
        // днём сова спит на ветке
        const d = Math.hypot(p.perch.x - p.x, p.perch.z - p.z, p.perch.y - p.y);
        if (d > 0.1) { const k = Math.min(1, 2 * dt / d); p.x += (p.perch.x - p.x) * k; p.y += (p.perch.y - p.y) * k; p.z += (p.perch.z - p.z) * k; p.heading = Math.atan2(p.perch.x - p.x, p.perch.z - p.z) || p.heading; }
        p.resting = d < 0.3; p.speed = 0;
        return;
      }
      if (p.kind === 'fox') {
        // днём лиса спит в норе
        const d = Math.hypot(p.den.x - p.x, p.den.z - p.z);
        if (d > 0.2) { p.heading = Math.atan2(p.den.x - p.x, p.den.z - p.z); p.speed = 1.2; }
        else p.speed = 0;
        p.resting = d <= 0.2;
      } else {
        // ночью стрекоза сидит низко и не охотится
        p.speed += (0 - p.speed) * Math.min(1, dt);
        p.y += ((g + 0.5) - p.y) * dt * 0.5;
        p.resting = true;
        return;
      }
    } else {
      p.resting = false;
      let target = null;
      if (p.cooldown <= 0) {
        let bd = Infinity;
        for (const f of this.flies) {
          if (!this.canCatch(p, f)) continue;
          const d = Math.hypot(f.x - p.x, f.y - p.y, f.z - p.z);
          const still = f.speed < 0.12;
          // все хищники замечают движение; сова слышит и неподвижных вблизи
          const range = p.kind === 'dragonfly' ? (still ? 0.35 : cfg.predatorChase) : p.kind === 'owl' ? (still ? 1.2 : 5) : (still ? 1.5 : 6);
          if (d < range && d < bd) { bd = d; target = f; }
        }
      }
      p.hunting = !!target;
      const chase = p.kind === 'owl' ? 2.4 : p.kind === 'fox' ? 2.0 : cfg.predatorChaseSpeed;
      const patrol = p.kind === 'owl' ? 1.0 : p.kind === 'fox' ? 0.8 : cfg.predatorSpeed;
      if (target) {
        const want = Math.atan2(target.x - p.x, target.z - p.z);
        let diff = want - p.heading;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        p.heading += clamp(diff, -2.8 * dt, 2.8 * dt);
        p.speed += (chase - p.speed) * Math.min(1, dt * 2);
        if (p.kind !== 'fox') p.y += clamp(target.y - p.y, -1, 1) * dt * (p.kind === 'owl' ? 2.5 : 1.5);
      } else {
        p.heading += (this.rng() - 0.5) * 2.0 * dt;
        p.speed += (patrol - p.speed) * Math.min(1, dt);
        if (p.kind === 'owl') p.y += ((g + 2.6 + 0.4 * Math.sin(this.time * 0.3)) - p.y) * dt * 0.8;
        else if (p.kind === 'dragonfly') p.y += ((g + 1.3 + 0.4 * Math.sin(this.time * 0.4)) - p.y) * dt * 0.8;
      }
    }
    p.x += Math.sin(p.heading) * p.speed * dt;
    p.z += Math.cos(p.heading) * p.speed * dt;
    if (Math.abs(p.x) > h || Math.abs(p.z) > h) {
      p.heading += Math.PI;
      p.x = clamp(p.x, -h, h);
      p.z = clamp(p.z, -h, h);
    }
    const g2 = this.groundAt(p.x, p.z);
    if (p.kind === 'fox') p.y = g2 + 0.02;
    else p.y = clamp(p.y, g2 + 0.25, g2 + cfg.arenaTop);
    this.pushOut(p, p.kind === 'fox' ? 0.2 : 0.12);
  }

  // Ястреб, змея, куница: днёвка/ночёвка дома, охота по своим правилам
  stepHunter(p, dt, g, h) {
    const home = p.kind === 'hawk' ? p.perch : p.home;
    if (!p.active) {
      p.hunting = false;
      const d = Math.hypot(home.x - p.x, home.z - p.z, home.y - p.y);
      if (d > 0.15) {
        const k = Math.min(1, (p.kind === 'hawk' ? 3 : 1.2) * dt / d);
        p.x += (home.x - p.x) * k; p.z += (home.z - p.z) * k; p.y += (home.y - p.y) * k;
        p.heading = Math.atan2(home.x - p.x, home.z - p.z) || p.heading;
        p.speed = 1;
      } else p.speed = 0;
      p.resting = d <= 0.3;
      return;
    }
    p.resting = false;
    // поиск добычи: замечают движение, неподвижных — только вблизи
    let target = null, bd = Infinity;
    const range = { hawk: [7, 1.5], snake: [2.5, 1.2], marten: [6, 1.5] }[p.kind];
    if (p.cooldown <= 0) {
      for (const f of this.flies) {
        if (!this.canCatch(p, f)) continue;
        const d = Math.hypot(f.x - p.x, f.z - p.z, (f.y - p.y) * (p.kind === 'hawk' ? 0.3 : 1));
        const r = f.state === 'shelter' ? 4 : f.speed < 0.12 ? range[1] : range[0];   // змея находит норы с добычей
        if (d < r && d < bd) { bd = d; target = f; }
      }
    }
    p.hunting = !!target;
    const chase = { hawk: 3.0, snake: 1.2, marten: 2.3 }[p.kind];
    const patrol = { hawk: 1.4, snake: 0.35, marten: 1.0 }[p.kind];
    if (target) {
      const want = Math.atan2(target.x - p.x, target.z - p.z);
      let diff = want - p.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      p.heading += clamp(diff, -3 * dt, 3 * dt);
      p.speed += (chase - p.speed) * Math.min(1, dt * 2);
      if (p.kind === 'hawk') p.y += clamp(target.y - p.y, -2, 2) * dt * 2.5;            // пике
      else if (p.kind === 'marten') p.y += (target.y - p.y) * Math.min(1, dt * 2);      // лезет за белкой на дерево
    } else {
      p.heading += (this.rng() - 0.5) * (p.kind === 'snake' ? 3 : 1.5) * dt;
      p.speed += (patrol - p.speed) * Math.min(1, dt);
      if (p.kind === 'hawk') p.y += ((g + 5.5) - p.y) * dt * 0.6;                       // парит высоко
    }
    p.x += Math.sin(p.heading) * p.speed * dt;
    p.z += Math.cos(p.heading) * p.speed * dt;
    if (Math.abs(p.x) > h || Math.abs(p.z) > h) { p.heading += Math.PI; p.x = clamp(p.x, -h, h); p.z = clamp(p.z, -h, h); }
    const g2 = this.groundAt(p.x, p.z);
    if (p.kind === 'snake') p.y = g2 + 0.02;
    else if (p.kind === 'marten') { if (!target || target.y - g2 < 0.3) p.y = g2 + 0.02; p.y = Math.max(p.y, g2 + 0.02); }
    else p.y = clamp(p.y, g2 + 0.3, g2 + 7);
    if (p.kind !== 'hawk' && !(p.kind === 'marten' && p.y > g2 + 0.3)) this.pushOut(p, 0.15);
  }

  step(dt = 1 / 60) {
    this.time += dt;
    const daylight = this.daylight();
    this.updateWind(dt);
    for (const p of this.predators) this.stepPredator(p, dt, daylight);
    for (const f of this.flies) { this.stepFly(f, dt, daylight); this.observe(f, dt); }
    this.decayEtho(dt);
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
    const se = this.season();
    for (let k = 0; k < this.food.length; k++) {
      const food = this.food[k];
      const T = FOOD_TYPES[food.kind];
      if (!food.alive && this.time >= food.regrowAt) {
        // новая еда появляется с вероятностью по урожаю сезона, иначе — позже
        if (this.rng() < T.season[se.k]) this.food[k] = this.randomFood(food.kind);
        else food.regrowAt = this.time + this.cfg.foodRegrow;
      } else if (food.alive) {
        // зимой фрукты, ягоды и нектар портятся
        if (se.k === 3 && T.perish) {
          food.amount -= 2 * dt;
          if (food.amount <= 0) { food.alive = false; food.amount = 0; food.regrowAt = this.time + this.cfg.foodRegrow; }
        }
        // осенью спелые фрукты падают с веток
        if (se.k === 2 && food.hanging && this.rng() < dt * 0.01) { food.hanging = false; food.base = this.groundAt(food.x, food.z); food.y = food.base + food.size * 0.7; }
      }
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
