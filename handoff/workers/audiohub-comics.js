// Audiohub Comics — Cloudflare Worker, version 2.6.0
// Sources that search here: GetComics, Internet Archive, ReadComicsOnline (all three in
// source=all), Kitsu (manga titles only, source=kitsu). GlobalComix and Comics Plus are
// opened in their own reader (see WEB_ONLY below for why they aren't searched here).
// Changes from 2.5.0:
//  1. ReadComicsOnline: series search and issue lists from the site's public sitemaps
//     (its pages are behind a Cloudflare bot check, so reading opens in the browser).
//  2. Every result has the same fields (unify): access_type, reading_url, external_url,
//     download_options_url, issue_count… — null when a source doesn't say.
//  3. Kitsu back as its own source (/api/kitsu/search, /api/kitsu/item?id=), not in "all".
//  4. /api/globalcomix/search and /api/comicsplus/search explain why they can't search and
//     give GlobalComix's own search link; the manifest lists both as web searches.
//  5. The manifest maps the new fields (cover, access, reading link, issue list).
// Kept from 2.5.0: GetComics search, release download options and direct-file detection;
// Internet Archive search, files and download options; every earlier route.

const CONFIG = {
  NAME: "Audiohub Comics",
  VERSION: "2.6.0",
  KITSU_API: "https://kitsu.io/api/edge",
  ARCHIVE_API: "https://archive.org",
  GETCOMICS_FEED: "https://getcomics.org/feed/",
  GETCOMICS_SEARCH: "https://getcomics.org/wp-json/wp/v2/search",
  GETCOMICS_HOSTS: ["getcomics.org", "www.getcomics.org"],
  MAX_RESULTS: 20,
  CACHE_SECONDS: 300
};

// This worker's own address (the app is given absolute links to its download-options endpoints).
const WORKER = "https://audiohub-comics.booksources.workers.dev";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Range",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges"
};

const JH = {
  "Content-Type": "application/json; charset=utf-8",
  ...CORS
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: JH
  });
}

function error(message, status = 400) {
  return json({ success: false, error: message }, status);
}

function clean(v, n = 150) {
  return String(v || "").trim().slice(0, n);
}

function safeName(v) {
  return String(v || "").replaceAll("\\", "/").split("/").pop();
}

function supportedFile(n) {
  return /\.(pdf|cbz|cbr|epub|zip|jpg|jpeg|png|webp)$/i.test(n);
}

function fileType(n) {
  const ext = n.split(".").pop().toLowerCase();

  return ({
    pdf: "application/pdf",
    cbz: "application/vnd.comicbook+zip",
    cbr: "application/vnd.comicbook-rar",
    epub: "application/epub+zip",
    zip: "application/zip",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp"
  })[ext] || "application/octet-stream";
}

async function getJSON(url, headers = {}) {
  const r = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": `Audiohub-Comics/${CONFIG.VERSION}`,
      ...headers
    },
    cf: {
      cacheTtl: CONFIG.CACHE_SECONDS,
      cacheEverything: true
    }
  });

  if (!r.ok) throw new Error(`Upstream HTTP ${r.status}`);

  return r.json();
}

function archiveURLs(id, filename, base) {
  const p = `/api/file/${encodeURIComponent(id)}/${encodeURIComponent(filename)}`;

  return {
    stream_url: `${base}${p}?inline=1`,
    download_url: `${base}${p}?download=1`
  };
}

/* INTERNET ARCHIVE */

function _normalizeArchive(x) {
  return {
    id: x.identifier,
    title: x.title || x.identifier,
    description: x.description || "",
    creator: x.creator || "",
    author: x.creator || "",
    year: x.year || null,
    provider: "internet_archive",
    provider_name: "Internet Archive",
    format: "archive",
    cover: null,
    url: `https://archive.org/details/${encodeURIComponent(x.identifier)}`,
    source_url: `https://archive.org/details/${encodeURIComponent(x.identifier)}`,
    availability: "Check individual item access and file rights",
    download_available: true,
    download_links_url: `${WORKER}/api/archive/downloads?id=${encodeURIComponent(x.identifier)}`
  };
}

async function searchArchive(q, limit) {
  const params = new URLSearchParams({
    q: `mediatype:texts AND title:(${q.replace(/["\\]/g, " ")})`,
    fl: "identifier,title,description,creator,year,mediatype",
    rows: String(limit),
    page: "1",
    output: "json"
  });

  const d = await getJSON(`${CONFIG.ARCHIVE_API}/advancedsearch.php?${params}`);
  const docs = d.response?.docs || [];

  return {
    success: true,
    source: "internet_archive",
    total: d.response?.numFound || docs.length,
    results: docs.map(normalizeArchive)
  };
}

async function archiveItem(id) {
  const d = await getJSON(
    `${CONFIG.ARCHIVE_API}/metadata/${encodeURIComponent(id)}`
  );

  const m = d.metadata || {};

  return {
    success: true,
    source: "internet_archive",
    result: {
      id,
      title: m.title || id,
      description: m.description || "",
      creator: m.creator || "",
      date: m.date || m.year || null,
      publisher: m.publisher || "",
      language: m.language || "",
      mediatype: m.mediatype || "",
      url: `https://archive.org/details/${encodeURIComponent(id)}`
    }
  };
}

async function archiveFiles(request, id) {
  const d = await getJSON(
    `${CONFIG.ARCHIVE_API}/metadata/${encodeURIComponent(id)}`
  );

  const base = new URL(request.url).origin;

  const files = (d.files || [])
    .filter(f => f.name && supportedFile(f.name))
    .map(f => {
      const name = safeName(f.name);

      return {
        name,
        format: name.split(".").pop().toUpperCase(),
        size: f.size || null,
        size_bytes: Number(f.size) || null,
        provider: "internet_archive",
        ...archiveURLs(id, name, base)
      };
    });

  return {
    success: true,
    source: "internet_archive",
    item_id: id,
    total: files.length,
    files
  };
}

async function serveArchiveFile(request, id, filename) {
  const u = new URL(request.url);

  const target =
    `${CONFIG.ARCHIVE_API}/download/${encodeURIComponent(id)}/${encodeURIComponent(filename)}`;

  const h = new Headers();
  const range = request.headers.get("Range");

  if (range) h.set("Range", range);

  let r;

  try {
    r = await fetch(target, {
      method: request.method === "HEAD" ? "HEAD" : "GET",
      headers: h,
      redirect: "follow"
    });
  } catch {
    return error("Could not reach Internet Archive file server", 502);
  }

  if (!r.ok && r.status !== 206) {
    return error(`File delivery failed: HTTP ${r.status}`, r.status);
  }

  const headers = new Headers(CORS);

  headers.set("Content-Type", fileType(filename));
  headers.set("Accept-Ranges", "bytes");

  headers.set(
    "Content-Disposition",
    `${u.searchParams.has("download") ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(filename)}`
  );

  for (const k of ["Content-Length", "Content-Range", "Last-Modified", "ETag"]) {
    const v = r.headers.get(k);
    if (v) headers.set(k, v);
  }

  return new Response(
    request.method === "HEAD" ? null : r.body,
    {
      status: r.status,
      headers
    }
  );
}

/* GETCOMICS */

function decodeXml(v) {
  return String(v || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCodePoint(parseInt(n, 16))
    )
    .trim();
}

function xmlField(block, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const m = block.match(
    new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}\\s*>`, "i")
  );

  return m ? decodeXml(m[1]) : "";
}

function stripHTML(v) {
  return decodeXml(v)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function imageFromHTML(v) {
  const m = String(v || "").match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? decodeXml(m[1]) : null;
}

function slugFromURL(link, guid) {
  try {
    const p = new URL(link).pathname.split("/").filter(Boolean);
    if (p.length) return p[p.length - 1];
  } catch {}

  return clean(guid, 200);
}

function getComicsDownloadEndpoint(link) {
  return `${WORKER}/api/getcomics/downloads?url=${encodeURIComponent(link)}`;
}

function _normalizeGCPost(x) {
  const link = x.url || "";

  const rawTitle =
    typeof x.title === "string"
      ? x.title
      : x.title?.rendered || "";

  const originalTitle = stripHTML(rawTitle) || "Untitled release";

  return {
    id: String(x.id || slugFromURL(link, "")),
    title: `[GetComics] ${originalTitle}`,
    original_title: originalTitle,
    description: stripHTML(x.excerpt?.rendered || x.description || ""),
    cover: imageFromHTML(x.excerpt?.rendered || "") || null,
    provider: "getcomics",
    provider_name: "GetComics",
    access_type: "free",
    author: "",
    format: "comic",
    date: x.date || null,
    url: link,
    source_url: link,
    content_type: "release_listing",
    download_available: true,
    download_links_url: getComicsDownloadEndpoint(link)
  };
}

function _normalizeGCRSS(block) {
  const originalTitle =
    stripHTML(xmlField(block, "title")) || "Untitled release";

  const link = xmlField(block, "link");
  const guid = xmlField(block, "guid");

  const desc =
    xmlField(block, "content:encoded") ||
    xmlField(block, "description");

  const categories = [
    ...block.matchAll(/<category(?:\s[^>]*)?>([\s\S]*?)<\/category>/gi)
  ].map(m => stripHTML(m[1]));

  const id = slugFromURL(link, guid);

  return {
    id,
    title: `[GetComics] ${originalTitle}`,
    original_title: originalTitle,
    description: stripHTML(desc).slice(0, 2500),
    cover: imageFromHTML(desc),
    categories,
    date: xmlField(block, "pubDate") || null,
    author: xmlField(block, "dc:creator") || "",
    provider: "getcomics",
    provider_name: "GetComics",
    access_type: "free",
    format: "comic",
    url: link,
    source_url: link,
    content_type: "release_listing",
    download_available: true,
    download_links_url: getComicsDownloadEndpoint(link)
  };
}

async function getGCRSS() {
  const r = await fetch(CONFIG.GETCOMICS_FEED, {
    headers: {
      Accept: "application/rss+xml, application/xml, text/xml",
      "User-Agent": `Audiohub-Comics/${CONFIG.VERSION}`
    },
    cf: {
      cacheTtl: CONFIG.CACHE_SECONDS,
      cacheEverything: true
    }
  });

  if (!r.ok) throw new Error(`GetComics RSS HTTP ${r.status}`);

  const xml = await r.text();

  return [
    ...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)
  ]
    .map(m => normalizeGCRSS(m[1]))
    .filter(x => x.id && x.url);
}

async function searchGetComics(q, limit) {
  try {
    const p = new URLSearchParams({
      search: q,
      per_page: String(Math.min(limit, 20)),
      page: "1",
      type: "post",
      subtype: "post"
    });

    const d = await getJSON(`${CONFIG.GETCOMICS_SEARCH}?${p}`);

    const results = (Array.isArray(d) ? d : [])
      .map(normalizeGCPost)
      .filter(x => x.title && x.url);

    return {
      success: true,
      source: "getcomics",
      query: q,
      total: results.length,
      results,
      search_scope: "GetComics WordPress public search results"
    };
  } catch (e) {
    const feed = await getGCRSS();
    const term = q.toLowerCase();

    const results = feed.filter(x =>
      [x.original_title, x.description, x.author, ...(x.categories || [])]
        .join(" ")
        .toLowerCase()
        .includes(term)
    );

    return {
      success: true,
      source: "getcomics",
      query: q,
      total: results.length,
      results: results.slice(0, limit),
      search_scope: "RSS fallback; current feed entries only",
      fallback_reason: e.message
    };
  }
}

async function getComicsLatest(limit) {
  const results = await getGCRSS();

  return {
    success: true,
    source: "getcomics",
    total: results.length,
    results: results.slice(0, limit)
  };
}

/* GETCOMICS DOWNLOAD LINK DISCOVERY */

async function getComicsDownloads(pageUrl) {
  let page;

  try {
    page = new URL(pageUrl);
  } catch {
    throw new Error("Invalid GetComics release URL");
  }

  // FIX (2.4.1): plain host names. 2.4.0 had a pasted Markdown link here, so www.getcomics.org was refused.
  if (
    page.protocol !== "https:" ||
    !CONFIG.GETCOMICS_HOSTS.includes(page.hostname.toLowerCase())
  ) {
    throw new Error("Only GetComics release pages are supported");
  }

  const response = await fetch(page.href, {
    headers: {
      "User-Agent": `Mozilla/5.0 Audiohub-Comics/${CONFIG.VERSION}`,
      Accept: "text/html"
    },
    redirect: "follow"
  });

  if (!response.ok) {
    throw new Error(`GetComics page returned HTTP ${response.status}`);
  }

  const html = await response.text();

  const links = [];
  const seen = new Set();

  const anchors = [
    ...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)
  ];

  for (const match of anchors) {
    let href = match[1];

    try {
      href = new URL(href, page.href).href;
    } catch {
      continue;
    }

    if (!/^https?:\/\//i.test(href)) continue;
    if (seen.has(href)) continue;

    const label = stripHTML(match[2]).slice(0, 150);

    let host = "";

    try {
      host = new URL(href).hostname.toLowerCase();
    } catch {
      continue;
    }

    const relevant =
      /download|mirror|mega|mediafire|pixeldrain|1fichier|terabox|viking|rapidgator|filecrypt|katfile|gofile|turbobit|nitroflare/i.test(
        `${label} ${host} ${href}`
      );

    if (!relevant) continue;

    seen.add(href);

    links.push({
      label: label || host,
      host,
      url: href,
      direct_file: /\.(cbz|cbr|zip|pdf|epub)(?:[?#]|$)/i.test(href)
    });
  }

  // Follow the main "download" links (not mirror sites) to see where they end: a comic file → direct.
  await Promise.all(
    links
      .filter(l => !l.direct_file && (CONFIG.GETCOMICS_HOSTS.includes(l.host) || /download now|main server|direct/i.test(l.label)))
      .slice(0, 6)
      .map(async l => {
        const end = await finalFile(l.url);
        if (end) {
          l.page_url = l.url;
          l.url = end.url;
          l.direct_file = true;
          if (end.name) l.file_name = end.name;
        }
      })
  );

  // Direct files first.
  links.sort((a, b) => Number(b.direct_file) - Number(a.direct_file));

  return {
    success: true,
    source: "getcomics",
    provider_name: "GetComics",
    access_type: "free",
    release_url: page.href,
    total: links.length,
    links,
    note: "These are links discovered on the release page. Some may lead to mirror pages rather than direct files."
  };
}

/**
 * Where a link ends, following redirects by hand (up to 4, 5 s in all) with HEAD requests — no file
 * is downloaded. { url, name } when it ends at a comic / PDF / EPUB / ZIP file, else null.
 */
async function finalFile(start) {
  const FILE = /\.(cbz|cbr|cb7|zip|rar|pdf|epub)(?:[?#]|$)/i;
  const until = Date.now() + 5000;
  let url = start;
  for (let hop = 0; hop < 5 && Date.now() < until; hop++) {
    if (FILE.test(new URL(url).pathname)) return { url, name: decodeURIComponent(new URL(url).pathname.split("/").pop() || "") };
    let r;
    try {
      r = await fetch(url, {
        method: "HEAD",
        redirect: "manual",
        headers: { "User-Agent": `Mozilla/5.0 Audiohub-Comics/${CONFIG.VERSION}`, Referer: "https://getcomics.org/" },
        signal: AbortSignal.timeout(Math.max(500, until - Date.now()))
      });
    } catch {
      return null;
    }
    const loc = r.headers.get("Location");
    if (r.status >= 300 && r.status < 400 && loc) {
      url = new URL(loc, url).href;
      continue;
    }
    if (!r.ok) return null;
    // No redirect: a file if the server says so (a download name, or a comic / archive type).
    const cd = r.headers.get("Content-Disposition") || "";
    const ct = (r.headers.get("Content-Type") || "").toLowerCase();
    const name = (/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd) || [])[1] || "";
    if ((name && FILE.test(name)) || /comicbook|zip|rar|x-cbr|x-cbz|pdf|epub|octet-stream/.test(ct)) {
      return { url, name: name ? decodeURIComponent(name) : "" };
    }
    return null;
  }
  return null;
}

/* INTERNET ARCHIVE DOWNLOAD OPTIONS (same shape as GetComics') */

async function archiveDownloads(request, id) {
  const d = await archiveFiles(request, id);
  const links = d.files
    .filter(f => /^(CBZ|CBR|PDF|EPUB|ZIP)$/.test(f.format))
    .map(f => ({ label: f.name, host: "archive.org", url: f.download_url, direct_file: true, format: f.format, size_bytes: f.size_bytes }));
  return {
    success: true,
    source: "internet_archive",
    provider_name: "Internet Archive",
    release_url: `https://archive.org/details/${encodeURIComponent(id)}`,
    total: links.length,
    links
  };
}

const normalizeArchive = (x) => unify(_normalizeArchive(x));
const normalizeGCPost = (x) => unify(_normalizeGCPost(x));
const normalizeGCRSS = (x) => unify(_normalizeGCRSS(x));
/* ONE RESULT SHAPE FOR EVERY SOURCE
   Every result carries the same fields; a source that doesn't know one leaves it null
   (never guessed). The older fields (url, source_url, download_links_url…) stay too, so
   apps that read them keep working. */

const ACCESS = ["free", "free_with_account", "subscription", "purchase", "library", "metadata", "unknown"];

function unify(x) {
  const pick = (...v) => v.find(a => a !== undefined && a !== null && a !== "") ?? null;
  const access = ACCESS.includes(x.access_type) ? x.access_type : "unknown";
  return {
    ...x,
    id: pick(x.id),
    provider: pick(x.provider),
    provider_name: pick(x.provider_name),
    title: pick(x.title, x.original_title, "Untitled"),
    original_title: pick(x.original_title, x.title),
    author: pick(x.author, x.creator),
    creator: pick(x.creator, x.author),
    publisher: pick(x.publisher),
    description: pick(x.description),
    cover: pick(x.cover),
    series: pick(x.series),
    issue_number: pick(x.issue_number),
    issue_count: pick(x.issue_count),
    genres: Array.isArray(x.genres) ? x.genres : [],
    language: pick(x.language),
    publication_date: pick(x.publication_date, x.date, x.year),
    content_type: pick(x.content_type, "comic"),
    access_type: access,
    reading_url: pick(x.reading_url),
    download_available: x.download_available === true,
    download_options_url: pick(x.download_options_url, x.download_links_url),
    external_url: pick(x.external_url, x.source_url, x.url)
  };
}

/* TEXT FETCH (sitemaps), cached at Cloudflare's edge */

async function getText(url, ttl = CONFIG.CACHE_SECONDS) {
  const r = await fetch(url, {
    headers: { "User-Agent": `Mozilla/5.0 (compatible; Audiohub-Comics/${CONFIG.VERSION})`, Accept: "text/xml,application/xml,text/html;q=0.8,*/*;q=0.5" },
    cf: { cacheTtl: ttl, cacheEverything: true }
  });
  const text = await r.text();
  // A bot-check page: say so instead of pretending nothing was found.
  if (/_cf_chl_opt|cf-browser-verification|Just a moment\.\.\./.test(text.slice(0, 20000))) {
    throw new Error(`${new URL(url).hostname} showed its bot check to the server — open it in the browser instead`);
  }
  if (!r.ok) throw new Error(`${new URL(url).hostname} answered HTTP ${r.status}`);
  return text;
}

/* READCOMICSONLINE
   The site's own pages (search, series, reader) are behind Cloudflare's "managed challenge",
   which only a real browser passes. Its sitemaps are open to everyone (robots.txt points to
   them), and list every series (title, cover) and every issue's address — that's what this
   searches. Reading opens the issue's page in the browser; the site offers no files. */

const RCO = "https://readcomicsonline.ru";
const RCO_TTL = 6 * 3600; // the sitemaps change a few times a day

function slugify(v) {
  return String(v || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// "Batman (2016-)" → 2016
const yearOf = (caption) => (/\((\d{4})/.exec(caption || "") || [])[1] || null;

function rcoEntry(text, at) {
  const end = text.indexOf("</url>", at);
  const block = text.slice(at, end < 0 ? at + 2000 : end);
  const slug = (/\/comic\/([^<\/]+)<\/loc>/.exec(block) || [])[1] || "";
  const caption = decodeXml((/<image:caption>([\s\S]*?)<\/image:caption>/.exec(block) || [])[1] || "").trim();
  const cover = decodeXml((/<image:loc>([^<]+)<\/image:loc>/.exec(block) || [])[1] || "").trim();
  const lastmod = (/<lastmod>([^<]+)<\/lastmod>/.exec(block) || [])[1] || null;
  return { slug, caption, cover, lastmod };
}

function rcoResult(e) {
  const title = e.caption || e.slug.replace(/-/g, " ");
  const page = `${RCO}/comic/${e.slug}`;
  return unify({
    id: `readcomicsonline:${e.slug}`,
    provider: "readcomicsonline",
    provider_name: "ReadComicsOnline",
    title: `[ReadComicsOnline] ${title}`,
    original_title: title,
    series: title.replace(/\s*\(\d{4}[^)]*\)\s*$/, ""),
    cover: e.cover || null,
    publication_date: yearOf(title),
    date: e.lastmod,
    format: "comic",
    content_type: "series",
    access_type: "free",
    reading_url: page,
    external_url: page,
    url: page,
    source_url: page,
    download_available: false,
    issues_url: `${WORKER}/api/readcomicsonline/series?slug=${encodeURIComponent(e.slug)}`,
    reader: "browser",
    reader_note: "Opens in the browser: the site checks every visitor (Cloudflare), so its pages can't be shown inside the app."
  });
}

async function searchReadComicsOnline(q, limit) {
  const text = await getText(`${RCO}/sitemap-comics.xml`, RCO_TTL);
  const want = slugify(q);
  const words = want.split("-").filter(w => w.length > 1 || /\d/.test(w));
  if (!words.length) return { success: true, source: "readcomicsonline", total: 0, results: [] };
  const marker = `<loc>${RCO}/comic/`;
  const hits = [];
  // Addresses are lowercase slugs ("the-amazing-spider-man-2018"): matched word by word,
  // so the whole list is read once without decoding every entry.
  for (let i = text.indexOf(marker); i >= 0; i = text.indexOf(marker, i + marker.length)) {
    const s = i + marker.length;
    const slug = text.slice(s, text.indexOf("<", s));
    const parts = slug.split("-");
    if (!words.every(w => parts.includes(w))) continue;
    const base = slug.replace(/-\d{4}$/, "");
    const score = base === want ? 3 : base.startsWith(want + "-") || slug.startsWith(want) ? 2 : 1;
    hits.push({ at: text.lastIndexOf("<url>", i), score, slug });
  }
  hits.sort((a, b) => b.score - a.score || a.slug.length - b.slug.length);
  const results = hits.slice(0, limit).map(h => rcoResult(rcoEntry(text, h.at))).filter(r => r.reading_url);
  return {
    success: true,
    source: "readcomicsonline",
    provider_name: "ReadComicsOnline",
    query: q,
    total: hits.length,
    results,
    search_scope: "Series titles from the site's public sitemap (its search page is behind a bot check)"
  };
}

async function rcoSeries(slug) {
  slug = slugify(slug);
  if (!slug) throw new Error("Missing series");
  const comics = await getText(`${RCO}/sitemap-comics.xml`, RCO_TTL);
  const at = comics.indexOf(`<loc>${RCO}/comic/${slug}</loc>`);
  if (at < 0) throw new Error("Series not found on ReadComicsOnline");
  const series = rcoResult(rcoEntry(comics, comics.lastIndexOf("<url>", at)));

  // Every issue's address is in the chapter sitemaps the index lists.
  const index = await getText(`${RCO}/sitemap.xml`, RCO_TTL);
  const maps = [...index.matchAll(/<loc>([^<]*sitemap-chapters[^<]*)<\/loc>/g)].map(m => m[1]).slice(0, 6);
  const seen = new Set();
  const issues = [];
  const marker = `${RCO}/comic/${slug}/`;
  for (const map of maps) {
    const text = await getText(map, RCO_TTL);
    for (let i = text.indexOf(marker); i >= 0; i = text.indexOf(marker, i + marker.length)) {
      const s = i + marker.length;
      const end = text.indexOf("<", s);
      const num = decodeXml(text.slice(s, end));
      if (!num || num.includes("/") || seen.has(num)) continue;
      seen.add(num);
      const lastmod = (/^<\/loc>\s*<lastmod>([^<]+)/.exec(text.slice(end, end + 80)) || [])[1] || null;
      const page = `${marker}${num}`;
      issues.push({
        id: `readcomicsonline:${slug}:${num}`,
        issue_number: num,
        title: `${series.series} #${num.replace(/-/g, ".")}`,
        reading_url: page,
        external_url: page,
        date: lastmod,
        access_type: "free",
        download_available: false
      });
    }
  }
  const n = (v) => parseFloat(String(v).replace(/-/g, ".")) || 0;
  issues.sort((a, b) => n(b.issue_number) - n(a.issue_number) || String(b.issue_number).localeCompare(String(a.issue_number)));
  return {
    success: true,
    source: "readcomicsonline",
    provider_name: "ReadComicsOnline",
    series: { ...series, issue_count: issues.length },
    total: issues.length,
    issues,
    reader: "browser",
    reader_note: series.reader_note
  };
}

/* KITSU (manga titles, covers and synopses only — nothing to read or download) */

function normalizeKitsu(item) {
  const a = item.attributes || {};
  const t = a.titles || {};
  const originalTitle = a.canonicalTitle || t.en || t.en_jp || t.ja_jp || "Untitled";
  const page = `https://kitsu.io/manga/${a.slug || item.id}`;
  return unify({
    id: `kitsu:${item.id}`,
    provider: "kitsu",
    provider_name: "Kitsu",
    title: `[Kitsu] ${originalTitle}`,
    original_title: originalTitle,
    alternate_titles: t,
    description: a.synopsis || a.description || "",
    cover: a.posterImage?.large || a.posterImage?.original || a.posterImage?.medium || null,
    format: a.mangaType || a.subtype || "manga",
    status: a.status || null,
    issue_count: a.chapterCount ?? null,
    volume_count: a.volumeCount ?? null,
    date: a.startDate || null,
    rating: a.averageRating || null,
    url: page,
    source_url: page,
    external_url: page,
    content_type: "metadata_only",
    access_type: "metadata",
    download_available: false
  });
}

async function searchKitsu(q, limit) {
  const p = new URLSearchParams();
  p.set("filter[text]", q);
  p.set("page[limit]", String(Math.min(limit, 20)));
  const d = await getJSON(`${CONFIG.KITSU_API}/manga?${p}`, { Accept: "application/vnd.api+json" });
  const results = (d.data || []).map(normalizeKitsu);
  return { success: true, source: "kitsu", provider_name: "Kitsu", total: d.meta?.count ?? results.length, results };
}

async function kitsuItem(id) {
  const d = await getJSON(`${CONFIG.KITSU_API}/manga/${encodeURIComponent(id)}`, { Accept: "application/vnd.api+json" });
  if (!d.data) throw new Error("Not found on Kitsu");
  return { success: true, source: "kitsu", result: normalizeKitsu(d.data) };
}

/* GLOBALCOMIX and COMICS PLUS — opened in their own reader, never searched by this server
   GlobalComix: no public API, its terms forbid robots / scrapers and framing, and the RSS
   search its OpenSearch file names now redirects to a script-drawn page. Its own search
   (the OpenSearch address) is offered as a link; free, member and paid comics stay under
   GlobalComix's own sign-in and checks.
   Comics Plus (LibraryPass): its catalogue API is licensed to libraries (they ask LibraryPass
   support), not to readers, and each library has its own sign-in. Your library's Comics Plus
   link stays in the app on your phone; your card number only ever goes into Comics Plus's
   own sign-in page. Nothing about it reaches this server. */

const WEB_ONLY = {
  globalcomix: {
    provider_name: "GlobalComix",
    open_url: (q) => `https://globalcomix.com/search?q=${encodeURIComponent(q)}`,
    message: "GlobalComix can't be searched by apps (no public API; its terms forbid automated access) — open its own search instead"
  },
  comicsplus: {
    provider_name: "Comics Plus",
    open_url: () => null,
    message: "Comics Plus is searched in your library's own Comics Plus (its catalogue API is only licensed to libraries) — add your library's link in the app"
  }
};

function webOnly(id, q) {
  const s = WEB_ONLY[id];
  return {
    success: true,
    source: id,
    provider_name: s.provider_name,
    searchable: false,
    query: q,
    total: 0,
    results: [],
    open_url: s.open_url(q),
    message: s.message,
    errors: { [id]: s.message }
  };
}

/* SOURCE REGISTRY */

function sources() {
  return [
    {
      id: "getcomics",
      name: "GetComics",
      status: "active",
      in_all: true,
      capabilities: ["full_site_search", "rss_latest", "release_links", "download_link_discovery", "direct_file_detection"],
      note: "Search uses the public WordPress endpoint, with RSS fallback. Download links are found on release pages; main download links are followed to the file when they lead to one, mirrors stay pages."
    },
    {
      id: "internet_archive",
      name: "Internet Archive",
      status: "active",
      in_all: true,
      capabilities: ["search", "metadata", "file_listing", "streaming", "download"],
      note: "Access depends on each item's rights and lending restrictions."
    },
    {
      id: "readcomicsonline",
      name: "ReadComicsOnline",
      status: "active",
      in_all: true,
      capabilities: ["series_search", "covers", "issue_list", "read_in_browser"],
      note: "Searched through the site's public sitemaps; its pages are behind a Cloudflare bot check, so issues open in the browser. The site offers no downloads."
    },
    {
      id: "kitsu",
      name: "Kitsu",
      status: "active",
      in_all: false,
      capabilities: ["search", "metadata"],
      note: "Manga titles, covers and synopses only — nothing to read or download. Not part of source=all."
    },
    {
      id: "globalcomix",
      name: "GlobalComix",
      status: "web_only",
      in_all: false,
      capabilities: ["open_official_search"],
      note: "No public API and its terms forbid automated access, so it isn't searched here; the app opens GlobalComix's own search, where its sign-in and subscriptions apply."
    },
    {
      id: "comicsplus",
      name: "Comics Plus (LibraryPass)",
      status: "web_only",
      in_all: false,
      capabilities: ["open_library_site"],
      note: "The catalogue API is licensed to libraries, not readers. The app opens your library's Comics Plus; your card number never reaches this server."
    }
  ];
}

/* AUDIOHUB MANIFEST */

function manifest(base) {
  return {
    schemaVersion: 1,
    id: "audiohub-comics",
    name: "Audiohub Comics",
    version: CONFIG.VERSION,
    description: "Comics from GetComics, the Internet Archive and ReadComicsOnline — download options, issue lists and reading links inside the app — plus GlobalComix and your library's Comics Plus.",
    icon: "https://archive.org/images/glogo.jpg",
    provides: ["source"],
    contentType: "comic",
    rateLimit: {
      requests: 30,
      perSeconds: 60
    },
    matching: {
      title: true,
      author: false
    },
    // Asked in Settings → Addons and kept on the phone. No "header", so it's never sent to
    // this server: the app only opens it.
    userConfig: {
      note: "Optional: the Comics Plus link your library gives you (on its website, under eBooks / digital comics). You sign in there with your library card.",
      fields: [
        { key: "library_link", label: "Your library's Comics Plus link", placeholder: "https://…", optional: true }
      ]
    },
    // Searches the app opens in the browser (these sites can't be searched by a server).
    webSearch: [
      { name: "GlobalComix", url: "https://globalcomix.com/search?q={TITLE}", note: "Free, member and paid comics — read in GlobalComix" },
      { name: "Comics Plus", url: "{library_link}", needs: "library_link", note: "Your library's comics — sign in with your card" }
    ],
    adapters: {
      source: {
        request: {
          method: "GET",
          url: `${base}/api/search?q={TITLE}&source=all&limit=20`,
          timeout: 30000,
          headers: {
            Accept: "application/json"
          }
        },
        response: {
          type: "json",
          resultsPath: "results",
          mapping: {
            title: "title",
            author: "author",
            url: "source_url",
            format: "format",
            date: "date",
            cover: "cover",
            description: "description",
            // The fields the app uses for the provider label, access and reading / download actions.
            provider_name: "provider_name",
            original_title: "original_title",
            publisher: "publisher",
            access_type: "access_type",
            reading_url: "reading_url",
            external_url: "external_url",
            issue_count: "issue_count",
            publication_date: "publication_date",
            issues_url: "issues_url",
            reader: "reader",
            download_available: "download_available",
            download_links_url: "download_links_url"
          }
        }
      }
    }
  };
}

/* ROUTER */

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    if (!["GET", "HEAD"].includes(request.method)) {
      return error("Method not allowed", 405);
    }

    const u = new URL(request.url);
    const path = u.pathname;
    const q = clean(u.searchParams.get("q"), 120);

    const limit = Math.min(
      Math.max(Number(u.searchParams.get("limit")) || 10, 1),
      CONFIG.MAX_RESULTS
    );

    try {
      if (path === "/" || path === "/health") {
        return json({
          success: true,
          name: CONFIG.NAME,
          version: CONFIG.VERSION,
          status: "online",
          manifest: `${u.origin}/manifest.json`,
          sources: sources()
        });
      }

      if (path === "/manifest.json") {
        return json(manifest(u.origin));
      }

      if (path === "/api/sources") {
        return json({
          success: true,
          sources: sources()
        });
      }

      if (path === "/api/getcomics/latest") {
        return json(await getComicsLatest(limit));
      }

      if (path === "/api/getcomics/search") {
        if (!q) return error("Missing query. Use ?q=batman");

        return json(await searchGetComics(q, limit));
      }

      if (path === "/api/archive/downloads") {
        const id = clean(u.searchParams.get("id"), 200);
        if (!id) return error("Missing Internet Archive item id");
        return json(await archiveDownloads(request, id));
      }

      if (path === "/api/getcomics/downloads") {
        const pageUrl = u.searchParams.get("url");

        if (!pageUrl) {
          return error("Missing release URL");
        }

        return json(await getComicsDownloads(pageUrl));
      }

      if (path === "/api/readcomicsonline/search") {
        if (!q) return error("Missing query. Use ?q=batman");
        return json(await searchReadComicsOnline(q, limit));
      }

      if (path === "/api/readcomicsonline/series" || path === "/api/readcomicsonline/issues") {
        const slug = clean(u.searchParams.get("slug"), 150);
        if (!slug) return error("Missing series. Use ?slug=batman-2016");
        return json(await rcoSeries(slug));
      }

      if (path === "/api/kitsu/search") {
        if (!q) return error("Missing query. Use ?q=one%20piece");
        return json(await searchKitsu(q, limit));
      }

      if (path === "/api/kitsu/item") {
        const id = clean(u.searchParams.get("id"), 40).replace(/^kitsu:/, "");
        if (!id) return error("Missing Kitsu id");
        return json(await kitsuItem(id));
      }

      if (path === "/api/globalcomix/search" || path === "/api/comicsplus/search") {
        return json(webOnly(path.split("/")[2], q));
      }

      if (path === "/api/search") {
        if (!q) return error("Missing search query. Use ?q=batman");

        const source = u.searchParams.get("source") || "all";

        const valid = ["all", "internet_archive", "getcomics", "readcomicsonline", "kitsu", "globalcomix", "comicsplus"];

        if (!valid.includes(source)) {
          return error("Unsupported source");
        }

        const tasks = [];

        const add = (name, fn) => {
          tasks.push({ name, promise: fn() });
        };

        if (source === "all" || source === "getcomics") {
          add("getcomics", () => searchGetComics(q, limit));
        }

        if (source === "all" || source === "internet_archive") {
          add("internet_archive", () => searchArchive(q, limit));
        }

        if (source === "all" || source === "readcomicsonline") {
          add("readcomicsonline", () => searchReadComicsOnline(q, limit));
        }

        if (source === "kitsu") {
          add("kitsu", () => searchKitsu(q, limit));
        }

        if (source === "globalcomix" || source === "comicsplus") {
          add(source, async () => webOnly(source, q));
        }

        const settled = await Promise.allSettled(
          tasks.map(t => t.promise)
        );

        const groups = settled.map((r, i) =>
          r.status === "fulfilled"
            ? r.value
            : {
                success: false,
                source: tasks[i].name,
                error: r.reason?.message || "Source failed",
                results: []
              }
        );

        // Taken in turns from each source (best of each first), so one site doesn't fill the top.
        const lists = groups.map(g => g.results || []);
        const results = [];
        for (let i = 0; i < Math.max(0, ...lists.map(l => l.length)); i++) {
          for (const l of lists) if (l[i]) results.push(l[i]);
        }

        return json({
          success: true,
          query: q,
          source,
          total: results.length,
          sources: groups,
          results,
          // Searches to open in the browser (sites this server can't search).
          web_search: [{ name: "GlobalComix", url: WEB_ONLY.globalcomix.open_url(q) }]
        });
      }

      const gcItem = path.match(
        /^\/api\/getcomics\/item\/([^/]+)$/
      );

      if (gcItem) {
        const feed = await getGCRSS();

        const found = feed.find(
          x => x.id === decodeURIComponent(gcItem[1])
        );

        if (!found) {
          return error("Release not found in current RSS feed", 404);
        }

        return json({
          success: true,
          source: "getcomics",
          result: found
        });
      }

      const filesMatch = path.match(
        /^\/api\/item\/([^/]+)\/files$/
      );

      if (filesMatch) {
        return json(
          await archiveFiles(
            request,
            decodeURIComponent(filesMatch[1])
          )
        );
      }

      const fileMatch = path.match(
        /^\/api\/file\/([^/]+)\/(.+)$/
      );

      if (fileMatch) {
        const id = decodeURIComponent(fileMatch[1]);
        const filename = safeName(
          decodeURIComponent(fileMatch[2])
        );

        if (!supportedFile(filename)) {
          return error("Unsupported file format", 415);
        }

        return serveArchiveFile(request, id, filename);
      }

      const itemMatch = path.match(/^\/api\/item\/([^/]+)$/);

      if (itemMatch) {
        return json(
          await archiveItem(decodeURIComponent(itemMatch[1]))
        );
      }

      return error("Route not found", 404);

    } catch (e) {
      return json({
        success: false,
        error: e?.message || "Worker error"
      }, 500);
    }
  }
};
