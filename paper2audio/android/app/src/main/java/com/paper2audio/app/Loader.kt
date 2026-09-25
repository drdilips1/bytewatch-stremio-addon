package com.paper2audio.app

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/** Brings a document into app storage (so it survives restarts) and parses it. */
object Loader {
    enum class Kind { PDF, EPUB, TEXT, DOCX, HTML, MD }

    /** A document file in the library; [id] names its library entry. */
    data class Source(val file: File, val kind: Kind, val name: String, val id: String)

    private val ARXIV = Regex(
        """^(?:https?://(?:www\.)?arxiv\.org/(?:abs|pdf)/)?(\d{4}\.\d{4,5}(?:v\d+)?)(?:\.pdf)?/?$"""
    )

    fun importUri(context: Context, uri: Uri): Source {
        val cr = context.contentResolver
        var name: String? = null
        runCatching {
            cr.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) name = c.getString(0)
            }
        }
        val input = cr.openInputStream(uri) ?: error("Could not open the file")
        return store(context, name ?: uri.lastPathSegment ?: "document") { out ->
            input.use { it.copyTo(out) }
        }
    }

    fun download(context: Context, text: String): Source {
        val trimmed = text.trim()
        val arxiv = ARXIV.find(trimmed)
        var url = if (arxiv != null) "https://arxiv.org/pdf/${arxiv.groupValues[1]}" else trimmed
        require(url.startsWith("http://") || url.startsWith("https://")) {
            "Enter an arXiv ID (like 1706.03762) or a link starting with http"
        }
        // HttpURLConnection won't follow http -> https redirects on its own.
        repeat(5) {
            val conn = URL(url).openConnection() as HttpURLConnection
            conn.instanceFollowRedirects = false
            conn.connectTimeout = 20_000
            conn.readTimeout = 60_000
            conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36")
            val code = conn.responseCode
            if (code in 300..399) {
                url = URL(URL(url), conn.getHeaderField("Location") ?: error("Bad redirect")).toString()
                conn.disconnect()
                return@repeat
            }
            if (code !in 200..299) error("Download failed (HTTP $code)")
            val name = url.substringAfterLast('/').substringBefore('?').ifBlank { "download" }
            return store(context, name) { out -> conn.inputStream.use { it.copyTo(out) } }
        }
        error("Too many redirects")
    }

    private fun store(context: Context, name: String, write: (java.io.OutputStream) -> Unit): Source {
        val tmp = File(context.filesDir, "incoming.tmp")
        tmp.outputStream().use(write)
        val kind = sniff(tmp, name)
        val id = java.util.UUID.randomUUID().toString().replace("-", "").take(16)
        val dest = File(Library.dir(context).apply { mkdirs() }, "$id." + kind.name.lowercase())
        if (!tmp.renameTo(dest)) error("Could not save the file")
        return Source(dest, kind, name, id)
    }

    private fun sniff(file: File, name: String): Kind {
        val head = ByteArray(2048)
        val n = file.inputStream().use { it.read(head) }.coerceAtLeast(0)
        val start = String(head, 0, n, Charsets.ISO_8859_1)
        val lower = start.trimStart('\uFEFF', ' ', '\n', '\r', '\t').lowercase()
        return when {
            start.startsWith("%PDF") -> Kind.PDF
            start.startsWith("PK") -> runCatching {
                java.util.zip.ZipFile(file).use { z -> if (z.getEntry("word/document.xml") != null) Kind.DOCX else Kind.EPUB }
            }.getOrDefault(Kind.EPUB)
            name.endsWith(".pdf", true) -> Kind.PDF
            name.endsWith(".md", true) || name.endsWith(".markdown", true) -> Kind.MD
            lower.startsWith("<!doctype html") || lower.startsWith("<html") || "<html" in lower.take(600) -> Kind.HTML
            name.endsWith(".html", true) || name.endsWith(".htm", true) -> Kind.HTML
            else -> Kind.TEXT
        }
    }

    /** Saves pasted text (or recognized text from scans) as a new document. */
    fun storeText(context: Context, title: String, text: String, ext: String = "txt"): Source {
        val safe = title.replace(Regex("""[\\/:*?"<>|]+"""), " ").trim().ifBlank { "Pasted text" }
        return store(context, "$safe.$ext") { it.write(text.toByteArray()) }
    }

    /** Recognized text of a scanned PDF, kept next to it. */
    fun ocrFile(pdf: File) = File(pdf.path.substringBeforeLast('.') + ".ocr.txt")

    fun parse(context: Context, src: Source, o: CleanOptions): Doc {
        val key = src.id
        val title = src.name.substringBeforeLast('.')
        return when (src.kind) {
            Kind.PDF -> {
                // Scanned PDFs: use the text recognized from the page images, if any.
                val ocr = ocrFile(src.file)
                if (ocr.exists()) {
                    val pdfTitle = runCatching { PdfExtractor.extract(context, src.file, o, title, key).title }.getOrDefault(title)
                    Doc.build(pdfTitle, key, listOf(null to TextCleaner.clean(ocr.readLines(), o)))
                } else {
                    PdfExtractor.extract(context, src.file, o, title, key)
                }
            }
            Kind.EPUB -> EpubExtractor.extract(src.file, o, title, key)
            Kind.DOCX -> DocxExtractor.extract(src.file, o, title, key)
            Kind.HTML -> HtmlExtractor.extract(src.file, o, title, key)
            Kind.MD -> MarkdownExtractor.extract(src.file, o, title, key)
            Kind.TEXT -> Doc.build(title, key, listOf(null to TextCleaner.clean(src.file.readLines(), o)))
        }
    }
}
