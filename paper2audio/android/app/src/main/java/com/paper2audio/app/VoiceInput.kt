package com.paper2audio.app

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.widget.Toast

/**
 * Speech to text for voice questions and voice commands, with the phone's speech recognizer
 * (no extra screen, works hands-free). Needs the microphone permission, asked the first time.
 */
object VoiceInput {
    const val REQ_MIC = 4711

    private var recognizer: SpeechRecognizer? = null
    var listening = false
        private set

    fun available(activity: Activity) = SpeechRecognizer.isRecognitionAvailable(activity)

    /**
     * Listens once. [onPartial] gets words as they are recognized, [onResult] the final text,
     * [onError] a short explanation (nothing heard, no permission…).
     */
    fun listen(
        activity: Activity,
        onPartial: (String) -> Unit = {},
        onError: (String) -> Unit = {},
        onResult: (String) -> Unit,
    ) {
        if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            activity.requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_MIC)
            onError("Allow the microphone, then tap the mic again")
            return
        }
        if (!available(activity)) {
            onError("This phone has no speech recognition. Install or turn on Google voice typing.")
            return
        }
        stop()
        // Reading aloud while listening would make it hear itself.
        if (Speaker.playing) Speaker.pause()
        if (Speaker.answering && !Speaker.answerPaused) Speaker.pauseAnswer()
        val r = SpeechRecognizer.createSpeechRecognizer(activity)
        recognizer = r
        listening = true
        r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) = Unit
            override fun onBeginningOfSpeech() = Unit
            override fun onRmsChanged(rmsdB: Float) = Unit
            override fun onBufferReceived(buffer: ByteArray?) = Unit
            override fun onEndOfSpeech() = Unit
            override fun onEvent(eventType: Int, params: Bundle?) = Unit

            override fun onPartialResults(partialResults: Bundle?) {
                partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.let(onPartial)
            }

            override fun onResults(results: Bundle?) {
                finish()
                val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                if (text.isBlank()) onError("I didn't catch that. Tap the mic and try again.") else onResult(text)
            }

            override fun onError(error: Int) {
                finish()
                onError(
                    when (error) {
                        SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "I didn't catch that. Tap the mic and try again."
                        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Speech recognition needs the internet right now."
                        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Allow the microphone for Paper to Audio in Android settings."
                        else -> "Voice input stopped (error $error). Tap the mic to try again."
                    }
                )
            }
        })
        r.startListening(
            Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, activity.packageName)
        )
    }

    private fun finish() {
        listening = false
        recognizer?.destroy()
        recognizer = null
    }

    fun stop() {
        recognizer?.cancel()
        finish()
    }

    fun toastPermission(activity: Activity) =
        Toast.makeText(activity, "The microphone is needed to ask by voice", Toast.LENGTH_LONG).show()
}

/**
 * Spoken commands while listening: "pause", "play", "go back", "next chapter", "faster"… Anything
 * else is a question for the AI.
 */
object VoiceCommands {
    /** Runs [text] as a command; returns a short confirmation, or null if it isn't a command. */
    fun run(text: String): String? {
        val t = text.lowercase().trim().trimEnd('.', '!', '?')
        fun has(vararg w: String) = w.any { Regex("""\b$it\b""").containsMatchIn(t) }
        val short = t.split(' ').size <= 5
        if (!short) return null
        return when {
            has("pause", "stop", "be quiet", "hold on", "wait") -> { Speaker.pause(); "Paused" }
            has("next chapter", "skip chapter") -> {
                val d = Speaker.doc ?: return null
                val next = d.chapters.firstOrNull { it.start > Speaker.index }
                if (next != null) Speaker.seek(next.start)
                Speaker.play(); "Next chapter"
            }
            has("previous chapter", "last chapter", "start of the chapter", "restart chapter") -> {
                val d = Speaker.doc ?: return null
                val cur = d.chapterAt(Speaker.index)
                val target = if (cur != null && Speaker.index - cur.start > 3) cur else d.chapters.lastOrNull { it.start < (cur?.start ?: Speaker.index) }
                Speaker.seek(target?.start ?: 0)
                Speaker.play(); "Chapter start"
            }
            has("go back", "back", "rewind", "repeat", "say that again", "again") -> {
                Speaker.previousSentence()
                Speaker.previousSentence()
                Speaker.play(); "Going back"
            }
            has("skip", "next", "forward") -> { Speaker.next(); Speaker.play(); "Skipping ahead" }
            has("faster", "speed up") -> { Speaker.setSpeed((Speaker.speed + 0.1f).coerceAtMost(4f)); Speaker.play(); "Faster" }
            has("slower", "slow down") -> { Speaker.setSpeed((Speaker.speed - 0.1f).coerceAtLeast(0.5f)); Speaker.play(); "Slower" }
            has("play", "resume", "continue", "carry on", "read", "start") -> { Speaker.play(); "Playing" }
            else -> null
        }
    }
}
