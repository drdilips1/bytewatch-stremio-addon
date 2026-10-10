package com.paper2audio.app

import android.content.Context
import android.os.Handler
import android.os.Looper
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream
import java.io.File
import java.io.FilterInputStream
import java.io.IOException
import java.io.InputStream
import java.io.RandomAccessFile
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.TimeUnit
import kotlin.coroutines.coroutineContext

/**
 * A voice model from the sherpa-onnx model releases, downloaded once (resumable)
 * and unpacked into app storage. Progress is reported to [addListener] listeners.
 */
class ModelPack(
    val id: String,
    val title: String,
    /** Archive and folder name in the sherpa-onnx "tts-models" release. */
    private val folder: String,
    val sizeMb: Int,
    private val required: List<String>,
    /** Archive entries (relative paths) that aren't needed and are skipped. */
    private val skip: (String) -> Boolean = { false },
) {
    var installing = false
        private set
    var progress = 0
        private set
    var message: String? = null
        private set

    private var job: Job? = null
    private val url = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/$folder.tar.bz2"
    /** The same voices repacked as a zip in parts (see p2a-voice-packs.yml): quick to unpack, resumable per part. */
    private val mirror = "https://github.com/drdilips1/bytewatch-stremio-addon/releases/download/p2a-voices"

    val dir: File get() = File(app.filesDir, folder)
    private val marker: File get() = File(dir, ".installed")
    private val archive: File get() = File(app.filesDir, "$folder.tar.bz2.part")
    private val zipArchive: File get() = File(app.filesDir, "$folder.zip.part")

    /** Megabytes already downloaded by an interrupted or cancelled download (it resumes from there). */
    fun partialMb(): Int = (maxOf(if (zipArchive.exists()) zipArchive.length() else 0L, if (archive.exists()) archive.length() else 0L) / 1_000_000).toInt()

    fun isInstalled(): Boolean = initialized && marker.exists()

    fun file(name: String) = File(dir, name)

    fun install(onDone: () -> Unit = {}) {
        if (installing || isInstalled()) return
        installing = true
        progress = 0
        message = "Starting download…"
        notifyListeners()
        ReaderService.start(app)
        job = scope.launch {
            try {
                val parts = runCatching { mirrorParts() }.getOrNull()
                if (parts != null) {
                    downloadParts(parts)
                    try {
                        unzip()
                    } catch (e: IOException) {
                        zipArchive.delete() // probably corrupt; start the download over next time
                        throw e
                    }
                } else {
                    download()
                    try {
                        unpack()
                    } catch (e: IOException) {
                        archive.delete()
                        throw e
                    }
                }
                update {
                    message = "$title ready"
                    onDone()
                }
            } catch (e: CancellationException) {
                update { message = "Download cancelled" }
            } catch (e: Exception) {
                AppLog.e("Pack", "$title download failed", e)
                update { message = "Download failed: ${e.message ?: e.javaClass.simpleName}. Tap Download to retry." }
            } finally {
                update { installing = false }
            }
        }
    }

    fun cancelInstall() {
        job?.cancel()
    }

    /** Deletes the model to free its storage. */
    fun uninstall(onDone: () -> Unit) {
        if (installing) return
        scope.launch {
            LocalTts.release()
            dir.deleteRecursively()
            archive.delete()
            zipArchive.delete()
            update {
                message = null
                onDone()
            }
        }
    }

    private class Part(val name: String, val size: Long)

    /** The parts of the repacked zip, or null if this pack isn't mirrored (then the original archive is used). */
    private fun mirrorParts(): List<Part>? {
        val req = Request.Builder().url("$mirror/$folder.json").build()
        client.newCall(req).execute().use { r ->
            if (!r.isSuccessful) return null
            val arr = org.json.JSONObject(r.body!!.string()).getJSONArray("parts")
            return (0 until arr.length()).map { arr.getJSONObject(it) }.map { Part(it.getString("name"), it.getLong("size")) }
                .takeIf { it.isNotEmpty() }
        }
    }

    /**
     * Downloads the parts one after another into one file, resuming where an earlier
     * attempt stopped. Shows the part, percent, megabytes and speed.
     */
    private suspend fun downloadParts(parts: List<Part>) {
        val total = parts.sumOf { it.size }
        val mb = { b: Long -> b / 1_000_000 }
        var have = if (zipArchive.exists()) zipArchive.length() else 0L
        if (have > total) {
            zipArchive.delete()
            have = 0
        }
        val started = System.currentTimeMillis()
        val haveAtStart = have
        var lastShown = 0L
        RandomAccessFile(zipArchive, "rw").use { out ->
            var partStart = 0L
            for ((i, part) in parts.withIndex()) {
                val partEnd = partStart + part.size
                if (have >= partEnd) {
                    partStart = partEnd
                    continue
                }
                val offset = have - partStart
                val req = Request.Builder().url("$mirror/${part.name}").apply {
                    if (offset > 0) header("Range", "bytes=$offset-")
                }.build()
                client.newCall(req).execute().use { r ->
                    if (!r.isSuccessful) throw IOException("HTTP ${r.code}")
                    // A server that ignores the range sends the whole part again.
                    if (offset > 0 && r.code != 206) have = partStart
                    out.seek(have)
                    val buf = ByteArray(256 * 1024)
                    r.body!!.byteStream().use { input ->
                        while (true) {
                            coroutineContext.ensureActive()
                            val n = input.read(buf)
                            if (n < 0) break
                            out.write(buf, 0, n)
                            have += n
                            val now = System.currentTimeMillis()
                            if (now - lastShown > 300) {
                                lastShown = now
                                val secs = (now - started) / 1000.0
                                val speed = if (secs > 1) (have - haveAtStart) / secs / 1_000_000 else 0.0
                                val pct = (have * 100 / total).toInt()
                                val left = if (speed > 0.05) ((total - have) / 1_000_000 / speed / 60).toInt() else -1
                                val partNote = if (parts.size > 1) "Part ${i + 1} of ${parts.size} · " else ""
                                val tail = buildString {
                                    if (speed > 0) append(" · %.1f MB/s".format(speed))
                                    if (left >= 1) append(" · about $left min left") else if (left == 0) append(" · under a minute left")
                                }
                                update {
                                    progress = (have * 92 / total).toInt()
                                    message = "Downloading $title: $partNote$pct% · ${mb(have)} of ${mb(total)} MB$tail"
                                }
                            }
                        }
                    }
                }
                if (have < partEnd) throw IOException("download interrupted (it resumes from ${mb(have)} MB)")
                partStart = partEnd
            }
        }
    }

    /** Unpacks the zip (native and fast, unlike bzip2). Entries are relative to the pack folder. */
    private suspend fun unzip() {
        dir.deleteRecursively()
        dir.mkdirs()
        java.util.zip.ZipFile(zipArchive).use { zip ->
            val entries = zip.entries().toList()
            for ((i, entry) in entries.withIndex()) {
                coroutineContext.ensureActive()
                val rel = entry.name.removePrefix("./")
                if (rel.isEmpty() || rel.split('/').any { it == ".." } || skip(rel)) continue
                val target = File(dir, rel)
                if (entry.isDirectory) {
                    target.mkdirs()
                    continue
                }
                target.parentFile?.mkdirs()
                zip.getInputStream(entry).use { input -> target.outputStream().buffered(1 shl 20).use { input.copyTo(it, 1 shl 20) } }
                if (i % 20 == 0) {
                    val pct = 92 + i * 8 / entries.size.coerceAtLeast(1)
                    update {
                        progress = pct
                        message = "Unpacking $title… ${i * 100 / entries.size.coerceAtLeast(1)}%"
                    }
                }
            }
        }
        for (name in required) {
            if (!File(dir, name).exists()) throw IOException("the download was incomplete ($name missing)")
        }
        marker.createNewFile()
        zipArchive.delete()
        archive.delete()
    }

    private suspend fun download() {
        val have = if (archive.exists()) archive.length() else 0L
        val request = Request.Builder().url(url).apply {
            if (have > 0) header("Range", "bytes=$have-")
        }.build()
        client.newCall(request).execute().use { r ->
            if (r.code == 416 && have > 0) return // already fully downloaded
            if (!r.isSuccessful) throw IOException("HTTP ${r.code}")
            val resumed = r.code == 206
            val start = if (resumed) have else 0L
            val total = (r.body?.contentLength() ?: -1L).let { if (it > 0) it + start else -1L }
            RandomAccessFile(archive, "rw").use { out ->
                if (!resumed) out.setLength(0)
                out.seek(start)
                val buf = ByteArray(256 * 1024)
                var done = start
                var lastPct = -1
                r.body!!.byteStream().use { input ->
                    while (true) {
                        coroutineContext.ensureActive()
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        done += n
                        val pct = if (total > 0) (done * 85 / total).toInt() else 0
                        if (pct != lastPct) {
                            lastPct = pct
                            val of = if (total > 0) " of ${total / 1_000_000} MB" else " MB"
                            update {
                                progress = pct
                                message = "Downloading $title… " + (if (total > 0) "${done * 100 / total}% · " else "") + "${done / 1_000_000}$of"
                            }
                        }
                    }
                }
                if (total > 0 && done < total) throw IOException("download interrupted")
            }
        }
    }

    private suspend fun unpack() {
        dir.deleteRecursively()
        dir.mkdirs()
        val size = archive.length().coerceAtLeast(1)
        val counting = CountingStream(archive.inputStream().buffered(1 shl 20))
        TarArchiveInputStream(BZip2CompressorInputStream(counting)).use { tar ->
            var lastPct = -1
            while (true) {
                coroutineContext.ensureActive()
                val entry = tar.nextEntry ?: break
                // Entries look like "<folder>/model.onnx".
                val rel = entry.name.removePrefix("./").substringAfter('/', "")
                if (rel.isEmpty() || rel.split('/').any { it == ".." } || skip(rel)) continue
                val target = File(dir, rel)
                if (entry.isDirectory) {
                    target.mkdirs()
                    continue
                }
                target.parentFile?.mkdirs()
                target.outputStream().buffered(1 shl 20).use { tar.copyTo(it, 1 shl 20) }
                val pct = 85 + (counting.count * 15 / size).toInt()
                if (pct != lastPct) {
                    lastPct = pct
                    update {
                        progress = pct
                        message = "Unpacking $title…"
                    }
                }
            }
        }
        for (name in required) {
            if (!File(dir, name).exists()) throw IOException("the download was incomplete ($name missing)")
        }
        marker.createNewFile()
        archive.delete()
    }

    private class CountingStream(input: InputStream) : FilterInputStream(input) {
        var count = 0L

        override fun read(): Int = super.read().also { if (it >= 0) count++ }

        override fun read(b: ByteArray, off: Int, len: Int): Int =
            super.read(b, off, len).also { if (it > 0) count += it }
    }

    companion object {
        private lateinit var app: Context
        private val main = Handler(Looper.getMainLooper())
        private val listeners = CopyOnWriteArraySet<() -> Unit>()
        private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        private val client = OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .build()

        private val initialized get() = ::app.isInitialized

        fun init(context: Context) {
            app = context.applicationContext
        }

        fun addListener(l: () -> Unit) {
            listeners += l
        }

        fun removeListener(l: () -> Unit) {
            listeners -= l
        }

        private fun notifyListeners() = listeners.forEach { it() }

        private fun update(block: () -> Unit) = main.post {
            block()
            notifyListeners()
        }

        /** The pack being downloaded right now, if any (for the notification). */
        val active: ModelPack? get() = LocalTts.PACKS.firstOrNull { it.installing }
    }
}
