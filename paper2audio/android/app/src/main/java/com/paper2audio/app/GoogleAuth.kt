package com.paper2audio.app

import android.app.Activity
import android.content.Context
import android.content.Intent
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.Scope
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * Google sign-in for Drive sync, via Google Play services. Only the
 * "app data" Drive scope is requested: the app can see nothing else in Drive.
 */
object GoogleAuth {
    const val REQ_AUTH = 77
    private const val DRIVE_APPDATA = "https://www.googleapis.com/auth/drive.appdata"

    private fun request(): AuthorizationRequest =
        AuthorizationRequest.builder().setRequestedScopes(listOf(Scope(DRIVE_APPDATA))).build()

    /** Interactive: may show Google's account picker and consent screen. */
    fun signIn(activity: Activity, onToken: (String) -> Unit, onError: (String) -> Unit) {
        Identity.getAuthorizationClient(activity).authorize(request())
            .addOnSuccessListener { result ->
                val pending = result.pendingIntent
                if (result.hasResolution() && pending != null) {
                    try {
                        activity.startIntentSenderForResult(pending.intentSender, REQ_AUTH, null, 0, 0, 0, null)
                    } catch (e: Exception) {
                        onError(e.message ?: "Couldn't open Google sign-in")
                    }
                } else {
                    result.accessToken?.let(onToken) ?: onError("Google didn't return access")
                }
            }
            .addOnFailureListener { e -> onError(describe(e)) }
    }

    /** Call from onActivityResult for [REQ_AUTH]. */
    fun tokenFromResult(activity: Activity, data: Intent?): String? = try {
        Identity.getAuthorizationClient(activity).getAuthorizationResultFromIntent(data).accessToken
    } catch (e: ApiException) {
        null
    }

    /** A fresh access token without any UI, or null if the user must sign in again. */
    suspend fun silentToken(context: Context): String? = suspendCancellableCoroutine { cont ->
        Identity.getAuthorizationClient(context).authorize(request())
            .addOnSuccessListener { result -> cont.resume(if (result.hasResolution()) null else result.accessToken) }
            .addOnFailureListener { cont.resume(null) }
    }

    fun describe(e: Exception): String {
        val code = (e as? ApiException)?.statusCode
        return if (code == 10) {
            "Google sign-in isn't set up for this build yet: the app's signing key or package name " +
                "doesn't match the OAuth client in Google Cloud. See the sync setup steps."
        } else {
            "Google sign-in failed" + (code?.let { " (code $it)" } ?: "") + ": ${e.message ?: ""}"
        }
    }
}
