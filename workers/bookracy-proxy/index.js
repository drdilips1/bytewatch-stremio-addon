export default {
  async fetch(request) {
    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    if (url.pathname === "/") {
      return json({
        status: "ok",
        usage: "/bookracy/search?q=<book title or author>"
      }, corsHeaders);
    }

    if (url.pathname === "/bookracy/search") {
      const query = url.searchParams.get("q") || "";

      if (!query.trim()) {
        return json({ results: [] }, corsHeaders);
      }

      try {
        const apiUrl =
          "https://api.bookracy.com/api/books" +
          "?query=" + encodeURIComponent(query.trim()) +
          "&lang=en" +
          "&limit=20";

        const response = await fetch(apiUrl, {
          headers: {
            "Accept": "application/json"
          }
        });

        if (!response.ok) {
          return json({
            results: [],
            error: "Bookracy API returned " + response.status
          }, corsHeaders);
        }

        const data = await response.json();

        const results = Array.isArray(data.results)
          ? data.results
          : [];

        const normalized = results
          .map(book => ({
            title: book.title || "",
            author: book.author || "",
            narrator: "",
            url: book.link || "",
            magnetUrl: "",
            infoHash: "",
            sizeBytes: 0,
            seeders: 0,
            format: book.format || "",
            language: book.language || "en",
            posted: book.year || "",
            debridCache: false
          }))
          .filter(book => book.title && book.url);

        return json({
          results: normalized
        }, corsHeaders);

      } catch (error) {
        return json({
          results: [],
          error: error.message || "Bookracy request failed"
        }, corsHeaders);
      }
    }

    return json({
      error: "Not found"
    }, corsHeaders, 404);
  }
};

function json(data, corsHeaders = {}, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders
    }
  });
}
