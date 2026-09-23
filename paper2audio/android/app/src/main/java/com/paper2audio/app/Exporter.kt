package com.paper2audio.app

import android.content.ContentValues
import android.content.Context
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.provider.MediaStore
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.io.File
import java.io.FileDescriptor
import java.io.IOException
import java.io.RandomAccessFile
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArraySet
import kotlin.coroutines.coroutineContext

/**
 * Renders a whole document to one audio file in Music/Paper2Audio: MP3 for
 * the natural (Microsoft) voices, M4A (AAC) for the phone's own voices.
 */
object Exporter {
    var running = false
        private set
    var progress = 0
        private set
    var message: String? = null
        private set
    var resultUri: Uri? = null
        private set

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val main = Handler(Looper.getMainLooper())
    private val listeners = CopyOnWriteArraySet<() -> Unit>()
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

    fun start(context: Context, doc: Doc, voiceId: String, speed: Float) {
        if (running) return
        val app = context.applicationContext
        running = true
        progress = 0
        message = "Preparing…"
        resultUri = null
        listeners.forEach { it() }
        ReaderService.start(app)
        job = scope.launch {
            try {
                val (uri, where) = if (voiceId.startsWith(Speaker.EDGE)) {
                    exportEdge(app, doc, voiceId.removePrefix(Speaker.EDGE), speed)
                } else if (voiceId.startsWith(Speaker.KOKORO)) {
                    exportKokoro(app, doc, voiceId.removePrefix(Speaker.KOKORO), speed)
                } else {
                    export(app, doc, voiceId.removePrefix(Speaker.SYSTEM), speed)
                }
                update {
                    resultUri = uri
                    message = "Saved to $where"
                }
            } catch (e: CancellationException) {
                update { message = "Cancelled" }
            } catch (e: Exception) {
                update { message = "Saving failed: ${e.message ?: e.javaClass.simpleName}" }
            } finally {
                update { running = false }
            }
        }
    }

    fun cancel() {
        job?.cancel()
    }

    private class Output(
        val uri: Uri,
        val pfd: ParcelFileDescriptor,
        val where: String,
        val commit: () -> Unit,
        val discard: () -> Unit,
    )

    private suspend fun export(context: Context, doc: Doc, voiceName: String?, speed: Float): Pair<Uri, String> {
        val waits = ConcurrentHashMap<String, CompletableDeferred<Boolean>>()
        val initDone = CompletableDeferred<Int>()
        val tts = withContext(Dispatchers.Main) { TextToSpeech(context) { initDone.complete(it) } }
        try {
            if (initDone.await() != TextToSpeech.SUCCESS) error("Text-to-speech engine unavailable")
            tts.setSpeechRate(speed)
            voiceName?.let { name -> tts.voices?.firstOrNull { it.name == name }?.let { tts.voice = it } }
            tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(id: String) = Unit
                override fun onDone(id: String) {
                    waits.remove(id)?.complete(true)
                }

                @Deprecated("Deprecated in Java")
                override fun onError(id: String) {
                    waits.remove(id)?.complete(false)
                }

                override fun onError(id: String, errorCode: Int) {
                    waits.remove(id)?.complete(false)
                }
            })

            val chunks = group(doc.paragraphs)
            val wav = File(context.cacheDir, "chunk.wav")
            val out = createOutput(context, doc.title, "m4a", "audio/mp4")
            var writer: AacWriter? = null
            var ok = false
            try {
                for ((i, text) in chunks.withIndex()) {
                    coroutineContext.ensureActive()
                    if (synth(tts, waits, text, wav, "c$i") || synth(tts, waits, text, wav, "r$i")) {
                        val info = WavInfo.read(wav)
                        val w = writer ?: AacWriter(out.pfd.fileDescriptor, info.sampleRate, info.channels)
                            .also { writer = it }
                        if (info.sampleRate != w.sampleRate || info.channels != w.channels) {
                            error("Voice changed audio format mid-way")
                        }
                        w.writePcm(wav, info)
                    }
                    val pct = (i + 1) * 100 / chunks.size
                    update {
                        progress = pct
                        message = "Saving audio… $pct%"
                    }
                }
                (writer ?: error("No audio was produced")).finish()
                ok = true
            } finally {
                if (!ok) runCatching { writer?.release() }
                runCatching { out.pfd.close() }
                wav.delete()
                if (ok) out.commit() else out.discard()
            }
            return out.uri to out.where
        } finally {
            tts.shutdown()
        }
    }

    private suspend fun exportEdge(context: Context, doc: Doc, voice: String, speed: Float): Pair<Uri, String> {
        val chunks = group(doc.paragraphs, 2400)
        val rate = Speaker.ratePercent(speed)
        val out = createOutput(context, doc.title, "mp3", "audio/mpeg")
        var ok = false
        try {
            ParcelFileDescriptor.AutoCloseOutputStream(out.pfd).buffered().use { os ->
                coroutineScope {
                    var i = 0
                    while (i < chunks.size) {
                        // A few requests in flight at once, written in order.
                        val batch = (i until minOf(i + 4, chunks.size)).map { k ->
                            async(Dispatchers.IO) { synthEdge(chunks[k], voice, rate) }
                        }
                        for (part in batch) os.write(part.await())
                        i += batch.size
                        val pct = i * 100 / chunks.size
                        update {
                            progress = pct
                            message = "Saving audio… $pct%"
                        }
                    }
                }
            }
            ok = true
        } finally {
            runCatching { out.pfd.close() }
            if (ok) out.commit() else out.discard()
        }
        return out.uri to out.where
    }

    private suspend fun exportKokoro(context: Context, doc: Doc, name: String, speed: Float): Pair<Uri, String> {
        val voice = Kokoro.voice(name) ?: error("Unknown Kokoro voice")
        if (!Kokoro.isInstalled()) error("Download the Kokoro voices first")
        val out = createOutput(context, doc.title, "m4a", "audio/mp4")
        var writer: AacWriter? = null
        var ok = false
        try {
            for ((i, text) in doc.paragraphs.withIndex()) {
                coroutineContext.ensureActive()
                val pcm = Kokoro.synthesize(text, voice, speed)
                val w = writer ?: AacWriter(out.pfd.fileDescriptor, pcm.sampleRate, 1).also { writer = it }
                w.writePcm(pcm.bytes, pcm.bytes.size)
                val pct = (i + 1) * 100 / doc.paragraphs.size
                if (pct != progress) {
                    update {
                        progress = pct
                        message = "Saving audio… $pct%"
                    }
                }
            }
            (writer ?: error("No audio was produced")).finish()
            ok = true
        } finally {
            if (!ok) runCatching { writer?.release() }
            runCatching { out.pfd.close() }
            if (ok) out.commit() else out.discard()
        }
        return out.uri to out.where
    }

    private suspend fun synthEdge(text: String, voice: String, rate: Int): ByteArray {
        var wait = 2_000L
        repeat(3) {
            try {
                return EdgeTts.synthesize(text, voice, rate)
            } catch (e: IOException) {
                delay(wait)
                wait *= 2
            }
        }
        return EdgeTts.synthesize(text, voice, rate) // last try; its error is reported
    }

    /** Fewer, larger requests are much faster than one per paragraph. */
    private fun group(paragraphs: List<String>, limit: Int = 3000): List<String> {
        val out = ArrayList<String>()
        val buf = StringBuilder()
        for (p in paragraphs) {
            if (buf.isNotEmpty() && buf.length + p.length + 2 > limit) {
                out += buf.toString()
                buf.setLength(0)
            }
            if (buf.isNotEmpty()) buf.append("\n\n")
            buf.append(p)
        }
        if (buf.isNotEmpty()) out += buf.toString()
        return out
    }

    private suspend fun synth(
        tts: TextToSpeech,
        waits: ConcurrentHashMap<String, CompletableDeferred<Boolean>>,
        text: String,
        file: File,
        id: String,
    ): Boolean {
        file.delete()
        val done = CompletableDeferred<Boolean>()
        waits[id] = done
        if (tts.synthesizeToFile(text, Bundle(), file, id) != TextToSpeech.SUCCESS) {
            waits.remove(id)
            return false
        }
        val ok = withTimeoutOrNull(10 * 60_000L) { done.await() } ?: false
        return ok && file.length() > 44
    }

    private fun createOutput(context: Context, title: String, ext: String, mime: String): Output {
        val safe = title.replace(Regex("""[\\/:*?"<>|]+"""), "_").take(80).ifBlank { "audio" }
        if (Build.VERSION.SDK_INT >= 29) {
            val cr = context.contentResolver
            val values = ContentValues().apply {
                put(MediaStore.Audio.Media.DISPLAY_NAME, "$safe.$ext")
                put(MediaStore.Audio.Media.MIME_TYPE, mime)
                put(MediaStore.Audio.Media.TITLE, title)
                put(MediaStore.Audio.Media.RELATIVE_PATH, Environment.DIRECTORY_MUSIC + "/Paper2Audio")
                put(MediaStore.Audio.Media.IS_PENDING, 1)
            }
            val collection = MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            val uri = cr.insert(collection, values) ?: error("Could not create the audio file")
            val pfd = cr.openFileDescriptor(uri, "rw") ?: error("Could not open the audio file")
            return Output(
                uri, pfd, "Music/Paper2Audio",
                commit = {
                    cr.update(uri, ContentValues().apply { put(MediaStore.Audio.Media.IS_PENDING, 0) }, null, null)
                },
                discard = { runCatching { cr.delete(uri, null, null) } },
            )
        }
        val dir = File(context.getExternalFilesDir(Environment.DIRECTORY_MUSIC), "Paper2Audio").apply { mkdirs() }
        val file = File(dir, "$safe.$ext")
        val pfd = ParcelFileDescriptor.open(
            file,
            ParcelFileDescriptor.MODE_READ_WRITE or ParcelFileDescriptor.MODE_CREATE or ParcelFileDescriptor.MODE_TRUNCATE,
        )
        return Output(Uri.fromFile(file), pfd, file.absolutePath, commit = {}, discard = { file.delete() })
    }
}

/** Location of the PCM samples inside a WAV file written by the TTS engine. */
class WavInfo(val sampleRate: Int, val channels: Int, val dataOffset: Long, val dataSize: Long) {
    companion object {
        fun read(file: File): WavInfo {
            RandomAccessFile(file, "r").use { f ->
                fun int32(): Int = Integer.reverseBytes(f.readInt())
                fun int16(): Int = java.lang.Short.reverseBytes(f.readShort()).toInt() and 0xffff
                val tag = ByteArray(4)
                f.readFully(tag)
                if (String(tag, Charsets.US_ASCII) != "RIFF") error("Unexpected audio format from TTS engine")
                f.seek(12)
                var rate = 0
                var channels = 0
                var bits = 16
                while (f.filePointer + 8 <= f.length()) {
                    f.readFully(tag)
                    val id = String(tag, Charsets.US_ASCII)
                    val size = int32().toLong() and 0xffffffffL
                    val start = f.filePointer
                    when (id) {
                        "fmt " -> {
                            int16() // audio format
                            channels = int16()
                            rate = int32()
                            int32() // byte rate
                            int16() // block align
                            bits = int16()
                        }
                        "data" -> {
                            if (bits != 16) error("Unsupported ${bits}-bit audio from TTS engine")
                            // Some engines leave the size at 0 or 0xFFFFFFFF; trust the file length.
                            val real = f.length() - start
                            val dataSize = if (size == 0L || size > real) real else size
                            return WavInfo(rate, channels, start, dataSize)
                        }
                    }
                    f.seek(start + size + (size and 1))
                }
                error("Audio from TTS engine had no data")
            }
        }
    }
}

/** Streams 16-bit PCM into an AAC encoder and an MP4 container. */
class AacWriter(fd: FileDescriptor, val sampleRate: Int, val channels: Int) {
    private val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
    private val muxer = MediaMuxer(fd, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    private val info = MediaCodec.BufferInfo()
    private var track = -1
    private var muxing = false
    private var samples = 0L

    init {
        val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, sampleRate, channels).apply {
            setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
            setInteger(MediaFormat.KEY_BIT_RATE, 64_000)
            setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16_384)
        }
        codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        codec.start()
    }

    fun writePcm(file: File, wav: WavInfo) {
        val bytes = ByteArray(8192)
        RandomAccessFile(file, "r").use { f ->
            f.seek(wav.dataOffset)
            var left = wav.dataSize
            while (left > 0) {
                val n = f.read(bytes, 0, minOf(bytes.size.toLong(), left).toInt())
                if (n <= 0) break
                feed(bytes, n)
                left -= n
            }
        }
    }

    fun writePcm(pcm: ByteArray, len: Int) = feed(pcm, len)

    private fun feed(pcm: ByteArray, len: Int) {
        var pos = 0
        while (len - pos >= 2) {
            val idx = codec.dequeueInputBuffer(10_000)
            if (idx >= 0) {
                val buf = codec.getInputBuffer(idx)!!
                buf.clear()
                val n = minOf(buf.remaining(), len - pos) and 1.inv() // whole 16-bit samples
                buf.put(pcm, pos, n)
                codec.queueInputBuffer(idx, 0, n, samples * 1_000_000L / sampleRate, 0)
                samples += n / (2 * channels)
                pos += n
            }
            drain(false)
        }
    }

    private fun drain(endOfStream: Boolean) {
        while (true) {
            val idx = codec.dequeueOutputBuffer(info, 10_000)
            when {
                idx == MediaCodec.INFO_TRY_AGAIN_LATER -> if (!endOfStream) return
                idx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                    track = muxer.addTrack(codec.outputFormat)
                    muxer.start()
                    muxing = true
                }
                idx >= 0 -> {
                    val buf = codec.getOutputBuffer(idx)!!
                    if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) info.size = 0
                    if (info.size > 0 && muxing) {
                        buf.position(info.offset)
                        buf.limit(info.offset + info.size)
                        muxer.writeSampleData(track, buf, info)
                    }
                    codec.releaseOutputBuffer(idx, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
                }
            }
        }
    }

    fun finish() {
        while (true) {
            val idx = codec.dequeueInputBuffer(10_000)
            if (idx >= 0) {
                codec.queueInputBuffer(idx, 0, 0, samples * 1_000_000L / sampleRate, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                break
            }
            drain(false)
        }
        drain(true)
        codec.stop()
        codec.release()
        muxer.stop()
        muxer.release()
    }

    fun release() {
        runCatching { codec.release() }
        runCatching { muxer.release() }
    }
}
