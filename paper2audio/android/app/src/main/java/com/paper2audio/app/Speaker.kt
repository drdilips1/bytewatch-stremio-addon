package com.paper2audio.app

import android.content.Context
import android.content.SharedPreferences
import android.media.MediaPlayer
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.Locale
import java.util.concurrent.CopyOnWriteArraySet
import kotlin.math.roundToInt

/**
 * Read-aloud engine. Voices are Microsoft neural voices ("edge:NAME", natural,
 * needs internet), on-device voices after a one-time download (Kokoro
 * "kokoro:NAME", Supertonic "super:NAME", cloned "clone:ID") or the phone's own
 * TTS voices ("sys:NAME").
 * All state changes happen on the main thread; listeners are called there too.
 */
object Speaker {
    const val EDGE = "edge:"
    const val SYSTEM = "sys:"
    const val KOKORO = "kokoro:"
    const val SUPER = "super:"
    const val CLONE = "clone:"
    const val DEFAULT_VOICE = EDGE + "en-US-AndrewMultilingualNeural"
    private const val LOOKAHEAD = 3
    private const val PIECE_LOOKAHEAD = 5

    data class VoiceOption(val id: String, val label: String)

    /** The phone's own default voice (the Play Store edition starts with it; no download needed). */
    const val PHONE_DEFAULT = SYSTEM

    /** Microsoft Andrew in the full edition; in the Play Store edition the best voice already on the phone. */
    fun defaultVoice(): String = when {
        !BuildConfig.LITE -> DEFAULT_VOICE
        LocalTts.supported && LocalTts.SUPERTONIC_PACK.isInstalled() -> SUPER + "F1"
        LocalTts.supported && LocalTts.KOKORO_PACK.isInstalled() -> KOKORO + Kokoro.VOICES.first().name
        else -> PHONE_DEFAULT
    }

    private lateinit var app: Context
    private val prefs: SharedPreferences by lazy { app.getSharedPreferences("p2a", Context.MODE_PRIVATE) }
    private val main = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val listeners = CopyOnWriteArraySet<() -> Unit>()
    private val pendingReady = ArrayList<() -> Unit>()

    private var tts: TextToSpeech? = null
    private var systemReady = false
    private var initialized = false
    private var edgeVoices: List<EdgeTts.VoiceInfo> = EdgeTts.CURATED

    var doc: Doc? = null
        private set
    var index = 0
        private set
    var playing = false
        private set
    var speed = 1.0f
        private set
    private var speedRendered = 1.0f
    var voiceId: String = DEFAULT_VOICE
        private set
    /** Set when playback stops because of an error; the UI shows it once. */
    var lastError: String? = null
    /** Increments whenever the list of available voices changes. */
    var voicesVersion = 0
        private set

    val isEdge: Boolean get() = voiceId.startsWith(EDGE)
    val isLocal: Boolean get() = LocalTts.isLocal(voiceId)
    /** Voices played from generated audio files (true pause/resume). */
    private val isStreamed: Boolean get() = isEdge || isLocal

    /** Second voice for quoted dialogue ("stories"), if chosen and compatible with the main voice. */
    val dialogueVoice: String?
        get() = prefs.getString("dialogueVoice", null)?.takeIf { d ->
            d != voiceId && (isEdge && d.startsWith(EDGE) || isLocal && LocalTts.isLocal(d) && LocalTts.missing(d) == null)
        }

    /** Pitch shift for online voices, in Hz (voice design). */
    val pitch: Int get() = prefs.getInt("pitch", 0)

    /** How the current document is voiced. */
    fun voicing(d: Doc? = doc): Voicing = Voicing(voiceId, dialogueVoice, d?.lang, pitch, medical)

    /** Medical mode: dosing, routes and clinical-trial abbreviations are read in full. */
    val medical: Boolean get() = prefs.getBoolean("medical", false)

    fun setMedical(on: Boolean) {
        prefs.edit().putBoolean("medical", on).apply()
        restartAudio()
    }

    fun setDialogueVoice(id: String?) {
        prefs.edit().putString("dialogueVoice", id).apply()
        castFor = null
        restartAudio()
    }

    fun setPitch(hz: Int) {
        prefs.edit().putInt("pitch", hz).apply()
        restartAudio()
    }

    /** Re-renders from the current position after a voicing change. */
    private fun restartAudio() {
        if (playing) {
            stopAll()
            play()
        } else {
            stopAll()
            prewarm()
        }
        notifyChanged()
    }

    fun setStyle(value: Style) {
        if (value == style) return
        style = value
        prefs.edit().putString("style", value.name).apply()
        tts?.setSpeechRate(renderSpeed)
        speedRendered = renderSpeed
        restartAudio()
    }

    /** Whether voice [id] can read language [lang] ("en", "hi", …). */
    fun voiceFits(lang: String, id: String = voiceId): Boolean = when {
        id.startsWith(EDGE) -> "Multilingual" in id || id.removePrefix(EDGE).startsWith("$lang-")
        id.startsWith(SUPER) -> lang in LocalTts.SUPERTONIC_LANGS
        id.startsWith(KOKORO) || id.startsWith(CLONE) -> lang == "en"
        else -> true // phone voices: can't tell
    }

    /** A natural voice for [lang], preferring the current voice's gender. */
    fun suggestVoice(lang: String): String? {
        val male = voiceOptions().firstOrNull { it.id == voiceId }?.label?.contains("male") == true &&
            voiceOptions().firstOrNull { it.id == voiceId }?.label?.contains("female") == false
        val candidates = edgeVoices.filter { it.locale.startsWith("$lang-") }
        val edge = candidates.firstOrNull { (it.gender == "Male") == male } ?: candidates.firstOrNull()
        return when {
            edge != null -> EDGE + edge.name
            lang in LocalTts.SUPERTONIC_LANGS -> SUPER + if (male) "M1" else "F1"
            else -> null
        }
    }

    // ---- Sections: skipping and finished ----

    /** Titles of the chapters the listener chose to skip in the current document. */
    fun skipped(d: Doc? = doc): Set<String> =
        d?.let { prefs.getStringSet("skip:${it.key}", emptySet()) }.orEmpty()

    fun setSkipped(titles: Set<String>) {
        val d = doc ?: return
        prefs.edit().putStringSet("skip:${d.key}", titles).apply()
        restartAudio()
    }

    /** Chapters listened to the end (audiobook progress). */
    fun finished(d: Doc? = doc): Set<String> =
        d?.let { prefs.getStringSet("done:${it.key}", emptySet()) }.orEmpty()

    private fun markFinished(d: Doc, chapter: Chapter?) {
        chapter ?: return
        val done = finished(d)
        if (chapter.title !in done) prefs.edit().putStringSet("done:${d.key}", done + chapter.title).apply()
    }

    private fun isSkipped(d: Doc, paragraph: Int, skip: Set<String>): Boolean =
        skip.isNotEmpty() && d.chapterAt(paragraph)?.title in skip

    /** Why the current voice can't play yet (a model to download), or null. */
    fun missingPack(): ModelPack? = LocalTts.missing(voiceId)

    /** True from pressing Play until the first audio is ready (loading a voice can take a few seconds). */
    var starting = false
        private set

    /** The sentence(s) being read right now, for highlighting in the reader. */
    var currentPiece: String? = null
        private set
    private var warmJob: Job? = null

    /** Bumped on every restart so callbacks from stopped audio are ignored. */
    private var generation = 0

    // Phone TTS playback state.
    private var queuedUpTo = -1

    // Natural voice playback state: one continuous audio stream per session.
    private var session: Job? = null
    private var stream: AudioStream? = null

    /** Which piece (about a sentence) of the current paragraph is being read. */
    var pieceIndex = 0
        private set

    /** Speaking style (pace and pauses). */
    var style: Style = Style.STANDARD
        private set

    /** The speed audio is rendered at: the chosen speed times the style's pace. */
    val renderSpeed: Float get() = speed * style.rate

    fun init(context: Context, onReady: () -> Unit) {
        if (initialized) {
            if (tts == null || systemReady) onReady() else pendingReady += onReady
            return
        }
        initialized = true
        app = context.applicationContext
        ModelPack.init(app)
        MyVoices.init(app)
        speed = prefs.getFloat("speed", 1.0f)
        style = Style.of(prefs.getString("style", null))
        speedRendered = renderSpeed
        voiceId = prefs.getString("voice2", null) ?: defaultVoice()
        // A cloned voice that no longer exists (deleted, or a retired ready-made one) falls back to the default.
        if (voiceId.startsWith(CLONE) && MyVoices.get(voiceId.removePrefix(CLONE)) == null) voiceId = defaultVoice()
        // The Play Store edition has on-device and phone voices only.
        if (BuildConfig.LITE && (voiceId.startsWith(EDGE) || voiceId.startsWith(CLONE))) voiceId = defaultVoice()
        warmUpLocal()
        pendingReady += onReady
        tts = TextToSpeech(app) { status ->
            main.post {
                systemReady = status == TextToSpeech.SUCCESS
                if (systemReady) configureSystem()
                voicesVersion++
                pendingReady.forEach { it() }
                pendingReady.clear()
                notifyChanged()
            }
        }
        if (!BuildConfig.LITE) scope.launch {
            runCatching { withContext(Dispatchers.IO) { EdgeTts.listVoices() } }.onSuccess { all ->
                val curated = EdgeTts.CURATED.map { it.name }.toSet()
                edgeVoices = EdgeTts.CURATED + all.filter { it.name !in curated }.sortedBy { it.locale }
                voicesVersion++
                notifyChanged()
            }
        }
    }

    private fun configureSystem() {
        val t = tts ?: return
        t.setSpeechRate(renderSpeed)
        if (voiceId.startsWith(SYSTEM)) t.voices?.firstOrNull { it.name == voiceId.removePrefix(SYSTEM) }?.let { t.voice = it }
        t.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(id: String) {
                main.post { handleStart(id) }
            }

            override fun onDone(id: String) {
                main.post { handleDone(id) }
            }

            @Deprecated("Deprecated in Java")
            override fun onError(id: String) {
                main.post { handleDone(id) }
            }
        })
    }

    /**
     * The favorite Microsoft voices (Andrew, Ava, Thomas…), then the other
     * suggested ones, Kokoro, all remaining Microsoft voices, and phone voices.
     */
    fun voiceOptions(): List<VoiceOption> {
        val out = ArrayList<VoiceOption>()
        fun edge(v: EdgeTts.VoiceInfo, mark: String) {
            val person = v.name.substringAfterLast('-').removeSuffix("Neural").removeSuffix("Multilingual")
            val locale = Locale.forLanguageTag(v.locale).displayName
            out += VoiceOption(EDGE + v.name, "$mark $person · $locale · ${v.gender.lowercase()} (online)")
        }
        val curatedCount = EdgeTts.CURATED.size
        EdgeTts.FAVORITES.forEach { edge(it, "★") }
        if (LocalTts.supported) {
            // Pocket voices: natural, on the phone; ready-made ones and the user's own.
            val pNote = if (LocalTts.POCKET_PACK.isInstalled()) "offline" else "one-time download"
            for (v in MyVoices.list()) {
                val what = if (v.builtIn) v.description else "your voice"
                out += VoiceOption(CLONE + v.id, "♥ ${v.name} · $what (English, $pNote)")
            }
        }
        edgeVoices.take(curatedCount).drop(EdgeTts.FAVORITES.size).forEach { edge(it, "•") }
        if (LocalTts.supported) {
            val sNote = if (LocalTts.SUPERTONIC_PACK.isInstalled()) "offline" else "one-time download"
            for (v in LocalTts.SUPERTONIC_VOICES) out += VoiceOption(SUPER + v.name, "◆ ${v.label} · 31 languages ($sNote)")
            val kNote = if (LocalTts.KOKORO_PACK.isInstalled()) "offline" else "one-time download"
            for (v in Kokoro.VOICES) out += VoiceOption(KOKORO + v.name, "◆ ${v.label} (Kokoro, $kNote)")
        }
        edgeVoices.drop(curatedCount).forEach { edge(it, "•") }
        val lang = Locale.getDefault().language
        val phone = tts?.voices.orEmpty()
            .filter { TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED !in it.features }
            .sortedWith(compareBy({ it.locale.language != lang }, { it.locale.displayName }, { it.name }))
        for (v in phone) {
            val online = if (v.isNetworkConnectionRequired) ", online" else ""
            out += VoiceOption(SYSTEM + v.name, "Phone · ${v.locale.displayName} · ${v.name}$online")
        }
        // Keep the saved choice selectable even if its list hasn't loaded yet.
        if (out.none { it.id == voiceId }) out.add(0, VoiceOption(voiceId, voiceId.substringAfter(':')))
        return out
    }

    fun setVoice(id: String) {
        if (id == voiceId) return
        AppLog.i("Player", "Voice $voiceId -> $id")
        voiceId = id
        prefs.edit().putString("voice2", id).apply()
        if (id.startsWith(SYSTEM)) tts?.let { t ->
            (t.voices?.firstOrNull { it.name == id.removePrefix(SYSTEM) } ?: t.defaultVoice)?.let { t.voice = it }
        }
        // Always stop the old voice first, so it can never keep going under the new name;
        // then continue from the sentence being read.
        stopAll()
        if (playing) {
            play()
        } else {
            warmUpLocal()
            prewarm()
        }
        notifyChanged()
    }

    /** Call after a voice download finishes or cloned voices change, so the voice list updates. */
    fun refreshVoices() {
        voicesVersion++
        if (voiceId.startsWith(CLONE) && MyVoices.get(voiceId.removePrefix(CLONE)) == null) setVoice(defaultVoice())
        warmUpLocal()
        notifyChanged()
    }

    /** Loads the on-device model in the background so pressing Play starts quickly. */
    private fun warmUpLocal() {
        val vid = voiceId
        if (!LocalTts.isLocal(vid) || LocalTts.missing(vid) != null) return
        scope.launch(Renderer.localThread) { runCatching { LocalTts.prepare(vid) } }
    }

    fun setSpeed(value: Float) {
        speed = value
        prefs.edit().putFloat("speed", value).apply()
        tts?.setSpeechRate(renderSpeed)
        // Only the part above what the engine renders changes: adjust the running stream.
        val s = stream
        val v = voicing()
        val sameAudio = isStreamed && Renderer.engineSpeed(v, renderSpeed) == Renderer.engineSpeed(v, speedRendered)
        if (sameAudio && s != null) {
            s.setBoost(Renderer.playbackBoost(v, renderSpeed))
        } else {
            stopAll()
            if (playing) play() else prewarm()
        }
        speedRendered = renderSpeed
        notifyChanged()
    }

    fun load(newDoc: Doc) {
        if (playing) pause()
        stopAll()
        AppLog.i("Player", "Opened ${newDoc.paragraphs.size} paragraphs, ${newDoc.chapters.size} chapters, start ${newDoc.start}")
        doc = newDoc
        index = prefs.getInt("pos:${newDoc.key}", newDoc.start).coerceIn(0, maxOf(0, newDoc.paragraphs.size - 1))
        pieceIndex = prefs.getInt("pc:${newDoc.key}", 0).coerceAtLeast(0)
        currentPiece = null
        if (newDoc.lang == null) {
            // Language matters for Supertonic and for suggesting a fitting voice.
            scope.launch {
                withContext(Dispatchers.IO) { Langs.of(newDoc) }
                if (doc === newDoc) {
                    if (!playing) prewarm()
                    notifyChanged()
                }
            }
        } else {
            prewarm()
        }
        scope.launch(Dispatchers.IO) { Renderer.trim(app) }
        notifyChanged()
    }

    fun play() {
        val d = doc ?: return
        if (d.paragraphs.isEmpty()) return
        if (index >= d.paragraphs.size) index = 0
        lastError = null
        missingPack()?.let {
            stopAll()
            playing = false
            lastError = if (BuildConfig.LITE) "Download the ${it.title} first (Voice), or choose another voice."
            else "Download the ${it.title} first (Options tab), or choose a ★ voice."
            notifyChanged()
            return
        }
        if (isStreamed) {
            val s = stream
            // After a long pause the audio output may have gone stale (other apps, Bluetooth): start afresh.
            val fresh = System.currentTimeMillis() - pausedAt > 120_000
            if (s != null && session?.isActive == true && !fresh && !starting) s.resume() else startStreaming()
            watchStart()
        } else {
            if (!systemReady) {
                lastError = if (BuildConfig.LITE) "This phone has no working text-to-speech engine. Download a natural voice (Voice) instead."
                else "This phone has no working text-to-speech engine. Pick a ★ natural voice instead."
                notifyChanged()
                return
            }
            stopAll()
            queuedUpTo = index - 1
            enqueueSystem()
        }
        playing = true
        speedRendered = renderSpeed
        ReaderService.start(app)
        notifyChanged()
    }

    private var pausedAt = Long.MAX_VALUE
    private var watchdog: Job? = null

    /** If nothing is heard 20 s after Play (a stuck request or engine), tries once more. */
    private fun watchStart() {
        watchdog?.cancel()
        val g = generation
        watchdog = scope.launch {
            delay(20_000)
            if (playing && starting && g == generation && lastError == null) {
                AppLog.e("Player", "Nothing heard 20 s after Play with $voiceId; starting again")
                startStreaming()
            }
        }
    }

    fun pause() {
        pausedAt = System.currentTimeMillis()
        watchdog?.cancel()
        playing = false
        val s = stream
        if (isStreamed && s != null && session?.isActive == true) s.pause() else stopAll()
        notifyChanged()
    }

    fun toggle() = if (playing) pause() else play()

    fun seek(i: Int, piece: Int = 0) {
        val d = doc ?: return
        index = i.coerceIn(0, maxOf(0, d.paragraphs.size - 1))
        pieceIndex = piece.coerceAtLeast(0)
        stopAll()
        savePosition()
        currentPiece = null
        if (playing) play() else {
            prewarm()
            notifyChanged()
        }
    }

    fun next() = seek(index + 1)

    fun previous() = seek(index - 1)

    /** Steps back one sentence (to the previous paragraph's last one at a paragraph start). */
    fun previousSentence() {
        val d = doc ?: return
        val count = { i: Int -> if (isStreamed) piecesOf(d, i, voiceId).size else systemSentences(d, i).size }
        when {
            pieceIndex > 0 -> seek(index, pieceIndex - 1)
            index > 0 -> seek(index - 1, count(index - 1) - 1)
            else -> seek(0)
        }
    }

    fun nextSentence() {
        val d = doc ?: return
        val count = if (isStreamed) piecesOf(d, index, voiceId).size else systemSentences(d, index).size
        if (pieceIndex + 1 < count) seek(index, pieceIndex + 1) else seek(index + 1)
    }

    private fun stopAll() {
        generation++
        tts?.stop()
        session?.cancel()
        session = null
        // Pending warm-ups for the old voice would hold up the on-device engine.
        warmJob?.cancel()
        starting = false
        stream?.release()
        stream = null
    }

    private fun fail(message: String) {
        AppLog.e("Player", message)
        stopAll()
        playing = false
        lastError = message
        notifyChanged()
    }

    // ---- Phone TTS ----

    private fun enqueueSystem() {
        val d = doc ?: return
        val t = tts ?: return
        val skip = skipped(d)
        var last = minOf(index + LOOKAHEAD, d.paragraphs.size - 1)
        while (queuedUpTo < last) {
            queuedUpTo++
            if (isSkipped(d, queuedUpTo, skip)) {
                last = minOf(last + 1, d.paragraphs.size - 1)
                continue
            }
            // One utterance per sentence, so the sentence being read is highlighted.
            val sentences = systemSentences(d, queuedUpTo)
            val from = if (queuedUpTo == index) pieceIndex.coerceIn(0, sentences.size - 1) else 0
            for (k in from until sentences.size) {
                val last = if (k == sentences.size - 1) 1 else 0
                t.speak(Speech.normalize(sentences[k], medical), TextToSpeech.QUEUE_ADD, Bundle(), "$generation:$queuedUpTo:$k:$last")
            }
        }
    }

    private fun systemSentences(d: Doc, i: Int): List<String> =
        TextCleaner.sentences(d.paragraphs[i]).filter { it.isNotBlank() }.ifEmpty { listOf(d.paragraphs[i]) }

    /** (paragraph, sentence, last sentence of the paragraph) of an utterance id from this generation. */
    private fun parse(id: String): Triple<Int, Int, Boolean>? {
        val parts = id.split(':').map { it.toIntOrNull() ?: return null }
        if (parts.size != 4 || parts[0] != generation || isStreamed) return null
        return Triple(parts[1], parts[2], parts[3] == 1)
    }

    private fun handleStart(id: String) {
        val (idx, k, _) = parse(id) ?: return
        if (idx != index) moveTo(idx)
        pieceIndex = k
        currentPiece = doc?.let { systemSentences(it, idx).getOrNull(k) } ?: doc?.paragraphs?.getOrNull(idx)
        notifyChanged()
    }

    private fun handleDone(id: String) {
        val (idx, _, lastInParagraph) = parse(id) ?: return
        if (!lastInParagraph) return
        val d = doc ?: return
        if (idx >= d.paragraphs.size - 1) {
            playing = false
            notifyChanged()
        } else {
            enqueueSystem()
        }
    }

    // ---- Natural voices: render paragraphs to files ahead of playback ----

    fun ratePercent(s: Float = speed) = ((s - 1f) * 100).roundToInt().coerceIn(-50, 200)

    /** One piece of reading (about a sentence) and the voice that reads it. */
    class Piece(val paragraph: Int, val index: Int, val text: String, val lastInParagraph: Boolean, val voice: String)

    /** Full cast: a voice per character in stories (instead of one dialogue voice). */
    val fullCast: Boolean get() = prefs.getBoolean("fullCast", false)

    fun setFullCast(on: Boolean) {
        prefs.edit().putBoolean("fullCast", on).apply()
        castFor = null
        restartAudio()
    }

    // Cast state is also read by offline download and saving, off the main thread.
    @Volatile
    private var castFor: String? = null
    private val castVoices = java.util.concurrent.ConcurrentHashMap<String, String>()
    /** Speakers of each script/transcript document (by document object: chapter files are separate documents). */
    private val speakersByDoc = java.util.Collections.synchronizedMap(java.util.WeakHashMap<Doc, List<String>>())

    private fun speakersOf(d: Doc): List<String> = speakersByDoc.getOrPut(d) { Cast.scriptSpeakers(d) }
    @Volatile
    private var castText = ""

    /** Voices for extra speakers, in the same family as [main] (online, cloned, Supertonic or Kokoro). */
    private fun pool(main: String, male: Boolean): List<String> = when {
        main.startsWith(EDGE) -> (if (male) listOf(
            "en-US-AndrewMultilingualNeural", "en-US-BrianMultilingualNeural", "en-GB-ThomasNeural", "en-US-GuyNeural", "en-GB-RyanNeural",
        ) else listOf(
            "en-US-AvaMultilingualNeural", "en-US-EmmaMultilingualNeural", "en-US-AriaNeural", "en-GB-SoniaNeural", "en-AU-NatashaNeural",
        )).map { EDGE + it }
        main.startsWith(CLONE) -> MyVoices.BUILT_IN.filter { it.description.startsWith(if (male) "male" else "female") }.map { CLONE + it.id }
        main.startsWith(SUPER) -> LocalTts.SUPERTONIC_VOICES.filter { it.name.startsWith(if (male) "M" else "F") }.map { SUPER + it.name }
        main.startsWith(KOKORO) -> Kokoro.VOICES.filter { (it.name[1] == 'm') == male }.map { KOKORO + it.name }
        else -> emptyList()
    }

    /** Whether voice [id] sounds male (best guess from its name or description). */
    private fun isMale(id: String): Boolean = when {
        id.startsWith(EDGE) -> (EdgeTts.CURATED.firstOrNull { EDGE + it.name == id }?.gender
            ?: edgeVoices.firstOrNull { EDGE + it.name == id }?.gender) == "Male"
        id.startsWith(CLONE) -> MyVoices.get(id.removePrefix(CLONE))?.description?.startsWith("male") == true
        id.startsWith(SUPER) -> id.removePrefix(SUPER).startsWith("M")
        id.startsWith(KOKORO) -> id.removePrefix(KOKORO).getOrNull(1) == 'm'
        else -> false
    }

    /** The voice for [speaker]: the first script speaker is the main voice; others get distinct voices. */
    @Synchronized
    private fun castVoice(d: Doc, speaker: String): String {
        if (castFor != d.key + voiceId) {
            castFor = d.key + voiceId
            castVoices.clear()
            castText = d.paragraphs.take(400).joinToString(" ")
        }
        castVoices[speaker]?.let { return it }
        val main = voiceId
        val used = castVoices.values.toSet() + main
        val scriptSpeakers = speakersOf(d)
        val voice = if (scriptSpeakers.isNotEmpty() && speaker == scriptSpeakers.first()) main else {
            if (scriptSpeakers.isNotEmpty() && speaker == scriptSpeakers.getOrNull(1) && dialogueVoice != null) {
                dialogueVoice!!
            } else {
                val gender = Cast.genderOf(speaker, castText, castVoices.keys + scriptSpeakers)
                val male = when (gender) {
                    "male" -> true
                    "female" -> false
                    else -> !isMale(main) // unknown: contrast with the narrator
                }
                val candidates = pool(main, male).filter { LocalTts.missing(it) == null }
                candidates.firstOrNull { it !in used } ?: candidates.firstOrNull { it != main } ?: dialogueVoice ?: main
            }
        }
        castVoices[speaker] = voice
        return voice
    }

    /** The pieces of paragraph [k], each with its voice. */
    private fun piecesOf(d: Doc, k: Int, vid: String): List<Piece> {
        val para = d.paragraphs[k]
        val speakers = speakersOf(d)
        val script = speakers.takeIf { it.isNotEmpty() }?.let { Cast.scriptLine(para) }?.takeIf { it.first in speakers }
        val segments: List<Pair<String, String>> = when {
            !isStreamed -> listOf(para to vid)
            // "Host: …": the label isn't read; the speaker's voice reads the rest.
            script != null -> listOf(script.second to castVoice(d, script.first))
            fullCast || dialogueVoice != null -> Cast.storySegments(para).map { s ->
                s.text to when {
                    s.speaker == null -> vid
                    fullCast -> castVoice(d, s.speaker)
                    else -> dialogueVoice!!
                }
            }
            else -> listOf(para to vid)
        }
        val out = ArrayList<Piece>()
        for ((text, voice) in segments) for (t in Renderer.pieces(text, voice)) out += Piece(k, out.size, t, false, voice)
        if (out.isEmpty()) return emptyList()
        out[out.lastIndex] = out.last().let { Piece(it.paragraph, it.index, it.text, true, it.voice) }
        return out
    }

    private fun pieceSequence(d: Doc, fromParagraph: Int, fromPiece: Int, vid: String) = sequence {
        val skip = skipped(d)
        for (k in fromParagraph until d.paragraphs.size) {
            if (isSkipped(d, k, skip)) continue
            val ps = piecesOf(d, k, vid)
            val first = if (k == fromParagraph) fromPiece.coerceIn(0, maxOf(0, ps.size - 1)) else 0
            for (j in first until ps.size) yield(ps[j])
        }
    }

    /** Every piece of [d] with its voicing, for offline download and saving audio. */
    fun plan(d: Doc): List<Pair<String, Voicing>> {
        val base = voicing(d).copy(dialogue = null)
        return pieceSequence(d, 0, 0, voiceId).map { it.text to base.copy(voiceId = it.voice) }.toList()
    }

    /** The pause after a piece: longer after paragraphs, longest after headings. */
    private fun pauseAfter(d: Doc, p: Piece): Int = when {
        !p.lastInParagraph -> style.sentencePause
        d.chapters.any { it.start == p.paragraph } && d.paragraphs[p.paragraph].length < 150 -> style.headingPause
        else -> style.paragraphPause
    }

    private fun startStreaming() {
        stopAll()
        val d = doc ?: return
        val g = generation
        val vid = voiceId
        val currentSpeed = renderSpeed
        starting = true
        session = scope.launch {
            // Supertonic reads in the document's language: make sure it's known (fast, on the phone).
            if (d.lang == null && LocalTts.isLocal(vid)) withContext(Dispatchers.IO) { Langs.of(d) }
            val v = voicing(d)
            val out = AudioStream(app, Renderer.playbackBoost(v, currentSpeed))
            if (!playing) out.pause()
            stream = out
            // On-device voices: a long first sentence is cut at a comma or space, so the first sound comes sooner.
            val pieces = pieceSequence(d, index, pieceIndex, vid).let { seq ->
                if (!LocalTts.isLocal(vid)) seq else sequence {
                    var first = true
                    for (p in seq) {
                        if (first && p.text.length > 90) {
                            val parts = TextCleaner.splitLong(p.text, 70)
                            parts.forEachIndexed { k, t ->
                                yield(Piece(p.paragraph, p.index, t, p.lastInParagraph && k == parts.size - 1, p.voice))
                            }
                        } else {
                            yield(p)
                        }
                        first = false
                    }
                }
            }.iterator()
            val queue = ArrayDeque<Pair<Piece, Deferred<Pcm16>>>()
            val base = v.copy(dialogue = null)
            suspend fun load(p: Piece): Pcm16 {
                val pv = base.copy(voiceId = p.voice)
                val file = try {
                    Renderer.render(app, pv, currentSpeed, p.text)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    AppLog.e("Player", "Retrying a piece with ${p.voice}: ${e.message}")
                    Renderer.render(app, pv, currentSpeed, p.text) // one more try: networks drop requests
                }
                return withContext(Dispatchers.Default) { AudioDecode.load(file) }
            }
            fun fill() {
                while (queue.size < PIECE_LOOKAHEAD && pieces.hasNext()) {
                    val p = pieces.next()
                    queue.addLast(p to async { load(p) })
                }
            }

            // Follows what is being heard: highlight, position, sleep at end of chapter.
            val follow = launch {
                var shown: Piece? = null
                while (true) {
                    val p = out.currentTag() as Piece?
                    if (p != null && p !== shown && g == generation) {
                        shown = p
                        starting = false
                        if (p.paragraph != index) moveTo(p.paragraph)
                        pieceIndex = p.index
                        currentPiece = p.text
                        savePosition()
                        notifyChanged()
                    }
                    delay(60)
                }
            }

            try {
                while (true) {
                    fill()
                    val (piece, pending) = queue.removeFirstOrNull() ?: break
                    val pcm = try {
                        pending.await()
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        if (g == generation) {
                            AppLog.e("Player", "Rendering with $vid failed", e)
                            fail(
                                if (LocalTts.isLocal(vid)) "The on-device voice couldn't read this (${e.message})."
                                else "Couldn't reach the natural voice service (${e.message}). Check your internet, or download the document for offline listening."
                            )
                        }
                        return@launch
                    }
                    if (g != generation) return@launch
                    fill() // keep rendering ahead while this piece plays
                    out.write(pcm, piece, pauseAfter(d, piece))
                }
                out.drain()
            } finally {
                follow.cancel()
            }
            if (g == generation) {
                playing = false
                starting = false
                currentPiece = null
                markFinished(d, d.chapterAt(index))
                // Finished: the next Play starts from the beginning of the last paragraph.
                pieceIndex = 0
                stopAll()
                notifyChanged()
            }
        }
    }

    /** Renders the first pieces at the current position in the background, so Play starts at once. */
    private fun prewarm() {
        val d = doc ?: return
        if (playing || !isStreamed || missingPack() != null) return
        if (d.lang == null && LocalTts.isLocal(voiceId)) return // load() prewarms once the language is known
        val vid = voiceId
        val v = voicing(d).copy(dialogue = null)
        val sp = renderSpeed
        val from = index
        val fromPiece = pieceIndex
        warmJob?.cancel()
        warmJob = scope.launch {
            val first = pieceSequence(d, from, fromPiece, vid).take(2).toList()
            for (p in first) runCatching { Renderer.render(app, v.copy(voiceId = p.voice), sp, p.text) }
        }
    }

    /** Called whenever playback reaches a new paragraph. */
    private fun moveTo(k: Int) {
        val d = doc
        val oldChapter = d?.chapterAt(index)
        if (d != null && k > index && d.chapterAt(k) != oldChapter) markFinished(d, oldChapter)
        index = k
        savePosition()
        if (sleepEndOfChapter && d != null && d.chapterAt(k) != oldChapter) {
            sleepEndOfChapter = false
            pause()
        }
    }

    // ---- Voice preview ----

    private var previewPlayer: MediaPlayer? = null
    private const val PREVIEW_TEXT =
        "Hello! This is how I will sound reading your papers and books aloud. Choose the voice you like best."

    /** Stops a voice preview or a spoken AI answer. */
    fun stopPreview() {
        previewPlayer?.let { runCatching { it.stop() }; it.release() }
        previewPlayer = null
        if (!isStreamed && !playing) tts?.stop()
    }

    /** Speaks [text] once with [voice] (default: the current voice), e.g. a voice preview. */
    fun preview(text: String = PREVIEW_TEXT, voice: String = voiceId, pitchHz: Int = pitch) =
        previewVoicing(text, Voicing(voice, lang = doc?.lang, pitch = pitchHz))

    /** Plays a story sample: narration in the current voice, dialogue in [dialogue]. */
    fun previewStory(text: String, dialogue: String) = previewVoicing(text, voicing().copy(dialogue = dialogue))

    /** All Microsoft voices (favorites first), for voice design. */
    val onlineVoices: List<EdgeTts.VoiceInfo> get() = edgeVoices

    private fun previewVoicing(text: String, v: Voicing) {
        if (playing) pause()
        if (!Renderer.isStreamed(v.voiceId)) {
            tts?.speak(text, TextToSpeech.QUEUE_FLUSH, Bundle(), "preview:x")
            return
        }
        (LocalTts.missing(v.voiceId) ?: v.dialogue?.let { LocalTts.missing(it) })?.let {
            lastError = "Download the ${it.title} first."
            notifyChanged()
            return
        }
        val sp = renderSpeed
        scope.launch {
            try {
                val f = Renderer.render(app, v, sp, text)
                previewPlayer?.release()
                previewPlayer = MediaPlayer().apply {
                    setDataSource(f.path)
                    prepare()
                    val boost = Renderer.playbackBoost(v, sp)
                    if (boost > 1.01f) runCatching { playbackParams = playbackParams.setSpeed(boost) }
                    setOnCompletionListener {
                        it.release()
                        if (previewPlayer === it) previewPlayer = null
                    }
                    start()
                }
            } catch (e: Exception) {
                AppLog.e("Preview", "Preview of ${v.voiceId} failed", e)
                lastError = "Couldn't play the preview (${e.message})."
                notifyChanged()
            }
        }
    }

    // ---- Sleep timer ----

    /** When the sleep timer stops playback (epoch millis), or 0 if off. */
    var sleepAt = 0L
        private set
    var sleepEndOfChapter = false
        private set
    private val sleepRunnable = Runnable {
        sleepAt = 0
        pause()
    }

    fun setSleepTimer(minutes: Int) {
        main.removeCallbacks(sleepRunnable)
        sleepEndOfChapter = false
        sleepAt = 0
        if (minutes > 0) {
            sleepAt = System.currentTimeMillis() + minutes * 60_000L
            main.postDelayed(sleepRunnable, minutes * 60_000L)
        }
        notifyChanged()
    }

    fun setSleepAtEndOfChapter() {
        setSleepTimer(0)
        sleepEndOfChapter = true
        notifyChanged()
    }

    private fun savePosition() {
        val d = doc ?: return
        prefs.edit().putInt("pos:${d.key}", index).putInt("pc:${d.key}", pieceIndex)
            .putLong("posAt:${d.key}", System.currentTimeMillis()).apply()
    }

    fun addListener(l: () -> Unit) {
        listeners += l
    }

    fun removeListener(l: () -> Unit) {
        listeners -= l
    }

    private fun notifyChanged() = listeners.forEach { it() }
}
