package com.paper2audio.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.StyleSpan
import android.widget.TextView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Looking up words and names: an English dictionary, Wikipedia, or a web search. */
object LookUp {
    private val client = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).build()

    private fun get(url: String): String? = client.newCall(Request.Builder().url(url).header("User-Agent", "Paper2Audio-Android").build())
        .execute().use { r -> if (r.isSuccessful) r.body?.string() else null }

    class Meaning(val partOfSpeech: String, val definitions: List<Pair<String, String?>>, val synonyms: List<String>)
    class Entry(val word: String, val phonetic: String?, val meanings: List<Meaning>)

    /** Parses the Free Dictionary API (dictionaryapi.dev, from Wiktionary). */
    internal fun parseDictionary(json: String): Entry? {
        val arr = JSONArray(json)
        if (arr.length() == 0) return null
        val first = arr.getJSONObject(0)
        val phonetic = first.optString("phonetic").ifBlank { null }
            ?: first.optJSONArray("phonetics")?.let { p -> (0 until p.length()).map { p.getJSONObject(it).optString("text") }.firstOrNull { it.isNotBlank() } }
        val meanings = ArrayList<Meaning>()
        for (e in 0 until arr.length()) {
            val ms = arr.getJSONObject(e).optJSONArray("meanings") ?: continue
            for (i in 0 until ms.length()) {
                val m = ms.getJSONObject(i)
                val defs = m.optJSONArray("definitions") ?: JSONArray()
                val list = (0 until minOf(defs.length(), 4)).map { k ->
                    val d = defs.getJSONObject(k)
                    d.optString("definition") to d.optString("example").ifBlank { null }
                }
                val syn = m.optJSONArray("synonyms")?.let { s -> (0 until minOf(s.length(), 8)).map { s.getString(it) } }.orEmpty()
                if (list.isNotEmpty()) meanings += Meaning(m.optString("partOfSpeech"), list, syn)
            }
        }
        return Entry(first.optString("word"), phonetic, meanings.take(5))
    }

    private fun clean(word: String) = word.trim().trim { !it.isLetterOrDigit() && it != '-' && it != '\'' }

    fun dictionary(activity: Activity, scope: CoroutineScope, word: String) {
        val w = clean(word).lowercase()
        if (w.isEmpty()) return
        scope.launch {
            val entry = withContext(Dispatchers.IO) {
                runCatching { get("https://api.dictionaryapi.dev/api/v2/entries/en/" + Uri.encode(w))?.let(::parseDictionary) }.getOrNull()
            }
            val body = SpannableStringBuilder()
            if (entry == null || entry.meanings.isEmpty()) {
                body.append("No dictionary entry found for “$w”. Try Wikipedia or a web search.")
            } else {
                for (m in entry.meanings) {
                    val start = body.length
                    body.append(m.partOfSpeech).append('\n')
                    body.setSpan(StyleSpan(android.graphics.Typeface.ITALIC), start, body.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                    for ((i, d) in m.definitions.withIndex()) {
                        body.append("${i + 1}. ").append(d.first).append('\n')
                        d.second?.let {
                            val s = body.length
                            body.append("   “").append(it).append("”\n")
                            body.setSpan(StyleSpan(android.graphics.Typeface.ITALIC), s, body.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                        }
                    }
                    if (m.synonyms.isNotEmpty()) body.append("Similar: ").append(m.synonyms.joinToString(", ")).append('\n')
                    body.append('\n')
                }
            }
            sheet(activity, scope, "Dictionary", listOfNotNull(entry?.word ?: w, entry?.phonetic).joinToString("  ·  "), body, w)
        }
    }

    fun wikipedia(activity: Activity, scope: CoroutineScope, phrase: String) {
        val q = phrase.trim().take(120)
        if (q.isEmpty()) return
        scope.launch {
            val found = withContext(Dispatchers.IO) {
                runCatching {
                    // The best-matching article, then its summary.
                    val search = get("https://en.wikipedia.org/w/api.php?action=opensearch&limit=1&namespace=0&format=json&search=" + Uri.encode(q))
                    val title = search?.let { JSONArray(it).optJSONArray(1)?.optString(0) }?.ifBlank { null } ?: q
                    val summary = get("https://en.wikipedia.org/api/rest_v1/page/summary/" + Uri.encode(title.replace(' ', '_')))?.let(::JSONObject)
                    summary?.let { Triple(it.optString("title", title), it.optString("description").ifBlank { null }, it.optString("extract")) }
                }.getOrNull()
            }
            val body = SpannableStringBuilder(found?.third?.ifBlank { null } ?: "Nothing found on Wikipedia for “$q”.")
            sheet(activity, scope, found?.first ?: "Wikipedia", found?.second, body, null, wikiTitle = found?.first)
        }
    }

    fun webSearch(activity: Activity, phrase: String) {
        runCatching {
            activity.startActivity(Intent(Intent.ACTION_WEB_SEARCH).putExtra(android.app.SearchManager.QUERY, phrase.trim()))
        }.onFailure {
            runCatching { activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com/search?q=" + Uri.encode(phrase.trim())))) }
        }
    }

    private fun sheet(activity: Activity, scope: CoroutineScope, title: String, subtitle: String?, body: CharSequence, word: String?, wikiTitle: String? = null) {
        if (activity.isFinishing) return
        val d = activity.resources.displayMetrics.density
        val text = TextView(activity).apply {
            this.text = body
            textSize = 16f
            setLineSpacing(0f, 1.3f)
            setTextColor(Themes.color(activity, R.attr.p2aText))
            setTextIsSelectable(true)
            setPadding((24 * d).toInt(), (4 * d).toInt(), (24 * d).toInt(), (8 * d).toInt())
        }
        val s = LiteSheet(activity, title, subtitle).view(text)
        if (word != null) s.row(R.drawable.ic_explore, "Wikipedia", "About “$word”") { wikipedia(activity, scope, word) }
        if (wikiTitle != null) s.row(R.drawable.ic_explore, "Read the whole article", "On Wikipedia") {
            runCatching { activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://en.wikipedia.org/wiki/" + Uri.encode(wikiTitle.replace(' ', '_'))))) }
        }
        s.row(R.drawable.ic_search, "Search the web", null) { webSearch(activity, word ?: title) }
        s.show()
    }
}
