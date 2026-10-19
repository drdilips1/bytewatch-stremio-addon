package com.paper2audio.app

import android.app.Activity
import android.app.Dialog
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/** A short walkthrough the first time the app opens (and again from the menu): Narrato's or Paper to Audio's. */
object LiteWelcome {
    private class Page(val icon: String, val title: String, val body: String, val action: String? = null, val run: ((Activity) -> Unit)? = null)

    private val PAGES get() = if (BuildConfig.LITE) NARRATO else PAPER_TO_AUDIO

    private val PAPER_TO_AUDIO = listOf(
        Page(
            "📚", "Welcome to Paper to Audio",
            "Listen to research papers, books, PDFs, Word and PowerPoint files, web pages and YouTube talks.\n\n" +
                "Tap + to add one, or find free books and papers under Discover.",
        ),
        Page(
            "🎧", "Natural voices",
            "Paper to Audio reads with natural online voices when you're connected.\n\n" +
                "For listening without internet, download the on-device voices (Supertonic or Kokoro) in Voice studio. " +
                "If the internet drops, an on-device voice carries on by itself.",
            "Open Voice studio",
        ) { it.startActivity(android.content.Intent(it, VoiceStudioActivity::class.java)) },
        Page(
            "▶", "While you listen",
            "The word being read lights up as the voice goes. Tap any sentence to read from there; " +
                "press and hold a word for the dictionary, Wikipedia or a highlight.\n\n" +
                "Ask AI about what you're reading, use Car mode on the road, and keep listening with the screen off.",
        ),
        Page(
            "🎙", "Copy a voice",
            "Paper to Audio can also read in a voice copied from a recording, such as your own or a family member's (with their permission).\n\n" +
                "Voice studio › Clone a voice.",
        ),
    )

    private val NARRATO = listOf(
        Page(
            "📚", "Welcome to Narrato",
            "Narrato reads aloud whatever you'd otherwise have to read: books (EPUB), PDFs, Word files, web pages, " +
                "pasted text, even photos of printed pages.\n\nTap + on the home screen to add your first one.",
        ),
        Page(
            "🎧", "Real voices, free",
            "Narrato starts with your phone's own voice, which can sound robotic.\n\n" +
                "For the real thing, download the natural voices once (${LocalTts.POCKET_PACK.sizeMb} MB): ${MyVoices.NARRATO.size} voices of real " +
                "readers, offline and unlimited. Supertonic (31 languages) and Kokoro are there too.",
            "Choose a voice now",
        ) { LiteUi.showVoices(it) },
        Page(
            "▶", "While you listen",
            "The sentence being read is highlighted. Tap any sentence to read from there.\n\n" +
                "Speed, voice and sleep timer are at the bottom, and chapters at the top. " +
                "Reading carries on with the screen off, with controls on the lock screen.",
        ),
        Page(
            "✨", "Listen from anywhere",
            "Select text in any app (a web page, an email, a PDF) and choose Listen with Narrato, " +
                "or share a link or file to Narrato.",
        ),
    )

    fun showOnce(activity: Activity, then: () -> Unit) {
        val prefs = activity.getSharedPreferences("p2a", Activity.MODE_PRIVATE)
        if (prefs.getBoolean("welcomeShown", false)) return then()
        prefs.edit().putBoolean("welcomeShown", true).apply()
        show(activity, then)
    }

    fun show(activity: Activity, then: () -> Unit = {}) {
        if (activity.isFinishing) return then()
        val d = activity.resources.displayMetrics.density
        fun dp(v: Int) = (v * d).toInt()
        fun color(attr: Int) = Themes.color(activity, attr)
        val dialog = Dialog(activity)
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE)
        val box = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(26), dp(24), dp(14))
            background = GradientDrawable().apply {
                cornerRadius = dp(24).toFloat()
                setColor(color(R.attr.p2aSurface))
            }
        }
        val icon = TextView(activity).apply { textSize = 44f; gravity = Gravity.CENTER }
        val title = TextView(activity).apply {
            textSize = 22f
            gravity = Gravity.CENTER
            typeface = Typeface.create(Typeface.SERIF, Typeface.BOLD)
            setTextColor(color(R.attr.p2aText))
            setPadding(0, dp(10), 0, dp(10))
        }
        val body = TextView(activity).apply {
            textSize = 15.5f
            setLineSpacing(0f, 1.25f)
            setTextColor(color(R.attr.p2aText))
        }
        val extra = Button(activity, null, 0, R.style.P2A_Button)
        val dots = TextView(activity).apply {
            gravity = Gravity.CENTER
            setTextColor(color(R.attr.p2aAccent))
            setPadding(0, dp(14), 0, dp(4))
        }
        val skip = Button(activity, null, 0, R.style.P2A_Button_Text).apply { text = "Skip" }
        val next = Button(activity, null, 0, R.style.P2A_Button_Text)
        val row = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            addView(skip, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(next, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        }
        val full = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        box.addView(icon, full)
        box.addView(title, full)
        box.addView(body, full)
        box.addView(extra, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(14) })
        box.addView(dots, full)
        box.addView(row, full)

        var page = 0
        fun render() {
            val p = PAGES[page]
            icon.text = p.icon
            title.text = p.title
            body.text = p.body
            extra.visibility = if (p.action != null) View.VISIBLE else View.GONE
            extra.text = p.action ?: ""
            dots.text = PAGES.indices.joinToString("  ") { if (it == page) "●" else "○" }
            next.text = if (page == PAGES.lastIndex) "Start" else "Next"
            skip.visibility = if (page == PAGES.lastIndex) View.INVISIBLE else View.VISIBLE
        }
        next.setOnClickListener {
            if (page < PAGES.lastIndex) {
                page++
                render()
            } else dialog.dismiss()
        }
        skip.setOnClickListener { dialog.dismiss() }
        extra.setOnClickListener {
            val run = PAGES[page].run
            dialog.dismiss()
            run?.invoke(activity)
        }
        dialog.setOnDismissListener { then() }
        dialog.setContentView(box)
        dialog.window?.apply {
            setBackgroundDrawable(ColorDrawable(0))
            setLayout((activity.resources.displayMetrics.widthPixels * 0.9).toInt().coerceAtMost(dp(440)), ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        render()
        dialog.show()
    }
}
