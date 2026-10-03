package com.paper2audio.app

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.TextView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Car mode: huge controls, the screen stays on, and one tap anywhere to talk. Say "pause",
 * "go back", "next chapter", "faster"… or ask any question about the book: the answer is
 * spoken and then the book carries on.
 */
class CarModeActivity : Activity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var title: TextView
    private lateinit var chapter: TextView
    private lateinit var status: TextView
    private lateinit var play: ImageButton
    private val refresh: () -> Unit = { render() }

    private val d get() = resources.displayMetrics.density
    private fun dp(v: Int) = (v * d).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        Themes.apply(this)
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val accent = Themes.color(this, R.attr.p2aAccent)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.BLACK)
            setPadding(dp(20), dp(28), dp(20), dp(20))
            gravity = Gravity.CENTER_HORIZONTAL
        }
        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        top.addView(TextView(this).apply {
            text = "Car mode"
            textSize = 16f
            setTextColor(Color.GRAY)
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        top.addView(ImageButton(this).apply {
            setImageResource(R.drawable.ic_close)
            setBackgroundColor(Color.TRANSPARENT)
            imageTintList = android.content.res.ColorStateList.valueOf(Color.WHITE)
            contentDescription = "Leave car mode"
            setOnClickListener { finish() }
        }, LinearLayout.LayoutParams(dp(56), dp(56)))
        root.addView(top, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        title = TextView(this).apply {
            textSize = 26f
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            maxLines = 2
        }
        chapter = TextView(this).apply {
            textSize = 18f
            setTextColor(Color.LTGRAY)
            gravity = Gravity.CENTER
            maxLines = 2
        }
        root.addView(title, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(16) })
        root.addView(chapter, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(6) })

        fun big(icon: Int, size: Int, label: String, click: () -> Unit) = ImageButton(this).apply {
            setImageResource(icon)
            setBackgroundResource(R.drawable.bg_play)
            backgroundTintList = android.content.res.ColorStateList.valueOf(if (size > 100) accent else Color.DKGRAY)
            imageTintList = android.content.res.ColorStateList.valueOf(Color.WHITE)
            scaleType = android.widget.ImageView.ScaleType.FIT_CENTER
            setPadding(dp(size / 4), dp(size / 4), dp(size / 4), dp(size / 4))
            contentDescription = label
            setOnClickListener { click() }
        }
        val controls = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }
        controls.addView(big(R.drawable.ic_prev, 88, "Back a sentence") { Speaker.previousSentence() }, LinearLayout.LayoutParams(dp(88), dp(88)))
        play = big(R.drawable.ic_play, 140, "Play or pause") { Speaker.toggle() }
        controls.addView(play, LinearLayout.LayoutParams(dp(140), dp(140)).apply {
            marginStart = dp(22)
            marginEnd = dp(22)
        })
        controls.addView(big(R.drawable.ic_next, 88, "Skip ahead") { Speaker.next() }, LinearLayout.LayoutParams(dp(88), dp(88)))
        root.addView(controls, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))

        val ask = TextView(this).apply {
            text = "🎤  Tap anywhere to talk"
            textSize = 24f
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setBackgroundResource(R.drawable.bg_button)
            setPadding(dp(16), dp(26), dp(16), dp(26))
            setOnClickListener { talk() }
        }
        root.addView(ask, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        status = TextView(this).apply {
            textSize = 17f
            setTextColor(Color.LTGRAY)
            gravity = Gravity.CENTER
            text = "Say “pause”, “play”, “go back”, “next chapter”, “faster”, or ask anything about the book."
        }
        root.addView(status, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(14) })
        // The empty parts of the screen are one big talk button too.
        root.setOnClickListener { talk() }
        setContentView(root)
    }

    private fun talk() {
        if (Speaker.doc == null) {
            status.text = "Open a book first, then come back to car mode."
            return
        }
        status.text = "Listening…"
        VoiceInput.listen(this, onPartial = { status.text = "“$it”" }, onError = { status.text = it }) { said ->
            val done = VoiceCommands.run(said)
            if (done != null) {
                status.text = done
                return@listen
            }
            if (AiLevel.of(this) == AiLevel.PURE || !Llm.ready(this)) {
                status.text = "I can do pause, play, go back, next chapter, faster and slower. Turn on AI in Settings to ask questions."
                return@listen
            }
            val doc = Speaker.doc ?: return@listen
            status.text = "Thinking about “$said”…"
            scope.launch {
                try {
                    val answer = withContext(Dispatchers.IO) {
                        Ai.askWhileListening(this@CarModeActivity, doc, Speaker.index, said, Speaker.style == Style.FAMILY)
                    }
                    status.text = answer
                    Speaker.speakAnswer(answer) { Speaker.play() }
                } catch (e: Exception) {
                    status.text = e.message ?: "The AI didn't answer."
                    Speaker.play()
                }
            }
        }
    }

    private fun render() {
        val doc = Speaker.doc
        title.text = doc?.title ?: "Nothing playing"
        chapter.text = doc?.chapterAt(Speaker.index)?.title.orEmpty()
        play.setImageResource(if (Speaker.playing || Speaker.answering) R.drawable.ic_pause else R.drawable.ic_play)
        Speaker.lastError?.let {
            status.text = it
            Speaker.lastError = null
        }
    }

    override fun onStart() {
        super.onStart()
        Speaker.addListener(refresh)
        render()
    }

    override fun onStop() {
        Speaker.removeListener(refresh)
        VoiceInput.stop()
        super.onStop()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
