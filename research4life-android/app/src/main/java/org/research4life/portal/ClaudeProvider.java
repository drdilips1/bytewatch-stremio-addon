package org.research4life.portal;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Claude, called with the user's own Anthropic API key over the Messages API directly
 * (no SDK: the SDK and its dependencies were over a third of the APK).
 */
final class ClaudeProvider implements LlmProvider {

    static final String DEFAULT_MODEL = "claude-sonnet-5-5";
    private static final String URL_MESSAGES = "https://api.anthropic.com/v1/messages";
    /** Models that take the server-side refusal fallback ("default" routing). */
    private static boolean takesFallback(String m) {
        return m.equals("claude-opus-5-5") || m.equals("claude-opus-5") || m.equals("claude-fable-5-1") || m.equals("claude-sonnet-5-5");
    }

    private final String apiKey;
    private final String model;

    ClaudeProvider(String apiKey, String model) {
        this.apiKey = apiKey;
        this.model = model == null || model.isEmpty() ? DEFAULT_MODEL : model;
    }

    @Override
    public Result complete(String system, String document, String task, int maxTokens, String jsonSchema) throws AiException {
        JSONObject body = new JSONObject();
        try {
            JSONArray content = new JSONArray();
            if (document != null && !document.isEmpty()) {
                // The document goes first with a cache breakpoint: repeat questions about it reuse the cache.
                content.put(new JSONObject().put("type", "text").put("text", document)
                        .put("cache_control", new JSONObject().put("type", "ephemeral")));
            }
            content.put(new JSONObject().put("type", "text").put("text", task));
            body.put("model", model)
                    .put("max_tokens", maxTokens)
                    .put("system", system == null ? "" : system)
                    .put("messages", new JSONArray().put(new JSONObject().put("role", "user").put("content", content)));
            JSONObject outputConfig = new JSONObject();
            // Haiku 4.5 doesn't take an effort setting; the newer models do (Opus 5.5 defaults to medium anyway).
            if (!model.startsWith("claude-haiku")) outputConfig.put("effort", "medium");
            if (jsonSchema != null && !jsonSchema.isEmpty()) {
                outputConfig.put("format", new JSONObject().put("type", "json_schema").put("schema", new JSONObject(jsonSchema)));
            }
            if (outputConfig.length() > 0) body.put("output_config", outputConfig);
            if (takesFallback(model)) body.put("fallbacks", "default");
        } catch (Exception e) {
            throw new AiException("Internal error: bad answer format");
        }

        JSONObject msg = post(body);
        if ("refusal".equals(msg.optString("stop_reason"))) throw new AiException("Claude declined this request.");
        StringBuilder out = new StringBuilder();
        JSONArray blocks = msg.optJSONArray("content");
        for (int i = 0; blocks != null && i < blocks.length(); i++) {
            JSONObject b = blocks.optJSONObject(i);
            if (b != null && "text".equals(b.optString("type"))) out.append(b.optString("text"));
        }
        if (out.length() == 0) {
            if ("max_tokens".equals(msg.optString("stop_reason"))) throw new AiException("The answer was cut off. Try again, or use a shorter request.");
            throw new AiException("Claude returned an empty answer. Try again.");
        }
        JSONObject u = msg.optJSONObject("usage");
        long in = u == null ? 0 : u.optLong("input_tokens") + u.optLong("cache_read_input_tokens") + u.optLong("cache_creation_input_tokens");
        return new Result(out.toString().trim(), msg.optString("model", model), in,
                u == null ? 0 : u.optLong("output_tokens"), u == null ? 0 : u.optLong("cache_read_input_tokens"));
    }

    private JSONObject post(JSONObject body) throws AiException {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(URL_MESSAGES).openConnection(java.net.Proxy.NO_PROXY);
            c.setRequestMethod("POST");
            c.setConnectTimeout(20_000);
            c.setReadTimeout(300_000);
            c.setDoOutput(true);
            c.setRequestProperty("content-type", "application/json");
            c.setRequestProperty("x-api-key", apiKey);
            c.setRequestProperty("anthropic-version", "2023-06-01");
            if (takesFallback(model)) c.setRequestProperty("anthropic-beta", "server-side-fallback-2026-07-01");
            try (OutputStream os = c.getOutputStream()) {
                os.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            int code = c.getResponseCode();
            String text = read(code >= 400 ? c.getErrorStream() : c.getInputStream());
            if (code >= 400) {
                String m = "";
                try { m = new JSONObject(text).optJSONObject("error").optString("message"); } catch (Exception ignored) { }
                String lm = m.toLowerCase();
                if (code == 401) throw new AiException("Your Claude API key was rejected. Check it in Settings → AI.");
                if (code == 403) throw new AiException("This API key can't use " + model + ". Pick another model in Settings → AI.");
                if (code == 404) throw new AiException("Model " + model + " isn't available to this key. Pick another model in Settings → AI.");
                if (code == 429 || code == 529) throw new AiException("Claude is busy or your usage limit was reached. Try again in a minute.");
                if (code == 400) {
                    if (lm.contains("credit")) throw new AiException("Your Anthropic account is out of credit.");
                    if (lm.contains("too long") || lm.contains("context")) throw new AiException("This document is too long for one request.");
                    throw new AiException("Claude couldn't process this request" + (m.isEmpty() ? " (400)." : ": " + m));
                }
                throw new AiException("Claude returned an error (" + code + "). Try again.");
            }
            return new JSONObject(text);
        } catch (AiException e) {
            throw e;
        } catch (java.io.IOException e) {
            throw new AiException("Couldn't reach Claude. Check your connection.");
        } catch (Exception e) {
            throw new AiException("Claude request failed: " + e.getClass().getSimpleName());
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static String read(InputStream in) throws java.io.IOException {
        if (in == null) return "";
        try (InputStream s = in) {
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            for (int n; (n = s.read(buf)) > 0; ) b.write(buf, 0, n);
            return b.toString("UTF-8");
        }
    }
}
