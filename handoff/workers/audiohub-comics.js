// Audiohub Comics — Cloudflare Worker, version 2.4.1
// Changes from 2.4.0:
//  1. GetComics download options: release pages on www.getcomics.org are accepted (the allowed-hosts
//     list had a pasted Markdown link instead of the plain host name, so they were refused).
//  2. One version number everywhere (CONFIG.VERSION), also in the User-Agent and the manifest.
//  3. The manifest maps the GetComics fields the app uses (provider name, original title, download
//     options) explicitly. The app also read them without this, so 2.4.0 manifests keep working.

const CONFIG = {
  NAME: "Audiohub Comics",
  VERSION: "2.4.1",
  ARCHIVE_API: "https://archive.org",
  KITSU_API: "https://kitsu.io/api/edge",
  GETCOMICS_FEED: "https://getcomics.org/feed/",
  GETCOMICS_SEARCH: "https://getcomics.org/wp-json/wp/v2/search",
  GETCOMICS_HOSTS: ["getcomics.org", "www.getcomics.org"],
  MAX_RESULTS: 20,
  CACHE_SECONDS: 300
};

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

function normalizeArchive(x) {
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
    availability: "Check individual item access and file rights"
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

/* KITSU */

function normalizeKitsu(item) {
  const a = item.attributes || {};
  const t = a.titles || {};

  const originalTitle =
    a.canonicalTitle || t.en || t.en_jp || t.ja_jp || "Untitled";

  return {
    id: item.id,
    title: `[Kitsu] ${originalTitle}`,
    original_title: originalTitle,
    alternate_titles: t,
    description: a.synopsis || a.description || "",
    cover:
      a.posterImage?.large ||
      a.posterImage?.original ||
      a.posterImage?.medium ||
      null,
    format: a.mangaType || a.subtype || "manga",
    status: a.status || null,
    chapter_count: a.chapterCount ?? null,
    volume_count: a.volumeCount ?? null,
    date: a.startDate || null,
    rating: a.averageRating || null,
    provider: "kitsu",
    provider_name: "Kitsu",
    url: `https://kitsu.io/manga/${a.slug || item.id}`,
    source_url: `https://kitsu.io/manga/${a.slug || item.id}`,
    content_type: "metadata_only",
    download_available: false
  };
}

async function searchKitsu(q, limit) {
  const p = new URLSearchParams();

  p.set("filter[text]", q);
  p.set("page[limit]", String(Math.min(limit, 20)));

  const d = await getJSON(`${CONFIG.KITSU_API}/manga?${p}`, {
    Accept: "application/vnd.api+json"
  });

  const results = (d.data || []).map(normalizeKitsu);

  return {
    success: true,
    source: "kitsu",
    total: d.meta?.count ?? results.length,
    results
  };
}

async function kitsuItem(id) {
  const d = await getJSON(
    `${CONFIG.KITSU_API}/manga/${encodeURIComponent(id)}`,
    {
      Accept: "application/vnd.api+json"
    }
  );

  if (!d.data) throw new Error("Manga not found in Kitsu");

  return {
    success: true,
    source: "kitsu",
    result: normalizeKitsu(d.data)
  };
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
  return `https://audiohub-comics.booksources.workers.dev/api/getcomics/downloads?url=${encodeURIComponent(link)}`;
}

function normalizeGCPost(x) {
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

function normalizeGCRSS(block) {
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

  return {
    success: true,
    source: "getcomics",
    provider_name: "GetComics",
    release_url: page.href,
    total: links.length,
    links,
    note: "These are links discovered on the release page. Some may lead to mirror pages rather than direct files."
  };
}

/* OFFICIAL LINK-OUT SOURCES */

function linkResult(provider, title, url, description) {
  return {
    id: provider,
    title,
    description,
    provider,
    provider_name: provider,
    format: "comic",
    url,
    source_url: url,
    content_type: "external_reading",
    download_available: false
  };
}

function searchExternal(provider, q) {
  if (provider === "comic_book_plus") {
    return linkResult(
      provider,
      `Search Comic Book Plus: ${q}`,
      "https://comicbookplus.com/",
      "Open Comic Book Plus and use its site search or public-domain comic collections. Online reading is available; account login is required for downloads."
    );
  }

  if (provider === "mangaplus") {
    return linkResult(
      provider,
      `Search MANGA Plus: ${q}`,
      "https://mangaplus.shueisha.co.jp/",
      "Official Shueisha manga catalogue and reader. Chapter availability depends on title and region."
    );
  }

  if (provider === "globalcomix") {
    return linkResult(
      provider,
      `Search GlobalComix: ${q}`,
      "https://globalcomix.com/",
      "Open GlobalComix to search and read through its official service."
    );
  }

  throw new Error("Unknown external source");
}

/* SOURCE REGISTRY */

function sources() {
  return [
    {
      id: "internet_archive",
      name: "Internet Archive",
      status: "active",
      capabilities: ["search", "metadata", "file_listing", "streaming", "download"],
      note: "Access depends on each item's rights and lending restrictions."
    },
    {
      id: "getcomics",
      name: "GetComics",
      status: "active",
      capabilities: [
        "full_site_search",
        "rss_latest",
        "release_links",
        "download_link_discovery"
      ],
      note: "Search uses the public WordPress endpoint, with RSS fallback. Download-link discovery returns links found on release pages; some require a mirror page."
    },
    {
      id: "kitsu",
      name: "Kitsu",
      status: "active",
      capabilities: ["manga_search", "metadata", "covers"],
      note: "Catalogue metadata only; no chapter files."
    },
    {
      id: "comic_book_plus",
      name: "Comic Book Plus",
      status: "active",
      capabilities: ["official_site_link"],
      note: "Official-site discovery and online reading. Downloads require site login."
    },
    {
      id: "mangaplus",
      name: "MANGA Plus",
      status: "active",
      capabilities: ["official_site_link"],
      note: "Official Shueisha catalogue and reading links; availability varies by title and region."
    },
    {
      id: "globalcomix",
      name: "GlobalComix",
      status: "active",
      capabilities: ["official_site_link"],
      note: "Official-site link-out only; no automated scraping or content proxy."
    },
    {
      id: "anilist",
      name: "AniList",
      status: "disabled",
      capabilities: [],
      note: "Disabled; no requests are sent."
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
    description: "Comics, manga, public-domain collections and official source discovery.",
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
    adapters: {
      source: {
        request: {
          method: "GET",
          url: `${base}/api/search?q={TITLE}&source=getcomics&limit=20`,
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
            // 2.4.1: the fields the app uses for the provider label and Download options.
            provider_name: "provider_name",
            original_title: "original_title",
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

      if (path === "/api/getcomics/downloads") {
        const pageUrl = u.searchParams.get("url");

        if (!pageUrl) {
          return error("Missing release URL");
        }

        return json(await getComicsDownloads(pageUrl));
      }

      if (path === "/api/search") {
        if (!q) return error("Missing search query. Use ?q=batman");

        const source = u.searchParams.get("source") || "all";

        const valid = [
          "all",
          "internet_archive",
          "kitsu",
          "getcomics",
          "comic_book_plus",
          "mangaplus",
          "globalcomix"
        ];

        if (!valid.includes(source)) {
          return error("Unsupported source");
        }

        const tasks = [];

        const add = (name, fn) => {
          tasks.push({ name, promise: fn() });
        };

        if (source === "all" || source === "internet_archive") {
          add("internet_archive", () => searchArchive(q, limit));
        }

        if (source === "all" || source === "kitsu") {
          add("kitsu", () => searchKitsu(q, limit));
        }

        if (source === "all" || source === "getcomics") {
          add("getcomics", () => searchGetComics(q, limit));
        }

        if (source === "all" || source === "comic_book_plus") {
          add("comic_book_plus", async () => ({
            success: true,
            source: "comic_book_plus",
            total: 1,
            results: [
              searchExternal("comic_book_plus", q)
            ]
          }));
        }

        if (source === "all" || source === "mangaplus") {
          add("mangaplus", async () => ({
            success: true,
            source: "mangaplus",
            total: 1,
            results: [
              searchExternal("mangaplus", q)
            ]
          }));
        }

        if (source === "all" || source === "globalcomix") {
          add("globalcomix", async () => ({
            success: true,
            source: "globalcomix",
            total: 1,
            results: [
              searchExternal("globalcomix", q)
            ]
          }));
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

        const results = groups.flatMap(g => g.results || []);

        return json({
          success: true,
          query: q,
          source,
          total: results.length,
          sources: groups,
          results
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

      const kitsuMatch = path.match(/^\/api\/kitsu\/([^/]+)$/);

      if (kitsuMatch) {
        return json(
          await kitsuItem(decodeURIComponent(kitsuMatch[1]))
        );
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
