package com.paper2audio.app

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaRecorder
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.sqrt

/**
 * Voices cloned from a short recording, spoken by the Pocket TTS engine.
 * Each voice is its reference recording (a cleaned-up 24 kHz WAV) kept on the phone.
 */
object MyVoices {
    const val RATE = 24_000
    const val MIN_SECONDS = 4
    const val MAX_SECONDS = 25

    /** Read aloud when recording a new voice: about 20 seconds of varied, natural speech. */
    const val SCRIPT = "The old lighthouse stood at the edge of the cliff, watching over the harbor. " +
        "Every evening, just before sunset, I would walk up the winding path to see the boats come home. " +
        "Some nights the sea was calm and silver; other nights, the wind howled and the waves crashed below. " +
        "Honestly, I think those stormy evenings were my favorite."

    data class Voice(
        val id: String,
        val name: String,
        val created: Long,
        val seconds: Float,
        /** Ready-made voices that come with the app (a short seed recording in assets/voices). */
        val builtIn: Boolean = false,
        val description: String = "",
    )

    /**
     * Ready-made voices. Luna and Bria are cloned from Kyutai's sample recordings
     * (MIT/Apache-2.0); the male voices are cloned from seed clips made with the
     * openly licensed Supertonic (MIT) and Kokoro (Apache-2.0) voices.
     */
    val BUILT_IN = listOf(
        Voice("luna", "Luna", 0, 0f, true, "female · US"),
        Voice("bria", "Bria", 0, 0f, true, "female · US"),
        Voice("carter", "Carter", 0, 0f, true, "male · US"),
        Voice("declan", "Declan", 0, 0f, true, "male · US, deep"),
        Voice("elliot", "Elliot", 0, 0f, true, "male · US, deep"),
        Voice("felix", "Felix", 0, 0f, true, "male · US"),
        Voice("grant", "Grant", 0, 0f, true, "male · US, deep"),
        Voice("hugo", "Hugo", 0, 0f, true, "male · US"),
        Voice("ian", "Ian", 0, 0f, true, "male · US, lighter"),
        Voice("james", "James", 0, 0f, true, "male · British"),
        Voice("kit", "Kit", 0, 0f, true, "male · British"),
    )

    class Ref(val samples: FloatArray, val sampleRate: Int)

    private lateinit var app: Context
    private val cache = HashMap<String, Ref>()

    fun init(context: Context) {
        app = context.applicationContext
    }

    private val dir: File get() = File(app.filesDir, "myvoices").apply { mkdirs() }
    private val index: File get() = File(dir, "voices.json")

    /** The ready-made voices, then the user's own. */
    fun list(): List<Voice> = BUILT_IN + own()

    /** Voices the user cloned. */
    fun own(): List<Voice> {
        if (!::app.isInitialized || !index.exists()) return emptyList()
        val arr = runCatching { JSONArray(index.readText()) }.getOrNull() ?: return emptyList()
        return (0 until arr.length()).map { arr.getJSONObject(it) }.map {
            Voice(it.getString("id"), it.getString("name"), it.optLong("created"), it.optDouble("seconds", 0.0).toFloat())
        }.filter { File(dir, "${it.id}.wav").exists() }
    }

    fun get(id: String) = list().firstOrNull { it.id == id }

    private fun save(voices: List<Voice>) {
        val arr = JSONArray()
        voices.forEach { arr.put(JSONObject().put("id", it.id).put("name", it.name).put("created", it.created).put("seconds", it.seconds.toDouble())) }
        index.writeText(arr.toString())
    }

    /** Stores a new voice from raw mono samples; throws with an explanation when the recording is unusable. */
    fun add(name: String, samples: FloatArray, sampleRate: Int): Voice {
        val clean = clean(resample(samples, sampleRate, RATE))
        val seconds = clean.size / RATE.toFloat()
        if (seconds < MIN_SECONDS) error("That recording has only ${"%.0f".format(seconds)} seconds of speech. Record at least $MIN_SECONDS seconds (10–20 is best).")
        val id = java.util.UUID.randomUUID().toString().take(8)
        val pcm = ByteArray(clean.size * 2)
        clean.forEachIndexed { i, f ->
            val v = (f.coerceIn(-1f, 1f) * 32767f).toInt()
            pcm[2 * i] = (v and 0xff).toByte()
            pcm[2 * i + 1] = ((v shr 8) and 0xff).toByte()
        }
        LocalTts.writeWav(File(dir, "$id.wav"), LocalTts.Pcm(pcm, RATE))
        val voice = Voice(id, name.trim().ifBlank { "My voice" }, System.currentTimeMillis(), seconds)
        save(own() + voice)
        return voice
    }

    fun rename(id: String, name: String) = save(own().map { if (it.id == id) it.copy(name = name.trim().ifBlank { it.name }) else it })

    fun delete(id: String) {
        synchronized(cache) { cache.remove(id) }
        File(dir, "$id.wav").delete()
        save(own().filter { it.id != id })
    }

    fun referenceFile(id: String) = File(dir, "$id.wav")

    /** The reference recording as float samples, for the engine. */
    fun reference(id: String): Ref? = synchronized(cache) {
        cache[id] ?: run {
            val f = File(dir, "$id.wav")
            if (!f.exists() && BUILT_IN.any { it.id == id }) unpackBuiltIn(id, f)
            if (!f.exists()) return null
            val pcm = LocalTts.readWav(f)
            val buf = java.nio.ByteBuffer.wrap(pcm.bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
            val samples = FloatArray(buf.remaining()) { buf.get(it) / 32768f }
            Ref(samples, pcm.sampleRate).also { cache[id] = it }
        }
    }

    // ---- Cleaning up a recording ----

    /** Trims silence at both ends, caps the length and normalizes the loudness. */
    internal fun clean(x: FloatArray): FloatArray {
        val frame = RATE / 50 // 20 ms
        val energies = (0 until x.size / frame).map { f ->
            var s = 0.0
            for (i in f * frame until (f + 1) * frame) s += x[i] * x[i]
            sqrt(s / frame)
        }
        if (energies.isEmpty()) return FloatArray(0)
        val loud = energies.sorted()[(energies.size * 0.9).toInt().coerceAtMost(energies.size - 1)]
        val threshold = maxOf(loud * 0.08, 0.003)
        val first = energies.indexOfFirst { it > threshold }
        val last = energies.indexOfLast { it > threshold }
        if (first < 0 || last <= first) return FloatArray(0)
        val start = ((first - 10).coerceAtLeast(0)) * frame // keep 200 ms of lead-in
        val end = minOf(((last + 12) * frame), x.size, start + MAX_SECONDS * RATE)
        val out = x.copyOfRange(start, end)
        val peak = out.maxOf { abs(it) }.coerceAtLeast(1e-4f)
        val gain = (0.9f / peak).coerceAtMost(8f)
        for (i in out.indices) out[i] *= gain
        return out
    }

    internal fun resample(x: FloatArray, from: Int, to: Int): FloatArray {
        if (from == to || x.isEmpty()) return x
        val n = (x.size.toLong() * to / from).toInt()
        val ratio = from.toDouble() / to
        return FloatArray(n) { i ->
            val pos = i * ratio
            val j = pos.toInt().coerceAtMost(x.size - 1)
            val frac = (pos - j).toFloat()
            val next = x[(j + 1).coerceAtMost(x.size - 1)]
            x[j] + (next - x[j]) * frac
        }
    }

    /** Decodes a ready-made voice's seed clip once and keeps it as a 24 kHz WAV. */
    private fun unpackBuiltIn(id: String, target: File) {
        val ref = app.assets.openFd("voices/$id.mp3").use { afd ->
            decode(maxSeconds = MAX_SECONDS) { it.setDataSource(afd.fileDescriptor, afd.startOffset, afd.length) }
        }
        val x = resample(ref.samples, ref.sampleRate, RATE)
        val pcm = ByteArray(x.size * 2)
        x.forEachIndexed { i, f ->
            val v = (f.coerceIn(-1f, 1f) * 32767f).toInt()
            pcm[2 * i] = (v and 0xff).toByte()
            pcm[2 * i + 1] = ((v shr 8) and 0xff).toByte()
        }
        val tmp = File(target.path + ".part")
        LocalTts.writeWav(tmp, LocalTts.Pcm(pcm, RATE))
        tmp.renameTo(target)
    }

    // ---- Importing a recording from a file (any format Android can decode) ----

    fun decode(context: Context, uri: Uri, maxSeconds: Int = 60): Ref =
        decode(maxSeconds) { it.setDataSource(context, uri, null) }

    private fun decode(maxSeconds: Int, source: (MediaExtractor) -> Unit): Ref {
        val extractor = MediaExtractor()
        source(extractor)
        val track = (0 until extractor.trackCount).firstOrNull {
            extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
        } ?: error("No audio found in that file")
        extractor.selectTrack(track)
        val format = extractor.getTrackFormat(track)
        val codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
        codec.configure(format, null, null, 0)
        codec.start()
        var rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        val out = FloatBuf()
        val info = MediaCodec.BufferInfo()
        var inputDone = false
        var idle = 0
        try {
            while (true) {
                if (!inputDone) {
                    val idx = codec.dequeueInputBuffer(10_000)
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
                val idx = codec.dequeueOutputBuffer(info, 10_000)
                if (idx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    rate = codec.outputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                    channels = codec.outputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                } else if (idx >= 0) {
                    val buf = codec.getOutputBuffer(idx)!!.order(ByteOrder.LITTLE_ENDIAN)
                    buf.position(info.offset)
                    buf.limit(info.offset + info.size)
                    val shorts = buf.asShortBuffer()
                    while (shorts.remaining() >= channels) {
                        var sum = 0f
                        repeat(channels) { sum += shorts.get() / 32768f }
                        out.add(sum / channels)
                    }
                    codec.releaseOutputBuffer(idx, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0 || out.size > maxSeconds * rate) break
                } else if (inputDone && idx == MediaCodec.INFO_TRY_AGAIN_LATER && out.size > 0) {
                    // Some decoders never flag the end; stop once they go quiet.
                    if (++idle > 50) break
                }
            }
        } finally {
            runCatching { codec.stop() }
            codec.release()
            extractor.release()
        }
        return Ref(out.toArray(), rate)
    }
}

/** Records the microphone as mono 24 kHz samples. Needs the RECORD_AUDIO permission. */
class VoiceRecorder(private val onLevel: (Float, Float) -> Unit) {
    @Volatile
    private var running = false
    private var thread: Thread? = null
    private val samples = FloatBuf()

    @SuppressLint("MissingPermission")
    fun start() {
        val rate = MyVoices.RATE
        val min = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val rec = AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(min, rate))
        if (rec.state != AudioRecord.STATE_INITIALIZED) {
            rec.release()
            error("The microphone isn't available")
        }
        running = true
        rec.startRecording()
        thread = Thread {
            val buf = ShortArray(rate / 10)
            try {
                while (running) {
                    val n = rec.read(buf, 0, buf.size)
                    if (n <= 0) continue
                    var peak = 0f
                    synchronized(samples) {
                        for (i in 0 until n) {
                            val f = buf[i] / 32768f
                            samples.add(f)
                            peak = maxOf(peak, abs(f))
                        }
                    }
                    onLevel(peak, samples.size / rate.toFloat())
                    if (samples.size >= (MyVoices.MAX_SECONDS + 5) * rate) running = false
                }
            } finally {
                runCatching { rec.stop() }
                rec.release()
            }
        }.also { it.start() }
    }

    val isRunning get() = running

    fun stop(): FloatArray {
        running = false
        thread?.join(2000)
        return synchronized(samples) { samples.toArray() }
    }
}

/** A growable float array (no boxing, for minutes of audio samples). */
class FloatBuf {
    private var data = FloatArray(1 shl 16)
    var size = 0
        private set

    fun add(v: Float) {
        if (size == data.size) data = data.copyOf(data.size * 2)
        data[size++] = v
    }

    fun toArray(): FloatArray = data.copyOf(size)
}
