package com.paper2audio.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/**
 * AI features, through [Llm] (Grok or Gemini): briefings, summaries, explanations,
 * questions about a document, study material, podcast scripts, figure and table
 * explanations and translation. Transcription always uses Gemini (it takes audio).
 */
object Ai {
    private const val SPOKEN = "Your answer will be read aloud by a text-to-speech voice. Write plain, natural prose only: " +
        "no markdown, no asterisks, no bullet symbols, no headings marked with #, no tables, no LaTeX, no emojis. " +
        "Say math and symbols in words. Do not start with a preamble like \"Here is\"; begin directly."

    /** Per request, input is kept below the free tier's per-minute token limit. */
    private const val CHUNK_CHARS = 350_000

    private fun cacheFile(context: Context, vararg parts: String): File {
        val md = MessageDigest.getInstance("SHA-1").digest((listOf(Llm.name(context)) + parts).joinToString("\u0000").toByteArray())
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
                    Llm.generate(
                        context,
                        "Summarize this part (${i + 1} of ${chunks.size}) of \"${doc.title}\" in about 400 to 700 words, " +
                            "keeping names, key facts and the order of ideas.\n\n$c",
                        system = SPOKEN,
                    )
                }.joinToString("\n\n")
            }
            progress("Writing the summary…")
            Llm.generate(
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

    /** Ways to explain a passage while listening. */
    enum class Explain(val label: String, val ask: String) {
        PLAIN("Explain", "Explain the passage in plain language for a curious listener, in about 100 to 180 words. " +
            "Then define up to five difficult terms from it, each as its own sentence like \"Term: short definition.\""),
        CHILD("Explain like I'm 10", "Explain the passage to a curious ten-year-old, in about 100 to 150 words, with a simple " +
            "everyday comparison. No jargon."),
        EXPERT("Explain at medical-professor level", "Explain the passage as a medical professor would to residents, in about " +
            "150 to 250 words: precise terminology, mechanisms, how it fits current evidence and clinical practice, and how strong the evidence is."),
        EXAMPLE("Give me an example", "Give one or two concrete, realistic examples that make the passage clear, in about 100 to 180 words."),
        WHY("Why is this important?", "Explain why this passage matters, for the paper's argument and in practice, in about 100 to 160 words."),
        TERMS("What do these terms mean?", "Define each technical term, abbreviation or unit in the passage, one per sentence, like " +
            "\"Term: definition.\" Keep each definition short."),
    }

    /** An explanation of paragraph [index] (or just [sentence] in it), in the chosen [mode]. */
    fun explain(context: Context, doc: Doc, index: Int, mode: Explain = Explain.PLAIN, sentence: String? = null): String {
        val para = doc.paragraphs[index]
        val before = doc.paragraphs.subList((index - 2).coerceAtLeast(0), index).joinToString("\n\n")
        val passage = sentence?.takeIf { it.isNotBlank() && it != para }
        val file = cacheFile(context, "explain", mode.name, doc.title, passage ?: para)
        return cached(file) {
            Llm.generate(
                context,
                "From \"${doc.title}\"" + (doc.chapterAt(index)?.let { ", section \"${it.title}\"" } ?: "") +
                    ". Context before the passage:\n\n$before\n\n" +
                    (if (passage != null) "Paragraph:\n\n$para\n\nPassage (one sentence of it):\n\n$passage" else "Passage:\n\n$para") +
                    "\n\n${mode.ask}",
                system = SPOKEN,
            )
        }
    }

    // ---- Briefing ----

    /**
     * A five-minute spoken briefing before listening: what it is about, the question,
     * the main findings, limitations and why it matters.
     */
    fun briefing(context: Context, doc: Doc, item: Library.Item?, progress: (String) -> Unit): String {
        val text = doc.paragraphs.joinToString("\n\n")
        val file = cacheFile(context, "briefing", doc.title, text.length.toString(), text.hashCode().toString())
        return cached(file) {
            val source = condensed(context, doc, progress)
            progress("Writing the briefing…")
            Llm.generate(
                context,
                "Write a spoken five-minute briefing (about 650 to 800 words) on the ${kindOf(doc, item)} \"${doc.title}\"" +
                    (doc.author?.let { " by $it" } ?: "") + ", for someone about to listen to it. Cover these parts, each " +
                    "introduced by a short spoken lead-in sentence (not a heading): what it is about; the question it " +
                    "answers; how they studied it (briefly); the main findings with the key numbers; the important " +
                    "limitations; and the practical implications. For a book or non-research text, adapt the parts sensibly. " +
                    "End by inviting the listener to hear the full text.\n\nText:\n\n$source",
                system = SPOKEN,
            )
        }
    }

    /** The document's text, condensed in parts first when it is too long for one request. */
    private fun condensed(context: Context, doc: Doc, progress: (String) -> Unit): String {
        val text = doc.paragraphs.joinToString("\n\n")
        if (text.length <= CHUNK_CHARS) return text
        val chunks = chunk(doc.paragraphs)
        return chunks.mapIndexed { i, c ->
            progress("Reading part ${i + 1} of ${chunks.size}…")
            Llm.generate(
                context,
                "Summarize this part (${i + 1} of ${chunks.size}) of \"${doc.title}\" in about 500 to 800 words, keeping " +
                    "names, numbers, findings and the order of ideas.\n\n$c",
            )
        }.joinToString("\n\n")
    }

    // ---- Ask this document ----

    class Turn(val question: String, val answer: String)

    fun chatFile(context: Context, doc: Doc) = File(File(context.filesDir, "chat").apply { mkdirs() }, "${doc.key}.json")

    fun history(context: Context, doc: Doc): List<Turn> = runCatching {
        val arr = JSONArray(chatFile(context, doc).readText())
        (0 until arr.length()).map { arr.getJSONObject(it) }.map { Turn(it.getString("q"), it.getString("a")) }
    }.getOrDefault(emptyList())

    fun clearHistory(context: Context, doc: Doc) = chatFile(context, doc).delete()

    /**
     * Answers a question about the whole document, citing the section and paragraph
     * numbers it used, like [Methods ¶12], which the chat turns into links.
     */
    fun ask(context: Context, doc: Doc, question: String): String {
        val past = history(context, doc)
        val source = numbered(doc, question, CHUNK_CHARS)
        val convo = past.takeLast(6).joinToString("\n\n") { "Question: ${it.question}\nAnswer: ${it.answer}" }
        val answer = Llm.generate(
            context,
            "You answer questions about the document below, using what it says (general knowledge only when clearly " +
                "marked as such). After each claim, cite where it comes from with the section and paragraph number in " +
                "square brackets exactly like [Methods ¶12] or [¶12]. If the document doesn't say, say so. Be concise and " +
                "clear: short paragraphs or simple numbered lines, no markdown symbols.\n\n" +
                "Document \"${doc.title}\" (paragraphs numbered):\n\n$source\n\n" +
                (if (convo.isNotEmpty()) "Earlier in this conversation:\n\n$convo\n\n" else "") +
                "Question: $question",
        )
        val arr = JSONArray()
        (past + Turn(question, answer)).forEach { arr.put(JSONObject().put("q", it.question).put("a", it.answer)) }
        chatFile(context, doc).writeText(arr.toString())
        return answer
    }

    /**
     * The document with every paragraph numbered and labeled with its section. When it
     * is too long, the paragraphs most related to [query] are kept (plus the start and end).
     */
    internal fun numbered(doc: Doc, query: String, limit: Int): String {
        val lines = doc.paragraphs.mapIndexed { i, p ->
            val sec = doc.chapterAt(i)?.title?.take(40)
            "[${if (sec != null) "$sec " else ""}¶${i + 1}] $p"
        }
        if (lines.sumOf { it.length + 2 } <= limit) return lines.joinToString("\n\n")
        val words = query.lowercase().split(Regex("""\W+""")).filter { it.length > 3 }.toSet()
        val score = lines.mapIndexed { i, l ->
            val lw = l.lowercase()
            val hits = words.count { it in lw }
            val edge = if (i < 15 || i > lines.size - 10) 2 else 0
            i to (hits * 3 + edge)
        }.sortedByDescending { it.second }
        val keep = HashSet<Int>()
        var size = 0
        for ((i, _) in score) {
            if (size + lines[i].length > limit) continue
            keep += i
            size += lines[i].length + 2
        }
        return lines.filterIndexed { i, _ -> i in keep }.joinToString("\n\n")
    }

    // ---- Study mode ----

    enum class Study(val label: String) {
        KEY_POINTS("10 key points"), FLASHCARDS("Flashcards"), QUIZ("Test me (quiz)"), VIVA("Viva questions"),
        SHORT("Short-answer questions"), REVISION("Revision summary"), MINDMAP("Mind map"), GLOSSARY("Glossary"),
    }

    /** Study material for [doc]; flashcards, quiz, mind map and glossary come back as JSON. */
    fun study(context: Context, doc: Doc, kind: Study, progress: (String) -> Unit): String {
        val text = doc.paragraphs.joinToString("\n\n")
        val file = cacheFile(context, "study", kind.name, doc.title, text.length.toString(), text.hashCode().toString())
        return cached(file) {
            val source = condensed(context, doc, progress)
            progress("Preparing ${kind.label.lowercase()}…")
            val ask = when (kind) {
                Study.KEY_POINTS -> "List the 10 most important points or findings, numbered 1 to 10, one or two sentences each, with key numbers."
                Study.REVISION -> "Write a revision summary (about 400 to 600 words) to review before an exam: main ideas, key facts " +
                    "and numbers, and what to remember, as short paragraphs."
                Study.VIVA -> "Write 10 viva (oral exam) questions an examiner might ask about this, each followed by a model " +
                    "answer of two to four sentences. Format each as \"Q: …\" on one line and \"A: …\" on the next."
                Study.SHORT -> "Write 10 short-answer exam questions with brief model answers. Format each as \"Q: …\" and \"A: …\"."
                Study.FLASHCARDS -> "Make 20 flashcards for spaced repetition. Return only JSON: {\"cards\":[{\"front\":\"question or term\"," +
                    "\"back\":\"answer, one or two sentences\"}]}"
                Study.QUIZ -> "Make 10 multiple-choice questions testing understanding (not trivia). Return only JSON: " +
                    "{\"questions\":[{\"question\":\"…\",\"options\":[\"…\",\"…\",\"…\",\"…\"],\"answer\":0,\"explanation\":\"why\"}]} " +
                    "where answer is the index of the correct option."
                Study.MINDMAP -> "Make a mind map of the main ideas. Return only JSON: {\"topic\":\"…\",\"children\":[{\"topic\":\"…\"," +
                    "\"children\":[…]}]}, at most three levels deep, short phrases."
                Study.GLOSSARY -> "Make a glossary of the technical terms, abbreviations and names a learner needs. Return only JSON: " +
                    "{\"terms\":[{\"term\":\"…\",\"definition\":\"one or two sentences\"}]}, in alphabetical order."
            }
            val json = kind in setOf(Study.FLASHCARDS, Study.QUIZ, Study.MINDMAP, Study.GLOSSARY)
            Llm.generate(
                context,
                "Based on \"${doc.title}\":\n\n$source\n\n$ask",
                system = if (json) null else "Write plain text, no markdown symbols (no asterisks or #).",
                json = json,
            ).let { if (json) cleanJson(it) else it }
        }
    }

    internal fun cleanJson(t: String) = t.trim().removePrefix("```json").removePrefix("```").removeSuffix("```").trim()

    // ---- Podcast ----

    /**
     * A two-person conversation about the document (a host and an expert), about
     * [minutes] long, as lines "Host: …" / "Expert: …" for two-voice playback.
     */
    fun podcast(context: Context, doc: Doc, item: Library.Item?, minutes: Int, progress: (String) -> Unit): String {
        val text = doc.paragraphs.joinToString("\n\n")
        val file = cacheFile(context, "podcast", minutes.toString(), doc.title, text.length.toString(), text.hashCode().toString())
        return cached(file) {
            val source = condensed(context, doc, progress)
            progress("Writing the podcast…")
            val script = Llm.generate(
                context,
                "Write a lively, natural two-person podcast conversation of about ${minutes * 150} words about the " +
                    "${kindOf(doc, item)} \"${doc.title}\". Speakers: Host (curious, asks what listeners would ask, " +
                    "keeps it moving) and Expert (knows the material well, explains clearly with examples). Cover what " +
                    "was found, why it matters, how it was done, the limitations and real-world implications. Keep it " +
                    "accurate to the text and use the key numbers. Natural spoken language with short turns and occasional " +
                    "reactions, no stage directions. Return only JSON: {\"lines\":[{\"speaker\":\"Host\",\"text\":\"…\"}]}" +
                    "\n\nText:\n\n$source",
                json = true,
            )
            val lines = JSONObject(cleanJson(script)).getJSONArray("lines")
            (0 until lines.length()).map { lines.getJSONObject(it) }
                .joinToString("\n\n") { "${it.optString("speaker").ifBlank { "Host" }}: ${it.optString("text").trim()}" }
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
            val title = Llm.generate(context, "Translate this title into $language. Reply with the translation only:\n\n${doc.title}").lines().first().trim()
            val body = chunks.mapIndexed { i, c ->
                progress(if (chunks.size > 1) "Translating part ${i + 1} of ${chunks.size}…" else "Translating…")
                Llm.generate(
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

    /**
     * Asks the AI to look at the PDF's figures, tables and key equations and saves the
     * explanations. Gemini reads the PDF itself; Grok gets the pages with figures as images.
     */
    fun explainVisuals(context: Context, item: Library.Item, doc: Doc): Int {
        val pdf = Library.source(context, item).file
        val grok = Llm.provider(context) == Llm.GROK
        if (!grok && pdf.length() > 18_000_000) throw Gemini.GeminiException("This PDF is too large for free Gemini (the limit is about 18 MB).")
        val prompt = "Look at every figure, table and important numbered equation in this PDF. For each one, write an explanation " +
            "to be read aloud to someone listening to the paper who cannot see it: what it shows, how to read it, " +
            "and the main takeaway, with the key numbers or trends. For tables, summarize the important numbers " +
            "rather than reading every cell. About 60 to 150 words each. Say math in words.\n\nReturn only JSON: " +
            "{\"items\":[{\"label\": exactly as printed, like \"Figure 3\", \"Table 2\" or \"Equation 4\" (for unnumbered ones a " +
            "short name), \"kind\": \"figure\", \"table\" or \"equation\", \"explanation\": plain prose, no markdown}]}, in the order they appear."
        val answer = if (grok) {
            // Pages with captions (up to 8), else the first pages.
            val pages = doc.figures.map { it.page }.distinct().take(8).ifEmpty { (1..minOf(8, doc.pages.coerceAtLeast(1))).toList() }
            val images = pages.map { page ->
                val bmp = FigureViewer.renderPage(pdf, page, 1300)
                java.io.ByteArrayOutputStream().also { bmp.compress(android.graphics.Bitmap.CompressFormat.JPEG, 82, it); bmp.recycle() }.toByteArray()
            }
            Grok.generate(context, prompt.replace("in this PDF", "on these pages of a PDF"), images = images, json = true)
        } else {
            Gemini.generate(context, prompt, attachment = "application/pdf" to pdf.readBytes(), json = true)
        }
        val visuals = parseVisuals(answer)
        if (visuals.isEmpty()) throw java.io.IOException("${Llm.name(context)} found no figures or tables in this document.")
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
        return Doc(doc.title, paragraphs, chapters, doc.key, doc.author, doc.cover, doc.pages, doc.figures).also { it.lang = doc.lang }
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
