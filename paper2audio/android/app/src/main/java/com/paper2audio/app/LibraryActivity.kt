package com.paper2audio.app

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Outline
import android.net.Uri
import android.os.Bundle
import android.text.InputType
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

/** Home screen: the user's documents with thumbnails, details and progress. */
class LibraryActivity : Activity() {
    private companion object {
        const val REQ_OPEN = 1
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val refresh: () -> Unit = { renderMiniPlayer() }
    private val thumbs = LruCache<String, Bitmap>(40)
    private var items: List<Library.Item> = emptyList()

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

        Speaker.init(this) {}
        Library.loadCurrentId(this)

        list.adapter = adapter
        list.setOnItemClickListener { _, _, position, _ -> items.getOrNull(position)?.let(::open) }
        list.setOnItemLongClickListener { _, _, position, _ ->
            items.getOrNull(position)?.let(::confirmRemove)
            true
        }
        findViewById<Button>(R.id.btnAddFile).setOnClickListener { openPicker() }
        findViewById<Button>(R.id.btnAddLink).setOnClickListener { askForLink() }
        findViewById<ImageButton>(R.id.btnTheme).setOnClickListener { Themes.showPicker(this) }
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

    private fun reload() {
        items = Library.items(this)
        adapter.notifyDataSetChanged()
        emptyView.visibility = if (items.isEmpty()) View.VISIBLE else View.GONE
        summary.text = when (items.size) {
            0 -> "Papers and books to listen to"
            1 -> "1 document"
            else -> "${items.size} documents"
        }
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

    private fun import(label: String, fetch: () -> Loader.Source) {
        setBusy(label)
        scope.launch {
            try {
                val (item, doc) = withContext(Dispatchers.IO) { Opener.import(this@LibraryActivity, fetch) }
                withContext(Dispatchers.IO) { Library.opened(this@LibraryActivity, item, doc) }
                Speaker.load(doc)
                reload()
                openPlayer()
            } catch (e: Exception) {
                toast(e.message ?: "Could not open that")
            } finally {
                setBusy(null)
            }
        }
    }

    private fun importUri(uri: Uri) = import("Adding to library…") { Loader.importUri(this, uri) }

    private fun fetch(text: String) {
        if (text.isBlank()) return
        import("Downloading…") { Loader.download(this, text) }
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
            .setTitle("Add from arXiv or a link")
            .setMessage("Enter an arXiv ID, or a link to a PDF or EPUB.")
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
        parts += item.kind.name
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
}
