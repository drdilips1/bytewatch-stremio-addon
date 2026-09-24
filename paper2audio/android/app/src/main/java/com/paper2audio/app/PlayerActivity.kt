package com.paper2audio.app

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.graphics.Outline
import android.os.Build
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.view.View
import android.view.ViewOutlineProvider
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.CheckBox
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.ProgressBar
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

/** The "now reading" screen: cover, text, playback controls, voice, saving and options. */
class PlayerActivity : Activity() {
    private companion object {
        const val MIN_SPEED = 0.5f
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val refresh: () -> Unit = { render() }
    private lateinit var prefs: SharedPreferences

    private lateinit var cover: ImageView
    private lateinit var docTitle: TextView
    private lateinit var docAuthor: TextView
    private lateinit var docInfo: TextView
    private lateinit var docDescription: TextView
    private lateinit var currentText: TextView
    private lateinit var posBar: SeekBar
    private lateinit var posLabel: TextView
    private lateinit var btnPrev: ImageButton
    private lateinit var btnPlay: ImageButton
    private lateinit var btnNext: ImageButton
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

    private var voices: List<Speaker.VoiceOption> = emptyList()
    private var voicesShown = -1
    private var busy: String? = null
    private var userSeeking = false
    private var coverFor: String? = null

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
        docDescription.setOnClickListener {
            docDescription.maxLines = if (docDescription.maxLines == 3) Int.MAX_VALUE else 3
        }
        currentText = findViewById(R.id.currentText)
        posBar = findViewById(R.id.posBar)
        posLabel = findViewById(R.id.posLabel)
        btnPrev = findViewById(R.id.btnPrev)
        btnPlay = findViewById(R.id.btnPlay)
        btnNext = findViewById(R.id.btnNext)
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
        checks = listOf(R.id.cbRefs, R.id.cbCites, R.id.cbCaptions, R.id.cbAppendix).map { findViewById(it) }

        cover.outlineProvider = object : ViewOutlineProvider() {
            override fun getOutline(view: View, outline: Outline) {
                outline.setRoundRect(0, 0, view.width, view.height, 14 * resources.displayMetrics.density)
            }
        }
        cover.clipToOutline = true

        setupControls()
        Speaker.init(this) {
            setupVoices()
            render()
        }
        Library.loadCurrentId(this)
        if (Speaker.doc == null) reparse()
        render()
    }

    private fun setupControls() {
        findViewById<ImageButton>(R.id.btnBack).setOnClickListener { finish() }
        findViewById<ImageButton>(R.id.btnTheme).setOnClickListener { Themes.showPicker(this) }

        btnPlay.setOnClickListener {
            askNotificationPermission()
            Speaker.toggle()
        }
        btnPrev.setOnClickListener { Speaker.previous() }
        btnNext.setOnClickListener { Speaker.next() }
        btnChapters.setOnClickListener { showChapters() }
        findViewById<ImageButton>(R.id.btnDetails).setOnClickListener { showDetailsMenu() }

        posBar.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(bar: SeekBar, value: Int, fromUser: Boolean) {
                if (fromUser) posLabel.text = positionLabel(value)
            }

            override fun onStartTrackingTouch(bar: SeekBar) {
                userSeeking = true
            }

            override fun onStopTrackingTouch(bar: SeekBar) {
                userSeeking = false
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

        checks.forEachIndexed { i, cb ->
            cb.isChecked = prefs.getBoolean(Opener.OPTION_KEYS[i], Opener.OPTION_DEFAULTS[i])
            cb.setOnCheckedChangeListener { _, checked ->
                prefs.edit().putBoolean(Opener.OPTION_KEYS[i], checked).apply()
                reparse()
            }
        }

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

    private fun speedOf(progress: Int) = MIN_SPEED + progress / 10f

    private fun speedText(progress: Int) = "Speed  %.1f×".format(speedOf(progress))

    private fun setupVoices() {
        voicesShown = Speaker.voicesVersion
        voices = Speaker.voiceOptions()
        voiceSpinner.onItemSelectedListener = null
        voiceSpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_item, voices.map { it.label }).apply {
            setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        }
        // voiceOptions() always contains the saved voice, so this never falls back to
        // an arbitrary (possibly foreign-language) first entry.
        voiceSpinner.setSelection(voices.indexOfFirst { it.id == Speaker.voiceId }.coerceAtLeast(0), false)
        voiceSpinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                val option = voices.getOrNull(position) ?: return
                if (option.id == Speaker.voiceId) return
                Speaker.setVoice(option.id)
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
        val input = android.widget.EditText(this).apply {
            hint = "Paste your Hardcover API key"
            setText(prefs.getString("hardcoverToken", "") ?: "")
            isSingleLine = true
        }
        val box = android.widget.FrameLayout(this).apply {
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
        AlertDialog.Builder(this)
            .setTitle("Chapters")
            .setItems(doc.chapters.map { it.title }.toTypedArray()) { _, i -> Speaker.seek(doc.chapters[i].start) }
            .show()
    }

    private fun positionLabel(index: Int): String {
        val doc = Speaker.doc ?: return ""
        val chapter = doc.chapterAt(index)?.title?.let { "$it · " } ?: ""
        val pct = if (doc.paragraphs.size > 1) index * 100 / (doc.paragraphs.size - 1) else 0
        return "$chapter$pct%  ·  ${index + 1} of ${doc.paragraphs.size}"
    }

    private fun loadCover(id: String) {
        if (coverFor == id) return
        coverFor = id
        scope.launch {
            val px = (150 * resources.displayMetrics.density).toInt()
            Thumbs.load(Library.thumb(this@PlayerActivity, id), px)?.let { cover.setImageBitmap(it) }
        }
    }

    private fun format(minutes: Int) = if (minutes >= 60) "${minutes / 60} h ${minutes % 60} min" else "$minutes min"

    private fun render() {
        val doc = Speaker.doc
        val hasDoc = doc != null && doc.paragraphs.isNotEmpty()
        // Details looked up for the library item take priority over what's inside the file.
        val item = doc?.let { Library.get(this, it.key) }
        docTitle.text = item?.title ?: doc?.title ?: ""
        val author = listOfNotNull(item?.author ?: doc?.author, item?.year?.takeIf { it > 0 }?.toString()).joinToString(" · ")
        docAuthor.text = author
        docAuthor.visibility = if (author.isNotEmpty()) View.VISIBLE else View.GONE
        docDescription.text = item?.description ?: ""
        docDescription.visibility = if (item?.description != null) View.VISIBLE else View.GONE
        doc?.let { loadCover(it.key) }
        docInfo.text = when {
            busy != null -> busy
            doc != null -> {
                val left = doc.words * (doc.paragraphs.size - Speaker.index) / doc.paragraphs.size.coerceAtLeast(1)
                val total = format((doc.words / (160 * Speaker.speed)).toInt())
                val remaining = format((left / (160 * Speaker.speed)).toInt())
                val chapters = if (doc.chapters.size > 1) " · ${doc.chapters.size} chapters" else ""
                "%,d words$chapters · $total · $remaining left".format(doc.words)
            }
            else -> ""
        }
        currentText.text = if (hasDoc) doc!!.paragraphs[Speaker.index] else ""
        posBar.isEnabled = hasDoc
        if (hasDoc) {
            posBar.max = maxOf(0, doc!!.paragraphs.size - 1)
            if (!userSeeking) posBar.progress = Speaker.index
            if (!userSeeking) posLabel.text = positionLabel(Speaker.index)
        } else {
            posLabel.text = ""
        }
        listOf(btnPrev, btnPlay, btnNext).forEach { it.isEnabled = hasDoc }
        btnPlay.setImageResource(if (Speaker.playing) R.drawable.ic_pause else R.drawable.ic_play)
        btnChapters.visibility = if (doc != null && doc.chapters.size > 1) View.VISIBLE else View.INVISIBLE

        btnExport.isEnabled = hasDoc
        btnExport.text = if (Exporter.running) "Cancel saving" else "Save audio file"
        exportProgress.visibility = if (Exporter.running) View.VISIBLE else View.GONE
        exportProgress.isIndeterminate = Exporter.running && Exporter.progress == 0
        exportProgress.progress = Exporter.progress
        val estimate = doc?.let {
            val (minutes, mb) = Exporter.estimate(it, Speaker.voiceId, Speaker.speed)
            val length = if (minutes >= 60) "${minutes / 60} h ${minutes % 60} min" else "$minutes min"
            "About $length of audio, ~$mb MB. You can leave the app while it saves."
        }
        exportStatus.text = Exporter.message ?: estimate ?: ""
        exportStatus.visibility = if (exportStatus.text.isNotEmpty()) View.VISIBLE else View.GONE
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
        btnOpenAudio.visibility =
            if (Exporter.resultUri != null && !Exporter.running && Build.VERSION.SDK_INT >= 29) View.VISIBLE else View.GONE
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
        super.onStop()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
