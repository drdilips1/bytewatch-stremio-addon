package com.paper2audio.app

import android.app.Activity
import android.content.Context
import android.content.res.Configuration

/** Color themes. "System" follows the phone's light/dark setting. */
object Themes {
    /** The theme's page background (a gradient), for screens built in code. */
    fun backgroundOf(context: android.content.Context): android.graphics.drawable.Drawable? {
        val a = context.obtainStyledAttributes(intArrayOf(R.attr.p2aBackground))
        return try { a.getDrawable(0) } finally { a.recycle() }
    }

    /** A color from the current theme, e.g. R.attr.p2aText. */
    fun color(context: android.content.Context, attr: Int): Int {
        val v = android.util.TypedValue()
        context.theme.resolveAttribute(attr, v, true)
        return v.data
    }

    class Theme(val key: String, val label: String, val style: Int)

    val ALL = listOf(
        Theme("system", "⚙️  System (light or dark)", 0),
        Theme("ocean", "🔵  Ocean", R.style.Theme_P2A_Ocean),
        Theme("forest", "🟢  Forest", R.style.Theme_P2A_Forest),
        Theme("sunset", "🟠  Sunset", R.style.Theme_P2A_Sunset),
        Theme("lavender", "🟣  Lavender", R.style.Theme_P2A_Lavender),
        Theme("rose", "🌸  Rose", R.style.Theme_P2A_Rose),
        Theme("sepia", "📜  Sepia (easy on the eyes)", R.style.Theme_P2A_Sepia),
        Theme("midnight", "🌙  Midnight (dark)", R.style.Theme_P2A_Midnight),
        Theme("black", "⚫  Black (dark, saves battery on OLED)", R.style.Theme_P2A_Black),
    )

    private fun prefs(context: Context) = context.getSharedPreferences("p2a", Context.MODE_PRIVATE)

    fun currentKey(context: Context): String = prefs(context).getString("theme", "system") ?: "system"

    fun set(context: Context, key: String) = prefs(context).edit().putString("theme", key).apply()

    fun showPicker(activity: Activity) {
        val current = ALL.indexOfFirst { it.key == currentKey(activity) }.coerceAtLeast(0)
        android.app.AlertDialog.Builder(activity)
            .setTitle("Theme")
            .setSingleChoiceItems(ALL.map { it.label }.toTypedArray(), current) { dialog, which ->
                dialog.dismiss()
                if (which != current) {
                    set(activity, ALL[which].key)
                    activity.recreate()
                }
            }
            .show()
    }

    /** Call before setContentView. */
    fun apply(activity: Activity) {
        val theme = ALL.firstOrNull { it.key == currentKey(activity) } ?: ALL[0]
        val style = if (theme.style != 0) theme.style else {
            val night = activity.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK
            if (night == Configuration.UI_MODE_NIGHT_YES) R.style.Theme_P2A_Midnight else R.style.Theme_P2A_Ocean
        }
        activity.setTheme(style)
    }
}

/** Opening and importing documents, shared by the library and player screens. */
object Opener {
    private fun prefs(context: Context) = context.getSharedPreferences("p2a", Context.MODE_PRIVATE)

    val OPTION_KEYS = listOf("skipRefs", "removeCites", "skipCaptions", "skipAppendix")
    val OPTION_DEFAULTS = listOf(true, true, true, false)

    fun options(context: Context): CleanOptions {
        val p = prefs(context)
        val v = OPTION_KEYS.mapIndexed { i, k -> p.getBoolean(k, OPTION_DEFAULTS[i]) }
        return CleanOptions(skipReferences = v[0], removeCitations = v[1], skipCaptions = v[2], skipAppendix = v[3])
    }

    private fun check(doc: Doc) {
        if (doc.paragraphs.isEmpty()) {
            error("No readable text found. DRM-protected books can't be read.")
        }
    }

    /** Parses a library item and loads it into the player. Call off the main thread. */
    fun parse(context: Context, item: Library.Item): Doc {
        // Synced from another device: fetch the file from where it came from.
        if (!Library.hasFile(context, item)) Library.refetch(context, item)
        val doc = Loader.parse(context, Library.source(context, item), options(context)).also(::check)
        val thumb = Library.thumb(context, item.id)
        if (!thumb.exists()) runCatching { Thumbs.make(context, Library.source(context, item), doc, thumb) }
        // Spoken explanations of figures and tables, if made with Gemini and switched on.
        val visuals = if (prefs(context).getBoolean("aiVisuals", true)) Ai.visuals(context, item) else null
        return if (visuals.isNullOrEmpty()) doc else Ai.withVisuals(doc, visuals)
    }

    /**
     * Scanned pages (almost no text layer) are read with text recognition; with
     * [all], every page is (for PDFs whose text layer is garbled). Call off the main thread.
     */
    fun recognizeScannedPages(context: Context, pdf: java.io.File, all: Boolean, progress: (String) -> Unit): Int {
        val words = PdfExtractor.wordsPerPage(context, pdf)
        val pages = words.indices.filter { all || words[it] < 15 }.map { it + 1 }
        if (pages.isEmpty()) return 0
        val found = Ocr.pdfPages(pdf, pages, progress)
        // Keep what was recognized before for pages not redone now.
        val merged = if (all) found else Loader.ocrPages(pdf) + found
        if (merged.isNotEmpty()) Loader.saveOcrPages(pdf, merged) else Loader.ocrPagesFile(pdf).delete()
        return found.size
    }

    /** Imports a new document into the library. Call off the main thread. */
    fun import(context: Context, fetch: () -> Loader.Source, progress: (String) -> Unit = {}, url: String? = null): Pair<Library.Item, Doc> {
        val src = fetch()
        val doc = try {
            if (src.kind == Loader.Kind.PDF) recognizeScannedPages(context, src.file, all = false, progress)
            Loader.parse(context, src, options(context)).also(::check)
        } catch (e: Exception) {
            Loader.ocrPagesFile(src.file).delete()
            src.file.delete()
            throw e
        }
        val item = Library.add(context, src, doc)
        if (url != null) Library.setUrl(context, item, url)
        return item to doc
    }
}
