package com.paper2audio.app

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.Voice
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
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
import java.io.File

class MainActivity : Activity() {
    private companion object {
        const val REQ_OPEN = 1
        const val MIN_SPEED = 0.5f
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val refresh: () -> Unit = { render() }
    private lateinit var prefs: SharedPreferences

    private lateinit var docTitle: TextView
    private lateinit var docInfo: TextView
    private lateinit var currentText: TextView
    private lateinit var posBar: SeekBar
    private lateinit var posLabel: TextView
    private lateinit var btnPrev: Button
    private lateinit var btnPlay: Button
    private lateinit var btnNext: Button
    private lateinit var btnChapters: Button
    private lateinit var speedLabel: TextView
    private lateinit var speedBar: SeekBar
    private lateinit var voiceSpinner: Spinner
    private lateinit var checks: List<CheckBox>
    private lateinit var btnExport: Button
    private lateinit var exportProgress: ProgressBar
    private lateinit var exportStatus: TextView
    private lateinit var btnOpenAudio: Button
    private lateinit var urlInput: EditText

    private var source: Loader.Source? = null
    private var voices: List<Voice> = emptyList()
    private var busy: String? = null
    private var userSeeking = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        prefs = getSharedPreferences("p2a", MODE_PRIVATE)

        docTitle = findViewById(R.id.docTitle)
        docInfo = findViewById(R.id.docInfo)
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
        urlInput = findViewById(R.id.urlInput)
        checks = listOf(R.id.cbRefs, R.id.cbCites, R.id.cbCaptions, R.id.cbAppendix).map { findViewById(it) }

        setupControls()
        Speaker.init(this) {
            setupVoices()
            render()
        }
        restoreSource()
        handleIntent(intent)
        render()
    }

    private fun setupControls() {
        findViewById<Button>(R.id.btnOpen).setOnClickListener { openPicker() }
        findViewById<Button>(R.id.btnFetch).setOnClickListener { fetch(urlInput.text.toString()) }
        urlInput.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_GO) fetch(urlInput.text.toString())
            actionId == EditorInfo.IME_ACTION_GO
        }

        btnPlay.setOnClickListener {
            askNotificationPermission()
            Speaker.toggle()
        }
        btnPrev.setOnClickListener { Speaker.previous() }
        btnNext.setOnClickListener { Speaker.next() }
        btnChapters.setOnClickListener { showChapters() }

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

        val keys = listOf("skipRefs", "removeCites", "skipCaptions", "skipAppendix")
        checks.forEachIndexed { i, cb ->
            cb.isChecked = prefs.getBoolean(keys[i], cb.isChecked)
            cb.setOnCheckedChangeListener { _, checked ->
                prefs.edit().putBoolean(keys[i], checked).apply()
                parseCurrent()
            }
        }

        findViewById<Button>(R.id.btnMoreVoices).setOnClickListener {
            try {
                startActivity(Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA))
            } catch (e: ActivityNotFoundException) {
                toast("Open Settings › Accessibility › Text-to-speech to add voices")
            }
        }

        btnExport.setOnClickListener {
            val doc = Speaker.doc ?: return@setOnClickListener
            if (Exporter.running) {
                Exporter.cancel()
            } else {
                askNotificationPermission()
                Exporter.start(this, doc, Speaker.currentVoiceName, Speaker.speed)
            }
        }
        btnOpenAudio.setOnClickListener {
            val uri = Exporter.resultUri ?: return@setOnClickListener
            try {
                startActivity(
                    Intent(Intent.ACTION_VIEW).setDataAndType(uri, "audio/mp4")
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                )
            } catch (e: Exception) {
                toast("No audio player found")
            }
        }
    }

    private fun speedOf(progress: Int) = MIN_SPEED + progress / 10f

    private fun speedText(progress: Int) = "Speed: %.1f×".format(speedOf(progress))

    private fun options() = CleanOptions(
        skipReferences = checks[0].isChecked,
        removeCitations = checks[1].isChecked,
        skipCaptions = checks[2].isChecked,
        skipAppendix = checks[3].isChecked,
    )

    private fun setupVoices() {
        voices = Speaker.voices()
        if (voices.isEmpty()) return
        val labels = voices.map { v ->
            val online = if (v.isNetworkConnectionRequired) " (online)" else ""
            "${v.locale.displayName} · ${v.name}$online"
        }
        voiceSpinner.onItemSelectedListener = null
        voiceSpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_item, labels).apply {
            setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        }
        val current = voices.indexOfFirst { it.name == Speaker.currentVoiceName }
        if (current >= 0) voiceSpinner.setSelection(current, false)
        voiceSpinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                val name = voices[position].name
                if (name != Speaker.currentVoiceName) Speaker.setVoice(name)
            }

            override fun onNothingSelected(parent: AdapterView<*>?) = Unit
        }
    }

    private fun openPicker() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("*/*")
            .putExtra(
                Intent.EXTRA_MIME_TYPES,
                arrayOf("application/pdf", "application/epub+zip", "text/plain", "text/markdown"),
            )
        @Suppress("DEPRECATION")
        startActivityForResult(intent, REQ_OPEN)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_OPEN && resultCode == RESULT_OK) data?.data?.let(::importUri)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        when (intent?.action) {
            Intent.ACTION_VIEW -> intent.data?.let(::importUri)
            Intent.ACTION_SEND -> {
                @Suppress("DEPRECATION")
                val stream = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
                val text = intent.getStringExtra(Intent.EXTRA_TEXT)
                when {
                    stream != null -> importUri(stream)
                    text != null -> fetch(Regex("""https?://\S+""").find(text)?.value ?: text)
                }
            }
        }
        intent?.action = null // don't re-import on rotation
    }

    private fun importUri(uri: Uri) = load { Loader.importUri(this, uri) }

    private fun fetch(text: String) {
        if (text.isBlank()) return
        load { Loader.download(this, text) }
    }

    private fun load(block: () -> Loader.Source) {
        busy = "Opening…"
        render()
        scope.launch {
            try {
                val src = withContext(Dispatchers.IO) { block() }
                source = src
                prefs.edit()
                    .putString("srcPath", src.file.absolutePath)
                    .putString("srcKind", src.kind.name)
                    .putString("srcName", src.name)
                    .apply()
                parseCurrent()
            } catch (e: Exception) {
                busy = null
                render()
                toast(e.message ?: "Could not open that")
            }
        }
    }

    private fun restoreSource() {
        val path = prefs.getString("srcPath", null) ?: return
        val file = File(path)
        if (!file.exists()) return
        val kind = runCatching { Loader.Kind.valueOf(prefs.getString("srcKind", "")!!) }.getOrNull() ?: return
        source = Loader.Source(file, kind, prefs.getString("srcName", file.name)!!)
        if (Speaker.doc == null) parseCurrent()
    }

    private fun parseCurrent() {
        val src = source ?: return
        busy = "Reading ${src.name}…"
        render()
        val opts = options()
        scope.launch {
            try {
                val doc = withContext(Dispatchers.Default) { Loader.parse(this@MainActivity, src, opts) }
                if (doc.paragraphs.isEmpty()) {
                    error("No readable text found. Scanned PDFs need OCR, and DRM-protected books can't be read.")
                }
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
        return "$chapter${index + 1} of ${doc.paragraphs.size}"
    }

    private fun render() {
        val doc = Speaker.doc
        val hasDoc = doc != null && doc.paragraphs.isNotEmpty()
        docTitle.text = doc?.title ?: "No document open"
        docInfo.text = when {
            busy != null -> busy
            Speaker.initFailed -> "No text-to-speech engine found. Install \"Speech Services by Google\" from the Play Store."
            doc != null -> {
                val minutes = (doc.words / (160 * Speaker.speed)).toInt()
                val length = if (minutes >= 60) "${minutes / 60} h ${minutes % 60} min" else "$minutes min"
                val chapters = if (doc.chapters.size > 1) " · ${doc.chapters.size} chapters" else ""
                "${doc.words} words$chapters · about $length"
            }
            else -> "Open a paper or book, or paste an arXiv ID or link."
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
        listOf(btnPrev, btnPlay, btnNext).forEach { it.isEnabled = hasDoc && Speaker.ready }
        btnPlay.text = if (Speaker.playing) "❚❚ Pause" else "▶ Play"
        btnChapters.visibility = if (doc != null && doc.chapters.size > 1) View.VISIBLE else View.GONE

        btnExport.isEnabled = hasDoc && Speaker.ready
        btnExport.text = if (Exporter.running) "Cancel saving" else "Save as audio file"
        exportProgress.visibility = if (Exporter.running) View.VISIBLE else View.GONE
        exportProgress.progress = Exporter.progress
        exportStatus.text = Exporter.message ?: ""
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
        render()
    }

    override fun onResume() {
        super.onResume()
        if (Speaker.ready) setupVoices() // pick up voices installed while we were away
    }

    override fun onStop() {
        Speaker.removeListener(refresh)
        Exporter.removeListener(refresh)
        super.onStop()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
