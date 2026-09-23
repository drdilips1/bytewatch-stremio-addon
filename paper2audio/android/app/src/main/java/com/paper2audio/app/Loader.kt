package com.paper2audio.app

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/** Brings a document into app storage (so it survives restarts) and parses it. */
object Loader {
    enum class Kind { PDF, EPUB, TEXT }

    data class Source(val file: File, val kind: Kind, val name: String)

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
            conn.setRequestProperty("User-Agent", "Paper2Audio-Android/1.0")
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
        val dest = File(context.filesDir, "current." + kind.name.lowercase())
        context.filesDir.listFiles { f -> f.name.startsWith("current.") }?.forEach { it.delete() }
        if (!tmp.renameTo(dest)) error("Could not save the file")
        return Source(dest, kind, name)
    }

    private fun sniff(file: File, name: String): Kind {
        val head = ByteArray(4)
        val n = file.inputStream().use { it.read(head) }
        return when {
            n >= 4 && String(head, Charsets.ISO_8859_1) == "%PDF" -> Kind.PDF
            n >= 2 && head[0] == 'P'.code.toByte() && head[1] == 'K'.code.toByte() -> Kind.EPUB
            name.endsWith(".pdf", true) -> Kind.PDF
            else -> Kind.TEXT
        }
    }

    fun parse(context: Context, src: Source, o: CleanOptions): Doc {
        val key = "${src.name}:${src.file.length()}"
        val title = src.name.substringBeforeLast('.')
        return when (src.kind) {
            Kind.PDF -> PdfExtractor.extract(context, src.file, o, title, key)
            Kind.EPUB -> EpubExtractor.extract(src.file, o, title, key)
            Kind.TEXT -> Doc.build(title, key, listOf(null to TextCleaner.clean(src.file.readLines(), o)))
        }
    }
}
