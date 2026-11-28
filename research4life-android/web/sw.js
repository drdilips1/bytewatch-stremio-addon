// DermScholar web app: keeps the screens on the phone so the app opens without a connection.
// Network first (always the newest version when online; a slow network falls back to the saved
// copy after 3 s), saved copy when offline. Only this app's own files: never other sites, never
// Lesionaut (its own folder), never update lists.
const CACHE = 'dermscholar-shell-1';
const SKIP = /\/lesionaut\/|ota\.json|version\.json|\/pdf\/|\/import\/|\/proxy/;
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || !url.pathname.startsWith(new URL('./', self.registration.scope).pathname) || SKIP.test(url.pathname)) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const net = fetch(req).then((res) => { if (res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => {}); return res; });
    const saved = await cache.match(req, { ignoreSearch: url.pathname.endsWith('/') || url.pathname.endsWith('.html') });
    if (!saved) return net;
    const slow = new Promise((ok) => setTimeout(() => ok(saved), 3000));
    return Promise.race([net.catch(() => saved), slow]);
  })());
});
