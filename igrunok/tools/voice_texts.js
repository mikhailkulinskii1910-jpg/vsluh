// Собирает все фразы, которые игра произносит вслух, ровно в том виде, в каком их строит speakQ/say.
// node voice_texts.js game.html out.json
const fs = require('fs'), vm = require('vm');
const h = fs.readFileSync(process.argv[2], 'utf8');
const a = h.indexOf('const THEMES'), b = h.indexOf('const VALUES');
const c = {}; vm.createContext(c);
vm.runInContext(h.slice(a, b).replace(/const /g, 'var '), c);
const V = (h.match(/const VALUES=\[([^\]]*)\]/) || [, '10,20,30,40,50,60,70,80,90,100'])[1].split(',').map(Number);
const norm = t => String(t).replace(/[«»"]/g, "").replace(/…/g, "...").replace(/\s+/g, " ").trim();
const plain = t => String(t).replace(/<[^>]+>/g, ' ');
const out = []; const seen = new Set();
const add = t => { const k = norm(t); if (!seen.has(k)) { seen.add(k); out.push({ key: k, text: k }); } };
// фразы-шаблоны берём прямо из кода игры, чтобы они не разошлись
const catTpl = (h.match(/say\(`(Кот в мешке![^`]*)`\)/) || [])[1];
const finIntro = (h.match(/say\("(Финальный вопрос\.[^"]*)"\)/) || [])[1];
c.THEMES.forEach(t => t.q.forEach((q, i) => {
  if (q.cat) { if (catTpl) add(catTpl.replace('${v}', V[i])); }
  else add(`${t.name}. ${V[i]} баллов. ${q.say || plain(q.q)}`);
}));
if (finIntro) add(finIntro);
if (c.FINAL) add("Тысяча баллов. " + (c.FINAL.say || plain(c.FINAL.q)));
(c.FINAL_PLUS || []).forEach(x => add(x.say || plain(x.q)));
add("Озвучка включена");
const words = ["ноль","один","два","две","три","четыре","пять","шесть","семь","восемь","девять","десять","одиннадцать","двенадцать","тринадцать","четырнадцать","пятнадцать","шестнадцать","семнадцать","восемнадцать","девятнадцать","двадцать","тридцать","сорок","пятьдесят","шестьдесят","семьдесят","восемьдесят","девяносто","сто","двести","триста","четыреста","пятьсот","шестьсот","семьсот","восемьсот","девятьсот","тысяча","тысячи","тысяч","плюс","минус","счёт"];
words.forEach(w => out.push({ key: "w:" + w, text: w + "." }));
["Первая","Вторая","Третья","Четвёртая","Пятая","Шестая"].forEach((w, i) => out.push({ key: "w:team" + (i + 1), text: w + " команда." }));
fs.writeFileSync(process.argv[3], JSON.stringify(out));
console.log(out.length, 'фраз');
