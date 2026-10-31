// Audiohub Sources — the Cloudflare Worker behind api.audiohubapp.com.
//
// One address for the app's source addons: Bookracy (ebooks), Knaben (audiobooks and
// ebooks) and AudiobookBay. Requests are passed on to the services; links in the answers
// are rewritten to this worker's own address, because some networks block *.workers.dev.
// AudiobookBay goes through the InkShelf proxy first and, if that refuses or finds
// nothing, is searched directly here.
//
// Deploy: Workers & Pages → audiohub → Edit code → replace everything with this file → Deploy.
// Addon links to share: https://api.audiohubapp.com/addons/<name>.json (listed at /health).

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept"
};

const BOOKRACY = "https://bookracy-proxy.drdilipgreat.workers.dev";
const ABB_PROXY = "https://inkshelf-debrid-proxy.tbm-a.workers.dev";

// Addon files, installed by pasting https://api.audiohubapp.com/addons/<name>.json in Audiohub.
const ADDONS = {
  "audiobookbay": {
    "schemaVersion": "1.0.0",
    "id": "my-audiobookbay",
    "name": "AudiobookBay",
    "version": "1.0.0",
    "description": "Audiobook search via my Audiohub Worker",
    "icon": "https://audiobookbay.lu/apple-touch-icon.png",
    "provides": [
      "source"
    ],
    "contentType": "audiobook",
    "rateLimit": {
      "requestsPerMinute": 10,
      "retryAfterMs": 6000
    },
    "matching": {
      "algorithm": "fuzzy",
      "threshold": 0.4
    },
    "adapters": {
      "source": {
        "cacheNotifyUrl": "https://api.audiohubapp.com/abb/api/debrid-notify",
        "request": {
          "method": "POST",
          "url": "https://api.audiohubapp.com/abb/api/search",
          "timeout": 30000,
          "headers": {
            "Accept": "application/json",
            "Content-Type": "application/json"
          },
          "body": {
            "title": "{TITLE}",
            "author": "{AUTHOR}",
            "limit": 20
          }
        },
        "response": {
          "type": "json",
          "resultsPath": "results",
          "mapping": {
            "title": "title",
            "author": "author",
            "narrator": "narrator",
            "magnetUrl": "magnetUrl",
            "infoHash": "infoHash",
            "sizeBytes": "sizeBytes",
            "seeders": "seeders",
            "format": "format",
            "language": "language",
            "date": "posted",
            "debridCache": "debridCache"
          }
        }
      }
    }
  },
  "knaben-audiobooks": {
    "schemaVersion": "1.0.0",
    "id": "my-knaben-audiobooks",
    "name": "Knaben AudioBooks",
    "version": "1.0.0",
    "description": "Audiobook torrent search via my Audiohub Worker",
    "icon": "https://knaben.org/favicon.ico",
    "provides": [
      "source"
    ],
    "contentType": "audiobook",
    "matching": {
      "algorithm": "fuzzy",
      "threshold": 0.6
    },
    "adapters": {
      "source": {
        "request": {
          "method": "POST",
          "url": "https://api.audiohubapp.com/knaben/audiobooks",
          "headers": {
            "Content-Type": "application/json"
          },
          "body": {
            "query": "{TITLE}",
            "search_field": "title",
            "size": 50,
            "categories": [
              1003000
            ]
          }
        },
        "response": {
          "type": "json",
          "resultsPath": "hits",
          "mapping": {
            "title": "title",
            "magnetUrl": "magnetUrl",
            "sizeBytes": "bytes",
            "seeders": "seeders",
            "infoHash": "hash"
          }
        }
      }
    }
  },
  "knaben-ebooks": {
    "schemaVersion": "1.0.0",
    "id": "my-knaben-ebooks",
    "name": "Knaben Ebooks",
    "version": "1.0.0",
    "description": "Ebook torrent search via my Audiohub Worker",
    "icon": "https://knaben.org/favicon.ico",
    "provides": [
      "source"
    ],
    "contentType": "ebook",
    "matching": {
      "algorithm": "fuzzy",
      "threshold": 0.6
    },
    "adapters": {
      "source": {
        "request": {
          "method": "POST",
          "url": "https://api.audiohubapp.com/knaben/ebooks",
          "headers": {
            "Content-Type": "application/json"
          },
          "body": {
            "query": "{TITLE}",
            "search_field": "title",
            "size": 50,
            "categories": [
              9001000,
              9000000,
              10000000
            ]
          }
        },
        "response": {
          "type": "json",
          "resultsPath": "hits",
          "mapping": {
            "title": "title",
            "magnetUrl": "magnetUrl",
            "sizeBytes": "bytes",
            "seeders": "seeders",
            "infoHash": "hash"
          }
        }
      }
    }
  }
};

function reply(body, status = 200) {
  return new Response(body, { status, headers: HEADERS });
}

async function proxy(url, request, method = request.method) {
  const headers = new Headers();
  headers.set("Accept", "application/json");

  const contentType = request.headers.get("Content-Type");
  if (contentType) headers.set("Content-Type", contentType);

  const init = { method, headers };

  if (method !== "GET" && method !== "HEAD") {
    init.body = await request.text();
  }

  const upstream = await fetch(url, init);
  return reply(await upstream.text(), upstream.status);
}

// ---- AudiobookBay, searched directly (used when the InkShelf proxy fails) ----------
const ABB_MIRRORS = ["audiobookbay.lu", "audiobookbay.is", "theaudiobookbay.se", "audiobookbay.fi"];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.demonii.com:1337/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://open.stealth.si:80/announce"
];

const decode = (s) =>
  String(s || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function toBytes(num, unit) {
  const n = parseFloat(String(num).replace(",", "."));
  if (!n) return 0;
  const u = String(unit || "").toUpperCase();
  const pow = u.startsWith("K") ? 1 : u.startsWith("M") ? 2 : u.startsWith("G") ? 3 : u.startsWith("T") ? 4 : 0;
  return Math.round(n * 1024 ** pow);
}

const page = (url) => fetch(url, { headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "en-US,en;q=0.9" } });

// Words of a title, for matching ("The Project Hail Mary!" → project, hail, mary).
const words = (t) => String(t || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 1 && !["the", "a", "an", "of", "and"].includes(w));

async function abbDirect(title, author, limit = 12) {
  // AudiobookBay's search gets confused by author names: search the title, then keep
  // only results that carry most of its words.
  const q = String(title || author || "").trim().toLowerCase();
  const want = words(q);
  const fits = (name) => !want.length || want.filter((w) => words(name).includes(w)).length / want.length >= 0.6;
  let host = "", html = "";
  for (const h of ABB_MIRRORS) {
    try {
      // tt=1: search titles only (the plain search returns collections and near misses).
      const r = await page(`https://${h}/?s=${encodeURIComponent(q).replace(/%20/g, "+")}&tt=1`);
      const t = await r.text();
      if (r.ok && /class="post"|postTitle|Nothing Found|No results/i.test(t)) {
        host = new URL(r.url).host;
        html = t;
        break;
      }
    } catch {}
  }
  if (!html) return [];
  const found = html
    .split(/<div class="post"[^>]*>/)
    .slice(1)
    .map((p) => {
      const a = /class="postTitle"[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(p);
      if (!a) return null;
      // "Language: English … Posted: 17 Aug 2024 Format: M4B / Bitrate: ? File Size: 153.12 MBs"
      const info = decode(p);
      const size = /File Size:\s*([\d.,]+)\s*([KMGT]?B)s?/i.exec(info);
      const name = decode(a[2]);
      return {
        title: name,
        author: (/\s-\s([^-]+)$/.exec(name) || [])[1] || "",
        pageUrl: new URL(a[1], `https://${host}/`).href,
        format: (/Format:\s*([^\s/]+)/i.exec(info) || [])[1] || "",
        sizeBytes: size ? toBytes(size[1], size[2]) : 0,
        posted: (/Posted:\s*([0-9]{1,2} [A-Za-z]{3} [0-9]{4})/i.exec(info) || [])[1] || "",
        language: (/Language:\s*([A-Z][a-z]+)/.exec(info) || [])[1] || ""
      };
    })
    .filter((x) => x && fits(x.title))
    .slice(0, limit);
  // Each result's own page has its info hash.
  const withHash = await Promise.all(
    found.map(async (item) => {
      try {
        const t = await (await page(item.pageUrl)).text();
        const hash = (/Info Hash:?\s*<\/td>\s*<td[^>]*>\s*([0-9a-f]{40})/i.exec(t) || /\b([0-9a-f]{40})\b/i.exec(t.split("Info Hash")[1] || "") || [])[1];
        if (!hash) return null;
        const infoHash = hash.toLowerCase();
        const tr = TRACKERS.map((x) => `&tr=${encodeURIComponent(x)}`).join("");
        return { ...item, infoHash, magnetUrl: `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(item.title)}${tr}` };
      } catch {
        return null;
      }
    })
  );
  return withHash.filter(Boolean);
}

async function abbSearch(request) {
  const body = await request.text();
  let params = {};
  try {
    params = JSON.parse(body || "{}");
  } catch {}
  // The InkShelf proxy first (it also knows seeders)…
  try {
    const r = await fetch(`${ABB_PROXY}/abb/api/search`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body
    });
    if (r.ok) {
      const text = await r.text();
      const j = JSON.parse(text);
      if (Array.isArray(j.results) && j.results.length) return reply(text);
    }
  } catch {}
  // …and AudiobookBay itself when that refuses or finds nothing.
  const results = await abbDirect(params.title || params.query || "", params.author || "", Math.min(Number(params.limit) || 12, 15));
  return reply(JSON.stringify({ success: true, source: "audiobookbay-direct", results }));
}


// ---- Shared quotes: /q/<data> — a page anyone can read, with "Open in Audiohub" ----
// <data> is the quote itself (base64url JSON, made by the app); nothing is stored.
const esc = (v) => String(v || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtAt = (s) => {
  s = Math.max(0, Math.round(Number(s) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
};
function readQuote(data) {
  try {
    const b = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
    const d = JSON.parse(new TextDecoder().decode(Uint8Array.from(b, (c) => c.charCodeAt(0))));
    return d && d.t && d.q ? d : null;
  } catch {
    return null;
  }
}
function quotePage(data, origin, d = readQuote(data)) {
  if (!d) return new Response("This shared quote link is broken or has expired.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const audio = d.k !== "e";
  const at = audio && d.g != null ? fmtAt(d.g) : "";
  const where = audio ? (at ? `audiobook at ${at}` : "audiobook") : "ebook";
  const app = `audiohub://q/${data}`;
  const intent = `intent://q/${data}#Intent;scheme=audiohub;package=app.inkwell.books;end`;
  const short = d.q.length > 140 ? d.q.slice(0, 137).replace(/\s+\S*$/, "") + "…" : d.q;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>“${esc(short)}” — ${esc(d.t)}</title>
<meta property="og:title" content="“${esc(short)}”">
<meta property="og:description" content="${esc(d.t)}${d.a ? " — " + esc(d.a) : ""} · ${esc(where)} · shared from Audiohub">
${d.c ? `<meta property="og:image" content="${esc(d.c)}">` : ""}
<meta name="twitter:card" content="summary">
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;600;800&family=Fraunces:opsz,wght@9..144,500&display=swap" rel="stylesheet">
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(120% 70% at 85% 0%,#4a1d10 0%,#140d09 55%,#0c0a08 100%);color:#f3ede4;font-family:Figtree,system-ui,sans-serif;display:flex;justify-content:center}
main{width:100%;max-width:520px;padding:28px 18px 40px}
.top{display:flex;align-items:center;gap:8px;font-weight:800;color:#f7b267;margin-bottom:20px}
.card{background:rgba(27,24,19,.85);border:1px solid #2f281f;border-radius:24px;padding:26px 22px}
.q{font-family:Fraunces,Georgia,serif;font-weight:500;font-size:22px;line-height:1.45;color:#fff3e6;margin:0}
.note{margin:14px 0 0;padding-left:12px;border-left:3px solid #f7931e;color:#d9c3ae;font-size:15px;line-height:1.5}
.book{display:flex;gap:14px;align-items:center;margin:20px 4px}
.book img{width:64px;height:64px;border-radius:12px;object-fit:cover;box-shadow:0 8px 20px rgba(0,0,0,.5)}
.book b{display:block;font-size:17px}.book small{color:#a59c8d}
.btn{display:flex;justify-content:center;align-items:center;gap:8px;height:54px;border-radius:16px;font-weight:800;font-size:16px;text-decoration:none;margin-top:10px;border:0;width:100%;cursor:pointer;font-family:inherit}
.p{background:linear-gradient(135deg,#f7991c,#ff7a00);color:#1d1000}.s{background:#25211a;color:#f3ede4}
.fine{font-size:13px;color:#857b6c;text-align:center;margin-top:18px;line-height:1.6}.fine a{color:#f7b267}
</style></head><body><main>
<div class="top">◭ Audiohub · shared quote</div>
<div class="card"><p class="q">“${esc(d.q)}”</p>${d.n ? `<p class="note">${esc(d.n)}</p>` : ""}</div>
<div class="book">${d.c ? `<img src="${esc(d.c)}" alt="">` : ""}<div><b>${esc(d.t)}</b><small>${esc(d.a)}${d.a ? " · " : ""}${esc(where)}</small></div></div>
<a class="btn p" id="open" href="${esc(app)}">▶ Open in Audiohub</a>
<button class="btn s" onclick="document.getElementById('open').style.display='none';this.style.display='none'">Just read it</button>
<p class="fine">Opens the book in Audiohub at this ${audio ? "moment" : "passage"}.<br>Don't have Audiohub? <a href="https://github.com/drdilips1/Audiohub">Get it free</a></p>
</main><script>if(/Android/i.test(navigator.userAgent))document.getElementById('open').href=${JSON.stringify(intent)};</script></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=86400" } });
}

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: HEADERS });
    }

    try {
      // Bookracy ebook search: download links point back here, not at workers.dev
      if (path === "/bookracy/search" && request.method === "GET") {
        const target = new URL(`${BOOKRACY}/bookracy/search`);
        target.search = url.search;
        const upstream = await fetch(target.toString(), { headers: { Accept: "application/json" } });
        const text = (await upstream.text()).split(BOOKRACY).join(url.origin);
        return reply(text, upstream.status);
      }

      // Bookracy downloads (the file itself, passed through)
      if (path === "/bookracy/download" && request.method === "GET") {
        const target = new URL(`${BOOKRACY}/bookracy/download`);
        target.search = url.search;
        const upstream = await fetch(target.toString(), { redirect: "follow" });
        const headers = new Headers(upstream.headers);
        headers.set("Access-Control-Allow-Origin", "*");
        return new Response(upstream.body, { status: upstream.status, headers });
      }

      // Bookracy debrid cache notifications
      if (path === "/bookracy/notify" && request.method === "POST") {
        return await proxy(`${BOOKRACY}/bookracy/notify`, request, "POST");
      }

      // Knaben audiobook and ebook search
      if (
        (path === "/knaben/audiobooks" || path === "/knaben/ebooks") &&
        request.method === "POST"
      ) {
        return await proxy("https://api.knaben.org/v1", request, "POST");
      }

      // AudiobookBay search
      if (path === "/abb/api/search" && request.method === "POST") {
        return await abbSearch(request);
      }

      // AudiobookBay debrid cache notifications
      if (path === "/abb/api/debrid-notify" && request.method === "POST") {
        return await proxy(`${ABB_PROXY}/abb/api/debrid-notify`, request, "POST");
      }

      // Short quote links (the quote kept in the QUOTES KV store, when it's bound):
      // POST /q {quote} -> { id }; GET /q/s/<id> (the page), /q/s/<id>.json (for the app)
      if (path === "/q" && request.method === "POST") {
        if (!env.QUOTES) return reply(JSON.stringify({ error: "Short links aren't set up" }), 501);
        const text = await request.text();
        let d = null;
        try {
          d = JSON.parse(text);
        } catch {}
        if (!d || !d.t || !d.q || text.length > 4000) return reply(JSON.stringify({ error: "Not a quote" }), 400);
        const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
        const id = Array.from(crypto.getRandomValues(new Uint8Array(7)), (b) => abc[b % abc.length]).join("");
        await env.QUOTES.put(id, text);
        return reply(JSON.stringify({ id, url: `${url.origin}/q/s/${id}` }));
      }
      const kept = /^\/q\/s\/([A-Za-z0-9]{5,12})(\.json)?$/.exec(path);
      if (kept && request.method === "GET") {
        const text = env.QUOTES ? await env.QUOTES.get(kept[1]) : null;
        if (kept[2]) return text ? reply(text) : reply(JSON.stringify({ error: "No such quote" }), 404);
        let d = null;
        try {
          d = text && JSON.parse(text);
        } catch {}
        return quotePage(`s/${kept[1]}`, url.origin, d);
      }

      // Shared quotes: /q/<data>
      const shared = /^\/q\/([A-Za-z0-9_-]{8,})$/.exec(path);
      if (shared && request.method === "GET") return quotePage(shared[1], url.origin);

      // Addon files: /addons/audiobookbay.json, /addons/knaben-audiobooks.json, …
      const addon = /^\/addons\/([a-z-]+)(\.json)?$/.exec(path);
      if (addon && request.method === "GET") {
        const a = ADDONS[addon[1]];
        return a ? reply(JSON.stringify(a, null, 2)) : reply(JSON.stringify({ error: "No such addon", addons: Object.keys(ADDONS) }), 404);
      }

      if (path === "/" || path === "/health") {
        return reply(JSON.stringify({
          name: "Audiohub Sources",
          status: "ok",
          routes: [
            "/bookracy/search",
            "/bookracy/download",
            "/bookracy/notify",
            "/knaben/audiobooks",
            "/knaben/ebooks",
            "/abb/api/search",
            "/abb/api/debrid-notify"
          ],
          addons: Object.keys(ADDONS).map((n) => `${url.origin}/addons/${n}.json`)
        }));
      }

      return reply(JSON.stringify({ error: "Not found" }), 404);
    } catch (error) {
      return reply(JSON.stringify({
        error: "Upstream request failed",
        message: error instanceof Error ? error.message : "Unknown error"
      }), 502);
    }
  }
};
