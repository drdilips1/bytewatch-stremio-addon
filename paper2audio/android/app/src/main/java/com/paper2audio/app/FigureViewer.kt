package com.paper2audio.app

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/** Shows the PDF page a figure or table is on, zoomable, with its caption, while listening goes on. */
object FigureViewer {
    fun show(activity: Activity, scope: CoroutineScope, pdf: File, figure: Figure) {
        val d = activity.resources.displayMetrics
        val image = ZoomImageView(activity).apply { setBackgroundColor(Color.WHITE) }
        val box = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            addView(image, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (d.heightPixels * 0.62).toInt()))
            if (figure.caption.isNotBlank()) {
                addView(TextView(activity).apply {
                    text = figure.caption
                    textSize = 14f
                    setTextColor(Themes.color(activity, R.attr.p2aText))
                    setPadding((18 * d.density).toInt(), (10 * d.density).toInt(), (18 * d.density).toInt(), 0)
                })
            }
        }
        AlertDialog.Builder(activity)
            .setTitle("${figure.label} · page ${figure.page}")
            .setView(box)
            .setPositiveButton("Close", null)
            .show()
        scope.launch {
            val bmp = withContext(Dispatchers.IO) { runCatching { renderPage(pdf, figure.page, d.widthPixels * 2) }.getOrNull() }
            if (bmp != null) image.setImageBitmap(bmp)
        }
    }

    fun renderPage(pdf: File, page: Int, width: Int): Bitmap {
        val pfd = ParcelFileDescriptor.open(pdf, ParcelFileDescriptor.MODE_READ_ONLY)
        val renderer = PdfRenderer(pfd)
        try {
            return renderer.openPage((page - 1).coerceIn(0, renderer.pageCount - 1)).use { p ->
                val height = (width.toLong() * p.height / p.width.coerceAtLeast(1)).toInt().coerceIn(1, width * 3)
                Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).also {
                    it.eraseColor(Color.WHITE)
                    p.render(it, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                }
            }
        } finally {
            renderer.close()
            pfd.close()
        }
    }
}

/** An image you can pinch to zoom, drag, and double-tap to zoom in or reset. */
@SuppressLint("ClickableViewAccessibility")
class ZoomImageView(context: Context) : ImageView(context) {
    private val m = Matrix()
    private var scale = 1f
    private var base = 1f

    private val scaler = ScaleGestureDetector(context, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
        override fun onScale(det: ScaleGestureDetector): Boolean {
            val f = det.scaleFactor
            val next = (scale * f).coerceIn(1f, 6f)
            m.postScale(next / scale, next / scale, det.focusX, det.focusY)
            scale = next
            imageMatrix = m
            return true
        }
    })
    private val gestures = GestureDetector(context, object : GestureDetector.SimpleOnGestureListener() {
        override fun onScroll(e1: MotionEvent?, e2: MotionEvent, dx: Float, dy: Float): Boolean {
            m.postTranslate(-dx, -dy)
            imageMatrix = m
            return true
        }

        override fun onDoubleTap(e: MotionEvent): Boolean {
            if (scale > 1.5f) fit() else {
                m.postScale(2.5f, 2.5f, e.x, e.y)
                scale = 2.5f
                imageMatrix = m
            }
            return true
        }
    })

    init {
        scaleType = ScaleType.MATRIX
        setOnTouchListener { _, ev ->
            scaler.onTouchEvent(ev)
            gestures.onTouchEvent(ev)
            true
        }
    }

    override fun setImageBitmap(bm: Bitmap?) {
        super.setImageBitmap(bm)
        post { fit() }
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        fit()
    }

    /** Fits the whole page into the view. */
    private fun fit() {
        val dr = drawable ?: return
        if (width == 0 || height == 0) return
        base = minOf(width.toFloat() / dr.intrinsicWidth, height.toFloat() / dr.intrinsicHeight)
        m.reset()
        m.postScale(base, base)
        m.postTranslate((width - dr.intrinsicWidth * base) / 2, (height - dr.intrinsicHeight * base) / 2)
        scale = 1f
        imageMatrix = m
    }
}
