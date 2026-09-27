package com.paper2audio.app

import android.content.Context
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.text.PDFTextStripper
import com.tom_roush.pdfbox.text.TextPosition
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

/**
 * Reads PDFs with their structure: the title (largest text on page 1), authors,
 * section headings (larger or bold lines, numbered headings, and the usual
 * section names), figure and table captions with their pages, and without
 * running headers/footers, page numbers and publisher banners. Pages that are
 * scans use the text recognized from them ([ocrPages], page number to text).
 */
object PdfExtractor {
    /** One line of text with its font size and whether it is all bold. */
    class Line(val text: String, val size: Float, val bold: Boolean, val page: Int) {
        val blank get() = text.isBlank()
    }

    private val KNOWN_HEADING = Regex(
        """^(?:\d+(?:\.\d+)*\.?\s*|[IVX]+\.\s*)?(abstract|summary|introduction|background|methods?|materials and methods|methodology|patients and methods|study design|results?|findings|discussion|limitations?|strengths and limitations|conclusions?|concluding remarks|references|bibliography|acknowledge?ments?|appendix|supplementary material|funding|conflicts? of interest|declarations?|keywords?)\s*:?$""",
        RegexOption.IGNORE_CASE,
    )
    private val NUMBERED_HEADING = Regex("""^(?:\d{1,2}(?:\.\d{1,2}){0,3}\.?|[IVX]{1,4}\.)\s+[A-Z][^.!?]{2,90}$""")
    private val CAPTION = Regex("""^\s*((?:Figure|Fig\.|Table|Supplementary (?:Figure|Table))\s*S?\d+[a-z]?)\s*[.:|—-]?\s*(.*)$""", RegexOption.IGNORE_CASE)

    /** Publisher banners and boilerplate that shouldn't be read. */
    private val JUNK = Regex(
        """(?i)(downloaded from|all rights reserved|©|\(c\)\s*\d{4}|copyright|creative commons|doi:\s*10\.|https?://doi|\bissn\b|e-?mail:|@\w+\.\w|orcid|corresponding author|^\s*(?:received|accepted|revised|published)\b[^a-z]{0,3}(?:\d{1,2}\s+[A-Z][a-z]+|[A-Z][a-z]+\s+\d{1,2}|\d{4})|published online|this article is protected|for personal use|licen[cs]ed under|www\.|\bpage \d+ of \d+\b|\bvol\.\s*\d+|\bpp\.\s*\d)""",
    )

    fun extract(context: Context, file: File, o: CleanOptions, name: String, key: String, ocrPages: Map<Int, String> = emptyMap()): Doc {
        PDFBoxResourceLoader.init(context.applicationContext)
        PDDocument.load(file).use { pdf ->
            val pages = readLines(pdf).mapIndexed { i, lines ->
                ocrPages[i + 1]?.let { text -> text.lines().map { Line(it, 0f, false, i + 1) } + Line("", 0f, false, i + 1) } ?: lines
            }
            val info = pdf.documentInformation
            return build(pages, o, name, key, info?.title, info?.author, pdf.numberOfPages)
        }
    }

    /** Words on each page, to find scanned pages that need text recognition. */
    fun wordsPerPage(context: Context, file: File): List<Int> {
        PDFBoxResourceLoader.init(context.applicationContext)
        PDDocument.load(file).use { pdf ->
            val stripper = PDFTextStripper()
            return (1..pdf.numberOfPages).map { i ->
                stripper.startPage = i
                stripper.endPage = i
                stripper.getText(pdf).split(Regex("""\s+""")).count { w -> w.count { it.isLetter() } >= 2 }
            }
        }
    }

    internal fun readLines(pdf: PDDocument): List<List<Line>> {
        val out = ArrayList<List<Line>>()
        for (i in 1..pdf.numberOfPages) {
            val lines = ArrayList<Line>()
            val stripper = object : PDFTextStripper() {
                val sb = StringBuilder()
                var maxSize = 0f
                var chars = 0
                var boldChars = 0

                override fun writeString(text: String, textPositions: MutableList<TextPosition>) {
                    sb.append(text)
                    for (tp in textPositions) {
                        val size = maxOf(tp.fontSizeInPt, tp.heightDir)
                        if (!tp.unicode.isNullOrBlank()) {
                            if (size > maxSize) maxSize = size
                            chars++
                            val font = runCatching { tp.font?.name }.getOrNull().orEmpty()
                            if ("Bold" in font || "bold" in font || "Black" in font || "Heavy" in font || font.endsWith(",B")) boldChars++
                        }
                    }
                }

                override fun writeWordSeparator() {
                    sb.append(' ')
                }

                override fun writeLineSeparator() = flush()

                override fun writeParagraphEnd() {
                    flush()
                    if (lines.lastOrNull()?.blank == false) lines += Line("", 0f, false, i)
                }

                fun flush() {
                    val t = sb.toString().trim()
                    if (t.isNotEmpty()) lines += Line(t, (maxSize * 2).toInt() / 2f, chars > 0 && boldChars >= chars * 0.8, i)
                    sb.setLength(0)
                    maxSize = 0f
                    chars = 0
                    boldChars = 0
                }
            }
            // Content order, not position: position sorting mixes the lines of two-column papers.
            stripper.sortByPosition = false
            stripper.startPage = i
            stripper.endPage = i
            stripper.getText(pdf)
            stripper.flush()
            lines += Line("", 0f, false, i)
            out += lines
        }
        return out
    }

    /** Turns the lines of all pages into a structured document. */
    internal fun build(
        pages: List<List<Line>>,
        o: CleanOptions,
        name: String,
        key: String,
        infoTitle: String?,
        infoAuthor: String?,
        pageCount: Int,
    ): Doc {
        // Running headers/footers and page numbers.
        val repeated = TextCleaner.repeatedLines(pages.map { p -> p.map { it.text } })
        val all = pages.flatten().filter { l ->
            val k = TextCleaner.norm(l.text)
            l.blank || !(k.isNotEmpty() && k in repeated) && !TextCleaner.PAGE_NUM.containsMatchIn(l.text) &&
                !(l.text.length < 160 && JUNK.containsMatchIn(l.text))
        }
        // The body text size: the size most characters are set in.
        val bySize = HashMap<Float, Int>()
        for (l in all) if (!l.blank && l.size > 0f) bySize[l.size] = (bySize[l.size] ?: 0) + l.text.length
        val body = bySize.maxByOrNull { it.value }?.key ?: 0f

        // Title: the largest text near the top of page 1 (consecutive lines of that size).
        val first = all.filter { it.page == 1 && !it.blank }.take(25)
        val titleSize = first.maxOfOrNull { it.size } ?: 0f
        val titleLines = if (body > 0f && titleSize >= body * 1.25f) {
            first.dropWhile { it.size < titleSize - 0.5f }.takeWhile { it.size >= titleSize - 0.5f }
        } else emptyList()
        val detectedTitle = titleLines.joinToString(" ") { it.text }.takeIf { it.length in 8..300 }
        val title = infoTitle?.takeIf { it.isNotBlank() && it.length > 5 && !it.endsWith(".doc") && !it.startsWith("Microsoft") }
            ?: detectedTitle
            ?: all.firstOrNull { it.text.trim().length > 8 }?.text?.trim()
            ?: name
        val author = infoAuthor?.takeIf { it.isNotBlank() } ?: authorsAfter(first, titleLines)

        fun isHeading(l: Line, strict: Boolean): Boolean {
            val t = l.text.trim()
            if (t.length < 3 || t.length > 110 || t.count { it.isLetter() } < t.length * 0.5) return false
            if (KNOWN_HEADING.matches(t)) return true
            if (t.endsWith(",") || t.endsWith(";") || CAPTION.matches(t)) return false
            if (strict) return NUMBERED_HEADING.matches(t) && (l.bold || l.size > body)
            if (body > 0f && l.size >= body * 1.15f && !t.endsWith(".")) return true
            if (l.bold && l.size >= body * 0.95f && t.length < 80 && !t.endsWith(".")) return true
            return NUMBERED_HEADING.matches(t) && (l.bold || l.size > body)
        }

        // Captions, with their pages.
        val figures = ArrayList<Figure>()
        for ((i, l) in all.withIndex()) {
            val m = CAPTION.find(l.text) ?: continue
            if (!CAPTION.matches(l.text.trim()) || l.text.length > 400) continue
            val label = m.groupValues[1].replace(Regex("""(?i)^fig\.""" ), "Figure").replace(Regex("""\s+"""), " ")
            if (figures.any { it.label.equals(label, true) }) continue
            val more = all.drop(i + 1).takeWhile { !it.blank }.take(3).joinToString(" ") { it.text }
            figures += Figure(label, (m.groupValues[2] + " " + more).trim().take(300), l.page)
        }

        // Sections: a heading starts a new one; the title lines aren't body text.
        val sections = ArrayList<Pair<String?, List<String>>>()
        var heading: String? = null
        var buf = ArrayList<String>()
        var stop = false
        var skipping = false
        fun flush() {
            if (!skipping) {
                val paras = TextCleaner.clean(buf, o)
                if (paras.isNotEmpty()) sections += heading to (if (heading != null) listOf(heading!!) + paras else paras)
            }
            buf = ArrayList()
        }
        val titleSet = titleLines.toSet()
        // Lots of bold or large lines that aren't recognizable headings means they're emphasis
        // inside paragraphs (or a magazine layout): then only trust named and numbered headings.
        val loose = all.count { !it.blank && isHeading(it, false) && !isHeading(it, true) }
        val strict = loose > 8 && loose > all.count { !it.blank } / 25
        // Page-1 front matter before the first heading (authors, affiliations, emails) isn't read,
        // except real paragraphs, like an abstract without a heading.
        val firstHeading = all.indexOfFirst { !it.blank && it !in titleSet && isHeading(it, strict) }
        val front = if (firstHeading > 0 && all[firstHeading].page <= 2) {
            val blocks = ArrayList<MutableList<Line>>()
            for (l in all.subList(0, firstHeading)) {
                if (l.blank) blocks += ArrayList<Line>() else (blocks.lastOrNull() ?: ArrayList<Line>().also { blocks += it }).add(l)
            }
            blocks.filter { b -> b.sumOf { it.text.split(' ').size } < 25 }.flatten().toSet()
        } else emptySet()
        for (l in all) {
            if (stop) break
            if (l in titleSet || l in front) continue
            if (!l.blank && isHeading(l, strict)) {
                val t = l.text.trim().trimEnd(':')
                val kind = Sections.kindOf(t)
                flush()
                if (o.skipReferences && (kind == "References" || TextCleaner.END_SECTION.matches(t))) {
                    stop = true
                    break
                }
                if (o.skipAppendix && TextCleaner.APPENDIX.containsMatchIn(t)) {
                    stop = true
                    break
                }
                skipping = o.skipAcknowledgements && TextCleaner.ACK.containsMatchIn(t) ||
                    Regex("""(?i)^(funding|conflicts? of interest|declarations?|keywords?)""").containsMatchIn(t)
                heading = t
                continue
            }
            buf += l.text
        }
        if (!stop) flush()

        val withTitle = listOf<Pair<String?, List<String>>>(null to listOf(title)) + sections
        return Doc.build(title, key, withTitle, author, pages = pageCount, figures = figures)
    }

    /** Author names: short lines of capitalized names right after the title, before affiliations. */
    private fun authorsAfter(first: List<Line>, titleLines: List<Line>): String? {
        if (titleLines.isEmpty()) return null
        val after = first.dropWhile { it !in titleLines }.drop(titleLines.size).take(4)
        val line = after.firstOrNull { l ->
            val t = l.text
            t.length in 5..250 && !JUNK.containsMatchIn(t) &&
                !Regex("""(?i)(universit|department|institute|hospital|college|school|abstract|\d{5})""").containsMatchIn(t) &&
                Regex("""[A-Z][a-z]+\s+[A-Z]""").containsMatchIn(t) && t.count { it == '.' } <= t.count { it == ',' } + 3
        } ?: return null
        return line.text.replace(Regex("""[\d*†‡§¶#]+"""), "").replace(Regex("""\s+,"""), ",")
            .replace(Regex("""\s{2,}"""), " ").trim().trimEnd(',').ifBlank { null }
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
            val author = opf.tags("creator").firstOrNull { it.text().isNotBlank() }?.text()?.trim()
            val manifest = opf.tags("item").associateBy { it.attr("id") }
            val coverItem = manifest.values.firstOrNull { "cover-image" in it.attr("properties").split(' ') }
                ?: opf.tags("meta").firstOrNull { it.attr("name") == "cover" }?.let { manifest[it.attr("content")] }
                ?: manifest.values.firstOrNull { it.attr("media-type").startsWith("image/") && "cover" in it.attr("id").lowercase() }
            val cover = coverItem?.let { item ->
                zip.getEntry(resolve(base, item.attr("href")))?.let { e -> zip.getInputStream(e).use { it.readBytes() } }
            }

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
            return Doc.build(title, key, sections, author, cover)
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
