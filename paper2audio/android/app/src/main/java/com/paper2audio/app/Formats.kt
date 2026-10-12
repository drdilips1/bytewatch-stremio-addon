package com.paper2audio.app

import android.content.Context
import android.net.Uri
import org.jsoup.Jsoup
import org.jsoup.nodes.Element
import org.jsoup.parser.Parser
import java.io.File
import java.io.RandomAccessFile

/**
 * More ebook formats, turned into ones the app already reads: Kindle books (MOBI, AZW, AZW3)
 * and FictionBook (FB2) become a web page; comic archives (CBZ) are read page by page with
 * text recognition.
 */
object Formats {
    /** If [file] (named [name]) is a Kindle or FictionBook file, rewrites it as HTML and returns the new name. */
    fun convert(file: File, name: String): String? {
        val head = ByteArray(1024)
        val n = file.inputStream().use { it.read(head) }.coerceAtLeast(0)
        val start = String(head, 0, n, Charsets.ISO_8859_1)
        val html = when {
            n >= 68 && start.substring(60, 68).let { it == "BOOKMOBI" || it == "TEXtREAd" } -> mobiToHtml(file)
            name.endsWith(".fb2", true) || "<FictionBook" in start -> fb2ToHtml(file)
            else -> return null
        }
        file.writeText(html)
        return name.substringBeforeLast('.') + ".html"
    }

    // ---- Kindle (MOBI / AZW / AZW3) ----

    private fun mobiToHtml(file: File): String = RandomAccessFile(file, "r").use { f ->
        fun u16(at: Long): Int { f.seek(at); return (f.read() shl 8) or f.read() }
        fun u32(at: Long): Long { f.seek(at); return (0 until 4).fold(0L) { acc, _ -> (acc shl 8) or f.read().toLong() } }
        val title = ByteArray(32).also { f.seek(0); f.readFully(it) }.toString(Charsets.ISO_8859_1).substringBefore('\u0000').replace('_', ' ')
        val count = u16(76)
        val offsets = LongArray(count) { u32(78L + it * 8) }
        fun record(i: Int): ByteArray {
            val end = if (i + 1 < count) offsets[i + 1] else f.length()
            val b = ByteArray((end - offsets[i]).toInt())
            f.seek(offsets[i])
            f.readFully(b)
            return b
        }
        val r0 = record(0)
        fun r0u16(at: Int) = ((r0[at].toInt() and 0xFF) shl 8) or (r0[at + 1].toInt() and 0xFF)
        fun r0u32(at: Int) = (0 until 4).fold(0L) { acc, k -> (acc shl 8) or (r0[at + k].toLong() and 0xFF) }
        val compression = r0u16(0)
        val textRecords = r0u16(8)
        if (r0u16(12) != 0) error("This Kindle book is copy-protected (DRM), so it can't be read. A DRM-free copy works.")
        if (compression == 17480) error("This Kindle book uses a compression the app can't read yet. Try an EPUB or PDF copy.")
        var utf8 = false
        var extraFlags = 0
        if (r0.size >= 32 && String(r0, 16, 4, Charsets.ISO_8859_1) == "MOBI") {
            val headerLength = r0u32(20).toInt()
            utf8 = r0u32(28) == 65001L
            if (headerLength >= 0xE4 && r0.size >= 0xF4) extraFlags = r0u16(0xF2)
        }
        val out = java.io.ByteArrayOutputStream()
        for (i in 1..textRecords.coerceAtMost(count - 1)) {
            val raw = record(i)
            val data = raw.copyOf(raw.size - trailing(raw, extraFlags))
            out.write(if (compression == 2) palmDoc(data) else data)
        }
        val text = String(out.toByteArray(), if (utf8) Charsets.UTF_8 else charset("windows-1252"))
            .replace(Regex("""<mbp:pagebreak\s*/?>""", RegexOption.IGNORE_CASE), "<hr>")
        if ("<html" in text.take(2000).lowercase()) text else "<html><head><title>$title</title></head><body>$text</body></html>"
    }

    /** Size of the extra entries Kindle appends to each text record (flags from the MOBI header). */
    private fun trailing(data: ByteArray, flags: Int): Int {
        var size = 0
        var f = flags shr 1
        while (f != 0) {
            if (f and 1 != 0) {
                var end = data.size - size
                var value = 0
                var shift = 0
                while (end > 0 && shift < 28) {
                    val v = data[end - 1].toInt() and 0xFF
                    value = value or ((v and 0x7F) shl shift)
                    shift += 7
                    end--
                    if (v and 0x80 != 0) break
                }
                size += value
            }
            f = f shr 1
        }
        if (flags and 1 != 0 && data.size - size - 1 >= 0) size += (data[data.size - size - 1].toInt() and 3) + 1
        return size.coerceIn(0, data.size)
    }

    /** PalmDOC compression (LZ77 with a space-prefix trick). */
    private fun palmDoc(data: ByteArray): ByteArray {
        var buf = ByteArray(maxOf(4096, data.size * 2))
        var n = 0
        fun put(b: Byte) {
            if (n == buf.size) buf = buf.copyOf(buf.size * 2)
            buf[n++] = b
        }
        var i = 0
        while (i < data.size) {
            val c = data[i++].toInt() and 0xFF
            when {
                c in 1..8 -> repeat(c) { if (i < data.size) put(data[i++]) }
                c <= 0x7F -> put(c.toByte())
                c >= 0xC0 -> {
                    put(' '.code.toByte())
                    put((c xor 0x80).toByte())
                }
                else -> {
                    if (i >= data.size) break
                    val pair = (c shl 8) or (data[i++].toInt() and 0xFF)
                    val dist = (pair shr 3) and 0x7FF
                    val len = (pair and 7) + 3
                    if (dist in 1..n) repeat(len) { put(buf[n - dist]) }
                }
            }
        }
        return buf.copyOf(n)
    }

    // ---- FictionBook (FB2) ----

    private fun fb2ToHtml(file: File): String {
        val xml = Jsoup.parse(file.inputStream(), null, "", Parser.xmlParser())
        val info = xml.selectFirst("description title-info")
        val title = info?.selectFirst("book-title")?.text().orEmpty()
        val author = info?.selectFirst("author")?.let { a ->
            listOf("first-name", "middle-name", "last-name").mapNotNull { a.selectFirst(it)?.text() }.joinToString(" ")
        }.orEmpty()
        val sb = StringBuilder("<html><head><title>").append(escape(title)).append("</title>")
        if (author.isNotBlank()) sb.append("<meta name=\"author\" content=\"").append(escape(author)).append("\">")
        sb.append("</head><body>")
        if (title.isNotBlank()) sb.append("<h1>").append(escape(title)).append("</h1>")
        // The main body (not the notes body).
        val body = xml.select("body").firstOrNull { it.attr("name") != "notes" } ?: xml.selectFirst("body")
        body?.children()?.forEach { appendFb2(it, sb, 2) }
        return sb.append("</body></html>").toString()
    }

    private fun appendFb2(e: Element, sb: StringBuilder, level: Int) {
        when (e.tagName()) {
            "section" -> e.children().forEach { appendFb2(it, sb, (level + 1).coerceAtMost(4)) }
            "title" -> sb.append("<h").append(level).append(">").append(escape(e.text())).append("</h").append(level).append(">")
            "p", "subtitle", "v", "text-author" -> sb.append("<p>").append(escape(e.text())).append("</p>")
            "epigraph", "cite", "poem", "stanza" -> e.children().forEach { appendFb2(it, sb, level) }
            "empty-line", "image" -> {}
            else -> if (e.text().isNotBlank()) sb.append("<p>").append(escape(e.text())).append("</p>")
        }
    }

    private fun escape(t: String) = t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")

    // ---- Comics (CBZ) ----

    private val IMAGE = Regex("""\.(jpe?g|png|webp|gif|bmp)$""", RegexOption.IGNORE_CASE)

    /** Whether [uri] (named [name]) is a comic archive: a zip of page images. */
    fun isComic(context: Context, uri: Uri, name: String?): Boolean {
        if (name?.endsWith(".cbz", true) == true) return true
        if (name?.endsWith(".zip", true) != true) return false
        return runCatching {
            context.contentResolver.openInputStream(uri)?.use { input ->
                java.util.zip.ZipInputStream(input).use { z ->
                    var images = 0
                    var others = 0
                    while (true) {
                        val e = z.nextEntry ?: break
                        if (e.isDirectory) continue
                        if (IMAGE.containsMatchIn(e.name)) images++ else others++
                    }
                    images > 0 && others <= 2
                }
            } ?: false
        }.getOrDefault(false)
    }

    /** Unpacks a comic's pages, in reading order, into the cache for text recognition. */
    fun comicPages(context: Context, uri: Uri): List<Uri> {
        val dir = File(context.cacheDir, "comic").apply {
            deleteRecursively()
            mkdirs()
        }
        val files = ArrayList<File>()
        context.contentResolver.openInputStream(uri)?.use { input ->
            java.util.zip.ZipInputStream(input).use { z ->
                while (true) {
                    val e = z.nextEntry ?: break
                    if (e.isDirectory || !IMAGE.containsMatchIn(e.name) || e.name.contains("__MACOSX")) continue
                    val out = File(dir, "%04d-".format(files.size) + e.name.substringAfterLast('/'))
                    out.outputStream().use { z.copyTo(it) }
                    files += out
                }
            }
        } ?: error("Could not open the file")
        if (files.isEmpty()) error("No pages found in that comic")
        // Page order by name, the way comic readers do it (1, 2, … 10).
        val natural = compareBy<File> { f -> f.name.substring(5).replace(Regex("""\d+""")) { it.value.padStart(8, '0') }.lowercase() }
        return files.sortedWith(natural).map { Uri.fromFile(it) }
    }
}
