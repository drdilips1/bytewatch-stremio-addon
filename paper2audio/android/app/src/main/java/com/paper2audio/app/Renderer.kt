package com.paper2audio.app

import android.content.Context
import android.os.Handler
import android.os.Looper
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.Executors
import kotlin.math.roundToInt

/**
 * How a document is voiced: the main voice, an optional second voice for quoted
 * dialogue (stories), the document's language (Supertonic) and a pitch shift in Hz
 * (online voices).
 */
data class Voicing(
    val voiceId: String,
    val dialogue: String? = null,
    val lang: String? = null,
    val pitch: Int = 0,
    /** Read dosing and clinical abbreviations in full (see [Speech]). */
    val medical: Boolean = false,
) {
    /** Identifies the audio this voicing produces, for the cache. */
    val key: String
        get() = listOf(
            voiceId,
            dialogue.orEmpty(),
            if (voiceId.startsWith(Speaker.SUPER) || dialogue?.startsWith(Speaker.SUPER) == true) lang.orEmpty() else "",
            if (pitch != 0 && voiceId.startsWith(Speaker.EDGE)) pitch.toString() else "",
            "s${Speech.VERSION}" + if (medical) "m" else "",
        ).joinToString("|")
}

/**
 * Turns text pieces into audio files for the natural voices (Microsoft and the
 * on-device engines) and keeps them in a disk cache, so replaying, resuming and
 * offline listening don't need to render anything again.
 */
object Renderer {
    private const val EDGE_MAX_SPEED = 3.0f
    private const val CACHE_LIMIT = 2_000_000_000L

    /** The on-device engines run one generation at a time; keep their work on one thread. */
    val localThread = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
    /** The spare voice engine's own thread (saving audiobooks). */
    private val spareThread = Executors.newSingleThreadExecutor().asCoroutineDispatcher()

    fun isStreamed(voiceId: String) = voiceId.startsWith(Speaker.EDGE) || LocalTts.isLocal(voiceId)

    private fun maxSpeed(voiceId: String) = if (LocalTts.isLocal(voiceId)) LocalTts.maxSpeed(voiceId) else EDGE_MAX_SPEED

    /** The speed the voice engine renders at; any extra is applied by the player. */
    fun engineSpeed(voiceId: String, speed: Float) = if (isStreamed(voiceId)) minOf(speed, maxSpeed(voiceId)) else speed

    fun engineSpeed(v: Voicing, speed: Float): Float {
        // Copied voices always speak at the recorded pace; the player slows or speeds them (pitch kept).
        if (v.voiceId.startsWith(Speaker.CLONE)) return 1f
        val max = listOfNotNull(v.voiceId, v.dialogue).filter { isStreamed(it) }.minOfOrNull { maxSpeed(it) } ?: return speed
        return minOf(speed, max)
    }

    fun playbackBoost(v: Voicing, speed: Float): Float {
        val boost = speed / engineSpeed(v, speed)
        // Supertonic is slowed mostly by the player (see LocalTts.SUPERTONIC_PACE).
        return when {
            v.voiceId.startsWith(Speaker.SUPER) -> boost * LocalTts.SUPERTONIC_PLAYBACK
            // Copied voices speak at their speaker's pace: evened out to a normal reading pace.
            v.voiceId.startsWith(Speaker.CLONE) -> boost * MyVoices.paceFactor(v.voiceId.removePrefix(Speaker.CLONE))
            else -> boost
        }
    }

    /**
     * Playback pieces for one paragraph: about one sentence each (very short ones
     * joined), so playback starts fast and can step back a sentence at a time.
     */
    fun pieces(paragraph: String, voiceId: String): List<String> =
        // On-device voices: one sentence per piece (only very short ones joined), so every sentence
        // gets the same pause whatever the text, and the first sound comes sooner.
        // Long sentences stay whole up to 320 characters: every cut sounds like a sentence ending.
        // Copied voices lose their way in long sentences (skipped words, run-ons): shorter parts.
        // Very short sentences on their own go wrong too ("Stop!" said twice): they join their neighbours.
        // A one-word sentence ("Why?") read alone came out in an odd tone: it always joins the next one.
        if (voiceId.startsWith(Speaker.CLONE)) TextCleaner.pieces(paragraph, 60, hardMax = 160, minLength = 20)
        else if (LocalTts.isLocal(voiceId)) TextCleaner.pieces(paragraph, 14, hardMax = 320, minLength = 20)
        else TextCleaner.pieces(paragraph, 50, hardMax = 900)

    /**
     * The first sentence after pressing Play, in one or two parts: a long sentence is split at a
     * comma or semicolon, so the first words are heard after rendering only the first half.
     */
    fun quickStart(text: String, voiceId: String): List<String> {
        // Each half ends on a falling, "finished" tone, as if the sentence ended at the comma: the online
        // voices are quick enough to make the sentence whole; on-device ones split only very long ones.
        if (!LocalTts.isLocal(voiceId)) return listOf(text)
        val limit = 200
        if (text.length <= limit) return listOf(text)
        val cut = Regex("""[,;:\u2014]\s""").findAll(text)
            .map { it.range.first + 1 }
            .filter { it in 30..(text.length - 25) }
            .minByOrNull { kotlin.math.abs(it - limit * 2 / 3) } ?: return listOf(text)
        return listOf(text.substring(0, cut).trim(), text.substring(cut).trim())
    }

    private fun dir(context: Context) = File(context.filesDir, "audiocache").apply { mkdirs() }

    fun file(context: Context, v: Voicing, speed: Float, text: String): File {
        val es = (engineSpeed(v, speed) * 100).roundToInt()
        // Supertonic's pace changed (calmer): don't reuse audio made at the old pace.
        val pace = when {
            // Engine settings changed (pace, natural pauses, one seed per voice): don't reuse older audio.
            v.voiceId.startsWith(Speaker.SUPER) -> "p5|"
            // A ready-made voice given a steadier seed: its older takes are remade.
            v.voiceId.startsWith(Speaker.CLONE) -> "c6|" + (MyVoices.seedOf(v.voiceId.removePrefix(Speaker.CLONE)).takeIf { it > 0 }?.let { "s$it|" } ?: "") +
                (if (MyVoices.leadInOf(v.voiceId.removePrefix(Speaker.CLONE))) "" else "nl|")
            v.voiceId.startsWith(Speaker.KOKORO) -> "s1|"
            else -> ""
        }
        val digest = MessageDigest.getInstance("SHA-1").digest(
            // On-device audio is keyed on the text as spoken (pronunciations included), so a new pronunciation
            // remakes only the sentences with that word; online audio on the written text plus the list's stamp.
            if (LocalTts.isLocal(v.voiceId)) "${v.key}|$es|$pace${plainQuotes(Speech.normalize(text, v.medical))}".toByteArray()
            else "${v.key}|$es|$pace${Pronounce.stamp.let { if (it.isEmpty()) "" else "$it|" }}$text".toByteArray()
        )
        val ext = if (LocalTts.isLocal(v.voiceId)) "wav" else "mp3"
        return File(dir(context), digest.joinToString("") { "%02x".format(it) } + "." + ext)
    }

    /**
     * Text as the on-device voices read it best: plain apostrophes (they read won’t as "won t"),
     * and no brackets or quote marks, which aren't spoken and, at the end of a sentence
     * ("…anywhere.)"), hide the full stop so the voice runs on mumbling.
     */
    internal fun plainQuotes(t: String) = speakable(t).replace('\u2019', '\'').replace('\u2018', '\'').replace('\u02BC', '\'')
        .replace(Regex("""[\u201C\u201D"«»()\[\]{}]"""), " ")
        // Single quote marks around dialogue (‘Not today.’, common in British and Indian editions) hide
        // the full stop just like double ones: an apostrophe stays only between two letters (don't, it's).
        .replace(Regex("""(?<![\p{L}])'|'(?![\p{L}])"""), " ")
        // Dotted initials ("U.S.", "U.K.") lose their dots: on-device voices took the dot after "U" for the
        // end of the sentence, said "U" and stopped.
        .replace(Regex("""\b(?:\p{Lu}\.){2,}""")) { it.value.replace(".", "") }
        // Titles and other abbreviations inside a sentence ("Mr. Dursley", "e.g. this") said in full: the dot
        // read as the end of the sentence, so the copied voices said "Mister" and stopped there.
        .let(::spellAbbreviations)
        .replace(Regex("""\s+([,.;:!?…])"""), "$1")
        .replace(Regex("""\s{2,}"""), " ")
        .trim()
        // An ellipsis doesn't sound finished to them either ("…and then she…" ran on mumbling):
        // at the end it becomes a full stop, inside a sentence a comma (still a short pause).
        .replace(Regex("""(?:…|\.{2,})(?=\s*$)"""), ".")
        .replace(Regex("""(?:…|\.{2,})\s*"""), ", ")
        .replace(Regex(""",\s*([,.;:!?])"""), "$1")
        .replace(Regex("""^,\s*"""), "")
        .trim()
        .let(::unstutter)

    // ---- Book text as the on-device voices can say it ----

    private val UNITS_WORDS = listOf("zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
        "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen")
    private val TENS_WORDS = listOf("", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety")

    internal fun cardinal(n: Int): String = when {
        n < 20 -> UNITS_WORDS[n]
        n < 100 -> TENS_WORDS[n / 10] + if (n % 10 > 0) "-" + UNITS_WORDS[n % 10] else ""
        n < 1000 -> UNITS_WORDS[n / 100] + " hundred" + if (n % 100 > 0) " " + cardinal(n % 100) else ""
        else -> n.toString()
    }

    internal fun ordinal(n: Int): String {
        val c = cardinal(n)
        val irregular = mapOf("one" to "first", "two" to "second", "three" to "third", "five" to "fifth", "eight" to "eighth",
            "nine" to "ninth", "twelve" to "twelfth")
        val last = c.substringAfterLast('-').substringAfterLast(' ')
        val head = c.dropLast(last.length)
        return head + (irregular[last] ?: if (last.endsWith("y")) last.dropLast(1) + "ieth" else last + "th")
    }

    private val ROMAN = Regex("""^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$""")
    internal fun roman(s: String): Int? {
        if (s.isEmpty() || !ROMAN.matches(s)) return null
        val v = mapOf('I' to 1, 'V' to 5, 'X' to 10, 'L' to 50, 'C' to 100, 'D' to 500, 'M' to 1000)
        var total = 0
        for (i in s.indices) {
            val x = v.getValue(s[i])
            total += if (i + 1 < s.length && x < v.getValue(s[i + 1])) -x else x
        }
        return total.takeIf { it in 1..3999 }
    }

    /** "Chapter IV", "Part II", "World War I": a number said as a number. */
    private val ROMAN_AFTER_WORD = Regex(
        """\b(Chapter|Part|Book|Act|Scene|Section|Volume|Vol|Appendix|Lesson|Unit|Phase|Stage|Article|Canto|Psalm|Class|Type|Level|Episode|Round|War|Lecture|Letter|Stave|Epilogue|Prologue)\s+([IVXLCDM]+)\b(?!['’])""",
        RegexOption.IGNORE_CASE,
    )
    /** "Henry VIII", "Elizabeth II", "John Paul II": a ruler's number, said "the eighth". */
    private val ROMAN_AFTER_NAME = Regex("""\b(\p{Lu}\p{Ll}+)\s+([IVXLC]{2,})\b(?!['’])""")
    private val RULERS = "Henry|Edward|Elizabeth|Charles|James|George|William|Richard|Louis|Peter|Catherine|Mary|Victoria|" +
        "Philip|Frederick|Napoleon|John|Paul|Pius|Leo|Gregory|Alexander|Nicholas|Ivan|Ferdinand|Francis|Innocent|Clement|Benedict|" +
        "Urban|Boniface|Ramesses|Ptolemy|Darius|Cyrus|Otto|Rudolf|Wilhelm|Friedrich|Constantine|Justinian|Selim|Mehmed|Suleiman"
    /** "Henry I", "Napoleon I": only after a ruler's name, since "I" is mostly just "I". */
    private val ROMAN_ONE_AFTER_RULER = Regex("""\b($RULERS)\s+([IVX])\b(?!['’]|\s+(?:am|was|have|had|will|would|could|should|can|do|did|think|know|said|went|saw|felt|thought|love|like|want|need)\b)""")

    private val CURRENCY = Regex("""([$£€₹])\s?(\d[\d,]*(?:\.\d+)?)(\s+(?:thousand|million|billion|trillion))?""")
    private val FRACTION = Regex("""(?<![\d/.])\b([1-9])/([2-9]|10)\b(?![\d/])""")
    private val URL = Regex("""\b(?:https?://)?(?:[A-Za-z0-9-]+\.)+(?:com|org|net|edu|gov|io|co|uk|in|de|fr|info|ai|app|dev|me|us|eu)\b(?:/[^\s,;)]*)?""")
    private val EMAIL = Regex("""\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b""")

    /**
     * Book text as the on-device voices can say it: a dot inside a sentence (a.m., web addresses) reads as
     * its end and the voice stops there; brackets and dashes vanish into run-on sentences; Roman numerals,
     * money, fractions and footnote marks come out as letters and symbols. The screen keeps the original.
     */
    internal fun speakable(input: String): String {
        // Ebooks keep "Mrs. Bennet" on one line with a non-breaking (or thin) space after the title; the rules
        // below look for ordinary spaces, so "Mrs." went through untouched and the voice stopped at its dot.
        var t = input.replace(Regex("""[  -   ]"""), " ")
            .replace(Regex("""\b(Mr|Mrs|Ms|Dr|St)\.(?=\p{Lu})"""), "$1. ")
        // A line of only symbols ("* * *", a scene break) has nothing to say.
        if (t.none { it.isLetterOrDigit() }) return ""
        // "Shhh!" has no vowel: the copied voices left it out or garbled it; "Shush" they say.
        t = t.replace(Regex("""\b[Ss]+[Hh]+\b""")) { if (it.value.first().isUpperCase()) "Shush" else "shush" }
        t = t.replace(EMAIL) { it.value.replace("@", " at ").replace(".", " dot ") }
        t = t.replace(URL) { m ->
            m.value.removePrefix("https://").removePrefix("http://").trimEnd('/').replace(".", " dot ").replace("/", " slash ")
        }
        // Numbered citations ("[1]", "[2, 3]", "[4–6]") and footnote marks glued to a word ("loved it.2").
        t = t.replace(Regex("""\s?\[\d+(?:\s*[,–-]\s*\d+)*]"""), "")
        t = t.replace(Regex("""(?<=\p{Ll}[.!?,;:])\d{1,3}(?=\s|$)"""), "")
        t = t.replace(ROMAN_AFTER_WORD) { m -> roman(m.groupValues[2].uppercase())?.let { "${m.groupValues[1]} ${cardinal(it)}" } ?: m.value }
        // Lowercase list numbers: "item ii", "(iii)".
        t = t.replace(Regex("""\b(item|point|step|stage|part|clause|paragraph|note|case|option|section|chapter|appendix)\s+([ivx]{1,4})\b""", RegexOption.IGNORE_CASE)) { m ->
            roman(m.groupValues[2].uppercase())?.takeIf { m.groupValues[2].all { it.isLowerCase() } }?.let { "${m.groupValues[1]} ${cardinal(it)}" } ?: m.value
        }
        t = t.replace(Regex("""\(([ivx]{1,4})\)""")) { m -> roman(m.groupValues[1].uppercase())?.let { "${cardinal(it)}," } ?: m.value }
        t = t.replace(ROMAN_AFTER_NAME) { m -> roman(m.groupValues[2])?.let { "${m.groupValues[1]} the ${ordinal(it)}" } ?: m.value }
        t = t.replace(ROMAN_ONE_AFTER_RULER) { m -> roman(m.groupValues[2])?.let { "${m.groupValues[1]} the ${ordinal(it)}" } ?: m.value }
        t = t.replace(Regex("""\b([aApP])\.\s?[mM]\.""")) { "${it.groupValues[1].uppercase()} M" }
        t = t.replace(CURRENCY) { m ->
            val unit = when (m.groupValues[1]) { "$" -> "dollars"; "£" -> "pounds"; "€" -> "euros"; else -> "rupees" }
            "${m.groupValues[2]}${m.groupValues[3]} $unit"
        }
        t = t.replace(FRACTION) { m ->
            val n = m.groupValues[1].toInt()
            val d = m.groupValues[2].toInt()
            val denom = if (d == 2) "half" else if (d == 4) "quarter" else ordinal(d)
            "${cardinal(n)} " + if (n == 1) denom else if (d == 2) "halves" else denom + "s"
        }
        t = t.replace(Regex("""#(?=\d)"""), "number ")
        // "file_name" → "file name"; *emphasis* and _emphasis_ marks go.
        t = t.replace(Regex("""(?<=\w)_(?=\w)"""), " ").replace(Regex("""[*_~^|\\]+"""), " ")
        // Brackets become a short pause on both sides: "(see Table 2)" is an aside, not run into the sentence.
        // A sentence ending inside the bracket ("…98 percent are.)") ends there, with no pause after it.
        t = t.replace(Regex("""([.!?\u2026])\s*[)\]}]+"""), "$1")
        t = t.replace(Regex("""\s*[(\[{]\s*"""), ", ").replace(Regex("""\s*[)\]}]"""), ",")
        // Dashes: a break mid-sentence is a pause; one at the very end ("I was going to—") ends it.
        t = t.replace(Regex("""\s*(?:[—―]|--+|\s–\s)\s*(?=$|[”"’']\s*(?:$|[“"‘']))"""), ".")
        t = t.replace(Regex("""\s*(?:[—―]|--+|\s–\s)\s*"""), ", ")
        return t
    }

    private val ABBREVIATIONS = mapOf(
        "mr" to "Mister", "mrs" to "Missus", "ms" to "Miz", "dr" to "Doctor", "prof" to "Professor",
        "jr" to "Junior", "sr" to "Senior", "mt" to "Mount", "vs" to "versus", "approx" to "approximately",
        "cf" to "compare", "etc" to "et cetera", "no" to "number", "nos" to "numbers", "fig" to "figure",
        "figs" to "figures", "eq" to "equation", "eqs" to "equations", "vol" to "volume", "ch" to "chapter",
        "dept" to "department", "univ" to "university", "inc" to "Inc", "ltd" to "Ltd",
        "co" to "Co", "al" to "al", "jan" to "January", "feb" to "February", "mar" to "March",
        "apr" to "April", "jun" to "June", "jul" to "July", "aug" to "August", "sep" to "September",
        "sept" to "September", "oct" to "October", "nov" to "November", "dec" to "December",
    )
    private val ABBREVIATION = Regex("""\b(""" + ABBREVIATIONS.keys.joinToString("|") + """|st)\.(?=\s+(\S))""", RegexOption.IGNORE_CASE)
    private val E_G = Regex("""\b(e\.g|i\.e)\.(?=\s+\S)""", RegexOption.IGNORE_CASE)

    /** British style, no full stop: "Mrs Bennet", "Mr Darcy", "Dr Jones", "St Paul's" (before a name only). */
    private val TITLE_NO_DOT = Regex("""\b(Mr|Mrs|Ms|Dr|Prof|St)\b(?=\s+\p{Lu})""")

    /** "Mr. Dursley" → "Mister Dursley", "St. Paul" → "Saint Paul", "e.g. this" → "for example this" (inside a sentence only). */
    internal fun spellAbbreviations(input: String): String {
        val t = TITLE_NO_DOT.replace(input) { m ->
            if (m.groupValues[1] == "St") "Saint" else ABBREVIATIONS.getValue(m.groupValues[1].lowercase())
        }
        return spellDotted(t)
    }

    private fun spellDotted(t: String): String =
        ABBREVIATION.replace(E_G.replace(t) { if (it.groupValues[1].lowercase() == "e.g") "for example," else "that is," }) { m ->
            val word = m.groupValues[1]
            val next = m.groupValues[2]
            val key = word.lowercase()
            when {
                // "No. 5" is a number; "no. They" is the word "no" ending a sentence.
                (key == "no" || key == "nos") && !next[0].isDigit() -> m.value
                // Months only before a day or year ("Jan. 5"), so "mar." or "dec." elsewhere stay as written.
                key in setOf("jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec") && !next[0].isDigit() -> m.value
                key == "st" -> if (next[0].isUpperCase()) "Saint" else "Street"
                else -> ABBREVIATIONS.getValue(key)
            }
        }

    /** "t-t-to" → "to", "sp-spoils" → "spoils": written stutters trip the on-device voices up. */
    private val STUTTER = Regex("""(?i)\b([a-z]{1,3})-(?=\1)""")
    internal fun unstutter(t: String): String {
        var s = t
        while (true) {
            val next = STUTTER.replace(s, "")
            if (next == s) return s
            s = next
        }
    }

    fun isCached(context: Context, v: Voicing, speed: Float, text: String) = file(context, v, speed, text).length() > 0

    /** A render in progress and how many callers wait for it. */
    private class Flight(val job: Deferred<File>) {
        var waiters = 0
    }

    /** Renders running now, by target file: a second request for the same audio waits for the first. */
    private val inFlight = HashMap<String, Flight>()
    private val work = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** Returns the audio for [text], rendering it if it isn't cached yet. */
    suspend fun render(context: Context, v: Voicing, speed: Float, text: String, spare: Boolean = false): File {
        val target = file(context, v, speed, text)
        if (target.length() > 0) {
            target.setLastModified(System.currentTimeMillis())
            return target
        }
        val key = target.path
        val flight = synchronized(inFlight) {
            inFlight.getOrPut(key) {
                val d = work.async(start = kotlinx.coroutines.CoroutineStart.LAZY) { renderNow(context, v, speed, text, target, spare) }
                Flight(d).also { f -> d.invokeOnCompletion { synchronized(inFlight) { if (inFlight[key] === f) inFlight.remove(key) } } }
            }.also { it.waiters++ }
        }
        flight.job.start()
        try {
            return flight.job.await()
        } finally {
            // Nobody needs it any more (e.g. after a seek): don't keep the voice engine busy with it.
            // A short grace lets Play pick up what the warm-up started.
            val last = synchronized(inFlight) { --flight.waiters == 0 }
            if (last && !flight.job.isCompleted) work.launch {
                kotlinx.coroutines.delay(500)
                if (synchronized(inFlight) { flight.waiters == 0 }) flight.job.cancel()
            }
        }
    }

    private suspend fun renderNow(context: Context, v: Voicing, speed: Float, text: String, target: File, spare: Boolean = false): File {
        if (target.length() > 0) return target
        val segments = v.dialogue?.let { Stories.split(text) }
        if (segments != null && segments.size > 1) {
            // Narration and dialogue in their own voices, joined into one file.
            val parts = segments.map { (quoted, part) ->
                render(context, v.copy(voiceId = if (quoted) v.dialogue else v.voiceId, dialogue = null), engineSpeed(v, speed), part, spare)
            }
            withContext(Dispatchers.IO) { join(parts, target, local = LocalTts.isLocal(v.voiceId)) }
            return target
        }
        val voice = if (segments?.singleOrNull()?.first == true) v.dialogue!! else v.voiceId
        val tmp = File(target.path + ".part" + System.nanoTime())
        // What the voice is given: numbers, units, symbols and abbreviations spelled out.
        val normalized = Speech.normalize(text, v.medical).ifBlank { text }
        // Books use curly apostrophes (won’t); the on-device voices only know the plain one and
        // read "won t". Plain quotes and apostrophes for them.
        // Online voices ended the sentence at "U.S." too ("the U.S. Public Health Service"): inside a
        // sentence initials lose their last dot ("U.S Public"), still read letter by letter.
        val spoken = if (LocalTts.isLocal(voice)) plainQuotes(normalized)
            // and paused after "Mr." as if it ended one: without its dot ("Mr Dursley") it reads right.
            else normalized.replace(Regex("""\b(Mr|Mrs|Ms|Dr|Prof|St)\.[\s\u00A0\u202F]+(?=\p{Lu})"""), "$1 ")
                .replace(Regex("""\b((?:\p{Lu}\.){1,}\p{Lu})\.(?=\s+[\p{L}\d])"""), "$1")
        try {
            val es = engineSpeed(v, speed)
            if (LocalTts.isLocal(voice) && spoken.none { it.isLetterOrDigit() }) {
                // Nothing to say ("* * *", a scene break): a short silence in its place.
                LocalTts.writeWav(tmp, LocalTts.Pcm(ByteArray(24_000 * 2 * 3 / 10), 24_000))
            } else if (LocalTts.isLocal(voice)) {
                withContext(if (spare && LocalTts.hasSpare) spareThread else localThread) {
                    val t0 = System.nanoTime()
                    val pcm = LocalTts.synthesize(voice, spoken, es, v.lang, useSpare = spare)
                    RenderSpeed.record(context, voice, (System.nanoTime() - t0) / 1e9, pcm.bytes.size / 2.0 / pcm.sampleRate)
                    LocalTts.writeWav(tmp, pcm)
                }
            } else {
                val rate = ((es - 1f) * 100).roundToInt().coerceIn(-50, 200)
                // "edge:Name@-20": the voice with its own pitch shift (children's voices in full cast).
                val name = voice.removePrefix(Speaker.EDGE).substringBefore('@')
                val shift = voice.substringAfter('@', "0").toIntOrNull() ?: 0
                tmp.writeBytes(hedged(spoken.length) { EdgeTts.synthesize(spoken, name, rate, v.pitch + shift) })
            }
            if (!tmp.renameTo(target)) error("Couldn't save audio")
        } finally {
            tmp.delete()
        }
        return target
    }

    /**
     * Runs [request] (a blocking network call); if it hasn't answered within a few
     * seconds, sends the same request again and takes whichever answers first. A
     * stuck connection then costs a few seconds instead of a long silence.
     */
    private suspend fun hedged(chars: Int, request: () -> ByteArray): ByteArray = coroutineScope {
        val waitMs = 3_500L + chars * 15L
        val first = async(Dispatchers.IO) { runCatching(request) }
        val early = kotlinx.coroutines.withTimeoutOrNull(waitMs) { first.await() }
        if (early != null && early.isSuccess) return@coroutineScope early.getOrThrow()
        val second = async(Dispatchers.IO) { runCatching(request) }
        if (early != null) return@coroutineScope second.await().getOrThrow() // the first failed fast
        // Whichever succeeds first; an error only if both fail.
        val winner = kotlinx.coroutines.selects.select<Result<ByteArray>> {
            first.onAwait { it }
            second.onAwait { it }
        }
        if (winner.isSuccess) {
            first.cancel()
            second.cancel()
            return@coroutineScope winner.getOrThrow()
        }
        val other = if (first.isCompleted) second.await() else first.await()
        other.getOrThrow()
    }

    /** Joins MP3 pieces (frames simply follow each other) or WAV pieces (same format). */
    private fun join(parts: List<File>, target: File, local: Boolean) {
        val tmp = File(target.path + ".part" + System.nanoTime())
        try {
            if (!local) {
                tmp.outputStream().use { out -> parts.forEach { f -> f.inputStream().use { it.copyTo(out) } } }
            } else {
                val pcms = parts.map { LocalTts.readWav(it) }
                val rate = pcms.first().sampleRate
                val bytes = java.io.ByteArrayOutputStream()
                for (p in pcms) {
                    if (p.sampleRate == rate) bytes.write(p.bytes) else bytes.write(resample16(p, rate))
                }
                LocalTts.writeWav(tmp, LocalTts.Pcm(bytes.toByteArray(), rate))
            }
            if (!tmp.renameTo(target)) error("Couldn't save audio")
        } finally {
            tmp.delete()
        }
    }

    private fun resample16(p: LocalTts.Pcm, rate: Int): ByteArray {
        val sb = java.nio.ByteBuffer.wrap(p.bytes).order(java.nio.ByteOrder.LITTLE_ENDIAN).asShortBuffer()
        val floats = FloatArray(sb.remaining()) { sb.get(it) / 32768f }
        val out = MyVoices.resample(floats, p.sampleRate, rate)
        val bytes = ByteArray(out.size * 2)
        out.forEachIndexed { i, f ->
            val s = (f.coerceIn(-1f, 1f) * 32767f).toInt()
            bytes[2 * i] = (s and 0xff).toByte()
            bytes[2 * i + 1] = ((s shr 8) and 0xff).toByte()
        }
        return bytes
    }

    /** Keeps the cache under its size limit by removing the least recently used audio. */
    fun trim(context: Context) {
        val files = dir(context).listFiles()?.filter { it.isFile } ?: return
        var total = files.sumOf { it.length() }
        if (total <= CACHE_LIMIT) return
        for (f in files.sortedBy { it.lastModified() }) {
            if (total <= CACHE_LIMIT * 8 / 10) break
            total -= f.length()
            f.delete()
        }
    }

    fun cacheBytes(context: Context): Long = dir(context).listFiles()?.sumOf { it.length() } ?: 0

    fun clearCache(context: Context) {
        dir(context).listFiles()?.forEach { it.delete() }
    }
}

/**
 * Two-voice stories: splits text into narration and quoted dialogue, using the
 * curly quotes [TextCleaner.smartQuotes] puts into every document.
 */
object Stories {
    private const val OPEN = '\u201C'
    private const val CLOSE = '\u201D'

    private const val OPEN1 = '\u2018'
    private const val CLOSE1 = '\u2019'

    /**
     * (isDialogue, text) segments in order; null when there's no dialogue at all. [single]: the book
     * puts dialogue in single quotes (‘…’); a ’ inside a word ("don’t") is an apostrophe, not a close.
     */
    fun split(text: String, single: Boolean = false): List<Pair<Boolean, String>>? =
        (if (single) splitSingle(text) else splitDouble(text))?.let(::keepScareQuotesInline)

    /**
     * A few words in quotes inside a sentence (Patients would be “directly observed” taking…) are a term or an
     * aside, not someone speaking: read as part of the sentence, not split off in another tone. Speech has its
     * own punctuation inside the quotes (“Yes,” said Harry / “Stop!”), so a short quote without any is a term.
     */
    private fun keepScareQuotesInline(parts: List<Pair<Boolean, String>>): List<Pair<Boolean, String>> {
        fun isTerm(t: String, afterWords: Boolean): Boolean {
            var inner = t.trim().trim(OPEN, CLOSE, OPEN1, CLOSE1, '"', '\'')
            // American style keeps the comma inside: known as “DOTS,” aimed… Right after ordinary words (not
            // after "said," or a full stop) that is still a term.
            if (afterWords) inner = inner.trimEnd(',', '.')
            return inner.isNotBlank() && inner.split(Regex("""\s+""")).size <= 5 && inner.none { it in ".,!?;:\u2026" }
        }
        val out = ArrayList<Pair<Boolean, String>>()
        for ((i, part) in parts.withIndex()) {
            val (quoted, t) = part
            // Only inside a sentence: words before it that don't end a sentence, or words after it carrying on.
            val before = out.lastOrNull()?.takeIf { !it.first }?.second?.trimEnd()
            val after = parts.getOrNull(i + 1)?.takeIf { !it.first }?.second
            val inside = (before?.lastOrNull()?.let { it !in ".!?:\u2026" } == true) || (after != null && TextCleaner.startsLower(after))
            val afterWords = before?.lastOrNull()?.isLetterOrDigit() == true
            // A quotation woven into the sentence (wrote that “the present widespread use…”) starts in lower case
            // right after words: it is still the narrator's sentence, however long.
            val woven = afterWords && t.trim().trimStart(OPEN, OPEN1, '"', '\'').firstOrNull()?.isLowerCase() == true
            val asNarration = !quoted || (isTerm(t, afterWords) && inside) || woven
            if (asNarration && out.isNotEmpty() && !out.last().first) out[out.lastIndex] = false to out.last().second + " " + t
            else out += asNarration.not() to t
        }
        return out
    }

    private fun splitDouble(text: String): List<Pair<Boolean, String>>? {
        if (OPEN !in text && CLOSE !in text) return null
        val out = ArrayList<Pair<Boolean, String>>()
        // A piece can start in the middle of a quotation: then its first quote mark closes.
        val firstOpen = text.indexOf(OPEN).let { if (it < 0) Int.MAX_VALUE else it }
        val firstClose = text.indexOf(CLOSE).let { if (it < 0) Int.MAX_VALUE else it }
        var inQuote = firstClose < firstOpen
        val sb = StringBuilder()
        fun flush() {
            val t = sb.toString().trim()
            sb.setLength(0)
            if (t.isEmpty()) return
            if (t.none { it.isLetterOrDigit() } && out.isNotEmpty()) {
                // Lone punctuation (", she said." leftovers) stays with the previous part.
                out[out.lastIndex] = out.last().first to out.last().second + t
                return
            }
            if (out.isNotEmpty() && out.last().first == inQuote) out[out.lastIndex] = inQuote to out.last().second + " " + t
            else out += inQuote to t
        }
        for (c in text) {
            when (c) {
                OPEN -> {
                    flush()
                    inQuote = true
                    sb.append(c)
                }
                CLOSE -> {
                    sb.append(c)
                    flush()
                    inQuote = false
                }
                else -> sb.append(c)
            }
        }
        flush()
        return out
    }

    private fun splitSingle(text: String): List<Pair<Boolean, String>>? {
        if (OPEN1 !in text) return null
        val out = ArrayList<Pair<Boolean, String>>()
        var inQuote = false
        val sb = StringBuilder()
        fun flush() {
            val t = sb.toString().trim()
            sb.setLength(0)
            if (t.isEmpty()) return
            if (t.none { it.isLetterOrDigit() } && out.isNotEmpty()) {
                out[out.lastIndex] = out.last().first to out.last().second + t
                return
            }
            if (out.isNotEmpty() && out.last().first == inQuote) out[out.lastIndex] = inQuote to out.last().second + " " + t
            else out += inQuote to t
        }
        for ((i, c) in text.withIndex()) {
            when {
                // Opens at the start of a word: ‘Come in,’ … not ‘90s inside a sentence after a letter.
                c == OPEN1 && !inQuote && (i == 0 || !text[i - 1].isLetterOrDigit()) -> {
                    flush()
                    inQuote = true
                    sb.append(c)
                }
                // Closes when no letter follows (don’t, it’s: letters follow, so those are apostrophes).
                c == CLOSE1 && inQuote && (i + 1 == text.length || !text[i + 1].isLetter()) -> {
                    sb.append(c)
                    flush()
                    inQuote = false
                }
                else -> sb.append(c)
            }
        }
        flush()
        return out.takeIf { it.any { p -> p.first } }
    }
}

/** "Download for offline": renders a whole document into the audio cache ahead of time. */
object OfflineDownloader {
    var running = false
        private set
    var docKey: String? = null
        private set
    var progress = 0
        private set
    var message: String? = null
        private set

    private val main = Handler(Looper.getMainLooper())
    private val listeners = CopyOnWriteArraySet<() -> Unit>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var job: Job? = null

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

    /** Fraction (0..100) of [doc] already available offline with the current voices and speed. */
    fun percentCached(context: Context, doc: Doc, plan: List<Pair<String, Voicing>>, speed: Float): Int {
        if (plan.isEmpty() || !Renderer.isStreamed(plan.first().second.voiceId)) return 0
        return plan.count { (text, v) -> Renderer.isCached(context, v, speed, text) } * 100 / plan.size
    }

    /** Renders every piece of [plan] (from [Speaker.plan]) into the audio cache. */
    fun start(context: Context, doc: Doc, plan: List<Pair<String, Voicing>>, speed: Float) {
        val voiceId = plan.firstOrNull()?.second?.voiceId ?: return
        if (running || !Renderer.isStreamed(voiceId)) return
        val app = context.applicationContext
        running = true
        docKey = doc.key
        progress = 0
        message = "Preparing offline audio…"
        listeners.forEach { it() }
        ReaderService.start(app)
        job = scope.launch {
            try {
                val pieces = plan
                // Online voices: many requests at once (the service answers each in about a second).
                val parallel = if (LocalTts.isLocal(voiceId)) 1 else 10
                var done = 0
                val started = System.currentTimeMillis()
                coroutineScope {
                    val inFlight = ArrayDeque<Deferred<File>>()
                    var next = 0
                    while (done < pieces.size) {
                        while (inFlight.size < parallel && next < pieces.size) {
                            val (text, v) = pieces[next++]
                            inFlight.addLast(async { retrying { Renderer.render(app, v, speed, text) } })
                        }
                        inFlight.removeFirst().await()
                        done++
                        val pct = done * 100 / pieces.size
                        if (pct != progress) {
                            val elapsed = System.currentTimeMillis() - started
                            val left = if (pct >= 2) " · about ${(elapsed * (100 - pct) / pct / 60_000).coerceAtLeast(1)} min left" else ""
                            update {
                                progress = pct
                                message = "Downloading for offline… $pct%$left"
                            }
                        }
                    }
                }
                update { message = "Available offline ✓" }
            } catch (e: CancellationException) {
                update { message = "Offline download stopped" }
            } catch (e: Exception) {
                update { message = "Offline download failed: ${e.message ?: e.javaClass.simpleName}" }
            } finally {
                update { running = false }
            }
        }
    }

    private suspend fun <T> retrying(block: suspend () -> T): T {
        var wait = 2_000L
        repeat(2) {
            try {
                return block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                kotlinx.coroutines.delay(wait)
                wait *= 2
            }
        }
        return block()
    }

    fun cancel() {
        job?.cancel()
    }
}

/**
 * How fast this phone makes speech with each kind of voice (seconds of work per second
 * of audio), learned while listening; for honest time estimates before saving audio.
 */
object RenderSpeed {
    private fun kind(voiceId: String) = voiceId.substringBefore(':')

    /** Before anything was measured: typical phone figures. */
    private fun guess(kind: String) = when (kind) {
        "super" -> 0.45
        "kokoro" -> 0.9
        "clone" -> 1.4
        "edge" -> 0.08
        else -> 0.25 // the phone's own voices
    }

    fun record(context: Context, voiceId: String, workSeconds: Double, audioSeconds: Double) {
        if (audioSeconds < 0.5) return
        val prefs = context.getSharedPreferences("p2a", Context.MODE_PRIVATE)
        val key = "rtf:" + kind(voiceId)
        val now = workSeconds / audioSeconds
        val old = prefs.getFloat(key, -1f)
        val avg = if (old < 0f) now else old * 0.8 + now * 0.2
        prefs.edit().putFloat(key, avg.toFloat()).apply()
    }

    /** The measured work per second of audio on this phone, or null until something has been made with this kind of voice. */
    fun measured(context: Context, voiceId: String): Double? =
        context.getSharedPreferences("p2a", Context.MODE_PRIVATE).getFloat("rtf:" + kind(voiceId), -1f).takeIf { it > 0f }?.toDouble()

    /** Whether this phone makes [voiceId] slower than it's heard at [speed] (so reading keeps pausing). */
    fun tooSlow(context: Context, voiceId: String, speed: Float = 1f): Boolean =
        (measured(context, voiceId) ?: 0.0) > 0.95 / speed.coerceAtLeast(0.5f)

    fun of(context: Context, voiceId: String): Double =
        context.getSharedPreferences("p2a", Context.MODE_PRIVATE).getFloat("rtf:" + kind(voiceId), -1f)
            .takeIf { it > 0f }?.toDouble() ?: guess(kind(voiceId))

    /** Minutes to make [audioMinutes] of audio with [voiceId] when saving (two on-device engines where the phone allows). */
    fun minutesFor(context: Context, voiceId: String, audioMinutes: Int): Int {
        val engines = if (LocalTts.isLocal(voiceId) && LocalTts.hasSpare) 1.7 else 1.0
        return (audioMinutes * of(context, voiceId) / engines).toInt().coerceAtLeast(1)
    }
}
