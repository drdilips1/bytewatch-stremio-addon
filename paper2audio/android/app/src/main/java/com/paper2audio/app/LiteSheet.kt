package com.paper2audio.app

import android.app.Activity
import android.app.Dialog
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * The Play Store edition's menus: a sheet that slides up from the bottom, with a
 * title, and rows of icon, title and a short line of explanation.
 */
class LiteSheet(private val activity: Activity, title: String?, subtitle: String? = null) {
    class Row(
        val icon: Int?,
        val title: String,
        val subtitle: String? = null,
        val checked: Boolean = false,
        /** False keeps the sheet open (e.g. to try voices one after another). */
        val dismiss: Boolean = true,
        val action: () -> Unit,
    )

    private val dialog = Dialog(activity)
    private val body = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
    private val text = Themes.color(activity, R.attr.p2aText)
    private val muted = Themes.color(activity, R.attr.p2aMuted)
    private val accent = Themes.color(activity, R.attr.p2aAccent)
    private val surface = Themes.color(activity, R.attr.p2aSurface)
    private val surface2 = Themes.color(activity, R.attr.p2aSurface2)
    private fun dp(v: Int) = LiteUi.dp(activity, v)

    init {
        val sheet = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            background = GradientDrawable().apply {
                setColor(surface)
                val r = dp(24).toFloat()
                cornerRadii = floatArrayOf(r, r, r, r, 0f, 0f, 0f, 0f)
            }
            setPadding(0, dp(10), 0, dp(12))
        }
        // The grab handle.
        sheet.addView(View(activity).apply {
            background = GradientDrawable().apply {
                setColor(muted and 0x00FFFFFF or 0x55000000)
                cornerRadius = dp(3).toFloat()
            }
        }, LinearLayout.LayoutParams(dp(36), dp(5)).apply { gravity = Gravity.CENTER_HORIZONTAL; bottomMargin = dp(10) })
        if (title != null) {
            sheet.addView(TextView(activity).apply {
                this.text = title
                setTextColor(this@LiteSheet.text)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 19f)
                typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
                setPadding(dp(24), dp(6), dp(24), if (subtitle == null) dp(10) else dp(2))
            })
        }
        if (subtitle != null) {
            sheet.addView(TextView(activity).apply {
                this.text = subtitle
                setTextColor(muted)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 13.5f)
                setPadding(dp(24), 0, dp(24), dp(10))
            })
        }
        sheet.addView(ScrollView(activity).apply {
            isVerticalScrollBarEnabled = false
            addView(body)
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        val wrap = FrameLayout(activity).apply { addView(sheet, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM)) }
        dialog.setContentView(wrap)
        dialog.window?.apply {
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            setGravity(Gravity.BOTTOM)
            setWindowAnimations(android.R.style.Animation_InputMethod)
            addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
            setDimAmount(0.45f)
        }
        // Keep the last row above the navigation bar, and the sheet below the status bar.
        val maxHeight = (activity.resources.displayMetrics.heightPixels * 0.85f).toInt()
        wrap.post {
            if (sheet.height > maxHeight) sheet.layoutParams = FrameLayout.LayoutParams(-1, maxHeight, Gravity.BOTTOM)
        }
        if (Build.VERSION.SDK_INT >= 30) {
            sheet.setOnApplyWindowInsetsListener { v, insets ->
                val nav = insets.getInsets(WindowInsets.Type.navigationBars()).bottom
                v.setPadding(0, dp(10), 0, dp(12) + nav)
                insets
            }
        }
    }

    fun row(r: Row): LiteSheet {
        val line = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            minimumHeight = dp(60)
            setPadding(dp(20), dp(8), dp(20), dp(8))
            val ripple = TypedValue()
            activity.theme.resolveAttribute(android.R.attr.selectableItemBackground, ripple, true)
            setBackgroundResource(ripple.resourceId)
            isClickable = true
            setOnClickListener {
                if (r.dismiss) dialog.dismiss()
                r.action()
            }
        }
        if (r.icon != null) {
            line.addView(ImageView(activity).apply {
                setImageResource(r.icon)
                setColorFilter(if (r.checked) Themes.color(activity, R.attr.p2aOnAccent) else accent)
                background = GradientDrawable().apply {
                    shape = GradientDrawable.OVAL
                    setColor(if (r.checked) accent else surface2)
                }
                setPadding(dp(9), dp(9), dp(9), dp(9))
            }, LinearLayout.LayoutParams(dp(40), dp(40)).apply { marginEnd = dp(16) })
        }
        val texts = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        texts.addView(TextView(activity).apply {
            text = r.title
            setTextColor(if (r.checked) accent else this@LiteSheet.text)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            if (r.checked) typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        })
        if (r.subtitle != null) {
            texts.addView(TextView(activity).apply {
                text = r.subtitle
                setTextColor(muted)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
                maxLines = 2
                ellipsize = TextUtils.TruncateAt.END
            })
        }
        line.addView(texts, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        if (r.checked) {
            line.addView(ImageView(activity).apply {
                setImageResource(R.drawable.ic_check)
                setColorFilter(accent)
            }, LinearLayout.LayoutParams(dp(22), dp(22)))
        }
        body.addView(line)
        return this
    }

    fun row(icon: Int?, title: String, subtitle: String? = null, checked: Boolean = false, dismiss: Boolean = true, action: () -> Unit) =
        row(Row(icon, title, subtitle, checked, dismiss, action))

    /** A small heading between groups of rows. */
    fun section(label: String): LiteSheet {
        body.addView(TextView(activity).apply {
            text = label.uppercase()
            setTextColor(muted)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            letterSpacing = 0.08f
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            setPadding(dp(24), dp(14), dp(24), dp(4))
        })
        return this
    }

    /** Any other content (a slider, a progress bar). */
    fun view(v: View): LiteSheet {
        body.addView(v)
        return this
    }

    fun clear(): LiteSheet {
        body.removeAllViews()
        return this
    }

    fun onDismiss(block: () -> Unit): LiteSheet {
        dialog.setOnDismissListener { block() }
        return this
    }

    val isShowing get() = dialog.isShowing

    fun dismiss() = dialog.dismiss()

    fun show(): LiteSheet {
        if (!activity.isFinishing) dialog.show()
        return this
    }
}
