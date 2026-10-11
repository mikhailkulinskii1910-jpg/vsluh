'use strict';
// Физика: ткань на частицах (Verlet + позиционные ограничения), рабочий стол — пол z = 0,
// ось z смотрит на зрителя. Рисование: WebGL2, перспектива сверху, размытая тень.

const api = window.desk || { // заглушка, чтобы страницу можно было открыть в браузере
  init: async () => ({ settings: { size: 'medium' }, state: null }),
  hover() {}, drag() {}, menu() {}, saveState() {}, onCursor() {}, onCommand() {}, onEsc() {}, quit() {},
};

// ---------- параметры ----------
const NX = 30, NY = 46, N = NX * NY;
const TEX_ASPECT = 1093 / 713;
const SIZES = { small: 220, medium: 320, large: 440 };
const DT = 1 / 120;
const GRAVITY = -2600;          // px/с², вниз к столу
const FRICTION = 0.55;          // коэффициент трения ковра о стол
const ITER = 12;
const BEND = 0.32;              // жёсткость на изгиб (ковёр плотнее простыни)
const DAMP = 0.996;
const CAM = 1800;               // высота «глаза» над столом, px
const LIGHT = norm3(-0.35, -0.55, 0.85);

function norm3(x, y, z) { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; }

// ---------- состояние ----------
let W = innerWidth, H = innerHeight;
let width = SIZES.medium, spacing = 1;
const px = new Float32Array(N), py = new Float32Array(N), pz = new Float32Array(N);
const ox = new Float32Array(N), oy = new Float32Array(N), oz = new Float32Array(N);
const inv = new Float32Array(N).fill(1);
const sx = new Float32Array(N), sy = new Float32Array(N); // экранные координаты
let cA, cB, cRest, cK, cCount = 0;

let grab = -1, grabTX = 0, grabTY = 0, grabZ = 0, liftH = 70;
let mouseX = -1, mouseY = -1, prevMX = -1, prevMY = -1;
let overCarpet = false, sleeping = false, calm = 0, needDraw = true;

const idx = (i, j) => j * NX + i;

function buildConstraints() {
  const list = [];
  const add = (a, b, k) => list.push(a, b, k);
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const a = idx(i, j);
    if (i + 1 < NX) add(a, idx(i + 1, j), 1);
    if (j + 1 < NY) add(a, idx(i, j + 1), 1);
    if (i + 1 < NX && j + 1 < NY) { add(a, idx(i + 1, j + 1), 0.9); add(idx(i + 1, j), idx(i, j + 1), 0.9); }
    if (i + 2 < NX) add(a, idx(i + 2, j), BEND);
    if (j + 2 < NY) add(a, idx(i, j + 2), BEND);
  }
  cCount = list.length / 3;
  cA = new Int32Array(cCount); cB = new Int32Array(cCount);
  cRest = new Float32Array(cCount); cK = new Float32Array(cCount);
  for (let c = 0; c < cCount; c++) { cA[c] = list[c * 3]; cB[c] = list[c * 3 + 1]; cK[c] = list[c * 3 + 2]; }
}

function setRest() {
  spacing = width / (NX - 1);
  for (let c = 0; c < cCount; c++) {
    const a = cA[c], b = cB[c];
    const ai = a % NX, aj = (a / NX) | 0, bi = b % NX, bj = (b / NX) | 0;
    cRest[c] = Math.hypot(ai - bi, aj - bj) * spacing;
  }
}

// уложить ковёр плоско: центр, угол, высота, наклон (для эффектного падения)
function layFlat(cx, cy, ang, z0, tilt = 0) {
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const w = (NX - 1) * spacing, h = (NY - 1) * spacing;
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const k = idx(i, j);
    const lx = i * spacing - w / 2, ly = j * spacing - h / 2;
    px[k] = ox[k] = cx + lx * ca - ly * sa;
    py[k] = oy[k] = cy + lx * sa + ly * ca;
    pz[k] = oz[k] = Math.max(0, z0 + ly * tilt + Math.random() * 0.4);
  }
  wake();
}

function pose() { // текущие центр и угол ковра
  let cx = 0, cy = 0, dx = 0, dy = 0;
  for (let k = 0; k < N; k++) { cx += px[k]; cy += py[k]; }
  for (let j = 0; j < NY; j++) { dx += px[idx(NX - 1, j)] - px[idx(0, j)]; dy += py[idx(NX - 1, j)] - py[idx(0, j)]; }
  return { cx: cx / N, cy: cy / N, ang: Math.atan2(dy, dx) };
}

function setSize(name, keepPose) {
  width = SIZES[name] || SIZES.medium;
  const p = keepPose ? pose() : { cx: W / 2, cy: H / 2, ang: -0.12 };
  setRest();
  const h = width * TEX_ASPECT;
  p.cx = Math.min(Math.max(p.cx, width / 2 + 10), W - width / 2 - 10);
  p.cy = Math.min(Math.max(p.cy, Math.min(h / 2 + 10, H / 2)), Math.max(H - h / 2 - 10, H / 2));
  layFlat(p.cx, p.cy, p.ang, keepPose ? 40 : 160, keepPose ? 0 : 0.25);
}

// ---------- самостолкновения (плоская сетка по x, y; высоту сверяем отдельно) ----------
let gridCols = 1, gridRows = 1, gHead = new Int32Array(1);
const gNext = new Int32Array(N);

function selfCollide() {
  const r = spacing * 0.8, r2 = r * r, inv_r = 1 / r;
  const cols = Math.ceil(W * inv_r) + 2, rows = Math.ceil(H * inv_r) + 2;
  if (cols * rows !== gHead.length) { gridCols = cols; gridRows = rows; gHead = new Int32Array(cols * rows); }
  gHead.fill(-1);
  for (let k = 0; k < N; k++) {
    const c = (((py[k] * inv_r) | 0) + 1) * gridCols + ((px[k] * inv_r) | 0) + 1;
    gNext[k] = gHead[c]; gHead[c] = k;
  }
  for (let a = 0; a < N; a++) {
    const ai = a % NX, aj = (a / NX) | 0;
    const gx = ((px[a] * inv_r) | 0) + 1, gy = ((py[a] * inv_r) | 0) + 1;
    for (let dy = -1; dy <= 1; dy++) {
      const row = (gy + dy) * gridCols;
      if (gy + dy < 0 || gy + dy >= gridRows) continue;
      for (let dx = -1; dx <= 1; dx++) {
        for (let b = gHead[row + gx + dx]; b !== -1; b = gNext[b]) {
          if (b <= a) continue;
          const ez = pz[b] - pz[a];
          if (ez > r || ez < -r) continue;
          const bi = b % NX, bj = (b / NX) | 0;
          if (Math.abs(ai - bi) <= 2 && Math.abs(aj - bj) <= 2) continue;
          const ex = px[b] - px[a], ey = py[b] - py[a];
          const d2 = ex * ex + ey * ey + ez * ez;
          if (d2 >= r2 || d2 < 1e-8) continue;
          const wa = inv[a], wb = inv[b], ws = wa + wb;
          if (ws === 0) continue;
          const d = Math.sqrt(d2), s = (r - d) / d / ws;
          px[a] -= ex * s * wa; py[a] -= ey * s * wa; pz[a] -= ez * s * wa;
          px[b] += ex * s * wb; py[b] += ey * s * wb; pz[b] += ez * s * wb;
          // слои ковра цепляются друг за друга ворсом
          const fx = (px[b] - ox[b]) - (px[a] - ox[a]), fy = (py[b] - oy[b]) - (py[a] - oy[a]);
          const f = 0.25 / ws;
          px[a] += fx * f * wa; py[a] += fy * f * wa;
          px[b] -= fx * f * wb; py[b] -= fy * f * wb;
        }
      }
    }
  }
}

// ---------- столкновения точка — треугольник ----------
// Каждая частица помнит, с какой стороны чужого треугольника она была в начале шага,
// и не может оказаться по другую сторону: слои ковра не проходят друг сквозь друга.
const TRI = (NX - 1) * (NY - 1) * 2;
const triV = new Int32Array(TRI * 3), triI = new Int32Array(TRI), triJ = new Int32Array(TRI);
{
  let t = 0;
  for (let j = 0; j < NY - 1; j++) for (let i = 0; i < NX - 1; i++) {
    const a = idx(i, j), b = a + 1, c = a + NX, d = c + 1;
    triV.set([a, b, c], t * 3); triI[t] = i; triJ[t] = j; t++;
    triV.set([b, d, c], t * 3); triI[t] = i; triJ[t] = j; t++;
  }
}
const MAXE = TRI * 24;
const eTri = new Int32Array(MAXE), eNext = new Int32Array(MAXE);
let tHead = new Int32Array(1), tCols = 1, tRows = 1;

const wOf = (k) => pz[k] < 0.5 ? inv[k] * 0.15 : inv[k]; // лежащее на столе почти не продавить вниз

// пробные точки: сами частицы и середины рёбер (горизонталь, вертикаль, диагональ ячейки) —
// по серединам ловятся рёбра, проходящие сквозь чужую ткань на сгибах
const SA = [], SB = [];
for (let k = 0; k < N; k++) { SA.push(k); SB.push(-1); }
for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
  const a = idx(i, j);
  if (i + 1 < NX) { SA.push(a); SB.push(a + 1); }
  if (j + 1 < NY) { SA.push(a); SB.push(a + NX); }
  if (i + 1 < NX && j + 1 < NY) { SA.push(a + 1); SB.push(a + NX); }
}
const S = SA.length, sA = Int32Array.from(SA), sB = Int32Array.from(SB);
// всё, что зависит только от треугольника, считаем один раз за проход
const tN = new Float64Array(TRI * 3), tO = new Float64Array(TRI * 4), tB = new Float64Array(TRI * 4), tZ = new Float64Array(TRI * 2);
const tOk = new Uint8Array(TRI);
// толчки копятся и применяются усреднённо (метод Якоби) — так много одновременных касаний не раскачивают ткань
const cX = new Float64Array(N), cY = new Float64Array(N), cZ = new Float64Array(N), cW = new Float64Array(N);
const bX = new Float32Array(N), bY = new Float32Array(N), bZ = new Float32Array(N);
const push = (k, x, y, z, w) => { cX[k] += x; cY[k] += y; cZ[k] += z; cW[k] += w; };

function triCollide() {
  const h = spacing * 0.6, C = spacing * 1.5, iC = 1 / C;
  const cols = Math.ceil(W * iC) + 3, rows = Math.ceil(H * iC) + 3;
  if (cols * rows !== tHead.length) { tCols = cols; tRows = rows; tHead = new Int32Array(cols * rows); }
  tHead.fill(-1);
  cX.fill(0); cY.fill(0); cZ.fill(0); cW.fill(0);
  let ne = 0;
  for (let t = 0; t < TRI; t++) {
    const a = triV[t * 3], b = triV[t * 3 + 1], c = triV[t * 3 + 2];
    const x0 = Math.max(0, ((Math.min(px[a], px[b], px[c], ox[a], ox[b], ox[c]) - h) * iC | 0) + 1);
    const x1 = Math.min(tCols - 1, ((Math.max(px[a], px[b], px[c], ox[a], ox[b], ox[c]) + h) * iC | 0) + 1);
    const y0 = Math.max(0, ((Math.min(py[a], py[b], py[c], oy[a], oy[b], oy[c]) - h) * iC | 0) + 1);
    const y1 = Math.min(tRows - 1, ((Math.max(py[a], py[b], py[c], oy[a], oy[b], oy[c]) + h) * iC | 0) + 1);
    tOk[t] = 0;
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 64) continue; // разорванный треугольник — не ловим
    const ux = px[b] - px[a], uy = py[b] - py[a], uz = pz[b] - pz[a];
    const vx = px[c] - px[a], vy = py[c] - py[a], vz = pz[c] - pz[a];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz);
    const uu = ux * ux + uy * uy + uz * uz, vv = vx * vx + vy * vy + vz * vz, uv = ux * vx + uy * vy + uz * vz;
    const den = uv * uv - uu * vv;
    const oux = ox[b] - ox[a], ouy = oy[b] - oy[a], ouz = oz[b] - oz[a];
    const ovx = ox[c] - ox[a], ovy = oy[c] - oy[a], ovz = oz[c] - oz[a];
    const onx = ouy * ovz - ouz * ovy, ony = ouz * ovx - oux * ovz, onz = oux * ovy - ouy * ovx;
    const ouu = oux * oux + ouy * ouy + ouz * ouz, ovv = ovx * ovx + ovy * ovy + ovz * ovz;
    const ouv = oux * ovx + ouy * ovy + ouz * ovz, oden = ouv * ouv - ouu * ovv;
    if (nl < 1e-6 || Math.abs(den) < 1e-9 || Math.abs(oden) < 1e-9) continue;
    tOk[t] = 1;
    tN[t * 3] = nx / nl; tN[t * 3 + 1] = ny / nl; tN[t * 3 + 2] = nz / nl;
    tO[t * 4] = onx; tO[t * 4 + 1] = ony; tO[t * 4 + 2] = onz; tO[t * 4 + 3] = 1e-4 * Math.hypot(onx, ony, onz);
    tB[t * 4] = ouu; tB[t * 4 + 1] = ovv; tB[t * 4 + 2] = ouv; tB[t * 4 + 3] = oden;
    tZ[t * 2] = Math.min(pz[a], pz[b], pz[c]); tZ[t * 2 + 1] = Math.max(pz[a], pz[b], pz[c]);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (ne >= MAXE) break;
      const cell = y * tCols + x;
      eTri[ne] = t; eNext[ne] = tHead[cell]; tHead[cell] = ne++;
    }
  }
  for (let q = 0; q < S; q++) {
    const pa = sA[q], pb = sB[q];
    let qx, qy, qz, qox, qoy, qoz, wq;
    if (pb < 0) {
      wq = wOf(pa); if (wq === 0) continue;
      qx = px[pa]; qy = py[pa]; qz = pz[pa]; qox = ox[pa]; qoy = oy[pa]; qoz = oz[pa];
    } else {
      wq = (wOf(pa) + wOf(pb)) * 0.25; if (wq === 0) continue; // середина: масса делится на два конца
      qx = (px[pa] + px[pb]) * 0.5; qy = (py[pa] + py[pb]) * 0.5; qz = (pz[pa] + pz[pb]) * 0.5;
      qox = (ox[pa] + ox[pb]) * 0.5; qoy = (oy[pa] + oy[pb]) * 0.5; qoz = (oz[pa] + oz[pb]) * 0.5;
    }
    const ai = pa % NX, aj = (pa / NX) | 0;
    const bi = pb < 0 ? ai : pb % NX, bj = pb < 0 ? aj : (pb / NX) | 0;
    const cx = (qx * iC | 0) + 1, cy = (qy * iC | 0) + 1;
    if (cx < 0 || cy < 0 || cx >= tCols || cy >= tRows) continue;
    const motion = Math.abs(qz - qoz) + Math.abs(qx - qox) + Math.abs(qy - qoy);
    const m = h + motion + 1;
    for (let e = tHead[cy * tCols + cx]; e !== -1; e = eNext[e]) {
      const t = eTri[e], ti = triI[t], tj = triJ[t];
      if (ai >= ti - 1 && ai <= ti + 2 && aj >= tj - 1 && aj <= tj + 2) continue; // свои соседи
      if (bi >= ti - 1 && bi <= ti + 2 && bj >= tj - 1 && bj <= tj + 2) continue;
      if (!tOk[t] || qz > tZ[t * 2 + 1] + m || qz < tZ[t * 2] - m) continue;
      const a = triV[t * 3], b = triV[t * 3 + 1], c = triV[t * 3 + 2];
      const nx = tN[t * 3], ny = tN[t * 3 + 1], nz = tN[t * 3 + 2];
      const wx = qx - px[a], wy = qy - py[a], wz = qz - pz[a];
      const d = wx * nx + wy * ny + wz * nz;
      if (d > m || d < -m) continue;
      // проекция внутрь треугольника? (текущие рёбра)
      const ux = px[b] - px[a], uy = py[b] - py[a], uz = pz[b] - pz[a];
      const vx = px[c] - px[a], vy = py[c] - py[a], vz = pz[c] - pz[a];
      const uu = ux * ux + uy * uy + uz * uz, vv = vx * vx + vy * vy + vz * vz, uv = ux * vx + uy * vy + uz * vz;
      const wu = wx * ux + wy * uy + wz * uz, wv = wx * vx + wy * vy + wz * vz;
      const den = uv * uv - uu * vv; if (Math.abs(den) < 1e-9) continue;
      const bb = (uv * wv - vv * wu) / den, bc = (uv * wu - uu * wv) / den, ba = 1 - bb - bc;
      if (bb < -0.05 || bc < -0.05 || ba < -0.05) continue;
      // с какой стороны точка была в начале шага
      const oux = ox[b] - ox[a], ouy = oy[b] - oy[a], ouz = oz[b] - oz[a];
      const ovx = ox[c] - ox[a], ovy = oy[c] - oy[a], ovz = oz[c] - oz[a];
      const owx = qox - ox[a], owy = qoy - oy[a], owz = qoz - oz[a];
      const d0 = owx * tO[t * 4] + owy * tO[t * 4 + 1] + owz * tO[t * 4 + 2];
      {
        const ouu = tB[t * 4], ovv = tB[t * 4 + 1], ouv = tB[t * 4 + 2], oden = tB[t * 4 + 3];
        const owu = owx * oux + owy * ouy + owz * ouz, owv = owx * ovx + owy * ovy + owz * ovz;
        const ob = (ouv * owv - ovv * owu) / oden, oc = (ouv * owu - ouu * owv) / oden;
        if (ob < -0.3 || oc < -0.3 || 1 - ob - oc < -0.3) continue;
      }
      const side = Math.abs(d0) > tO[t * 4 + 3] ? Math.sign(d0) : (d >= 0 ? 1 : -1);
      let pen = h - d * side;
      if (pen <= 0) continue;
      if (pen > h * 3) pen = h * 3; // не выстреливать точку через полэкрана
      const wa = wOf(a), wb = wOf(b), wc = wOf(c);
      const wsum = wq + wa * ba * ba + wb * bb * bb + wc * bc * bc;
      if (wsum < 1e-6) continue;
      const s = pen / wsum, fx = nx * side * s, fy = ny * side * s, fz = nz * side * s;
      if (pb < 0) push(pa, fx * wq, fy * wq, fz * wq, 1);
      else { // ребро сдвигаем целиком, обоими концами
        const wpa = wOf(pa) * 0.5, wpb = wOf(pb) * 0.5;
        push(pa, fx * wpa, fy * wpa, fz * wpa, 0.5); push(pb, fx * wpb, fy * wpb, fz * wpb, 0.5);
      }
      push(a, -fx * wa * ba, -fy * wa * ba, -fz * wa * ba, ba);
      push(b, -fx * wb * bb, -fy * wb * bb, -fz * wb * bb, bb);
      push(c, -fx * wc * bc, -fy * wc * bc, -fz * wc * bc, bc);
    }
  }
  // применяем усреднённые толчки
  for (let k = 0; k < N; k++) {
    if (cW[k] === 0) continue;
    const f = 1.2 / Math.max(1, cW[k]);
    px[k] += cX[k] * f; py[k] += cY[k] * f; pz[k] += cZ[k] * f;
  }
}

// ---------- ограничение растяжения от точки захвата ----------
// Ни одна точка ковра не может оказаться дальше от схваченной, чем позволяет сама ткань.
const lraRest = new Float32Array(N);
function setTethers(g) {
  const gi = g % NX, gj = (g / NX) | 0;
  for (let k = 0; k < N; k++) lraRest[k] = Math.hypot(k % NX - gi, ((k / NX) | 0) - gj) * spacing * 1.01;
}
function tethers() {
  if (grab < 0) return;
  const gx = px[grab], gy = py[grab], gz = pz[grab];
  for (let k = 0; k < N; k++) {
    if (inv[k] === 0) continue;
    const ex = px[k] - gx, ey = py[k] - gy, ez = pz[k] - gz;
    const d = Math.sqrt(ex * ex + ey * ey + ez * ez);
    if (d <= lraRest[k]) continue;
    const s = (d - lraRest[k]) / d;
    px[k] -= ex * s; py[k] -= ey * s; pz[k] -= ez * s;
  }
}

// жёсткий предел растяжения основных нитей
function strainLimit(maxRatio) {
  for (let n = 0; n < cCount; n++) {
    if (cK[n] < 1) continue;
    const a = cA[n], b = cB[n], wa = inv[a], wb = inv[b], ws = wa + wb;
    if (ws === 0) continue;
    const ex = px[b] - px[a], ey = py[b] - py[a], ez = pz[b] - pz[a];
    const d = Math.sqrt(ex * ex + ey * ey + ez * ez), max = cRest[n] * maxRatio;
    if (d <= max) continue;
    const sc = (d - max) / d / ws;
    px[a] += ex * sc * wa; py[a] += ey * sc * wa; pz[a] += ez * sc * wa;
    px[b] -= ex * sc * wb; py[b] -= ey * sc * wb; pz[b] -= ez * sc * wb;
  }
}

// ---------- шаг физики ----------
function step(dt, t) {
  const g = GRAVITY * dt * dt;
  for (let k = 0; k < N; k++) {
    if (inv[k] === 0) continue;
    let vx = (px[k] - ox[k]) * DAMP, vy = (py[k] - oy[k]) * DAMP, vz = (pz[k] - oz[k]) * DAMP;
    const v = Math.hypot(vx, vy, vz);
    if (v > 40) { vx *= 40 / v; vy *= 40 / v; vz *= 40 / v; }
    ox[k] = px[k]; oy[k] = py[k]; oz[k] = pz[k];
    px[k] += vx; py[k] += vy; pz[k] += vz + g;
  }

  if (grab >= 0) { // захваченная точка ведётся курсором (интерполяция между кадрами)
    grabZ += (liftH - grabZ) * Math.min(1, dt * 9);
    const mx = prevMX + (grabTX - prevMX) * t, my = prevMY + (grabTY - prevMY) * t;
    const s = (CAM - grabZ) / CAM;
    ox[grab] = px[grab]; oy[grab] = py[grab]; oz[grab] = pz[grab];
    // тяжёлый ковёр не успевает за резким рывком мыши: точка захвата догоняет курсор
    const tx = clamp(W / 2 + (mx - W / 2) * s, 0, W), ty = clamp(H / 2 + (my - H / 2) * s, 0, H);
    const dx = tx - px[grab], dy = ty - py[grab], dl = Math.hypot(dx, dy), lim = spacing * 0.6;
    const f = dl > lim ? lim / dl : 1;
    px[grab] += dx * f; py[grab] += dy * f;
    pz[grab] = grabZ;
  }

  for (let it = 0; it < ITER; it++) {
    const rev = it & 1; // чередуем порядок, чтобы не было перекоса
    for (let n = 0; n < cCount; n++) {
      const c = rev ? cCount - 1 - n : n;
      const a = cA[c], b = cB[c], wa = inv[a], wb = inv[b], ws = wa + wb;
      if (ws === 0) continue;
      const ex = px[b] - px[a], ey = py[b] - py[a], ez = pz[b] - pz[a];
      const d = Math.sqrt(ex * ex + ey * ey + ez * ez) || 1e-6;
      let diff = (d - cRest[c]) / d;
      if (cK[c] < 1 && diff > 0) diff *= 0.4; // изгибные связи тянут слабее, чем сжимают
      const s = diff * cK[c] / ws;
      px[a] += ex * s * wa; py[a] += ey * s * wa; pz[a] += ez * s * wa;
      px[b] -= ex * s * wb; py[b] -= ey * s * wb; pz[b] -= ez * s * wb;
    }
    tethers();
    if (it === 3 || it === ITER - 1) selfCollide();
    bounds();
  }

  strainLimit(1.05); strainLimit(1.05);

  // ковёр, улетевший за край экрана, сам выползает обратно (без жёстких стен — о них слои слипаются)
  if (grab < 0) {
    let cx = 0, cy = 0;
    for (let k = 0; k < N; k++) { cx += px[k]; cy += py[k]; }
    cx /= N; cy /= N;
    const mx = Math.min(width * 0.3, W / 2), my = Math.min(width * 0.45, H / 2);
    const sx = cx < mx ? Math.min(1.5, mx - cx) : cx > W - mx ? -Math.min(1.5, cx - W + mx) : 0;
    const sy = cy < my ? Math.min(1.5, my - cy) : cy > H - my ? -Math.min(1.5, cy - H + my) : 0;
    if (sx || sy) for (let k = 0; k < N; k++) { px[k] += sx; ox[k] += sx; py[k] += sy; oy[k] += sy; }
  }

  // трение о стол: кинетическое и покоя
  const lim = FRICTION * -GRAVITY * dt * dt;
  let maxv = 0;
  for (let k = 0; k < N; k++) {
    if (inv[k] !== 0 && pz[k] < 0.6) {
      const dx = px[k] - ox[k], dy = py[k] - oy[k], d = Math.hypot(dx, dy);
      if (d <= lim) { px[k] = ox[k]; py[k] = oy[k]; }
      else { px[k] -= dx / d * lim; py[k] -= dy / d * lim; }
    }
  }
  // последним — непроницаемость: что бы ни сделали трение и нити, слои не пересекаются
  strainLimit(1.08);
  bX.set(px); bY.set(py); bZ.set(pz);
  triCollide();
  triCollide();
  // касание без отскока: толчок от столкновений почти не превращается в скорость
  for (let k = 0; k < N; k++) {
    ox[k] += (px[k] - bX[k]) * 0.7; oy[k] += (py[k] - bY[k]) * 0.7; oz[k] += (pz[k] - bZ[k]) * 0.7;
  }
  bounds();
  for (let k = 0; k < N; k++) {
    const v = Math.abs(px[k] - ox[k]) + Math.abs(py[k] - oy[k]) + Math.abs(pz[k] - oz[k]);
    if (v > maxv) maxv = v;
  }
  return maxv;
}

function bounds() {
  for (let k = 0; k < N; k++) {
    if (pz[k] < 0) pz[k] = 0;
    else if (pz[k] > 700) pz[k] = 700;
  }
}

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

// ---------- проекция и попадание курсора ----------
function project() {
  const cx = W / 2, cy = H / 2;
  for (let k = 0; k < N; k++) {
    const s = CAM / (CAM - pz[k]);
    sx[k] = cx + (px[k] - cx) * s; sy[k] = cy + (py[k] - cy) * s;
  }
}

// верхний треугольник ковра под точкой: { k — ближайшая частица, z — высота }
function hitTest(x, y) {
  let best = null, bestZ = -1;
  for (let j = 0; j < NY - 1; j++) for (let i = 0; i < NX - 1; i++) {
    const a = idx(i, j), b = a + 1, c = a + NX, d = c + 1;
    const minx = Math.min(sx[a], sx[b], sx[c], sx[d]), maxx = Math.max(sx[a], sx[b], sx[c], sx[d]);
    if (x < minx || x > maxx) continue;
    const miny = Math.min(sy[a], sy[b], sy[c], sy[d]), maxy = Math.max(sy[a], sy[b], sy[c], sy[d]);
    if (y < miny || y > maxy) continue;
    for (const [p, q, r] of [[a, b, c], [b, d, c]]) {
      const bc = bary(x, y, p, q, r);
      if (!bc) continue;
      const z = pz[p] * bc[0] + pz[q] * bc[1] + pz[r] * bc[2];
      if (z > bestZ) {
        bestZ = z;
        const m = bc[0] >= bc[1] && bc[0] >= bc[2] ? p : bc[1] >= bc[2] ? q : r;
        best = { k: m, z };
      }
    }
  }
  return best;
}

function bary(x, y, p, q, r) {
  const x0 = sx[p], y0 = sy[p], x1 = sx[q], y1 = sy[q], x2 = sx[r], y2 = sy[r];
  const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
  if (Math.abs(den) < 1e-6) return null;
  const u = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / den;
  const v = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / den;
  const w = 1 - u - v;
  return u >= -0.01 && v >= -0.01 && w >= -0.01 ? [u, v, w] : null;
}

function updateHover() {
  if (grab >= 0) return;
  const over = mouseX >= 0 && !!hitTest(mouseX, mouseY);
  if (over !== overCarpet) {
    overCarpet = over;
    document.body.classList.toggle('over', over);
    api.hover(over);
  }
}

// ---------- WebGL ----------
const canvas = document.getElementById('c');
const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: true });
let dpr = 1;

function shader(type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function program(vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, shader(gl.VERTEX_SHADER, vs)); gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'aPos'); gl.bindAttribLocation(p, 1, 'aNrm'); gl.bindAttribLocation(p, 2, 'aUV');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  for (let i = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i--;) {
    const n = gl.getActiveUniform(p, i).name; u[n] = gl.getUniformLocation(p, n);
  }
  return { p, u };
}

const CLOTH_VS = `#version 300 es
in vec3 aPos; in vec3 aNrm; in vec2 aUV;
uniform vec2 uView; uniform float uCam; uniform vec2 uShadow;
out vec2 vUV; out vec3 vN; out float vZ;
void main() {
  vec2 p; float depth;
  if (uShadow.x > 0.0) {            // проекция на стол от лампы слева сверху
    p = aPos.xy + vec2(2.0, 3.5) + aPos.z * vec2(0.32, 0.5);
    depth = 0.0;
  } else {
    float s = uCam / (uCam - aPos.z);
    p = uView * 0.5 + (aPos.xy - uView * 0.5) * s;
    depth = -aPos.z / 1000.0;
  }
  vec2 ndc = p / uView * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, depth, 1.0);
  vUV = aUV; vN = aNrm; vZ = aPos.z;
}`;

const CLOTH_FS = `#version 300 es
precision highp float;
in vec2 vUV; in vec3 vN; in float vZ;
uniform sampler2D uTex; uniform vec3 uLight; uniform vec2 uShadow;
out vec4 o;
void main() {
  vec4 t = texture(uTex, vUV);
  if (t.a < 0.5) discard;
  if (uShadow.x > 0.0) { o = vec4(clamp(1.0 - vZ / 450.0, 0.35, 1.0)); return; }
  vec3 n = normalize(vN);
  vec3 col = t.rgb;
  if (!gl_FrontFacing) {           // изнанка: тот же узор, но блёклый и светлее
    n = -n;
    float l = dot(col, vec3(0.3, 0.59, 0.11));
    col = mix(vec3(l), vec3(0.42, 0.40, 0.37), 0.5) * 0.85 + 0.06;
  }
  float diff = max(dot(n, uLight), 0.0) / uLight.z;
  vec3 h = normalize(uLight + vec3(0.0, 0.0, 1.0));
  float sheen = pow(max(dot(n, h), 0.0), 18.0);
  float rim = pow(1.0 - max(n.z, 0.0), 2.0);   // складки темнее в глубине
  vec3 c = col * (0.22 + 0.78 * diff) * (1.0 - 0.35 * rim) + vec3(0.06) * sheen * (1.0 - rim);
  o = vec4(c, 1.0);
}`;

const QUAD_VS = `#version 300 es
in vec3 aPos; out vec2 vUV;
void main() { vUV = aPos.xy * 0.5 + 0.5; gl_Position = vec4(aPos.xy, 0.0, 1.0); }`;

const BLUR_FS = `#version 300 es
precision mediump float;
in vec2 vUV; uniform sampler2D uTex; uniform vec2 uDir; out vec4 o;
void main() {
  float w[5] = float[](0.204, 0.180, 0.124, 0.066, 0.028);
  float s = texture(uTex, vUV).r * w[0];
  for (int i = 1; i < 5; i++) {
    s += texture(uTex, vUV + uDir * float(i)).r * w[i];
    s += texture(uTex, vUV - uDir * float(i)).r * w[i];
  }
  o = vec4(s);
}`;

const COMP_FS = `#version 300 es
precision mediump float;
in vec2 vUV; uniform sampler2D uTex; out vec4 o;
void main() { float a = texture(uTex, vUV).r * 0.7; o = vec4(0.0, 0.0, 0.0, a); }`;

const clothProg = program(CLOTH_VS, CLOTH_FS);
const blurProg = program(QUAD_VS, BLUR_FS);
const compProg = program(QUAD_VS, COMP_FS);

const posData = new Float32Array(N * 3), nrmData = new Float32Array(N * 3), uvData = new Float32Array(N * 2);
for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
  const k = idx(i, j);
  uvData[k * 2] = 0.004 + 0.992 * i / (NX - 1); uvData[k * 2 + 1] = 0.003 + 0.994 * j / (NY - 1);
}
const indices = new Uint16Array((NX - 1) * (NY - 1) * 6);
{
  let n = 0;
  for (let j = 0; j < NY - 1; j++) for (let i = 0; i < NX - 1; i++) {
    const a = idx(i, j), b = a + 1, c = a + NX, d = c + 1;
    indices.set([a, b, c, b, d, c], n); n += 6;
  }
}

const vao = gl.createVertexArray();
gl.bindVertexArray(vao);
const posBuf = gl.createBuffer(), nrmBuf = gl.createBuffer(), uvBuf = gl.createBuffer(), idxBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, posBuf); gl.bufferData(gl.ARRAY_BUFFER, posData, gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
gl.bindBuffer(gl.ARRAY_BUFFER, nrmBuf); gl.bufferData(gl.ARRAY_BUFFER, nrmData, gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf); gl.bufferData(gl.ARRAY_BUFFER, uvData, gl.STATIC_DRAW);
gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

const quadVao = gl.createVertexArray();
gl.bindVertexArray(quadVao);
const quadBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
gl.bindVertexArray(null);

const tex = gl.createTexture();
let texReady = false;
const img = new Image();
img.onload = () => {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const af = gl.getExtension('EXT_texture_filter_anisotropic');
  if (af) gl.texParameterf(gl.TEXTURE_2D, af.TEXTURE_MAX_ANISOTROPY_EXT, 8);
  texReady = true; needDraw = true;
};
img.src = 'assets/carpet.png';

// тень рисуется в половинном разрешении и размывается
let shadowW = 1, shadowH = 1;
const fbs = [0, 1].map(() => ({ fb: gl.createFramebuffer(), tex: gl.createTexture() }));
function resizeTargets() {
  shadowW = Math.max(1, Math.round(canvas.width / 2)); shadowH = Math.max(1, Math.round(canvas.height / 2));
  for (const f of fbs) {
    gl.bindTexture(gl.TEXTURE_2D, f.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, shadowW, shadowH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, f.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, f.tex, 0);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function resize() {
  W = innerWidth; H = innerHeight; dpr = devicePixelRatio || 1;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  resizeTargets();
  bounds(); wake();
}

function computeNormals() {
  nrmData.fill(0);
  for (let j = 0; j < NY - 1; j++) for (let i = 0; i < NX - 1; i++) {
    const a = idx(i, j), b = a + 1, c = a + NX, d = c + 1;
    faceNormal(a, b, c); faceNormal(b, d, c);
  }
  for (let k = 0; k < N; k++) {
    posData[k * 3] = px[k]; posData[k * 3 + 1] = py[k]; posData[k * 3 + 2] = pz[k];
  }
}
function faceNormal(a, b, c) {
  const ux = px[b] - px[a], uy = py[b] - py[a], uz = pz[b] - pz[a];
  const vx = px[c] - px[a], vy = py[c] - py[a], vz = pz[c] - pz[a];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  nrmData[a * 3] += nx; nrmData[a * 3 + 1] += ny; nrmData[a * 3 + 2] += nz;
  nrmData[b * 3] += nx; nrmData[b * 3 + 1] += ny; nrmData[b * 3 + 2] += nz;
  nrmData[c * 3] += nx; nrmData[c * 3 + 1] += ny; nrmData[c * 3 + 2] += nz;
}

function draw() {
  if (!texReady) return;
  computeNormals();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, posData);
  gl.bindBuffer(gl.ARRAY_BUFFER, nrmBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, nrmData);

  gl.useProgram(clothProg.p);
  gl.uniform2f(clothProg.u.uView, W, H);
  gl.uniform1f(clothProg.u.uCam, CAM);
  gl.uniform3fv(clothProg.u.uLight, LIGHT);
  gl.uniform1i(clothProg.u.uTex, 0);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.bindVertexArray(vao);

  // 1) маска тени
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbs[0].fb);
  gl.viewport(0, 0, shadowW, shadowH);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
  gl.enable(gl.BLEND); gl.blendEquation(gl.MAX); gl.blendFunc(gl.ONE, gl.ONE);
  gl.uniform2f(clothProg.u.uShadow, 1, 0);
  gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
  gl.blendEquation(gl.FUNC_ADD); gl.disable(gl.BLEND);

  // 2) размытие: 0 → 1 по горизонтали, 1 → 0 по вертикали
  gl.useProgram(blurProg.p);
  gl.bindVertexArray(quadVao);
  gl.uniform1i(blurProg.u.uTex, 0);
  const r = 2.2;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbs[1].fb);
  gl.bindTexture(gl.TEXTURE_2D, fbs[0].tex);
  gl.uniform2f(blurProg.u.uDir, r / shadowW, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbs[0].fb);
  gl.bindTexture(gl.TEXTURE_2D, fbs[1].tex);
  gl.uniform2f(blurProg.u.uDir, 0, r / shadowH);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  // 3) на экран: тень, затем ковёр
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0); gl.clearDepth(1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.useProgram(compProg.p);
  gl.uniform1i(compProg.u.uTex, 0);
  gl.bindTexture(gl.TEXTURE_2D, fbs[0].tex);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.disable(gl.BLEND);

  gl.useProgram(clothProg.p);
  gl.uniform2f(clothProg.u.uShadow, 0, 0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.bindVertexArray(vao);
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.frontFace(gl.CW);
  gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
  gl.bindVertexArray(null);
}

// ---------- цикл ----------
let last = performance.now(), acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const elapsed = Math.min(0.05, (now - last) / 1000); last = now;
  if (!sleeping) {
    acc += elapsed;
    const steps = Math.min(3, Math.floor(acc / DT));
    acc -= steps * DT;
    let maxv = 0;
    for (let s = 0; s < steps; s++) maxv = Math.max(maxv, step(DT, (s + 1) / steps));
    if (grab >= 0) { prevMX = grabTX; prevMY = grabTY; }
    if (steps) {
      calm = grab < 0 && maxv < 0.015 ? calm + steps : 0;
      if (calm > 90) { sleeping = true; saveState(); }
      project(); updateHover(); needDraw = true;
    }
  }
  if (needDraw) { draw(); needDraw = false; }
}

function wake() { sleeping = false; calm = 0; acc = 0; needDraw = true; }

// ---------- мышь ----------
function onMove(x, y) {
  mouseX = x; mouseY = y;
  if (grab >= 0) { grabTX = x; grabTY = y; wake(); }
  else if (sleeping) updateHover();
}

api.onCursor((p) => { if (grab < 0) onMove(p.x, p.y); });

canvas.addEventListener('pointermove', (e) => onMove(e.clientX, e.clientY));
canvas.addEventListener('pointerdown', (e) => {
  onMove(e.clientX, e.clientY);
  if (e.button !== 0) return;
  project();
  const h = hitTest(e.clientX, e.clientY);
  if (!h) return;
  grab = h.k; inv[grab] = 0; setTethers(grab);
  grabZ = pz[grab]; liftH = Math.max(liftH, grabZ + 30);
  grabTX = prevMX = e.clientX; grabTY = prevMY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
  document.body.classList.add('grab');
  api.drag(true); wake();
});
function release() {
  if (grab < 0) return;
  inv[grab] = 1; grab = -1;
  document.body.classList.remove('grab');
  api.drag(false); wake();
}
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('lostpointercapture', release);
canvas.addEventListener('wheel', (e) => {
  if (grab < 0) return;
  liftH = clamp(liftH - e.deltaY * 0.25, 8, 420); wake();
}, { passive: true });
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  project();
  if (hitTest(e.clientX, e.clientY)) api.menu();
});
canvas.addEventListener('dblclick', (e) => {
  project();
  if (!hitTest(e.clientX, e.clientY)) return;
  shake(0.6);
});

// ---------- убрать ковёр: удерживать Esc ~3 секунды ----------
const ESC_HOLD = 3000;
const escEl = document.getElementById('esc');
let escDown = 0, escRaf = 0, removing = false;
function showEsc(k) {
  if (!escEl) return;
  escEl.style.setProperty('--k', k);
  escEl.style.opacity = k > 0 ? 1 : 0;
  let x = mouseX, y = mouseY;
  if (x < 0) { const p = pose(); x = p.cx; y = p.cy; }
  escEl.style.left = x + 'px'; escEl.style.top = y + 'px';
  if (k >= 1) remove();
}
function remove() {
  if (removing) return;
  removing = true; saveState();
  document.body.classList.add('gone');
  setTimeout(() => api.quit(), 380);
}
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || escDown) return;
  escDown = performance.now();
  const tick = () => {
    if (!escDown) return;
    showEsc(Math.min(1, (performance.now() - escDown) / ESC_HOLD));
    escRaf = requestAnimationFrame(tick);
  };
  tick();
});
addEventListener('keyup', (e) => {
  if (e.key !== 'Escape') return;
  escDown = 0; cancelAnimationFrame(escRaf); showEsc(0);
});
addEventListener('blur', () => { if (escDown) { escDown = 0; showEsc(0); } });
api.onEsc((k) => { if (!escDown) showEsc(k); });

// ---------- команды ----------
function flatten() { release(); const p = pose(); layFlat(p.cx, p.cy, p.ang, 45); }
function shake(power = 1) { // волна по ковру от ближнего края
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const k = idx(i, j);
    const up = (Math.sin(j / (NY - 1) * Math.PI * 3) * 0.5 + 0.7) * 9 * power * (0.6 + 0.4 * Math.random());
    oz[k] = pz[k] - Math.max(0, up);
  }
  wake();
}
function crumple() {
  const p = pose();
  for (let k = 0; k < N; k++) {
    ox[k] = px[k] - (p.cx - px[k]) * 0.035 + (Math.random() - 0.5) * 2;
    oy[k] = py[k] - (p.cy - py[k]) * 0.06 + (Math.random() - 0.5) * 2;
    oz[k] = pz[k] - (2 + Math.random() * 8);
  }
  wake();
}

api.onCommand((cmd, arg) => {
  if (cmd === 'flatten') flatten();
  else if (cmd === 'shake') shake();
  else if (cmd === 'crumple') crumple();
  else if (cmd === 'remove') remove();
  else if (cmd === 'reset') { release(); setSize(sizeName, false); }
  else if (cmd === 'size') { sizeName = arg; release(); setSize(arg, true); }
});

function saveState() {
  const pos = new Array(N * 3);
  for (let k = 0; k < N; k++) {
    pos[k * 3] = Math.round(px[k] * 10) / 10; pos[k * 3 + 1] = Math.round(py[k] * 10) / 10; pos[k * 3 + 2] = Math.round(pz[k] * 10) / 10;
  }
  api.saveState({ v: 1, NX, NY, size: sizeName, W, H, pos });
}

// ---------- старт ----------
let sizeName = 'medium';
buildConstraints();
addEventListener('resize', resize);
resize();

api.init().then(({ settings, state }) => {
  sizeName = settings.size in SIZES ? settings.size : 'medium';
  width = SIZES[sizeName]; setRest();
  const ok = state && state.v === 1 && state.NX === NX && state.NY === NY && state.size === sizeName &&
    Array.isArray(state.pos) && state.pos.length === N * 3;
  if (ok) {
    for (let k = 0; k < N; k++) {
      px[k] = ox[k] = clamp(state.pos[k * 3], 0, W);
      py[k] = oy[k] = clamp(state.pos[k * 3 + 1], 0, H);
      pz[k] = oz[k] = state.pos[k * 3 + 2];
    }
    for (let k = 0; k < N; k++) pz[k] = oz[k] = pz[k] + 25; // лёгкое «приземление» при запуске
    wake();
  } else setSize(sizeName, false);
  if (new URLSearchParams(location.search).has('demo')) window.__kovyor = { step, project, hitTest, shake, crumple, flatten, px, py, pz, inv, idx, NX, NY };
  requestAnimationFrame(frame);
});
