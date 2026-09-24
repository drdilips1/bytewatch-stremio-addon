package com.paper2audio.app

data class Chapter(val title: String, val start: Int)

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
) {
    val words: Int = paragraphs.sumOf { p -> p.count { it == ' ' } + 1 }

    fun chapterAt(index: Int): Chapter? = chapters.lastOrNull { it.start <= index }

    companion object {
        fun build(
            title: String,
            key: String,
            sections: List<Pair<String?, List<String>>>,
            author: String? = null,
            cover: ByteArray? = null,
            pages: Int = 0,
        ): Doc {
            val paragraphs = ArrayList<String>()
            val chapters = ArrayList<Chapter>()
            for ((name, paras) in sections) {
                if (paras.isEmpty()) continue
                if (name != null) chapters += Chapter(name, paragraphs.size)
                paras.forEach { paragraphs += TextCleaner.splitLong(it) }
            }
            return Doc(title, paragraphs, chapters, key, author?.trim()?.ifBlank { null }, cover, pages)
        }
    }
}
