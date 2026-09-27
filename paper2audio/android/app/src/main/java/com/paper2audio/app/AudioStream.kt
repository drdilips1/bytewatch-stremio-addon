package com.paper2audio.app

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.PlaybackParams
import android.os.PowerManager
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import java.io.File
import java.nio.ByteOrder
import kotlin.coroutines.coroutineContext
import kotlin.math.abs

/**
 * One continuous audio stream for a whole listening session: every sentence is
 * decoded, trimmed of its own leading and trailing silence, and followed by a
 * pause we choose. So the voice flows like one audiobook, without the gap of
 * starting a new player for each piece. Pieces are tagged, so the UI can follow
 * what is being heard.
 */
class AudioStream(context: Context, boost: Float) {
    private class Mark(val frame: Long, val tag: Any)

    private var track: AudioTrack? = null
    private var rate = 0
    private var written = 0L
    private val marks = ArrayList<Mark>()
    @Volatile
    private var released = false
    private var paused = false
    private var boost = boost
    private val wakeLock = (context.getSystemService(Context.POWER_SERVICE) as PowerManager)
        .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "paper2audio:reading")
        .apply { setReferenceCounted(false) }

    /** Frames the listener has heard so far. */
    private val heard: Long
        get() = track?.let { it.playbackHeadPosition.toLong() and 0xffffffffL } ?: 0L

    /**
     * Queues [pcm] (mono 16-bit) followed by [pauseMs] of silence. Suspends while
     * the buffer is full, e.g. when paused. Must be called from one coroutine.
     */
    suspend fun write(pcm: Pcm16, tag: Any, pauseMs: Int) {
        val t = track ?: create(pcm.sampleRate)
        val samples = if (pcm.sampleRate == rate) pcm.samples else resample(pcm.samples, pcm.sampleRate, rate)
        synchronized(marks) { marks += Mark(written, tag) }
        push(t, samples)
        push(t, ShortArray(rate * pauseMs / 1000))
    }

    private fun create(sampleRate: Int): AudioTrack {
        rate = sampleRate
        val min = AudioTrack.getMinBufferSize(sampleRate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val t = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(sampleRate)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build()
            )
            // About a second of buffer: smooth, yet pausing and seeking stay instant.
            .setBufferSizeInBytes(maxOf(min * 2, sampleRate * 2))
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()
        track = t
        applyBoost()
        if (!paused) {
            t.play()
            wakeLock.acquire(6 * 60 * 60 * 1000L)
        }
        return t
    }

    private suspend fun push(t: AudioTrack, samples: ShortArray) {
        var off = 0
        while (off < samples.size) {
            coroutineContext.ensureActive()
            if (released) return
            val n = t.write(samples, off, samples.size - off, AudioTrack.WRITE_NON_BLOCKING)
            if (n < 0) error("Audio output error ($n)")
            off += n
            written += n
            if (n == 0) delay(25) // buffer full (playing ahead, or paused)
        }
    }

    /** The tag of the piece being heard right now. */
    fun currentTag(): Any? {
        val pos = heard
        synchronized(marks) {
            // Drop marks long past, keep the one being heard.
            while (marks.size > 1 && marks[1].frame <= pos) marks.removeAt(0)
            return marks.firstOrNull()?.takeIf { it.frame <= pos }?.tag
        }
    }

    /** Waits until everything written has been heard. */
    suspend fun drain() {
        while (!released && heard < written) delay(50)
    }

    fun pause() {
        paused = true
        track?.pause()
        if (wakeLock.isHeld) wakeLock.release()
    }

    fun resume() {
        paused = false
        track?.play()
        wakeLock.acquire(6 * 60 * 60 * 1000L)
    }

    fun setBoost(value: Float) {
        boost = value
        applyBoost()
    }

    private fun applyBoost() {
        val t = track ?: return
        runCatching { t.playbackParams = PlaybackParams().setSpeed(boost.coerceIn(0.5f, 4f)).setPitch(1f) }
    }

    fun release() {
        released = true
        track?.let {
            runCatching { it.pause() }
            runCatching { it.flush() }
            it.release()
        }
        track = null
        if (wakeLock.isHeld) wakeLock.release()
    }

    companion object {
        fun resample(x: ShortArray, from: Int, to: Int): ShortArray {
            if (from == to || x.isEmpty()) return x
            val n = (x.size.toLong() * to / from).toInt()
            val ratio = from.toDouble() / to
            return ShortArray(n) { i ->
                val pos = i * ratio
                val j = pos.toInt().coerceAtMost(x.size - 1)
                val next = x[(j + 1).coerceAtMost(x.size - 1)]
                (x[j] + (next - x[j]) * (pos - j)).toInt().toShort()
            }
        }
    }
}

/** Mono 16-bit samples. */
class Pcm16(val samples: ShortArray, val sampleRate: Int)

/** Turns rendered pieces (MP3 from online voices, WAV from on-device ones) into trimmed samples. */
object AudioDecode {
    /** Samples quieter than this (about -40 dB) count as silence at the edges. */
    private const val SILENCE = 330

    fun load(file: File): Pcm16 {
        val raw = if (file.name.endsWith(".wav")) {
            val pcm = LocalTts.readWav(file)
            val sb = java.nio.ByteBuffer.wrap(pcm.bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
            Pcm16(ShortArray(sb.remaining()).also { sb.get(it) }, pcm.sampleRate)
        } else {
            decode(file)
        }
        return trim(raw)
    }

    /** Removes silence before and after the speech, keeping a few milliseconds so words aren't clipped. */
    internal fun trim(p: Pcm16): Pcm16 {
        val s = p.samples
        var first = s.indexOfFirst { abs(it.toInt()) > SILENCE }
        var last = s.indexOfLast { abs(it.toInt()) > SILENCE }
        if (first < 0) return Pcm16(ShortArray(0), p.sampleRate)
        first = (first - p.sampleRate * 30 / 1000).coerceAtLeast(0)
        last = (last + p.sampleRate * 60 / 1000).coerceAtMost(s.size - 1)
        return Pcm16(s.copyOfRange(first, last + 1), p.sampleRate)
    }

    private fun decode(file: File): Pcm16 {
        val extractor = MediaExtractor()
        extractor.setDataSource(file.path)
        val track = (0 until extractor.trackCount).firstOrNull {
            extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
        } ?: run {
            extractor.release()
            error("No audio in ${file.name}")
        }
        extractor.selectTrack(track)
        val format = extractor.getTrackFormat(track)
        val codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
        codec.configure(format, null, null, 0)
        codec.start()
        var rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        var out = ShortArray(rate * 20)
        var size = 0
        val info = MediaCodec.BufferInfo()
        var inputDone = false
        var idle = 0
        try {
            while (true) {
                if (!inputDone) {
                    val idx = codec.dequeueInputBuffer(5_000)
                    if (idx >= 0) {
                        val buf = codec.getInputBuffer(idx)!!
                        val n = extractor.readSampleData(buf, 0)
                        if (n < 0) {
                            codec.queueInputBuffer(idx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            codec.queueInputBuffer(idx, 0, n, extractor.sampleTime, 0)
                            extractor.advance()
                        }
                    }
                }
                val idx = codec.dequeueOutputBuffer(info, 5_000)
                if (idx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    rate = codec.outputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                    channels = codec.outputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                } else if (idx >= 0) {
                    val buf = codec.getOutputBuffer(idx)!!.order(ByteOrder.LITTLE_ENDIAN)
                    buf.position(info.offset)
                    buf.limit(info.offset + info.size)
                    val shorts = buf.asShortBuffer()
                    while (shorts.remaining() >= channels) {
                        var sum = 0
                        repeat(channels) { sum += shorts.get() }
                        if (size == out.size) out = out.copyOf(out.size * 2)
                        out[size++] = (sum / channels).toShort()
                    }
                    codec.releaseOutputBuffer(idx, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
                } else if (inputDone && idx == MediaCodec.INFO_TRY_AGAIN_LATER && ++idle > 40) {
                    break // some decoders never flag the end
                }
            }
        } finally {
            runCatching { codec.stop() }
            codec.release()
            extractor.release()
        }
        return Pcm16(out.copyOf(size), rate)
    }
}
