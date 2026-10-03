package com.paper2audio.app

import android.content.Context
import android.os.Handler
import android.os.Looper
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.File
import java.util.concurrent.CopyOnWriteArraySet

/**
 * The library's memory: a short knowledge digest of every document (made once by the AI and
 * kept), so questions can be asked across the whole library ("What have I learned about
 * consciousness?", "Which books disagree?"), and a reading-taste profile for recommendations.
 */
object Brain {
    private val main = Handler(Looper.getMainLooper())
    private val listeners = CopyOnWriteArraySet<() -> Unit>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var job: Job? = null

    var running = false
        private set
    var status: String? = null
        private set

    fun addListener(l: () -> Unit) {
        listeners += l
    }

    fun removeListener(l: () -> Unit) {
        listeners -= l
    }

    private fun update(block: () -> Unit) = main.post {
        block()
        listeners.forEach { it() }
    }

    private fun dir(context: Context) = File(context.filesDir, "brain").apply { mkdirs() }

    private fun file(context: Context, id: String) = File(dir(context), "$id.txt")

    fun digest(context: Context, id: String): String? = file(context, id).takeIf { it.exists() }?.readText()

    /** How many documents have a digest, of how many. */
    fun readiness(context: Context): Pair<Int, Int> {
        val items = Library.items(context)
        return items.count { file(context, it.id).exists() } to items.size
    }

    /** Makes the digest of one document. Call off the main thread. */
    fun makeDigest(context: Context, item: Library.Item): String {
        file(context, item.id).takeIf { it.exists() }?.let { return it.readText() }
        val doc = Opener.parse(context, item)
        val budget = (Llm.bulkInputChars(context) * 3 / 4).coerceAtMost(120_000)
        // The beginning, then the start of every chapter: enough to know what it says.
        val sample = StringBuilder()
        sample.append(doc.paragraphs.take(12).joinToString("\n\n")).append("\n\n")
        val perChapter = if (doc.chapters.isEmpty()) 0 else (budget - sample.length).coerceAtLeast(0) / doc.chapters.size
        for (ch in doc.chapters) {
            if (sample.length > budget) break
            sample.append("## ").append(ch.title).append("\n")
            var used = 0
            var i = ch.start
            while (i < doc.paragraphs.size && used < perChapter && doc.chapterAt(i) == ch) {
                sample.append(doc.paragraphs[i]).append("\n\n")
                used += doc.paragraphs[i].length
                i++
            }
        }
        if (doc.chapters.isEmpty()) {
            for (p in doc.paragraphs.drop(12)) {
                if (sample.length > budget) break
                sample.append(p).append("\n\n")
            }
        }
        val text = Llm.generateBulk(
            context,
            "Write a compact knowledge digest of \"${doc.title}\"" + (doc.author?.let { " by $it" } ?: "") +
                " (about 200 to 300 words) for a personal library that will later answer questions across many books: " +
                "what kind of work it is, its subject, its main ideas, claims and arguments, its conclusions, notable facts " +
                "or findings, and for fiction the plot, main characters and themes. Plain text, no markdown. End with one line " +
                "starting \"Topics:\" listing 5 to 10 topics.\n\nText (beginning and the start of each chapter):\n\n" +
                sample.take(budget),
        )
        file(context, item.id).writeText(text)
        return text
    }

    /** Prepares digests for every document that has none yet, in the background. */
    fun prepareAll(context: Context) {
        val app = context.applicationContext
        if (running || !Llm.ready(app)) return
        running = true
        update { status = "Getting your library ready for questions…" }
        job = scope.launch {
            val todo = Library.items(app).filter { !file(app, it.id).exists() }
            var done = 0
            var failed = 0
            for (item in todo) {
                update { status = "Reading “${item.title.take(40)}” (${done + 1} of ${todo.size})…" }
                try {
                    makeDigest(app, item)
                } catch (e: Exception) {
                    failed++
                    if (e is Groq.GroqException && "daily" in e.message.orEmpty()) {
                        update { status = e.message }
                        break
                    }
                }
                done++
            }
            update {
                running = false
                val (ready, total) = readiness(app)
                if (status?.contains("daily") != true) {
                    status = "$ready of $total documents ready for questions" + if (failed > 0) " ($failed couldn't be read; try again later)" else ""
                }
            }
        }
    }

    fun cancel() {
        job?.cancel()
        update {
            running = false
            status = null
        }
    }

    /** Answers a question across the whole library. Call off the main thread. */
    fun ask(context: Context, question: String): String {
        val items = Library.items(context)
        if (items.isEmpty()) return "Your library is empty. Add a book first, then ask me about it."
        val words = question.lowercase().split(Regex("""\W+""")).filter { it.length > 3 }.toSet()
        val known = items.mapNotNull { item -> digest(context, item.id)?.let { item to it } }
        val budget = Llm.inputChars(context) - 4_000
        val ranked = known.sortedByDescending { (item, d) ->
            val text = (item.title + " " + (item.author ?: "") + " " + d).lowercase()
            words.count { it in text } * 10 + (item.opened / 86_400_000L).toInt() % 10
        }
        val sb = StringBuilder()
        for ((item, d) in ranked) {
            val block = "### ${item.title}${item.author?.let { " by $it" } ?: ""} (listened ${Library.progress(context, item)}%)\n$d\n\n"
            if (sb.length + block.length > budget) break
            sb.append(block)
        }
        val others = items.filter { i -> known.none { it.first.id == i.id } }
        val list = others.take(80).joinToString("\n") { "- ${it.title}${it.author?.let { a -> " by $a" } ?: ""} (listened ${Library.progress(context, it)}%)" }
        return Llm.generate(
            context,
            "You are the memory of someone's personal library of books, papers and articles they listen to. Answer their " +
                "question from what is in their library, naming the books you draw on. Say clearly when the library doesn't " +
                "cover something, and you may add brief general knowledge marked as such. About 120 to 250 words.\n\n" +
                "Digests of documents in the library:\n\n$sb" +
                (if (list.isNotEmpty()) "Other documents in the library (no digest yet):\n$list\n\n" else "") +
                "Question: $question",
            system = "Your answer will be read aloud. Plain natural prose only: no markdown, no bullet symbols, no emojis.",
        )
    }

    // ---- Taste and recommendations ----

    private fun prefs(context: Context) = context.getSharedPreferences("p2a", Context.MODE_PRIVATE)

    fun profile(context: Context): String? = prefs(context).getString("tasteProfile", null)?.ifBlank { null }

    fun setProfile(context: Context, text: String) = prefs(context).edit().putString("tasteProfile", text.trim()).apply()

    /** Works out the reader's taste from their library. Call off the main thread. */
    fun learnProfile(context: Context): String {
        val items = Library.items(context)
        if (items.isEmpty()) error("Add a few books first, so I can learn what you like.")
        val list = items.take(150).joinToString("\n") { item ->
            val topics = digest(context, item.id)?.lineSequence()?.firstOrNull { it.startsWith("Topics:") }.orEmpty()
            "- ${item.title}${item.author?.let { " by $it" } ?: ""}; listened ${Library.progress(context, item)}% $topics"
        }
        val text = Llm.generate(
            context,
            "From this reader's library (books they listened to further are stronger signals), describe their reading taste " +
                "in exactly three short sections, each one line of comma-separated items:\nEnjoys: …\nPrefers: …\nAvoids: …\n" +
                "Enjoys = subjects and genres; Prefers = qualities like depth, narrative, practical; Avoids = what they seem to " +
                "dislike (guess sensibly). No other text.\n\nLibrary:\n$list",
        ).trim()
        setProfile(context, text)
        return text
    }

    class Recommendation(val title: String, val author: String, val why: String)

    /** Books to read next for this reader (not simply popular ones). Call off the main thread. */
    fun recommend(context: Context, wish: String = ""): List<Recommendation> {
        val items = Library.items(context)
        val profile = profile(context) ?: if (items.isNotEmpty()) learnProfile(context) else ""
        val have = items.take(150).joinToString("; ") { it.title }
        val answer = Llm.generate(
            context,
            "Recommend 10 books this reader should read next, matched to their intellectual taste rather than popularity. " +
                "Mix well-known and lesser-known excellent books; no books they already have.\n\nTaste profile:\n$profile\n\n" +
                "Already in their library: $have\n\n" + (if (wish.isNotBlank()) "Right now they want: $wish\n\n" else "") +
                "Return only JSON: {\"books\":[{\"title\":\"…\",\"author\":\"…\",\"why\":\"one sentence on why it suits them\"}]}",
            json = true,
        )
        val arr = JSONObject(Ai.cleanJson(answer)).optJSONArray("books") ?: return emptyList()
        return (0 until arr.length()).map { arr.getJSONObject(it) }.map {
            Recommendation(it.optString("title"), it.optString("author"), it.optString("why"))
        }.filter { it.title.isNotBlank() }
    }
}
