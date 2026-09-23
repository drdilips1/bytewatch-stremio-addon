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
 * Read-aloud engine. Voices are either Microsoft neural voices ("edge:NAME",
 * natural sounding, needs internet) or the phone's own TTS voices ("sys:NAME").
 * All state changes happen on the main thread; listeners are called there too.
 */
object Speaker {
    const val EDGE = "edge:"
    const val SYSTEM = "sys:"
    const val DEFAULT_VOICE = EDGE + "en-US-AndrewMultilingualNeural"
    private const val LOOKAHEAD = 3

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

    /** Bumped on every restart so callbacks from stopped audio are ignored. */
    private var generation = 0

    // Phone TTS playback state.
    private var queuedUpTo = -1

    // Microsoft voice playback state.
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
        speed = prefs.getFloat("speed", 1.0f)
        voiceId = prefs.getString("voice2", null) ?: DEFAULT_VOICE
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
        if (!isEdge) t.voices?.firstOrNull { it.name == voiceId.removePrefix(SYSTEM) }?.let { t.voice = it }
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

    /** Natural (online) voices first, then the phone's voices with its own language on top. */
    fun voiceOptions(): List<VoiceOption> {
        val out = ArrayList<VoiceOption>()
        for (v in edgeVoices) {
            val person = v.name.substringAfterLast('-').removeSuffix("Neural").removeSuffix("Multilingual")
            val locale = Locale.forLanguageTag(v.locale).displayName
            out += VoiceOption(EDGE + v.name, "★ $person · $locale · ${v.gender.lowercase()} (natural, online)")
        }
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
        if (!isEdge) tts?.let { t -> t.voices?.firstOrNull { it.name == id.removePrefix(SYSTEM) }?.let { t.voice = it } }
        pausedAt = -1
        if (playing) play()
        notifyChanged()
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
        if (isEdge) {
            val p = player
            if (p != null && pausedAt == index) {
                p.start()
                pausedAt = -1
            } else {
                startEdge()
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
        if (isEdge && p != null && p.isPlaying) {
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
        return if (gen == generation && !isEdge) idx else null
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

    // ---- Microsoft neural voices ----

    fun ratePercent(s: Float = speed) = ((s - 1f) * 100).roundToInt().coerceIn(-50, 200)

    private fun startEdge() {
        stopAll()
        val d = doc ?: return
        val g = generation
        val voice = voiceId.removePrefix(EDGE)
        val rate = ratePercent()
        val dir = File(app.cacheDir, "voice").apply {
            deleteRecursively()
            mkdirs()
        }
        session = scope.launch {
            val pending = HashMap<Int, Deferred<File>>()
            fun fetch(k: Int) = pending.getOrPut(k) {
                async(Dispatchers.IO) {
                    File(dir, "$g-$k.mp3").apply { writeBytes(EdgeTts.synthesize(d.paragraphs[k], voice, rate)) }
                }
            }

            var i = index
            while (i < d.paragraphs.size) {
                for (k in i until minOf(i + LOOKAHEAD, d.paragraphs.size)) fetch(k)
                val file = try {
                    pending.getValue(i).await()
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    if (g == generation) {
                        fail("Couldn't reach the natural voice service (${e.message}). Check your internet, or pick a Phone voice.")
                    }
                    return@launch
                }
                pending.remove(i)
                if (g != generation) return@launch
                index = i
                savePosition()
                notifyChanged()
                playFile(file)
                player?.release()
                player = null
                file.delete()
                i++
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
        prefs.edit().putInt("pos:${d.key}", index).apply()
    }

    fun addListener(l: () -> Unit) {
        listeners += l
    }

    fun removeListener(l: () -> Unit) {
        listeners -= l
    }

    private fun notifyChanged() = listeners.forEach { it() }
}
