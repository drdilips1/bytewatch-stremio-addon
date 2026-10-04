package org.research4life.portal;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.webkit.CookieManager;

import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Iterator;

/** PDFs kept in the app's private storage, indexed by article key. */
final class PdfStore {

    private static final String PREFS = "pdf_index";
    private static final int MAX_REDIRECTS = 8;

    private PdfStore() {}

    static String safeKey(String key) {
        return key.replaceAll("[^A-Za-z0-9_.-]", "_");
    }

    static File dir(Context ctx) {
        File d = new File(ctx.getFilesDir(), "pdfs");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    static File file(Context ctx, String key) {
        return new File(dir(ctx), safeKey(key) + ".pdf");
    }

    static boolean has(Context ctx, String key) {
        return file(ctx, key).exists();
    }

    static Uri shareUri(Context ctx, String key) {
        return FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".files", file(ctx, key));
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static synchronized JSONArray list(Context ctx) {
        JSONArray out = new JSONArray();
        SharedPreferences p = prefs(ctx);
        for (String key : p.getAll().keySet()) {
            try {
                JSONObject o = new JSONObject(p.getString(key, "{}"));
                if (!file(ctx, key).exists()) continue;
                o.put("key", key);
                out.put(o);
            } catch (JSONException ignored) {
            }
        }
        return out;
    }

    static String title(Context ctx, String key) {
        try {
            return new JSONObject(prefs(ctx).getString(key, "{}")).optString("title", "Document");
        } catch (JSONException e) {
            return "Document";
        }
    }

    private static synchronized void record(Context ctx, String key, String title, String source) {
        try {
            JSONObject o = new JSONObject();
            o.put("title", title == null || title.isEmpty() ? "Document" : title);
            o.put("size", file(ctx, key).length());
            o.put("added", System.currentTimeMillis());
            o.put("source", source == null ? "" : source);
            prefs(ctx).edit().putString(key, o.toString()).apply();
        } catch (JSONException ignored) {
        }
    }

    static synchronized void delete(Context ctx, String key) {
        file(ctx, key).delete();
        prefs(ctx).edit().remove(key).apply();
    }

    static long totalBytes(Context ctx) {
        long total = 0;
        File[] files = dir(ctx).listFiles();
        if (files != null) for (File f : files) total += f.length();
        return total;
    }

    /** Removes index entries whose file is gone. */
    static synchronized void prune(Context ctx) {
        SharedPreferences p = prefs(ctx);
        SharedPreferences.Editor e = p.edit();
        Iterator<String> it = p.getAll().keySet().iterator();
        while (it.hasNext()) {
            String key = it.next();
            if (!file(ctx, key).exists()) e.remove(key);
        }
        e.apply();
    }

    /**
     * Downloads {@code url} into the store, sending the WebView's cookies so publisher
     * sessions (e.g. Research4Life sign-in) apply. Blocking; call off the main thread.
     */
    static void download(Context ctx, String key, String url, String title, String userAgent)
            throws IOException {
        HttpURLConnection conn = null;
        String current = url;
        for (int i = 0; i < MAX_REDIRECTS; i++) {
            conn = (HttpURLConnection) new URL(current).openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(20000);
            conn.setReadTimeout(60000);
            conn.setRequestProperty("Accept", "application/pdf,*/*");
            if (userAgent != null) conn.setRequestProperty("User-Agent", userAgent);
            String cookie = CookieManager.getInstance().getCookie(current);
            if (cookie != null) conn.setRequestProperty("Cookie", cookie);
            int code = conn.getResponseCode();
            if (code >= 300 && code < 400) {
                String location = conn.getHeaderField("Location");
                conn.disconnect();
                if (location == null) throw new IOException("Redirect without location");
                current = new URL(new URL(current), location).toString();
                continue;
            }
            if (code != 200) {
                conn.disconnect();
                throw new IOException("Server returned " + code);
            }
            break;
        }
        if (conn == null) throw new IOException("Too many redirects");

        File target = file(ctx, key);
        File tmp = new File(target.getPath() + ".part");
        try (InputStream in = conn.getInputStream(); OutputStream out = new FileOutputStream(tmp)) {
            byte[] buf = new byte[16384];
            int n;
            boolean first = true;
            while ((n = in.read(buf)) > 0) {
                if (first) {
                    first = false;
                    if (!startsWithPdfMagic(buf, n)) {
                        throw new IOException("NOT_PDF");
                    }
                }
                out.write(buf, 0, n);
            }
        } catch (IOException e) {
            tmp.delete();
            throw e;
        } finally {
            conn.disconnect();
        }
        if (!tmp.renameTo(target)) throw new IOException("Could not save file");
        record(ctx, key, title, url);
    }

    static void importFrom(Context ctx, Uri uri, String key, String title) throws IOException {
        File target = file(ctx, key);
        try (InputStream in = ctx.getContentResolver().openInputStream(uri);
             OutputStream out = new FileOutputStream(target)) {
            if (in == null) throw new IOException("Cannot open file");
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        }
        record(ctx, key, title, "import");
    }

    private static boolean startsWithPdfMagic(byte[] buf, int n) {
        // Some servers prepend whitespace or a BOM; look for %PDF in the first 1 KB.
        int limit = Math.min(n, 1024) - 4;
        for (int i = 0; i <= limit; i++) {
            if (buf[i] == '%' && buf[i + 1] == 'P' && buf[i + 2] == 'D' && buf[i + 3] == 'F') return true;
        }
        return false;
    }
}
