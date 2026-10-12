package com.paper2audio.app

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.net.Uri
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Book ratings on covers, and Goodreads.
 *
 * Ratings come from Goodreads (its public search suggestions, then the book's page for the
 * whole work's rating, as Audiohub does), else Open Library or Google Books. Importing the
 * reader's Goodreads export also brings their own stars and shelves.
 */
object Ratings {
    class Found(val average: Float, val count: Int, val source: String)

    private val client = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).build()

    private fun prefs(c: Context) = c.getSharedPreferences("p2a", Context.MODE_PRIVATE)

    fun enabled(c: Context) = prefs(c).getBoolean("showRatings", true)

    fun setEnabled(c: Context, on: Boolean) = prefs(c).edit().putBoolean("showRatings", on).apply()

    /** "★ 4.12" for a cover (Goodreads' way), or null. */
    fun badge(c: Context, item: Library.Item): String? = when {
        !enabled(c) || item.rating <= 0 -> null
        item.ratingSource == "Goodreads" -> "★ %.2f".format(item.rating)
        else -> "★ %.1f".format(item.rating)
    }

    private fun get(url: String, browser: Boolean = false): String? = runCatching {
        val ua = if (browser) "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36"
        else "Paper2Audio-Android"
        client.newCall(Request.Builder().url(url).header("User-Agent", ua).header("Accept-Language", "en-US,en;q=0.9").build()).execute().use { r ->
            if (r.isSuccessful) r.body?.string() else null
        }
    }.getOrNull()

    // ---- Goodreads ----

    /** A match from Goodreads' search suggestions. */
    internal class GrHit(val title: String, val author: String, val average: Float, val count: Int, val url: String)

    /** Goodreads' search suggestions (book/auto_complete): the same book, the edition with the most ratings first. */
    internal fun parseGoodreadsSuggestions(json: String, title: String, author: String?): GrHit? {
        val arr = runCatching { JSONArray(json) }.getOrNull() ?: return null
        val hits = (0 until arr.length()).mapNotNull { i ->
            val o = arr.optJSONObject(i) ?: return@mapNotNull null
            val t = o.optString("bookTitleBare").ifBlank { o.optString("title") }
            val a = o.optJSONObject("author")?.optString("name").orEmpty()
            if (!sameBook(title, author, t, listOf(a))) return@mapNotNull null
            val url = o.optString("bookUrl").substringBefore('?').let { if (it.startsWith("/")) "https://www.goodreads.com$it" else it }
            GrHit(t, a, o.optString("avgRating").toFloatOrNull() ?: 0f, o.optInt("ratingsCount"), url)
        }
        val exact = norm(title)
        return hits.sortedWith(compareByDescending<GrHit> { norm(it.title) == exact }.thenByDescending { it.count }).firstOrNull()
    }

    /** The whole work's rating from a Goodreads book page (all editions), or null. */
    internal fun parseGoodreadsPage(html: String): Found? {
        // The work's numbers (all editions) are in the page's data; the structured data has this edition's.
        Regex(""""averageRating":([\d.]+),"ratingsCount":(\d+)""").find(html)?.let { m ->
            val avg = m.groupValues[1].toFloatOrNull() ?: 0f
            if (avg > 0) return Found(avg, m.groupValues[2].toIntOrNull() ?: 0, "Goodreads")
        }
        val ld = Regex("""<script type="application/ld\+json">(.*?)</script>""", RegexOption.DOT_MATCHES_ALL).find(html)?.groupValues?.get(1)
        val agg = ld?.let { runCatching { JSONObject(it).optJSONObject("aggregateRating") }.getOrNull() } ?: return null
        val avg = agg.optDouble("ratingValue", 0.0).toFloat()
        return if (avg > 0) Found(avg, agg.optInt("ratingCount"), "Goodreads") else null
    }

    /** Goodreads' readers' rating: title + author, title + surname, then title alone. Call off the main thread. */
    fun goodreads(title: String, author: String?): Found? {
        val first = author?.split(Regex("""[;,&]| and """))?.firstOrNull()?.trim()?.let {
            // "Wallace-Wells, David" -> "David Wallace-Wells"
            if (author.contains(',') && !author.contains(';')) author.split(',').map { p -> p.trim() }.reversed().joinToString(" ") else it
        }.orEmpty()
        val surname = first.split(' ').lastOrNull().orEmpty()
        val bare = title.substringBefore(':').substringBefore(" (").trim()
        val tries = listOf("$bare $first", "$bare $surname", bare).map { it.trim() }.distinct().filter { it.length > 2 }
        var hit: GrHit? = null
        for (q in tries) {
            val json = get("https://www.goodreads.com/book/auto_complete?format=json&q=" + java.net.URLEncoder.encode(q, "UTF-8"), browser = true) ?: continue
            hit = parseGoodreadsSuggestions(json, title, author)
            if (hit != null) break
        }
        val h = hit ?: return null
        val page = h.url.takeIf { it.startsWith("https://www.goodreads.com/book/show/") }?.let { get(it, browser = true) }
        return page?.let(::parseGoodreadsPage) ?: h.average.takeIf { it > 0 }?.let { Found(it, h.count, "Goodreads") }
    }

    internal fun norm(t: String) = t.lowercase().substringBefore(':').substringBefore(" (").replace(Regex("""[^\p{L}\p{N}]+"""), " ").trim()

    /** Whether a catalogue's [title]/[authors] are the same book as ours (not just a similar name). */
    internal fun sameBook(ourTitle: String, ourAuthor: String?, title: String, authors: List<String>): Boolean {
        val a = norm(ourTitle)
        val b = norm(title)
        if (a.length < 3 || b.isEmpty() || !(a == b || a.startsWith(b) || b.startsWith(a))) return false
        if (ourAuthor.isNullOrBlank() || authors.isEmpty()) return true
        // Surnames are enough: "Wallace-Wells, David" and "David Wallace-Wells".
        val ours = ourAuthor.lowercase().split(Regex("""[^\p{L}]+""")).filter { it.length > 2 }.toSet()
        return authors.any { au -> au.lowercase().split(Regex("""[^\p{L}]+""")).any { it.length > 2 && it in ours } }
    }

    internal fun parseOpenLibrary(json: String, title: String, author: String?): Found? {
        val docs = JSONObject(json).optJSONArray("docs") ?: return null
        for (i in 0 until docs.length()) {
            val d = docs.getJSONObject(i)
            val authors = d.optJSONArray("author_name")?.let { a -> (0 until a.length()).map { a.getString(it) } }.orEmpty()
            if (!sameBook(title, author, d.optString("title"), authors)) continue
            val avg = d.optDouble("ratings_average", 0.0).toFloat()
            val count = d.optInt("ratings_count", 0)
            if (avg > 0 && count >= 3) return Found(avg, count, "Open Library")
        }
        return null
    }

    internal fun parseGoogleBooks(json: String, title: String, author: String?): Found? {
        val items = JSONObject(json).optJSONArray("items") ?: return null
        for (i in 0 until items.length()) {
            val v = items.getJSONObject(i).optJSONObject("volumeInfo") ?: continue
            val authors = v.optJSONArray("authors")?.let { a -> (0 until a.length()).map { a.getString(it) } }.orEmpty()
            if (!sameBook(title, author, v.optString("title"), authors)) continue
            val avg = v.optDouble("averageRating", 0.0).toFloat()
            val count = v.optInt("ratingsCount", 0)
            if (avg > 0 && count >= 3) return Found(avg, count, "Google Books")
        }
        return null
    }

    /** Readers' rating of a book: Goodreads, else Open Library, else Google Books. Call off the main thread. */
    fun lookup(title: String, author: String?): Found? {
        runCatching { goodreads(title, author) }.getOrNull()?.let { return it }
        val ol = "https://openlibrary.org/search.json".toHttpUrl().newBuilder()
            .addQueryParameter("title", title.take(150))
            .apply { if (!author.isNullOrBlank()) addQueryParameter("author", author.take(80)) }
            .addQueryParameter("limit", "5")
            .addQueryParameter("fields", "title,author_name,ratings_average,ratings_count")
            .build().toString()
        get(ol)?.let { runCatching { parseOpenLibrary(it, title, author) }.getOrNull() }?.let { return it }
        val q = "intitle:" + title.take(120) + (author?.let { " inauthor:" + it.substringBefore(',').take(60) } ?: "")
        val gb = "https://www.googleapis.com/books/v1/volumes".toHttpUrl().newBuilder()
            .addQueryParameter("q", q).addQueryParameter("maxResults", "5").build().toString()
        return get(gb)?.let { runCatching { parseGoogleBooks(it, title, author) }.getOrNull() }
    }

    /**
     * Finds ratings for books that don't have one yet (a few at a time, each book at most once a
     * month). Papers, notes and pasted text are skipped. Call off the main thread; true if any changed.
     */
    fun refresh(context: Context): Boolean {
        if (!enabled(context)) return false
        val p = prefs(context)
        val now = System.currentTimeMillis()
        var changed = false
        // Books without a Goodreads rating yet (ones rated elsewhere are looked up on Goodreads once too).
        val todo = Library.items(context).filter { item ->
            item.ratingSource != "Goodreads" && item.kind in setOf(Loader.Kind.EPUB, Loader.Kind.PDF, Loader.Kind.HTML, Loader.Kind.DOCX) &&
                item.words > 8_000 && now - p.getLong("grTried:${item.id}", 0) > 14L * 86_400_000
        }.take(10)
        for (item in todo) {
            p.edit().putLong("grTried:${item.id}", now).apply()
            val found = lookup(item.title, item.author) ?: continue
            if (found.source != "Goodreads" && item.rating > 0) continue // keep the one it has
            Thread.sleep(300) // gently, a book at a time
            Library.setRating(context, item, found.average, found.count, found.source)
            changed = true
        }
        return changed
    }

    // ---- Goodreads ----

    fun openOnGoodreads(activity: Activity, title: String, author: String?) {
        val q = listOfNotNull(title.substringBefore(':'), author?.substringBefore(',')).joinToString(" ")
        runCatching {
            activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://www.goodreads.com/search?q=" + Uri.encode(q))))
        }
    }

    /** One book from a Goodreads export. */
    class GoodreadsBook(val title: String, val author: String, val myRating: Int, val average: Float, val shelf: String)

    /** Reads Goodreads' "Export Library" CSV (quoted fields, commas and line breaks inside quotes). */
    internal fun parseGoodreadsCsv(csv: String): List<GoodreadsBook> {
        val rows = ArrayList<List<String>>()
        var field = StringBuilder()
        var row = ArrayList<String>()
        var quoted = false
        var i = 0
        while (i < csv.length) {
            val c = csv[i]
            when {
                quoted && c == '"' && i + 1 < csv.length && csv[i + 1] == '"' -> { field.append('"'); i++ }
                c == '"' -> quoted = !quoted
                !quoted && c == ',' -> { row += field.toString(); field = StringBuilder() }
                !quoted && (c == '\n' || c == '\r') -> {
                    if (c == '\r' && i + 1 < csv.length && csv[i + 1] == '\n') i++
                    row += field.toString(); field = StringBuilder()
                    if (row.any { it.isNotBlank() }) rows += row
                    row = ArrayList()
                }
                else -> field.append(c)
            }
            i++
        }
        if (field.isNotEmpty() || row.isNotEmpty()) { row += field.toString(); if (row.any { it.isNotBlank() }) rows += row }
        val header = rows.firstOrNull()?.map { it.trim().removePrefix("﻿") } ?: return emptyList()
        fun col(name: String) = header.indexOf(name)
        val t = col("Title"); val a = col("Author"); val mine = col("My Rating"); val avg = col("Average Rating"); val shelf = col("Exclusive Shelf")
        if (t < 0) error("That isn't a Goodreads library export (no Title column).")
        return rows.drop(1).mapNotNull { r ->
            val title = r.getOrNull(t)?.trim().orEmpty()
            if (title.isEmpty()) null else GoodreadsBook(
                title, r.getOrNull(a)?.trim().orEmpty(),
                r.getOrNull(mine)?.trim()?.toIntOrNull() ?: 0,
                r.getOrNull(avg)?.trim()?.toFloatOrNull() ?: 0f,
                r.getOrNull(shelf)?.trim().orEmpty(),
            )
        }
    }

    class ImportResult(val matched: Int, val wantToRead: Int, val total: Int)

    /**
     * Applies a Goodreads export: books in the library get Goodreads' rating, the reader's stars and
     * status from the shelf; books on "to-read" that aren't here go to the Goodreads list in Discover.
     */
    fun importGoodreads(context: Context, csv: String): ImportResult {
        val books = parseGoodreadsCsv(csv)
        val items = Library.items(context)
        var matched = 0
        val want = JSONArray()
        for (b in books) {
            val item = items.firstOrNull { sameBook(it.title, it.author, b.title, listOf(b.author)) }
            if (item != null) {
                matched++
                Library.setRating(context, item, b.average, 0, "Goodreads", b.myRating.takeIf { it > 0 })
                val status = when (b.shelf) {
                    "read" -> Library.Status.FINISHED
                    "currently-reading" -> Library.Status.READING
                    "to-read" -> Library.Status.WANT
                    else -> null
                }
                if (status != null && item.status == null) Library.setStatus(context, item, status)
            } else if (b.shelf == "to-read") {
                want.put(JSONObject().put("t", b.title).put("a", b.author).put("r", b.average.toDouble()))
            }
        }
        prefs(context).edit().putString("goodreadsWant", want.toString()).apply()
        return ImportResult(matched, want.length(), books.size)
    }

    /** "Want to read" books from Goodreads that aren't in the library yet. */
    fun goodreadsWant(context: Context): List<Triple<String, String, Float>> = runCatching {
        val arr = JSONArray(prefs(context).getString("goodreadsWant", "[]"))
        (0 until arr.length()).map { arr.getJSONObject(it) }.map { Triple(it.optString("t"), it.optString("a"), it.optDouble("r", 0.0).toFloat()) }
    }.getOrDefault(emptyList())

    fun explainImport(activity: Activity, pick: () -> Unit) {
        AlertDialog.Builder(activity)
            .setTitle("Import from Goodreads")
            .setMessage(
                "1. On goodreads.com (in a browser): My Books › Import and export › Export Library.\n" +
                    "2. Download the file it makes (goodreads_library_export.csv).\n" +
                    "3. Choose that file here.\n\n" +
                    "Your books here get Goodreads' rating, your stars and your shelves (read, currently reading, " +
                    "want to read). Books you want to read that aren't here yet show in Discover."
            )
            .setPositiveButton("Choose the file") { _, _ -> pick() }
            .setNegativeButton("Cancel", null)
            .show()
    }
}
