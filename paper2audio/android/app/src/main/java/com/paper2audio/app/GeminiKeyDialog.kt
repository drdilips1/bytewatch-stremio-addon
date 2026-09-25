package com.paper2audio.app

import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.Toast

/** Asks for (or changes) the free Gemini key; [then] runs after a key is saved. */
object GeminiKeyDialog {
    fun show(activity: Activity, onChange: () -> Unit = {}, then: (() -> Unit)? = null) {
        val d = activity.resources.displayMetrics.density
        val input = EditText(activity).apply {
            hint = "Paste your Gemini API key"
            isSingleLine = true
            setText(Gemini.key(activity) ?: "")
        }
        val box = FrameLayout(activity).apply {
            setPadding((20 * d).toInt(), (8 * d).toInt(), (20 * d).toInt(), 0)
            addView(input)
        }
        val builder = AlertDialog.Builder(activity)
            .setTitle("Free Gemini key")
            .setMessage(
                "1. Tap \"Get a key\" and sign in with your Google account.\n" +
                    "2. Tap \"Create API key\", copy it, and paste it here.\n\n" +
                    "It's free, with no card needed. The free tier has a daily limit; when it's used up, AI " +
                    "features pause until the next day. Nothing is ever charged.\n\n" +
                    "On the free tier, Google may use what you send (text, images, recordings) to improve its products. " +
                    "The key stays on this phone."
            )
            .setView(box)
            .setPositiveButton("Save") { _, _ ->
                Gemini.setKey(activity, input.text.toString())
                onChange()
                if (Gemini.key(activity) != null) then?.invoke()
            }
            .setNeutralButton("Get a key") { _, _ ->
                try {
                    activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(Gemini.KEY_PAGE)))
                } catch (e: ActivityNotFoundException) {
                    Toast.makeText(activity, "Open ${Gemini.KEY_PAGE} in your browser", Toast.LENGTH_LONG).show()
                }
            }
            .setNegativeButton("Cancel", null)
        if (Gemini.key(activity) != null) {
            builder.setNegativeButton("Remove key") { _, _ ->
                Gemini.setKey(activity, null)
                onChange()
            }
        }
        builder.show()
    }

    /** Runs [then] now if a key is set, else after the user adds one. */
    fun withKey(activity: Activity, then: () -> Unit) {
        if (Gemini.key(activity) != null) then() else show(activity, then = then)
    }
}
