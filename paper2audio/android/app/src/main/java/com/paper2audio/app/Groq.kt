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
 * Groq (very fast open models, free key from console.groq.com) through its OpenAI-style
 * chat API. Calls block: use them off the main thread.
 */
object Groq {
    private const val API = "https://api.groq.com/openai/v1"
    private const val TEXT_MODEL = "llama-3.3-70b-versatile"
    private const val VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"
    const val KEY_PAGE = "https://console.groq.com/keys"

    class GroqException(message: String) : IOException(message)

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(3, TimeUnit.MINUTES)
        .writeTimeout(1, TimeUnit.MINUTES)
        .build()

    private fun prefs(context: Context) = context.getSharedPreferences("p2a", Context.MODE_PRIVATE)

    fun key(context: Context): String? = prefs(context).getString("groqKey", null)?.trim()?.ifBlank { null }

    fun setKey(context: Context, key: String?) {
        prefs(context).edit().putString("groqKey", key?.trim()?.ifBlank { null }).remove("groqModel").apply()
    }

    /** Sends [prompt] (with optional JPEG/PNG [images]) and returns the answer text. */
    fun generate(context: Context, prompt: String, system: String? = null, images: List<ByteArray> = emptyList(), json: Boolean = false): String {
        val key = key(context) ?: throw GroqException("Add your free Groq key first (Settings › AI).")
        val messages = JSONArray()
        system?.let { messages.put(JSONObject().put("role", "system").put("content", it)) }
        val content: Any = if (images.isEmpty()) prompt else JSONArray().apply {
            for (img in images.take(5)) {
                val mime = if (img.size > 3 && img[0] == 0x89.toByte() && img[1] == 'P'.code.toByte()) "image/png" else "image/jpeg"
                put(JSONObject().put("type", "image_url").put("image_url", JSONObject()
                    .put("url", "data:$mime;base64," + Base64.encodeToString(img, Base64.NO_WRAP))))
            }
            put(JSONObject().put("type", "text").put("text", prompt))
        }
        messages.put(JSONObject().put("role", "user").put("content", content))
        val body = JSONObject().put("messages", messages).put("temperature", 0.4)
        if (json) body.put("response_format", JSONObject().put("type", "json_object"))

        var attempt = 0
        var modelRetried = false
        while (true) {
            attempt++
            body.put("model", if (images.isNotEmpty()) VISION_MODEL else model(context, key))
            val request = Request.Builder().url("$API/chat/completions")
                .header("Authorization", "Bearer $key")
                .post(body.toString().toRequestBody("application/json; charset=UTF-8".toMediaType()))
                .build()
            client.newCall(request).execute().use { r ->
                val text = r.body?.string().orEmpty()
                if (r.isSuccessful) {
                    val msg = JSONObject(text).optJSONArray("choices")?.optJSONObject(0)?.optJSONObject("message")
                    val answer = msg?.optString("content").orEmpty().trim()
                    if (answer.isEmpty()) throw GroqException("Groq returned no answer.")
                    return answer
                }
                val message = runCatching {
                    JSONObject(text).let { o -> o.optJSONObject("error")?.optString("message") ?: o.optString("error") }
                }.getOrNull().orEmpty().ifBlank { text.take(200) }
                // The free tier allows a limited number of words per minute: wait as long as Groq asks.
                val wait = r.header("retry-after")?.toDoubleOrNull()?.let { (it * 1000).toLong() }
                when {
                    (r.code == 404 || "decommissioned" in message || "model" in message.lowercase() && r.code == 400) && !modelRetried -> {
                        prefs(context).edit().putString("groqModel", pickModel(key) ?: TEXT_MODEL).apply()
                        modelRetried = true
                    }
                    r.code == 401 -> throw GroqException("Groq didn't accept the key. Check it at console.groq.com/keys.")
                    r.code == 413 || "too large" in message.lowercase() ->
                        throw GroqException("That's too much text for Groq's free tier in one go. Add a free Gemini key too (Settings › AI) for whole-book jobs.")
                    r.code == 429 && attempt <= 6 -> Thread.sleep((wait ?: (attempt * 8000L)).coerceIn(2_000L, 65_000L))
                    r.code == 429 -> throw GroqException("Groq's free daily limit is used up. It resets within a day; or add a free Gemini key (Settings › AI).")
                    r.code >= 500 && attempt <= 3 -> Thread.sleep(attempt * 3000L)
                    else -> throw GroqException("Groq error ${r.code}: $message")
                }
            }
        }
    }

    private fun model(context: Context, key: String): String = prefs(context).getString("groqModel", null) ?: TEXT_MODEL

    /** A replacement when Groq retires the default model: the largest general chat model offered. */
    private fun pickModel(key: String): String? = runCatching {
        val req = Request.Builder().url("$API/models").header("Authorization", "Bearer $key").build()
        val ids = client.newCall(req).execute().use { r ->
            if (!r.isSuccessful) return null
            val data = JSONObject(r.body!!.string()).optJSONArray("data") ?: return null
            (0 until data.length()).map { data.getJSONObject(it).getString("id") }
        }.filter { id -> listOf("whisper", "guard", "tts", "embed", "vision", "compound").none { it in id } }
        ids.firstOrNull { "llama-3.3-70b" in it } ?: ids.firstOrNull { "gpt-oss-120b" in it } ?: ids.firstOrNull { "70b" in it } ?: ids.firstOrNull()
    }.getOrNull()
}

/** Chooses the AI: Groq (free, fast) or Gemini (free, takes whole books at once). */
object Llm {
    const val GROQ = "groq"
    const val GEMINI = "gemini"

    private fun prefs(context: Context) = context.getSharedPreferences("p2a", Context.MODE_PRIVATE)

    fun provider(context: Context): String? {
        val chosen = prefs(context).getString("aiProvider", null)
        val groq = Groq.key(context) != null
        val gemini = Gemini.key(context) != null
        return when {
            chosen == GROQ && groq -> GROQ
            chosen == GEMINI && gemini -> GEMINI
            groq -> GROQ
            gemini -> GEMINI
            else -> null
        }
    }

    fun setProvider(context: Context, p: String) = prefs(context).edit().putString("aiProvider", p).apply()

    fun ready(context: Context) = provider(context) != null

    fun name(context: Context) = if (provider(context) == GROQ) "Groq" else "Gemini"

    /**
     * Characters of document text one request may carry. Groq's free tier allows about
     * 6,000–12,000 words a minute, Gemini's about a million tokens.
     */
    fun inputChars(context: Context) = if (provider(context) == GROQ) 22_000 else 350_000

    /** For whole-book jobs (versions, library digests): Gemini when it has a key, as it takes far more text per minute. */
    private fun bulkProvider(context: Context) = if (Gemini.key(context) != null) GEMINI else provider(context)

    fun bulkInputChars(context: Context) = if (bulkProvider(context) == GROQ) 22_000 else 300_000

    fun generateBulk(context: Context, prompt: String, system: String? = null): String = when (bulkProvider(context)) {
        GROQ -> Groq.generate(context, prompt, system)
        GEMINI -> Gemini.generate(context, prompt, system)
        else -> throw IOException("Add a free AI key first (Settings › AI).")
    }

    fun generate(context: Context, prompt: String, system: String? = null, images: List<ByteArray> = emptyList(), json: Boolean = false): String =
        when (provider(context)) {
            GROQ -> Groq.generate(context, prompt, system, images, json)
            GEMINI -> if (images.isEmpty()) Gemini.generate(context, prompt, system, json = json)
            else Gemini.generate(context, prompt, system, json = json, images = images)
            else -> throw IOException("Add a free AI key first (Settings › AI).")
        }
}
