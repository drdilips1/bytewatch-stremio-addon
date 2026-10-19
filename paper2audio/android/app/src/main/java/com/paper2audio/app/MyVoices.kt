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
    const val MAX_SECONDS = 32
    /** How much of a recording the copying engine hears: about 10 seconds (steadier) by default. */
    const val REFERENCE_SECONDS = 10
    /** The longer sample, for a closer likeness (the engine re-reads it for every sentence). */
    const val LONG_REFERENCE_SECONDS = 30

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
        /** Recording format version; 2 = background noise removed (see [Denoise]). */
        val version: Int = 2,
        /** Set by [add] when the recording had noticeable background noise. */
        val noisy: Boolean = false,
        /** Set by [add]: what's wrong with the recording, if anything (empty = good). */
        val problems: List<String> = emptyList(),
        /** The speaker's own pause between sentences, measured from the recording (ms; 0 = not known). */
        val pause: Int = 0,
        /** Whether the recording went through the noise remover (16 kHz, duller); older voices: yes. */
        val denoised: Boolean = true,
    )

    /**
     * Ready-made voices. Luna and Bria are cloned from Kyutai's sample recordings
     * (MIT/Apache-2.0); the male voices are cloned from seed clips made with the
     * openly licensed Supertonic (MIT) and Kokoro (Apache-2.0) voices.
     */
    val BUILT_IN = (if (BuildConfig.LITE) NARRATO else emptyList()) + listOf(
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
    )

    /**
     * Narrato only (src/lite/assets/voices): friends and colleagues who agreed to lend their voice,
     * copied in Paper to Audio and shared from there. Pause and noise removal measured from each file.
     */
    val NARRATO get() = listOf(
        Voice("ava", "Ava", 0, 0f, true, "female · English", pause = 640, denoised = true),
        Voice("clara", "Clara", 0, 0f, true, "female · English", pause = 580, denoised = true),
        Voice("maya", "Maya", 0, 0f, true, "female · English", pause = 660, denoised = true),
        Voice("nora", "Hazel", 0, 0f, true, "female · English", pause = 600, denoised = true),
        Voice("rose", "Rose", 0, 0f, true, "female · English", pause = 300, denoised = true),
        Voice("leo", "Noah", 0, 0f, true, "male · English", pause = 620, denoised = false),
        Voice("owen", "Ethan", 0, 0f, true, "male · English", pause = 480, denoised = false),
        Voice("sam", "Lucas", 0, 0f, true, "male · English", pause = 680, denoised = true),
        Voice("theo", "Theo", 0, 0f, true, "male · English", pause = 680, denoised = false),
        Voice("max", "Oliver", 0, 0f, true, "male · English", pause = 520, denoised = false),
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
            Voice(
                it.getString("id"), it.getString("name"), it.optLong("created"), it.optDouble("seconds", 0.0).toFloat(),
                version = it.optInt("v", 1),
                pause = it.optInt("pause", 0),
                denoised = it.optBoolean("dn", true),
            )
        }.filter { File(dir, "${it.id}.wav").exists() }
    }

    fun get(id: String) = list().firstOrNull { it.id == id }

    // ---- Reading pace: copied voices speak as fast as the person recorded; bring them to a normal pace ----

    /** A normal audiobook pace: about 150 words a minute, in characters a second. */
    private const val NORMAL_PACE = 14.0

    private val pacePrefs get() = app.getSharedPreferences("p2a", Context.MODE_PRIVATE)

    /** Notes how fast copied voice [id] read a sentence (averaged over the sentences it makes). */
    fun recordPace(id: String, chars: Int, seconds: Double) {
        if (!::app.isInitialized || chars < 25 || seconds < 1.0) return
        val now = chars / seconds
        val old = pacePrefs.getFloat("pace:$id", -1f)
        val avg = if (old < 0f) now else old * 0.85 + now * 0.15
        pacePrefs.edit().putFloat("pace:$id", avg.toFloat()).apply()
    }

    /** How fast copied voice [id] usually reads, in characters a second (null until it has been heard). */
    fun pace(id: String): Double? {
        if (!::app.isInitialized) return null
        return pacePrefs.getFloat("pace:$id", -1f).takeIf { it > 0f }?.toDouble()?.coerceIn(8.0, 22.0)
    }

    /** The playback speed that brings copied voice [id] to a normal pace (1 until it has been heard). */
    fun paceFactor(id: String): Float {
        if (!::app.isInitialized) return 1f
        val cps = pacePrefs.getFloat("pace:$id", -1f)
        if (cps <= 0f) return 1f
        // Narrato never slows a quick reader down: its readers sounded too slow at 1x (about 0.8x of how
        // they actually talk); Paper to Audio's 1x is already 1.25x quicker (Speaker.BASE_PACE).
        return (NORMAL_PACE / cps).toFloat().coerceIn(if (BuildConfig.LITE) 1f else 0.75f, 1.1f)
    }

    @Volatile
    private var pauses: Map<String, Int>? = null

    /** Whether copied voice [id]'s recording was put through the noise remover. */
    fun denoised(id: String): Boolean = (cleanedMap ?: list().associate { it.id to it.denoised }.also { cleanedMap = it })[id] ?: true

    @Volatile
    private var cleanedMap: Map<String, Boolean>? = null

    /** The measured pause between sentences of cloned voice [id] (ms), or 0. */
    fun pauseOf(id: String): Int = (pauses ?: list().associate { it.id to it.pause }.also { pauses = it })[id] ?: 0

    private fun save(voices: List<Voice>) {
        pauses = null
        cleanedMap = null
        val arr = JSONArray()
        voices.forEach {
            arr.put(JSONObject().put("id", it.id).put("name", it.name).put("created", it.created).put("seconds", it.seconds.toDouble()).put("v", it.version).put("pause", it.pause).put("dn", it.denoised))
        }
        index.writeText(arr.toString())
    }

    /** Stores a new voice from raw mono samples; throws with an explanation when the recording is unusable. */
    fun add(name: String, samples: FloatArray, sampleRate: Int, sampleSeconds: Int = REFERENCE_SECONDS): Voice {
        // A long clip (an audiobook sample, a talk): use its best 20 seconds of steady speech,
        // not the start, which is often an intro, credits or music.
        // The engine hears 10 seconds: keep the best stretch of the clip (with a little to spare for trimming).
        val raw = bestWindow(resample(samples, sampleRate, RATE), RATE, seconds = sampleSeconds + 2)
        if (clean(raw).size < MIN_SECONDS * RATE) {
            val seconds = clean(raw).size / RATE.toFloat()
            error("That recording has only ${"%.0f".format(seconds)} seconds of speech. Record at least $MIN_SECONDS seconds (10–20 is best).")
        }
        val ratio = Denoise.noiseRatio(raw)
        val noisy = ratio > 0.12f
        // Any hiss in the sample is copied into every sentence, so the noise remover runs on all but
        // truly studio-clean clips (it dulls the voice slightly, which is the lesser evil).
        // The noise remover works at 16 kHz and takes away the brightness that makes a voice recognisable,
        // so only clearly noisy recordings go through it; light hiss is handled when the copy reads.
        val denoise = ratio > 0.05f
        val cleaned = if (denoise) Denoise.speech(app, raw, RATE) else Denoise.highPass(raw, RATE)
        // The speaker's rhythm: how long they pause between sentences.
        val pause = sentencePause(cleaned, RATE)
        // Only real hesitations (over 0.7 s) are shortened: the speaker's normal pauses are their
        // rhythm, and squeezing them out made the copy hurry.
        val clean = clean(tightenSilences(cleaned, RATE, maxMs = 700))
        val seconds = clean.size / RATE.toFloat()
        if (seconds < MIN_SECONDS) error("That recording has only ${"%.0f".format(seconds)} seconds of clear speech. Record at least $MIN_SECONDS seconds (10–20 is best) in a quiet room.")
        val id = java.util.UUID.randomUUID().toString().take(8)
        writeRef(File(dir, "$id.wav"), clean)
        val voice = Voice(id, name.trim().ifBlank { "My voice" }, System.currentTimeMillis(), seconds, pause = pause, denoised = denoise)
        save(own() + voice)
        return voice.copy(noisy = noisy, problems = problems(raw, RATE, ratio, seconds))
    }

    /**
     * What in a recording will make a poor copy, in plain words: background noise, distortion
     * (too close or too loud), too quiet, too short, or long silences / several voices.
     */
    internal fun problems(x: FloatArray, rate: Int, noise: Float, seconds: Float): List<String> {
        val out = ArrayList<String>()
        if (noise > 0.12f) out += "a lot of background noise (fan, traffic, TV or music)"
        else if (noise > 0.05f) out += "some background noise"
        val clipped = x.count { abs(it) > 0.98f }
        if (clipped > x.size / 2000) out += "distortion: the voice was too loud or too close to the microphone"
        val e = frames(x, rate)
        val v = voiced(e)
        val speech = e.filterIndexed { i, _ -> v[i] }
        if (speech.isNotEmpty() && speech.sorted()[speech.size / 2] < 0.02f) out += "the voice is very quiet (move closer, or speak up)"
        if (seconds < 8f) out += "only ${"%.0f".format(seconds)} seconds of clear speech (10 or more is best)"
        if (v.isNotEmpty() && v.count { it } < v.size * 0.45) out += "long silences or gaps in the speech"
        return out
    }

    /** Loudness of each 20 ms frame. */
    private fun frames(x: FloatArray, rate: Int): FloatArray {
        val frame = rate / 50
        return FloatArray(x.size / frame) { f ->
            var s = 0.0
            for (i in f * frame until (f + 1) * frame) s += x[i] * x[i]
            sqrt(s / frame).toFloat()
        }
    }

    /** Which 20 ms frames are speech (above a level set by the loud parts of the clip). */
    private fun voiced(e: FloatArray): BooleanArray {
        if (e.isEmpty()) return BooleanArray(0)
        val loud = e.sorted()[(e.size * 0.9).toInt().coerceAtMost(e.size - 1)]
        val threshold = maxOf(loud * 0.08f, 0.003f)
        return BooleanArray(e.size) { e[it] > threshold }
    }

    /**
     * The best [seconds]-long stretch of a longer recording: mostly speech, without long gaps,
     * and with a clear difference between speech and the quiet between words (music under the
     * voice blurs that). Clips that are short enough come back as they are.
     */
    internal fun bestWindow(x: FloatArray, rate: Int, seconds: Int = 20): FloatArray {
        val win = seconds * 50
        val e = frames(x, rate)
        if (e.size <= win + 50) return x
        val v = voiced(e)
        // Long recordings often open with an introduction: skip the first 10 seconds of those.
        val from = if (e.size > 60 * 50) 10 * 50 else 0
        var best = from
        var bestScore = -1.0
        var start = from
        while (start + win <= e.size) {
            var speech = 0
            var gap = 0
            var longest = 0
            var loudSum = 0.0
            var quietSum = 0.0
            var quietN = 0
            for (i in start until start + win) {
                if (v[i]) {
                    speech++
                    loudSum += e[i]
                    gap = 0
                } else {
                    quietSum += e[i]
                    quietN++
                    gap++
                    longest = maxOf(longest, gap)
                }
            }
            val ratio = speech.toDouble() / win
            val contrast = if (speech == 0) 0.0 else {
                val loud = loudSum / speech
                val quiet = if (quietN == 0) loud * 0.05 else quietSum / quietN
                (loud / (quiet + 1e-5)).coerceAtMost(60.0) / 60.0
            }
            // Mostly speech (but some natural pauses), no gap over 1.5 s, clean background.
            val score = minOf(ratio, 0.85) + 0.5 * contrast - if (longest > 75) 0.5 else 0.0
            if (score > bestScore) {
                bestScore = score
                best = start
            }
            start += 50
        }
        val frame = rate / 50
        return x.copyOfRange(best * frame, minOf(x.size, (best + win) * frame))
    }

    /**
     * The speaker's usual pause between sentences (ms), from the gaps in the recording: gaps of
     * 0.3–2 s are sentence and phrase breaks; their median is the speaker's rhythm. 0 when unsure.
     */
    internal fun sentencePause(x: FloatArray, rate: Int): Int {
        val v = voiced(frames(x, rate))
        val gaps = ArrayList<Int>()
        var run = 0
        var spoke = false
        for (f in v) {
            if (f) {
                if (spoke && run in 15..100) gaps += run * 20
                run = 0
                spoke = true
            } else run++
        }
        if (gaps.size < 2) return 0
        return gaps.sorted()[gaps.size / 2].coerceIn(200, 900)
    }

    /** Shortens every silence longer than [maxMs] to [maxMs] (the engine copies hesitation too). */
    internal fun tightenSilences(x: FloatArray, rate: Int, maxMs: Int = 300): FloatArray {
        val frame = rate / 50
        val v = voiced(frames(x, rate))
        val keep = maxMs / 20
        val out = FloatBuf()
        var run = 0
        for ((f, speech) in v.withIndex()) {
            run = if (speech) 0 else run + 1
            if (run <= keep) for (i in f * frame until (f + 1) * frame) out.add(x[i])
        }
        for (i in v.size * frame until x.size) out.add(x[i])
        return out.toArray()
    }

    private fun writeRef(file: File, x: FloatArray) {
        val pcm = ByteArray(x.size * 2)
        x.forEachIndexed { i, f ->
            val v = (f.coerceIn(-1f, 1f) * 32767f).toInt()
            pcm[2 * i] = (v and 0xff).toByte()
            pcm[2 * i + 1] = ((v shr 8) and 0xff).toByte()
        }
        val tmp = File(file.path + ".part")
        LocalTts.writeWav(tmp, LocalTts.Pcm(pcm, RATE))
        if (!tmp.renameTo(file)) error("Couldn't save the voice")
    }

    /** Voices cloned by older versions kept their background noise: clean them once. */
    private fun upgrade(id: String, f: File) {
        val voice = own().firstOrNull { it.id == id } ?: return
        if (voice.version >= 2) return
        runCatching {
            val pcm = LocalTts.readWav(f)
            val buf = java.nio.ByteBuffer.wrap(pcm.bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
            val x = resample(FloatArray(buf.remaining()) { buf.get(it) / 32768f }, pcm.sampleRate, RATE)
            val clean = clean(Denoise.speech(app, x, RATE))
            if (clean.size >= MIN_SECONDS * RATE) writeRef(f, clean)
        }
        save(own().map { if (it.id == id) it.copy(version = 2) else it })
    }

    fun rename(id: String, name: String) = save(own().map { if (it.id == id) it.copy(name = name.trim().ifBlank { it.name }) else it })

    fun delete(id: String) {
        if (::app.isInitialized) pacePrefs.edit().remove("pace:$id").apply()
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
            upgrade(id, f)
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
        // A seed clip (mp3), or a voice copied in Paper to Audio and shared from there (wav, already cleaned).
        val asset = listOf("voices/$id.mp3", "voices/$id.wav").first { name -> runCatching { app.assets.openFd(name).close() }.isSuccess }
        val ref = app.assets.openFd(asset).use { afd ->
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

    fun decode(context: Context, uri: Uri, maxSeconds: Int = 150): Ref =
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
class VoiceRecorder(private val maxSeconds: Int = MyVoices.MAX_SECONDS + 5, private val onLevel: (Float, Float) -> Unit) {
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
                    if (samples.size >= maxSeconds * rate) running = false
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
