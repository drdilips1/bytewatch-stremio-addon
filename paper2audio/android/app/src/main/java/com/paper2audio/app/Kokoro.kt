package com.paper2audio.app

/**
 * Kokoro: an open-source voice model that runs on the phone (see [LocalTts]).
 * The model (~350 MB) is downloaded on first use.
 */
object Kokoro {
    data class KVoice(val name: String, val sid: Int, val label: String) {
        val british get() = name.startsWith("b")
    }

    /** Best-rated English voices of kokoro-multi-lang-v1_0; sid is the speaker index in voices.bin. */
    val VOICES = listOf(
        KVoice("af_heart", 3, "Heart · US English · female"),
        KVoice("af_bella", 2, "Bella · US English · female"),
        KVoice("af_nicole", 6, "Nicole · US English · female (soft)"),
        KVoice("af_sarah", 9, "Sarah · US English · female"),
        KVoice("af_aoede", 1, "Aoede · US English · female"),
        KVoice("af_kore", 5, "Kore · US English · female"),
        KVoice("am_michael", 16, "Michael · US English · male"),
        KVoice("am_fenrir", 14, "Fenrir · US English · male"),
        KVoice("am_puck", 18, "Puck · US English · male"),
        KVoice("am_echo", 12, "Echo · US English · male"),
        KVoice("bf_emma", 21, "Emma · British English · female"),
        KVoice("bf_isabella", 22, "Isabella · British English · female"),
        KVoice("bm_george", 26, "George · British English · male"),
        KVoice("bm_fable", 25, "Fable · British English · male"),
        KVoice("bm_daniel", 24, "Daniel · British English · male"),
    )

    fun voice(name: String): KVoice? = VOICES.firstOrNull { it.name == name }
}
