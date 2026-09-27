package com.paper2audio.app

import android.app.Activity
import android.content.ContentValues
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.GridLayout
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
import org.json.JSONArray
import org.json.JSONObject

/**
 * Study mode for the open document: key points, flashcards (with Anki export),
 * a "Test me" quiz, viva and short-answer questions, a revision summary, a mind
 * map and a glossary.
 */
class StudyActivity : Activity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var content: LinearLayout
    private lateinit var busy: ProgressBar
    private lateinit var status: TextView
    private var working = false

    private val d get() = resources.displayMetrics.density
    private fun dp(v: Int) = (v * d).toInt()
    private fun color(attr: Int) = Themes.color(this, attr)

    override fun onCreate(savedInstanceState: Bundle?) {
        Themes.apply(this)
        super.onCreate(savedInstanceState)
        val doc = Speaker.doc ?: return finish()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = Themes.backgroundOf(this@StudyActivity)
        }
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(4), dp(8), dp(16), 0)
        }
        header.addView(ImageButton(this, null, 0, R.style.P2A_Icon).apply {
            setImageResource(R.drawable.ic_back)
            contentDescription = "Back"
            setOnClickListener { finish() }
        }, LinearLayout.LayoutParams(dp(48), dp(48)))
        header.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(TextView(this@StudyActivity).apply {
                text = "Study mode"
                textSize = 22f
                setTypeface(typeface, Typeface.BOLD)
                setTextColor(color(R.attr.p2aText))
            })
            addView(TextView(this@StudyActivity, null, 0, R.style.P2A_Muted).apply { text = doc.title.take(70); maxLines = 1 })
        })
        root.addView(header)

        // The tools, two per row.
        val grid = GridLayout(this).apply {
            columnCount = 2
            setPadding(dp(12), dp(10), dp(12), 0)
        }
        for (kind in Ai.Study.entries) {
            grid.addView(Button(this, null, 0, if (kind == Ai.Study.QUIZ) R.style.P2A_Button else R.style.P2A_Button_Soft).apply {
                text = kind.label
                setOnClickListener { load(kind) }
            }, GridLayout.LayoutParams().apply {
                width = 0
                columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f)
                setMargins(dp(4), dp(4), dp(4), dp(4))
            })
        }
        root.addView(grid)
        busy = ProgressBar(this, null, 0, R.style.P2A_Progress).apply { isIndeterminate = true; visibility = View.GONE }
        root.addView(busy, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            marginStart = dp(16); marginEnd = dp(16)
        })
        status = TextView(this, null, 0, R.style.P2A_Muted).apply {
            text = "Choose a tool. Everything is made from this document with ${Llm.name(this@StudyActivity)} and kept, so it opens instantly next time."
            setPadding(dp(18), dp(6), dp(18), 0)
        }
        root.addView(status)
        content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(8), dp(16), dp(24)) }
        root.addView(ScrollView(this).apply { addView(content) }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)
    }

    private fun load(kind: Ai.Study) {
        if (working) return
        val doc = Speaker.doc ?: return
        working = true
        busy.visibility = View.VISIBLE
        content.removeAllViews()
        status.text = "Preparing ${kind.label.lowercase()}…"
        scope.launch {
            try {
                val result = withContext(Dispatchers.IO) {
                    Ai.study(this@StudyActivity, doc, kind) { p -> runOnUiThread { status.text = p } }
                }
                status.text = kind.label
                when (kind) {
                    Ai.Study.FLASHCARDS -> flashcards(JSONObject(result).getJSONArray("cards"), doc)
                    Ai.Study.QUIZ -> quiz(JSONObject(result).getJSONArray("questions"))
                    Ai.Study.MINDMAP -> textCard(mindMap(JSONObject(result), 0), kind.label, listen = false)
                    Ai.Study.GLOSSARY -> glossary(JSONObject(result).getJSONArray("terms"), doc)
                    else -> textCard(result, kind.label, listen = true)
                }
            } catch (e: Exception) {
                status.text = "That didn't work: ${e.message ?: "please try again"}"
            } finally {
                working = false
                busy.visibility = View.GONE
            }
        }
    }

    private fun card(): LinearLayout = LinearLayout(this, null, 0, R.style.P2A_Card).apply { orientation = LinearLayout.VERTICAL }.also {
        content.addView(it, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(10) })
    }

    private fun body(t: CharSequence, size: Float = 16f) = TextView(this).apply {
        text = t
        textSize = size
        setLineSpacing(0f, 1.25f)
        setTextColor(color(R.attr.p2aText))
        setTextIsSelectable(true)
    }

    private fun textCard(text: String, title: String, listen: Boolean) {
        val c = card()
        c.addView(body(text))
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        if (listen) row.addView(Button(this, null, 0, R.style.P2A_Button_Text).apply { this.text = "Listen"; setOnClickListener { Speaker.preview(text) } })
        row.addView(Button(this, null, 0, R.style.P2A_Button_Text).apply {
            this.text = "Save as file"
            setOnClickListener { saveText("$title - ${Speaker.doc?.title.orEmpty()}", text, "txt", "text/plain") }
        })
        c.addView(row)
    }

    // ---- Flashcards ----

    private fun flashcards(cards: JSONArray, doc: Doc) {
        if (cards.length() == 0) return textCard("No flashcards were made.", "Flashcards", false)
        var i = 0
        var showBack = false
        val c = card()
        val counter = TextView(this, null, 0, R.style.P2A_Muted)
        val face = body("", 19f).apply {
            gravity = Gravity.CENTER
            minHeight = dp(180)
            setTextIsSelectable(false)
        }
        fun show() {
            val o = cards.getJSONObject(i)
            counter.text = "Card ${i + 1} of ${cards.length()} · ${if (showBack) "answer" else "tap to turn over"}"
            face.text = if (showBack) o.optString("back") else o.optString("front")
        }
        face.setOnClickListener { showBack = !showBack; show() }
        c.addView(counter)
        c.addView(face)
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
        row.addView(Button(this, null, 0, R.style.P2A_Button_Soft).apply {
            text = "Previous"
            setOnClickListener { i = (i - 1 + cards.length()) % cards.length(); showBack = false; show() }
        })
        row.addView(View(this), LinearLayout.LayoutParams(dp(12), 1))
        row.addView(Button(this, null, 0, R.style.P2A_Button).apply {
            text = "Next"
            setOnClickListener { i = (i + 1) % cards.length(); showBack = false; show() }
        })
        c.addView(row)
        c.addView(Button(this, null, 0, R.style.P2A_Button_Text).apply {
            text = "Export for Anki"
            setOnClickListener {
                // Anki imports tab-separated text: front, tab, back, one card per line.
                val tsv = (0 until cards.length()).joinToString("\n") { k ->
                    val o = cards.getJSONObject(k)
                    clean(o.optString("front")) + "\t" + clean(o.optString("back"))
                }
                saveText("Flashcards - ${doc.title}", tsv, "txt", "text/plain")
            }
        })
        show()
    }

    private fun clean(s: String) = s.replace('\t', ' ').replace('\n', ' ').trim()

    // ---- Quiz ----

    private fun quiz(questions: JSONArray) {
        if (questions.length() == 0) return textCard("No questions were made.", "Quiz", false)
        var i = 0
        var score = 0
        val c = card()
        val counter = TextView(this, null, 0, R.style.P2A_Muted)
        val question = body("", 17f)
        val options = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val feedback = body("", 15f)
        val next = Button(this, null, 0, R.style.P2A_Button).apply { text = "Next question"; visibility = View.GONE }
        fun show() {
            if (i >= questions.length()) {
                counter.text = "Done"
                question.text = "You scored $score out of ${questions.length()}."
                options.removeAllViews()
                feedback.text = if (score * 10 >= questions.length() * 8) "Excellent!" else "Try again after another listen."
                next.text = "Start again"
                next.visibility = View.VISIBLE
                return
            }
            val q = questions.getJSONObject(i)
            counter.text = "Question ${i + 1} of ${questions.length()} · score $score"
            question.text = q.optString("question")
            feedback.text = ""
            next.visibility = View.GONE
            options.removeAllViews()
            val opts = q.optJSONArray("options") ?: JSONArray()
            val answer = q.optInt("answer")
            for (k in 0 until opts.length()) {
                options.addView(Button(this, null, 0, R.style.P2A_Button_Soft).apply {
                    text = "${'A' + k}. ${opts.optString(k)}"
                    isAllCaps = false
                    gravity = Gravity.START or Gravity.CENTER_VERTICAL
                    setOnClickListener {
                        for (b in 0 until options.childCount) options.getChildAt(b).isEnabled = false
                        val right = k == answer
                        if (right) score++
                        feedback.text = (if (right) "✓ Correct. " else "✗ The answer is ${'A' + answer}. ") + q.optString("explanation")
                        next.text = if (i + 1 < questions.length()) "Next question" else "See my score"
                        next.visibility = View.VISIBLE
                    }
                }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(6) })
            }
        }
        next.setOnClickListener {
            if (i >= questions.length()) { i = 0; score = 0 } else i++
            show()
        }
        c.addView(counter)
        c.addView(question)
        c.addView(options)
        c.addView(feedback, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) })
        c.addView(next, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) })
        show()
    }

    // ---- Mind map and glossary ----

    /** The mind map as an indented outline. */
    private fun mindMap(node: JSONObject, depth: Int): String {
        val bullet = when (depth) { 0 -> ""; 1 -> "● "; 2 -> "○ "; else -> "– " }
        val line = "    ".repeat((depth - 1).coerceAtLeast(0)) + bullet + node.optString("topic")
        val kids = node.optJSONArray("children") ?: JSONArray()
        return (listOf(line) + (0 until kids.length()).map { mindMap(kids.getJSONObject(it), depth + 1) }).joinToString("\n")
    }

    private fun glossary(terms: JSONArray, doc: Doc) {
        val c = card()
        val text = StringBuilder()
        for (k in 0 until terms.length()) {
            val o = terms.getJSONObject(k)
            c.addView(TextView(this).apply {
                this.text = o.optString("term")
                textSize = 16f
                setTypeface(typeface, Typeface.BOLD)
                setTextColor(color(R.attr.p2aText))
                setPadding(0, dp(8), 0, 0)
            })
            c.addView(body(o.optString("definition"), 15f))
            text.append(o.optString("term")).append(": ").append(o.optString("definition")).append("\n")
        }
        c.addView(Button(this, null, 0, R.style.P2A_Button_Text).apply {
            this.text = "Save as file"
            setOnClickListener { saveText("Glossary - ${doc.title}", text.toString(), "txt", "text/plain") }
        })
    }

    /** Saves to Downloads/Paper2Audio (visible in the Files app, importable into Anki). */
    private fun saveText(title: String, text: String, ext: String, mime: String) {
        val safe = title.replace(Regex("""[\\/:*?"<>|]+"""), " ").take(80).trim()
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, "$safe.$ext")
                    put(MediaStore.Downloads.MIME_TYPE, mime)
                    put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Paper2Audio")
                }
                val uri = contentResolver.insert(MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), values)
                    ?: error("Couldn't create the file")
                contentResolver.openOutputStream(uri)?.use { it.write(text.toByteArray()) }
                Toast.makeText(this, "Saved to Downloads/Paper2Audio", Toast.LENGTH_LONG).show()
            } else {
                val dir = java.io.File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "Paper2Audio").apply { mkdirs() }
                java.io.File(dir, "$safe.$ext").writeText(text)
                Toast.makeText(this, "Saved to ${dir.path}", Toast.LENGTH_LONG).show()
            }
        } catch (e: Exception) {
            Toast.makeText(this, "Couldn't save: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
