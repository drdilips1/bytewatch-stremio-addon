package com.paper2audio.app

import android.app.Activity
import android.content.Context
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.TextView

/**
 * How the reader's text looks: font, size, line spacing, margins, alignment, and the paper
 * (Day, Sepia, Cream, Night, or following the phone's dark mode). Changes show at once.
 */
object ReadingLook {
    class Font(val key: String, val label: String, val res: Int?, val system: Typeface?)
    class Paper(val key: String, val label: String, val background: Int, val text: Int)

    private val FONTS = listOf(
        Font("serif", "Default", null, Typeface.SERIF),
        Font("lora", "Lora", R.font.reader_lora, null),
        Font("crimson", "Crimson", R.font.reader_crimson, null),
        Font("playfair", "Playfair", R.font.reader_playfair, null),
        Font("atkinson", "Easy read", R.font.reader_atkinson, null),
        Font("lexend", "Lexend", R.font.reader_lexend, null),
        Font("sans", "Sans", null, Typeface.SANS_SERIF),
        Font("patrick", "Handwritten", R.font.reader_patrick, null),
        Font("dancing", "Script", R.font.reader_dancing, null),
        Font("mono", "Typewriter", null, Typeface.create("serif-monospace", Typeface.NORMAL)),
    )

    private val DAY = Paper("day", "Day", 0xFFFFFFFF.toInt(), 0xFF1A1A1A.toInt())
    private val NIGHT = Paper("night", "Night", 0xFF121417.toInt(), 0xFFD8D4CC.toInt())
    private val PAPERS = listOf(
        Paper("auto", "Auto", 0, 0),
        DAY,
        Paper("sepia", "Sepia", 0xFFF2E6CF.toInt(), 0xFF3B2F22.toInt()),
        Paper("cream", "Cream", 0xFFFBF3E6.toInt(), 0xFF2B2118.toInt()),
        NIGHT,
        Paper("theme", "Theme", 0, 0),
    )

    /** Text alignment: start, justified, centered, end. */
    val ALIGNMENTS = listOf("left", "justify", "center", "right")

    private val loaded = HashMap<String, Typeface>()

    private fun prefs(c: Context) = c.getSharedPreferences("p2a", Context.MODE_PRIVATE)

    private fun fontOf(c: Context, f: Font): Typeface =
        f.system ?: loaded.getOrPut(f.key) { runCatching { c.resources.getFont(f.res!!) }.getOrDefault(Typeface.SERIF) }

    fun typeface(c: Context): Typeface {
        val key = prefs(c).getString("readerFont", "serif")
        return fontOf(c, FONTS.firstOrNull { it.key == key } ?: FONTS[0])
    }

    fun textSize(c: Context): Float = prefs(c).getFloat("readerTextSize", 17f)

    fun spacing(c: Context): Float = prefs(c).getFloat("readerSpacing", 1.35f)

    /** Extra side margin of the text, in dp. */
    fun margin(c: Context): Int = prefs(c).getInt("readerMargin", 8)

    fun alignment(c: Context): String = prefs(c).getString("readerAlign", "left") ?: "left"

    /** The paper chosen ("Auto" follows the phone's dark mode), or null for the theme's own colors. */
    fun paper(c: Context): Paper? = when (val key = prefs(c).getString("readerPaper", "theme")) {
        "theme" -> null
        "auto" -> if (c.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES) NIGHT else DAY
        "white" -> DAY // older setting name
        else -> PAPERS.firstOrNull { it.key == key }?.takeIf { it.background != 0 }
    }

    /** The panel: fonts as "Aa" samples, sliders, alignment and paper. [changed] runs on every change. */
    fun show(activity: Activity, changed: () -> Unit) {
        val p = prefs(activity)
        val d = activity.resources.displayMetrics.density
        fun dp(v: Int) = (v * d).toInt()
        val text = Themes.color(activity, R.attr.p2aText)
        val muted = Themes.color(activity, R.attr.p2aMuted)
        val accent = Themes.color(activity, R.attr.p2aAccent)
        val surface2 = Themes.color(activity, R.attr.p2aSurface2)
        val panel = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, 0, 0, dp(8))
        }

        // Fonts: a row of "Aa" in each one.
        val fonts = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(16), dp(4), dp(16), dp(8))
        }
        fun renderFonts() {
            fonts.removeAllViews()
            val current = p.getString("readerFont", "serif")
            for (f in FONTS) {
                val on = f.key == current
                val cell = LinearLayout(activity).apply {
                    orientation = LinearLayout.VERTICAL
                    gravity = Gravity.CENTER_HORIZONTAL
                    setPadding(dp(10), dp(6), dp(10), dp(6))
                    isClickable = true
                    contentDescription = "Font: ${f.label}"
                    setOnClickListener {
                        p.edit().putString("readerFont", f.key).apply()
                        renderFonts()
                        changed()
                    }
                }
                cell.addView(TextView(activity).apply {
                    this.text = "Aa"
                    textSize = 32f
                    typeface = fontOf(activity, f)
                    setTextColor(if (on) accent else text)
                    gravity = Gravity.CENTER
                })
                cell.addView(TextView(activity).apply {
                    this.text = f.label
                    textSize = 12f
                    setTextColor(if (on) accent else muted)
                    gravity = Gravity.CENTER
                })
                fonts.addView(cell)
            }
        }
        renderFonts()
        panel.addView(HorizontalScrollView(activity).apply {
            isHorizontalScrollBarEnabled = false
            addView(fonts)
        })
        panel.addView(View(activity).apply { setBackgroundColor(surface2) }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)))

        // Sliders: size, line spacing, margins (small sign at the left, big at the right).
        fun slider(small: String, big: String, smallSize: Float, bigSize: Float, max: Int, value: Int, label: String, onChange: (Int) -> Unit) {
            val row = LinearLayout(activity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(20), dp(6), dp(20), dp(6))
            }
            row.addView(TextView(activity).apply {
                this.text = small
                textSize = smallSize
                setTextColor(text)
                gravity = Gravity.CENTER
            }, LinearLayout.LayoutParams(dp(32), ViewGroup.LayoutParams.WRAP_CONTENT))
            row.addView(SeekBar(activity).apply {
                this.max = max
                progress = value.coerceIn(0, max)
                contentDescription = label
                progressTintList = ColorStateList.valueOf(accent)
                thumbTintList = ColorStateList.valueOf(accent)
                progressBackgroundTintList = ColorStateList.valueOf(surface2)
                setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                    override fun onProgressChanged(s: SeekBar, v: Int, fromUser: Boolean) {
                        if (fromUser) {
                            onChange(v)
                            changed()
                        }
                    }
                    override fun onStartTrackingTouch(s: SeekBar) = Unit
                    override fun onStopTrackingTouch(s: SeekBar) = Unit
                })
            }, LinearLayout.LayoutParams(0, dp(44), 1f))
            row.addView(TextView(activity).apply {
                this.text = big
                textSize = bigSize
                setTextColor(text)
                gravity = Gravity.CENTER
            }, LinearLayout.LayoutParams(dp(32), ViewGroup.LayoutParams.WRAP_CONTENT))
            panel.addView(row)
        }
        slider("A", "A", 13f, 22f, 14, (textSize(activity) - 13).toInt(), "Text size") {
            p.edit().putFloat("readerTextSize", 13f + it).apply()
        }
        slider("≡", "☰", 13f, 22f, 8, ((spacing(activity) - 1.1f) * 10).toInt(), "Line spacing") {
            p.edit().putFloat("readerSpacing", 1.1f + it / 10f).apply()
        }
        slider("▯", "▭", 16f, 24f, 8, margin(activity) / 4, "Margins") {
            p.edit().putInt("readerMargin", it * 4).apply()
        }

        // Alignment.
        val aligns = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(20), dp(6), dp(20), dp(10))
        }
        val icons = listOf(R.drawable.ic_align_left, R.drawable.ic_align_justify, R.drawable.ic_align_center, R.drawable.ic_align_right)
        val names = listOf("Align left", "Justify", "Center", "Align right")
        fun renderAligns() {
            aligns.removeAllViews()
            for ((i, key) in ALIGNMENTS.withIndex()) {
                val on = alignment(activity) == key
                aligns.addView(ImageView(activity).apply {
                    setImageResource(icons[i])
                    contentDescription = names[i]
                    imageTintList = ColorStateList.valueOf(if (on) accent else text)
                    setPadding(dp(14), dp(10), dp(14), dp(10))
                    background = GradientDrawable().apply {
                        cornerRadius = dp(12).toFloat()
                        setStroke(dp(if (on) 2 else 1), if (on) accent else surface2)
                    }
                    isClickable = true
                    setOnClickListener {
                        p.edit().putString("readerAlign", key).apply()
                        renderAligns()
                        changed()
                    }
                }, LinearLayout.LayoutParams(dp(60), dp(48)).apply { marginEnd = dp(10) })
            }
        }
        renderAligns()
        panel.addView(aligns)
        panel.addView(View(activity).apply { setBackgroundColor(surface2) }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)))

        // Paper: Day / Sepia / Cream / Night, Auto (follows the phone), or the theme's colors.
        panel.addView(TextView(activity).apply {
            this.text = "PAGE"
            textSize = 12f
            letterSpacing = 0.08f
            setTextColor(muted)
            setPadding(dp(24), dp(14), dp(24), dp(6))
        })
        val papers = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(16), 0, dp(16), dp(8))
        }
        fun renderPapers() {
            papers.removeAllViews()
            val current = p.getString("readerPaper", "theme").let { if (it == "white") "day" else it }
            for (pp in PAPERS) {
                val on = pp.key == current
                val cell = LinearLayout(activity).apply {
                    orientation = LinearLayout.VERTICAL
                    gravity = Gravity.CENTER_HORIZONTAL
                    setPadding(dp(6), dp(4), dp(6), dp(4))
                    isClickable = true
                    contentDescription = "Page: ${pp.label}"
                    setOnClickListener {
                        p.edit().putString("readerPaper", pp.key).apply()
                        renderPapers()
                        changed()
                    }
                }
                cell.addView(TextView(activity).apply {
                    this.text = when (pp.key) {
                        "auto" -> "◐"
                        "theme" -> "◆"
                        else -> "Aa"
                    }
                    textSize = 15f
                    gravity = Gravity.CENTER
                    val bg = when (pp.key) {
                        "auto" -> 0xFF8A8A8A.toInt()
                        "theme" -> Themes.color(activity, R.attr.p2aSurface)
                        else -> pp.background
                    }
                    setTextColor(
                        when (pp.key) {
                            "auto" -> 0xFFFFFFFF.toInt()
                            "theme" -> accent
                            else -> pp.text
                        }
                    )
                    background = GradientDrawable().apply {
                        shape = GradientDrawable.OVAL
                        setColor(bg)
                        setStroke(dp(if (on) 3 else 1), if (on) accent else surface2)
                    }
                }, LinearLayout.LayoutParams(dp(46), dp(46)))
                cell.addView(TextView(activity).apply {
                    this.text = pp.label
                    textSize = 12f
                    setTextColor(if (on) accent else muted)
                    gravity = Gravity.CENTER
                    setPadding(0, dp(4), 0, 0)
                })
                papers.addView(cell, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            }
        }
        renderPapers()
        panel.addView(papers)

        LiteSheet(activity, "Reading look").view(panel).show()
    }
}
