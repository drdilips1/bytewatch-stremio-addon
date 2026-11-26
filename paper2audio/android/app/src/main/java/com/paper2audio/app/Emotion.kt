package com.paper2audio.app

import java.io.File

/**
 * Emotional character for copied voices, from the story's own cues. A line of dialogue whose sentence says
 * how it was spoken ("she whispered", "he roared", "she sobbed", "he laughed", "snapped", "stammered",
 * "gently"…) is shaped after the voice makes it: whispers softer and slower, shouts louder and quicker, sad
 * lines softer and slower, and so on. Subtle on purpose: the same person, in a mood. Pitch is never shifted
 * (that changed the voice's timbre: naturalness 3.80 -> 3.54 on the test bench); loudness and pace cost
 * almost nothing (0.97x pace: 3.80 -> 3.80).
 * Narration (no quote marks) is never shaped.
 */
object Emotion {
    /** How a mood changes a line: loudness (dB), pace (1 = as made) and pitch (semitones). */
    class Shape(val name: String, val gainDb: Float, val tempo: Float, val semitones: Float)

    private fun cue(p: String) = Regex(p, RegexOption.IGNORE_CASE)

    // First match wins (a whisper that also "laughed" is still a whisper).
    private val MOODS = listOf(
        Shape("whisper", -6f, 0.95f, 0f) to cue("""\b(whisper\w*|murmur\w*|breathed|under (?:his|her|their|my|its) breath|(?:said|asked|added|replied) (?:softly|quietly)|hushed)\b"""),
        Shape("shout", 3f, 1.05f, 0f) to cue("""\b(shout\w*|yell\w*|scream\w*|roar\w*|bellow\w*|howl\w*|cried out|at the top of (?:his|her|their|my) (?:voice|lungs))\b"""),
        Shape("angry", 2f, 1.04f, 0f) to cue("""\b(snapped|snarl\w*|growl\w*|spat|angrily|furiously|irritably|impatiently|fiercely|savagely|hissed)\b"""),
        Shape("sad", -2f, 0.93f, 0f) to cue("""\b(sob\w*|wept|weeping|sigh(?:ed|ing)|sadly|mournfully|tearfully|choked|miserably|sorrowfully|wistfully)\b"""),
        Shape("fear", 0f, 1.05f, 0f) to cue("""\b(stammer\w*|stutter\w*|trembl\w*|nervously|fearfully|gasp\w*|shakily|whimper\w*|anxiously)\b"""),
        Shape("gentle", -2f, 0.97f, 0f) to cue("""\b(gently|softly|quietly|kindly|tenderly|calmly|soothingly)\b"""),
        Shape("happy", 1f, 1.03f, 0f) to cue("""\b(laugh\w*|giggl\w*|chuckl\w*|beam\w*|cheerfully|happily|brightly|excitedly|grinn\w*|delightedly|gleefully)\b"""),
    )

    /** The mood a piece of book text is spoken in, or null (narration, or no cue). */
    fun of(text: String): Shape? {
        if (text.none { it == '"' || it == '“' || it == '”' }) return null
        return MOODS.firstOrNull { it.second.containsMatchIn(text) }?.first
    }

    /** [pcm] with [s]'s pace and pitch (its loudness is applied at playback: see [gainFile]). */
    fun shape(pcm: LocalTts.Pcm, s: Shape): LocalTts.Pcm {
        val buf = java.nio.ByteBuffer.wrap(pcm.bytes).order(java.nio.ByteOrder.LITTLE_ENDIAN).asShortBuffer()
        var x = FloatArray(buf.remaining()) { buf.get(it) / 32768f }
        val f = Math.pow(2.0, s.semitones / 12.0).toFloat()
        if (kotlin.math.abs(s.tempo - 1f) > 1e-3f || kotlin.math.abs(s.semitones) > 1e-3f) {
            x = wsola(x, s.tempo / f, pcm.sampleRate)
            if (kotlin.math.abs(s.semitones) > 1e-3f) x = resample(x, f)
        }
        val out = ByteArray(x.size * 2)
        for ((i, v) in x.withIndex()) {
            val q = (v.coerceIn(-1f, 1f) * 32767f).toInt()
            out[2 * i] = (q and 0xff).toByte()
            out[2 * i + 1] = ((q shr 8) and 0xff).toByte()
        }
        return LocalTts.Pcm(out, pcm.sampleRate)
    }

    /**
     * The player evens out every sentence's loudness; a whisper must stay soft and a shout loud, so the
     * mood's loudness is kept beside the audio (this file) and applied after the evening out.
     */
    fun gainFile(audio: File) = File(audio.path + ".gain")

    fun gainOf(audio: File): Float = runCatching { gainFile(audio).readText().toFloat() }.getOrDefault(0f)

    /**
     * WSOLA time stretch: output length = input length / [rate], pitch kept. 40 ms frames, half overlap; each
     * frame is placed where it best continues the last (normalised correlation, every sample within ±10 ms),
     * so voices don't warble.
     */
    internal fun wsola(x: FloatArray, rate: Float, sampleRate: Int): FloatArray {
        val frame = sampleRate / 25
        val hop = frame / 2
        val tol = sampleRate / 100
        val nOut = (x.size / rate).toInt()
        if (nOut <= frame || x.size <= frame) return x
        val win = FloatArray(frame) { (0.5 - 0.5 * kotlin.math.cos(2 * Math.PI * it / (frame - 1))).toFloat() }
        // Room after the end: the next frame is compared half a frame past the last one placed.
        val xp = FloatArray(tol + x.size + 2 * frame + 2 * tol).also { System.arraycopy(x, 0, it, tol, x.size) }
        val limit = xp.size - frame - hop - 1
        val out = FloatArray(nOut + frame)
        val norm = FloatArray(nOut + frame)
        var prev = -1
        var k = 0
        while (k * hop < nOut) {
            val c = ((k * hop * rate).toInt() + tol).coerceAtMost(limit)
            val best = if (prev < 0) c else {
                val lo = maxOf(0, c - tol)
                val hi = minOf(limit, c + tol)
                val t = prev + hop
                // Energy of the candidate frame, kept as a running sum while the frame slides.
                var energy = 0.0
                for (i in 0 until frame) energy += xp[lo + i] * xp[lo + i]
                var bestPos = lo
                var bestScore = Double.NEGATIVE_INFINITY
                for (p in lo..hi) {
                    if (p > lo) {
                        val gone = xp[p - 1]; val come = xp[p + frame - 1]
                        energy += come * come - gone * gone
                    }
                    var dot = 0.0
                    for (i in 0 until frame) dot += xp[p + i] * xp[t + i]
                    val sc = dot / (kotlin.math.sqrt(maxOf(energy, 0.0)) + 1e-6)
                    if (sc > bestScore) { bestScore = sc; bestPos = p }
                }
                bestPos
            }
            val o = k * hop
            for (i in 0 until frame) {
                if (o + i >= out.size) break
                out[o + i] += xp[best + i] * win[i]
                norm[o + i] += win[i]
            }
            prev = best
            k++
        }
        return FloatArray(nOut) { if (norm[it] > 1e-3f) out[it] / norm[it] else out[it] }
    }

    /** Linear resampling: output length = input length / [f] (pitch × f). */
    internal fun resample(x: FloatArray, f: Float): FloatArray {
        val n = (x.size / f).toInt()
        if (n < 2 || x.size < 2) return x
        return FloatArray(n) { i ->
            val pos = i * f
            val j = pos.toInt().coerceAtMost(x.size - 2)
            val fr = pos - j
            x[j] * (1 - fr) + x[j + 1] * fr
        }
    }
}
