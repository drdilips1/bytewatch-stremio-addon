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

    private fun clean(word: String) = word.replace('\u2019', '\'').replace('\u2018', '\'').trim()
        .trim { !it.isLetterOrDigit() && it != '-' && it != '\'' }.trim('\'', '-')

    /**
     * The forms of [selection] worth looking up, best first: the words as selected, then without a
     * possessive, then simpler forms (plurals, -ed, -ing), and for a phrase its first word too.
     */
    internal fun candidates(selection: String): List<String> {
        val w = clean(selection).lowercase().replace(Regex("\\s+"), " ")
        if (w.isEmpty()) return emptyList()
        val out = LinkedHashSet<String>()
        fun forms(x: String) {
            if (x.length < 2) return
            out += x
            val base = x.removeSuffix("'s").removeSuffix("'")
            out += base
            if (base.length > 4 && base.endsWith("ies")) out += base.dropLast(3) + "y"
            if (base.length > 4 && (base.endsWith("ches") || base.endsWith("shes") || base.endsWith("sses") || base.endsWith("xes"))) out += base.dropLast(2)
            if (base.length > 3 && base.endsWith("s") && !base.endsWith("ss")) out += base.dropLast(1)
            if (base.length > 4 && base.endsWith("ied")) out += base.dropLast(3) + "y"
            // "stopped" → stop, "running" → run
            fun undouble(stem: String) = if (stem.length > 2 && stem.last() == stem[stem.length - 2] && stem.last() !in "aeiouls") stem.dropLast(1) else stem
            if (base.length > 4 && base.endsWith("ed")) { out += undouble(base.dropLast(2)); out += base.dropLast(1); out += base.dropLast(2) }
            if (base.length > 5 && base.endsWith("ing")) { out += undouble(base.dropLast(3)); out += base.dropLast(3) + "e"; out += base.dropLast(3) }
            if (base.length > 4 && base.endsWith("ly")) out += base.dropLast(2)
        }
        forms(w)
        if (' ' in w) w.split(' ').map(::clean).filter { it.length > 2 }.maxByOrNull { it.length }?.let { forms(it) }
        return out.filter { it.length >= 2 }
    }

    /** Parses Wiktionary's definitions (the backup dictionary): English senses, tags removed. */
    internal fun parseWiktionary(word: String, json: String): Entry? {
        val en = JSONObject(json).optJSONArray("en") ?: return null
        fun strip(html: String) = html.replace(Regex("<[^>]+>"), "").replace("&nbsp;", " ").replace("&amp;", "&")
            .replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'").trim()
        val meanings = ArrayList<Meaning>()
        for (i in 0 until en.length()) {
            val m = en.getJSONObject(i)
            val defs = m.optJSONArray("definitions") ?: continue
            val list = ArrayList<Pair<String, String?>>()
            for (k in 0 until defs.length()) {
                val d = defs.getJSONObject(k)
                val text = strip(d.optString("definition"))
                if (text.isBlank()) continue
                val ex = d.optJSONArray("examples")?.optString(0)?.let(::strip)?.ifBlank { null }
                list += text to ex
                if (list.size == 4) break
            }
            if (list.isNotEmpty()) meanings += Meaning(m.optString("partOfSpeech").lowercase(), list, emptyList())
        }
        return if (meanings.isEmpty()) null else Entry(word, null, meanings.take(5))
    }

    /** Looks up each form in turn, in the Free Dictionary and then Wiktionary. Null when nothing was found. */
    private fun find(selection: String): Pair<Entry?, Boolean> {
        var reached = false
        for (w in candidates(selection)) {
            runCatching { get("https://api.dictionaryapi.dev/api/v2/entries/en/" + Uri.encode(w)) }
                .onSuccess { reached = true }
                .getOrNull()?.let { j -> runCatching { parseDictionary(j) }.getOrNull()?.takeIf { it.meanings.isNotEmpty() }?.let { return it to true } }
            runCatching { get("https://en.wiktionary.org/api/rest_v1/page/definition/" + Uri.encode(w)) }
                .onSuccess { reached = true }
                .getOrNull()?.let { j -> runCatching { parseWiktionary(w, j) }.getOrNull()?.let { return it to true } }
        }
        return null to reached
    }

    fun dictionary(activity: Activity, scope: CoroutineScope, word: String) {
        val w = clean(word).lowercase()
        if (w.isEmpty()) return
        scope.launch {
            val (entry, reached) = withContext(Dispatchers.IO) { find(word) }
            val body = SpannableStringBuilder()
            if (entry == null || entry.meanings.isEmpty()) {
                body.append(
                    if (reached) "No dictionary entry found for “$w”. Try Wikipedia or a web search."
                    else "Couldn't reach the dictionary. Check your internet and try again."
                )
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
            sheet(activity, scope, "Dictionary", listOfNotNull(entry?.word ?: w, entry?.phonetic).joinToString("  ·  "), body, entry?.word ?: w)
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
