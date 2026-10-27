package com.paper2audio.app

import android.annotation.SuppressLint
import android.app.Activity
import android.media.MediaPlayer
import android.os.Bundle
import android.text.TextUtils
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
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
 * Audiohub's Android plugins are answered here: Read aloud is this app's player and voice,
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
    private val follow: () -> Unit = { runOnUiThread { sendState() } }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        Themes.apply(this)
        super.onCreate(savedInstanceState)
        doc = Speaker.doc
        if (doc == null) return finish()
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
                    return runCatching {
                        WebResourceResponse(mime(path), if (mime(path).startsWith("text") || path.endsWith(".js")) "utf-8" else null, assets.open(path))
                    }.getOrNull()
                }

                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = request.url.host != HOST
            }
        }
        val root = FrameLayout(this).apply {
            setBackgroundColor(0xFF131218.toInt())
            addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            // Clear of the status bar and the navigation bar.
            setOnApplyWindowInsetsListener { v, insets ->
                @Suppress("DEPRECATION")
                v.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
                insets
            }
        }
        setContentView(root)
        Speaker.addListener(follow)
        web.loadUrl("https://$HOST/reader/index.html")
    }

    override fun onDestroy() {
        Speaker.removeListener(follow)
        translation?.stop()
        scope.cancel()
        if (::web.isInitialized) web.destroy()
        super.onDestroy()
    }

    @Deprecated("Back closes what the reader has open first")
    override fun onBackPressed() {
        web.evaluateJavascript("window.__p2aBack ? (window.__p2aBack(), 1) : 0") { if (it != "1") finish() }
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
        if (!isDestroyed) web.evaluateJavascript("window.__p2aEvent('$plugin', '$event', ${JSONObject.quote(data.toString())})", null)
    }

    private fun item() = Library.get(this, Library.currentId)

    private suspend fun handle(plugin: String, method: String, a: JSONObject): JSONObject {
        val d = doc ?: error("No book open")
        val ok = JSONObject()
        return when ("$plugin.$method") {
            "P2AReader.book" -> withContext(Dispatchers.Default) { book(d) }
            "P2AReader.close" -> ok.also { finish() }
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
        val html = StringBuilder(d.paragraphs.sumOf { it.length } + d.paragraphs.size * 24)
        val starts = d.chapters.groupBy { it.start }
        var blocks = 0
        var at = 0
        val map = ArrayList<Int>()
        for ((i, p) in d.paragraphs.withIndex()) {
            if (i == Speaker.index) at = blocks
            val heading = starts[i]?.lastOrNull()?.title
            val text = TextUtils.htmlEncode(p)
            if (heading != null && heading.trim().equals(p.trim(), ignoreCase = true)) {
                html.append("<h2 data-i=\"").append(i).append("\">").append(text).append("</h2>\n")
                blocks++
                map += i
                continue
            }
            if (heading != null) {
                html.append("<h2 data-i=\"").append(i).append("\">").append(TextUtils.htmlEncode(heading)).append("</h2>\n")
                if (i == Speaker.index) at = blocks + 1
                blocks++
                map += i
            }
            html.append("<p data-i=\"").append(i).append("\">").append(text).append("</p>\n")
            blocks++
            map += i
        }
        idx = map.toIntArray()
        val item = item()
        return JSONObject()
            .put("uid", d.key)
            .put("id", d.key)
            .put("title", item?.title ?: d.title)
            .put("author", item?.author ?: d.author ?: "")
            .put("html", html.toString())
            .put("at", at)
            .put("rate", Speaker.speed.toDouble())
            .apply { if (item?.kind == Loader.Kind.PDF) put("pdf", JSONObject()) }
    }

    private fun keepFile(a: JSONObject): File {
        val name = a.optString("name").replace(Regex("[^A-Za-z0-9._-]"), "_").take(80).ifBlank { error("No name") }
        return File(File(filesDir, "reader").apply { mkdirs() }, name)
    }

    private fun voiceName(): String =
        if (BuildConfig.LITE) LiteUi.voiceName() else VoicePicker.label(Speaker.voiceId).substringBefore(" · ")

    private fun pickVoice() {
        if (BuildConfig.LITE) return LiteUi.showVoices(this) { emit("P2AReader", "voice", JSONObject().put("name", voiceName())) }
        VoicePicker.pickOne(this, "Reading voice", Speaker.voiceId) { id ->
            if (id == Speaker.voiceId) return@pickOne
            Speaker.setVoice(id)
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
