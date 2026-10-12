package com.paper2audio.app

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.graphics.Typeface

/** How the reader's text looks: font, line spacing and paper color (text size is in Voice & options). */
object ReadingLook {
    class Paper(val key: String, val label: String, val background: Int, val text: Int)

    private val FONTS = listOf(
        Triple("serif", "Serif (like a printed book)", Typeface.SERIF),
        Triple("sans", "Sans (clean)", Typeface.SANS_SERIF),
        Triple("light", "Sans light", Typeface.create("sans-serif-light", Typeface.NORMAL)),
        Triple("mono", "Typewriter", Typeface.create("serif-monospace", Typeface.NORMAL)),
    )
    private val SPACINGS = listOf(1.2f to "Compact", 1.35f to "Normal", 1.55f to "Relaxed", 1.75f to "Airy")
    private val PAPERS = listOf(
        Paper("theme", "Theme colors", 0, 0),
        Paper("cream", "Cream", 0xFFFBF3E6.toInt(), 0xFF2B2118.toInt()),
        Paper("sepia", "Sepia", 0xFFF2E6CF.toInt(), 0xFF3B2F22.toInt()),
        Paper("white", "White", 0xFFFFFFFF.toInt(), 0xFF1A1A1A.toInt()),
        Paper("night", "Night", 0xFF121417.toInt(), 0xFFD8D4CC.toInt()),
    )

    private fun prefs(c: Context) = c.getSharedPreferences("p2a", Context.MODE_PRIVATE)

    fun typeface(c: Context): Typeface {
        val key = prefs(c).getString("readerFont", "serif")
        return FONTS.firstOrNull { it.first == key }?.third ?: Typeface.SERIF
    }

    fun spacing(c: Context): Float = prefs(c).getFloat("readerSpacing", 1.35f)

    /** The paper chosen, or null for the theme's own colors. */
    fun paper(c: Context): Paper? = PAPERS.firstOrNull { it.key == prefs(c).getString("readerPaper", "theme") }?.takeIf { it.key != "theme" }

    fun show(activity: Activity, changed: () -> Unit) {
        val p = prefs(activity)
        val font = FONTS.firstOrNull { it.first == p.getString("readerFont", "serif") } ?: FONTS[0]
        val spacing = SPACINGS.minByOrNull { kotlin.math.abs(it.first - spacing(activity)) } ?: SPACINGS[1]
        val paper = PAPERS.firstOrNull { it.key == p.getString("readerPaper", "theme") } ?: PAPERS[0]
        AlertDialog.Builder(activity)
            .setTitle("Reading look")
            .setItems(
                arrayOf(
                    "Font: ${font.second}",
                    "Line spacing: ${spacing.second}",
                    "Paper: ${paper.label}",
                ),
            ) { _, which ->
                when (which) {
                    0 -> choose(activity, "Font", FONTS.map { it.second }, FONTS.indexOf(font)) {
                        p.edit().putString("readerFont", FONTS[it].first).apply()
                        changed()
                        show(activity, changed)
                    }
                    1 -> choose(activity, "Line spacing", SPACINGS.map { it.second }, SPACINGS.indexOf(spacing)) {
                        p.edit().putFloat("readerSpacing", SPACINGS[it].first).apply()
                        changed()
                        show(activity, changed)
                    }
                    2 -> choose(activity, "Paper", PAPERS.map { it.label }, PAPERS.indexOf(paper)) {
                        p.edit().putString("readerPaper", PAPERS[it].key).apply()
                        changed()
                        show(activity, changed)
                    }
                }
            }
            .setPositiveButton("Done", null)
            .show()
    }

    private fun choose(activity: Activity, title: String, labels: List<String>, current: Int, picked: (Int) -> Unit) {
        AlertDialog.Builder(activity)
            .setTitle(title)
            .setSingleChoiceItems(labels.toTypedArray(), current) { d, which ->
                d.dismiss()
                picked(which)
            }
            .show()
    }
}
