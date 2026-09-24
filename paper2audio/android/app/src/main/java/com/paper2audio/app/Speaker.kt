package com.paper2audio.app

import android.content.Context
import android.content.SharedPreferences
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.File
import java.util.Locale
import java.util.concurrent.CopyOnWriteArraySet
import kotlin.coroutines.resume
import kotlin.math.roundToInt

/**
 * Read-aloud engine. Voices are Kokoro ("kokoro:NAME", natural, on-device after
 * a one-time download), Microsoft neural voices ("edge:NAME", natural, needs
 * internet) or the phone's own TTS voices ("sys:NAME").
 * All state changes happen on the main thread; listeners are called there too.
 */
object Speaker {
    const val EDGE = "edge:"
    const val SYSTEM = "sys:"
    const val KOKORO = "kokoro:"
    const val DEFAULT_VOICE = EDGE + "en-US-AndrewMultilingualNeural"
    private const val LOOKAHEAD = 3
    private const val PIECE_LOOKAHEAD = 4

    data class VoiceOption(val id: String, val label: String)

    private lateinit var app: Context
    private val prefs: SharedPreferences by lazy { app.getSharedPreferences("p2a", Context.MODE_PRIVATE) }
    private val main = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val listeners = CopyOnWriteArraySet<() -> Unit>()
    private val pendingReady = ArrayList<() -> Unit>()

    private var tts: TextToSpeech? = null
    private var systemReady = false
    private var initialized = false
    private var edgeVoices: List<EdgeTts.VoiceInfo> = EdgeTts.CURATED

    var doc: Doc? = null
        private set
    var index = 0
        private set
    var playing = false
        private set
    var speed = 1.0f
        private set
    var voiceId: String = DEFAULT_VOICE
        private set
    /** Set when playback stops because of an error; the UI shows it once. */
    var lastError: String? = null
    /** Increments whenever the list of available voices changes. */
    var voicesVersion = 0
        private set

    val isEdge: Boolean get() = voiceId.startsWith(EDGE)
    val isKokoro: Boolean get() = voiceId.startsWith(KOKORO)
    /** Voices played from generated audio files (true pause/resume). */
    private val isStreamed: Boolean get() = isEdge || isKokoro

    /** Kokoro runs one generation at a time; keep its work on one thread. */
    private val kokoroThread = java.util.concurrent.Executors.newSingleThreadExecutor().asCoroutineDispatcher()

    /** Bumped on every restart so callbacks from stopped audio are ignored. */
    private var generation = 0

    // Phone TTS playback state.
    private var queuedUpTo = -1

    // Kokoro / Microsoft voice playback state.
    private var session: Job? = null
    private var player: MediaPlayer? = null
    private var pausedAt = -1

    fun init(context: Context, onReady: () -> Unit) {
        if (initialized) {
            if (tts == null || systemReady) onReady() else pendingReady += onReady
            return
        }
        initialized = true
        app = context.applicationContext
        Kokoro.init(app)
        speed = prefs.getFloat("speed", 1.0f)
        voiceId = prefs.getString("voice2", null) ?: DEFAULT_VOICE
        warmUpKokoro()
        pendingReady += onReady
        tts = TextToSpeech(app) { status ->
            main.post {
                systemReady = status == TextToSpeech.SUCCESS
                if (systemReady) configureSystem()
                voicesVersion++
                pendingReady.forEach { it() }
                pendingReady.clear()
                notifyChanged()
            }
        }
        scope.launch {
            runCatching { withContext(Dispatchers.IO) { EdgeTts.listVoices() } }.onSuccess { all ->
                val curated = EdgeTts.CURATED.map { it.name }.toSet()
                edgeVoices = EdgeTts.CURATED + all.filter { it.name !in curated }.sortedBy { it.locale }
                voicesVersion++
                notifyChanged()
            }
        }
    }

    private fun configureSystem() {
        val t = tts ?: return
        t.setSpeechRate(speed)
        if (voiceId.startsWith(SYSTEM)) t.voices?.firstOrNull { it.name == voiceId.removePrefix(SYSTEM) }?.let { t.voice = it }
        t.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(id: String) {
                main.post { handleStart(id) }
            }

            override fun onDone(id: String) {
                main.post { handleDone(id) }
            }

            @Deprecated("Deprecated in Java")
            override fun onError(id: String) {
                main.post { handleDone(id) }
            }
        })
    }

    /**
     * The favorite Microsoft voices (Andrew, Ava, Thomas…), then the other
     * suggested ones, Kokoro, all remaining Microsoft voices, and phone voices.
     */
    fun voiceOptions(): List<VoiceOption> {
        val out = ArrayList<VoiceOption>()
        fun edge(v: EdgeTts.VoiceInfo, mark: String) {
            val person = v.name.substringAfterLast('-').removeSuffix("Neural").removeSuffix("Multilingual")
            val locale = Locale.forLanguageTag(v.locale).displayName
            out += VoiceOption(EDGE + v.name, "$mark $person · $locale · ${v.gender.lowercase()} (online)")
        }
        val curatedCount = EdgeTts.CURATED.size
        EdgeTts.FAVORITES.forEach { edge(it, "★") }
        edgeVoices.take(curatedCount).drop(EdgeTts.FAVORITES.size).forEach { edge(it, "•") }
        if (Kokoro.supported) {
            val note = if (Kokoro.isInstalled()) "offline" else "one-time download"
            for (v in Kokoro.VOICES) out += VoiceOption(KOKORO + v.name, "◆ ${v.label} (Kokoro, $note)")
        }
        edgeVoices.drop(curatedCount).forEach { edge(it, "•") }
        val lang = Locale.getDefault().language
        val phone = tts?.voices.orEmpty()
            .filter { TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED !in it.features }
            .sortedWith(compareBy({ it.locale.language != lang }, { it.locale.displayName }, { it.name }))
        for (v in phone) {
            val online = if (v.isNetworkConnectionRequired) ", online" else ""
            out += VoiceOption(SYSTEM + v.name, "Phone · ${v.locale.displayName} · ${v.name}$online")
        }
        // Keep the saved choice selectable even if its list hasn't loaded yet.
        if (out.none { it.id == voiceId }) out.add(0, VoiceOption(voiceId, voiceId.substringAfter(':')))
        return out
    }

    fun setVoice(id: String) {
        if (id == voiceId) return
        voiceId = id
        prefs.edit().putString("voice2", id).apply()
        if (id.startsWith(SYSTEM)) tts?.let { t -> t.voices?.firstOrNull { it.name == id.removePrefix(SYSTEM) }?.let { t.voice = it } }
        if (!playing) warmUpKokoro() // when playing, play() below renders right away anyway
        pausedAt = -1
        if (playing) play()
        notifyChanged()
    }

    /** Call after the Kokoro download finishes so the voice list updates. */
    fun refreshVoices() {
        voicesVersion++
        warmUpKokoro()
        notifyChanged()
    }

    /** Loads the Kokoro model in the background so pressing Play starts quickly. */
    private fun warmUpKokoro() {
        val v = Kokoro.voice(voiceId.removePrefix(KOKORO)) ?: return
        if (!isKokoro || !Kokoro.isInstalled()) return
        scope.launch(kokoroThread) { runCatching { Kokoro.prepare(v) } }
    }

    fun setSpeed(value: Float) {
        speed = value
        prefs.edit().putFloat("speed", value).apply()
        tts?.setSpeechRate(value)
        pausedAt = -1
        if (playing) play()
        notifyChanged()
    }

    fun load(newDoc: Doc) {
        if (playing) pause()
        stopAll()
        doc = newDoc
        index = prefs.getInt("pos:${newDoc.key}", 0).coerceIn(0, maxOf(0, newDoc.paragraphs.size - 1))
        notifyChanged()
    }

    fun play() {
        val d = doc ?: return
        if (d.paragraphs.isEmpty()) return
        if (index >= d.paragraphs.size) index = 0
        lastError = null
        if (isKokoro && !Kokoro.isInstalled()) {
            lastError = "Download the Kokoro voices first (button under the voice list), or choose a ★ voice."
            notifyChanged()
            return
        }
        if (isStreamed) {
            val p = player
            if (p != null && pausedAt == index) {
                p.start()
                pausedAt = -1
            } else {
                startStreaming()
            }
        } else {
            if (!systemReady) {
                lastError = "This phone has no working text-to-speech engine. Pick a ★ natural voice instead."
                notifyChanged()
                return
            }
            stopAll()
            queuedUpTo = index - 1
            enqueueSystem()
        }
        playing = true
        ReaderService.start(app)
        notifyChanged()
    }

    fun pause() {
        playing = false
        val p = player
        if (isStreamed && p != null && p.isPlaying) {
            p.pause()
            pausedAt = index
        } else {
            stopAll()
        }
        notifyChanged()
    }

    fun toggle() = if (playing) pause() else play()

    fun seek(i: Int) {
        val d = doc ?: return
        index = i.coerceIn(0, maxOf(0, d.paragraphs.size - 1))
        pausedAt = -1
        savePosition()
        if (playing) play() else notifyChanged()
    }

    fun next() = seek(index + 1)

    fun previous() = seek(index - 1)

    private fun stopAll() {
        generation++
        tts?.stop()
        session?.cancel()
        session = null
        player?.release()
        player = null
        pausedAt = -1
    }

    private fun fail(message: String) {
        stopAll()
        playing = false
        lastError = message
        notifyChanged()
    }

    // ---- Phone TTS ----

    private fun enqueueSystem() {
        val d = doc ?: return
        val t = tts ?: return
        val last = minOf(index + LOOKAHEAD, d.paragraphs.size - 1)
        while (queuedUpTo < last) {
            queuedUpTo++
            t.speak(d.paragraphs[queuedUpTo], TextToSpeech.QUEUE_ADD, Bundle(), "$generation:$queuedUpTo")
        }
    }

    private fun parse(id: String): Int? {
        val (gen, idx) = id.split(':').map { it.toIntOrNull() ?: return null }
        return if (gen == generation && !isStreamed) idx else null
    }

    private fun handleStart(id: String) {
        val idx = parse(id) ?: return
        index = idx
        savePosition()
        notifyChanged()
    }

    private fun handleDone(id: String) {
        val idx = parse(id) ?: return
        val d = doc ?: return
        if (idx >= d.paragraphs.size - 1) {
            playing = false
            notifyChanged()
        } else {
            enqueueSystem()
        }
    }

    // ---- Kokoro and Microsoft voices: render paragraphs to files ahead of playback ----

    fun ratePercent(s: Float = speed) = ((s - 1f) * 100).roundToInt().coerceIn(-50, 200)

    private fun startStreaming() {
        stopAll()
        val d = doc ?: return
        val g = generation
        val kokoro = isKokoro
        val kVoice = Kokoro.voice(voiceId.removePrefix(KOKORO))
        val voice = voiceId.removePrefix(EDGE)
        val rate = ratePercent()
        val currentSpeed = speed
        if (kokoro && kVoice == null) {
            fail("Unknown Kokoro voice")
            return
        }
        val dir = File(app.cacheDir, "voice").apply {
            deleteRecursively()
            mkdirs()
        }
        // Short pieces (a sentence or two) so audio starts almost immediately
        // instead of after a whole paragraph has been rendered.
        val pieceChars = if (kokoro) 220 else 500
        session = scope.launch {
            val pieces = (index until d.paragraphs.size).asSequence()
                .flatMap { k -> TextCleaner.pieces(d.paragraphs[k], pieceChars).map { k to it } }
                .iterator()
            val queue = ArrayDeque<Pair<Int, Deferred<File>>>()
            var n = 0
            fun fill() {
                while (queue.size < PIECE_LOOKAHEAD && pieces.hasNext()) {
                    val (k, text) = pieces.next()
                    val id = n++
                    queue.addLast(k to if (kokoro) {
                        async(kokoroThread) {
                            File(dir, "$g-$id.wav").also {
                                Kokoro.writeWav(it, Kokoro.synthesize(text, kVoice!!, currentSpeed))
                            }
                        }
                    } else {
                        async(Dispatchers.IO) {
                            File(dir, "$g-$id.mp3").apply { writeBytes(EdgeTts.synthesize(text, voice, rate)) }
                        }
                    })
                }
            }

            while (true) {
                fill()
                val (k, pending) = queue.removeFirstOrNull() ?: break
                val file = try {
                    pending.await()
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    if (g == generation) {
                        fail(
                            if (kokoro) "Kokoro couldn't read this (${e.message})."
                            else "Couldn't reach the natural voice service (${e.message}). Check your internet, or pick a ◆ Kokoro or Phone voice."
                        )
                    }
                    return@launch
                }
                if (g != generation) return@launch
                if (k != index) {
                    index = k
                    savePosition()
                    notifyChanged()
                }
                fill() // keep rendering ahead while this piece plays
                playFile(file)
                player?.release()
                player = null
                file.delete()
            }
            if (g == generation) {
                playing = false
                notifyChanged()
            }
        }
    }

    private suspend fun playFile(file: File) = suspendCancellableCoroutine { cont ->
        val mp = MediaPlayer()
        mp.setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build()
        )
        mp.setWakeMode(app, PowerManager.PARTIAL_WAKE_LOCK)
        mp.setOnCompletionListener { if (cont.isActive) cont.resume(Unit) }
        mp.setOnErrorListener { _, _, _ ->
            if (cont.isActive) cont.resume(Unit) // skip a paragraph that won't play
            true
        }
        try {
            mp.setDataSource(file.path)
            mp.prepare()
        } catch (e: Exception) {
            mp.release()
            cont.resume(Unit)
            return@suspendCancellableCoroutine
        }
        player = mp
        mp.start()
    }

    private fun savePosition() {
        val d = doc ?: return
        prefs.edit().putInt("pos:${d.key}", index).putLong("posAt:${d.key}", System.currentTimeMillis()).apply()
    }

    fun addListener(l: () -> Unit) {
        listeners += l
    }

    fun removeListener(l: () -> Unit) {
        listeners -= l
    }

    private fun notifyChanged() = listeners.forEach { it() }
}
