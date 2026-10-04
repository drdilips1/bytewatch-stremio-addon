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

    static final String DEFAULT_MODEL = "gemini-2.5-flash";
    private static final String BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

    private final String apiKey;
    private final String model;

    GeminiProvider(String apiKey, String model) {
        this.apiKey = apiKey;
        this.model = model == null || model.isEmpty() || !model.startsWith("gemini") ? DEFAULT_MODEL : model;
    }

    @Override
    public Result complete(String system, String document, String task, int maxTokens, String jsonSchema) throws AiException {
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
                body.put("contents", new JSONArray().put(new JSONObject().put("role", "user")
                        .put("parts", new JSONArray().put(new JSONObject().put("text", user)))));
                JSONObject gen = new JSONObject().put("maxOutputTokens", Math.max(1024, maxTokens)).put("temperature", 0.3);
                if (jsonSchema != null && !jsonSchema.isEmpty()) gen.put("responseMimeType", "application/json");
                body.put("generationConfig", gen);

                HttpURLConnection c = (HttpURLConnection) new URL(BASE + model + ":generateContent").openConnection();
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
                    if (attempt < 3) {
                        Thread.sleep(6000L * (attempt + 1));
                        continue;
                    }
                    throw new AiException(code == 429
                            ? "Gemini's free limit was reached. Wait a minute (or until tomorrow for the daily limit) and try again."
                            : "Gemini is busy right now. Try again in a minute.");
                }
                if (code >= 400) {
                    String msg = "";
                    try { msg = new JSONObject(text).getJSONObject("error").optString("message"); } catch (Exception ignored) { }
                    if (code == 400 && msg.toLowerCase().contains("api key")) throw new AiException("Your Gemini API key was rejected. Check it in Settings → AI.");
                    if (code == 403) throw new AiException("Your Gemini API key isn't allowed to use this model. Check it in Settings → AI.");
                    throw new AiException("Gemini returned an error (" + code + ")" + (msg.isEmpty() ? "." : ": " + msg));
                }
                JSONObject res = new JSONObject(text);
                JSONArray cands = res.optJSONArray("candidates");
                StringBuilder out = new StringBuilder();
                if (cands != null && cands.length() > 0) {
                    JSONArray parts = cands.getJSONObject(0).optJSONObject("content") == null ? null
                            : cands.getJSONObject(0).getJSONObject("content").optJSONArray("parts");
                    for (int i = 0; parts != null && i < parts.length(); i++) {
                        JSONObject p = parts.getJSONObject(i);
                        if (!p.optBoolean("thought", false)) out.append(p.optString("text", ""));
                    }
                }
                String answer = out.toString().trim();
                if (answer.isEmpty()) throw new AiException("Gemini returned an empty answer. Try again.");
                JSONObject usage = res.optJSONObject("usageMetadata");
                long inTok = usage == null ? 0 : usage.optLong("promptTokenCount");
                long outTok = usage == null ? 0 : usage.optLong("candidatesTokenCount");
                long cached = usage == null ? 0 : usage.optLong("cachedContentTokenCount");
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

    private static String slurp(InputStream in) throws IOException {
        try (InputStream is = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[16384];
            int n;
            while ((n = is.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString("UTF-8");
        }
    }
}
