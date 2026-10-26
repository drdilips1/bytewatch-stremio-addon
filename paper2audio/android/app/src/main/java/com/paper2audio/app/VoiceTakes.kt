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
                        java.io.File(dir, "take$i.wav").also { LocalTts.writeWav(it, LocalTts.synthesize(voiceId, LINE, 1f, "en", seed = s)) }
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
