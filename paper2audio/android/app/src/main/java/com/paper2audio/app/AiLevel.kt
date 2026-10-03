package com.paper2audio.app

import android.content.Context

/**
 * How much AI the listener wants: none at all (a pure audiobook), AI on request (the
 * default), or AI immersion (a briefing before a new book, and a short recap with a
 * question at the end of every chapter).
 */
enum class AiLevel(val label: String, val note: String) {
    PURE("🟢 Pure audiobook", "No AI anywhere: just the book."),
    ASSISTED("🔵 AI-assisted", "Narration, with Ask AI and explanations whenever you want them."),
    IMMERSION("🟣 AI immersion", "At the end of every chapter, AI recaps it and gives you a question to think about, then the book goes on.");

    companion object {
        fun of(context: Context): AiLevel =
            context.getSharedPreferences("p2a", Context.MODE_PRIVATE).getString("aiLevel", null)
                ?.let { n -> entries.firstOrNull { it.name == n } } ?: ASSISTED

        fun set(context: Context, level: AiLevel) =
            context.getSharedPreferences("p2a", Context.MODE_PRIVATE).edit().putString("aiLevel", level.name).apply()
    }
}
