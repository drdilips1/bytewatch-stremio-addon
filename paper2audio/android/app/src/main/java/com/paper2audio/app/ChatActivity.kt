package com.paper2audio.app

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Typeface
import android.os.Bundle
import android.speech.RecognizerIntent
import android.text.SpannableString
import android.text.Spanned
import android.text.method.LinkMovementMethod
import android.text.style.ClickableSpan
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * "Ask this document": a chat about the open document. Answers cite sections and
 * paragraphs ([Methods ¶12]); tapping a citation opens the reader there.
 */
class ChatActivity : Activity() {
    private companion object {
        const val REQ_DICTATE = 1
        val SUGGESTIONS = listOf(
            "What was the sample size?",
            "What were the main limitations?",
            "Does this contradict previous research?",
            "What should I remember from this?",
            "Give me the 10 most important findings.",
            "Explain the key figure in simple words.",
            "What are the practical implications?",
        )
        val CITATION = Regex("""\[([^\[\]]{0,60}?)¶\s?(\d+)(?:\s*[-–,]\s*¶?\s?\d+)*]""")
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var list: LinearLayout
    private lateinit var scroll: ScrollView
    private lateinit var input: EditText
    private lateinit var busy: ProgressBar
    private var asking = false

    private val d get() = resources.displayMetrics.density
    private fun dp(v: Int) = (v * d).toInt()
    private fun color(attr: Int) = Themes.color(this, attr)

    override fun onCreate(savedInstanceState: Bundle?) {
        Themes.apply(this)
        super.onCreate(savedInstanceState)
        val doc = Speaker.doc ?: return finish()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(color(R.attr.p2aBg))
            background = Themes.backgroundOf(this@ChatActivity)
        }
        // Header
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(4), dp(8), dp(8), 0)
        }
        header.addView(ImageButton(this, null, 0, R.style.P2A_Icon).apply {
            setImageResource(R.drawable.ic_back)
            contentDescription = "Back"
            setOnClickListener { finish() }
        }, LinearLayout.LayoutParams(dp(48), dp(48)))
        header.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(TextView(this@ChatActivity).apply {
                text = "Ask this document"
                textSize = 20f
                setTypeface(typeface, Typeface.BOLD)
                setTextColor(color(R.attr.p2aText))
            })
            addView(TextView(this@ChatActivity, null, 0, R.style.P2A_Muted).apply {
                text = "${doc.title.take(60)} · ${Llm.name(this@ChatActivity)}"
                maxLines = 1
            })
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        header.addView(ImageButton(this, null, 0, R.style.P2A_Icon).apply {
            setImageResource(R.drawable.ic_close)
            contentDescription = "Clear the conversation"
            setOnClickListener {
                AlertDialog.Builder(this@ChatActivity)
                    .setTitle("Clear this conversation?")
                    .setPositiveButton("Clear") { _, _ ->
                        Ai.clearHistory(this@ChatActivity, doc)
                        list.removeAllViews()
                        showIntro()
                    }
                    .setNegativeButton("Cancel", null)
                    .show()
            }
        }, LinearLayout.LayoutParams(dp(48), dp(48)))
        root.addView(header)

        // Messages
        list = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(8), dp(14), dp(8))
        }
        scroll = ScrollView(this).apply { addView(list); isFillViewport = true }
        root.addView(scroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))

        busy = ProgressBar(this, null, 0, R.style.P2A_Progress).apply {
            isIndeterminate = true
            visibility = View.GONE
        }
        root.addView(busy, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            marginStart = dp(16); marginEnd = dp(16)
        })

        // Suggestions
        val chips = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(dp(12), dp(6), dp(12), dp(6)) }
        for (q in SUGGESTIONS) {
            chips.addView(TextView(this).apply {
                text = q
                textSize = 13f
                setTextColor(color(R.attr.p2aText))
                setBackgroundResource(R.drawable.bg_chip)
                setPadding(dp(12), dp(7), dp(12), dp(7))
                setOnClickListener { send(q) }
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginEnd = dp(8) })
        }
        root.addView(HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; addView(chips) })

        // Input
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundResource(R.drawable.bg_card)
            setPadding(dp(14), dp(4), dp(4), dp(4))
        }
        input = EditText(this).apply {
            hint = "Ask anything about it…"
            background = null
            setTextColor(color(R.attr.p2aText))
            setHintTextColor(color(R.attr.p2aMuted))
            maxLines = 4
            imeOptions = EditorInfo.IME_ACTION_SEND
            setRawInputType(android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES)
            setOnEditorActionListener { _, id, _ ->
                if (id == EditorInfo.IME_ACTION_SEND) { send(text.toString()); true } else false
            }
            intent.getStringExtra("prefill")?.let { setText(it); setSelection(it.length) }
        }
        bar.addView(input, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        bar.addView(ImageButton(this, null, 0, R.style.P2A_Icon).apply {
            setImageResource(R.drawable.ic_mic)
            contentDescription = "Speak your question"
            setOnClickListener { dictate() }
        }, LinearLayout.LayoutParams(dp(48), dp(48)))
        bar.addView(ImageButton(this, null, 0, R.style.P2A_Icon).apply {
            setImageResource(R.drawable.ic_next)
            contentDescription = "Send"
            setOnClickListener { send(input.text.toString()) }
        }, LinearLayout.LayoutParams(dp(48), dp(48)))
        root.addView(bar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            setMargins(dp(12), dp(4), dp(12), dp(12))
        })
        setContentView(root)

        val past = Ai.history(this, doc)
        if (past.isEmpty()) showIntro() else past.forEach { bubble(it.question, mine = true); bubble(it.answer, mine = false) }
        scrollToEnd()
    }

    private fun showIntro() {
        bubble(
            "Ask me anything about this document: facts, numbers, methods, what it means, or how it compares. " +
                "My answers point to where they come from, like [Methods ¶12]: tap one to jump there.",
            mine = false,
        )
    }

    private fun send(text: String) {
        val q = text.trim()
        if (q.isEmpty() || asking) return
        val doc = Speaker.doc ?: return
        input.setText("")
        bubble(q, mine = true)
        asking = true
        busy.visibility = View.VISIBLE
        scrollToEnd()
        scope.launch {
            try {
                val answer = withContext(Dispatchers.IO) { Ai.ask(this@ChatActivity, doc, q) }
                bubble(answer, mine = false)
            } catch (e: Exception) {
                bubble("Sorry, that didn't work: ${e.message ?: "please try again"}", mine = false)
            } finally {
                asking = false
                busy.visibility = View.GONE
                scrollToEnd()
            }
        }
    }

    private fun bubble(text: String, mine: Boolean) {
        val tv = TextView(this).apply {
            textSize = 15.5f
            setLineSpacing(0f, 1.2f)
            setTextIsSelectable(!mine)
            setPadding(dp(14), dp(10), dp(14), dp(10))
            if (mine) {
                this.text = text
                setBackgroundResource(R.drawable.bg_chip_on)
                setTextColor(color(R.attr.p2aOnAccent))
            } else {
                this.text = linkCitations(text)
                movementMethod = LinkMovementMethod.getInstance()
                setBackgroundResource(R.drawable.bg_card)
                setTextColor(color(R.attr.p2aText))
                setOnLongClickListener {
                    AlertDialog.Builder(this@ChatActivity)
                        .setItems(arrayOf("Listen", "Copy")) { _, w ->
                            if (w == 0) Speaker.preview(CITATION.replace(text, ""))
                            else {
                                getSystemService(android.content.ClipboardManager::class.java)
                                    .setPrimaryClip(android.content.ClipData.newPlainText("answer", text))
                                Toast.makeText(this@ChatActivity, "Copied", Toast.LENGTH_SHORT).show()
                            }
                        }
                        .show()
                    true
                }
            }
        }
        list.addView(tv, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            gravity = if (mine) Gravity.END else Gravity.START
            topMargin = dp(8)
            if (mine) marginStart = dp(40) else marginEnd = dp(24)
        })
    }

    /** Makes "[Methods ¶12]" tappable: it opens the reader at that paragraph. */
    private fun linkCitations(text: String): CharSequence {
        val span = SpannableString(text)
        for (m in CITATION.findAll(text)) {
            val paragraph = m.groupValues[2].toIntOrNull() ?: continue
            span.setSpan(object : ClickableSpan() {
                override fun onClick(widget: View) {
                    val doc = Speaker.doc ?: return
                    Speaker.seek((paragraph - 1).coerceIn(0, doc.paragraphs.size - 1))
                    finish()
                }
            }, m.range.first, m.range.last + 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
        return span
    }

    private fun scrollToEnd() = scroll.post { scroll.fullScroll(View.FOCUS_DOWN) }

    private fun dictate() {
        try {
            @Suppress("DEPRECATION")
            startActivityForResult(
                Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    .putExtra(RecognizerIntent.EXTRA_PROMPT, "Ask your question"),
                REQ_DICTATE,
            )
        } catch (e: Exception) {
            Toast.makeText(this, "Voice typing isn't available on this phone", Toast.LENGTH_LONG).show()
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_DICTATE && resultCode == RESULT_OK) {
            data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()?.let { send(it) }
        }
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
