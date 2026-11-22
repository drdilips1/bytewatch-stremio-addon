// Easynews relay — a small Cloudflare Worker for networks that block Easynews (some Indian
// providers do, and Private DNS doesn't get round it). The app sends its Easynews searches and
// streams here; this worker passes them to Easynews and the answer back, so your provider only
// sees Cloudflare.
//
// Only Easynews' own addresses are passed on (anything else is refused), with the sign-in the app
// sends (your Easynews username and password, as Easynews asks for them). Nothing is stored or logged.
//
// Keep it in its own worker (not with your other workers): every book streams through it, and if
// Cloudflare ever limits it for the traffic, nothing else is affected.
//
// Deploy: dash.cloudflare.com → Workers & Pages → Create → Hello World → name it (e.g.
// easynews-relay) → Deploy → Edit code → replace everything with this file → Deploy.
// Then in the app: Settings → Usenet → Easynews → "Reach Easynews through" → paste
// https://easynews-relay.<your-account>.workers.dev and tap Check.
//
// Routes:
//   /health            { ok: true } (the app's Check)
//   /fetch?url=…       GET / HEAD of an Easynews address, with Range for seeking

const EASYNEWS = /(^|\.)easynews\.com$/i;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Range, Accept, Content-Type",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, Content-Type, Content-Disposition",
  "Access-Control-Max-Age": "86400",
};
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS } });

/** Only https Easynews addresses are passed on. */
export function allowed(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && EASYNEWS.test(u.hostname) ? u : null;
  } catch {
    return null;
  }
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/health") return reply({ ok: true, name: "Easynews relay" });
    if (url.pathname !== "/fetch") return reply({ error: "Not found" }, 404);
    if (request.method !== "GET" && request.method !== "HEAD") return reply({ error: "Only reading is passed on" }, 405);
    let target = allowed(url.searchParams.get("url") || "");
    if (!target) return reply({ error: "Only Easynews addresses are passed on" }, 403);

    const headers = { "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36" };
    for (const h of ["Authorization", "Range", "Accept"]) {
      const v = request.headers.get(h);
      if (v) headers[h] = v;
    }
    // Easynews sends downloads on to its file servers: followed here, keeping the sign-in, but
    // only while they stay on Easynews' own addresses.
    let up;
    for (let hop = 0; hop < 5; hop++) {
      up = await fetch(target.href, { method: request.method, headers, redirect: "manual" });
      const to = up.status >= 300 && up.status < 400 ? up.headers.get("Location") : "";
      if (!to) break;
      const next = allowed(new URL(to, target).href);
      if (!next) return reply({ error: "Easynews sent the download somewhere else" }, 502);
      target = next;
    }
    const out = new Headers(CORS);
    for (const h of ["Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "Content-Disposition", "Last-Modified", "ETag"]) {
      const v = up.headers.get(h);
      if (v) out.set(h, v);
    }
    // Your sign-in being refused is passed on as it is, so the app can say so.
    return new Response(request.method === "HEAD" ? null : up.body, { status: up.status, headers: out });
  },
};
