package com.paper2audio.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.io.File

/**
 * On-device text recognition (Google ML Kit) for photos, screenshots, camera
 * scans and scanned PDFs. Nothing is uploaded. Call everything off the main thread.
 */
object Ocr {
    private val PAGE_NUMBER = Regex("""^\s*(page\s*)?\d{1,4}\s*$""", RegexOption.IGNORE_CASE)

    /** Recognizes the text of several images, in order, one page per image. */
    fun images(context: Context, uris: List<Uri>, progress: (String) -> Unit): String {
        val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        try {
            return uris.mapIndexed { i, uri ->
                if (uris.size > 1) progress("Reading image ${i + 1} of ${uris.size}…")
                toLines(Tasks.await(recognizer.process(InputImage.fromFilePath(context, uri))))
            }.filter { it.isNotBlank() }.joinToString("\n\n")
        } finally {
            recognizer.close()
        }
    }

    /**
     * Recognizes the text of the given [pages] (1-based) of a PDF, rendering each
     * page as an image. Returns page number to text; pages without text are left out.
     */
    fun pdfPages(file: File, pages: List<Int>, progress: (String) -> Unit): Map<Int, String> {
        val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        val pfd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
        val renderer = PdfRenderer(pfd)
        val out = LinkedHashMap<Int, String>()
        try {
            for ((n, pageNo) in pages.withIndex()) {
                if (pageNo < 1 || pageNo > renderer.pageCount) continue
                progress("Reading scanned page ${n + 1} of ${pages.size}…")
                val bmp = renderer.openPage(pageNo - 1).use { page ->
                    // About 200 dpi for a letter-size page: sharp enough for small print.
                    val width = 1700
                    val height = (width.toLong() * page.height / page.width.coerceAtLeast(1)).toInt().coerceIn(1, width * 3)
                    Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).also {
                        it.eraseColor(Color.WHITE)
                        page.render(it, null, null, PdfRenderer.Page.RENDER_MODE_FOR_PRINT)
                    }
                }
                val text = try {
                    toLines(Tasks.await(recognizer.process(InputImage.fromBitmap(bmp, 0))))
                } finally {
                    bmp.recycle()
                }
                if (text.isNotBlank()) out[pageNo] = text
            }
        } finally {
            renderer.close()
            pfd.close()
            recognizer.close()
        }
        return out
    }

    /** One line per recognized line, with a blank line between blocks (paragraphs). */
    private fun toLines(text: Text): String = text.textBlocks
        .filterNot { PAGE_NUMBER.matches(it.text) }
        .joinToString("\n\n") { block -> block.lines.joinToString("\n") { it.text } }
}
