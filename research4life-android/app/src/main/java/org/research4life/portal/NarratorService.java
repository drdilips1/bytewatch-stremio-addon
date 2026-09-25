package org.research4life.portal;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/** Keeps read-aloud playing in the background, with Play/Pause, Next and Stop in the notification. */
public class NarratorService extends Service {

    private static final String CHANNEL = "read_aloud";
    private static final int ID = 42;
    static final String ACTION_TOGGLE = "toggle";
    static final String ACTION_NEXT = "next";
    static final String ACTION_STOP = "stop";

    private static NarratorService running;

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
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Narrator n = Narrator.get(this);
        String action = intent == null ? null : intent.getAction();
        if (ACTION_TOGGLE.equals(action)) n.toggle();
        else if (ACTION_NEXT.equals(action)) n.skip(1);
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

    private Notification build() {
        Narrator n = Narrator.get(this);
        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        PendingIntent open = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String progress = n.total() > 0 ? "Paragraph " + (n.index() + 1) + " of " + n.total() : "";
        return b.setSmallIcon(android.R.drawable.ic_lock_silent_mode_off)
                .setContentTitle(n.title().isEmpty() ? "Reading aloud" : n.title())
                .setContentText((n.isPlaying() ? "Reading · " : "Paused · ") + progress)
                .setContentIntent(open)
                .setOngoing(n.isPlaying())
                .setOnlyAlertOnce(true)
                .addAction(new Notification.Action.Builder(null, n.isPlaying() ? "Pause" : "Play", action(ACTION_TOGGLE, 1)).build())
                .addAction(new Notification.Action.Builder(null, "Next", action(ACTION_NEXT, 2)).build())
                .addAction(new Notification.Action.Builder(null, "Stop", action(ACTION_STOP, 3)).build())
                .build();
    }

    @Override
    public void onDestroy() {
        running = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
