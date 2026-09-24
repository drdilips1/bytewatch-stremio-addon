package com.paper2audio.app

import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import org.jsoup.Jsoup
import org.jsoup.parser.Parser
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Free, legal catalogues: Open Library (book details and covers), Project
 * Gutenberg via Gutendex (public-domain e-books) and arXiv (research papers).
 */
object Metadata {
    /** Details found for a document already in the library. */
    data class Found(
        val title: String,
        val author: String?,
        val year: Int?,
        val description: String?,
        val coverUrl: String?,
        val source: String,
    )

    /** A search result that can be added to the library. */
    data class Result(
        val title: String,
        val author: String?,
        val year: String?,
        val summary: String?,
        val coverUrl: String?,
        val downloadUrl: String,
    )

    private const val USER_AGENT = "Paper2Audio-Android (github.com/drdilips1/bytewatch-stremio-addon)"
    val ARXIV_ID = Regex("""^(\d{4}\.\d{4,5})(v\d+)?(\.pdf)?$""")
    private val WS = Regex("""\s+""")

    private val client = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private fun get(url: String): String {
        val request = Request.Builder().url(url).header("User-Agent", USER_AGENT).build()
        client.newCall(request).execute().use { r ->
            if (!r.isSuccessful) throw IOException("HTTP ${r.code} from ${r.request.url.host}")
            return r.body!!.string()
        }
    }

    fun bytes(url: String): ByteArray {
        val request = Request.Builder().url(url).header("User-Agent", USER_AGENT).build()
        client.newCall(request).execute().use { r ->
            if (!r.isSuccessful) throw IOException("HTTP ${r.code}")
            return r.body!!.bytes()
        }
    }

    private fun clean(s: String?) = s?.let { WS.replace(it, " ").trim() }?.ifBlank { null }

    // ---- Details for library items ----

    /**
     * Looks up details for [item]: arXiv for arXiv papers; otherwise Hardcover
     * (when [hardcoverToken] is set), falling back to Open Library.
     */
    fun lookup(item: Library.Item, hardcoverToken: String?): Found? {
        ARXIV_ID.find(item.sourceName.trim())?.let { m ->
            return arxiv("id_list=${m.groupValues[1]}").firstOrNull()?.let {
                Found(it.title, it.author, it.year?.take(4)?.toIntOrNull(), it.summary, null, "arXiv")
            }
        }
        if (!hardcoverToken.isNullOrBlank()) {
            runCatching { hardcover(hardcoverToken, item.title, item.author) }.getOrNull()?.let { return it }
        }
        return openLibrary(item.title, item.author)
    }

    /** Hardcover (hardcover.app) search; needs the user's API token from hardcover.app/account/api. */
    fun hardcover(token: String, title: String, author: String?): Found? {
        val query = "query Search(\$q: String!) { search(query: \$q, query_type: \"Book\", per_page: 1, page: 1) { results } }"
        val body = JSONObject()
            .put("query", query)
            .put("variables", JSONObject().put("q", listOfNotNull(title.take(150), author?.take(60)).joinToString(" ")))
        val auth = token.trim().let { if (it.startsWith("Bearer ", ignoreCase = true)) it else "Bearer $it" }
        val request = Request.Builder().url("https://api.hardcover.app/v1/graphql")
            .header("User-Agent", USER_AGENT)
            .header("authorization", auth)
            .post(body.toString().toRequestBody("application/json".toMediaType()))
            .build()
        val json = client.newCall(request).execute().use { r ->
            if (r.code == 401 || r.code == 403) throw IOException("Hardcover rejected the API key")
            if (!r.isSuccessful) throw IOException("HTTP ${r.code} from Hardcover")
            r.body!!.string()
        }
        return parseHardcover(json)
    }

    /** Parses a Hardcover search response (a Typesense result inside GraphQL). */
    internal fun parseHardcover(json: String): Found? {
        val root = JSONObject(json)
        root.optJSONArray("errors")?.optJSONObject(0)?.let { throw IOException("Hardcover: " + it.optString("message")) }
        val results = root.optJSONObject("data")?.optJSONObject("search")?.opt("results") ?: return null
        val obj = when (results) {
            is JSONObject -> results
            is String -> runCatching { JSONObject(results) }.getOrNull()
            else -> null
        } ?: return null
        val doc = obj.optJSONArray("hits")?.optJSONObject(0)?.optJSONObject("document") ?: return null
        val authors = doc.optJSONArray("author_names")
        val image = doc.opt("image")
        val cover = when (image) {
            is JSONObject -> image.optString("url")
            is String -> image
            else -> null
        }?.ifBlank { null }
        return Found(
            title = doc.optString("title").ifBlank { return null },
            author = authors?.let { a -> (0 until minOf(a.length(), 3)).joinToString(", ") { a.getString(it) } }?.ifBlank { null },
            year = doc.optInt("release_year", 0).takeIf { it > 0 },
            description = clean(doc.optString("description")),
            coverUrl = cover,
            source = "Hardcover",
        )
    }

    fun openLibrary(title: String, author: String?): Found? {
        val url = "https://openlibrary.org/search.json".toHttpUrl().newBuilder()
            .addQueryParameter("title", title.take(200))
            .apply { if (!author.isNullOrBlank()) addQueryParameter("author", author.take(100)) }
            .addQueryParameter("limit", "1")
            .addQueryParameter("fields", "key,title,author_name,first_publish_year,cover_i")
            .build().toString()
        return parseOpenLibrary(get(url)) { key -> runCatching { get("https://openlibrary.org$key.json") }.getOrNull() }
    }

    /** Parses an Open Library search response; [work] fetches a work record for its description. */
    internal fun parseOpenLibrary(json: String, work: (String) -> String?): Found? {
        val doc = JSONObject(json).optJSONArray("docs")?.optJSONObject(0) ?: return null
        val cover = doc.optInt("cover_i", 0).takeIf { it > 0 }
        val description = doc.optString("key").ifBlank { null }?.let(work)?.let { raw ->
            val w = JSONObject(raw)
            when (val d = w.opt("description")) {
                is String -> d
                is JSONObject -> d.optString("value")
                else -> null
            }
        }
        return Found(
            title = doc.optString("title"),
            author = doc.optJSONArray("author_name")?.let { a -> (0 until a.length()).joinToString(", ") { a.getString(it) } },
            year = doc.optInt("first_publish_year", 0).takeIf { it > 0 },
            description = clean(description?.substringBefore("\n----")),
            coverUrl = cover?.let { "https://covers.openlibrary.org/b/id/$it-L.jpg" },
            source = "Open Library",
        )
    }

    // ---- Search ----

    /** Public-domain e-books from Project Gutenberg. An empty query lists the most popular. */
    fun searchGutenberg(query: String): List<Result> {
        val url = "https://gutendex.com/books/".toHttpUrl().newBuilder()
            .apply { if (query.isNotBlank()) addQueryParameter("search", query.trim()) }
            .build().toString()
        return parseGutendex(get(url))
    }

    internal fun parseGutendex(json: String): List<Result> {
        val results = JSONObject(json).optJSONArray("results") ?: return emptyList()
        val out = ArrayList<Result>()
        for (i in 0 until results.length()) {
            val b = results.getJSONObject(i)
            val formats = b.optJSONObject("formats") ?: continue
            val epub = formats.keys().asSequence().firstOrNull { it.startsWith("application/epub") }
                ?.let { formats.getString(it) }
                ?: formats.keys().asSequence().firstOrNull { it.startsWith("text/plain") }?.let { formats.getString(it) }
                ?: continue
            val authors = b.optJSONArray("authors")
            val author = authors?.optJSONObject(0)?.optString("name")?.let { name ->
                // Gutenberg lists "Austen, Jane"; show "Jane Austen".
                if (',' in name) name.substringAfter(',').trim() + " " + name.substringBefore(',').trim() else name
            }
            val born = authors?.optJSONObject(0)?.optInt("birth_year", 0)?.takeIf { it > 0 }
            out += Result(
                title = clean(b.optString("title")) ?: continue,
                author = author,
                year = born?.let { "author born $it" },
                summary = b.optJSONArray("summaries")?.optString(0)?.let(::clean),
                coverUrl = formats.optString("image/jpeg").ifBlank { null },
                downloadUrl = epub,
            )
        }
        return out
    }

    /** Research papers from arXiv. */
    fun searchArxiv(query: String): List<Result> {
        val terms = query.trim().split(WS).filter { it.isNotBlank() }.joinToString("+AND+") { "all:" + java.net.URLEncoder.encode(it, "UTF-8") }
        if (terms.isEmpty()) return emptyList()
        return arxiv("search_query=$terms&max_results=30&sortBy=relevance")
    }

    private fun arxiv(params: String): List<Result> = parseArxiv(get("https://export.arxiv.org/api/query?$params"))

    internal fun parseArxiv(xml: String): List<Result> {
        val doc = Jsoup.parse(xml, "", Parser.xmlParser())
        return doc.getElementsByTag("entry").mapNotNull { e ->
            val id = e.getElementsByTag("id").firstOrNull()?.text() ?: return@mapNotNull null
            val pdf = e.getElementsByTag("link").firstOrNull { it.attr("title") == "pdf" }?.attr("href")
                ?: id.replace("/abs/", "/pdf/")
            val authors = e.getElementsByTag("author").map { it.getElementsByTag("name").text() }
            Result(
                title = clean(e.getElementsByTag("title").firstOrNull()?.text()) ?: return@mapNotNull null,
                author = when {
                    authors.isEmpty() -> null
                    authors.size > 3 -> authors.take(3).joinToString(", ") + " et al."
                    else -> authors.joinToString(", ")
                },
                year = e.getElementsByTag("published").firstOrNull()?.text()?.take(10),
                summary = clean(e.getElementsByTag("summary").firstOrNull()?.text()),
                coverUrl = null,
                downloadUrl = pdf.replace("http://", "https://"),
            )
        }
    }
}
