package app.inkwell.books;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Iterator;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Offline downloads for audiobook files. Saves either to the public
 * Downloads/Inkwell folder (visible in the file manager, kept after uninstall)
 * or to the app's own storage. Returns a URI the native player can open.
 */
@CapacitorPlugin(name = "InkwellDownloads")
public class InkwellDownloadsPlugin extends Plugin {

    private final ExecutorService queue = Executors.newSingleThreadExecutor();
    private final Set<String> cancelled = ConcurrentHashMap.newKeySet();

    @PluginMethod
    public void publicAvailable(PluginCall call) {
        JSObject r = new JSObject();
        r.put("available", Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q);
        call.resolve(r);
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String job = call.getString("job");
        if (job != null) cancelled.add(job);
        call.resolve();
    }

    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url");
        String name = call.getString("name", "audio.mp3");
        String folder = call.getString("folder", "Inkwell");
        String target = call.getString("target", "public");
        String job = call.getString("job", "");
        String mime = call.getString("mime", "audio/mpeg");
        if (url == null) {
            call.reject("Missing url");
            return;
        }
        call.setKeepAlive(true);
        queue.execute(() -> {
            Uri outUri = null;
            File outFile = null;
            HttpURLConnection conn = null;
            try {
                if (cancelled.contains(job)) throw new InterruptedException("cancelled");
                // Connect, following redirects across hosts (debrid CDNs do this).
                String current = url;
                for (int i = 0; i < 8; i++) {
                    conn = (HttpURLConnection) new URL(current).openConnection();
                    conn.setInstanceFollowRedirects(false);
                    conn.setConnectTimeout(20000);
                    conn.setReadTimeout(60000);
                    conn.setRequestProperty("User-Agent", "Inkwell/1.0 (Android)");
                    JSObject headers = call.getObject("headers");
                    if (headers != null && i == 0) {
                        Iterator<String> keys = headers.keys();
                        while (keys.hasNext()) {
                            String k = keys.next();
                            conn.setRequestProperty(k, headers.optString(k));
                        }
                    }
                    int code = conn.getResponseCode();
                    if (code >= 300 && code < 400 && conn.getHeaderField("Location") != null) {
                        current = new URL(new URL(current), conn.getHeaderField("Location")).toString();
                        conn.disconnect();
                        continue;
                    }
                    if (code != 200) throw new Exception("Download failed (HTTP " + code + ")");
                    break;
                }
                long total = conn.getContentLengthLong();

                OutputStream out;
                boolean usePublic = "public".equals(target) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q;
                if (usePublic) {
                    ContentResolver cr = getContext().getContentResolver();
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Downloads.DISPLAY_NAME, name);
                    v.put(MediaStore.Downloads.MIME_TYPE, mime);
                    v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/" + folder);
                    v.put(MediaStore.Downloads.IS_PENDING, 1);
                    outUri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    if (outUri == null) throw new Exception("Could not create the file in Downloads");
                    out = cr.openOutputStream(outUri);
                } else {
                    File base = getContext().getExternalFilesDir(null);
                    if (base == null) base = getContext().getFilesDir();
                    File dir = new File(new File(base, "downloads"), folder);
                    //noinspection ResultOfMethodCallIgnored
                    dir.mkdirs();
                    outFile = new File(dir, name);
                    out = new FileOutputStream(outFile);
                }
                if (out == null) throw new Exception("Could not open the output file");

                long got = 0;
                long lastEmit = 0;
                try (InputStream in = new BufferedInputStream(conn.getInputStream(), 1 << 16); OutputStream o = out) {
                    byte[] buf = new byte[1 << 16];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        if (cancelled.contains(job)) throw new InterruptedException("cancelled");
                        o.write(buf, 0, n);
                        got += n;
                        long now = System.currentTimeMillis();
                        if (now - lastEmit > 500) {
                            lastEmit = now;
                            JSObject p = new JSObject();
                            p.put("job", job);
                            p.put("name", name);
                            p.put("received", got);
                            p.put("total", total);
                            notifyListeners("progress", p);
                        }
                    }
                }
                if (usePublic) {
                    ContentValues done = new ContentValues();
                    done.put(MediaStore.Downloads.IS_PENDING, 0);
                    getContext().getContentResolver().update(outUri, done, null, null);
                }
                JSObject r = new JSObject();
                r.put("uri", usePublic ? outUri.toString() : "file://" + outFile.getAbsolutePath());
                r.put("size", got);
                r.put("location", usePublic ? "Downloads/" + folder : "App storage");
                call.resolve(r);
            } catch (Throwable e) {
                try {
                    if (outUri != null) getContext().getContentResolver().delete(outUri, null, null);
                } catch (Exception ignored) {}
                //noinspection ResultOfMethodCallIgnored
                if (outFile != null) outFile.delete();
                call.reject(e instanceof InterruptedException ? "cancelled" : e.getMessage() != null ? e.getMessage() : e.toString());
            } finally {
                if (conn != null) conn.disconnect();
                call.setKeepAlive(false);
            }
        });
    }

    @PluginMethod
    public void move(PluginCall call) {
        // Move a file this app downloaded into another folder (sorting old downloads).
        String uri = call.getString("uri", "");
        String folder = call.getString("folder", "Audiohub");
        try {
            JSObject r = new JSObject();
            if (uri.startsWith("content://") && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/" + folder);
                if (getContext().getContentResolver().update(Uri.parse(uri), v, null, null) < 1) throw new Exception("Android didn't move it");
                r.put("uri", uri); // same file, new folder
                r.put("location", "Downloads/" + folder);
            } else if (uri.startsWith("file://")) {
                File f = new File(Uri.parse(uri).getPath());
                File base = getContext().getExternalFilesDir(null);
                if (base == null) base = getContext().getFilesDir();
                File dir = new File(new File(base, "downloads"), folder);
                //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
                File to = new File(dir, f.getName());
                if (!f.getAbsolutePath().equals(to.getAbsolutePath())) {
                    if (!f.renameTo(to)) throw new Exception("Couldn't move the file");
                    File parent = f.getParentFile();
                    String[] left = parent != null ? parent.list() : null;
                    //noinspection ResultOfMethodCallIgnored
                    if (parent != null && left != null && left.length == 0) parent.delete();
                }
                r.put("uri", "file://" + to.getAbsolutePath());
                r.put("location", "App storage");
            } else throw new Exception("Not a downloaded file");
            call.resolve(r);
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : e.toString());
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String uri = call.getString("uri", "");
        try {
            if (uri.startsWith("content://")) {
                getContext().getContentResolver().delete(Uri.parse(uri), null, null);
            } else if (uri.startsWith("file://")) {
                File f = new File(Uri.parse(uri).getPath());
                //noinspection ResultOfMethodCallIgnored
                f.delete();
                File parent = f.getParentFile();
                String[] left = parent != null ? parent.list() : null;
                //noinspection ResultOfMethodCallIgnored
                if (parent != null && left != null && left.length == 0) parent.delete();
            }
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    // ---------------------------------------------------------------- Audiobookshelf upload

    private final ExecutorService uploads = Executors.newSingleThreadExecutor();

    /**
     * Upload downloaded files into an Audiobookshelf library folder (its /api/upload): streamed
     * from storage, never held in memory. { url, token, fields: { title, author, series,
     * library, folder }, files: [{ uri, name, size }], job } → progress events "uploadProgress".
     */
    @PluginMethod
    public void uploadAbs(PluginCall call) {
        String url = call.getString("url");
        String token = call.getString("token", "");
        JSObject fields = call.getObject("fields", new JSObject());
        JSArray files = call.getArray("files", new JSArray());
        String job = call.getString("job", "");
        if (url == null || files.length() == 0) {
            call.reject("Nothing to upload");
            return;
        }
        uploads.execute(() -> {
            HttpURLConnection conn = null;
            try {
                long total = 0;
                for (int i = 0; i < files.length(); i++) total += files.getJSONObject(i).optLong("size", 0);
                String boundary = "----Audiohub" + System.currentTimeMillis();
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setRequestMethod("POST");
                conn.setDoOutput(true);
                conn.setConnectTimeout(20000);
                conn.setReadTimeout(10 * 60 * 1000); // the server writes the files before answering
                conn.setChunkedStreamingMode(256 * 1024);
                conn.setRequestProperty("Authorization", "Bearer " + token);
                conn.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
                OutputStream out = conn.getOutputStream();
                byte[] crlf = "\r\n".getBytes("UTF-8");
                for (Iterator<String> k = fields.keys(); k.hasNext(); ) {
                    String name = k.next();
                    String value = fields.optString(name, "");
                    if (value.isEmpty()) continue;
                    out.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + name + "\"\r\n\r\n").getBytes("UTF-8"));
                    out.write(value.getBytes("UTF-8"));
                    out.write(crlf);
                }
                long sent = 0;
                long lastNote = 0;
                byte[] buf = new byte[128 * 1024];
                for (int i = 0; i < files.length(); i++) {
                    org.json.JSONObject f = files.getJSONObject(i);
                    String uri = f.optString("uri");
                    String fname = f.optString("name", "part" + (i + 1)).replace("\"", "'");
                    out.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + i + "\"; filename=\"" + fname + "\"\r\nContent-Type: application/octet-stream\r\n\r\n").getBytes("UTF-8"));
                    try (InputStream in = open(uri)) {
                        int n;
                        while ((n = in.read(buf)) > 0) {
                            if (cancelled.contains(job)) throw new Exception("cancelled");
                            out.write(buf, 0, n);
                            sent += n;
                            long now = System.currentTimeMillis();
                            if (now - lastNote > 700) {
                                lastNote = now;
                                JSObject e = new JSObject();
                                e.put("job", job);
                                e.put("sent", sent);
                                e.put("total", total);
                                notifyListeners("uploadProgress", e);
                            }
                        }
                    }
                    out.write(crlf);
                }
                out.write(("--" + boundary + "--\r\n").getBytes("UTF-8"));
                out.flush();
                out.close();
                int code = conn.getResponseCode();
                if (code >= 400) {
                    String msg = "";
                    try (InputStream es = conn.getErrorStream()) {
                        if (es != null) msg = new String(readAll(es), "UTF-8").trim();
                    } catch (Exception ignored) {}
                    if (code == 403) msg = "your Audiobookshelf user isn't allowed to upload (Settings → Users → Can upload)" + (msg.isEmpty() ? "" : " — " + msg);
                    call.reject("Audiobookshelf said HTTP " + code + (msg.isEmpty() ? "" : ": " + (msg.length() > 200 ? msg.substring(0, 200) : msg)));
                    return;
                }
                JSObject r = new JSObject();
                r.put("sent", sent);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("cancelled".equals(e.getMessage()) ? "cancelled" : "Upload failed: " + e.getMessage());
            } finally {
                if (conn != null) conn.disconnect();
                cancelled.remove(job);
            }
        });
    }

    private InputStream open(String uri) throws Exception {
        if (uri.startsWith("content:")) {
            InputStream in = getContext().getContentResolver().openInputStream(Uri.parse(uri));
            if (in == null) throw new Exception("can't open " + uri);
            return new BufferedInputStream(in);
        }
        String path = uri.startsWith("file:") ? Uri.parse(uri).getPath() : uri;
        return new BufferedInputStream(new FileInputStream(path));
    }

    private static byte[] readAll(InputStream in) throws Exception {
        java.io.ByteArrayOutputStream b = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0 && b.size() < 4096) b.write(buf, 0, n);
        return b.toByteArray();
    }

    // ---------------------------------------------------------------- unpack archives

    private final ExecutorService unpacks = Executors.newSingleThreadExecutor();
    private static final java.util.regex.Pattern KEEP = java.util.regex.Pattern.compile("(?i).*\\.(mp3|m4b|m4a|aac|ogg|oga|opus|flac|wav|wma|epub|pdf|jpg|jpeg|png)$");

    /**
     * Download an archive (all its parts) and unpack the audio inside into the app's storage:
     * { urls: [], names: [], folder, job } → { files: [{ uri, name, size }], folder }.
     * .zip (and .7z) by commons-compress, .rar (incl. split .partN.rar) by junrar.
     * Progress: "unpackProgress" { job, phase: 'download' | 'unpack', got, total, part, parts }.
     */
    @PluginMethod
    public void unpack(PluginCall call) {
        com.getcapacitor.JSArray urls = call.getArray("urls", new com.getcapacitor.JSArray());
        com.getcapacitor.JSArray names = call.getArray("names", new com.getcapacitor.JSArray());
        String folder = call.getString("folder", "Audiobook").replaceAll("[\\\\/:*?\"<>|]+", " ").trim();
        String job = call.getString("job", "");
        if (urls.length() == 0) {
            call.reject("Nothing to unpack");
            return;
        }
        unpacks.execute(() -> {
            File work = new File(getContext().getCacheDir(), "unpack-" + System.currentTimeMillis());
            try {
                work.mkdirs();
                List<File> got = new java.util.ArrayList<>();
                for (int i = 0; i < urls.length(); i++) {
                    String url = urls.getString(i);
                    String name = names.length() > i ? names.getString(i) : "part" + (i + 1);
                    name = name.replaceAll("[\\\\/:*?\"<>|]+", "_");
                    File f = new File(work, name);
                    fetch(url, f, job, i, urls.length());
                    got.add(f);
                }
                File out = new File(getContext().getExternalFilesDir(null), "Unpacked/" + (folder.isEmpty() ? "Audiobook" : folder));
                out.mkdirs();
                List<File> files = new java.util.ArrayList<>();
                // Audio files that came as they are (not every part is an archive).
                for (File f : got) if (KEEP.matcher(f.getName()).matches()) files.add(move(f, out));
                // The archives: a split .rar from its first part (the rest are read from it).
                for (File f : got) {
                    String n = f.getName().toLowerCase();
                    if (n.endsWith(".zip")) unzip(f, out, files, job);
                    else if (n.endsWith(".7z")) un7z(f, out, files, job);
                    else if (n.endsWith(".rar") && (!n.matches(".*\\.part\\d+\\.rar") || n.matches(".*\\.part0*1\\.rar"))) unrar(f, out, files, job);
                    else if (!KEEP.matcher(n).matches() && !n.matches(".*\\.(part\\d+\\.rar|r\\d\\d)$")) sniff(f, out, files, job);
                }
                if (files.isEmpty()) throw new Exception("no audio files inside");
                JSArray arr = new JSArray();
                for (File f : files) {
                    JSObject o = new JSObject();
                    o.put("uri", Uri.fromFile(f).toString());
                    o.put("name", f.getName());
                    o.put("size", f.length());
                    arr.put(o);
                }
                JSObject r = new JSObject();
                r.put("files", arr);
                r.put("folder", out.getAbsolutePath());
                call.resolve(r);
            } catch (Throwable e) {
                String m = String.valueOf(e.getMessage());
                if (m.toLowerCase().contains("rar5") || e.getClass().getSimpleName().contains("Unsupported")) m = "this archive is the newer RAR 5 kind, which can't be unpacked on the phone — use Save and unpack it with a file manager (e.g. ZArchiver)";
                call.reject("cancelled".equals(m) ? "cancelled" : "Couldn't unpack: " + m);
            } finally {
                deleteAll(work);
                cancelled.remove(job);
            }
        });
    }

    private void note(String job, String phase, long got, long total, int part, int parts) {
        JSObject e = new JSObject();
        e.put("job", job);
        e.put("phase", phase);
        e.put("got", got);
        e.put("total", total);
        e.put("part", part);
        e.put("parts", parts);
        notifyListeners("unpackProgress", e);
    }

    private void fetch(String url, File to, String job, int part, int parts) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setInstanceFollowRedirects(true);
        conn.setConnectTimeout(20000);
        conn.setReadTimeout(60000);
        conn.setRequestProperty("User-Agent", "Audiohub/1.0 (Android)");
        int code = conn.getResponseCode();
        if (code >= 400) throw new Exception("the file host said HTTP " + code + " (the link may have expired)");
        long total = conn.getContentLengthLong();
        long got = 0;
        long last = 0;
        byte[] buf = new byte[128 * 1024];
        try (InputStream in = new BufferedInputStream(conn.getInputStream()); OutputStream out = new FileOutputStream(to)) {
            int n;
            while ((n = in.read(buf)) > 0) {
                if (cancelled.contains(job)) throw new Exception("cancelled");
                out.write(buf, 0, n);
                got += n;
                long now = System.currentTimeMillis();
                if (now - last > 700) {
                    last = now;
                    note(job, "download", got, total, part, parts);
                }
            }
        } finally {
            conn.disconnect();
        }
    }

    private static String flat(String path) {
        // "Book/CD1/01 Intro.mp3" → "CD1 - 01 Intro.mp3" (one folder, order kept)
        String[] bits = path.replace('\\', '/').split("/");
        StringBuilder b = new StringBuilder();
        for (int i = Math.max(0, bits.length - 2); i < bits.length; i++) {
            if (bits[i].isEmpty()) continue;
            if (b.length() > 0) b.append(" - ");
            b.append(bits[i]);
        }
        return b.toString().replaceAll("[\\\\/:*?\"<>|]+", "_");
    }

    private void write(InputStream in, File to, String job) throws Exception {
        byte[] buf = new byte[128 * 1024];
        try (OutputStream out = new FileOutputStream(to)) {
            int n;
            while ((n = in.read(buf)) > 0) {
                if (cancelled.contains(job)) throw new Exception("cancelled");
                out.write(buf, 0, n);
            }
        }
    }

    private void unzip(File zip, File out, List<File> files, String job) throws Exception {
        note(job, "unpack", 0, 0, 0, 0);
        try (org.apache.commons.compress.archivers.zip.ZipFile z = org.apache.commons.compress.archivers.zip.ZipFile.builder().setFile(zip).get()) {
            java.util.Enumeration<org.apache.commons.compress.archivers.zip.ZipArchiveEntry> en = z.getEntries();
            while (en.hasMoreElements()) {
                org.apache.commons.compress.archivers.zip.ZipArchiveEntry e = en.nextElement();
                if (e.isDirectory() || !KEEP.matcher(e.getName()).matches()) continue;
                File to = new File(out, flat(e.getName()));
                try (InputStream in = z.getInputStream(e)) {
                    write(in, to, job);
                }
                files.add(to);
            }
        }
    }

    private void un7z(File f, File out, List<File> files, String job) throws Exception {
        note(job, "unpack", 0, 0, 0, 0);
        try (org.apache.commons.compress.archivers.sevenz.SevenZFile z = org.apache.commons.compress.archivers.sevenz.SevenZFile.builder().setFile(f).get()) {
            org.apache.commons.compress.archivers.sevenz.SevenZArchiveEntry e;
            while ((e = z.getNextEntry()) != null) {
                if (e.isDirectory() || !KEEP.matcher(e.getName()).matches()) continue;
                File to = new File(out, flat(e.getName()));
                try (InputStream in = z.getInputStream(e)) {
                    write(in, to, job);
                }
                files.add(to);
            }
        }
    }

    private void unrar(File rar, File out, List<File> files, String job) throws Exception {
        note(job, "unpack", 0, 0, 0, 0);
        try (com.github.junrar.Archive a = new com.github.junrar.Archive(rar)) {
            com.github.junrar.rarfile.FileHeader h;
            while ((h = a.nextFileHeader()) != null) {
                if (cancelled.contains(job)) throw new Exception("cancelled");
                String name = h.getFileName();
                if (h.isDirectory() || !KEEP.matcher(name).matches()) continue;
                File to = new File(out, flat(name));
                try (OutputStream os = new FileOutputStream(to)) {
                    a.extractFile(h, os);
                }
                files.add(to);
            }
        }
    }

    /** A part with no telling name: its first bytes say what it is. */
    private void sniff(File f, File out, List<File> files, String job) throws Exception {
        byte[] head = new byte[8];
        try (InputStream in = new FileInputStream(f)) {
            if (in.read(head) < 4) return;
        }
        if (head[0] == 'P' && head[1] == 'K') unzip(f, out, files, job);
        else if (head[0] == 'R' && head[1] == 'a' && head[2] == 'r' && head[3] == '!') {
            File r = new File(f.getParentFile(), f.getName() + ".rar");
            if (f.renameTo(r)) unrar(r, out, files, job);
        } else if (head[0] == '7' && head[1] == 'z') un7z(f, out, files, job);
    }

    private static File move(File f, File dir) {
        File to = new File(dir, f.getName());
        if (!f.renameTo(to)) return f;
        return to;
    }

    private static void deleteAll(File f) {
        if (f == null || !f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteAll(k);
        f.delete();
    }
}
