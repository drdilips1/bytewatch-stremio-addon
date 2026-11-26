package com.paper2audio.app

import android.app.Activity
import android.widget.Toast
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Narrato Character Studio: the book's characters, each with their own voice. Characters are found from the
 * story itself ("…," said Maya; she asked), their voices stay with them for the whole book and the author's
 * other books, and the listener can hear a character's own line and recast them. Built on the full cast
 * ([Cast], [Speaker.castVoice]); the voices are the narrator's family (Narrato's readers, or the light voices).
 */
object CharacterStudio {
    /**
     * Off for now (user decision, 26 Nov 2026: battery first): no menu rows, and Narrato reads with one voice
     * even if the voice cast was turned on. Kept, to be used later: set to true to bring it all back.
     */
    const val ENABLED = false

    fun show(activity: Activity, scope: CoroutineScope) {
        val doc = Speaker.doc ?: return toast(activity, "Open a book first.")
        val sheet = LiteSheet(activity, "Character Studio", doc.title)
        fun fill(rows: List<Triple<String, Int, String>>?) {
            sheet.clear()
            val on = Speaker.fullCast
            sheet.row(
                R.drawable.ic_people,
                if (on) "Voice cast is on" else "Voice cast is off",
                if (on) "Every character speaks in their own voice · tap to turn off" else "Turn on to give every character their own voice",
                checked = on, dismiss = false,
            ) {
                Speaker.setFullCast(!on)
                sheet.dismiss()
                show(activity, scope)
            }
            sheet.row(R.drawable.ic_voice, "Narrator", name(Speaker.voiceId) + " · the story and anyone not known", dismiss = true) {
                LiteUi.showVoices(activity)
            }
            if (!on) return
            sheet.section("Characters")
            when {
                rows == null -> sheet.row(R.drawable.ic_people, "Finding the characters…", "From lines like “…,” said Maya", dismiss = false) {}
                rows.isEmpty() -> sheet.row(R.drawable.ic_people, "No speaking characters found yet", "They're found from lines like “…,” said Maya", dismiss = false) {}
                else -> {
                    val chosen = Speaker.userCast(doc)
                    for ((who, lines, voice) in rows) {
                        val mine = chosen[who]?.let { !it.startsWith("gender:") } == true
                        sheet.row(
                            R.drawable.ic_voice, who,
                            "${name(voice)} · ${kind(Speaker.genderOfCharacter(doc, who))} · $lines lines" + if (mine) " · your choice" else "",
                        ) { character(activity, scope, doc, who, lines) }
                    }
                }
            }
        }
        fill(if (Speaker.fullCast) null else emptyList())
        sheet.show()
        if (!Speaker.fullCast) return
        scope.launch {
            val rows = withContext(Dispatchers.Default) {
                runCatching { Cast.characters(doc).map { (who, lines) -> Triple(who, lines, Speaker.voiceOfCharacter(doc, who)) } }.getOrDefault(emptyList())
            }
            if (!activity.isFinishing && sheet.isShowing) fill(rows)
        }
    }

    /** One character: hear their own line, choose their voice, or let Narrato choose. */
    private fun character(activity: Activity, scope: CoroutineScope, doc: Doc, who: String, lines: Int) {
        val line = sampleLine(doc, who)
        val sheet = LiteSheet(activity, who, "${kind(Speaker.genderOfCharacter(doc, who))} · $lines lines")
        fun fill() {
            sheet.clear()
            val current = Speaker.voiceOfCharacter(doc, who)
            if (line != null) sheet.row(R.drawable.ic_play, "Hear $who", "“${line.take(90)}${if (line.length > 90) "…" else ""}”", dismiss = false) {
                Speaker.preview(line, current)
            }
            sheet.section("Voice")
            for (v in Speaker.castCandidates()) {
                sheet.row(R.drawable.ic_voice, name(v), detail(v), checked = v == current, dismiss = false) {
                    Speaker.setUserCast(doc, who, v)
                    if (line != null) Speaker.preview(line, v)
                    fill()
                }
            }
            sheet.section("Or let Narrato choose")
            val auto = Speaker.userCast(doc)[who]
            for ((value, label) in listOf(
                null to "Automatic (from the story)",
                "gender:female" to "A woman's voice",
                "gender:male" to "A man's voice",
                "gender:girl" to "A girl's voice",
                "gender:boy" to "A boy's voice",
            )) {
                sheet.row(R.drawable.ic_people, label, null, checked = auto == value, dismiss = false) {
                    Speaker.setUserCast(doc, who, value)
                    fill()
                }
            }
        }
        fill()
        sheet.onDismiss {
            Speaker.stopPreview()
            show(activity, scope)
        }
        sheet.show()
    }

    /** One of [who]'s own lines (a full one, not "Yes."), to hear them by. */
    private fun sampleLine(doc: Doc, who: String): String? {
        val said = runCatching { Cast.of(doc).segments.values.flatten().filter { it.speaker == who }.map { it.text.trim() } }.getOrDefault(emptyList())
            .map { it.trim('“', '”', '"', '‘', '’', '\'', ' ', ',') }
        return said.firstOrNull { it.length in 30..200 } ?: said.maxByOrNull { it.length }
    }

    private fun name(id: String) = VoicePicker.label(id).substringBefore(" · ")

    private fun detail(id: String) = VoicePicker.label(id).substringAfter(" · ", "").ifBlank { null }

    private fun kind(gender: String?) = when (gender) {
        "female" -> "woman"
        "male" -> "man"
        "girl" -> "girl"
        "boy" -> "boy"
        else -> "not sure"
    }

    private fun toast(activity: Activity, text: String) = Toast.makeText(activity, text, Toast.LENGTH_SHORT).show()
}
