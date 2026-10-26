package com.paper2audio.app

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Typeface
import android.os.Bundle
import android.text.Spannable
import android.text.SpannableString
import android.text.style.BackgroundColorSpan
import android.text.style.ForegroundColorSpan
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.AbsListView
import android.widget.BaseAdapter
import android.widget.Button
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.ProgressBar
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The Play Store edition's player: the text, with the sentence being read
 * highlighted; play, sentence back and forward; speed, voice and sleep timer.
 */
class LitePlayerActivity : Activity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val prefs by lazy { getSharedPreferences("p2a", MODE_PRIVATE) }
    private lateinit var reader: ListView
    private lateinit var title: TextView
    private lateinit var status: TextView
    private lateinit var position: SeekBar
    private lateinit var where: TextView
    private lateinit var left: TextView
    private lateinit var btnPlay: ImageButton
    private lateinit var btnSpeed: Button
    private lateinit var btnVoice: Button
    private lateinit var btnSleep: Button
    private lateinit var taskBox: LinearLayout
    private lateinit var taskText: TextView
    private lateinit var taskProgress: ProgressBar
    private lateinit var taskOpen: Button
    private lateinit var taskCancel: Button

    private var shownIndex = -1
    private var shownPiece: String? = null
    private var lastUserScroll = 0L
    private var draggingPosition = false
    private var exportWasRunning = Exporter.running
    private var textSizeSp = 18f
    private var justify = true
    private var spacing = 1.35f
    private var face: Typeface? = null

    /** The text as set in Reading look: font, size, spacing, alignment, margins and page color. */
    private fun loadLook() {
        textSizeSp = ReadingLook.textSize(this)
        spacing = ReadingLook.spacing(this)
        justify = ReadingLook.alignment(this) == "justify"
        face = ReadingLook.typeface(this)
        if (::reader.isInitialized) {
            val paper = ReadingLook.paper(this)
            if (paper != null) reader.setBackgroundColor(paper.background) else reader.background = null
            val side = ((8 + ReadingLook.margin(this)) * resources.displayMetrics.density).toInt()
            reader.setPadding(side, reader.paddingTop, side, reader.paddingBottom)
        }
    }
    private val refresh: () -> Unit = { render() }
    private val ticker = object : Runnable {
        override fun run() {
            btnSleep.text = LiteUi.sleepLabel()
            reader.postDelayed(this, 30_000)
        }
    }

    /** Moves the highlight along the words as they are spoken, and keeps them in view. */
    private val follower = object : Runnable {
        override fun run() {
            if (Speaker.playing) followWords()
            reader.postDelayed(this, 120)
        }
    }

    private fun followWords() {
        val i = Speaker.index
        val tv = reader.getChildAt(i - reader.firstVisiblePosition) as? TextView ?: return
        val text = Speaker.doc?.paragraphs?.getOrNull(i) ?: return
        tv.text = highlighted(text, true)
        // Keep the line being read in the upper part of the screen, with a gentle scroll.
        if (System.currentTimeMillis() - lastUserScroll < 6_000) return
        val layout = tv.layout ?: return
        val piece = Speaker.currentPiece ?: return
        val start = text.indexOf(piece).takeIf { it >= 0 } ?: return
        val at = (start + (piece.length * Speaker.pieceProgress()).toInt()).coerceIn(0, maxOf(0, text.length - 1))
        val lineY = tv.top + tv.totalPaddingTop + layout.getLineTop(layout.getLineForOffset(at))
        val h = reader.height
        // The line being read stays near the middle, like Audiohub's read-along.
        if (h > 0 && (lineY > h * 0.55 || lineY < h * 0.2)) reader.smoothScrollBy(lineY - (h * 0.4).toInt(), 700)
    }

    /**
     * Read-along like Audiohub's: the sentence being read in full color with the word being spoken
     * in the accent color, what's still to come dimmed, and what's been read dimmer still.
     */
    private fun highlighted(text: String, current: Boolean): CharSequence {
        val piece = Speaker.currentPiece
        val start = if (current && piece != null) text.indexOf(piece) else -1
        if (start < 0) return text
        val end = start + piece!!.length
        val ink = Themes.color(this, R.attr.p2aText) and 0x00FFFFFF
        val span = SpannableString(text)
        if (!Speaker.playing) {
            // Paused: the sentence stays marked, so you can see where you are.
            span.setSpan(BackgroundColorSpan((Themes.color(this, R.attr.p2aAccent) and 0x00FFFFFF) or 0x30000000), start, end, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
            return span
        }
        if (start > 0) span.setSpan(ForegroundColorSpan(ink or 0x59000000), 0, start, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE) // read
        if (end < text.length) span.setSpan(ForegroundColorSpan(ink or 0x80000000.toInt()), end, text.length, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE) // to come
        // Where the voice is, estimated from how much of the sentence's audio has played.
        var at = start + (piece.length * Speaker.pieceProgress()).toInt().coerceIn(0, piece.length)
        while (at < end && !text[at].isWhitespace()) at++ // to the end of the word being spoken
        var wordStart = at
        while (wordStart > start && !text[wordStart - 1].isWhitespace()) wordStart--
        if (at > wordStart) span.setSpan(ForegroundColorSpan(Themes.color(this, R.attr.p2aAccent)), wordStart, at, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
        return span
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        Themes.apply(this)
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_lite_player)
        LiteUi.fitSystemBars(this, findViewById(R.id.liteRoot))
        reader = findViewById(R.id.reader)
        title = findViewById(R.id.docTitle)
        status = findViewById(R.id.status)
        position = findViewById(R.id.position)
        where = findViewById(R.id.where)
        left = findViewById(R.id.left)
        btnPlay = findViewById(R.id.btnPlay)
        btnSpeed = findViewById(R.id.btnSpeed)
        btnVoice = findViewById(R.id.btnVoice)
        btnSleep = findViewById(R.id.btnSleep)
        taskBox = findViewById(R.id.taskBox)
        taskText = findViewById(R.id.taskText)
        taskProgress = findViewById(R.id.taskProgress)
        taskOpen = findViewById(R.id.taskOpen)
        taskCancel = findViewById(R.id.taskCancel)
        ReadingLook.moveNarratoSettings(this)
        loadLook()

        loadLook()
        reader.adapter = readerAdapter
        reader.setOnItemClickListener { _, _, i, _ ->
            lastUserScroll = 0
            Speaker.seek(i)
            if (!Speaker.playing) Speaker.play()
        }
        // Press and hold a word: fix how it's said, or play from there.
        reader.setOnTouchListener { _, e ->
            if (e.actionMasked == android.view.MotionEvent.ACTION_DOWN) {
                touchX = e.x
                touchY = e.y
            }
            false
        }
        reader.setOnItemLongClickListener { _, view, i, _ ->
            wordMenu(view, i)
            true
        }
        reader.setOnScrollListener(object : AbsListView.OnScrollListener {
            override fun onScrollStateChanged(view: AbsListView, state: Int) {
                if (state != AbsListView.OnScrollListener.SCROLL_STATE_IDLE) lastUserScroll = System.currentTimeMillis()
            }

            override fun onScroll(view: AbsListView, first: Int, visible: Int, total: Int) = Unit
        })

        findViewById<View>(R.id.btnBack).setOnClickListener { leave() }
        findViewById<View>(R.id.btnChapters).setOnClickListener { showChapters() }
        findViewById<View>(R.id.btnMore).setOnClickListener { showMore() }
        btnPlay.setOnClickListener {
            LiteUi.askNotifications(this)
            Speaker.toggle()
        }
        findViewById<View>(R.id.btnPrev).setOnClickListener { Speaker.previousSentence() }
        findViewById<View>(R.id.btnNext).setOnClickListener { Speaker.nextSentence() }
        btnSpeed.setOnClickListener { LiteUi.showSpeed(this) { render() } }
        btnVoice.setOnClickListener { LiteUi.showVoices(this) { render() } }
        btnSleep.setOnClickListener { LiteUi.showSleep(this) { render() } }
        taskCancel.setOnClickListener {
            when {
                Exporter.running -> Exporter.cancel()
                ModelPack.active != null -> ModelPack.active?.cancelInstall()
                else -> {
                    exportDone = true
                    render()
                }
            }
        }
        taskOpen.setOnClickListener { openAudio() }
        position.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(s: SeekBar, p: Int, fromUser: Boolean) {
                if (fromUser) where.text = placeOf(p)
            }

            override fun onStartTrackingTouch(s: SeekBar) {
                draggingPosition = true
            }

            override fun onStopTrackingTouch(s: SeekBar) {
                draggingPosition = false
                lastUserScroll = 0
                Speaker.seek(s.progress)
            }
        })

        Speaker.init(this) { render() }
        if (Speaker.doc == null) {
            // Opened from the notification after the app was closed: reopen the last document.
            reopenLast()
        }
    }

    private fun reopenLast() {
        Library.loadCurrentId(this)
        val item = Library.get(this, Library.currentId) ?: return finish()
        status.text = "Opening ${item.title}…"
        status.visibility = View.VISIBLE
        scope.launch {
            try {
                val doc = withContext(Dispatchers.Default) { Opener.parse(this@LitePlayerActivity, item) }
                Speaker.load(doc)
                readerAdapter.notifyDataSetChanged()
            } catch (e: Exception) {
                AppLog.e("Open", "Couldn't reopen", e)
                finish()
            }
        }
    }

    override fun onStart() {
        super.onStart()
        Speaker.addListener(refresh)
        Exporter.addListener(refresh)
        ModelPack.addListener(refresh)
        reader.post(ticker)
        reader.post(follower)
        shownIndex = -1
        render()
    }

    override fun onStop() {
        Speaker.removeListener(refresh)
        Exporter.removeListener(refresh)
        ModelPack.removeListener(refresh)
        reader.removeCallbacks(ticker)
        reader.removeCallbacks(follower)
        super.onStop()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() = leave()

    /** Back to the library; a natural break for an ad when not listening. */
    private fun leave() {
        Ads.interstitial(this, "leave") { finish() }
    }

    // ---- Screen ----

    private var exportDone = true

    private var lighterAsked = false
    private var lighterCheckedAt = 0L

    /**
     * A real reader's voice on a phone too slow for it (reading keeps pausing), or on a low battery: offer a
     * Supertonic voice, which runs smoothly and uses about a third of the power. Once per screen, and the
     * low-battery one once a day.
     */
    private fun suggestLighterVoice() {
        if (lighterAsked || !Speaker.playing || !Speaker.voiceId.startsWith(Speaker.CLONE)) return
        val now = System.currentTimeMillis()
        if (now - lighterCheckedAt < 30_000) return
        lighterCheckedAt = now
        val slow = RenderSpeed.tooSlow(this, Speaker.voiceId, Speaker.renderSpeed) && !prefs.getBoolean("keepSlowVoice", false)
        val battery = getSystemService(android.os.BatteryManager::class.java)
        val level = battery?.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY) ?: 100
        val today = java.time.LocalDate.now().toString()
        val low = level in 1..20 && battery?.isCharging != true && prefs.getString("lowBatteryAsked", "") != today
        if (!slow && !low) return
        lighterAsked = true
        if (low && !slow) prefs.edit().putString("lowBatteryAsked", today).apply()
        val ready = LocalTts.SUPERTONIC_PACK.isInstalled()
        val message = (if (slow) "This phone makes the real readers' voices more slowly than they are read, so listening keeps pausing. " +
            "Supertonic voices run smoothly here and use about a third of the power."
        else "Battery is at $level%. The real readers' voices take a lot of power; a Supertonic voice uses about a third.") +
            if (ready) "" else "\n\nSupertonic is a one-time ${LocalTts.SUPERTONIC_PACK.sizeMb} MB download."
        AlertDialog.Builder(this)
            .setTitle(if (slow) "A smoother voice for this phone" else "Save battery?")
            .setMessage(message)
            .setPositiveButton(if (ready) "Use Lena" else "Choose a voice") { _, _ ->
                if (ready) Speaker.setVoice(Speaker.SUPER + "F2") else LiteUi.showVoices(this) { render() }
            }
            .setNegativeButton("Keep this voice") { _, _ -> if (slow) prefs.edit().putBoolean("keepSlowVoice", true).apply() }
            .show()
    }

    private fun render() {
        suggestLighterVoice()
        val doc = Speaker.doc
        title.text = doc?.title ?: ""
        btnPlay.setImageResource(if (Speaker.playing) R.drawable.ic_pause else R.drawable.ic_play)
        btnPlay.contentDescription = if (Speaker.playing) "Pause" else "Play"
        btnSpeed.text = LiteUi.speedLabel()
        btnVoice.text = LiteUi.voiceName()
        btnSleep.text = LiteUi.sleepLabel()

        val message = when {
            Speaker.lastError != null -> Speaker.lastError
            Speaker.starting && Speaker.playing ->
                if (Speaker.isLocal) "Starting the voice… (a few seconds the first time)" else "Starting…"
            else -> null
        }
        status.text = message
        status.visibility = if (message == null) View.GONE else View.VISIBLE

        renderTask()

        if (doc != null) {
            if (!draggingPosition) {
                position.max = maxOf(0, doc.paragraphs.size - 1)
                position.progress = Speaker.index
                where.text = placeOf(Speaker.index)
            }
            val wordsLeft = doc.paragraphs.drop(Speaker.index).sumOf { p -> p.count { it == ' ' } + 1 }
            val minutes = (wordsLeft / (160f * Speaker.renderSpeed)).toInt()
            left.text = if (minutes >= 60) "${minutes / 60} h ${minutes % 60} min left" else "$minutes min left"
        }

        if (Speaker.index != shownIndex || Speaker.currentPiece != shownPiece) {
            val moved = Speaker.index != shownIndex
            shownIndex = Speaker.index
            shownPiece = Speaker.currentPiece
            readerAdapter.notifyDataSetChanged()
            if (moved && System.currentTimeMillis() - lastUserScroll > 6_000) {
                reader.post {
                    // A smooth scroll to the next paragraph when it's out of view (a jump only when it's far away).
                    val i = Speaker.index
                    if (i < reader.firstVisiblePosition || i > reader.lastVisiblePosition) {
                        val far = i < reader.firstVisiblePosition - 3 || i > reader.lastVisiblePosition + 3
                        if (far) reader.setSelectionFromTop(i, LiteUi.dp(this, 80))
                        else reader.smoothScrollToPositionFromTop(i, LiteUi.dp(this, 80), 500)
                    }
                }
            }
        }
    }

    private fun placeOf(i: Int): String {
        val doc = Speaker.doc ?: return ""
        val chapter = doc.chapterAt(i)?.title
        val pct = if (doc.paragraphs.size > 1) i * 100 / (doc.paragraphs.size - 1) else 0
        return if (chapter != null) "$chapter · $pct%" else "$pct%"
    }

    /** Audiobook conversion or voice download in progress (or just finished). */
    private fun renderTask() {
        val pack = ModelPack.active
        when {
            Exporter.running -> {
                exportWasRunning = true
                exportDone = false
                taskBox.visibility = View.VISIBLE
                taskText.text = "Making the audiobook: " + (Exporter.message ?: "starting…")
                taskProgress.visibility = View.VISIBLE
                taskProgress.isIndeterminate = Exporter.progress == 0
                taskProgress.progress = Exporter.progress
                // Chapters and parts can be played as soon as each one is ready.
                val ready = Exporter.lastFinished != null && Exporter.filesTotal > 1
                taskOpen.visibility = if (ready) View.VISIBLE else View.GONE
                if (ready) taskOpen.text = "Play ${Exporter.filesDone} of ${Exporter.filesTotal}"
                taskCancel.text = "Stop"
            }
            pack != null -> {
                taskBox.visibility = View.VISIBLE
                taskText.text = pack.message ?: "Downloading ${pack.title}…"
                taskProgress.visibility = View.VISIBLE
                taskProgress.isIndeterminate = pack.progress == 0
                taskProgress.progress = pack.progress
                taskOpen.visibility = View.GONE
                taskCancel.text = "Pause"
            }
            exportWasRunning -> {
                // Just finished: a natural break for an ad, then the result.
                exportWasRunning = false
                if (Exporter.resultUri != null) Ads.interstitial(this, "audiobook")
                showTaskResult()
            }
            !exportDone -> showTaskResult()
            else -> taskBox.visibility = View.GONE
        }
    }

    private fun showTaskResult() {
        taskBox.visibility = View.VISIBLE
        taskText.text = Exporter.message ?: ""
        taskProgress.visibility = View.GONE
        taskOpen.visibility = if (Exporter.resultUri != null) View.VISIBLE else View.GONE
        taskOpen.text = "Open"
        taskCancel.text = "Close"
    }

    private fun openAudio() {
        val uri = (if (Exporter.running) Exporter.lastFinished else Exporter.resultUri) ?: return
        try {
            startActivity(
                Intent(Intent.ACTION_VIEW).setDataAndType(uri, contentResolver.getType(uri) ?: "audio/*")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            )
        } catch (e: Exception) {
            Toast.makeText(this, "Saved in Downloads/${Brand.folder(this)}. No audio player was found to open it.", Toast.LENGTH_LONG).show()
        }
    }

    private val readerAdapter = object : BaseAdapter() {
        override fun getCount() = Speaker.doc?.paragraphs?.size ?: 0
        override fun getItem(position: Int) = Speaker.doc?.paragraphs?.getOrNull(position)
        override fun getItemId(position: Int) = position.toLong()

        override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
            val tv = (convertView ?: layoutInflater.inflate(R.layout.item_paragraph, parent, false)) as TextView
            val doc = Speaker.doc
            val text = doc?.paragraphs?.getOrNull(position) ?: ""
            val isHeading = doc?.chapters?.any { it.start == position && it.title == text } == true
            val current = position == Speaker.index
            tv.textSize = if (isHeading) textSizeSp + 4 else textSizeSp
            tv.setTypeface(face, if (isHeading) Typeface.BOLD else Typeface.NORMAL)
            tv.justificationMode = if (justify && !isHeading) android.text.Layout.JUSTIFICATION_MODE_INTER_WORD
            else android.text.Layout.JUSTIFICATION_MODE_NONE
            tv.gravity = when (ReadingLook.alignment(this@LitePlayerActivity)) {
                "center" -> Gravity.CENTER_HORIZONTAL
                "right" -> Gravity.END
                else -> Gravity.START
            }
            ReadingLook.paper(this@LitePlayerActivity)?.let { tv.setTextColor(it.text) }
                ?: tv.setTextColor(Themes.color(this@LitePlayerActivity, R.attr.p2aText))
            tv.setLineSpacing(0f, spacing)
            tv.text = highlighted(text, current)
            // No box around the paragraph: the highlight follows the words instead.
            tv.background = null
            // While reading: what's been read fades most, what's to come a little.
            tv.alpha = when {
                current || !Speaker.playing -> 1f
                position < Speaker.index -> 0.35f
                else -> 0.5f
            }
            return tv
        }
    }

    // ---- Menus ----

    private fun showChapters() {
        val doc = Speaker.doc ?: return
        if (doc.chapters.size < 2) {
            Toast.makeText(this, "This one has no chapters. Drag the bar below to move around.", Toast.LENGTH_SHORT).show()
            return
        }
        val current = doc.chapterAt(Speaker.index)
        val sheet = LiteSheet(this, "Chapters", "${doc.chapters.size} chapters · tap one to go there")
        for ((i, ch) in doc.chapters.withIndex()) {
            val end = doc.chapters.getOrNull(i + 1)?.start ?: doc.paragraphs.size
            val words = (ch.start until end).sumOf { k -> doc.paragraphs[k].count { it == ' ' } + 1 }
            val minutes = (words / (160f * Speaker.renderSpeed)).toInt().coerceAtLeast(1)
            sheet.row(null, ch.title, "$minutes min", checked = ch == current) {
                lastUserScroll = 0
                Speaker.seek(ch.start)
            }
        }
        sheet.show()
    }

    private var touchX = 0f
    private var touchY = 0f

    private fun wordMenu(view: View?, i: Int) {
        val para = Speaker.doc?.paragraphs?.getOrNull(i) ?: return
        val tv = view as? TextView
        val range = tv?.let { LookUp.wordAt(it, para, touchX - it.left, touchY - it.top) }
        val word = range?.let { para.substring(it.first, it.last + 1) }
        val sheet = LiteSheet(this, word?.let { "“$it”" } ?: "Paragraph ${i + 1}", null)
        if (word != null) sheet.row(R.drawable.ic_voice, "Fix how “$word” is said", "Type it the way it sounds; every voice uses it") { Pronounce.show(this, word) }
        sheet.row(R.drawable.ic_play, "Play from here", null) {
            lastUserScroll = 0
            Speaker.seek(i)
            if (!Speaker.playing) Speaker.play()
        }
        sheet.row(R.drawable.ic_list, "Pronunciations", "All the words you've fixed") { Pronounce.show(this) }
        sheet.show()
    }

    private fun showMore() {
        LiteSheet(this, Speaker.doc?.title, null)
            .row(R.drawable.ic_voice, "Pronunciations", "Fix how words are said (or press and hold a word)") { Pronounce.show(this) }
            .row(R.drawable.ic_text, "Save the text", "As plain text, Markdown or PDF") { exportTranscript() }
            .row(R.drawable.ic_tune, "Reading look", "Font, size, spacing, margins, alignment, page color") {
                ReadingLook.show(this) {
                    loadLook()
                    readerAdapter.notifyDataSetChanged()
                }
            }
            .row(R.drawable.ic_bug, "Report a problem", "Share the app's error log to get it fixed") { AppLog.showReport(this) }
            .show()
    }

    private fun exportTranscript() {
        val doc = Speaker.doc ?: return
        val sheet = LiteSheet(this, "Save the text", "Saved in Downloads/${Brand.folder(this)}")
        for (format in Transcript.Format.values()) sheet.row(R.drawable.ic_doc, format.label, null) {
                scope.launch {
                    try {
                        val uri = withContext(Dispatchers.IO) { Transcript.save(this@LitePlayerActivity, doc, format, emptySet()) }
                        AlertDialog.Builder(this@LitePlayerActivity)
                            .setTitle("Saved")
                            .setMessage("In Downloads/${Brand.folder(this@LitePlayerActivity)}.")
                            .setPositiveButton("Share") { _, _ ->
                                runCatching {
                                    startActivity(Intent.createChooser(
                                        Intent(Intent.ACTION_SEND).setType(format.mime).putExtra(Intent.EXTRA_STREAM, uri)
                                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), "Share"))
                                }
                            }
                            .setNegativeButton("Close", null)
                            .show()
                    } catch (e: Exception) {
                        AppLog.e("Transcript", "Export failed", e)
                        Toast.makeText(this@LitePlayerActivity, "Couldn't save: ${e.message}", Toast.LENGTH_LONG).show()
                    }
                }
        }
        sheet.show()
    }
}
