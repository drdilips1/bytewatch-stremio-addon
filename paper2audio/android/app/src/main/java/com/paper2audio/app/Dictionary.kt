package com.paper2audio.app

import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Word meanings for Look up, from free dictionaries: the Free Dictionary API (dictionaryapi.dev)
 * first, then Wiktionary when that one is slow, busy or doesn't know the word (Wiktionary also has
 * forms like "walked" and "children"). Only the word is sent. Call off the main thread.
 */
object Dictionary {
    data class Meaning(val partOfSpeech: String, val definitions: List<Pair<String, String?>>)
    data class Entry(val word: String, val phonetic: String?, val meanings: List<Meaning>)

    /** No connection at all (as opposed to a dictionary that didn't answer). */
    class Offline : Exception()

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).callTimeout(25, TimeUnit.SECONDS)
        .build()
    private const val UA = "Narrato-Android (github.com/drdilips1/bytewatch-stremio-addon)"

    /** The word as selected, without quotes and punctuation around it, or a possessive "’s". */
    fun clean(raw: String): String =
        raw.trim().trim { !it.isLetterOrDigit() }.replace(Regex("""['’]s$"""), "").trim()

    /** The meanings of [word], or null when neither dictionary knows it. Throws when neither answered. */
    fun lookUp(word: String): Entry? {
        var failure: Exception? = null
        val first = try {
            freeDictionary(word.lowercase())
        } catch (e: Exception) {
            failure = e
            null
        }
        if (first != null) return first
        // Not known there, or it didn't answer: Wiktionary, as written (names) and in lowercase.
        for (w in listOf(word, word.lowercase()).distinct()) {
            try {
                wiktionary(w)?.let { return it }
                failure = null
            } catch (e: Exception) {
                if (failure == null) failure = e
            }
        }
        failure?.let { throw if (it is java.net.UnknownHostException || it is java.net.ConnectException) Offline() else it }
        return null
    }

    /** The reply's text, null for "not found"; one more try when the dictionary is busy or slow. */
    private fun get(url: String): String? {
        var last: Exception? = null
        repeat(2) { attempt ->
            try {
                client.newCall(Request.Builder().url(url).header("User-Agent", UA).build()).execute().use { r ->
                    if (r.code == 404) return null
                    if (r.isSuccessful) return r.body?.string().orEmpty()
                    last = Exception("The dictionary answered ${r.code}")
                    if (r.code < 429) return null
                }
            } catch (e: java.net.UnknownHostException) {
                throw e
            } catch (e: Exception) {
                last = e
            }
            if (attempt == 0) Thread.sleep(800)
        }
        throw last ?: Exception("The dictionary didn't answer")
    }

    private fun enc(w: String) = java.net.URLEncoder.encode(w, "UTF-8").replace("+", "%20")

    private fun freeDictionary(word: String): Entry? {
        val text = get("https://api.dictionaryapi.dev/api/v2/entries/en/" + enc(word)) ?: return null
        val entries = runCatching { JSONArray(text) }.getOrNull() ?: return null
        val first = entries.optJSONObject(0) ?: return null
        val phonetic = first.optString("phonetic").ifBlank {
            first.optJSONArray("phonetics")?.let { ph -> (0 until ph.length()).map { ph.optJSONObject(it)?.optString("text").orEmpty() }.firstOrNull { it.isNotBlank() } }.orEmpty()
        }
        val meanings = ArrayList<Meaning>()
        for (e in 0 until entries.length()) {
            val ms = entries.optJSONObject(e)?.optJSONArray("meanings") ?: continue
            for (m in 0 until ms.length()) {
                val meaning = ms.optJSONObject(m) ?: continue
                val defs = meaning.optJSONArray("definitions") ?: continue
                val list = (0 until defs.length()).mapNotNull { i ->
                    val d = defs.optJSONObject(i) ?: return@mapNotNull null
                    d.optString("definition").ifBlank { null }?.let { it to d.optString("example").ifBlank { null } }
                }
                if (list.isNotEmpty()) meanings += Meaning(meaning.optString("partOfSpeech"), list)
            }
        }
        if (meanings.isEmpty()) return null
        return Entry(first.optString("word", word), phonetic.ifBlank { null }, meanings)
    }

    private fun plain(html: String) = org.jsoup.Jsoup.parse(html).text().trim()

    private fun wiktionary(word: String): Entry? {
        val text = get("https://en.wiktionary.org/api/rest_v1/page/definition/" + enc(word.replace(' ', '_'))) ?: return null
        val english = runCatching { JSONObject(text).optJSONArray("en") }.getOrNull() ?: return null
        val meanings = (0 until english.length()).mapNotNull { i ->
            val o = english.optJSONObject(i) ?: return@mapNotNull null
            val defs = o.optJSONArray("definitions") ?: return@mapNotNull null
            val list = (0 until defs.length()).mapNotNull { j ->
                val d = defs.optJSONObject(j) ?: return@mapNotNull null
                val def = plain(d.optString("definition")).ifBlank { null } ?: return@mapNotNull null
                def to d.optJSONArray("examples")?.optString(0)?.let { plain(it) }?.ifBlank { null }
            }
            if (list.isEmpty()) null else Meaning(o.optString("partOfSpeech"), list)
        }
        if (meanings.isEmpty()) return null
        return Entry(word, null, meanings)
    }
}
