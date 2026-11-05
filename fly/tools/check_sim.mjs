// Проверка симуляции без браузера: node fly/tools/check_sim.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FlySim } from '../sim.js';

const here = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(here, '../data/fly_network.json'), 'utf8'));
const seconds = Number(process.argv[2] ?? 180);
const steps = Math.round(seconds * 60);

for (const mode of ['connectome', 'random']) {
  const sim = new FlySim(data, { mode, seed: 7 });
  let speedSum = 0, motorSum = 0, sensSum = 0, maxEnergyDrop = 0;
  const t0 = Date.now();
  for (let s = 0; s < steps; s++) {
    sim.step(1 / 60);
    speedSum += sim.fly.speed;
    motorSum += sim.meanRate(sim.motL) + sim.meanRate(sim.motR);
    sensSum += sim.meanRate(sim.olfL) + sim.meanRate(sim.mechL);
  }
  const ms = Date.now() - t0;
  console.log(mode.padEnd(10),
    `eaten=${sim.eaten}`, `lives=${sim.lives}`,
    `meanSpeed=${(speedSum / steps).toFixed(3)}`,
    `motorRate=${(motorSum / steps / 2).toFixed(4)}`,
    `sensRate=${(sensSum / steps / 2).toFixed(4)}`,
    `time=${ms}ms for ${seconds}s sim`);
}
