package com.paper2audio.app

data class Chapter(val title: String, val start: Int) {
    /** Introduction, Methods, Results… (see [Sections]), for "skip Methods" and similar. */
    val kind: String? get() = Sections.kindOf(title)
}

/** A figure or table found in a PDF: its label ("Figure 3"), caption and page (1-based). */
data class Figure(val label: String, val caption: String, val page: Int)

/** A loaded document: paragraphs are the unit of playback and navigation. */
class Doc(
    val title: String,
    val paragraphs: List<String>,
    val chapters: List<Chapter>,
    /** Identifies the source file, used to remember the listening position. */
    val key: String,
    val author: String? = null,
    /** Cover image bytes (EPUB), used for the library thumbnail. */
    val cover: ByteArray? = null,
    val pages: Int = 0,
    /** Figures and tables with their pages (PDFs), for "View Figure 3" while listening. */
    val figures: List<Figure> = emptyList(),
) {
    val words: Int = paragraphs.sumOf { p -> p.count { it == ' ' } + 1 }

    /** The detected language (ISO 639-1, e.g. "en", "hi"); see [Langs]. */
    @Volatile
    var lang: String? = null

    fun chapterAt(index: Int): Chapter? = chapters.lastOrNull { it.start <= index }

    companion object {
        fun build(
            title: String,
            key: String,
            sections: List<Pair<String?, List<String>>>,
            author: String? = null,
            cover: ByteArray? = null,
            pages: Int = 0,
            figures: List<Figure> = emptyList(),
        ): Doc {
            val paragraphs = ArrayList<String>()
            val chapters = ArrayList<Chapter>()
            for ((name, paras) in sections) {
                if (paras.isEmpty()) continue
                if (name != null) chapters += Chapter(name, paragraphs.size)
                paras.forEach { paragraphs += TextCleaner.splitLong(TextCleaner.smartQuotes(it)) }
            }
            return Doc(title, paragraphs, chapters, key, author?.trim()?.ifBlank { null }, cover, pages, figures)
        }
    }
}

/** Recognizes the usual parts of a paper from their headings. */
object Sections {
    private val KINDS = listOf(
        "Abstract" to Regex("""^(abstract|summary|executive summary|synopsis)$"""),
        "Introduction" to Regex("""^(introduction|background|overview|rationale|introduction and background)$"""),
        "Methods" to Regex("""^(methods?|materials?( and|&) methods?|methodology|patients( and|&) methods|subjects( and|&) methods|study design|experimental( procedures| section| methods)?|methods and materials)$"""),
        "Results" to Regex("""^(results?|findings|results and discussion|experiments|evaluation)$"""),
        "Discussion" to Regex("""^(discussion|general discussion|interpretation)$"""),
        "Limitations" to Regex("""^(limitations?|strengths and limitations|study limitations)$"""),
        "Conclusion" to Regex("""^(conclusions?|concluding remarks|summary and conclusions?|implications)$"""),
        "References" to Regex("""^(references|bibliography|works cited|literature cited)$"""),
    )
    private val NUMBERING = Regex("""^\s*(?:\d+(?:\.\d+)*\.?|[IVX]+\.|[A-Z]\.)\s*""")

    fun kindOf(title: String): String? {
        val t = NUMBERING.replace(title, "").trim().trimEnd(':', '.').lowercase()
        return KINDS.firstOrNull { it.second.matches(t) }?.first
    }
}
