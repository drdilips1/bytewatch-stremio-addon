package com.paper2audio.app

/** Same cleanup rules as the Python tool in ../paper2audio/extract.py. */
data class CleanOptions(
    val skipReferences: Boolean = true,
    val skipAppendix: Boolean = false,
    val skipAcknowledgements: Boolean = true,
    val skipCaptions: Boolean = true,
    val removeCitations: Boolean = true,
    val removeUrls: Boolean = true,
)

object TextCleaner {
    private val IC = RegexOption.IGNORE_CASE

    val END_SECTION = Regex(
        """^\s*(?:\d+\.?\s*|[IVX]+\.\s*)?(references|bibliography|works cited|literature cited)\s*$""", IC
    )
    val APPENDIX = Regex("""^\s*(?:[A-Z]\.?\s*)?(appendix|appendices|supplementary material)\b.*$""", IC)
    val NOTES = Regex("""^\s*(notes|endnotes|footnotes)\s*$""", IC)
    val ACK = Regex("""^\s*(?:\d+\.?\s*)?acknowledge?ments?\s*$""", IC)
    private val CAPTION = Regex("""^\s*(figure|fig\.|table|algorithm)\s*\d+[.:]""", IC)

    // [1], [2, 5], [3-7], [Smith 2020]
    private val BRACKET_CITE = Regex("""\s?\[[\w\s.,;&+\-–]*\d[\w\s.,;&+\-–]*\]""")

    // (Smith et al., 2020), (Smith and Lee, 2019; Doe, 2021a)
    private const val NAME = """[A-Z][A-Za-z\-'’]+(?:\s+(?:et al\.|and|&)\s*[A-Z]?[A-Za-z\-'’]*)*,?\s+\d{4}[a-z]?"""
    private val PAREN_CITE = Regex("""\s?\((?:see\s+|e\.g\.,?\s+|cf\.\s+)?$NAME(?:\s*[;,]\s*$NAME)*\)""")
    private val URL = Regex("""https?://\S+|www\.\S+""")
    val PAGE_NUM = Regex("""^\s*(?:page\s*)?\d{1,4}(?:\s*(?:of|/)\s*\d{1,4})?\s*$""", IC)

    private val DIGITS = Regex("""\d+""")
    private val PARA_END = Regex("""[.!?:;"”)]$""")
    private val CONTROL = Regex("[\\x00-\\x08\\x0b-\\x1f]")
    private val SPACE_BEFORE_PUNCT = Regex("""\s+([,.;:])""")
    private val MULTI_SPACE = Regex("""\s{2,}""")
    private val SENTENCE_BREAK = Regex("""(?<=[.!?])\s+""")

    private val SPOKEN = listOf(
        "e.g." to "for example",
        "i.e." to "that is",
        "et al." to "and colleagues",
        "w.r.t." to "with respect to",
        "vs." to "versus",
        "≈" to " approximately ",
        "≤" to " less than or equal to ",
        "≥" to " greater than or equal to ",
        "±" to " plus or minus ",
        "×" to " times ",
        "→" to " to ",
        "∼" to " approximately ",
        "%" to " percent",
        "ﬁ" to "fi",
        "ﬂ" to "fl",
        "ﬀ" to "ff",
        "ﬃ" to "ffi",
    )

    fun norm(line: String): String = DIGITS.replace(line.trim().lowercase(), "#")

    /** Lines that recur at the top/bottom of many pages are running headers/footers. */
    fun repeatedLines(pages: List<List<String>>): Set<String> {
        if (pages.size < 3) return emptySet()
        val counts = HashMap<String, Int>()
        for (lines in pages) {
            val nonEmpty = lines.filter { it.isNotBlank() }
            val edge = nonEmpty.take(2) + nonEmpty.takeLast(2)
            edge.filter { it.trim().length < 120 }.map(::norm).toSet().forEach {
                counts[it] = (counts[it] ?: 0) + 1
            }
        }
        val threshold = maxOf(3, pages.size / 2)
        return counts.filterValues { it >= threshold }.keys
    }

    /** Turns raw lines (blank line = paragraph break) into clean, speakable paragraphs. */
    fun clean(lines: List<String>, o: CleanOptions): List<String> {
        val kept = ArrayList<String>()
        var skippingCaption = false
        var inAck = false
        for (line in lines) {
            val s = line.trim()
            if (o.skipReferences && END_SECTION.containsMatchIn(s)) break
            if (o.skipAppendix && s.length < 80 && APPENDIX.containsMatchIn(s)) break
            if (o.skipAcknowledgements) {
                if (ACK.containsMatchIn(s)) {
                    inAck = true
                    continue
                }
                if (inAck) {
                    // Acknowledgements end at the next short heading-like line.
                    if (s.isNotEmpty() && s.length < 60 && !s.endsWith(".")) inAck = false else continue
                }
            }
            if (o.skipCaptions) {
                if (CAPTION.containsMatchIn(s)) {
                    skippingCaption = true
                    continue
                }
                if (skippingCaption) {
                    if (s.isEmpty()) skippingCaption = false
                    continue
                }
            }
            kept += line
        }

        val out = ArrayList<String>()
        for (raw in joinParagraphs(kept)) {
            var p = raw
            if (o.removeCitations) {
                p = BRACKET_CITE.replace(p, "")
                p = PAREN_CITE.replace(p, "")
            }
            if (o.removeUrls) p = URL.replace(p, "")
            p = speakable(p)
            if (!isNoise(p)) out += p
        }
        return out
    }

    private fun joinParagraphs(lines: List<String>): List<String> {
        val paras = ArrayList<String>()
        val buf = StringBuilder()
        for (line in lines) {
            val s = line.trim()
            if (s.isEmpty()) {
                if (buf.isNotEmpty()) {
                    paras += buf.toString()
                    buf.setLength(0)
                }
                continue
            }
            when {
                buf.isEmpty() -> buf.append(s)
                buf.endsWith("-") && s[0].isLowerCase() -> {
                    buf.setLength(buf.length - 1) // de-hyphenate "exam-\nple"
                    buf.append(s)
                }
                else -> buf.append(' ').append(s)
            }
        }
        if (buf.isNotEmpty()) paras += buf.toString()

        // Blocks often split mid-sentence across columns/pages; merge those back.
        val merged = ArrayList<String>()
        for (p in paras) {
            if (merged.isNotEmpty() && !PARA_END.containsMatchIn(merged.last()) && p[0].isLowerCase()) {
                merged[merged.size - 1] = merged.last() + " " + p
            } else {
                merged += p
            }
        }
        return merged
    }

    private fun speakable(text: String): String {
        var t = text
        for ((k, v) in SPOKEN) t = t.replace(k, v)
        t = CONTROL.replace(t, "")
        t = SPACE_BEFORE_PUNCT.replace(t, "$1")
        return MULTI_SPACE.replace(t, " ").trim()
    }

    private fun isNoise(p: String): Boolean {
        if (p.length < 3) return true
        // Equations, tables of numbers and symbol soup read terribly aloud.
        return p.count { it.isLetter() }.toDouble() / p.length < 0.5
    }

    /** Splits paragraphs longer than the TTS engine accepts, at sentence boundaries. */
    fun splitLong(p: String, limit: Int = 3000): List<String> {
        if (p.length <= limit) return listOf(p)
        val out = ArrayList<String>()
        val buf = StringBuilder()
        for (sentence in p.split(SENTENCE_BREAK)) {
            var s = sentence
            while (s.length > limit) {
                if (buf.isNotEmpty()) {
                    out += buf.toString()
                    buf.setLength(0)
                }
                out += s.substring(0, limit)
                s = s.substring(limit)
            }
            if (buf.isNotEmpty() && buf.length + s.length + 1 > limit) {
                out += buf.toString()
                buf.setLength(0)
            }
            if (buf.isNotEmpty()) buf.append(' ')
            buf.append(s)
        }
        if (buf.isNotBlank()) out += buf.toString()
        return out
    }
}
