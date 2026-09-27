package org.research4life.portal;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.drawable.Icon;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.IBinder;

/**
 * Keeps reading aloud in the background. A media session puts the controls on the lock screen
 * and makes headset / Bluetooth buttons work (play-pause, next, previous).
 */
public class NarratorService extends Service {

    private static final String CHANNEL = "read_aloud";
    private static final int ID = 42;
    static final String ACTION_TOGGLE = "toggle";
    static final String ACTION_NEXT = "next";
    static final String ACTION_PREV = "prev";
    static final String ACTION_STOP = "stop";

    private static NarratorService running;
    private MediaSession session;

    static void refresh() {
        if (running != null) running.post();
    }

    @Override
    public void onCreate() {
        super.onCreate();
        running = this;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Read aloud", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
        session = new MediaSession(this, "DermScholarReader");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { Narrator.get(NarratorService.this).resume(); }
            @Override public void onPause() { Narrator.get(NarratorService.this).pause(); }
            @Override public void onSkipToNext() { Narrator.get(NarratorService.this).skip(1); }
            @Override public void onSkipToPrevious() { Narrator.get(NarratorService.this).skip(-1); }
            @Override public void onFastForward() { Narrator.get(NarratorService.this).skip(1); }
            @Override public void onRewind() { Narrator.get(NarratorService.this).skip(-1); }
            @Override public void onStop() { Narrator.get(NarratorService.this).stop(); }
        });
        session.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Narrator n = Narrator.get(this);
        String action = intent == null ? null : intent.getAction();
        if (ACTION_TOGGLE.equals(action)) n.toggle();
        else if (ACTION_NEXT.equals(action)) n.skip(1);
        else if (ACTION_PREV.equals(action)) n.skip(-1);
        else if (ACTION_STOP.equals(action)) { n.stop(); stopSelf(); return START_NOT_STICKY; }
        Notification note = build();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(ID, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(ID, note);
        }
        return START_NOT_STICKY;
    }

    private void post() {
        getSystemService(NotificationManager.class).notify(ID, build());
    }

    private PendingIntent action(String a, int code) {
        Intent i = new Intent(this, NarratorService.class).setAction(a);
        return PendingIntent.getService(this, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification.Action act(int icon, String label, String a, int code) {
        return new Notification.Action.Builder(Icon.createWithResource(this, icon), label, action(a, code)).build();
    }

    private Notification build() {
        Narrator n = Narrator.get(this);
        String progress = n.total() > 0 ? "Paragraph " + (n.index() + 1) + " of " + n.total() : "";
        String line = n.subtitle().isEmpty() ? progress : n.subtitle();
        session.setMetadata(new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, n.title().isEmpty() ? "Reading aloud" : n.title())
                .putString(MediaMetadata.METADATA_KEY_ARTIST, line)
                .putString(MediaMetadata.METADATA_KEY_ALBUM, "DermScholar")
                .build());
        session.setPlaybackState(new PlaybackState.Builder()
                .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
                        | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS
                        | PlaybackState.ACTION_FAST_FORWARD | PlaybackState.ACTION_REWIND | PlaybackState.ACTION_STOP)
                .setState(n.isPlaying() ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                        PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1f)
                .build());

        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        PendingIntent open = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return b.setSmallIcon(android.R.drawable.ic_lock_silent_mode_off)
                .setContentTitle(n.title().isEmpty() ? "Reading aloud" : n.title())
                .setContentText((n.isPlaying() ? "" : "Paused · ") + line)
                .setContentIntent(open)
                .setDeleteIntent(action(ACTION_STOP, 4))
                .setOngoing(n.isPlaying())
                .setOnlyAlertOnce(true)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .addAction(act(android.R.drawable.ic_media_previous, "Previous", ACTION_PREV, 5))
                .addAction(act(n.isPlaying() ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                        n.isPlaying() ? "Pause" : "Play", ACTION_TOGGLE, 1))
                .addAction(act(android.R.drawable.ic_media_next, "Next", ACTION_NEXT, 2))
                .addAction(act(android.R.drawable.ic_menu_close_clear_cancel, "Stop", ACTION_STOP, 3))
                .setStyle(new Notification.MediaStyle()
                        .setMediaSession(session.getSessionToken())
                        .setShowActionsInCompactView(0, 1, 2))
                .build();
    }

    @Override
    public void onDestroy() {
        running = null;
        if (session != null) {
            session.setActive(false);
            session.release();
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
