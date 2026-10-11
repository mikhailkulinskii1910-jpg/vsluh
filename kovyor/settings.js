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
const FOLDS = [
  ['roll', 'Рулон', '<rect x="2" y="8" width="20" height="8" rx="4"/><ellipse cx="18" cy="12" rx="2" ry="4"/>'],
  ['ball', 'Шар', '<circle cx="12" cy="12" r="9"/><path d="M3.5 10 Q12 15 20.5 10"/>'],
  ['cube', 'Куб', '<path d="M12 2.5 L21 7 V17 L12 21.5 L3 17 V7 Z M3 7 L12 11.5 L21 7 M12 11.5 V21.5"/>'],
  ['plate', 'Пластина', '<path d="M3 13 L9 8 H21 L15 13 Z M3 13 V16 H15 L21 11 V8 M15 13 V16"/>'],
];
const CARPETS = [
  ['', 'Чёрное серебро'], ['builtin:01', 'Красная патина'], ['builtin:02', 'Огненный'], ['builtin:03', 'Изумрудный'],
  ['builtin:04', 'Морская волна'], ['builtin:05', 'Индиго'], ['builtin:06', 'Бордо'], ['builtin:07', 'Олива'],
  ['builtin:08', 'Фиалка'], ['builtin:09', 'Терракота'], ['builtin:10', 'Графит'], ['builtin:11', 'Аметист'], ['builtin:12', 'Тебриз'],
];
const $ = (id) => document.getElementById(id);
const thumb = (id) => id === '' ? 'assets/carpets/00-t.jpg' : id.startsWith('builtin:') ? `assets/carpets/${id.slice(8)}-t.jpg` : 'kovyor://user/' + encodeURIComponent(id);
let st = {};

function render() {
  const custom = st.image && !st.image.startsWith('builtin:');
  for (const b of $('gallery').children) {
    if (b.classList.contains('add')) {
      b.setAttribute('aria-pressed', !!custom);
      b.style.backgroundImage = custom ? `url("${thumb(st.image)}")` : '';
      b.classList.toggle('has', !!custom);
      b.innerHTML = custom ? '' : '<div><span>+</span>Своя<br>картинка</div>';
    } else b.setAttribute('aria-pressed', b.dataset.id === (st.image || ''));
  }
  $('carpetName').textContent = custom ? 'своя картинка' : (CARPETS.find((c) => c[0] === (st.image || '')) || CARPETS[0])[1];
  for (const b of $('shapes').children) b.setAttribute('aria-pressed', b.dataset.id === st.shape);
  $('shapeName').textContent = (SHAPES.find((s) => s[0] === st.shape) || SHAPES[0])[1];
  for (const b of $('folds').children) b.setAttribute('aria-pressed', b.dataset.id === (st.fold || 'roll'));
  $('foldName').textContent = (FOLDS.find((s) => s[0] === (st.fold || 'roll')) || FOLDS[0])[1];
  $('width').value = st.width; $('widthVal').textContent = st.width + ' px';
  $('opacity').value = Math.round(st.opacity * 100); $('opVal').textContent = Math.round(st.opacity * 100) + ' %';
  $('key').textContent = st.rollKey ? st.rollKey.replace(/\+/g, ' + ') : 'не задано';
  $('onTop').checked = !!st.onTop;
}

async function set(patch) {
  const r = await cfg.set(patch);
  st = r.settings;
  $('err').textContent = r.keyError || '';
  render();
}

function iconButtons(box, list, key) {
  for (const [id, name, svg] of list) {
    const b = document.createElement('button');
    b.dataset.id = id; b.title = name; b.setAttribute('aria-label', name);
    b.innerHTML = `<svg viewBox="0 0 24 24">${svg}</svg>` + (box.classList.contains('four') ? `<span>${name}</span>` : '');
    b.onclick = () => set({ [key]: id });
    box.appendChild(b);
  }
}
iconButtons($('shapes'), SHAPES, 'shape');
iconButtons($('folds'), FOLDS, 'fold');

for (const [id, name] of CARPETS) {
  const b = document.createElement('button');
  b.dataset.id = id; b.title = name; b.setAttribute('aria-label', name);
  b.style.backgroundImage = `url("${thumb(id)}")`;
  b.onclick = () => set({ image: id });
  $('gallery').appendChild(b);
}
{
  const b = document.createElement('button');
  b.className = 'add'; b.title = 'Своя картинка…'; b.setAttribute('aria-label', 'Своя картинка');
  b.onclick = async () => { const r = await cfg.pickImage(); if (r) { st = r.settings; render(); } };
  $('gallery').appendChild(b);
}

// ползунки: подпись меняется сразу, ковёр — когда отпустили (размер) или на лету (прозрачность)
$('width').oninput = () => { $('widthVal').textContent = $('width').value + ' px'; };
$('width').onchange = () => set({ width: +$('width').value });
let opTimer = 0;
$('opacity').oninput = () => {
  $('opVal').textContent = $('opacity').value + ' %';
  clearTimeout(opTimer); opTimer = setTimeout(() => set({ opacity: $('opacity').value / 100 }), 40);
};

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
  const key = KEYMAP[e.key] || (/^F\d{1,2}$/.test(e.key) ? e.key : e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : e.key.length === 1 ? e.key.toUpperCase() : e.key);
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
  if (!mods.length && !/^F\d{1,2}$/.test(key)) { $('err').textContent = 'Добавьте Ctrl, Alt или Shift — иначе клавиша перестанет работать в других программах.'; return; }
  waiting = false; $('key').classList.remove('wait');
  set({ rollKey: [...mods, key].join('+') });
};
$('key').onblur = () => { if (waiting) { waiting = false; $('key').classList.remove('wait'); render(); } };

cfg.get().then((r) => { st = r.settings; $('auto').checked = r.autostart; render(); if (!r.rollKeyOk && st.rollKey) $('err').textContent = 'Сочетание ' + st.rollKey + ' занято — выберите другое.'; });
