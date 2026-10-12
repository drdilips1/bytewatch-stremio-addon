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

    /** The row at the right of the title, for the page's buttons. */
    protected val actions: LinearLayout get() = ui.actionsOf(body)

    fun refresh() {
        // Keep the small app name and the title; rebuild the rest.
        while (body.childCount > 2) body.removeViewAt(2)
        build()
    }

    /** What's shown on screen for this page (the page itself, or the page inside a pull-to-refresh). */
    open val root: View get() = view

    protected fun toast(msg: String) = Toast.makeText(activity, msg, Toast.LENGTH_LONG).show()

    protected fun aiOff() = AiLevel.of(activity) == AiLevel.PURE
}

// ---------------------------------------------------------------------------------------------

/**
 * Home: the book you're listening to (in its cover's colors), the ones to continue, and books
 * picked for you. Everything else lives in the tabs below and the + button.
 */
class HomePage(activity: Activity, host: PagesHost) : Page(activity, host) {
    private var heroButton: android.widget.Button? = null

    /** Pull down on Home: new picks (when AI is on) and the page brought up to date. */
    private val pull = PullToRefresh(activity, view) { newPicks() }
    override val root: View get() = pull

    /** Asks the AI for new picks, different from the ones shown before. */
    private fun newPicks() {
        if (aiOff() || !Llm.ready(activity)) {
            refresh()
            pull.done()
            if (aiOff()) toast("Turn on AI in Settings › AI to get picks for you")
            else AiKeyDialog.show(activity) { newPicks() }
            return
        }
        host.scope.launch {
            try {
                val before = shownPicks()
                val recs = withContext(Dispatchers.IO) { Brain.recommend(activity, "", avoid = before) }
                if (recs.isNotEmpty()) {
                    val arr = JSONArray()
                    recs.forEach { arr.put(JSONObject().put("t", it.title).put("a", it.author).put("w", it.why)) }
                    val shown = JSONArray((before + recs.map { it.title }).distinct().takeLast(80))
                    prefs.edit().putString("lastRecs", arr.toString()).putString("shownRecs", shown.toString())
                        .putBoolean("hidePicks", false).apply()
                }
            } catch (e: Exception) {
                toast(e.message ?: "Couldn't get new picks right now")
            } finally {
                refresh()
                pull.done()
            }
        }
    }

    /** Titles already suggested (so new picks are different). */
    private fun shownPicks(): List<String> = runCatching {
        val arr = JSONArray(prefs.getString("shownRecs", "[]"))
        (0 until arr.length()).map { arr.getString(it) }
    }.getOrDefault(emptyList()) + savedPicks().map { it.title }
    private var heroId: String? = null
    private val prefs = activity.getSharedPreferences("p2a", android.content.Context.MODE_PRIVATE)

    override fun title() = "Paper to Audio"

    init {
        actions.addView(ui.iconButton(R.drawable.ic_search, "Find a book") {
            activity.startActivity(Intent(activity, SearchActivity::class.java))
        }, LinearLayout.LayoutParams(ui.dp(44), ui.dp(44)).apply { marginEnd = ui.dp(8) })
        actions.addView(ui.button("Add", icon = R.drawable.ic_add) { host.showAddMenu() }.apply {
            minHeight = ui.dp(44)
            minimumHeight = ui.dp(44)
            setPadding(ui.dp(14), 0, ui.dp(16), 0)
        })
    }

    private fun greeting(): String {
        val h = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY)
        return when (h) {
            in 5..11 -> "Good morning"
            in 12..16 -> "Good afternoon"
            else -> "Good evening"
        }
    }

    /** Keeps the hero's Play/Pause in step with the player. */
    fun updatePlaying() {
        val b = heroButton ?: return
        val playing = Speaker.playing && Speaker.doc?.key == heroId
        b.text = if (playing) "Pause" else "Resume"
        b.setCompoundDrawablesRelativeWithIntrinsicBounds(if (playing) R.drawable.ic_pause else R.drawable.ic_play, 0, 0, 0)
    }

    override fun build() {
        (body.getChildAt(0) as TextView).apply {
            text = greeting()
            textSize = 13f
            letterSpacing = 0f
        }

        Updater.available?.takeIf { it.code > Updater.currentCode(activity) }?.let { r ->
            ui.row(body, R.drawable.ic_sync, "Update ready: version ${r.name}", "Tap to install. Your library and voices stay.") {
                if (activity is LibraryActivity) activity.startUpdate()
            }
        }

        val all = Library.items(activity)
        if (all.isEmpty()) {
            val c = ui.card(body, "Welcome")
            c.addView(ui.text("Add a book, a paper or a web article, and it's read aloud in a natural voice.", muted = true))
            c.addView(ui.button("Add your first book", icon = R.drawable.ic_add) { host.showAddMenu() }, ui.full(12))
            c.addView(ui.button("Find a free book", soft = true, icon = R.drawable.ic_search) {
                activity.startActivity(Intent(activity, SearchActivity::class.java))
            }, ui.full(8))
            return
        }

        // The book you're listening to.
        val current = Speaker.doc?.let { Library.get(activity, it.key) } ?: all.maxByOrNull { it.opened }
        if (current != null) hero(current)

        // Continue: the others, as covers.
        val recent = all.sortedByDescending { it.opened }.filter { it.id != current?.id }.take(12)
        if (recent.isNotEmpty()) {
            ui.heading(body, "Continue", link = "See all", onLink = { host.showTab(Tabs.LIBRARY) })
            val strip = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL }
            for (item in recent) {
                val cell = LinearLayout(activity).apply {
                    orientation = LinearLayout.VERTICAL
                    isClickable = true
                    setOnClickListener { host.openItem(item) }
                }
                cell.addView(bigCover(item, 150), LinearLayout.LayoutParams(ui.dp(150), ui.dp(225)))
                cell.addView(ui.text(item.title, 14.5f, bold = true).apply {
                    maxLines = 2
                    ellipsize = android.text.TextUtils.TruncateAt.END
                }, LinearLayout.LayoutParams(ui.dp(150), ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = ui.dp(10) })
                item.author?.let {
                    cell.addView(ui.text(it, 12.5f, muted = true).apply {
                        maxLines = 1
                        ellipsize = android.text.TextUtils.TruncateAt.END
                    }, LinearLayout.LayoutParams(ui.dp(150), ViewGroup.LayoutParams.WRAP_CONTENT))
                }
                strip.addView(cell, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginEnd = ui.dp(16) })
            }
            body.addView(HorizontalScrollView(activity).apply {
                isHorizontalScrollBarEnabled = false
                clipToPadding = false
                setPadding(0, ui.dp(4), 0, ui.dp(4))
                addView(strip)
            }, ui.full(6))
        }

        // Picked for you (from Discover), each book its own card.
        val picks = savedPicks()
        if (!aiOff() && picks.isNotEmpty() && !prefs.getBoolean("hidePicks", false)) {
            ui.heading(body, "✦  Picked for you", link = "↻ New", onLink = {
                toast("Finding new picks…")
                newPicks()
            }, link2 = "Hide", onLink2 = {
                prefs.edit().putBoolean("hidePicks", true).apply()
                toast("Hidden. Pull down for new picks; they also stay in Discover.")
                refresh()
            })
            val strip = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL }
            for (r in picks.take(8)) strip.addView(pickCard(r), LinearLayout.LayoutParams(ui.dp(264), ViewGroup.LayoutParams.MATCH_PARENT).apply { marginEnd = ui.dp(12) })
            body.addView(HorizontalScrollView(activity).apply {
                isHorizontalScrollBarEnabled = false
                addView(strip)
            }, ui.full(6))
        }
    }

    /** The current book, large, on a background made from its cover's colors. */
    private fun hero(item: Library.Item) {
        heroId = item.id
        val card = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(ui.dp(18), ui.dp(18), ui.dp(18), ui.dp(18))
            elevation = ui.dp(6).toFloat()
        }
        fun paint(tint: Int) {
            card.background = android.graphics.drawable.GradientDrawable(
                android.graphics.drawable.GradientDrawable.Orientation.TL_BR,
                intArrayOf(tint, blend(tint, 0xFF0B1F1B.toInt(), 0.55f)),
            ).apply { cornerRadius = ui.dp(26).toFloat() }
        }
        paint(0xFF1F5034.toInt())
        host.scope.launch {
            val bmp = Thumbs.load(Library.thumb(activity, item.id), ui.dp(96)) ?: return@launch
            paint(ui.coverTint(bmp))
        }
        val light = 0xFFF6F1E7.toInt()
        val soft = 0xCCF6F1E7.toInt()
        val top = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.BOTTOM
            isClickable = true
            setOnClickListener { host.openItem(item) }
        }
        val cover = ImageView(activity).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            setBackgroundResource(R.drawable.bg_thumb)
            elevation = ui.dp(8).toFloat()
            outlineProvider = android.view.ViewOutlineProvider.BACKGROUND
            clipToOutline = true
        }
        host.bindCover(cover, item.id)
        top.addView(cover, LinearLayout.LayoutParams(ui.dp(116), ui.dp(172)))
        val texts = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(ui.dp(16), 0, 0, ui.dp(2))
        }
        val listening = Speaker.doc?.key == item.id
        texts.addView(TextView(activity).apply {
            text = if (listening) "NOW LISTENING" else "CONTINUE"
            textSize = 11.5f
            letterSpacing = 0.1f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            setTextColor(soft)
        })
        texts.addView(TextView(activity).apply {
            text = item.title
            textSize = 22f
            maxLines = 3
            ellipsize = android.text.TextUtils.TruncateAt.END
            typeface = Themes.titleFont(activity)
            setTextColor(light)
            setPadding(0, ui.dp(4), 0, ui.dp(2))
        })
        val chapter = Speaker.doc?.takeIf { listening }?.chapterAt(Speaker.index)?.title
        listOfNotNull(item.author, chapter, Ratings.badge(activity, item)).joinToString(" · ").takeIf { it.isNotBlank() }?.let {
            texts.addView(TextView(activity).apply {
                text = it
                textSize = 13.5f
                maxLines = 2
                setTextColor(soft)
            })
        }
        top.addView(texts, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        card.addView(top)

        val pct = Library.progress(activity, item)
        val left = Library.minutesLeft(activity, item, Speaker.speed)
        card.addView(ProgressBar(activity, null, 0, R.style.P2A_Progress).apply {
            max = 100
            progress = pct
            progressTintList = android.content.res.ColorStateList.valueOf(light)
            progressBackgroundTintList = android.content.res.ColorStateList.valueOf(0x33FFFFFF)
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ui.dp(4)).apply { topMargin = ui.dp(16) })
        val meta = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL }
        meta.addView(TextView(activity).apply {
            text = "$pct%"
            textSize = 12f
            setTextColor(soft)
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        meta.addView(TextView(activity).apply {
            text = "${if (left >= 60) "${left / 60} h ${left % 60} min" else "$left min"} left"
            textSize = 12f
            setTextColor(soft)
        })
        card.addView(meta, ui.full(6))

        val buttons = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val play = android.widget.Button(activity, null, 0, R.style.P2A_Button).apply {
            background = android.graphics.drawable.RippleDrawable(
                android.content.res.ColorStateList.valueOf(0x22000000),
                android.graphics.drawable.GradientDrawable().apply {
                    setColor(light)
                    cornerRadius = ui.dp(26).toFloat()
                },
                null,
            )
            setTextColor(0xFF10241F.toInt())
            compoundDrawableTintList = android.content.res.ColorStateList.valueOf(0xFF10241F.toInt())
            minHeight = ui.dp(52)
            setOnClickListener { if (Speaker.doc?.key == item.id) Speaker.toggle() else host.openItem(item) }
        }
        heroButton = play
        updatePlaying()
        buttons.addView(play, LinearLayout.LayoutParams(0, ui.dp(52), 1f))
        buttons.addView(ImageView(activity).apply {
            setImageResource(R.drawable.ic_car)
            contentDescription = "Car mode"
            imageTintList = android.content.res.ColorStateList.valueOf(light)
            setPadding(ui.dp(14), ui.dp(14), ui.dp(14), ui.dp(14))
            background = android.graphics.drawable.GradientDrawable().apply {
                shape = android.graphics.drawable.GradientDrawable.OVAL
                setStroke(ui.dp(1), 0x66FFFFFF)
            }
            isClickable = true
            setOnClickListener {
                if (Speaker.doc?.key == item.id) activity.startActivity(Intent(activity, CarModeActivity::class.java))
                else host.openItem(item)
            }
        }, LinearLayout.LayoutParams(ui.dp(52), ui.dp(52)).apply { marginStart = ui.dp(10) })
        card.addView(buttons, ui.full(14))
        body.addView(card, ui.full(10))
    }

    /** A large cover, rounded, with the readers' rating and a progress line on it. */
    private fun bigCover(item: Library.Item, widthDp: Int): View {
        val box = android.widget.FrameLayout(activity).apply {
            elevation = ui.dp(8).toFloat()
            outlineProvider = object : android.view.ViewOutlineProvider() {
                override fun getOutline(v: View, o: android.graphics.Outline) =
                    o.setRoundRect(0, 0, v.width, v.height, ui.dp(12).toFloat())
            }
            clipToOutline = true
        }
        val cover = ImageView(activity).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            setBackgroundResource(R.drawable.bg_thumb)
        }
        host.bindCover(cover, item.id)
        box.addView(cover, android.widget.FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        Ratings.badge(activity, item)?.let { stars ->
            box.addView(TextView(activity).apply {
                text = stars
                textSize = 12f
                setTypeface(typeface, android.graphics.Typeface.BOLD)
                setTextColor(0xFFF5C542.toInt())
                setBackgroundResource(R.drawable.bg_rating)
                setPadding(ui.dp(8), ui.dp(3), ui.dp(8), ui.dp(3))
            }, android.widget.FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.START).apply {
                setMargins(ui.dp(8), ui.dp(8), 0, 0)
            })
        }
        val pct = Library.progress(activity, item)
        if (pct > 0) box.addView(ProgressBar(activity, null, 0, R.style.P2A_Progress).apply {
            max = 100
            progress = pct
        }, android.widget.FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ui.dp(4), Gravity.BOTTOM))
        return box
    }

    private fun blend(a: Int, b: Int, t: Float): Int {
        fun ch(shift: Int) = (((a shr shift) and 0xFF) * (1 - t) + ((b shr shift) and 0xFF) * t).toInt() shl shift
        return (0xFF shl 24) or ch(16) or ch(8) or ch(0)
    }

    private fun pickCard(r: Brain.Recommendation): View {
        val card = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundResource(R.drawable.bg_card)
            setPadding(ui.dp(14), ui.dp(14), ui.dp(14), ui.dp(10))
            isClickable = true
            setOnClickListener {
                activity.startActivity(Intent(activity, SearchActivity::class.java).putExtra("q", "${r.title} ${r.author}".trim()))
            }
        }
        card.addView(TextView(activity).apply {
            text = r.title
            textSize = 16f
            maxLines = 2
            ellipsize = android.text.TextUtils.TruncateAt.END
            typeface = Themes.titleFont(activity)
            setTextColor(ui.color(R.attr.p2aText))
        })
        if (r.author.isNotBlank()) card.addView(ui.text(r.author, 12.5f, muted = true))
        if (r.why.isNotBlank()) card.addView(ui.text(r.why, 13f).apply {
            maxLines = 3
            ellipsize = android.text.TextUtils.TruncateAt.END
        }, ui.full(6))
        card.addView(ui.textButton("Find and listen ›") {
            activity.startActivity(Intent(activity, SearchActivity::class.java).putExtra("q", "${r.title} ${r.author}".trim()))
        }.apply { setPadding(0, 0, 0, 0) })
        return card
    }

    private fun savedPicks(): List<Brain.Recommendation> = runCatching {
        val arr = JSONArray(prefs.getString("lastRecs", "[]"))
        (0 until arr.length()).map { arr.getJSONObject(it) }.map { Brain.Recommendation(it.optString("t"), it.optString("a"), it.optString("w")) }
    }.getOrDefault(emptyList())
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
        val want = Ratings.goodreadsWant(activity)
        if (want.isNotEmpty()) {
            ui.heading(body, "From your Goodreads “Want to read”")
            for ((title, author, rating) in want.take(30)) {
                val box = LinearLayout(activity).apply {
                    orientation = LinearLayout.VERTICAL
                    setBackgroundResource(R.drawable.bg_card)
                    setPadding(ui.dp(16), ui.dp(12), ui.dp(16), ui.dp(8))
                }
                box.addView(TextView(activity).apply {
                    text = title
                    textSize = 17f
                    typeface = Themes.titleFont(activity)
                    setTextColor(ui.color(R.attr.p2aText))
                })
                box.addView(ui.text(listOfNotNull(author.ifBlank { null }, if (rating > 0) "★ %.2f on Goodreads".format(rating) else null).joinToString(" · "), 13f, muted = true))
                box.addView(ui.textButton("Find and listen ›") {
                    activity.startActivity(Intent(activity, SearchActivity::class.java).putExtra("q", "$title $author".trim()))
                }.apply { setPadding(0, 0, 0, 0) })
                body.addView(box, ui.full(10))
            }
        }
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
        if (recs.isNotEmpty() && prefs.getBoolean("hidePicks", false)) {
            into.addView(ui.textButton("Show these picks on Home again") {
                prefs.edit().putBoolean("hidePicks", false).apply()
                toast("They'll show on Home")
                show(into, recs)
            })
        }
        for (r in recs) {
            // Each book its own card, so one doesn't run into the next.
            val box = LinearLayout(activity).apply {
                orientation = LinearLayout.VERTICAL
                setBackgroundResource(R.drawable.bg_card)
                setPadding(ui.dp(16), ui.dp(14), ui.dp(16), ui.dp(10))
            }
            box.addView(TextView(activity).apply {
                text = r.title
                textSize = 18f
                typeface = Themes.titleFont(activity)
                setTextColor(ui.color(R.attr.p2aText))
            })
            if (r.author.isNotBlank()) box.addView(ui.text(r.author, 13f, muted = true))
            if (r.why.isNotBlank()) box.addView(ui.text(r.why, 14f), ui.full(6))
            val row = LinearLayout(activity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
            }
            row.addView(ui.button("Find and listen") {
                activity.startActivity(Intent(activity, SearchActivity::class.java).putExtra("q", "${r.title} ${r.author}".trim()))
            }.apply { minHeight = ui.dp(40); minimumHeight = ui.dp(40) })
            row.addView(ui.textButton("Not for me") {
                val left = saved().filterNot { it.title == r.title && it.author == r.author }
                save(left)
                show(into, left)
            })
            box.addView(row, ui.full(10))
            into.addView(box, ui.full(12))
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

        look.addView(ui.textButton("Reading look: fonts, size, spacing, margins, day or night ›") { ReadingLook.show(activity) {} })

        // Ratings and Goodreads.
        val gr = ui.section(body, R.drawable.ic_explore, "Ratings and Goodreads", "goodreads")
        ui.switch(gr, "Show readers' ratings on covers", Ratings.enabled(activity)) {
            Ratings.setEnabled(activity, it)
            host.showTab(Tabs.SETTINGS)
        }
        gr.addView(ui.text("Ratings come from Open Library or Google Books, or from Goodreads when you import your Goodreads library. (Goodreads has no way for apps to look ratings up.)", 13f, muted = true), ui.full(4))
        gr.addView(ui.textButton("Import my Goodreads library ›") { (activity as? LibraryActivity)?.importGoodreads() })

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
        play.addView(ui.textButton("Pronunciations: fix how words are said ›") { Pronounce.show(activity) })
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
