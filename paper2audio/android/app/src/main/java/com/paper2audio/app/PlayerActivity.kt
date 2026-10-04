package com.paper2audio.app

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.net.Uri
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.graphics.Outline
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.text.Spannable
import android.text.SpannableString
import android.text.style.BackgroundColorSpan
import android.util.TypedValue
import android.view.View
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.widget.AbsListView
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.BaseAdapter
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.ListView
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The "now reading" screen: a reader view that follows along with the audio,
 * a player bar (sleep timer, speed, controls) and an options tab.
 */
class PlayerActivity : Activity() {
    private companion object {
        const val MIN_SPEED = 0.5f
        val SPEEDS = floatArrayOf(0.75f, 1f, 1.1f, 1.25f, 1.5f, 1.75f, 2f, 2.5f, 3f, 3.5f, 4f)
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val main = Handler(Looper.getMainLooper())
    private val refresh: () -> Unit = { render() }
    private lateinit var prefs: SharedPreferences

    private lateinit var cover: ImageView
    private lateinit var docTitle: TextView
    private lateinit var docAuthor: TextView
    private lateinit var docInfo: TextView
    private lateinit var docDescription: TextView
    private lateinit var reader: ListView
    private lateinit var optionsPanel: ScrollView
    private lateinit var tabReader: Button
    private lateinit var tabOptions: Button
    private lateinit var posBar: SeekBar
    private lateinit var posLabel: TextView
    private lateinit var timeLabel: TextView
    private lateinit var btnPrev: ImageButton
    private lateinit var btnPlay: ImageButton
    private lateinit var btnNext: ImageButton
    private lateinit var btnStyle: Button
    private lateinit var btnFigure: Button
    private lateinit var btnSleep: Button
    private lateinit var btnSpeed: Button
    private lateinit var btnChapters: ImageButton
    private lateinit var speedLabel: TextView
    private lateinit var speedBar: SeekBar
    private lateinit var voiceSpinner: Spinner
    private lateinit var checks: List<CheckBox>
    private lateinit var btnExport: Button
    private lateinit var exportProgress: ProgressBar
    private lateinit var exportStatus: TextView
    private lateinit var btnOpenAudio: Button
    private lateinit var btnKokoro: Button
    private lateinit var btnDeleteKokoro: Button
    private lateinit var kokoroProgress: ProgressBar
    private lateinit var kokoroStatus: TextView
    private lateinit var btnOffline: Button
    private lateinit var offlineProgress: ProgressBar
    private lateinit var offlineStatus: TextView
    private lateinit var textSizeLabel: TextView
    private lateinit var textSizeBar: SeekBar

    private var voices: List<Speaker.VoiceOption> = emptyList()
    private var voicesShown = -1
    private var busy: String? = null
    private var userSeeking = false
    private var coverFor: String? = null
    private var shownIndex = -1
    private var shownPiece: String? = null
    private var lastUserScroll = 0L
    private var noteIndexes: Set<Int> = emptySet()
    private var offlinePercent: Int? = null
    private var offlineFor: String? = null
    private var textSizeSp = 17f
    private var notesFor: String? = null
    private var aiFor: String? = null
    private var aiBusy: String? = null
    private lateinit var aiStatus: TextView
    private lateinit var aiProgress: ProgressBar
    private lateinit var btnVisuals: Button
    private lateinit var btnChapterSummary: Button
    private lateinit var cbVisuals: CheckBox
    private lateinit var langHint: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        Themes.apply(this)
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_player)
        prefs = getSharedPreferences("p2a", MODE_PRIVATE)

        cover = findViewById(R.id.cover)
        docTitle = findViewById(R.id.docTitle)
        docAuthor = findViewById(R.id.docAuthor)
        docInfo = findViewById(R.id.docInfo)
        docDescription = findViewById(R.id.docDescription)
        reader = findViewById(R.id.reader)
        optionsPanel = findViewById(R.id.optionsPanel)
        tabReader = findViewById(R.id.tabReader)
        tabOptions = findViewById(R.id.tabOptions)
        posBar = findViewById(R.id.posBar)
        posLabel = findViewById(R.id.posLabel)
        timeLabel = findViewById(R.id.timeLabel)
        btnPrev = findViewById(R.id.btnPrev)
        btnPlay = findViewById(R.id.btnPlay)
        btnNext = findViewById(R.id.btnNext)
        btnSleep = findViewById(R.id.btnSleep)
        btnSpeed = findViewById(R.id.btnSpeed)
        btnChapters = findViewById(R.id.btnChapters)
        speedLabel = findViewById(R.id.speedLabel)
        speedBar = findViewById(R.id.speedBar)
        voiceSpinner = findViewById(R.id.voiceSpinner)
        btnExport = findViewById(R.id.btnExport)
        exportProgress = findViewById(R.id.exportProgress)
        exportStatus = findViewById(R.id.exportStatus)
        btnOpenAudio = findViewById(R.id.btnOpenAudio)
        btnKokoro = findViewById(R.id.btnKokoro)
        btnDeleteKokoro = findViewById(R.id.btnDeleteKokoro)
        kokoroProgress = findViewById(R.id.kokoroProgress)
        kokoroStatus = findViewById(R.id.kokoroStatus)
        btnOffline = findViewById(R.id.btnOffline)
        offlineProgress = findViewById(R.id.offlineProgress)
        offlineStatus = findViewById(R.id.offlineStatus)
        textSizeLabel = findViewById(R.id.textSizeLabel)
        textSizeBar = findViewById(R.id.textSizeBar)
        checks = listOf(R.id.cbRefs, R.id.cbCites, R.id.cbCaptions, R.id.cbAppendix).map { findViewById(it) }

        cover.outlineProvider = object : ViewOutlineProvider() {
            override fun getOutline(view: View, outline: Outline) {
                outline.setRoundRect(0, 0, view.width, view.height, 10 * resources.displayMetrics.density)
            }
        }
        cover.clipToOutline = true

        setupControls()
        setupReader()
        showTab(options = false)
        Speaker.init(this) {
            setupVoices()
            render()
        }
        Library.loadCurrentId(this)
        if (Speaker.doc == null) reparse()
        render()
    }

    private fun color(attr: Int): Int {
        val v = TypedValue()
        theme.resolveAttribute(attr, v, true)
        return v.data
    }

    private fun showTab(options: Boolean) {
        reader.visibility = if (options) View.GONE else View.VISIBLE
        optionsPanel.visibility = if (options) View.VISIBLE else View.GONE
        val (on, off) = if (options) tabOptions to tabReader else tabReader to tabOptions
        on.setBackgroundResource(R.drawable.bg_button)
        on.setTextColor(color(R.attr.p2aOnAccent))
        on.compoundDrawableTintList = android.content.res.ColorStateList.valueOf(color(R.attr.p2aOnAccent))
        off.setBackgroundResource(R.drawable.bg_button_soft)
        off.setTextColor(color(R.attr.p2aText))
        off.compoundDrawableTintList = android.content.res.ColorStateList.valueOf(color(R.attr.p2aText))
        if (options) refreshOfflineStatus()
    }

    private fun setupControls() {
        findViewById<ImageButton>(R.id.btnBack).setOnClickListener { finish() }
        findViewById<ImageButton>(R.id.btnVoiceStudio).setOnClickListener { startActivity(Intent(this, VoiceStudioActivity::class.java)) }
        findViewById<ImageButton>(R.id.btnTheme).setOnClickListener { Themes.showPicker(this) }
        findViewById<ImageButton>(R.id.btnDetails).setOnClickListener { showDetailsMenu() }
        findViewById<ImageButton>(R.id.btnNotes).setOnClickListener { showNotes() }
        tabReader.setOnClickListener { showTab(options = false) }
        tabOptions.setOnClickListener { showTab(options = true) }
        docDescription.setOnClickListener {
            docDescription.maxLines = if (docDescription.maxLines == 4) Int.MAX_VALUE else 4
        }

        btnPlay.setOnClickListener {
            askNotificationPermission()
            Speaker.toggle()
        }
        // Tap: one sentence back or forward. Hold: a whole paragraph.
        btnPrev.setOnClickListener { Speaker.previousSentence() }
        btnNext.setOnClickListener { Speaker.nextSentence() }
        btnPrev.setOnLongClickListener {
            Speaker.previous()
            toast("Previous paragraph")
            true
        }
        btnNext.setOnLongClickListener {
            Speaker.next()
            toast("Next paragraph")
            true
        }
        findViewById<CheckBox>(R.id.cbMedical).apply {
            isChecked = Speaker.medical
            setOnCheckedChangeListener { _, on -> Speaker.setMedical(on) }
        }
        findViewById<Button>(R.id.btnExplainNow).setOnClickListener {
            val doc = Speaker.doc ?: return@setOnClickListener
            explainMenu(Speaker.index, Speaker.currentPiece?.takeIf { it != doc.paragraphs.getOrNull(Speaker.index) })
        }
        btnFigure = findViewById(R.id.btnFigure)
        btnFigure.setOnClickListener {
            val doc = Speaker.doc ?: return@setOnClickListener
            val item = Library.get(this, doc.key) ?: return@setOnClickListener
            val figs = figuresIn(doc, Speaker.index)
            if (figs.size == 1) FigureViewer.show(this, scope, Library.source(this, item).file, figs[0]) else showFigures()
        }
        btnStyle = findViewById(R.id.btnStyle)
        btnStyle.setOnClickListener { chooseStyle() }
        btnChapters.setOnClickListener { showChapters() }
        btnSleep.setOnClickListener { showSleepTimer() }
        btnSpeed.setOnClickListener { showSpeeds() }

        posBar.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(bar: SeekBar, value: Int, fromUser: Boolean) {
                if (fromUser) posLabel.text = positionLabel(value)
            }

            override fun onStartTrackingTouch(bar: SeekBar) {
                userSeeking = true
            }

            override fun onStopTrackingTouch(bar: SeekBar) {
                userSeeking = false
                lastUserScroll = 0
                Speaker.seek(bar.progress)
            }
        })

        speedBar.progress = Math.round((prefs.getFloat("speed", 1f) - MIN_SPEED) * 10).coerceIn(0, speedBar.max)
        speedLabel.text = speedText(speedBar.progress)
        speedBar.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(bar: SeekBar, value: Int, fromUser: Boolean) {
                speedLabel.text = speedText(value)
            }

            override fun onStartTrackingTouch(bar: SeekBar) = Unit
            override fun onStopTrackingTouch(bar: SeekBar) = Speaker.setSpeed(speedOf(bar.progress))
        })

        textSizeSp = prefs.getFloat("readerTextSize", 17f)
        textSizeBar.progress = (textSizeSp - 13).toInt().coerceIn(0, textSizeBar.max)
        textSizeLabel.text = "Reader text size  ${textSizeSp.toInt()}"
        textSizeBar.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(bar: SeekBar, value: Int, fromUser: Boolean) {
                textSizeSp = 13f + value
                textSizeLabel.text = "Reader text size  ${textSizeSp.toInt()}"
                prefs.edit().putFloat("readerTextSize", textSizeSp).apply()
                readerAdapter.notifyDataSetChanged()
            }

            override fun onStartTrackingTouch(bar: SeekBar) = Unit
            override fun onStopTrackingTouch(bar: SeekBar) = Unit
        })

        checks.forEachIndexed { i, cb ->
            cb.isChecked = prefs.getBoolean(Opener.OPTION_KEYS[i], Opener.OPTION_DEFAULTS[i])
            cb.setOnCheckedChangeListener { _, checked ->
                prefs.edit().putBoolean(Opener.OPTION_KEYS[i], checked).apply()
                reparse()
            }
        }

        findViewById<Button>(R.id.btnPreview).setOnClickListener { Speaker.preview() }
        findViewById<Button>(R.id.btnStudio).setOnClickListener { startActivity(Intent(this, VoiceStudioActivity::class.java)) }
        findViewById<Button>(R.id.btnMoreVoices).setOnClickListener {
            try {
                startActivity(Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA))
            } catch (e: ActivityNotFoundException) {
                toast("Open Settings › Accessibility › Text-to-speech to add voices")
            }
        }

        btnDeleteKokoro.setOnClickListener {
            val pack = LocalTts.packFor(Speaker.voiceId) ?: return@setOnClickListener
            AlertDialog.Builder(this)
                .setTitle("Delete the ${pack.title}?")
                .setMessage("This frees about ${pack.sizeMb} MB. You can download it again later.")
                .setPositiveButton("Delete") { _, _ ->
                    Speaker.setVoice(Speaker.DEFAULT_VOICE)
                    pack.uninstall { Speaker.refreshVoices() }
                }
                .setNegativeButton("Cancel", null)
                .show()
        }
        btnKokoro.setOnClickListener {
            val active = ModelPack.active
            if (active != null) active.cancelInstall() else LocalTts.missing(Speaker.voiceId)?.let(::promptDownload)
        }

        setupAi()

        btnOffline.setOnClickListener {
            val doc = Speaker.doc ?: return@setOnClickListener
            when {
                OfflineDownloader.running -> OfflineDownloader.cancel()
                Speaker.voiceId.startsWith(Speaker.SYSTEM) ->
                    toast("Phone voices already work offline. Offline download is for ★ and ◆ voices.")
                else -> {
                    askNotificationPermission()
                    val sp = Speaker.renderSpeed
                    scope.launch {
                        val plan = withContext(Dispatchers.Default) { Speaker.plan(doc) }
                        OfflineDownloader.start(this@PlayerActivity, doc, plan, sp)
                    }
                }
            }
        }
        findViewById<Button>(R.id.btnClearCache).setOnClickListener {
            scope.launch {
                val mb = withContext(Dispatchers.IO) { Renderer.cacheBytes(this@PlayerActivity) } / 1_000_000
                AlertDialog.Builder(this@PlayerActivity)
                    .setTitle("Clear downloaded audio?")
                    .setMessage("Frees $mb MB. Audio will be created again (online) when you listen.")
                    .setPositiveButton("Clear") { _, _ ->
                        scope.launch {
                            withContext(Dispatchers.IO) { Renderer.clearCache(this@PlayerActivity) }
                            offlineFor = null
                            refreshOfflineStatus()
                        }
                    }
                    .setNegativeButton("Cancel", null)
                    .show()
            }
        }

        btnExport.setOnClickListener {
            val doc = Speaker.doc ?: return@setOnClickListener
            if (Exporter.running) {
                Exporter.cancel()
            } else {
                askNotificationPermission()
                if (doc.chapters.size > 1) {
                    AlertDialog.Builder(this)
                        .setTitle("Save as audio")
                        .setItems(arrayOf(
                            "One file",
                            "Audiobook: one file per chapter (${doc.chapters.size} files in a folder, with cover and track numbers)",
                        )) { _, which -> Exporter.start(this, doc, Speaker.voicing(doc), Speaker.renderSpeed, perChapter = which == 1) }
                        .show()
                } else {
                    Exporter.start(this, doc, Speaker.voicing(doc), Speaker.renderSpeed)
                }
            }
        }
        findViewById<Button>(R.id.btnTranscript).setOnClickListener { exportTranscript() }
        btnOpenAudio.setOnClickListener {
            val uri = Exporter.resultUri ?: return@setOnClickListener
            try {
                startActivity(
                    Intent(Intent.ACTION_VIEW).setDataAndType(uri, contentResolver.getType(uri) ?: "audio/*")
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                )
            } catch (e: Exception) {
                toast("No audio player found")
            }
        }
    }

    // ---- Reader view ----

    private fun setupReader() {
        reader.adapter = readerAdapter
        reader.setOnItemClickListener { _, _, position, _ ->
            lastUserScroll = 0
            Speaker.seek(position)
            if (!Speaker.playing) {
                askNotificationPermission()
                Speaker.play()
            }
        }
        reader.setOnItemLongClickListener { _, _, position, _ ->
            paragraphMenu(position)
            true
        }
        reader.setOnScrollListener(object : AbsListView.OnScrollListener {
            override fun onScrollStateChanged(view: AbsListView, state: Int) {
                if (state != AbsListView.OnScrollListener.SCROLL_STATE_IDLE) lastUserScroll = System.currentTimeMillis()
            }

            override fun onScroll(view: AbsListView, first: Int, visible: Int, total: Int) = Unit
        })
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
            tv.textSize = if (isHeading) textSizeSp + 3 else textSizeSp
            tv.setTypeface(null, if (isHeading) Typeface.BOLD else Typeface.NORMAL)
            val shown = if (position in noteIndexes) "🔖 $text" else text
            val piece = Speaker.currentPiece
            if (current && piece != null && Speaker.playing) {
                val span = SpannableString(shown)
                val start = shown.indexOf(piece)
                if (start >= 0) {
                    val accent = color(R.attr.p2aAccent)
                    val tint = (accent and 0x00FFFFFF) or 0x40000000
                    span.setSpan(BackgroundColorSpan(tint), start, start + piece.length, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
                }
                tv.text = span
            } else {
                tv.text = shown
            }
            if (current) tv.setBackgroundResource(R.drawable.bg_current) else tv.background = null
            tv.alpha = if (current || !Speaker.playing) 1f else 0.72f
            return tv
        }
    }

    private fun paragraphMenu(position: Int) {
        val item = Library.get(this, Library.currentId)
        val text = Speaker.doc?.paragraphs?.getOrNull(position) ?: return
        val options = mutableListOf("Play from here", "Add bookmark", "Add note…", "Copy text", "Explain or ask AI…")
        AlertDialog.Builder(this)
            .setTitle("Paragraph ${position + 1}")
            .setItems(options.toTypedArray()) { _, which ->
                when (which) {
                    0 -> {
                        lastUserScroll = 0
                        Speaker.seek(position)
                        if (!Speaker.playing) Speaker.play()
                    }
                    1 -> item?.let {
                        Library.addNote(this, it, position, "")
                        toast("Bookmarked")
                        afterNotesChanged()
                    }
                    2 -> item?.let { askNote(it, position) }
                    3 -> {
                        getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("paragraph", text))
                        toast("Copied")
                    }
                    4 -> explainMenu(position, null)
                }
            }
            .show()
    }

    private fun askNote(item: Library.Item, position: Int) {
        val input = EditText(this).apply { hint = "Your note"; minLines = 2 }
        val box = FrameLayout(this).apply {
            val pad = (20 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad / 2, pad, 0)
            addView(input)
        }
        AlertDialog.Builder(this)
            .setTitle("Note on paragraph ${position + 1}")
            .setView(box)
            .setPositiveButton("Save") { _, _ ->
                val t = input.text.toString().trim()
                if (t.isNotEmpty()) {
                    Library.addNote(this, item, position, t)
                    afterNotesChanged()
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun afterNotesChanged() {
        noteIndexes = Library.get(this, Library.currentId)?.let { Library.notes(it).map { n -> n.index }.toSet() } ?: emptySet()
        readerAdapter.notifyDataSetChanged()
        DriveSync.request(this)
    }

    private fun showNotes() {
        val item = Library.get(this, Library.currentId) ?: return
        val notes = Library.notes(item)
        if (notes.isEmpty()) {
            AlertDialog.Builder(this)
                .setTitle("Bookmarks and notes")
                .setMessage("Long-press any paragraph in the reader to bookmark it or add a note.")
                .setPositiveButton("OK", null)
                .show()
            return
        }
        val doc = Speaker.doc
        val labels = notes.map { n ->
            val where = doc?.chapterAt(n.index)?.title?.let { "$it · " } ?: ""
            val para = doc?.paragraphs?.getOrNull(n.index)?.take(70) ?: ""
            if (n.isBookmark) "🔖 $where¶${n.index + 1}: $para…" else "📝 ${n.text}\n   $where¶${n.index + 1}"
        }
        AlertDialog.Builder(this)
            .setTitle("Bookmarks and notes")
            .setItems(labels.toTypedArray()) { _, i ->
                val n = notes[i]
                AlertDialog.Builder(this)
                    .setTitle(if (n.isBookmark) "Bookmark" else "Note")
                    .setMessage(if (n.isBookmark) doc?.paragraphs?.getOrNull(n.index)?.take(300) else n.text)
                    .setPositiveButton("Go there") { _, _ ->
                        lastUserScroll = 0
                        Speaker.seek(n.index)
                        showTab(options = false)
                    }
                    .setNeutralButton("Delete") { _, _ ->
                        Library.deleteNote(this, item, n)
                        afterNotesChanged()
                    }
                    .setNegativeButton("Close", null)
                    .show()
            }
            .show()
    }

    // ---- Sleep timer and speed ----

    private val tick = object : Runnable {
        override fun run() {
            render()
            if (Speaker.sleepAt > 0) main.postDelayed(this, 30_000)
        }
    }

    private fun showSleepTimer() {
        val options = arrayOf("Off", "5 minutes", "10 minutes", "15 minutes", "30 minutes", "45 minutes", "1 hour", "End of chapter")
        val minutes = intArrayOf(0, 5, 10, 15, 30, 45, 60)
        AlertDialog.Builder(this)
            .setTitle("Sleep timer")
            .setItems(options) { _, i ->
                if (i == options.size - 1) Speaker.setSleepAtEndOfChapter() else Speaker.setSleepTimer(minutes[i])
                main.removeCallbacks(tick)
                if (Speaker.sleepAt > 0) main.postDelayed(tick, 30_000)
                if (i > 0) toast(if (i == options.size - 1) "Stops at the end of this chapter" else "Stops in ${options[i]}")
            }
            .show()
    }

    private fun showSpeeds() {
        val labels = SPEEDS.map { speedLabelOf(it) }
        val current = SPEEDS.indexOfFirst { Math.abs(it - Speaker.speed) < 0.01f }
        AlertDialog.Builder(this)
            .setTitle("Playback speed")
            .setSingleChoiceItems(labels.toTypedArray(), current) { d, i ->
                d.dismiss()
                Speaker.setSpeed(SPEEDS[i])
                speedBar.progress = Math.round((SPEEDS[i] - MIN_SPEED) * 10).coerceIn(0, speedBar.max)
            }
            .show()
    }

    private fun speedOf(progress: Int) = MIN_SPEED + progress / 10f

    private fun speedLabelOf(s: Float) = "%.2f".format(s).trimEnd('0').trimEnd('.') + "×"

    private fun speedText(progress: Int) = "Speed  %.1f×".format(speedOf(progress))

    // ---- Voices ----

    private fun setupVoices() {
        voicesShown = Speaker.voicesVersion
        voices = Speaker.voiceOptions()
        voiceSpinner.onItemSelectedListener = null
        voiceSpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_item, voices.map { it.label }).apply {
            setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        }
        voiceSpinner.setSelection(voices.indexOfFirst { it.id == Speaker.voiceId }.coerceAtLeast(0), false)
        voiceSpinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                val option = voices.getOrNull(position) ?: return
                if (option.id == Speaker.voiceId) return
                Speaker.setVoice(option.id)
                offlineFor = null
                refreshOfflineStatus()
                val pack = LocalTts.missing(option.id)
                if (pack != null && !pack.installing) promptDownload(pack)
            }

            override fun onNothingSelected(parent: AdapterView<*>?) = Unit
        }
    }

    private fun promptDownload(pack: ModelPack) {
        AlertDialog.Builder(this)
            .setTitle("Download the ${pack.title}?")
            .setMessage(
                "These voices run on your phone: they work offline, with no limits. They need a one-time download " +
                    "of about ${pack.sizeMb} MB, so Wi-Fi is best. You can keep using the app while it downloads."
            )
            .setPositiveButton("Download") { _, _ ->
                askNotificationPermission()
                pack.install { Speaker.refreshVoices() }
            }
            .setNegativeButton("Not now", null)
            .show()
    }

    // ---- Offline ----

    private fun refreshOfflineStatus() {
        val doc = Speaker.doc ?: return
        val v = Speaker.voicing(doc)
        val key = "${doc.key}|${v.key}|${Speaker.fullCast}|${Speaker.skipped()}|${Speaker.renderSpeed}"
        if (offlineFor == key && !OfflineDownloader.running) return
        offlineFor = key
        val sp = Speaker.renderSpeed
        scope.launch {
            offlinePercent = withContext(Dispatchers.Default) {
                OfflineDownloader.percentCached(this@PlayerActivity, doc, Speaker.plan(doc), sp)
            }
            render()
        }
    }

    // ---- Details ----

    private fun showDetailsMenu() {
        val hasKey = !prefs.getString("hardcoverToken", null).isNullOrBlank()
        val isPdf = Library.get(this, Library.currentId)?.kind == Loader.Kind.PDF
        val options = listOfNotNull(
            "Look up cover and details",
            if (hasKey) "Hardcover API key (saved ✓)" else "Add Hardcover API key",
            if (isPdf) "Figures and tables" else null,
            if (isPdf) "Text recognition on all pages (for scans or garbled text)" else null,
            "Export transcript (text, Markdown or PDF)",
            "Report a problem",
        )
        AlertDialog.Builder(this)
            .setTitle("Document")
            .setItems(options.toTypedArray()) { _, which ->
                when (options[which]) {
                    options[0] -> lookUpDetails()
                    options[1] -> askHardcoverKey()
                    "Figures and tables" -> showFigures()
                    "Export transcript (text, Markdown or PDF)" -> exportTranscript()
                    "Report a problem" -> AppLog.showReport(this)
                    else -> recognizeAllPages()
                }
            }
            .show()
    }

    /** Saves the text as it is read aloud: choose the format, and whether to leave out skipped sections. */
    private fun exportTranscript() {
        val doc = Speaker.doc ?: return
        val skipped = Speaker.skipped(doc)
        val formats = Transcript.Format.values()
        var leaveOut = skipped.isNotEmpty()
        val b = AlertDialog.Builder(this)
            .setTitle("Export transcript")
            .setItems(formats.map { it.label }.toTypedArray()) { _, which ->
                val format = formats[which]
                busy = "Saving the transcript…"
                render()
                scope.launch {
                    try {
                        val uri = withContext(Dispatchers.IO) {
                            Transcript.save(this@PlayerActivity, doc, format, if (leaveOut) skipped else emptySet())
                        }
                        AppLog.i("Transcript", "Saved ${format.ext}, ${doc.paragraphs.size} paragraphs")
                        AlertDialog.Builder(this@PlayerActivity)
                            .setTitle("Transcript saved")
                            .setMessage("In Downloads/Paper2Audio.")
                            .setPositiveButton("Share") { _, _ ->
                                runCatching {
                                    startActivity(Intent.createChooser(
                                        Intent(Intent.ACTION_SEND).setType(format.mime).putExtra(Intent.EXTRA_STREAM, uri)
                                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), "Share the transcript"))
                                }
                            }
                            .setNeutralButton("Open") { _, _ ->
                                runCatching {
                                    startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, format.mime)
                                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
                                }.onFailure { toast("No app to open it with") }
                            }
                            .setNegativeButton("Close", null)
                            .show()
                    } catch (e: Exception) {
                        AppLog.e("Transcript", "Export failed", e)
                        toast("Couldn't save the transcript: ${e.message}")
                    } finally {
                        busy = null
                        render()
                    }
                }
            }
            .setNegativeButton("Cancel", null)
        if (skipped.isNotEmpty()) {
            val dp = resources.displayMetrics.density
            b.setView(android.widget.FrameLayout(this).apply {
                setPadding((20 * dp).toInt(), (4 * dp).toInt(), (20 * dp).toInt(), 0)
                addView(android.widget.CheckBox(this@PlayerActivity).apply {
                    text = "Leave out the ${skipped.size} skipped section(s)"
                    isChecked = true
                    setOnCheckedChangeListener { _, on -> leaveOut = on }
                })
            })
        }
        b.show()
    }

    private fun recognizeAllPages() {
        val item = Library.get(this, Library.currentId) ?: return
        busy = "Reading the pages with text recognition…"
        render()
        scope.launch {
            try {
                val n = withContext(Dispatchers.IO) {
                    Opener.recognizeScannedPages(this@PlayerActivity, Library.source(this@PlayerActivity, item).file, all = true) { text ->
                        runOnUiThread { busy = text; render() }
                    }
                }
                busy = null
                toast(if (n > 0) "Recognized text on $n pages" else "No text was found on the page images")
                reparse()
                DriveSync.request(this@PlayerActivity)
            } catch (e: Exception) {
                AppLog.e("Ocr", "Recognition failed", e)
                busy = null
                render()
                toast("Text recognition failed: ${e.message}")
            }
        }
    }

    private fun lookUpDetails() {
        val item = Library.get(this, Library.currentId) ?: return
        val token = prefs.getString("hardcoverToken", null)
        toast("Looking up “${item.title}”…")
        scope.launch {
            val found = withContext(Dispatchers.IO) { runCatching { Metadata.lookup(item, token) } }
            found.onFailure { toast("Couldn't look it up: ${it.message}") }
            val f = found.getOrNull() ?: run {
                if (found.isSuccess) {
                    AlertDialog.Builder(this@PlayerActivity)
                        .setTitle("No match found")
                        .setMessage("Nothing matched “${item.title}”." + if (token == null) " Adding a Hardcover key can find more books." else "")
                        .setPositiveButton("OK", null)
                        .setNeutralButton("Hardcover key") { _, _ -> askHardcoverKey() }
                        .show()
                }
                return@launch
            }
            val text = buildString {
                append(f.title)
                f.author?.let { append("\n").append(it) }
                f.year?.let { append(" · ").append(it) }
                f.description?.let { append("\n\n").append(it.take(500)) }
                if (f.coverUrl != null) append("\n\n(Includes a cover image.)")
            }
            AlertDialog.Builder(this@PlayerActivity)
                .setTitle("Found on ${f.source}")
                .setMessage(text)
                .setPositiveButton("Use these details") { _, _ -> applyDetails(item, f) }
                .setNegativeButton("Cancel", null)
                .setNeutralButton("Hardcover key") { _, _ -> askHardcoverKey() }
                .show()
        }
    }

    private fun applyDetails(item: Library.Item, f: Metadata.Found) {
        scope.launch {
            withContext(Dispatchers.IO) {
                val cover = f.coverUrl?.let { runCatching { Metadata.bytes(it) }.getOrNull() }
                Library.applyDetails(this@PlayerActivity, item, f, cover)
            }
            coverFor = null // reload the cover
            render()
            DriveSync.request(this@PlayerActivity)
        }
    }

    private fun askHardcoverKey() {
        val input = EditText(this).apply {
            hint = "Paste your Hardcover API key"
            setText(prefs.getString("hardcoverToken", "") ?: "")
            isSingleLine = true
        }
        val box = FrameLayout(this).apply {
            val pad = (20 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad / 2, pad, 0)
            addView(input)
        }
        AlertDialog.Builder(this)
            .setTitle("Hardcover API key")
            .setMessage("Get it at hardcover.app → Settings → API (hardcover.app/account/api). It's used only to look up book details and covers.")
            .setView(box)
            .setPositiveButton("Save") { _, _ ->
                prefs.edit().putString("hardcoverToken", input.text.toString().trim().ifBlank { null }).apply()
                toast("Saved. Tap ⓘ again to look up details.")
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    /** Re-reads the current document, e.g. after a reading option changed. */
    private fun reparse() {
        val item = Library.get(this, Library.currentId)
        if (item == null) {
            if (Speaker.doc == null) finish() // nothing to show; back to the library
            return
        }
        busy = "Reading…"
        render()
        scope.launch {
            try {
                val doc = withContext(Dispatchers.Default) { Opener.parse(this@PlayerActivity, item) }
                withContext(Dispatchers.IO) { Library.opened(this@PlayerActivity, item, doc) }
                Speaker.load(doc)
                readerAdapter.notifyDataSetChanged()
            } catch (e: Exception) {
                AppLog.e("Open", "Couldn't reopen", e)
                toast(e.message ?: "Could not read that file")
            } finally {
                busy = null
                render()
            }
        }
    }

    private fun showChapters() {
        val doc = Speaker.doc ?: return
        if (doc.chapters.size < 2) {
            toast("This document has no chapters")
            return
        }
        val current = doc.chapters.indexOfLast { it.start <= Speaker.index }
        val skip = Speaker.skipped()
        val done = Speaker.finished()
        val labels = doc.chapters.map { ch ->
            val mark = when {
                ch.title in skip -> "\u2298 " // skipped
                ch.title in done -> "\u2713 " // finished
                else -> "    "
            }
            mark + ch.title + if (ch.title in skip) "  (skipped)" else ""
        }
        AlertDialog.Builder(this)
            .setTitle("Contents")
            .setSingleChoiceItems(labels.toTypedArray(), current) { d, i ->
                d.dismiss()
                lastUserScroll = 0
                Speaker.seek(doc.chapters[i].start)
                showTab(options = false)
            }
            .setPositiveButton("Choose what to play", { _, _ -> chooseSections(doc) })
            .setNegativeButton("Close", null)
            .show()
    }

    /** Pick sections to play: checkboxes, plus shortcuts like "Skip Methods". */
    private fun chooseSections(doc: Doc) {
        val titles = doc.chapters.map { it.title }
        val skip = Speaker.skipped().toMutableSet()
        val checked = BooleanArray(titles.size) { titles[it] !in skip }
        val kinds = doc.chapters.map { it.kind }
        AlertDialog.Builder(this)
            .setTitle("Play these sections")
            .setMultiChoiceItems(titles.toTypedArray(), checked) { _, i, on -> checked[i] = on }
            .setPositiveButton("Save") { _, _ ->
                Speaker.setSkipped(titles.filterIndexed { i, _ -> !checked[i] }.toSet())
            }
            .setNeutralButton("Shortcuts") { _, _ ->
                val presets = arrayOf("Play everything", "Skip Methods", "Only Results and Discussion", "Only Abstract and Conclusion", "Skip References-like parts")
                AlertDialog.Builder(this)
                    .setTitle("Shortcuts")
                    .setItems(presets) { _, which ->
                        val keep: (String?) -> Boolean = when (which) {
                            0 -> { _ -> true }
                            1 -> { k -> k != "Methods" }
                            2 -> { k -> k == "Results" || k == "Discussion" }
                            3 -> { k -> k == "Abstract" || k == "Conclusion" }
                            else -> { k -> k != "References" }
                        }
                        // Parts without a recognized kind (the title, front matter) follow the first shortcut rule only.
                        val newSkip = titles.filterIndexed { i, _ ->
                            val k = kinds[i]
                            if (which == 0) false else if (k == null) which == 2 || which == 3 else !keep(k)
                        }.toSet()
                        Speaker.setSkipped(newSkip)
                        if (which != 0 && kinds.none { it != null }) toast("This document's sections have no standard names, so the shortcut can't find them.")
                    }
                    .show()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    /** Figures mentioned in paragraph [index] (e.g. "as shown in Figure 3"). */
    private fun figuresIn(doc: Doc, index: Int): List<Figure> {
        if (doc.figures.isEmpty()) return emptyList()
        val p = doc.paragraphs.getOrNull(index) ?: return emptyList()
        return doc.figures.filter { f ->
            val m = Regex("""(?i)^(figure|table|supplementary figure|supplementary table)\s*(S?\d+[a-z]?)$""").find(f.label) ?: return@filter false
            val word = if (m.groupValues[1].lowercase().contains("table")) "(?:tables?|tab\\.)" else "(?:figs?\\.?|figures?)"
            Regex("""(?i)\b$word\s*${Regex.escape(m.groupValues[2])}\b""").containsMatchIn(p)
        }
    }

    private fun showFigures() {
        val doc = Speaker.doc ?: return
        val item = Library.get(this, doc.key) ?: return
        if (doc.figures.isEmpty()) return toast("No figures or tables were found in this document")
        AlertDialog.Builder(this)
            .setTitle("Figures and tables")
            .setItems(doc.figures.map { "${it.label} \u00B7 page ${it.page}\n${it.caption.take(80)}" }.toTypedArray()) { _, i ->
                FigureViewer.show(this, scope, Library.source(this, item).file, doc.figures[i])
            }
            .show()
    }

    // ---- Rendering ----

    private fun positionLabel(index: Int): String {
        val doc = Speaker.doc ?: return ""
        val pct = if (doc.paragraphs.size > 1) index * 100 / (doc.paragraphs.size - 1) else 0
        val chapter = doc.chapterAt(index)?.title?.let { " · $it" } ?: ""
        return "$pct%$chapter"
    }

    private fun loadCover(id: String) {
        if (coverFor == id) return
        coverFor = id
        scope.launch {
            val px = (66 * resources.displayMetrics.density).toInt()
            Thumbs.load(Library.thumb(this@PlayerActivity, id), px)?.let { cover.setImageBitmap(it) }
        }
    }

    private fun format(minutes: Int) = if (minutes >= 60) "${minutes / 60} h ${minutes % 60} min" else "$minutes min"

    private fun render() {
        val doc = Speaker.doc
        val hasDoc = doc != null && doc.paragraphs.isNotEmpty()
        val item = doc?.let { Library.get(this, it.key) }
        docTitle.text = item?.title ?: doc?.title ?: ""
        val author = listOfNotNull(item?.author ?: doc?.author, item?.year?.takeIf { it > 0 }?.toString()).joinToString(" · ")
        docAuthor.text = author
        docAuthor.visibility = if (author.isNotEmpty()) View.VISIBLE else View.GONE
        docDescription.text = item?.description ?: ""
        docDescription.visibility = if (item?.description != null) View.VISIBLE else View.GONE
        doc?.let { loadCover(it.key) }

        if (doc != null && aiFor != doc.key) {
            aiFor = doc.key
            refreshAi()
        }
        if (doc != null && notesFor != doc.key) {
            notesFor = doc.key
            noteIndexes = item?.let { Library.notes(it).map { n -> n.index }.toSet() } ?: emptySet()
            readerAdapter.notifyDataSetChanged()
        }
        docInfo.text = when {
            busy != null -> busy
            Speaker.starting && Speaker.playing ->
                if (Speaker.isLocal) "Starting the voice… (on-device voices take a few seconds the first time)" else "Starting the voice…"
            doc != null -> {
                val chapters = if (doc.chapters.size > 1) " · ${doc.chapters.size} chapters" else ""
                "%,d words$chapters · ${format((doc.words / (160 * Speaker.renderSpeed)).toInt())}".format(doc.words)
            }
            else -> ""
        }

        // Reader: redraw and follow the current paragraph unless the user is browsing.
        if (Speaker.index != shownIndex || Speaker.currentPiece != shownPiece) {
            val moved = Speaker.index != shownIndex
            shownIndex = Speaker.index
            shownPiece = Speaker.currentPiece
            readerAdapter.notifyDataSetChanged()
            if (moved && System.currentTimeMillis() - lastUserScroll > 6_000) {
                reader.post { reader.smoothScrollToPositionFromTop(Speaker.index, (60 * resources.displayMetrics.density).toInt(), 250) }
            }
        }

        posBar.isEnabled = hasDoc
        if (hasDoc) {
            posBar.max = maxOf(0, doc!!.paragraphs.size - 1)
            if (!userSeeking) {
                posBar.progress = Speaker.index
                posLabel.text = positionLabel(Speaker.index)
            }
            val left = doc.words.toLong() * (doc.paragraphs.size - Speaker.index) / doc.paragraphs.size.coerceAtLeast(1)
            timeLabel.text = "${format((left / (160 * Speaker.renderSpeed)).toInt())} left"
        } else {
            posLabel.text = ""
            timeLabel.text = ""
        }
        listOf(btnPrev, btnPlay, btnNext).forEach { it.isEnabled = hasDoc }
        btnPlay.setImageResource(if (Speaker.playing) R.drawable.ic_pause else R.drawable.ic_play)
        btnChapters.alpha = if (doc != null && doc.chapters.size > 1) 1f else 0.35f
        btnSpeed.text = speedLabelOf(Speaker.speed)
        btnStyle.text = "Style: ${Speaker.style.label}"
        // "View Figure 3" while the paragraph that mentions it is being read.
        val figs = doc?.let { figuresIn(it, Speaker.index) }.orEmpty()
        btnFigure.visibility = if (figs.isNotEmpty()) View.VISIBLE else View.GONE
        if (figs.isNotEmpty()) btnFigure.text = "View " + figs.joinToString(", ") { it.label }
        btnSleep.text = when {
            Speaker.sleepEndOfChapter -> "Chapter end"
            Speaker.sleepAt > 0 -> "${((Speaker.sleepAt - System.currentTimeMillis()) / 60_000 + 1).coerceAtLeast(1)} min"
            else -> "Sleep"
        }
        btnSleep.setTextColor(color(if (Speaker.sleepAt > 0 || Speaker.sleepEndOfChapter) R.attr.p2aAccent else R.attr.p2aMuted))

        // Offline download
        val downloadingThis = OfflineDownloader.running && OfflineDownloader.docKey == doc?.key
        offlineProgress.visibility = if (downloadingThis) View.VISIBLE else View.GONE
        offlineProgress.progress = OfflineDownloader.progress
        btnOffline.text = if (OfflineDownloader.running) "Stop offline download" else "Download for offline listening"
        offlineStatus.text = when {
            Speaker.voiceId.startsWith(Speaker.SYSTEM) -> "Phone voices work offline already."
            downloadingThis -> OfflineDownloader.message ?: ""
            offlinePercent == 100 -> "Available offline with this voice and speed ✓"
            offlinePercent != null && offlinePercent!! > 0 -> "$offlinePercent% ready offline. Download the rest to listen without internet."
            else -> "Create all the audio now, then listen anywhere without internet. Also makes playback start instantly."
        }
        if (!OfflineDownloader.running && OfflineDownloader.docKey == doc?.key && offlineFor != null && offlinePercent != 100) {
            offlineFor = null
            refreshOfflineStatus()
        }

        // Save audio file
        btnExport.isEnabled = hasDoc
        btnExport.text = if (Exporter.running) "Cancel saving" else "Save audio file"
        exportProgress.visibility = if (Exporter.running) View.VISIBLE else View.GONE
        exportProgress.isIndeterminate = Exporter.running && Exporter.progress == 0
        exportProgress.progress = Exporter.progress
        val estimate = doc?.let {
            val (minutes, mb) = Exporter.estimate(it, Speaker.voiceId, Speaker.renderSpeed)
            "About ${format(minutes)} of audio, ~$mb MB. You can leave the app while it saves."
        }
        exportStatus.text = Exporter.message ?: estimate ?: ""
        exportStatus.visibility = if (exportStatus.text.isNotEmpty()) View.VISIBLE else View.GONE
        btnOpenAudio.visibility =
            if (Exporter.resultUri != null && !Exporter.running && Build.VERSION.SDK_INT >= 29) View.VISIBLE else View.GONE

        // Voices and on-device voice downloads
        if (Speaker.voicesVersion != voicesShown) setupVoices()
        val lang = doc?.lang
        val suggestion = lang?.takeIf { !Speaker.voiceFits(it) }?.let { Speaker.suggestVoice(it) }
        langHint.visibility = if (suggestion != null) View.VISIBLE else View.GONE
        if (suggestion != null) {
            val name = Speaker.voiceOptions().firstOrNull { it.id == suggestion }?.label?.substringBefore(" (")?.trimStart('★', '•', '◆', ' ')
            langHint.text = "This document is in ${Langs.name(lang!!)}, which this voice doesn't speak. Tap to switch to $name."
        }
        val active = ModelPack.active
        val needed = LocalTts.missing(Speaker.voiceId)
        val shown = active ?: needed ?: LocalTts.packFor(Speaker.voiceId)
        btnKokoro.visibility = if (needed != null || active != null) View.VISIBLE else View.GONE
        btnKokoro.text = if (active != null) "Cancel download" else "Download ${needed?.title} (~${needed?.sizeMb} MB)"
        btnDeleteKokoro.visibility = if (active == null && needed == null && shown != null) View.VISIBLE else View.GONE
        btnDeleteKokoro.text = "Delete ${shown?.title ?: "voices"}"
        kokoroProgress.visibility = if (active != null) View.VISIBLE else View.GONE
        kokoroProgress.progress = active?.progress ?: 0
        val packMessage = shown?.message
        kokoroStatus.visibility = if (packMessage != null && (needed != null || active != null)) View.VISIBLE else View.GONE
        kokoroStatus.text = packMessage ?: ""

        Speaker.lastError?.let {
            Speaker.lastError = null
            toast(it)
        }
    }

    private fun askNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 2)
        }
    }

    private fun toast(msg: String) {
        AppLog.i("Player", msg)
        Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
    }

    private fun chooseStyle() {
        val styles = Style.entries
        AlertDialog.Builder(this)
            .setTitle("Speaking style")
            .setSingleChoiceItems(styles.map { "${it.label} \u2014 ${it.note}" }.toTypedArray(), styles.indexOf(Speaker.style)) { d, which ->
                Speaker.setStyle(styles[which])
                d.dismiss()
            }
            .show()
    }

    // ---- AI (Google Gemini, free tier) ----

    private fun setupAi() {
        aiStatus = findViewById(R.id.aiStatus)
        aiProgress = findViewById(R.id.aiProgress)
        btnVisuals = findViewById(R.id.btnVisuals)
        btnChapterSummary = findViewById(R.id.btnChapterSummary)
        cbVisuals = findViewById(R.id.cbVisuals)
        cbVisuals.isChecked = prefs.getBoolean("aiVisuals", true)
        cbVisuals.setOnCheckedChangeListener { _, on ->
            prefs.edit().putBoolean("aiVisuals", on).apply()
            reparse()
        }
        findViewById<Button>(R.id.btnShortSummary).setOnClickListener { summarize(long = false, chapter = false) }
        findViewById<Button>(R.id.btnLongSummary).setOnClickListener { summarize(long = true, chapter = false) }
        btnChapterSummary.setOnClickListener { summarize(long = false, chapter = true) }
        btnVisuals.setOnClickListener { explainVisuals() }
        findViewById<Button>(R.id.btnTranslate).setOnClickListener { chooseTranslation() }
        langHint = findViewById(R.id.langHint)
        langHint.setOnClickListener {
            val lang = Speaker.doc?.lang ?: return@setOnClickListener
            Speaker.suggestVoice(lang)?.let { id ->
                Speaker.setVoice(id)
                LocalTts.missing(id)?.let(::promptDownload)
            }
        }
        findViewById<Button>(R.id.btnGeminiKey).setOnClickListener { askGeminiKey(null) }
        findViewById<Button>(R.id.btnBriefing).setOnClickListener { briefing() }
        findViewById<Button>(R.id.btnAsk).setOnClickListener { openChat() }
        findViewById<Button>(R.id.btnStudy).setOnClickListener {
            if (Speaker.doc != null) withKey { startActivity(Intent(this, StudyActivity::class.java)) }
        }
        findViewById<Button>(R.id.btnPodcast).setOnClickListener { podcast() }
    }

    private fun refreshAi() {
        val doc = Speaker.doc
        val item = doc?.let { Library.get(this, it.key) }
        val isPdf = item?.kind == Loader.Kind.PDF
        val visuals = if (isPdf) Ai.visuals(this, item!!) else null
        btnVisuals.visibility = if (isPdf) View.VISIBLE else View.GONE
        btnVisuals.text = if (visuals != null) "Explain figures and tables again" else "Explain figures and tables"
        cbVisuals.visibility = if (visuals != null) View.VISIBLE else View.GONE
        btnChapterSummary.visibility = if ((doc?.chapters?.size ?: 0) > 1) View.VISIBLE else View.GONE
        aiProgress.visibility = if (aiBusy != null) View.VISIBLE else View.GONE
        aiStatus.text = when {
            aiBusy != null -> aiBusy
            !Llm.ready(this) -> "Briefings, summaries, questions, study tools, podcasts, figure explanations and \"Explain\" " +
                "(long-press a paragraph). Needs a Grok key or a free Gemini key: tap any button to set it up."
            visuals != null -> "${visuals.size} figures, tables and equations explained" +
                if (cbVisuals.isChecked) "; they're read where the text first mentions them." else "."
            else -> "Long-press a paragraph in the reader and choose \"Explain with AI\" for a plain-language explanation."
        }
    }

    /** Asks for the key if it's missing, then runs [then]. */
    private fun withKey(then: () -> Unit) {
        if (Llm.ready(this)) then() else askGeminiKey(then)
    }

    private fun askGeminiKey(then: (() -> Unit)?) = AiKeyDialog.show(this, onChange = { refreshAi() }, then = then)

    private fun runAi(label: String, work: suspend ((String) -> Unit) -> Unit) {
        if (aiBusy != null) {
            toast("Please wait: $aiBusy")
            return
        }
        withKey {
            aiBusy = label
            refreshAi()
            scope.launch {
                try {
                    work { text -> runOnUiThread { aiBusy = text; refreshAi() } }
                } catch (e: Exception) {
                    AppLog.e("AI", "$label failed", e)
                    AlertDialog.Builder(this@PlayerActivity)
                        .setTitle("AI didn't work")
                        .setMessage(e.message ?: "Something went wrong. Check your internet connection.")
                        .setPositiveButton("OK", null)
                        .show()
                } finally {
                    aiBusy = null
                    refreshAi()
                }
            }
        }
    }

    private fun summarize(long: Boolean, chapter: Boolean) {
        val doc = Speaker.doc ?: return
        val item = Library.get(this, doc.key)
        val ch = if (chapter) doc.chapterAt(Speaker.index) else null
        val from = ch?.start ?: 0
        val to = ch?.let { c -> doc.chapters.firstOrNull { it.start > c.start }?.start } ?: doc.paragraphs.size
        val what = if (ch != null) "the chapter \"${ch.title}\"" else "the whole text"
        val name = when {
            ch != null -> "Summary of ${ch.title}"
            long -> "Long summary"
            else -> "Short summary"
        }
        runAi("Writing the ${name.lowercase()}…") { progress ->
            val text = withContext(Dispatchers.IO) {
                Ai.summary(this@PlayerActivity, doc, item, long, from, to, what, progress)
            }
            showAiText("$name: ${doc.title}", text, item)
        }
    }

    /** Explain a paragraph (or the [sentence] being read) in one of several ways, or ask about it. */
    private fun explainMenu(position: Int, sentence: String?) {
        val doc = Speaker.doc ?: return
        val modes = Ai.Explain.entries
        val labels = modes.map { it.label } + "Ask a question about this…"
        AlertDialog.Builder(this)
            .setTitle(if (sentence != null) "\u201C${sentence.take(70)}${if (sentence.length > 70) "…" else ""}\u201D" else "Paragraph ${position + 1}")
            .setItems(labels.toTypedArray()) { _, which ->
                if (which == modes.size) {
                    openChat("About \u201C${(sentence ?: doc.paragraphs[position]).take(160)}\u201D (¶${position + 1}): ")
                    return@setItems
                }
                val mode = modes[which]
                runAi("${mode.label}…") {
                    val text = withContext(Dispatchers.IO) { Ai.explain(this@PlayerActivity, doc, position, mode, sentence) }
                    showAiText(mode.label, text, null)
                }
            }
            .show()
    }

    private fun openChat(prefill: String? = null) {
        if (Speaker.doc == null) return
        withKey {
            startActivity(Intent(this, ChatActivity::class.java).apply { prefill?.let { putExtra("prefill", it) } })
        }
    }

    private fun briefing() {
        val doc = Speaker.doc ?: return
        val item = Library.get(this, doc.key)
        runAi("Preparing a 5-minute briefing…") { progress ->
            val text = withContext(Dispatchers.IO) { Ai.briefing(this@PlayerActivity, doc, item, progress) }
            showAiText("Briefing: ${doc.title}", text, item, playFull = true)
        }
    }

    private fun podcast() {
        val doc = Speaker.doc ?: return
        val item = Library.get(this, doc.key) ?: return
        val lengths = arrayOf("About 5 minutes", "About 10 minutes", "About 20 minutes")
        AlertDialog.Builder(this)
            .setTitle("Podcast: two hosts discuss it")
            .setItems(lengths) { _, which ->
                val minutes = intArrayOf(5, 10, 20)[which]
                runAi("Writing a ${minutes}-minute podcast…") { progress ->
                    val script = withContext(Dispatchers.IO) { Ai.podcast(this@PlayerActivity, doc, item, minutes, progress) }
                    addSummary("Podcast: ${doc.title}", script, item)
                    toast("Two voices: the host is your main voice; the expert uses the dialogue voice from Voice studio (or a matching one).")
                }
            }
            .show()
    }

    private fun chooseTranslation() {
        val doc = Speaker.doc ?: return
        val names = Ai.TRANSLATE_TO.map { it.second }.toTypedArray()
        AlertDialog.Builder(this)
            .setTitle("Translate into")
            .setItems(names) { _, which ->
                val (code, name) = Ai.TRANSLATE_TO[which]
                translate(doc, code, name)
            }
            .show()
    }

    private fun translate(doc: Doc, code: String, language: String) {
        val from = Library.get(this, doc.key)
        runAi("Translating into $language…") { progress ->
            val text = withContext(Dispatchers.IO) { Ai.translate(this@PlayerActivity, doc, language, progress) }
            val (item, newDoc) = withContext(Dispatchers.IO) {
                Opener.import(this@PlayerActivity, { Loader.storeText(this@PlayerActivity, "${doc.title} ($language)", text, "md") }).also { (item, _) ->
                    from?.collection?.let { Library.setCollection(this@PlayerActivity, item, it) }
                    from?.let { runCatching { Library.thumb(this@PlayerActivity, it.id).copyTo(Library.thumb(this@PlayerActivity, item.id), overwrite = true) } }
                }
            }
            newDoc.lang = code
            withContext(Dispatchers.IO) { Library.opened(this@PlayerActivity, item, newDoc) }
            Speaker.load(newDoc)
            coverFor = null
            DriveSync.request(this@PlayerActivity)
            val voice = if (Speaker.voiceFits(code)) null else Speaker.suggestVoice(code)
            if (voice != null) {
                Speaker.setVoice(voice)
                val label = Speaker.voiceOptions().firstOrNull { it.id == voice }?.label ?: voice
                toast("Translated and added to your library. Voice: $label")
                LocalTts.missing(voice)?.let(::promptDownload)
            } else {
                toast("Translated and added to your library")
            }
            if (LocalTts.missing(Speaker.voiceId) == null) Speaker.play()
        }
    }

    private fun explainVisuals() {
        val doc = Speaker.doc ?: return
        val item = Library.get(this, doc.key) ?: return
        runAi("Gemini is looking at the figures and tables… (up to a minute or two)") {
            val n = withContext(Dispatchers.IO) { Ai.explainVisuals(this@PlayerActivity, item, doc) }
            prefs.edit().putBoolean("aiVisuals", true).apply()
            cbVisuals.isChecked = true // reparses with the explanations inserted
            reparse()
            DriveSync.request(this@PlayerActivity)
            toast("$n figures, tables and equations explained. They're read where the text mentions them; see the contents list too.")
        }
    }

    /**
     * Shows an AI answer. "Listen" reads it now; for summaries, "Add to library" keeps it as
     * its own document (with the offline, speed and save-audio features).
     */
    private fun showAiText(title: String, text: String, item: Library.Item?, playFull: Boolean = false) {
        val d = resources.displayMetrics.density
        val view = ScrollView(this).apply {
            addView(TextView(this@PlayerActivity).apply {
                this.text = text
                textSize = 16f
                setLineSpacing(0f, 1.25f)
                setTextIsSelectable(true)
                setTextColor(Themes.color(this@PlayerActivity, R.attr.p2aText))
                setPadding((22 * d).toInt(), (10 * d).toInt(), (22 * d).toInt(), (10 * d).toInt())
            })
        }
        val builder = AlertDialog.Builder(this)
            .setTitle(title)
            .setView(view)
            .setPositiveButton("Listen", null)
            .setNegativeButton(if (playFull) "Listen to full text" else "Close") { _, _ ->
                Speaker.stopPreview()
                if (playFull) {
                    showTab(options = false)
                    Speaker.play()
                }
            }
            .setOnCancelListener { Speaker.stopPreview() }
        if (item != null) builder.setNeutralButton("Add to library") { _, _ -> Speaker.stopPreview(); addSummary(title, text, item) }
        val dialog = builder.show()
        // "Listen" keeps the dialog open so it can be read along.
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener { Speaker.preview(text) }
    }

    private fun addSummary(title: String, text: String, from: Library.Item) {
        busy = "Adding to library…"
        render()
        scope.launch {
            try {
                val (item, doc) = withContext(Dispatchers.IO) {
                    Opener.import(this@PlayerActivity, { Loader.storeText(this@PlayerActivity, title, text) }).also { (item, _) ->
                        if (from.collection != null) Library.setCollection(this@PlayerActivity, item, from.collection)
                        // Same thumbnail as the original.
                        runCatching { Library.thumb(this@PlayerActivity, from.id).copyTo(Library.thumb(this@PlayerActivity, item.id), overwrite = true) }
                        if (from.author != null) item.author = from.author
                    }
                }
                withContext(Dispatchers.IO) { Library.opened(this@PlayerActivity, item, doc) }
                Speaker.load(doc)
                Speaker.play()
                coverFor = null
                DriveSync.request(this@PlayerActivity)
                toast("Added to your library")
            } catch (e: Exception) {
                toast(e.message ?: "Couldn't add it")
            } finally {
                busy = null
                render()
            }
        }
    }

    override fun onStart() {
        super.onStart()
        Speaker.addListener(refresh)
        Exporter.addListener(refresh)
        ModelPack.addListener(refresh)
        OfflineDownloader.addListener(refresh)
        if (Speaker.sleepAt > 0) main.postDelayed(tick, 30_000)
        render()
    }

    override fun onResume() {
        super.onResume()
        setupVoices() // pick up phone voices installed while we were away
    }

    override fun onStop() {
        DriveSync.request(this) // share the listening position with other devices
        Speaker.removeListener(refresh)
        Exporter.removeListener(refresh)
        ModelPack.removeListener(refresh)
        OfflineDownloader.removeListener(refresh)
        main.removeCallbacks(tick)
        super.onStop()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
