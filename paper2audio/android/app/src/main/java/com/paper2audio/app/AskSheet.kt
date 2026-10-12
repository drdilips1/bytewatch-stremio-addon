package com.paper2audio.app

import android.app.Activity
import android.app.AlertDialog
import android.graphics.Typeface
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * "Ask AI": type or say any question (or tap a ready-made one), and the answer is shown and,
 * by default, read aloud, with a pause button. The book pauses meanwhile and carries on
 * after the answer. Used in the player, car mode and for the whole library.
 */
object AskSheet {
    /** A ready-made question: a chip that runs [answer]. */
    class Preset(val label: String, val answer: suspend () -> String)

    private fun prefs(activity: Activity) = activity.getSharedPreferences("p2a", android.content.Context.MODE_PRIVATE)

    fun speakAnswers(activity: Activity) = prefs(activity).getBoolean("speakAnswers", true)

    fun resumeAfter(activity: Activity) = prefs(activity).getBoolean("resumeAfterAnswer", true)

    /** Ask about the book being listened to (at the current position). */
    fun forBook(activity: Activity, scope: CoroutineScope, listenNow: Boolean = false, prefill: String? = null) {
        val doc = Speaker.doc ?: return
        val index = Speaker.index
        val sentence = Speaker.currentPiece
        val family = Speaker.style == Style.FAMILY
        fun explain(mode: Ai.Explain) = Preset(mode.label) { Ai.explain(activity, doc, index, mode, sentence) }
        val presets = listOf(
            explain(Ai.Explain.PLAIN),
            explain(if (family) Ai.Explain.CHILD else Ai.Explain.TERMS).let { Preset(if (family) "Explain like I'm 10" else "What do the words mean?", it.answer) },
            Preset("What happened so far?") {
                val ch = doc.chapterAt(index)
                val from = ch?.start ?: (index - 40).coerceAtLeast(0)
                Ai.summary(activity, doc, Library.get(activity, doc.key), false, from, index + 1, "what has been read so far in this part", {})
            },
            explain(Ai.Explain.EXAMPLE),
            explain(Ai.Explain.WHY),
            explain(if (family) Ai.Explain.TERMS else Ai.Explain.CHILD),
            Preset("Challenge me") {
                Ai.askWhileListening(activity, doc, index, "Ask me one good question to check I understood what I just heard. Only ask; don't answer it.", family)
            },
        )
        show(
            activity, scope, "Ask about “${doc.title.take(40)}”", presets, listenNow, prefill,
            hint = "Ask anything about what you're hearing",
        ) { q -> Ai.askWhileListening(activity, doc, index, q, family) }
    }

    /** Ask across the whole library ("What have I learned about consciousness?"). */
    fun forLibrary(activity: Activity, scope: CoroutineScope, listenNow: Boolean = false) {
        val presets = listOf(
            Preset("What have I learned recently?") { Brain.ask(activity, "Summarize the main ideas I have learned from the books and documents I listened to most recently.") },
            Preset("Which books disagree?") { Brain.ask(activity, "Which books or documents in my library contradict or disagree with each other, and on what?") },
            Preset("What haven't I explored?") { Brain.ask(activity, "Given what is in my library, what important questions or topics have I not explored yet? Suggest a few directions.") },
            Preset("Connect the ideas") { Brain.ask(activity, "What surprising connections are there between different books in my library?") },
        )
        show(activity, scope, "Ask your library", presets, listenNow, null, hint = "e.g. What have I learned about sleep?") { q -> Brain.ask(activity, q) }
    }

    private fun show(
        activity: Activity,
        scope: CoroutineScope,
        title: String,
        presets: List<Preset>,
        listenNow: Boolean,
        prefill: String?,
        hint: String,
        ask: suspend (String) -> String,
    ) {
        if (!Llm.ready(activity)) {
            AiKeyDialog.show(activity) { if (Llm.ready(activity)) show(activity, scope, title, presets, listenNow, prefill, hint, ask) }
            return
        }
        val builder = AlertDialog.Builder(activity)
        val ctx = builder.context
        val d = activity.resources.displayMetrics.density
        fun dp(v: Int) = (v * d).toInt()
        val accent = Themes.color(activity, R.attr.p2aAccent)
        val wasPlaying = Speaker.playing
        if (wasPlaying) Speaker.pause()

        val input = EditText(ctx).apply {
            this.hint = hint
            setText(prefill.orEmpty())
            imeOptions = EditorInfo.IME_ACTION_SEND
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            maxLines = 3
        }
        val mic = ImageButton(ctx).apply {
            setImageResource(R.drawable.ic_mic)
            setBackgroundResource(R.drawable.bg_play)
            imageTintList = android.content.res.ColorStateList.valueOf(Themes.color(activity, R.attr.p2aOnAccent))
            contentDescription = "Ask by voice"
        }
        val send = Button(ctx, null, 0, R.style.P2A_Button).apply { text = "Ask" }
        val row = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(input, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(mic, LinearLayout.LayoutParams(dp(48), dp(48)).apply { marginStart = dp(6) })
            addView(send, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginStart = dp(6) })
        }
        val chips = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL }
        val status = TextView(ctx).apply {
            textSize = 13f
            setTextColor(accent)
            visibility = View.GONE
        }
        val busy = ProgressBar(ctx, null, 0, R.style.P2A_Progress).apply {
            isIndeterminate = true
            visibility = View.GONE
        }
        val answer = TextView(ctx).apply {
            textSize = 16f
            setLineSpacing(0f, 1.25f)
            setTextIsSelectable(true)
        }
        val voiceRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            visibility = View.GONE
        }
        val pause = Button(ctx, null, 0, R.style.P2A_Button_Soft).apply { text = "Pause answer" }
        val replay = Button(ctx, null, 0, R.style.P2A_Button_Text).apply { text = "Read aloud" }
        voiceRow.addView(pause)
        voiceRow.addView(replay)
        val speak = android.widget.CheckBox(ctx).apply {
            text = "Read answers aloud"
            isChecked = speakAnswers(activity)
            buttonTintList = android.content.res.ColorStateList.valueOf(accent)
            setOnCheckedChangeListener { _, on -> prefs(activity).edit().putBoolean("speakAnswers", on).apply() }
        }
        val resume = android.widget.CheckBox(ctx).apply {
            text = "Carry on with the book after the answer"
            isChecked = resumeAfter(activity)
            buttonTintList = android.content.res.ColorStateList.valueOf(accent)
            setOnCheckedChangeListener { _, on -> prefs(activity).edit().putBoolean("resumeAfterAnswer", on).apply() }
            visibility = if (Speaker.doc != null) View.VISIBLE else View.GONE
        }
        val content = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(6), dp(20), dp(6))
            addView(row)
            addView(HorizontalScrollView(ctx).apply {
                isHorizontalScrollBarEnabled = false
                addView(chips)
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) })
            addView(status, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) })
            addView(busy)
            addView(answer, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) })
            addView(voiceRow)
            addView(speak)
            addView(resume)
        }
        var job: Job? = null
        var closing = false
        val dialog = builder.setTitle(title)
            .setView(ScrollView(ctx).apply { addView(content) })
            .setNegativeButton("Close", null)
            .create()

        /** The book carries on once the answer is over (if it was playing, and the listener wants that). */
        fun carryOn() {
            if (closing) return
            if (resume.isChecked && Speaker.doc != null && (wasPlaying || activity is CarModeActivity)) Speaker.play()
        }

        fun refreshVoice() {
            voiceRow.visibility = if (answer.text.isNotEmpty()) View.VISIBLE else View.GONE
            pause.visibility = if (Speaker.answering) View.VISIBLE else View.GONE
            pause.text = if (Speaker.answerPaused) "Resume answer" else "Pause answer"
        }
        val listener: () -> Unit = { activity.runOnUiThread { refreshVoice() } }
        Speaker.addListener(listener)

        fun say(text: String) {
            Speaker.speakAnswer(text) { carryOn() }
            refreshVoice()
        }

        fun start(label: String, work: suspend () -> String) {
            job?.cancel()
            Speaker.stopAnswer()
            status.text = label
            status.visibility = View.VISIBLE
            busy.visibility = View.VISIBLE
            answer.text = ""
            refreshVoice()
            job = scope.launch {
                try {
                    val text = withContext(Dispatchers.IO) { work() }
                    answer.text = text
                    status.visibility = View.GONE
                    if (speak.isChecked) say(text) else carryOn()
                } catch (e: kotlinx.coroutines.CancellationException) {
                    throw e
                } catch (e: Exception) {
                    status.text = e.message ?: "The AI didn't answer. Check your internet."
                } finally {
                    busy.visibility = View.GONE
                    refreshVoice()
                }
            }
        }

        fun submit(q: String) {
            val question = q.trim()
            if (question.isEmpty()) return
            // "pause", "go back", "next chapter"… work here too.
            VoiceCommands.run(question)?.let { done ->
                status.text = done
                status.visibility = View.VISIBLE
                closing = true
                dialog.dismiss()
                return
            }
            start("Thinking about “${question.take(60)}”…") { ask(question) }
        }

        fun listen() {
            status.text = "Listening… ask your question"
            status.visibility = View.VISIBLE
            VoiceInput.listen(
                activity,
                onPartial = { input.setText(it) },
                onError = { status.text = it },
            ) { said ->
                input.setText(said)
                submit(said)
            }
        }

        for (p in presets) {
            chips.addView(TextView(ctx).apply {
                text = p.label
                textSize = 14f
                setTypeface(typeface, Typeface.BOLD)
                setPadding(dp(14), dp(8), dp(14), dp(8))
                setBackgroundResource(R.drawable.bg_chip)
                setTextColor(Themes.color(activity, R.attr.p2aText))
                setOnClickListener { start("${p.label}…", p.answer) }
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginEnd = dp(8) })
        }
        send.setOnClickListener { submit(input.text.toString()) }
        input.setOnEditorActionListener { _, id, _ ->
            if (id == EditorInfo.IME_ACTION_SEND) submit(input.text.toString())
            id == EditorInfo.IME_ACTION_SEND
        }
        mic.setOnClickListener { listen() }
        pause.setOnClickListener { if (Speaker.answerPaused) Speaker.resumeAnswer() else Speaker.pauseAnswer() }
        replay.setOnClickListener { if (answer.text.isNotEmpty()) say(answer.text.toString()) }

        dialog.setOnDismissListener {
            closing = true
            job?.cancel()
            VoiceInput.stop()
            Speaker.removeListener(listener)
            val wasAnswering = Speaker.answering
            Speaker.stopAnswer()
            // Closed in the middle of an answer: go back to the book as promised.
            if (wasAnswering && resumeAfter(activity) && wasPlaying) Speaker.play()
        }
        dialog.show()
        if (listenNow) listen()
    }
}
