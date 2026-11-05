// Web Worker: эволюция идёт в фоне и не тормозит страницу.
import { Evolution } from './evolution.js';

let token = 0;
let data = null;

async function loadData() {
  if (!data) data = await (await fetch('data/fly_network.json')).json();
  return data;
}

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'start') {
    const my = ++token;
    await loadData();
    const evo = new Evolution(data, { mode: m.mode, pop: m.pop ?? 20, seconds: m.seconds ?? 25 });
    self.postMessage({ type: 'started', mode: m.mode });
    while (my === token) {
      const r = evo.generation();
      self.postMessage({ type: 'gen', gen: r.gen, best: r.best, bestFit: r.bestFit, mean: r.mean,
                         bestEaten: r.bestEaten, bestPredator: r.bestPredator, bestStarve: r.bestStarve, bench: r.bench,
                         history: evo.history.slice(-400) });
      await new Promise((res) => setTimeout(res, 0));
    }
  } else if (m.type === 'stop') {
    token++;
    self.postMessage({ type: 'stopped' });
  }
};
