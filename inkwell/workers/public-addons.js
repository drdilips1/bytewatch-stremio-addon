// AudioYam public addons — a standalone Cloudflare Worker for a SEPARATE, public Cloudflare account.
//
// Anyone can install these source addons; nothing here belongs to one person:
// no sync, no keys, no secrets, no accounts, and no calls to any other worker or server of
// ours. Every search is done right here, straight with the sites.
//
// Addons, at https://sources.booksources.workers.dev (every addon file points there):
//   /addons/audiobookbay.json          AudiobookBay (audiobook torrents)
//   /addons/knaben-audiobooks.json     Knaben AudioBooks
//   /addons/knaben-ebooks.json         Knaben Ebooks
//   /addons/libgen-epub.json           LibGen English EPUB (several mirrors, the next one if one is down)
//   /addons/all.json                   all of them with one link
//
// Kind to the sites and to this account's daily limit (100,000 requests on the free plan):
//   • the same search is answered from Cloudflare's cache for 12 hours;
//   • one address may run at most 30 searches a minute (counted per Cloudflare machine).
//
// Deploy: dash.cloudflare.com (the public account) → Workers & Pages → Create → Hello World →
// name it (e.g. audioyam-addons) → Deploy → Edit code → replace everything with this file →
// Deploy. Share https://sources.booksources.workers.dev/addons/all.json
// (moving it to another address? change ORIGIN below).

const VERSION_PUBLIC = "1.0.0";
// This worker's public address: the addon files and download links all point here.
const ORIGIN = "https://sources.booksources.workers.dev";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Range",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, X-Cache",
  "Access-Control-Max-Age": "86400",
};
const reply = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data, null, 2), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS, ...extra } });

const TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.demonii.com:1337/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://open.stealth.si:80/announce",
];
const magnetFor = (hash, name) => `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(name || "")}${TRACKERS.map((t) => `&tr=${encodeURIComponent(t)}`).join("")}`;

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

/** A page or API answer, given up after `ms`. */
async function get(url, init = {}, ms = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", ...(init.headers || {}) }, redirect: "follow", signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

// ---------------- 30 searches a minute per address ----------------
const LIMIT = 30;
const seen = new Map(); // ip -> { n, from }
export function overLimit(ip, now = Date.now()) {
  if (!ip) return false;
  const s = seen.get(ip);
  if (!s || now - s.from >= 60e3) {
    if (seen.size > 10000) seen.clear();
    seen.set(ip, { n: 1, from: now });
    return false;
  }
  s.n += 1;
  return s.n > LIMIT;
}

// ---------------- 12-hour cache of search answers ----------------
const KEEP_SECONDS = 12 * 3600;
/** The same search, whatever its spacing or capitals: one cache entry. */
export const searchKey = (addon, q, extra = "") => `https://public-addons.cache/${addon}?q=${encodeURIComponent(String(q || "").toLowerCase().replace(/\s+/g, " ").trim())}${extra ? `&${extra}` : ""}`;
async function cachedSearch(ctx, key, run) {
  const cache = caches.default;
  const req = new Request(key);
  const hit = await cache.match(req).catch(() => null);
  if (hit) {
    const out = new Response(hit.body, hit);
    out.headers.set("X-Cache", "hit");
    return out;
  }
  let data;
  try {
    data = await run();
  } catch (e) {
    // Not kept: the next search asks the site again.
    return reply({ results: [], hits: [], error: e instanceof Error ? e.message : String(e) }, 502);
  }
  const res = reply(data, 200, { "Cache-Control": `public, max-age=${KEEP_SECONDS}` });
  // Only answers that found something are kept (an empty one may be a site having a bad minute).
  const found = (data.results || data.hits || []).length > 0;
  if (found) ctx.waitUntil(cache.put(req, res.clone()).catch(() => {}));
  return res;
}

// ---------------- AudiobookBay ----------------
// It moves between addresses; the first one that answers is used.
const ABB_MIRRORS = ["audiobookbay.lu", "audiobookbay.is", "theaudiobookbay.se", "audiobookbay.fi"];
const ABB_PAGES = 12; // result pages opened per search, for their info hash (each is one more request)

/**
 * Did AudiobookBay answer this search? Its results page has posts; its "nothing found" page has
 * none and not always the words "Nothing Found" — but it is still the site's own page (a full
 * HTML page from one of its addresses). Before 27 Nov only the words counted, so every search
 * with no results tried all four addresses, one of them failed (HTTP 526), and the app showed
 * "AudiobookBay didn't answer" after ~17 s while the site was fine.
 */
export function abbAnswered(status, html) {
  if (status < 200 || status >= 300) return false;
  const t = String(html || "");
  if (/class="post"|postTitle|Nothing Found|No results/i.test(t)) return true;
  // A bot check or a parked domain isn't an answer.
  if (/cf-browser-verification|challenge-platform|Just a moment\.\.\.|domain (is )?for sale/i.test(t)) return false;
  return t.length > 1500 && /<html[\s>]/i.test(t) && /audiobook/i.test(t);
}

async function abbSearchPage(q) {
  q = q.toLowerCase(); // its title search misses capitalised words
  let last = "";
  for (const host of ABB_MIRRORS) {
    try {
      // tt=1: titles only (the plain search returns collections and near misses).
      // 10 s an address, so the app (45 s) still hears back if the first one hangs.
      const r = await get(`https://${host}/?s=${encodeURIComponent(q).replace(/%20/g, "+")}&tt=1`, { headers: { Accept: "text/html" } }, 10000);
      const html = await r.text();
      if (abbAnswered(r.status, html)) return { host: new URL(r.url).host, html };
      last = `${host}: HTTP ${r.status}`;
    } catch (e) {
      last = `${host}: ${e.message}`;
    }
  }
  throw new Error(`AudiobookBay didn't answer (${last})`);
}

/** AudiobookBay's search page → [{ title, pageUrl, format, sizeBytes, date, language }]. */
export function abbParse(html, host) {
  return String(html || "")
    .split(/<div class="post"[^>]*>/)
    .slice(1)
    .map((p) => {
      const a = /class="postTitle"[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(p);
      if (!a) return null;
      // "Language: English … Posted: 17 Aug 2024 Format: M4B / Bitrate: ? File Size: 153.12 MBs"
      const info = decode(p);
      const size = /File Size:\s*([\d.,]+)\s*([KMGT]?B)s?/i.exec(info);
      return {
        title: decode(a[2]),
        pageUrl: new URL(a[1], `https://${host}/`).href,
        format: (/Format:\s*([^\s/]+)/i.exec(info) || [])[1] || "",
        sizeBytes: size ? toBytes(size[1], size[2]) : 0,
        date: (/Posted:\s*([0-9]{1,2} [A-Za-z]{3} [0-9]{4})/i.exec(info) || [])[1] || "",
        language: (/Language:\s*([A-Z][a-z]+)/.exec(info) || [])[1] || "",
      };
    })
    .filter(Boolean);
}

async function abbWithHash(item) {
  try {
    const html = await (await get(item.pageUrl, { headers: { Accept: "text/html" } })).text();
    const hash = (/Info Hash:?\s*<\/td>\s*<td[^>]*>\s*([0-9a-f]{40})/i.exec(html) || /\b([0-9a-f]{40})\b/i.exec(html.split("Info Hash")[1] || "") || [])[1];
    if (!hash) return null;
    const infoHash = hash.toLowerCase();
    return { ...item, infoHash, magnetUrl: magnetFor(infoHash, item.title) };
  } catch {
    return null;
  }
}

async function abbSearch(q) {
  const { host, html } = await abbSearchPage(q);
  const found = abbParse(html, host).slice(0, ABB_PAGES);
  return { results: (await Promise.all(found.map(abbWithHash))).filter(Boolean) };
}

// ---------------- Knaben ----------------
// Knaben's own API (it searches many torrent sites); only its audiobook / ebook categories.
const KNABEN = {
  audiobooks: [1003000],
  ebooks: [9001000, 9000000, 10000000],
};
async function knabenSearch(kind, q) {
  const r = await get(
    "https://api.knaben.org/v1",
    { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ query: q, search_field: "title", size: 50, categories: KNABEN[kind] }) },
    20000
  );
  if (!r.ok) throw new Error(`Knaben answered HTTP ${r.status}`);
  const d = await r.json();
  const hits = (d.hits || [])
    .filter((h) => h && (h.magnetUrl || h.hash))
    .map((h) => ({
      title: h.title || "",
      magnetUrl: h.magnetUrl || (h.hash ? magnetFor(String(h.hash).toLowerCase(), h.title) : ""),
      hash: h.hash ? String(h.hash).toLowerCase() : "",
      bytes: Number(h.bytes) || 0,
      seeders: Number(h.seeders) || 0,
      date: h.date || "",
      tracker: h.tracker || "",
    }));
  return { hits };
}

// ---------------- LibGen English EPUB ----------------
// The same search as the LibGen worker (version 10.8.2): several mirrors of the same LibGen, the
// last one that worked first, then all the others at once — one that's down never means no
// results. Kept in its own scope so its names don't clash with the rest of this file.
const LibGen = (() => {
  const VERSION = "10.8.2";
  const SOURCE = "LibGen English EPUB";
  // Mirrors of the same LibGen (same database, same pages): the first that answers is used.
  const MIRRORS = [
    "https://libgen.la/",
    "https://libgen.gl/",
    "https://libgen.li/",
    "https://libgen.vg/",
    "https://libgen.bz/",
    "https://libgen.gs/",
  ];
  const FIRST_TIMEOUT_MS = 5000; // the last working mirror
  const RACE_TIMEOUT_MS = 8000; // the others, all at once
  let activeBase = MIRRORS[0];
  const DEFAULT_PAGES = 5;
  const MAX_PAGES = 10;
  const TARGET_RESULTS = 30;

  const HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Range",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  };

  function json(data, status = 200) {
    return new Response(JSON.stringify(data, null, 2), {
      status,
      headers: HEADERS,
    });
  }

  /* ---------------- MIRRORS ---------------- */

  /**
   * Fetch `path` (with `params`) from the LibGen mirrors: the last one that worked first, then
   * the others. A mirror counts as down on a network error, a timeout, or HTTP 5xx (522 =
   * Cloudflare couldn't reach it). Returns { response, base, tried }.
   */
  async function fetchMirror(path, params, init = {}) {
    const tried = [];
    const build = (base) => {
      const url = new URL(path, base);
      for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
      return url.href;
    };
    // One mirror: resolves { response, base, url } for an answer below 500, else rejects.
    const attempt = (base, ms, signals) => {
      const controller = new AbortController();
      signals.push(controller);
      const timer = setTimeout(() => controller.abort(), ms);
      const href = build(base);
      return fetch(href, { ...init, signal: controller.signal, redirect: "follow" })
        .then(response => {
          tried.push({ mirror: base, status: response.status });
          if (response.status >= 500) throw Object.assign(new Error("HTTP " + response.status), { response, base, url: href });
          return { response, base, url: href };
        })
        .catch(error => {
          if (!error.response) tried.push({ mirror: base, error: error?.name === "AbortError" ? "timed out" : String(error) });
          throw error;
        })
        .finally(() => clearTimeout(timer));
    };

    // 1. The mirror that worked last.
    const first = [];
    try {
      const got = await attempt(activeBase, FIRST_TIMEOUT_MS, first);
      return { ...got, tried };
    } catch {}

    // 2. All the others at once: the first good answer wins, the rest are stopped.
    const rest = MIRRORS.filter(m => m !== activeBase);
    const controllers = [];
    try {
      const got = await Promise.any(rest.map(base => attempt(base, RACE_TIMEOUT_MS, controllers)));
      for (const c of controllers) c.abort();
      activeBase = got.base;
      return { ...got, tried };
    } catch (all) {
      // Every mirror failed: hand back an HTTP error if one answered, else say none did.
      const answered = (all.errors || []).find(e => e && e.response);
      if (answered) return { response: answered.response, base: answered.base, url: answered.url, tried };
      throw Object.assign(new Error("No LibGen mirror answered"), { tried });
    }
  }

  /* ---------------- PARSING ---------------- */

  function decodeEntities(value) {
    const named = {
      amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
      eacute: "é", egrave: "è", ecirc: "ê", agrave: "à", aacute: "á",
      ccedil: "ç", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
      ndash: "–", mdash: "—",
    };

    return String(value || "").replace(
      /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
      (whole, entity) => {
        if (entity.startsWith("#")) {
          const hex = entity[1]?.toLowerCase() === "x";
          const number = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);

          try {
            return Number.isFinite(number) && number >= 0 && number <= 0x10ffff
              ? String.fromCodePoint(number)
              : whole;
          } catch {
            return whole;
          }
        }

        return named[entity.toLowerCase()] ?? whole;
      }
    );
  }

  function cleanText(html) {
    return decodeEntities(String(html || "")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
      .replace(/<br\b[^>]*>/gi, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim());
  }

  function getAttribute(tag, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      "\\b" + escaped + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))",
      "i"
    );
    const match = String(tag || "").match(re);
    return match
      ? decodeEntities(match[1] ?? match[2] ?? match[3] ?? "")
      : "";
  }

  function absoluteUrl(href, base = activeBase) {
    if (!href) return "";
    try {
      return new URL(href, base).href;
    } catch {
      return "";
    }
  }

  function normalize(value) {
    return cleanText(value)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function getTable(html) {
    const re = /<table\b[^>]*>/gi;
    let match;

    while ((match = re.exec(html)) !== null) {
      if (getAttribute(match[0], "id").toLowerCase() !== "tablelibgen") {
        continue;
      }

      const start = match.index + match[0].length;
      const close = html.toLowerCase().indexOf("</table", start);

      return {
        found: true,
        html: close < 0 ? html.slice(start) : html.slice(start, close),
      };
    }

    return { found: false, html: "" };
  }

  function getRows(tableHtml) {
    const rows = [];
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi;
    let rowMatch;

    while ((rowMatch = rowRe.exec(tableHtml)) !== null) {
      const cells = [];
      const cellRe = /<(td|th)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
      let cellMatch;

      while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
        cells.push({
          type: cellMatch[1].toLowerCase(),
          html: cellMatch[2],
          text: cleanText(cellMatch[2]),
        });
      }

      if (cells.length) rows.push({ html: rowMatch[1], cells });
    }

    return rows;
  }

  function getColumns(rows) {
    const map = {};
    const header = rows.find(row =>
      row.cells.some(cell => cell.type === "th")
    );

    if (header) {
      header.cells.forEach((cell, index) => {
        const heading = normalize(cell.text);

        if (/^(title|book title|name)$/.test(heading)) map.title = index;
        else if (/^authors?$/.test(heading)) map.author = index;
        else if (/^publishers?$/.test(heading)) map.publisher = index;
        else if (/^(year|date|publication year)$/.test(heading)) map.year = index;
        else if (/^(language|lang)$/.test(heading)) map.language = index;
        else if (/^(pages|page count)$/.test(heading)) map.pages = index;
        else if (/^(size|file size)$/.test(heading)) map.size = index;
        else if (/^(extension|format|file type|type)$/.test(heading)) map.format = index;
      });
    }

    const fallback = {
      title: 0,
      author: 1,
      publisher: 2,
      year: 3,
      language: 4,
      pages: 5,
      size: 6,
      format: 7,
    };

    for (const key of Object.keys(fallback)) {
      if (map[key] === undefined) map[key] = fallback[key];
    }

    return map;
  }

  function getCell(cells, index) {
    return index >= 0 && index < cells.length
      ? cells[index]
      : { html: "", text: "" };
  }

  function findLink(html, filename) {
    const source = String(html || "");
    const hrefRe = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
    let match;

    while ((match = hrefRe.exec(source)) !== null) {
      const href = decodeEntities(match[1] ?? match[2] ?? match[3] ?? "");

      if (!new RegExp("(?:^|/)" + filename + "(?:\\?|$)", "i").test(href)) {
        continue;
      }

      const tagStart = source.lastIndexOf("<", match.index);
      const tagEnd = source.indexOf(">", match.index);
      let linkText = "";
      let method = "href-only";

      if (tagStart >= 0 && tagEnd >= 0) {
        const openingTag = source.slice(tagStart, tagEnd + 1);

        if (/^<a\b/i.test(openingTag)) {
          const contentStart = tagEnd + 1;
          const closingAnchor = source.toLowerCase().indexOf("</a", contentStart);

          if (closingAnchor >= 0) {
            linkText = cleanText(source.slice(contentStart, closingAnchor));
            method = "anchor-text";
          } else {
            const nextTag = source.indexOf("<", contentStart);
            linkText = cleanText(
              source.slice(contentStart, nextTag >= 0 ? nextTag : source.length)
            );
            method = "text-until-next-tag";
          }
        }
      }

      return { href, text: linkText, method };
    }

    return { href: "", text: "", method: "not-found" };
  }

  function cleanFallbackTitle(value) {
    return stripIsbns(cleanText(value)
      .replace(/\s+\b[a-z]\s+[a-z]\s+\d{5,}\s*$/i, ""));
  }

  /** "Title 9781473537804; 1473537800; 184794183X" → "Title" (ISBN lists after the title). */
  function stripIsbns(title) {
    return String(title || "")
      .replace(/(?:[\s;,]+(?:97[89][\d-]{10,14}|\d{9}[\dXx]|[\d-]{12,17}))+[\s;,]*$/g, "")
      .trim();
  }

  function parseSizeBytes(value) {
    const match = String(value || "")
      .replace(/,/g, ".")
      .match(/(\d+(?:\.\d+)?)\s*(bytes?|B|KB|MB|GB|TB|KiB|MiB|GiB)\b/i);

    if (!match) return null;

    const unit = match[2].toLowerCase();
    const factor =
      unit === "b" || unit.startsWith("byte") ? 1 :
      unit === "kb" || unit === "kib" ? 1024 :
      unit === "mb" || unit === "mib" ? 1024 ** 2 :
      unit === "gb" || unit === "gib" ? 1024 ** 3 :
      unit === "tb" ? 1024 ** 4 : 1;

    return Math.round(Number(match[1]) * factor);
  }

  function extractBook(row, columns, base) {
    const titleCell = getCell(row.cells, columns.title);
    const edition = findLink(titleCell.html, "edition\\.php");
    const file = findLink(row.html, "file\\.php");

    const formatCell = getCell(row.cells, columns.format).text;
    const formatMatch = formatCell.match(
      /\b(epub|pdf|mobi|azw3?|djvu|fb2|txt|lit)\b/i
    );

    const sizeCell = getCell(row.cells, columns.size).text;
    const sizeMatch = sizeCell.match(
      /\b\d+(?:[.,]\d+)?\s*(?:bytes?|B|KB|MB|GB|TB|KiB|MiB|GiB)\b/i
    );

    return {
      title: stripIsbns(edition.text) || cleanFallbackTitle(titleCell.text),
      author: getCell(row.cells, columns.author).text,
      publisher: getCell(row.cells, columns.publisher).text,
      year: getCell(row.cells, columns.year).text,
      language: getCell(row.cells, columns.language).text,
      pages: getCell(row.cells, columns.pages).text,
      size: sizeMatch?.[0] || sizeCell,
      sizeBytes: parseSizeBytes(sizeMatch?.[0] || sizeCell),
      format: (formatMatch?.[1] || formatCell)
        .replace(/^\./, "")
        .toLowerCase()
        .trim(),
      editionUrl: absoluteUrl(edition.href, base),
      fileListingUrl: absoluteUrl(file.href, base),
      url: absoluteUrl(file.href, base),
      _editionMatch: edition.method,
    };
  }

  function isEnglishEpub(book) {
    const language = normalize(book.language);

    return (
      (language === "english" || language === "eng") &&
      normalize(book.format) === "epub" &&
      Boolean(book.title) &&
      Boolean(book.fileListingUrl)
    );
  }

  function countValues(items, field) {
    const counts = {};

    for (const item of items) {
      const value = cleanText(item[field]) || "(empty)";
      counts[value] = (counts[value] || 0) + 1;
    }

    return counts;
  }

  function fanfictionInfo(book) {
    const text = normalize(
      [book.title, book.author, book.publisher].join(" ")
    );

    const signals = [];

    if (/fanfiction|fan fiction|fanfics|archive of our own|ao3|wattpad/.test(text)) {
      signals.push("fanfiction-platform-or-label");
    }

    if (/unofficial|a fan.?s guide|fan.?made/.test(text)) {
      signals.push("unofficial-or-fan-made-label");
    }

    return {
      isFanfiction: signals.length > 0,
      fanfictionSignals: signals,
    };
  }

  function relevanceScore(book, query) {
    const title = normalize(book.title);
    const q = normalize(query);

    if (!title || !q) return 0;
    if (title === q) return 100;
    if (title.startsWith(q)) return 90;
    if (title.includes(q)) return 80;

    const terms = q.split(" ").filter(Boolean);
    const titleTerms = new Set(title.split(" "));
    const matched = terms.filter(term => titleTerms.has(term)).length;
    const coverage = matched / Math.max(terms.length, 1);

    return Math.round(coverage * 65);
  }

  function canonicalWorkTitle(book) {
    let title = normalize(book.title);

    title = title
      .replace(/\b978\d{10}\b|\b\d{10,13}\b/g, " ")
      .replace(/\b(first|second|third|fourth|fifth|sixth|seventh)\s+(edition|ed)\b/g, " ")
      .replace(/\b(1st|2nd|3rd|4th|5th|6th|7th)\s+(edition|ed)\b/g, " ")
      .replace(/\b(uk|us|usa|u k|u s|united kingdom|united states|american|british|canadian|australian)\b/g, " ");

    const hp = title.match(/harry potter(?:\s+\d+)?\s+(?:and\s+the\s+)?(.+)/);

    if (hp) title = hp[1];

    return title.replace(/\s+/g, " ").trim();
  }

  function canonicalAuthor(book) {
    const author = normalize(book.author);

    if (/rowling/.test(author)) return "rowling";

    return author;
  }

  function editionGroupKey(book) {
    return [
      canonicalWorkTitle(book),
      canonicalAuthor(book),
    ].filter(Boolean).join("|");
  }

  function editionIdentity(book) {
    if (book.editionUrl) {
      return "url:" + book.editionUrl;
    }

    return [
      "fallback",
      normalize(book.publisher),
      normalize(book.year),
      canonicalWorkTitle(book),
      canonicalAuthor(book),
    ].join("|");
  }

  function seriesOrder(book) {
    const title = normalize(book.title);

    const match = title.match(
      /harry potter\s*(?:#|book|volume|vol\.?)?\s*(\d+)/
    );

    if (match) {
      const number = Number(match[1]);
      if (number >= 1 && number <= 7) return number;
    }

    const names = [
      "philosopher stone",
      "chamber of secrets",
      "prisoner of azkaban",
      "goblet of fire",
      "order of the phoenix",
      "half blood prince",
      "deathly hallows",
    ];

    const canonical = canonicalWorkTitle(book);
    const index = names.findIndex(name => canonical.includes(name));

    return index >= 0 ? index + 1 : Infinity;
  }

  function rankResults(books, query) {
    const enriched = books.map((book, index) => {
      const fan = fanfictionInfo(book);
      const score = relevanceScore(book, query);
      const order = seriesOrder(book);

      return {
        ...book,
        ...fan,
        relevanceScore: score,
        editionGroup: editionGroupKey(book),
        isCoreSeriesBook: order !== Infinity,
        seriesOrder: order,
        _originalIndex: index,
        _editionIdentity: editionIdentity(book),
      };
    });

    const groups = new Map();

    for (const book of enriched) {
      if (!groups.has(book.editionGroup)) {
        groups.set(book.editionGroup, []);
      }

      groups.get(book.editionGroup).push(book);
    }

    const orderedGroups = [...groups.entries()].map(([key, group]) => {
      group.sort((a, b) => {
        const sizeA = a.sizeBytes ?? Number.MAX_SAFE_INTEGER;
        const sizeB = b.sizeBytes ?? Number.MAX_SAFE_INTEGER;

        return sizeA - sizeB || a._originalIndex - b._originalIndex;
      });

      const editionNumbers = new Map();
      const copyCounts = new Map();

      for (const book of group) {
        copyCounts.set(
          book._editionIdentity,
          (copyCounts.get(book._editionIdentity) || 0) + 1
        );
      }

      for (const book of group) {
        if (!editionNumbers.has(book._editionIdentity)) {
          editionNumbers.set(
            book._editionIdentity,
            editionNumbers.size + 1
          );
        }
      }

      const distinctEditionCount = editionNumbers.size;

      group.forEach((book, index) => {
        book.editionNumber = editionNumbers.get(book._editionIdentity);
        book.editionCount = distinctEditionCount;
        book.fileCopyNumber = group
          .filter(item =>
            item._editionIdentity === book._editionIdentity &&
            (item.sizeBytes ?? Number.MAX_SAFE_INTEGER) <
              (book.sizeBytes ?? Number.MAX_SAFE_INTEGER)
          ).length + 1;

        book.fileCopyCount = copyCounts.get(book._editionIdentity);
        book.sizePreferenceRank = index + 1;
      });

      return {
        key,
        group,
        fanfiction: group.every(book => book.isFanfiction),
        coreSeries: group.some(book => book.isCoreSeriesBook),
        seriesOrder: Math.min(...group.map(book => book.seriesOrder)),
        relevance: Math.max(...group.map(book => book.relevanceScore)),
        firstSeen: Math.min(...group.map(book => book._originalIndex)),
      };
    });

    orderedGroups.sort((a, b) => {
      if (a.fanfiction !== b.fanfiction) {
        return a.fanfiction ? 1 : -1;
      }

      if (a.coreSeries && b.coreSeries && a.seriesOrder !== b.seriesOrder) {
        return a.seriesOrder - b.seriesOrder;
      }

      if (a.coreSeries !== b.coreSeries) {
        return a.coreSeries ? -1 : 1;
      }

      if (a.relevance !== b.relevance) {
        return b.relevance - a.relevance;
      }

      if (a.firstSeen !== b.firstSeen) {
        return a.firstSeen - b.firstSeen;
      }

      return a.key.localeCompare(b.key);
    });

    return {
      results: orderedGroups.flatMap(item => item.group),
      editionGroupCount: groups.size,
    };
  }

  async function fetchLibgenPage(query, page) {
    let got;

    try {
      got = await fetchMirror("/", {
        req: query,
        res: "100",
        columns: "0",
        sort: "def",
        sortmode: "ASC",
        page: String(page),
      }, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; AudiohubEbookSearch/10.8)",
          "Accept": "text/html,application/xhtml+xml",
        },
      });
    } catch (error) {
      return {
        ok: false,
        page,
        upstreamStatus: null,
        upstreamUrl: null,
        htmlLength: 0,
        mirrors: error.tried || [],
        error: "No LibGen mirror answered.",
      };
    }

    const { response, base, url, tried } = got;
    const html = await response.text();

    if (!response.ok) {
      return {
        ok: false,
        page,
        upstreamStatus: response.status,
        upstreamUrl: url,
        htmlLength: html.length,
        mirrors: tried,
        error: "Every LibGen mirror returned an error.",
      };
    }

    const table = getTable(html);

    if (!table.found) {
      return {
        ok: false,
        page,
        upstreamStatus: response.status,
        upstreamUrl: url,
        htmlLength: html.length,
        tableFound: false,
        mirrors: tried,
        error: "LibGen result table was not found.",
      };
    }

    const rows = getRows(table.html);
    const columns = getColumns(rows);
    const dataRows = rows.filter(row =>
      !row.cells.some(cell => cell.type === "th")
    );

    const parsed = dataRows
      .map(row => extractBook(row, columns, base))
      .filter(book => book.title || book.author || book.fileListingUrl);

    return {
      ok: true,
      page,
      upstreamStatus: response.status,
      upstreamUrl: url,
      mirror: base,
      mirrors: tried,
      htmlLength: html.length,
      tableFound: true,
      rowsScanned: dataRows.length,
      parsedRows: parsed.length,
      columns,
      parsed,
    };
  }

  /* ---------------- DOWNLOAD RESOLVER ---------------- */

  function getFileId(fileListingUrl) {
    try {
      const url = new URL(fileListingUrl);
      return url.searchParams.get("id") || "";
    } catch {
      return "";
    }
  }

  function extractMd5(html) {
    const patterns = [
      /(?:ads\.php|get\.php)[^"'<>]*[?&]md5=([a-f0-9]{32})/i,
      /[?&]md5=([a-f0-9]{32})/i,
      /\bmd5\s*[:=]\s*["']?([a-f0-9]{32})/i,
    ];

    for (const pattern of patterns) {
      const match = String(html || "").match(pattern);
      if (match) return match[1].toLowerCase();
    }

    return "";
  }

  function extractDownloadLink(html, baseUrl) {
    const source = String(html || "");
    const hrefRe = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
    let match;

    while ((match = hrefRe.exec(source)) !== null) {
      const href = decodeEntities(
        match[1] ?? match[2] ?? match[3] ?? ""
      );

      try {
        const candidate = new URL(href, baseUrl);

        if (
          /\/get\.php$/i.test(candidate.pathname) &&
          candidate.searchParams.has("key") &&
          candidate.searchParams.has("md5")
        ) {
          return candidate.href;
        }
      } catch {
        // Ignore malformed links.
      }
    }

    // Some pages expose the download URL in JavaScript or plain text.
    const plain = source.match(
      /(?:https?:\/\/[^"' <]+)?\/get\.php\?[^"' <]+/i
    );

    if (plain) {
      try {
        const candidate = new URL(
          decodeEntities(plain[0]),
          baseUrl
        );

        if (
          candidate.searchParams.has("key") &&
          candidate.searchParams.has("md5")
        ) {
          return candidate.href;
        }
      } catch {
        // Ignore malformed links.
      }
    }

    return "";
  }

  async function resolveLibgenDownload(fileId, request) {
    if (!/^\d+$/.test(fileId || "")) {
      return new Response("Invalid LibGen file ID.", {
        status: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }

    const browserHeaders = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    };

    // The file page, from whichever mirror answers.
    let listing;

    try {
      listing = await fetchMirror("/file.php", { id: fileId }, { headers: browserHeaders });
    } catch (error) {
      return new Response("Could not contact any LibGen mirror: " + String(error), {
        status: 502,
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }

    const listingResponse = listing.response;

    if (!listingResponse.ok) {
      return new Response(
        `LibGen file page returned HTTP ${listingResponse.status} (every mirror).`,
        { status: 502, headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    const listingHtml = await listingResponse.text();
    const md5 = extractMd5(listingHtml);

    if (!md5) {
      return new Response(
        "Could not extract the MD5 from the LibGen file page.",
        { status: 502, headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    // The download page: the same mirror first (fetchMirror starts with the one that just worked).
    let ads;

    try {
      ads = await fetchMirror("/ads.php", { md5 }, {
        headers: {
          ...browserHeaders,
          "Referer": listing.url,
        },
      });
    } catch (error) {
      return new Response("Could not open LibGen download page: " + String(error), {
        status: 502,
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }

    const adsResponse = ads.response;

    if (!adsResponse.ok) {
      return new Response(
        `LibGen download page returned HTTP ${adsResponse.status}.`,
        { status: 502, headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    const adsHtml = await adsResponse.text();
    const downloadUrl = extractDownloadLink(
      adsHtml,
      adsResponse.url || ads.url
    );

    if (!downloadUrl) {
      return new Response(
        "LibGen did not expose a keyed get.php download link. The page may require browser verification or its structure may have changed.",
        { status: 502, headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    const downloadHeaders = {
      ...browserHeaders,
      "Referer": adsResponse.url || ads.url,
    };

    const range = request.headers.get("Range");
    if (range) downloadHeaders.Range = range;

    let upstream;

    try {
      upstream = await fetch(downloadUrl, {
        headers: downloadHeaders,
        redirect: "follow",
      });
    } catch (error) {
      return new Response("Could not fetch the EPUB: " + String(error), {
        status: 502,
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }

    if (!upstream.ok && upstream.status !== 206) {
      return new Response(
        `LibGen file server returned HTTP ${upstream.status}.`,
        { status: 502, headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    const contentType = upstream.headers.get("Content-Type") || "";

    if (
      contentType.toLowerCase().includes("text/html") ||
      contentType.toLowerCase().includes("application/json")
    ) {
      return new Response(
        "The upstream returned a webpage or JSON instead of an EPUB file.",
        { status: 502, headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    const headers = new Headers({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Range, Content-Type",
      "Access-Control-Expose-Headers":
        "Content-Length, Content-Range, Accept-Ranges",
      "Content-Type": contentType || "application/epub+zip",
      "Content-Disposition": 'inline; filename="book.epub"',
      "Cache-Control": "no-store",
    });

    for (const name of [
      "Content-Length",
      "Content-Range",
      "Accept-Ranges",
      "ETag",
      "Last-Modified",
    ]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }

    return new Response(
      request.method === "HEAD" ? null : upstream.body,
      {
        status: upstream.status,
        headers,
      }
    );
  }

  /* ---------------- SEARCH ---------------- */

  async function runSearch(query, startPage, pagesToSearch, origin) {
    const allParsed = [];
    const allResults = [];
    const seenFiles = new Set();
    const pageReports = [];
    let lastSuccessfulPage = null;

    for (
      let page = startPage;
      page < startPage + pagesToSearch;
      page++
    ) {
      let report;

      try {
        report = await fetchLibgenPage(query, page);
      } catch (error) {
        pageReports.push({
          page,
          ok: false,
          error: String(error),
        });
        break;
      }

      if (!report.ok) {
        pageReports.push({
          page,
          ok: false,
          upstreamStatus: report.upstreamStatus,
          tableFound: report.tableFound,
          mirrors: report.mirrors,
          error: report.error,
        });
        break;
      }

      lastSuccessfulPage = report;
      allParsed.push(...report.parsed);

      let pageMatches = 0;

      for (const book of report.parsed) {
        if (!isEnglishEpub(book)) continue;

        const key =
          book.fileListingUrl ||
          book.editionUrl ||
          (book.title + "|" + book.author);

        if (seenFiles.has(key)) continue;

        seenFiles.add(key);
        allResults.push(book);
        pageMatches++;
      }

      pageReports.push({
        page,
        ok: true,
        mirror: report.mirror,
        rowsScanned: report.rowsScanned,
        parsedRows: report.parsedRows,
        englishEpubMatches: pageMatches,
      });

      if (allResults.length >= TARGET_RESULTS || report.parsedRows === 0) {
        break;
      }
    }

    const ranked = rankResults(allResults, query);

    const cleanResults = ranked.results.map(
      ({
        _editionMatch,
        _originalIndex,
        _editionIdentity,
        isCoreSeriesBook,
        isCompanion,
        seriesOrder: internalSeriesOrder,
        ...book
      }) => {
        const fileId = getFileId(book.fileListingUrl);

        return {
          ...book,
          downloadUrl: fileId
            ? `${origin}/download?id=${encodeURIComponent(fileId)}`
            : "",
        };
      }
    );

    const cleanDiagnostics = allParsed
      .slice(0, 15)
      .map(({ _editionMatch, ...book }) => book);

    const editionMethods = {};

    for (const book of allParsed) {
      const method = book._editionMatch || "unknown";
      editionMethods[method] = (editionMethods[method] || 0) + 1;
    }

    const columns = lastSuccessfulPage?.columns || {};

    const distinctEditionCount = new Set(
      ranked.results.map(book =>
        book.editionGroup + "|" + book.editionNumber
      )
    ).size;

    const fileCopyCount = ranked.results.filter(
      book => book.fileCopyCount > 1
    ).length;

    return json({
      source: SOURCE,
      version: VERSION,
      query,
      startPage,
      pagesRequested: pagesToSearch,
      pagesSearched: pageReports.length,
      ok: Boolean(lastSuccessfulPage),
      mirror: lastSuccessfulPage?.mirror ?? null,
      upstreamStatus: lastSuccessfulPage?.upstreamStatus ?? null,
      upstreamUrl: lastSuccessfulPage?.upstreamUrl ?? null,
      htmlLength: lastSuccessfulPage?.htmlLength ?? 0,
      tableFound: Boolean(lastSuccessfulPage),
      rowsScanned: allParsed.length,
      parsedRows: allParsed.length,
      count: cleanResults.length,
      results: cleanResults,
      diagnostics: {
        columnMap: columns,
        languageCounts: countValues(allParsed, "language"),
        formatCounts: countValues(allParsed, "format"),
        rowsWithEditionUrl: allParsed.filter(book => book.editionUrl).length,
        rowsWithFileUrl: allParsed.filter(book => book.fileListingUrl).length,
        editionMatchMethods: editionMethods,
        englishRows: allParsed.filter(book =>
          ["english", "eng"].includes(normalize(book.language))
        ).length,
        epubRows: allParsed.filter(book =>
          normalize(book.format) === "epub"
        ).length,
        fanfictionFlagged: ranked.results.filter(
          book => book.isFanfiction
        ).length,
        editionGroupCount: ranked.editionGroupCount,
        distinctEditionCount,
        fileCopyCount,
        ranking:
          "Harry Potter novels in reading order; companion material downranked; fanfiction last; smaller files first; distinct editions counted separately from file copies",
      },
      pageReports,
      diagnosticRows: cleanDiagnostics,
    });
  }


  return {
    async search(q, url) {
      const pages = Math.max(1, Math.min(MAX_PAGES, parseInt(url.searchParams.get("pages") || "2", 10) || 2));
      const res = await runSearch(q, 1, pages, `${ORIGIN}/libgen`);
      const d = await res.json();
      if (!d.ok && !(d.results || []).length) throw new Error("No LibGen mirror answered — try again later");
      return { results: d.results || [] };
    },
    download: (id, request) => resolveLibgenDownload(id, request),
  };
})();

// ---------------- the addon files ----------------
// Ids start with "public-" so they sit beside (never replace) anyone's own copies of these addons.
function addons(origin) {
  const torrentMap = { title: "title", magnetUrl: "magnetUrl", infoHash: "hash", sizeBytes: "bytes", seeders: "seeders", date: "date" };
  const all = {
    audiobookbay: {
      schemaVersion: "1.0.0",
      id: "public-audiobookbay",
      name: "AudiobookBay",
      version: VERSION_PUBLIC,
      description: "Audiobook torrents from AudiobookBay. Needs TorBox or Real-Debrid to play.",
      icon: "https://audiobookbay.lu/apple-touch-icon.png",
      provides: ["source"],
      contentType: "audiobook",
      rateLimit: { requestsPerMinute: 10, retryAfterMs: 6000 },
      matching: { algorithm: "fuzzy", threshold: 0.4 },
      adapters: {
        source: {
          request: { method: "GET", url: `${origin}/abb/search?q={QUERY}`, timeout: 45000, headers: { Accept: "application/json" } },
          response: { type: "json", resultsPath: "results", mapping: { title: "title", infoHash: "infoHash", magnetUrl: "magnetUrl", sizeBytes: "sizeBytes", format: "format", date: "date", language: "language", pageUrl: "pageUrl" } },
        },
      },
    },
    "knaben-audiobooks": {
      schemaVersion: "1.0.0",
      id: "public-knaben-audiobooks",
      name: "Knaben AudioBooks",
      version: VERSION_PUBLIC,
      description: "Audiobook torrents found by Knaben (many sites at once). Needs TorBox or Real-Debrid to play.",
      icon: "https://knaben.org/favicon.ico",
      provides: ["source"],
      contentType: "audiobook",
      matching: { algorithm: "fuzzy", threshold: 0.6 },
      adapters: {
        source: {
          request: { method: "GET", url: `${origin}/knaben/audiobooks?q={TITLE}`, timeout: 30000, headers: { Accept: "application/json" } },
          response: { type: "json", resultsPath: "hits", mapping: torrentMap },
        },
      },
    },
    "knaben-ebooks": {
      schemaVersion: "1.0.0",
      id: "public-knaben-ebooks",
      name: "Knaben Ebooks",
      version: VERSION_PUBLIC,
      description: "Ebook torrents found by Knaben (many sites at once).",
      icon: "https://knaben.org/favicon.ico",
      provides: ["source"],
      contentType: "ebook",
      matching: { algorithm: "fuzzy", threshold: 0.6 },
      adapters: {
        source: {
          request: { method: "GET", url: `${origin}/knaben/ebooks?q={TITLE}`, timeout: 30000, headers: { Accept: "application/json" } },
          response: { type: "json", resultsPath: "hits", mapping: torrentMap },
        },
      },
    },
    "libgen-epub": {
      schemaVersion: "1.0.0",
      id: "public-libgen-epub",
      name: "LibGen English EPUB",
      version: VERSION_PUBLIC,
      description: "English EPUB books from LibGen (several mirrors: the next one is used when one is down), with direct EPUB downloads.",
      icon: "https://libgen.gl/favicon.ico",
      provides: ["source"],
      contentType: "ebook",
      adapters: {
        source: {
          request: { method: "GET", url: `${origin}/libgen/search?q={QUERY}&page=1&pages=2`, timeout: 30000, headers: { Accept: "application/json" } },
          response: { type: "json", resultsPath: "results", mapping: { title: "title", author: "author", url: "downloadUrl", format: "format", language: "language", date: "year", sizeBytes: "sizeBytes", description: "publisher" } },
        },
      },
    },
  };
  return all;
}

// ---------------- routes ----------------
const SEARCHES = {
  "/abb/search": { name: "audiobookbay", run: (q) => abbSearch(q) },
  "/knaben/audiobooks": { name: "knaben-audiobooks", run: (q) => knabenSearch("audiobooks", q) },
  "/knaben/ebooks": { name: "knaben-ebooks", run: (q) => knabenSearch("ebooks", q) },
  "/libgen/search": { name: "libgen-epub", run: (q, url) => LibGen.search(q, url) },
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    try {
      // The addon files.
      const file = /^\/addons\/([a-z-]+)(\.json)?$/.exec(path);
      if (file && request.method === "GET") {
        const list = addons(ORIGIN);
        if (file[1] === "all") return reply({ name: "AudioYam addons", addons: Object.keys(list).map((n) => `${ORIGIN}/addons/${n}.json`) }, 200, { "Cache-Control": "public, max-age=3600" });
        const a = list[file[1]];
        return a ? reply(a, 200, { "Cache-Control": "public, max-age=3600" }) : reply({ error: "No such addon", addons: Object.keys(list) }, 404);
      }

      // LibGen's EPUB download (not a search: no cache, no search limit).
      if (path === "/libgen/download" && (request.method === "GET" || request.method === "HEAD")) return LibGen.download(url.searchParams.get("id") || "", request);

      // The searches.
      const s = SEARCHES[path];
      if (s && request.method === "GET") {
        const q = (url.searchParams.get("q") || "").replace(/\s+/g, " ").trim();
        if (!q) return reply({ results: [], hits: [] });
        if (q.length > 200) return reply({ results: [], hits: [], error: "That search is too long" }, 400);
        if (overLimit(request.headers.get("CF-Connecting-IP"))) return reply({ results: [], hits: [], error: "Too many searches from this address — wait a minute" }, 429, { "Retry-After": "60" });
        const extra = s.name === "libgen-epub" ? `pages=${url.searchParams.get("pages") || "2"}` : "";
        return await cachedSearch(ctx, searchKey(s.name, q, extra), () => s.run(q, url));
      }

      if (path === "/" || path === "/health") {
        return reply({ name: "AudioYam public addons", version: VERSION_PUBLIC, status: "ok", addons: Object.keys(addons(ORIGIN)).map((n) => `${ORIGIN}/addons/${n}.json`), all: `${ORIGIN}/addons/all.json` });
      }
      return reply({ error: "Not found" }, 404);
    } catch (e) {
      return reply({ error: "Something went wrong", message: e instanceof Error ? e.message : String(e) }, 502);
    }
  },
};
