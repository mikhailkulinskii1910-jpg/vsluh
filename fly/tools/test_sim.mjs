// Автотесты симуляции: node fly/tools/test_sim.mjs  (около 2 минут)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FlySim } from '../sim.js';

const here = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(here, '../data/fly_network.json'), 'utf8'));
let failed = 0;
const check = (name, ok, info) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); if (!ok) failed++; };

// 1. Мозг не застывает в молчании без стимулов
let silent = 0;
for (let seed = 1; seed <= 20; seed++) {
  const s = new FlySim(data, { seed });
  let act = 0;
  for (let k = 0; k < 900; k++) { s.step(1 / 60); if (k > 300) act += s.fly.brain.nActive; }
  if (act < 600) silent++;
}
check('мозг не молчит без стимулов', silent === 0, `молчащих ${silent} из 20`);

// 2. Нет NaN и муха остаётся в саду
{
  const s = new FlySim(data, { seed: 3, config: { flyCount: 8 } });
  for (let k = 0; k < 3600 * 3; k++) s.step(1 / 60);
  const bad = s.flies.filter((f) => ![f.x, f.y, f.z, f.energy, f.heading].every(Number.isFinite) || Math.abs(f.x) > s.cfg.arenaHalf || Math.abs(f.z) > s.cfg.arenaHalf);
  check('координаты конечны и внутри сада', bad.length === 0, `плохих мух ${bad.length}`);
  check('веса обучения конечны', s.flies.every((f) => f.learner.W.every(Number.isFinite)));
}

// 3. Скорость симуляции
{
  const s = new FlySim(data, { seed: 3, config: { flyCount: 8 } });
  for (let k = 0; k < 600; k++) s.step(1 / 60);
  const t0 = performance.now();
  for (let k = 0; k < 3600; k++) s.step(1 / 60);
  const ms = (performance.now() - t0) / 60;
  check('8 мух быстрее 60 мс на секунду симуляции', ms < 60, `${ms.toFixed(1)} мс`);
}

// 4. Обучение дофамином лучше, чем без него (12 минут, 2 мира)
const feedLate = (cfg) => {
  let sum = 0;
  for (const seed of [71, 72]) {
    const s = new FlySim(data, { seed, config: { flyCount: 8, ...cfg } });
    for (let k = 0; k < 12 * 3600; k++) s.step(1 / 60);
    const c = s.learningCurve(); const q = Math.floor(c.length / 4);
    sum += c.slice(-q).reduce((a, b) => a + b.feed, 0) / q;
  }
  return sum / 2;
};
const on = feedLate({}), off = feedLate({ learning: 0 });
check('с обучением мухи едят чаще, чем без него', on > off * 1.5, `${on.toFixed(2)} против ${off.toFixed(2)} посадок в минуту на муху`);

console.log(failed ? `\nПровалено проверок: ${failed}` : '\nВсе проверки пройдены');
process.exit(failed ? 1 : 0);
