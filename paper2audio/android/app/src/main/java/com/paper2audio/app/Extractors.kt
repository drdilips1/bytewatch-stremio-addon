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
    /**
     * One line of text: its largest and typical font size, whether it is all bold, and
     * where it is on the page (x0..x1 across, y down; -1 when unknown, e.g. OCR text).
     */
    class Line(
        val text: String,
        val size: Float,
        val bold: Boolean,
        val page: Int,
        val x0: Float = -1f,
        val x1: Float = -1f,
        val y: Float = 0f,
        val pageWidth: Float = 0f,
        val median: Float = size,
    ) {
        val blank get() = text.isBlank()
        /** The last line of a paragraph. */
        var paraEnd = false

        fun withText(t: String) = Line(t, size, bold, page, x0, x1, y, pageWidth, median).also { it.paraEnd = paraEnd }
    }

    /** One character as the PDF places it (y grows downward). */
    class Glyph(val text: String, val x: Float, val y: Float, val w: Float, val size: Float, val bold: Boolean, val pageWidth: Float)

    /**
     * A line from its characters (null = a word gap). Raised small characters are
     * superscripts: citation numbers ("psoriasis,²˒³") and affiliation marks ("Li¹")
     * are dropped; squared and cubed units ("m²") are kept.
     */
    fun lineOf(tokens: List<Glyph?>, page: Int): Line? {
        val glyphs = tokens.filterNotNull().filter { it.text.isNotBlank() }
        if (glyphs.isEmpty()) return null
        val med = glyphs.map { it.size }.sorted()[glyphs.size / 2]
        val base = glyphs.map { it.y }.sorted()[glyphs.size / 2]
        fun raised(g: Glyph) = g.size < med * 0.82f && g.y < base - med * 0.15f
        val sb = StringBuilder()
        val kept = ArrayList<Glyph>()
        for (t in tokens) {
            if (t == null) {
                if (sb.isNotEmpty() && sb.last() != ' ') sb.append(' ')
                continue
            }
            if (raised(t)) {
                val unit = Regex("""(?:^|[^A-Za-z])(?:m|cm|mm|km|ft|in)$""").containsMatchIn(sb)
                when {
                    unit && t.text == "2" -> sb.append('²')
                    unit && t.text == "3" -> sb.append('³')
                    sb.endsWith("10") || sb.endsWith("10-") || sb.endsWith("10−") -> sb.append(t.text)
                }
                continue
            }
            sb.append(t.text)
            kept += t
        }
        val text = sb.toString().replace(Regex("""\s+([,.;:])"""), "$1").replace(Regex("""\s{2,}"""), " ").trim()
        if (text.isEmpty() || kept.isEmpty()) return null
        val size = (kept.maxOf { it.size } * 2).toInt() / 2f
        val median = (kept.map { it.size }.sorted()[kept.size / 2] * 2).toInt() / 2f
        return Line(
            text, size, kept.count { it.bold } >= kept.size * 0.8, page,
            kept.minOf { it.x }, kept.maxOf { it.x + it.w }, base, kept.first().pageWidth, median,
        )
    }

    /**
     * Reading order for a page: on two-column pages, text spanning the page (title,
     * abstract, wide tables) in place, and between those the left column, then the right.
     * Single-column pages keep the PDF's own order.
     */
    internal fun readingOrder(lines: List<Line>): List<Line> {
        val w = lines.firstOrNull()?.pageWidth ?: 0f
        if (w <= 0f || lines.any { it.x0 < 0f }) return lines
        val mid = w / 2
        fun side(l: Line) = when {
            l.x1 <= mid + w * 0.04f -> 0
            l.x0 >= mid - w * 0.04f -> 1
            else -> 2
        }
        if (lines.count { side(it) == 0 } < 4 || lines.count { side(it) == 1 } < 4) return lines
        val out = ArrayList<Line>()
        val left = ArrayList<Line>()
        val right = ArrayList<Line>()
        for (l in lines.sortedWith(compareBy({ it.y }, { it.x0 }))) {
            when (side(l)) {
                0 -> left += l
                1 -> right += l
                else -> {
                    out += left
                    out += right
                    left.clear()
                    right.clear()
                    out += l
                }
            }
        }
        out += left
        out += right
        return out
    }

    private val HEADING_PHRASES = listOf(
        "Abstract", "Summary", "Introduction", "Background", "Methods", "Materials and Methods", "Methodology",
        "Patients and Methods", "Results", "Discussion", "Conclusion", "Conclusions", "Limitations",
        "Acknowledgments", "Acknowledgements", "Acknowledgment", "Acknowledgement", "Conflict of Interest Statement",
        "Conflict of Interest", "Conflicts of Interest", "Ethics Statement", "Data Availability Statement",
        "Author Contributions", "Funding Information", "Funding", "References", "Keywords", "Supporting Information",
        "Supplementary Material", "Case Report", "Case Presentation", "Appendix",
    ).associateBy { it.lowercase().replace(" ", "") }

    /**
     * Headings as written: "1 | INTRODUC TION" -> "1 Introduction", "R E FE R E N C E S" -> "References"
     * (letter-spaced capitals come out of PDFs in pieces), "2.1 | Patients" -> "2.1 Patients".
     */
    internal fun tidyHeading(text: String): String {
        var t = text.trim()
        val num = Regex("""^(\d{1,2}(?:\.\d{1,2}){0,3}\.?|[IVX]{1,4}\.)\s*[|│]?\s*""").find(t)
        val prefix = num?.groupValues?.get(1)?.let { "$it " } ?: ""
        if (num != null) t = t.substring(num.range.last + 1)
        t = t.replace(Regex("""\s*[|│]\s*"""), " ").trim()
        if (t.length > 90) return text
        val squashed = t.lowercase().replace(Regex("""[^a-z]"""), "")
        HEADING_PHRASES[squashed]?.let { return prefix + it }
        val letters = t.filter { it.isLetter() }
        if (letters.length >= 4 && letters.all { it.isUpperCase() }) {
            val tokens = t.split(' ').filter { it.isNotEmpty() }
            // Mostly one- and two-letter pieces: one spaced-out word.
            if (tokens.size >= 3 && tokens.count { it.length == 1 } * 2 >= tokens.size) t = tokens.joinToString("")
            t = t.lowercase().split(' ').mapIndexed { i, w ->
                if (i > 0 && w in setOf("of", "and", "in", "for", "the", "to", "with", "on", "a", "an", "or")) w
                else w.replaceFirstChar { it.uppercase() }
            }.joinToString(" ")
        }
        return (prefix + t).trim()
    }

    private val KNOWN_HEADING = Regex(
        """^(?:\d+(?:\.\d+)*\.?\s*|[IVX]+\.\s*)?(abstract|summary|introduction|background|methods?|materials and methods|methodology|patients and methods|study design|results?|findings|discussion|limitations?|strengths and limitations|conclusions?|concluding remarks|references|bibliography|acknowledge?ments?|appendix|supplementary material|supporting information|funding(?: information)?|conflicts? of interest(?: statement)?|ethics statement|data availability statement|author contributions|declarations?|keywords?)\s*:?$""",
        RegexOption.IGNORE_CASE,
    )
    private val NUMBERED_HEADING = Regex("""^(?:\d{1,2}(?:\.\d{1,2}){0,3}\.?|[IVX]{1,4}\.)\s+[A-Z][^.!?]{2,90}$""")
    private val CAPTION = Regex("""^\s*((?:Figure|Fig\.|Table|Supplementary (?:Figure|Table))\s*S?\d+[a-z]?)\s*[.:|—-]?\s*(.*)$""", RegexOption.IGNORE_CASE)

    /** Publisher banners and boilerplate that shouldn't be read. */
    private val JUNK = Regex(
        """(?i)(downloaded from|all rights reserved|©|\(c\)\s*\d{4}|copyright|creative commons|doi:\s*10\.|https?://doi|\bissn\b|e-?mail:|@\w+\.\w|orcid|corresponding author|^\s*(?:received|accepted|revised|published)\b[^a-z]{0,3}(?:\d{1,2}\s+[A-Z][a-z]+|[A-Z][a-z]+\s+\d{1,2}|\d{4})|published online|this article is protected|for personal use|licen[cs]ed under|www\.|\bpage \d+ of \d+\b|\bvol\.\s*\d+|\bpp\.\s*\d)""",
    )

    /** Running heads like "XU ET AL." or "Smith et al. 12". */
    private val RUNNING_HEAD = Regex("""(?i)^\d*\s*[A-Z][\p{L}'-]+(?:\s+(?:and|&)\s+[A-Z][\p{L}'-]+)?\s+et\s+al\.?\s*\d*$""")

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
                val tokens = ArrayList<Glyph?>()

                override fun writeString(text: String, textPositions: MutableList<TextPosition>) {
                    for (tp in textPositions) {
                        val u = tp.unicode ?: continue
                        val font = runCatching { tp.font?.name }.getOrNull().orEmpty()
                        val bold = "Bold" in font || "bold" in font || "Black" in font || "Heavy" in font || font.endsWith(",B")
                        tokens += Glyph(u, tp.xDirAdj, tp.yDirAdj, tp.widthDirAdj, maxOf(tp.fontSizeInPt, tp.heightDir), bold, tp.pageWidth)
                    }
                }

                override fun writeWordSeparator() {
                    tokens += null
                }

                override fun writeLineSeparator() = flush()

                override fun writeParagraphEnd() {
                    flush()
                    lines.lastOrNull()?.paraEnd = true
                }

                fun flush() {
                    lineOf(tokens, i)?.let { lines += it }
                    tokens.clear()
                }
            }
            // Content order, not position: position sorting mixes the lines of two-column papers.
            stripper.sortByPosition = false
            stripper.startPage = i
            stripper.endPage = i
            stripper.getText(pdf)
            stripper.flush()
            lines.lastOrNull()?.paraEnd = true
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
        val kept = pages.map { p ->
            p.filter { l ->
                val k = TextCleaner.norm(l.text)
                l.blank || !(k.isNotEmpty() && k in repeated) && !TextCleaner.PAGE_NUM.containsMatchIn(l.text) &&
                    !(l.text.length < 160 && JUNK.containsMatchIn(l.text)) && !RUNNING_HEAD.matches(l.text.trim())
            }.map { l -> if (!l.blank && l.text.length <= 120) l.withText(tidyHeading(l.text)) else l }
        }
        // The body text size: the size most characters are set in.
        val bySize = HashMap<Float, Int>()
        for (l in kept.flatten()) if (!l.blank && l.median > 0f) bySize[l.median] = (bySize[l.median] ?: 0) + l.text.length
        val body = bySize.maxByOrNull { it.value }?.key ?: 0f

        fun expand(ps: List<List<Line>>): List<Line> {
            val out = ArrayList<Line>()
            for (p in ps) for (l in p) {
                out += l
                if (l.paraEnd && !l.blank) out += Line("", 0f, false, l.page)
            }
            return out
        }
        // Small print isn't read: footnotes, author and affiliation columns, table cells, figure legends.
        // (Captions are still found in it, for "View figure".)
        val withSmall = expand(kept)
        val all = expand(kept.map { p -> readingOrder(p.filter { l -> l.blank || body <= 0f || l.median <= 0f || l.median >= body * 0.85f }) })

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
        for ((i, l) in withSmall.withIndex()) {
            val m = CAPTION.find(l.text) ?: continue
            if (!CAPTION.matches(l.text.trim()) || l.text.length > 400) continue
            val label = m.groupValues[1].replace(Regex("""(?i)^fig\.""" ), "Figure").replace(Regex("""\s+"""), " ")
            if (figures.any { it.label.equals(label, true) }) continue
            val more = withSmall.drop(i + 1).takeWhile { !it.blank }.take(3).joinToString(" ") { it.text }
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
                // A section that opens straight into a subsection ("2 Methods", then "2.1 Patients") still gets its place.
                else if (heading != null) sections += heading to listOf(heading!!)
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
        var lastHeading: Line? = null
        for (l in all) {
            if (stop) break
            if (l in titleSet || l in front) continue
            // A heading wrapped onto a second line ("2.2 Epidural lidocaine" / "block treatment").
            val prev = lastHeading
            if (!l.blank && prev != null && buf.isEmpty() && heading != null && l.page == prev.page &&
                l.size == prev.size && l.bold == prev.bold && l.text.length < 80 && !prev.text.trimEnd().endsWith(".") &&
                Sections.kindOf(l.text) == null && !NUMBERED_HEADING.matches(l.text.trim())
            ) {
                heading = "$heading ${l.text.trim().trimEnd(':')}"
                lastHeading = l
                continue
            }
            if (!l.blank) lastHeading = null
            if (!l.blank && isHeading(l, strict)) {
                lastHeading = l
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
                    Regex("""(?i)^(?:\d+(?:\.\d+)*\s+)?(funding|conflicts? of interest|declarations?|keywords?|ethics statement|data availability|author contributions|supporting information|orcid)""").containsMatchIn(t)
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
    private val WEB_ADDRESS = Regex("""(?i)^\W*(?:https?://)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|in|co|io|info|me|ru|to|cc|xyz)(?:/\S*)?\W*$""")
    /** Pages before the story: reading starts after them (they stay in the book). */
    private val FRONT_TYPES = setOf(
        "cover", "frontmatter", "titlepage", "halftitlepage", "copyright-page", "dedication", "epigraph",
        "toc", "foreword", "preface", "imprint", "colophon", "credits", "seriespage", "praise", "other-credits",
    )
    private val FRONT_TITLE = Regex(
        """^\s*(cover|title( page)?|half[- ]title|copyright|dedication|epigraph|also by.*|other books by.*|by the same author|""" +
            """praise for.*|advance praise.*|about the (author|book|publisher)|contents|table of contents|""" +
            """author'?s note|a note (from|to) the (author|reader)|publisher'?s note|front ?matter|imprint)\s*\.?\s*$""",
        RegexOption.IGNORE_CASE,
    )
    private val FRONT_FILE = Regex(
        """(^|[/_\-])(cover|title(page)?|halftitle|copyright|dedication|dedi|epigraph|toc|contents|""" +
            """alsoby|also[_-]by|praise|frontmatter|front|fm|imprint|about[_-]?(the[_-]?)?(author|book|publisher))\d*([_\-.][^/]*)?\.x?html?$""",
        RegexOption.IGNORE_CASE,
    )

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

            // Where the publisher says the text begins: EPUB 3 landmarks or the EPUB 2 guide.
            val bodyHref = bodyStart(opf, base, manifest, ::read)

            // Chapter names from the book's own table of contents, like an e-reader shows them.
            val toc = tocTitles(opf, base, manifest, ::read)

            val sections = ArrayList<Pair<String?, List<String>>>()
            val names = ArrayList<String?>()
            var startSection = -1
            var guessed = -1
            var bodyReached = false
            for (ref in opf.tags("itemref")) {
                val item = manifest[ref.attr("idref")] ?: continue
                if (ref.attr("linear") == "no") continue
                if ("nav" in item.attr("properties").split(' ')) continue
                if ("html" !in item.attr("media-type")) continue
                val path = resolve(base, item.attr("href"))
                val html = read(path) ?: continue
                val front = guessed < 0 && isFront(html, path)
                if (path == bodyHref) bodyReached = true
                val (heading, lines) = chapterLines(html)
                // With a table of contents, files it doesn't list continue the chapter before
                // (and a highlighted line inside a chapter isn't taken for a new one).
                val chapter: String? = if (toc.isNotEmpty()) toc[path] else heading
                val name = chapter ?: heading ?: ""
                if (SKIP_CHAPTER.containsMatchIn(name) || lines.none { it.isNotBlank() }) continue
                if (o.skipReferences && (TextCleaner.END_SECTION.containsMatchIn(name) ||
                        TextCleaner.NOTES.containsMatchIn(name))) continue
                if (o.skipAcknowledgements && TextCleaner.ACK.containsMatchIn(name)) continue
                if (o.skipAppendix && TextCleaner.APPENDIX.containsMatchIn(name)) continue
                val text = TextCleaner.clean(lines, o)
                if (startSection < 0 && bodyReached) startSection = sections.size
                if (guessed < 0) {
                    // A short page headed by nothing, or by the book's title, is a title or dedication page.
                    val short = text.sumOf { it.split(' ').size } < 120
                    val named = chapter ?: heading
                    val titlePage = short && (named == null || named.equals(title, ignoreCase = true) ||
                        author != null && named.equals(author, ignoreCase = true))
                    if (!front && !titlePage && !(named != null && FRONT_TITLE.matches(named))) guessed = sections.size
                }
                sections += chapter to text
                names += chapter ?: heading
            }
            // Watermarks stamped through pirated or converted books ("OceanofPDF.com"): a bare web
            // address, or a short line repeated in many chapters.
            val counts = HashMap<String, Int>()
            for ((_, ps) in sections) for (p in ps.filter { it.length < 60 }.toSet()) counts[p.trim().lowercase()] = (counts[p.trim().lowercase()] ?: 0) + 1
            val minRepeats = maxOf(5, sections.size / 5)
            fun watermark(p: String) = p.length < 60 && (WEB_ADDRESS.matches(p.trim()) || (counts[p.trim().lowercase()] ?: 0) >= minRepeats)
            val clean = sections.map { (n, ps) -> n to ps.filterNot(::watermark) }
            val start = if (startSection >= 0) startSection else guessed.coerceAtLeast(0)
            return Doc.build(title, key, clean, author, cover, startSection = start, startTitle = names.getOrNull(start))
        }
    }

    /** Table of contents entries: file path to its first title (EPUB 3 nav, else EPUB 2 NCX). */
    private fun tocTitles(opf: Document, base: String, manifest: Map<String, Element>, read: (String) -> String?): Map<String, String> {
        val out = LinkedHashMap<String, String>()
        fun add(dir: String, href: String, title: String) {
            val t = WS.replace(title, " ").trim()
            if (href.isBlank() || t.isEmpty()) return
            out.putIfAbsent(resolve(dir, href), t.take(120))
        }
        manifest.values.firstOrNull { "nav" in it.attr("properties").split(' ') }?.let { nav ->
            val navPath = resolve(base, nav.attr("href"))
            read(navPath)?.let { html ->
                val doc = Jsoup.parse(html)
                val tocNav = doc.select("nav").firstOrNull { it.attr("epub:type").split(' ').contains("toc") } ?: doc.select("nav").firstOrNull()
                tocNav?.select("a[href]")?.forEach { a -> add(navPath.substringBeforeLast('/', ""), a.attr("href"), a.text()) }
            }
        }
        if (out.isEmpty()) {
            val ncx = manifest.values.firstOrNull { it.attr("media-type") == "application/x-dtbncx+xml" }
            if (ncx != null) {
                val ncxPath = resolve(base, ncx.attr("href"))
                read(ncxPath)?.let { xml ->
                    val doc = Jsoup.parse(xml, "", Parser.xmlParser())
                    for (point in doc.tags("navPoint")) {
                        val label = point.children().firstOrNull { it.tagName().endsWith("navLabel") }?.text().orEmpty()
                        val src = point.children().firstOrNull { it.tagName().endsWith("content") }?.attr("src").orEmpty()
                        add(ncxPath.substringBeforeLast('/', ""), src, label)
                    }
                }
            }
        }
        return out
    }

    /** The file where the main text begins, from the EPUB 3 landmarks or the EPUB 2 guide. */
    private fun bodyStart(opf: Document, base: String, manifest: Map<String, Element>, read: (String) -> String?): String? {
        val nav = manifest.values.firstOrNull { "nav" in it.attr("properties").split(' ') }
        if (nav != null) {
            val navPath = resolve(base, nav.attr("href"))
            val html = read(navPath)
            if (html != null) {
                val landmarks = Jsoup.parse(html).select("nav").firstOrNull { it.attr("epub:type").contains("landmarks") }
                val a = landmarks?.select("a")?.firstOrNull { it.attr("epub:type").split(' ').any { t -> t == "bodymatter" || t == "start" } }
                if (a != null) return resolve(navPath.substringBeforeLast('/', ""), a.attr("href"))
            }
        }
        val ref = opf.tags("reference").firstOrNull { it.attr("type").lowercase() in setOf("text", "start", "bodymatter") }
        return ref?.let { resolve(base, it.attr("href")) }
    }

    /** Cover, title page, copyright, dedication, contents… by their EPUB type or file name. */
    private fun isFront(html: String, path: String): Boolean {
        if (FRONT_FILE.containsMatchIn(path)) return true
        val head = html.take(4000)
        val types = Regex("""(?:epub:type|role)\s*=\s*["']([^"']+)["']""").findAll(head)
            .flatMap { it.groupValues[1].replace("doc-", "").split(' ') }.toSet()
        if (types.any { it in setOf("bodymatter", "chapter", "prologue", "part", "introduction") }) return false
        return types.any { it in FRONT_TYPES }
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
                        // Only top-level headings name a chapter; h3 and below are headings inside one.
                        if (heading == null && (tag == "h1" || tag == "h2")) {
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
