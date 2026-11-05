// Геном: вектор из чисел в [0,1], который переводится в параметры симуляции.
// Топология коннектома фиксирована; эволюция подбирает силу связей, пороги,
// чувствительность сенсоров и параметры моторов.

export const GENES = [
  { key: 'weightScale', min: 0.05, max: 0.6 },
  { key: 'threshold', min: 0.3, max: 1.2 },
  { key: 'decay', min: 0.6, max: 0.95 },
  { key: 'odorGain', min: 0.1, max: 2 },
  { key: 'contactGain', min: 0, max: 2 },
  { key: 'hungerGain', min: 0, max: 0.5 },
  { key: 'motorSpeed', min: 1, max: 6 },
  { key: 'motorTurn', min: 0.5, max: 6 },
  { key: 'noise', min: 0, max: 0.03 },
  { key: 'predatorGain', min: 0, max: 2 },
];

const clamp01 = (x) => Math.max(0, Math.min(1, x));

export function gauss(rng) {
  return Math.sqrt(-2 * Math.log(rng() + 1e-12)) * Math.cos(2 * Math.PI * rng());
}

export function randomGenome(rng) {
  return GENES.map(() => rng());
}

export function decode(genome) {
  const cfg = {};
  GENES.forEach((g, i) => { cfg[g.key] = g.min + clamp01(genome[i]) * (g.max - g.min); });
  return cfg;
}

export function mutate(genome, rng, sigma = 0.08, rate = 0.3) {
  return genome.map((x) => (rng() < rate ? clamp01(x + gauss(rng) * sigma) : x));
}

export function crossover(a, b, rng) {
  return a.map((x, i) => (rng() < 0.5 ? x : b[i]));
}
