package com.paper2audio.app

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import android.net.Uri
import android.text.InputType
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.Toast
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/** Sending documents and passages out of the app: Send to Kindle, the file itself, notes, quote cards. */
object Sharing {
    private fun prefs(context: Context) = context.getSharedPreferences("p2a", Context.MODE_PRIVATE)

    private fun shareDir(context: Context) = File(context.cacheDir, "share").apply {
        // Only what's being shared now.
        listFiles()?.forEach { it.delete() }
        mkdirs()
    }

    private fun uriOf(context: Context, file: File): Uri =
        androidx.core.content.FileProvider.getUriForFile(context, "${context.packageName}.files", file)

    private fun safeName(title: String) = title.replace(Regex("""[\\/:*?"<>|\n\r]+"""), " ").trim().take(80).ifBlank { "Document" }

    private fun mimeOf(name: String) = when (name.substringAfterLast('.').lowercase()) {
        "pdf" -> "application/pdf"
        "epub" -> "application/epub+zip"
        "docx" -> "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        "html" -> "text/html"
        "png" -> "image/png"
        "md" -> "text/markdown"
        else -> "text/plain"
    }

    /**
     * A copy of [item]'s file named after its title, in a format Kindle accepts (PDF, EPUB, Word,
     * web page or text; anything else is sent as its text). Call off the main thread.
     */
    private fun fileFor(context: Context, item: Library.Item, forKindle: Boolean): File {
        if (!Library.hasFile(context, item)) Library.refetch(context, item)
        val src = Library.source(context, item).file
        val ext = when (item.kind) {
            Loader.Kind.PDF -> "pdf"
            Loader.Kind.EPUB -> "epub"
            Loader.Kind.DOCX -> "docx"
            Loader.Kind.HTML -> "html"
            Loader.Kind.TEXT -> "txt"
            Loader.Kind.MD -> if (forKindle) "txt" else "md"
            Loader.Kind.PPTX -> if (forKindle) "txt" else "pptx"
        }
        val out = File(shareDir(context), "${safeName(item.title)}.$ext")
        if (forKindle && item.kind == Loader.Kind.PPTX) {
            val doc = Opener.parse(context, item)
            out.writeText(doc.title + "\n\n" + doc.paragraphs.joinToString("\n\n"))
        } else {
            src.copyTo(out, overwrite = true)
        }
        return out
    }

    // ---- Send to Kindle ----

    fun sendToKindle(activity: Activity, scope: CoroutineScope, item: Library.Item) {
        val saved = prefs(activity).getString("kindleEmail", null)
        val options = arrayOf(
            if (saved != null) "Email it to my Kindle\n$saved" else "Email it to my Kindle\nYour …@kindle.com address (set it once)",
            "Send with the Kindle app\nUses Amazon's “Send to Kindle” in the share menu",
            "Change my Kindle address",
        )
        AlertDialog.Builder(activity)
            .setTitle("Send to Kindle")
            .setItems(options) { _, which ->
                when (which) {
                    0 -> if (saved == null) askKindleEmail(activity) { send(activity, scope, item, it) } else send(activity, scope, item, saved)
                    1 -> send(activity, scope, item, null)
                    2 -> askKindleEmail(activity) { send(activity, scope, item, it) }
                }
            }
            .show()
    }

    private fun askKindleEmail(activity: Activity, then: (String) -> Unit) {
        val input = EditText(activity).apply {
            hint = "yourname@kindle.com"
            inputType = InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
            isSingleLine = true
            setText(prefs(activity).getString("kindleEmail", ""))
        }
        val box = FrameLayout(activity).apply {
            val pad = (20 * activity.resources.displayMetrics.density).toInt()
            setPadding(pad, pad / 2, pad, 0)
            addView(input)
        }
        AlertDialog.Builder(activity)
            .setTitle("Your Kindle email address")
            .setMessage(
                "Find it on Amazon: Manage Your Content and Devices › Preferences › Personal Document Settings. " +
                    "Add the email address you'll send from to the Approved list there."
            )
            .setView(box)
            .setPositiveButton("Save") { _, _ ->
                val email = input.text.toString().trim()
                if (!email.contains('@')) {
                    Toast.makeText(activity, "That doesn't look like an email address", Toast.LENGTH_LONG).show()
                } else {
                    prefs(activity).edit().putString("kindleEmail", email).apply()
                    then(email)
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun send(activity: Activity, scope: CoroutineScope, item: Library.Item, email: String?) {
        scope.launch {
            try {
                val file = withContext(Dispatchers.IO) { fileFor(activity, item, forKindle = true) }
                val uri = uriOf(activity, file)
                val send = Intent(Intent.ACTION_SEND)
                    .setType(mimeOf(file.name))
                    .putExtra(Intent.EXTRA_STREAM, uri)
                    .putExtra(Intent.EXTRA_SUBJECT, item.title)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                if (email != null) {
                    send.putExtra(Intent.EXTRA_EMAIL, arrayOf(email))
                    // Offer email apps only.
                    send.selector = Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:"))
                }
                activity.startActivity(Intent.createChooser(send, if (email != null) "Email to your Kindle" else "Send to Kindle"))
            } catch (e: Exception) {
                AppLog.e("Share", "Send to Kindle failed", e)
                Toast.makeText(activity, e.message ?: "Couldn't prepare the file", Toast.LENGTH_LONG).show()
            }
        }
    }

    // ---- The file itself ----

    fun shareFile(activity: Activity, scope: CoroutineScope, item: Library.Item) {
        scope.launch {
            try {
                val file = withContext(Dispatchers.IO) { fileFor(activity, item, forKindle = false) }
                activity.startActivity(
                    Intent.createChooser(
                        Intent(Intent.ACTION_SEND).setType(mimeOf(file.name))
                            .putExtra(Intent.EXTRA_STREAM, uriOf(activity, file))
                            .putExtra(Intent.EXTRA_SUBJECT, item.title)
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),
                        "Share “${item.title}”",
                    )
                )
            } catch (e: Exception) {
                Toast.makeText(activity, e.message ?: "Couldn't prepare the file", Toast.LENGTH_LONG).show()
            }
        }
    }

    // ---- Highlights and notes ----

    /** Highlights, notes and bookmarks of [item] as Markdown, with the passages they belong to. */
    fun notesMarkdown(item: Library.Item, doc: Doc?): String {
        val notes = Library.notes(item)
        val sb = StringBuilder("# ").append(item.title).append('\n')
        item.author?.let { sb.append("*").append(it).append("*\n") }
        sb.append('\n')
        var lastChapter: String? = null
        for (n in notes) {
            val chapter = doc?.chapterAt(n.index)?.title
            if (chapter != null && chapter != lastChapter) {
                sb.append("## ").append(chapter).append("\n\n")
                lastChapter = chapter
            }
            val passage = doc?.paragraphs?.getOrNull(n.index)
            if (passage != null) sb.append("> ").append(passage.replace("\n", " ")).append("\n\n")
            val kind = when {
                n.color != null -> "Highlight (${n.color})"
                n.isBookmark -> "Bookmark"
                else -> "Note"
            }
            sb.append("- **").append(kind).append("**")
            if (n.text.isNotBlank()) sb.append(": ").append(n.text)
            sb.append("\n\n")
        }
        if (notes.isEmpty()) sb.append("No highlights, notes or bookmarks yet.\n")
        return sb.toString()
    }

    fun exportNotes(activity: Activity, scope: CoroutineScope, item: Library.Item) {
        scope.launch {
            try {
                val file = withContext(Dispatchers.IO) {
                    val doc = Speaker.doc?.takeIf { it.key == item.id } ?: runCatching { Opener.parse(activity, item) }.getOrNull()
                    File(shareDir(activity), "${safeName(item.title)} – notes.md").apply { writeText(notesMarkdown(item, doc)) }
                }
                activity.startActivity(
                    Intent.createChooser(
                        Intent(Intent.ACTION_SEND).setType("text/markdown")
                            .putExtra(Intent.EXTRA_STREAM, uriOf(activity, file))
                            .putExtra(Intent.EXTRA_TEXT, file.readText().take(60_000))
                            .putExtra(Intent.EXTRA_SUBJECT, "Notes: ${item.title}")
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),
                        "Export highlights and notes",
                    )
                )
            } catch (e: Exception) {
                Toast.makeText(activity, e.message ?: "Couldn't export the notes", Toast.LENGTH_LONG).show()
            }
        }
    }

    // ---- Quote cards ----

    /** A picture of [quote] (with the book's title and author) to share. */
    fun shareQuote(activity: Activity, quote: String, title: String, author: String?) {
        val w = 1080
        val h = 1350
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val bg = Paint().apply {
            shader = LinearGradient(0f, 0f, w.toFloat(), h.toFloat(), intArrayOf(0xFF1E4A3A.toInt(), 0xFF0E2A25.toInt(), 0xFF0B231F.toInt()), null, Shader.TileMode.CLAMP)
        }
        c.drawRect(0f, 0f, w.toFloat(), h.toFloat(), bg)
        val gold = 0xFFD4B26A.toInt()
        val cream = 0xFFF3EBDD.toInt()
        val serif = Themes.titleFont(activity)
        // Big opening quote mark.
        c.drawText("“", 90f, 330f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = gold; textSize = 300f; typeface = serif })
        val text = quote.trim().let { if (it.length > 600) it.take(597).substringBeforeLast(' ') + "…" else it }
        val size = when {
            text.length < 140 -> 64f
            text.length < 300 -> 52f
            else -> 42f
        }
        val tp = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { color = cream; textSize = size; typeface = serif }
        val layout = StaticLayout.Builder.obtain(text, 0, text.length, tp, w - 200)
            .setAlignment(Layout.Alignment.ALIGN_NORMAL).setLineSpacing(0f, 1.25f).build()
        c.save()
        c.translate(100f, 380f)
        layout.draw(c)
        c.restore()
        val small = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { color = gold; textSize = 40f; typeface = serif }
        val by = listOfNotNull(title.take(70), author).joinToString(" · ")
        c.drawRect(100f, h - 230f, 220f, h - 226f, Paint().apply { color = gold })
        c.drawText(by, 100f, h - 160f, small)
        c.drawText("Paper to Audio", 100f, h - 100f, TextPaint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x99F3EBDD.toInt(); textSize = 30f })
        val file = File(shareDir(activity), "quote.png")
        file.outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bmp.recycle()
        activity.startActivity(
            Intent.createChooser(
                Intent(Intent.ACTION_SEND).setType("image/png")
                    .putExtra(Intent.EXTRA_STREAM, uriOf(activity, file))
                    .putExtra(Intent.EXTRA_TEXT, "“$text” — $by")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),
                "Share quote",
            )
        )
    }
}
