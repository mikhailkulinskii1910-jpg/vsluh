'use strict';
const SHAPES = [
  ['rect', 'Прямоугольник', '<rect x="5" y="2" width="14" height="20" rx="1"/>'],
  ['square', 'Квадрат', '<rect x="3" y="3" width="18" height="18" rx="1"/>'],
  ['circle', 'Круг', '<circle cx="12" cy="12" r="9.5"/>'],
  ['oval', 'Овал', '<ellipse cx="12" cy="12" rx="7" ry="10.5"/>'],
  ['triangle', 'Треугольник', '<path d="M12 3 L21.5 20 H2.5 Z"/>'],
  ['hexagon', 'Шестиугольник', '<path d="M2 12 L7 3.5 H17 L22 12 L17 20.5 H7 Z"/>'],
  ['diamond', 'Ромб', '<path d="M12 1.5 L20 12 L12 22.5 L4 12 Z"/>'],
];
const $ = (id) => document.getElementById(id);
let st = {};

function render() {
  for (const b of $('shapes').children) b.setAttribute('aria-pressed', b.dataset.id === st.shape);
  $('shapeName').textContent = (SHAPES.find((s) => s[0] === st.shape) || SHAPES[0])[1];
  $('width').value = st.width; $('widthVal').textContent = st.width + ' px';
  $('opacity').value = Math.round(st.opacity * 100); $('opVal').textContent = Math.round(st.opacity * 100) + ' %';
  $('thumb').style.backgroundImage = `url("${st.image ? 'kovyor://user/' + encodeURIComponent(st.image) : 'assets/carpet.png'}")`;
  $('std').disabled = !st.image;
  $('key').textContent = st.rollKey ? st.rollKey.replace(/\+/g, ' + ') : 'не задано';
  $('onTop').checked = !!st.onTop;
}

async function set(patch) {
  const r = await cfg.set(patch);
  st = r.settings;
  $('err').textContent = r.keyError || '';
  render();
}

for (const [id, name, svg] of SHAPES) {
  const b = document.createElement('button');
  b.dataset.id = id; b.title = name; b.setAttribute('aria-label', name);
  b.innerHTML = `<svg viewBox="0 0 24 24">${svg}</svg>`;
  b.onclick = () => set({ shape: id });
  $('shapes').appendChild(b);
}

// ползунки: подпись меняется сразу, ковёр — когда отпустили (размер) или на лету (прозрачность)
$('width').oninput = () => { $('widthVal').textContent = $('width').value + ' px'; };
$('width').onchange = () => set({ width: +$('width').value });
let opTimer = 0;
$('opacity').oninput = () => {
  $('opVal').textContent = $('opacity').value + ' %';
  clearTimeout(opTimer); opTimer = setTimeout(() => set({ opacity: $('opacity').value / 100 }), 40);
};

$('pick').onclick = async () => { const r = await cfg.pickImage(); if (r) { st = r.settings; render(); } };
$('std').onclick = () => set({ image: '' });
$('roll').onclick = () => cfg.roll();
$('onTop').onchange = () => set({ onTop: $('onTop').checked });
$('auto').onchange = async () => { $('auto').checked = await cfg.autostart($('auto').checked); };

// запись сочетания клавиш
const KEYMAP = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', '+': 'Plus' };
let waiting = false;
function startWait() { waiting = true; $('key').classList.add('wait'); $('key').textContent = 'Нажмите сочетание…'; $('err').textContent = ''; }
$('key').onclick = startWait;
$('key').onkeydown = (e) => {
  if (!waiting) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startWait(); } return; }
  e.preventDefault();
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
  if (e.key === 'Escape') { waiting = false; $('key').classList.remove('wait'); render(); return; }
  let key = KEYMAP[e.key] || (/^F\d{1,2}$/.test(e.key) ? e.key : e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : e.key.length === 1 ? e.key.toUpperCase() : e.key);
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
  if (!mods.length && !/^F\d{1,2}$/.test(key)) { $('err').textContent = 'Добавьте Ctrl, Alt или Shift — иначе клавиша перестанет работать в других программах.'; return; }
  waiting = false; $('key').classList.remove('wait');
  set({ rollKey: [...mods, key].join('+') });
};
$('key').onblur = () => { if (waiting) { waiting = false; $('key').classList.remove('wait'); render(); } };

cfg.get().then((r) => { st = r.settings; $('auto').checked = r.autostart; render(); if (!r.rollKeyOk && st.rollKey) $('err').textContent = 'Сочетание ' + st.rollKey + ' занято — выберите другое.'; });
