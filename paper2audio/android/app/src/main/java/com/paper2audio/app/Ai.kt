package com.paper2audio.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/** AI features built on [Gemini]: summaries, passage explanations and figure/table explanations. */
object Ai {
    private const val SPOKEN = "Your answer will be read aloud by a text-to-speech voice. Write plain, natural prose only: " +
        "no markdown, no asterisks, no bullet symbols, no headings marked with #, no tables, no LaTeX, no emojis. " +
        "Say math and symbols in words. Do not start with a preamble like \"Here is\"; begin directly."

    /** Per request, input is kept below the free tier's per-minute token limit. */
    private const val CHUNK_CHARS = 350_000

    private fun cacheFile(context: Context, vararg parts: String): File {
        val md = MessageDigest.getInstance("SHA-1").digest(parts.joinToString("\u0000").toByteArray())
        return File(File(context.filesDir, "ai").apply { mkdirs() }, md.joinToString("") { "%02x".format(it) } + ".txt")
    }

    private fun cached(file: File, make: () -> String): String {
        if (file.exists()) return file.readText()
        return make().also { file.writeText(it) }
    }

    fun kindOf(doc: Doc, item: Library.Item?): String = when {
        item?.kind == Loader.Kind.EPUB || doc.words > 40_000 -> "book"
        item?.kind == Loader.Kind.HTML -> "article"
        else -> "document"
    }

    /**
     * A short (about 2 minutes of listening) or long (about 10 minutes) summary of the
     * paragraphs [from] until [to], e.g. the whole document or one chapter.
     */
    fun summary(context: Context, doc: Doc, item: Library.Item?, long: Boolean, from: Int, to: Int, what: String, progress: (String) -> Unit): String {
        val paras = doc.paragraphs.subList(from.coerceIn(0, doc.paragraphs.size), to.coerceIn(from, doc.paragraphs.size))
        val text = paras.joinToString("\n\n")
        val file = cacheFile(context, "summary", if (long) "long" else "short", doc.title, text.length.toString(), text.hashCode().toString())
        return cached(file) {
            val length = if (long) {
                "a detailed summary of about 1,000 to 1,500 words that walks through the main parts in order, " +
                    "with the key ideas, arguments, methods, findings or events, and the conclusions"
            } else {
                "a short summary of about 200 to 300 words with the main point and the most important takeaways"
            }
            val source = if (text.length <= CHUNK_CHARS) text else {
                // Too long for one request: summarize each part, then summarize the summaries.
                val chunks = chunk(paras)
                chunks.mapIndexed { i, c ->
                    progress("Reading part ${i + 1} of ${chunks.size}…")
                    Gemini.generate(
                        context,
                        "Summarize this part (${i + 1} of ${chunks.size}) of \"${doc.title}\" in about 400 to 700 words, " +
                            "keeping names, key facts and the order of ideas.\n\n$c",
                        system = SPOKEN,
                    )
                }.joinToString("\n\n")
            }
            progress("Writing the summary…")
            Gemini.generate(
                context,
                "Write $length of $what of the ${kindOf(doc, item)} \"${doc.title}\"" +
                    (doc.author?.let { " by $it" } ?: "") + ".\n\nText:\n\n$source",
                system = SPOKEN,
            )
        }
    }

    private fun chunk(paras: List<String>): List<String> {
        val out = ArrayList<String>()
        val sb = StringBuilder()
        for (p in paras) {
            if (sb.length + p.length > CHUNK_CHARS && sb.isNotEmpty()) {
                out += sb.toString()
                sb.clear()
            }
            sb.append(p).append("\n\n")
        }
        if (sb.isNotEmpty()) out += sb.toString()
        return out
    }

    /** A plain-language explanation of one paragraph, with definitions of hard terms. */
    fun explain(context: Context, doc: Doc, index: Int): String {
        val para = doc.paragraphs[index]
        val before = doc.paragraphs.subList((index - 2).coerceAtLeast(0), index).joinToString("\n\n")
        val file = cacheFile(context, "explain", doc.title, para)
        return cached(file) {
            Gemini.generate(
                context,
                "From \"${doc.title}\". Context before the passage:\n\n$before\n\nPassage:\n\n$para\n\n" +
                    "Explain the passage in plain language for a curious listener, in about 100 to 180 words. " +
                    "Then define up to five difficult terms from it, each as its own sentence like: " +
                    "\"Term: short definition.\" Skip definitions if nothing is difficult.",
                system = SPOKEN,
            )
        }
    }

    // ---- Transcription (audio and video) ----

    /**
     * Turns a recording (lecture, podcast, interview, voice memo, video) into text:
     * paragraphs, with speaker names or "Speaker 1:" when several people talk.
     */
    fun transcribe(context: Context, uri: android.net.Uri, name: String, progress: (String) -> Unit): String {
        val cr = context.contentResolver
        val mime = cr.getType(uri)?.takeIf { it.startsWith("audio/") || it.startsWith("video/") } ?: guessMime(name)
        val size = cr.openFileDescriptor(uri, "r")?.use { it.statSize } ?: -1L
        val prompt = "Transcribe this recording completely and accurately, in its original language. " +
            "Write clean paragraphs: remove filler words (um, uh) and false starts, fix obvious slips, but keep the meaning and wording. " +
            "If more than one person speaks, begin each change of speaker with their name if it is said, otherwise \"Speaker 1:\", " +
            "\"Speaker 2:\" and so on. Mark long music or silence briefly in brackets. No timestamps, no markdown, no commentary."
        return if (size in 1..18_000_000L) {
            progress("Gemini is transcribing…")
            val bytes = cr.openInputStream(uri)?.use { it.readBytes() } ?: error("Couldn't read that file")
            Gemini.generate(context, prompt, attachment = mime to bytes)
        } else {
            val fileUri = Gemini.upload(context, uri, mime, name, progress)
            progress("Gemini is transcribing… (long recordings take a few minutes)")
            Gemini.generate(context, prompt, uploaded = mime to fileUri)
        }
    }

    private fun guessMime(name: String) = when (name.substringAfterLast('.').lowercase()) {
        "mp3" -> "audio/mpeg"
        "m4a", "aac" -> "audio/aac"
        "wav" -> "audio/wav"
        "ogg", "opus" -> "audio/ogg"
        "flac" -> "audio/flac"
        "mp4", "m4v" -> "video/mp4"
        "webm" -> "video/webm"
        "mov" -> "video/quicktime"
        "3gp" -> "video/3gpp"
        else -> "audio/mpeg"
    }

    // ---- Translation ----

    /** Languages offered for translation (ISO code to English name). */
    val TRANSLATE_TO = listOf(
        "hi" to "Hindi", "en" to "English", "bn" to "Bengali", "mr" to "Marathi", "ta" to "Tamil", "te" to "Telugu",
        "gu" to "Gujarati", "kn" to "Kannada", "ml" to "Malayalam", "pa" to "Punjabi", "ur" to "Urdu",
        "es" to "Spanish", "fr" to "French", "de" to "German", "it" to "Italian", "pt" to "Portuguese",
        "ru" to "Russian", "ar" to "Arabic", "zh" to "Chinese", "ja" to "Japanese", "ko" to "Korean",
        "tr" to "Turkish", "nl" to "Dutch", "pl" to "Polish", "id" to "Indonesian", "vi" to "Vietnamese",
    )

    /**
     * Translates the whole document into [language], keeping chapters (as Markdown
     * "#" headings so they become chapters again). Long documents go in parts.
     */
    fun translate(context: Context, doc: Doc, language: String, progress: (String) -> Unit): String {
        val file = cacheFile(context, "translate", language, doc.title, doc.words.toString(), doc.paragraphs.hashCode().toString())
        return cached(file) {
            // Chapters, each as its paragraphs; a document without chapters is one part.
            val starts = doc.chapters.map { it.start }.filter { it > 0 }.let { listOf(0) + it } + doc.paragraphs.size
            val sections = starts.zipWithNext().map { (a, b) -> doc.paragraphs.subList(a, b) }.filter { it.isNotEmpty() }
            val chunks = ArrayList<String>()
            val sb = StringBuilder()
            for ((i, sec) in sections.withIndex()) {
                val heading = doc.chapters.firstOrNull { it.start == starts[i] }?.title
                val text = (listOfNotNull(heading?.let { "# $it" }) + sec.drop(if (heading != null && sec.first() == heading) 1 else 0))
                    .joinToString("\n\n")
                if (sb.length + text.length > 24_000 && sb.isNotEmpty()) {
                    chunks += sb.toString()
                    sb.clear()
                }
                if (text.length > 24_000) {
                    // One very long chapter: split it by paragraphs.
                    var part = StringBuilder()
                    for (para in text.split("\n\n")) {
                        if (part.length + para.length > 24_000 && part.isNotEmpty()) {
                            chunks += part.toString()
                            part = StringBuilder()
                        }
                        part.append(para).append("\n\n")
                    }
                    if (part.isNotEmpty()) chunks += part.toString()
                } else {
                    sb.append(text).append("\n\n")
                }
            }
            if (sb.isNotEmpty()) chunks += sb.toString()
            val title = Gemini.generate(context, "Translate this title into $language. Reply with the translation only:\n\n${doc.title}").lines().first().trim()
            val body = chunks.mapIndexed { i, c ->
                progress(if (chunks.size > 1) "Translating part ${i + 1} of ${chunks.size}…" else "Translating…")
                Gemini.generate(
                    context,
                    "Translate the following text into natural, fluent $language that reads well aloud. Keep every paragraph " +
                        "and keep lines starting with # as headings (translate their text). Output only the translation.\n\n$c",
                )
            }
            "# $title\n\n" + body.joinToString("\n\n")
        }
    }

    // ---- Figures, tables and equations (PDF) ----

    class Visual(val label: String, val kind: String, val explanation: String)

    fun visualsFile(context: Context, item: Library.Item) = File(Library.dir(context), "${item.id}.ai.json")

    fun visuals(context: Context, item: Library.Item): List<Visual>? {
        val f = visualsFile(context, item)
        if (!f.exists()) return null
        return runCatching { parseVisuals(f.readText()) }.getOrNull()
    }

    /** Asks Gemini to look at the PDF's figures, tables and key equations; saves the explanations. */
    fun explainVisuals(context: Context, item: Library.Item): Int {
        val pdf = Library.source(context, item).file
        if (pdf.length() > 18_000_000) throw Gemini.GeminiException("This PDF is too large for free Gemini (the limit is about 18 MB).")
        val answer = Gemini.generate(
            context,
            "Look at every figure, table and important numbered equation in this PDF. For each one, write an explanation " +
                "to be read aloud to someone listening to the paper who cannot see it: what it shows, how to read it, " +
                "and the main takeaway, with the key numbers or trends. About 60 to 150 words each; tables may take " +
                "longer. Say math in words.\n\nReturn only a JSON array, in the order they appear, of objects with: " +
                "\"label\" (exactly as printed, such as \"Figure 3\", \"Table 2\" or \"Equation 4\"; for unnumbered ones a " +
                "short name), \"kind\" (\"figure\", \"table\" or \"equation\"), \"explanation\" (plain prose, no markdown).",
            attachment = "application/pdf" to pdf.readBytes(),
            json = true,
        )
        val visuals = parseVisuals(answer)
        if (visuals.isEmpty()) throw Gemini.GeminiException("Gemini found no figures or tables in this document.")
        val arr = JSONArray()
        visuals.forEach { arr.put(JSONObject().put("label", it.label).put("kind", it.kind).put("explanation", it.explanation)) }
        visualsFile(context, item).writeText(arr.toString())
        return visuals.size
    }

    internal fun parseVisuals(text: String): List<Visual> {
        val t = text.trim().removePrefix("```json").removePrefix("```").removeSuffix("```").trim()
        val arr = if (t.startsWith("{")) JSONObject(t).let { o -> o.keys().asSequence().map { o.opt(it) }.firstOrNull { it is JSONArray } as? JSONArray ?: JSONArray() } else JSONArray(t)
        return (0 until arr.length()).mapNotNull { i ->
            val o = arr.optJSONObject(i) ?: return@mapNotNull null
            val e = o.optString("explanation").trim()
            if (e.isEmpty()) null else Visual(o.optString("label").trim().ifBlank { "Figure" }, o.optString("kind").trim().lowercase(), e)
        }
    }

    /**
     * Inserts each explanation right after the paragraph that first refers to it
     * ("as shown in Figure 3"); the rest go into a section at the end.
     */
    fun withVisuals(doc: Doc, visuals: List<Visual>): Doc {
        val inserts = HashMap<Int, MutableList<String>>()
        val rest = ArrayList<String>()
        for (v in visuals) {
            val intro = "${v.label}, explained. "
            val at = reference(v.label)?.let { re -> doc.paragraphs.indexOfFirst { re.containsMatchIn(it) } } ?: -1
            val text = TextCleaner.splitLong(intro + v.explanation)
            if (at >= 0) inserts.getOrPut(at) { ArrayList() } += text else rest += text
        }
        val paragraphs = ArrayList<String>()
        val shift = IntArray(doc.paragraphs.size + 1)
        var added = 0
        for ((i, p) in doc.paragraphs.withIndex()) {
            shift[i] = added
            paragraphs += p
            inserts[i]?.let {
                paragraphs += it
                added += it.size
            }
        }
        val chapters = doc.chapters.map { Chapter(it.title, it.start + shift[it.start.coerceIn(0, doc.paragraphs.size)]) }.toMutableList()
        if (rest.isNotEmpty()) {
            chapters += Chapter("Figures and tables explained", paragraphs.size)
            paragraphs += rest.flatMap { TextCleaner.splitLong(it) }
        }
        return Doc(doc.title, paragraphs, chapters, doc.key, doc.author, doc.cover, doc.pages)
    }

    private fun reference(label: String): Regex? {
        val m = Regex("""^(fig(?:ure)?|table|tab|eq(?:uation)?|algorithm|alg)\.?\s*([A-Za-z]?\d+[a-z]?)""", RegexOption.IGNORE_CASE)
            .find(label.trim()) ?: return null
        val n = Regex.escape(m.groupValues[2])
        val word = when (m.groupValues[1].lowercase().take(2)) {
            "fi" -> "(?:fig(?:ure)?s?\\.?)"
            "ta" -> "(?:tables?|tabs?\\.?)"
            "eq" -> "(?:eqs?\\.?|equations?)"
            else -> "(?:algorithms?|alg\\.?)"
        }
        return Regex("""\b$word\s*\(?$n\b""", RegexOption.IGNORE_CASE)
    }
}
