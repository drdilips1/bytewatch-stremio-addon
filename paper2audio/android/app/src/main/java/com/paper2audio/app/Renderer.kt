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

    fun isStreamed(voiceId: String) = voiceId.startsWith(Speaker.EDGE) || LocalTts.isLocal(voiceId)

    private fun maxSpeed(voiceId: String) = if (LocalTts.isLocal(voiceId)) LocalTts.maxSpeed(voiceId) else EDGE_MAX_SPEED

    /** The speed the voice engine renders at; any extra is applied by the player. */
    fun engineSpeed(voiceId: String, speed: Float) = if (isStreamed(voiceId)) minOf(speed, maxSpeed(voiceId)) else speed

    fun engineSpeed(v: Voicing, speed: Float): Float {
        val max = listOfNotNull(v.voiceId, v.dialogue).filter { isStreamed(it) }.minOfOrNull { maxSpeed(it) } ?: return speed
        return minOf(speed, max)
    }

    fun playbackBoost(v: Voicing, speed: Float) = speed / engineSpeed(v, speed)

    /**
     * Playback pieces for one paragraph: about one sentence each (very short ones
     * joined), so playback starts fast and can step back a sentence at a time.
     */
    fun pieces(paragraph: String, voiceId: String): List<String> =
        // On-device voices: one sentence per piece (only very short ones joined), so every sentence
        // gets the same pause whatever the text, and the first sound comes sooner.
        if (LocalTts.isLocal(voiceId)) TextCleaner.pieces(paragraph, 14, hardMax = 200)
        else TextCleaner.pieces(paragraph, 50, hardMax = 900)

    private fun dir(context: Context) = File(context.filesDir, "audiocache").apply { mkdirs() }

    fun file(context: Context, v: Voicing, speed: Float, text: String): File {
        val es = (engineSpeed(v, speed) * 100).roundToInt()
        val digest = MessageDigest.getInstance("SHA-1").digest("${v.key}|$es|$text".toByteArray())
        val ext = if (LocalTts.isLocal(v.voiceId)) "wav" else "mp3"
        return File(dir(context), digest.joinToString("") { "%02x".format(it) } + "." + ext)
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
    suspend fun render(context: Context, v: Voicing, speed: Float, text: String): File {
        val target = file(context, v, speed, text)
        if (target.length() > 0) {
            target.setLastModified(System.currentTimeMillis())
            return target
        }
        val key = target.path
        val flight = synchronized(inFlight) {
            inFlight.getOrPut(key) {
                val d = work.async(start = kotlinx.coroutines.CoroutineStart.LAZY) { renderNow(context, v, speed, text, target) }
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

    private suspend fun renderNow(context: Context, v: Voicing, speed: Float, text: String, target: File): File {
        if (target.length() > 0) return target
        val segments = v.dialogue?.let { Stories.split(text) }
        if (segments != null && segments.size > 1) {
            // Narration and dialogue in their own voices, joined into one file.
            val parts = segments.map { (quoted, part) ->
                render(context, v.copy(voiceId = if (quoted) v.dialogue else v.voiceId, dialogue = null), engineSpeed(v, speed), part)
            }
            withContext(Dispatchers.IO) { join(parts, target, local = LocalTts.isLocal(v.voiceId)) }
            return target
        }
        val voice = if (segments?.singleOrNull()?.first == true) v.dialogue!! else v.voiceId
        val tmp = File(target.path + ".part" + System.nanoTime())
        // What the voice is given: numbers, units, symbols and abbreviations spelled out.
        val spoken = Speech.normalize(text, v.medical).ifBlank { text }
        try {
            val es = engineSpeed(v, speed)
            if (LocalTts.isLocal(voice)) {
                withContext(localThread) {
                    val t0 = System.nanoTime()
                    val pcm = LocalTts.synthesize(voice, spoken, es, v.lang)
                    RenderSpeed.record(context, voice, (System.nanoTime() - t0) / 1e9, pcm.bytes.size / 2.0 / pcm.sampleRate)
                    LocalTts.writeWav(tmp, pcm)
                }
            } else {
                val rate = ((es - 1f) * 100).roundToInt().coerceIn(-50, 200)
                tmp.writeBytes(hedged(spoken.length) { EdgeTts.synthesize(spoken, voice.removePrefix(Speaker.EDGE), rate, v.pitch) })
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

    /** (isDialogue, text) segments in order; null when there's no dialogue at all. */
    fun split(text: String): List<Pair<Boolean, String>>? {
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

    fun of(context: Context, voiceId: String): Double =
        context.getSharedPreferences("p2a", Context.MODE_PRIVATE).getFloat("rtf:" + kind(voiceId), -1f)
            .takeIf { it > 0f }?.toDouble() ?: guess(kind(voiceId))

    /** Minutes to make [audioMinutes] of audio with [voiceId]. */
    fun minutesFor(context: Context, voiceId: String, audioMinutes: Int): Int =
        (audioMinutes * of(context, voiceId)).toInt().coerceAtLeast(1)
}
