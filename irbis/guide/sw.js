/* krisa гид: офлайн-кэш. Файлы приложений (apk/ipa) не кэшируются — их скачивают с сайта. */
const V = 'krisa-guide-1';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'vt323.ttf', 'board-irbis.jpg', 'board-moctex.jpg', 'protect-1.jpg', 'protect-2.jpg', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('krisa-guide-') && k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || !u.pathname.includes('/guide/')) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request)));
});
