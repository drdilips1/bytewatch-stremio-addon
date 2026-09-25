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
    /** Bytes of audio written so far, and when saving started (for size and time estimates). */
    private var bytesOut = 0L
    private var startedAt = 0L

    /** Rough length (minutes) and size (MB) of the saved file, shown before saving. */
    fun estimate(doc: Doc, voiceId: String, speed: Float): Pair<Int, Int> {
        val minutes = (doc.words / (160f * speed)).toInt().coerceAtLeast(1)
        // 48 kbit/s MP3 for Microsoft voices, 64 kbit/s AAC otherwise.
        val kbps = if (voiceId.startsWith(Speaker.EDGE)) 48 else 64
        val mb = (minutes * 60L * kbps / 8 / 1000).toInt().coerceAtLeast(1)
        return minutes to mb
    }

    /** Audiobook export: which chapter file is being saved (0-based) of how many. */
    private var part = 0
    private var parts = 1
    private var partBytes = 0L
    /** Where files go (under Music) and the MP3 tags for the current file. */
    private var folder = "Paper2Audio"
    private var tags: Id3.Info? = null

    private fun overall(pct: Int) = (part * 100 + pct) / parts

    private fun progressMessage(pct: Int): String {
        val parts = mutableListOf(if (this.parts > 1) "Saving chapter ${part + 1} of ${this.parts}… $pct%" else "Saving… $pct%")
        if (bytesOut > 0) parts += "%.1f MB".format(bytesOut / 1_000_000.0)
        val elapsed = System.currentTimeMillis() - startedAt
        if (pct >= 2 && elapsed > 5_000) {
            val leftMin = (elapsed * (100 - pct) / pct / 60_000).toInt()
            parts += if (leftMin < 1) "under a minute left" else "about $leftMin min left"
        }
        return parts.joinToString(" · ")
    }
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

    /**
     * Saves [doc] as audio. With [perChapter], every chapter becomes its own file in a
     * folder named after the book (MP3s get title, author, track and cover tags), which
     * audiobook and music apps show as an album.
     */
    fun start(context: Context, doc: Doc, v: Voicing, speed: Float, perChapter: Boolean = false) {
        val voiceId = v.voiceId
        if (running) return
        val app = context.applicationContext
        running = true
        progress = 0
        part = 0
        parts = 1
        bytesOut = 0
        startedAt = System.currentTimeMillis()
        message = "Starting… (the first part takes a few seconds)"
        resultUri = null
        listeners.forEach { it() }
        ReaderService.start(app)
        job = scope.launch {
            try {
                val item = Library.get(app, doc.key)
                val cover = runCatching { Library.thumb(app, doc.key).takeIf { it.exists() }?.readBytes() }.getOrNull()
                val author = item?.author ?: doc.author
                val safeBook = doc.title.replace(Regex("""[\\/:*?"<>|]+"""), "_").take(60).trim().ifBlank { "Audiobook" }
                val chapters = if (perChapter && doc.chapters.size > 1) chapterDocs(doc) else listOf(doc)
                parts = chapters.size
                folder = if (chapters.size > 1) "Paper2Audio/$safeBook" else "Paper2Audio"
                var result: Pair<Uri, String>? = null
                for ((i, d) in chapters.withIndex()) {
                    part = i
                    partBytes = bytesOut
                    tags = Id3.Info(
                        title = if (chapters.size > 1) d.title else doc.title,
                        artist = author,
                        album = doc.title,
                        track = if (chapters.size > 1) "${i + 1}/${chapters.size}" else null,
                        cover = cover,
                    )
                    result = exportOne(app, d, v, speed, voiceId)
                }
                val (uri, where) = result!!
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

    private suspend fun exportOne(app: Context, doc: Doc, v: Voicing, speed: Float, voiceId: String): Pair<Uri, String> {
        return if (voiceId.startsWith(Speaker.EDGE)) {
            exportEdge(app, doc, v, speed)
        } else if (LocalTts.isLocal(voiceId)) {
            exportLocal(app, doc, v.copy(lang = v.lang ?: Langs.of(doc)), speed)
        } else {
            export(app, doc, voiceId.removePrefix(Speaker.SYSTEM), speed)
        }
    }

    /** One document per chapter (text before the first chapter joins it), titled "01 Chapter". */
    private fun chapterDocs(doc: Doc): List<Doc> {
        val starts = doc.chapters.map { it.start }.toMutableList()
        starts[0] = 0
        val width = doc.chapters.size.toString().length.coerceAtLeast(2)
        return doc.chapters.mapIndexed { i, ch ->
            val end = starts.getOrNull(i + 1) ?: doc.paragraphs.size
            val paras = doc.paragraphs.subList(starts[i], end)
            Doc("${(i + 1).toString().padStart(width, '0')} ${ch.title}".take(90), paras, emptyList(), doc.key, doc.author, pages = 0)
                .also { it.lang = doc.lang }
        }.filter { it.paragraphs.isNotEmpty() }
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
                        bytesOut = partBytes + w.bytesWritten
                    }
                    val pct = (i + 1) * 100 / chunks.size
                    update {
                        progress = overall(pct)
                        message = progressMessage(progress)
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

    private suspend fun exportEdge(context: Context, doc: Doc, v: Voicing, speed: Float): Pair<Uri, String> {
        val voice = v.voiceId.removePrefix(Speaker.EDGE)
        // Each request is one round trip of at most ~1100 characters (the service
        // renders long text piece by piece anyway), and several run at once.
        val chunks = group(doc.paragraphs.flatMap { TextCleaner.pieces(it, 1100, 1100) }, 1100)
        val rate = Speaker.ratePercent(speed)
        val out = createOutput(context, doc.title, "mp3", "audio/mpeg")
        var ok = false
        try {
            ParcelFileDescriptor.AutoCloseOutputStream(out.pfd).buffered().use { os ->
                tags?.let { os.write(Id3.tag(it)) }
                coroutineScope {
                    // Keep up to 8 requests in flight, writing results in order.
                    val inFlight = ArrayDeque<kotlinx.coroutines.Deferred<ByteArray>>()
                    var next = 0
                    var written = 0
                    var lastPct = -1
                    while (written < chunks.size) {
                        while (inFlight.size < 6 && next < chunks.size) {
                            val text = chunks[next++]
                            inFlight.addLast(async(Dispatchers.IO) {
                                if (v.dialogue != null) synthVoicing(context, v, speed, text) else synthEdge(text, voice, rate, v.pitch)
                            })
                        }
                        val part = inFlight.removeFirst().await()
                        os.write(part)
                        bytesOut += part.size
                        written++
                        val pct = written * 100 / chunks.size
                        if (pct != lastPct) {
                            lastPct = pct
                            update {
                                progress = overall(pct)
                                message = progressMessage(progress)
                            }
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

    private suspend fun exportLocal(context: Context, doc: Doc, v: Voicing, speed: Float): Pair<Uri, String> {
        LocalTts.missing(v.voiceId)?.let { error("Download the ${it.title} first") }
        val es = Renderer.engineSpeed(v, speed)
        val out = createOutput(context, doc.title, "m4a", "audio/mp4")
        var writer: AacWriter? = null
        var ok = false
        try {
            for ((i, text) in doc.paragraphs.withIndex()) {
                coroutineContext.ensureActive()
                val pcm = if (v.dialogue != null) {
                    LocalTts.readWav(File(synthVoicingFile(context, v, speed, text)))
                } else {
                    withContext(Renderer.localThread) { LocalTts.synthesize(v.voiceId, text, es, v.lang) }
                }
                if (writer != null && pcm.sampleRate != writer!!.sampleRate) error("Voice changed audio format mid-way")
                val w = writer ?: AacWriter(out.pfd.fileDescriptor, pcm.sampleRate, 1).also { writer = it }
                w.writePcm(pcm.bytes, pcm.bytes.size)
                bytesOut = partBytes + w.bytesWritten
                val pct = (i + 1) * 100 / doc.paragraphs.size
                if (overall(pct) != progress) {
                    update {
                        progress = overall(pct)
                        message = progressMessage(progress)
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

    private suspend fun synthEdge(text: String, voice: String, rate: Int, pitch: Int): ByteArray {
        var wait = 2_000L
        repeat(3) {
            try {
                return EdgeTts.synthesize(text, voice, rate, pitch)
            } catch (e: IOException) {
                delay(wait)
                wait *= 2
            }
        }
        return EdgeTts.synthesize(text, voice, rate, pitch) // last try; its error is reported
    }

    /** Two-voice stories: renders through [Renderer], which splits narration and dialogue. */
    private suspend fun synthVoicingFile(context: Context, v: Voicing, speed: Float, text: String): String {
        var wait = 2_000L
        repeat(3) {
            try {
                return Renderer.render(context, v, speed, text).path
            } catch (e: IOException) {
                delay(wait)
                wait *= 2
            }
        }
        return Renderer.render(context, v, speed, text).path
    }

    private suspend fun synthVoicing(context: Context, v: Voicing, speed: Float, text: String): ByteArray =
        File(synthVoicingFile(context, v, speed, text)).readBytes()

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
                put(MediaStore.Audio.Media.RELATIVE_PATH, Environment.DIRECTORY_MUSIC + "/" + folder)
                put(MediaStore.Audio.Media.IS_PENDING, 1)
            }
            val collection = MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            val uri = cr.insert(collection, values) ?: error("Could not create the audio file")
            val pfd = cr.openFileDescriptor(uri, "rw") ?: error("Could not open the audio file")
            return Output(
                uri, pfd, "Music/$folder",
                commit = {
                    cr.update(uri, ContentValues().apply { put(MediaStore.Audio.Media.IS_PENDING, 0) }, null, null)
                },
                discard = { runCatching { cr.delete(uri, null, null) } },
            )
        }
        val dir = File(context.getExternalFilesDir(Environment.DIRECTORY_MUSIC), folder).apply { mkdirs() }
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
    /** Encoded bytes written to the file so far. */
    var bytesWritten = 0L
        private set
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
                        bytesWritten += info.size
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

/** Minimal ID3v2.3 tags (title, artist, album, track, cover) for saved MP3 files. */
object Id3 {
    class Info(val title: String, val artist: String?, val album: String?, val track: String?, val cover: ByteArray?)

    fun tag(info: Info): ByteArray {
        val frames = java.io.ByteArrayOutputStream()
        fun frame(id: String, body: ByteArray) {
            frames.write(id.toByteArray(Charsets.ISO_8859_1))
            frames.write(java.nio.ByteBuffer.allocate(4).putInt(body.size).array())
            frames.write(byteArrayOf(0, 0))
            frames.write(body)
        }
        // Text in UTF-16 with a byte order mark (encoding 1), which every player reads.
        fun text(id: String, value: String?) {
            if (value.isNullOrBlank()) return
            frame(id, byteArrayOf(1) + value.toByteArray(Charsets.UTF_16) + byteArrayOf(0, 0))
        }
        text("TIT2", info.title)
        text("TPE1", info.artist)
        text("TALB", info.album)
        text("TRCK", info.track)
        info.cover?.let { jpg ->
            frame("APIC", byteArrayOf(0) + "image/jpeg".toByteArray(Charsets.ISO_8859_1) + byteArrayOf(0, 3, 0) + jpg)
        }
        val body = frames.toByteArray()
        val size = body.size
        // The tag size is "syncsafe": 7 bits per byte.
        val header = byteArrayOf(
            'I'.code.toByte(), 'D'.code.toByte(), '3'.code.toByte(), 3, 0, 0,
            ((size shr 21) and 0x7f).toByte(), ((size shr 14) and 0x7f).toByte(),
            ((size shr 7) and 0x7f).toByte(), (size and 0x7f).toByte(),
        )
        return header + body
    }
}
