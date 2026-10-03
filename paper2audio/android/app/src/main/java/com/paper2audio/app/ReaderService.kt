package com.paper2audio.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.graphics.BitmapFactory
import android.graphics.drawable.Icon
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.IBinder

/**
 * Keeps reading (and saving) going with the screen off, and shows playback controls in the
 * notification shade and on the lock screen through a media session, which also takes the
 * buttons of headphones, car stereos and watches. Unplugging headphones pauses.
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
    private lateinit var session: MediaSession
    private var artFor: String? = null
    private var art: android.graphics.Bitmap? = null

    private val noisy = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY && Speaker.playing) Speaker.pause()
        }
    }

    override fun onCreate() {
        super.onCreate()
        session = MediaSession(this, "Paper2Audio").apply {
            setCallback(object : MediaSession.Callback() {
                override fun onPlay() = Speaker.play()
                override fun onPause() = Speaker.pause()
                override fun onStop() = Speaker.pause()
                override fun onSkipToNext() = Speaker.next()
                override fun onSkipToPrevious() = Speaker.previousSentence()
                override fun onFastForward() = Speaker.next()
                override fun onRewind() = Speaker.previousSentence()
                override fun onSeekTo(pos: Long) {
                    // The position is in "paragraph" units (see [state]).
                    Speaker.seek((pos / 1000).toInt())
                }
            })
            setSessionActivity(
                PendingIntent.getActivity(
                    this@ReaderService, 1,
                    Intent(this@ReaderService, PlayerActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                    PendingIntent.FLAG_IMMUTABLE,
                )
            )
            isActive = true
        }
        val filter = IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY)
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(noisy, filter, Context.RECEIVER_NOT_EXPORTED) else registerReceiver(noisy, filter)
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, "Playback", NotificationManager.IMPORTANCE_LOW).apply {
                setShowBadge(false)
            }
        )
        Speaker.addListener(refresh)
        Exporter.addListener(refresh)
        ModelPack.addListener(refresh)
        Versions.addListener(refresh)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_TOGGLE -> Speaker.toggle()
            ACTION_NEXT -> Speaker.nextSentence()
            ACTION_PREV -> Speaker.previousSentence()
            ACTION_CLOSE -> {
                Speaker.pause()
                if (!Exporter.running && ModelPack.active == null && !Versions.running) {
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
        updateSession()
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
        updateSession()
        if (foreground) getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, build())
    }

    /** What the lock screen, car stereo or watch shows: title, chapter, cover and play state. */
    private fun updateSession() {
        val doc = Speaker.doc
        val actions = PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or
            PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SKIP_TO_PREVIOUS or PlaybackState.ACTION_STOP or
            PlaybackState.ACTION_FAST_FORWARD or PlaybackState.ACTION_REWIND or PlaybackState.ACTION_SEEK_TO
        session.setPlaybackState(
            PlaybackState.Builder()
                .setActions(actions)
                .setState(
                    if (Speaker.playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED,
                    Speaker.index * 1000L, if (Speaker.playing) 1f else 0f,
                )
                .build()
        )
        if (doc != null && artFor != doc.key) {
            artFor = doc.key
            art = runCatching { BitmapFactory.decodeFile(Library.thumb(this, doc.key).path) }.getOrNull()
        }
        session.setMetadata(
            MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, doc?.title ?: getString(R.string.app_name))
                .putString(MediaMetadata.METADATA_KEY_ARTIST, doc?.author ?: doc?.chapterAt(Speaker.index)?.title ?: "")
                .putString(MediaMetadata.METADATA_KEY_ALBUM, doc?.chapterAt(Speaker.index)?.title ?: "")
                .putLong(MediaMetadata.METADATA_KEY_DURATION, (doc?.paragraphs?.size ?: 0) * 1000L)
                .apply { art?.let { putBitmap(MediaMetadata.METADATA_KEY_ART, it) } }
                .build()
        )
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
            Versions.running -> Versions.message ?: "Making a new version…"
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
            .setOngoing(Speaker.playing || Exporter.running || ModelPack.active != null || Versions.running)
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
            .setStyle(Notification.MediaStyle().setMediaSession(session.sessionToken).setShowActionsInCompactView(0, 1, 2))
            .build()
    }

    override fun onDestroy() {
        runCatching { unregisterReceiver(noisy) }
        session.isActive = false
        session.release()
        Speaker.removeListener(refresh)
        Exporter.removeListener(refresh)
        ModelPack.removeListener(refresh)
        Versions.removeListener(refresh)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
