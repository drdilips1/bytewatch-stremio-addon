package com.paper2audio.app

/**
 * Speaking styles: how fast and with what pauses a document is read. The rate
 * multiplies the chosen speed; pauses are added between sentences, after
 * paragraphs and after headings.
 */
enum class Style(
    val label: String,
    val note: String,
    val rate: Float,
    val sentencePause: Int,
    val paragraphPause: Int,
    val headingPause: Int,
) {
    STANDARD("Standard", "natural pace and pauses", 1.0f, 200, 450, 800),
    ACADEMIC("Academic", "clear and measured, with room between sections", 0.97f, 260, 600, 1000),
    CONVERSATIONAL("Conversational", "lighter and a little quicker", 1.06f, 140, 360, 650),
    STORYTELLING("Storytelling", "unhurried, for novels and stories", 0.95f, 300, 700, 1100),
    LECTURE("Lecture", "slower, with long pauses, like a class", 0.92f, 380, 850, 1400);

    companion object {
        fun of(name: String?) = entries.firstOrNull { it.name == name } ?: STANDARD
    }
}
