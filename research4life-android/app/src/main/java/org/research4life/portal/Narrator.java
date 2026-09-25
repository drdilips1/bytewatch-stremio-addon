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
 * Reads a paper aloud with the phone's text-to-speech engine, one paragraph at a time, so the
 * app can highlight the paragraph being read. A foreground service keeps it playing in the
 * background with notification controls.
 */
final class Narrator {

    interface Listener {
        void onState(String state, int index, int total);
    }

    private static Narrator instance;

    static Narrator get(Context ctx) {
        if (instance == null) instance = new Narrator(ctx.getApplicationContext());
        return instance;
    }

    private final Context app;
    private final Handler main = new Handler(Looper.getMainLooper());
    private TextToSpeech tts;
    private boolean ready;
    private Runnable onReady;
    private Listener listener;
    private final List<String> items = new ArrayList<>();
    private String title = "";
    private int index;
    private boolean playing;
    private float rate = 1f;
    private float pitch = 1f;
    private String voiceName;

    private Narrator(Context app) {
        this.app = app;
    }

    void setListener(Listener l) {
        listener = l;
    }

    private void ensureTts(Runnable then) {
        if (tts != null && ready) { then.run(); return; }
        onReady = then;
        if (tts != null) return;
        tts = new TextToSpeech(app, status -> main.post(() -> {
            ready = status == TextToSpeech.SUCCESS;
            if (!ready) { emit("error"); return; }
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) { }
                @Override public void onDone(String id) { main.post(() -> onDone(id)); }
                @Override public void onError(String id) { main.post(() -> onDone(id)); }
            });
            applyVoice();
            Runnable r = onReady;
            onReady = null;
            if (r != null) r.run();
        }));
    }

    /** items: the paragraphs to read; starts at {@code start}. */
    void start(String title, JSONArray paragraphs, int start, float rate, float pitch, String voice) {
        items.clear();
        for (int i = 0; i < paragraphs.length(); i++) items.add(paragraphs.optString(i));
        this.title = title == null ? "" : title;
        this.index = Math.max(0, Math.min(start, items.size() - 1));
        this.rate = rate > 0 ? rate : 1f;
        this.pitch = pitch > 0 ? pitch : 1f;
        this.voiceName = voice;
        ensureTts(() -> {
            applyVoice();
            playing = true;
            startService();
            speakCurrent();
        });
    }

    void pause() {
        if (!playing) return;
        playing = false;
        if (tts != null) tts.stop();
        emit("paused");
        updateService();
    }

    void resume() {
        if (playing || items.isEmpty()) return;
        ensureTts(() -> {
            playing = true;
            speakCurrent();
            updateService();
        });
    }

    void toggle() {
        if (playing) pause(); else resume();
    }

    void seek(int i) {
        if (items.isEmpty()) return;
        index = Math.max(0, Math.min(i, items.size() - 1));
        if (playing) speakCurrent(); else emit("paused");
    }

    void skip(int delta) {
        seek(index + delta);
    }

    void setRate(float r) {
        rate = r;
        if (tts != null) tts.setSpeechRate(rate);
        if (playing) speakCurrent();
    }

    void setVoice(String name) {
        voiceName = name;
        applyVoice();
        if (playing) speakCurrent();
    }

    void stop() {
        playing = false;
        if (tts != null) tts.stop();
        items.clear();
        emit("stopped");
        app.stopService(new Intent(app, NarratorService.class));
    }

    boolean isPlaying() { return playing; }
    String title() { return title; }
    int index() { return index; }
    int total() { return items.size(); }

    /** Installed voices, best-quality local English first. */
    String voices() {
        JSONArray out = new JSONArray();
        if (tts == null || !ready) {
            ensureTts(() -> { });
            return out.toString();
        }
        try {
            Set<Voice> vs = tts.getVoices();
            if (vs == null) return out.toString();
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
                        .put("quality", v.getQuality())
                        .put("network", v.isNetworkConnectionRequired()));
                if (out.length() >= 40) break;
            }
        } catch (Exception ignored) {
        }
        return out.toString();
    }

    private void applyVoice() {
        if (tts == null || !ready) return;
        tts.setSpeechRate(rate);
        tts.setPitch(pitch);
        if (voiceName != null && !voiceName.isEmpty()) {
            try {
                for (Voice v : tts.getVoices()) {
                    if (v.getName().equals(voiceName)) { tts.setVoice(v); return; }
                }
            } catch (Exception ignored) {
            }
        }
        tts.setLanguage(Locale.getDefault().getLanguage().equals("en") ? Locale.getDefault() : Locale.US);
    }

    private void speakCurrent() {
        if (tts == null || items.isEmpty()) return;
        String text = items.get(index);
        Bundle params = new Bundle();
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, params, "p" + index);
        emit("playing");
        updateService();
    }

    private void onDone(String id) {
        if (!playing || !("p" + index).equals(id)) return;
        if (index + 1 >= items.size()) {
            playing = false;
            emit("ended");
            updateService();
            return;
        }
        index++;
        speakCurrent();
    }

    private void emit(String state) {
        if (listener != null) listener.onState(state, index, items.size());
    }

    private void startService() {
        Intent i = new Intent(app, NarratorService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) app.startForegroundService(i);
        else app.startService(i);
    }

    private void updateService() {
        NarratorService.refresh();
    }
}
