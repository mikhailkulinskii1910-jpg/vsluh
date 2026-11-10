// Быстрая проверка готовой игры: экраны, кот в мешке, финал, итоги, ошибки, покрытие озвучки.
// node smoke.js Игра.html папка_для_скриншотов
// playwright ищется через require (установите: npm i playwright@1.47.2 в любой папке и запускайте с NODE_PATH).
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const glob = d => { try { return fs.readdirSync(d) } catch (e) { return [] } };
let exe; for (const d of glob('/opt/pw-browsers').filter(x => x.startsWith('chromium_headless_shell'))) for (const s of glob('/opt/pw-browsers/' + d)) { const f = `/opt/pw-browsers/${d}/${s}/headless_shell`; if (fs.existsSync(f)) exe = f; }
(async () => {
  const file = path.resolve(process.argv[2]), out = process.argv[3] || '.'; fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch(exe ? { executablePath: exe } : {});
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } }); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + file); await p.evaluate(() => { try { localStorage.clear() } catch (e) { } }); await p.reload(); await p.waitForTimeout(3500);
  await p.screenshot({ path: out + '/1-zastavka.png' });
  await p.click('#startBtn'); await p.waitForTimeout(2800); await p.screenshot({ path: out + '/2-tablo.png' });
  await p.click('.cell[data-id="0-9"]'); await p.waitForTimeout(1800); await p.click('#showAns'); await p.waitForTimeout(1500);
  await p.screenshot({ path: out + '/3-vopros.png' }); await p.click('#closeQ'); await p.waitForTimeout(900);
  const catId = await p.evaluate(() => { for (let t = 0; t < THEMES.length; t++) for (let i = 0; i < 10; i++) if (THEMES[t].q[i].cat) return `${t}-${i}`; });
  if (catId) { await p.click(`.cell[data-id="${catId}"]`); await p.waitForTimeout(3900); await p.screenshot({ path: out + '/4-kot.png' }); await p.click('#catGo'); await p.waitForTimeout(1800); await p.click('#closeQ'); await p.waitForTimeout(900); }
  await p.click('#finalCell'); await p.waitForTimeout(2600); await p.click('#finalGo'); await p.waitForTimeout(1800); await p.click('#showAns'); await p.waitForTimeout(1500);
  await p.screenshot({ path: out + '/5-final.png' });
  while (await p.evaluate(() => !document.getElementById('nextBtn').hidden)) { await p.click('#nextBtn'); await p.waitForTimeout(1300); await p.click('#showAns'); await p.waitForTimeout(1300); }
  await p.click('#closeQ'); await p.waitForTimeout(900); await p.click('#resultsBtn'); await p.waitForTimeout(4500); await p.screenshot({ path: out + '/6-itogi.png' });
  const miss = await p.evaluate(() => { const m = []; const V = (typeof VOICE !== 'undefined') ? VOICE : {}; if (!Object.keys(V).length) return ['озвучка не записана']; THEMES.forEach(t => t.q.forEach((q, i) => { if (!q.cat) { const k = vnorm(`${t.name}. ${VALUES[i]} баллов. ${q.say || q.q}`); if (!V[k]) m.push(k.slice(0, 60)) } })); return m });
  console.log('Ошибки:', errs.length ? errs : 'нет'); console.log('Нет записи голоса:', miss.length ? miss : 'всё записано');
  await b.close();
})();
