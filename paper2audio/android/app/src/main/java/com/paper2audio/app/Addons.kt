package com.paper2audio.app

import android.content.Context
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import org.jsoup.Jsoup
import org.jsoup.parser.Parser
import java.util.concurrent.TimeUnit

/**
 * Book sources the listener adds by link, shown by their own names and removable: no source is
 * built in. Two kinds:
 *  - a catalog in the standard OPDS format (Calibre, Project Gutenberg, Standard Ebooks, libraries…),
 *    searched through its OpenSearch link;
 *  - a search addon in Inkwell's (InkShelf) format: a request with {QUERY}/{TITLE}/{AUTHOR}, and
 *    where the results and their fields are in the reply.
 * Only results that are ordinary downloads (EPUB, PDF and the like) are used.
 */
object Addons {
    data class Addon(val url: String, val name: String, val kind: String, val manifest: JSONObject?)

    private const val KEY = "addons"
    private val client = OkHttpClient.Builder().connectTimeout(20, TimeUnit.SECONDS).readTimeout(40, TimeUnit.SECONDS).build()
    private const val UA = "Paper2Audio-Android (github.com/drdilips1/bytewatch-stremio-addon)"

    private fun prefs(context: Context) = context.getSharedPreferences("p2a", Context.MODE_PRIVATE)

    fun list(context: Context): List<Addon> = runCatching {
        val arr = JSONArray(prefs(context).getString(KEY, "[]"))
        (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            Addon(o.getString("url"), o.getString("name"), o.getString("kind"), o.optJSONObject("manifest"))
        }
    }.getOrDefault(emptyList())

    private fun save(context: Context, list: List<Addon>) {
        val arr = JSONArray()
        list.forEach { a ->
            arr.put(JSONObject().put("url", a.url).put("name", a.name).put("kind", a.kind).apply { a.manifest?.let { put("manifest", it) } })
        }
        prefs(context).edit().putString(KEY, arr.toString()).apply()
    }

    fun remove(context: Context, url: String) = save(context, list(context).filter { it.url != url })

    private fun fetch(url: String, method: String = "GET", body: String? = null, headers: Map<String, String> = emptyMap()): String {
        val b = Request.Builder().url(url).header("User-Agent", UA)
        headers.forEach { (k, v) -> b.header(k, v) }
        if (method != "GET") b.method(method, (body ?: "").toRequestBody("application/json".toMediaType()))
        client.newCall(b.build()).execute().use { r ->
            if (!r.isSuccessful) error("The source answered ${r.code}")
            return r.body?.string().orEmpty()
        }
    }

    /** Adds the addon or catalog at [link]; returns its name. Call off the main thread. */
    fun install(context: Context, link: String): String {
        val url = link.trim().replace(Regex("^stremio://", RegexOption.IGNORE_CASE), "https://")
        require(url.startsWith("http://") || url.startsWith("https://")) { "Enter a link starting with https://" }
        val text = fetch(url)
        val trimmed = text.trimStart()
        val addon = when {
            trimmed.startsWith("{") -> {
                val m = JSONObject(trimmed)
                val request = m.optJSONObject("adapters")?.optJSONObject("source")?.optJSONObject("request")
                if (m.optString("name").isBlank() || request?.optString("url").isNullOrBlank())
                    error("That isn't a search addon this app understands (it needs a name and adapters.source.request.url)")
                Addon(url, m.getString("name"), "source", m)
            }
            trimmed.startsWith("<") -> {
                val feed = Jsoup.parse(trimmed, url, Parser.xmlParser())
                if (feed.selectFirst("feed") == null) error("That page isn't an OPDS catalog")
                val search = opdsSearchTemplate(feed, url) ?: error("That catalog has no search")
                Addon(url, feed.selectFirst("feed > title")?.text()?.ifBlank { null } ?: url.toHttpHost(), "opds",
                    JSONObject().put("search", search))
            }
            else -> error("That link isn't an addon or a catalog")
        }
        save(context, list(context).filter { it.url != addon.url } + addon)
        return addon.name
    }

    private fun String.toHttpHost() = runCatching { java.net.URI(this).host }.getOrNull() ?: this

    /** The catalog's search address with {searchTerms}: given directly, or in its OpenSearch description. */
    private fun opdsSearchTemplate(feed: org.jsoup.nodes.Document, base: String): String? {
        val link = feed.select("feed > link[rel=search]")
        link.firstOrNull { it.attr("type").contains("atom") && it.attr("href").contains("{searchTerms}") }?.let { return it.absUrl("href") }
        val desc = link.firstOrNull { it.attr("type").contains("opensearchdescription") }?.absUrl("href") ?: return null
        val xml = Jsoup.parse(fetch(desc), desc, Parser.xmlParser())
        val u = xml.select("Url").firstOrNull { it.attr("type").contains("atom") } ?: xml.selectFirst("Url") ?: return null
        return java.net.URI(desc).resolve(u.attr("template")).toString()
    }

    /** Searches every addon; results from each, as they're found (a source that fails is skipped). */
    fun search(context: Context, query: String): List<Metadata.Result> {
        val all = list(context)
        if (all.isEmpty()) return emptyList()
        val out = ArrayList<Metadata.Result>()
        var lastError: Exception? = null
        for (a in all) {
            try {
                out += if (a.kind == "opds") searchOpds(a, query) else searchSource(a, query)
            } catch (e: Exception) {
                lastError = e
                AppLog.i("Addons", "${a.name}: ${e.message}")
            }
        }
        if (out.isEmpty() && lastError != null) throw lastError
        return out
    }

    private val BOOK_TYPES = Regex("epub|pdf|mobi|fb2|azw|text/plain|x-cbz|msword|officedocument", RegexOption.IGNORE_CASE)

    private fun searchOpds(a: Addon, query: String): List<Metadata.Result> {
        val template = a.manifest?.optString("search").orEmpty()
        val url = template.replace("{searchTerms}", java.net.URLEncoder.encode(query, "UTF-8")).replace(Regex("\\{[^}]*\\?\\}"), "")
        val feed = Jsoup.parse(fetch(url), url, Parser.xmlParser())
        return feed.select("entry").mapNotNull { e ->
            val links = e.select("link")
            // An EPUB first, then any other book file.
            val acq = links.filter { it.attr("rel").contains("acquisition") && BOOK_TYPES.containsMatchIn(it.attr("type")) }
            val file = acq.firstOrNull { it.attr("type").contains("epub") } ?: acq.firstOrNull() ?: return@mapNotNull null
            Metadata.Result(
                title = e.selectFirst("title")?.text()?.ifBlank { null } ?: return@mapNotNull null,
                author = e.select("author > name").joinToString(", ") { it.text() }.ifBlank { null },
                year = (e.selectFirst("issued") ?: e.selectFirst("published"))?.text()?.take(4)?.ifBlank { null },
                summary = listOfNotNull(a.name, (e.selectFirst("summary") ?: e.selectFirst("content"))?.text()?.take(600)).joinToString(" · "),
                coverUrl = links.firstOrNull { it.attr("rel").contains("image") }?.absUrl("href")?.ifBlank { null },
                downloadUrl = file.absUrl("href"),
            )
        }
    }

    private fun at(o: Any?, path: String): Any? {
        if (path.isBlank()) return o
        var cur = o
        for (k in path.split('.')) {
            cur = when (cur) {
                is JSONObject -> cur.opt(k)
                is JSONArray -> k.toIntOrNull()?.let { cur.opt(it) }
                else -> null
            }
        }
        return if (cur == JSONObject.NULL) null else cur
    }

    private fun fill(v: Any?, query: String, encode: Boolean): Any? = when (v) {
        is String -> v.replace(Regex("\\{(TITLE|AUTHOR|QUERY|NARRATOR|ISBN|LIMIT)\\}", RegexOption.IGNORE_CASE)) { m ->
            val value = when (m.groupValues[1].uppercase()) { "TITLE", "QUERY" -> query; "LIMIT" -> "40"; else -> "" }
            if (encode) java.net.URLEncoder.encode(value, "UTF-8") else value
        }
        is JSONObject -> JSONObject().also { o -> v.keys().forEach { k -> o.put(k, fill(v.get(k), query, encode)) } }
        is JSONArray -> JSONArray().also { arr -> for (i in 0 until v.length()) arr.put(fill(v.get(i), query, encode)) }
        else -> v
    }

    private fun searchSource(a: Addon, query: String): List<Metadata.Result> {
        val m = a.manifest ?: return emptyList()
        val src = m.getJSONObject("adapters").getJSONObject("source")
        val req = src.getJSONObject("request")
        val method = req.optString("method", "GET").uppercase()
        val headers = req.optJSONObject("headers")?.let { h -> h.keys().asSequence().associateWith { h.optString(it) } }.orEmpty()
        val url = fill(req.getString("url"), query, true) as String
        val body = if (method == "GET") null else (fill(req.optJSONObject("body") ?: JSONObject(), query, false) as JSONObject).toString()
        val reply = fetch(url, method, body, headers).trim()
        val data: Any = if (reply.startsWith("[")) JSONArray(reply) else JSONObject(reply)
        val res = src.optJSONObject("response") ?: JSONObject()
        val rows = at(data, res.optString("resultsPath")) as? JSONArray ?: error("No results in the reply")
        val map = res.optJSONObject("mapping") ?: JSONObject()
        fun get(row: JSONObject, field: String): String? =
            (if (map.has(field)) at(row, map.getString(field)) else row.opt(field))?.toString()?.takeIf { it.isNotBlank() && it != "null" }
        return (0 until rows.length()).mapNotNull { i ->
            val row = rows.optJSONObject(i) ?: return@mapNotNull null
            // Ordinary downloads only (no magnet links or torrents).
            val link = listOf("downloadUrl", "url", "link").firstNotNullOfOrNull { get(row, it) }?.takeIf { it.startsWith("http") }
                ?: return@mapNotNull null
            Metadata.Result(
                title = get(row, "title") ?: return@mapNotNull null,
                author = get(row, "author"),
                year = get(row, "date")?.take(4) ?: get(row, "year"),
                summary = listOfNotNull(a.name, get(row, "format")?.uppercase(), get(row, "description")?.take(600)).joinToString(" · "),
                coverUrl = get(row, "cover") ?: get(row, "coverUrl") ?: get(row, "image"),
                downloadUrl = link,
            )
        }
    }
}
