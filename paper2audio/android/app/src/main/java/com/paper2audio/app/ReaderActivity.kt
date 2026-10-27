package com.paper2audio.app

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Typeface
import android.media.MediaPlayer
import android.os.Bundle
import android.text.TextUtils
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import kotlin.coroutines.resume

/**
 * Read: Audiohub's ebook reader as it is (its page, built from its own code into
 * assets/reader, see paper2audio/reader-web), on the book open in the player. Its calls to
 * Audiohub's Android plugins are answered here (and the player's controls are under the page): Read aloud is this app's player and voice,
 * its files are kept in the app's files, Pages is the app's PDF viewer, and in Paper to Audio
 * the AI is the app's own.
 */
class ReaderActivity : Activity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var web: WebView
    private var doc: Doc? = null

    /** Each reader paragraph's paragraph in [doc] (the page's blocks, or those Read aloud was given). */
    private var idx: IntArray? = null
    private var aloud = false

    // The player's controls, under the page (as on the player screen).
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
    private val prefs by lazy { getSharedPreferences("p2a", MODE_PRIVATE) }
    private var draggingPosition = false
    private var exportWasRunning = Exporter.running
    private var exportDone = true
    private val refresh: () -> Unit = { runOnUiThread { render(); sendState() } }
    private val handler = android.os.Handler(android.os.Looper.getMainLooper())

    /**
     * The words being read, as on the player screen: the sentence marked and the word being spoken in the
     * accent color (sent to the page several times a second while the voice reads).
     */
    private var spokenSent: String? = null
    private val follower = object : Runnable {
        override fun run() {
            sendSpoken()
            handler.postDelayed(this, 120)
        }
    }

    private fun sendSpoken() {
        if (!::web.isInitialized || Speaker.doc !== doc) return
        val piece = Speaker.currentPiece
        val data = JSONObject().put("i", Speaker.index).put("piece", piece ?: "").put("playing", Speaker.playing)
            .put("p", if (Speaker.playing) Speaker.pieceProgress().toDouble() else 0.0).toString()
        if (data == spokenSent) return
        spokenSent = data
        web.evaluateJavascript("window.__p2aSpoken && window.__p2aSpoken($data)", null)
    }

    /** Whether the page follows the voice (its Read aloud is attached to the player). */
    private var wasPlaying = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        Themes.apply(this)
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_reader)
        LiteUi.fitSystemBars(this, findViewById(R.id.readerRoot))
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
        btnPlay.setOnClickListener {
            if (BuildConfig.LITE) LiteUi.askNotifications(this)
            // Playing: pause. Otherwise the reader's Read aloud starts (from the paragraph on screen,
            // or carries on where it paused), so the page follows the voice.
            if (Speaker.playing) Speaker.pause()
            else if (!::web.isInitialized) Speaker.play()
            else web.evaluateJavascript("window.__p2aAloud ? (window.__p2aAloud.play(), 1) : 0") { if (it != "1") Speaker.play() }
        }
        findViewById<View>(R.id.btnPrev).setOnClickListener { Speaker.previousSentence() }
        findViewById<View>(R.id.btnNext).setOnClickListener { Speaker.nextSentence() }
        btnSpeed.setOnClickListener { LiteUi.showSpeed(this) { render() } }
        btnVoice.setOnClickListener { pickVoice() }
        btnSleep.setOnClickListener { LiteUi.showSleep(this) { render() } }
        // Narrato: More (the player screen's options, here). Paper to Audio: back to its player screen.
        val more = findViewById<Button>(R.id.btnListen)
        if (BuildConfig.LITE) {
            more.text = "More"
            more.setCompoundDrawablesRelativeWithIntrinsicBounds(0, R.drawable.ic_more, 0, 0)
            more.contentDescription = "More: pronunciations, save the text, report a problem"
            more.setOnClickListener { showMore() }
        } else more.setOnClickListener {
            startActivity(Intent(this, PlayerActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
        }
        position.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(s: SeekBar, p: Int, fromUser: Boolean) {
                if (fromUser) where.text = placeOf(p)
            }

            override fun onStartTrackingTouch(s: SeekBar) {
                draggingPosition = true
            }

            override fun onStopTrackingTouch(s: SeekBar) {
                draggingPosition = false
                Speaker.seek(s.progress)
            }
        })
        Speaker.init(this) { render() }
        val d = Speaker.doc
        if (d != null) return showBook(d)
        // Opened after the app was closed: reopen the last book.
        Library.loadCurrentId(this)
        val item = Library.get(this, Library.currentId) ?: return finish()
        status.text = "Opening ${item.title}…"
        status.visibility = View.VISIBLE
        scope.launch {
            try {
                val opened = withContext(Dispatchers.Default) { Opener.parse(this@ReaderActivity, item) }
                Speaker.load(opened)
                showBook(opened)
            } catch (e: Exception) {
                AppLog.e("Open", "Couldn't reopen", e)
                finish()
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun showBook(d: Doc) {
        doc = d
        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            setBackgroundColor(0xFF131218.toInt())
            addJavascriptInterface(Bridge(), "P2AReader")
            webViewClient = object : WebViewClient() {
                // The page is served from the app's assets at an https address (its scripts are modules,
                // which don't load from file:// addresses), and its saved settings stay with that address.
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                    val url = request.url
                    if (url.host != HOST) return null
                    val path = url.path.orEmpty().trimStart('/')
                    if (path == "book.html") return runCatching {
                        WebResourceResponse("text/html", "utf-8", bookFile().inputStream())
                    }.getOrNull()
                    return runCatching {
                        WebResourceResponse(mime(path), if (mime(path).startsWith("text") || path.endsWith(".js")) "utf-8" else null, assets.open(path))
                    }.getOrNull()
                }

                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = request.url.host != HOST
            }
        }
        findViewById<FrameLayout>(R.id.readerPage).addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        Speaker.addListener(refresh)
        web.loadUrl("https://$HOST/reader/index.html")
        render()
    }

    override fun onStart() {
        super.onStart()
        Exporter.addListener(refresh)
        ModelPack.addListener(refresh)
        handler.post(follower)
    }

    override fun onStop() {
        Exporter.removeListener(refresh)
        ModelPack.removeListener(refresh)
        handler.removeCallbacks(follower)
        super.onStop()
    }

    override fun onResume() {
        super.onResume()
        // Another book opened meanwhile (from the player or Home): show that one.
        if (doc != null && Speaker.doc != null && Speaker.doc !== doc) return recreate()
        if (::web.isInitialized) render()
    }

    override fun onDestroy() {
        Speaker.removeListener(refresh)
        translation?.stop()
        scope.cancel()
        if (::web.isInitialized) web.destroy()
        super.onDestroy()
    }

    @Deprecated("Back closes what the reader has open first")
    override fun onBackPressed() {
        if (!::web.isInitialized) return leave()
        web.evaluateJavascript("window.__p2aBack ? (window.__p2aBack(), 1) : 0") { if (it != "1") leave() }
    }

    /** Back to the library; a natural break for an ad when not listening (as from the player). */
    private fun leave() {
        if (BuildConfig.LITE) Ads.interstitial(this, "leave") { finish() } else finish()
    }

    /** The controls as on the player screen: play, speed, voice, sleep timer, where in the book. */
    private fun render() {
        if (BuildConfig.LITE) suggestLighterVoice()
        renderTask()
        val d = Speaker.doc
        btnPlay.setImageResource(if (Speaker.playing) R.drawable.ic_pause else R.drawable.ic_play)
        btnPlay.contentDescription = if (Speaker.playing) "Pause" else "Play"
        btnSpeed.text = LiteUi.speedLabel()
        btnVoice.text = voiceName()
        btnSleep.text = LiteUi.sleepLabel()
        val message = when {
            Speaker.lastError != null -> Speaker.lastError
            Speaker.starting && Speaker.playing ->
                if (Speaker.isLocal) "Starting the voice… (a few seconds the first time)" else "Starting…"
            else -> null
        }
        status.text = message
        status.visibility = if (message == null) View.GONE else View.VISIBLE
        if (message != null) {
            val tint = Themes.color(this, if (Speaker.lastError != null) R.attr.p2aText else R.attr.p2aAccent)
            status.setTextColor(tint)
            status.textSize = 15f
            status.setTypeface(status.typeface, Typeface.BOLD)
            val pad = (10 * resources.displayMetrics.density).toInt()
            status.setPadding(pad * 2, pad, pad * 2, pad)
            status.background = android.graphics.drawable.GradientDrawable().apply {
                setColor((Themes.color(this@ReaderActivity, R.attr.p2aAccent) and 0x00FFFFFF) or 0x24000000)
                cornerRadius = pad * 2f
            }
        }
        if (d != null && !draggingPosition) {
            position.max = maxOf(0, d.paragraphs.size - 1)
            position.progress = Speaker.index
            where.text = placeOf(Speaker.index)
            val wordsLeft = d.paragraphs.drop(Speaker.index).sumOf { p -> p.count { it == ' ' } + 1 }
            val minutes = (wordsLeft / (160f * Speaker.renderSpeed)).toInt()
            left.text = if (minutes >= 60) "${minutes / 60} h ${minutes % 60} min left" else "$minutes min left"
        }
        // The voice started from the controls (or the notification): the page follows it.
        if (Speaker.playing && !wasPlaying && ::web.isInitialized) web.evaluateJavascript("window.__p2aAloud && window.__p2aAloud.follow()", null)
        wasPlaying = Speaker.playing
    }

    private fun placeOf(i: Int): String {
        val d = Speaker.doc ?: return ""
        val chapter = d.chapterAt(i)?.title
        val pct = if (d.paragraphs.size > 1) i * 100 / (d.paragraphs.size - 1) else 0
        return if (chapter != null) "$chapter · $pct%" else "$pct%"
    }

    // ---- the bridge ---------------------------------------------------------------------

    private inner class Bridge {
        @JavascriptInterface
        fun plugins(): String = JSONArray(
            listOfNotNull(
                "P2AReader", "InkwellReadAloud", "InkwellWeb",
                "pages".takeIf { item()?.kind == Loader.Kind.PDF },
                "P2AAi".takeIf { !BuildConfig.LITE },
            )
        ).toString()

        @JavascriptInterface
        fun call(id: Int, plugin: String, method: String, args: String) {
            val a = runCatching { JSONObject(args) }.getOrDefault(JSONObject())
            runOnUiThread {
                scope.launch {
                    val result = runCatching { handle(plugin, method, a) }
                    val json = result.getOrNull() ?: JSONObject().put("__error", result.exceptionOrNull()?.message ?: "Didn't work")
                    if (!isDestroyed) web.evaluateJavascript("window.__p2aDone($id, ${JSONObject.quote(json.toString())})", null)
                }
            }
        }
    }

    private fun emit(plugin: String, event: String, data: JSONObject) {
        if (!isDestroyed && ::web.isInitialized) web.evaluateJavascript("window.__p2aEvent('$plugin', '$event', ${JSONObject.quote(data.toString())})", null)
    }

    private fun item() = Library.get(this, Library.currentId)

    private suspend fun handle(plugin: String, method: String, a: JSONObject): JSONObject {
        val d = doc ?: error("No book open")
        val ok = JSONObject()
        return when ("$plugin.$method") {
            "P2AReader.book" -> withContext(Dispatchers.Default) { book(d) }
            "P2AReader.close" -> ok.also { leave() }
            "P2AReader.pronounce" -> ok.also { Pronounce.show(this, a.optString("word").trim().trim('“', '”', '"', '\'', ',', '.', '!', '?', ';', ':')) }
            "P2AReader.voice" -> JSONObject().put("name", voiceName())
            "P2AReader.pickVoice" -> ok.also { pickVoice() }
            "P2AReader.pages" -> ok.also {
                val item = item() ?: error("This PDF isn't in the library")
                PdfPages.show(this, Library.source(this, item).file, a.optDouble("fraction", 0.0).toFloat())
            }
            "P2AReader.shareQuote" -> ok.also {
                Sharing.shareQuote(this, a.optString("text"), a.optString("title", d.title), a.optString("author").ifBlank { d.author })
            }
            "P2AReader.askAi" -> {
                if (BuildConfig.LITE) error("Not available")
                if (!Llm.ready(this)) error("Add your AI key first (Settings → AI)")
                JSONObject().put("text", withContext(Dispatchers.IO) { Llm.generate(this@ReaderActivity, a.optString("prompt")) })
            }
            "InkwellWeb.keepRead" -> JSONObject().put("text", withContext(Dispatchers.IO) { keepFile(a).takeIf { it.exists() }?.readText() ?: "" })
            "InkwellWeb.keepWrite" -> ok.also { withContext(Dispatchers.IO) { keepFile(a).writeText(a.optString("text")) } }
            "InkwellReadAloud.start" -> ok.also { startAloud(d, a) }
            "InkwellReadAloud.pause" -> ok.also { translation?.pause() ?: Speaker.pause() }
            "InkwellReadAloud.resume" -> ok.also {
                aloud = true
                translation?.resume() ?: Speaker.play()
            }
            "InkwellReadAloud.stop" -> ok.also {
                aloud = false
                translation?.stop()
                translation = null
                Speaker.pause()
            }
            "InkwellReadAloud.seek" -> ok.also {
                val p = a.optInt("para")
                translation?.seek(p) ?: idx?.let { m -> docIndex(m, p)?.let { Speaker.seek(it) } }
            }
            "InkwellReadAloud.setRate" -> ok.also { if (translation == null) Speaker.setSpeed(a.optDouble("rate", 1.0).toFloat()) }
            "InkwellReadAloud.addParas" -> ok.also {
                val list = a.optJSONArray("paras") ?: JSONArray()
                for (k in 0 until list.length()) list.optJSONObject(k)?.let { translation?.set(it.optInt("i"), it.optString("t")) }
            }
            "InkwellReadAloud.status" -> state()
            else -> error("Not available")
        }
    }

    /**
     * The book as the reader's page: a heading for each chapter and a paragraph for each of the
     * book's paragraphs, each marked with its paragraph (data-i), so reading aloud and the
     * highlight follow the app's own paragraphs.
     */
    private fun book(d: Doc): JSONObject {
        // The page's text goes into a file the page then loads (bookFile): a long book as one message
        // was more than the app's memory (a 61,000-paragraph book needed over 250 MB to send).
        val file = bookFile()
        val html = file.bufferedWriter()
        val starts = d.chapters.groupBy { it.start }
        var blocks = 0
        var at = 0
        val map = ArrayList<Int>()
        // Each paragraph's block on the page (for the highlights and notes made on the player screen).
        val blockOf = IntArray(d.paragraphs.size)
        // The chapters, for the reader's Contents (each heading's id on the page).
        val headings = JSONArray()
        for ((i, p) in d.paragraphs.withIndex()) {
            if (i == Speaker.index) at = blocks
            val heading = starts[i]?.lastOrNull()?.title
            val text = TextUtils.htmlEncode(p)
            if (heading != null && heading.trim().equals(p.trim(), ignoreCase = true)) {
                html.append("<h2 id=\"c").append(i.toString()).append("\" data-i=\"").append(i.toString()).append("\">").append(text).append("</h2>\n")
                headings.put(JSONObject().put("id", "c$i").put("text", heading.trim()).put("level", 2))
                blockOf[i] = blocks
                blocks++
                map += i
                continue
            }
            if (heading != null) {
                html.append("<h2 id=\"c").append(i.toString()).append("\" data-i=\"").append(i.toString()).append("\">").append(TextUtils.htmlEncode(heading)).append("</h2>\n")
                headings.put(JSONObject().put("id", "c$i").put("text", heading.trim()).put("level", 2))
                if (i == Speaker.index) at = blocks + 1
                blocks++
                map += i
            }
            html.append("<p data-i=\"").append(i.toString()).append("\">").append(text).append("</p>\n")
            blockOf[i] = blocks
            blocks++
            map += i
        }
        html.close()
        idx = map.toIntArray()
        val item = item()
        return JSONObject()
            .put("uid", d.key)
            .put("id", d.key)
            .put("title", item?.title ?: d.title)
            .put("author", item?.author ?: d.author ?: "")
            .put("htmlUrl", "https://$HOST/book.html?v=${System.currentTimeMillis()}")
            .put("headings", headings)
            .put("accent", String.format("#%06X", Themes.color(this, R.attr.p2aAccent) and 0xFFFFFF))
            .put("marks", JSONArray().apply {
                for (n in item?.let { Library.notes(it) }.orEmpty()) {
                    if (!n.isSpan) continue
                    val para = d.paragraphs.getOrNull(n.index) ?: continue
                    val words = para.substring(n.start.coerceAtMost(para.length), n.end.coerceAtMost(para.length))
                    if (words.isBlank()) continue
                    put(JSONObject().put("key", "${n.index}:${n.start}:${n.end}:${n.at}").put("a", blockOf[n.index]).put("t", words).put("note", n.text))
                }
            })
            .put("at", at)
            .put("rate", Speaker.speed.toDouble())
            .apply { if (item?.kind == Loader.Kind.PDF) put("pdf", JSONObject()) }
    }

    /** The book as the page shows it (see [book]). */
    private fun bookFile() = File(File(cacheDir, "reader").apply { mkdirs() }, "book.html")

    private fun keepFile(a: JSONObject): File {
        val name = a.optString("name").replace(Regex("[^A-Za-z0-9._-]"), "_").take(80).ifBlank { error("No name") }
        return File(File(filesDir, "reader").apply { mkdirs() }, name)
    }

    private fun voiceName(): String =
        if (BuildConfig.LITE) LiteUi.voiceName() else VoicePicker.label(Speaker.voiceId).substringBefore(" · ")

    private fun pickVoice() {
        if (BuildConfig.LITE) return LiteUi.showVoices(this) {
            render()
            emit("P2AReader", "voice", JSONObject().put("name", voiceName()))
        }
        VoicePicker.pickOne(this, "Reading voice", Speaker.voiceId) { id ->
            if (id == Speaker.voiceId) return@pickOne
            Speaker.setVoice(id)
            render()
            emit("P2AReader", "voice", JSONObject().put("name", voiceName()))
            LocalTts.missing(id)?.let { Toast.makeText(this, "Download the ${it.title} first (in the player: Voice)", Toast.LENGTH_LONG).show() }
        }
    }

    // ---- Read aloud ------------------------------------------------------------------------

    /** The book's paragraph for reader paragraph [para] (or the next one that has one). */
    private fun docIndex(m: IntArray, para: Int): Int? = (para.coerceAtLeast(0) until m.size).firstNotNullOfOrNull { k -> m[k].takeIf { it >= 0 } }

    /** The reader paragraph the voice is on: the last one at or before the book's paragraph being read. */
    private fun readerPara(m: IntArray, index: Int): Int {
        var best = 0
        for (k in m.indices) if (m[k] in 0..index) best = k
        return best
    }

    private fun startAloud(d: Doc, a: JSONObject) {
        translation?.stop()
        translation = null
        aloud = true
        val map = a.optJSONArray("idx")
        if (map != null) {
            // The page as shown: the app's own voice, on the app's paragraphs.
            val m = IntArray(map.length()) { map.optInt(it, -1) }
            idx = m
            val target = docIndex(m, a.optInt("from")) ?: return
            if (Speaker.doc !== d) Speaker.load(d)
            Speaker.seek(target)
            Speaker.play()
        } else {
            // A translation: read from the given text, in a natural voice for its language.
            Speaker.pause()
            val paras = a.optJSONArray("paras") ?: JSONArray()
            val voice = a.optJSONObject("voice")?.optString("edgeVoice").orEmpty().ifBlank { "en-US-AvaMultilingualNeural" }
            translation = Translation(MutableList(paras.length()) { paras.optString(it) }, voice, a.optInt("from")).also { it.start() }
        }
        sendState()
    }

    private fun state(): JSONObject {
        translation?.let { return it.state() }
        val d = doc
        val m = idx
        val active = aloud || Speaker.playing
        val para = if (m != null) readerPara(m, Speaker.index) else Speaker.index
        return JSONObject()
            .put("active", active && Speaker.doc === d)
            .put("uid", d?.key ?: "")
            .put("para", para)
            .put("playing", Speaker.playing)
            .put("finished", !Speaker.playing && d != null && Speaker.index >= d.paragraphs.size - 1 && aloud)
            .apply { Speaker.lastError?.let { put("error", it) } }
    }

    private fun sendState() {
        if (!aloud && !Speaker.playing && translation == null) return
        emit("InkwellReadAloud", "state", state())
    }

    /** A translated book read aloud: each paragraph spoken by a Microsoft voice for its language. */
    private var translation: Translation? = null

    private inner class Translation(val paras: MutableList<String>, val voice: String, var at: Int) {
        private var job: Job? = null
        private var player: MediaPlayer? = null
        var playing = false
        var finished = false

        fun set(i: Int, t: String) {
            if (i in paras.indices) paras[i] = t
        }

        fun start() {
            job?.cancel()
            player?.release()
            player = null
            playing = true
            finished = false
            job = scope.launch {
                while (at < paras.size) {
                    val text = paras[at]
                    sendState()
                    if (text.isNotBlank()) {
                        val file = File(cacheDir, "reader-voice.mp3")
                        val ok = runCatching {
                            val audio = withContext(Dispatchers.IO) { EdgeTts.synthesize(text, voice, Speaker.ratePercent()) }
                            withContext(Dispatchers.IO) { file.writeBytes(audio) }
                        }.isSuccess
                        if (ok) suspendCancellableCoroutine { c ->
                            val mp = MediaPlayer()
                            player = mp
                            runCatching {
                                mp.setDataSource(file.path)
                                mp.setOnCompletionListener { if (c.isActive) c.resume(Unit) }
                                mp.setOnErrorListener { _, _, _ -> if (c.isActive) c.resume(Unit); true }
                                mp.prepare()
                                mp.start()
                            }.onFailure { if (c.isActive) c.resume(Unit) }
                            c.invokeOnCancellation { runCatching { mp.release() } }
                        }
                        player?.release()
                        player = null
                    }
                    at++
                }
                playing = false
                finished = true
                sendState()
            }
        }

        fun pause() {
            playing = false
            player?.pause() ?: job?.cancel()
            sendState()
        }

        fun resume() {
            val p = player
            if (p != null && job?.isActive == true) {
                p.start()
                playing = true
                sendState()
            } else start()
        }

        fun seek(i: Int) {
            at = i.coerceIn(0, paras.size)
            start()
        }

        fun stop() {
            job?.cancel()
            player?.release()
            player = null
            playing = false
        }

        fun state(): JSONObject = JSONObject()
            .put("active", true).put("uid", doc?.key ?: "").put("para", at.coerceAtMost(paras.size - 1).coerceAtLeast(0))
            .put("playing", playing).put("finished", finished)
    }

    // ---- Narrato: the player screen's options, here ------------------------------------------

    private fun showMore() {
        val item = Library.get(this, Library.currentId)
        val d = Speaker.doc
        LiteSheet(this, d?.title, null)
            .row(R.drawable.ic_voice, "Pronunciations", "Fix how words are said (or select a word, then Pronounce)") { Pronounce.show(this) }
            .apply {
                // A PDF: its pages as printed (the reader shows the text reflowed).
                if (item?.kind == Loader.Kind.PDF && d != null) row(R.drawable.ic_doc, "Original pages", "The PDF as printed, near where you are") {
                    PdfPages.show(this@ReaderActivity, Library.source(this@ReaderActivity, item).file, Speaker.index.toFloat() / d.paragraphs.size.coerceAtLeast(1))
                }
            }
            .row(R.drawable.ic_text, "Save the text", "As plain text, Markdown or PDF") { exportTranscript() }
            .row(R.drawable.ic_bug, "Report a problem", "Share the app's error log to get it fixed") { AppLog.showReport(this) }
            .show()
    }

    private fun exportTranscript() {
        val d = Speaker.doc ?: return
        val sheet = LiteSheet(this, "Save the text", "Saved in Downloads/${Brand.folder(this)}")
        for (format in Transcript.Format.values()) sheet.row(R.drawable.ic_doc, format.label, null) {
            scope.launch {
                try {
                    val uri = withContext(Dispatchers.IO) { Transcript.save(this@ReaderActivity, d, format, emptySet()) }
                    AlertDialog.Builder(this@ReaderActivity)
                        .setTitle("Saved")
                        .setMessage("In Downloads/${Brand.folder(this@ReaderActivity)}.")
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
                    Toast.makeText(this@ReaderActivity, "Couldn't save: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }
        sheet.show()
    }

    /** Audiobook conversion or voice download in progress (or just finished), as on the player screen. */
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
                exportWasRunning = false
                if (BuildConfig.LITE && Exporter.resultUri != null) Ads.interstitial(this, "audiobook")
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

    private var lighterAsked = false
    private var lighterCheckedAt = 0L

    /**
     * A real reader's voice on a phone too slow for it (reading keeps pausing), or on a low battery: offer a
     * Supertonic voice, as the player screen does. Once per screen, and the low-battery one once a day.
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

    companion object {
        private const val HOST = "appassets.androidplatform.net"

        private fun mime(path: String) = when (path.substringAfterLast('.').lowercase()) {
            "html" -> "text/html"
            "js", "mjs" -> "text/javascript"
            "css" -> "text/css"
            "woff2" -> "font/woff2"
            "woff" -> "font/woff"
            "svg" -> "image/svg+xml"
            "png" -> "image/png"
            "json" -> "application/json"
            else -> "application/octet-stream"
        }
    }
}
