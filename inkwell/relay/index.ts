// Kathava web relay — a Supabase Edge Function named "relay".
//
// Browsers (Safari on iPhone / iPad) block requests to services that don't
// allow cross-site calls (Hardcover, Audible, Goodreads, StoryShots, …). The web
// app sends only those requests here; this function forwards them and adds the
// headers the browser needs. Nothing is stored or logged.
//
// Deploy: Supabase dashboard → Edge Functions → Deploy a new function → Via
// Editor → name it  relay  → paste this file → Deploy. (Works with "Enforce JWT
// verification" on or off: the app signs in with your project's public key and
// sends the services' own tokens in x-relay-headers.)
//
// Version 7.

// Only these services can be reached through the relay.
const ALLOWED = [
  /^api\.hardcover\.app$/,
  /^thunder\.api\.overdrive\.com$/,
  /^sentry\.libbyapp\.com$/,
  /^sentry-read\.svc\.overdrive\.com$/,
  /^api\.audible\.[a-z.]+$/,
  /^www\.goodreads\.com$/,
  /^(www\.)?getstoryshots\.com$/,
  /^www\.blinkist\.com$/,
  /^itunes\.apple\.com$/,
  /^api\.torbox\.app$/,
  /^api\.real-debrid\.com$/,
  /^openlibrary\.org$/,
  /^www\.googleapis\.com$/,
  /^archive\.org$/,
  /^gutendex\.com$/,
  /^librivox\.org$/,
  /^jsonkeeper\.com$/,
  /(^|\.)knaben\.(org|eu|net|cc)$/,
  /\.workers\.dev$/,
];

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  // "*" doesn't cover Authorization in browsers, so it's listed explicitly.
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-relay-headers, accept, user-agent',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': '*',
  'Access-Control-Max-Age': '86400',
  'X-Relay-Version': '7',
};

// Headers meant for Supabase or the browser, never forwarded. The service's own
// headers (e.g. a TorBox or Hardcover token) arrive JSON-encoded in x-relay-headers.
const DROP_REQUEST = ['host', 'origin', 'referer', 'cookie', 'content-length', 'connection', 'authorization', 'apikey', 'x-client-info', 'x-relay-headers', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-port', 'x-real-ip', 'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor', 'baggage', 'sb-request-id'];
const DROP_RESPONSE = ['set-cookie', 'content-encoding', 'content-length', 'transfer-encoding', 'connection'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    // Echo whatever headers the browser asks to send.
    const asked = req.headers.get('access-control-request-headers');
    return new Response('ok', { headers: asked ? { ...CORS, 'Access-Control-Allow-Headers': `${CORS['Access-Control-Allow-Headers']}, ${asked}` } : CORS });
  }
  const target = new URL(req.url).searchParams.get('url') || '';
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return new Response('Missing or bad ?url=', { status: 400, headers: CORS });
  }
  // Podcast feeds (?feed=1): any https host, GET only, and only XML comes back.
  const feed = new URL(req.url).searchParams.get('feed') === '1' && req.method === 'GET';
  const privateHost = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[?::1)/i.test(url.hostname);
  if (url.protocol !== 'https:' || privateHost || (!feed && !ALLOWED.some((re) => re.test(url.hostname)))) {
    return new Response(`Host not allowed: ${url.hostname}`, { status: 403, headers: CORS });
  }
  const headers = new Headers(req.headers);
  for (const h of DROP_REQUEST) headers.delete(h);
  try {
    const extra = JSON.parse(req.headers.get('x-relay-headers') || '{}');
    for (const [k, v] of Object.entries(extra)) if (typeof v === 'string') headers.set(k, v);
  } catch {
    // ignore malformed header bundle
  }
  if (!headers.has('user-agent') || /deno/i.test(headers.get('user-agent') || '')) {
    headers.set('user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1');
  }
  try {
    const res = await fetch(url, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer(),
      redirect: 'follow',
    });
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
});
