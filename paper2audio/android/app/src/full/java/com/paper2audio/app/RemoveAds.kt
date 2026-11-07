package com.paper2audio.app

import android.app.Activity
import android.content.Context

/** The full edition has no ads, so nothing to buy. */
object RemoveAds {
    fun owned(context: Context) = true
    val price: String? get() = null
    fun refresh(context: Context, done: (Boolean) -> Unit = {}) = done(true)
    fun buy(activity: Activity, bought: () -> Unit) = bought()
    fun restore(activity: Activity, bought: () -> Unit) = bought()
}
