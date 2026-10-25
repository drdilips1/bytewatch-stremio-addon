// AudiobookBay search for Audiohub — a Cloudflare Worker.
//
// Searches AudiobookBay, reads each result's info hash from its page and answers
// with a small JSON list Audiohub understands. Works from the Android app and the
// web app (iPhone / iPad) alike. Nothing is stored or logged.
//
// Deploy: dash.cloudflare.com → Workers & Pages → Create → Worker → name it
// (e.g. audiobookbay) → Deploy → Edit code → paste this file → Deploy.
// Then install it in Audiohub: Settings → Addons → paste
//   https://<your-worker>.workers.dev/manifest.json
//
// Routes:
//   /manifest.json      the addon file (points back at this worker)
//   /search?q=…         { results: [{ title, infoHash, magnetUrl, sizeBytes, format, date, pageUrl }] }

// AudiobookBay moves between addresses; the first one that answers is used.
const MIRRORS = ['audiobookbay.lu', 'audiobookbay.is', 'theaudiobookbay.se', 'audiobookbay.fi'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://open.stealth.si:80/announce',
];
// Result pages opened per search, for their info hash (each is one more request).
const MAX_RESULTS = 12;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};
const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...extra } });

function manifest(origin) {
  return {
    schemaVersion: '1.0.0',
    id: 'audiobookbay-own',
    name: 'AudiobookBay',
    version: '1.1.0',
    description: 'Audiobook torrents from AudiobookBay. Needs TorBox or Real-Debrid to play.',
    icon: `https://${MIRRORS[0]}/apple-touch-icon.png`,
    provides: ['source'],
    contentType: 'audiobook',
    rateLimit: { requestsPerMinute: 10, retryAfterMs: 6000 },
    matching: { algorithm: 'fuzzy', threshold: 0.4 },
    adapters: {
      source: {
        request: { method: 'GET', url: `${origin}/search?q={QUERY}`, timeout: 45000 },
        response: {
          resultsPath: 'results',
          mapping: { title: 'title', infoHash: 'infoHash', magnetUrl: 'magnetUrl', sizeBytes: 'sizeBytes', format: 'format', date: 'date', pageUrl: 'pageUrl' },
        },
      },
    },
  };
}

const decode = (s) =>
  String(s || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function toBytes(num, unit) {
  const n = parseFloat(String(num).replace(',', '.'));
  if (!n) return 0;
  const u = String(unit || '').toUpperCase();
  const pow = u.startsWith('K') ? 1 : u.startsWith('M') ? 2 : u.startsWith('G') ? 3 : u.startsWith('T') ? 4 : 0;
  return Math.round(n * 1024 ** pow);
}

async function get(url) {
  return fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' }, redirect: 'follow' });
}

// The search page, from the first mirror that answers with results markup.
async function searchPage(q) {
  let last = '';
  for (const host of MIRRORS) {
    try {
      const r = await get(`https://${host}/?s=${encodeURIComponent(q).replace(/%20/g, '+')}&cat=undefined%2Cundefined`);
      const html = await r.text();
      if (r.ok && /class="post"|postTitle|Nothing Found|No results/i.test(html)) return { host: new URL(r.url).host, html };
      last = `${host}: HTTP ${r.status}`;
    } catch (e) {
      last = `${host}: ${e.message}`;
    }
  }
  throw new Error(`AudiobookBay didn't answer (${last})`);
}

function parseSearch(html, host) {
  const posts = html.split(/<div class="post"[^>]*>/).slice(1);
  return posts
    .map((p) => {
      const a = /class="postTitle"[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(p);
      if (!a) return null;
      const info = decode((/class="postContent"[\s\S]*?<\/div>/i.exec(p) || [''])[0]);
      const size = /File Size:\s*([\d.,]+)\s*([KMGT]?B)s?/i.exec(info);
      return {
        title: decode(a[2]),
        pageUrl: new URL(a[1], `https://${host}/`).href,
        format: (/Format:\s*([^\s/]+)/i.exec(info) || [])[1] || '',
        sizeBytes: size ? toBytes(size[1], size[2]) : 0,
        date: (/Posted:\s*([0-9]{1,2} [A-Za-z]{3} [0-9]{4})/i.exec(info) || [])[1] || '',
      };
    })
    .filter(Boolean);
}

async function withHash(item) {
  try {
    const html = await (await get(item.pageUrl)).text();
    const hash = (/Info Hash:?\s*<\/td>\s*<td[^>]*>\s*([0-9a-f]{40})/i.exec(html) || /\b([0-9a-f]{40})\b/i.exec(html.split('Info Hash')[1] || '') || [])[1];
    if (!hash) return null;
    const infoHash = hash.toLowerCase();
    const tr = TRACKERS.map((t) => `&tr=${encodeURIComponent(t)}`).join('');
    return { ...item, infoHash, magnetUrl: `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(item.title)}${tr}` };
  } catch {
    return null;
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/manifest.json') return json(manifest(url.origin));
    if (url.pathname !== '/search') return json({ error: 'Not found' }, 404);

    const q = (url.searchParams.get('q') || '').trim();
    if (!q) return json({ results: [] });

    // Same search within an hour: answer from Cloudflare's cache (saves AudiobookBay and your daily quota).
    const cache = caches.default;
    const key = new Request(`${url.origin}/search?q=${encodeURIComponent(q.toLowerCase())}`);
    const hit = await cache.match(key);
    if (hit) return hit;

    try {
      const { host, html } = await searchPage(q);
      const found = parseSearch(html, host).slice(0, MAX_RESULTS);
      const results = (await Promise.all(found.map(withHash))).filter(Boolean);
      const res = json({ results }, 200, { 'Cache-Control': 'public, max-age=3600' });
      if (results.length) ctx.waitUntil(cache.put(key, res.clone()));
      return res;
    } catch (e) {
      return json({ error: e.message, results: [] }, 502);
    }
  },
};
