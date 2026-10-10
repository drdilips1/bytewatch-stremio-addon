package com.paper2audio.app

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Typeface
import android.os.Bundle
import android.text.Spannable
import android.text.SpannableString
import android.text.style.BackgroundColorSpan
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
 * highlighted; play, sentence back and forward; speed, voice, sleep timer; and
 * "Audiobook" to save the whole thing as audio files.
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
    private val refresh: () -> Unit = { render() }
    private val ticker = object : Runnable {
        override fun run() {
            btnSleep.text = LiteUi.sleepLabel()
            reader.postDelayed(this, 30_000)
        }
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
        textSizeSp = prefs.getFloat("liteTextSize", 18f)

        reader.adapter = readerAdapter
        reader.setOnItemClickListener { _, _, i, _ ->
            lastUserScroll = 0
            Speaker.seek(i)
            if (!Speaker.playing) Speaker.play()
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
        findViewById<View>(R.id.btnAudiobook).setOnClickListener { LiteUi.showAudiobook(this) }
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
        shownIndex = -1
        render()
    }

    override fun onStop() {
        Speaker.removeListener(refresh)
        Exporter.removeListener(refresh)
        ModelPack.removeListener(refresh)
        reader.removeCallbacks(ticker)
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

    private fun render() {
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
                    // A jump, not a scroll (easier on the eyes), and only when the paragraph is out of view.
                    val i = Speaker.index
                    if (i < reader.firstVisiblePosition || i >= reader.lastVisiblePosition) reader.setSelectionFromTop(i, LiteUi.dp(this, 80))
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
                taskOpen.visibility = View.GONE
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
        taskCancel.text = "Close"
    }

    private fun openAudio() {
        val uri = Exporter.resultUri ?: return
        try {
            startActivity(
                Intent(Intent.ACTION_VIEW).setDataAndType(uri, contentResolver.getType(uri) ?: "audio/*")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            )
        } catch (e: Exception) {
            Toast.makeText(this, "Saved in your Music folder. No audio player was found to open it.", Toast.LENGTH_LONG).show()
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
            tv.setTypeface(null, if (isHeading) Typeface.BOLD else Typeface.NORMAL)
            val piece = Speaker.currentPiece
            val start = if (current && piece != null && Speaker.playing) text.indexOf(piece) else -1
            if (start >= 0) {
                val span = SpannableString(text)
                val accent = Themes.color(this@LitePlayerActivity, R.attr.p2aAccent)
                span.setSpan(BackgroundColorSpan((accent and 0x00FFFFFF) or 0x48000000), start, start + piece!!.length, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
                tv.text = span
            } else {
                tv.text = text
            }
            if (current) tv.setBackgroundResource(R.drawable.bg_current) else tv.background = null
            tv.alpha = if (current || !Speaker.playing) 1f else 0.7f
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
        val current = doc.chapters.indexOf(doc.chapterAt(Speaker.index))
        AlertDialog.Builder(this)
            .setTitle("Chapters")
            .setSingleChoiceItems(doc.chapters.map { it.title }.toTypedArray(), current) { d, which ->
                d.dismiss()
                lastUserScroll = 0
                Speaker.seek(doc.chapters[which].start)
            }
            .show()
    }

    private fun showMore() {
        val options = ArrayList<Pair<String, () -> Unit>>()
        options += "Make an audiobook" to { LiteUi.showAudiobook(this) }
        options += "Save the text (text, Markdown or PDF)" to { exportTranscript() }
        options += "Text size" to { textSize() }
        options += "Report a problem" to { AppLog.showReport(this) }
        AlertDialog.Builder(this)
            .setItems(options.map { it.first }.toTypedArray()) { _, which -> options[which].second() }
            .show()
    }

    private fun textSize() {
        val sizes = listOf(14f, 16f, 18f, 20f, 23f, 26f)
        val labels = listOf("Small", "Medium", "Default", "Large", "Larger", "Largest")
        AlertDialog.Builder(this)
            .setTitle("Text size")
            .setSingleChoiceItems(labels.toTypedArray(), sizes.indexOf(textSizeSp).coerceAtLeast(0)) { d, which ->
                d.dismiss()
                textSizeSp = sizes[which]
                prefs.edit().putFloat("liteTextSize", textSizeSp).apply()
                readerAdapter.notifyDataSetChanged()
            }
            .show()
    }

    private fun exportTranscript() {
        val doc = Speaker.doc ?: return
        val formats = Transcript.Format.values()
        AlertDialog.Builder(this)
            .setTitle("Save the text")
            .setItems(formats.map { it.label }.toTypedArray()) { _, which ->
                val format = formats[which]
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
            .show()
    }
}
