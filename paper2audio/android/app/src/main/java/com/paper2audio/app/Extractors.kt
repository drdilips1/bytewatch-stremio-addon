package com.paper2audio.app

import android.content.Context
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.text.PDFTextStripper
import org.jsoup.Jsoup
import org.jsoup.nodes.Document
import org.jsoup.nodes.Element
import org.jsoup.nodes.Node
import org.jsoup.nodes.TextNode
import org.jsoup.parser.Parser
import org.jsoup.select.NodeTraversor
import org.jsoup.select.NodeVisitor
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.zip.ZipFile

object PdfExtractor {
    fun extract(context: Context, file: File, o: CleanOptions, name: String, key: String): Doc {
        PDFBoxResourceLoader.init(context.applicationContext)
        PDDocument.load(file).use { pdf ->
            val stripper = PDFTextStripper()
            stripper.setParagraphEnd("\n\n")
            val pages = (1..pdf.numberOfPages).map { i ->
                stripper.setStartPage(i)
                stripper.setEndPage(i)
                stripper.getText(pdf).split('\n').map { it.trimEnd('\r') } + ""
            }
            val repeated = TextCleaner.repeatedLines(pages)
            val lines = pages.flatten().filter { line ->
                val key0 = TextCleaner.norm(line)
                !(key0.isNotEmpty() && key0 in repeated) && !TextCleaner.PAGE_NUM.containsMatchIn(line)
            }
            val title = pdf.documentInformation?.title?.takeIf { it.isNotBlank() }
                ?: lines.firstOrNull { it.trim().length > 8 }?.trim()
                ?: name
            return Doc.build(title, key, listOf(null to TextCleaner.clean(lines, o)))
        }
    }
}

/** Reads EPUBs in spine order, one section per chapter, dropping footnotes and front matter. */
object EpubExtractor {
    private val BLOCK = setOf(
        "p", "div", "section", "article", "blockquote", "li", "tr", "br", "hr",
        "h1", "h2", "h3", "h4", "h5", "h6", "pre", "figcaption", "dd", "dt",
    )
    private val HEADINGS = setOf("h1", "h2", "h3", "h4", "h5", "h6")
    private val NOTE_TYPES = setOf("footnote", "endnote", "rearnote", "note", "noteref", "pagebreak")
    private val SKIP_CHAPTER = Regex(
        """^\s*(table of contents|contents|copyright|index|list of (figures|tables|illustrations))\s*$""",
        RegexOption.IGNORE_CASE,
    )
    private val WS = Regex("""\s+""")

    fun extract(file: File, o: CleanOptions, name: String, key: String): Doc {
        ZipFile(file).use { zip ->
            fun read(path: String): String? =
                zip.getEntry(path)?.let { e -> zip.getInputStream(e).use { it.readBytes().toString(Charsets.UTF_8) } }

            val container = Jsoup.parse(read("META-INF/container.xml") ?: error("Not a valid EPUB"), "", Parser.xmlParser())
            val opfPath = container.tags("rootfile").firstOrNull()?.attr("full-path")
                ?: error("Not a valid EPUB")
            val opf = Jsoup.parse(read(opfPath) ?: error("Not a valid EPUB"), "", Parser.xmlParser())
            val base = opfPath.substringBeforeLast('/', "")
            val title = opf.tags("title").firstOrNull { it.text().isNotBlank() }?.text()?.trim() ?: name
            val manifest = opf.tags("item").associateBy { it.attr("id") }

            val sections = ArrayList<Pair<String?, List<String>>>()
            var part = 0
            for (ref in opf.tags("itemref")) {
                val item = manifest[ref.attr("idref")] ?: continue
                if (ref.attr("linear") == "no") continue
                if ("nav" in item.attr("properties").split(' ')) continue
                if ("html" !in item.attr("media-type")) continue
                val html = read(resolve(base, item.attr("href"))) ?: continue
                val (heading, lines) = chapterLines(html)
                part++
                val chapter = heading ?: "Part $part"
                if (SKIP_CHAPTER.containsMatchIn(chapter) || lines.none { it.isNotBlank() }) continue
                if (o.skipReferences && (TextCleaner.END_SECTION.containsMatchIn(chapter) ||
                        TextCleaner.NOTES.containsMatchIn(chapter))) continue
                if (o.skipAcknowledgements && TextCleaner.ACK.containsMatchIn(chapter)) continue
                if (o.skipAppendix && TextCleaner.APPENDIX.containsMatchIn(chapter)) continue
                sections += chapter to TextCleaner.clean(lines, o)
            }
            return Doc.build(title, key, sections)
        }
    }

    private fun Document.tags(name: String): List<Element> =
        allElements.toList().filter { it.tagName() == name || it.tagName().endsWith(":$name") }

    private fun resolve(base: String, href: String): String {
        val path = percentDecode(href.substringBefore('#'))
        val parts = ArrayList<String>()
        for (seg in (if (base.isEmpty()) path else "$base/$path").split('/')) {
            when (seg) {
                "", "." -> Unit
                ".." -> if (parts.isNotEmpty()) parts.removeAt(parts.size - 1)
                else -> parts += seg
            }
        }
        return parts.joinToString("/")
    }

    private fun percentDecode(s: String): String {
        if ('%' !in s) return s
        val out = ByteArrayOutputStream()
        var i = 0
        while (i < s.length) {
            val c = s[i]
            if (c == '%' && i + 2 < s.length) {
                val v = s.substring(i + 1, i + 3).toIntOrNull(16)
                if (v != null) {
                    out.write(v)
                    i += 3
                    continue
                }
            }
            out.write(c.toString().toByteArray(Charsets.UTF_8))
            i++
        }
        return out.toString("UTF-8")
    }

    private fun chapterLines(html: String): Pair<String?, List<String>> {
        val doc = Jsoup.parse(html)
        // <sup> is almost always a footnote number in e-books.
        doc.select("script, style, svg, math, nav, table, sup").remove()
        doc.allElements.toList().filter { el ->
            val types = el.attr("epub:type").ifBlank { el.attr("role") }.replace("doc-", "").split(' ')
            types.any { it in NOTE_TYPES }
        }.forEach { if (it.parent() != null) it.remove() }

        val lines = ArrayList<String>()
        val buf = StringBuilder()
        var heading: String? = null
        fun flush() {
            val t = WS.replace(buf, " ").trim()
            buf.setLength(0)
            if (t.isNotEmpty()) {
                lines += t
                lines += ""
            }
        }
        NodeTraversor.traverse(object : NodeVisitor {
            override fun head(node: Node, depth: Int) {
                when (node) {
                    is TextNode -> buf.append(node.wholeText)
                    is Element -> {
                        val tag = node.normalName()
                        if (tag in BLOCK) flush()
                        if (heading == null && tag in HEADINGS) {
                            heading = WS.replace(node.text(), " ").trim().ifEmpty { null }
                        }
                    }
                }
            }

            override fun tail(node: Node, depth: Int) {
                if (node is Element && node.normalName() in BLOCK) flush()
            }
        }, doc.body())
        flush()
        return heading to lines
    }
}
