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

    /** The value of a Roman numeral ("IV" → 4), or null if [w] isn't one. */
    internal fun romanValue(w: String): Int? {
        if (!Regex("""^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$""").matches(w) || w.isEmpty()) return null
        val v = mapOf('I' to 1, 'V' to 5, 'X' to 10, 'L' to 50, 'C' to 100, 'D' to 500, 'M' to 1000)
        var total = 0
        for (i in w.indices) {
            val c = v.getValue(w[i])
            total += if (i + 1 < w.length && c < v.getValue(w[i + 1])) -c else c
        }
        return total
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
            val status = android.widget.TextView(activity).apply {
                setTextColor(Themes.color(activity, R.attr.p2aMuted))
                textSize = 13f
            }
            fun small(label: String, onClick: () -> Unit) = android.widget.Button(activity, null, 0, R.style.P2A_Button_Text).apply {
                text = label
                isAllCaps = false
                setOnClickListener { onClick() }
            }
            // Abbreviations and Roman numerals ("IV" read as "four"): one tap for the usual ways to say them.
            val w0 = word.trim()
            if (w0.length in 1..8 && w0.none { it.isLowerCase() } && w0.any { it.isLetter() }) {
                val row = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL }
                val letters = w0.filter { it.isLetterOrDigit() }.toCharArray().joinToString(" ")
                row.addView(small("Letters: $letters") { sayBox.setText(letters) })
                row.addView(small("Word: ${w0.lowercase()}") { sayBox.setText(w0.lowercase()) })
                romanValue(w0)?.let { n -> row.addView(small("Number: $n") { sayBox.setText(n.toString()) }) }
                addView(android.widget.HorizontalScrollView(activity).apply { addView(row) })
            }
            val actions = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL }
            // Say it: the phone's speech recognition writes down how you say it.
            if (VoiceInput.available(activity)) actions.addView(small("🎤 Say it") {
                status.text = "Listening… say the word the way it should sound"
                VoiceInput.listen(activity, onPartial = { status.text = "“$it”" }, onError = { status.text = it }) { heard ->
                    // Heard back as written ("IV" for "eye vee"): it's said as letters.
                    val said = if (heard.trim().equals(w0, ignoreCase = true) && w0.none { it.isLowerCase() })
                        w0.filter { it.isLetterOrDigit() }.toCharArray().joinToString(" ") else heard.trim()
                    sayBox.setText(said)
                    status.text = "Heard “$said”. Tap Hear it to check, then Save."
                }
            })
            // Try it before saving: the current voice says it the way it's written in the second box.
            actions.addView(small("▶ Hear it") {
                val t = sayBox.text.toString().trim().ifEmpty { wordBox.text.toString().trim() }
                if (t.isNotEmpty()) Speaker.preview(text = t)
            })
            addView(actions)
            addView(status)
        }
        val b = AlertDialog.Builder(activity)
            .setTitle(if (word.isBlank()) "Add a pronunciation" else "Pronunciation")
            .setMessage("Write it the way it sounds, say it, or pick one of the ways below. It's used by every voice, in every book.")
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
