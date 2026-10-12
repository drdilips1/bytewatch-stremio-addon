package com.paper2audio.app

import android.app.Activity
import android.app.AlertDialog
import android.graphics.Typeface
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.BaseAdapter
import android.widget.CheckBox
import android.widget.EditText
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.TextView
import java.util.Locale

/**
 * Choosing voices: one list grouped by kind (your voices, best online voices,
 * on-device voices, every online voice by language, phone voices) with a search
 * box and a preview button on each voice. Used for the reading voice, and with
 * check boxes for picking several voices at once (the full-cast voices).
 */
object VoicePicker {
    class Entry(val id: String, val title: String, val detail: String, val group: String, val male: Boolean?)

    private class Row(val header: String?, val entry: Entry?)

    /** Every voice, in display order. */
    fun entries(lang: String? = null): List<Entry> {
        val out = ArrayList<Entry>()
        val seen = HashSet<String>()
        fun add(e: Entry) {
            if (seen.add(e.id)) out += e
        }
        fun edge(v: EdgeTts.VoiceInfo, group: String) {
            val person = v.name.substringAfterLast('-').removeSuffix("Neural").removeSuffix("Multilingual")
            val locale = Locale.forLanguageTag(v.locale).displayName
            val multi = if ("Multilingual" in v.name) " · reads many languages" else ""
            add(Entry(Speaker.EDGE + v.name, person, "$locale · ${v.gender.lowercase()}$multi · online", group, v.gender == "Male"))
        }
        val online = Speaker.onlineVoices

        if (lang != null && lang != "en") {
            val group = "Suggested for ${Langs.name(lang)}"
            online.filter { it.locale.startsWith("$lang-") }.forEach { edge(it, group) }
            if (LocalTts.supported && lang in LocalTts.SUPERTONIC_LANGS) {
                LocalTts.SUPERTONIC_VOICES.forEach { add(supertonic(it, group)) }
            }
        }
        if (LocalTts.supported) {
            MyVoices.own().forEach { v ->
                add(Entry(Speaker.CLONE + v.id, v.name, "your cloned voice · English · on this phone", "Your voices", null))
            }
        }
        EdgeTts.FAVORITES.forEach { edge(it, "★ Best natural voices (online)") }
        EdgeTts.CURATED.drop(EdgeTts.FAVORITES.size).forEach { edge(it, "★ Best natural voices (online)") }
        if (LocalTts.supported) {
            val pocket = packNote(LocalTts.POCKET_PACK)
            MyVoices.BUILT_IN.forEach { v ->
                add(Entry(Speaker.CLONE + v.id, v.name, "${v.description} · English · $pocket", "♥ Natural voices on your phone", v.description.startsWith("male")))
            }
            val kokoro = packNote(LocalTts.KOKORO_PACK)
            Kokoro.VOICES.forEach { v ->
                val parts = v.label.split(" · ")
                add(Entry(Speaker.KOKORO + v.name, parts.first(), parts.drop(1).joinToString(" · ") + " · $kokoro", "◆ Kokoro voices (English, offline)", v.name.getOrNull(1) == 'm'))
            }
            LocalTts.SUPERTONIC_VOICES.forEach { add(supertonic(it, "◆ Supertonic voices (31 languages, offline)")) }
        }
        online.sortedWith(compareBy({ Locale.forLanguageTag(it.locale).displayName }, { it.name }))
            .forEach { edge(it, "All online voices") }
        Speaker.voiceOptions().filter { it.id.startsWith(Speaker.SYSTEM) }.forEach {
            add(Entry(it.id, it.label.removePrefix("Phone · ").substringAfterLast(" · "), it.label.removePrefix("Phone · ").substringBeforeLast(" · "), "Phone voices", null))
        }
        return out
    }

    private fun supertonic(v: LocalTts.SVoice, group: String): Entry {
        val male = v.name.startsWith("M")
        return Entry(
            Speaker.SUPER + v.name, "Supertonic ${if (male) "male" else "female"} ${v.name.drop(1)}",
            "31 languages incl. Hindi · ${packNote(LocalTts.SUPERTONIC_PACK)}", group, male,
        )
    }

    private fun packNote(pack: ModelPack) = when {
        pack.isInstalled() -> "downloaded, offline"
        pack.installing -> "downloading…"
        else -> "needs a one-time ${pack.sizeMb} MB download"
    }

    /** Whether [id] sounds male (null: unknown). */
    fun isMale(id: String): Boolean? = entries().firstOrNull { it.id == id }?.male

    fun label(id: String): String = entries().firstOrNull { it.id == id }?.let { "${it.title} · ${it.detail}" } ?: id.substringAfter(':')

    /** Picks one voice for reading. */
    fun pickOne(activity: Activity, title: String, current: String?, filter: (Entry) -> Boolean = { true }, onPick: (String) -> Unit) =
        show(activity, title, multi = false, initial = setOfNotNull(current), filter = filter) { onPick(it.first()) }

    /** Picks several voices (check boxes). */
    fun pickMany(activity: Activity, title: String, initial: Set<String>, filter: (Entry) -> Boolean = { true }, onDone: (List<String>) -> Unit) =
        show(activity, title, multi = true, initial = initial, filter = filter, onDone = onDone)

    private fun show(
        activity: Activity,
        title: String,
        multi: Boolean,
        initial: Set<String>,
        filter: (Entry) -> Boolean,
        onDone: (List<String>) -> Unit,
    ) {
        val builder = AlertDialog.Builder(activity)
        val ctx = builder.context
        val d = activity.resources.displayMetrics.density
        fun dp(v: Int) = (v * d).toInt()
        val accent = Themes.color(activity, R.attr.p2aAccent)
        val textColor = TextView(ctx).currentTextColor
        val all = entries(Speaker.doc?.lang).filter(filter)
        val chosen = LinkedHashSet(initial)
        var rows: List<Row> = emptyList()

        val adapter = object : BaseAdapter() {
            override fun getCount() = rows.size
            override fun getItem(position: Int) = rows[position]
            override fun getItemId(position: Int) = position.toLong()
            override fun getViewTypeCount() = 2
            override fun getItemViewType(position: Int) = if (rows[position].header != null) 0 else 1
            override fun isEnabled(position: Int) = rows[position].entry != null

            override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
                val row = rows[position]
                if (row.header != null) {
                    val tv = (convertView as? TextView) ?: TextView(ctx).apply {
                        setPadding(dp(20), dp(16), dp(20), dp(4))
                        textSize = 13f
                        setTypeface(typeface, Typeface.BOLD)
                        setTextColor(accent)
                    }
                    tv.text = row.header
                    return tv
                }
                val e = row.entry!!
                val view = convertView as? LinearLayout ?: LinearLayout(ctx).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                    setPadding(dp(if (multi) 12 else 20), dp(4), dp(8), dp(4))
                    minimumHeight = dp(56)
                    if (multi) addView(CheckBox(ctx).apply {
                        isClickable = false
                        isFocusable = false
                        buttonTintList = android.content.res.ColorStateList.valueOf(accent)
                    })
                    val texts = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
                    texts.addView(TextView(ctx).apply {
                        textSize = 16f
                        setTypeface(typeface, Typeface.BOLD)
                    })
                    texts.addView(TextView(ctx).apply {
                        textSize = 12.5f
                        setTextColor(textColor)
                        alpha = 0.7f
                    })
                    addView(texts, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                    addView(ImageButton(ctx).apply {
                        setImageResource(R.drawable.ic_play)
                        setBackgroundResource(android.R.color.transparent)
                        imageTintList = android.content.res.ColorStateList.valueOf(accent)
                        isFocusable = false
                        contentDescription = "Preview"
                    }, LinearLayout.LayoutParams(dp(48), dp(48)))
                }
                val texts = view.getChildAt(if (multi) 1 else 0) as LinearLayout
                val on = e.id in chosen
                (texts.getChildAt(0) as TextView).apply {
                    text = if (!multi && on) "✓  ${e.title}" else e.title
                    setTextColor(if (!multi && on) accent else textColor)
                }
                (texts.getChildAt(1) as TextView).text = e.detail
                if (multi) (view.getChildAt(0) as CheckBox).isChecked = on
                (view.getChildAt(view.childCount - 1) as ImageButton).setOnClickListener { preview(activity, e.id) }
                return view
            }
        }

        fun render(query: String) {
            val words = query.lowercase().split(' ').filter { it.isNotBlank() }
            val out = ArrayList<Row>()
            var group: String? = null
            // While searching, a voice listed in two groups appears once.
            val shown = HashSet<String>()
            for (e in all) {
                if (words.isNotEmpty() && !words.all { w -> "${e.title} ${e.detail} ${e.group}".lowercase().contains(w) }) continue
                if (!shown.add(e.id + e.group)) continue
                if (e.group != group) {
                    group = e.group
                    out += Row(group, null)
                }
                out += Row(null, e)
            }
            rows = out
            adapter.notifyDataSetChanged()
        }

        val search = EditText(ctx).apply {
            hint = "Search voices, e.g. British, Hindi, female"
            isSingleLine = true
        }
        val list = ListView(ctx).apply {
            this.adapter = adapter
            divider = null
        }
        val box = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(8), dp(4), dp(8), 0)
            addView(search, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                marginStart = dp(12)
                marginEnd = dp(12)
            })
            addView(list, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (activity.resources.displayMetrics.heightPixels * 0.6).toInt()))
        }
        search.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit
            override fun afterTextChanged(s: Editable?) = render(s?.toString().orEmpty())
        })
        render("")

        builder.setTitle(title).setView(box)
        if (multi) {
            builder.setPositiveButton("Done") { _, _ -> onDone(chosen.toList()) }
            builder.setNeutralButton("Clear all") { _, _ -> onDone(emptyList()) }
        }
        builder.setNegativeButton("Cancel") { _, _ -> Speaker.stopPreview() }
        val dialog = builder.show()
        dialog.setOnDismissListener { Speaker.stopPreview() }
        list.setOnItemClickListener { _, _, position, _ ->
            val e = rows.getOrNull(position)?.entry ?: return@setOnItemClickListener
            if (multi) {
                if (!chosen.remove(e.id)) chosen += e.id
                adapter.notifyDataSetChanged()
            } else {
                dialog.dismiss()
                onDone(listOf(e.id))
            }
        }
        // Start at the current voice.
        if (!multi) initial.firstOrNull()?.let { id ->
            rows.indexOfFirst { it.entry?.id == id }.takeIf { it > 0 }?.let { list.setSelection(it - 1) }
        }
    }

    /** Plays a short sample, offering the download first for on-device voices that need one. */
    fun preview(activity: Activity, id: String) {
        val pack = LocalTts.missing(id)
        if (pack != null) {
            AlertDialog.Builder(activity)
                .setTitle("Download the ${pack.title}?")
                .setMessage("This voice runs on your phone, offline and unlimited. It needs a one-time download of about ${pack.sizeMb} MB (Wi-Fi is best).")
                .setPositiveButton("Download") { _, _ -> pack.install { Speaker.refreshVoices() } }
                .setNegativeButton("Not now", null)
                .show()
            return
        }
        Speaker.stopPreview()
        android.widget.Toast.makeText(activity, "Playing a sample…", android.widget.Toast.LENGTH_SHORT).show()
        Speaker.preview(voice = id)
    }
}
