package org.research4life.portal;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Reads a document aloud one paragraph at a time, so the app can highlight the paragraph being
 * read. Two engines:
 *  - the phone's text-to-speech (paragraphs are queued ahead, so there are no silent gaps);
 *  - on-device neural voices (NeuralEngine), when the chosen voice is "neural:…".
 * A foreground service keeps it playing in the background, with lock-screen, notification and
 * headset controls.
 *
 * Items are plain strings, or {t, voice, pitch} objects (the two speakers of an AI discussion).
 */
final class Narrator implements NeuralEngine.Host {

    interface Listener {
        void onState(String state, int index, int total);
    }

    private static final class Item {
        final String text;
        final String voice;
        final float pitch;

        Item(String text, String voice, float pitch) {
            this.text = text;
            this.voice = voice;
            this.pitch = pitch;
        }
    }

    private static final int QUEUE_AHEAD = 2;
    private static Narrator instance;

    static Narrator get(Context ctx) {
        if (instance == null) instance = new Narrator(ctx.getApplicationContext());
        return instance;
    }

    private final Context app;
    private final Handler main = new Handler(Looper.getMainLooper());
    private TextToSpeech tts;
    private boolean ready;
    private final List<Runnable> onReady = new ArrayList<>();
    private String engine;
    private Listener listener;
    private final List<Item> items = new ArrayList<>();
    private String title = "";
    private String subtitle = "";
    private int index;
    private boolean playing;
    private float rate = 1f;
    private float pitch = 1f;
    private String voiceName;
    private String appliedVoice;
    private float appliedPitch = -1;
    private int stopAfter = -1;
    private long sleepAt;
    private long lastTransition;
    // Android TTS queue: utterance ids are "<generation>:<index>" so stale callbacks are ignored.
    private int generation;
    private int queuedTo = -1;
    // Neural voices
    private NeuralEngine neural;
    private int neuralGen = -1;
    private boolean useNeural;
    private boolean previewing;

    private final Runnable sleepTask = () -> {
        sleepAt = 0;
        pause();
        emit("sleep");
    };

    private Narrator(Context app) {
        this.app = app;
    }

    void setListener(Listener l) {
        listener = l;
    }

    private NeuralEngine neural() {
        if (neural == null) neural = new NeuralEngine(app, this);
        return neural;
    }

    // ------------------------------------------------------------------ Android TTS setup

    private void ensureTts(Runnable then) {
        if (tts != null && ready) { then.run(); return; }
        onReady.add(then);
        if (tts != null) return;
        TextToSpeech.OnInitListener init = status -> main.post(() -> {
            ready = status == TextToSpeech.SUCCESS;
            if (!ready) { onReady.clear(); emit("error"); return; }
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) { main.post(() -> onUtteranceStart(id)); }
                @Override public void onDone(String id) { main.post(() -> onUtteranceDone(id)); }
                @Override public void onError(String id) { main.post(() -> onUtteranceDone(id)); }
            });
            List<Runnable> rs = new ArrayList<>(onReady);
            onReady.clear();
            for (Runnable r : rs) r.run();
            emit("voices");
        });
        tts = engine == null || engine.isEmpty() ? new TextToSpeech(app, init) : new TextToSpeech(app, init, engine);
    }

    /** Starts the speech engine early so the voice list is ready when the Listen sheet opens. */
    void warm(String engineName) {
        if (tts == null) engine = engineName;
        main.post(() -> ensureTts(() -> { }));
    }

    /** Switches text-to-speech engine (e.g. Google vs Samsung), which brings its own voices. */
    void setEngine(String name) {
        String n = name == null ? "" : name;
        if (n.equals(engine == null ? "" : engine) && tts != null) return;
        boolean wasPlaying = playing && !useNeural;
        if (tts != null) { tts.stop(); tts.shutdown(); }
        tts = null;
        ready = false;
        engine = n;
        if (!NeuralEngine.isNeural(voiceName)) voiceName = null;
        appliedVoice = null;
        ensureTts(() -> { if (wasPlaying && !items.isEmpty()) speakFrom(index); });
    }

    // ------------------------------------------------------------------ public controls

    /** items: the paragraphs to read; starts at {@code start}. */
    void start(String title, JSONArray paragraphs, int start, float rate, float pitch, String voice) {
        haltOutput();
        items.clear();
        for (int i = 0; i < paragraphs.length(); i++) {
            JSONObject o = paragraphs.optJSONObject(i);
            if (o != null) {
                String v = o.optString("voice", "");
                items.add(new Item(o.optString("t"), v.isEmpty() ? null : v, (float) o.optDouble("pitch", 0)));
            } else {
                items.add(new Item(paragraphs.optString(i), null, 0));
            }
        }
        this.title = title == null ? "" : title;
        this.subtitle = "";
        this.index = Math.max(0, Math.min(start, items.size() - 1));
        this.rate = rate > 0 ? rate : 1f;
        this.pitch = pitch > 0 ? pitch : 1f;
        this.voiceName = voice;
        this.stopAfter = -1;
        this.previewing = false;
        playing = true;
        startService();
        speakFrom(index);
    }

    /** Speaks a short sample in the chosen voice (only while nothing is being read). */
    void preview(String voice) {
        if (playing && !items.isEmpty()) { setVoice(voice); return; }
        String sample = "This is how your documents will sound in this voice.";
        if (NeuralEngine.isNeural(voice)) {
            previewing = true;
            neuralGen = neural().play(new String[]{sample}, new String[]{voice}, 0, rate);
            return;
        }
        ensureTts(() -> {
            applyVoice(voice, pitch);
            tts.speak(sample, TextToSpeech.QUEUE_FLUSH, new Bundle(), "preview");
        });
    }

    void pause() {
        if (!playing) return;
        playing = false;
        haltOutput();
        emit("paused");
        updateService();
    }

    void resume() {
        if (playing || items.isEmpty()) return;
        playing = true;
        startService();
        speakFrom(index);
    }

    void toggle() {
        if (playing) pause(); else resume();
    }

    void seek(int i) {
        if (items.isEmpty()) return;
        index = Math.max(0, Math.min(i, items.size() - 1));
        if (playing) speakFrom(index); else { emit("paused"); updateService(); }
    }

    void skip(int delta) {
        seek(index + delta);
    }

    void setRate(float r) {
        rate = r;
        if (useNeural && playing) { neural().setRate(r); return; }
        if (tts != null) tts.setSpeechRate(rate);
        if (playing) speakFrom(index);
    }

    void setVoice(String name) {
        voiceName = name;
        appliedVoice = null;
        if (playing) speakFrom(index);
    }

    /** Line under the title in the notification and on the lock screen (the current section). */
    void setSubtitle(String s) {
        subtitle = s == null ? "" : s;
        updateService();
    }

    /** Sleep timer: pause after {@code minutes} (0 cancels). */
    void sleepIn(int minutes) {
        main.removeCallbacks(sleepTask);
        sleepAt = 0;
        if (minutes > 0) {
            sleepAt = System.currentTimeMillis() + minutes * 60_000L;
            main.postDelayed(sleepTask, minutes * 60_000L);
        }
    }

    /** Pause once paragraph {@code i} has been read (end of section / chapter); -1 cancels. */
    void stopAfter(int i) {
        stopAfter = i;
    }

    long sleepRemainingMs() {
        return sleepAt == 0 ? 0 : Math.max(0, sleepAt - System.currentTimeMillis());
    }

    void stop() {
        playing = false;
        main.removeCallbacks(sleepTask);
        sleepAt = 0;
        stopAfter = -1;
        haltOutput();
        if (neural != null) neural.abandonFocus();
        items.clear();
        emit("stopped");
        app.stopService(new Intent(app, NarratorService.class));
    }

    boolean isPlaying() { return playing; }
    String title() { return title; }
    String subtitle() { return subtitle; }
    int index() { return index; }
    int total() { return items.size(); }
    int stopAfterIndex() { return stopAfter; }

    /**
     * Media buttons arriving right as one paragraph ends and the next starts are usually
     * headphones pausing on their own when the audio stream stops, not the listener.
     */
    boolean nearTransition() {
        return System.currentTimeMillis() - lastTransition < 1500;
    }

    // ------------------------------------------------------------------ playback

    private void haltOutput() {
        generation++;
        queuedTo = -1;
        if (tts != null) tts.stop();
        if (neural != null) neural.stop();
        neuralGen = -1;
    }

    private void speakFrom(int i) {
        haltOutput();
        index = i;
        lastTransition = System.currentTimeMillis();
        useNeural = NeuralEngine.isNeural(voiceName) || (!items.isEmpty() && NeuralEngine.isNeural(items.get(0).voice));
        if (useNeural) {
            String[] texts = new String[items.size()];
            String[] voices = new String[items.size()];
            for (int k = 0; k < items.size(); k++) {
                Item it = items.get(k);
                texts[k] = it.text;
                voices[k] = NeuralEngine.isNeural(it.voice) ? it.voice : voiceName;
            }
            previewing = false;
            neuralGen = neural().play(texts, voices, i, rate);
            emit("playing");
            updateService();
            return;
        }
        final int gen = generation;
        ensureTts(() -> {
            if (gen != generation || !playing) return;
            enqueue(i, TextToSpeech.QUEUE_FLUSH);
            topUp();
            emit("playing");
            updateService();
        });
    }

    /** Keeps the next paragraphs queued so the engine never goes silent between them. */
    private void topUp() {
        int limit = items.size() - 1;
        if (stopAfter >= 0) limit = Math.min(limit, stopAfter);
        while (queuedTo < Math.min(limit, index + QUEUE_AHEAD)) enqueue(queuedTo + 1, TextToSpeech.QUEUE_ADD);
    }

    private void enqueue(int i, int mode) {
        Item it = items.get(i);
        applyVoice(it.voice, it.pitch);
        tts.speak(it.text, mode, new Bundle(), generation + ":" + i);
        queuedTo = i;
    }

    private int parse(String id) {
        int c = id == null ? -1 : id.indexOf(':');
        if (c < 0) return -1;
        try {
            if (Integer.parseInt(id.substring(0, c)) != generation) return -1;
            return Integer.parseInt(id.substring(c + 1));
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    private void onUtteranceStart(String id) {
        int i = parse(id);
        if (i < 0 || !playing) return;
        lastTransition = System.currentTimeMillis();
        index = i;
        emit("playing");
        updateService();
        topUp();
    }

    private void onUtteranceDone(String id) {
        int i = parse(id);
        if (i < 0 || !playing) return;
        lastTransition = System.currentTimeMillis();
        finishedThrough(i);
    }

    /** Called when paragraph {@code i} has been read and nothing more is queued after it. */
    private void finishedThrough(int i) {
        if (stopAfter >= 0 && i >= stopAfter) {
            stopAfter = -1;
            haltOutput();
            index = Math.min(i + 1, items.size() - 1);
            playing = false;
            emit("sleep");
            updateService();
            return;
        }
        if (i >= items.size() - 1) {
            haltOutput();
            playing = false;
            emit("ended");
            updateService();
        }
    }

    // ------------------------------------------------------------------ NeuralEngine.Host (called on engine threads)

    @Override
    public void onItemStart(int gen, int item) {
        main.post(() -> {
            if (gen != neuralGen || previewing || !playing) return;
            lastTransition = System.currentTimeMillis();
            index = item;
            emit("playing");
            updateService();
        });
    }

    @Override
    public void onItemsDone(int gen, int lastItem) {
        main.post(() -> {
            if (gen != neuralGen) return;
            if (previewing) { previewing = false; return; }
            if (!playing) return;
            lastTransition = System.currentTimeMillis();
            finishedThrough(lastItem < 0 ? index : lastItem);
        });
    }

    @Override
    public void onBuffering(int gen) {
        main.post(() -> { if (gen == neuralGen && playing && !previewing) emit("buffering"); });
    }

    @Override
    public void onError(int gen, String message) {
        main.post(() -> {
            if (gen != neuralGen) return;
            previewing = false;
            if (listener != null) listener.onState("error:" + message, index, items.size());
            pause();
        });
    }

    @Override
    public void onFocusLost() {
        main.post(this::pause);
    }

    @Override
    public int stopAfter() {
        return stopAfter;
    }

    // ------------------------------------------------------------------ voices

    /** Engines and installed voices, best-quality local English first; plus neural voice packs. */
    String voices() {
        JSONArray out = new JSONArray();
        JSONObject res = new JSONObject();
        try { res.put("neural", VoiceStore.catalog(app)); } catch (Exception ignored) { }
        if (tts == null || !ready) {
            main.post(() -> ensureTts(() -> { }));
            try { res.put("ready", false).put("voices", out).put("engines", new JSONArray()); } catch (Exception ignored) { }
            return res.toString();
        }
        try {
            JSONArray engines = new JSONArray();
            for (TextToSpeech.EngineInfo e : tts.getEngines()) engines.put(new JSONObject().put("name", e.name).put("label", e.label));
            res.put("ready", true).put("engines", engines)
                    .put("engine", engine == null || engine.isEmpty() ? tts.getDefaultEngine() : engine)
                    .put("voices", out);
            Set<Voice> vs = tts.getVoices();
            if (vs == null) return res.toString();
            List<Voice> list = new ArrayList<>(vs);
            list.sort((a, b) -> {
                boolean ea = a.getLocale().getLanguage().equals("en"), eb = b.getLocale().getLanguage().equals("en");
                if (ea != eb) return ea ? -1 : 1;
                if (a.isNetworkConnectionRequired() != b.isNetworkConnectionRequired()) return a.isNetworkConnectionRequired() ? 1 : -1;
                return b.getQuality() - a.getQuality();
            });
            for (Voice v : list) {
                if (v.getFeatures() != null && v.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)) continue;
                out.put(new JSONObject()
                        .put("name", v.getName())
                        .put("locale", v.getLocale().getDisplayName(Locale.ENGLISH))
                        .put("lang", v.getLocale().toLanguageTag())
                        .put("quality", v.getQuality())
                        .put("network", v.isNetworkConnectionRequired()));
                if (out.length() >= 120) break;
            }
        } catch (Exception ignored) {
        }
        return res.toString();
    }

    /** Sets the voice and pitch only when they change (switching voices has a small cost). */
    private void applyVoice(String itemVoice, float itemPitch) {
        if (tts == null || !ready) return;
        tts.setSpeechRate(rate);
        float p = itemPitch > 0 ? itemPitch : pitch;
        if (p != appliedPitch) { tts.setPitch(p); appliedPitch = p; }
        String want = itemVoice != null && !itemVoice.isEmpty() && !NeuralEngine.isNeural(itemVoice) ? itemVoice : voiceName;
        if (want == null || NeuralEngine.isNeural(want)) want = "";
        if (want.equals(appliedVoice)) return;
        appliedVoice = want;
        if (!want.isEmpty()) {
            try {
                for (Voice v : tts.getVoices()) {
                    if (v.getName().equals(want)) { tts.setVoice(v); return; }
                }
            } catch (Exception ignored) {
            }
        }
        tts.setLanguage(Locale.getDefault().getLanguage().equals("en") ? Locale.getDefault() : Locale.US);
    }

    private void emit(String state) {
        if (listener != null) listener.onState(state, index, items.size());
    }

    private void startService() {
        Intent i = new Intent(app, NarratorService.class);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) app.startForegroundService(i);
            else app.startService(i);
        } catch (Exception ignored) {
            // Starting a foreground service from the background can be refused; playback continues.
        }
    }

    private void updateService() {
        NarratorService.refresh();
    }
}
