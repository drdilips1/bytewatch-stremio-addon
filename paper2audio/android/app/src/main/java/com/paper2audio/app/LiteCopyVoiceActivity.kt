package com.paper2audio.app

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * "Copy a voice" (Narrato, and Voice Studio in Paper to Audio): from an audio clip (an audiobook sample, a recording of someone
 * reading) or the microphone. The copy takes the voice's sound and its rhythm (the pauses
 * between sentences); the clearest 30 (or 10) seconds of a longer clip are used.
 */
class LiteCopyVoiceActivity : Activity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var consent: CheckBox
    private lateinit var longSample: CheckBox
    private lateinit var status: TextView
    private lateinit var level: ProgressBar
    private lateinit var btnFile: Button
    private lateinit var btnRecord: Button
    private lateinit var btnEngine: Button
    private var recorder: VoiceRecorder? = null
    private val refresh: () -> Unit = { runOnUiThread { render() } }

    private fun dp(v: Int) = LiteUi.dp(this, v)
    private fun color(attr: Int) = Themes.color(this, attr)

    override fun onCreate(savedInstanceState: Bundle?) {
        Themes.apply(this)
        super.onCreate(savedInstanceState)
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(22), dp(18), dp(22), dp(28))
        }
        fun text(t: String, size: Float = 15f, muted: Boolean = false, top: Int = 10) = TextView(this).apply {
            text = t
            textSize = size
            setLineSpacing(0f, 1.2f)
            setTextColor(color(if (muted) R.attr.p2aMuted else R.attr.p2aText))
            box.addView(this, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(top) })
        }
        fun button(t: String, top: Int = 12, onClick: () -> Unit) = Button(this, null, 0, R.style.P2A_Button).apply {
            text = t
            setOnClickListener { onClick() }
            box.addView(this, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(top) })
        }
        Button(this, null, 0, R.style.P2A_Button_Text).apply {
            text = "‹ Back"
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            setOnClickListener { finish() }
            box.addView(this, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
        text("Copy a voice", 24f, top = 4).typeface = android.graphics.Typeface.create(android.graphics.Typeface.SERIF, android.graphics.Typeface.BOLD)
        text(
            "${getString(R.string.app_name)} can read your books in a voice copied from a recording. It copies how the voice sounds " +
                "and its rhythm: how long the speaker pauses between sentences."
        )
        text(
            "• Best: one person reading clearly, with no music or other voices.\n" +
                "• A clip of 40 seconds to 2 minutes is ideal. ${getString(R.string.app_name)} picks its clearest 30 seconds (or 10, if you untick the longer sample).\n" +
                "• Everything happens on your phone; the recording isn't uploaded.",
            14f, muted = true,
        )
        btnEngine = button("", top = 16) {
            val p = LocalTts.POCKET_PACK
            if (p.installing) p.cancelInstall() else p.install { refresh() }
            render()
        }
        consent = CheckBox(this).apply {
            text = "This is my own voice, or the speaker has given me permission to copy it."
            setTextColor(color(R.attr.p2aText))
            setOnCheckedChangeListener { _, _ -> render() }
            box.addView(this, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(16) })
        }
        longSample = CheckBox(this).apply {
            text = "Longer sample (30 seconds): closer to the real voice. Untick for a 10-second sample, which can be steadier."
            isChecked = true
            setTextColor(color(R.attr.p2aText))
            box.addView(this, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) })
        }
        btnFile = button("Choose an audio clip") { pickFile() }
        btnRecord = button("Record with the microphone") { record() }
        level = ProgressBar(this, null, 0, R.style.P2A_Progress).apply { max = 100 }
        box.addView(level, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(8)).apply { topMargin = dp(16) })
        status = text("", 14f, muted = true)
        val root = ScrollView(this).apply {
            id = View.generateViewId()
            setBackgroundColor(color(R.attr.p2aBg))
            addView(box)
        }
        setContentView(root)
        LiteUi.fitSystemBars(this, root)
        ModelPack.addListener(refresh)
        render()
    }

    override fun onDestroy() {
        ModelPack.removeListener(refresh)
        recorder?.stop()
        scope.cancel()
        super.onDestroy()
    }

    private fun render() {
        val p = LocalTts.POCKET_PACK
        val ready = p.isInstalled()
        btnEngine.visibility = if (ready) View.GONE else View.VISIBLE
        btnEngine.text = when {
            p.installing -> "Pause the download · ${p.progress}%"
            p.partialMb() > 0 -> "Resume the voice-copying engine download"
            else -> "First, download the voice-copying engine (${p.sizeMb} MB, once)"
        }
        val recording = recorder?.isRunning == true
        btnFile.isEnabled = ready && consent.isChecked && !recording
        btnRecord.isEnabled = ready && consent.isChecked
        level.visibility = if (p.installing || recording) View.VISIBLE else View.GONE
        if (p.installing) level.progress = p.progress
        if (!recording && status.tag != "busy") status.text = when {
            p.installing -> p.message ?: "Downloading…"
            !ready -> "The engine is needed once; after that, copying works offline."
            !consent.isChecked -> "Tick the box above to continue."
            else -> ""
        }
    }

    private fun pickFile() {
        val intent = Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("audio/*")
            .putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("audio/*", "video/*"))
        @Suppress("DEPRECATION")
        startActivityForResult(Intent.createChooser(intent, "Choose a recording of the voice"), REQ_FILE)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        val uri: Uri = data?.data ?: return
        if (requestCode != REQ_FILE || resultCode != RESULT_OK) return
        askName { name ->
            busy("Reading the clip…")
            scope.launch {
                try {
                    val ref = withContext(Dispatchers.IO) { MyVoices.decode(this@LiteCopyVoiceActivity, uri) }
                    // The first couple of seconds of a clip are often a click, a breath or an intro: skip them.
                    val skip = if (ref.samples.size > 15 * ref.sampleRate) 2 * ref.sampleRate else 0
                    make(name, ref.samples.copyOfRange(skip, ref.samples.size), ref.sampleRate)
                } catch (e: Exception) {
                    done("Couldn't read that clip: ${e.message}")
                }
            }
        }
    }

    private fun record() {
        if (countdown?.isActive == true) return startRecording() // cancels the countdown
        // Stop (or the recorder already stopped itself at the time limit): keep what was recorded.
        recorder?.let { r ->
            recorder = null
            val samples = r.stop()
            level.progress = 0
            btnRecord.text = "Record with the microphone"
            render()
            askName { name -> scope.launch { make(name, samples, MyVoices.RATE) } }
            return
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_MIC)
            return
        }
        AlertDialog.Builder(this)
            .setTitle("Read this aloud")
            .setMessage(
                "Hold the phone about a hand's width away, in a quiet room, and read naturally:\n\n“${MyVoices.SCRIPT}”\n\n" +
                    "Or play the voice you want to copy near the phone. Recording starts after a 3-second countdown. Tap Stop when it's done (35 seconds or more for the longer sample; it stops by itself after 90)."
            )
            .setPositiveButton("Start") { _, _ -> startRecording() }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private var countdown: kotlinx.coroutines.Job? = null

    /** A 3-second countdown first: time to settle, or to start playing the voice near the phone. */
    private fun startRecording() {
        if (countdown?.isActive == true) {
            // Tapped again during the countdown: cancel.
            countdown?.cancel()
            btnRecord.text = "Record with the microphone"
            status.text = ""
            return
        }
        btnRecord.text = "Cancel"
        countdown = scope.launch {
            for (n in 3 downTo 1) {
                status.text = "Recording starts in $n…"
                kotlinx.coroutines.delay(1_000)
            }
            beginRecording()
        }
    }

    private fun beginRecording() {
        val r = VoiceRecorder(MAX_RECORD_SECONDS) { peak, secs ->
            runOnUiThread {
                if (recorder == null) return@runOnUiThread
                if (secs >= MAX_RECORD_SECONDS - 0.2f) {
                    record() // reached the maximum length: finish as if Stop was tapped
                    return@runOnUiThread
                }
                level.progress = (peak * 140).toInt().coerceAtMost(100)
                status.text = "Recording… ${secs.toInt()} s" + when {
                    secs < MyVoices.MIN_SECONDS + 6 -> ""
                    secs < 35 && longSample.isChecked -> " · keep going (35 s or more for the longer sample)"
                    secs < 15 -> " · keep going (15 s or more is best)"
                    else -> " · tap Stop when you finish"
                }
            }
        }
        try {
            r.start()
            recorder = r
            btnRecord.text = "Stop"
            render()
        } catch (e: Exception) {
            status.text = e.message ?: "Couldn't start recording"
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_MIC && grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) record()
        else if (requestCode == REQ_MIC) toast("${getString(R.string.app_name)} needs the microphone to record a voice. You can choose an audio clip instead.")
    }

    private fun askName(then: (String) -> Unit) {
        btnRecord.text = "Record with the microphone"
        val input = EditText(this).apply {
            hint = "Name, e.g. Grandma or Evening reader"
            isSingleLine = true
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS
        }
        AlertDialog.Builder(this)
            .setTitle("Name this voice")
            .setView(LinearLayout(this).apply {
                setPadding(dp(22), dp(8), dp(22), 0)
                addView(input, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            })
            .setPositiveButton("Save") { _, _ -> then(input.text.toString()) }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun busy(message: String) {
        status.tag = "busy"
        status.text = message
        btnFile.isEnabled = false
        btnRecord.isEnabled = false
    }

    private fun done(message: String) {
        status.tag = null
        render()
        status.text = message
    }

    private suspend fun make(name: String, samples: FloatArray, rate: Int) {
        busy("Finding the best part and copying the voice…")
        try {
            val seconds = if (longSample.isChecked) MyVoices.LONG_REFERENCE_SECONDS else MyVoices.REFERENCE_SECONDS
            val voice = withContext(Dispatchers.Default) { MyVoices.add(name, samples, rate, seconds) }
            Speaker.refreshVoices()
            done("“${voice.name}” is ready.")
            val id = Speaker.CLONE + voice.id
            val used = "\n\nUsed: the clearest ${"%.0f".format(voice.seconds)} seconds of the recording."
            val rhythm = used + if (voice.pause > 0) "\nIts pause between sentences: ${voice.pause} ms, as in the recording." else ""
            // How good the recording was: a poor one gives a poor copy, so say so and why.
            val tip = when {
                voice.problems.isEmpty() -> "\n\nRecording quality: good."
                voice.problems.size == 1 && voice.problems[0].startsWith("some") ->
                    "\n\nRecording quality: fair (${voice.problems[0]}). It may have small glitches."
                else -> "\n\nRecording quality: poor. The copy may mumble or sound wrong because of:\n• " +
                    voice.problems.joinToString("\n• ") + "\n\nFor a better copy, remove this voice and record again in a quiet room, a hand's width from the phone."
            }
            AlertDialog.Builder(this)
                .setTitle("“${voice.name}” is ready")
                .setMessage("Listen to it: if the first word (\"Hello\") sounds clear, the copy is good. Use it, or discard it and try another recording.$rhythm$tip")
                .setPositiveButton("Use it") { _, _ ->
                    Speaker.stopPreview()
                    Speaker.setVoice(id)
                    finish()
                }
                .setNeutralButton("Listen", null)
                // Not good enough: throw it away here, no need to find it in the voice list.
                .setNegativeButton("Discard") { _, _ ->
                    Speaker.stopPreview()
                    MyVoices.delete(voice.id)
                    Speaker.refreshVoices()
                    done("“${voice.name}” was discarded. Try another recording.")
                }
                .setOnCancelListener { Speaker.stopPreview() }
                .show()
                .getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener { Speaker.preview(voice = id) }
        } catch (e: Exception) {
            AppLog.e("CopyVoice", "Couldn't copy the voice", e)
            done(e.message ?: "Couldn't copy the voice")
        }
    }

    private fun toast(s: String) = Toast.makeText(this, s, Toast.LENGTH_LONG).show()

    companion object {
        private const val REQ_FILE = 41
        private const val REQ_MIC = 42
        /** Recordings stop by themselves after this long (the clearest 30 or 10 seconds are used). */
        private const val MAX_RECORD_SECONDS = 90
    }
}
