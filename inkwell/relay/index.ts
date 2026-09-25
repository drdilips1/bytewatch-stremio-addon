// श्रवणीय web relay — a Supabase Edge Function named "relay".
//
// Browsers (Safari on iPhone / iPad) block requests to services that don't
// allow cross-site calls (Hardcover, Audible, Goodreads, StoryShots, …). The web
// app sends only those requests here; this function forwards them and adds the
// headers the browser needs. Nothing is stored or logged.
//
// Deploy: Supabase dashboard → Edge Functions → Deploy a new function → Via
// Editor → name it  relay  → paste this file → Deploy. Then open the function's
// Details and turn OFF "Enforce JWT verification" (the services' own tokens
// travel in the Authorization header).

// Only these services can be reached through the relay.
const ALLOWED = [
  /^api\.hardcover\.app$/,
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
  /\.workers\.dev$/,
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

const DROP_REQUEST = ['host', 'origin', 'referer', 'cookie', 'content-length', 'connection', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip', 'cf-connecting-ip', 'x-client-info', 'apikey'];
const DROP_RESPONSE = ['set-cookie', 'content-encoding', 'content-length', 'transfer-encoding', 'connection'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const target = new URL(req.url).searchParams.get('url') || '';
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return new Response('Missing or bad ?url=', { status: 400, headers: CORS });
  }
  if (url.protocol !== 'https:' || !ALLOWED.some((re) => re.test(url.hostname))) {
    return new Response('Host not allowed', { status: 403, headers: CORS });
  }
  const headers = new Headers(req.headers);
  for (const h of DROP_REQUEST) headers.delete(h);
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
    const out = new Headers(res.headers);
    for (const h of DROP_RESPONSE) out.delete(h);
    for (const [k, v] of Object.entries(CORS)) out.set(k, v);
    return new Response(res.body, { status: res.status, headers: out });
  } catch (e) {
    return new Response(`Relay could not reach ${url.hostname}: ${e instanceof Error ? e.message : e}`, { status: 502, headers: CORS });
  }
});
