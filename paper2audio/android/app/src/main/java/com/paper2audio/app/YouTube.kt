package com.paper2audio.app

import android.content.Context
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Turns a YouTube video into text: its captions, or (without captions) Gemini's transcript. */
object YouTube {
    private val ID = Regex("""(?:youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|live/|embed/)|youtu\.be/)([\w-]{11})""")
    private val client = OkHttpClient.Builder().connectTimeout(20, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).build()
    private const val UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36"

    fun idOf(url: String): String? = ID.find(url)?.groupValues?.get(1)

    /** (title, transcript text with paragraphs). */
    fun transcript(context: Context, url: String, progress: (String) -> Unit): Pair<String, String> {
        val id = idOf(url) ?: error("That doesn't look like a YouTube video link")
        progress("Getting the video's captions…")
        val page = get("https://www.youtube.com/watch?v=$id&hl=en")
        val title = Regex("""<meta name="title" content="([^"]*)"""").find(page)?.groupValues?.get(1)
            ?.let { org.jsoup.parser.Parser.unescapeEntities(it, false) }
            ?: "YouTube video"
        val text = runCatching { captions(page) }.getOrNull()
        if (!text.isNullOrBlank()) return title to text
        if (Gemini.key(context) != null) {
            progress("No captions: Gemini is transcribing the video…")
            val t = Gemini.generate(
                context,
                "Transcribe this video's speech completely and accurately, in its original language, as clean paragraphs. " +
                    "Remove filler words. If several people speak, start each change of speaker with their name or \"Speaker 1:\". No timestamps, no markdown.",
                uploaded = "video/*" to "https://www.youtube.com/watch?v=$id",
            )
            return title to t
        }
        error("This video has no captions YouTube lets apps read. Add a free Gemini key (player › Options › AI) to transcribe it.")
    }

    private fun get(url: String): String {
        val req = Request.Builder().url(url).header("User-Agent", UA).header("Accept-Language", "en-US,en;q=0.9")
            .header("Cookie", "CONSENT=YES+cb; SOCS=CAI").build()
        client.newCall(req).execute().use { r ->
            if (!r.isSuccessful) error("YouTube returned HTTP ${r.code}")
            return r.body!!.string()
        }
    }

    /** Reads the caption track list from the watch page, prefers English written captions, and fetches the text. */
    private fun captions(page: String): String? {
        val start = page.indexOf("\"captionTracks\":")
        if (start < 0) return null
        val arrStart = page.indexOf('[', start)
        var depth = 0
        var end = arrStart
        var inString = false
        while (end < page.length) {
            val c = page[end]
            if (c == '"' && page[end - 1] != '\\') inString = !inString
            if (!inString) {
                if (c == '[') depth++ else if (c == ']') { depth--; if (depth == 0) break }
            }
            end++
        }
        val tracks = JSONArray(page.substring(arrStart, end + 1))
        val all = (0 until tracks.length()).map { tracks.getJSONObject(it) }
        val track = all.firstOrNull { it.optString("languageCode").startsWith("en") && it.optString("kind") != "asr" }
            ?: all.firstOrNull { it.optString("languageCode").startsWith("en") }
            ?: all.firstOrNull() ?: return null
        val json = get(track.getString("baseUrl") + "&fmt=json3")
        if (json.isBlank()) return null
        val events = JSONObject(json).optJSONArray("events") ?: return null
        val out = StringBuilder()
        var lastEnd = 0L
        var sentences = 0
        for (i in 0 until events.length()) {
            val e = events.getJSONObject(i)
            val segs = e.optJSONArray("segs") ?: continue
            val text = (0 until segs.length()).joinToString("") { segs.getJSONObject(it).optString("utf8") }
                .replace('\n', ' ').replace(Regex("""\[(?:Music|Applause|Laughter)]""", RegexOption.IGNORE_CASE), "").trim()
            if (text.isEmpty()) continue
            val t = e.optLong("tStartMs")
            // A long pause, or enough sentences, starts a new paragraph.
            if (out.isNotEmpty() && (t - lastEnd > 2500 || sentences >= 5 && out.last() in ".!?")) {
                out.append("\n\n")
                sentences = 0
            } else if (out.isNotEmpty()) out.append(' ')
            out.append(text)
            sentences += text.count { it in ".!?" }
            lastEnd = t + e.optLong("dDurationMs")
        }
        return out.toString().trim().ifBlank { null }
    }
}
