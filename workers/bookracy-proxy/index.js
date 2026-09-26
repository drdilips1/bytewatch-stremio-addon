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

    if (url.pathname === "/bookracy/search") {
      const query = (url.searchParams.get("q") || "").trim();

      if (!query) {
        return json({ results: [] }, corsHeaders);
      }

      const bookracy = await searchBookracy(query);
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
            debridCache: "debridCache"
          }
        }
      }
    }
  };
}

async function searchBookracy(query) {
  try {
    const apiUrl =
      "https://api.bookracy.com/api/books" +
      "?query=" + encodeURIComponent(query) +
      "&lang=en" +
      "&limit=20";

    const response = await fetch(apiUrl, { headers: BROWSER_HEADERS });

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
        .map(book => makeResult({
          title: book.title,
          author: book.author,
          url: book.link,
          format: book.format,
          language: book.language,
          posted: book.year
        }))
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

function makeResult({ title, author, url, format, language, posted }) {
  return {
    title: title || "",
    author: author || "",
    narrator: "",
    url: url || "",
    magnetUrl: "",
    infoHash: "",
    sizeBytes: 0,
    seeders: 0,
    format: format || "",
    language: language || "en",
    posted: posted ? String(posted) : "",
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
