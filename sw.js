// Service worker: guarda la "carcasa" de la app para que abra al instante. Los datos (api.github.com) nunca se cachean.
const CACHE = 'agente-v2.14.2';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return;
  const guardar = r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return r; };
  // Archivos con versión (?v=…): su contenido no cambia nunca para esa URL → caché primero (arranque instantáneo).
  if (url.searchParams.has('v')) {
    e.respondWith(caches.match(e.request).then(c => c || fetch(e.request).then(guardar)));
    return;
  }
  // HTML y resto: red primero (para recibir actualizaciones), caché si no hay conexión.
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(guardar).catch(() => caches.match(e.request)));
});
