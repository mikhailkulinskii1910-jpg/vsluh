// Суперэволюция: остров — колония мух, которая живёт без отрисовки на максимальной скорости.
// Поверх обучения дофамином и наследования действует жёсткий отбор: регулярно худшая
// четверть колонии заменяется мутировавшими потомками лучшей четверти.
// Между островами мигрируют чемпионы.

import { FlySim, STAGES } from './sim.js';

export class Island {
  constructor(data, { mode = 'connectome', seed = 1, flyCount = 12, config = {}, selectEvery = 60 } = {}) {
    this.sim = new FlySim(data, { mode, seed, config: { flyCount, learning: 1, inherit: 1, ...config } });
    this.selectEvery = selectEvery;
    this.nextSelect = selectEvery;
    this.nextRecord = 30;
    this.selections = 0;
    this.history = [];
  }

  // успех мухи: посадок на фрукт в минуту за её жизнь
  score(f) { return (f.eatenLife * 60) / Math.max(f.lifeTime, 30); }

  select() {
    const flies = [...this.sim.flies].sort((a, b) => this.score(b) - this.score(a));
    const n = flies.length;
    const k = Math.max(1, Math.floor(n / 4));
    for (let i = 0; i < k; i++) this.sim.respawn(flies[n - 1 - i], null, flies[i]);
    this.selections += 1;
  }

  // посадок в минуту на муху за последние 2 минуты
  recentRate() {
    const b = Math.floor(this.sim.time / 30);
    let sum = 0, cnt = 0;
    for (let j = Math.max(0, b - 4); j < b; j++) { sum += this.sim.feedBuckets[j] || 0; cnt++; }
    return cnt ? (sum * 2) / cnt / this.sim.flies.length : 0;
  }

  run(seconds) {
    const steps = Math.round(seconds * 60);
    for (let s = 0; s < steps; s++) {
      this.sim.step(1 / 60);
      if (this.sim.time >= this.nextSelect) { this.select(); this.nextSelect += this.selectEvery; }
      if (this.sim.time >= this.nextRecord) {
        this.history.push({ t: this.sim.time, feed: this.recentRate() });
        if (this.history.length > 600) this.history.shift();
        this.nextRecord += 30;
      }
    }
  }

  best() {
    const flies = [...this.sim.flies].sort((a, b) => this.score(b) - this.score(a));
    const b = flies[0];
    const br = b.brain;
    return {
      W: Array.from(b.learner.W), traits: { ...b.traits }, generation: b.generation, score: this.score(b),
      morph: b.body.morph,
      grown: br.exportGrowth(),
    };
  }

  stats() {
    const flies = this.sim.flies;
    return {
      time: this.sim.time,
      rate: this.recentRate(),
      maxGen: Math.max(...flies.map((f) => f.generation)),
      meanGen: flies.reduce((a, f) => a + f.generation, 0) / flies.length,
      eaten: this.sim.totalEaten,
      deaths: this.sim.totalDeaths,
      selections: this.selections,
      stages: STAGES.map((g, k) => flies.filter((f) => f.body.stage === k).length),
      morph: flies.reduce((a, f) => a + f.body.morph, 0) / flies.length,
      grown: flies.reduce((a, f) => a + f.brain.gN, 0) / flies.length,
      neurons: flies.reduce((a, f) => a + f.brain.net.N + f.brain.nNew, 0) / flies.length,
      patterns: this.sim.ethogram().filter((x) => x.status === 'освоен').map((x) => x.name),
    };
  }

  // мигрант заменяет худшую муху острова
  receiveMigrant(m) {
    const flies = [...this.sim.flies].sort((a, b) => this.score(a) - this.score(b));
    const parent = {
      id: -1, learner: { W: Float32Array.from(m.W) }, traits: m.traits, generation: m.generation,
      body: { morph: m.morph ?? 0 }, brain: m.grown,
    };
    this.sim.respawn(flies[0], null, parent);
  }
}
