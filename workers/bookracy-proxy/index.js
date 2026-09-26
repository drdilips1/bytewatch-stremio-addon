const BROWSER_HEADERS = {
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  "Origin": "https://bookracy.com",
  "Referer": "https://bookracy.com/"
};

export default {
  async fetch(request) {
    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (url.pathname === "/") {
      return json({
        status: "ok",
        usage: "/bookracy/search?q=<book title or author>",
        addon: url.origin + "/addon.json"
      }, corsHeaders);
    }

    if (url.pathname === "/addon.json") {
      return json(addonManifest(url.origin), corsHeaders);
    }

    // Debrid cache notifications from the app. Accepts GET or POST and always acknowledges.
    if (url.pathname === "/bookracy/notify") {
      return json({ ok: true }, corsHeaders);
    }

    // Debug: shows exactly what Bookracy returns for the first two books.
    if (url.pathname === "/bookracy/raw") {
      const query = (url.searchParams.get("q") || "dune").trim();
      const response = await fetch(bookracyUrl(query, 2), { headers: BROWSER_HEADERS });
      return new Response(await response.text(), {
        status: response.status,
        headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders }
      });
    }

    // Streams a Bookracy file with browser headers and a proper filename.
    if (url.pathname === "/bookracy/download") {
      return downloadBookracy(url.searchParams.get("url") || "", corsHeaders);
    }

    if (url.pathname === "/bookracy/search") {
      const query = (url.searchParams.get("q") || "").trim();

      if (!query) {
        return json({ results: [] }, corsHeaders);
      }

      const bookracy = await searchBookracy(query, url.origin);
      if (bookracy.results.length) {
        return json({ results: bookracy.results, source: "bookracy" }, corsHeaders);
      }

      // Bookracy blocked or empty: fall back to Project Gutenberg (Gutendex).
      const gutenberg = await searchGutendex(query);
      return json({
        results: gutenberg.results,
        source: "gutendex",
        bookracyError: bookracy.error || "",
        error: gutenberg.error || undefined
      }, corsHeaders);
    }

    return json({ error: "Not found" }, corsHeaders, 404);
  }
};

function addonManifest(origin) {
  return {
    schemaVersion: "1.0.0",
    id: "bookracy",
    name: "Bookracy",
    version: "1.0.0",
    description: "Ebook sources via Bookracy proxy. Requires a debrid service to download.",
    icon: "https://bookracy.com/favicon.ico",
    provides: ["source"],
    contentType: "ebook",
    rateLimit: {
      requestsPerMinute: 10,
      retryAfterMs: 6000
    },
    matching: {
      algorithm: "fuzzy",
      threshold: 0.4
    },
    adapters: {
      source: {
        cacheNotifyUrl: origin + "/bookracy/notify",
        request: {
          method: "GET",
          url: origin + "/bookracy/search?q={QUERY}",
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
            url: "url",
            format: "format",
            language: "language",
            date: "posted",
            sizeBytes: "sizeBytes",
            cover: "cover",
            description: "description",
            debridCache: "debridCache"
          }
        }
      }
    }
  };
}

function bookracyUrl(query, limit) {
  return "https://api.bookracy.com/api/books" +
    "?query=" + encodeURIComponent(query) +
    "&lang=en" +
    "&limit=" + limit;
}

async function downloadBookracy(link, corsHeaders) {
  let target;
  try {
    target = new URL(link);
  } catch {
    return json({ error: "Invalid download url" }, corsHeaders, 400);
  }
  if (target.protocol !== "https:" || target.hostname !== "api.bookracy.com") {
    return json({ error: "Only Bookracy downloads are allowed" }, corsHeaders, 400);
  }

  const response = await fetch(target.toString(), {
    headers: { ...BROWSER_HEADERS, Accept: "*/*" }
  });
  if (!response.ok) {
    return json({ error: "Bookracy download returned " + response.status }, corsHeaders, 502);
  }

  const filename = decodeURIComponent(target.pathname.split("/").pop() || "book");
  const headers = new Headers(corsHeaders);
  headers.set("Content-Type", response.headers.get("Content-Type") || "application/octet-stream");
  headers.set("Content-Disposition", "attachment; filename*=UTF-8''" + encodeURIComponent(filename));
  const length = response.headers.get("Content-Length");
  if (length) headers.set("Content-Length", length);

  return new Response(response.body, { status: 200, headers });
}

const LANGUAGE_CODES = {
  english: "en", spanish: "es", french: "fr", german: "de", italian: "it",
  portuguese: "pt", russian: "ru", chinese: "zh", japanese: "ja", arabic: "ar",
  hindi: "hi", dutch: "nl", polish: "pl", turkish: "tr", korean: "ko"
};

// "English" -> "en"
function languageCode(name) {
  const value = String(name || "").trim().toLowerCase();
  if (!value) return "en";
  return LANGUAGE_CODES[value] || (value.length === 2 ? value : value.slice(0, 2));
}

// "Dune - Frank Herbert_499" -> "Dune - Frank Herbert"
function cleanTitle(title) {
  return String(title || "").replace(/\s*_\d+\s*$/, "").trim();
}

function extensionOf(link) {
  const match = String(link || "").split(/[?#]/)[0].match(/\.(epub|pdf|mobi|azw3|fb2|djvu|cbz|cbr|txt)$/i);
  return match ? match[1].toLowerCase() : "";
}

// Accepts a byte count or text such as "2.3 MB".
function parseSize(value) {
  if (typeof value === "number") return value;
  const match = String(value || "").match(/([\d.]+)\s*(b|kb|mb|gb)?/i);
  if (!match) return 0;
  const units = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };
  return Math.round(parseFloat(match[1]) * (units[(match[2] || "b").toLowerCase()] || 1));
}

async function searchBookracy(query, origin) {
  try {
    const response = await fetch(bookracyUrl(query, 20), { headers: BROWSER_HEADERS });

    if (!response.ok) {
      const body = (await response.text()).slice(0, 200);
      return {
        results: [],
        error: "Bookracy API returned " + response.status + (body ? ": " + body : "")
      };
    }

    const data = await response.json();
    const results = Array.isArray(data.results) ? data.results : [];

    return {
      results: results
        .map(book => {
          const link = book.link || "";
          return makeResult({
            title: cleanTitle(book.title),
            author: book.author,
            // Route downloads through this worker so Bookracy sees browser headers.
            url: link ? origin + "/bookracy/download?url=" + encodeURIComponent(link) : "",
            format: book.book_filetype || extensionOf(link),
            language: languageCode(book.book_lang),
            posted: book.year,
            sizeBytes: parseSize(book.book_size),
            cover: book.book_image,
            description: book.description,
            publisher: book.publisher
          });
        })
        .filter(book => book.title && book.url)
    };
  } catch (error) {
    return { results: [], error: error.message || "Bookracy request failed" };
  }
}

async function searchGutendex(query) {
  try {
    const response = await fetch(
      "https://gutendex.com/books/?search=" + encodeURIComponent(query) + "&languages=en",
      { headers: { "Accept": "application/json" } }
    );

    if (!response.ok) {
      return { results: [], error: "Gutendex returned " + response.status };
    }

    const data = await response.json();
    const books = Array.isArray(data.results) ? data.results : [];

    return {
      results: books
        .slice(0, 20)
        .map(book => {
          const formats = book.formats || {};
          const epub = formats["application/epub+zip"];
          const authors = Array.isArray(book.authors) ? book.authors : [];
          return makeResult({
            title: book.title,
            author: authors.map(a => a.name).join(", "),
            url: epub || formats["text/html"] || "",
            format: epub ? "epub" : "html",
            language: (book.languages || [])[0]
          });
        })
        .filter(book => book.title && book.url)
    };
  } catch (error) {
    return { results: [], error: error.message || "Gutendex request failed" };
  }
}

function makeResult({ title, author, url, format, language, posted, sizeBytes, cover, description, publisher }) {
  return {
    title: title || "",
    author: author || "",
    narrator: "",
    url: url || "",
    magnetUrl: "",
    infoHash: "",
    sizeBytes: sizeBytes || 0,
    seeders: 0,
    format: String(format || "").toLowerCase(),
    language: language || "en",
    posted: posted ? String(posted) : "",
    cover: cover || "",
    description: description || "",
    publisher: publisher || "",
    debridCache: false
  };
}

function json(data, corsHeaders = {}, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders
    }
  });
}
