package org.research4life.portal;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Updates from inside the app: every build publishes version.json and DermScholar.apk to
 * the fixed "dermscholar-latest" release. A newer versionCode is offered in the app; the APK
 * downloads into the cache and Android's installer opens (it installs over this one, keeping
 * the library, because every build is signed with the same key).
 */
final class Updater {
    static final String BASE = "https://github.com/drdilips1/bytewatch-stremio-addon/releases/download/dermscholar-latest";

    interface Progress { void onProgress(int pct); }

    private Updater() {}

    static long currentCode(Context ctx) {
        try {
            android.content.pm.PackageInfo i = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            return Build.VERSION.SDK_INT >= 28 ? i.getLongVersionCode() : i.versionCode;
        } catch (Exception e) {
            return 0;
        }
    }

    /** The latest published build {versionCode, versionName}. Call off the main thread. */
    static JSONObject latest() throws Exception {
        HttpURLConnection c = open(BASE + "/version.json?t=" + System.currentTimeMillis() / 60_000);
        try {
            if (c.getResponseCode() != 200) throw new java.io.IOException("HTTP " + c.getResponseCode());
            try (InputStream in = c.getInputStream()) {
                java.io.ByteArrayOutputStream b = new java.io.ByteArrayOutputStream();
                byte[] buf = new byte[4096];
                for (int n; (n = in.read(buf)) > 0; ) b.write(buf, 0, n);
                return new JSONObject(b.toString("UTF-8"));
            }
        } finally {
            c.disconnect();
        }
    }

    /** Downloads the newest APK into the cache. Call off the main thread. */
    static File download(Context ctx, Progress p) throws Exception {
        File dir = new File(ctx.getCacheDir(), "updates");
        if (!dir.isDirectory() && !dir.mkdirs()) throw new java.io.IOException("No space for the update");
        File part = new File(dir, "DermScholar.apk.part");
        File apk = new File(dir, "DermScholar.apk");
        HttpURLConnection c = open(BASE + "/DermScholar.apk");
        try {
            if (c.getResponseCode() != 200) throw new java.io.IOException("Download failed (HTTP " + c.getResponseCode() + ")");
            long total = c.getContentLengthLong();
            try (InputStream in = c.getInputStream(); FileOutputStream out = new FileOutputStream(part)) {
                byte[] buf = new byte[65536];
                long done = 0;
                int last = -1;
                for (int n; (n = in.read(buf)) > 0; ) {
                    out.write(buf, 0, n);
                    done += n;
                    int pct = total > 0 ? (int) (done * 100 / total) : -1;
                    if (pct != last) { last = pct; p.onProgress(pct); }
                }
            }
        } finally {
            c.disconnect();
        }
        if (apk.exists()) apk.delete();
        if (!part.renameTo(apk)) throw new java.io.IOException("Couldn't save the update");
        return apk;
    }

    /** Opens Android's installer for the downloaded APK (asks once for "install unknown apps"). */
    static String install(Context ctx, File apk) {
        if (Build.VERSION.SDK_INT >= 26 && !ctx.getPackageManager().canRequestPackageInstalls()) {
            ctx.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.getPackageName()))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            return "permission";
        }
        Uri uri = androidx.core.content.FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".files", apk);
        ctx.startActivity(new Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK));
        return "installing";
    }

    private static HttpURLConnection open(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection(java.net.Proxy.NO_PROXY);
        c.setInstanceFollowRedirects(true); // GitHub sends release files from another host
        c.setConnectTimeout(20_000);
        c.setReadTimeout(60_000);
        c.setRequestProperty("User-Agent", "DermScholar");
        return c;
    }
}
