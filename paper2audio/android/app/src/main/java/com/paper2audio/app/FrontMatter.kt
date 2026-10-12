package com.paper2audio.app

/**
 * Parts of a book that aren't the book itself: contents, copyright, dedication, preface,
 * acknowledgements, index… With "Skip front and back matter" on, listening starts at the
 * introduction or first chapter and stops before the index.
 */
object FrontMatter {
    private val TITLES = Regex(
        """^(?:(?:table of )?contents|index|preface|foreword|fore-word|acknowledg(?:e)?ments?|dedication|copyright(?: page)?|""" +
            """title page|half[- ]title|cover|imprint|colophon|epigraph|about the authors?|about the publisher|also by .*|""" +
            """by the same author|other books by .*|praise for .*|advance praise|list of (?:figures|tables|illustrations|abbreviations|maps)|""" +
            """(?:end)?notes|bibliography|references|further reading|permissions|credits|copyright acknowledgments|""" +
            """a note on the (?:text|type|translation)|reading group guide|discussion questions)$""",
    )
    private val NUMBERING = Regex("""^\s*(?:\d+(?:\.\d+)*\.?|[IVXivx]+\.)\s*""")
    private val LEGAL = Regex("""(?i)\b(copyright|all rights reserved|isbn|printed in|published by|first published|library of congress)\b""")

    fun isFrontOrBack(title: String): Boolean {
        val t = NUMBERING.replace(title, "").trim().trimEnd(':', '.').lowercase()
        return t.isNotEmpty() && TITLES.matches(t)
    }

    /** The paragraphs before the first chapter are front matter (copyright pages and the like). */
    fun leadingIsFrontMatter(doc: Doc): Boolean {
        val first = doc.chapters.firstOrNull()?.start ?: return false
        if (first == 0 || first > 60) return false
        val lead = doc.paragraphs.subList(0, first)
        return lead.any { LEGAL.containsMatchIn(it) } || lead.sumOf { it.length } < 1_500
    }

    /** The chapter titles to skip in [doc]. */
    fun skippable(doc: Doc): Set<String> = doc.chapters.map { it.title }.filter(::isFrontOrBack).toSet()
}
