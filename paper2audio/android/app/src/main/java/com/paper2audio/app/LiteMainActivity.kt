package com.paper2audio.app

import android.app.Activity
import android.app.AlertDialog
import android.content.ClipData
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Outline
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
import android.text.InputType
import android.util.LruCache
import android.view.View
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.widget.BaseAdapter
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.ListView
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/**
 * The Play Store edition's first screen: the library, and a + button to add a book,
 * a document, a web page, pasted text or photos of pages.
 */
class LiteMainActivity : Activity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val thumbs = LruCache<String, Bitmap>(40)
    private var items: List<Library.Item> = emptyList()
    private lateinit var list: ListView
    private lateinit var busy: TextView
    private var working = false
    private var photo: File? = null
    private val refresh: () -> Unit = { adapter.notifyDataSetChanged() }

    override fun onCreate(savedInstanceState: Bundle?) {
        Themes.apply(this)
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_lite_main)
        LiteUi.fitSystemBars(this, findViewById(R.id.liteRoot))
        list = findViewById(R.id.list)
        busy = findViewById(R.id.busy)
        list.adapter = adapter
        list.emptyView = findViewById(R.id.empty)
        list.setOnItemClickListener { _, _, position, _ -> open(items[position]) }
        list.setOnItemLongClickListener { _, _, position, _ ->
            itemMenu(items[position])
            true
        }
        findViewById<View>(R.id.btnAdd).setOnClickListener { showAddMenu() }
        findViewById<View>(R.id.btnMenu).setOnClickListener { showMenu() }
        savedInstanceState?.getString("photo")?.let { photo = File(it) }

        Speaker.init(this) {}
        Library.loadCurrentId(this)
        Ads.init(this) { Ads.banner(this, findViewById<FrameLayout>(R.id.adBanner)) }
        AppLog.offerCrashReport(this)
        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        photo?.let { outState.putString("photo", it.path) }
    }

    override fun onStart() {
        super.onStart()
        Speaker.addListener(refresh)
        reload()
    }

    override fun onStop() {
        Speaker.removeListener(refresh)
        super.onStop()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private fun reload() {
        scope.launch {
            items = withContext(Dispatchers.IO) { Library.items(this@LiteMainActivity) }.sortedByDescending { it.opened }
            adapter.notifyDataSetChanged()
        }
    }

    private fun setBusy(text: String?) {
        working = text != null
        busy.text = text
        busy.visibility = if (text == null) View.GONE else View.VISIBLE
    }

    private fun toast(msg: String) {
        AppLog.i("Library", msg)
        Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
    }

    // ---- Opening ----

    private fun open(item: Library.Item) {
        if (working) return
        if (Speaker.doc?.key == item.id) {
            Ads.interstitial(this, "open") { openPlayer() }
            return
        }
        setBusy("Opening ${item.title}…")
        scope.launch {
            try {
                val doc = withContext(Dispatchers.Default) { Opener.parse(this@LiteMainActivity, item) }
                withContext(Dispatchers.IO) { Library.opened(this@LiteMainActivity, item, doc) }
                Speaker.load(doc)
                Ads.interstitial(this@LiteMainActivity, "open") { openPlayer() }
            } catch (e: Exception) {
                AppLog.e("Open", "Couldn't open ${item.kind}", e)
                toast(e.message ?: "Could not read that file")
            } finally {
                setBusy(null)
                reload()
            }
        }
    }

    private fun openPlayer() {
        startActivity(Intent(this, LitePlayerActivity::class.java))
    }

    private fun itemMenu(item: Library.Item) {
        LiteSheet(this, item.title, item.author)
            .row(R.drawable.ic_headphones, "Listen", "Continue where you left off") { open(item) }
            .row(R.drawable.ic_delete, "Delete", "Remove it from your library") {
                AlertDialog.Builder(this)
                    .setMessage("Delete “${item.title}” from the library?")
                    .setPositiveButton("Delete") { _, _ ->
                        if (Speaker.doc?.key == item.id) Speaker.pause()
                        scope.launch {
                            withContext(Dispatchers.IO) { Library.remove(this@LiteMainActivity, item) }
                            thumbs.remove(item.id)
                            reload()
                        }
                    }
                    .setNegativeButton("Cancel", null)
                    .show()
            }
            .show()
    }

    // ---- Adding ----

    private fun showAddMenu() {
        if (working) return
        LiteSheet(this, "Add something to listen to")
            .row(R.drawable.ic_doc, "Book or document", "PDF, EPUB, Word, PowerPoint or text file") { pickFile() }
            .row(R.drawable.ic_paste, "Paste text", "From the clipboard, or type it") { askText() }
            .row(R.drawable.ic_link, "Web page", "An article or blog post, by its link") { askLink() }
            .section("From pictures")
            .row(R.drawable.ic_camera, "Photo of a page", "Take a picture; the text is read from it") { takePhoto() }
            .row(R.drawable.ic_image, "Photos or screenshots", "Choose images that have text") { pickImages() }
            .show()
    }

    private fun pickFile() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("*/*")
            .putExtra(
                Intent.EXTRA_MIME_TYPES,
                arrayOf(
                    "application/pdf", "application/epub+zip", "text/plain", "text/markdown", "text/html",
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                    "application/octet-stream",
                ),
            )
        @Suppress("DEPRECATION")
        startActivityForResult(intent, REQ_FILE)
    }

    private fun pickImages() {
        val intent = Intent(Intent.ACTION_GET_CONTENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("image/*")
            .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        @Suppress("DEPRECATION")
        startActivityForResult(Intent.createChooser(intent, "Choose images"), REQ_IMAGES)
    }

    private fun takePhoto() {
        val dir = File(cacheDir, "scan").apply { mkdirs() }
        val file = File(dir, "page-${System.currentTimeMillis()}.jpg")
        val uri = androidx.core.content.FileProvider.getUriForFile(this, "$packageName.files", file)
        val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
            .putExtra(MediaStore.EXTRA_OUTPUT, uri)
            .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        intent.clipData = ClipData.newRawUri("page", uri)
        photo = file
        try {
            @Suppress("DEPRECATION")
            startActivityForResult(intent, REQ_PHOTO)
        } catch (e: Exception) {
            toast("No camera app found")
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        if (resultCode != RESULT_OK) return
        when (requestCode) {
            REQ_FILE -> data?.data?.let(::importUri)
            REQ_IMAGES -> {
                val uris = data?.clipData?.let { c -> (0 until c.itemCount).map { c.getItemAt(it).uri } }
                    ?: listOfNotNull(data?.data)
                if (uris.isNotEmpty()) importImages(uris)
            }
            REQ_PHOTO -> photo?.takeIf { it.exists() && it.length() > 0 }?.let { importImages(listOf(Uri.fromFile(it)), delete = it) }
        }
    }

    private fun handleIntent(intent: Intent?) {
        intent ?: return
        when (intent.action) {
            Intent.ACTION_VIEW -> intent.data?.let(::importUri)
            Intent.ACTION_SEND -> {
                @Suppress("DEPRECATION")
                val stream = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
                val text = intent.getStringExtra(Intent.EXTRA_TEXT)
                when {
                    stream != null && intent.type?.startsWith("image/") == true -> importImages(listOf(stream))
                    stream != null -> importUri(stream)
                    !text.isNullOrBlank() && Regex("""^\s*https?://\S+\s*$""").matches(text) -> importLink(text.trim())
                    !text.isNullOrBlank() -> importText(text)
                }
            }
        }
        intent.action = null // don't import again on rotation
    }

    private fun import(label: String, fetch: (progress: (String) -> Unit) -> Loader.Source) {
        if (working) return
        setBusy(label)
        val progress: (String) -> Unit = { text -> runOnUiThread { setBusy(text) } }
        scope.launch {
            try {
                val (item, doc) = withContext(Dispatchers.IO) {
                    Opener.import(this@LiteMainActivity, { fetch(progress) }, progress)
                }
                thumbs.remove(item.id)
                withContext(Dispatchers.IO) { Library.opened(this@LiteMainActivity, item, doc) }
                Speaker.load(doc)
                reload()
                openPlayer()
            } catch (e: Exception) {
                AppLog.e("Import", label, e)
                toast(e.message ?: "Could not open that")
            } finally {
                setBusy(null)
            }
        }
    }

    private fun importUri(uri: Uri) = import("Adding…") { Loader.importUri(this, uri) }

    private fun importText(text: String) = import("Adding…") { Loader.storeText(this, titleFrom(text, "Pasted text"), text) }

    private fun importLink(url: String) {
        if (Regex("""(youtube\.com|youtu\.be)/""", RegexOption.IGNORE_CASE).containsMatchIn(url)) {
            toast("Videos can't be added. Add a web page, book or document instead.")
            return
        }
        import("Getting the page…") { progress -> Loader.download(this, url, progress) }
    }

    private fun importImages(uris: List<Uri>, delete: File? = null) = import("Reading the text in the image…") { progress ->
        try {
            val text = Ocr.images(this, uris, progress)
            if (text.isBlank()) error("No text found in ${if (uris.size == 1) "that image" else "those images"}.")
            Loader.storeText(this, titleFrom(text, "Scanned page"), text)
        } finally {
            delete?.delete()
        }
    }

    private fun askText() {
        val input = EditText(this).apply {
            hint = "Paste or type the text to listen to"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            minLines = 4
            maxLines = 10
        }
        val box = FrameLayout(this).apply {
            setPadding(LiteUi.dp(this@LiteMainActivity, 20), LiteUi.dp(this@LiteMainActivity, 8), LiteUi.dp(this@LiteMainActivity, 20), 0)
            addView(input)
        }
        // Offer what's on the clipboard.
        (getSystemService(CLIPBOARD_SERVICE) as android.content.ClipboardManager).primaryClip
            ?.getItemAt(0)?.coerceToText(this)?.toString()?.takeIf { it.length > 20 }?.let { input.setText(it) }
        AlertDialog.Builder(this)
            .setTitle("Paste text")
            .setView(box)
            .setPositiveButton("Listen") { _, _ ->
                val text = input.text.toString()
                if (text.isNotBlank()) importText(text)
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun askLink() {
        val input = EditText(this).apply {
            hint = "https://…"
            inputType = InputType.TYPE_TEXT_VARIATION_URI or InputType.TYPE_CLASS_TEXT
            isSingleLine = true
        }
        val box = FrameLayout(this).apply {
            setPadding(LiteUi.dp(this@LiteMainActivity, 20), LiteUi.dp(this@LiteMainActivity, 8), LiteUi.dp(this@LiteMainActivity, 20), 0)
            addView(input)
        }
        (getSystemService(CLIPBOARD_SERVICE) as android.content.ClipboardManager).primaryClip
            ?.getItemAt(0)?.coerceToText(this)?.toString()?.trim()?.takeIf { it.startsWith("http") }?.let { input.setText(it) }
        AlertDialog.Builder(this)
            .setTitle("Web page link")
            .setView(box)
            .setPositiveButton("Add") { _, _ ->
                val url = input.text.toString().trim().let { if (it.startsWith("http")) it else "https://$it" }
                if (url.length > 10) importLink(url)
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    /** A short title from the first line of [text]. */
    private fun titleFrom(text: String, fallback: String): String {
        val line = text.lineSequence().map { it.trim() }.firstOrNull { it.count(Char::isLetter) >= 3 } ?: return fallback
        return if (line.length <= 60) line else line.take(57).substringBeforeLast(' ') + "…"
    }

    // ---- Menu ----

    private fun showMenu() {
        LiteSheet(this, getString(R.string.app_name), "Version ${Updater.currentName(this)} · free and unlimited")
            .row(R.drawable.ic_palette, "Theme", "Colors of the app") { Themes.showPicker(this) }
            .row(R.drawable.ic_bug, "Report a problem", "Share the app's error log to get it fixed") { AppLog.showReport(this) }
            .section("Privacy")
            .row(R.drawable.ic_shield, "Privacy policy", "What the app stores and shares") {
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(PRIVACY_URL))) }
            }
            .row(R.drawable.ic_info, "Ad privacy choices", "Change how ads use your data") {
                if (!Ads.privacyOptions(this)) toast("No ad choices are needed in your region.")
            }
            .row(R.drawable.ic_text, "About and credits", "The voices and libraries in this app") {
                AlertDialog.Builder(this)
                    .setTitle("${getString(R.string.app_name)} ${Updater.currentName(this)}")
                    .setMessage(
                        "Listen to books, documents and web pages, as much as you like. Free, with ads.\n\n" +
                            "Voices run on your phone: Supertonic (Supertone), Kokoro (Apache 2.0), through sherpa-onnx (Apache 2.0). " +
                            "PDF reading: PdfBox-Android (Apache 2.0). Text recognition: Google ML Kit.",
                    )
                    .setPositiveButton("OK", null)
                    .show()
            }
            .show()
    }

    // ---- List ----

    private fun bindThumb(view: ImageView, id: String) {
        view.tag = id
        thumbs.get(id)?.let {
            view.setImageBitmap(it)
            return
        }
        view.setImageDrawable(null)
        scope.launch {
            val bmp = Thumbs.load(Library.thumb(this@LiteMainActivity, id), LiteUi.dp(this@LiteMainActivity, 64)) ?: return@launch
            thumbs.put(id, bmp)
            if (view.tag == id) view.setImageBitmap(bmp)
        }
    }

    private class Holder(root: View) {
        val thumb: ImageView = root.findViewById(R.id.thumb)
        val title: TextView = root.findViewById(R.id.title)
        val author: TextView = root.findViewById(R.id.author)
        val meta: TextView = root.findViewById(R.id.meta)
        val progress: ProgressBar = root.findViewById(R.id.progress)
        val percent: TextView = root.findViewById(R.id.percent)
    }

    private val adapter = object : BaseAdapter() {
        override fun getCount() = items.size
        override fun getItem(position: Int) = items[position]
        override fun getItemId(position: Int) = position.toLong()

        override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
            val view = convertView ?: layoutInflater.inflate(R.layout.item_library, parent, false).also {
                it.tag = Holder(it)
                it.findViewById<View>(R.id.thumb).apply {
                    outlineProvider = object : ViewOutlineProvider() {
                        override fun getOutline(v: View, outline: Outline) =
                            outline.setRoundRect(0, 0, v.width, v.height, 8 * resources.displayMetrics.density)
                    }
                    clipToOutline = true
                }
            }
            val h = view.tag as Holder
            val item = items[position]
            h.title.text = item.title
            h.author.text = item.author ?: item.sourceName
            val minutes = (item.words / (160f * Speaker.speed)).toInt()
            h.meta.text = if (minutes >= 60) "${minutes / 60} h ${minutes % 60} min" else "$minutes min"
            val pct = Library.progress(this@LiteMainActivity, item)
            h.progress.progress = pct
            h.percent.text = when {
                pct >= 99 -> "Finished"
                pct == 0 -> "New"
                else -> "$pct%"
            }
            bindThumb(h.thumb, item.id)
            return view
        }
    }

    companion object {
        private const val REQ_FILE = 1
        private const val REQ_IMAGES = 2
        private const val REQ_PHOTO = 3
        const val PRIVACY_URL = "https://drdilips1.github.io/bytewatch-stremio-addon/privacy.html"
    }
}
