package com.paper2audio.app

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.CopyOnWriteArraySet

/**
 * One book, several listening experiences: the AI rewrites it chapter by chapter into a shorter
 * Essential version, a Deep-understanding version, chapter summaries, a teaching version or a
 * question-and-answer version. Each becomes its own document in the library (with chapters),
 * so it plays, downloads and saves like any other. Work is kept per part, so an interrupted
 * version continues where it stopped.
 */
object Versions {
    enum class Kind(val label: String, val emoji: String, val note: String) {
        ESSENTIAL("Essential", "⚡", "the key ideas in about 90 minutes"),
        DEEP("Deep understanding", "🧠", "the full argument with its reasoning, in about 3 hours"),
        SUMMARIES("Chapter summaries", "📝", "about 2 minutes per chapter"),
        TEACH("Teach me", "🎓", "a teacher explains the difficult ideas of each chapter, with examples"),
        CHALLENGE("Challenge me", "🧐", "after each chapter's recap, questions to think about, then the answers"),
    }

    private val main = Handler(Looper.getMainLooper())
    private val listeners = CopyOnWriteArraySet<() -> Unit>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var job: Job? = null

    var running = false
        private set
    var message: String? = null
        private set
    var progress = 0
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

    private fun titleOf(doc: Doc, kind: Kind) = "${doc.title} — ${kind.label}"

    private fun minutes(words: Int) = (words / 150f).toInt().coerceAtLeast(1)

    private fun duration(min: Int) = if (min >= 60) "${min / 60} h ${min % 60} min" else "$min min"

    /** Words the version aims for in total (chapter-based kinds return the size per chapter). */
    private fun targetWords(doc: Doc, kind: Kind): Int = when (kind) {
        Kind.ESSENTIAL -> minOf(13_500, doc.words / 5).coerceAtLeast(800)
        Kind.DEEP -> minOf(27_000, doc.words / 2).coerceAtLeast(1_500)
        else -> 0
    }

    /** The choice of versions for the book being listened to. */
    fun choose(activity: Activity) {
        val doc = Speaker.doc ?: return
        val chapters = maxOf(1, doc.chapters.size)
        val full = minutes(doc.words)
        val labels = listOf("🎧 Full audiobook · ${duration(full)} (this one)") + Kind.entries.map { k ->
            val length = when (k) {
                Kind.ESSENTIAL, Kind.DEEP -> " · about ${duration(minutes(targetWords(doc, k)))}"
                Kind.SUMMARIES -> " · about ${duration(chapters * 2)}"
                else -> ""
            }
            val have = if (existing(activity, doc, k) != null) " ✓ ready" else ""
            "${k.emoji} ${k.label}$length$have\n${k.note}"
        }
        AlertDialog.Builder(activity)
            .setTitle(if (running) "Versions (${message ?: "working…"})" else "Listen to this book as…")
            .setItems(labels.toTypedArray()) { _, which ->
                if (which == 0) return@setItems
                val kind = Kind.entries[which - 1]
                val have = existing(activity, doc, kind)
                when {
                    have != null -> open(activity, have)
                    running -> Toast.makeText(activity, "Please wait: ${message ?: "another version is being made"}", Toast.LENGTH_LONG).show()
                    else -> AiKeyDialog.withKey(activity) { confirm(activity, doc, kind) }
                }
            }
            .show()
    }

    private fun confirm(activity: Activity, doc: Doc, kind: Kind) {
        val big = doc.words > 60_000
        val slow = big && Gemini.key(activity) == null
        AlertDialog.Builder(activity)
            .setTitle("Make the ${kind.label} version?")
            .setMessage(
                "The AI reads the book chapter by chapter and writes ${kind.note}. It is added to your library when ready; " +
                    "you can keep listening meanwhile." +
                    if (slow) "\n\nThis is a long book. Groq's free tier reads a limited amount per minute, so it may take a while " +
                        "or pause until tomorrow's allowance. Adding a free Gemini key (Settings › AI) makes it much faster." else ""
            )
            .setPositiveButton("Make it") { _, _ -> start(activity, doc, kind) }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun existing(context: Context, doc: Doc, kind: Kind): Library.Item? =
        Library.items(context).firstOrNull { it.title == titleOf(doc, kind) }

    private fun open(activity: Activity, item: Library.Item) {
        val app = activity.applicationContext
        scope.launch {
            try {
                val d = Opener.parse(app, item)
                Library.opened(app, item, d)
                main.post {
                    Speaker.load(d)
                    Speaker.play()
                    activity.startActivity(Intent(activity, PlayerActivity::class.java))
                }
            } catch (e: Exception) {
                main.post { Toast.makeText(activity, e.message ?: "Couldn't open it", Toast.LENGTH_LONG).show() }
            }
        }
    }

    fun cancel() {
        job?.cancel()
    }

    private fun cacheFile(context: Context, vararg parts: String): File {
        val md = MessageDigest.getInstance("SHA-1").digest(parts.joinToString("\u0000").toByteArray())
        return File(File(context.filesDir, "versions").apply { mkdirs() }, md.joinToString("") { "%02x".format(it) } + ".txt")
    }

    private fun start(activity: Activity, doc: Doc, kind: Kind) {
        val app = activity.applicationContext
        val from = Library.get(app, doc.key)
        running = true
        progress = 0
        message = "Starting the ${kind.label} version…"
        listeners.forEach { it() }
        ReaderService.start(app)
        job = scope.launch {
            try {
                val text = write(app, doc, kind)
                val (item, newDoc) = Opener.import(app, { Loader.storeText(app, titleOf(doc, kind), text, "md") })
                from?.let { f ->
                    f.collection?.let { Library.setCollection(app, item, it) }
                    runCatching { Library.thumb(app, f.id).copyTo(Library.thumb(app, item.id), overwrite = true) }
                    item.author = f.author
                }
                Library.opened(app, item, newDoc)
                DriveSync.request(app)
                update { message = "${kind.label} version ready in your library ✓" }
                main.post { Toast.makeText(app, "“${titleOf(doc, kind)}” is ready in your library", Toast.LENGTH_LONG).show() }
            } catch (e: CancellationException) {
                update { message = "Stopped (what was done is kept; start it again to continue)" }
            } catch (e: Exception) {
                update { message = "The ${kind.label} version stopped: ${e.message ?: e.javaClass.simpleName}. Start it again to continue." }
            } finally {
                update { running = false }
            }
        }
    }

    /** The chapters (or parts, for documents without chapters) as text. */
    private fun parts(doc: Doc): List<Pair<String, String>> {
        if (doc.chapters.size >= 2) {
            return doc.chapters.mapIndexed { i, ch ->
                val end = doc.chapters.getOrNull(i + 1)?.start ?: doc.paragraphs.size
                ch.title to doc.paragraphs.subList(ch.start, end).joinToString("\n\n")
            }.filter { it.second.length > 400 }
        }
        // No chapters: parts of about 25 minutes each.
        val out = ArrayList<Pair<String, String>>()
        val sb = StringBuilder()
        for (p in doc.paragraphs) {
            sb.append(p).append("\n\n")
            if (sb.length > 22_000) {
                out += "Part ${out.size + 1}" to sb.toString()
                sb.clear()
            }
        }
        if (sb.isNotBlank()) out += "Part ${out.size + 1}" to sb.toString()
        return out
    }

    private fun write(context: Context, doc: Doc, kind: Kind): String {
        val chapters = parts(doc).filterNot { (title, _) -> FrontMatter.isFrontOrBack(title) }.ifEmpty { parts(doc) }
        val total = chapters.sumOf { it.second.length }.coerceAtLeast(1)
        val ratio = when (kind) {
            Kind.ESSENTIAL, Kind.DEEP -> (targetWords(doc, kind).toDouble() / doc.words.coerceAtLeast(1)).coerceIn(0.02, 0.8)
            else -> 0.0
        }
        val limit = (Llm.bulkInputChars(context) - 3_000).coerceAtLeast(8_000)
        val out = StringBuilder()
        var done = 0L
        val about = "\"${doc.title}\"" + (doc.author?.let { " by $it" } ?: "")
        for ((n, chapter) in chapters.withIndex()) {
            val (title, text) = chapter
            val pieces = split(text, limit)
            val written = pieces.mapIndexed { k, piece ->
                val pct = ((done + piece.length) * 100 / total).toInt()
                update {
                    progress = pct.coerceIn(0, 99)
                    message = "${kind.label}: chapter ${n + 1} of ${chapters.size} · $progress%"
                }
                val words = (piece.split(' ').size * ratio).toInt().coerceAtLeast(120)
                val part = if (pieces.size > 1) " (part ${k + 1} of ${pieces.size})" else ""
                val ask = when (kind) {
                    Kind.ESSENTIAL -> "Rewrite this chapter$part of $about as an essential version of about $words words that keeps " +
                        "only the key ideas, arguments, findings and the most memorable examples (for fiction, the key events and " +
                        "dialogue moments), in the author's order, as flowing prose to be listened to."
                    Kind.DEEP -> "Rewrite this chapter$part of $about as a deep-understanding version of about $words words: keep " +
                        "the full line of argument, the reasoning and evidence behind each claim, key examples and nuances, cutting " +
                        "only repetition and padding. Flowing prose to be listened to."
                    Kind.SUMMARIES -> "Summarize this chapter$part of $about in about ${if (pieces.size > 1) 160 else 300} words: " +
                        "the main points in order and why they matter."
                    Kind.TEACH -> "You are an inspiring teacher. For this chapter$part of $about, teach the difficult or important " +
                        "concepts in about 400 to 700 words: explain each one simply, give a vivid example or analogy, and connect " +
                        "it to the bigger picture. Talk directly to the listener."
                    Kind.CHALLENGE -> "For this chapter$part of $about: first a recap of about 120 words. Then three thought-" +
                        "provoking questions. Write each as its own paragraph \"Question one: …\", then a paragraph \"Take a moment " +
                        "to think about it.\", then a paragraph \"Here is an answer: …\" of 40 to 90 words."
                }
                val file = cacheFile(context, kind.name, doc.key, title, k.toString(), piece.length.toString(), piece.hashCode().toString())
                val result = if (file.exists()) file.readText() else Llm.generateBulk(
                    context,
                    "$ask\n\nChapter: $title\n\n$piece",
                    system = "Your text will be read aloud as an audiobook. Plain prose only: no markdown, no headings, no bullet " +
                        "symbols, no emojis. Say symbols and numbers in words where needed. Begin directly, without a preamble.",
                ).also { file.writeText(it) }
                done += piece.length
                result.trim()
            }
            out.append("# ").append(title.replace('\n', ' ')).append("\n\n")
            out.append(written.joinToString("\n\n")).append("\n\n")
        }
        return out.toString()
    }

    private fun split(text: String, limit: Int): List<String> {
        if (text.length <= limit) return listOf(text)
        val out = ArrayList<String>()
        val sb = StringBuilder()
        for (p in text.split("\n\n")) {
            if (sb.length + p.length > limit && sb.isNotEmpty()) {
                out += sb.toString()
                sb.clear()
            }
            sb.append(p).append("\n\n")
        }
        if (sb.isNotBlank()) out += sb.toString()
        return out
    }
}
