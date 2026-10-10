package com.paper2audio.app

import org.jsoup.Jsoup
import org.jsoup.nodes.Element
import org.jsoup.nodes.Node
import org.jsoup.nodes.TextNode
import org.jsoup.parser.Parser
import org.jsoup.select.NodeTraversor
import org.jsoup.select.NodeVisitor
import java.io.File
import java.util.zip.ZipFile

/** Word documents: paragraphs in order, Title/Heading styles become chapters. */
object DocxExtractor {
    private val HEADING_STYLE = Regex("""^(Title|Heading1|Heading2|heading1|heading2|Heading 1|Heading 2)$""")

    fun extract(file: File, o: CleanOptions, name: String, key: String): Doc {
        ZipFile(file).use { zip ->
            fun read(path: String) = zip.getEntry(path)?.let { e -> zip.getInputStream(e).use { it.readBytes().toString(Charsets.UTF_8) } }
            val xml = read("word/document.xml") ?: error("Not a Word document")
            val core = read("docProps/core.xml")?.let { Jsoup.parse(it, "", Parser.xmlParser()) }
            val title = core?.getElementsByTag("dc:title")?.text()?.trim()?.ifBlank { null } ?: name
            val author = core?.getElementsByTag("dc:creator")?.text()?.trim()?.ifBlank { null }
            return Doc.build(title, key, sections(xml, o), author)
        }
    }

    internal fun sections(documentXml: String, o: CleanOptions): List<Pair<String?, List<String>>> {
        val doc = Jsoup.parse(documentXml, "", Parser.xmlParser())
        val sections = ArrayList<Pair<String?, List<String>>>()
        var heading: String? = null
        var lines = ArrayList<String>()
        fun flush() {
            if (heading != null || lines.any { it.isNotBlank() }) {
                sections += heading to TextCleaner.clean(lines, o)
            }
            lines = ArrayList()
        }
        for (p in doc.getElementsByTag("w:p")) {
            val style = p.getElementsByTag("w:pStyle").firstOrNull()?.attr("w:val") ?: ""
            val sb = StringBuilder()
            NodeTraversor.traverse(object : NodeVisitor {
                override fun head(node: Node, depth: Int) {
                    if (node is Element) when (node.tagName()) {
                        "w:t" -> sb.append(node.wholeText()) // keep xml:space="preserve" spaces
                        "w:tab" -> sb.append(' ')
                        "w:br", "w:cr" -> sb.append(' ')
                    }
                }
            }, p)
            val text = sb.toString().trim()
            if (text.isEmpty()) continue
            if (HEADING_STYLE.matches(style)) {
                if (o.skipReferences && TextCleaner.END_SECTION.containsMatchIn(text)) {
                    flush()
                    return sections.filter { it.second.isNotEmpty() }
                }
                flush()
                heading = text
                lines += text
                lines += ""
            } else {
                lines += text
                lines += ""
            }
        }
        flush()
        return sections.filter { it.second.isNotEmpty() }
    }
}

/** Web articles: only the article text, without menus, sidebars, footnote markers or reference lists. */
object HtmlExtractor {
    private val JUNK = "script, style, noscript, nav, header, footer, aside, form, button, svg, iframe, figure, table, sup, " +
        ".mw-editsection, .reference, .references, .reflist, .navbox, .infobox, .sidebar, .toc, #toc, .hatnote, " +
        ".mw-jump-link, .noprint, .metadata, .ad, .ads, .advertisement, .share, .social, .comments, [role=navigation], " +
        "[aria-hidden=true]"
    private val END = Regex("""^\s*(references|notes|footnotes|see also|external links|further reading|bibliography|sources|citations)\s*$""", RegexOption.IGNORE_CASE)
    private val WS = Regex("""\s+""")
    private val BLOCKS = setOf("p", "li", "blockquote", "pre")

    private val AD_WORDS = setOf(
        "ad", "ads", "advert", "adverts", "advertisement", "adsbygoogle", "dfp", "gpt", "sponsor", "sponsored", "promo",
        "promoted", "taboola", "outbrain", "mgid", "related", "recommended", "recommendations", "newsletter", "subscribe",
        "also", "alsoread", "trending", "popup", "paywall", "banner", "comments", "comment",
    )

    /** "Also read: …", "Subscribe…" and similar boxes inside articles. */
    private val PROMO = Regex("""(?i)^\s*(also read|read also|read more|related:|recommended|subscribe (now|to)|sign up for|click here|download the app|follow us|advertisement\b|sponsored\b|trending\b)""")

    /** A block that is mostly a link (related stories, "next article" teasers). */
    private fun mostlyLinks(el: Element, text: String): Boolean {
        if (el.normalName().matches(Regex("h[1-4]"))) return false
        val linked = el.select("a").sumOf { it.text().length }
        return text.length < 300 && linked >= text.length * 0.7
    }

    /**
     * The part of the page holding the article: the innermost element that contains most
     * of the page's paragraph text. Articles broken up by ads or "also read" boxes span
     * several containers; this keeps all of them (a single best container loses some).
     */
    internal fun articleRoot(doc: org.jsoup.nodes.Document): Element {
        val paras = doc.select("p").filter { it.text().length >= 40 && !mostlyLinks(it, it.text()) }
        val total = paras.sumOf { it.text().length }
        if (total == 0) return doc.body()
        val sums = HashMap<Element, Int>()
        for (p in paras) {
            val n = p.text().length
            var e: Element? = p.parent()
            while (e != null) {
                sums[e] = (sums[e] ?: 0) + n
                e = e.parent()
            }
        }
        // The deepest element with at least 70% of the text.
        return sums.filter { it.value >= total * 0.7 }.keys.maxByOrNull { it.parents().size } ?: doc.body()
    }

    class Article(val title: String, val author: String?, val imageUrl: String?, val sections: List<Pair<String?, List<String>>>)

    fun extract(file: File, o: CleanOptions, name: String, key: String): Doc {
        val article = parse(file.readText(), o, name)
        return Doc.build(article.title, key, article.sections, article.author)
    }

    fun meta(doc: org.jsoup.nodes.Document, vararg names: String): String? {
        for (n in names) {
            val v = doc.selectFirst("meta[property=$n], meta[name=$n]")?.attr("content")?.trim()
            if (!v.isNullOrBlank()) return v
        }
        return null
    }

    fun parse(html: String, o: CleanOptions, fallbackTitle: String): Article {
        val doc = Jsoup.parse(html)
        val title = meta(doc, "og:title", "twitter:title")
            ?: doc.selectFirst("h1")?.text()?.trim()?.ifBlank { null }
            ?: doc.title().ifBlank { fallbackTitle }
        val author = meta(doc, "author", "article:author", "parsely-author", "sailthru.author")
            ?.takeUnless { it.startsWith("http") }
        val image = meta(doc, "og:image", "twitter:image")
        doc.select(JUNK).remove()
        // Ad slots, sponsored and related-story boxes, by their class or id words.
        doc.allElements.toList().filter { el ->
            el !== doc.body() && (el.className() + " " + el.id()).lowercase().split(Regex("""[^a-z]+""")).any { it in AD_WORDS }
        }.forEach { if (it.parent() != null) it.remove() }

        val root = articleRoot(doc)

        val sections = ArrayList<Pair<String?, List<String>>>()
        var heading: String? = null
        var lines = ArrayList<String>()
        fun flush() {
            if (lines.any { it.isNotBlank() }) sections += heading to TextCleaner.clean(lines, o)
            lines = ArrayList()
        }
        for (el in root.select("h1, h2, h3, h4, p, li, blockquote, pre")) {
            // Skip blocks nested inside another collected block (e.g. <p> inside <li>), read once via the outer one.
            if (el.parents().takeWhile { it != root }.any { it.normalName() in BLOCKS }) continue
            val text = WS.replace(el.text(), " ").trim()
            if (text.isEmpty() || PROMO.containsMatchIn(text) || mostlyLinks(el, text)) continue
            if (el.normalName().matches(Regex("h[1-4]"))) {
                if (text == title && sections.isEmpty() && lines.isEmpty()) continue
                if (o.skipReferences && END.matches(text)) break
                flush()
                heading = text
                lines += text
                lines += ""
            } else {
                lines += text
                lines += ""
            }
        }
        flush()
        return Article(title, author, image, sections.filter { it.second.isNotEmpty() })
    }
}

/** Markdown: strips formatting so symbols aren't read aloud; # headings become chapters. */
object MarkdownExtractor {
    private val HEADING = Regex("""^\s{0,3}(#{1,3})\s+(.+?)\s*#*\s*$""")
    private val LIST_ITEM = Regex("""^\s*([-*+]|\d+[.)])\s+""")
    private val INLINE = listOf(
        Regex("""!\[([^\]]*)]\([^)]*\)""") to "",          // images
        Regex("""\[([^\]]+)]\([^)]*\)""") to "$1",         // links -> their text
        Regex("""`{1,3}([^`]*)`{1,3}""") to "$1",           // inline code
        Regex("""(\*\*|__)(.+?)\1""") to "$2",              // bold
        Regex("""(?<![\w*])[*_](?!\s)(.+?)(?<!\s)[*_](?![\w*])""") to "$1", // italics
        Regex("""^\s{0,3}>\s?""") to "",                    // blockquotes
        Regex("""^\s*([-*+]|\d+[.)])\s+""") to "",          // list markers
        Regex("""<[^>]+>""") to "",                         // inline HTML
    )

    fun extract(file: File, o: CleanOptions, name: String, key: String): Doc {
        val sections = ArrayList<Pair<String?, List<String>>>()
        var heading: String? = null
        var lines = ArrayList<String>()
        var inFence = false
        fun flush() {
            if (lines.any { it.isNotBlank() }) sections += heading to TextCleaner.clean(lines, o)
            lines = ArrayList()
        }
        var title: String? = null
        for (raw in file.readLines()) {
            if (raw.trimStart().startsWith("```")) {
                inFence = !inFence
                continue
            }
            if (inFence) continue // code blocks read badly aloud
            val h = HEADING.matchEntire(raw)
            if (h != null) {
                val text = strip(h.groupValues[2])
                if (title == null && h.groupValues[1] == "#") title = text
                if (o.skipReferences && TextCleaner.END_SECTION.containsMatchIn(text)) break
                flush()
                heading = text
                lines += text
                lines += ""
                continue
            }
            if (raw.trim().matches(Regex("""^([-*_]\s*){3,}$|^\|.*\|$|^\s*\|?[-:| ]+\|?\s*$"""))) {
                lines += ""
                continue
            }
            if (LIST_ITEM.containsMatchIn(raw)) {
                // Each list item reads as its own sentence, with a pause after it.
                val item = strip(raw).trim()
                lines += ""
                lines += if (item.isNotEmpty() && item.last() !in ".!?:;") "$item." else item
                continue
            }
            lines += strip(raw)
        }
        flush()
        return Doc.build(title ?: name, key, sections)
    }

    internal fun strip(line: String): String {
        var t = line
        for ((re, rep) in INLINE) t = re.replace(t, rep)
        return t
    }
}

/**
 * PowerPoint (.pptx) as a lecture: each slide becomes a chapter ("Slide 3: Title"),
 * with its bullet points read as sentences and then the speaker notes.
 */
object PptxExtractor {
    private val SLIDE_NUMBER = Regex("""slide(\d+)\.xml$""")

    fun extract(file: File, o: CleanOptions, name: String, key: String): Doc {
        ZipFile(file).use { zip ->
            fun read(path: String) = zip.getEntry(path)?.let { e -> zip.getInputStream(e).use { it.readBytes().toString(Charsets.UTF_8) } }
            fun xml(path: String) = read(path)?.let { Jsoup.parse(it, "", Parser.xmlParser()) }

            // Slide order comes from presentation.xml and its relationships.
            val rels = xml("ppt/_rels/presentation.xml.rels")?.getElementsByTag("Relationship")
                ?.associate { it.attr("Id") to it.attr("Target") }.orEmpty()
            val ordered = xml("ppt/presentation.xml")?.getElementsByTag("p:sldId")?.mapNotNull { rels[it.attr("r:id")] }
                ?.map { "ppt/" + it.removePrefix("/ppt/").removePrefix("./") }
                .orEmpty()
            val slides = ordered.ifEmpty {
                zip.entries().asSequence().map { it.name }.filter { SLIDE_NUMBER.containsMatchIn(it) && it.startsWith("ppt/slides/") }
                    .sortedBy { SLIDE_NUMBER.find(it)!!.groupValues[1].toInt() }.toList()
            }
            val core = read("docProps/core.xml")?.let { Jsoup.parse(it, "", Parser.xmlParser()) }
            var title = core?.getElementsByTag("dc:title")?.text()?.trim()?.ifBlank { null }
            val author = core?.getElementsByTag("dc:creator")?.text()?.trim()?.ifBlank { null }

            val sections = ArrayList<Pair<String?, List<String>>>()
            for ((i, path) in slides.withIndex()) {
                val slide = xml(path) ?: continue
                var slideTitle: String? = null
                val points = ArrayList<String>()
                for (sp in slide.getElementsByTag("p:sp")) {
                    val ph = sp.getElementsByTag("p:ph").firstOrNull()?.attr("type")
                    val paras = sp.getElementsByTag("a:p").map { p -> p.getElementsByTag("a:t").joinToString("") { it.wholeText() }.trim() }
                        .filter { it.isNotEmpty() }
                    if (ph == "title" || ph == "ctrTitle") slideTitle = paras.joinToString(" ")
                    else if (ph != "sldNum" && ph != "dt" && ph != "ftr") points += paras
                }
                // Tables on slides: one sentence per row.
                for (row in slide.getElementsByTag("a:tr")) {
                    val cells = row.getElementsByTag("a:tc").map { c -> c.getElementsByTag("a:t").joinToString(" ") { it.wholeText() }.trim() }
                    if (cells.any { it.isNotEmpty() }) points += cells.filter { it.isNotEmpty() }.joinToString(", ")
                }
                if (title == null && slideTitle != null) title = slideTitle
                // Speaker notes, through the slide's relationships.
                val relPath = path.replace("slides/", "slides/_rels/") + ".rels"
                val notesTarget = xml(relPath)?.getElementsByTag("Relationship")
                    ?.firstOrNull { it.attr("Type").endsWith("/notesSlide") }?.attr("Target")
                val notes = notesTarget?.let { t -> xml("ppt/" + t.removePrefix("../")) }?.getElementsByTag("p:sp")?.toList()
                    ?.filter { it.getElementsByTag("p:ph").firstOrNull()?.attr("type") == "body" }
                    ?.flatMap { sp -> sp.getElementsByTag("a:p").map { p -> p.getElementsByTag("a:t").joinToString("") { it.wholeText() }.trim() } }
                    ?.filter { it.isNotEmpty() }.orEmpty()
                // A slide with only a picture has nothing to read; saying just its number sounds odd.
                if (slideTitle.isNullOrBlank() && points.isEmpty() && notes.isEmpty()) continue
                val heading = "Slide ${i + 1}" + (slideTitle?.let { ": $it" } ?: "")
                val lines = ArrayList<String>()
                lines += heading
                lines += ""
                for (pt in points) {
                    lines += if (pt.last() in ".!?:;") pt else "$pt."
                    lines += ""
                }
                if (notes.isNotEmpty()) {
                    lines += "Speaker notes."
                    lines += ""
                    notes.forEach { lines += it; lines += "" }
                }
                sections += heading to TextCleaner.clean(lines, o.copy(skipCaptions = false))
            }
            return Doc.build(title ?: name, key, sections.filter { it.second.isNotEmpty() }, author)
        }
    }
}
