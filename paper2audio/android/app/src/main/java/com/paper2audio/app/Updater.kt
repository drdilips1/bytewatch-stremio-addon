package com.paper2audio.app

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.widget.Toast
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit
import kotlin.coroutines.coroutineContext

/**
 * Updates from inside the app: each build publishes version.json next to the APK;
 * when it is newer than this app, the new APK is downloaded and Android's installer
 * opens (updates install over the current app, keeping everything).
 */
object Updater {
    private const val BASE = "https://github.com/drdilips1/bytewatch-stremio-addon/releases/download/paper2audio-apk"
    private val client = OkHttpClient.Builder().connectTimeout(20, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).build()

    class Release(val code: Long, val name: String)

    fun currentCode(context: Context): Long {
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        return if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()
    }

    fun currentName(context: Context): String =
        context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "?"

    /** The latest published build, or null if it can't be checked. Call off the main thread. */
    fun latest(): Release? = runCatching {
        client.newCall(Request.Builder().url("$BASE/version.json?t=${System.currentTimeMillis() / 60_000}").build()).execute().use { r ->
            if (!r.isSuccessful) return null
            val o = JSONObject(r.body!!.string())
            Release(o.getLong("versionCode"), o.optString("versionName"))
        }
    }.getOrNull()

    /** At most once a day, quietly checks and offers a newer version. */
    fun checkDaily(activity: Activity, scope: CoroutineScope) {
        val prefs = activity.getSharedPreferences("p2a", Context.MODE_PRIVATE)
        if (System.currentTimeMillis() - prefs.getLong("updateCheckedAt", 0) < 20 * 3_600_000L) return
        prefs.edit().putLong("updateCheckedAt", System.currentTimeMillis()).apply()
        scope.launch {
            val r = withContext(Dispatchers.IO) { latest() } ?: return@launch
            if (r.code > currentCode(activity) && prefs.getLong("updateSkipped", 0) != r.code) offer(activity, scope, r, quiet = true)
        }
    }

    /** "Check for updates" from the menu. */
    fun checkNow(activity: Activity, scope: CoroutineScope) {
        Toast.makeText(activity, "Checking for updates…", Toast.LENGTH_SHORT).show()
        scope.launch {
            val r = withContext(Dispatchers.IO) { latest() }
            when {
                r == null -> Toast.makeText(activity, "Couldn't check right now. Try again later.", Toast.LENGTH_LONG).show()
                r.code > currentCode(activity) -> offer(activity, scope, r, quiet = false)
                else -> Toast.makeText(activity, "You have the latest version (${currentName(activity)})", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun offer(activity: Activity, scope: CoroutineScope, r: Release, quiet: Boolean) {
        if (activity.isFinishing) return
        val b = AlertDialog.Builder(activity)
            .setTitle("Update available")
            .setMessage("Version ${r.name} is ready (you have ${currentName(activity)}). It installs over this one; your library, positions and voices stay.")
            .setPositiveButton("Update") { _, _ -> download(activity, scope) }
            .setNegativeButton("Later", null)
        if (quiet) b.setNeutralButton("Skip this version") { _, _ ->
            activity.getSharedPreferences("p2a", Context.MODE_PRIVATE).edit().putLong("updateSkipped", r.code).apply()
        }
        b.show()
    }

    private fun download(activity: Activity, scope: CoroutineScope) {
        val app = activity.applicationContext
        val bar = android.widget.ProgressBar(activity, null, 0, R.style.P2A_Progress).apply { max = 100 }
        val d = activity.resources.displayMetrics.density
        val box = android.widget.FrameLayout(activity).apply {
            setPadding((22 * d).toInt(), (12 * d).toInt(), (22 * d).toInt(), 0)
            addView(bar)
        }
        var job: kotlinx.coroutines.Job? = null
        val dialog = AlertDialog.Builder(activity)
            .setTitle("Downloading the update…")
            .setView(box)
            .setNegativeButton("Cancel") { _, _ -> job?.cancel() }
            .setCancelable(false)
            .show()
        job = scope.launch {
            try {
                val apk = withContext(Dispatchers.IO) {
                    fetch(app) { pct -> activity.runOnUiThread { bar.progress = pct } }
                }
                dialog.dismiss()
                install(activity, apk)
            } catch (e: kotlinx.coroutines.CancellationException) {
                dialog.dismiss()
            } catch (e: Exception) {
                AppLog.e("Update", "Download failed", e)
                dialog.dismiss()
                AlertDialog.Builder(activity)
                    .setTitle("Update didn't download")
                    .setMessage("${e.message ?: "Network error"}. You can also download it from the release page.")
                    .setPositiveButton("Open the page") { _, _ ->
                        runCatching { activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("$BASE/Paper2Audio.apk"))) }
                    }
                    .setNegativeButton("Close", null)
                    .show()
            }
        }
    }

    /** Downloads the APK (resuming a partial download) into the app's cache. */
    private suspend fun fetch(context: Context, progress: (Int) -> Unit): File {
        val dir = File(context.cacheDir, "update").apply { mkdirs() }
        val part = File(dir, "Paper2Audio.apk.part")
        val done = File(dir, "Paper2Audio.apk")
        done.delete()
        val have = if (part.exists()) part.length() else 0L
        val req = Request.Builder().url("$BASE/Paper2Audio.apk").apply { if (have > 0) header("Range", "bytes=$have-") }.build()
        client.newCall(req).execute().use { r ->
            if (!r.isSuccessful) error("HTTP ${r.code}")
            val resumed = r.code == 206
            val total = (r.body!!.contentLength().takeIf { it > 0 } ?: 0L) + if (resumed) have else 0L
            java.io.FileOutputStream(part, resumed).use { out ->
                r.body!!.byteStream().use { input ->
                    val buf = ByteArray(128 * 1024)
                    var sofar = if (resumed) have else 0L
                    while (true) {
                        coroutineContext.ensureActive()
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        sofar += n
                        if (total > 0) progress((sofar * 100 / total).toInt())
                    }
                    if (total > 0 && sofar < total) error("The download was interrupted")
                }
            }
        }
        if (!part.renameTo(done)) error("Couldn't save the update")
        return done
    }

    /** Opens Android's installer (after allowing this app to install updates, if needed). */
    private fun install(activity: Activity, apk: File) {
        if (Build.VERSION.SDK_INT >= 26 && !activity.packageManager.canRequestPackageInstalls()) {
            AlertDialog.Builder(activity)
                .setTitle("Allow updates from this app")
                .setMessage("Android asks once: turn on “Allow from this source” for Paper to Audio, then come back and tap Update again.")
                .setPositiveButton("Open setting") { _, _ ->
                    activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
                }
                .setNegativeButton("Cancel", null)
                .show()
            return
        }
        val uri = androidx.core.content.FileProvider.getUriForFile(activity, "${activity.packageName}.files", apk)
        activity.startActivity(
            Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }
}
