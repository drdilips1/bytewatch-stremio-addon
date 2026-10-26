package com.paper2audio.app

import android.app.Activity
import android.app.AlertDialog
import android.text.Spannable
import android.text.SpannableString
import android.text.style.BackgroundColorSpan
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Highlights and notes on words, as in Audiohub's reader: press and hold, choose the words, then
 * Highlight (four colors) or Note. Kept with the book (Library notes), shown in the text, listed
 * under "Highlights and notes".
 */
object WordMarks {
    /** Highlights and notes on words, by paragraph. */
    fun spans(item: Library.Item?): Map<Int, List<Library.Note>> =
        item?.let { Library.notes(it) }.orEmpty().filter { it.isSpan }.groupBy { it.index }

    /** Colors the highlighted words of a paragraph and underlines those with a note. */
    fun mark(span: Spannable, notes: List<Library.Note>?, offset: Int = 0) {
        for (n in notes.orEmpty()) {
            val a = n.start + offset
            val b = n.end + offset
            if (a < 0 || b > span.length || a >= b) continue
            n.color?.let { span.setSpan(BackgroundColorSpan(Library.HIGHLIGHT_COLORS[it] ?: 0x66F5C542), a, b, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE) }
            if (n.text.isNotBlank()) span.setSpan(android.text.style.UnderlineSpan(), a, b, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
    }

    /** Four highlight colors as round swatches, and "remove". */
    fun pickColor(activity: Activity, picked: (String?) -> Unit) {
        val d = activity.resources.displayMetrics.density
        val row = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(0, (8 * d).toInt(), 0, (16 * d).toInt())
        }
        var sheet: LiteSheet? = null
        for ((name, argb) in Library.HIGHLIGHT_COLORS) {
            row.addView(View(activity).apply {
                contentDescription = name
                background = android.graphics.drawable.GradientDrawable().apply {
                    shape = android.graphics.drawable.GradientDrawable.OVAL
                    setColor(argb or 0xFF000000.toInt())
                }
                setOnClickListener {
                    sheet?.dismiss()
                    picked(name)
                }
            }, LinearLayout.LayoutParams((48 * d).toInt(), (48 * d).toInt()).apply { marginStart = (10 * d).toInt(); marginEnd = (10 * d).toInt() })
        }
        sheet = LiteSheet(activity, "Highlight").view(row)
            .row(R.drawable.ic_close, "Remove highlight") { picked(null) }
            .show()
    }

    /** Asks for a note on [words], and passes it on when it isn't empty. */
    fun askNote(activity: Activity, words: String, saved: (String) -> Unit) {
        val d = activity.resources.displayMetrics.density
        val input = EditText(activity).apply { hint = "Your note"; minLines = 2 }
        AlertDialog.Builder(activity)
            .setTitle("Note on “${words.take(40)}${if (words.length > 40) "…" else ""}”")
            .setView(FrameLayout(activity).apply {
                setPadding((20 * d).toInt(), (10 * d).toInt(), (20 * d).toInt(), 0)
                addView(input)
            })
            .setPositiveButton("Save") { _, _ -> input.text.toString().trim().takeIf { it.isNotEmpty() }?.let(saved) }
            .setNegativeButton("Cancel", null)
            .show()
    }

    /**
     * Paragraph [position] with its words selectable: press and hold, drag, then Highlight or Note.
     * [changed] runs after a highlight or note is saved.
     */
    fun selectWords(activity: Activity, item: Library.Item, position: Int, para: String, changed: () -> Unit) {
        val d = activity.resources.displayMetrics.density
        val tv = TextView(activity).apply {
            textSize = ReadingLook.textSize(activity)
            typeface = ReadingLook.typeface(activity)
            setLineSpacing(0f, ReadingLook.spacing(activity))
            setTextColor(Themes.color(activity, R.attr.p2aText))
            setTextIsSelectable(true)
            setPadding((24 * d).toInt(), (4 * d).toInt(), (24 * d).toInt(), (12 * d).toInt())
        }
        fun render() {
            val sp = SpannableString(para)
            mark(sp, Library.get(activity, item.id)?.let { spans(it)[position] })
            tv.text = sp
        }
        render()
        tv.customSelectionActionModeCallback = object : android.view.ActionMode.Callback {
            override fun onCreateActionMode(mode: android.view.ActionMode, menu: android.view.Menu): Boolean {
                menu.add(0, 1, 0, "Highlight")
                menu.add(0, 2, 1, "Note")
                return true
            }

            override fun onPrepareActionMode(mode: android.view.ActionMode, menu: android.view.Menu) = false

            override fun onActionItemClicked(mode: android.view.ActionMode, mi: android.view.MenuItem): Boolean {
                val a = minOf(tv.selectionStart, tv.selectionEnd).coerceAtLeast(0)
                val b = maxOf(tv.selectionStart, tv.selectionEnd).coerceAtMost(para.length)
                if (a >= b) return false
                val book = Library.get(activity, item.id) ?: item
                when (mi.itemId) {
                    1 -> pickColor(activity) { c ->
                        if (c == null) Library.removeSpans(activity, book, position, a, b) else Library.addSpan(activity, book, position, a, b, c)
                        render()
                        changed()
                    }
                    2 -> askNote(activity, para.substring(a, b)) { t ->
                        Library.addSpan(activity, book, position, a, b, null, t)
                        render()
                        changed()
                    }
                }
                mode.finish()
                return true
            }

            override fun onDestroyActionMode(mode: android.view.ActionMode) = Unit
        }
        LiteSheet(activity, "Select words", "Press and hold a word, then drag to choose more").view(tv).show()
    }

    /** The book's highlights and notes on words: tap one to go there, or remove it. */
    fun showAll(activity: Activity, item: Library.Item, doc: Doc, go: (Int) -> Unit, changed: () -> Unit) {
        val marks = Library.notes(item).filter { it.isSpan }.sortedWith(compareBy({ it.index }, { it.start }))
        val sheet = LiteSheet(activity, "Highlights and notes", if (marks.isEmpty()) "Press and hold a word in the text, then Select words" else null)
        for (n in marks) {
            val para = doc.paragraphs.getOrNull(n.index) ?: continue
            val words = para.substring(n.start.coerceAtMost(para.length), n.end.coerceAtMost(para.length))
            sheet.row(if (n.text.isNotBlank()) R.drawable.ic_text else R.drawable.ic_palette, "“${words.take(80)}”",
                n.text.ifBlank { doc.chapterAt(n.index)?.title ?: "Paragraph ${n.index + 1}" }) {
                LiteSheet(activity, "“${words.take(60)}”", n.text.ifBlank { null })
                    .row(R.drawable.ic_play, "Go there") { go(n.index) }
                    .row(R.drawable.ic_delete, if (n.text.isNotBlank()) "Remove the note" else "Remove the highlight") {
                        Library.deleteNote(activity, item, n)
                        changed()
                    }
                    .show()
            }
        }
        sheet.show()
    }
}
