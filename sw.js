// Offline cache: the app, the map data and every map tile, so the app works on the property with no service.
// Bump VERSION whenever any file changes so phones pick up the new copy next time they open it online.
importScripts('precache.js');
const VERSION = 'bogwalk-2026-11-25d';
const CORE = self.CORE;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(CORE.map((u) => new Request(u, { cache: 'reload' })));   // skip the browser's HTTP cache so updates land
    const tiles = self.TILES || [];
    for (let i = 0; i < tiles.length; i += 20) {                     // tiles in small batches; a failed tile is fetched again later
      await Promise.all(tiles.slice(i, i + 20).map((t) => c.add(t).catch(() => {})));
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    } catch (err) {
      if (req.mode === 'navigate') { const idx = (await c.match('index.html')) || (await c.match('./')); if (idx) return idx; }
      throw err;
    }
  })());
});
