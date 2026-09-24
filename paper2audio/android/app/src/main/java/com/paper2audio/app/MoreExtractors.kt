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

        // Prefer an explicit article container, else the element holding the most paragraph text.
        val root = doc.selectFirst("article, main, [role=main], #mw-content-text, .post-content, .entry-content, .article-body")
            ?: doc.select("p").groupBy { it.parent() }.maxByOrNull { (_, ps) -> ps.sumOf { it.text().length } }?.key
            ?: doc.body()

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
            if (text.isEmpty()) continue
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
