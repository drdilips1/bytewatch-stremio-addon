// LibGen English EPUB — the "libgenbooks" worker (libgenbooks.dilip-aiims.workers.dev).
// Searches LibGen for English EPUBs and resolves downloads. The main worker (audiohub.js)
// forwards /libgen/… here.
//
// 10.8.0: several LibGen mirrors, tried in turn (one that's down — HTTP 522, a timeout — no
// longer means no results). The one that answered is tried first next time.

const VERSION = "10.8.0";
const SOURCE = "LibGen English EPUB";
// Mirrors of the same LibGen (same database, same pages): the first that answers is used.
const MIRRORS = [
  "https://libgen.gl/",
  "https://libgen.li/",
  "https://libgen.vg/",
  "https://libgen.la/",
  "https://libgen.bz/",
  "https://libgen.gs/",
];
const MIRROR_TIMEOUT_MS = 9000;
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
  const order = [activeBase, ...MIRRORS.filter(m => m !== activeBase)];
  const tried = [];
  let last = null;

  for (const base of order) {
    const url = new URL(path, base);
    for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MIRROR_TIMEOUT_MS);

    try {
      const response = await fetch(url.href, { ...init, signal: controller.signal, redirect: "follow" });

      if (response.status >= 500) {
        tried.push({ mirror: base, status: response.status });
        last = { response, base, url: url.href };
        continue;
      }

      activeBase = base;
      tried.push({ mirror: base, status: response.status });
      return { response, base, url: url.href, tried };
    } catch (error) {
      tried.push({ mirror: base, error: error?.name === "AbortError" ? "timed out" : String(error) });
    } finally {
      clearTimeout(timer);
    }
  }

  if (last) return { ...last, tried };
  throw Object.assign(new Error("No LibGen mirror answered"), { tried });
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
  return cleanText(value)
    .replace(/\s+\b[a-z]\s+[a-z]\s+\d{5,}\s*$/i, "")
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
    title: edition.text || cleanFallbackTitle(titleCell.text),
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

/* ---------------- ROUTES ---------------- */

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: HEADERS,
      });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/download") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method not allowed.", {
          status: 405,
          headers: HEADERS,
        });
      }

      const fileId = url.searchParams.get("id") || "";
      return resolveLibgenDownload(fileId, request);
    }

    if (request.method !== "GET") {
      return new Response("Method not allowed.", {
        status: 405,
        headers: HEADERS,
      });
    }

    if (path === "/" || path === "/health") {
      return json({
        source: SOURCE,
        version: VERSION,
        ok: true,
        status: "online",
        mirrors: MIRRORS,
        lastWorkingMirror: activeBase,
        endpoints: [
          "/health",
          "/manifest.json",
          "/search?q=Harry%20Potter",
          "/search?q=Harry%20Potter&pages=10",
          "/download?id=4965493",
        ],
      });
    }

    if (path === "/manifest.json") {
      return json({
        id: "libgen-english-epub",
        name: SOURCE,
        version: VERSION,
        description:
          "Search English EPUB books with edition grouping, file-copy detection and Worker download resolution.",
        baseUrl: url.origin,
        endpoints: {
          search: "/search?q={query}&page={page}&pages={pages}",
          download: "/download?id={libgenFileId}",
        },
      });
    }

    if (path === "/search") {
      const query = (url.searchParams.get("q") || "").trim();

      const startPage = Math.max(
        1,
        Math.min(
          100,
          parseInt(url.searchParams.get("page") || "1", 10) || 1
        )
      );

      const pagesToSearch = Math.max(
        1,
        Math.min(
          MAX_PAGES,
          parseInt(
            url.searchParams.get("pages") || String(DEFAULT_PAGES),
            10
          ) || DEFAULT_PAGES
        )
      );

      if (!query) {
        return json({
          source: SOURCE,
          version: VERSION,
          ok: false,
          error: "Missing query. Use /search?q=Harry%20Potter",
        }, 400);
      }

      if (query.length > 200) {
        return json({
          source: SOURCE,
          version: VERSION,
          ok: false,
          error: "Search query is too long.",
        }, 400);
      }

      return runSearch(
        query,
        startPage,
        pagesToSearch,
        url.origin
      );
    }

    return json({
      ok: false,
      error: "Not found",
      endpoints: [
        "/health",
        "/manifest.json",
        "/search?q=Harry%20Potter",
        "/download?id=4965493",
      ],
    }, 404);
  },
};
