package com.paper2audio.app

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.os.Build
import android.os.PowerManager
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Battery and heat. The on-device voices make their speech while they read, which is what uses the
 * battery and warms the phone. So:
 *  - once the phone has nearly finished charging (90%+, idle, battery cool, so charging isn't slowed),
 *    the next hour of the book is made ahead and kept,
 *    then the start of the other recent books, then more overnight ([PrepareJob]); listening later on
 *    battery then only plays it back;
 *  - when the phone is warm, reading makes only just enough ahead ([warm]).
 */
object PowerWise {
    private const val JOB_ID = 4711

    /** About an hour of listening, made ahead while charging. */
    const val AHEAD_WORDS = 9_600

    /** The phone reports it is getting warm (Android 10+). */
    fun warm(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < 29) return false
        val power = context.getSystemService(PowerManager::class.java) ?: return false
        return power.currentThermalStatus >= PowerManager.THERMAL_STATUS_MODERATE
    }

    /**
     * Whether making audio now wouldn't slow the charging: the battery nearly full (fast charging is
     * over by then) and cool. Working while it charged warmed the phone, and the phone then charged
     * slowly to protect the battery.
     */
    fun goodTimeToPrepare(context: Context): Boolean {
        val battery = context.registerReceiver(null, android.content.IntentFilter(android.content.Intent.ACTION_BATTERY_CHANGED))
            ?: return false
        val level = battery.getIntExtra(android.os.BatteryManager.EXTRA_LEVEL, -1)
        val scale = battery.getIntExtra(android.os.BatteryManager.EXTRA_SCALE, 100).coerceAtLeast(1)
        val tenthsC = battery.getIntExtra(android.os.BatteryManager.EXTRA_TEMPERATURE, 0)
        return level * 100 / scale >= 90 && tenthsC < 370 && !warm(context)
    }

    /** Asks Android to run [PrepareJob] the next time the phone is charging (on-device voices only). */
    fun schedule(context: Context) {
        if (!LocalTts.isLocal(Speaker.voiceId)) return // online and phone voices make their speech cheaply
        runCatching {
            val jobs = context.getSystemService(JobScheduler::class.java) ?: return
            jobs.schedule(
                JobInfo.Builder(JOB_ID, ComponentName(context, PrepareJob::class.java))
                    .setRequiresCharging(true)
                    // Not while the phone is in use: in practice, overnight on the charger.
                    .setRequiresDeviceIdle(true)
                    // Waiting for the battery to be nearly full: look again every 20 minutes.
                    .setBackoffCriteria(20 * 60_000L, JobInfo.BACKOFF_POLICY_LINEAR)
                    .build()
            )
        }.onFailure { AppLog.e("Power", "Couldn't schedule preparing while charging", it) }
    }
}

/** Makes the audio ahead for the book being read, while the phone charges (see [PowerWise]). */
class PrepareJob : JobService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var job: Job? = null

    override fun onStartJob(params: JobParameters): Boolean {
        job = scope.launch {
            val again = try {
                prepare()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                AppLog.e("Power", "Preparing while charging stopped", e)
                true
            }
            jobFinished(params, again)
        }
        return true
    }

    /** Android stopped the job (unplugged, or its time is up): carry on next time. */
    override fun onStopJob(params: JobParameters): Boolean {
        job?.cancel()
        return true
    }

    /**
     * In rounds, so what's most likely to be listened to next is ready first: the book being read
     * (an hour ahead), then the start of the other recent books (20 minutes each, so whichever is picked
     * tomorrow starts from saved audio), then more of each while the phone stays on the charger
     * (overnight: three hours of this book, half an hour of the others). Returns whether there's more
     * to do later.
     */
    private suspend fun prepare(): Boolean {
        val app = applicationContext
        // Not while the battery is still charging fast, or warm: nothing at all runs, try again later.
        if (!PowerWise.goodTimeToPrepare(app)) return true
        withContext(Dispatchers.Main) { Speaker.init(app) {} }
        var doc = Speaker.doc
        if (doc == null) {
            // The app was closed: the book that was open last.
            Library.loadCurrentId(app)
            val item = Library.get(app, Library.currentId) ?: return false
            val opened = Opener.parse(app, item)
            withContext(Dispatchers.Main) { if (Speaker.doc == null) Speaker.load(opened) }
            doc = Speaker.doc ?: return false
        }
        if (!LocalTts.isLocal(Speaker.voiceId) || LocalTts.missing(Speaker.voiceId) != null) return false
        val speed = Speaker.renderSpeed
        val voice = Speaker.voiceId
        val current = doc
        // The other books most recently opened or added (not finished), newest first.
        val prefs = app.getSharedPreferences("p2a", Context.MODE_PRIVATE)
        val others = Library.items(app)
            .filter { it.id != Library.currentId && it.id != current.key }
            .filter { it.paragraphs == 0 || prefs.getInt("pos:${it.id}", 0) < it.paragraphs - 1 }
            .sortedByDescending { maxOf(it.opened, it.added) }
            .take(RECENT_BOOKS)
        val rounds = listOf(PowerWise.AHEAD_WORDS to 0, 0 to START_WORDS, OVERNIGHT_WORDS to OVERNIGHT_START_WORDS)
        for ((currentWords, otherWords) in rounds) {
            if (currentWords > 0 && !make(app, current, currentWords, speed, voice)) return true
            if (otherWords > 0) for (item in others) {
                val d = runCatching { Opener.parse(app, item) }.getOrNull() ?: continue
                if (!make(app, d, otherWords, speed, voice)) return true
            }
        }
        AppLog.i("Power", "Charging: everything ahead is ready")
        return false
    }

    /** Makes about [words] words of [d] ahead; false when it had to stop (reading, warm, unplugged, voice changed). */
    private suspend fun make(app: Context, d: Doc, words: Int, speed: Float, voice: String): Boolean {
        if (d.lang == null) Langs.of(d)
        val plan = Speaker.planAhead(d, words)
        val todo = plan.filter { (text, v) -> text.any { it.isLetterOrDigit() } && !Renderer.isCached(app, v, speed, text) }
        if (todo.isEmpty()) return true
        AppLog.i("Power", "Charging: making ${todo.size} of ${plan.size} pieces ahead of “${d.title.take(40)}”")
        for ((text, v) in todo) {
            if (Speaker.playing || !PowerWise.goodTimeToPrepare(app)) return false
            if (Speaker.voiceId != voice || Speaker.renderSpeed != speed) return false
            runCatching { Renderer.render(app, v, speed, text) }
                .onFailure { if (it is CancellationException) throw it }
        }
        return true
    }

    companion object {
        /** How many other recent books get their start made ahead. */
        private const val RECENT_BOOKS = 4

        /** About 20 minutes of listening: the start of each recent book. */
        private const val START_WORDS = 3_200

        /** Left on the charger (overnight): about three hours of this book, half an hour of the others. */
        private const val OVERNIGHT_WORDS = 28_800
        private const val OVERNIGHT_START_WORDS = 4_800
    }
}
