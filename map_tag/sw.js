// Офлайн-кэш оболочки приложения (тайлы карты не кэшируются)
const CACHE = 'map-tag-v27';
const FILES = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/game.js', 'js/i18n.js', 'js/icons.js', 'js/content.js', 'js/themes.js', 'js/cheats.js', 'js/sound.js', 'js/replay.js', 'js/net.js', 'js/gamenet.js', 'js/seek.js', 'js/chat.js', 'js/voice.js', 'js/modes.js', 'js/mapeditor.js', 'js/extras.js', 'js/social.js', 'js/world.js', 'js/arena.js', 'js/indoor.js', 'js/radar.js', 'js/mapstyle.js', 'js/catchcode.js', 'lib/mqtt.min.js', 'css/themes.css',
  'lib/leaflet.js', 'lib/leaflet.css', 'lib/qrcode.js', 'lib/jsQR.js', 'lib/fonts.css', 'manifest.webmanifest', 'icons/icon-192.png'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request)));
});
