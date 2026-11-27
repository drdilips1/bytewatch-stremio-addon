package org.research4life.portal;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import org.json.JSONObject;

/**
 * Keeps long AI work (a Lesionaut case assessment, a debate…) alive when the user leaves the app
 * or locks the phone. Battery saving (Samsung especially) cuts a background app's network; a
 * foreground service with a notification ("Lesionaut is assessing…") keeps it, plus a short
 * wake lock so the CPU doesn't sleep mid-request.
 *
 * Answers that arrive while the screen is gone are also kept here ({@link #keep}) so the web app
 * can collect them when it comes back ({@link #take}), even if Android rebuilt the screen.
 */
public class AiKeepService extends Service {

    private static final String CHANNEL = "ai_work";
    private static final int ID = 43;
    private static final String PREFS = "ai_results";
    private static final long MAX_HOLD_MS = 15 * 60 * 1000L;

    private static int holders;
    private static String label = "";
    private PowerManager.WakeLock wake;

    /** The web app starts (on = true) or ends long AI work; the service runs while any is open. */
    static synchronized void hold(Context ctx, boolean on, String what) {
        Context app = ctx.getApplicationContext();
        if (on) {
            holders++;
            if (what != null && !what.isEmpty()) label = what;
            Intent i = new Intent(app, AiKeepService.class);
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) app.startForegroundService(i);
                else app.startService(i);
            } catch (Exception ignored) {
                // Not allowed right now (e.g. already in the background): the request still runs.
            }
        } else {
            holders = Math.max(0, holders - 1);
            if (holders == 0) app.stopService(new Intent(app, AiKeepService.class));
        }
    }

    /** Ends all holds (the web app's job list was rebuilt). */
    static synchronized void releaseAll(Context ctx) {
        holders = 0;
        ctx.getApplicationContext().stopService(new Intent(ctx.getApplicationContext(), AiKeepService.class));
    }

    /** Remembers an AI answer for request {@code id} until the web app takes it. */
    static void keep(Context ctx, String id, JSONObject event) {
        if (id == null || id.isEmpty()) return;
        SharedPreferences p = ctx.getSharedPreferences(PREFS, MODE_PRIVATE);
        SharedPreferences.Editor e = p.edit();
        long now = System.currentTimeMillis();
        // Old, never-collected answers go (a day is plenty).
        for (String k : p.getAll().keySet()) {
            try {
                if (now - new JSONObject(p.getString(k, "{}")).optLong("keptAt") > 86_400_000L) e.remove(k);
            } catch (Exception x) {
                e.remove(k);
            }
        }
        try {
            event.put("keptAt", now);
        } catch (Exception ignored) {
        }
        e.putString(id, event.toString()).apply();
    }

    /** The kept answer for {@code id} ("" if none), removed once taken. */
    static String take(Context ctx, String id) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, MODE_PRIVATE);
        String v = p.getString(id, "");
        if (!v.isEmpty()) p.edit().remove(id).apply();
        return v;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "AI at work", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification n = note();
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            else startForeground(ID, n);
        } catch (Exception e) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (wake == null) {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, getPackageName() + ":ai");
            wake.setReferenceCounted(false);
        }
        wake.acquire(MAX_HOLD_MS);
        return START_NOT_STICKY;
    }

    private Notification note() {
        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        PendingIntent open = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String app = getApplicationInfo().loadLabel(getPackageManager()).toString();
        return b.setSmallIcon(android.R.drawable.stat_sys_upload)
                .setContentTitle(app + " is " + (label.isEmpty() ? "working" : label.toLowerCase()) + "…")
                .setContentText("You can leave the app; the answer will be waiting.")
                .setContentIntent(open)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setProgress(0, 0, true)
                .build();
    }

    @Override
    public void onDestroy() {
        if (wake != null && wake.isHeld()) wake.release();
        super.onDestroy();
    }

    public void onTimeout(int startId) {
        // Android 15 limits data-sync services; long past any AI timeout, so just stop.
        stopSelf();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
