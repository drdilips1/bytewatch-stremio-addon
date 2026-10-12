package com.paper2audio.app

import android.app.Activity
import android.app.AlertDialog
import android.widget.Toast
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Full cast: the characters of the book, and the voice each one has; tap one to choose. */
object CastPicker {
    fun show(activity: Activity, scope: CoroutineScope) {
        val doc = Speaker.doc ?: return
        if (!Speaker.fullCast) {
            AlertDialog.Builder(activity)
                .setTitle("Characters and voices")
                .setMessage("Full cast gives each character in a story their own voice. Turn it on?")
                .setPositiveButton("Turn on") { _, _ ->
                    Speaker.setFullCast(true)
                    show(activity, scope)
                }
                .setNegativeButton("Not now", null)
                .show()
            return
        }
        Toast.makeText(activity, "Finding the characters…", Toast.LENGTH_SHORT).show()
        scope.launch {
            val rows = withContext(Dispatchers.Default) {
                Cast.characters(doc).map { (name, lines) ->
                    Triple(name, lines, Speaker.voiceOfCharacter(doc, name) to Speaker.genderOfCharacter(doc, name))
                }
            }
            if (activity.isFinishing) return@launch
            if (rows.isEmpty()) {
                AlertDialog.Builder(activity)
                    .setTitle("Characters and voices")
                    .setMessage("No speaking characters found yet. They're found from lines like “…,” said Maya.")
                    .setPositiveButton("OK", null)
                    .show()
                return@launch
            }
            val chosen = Speaker.userCast(doc)
            val labels = rows.map { (name, lines, info) ->
                val (voice, gender) = info
                val who = when (gender) {
                    "female" -> "woman"
                    "male" -> "man"
                    "girl" -> "girl"
                    "boy" -> "boy"
                    else -> "not sure"
                }
                val mark = if (chosen.containsKey(name)) "✓ " else ""
                "$mark$name · $who · $lines lines\n   ${voiceName(voice)}"
            }
            AlertDialog.Builder(activity)
                .setTitle("Characters and voices")
                .setItems(labels.toTypedArray()) { _, which -> choose(activity, scope, doc, rows[which].first) }
                .setNegativeButton("Close", null)
                .show()
        }
    }

    private fun voiceName(id: String): String = when {
        id.contains("AnaNeural") -> "Ana (child)" + if ('@' in id) ", a little lower" else ""
        id.contains("MaisieNeural") -> "Maisie (child)" + if ('@' in id) ", a little lower" else ""
        else -> VoicePicker.label(id).substringBefore(" · ")
    }

    private fun choose(activity: Activity, scope: CoroutineScope, doc: Doc, name: String) {
        val options = arrayOf(
            "$name is a woman\nA female voice, picked for you",
            "$name is a man\nA male voice, picked for you",
            "$name is a girl\nA child's voice",
            "$name is a boy\nA child's voice, a little lower",
            "Choose a woman's voice…",
            "Choose a man's voice…",
            "Choose any voice…",
            "Automatic\nGuessed from the story",
        )
        AlertDialog.Builder(activity)
            .setTitle(name)
            .setItems(options) { _, which ->
                fun done(value: String?) {
                    Speaker.setUserCast(doc, name, value)
                    Toast.makeText(activity, "$name: ${value?.let { if (it.startsWith("gender:")) it.removePrefix("gender:") + "'s voice" else voiceName(it) } ?: "automatic"}", Toast.LENGTH_SHORT).show()
                    show(activity, scope)
                }
                val current = Speaker.voiceOfCharacter(doc, name)
                when (which) {
                    0 -> done("gender:female")
                    1 -> done("gender:male")
                    2 -> done("gender:girl")
                    3 -> done("gender:boy")
                    4 -> VoicePicker.pickOne(activity, "Voice for $name", current, { it.male == false }) { done(it) }
                    5 -> VoicePicker.pickOne(activity, "Voice for $name", current, { it.male == true }) { done(it) }
                    6 -> VoicePicker.pickOne(activity, "Voice for $name", current) { done(it) }
                    else -> done(null)
                }
            }
            .show()
    }
}
