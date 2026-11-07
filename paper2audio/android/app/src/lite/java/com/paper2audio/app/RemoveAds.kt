package com.paper2audio.app

import android.app.Activity
import android.content.Context
import android.os.Handler
import android.os.Looper
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams

/**
 * The one-time "Remove ads" purchase through Google Play. Once bought, the app shows no ads and no
 * ad consent form, on every phone signed in to the same Google account ([restore]).
 * The answer is kept on the phone too, so it holds offline; Play is asked again at each start.
 */
object RemoveAds {
    /** The product ID in Play Console (Monetize → Products → One-time products). */
    const val PRODUCT = "remove_ads"
    private const val KEY = "adFree"

    private val main = Handler(Looper.getMainLooper())
    private var client: BillingClient? = null
    private var details: ProductDetails? = null
    private var onBought: (() -> Unit)? = null
    private var appContext: Context? = null

    /** Whether ads are removed (bought). */
    fun owned(context: Context) = prefs(context).getBoolean(KEY, false)

    /** The price as Play shows it in the phone's country ("$2.99", "₹129"), once known. */
    val price: String? get() = details?.oneTimePurchaseOfferDetails?.formattedPrice

    private fun prefs(c: Context) = c.getSharedPreferences("p2a", Context.MODE_PRIVATE)

    private fun connect(context: Context, ready: (BillingClient?) -> Unit) {
        appContext = context.applicationContext
        client?.takeIf { it.isReady }?.let { return ready(it) }
        val c = client ?: BillingClient.newBuilder(context.applicationContext)
            .setListener { result, purchases -> main.post { onPurchases(result, purchases) } }
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .build()
            .also { client = it }
        runCatching {
            c.startConnection(object : BillingClientStateListener {
                override fun onBillingSetupFinished(result: BillingResult) {
                    main.post { ready(if (result.responseCode == BillingClient.BillingResponseCode.OK) c else null) }
                }

                override fun onBillingServiceDisconnected() {}
            })
        }.onFailure {
            AppLog.i("RemoveAds", "Play Billing: ${it.message}")
            ready(null)
        }
    }

    /** At start: checks with Play whether it's bought (and finishes a purchase left half-done). */
    fun refresh(context: Context, done: (Boolean) -> Unit = {}) = connect(context) { c ->
        if (c == null) return@connect done(owned(context))
        loadDetails(c)
        c.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build()) { result, list ->
            main.post {
                if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                    val mine = list.filter { PRODUCT in it.products && it.purchaseState == Purchase.PurchaseState.PURCHASED }
                    mine.forEach { acknowledge(it) }
                    // Refunded purchases disappear from this list: ads come back.
                    prefs(context).edit().putBoolean(KEY, mine.isNotEmpty()).apply()
                }
                done(owned(context))
            }
        }
    }

    private fun loadDetails(c: BillingClient, then: () -> Unit = {}) {
        if (details != null) return then()
        val product = QueryProductDetailsParams.Product.newBuilder()
            .setProductId(PRODUCT).setProductType(BillingClient.ProductType.INAPP).build()
        c.queryProductDetailsAsync(QueryProductDetailsParams.newBuilder().setProductList(listOf(product)).build()) { result, found ->
            main.post {
                if (result.responseCode == BillingClient.BillingResponseCode.OK) details = found.productDetailsList.firstOrNull()
                else AppLog.i("RemoveAds", "Product: ${result.debugMessage}")
                then()
            }
        }
    }

    /** Opens Play's payment sheet; [bought] runs once ads are removed. */
    fun buy(activity: Activity, bought: () -> Unit) = connect(activity) { c ->
        if (c == null) return@connect toast(activity, "Google Play isn't available right now. Please try again later.")
        loadDetails(c) {
            val d = details ?: return@loadDetails toast(activity, "Remove ads isn't available yet. Please try again later.")
            onBought = bought
            val params = BillingFlowParams.newBuilder().setProductDetailsParamsList(
                listOf(BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(d).build())
            ).build()
            c.launchBillingFlow(activity, params)
        }
    }

    /** For a new phone or a reinstall: asks Play again. */
    fun restore(activity: Activity, bought: () -> Unit) = refresh(activity) { has ->
        if (has) {
            toast(activity, "Welcome back: ads are removed.")
            bought()
        } else toast(activity, "No purchase found for this Google account.")
    }

    private fun onPurchases(result: BillingResult, purchases: List<Purchase>?) {
        val c = appContext ?: return
        when (result.responseCode) {
            BillingClient.BillingResponseCode.OK -> purchases.orEmpty().filter { PRODUCT in it.products }.forEach { p ->
                when (p.purchaseState) {
                    Purchase.PurchaseState.PURCHASED -> {
                        acknowledge(p)
                        prefs(c).edit().putBoolean(KEY, true).apply()
                        toast(c, "Thank you! Ads are removed.")
                        onBought?.invoke()
                        onBought = null
                    }
                    Purchase.PurchaseState.PENDING -> toast(c, "Payment pending: ads will go once it's complete.")
                    else -> {}
                }
            }
            BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED -> {
                prefs(c).edit().putBoolean(KEY, true).apply()
                toast(c, "Already bought: ads are removed.")
                onBought?.invoke()
                onBought = null
            }
            BillingClient.BillingResponseCode.USER_CANCELED -> {}
            else -> {
                AppLog.i("RemoveAds", "Purchase: ${result.responseCode} ${result.debugMessage}")
                toast(c, "The purchase didn't go through. Please try again.")
            }
        }
    }

    /** Play refunds a purchase not acknowledged within 3 days. */
    private fun acknowledge(p: Purchase) {
        if (p.isAcknowledged) return
        client?.acknowledgePurchase(AcknowledgePurchaseParams.newBuilder().setPurchaseToken(p.purchaseToken).build()) { r ->
            if (r.responseCode != BillingClient.BillingResponseCode.OK) AppLog.i("RemoveAds", "Acknowledge: ${r.debugMessage}")
        }
    }

    private fun toast(c: Context, text: String) {
        main.post { android.widget.Toast.makeText(c, text, android.widget.Toast.LENGTH_LONG).show() }
    }
}
