'use strict';
// Service worker SourcingDesk: mette in cache SOLO gli asset statici dell'interfaccia.
// Le chiamate /api/* e /health non vengono mai intercettate né salvate in cache (dati privati e sempre aggiornati).
const CACHE = 'sd-static-v1';
const ASSETS = ['/', '/index.html', '/style.css', '/app.js', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png', '/icons/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/health') return; // mai cache per le API
  if (!ASSETS.includes(url.pathname)) return;
  // Network-first: versione aggiornata se online, cache se offline.
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('/index.html'))));
});
