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

/** Finds free books (Project Gutenberg) and papers (arXiv) and adds them to the library. */
class SearchActivity : Activity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val covers = LruCache<String, Bitmap>(60)
    private var results: List<Metadata.Result> = emptyList()
    private var papers = false
    private var searchJob: Job? = null

    private lateinit var query: EditText
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
        tabBooks = findViewById(R.id.tabBooks)
        tabPapers = findViewById(R.id.tabPapers)
        busy = findViewById(R.id.busy)
        empty = findViewById(R.id.empty)
        sourceNote = findViewById(R.id.sourceNote)
        list = findViewById(R.id.results)

        findViewById<ImageButton>(R.id.btnBack).setOnClickListener { finish() }
        findViewById<ImageButton>(R.id.btnSearch).setOnClickListener { search() }
        query.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_SEARCH) search()
            actionId == EditorInfo.IME_ACTION_SEARCH
        }
        tabBooks.setOnClickListener { setMode(false) }
        tabPapers.setOnClickListener { setMode(true) }
        list.adapter = adapter
        list.setOnItemClickListener { _, _, position, _ -> results.getOrNull(position)?.let(::confirmAdd) }
        setMode(false)
    }

    private fun color(attr: Int): Int {
        val v = TypedValue()
        theme.resolveAttribute(attr, v, true)
        return v.data
    }

    private fun setMode(paperMode: Boolean) {
        papers = paperMode
        val (on, off) = if (papers) tabPapers to tabBooks else tabBooks to tabPapers
        on.setBackgroundResource(R.drawable.bg_button)
        on.setTextColor(color(R.attr.p2aOnAccent))
        off.setBackgroundResource(R.drawable.bg_button_soft)
        off.setTextColor(color(R.attr.p2aText))
        query.hint = if (papers) "Topic, title or author of a paper" else "Title or author of a classic book"
        sourceNote.text = if (papers) {
            "Research papers from arXiv (free, open access)."
        } else {
            "70,000+ free public-domain e-books from Project Gutenberg. Newer copyrighted books aren't available here."
        }
        results = emptyList()
        adapter.notifyDataSetChanged()
        if (papers && query.text.isBlank()) showEmpty("Search arXiv for a topic, title or author.") else search()
    }

    private fun showEmpty(text: String?) {
        empty.text = text ?: ""
        empty.visibility = if (text != null) View.VISIBLE else View.GONE
    }

    private fun search() {
        val q = query.text.toString()
        if (papers && q.isBlank()) return
        getSystemService(InputMethodManager::class.java).hideSoftInputFromWindow(query.windowToken, 0)
        searchJob?.cancel()
        busy.visibility = View.VISIBLE
        showEmpty(null)
        val paperMode = papers
        searchJob = scope.launch {
            try {
                val found = withContext(Dispatchers.IO) {
                    if (paperMode) Metadata.searchArxiv(q) else Metadata.searchGutenberg(q)
                }
                results = found
                adapter.notifyDataSetChanged()
                list.setSelection(0)
                if (found.isEmpty()) showEmpty("Nothing found. Try other words.")
            } catch (e: Exception) {
                results = emptyList()
                adapter.notifyDataSetChanged()
                showEmpty("Couldn't search right now (${e.message}). Check your internet and try again.")
            } finally {
                busy.visibility = View.GONE
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
                    val (item, doc) = Opener.import(this@SearchActivity, { Loader.download(this@SearchActivity, r.downloadUrl) })
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
