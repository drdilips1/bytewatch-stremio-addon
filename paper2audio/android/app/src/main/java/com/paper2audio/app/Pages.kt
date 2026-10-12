package com.paper2audio.app

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/** What the tab pages need from the main screen. */
interface PagesHost {
    val scope: CoroutineScope
    fun showTab(tab: Int)
    fun openItem(item: Library.Item)
    fun showAddMenu()
    fun showAccount()
    fun bindCover(view: ImageView, id: String)
}

object Tabs {
    const val HOME = 0
    const val LIBRARY = 1
    const val ASK = 2
    const val DISCOVER = 3
    const val SETTINGS = 4
    val LABELS = listOf("Home", "Library", "Ask AI", "Discover", "Settings")
    val ICONS = listOf(R.drawable.ic_home, R.drawable.ic_list, R.drawable.ic_sparkle, R.drawable.ic_explore, R.drawable.ic_settings)
}

/** A tab page built in code; [refresh] rebuilds it with current data. */
abstract class Page(protected val activity: Activity, protected val host: PagesHost) {
    protected val ui = Ui(activity)
    val view: android.widget.ScrollView
    protected val body: LinearLayout

    init {
        val (scroll, b) = ui.page(title())
        view = scroll
        body = b
    }

    abstract fun title(): String
    protected abstract fun build()

    fun refresh() {
        // Keep the small app name and the title; rebuild the rest.
        while (body.childCount > 2) body.removeViewAt(2)
        build()
    }

    protected fun toast(msg: String) = Toast.makeText(activity, msg, Toast.LENGTH_LONG).show()

    protected fun aiOff() = AiLevel.of(activity) == AiLevel.PURE
}

// ---------------------------------------------------------------------------------------------

/** Home: continue listening, quick ways in, search for books. */
class HomePage(activity: Activity, host: PagesHost) : Page(activity, host) {
    override fun title() = "Home"

    override fun build() {
        // Search books (Bookracy and free classics) right at the top.
        val search = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundResource(R.drawable.bg_card)
            setPadding(ui.dp(16), 0, ui.dp(8), 0)
        }
        search.addView(ImageView(activity).apply {
            setImageResource(R.drawable.ic_search)
            imageTintList = android.content.res.ColorStateList.valueOf(ui.color(R.attr.p2aMuted))
        }, LinearLayout.LayoutParams(ui.dp(22), ui.dp(22)))
        val q = EditText(activity).apply {
            hint = "Find a book to listen to…"
            background = null
            isSingleLine = true
            imeOptions = EditorInfo.IME_ACTION_SEARCH
            minHeight = ui.dp(52)
            setTextColor(ui.color(R.attr.p2aText))
            setHintTextColor(ui.color(R.attr.p2aMuted))
            setOnEditorActionListener { _, id, _ ->
                if (id == EditorInfo.IME_ACTION_SEARCH) {
                    activity.startActivity(Intent(activity, SearchActivity::class.java).putExtra("q", text.toString()))
                }
                id == EditorInfo.IME_ACTION_SEARCH
            }
        }
        search.addView(q, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = ui.dp(10) })
        body.addView(search, ui.full(12))

        Updater.available?.takeIf { it.code > Updater.currentCode(activity) }?.let { r ->
            ui.row(body, R.drawable.ic_sync, "Update ready: version ${r.name}", "Tap to install. Your library and voices stay.") {
                if (activity is LibraryActivity) activity.startUpdate()
            }
        }

        // Continue listening.
        val current = Speaker.doc?.let { Library.get(activity, it.key) }
            ?: Library.items(activity).maxByOrNull { it.opened }
        if (current != null) {
            val c = ui.card(body, "🎧 Continue listening")
            val row = LinearLayout(activity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                isClickable = true
                setOnClickListener { host.openItem(current) }
            }
            val cover = ImageView(activity).apply {
                scaleType = ImageView.ScaleType.CENTER_CROP
                setBackgroundResource(R.drawable.bg_thumb)
            }
            host.bindCover(cover, current.id)
            row.addView(cover, LinearLayout.LayoutParams(ui.dp(64), ui.dp(88)))
            val texts = LinearLayout(activity).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(ui.dp(14), 0, 0, 0)
            }
            texts.addView(ui.text(current.title, 17f, bold = true).apply { maxLines = 2 })
            current.author?.let { texts.addView(ui.text(it, 13f, muted = true)) }
            val pct = Library.progress(activity, current)
            val left = Library.minutesLeft(activity, current, Speaker.speed)
            texts.addView(ui.text("$pct% · ${if (left >= 60) "${left / 60} h ${left % 60} min" else "$left min"} left", 13f, muted = true))
            row.addView(texts, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            c.addView(row)
            val buttons = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL }
            val playing = Speaker.playing && Speaker.doc?.key == current.id
            buttons.addView(ui.button(if (playing) "Pause" else "Play", icon = if (playing) R.drawable.ic_pause else R.drawable.ic_play) {
                if (Speaker.doc?.key == current.id) Speaker.toggle() else host.openItem(current)
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = ui.dp(5) })
            buttons.addView(ui.button("Car mode", soft = true, icon = R.drawable.ic_car) {
                if (Speaker.doc?.key == current.id) activity.startActivity(Intent(activity, CarModeActivity::class.java))
                else host.openItem(current)
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = ui.dp(5) })
            c.addView(buttons, ui.full(12))
        }

        // Recently opened, as covers.
        val recent = Library.items(activity).sortedByDescending { it.opened }.filter { it.id != current?.id }.take(10)
        if (recent.isNotEmpty()) {
            body.addView(ui.text("Recently opened", 16f, bold = true), ui.full(18))
            val strip = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL }
            for (item in recent) {
                val cell = LinearLayout(activity).apply {
                    orientation = LinearLayout.VERTICAL
                    isClickable = true
                    setOnClickListener { host.openItem(item) }
                }
                val cover = ImageView(activity).apply {
                    scaleType = ImageView.ScaleType.CENTER_CROP
                    setBackgroundResource(R.drawable.bg_thumb)
                }
                host.bindCover(cover, item.id)
                cell.addView(cover, LinearLayout.LayoutParams(ui.dp(92), ui.dp(128)))
                cell.addView(ui.text(item.title, 12f).apply { maxLines = 2; width = ui.dp(92) })
                strip.addView(cell, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginEnd = ui.dp(12) })
            }
            body.addView(HorizontalScrollView(activity).apply {
                isHorizontalScrollBarEnabled = false
                addView(strip)
            }, ui.full(8))
        }

        ui.row(body, R.drawable.ic_list, "📚  Books", "${Library.items(activity).size} in your library", top = 18) { host.showTab(Tabs.LIBRARY) }
        val collections = Library.collections(activity)
        if (collections.isNotEmpty()) {
            ui.row(body, R.drawable.ic_bookmark, "🎓  Courses and collections", collections.take(4).joinToString(", ")) { host.showTab(Tabs.LIBRARY) }
        }
        if (!aiOff()) {
            ui.row(body, R.drawable.ic_explore, "✨  AI Discover", "What to read next, for your taste") { host.showTab(Tabs.DISCOVER) }
            ui.row(body, R.drawable.ic_sparkle, "🔍  Ask your library", "“What have I learned about…?”") {
                AskSheet.forLibrary(activity, host.scope)
            }
        }
        ui.row(body, R.drawable.ic_add, "⬆  Import", "Files, links, Bookracy, scans, pasted text") { host.showAddMenu() }
    }
}

// ---------------------------------------------------------------------------------------------

/** Ask AI: about the book you're listening to, or your whole library; by voice or typing. */
class AskPage(activity: Activity, host: PagesHost) : Page(activity, host) {
    private var status: TextView? = null
    private val brainListener: () -> Unit = { status?.text = brainStatus() }

    override fun title() = "Ask AI"

    private fun brainStatus(): String {
        val (ready, total) = Brain.readiness(activity)
        return Brain.status ?: "$ready of $total documents are ready for questions."
    }

    override fun build() {
        if (aiOff()) {
            val c = ui.card(body, "AI is off")
            c.addView(ui.text("You chose Pure audiobook in Settings › AI. Switch to AI-assisted to ask questions.", muted = true))
            c.addView(ui.button("Open Settings") { host.showTab(Tabs.SETTINGS) }, ui.full(10))
            return
        }
        if (!Llm.ready(activity)) {
            val c = ui.card(body, "Set up AI (free)")
            c.addView(ui.text("Paste a free Groq key once (2 minutes, no card). Then ask anything by voice or text.", muted = true))
            c.addView(ui.button("Add a free Groq key") { AiKeyDialog.show(activity) { refresh() } }, ui.full(10))
        }
        val doc = Speaker.doc
        if (doc != null) {
            val c = ui.card(body, "About what you're hearing")
            c.addView(ui.text(doc.title, 15f, bold = true))
            c.addView(ui.text("Explain, give an example, define words, “what happened so far?”, or any question. Answers are read aloud, then the book carries on.", 13f, muted = true))
            val row = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL }
            row.addView(ui.button("🎤  Ask by voice") { AskSheet.forBook(activity, host.scope, listenNow = true) },
                LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = ui.dp(5) })
            row.addView(ui.button("Type a question", soft = true) { AskSheet.forBook(activity, host.scope) },
                LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = ui.dp(5) })
            c.addView(row, ui.full(10))
            c.addView(ui.textButton("Other versions of this book: Essential, Deep, Teach me…") { Versions.choose(activity) })
        }
        val c = ui.card(body, "Ask your library")
        c.addView(ui.text("“What have I learned about consciousness?” · “Which books contradict each other?” · “What haven't I explored?”", 13f, muted = true))
        val row = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL }
        row.addView(ui.button("🎤  Ask by voice") { AskSheet.forLibrary(activity, host.scope, listenNow = true) },
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = ui.dp(5) })
        row.addView(ui.button("Type a question", soft = true) { AskSheet.forLibrary(activity, host.scope) },
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = ui.dp(5) })
        c.addView(row, ui.full(10))
        status = ui.text(brainStatus(), 13f, muted = true)
        c.addView(status, ui.full(12))
        c.addView(ui.textButton(if (Brain.running) "Stop getting ready" else "Get my library ready for questions") {
            if (Brain.running) Brain.cancel() else AiKeyDialog.withKey(activity) { Brain.prepareAll(activity) }
            refresh()
        })
        c.addView(ui.text("The AI reads each book once and keeps a short summary of it on your phone, so it can answer across your whole library.", 12f, muted = true))
    }

    fun attach() = Brain.addListener(brainListener)
    fun detach() = Brain.removeListener(brainListener)
}

// ---------------------------------------------------------------------------------------------

/** AI Discover: learns the reader's taste and recommends what to read next. */
class DiscoverPage(activity: Activity, host: PagesHost) : Page(activity, host) {
    private val prefs = activity.getSharedPreferences("p2a", android.content.Context.MODE_PRIVATE)

    override fun title() = "Discover"

    override fun build() {
        if (aiOff()) {
            val c = ui.card(body, "AI is off")
            c.addView(ui.text("Discover uses AI to learn your taste. Turn on AI-assisted in Settings › AI, or search books directly.", muted = true))
            c.addView(ui.button("Search books") { activity.startActivity(Intent(activity, SearchActivity::class.java)) }, ui.full(10))
            return
        }
        val taste = ui.card(body, "Your reading taste")
        taste.addView(ui.text("Recommendations follow your intellectual taste, not what's popular. Edit it freely.", 13f, muted = true))
        val profile = EditText(activity).apply {
            setText(Brain.profile(activity) ?: "")
            hint = "Enjoys: deep nonfiction, psychology, history…\nPrefers: big ideas, narrative…\nAvoids: shallow self-help…"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            minLines = 3
            setTextColor(ui.color(R.attr.p2aText))
            setHintTextColor(ui.color(R.attr.p2aMuted))
        }
        taste.addView(profile, ui.full(6))
        val tasteRow = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL }
        tasteRow.addView(ui.button("Learn from my library", soft = true) {
            AiKeyDialog.withKey(activity) {
                toast("Looking at your library…")
                host.scope.launch {
                    try {
                        profile.setText(withContext(Dispatchers.IO) { Brain.learnProfile(activity) })
                    } catch (e: Exception) {
                        toast(e.message ?: "Couldn't learn your taste right now")
                    }
                }
            }
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = ui.dp(5) })
        tasteRow.addView(ui.button("Save", soft = true) {
            Brain.setProfile(activity, profile.text.toString())
            DriveSync.request(activity)
            toast("Saved")
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginStart = ui.dp(5) })
        taste.addView(tasteRow, ui.full(8))

        val ask = ui.card(body, "✨ What should I read next?")
        val wish = EditText(activity).apply {
            hint = "Optional: what are you in the mood for?"
            isSingleLine = true
            setTextColor(ui.color(R.attr.p2aText))
            setHintTextColor(ui.color(R.attr.p2aMuted))
        }
        ask.addView(wish)
        val busy = ProgressBar(activity, null, 0, R.style.P2A_Progress).apply {
            isIndeterminate = true
            visibility = View.GONE
        }
        val results = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        ask.addView(ui.button("Recommend books for me") {
            AiKeyDialog.withKey(activity) {
                if (profile.text.isNotBlank()) Brain.setProfile(activity, profile.text.toString())
                busy.visibility = View.VISIBLE
                host.scope.launch {
                    try {
                        val recs = withContext(Dispatchers.IO) { Brain.recommend(activity, wish.text.toString()) }
                        if (Brain.profile(activity) != null) profile.setText(Brain.profile(activity))
                        save(recs)
                        show(results, recs)
                    } catch (e: Exception) {
                        toast(e.message ?: "Couldn't get recommendations right now")
                    } finally {
                        busy.visibility = View.GONE
                    }
                }
            }
        }, ui.full(8))
        ask.addView(busy)
        ask.addView(results)
        show(results, saved())
        ui.row(body, R.drawable.ic_search, "Search books yourself", "Bookracy and free classics") {
            activity.startActivity(Intent(activity, SearchActivity::class.java))
        }
    }

    private fun save(recs: List<Brain.Recommendation>) {
        val arr = JSONArray()
        recs.forEach { arr.put(JSONObject().put("t", it.title).put("a", it.author).put("w", it.why)) }
        prefs.edit().putString("lastRecs", arr.toString()).apply()
    }

    private fun saved(): List<Brain.Recommendation> = runCatching {
        val arr = JSONArray(prefs.getString("lastRecs", "[]"))
        (0 until arr.length()).map { arr.getJSONObject(it) }.map { Brain.Recommendation(it.optString("t"), it.optString("a"), it.optString("w")) }
    }.getOrDefault(emptyList())

    private fun show(into: LinearLayout, recs: List<Brain.Recommendation>) {
        into.removeAllViews()
        for (r in recs) {
            val box = LinearLayout(activity).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(0, ui.dp(12), 0, ui.dp(4))
            }
            box.addView(ui.text(r.title, 16f, bold = true))
            if (r.author.isNotBlank()) box.addView(ui.text(r.author, 13f, muted = true))
            if (r.why.isNotBlank()) box.addView(ui.text(r.why, 14f))
            box.addView(ui.textButton("Find and listen ›") {
                activity.startActivity(Intent(activity, SearchActivity::class.java).putExtra("q", "${r.title} ${r.author}".trim()))
            })
            into.addView(box)
        }
    }
}

// ---------------------------------------------------------------------------------------------

/** Settings, in sections that open and close: account, appearance, playback, voices, AI, updates. */
class SettingsPage(activity: Activity, host: PagesHost) : Page(activity, host) {
    override fun title() = "Settings"

    override fun build() {
        // Account card at the top.
        val signedIn = Account.signedIn(activity)
        ui.row(
            body, R.drawable.ic_account,
            if (signedIn) Account.email(activity) ?: "Signed in" else "Sign in",
            if (signedIn) "Library, positions and settings sync" else "Sync your library across devices (same account as Inkwell)",
        ) { host.showAccount() }

        // Appearance.
        val look = ui.section(body, R.drawable.ic_palette, "Appearance", "appearance")
        val current = Themes.currentKey(activity)
        for (t in Themes.ALL) {
            look.addView(ui.textButton((if (t.key == current) "✓  " else "     ") + t.label.trim()) {
                if (t.key != current) {
                    Themes.set(activity, t.key)
                    DriveSync.request(activity)
                    activity.recreate()
                }
            })
        }

        // Playback.
        val play = ui.section(body, R.drawable.ic_play, "Playback", "playback")
        play.addView(ui.textButton("Speaking style: ${Speaker.style.label} ›") {
            val styles = Style.entries
            AlertDialog.Builder(activity)
                .setTitle("Speaking style")
                .setSingleChoiceItems(styles.map { "${it.label}\n${it.note}" }.toTypedArray(), styles.indexOf(Speaker.style)) { d, i ->
                    d.dismiss()
                    Speaker.setStyle(styles[i])
                    refresh()
                }
                .show()
        })
        play.addView(ui.textButton("Speed: ${"%.2f".format(Speaker.speed).trimEnd('0').trimEnd('.')}× ›") {
            val speeds = listOf(0.75f, 0.9f, 1f, 1.1f, 1.25f, 1.5f, 1.75f, 2f, 2.5f, 3f)
            AlertDialog.Builder(activity)
                .setTitle("Speed")
                .setItems(speeds.map { "${it}×" }.toTypedArray()) { _, i ->
                    Speaker.setSpeed(speeds[i])
                    refresh()
                }
                .show()
        })
        ui.switch(play, "Skip front and back matter (contents, copyright, preface, index…), so books start at the introduction", Speaker.skipFront) {
            Speaker.setSkipFront(it)
        }
        ui.switch(play, "Family listening: slower and clearer, simple explanations", Speaker.style == Style.FAMILY) { on ->
            Speaker.setStyle(if (on) Style.FAMILY else Style.STANDARD)
        }
        ui.switch(play, "Medical mode: read doses and trial abbreviations in full", Speaker.medical) { Speaker.setMedical(it) }
        play.addView(ui.textButton("Keep playing with the screen locked ›") { Battery.ask(activity) })
        play.addView(ui.textButton("Car mode: big buttons and voice commands ›") {
            activity.startActivity(Intent(activity, CarModeActivity::class.java))
        })

        // Voices.
        val voices = ui.section(body, R.drawable.ic_voice, "Voices", "voices")
        voices.addView(ui.text("Reading voice: ${VoicePicker.label(Speaker.voiceId)}", 14f, muted = true))
        voices.addView(ui.textButton("Choose a voice ›") {
            VoicePicker.pickOne(activity, "Reading voice", Speaker.voiceId) {
                Speaker.setVoice(it)
                LocalTts.missing(it)?.let { pack -> VoicePicker.preview(activity, it) }
                refresh()
            }
        })
        voices.addView(ui.textButton("Voice studio: clone a voice, full cast, Kokoro and Supertonic ›") {
            activity.startActivity(Intent(activity, VoiceStudioActivity::class.java))
        })
        ui.switch(voices, "Full cast: a voice per character, kept for the whole book and series", Speaker.fullCast) { Speaker.setFullCast(it) }

        // AI.
        val ai = ui.section(body, R.drawable.ic_sparkle, "AI", "ai")
        ai.addView(ui.text("How much AI", 15f, bold = true))
        val levels = android.widget.RadioGroup(activity)
        for ((i, level) in AiLevel.entries.withIndex()) {
            levels.addView(android.widget.RadioButton(activity).apply {
                id = 100 + i
                text = "${level.label}\n${level.note}"
                setTextColor(ui.color(R.attr.p2aText))
                setPadding(ui.dp(4), ui.dp(6), 0, ui.dp(6))
            })
        }
        levels.check(100 + AiLevel.of(activity).ordinal)
        levels.setOnCheckedChangeListener { _, id ->
            AiLevel.set(activity, AiLevel.entries[id - 100])
            DriveSync.request(activity)
        }
        ai.addView(levels)
        ai.addView(ui.text("AI service: ${if (Llm.ready(activity)) Llm.name(activity) else "not set up"}", 14f, muted = true), ui.full(10))
        ai.addView(ui.textButton("Groq and Gemini keys (free) ›") { AiKeyDialog.show(activity) { refresh() } })
        ui.switch(ai, "Read answers aloud", activity.getSharedPreferences("p2a", 0).getBoolean("speakAnswers", true)) {
            activity.getSharedPreferences("p2a", 0).edit().putBoolean("speakAnswers", it).apply()
        }
        ui.switch(ai, "Carry on with the book after an answer", activity.getSharedPreferences("p2a", 0).getBoolean("resumeAfterAnswer", true)) {
            activity.getSharedPreferences("p2a", 0).edit().putBoolean("resumeAfterAnswer", it).apply()
        }

        // Updates and about.
        val about = ui.section(body, R.drawable.ic_info, "Updates and about", "about")
        about.addView(ui.text("Paper to Audio ${Updater.currentName(activity)}", 14f, muted = true))
        about.addView(ui.textButton("Check for updates ›") { if (activity is LibraryActivity) activity.checkUpdates() })
        about.addView(ui.textButton("Open the download page ›") {
            runCatching {
                activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://github.com/drdilips1/bytewatch-stremio-addon/releases/tag/paper2audio-apk")))
            }
        })
    }
}

/** Asks Android to let playback run with the screen off (some phones stop apps that use the battery). */
object Battery {
    fun ask(activity: Activity) {
        val pm = activity.getSystemService(android.os.PowerManager::class.java)
        if (pm.isIgnoringBatteryOptimizations(activity.packageName)) {
            Toast.makeText(activity, "Already allowed: playback keeps going with the screen locked.", Toast.LENGTH_LONG).show()
            return
        }
        runCatching {
            activity.startActivity(
                Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${activity.packageName}"))
            )
        }.onFailure {
            runCatching { activity.startActivity(Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
        }
    }
}
