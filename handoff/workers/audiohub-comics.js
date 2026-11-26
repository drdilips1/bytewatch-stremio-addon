// Audiohub Comics — Cloudflare Worker, version 2.8.4
// Sources: GetComics and the Internet Archive (searched; download options with direct files),
// Weeb Central (manga: search, chapter lists and chapter pages for the app's comic reader),
// and Comics Plus (your library's own reader, opened by the app — never searched here).
// Changes from 2.8.3: results come with their covers and details — GetComics through its posts
// (featured image, the "Year : 2026 | Size : 127 MB" line, the blurb, the publisher from the
// address: /dc/, /marvel/…), the Internet Archive with each item's own thumbnail.
// Changes from 2.8.2: GetComics download options also give the release's details from its page —
// size, year, language, format ("Language : English | Image Format : JPG | Year : 2026 | Size : 127 MB")
// — so the app can show them and how much of the file has come.
// Changes from 2.8.1: GetComics download options list only real downloads — not "How To Download",
// reader apps (YAC Reader, ComicRack, CDisplayEx, 7-Zip…) or "Related Article" links.
// Changes from 2.7.1: ReadComicsOnline and Kitsu removed, with their routes (the user keeps
// GetComics, Weeb Central, Internet Archive and Comics Plus).
// Kept: one result shape for every source (unify), GetComics search + release download options
// with direct-file detection, Internet Archive comics only (CBZ / CBR, every title word, CBZ first),
// Weeb Central search / series / chapter pages, the Comics Plus link in the manifest.

const CONFIG = {
  NAME: "Audiohub Comics",
  VERSION: "2.8.4",
  ARCHIVE_API: "https://archive.org",
  GETCOMICS_FEED: "https://getcomics.org/feed/",
  GETCOMICS_SEARCH: "https://getcomics.org/wp-json/wp/v2/posts",
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
    // Every Internet Archive item has a thumbnail (a comic's cover).
    cover: `https://archive.org/services/img/${encodeURIComponent(x.identifier)}`,
    url: `https://archive.org/details/${encodeURIComponent(x.identifier)}`,
    source_url: `https://archive.org/details/${encodeURIComponent(x.identifier)}`,
    availability: "Check individual item access and file rights",
    download_available: true,
    download_links_url: `${WORKER}/api/archive/downloads?id=${encodeURIComponent(x.identifier)}`
  };
}

// "Batman: Under the Red Hood" → batman AND under AND red AND hood (small words left out).
function archiveWords(q) {
  const small = new Set(["the", "a", "an", "of", "and", "or", "to", "in", "on", "vol", "volume"]);
  const words = String(q).toLowerCase().replace(/[^\p{L}\p{N}\s'-]+/gu, " ").split(/\s+/).filter((w) => w && !small.has(w)).slice(0, 8);
  return words.length ? words.map((w) => `"${w.replace(/"/g, "")}"`).join(" AND ") : `"${String(q).replace(/"/g, "")}"`;
}

async function searchArchive(q, limit) {
  const params = new URLSearchParams({
    // Only items with comic files: a "Batman" title alone also finds theses, magazines and scans.
    // Every word of the title must be there ("under the red hood": not any Batman), and only
    // items with comic files.
    q: `mediatype:texts AND title:(${archiveWords(q)}) AND (format:"Comic Book ZIP" OR format:"Comic Book RAR" OR format:CBZ OR format:CBR)`,
    fl: "identifier,title,description,creator,year,mediatype,format",
    rows: String(Math.min(limit * 2, 50)),
    page: "1",
    output: "json"
  });

  const d = await getJSON(`${CONFIG.ARCHIVE_API}/advancedsearch.php?${params}`);
  const docs = d.response?.docs || [];

  return {
    success: true,
    source: "internet_archive",
    total: d.response?.numFound || docs.length,
    // CBZ first: they open in the app's comic reader (CBR can only be saved for now).
    results: docs
      .map((x) => ({ x, cbz: [].concat(x.format || []).some((f) => /Comic Book ZIP|^CBZ$/i.test(f)) }))
      .sort((a, b) => b.cbz - a.cbz)
      .slice(0, limit)
      .map(({ x, cbz }) => ({ ...normalizeArchive(x), format: cbz ? "CBZ" : "CBR" }))
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

// GetComics' address says the publisher: getcomics.org/dc/…, /marvel/…, /image/…
const GC_PUBLISHERS = { dc: "DC", marvel: "Marvel", image: "Image", "dark-horse": "Dark Horse", idw: "IDW", boom: "BOOM! Studios", "boom-studios": "BOOM! Studios", dynamite: "Dynamite", valiant: "Valiant", manga: "Manga", "indie": "Indie" };
// "Year : 2026 | Size : 127 MB FRACTION & CHING REACH…" → { year, size, sizeBytes, blurb }
function gcDetails(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  const year = (/Year\s*:\s*(\d{4})/i.exec(t) || [])[1] || null;
  const size = (/Size\s*:\s*([\d.,]+\s*(?:KB|MB|GB))/i.exec(t) || [])[1] || null;
  const m = /([\d.,]+)\s*(KB|MB|GB)/i.exec(size || "");
  const sizeBytes = m ? Math.round(parseFloat(m[1].replace(",", ".")) * { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 }[m[2].toUpperCase()]) : null;
  const blurb = t.replace(/^.*?Size\s*:\s*[\d.,]+\s*(?:KB|MB|GB)\s*/i, "").replace(/^Year\s*:\s*\d{4}\s*\|?\s*/i, "").trim();
  return { year, size, sizeBytes, blurb };
}

function _normalizeGCPost(x) {
  const link = x.url || x.link || "";

  const rawTitle =
    typeof x.title === "string"
      ? x.title
      : x.title?.rendered || "";

  const originalTitle = stripHTML(rawTitle) || "Untitled release";

  return {
    id: String(x.id || slugFromURL(link, "")),
    title: `[GetComics] ${originalTitle}`,
    original_title: originalTitle,
    ...(() => {
      const d = gcDetails(stripHTML(x.excerpt?.rendered || x.description || ""));
      const section = (() => {
        try {
          return new URL(link).pathname.split("/").filter(Boolean)[0] || "";
        } catch {
          return "";
        }
      })();
      return {
        description: d.blurb.slice(0, 400),
        publication_date: d.year,
        size: d.size,
        size_bytes: d.sizeBytes,
        publisher: GC_PUBLISHERS[section] || null
      };
    })(),
    cover: x.jetpack_featured_media_url || x.yoast_head_json?.og_image?.[0]?.url || imageFromHTML(x.excerpt?.rendered || "") || null,
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
    // Posts (not the bare search list): each comes with its cover and its details line.
    const p = new URLSearchParams({
      search: q,
      per_page: String(Math.min(limit, 20)),
      page: "1",
      _fields: "id,title,link,date,excerpt,jetpack_featured_media_url,yoast_head_json.og_image"
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

// A real download on a GetComics release page: its own download / mirror buttons ("Download Now",
// "Mirror Download", /dls/ links) or a file host — not the "How To Download" guide, the reader
// apps it recommends (YAC Reader, ComicRack, CDisplayEx, 7-Zip…) or "Related Article" posts.
const FILE_HOSTS = /mega\.nz|mediafire|pixeldrain|1fichier|terabox|vikingfile|rapidgator|filecrypt|katfile|gofile|turbobit|nitroflare|krakenfiles|buzzheavier|send\.cm|userscloud|zippyshare|drive\.google|dropbox/i;
const NOT_DOWNLOADS = /how to download|related article|read online|yacreader|comicrack|cyolito|cdisplay|7-zip|7zip|rarlab|winrar|peazip|bandizip/i;
function isDownloadLink(label, host, href) {
  if (NOT_DOWNLOADS.test(`${label} ${host} ${href}`)) return false;
  if (CONFIG.GETCOMICS_HOSTS.includes(host)) {
    // On GetComics itself only its download buttons: /dls/ links, or labelled as a download / mirror / host.
    return /\/dls\//i.test(href) || /download now|main server|mirror|mega|mediafire|pixeldrain|terabox|viking|1fichier|gofile/i.test(label);
  }
  return FILE_HOSTS.test(`${host} ${href}`) || /\.(cbz|cbr|cb7|zip|rar|pdf|epub)(?:[?#]|$)/i.test(href);
}

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

    if (!isDownloadLink(label, host, href)) continue;

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

  // The release's details line: "Language : English | Image Format : JPG | Year : 2026 | Size : 127 MB".
  const text = stripHTML(html).replace(/\s+/g, " ");
  const field = (name) => (new RegExp(`${name}\\s*:\\s*([^|]{1,40}?)\\s*(?:\\||DOWNLOAD|$)`, "i").exec(text) || [])[1]?.trim() || null;
  const sizeLabel = field("Size");
  const m = /([\d.,]+)\s*(KB|MB|GB)/i.exec(sizeLabel || "");
  const sizeBytes = m ? Math.round(parseFloat(m[1].replace(",", ".")) * { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 }[m[2].toUpperCase()]) : null;
  const details = { language: field("Language"), year: field("Year"), image_format: field("Image Format"), size: sizeLabel, size_bytes: sizeBytes };
  // The main files are the whole release: their size is the release's size.
  for (const l of links) if (l.direct_file && sizeBytes && !l.size_bytes) l.size_bytes = sizeBytes;

  return {
    success: true,
    source: "getcomics",
    provider_name: "GetComics",
    access_type: "free",
    release_url: page.href,
    details,
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

/* COMICS PLUS — opened in its own reader, never searched by this server
   Comics Plus (LibraryPass): its catalogue API is licensed to libraries (they ask LibraryPass
   support), not to readers, and each library has its own sign-in. Your library's Comics Plus
   link stays in the app on your phone; your card number only ever goes into Comics Plus's
   own sign-in page. Nothing about it reaches this server. */

const WEB_ONLY = {
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

/* WEEB CENTRAL (manga)
   Its own search, series and chapter pages answer plain requests (no bot check; robots.txt
   allows everything, with a 10-second crawl delay — so answers are cached here and nothing is
   crawled ahead). A chapter's pages are plain picture links that load in any app, so chapters
   open in the app's own comic reader (right to left). Nothing is downloaded by this server. */

const WC = "https://weebcentral.com";
const WC_UA = `Mozilla/5.0 (compatible; Audiohub-Comics/${CONFIG.VERSION})`;

async function wcText(path, ttl) {
  const r = await fetch(`${WC}${path}`, {
    headers: { "User-Agent": WC_UA, Accept: "text/html,*/*;q=0.8", "HX-Request": "true" },
    cf: { cacheTtl: ttl, cacheEverything: true }
  });
  const text = await r.text();
  if (/_cf_chl_opt|Just a moment\.\.\./.test(text.slice(0, 20000))) throw new Error("Weeb Central showed its bot check to the server");
  if (!r.ok) throw new Error(`Weeb Central answered HTTP ${r.status}`);
  return text;
}

const strip = (v) => decodeXml(String(v || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
// What follows a label like "<strong class=…>Author(s): </strong>" up to the end of its row.
const after = (block, label) => {
  const m = new RegExp(`<strong[^>]*>\\s*${label}`).exec(block);
  if (!m) return "";
  const from = block.indexOf("</strong>", m.index) + 9;
  const end = block.indexOf("</div>", from);
  return block.slice(from, end < 0 ? from + 600 : end);
};

function wcResult(block) {
  const m = /href="https:\/\/weebcentral\.com\/series\/([0-9A-Z]{20,30})\/([^"]*)"/.exec(block);
  if (!m) return null;
  const [, id, slug] = m;
  const title = strip((new RegExp(`series/${id}/[^"]*">([^<]+)</a>`).exec(block) || [])[1]) ||
    strip((/alt="([^"]+?) cover"/.exec(block) || [])[1]) || slug.replace(/-/g, " ");
  const authors = [...after(block, "Author").matchAll(/>([^<>]+)<\/a>/g)].map((x) => strip(x[1])).filter(Boolean);
  const tags = [...after(block, "Tag").matchAll(/<span>([^<]+)<\/span>/g)].map((x) => strip(x[1]).replace(/,$/, "")).filter(Boolean);
  const year = strip(after(block, "Year:")) || null;
  const type = strip(after(block, "Type:")) || "Manga";
  const status = strip(after(block, "Status:")) || null;
  const page = `${WC}/series/${id}/${slug}`;
  return unify({
    id: `weebcentral:${id}`,
    provider: "weebcentral",
    provider_name: "Weeb Central",
    title: `[Weeb Central] ${title}`,
    original_title: title,
    series: title,
    author: authors.join(", "),
    creator: authors.join(", "),
    cover: `https://temp.compsci88.com/cover/fallback/${id}.jpg`,
    genres: tags,
    publication_date: /^\d{4}$/.test(year || "") ? year : null,
    status,
    format: type,
    content_type: "series",
    access_type: "free",
    language: "en",
    reading_url: page,
    external_url: page,
    url: page,
    source_url: page,
    download_available: false,
    issues_url: `${WORKER}/api/weebcentral/series?id=${id}&title=${encodeURIComponent(title)}`,
    reader: "app",
    // Manga and manhua read right to left; manhwa / webtoons top to bottom.
    reading_direction: /manhwa|webtoon/i.test(type) ? "vertical" : /manga/i.test(type) ? "rtl" : "ltr"
  });
}

async function searchWeebCentral(q, limit) {
  const p = new URLSearchParams({ text: q, sort: "Best Match", order: "Descending", official: "Any", display_mode: "Full Display" });
  const html = await wcText(`/search/data?${p}`, 600);
  const blocks = html.split(/<article class="bg-base-300 flex gap-4 p-4">/).slice(1);
  const results = blocks.map(wcResult).filter(Boolean).slice(0, limit);
  return { success: true, source: "weebcentral", provider_name: "Weeb Central", query: q, total: results.length, results };
}

async function wcSeries(id, title) {
  if (!/^[0-9A-Z]{20,30}$/.test(id)) throw new Error("Missing series");
  const html = await wcText(`/series/${id}/full-chapter-list`, 1800);
  const name = title || "Chapter";
  const chapters = [];
  const seen = new Set();
  for (const m of html.matchAll(/<a href="(?:https:\/\/weebcentral\.com)?\/chapters\/([0-9A-Z]{20,30})"([\s\S]*?)<\/a>/g)) {
    const [, cid, inner] = m;
    if (seen.has(cid)) continue;
    seen.add(cid);
    const label = strip((/<span class="">([^<]+)<\/span>/.exec(inner) || /<span[^>]*>\s*((?:Chapter|Episode|Volume|Special|Side|Extra)[^<]*)<\/span>/i.exec(inner) || [])[1]) || "Chapter";
    const date = (/datetime="([^"]+)"/.exec(inner) || /checkNewChapter\('([^']+)'\)/.exec(html.slice(Math.max(0, m.index - 400), m.index)) || [])[1] || null;
    chapters.push({
      id: `weebcentral:${cid}`,
      issue_number: (/[\d.]+/.exec(label) || [""])[0],
      title: `${name} · ${label}`,
      reading_url: `${WC}/chapters/${cid}`,
      external_url: `${WC}/chapters/${cid}`,
      pages_url: `${WORKER}/api/weebcentral/chapter?id=${cid}`,
      date,
      access_type: "free",
      download_available: false
    });
  }
  return {
    success: true,
    source: "weebcentral",
    provider_name: "Weeb Central",
    series: { title: name, issue_count: chapters.length, external_url: `${WC}/series/${id}` },
    total: chapters.length,
    issues: chapters,
    reader: "app"
  };
}

async function wcChapter(id) {
  if (!/^[0-9A-Z]{20,30}$/.test(id)) throw new Error("Missing chapter");
  const html = await wcText(`/chapters/${id}/images?is_prev=False&current_page=1&reading_style=long_strip`, 86400);
  const pages = [...new Set([...html.matchAll(/<img[^>]+src="(https:\/\/[^"]+\.(?:png|jpe?g|webp|gif|avif))"/gi)].map((m) => m[1]))]
    .filter((u) => !/\/static\//.test(u));
  if (!pages.length) throw new Error("No pages found for this chapter");
  return { success: true, source: "weebcentral", provider_name: "Weeb Central", id, total: pages.length, pages, external_url: `${WC}/chapters/${id}` };
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
      id: "weebcentral",
      name: "Weeb Central",
      status: "active",
      in_all: true,
      capabilities: ["search", "covers", "chapter_list", "chapter_pages", "read_in_app"],
      note: "Manga. Search, chapter lists and chapter pages from its own pages (cached; robots.txt asks a 10 s crawl delay, nothing is crawled ahead). Chapters open in the app's comic reader. No downloads."
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
    description: "Comics from GetComics and the Internet Archive with download options, manga from Weeb Central read in the app's comic reader, plus your library's Comics Plus.",
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
      { name: "Comics Plus", url: "{library_link}", needs: "library_link", inApp: true, note: "Your library's comics — sign in with your card" }
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
            sizeBytes: "size_bytes",
            access_type: "access_type",
            reading_url: "reading_url",
            external_url: "external_url",
            issue_count: "issue_count",
            publication_date: "publication_date",
            issues_url: "issues_url",
            reader: "reader",
            reading_direction: "reading_direction",
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

      if (path === "/api/weebcentral/search") {
        if (!q) return error("Missing query. Use ?q=one%20piece");
        return json(await searchWeebCentral(q, limit));
      }

      if (path === "/api/weebcentral/series") {
        return json(await wcSeries(clean(u.searchParams.get("id"), 40), clean(u.searchParams.get("title"), 150)));
      }

      if (path === "/api/weebcentral/chapter") {
        return json(await wcChapter(clean(u.searchParams.get("id"), 40)));
      }

      if (path === "/api/comicsplus/search") {
        return json(webOnly(path.split("/")[2], q));
      }

      if (path === "/api/search") {
        if (!q) return error("Missing search query. Use ?q=batman");

        const source = u.searchParams.get("source") || "all";

        const valid = ["all", "internet_archive", "getcomics", "weebcentral", "comicsplus"];

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

        if (source === "all" || source === "weebcentral") {
          add("weebcentral", () => searchWeebCentral(q, limit));
        }

        if (source === "comicsplus") {
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
