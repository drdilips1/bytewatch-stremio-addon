package com.paper2audio.app

import android.app.Activity
import android.app.AlertDialog
import android.graphics.Color
import android.os.Build
import android.speech.tts.TextToSpeech
import android.view.Gravity
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.TextView
import java.util.Locale

/** Pieces shared by the Play Store edition's two screens. */
object LiteUi {
    /**
     * Android 15+ draws apps under the status and navigation bars; pads [root] so
     * nothing hides behind them (or behind the keyboard), with matching bar icons.
     */
    fun fitSystemBars(activity: Activity, root: View) {
        if (Build.VERSION.SDK_INT < 30) return
        activity.window.setDecorFitsSystemWindows(false)
        root.setOnApplyWindowInsetsListener { v, insets ->
            val b = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime() or WindowInsets.Type.displayCutout())
            v.setPadding(b.left, b.top, b.right, b.bottom)
            WindowInsets.CONSUMED
        }
        val bg = Themes.color(activity, R.attr.p2aBg)
        val light = (Color.red(bg) * 299 + Color.green(bg) * 587 + Color.blue(bg) * 114) / 1000 > 140
        val mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
        activity.window.insetsController?.setSystemBarsAppearance(if (light) mask else 0, mask)
    }

    fun dp(activity: Activity, v: Int) = (v * activity.resources.displayMetrics.density).toInt()

    // ---- Voice ----

    /** Short name of the current voice for the Voice button. */
    fun voiceName(id: String = Speaker.voiceId): String = when {
        id == Speaker.PHONE_DEFAULT -> "Phone voice"
        id.startsWith(Speaker.SYSTEM) -> "Phone · " + id.removePrefix(Speaker.SYSTEM).take(18)
        id.startsWith(Speaker.SUPER) -> supertonicName(id.removePrefix(Speaker.SUPER))
        id.startsWith(Speaker.KOKORO) -> Kokoro.VOICES.firstOrNull { Speaker.KOKORO + it.name == id }?.label?.substringBefore(" ·") ?: "Kokoro"
        else -> "Voice"
    }

    private val SUPER_NAMES = mapOf(
        "F1" to "Mia", "F2" to "Lena", "F3" to "Ruby", "F4" to "Iris", "F5" to "Nora",
        "M1" to "Leo", "M2" to "Owen", "M3" to "Max", "M4" to "Eli", "M5" to "Sam",
    )

    private fun supertonicName(code: String) = SUPER_NAMES[code] ?: code

    /**
     * The voice picker: the phone's voice (instant), then natural on-device voices
     * with their one-time download shown as percent and megabytes. Tapping a voice
     * plays a short sample; the sheet stays open to try others.
     */
    fun showVoices(activity: Activity, onChosen: () -> Unit = {}) {
        val sheet = LiteSheet(activity, "Choose a voice", "Tap a voice to hear it")
        val listener: () -> Unit = { if (sheet.isShowing) fillVoices(activity, sheet, onChosen) }
        ModelPack.addListener(listener)
        sheet.onDismiss {
            ModelPack.removeListener(listener)
            Speaker.stopPreview()
        }
        fillVoices(activity, sheet, onChosen)
        sheet.show()
    }

    private fun fillVoices(activity: Activity, sheet: LiteSheet, onChosen: () -> Unit) {
        sheet.clear()
        fun choice(id: String, title: String, subtitle: String) {
            sheet.row(R.drawable.ic_voice, title, subtitle, checked = id == Speaker.voiceId, dismiss = false) {
                Speaker.setVoice(id)
                if (!Speaker.playing) Speaker.preview(voice = id)
                onChosen()
                fillVoices(activity, sheet, onChosen)
            }
        }
        fun pack(p: ModelPack, voices: List<Triple<String, String, String>>) {
            when {
                p.isInstalled() -> {
                    voices.forEach { (id, title, sub) -> choice(id, title, sub) }
                    sheet.row(R.drawable.ic_delete, "Delete these voices", "Frees ${p.sizeMb} MB; download again any time", dismiss = false) {
                        AlertDialog.Builder(activity)
                            .setMessage("Delete ${p.title}? You can download them again any time.")
                            .setPositiveButton("Delete") { _, _ ->
                                if (LocalTts.packFor(Speaker.voiceId) === p) Speaker.setVoice(Speaker.PHONE_DEFAULT)
                                p.uninstall { fillVoices(activity, sheet, onChosen) }
                            }
                            .setNegativeButton("Cancel", null)
                            .show()
                    }
                }
                p.installing -> {
                    val box = LinearLayout(activity).apply {
                        orientation = LinearLayout.VERTICAL
                        setPadding(dp(activity, 24), dp(activity, 6), dp(activity, 24), dp(activity, 2))
                    }
                    box.addView(ProgressBar(activity, null, 0, R.style.P2A_Progress).apply {
                        max = 100
                        progress = p.progress
                    }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(activity, 8)))
                    box.addView(TextView(activity, null, 0, R.style.P2A_Muted).apply {
                        text = p.message ?: "Starting…"
                        setPadding(0, dp(activity, 8), 0, 0)
                    })
                    sheet.view(box)
                    sheet.row(R.drawable.ic_pause, "Pause the download", "It resumes from here later", dismiss = false) { p.cancelInstall() }
                }
                else -> {
                    val failed = p.message?.takeIf { it.startsWith("Download failed") }
                    val partial = p.partialMb()
                    sheet.row(
                        R.drawable.ic_save,
                        if (partial > 0) "Resume the download" else "Download these voices",
                        failed ?: if (partial > 0) "$partial of ${p.sizeMb} MB done" else "${p.sizeMb} MB, once · then works offline",
                        dismiss = false,
                    ) {
                        askNotifications(activity)
                        p.install {
                            // Switch to the new voices when they're ready (if still on the phone voice).
                            if (Speaker.voiceId.startsWith(Speaker.SYSTEM)) voices.firstOrNull()?.let { Speaker.setVoice(it.first) }
                            onChosen()
                        }
                        fillVoices(activity, sheet, onChosen)
                    }
                }
            }
        }

        sheet.section("On your phone · instant")
        choice(Speaker.PHONE_DEFAULT, "Phone's default voice", "Works offline; quality depends on your phone")
        sheet.row(R.drawable.ic_list, "Other phone voices", "Including Indian English, if your phone has it") {
            showPhoneVoices(activity) { onChosen() }
        }

        if (LocalTts.supported) {
            sheet.section("Natural · Supertonic · 31 languages")
            pack(
                LocalTts.SUPERTONIC_PACK,
                LocalTts.SUPERTONIC_VOICES.map {
                    Triple(Speaker.SUPER + it.name, supertonicName(it.name), if (it.name.startsWith("F")) "Female · quick to start" else "Male · quick to start")
                },
            )
            sheet.section("Natural · Kokoro · English")
            val kokoro = Kokoro.VOICES.sortedBy { if (it.indian) 0 else 1 }.map { v ->
                val (name, rest) = v.label.split(" · ", limit = 2).let { it[0] to it.getOrElse(1) { "" } }
                Triple(Speaker.KOKORO + v.name, name, rest.replaceFirstChar { it.uppercase() })
            }
            pack(LocalTts.KOKORO_PACK, kokoro)
        }
    }

    private fun showPhoneVoices(activity: Activity, onChosen: () -> Unit) {
        val tts = arrayOfNulls<TextToSpeech>(1)
        tts[0] = TextToSpeech(activity) { status ->
            activity.runOnUiThread {
                val t = tts[0] ?: return@runOnUiThread
                val voices = if (status == TextToSpeech.SUCCESS) t.voices.orEmpty()
                    .filter { TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED !in it.features && !it.isNetworkConnectionRequired }
                    .sortedWith(compareBy({ it.locale.language != Locale.getDefault().language }, { it.locale.displayName }, { it.name }))
                else emptyList()
                t.shutdown()
                if (voices.isEmpty()) {
                    AlertDialog.Builder(activity).setMessage("No other voices are installed on this phone.").setPositiveButton("OK", null).show()
                    return@runOnUiThread
                }
                val sheet = LiteSheet(activity, "Phone voices", "Tap one to hear it")
                // Indian English and Indian languages first, then the phone's language, then the rest.
                val indian = voices.filter { it.locale.country == "IN" }
                val rest = voices - indian.toSet()
                fun add(list: List<android.speech.tts.Voice>) {
                    val count = HashMap<String, Int>()
                    for (v in list) {
                        val lang = v.locale.displayName
                        val n = (count[lang] ?: 0) + 1
                        count[lang] = n
                        val id = Speaker.SYSTEM + v.name
                        sheet.row(R.drawable.ic_voice, "$lang · voice $n", if (v.quality >= android.speech.tts.Voice.QUALITY_HIGH) "Higher quality" else null, checked = id == Speaker.voiceId, dismiss = false) {
                            Speaker.setVoice(id)
                            if (!Speaker.playing) Speaker.preview(voice = id)
                            onChosen()
                        }
                    }
                }
                if (indian.isNotEmpty()) {
                    sheet.section("Indian")
                    add(indian)
                    sheet.section("Other languages")
                }
                add(rest)
                sheet.onDismiss { Speaker.stopPreview() }
                sheet.show()
            }
        }
    }

    // ---- Speed and sleep ----

    fun showSpeed(activity: Activity, onChanged: () -> Unit) {
        val box = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(activity, 24), dp(activity, 12), dp(activity, 24), 0)
        }
        val label = TextView(activity).apply {
            textSize = 28f
            gravity = Gravity.CENTER
            setTextColor(Themes.color(activity, R.attr.p2aText))
        }
        val steps = (0..50).map { 0.5f + it * 0.05f } // 0.5x to 3.0x
        val bar = SeekBar(activity).apply { max = steps.size - 1 }
        fun show(v: Float) {
            label.text = speedLabel(v)
        }
        bar.progress = steps.indexOfFirst { it >= Speaker.speed - 0.001f }.coerceAtLeast(0)
        show(Speaker.speed)
        bar.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(s: SeekBar, p: Int, fromUser: Boolean) = show(steps[p])
            override fun onStartTrackingTouch(s: SeekBar) = Unit
            override fun onStopTrackingTouch(s: SeekBar) {
                Speaker.setSpeed(steps[s.progress])
                onChanged()
            }
        })
        val presets = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
        for (v in listOf(0.8f, 1.0f, 1.25f, 1.5f, 2.0f)) {
            presets.addView(Button(activity, null, 0, R.style.P2A_Button_Text).apply {
                text = speedLabel(v)
                setOnClickListener {
                    bar.progress = steps.indexOfFirst { it >= v - 0.001f }
                    Speaker.setSpeed(v)
                    show(v)
                    onChanged()
                }
            })
        }
        box.addView(label)
        box.addView(bar)
        box.addView(presets)
        box.setPadding(dp(activity, 24), 0, dp(activity, 24), dp(activity, 8))
        LiteSheet(activity, "Reading speed", "Drag, or tap a common speed").view(box).show()
    }

    /** "1.0x", "1.25x". */
    fun speedLabel(v: Float = Speaker.speed): String {
        val hundredths = Math.round(v * 100)
        return if (hundredths % 10 == 0) "%.1fx".format(Locale.US, v) else "%.2fx".format(Locale.US, v)
    }

    fun sleepLabel(): String = when {
        Speaker.sleepEndOfChapter -> "End of chapter"
        Speaker.sleepAt > 0 -> {
            val left = ((Speaker.sleepAt - System.currentTimeMillis()) / 60_000).toInt() + 1
            "$left min"
        }
        else -> "Sleep"
    }

    fun showSleep(activity: Activity, onChanged: () -> Unit) {
        val on = Speaker.sleepAt > 0 || Speaker.sleepEndOfChapter
        val sheet = LiteSheet(activity, "Sleep timer", if (on) "Stops in ${sleepLabel()}" else "Stop reading after a while")
        if (on) sheet.row(R.drawable.ic_close, "Turn off", null) { Speaker.setSleepTimer(0); onChanged() }
        sheet.row(R.drawable.ic_list, "End of this chapter", "Stops when the chapter ends", checked = Speaker.sleepEndOfChapter) {
            Speaker.setSleepAtEndOfChapter()
            onChanged()
        }
        for (m in listOf(5, 10, 15, 20, 30, 45, 60, 90)) {
            sheet.row(R.drawable.ic_timer, if (m >= 60) "${m / 60} h${if (m % 60 > 0) " ${m % 60} min" else ""}" else "$m minutes", null) {
                Speaker.setSleepTimer(m)
                onChanged()
            }
        }
        sheet.show()
    }

    // ---- Audiobook ----

    /** Converts the open book or text to audio files: one file, a file per chapter, or two parts. */
    fun showAudiobook(activity: Activity) {
        val doc = Speaker.doc ?: return
        if (Exporter.running) {
            AlertDialog.Builder(activity)
                .setMessage(Exporter.message ?: "Converting…")
                .setPositiveButton("Keep going", null)
                .setNegativeButton("Stop") { _, _ -> Exporter.cancel() }
                .show()
            return
        }
        Speaker.missingPack()?.let { p ->
            AlertDialog.Builder(activity)
                .setMessage("Download the ${p.title} first (Voice), or choose another voice.")
                .setPositiveButton("Choose a voice") { _, _ -> showVoices(activity) }
                .show()
            return
        }
        val (minutes, mb) = Exporter.estimate(doc, Speaker.voiceId, Speaker.renderSpeed)
        val length = if (minutes >= 60) "${minutes / 60} h ${minutes % 60} min" else "$minutes min"
        val v = Speaker.voicing(doc)
        val sp = Speaker.renderSpeed
        val start = { perChapter: Boolean, parts: Int ->
            askNotifications(activity)
            Exporter.start(activity, doc, v, sp, perChapter = perChapter, split = parts)
        }
        val sheet = LiteSheet(activity, "Make an audiobook", "$length with ${voiceName()} · saved in Downloads/${Brand.folder(activity)}")
        sheet.row(R.drawable.ic_save, "One audio file", "About $mb MB") { start(false, 1) }
        if (doc.chapters.size > 1) sheet.row(R.drawable.ic_list, "A file per chapter", "${doc.chapters.size} files in a folder, like an audiobook") { start(true, 1) }
        if (minutes >= 30) sheet.row(R.drawable.ic_save, "Two parts", "About ${mb / 2} MB each") { start(false, 2) }
        if (minutes >= 240) sheet.row(R.drawable.ic_save, "Four parts", "About ${mb / 4} MB each") { start(false, 4) }
        sheet.show()
    }

    fun askNotifications(activity: Activity) {
        if (Build.VERSION.SDK_INT >= 33 &&
            activity.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            activity.requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 77)
        }
    }
}
