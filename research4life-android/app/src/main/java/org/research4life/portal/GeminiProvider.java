package org.research4life.portal;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Google Gemini (free key from aistudio.google.com) through its REST API. Its free tier takes far
 * more text per minute than Groq's, so evidence maps over dozens of abstracts fit in one request.
 */
final class GeminiProvider implements LlmProvider {

    static final String DEFAULT_MODEL = "gemini-3.8-flash";
    private static final String BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

    private final String apiKey;
    private String model;
    /** A model that answered on this phone after the chosen one had no free allowance (kept for this run). */
    private static volatile String workingModel;
    /** Models Google said have no free allowance for this key ("limit: 0"). */
    private final java.util.Set<String> noQuota = new java.util.HashSet<>();
    /** Whether to send the answer's JSON Schema (turned off if this model/API rejects it). */
    private boolean sendSchema = true;
    /** Extra room for the model's "thinking", which counts against maxOutputTokens on Gemini 2.5+. */
    private int headroom = 16384;
    /** Short thinking: much faster answers for summaries and deep dives (dropped if the model refuses it). */
    private boolean lightThinking = true;

    GeminiProvider(String apiKey, String model) {
        this.apiKey = apiKey;
        this.model = model == null || model.isEmpty() || !model.startsWith("gemini") ? DEFAULT_MODEL : model;
        if (workingModel != null && DEFAULT_MODEL.equals(this.model)) this.model = workingModel;
    }

    /**
     * Another Gemini model this key may use for free: Google lists the key's models; Flash models
     * that generate text come first (newest first), then Flash-Lite. Null when there is none left.
     */
    private String nextFreeModel() {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200").openConnection(java.net.Proxy.NO_PROXY);
            c.setConnectTimeout(15000);
            c.setReadTimeout(20000);
            c.setRequestProperty("x-goog-api-key", apiKey);
            if (c.getResponseCode() >= 400) { c.disconnect(); return null; }
            JSONArray list = new JSONObject(slurp(c.getInputStream())).optJSONArray("models");
            c.disconnect();
            java.util.List<String> names = new java.util.ArrayList<>();
            for (int i = 0; list != null && i < list.length(); i++) {
                JSONObject m = list.getJSONObject(i);
                String name = m.optString("name").replaceFirst("^models/", "");
                if (!name.startsWith("gemini") || !name.contains("flash")) continue;
                if (name.matches(".*(image|tts|audio|live|embed|vision).*")) continue;
                JSONArray ways = m.optJSONArray("supportedGenerationMethods");
                if (ways == null || !ways.toString().contains("generateContent")) continue;
                if (noQuota.contains(name) || name.equals(model)) continue;
                names.add(name);
            }
            names.sort((a, b) -> {
                int la = a.contains("lite") ? 1 : 0, lb = b.contains("lite") ? 1 : 0;
                if (la != lb) return la - lb;
                int pa = a.contains("preview") || a.contains("exp") ? 1 : 0, pb = b.contains("preview") || b.contains("exp") ? 1 : 0;
                if (pa != pb) return pa - pb;
                return b.compareTo(a); // newer version numbers first
            });
            return names.isEmpty() ? null : names.get(0);
        } catch (Exception e) {
            return null;
        }
    }

    /** Answers about an image (JPEG, base64): Gemini models read images natively. */
    Result completeWithImage(String system, String task, String base64Jpeg, int maxTokens) throws AiException {
        return run(system, null, task, maxTokens, null, base64Jpeg);
    }

    @Override
    public Result complete(String system, String document, String task, int maxTokens, String jsonSchema) throws AiException {
        return run(system, document, task, maxTokens, jsonSchema, null);
    }

    private Result run(String system, String document, String task, int maxTokens, String jsonSchema, String imageB64) throws AiException {
        for (int attempt = 0; ; attempt++) {
            try {
                JSONObject body = new JSONObject();
                String sys = system == null ? "" : system;
                if (jsonSchema != null && !jsonSchema.isEmpty()) {
                    sys += "\nReply with JSON only, matching this JSON Schema: " + jsonSchema;
                }
                if (!sys.isEmpty()) {
                    body.put("systemInstruction", new JSONObject().put("parts", new JSONArray().put(new JSONObject().put("text", sys))));
                }
                String user = document == null || document.isEmpty() ? task : "<document>\n" + document + "\n</document>\n\n" + task;
                JSONArray parts = new JSONArray();
                if (imageB64 != null) {
                    parts.put(new JSONObject().put("inlineData", new JSONObject().put("mimeType", "image/jpeg").put("data", imageB64)));
                }
                parts.put(new JSONObject().put("text", user));
                body.put("contents", new JSONArray().put(new JSONObject().put("role", "user").put("parts", parts)));
                JSONObject gen = new JSONObject().put("maxOutputTokens", Math.min(65536, Math.max(1024, maxTokens) + headroom)).put("temperature", 0.3);
                if (lightThinking) {
                    // Gemini 3.x takes a thinking level; 2.5 a token budget.
                    gen.put("thinkingConfig", model.startsWith("gemini-2") ? new JSONObject().put("thinkingBudget", 1024)
                            : new JSONObject().put("thinkingLevel", "low"));
                }
                if (jsonSchema != null && !jsonSchema.isEmpty()) {
                    gen.put("responseMimeType", "application/json");
                    // Constrains the answer to the exact structure, so it always parses.
                    if (sendSchema) gen.put("responseJsonSchema", new JSONObject(jsonSchema));
                }
                body.put("generationConfig", gen);

                HttpURLConnection c = (HttpURLConnection) new URL(BASE + model + ":generateContent").openConnection(java.net.Proxy.NO_PROXY);
                c.setConnectTimeout(20000);
                c.setReadTimeout(240000);
                c.setRequestMethod("POST");
                c.setDoOutput(true);
                c.setRequestProperty("x-goog-api-key", apiKey);
                c.setRequestProperty("Content-Type", "application/json");
                try (OutputStream os = c.getOutputStream()) {
                    os.write(body.toString().getBytes(StandardCharsets.UTF_8));
                }
                int code = c.getResponseCode();
                InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
                String text = in == null ? "" : slurp(in);
                c.disconnect();
                if (code == 429 || code == 503) {
                    String why = "";
                    try { why = new JSONObject(text).getJSONObject("error").optString("message"); } catch (Exception ignored) { }
                    // "limit: 0": this model has no free allowance on this key; try another free model.
                    // Free allowances are per model, so a used-up daily limit is worth another model too.
                    if (code == 429 && why.matches("(?is).*(limit:\\s*0\\b|per ?day|daily).*") && noQuota.size() < 4) {
                        noQuota.add(model);
                        String next = nextFreeModel();
                        if (next != null) { model = next; attempt = -1; continue; }
                    }
                    boolean daily = why.matches("(?is).*(per ?day|daily).*");
                    boolean noFree = why.matches("(?is).*limit:\\s*0\\b.*");
                    if (attempt < 3 && !daily && !noFree) {
                        Thread.sleep(6000L * (attempt + 1));
                        continue;
                    }
                    String g = why.isEmpty() ? "" : " (Google: " + (why.length() > 160 ? why.substring(0, 160) + "…" : why) + ")";
                    throw new AiException(code == 429
                            ? (noFree ? "Your Gemini key has no free allowance for " + model + " (or any other free Gemini model it could find)."
                               : daily ? "Gemini's free daily limit for " + model + " is used up. It resets tomorrow." : "Gemini's free limit was reached. Wait a minute and try again.") + g
                            : "Gemini is busy right now. Try again in a minute.");
                }
                if (code >= 400) {
                    String msg = "";
                    try { msg = new JSONObject(text).getJSONObject("error").optString("message"); } catch (Exception ignored) { }
                    if (code == 400 && lightThinking && msg.toLowerCase().contains("thinking")) {
                        lightThinking = false; // this model doesn't take the setting: use its default
                        attempt--;
                        continue;
                    }
                    if (code == 400 && sendSchema && jsonSchema != null && msg.toLowerCase().matches("(?s).*(schema|unknown name|invalid json payload).*")) {
                        sendSchema = false; // this model doesn't take a schema: rely on the instructions
                        attempt--;
                        continue;
                    }
                    // Google retires models ("…is no longer available… use models/gemini-X"): switch and retry once.
                    if (code == 404 && attempt < 4) {
                        java.util.regex.Matcher m = java.util.regex.Pattern.compile("use models/(gemini-[\\w.-]+)").matcher(msg);
                        String next = m.find() ? m.group(1) : DEFAULT_MODEL.equals(model) ? null : DEFAULT_MODEL;
                        if (next != null && !next.equals(model)) {
                            model = next;
                            attempt = 3; // one model switch, no rate-limit retries on top
                            continue;
                        }
                    }
                    if (code == 400 && msg.toLowerCase().contains("api key")) throw new AiException("Your Gemini API key was rejected. Check it in Settings → AI.");
                    if (code == 403) throw new AiException("Your Gemini API key isn't allowed to use this model. Check it in Settings → AI.");
                    throw new AiException("Gemini returned an error (" + code + ")" + (msg.isEmpty() ? "." : ": " + msg));
                }
                JSONObject res = new JSONObject(text);
                JSONArray cands = res.optJSONArray("candidates");
                StringBuilder out = new StringBuilder();
                if (cands != null && cands.length() > 0) {
                    JSONArray outParts = cands.getJSONObject(0).optJSONObject("content") == null ? null
                            : cands.getJSONObject(0).getJSONObject("content").optJSONArray("parts");
                    for (int i = 0; outParts != null && i < outParts.length(); i++) {
                        JSONObject p = outParts.getJSONObject(i);
                        if (!p.optBoolean("thought", false)) out.append(p.optString("text", ""));
                    }
                }
                String finish = cands != null && cands.length() > 0 ? cands.getJSONObject(0).optString("finishReason") : "";
                if ("MAX_TOKENS".equals(finish) && headroom < 48000) {
                    // Cut off (usually by long thinking): once more with much more room.
                    headroom = 48000;
                    attempt--;
                    continue;
                }
                String answer = out.toString().trim();
                if ("MAX_TOKENS".equals(finish)) answer += "\n\n_(The answer was cut off at the length limit. Tap Regenerate for a complete one.)_";
                if (answer.isEmpty()) throw new AiException("Gemini returned an empty answer. Try again.");
                JSONObject usage = res.optJSONObject("usageMetadata");
                long inTok = usage == null ? 0 : usage.optLong("promptTokenCount");
                long outTok = usage == null ? 0 : usage.optLong("candidatesTokenCount");
                long cached = usage == null ? 0 : usage.optLong("cachedContentTokenCount");
                workingModel = model;
                return new Result(answer, model, Math.max(0, inTok - cached), outTok, cached);
            } catch (AiException e) {
                throw e;
            } catch (IOException e) {
                throw new AiException("Couldn't reach Gemini. Check your connection.");
            } catch (InterruptedException e) {
                throw new AiException("Cancelled");
            } catch (Exception e) {
                throw new AiException("Gemini request failed: " + e.getClass().getSimpleName());
            }
        }
    }

    /** Streams a plain text answer (Server-Sent Events); any problem falls back to the normal request. */
    @Override
    public Result completeStream(String system, String document, String task, int maxTokens, TextListener l) throws AiException {
        HttpURLConnection c = null;
        try {
            JSONObject body = new JSONObject();
            if (system != null && !system.isEmpty()) {
                body.put("systemInstruction", new JSONObject().put("parts", new JSONArray().put(new JSONObject().put("text", system))));
            }
            String user = document == null || document.isEmpty() ? task : "<document>\n" + document + "\n</document>\n\n" + task;
            body.put("contents", new JSONArray().put(new JSONObject().put("role", "user")
                    .put("parts", new JSONArray().put(new JSONObject().put("text", user)))));
            JSONObject gen = new JSONObject().put("maxOutputTokens", Math.min(65536, Math.max(1024, maxTokens) + headroom)).put("temperature", 0.3);
            if (lightThinking) {
                gen.put("thinkingConfig", model.startsWith("gemini-2") ? new JSONObject().put("thinkingBudget", 1024)
                        : new JSONObject().put("thinkingLevel", "low"));
            }
            body.put("generationConfig", gen);
            c = (HttpURLConnection) new URL(BASE + model + ":streamGenerateContent?alt=sse").openConnection(java.net.Proxy.NO_PROXY);
            c.setConnectTimeout(20000);
            c.setReadTimeout(240000);
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setRequestProperty("x-goog-api-key", apiKey);
            c.setRequestProperty("Content-Type", "application/json");
            try (OutputStream os = c.getOutputStream()) {
                os.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            if (c.getResponseCode() >= 400) {
                c.disconnect();
                return complete(system, document, task, maxTokens, null); // retries, model switch, error messages
            }
            StringBuilder out = new StringBuilder();
            long inTok = 0, outTok = 0, cached = 0, last = 0;
            String finish = "";
            try (java.io.BufferedReader r = new java.io.BufferedReader(new java.io.InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8))) {
                for (String line; (line = r.readLine()) != null; ) {
                    if (!line.startsWith("data:")) continue;
                    JSONObject o = new JSONObject(line.substring(5).trim());
                    JSONArray cands = o.optJSONArray("candidates");
                    if (cands != null && cands.length() > 0) {
                        JSONObject cand = cands.getJSONObject(0);
                        JSONArray parts = cand.optJSONObject("content") == null ? null : cand.getJSONObject("content").optJSONArray("parts");
                        for (int i = 0; parts != null && i < parts.length(); i++) {
                            JSONObject pt = parts.getJSONObject(i);
                            if (!pt.optBoolean("thought", false)) out.append(pt.optString("text", ""));
                        }
                        if (cand.has("finishReason")) finish = cand.optString("finishReason");
                    }
                    JSONObject u = o.optJSONObject("usageMetadata");
                    if (u != null) {
                        inTok = u.optLong("promptTokenCount");
                        outTok = u.optLong("candidatesTokenCount");
                        cached = u.optLong("cachedContentTokenCount");
                    }
                    long now = System.currentTimeMillis();
                    if (now - last > 250 && out.length() > 0) { last = now; l.onText(out.toString()); }
                }
            }
            String text = out.toString().trim();
            if (text.isEmpty()) return complete(system, document, task, maxTokens, null);
            if ("MAX_TOKENS".equals(finish)) text += "\n\n_(The answer was cut off at the length limit. Tap Regenerate for a complete one.)_";
            l.onText(text);
            workingModel = model;
            return new Result(text, model, Math.max(0, inTok - cached), outTok, cached);
        } catch (AiException e) {
            throw e;
        } catch (Exception e) {
            if (c != null) c.disconnect();
            return complete(system, document, task, maxTokens, null);
        }
    }

    private static String slurp(InputStream in) throws IOException {
        try (InputStream is = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[16384];
            int n;
            while ((n = is.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString("UTF-8");
        }
    }
}
