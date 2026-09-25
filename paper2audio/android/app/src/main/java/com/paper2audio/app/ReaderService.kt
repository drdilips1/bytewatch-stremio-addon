package com.paper2audio.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.os.Build
import android.os.IBinder

/**
 * Keeps reading (and saving) going with the screen off, and shows playback
 * controls in the notification shade and on the lock screen.
 */
class ReaderService : Service() {
    companion object {
        private const val CHANNEL = "playback"
        private const val NOTIFICATION_ID = 1
        private const val ACTION_TOGGLE = "toggle"
        private const val ACTION_NEXT = "next"
        private const val ACTION_PREV = "prev"
        private const val ACTION_CLOSE = "close"

        fun start(context: Context) {
            runCatching { context.startForegroundService(Intent(context, ReaderService::class.java)) }
        }
    }

    private val refresh: () -> Unit = { update() }
    private var foreground = false

    override fun onCreate() {
        super.onCreate()
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, "Playback", NotificationManager.IMPORTANCE_LOW).apply {
                setShowBadge(false)
            }
        )
        Speaker.addListener(refresh)
        Exporter.addListener(refresh)
        ModelPack.addListener(refresh)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_TOGGLE -> Speaker.toggle()
            ACTION_NEXT -> Speaker.next()
            ACTION_PREV -> Speaker.previous()
            ACTION_CLOSE -> {
                Speaker.pause()
                if (!Exporter.running && ModelPack.active == null) {
                    stopForeground(STOP_FOREGROUND_REMOVE)
                    stopSelf()
                    return START_NOT_STICKY
                }
            }
        }
        goForeground()
        return START_NOT_STICKY
    }

    private fun goForeground() {
        val n = build()
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(
                NOTIFICATION_ID, n,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK or ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
            )
        } else {
            startForeground(NOTIFICATION_ID, n)
        }
        foreground = true
    }

    private fun update() {
        if (foreground) getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, build())
    }

    private fun action(icon: Int, title: String, action: String): Notification.Action {
        val pi = PendingIntent.getService(
            this, action.hashCode(), Intent(this, ReaderService::class.java).setAction(action),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return Notification.Action.Builder(Icon.createWithResource(this, icon), title, pi).build()
    }

    private fun build(): Notification {
        val doc = Speaker.doc
        val open = PendingIntent.getActivity(
            this, 0,
            Intent(this, PlayerActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val text = when {
            Exporter.running -> Exporter.message ?: "Saving audio…"
            ModelPack.active != null -> ModelPack.active?.message ?: "Downloading voices…"
            doc == null -> "Nothing loaded"
            else -> {
                val chapter = doc.chapterAt(Speaker.index)?.title?.let { "$it · " } ?: ""
                "$chapter${Speaker.index + 1} / ${doc.paragraphs.size}"
            }
        }
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(doc?.title ?: getString(R.string.app_name))
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(Speaker.playing || Exporter.running || ModelPack.active != null)
            .apply {
                if (Exporter.running) setProgress(100, Exporter.progress, Exporter.progress == 0)
                else ModelPack.active?.let { setProgress(100, it.progress, it.progress == 0) }
            }
            .setOnlyAlertOnce(true)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .addAction(action(R.drawable.ic_prev, "Previous", ACTION_PREV))
            .addAction(
                if (Speaker.playing) action(R.drawable.ic_pause, "Pause", ACTION_TOGGLE)
                else action(R.drawable.ic_play, "Play", ACTION_TOGGLE)
            )
            .addAction(action(R.drawable.ic_next, "Next", ACTION_NEXT))
            .addAction(action(R.drawable.ic_close, "Close", ACTION_CLOSE))
            .setStyle(Notification.MediaStyle().setShowActionsInCompactView(0, 1, 2))
            .build()
    }

    override fun onDestroy() {
        Speaker.removeListener(refresh)
        Exporter.removeListener(refresh)
        ModelPack.removeListener(refresh)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
