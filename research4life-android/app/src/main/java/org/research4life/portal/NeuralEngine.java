package org.research4life.portal;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.media.PlaybackParams;
import android.os.Build;

import com.k2fsa.sherpa.onnx.GeneratedAudio;
import com.k2fsa.sherpa.onnx.OfflineTts;
import com.k2fsa.sherpa.onnx.OfflineTtsConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsKokoroModelConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.TimeUnit;

/**
 * Plays text with on-device neural voices (sherpa-onnx). Speech is generated a sentence or two
 * ahead of playback and streamed to an AudioTrack, so listening starts quickly and runs without
 * gaps. Every generated clip is cached, so replaying never regenerates it and cached documents
 * play offline. Speed is applied at playback (pitch kept), so one cached clip serves every speed.
 *
 * Voice ids look like "neural:kokoro-en#3" (voice pack, speaker).
 */
final class NeuralEngine {

    interface Host {
        void onItemStart(int gen, int item);
        void onItemsDone(int gen, int lastItem);
        void onBuffering(int gen);
        void onError(int gen, String message);
        void onFocusLost();
        int stopAfter();
    }

    static final String PREFIX = "neural:";

    static boolean isNeural(String voice) {
        return voice != null && voice.startsWith(PREFIX);
    }

    private static final class Seg {
        final int item;
        final boolean first;
        final short[] pcm;
        final int rate;

        Seg(int item, boolean first, short[] pcm, int rate) {
            this.item = item; this.first = first; this.pcm = pcm; this.rate = rate;
        }
    }

    private static final Seg END = new Seg(-1, false, null, 0);
    private static final long CACHE_LIMIT = 600L * 1024 * 1024;

    private final Context app;
    private final Host host;
    private final Object synthLock = new Object();
    private final Object trackLock = new Object();
    private final Map<String, OfflineTts> models = new LinkedHashMap<>(4, 0.75f, true);
    private volatile int gen;
    private volatile float rate = 1f;
    private AudioTrack track;
    private int trackRate;
    private AudioFocusRequest focusRequest;
    private int cacheWrites;

    NeuralEngine(Context app, Host host) {
        this.app = app;
        this.host = host;
    }

    /** Starts playing texts[start…]; voices[i] is each item's voice id. Returns the play generation. */
    int play(String[] texts, String[] voices, int start, float speed) {
        final int g = ++gen;
        rate = speed > 0 ? speed : 1f;
        releaseTrack();
        requestFocus();
        BlockingQueue<Seg> q = new ArrayBlockingQueue<>(6);
        Thread producer = new Thread(() -> produce(g, texts, voices, start, q), "tts-generate");
        Thread consumer = new Thread(() -> consume(g, q), "tts-play");
        producer.setPriority(Thread.NORM_PRIORITY + 1);
        consumer.setPriority(Thread.MAX_PRIORITY);
        producer.start();
        consumer.start();
        return g;
    }

    void stop() {
        gen++;
        releaseTrack();
    }

    void setRate(float r) {
        rate = r > 0 ? r : 1f;
        synchronized (trackLock) {
            if (track != null) applySpeed(track);
        }
    }

    void release() {
        stop();
        abandonFocus();
        synchronized (synthLock) {
            for (OfflineTts t : models.values()) {
                try { t.release(); } catch (Throwable ignored) { }
            }
            models.clear();
        }
    }

    // ------------------------------------------------------------------ generation

    private void produce(int g, String[] texts, String[] voices, int start, BlockingQueue<Seg> q) {
        try {
            for (int i = start; i < texts.length && g == gen; i++) {
                int stopAt = host.stopAfter();
                if (stopAt >= 0 && i > stopAt) break;
                List<String> units = split(texts[i]);
                for (int u = 0; u < units.size() && g == gen; u++) {
                    short[][] out = new short[1][];
                    int sr = audioFor(voices[i], units.get(u), out);
                    Seg s = new Seg(i, u == 0, out[0], sr);
                    while (g == gen && !q.offer(s, 200, TimeUnit.MILLISECONDS)) { /* wait for room */ }
                }
            }
            while (g == gen && !q.offer(END, 200, TimeUnit.MILLISECONDS)) { /* wait for room */ }
        } catch (Throwable e) {
            if (g == gen) host.onError(g, e.getMessage() == null ? "The voice could not speak this text" : e.getMessage());
        }
    }

    /** Sentence-sized pieces (about 1–2 sentences), so the first audio is ready quickly. */
    static List<String> split(String text) {
        List<String> out = new ArrayList<>();
        String[] sentences = text.trim().split("(?<=[.!?;:])\\s+");
        StringBuilder cur = new StringBuilder();
        for (String s : sentences) {
            while (s.length() > 400) {
                int cut = s.lastIndexOf(", ", 300);
                if (cut < 80) cut = s.lastIndexOf(' ', 300);
                if (cut < 80) cut = 300;
                if (cur.length() > 0) { out.add(cur.toString()); cur.setLength(0); }
                out.add(s.substring(0, cut + 1).trim());
                s = s.substring(cut + 1).trim();
            }
            if (cur.length() > 0 && cur.length() + s.length() > 220) { out.add(cur.toString()); cur.setLength(0); }
            if (cur.length() > 0) cur.append(' ');
            cur.append(s);
        }
        if (cur.length() > 0) out.add(cur.toString());
        if (out.isEmpty()) out.add(" ");
        return out;
    }

    /** Cached audio for (voice, text), generating it when needed. Returns the sample rate. */
    private int audioFor(String voice, String text, short[][] out) throws Exception {
        File f = cacheFile(voice, text);
        if (f.exists()) {
            try (DataInputStream in = new DataInputStream(new BufferedInputStream(new FileInputStream(f), 65536))) {
                int sr = in.readInt();
                int n = in.readInt();
                short[] pcm = new short[n];
                for (int i = 0; i < n; i++) pcm[i] = in.readShort();
                out[0] = pcm;
                f.setLastModified(System.currentTimeMillis());
                return sr;
            } catch (Exception e) {
                f.delete();
            }
        }
        String pack = voice.substring(PREFIX.length());
        int sid = 0;
        int hash = pack.indexOf('#');
        if (hash >= 0) {
            try { sid = Integer.parseInt(pack.substring(hash + 1)); } catch (NumberFormatException ignored) { }
            pack = pack.substring(0, hash);
        }
        GeneratedAudio a;
        synchronized (synthLock) {
            OfflineTts tts = model(pack);
            a = tts.generate(text.trim().isEmpty() ? "." : text, sid, 1.0f);
        }
        float[] s = a.getSamples();
        short[] pcm = new short[s.length];
        for (int i = 0; i < s.length; i++) {
            float v = Math.max(-1f, Math.min(1f, s[i]));
            pcm[i] = (short) (v * 32767);
        }
        out[0] = pcm;
        try (DataOutputStream os = new DataOutputStream(new BufferedOutputStream(new FileOutputStream(f), 65536))) {
            os.writeInt(a.getSampleRate());
            os.writeInt(pcm.length);
            for (short v : pcm) os.writeShort(v);
        } catch (Exception ignored) {
            f.delete();
        }
        if (++cacheWrites % 50 == 0) pruneCache();
        return a.getSampleRate();
    }

    private OfflineTts model(String pack) throws Exception {
        OfflineTts t = models.get(pack);
        if (t != null) return t;
        if (!VoiceStore.installed(app, pack)) throw new Exception("This voice isn't downloaded. Open Listening settings to get it.");
        JSONObject m = VoiceStore.manifest(app, pack);
        OfflineTtsModelConfig mc = new OfflineTtsModelConfig();
        mc.setNumThreads(Math.max(1, Math.min(4, Runtime.getRuntime().availableProcessors() - 1)));
        mc.setDebug(false);
        mc.setProvider("cpu");
        if ("kokoro".equals(m.optString("type"))) {
            OfflineTtsKokoroModelConfig k = new OfflineTtsKokoroModelConfig();
            k.setModel(m.getString("model"));
            k.setVoices(m.getString("voices"));
            k.setTokens(m.getString("tokens"));
            k.setDataDir(m.optString("dataDir", ""));
            if (m.has("lexicon")) k.setLexicon(m.getString("lexicon"));
            mc.setKokoro(k);
        } else {
            OfflineTtsVitsModelConfig v = new OfflineTtsVitsModelConfig();
            v.setModel(m.getString("model"));
            v.setTokens(m.getString("tokens"));
            v.setDataDir(m.optString("dataDir", ""));
            v.setLexicon(m.optString("lexicon", ""));
            mc.setVits(v);
        }
        OfflineTtsConfig c = new OfflineTtsConfig();
        c.setModel(mc);
        t = new OfflineTts(null, c);
        // Keep at most two voices in memory (a discussion uses two).
        while (models.size() >= 2) {
            String oldest = models.keySet().iterator().next();
            try { models.remove(oldest).release(); } catch (Throwable ignored) { }
        }
        models.put(pack, t);
        return t;
    }

    private File cacheDir() {
        File d = new File(app.getFilesDir(), "ttscache");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    private File cacheFile(String voice, String text) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-1");
        byte[] h = md.digest((voice + "|" + text).getBytes("UTF-8"));
        StringBuilder sb = new StringBuilder();
        for (byte b : h) sb.append(String.format("%02x", b));
        return new File(cacheDir(), sb + ".pcm");
    }

    private void pruneCache() {
        File[] files = cacheDir().listFiles();
        if (files == null) return;
        long total = 0;
        for (File f : files) total += f.length();
        if (total <= CACHE_LIMIT) return;
        Arrays.sort(files, Comparator.comparingLong(File::lastModified));
        for (File f : files) {
            if (total <= CACHE_LIMIT * 0.8) break;
            total -= f.length();
            f.delete();
        }
    }

    static long cacheBytes(Context ctx) {
        File[] files = new File(ctx.getFilesDir(), "ttscache").listFiles();
        long total = 0;
        if (files != null) for (File f : files) total += f.length();
        return total;
    }

    static void clearCache(Context ctx) {
        File[] files = new File(ctx.getFilesDir(), "ttscache").listFiles();
        if (files != null) for (File f : files) f.delete();
    }

    // ------------------------------------------------------------------ playback

    private void consume(int g, BlockingQueue<Seg> q) {
        int current = -1;
        long written = 0;
        boolean waitingSent = false;
        try {
            while (g == gen) {
                Seg s = q.poll(350, TimeUnit.MILLISECONDS);
                if (s == null) {
                    if (!waitingSent) { waitingSent = true; host.onBuffering(g); }
                    continue;
                }
                waitingSent = false;
                if (s == END) {
                    // Let the last audio finish before reporting the end.
                    AudioTrack t;
                    synchronized (trackLock) { t = track; }
                    long deadline = System.currentTimeMillis() + 15000;
                    while (g == gen && t != null && System.currentTimeMillis() < deadline) {
                        long head;
                        try { head = t.getPlaybackHeadPosition() & 0xffffffffL; } catch (Exception e) { break; }
                        if (head >= written) break;
                        Thread.sleep(60);
                    }
                    if (g == gen) host.onItemsDone(g, current);
                    return;
                }
                AudioTrack t = ensureTrack(s.rate);
                if (t == null || g != gen) return;
                if (s.first) {
                    current = s.item;
                    host.onItemStart(g, s.item);
                }
                int off = 0;
                while (off < s.pcm.length && g == gen) {
                    int n = t.write(s.pcm, off, Math.min(4096, s.pcm.length - off));
                    if (n <= 0) return;
                    off += n;
                    written += n;
                }
            }
        } catch (InterruptedException ignored) {
        } catch (Throwable e) {
            if (g == gen) host.onError(g, "Playback failed: " + e.getMessage());
        }
    }

    private AudioTrack ensureTrack(int sampleRate) {
        synchronized (trackLock) {
            if (track != null && trackRate == sampleRate) return track;
            if (track != null) { try { track.release(); } catch (Exception ignored) { } }
            int min = AudioTrack.getMinBufferSize(sampleRate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT);
            int size = Math.max(min * 2, sampleRate / 4 * 2);
            track = new AudioTrack.Builder()
                    .setAudioAttributes(new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                    .setAudioFormat(new AudioFormat.Builder()
                            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                            .setSampleRate(sampleRate)
                            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                    .setBufferSizeInBytes(size)
                    .setTransferMode(AudioTrack.MODE_STREAM)
                    .build();
            trackRate = sampleRate;
            applySpeed(track);
            track.play();
            return track;
        }
    }

    private void applySpeed(AudioTrack t) {
        try {
            t.setPlaybackParams(new PlaybackParams().allowDefaults().setSpeed(rate).setPitch(1f));
        } catch (Exception ignored) {
            // Some devices limit the range; keep normal speed rather than fail.
        }
    }

    private void releaseTrack() {
        synchronized (trackLock) {
            if (track != null) {
                try { track.pause(); track.flush(); } catch (Exception ignored) { }
                try { track.release(); } catch (Exception ignored) { }
                track = null;
            }
        }
    }

    // ------------------------------------------------------------------ audio focus

    private final AudioManager.OnAudioFocusChangeListener focusListener = this::onFocusChange;

    private void onFocusChange(int change) {
        if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) host.onFocusLost();
    }

    private void requestFocus() {
        AudioManager am = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
        if (am == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (focusRequest == null) {
                focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                        .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                        .setOnAudioFocusChangeListener(focusListener)
                        .build();
            }
            am.requestAudioFocus(focusRequest);
        } else {
            am.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
        }
    }

    void abandonFocus() {
        AudioManager am = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
        if (am == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (focusRequest != null) am.abandonAudioFocusRequest(focusRequest);
        } else {
            am.abandonAudioFocus(focusListener);
        }
    }
}
