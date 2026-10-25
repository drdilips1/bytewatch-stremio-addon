// Audiobook and ebook torrent search for Audiohub — a Cloudflare Worker.
//
// Searches TorrentCSV and The Pirate Bay (both have free public APIs), keeps the
// audiobooks or the ebooks, merges copies of the same torrent and answers with a
// small JSON list Audiohub understands. Works from the Android app and the web app.
// Nothing is stored or logged.
//
// Deploy: dash.cloudflare.com → Workers & Pages → Create → Worker → name it
// (e.g. audiohub-torrents) → Deploy → Edit code → paste this file → Deploy.
//
// Routes:
//   /audiobooks/manifest.json, /ebooks/manifest.json   addon files (point back at this worker)
//   /audiobooks/search?q=…, /ebooks/search?q=…         { results: [{ title, infoHash, magnetUrl, sizeBytes, seeders, date, format, source }] }

const KINDS = {
  audiobooks: {
    name: 'Torrents · Audiobooks',
    contentType: 'audiobook',
    // The Pirate Bay: Audio → Audio books.
    tpbCats: [102],
    // TorrentCSV has no categories: keep names that look like audiobooks.
    looksRight: /audio ?book|\bm4b\b|\bunabridged\b|\bnarrated\b|\bread by\b|\baudible\b|\[?\b(mp3|aac|m4a)\b/i,
    format: /\b(m4b|m4a|mp3|aac|flac|opus)\b/i,
  },
  ebooks: {
    name: 'Torrents · Ebooks',
    contentType: 'ebook',
    // The Pirate Bay: Other → E-books (and comics).
    tpbCats: [601, 602],
    looksRight: /e-?book|\bepub\b|\bpdf\b|\bmobi\b|\bazw3?\b|\bkindle\b|\bretail\b.*\b(epub|pdf)\b/i,
    format: /\b(epub|pdf|mobi|azw3?)\b/i,
  },
};
const TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://open.stealth.si:80/announce',
];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};
const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...extra } });

function manifest(origin, kind) {
  const k = KINDS[kind];
  return {
    schemaVersion: '1.0.0',
    id: `audiohub-torrents-${kind}`,
    name: k.name,
    version: '1.0.0',
    description: `${k.contentType === 'ebook' ? 'Ebook' : 'Audiobook'} torrents from TorrentCSV and The Pirate Bay. Needs TorBox or Real-Debrid.`,
    provides: ['source'],
    contentType: k.contentType,
    rateLimit: { requestsPerMinute: 20, retryAfterMs: 3000 },
    matching: { algorithm: 'fuzzy', threshold: 0.5 },
    adapters: {
      source: {
        request: { method: 'GET', url: `${origin}/${kind}/search?q={QUERY}`, timeout: 30000 },
        response: {
          resultsPath: 'results',
          mapping: { title: 'title', infoHash: 'infoHash', magnetUrl: 'magnetUrl', sizeBytes: 'sizeBytes', seeders: 'seeders', date: 'date', format: 'format' },
        },
      },
    },
  };
}

const magnet = (hash, name) => `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(name)}${TRACKERS.map((t) => `&tr=${encodeURIComponent(t)}`).join('')}`;
const day = (unix) => (unix ? new Date(unix * 1000).toISOString().slice(0, 10) : '');

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// TorrentCSV: one big index of many sites; no categories, so names are filtered.
async function torrentCsv(q, k) {
  const data = await getJson(`https://torrents-csv.com/service/search?q=${encodeURIComponent(q)}&size=100`);
  return (data.torrents || [])
    .filter((t) => k.looksRight.test(t.name || ''))
    .map((t) => ({ title: t.name, infoHash: String(t.infohash || '').toLowerCase(), sizeBytes: Number(t.size_bytes) || 0, seeders: Number(t.seeders) || 0, date: day(t.created_unix), source: 'TorrentCSV' }));
}

// The Pirate Bay's API: searched in the audiobook / ebook categories.
async function pirateBay(q, k) {
  const lists = await Promise.all(k.tpbCats.map((c) => getJson(`https://apibay.org/q.php?q=${encodeURIComponent(q)}&cat=${c}`).catch(() => [])));
  return lists
    .flat()
    .filter((t) => t && t.info_hash && !/^0+$/.test(t.info_hash))
    .map((t) => ({ title: t.name, infoHash: String(t.info_hash).toLowerCase(), sizeBytes: Number(t.size) || 0, seeders: Number(t.seeders) || 0, date: day(Number(t.added)), source: 'The Pirate Bay' }));
}

async function search(q, kind) {
  const k = KINDS[kind];
  const settled = await Promise.allSettled([torrentCsv(q, k), pirateBay(q, k)]);
  const errors = settled.map((s, i) => s.status === 'rejected' && `${i ? 'The Pirate Bay' : 'TorrentCSV'}: ${s.reason?.message || s.reason}`).filter(Boolean);
  // The same torrent from both sites: one result, the higher seed count.
  const byHash = new Map();
  for (const r of settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []))) {
    if (!/^[0-9a-f]{40}$/.test(r.infoHash)) continue;
    const had = byHash.get(r.infoHash);
    if (!had || r.seeders > had.seeders) byHash.set(r.infoHash, { ...r, source: had && had.source !== r.source ? `${had.source} + ${r.source}` : r.source });
  }
  const results = [...byHash.values()]
    .sort((a, b) => b.seeders - a.seeders)
    .slice(0, 50)
    .map((r) => ({ ...r, format: (k.format.exec(r.title) || [])[1]?.toUpperCase() || '', magnetUrl: magnet(r.infoHash, r.title) }));
  return { results, errors };
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    const [, kind, route] = url.pathname.split('/');
    if (!KINDS[kind]) return json({ error: 'Use /audiobooks/… or /ebooks/…' }, 404);
    if (route === 'manifest.json') return json(manifest(url.origin, kind));
    if (route !== 'search') return json({ error: 'Not found' }, 404);

    const q = (url.searchParams.get('q') || '').trim();
    if (!q) return json({ results: [] });

    // Same search within an hour: answer from Cloudflare's cache (saves the sites and your daily quota).
    const cache = caches.default;
    const key = new Request(`${url.origin}/${kind}/search?q=${encodeURIComponent(q.toLowerCase())}`);
    const hit = await cache.match(key);
    if (hit) return hit;

    const { results, errors } = await search(q, kind);
    if (!results.length && errors.length === 2) return json({ error: errors.join('; '), results: [] }, 502);
    const res = json({ results, ...(errors.length ? { errors } : {}) }, 200, { 'Cache-Control': 'public, max-age=3600' });
    if (results.length) ctx.waitUntil(cache.put(key, res.clone()));
    return res;
  },
};
