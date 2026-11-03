// Система тем из krisa: Терминал (цвет, RGB-перелив, «Матрица»), Призма (сдвиг радуги),
// Тепловизор (10 палитр), Чертёж (оттенок и светлота) + «Стандарт» Map Tag.
import { getLang } from './i18n.js';

export const PRESETS = [['Белый', 'White', '#EDEDED'], ['Зелёный', 'Green', '#1FFF3A'], ['Красный', 'Red', '#FF2A1A'], ['Оранжевый', 'Orange', '#FF8C1A'], ['Янтарь', 'Amber', '#FFB52E'], ['Фиолетовый', 'Purple', '#A855FF'], ['Голубой', 'Cyan', '#2EE6FF']];
export const RGBS = [
  ['Rainbow', '7F00FF 0000FF 00FFFF 00FF00 FFFF00 FF0000'],
  ['Mac Style', '8000FF 0040FF 00FFFF 00FF00 FFFF00 FF0000'],
  ['jet', '0000FF 00FFFF 80FF80 FFFF00 FF0000 800000'],
  ['PRISM', 'FF0000 FFA000 80FF00 00FFFF 0040FF'],
  ['Pastels', 'FF0080 FF40C0 00FFFF 00FF80 C0FF00 FFFF00'],
  ['Hardcandy', '3060FF 00E0FF FF0080 40FF60 FFE000 FF60C0'],
  ['hot', 'FF0000 FF8000 FFFF00 FFFFFF'],
  ['Volcano', '6040C0 00A000 C06000 FF0000 FFFF00 6060FF'],
].map(([n, c]) => [n, c.split(' ').map((x) => '#' + x)]);
export const HEATS = {
  ironbow: { name: 'IRONBOW', acc: '#FFD43B', glow: '#FF4A12', pal: '0B0418 2E0B5E 6B1585 B51F7A E8382F FF7A1A FFC233 FFF27A FFFFFF' },
  white: { name: 'WHITE HOT', acc: '#4DFF7A', glow: '#D0D8E0', pal: '050505 1E1E22 3C3C42 616168 8A8A90 B2B2B6 D6D6D8 F0F0F0 FFFFFF' },
  rainbow: { name: 'RAINBOW HC', acc: '#FFFFFF', glow: '#FF3060', pal: '0A0030 1A1AA8 0070FF 00C8E0 00E060 B8F000 FFD000 FF5000 FF0030 FFFFFF' },
  arctic: { name: 'ARCTIC', acc: '#7FE3FF', glow: '#F7B733', pal: '020617 0B1E5B 1C47A8 3C82E0 8EC3F2 E9D9A6 F7B733 FFD966 FFFFFF' },
  lava: { name: 'LAVA', acc: '#FF8A3D', glow: '#FF5A1F', pal: '04040C 14204A 0E5A6E 3A6E4C B0362A E8611A F7A531 FFE27A FFFFFF' },
  medical: { name: 'MEDICAL', acc: '#00E0FF', glow: '#FF4000', pal: '000010 0030A0 00A0C0 00C060 A0E000 FFD000 FF6000 E00000 FFFFFF' },
  sepia: { name: 'SEPIA', acc: '#FFC27A', glow: '#E3A15A', pal: '140A04 3A2412 5E3C1E 84582E A87A46 C99D66 E3C08C F4DDB4 FFF6E6' },
  night: { name: 'NIGHT VISION', acc: '#6CFF7A', glow: '#3CD650', pal: '010A02 03250A 064A14 0B7A22 16A832 3CD650 86F08A CFFFD0 FFFFFF' },
  alert: { name: 'HOT ALERT', acc: '#FF3B30', glow: '#FF3B30', pal: '0A0A0A 2A2A2A 4D4D4D 707070 939393 B6B6B6 D9D9D9 FF6A3D FF1E1E' },
  ice: { name: 'ICE', acc: '#7FE8FF', glow: '#9BE1F0', pal: '00040C 06203A 0B4A6E 1E7FA8 4FB6D6 9BE1F0 D6F6FF F2FCFF FFFFFF' },
};
Object.values(HEATS).forEach((h) => { h.pal = h.pal.split(' ').map((x) => '#' + x); });

export const THEMES = [
  { id: 'standard', ru: 'Стандарт', en: 'Standard', pv: 'background:#10141f;color:#ff8a5b', ic: '◉' },
  { id: 'terminal', ru: 'Терминал', en: 'Terminal', pv: 'background:#000;color:#1FFF3A;font-family:VT323,monospace;font-size:28px', ic: '>_' },
  { id: 'prism', ru: 'Призма', en: 'Prism', pv: 'background:linear-gradient(135deg,#ff5ec4,#8a7bff,#3fd8ff,#7dffb0,#ffe066);color:#120E1F', ic: '◆' },
  { id: 'thermal', ru: 'Тепловизор', en: 'Thermal', pv: 'background:radial-gradient(circle,#fff27a,#ff7a1a 35%,#b51f7a 65%,#0b0418);color:#fff', ic: '◎' },
  { id: 'blueprint', ru: 'Чертёж', en: 'Blueprint', pv: 'background:#1A4A9E;background-image:linear-gradient(rgba(255,255,255,.25) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.25) 1px,transparent 1px);background-size:12px 12px;color:#fff', ic: '⌖' },
];

const DEF = { id: 'standard', term: '#1FFF3A', rgb: '', matrix: false, prHue: 0, heat: 'ironbow', bpHue: 218, bpShade: 0.5 };
export let TH = { ...DEF };
try { TH = { ...DEF, ...JSON.parse(localStorage.getItem('mt_theme') || '{}') }; } catch {}
const save = () => { try { localStorage.setItem('mt_theme', JSON.stringify(TH)); } catch {} };

const hueOf = (hex) => { const [r, g, b] = rgbOf(hex).map((v) => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return null; const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (h, k) => { const [r, g, b] = rgbOf(h); return `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`; };
const rgba = (h, a) => { const [r, g, b] = rgbOf(h); return `rgba(${r},${g},${b},${a})`; };

let fx = null;
function ensureFx() {
  if (fx) return fx;
  const bg = document.createElement('div'); bg.className = 'theme-bg'; bg.innerHTML = '<i></i><i></i><i></i><i></i>';
  const ov = document.createElement('div'); ov.className = 'rgb-ov';
  const cv = document.createElement('canvas'); cv.id = 'matrix';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.style.position = 'absolute';
  svg.innerHTML = `<filter id="heatmap" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="-.3 -.59 -.11 0 1  -.3 -.59 -.11 0 1  -.3 -.59 -.11 0 1  0 0 0 1 0"/><feComponentTransfer><feFuncR type="table"/><feFuncG type="table"/><feFuncB type="table"/></feComponentTransfer></filter>`;
  document.body.prepend(bg); document.body.appendChild(ov); document.body.prepend(cv); document.body.appendChild(svg);
  fx = { bg, ov, cv, svg };
  return fx;
}

export function applyTheme() {
  const root = document.documentElement, st = root.style;
  ensureFx();
  ['--term', '--text', '--muted', '--dim', '--line', '--card2', '--accent', '--accent-soft', '--violet', '--gold', '--teal', '--rgbg',
    '--i1', '--i2', '--i3', '--i4', '--i5', '--i6', '--heat', '--heatr', '--warm', '--warmr', '--hot3', '--yel', '--glow', '--bg', '--bg2', '--bga', '--tile-filter']
    .forEach((v) => st.removeProperty(v));
  root.classList.remove('rgb', 'matrix');
  let meta = '#10141f';
  if (TH.id === 'standard') delete root.dataset.theme; else root.dataset.theme = TH.id;

  if (TH.id === 'terminal') {
    const rgb = RGBS.find(([n]) => n === TH.rgb);
    const c = rgb ? '#FFFFFF' : TH.term;
    st.setProperty('--term', c); st.setProperty('--text', c); st.setProperty('--muted', mix(c, 0.62)); st.setProperty('--dim', mix(c, 0.45));
    st.setProperty('--line', mix(c, 0.39)); st.setProperty('--card2', rgba(c, 0.07)); st.setProperty('--accent', c); st.setProperty('--accent-soft', rgba(c, 0.14));
    st.setProperty('--violet', c); st.setProperty('--gold', c); st.setProperty('--teal', c);
    if (rgb) { root.classList.add('rgb'); st.setProperty('--rgbg', `linear-gradient(90deg,${[...rgb[1], rgb[1][0]].join(',')})`); }
    if (TH.matrix && !rgb) root.classList.add('matrix');
    const hu = hueOf(c);
    st.setProperty('--tile-filter', 'grayscale(1) invert(1) contrast(1.2) brightness(.85)' + (hu == null ? '' : ` sepia(1) hue-rotate(${Math.round(hu - 40)}deg) saturate(5)`));
    meta = '#000000';
  } else if (TH.id === 'prism') {
    const base = [320, 260, 200, 150, 50, 20];
    base.forEach((h, i) => st.setProperty('--i' + (i + 1), `hsl(${(h + TH.prHue) % 360} 100% 66%)`));
    st.setProperty('--accent', `hsl(${(260 + TH.prHue) % 360} 100% 72%)`); st.setProperty('--violet', `hsl(${(200 + TH.prHue) % 360} 100% 70%)`);
    st.setProperty('--tile-filter', `invert(1) hue-rotate(${Math.round(180 + TH.prHue)}deg) saturate(1.5) brightness(.85) contrast(1.05)`);
    meta = '#07060B';
  } else if (TH.id === 'thermal') {
    const h = HEATS[TH.heat] || HEATS.ironbow, p = h.pal;
    st.setProperty('--heat', p.join(',')); st.setProperty('--heatr', [...p].reverse().join(','));
    st.setProperty('--warm', p.slice(-6).join(',')); st.setProperty('--warmr', p.slice(-6).reverse().join(','));
    st.setProperty('--hot3', p.slice(4, 7).join(',')); st.setProperty('--yel', h.acc); st.setProperty('--glow', h.glow);
    const tab = (k) => p.map((x) => (rgbOf(x)[k] / 255).toFixed(3)).join(' ');
    ['R', 'G', 'B'].forEach((ch, k) => fx.svg.querySelector('feFunc' + ch).setAttribute('tableValues', tab(k)));
    meta = '#050308';
  } else if (TH.id === 'blueprint') {
    const L = 14 + TH.bpShade * 44;
    st.setProperty('--bg', `hsl(${TH.bpHue} 72% ${L}%)`); st.setProperty('--bg2', `hsl(${TH.bpHue} 72% ${L - 5}%)`);
    st.setProperty('--bga', `hsla(${TH.bpHue}, 72%, ${L}%, .8)`);
    st.setProperty('--tile-filter', `grayscale(1) invert(1) contrast(1.3) brightness(${(1.1 + TH.bpShade * 0.8).toFixed(2)}) sepia(1) hue-rotate(${Math.round(TH.bpHue - 40)}deg) saturate(3.5)`);
    meta = `hsl(${TH.bpHue} 72% ${L}%)`;
  }
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', meta);
  matrixLoop();
}

// ---------- «Матрица» ----------
let mxRaf = 0;
function matrixLoop() {
  cancelAnimationFrame(mxRaf);
  if (!document.documentElement.classList.contains('matrix')) return;
  const cv = fx.cv, ctx = cv.getContext('2d');
  const fs = 16; let cols = [], last = 0;
  const resize = () => { cv.width = innerWidth; cv.height = innerHeight; cols = Array.from({ length: Math.ceil(innerWidth / fs) }, () => Math.random() * -50); };
  resize(); addEventListener('resize', resize, { once: true });
  const chars = 'アイウエオカキクケコサシスセソタチツテト0123456789ABCDEFZ';
  const draw = (ts) => {
    mxRaf = requestAnimationFrame(draw);
    if (ts - last < 60) return; last = ts;
    ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = TH.term; ctx.font = fs + 'px VT323, monospace'; ctx.globalAlpha = 0.55;
    cols.forEach((y, i) => {
      ctx.fillText(chars[Math.floor(Math.random() * chars.length)], i * fs, y * fs);
      cols[i] = y * fs > cv.height && Math.random() > 0.97 ? 0 : y + 1;
    });
    ctx.globalAlpha = 1;
  };
  mxRaf = requestAnimationFrame(draw);
}

// ---------- блок выбора темы в настройках ----------
export function themePicker(box) {
  const ru = getLang() === 'ru';
  const draw = () => {
    let opts = '';
    if (TH.id === 'terminal') {
      opts = `<div class="theme-opts"><b>${ru ? 'Цвет' : 'Colour'}</b>
        <div class="swatches">${PRESETS.map(([r, e, c]) => `<button data-tc="${c}" title="${ru ? r : e}" class="${!TH.rgb && TH.term === c ? 'on' : ''}" style="background:${c}"></button>`).join('')}
          <label style="display:grid;place-items:center;width:40px;height:40px;border-radius:50%;border:2px dashed var(--line);cursor:pointer;position:relative">+<input type="color" data-tcp value="${TH.term}" style="position:absolute;inset:0;opacity:0;cursor:pointer"></label></div>
        <div class="row-l"><span>${ru ? 'RGB-перелив' : 'RGB flow'}</span><select data-rgb class="input" style="width:auto;min-height:40px;font-size:15px;padding:0 10px"><option value="">${ru ? 'выкл' : 'off'}</option>${RGBS.map(([n]) => `<option ${TH.rgb === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        <label class="row-l"><span>${ru ? '«Матрица» на фоне' : 'Matrix rain'}</span><input type="checkbox" data-mx ${TH.matrix ? 'checked' : ''} style="width:26px;height:26px;accent-color:var(--accent)"></label></div>`;
    } else if (TH.id === 'prism') {
      opts = `<div class="theme-opts"><div class="row-l" style="margin:0"><b>${ru ? 'Сдвиг радуги' : 'Rainbow shift'}</b><span>${Math.round(TH.prHue)}°</span></div>
        <input type="range" class="range" min="0" max="359" value="${TH.prHue}" data-ph style="margin-top:8px"></div>`;
    } else if (TH.id === 'thermal') {
      opts = `<div class="theme-opts"><b>${ru ? 'Палитра' : 'Palette'}</b><div class="heats">${Object.entries(HEATS).map(([k, h]) => `<button data-ht="${k}" class="${TH.heat === k ? 'on' : ''}"><b style="background:linear-gradient(90deg,${h.pal.join(',')})"></b>${h.name}</button>`).join('')}</div></div>`;
    } else if (TH.id === 'blueprint') {
      opts = `<div class="theme-opts"><div class="row-l" style="margin:0"><b>${ru ? 'Оттенок' : 'Hue'}</b><span>${Math.round(TH.bpHue)}°</span></div>
        <input type="range" class="range" min="0" max="359" value="${TH.bpHue}" data-bh>
        <div class="row-l"><b>${ru ? 'Светлота листа' : 'Sheet lightness'}</b><span>${Math.round(TH.bpShade * 100)}%</span></div>
        <input type="range" class="range" min="0" max="1" step="0.01" value="${TH.bpShade}" data-bs></div>`;
    }
    box.innerHTML = `<div class="themes">${THEMES.map((t) => `<button data-th="${t.id}" class="${TH.id === t.id ? 'on' : ''}"><div class="pv" style="${t.pv}">${t.ic}</div><div class="nm">${ru ? t.ru : t.en}</div></button>`).join('')}</div>${opts}`;
    const set = (k, v, redraw = true) => { TH[k] = v; save(); applyTheme(); if (redraw) draw(); };
    box.querySelectorAll('[data-th]').forEach((b) => b.onclick = () => set('id', b.dataset.th));
    box.querySelectorAll('[data-tc]').forEach((b) => b.onclick = () => { TH.rgb = ''; set('term', b.dataset.tc); });
    const tcp = box.querySelector('[data-tcp]'); if (tcp) tcp.onchange = () => { TH.rgb = ''; set('term', tcp.value.toUpperCase()); };
    const rg = box.querySelector('[data-rgb]'); if (rg) rg.onchange = () => set('rgb', rg.value);
    const mx = box.querySelector('[data-mx]'); if (mx) mx.onchange = () => set('matrix', mx.checked);
    box.querySelectorAll('[data-ht]').forEach((b) => b.onclick = () => set('heat', b.dataset.ht));
    const live = (sel, k, f = parseFloat) => { const r = box.querySelector(sel); if (r) { r.oninput = () => { set(k, f(r.value), false); r.previousElementSibling.lastElementChild && (r.previousElementSibling.lastElementChild.textContent = k === 'bpShade' ? Math.round(TH[k] * 100) + '%' : Math.round(TH[k]) + '°'); }; } };
    live('[data-ph]', 'prHue'); live('[data-bh]', 'bpHue'); live('[data-bs]', 'bpShade');
  };
  draw();
}
