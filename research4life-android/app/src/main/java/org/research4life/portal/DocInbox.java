package org.research4life.portal;

import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Documents coming into the app that aren't PDFs (EPUB, Word, text, Markdown, web pages,
 * photos). They are copied into private storage and served to the web app at /import/<key>,
 * where they are parsed into the reading model.
 */
final class DocInbox {

    static final String PREFIX = "/import/";
    private static final long MAX_BYTES = 60L * 1024 * 1024;

    private DocInbox() {}

    static File dir(Context ctx) {
        File d = new File(ctx.getFilesDir(), "imports");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    static File file(Context ctx, String key) {
        return new File(dir(ctx), PdfStore.safeKey(key));
    }

    static String displayName(Context ctx, Uri uri) {
        try (Cursor c = ctx.getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst() && c.getString(0) != null) return c.getString(0);
        } catch (Exception ignored) {
        }
        String last = uri.getLastPathSegment();
        return last == null ? "Document" : last;
    }

    /** Best guess at the type, from the provider, then the file name. */
    static String mimeOf(Context ctx, Uri uri, String name, String hint) {
        String m = null;
        try {
            m = ctx.getContentResolver().getType(uri);
        } catch (Exception ignored) {
        }
        if (m == null || m.equals("application/octet-stream")) {
            String ext = MimeTypeMap.getFileExtensionFromUrl(name.replace(' ', '_')).toLowerCase(Locale.ROOT);
            if (ext.equals("md") || ext.equals("markdown")) return "text/markdown";
            if (ext.equals("epub")) return "application/epub+zip";
            if (ext.equals("docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
            String guess = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
            if (guess != null) m = guess;
        }
        if (m == null) m = hint;
        return m == null ? "application/octet-stream" : m;
    }

    static void copy(Context ctx, Uri uri, String key) throws IOException {
        File target = file(ctx, key);
        long total = 0;
        try (InputStream in = ctx.getContentResolver().openInputStream(uri);
             OutputStream out = new FileOutputStream(target)) {
            if (in == null) throw new IOException("Cannot open file");
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > MAX_BYTES) throw new IOException("File is larger than 60 MB");
                out.write(buf, 0, n);
            }
        } catch (IOException e) {
            target.delete();
            throw e;
        }
    }

    /** Downloads a web page the user asked to read. Returns the content type. */
    static String fetch(Context ctx, String url, String key) throws IOException {
        HttpURLConnection conn = null;
        try {
            URL u = new URL(url);
            for (int hop = 0; hop < 6; hop++) {
                conn = (HttpURLConnection) u.openConnection();
                conn.setInstanceFollowRedirects(false);
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(30000);
                conn.setRequestProperty("User-Agent",
                        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36");
                conn.setRequestProperty("Accept", "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8");
                int code = conn.getResponseCode();
                if (code >= 300 && code < 400 && conn.getHeaderField("Location") != null) {
                    u = new URL(u, conn.getHeaderField("Location"));
                    conn.disconnect();
                    continue;
                }
                if (code >= 400) throw new IOException("The site returned " + code);
                break;
            }
            String type = conn.getContentType();
            File target = file(ctx, key);
            long total = 0;
            try (InputStream in = conn.getInputStream(); OutputStream out = new FileOutputStream(target)) {
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) > 0) {
                    total += n;
                    if (total > MAX_BYTES) throw new IOException("Page is too large");
                    out.write(buf, 0, n);
                }
            }
            ctx.getSharedPreferences("imports", Context.MODE_PRIVATE).edit()
                    .putString(key + ".type", type == null ? "text/html" : type)
                    .putString(key + ".url", u.toString()).apply();
            return type == null ? "text/html" : type;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    static void remember(Context ctx, String key, String mime) {
        ctx.getSharedPreferences("imports", Context.MODE_PRIVATE).edit().putString(key + ".type", mime).apply();
    }

    static String finalUrl(Context ctx, String key) {
        return ctx.getSharedPreferences("imports", Context.MODE_PRIVATE).getString(key + ".url", "");
    }

    static void delete(Context ctx, String key) {
        file(ctx, key).delete();
        ctx.getSharedPreferences("imports", Context.MODE_PRIVATE).edit()
                .remove(key + ".type").remove(key + ".url").apply();
    }

    static WebResourceResponse serve(Context ctx, String key) {
        File f = key == null ? null : file(ctx, key);
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        try {
            if (f == null || !f.exists()) throw new IOException("missing");
            String type = ctx.getSharedPreferences("imports", Context.MODE_PRIVATE)
                    .getString(key + ".type", "application/octet-stream");
            String mime = type.split(";")[0].trim();
            String charset = null;
            for (String part : type.split(";")) {
                String p = part.trim().toLowerCase(Locale.ROOT);
                if (p.startsWith("charset=")) charset = p.substring(8).replace("\"", "");
            }
            return new WebResourceResponse(mime, charset, 200, "OK", headers, new FileInputStream(f));
        } catch (IOException e) {
            return new WebResourceResponse("text/plain", "UTF-8", 404, "Not found", headers,
                    new ByteArrayInputStream(new byte[0]));
        }
    }
}
