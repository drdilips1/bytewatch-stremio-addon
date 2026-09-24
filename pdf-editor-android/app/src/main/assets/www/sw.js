/* Offline cache for the web (home-screen) version. VERSION is stamped at deploy time. */
const VERSION = 'dev';
const CACHE = 'pdf-editor-' + VERSION;
const SHELL = [
    './',
    'index.html',
    'app.css',
    'icons.js',
    'app.js',
    'tools.js',
    'edit2.js',
    'manifest.webmanifest',
    'icons/icon-192.png',
    'icons/apple-touch-icon.png',
    'lib/pdf.min.js',
    'lib/pdf.worker.min.js',
    'lib/pdf-lib.min.js',
    'lib/fontkit.min.js',
    'lib/fonts/DancingScript_400Regular.ttf',
    'lib/fonts/DancingScript_700Bold.ttf',
    'lib/fonts/Lato_400Regular.ttf',
    'lib/fonts/Lato_400Regular_Italic.ttf',
    'lib/fonts/Lato_700Bold.ttf',
    'lib/fonts/Lato_700Bold_Italic.ttf',
    'lib/fonts/NotoSansDevanagari_400Regular.ttf',
    'lib/fonts/NotoSansDevanagari_700Bold.ttf',
    'lib/fonts/OpenSans_400Regular.ttf',
    'lib/fonts/OpenSans_400Regular_Italic.ttf',
    'lib/fonts/OpenSans_700Bold.ttf',
    'lib/fonts/OpenSans_700Bold_Italic.ttf',
    'lib/fonts/Roboto_400Regular.ttf',
    'lib/fonts/Roboto_400Regular_Italic.ttf',
    'lib/fonts/Roboto_700Bold.ttf',
    'lib/fonts/Roboto_700Bold_Italic.ttf',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('pdf-editor-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Cache-first for everything the app loads (OCR engine, fonts, cmaps are cached on first use).
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch (err) {
      if (req.mode === 'navigate') return cache.match('index.html');
      throw err;
    }
  }));
});
