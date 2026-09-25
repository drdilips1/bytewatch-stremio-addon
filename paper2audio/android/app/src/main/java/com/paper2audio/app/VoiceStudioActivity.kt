package com.paper2audio.app

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.util.Locale

/**
 * Voice studio: ready-made on-device voices, cloning your own voice, the
 * on-device voice packs, voice design (pitch, "describe a voice") and a second
 * voice for dialogue in stories.
 */
class VoiceStudioActivity : Activity() {
    private companion object {
        const val REQ_IMPORT = 1
        const val REQ_MIC = 2
        const val DIALOGUE_SAMPLE = "“Are you coming with us tonight?” asked Maya. Tom looked out at the rain " +
            "and shook his head. “Not tonight,” he said quietly. “Maybe tomorrow.”"
        const val DESIGN_SAMPLE = "Hello! This is how this voice sounds. I can read your papers, articles and books aloud."
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var content: LinearLayout
    private var shape: String? = null
    private val packViews = HashMap<String, Pair<ProgressBar, TextView>>()
    private val refresh: () -> Unit = { refresh() }
    private var pendingMic: (() -> Unit)? = null

    private val d get() = resources.displayMetrics.density
    private fun dp(v: Int) = (v * d).toInt()
    private fun color(attr: Int) = Themes.color(this, attr)

    override fun onCreate(savedInstanceState: Bundle?) {
        Themes.apply(this)
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_voice_studio)
        content = findViewById(R.id.content)
        findViewById<ImageButton>(R.id.btnBack).setOnClickListener { finish() }
        Speaker.init(this) {}
    }

    override fun onStart() {
        super.onStart()
        ModelPack.addListener(refresh)
        Speaker.addListener(refresh)
        shape = null
        refresh()
    }

    override fun onStop() {
        ModelPack.removeListener(refresh)
        Speaker.removeListener(refresh)
        Speaker.stopPreview()
        super.onStop()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    /** Rebuilds the page when something structural changed; otherwise only updates download progress. */
    private fun refresh() {
        val now = listOf(
            LocalTts.PACKS.joinToString { "${it.id}:${it.isInstalled()}:${it.installing}" },
            MyVoices.own().joinToString { "${it.id}:${it.name}" },
            Speaker.voiceId, Speaker.dialogueVoice, Speaker.pitch, Speaker.voicesVersion,
        ).joinToString("|")
        if (now != shape) {
            shape = now
            build()
        }
        for (pack in LocalTts.PACKS) {
            val (bar, status) = packViews[pack.id] ?: continue
            bar.visibility = if (pack.installing) View.VISIBLE else View.GONE
            bar.progress = pack.progress
            status.text = packStatus(pack)
        }
    }

    private fun packStatus(pack: ModelPack) = when {
        pack.installing -> pack.message ?: "Downloading…"
        pack.isInstalled() -> "Downloaded · works offline"
        else -> pack.message?.takeIf { it.startsWith("Download failed") } ?: "Not downloaded · about ${pack.sizeMb} MB"
    }

    // ---- Building blocks ----

    private fun card(title: String, intro: String? = null): LinearLayout {
        val card = LinearLayout(this, null, 0, R.style.P2A_Card).apply { orientation = LinearLayout.VERTICAL }
        content.addView(card, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            topMargin = dp(14)
        })
        card.addView(TextView(this, null, 0, R.style.P2A_CardTitle).apply { text = title })
        intro?.let { card.addView(muted(it)) }
        return card
    }

    private fun muted(t: String) = TextView(this, null, 0, R.style.P2A_Muted).apply {
        text = t
        setLineSpacing(0f, 1.2f)
    }

    private fun button(label: String, soft: Boolean = false, onClick: () -> Unit) =
        Button(this, null, 0, if (soft) R.style.P2A_Button_Soft else R.style.P2A_Button).apply {
            text = label
            setOnClickListener { onClick() }
        }

    private fun textButton(label: String, onClick: () -> Unit) = Button(this, null, 0, R.style.P2A_Button_Text).apply {
        text = label
        setOnClickListener { onClick() }
    }

    private fun LinearLayout.addFull(v: View, top: Int = 10) = addView(v, LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT,
    ).apply { topMargin = dp(top) })

    /** One voice: name and description, a play button and "Use". */
    private fun voiceRow(parent: LinearLayout, id: String, name: String, detail: String, onMore: (() -> Unit)? = null) {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(6), 0, dp(6))
        }
        val texts = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        texts.addView(TextView(this).apply {
            text = name
            textSize = 16f
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(color(R.attr.p2aText))
        })
        texts.addView(muted(detail))
        row.addView(texts, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        row.addView(ImageButton(this, null, 0, R.style.P2A_Icon).apply {
            setImageResource(R.drawable.ic_play)
            contentDescription = "Preview $name"
            setOnClickListener { preview(id) }
        }, LinearLayout.LayoutParams(dp(48), dp(48)))
        val inUse = Speaker.voiceId == id
        row.addView(Button(this, null, 0, if (inUse) R.style.P2A_Button else R.style.P2A_Button_Soft).apply {
            text = if (inUse) "In use" else "Use"
            minWidth = dp(72)
            setOnClickListener { use(id) }
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        if (onMore != null) {
            row.addView(ImageButton(this, null, 0, R.style.P2A_Icon).apply {
                setImageResource(R.drawable.ic_tune)
                contentDescription = "Rename or delete $name"
                setOnClickListener { onMore() }
            }, LinearLayout.LayoutParams(dp(44), dp(48)))
        }
        parent.addView(row)
    }

    private fun needPack(pack: ModelPack, then: () -> Unit) {
        if (pack.isInstalled()) {
            then()
            return
        }
        AlertDialog.Builder(this)
            .setTitle("Download the ${pack.title}?")
            .setMessage(
                "This voice runs on your phone, offline and unlimited. It needs a one-time download of about " +
                    "${pack.sizeMb} MB (Wi-Fi is best). You can keep using the app meanwhile."
            )
            .setPositiveButton("Download") { _, _ -> pack.install { Speaker.refreshVoices() } }
            .setNegativeButton("Not now", null)
            .show()
    }

    private fun preview(id: String, text: String = DESIGN_SAMPLE, pitch: Int = 0) {
        val pack = LocalTts.packFor(id)
        if (pack != null && !pack.isInstalled()) return needPack(pack) { }
        toast("Playing a preview…")
        Speaker.preview(text, id, pitch)
    }

    private fun use(id: String) {
        val pack = LocalTts.packFor(id)
        if (pack != null && !pack.isInstalled()) {
            Speaker.setVoice(id)
            needPack(pack) { }
            return
        }
        Speaker.setVoice(id)
        toast("Voice changed")
    }

    // ---- The page ----

    private fun build() {
        content.removeAllViews()
        packViews.clear()
        if (!LocalTts.supported) {
            card("On-device voices aren't available", "This phone's processor isn't supported by the on-device voice engine. The ★ online voices work normally.")
        } else {
            buildReadyMade()
            buildOwnVoices()
        }
        buildDesign()
        buildStories()
        if (LocalTts.supported) buildPacks()
    }

    private fun buildReadyMade() {
        val pack = LocalTts.POCKET_PACK
        val c = card(
            "Natural voices on your phone",
            "Ready-made voices that run on the phone: offline, private and unlimited. English only. " +
                if (pack.isInstalled()) "" else "First use downloads the voice engine (about ${pack.sizeMb} MB, once).",
        )
        for (v in MyVoices.BUILT_IN) voiceRow(c, Speaker.CLONE + v.id, v.name, v.description)
    }

    private fun buildOwnVoices() {
        val c = card(
            "Clone a voice",
            "Record 15–20 seconds of your own voice (or import a recording), and the app will read in that voice, on your phone. " +
                "Only clone voices with the speaker's permission.",
        )
        val buttons = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        buttons.addView(button("Record", onClick = { withMic { recordVoice() } }).apply {
            setCompoundDrawablesRelativeWithIntrinsicBounds(R.drawable.ic_mic, 0, 0, 0)
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = dp(5) })
        buttons.addView(button("Import", soft = true, onClick = { importVoice() }),
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = dp(5) })
        c.addFull(buttons)
        for (v in MyVoices.own()) {
            voiceRow(c, Speaker.CLONE + v.id, v.name, "Your voice · ${"%.0f".format(v.seconds)} s sample") { voiceMenu(v) }
        }
    }

    private fun buildPacks() {
        val c = card("On-device voice packs", "Downloaded once, then they work without internet.")
        val about = mapOf(
            "pocket" to "Needed for the natural voices above and for cloned voices.",
            "supertonic" to "10 voices (◆ Supertonic) that read 31 languages, including Hindi, Spanish, French, German and Japanese.",
            "kokoro" to "15 English voices (◆ Kokoro).",
        )
        for (pack in LocalTts.PACKS) {
            val box = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(0, dp(8), 0, dp(4))
            }
            box.addView(TextView(this).apply {
                text = pack.title.replaceFirstChar { it.uppercase() }
                textSize = 15f
                setTypeface(typeface, Typeface.BOLD)
                setTextColor(color(R.attr.p2aText))
            })
            box.addView(muted(about[pack.id].orEmpty()))
            val status = muted(packStatus(pack))
            box.addView(status)
            val bar = ProgressBar(this, null, 0, R.style.P2A_Progress).apply {
                max = 100
                visibility = if (pack.installing) View.VISIBLE else View.GONE
            }
            box.addFull(bar, 6)
            packViews[pack.id] = bar to status
            val action = when {
                pack.installing -> textButton("Cancel download") { pack.cancelInstall() }
                pack.isInstalled() -> textButton("Delete (frees ${pack.sizeMb} MB)") {
                    AlertDialog.Builder(this)
                        .setTitle("Delete the ${pack.title}?")
                        .setMessage("You can download it again later.")
                        .setPositiveButton("Delete") { _, _ ->
                            if (LocalTts.packFor(Speaker.voiceId) === pack) Speaker.setVoice(Speaker.DEFAULT_VOICE)
                            pack.uninstall { Speaker.refreshVoices() }
                        }
                        .setNegativeButton("Cancel", null)
                        .show()
                }
                else -> textButton("Download (${pack.sizeMb} MB)") { pack.install { Speaker.refreshVoices() } }
            }
            box.addView(action)
            c.addView(box)
        }
    }

    // ---- Voice design ----

    private fun buildDesign() {
        val c = card(
            "Voice design",
            "Describe the voice you want, like “a calm, deep British man” or “a warm young woman with an Indian accent”, " +
                "and the app picks the closest voice and tunes it.",
        )
        val input = EditText(this).apply {
            hint = "Describe a voice"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            setTextColor(color(R.attr.p2aText))
            setHintTextColor(color(R.attr.p2aMuted))
        }
        c.addFull(input, 6)
        c.addFull(button("Find this voice", onClick = { designVoice(input.text.toString()) }))

        c.addFull(TextView(this).apply {
            text = "Pitch of ★ online voices"
            textSize = 15f
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(color(R.attr.p2aText))
        }, 18)
        val label = muted("")
        fun show(hz: Int) {
            label.text = when {
                hz == 0 -> "Natural pitch"
                hz < 0 -> "Deeper by ${-hz} Hz"
                else -> "Higher by $hz Hz"
            }
        }
        show(Speaker.pitch)
        c.addView(label)
        val bar = SeekBar(this).apply {
            max = 80
            progress = Speaker.pitch + 40
        }
        bar.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(sb: SeekBar, p: Int, fromUser: Boolean) = show(p - 40)
            override fun onStartTrackingTouch(sb: SeekBar) = Unit
            override fun onStopTrackingTouch(sb: SeekBar) {
                val hz = sb.progress - 40
                Speaker.setPitch(hz)
                if (Speaker.isEdge) preview(Speaker.voiceId, pitch = hz)
            }
        })
        c.addFull(bar, 4)
        if (!Speaker.isEdge) c.addView(muted("Choose a ★ online voice to use pitch."))
    }

    /** Picks a voice for a description: with Gemini when a key is set, else by keywords. */
    private fun designVoice(description: String) {
        if (description.isBlank()) return toast("Describe the voice first")
        toast("Finding a voice…")
        scope.launch {
            val pick = withContext(Dispatchers.IO) {
                if (Gemini.key(this@VoiceStudioActivity) != null) runCatching { designWithGemini(description) }.getOrNull() else null
            } ?: designLocally(description)
            val (id, pitch, why) = pick
            val name = Speaker.voiceOptions().firstOrNull { it.id == id }?.label ?: id.substringAfter(':')
            AlertDialog.Builder(this@VoiceStudioActivity)
                .setTitle("Suggested voice")
                .setMessage(name + (if (pitch != 0) "\nPitch: ${if (pitch > 0) "+" else ""}$pitch Hz" else "") + (why?.let { "\n\n$it" } ?: ""))
                .setPositiveButton("Use it") { _, _ ->
                    use(id)
                    if (id.startsWith(Speaker.EDGE)) Speaker.setPitch(pitch)
                }
                .setNeutralButton("Listen", null)
                .setNegativeButton("Cancel") { _, _ -> Speaker.stopPreview() }
                .show()
                .getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener { preview(id, pitch = if (id.startsWith(Speaker.EDGE)) pitch else 0) }
        }
    }

    private fun designWithGemini(description: String): Triple<String, Int, String?> {
        val options = Speaker.voiceOptions().filter { !it.id.startsWith(Speaker.SYSTEM) }
        val list = options.joinToString("\n") { "${it.id} = ${it.label}" }
        val answer = Gemini.generate(
            this,
            "Pick the voice that best matches this description: \"$description\".\n\nAvailable voices (id = description):\n$list\n\n" +
                "Voices marked 'online' can also be shifted in pitch by -40 to +40 Hz (negative is deeper). " +
                "Reply with only JSON: {\"id\": \"<one id from the list>\", \"pitch\": <integer, 0 unless it helps>, " +
                "\"why\": \"<one short sentence>\"}",
            json = true,
        )
        val o = JSONObject(answer.trim().removePrefix("```json").removePrefix("```").removeSuffix("```").trim())
        val id = o.getString("id").trim()
        require(options.any { it.id == id })
        return Triple(id, o.optInt("pitch").coerceIn(-40, 40), o.optString("why").ifBlank { null })
    }

    private fun designLocally(description: String): Triple<String, Int, String?> {
        val t = description.lowercase(Locale.ROOT)
        fun has(vararg w: String) = w.any { Regex("\\b$it").containsMatchIn(t) }
        val male = has("man", "male", "guy", "boy", "gentleman", "father", "grandfather", "his", "he ")
        val female = has("woman", "female", "girl", "lady", "mother", "grandmother", "her", "she ")
        val locale = when {
            has("british", "english accent", "uk", "london", "england") -> "en-GB"
            has("indian") -> "en-IN"
            has("australian") -> "en-AU"
            has("irish") -> "en-IE"
            has("canadian") -> "en-CA"
            has("hindi") -> "hi-IN"
            else -> "en-US"
        }
        val pitch = when {
            has("deep", "low", "bass", "old", "elderly") -> -12
            has("high", "young", "child", "bright", "cheerful") -> 10
            else -> 0
        }
        val gender = when {
            male && !female -> "Male"
            female && !male -> "Female"
            else -> null
        }
        val favorites = EdgeTts.FAVORITES.filter { it.locale == locale && (gender == null || it.gender == gender) }
        val any = Speaker.onlineVoices.filter { it.locale == locale && (gender == null || it.gender == gender) }
        val pick = favorites.firstOrNull() ?: any.firstOrNull() ?: EdgeTts.FAVORITES.first { gender == null || it.gender == gender }
        val note = "Tip: add a free Gemini key (player › Options › AI) for smarter matches."
        return Triple(Speaker.EDGE + pick.name, pitch, if (Gemini.key(this) == null) note else null)
    }

    // ---- Stories ----

    private fun buildStories() {
        val c = card(
            "Stories: a second voice for dialogue",
            "Narration is read by your main voice and everything in quotation marks by a second voice, " +
                "like an audiobook with two narrators.",
        )
        val current = Speaker.dialogueVoice
        val label = current?.let { id -> Speaker.voiceOptions().firstOrNull { it.id == id }?.label ?: id } ?: "Off"
        c.addFull(muted("Dialogue voice: $label"), 4)
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        row.addView(button(if (current == null) "Choose a voice" else "Change", onClick = { chooseDialogue() }),
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = dp(5) })
        row.addView(button("Listen", soft = true, onClick = {
            val dialogue = Speaker.dialogueVoice ?: return@button toast("Choose a dialogue voice first")
            Speaker.stopPreview()
            toast("Playing a sample…")
            Speaker.previewStory(DIALOGUE_SAMPLE, dialogue)
        }), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = dp(5) })
        c.addFull(row)
        if (current != null) c.addView(textButton("Turn off") { Speaker.setDialogueVoice(null) })
    }

    private fun chooseDialogue() {
        val main = Speaker.voiceId
        val options = Speaker.voiceOptions().filter { o ->
            o.id != main && when {
                main.startsWith(Speaker.EDGE) -> o.id.startsWith(Speaker.EDGE)
                LocalTts.isLocal(main) -> LocalTts.isLocal(o.id) && LocalTts.missing(o.id) == null
                else -> false
            }
        }
        if (options.isEmpty()) {
            val why = if (LocalTts.isLocal(main)) "Download another on-device voice pack first, or use a ★ online voice as the main voice."
            else "Two-voice stories work with ★ online voices and on-device voices. Choose one as your main voice first."
            AlertDialog.Builder(this).setTitle("No second voice available").setMessage(why).setPositiveButton("OK", null).show()
            return
        }
        AlertDialog.Builder(this)
            .setTitle("Voice for dialogue")
            .setItems(options.map { it.label }.toTypedArray()) { _, which -> Speaker.setDialogueVoice(options[which].id) }
            .show()
    }

    // ---- Cloning ----

    private fun withMic(then: () -> Unit) {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) then() else {
            pendingMic = then
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_MIC)
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_MIC) {
            if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) pendingMic?.invoke()
            else toast("The microphone is needed to record your voice")
            pendingMic = null
        }
    }

    private fun consentBox() = CheckBox(this, null, 0, R.style.P2A_Check).apply {
        text = "This is my own voice, or I have the speaker's permission to copy it."
    }

    private fun recordVoice() {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(22), dp(8), dp(22), 0)
        }
        box.addView(muted("Read this aloud in your normal voice, in a quiet room, about 20 cm from the phone:"))
        box.addFull(TextView(this).apply {
            text = MyVoices.SCRIPT
            textSize = 16f
            setLineSpacing(0f, 1.25f)
            setTextColor(color(R.attr.p2aText))
        }, 8)
        val level = ProgressBar(this, null, 0, R.style.P2A_Progress).apply { max = 100 }
        box.addFull(level)
        val status = muted("Tap Start, then read.")
        box.addFull(status, 4)
        val consent = consentBox()
        box.addFull(consent)
        var recorder: VoiceRecorder? = null
        var samples: FloatArray? = null
        val dialog = AlertDialog.Builder(this)
            .setTitle("Record your voice")
            .setView(android.widget.ScrollView(this).apply { addView(box) })
            .setPositiveButton("Start", null)
            .setNegativeButton("Cancel") { _, _ -> recorder?.stop() }
            .setCancelable(false)
            .show()
        val action = dialog.getButton(AlertDialog.BUTTON_POSITIVE)
        action.setOnClickListener {
            when {
                action.text == "Stop" -> {
                    samples = recorder!!.stop()
                    val secs = (samples?.size ?: 0) / MyVoices.RATE
                    status.text = "Recorded $secs seconds. Tap Save, or Start again to redo it."
                    action.text = "Save"
                }
                samples != null && action.text == "Save" -> {
                    if (!consent.isChecked) return@setOnClickListener toast("Please confirm the permission checkbox")
                    dialog.dismiss()
                    askName { name -> saveVoice(name, samples!!, MyVoices.RATE) }
                }
                else -> {
                    samples = null
                    recorder = VoiceRecorder { peak, secs ->
                        runOnUiThread {
                            level.progress = (peak * 140).toInt().coerceAtMost(100)
                            status.text = "Recording… ${secs.toInt()} s" + when {
                                secs < MyVoices.MIN_SECONDS + 6 -> ""
                                secs >= MyVoices.MAX_SECONDS -> " (that's plenty: tap Stop)"
                                else -> " (tap Stop when you finish)"
                            }
                            if (recorder?.isRunning == false && action.text == "Stop") action.performClick()
                        }
                    }
                    try {
                        recorder!!.start()
                        action.text = "Stop"
                    } catch (e: Exception) {
                        status.text = e.message ?: "Couldn't start recording"
                    }
                }
            }
        }
    }

    private fun importVoice() {
        val intent = Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("audio/*")
            .putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("audio/*", "video/*"))
        @Suppress("DEPRECATION")
        startActivityForResult(Intent.createChooser(intent, "Choose a recording of the voice"), REQ_IMPORT)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        val uri = data?.data
        if (requestCode != REQ_IMPORT || resultCode != RESULT_OK || uri == null) return
        val consent = consentBox()
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(22), dp(8), dp(22), 0)
            addView(muted("Best: 10–25 seconds of one person speaking clearly, without music or other voices. Only the first 25 seconds of speech are used."))
            addFull(consent)
        }
        val dialog = AlertDialog.Builder(this)
            .setTitle("Clone this recording?")
            .setView(box)
            .setPositiveButton("Continue", null)
            .setNegativeButton("Cancel", null)
            .show()
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
            if (!consent.isChecked) return@setOnClickListener toast("Please confirm the permission checkbox")
            dialog.dismiss()
            askName { name ->
                scope.launch {
                    try {
                        val ref = withContext(Dispatchers.IO) { MyVoices.decode(this@VoiceStudioActivity, uri) }
                        saveVoice(name, ref.samples, ref.sampleRate)
                    } catch (e: Exception) {
                        toast("Couldn't read that recording: ${e.message}")
                    }
                }
            }
        }
    }

    private fun askName(then: (String) -> Unit) {
        val input = EditText(this).apply {
            hint = "Name, e.g. My voice"
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

    private fun saveVoice(name: String, samples: FloatArray, rate: Int) {
        scope.launch {
            try {
                val voice = withContext(Dispatchers.Default) { MyVoices.add(name, samples, rate) }
                Speaker.refreshVoices()
                AlertDialog.Builder(this@VoiceStudioActivity)
                    .setTitle("“${voice.name}” is ready")
                    .setMessage("Listen to it, or use it to read your documents.")
                    .setPositiveButton("Use it") { _, _ -> use(Speaker.CLONE + voice.id) }
                    .setNeutralButton("Listen", null)
                    .setNegativeButton("Close") { _, _ -> Speaker.stopPreview() }
                    .show()
                    .getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener { preview(Speaker.CLONE + voice.id) }
            } catch (e: Exception) {
                AlertDialog.Builder(this@VoiceStudioActivity)
                    .setTitle("Couldn't make the voice")
                    .setMessage(e.message ?: "Something went wrong")
                    .setPositiveButton("OK", null)
                    .show()
            }
        }
    }

    private fun voiceMenu(v: MyVoices.Voice) {
        AlertDialog.Builder(this)
            .setTitle(v.name)
            .setItems(arrayOf("Rename", "Delete")) { _, which ->
                if (which == 0) {
                    val input = EditText(this).apply { setText(v.name); isSingleLine = true }
                    AlertDialog.Builder(this)
                        .setTitle("Rename")
                        .setView(LinearLayout(this).apply {
                            setPadding(dp(22), dp(8), dp(22), 0)
                            addView(input, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
                        })
                        .setPositiveButton("Save") { _, _ ->
                            MyVoices.rename(v.id, input.text.toString())
                            Speaker.refreshVoices()
                        }
                        .setNegativeButton("Cancel", null)
                        .show()
                } else {
                    AlertDialog.Builder(this)
                        .setTitle("Delete “${v.name}”?")
                        .setMessage("The recording is deleted from this phone.")
                        .setPositiveButton("Delete") { _, _ ->
                            MyVoices.delete(v.id)
                            Speaker.refreshVoices()
                        }
                        .setNegativeButton("Cancel", null)
                        .show()
                }
            }
            .show()
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
}
