package com.paper2audio.app

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.TimeUnit

/**
 * Account and sync: sign in with email and password (or Google, when the server allows it)
 * on the same sync server as Inkwell / Audiohub, so one account works for both apps.
 *
 * What syncs: the library list (titles, authors, collections, bookmarks and notes, the link
 * each document came from), listening positions, deletions, and voice and reading settings.
 * Documents added from a link, a search or Bookracy are downloaded again on other devices;
 * Google Drive backup (optional) also copies the files themselves.
 *
 * Data lives in the account's row of `public.user_data` (row-level security: only the
 * signed-in user can read or write it), under the key "paper2audio". The other keys in
 * that row belong to other apps and are left untouched.
 */
object Account {
    private const val URL = "https://gsaeozzcpeughdkbklyp.supabase.co"
    // The project's public ("anon") key: public by design; the data is protected per user by row-level security.
    private const val KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdzYWVvenpjcGV1Z2hka2JrbHlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyMjA1MDMsImV4cCI6MjEwNTc5NjUwM30.Z6e5mMn2dr5tbgIxidITy6fJUgFXxEtNESm_kI4LjDU"
    private const val SECTION = "paper2audio"
    const val REDIRECT = "paper2audio://auth"

    /** Reading and voice settings that follow the account. */
    private val SETTINGS = listOf(
        "voice2", "speed", "style", "pitch", "medical", "fullCast", "castMale", "castFemale", "dialogueVoice", "theme",
        "groqKey", "geminiKey", "aiProvider", "aiLevel", "skipFront", "speakAnswers", "resumeAfterAnswer", "tasteProfile",
    )

    var running = false
        private set
    var status: String? = null
        private set

    private val main = Handler(Looper.getMainLooper())
    private val listeners = CopyOnWriteArraySet<() -> Unit>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    @Volatile
    private var again = false
    private val client = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(40, TimeUnit.SECONDS)
        .build()

    private fun prefs(context: Context) = context.getSharedPreferences("p2a", Context.MODE_PRIVATE)

    fun signedIn(context: Context) = prefs(context).getString("accRefresh", null) != null

    fun email(context: Context): String? = prefs(context).getString("accEmail", null)

    fun lastSync(context: Context): Long = prefs(context).getLong("accSyncAt", 0)

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

    // ---- Server calls ----

    private class ApiError(val code: Int, message: String) : IOException(message)

    private fun call(path: String, method: String = "GET", body: Any? = null, token: String? = null, prefer: String? = null): String {
        val b = Request.Builder().url(URL + path)
            .header("apikey", KEY)
            .header("Authorization", "Bearer ${token ?: KEY}")
        prefer?.let { b.header("Prefer", it) }
        val rb = body?.toString()?.toRequestBody("application/json; charset=utf-8".toMediaType())
        when (method) {
            "POST" -> b.post(rb ?: "{}".toRequestBody("application/json".toMediaType()))
            else -> b.get()
        }
        client.newCall(b.build()).execute().use { r ->
            val text = r.body?.string().orEmpty()
            if (!r.isSuccessful) {
                val o = runCatching { JSONObject(text) }.getOrNull()
                val msg = listOf("msg", "error_description", "message", "error").firstNotNullOfOrNull { k -> o?.optString(k)?.ifBlank { null } }
                throw ApiError(r.code, msg ?: "Server error ${r.code}")
            }
            return text
        }
    }

    private fun saveSession(context: Context, o: JSONObject) {
        val user = o.optJSONObject("user")
        prefs(context).edit()
            .putString("accAccess", o.getString("access_token"))
            .putString("accRefresh", o.getString("refresh_token"))
            .putLong("accExpires", System.currentTimeMillis() + o.optLong("expires_in", 3600) * 1000)
            .apply {
                user?.optString("id")?.ifBlank { null }?.let { putString("accUser", it) }
                user?.optString("email")?.ifBlank { null }?.let { putString("accEmail", it) }
            }
            .apply()
    }

    /** Signs in; returns a message to show. Throws with a readable message on failure. Call off the main thread. */
    fun signIn(context: Context, email: String, password: String): String {
        val o = JSONObject(call("/auth/v1/token?grant_type=password", "POST", JSONObject().put("email", email.trim()).put("password", password)))
        saveSession(context, o)
        request(context)
        return "Signed in. Your library and positions are syncing."
    }

    /** Creates an account; returns a message to show. Call off the main thread. */
    fun signUp(context: Context, email: String, password: String): String {
        if (password.length < 6) error("Use a password of at least 6 characters")
        val o = JSONObject(call("/auth/v1/signup", "POST", JSONObject().put("email", email.trim()).put("password", password)))
        if (o.has("access_token")) {
            saveSession(context, o)
            request(context)
            return "Account created. You're signed in and your library is syncing."
        }
        prefs(context).edit().putString("accEmail", email.trim()).apply()
        return "Account created. Open the confirmation email we sent to ${email.trim()}, then sign in here."
    }

    fun resetPassword(email: String): String {
        call("/auth/v1/recover", "POST", JSONObject().put("email", email.trim()))
        return "If there's an account for ${email.trim()}, a password reset email is on its way."
    }

    /** Whether the server has Google sign-in switched on. Call off the main thread. */
    fun googleAvailable(): Boolean = runCatching {
        JSONObject(call("/auth/v1/settings")).optJSONObject("external")?.optBoolean("google") == true
    }.getOrDefault(false)

    /** The page that signs in with Google and comes back to the app ([handleRedirect]). */
    fun googleUrl(): String = "$URL/auth/v1/authorize?provider=google&redirect_to=" + Uri.encode(REDIRECT)

    /** Finishes a Google sign-in from the "paper2audio://auth#access_token=…" link. Call off the main thread. */
    fun handleRedirect(context: Context, uri: Uri): String {
        val params = (uri.fragment ?: uri.query ?: "").split('&').mapNotNull {
            val k = it.substringBefore('=', "")
            if (k.isEmpty()) null else k to Uri.decode(it.substringAfter('='))
        }.toMap()
        params["error_description"]?.let { error(it.replace('+', ' ')) }
        val access = params["access_token"] ?: error("Google sign-in didn't finish")
        val refresh = params["refresh_token"] ?: error("Google sign-in didn't finish")
        val user = JSONObject(call("/auth/v1/user", token = access))
        saveSession(
            context,
            JSONObject().put("access_token", access).put("refresh_token", refresh)
                .put("expires_in", params["expires_in"]?.toLongOrNull() ?: 3600).put("user", user),
        )
        request(context)
        return "Signed in with Google. Your library is syncing."
    }

    fun signOut(context: Context) {
        val token = prefs(context).getString("accAccess", null)
        scope.launch { runCatching { call("/auth/v1/logout", "POST", token = token) } }
        prefs(context).edit().remove("accAccess").remove("accRefresh").remove("accExpires").remove("accUser")
            .remove("accSyncAt").apply()
        update { status = null }
    }

    /** A valid access token, renewing it when it is about to run out. */
    private fun token(context: Context, force: Boolean = false): String {
        val p = prefs(context)
        val access = p.getString("accAccess", null)
        if (!force && access != null && System.currentTimeMillis() < p.getLong("accExpires", 0) - 60_000) return access
        val refresh = p.getString("accRefresh", null) ?: throw ApiError(401, "Not signed in")
        val o = try {
            JSONObject(call("/auth/v1/token?grant_type=refresh_token", "POST", JSONObject().put("refresh_token", refresh)))
        } catch (e: ApiError) {
            if (e.code in 400..401) {
                // The sign-in ran out (password changed, or signed out elsewhere).
                p.edit().remove("accRefresh").remove("accAccess").apply()
                throw ApiError(401, "Your sign-in ran out. Sign in again to keep syncing.")
            }
            throw e
        }
        saveSession(context, o)
        return o.getString("access_token")
    }

    // ---- Sync ----

    /** Starts a sync in the background (coalesced if one is already running). */
    fun request(context: Context) {
        val app = context.applicationContext
        if (!signedIn(app)) return
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
                update { status = null }
            } catch (e: Exception) {
                val hint = if (e.message.orEmpty().contains("user_data")) " (the sync server isn't set up yet)" else ""
                update { status = "Sync failed: ${e.message ?: e.javaClass.simpleName}$hint" }
            } finally {
                synchronized(this@Account) { running = false }
                update {}
            }
        }
    }

    private fun readRow(context: Context, token: String): JSONObject? {
        val uid = prefs(context).getString("accUser", null) ?: return null
        val rows = JSONArray(call("/rest/v1/user_data?select=data&user_id=eq.$uid", token = token))
        return if (rows.length() > 0) rows.getJSONObject(0).optJSONObject("data") ?: JSONObject() else null
    }

    private fun syncOnce(context: Context) {
        var tok = token(context)
        val p = prefs(context)
        if (p.getString("accUser", null) == null) {
            JSONObject(call("/auth/v1/user", token = tok)).optString("id").ifBlank { null }?.let { p.edit().putString("accUser", it).apply() }
        }
        val row = try {
            readRow(context, tok)
        } catch (e: ApiError) {
            if (e.code != 401) throw e
            tok = token(context, force = true) // the pass ran out early (phone clock off, or asleep)
            readRow(context, tok)
        }
        val mine = row?.optJSONObject(SECTION)

        val merged = Library.merge(context, mine?.optJSONObject("library"))
        val settings = mergeSettings(context, mine?.optJSONObject("settings"), mine?.optLong("settingsAt") ?: 0)

        val section = JSONObject()
            .put("v", 1)
            .put("library", merged.json)
            .put("settings", settings.first)
            .put("settingsAt", settings.second)
            .put("updatedAt", System.currentTimeMillis())
        // Read again just before writing, so another app's changes made meanwhile are kept.
        val data = runCatching { readRow(context, tok) }.getOrNull() ?: row ?: JSONObject()
        data.put(SECTION, section)
        call(
            "/rest/v1/user_data", "POST",
            JSONObject().put("user_id", p.getString("accUser", null)).put("data", data)
                .put("updated_at", java.time.Instant.now().toString()),
            token = tok, prefer = "resolution=merge-duplicates,return=minimal",
        )
        p.edit().putLong("accSyncAt", System.currentTimeMillis()).apply()
        // Documents new to this device that came from a link show up at once; their file is fetched when opened.
        update {}
    }

    private fun localSettings(context: Context): JSONObject {
        val all = prefs(context).all
        val o = JSONObject()
        for (k in SETTINGS) all[k]?.let { o.put(k, it) }
        return o
    }

    /**
     * Newest settings win. A change here is noticed by comparing with what was last synced,
     * so no setting needs its own timestamp. Returns the settings to upload and their time.
     */
    private fun mergeSettings(context: Context, remote: JSONObject?, remoteAt: Long): Pair<JSONObject, Long> {
        val p = prefs(context)
        var local = localSettings(context)
        var localAt = p.getLong("accSettingsAt", 0)
        if (local.toString() != p.getString("accSettingsSent", null)) {
            localAt = System.currentTimeMillis() // changed on this device since the last sync
        }
        if (remote != null && remoteAt > localAt) {
            val e = p.edit()
            for (k in remote.keys()) {
                if (k !in SETTINGS) continue
                when (val v = remote.get(k)) {
                    is Boolean -> e.putBoolean(k, v)
                    is Int -> if (k == "speed") e.putFloat(k, v.toFloat()) else e.putInt(k, v)
                    is Long -> e.putInt(k, v.toInt())
                    is Double -> if (k == "speed") e.putFloat(k, v.toFloat()) else e.putInt(k, v.toInt())
                    is String -> {
                        // A cloned voice only exists on the phone it was made on.
                        val ownVoice = k == "voice2" && v.startsWith(Speaker.CLONE) && MyVoices.get(v.removePrefix(Speaker.CLONE)) == null
                        if (!ownVoice) e.putString(k, v)
                    }
                }
            }
            e.apply()
            main.post { Speaker.reloadSettings() }
            local = localSettings(context)
            localAt = remoteAt
        }
        p.edit().putString("accSettingsSent", local.toString()).putLong("accSettingsAt", localAt).apply()
        return local to localAt
    }
}
