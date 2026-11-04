/* Public, static app shell only. Never cache Supabase/API/user-data/download traffic.
 * Bump this version for every release. New workers wait for old tabs to close. */
const CACHE = 'muscle-shell-phase6-v1';
const PAGES = ['/', '/history', '/analysis', '/inbody'];
function publicAsset(url) { return url.origin === self.location.origin && url.pathname.startsWith('/_next/static/'); }
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const assets = new Set();
    for (const path of PAGES) {
      const response = await fetch(new Request(path, { cache: 'reload' }));
      if (!response.ok) throw new Error('Public shell unavailable');
      const html = await response.clone().text();
      for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
        const url = new URL(match[1].replaceAll('&amp;', '&'), self.location.origin);
        if (publicAsset(url)) assets.add(url.href);
      }
      await cache.put(path, response);
    }
    await cache.addAll([...assets]);
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('muscle-shell-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  const page = request.mode === 'navigate' && PAGES.includes(url.pathname) && !url.search;
  if (!page && !publicAsset(url)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE), key = page ? url.pathname : request;
    try {
      const response = await fetch(request);
      if (response.ok) await cache.put(key, response.clone());
      return response;
    } catch {
      const cached = await cache.match(key);
      if (cached) return cached;
      throw new Error('Public shell not cached');
    }
  })());
});
