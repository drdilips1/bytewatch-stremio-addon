package com.paper2audio.app

import android.content.Context
import android.os.Handler
import android.os.Looper
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.TimeUnit

/**
 * Syncs the library (files, thumbnails, positions, deletions) through the
 * hidden "app data" folder of the user's Google Drive.
 */
object DriveSync {
    private const val INDEX = "library.json"

    var running = false
        private set
    var status: String? = null
        private set
    var needsSignIn = false
        private set

    private val main = Handler(Looper.getMainLooper())
    private val listeners = CopyOnWriteArraySet<() -> Unit>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    @Volatile
    private var again = false

    private fun prefs(context: Context) = context.getSharedPreferences("p2a", Context.MODE_PRIVATE)

    fun enabled(context: Context) = prefs(context).getBoolean("syncOn", false)

    fun email(context: Context): String? = prefs(context).getString("syncEmail", null)

    fun lastSync(context: Context): Long = prefs(context).getLong("syncAt", 0)

    fun addListener(l: () -> Unit) {
        listeners += l
    }

    fun removeListener(l: () -> Unit) {
        listeners -= l
    }

    private fun update(block: () -> Unit) = main.post {
        block()
        listeners.forEach { it() }
    }

    /** Called after a successful interactive sign-in. */
    fun enable(context: Context, token: String) {
        prefs(context).edit().putBoolean("syncOn", true).apply()
        needsSignIn = false
        scope.launch {
            runCatching { Drive(token).email() }.getOrNull()?.let {
                prefs(context).edit().putString("syncEmail", it).apply()
            }
            request(context)
        }
    }

    fun disable(context: Context) {
        prefs(context).edit().putBoolean("syncOn", false).remove("syncEmail").apply()
        update { status = null }
    }

    /** Starts a sync in the background (coalesced if one is already running). */
    fun request(context: Context) {
        val app = context.applicationContext
        if (!enabled(app)) return
        synchronized(this) {
            if (running) {
                again = true
                return
            }
            running = true
        }
        update { status = "Syncing…" }
        scope.launch {
            try {
                do {
                    again = false
                    syncOnce(app)
                } while (again)
            } catch (e: Exception) {
                update { status = "Sync failed: ${e.message ?: e.javaClass.simpleName}" }
            } finally {
                synchronized(this@DriveSync) { running = false }
                update {}
            }
        }
    }

    private suspend fun syncOnce(context: Context) {
        val token = GoogleAuth.silentToken(context)
        if (token == null) {
            update {
                needsSignIn = true
                status = "Sign in again to keep syncing"
            }
            return
        }
        needsSignIn = false
        val drive = Drive(token)
        var remote = drive.list()
        val remoteIndex = remote[INDEX]?.let { runCatching { JSONObject(drive.downloadText(it.id)) }.getOrNull() }

        val merged = Library.merge(context, remoteIndex)

        for (id in merged.deleted) {
            remote.filterKeys { it.startsWith("$id.") }.values.forEach { drive.delete(it.id) }
        }
        remote = remote.filterKeys { name -> merged.deleted.none { name.startsWith("$it.") } }

        val dir = Library.dir(context).apply { mkdirs() }
        var moved = 0
        for (item in merged.items) {
            val names = listOf(Library.fileName(item), "${item.id}.jpg")
            for (name in names) {
                val local = File(dir, name)
                val there = remote[name]
                if (local.exists() && there == null) {
                    update { status = "Uploading ${item.title}…" }
                    drive.upload(name, local)
                    moved++
                } else if (!local.exists() && there != null) {
                    update { status = "Downloading ${item.title}…" }
                    drive.download(there.id, local)
                    moved++
                }
            }
        }
        drive.uploadText(INDEX, merged.json.toString(), remote[INDEX]?.id)
        prefs(context).edit().putLong("syncAt", System.currentTimeMillis()).apply()
        update {
            status = if (moved > 0) "Synced ($moved file${if (moved == 1) "" else "s"} transferred)" else "Synced"
        }
    }

    /** Minimal Google Drive v3 REST client for the appDataFolder. */
    private class Drive(private val token: String) {
        class RemoteFile(val id: String, val name: String)

        private val client = OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(120, TimeUnit.SECONDS)
            .writeTimeout(120, TimeUnit.SECONDS)
            .build()

        private fun authed(url: String) = Request.Builder().url(url).header("Authorization", "Bearer $token")

        private fun call(request: Request): String = client.newCall(request).execute().use { r ->
            val body = r.body?.string().orEmpty()
            if (!r.isSuccessful) throw IOException("Drive error ${r.code}: ${body.take(200)}")
            body
        }

        fun email(): String? {
            val json = JSONObject(call(authed("$API/about?fields=user(emailAddress)").build()))
            return json.optJSONObject("user")?.optString("emailAddress")?.ifBlank { null }
        }

        fun list(): Map<String, RemoteFile> {
            val out = LinkedHashMap<String, RemoteFile>()
            var page: String? = null
            do {
                val url = "$API/files?spaces=appDataFolder&pageSize=1000&fields=nextPageToken,files(id,name)" +
                    (page?.let { "&pageToken=$it" } ?: "")
                val json = JSONObject(call(authed(url).build()))
                val files = json.optJSONArray("files")
                for (i in 0 until (files?.length() ?: 0)) {
                    val f = files!!.getJSONObject(i)
                    out.putIfAbsent(f.getString("name"), RemoteFile(f.getString("id"), f.getString("name")))
                }
                page = json.optString("nextPageToken").ifBlank { null }
            } while (page != null)
            return out
        }

        fun downloadText(id: String): String = call(authed("$API/files/$id?alt=media").build())

        fun download(id: String, target: File) {
            val tmp = File(target.path + ".part")
            client.newCall(authed("$API/files/$id?alt=media").build()).execute().use { r ->
                if (!r.isSuccessful) throw IOException("Drive download error ${r.code}")
                tmp.outputStream().use { out -> r.body!!.byteStream().use { it.copyTo(out) } }
            }
            if (!tmp.renameTo(target)) throw IOException("Couldn't save ${target.name}")
        }

        /** Resumable upload: works for any file size. */
        fun upload(name: String, file: File) {
            val meta = JSONObject().put("name", name).put("parents", org.json.JSONArray().put("appDataFolder"))
            val start = authed("$UPLOAD/files?uploadType=resumable")
                .header("X-Upload-Content-Type", mime(name))
                .post(meta.toString().toRequestBody("application/json; charset=UTF-8".toMediaType()))
                .build()
            val location = client.newCall(start).execute().use { r ->
                if (!r.isSuccessful) throw IOException("Drive upload error ${r.code}")
                r.header("Location") ?: throw IOException("Drive upload: no upload URL")
            }
            call(Request.Builder().url(location).put(file.asRequestBody(mime(name).toMediaType())).build())
        }

        fun uploadText(name: String, text: String, existingId: String?) {
            val body = text.toRequestBody("application/json; charset=UTF-8".toMediaType())
            if (existingId != null) {
                call(authed("$UPLOAD/files/$existingId?uploadType=media").patch(body).build())
            } else {
                val tmp = File.createTempFile("index", ".json").apply { writeText(text) }
                try {
                    upload(name, tmp)
                } finally {
                    tmp.delete()
                }
            }
        }

        fun delete(id: String) {
            client.newCall(authed("$API/files/$id").delete().build()).execute().close()
        }

        private fun mime(name: String) = when (name.substringAfterLast('.').lowercase()) {
            "pdf" -> "application/pdf"
            "epub" -> "application/epub+zip"
            "jpg" -> "image/jpeg"
            "json" -> "application/json"
            else -> "text/plain"
        }

        companion object {
            const val API = "https://www.googleapis.com/drive/v3"
            const val UPLOAD = "https://www.googleapis.com/upload/drive/v3"
        }
    }
}
