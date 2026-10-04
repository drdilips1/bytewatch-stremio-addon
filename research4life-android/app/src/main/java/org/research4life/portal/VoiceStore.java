package org.research4life.portal;

import android.content.Context;

import org.apache.commons.compress.archivers.tar.TarArchiveEntry;
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream;
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Natural-sounding neural voices that run on the phone (sherpa-onnx: Kokoro and Piper models).
 * A voice pack is downloaded once from the sherpa-onnx model releases, unpacked into private
 * storage, and then works offline.
 */
final class VoiceStore {

    interface Progress {
        void onProgress(int percent, String stage);
    }

    static final class Pack {
        final String id, file, label, lang, desc, type;
        final int sizeMb;
        final String[] speakers; // for multi-speaker packs: "Name|gender|accent"

        Pack(String id, String file, String type, String label, String lang, String desc, int sizeMb, String... speakers) {
            this.id = id; this.file = file; this.type = type; this.label = label; this.lang = lang; this.desc = desc;
            this.sizeMb = sizeMb; this.speakers = speakers;
        }
    }

    private static final String BASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/";

    static final Pack[] CATALOG = {
            // Kokoro 1.0: the newest, most natural voices ("Heart" is the best-rated). The 4th field is
            // the speaker's index in voices.bin.
            new Pack("kokoro-hd", "kokoro-multi-lang-v1_0", "kokoro", "HD studio voices (Kokoro 1.0)", "en",
                    "The most natural voices: Heart, Bella, Michael, Emma, George and more. Best quality; large download, needs a recent phone.", 350,
                    "Heart|female|US|3", "Bella|female|US|2", "Nicole|female|US|6", "Sarah|female|US|9", "Aoede|female|US|1", "Kore|female|US|5",
                    "Michael|male|US|16", "Fenrir|male|US|14", "Puck|male|US|18", "Echo|male|US|12",
                    "Emma|female|UK|21", "Isabella|female|UK|22", "George|male|UK|26", "Fable|male|UK|25", "Daniel|male|UK|24"),
            new Pack("kokoro-en", "kokoro-int8-en-v0_19", "kokoro", "Studio voices (Kokoro)", "en",
                    "11 very natural US and UK voices. Best quality; needs a recent phone.", 103,
                    "Default|female|US", "Bella|female|US", "Nicole|female|US", "Sarah|female|US", "Sky|female|US",
                    "Adam|male|US", "Michael|male|US", "Emma|female|UK", "Isabella|female|UK", "George|male|UK", "Lewis|male|UK"),
            new Pack("piper-lessac", "vits-piper-en_US-lessac-medium-int8", "vits", "Lessac", "en", "Clear US female narrator. Fast on any phone.", 20),
            new Pack("piper-ryan", "vits-piper-en_US-ryan-high-int8", "vits", "Ryan", "en", "Warm US male narrator, high quality.", 34),
            new Pack("piper-amy", "vits-piper-en_US-amy-medium-int8", "vits", "Amy", "en", "Friendly US female voice.", 21),
            new Pack("piper-joe", "vits-piper-en_US-joe-medium-int8", "vits", "Joe", "en", "Calm US male voice.", 21),
            new Pack("piper-alba", "vits-piper-en_GB-alba-medium-int8", "vits", "Alba", "en", "Scottish-accented UK female voice.", 21),
            new Pack("piper-dii", "vits-piper-en_GB-dii-high-int8", "vits", "Dii", "en", "UK female voice, high quality.", 21),
            new Pack("piper-priyamvada", "vits-piper-hi_IN-priyamvada-medium-int8", "vits", "Priyamvada (Hindi)", "hi", "Hindi female voice.", 21),
            new Pack("piper-pratham", "vits-piper-hi_IN-pratham-medium-int8", "vits", "Pratham (Hindi)", "hi", "Hindi male voice.", 20),
    };

    private VoiceStore() {}

    static Pack pack(String id) {
        for (Pack p : CATALOG) if (p.id.equals(id)) return p;
        return null;
    }

    static File root(Context ctx) {
        File d = new File(ctx.getFilesDir(), "voices");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    static File dir(Context ctx, String id) {
        return new File(root(ctx), id);
    }

    static boolean installed(Context ctx, String id) {
        return new File(dir(ctx, id), "manifest.json").exists();
    }

    /** {type, model, tokens, dataDir, voices, lexicon} with absolute paths. */
    static JSONObject manifest(Context ctx, String id) throws Exception {
        File f = new File(dir(ctx, id), "manifest.json");
        try (InputStream in = new FileInputStream(f)) {
            byte[] b = new byte[(int) f.length()];
            int n = 0;
            while (n < b.length) { int r = in.read(b, n, b.length - n); if (r < 0) break; n += r; }
            return new JSONObject(new String(b, 0, n, StandardCharsets.UTF_8));
        }
    }

    /** The catalog with install state, for the voice picker. */
    static JSONArray catalog(Context ctx) {
        JSONArray out = new JSONArray();
        for (Pack p : CATALOG) {
            try {
                JSONArray sp = new JSONArray();
                for (String s : p.speakers) {
                    String[] parts = s.split("\\|");
                    JSONObject o = new JSONObject().put("name", parts[0]).put("gender", parts[1]).put("accent", parts[2]);
                    if (parts.length > 3) o.put("sid", Integer.parseInt(parts[3]));
                    sp.put(o);
                }
                out.put(new JSONObject().put("id", p.id).put("label", p.label).put("lang", p.lang).put("desc", p.desc)
                        .put("sizeMb", p.sizeMb).put("type", p.type).put("speakers", sp).put("installed", installed(ctx, p.id)));
            } catch (Exception ignored) {
            }
        }
        return out;
    }

    static void delete(Context ctx, String id) {
        deleteTree(dir(ctx, id));
    }

    private static void deleteTree(File f) {
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        f.delete();
    }

    /** Downloads and unpacks a voice pack (call off the main thread). */
    static void download(Context ctx, String id, Progress progress) throws Exception {
        Pack p = pack(id);
        if (p == null) throw new IOException("Unknown voice");
        File tmp = new File(ctx.getCacheDir(), id + ".tar.bz2");
        File work = new File(root(ctx), id + ".part");
        deleteTree(work);
        try {
            fetch(BASE + p.file + ".tar.bz2", tmp, progress);
            progress.onProgress(0, "Unpacking");
            work.mkdirs();
            long total = tmp.length(), done;
            try (FileInputStream fin = new FileInputStream(tmp);
                 CountingStream counter = new CountingStream(new BufferedInputStream(fin, 65536));
                 TarArchiveInputStream tar = new TarArchiveInputStream(new BZip2CompressorInputStream(counter))) {
                TarArchiveEntry e;
                byte[] buf = new byte[65536];
                int lastPct = -1;
                while ((e = tar.getNextEntry()) != null) {
                    File out = new File(work, e.getName());
                    if (!out.getCanonicalPath().startsWith(work.getCanonicalPath())) continue; // no path escapes
                    if (e.isDirectory()) { out.mkdirs(); continue; }
                    out.getParentFile().mkdirs();
                    try (OutputStream os = new FileOutputStream(out)) {
                        int n;
                        while ((n = tar.read(buf)) > 0) os.write(buf, 0, n);
                    }
                    done = counter.count;
                    int pct = (int) (100 * done / Math.max(1, total));
                    if (pct != lastPct) { lastPct = pct; progress.onProgress(pct, "Unpacking"); }
                }
            }
            JSONObject m = describe(work, p.type);
            File dest = dir(ctx, id);
            deleteTree(dest);
            if (!work.renameTo(dest)) throw new IOException("Could not install the voice");
            // Paths in the manifest point into the final folder.
            String from = work.getAbsolutePath(), to = dest.getAbsolutePath();
            for (String k : new String[]{"model", "tokens", "dataDir", "voices", "lexicon"}) {
                if (m.has(k)) m.put(k, m.getString(k).replace(from, to));
            }
            try (OutputStream os = new FileOutputStream(new File(dest, "manifest.json"))) {
                os.write(m.toString().getBytes(StandardCharsets.UTF_8));
            }
        } finally {
            tmp.delete();
            deleteTree(work);
        }
    }

    /** Finds the model files inside an unpacked pack (names differ between packs). */
    private static JSONObject describe(File dir, String type) throws Exception {
        File model = find(dir, (f) -> f.getName().endsWith(".onnx") && !f.getName().contains("encoder") && !f.getName().contains("decoder"));
        File tokens = find(dir, (f) -> f.getName().equals("tokens.txt"));
        File data = findDir(dir, "espeak-ng-data");
        if (model == null || tokens == null) throw new IOException("The voice pack is incomplete");
        JSONObject m = new JSONObject().put("type", type).put("model", model.getAbsolutePath()).put("tokens", tokens.getAbsolutePath());
        if (data != null) m.put("dataDir", data.getAbsolutePath());
        if ("kokoro".equals(type)) {
            File voices = find(dir, (f) -> f.getName().equals("voices.bin"));
            if (voices == null) throw new IOException("The voice pack is incomplete");
            m.put("voices", voices.getAbsolutePath());
        }
        // Kokoro 1.0 reads English through its own pronunciation lexicon.
        File lexicon = find(dir, (f) -> f.getName().equals("lexicon-us-en.txt"));
        if (lexicon == null) lexicon = find(dir, (f) -> f.getName().equals("lexicon.txt"));
        if (lexicon != null) m.put("lexicon", lexicon.getAbsolutePath());
        return m;
    }

    private interface Match { boolean ok(File f); }

    private static File find(File dir, Match m) {
        File[] kids = dir.listFiles();
        if (kids == null) return null;
        for (File k : kids) if (k.isFile() && m.ok(k)) return k;
        for (File k : kids) if (k.isDirectory() && !k.getName().equals("espeak-ng-data")) {
            File r = find(k, m);
            if (r != null) return r;
        }
        return null;
    }

    private static File findDir(File dir, String name) {
        File[] kids = dir.listFiles();
        if (kids == null) return null;
        for (File k : kids) if (k.isDirectory() && k.getName().equals(name)) return k;
        for (File k : kids) if (k.isDirectory()) { File r = findDir(k, name); if (r != null) return r; }
        return null;
    }

    private static void fetch(String url, File dest, Progress progress) throws IOException {
        HttpURLConnection conn = null;
        try {
            URL u = new URL(url);
            for (int hop = 0; hop < 6; hop++) {
                conn = (HttpURLConnection) u.openConnection();
                conn.setInstanceFollowRedirects(false);
                conn.setConnectTimeout(20000);
                conn.setReadTimeout(60000);
                int code = conn.getResponseCode();
                if (code >= 300 && code < 400 && conn.getHeaderField("Location") != null) {
                    u = new URL(u, conn.getHeaderField("Location"));
                    conn.disconnect();
                    continue;
                }
                if (code != 200) throw new IOException("Download failed (" + code + ")");
                break;
            }
            long total = conn.getContentLengthLong();
            long done = 0;
            int lastPct = -1;
            try (InputStream in = conn.getInputStream(); OutputStream out = new FileOutputStream(dest)) {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    done += n;
                    int pct = total > 0 ? (int) (100 * done / total) : 0;
                    if (pct != lastPct) { lastPct = pct; progress.onProgress(pct, "Downloading"); }
                }
            }
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static final class CountingStream extends java.io.FilterInputStream {
        long count;

        CountingStream(InputStream in) { super(in); }

        @Override public int read() throws IOException {
            int b = super.read();
            if (b >= 0) count++;
            return b;
        }

        @Override public int read(byte[] b, int off, int len) throws IOException {
            int n = super.read(b, off, len);
            if (n > 0) count += n;
            return n;
        }
    }
}
