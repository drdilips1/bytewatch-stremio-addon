package com.paper2audio.app

import android.app.Activity
import android.app.ActivityManager
import android.app.AlertDialog
import android.app.Application
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.StatFs
import android.text.InputType
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.Toast
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Starts the error log before anything else runs. */
class P2AApp : Application() {
    override fun onCreate() {
        super.onCreate()
        AppLog.init(this)
    }
}

/**
 * A small log of what the app did and what went wrong (no document text, no keys),
 * plus the last crash, so a problem report can be shared in one tap.
 */
object AppLog {
    private const val MAX_BYTES = 256 * 1024
    private var dir: File? = null
    private val time = SimpleDateFormat("MM-dd HH:mm:ss", Locale.US)

    fun init(context: Context) {
        dir = File(context.filesDir, "logs").apply { mkdirs() }
        i("App", "Started ${versionOf(context)} on Android ${Build.VERSION.RELEASE} (${Build.MANUFACTURER} ${Build.MODEL})")
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, e ->
            runCatching {
                File(dir, "crash.txt").writeText("${stamp()} crash in thread ${thread.name}, version ${versionOf(context)}\n${stack(e, 80)}")
                write("E", "Crash", "${e.javaClass.simpleName}: ${e.message}", e)
            }
            previous?.uncaughtException(thread, e)
        }
    }

    fun i(tag: String, message: String) = write("I", tag, message, null)

    fun e(tag: String, message: String?, error: Throwable? = null) =
        write("E", tag, message ?: error?.let { "${it.javaClass.simpleName}: ${it.message}" } ?: "error", error)

    @Synchronized
    private fun write(level: String, tag: String, message: String, error: Throwable?) {
        val d = dir ?: return
        runCatching {
            val log = File(d, "log.txt")
            if (log.length() > MAX_BYTES) log.renameTo(File(d, "log.old.txt"))
            log.appendText(buildString {
                append(stamp()).append(' ').append(level).append('/').append(tag).append(": ").append(message.take(600)).append('\n')
                if (error != null) append(stack(error, 14).prependIndent("    ")).append('\n')
            })
        }
    }

    private fun stamp() = synchronized(time) { time.format(Date()) }

    private fun stack(e: Throwable, lines: Int): String {
        val sw = StringWriter()
        e.printStackTrace(PrintWriter(sw))
        return sw.toString().lineSequence().take(lines).joinToString("\n")
    }

    private fun versionOf(context: Context) = runCatching { "${Updater.currentName(context)} (${Updater.currentCode(context)})" }.getOrDefault("?")

    /** The crash from the last run that hasn't been offered for reporting yet. */
    fun unseenCrash(): String? {
        val f = File(dir ?: return null, "crash.txt")
        val seen = File(dir, "crash.seen")
        if (!f.exists() || (seen.exists() && seen.lastModified() >= f.lastModified())) return null
        return f.readText()
    }

    fun markCrashSeen() {
        runCatching { File(dir ?: return, "crash.seen").writeText("") }
    }

    private fun tail(lines: Int): String {
        val d = dir ?: return ""
        val all = listOf(File(d, "log.old.txt"), File(d, "log.txt")).filter { it.exists() }.flatMap { it.readLines() }
        return all.takeLast(lines).joinToString("\n")
    }

    /** The report: app, phone, settings, the open document (its title only) and the recent log. */
    fun report(context: Context, note: String): String {
        val prefs = context.getSharedPreferences("p2a", Context.MODE_PRIVATE)
        val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val mem = ActivityManager.MemoryInfo().also { am.getMemoryInfo(it) }
        val free = runCatching { StatFs(context.filesDir.path).availableBytes / 1_000_000 }.getOrDefault(-1)
        val doc = Speaker.doc
        val crash = File(dir ?: File("."), "crash.txt").takeIf { it.exists() }?.readText()
        return buildString {
            append("Paper to Audio problem report\n")
            if (note.isNotBlank()) append("\nWhat happened:\n").append(note.trim()).append('\n')
            append("\nApp: ${versionOf(context)}\n")
            append("Phone: ${Build.MANUFACTURER} ${Build.MODEL}, Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT}), ${Build.SUPPORTED_ABIS.firstOrNull()}\n")
            append("Memory: ${mem.availMem / 1_000_000} MB free of ${mem.totalMem / 1_000_000} MB${if (mem.lowMemory) " (low)" else ""}; storage free: $free MB\n")
            append("Voice: ${Speaker.voiceId}; speed ${Speaker.speed}x; style ${Speaker.style.label}; playing ${Speaker.playing}\n")
            append(if (BuildConfig.LITE) "Edition: Play Store" else "AI: ${Llm.name(context)}").append("; theme ${prefs.getString("theme", "default")}\n")
            if (doc != null) {
                val item = Library.get(context, Library.currentId)
                append("Document: \"${doc.title}\" (${item?.kind ?: "?"}), ${doc.paragraphs.size} paragraphs, ${doc.chapters.size} chapters, ")
                append("at paragraph ${Speaker.index}, language ${doc.lang ?: "?"}\n")
            }
            Speaker.lastError?.let { append("Last error shown: $it\n") }
            if (crash != null) append("\nLast crash:\n").append(crash).append('\n')
            append("\nRecent log:\n").append(tail(250)).append('\n')
        }
    }

    /** "Report a problem": a short description, then share (email, WhatsApp, Drive…) or copy. */
    fun showReport(activity: Activity, title: String = "Report a problem") {
        val d = activity.resources.displayMetrics.density
        val input = EditText(activity).apply {
            hint = "What went wrong? (optional)"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            minLines = 2
        }
        val box = FrameLayout(activity).apply {
            setPadding((22 * d).toInt(), (8 * d).toInt(), (22 * d).toInt(), 0)
            addView(input)
        }
        AlertDialog.Builder(activity)
            .setTitle(title)
            .setMessage("Makes a report with the app version, phone, settings and the recent error log, to send to whoever is fixing the app. It has no document text and no keys.")
            .setView(box)
            .setPositiveButton("Share") { _, _ -> share(activity, report(activity, input.text.toString())) }
            .setNeutralButton("Copy") { _, _ ->
                val cm = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                cm.setPrimaryClip(ClipData.newPlainText("Paper to Audio report", report(activity, input.text.toString())))
                Toast.makeText(activity, "Report copied. Paste it in the chat.", Toast.LENGTH_LONG).show()
            }
            .setNegativeButton("Cancel", null)
            .show()
        markCrashSeen()
    }

    private fun share(activity: Activity, text: String) {
        val f = File(File(activity.cacheDir, "report").apply { mkdirs() }, "Paper2Audio-report.txt")
        f.writeText(text)
        val uri = androidx.core.content.FileProvider.getUriForFile(activity, "${activity.packageName}.files", f)
        val send = Intent(Intent.ACTION_SEND)
            .setType("text/plain")
            .putExtra(Intent.EXTRA_SUBJECT, "Paper to Audio problem report")
            // Chat apps take the text; email and Drive also get the file.
            .putExtra(Intent.EXTRA_TEXT, if (text.length > 60_000) text.take(60_000) + "\n…" else text)
            .putExtra(Intent.EXTRA_STREAM, uri)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        runCatching { activity.startActivity(Intent.createChooser(send, "Send the report")) }
            .onFailure { Toast.makeText(activity, "No app to share with", Toast.LENGTH_LONG).show() }
    }

    /** After a crash, offers a report the next time the app opens. */
    fun offerCrashReport(activity: Activity) {
        if (unseenCrash() == null) return
        AlertDialog.Builder(activity)
            .setTitle("Paper to Audio closed unexpectedly")
            .setMessage("Send a report so it can be fixed?")
            .setPositiveButton("Report") { _, _ -> showReport(activity, "Report the crash") }
            .setNegativeButton("Not now") { _, _ -> markCrashSeen() }
            .show()
    }
}
