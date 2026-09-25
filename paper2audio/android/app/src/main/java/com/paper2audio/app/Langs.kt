package com.paper2audio.app

import com.google.android.gms.tasks.Tasks
import com.google.mlkit.nl.languageid.LanguageIdentification
import java.util.Locale

/** Detects a document's language on the phone (Google ML Kit), to pick fitting voices. */
object Langs {
    private val client by lazy { LanguageIdentification.getClient() }

    /** The language of [doc] ("en", "hi", …), detected once from samples of its text. Call off the main thread. */
    fun of(doc: Doc): String {
        doc.lang?.let { return it }
        val paras = doc.paragraphs
        val sample = if (paras.isEmpty()) "" else listOf(0.2, 0.5, 0.8)
            .map { paras[(paras.size * it).toInt().coerceAtMost(paras.size - 1)] }
            .joinToString(" ") { it.take(700) }
        val lang = detect(sample) ?: "en"
        doc.lang = lang
        return lang
    }

    fun detect(text: String): String? = runCatching {
        Tasks.await(client.identifyLanguage(text)).takeIf { it != "und" }?.substringBefore('-')
    }.getOrNull()

    fun name(code: String): String = Locale.forLanguageTag(code).getDisplayLanguage(Locale.ENGLISH).ifBlank { code }
}
