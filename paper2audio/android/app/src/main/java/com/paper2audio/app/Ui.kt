package com.paper2audio.app

import android.app.Activity
import android.graphics.Typeface
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/** Small building blocks for the screens made in code (Home, Ask AI, Discover, Settings). */
class Ui(val activity: Activity) {
    private val d = activity.resources.displayMetrics.density
    fun dp(v: Int) = (v * d).toInt()
    fun color(attr: Int) = Themes.color(activity, attr)

    /** A scrolling page with a small spaced-out app name and a big title, like the reference design. */
    fun page(title: String): Pair<ScrollView, LinearLayout> {
        val body = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(18), dp(18), dp(24))
        }
        body.addView(TextView(activity).apply {
            text = "P A P E R   T O   A U D I O"
            textSize = 11f
            letterSpacing = 0.15f
            setTextColor(color(R.attr.p2aMuted))
        })
        body.addView(TextView(activity).apply {
            text = title
            textSize = 30f
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(color(R.attr.p2aText))
            setPadding(0, dp(6), 0, dp(4))
        })
        val scroll = ScrollView(activity).apply {
            isFillViewport = true
            addView(body)
        }
        return scroll to body
    }

    fun full(top: Int = 12) = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(top) }

    fun card(parent: LinearLayout, title: String? = null, top: Int = 12): LinearLayout {
        val c = LinearLayout(activity, null, 0, R.style.P2A_Card).apply { orientation = LinearLayout.VERTICAL }
        parent.addView(c, full(top))
        title?.let { c.addView(TextView(activity, null, 0, R.style.P2A_CardTitle).apply { text = it }) }
        return c
    }

    fun text(t: CharSequence, size: Float = 15f, bold: Boolean = false, muted: Boolean = false) = TextView(activity).apply {
        text = t
        textSize = size
        setLineSpacing(0f, 1.2f)
        if (bold) setTypeface(typeface, Typeface.BOLD)
        setTextColor(color(if (muted) R.attr.p2aMuted else R.attr.p2aText))
    }

    fun button(label: String, soft: Boolean = false, icon: Int = 0, onClick: () -> Unit) =
        Button(activity, null, 0, if (soft) R.style.P2A_Button_Soft else R.style.P2A_Button).apply {
            text = label
            if (icon != 0) setCompoundDrawablesRelativeWithIntrinsicBounds(icon, 0, 0, 0)
            setOnClickListener { onClick() }
        }

    fun textButton(label: String, onClick: () -> Unit) = Button(activity, null, 0, R.style.P2A_Button_Text).apply {
        text = label
        gravity = Gravity.START or Gravity.CENTER_VERTICAL
        setOnClickListener { onClick() }
    }

    /** A row like "icon  Title / subtitle  ›" that opens something. */
    fun row(parent: LinearLayout, icon: Int, title: String, sub: String?, top: Int = 10, onClick: () -> Unit): LinearLayout {
        val r = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundResource(R.drawable.bg_card)
            setPadding(dp(16), dp(16), dp(12), dp(16))
            isClickable = true
            setOnClickListener { onClick() }
        }
        r.addView(ImageView(activity).apply {
            setImageResource(icon)
            imageTintList = android.content.res.ColorStateList.valueOf(color(R.attr.p2aAccent))
        }, LinearLayout.LayoutParams(dp(26), dp(26)))
        val texts = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), 0, dp(8), 0)
        }
        texts.addView(text(title, 16f, bold = true))
        sub?.let { texts.addView(text(it, 13f, muted = true)) }
        r.addView(texts, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        r.addView(text("›", 22f, muted = true))
        parent.addView(r, full(top))
        return r
    }

    /**
     * A section that opens and closes when its header is tapped (like "Appearance ⌄").
     * Returns the body to fill; [open] remembers the state per [key].
     */
    fun section(parent: LinearLayout, icon: Int, title: String, key: String): LinearLayout {
        val prefs = activity.getSharedPreferences("p2a", android.content.Context.MODE_PRIVATE)
        val box = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundResource(R.drawable.bg_card)
        }
        val header = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(18), dp(20), dp(16), dp(20))
            isClickable = true
        }
        header.addView(ImageView(activity).apply {
            setImageResource(icon)
            imageTintList = android.content.res.ColorStateList.valueOf(color(R.attr.p2aAccent))
        }, LinearLayout.LayoutParams(dp(26), dp(26)))
        header.addView(text(title, 18f, bold = true).apply { setPadding(dp(18), 0, 0, 0) },
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        val chevron = text("⌄", 22f, muted = true)
        header.addView(chevron)
        val body = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), 0, dp(18), dp(16))
        }
        fun show(open: Boolean) {
            body.visibility = if (open) View.VISIBLE else View.GONE
            chevron.text = if (open) "⌃" else "⌄"
        }
        show(prefs.getBoolean("open:$key", false))
        header.setOnClickListener {
            val open = body.visibility != View.VISIBLE
            prefs.edit().putBoolean("open:$key", open).apply()
            show(open)
        }
        box.addView(header)
        box.addView(body)
        parent.addView(box, full(14))
        return body
    }

    fun switch(parent: LinearLayout, label: String, on: Boolean, top: Int = 6, onChange: (Boolean) -> Unit) {
        parent.addView(android.widget.Switch(activity).apply {
            text = label
            textSize = 15f
            setTextColor(color(R.attr.p2aText))
            isChecked = on
            setPadding(0, dp(6), 0, dp(6))
            setOnCheckedChangeListener { _, v -> onChange(v) }
        }, full(top))
    }
}
