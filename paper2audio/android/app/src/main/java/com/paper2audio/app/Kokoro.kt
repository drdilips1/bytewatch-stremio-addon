package com.paper2audio.app

import android.content.Context
import android.os.Handler
import android.os.Looper
import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.OfflineTtsConfig
import com.k2fsa.sherpa.onnx.OfflineTtsKokoroModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream
import java.io.File
import java.io.FilterInputStream
import java.io.IOException
import java.io.InputStream
import java.io.RandomAccessFile
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.TimeUnit
import kotlin.coroutines.coroutineContext

/**
 * Kokoro: a high-quality open-source voice model that runs entirely on the
 * phone via sherpa-onnx. The model (~300+ MB) is downloaded on first use.
 */
object Kokoro {
    data class KVoice(val name: String, val sid: Int, val label: String) {
        val british get() = name.startsWith("b")
    }

    /** Best-rated English voices of kokoro-multi-lang-v1_0; sid is the speaker index in voices.bin. */
    val VOICES = listOf(
        KVoice("af_heart", 3, "Heart · US English · female"),
        KVoice("af_bella", 2, "Bella · US English · female"),
        KVoice("af_nicole", 6, "Nicole · US English · female (soft)"),
        KVoice("af_sarah", 9, "Sarah · US English · female"),
        KVoice("af_aoede", 1, "Aoede · US English · female"),
        KVoice("af_kore", 5, "Kore · US English · female"),
        KVoice("am_michael", 16, "Michael · US English · male"),
        KVoice("am_fenrir", 14, "Fenrir · US English · male"),
        KVoice("am_puck", 18, "Puck · US English · male"),
        KVoice("am_echo", 12, "Echo · US English · male"),
        KVoice("bf_emma", 21, "Emma · British English · female"),
        KVoice("bf_isabella", 22, "Isabella · British English · female"),
        KVoice("bm_george", 26, "George · British English · male"),
        KVoice("bm_fable", 25, "Fable · British English · male"),
        KVoice("bm_daniel", 24, "Daniel · British English · male"),
    )

    private const val PACKAGE = "kokoro-multi-lang-v1_0"
    private const val URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/$PACKAGE.tar.bz2"

    var installing = false
        private set
    var progress = 0
        private set
    var message: String? = null
        private set

    private lateinit var app: Context
    private val main = Handler(Looper.getMainLooper())
    private val listeners = CopyOnWriteArraySet<() -> Unit>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var job: Job? = null

    private var engine: OfflineTts? = null
    private var engineBritish = false
    private val lock = Any()

    fun init(context: Context) {
        app = context.applicationContext
    }

    private val dir: File get() = File(app.filesDir, PACKAGE)
    private val marker: File get() = File(dir, ".installed")

    fun isInstalled(): Boolean = ::app.isInitialized && marker.exists()

    /** False on the rare phones (32-bit or x86) the bundled engine doesn't support. */
    val supported: Boolean by lazy {
        try {
            Class.forName("com.k2fsa.sherpa.onnx.OfflineTts") // loads libsherpa-onnx-jni.so
            true
        } catch (e: Throwable) {
            false
        }
    }

    fun voice(name: String): KVoice? = VOICES.firstOrNull { it.name == name }

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

    fun install(onDone: () -> Unit = {}) {
        if (installing || isInstalled()) return
        installing = true
        progress = 0
        message = "Starting download…"
        listeners.forEach { it() }
        ReaderService.start(app)
        job = scope.launch {
            try {
                download()
                extract()
                update {
                    message = "Kokoro voices ready"
                    onDone()
                }
            } catch (e: CancellationException) {
                update { message = "Download cancelled" }
            } catch (e: Exception) {
                update { message = "Download failed: ${e.message ?: e.javaClass.simpleName}. Tap Download to retry." }
            } finally {
                update { installing = false }
            }
        }
    }

    fun cancelInstall() {
        job?.cancel()
    }

    /** Deletes the downloaded model to free its storage. */
    fun uninstall(onDone: () -> Unit) {
        if (installing) return
        scope.launch {
            synchronized(lock) {
                engine?.release()
                engine = null
            }
            dir.deleteRecursively()
            archive.delete()
            update {
                message = null
                onDone()
            }
        }
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    private val archive: File get() = File(app.filesDir, "$PACKAGE.tar.bz2.part")

    /** Downloads the model, resuming a partial download if there is one. */
    private suspend fun download() {
        val have = if (archive.exists()) archive.length() else 0L
        val request = Request.Builder().url(URL).apply {
            if (have > 0) header("Range", "bytes=$have-")
        }.build()
        client.newCall(request).execute().use { r ->
            if (r.code == 416 && have > 0) return // already fully downloaded
            if (!r.isSuccessful) throw IOException("HTTP ${r.code}")
            val resumed = r.code == 206
            val start = if (resumed) have else 0L
            val total = (r.body?.contentLength() ?: -1L).let { if (it > 0) it + start else -1L }
            RandomAccessFile(archive, "rw").use { out ->
                if (!resumed) out.setLength(0)
                out.seek(start)
                val buf = ByteArray(256 * 1024)
                var done = start
                var lastPct = -1
                r.body!!.byteStream().use { input ->
                    while (true) {
                        coroutineContext.ensureActive()
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        done += n
                        val pct = if (total > 0) (done * 80 / total).toInt() else 0
                        if (pct != lastPct) {
                            lastPct = pct
                            val mb = done / 1_000_000
                            val of = if (total > 0) " of ${total / 1_000_000} MB" else " MB"
                            update {
                                progress = pct
                                message = "Downloading Kokoro voices… $mb$of"
                            }
                        }
                    }
                }
                if (total > 0 && done < total) throw IOException("download interrupted")
            }
        }
    }

    /** Unpacks only what English playback needs (skips the Chinese dictionaries). */
    private suspend fun extract() {
        try {
            unpack()
        } catch (e: IOException) {
            archive.delete() // probably corrupt; start the download over next time
            throw e
        }
    }

    private suspend fun unpack() {
        dir.deleteRecursively()
        dir.mkdirs()
        val size = archive.length().coerceAtLeast(1)
        val counting = CountingStream(archive.inputStream().buffered(1 shl 20))
        TarArchiveInputStream(BZip2CompressorInputStream(counting)).use { tar ->
            var lastPct = -1
            while (true) {
                coroutineContext.ensureActive()
                val entry = tar.nextEntry ?: break
                // Entries look like "kokoro-multi-lang-v1_0/model.onnx".
                val rel = entry.name.removePrefix("./").substringAfter('/', "")
                if (rel.isEmpty() || rel.split('/').any { it == ".." }) continue
                if (rel.startsWith("dict/") || rel.endsWith(".fst") || rel == "lexicon-zh.txt") continue
                val target = File(dir, rel)
                if (entry.isDirectory) {
                    target.mkdirs()
                    continue
                }
                target.parentFile?.mkdirs()
                target.outputStream().buffered(1 shl 20).use { tar.copyTo(it, 1 shl 20) }
                val pct = 80 + (counting.count * 20 / size).toInt()
                if (pct != lastPct) {
                    lastPct = pct
                    update {
                        progress = pct
                        message = "Unpacking Kokoro voices…"
                    }
                }
            }
        }
        for (required in listOf("model.onnx", "voices.bin", "tokens.txt", "lexicon-us-en.txt", "espeak-ng-data")) {
            if (!File(dir, required).exists()) throw IOException("the download was incomplete ($required missing)")
        }
        marker.createNewFile()
        archive.delete()
    }

    private class CountingStream(input: InputStream) : FilterInputStream(input) {
        var count = 0L

        override fun read(): Int = super.read().also { if (it >= 0) count++ }

        override fun read(b: ByteArray, off: Int, len: Int): Int =
            super.read(b, off, len).also { if (it > 0) count += it }
    }

    /**
     * Generates speech for [text] as 16-bit PCM (little endian) at [sampleRate].
     * The engine is single-threaded; calls are serialized.
     */
    fun synthesize(text: String, voice: KVoice, speed: Float): Pcm = synchronized(lock) {
        val tts = engineFor(voice.british)
        val audio = tts.generate(text, sid = voice.sid, speed = speed)
        Pcm(toPcm16(audio.samples), audio.sampleRate)
    }

    class Pcm(val bytes: ByteArray, val sampleRate: Int)

    /** Loads the model for [voice]'s accent without generating anything. */
    fun prepare(voice: KVoice) {
        synchronized(lock) { engineFor(voice.british) }
    }

    private fun engineFor(british: Boolean): OfflineTts {
        engine?.let { if (engineBritish == british) return it }
        engine?.release()
        engine = null
        val lexicon = File(dir, if (british) "lexicon-gb-en.txt" else "lexicon-us-en.txt")
            .takeIf { it.exists() } ?: File(dir, "lexicon-us-en.txt")
        val config = OfflineTtsConfig(
            model = OfflineTtsModelConfig(
                kokoro = OfflineTtsKokoroModelConfig(
                    model = File(dir, "model.onnx").path,
                    voices = File(dir, "voices.bin").path,
                    tokens = File(dir, "tokens.txt").path,
                    dataDir = File(dir, "espeak-ng-data").path,
                    lexicon = lexicon.path,
                ),
                numThreads = Runtime.getRuntime().availableProcessors().coerceIn(2, 4),
                debug = false,
                provider = "cpu",
            ),
        )
        return OfflineTts(config = config).also {
            engine = it
            engineBritish = british
        }
    }

    private fun toPcm16(samples: FloatArray): ByteArray {
        val out = ByteArray(samples.size * 2)
        for ((i, f) in samples.withIndex()) {
            val v = (f.coerceIn(-1f, 1f) * 32767f).toInt()
            out[2 * i] = (v and 0xff).toByte()
            out[2 * i + 1] = ((v shr 8) and 0xff).toByte()
        }
        return out
    }

    /** Writes a playable WAV file for MediaPlayer. */
    fun writeWav(file: File, pcm: Pcm) {
        val dataLen = pcm.bytes.size
        val header = java.nio.ByteBuffer.allocate(44).order(java.nio.ByteOrder.LITTLE_ENDIAN).apply {
            put("RIFF".toByteArray()); putInt(36 + dataLen); put("WAVE".toByteArray())
            put("fmt ".toByteArray()); putInt(16); putShort(1); putShort(1)
            putInt(pcm.sampleRate); putInt(pcm.sampleRate * 2); putShort(2); putShort(16)
            put("data".toByteArray()); putInt(dataLen)
        }.array()
        file.outputStream().use {
            it.write(header)
            it.write(pcm.bytes)
        }
    }
}
