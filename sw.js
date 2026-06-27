/* Service Worker – App-Shell offline cachen.
   Wichtig: alle Netz-Zugriffe mit cache:'no-store', damit der 10-Min-HTTP-Cache
   von GitHub Pages neue Versionen nicht verzögert (sonst hängt die PWA hinterher). */
const CACHE = 'azt-v20';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(c => Promise.all(
      ASSETS.map(u => fetch(new Request(u, { cache: 'no-store' }))
        .then(r => (r && r.ok) ? c.put(u, r) : null)
        .catch(() => null))
    )).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // Netzwerk zuerst, HTTP-Cache umgehen: online immer aktuell, offline aus dem Cache
  e.respondWith(
    fetch(e.request, { cache: 'no-store' }).then(res => {
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
