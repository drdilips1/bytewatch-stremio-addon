package com.paper2audio.app

import android.app.Activity
import android.view.ViewGroup

/** The full edition has no ads. */
object Ads {
    fun init(activity: Activity, onDone: () -> Unit = {}) = onDone()
    fun banner(activity: Activity, container: ViewGroup) = Unit
    fun interstitial(activity: Activity, moment: String, then: () -> Unit = {}) = then()
    fun privacyOptions(activity: Activity): Boolean = false
}
