package com.paper2audio.app

import android.app.Activity
import android.app.AlertDialog
import android.widget.Toast
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * "Pick the best take": the same recording copied twice can sound like two people, as the engine's seed
 * decides. Four takes of one line (the voice's own and three others) to hear one after another; the one
 * kept is used for every sentence from then on, and goes with the voice when it's shared.
 */
object VoiceTakes {
    /** One line for every take: a little narration and a little speech, as in a book. */
    private const val LINE = "She opened the door, looked outside, and smiled. \u201CNearly there,\u201D she said quietly, \u201Cjust a little further.\u201D"

    /**
     * The line as the voices are given text when reading a book (quote marks out, as Renderer does): given the
     * quote marks, the copies stumbled, and the takes started oddly and sounded unlike the voice.
     */
    private fun spoken(text: String) = Renderer.plainQuotes(Speech.normalize(text))

    /**
     * One take as a book is read: the line in the same pieces (a sentence or so each), each made on its own,
     * with the voice's own pause between them. The whole line in one go sounded unlike the reading.
     */
    private fun take(voiceId: String, id: String, seed: Int): LocalTts.Pcm {
        val parts = Renderer.pieces(LINE, voiceId).map { LocalTts.synthesize(voiceId, spoken(it), 1f, "en", seed = seed) }
        val rate = parts.first().sampleRate
        val gap = ByteArray(rate * 2 * (MyVoices.pauseOf(id).takeIf { it > 0 } ?: 450) / 1000)
        val out = java.io.ByteArrayOutputStream()
        parts.forEachIndexed { i, p -> if (i > 0) out.write(gap); out.write(p.bytes) }
        return LocalTts.Pcm(out.toByteArray(), rate)
    }

    /** Closes [dialog] if its screen is still there: closing it after the screen went away crashed the app. */
    private fun closeSafely(activity: Activity, dialog: AlertDialog) {
        if (!activity.isDestroyed && dialog.isShowing) runCatching { dialog.dismiss() }
    }

    fun pick(activity: Activity, scope: CoroutineScope, v: MyVoices.Voice, kept: () -> Unit = {}) {
        Speaker.stopPreview()
        val voiceId = Speaker.CLONE + v.id
        val current = LocalTts.currentSeed(voiceId)
        val seeds = listOf(current) + generateSequence { kotlin.random.Random.nextInt(1, 100_000) }.filter { it != current }.distinct().take(3)
        val dir = java.io.File(activity.cacheDir, "takes").apply { mkdirs(); listFiles()?.forEach { it.delete() } }
        val progress = AlertDialog.Builder(activity)
            .setTitle("Making four takes…")
            .setMessage("About half a minute. Each one reads the same line.")
            .setCancelable(false)
            .show()
        scope.launch {
            val files = try {
                withContext(Dispatchers.Default) {
                    seeds.mapIndexed { i, s ->
                        java.io.File(dir, "take$i.wav").also { LocalTts.writeWav(it, take(voiceId, v.id, s)) }
                    }
                }
            } catch (e: kotlinx.coroutines.CancellationException) {
                // The screen closed while the takes were being made (back, rotation): nothing to show.
                closeSafely(activity, progress)
                throw e
            } catch (e: Exception) {
                AppLog.e("Takes", "Couldn't make the takes", e)
                closeSafely(activity, progress)
                if (!activity.isFinishing && !activity.isDestroyed) Toast.makeText(activity, e.message ?: "Couldn't make the takes", Toast.LENGTH_LONG).show()
                return@launch
            }
            // The other takes went into the voice's treble match (each take is brighter or duller): learned afresh.
            Brightness.forget(activity, v.id)
            closeSafely(activity, progress)
            if (activity.isFinishing || activity.isDestroyed) return@launch
            var player: android.media.MediaPlayer? = null
            fun play(i: Int) {
                player?.release()
                player = android.media.MediaPlayer().apply {
                    setDataSource(files[i].path)
                    prepare()
                    start()
                }
            }
            var chosen = 0
            val labels = seeds.indices.map { i -> if (i == 0) "Take 1 (the one it has now)" else "Take ${i + 1}" }.toTypedArray()
            AlertDialog.Builder(activity)
                .setTitle("Tap a take to hear it")
                .setSingleChoiceItems(labels, 0) { _, which ->
                    chosen = which
                    runCatching { play(which) }
                }
                .setPositiveButton("Keep this take") { _, _ ->
                    if (seeds[chosen] != current) MyVoices.setSeed(v.id, seeds[chosen])
                    Speaker.refreshVoices()
                    Toast.makeText(activity, "\u201C${v.name}\u201D now reads with take ${chosen + 1}", Toast.LENGTH_LONG).show()
                    kept()
                }
                .setNegativeButton("Cancel", null)
                .setOnDismissListener { player?.release() }
                .show()
            runCatching { play(0) }
        }
    }
}
