package com.paper2audio.app

import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.text.InputType
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.TextView
import android.widget.Toast

/** AI settings: which AI to use (Groq or Gemini, both free) and their keys. [then] runs once an AI is ready. */
object AiKeyDialog {
    fun show(activity: Activity, onChange: () -> Unit = {}, then: (() -> Unit)? = null) {
        val d = activity.resources.displayMetrics.density
        fun px(v: Int) = (v * d).toInt()
        val text = Themes.color(activity, R.attr.p2aText)
        val muted = Themes.color(activity, R.attr.p2aMuted)
        fun note(t: String) = TextView(activity).apply { this.text = t; textSize = 13f; setTextColor(muted); setPadding(0, px(2), 0, px(6)) }
        fun link(label: String, url: String) = Button(activity, null, 0, R.style.P2A_Button_Text).apply {
            this.text = label
            setOnClickListener {
                try {
                    activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                } catch (e: ActivityNotFoundException) {
                    Toast.makeText(activity, "Open $url in your browser", Toast.LENGTH_LONG).show()
                }
            }
        }
        val grokKey = EditText(activity).apply {
            hint = "Groq API key (gsk_…)"
            isSingleLine = true
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
            setText(Groq.key(activity) ?: "")
        }
        val geminiKey = EditText(activity).apply {
            hint = "Gemini API key"
            isSingleLine = true
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
            setText(Gemini.key(activity) ?: "")
        }
        val grokBtn = RadioButton(activity).apply { this.text = "Groq: free, very fast (best for asking and explaining)"; setTextColor(text); id = 1 }
        val geminiBtn = RadioButton(activity).apply { this.text = "Gemini (Google): free, reads whole books at once"; setTextColor(text); id = 2 }
        val group = RadioGroup(activity).apply {
            addView(grokBtn)
            addView(geminiBtn)
            check(if (Llm.provider(activity) == Llm.GEMINI) 2 else 1)
        }
        val box = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(px(22), px(8), px(22), 0)
            addView(note("Use AI for"))
            addView(group)
            addView(TextView(activity).apply { this.text = "Groq"; textSize = 15f; setTextColor(text); setPadding(0, px(12), 0, 0) })
            addView(grokKey)
            addView(note("Free: sign in at console.groq.com › API Keys › Create API key, then paste it here. No card needed. Its free tier takes a limited amount of text per minute, so whole-book jobs (versions, Ask your library) go faster with Gemini added too."))
            addView(link("Get a free Groq key", Groq.KEY_PAGE))
            addView(TextView(activity).apply { this.text = "Gemini"; textSize = 15f; setTextColor(text); setPadding(0, px(12), 0, 0) })
            addView(geminiKey)
            addView(note("Free, no card needed, with a daily limit. Also used to transcribe audio and video. On the free tier Google may use what you send to improve its products."))
            addView(link("Get a Gemini key", Gemini.KEY_PAGE))
            addView(note("Keys are kept on this phone and, when you're signed in, synced to your other devices through your account."))
        }
        AlertDialog.Builder(activity)
            .setTitle("AI settings")
            .setView(android.widget.ScrollView(activity).apply { addView(box) })
            .setPositiveButton("Save") { _, _ ->
                Groq.setKey(activity, grokKey.text.toString())
                Gemini.setKey(activity, geminiKey.text.toString())
                Llm.setProvider(activity, if (group.checkedRadioButtonId == 2) Llm.GEMINI else Llm.GROQ)
                onChange()
                if (Llm.ready(activity)) then?.invoke()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    /** Runs [then] now if an AI is set up, else after the user adds a key. */
    fun withKey(activity: Activity, then: () -> Unit) {
        if (Llm.ready(activity)) then() else show(activity, then = then)
    }
}
