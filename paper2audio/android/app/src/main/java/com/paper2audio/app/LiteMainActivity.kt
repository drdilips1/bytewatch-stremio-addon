package com.paper2audio.app

import android.app.Activity
import android.app.AlertDialog
import android.content.ClipData
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
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
import android.widget.HorizontalScrollView
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
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
    private val refresh: () -> Unit = {
        adapter.notifyDataSetChanged()
        renderMini()
        renderHeader()
    }
    /** Above the library: the greeting, the book being listened to and the others to continue. */
    private lateinit var header: LinearLayout
    private var headerShown: String? = null
    private var miniCoverFor: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        Themes.apply(this)
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_lite_main)
        LiteUi.fitSystemBars(this, findViewById(R.id.liteRoot))
        list = findViewById(R.id.list)
        busy = findViewById(R.id.busy)
        header = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(8), 0, dp(8), 0)
        }
        list.addHeaderView(header, null, false)
        list.adapter = adapter
        list.emptyView = findViewById(R.id.empty)
        // Positions count the header too: the item is looked up through the list.
        list.setOnItemClickListener { parent, _, position, _ -> (parent.getItemAtPosition(position) as? Library.Item)?.let(::open) }
        list.setOnItemLongClickListener { parent, _, position, _ ->
            (parent.getItemAtPosition(position) as? Library.Item)?.let(::itemMenu)
            true
        }
        findViewById<TextView>(R.id.appTitle).apply {
            typeface = Themes.titleFont(this@LiteMainActivity)
            setTypeface(typeface, android.graphics.Typeface.NORMAL)
            text = android.text.SpannableString("narrato.").apply {
                setSpan(android.text.style.ForegroundColorSpan(Themes.color(this@LiteMainActivity, R.attr.p2aAccent)), length - 1, length, 0)
            }
        }
        findViewById<View>(R.id.btnAdd).setOnClickListener { showAddMenu() }
        findViewById<View>(R.id.btnAddTop).setOnClickListener { showAddMenu() }
        buildBottomNav()
        findViewById<View>(R.id.miniPlayer).setOnClickListener { openPlayer() }
        findViewById<View>(R.id.miniPlay).setOnClickListener { Speaker.toggle() }
        savedInstanceState?.getString("photo")?.let { photo = File(it) }

        Speaker.init(this) {}
        Library.loadCurrentId(this)
        // New users get a short walkthrough first; ads (and their consent form) come after it.
        LiteWelcome.showOnce(this) {
            // After the tour, once: the name the greeting uses (optional).
            if (!prefs().getBoolean("askedName", false)) {
                prefs().edit().putBoolean("askedName", true).apply()
                askName()
            }
            Ads.init(this) { Ads.banner(this, findViewById<FrameLayout>(R.id.adBanner)) }
        }
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
        Ads.resume(findViewById(R.id.adBanner))
        Speaker.addListener(refresh)
        renderMini()
        reload()
    }

    override fun onStop() {
        Speaker.removeListener(refresh)
        // The banner kept refreshing behind the player and while listening with the screen off.
        Ads.pause(findViewById(R.id.adBanner))
        super.onStop()
    }

    override fun onDestroy() {
        Ads.destroy(findViewById(R.id.adBanner))
        scope.cancel()
        super.onDestroy()
    }

    /** The strip at the bottom: the book being read, with play/pause; tap it for the player. */
    private fun renderMini() {
        val strip = findViewById<View>(R.id.miniPlayer)
        val doc = Speaker.doc
        // As in Paper to Audio: the Now listening card above already has the book and Resume.
        if (doc == null || items.any { it.id == doc.key }) {
            strip.visibility = View.GONE
            return
        }
        strip.visibility = View.VISIBLE
        findViewById<TextView>(R.id.miniTitle).text = doc.title
        val chapter = doc.chapterAt(Speaker.index)?.title
        val pct = if (doc.paragraphs.isEmpty()) 0 else Speaker.index * 100 / doc.paragraphs.size
        findViewById<TextView>(R.id.miniSub).text = listOfNotNull(if (Speaker.playing) "Playing" else "Paused", chapter, "$pct%").joinToString(" · ")
        findViewById<ImageButton>(R.id.miniPlay).apply {
            setImageResource(if (Speaker.playing) R.drawable.ic_pause else R.drawable.ic_play)
            contentDescription = if (Speaker.playing) "Pause" else "Play"
        }
        if (miniCoverFor != doc.key) {
            miniCoverFor = doc.key
            val cover = findViewById<ImageView>(R.id.miniCover)
            cover.setImageDrawable(null)
            scope.launch {
                val bmp = withContext(Dispatchers.IO) {
                    runCatching { Library.thumb(this@LiteMainActivity, doc.key).takeIf { it.exists() }?.let { BitmapFactory.decodeFile(it.path) } }.getOrNull()
                }
                if (miniCoverFor == doc.key) cover.setImageBitmap(bmp)
            }
        }
    }

    private fun reload() {
        scope.launch {
            items = withContext(Dispatchers.IO) { Library.items(this@LiteMainActivity) }.sortedByDescending { it.opened }
            adapter.notifyDataSetChanged()
            renderHeader()
            renderMini()
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
            // Text selected in another app ("Listen with Narrato").
            Intent.ACTION_PROCESS_TEXT -> intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)?.toString()
                ?.takeIf { it.isNotBlank() }?.let(::importText)
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
            .row(R.drawable.ic_info, "How Narrato works", "The short tour, and getting better voices") { LiteWelcome.show(this) }
            .row(R.drawable.ic_palette, "Theme", "Colors of the app") { Themes.showPicker(this) }
            .row(R.drawable.ic_account, "Your name", userName()?.let { "Greeted as $it" } ?: "For the greeting on the first screen") { askName() }
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

    private fun bindThumb(view: ImageView, id: String, widthDp: Int = 64) {
        val key = if (widthDp == 64) id else "$id@$widthDp"
        view.tag = key
        thumbs.get(key)?.let {
            view.setImageBitmap(it)
            return
        }
        view.setImageDrawable(null)
        scope.launch {
            val bmp = Thumbs.load(Library.thumb(this@LiteMainActivity, id), LiteUi.dp(this@LiteMainActivity, widthDp)) ?: return@launch
            thumbs.put(key, bmp)
            if (view.tag == key) view.setImageBitmap(bmp)
        }
    }

    // ---- Home: greeting, Now listening, Continue ----

    private fun prefs() = getSharedPreferences("p2a", MODE_PRIVATE)

    private fun dp(v: Int) = LiteUi.dp(this, v)

    private fun color(attr: Int) = Themes.color(this, attr)

    private fun userName(): String? = prefs().getString("userName", null)?.takeIf { it.isNotBlank() }

    private fun askName() {
        val input = EditText(this).apply {
            hint = "Your first name"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS or InputType.TYPE_TEXT_VARIATION_PERSON_NAME
            isSingleLine = true
            setText(userName() ?: "")
        }
        val box = FrameLayout(this).apply {
            setPadding(dp(20), dp(8), dp(20), 0)
            addView(input)
        }
        AlertDialog.Builder(this)
            .setTitle("What should we call you?")
            .setMessage("So Narrato can greet you. It stays on this phone only.")
            .setView(box)
            .setPositiveButton("Save") { _, _ ->
                prefs().edit().putString("userName", input.text.toString().trim().take(30)).apply()
                headerShown = null
                renderHeader()
            }
            .setNegativeButton("Skip", null)
            .show()
    }

    private fun greeting(): String {
        val h = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY)
        return when (h) {
            in 5..11 -> "Good morning"
            in 12..16 -> "Good afternoon"
            else -> "Good evening"
        }
    }

    private fun text(value: CharSequence, sp: Float, muted: Boolean = false, serif: Boolean = false, bold: Boolean = false) = TextView(this).apply {
        text = value
        setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, sp)
        setTextColor(color(if (muted) R.attr.p2aMuted else R.attr.p2aText))
        if (serif) typeface = Themes.titleFont(this@LiteMainActivity)
        if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
    }

    private fun cover(id: String, wDp: Int, hDp: Int) = ImageView(this).apply {
        scaleType = ImageView.ScaleType.CENTER_CROP
        setBackgroundResource(R.drawable.bg_thumb)
        outlineProvider = object : ViewOutlineProvider() {
            override fun getOutline(v: View, outline: Outline) = outline.setRoundRect(0, 0, v.width, v.height, 10 * resources.displayMetrics.density)
        }
        clipToOutline = true
        layoutParams = LinearLayout.LayoutParams(dp(wDp), dp(hDp))
        bindThumb(this, id, wDp)
    }

    /** A large cover with rounded corners, a shadow and the listening progress along its foot (as in Paper to Audio). */
    private fun bigCover(item: Library.Item): View {
        val box = FrameLayout(this).apply {
            elevation = dp(8).toFloat()
            outlineProvider = object : ViewOutlineProvider() {
                override fun getOutline(v: View, o: Outline) = o.setRoundRect(0, 0, v.width, v.height, dp(12).toFloat())
            }
            clipToOutline = true
        }
        box.addView(ImageView(this).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            setBackgroundResource(R.drawable.bg_thumb)
            bindThumb(this, item.id, 150)
        }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        val pct = Library.progress(this, item)
        if (pct > 0) box.addView(ProgressBar(this, null, 0, R.style.P2A_Progress).apply {
            max = 100
            progress = pct
        }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(4), android.view.Gravity.BOTTOM))
        box.layoutParams = LinearLayout.LayoutParams(dp(150), dp(225))
        return box
    }

    /** Rebuilt only when something it shows changed (the player reports often). */
    private fun renderHeader() {
        if (!::header.isInitialized) return
        val current = Speaker.doc?.let { d -> items.firstOrNull { it.id == d.key } } ?: items.firstOrNull()
        val listening = current != null && Speaker.doc?.key == current.id
        val pct = current?.let { Library.progress(this, it) }
        val chapter = if (listening) Speaker.doc?.chapterAt(Speaker.index)?.title else null
        val shown = listOf(userName(), greeting(), current?.id, listening, Speaker.playing, pct, chapter, items.joinToString(",") { it.id }).joinToString("|")
        if (shown == headerShown) return
        headerShown = shown
        header.removeAllViews()
        if (items.isEmpty()) return

        val name = userName()
        header.addView(text(if (name != null) "${greeting()}, $name" else greeting(), 25f, serif = true).apply {
            setPadding(dp(8), dp(14), dp(8), 0)
            setOnClickListener { askName() }
        })
        header.addView(text("A little time for listening.", 14f, muted = true).apply { setPadding(dp(8), dp(2), dp(8), 0) })

        if (current != null) header.addView(heroCard(current, listening, pct ?: 0, chapter))

        val others = items.filter { it.id != current?.id }.take(10)
        if (others.isNotEmpty()) {
            val head = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.CENTER_VERTICAL
                setPadding(dp(8), dp(22), dp(8), dp(10))
            }
            head.addView(text("Continue", 22f, serif = true), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            head.addView(text("See all", 15f).apply {
                setTextColor(color(R.attr.p2aAccent))
                setPadding(dp(12), dp(8), dp(4), dp(8))
                setOnClickListener { list.setSelection(list.headerViewsCount) }
            })
            header.addView(head)
            val strip = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(dp(8), 0, dp(8), 0)
            }
            for (item in others) {
                val cell = LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL
                    isClickable = true
                    setOnClickListener { open(item) }
                    setOnLongClickListener { itemMenu(item); true }
                }
                cell.addView(bigCover(item))
                cell.addView(text(item.title, 14.5f, bold = true).apply {
                    maxLines = 2
                    ellipsize = android.text.TextUtils.TruncateAt.END
                    setPadding(0, dp(10), 0, 0)
                }, LinearLayout.LayoutParams(dp(150), ViewGroup.LayoutParams.WRAP_CONTENT))
                (item.author ?: item.sourceName).takeIf { it.isNotBlank() }?.let {
                    cell.addView(text(it, 12.5f, muted = true).apply {
                        maxLines = 1
                        ellipsize = android.text.TextUtils.TruncateAt.END
                    }, LinearLayout.LayoutParams(dp(150), ViewGroup.LayoutParams.WRAP_CONTENT))
                }
                strip.addView(cell, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginEnd = dp(16) })
            }
            header.addView(HorizontalScrollView(this).apply {
                isHorizontalScrollBarEnabled = false
                clipToPadding = false
                setPadding(0, dp(4), 0, dp(8))
                addView(strip)
            })
        }
        header.addView(text("Your library", 22f, serif = true).apply { setPadding(dp(8), dp(18), dp(8), dp(4)) })
    }

    /** The book being listened to, on a light card with a wash of the theme's colour (as in Paper to Audio). */
    private fun heroCard(item: Library.Item, listening: Boolean, pct: Int, chapter: String?): View {
        val accent = color(R.attr.p2aAccent)
        val surface = color(R.attr.p2aSurface)
        val wash = android.graphics.Color.rgb(
            (android.graphics.Color.red(accent) * 0.12f + android.graphics.Color.red(surface) * 0.88f).toInt(),
            (android.graphics.Color.green(accent) * 0.12f + android.graphics.Color.green(surface) * 0.88f).toInt(),
            (android.graphics.Color.blue(accent) * 0.12f + android.graphics.Color.blue(surface) * 0.88f).toInt(),
        )
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(16))
            background = android.graphics.drawable.GradientDrawable(android.graphics.drawable.GradientDrawable.Orientation.TL_BR, intArrayOf(wash, surface)).apply {
                cornerRadius = dp(24).toFloat()
                setStroke(dp(1), color(R.attr.p2aSurface2))
            }
            elevation = dp(2).toFloat()
        }
        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.BOTTOM
            isClickable = true
            setOnClickListener { open(item) }
        }
        top.addView(cover(item.id, 116, 172))
        val texts = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), 0, 0, dp(2))
        }
        texts.addView(text(if (listening) "NOW LISTENING" else "CONTINUE", 11.5f, bold = true).apply {
            letterSpacing = 0.1f
            setTextColor(accent)
        })
        texts.addView(text(item.title, 22f, serif = true).apply {
            maxLines = 3
            ellipsize = android.text.TextUtils.TruncateAt.END
            setPadding(0, dp(4), 0, dp(2))
        })
        listOfNotNull(item.author, chapter).joinToString(" · ").takeIf { it.isNotBlank() }?.let {
            texts.addView(text(it, 13.5f, muted = true).apply { maxLines = 2 })
        }
        top.addView(texts, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        card.addView(top)

        card.addView(ProgressBar(this, null, 0, R.style.P2A_Progress).apply {
            max = 100
            progress = pct
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(4)).apply { topMargin = dp(16) })
        val left = Library.minutesLeft(this, item, Speaker.speed)
        val meta = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        meta.addView(text("$pct%", 12f, muted = true), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        meta.addView(text("${if (left >= 60) "${left / 60} h ${left % 60} min" else "$left min"} left", 12f, muted = true))
        card.addView(meta, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(6) })

        val buttons = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
        }
        val playing = listening && Speaker.playing
        buttons.addView(android.widget.Button(this, null, 0, R.style.P2A_Button).apply {
            text = if (playing) "Pause" else "Resume"
            setCompoundDrawablesRelativeWithIntrinsicBounds(if (playing) R.drawable.ic_pause else R.drawable.ic_play, 0, 0, 0)
            setOnClickListener { if (listening) Speaker.toggle() else open(item) }
        }, LinearLayout.LayoutParams(0, dp(52), 1f))
        buttons.addView(ImageButton(this).apply {
            setImageResource(R.drawable.ic_headphones)
            contentDescription = "Open the player"
            imageTintList = android.content.res.ColorStateList.valueOf(color(R.attr.p2aText))
            background = android.graphics.drawable.GradientDrawable().apply {
                shape = android.graphics.drawable.GradientDrawable.OVAL
                setColor(surface)
                setStroke(dp(1), color(R.attr.p2aSurface2))
            }
            setOnClickListener { open(item) }
        }, LinearLayout.LayoutParams(dp(52), dp(52)).apply { marginStart = dp(10) })
        card.addView(buttons, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(14) })

        return FrameLayout(this).apply {
            setPadding(dp(4), dp(16), dp(4), dp(4))
            addView(card)
        }
    }

    // ---- The bar at the bottom ----

    private fun buildBottomNav() {
        val bar = findViewById<LinearLayout>(R.id.bottomNav)
        // As Paper to Audio's tabs: the icon in a soft chip when selected, the label under it.
        fun item(icon: Int, label: String, selected: Boolean, action: () -> Unit) {
            val tint = color(if (selected) R.attr.p2aAccent else R.attr.p2aMuted)
            val cell = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = android.view.Gravity.CENTER
                isClickable = true
                contentDescription = label
                setPadding(0, dp(4), 0, dp(2))
                setOnClickListener { action() }
            }
            cell.addView(ImageView(this).apply {
                setImageResource(icon)
                imageTintList = android.content.res.ColorStateList.valueOf(tint)
                setPadding(dp(16), dp(4), dp(16), dp(4))
                if (selected) setBackgroundResource(R.drawable.bg_chip)
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            }, LinearLayout.LayoutParams(dp(56), dp(30)))
            cell.addView(text(label, 10.5f).apply {
                setTextColor(tint)
                gravity = android.view.Gravity.CENTER
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            })
            bar.addView(cell, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        }
        item(R.drawable.ic_home, "Home", true) { list.smoothScrollToPosition(0) }
        item(R.drawable.ic_list, "Library", false) { list.setSelection(list.headerViewsCount) }
        item(R.drawable.ic_voice, "Voices", false) { LiteUi.showVoices(this) }
        item(R.drawable.ic_settings, "Settings", false) { showMenu() }
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
