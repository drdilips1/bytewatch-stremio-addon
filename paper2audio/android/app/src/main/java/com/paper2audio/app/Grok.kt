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

/** xAI's Grok through its OpenAI-style chat API, with the user's own (paid) key. Calls block. */
object Grok {
    private const val API = "https://api.x.ai/v1"
    private const val FALLBACK_MODEL = "grok-4"
    const val KEY_PAGE = "https://console.x.ai"

    class GrokException(message: String) : IOException(message)

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.MINUTES)
        .writeTimeout(2, TimeUnit.MINUTES)
        .build()

    private fun prefs(context: Context) = context.getSharedPreferences("p2a", Context.MODE_PRIVATE)

    fun key(context: Context): String? = prefs(context).getString("grokKey", null)?.trim()?.ifBlank { null }

    fun setKey(context: Context, key: String?) {
        prefs(context).edit().putString("grokKey", key?.trim()?.ifBlank { null }).remove("grokModel").apply()
    }

    /** Sends [prompt] (with optional JPEG/PNG [images]) and returns the answer text. */
    fun generate(context: Context, prompt: String, system: String? = null, images: List<ByteArray> = emptyList(), json: Boolean = false): String {
        val key = key(context) ?: throw GrokException("Add your Grok key first.")
        val messages = JSONArray()
        system?.let { messages.put(JSONObject().put("role", "system").put("content", it)) }
        val content: Any = if (images.isEmpty()) prompt else JSONArray().apply {
            for (img in images) {
                val mime = if (img.size > 3 && img[0] == 0x89.toByte() && img[1] == 'P'.code.toByte()) "image/png" else "image/jpeg"
                put(JSONObject().put("type", "image_url").put("image_url", JSONObject()
                    .put("url", "data:$mime;base64," + Base64.encodeToString(img, Base64.NO_WRAP)).put("detail", "high")))
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
            body.put("model", model(context, key))
            val request = Request.Builder().url("$API/chat/completions")
                .header("Authorization", "Bearer $key")
                .post(body.toString().toRequestBody("application/json; charset=UTF-8".toMediaType()))
                .build()
            client.newCall(request).execute().use { r ->
                val text = r.body?.string().orEmpty()
                if (r.isSuccessful) {
                    val msg = JSONObject(text).optJSONArray("choices")?.optJSONObject(0)?.optJSONObject("message")
                    val answer = msg?.optString("content").orEmpty().trim()
                    if (answer.isEmpty()) throw GrokException("Grok returned no answer.")
                    return answer
                }
                val message = runCatching {
                    JSONObject(text).let { o -> o.optJSONObject("error")?.optString("message") ?: o.optString("error") }
                }.getOrNull().orEmpty().ifBlank { text.take(200) }
                when {
                    r.code == 404 && !modelRetried -> {
                        prefs(context).edit().remove("grokModel").apply()
                        modelRetried = true
                    }
                    r.code == 401 || r.code == 400 && "key" in message.lowercase() ->
                        throw GrokException("Grok didn't accept the key. Check it at console.x.ai.")
                    r.code == 403 || "credit" in message.lowercase() || "spending" in message.lowercase() ->
                        throw GrokException("Your Grok account has no credits left (console.x.ai › Billing), or switch AI to free Gemini.")
                    r.code == 429 && attempt <= 3 -> Thread.sleep(attempt * 5000L)
                    r.code >= 500 && attempt <= 3 -> Thread.sleep(attempt * 4000L)
                    else -> throw GrokException("Grok error ${r.code}: $message")
                }
            }
        }
    }

    /** The newest general Grok model this key can use, remembered for a week. */
    private fun model(context: Context, key: String): String {
        val p = prefs(context)
        val saved = p.getString("grokModel", null)
        if (saved != null && System.currentTimeMillis() - p.getLong("grokModelAt", 0) < 7 * 86_400_000L) return saved
        val chosen = runCatching { pickModel(key) }.getOrNull() ?: saved ?: FALLBACK_MODEL
        p.edit().putString("grokModel", chosen).putLong("grokModelAt", System.currentTimeMillis()).apply()
        return chosen
    }

    private fun pickModel(key: String): String? {
        val req = Request.Builder().url("$API/models").header("Authorization", "Bearer $key").build()
        val ids = client.newCall(req).execute().use { r ->
            if (!r.isSuccessful) return null
            val data = JSONObject(r.body!!.string()).optJSONArray("data") ?: return null
            (0 until data.length()).map { data.getJSONObject(it).getString("id") }
        }.filter { id -> listOf("image", "imagine", "video", "tts", "audio", "embed").none { it in id } }
        fun version(id: String) = Regex("""grok-(\d+(?:\.\d+)?)""").find(id)?.groupValues?.get(1)?.toDoubleOrNull() ?: 0.0
        // Fast models answer quickly and cost little; the newest version wins.
        return ids.filter { "fast" in it && "non-reasoning" in it }.maxByOrNull(::version)
            ?: ids.filter { "fast" in it }.maxByOrNull(::version)
            ?: ids.filter { it.startsWith("grok") }.maxByOrNull(::version)
    }
}

/** Chooses the AI: Grok when its key is set (and it is chosen), else free Gemini. */
object Llm {
    const val GROK = "grok"
    const val GEMINI = "gemini"

    private fun prefs(context: Context) = context.getSharedPreferences("p2a", Context.MODE_PRIVATE)

    fun provider(context: Context): String? {
        val chosen = prefs(context).getString("aiProvider", null)
        val grok = Grok.key(context) != null
        val gemini = Gemini.key(context) != null
        return when {
            chosen == GROK && grok -> GROK
            chosen == GEMINI && gemini -> GEMINI
            grok -> GROK
            gemini -> GEMINI
            else -> null
        }
    }

    fun setProvider(context: Context, p: String) = prefs(context).edit().putString("aiProvider", p).apply()

    fun ready(context: Context) = provider(context) != null

    fun name(context: Context) = if (provider(context) == GROK) "Grok" else "Gemini"

    fun generate(context: Context, prompt: String, system: String? = null, images: List<ByteArray> = emptyList(), json: Boolean = false): String =
        when (provider(context)) {
            GROK -> Grok.generate(context, prompt, system, images, json)
            GEMINI -> if (images.isEmpty()) Gemini.generate(context, prompt, system, json = json)
            else Gemini.generate(context, prompt, system, json = json, images = images)
            else -> throw IOException("Add an AI key first (Options › AI).")
        }
}
