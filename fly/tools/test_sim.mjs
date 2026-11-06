// Автотесты симуляции: node fly/tools/test_sim.mjs  (около 2 минут)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FlySim, stageIndex } from '../sim.js';
import { Island } from '../superevo.js';

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
// сравниваем фиксированные виды: при свободной эволюции колонии превращаются в разных животных
const sp = (key, extra = {}) => feedLate({ forceStage: stageIndex(key), ...extra });
const on = sp('mouse') + sp('squirrel'), off = sp('mouse', { learning: 0 }) + sp('squirrel', { learning: 0 });
check('с обучением особи едят чаще, чем без него (мышь и белка)', on > off * 1.2, `${(on / 2).toFixed(2)} против ${(off / 2).toFixed(2)} посадок в минуту на особь`);

// 5. Суперэволюция: остров отбирает и рождает новые поколения, мигрант принимается
{
  const isl = new Island(data, { seed: 5, flyCount: 8 });
  isl.run(200);
  const st = isl.stats();
  isl.receiveMigrant(isl.best());
  check('остров суперэволюции работает', st.selections >= 3 && st.maxGen >= 2 && Number.isFinite(st.rate), `отборов ${st.selections}, поколений ${st.maxGen}`);
}

// 6. Эволюция тела: под отбором колония уходит от мушиной формы
{
  const isl = new Island(data, { seed: 7, flyCount: 12, config: { morphSpeed: 5 } });
  isl.run(25 * 60);
  const st = isl.stats();
  check('тело эволюционирует под отбором', st.morph > 0.2, `средняя морфа ${st.morph.toFixed(2)}, стадии ${JSON.stringify(st.stages)}`);
}

// 7. Рост мозга, новые действия и дневник поведения
{
  // рост мозга идёт за время жизни, поэтому проверяем на долгоживущем виде — еже
  const sim = new FlySim(data, { seed: 21, config: { flyCount: 8, forceStage: stageIndex('hedgehog') } });
  for (let k = 0; k < 6 * 3600; k++) sim.step(1 / 60);
  const nNew = sim.flies.reduce((a, f) => a + f.brain.nNew, 0) / 8;
  const born = sim.flies.reduce((a, f) => a + f.brain.born, 0);
  const finite = sim.flies.every((f) => f.brain.rate.every(Number.isFinite) && f.brain.gW.every(Number.isFinite));
  check('мозг растёт новыми нейронами', nNew > 2 && born > 0 && finite, `в среднем ${nNew.toFixed(1)} новых нейронов, родилось ${born}`);
  const eth = sim.ethogram();
  const acts = eth.find((e) => e.key === 'freezeThreat').events + eth.find((e) => e.key === 'dashFood').events;
  check('мозг запускает новые действия, дневник их видит', acts > 5 && eth.every((e) => Number.isFinite(e.lift)), `замираний и рывков: ${acts.toFixed(0)}`);
  // перенос вместе с новыми нейронами без потерь
  const g = sim.exportGenomes();
  const sim2 = new FlySim(data, { seed: 22, config: { flyCount: 8 } });
  sim2.importGenomes(g);
  check('новые нейроны переносятся между потоками', sim2.flies.every((f, i) => f.brain.nNew === sim.flies[i].brain.nNew && f.brain.gN === sim.flies[i].brain.gN));
}

// 8. Новый мир: белки лазают по деревьям, осенью запасают жёлуди, ночью укрываются; зимой еды меньше
{
  const sim = new FlySim(data, { seed: 41, config: { flyCount: 10, forceStage: stageIndex('squirrel') } });
  sim.time = 2 * sim.cfg.seasonLength;          // начало осени
  let treeT = 0, shelterNight = 0, night = 0;
  for (let k = 0; k < 5 * 3600; k++) {
    sim.step(1 / 60);
    for (const f of sim.flies) {
      if (f.inTree) treeT += 1 / 60;
      if (sim.daylight() < 0.3) { night++; if (f.state === 'shelter') shelterNight++; }
    }
  }
  const stash = sim.shelters.reduce((a, x) => a + x.stash, 0) + sim.flies.filter((f) => f.carry).length;
  check('белки лазают по деревьям', treeT > 30, `${treeT.toFixed(0)} особе-секунд на деревьях`);
  check('белки осенью запасают жёлуди', stash > 0 || sim.events.some((e) => e.text.includes('жёлудь')), `в дуплах ${stash}`);
  check('ночью особи укрываются', night > 0 && shelterNight / night > 0.3, `в укрытиях ${(100 * shelterNight / Math.max(1, night)).toFixed(0)}% ночного времени`);
  const alive = (k) => sim.food.filter((x) => x.alive).length;
  const autumnFood = alive();
  sim.time = 3 * sim.cfg.seasonLength;          // зима
  for (let k = 0; k < 2 * 3600; k++) sim.step(1 / 60);
  check('зимой еды меньше', alive() < autumnFood, `осенью ${autumnFood}, зимой ${alive()}`);
}

console.log(failed ? `\nПровалено проверок: ${failed}` : '\nВсе проверки пройдены');
process.exit(failed ? 1 : 0);
