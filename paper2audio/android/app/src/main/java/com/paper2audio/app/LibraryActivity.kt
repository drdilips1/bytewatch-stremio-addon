package com.paper2audio.app

import android.app.Activity
import android.app.AlertDialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Outline
import android.net.Uri
import android.os.Bundle
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.util.LruCache
import android.view.View
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.widget.BaseAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
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

/** Home screen: the user's documents with thumbnails, details and progress. */
class LibraryActivity : Activity() {
    private companion object {
        const val REQ_OPEN = 1
        const val REQ_IMAGES = 2
        const val REQ_CAMERA = 3
        val SORTS = arrayOf("Recently opened", "Recently added", "Title", "Author", "Progress")
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val refresh: () -> Unit = { renderMiniPlayer() }
    private val syncRefresh: () -> Unit = { reload() }
    private val thumbs = LruCache<String, Bitmap>(40)
    private var items: List<Library.Item> = emptyList()
    private var allItems: List<Library.Item> = emptyList()
    private var collection: String? = null
    private var query = ""
    /** Camera pages captured so far in the current scan. */
    private val scanPages = ArrayList<String>()

    private lateinit var list: ListView
    private lateinit var emptyView: TextView
    private lateinit var summary: TextView
    private lateinit var busyBar: ProgressBar
    private lateinit var busyText: TextView
    private lateinit var miniPlayer: View
    private lateinit var miniThumb: ImageView
    private lateinit var miniTitle: TextView
    private lateinit var miniSub: TextView
    private lateinit var miniPlay: ImageButton
    private lateinit var chips: LinearLayout
    private lateinit var chipScroll: View
    private lateinit var emptyText: CharSequence

    override fun onCreate(savedInstanceState: Bundle?) {
        Themes.apply(this)
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_library)

        list = findViewById(R.id.list)
        emptyView = findViewById(R.id.emptyView)
        summary = findViewById(R.id.librarySummary)
        busyBar = findViewById(R.id.busyBar)
        busyText = findViewById(R.id.busyText)
        miniPlayer = findViewById(R.id.miniPlayer)
        miniThumb = findViewById(R.id.miniThumb)
        miniTitle = findViewById(R.id.miniTitle)
        miniSub = findViewById(R.id.miniSub)
        miniPlay = findViewById(R.id.miniPlay)
        rounded(miniThumb, 8)
        chips = findViewById(R.id.chips)
        emptyText = emptyView.text
        chipScroll = findViewById(R.id.chipScroll)
        savedInstanceState?.getStringArrayList("scanPages")?.let(scanPages::addAll)

        Speaker.init(this) {}
        Library.loadCurrentId(this)

        list.adapter = adapter
        list.setOnItemClickListener { _, _, position, _ -> items.getOrNull(position)?.let(::open) }
        list.setOnItemLongClickListener { _, _, position, _ ->
            items.getOrNull(position)?.let(::itemMenu)
            true
        }
        findViewById<Button>(R.id.btnAddFile).setOnClickListener { showAddMenu() }
        findViewById<Button>(R.id.btnScan).setOnClickListener { showScanMenu() }
        findViewById<Button>(R.id.btnAddLink).setOnClickListener { askForLink() }
        findViewById<ImageButton>(R.id.btnSort).setOnClickListener { showSort() }
        findViewById<EditText>(R.id.filter).addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: Editable?) {
                query = s?.toString()?.trim().orEmpty()
                applyFilter()
            }
        })
        findViewById<ImageButton>(R.id.btnTheme).setOnClickListener { Themes.showPicker(this) }
        findViewById<ImageButton>(R.id.btnSync).setOnClickListener { showSync() }
        findViewById<ImageButton>(R.id.btnFind).setOnClickListener { startActivity(Intent(this, SearchActivity::class.java)) }
        miniPlayer.setOnClickListener { startActivity(Intent(this, PlayerActivity::class.java)) }
        miniPlay.setOnClickListener { Speaker.toggle() }

        handleIntent(intent)
    }

    private fun rounded(view: View, radiusDp: Int) {
        view.outlineProvider = object : ViewOutlineProvider() {
            override fun getOutline(v: View, outline: Outline) {
                outline.setRoundRect(0, 0, v.width, v.height, radiusDp * resources.displayMetrics.density)
            }
        }
        view.clipToOutline = true
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putStringArrayList("scanPages", scanPages)
    }

    private fun sortIndex() = getSharedPreferences("p2a", MODE_PRIVATE).getInt("librarySort", 0)

    /** Applies the search text, collection and sort order to the library. */
    private fun applyFilter() {
        val words = query.lowercase().split(' ').filter { it.isNotBlank() }
        val filtered = allItems.filter { item ->
            (collection == null || item.collection == collection) &&
                words.all { w ->
                    listOfNotNull(item.title, item.author, item.sourceName, item.collection, item.description)
                        .any { it.lowercase().contains(w) }
                }
        }
        items = when (sortIndex()) {
            1 -> filtered.sortedByDescending { it.added }
            2 -> filtered.sortedBy { it.title.lowercase() }
            3 -> filtered.sortedBy { (it.author ?: "\uFFFF").lowercase() }
            4 -> filtered.sortedByDescending { Library.progress(this, it) }
            else -> filtered.sortedByDescending { it.opened }
        }
        adapter.notifyDataSetChanged()
        emptyView.visibility = if (items.isEmpty()) View.VISIBLE else View.GONE
        emptyView.text = if (allItems.isEmpty()) emptyText else "Nothing matches."
    }

    private fun renderChips() {
        val names = Library.collections(this)
        if (collection != null && collection !in names) collection = null
        chipScroll.visibility = if (names.isEmpty()) View.GONE else View.VISIBLE
        chips.removeAllViews()
        val d = resources.displayMetrics.density
        for (name in listOf<String?>(null) + names) {
            val on = name == collection
            chips.addView(TextView(this).apply {
                text = name ?: "All"
                textSize = 14f
                gravity = Gravity.CENTER
                setPadding((14 * d).toInt(), (7 * d).toInt(), (14 * d).toInt(), (7 * d).toInt())
                setBackgroundResource(if (on) R.drawable.bg_chip_on else R.drawable.bg_chip)
                setTextColor(Themes.color(this@LibraryActivity, if (on) R.attr.p2aOnAccent else R.attr.p2aText))
                setOnClickListener {
                    collection = name
                    renderChips()
                    applyFilter()
                }
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                marginEnd = (8 * d).toInt()
            })
        }
    }

    private fun showSort() {
        AlertDialog.Builder(this)
            .setTitle("Sort by")
            .setSingleChoiceItems(SORTS, sortIndex()) { dialog, which ->
                getSharedPreferences("p2a", MODE_PRIVATE).edit().putInt("librarySort", which).apply()
                applyFilter()
                dialog.dismiss()
            }
            .show()
    }

    private fun reload() {
        allItems = Library.items(this)
        renderChips()
        applyFilter()
        val count = when (allItems.size) {
            0 -> "Papers and books to listen to"
            1 -> "1 document"
            else -> "${allItems.size} documents"
        }
        summary.text = if (DriveSync.enabled(this)) "$count · ${syncLabel()}" else count
        renderMiniPlayer()
    }

    private fun renderMiniPlayer() {
        val doc = Speaker.doc
        miniPlayer.visibility = if (doc != null) View.VISIBLE else View.GONE
        if (doc == null) return
        miniTitle.text = doc.title
        val chapter = doc.chapterAt(Speaker.index)?.title
        val pct = if (doc.paragraphs.size > 1) Speaker.index * 100 / (doc.paragraphs.size - 1) else 0
        miniSub.text = listOfNotNull(if (Speaker.playing) "Playing" else "Paused", chapter, "$pct%").joinToString(" · ")
        miniPlay.setImageResource(if (Speaker.playing) R.drawable.ic_pause else R.drawable.ic_play)
        bindThumb(miniThumb, doc.key)
    }

    private fun setBusy(text: String?) {
        busyBar.visibility = if (text != null) View.VISIBLE else View.GONE
        busyText.visibility = busyBar.visibility
        busyText.text = text ?: ""
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_LONG).show()

    // ---- Google Drive sync ----

    private fun syncLabel(): String {
        DriveSync.status?.let { if (DriveSync.running || it.startsWith("Sync failed") || DriveSync.needsSignIn) return it }
        val at = DriveSync.lastSync(this)
        if (at == 0L) return "Not synced yet"
        val minutes = (System.currentTimeMillis() - at) / 60_000
        return when {
            minutes < 1 -> "Synced just now"
            minutes < 60 -> "Synced $minutes min ago"
            minutes < 48 * 60 -> "Synced ${minutes / 60} h ago"
            else -> "Synced ${minutes / (24 * 60)} days ago"
        }
    }

    private fun signIn() {
        GoogleAuth.signIn(
            this,
            onToken = { DriveSync.enable(this, it) },
            onError = { AlertDialog.Builder(this).setTitle("Sign-in failed").setMessage(it).setPositiveButton("OK", null).show() },
        )
    }

    private fun showSync() {
        if (!DriveSync.enabled(this)) {
            AlertDialog.Builder(this)
                .setTitle("Sync with Google Drive")
                .setMessage(
                    "Sign in with Google to keep your library, reading positions and deletions " +
                        "the same on all your devices.\n\nFiles are stored in a private app folder in your " +
                        "own Google Drive (it uses your Drive storage). The app can't see anything else in your Drive."
                )
                .setPositiveButton("Sign in with Google") { _, _ -> signIn() }
                .setNegativeButton("Not now", null)
                .show()
            return
        }
        val who = DriveSync.email(this)?.let { "Signed in as $it\n" } ?: ""
        val builder = AlertDialog.Builder(this)
            .setTitle("Google Drive sync")
            .setMessage("$who${syncLabel()}\n\nSyncs automatically when you open the app, add or remove documents, and leave the player.")
            .setNeutralButton("Turn off") { _, _ ->
                DriveSync.disable(this)
                reload()
            }
            .setNegativeButton("Close", null)
        if (DriveSync.needsSignIn) {
            builder.setPositiveButton("Sign in again") { _, _ -> signIn() }
        } else {
            builder.setPositiveButton("Sync now") { _, _ -> DriveSync.request(this) }
        }
        builder.show()
    }

    // ---- Opening and importing ----

    private fun openPlayer() = startActivity(Intent(this, PlayerActivity::class.java))

    private fun open(item: Library.Item) {
        if (Speaker.doc?.key == item.id) {
            openPlayer()
            return
        }
        setBusy("Opening ${item.title}…")
        scope.launch {
            try {
                val doc = withContext(Dispatchers.Default) { Opener.parse(this@LibraryActivity, item) }
                withContext(Dispatchers.IO) { Library.opened(this@LibraryActivity, item, doc) }
                Speaker.load(doc)
                openPlayer()
            } catch (e: Exception) {
                toast(e.message ?: "Could not read that file")
            } finally {
                setBusy(null)
                reload()
            }
        }
    }

    private fun import(label: String, after: (Library.Item) -> Unit = {}, fetch: (progress: (String) -> Unit) -> Loader.Source) {
        setBusy(label)
        val progress: (String) -> Unit = { text -> runOnUiThread { setBusy(text) } }
        scope.launch {
            try {
                val (item, doc) = withContext(Dispatchers.IO) {
                    Opener.import(this@LibraryActivity, { fetch(progress) }, progress).also { after(it.first) }
                }
                thumbs.remove(item.id)
                withContext(Dispatchers.IO) { Library.opened(this@LibraryActivity, item, doc) }
                Speaker.load(doc)
                reload()
                DriveSync.request(this@LibraryActivity)
                openPlayer()
            } catch (e: Exception) {
                toast(e.message ?: "Could not open that")
            } finally {
                setBusy(null)
            }
        }
    }

    private fun importUri(uri: Uri) {
        if (contentResolver.getType(uri)?.startsWith("image/") == true) importImages(listOf(uri)) else {
            import("Adding to library…") { Loader.importUri(this, uri) }
        }
    }

    private fun fetch(text: String) {
        if (text.isBlank()) return
        import("Downloading…") { Loader.download(this, text) }
    }

    /** Recognizes the text in photos, screenshots or camera pages and adds it as one document. */
    private fun importImages(uris: List<Uri>, cleanup: () -> Unit = {}) {
        if (uris.isEmpty()) return
        val first = uris.first()
        import(
            "Reading text from ${if (uris.size == 1) "the image" else "${uris.size} images"}…",
            after = { item ->
                runCatching {
                    contentResolver.openInputStream(first)?.use { it.readBytes() }
                        ?.let { Thumbs.fromBytes(it, Library.thumb(this, item.id)) }
                }
                cleanup()
            },
        ) { progress ->
            val text = try {
                Ocr.images(this, uris, progress)
            } catch (e: Exception) {
                cleanup()
                throw e
            }
            if (text.isBlank()) {
                cleanup()
                error("No text found in ${if (uris.size == 1) "that image" else "those images"}.")
            }
            Loader.storeText(this, titleFrom(text, "Scan " + java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.MEDIUM, java.text.DateFormat.SHORT).format(java.util.Date())), text)
        }
    }

    /** A short title from the first line of [text]. */
    private fun titleFrom(text: String, fallback: String): String {
        val line = text.lineSequence().map { it.trim() }.firstOrNull { it.count(Char::isLetter) >= 3 } ?: return fallback
        return if (line.length <= 60) line else line.take(57).substringBeforeLast(' ') + "…"
    }

    private fun showAddMenu() {
        val options = arrayOf(
            "Document file\nPDF, EPUB, Word, Markdown, text or saved web page",
            "Paste text",
            "Photos or screenshots\nReads the text in the images",
        )
        AlertDialog.Builder(this)
            .setTitle("Add to library")
            .setItems(options) { _, which ->
                when (which) {
                    0 -> openPicker()
                    1 -> askForText()
                    2 -> pickImages()
                }
            }
            .show()
    }

    private fun showScanMenu() {
        AlertDialog.Builder(this)
            .setTitle("Scan printed pages")
            .setItems(arrayOf("Take photos with the camera", "Choose photos or screenshots")) { _, which ->
                if (which == 0) {
                    clearScan()
                    takePhoto()
                } else {
                    pickImages()
                }
            }
            .show()
    }

    private fun pickImages() {
        val intent = Intent(Intent.ACTION_GET_CONTENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("image/*")
            .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        @Suppress("DEPRECATION")
        startActivityForResult(Intent.createChooser(intent, "Choose images"), REQ_IMAGES)
    }

    private fun scanDir() = File(cacheDir, "scan").apply { mkdirs() }

    private fun clearScan() {
        scanPages.clear()
        scanDir().listFiles()?.forEach { it.delete() }
    }

    private fun takePhoto() {
        val file = File(scanDir(), "page-${scanPages.size + 1}-${System.currentTimeMillis()}.jpg")
        val uri = androidx.core.content.FileProvider.getUriForFile(this, "$packageName.files", file)
        val intent = Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE)
            .putExtra(android.provider.MediaStore.EXTRA_OUTPUT, uri)
            .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        intent.clipData = ClipData.newRawUri("page", uri)
        scanPages += file.path
        try {
            @Suppress("DEPRECATION")
            startActivityForResult(intent, REQ_CAMERA)
        } catch (e: Exception) {
            scanPages.removeAt(scanPages.lastIndex)
            toast("No camera app found")
        }
    }

    private fun afterPhoto(ok: Boolean) {
        val last = scanPages.lastOrNull()?.let(::File)
        if (!ok || last == null || !last.exists() || last.length() == 0L) {
            if (scanPages.isNotEmpty()) scanPages.removeAt(scanPages.lastIndex)
            last?.delete()
        }
        if (scanPages.isEmpty()) return
        val n = scanPages.size
        AlertDialog.Builder(this)
            .setTitle(if (n == 1) "1 page scanned" else "$n pages scanned")
            .setMessage("Scan another page, or read the text of the pages you have.")
            .setCancelable(false)
            .setPositiveButton("Done") { _, _ -> finishScan() }
            .setNeutralButton("Next page") { _, _ -> takePhoto() }
            .setNegativeButton("Discard") { _, _ -> clearScan() }
            .show()
    }

    private fun finishScan() {
        val uris = scanPages.map { Uri.fromFile(File(it)) }
        scanPages.clear()
        importImages(uris) { scanDir().listFiles()?.forEach { it.delete() } }
    }

    private fun askForText() {
        val d = resources.displayMetrics.density
        val clip = (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager).primaryClip
            ?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(this)?.toString().orEmpty()
        val title = EditText(this).apply {
            hint = "Title (optional)"
            isSingleLine = true
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
        }
        val body = EditText(this).apply {
            hint = "Paste or type the text to listen to"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            minLines = 4
            maxLines = 10
            gravity = Gravity.TOP or Gravity.START
            if (clip.length > 40) setText(clip)
        }
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding((20 * d).toInt(), (8 * d).toInt(), (20 * d).toInt(), 0)
            addView(title)
            addView(body)
        }
        AlertDialog.Builder(this)
            .setTitle("Paste text")
            .setView(box)
            .setPositiveButton("Add") { _, _ -> addText(body.text.toString(), title.text.toString()) }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun addText(text: String, title: String = "") {
        if (text.isBlank()) return
        import("Adding to library…") { Loader.storeText(this, title.trim().ifBlank { titleFrom(text, "Pasted text") }, text) }
    }

    private fun itemMenu(item: Library.Item) {
        val where = item.collection?.let { "Collection: $it" } ?: "Not in a collection"
        AlertDialog.Builder(this)
            .setTitle(item.title)
            .setItems(arrayOf("Move to collection…  ($where)", "Remove from library")) { _, which ->
                if (which == 0) chooseCollection(item) else confirmRemove(item)
            }
            .show()
    }

    private fun chooseCollection(item: Library.Item) {
        val names = Library.collections(this)
        val options = names.toTypedArray() + "New collection…" + "No collection"
        AlertDialog.Builder(this)
            .setTitle("Move to collection")
            .setItems(options) { _, which ->
                when {
                    which < names.size -> moveTo(item, names[which])
                    which == names.size -> newCollection(item)
                    else -> moveTo(item, null)
                }
            }
            .show()
    }

    private fun newCollection(item: Library.Item) {
        val input = EditText(this).apply {
            hint = "e.g. Sleep research, Novels"
            isSingleLine = true
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS
        }
        val box = FrameLayout(this).apply {
            val pad = (20 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad / 2, pad, 0)
            addView(input)
        }
        AlertDialog.Builder(this)
            .setTitle("New collection")
            .setView(box)
            .setPositiveButton("Create") { _, _ -> moveTo(item, input.text.toString()) }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun moveTo(item: Library.Item, name: String?) {
        Library.setCollection(this, item, name)
        reload()
        DriveSync.request(this)
    }

    private fun askForLink() {
        val input = EditText(this).apply {
            hint = "1706.03762 or https://…/paper.pdf"
            inputType = InputType.TYPE_TEXT_VARIATION_URI
            isSingleLine = true
        }
        val box = FrameLayout(this).apply {
            val pad = (20 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad / 2, pad, 0)
            addView(input)
        }
        AlertDialog.Builder(this)
            .setTitle("Add from a link")
            .setMessage("Enter an arXiv ID, a web article link, or a link to a PDF, EPUB or Word file.")
            .setView(box)
            .setPositiveButton("Add") { _, _ -> fetch(input.text.toString()) }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun confirmRemove(item: Library.Item) {
        AlertDialog.Builder(this)
            .setTitle("Remove from library?")
            .setMessage("“${item.title}” and its listening position will be deleted from this phone.")
            .setPositiveButton("Remove") { _, _ ->
                if (Speaker.doc?.key == item.id) Speaker.pause()
                Library.remove(this, item)
                thumbs.remove(item.id)
                reload()
                DriveSync.request(this)
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun openPicker() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("*/*")
            .putExtra(
                Intent.EXTRA_MIME_TYPES,
                arrayOf(
                    "application/pdf", "application/epub+zip", "text/plain", "text/markdown", "text/html",
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    "application/octet-stream",
                ),
            )
        @Suppress("DEPRECATION")
        startActivityForResult(intent, REQ_OPEN)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_OPEN && resultCode == RESULT_OK) data?.data?.let(::importUri)
        if (requestCode == REQ_IMAGES && resultCode == RESULT_OK && data != null) {
            val clip = data.clipData
            val uris = if (clip != null) (0 until clip.itemCount).map { clip.getItemAt(it).uri } else listOfNotNull(data.data)
            importImages(uris)
        }
        if (requestCode == REQ_CAMERA) afterPhoto(resultCode == RESULT_OK)
        if (requestCode == GoogleAuth.REQ_AUTH) {
            val token = if (resultCode == RESULT_OK) GoogleAuth.tokenFromResult(this, data) else null
            if (token != null) DriveSync.enable(this, token) else toast("Google sign-in was cancelled")
        }
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
                val link = text?.let { Regex("""https?://\S+""").find(it)?.value }
                when {
                    stream != null -> importUri(stream)
                    link != null && text!!.length < link.length + 200 -> fetch(link)
                    text != null -> addText(text, intent.getStringExtra(Intent.EXTRA_SUBJECT).orEmpty())
                }
            }
            Intent.ACTION_SEND_MULTIPLE -> {
                @Suppress("DEPRECATION")
                val streams = intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM).orEmpty()
                importImages(streams)
            }
        }
        intent?.action = null // don't re-import on rotation
    }

    // ---- List ----

    private fun bindThumb(view: ImageView, id: String) {
        view.tag = id
        val cached = thumbs.get(id)
        if (cached != null) {
            view.setImageBitmap(cached)
            return
        }
        view.setImageDrawable(null)
        scope.launch {
            val bmp = Thumbs.load(Library.thumb(this@LibraryActivity, id), (64 * resources.displayMetrics.density).toInt())
                ?: return@launch
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

    private fun describe(item: Library.Item): String {
        val parts = ArrayList<String>()
        parts += when (item.kind) {
            Loader.Kind.DOCX -> "Word"
            Loader.Kind.HTML -> "Web"
            Loader.Kind.MD -> "Markdown"
            else -> item.kind.name
        }
        item.collection?.let { parts += it }
        if (item.kind == Loader.Kind.PDF && item.pages > 0) parts += "${item.pages} pages"
        if (item.chapters > 1) parts += "${item.chapters} chapters"
        val minutes = (item.words / 160f).toInt()
        parts += if (minutes >= 60) "${minutes / 60} h ${minutes % 60} min" else "$minutes min"
        return parts.joinToString(" · ")
    }

    private val adapter = object : BaseAdapter() {
        override fun getCount() = items.size
        override fun getItem(position: Int) = items[position]
        override fun getItemId(position: Int) = position.toLong()

        override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
            val view = convertView ?: layoutInflater.inflate(R.layout.item_library, parent, false).also {
                it.tag = Holder(it)
                rounded(it.findViewById(R.id.thumb), 8)
            }
            val h = view.tag as Holder
            val item = items[position]
            h.title.text = item.title
            h.author.text = item.author ?: item.sourceName
            h.meta.text = describe(item)
            val pct = Library.progress(this@LibraryActivity, item)
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

    override fun onStart() {
        super.onStart()
        Speaker.addListener(refresh)
        DriveSync.addListener(syncRefresh)
        reload()
        DriveSync.request(this)
    }

    override fun onStop() {
        Speaker.removeListener(refresh)
        DriveSync.removeListener(syncRefresh)
        super.onStop()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
