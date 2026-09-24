package com.paper2audio.app

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
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
        btnPrev.setOnClickListener { Speaker.previous() }
        btnNext.setOnClickListener { Speaker.next() }
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
        findViewById<Button>(R.id.btnMoreVoices).setOnClickListener {
            try {
                startActivity(Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA))
            } catch (e: ActivityNotFoundException) {
                toast("Open Settings › Accessibility › Text-to-speech to add voices")
            }
        }

        btnDeleteKokoro.setOnClickListener {
            AlertDialog.Builder(this)
                .setTitle("Delete Kokoro voices?")
                .setMessage("This frees about 350 MB. You can download them again later.")
                .setPositiveButton("Delete") { _, _ ->
                    if (Speaker.isKokoro) Speaker.setVoice(Speaker.DEFAULT_VOICE)
                    Kokoro.uninstall { Speaker.refreshVoices() }
                }
                .setNegativeButton("Cancel", null)
                .show()
        }
        btnKokoro.setOnClickListener {
            if (Kokoro.installing) Kokoro.cancelInstall() else promptKokoroDownload()
        }

        btnOffline.setOnClickListener {
            val doc = Speaker.doc ?: return@setOnClickListener
            when {
                OfflineDownloader.running -> OfflineDownloader.cancel()
                Speaker.voiceId.startsWith(Speaker.SYSTEM) ->
                    toast("Phone voices already work offline. Offline download is for ★ and ◆ voices.")
                else -> {
                    askNotificationPermission()
                    OfflineDownloader.start(this, doc, Speaker.voiceId, Speaker.speed)
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
                Exporter.start(this, doc, Speaker.voiceId, Speaker.speed)
            }
        }
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
        val options = mutableListOf("Play from here", "Add bookmark", "Add note…", "Copy text")
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
                if (option.id.startsWith(Speaker.KOKORO) && !Kokoro.isInstalled() && !Kokoro.installing) {
                    promptKokoroDownload()
                }
            }

            override fun onNothingSelected(parent: AdapterView<*>?) = Unit
        }
    }

    private fun promptKokoroDownload() {
        AlertDialog.Builder(this)
            .setTitle("Download Kokoro voices?")
            .setMessage(
                "Kokoro voices work offline, with no limits. They need a one-time download " +
                    "of about 300–350 MB, so Wi-Fi is best. You can keep using the app while it downloads."
            )
            .setPositiveButton("Download") { _, _ ->
                askNotificationPermission()
                Kokoro.install { Speaker.refreshVoices() }
            }
            .setNegativeButton("Not now", null)
            .show()
    }

    // ---- Offline ----

    private fun refreshOfflineStatus() {
        val doc = Speaker.doc ?: return
        val key = "${doc.key}|${Speaker.voiceId}|${Speaker.speed}"
        if (offlineFor == key && !OfflineDownloader.running) return
        offlineFor = key
        val vid = Speaker.voiceId
        val sp = Speaker.speed
        scope.launch {
            offlinePercent = withContext(Dispatchers.IO) { OfflineDownloader.percentCached(this@PlayerActivity, doc, vid, sp) }
            render()
        }
    }

    // ---- Details ----

    private fun showDetailsMenu() {
        val hasKey = !prefs.getString("hardcoverToken", null).isNullOrBlank()
        val options = arrayOf(
            "Look up cover and details",
            if (hasKey) "Hardcover API key (saved ✓)" else "Add Hardcover API key",
        )
        AlertDialog.Builder(this)
            .setTitle("Book details")
            .setItems(options) { _, which -> if (which == 0) lookUpDetails() else askHardcoverKey() }
            .show()
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
        AlertDialog.Builder(this)
            .setTitle("Contents")
            .setSingleChoiceItems(doc.chapters.map { it.title }.toTypedArray(), current) { d, i ->
                d.dismiss()
                lastUserScroll = 0
                Speaker.seek(doc.chapters[i].start)
                showTab(options = false)
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

        if (doc != null && notesFor != doc.key) {
            notesFor = doc.key
            noteIndexes = item?.let { Library.notes(it).map { n -> n.index }.toSet() } ?: emptySet()
            readerAdapter.notifyDataSetChanged()
        }
        docInfo.text = when {
            busy != null -> busy
            doc != null -> {
                val chapters = if (doc.chapters.size > 1) " · ${doc.chapters.size} chapters" else ""
                "%,d words$chapters · ${format((doc.words / (160 * Speaker.speed)).toInt())}".format(doc.words)
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
            timeLabel.text = "${format((left / (160 * Speaker.speed)).toInt())} left"
        } else {
            posLabel.text = ""
            timeLabel.text = ""
        }
        listOf(btnPrev, btnPlay, btnNext).forEach { it.isEnabled = hasDoc }
        btnPlay.setImageResource(if (Speaker.playing) R.drawable.ic_pause else R.drawable.ic_play)
        btnChapters.alpha = if (doc != null && doc.chapters.size > 1) 1f else 0.35f
        btnSpeed.text = speedLabelOf(Speaker.speed)
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
            val (minutes, mb) = Exporter.estimate(it, Speaker.voiceId, Speaker.speed)
            "About ${format(minutes)} of audio, ~$mb MB. You can leave the app while it saves."
        }
        exportStatus.text = Exporter.message ?: estimate ?: ""
        exportStatus.visibility = if (exportStatus.text.isNotEmpty()) View.VISIBLE else View.GONE
        btnOpenAudio.visibility =
            if (Exporter.resultUri != null && !Exporter.running && Build.VERSION.SDK_INT >= 29) View.VISIBLE else View.GONE

        // Voices and Kokoro
        if (Speaker.voicesVersion != voicesShown) setupVoices()
        val needsKokoro = Speaker.isKokoro && !Kokoro.isInstalled()
        btnKokoro.visibility = if (needsKokoro || Kokoro.installing) View.VISIBLE else View.GONE
        btnDeleteKokoro.visibility = if (Kokoro.isInstalled() && !Kokoro.installing) View.VISIBLE else View.GONE
        btnKokoro.text = if (Kokoro.installing) "Cancel download" else "Download Kokoro voices (~350 MB)"
        kokoroProgress.visibility = if (Kokoro.installing) View.VISIBLE else View.GONE
        kokoroProgress.progress = Kokoro.progress
        val kokoroMessage = Kokoro.message
        kokoroStatus.visibility = if (kokoroMessage != null && (needsKokoro || Kokoro.installing)) View.VISIBLE else View.GONE
        kokoroStatus.text = kokoroMessage ?: ""

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

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_LONG).show()

    override fun onStart() {
        super.onStart()
        Speaker.addListener(refresh)
        Exporter.addListener(refresh)
        Kokoro.addListener(refresh)
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
        Kokoro.removeListener(refresh)
        OfflineDownloader.removeListener(refresh)
        main.removeCallbacks(tick)
        super.onStop()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
