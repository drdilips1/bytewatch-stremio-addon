package app.inkwell.books;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.k2fsa.sherpa.onnx.GeneratedAudio;
import com.k2fsa.sherpa.onnx.OfflineTts;
import com.k2fsa.sherpa.onnx.OfflineTtsConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsKittenModelConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsKokoroModelConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.apache.commons.compress.archivers.tar.TarArchiveEntry;
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream;
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream;

/**
 * Built-in neural voices (sherpa-onnx: Kokoro, Piper, Kitten). Voices are
 * downloaded once inside the app, then everything runs offline on the phone.
 * Text is rendered to WAV files that the audiobook player / read-along plays.
 */
@CapacitorPlugin(name = "InkwellVoices")
public class InkwellVoicesPlugin extends Plugin {

    private final ExecutorService downloads = Executors.newSingleThreadExecutor();
    private final ExecutorService synth = Executors.newSingleThreadExecutor();
    private OfflineTts tts;
    private String loadedId = null;

    private File voicesDir() {
        File d = new File(getContext().getFilesDir(), "voices");
        //noinspection ResultOfMethodCallIgnored
        d.mkdirs();
        return d;
    }

    // ---------------------------------------------------------------- catalog

    @PluginMethod
    public void installed(PluginCall call) {
        JSArray arr = new JSArray();
        File[] kids = voicesDir().listFiles();
        if (kids != null) {
            for (File k : kids) {
                if (k.isDirectory() && new File(k, ".ready").exists()) arr.put(k.getName());
            }
        }
        JSObject r = new JSObject();
        r.put("ids", arr);
        call.resolve(r);
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String id = call.getString("id", "");
        synth.execute(() -> {
            if (id.equals(loadedId) && tts != null) {
                tts.release();
                tts = null;
                loadedId = null;
            }
            deleteTree(new File(voicesDir(), id));
            call.resolve();
        });
    }

    /** Download a .tar.bz2 voice package and unpack it to files/voices/<id>. */
    @PluginMethod
    public void download(PluginCall call) {
        String id = call.getString("id");
        String url = call.getString("url");
        if (id == null || url == null) {
            call.reject("Missing voice id or url");
            return;
        }
        call.setKeepAlive(true);
        downloads.execute(() -> {
            File tmp = new File(getContext().getCacheDir(), id + ".tar.bz2.part");
            try {
                // 1. download (follows GitHub's redirects across hosts)
                String current = url;
                HttpURLConnection conn = null;
                for (int i = 0; i < 6; i++) {
                    conn = (HttpURLConnection) new URL(current).openConnection();
                    conn.setInstanceFollowRedirects(false);
                    conn.setConnectTimeout(20000);
                    conn.setReadTimeout(60000);
                    conn.setRequestProperty("User-Agent", "Inkwell/1.0 (Android)");
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
                long got = 0;
                long lastEmit = 0;
                try (InputStream in = new BufferedInputStream(conn.getInputStream()); OutputStream out = new FileOutputStream(tmp)) {
                    byte[] buf = new byte[1 << 16];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        got += n;
                        long now = System.currentTimeMillis();
                        if (now - lastEmit > 400) {
                            lastEmit = now;
                            progress(id, "download", got, total);
                        }
                    }
                }
                // 2. unpack; archives contain a single top-level folder
                progress(id, "unpack", 0, 0);
                File target = new File(voicesDir(), id);
                deleteTree(target);
                //noinspection ResultOfMethodCallIgnored
                target.mkdirs();
                try (
                    TarArchiveInputStream tar = new TarArchiveInputStream(
                        new BZip2CompressorInputStream(new BufferedInputStream(new FileInputStream(tmp), 1 << 16))
                    )
                ) {
                    TarArchiveEntry e;
                    byte[] buf = new byte[1 << 16];
                    while ((e = tar.getNextTarEntry()) != null) {
                        String name = e.getName();
                        int slash = name.indexOf('/');
                        String rel = slash >= 0 ? name.substring(slash + 1) : name;
                        if (rel.isEmpty() || rel.contains("..")) continue;
                        File f = new File(target, rel);
                        if (e.isDirectory()) {
                            //noinspection ResultOfMethodCallIgnored
                            f.mkdirs();
                            continue;
                        }
                        File parent = f.getParentFile();
                        //noinspection ResultOfMethodCallIgnored
                        if (parent != null) parent.mkdirs();
                        try (OutputStream out = new FileOutputStream(f)) {
                            int n;
                            while ((n = tar.read(buf)) > 0) out.write(buf, 0, n);
                        }
                    }
                }
                //noinspection ResultOfMethodCallIgnored
                new File(target, ".ready").createNewFile();
                //noinspection ResultOfMethodCallIgnored
                tmp.delete();
                progress(id, "done", 1, 1);
                call.resolve();
            } catch (Exception ex) {
                //noinspection ResultOfMethodCallIgnored
                tmp.delete();
                deleteTree(new File(voicesDir(), id));
                call.reject(ex.getMessage() != null ? ex.getMessage() : ex.toString());
            } finally {
                call.setKeepAlive(false);
            }
        });
    }

    private void progress(String id, String phase, long got, long total) {
        JSObject o = new JSObject();
        o.put("id", id);
        o.put("phase", phase);
        o.put("received", got);
        o.put("total", total);
        notifyListeners("progress", o);
    }

    // -------------------------------------------------------------- synthesis

    private OfflineTts load(PluginCall c) throws Exception {
        String id = c.getString("id", "");
        if (tts != null && id.equals(loadedId)) return tts;
        if (tts != null) {
            tts.release();
            tts = null;
            loadedId = null;
        }
        File dir = new File(voicesDir(), id);
        if (!new File(dir, ".ready").exists()) throw new Exception("This voice isn't downloaded yet");
        String type = c.getString("type", "vits");
        String model = new File(dir, c.getString("model", "model.onnx")).getAbsolutePath();
        String tokens = new File(dir, "tokens.txt").getAbsolutePath();
        File espeak = new File(dir, "espeak-ng-data");
        String dataDir = espeak.exists() ? espeak.getAbsolutePath() : "";

        OfflineTtsModelConfig mc = new OfflineTtsModelConfig();
        mc.setNumThreads(Math.max(2, Math.min(4, Runtime.getRuntime().availableProcessors())));
        mc.setProvider("cpu");
        mc.setDebug(false);
        if ("kokoro".equals(type)) {
            OfflineTtsKokoroModelConfig k = new OfflineTtsKokoroModelConfig();
            k.setModel(model);
            k.setVoices(new File(dir, "voices.bin").getAbsolutePath());
            k.setTokens(tokens);
            k.setDataDir(dataDir);
            String lexicon = c.getString("lexicon", "");
            if (lexicon != null && !lexicon.isEmpty()) {
                StringBuilder sb = new StringBuilder();
                for (String part : lexicon.split(",")) {
                    if (sb.length() > 0) sb.append(',');
                    sb.append(new File(dir, part.trim()).getAbsolutePath());
                }
                k.setLexicon(sb.toString());
            }
            String lang = c.getString("lang", "");
            if (lang != null) k.setLang(lang);
            mc.setKokoro(k);
        } else if ("kitten".equals(type)) {
            OfflineTtsKittenModelConfig k = new OfflineTtsKittenModelConfig();
            k.setModel(model);
            k.setVoices(new File(dir, "voices.bin").getAbsolutePath());
            k.setTokens(tokens);
            k.setDataDir(dataDir);
            mc.setKitten(k);
        } else {
            OfflineTtsVitsModelConfig v = new OfflineTtsVitsModelConfig();
            v.setModel(model);
            v.setTokens(tokens);
            v.setDataDir(dataDir);
            mc.setVits(v);
        }
        OfflineTtsConfig cfg = new OfflineTtsConfig();
        cfg.setModel(mc);
        cfg.setMaxNumSentences(2);
        tts = new OfflineTts(null, cfg);
        loadedId = id;
        return tts;
    }

    /** Render text to a WAV file in the cache folder; resolves { uri }. */
    @PluginMethod
    public void synthesize(PluginCall call) {
        String rel = call.getString("path");
        if (rel == null) {
            call.reject("Missing path");
            return;
        }
        File out = new File(getContext().getCacheDir(), rel);
        if (out.exists() && out.length() > 1024) {
            JSObject o = new JSObject();
            o.put("uri", "file://" + out.getAbsolutePath());
            call.resolve(o);
            return;
        }
        synth.execute(() -> {
            try {
                OfflineTts t = load(call);
                File parent = out.getParentFile();
                //noinspection ResultOfMethodCallIgnored
                if (parent != null) parent.mkdirs();
                int sid = call.getInt("speaker", 0);
                float speed = call.getFloat("speed", 1f);
                GeneratedAudio audio = t.generate(call.getString("text", ""), sid, speed);
                if (audio.getSamples().length == 0) throw new Exception("The voice produced no audio for this text");
                File tmp = new File(out.getAbsolutePath() + ".tmp");
                if (!audio.save(tmp.getAbsolutePath())) throw new Exception("Could not save the audio file");
                //noinspection ResultOfMethodCallIgnored
                tmp.renameTo(out);
                JSObject o = new JSObject();
                o.put("uri", "file://" + out.getAbsolutePath());
                o.put("seconds", audio.getSamples().length / (double) audio.getSampleRate());
                call.resolve(o);
            } catch (Throwable ex) {
                call.reject(ex.getMessage() != null ? ex.getMessage() : ex.toString());
            }
        });
    }

    @PluginMethod
    public void clearCache(PluginCall call) {
        deleteTree(new File(getContext().getCacheDir(), "voice-audio"));
        call.resolve();
    }

    private static void deleteTree(File f) {
        if (f == null || !f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    @Override
    protected void handleOnDestroy() {
        synth.execute(() -> {
            if (tts != null) {
                tts.release();
                tts = null;
            }
        });
    }
}
