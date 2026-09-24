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
 * Turns text pieces into audio files for the natural voices (Microsoft and
 * Kokoro) and keeps them in a disk cache, so replaying, resuming and offline
 * listening don't need to render anything again.
 */
object Renderer {
    private const val EDGE_MAX_SPEED = 3.0f
    private const val KOKORO_MAX_SPEED = 2.0f
    private const val CACHE_LIMIT = 2_000_000_000L

    /** Kokoro runs one generation at a time; keep its work on one thread. */
    val kokoroThread = Executors.newSingleThreadExecutor().asCoroutineDispatcher()

    fun isStreamed(voiceId: String) = voiceId.startsWith(Speaker.EDGE) || voiceId.startsWith(Speaker.KOKORO)

    /** The speed the voice engine renders at; any extra is applied by the player. */
    fun engineSpeed(voiceId: String, speed: Float) = when {
        voiceId.startsWith(Speaker.EDGE) -> minOf(speed, EDGE_MAX_SPEED)
        voiceId.startsWith(Speaker.KOKORO) -> minOf(speed, KOKORO_MAX_SPEED)
        else -> speed
    }

    fun playbackBoost(voiceId: String, speed: Float) = speed / engineSpeed(voiceId, speed)

    /** Playback pieces for one paragraph: a short first piece so every paragraph starts fast. */
    fun pieces(paragraph: String, voiceId: String): List<String> =
        TextCleaner.pieces(paragraph, if (voiceId.startsWith(Speaker.KOKORO)) 220 else 500, firstTarget = 160)

    private fun dir(context: Context) = File(context.filesDir, "audiocache").apply { mkdirs() }

    fun file(context: Context, voiceId: String, speed: Float, text: String): File {
        val es = (engineSpeed(voiceId, speed) * 100).roundToInt()
        val digest = MessageDigest.getInstance("SHA-1").digest("$voiceId|$es|$text".toByteArray())
        val ext = if (voiceId.startsWith(Speaker.KOKORO)) "wav" else "mp3"
        return File(dir(context), digest.joinToString("") { "%02x".format(it) } + "." + ext)
    }

    fun isCached(context: Context, voiceId: String, speed: Float, text: String) =
        file(context, voiceId, speed, text).length() > 0

    /** Returns the audio for [text], rendering it if it isn't cached yet. */
    suspend fun render(context: Context, voiceId: String, speed: Float, text: String): File {
        val target = file(context, voiceId, speed, text)
        if (target.length() > 0) {
            target.setLastModified(System.currentTimeMillis())
            return target
        }
        val tmp = File(target.path + ".part" + System.nanoTime())
        try {
            val es = engineSpeed(voiceId, speed)
            if (voiceId.startsWith(Speaker.KOKORO)) {
                val voice = Kokoro.voice(voiceId.removePrefix(Speaker.KOKORO)) ?: error("Unknown Kokoro voice")
                withContext(kokoroThread) { Kokoro.writeWav(tmp, Kokoro.synthesize(text, voice, es)) }
            } else {
                val rate = ((es - 1f) * 100).roundToInt().coerceIn(-50, 200)
                withContext(Dispatchers.IO) { tmp.writeBytes(EdgeTts.synthesize(text, voiceId.removePrefix(Speaker.EDGE), rate)) }
            }
            if (!tmp.renameTo(target)) error("Couldn't save audio")
        } finally {
            tmp.delete()
        }
        return target
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

    private fun allPieces(doc: Doc, voiceId: String) = doc.paragraphs.flatMap { Renderer.pieces(it, voiceId) }

    /** Fraction (0..100) of [doc] already available offline with this voice and speed. */
    fun percentCached(context: Context, doc: Doc, voiceId: String, speed: Float): Int {
        if (!Renderer.isStreamed(voiceId)) return 0
        val pieces = allPieces(doc, voiceId)
        if (pieces.isEmpty()) return 0
        return pieces.count { Renderer.isCached(context, voiceId, speed, it) } * 100 / pieces.size
    }

    fun start(context: Context, doc: Doc, voiceId: String, speed: Float) {
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
                val pieces = allPieces(doc, voiceId)
                val parallel = if (voiceId.startsWith(Speaker.KOKORO)) 1 else 6
                var done = 0
                val started = System.currentTimeMillis()
                coroutineScope {
                    val inFlight = ArrayDeque<Deferred<File>>()
                    var next = 0
                    while (done < pieces.size) {
                        while (inFlight.size < parallel && next < pieces.size) {
                            val text = pieces[next++]
                            inFlight.addLast(async { retrying { Renderer.render(app, voiceId, speed, text) } })
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
