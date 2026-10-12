package com.paper2audio.app

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.widget.EditText
import android.widget.LinearLayout
import org.json.JSONObject

/** The reader's own pronunciations: a word, and how to say it ("Nguyen" → "Win"). */
object Pronounce {
    @Volatile private var entries: Map<String, String> = emptyMap()
    @Volatile private var rules: List<Pair<Regex, String>> = emptyList()

    /** Changes when the list does, so audio made with the old pronunciations isn't reused. */
    @Volatile var stamp: String = ""
        private set

    private fun prefs(c: Context) = c.getSharedPreferences("p2a", Context.MODE_PRIVATE)

    fun init(context: Context) {
        val o = runCatching { JSONObject(prefs(context).getString("pronounce", "{}")!!) }.getOrElse { JSONObject() }
        set(o.keys().asSequence().associateWith { o.getString(it) })
    }

    private fun set(map: Map<String, String>) {
        entries = map.toSortedMap(String.CASE_INSENSITIVE_ORDER)
        // Longer words first, so "New York" wins over "York".
        rules = entries.entries.sortedByDescending { it.key.length }.map { (word, say) ->
            Regex("""(?<![\p{L}\p{N}])""" + Regex.escape(word) + """(?![\p{L}\p{N}])""", RegexOption.IGNORE_CASE) to say
        }
        stamp = if (entries.isEmpty()) "" else entries.entries.joinToString("|") { "${it.key}=${it.value}" }.hashCode().toString(16)
    }

    private fun save(context: Context, map: Map<String, String>) {
        set(map)
        prefs(context).edit().putString("pronounce", JSONObject(entries).toString()).apply()
    }

    /** [text] with the reader's pronunciations applied. */
    fun apply(text: String): String {
        var t = text
        for ((re, say) in rules) t = re.replace(t) { say }
        return t
    }

    /** The list, to add, change or remove words. */
    fun show(activity: Activity, prefill: String? = null) {
        if (prefill != null) {
            edit(activity, prefill, entries[prefill].orEmpty())
            return
        }
        val words = entries.keys.toList()
        val labels = words.map { "$it  →  ${entries[it]}" } + "＋ Add a word"
        AlertDialog.Builder(activity)
            .setTitle("Pronunciations")
            .setItems(labels.toTypedArray()) { _, which ->
                if (which == words.size) edit(activity, "", "") else edit(activity, words[which], entries.getValue(words[which]))
            }
            .setNegativeButton("Close", null)
            .show()
    }

    private fun edit(activity: Activity, word: String, say: String) {
        val d = activity.resources.displayMetrics.density
        val wordBox = EditText(activity).apply {
            hint = "Word as written (e.g. Nguyen)"
            setText(word)
            isSingleLine = true
        }
        val sayBox = EditText(activity).apply {
            hint = "Say it as (e.g. Win)"
            setText(say)
            isSingleLine = true
        }
        val box = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding((20 * d).toInt(), (8 * d).toInt(), (20 * d).toInt(), 0)
            addView(wordBox)
            addView(sayBox)
        }
        val b = AlertDialog.Builder(activity)
            .setTitle(if (word.isBlank()) "Add a pronunciation" else "Pronunciation")
            .setMessage("Write it the way it sounds. It's used by every voice, in every book.")
            .setView(box)
            .setPositiveButton("Save") { _, _ ->
                val w = wordBox.text.toString().trim()
                val s = sayBox.text.toString().trim()
                if (w.isNotEmpty() && s.isNotEmpty()) save(activity, entries.filterKeys { !it.equals(word, true) } + (w to s))
            }
            .setNegativeButton("Cancel", null)
        if (entries.containsKey(word)) b.setNeutralButton("Delete") { _, _ -> save(activity, entries.filterKeys { !it.equals(word, true) }) }
        b.show()
    }
}
