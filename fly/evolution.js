// Эволюция генома мухи: популяция, турнирный отбор, скрещивание, мутации, элитизм.
// Фитнес: очки за еду, очки за время жизни, штрафы за смерть.

import { FlySim, mulberry32 } from './sim.js';
import { decode, randomGenome, mutate, crossover } from './genome.js';

export function evaluateGenome(data, genome, { mode, seeds, seconds }) {
  let total = 0, eaten = 0, predator = 0, starve = 0;
  for (const seed of seeds) {
    const sim = new FlySim(data, { mode, seed, config: decode(genome) });
    const steps = Math.round(seconds * 60);
    for (let s = 0; s < steps; s++) sim.step(1 / 60);
    eaten += sim.eaten;
    predator += sim.deaths.predator;
    starve += sim.deaths.starve;
    total += 5 * sim.eaten + 0.05 * seconds - 4 * sim.deaths.predator - 2 * sim.deaths.starve;
  }
  const n = seeds.length;
  return { fitness: total / n, eaten: eaten / n, predator: predator / n, starve: starve / n };
}

export class Evolution {
  constructor(data, { mode = 'connectome', pop = 20, seconds = 25, seed = Date.now() % 100000 } = {}) {
    this.data = data;
    this.mode = mode;
    this.popSize = pop;
    this.seconds = seconds;
    this.rng = mulberry32(seed);
    this.pop = Array.from({ length: pop }, () => randomGenome(this.rng));
    this.gen = 0;
    this.best = null;
    this.bestFit = -Infinity;
    this.history = [];
  }

  tournament(results) {
    let best = -1;
    for (let k = 0; k < 3; k++) {
      const idx = Math.floor(this.rng() * this.pop.length);
      if (best < 0 || results[idx].fitness > results[best].fitness) best = idx;
    }
    return best;
  }

  // Одно поколение: оценка всех геномов, затем следующая популяция
  generation() {
    // одни и те же случайные миры для всей популяции в этом поколении
    const seeds = [1000 + this.gen * 2, 1001 + this.gen * 2];
    const results = this.pop.map((g) =>
      evaluateGenome(this.data, g, { mode: this.mode, seeds, seconds: this.seconds }));
    const order = results.map((_, i) => i).sort((a, b) => results[b].fitness - results[a].fitness);
    const top = results[order[0]];
    const mean = results.reduce((s, r) => s + r.fitness, 0) / results.length;
    this.best = this.pop[order[0]];
    this.bestFit = top.fitness;
    this.history.push({ gen: this.gen, best: top.fitness, mean, eaten: top.eaten });

    const next = [this.pop[order[0]], this.pop[order[1]]]; // элитизм
    while (next.length < this.popSize) {
      const a = this.pop[this.tournament(results)];
      const b = this.pop[this.tournament(results)];
      next.push(mutate(crossover(a, b, this.rng), this.rng));
    }
    this.pop = next;
    // проверка лучшего генома на фиксированных мирах, одинаковых для всех поколений
    const bench = evaluateGenome(this.data, this.best, { mode: this.mode, seeds: [7, 8], seconds: this.seconds });
    this.history[this.history.length - 1].bench = bench.fitness;
    const out = { gen: this.gen, best: this.best, bestFit: this.bestFit, mean, bestEaten: top.eaten,
                  bestPredator: top.predator, bestStarve: top.starve, bench: bench.fitness };
    this.gen += 1;
    return out;
  }
}
