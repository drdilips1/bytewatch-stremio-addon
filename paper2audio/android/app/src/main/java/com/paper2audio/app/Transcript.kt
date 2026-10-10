package com.paper2audio.app

import android.content.ContentValues
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import java.io.File
import java.io.OutputStream

/**
 * The text exactly as it is read aloud (cleaned, with sections, and with AI figure
 * explanations when they're on), saved as plain text, Markdown or PDF.
 */
object Transcript {
    enum class Format(val label: String, val ext: String, val mime: String) {
        TXT("Text (.txt)", "txt", "text/plain"),
        MD("Markdown with headings (.md)", "md", "text/markdown"),
        PDF("PDF", "pdf", "application/pdf"),
    }

    /** A heading or a paragraph. */
    private class Block(val text: String, val heading: Boolean)

    private fun blocks(doc: Doc, leaveOut: Set<String>): List<Block> {
        val out = ArrayList<Block>()
        val starts = doc.chapters.associateBy { it.start }
        var skipping = false
        // From where reading starts: a book's cover, copyright and similar pages aren't read.
        for (i in doc.start until doc.paragraphs.size) {
            val p = doc.paragraphs[i]
            val ch = starts[i] ?: doc.chapterAt(i).takeIf { i == doc.start }
            if (ch != null) {
                skipping = ch.title in leaveOut
                if (!skipping) out += Block(ch.title, true)
                // The heading is often also the chapter's first paragraph.
                if (p.trim().trimEnd('.', ':').equals(ch.title.trim().trimEnd('.', ':'), ignoreCase = true)) continue
            }
            if (!skipping) out += Block(p, false)
        }
        return out
    }

    fun text(doc: Doc, format: Format, leaveOut: Set<String>): String = buildString {
        val md = format == Format.MD
        append(if (md) "# ${doc.title}\n\n" else "${doc.title}\n")
        val author = doc.author
        if (author != null) append(if (md) "*$author*\n\n" else "$author\n\n") else if (!md) append('\n')
        for (b in blocks(doc, leaveOut)) {
            when {
                b.heading && md -> append("\n## ").append(b.text).append("\n\n")
                b.heading -> append('\n').append(b.text.uppercase()).append("\n\n")
                else -> append(b.text).append("\n\n")
            }
        }
    }.trimEnd() + "\n"

    /** Writes an A4 PDF with the title, headings, paragraphs and page numbers. */
    fun pdf(doc: Doc, leaveOut: Set<String>, out: OutputStream) {
        val pageW = 595
        val pageH = 842
        val margin = 56
        val width = pageW - 2 * margin
        val body = TextPaint(TextPaint.ANTI_ALIAS_FLAG).apply { textSize = 11f; color = Color.BLACK; typeface = Typeface.SERIF }
        val head = TextPaint(body).apply { textSize = 14f; typeface = Typeface.create(Typeface.SERIF, Typeface.BOLD) }
        val title = TextPaint(body).apply { textSize = 20f; typeface = Typeface.create(Typeface.SERIF, Typeface.BOLD) }
        val small = TextPaint(body).apply { textSize = 9f; color = Color.GRAY; typeface = Typeface.SANS_SERIF }
        val italic = TextPaint(body).apply { typeface = Typeface.create(Typeface.SERIF, Typeface.ITALIC) }

        val pdf = PdfDocument()
        var pageNo = 0
        var page: PdfDocument.Page? = null
        var y = 0f
        fun newPage() {
            page?.let { pdf.finishPage(it) }
            pageNo++
            page = pdf.startPage(PdfDocument.PageInfo.Builder(pageW, pageH, pageNo).create())
            page!!.canvas.drawText("$pageNo", pageW / 2f - small.measureText("$pageNo") / 2, pageH - 30f, small)
            y = margin.toFloat()
        }
        fun layout(text: String, paint: TextPaint): StaticLayout =
            StaticLayout.Builder.obtain(text, 0, text.length, paint, width)
                .setAlignment(Layout.Alignment.ALIGN_NORMAL).setLineSpacing(0f, 1.15f).build()
        /** Draws line by line, so long paragraphs continue on the next page. */
        fun draw(text: String, paint: TextPaint, before: Float, after: Float, keepWithNext: Boolean = false) {
            val l = layout(text, paint)
            y += before
            val bottom = pageH - margin - 10f
            if (y + (if (keepWithNext) l.height + 40 else l.getLineBottom(0)) > bottom) newPage()
            for (line in 0 until l.lineCount) {
                val top = l.getLineTop(line)
                val h = l.getLineBottom(line) - top
                if (y + h > bottom) newPage()
                val c = page!!.canvas
                c.save()
                c.translate(margin.toFloat(), y - top)
                c.clipRect(0, top, width, top + h)
                l.draw(c)
                c.restore()
                y += h
            }
            y += after
        }

        try {
            newPage()
            draw(doc.title, title, 0f, 6f)
            doc.author?.let { draw(it, italic, 0f, 10f) }
            for (b in blocks(doc, leaveOut)) {
                if (b.heading) draw(b.text, head, 12f, 6f, keepWithNext = true) else draw(b.text, body, 0f, 7f)
            }
            page?.let { pdf.finishPage(it) }
            pdf.writeTo(out)
        } finally {
            pdf.close()
        }
    }

    /** Saves to Downloads/<app name>; returns the file to open or share. */
    fun save(context: Context, doc: Doc, format: Format, leaveOut: Set<String>): Uri {
        val write: (OutputStream) -> Unit = { out ->
            if (format == Format.PDF) pdf(doc, leaveOut, out) else out.write(text(doc, format, leaveOut).toByteArray())
        }
        return Downloads.save(context, "${doc.title} - transcript", format.ext, format.mime, write)
    }
}

/** The folder in Downloads that saved files (audio, text) go into: the app's name. */
object Brand {
    fun folder(context: Context): String =
        if (!BuildConfig.LITE) "Paper2Audio"
        else context.getString(R.string.app_name).replace(Regex("[^A-Za-z0-9]+"), "").ifEmpty { "Audiobooks" }
}

/** Files in Downloads/<app name>, visible in the Files app. */
object Downloads {
    fun save(context: Context, name: String, ext: String, mime: String, write: (OutputStream) -> Unit): Uri {
        val safe = name.replace(Regex("""[\\/:*?"<>|]+"""), " ").take(90).trim().ifEmpty { "Paper2Audio" }
        if (Build.VERSION.SDK_INT >= 29) {
            val cr = context.contentResolver
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, "$safe.$ext")
                put(MediaStore.Downloads.MIME_TYPE, mime)
                put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/" + Brand.folder(context))
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val uri = cr.insert(MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), values)
                ?: error("Couldn't create the file")
            try {
                cr.openOutputStream(uri)?.use(write) ?: error("Couldn't write the file")
                cr.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
            } catch (e: Exception) {
                runCatching { cr.delete(uri, null, null) }
                throw e
            }
            return uri
        }
        val dir = File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), Brand.folder(context)).apply { mkdirs() }
        val f = File(dir, "$safe.$ext")
        f.outputStream().use(write)
        return androidx.core.content.FileProvider.getUriForFile(context, "${context.packageName}.files", f)
    }
}
