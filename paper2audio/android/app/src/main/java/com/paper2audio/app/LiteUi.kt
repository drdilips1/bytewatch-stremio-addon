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
     * with their one-time download shown as percent and megabytes.
     */
    fun showVoices(activity: Activity, onChosen: () -> Unit = {}) {
        val pad = dp(activity, 20)
        val list = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, dp(activity, 8), pad, dp(activity, 8))
        }
        val dialog = AlertDialog.Builder(activity)
            .setTitle("Choose a voice")
            .setView(ScrollView(activity).apply { addView(list) })
            .setNegativeButton("Close", null)
            .create()
        val refresh = { fillVoices(activity, list, dialog, onChosen) }
        val listener: () -> Unit = { if (dialog.isShowing) refresh() }
        ModelPack.addListener(listener)
        dialog.setOnDismissListener {
            ModelPack.removeListener(listener)
            Speaker.stopPreview()
        }
        refresh()
        dialog.show()
    }

    private fun fillVoices(activity: Activity, list: LinearLayout, dialog: AlertDialog, onChosen: () -> Unit) {
        list.removeAllViews()
        val text = Themes.color(activity, R.attr.p2aText)
        fun header(t: String, note: String) {
            list.addView(TextView(activity).apply {
                this.text = t
                textSize = 16f
                setTextColor(text)
                setTypeface(typeface, android.graphics.Typeface.BOLD)
                setPadding(0, dp(activity, 14), 0, dp(activity, 2))
            })
            list.addView(TextView(activity, null, 0, R.style.P2A_Muted).apply { this.text = note })
        }
        fun choice(id: String, label: String) {
            val chosen = id == Speaker.voiceId
            list.addView(Button(activity, null, 0, if (chosen) R.style.P2A_Button else R.style.P2A_Button_Soft).apply {
                this.text = if (chosen) "✓  $label" else label
                gravity = Gravity.START or Gravity.CENTER_VERTICAL
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = dp(activity, 6)
                }
                setOnClickListener {
                    Speaker.setVoice(id)
                    if (!Speaker.playing) Speaker.preview(voice = id)
                    onChosen()
                    fillVoices(activity, list, dialog, onChosen)
                }
            })
        }
        fun pack(p: ModelPack, what: String, voices: List<Pair<String, String>>) {
            header(p.title.replaceFirstChar { it.uppercase() }, what)
            when {
                p.isInstalled() -> {
                    voices.forEach { (id, label) -> choice(id, label) }
                    list.addView(Button(activity, null, 0, R.style.P2A_Button_Text).apply {
                        this.text = "Delete these voices (frees ${p.sizeMb} MB)"
                        setOnClickListener {
                            AlertDialog.Builder(activity)
                                .setMessage("Delete ${p.title}? You can download them again any time.")
                                .setPositiveButton("Delete") { _, _ ->
                                    if (LocalTts.packFor(Speaker.voiceId) === p) Speaker.setVoice(Speaker.PHONE_DEFAULT)
                                    p.uninstall { fillVoices(activity, list, dialog, onChosen) }
                                }
                                .setNegativeButton("Cancel", null)
                                .show()
                        }
                    })
                }
                p.installing -> {
                    list.addView(ProgressBar(activity, null, 0, R.style.P2A_Progress).apply {
                        max = 100
                        progress = p.progress
                        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(activity, 10)).apply {
                            topMargin = dp(activity, 10)
                        }
                    })
                    list.addView(TextView(activity, null, 0, R.style.P2A_Muted).apply {
                        this.text = p.message ?: "Starting…"
                        setPadding(0, dp(activity, 6), 0, 0)
                    })
                    list.addView(Button(activity, null, 0, R.style.P2A_Button_Text).apply {
                        this.text = "Pause download"
                        setOnClickListener { p.cancelInstall() }
                    })
                }
                else -> {
                    p.message?.takeIf { it.startsWith("Download failed") }?.let { msg ->
                        list.addView(TextView(activity, null, 0, R.style.P2A_Muted).apply { this.text = msg })
                    }
                    val partial = p.partialMb()
                    list.addView(Button(activity, null, 0, R.style.P2A_Button).apply {
                        this.text = if (partial > 0) "Resume download ($partial of ${p.sizeMb} MB done)" else "Download (${p.sizeMb} MB, once)"
                        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                            topMargin = dp(activity, 8)
                        }
                        setOnClickListener {
                            askNotifications(activity)
                            p.install {
                                // Switch to the new voices when they're ready (if still on the phone voice).
                                if (Speaker.voiceId.startsWith(Speaker.SYSTEM)) voices.firstOrNull()?.let { Speaker.setVoice(it.first) }
                                onChosen()
                            }
                            fillVoices(activity, list, dialog, onChosen)
                        }
                    })
                }
            }
        }

        header("Phone voice", "Works instantly, offline. Quality depends on your phone.")
        choice(Speaker.PHONE_DEFAULT, "Phone's default voice")
        list.addView(Button(activity, null, 0, R.style.P2A_Button_Text).apply {
            this.text = "Other phone voices…"
            setOnClickListener { showPhoneVoices(activity) { onChosen(); fillVoices(activity, list, dialog, onChosen) } }
        })

        if (LocalTts.supported) {
            pack(
                LocalTts.SUPERTONIC_PACK,
                "Natural voices made on your phone, offline. English and 30 more languages.",
                LocalTts.SUPERTONIC_VOICES.map { Speaker.SUPER + it.name to "${supertonicName(it.name)} · ${if (it.name.startsWith("F")) "female" else "male"}" },
            )
            pack(
                LocalTts.KOKORO_PACK,
                "Very natural English voices, offline. A larger download.",
                Kokoro.VOICES.map { Speaker.KOKORO + it.name to it.label },
            )
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
                AlertDialog.Builder(activity)
                    .setTitle("Phone voices")
                    .setItems(voices.map { "${it.locale.displayName} · ${it.name}" }.toTypedArray()) { _, which ->
                        Speaker.setVoice(Speaker.SYSTEM + voices[which].name)
                        if (!Speaker.playing) Speaker.preview(voice = Speaker.voiceId)
                        onChosen()
                    }
                    .show()
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
        AlertDialog.Builder(activity).setTitle("Reading speed").setView(box).setPositiveButton("Done", null).show()
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
        val minutes = listOf(5, 10, 15, 20, 30, 45, 60, 90)
        val options = listOf("Off") + minutes.map { "$it minutes" } + listOf("End of this chapter")
        AlertDialog.Builder(activity)
            .setTitle("Sleep timer")
            .setItems(options.toTypedArray()) { _, which ->
                when (which) {
                    0 -> Speaker.setSleepTimer(0)
                    options.size - 1 -> Speaker.setSleepAtEndOfChapter()
                    else -> Speaker.setSleepTimer(minutes[which - 1])
                }
                onChanged()
            }
            .show()
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
        val options = ArrayList<Pair<String, () -> Unit>>()
        val v = Speaker.voicing(doc)
        val sp = Speaker.renderSpeed
        val start = { perChapter: Boolean, parts: Int ->
            askNotifications(activity)
            Exporter.start(activity, doc, v, sp, perChapter = perChapter, split = parts)
        }
        options += "One audio file (about $mb MB)" to { start(false, 1) }
        if (doc.chapters.size > 1) options += "One file per chapter (${doc.chapters.size} files, like an audiobook)" to { start(true, 1) }
        if (minutes >= 30) options += "Two parts (about ${mb / 2} MB each)" to { start(false, 2) }
        if (minutes >= 240) options += "Four parts (about ${mb / 4} MB each)" to { start(false, 4) }
        AlertDialog.Builder(activity)
            .setTitle("Make an audiobook · $length")
            .setItems(options.map { it.first }.toTypedArray()) { _, which -> options[which].second() }
            .setNegativeButton("Cancel", null)
            .show()
    }

    fun askNotifications(activity: Activity) {
        if (Build.VERSION.SDK_INT >= 33 &&
            activity.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            activity.requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 77)
        }
    }
}
