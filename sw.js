/* Вслух: офлайн-кэш. Оболочка кэшируется при установке, остальное — при первом обращении.
   Нейро-голоса страница скачивает с HuggingFace и кэширует сама. */
const V = 'vsluh-app-73b578cf';
const SHELL = ["./", "dict/ru.aff.txt", "dict/ru.dic.txt", "fish/voices.json", "icon-180.png", "icon-192.png", "index.html", "lang/eng.wasm", "lang/rus.wasm", "lib/fonts.css", "lib/fonts/0c27298d4a.woff2", "lib/fonts/0dcceb4735.woff2", "lib/fonts/125d6b8840.woff2", "lib/fonts/23ef7c090d.woff2", "lib/fonts/45737b130f.woff2", "lib/fonts/4d2ea65dea.woff2", "lib/fonts/5541ce5597.woff2", "lib/fonts/61e8ef4ede.woff2", "lib/fonts/be7357b7da.woff2", "lib/fonts/c1b02dd2cf.woff2", "lib/fonts/eab85c0c99.woff2", "lib/fonts/fb9951a011.woff2", "lib/lame.min.js", "lib/ort.wasm.min.js", "lib/tesseract-core/tesseract-core-lstm.wasm.js", "lib/tesseract-core/tesseract-core-simd-lstm.wasm.js", "lib/tesseract-worker.min.js", "lib/tesseract.min.js", "manifest.webmanifest", "tts/denis.json", "tts/dmitri.json", "tts/irina.json", "tts/ort-wasm-simd.wasm", "tts/phonemize-data.wasm", "tts/phonemize.js", "tts/phonemize.wasm", "tts/ruslan.json"];
self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('vsluh-app-') && k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(caches.open(V).then(c => c.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(r => {
    if (r.ok && r.status === 200) c.put(e.request, r.clone());
    return r;
  }))));
});
