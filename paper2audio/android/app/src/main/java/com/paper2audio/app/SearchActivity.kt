package com.paper2audio.app

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Bundle
import android.util.LruCache
import android.util.TypedValue
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.BaseAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Finds books (Bookracy) and free classics (Project Gutenberg) and adds them to the library.
 * Both are searched at once, so switching tabs shows results immediately.
 */
class SearchActivity : Activity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val covers = LruCache<String, Bitmap>(60)
    private var results: List<Metadata.Result> = emptyList()
    private companion object {
        const val BOOKRACY = 0
        const val CLASSICS = 1
        const val PAPERS = 2
    }

    /** A category to browse: [term] searches Bookracy, [topic] is Project Gutenberg's subject. */
    private class Category(val label: String, val term: String, val topic: String)

    private val NONFICTION = listOf(
        Category("Science", "science", "science"),
        Category("History", "history", "history"),
        Category("Biography & memoir", "biography", "biography"),
        Category("Psychology", "psychology", "psychology"),
        Category("Philosophy", "philosophy", "philosophy"),
        Category("Self-help", "self help", "conduct of life"),
        Category("Health & medicine", "health medicine", "medicine"),
        Category("Business & economics", "economics business", "economics"),
        Category("Politics & society", "politics", "political science"),
        Category("Religion & spirituality", "spirituality", "religion"),
        Category("Nature & environment", "nature", "nature"),
        Category("Travel", "travel", "travel"),
        Category("True crime", "true crime", "crime"),
        Category("Essays", "essays", "essays"),
        Category("Mathematics", "mathematics", "mathematics"),
        Category("Art & music", "art", "art"),
        Category("Education", "education", "education"),
    )
    private val FICTION = listOf(
        Category("Literary fiction", "novel", "fiction"),
        Category("Mystery & thriller", "mystery thriller", "detective"),
        Category("Science fiction", "science fiction", "science fiction"),
        Category("Fantasy", "fantasy", "fantasy"),
        Category("Romance", "romance", "love stories"),
        Category("Adventure", "adventure", "adventure"),
        Category("Poetry", "poetry", "poetry"),
        Category("Children's", "children", "children"),
    )
    /** The category being browsed (its label is in the search box). */
    private var category: Category? = null
    private lateinit var categories: LinearLayout

    private var mode = BOOKRACY
    private val papers get() = mode == PAPERS
    private var searchJob: Job? = null

    private lateinit var query: EditText
    private lateinit var tabBookracy: Button
    private lateinit var tabBooks: Button
    private lateinit var tabPapers: Button
    private lateinit var busy: ProgressBar
    private lateinit var empty: TextView
    private lateinit var sourceNote: TextView
    private lateinit var list: ListView

    override fun onCreate(savedInstanceState: Bundle?) {
        Themes.apply(this)
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_search)
        query = findViewById(R.id.query)
        tabBookracy = findViewById(R.id.tabBookracy)
        tabBooks = findViewById(R.id.tabBooks)
        tabPapers = findViewById(R.id.tabPapers)
        busy = findViewById(R.id.busy)
        empty = findViewById(R.id.empty)
        sourceNote = findViewById(R.id.sourceNote)
        list = findViewById(R.id.results)
        categories = findViewById(R.id.categories)
        renderCategories()

        findViewById<ImageButton>(R.id.btnBack).setOnClickListener { finish() }
        findViewById<ImageButton>(R.id.btnSearch).setOnClickListener { search() }
        query.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_SEARCH) search()
            actionId == EditorInfo.IME_ACTION_SEARCH
        }
        tabBookracy.setOnClickListener { setMode(BOOKRACY) }
        tabBooks.setOnClickListener { setMode(CLASSICS) }
        tabPapers.setOnClickListener { setMode(PAPERS) }
        list.adapter = adapter
        list.setOnItemClickListener { _, _, position, _ -> results.getOrNull(position)?.let(::confirmAdd) }
        intent.getStringExtra("q")?.takeIf { it.isNotBlank() }?.let { query.setText(it) }
        setMode(getSharedPreferences("p2a", MODE_PRIVATE).getInt("findMode", BOOKRACY).coerceAtMost(CLASSICS))
    }

    /** Results per tab: (query, results or error). */
    private val found = HashMap<Int, Pair<String, Result<List<Metadata.Result>>>>()
    private val running = HashMap<Int, Job>()

    private fun showFound(m: Int) {
        val (_, r) = found[m] ?: return
        busy.visibility = View.GONE
        r.onSuccess { list0 ->
            results = list0
            adapter.notifyDataSetChanged()
            list.setSelection(0)
            showEmpty(if (list0.isEmpty()) "Nothing found. Try other words." else null)
        }.onFailure { e ->
            results = emptyList()
            adapter.notifyDataSetChanged()
            showEmpty("Couldn't search right now (${e.message}). Check your internet and try again.")
        }
    }

    private fun color(attr: Int): Int {
        val v = TypedValue()
        theme.resolveAttribute(attr, v, true)
        return v.data
    }

    private fun setMode(m: Int) {
        mode = m.coerceIn(BOOKRACY, PAPERS)
        getSharedPreferences("p2a", MODE_PRIVATE).edit().putInt("findMode", mode).apply()
        for ((i, tab) in listOf(tabBookracy, tabBooks).withIndex()) {
            val on = i == mode
            tab.setBackgroundResource(if (on) R.drawable.bg_button else R.drawable.bg_button_soft)
            tab.setTextColor(color(if (on) R.attr.p2aOnAccent else R.attr.p2aText))
        }
        if (::categories.isInitialized) renderCategories()
        query.hint = when (mode) {
            BOOKRACY -> "Title or author of any book"
            CLASSICS -> "Title or author of a classic book"
            else -> "Topic, title or author of a paper"
        }
        sourceNote.text = when (mode) {
            BOOKRACY -> "Books from Bookracy, including recent ones, as EPUB or PDF."
            CLASSICS -> "70,000+ free public-domain e-books from Project Gutenberg (this source can take a few seconds)."
            else -> "Research papers from arXiv (free, open access)."
        }
        val q = query.text.toString().trim()
        if (found[mode]?.first == q) {
            showFound(mode)
            return
        }
        results = emptyList()
        adapter.notifyDataSetChanged()
        when {
            mode != CLASSICS && query.text.isBlank() ->
                showEmpty(if (mode == BOOKRACY) "Search Bookracy for a title or author." else "Search arXiv for a topic, title or author.")
            else -> search()
        }
    }

    /** Two rows of category tags: nonfiction, then fiction. */
    private fun renderCategories() {
        categories.removeAllViews()
        categories.visibility = if (papers) View.GONE else View.VISIBLE
        val d = resources.displayMetrics.density
        fun dp(v: Int) = (v * d).toInt()
        for ((label, cats) in listOf("Nonfiction" to NONFICTION, "Fiction" to FICTION)) {
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.CENTER_VERTICAL
                setPadding(dp(16), dp(4), dp(16), dp(4))
            }
            row.addView(TextView(this).apply {
                text = label.uppercase()
                textSize = 11f
                letterSpacing = 0.08f
                setTextColor(color(R.attr.p2aMuted))
                setPadding(0, 0, dp(10), 0)
            })
            for (c in cats) {
                val on = c === category
                row.addView(TextView(this).apply {
                    text = c.label
                    textSize = 14f
                    setPadding(dp(14), dp(8), dp(14), dp(8))
                    setBackgroundResource(if (on) R.drawable.bg_chip_on else R.drawable.bg_chip)
                    setTextColor(color(if (on) R.attr.p2aOnAccent else R.attr.p2aText))
                    elevation = dp(1).toFloat()
                    setOnClickListener {
                        category = if (on) null else c
                        query.setText(if (on) "" else c.label)
                        renderCategories()
                        if (!on) search()
                    }
                }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginEnd = dp(8) })
            }
            categories.addView(android.widget.HorizontalScrollView(this).apply {
                isHorizontalScrollBarEnabled = false
                addView(row)
            })
        }
    }

    private fun showEmpty(text: String?) {
        empty.text = text ?: ""
        empty.visibility = if (text != null) View.VISIBLE else View.GONE
    }

    private fun search() {
        val q = query.text.toString().trim()
        if (mode != CLASSICS && q.isBlank()) return
        getSystemService(InputMethodManager::class.java).hideSoftInputFromWindow(query.windowToken, 0)
        found[mode]?.let { (fq, _) ->
            if (fq == q) {
                showFound(mode)
                return
            }
        }
        results = emptyList()
        adapter.notifyDataSetChanged()
        busy.visibility = View.VISIBLE
        showEmpty(null)
        // Search both sources together; whichever tab is shown fills as soon as its results arrive.
        for (m in listOf(BOOKRACY, CLASSICS)) {
            if (m == BOOKRACY && q.isBlank()) continue
            if (found[m]?.first == q) continue
            running[m]?.cancel()
            running[m] = scope.launch {
                // A category in the box browses it; anything typed is a normal search.
                val cat = category?.takeIf { it.label == q }
                val r = withContext(Dispatchers.IO) {
                    runCatching {
                        when {
                            m == BOOKRACY -> Metadata.searchBookracy(cat?.term ?: q)
                            cat != null -> Metadata.searchGutenbergTopic(cat.topic)
                            else -> Metadata.searchGutenberg(q)
                        }
                    }
                }
                found[m] = q to r
                if (mode == m && query.text.toString().trim() == q) showFound(m)
            }
        }
    }

    private fun confirmAdd(r: Metadata.Result) {
        val text = buildString {
            r.author?.let { append(it).append('\n') }
            r.year?.let { append(it).append('\n') }
            r.summary?.let { append('\n').append(it.take(700)).append('\n') }
        }
        AlertDialog.Builder(this)
            .setTitle(r.title)
            .setMessage(text.trim().ifEmpty { null })
            .setPositiveButton("Add and listen") { _, _ -> add(r) }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun add(r: Metadata.Result) {
        busy.visibility = View.VISIBLE
        Toast.makeText(this, "Downloading “${r.title}”…", Toast.LENGTH_SHORT).show()
        scope.launch {
            try {
                val (item, doc) = withContext(Dispatchers.IO) {
                    // Already in the library (downloaded before): open that copy instead of adding another.
                    val have = Library.items(this@SearchActivity).firstOrNull { it.url == r.downloadUrl }
                    val (item, doc) = if (have != null) have to Opener.parse(this@SearchActivity, have) else try {
                        Opener.import(this@SearchActivity, { Loader.download(this@SearchActivity, r.downloadUrl) }, url = r.downloadUrl, checkDuplicate = true)
                    } catch (d: Opener.Duplicate) {
                        d.src.file.delete()
                        d.existing to Opener.parse(this@SearchActivity, d.existing)
                    }
                    // The catalogue's title/author/summary are cleaner than what's inside many files.
                    val found = Metadata.Found(r.title, r.author, r.year?.take(4)?.toIntOrNull(), r.summary, r.coverUrl, "search")
                    val cover = r.coverUrl?.let { runCatching { Metadata.bytes(it) }.getOrNull() }
                    Library.applyDetails(this@SearchActivity, item, found, cover)
                    Library.opened(this@SearchActivity, item, doc)
                    item to doc
                }
                Speaker.load(doc)
                DriveSync.request(this@SearchActivity)
                startActivity(Intent(this@SearchActivity, PlayerActivity::class.java))
                finish()
            } catch (e: Exception) {
                Toast.makeText(this@SearchActivity, e.message ?: "Couldn't add that", Toast.LENGTH_LONG).show()
            } finally {
                busy.visibility = View.GONE
            }
        }
    }

    private fun bindCover(view: ImageView, url: String?) {
        view.tag = url
        view.setImageDrawable(null)
        if (url == null) return
        covers.get(url)?.let {
            view.setImageBitmap(it)
            return
        }
        scope.launch {
            val bmp = withContext(Dispatchers.IO) {
                runCatching {
                    val bytes = Metadata.bytes(url)
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = 2 })
                }.getOrNull()
            } ?: return@launch
            covers.put(url, bmp)
            if (view.tag == url) view.setImageBitmap(bmp)
        }
    }

    private val adapter = object : BaseAdapter() {
        override fun getCount() = results.size
        override fun getItem(position: Int) = results[position]
        override fun getItemId(position: Int) = position.toLong()

        override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
            val view = convertView ?: layoutInflater.inflate(R.layout.item_search, parent, false)
            val r = results[position]
            view.findViewById<TextView>(R.id.title).text = r.title
            view.findViewById<TextView>(R.id.sub).text = listOfNotNull(r.author, r.year).joinToString(" · ")
            view.findViewById<TextView>(R.id.summary).apply {
                text = r.summary ?: ""
                visibility = if (r.summary != null) View.VISIBLE else View.GONE
            }
            val thumb = view.findViewById<ImageView>(R.id.thumb)
            thumb.visibility = if (papers) View.GONE else View.VISIBLE
            if (!papers) bindCover(thumb, r.coverUrl)
            return view
        }
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
