package com.paper2audio.app

import android.app.Activity
import android.app.Dialog
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.util.LruCache
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.AbsListView
import android.widget.BaseAdapter
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.ListView
import android.widget.TextView
import java.io.File
import java.util.concurrent.Executors

/**
 * A PDF's original pages, as in Audiohub's reader (Pages / Text): the pages as printed, one under
 * another, opened near the place being read. The reflowed text stays in the reader behind it.
 */
object PdfPages {
    /** Shows [file]'s pages, starting at the page [fraction] (0..1) of the way through. */
    fun show(activity: Activity, file: File, fraction: Float) {
        // One thread for the renderer: it can't be used from two at once.
        val worker = Executors.newSingleThreadExecutor()
        val main = Handler(Looper.getMainLooper())
        val width = activity.resources.displayMetrics.widthPixels
        // Pages are drawn at most 1080 pixels wide (sharp enough, and a quarter of the memory of full
        // width on a large phone), and about four are kept: the voice engine needs the memory.
        val drawWidth = minOf(width, 1080)
        val cache = object : LruCache<Int, Bitmap>((drawWidth * drawWidth * 4 * 1.45 * 4).toInt()) {
            override fun sizeOf(key: Int, value: Bitmap) = value.byteCount
        }
        var renderer: PdfRenderer? = null
        var pfd: ParcelFileDescriptor? = null
        val dialog = Dialog(activity, android.R.style.Theme_Black_NoTitleBar_Fullscreen)
        val list = ListView(activity).apply {
            divider = android.graphics.drawable.ColorDrawable(0xFF2A2A2A.toInt())
            dividerHeight = (6 * activity.resources.displayMetrics.density).toInt()
            setBackgroundColor(0xFF1E1E1E.toInt())
        }
        val counter = TextView(activity).apply {
            setTextColor(Color.WHITE)
            textSize = 13f
            setBackgroundColor(0x99000000.toInt())
            setPadding(24, 10, 24, 10)
        }
        worker.execute {
            val opened = runCatching {
                val f = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
                pfd = f
                PdfRenderer(f)
            }.getOrNull()
            // Each page's height at the screen's width, so the list knows where everything is.
            val heights = opened?.let { r ->
                (0 until r.pageCount).map { i -> r.openPage(i).use { p -> (width.toLong() * p.height / p.width.coerceAtLeast(1)).toInt() } }
            }
            main.post {
                if (opened == null || heights == null || heights.isEmpty()) {
                    dialog.dismiss()
                    android.widget.Toast.makeText(activity, "This PDF's pages can't be shown", android.widget.Toast.LENGTH_LONG).show()
                    return@post
                }
                renderer = opened
                list.adapter = object : BaseAdapter() {
                    override fun getCount() = heights.size
                    override fun getItem(position: Int) = position
                    override fun getItemId(position: Int) = position.toLong()
                    override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
                        val iv = (convertView as? ImageView) ?: ImageView(activity).apply {
                            scaleType = ImageView.ScaleType.FIT_XY
                            setBackgroundColor(Color.WHITE)
                        }
                        iv.layoutParams = AbsListView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, heights[position])
                        iv.tag = position
                        iv.contentDescription = "Page ${position + 1}"
                        val cached = cache.get(position)
                        iv.setImageBitmap(cached)
                        if (cached == null) worker.execute {
                            val r = renderer ?: return@execute
                            val bmp = runCatching {
                                r.openPage(position).use { p ->
                                    Bitmap.createBitmap(drawWidth, (heights[position].toLong() * drawWidth / width).toInt().coerceAtLeast(1), Bitmap.Config.ARGB_8888).also {
                                        it.eraseColor(Color.WHITE)
                                        p.render(it, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                                    }
                                }
                            }.getOrNull() ?: return@execute
                            main.post {
                                cache.put(position, bmp)
                                if (iv.tag == position) iv.setImageBitmap(bmp)
                            }
                        }
                        return iv
                    }
                }
                list.setOnScrollListener(object : AbsListView.OnScrollListener {
                    override fun onScrollStateChanged(view: AbsListView, state: Int) = Unit
                    override fun onScroll(view: AbsListView, first: Int, visible: Int, total: Int) {
                        counter.text = "Page ${first + 1} of ${heights.size}"
                    }
                })
                val start = (fraction.coerceIn(0f, 1f) * (heights.size - 1)).toInt()
                list.setSelection(start)
                counter.text = "Page ${start + 1} of ${heights.size}"
            }
        }
        val root = FrameLayout(activity).apply {
            addView(list, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            addView(counter, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply {
                bottomMargin = (24 * activity.resources.displayMetrics.density).toInt()
            })
            addView(ImageButton(activity).apply {
                setImageResource(R.drawable.ic_close)
                imageTintList = android.content.res.ColorStateList.valueOf(Color.WHITE)
                setBackgroundColor(0x99000000.toInt())
                contentDescription = "Back to the text"
                setOnClickListener { dialog.dismiss() }
            }, FrameLayout.LayoutParams((48 * activity.resources.displayMetrics.density).toInt(), (48 * activity.resources.displayMetrics.density).toInt(), Gravity.TOP or Gravity.END).apply {
                val m = (16 * activity.resources.displayMetrics.density).toInt()
                setMargins(m, m * 2, m, m)
            })
        }
        dialog.setContentView(root)
        dialog.setOnDismissListener {
            worker.execute {
                runCatching { renderer?.close() }
                runCatching { pfd?.close() }
                renderer = null
            }
            worker.shutdown()
            cache.evictAll()
        }
        dialog.show()
    }
}
