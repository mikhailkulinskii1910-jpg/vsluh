'use strict';
// Физика: ткань на частицах (Verlet + позиционные ограничения), рабочий стол — пол z = 0,
// ось z смотрит на зрителя. Рисование: WebGL2, перспектива сверху, размытая тень.

const api = window.desk || { // заглушка, чтобы страницу можно было открыть в браузере
  init: async () => ({ settings: { size: 'medium' }, state: null }),
  hover() {}, drag() {}, menu() {}, saveState() {}, onCursor() {}, onCommand() {}, onEsc() {}, quit() {},
};

// ---------- параметры ----------
const NX = 30, NY = 46, N = NX * NY;
const SIZES = { small: 220, medium: 320, large: 440 }; // старые настройки размера
// форма ковра: отношение высоты к ширине (null — как у картинки)
const SHAPE_ASPECT = { rect: null, square: 1, circle: 1, oval: null, triangle: 0.866, hexagon: 0.866, diamond: 1.4 };
const SHAPE_ID = { rect: 0, square: 0, circle: 1, oval: 1, triangle: 2, hexagon: 3, diamond: 4 };
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
let shape = 'rect', opacity = 1, imgAspect = 1093 / 713, imageKey = '';
let spX = 1, spY = 1, carpetH = 1, nxUsed = NX, nyUsed = NY;  // шаг сетки по ширине и по длине, длина ковра
const px = new Float32Array(N), py = new Float32Array(N), pz = new Float32Array(N);
const ox = new Float32Array(N), oy = new Float32Array(N), oz = new Float32Array(N);
const inv = new Float32Array(N).fill(1);
const act = new Uint8Array(N).fill(1);                                  // частица внутри формы
const restX = new Float32Array(N), restY = new Float32Array(N);         // плоская раскладка от центра
const gridData = new Float32Array(N * 2);                               // место частицы на ковре, 0..1
const sx = new Float32Array(N), sy = new Float32Array(N); // экранные координаты
let cA, cB, cRest, cK, cCount = 0;

let grab = -1, grabTX = 0, grabTY = 0, grabZ = 0, liftH = 70;
let mouseX = -1, mouseY = -1, prevMX = -1, prevMY = -1;
let overCarpet = false, sleeping = false, calm = 0, needDraw = true;

const idx = (i, j) => j * NX + i;

function buildConstraints() {
  const list = [];
  const add = (a, b, k) => { if (act[a] && act[b]) list.push(a, b, k); };
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
  for (let c = 0; c < cCount; c++) {
    const a = cA[c], b = cB[c];
    cRest[c] = Math.hypot(restX[a] - restX[b], restY[a] - restY[b]);
  }
}

// ---------- форма ----------
// расстояние до границы формы (отрицательное — внутри); x, y от центра, w × h — габарит
function shapeDist(id, x, y, w, h) {
  const ax = Math.abs(x), ay = Math.abs(y), hw = w / 2, hh = h / 2;
  if (id === 1) { const k = Math.hypot(x / hw, y / hh); return (k - 1) * Math.min(hw, hh); }
  if (id === 2) { // треугольник вершиной вверх
    const s = hw / h, edge = (ax - (y + hh) * s) / Math.hypot(1, s);
    return Math.max(edge, y - hh, -hh - y);
  }
  if (id === 3) return Math.max(ay - hh, (Math.sqrt(3) * ax + ay - Math.sqrt(3) * hw) / 2); // шестиугольник
  if (id === 4) return (ax * hh + ay * hw - hw * hh) / Math.hypot(hw, hh);                  // ромб
  return Math.max(ax - hw, ay - hh);
}

// пересобрать сетку под форму и размер: раскладка, маска, связи, треугольники
function rebuildGeometry() {
  const asp = SHAPE_ASPECT[shape] || (shape === 'oval' && Math.abs(imgAspect - 1) < 0.1 ? 1.35 : imgAspect);
  carpetH = width * asp;
  // ячейки сетки почти квадратные: лишние ряды или столбцы просто не участвуют
  // (на вытянутых ячейках столкновения слоёв теряют устойчивость)
  const sp = Math.max(width / (NX - 1), carpetH / (NY - 1));
  nxUsed = Math.min(NX, Math.round(width / sp) + 1); nyUsed = Math.min(NY, Math.round(carpetH / sp) + 1);
  spX = width / (nxUsed - 1); spY = carpetH / (nyUsed - 1);
  spacing = Math.sqrt(spX * spY);
  const id = SHAPE_ID[shape] || 0, margin = Math.hypot(spX, spY) * 1.02;
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const k = idx(i, j), inGrid = i < nxUsed && j < nyUsed;
    restX[k] = Math.min(i, nxUsed - 1) * spX - width / 2; restY[k] = Math.min(j, nyUsed - 1) * spY - carpetH / 2;
    gridData[k * 2] = Math.min(1, i / (nxUsed - 1)); gridData[k * 2 + 1] = Math.min(1, j / (nyUsed - 1));
    act[k] = inGrid && shapeDist(id, restX[k], restY[k], width, carpetH) <= margin ? 1 : 0;
    inv[k] = act[k];
  }
  buildConstraints(); setRest(); buildTopology(); buildUV();
}

// уложить ковёр плоско: центр, угол, высота, наклон (для эффектного падения)
function layFlat(cx, cy, ang, z0, tilt = 0) {
  const ca = Math.cos(ang), sa = Math.sin(ang);
  for (let k = 0; k < N; k++) {
    const lx = restX[k], ly = restY[k];
    px[k] = ox[k] = cx + lx * ca - ly * sa;
    py[k] = oy[k] = cy + lx * sa + ly * ca;
    pz[k] = oz[k] = Math.max(0, z0 + ly * tilt + Math.random() * 0.4);
  }
  wake();
}

function pose() { // текущие центр и угол ковра
  let cx = 0, cy = 0, n = 0, dx = 0, dy = 0;
  for (let k = 0; k < N; k++) if (act[k]) { cx += px[k]; cy += py[k]; n++; }
  cx /= n; cy /= n;
  for (let k = 0; k < N; k++) if (act[k]) { dx += restX[k] * (px[k] - cx); dy += restX[k] * (py[k] - cy); }
  return { cx, cy, ang: Math.atan2(dy, dx) };
}

function setSize(keepPose) {
  const p = keepPose ? pose() : { cx: W / 2, cy: H / 2, ang: -0.12 };
  rebuildGeometry();
  const h = carpetH;
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
    if (!act[k]) continue;
    const c = (((py[k] * inv_r) | 0) + 1) * gridCols + ((px[k] * inv_r) | 0) + 1;
    gNext[k] = gHead[c]; gHead[c] = k;
  }
  for (let a = 0; a < N; a++) {
    if (!act[a]) continue;
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
let triCount = 0, sCount = 0;
const MAXE = TRI * 40;
const eTri = new Int32Array(MAXE), eNext = new Int32Array(MAXE);
// объёмная хеш-сетка: слои, лежащие друг на друге, попадают в разные ячейки по высоте,
// поэтому скомканный ковёр не проверяет каждую точку против всех слоёв сразу
const HBITS = 15, HMASK = (1 << HBITS) - 1, tHead = new Int32Array(1 << HBITS);
const tVisit = new Int32Array(TRI);
const cellKey = (x, y, z) => ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) & HMASK;

const wOf = (k) => pz[k] < 0.5 ? inv[k] * 0.15 : inv[k]; // лежащее на столе почти не продавить вниз

// пробные точки: сами частицы и середины рёбер (горизонталь, вертикаль, диагональ ячейки) —
// по серединам ловятся рёбра, проходящие сквозь чужую ткань на сгибах
const S = N * 4, sA = new Int32Array(S), sB = new Int32Array(S);

function buildTopology() {
  let t = 0, q = 0;
  for (let j = 0; j < NY - 1; j++) for (let i = 0; i < NX - 1; i++) {
    const a = idx(i, j), b = a + 1, c = a + NX, d = c + 1;
    if (act[a] && act[b] && act[c]) { triV[t * 3] = a; triV[t * 3 + 1] = b; triV[t * 3 + 2] = c; triI[t] = i; triJ[t] = j; t++; }
    if (act[b] && act[d] && act[c]) { triV[t * 3] = b; triV[t * 3 + 1] = d; triV[t * 3 + 2] = c; triI[t] = i; triJ[t] = j; t++; }
  }
  triCount = t;
  const addS = (a, b) => { if (act[a] && (b < 0 || act[b])) { sA[q] = a; sB[q] = b; q++; } };
  for (let k = 0; k < N; k++) addS(k, -1);
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const a = idx(i, j);
    if (i + 1 < NX) addS(a, a + 1);
    if (j + 1 < NY) addS(a, a + NX);
    if (i + 1 < NX && j + 1 < NY) addS(a + 1, a + NX);
  }
  sCount = q;
  if (typeof uploadIndices === 'function') uploadIndices();
}
// всё, что зависит только от треугольника, считаем один раз за проход
const tN = new Float64Array(TRI * 3), tO = new Float64Array(TRI * 4), tB = new Float64Array(TRI * 4), tZ = new Float64Array(TRI * 2);
const tOk = new Uint8Array(TRI);
// толчки копятся и применяются усреднённо (метод Якоби) — так много одновременных касаний не раскачивают ткань
const cX = new Float64Array(N), cY = new Float64Array(N), cZ = new Float64Array(N), cW = new Float64Array(N);
const bX = new Float32Array(N), bY = new Float32Array(N), bZ = new Float32Array(N);
const push = (k, x, y, z, w) => { cX[k] += x; cY[k] += y; cZ[k] += z; cW[k] += w; };

function triCollide() {
  const h = spacing * 0.6, C = spacing * 1.0, iC = 1 / C;
  tHead.fill(-1); tVisit.fill(-1);
  cX.fill(0); cY.fill(0); cZ.fill(0); cW.fill(0);
  let ne = 0, hits = 0;
  for (let t = 0; t < triCount; t++) {
    const a = triV[t * 3], b = triV[t * 3 + 1], c = triV[t * 3 + 2];
    const x0 = Math.floor((Math.min(px[a], px[b], px[c], ox[a], ox[b], ox[c]) - h) * iC);
    const x1 = Math.floor((Math.max(px[a], px[b], px[c], ox[a], ox[b], ox[c]) + h) * iC);
    const y0 = Math.floor((Math.min(py[a], py[b], py[c], oy[a], oy[b], oy[c]) - h) * iC);
    const y1 = Math.floor((Math.max(py[a], py[b], py[c], oy[a], oy[b], oy[c]) + h) * iC);
    const z0 = Math.floor((Math.min(pz[a], pz[b], pz[c], oz[a], oz[b], oz[c]) - h) * iC);
    const z1 = Math.floor((Math.max(pz[a], pz[b], pz[c], oz[a], oz[b], oz[c]) + h) * iC);
    tOk[t] = 0;
    if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > 96) continue; // разорванный треугольник — не ловим
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
    for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (ne >= MAXE) break;
      const cell = cellKey(x, y, z);
      eTri[ne] = t; eNext[ne] = tHead[cell]; tHead[cell] = ne++;
    }
  }
  for (let q = 0; q < sCount; q++) {
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
    // по высоте смотрим все ячейки, через которые точка прошла за шаг — иначе быстрый провал сквозь слой не поймать
    const gx = Math.floor(qx * iC), gy = Math.floor(qy * iC);
    const zq0 = Math.floor(Math.min(qz, qoz) * iC), zq1 = Math.floor(Math.max(qz, qoz) * iC);
    for (let gz = zq0; gz <= zq1; gz++) {
    const cell = cellKey(gx, gy, gz);
    const motion = Math.abs(qz - qoz) + Math.abs(qx - qox) + Math.abs(qy - qoy);
    const m = h + motion + 1;
    for (let e = tHead[cell]; e !== -1; e = eNext[e]) {
      const t = eTri[e], ti = triI[t], tj = triJ[t];
      if (tVisit[t] === q) continue; // треугольник мог попасть в ячейку дважды (совпадение хеша)
      tVisit[t] = q;
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
      if (pen > h * 0.05) hits++;
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
  }
  // применяем усреднённые толчки
  for (let k = 0; k < N; k++) {
    if (cW[k] === 0) continue;
    const f = 1.2 / Math.max(1, cW[k]);
    px[k] += cX[k] * f; py[k] += cY[k] * f; pz[k] += cZ[k] * f;
  }
  return hits;
}

// ---------- ограничение растяжения от точки захвата ----------
// Ни одна точка ковра не может оказаться дальше от схваченной, чем позволяет сама ткань.
const lraRest = new Float32Array(N);
function setTethers(g) {
  for (let k = 0; k < N; k++) lraRest[k] = Math.hypot(restX[k] - restX[g], restY[k] - restY[g]) * 1.03;
}
function tethers() {
  if (grab < 0) return;
  const gx = px[grab], gy = py[grab], gz = pz[grab];
  for (let k = 0; k < N; k++) {
    if (inv[k] === 0) continue;
    const ex = px[k] - gx, ey = py[k] - gy, ez = pz[k] - gz;
    const d = Math.sqrt(ex * ex + ey * ey + ez * ez);
    if (d <= lraRest[k]) continue;
    const s = (d - lraRest[k]) / d * 0.35; // мягко: уступает столкновениям, иначе протащит ткань сквозь слой
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
const sX = new Float32Array(N), sY = new Float32Array(N), sZ = new Float32Array(N);
let settle = 0;   // сколько шагов ковёр почти неподвижен: затухание растёт, пока он не замрёт
function step(dt, t) {
  const g = GRAVITY * dt * dt;
  sX.set(px); sY.set(py); sZ.set(pz);
  const damp = grab >= 0 ? DAMP : DAMP * (1 - Math.min(0.6, settle / 200));
  for (let k = 0; k < N; k++) {
    if (inv[k] === 0) continue;
    let vx = (px[k] - ox[k]) * damp, vy = (py[k] - oy[k]) * damp, vz = (pz[k] - oz[k]) * damp;
    const v = Math.hypot(vx, vy, vz);
    // не быстрее полклетки за шаг: так ни одна точка не проскочит сквозь слой между проверками
    const vmax = spacing * 0.5;
    if (v > vmax) { vx *= vmax / v; vy *= vmax / v; vz *= vmax / v; }
    ox[k] = px[k]; oy[k] = py[k]; oz[k] = pz[k];
    px[k] += vx; py[k] += vy; pz[k] += vz + g;
  }

  if (crumpleT > 0) crumpleStep(dt);

  if (grab >= 0) { // захваченная точка ведётся курсором (интерполяция между кадрами)
    grabZ += (liftH - grabZ) * Math.min(1, dt * 9);
    const mx = prevMX + (grabTX - prevMX) * t, my = prevMY + (grabTY - prevMY) * t;
    const s = (CAM - grabZ) / CAM;
    ox[grab] = px[grab]; oy[grab] = py[grab]; oz[grab] = pz[grab];
    // тяжёлый ковёр не успевает за резким рывком мыши: точка захвата догоняет курсор
    const tx = clamp(W / 2 + (mx - W / 2) * s, 0, W), ty = clamp(H / 2 + (my - H / 2) * s, 0, H);
    const dx = tx - px[grab], dy = ty - py[grab], dl = Math.hypot(dx, dy), lim = spacing * 0.33;
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
    let cx = 0, cy = 0, n = 0;
    for (let k = 0; k < N; k++) if (act[k]) { cx += px[k]; cy += py[k]; n++; }
    cx /= n; cy /= n;
    const mx = Math.min(width * 0.3, W / 2), my = Math.min(carpetH * 0.3, H / 2);
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
  // до двух проходов, пока слои ещё давят друг на друга (ровный ковёр — один проход)
  for (let pass = 0; pass < 2; pass++) if (!triCollide()) break;
  // касание без отскока: толчок от столкновений почти не превращается в скорость
  for (let k = 0; k < N; k++) {
    const cx = px[k] - bX[k], cy = py[k] - bY[k], cz = pz[k] - bZ[k];
    ox[k] += cx * 0.7; oy[k] += cy * 0.7; oz[k] += cz * 0.7;
    // слои, которые давят друг на друга, цепляются ворсом: дрожь между ними быстро гаснет
    if (cx * cx + cy * cy + cz * cz > 1e-6) {
      const vx = px[k] - ox[k], vy = py[k] - oy[k], vz = pz[k] - oz[k];
      if (vx * vx + vy * vy + vz * vz < 0.09) { ox[k] = px[k]; oy[k] = py[k]; oz[k] = pz[k]; } // трение покоя
      else { ox[k] += vx * 0.3; oy[k] += vy * 0.3; oz[k] += vz * 0.3; }
    }
  }
  bounds();
  // «покой» меряем по настоящему смещению за шаг: почти всё стоит, отдельные точки чуть ползут
  let sum = 0, n = 0;
  for (let k = 0; k < N; k++) {
    if (!act[k]) continue;
    const v = Math.abs(px[k] - sX[k]) + Math.abs(py[k] - sY[k]) + Math.abs(pz[k] - sZ[k]);
    if (v > maxv) maxv = v;
    sum += v; n++;
  }
  const avg = sum / n;
  settle = grab < 0 && avg < 0.08 ? settle + 1 : 0;
  // уже 2 с почти неподвижен — замирает, даже если где-то в складке подрагивает одна точка
  return grab < 0 && ((maxv < 0.5 && avg < 0.01) || settle > 240) ? 0 : maxv;
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
  for (let t = 0; t < triCount; t++) {
    const p = triV[t * 3], q = triV[t * 3 + 1], r = triV[t * 3 + 2];
    if (x < Math.min(sx[p], sx[q], sx[r]) || x > Math.max(sx[p], sx[q], sx[r])) continue;
    if (y < Math.min(sy[p], sy[q], sy[r]) || y > Math.max(sy[p], sy[q], sy[r])) continue;
    {
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
  gl.bindAttribLocation(p, 3, 'aGrid');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  for (let i = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i--;) {
    const n = gl.getActiveUniform(p, i).name; u[n] = gl.getUniformLocation(p, n);
  }
  return { p, u };
}

const CLOTH_VS = `#version 300 es
in vec3 aPos; in vec3 aNrm; in vec2 aUV; in vec2 aGrid;
uniform vec2 uView; uniform float uCam; uniform vec2 uShadow;
out vec2 vUV; out vec3 vN; out float vZ; out vec2 vGrid;
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
  vUV = aUV; vN = aNrm; vZ = aPos.z; vGrid = aGrid;
}`;

const CLOTH_FS = `#version 300 es
precision highp float;
in vec2 vUV; in vec3 vN; in float vZ; in vec2 vGrid;
uniform sampler2D uTex; uniform vec3 uLight; uniform vec2 uShadow;
uniform int uShape; uniform vec2 uDim; uniform float uAlpha; uniform float uFront;
out vec4 o;
// расстояние до края формы (как shapeDist в JS); vGrid — координаты на ковре 0..1
float shapeDist(vec2 g) {
  vec2 p = (g - 0.5) * uDim, a = abs(p), hd = uDim * 0.5;
  if (uShape == 1) return (length(p / hd) - 1.0) * min(hd.x, hd.y);
  if (uShape == 2) { float s = hd.x / uDim.y; return max((a.x - (p.y + hd.y) * s) / sqrt(1.0 + s * s), abs(p.y) - hd.y); }
  if (uShape == 3) return max(a.y - hd.y, (1.7320508 * a.x + a.y - 1.7320508 * hd.x) * 0.5);
  if (uShape == 4) return (a.x * hd.y + a.y * hd.x - hd.x * hd.y) / length(hd);
  return max(a.x - hd.x, a.y - hd.y);
}
void main() {
  if (shapeDist(vGrid) > 0.0) discard;
  vec4 t = texture(uTex, vUV);
  if (t.a < 0.5) discard;
  if (uShadow.x > 0.0) { o = vec4(clamp(1.0 - vZ / 450.0, 0.35, 1.0)); return; }
  vec3 n = normalize(vN);
  vec3 col = t.rgb;
  if (!gl_FrontFacing) {           // изнанка: тот же узор, но блёклый и светлее
    n = -n;
    float l = dot(col, vec3(0.3, 0.59, 0.11));
    col = mix(mix(vec3(l), vec3(0.42, 0.40, 0.37), 0.5) * 0.85 + 0.06, col, uFront);
  }
  float diff = max(dot(n, uLight), 0.0) / uLight.z;
  vec3 h = normalize(uLight + vec3(0.0, 0.0, 1.0));
  float sheen = pow(max(dot(n, h), 0.0), 18.0);
  float rim = pow(1.0 - max(n.z, 0.0), 2.0);   // складки темнее в глубине
  vec3 c = col * (0.22 + 0.78 * diff) * (1.0 - 0.35 * rim) + vec3(0.06) * sheen * (1.0 - rim);
  o = vec4(c * uAlpha, uAlpha);
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
in vec2 vUV; uniform sampler2D uTex; uniform float uAlpha; out vec4 o;
void main() { float a = texture(uTex, vUV).r * 0.7 * uAlpha; o = vec4(0.0, 0.0, 0.0, a); }`;

const clothProg = program(CLOTH_VS, CLOTH_FS);
const blurProg = program(QUAD_VS, BLUR_FS);
const compProg = program(QUAD_VS, COMP_FS);

const posData = new Float32Array(N * 3), nrmData = new Float32Array(N * 3), uvData = new Float32Array(N * 2);
const indices = new Uint16Array(TRI * 3);
let idxCount = 0;

const vao = gl.createVertexArray();
gl.bindVertexArray(vao);
const posBuf = gl.createBuffer(), nrmBuf = gl.createBuffer(), uvBuf = gl.createBuffer(), idxBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, posBuf); gl.bufferData(gl.ARRAY_BUFFER, posData, gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
gl.bindBuffer(gl.ARRAY_BUFFER, nrmBuf); gl.bufferData(gl.ARRAY_BUFFER, nrmData, gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf); gl.bufferData(gl.ARRAY_BUFFER, uvData, gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
const gridBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, gridBuf); gl.bufferData(gl.ARRAY_BUFFER, gridData, gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, 0, 0);
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.DYNAMIC_DRAW);

function uploadIndices() {
  for (let t = 0; t < triCount * 3; t++) indices[t] = triV[t];
  idxCount = triCount * 3;
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
  gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, indices.subarray(0, idxCount));
  gl.bindVertexArray(null);
  needDraw = true;
}

// картинка ложится на форму «с обрезкой», без растягивания
function buildUV() {
  const g = carpetH / width;
  let u0 = 0, ur = 1, v0 = 0, vr = 1;
  if (g > imgAspect) { ur = imgAspect / g; u0 = (1 - ur) / 2; } else { vr = g / imgAspect; v0 = (1 - vr) / 2; }
  const inset = imageKey ? 0 : 0.004; // у стандартного ковра по краю бахрома
  for (let k = 0; k < N; k++) {
    uvData[k * 2] = u0 + ur * (inset + (1 - 2 * inset) * gridData[k * 2]);
    uvData[k * 2 + 1] = v0 + vr * (inset + (1 - 2 * inset) * gridData[k * 2 + 1]);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, uvData);
  gl.bindBuffer(gl.ARRAY_BUFFER, gridBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, gridData);
  needDraw = true;
}

const quadVao = gl.createVertexArray();
gl.bindVertexArray(quadVao);
const quadBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
gl.bindVertexArray(null);

const tex = gl.createTexture();
let texReady = false;
// загрузить картинку ковра; onAspect — если у новой картинки другие пропорции
function loadImage(url, onDone) {
  const img = new Image();
  img.onload = () => {
  imgAspect = img.height / img.width;
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
  onDone && onDone(true);
  };
  img.onerror = () => onDone && onDone(false);
  img.src = url;
}

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
  for (let t = 0; t < triCount; t++) faceNormal(triV[t * 3], triV[t * 3 + 1], triV[t * 3 + 2]);
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
  gl.uniform1i(clothProg.u.uShape, SHAPE_ID[shape] || 0);
  gl.uniform2f(clothProg.u.uDim, width, carpetH);
  gl.uniform1f(clothProg.u.uAlpha, opacity);
  gl.uniform1f(clothProg.u.uFront, frontK);
  gl.drawElements(gl.TRIANGLES, idxCount, gl.UNSIGNED_SHORT, 0);
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
  gl.uniform1f(compProg.u.uAlpha, Math.min(1, 0.25 + opacity * 0.75));
  gl.bindTexture(gl.TEXTURE_2D, fbs[0].tex);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.disable(gl.BLEND);

  gl.useProgram(clothProg.p);
  gl.uniform2f(clothProg.u.uShadow, 0, 0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.bindVertexArray(vao);
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.frontFace(gl.CW);
  if (opacity < 1) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); }
  gl.drawElements(gl.TRIANGLES, idxCount, gl.UNSIGNED_SHORT, 0);
  gl.disable(gl.BLEND);
  gl.bindVertexArray(null);
}

// ---------- рулон ----------
// Ковёр скатывается от нижнего края к верхнему по спирали (ворсом внутрь, изнанкой наружу,
// как настоящий), а потом живёт как твёрдое тело: цилиндр катится поперёк оси и тяжело
// скользит вдоль неё.
let mode = 'cloth';                 // cloth | rolling | roll | unrolling
let anim = null;                    // { t, dur, from: Float32Array, frame: {cx, cy, ang}, dir }
const body = { x: 0, y: 0, psi: 0, sigma: 0, vx: 0, vy: 0, w: 0, R: 20 };
const rollU = new Float32Array(N), rollC = new Float32Array(N), rollS = new Float32Array(N);
let bodyGrab = null;                // { u } — где схватили рулон (вдоль оси)
const ROLL_DUR = 1.4;

function spiral() {
  const r0 = Math.max(5, spacing * 0.5), t = Math.max(3, spacing * 0.42);
  const th = (L) => (-r0 + Math.sqrt(r0 * r0 + t * L / Math.PI)) / (t / (2 * Math.PI));
  return { r0, t, th };
}

// раскладка ковра, скатанного на долю p, в рамке (cx, cy, ang); пишет в tx/ty/tz
const tx = new Float32Array(N), ty = new Float32Array(N), tz = new Float32Array(N);
function rollTarget(fr, p) {
  const { r0, t, th } = spiral();
  const Lr = p * carpetH, thMax = th(Lr), R = r0 + t * thMax / (2 * Math.PI);
  const ca = Math.cos(fr.ang), sa = Math.sin(fr.ang);
  for (let k = 0; k < N; k++) {
    const L = carpetH / 2 - restY[k];          // 0 у нижнего края, откуда начинаем катать
    let a, z;
    if (L <= Lr && p > 0) {
      const tk = th(L), r = r0 + t * tk / (2 * Math.PI), phi = -Math.PI / 2 - (thMax - tk);
      a = Lr + r * Math.cos(phi); z = R + r * Math.sin(phi);
    } else { a = L; z = 0; }
    const lx = restX[k], ly = carpetH / 2 - a;
    tx[k] = fr.cx + lx * ca - ly * sa; ty[k] = fr.cy + lx * sa + ly * ca; tz[k] = Math.max(0, z);
  }
  return R;
}
const ease = (x) => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;

function startRoll() {
  if (mode !== 'cloth') return;
  release();
  const fr = pose();
  // рулон не должен уехать за край: катим к верхнему краю, если он ближе к центру экрана
  anim = { t: 0, dur: ROLL_DUR, from: Float32Array.from([...px, ...py, ...pz]), frame: fr };
  mode = 'rolling'; inv.fill(0); wake();
}

function finishRoll() {
  const fr = anim.frame, R = rollTarget(fr, 1);
  const ca = Math.cos(fr.ang), sa = Math.sin(fr.ang);
  // центр оси рулона: на оси симметрии ковра, у бывшего верхнего края
  const { r0, t, th } = spiral(), Lr = carpetH;
  const ly = carpetH / 2 - Lr;
  body.x = fr.cx - ly * sa; body.y = fr.cy + ly * ca; body.psi = fr.ang; body.sigma = 0;
  body.vx = body.vy = body.w = 0; body.R = R;
  for (let k = 0; k < N; k++) {
    const L = carpetH / 2 - restY[k], tk = th(Math.min(L, Lr)), r = r0 + t * tk / (2 * Math.PI);
    const phi = -Math.PI / 2 - (th(Lr) - tk);
    rollU[k] = restX[k]; rollC[k] = r * Math.cos(phi); rollS[k] = r * Math.sin(phi);
  }
  mode = 'roll'; anim = null; frontK = 1; placeBody();
}

// поставить частицы по положению твёрдого рулона
function placeBody() {
  const cp = Math.cos(body.psi), sp = Math.sin(body.psi);
  const ax = sp, ay = -cp;                         // направление качения (поперёк оси)
  const cs = Math.cos(body.sigma), ss = Math.sin(body.sigma);
  for (let k = 0; k < N; k++) {
    const c = rollC[k] * cs - rollS[k] * ss, z = rollC[k] * ss + rollS[k] * cs;
    px[k] = ox[k] = body.x + cp * rollU[k] + ax * c;
    py[k] = oy[k] = body.y + sp * rollU[k] + ay * c;
    pz[k] = oz[k] = Math.max(0, body.R + z);
  }
}

function startUnroll() {
  if (mode !== 'roll') return;
  bodyGrab = null; api.drag(false);
  const cp = Math.cos(body.psi), sp = Math.sin(body.psi), ax = sp, ay = -cp;
  // ковёр раскатывается назад, туда, откуда катили; если не влезает — сдвигаем всю раскладку
  let cx = body.x - ax * carpetH / 2, cy = body.y - ay * carpetH / 2;
  const rx = Math.abs(cp) * width / 2 + Math.abs(ax) * carpetH / 2, ry = Math.abs(sp) * width / 2 + Math.abs(ay) * carpetH / 2;
  cx = clamp(cx, Math.min(rx, W / 2), Math.max(W - rx, W / 2)); cy = clamp(cy, Math.min(ry, H / 2), Math.max(H - ry, H / 2));
  anim = { t: 0, dur: ROLL_DUR, from: Float32Array.from([...px, ...py, ...pz]), frame: { cx, cy, ang: body.psi } };
  mode = 'unrolling'; wake();
}

function animStep(dt) {
  anim.t += dt;
  const k = Math.min(1, anim.t / anim.dur), e = ease(k);
  const p = mode === 'rolling' ? e : 1 - e;
  rollTarget(anim.frame, p);
  const blend = ease(Math.min(1, anim.t / 0.35));  // плавно выходим из любой позы
  frontK = p;
  const f = anim.from;
  for (let q = 0; q < N; q++) {
    px[q] = ox[q] = f[q] + (tx[q] - f[q]) * blend;
    py[q] = oy[q] = f[N + q] + (ty[q] - f[N + q]) * blend;
    pz[q] = oz[q] = f[2 * N + q] + (tz[q] - f[2 * N + q]) * blend;
  }
  if (k < 1) return;
  if (mode === 'rolling') finishRoll();
  else { mode = 'cloth'; anim = null; frontK = 0; for (let q = 0; q < N; q++) inv[q] = act[q]; saveState(); }
}

// твёрдый рулон: пружина от курсора, качение поперёк оси, трение вдоль
function bodyStep(dt) {
  const cp = Math.cos(body.psi), sp = Math.sin(body.psi), ax = sp, ay = -cp;
  const m = 1, I = m * width * width / 12;
  let fx = 0, fy = 0, tq = 0;
  if (bodyGrab) {
    const gx = body.x + cp * bodyGrab.u, gy = body.y + sp * bodyGrab.u;
    const vgx = body.vx - body.w * sp * bodyGrab.u, vgy = body.vy + body.w * cp * bodyGrab.u;
    fx = 90 * (mouseX - gx) - 14 * vgx; fy = 90 * (mouseY - gy) - 14 * vgy;
    tq = bodyGrab.u * (cp * fy - sp * fx);
  }
  body.vx += fx / m * dt; body.vy += fy / m * dt; body.w += tq / I * dt;
  // трение: вдоль оси рулон скользит тяжело, поперёк — катится почти свободно
  const va = body.vx * cp + body.vy * sp, vr = body.vx * ax + body.vy * ay;
  const fric = (v, dec) => Math.sign(v) * Math.max(0, Math.abs(v) - dec * dt);
  const na = fric(va, 1800), nr = fric(vr, 160);
  body.vx = cp * na + ax * nr; body.vy = sp * na + ay * nr;
  body.w = fric(body.w, 9) * (1 - Math.min(1, 3 * dt));
  body.x += body.vx * dt; body.y += body.vy * dt; body.psi += body.w * dt;
  body.sigma -= (body.vx * ax + body.vy * ay) * dt / body.R;
  // края экрана: торцы и бока рулона отскакивают
  const ex = Math.abs(cp) * width / 2 + body.R, ey = Math.abs(sp) * width / 2 + body.R;
  if (body.x < ex) { body.x = ex; body.vx = Math.abs(body.vx) * 0.35; }
  if (body.x > W - ex) { body.x = W - ex; body.vx = -Math.abs(body.vx) * 0.35; }
  if (body.y < ey) { body.y = ey; body.vy = Math.abs(body.vy) * 0.35; }
  if (body.y > H - ey) { body.y = H - ey; body.vy = -Math.abs(body.vy) * 0.35; }
  placeBody();
  return bodyGrab ? 1 : Math.abs(body.vx) + Math.abs(body.vy) + Math.abs(body.w) * width;
}

function toggleRoll() { if (mode === 'cloth') startRoll(); else if (mode === 'roll') startUnroll(); }

// ---------- шар, куб, пластина ----------
// Ковёр «перетекает» в твёрдое тело того же объёма (ткань ~5 px толщиной) и дальше живёт как
// одно целое: шар катается во все стороны, куб и пластина тяжело скользят и поворачиваются.
let foldKind = 'roll';               // roll | ball | cube | plate
const solid = { kind: 'ball', x: 0, y: 0, zc: 0, M: [1, 0, 0, 0, 1, 0, 0, 0, 1], vx: 0, vy: 0, w: 0, R: 30, rb: 30 };
const sLx = new Float32Array(N), sLy = new Float32Array(N), sLz = new Float32Array(N);
const MORPH_DUR = 1.1;

function solidLocal(kind) {
  let n = 0;
  for (let k = 0; k < N; k++) n += act[k];
  const area = n * spX * spY, vol = area * 5;
  let zc = 0, rb = 0, R = 0;
  if (kind === 'plate') {
    const sc = 0.38; zc = 5;
    for (let k = 0; k < N; k++) { sLx[k] = restX[k] * sc; sLy[k] = restY[k] * sc; sLz[k] = 0; }
  } else {
    R = kind === 'ball' ? Math.cbrt(3 * vol / (4 * Math.PI)) : Math.cbrt(vol) / 2;
    zc = R;
    for (let k = 0; k < N; k++) {
      // сетка ковра натягивается на тело: середина ковра — сверху, края сходятся снизу
      const lon = (gridData[k * 2] - 0.5) * 2 * Math.PI * 0.985, lat = (gridData[k * 2 + 1] - 0.5) * Math.PI * 0.97;
      let dx = Math.sin(lon) * Math.cos(lat), dy = Math.sin(lat), dz = Math.cos(lon) * Math.cos(lat);
      if (kind === 'cube') { const m = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)); dx /= m; dy /= m; dz /= m; }
      sLx[k] = dx * R; sLy[k] = dy * R; sLz[k] = dz * R;
    }
  }
  for (let k = 0; k < N; k++) if (act[k]) rb = Math.max(rb, Math.hypot(sLx[k], sLy[k]));
  solid.kind = kind; solid.zc = zc; solid.R = R || rb; solid.rb = rb;
}

const rotZ = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
function mul3(A, B) {
  const C = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
  return C;
}
function axisAngle(x, y, z, a) {
  const c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
}
function orthonormalize(M) { // против накопления ошибок поворота
  let [ax, ay, az] = [M[0], M[3], M[6]], l = Math.hypot(ax, ay, az); ax /= l; ay /= l; az /= l;
  let [bx, by, bz] = [M[1], M[4], M[7]]; const d = ax * bx + ay * by + az * bz;
  bx -= d * ax; by -= d * ay; bz -= d * az; l = Math.hypot(bx, by, bz); bx /= l; by /= l; bz /= l;
  const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
  M[0] = ax; M[3] = ay; M[6] = az; M[1] = bx; M[4] = by; M[7] = bz; M[2] = cx; M[5] = cy; M[8] = cz;
}

// положение частиц твёрдого тела при центре (x, y) и повороте M — в tx/ty/tz или прямо в частицы
function solidPose(x, y, M, out) {
  for (let k = 0; k < N; k++) {
    const lx = sLx[k], ly = sLy[k], lz = sLz[k];
    const wx = x + M[0] * lx + M[1] * ly + M[2] * lz;
    const wy = y + M[3] * lx + M[4] * ly + M[5] * lz;
    const wz = Math.max(0, solid.zc + M[6] * lx + M[7] * ly + M[8] * lz);
    if (out) { tx[k] = wx; ty[k] = wy; tz[k] = wz; } else { px[k] = ox[k] = wx; py[k] = oy[k] = wy; pz[k] = oz[k] = wz; }
  }
}

function startMorph() {
  if (mode !== 'cloth') return;
  release();
  const fr = pose();
  solidLocal(foldKind);
  solid.x = clamp(fr.cx, solid.rb, W - solid.rb); solid.y = clamp(fr.cy, solid.rb, H - solid.rb);
  solid.M = rotZ(fr.ang); solid.vx = solid.vy = solid.w = 0;
  anim = { t: 0, dur: MORPH_DUR, from: Float32Array.from([...px, ...py, ...pz]) };
  mode = 'morphing'; inv.fill(0); wake();
}

function startUnmorph() {
  if (mode !== 'solid') return;
  bodyGrab = null; api.drag(false);
  const ang = Math.atan2(solid.M[3], solid.M[0]);
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const rx = Math.abs(ca) * width / 2 + Math.abs(sa) * carpetH / 2, ry = Math.abs(sa) * width / 2 + Math.abs(ca) * carpetH / 2;
  const cx = clamp(solid.x, Math.min(rx, W / 2), Math.max(W - rx, W / 2)), cy = clamp(solid.y, Math.min(ry, H / 2), Math.max(H - ry, H / 2));
  for (let k = 0; k < N; k++) { tx[k] = cx + restX[k] * ca - restY[k] * sa; ty[k] = cy + restX[k] * sa + restY[k] * ca; tz[k] = 0; }
  anim = { t: 0, dur: MORPH_DUR, from: Float32Array.from([...px, ...py, ...pz]), to: Float32Array.from([...tx, ...ty, ...tz]) };
  mode = 'unmorphing'; wake();
}

function morphStep(dt) {
  anim.t += dt;
  const k = Math.min(1, anim.t / anim.dur), e = ease(k), f = anim.from;
  if (mode === 'morphing') solidPose(solid.x, solid.y, solid.M, true);
  else { const to = anim.to; for (let q = 0; q < N; q++) { tx[q] = to[q]; ty[q] = to[N + q]; tz[q] = to[2 * N + q]; } }
  const lift = Math.sin(Math.PI * k) * 22;      // ткань слегка взлетает, складываясь
  for (let q = 0; q < N; q++) {
    px[q] = ox[q] = f[q] + (tx[q] - f[q]) * e;
    py[q] = oy[q] = f[N + q] + (ty[q] - f[N + q]) * e;
    pz[q] = oz[q] = f[2 * N + q] + (tz[q] - f[2 * N + q]) * e + lift;
  }
  frontK = mode === 'morphing' ? e : 1 - e;
  if (k < 1) return;
  anim = null;
  if (mode === 'morphing') { mode = 'solid'; solidPose(solid.x, solid.y, solid.M); }
  else { mode = 'cloth'; frontK = 0; for (let q = 0; q < N; q++) inv[q] = act[q]; saveState(); }
}

function solidStep(dt) {
  const ball = solid.kind === 'ball', M = solid.M;
  let fx = 0, fy = 0, tq = 0, ofx = 0, ofy = 0;
  if (bodyGrab) {
    if (!ball) { // точка захвата поворачивается вместе с телом
      const lx = bodyGrab.lx, ly = bodyGrab.ly;
      ofx = M[0] * lx + M[1] * ly; ofy = M[3] * lx + M[4] * ly;
    }
    const gx = solid.x + ofx, gy = solid.y + ofy;
    const vgx = solid.vx - solid.w * ofy, vgy = solid.vy + solid.w * ofx;
    fx = 90 * (mouseX - gx) - 14 * vgx; fy = 90 * (mouseY - gy) - 14 * vgy;
    tq = ofx * fy - ofy * fx;
  }
  solid.vx += fx * dt; solid.vy += fy * dt;
  const sp = Math.hypot(solid.vx, solid.vy), dec = (ball ? 150 : 1500) * dt;
  const k = sp > dec ? (sp - dec) / sp : 0;
  solid.vx *= k; solid.vy *= k;
  if (!ball) {
    const I = solid.rb * solid.rb / 3;
    solid.w += tq / I * dt;
    solid.w = Math.sign(solid.w) * Math.max(0, Math.abs(solid.w) - 6 * dt) * (1 - Math.min(1, 3 * dt));
  }
  solid.x += solid.vx * dt; solid.y += solid.vy * dt;
  if (ball) { // качение без проскальзывания: ось поворота — поперёк скорости
    const v = Math.hypot(solid.vx, solid.vy);
    if (v > 1e-3) solid.M = mul3(axisAngle(-solid.vy / v, solid.vx / v, 0, v * dt / solid.R), M);
  } else if (solid.w) solid.M = mul3(rotZ(solid.w * dt), M);
  orthonormalize(solid.M);
  const r = solid.rb;
  if (solid.x < r) { solid.x = r; solid.vx = Math.abs(solid.vx) * 0.45; }
  if (solid.x > W - r) { solid.x = W - r; solid.vx = -Math.abs(solid.vx) * 0.45; }
  if (solid.y < r) { solid.y = r; solid.vy = Math.abs(solid.vy) * 0.45; }
  if (solid.y > H - r) { solid.y = H - r; solid.vy = -Math.abs(solid.vy) * 0.45; }
  solidPose(solid.x, solid.y, solid.M);
  return bodyGrab ? 1 : Math.hypot(solid.vx, solid.vy) + Math.abs(solid.w) * r;
}

let frontK = 0;   // 0 — изнанка как изнанка, 1 — на свёрнутом ковре везде видна лицевая текстура
function toggleFold() {
  if (mode === 'cloth') { if (foldKind === 'roll') startRoll(); else startMorph(); }
  else if (mode === 'roll') startUnroll();
  else if (mode === 'solid') startUnmorph();
}

// ---------- цикл ----------
let last = performance.now(), acc = 0, stepCost = 2;
function frame(now) {
  requestAnimationFrame(frame);
  const elapsed = Math.min(0.05, (now - last) / 1000); last = now;
  if (!sleeping) {
    acc += elapsed;
    // сколько шагов физики успеваем за кадр: если ковёр тяжёлый (много слоёв), лучше
    // замедлиться, чем подвесить компьютер
    const budget = Math.max(1, Math.min(3, Math.floor(10 / Math.max(0.5, stepCost))));
    const steps = Math.min(budget, Math.floor(acc / DT));
    acc -= steps * DT;
    if (acc > DT * 2) acc = DT * 2;                  // не копить долг — иначе догонялки без конца
    const t0 = performance.now();
    let maxv = 0;
    for (let s = 0; s < steps; s++) {
      if (mode === 'cloth') maxv = Math.max(maxv, step(DT, (s + 1) / steps));
      else if (mode === 'roll') maxv = Math.max(maxv, bodyStep(DT) * DT);
      else if (mode === 'solid') maxv = Math.max(maxv, solidStep(DT) * DT);
      else if (mode === 'morphing' || mode === 'unmorphing') { morphStep(DT); maxv = 1; }
      else { animStep(DT); maxv = 1; }
    }
    if (steps) stepCost = stepCost * 0.8 + (performance.now() - t0) / steps * 0.2;
    if (grab >= 0) { prevMX = grabTX; prevMY = grabTY; }
    if (steps) {
      calm = grab < 0 && !bodyGrab && maxv < 0.015 ? calm + steps : 0;
      if (calm > 90) { sleeping = true; saveState(); }
      project(); updateHover(); needDraw = true;
    }
  }
  if (needDraw) { draw(); needDraw = false; }
}

function wake() { sleeping = false; calm = 0; acc = 0; settle = 0; needDraw = true; }

// ---------- мышь ----------
function onMove(x, y) {
  mouseX = x; mouseY = y;
  if (grab >= 0) { grabTX = x; grabTY = y; wake(); }
  else if (bodyGrab) wake();
  else if (sleeping) updateHover();
}

api.onCursor((p) => { if (grab < 0 && !bodyGrab) onMove(p.x, p.y); });

canvas.addEventListener('pointermove', (e) => onMove(e.clientX, e.clientY));
canvas.addEventListener('pointerdown', (e) => {
  onMove(e.clientX, e.clientY);
  if (e.button !== 0) return;
  project();
  const h = hitTest(e.clientX, e.clientY);
  if (!h) return;
  if (mode === 'roll') {
    const cp = Math.cos(body.psi), sp = Math.sin(body.psi);
    bodyGrab = { u: clamp((px[h.k] - body.x) * cp + (py[h.k] - body.y) * sp, -width / 2, width / 2) };
    canvas.setPointerCapture(e.pointerId);
    document.body.classList.add('grab');
    api.drag(true); wake();
    return;
  }
  if (mode === 'solid') {
    // точка захвата в осях тела (для шара не важна — тянем за центр)
    const dx = px[h.k] - solid.x, dy = py[h.k] - solid.y, M = solid.M;
    bodyGrab = { lx: M[0] * dx + M[3] * dy, ly: M[1] * dx + M[4] * dy };
    canvas.setPointerCapture(e.pointerId);
    document.body.classList.add('grab');
    api.drag(true); wake();
    return;
  }
  if (mode !== 'cloth') return;
  grab = h.k; inv[grab] = 0; setTethers(grab);
  grabZ = pz[grab]; liftH = Math.max(liftH, grabZ + 30);
  grabTX = prevMX = e.clientX; grabTY = prevMY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
  document.body.classList.add('grab');
  api.drag(true); wake();
});
function release() {
  if (bodyGrab) { bodyGrab = null; document.body.classList.remove('grab'); api.drag(false); wake(); return; }
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
  if (mode === 'roll' || mode === 'solid') toggleFold(); else if (mode === 'cloth') shake(0.6);
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
// скомкать: полсекунды ковёр стягивается к середине с подбросом — плавно, без рывка сквозь слои
let crumpleT = 0, crumpleC = null;
const crumpleF = new Float32Array(N), crumpleG = new Array(N);
function crumple() {
  crumpleT = 1.0; crumpleC = pose();
  const r = Math.min(width, carpetH) * 0.18, pts = [0, 1, 2].map(() => [crumpleC.cx + (Math.random() - 0.5) * 2 * r, crumpleC.cy + (Math.random() - 0.5) * 2 * r]);
  for (let k = 0; k < N; k++) {
    let best = pts[0], bd = Infinity;
    for (const q of pts) { const d = (px[k] - q[0]) ** 2 + (py[k] - q[1]) ** 2; if (d < bd) { bd = d; best = q; } }
    crumpleG[k] = best;
  }
  // случайные бугры: ковёр сминается сразу во многих местах, а не складывается пополам
  const a = Math.random() * 6, b = Math.random() * 6, c = Math.random() * 6, d = Math.random() * 6;
  for (let k = 0; k < N; k++) {
    const i = k % NX, j = (k / NX) | 0;
    crumpleF[k] = Math.max(0, Math.sin(i * 0.55 + a) * Math.sin(j * 0.5 + b) + 0.5 * Math.sin(i * 0.9 + j * 0.7 + c) + 0.2 * Math.sin(j * 1.3 + d));
  }
  wake();
}
function crumpleStep(dt) {
  crumpleT -= dt;
  const c = crumpleC;
  for (let k = 0; k < N; k++) {
    if (inv[k] === 0) continue;
    // каждую часть тянет к своей «горсти» — так получаются складки в разные стороны
    const g = crumpleG[k];
    px[k] += (g[0] - px[k]) * 0.009 + (Math.random() - 0.5) * 0.25;
    py[k] += (g[1] - py[k]) * 0.009 + (Math.random() - 0.5) * 0.25;
    if (crumpleT > 0.8) pz[k] += 0.1 + crumpleF[k] * 0.7;  // подброс только в начале
  }
}

api.onCommand((cmd) => {
  if (cmd === 'flatten') { if (mode === 'roll' || mode === 'solid') toggleFold(); else if (mode === 'cloth') flatten(); }
  else if (cmd === 'shake') { if (mode === 'cloth') shake(); }
  else if (cmd === 'crumple') { if (mode === 'cloth') crumple(); }
  else if (cmd === 'roll') toggleFold();
  else if (cmd === 'remove') remove();
  else if (cmd === 'reset') { snapCloth(); setSize(false); }
});

// из любого режима сразу в обычную ткань (перед сменой формы или размера)
function snapCloth() {
  release();
  if (mode !== 'cloth') { anim = null; mode = 'cloth'; frontK = 0; bodyGrab = null; }
  for (let q = 0; q < N; q++) inv[q] = act[q];
}

// настройки из окна «Настройки»: форма, размер, прозрачность, картинка
function imageUrl(name) {
  if (!name) return 'assets/carpet.png';
  if (name.startsWith('builtin:')) return 'assets/carpets/' + name.slice(8).replace(/[^0-9]/g, '') + '.jpg';
  return 'kovyor://user/' + encodeURIComponent(name);
}
function applySettings(st, first) {
  const w = st.width || SIZES[st.size] || SIZES.medium;
  const sh = st.shape in SHAPE_ASPECT ? st.shape : 'rect';
  opacity = clamp(st.opacity == null ? 1 : st.opacity, 0.1, 1);
  needDraw = true;
  const geomChanged = w !== width || sh !== shape;
  const img = st.image || '';
  if (st.fold in { roll: 1, ball: 1, cube: 1, plate: 1 } && st.fold !== foldKind) {
    foldKind = st.fold;
    // ковёр уже свёрнут — разворачиваем и сворачиваем в новую форму
    if (!first && (mode === 'roll' || mode === 'solid')) { toggleFold(); setTimeout(() => { if (mode === 'cloth') toggleFold(); }, 1700); }
  }
  const reshape = () => { const was = mode !== 'cloth'; snapCloth(); setSize(true); if (was) setTimeout(toggleFold, 500); };
  if (img !== imageKey || first) {
    imageKey = img;
    loadImage(imageUrl(img), (ok) => {
      if (!ok && img) { imageKey = ''; loadImage(imageUrl(''), () => { width = w; shape = sh; if (!first) reshape(); }); return; }
      width = w; shape = sh;
      if (first) startFromState(); else reshape();
    });
  } else if (geomChanged) { width = w; shape = sh; reshape(); }
  else wake();
}
api.onSettings?.((st) => applySettings(st, false));

function saveState() {
  if (mode !== 'cloth' && mode !== 'roll' && mode !== 'solid') return;
  const pos = new Array(N * 3);
  for (let k = 0; k < N; k++) {
    pos[k * 3] = Math.round(px[k] * 10) / 10; pos[k * 3 + 1] = Math.round(py[k] * 10) / 10; pos[k * 3 + 2] = Math.round(pz[k] * 10) / 10;
  }
  const b = mode === 'roll' ? { x: body.x, y: body.y, psi: body.psi, sigma: body.sigma } : null;
  const so = mode === 'solid' ? { kind: solid.kind, x: solid.x, y: solid.y, M: solid.M } : null;
  api.saveState({ v: 2, NX, NY, width, shape, image: imageKey, W, H, pos, roll: b, solid: so });
}

// ---------- старт ----------
let saved = null;
function startFromState() {
  rebuildGeometry();
  const st = saved;
  const ok = st && st.v === 2 && st.NX === NX && st.NY === NY && st.width === width && st.shape === shape &&
    st.image === imageKey && Array.isArray(st.pos) && st.pos.length === N * 3;
  if (ok && st.solid && Array.isArray(st.solid.M)) {
    solidLocal(st.solid.kind); solid.M = st.solid.M.slice(0, 9); orthonormalize(solid.M);
    solid.x = clamp(st.solid.x, solid.rb, W - solid.rb); solid.y = clamp(st.solid.y, solid.rb, H - solid.rb);
    solid.vx = solid.vy = solid.w = 0;
    inv.fill(0); mode = 'solid'; frontK = 1; solidPose(solid.x, solid.y, solid.M); wake();
  } else if (ok && st.roll) {
    // рулон: скатываем «мгновенно» в сохранённом месте
    anim = { t: 0, dur: 1, from: new Float32Array(N * 3), frame: { cx: 0, cy: 0, ang: st.roll.psi } };
    finishRoll();
    body.x = clamp(st.roll.x, 0, W); body.y = clamp(st.roll.y, 0, H); body.sigma = st.roll.sigma || 0;
    for (let q = 0; q < N; q++) inv[q] = 0;
    frontK = 1; placeBody(); wake();
  } else if (ok) {
    for (let k = 0; k < N; k++) {
      px[k] = ox[k] = clamp(st.pos[k * 3], 0, W);
      py[k] = oy[k] = clamp(st.pos[k * 3 + 1], 0, H);
      pz[k] = oz[k] = st.pos[k * 3 + 2] + 25;      // лёгкое «приземление» при запуске
    }
    wake();
  } else setSize(false);
  if (!started) { started = true; requestAnimationFrame(frame); }
}
let started = false;
buildConstraints();
addEventListener('resize', resize);
resize();

api.init().then(({ settings, state }) => {
  saved = state;
  if (new URLSearchParams(location.search).has('demo')) window.__kovyor = { step, project, hitTest, shake, crumple, flatten, toggleRoll, toggleFold, applySettings, solid, body, get mode() { return mode; }, px, py, pz, inv, act, idx, NX, NY };
  applySettings(settings, true);
});
