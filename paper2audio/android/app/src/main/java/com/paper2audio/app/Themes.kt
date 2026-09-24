package com.paper2audio.app

import android.app.Activity
import android.content.Context
import android.content.res.Configuration

/** Color themes. "System" follows the phone's light/dark setting. */
object Themes {
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
            error("No readable text found. Scanned PDFs need OCR, and DRM-protected books can't be read.")
        }
    }

    /** Parses a library item and loads it into the player. Call off the main thread. */
    fun parse(context: Context, item: Library.Item): Doc =
        Loader.parse(context, Library.source(context, item), options(context)).also(::check)

    /** Imports a new document into the library. Call off the main thread. */
    fun import(context: Context, fetch: () -> Loader.Source): Pair<Library.Item, Doc> {
        val src = fetch()
        val doc = try {
            Loader.parse(context, src, options(context)).also(::check)
        } catch (e: Exception) {
            src.file.delete()
            throw e
        }
        return Library.add(context, src, doc) to doc
    }
}
