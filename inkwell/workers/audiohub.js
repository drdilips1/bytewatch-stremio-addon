// Audiohub Sources — the Cloudflare Worker behind api.audiohubapp.com.
//
// One address for the app's source addons: Bookracy (ebooks), Knaben (audiobooks and
// ebooks) and AudiobookBay. Requests are passed on to the services; links in the answers
// are rewritten to this worker's own address, because some networks block *.workers.dev.
// AudiobookBay goes through the InkShelf proxy first and, if that refuses or finds
// nothing, is searched directly here.
//
// Deploy: Workers & Pages → audiohub → Edit code → replace everything with this file → Deploy.

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept"
};

const BOOKRACY = "https://bookracy-proxy.drdilipgreat.workers.dev";
const ABB_PROXY = "https://inkshelf-debrid-proxy.tbm-a.workers.dev";

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

async function abbDirect(title, author, limit = 12) {
  const q = [title, author].filter(Boolean).join(" ").trim();
  let host = "", html = "";
  for (const h of ABB_MIRRORS) {
    try {
      const r = await page(`https://${h}/?s=${encodeURIComponent(q).replace(/%20/g, "+")}&cat=undefined%2Cundefined`);
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
    .filter(Boolean)
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
        return { ...item, infoHash, magnetUrl: `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(item.title)}${tr}`, seeders: 0 };
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

export default {
  async fetch(request) {
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
          ]
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
