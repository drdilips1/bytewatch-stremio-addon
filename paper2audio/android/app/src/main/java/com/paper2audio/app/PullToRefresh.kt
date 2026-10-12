package com.paper2audio.app

import android.annotation.SuppressLint
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.MotionEvent
import android.view.ViewConfiguration
import android.widget.FrameLayout
import android.widget.ProgressBar
import android.widget.ScrollView

/**
 * Pull down at the top of a page to refresh: a round spinner follows the finger, and letting go
 * past the line starts [onRefresh]; call [done] when the new content is in.
 */
@SuppressLint("ViewConstructor")
class PullToRefresh(context: Context, private val scroll: ScrollView, private val onRefresh: () -> Unit) : FrameLayout(context) {
    private val d = context.resources.displayMetrics.density
    private val size = (44 * d).toInt()
    private val trigger = 80 * d
    private val slop = ViewConfiguration.get(context).scaledTouchSlop
    private var startY = 0f
    private var pulling = false
    private var refreshing = false

    private val spinner = ProgressBar(context).apply {
        isIndeterminate = true
        indeterminateTintList = ColorStateList.valueOf(Themes.color(context, R.attr.p2aAccent))
        val pad = (9 * d).toInt()
        setPadding(pad, pad, pad, pad)
        background = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(Themes.color(context, R.attr.p2aSurface))
        }
        elevation = 6 * d
        translationY = -size.toFloat() * 1.5f
        contentDescription = "Refreshing"
    }

    init {
        addView(scroll, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        addView(spinner, LayoutParams(size, size, Gravity.TOP or Gravity.CENTER_HORIZONTAL))
    }

    override fun onInterceptTouchEvent(e: MotionEvent): Boolean {
        if (refreshing) return false
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                startY = e.y
                pulling = false
            }
            MotionEvent.ACTION_MOVE -> if (scroll.scrollY == 0 && e.y - startY > slop) {
                pulling = true
                return true
            }
        }
        return false
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(e: MotionEvent): Boolean {
        if (!pulling) return super.onTouchEvent(e)
        val pull = ((e.y - startY) * 0.5f).coerceIn(0f, trigger * 1.6f)
        when (e.actionMasked) {
            MotionEvent.ACTION_MOVE -> {
                spinner.translationY = pull - size
                spinner.rotation = pull * 2
                spinner.alpha = (pull / trigger).coerceIn(0.3f, 1f)
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                pulling = false
                if (pull >= trigger && e.actionMasked == MotionEvent.ACTION_UP) {
                    refreshing = true
                    spinner.animate().translationY(16 * d).alpha(1f).setDuration(150).start()
                    onRefresh()
                } else {
                    hide()
                }
            }
        }
        return true
    }

    /** The refresh has finished. */
    fun done() {
        refreshing = false
        hide()
    }

    private fun hide() {
        spinner.animate().translationY(-size.toFloat() * 1.5f).alpha(0.3f).setDuration(200).start()
    }
}
