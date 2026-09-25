package com.paper2audio.app

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

    fun supertonicVoice(name: String) = SUPERTONIC_VOICES.firstOrNull { it.name == name }

    /** Fastest speed each engine renders itself; the player speeds up beyond it. */
    fun maxSpeed(voiceId: String) = if (voiceId.startsWith(Speaker.CLONE)) 1.0f else 2.0f

    class Pcm(val bytes: ByteArray, val sampleRate: Int)

    private val lock = Any()
    private var engine: OfflineTts? = null
    private var engineKey: String? = null

    fun release() = synchronized(lock) {
        engine?.release()
        engine = null
        engineKey = null
    }

    /** Loads the model for [voiceId] without generating anything, so Play starts quickly. */
    fun prepare(voiceId: String) = synchronized(lock) { engineFor(voiceId) }

    /** Generates [text] as 16-bit PCM. [lang] is the document's language (Supertonic). */
    fun synthesize(voiceId: String, text: String, speed: Float, lang: String?): Pcm = synchronized(lock) {
        missing(voiceId)?.let { error("Download the ${it.title} first") }
        val tts = engineFor(voiceId)
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
                    GenerationConfig(sid = v.sid, speed = speed, numSteps = 8, extra = mapOf("lang" to code)),
                )
            }
            else -> {
                val ref = MyVoices.reference(name) ?: error("That voice was deleted")
                tts.generateWithConfig(
                    text,
                    GenerationConfig(
                        referenceAudio = ref.samples,
                        referenceSampleRate = ref.sampleRate,
                        numSteps = 5,
                        extra = mapOf("temperature" to "0.7", "chunk_size" to "15"),
                    ),
                )
            }
        }
        if (audio.samples.isEmpty()) error("The voice produced no audio")
        Pcm(toPcm16(audio.samples), audio.sampleRate)
    }

    private fun engineFor(voiceId: String): OfflineTts {
        val key = when {
            voiceId.startsWith(Speaker.KOKORO) -> if (Kokoro.voice(voiceId.substringAfter(':'))?.british == true) "kokoro-gb" else "kokoro-us"
            voiceId.startsWith(Speaker.SUPER) -> "supertonic"
            else -> "pocket"
        }
        engine?.let { if (engineKey == key) return it }
        engine?.release()
        engine = null
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
        return OfflineTts(config = OfflineTtsConfig(model = model)).also {
            engine = it
            engineKey = key
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

    /** Reads a 16-bit mono WAV written by [writeWav]. */
    fun readWav(file: File): Pcm {
        val info = WavInfo.read(file)
        val bytes = ByteArray(info.dataSize.toInt())
        java.io.RandomAccessFile(file, "r").use { it.seek(info.dataOffset); it.readFully(bytes) }
        return Pcm(bytes, info.sampleRate)
    }
}
