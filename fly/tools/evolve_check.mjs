// Проверка эволюции без браузера: node fly/tools/evolve_check.mjs [поколений] [популяция]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Evolution } from '../evolution.js';

const here = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(here, '../data/fly_network.json'), 'utf8'));
const gens = Number(process.argv[2] ?? 10);
const pop = Number(process.argv[3] ?? 20);
const mode = process.argv[4] ?? 'connectome';
const evo = new Evolution(data, { mode, pop, seconds: 25, seed: 12345 });
const t0 = Date.now();
for (let g = 0; g < gens; g++) {
  const r = evo.generation();
  console.log(`gen ${String(r.gen).padStart(3)}  best ${r.bestFit.toFixed(2)}  mean ${r.mean.toFixed(2)}  eaten ${r.bestEaten.toFixed(2)}  predator ${r.bestPredator.toFixed(2)}  starve ${r.bestStarve.toFixed(2)}`);
}
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
