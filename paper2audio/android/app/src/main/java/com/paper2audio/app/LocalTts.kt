package com.paper2audio.app

import com.k2fsa.sherpa.onnx.GeneratedAudio
import com.k2fsa.sherpa.onnx.GenerationConfig
import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.OfflineTtsConfig
import com.k2fsa.sherpa.onnx.OfflineTtsKokoroModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsPocketModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsSupertonicModelConfig
import java.io.File

/**
 * The on-device voice engines (sherpa-onnx): Kokoro, Supertonic (31 languages)
 * and Pocket TTS (voices cloned from a recording). Only one model is kept in
 * memory at a time; calls are serialized.
 */
object LocalTts {
    val KOKORO_PACK = ModelPack(
        "kokoro", "Kokoro voices", "kokoro-multi-lang-v1_0", 350,
        required = listOf("model.onnx", "voices.bin", "tokens.txt", "lexicon-us-en.txt", "espeak-ng-data"),
        // Only what English playback needs (skips the Chinese dictionaries).
        skip = { it.startsWith("dict/") || it.endsWith(".fst") || it == "lexicon-zh.txt" },
    )
    val SUPERTONIC_PACK = ModelPack(
        "supertonic", "Supertonic voices", "sherpa-onnx-supertonic-3-tts-int8-2026-05-11", 129,
        required = listOf(
            "duration_predictor.int8.onnx", "text_encoder.int8.onnx", "vector_estimator.int8.onnx",
            "vocoder.int8.onnx", "tts.json", "unicode_indexer.bin", "voice.bin",
        ),
    )
    val POCKET_PACK = ModelPack(
        "pocket", "voice cloning engine", "sherpa-onnx-pocket-tts-int8-2026-01-26", 98,
        required = listOf(
            "lm_flow.int8.onnx", "lm_main.int8.onnx", "encoder.onnx", "decoder.int8.onnx",
            "text_conditioner.onnx", "vocab.json", "token_scores.json",
        ),
        skip = { it.startsWith("test_wavs/") },
    )
    val PACKS = listOf(KOKORO_PACK, SUPERTONIC_PACK, POCKET_PACK)

    /** Supertonic 3's ten built-in voices; sid is the style index in voice.bin. */
    data class SVoice(val name: String, val sid: Int, val label: String)

    val SUPERTONIC_VOICES = (1..5).map { SVoice("F$it", it - 1, "Supertonic female $it") } +
        (1..5).map { SVoice("M$it", it + 4, "Supertonic male $it") }

    /** Languages Supertonic 3 reads; others fall back to English. */
    val SUPERTONIC_LANGS = setOf(
        "en", "ko", "ja", "ar", "bg", "cs", "da", "de", "el", "es", "et", "fi", "fr", "hi", "hr", "hu",
        "id", "it", "lt", "lv", "nl", "pl", "pt", "ro", "ru", "sk", "sl", "sv", "tr", "uk", "vi",
    )

    /** False on the rare phones (32-bit or x86) the bundled engine doesn't support. */
    val supported: Boolean by lazy {
        try {
            Class.forName("com.k2fsa.sherpa.onnx.OfflineTts") // loads libsherpa-onnx-jni.so
            true
        } catch (e: Throwable) {
            AppLog.e("Engine", "On-device engine unavailable", e)
            false
        }
    }

    fun isLocal(voiceId: String) = voiceId.startsWith(Speaker.KOKORO) || voiceId.startsWith(Speaker.SUPER) ||
        voiceId.startsWith(Speaker.CLONE)

    fun packFor(voiceId: String): ModelPack? = when {
        voiceId.startsWith(Speaker.KOKORO) -> KOKORO_PACK
        voiceId.startsWith(Speaker.SUPER) -> SUPERTONIC_PACK
        voiceId.startsWith(Speaker.CLONE) -> POCKET_PACK
        else -> null
    }

    /** The model [voiceId] still needs to download, if any. */
    fun missing(voiceId: String): ModelPack? = packFor(voiceId)?.takeUnless { it.isInstalled() }

    /** A fixed random seed for each voice, so every sentence is the same take on it. */
    private fun seedFor(voiceId: String) = (voiceId.hashCode() and 0x7fffffff) % 100_000 + 1

    /**
     * Supertonic speaks quickly at its 1x. Asked to go much slower, it stretches words until
     * syllables repeat ("val-au-au-ling", "She she"), so it only slows a little itself
     * ([SUPERTONIC_PACE]) and the player does the rest ([SUPERTONIC_PLAYBACK], pitch kept):
     * about 0.83 of its 1x together, the pace the app calls normal.
     */
    const val SUPERTONIC_PACE = 0.95f
    const val SUPERTONIC_PLAYBACK = 0.87f

    fun supertonicVoice(name: String) = SUPERTONIC_VOICES.firstOrNull { it.name == name }

    /** Fastest speed each engine renders itself; the player speeds up beyond it. */
    fun maxSpeed(voiceId: String) = if (voiceId.startsWith(Speaker.CLONE)) 1.0f else 2.0f

    class Pcm(val bytes: ByteArray, val sampleRate: Int)

    private val lock = Any()
    /** Loaded models, most recently used last. Phones with plenty of memory keep two, so switching back is instant. */
    private val engines = LinkedHashMap<String, OfflineTts>()

    private val keepEngines: Int by lazy {
        val totalKb = runCatching {
            java.io.File("/proc/meminfo").readLines().first { it.startsWith("MemTotal") }.filter { it.isDigit() }.toLong()
        }.getOrDefault(0L)
        if (totalKb >= 5_500_000L) 2 else 1
    }

    /**
     * A second copy of the model, used only for saving audiobooks, so saving doesn't queue behind
     * listening and the two halves of the book are made side by side. Only on phones with plenty
     * of memory (the same ones that keep two models).
     */
    private val spareLock = Any()
    private var spare: Pair<String, OfflineTts>? = null
    val hasSpare: Boolean get() = keepEngines >= 2

    fun releaseSpare() = synchronized(spareLock) {
        spare?.second?.release()
        spare = null
    }

    fun release() {
        synchronized(lock) {
            engines.values.forEach { it.release() }
            engines.clear()
        }
        releaseSpare()
    }

    /** Loads the model for [voiceId] without generating anything, so Play starts quickly. */
    fun prepare(voiceId: String) = synchronized(lock) { engineFor(voiceId) }

    /** Generates [text] as 16-bit PCM. [lang] is the document's language (Supertonic). */
    fun synthesize(voiceId: String, text: String, speed: Float, lang: String?, useSpare: Boolean = false): Pcm =
        if (useSpare && hasSpare) synchronized(spareLock) {
            val key = engineKey(voiceId)
            val tts = spare?.takeIf { it.first == key }?.second ?: run {
                spare?.second?.release()
                newEngine(key).also { spare = key to it }
            }
            generate(tts, voiceId, text, speed, lang)
        } else synchronized(lock) { generate(engineFor(voiceId), voiceId, text, speed, lang) }

    private fun generate(tts: OfflineTts, voiceId: String, text: String, speed: Float, lang: String?): Pcm {
        missing(voiceId)?.let { error("Download the ${it.title} first") }
        val name = voiceId.substringAfter(':')
        val audio = when {
            voiceId.startsWith(Speaker.KOKORO) -> {
                val v = Kokoro.voice(name) ?: error("Unknown Kokoro voice")
                tts.generate(text, sid = v.sid, speed = speed)
            }
            voiceId.startsWith(Speaker.SUPER) -> {
                val v = supertonicVoice(name) ?: error("Unknown Supertonic voice")
                val code = lang?.takeIf { it in SUPERTONIC_LANGS } ?: "en"
                tts.generateWithConfig(
                    text,
                    // Supertonic's own 1x is brisk: "normal" is a calmer reading pace.
                    GenerationConfig(
                        sid = v.sid, speed = speed * SUPERTONIC_PACE, numSteps = 6,
                        // Pauses inside a sentence at their natural length (the engine's default shrinks them to a fifth).
                        silenceScale = 1f,
                        // The same "take" on the voice for every sentence, instead of fresh random variation each time.
                        extra = mapOf("lang" to code, "seed" to seedFor(voiceId).toString()),
                    ),
                )
            }
            else -> {
                val ref = MyVoices.reference(name) ?: error("That voice was deleted")
                // The sample must end on exactly 80 ms of silence, as the engine was trained: ending on speech
                // makes it continue that word, and a long silence (the 0.4 s added before) swallows the
                // first sound of every sentence ("ello" for "Hello").
                val room = MyVoices.LONG_REFERENCE_SECONDS * ref.sampleRate - ref.sampleRate / 10
                val lead = CloneCheck.endOnPause(ref.samples.copyOf(minOf(ref.samples.size, room)), ref.sampleRate)
                // The engine hears the whole stored sample (about 10 s, or 30 s for a "longer sample" voice).
                val hears = (lead.size + ref.sampleRate - 1) / ref.sampleRate
                val spoken = CloneCheck.prepareText(TextCleaner.endSentence(text))
                fun gen(say: String, seed: Int, extraFrames: Int = 0) = tts.generateWithConfig(
                    say,
                    GenerationConfig(
                        referenceAudio = lead,
                        referenceSampleRate = ref.sampleRate,
                        numSteps = 5,
                        silenceScale = 1f,
                        extra = mapOf(
                            // One fixed seed per voice: the same person on every line.
                            "seed" to seed.toString(),
                            // The model is made for about 10 seconds of reference; a "longer sample" voice
                            // keeps 30 for a closer likeness.
                            "max_reference_audio_len" to "$hears",
                            // A little below the engine's usual 0.7: steadier from sentence to sentence; lower
                            // than this made it skip words.
                            "temperature" to "0.6",
                            "chunk_size" to "15",
                            // Stops a sentence whose end the model misses from running on as babble.
                            "max_frames" to (maxFrames(spoken.trim()) + extraFrames).toString(),
                            "frames_after_eos" to "2",
                        ),
                    ),
                )
                // The engine fumbles the very start of what it says ("ello" for "Hello"). So it first says a
                // throwaway "Well." and that is cut off at the pause after it: the sentence's own first word
                // comes out whole. If no clear pause is found, the sentence is made the plain way.
                fun take(seed: Int): GeneratedAudio {
                    val led = gen(" ".repeat(8) + "Well. " + spoken.trim(), seed, extraFrames = 12)
                    val cut = CloneCheck.afterLeadIn(led.samples, led.sampleRate)
                    return if (cut != null) GeneratedAudio(led.samples.copyOfRange(cut, led.samples.size), led.sampleRate)
                    else gen(spoken, seed)
                }
                val seed = seedFor(voiceId)
                val first = take(seed)
                // Far too long or too short for its words means the model lost its way (mumbling or
                // skipping): make it once more with another take, and keep the more plausible one.
                if (CloneCheck.plausible(first.samples.size.toDouble() / first.sampleRate, spoken.trim())) first
                else take(seed + 7919).let { second ->
                    val d1 = CloneCheck.distance(first.samples.size.toDouble() / first.sampleRate, spoken.trim())
                    val d2 = CloneCheck.distance(second.samples.size.toDouble() / second.sampleRate, spoken.trim())
                    if (d2 < d1) second else first
                }
            }
        }
        if (audio.samples.isEmpty()) error("The voice produced no audio")
        val samples = if (voiceId.startsWith(Speaker.CLONE)) {
            // Copied voices: cut any run-on, then clean the hiss the copy picked up from its recording.
            CloneCheck.dehiss(RunOn.trim(audio.samples, audio.sampleRate, text), audio.sampleRate).also {
                MyVoices.recordPace(voiceId.substringAfter(':'), text.length, it.size.toDouble() / audio.sampleRate)
            }
        } else audio.samples
        return Pcm(toPcm16(samples), audio.sampleRate)
    }

    // Room for a slow, unhurried speaker (about 11 characters a second) plus a breath.
    internal fun maxFrames(text: String) = (text.length * 1.15 + 15).toInt().coerceIn(25, 400)


    private fun engineKey(voiceId: String) = when {
        voiceId.startsWith(Speaker.KOKORO) -> if (Kokoro.voice(voiceId.substringAfter(':'))?.british == true) "kokoro-gb" else "kokoro-us"
        voiceId.startsWith(Speaker.SUPER) -> "supertonic"
        else -> "pocket"
    }

    private fun engineFor(voiceId: String): OfflineTts {
        val key = engineKey(voiceId)
        engines.remove(key)?.let { engines[key] = it; return it }
        while (engines.size >= keepEngines) {
            val oldest = engines.keys.first()
            engines.remove(oldest)?.release()
        }
        return newEngine(key).also { engines[key] = it }
    }

    private fun newEngine(key: String): OfflineTts {
        val threads = Runtime.getRuntime().availableProcessors().coerceIn(2, 4)
        val model = when (key) {
            "supertonic" -> SUPERTONIC_PACK.let { p ->
                OfflineTtsModelConfig(
                    supertonic = OfflineTtsSupertonicModelConfig(
                        durationPredictor = p.file("duration_predictor.int8.onnx").path,
                        textEncoder = p.file("text_encoder.int8.onnx").path,
                        vectorEstimator = p.file("vector_estimator.int8.onnx").path,
                        vocoder = p.file("vocoder.int8.onnx").path,
                        ttsJson = p.file("tts.json").path,
                        unicodeIndexer = p.file("unicode_indexer.bin").path,
                        voiceStyle = p.file("voice.bin").path,
                    ),
                    numThreads = threads,
                )
            }
            "pocket" -> POCKET_PACK.let { p ->
                OfflineTtsModelConfig(
                    pocket = OfflineTtsPocketModelConfig(
                        lmFlow = p.file("lm_flow.int8.onnx").path,
                        lmMain = p.file("lm_main.int8.onnx").path,
                        encoder = p.file("encoder.onnx").path,
                        decoder = p.file("decoder.int8.onnx").path,
                        textConditioner = p.file("text_conditioner.onnx").path,
                        vocabJson = p.file("vocab.json").path,
                        tokenScoresJson = p.file("token_scores.json").path,
                    ),
                    numThreads = threads,
                )
            }
            else -> KOKORO_PACK.let { p ->
                val lexicon = p.file(if (key == "kokoro-gb") "lexicon-gb-en.txt" else "lexicon-us-en.txt")
                    .takeIf { it.exists() } ?: p.file("lexicon-us-en.txt")
                OfflineTtsModelConfig(
                    kokoro = OfflineTtsKokoroModelConfig(
                        model = p.file("model.onnx").path,
                        voices = p.file("voices.bin").path,
                        tokens = p.file("tokens.txt").path,
                        dataDir = p.file("espeak-ng-data").path,
                        lexicon = lexicon.path,
                    ),
                    numThreads = threads,
                )
            }
        }
        // silenceScale 1: the engines' default (0.2) shrinks every pause inside a sentence to a fifth.
        return OfflineTts(config = OfflineTtsConfig(model = model, silenceScale = 1f))
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

    /** Reads a 16-bit mono WAV written by [writeWav]. */
    fun readWav(file: File): Pcm {
        val info = WavInfo.read(file)
        val bytes = ByteArray(info.dataSize.toInt())
        java.io.RandomAccessFile(file, "r").use { it.seek(info.dataOffset); it.readFully(bytes) }
        return Pcm(bytes, info.sampleRate)
    }
}

/** Cutting off the babble a copied voice sometimes adds after a sentence. */
object RunOn {
    /**
     * Copied voices sometimes miss the end of a sentence and run on in a muffled babble. When the
     * audio is much longer than the text needs, it is cut at the quietest moment after the point
     * where the sentence should have ended.
     */
    fun trim(samples: FloatArray, rate: Int, text: String): FloatArray {
        // Only clear run-ons: well past what even a slow reader (11 characters a second) needs.
        // Cutting sooner clipped the end of real sentences.
        val expected = maxOf(1.5, text.length / 11.0)
        val seconds = samples.size.toDouble() / rate
        if (seconds <= expected * 1.5) return samples
        val frame = rate / 20 // 50 ms
        val from = (expected * 1.05 * rate).toInt() / frame
        val to = samples.size / frame
        if (to - from < 2) return samples
        val energy = DoubleArray(to) { f ->
            var e = 0.0
            for (i in f * frame until minOf(samples.size, (f + 1) * frame)) e += samples[i] * samples[i]
            e / frame
        }
        val speech = energy.sorted()[(energy.size * 0.7).toInt().coerceAtMost(energy.size - 1)]
        // The first real gap after the expected end, else the quietest moment there.
        val cut = (from until to).firstOrNull { f -> f + 1 < to && energy[f] < speech * 0.02 && energy[f + 1] < speech * 0.02 }
            ?: (from until to).minByOrNull { energy[it] }!!
        return samples.copyOf(cut * frame)
    }
}

/** Checks and clean-up for copied voices. */
object CloneCheck {
    /**
     * Ends the voice sample on exactly 80 ms of silence (the engine makers' end_on_pause): trailing
     * quiet (20 ms frames over 35 dB below the loudest) is cut, the last 20 ms faded out, 80 ms of
     * silence added.
     */
    fun endOnPause(x: FloatArray, rate: Int): FloatArray {
        val frame = maxOf(1, rate / 50)
        val n = x.size / frame
        if (n == 0) return x
        val db = DoubleArray(n) { f ->
            var s = 0.0
            for (i in f * frame until (f + 1) * frame) s += x[i] * x[i]
            20 * kotlin.math.log10(kotlin.math.sqrt(s / frame) + 1e-12)
        }
        val max = db.max()
        val lastLoud = db.indices.last { db[it] > max - 35 }
        val end = (lastLoud + 1) * frame
        val out = x.copyOf(end + rate * 8 / 100)
        val fade = minOf(rate / 50, end)
        for (k in 0 until fade) out[end - fade + k] *= 1f - k.toFloat() / fade
        for (i in end until out.size) out[i] = 0f
        return out
    }

    /**
     * Text the way the engine makers prepare it: a capital first letter, semicolons as commas, a
     * sentence mark not followed by a stray comma ("Hi?, she said" once quotes are gone), and very
     * short lines padded with spaces at the front (the model does poorly on very few tokens).
     */
    fun prepareText(t: String): String {
        var s = t.trim().replace(';', ',').replace(Regex("""([.!?\u2026])\s*[,;:]"""), "$1")
        if (s.isEmpty()) return s
        if (!s[0].isUpperCase()) s = s[0].uppercaseChar() + s.substring(1)
        if (s.split(Regex("""\s+""")).size < 5) s = " ".repeat(8) + s
        return s
    }

    /**
     * Where the sentence starts after the throwaway "Well.": the end of the first clear pause (90 ms or
     * more of quiet) between 0.15 and 1.6 s in, less 30 ms so the first sound keeps its start. Null when
     * there's no such pause (then the throwaway word can't be cut off safely).
     */
    fun afterLeadIn(x: FloatArray, rate: Int): Int? {
        val frame = rate / 100
        val n = x.size / frame
        if (n < 40) return null
        val rms = FloatArray(n) { f ->
            var s = 0.0
            for (i in f * frame until (f + 1) * frame) s += x[i] * x[i]
            kotlin.math.sqrt(s / frame).toFloat()
        }
        val loud = rms.sorted()[(n * 0.9).toInt().coerceAtMost(n - 1)]
        val onset = rms.indexOfFirst { it > loud * 0.2f }.takeIf { it >= 0 } ?: return null
        val quiet = loud * 0.06f
        var f = onset + 15
        while (f < minOf(n, 160)) {
            if (rms[f] < quiet) {
                var e = f
                while (e < n && rms[e] < quiet) e++
                if (e - f >= 9) {
                    // Speech must follow, or this was the end, not the pause after "Well."
                    val after = (e until minOf(n, e + 30)).count { rms[it] > loud * 0.2f }
                    return if (after >= 5) maxOf(0, e - 3) * frame else null
                }
                f = e
            } else f++
        }
        return null
    }

    /** Seconds a sentence should take: about 13 characters a second, plus a little. */
    private fun expected(text: String) = 0.3 + text.length / 13.0

    /** How far [seconds] is from what [text] needs, as a ratio (0 = exactly right). */
    fun distance(seconds: Double, text: String) = kotlin.math.abs(kotlin.math.ln(seconds / expected(text)))

    /**
     * Within reason for a slow or quick reader: between 60% and 175% of the expected length.
     * (45% let a sentence that stopped early, missing its last words, pass as fine.)
     */
    fun plausible(seconds: Double, text: String): Boolean {
        val r = seconds / expected(text)
        return r in 0.6..1.75
    }

    /**
     * Removes hiss: the copy was learned from a recording cleaned at 16 kHz, so anything above
     * about 7.5 kHz is noise; and the quiet moments between words, where hiss is heard most, are
     * turned down (gently, so breaths and word endings stay).
     */
    fun dehiss(x: FloatArray, rate: Int): FloatArray {
        if (x.isEmpty()) return x
        val y = if (rate > 16_000) Denoise.lowPass(x, rate, 7_500.0) else x.copyOf()
        val frame = rate / 100 // 10 ms
        val n = y.size / frame
        if (n < 5) return y
        val rms = FloatArray(n) { f ->
            var s = 0.0
            for (i in f * frame until (f + 1) * frame) s += y[i] * y[i]
            kotlin.math.sqrt(s / frame).toFloat()
        }
        val loud = rms.sorted()[(n * 0.9).toInt().coerceAtMost(n - 1)]
        // Quiet moments (under 3% of the speech level) turned down to 30%; soft sounds like the "h"
        // in "hello" come just before louder ones, and the gate opens 80 ms ahead of those.
        val floor = loud * 0.03f
        val ahead = 8
        var g = 1f
        for (f in 0 until n) {
            val soon = (f until minOf(n, f + ahead + 1)).any { rms[it] >= floor }
            val target = if (soon) 1f else 0.3f
            // Smooth: open quickly for speech, close slowly.
            g = if (target > g) target else g + (target - g) * 0.2f
            for (i in f * frame until (f + 1) * frame) y[i] *= g
        }
        return y
    }
}
