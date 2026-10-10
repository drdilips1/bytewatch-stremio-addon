package com.paper2audio.app

import android.app.Activity
import android.view.ViewGroup
import com.google.android.gms.ads.AdListener
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.AdSize
import com.google.android.gms.ads.AdView
import com.google.android.gms.ads.FullScreenContentCallback
import com.google.android.gms.ads.LoadAdError
import com.google.android.gms.ads.MobileAds
import com.google.android.gms.ads.interstitial.InterstitialAd
import com.google.android.gms.ads.interstitial.InterstitialAdLoadCallback
import com.google.android.ump.ConsentInformation
import com.google.android.ump.ConsentRequestParameters
import com.google.android.ump.UserMessagingPlatform

/**
 * Ads that keep the app free and unlimited: a small banner on the library screen,
 * and now and then a full-screen ad at a natural break (never while listening,
 * never at launch, at most one every few minutes). Asks for consent first where
 * the law requires it (EU, UK).
 */
object Ads {
    /** At most one full-screen ad in this many milliseconds. */
    private const val GAP = 5 * 60_000L

    private var started = false
    private var pendingBanner: Pair<Activity, ViewGroup>? = null
    private var interstitial: InterstitialAd? = null
    private var loading = false
    private var lastShown = System.currentTimeMillis() // none in the first minutes after opening the app
    private val counts = HashMap<String, Int>()

    fun init(activity: Activity, onDone: () -> Unit = {}) {
        val consent = UserMessagingPlatform.getConsentInformation(activity)
        consent.requestConsentInfoUpdate(
            activity,
            ConsentRequestParameters.Builder().build(),
            {
                UserMessagingPlatform.loadAndShowConsentFormIfRequired(activity) { error ->
                    error?.let { AppLog.i("Ads", "Consent form: ${it.message}") }
                    start(activity)
                    onDone()
                }
            },
            { error ->
                AppLog.i("Ads", "Consent check failed: ${error.message}")
                start(activity)
                onDone()
            },
        )
        // Consent from an earlier session: ads can start right away.
        start(activity)
    }

    private fun start(activity: Activity) {
        if (started || !UserMessagingPlatform.getConsentInformation(activity).canRequestAds()) return
        started = true
        MobileAds.initialize(activity.applicationContext) {}
        pendingBanner?.let { (a, c) -> if (!a.isFinishing) banner(a, c) }
        pendingBanner = null
        preload(activity)
    }

    /** A banner across the bottom of [container], as wide as the screen. */
    fun banner(activity: Activity, container: ViewGroup) {
        if (!started) {
            pendingBanner = activity to container
            return
        }
        val widthDp = (activity.resources.displayMetrics.widthPixels / activity.resources.displayMetrics.density).toInt()
        val ad = AdView(activity).apply {
            adUnitId = BuildConfig.AD_BANNER
            setAdSize(AdSize.getCurrentOrientationAnchoredAdaptiveBannerAdSize(activity, widthDp))
            adListener = object : AdListener() {
                override fun onAdFailedToLoad(error: LoadAdError) {
                    AppLog.i("Ads", "Banner: ${error.message}")
                }
            }
        }
        container.removeAllViews()
        container.addView(ad)
        ad.loadAd(AdRequest.Builder().build())
    }

    private fun preload(activity: Activity) {
        if (!started || loading || interstitial != null) return
        loading = true
        InterstitialAd.load(
            activity.applicationContext, BuildConfig.AD_INTERSTITIAL, AdRequest.Builder().build(),
            object : InterstitialAdLoadCallback() {
                override fun onAdLoaded(ad: InterstitialAd) {
                    loading = false
                    interstitial = ad
                }

                override fun onAdFailedToLoad(error: LoadAdError) {
                    loading = false
                    AppLog.i("Ads", "Interstitial: ${error.message}")
                }
            },
        )
    }

    /**
     * Maybe shows a full-screen ad at a natural break ([moment]: "open", "leave",
     * "audiobook"), then runs [then]. "open" and "leave" show on every second time.
     */
    fun interstitial(activity: Activity, moment: String, then: () -> Unit = {}) {
        val n = (counts[moment] ?: 0) + 1
        counts[moment] = n
        val ad = interstitial
        val due = moment == "audiobook" || n % 2 == 0
        if (ad == null || !due || Speaker.playing || System.currentTimeMillis() - lastShown < GAP || activity.isFinishing) {
            preload(activity)
            then()
            return
        }
        ad.fullScreenContentCallback = object : FullScreenContentCallback() {
            override fun onAdDismissedFullScreenContent() {
                interstitial = null
                preload(activity)
                then()
            }

            override fun onAdFailedToShowFullScreenContent(error: com.google.android.gms.ads.AdError) {
                interstitial = null
                preload(activity)
                then()
            }
        }
        lastShown = System.currentTimeMillis()
        ad.show(activity)
    }

    /** Shows the consent choices again (where the law requires that option); false if not needed. */
    fun privacyOptions(activity: Activity): Boolean {
        val consent = UserMessagingPlatform.getConsentInformation(activity)
        if (consent.privacyOptionsRequirementStatus != ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED) return false
        UserMessagingPlatform.showPrivacyOptionsForm(activity) {}
        return true
    }
}
