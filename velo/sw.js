/* Велокарта: service worker.
   — оболочка приложения: сеть, а при отсутствии сети — последняя сохранённая копия;
   — тайлы карт (любой сервер): из кэша «velo-tiles», если есть; иначе из сети и в кэш.
   Офлайн-пакеты карт (js/offline.js) наполняют тот же кэш. */
const SHELL_CACHE = 'velo-shell-v2';
const TILE_CACHE = 'velo-tiles';
const SHELL = [
  './', 'index.html', 'style.css', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
  'vendor/leaflet.js', 'vendor/leaflet.css',
  'js/geo.js', 'js/icons.js', 'js/skins.js', 'js/store.js', 'js/net.js', 'js/elevation.js', 'js/offline.js', 'js/app.js', 'js/lobby.js',
];
// тайлы: .../z/x/y.png (схема, высоты) и .../z/y/x без расширения (спутник Esri)
const TILE_RE = /\/\d+\/\d+\/\d+(@\dx)?(\.(png|jpg|webp))?$/;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('velo-shell-') && k !== SHELL_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    // оболочка: сначала сеть (свежие версии), при сбое — кэш
    e.respondWith(
      fetch(req).then(res => {
        if (res.ok) caches.open(SHELL_CACHE).then(c => c.put(req, res.clone()));
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }))
    );
    return;
  }

  if (TILE_RE.test(url.pathname)) {
    e.respondWith(
      caches.open(TILE_CACHE).then(c => c.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok || res.type === 'opaque') c.put(req, res.clone());
        return res;
      })))
    );
  }
});
