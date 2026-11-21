// Audiohub web relay — a Supabase Edge Function named "relay".
//
// Browsers (Safari on iPhone / iPad) block requests to services that don't
// allow cross-site calls (Hardcover, Audible, Goodreads, StoryShots, …). The web
// app sends only those requests here; this function forwards them and adds the
// headers the browser needs. Nothing is stored or logged.
//
// Deploy either way (same code):
//  • Supabase dashboard → Edge Functions → Deploy a new function → Via Editor →
//    name it  relay  → paste this file → Deploy.
//  • Cloudflare (works best for Safari / iPhone: no gateway in front): dash.cloudflare.com
//    → Workers & Pages → Create → Worker → Deploy → Edit code → paste this file → Deploy,
//    then put the worker's address (https://….workers.dev) in the app's relay box.
// (On Supabase it works with "Enforce JWT verification" on or off: the app signs in
// with your project's public key and sends the services' own tokens along.)
//
// Version 8: also takes one POST with a text body (?env=1) carrying the method,
// headers and body, so browsers skip the CORS pre-check (Safari / iPhone).
// Version 9 (21 Nov — the relay carried 30,000 requests a day, half of them refused):
//  • Goodreads is no longer passed on: it refuses Cloudflare's addresses, every time.
//  • Answers are kept 12 hours on Cloudflare (iTunes, Open Library, Audible's catalog,
//    Hardcover book searches…), and a service's "no" is kept an hour, so the same question
//    from many phones reaches the service once. Never anything with your accounts
//    (TorBox, Real-Debrid) or anything that changes something.
//  • One address may send at most 240 requests a minute.

// Only these services can be reached through the relay.
const ALLOWED = [
  /^api\.hardcover\.app$/,
  /^api\.audible\.[a-z.]+$/,
  /^(www\.)?getstoryshots\.com$/,
  /^itunes\.apple\.com$/,
  /^api\.torbox\.app$/,
  /^api\.real-debrid\.com$/,
  /^openlibrary\.org$/,
  /^www\.googleapis\.com$/,
  /^archive\.org$/,
  /^gutendex\.com$/,
  /^standardebooks\.org$/,
  /^librivox\.org$/,
  /^jsonkeeper\.com$/,
  /(^|\.)knaben\.(org|eu|net|cc)$/,
  /\.workers\.dev$/,
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  // "*" doesn't cover Authorization in browsers, so it's listed explicitly.
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-relay-headers, accept, user-agent',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'X-Relay-Version, Content-Type, Content-Disposition, *',
  'Access-Control-Max-Age': '86400',
  'X-Relay-Version': '9',
};

// Headers meant for Supabase or the browser, never forwarded. The service's own
// headers (e.g. a TorBox or Hardcover token) arrive JSON-encoded in x-relay-headers.
const DROP_REQUEST = ['host', 'origin', 'referer', 'cookie', 'content-length', 'connection', 'authorization', 'apikey', 'x-client-info', 'x-relay-headers', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-port', 'x-real-ip', 'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor', 'baggage', 'sb-request-id'];
const DROP_RESPONSE = ['set-cookie', 'content-encoding', 'content-length', 'transfer-encoding', 'connection'];

// ---- kept answers (Cloudflare's cache; Supabase has none, so nothing is kept there) ----
const KEEP_HOURS = [
  [/^itunes\.apple\.com$/, 12],
  [/^openlibrary\.org$/, 12],
  [/^api\.audible\.[a-z.]+$/, 12],
  [/^api\.hardcover\.app$/, 12],
  [/^www\.googleapis\.com$/, 12],
  [/^gutendex\.com$/, 12],
  [/^librivox\.org$/, 12],
  [/^standardebooks\.org$/, 12],
  [/^(www\.)?getstoryshots\.com$/, 12],
  [/(^|\.)knaben\.(org|eu|net|cc)$/, 1],
];
const shared = () => (typeof caches !== 'undefined' && caches.default) || null;
/** How long this request's answer may be kept (hours), or 0 for never. */
function keepHours(url, method, body) {
  const rule = KEEP_HOURS.find(([re]) => re.test(url.hostname));
  if (!rule) return 0;
  if (method === 'GET') return rule[1];
  // Hardcover is all POSTs: only book searches and lookups, never your shelves (me) or changes.
  if (method === 'POST' && /hardcover/.test(url.hostname)) {
    const q = String(body || '');
    return /"query"\s*:\s*"\s*query\b/.test(q) && !/\bme\s*[{(]|mutation/.test(q) ? rule[1] : 0;
  }
  return 0;
}
async function keyFor(url, method, body) {
  const bytes = new TextEncoder().encode(`${method} ${url.href} ${body || ''}`);
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
  return new Request(`https://relay-kept.local/${hash}`);
}
const refusal = (st) => st === 429 || st === 503 || (st >= 400 && st < 500 && st !== 404);

// ---- one address, at most 240 requests a minute (per Cloudflare machine; rough, but enough) ----
const seen = new Map(); // ip -> { n, from }
function tooMany(req) {
  const ip = req.headers.get('cf-connecting-ip');
  if (!ip) return false;
  const now = Date.now();
  const s = seen.get(ip);
  if (!s || now - s.from > 60e3) {
    if (seen.size > 5000) seen.clear();
    seen.set(ip, { n: 1, from: now });
    return false;
  }
  return ++s.n > 240;
}

async function handle(req, ctx) {
  if (req.method === 'OPTIONS') {
    // Echo whatever headers the browser asks to send.
    const asked = req.headers.get('access-control-request-headers');
    return new Response('ok', { headers: asked ? { ...CORS, 'Access-Control-Allow-Headers': `${CORS['Access-Control-Allow-Headers']}, ${asked}` } : CORS });
  }
  if (tooMany(req)) return new Response('Too many requests from this address — wait a minute', { status: 429, headers: { ...CORS, 'Retry-After': '60' } });
  const target = new URL(req.url).searchParams.get('url') || '';
  let url;
  try {
    url = new URL(target);
  } catch {
    return new Response('Missing or bad ?url=', { status: 400, headers: CORS });
  }
  // Podcast feeds (?feed=1): any https host, GET only, and only XML comes back.
  const feed = new URL(req.url).searchParams.get('feed') === '1';
  const privateHost = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[?::1)/i.test(url.hostname);
  if (url.protocol !== 'https:' || privateHost || (!feed && !ALLOWED.some((re) => re.test(url.hostname)))) {
    return new Response(`Host not allowed: ${url.hostname}`, { status: 403, headers: CORS });
  }
  const headers = new Headers(req.headers);
  for (const h of DROP_REQUEST) headers.delete(h);
  let method = req.method;
  let body;
  if (new URL(req.url).searchParams.get('env') === '1' && req.method === 'POST') {
    // The pre-check-free form: { method, headers, body } as text.
    headers.delete('content-type');
    try {
      const env = JSON.parse(await req.text());
      method = String(env.method || 'GET').toUpperCase();
      for (const [k, v] of Object.entries(env.headers || {})) if (typeof v === 'string') headers.set(k, v);
      if (typeof env.body === 'string' && method !== 'GET' && method !== 'HEAD') body = env.body;
    } catch {
      return new Response('Bad relay envelope', { status: 400, headers: CORS });
    }
  } else {
    try {
      const extra = JSON.parse(req.headers.get('x-relay-headers') || '{}');
      for (const [k, v] of Object.entries(extra)) if (typeof v === 'string') headers.set(k, v);
    } catch {
      // ignore malformed header bundle
    }
    body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer();
  }
  if (!headers.has('user-agent') || /deno/i.test(headers.get('user-agent') || '')) {
    headers.set('user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1');
  }
  try {
    if (feed && method !== 'GET') return new Response('Feeds are read-only', { status: 403, headers: CORS });
    const bodyText = body == null ? '' : typeof body === 'string' ? body : new TextDecoder().decode(body);
    const hours = feed ? 0 : keepHours(url, method, bodyText);
    const cache = hours ? shared() : null;
    // (Your own token is part of the key: one person's refused token never answers for another.)
    const key = cache ? await keyFor(url, method, `${bodyText} ${headers.get('authorization') || ''}`) : null;
    if (key) {
      const hit = await cache.match(key).catch(() => null);
      if (hit) {
        const out = new Headers(hit.headers);
        for (const [k, v] of Object.entries(CORS)) out.set(k, v);
        out.set('X-Relay-Cache', 'hit');
        return new Response(hit.body, { status: hit.status, headers: out });
      }
    }
    const res = await fetch(url, { method, headers, body, redirect: 'follow' });
    // Keep it: a good answer for its hours, a refusal for one hour (small text answers only).
    const type = res.headers.get('content-type') || '';
    if (key && (res.ok || refusal(res.status)) && /json|xml|text/i.test(type) && Number(res.headers.get('content-length') || 0) < 2e6) {
      const text = await res.text();
      const out = new Headers({ 'Content-Type': type, 'Cache-Control': `public, max-age=${res.ok ? hours * 3600 : 3600}` });
      if (text.length < 2e6) {
        const put = cache.put(key, new Response(text, { status: res.status, headers: out })).catch(() => {});
        if (ctx?.waitUntil) ctx.waitUntil(put);
      }
      for (const [k, v] of Object.entries(CORS)) out.set(k, v);
      out.delete('Cache-Control');
      return new Response(text, { status: res.status, headers: out });
    }
    if (feed && !/xml|rss|atom|opml/i.test(res.headers.get('content-type') || '')) {
      // Many feeds are served as text/plain or octet-stream: peek at the start.
      const head = (await res.clone().text()).slice(0, 400);
      if (!/<(\?xml|rss|feed|opml)/i.test(head)) return new Response('Not a feed', { status: 403, headers: CORS });
    }
    const out = new Headers(res.headers);
    for (const h of DROP_RESPONSE) out.delete(h);
    for (const [k, v] of Object.entries(CORS)) out.set(k, v);
    return new Response(res.body, { status: res.status, headers: out });
  } catch (e) {
    return new Response(`Relay could not reach ${url.hostname}: ${e instanceof Error ? e.message : e}`, { status: 502, headers: CORS });
  }
}

// Supabase Edge Function (Deno) …
if (typeof Deno !== 'undefined' && Deno.serve) Deno.serve((req) => handle(req));
// … or Cloudflare Worker (paste this same code into a Worker and deploy).
export default { fetch: (req, env, ctx) => handle(req, ctx) };
