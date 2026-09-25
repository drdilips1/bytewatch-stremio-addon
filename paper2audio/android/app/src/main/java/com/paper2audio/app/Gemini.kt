package com.paper2audio.app

import android.content.Context
import android.util.Base64
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Google Gemini (free tier) through its REST API, with the user's own key.
 * All calls block: use them off the main thread.
 */
object Gemini {
    private const val API = "https://generativelanguage.googleapis.com/v1beta"
    private const val FALLBACK_MODEL = "gemini-2.5-flash"
    const val KEY_PAGE = "https://aistudio.google.com/apikey"

    class GeminiException(message: String) : IOException(message)

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.MINUTES)
        .writeTimeout(2, TimeUnit.MINUTES)
        .build()

    private fun prefs(context: Context) = context.getSharedPreferences("p2a", Context.MODE_PRIVATE)

    fun key(context: Context): String? = prefs(context).getString("geminiKey", null)?.trim()?.ifBlank { null }

    fun setKey(context: Context, key: String?) {
        prefs(context).edit().putString("geminiKey", key?.trim()?.ifBlank { null }).remove("geminiModel").apply()
    }

    /**
     * Sends [prompt] (plus an optional file such as a PDF or image) and returns the text answer.
     * Retries briefly when the free tier's per-minute limit is hit.
     */
    fun generate(
        context: Context,
        prompt: String,
        system: String? = null,
        attachment: Pair<String, ByteArray>? = null,
        json: Boolean = false,
        /** A file uploaded with [upload]: (mime type, file URI). */
        uploaded: Pair<String, String>? = null,
    ): String {
        val key = key(context) ?: throw GeminiException("Add your free Gemini key first.")
        val parts = JSONArray()
        attachment?.let { (mime, bytes) ->
            parts.put(JSONObject().put("inlineData", JSONObject().put("mimeType", mime).put("data", Base64.encodeToString(bytes, Base64.NO_WRAP))))
        }
        uploaded?.let { (mime, uri) ->
            parts.put(JSONObject().put("fileData", JSONObject().put("mimeType", mime).put("fileUri", uri)))
        }
        parts.put(JSONObject().put("text", prompt))
        val body = JSONObject()
            .put("contents", JSONArray().put(JSONObject().put("role", "user").put("parts", parts)))
            .put("generationConfig", JSONObject().put("temperature", 0.4).apply {
                if (json) put("responseMimeType", "application/json")
            })
        system?.let { body.put("systemInstruction", JSONObject().put("parts", JSONArray().put(JSONObject().put("text", it)))) }
        val payload = body.toString()

        var attempt = 0
        var modelRetried = false
        while (true) {
            attempt++
            val model = model(context, key)
            val request = Request.Builder()
                .url("$API/models/$model:generateContent")
                .header("x-goog-api-key", key)
                .post(payload.toRequestBody("application/json; charset=UTF-8".toMediaType()))
                .build()
            client.newCall(request).execute().use { r ->
                val text = r.body?.string().orEmpty()
                if (r.isSuccessful) return answer(text)
                val err = runCatching { JSONObject(text).getJSONObject("error") }.getOrNull()
                val message = err?.optString("message").orEmpty()
                when {
                    r.code == 404 && !modelRetried -> {
                        // The saved model was retired: pick again.
                        prefs(context).edit().remove("geminiModel").apply()
                        modelRetried = true
                    }
                    r.code == 400 && "API key" in message || r.code == 401 || r.code == 403 ->
                        throw GeminiException("Gemini didn't accept the key. Check it (or make a new one at aistudio.google.com/apikey).")
                    r.code == 429 -> {
                        val wait = retryDelay(err)
                        if ("PerDay" in text || "per day" in message.lowercase() || wait == null && attempt > 1 || attempt > 3 || (wait ?: 0) > 70) {
                            throw GeminiException("Gemini's free limit is used up for now. Try again later (the daily limit resets each day).")
                        }
                        Thread.sleep(((wait ?: 20) + 1) * 1000L)
                    }
                    r.code >= 500 && attempt <= 3 -> Thread.sleep(attempt * 4000L)
                    else -> throw GeminiException("Gemini error ${r.code}: ${message.ifBlank { text.take(200) }}")
                }
            }
        }
    }

    /**
     * Uploads a large file (audio, video, PDF) with the Files API, waits until Gemini
     * has processed it, and returns its URI for [generate]. Files expire after 48 hours.
     */
    fun upload(context: Context, uri: android.net.Uri, mime: String, name: String, progress: (String) -> Unit): String {
        val key = key(context) ?: throw GeminiException("Add your free Gemini key first.")
        val cr = context.contentResolver
        val size = cr.openFileDescriptor(uri, "r")?.use { it.statSize }?.takeIf { it > 0 }
            ?: throw GeminiException("Couldn't read that file")
        if (size > 2_000_000_000L) throw GeminiException("That file is larger than Gemini's 2 GB limit.")
        val start = Request.Builder()
            .url("https://generativelanguage.googleapis.com/upload/v1beta/files")
            .header("x-goog-api-key", key)
            .header("X-Goog-Upload-Protocol", "resumable")
            .header("X-Goog-Upload-Command", "start")
            .header("X-Goog-Upload-Header-Content-Length", size.toString())
            .header("X-Goog-Upload-Header-Content-Type", mime)
            .post(JSONObject().put("file", JSONObject().put("display_name", name.take(100))).toString()
                .toRequestBody("application/json".toMediaType()))
            .build()
        val uploadUrl = client.newCall(start).execute().use { r ->
            if (!r.isSuccessful) throw GeminiException("Gemini upload failed (${r.code}): ${r.body?.string()?.take(200)}")
            r.header("X-Goog-Upload-URL") ?: throw GeminiException("Gemini upload failed (no upload address)")
        }
        val body = object : okhttp3.RequestBody() {
            override fun contentType() = mime.toMediaType()
            override fun contentLength() = size
            override fun writeTo(sink: okio.BufferedSink) {
                val input = cr.openInputStream(uri) ?: throw IOException("Couldn't read that file")
                input.use {
                    val buf = ByteArray(256 * 1024)
                    var sent = 0L
                    var lastPct = -1
                    while (true) {
                        val n = it.read(buf)
                        if (n < 0) break
                        sink.write(buf, 0, n)
                        sent += n
                        val pct = (sent * 100 / size).toInt()
                        if (pct != lastPct) {
                            lastPct = pct
                            progress("Uploading to Gemini… $pct% of ${size / 1_000_000} MB")
                        }
                    }
                }
            }
        }
        val upload = Request.Builder().url(uploadUrl)
            .header("X-Goog-Upload-Offset", "0")
            .header("X-Goog-Upload-Command", "upload, finalize")
            .post(body)
            .build()
        var file = client.newCall(upload).execute().use { r ->
            val text = r.body?.string().orEmpty()
            if (!r.isSuccessful) throw GeminiException("Gemini upload failed (${r.code}): ${text.take(200)}")
            JSONObject(text).getJSONObject("file")
        }
        // Audio and video are processed before they can be used.
        var waited = 0
        while (file.optString("state") == "PROCESSING") {
            if (waited > 600) throw GeminiException("Gemini took too long to process the file. Try again later.")
            progress("Gemini is processing the file…")
            Thread.sleep(5000)
            waited += 5
            val get = Request.Builder().url("$API/${file.getString("name")}").header("x-goog-api-key", key).build()
            file = client.newCall(get).execute().use { r ->
                val text = r.body?.string().orEmpty()
                if (!r.isSuccessful) throw GeminiException("Gemini error ${r.code}: ${text.take(200)}")
                JSONObject(text)
            }
        }
        if (file.optString("state") == "FAILED") throw GeminiException("Gemini couldn't process that file.")
        return file.getString("uri")
    }

    private fun answer(text: String): String {
        val json = JSONObject(text)
        val candidate = json.optJSONArray("candidates")?.optJSONObject(0)
        if (candidate == null) {
            val reason = json.optJSONObject("promptFeedback")?.optString("blockReason")
            throw GeminiException(if (!reason.isNullOrBlank()) "Gemini declined this ($reason)." else "Gemini returned no answer.")
        }
        val parts = candidate.optJSONObject("content")?.optJSONArray("parts") ?: JSONArray()
        val out = StringBuilder()
        for (i in 0 until parts.length()) {
            val p = parts.getJSONObject(i)
            if (!p.optBoolean("thought")) out.append(p.optString("text"))
        }
        if (out.isBlank()) throw GeminiException("Gemini returned no answer (${candidate.optString("finishReason")}).")
        return out.toString().trim()
    }

    /** "37s" from a RetryInfo detail, in seconds. */
    private fun retryDelay(err: JSONObject?): Int? {
        val details = err?.optJSONArray("details") ?: return null
        for (i in 0 until details.length()) {
            val d = details.optJSONObject(i) ?: continue
            val delay = d.optString("retryDelay").removeSuffix("s").toDoubleOrNull() ?: continue
            return delay.toInt()
        }
        return null
    }

    /** The newest general "Flash" model this key can use (free tier), remembered for a week. */
    private fun model(context: Context, key: String): String {
        val p = prefs(context)
        val saved = p.getString("geminiModel", null)
        if (saved != null && System.currentTimeMillis() - p.getLong("geminiModelAt", 0) < 7 * 86_400_000L) return saved
        val chosen = runCatching { pickModel(key) }.getOrNull() ?: saved ?: FALLBACK_MODEL
        p.edit().putString("geminiModel", chosen).putLong("geminiModelAt", System.currentTimeMillis()).apply()
        return chosen
    }

    private fun pickModel(key: String): String? {
        val request = Request.Builder().url("$API/models?pageSize=1000").header("x-goog-api-key", key).build()
        val names = client.newCall(request).execute().use { r ->
            if (!r.isSuccessful) return null
            val models = JSONObject(r.body!!.string()).optJSONArray("models") ?: return null
            (0 until models.length()).map { models.getJSONObject(it) }
                .filter { m -> m.optJSONArray("supportedGenerationMethods")?.toString()?.contains("generateContent") == true }
                .map { it.getString("name").removePrefix("models/") }
        }
        if ("gemini-flash-latest" in names) return "gemini-flash-latest"
        // Stable "gemini-<version>-flash" models, newest version first.
        val stable = Regex("""^gemini-(\d+(?:\.\d+)?)-flash$""")
        return names.mapNotNull { n -> stable.matchEntire(n)?.let { n to it.groupValues[1].toDouble() } }
            .maxByOrNull { it.second }?.first
            ?: names.firstOrNull { "flash" in it && listOf("lite", "image", "tts", "live", "audio", "exp").none { x -> x in it } }
    }
}
