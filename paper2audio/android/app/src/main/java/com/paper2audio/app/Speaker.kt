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
    private var speedRendered = 1.0f
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

    /** The sentence(s) being read right now, for highlighting in the reader. */
    var currentPiece: String? = null
        private set
    private var warmJob: Job? = null

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
        speedRendered = speed
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
        if (playing) play() else prewarm()
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
        scope.launch(Renderer.kokoroThread) { runCatching { Kokoro.prepare(v) } }
    }

    fun setSpeed(value: Float) {
        speed = value
        prefs.edit().putFloat("speed", value).apply()
        tts?.setSpeechRate(value)
        // Only the part above what the engine renders changes: adjust the running player.
        val p = player
        val sameAudio = isStreamed && Renderer.engineSpeed(voiceId, value) == Renderer.engineSpeed(voiceId, speedRendered)
        if (sameAudio && p != null && p.isPlaying) {
            runCatching { p.playbackParams = p.playbackParams.setSpeed(Renderer.playbackBoost(voiceId, value)) }
        } else {
            pausedAt = -1
            if (playing) play() else prewarm()
        }
        speedRendered = value
        notifyChanged()
    }

    fun load(newDoc: Doc) {
        if (playing) pause()
        stopAll()
        doc = newDoc
        index = prefs.getInt("pos:${newDoc.key}", 0).coerceIn(0, maxOf(0, newDoc.paragraphs.size - 1))
        currentPiece = null
        prewarm()
        scope.launch(Dispatchers.IO) { Renderer.trim(app) }
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
        speedRendered = speed
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
        currentPiece = null
        if (playing) play() else {
            prewarm()
            notifyChanged()
        }
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
        if (idx != index) moveTo(idx)
        currentPiece = doc?.paragraphs?.getOrNull(idx)
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
        val vid = voiceId
        val currentSpeed = speed
        if (isKokoro && Kokoro.voice(vid.removePrefix(KOKORO)) == null) {
            fail("Unknown Kokoro voice")
            return
        }
        val boost = Renderer.playbackBoost(vid, currentSpeed)
        session = scope.launch {
            val pieces = (index until d.paragraphs.size).asSequence()
                .flatMap { k -> Renderer.pieces(d.paragraphs[k], vid).map { k to it } }
                .iterator()
            val queue = ArrayDeque<Triple<Int, String, Deferred<File>>>()
            fun fill() {
                while (queue.size < PIECE_LOOKAHEAD && pieces.hasNext()) {
                    val (k, text) = pieces.next()
                    queue.addLast(Triple(k, text, async { Renderer.render(app, vid, currentSpeed, text) }))
                }
            }

            while (true) {
                fill()
                val (k, text, pending) = queue.removeFirstOrNull() ?: break
                val file = try {
                    pending.await()
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    if (g == generation) {
                        fail(
                            if (vid.startsWith(KOKORO)) "Kokoro couldn't read this (${e.message})."
                            else "Couldn't reach the natural voice service (${e.message}). Check your internet, or download the document for offline listening."
                        )
                    }
                    return@launch
                }
                if (g != generation) return@launch
                if (k != index) moveTo(k) else savePosition()
                currentPiece = text
                notifyChanged()
                if (!playing) return@launch // sleep timer or end of chapter stopped us
                fill() // keep rendering ahead while this piece plays
                playFile(file, boost)
                player?.release()
                player = null
            }
            if (g == generation) {
                playing = false
                currentPiece = null
                notifyChanged()
            }
        }
    }

    /** Renders the first pieces at the current position in the background, so Play starts at once. */
    private fun prewarm() {
        val d = doc ?: return
        if (playing || !isStreamed || (isKokoro && !Kokoro.isInstalled())) return
        val vid = voiceId
        val sp = speed
        val from = index
        warmJob?.cancel()
        warmJob = scope.launch {
            val first = (from until minOf(from + 2, d.paragraphs.size)).flatMap { Renderer.pieces(d.paragraphs[it], vid) }.take(2)
            for (text in first) runCatching { Renderer.render(app, vid, sp, text) }
        }
    }

    /** Called whenever playback reaches a new paragraph. */
    private fun moveTo(k: Int) {
        val d = doc
        val oldChapter = d?.chapterAt(index)
        index = k
        savePosition()
        if (sleepEndOfChapter && d != null && d.chapterAt(k) != oldChapter) {
            sleepEndOfChapter = false
            pause()
        }
    }

    // ---- Voice preview ----

    private var previewPlayer: MediaPlayer? = null
    private const val PREVIEW_TEXT =
        "Hello! This is how I will sound reading your papers and books aloud. Choose the voice you like best."

    /** Stops a voice preview or a spoken AI answer. */
    fun stopPreview() {
        previewPlayer?.let { runCatching { it.stop() }; it.release() }
        previewPlayer = null
        if (!isStreamed && !playing) tts?.stop()
    }

    fun preview(text: String = PREVIEW_TEXT) {
        if (playing) pause()
        if (!isStreamed) {
            tts?.speak(text, TextToSpeech.QUEUE_FLUSH, Bundle(), "preview:x")
            return
        }
        if (isKokoro && !Kokoro.isInstalled()) {
            lastError = "Download the Kokoro voices first."
            notifyChanged()
            return
        }
        val vid = voiceId
        val sp = speed
        scope.launch {
            try {
                val f = Renderer.render(app, vid, sp, text)
                previewPlayer?.release()
                previewPlayer = MediaPlayer().apply {
                    setDataSource(f.path)
                    prepare()
                    val boost = Renderer.playbackBoost(vid, sp)
                    if (boost > 1.01f) runCatching { playbackParams = playbackParams.setSpeed(boost) }
                    setOnCompletionListener {
                        it.release()
                        if (previewPlayer === it) previewPlayer = null
                    }
                    start()
                }
            } catch (e: Exception) {
                lastError = "Couldn't play the preview (${e.message})."
                notifyChanged()
            }
        }
    }

    // ---- Sleep timer ----

    /** When the sleep timer stops playback (epoch millis), or 0 if off. */
    var sleepAt = 0L
        private set
    var sleepEndOfChapter = false
        private set
    private val sleepRunnable = Runnable {
        sleepAt = 0
        pause()
    }

    fun setSleepTimer(minutes: Int) {
        main.removeCallbacks(sleepRunnable)
        sleepEndOfChapter = false
        sleepAt = 0
        if (minutes > 0) {
            sleepAt = System.currentTimeMillis() + minutes * 60_000L
            main.postDelayed(sleepRunnable, minutes * 60_000L)
        }
        notifyChanged()
    }

    fun setSleepAtEndOfChapter() {
        setSleepTimer(0)
        sleepEndOfChapter = true
        notifyChanged()
    }

    private suspend fun playFile(file: File, boost: Float) = suspendCancellableCoroutine { cont ->
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
        if (boost > 1.01f) runCatching { mp.playbackParams = mp.playbackParams.setSpeed(boost) }
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
