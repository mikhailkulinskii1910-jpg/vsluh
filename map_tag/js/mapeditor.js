// Редактор карты: граница зоны, запретные зоны, свои точки тайников, заданий, тюрьмы и сокровищ.
// Карты сохраняются на телефоне и передаются друзьям кодом.
import { t } from './i18n.js';
import { I } from './icons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TOOLS = [['zone', '⬡'], ['nogo', '⛔'], ['supply', '◆'], ['mission', '★'], ['jail', '⛓'], ['treasure', '🪙'], ['erase', '✕']];
const emptyMap = () => ({ nogo: [], supply: [], mission: [], jail: null, treasure: [] });

export function mapPoints(lb) {
  const m = lb.map || {};
  return { supply: m.supply || [], mission: m.mission || [], jail: m.jail || null, treasure: m.treasure || [] };
}

/** Элементы своей карты на карте лобби (только просмотр). */
export function drawMapExtras(map, lb) {
  const m = lb.map; if (!m) return;
  const g = L.layerGroup().addTo(map);
  for (const z of m.nogo || []) L.polygon(z.map((q) => [q.lat, q.lng]), { color: '#d63a4a', weight: 2, fillColor: '#d63a4a', fillOpacity: 0.22, dashArray: '4 6', interactive: false }).addTo(g);
  const pin = (q, html) => L.marker([q.lat, q.lng], { interactive: false, icon: L.divIcon({ className: '', iconSize: [24, 24], iconAnchor: [12, 12], html }) }).addTo(g);
  (m.supply || []).forEach((q) => pin(q, '<div class="mk-dia" style="transform:rotate(45deg) scale(.8)"></div>'));
  (m.mission || []).forEach((q) => pin(q, '<div class="ed-pt" style="background:#f3c13a">★</div>'));
  (m.treasure || []).forEach((q) => pin(q, '<div class="ed-pt" style="background:#ffd66b">🪙</div>'));
  if (m.jail) pin(m.jail, '<div class="mk-jail">⛓</div>');
}

export function renderMapEditor(el, { S, save, go, toast, modal }) {
  const lb = S.lobby;
  if (!lb) return go('home');
  lb.map = { ...emptyMap(), ...(lb.map || {}) };
  lb.poly = lb.poly || [];
  let tool = 'zone', draft = [];
  const center = lb.center || (lb.poly[0]) || { lat: 55.7520, lng: 37.6175 };

  el.innerHTML = `<div id="game"><div id="map"></div>
    <div class="hud-top">
      <div class="hud-bar" style="align-items:center;padding:0 8px;gap:8px">
        <button class="btn primary" id="edDone" style="min-height:44px">${I.arrowL}${t('done')}</button>
        <div style="flex:1;font-weight:700;text-align:center">${t('mapEditor')}</div>
        <button class="hb" id="edFit" aria-label="zone">${I.north}</button>
      </div>
      <div class="ed-tools">${TOOLS.map(([k, ic]) => `<button class="ed-tool" data-tool="${k}"><span>${ic}</span>${t('ed_' + k)}</button>`).join('')}</div>
    </div>
    <div class="hud-bottom"><div class="hud-more" id="edPanel"></div></div></div>`;

  const map = L.map(el.querySelector('#map'), { zoomControl: false, zoomSnap: 0.25 }).setView([center.lat, center.lng], 16);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  map.attributionControl.setPrefix(false);
  const layer = L.layerGroup().addTo(map);
  const zst = { color: '#2c7a4b', weight: 3, dashArray: '10 8', fillColor: '#5fd38d', fillOpacity: 0.08, interactive: false };

  const counts = () => `${t('ed_zone')}: ${lb.shape === 'custom' && lb.poly.length >= 3 ? lb.poly.length + ' ' + t('edPts') : t('shapeCircle')} · ⛔ ${lb.map.nogo.length} · ◆ ${lb.map.supply.length} · ★ ${lb.map.mission.length} · ⛓ ${lb.map.jail ? 1 : 0} · 🪙 ${lb.map.treasure.length}`;
  function draw() {
    layer.clearLayers();
    if (lb.shape === 'custom' && lb.poly.length) {
      L.polygon(lb.poly.map((q) => [q.lat, q.lng]), zst).addTo(layer);
      lb.poly.forEach((q, i) => L.circleMarker([q.lat, q.lng], { radius: 6, color: '#fff', weight: 2, fillColor: i === 0 ? '#ff8a5b' : '#2c7a4b', fillOpacity: 1, interactive: false }).addTo(layer));
    } else if (lb.center) {
      const r = (S._calcRadius && S._calcRadius()) || 500;
      L.circle([lb.center.lat, lb.center.lng], { radius: r, ...zst }).addTo(layer);
    }
    drawMapExtras(layer, { map: lb.map });
    if (draft.length) {
      L.polyline(draft.map((q) => [q.lat, q.lng]), { color: '#d63a4a', weight: 3, dashArray: '4 6', interactive: false }).addTo(layer);
      draft.forEach((q) => L.circleMarker([q.lat, q.lng], { radius: 5, color: '#fff', weight: 2, fillColor: '#d63a4a', fillOpacity: 1, interactive: false }).addTo(layer));
    }
    el.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === tool));
    panel();
  }

  function panel() {
    const p = el.querySelector('#edPanel');
    p.classList.toggle('mini', !!S._edMini);
    p.innerHTML = `<div class="row" style="flex-wrap:nowrap;align-items:flex-start"><div style="font-size:15px;flex:1">${t('edHint_' + tool)}</div><button class="icon-btn" data-ed="mini" style="width:38px;height:38px;flex:none">${S._edMini ? I.chevU : I.chevD}</button></div>
      <div style="color:var(--muted);font-size:13px;margin-top:6px">${counts()}</div>
      ${tool === 'zone' ? `<div class="row" style="margin-top:8px"><button class="btn" data-ed="undoZone" style="flex:1">${t('undoPt')}</button><button class="btn" data-ed="circle" style="flex:1">${t('edToCircle')}</button></div>` : ''}
      ${tool === 'nogo' ? `<div class="row" style="margin-top:8px"><button class="btn" data-ed="undoDraft" style="flex:1" ${draft.length ? '' : 'disabled'}>${t('undoPt')}</button><button class="btn primary" data-ed="closeNogo" style="flex:1" ${draft.length >= 3 ? '' : 'disabled'}>${t('edClose')}</button></div>` : ''}
      <div class="row" style="margin-top:8px;gap:6px">
        <button class="btn" data-ed="save" style="flex:1;padding:0 8px;font-size:14px">💾 ${t('edSave')}</button>
        <button class="btn" data-ed="maps" style="flex:1;padding:0 8px;font-size:14px">📂 ${t('edMaps')}</button>
        <button class="btn" data-ed="share" style="flex:1;padding:0 8px;font-size:14px">🔗 ${t('edShare')}</button>
      </div>
      <div class="row" style="margin-top:6px;gap:6px"><button class="btn" data-ed="import" style="flex:1;font-size:14px">📥 ${t('edImport')}</button><button class="btn danger" data-ed="clear" style="flex:1;font-size:14px">${t('edClear')}</button></div>`;
    p.querySelectorAll('[data-ed]').forEach((b) => b.onclick = () => action(b.dataset.ed));
  }

  function nearest(latlng) {
    const pt = map.latLngToContainerPoint(latlng);
    const near = (q) => map.latLngToContainerPoint([q.lat, q.lng]).distanceTo(pt) < 30;
    for (const k of ['supply', 'mission', 'treasure']) { const i = lb.map[k].findIndex(near); if (i >= 0) return () => lb.map[k].splice(i, 1); }
    if (lb.map.jail && near(lb.map.jail)) return () => { lb.map.jail = null; };
    for (let i = 0; i < lb.map.nogo.length; i++) {
      const poly = L.polygon(lb.map.nogo[i].map((q) => [q.lat, q.lng]));
      if (poly.getBounds().contains(latlng)) return () => lb.map.nogo.splice(i, 1);
    }
    const zi = lb.poly.findIndex(near); if (zi >= 0) return () => lb.poly.splice(zi, 1);
    return null;
  }

  map.on('click', (e) => {
    const q = { lat: e.latlng.lat, lng: e.latlng.lng };
    if (tool === 'zone') { lb.shape = 'custom'; lb.poly.push(q); }
    else if (tool === 'nogo') draft.push(q);
    else if (tool === 'jail') lb.map.jail = q;
    else if (tool === 'erase') { const f = nearest(e.latlng); if (f) f(); else toast(t('edNothing')); }
    else lb.map[tool].push(q);
    save(); draw();
  });

  function action(a) {
    if (a === 'mini') { S._edMini = !S._edMini; panel(); return; }
    if (a === 'undoZone') lb.poly.pop();
    if (a === 'circle') { lb.shape = 'circle'; if (lb.poly.length >= 3 && !lb.center) lb.center = lb.poly[0]; }
    if (a === 'undoDraft') draft.pop();
    if (a === 'closeNogo' && draft.length >= 3) { lb.map.nogo.push(draft); draft = []; }
    if (a === 'clear') { lb.map = emptyMap(); lb.poly = []; lb.shape = 'circle'; draft = []; }
    if (a === 'save') {
      modal(`<h2>${t('edSave')}</h2><input class="input" id="mn" maxlength="30" placeholder="${t('presetName')}"><div class="row" style="margin-top:14px"><button class="btn" data-x style="flex:1">${t('cancel')}</button><button class="btn primary" data-ok style="flex:1">OK</button></div>`, (b, close) => {
        b.querySelector('[data-x]').onclick = close;
        b.querySelector('[data-ok]').onclick = () => { const name = b.querySelector('#mn').value.trim() || t('edMap') + ' ' + ((S.maps || []).length + 1); S.maps = [...(S.maps || []), { name, data: snapshot() }]; save(); close(); toast(t('edSaved')); };
      });
    }
    if (a === 'maps') {
      const ms = S.maps || [];
      modal(`<h2>${t('edMaps')}</h2>${ms.length ? ms.map((m, i) => `<div class="line-row"><button class="btn ghost" data-ld="${i}" style="flex:1;justify-content:flex-start;padding:0">${esc(m.name)}</button><button class="btn" data-dl="${i}" style="min-height:36px;padding:0 10px">✕</button></div>`).join('') : `<p style="color:var(--muted)">${t('edNoMaps')}</p>`}<button class="btn block" data-x style="margin-top:12px">${t('done')}</button>`, (b, close) => {
        b.querySelector('[data-x]').onclick = close;
        b.querySelectorAll('[data-ld]').forEach((x) => x.onclick = () => { load(ms[+x.dataset.ld].data); close(); });
        b.querySelectorAll('[data-dl]').forEach((x) => x.onclick = () => { ms.splice(+x.dataset.dl, 1); S.maps = ms; save(); close(); action('maps'); });
      });
    }
    if (a === 'share') {
      const code = 'MT1:' + btoa(unescape(encodeURIComponent(JSON.stringify(snapshot()))));
      try { navigator.clipboard.writeText(code).catch(() => {}); } catch {}
      modal(`<h2>${t('edShare')}</h2><p style="color:var(--muted)">${t('edShareS')}</p><textarea class="input" style="min-height:120px;font-size:12px;padding:10px" readonly>${esc(code)}</textarea><button class="btn block" data-x style="margin-top:12px">${t('done')}</button>`, (b, close) => { b.querySelector('[data-x]').onclick = close; b.querySelector('textarea').select(); });
    }
    if (a === 'import') {
      modal(`<h2>${t('edImport')}</h2><textarea class="input" id="ic" style="min-height:120px;font-size:12px;padding:10px" placeholder="MT1:…"></textarea><div class="row" style="margin-top:12px"><button class="btn" data-x style="flex:1">${t('cancel')}</button><button class="btn primary" data-ok style="flex:1">OK</button></div>`, (b, close) => {
        b.querySelector('[data-x]').onclick = close;
        b.querySelector('[data-ok]').onclick = () => {
          try { const v = b.querySelector('#ic').value.trim().replace(/^MT1:/, ''); load(JSON.parse(decodeURIComponent(escape(atob(v))))); close(); toast(t('edLoaded')); }
          catch { toast(t('edBadCode')); }
        };
      });
    }
    save(); draw();
  }
  const snapshot = () => JSON.parse(JSON.stringify({ shape: lb.shape || 'circle', poly: lb.poly, center: lb.center, map: lb.map }));
  function load(d) {
    lb.shape = d.shape || 'circle'; lb.poly = d.poly || []; lb.center = d.center || lb.center; lb.map = { ...emptyMap(), ...(d.map || {}) };
    save(); draw(); fit();
  }
  function fit() {
    const pts = [...lb.poly, ...(lb.center ? [lb.center] : []), ...lb.map.supply, ...lb.map.mission, ...lb.map.treasure, ...(lb.map.jail ? [lb.map.jail] : []), ...lb.map.nogo.flat()];
    if (pts.length >= 2) map.fitBounds(L.latLngBounds(pts.map((q) => [q.lat, q.lng])), { padding: [60, 60] });
    else if (pts.length) map.setView([pts[0].lat, pts[0].lng], 16);
  }
  el.querySelectorAll('[data-tool]').forEach((b) => b.onclick = () => { tool = b.dataset.tool; if (tool !== 'nogo') draft = []; draw(); });
  el.querySelector('#edDone').onclick = () => { if (draft.length >= 3) lb.map.nogo.push(draft); save(); map.remove(); go('lobby'); };
  el.querySelector('#edFit').onclick = fit;
  draw(); setTimeout(() => { map.invalidateSize(); fit(); }, 60);
}
