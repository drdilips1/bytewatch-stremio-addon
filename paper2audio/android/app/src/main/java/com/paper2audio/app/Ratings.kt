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
 * Goodreads closed its API, so readers' ratings come from Open Library (and Google Books when
 * Open Library has none), and from the reader's own Goodreads export: importing it brings
 * Goodreads' average ratings, their own stars and shelves (read, currently reading, to read).
 */
object Ratings {
    class Found(val average: Float, val count: Int, val source: String)

    private val client = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).build()

    private fun prefs(c: Context) = c.getSharedPreferences("p2a", Context.MODE_PRIVATE)

    fun enabled(c: Context) = prefs(c).getBoolean("showRatings", true)

    fun setEnabled(c: Context, on: Boolean) = prefs(c).edit().putBoolean("showRatings", on).apply()

    /** "★ 4.1" for a cover, or null. */
    fun badge(c: Context, item: Library.Item): String? =
        if (enabled(c) && item.rating > 0) "★ %.1f".format(item.rating) else null

    private fun get(url: String): String? = runCatching {
        client.newCall(Request.Builder().url(url).header("User-Agent", "Paper2Audio-Android").build()).execute().use { r ->
            if (r.isSuccessful) r.body?.string() else null
        }
    }.getOrNull()

    private fun norm(t: String) = t.lowercase().substringBefore(':').substringBefore(" (").replace(Regex("""[^\p{L}\p{N}]+"""), " ").trim()

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

    /** Readers' rating of a book, from Open Library or else Google Books. Call off the main thread. */
    fun lookup(title: String, author: String?): Found? {
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
        val todo = Library.items(context).filter { item ->
            item.rating == 0f && item.kind in setOf(Loader.Kind.EPUB, Loader.Kind.PDF, Loader.Kind.HTML, Loader.Kind.DOCX) &&
                item.words > 15_000 && now - p.getLong("ratingTried:${item.id}", 0) > 30L * 86_400_000
        }.take(8)
        for (item in todo) {
            p.edit().putLong("ratingTried:${item.id}", now).apply()
            val found = lookup(item.title, item.author) ?: continue
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
