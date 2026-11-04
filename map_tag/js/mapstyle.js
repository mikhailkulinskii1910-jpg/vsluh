// Стили карты: обычная, тёмная, светлая, спутник, рельеф. Выбор хранится на телефоне и действует на все карты.
export const TILES = {
  osm: { u: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', a: '© OpenStreetMap', z: 19, ic: '🗺' },
  dark: { u: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', a: '© OpenStreetMap © CARTO', z: 20, ic: '🌙' },
  light: { u: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', a: '© OpenStreetMap © CARTO', z: 20, ic: '☀️' },
  sat: { u: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', a: '© Esri', z: 19, ic: '🛰', labels: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png' },
  topo: { u: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', a: '© OpenStreetMap © OpenTopoMap', z: 17, ic: '⛰' },
};
export const TILE_KEYS = Object.keys(TILES);
export function tileStyle() { try { const s = localStorage.getItem('mt_tiles'); return TILES[s] ? s : 'osm'; } catch { return 'osm'; } }
export function setTileStyle(s) { try { localStorage.setItem('mt_tiles', s); } catch {} }
/** Подложка карты выбранного стиля. Возвращает объект с remove(). */
export function addTiles(map, style = tileStyle()) {
  const d = TILES[style] || TILES.osm;
  const g = L.layerGroup().addTo(map);
  L.tileLayer(d.u, { maxZoom: 19, maxNativeZoom: d.z, attribution: d.a, subdomains: 'abcd' }).addTo(g);
  if (d.labels) L.tileLayer(d.labels, { maxZoom: 19, subdomains: 'abcd', pane: 'overlayPane', opacity: 0.9 }).addTo(g);
  const c = map.getContainer(); c.classList.toggle('tiles-styled', style !== 'osm'); c.dataset.tiles = style;
  return g;
}
