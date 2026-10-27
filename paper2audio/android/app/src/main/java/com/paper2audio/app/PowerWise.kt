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
 *  - while the phone charges (and isn't reading), the next hour or so of the book is made ahead and
 *    kept ([PrepareJob]); listening later on battery then only plays it back;
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

    /** Asks Android to run [PrepareJob] the next time the phone is charging (on-device voices only). */
    fun schedule(context: Context) {
        if (!LocalTts.isLocal(Speaker.voiceId)) return // online and phone voices make their speech cheaply
        runCatching {
            val jobs = context.getSystemService(JobScheduler::class.java) ?: return
            jobs.schedule(
                JobInfo.Builder(JOB_ID, ComponentName(context, PrepareJob::class.java))
                    .setRequiresCharging(true)
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

    /** Returns whether there's more to do later. */
    private suspend fun prepare(): Boolean {
        val app = applicationContext
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
        if (doc.lang == null) Langs.of(doc)
        val speed = Speaker.renderSpeed
        val voice = Speaker.voiceId
        val plan = Speaker.planAhead(doc, PowerWise.AHEAD_WORDS)
        val todo = plan.filter { (text, v) -> text.any { it.isLetterOrDigit() } && !Renderer.isCached(app, v, speed, text) }
        if (todo.isEmpty()) return false
        AppLog.i("Power", "Charging: making ${todo.size} of ${plan.size} pieces ahead")
        for ((text, v) in todo) {
            // Reading now, the phone warm, or the voice or book changed: stop (and try again later).
            if (Speaker.playing || PowerWise.warm(app)) return true
            if (Speaker.doc !== doc || Speaker.voiceId != voice || Speaker.renderSpeed != speed) return true
            runCatching { Renderer.render(app, v, speed, text) }
                .onFailure { if (it is CancellationException) throw it }
        }
        AppLog.i("Power", "Charging: the next hour is ready")
        return false
    }
}
