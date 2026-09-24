package com.paper2audio.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** The user's documents: files, metadata and thumbnails, stored in app storage. */
object Library {
    class Item(
        val id: String,
        var title: String,
        var author: String?,
        val kind: Loader.Kind,
        val sourceName: String,
        val added: Long,
        var opened: Long,
        var paragraphs: Int,
        var words: Int,
        var chapters: Int,
        var pages: Int,
        var description: String? = null,
        var year: Int = 0,
    ) {
        fun toJson() = JSONObject()
            .put("id", id).put("title", title).put("author", author ?: "")
            .put("kind", kind.name).put("sourceName", sourceName)
            .put("added", added).put("opened", opened)
            .put("paragraphs", paragraphs).put("words", words)
            .put("chapters", chapters).put("pages", pages)
            .put("description", description ?: "").put("year", year)

        companion object {
            fun fromJson(o: JSONObject) = Item(
                o.getString("id"), o.getString("title"), o.optString("author").ifBlank { null },
                Loader.Kind.valueOf(o.getString("kind")), o.optString("sourceName"),
                o.optLong("added"), o.optLong("opened"), o.optInt("paragraphs"), o.optInt("words"),
                o.optInt("chapters"), o.optInt("pages"),
                o.optString("description").ifBlank { null }, o.optInt("year"),
            )
        }
    }

    private var cache: MutableList<Item>? = null

    fun dir(context: Context) = File(context.filesDir, "library")

    private fun index(context: Context) = File(dir(context), "library.json")

    fun thumb(context: Context, id: String) = File(dir(context), "$id.jpg")

    private fun prefs(context: Context) = context.getSharedPreferences("p2a", Context.MODE_PRIVATE)

    @Synchronized
    fun items(context: Context): List<Item> {
        val list = cache ?: run {
            val f = index(context)
            val arr = if (f.exists()) runCatching { JSONArray(f.readText()) }.getOrNull() else null
            MutableList(arr?.length() ?: 0) { Item.fromJson(arr!!.getJSONObject(it)) }.also { cache = it }
        }
        return list.sortedByDescending { maxOf(it.opened, it.added) }
    }

    fun get(context: Context, id: String?): Item? = id?.let { i -> items(context).firstOrNull { it.id == i } }

    @Synchronized
    private fun save(context: Context) {
        val arr = JSONArray()
        cache.orEmpty().forEach { arr.put(it.toJson()) }
        dir(context).mkdirs()
        index(context).writeText(arr.toString())
    }

    fun fileName(item: Item) = "${item.id}.${item.kind.name.lowercase()}"

    fun source(context: Context, item: Item): Loader.Source =
        Loader.Source(File(dir(context), fileName(item)), item.kind, item.sourceName, item.id)

    /** The document open in the player (restored after the app restarts). */
    var currentId: String? = null
        private set

    fun loadCurrentId(context: Context) {
        currentId = prefs(context).getString("currentId", null)
    }

    /** Adds a newly imported document and renders its thumbnail. Call off the main thread. */
    fun add(context: Context, src: Loader.Source, doc: Doc): Item {
        val now = System.currentTimeMillis()
        val item = Item(
            src.id, doc.title, doc.author, src.kind, src.name, now, now,
            doc.paragraphs.size, doc.words, doc.chapters.size, doc.pages,
        )
        runCatching { Thumbs.make(context, src, doc, thumb(context, src.id)) }
        synchronized(this) {
            items(context)
            cache!!.add(item)
            save(context)
        }
        return item
    }

    /** Records that [item] was opened, with counts from the freshly parsed [doc]. */
    fun opened(context: Context, item: Item, doc: Doc) {
        synchronized(this) {
            item.opened = System.currentTimeMillis()
            item.paragraphs = doc.paragraphs.size
            item.words = doc.words
            item.chapters = doc.chapters.size
            if (doc.pages > 0) item.pages = doc.pages
            save(context)
        }
        currentId = item.id
        prefs(context).edit().putString("currentId", item.id).apply()
    }

    /** Applies looked-up details (and an optional cover image) to [item]. Call off the main thread. */
    fun applyDetails(context: Context, item: Item, found: Metadata.Found, cover: ByteArray?) {
        cover?.let { runCatching { Thumbs.fromBytes(it, thumb(context, item.id)) } }
        synchronized(this) {
            item.title = found.title.ifBlank { item.title }
            found.author?.let { item.author = it }
            found.year?.let { item.year = it }
            found.description?.let { item.description = it }
            item.opened = maxOf(item.opened, System.currentTimeMillis()) // newest metadata wins in sync
            save(context)
        }
    }

    fun remove(context: Context, item: Item) {
        synchronized(this) {
            items(context)
            cache!!.removeAll { it.id == item.id }
            save(context)
        }
        source(context, item).file.delete()
        thumb(context, item.id).delete()
        // Remembered so sync removes it from other devices too.
        val deleted = deleted(context).put(item.id, System.currentTimeMillis())
        prefs(context).edit().remove("pos:${item.id}").remove("posAt:${item.id}")
            .putString("deleted", deleted.toString()).apply()
        if (currentId == item.id) {
            currentId = null
            prefs(context).edit().remove("currentId").apply()
        }
    }

    private fun deleted(context: Context): JSONObject =
        runCatching { JSONObject(prefs(context).getString("deleted", "{}")!!) }.getOrElse { JSONObject() }

    class Merged(val items: List<Item>, val deleted: Set<String>, val json: JSONObject)

    /**
     * Merges the library index from another device ([remote], may be null) into
     * this one: union of documents, newest metadata and listening position win,
     * and deletions apply everywhere. Returns the merged index to upload.
     */
    fun merge(context: Context, remote: JSONObject?): Merged = synchronized(this) {
        items(context)
        val list = cache!!
        val p = prefs(context)
        val edit = p.edit()
        val deleted = deleted(context)
        remote?.optJSONObject("deleted")?.let { rd ->
            rd.keys().forEach { k -> if (rd.optLong(k) > deleted.optLong(k, 0)) deleted.put(k, rd.optLong(k)) }
        }
        val remoteItems = remote?.optJSONArray("items")
        for (i in 0 until (remoteItems?.length() ?: 0)) {
            val o = remoteItems!!.getJSONObject(i)
            val r = runCatching { Item.fromJson(o) }.getOrNull() ?: continue
            val local = list.firstOrNull { it.id == r.id }
            if (local == null) {
                list.add(r)
            } else if (r.opened > local.opened) {
                local.title = r.title
                local.author = r.author
                local.opened = r.opened
                local.paragraphs = r.paragraphs
                local.words = r.words
                local.chapters = r.chapters
                local.pages = r.pages
                local.description = r.description
                local.year = r.year
            }
            val remoteAt = o.optLong("posAt", 0)
            if (remoteAt > p.getLong("posAt:${r.id}", 0)) {
                edit.putInt("pos:${r.id}", o.optInt("pos")).putLong("posAt:${r.id}", remoteAt)
            }
        }
        val deletedIds = deleted.keys().asSequence().toSet()
        for (gone in list.filter { it.id in deletedIds }) {
            File(dir(context), fileName(gone)).delete()
            thumb(context, gone.id).delete()
            edit.remove("pos:${gone.id}").remove("posAt:${gone.id}")
        }
        list.removeAll { it.id in deletedIds }
        if (currentId in deletedIds) {
            currentId = null
            edit.remove("currentId")
        }
        edit.putString("deleted", deleted.toString()).apply()
        save(context)

        val arr = JSONArray()
        for (item in list) {
            arr.put(item.toJson().put("pos", p.getInt("pos:${item.id}", 0)).put("posAt", p.getLong("posAt:${item.id}", 0)))
        }
        Merged(list.toList(), deletedIds, JSONObject().put("items", arr).put("deleted", deleted))
    }

    /** Listening progress, 0..100. */
    fun progress(context: Context, item: Item): Int {
        if (item.paragraphs <= 1) return 0
        val pos = prefs(context).getInt("pos:${item.id}", 0)
        return (pos * 100 / (item.paragraphs - 1)).coerceIn(0, 100)
    }

    fun minutesLeft(context: Context, item: Item, speed: Float): Int {
        val remaining = item.words * (100 - progress(context, item)) / 100
        return (remaining / (160 * speed)).toInt()
    }
}

/** Library thumbnails: a PDF's first page, an EPUB's cover, or a generated tile. */
object Thumbs {
    private const val WIDTH = 360
    private val TILE_COLORS = intArrayOf(
        0xFF2F5BEA.toInt(), 0xFF2E7D4F.toInt(), 0xFFE4572E.toInt(), 0xFF6D4AE0.toInt(),
        0xFFD6336C.toInt(), 0xFF8B5E34.toInt(), 0xFF0E7C86.toInt(), 0xFF4B5563.toInt(),
    )

    fun make(context: Context, src: Loader.Source, doc: Doc, out: File) {
        val bitmap = when (src.kind) {
            Loader.Kind.PDF -> runCatching { pdfPage(src.file) }.getOrNull()
            Loader.Kind.EPUB -> doc.cover?.let { runCatching { decode(it) }.getOrNull() }
            Loader.Kind.TEXT -> null
        } ?: tile(doc.title)
        out.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 85, it) }
        bitmap.recycle()
    }

    private fun pdfPage(file: File): Bitmap {
        val pfd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
        val renderer = PdfRenderer(pfd)
        try {
            val page = renderer.openPage(0)
            try {
                val height = WIDTH * page.height / page.width.coerceAtLeast(1)
                val bmp = Bitmap.createBitmap(WIDTH, height.coerceIn(1, WIDTH * 2), Bitmap.Config.ARGB_8888)
                bmp.eraseColor(Color.WHITE)
                page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                return bmp
            } finally {
                page.close()
            }
        } finally {
            renderer.close()
            pfd.close()
        }
    }

    /** Saves a downloaded cover image as a thumbnail. */
    fun fromBytes(bytes: ByteArray, out: File) {
        val bitmap = decode(bytes) ?: error("not an image")
        out.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 85, it) }
        bitmap.recycle()
    }

    private fun decode(bytes: ByteArray): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        var sample = 1
        while (bounds.outWidth / (sample * 2) >= WIDTH) sample *= 2
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
    }

    /** A colored "book cover" with the title's initial, for documents without artwork. */
    private fun tile(title: String): Bitmap {
        val h = WIDTH * 4 / 3
        val bmp = Bitmap.createBitmap(WIDTH, h, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        canvas.drawColor(TILE_COLORS[(title.hashCode() and 0x7fffffff) % TILE_COLORS.size])
        val letter = title.trim().firstOrNull { it.isLetterOrDigit() }?.uppercaseChar()?.toString() ?: "¶"
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            textAlign = Paint.Align.CENTER
            typeface = Typeface.create(Typeface.SERIF, Typeface.BOLD)
            textSize = WIDTH * 0.5f
        }
        canvas.drawText(letter, WIDTH / 2f, h / 2f - (paint.descent() + paint.ascent()) / 2, paint)
        paint.color = 0x33FFFFFF
        canvas.drawRect(0f, h * 0.86f, WIDTH.toFloat(), h * 0.9f, paint)
        return bmp
    }

    /** Loads a thumbnail for display, scaled down to [widthPx]. */
    suspend fun load(file: File, widthPx: Int): Bitmap? = withContext(Dispatchers.IO) {
        if (!file.exists()) return@withContext null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.path, bounds)
        var sample = 1
        while (bounds.outWidth / (sample * 2) >= widthPx) sample *= 2
        BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample })
    }
}
