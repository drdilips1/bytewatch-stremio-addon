package com.paper2audio.app

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONArray
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Microsoft Edge "Read aloud" neural voices: free, no API key, no quota.
 * A Kotlin port of the protocol used by the edge-tts Python package.
 */
object EdgeTts {
    data class VoiceInfo(val name: String, val locale: String, val gender: String)

    private const val TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4"
    private const val BASE = "speech.platform.bing.com/consumer/speech/synthesize/readaloud"
    private const val GEC_VERSION = "1-143.0.3650.75"
    private const val USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" +
        " (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0"
    private const val WIN_EPOCH = 11644473600L
    /** Characters per request; well under the service's 4096-byte limit once escaped. */
    private const val PIECE_CHARS = 1200

    /** The most natural voices, listed first. */
    val FAVORITES = listOf(
        VoiceInfo("en-US-AndrewMultilingualNeural", "en-US", "Male"),
        VoiceInfo("en-US-AvaMultilingualNeural", "en-US", "Female"),
        VoiceInfo("en-GB-ThomasNeural", "en-GB", "Male"),
        VoiceInfo("en-US-EmmaMultilingualNeural", "en-US", "Female"),
        VoiceInfo("en-US-BrianMultilingualNeural", "en-US", "Male"),
    )

    /** Good defaults shown before (or without) the full voice list download. */
    val CURATED = FAVORITES + listOf(
        VoiceInfo("en-US-AriaNeural", "en-US", "Female"),
        VoiceInfo("en-US-GuyNeural", "en-US", "Male"),
        VoiceInfo("en-GB-SoniaNeural", "en-GB", "Female"),
        VoiceInfo("en-GB-RyanNeural", "en-GB", "Male"),
        VoiceInfo("en-IN-NeerjaNeural", "en-IN", "Female"),
        VoiceInfo("en-IN-PrabhatNeural", "en-IN", "Male"),
        VoiceInfo("en-AU-NatashaNeural", "en-AU", "Female"),
        VoiceInfo("en-AU-WilliamNeural", "en-AU", "Male"),
        VoiceInfo("hi-IN-SwaraNeural", "hi-IN", "Female"),
        VoiceInfo("hi-IN-MadhurNeural", "hi-IN", "Male"),
    )

    /** Overridable so the protocol can be tested against a local server. */
    internal var socketBase = "wss://$BASE"

    private val client = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    /** Corrects for a phone clock that is off; the token is time-based. */
    @Volatile
    private var skewSeconds = 0L

    fun secMsGec(nowSeconds: Long = System.currentTimeMillis() / 1000 + skewSeconds): String {
        var t = nowSeconds + WIN_EPOCH
        t -= t % 300
        val ticks = t * 10_000_000L
        val digest = MessageDigest.getInstance("SHA-256").digest("$ticks$TOKEN".toByteArray(Charsets.US_ASCII))
        return digest.joinToString("") { "%02X".format(it) }
    }

    private fun muid() = UUID.randomUUID().toString().replace("-", "").uppercase(Locale.US)

    private fun jsDate(): String = SimpleDateFormat(
        "EEE MMM dd yyyy HH:mm:ss 'GMT+0000 (Coordinated Universal Time)'", Locale.US
    ).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date())

    private fun adjustSkew(response: Response?) {
        val date = response?.header("Date") ?: return
        val server = runCatching {
            SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz", Locale.US).parse(date)?.time
        }.getOrNull() ?: return
        skewSeconds = (server - System.currentTimeMillis()) / 1000
    }

    fun listVoices(): List<VoiceInfo> {
        val request = Request.Builder()
            .url("https://$BASE/voices/list?trustedclienttoken=$TOKEN&Sec-MS-GEC=${secMsGec()}&Sec-MS-GEC-Version=$GEC_VERSION")
            .header("User-Agent", USER_AGENT)
            .header("Accept-Language", "en-US,en;q=0.9")
            .header("Cookie", "muid=${muid()};")
            .build()
        client.newCall(request).execute().use { r ->
            if (!r.isSuccessful) {
                adjustSkew(r)
                throw IOException("Voice list failed (HTTP ${r.code})")
            }
            val arr = JSONArray(r.body!!.string())
            return (0 until arr.length()).map { i ->
                val o = arr.getJSONObject(i)
                VoiceInfo(o.getString("ShortName"), o.optString("Locale"), o.optString("Gender"))
            }
        }
    }

    /** Returns MP3 audio (24 kHz mono) for [text]. [ratePercent] is -50..+200. */
    fun synthesize(text: String, voice: String, ratePercent: Int): ByteArray {
        val out = ByteArrayOutputStream()
        for (piece in TextCleaner.splitLong(text, PIECE_CHARS)) {
            out.write(synthesizePiece(piece, voice, ratePercent, retryOnAuth = true))
        }
        return out.toByteArray()
    }

    internal fun escape(text: String): String {
        val sb = StringBuilder(text.length + 16)
        for (c in text) {
            when {
                c == '&' -> sb.append("&amp;")
                c == '<' -> sb.append("&lt;")
                c == '>' -> sb.append("&gt;")
                // The service rejects most control characters.
                c.code <= 8 || c.code in 11..12 || c.code in 14..31 -> sb.append(' ')
                else -> sb.append(c)
            }
        }
        return sb.toString()
    }

    /** Extracts the MP3 payload from a binary frame, or null if it isn't audio. */
    internal fun audioPayload(frame: ByteArray): ByteArray? {
        if (frame.size < 2) return null
        val headerLength = ((frame[0].toInt() and 0xff) shl 8) or (frame[1].toInt() and 0xff)
        if (2 + headerLength > frame.size) return null
        val headers = String(frame, 2, headerLength, Charsets.UTF_8)
        if (!headers.contains("Path:audio\r\n") && !headers.endsWith("Path:audio")) return null
        return frame.copyOfRange(2 + headerLength, frame.size)
    }

    private fun synthesizePiece(text: String, voice: String, ratePercent: Int, retryOnAuth: Boolean): ByteArray {
        val request = Request.Builder()
            .url(
                "$socketBase/edge/v1?TrustedClientToken=$TOKEN&ConnectionId=${muid().lowercase(Locale.US)}" +
                    "&Sec-MS-GEC=${secMsGec()}&Sec-MS-GEC-Version=$GEC_VERSION"
            )
            .header("Pragma", "no-cache")
            .header("Cache-Control", "no-cache")
            .header("Origin", "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold")
            .header("User-Agent", USER_AGENT)
            .header("Accept-Language", "en-US,en;q=0.9")
            .header("Cookie", "muid=${muid()};")
            .build()

        val audio = ByteArrayOutputStream()
        val done = CountDownLatch(1)
        var failure: Throwable? = null
        var failedResponse: Response? = null

        val ws = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                webSocket.send(
                    "X-Timestamp:${jsDate()}\r\n" +
                        "Content-Type:application/json; charset=utf-8\r\n" +
                        "Path:speech.config\r\n\r\n" +
                        """{"context":{"synthesis":{"audio":{"metadataoptions":{""" +
                        """"sentenceBoundaryEnabled":"true","wordBoundaryEnabled":"false"},""" +
                        """"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}""" + "\r\n"
                )
                val rate = if (ratePercent >= 0) "+$ratePercent%" else "$ratePercent%"
                val ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
                    "<voice name='$voice'><prosody pitch='+0Hz' rate='$rate' volume='+0%'>" +
                    escape(text) + "</prosody></voice></speak>"
                webSocket.send(
                    "X-RequestId:${muid().lowercase(Locale.US)}\r\n" +
                        "Content-Type:application/ssml+xml\r\n" +
                        "X-Timestamp:${jsDate()}Z\r\n" + // the trailing Z matches what Edge sends
                        "Path:ssml\r\n\r\n" + ssml
                )
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                if (text.contains("Path:turn.end")) {
                    webSocket.close(1000, null)
                    done.countDown()
                }
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                audioPayload(bytes.toByteArray())?.let { synchronized(audio) { audio.write(it) } }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                failure = t
                failedResponse = response
                done.countDown()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                done.countDown()
            }
        })

        if (!done.await(90, TimeUnit.SECONDS)) {
            ws.cancel()
            throw IOException("The voice service timed out")
        }
        val code = failedResponse?.code
        if (code == 403 && retryOnAuth) {
            adjustSkew(failedResponse)
            return synthesizePiece(text, voice, ratePercent, retryOnAuth = false)
        }
        failure?.let { throw IOException(if (code != null) "Voice service error (HTTP $code)" else it.message, it) }
        val bytes = synchronized(audio) { audio.toByteArray() }
        if (bytes.isEmpty()) throw IOException("The voice service returned no audio")
        return bytes
    }
}
