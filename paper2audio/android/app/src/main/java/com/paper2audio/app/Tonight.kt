package com.paper2audio.app

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import java.util.Calendar

/**
 * Tonight's list: books the listener picked for the coming days. While the phone charges and isn't in use,
 * within the chosen hours (12 am to 6 am unless changed), the next hours of each are made ahead and kept,
 * so listening later on battery only plays them back. Only a help for the battery: anything not made
 * ahead is made while listening, as always.
 */
object Tonight {
    private const val JOB_ID = 4712
    private const val KEY = "tonight"
    /** Words in an hour of listening at 1x. */
    const val WORDS_PER_HOUR = 9_600

    private fun prefs(c: Context) = c.getSharedPreferences("p2a", Context.MODE_PRIVATE)

    fun ids(c: Context): List<String> = runCatching {
        val a = JSONArray(prefs(c).getString(KEY, "[]"))
        List(a.length()) { a.getString(it) }
    }.getOrDefault(emptyList())

    private fun save(c: Context, ids: List<String>, reschedule: Boolean = true) {
        prefs(c).edit().putString(KEY, JSONArray(ids.distinct()).toString()).apply()
        if (reschedule) schedule(c)
    }

    fun contains(c: Context, id: String) = id in ids(c)

    fun add(c: Context, id: String) = save(c, ids(c) + id)

    /** [reschedule] false from inside the running job (scheduling again would stop it). */
    fun remove(c: Context, id: String, reschedule: Boolean = true) {
        prefs(c).edit().remove("tonightReady:$id").apply()
        save(c, ids(c) - id, reschedule)
    }

    /** Start and end hour (0–23); the window may run past midnight (22 to 6). */
    fun fromHour(c: Context) = prefs(c).getInt("tonightFrom", 0)
    fun toHour(c: Context) = prefs(c).getInt("tonightTo", 6)
    fun setHours(c: Context, from: Int, to: Int) {
        prefs(c).edit().putInt("tonightFrom", from).putInt("tonightTo", to).apply()
        schedule(c)
    }

    /** Hours of each book made ahead. */
    fun hoursPerBook(c: Context) = prefs(c).getInt("tonightHours", 2)
    fun setHoursPerBook(c: Context, h: Int) {
        prefs(c).edit().putInt("tonightHours", h).apply()
        schedule(c)
    }

    /** Minutes of [id] ready ahead from where it was left off, as last worked out (-1: not yet). */
    fun readyMinutes(c: Context, id: String) = prefs(c).getInt("tonightReady:$id", -1)
    internal fun setReady(c: Context, id: String, minutes: Int) = prefs(c).edit().putInt("tonightReady:$id", minutes).apply()

    fun hourLabel(h: Int) = when (h) {
        0 -> "12 am"
        12 -> "12 pm"
        in 1..11 -> "$h am"
        else -> "${h - 12} pm"
    }

    fun inWindow(c: Context, now: Calendar = Calendar.getInstance()): Boolean {
        val h = now.get(Calendar.HOUR_OF_DAY)
        val from = fromHour(c)
        val to = toHour(c)
        return if (from <= to) h in from until to else h >= from || h < to
    }

    /** Milliseconds until the window next opens ([afterThisOne]: the one after the window we're in). */
    private fun untilWindow(c: Context, afterThisOne: Boolean): Long {
        val now = Calendar.getInstance()
        if (!afterThisOne && inWindow(c, now)) return 0
        val start = (now.clone() as Calendar).apply {
            set(Calendar.HOUR_OF_DAY, fromHour(c))
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
            if (!after(now)) add(Calendar.DAY_OF_YEAR, 1)
        }
        return start.timeInMillis - now.timeInMillis
    }

    /**
     * Asks Android to run [TonightJob] once the phone is charging and idle, at the window's start or after
     * [retryMs] (still in the window) or at the next night's window ([nextNight]). Nothing runs in between.
     */
    fun schedule(c: Context, retryMs: Long? = null, nextNight: Boolean = false) {
        val jobs = c.getSystemService(JobScheduler::class.java) ?: return
        if (ids(c).isEmpty()) {
            jobs.cancel(JOB_ID)
            return
        }
        val wait = when {
            nextNight -> untilWindow(c, afterThisOne = true)
            retryMs != null && inWindow(c) -> retryMs
            else -> untilWindow(c, afterThisOne = false)
        }
        runCatching {
            jobs.schedule(
                JobInfo.Builder(JOB_ID, ComponentName(c, TonightJob::class.java))
                    .setRequiresCharging(true)
                    // Not while the phone is in use. (An idle job can't have a retry policy: it is rescheduled by hand.)
                    .setRequiresDeviceIdle(true)
                    .setMinimumLatency(wait)
                    .setPersisted(true)
                    .build()
            )
        }.onFailure { AppLog.e("Tonight", "Couldn't schedule Tonight's list", it) }
    }

    /** Schedules the job once (at app start) unless it is already waiting. */
    fun ensureScheduled(c: Context) {
        if (ids(c).isEmpty()) return
        val jobs = c.getSystemService(JobScheduler::class.java) ?: return
        if (jobs.getPendingJob(JOB_ID) == null) schedule(c)
    }

    /**
     * Whether making audio now is kind to the battery: 60% or more (so fast charging isn't slowed) and the
     * battery cool (warmth is what makes a phone charge slowly to protect it).
     */
    fun goodTime(c: Context): Boolean {
        val b = c.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return false
        val level = b.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = b.getIntExtra(BatteryManager.EXTRA_SCALE, 100).coerceAtLeast(1)
        val tenthsC = b.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0)
        val warm = Build.VERSION.SDK_INT >= 29 &&
            (c.getSystemService(PowerManager::class.java)?.currentThermalStatus ?: 0) >= PowerManager.THERMAL_STATUS_MODERATE
        return level * 100 / scale >= 60 && tenthsC < 370 && !warm
    }
}

/** Makes the audio ahead for Tonight's list (see [Tonight]). */
class TonightJob : JobService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var job: Job? = null
    @Volatile private var stopped = false

    private enum class Next { DONE, RETRY, NEXT_WINDOW }

    override fun onStartJob(params: JobParameters): Boolean {
        job = scope.launch {
            val next = try {
                work()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                AppLog.e("Tonight", "Preparing stopped", e)
                Next.RETRY
            }
            if (stopped) return@launch
            jobFinished(params, false)
            when (next) {
                Next.RETRY -> Tonight.schedule(applicationContext, retryMs = 20 * 60_000L)
                // Done for tonight, or outside the hours: the next night.
                else -> Tonight.schedule(applicationContext, nextNight = Tonight.inWindow(applicationContext))
            }
        }
        return true
    }

    /** Android stopped it (unplugged, phone in use, or its time slot is up): carry on in a while. */
    override fun onStopJob(params: JobParameters): Boolean {
        stopped = true
        job?.cancel()
        Tonight.schedule(applicationContext, retryMs = 5 * 60_000L)
        return false
    }

    private suspend fun work(): Next {
        val app = applicationContext
        if (!Tonight.inWindow(app)) return Next.NEXT_WINDOW
        if (!Tonight.goodTime(app)) return Next.RETRY
        withContext(Dispatchers.Main) { Speaker.init(app) {} }
        val voice = Speaker.voiceId
        // Only the on-device voices make their speech on the phone; nothing to do for the phone's own voice.
        if (!LocalTts.isLocal(voice) || LocalTts.missing(voice) != null) return Next.NEXT_WINDOW
        val speed = Speaker.renderSpeed
        val words = (Tonight.hoursPerBook(app) * Tonight.WORDS_PER_HOUR * Speaker.speed).toInt()
        val prefs = app.getSharedPreferences("p2a", Context.MODE_PRIVATE)
        for (id in Tonight.ids(app)) {
            val item = Library.get(app, id)
            if (item == null) {
                Tonight.remove(app, id, reschedule = false)
                continue
            }
            // Finished books leave the list.
            if (item.paragraphs > 0 && prefs.getInt("pos:$id", 0) >= item.paragraphs - 1) {
                Tonight.remove(app, id, reschedule = false)
                continue
            }
            val d = Speaker.doc?.takeIf { it.key == id } ?: runCatching { Opener.parse(app, item) }.getOrNull() ?: continue
            if (d.lang == null) Langs.of(d)
            val plan = Speaker.planAhead(d, words)
            var made = 0
            for ((text, v) in plan) {
                if (stopped) return Next.RETRY
                if (text.none { it.isLetterOrDigit() } || Renderer.isCached(app, v, speed, text)) continue
                if (!Tonight.inWindow(app)) return Next.NEXT_WINDOW
                // Listening, or the voice changed: leave the engine to the player.
                if (Speaker.playing || Speaker.voiceId != voice) return Next.RETRY
                if (made % 20 == 0 && !Tonight.goodTime(app)) return Next.RETRY
                Renderer.render(app, v, speed, text)
                made++
            }
            Tonight.setReady(app, id, readyMinutes(app, plan, speed))
            AppLog.i("Tonight", "Ready ahead: “${d.title.take(40)}” ($made pieces made)")
        }
        return Next.DONE
    }

    /** Minutes of listening ready from where the book was left off (until the first piece not made). */
    private fun readyMinutes(c: Context, plan: List<Pair<String, Voicing>>, speed: Float): Int {
        var words = 0
        for ((text, v) in plan) {
            if (text.any { it.isLetterOrDigit() } && !Renderer.isCached(c, v, speed, text)) break
            words += text.count { it == ' ' } + 1
        }
        return (words * 60L / (Tonight.WORDS_PER_HOUR * Speaker.speed.coerceAtLeast(0.5f))).toInt()
    }
}
