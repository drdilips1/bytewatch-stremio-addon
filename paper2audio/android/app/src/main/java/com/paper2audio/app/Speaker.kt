package com.paper2audio.app

import android.content.Context
import android.content.SharedPreferences
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import java.util.concurrent.CopyOnWriteArraySet

/**
 * Live read-aloud using the phone's text-to-speech engine. All state changes
 * happen on the main thread; listeners are called there too.
 */
object Speaker {
    private const val LOOKAHEAD = 3

    private lateinit var app: Context
    private val prefs: SharedPreferences by lazy { app.getSharedPreferences("p2a", Context.MODE_PRIVATE) }
    private val main = Handler(Looper.getMainLooper())
    private val listeners = CopyOnWriteArraySet<() -> Unit>()
    private val pendingReady = ArrayList<() -> Unit>()

    private var tts: TextToSpeech? = null
    var ready = false
        private set
    var initFailed = false
        private set
    var doc: Doc? = null
        private set
    var index = 0
        private set
    var playing = false
        private set
    var speed = 1.0f
        private set

    /** Bumped on every restart so callbacks from stopped utterances are ignored. */
    private var generation = 0
    private var queuedUpTo = -1

    val currentVoiceName: String? get() = tts?.voice?.name

    fun init(context: Context, onReady: () -> Unit) {
        if (tts != null) {
            if (ready || initFailed) onReady() else pendingReady += onReady
            return
        }
        app = context.applicationContext
        speed = prefs.getFloat("speed", 1.0f)
        pendingReady += onReady
        tts = TextToSpeech(app) { status ->
            main.post {
                ready = status == TextToSpeech.SUCCESS
                initFailed = !ready
                if (ready) configure()
                pendingReady.forEach { it() }
                pendingReady.clear()
                notifyChanged()
            }
        }
    }

    private fun configure() {
        val t = tts ?: return
        t.setSpeechRate(speed)
        prefs.getString("voice", null)?.let { name -> t.voices?.firstOrNull { it.name == name }?.let { t.voice = it } }
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

    fun voices(): List<Voice> = tts?.voices.orEmpty()
        .filter { TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED !in it.features }
        .sortedWith(compareBy({ it.locale.displayName }, { it.name }))

    fun setVoice(name: String) {
        val t = tts ?: return
        val v = t.voices?.firstOrNull { it.name == name } ?: return
        t.voice = v
        prefs.edit().putString("voice", name).apply()
        if (playing) play()
        notifyChanged()
    }

    fun setSpeed(value: Float) {
        speed = value
        prefs.edit().putFloat("speed", value).apply()
        tts?.setSpeechRate(value)
        if (playing) play()
        notifyChanged()
    }

    fun load(newDoc: Doc) {
        if (playing) pause()
        doc = newDoc
        index = prefs.getInt("pos:${newDoc.key}", 0).coerceIn(0, maxOf(0, newDoc.paragraphs.size - 1))
        notifyChanged()
    }

    fun play() {
        val d = doc ?: return
        val t = tts ?: return
        if (!ready || d.paragraphs.isEmpty()) return
        if (index >= d.paragraphs.size) index = 0
        playing = true
        generation++
        t.stop()
        queuedUpTo = index - 1
        enqueueMore()
        ReaderService.start(app)
        notifyChanged()
    }

    fun pause() {
        playing = false
        generation++
        tts?.stop()
        notifyChanged()
    }

    fun toggle() = if (playing) pause() else play()

    fun seek(i: Int) {
        val d = doc ?: return
        index = i.coerceIn(0, maxOf(0, d.paragraphs.size - 1))
        savePosition()
        if (playing) play() else notifyChanged()
    }

    fun next() = seek(index + 1)

    fun previous() = seek(index - 1)

    private fun enqueueMore() {
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
        return if (gen == generation) idx else null
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
            enqueueMore()
        }
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
