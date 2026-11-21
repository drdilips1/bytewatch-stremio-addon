// Audiohub Book Hunt — one source addon for what the Android app does in its hidden browser:
// Anna's Archive and Mobilism, searched here on the server, so the iPhone (and the web app) get
// them too. Add it in the app: Settings → Addons → paste  https://<this worker>/addon.json
//
//  - Anna's Archive: its search page is read here; a book's file comes from LibGen by the same MD5
//    (most of Anna's books are LibGen's files), or from Anna's fast download with your membership
//    key (secret ANNAS_KEY). Mirrors tried in turn; set ANNAS_BASE to prefer one.
//  - Mobilism: signs in with your forum account (secrets MOBILISM_USER and MOBILISM_PASS — set them
//    yourself in Cloudflare: Workers → this worker → Settings → Variables → Encrypt), searches the
//    forum and reads each topic's file-host links (Rapidgator, Nitroflare…), which the app sends to
//    your Real-Debrid / TorBox as it does with Mobilism on Android.
//
// Both sites put a bot check in front of their pages. When it stops this server, the search says
// so in "errors" and the app shows the other sources as usual. Nothing is stored or logged.
//
// Deploy: Workers & Pages → Create → Worker (e.g. "bookhunt") → Edit code → paste this file →
// Deploy. Then set the secrets above (optional: without them, Mobilism is skipped).

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
};
const UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
const clean = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const challenged = (status, html) => status === 403 || status === 503 || /just a moment|cf-chl|challenge-platform|ddos-guard|checking your browser/i.test(html || "");

async function get(url, init = {}, ms = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, headers: { "User-Agent": UA, Accept: "text/html,application/json;q=0.9,*/*;q=0.8", ...(init.headers || {}) }, signal: ctl.signal, redirect: init.redirect || "follow" });
  } finally {
    clearTimeout(t);
  }
}

// ---------------- the addon file ----------------
function manifest(origin) {
  return {
    schemaVersion: "1.0.0",
    id: "audiohub-bookhunt",
    name: "Book Hunt (Anna's Archive · Mobilism)",
    version: "1.0.0",
    description: "Anna's Archive and Mobilism, searched by your own server — works on iPhone and the web app too",
    icon: "https://annas-archive.org/favicon.ico",
    provides: ["source"],
    rateLimit: { requestsPerMinute: 10, retryAfterMs: 6000 },
    matching: { algorithm: "fuzzy", threshold: 0.4 },
    adapters: {
      source: {
        request: { method: "GET", url: `${origin}/search?q={QUERY}`, timeout: 40000, headers: { Accept: "application/json" } },
        response: {
          type: "json",
          resultsPath: "results",
          mapping: { title: "title", author: "author", narrator: "narrator", url: "url", format: "format", language: "language", sizeBytes: "sizeBytes", cover: "cover", description: "description", downloads: "downloads" },
        },
      },
    },
  };
}

// ---------------- Anna's Archive ----------------
const ANNAS = ["https://annas-archive.org", "https://annas-archive.li", "https://annas-archive.se", "https://annas-archive.pk"];
const FORMATS = /\b(epub|pdf|mobi|azw3|fb2|djvu|cbz|cbr|txt)\b/i;
const SIZE = /(\d+(?:[.,]\d+)?)\s*(KB|MB|GB)\b/i;
const toBytes = (m) => (m ? Math.round(parseFloat(m[1].replace(",", ".")) * { KB: 1024, MB: 1048576, GB: 1073741824 }[m[2].toUpperCase()]) : 0);

/** Anna's search page → [{ md5, title, author, format, sizeBytes, language, cover }]. */
export function annasResults(html, base) {
  const page = String(html || "").replace(/<!--|-->/g, "");
  const parts = page.split(/(?=<a[^>]+href="\/md5\/[a-f0-9]{32}")/i).slice(1);
  const seen = new Map();
  for (const part of parts) {
    const md5 = /href="\/md5\/([a-f0-9]{32})"/i.exec(part)?.[1]?.toLowerCase();
    if (!md5) continue;
    const box = part.slice(0, 6000);
    const title = clean(/<h3[^>]*>([\s\S]*?)<\/h3>/i.exec(box)?.[1] || /<div[^>]*font-bold[^>]*>([\s\S]*?)<\/div>/i.exec(box)?.[1] || "");
    const author = clean(/<div[^>]*italic[^>]*>([\s\S]*?)<\/div>/i.exec(box)?.[1] || /user-edit[^>]*><\/span>\s*([^<]+)/i.exec(box)?.[1] || "");
    const facts = clean(/<div[^>]*text-gray-500[^>]*>([\s\S]*?)<\/div>/i.exec(box)?.[1] || box);
    const format = (FORMATS.exec(facts)?.[1] || "").toUpperCase();
    const cover = /<img[^>]+src="([^"]+)"/i.exec(box)?.[1] || "";
    const prev = seen.get(md5);
    if (prev && prev.title) continue;
    if (!title || !format) continue;
    seen.set(md5, { md5, title: title.slice(0, 300), author: author.slice(0, 150), format, sizeBytes: toBytes(SIZE.exec(facts)), language: /\[([a-z]{2,3})\]/.exec(facts)?.[1] || "", cover: cover ? new URL(cover, base + "/").href : "" });
  }
  return [...seen.values()].slice(0, 30);
}

async function annasSearch(q, env, origin) {
  const bases = [env.ANNAS_BASE, ...ANNAS].filter(Boolean);
  let why = "";
  for (const base of [...new Set(bases)]) {
    const r = await get(`${base}/search?q=${encodeURIComponent(q)}`, {}, 15000).catch((e) => ({ status: 0, text: async () => String(e) }));
    const html = await r.text();
    if (challenged(r.status, html)) {
      why = `Anna's Archive's bot check stopped the server (${base.replace("https://", "")})`;
      continue;
    }
    if (r.status >= 400 || !r.status) {
      why = `Anna's Archive answered HTTP ${r.status} (${base.replace("https://", "")})`;
      continue;
    }
    return annasResults(html, base).map((x) => ({
      title: x.title,
      author: x.author,
      format: x.format,
      language: x.language,
      sizeBytes: x.sizeBytes,
      cover: x.cover,
      url: `${origin}/file?md5=${x.md5}&name=${encodeURIComponent(`${x.title}${x.author ? ` - ${x.author}` : ""}`.slice(0, 120))}&ext=${x.format.toLowerCase()}`,
      description: "Anna's Archive",
    }));
  }
  throw new Error(why || "Anna's Archive didn't answer");
}

// ---------------- a book's file, by its MD5 ----------------
const LIBGEN = ["https://libgen.li", "https://libgen.gl", "https://libgen.vg", "https://libgen.la", "https://libgen.bz", "https://libgen.gs"];

async function fileByMd5(md5, env) {
  // Your Anna's membership: its fast download.
  if (env.ANNAS_KEY) {
    for (const base of [env.ANNAS_BASE, ...ANNAS].filter(Boolean)) {
      const r = await get(`${base}/dyn/api/fast_download.json?md5=${md5}&key=${encodeURIComponent(env.ANNAS_KEY)}`, { headers: { Accept: "application/json" } }).catch(() => null);
      const j = r ? await r.json().catch(() => null) : null;
      if (j?.download_url) return j.download_url;
    }
  }
  // LibGen's copy (same MD5): ads.php → its keyed get.php link.
  for (const m of LIBGEN) {
    const r = await get(`${m}/ads.php?md5=${md5}`, {}, 12000).catch(() => null);
    if (!r || r.status >= 400) continue;
    const html = await r.text();
    const href = /href="([^"]*get\.php\?[^"]*md5=[^"]*key=[^"]*)"/i.exec(html)?.[1];
    if (href) return new URL(href.replace(/&amp;/g, "&"), m + "/").href;
  }
  return "";
}

async function file(url, env) {
  const md5 = /^[a-f0-9]{32}$/i.test(url.searchParams.get("md5") || "") ? url.searchParams.get("md5").toLowerCase() : "";
  if (!md5) return reply({ error: "No book" }, 400);
  const link = await fileByMd5(md5, env);
  if (!link) return reply({ error: "No mirror has this book right now — try again later" }, 502);
  const up = await get(link, {}, 120000);
  if (!up.ok) return reply({ error: `The mirror answered HTTP ${up.status}` }, 502);
  const ext = (url.searchParams.get("ext") || "epub").replace(/[^a-z0-9]/gi, "");
  const name = `${(url.searchParams.get("name") || "book").replace(/[\\/:*?"<>|]+/g, " ").trim()}.${ext}`;
  const h = new Headers({ "Access-Control-Allow-Origin": "*", "Content-Type": up.headers.get("Content-Type") || "application/octet-stream", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}` });
  if (up.headers.get("Content-Length")) h.set("Content-Length", up.headers.get("Content-Length"));
  return new Response(up.body, { status: 200, headers: h });
}

// ---------------- Mobilism ----------------
const MOB = "https://forum.mobilism.org";
let mobCookies = ""; // the forum session (kept while this worker copy runs)
let mobAt = 0;

function cookiesOf(res, prev = "") {
  const jar = new Map(prev.split(/;\s*/).filter(Boolean).map((c) => [c.split("=")[0], c]));
  const all = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : (res.headers.get("set-cookie") || "").split(/,(?=\s*[A-Za-z0-9_]+=)/);
  for (const c of all) {
    const kv = c.split(";")[0].trim();
    if (kv.includes("=")) jar.set(kv.split("=")[0], kv);
  }
  return [...jar.values()].join("; ");
}

async function mobSignIn(env) {
  if (mobCookies && Date.now() - mobAt < 6 * 3600e3) return mobCookies;
  const form = await get(`${MOB}/ucp.php?mode=login`);
  let jar = cookiesOf(form);
  const html = await form.text();
  if (challenged(form.status, html)) throw new Error("Mobilism's bot check stopped the server");
  const hidden = (n) => new RegExp(`name="${n}"\\s+value="([^"]*)"`, "i").exec(html)?.[1] || "";
  const body = new URLSearchParams({ username: env.MOBILISM_USER, password: env.MOBILISM_PASS, autologin: "on", login: "Login", redirect: "index.php", sid: hidden("sid"), form_token: hidden("form_token"), creation_time: hidden("creation_time") });
  await sleep(1200); // phpBB refuses a form sent too fast after it was shown
  const res = await get(`${MOB}/ucp.php?mode=login`, { method: "POST", body, redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: jar, Referer: `${MOB}/ucp.php?mode=login` } });
  jar = cookiesOf(res, jar);
  const check = await get(`${MOB}/index.php`, { headers: { Cookie: jar } });
  jar = cookiesOf(check, jar);
  if (!/mode=logout/.test(await check.text())) throw new Error("Mobilism didn't accept the sign-in (check MOBILISM_USER / MOBILISM_PASS)");
  mobCookies = jar;
  mobAt = Date.now();
  return jar;
}

const AUDIO = /\b(mp3|m4b|m4a|aac|audiobook|unabridged|narrated|read by)\b/i;
/** A search results page → [{ id, title }]. */
export function mobTopics(html) {
  const out = [];
  const seen = new Set();
  for (const m of String(html || "").matchAll(/<a[^>]+href="[^"]*viewtopic\.php\?[^"]*?t=(\d+)[^"]*"[^>]*class="topictitle"[^>]*>([\s\S]*?)<\/a>/gi)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ id: m[1], title: clean(m[2]) });
  }
  return out;
}
/** A topic page → its file-host links [{ host, url }] and the first post's text. */
export function mobTopic(html) {
  const post = /<div class="content">([\s\S]*?)<\/div>\s*(?:<div|<dl)/i.exec(html)?.[1] || html;
  const downloads = [];
  for (const m of post.matchAll(/<a[^>]+class="postlink"[^>]*href="([^"]+)"|<a[^>]+href="([^"]+)"[^>]*class="postlink"/gi)) {
    const u = (m[1] || m[2] || "").replace(/&amp;/g, "&");
    if (!/^https?:/i.test(u) || u.startsWith(MOB)) continue;
    try {
      downloads.push({ url: u, host: new URL(u).hostname.replace(/^www\./, "") });
    } catch {}
  }
  return { downloads, text: clean(post).slice(0, 600) };
}

async function mobilismSearch(q, env) {
  if (!env.MOBILISM_USER || !env.MOBILISM_PASS) return [];
  const jar = await mobSignIn(env);
  const r = await get(`${MOB}/search.php?keywords=${encodeURIComponent(q)}&sc=1&sr=topics&sf=titleonly`, { headers: { Cookie: jar } }, 25000);
  const html = await r.text();
  if (challenged(r.status, html)) throw new Error("Mobilism's bot check stopped the server");
  if (r.status >= 400) throw new Error(`Mobilism answered HTTP ${r.status}`);
  const out = [];
  for (const t of mobTopics(html).slice(0, 5)) {
    await sleep(700); // Mobilism answers 429 to bursts
    const p = await get(`${MOB}/viewtopic.php?t=${t.id}`, { headers: { Cookie: jar } }).catch(() => null);
    if (!p || p.status >= 400) continue;
    const { downloads, text } = mobTopic(await p.text());
    if (!downloads.length) continue;
    const fmt = (/\b(m4b|m4a|mp3|epub|pdf|mobi|azw3)\b/i.exec(`${t.title} ${text}`)?.[1] || "").toUpperCase();
    out.push({
      title: t.title,
      author: clean(/ by ([^\[(|]{2,40})/i.exec(t.title)?.[1] || ""),
      narrator: clean(/(?:narrated by|read by)\s*[:\-–]?\s*([^\n|]{2,50}?)(?:\s{2,}|format|genre|length|\||$)/i.exec(text)?.[1] || ""),
      format: fmt,
      sizeBytes: toBytes(SIZE.exec(text)),
      url: `${MOB}/viewtopic.php?t=${t.id}`,
      description: `Mobilism${AUDIO.test(`${t.title} ${text}`) ? " · audiobook" : ""}`,
      downloads,
    });
  }
  return out;
}

// ---------------- both, at once ----------------
async function search(url, env) {
  const q = clean(url.searchParams.get("q") || "");
  if (!q) return reply({ results: [] });
  const errors = {};
  const within = (p, ms, name) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${name} took too long`)), ms))]);
  const [aa, mob] = await Promise.all([
    within(annasSearch(q, env, url.origin), 25000, "Anna's Archive").catch((e) => ((errors.annas = e.message), [])),
    within(mobilismSearch(q, env), 35000, "Mobilism").catch((e) => ((errors.mobilism = e.message), [])),
  ]);
  return reply({ results: [...mob, ...aa], errors });
}

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: JSON_HEADERS });
    try {
      if (url.pathname === "/addon.json" || url.pathname === "/") return reply(manifest(url.origin));
      if (url.pathname === "/search") return await search(url, env);
      if (url.pathname === "/file") return await file(url, env);
      if (url.pathname === "/health") return reply({ ok: true, annas: true, mobilism: !!(env.MOBILISM_USER && env.MOBILISM_PASS), annasKey: !!env.ANNAS_KEY });
      return reply({ error: "Not found" }, 404);
    } catch (e) {
      return reply({ error: String(e?.message || e) }, 500);
    }
  },
};
