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
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Groq (GroqCloud, OpenAI-compatible chat completions) with the user's own API key.
 * Free-tier keys have small per-minute token limits, so a request that is too large fails
 * with "TOO_LARGE:&lt;limit&gt;:&lt;requested&gt;"; the web app then retries with selected excerpts.
 */
final class GroqProvider implements LlmProvider {

    static final String DEFAULT_MODEL = "openai/gpt-oss-120b";
    private static final String BASE = "https://api.groq.com/openai/v1/";
    private static final Pattern LIMIT = Pattern.compile("Limit (\\d+), Requested (\\d+)");

    private final String apiKey;
    private final String model;

    GroqProvider(String apiKey, String model) {
        this.apiKey = apiKey;
        this.model = model == null || model.isEmpty() ? DEFAULT_MODEL : model;
    }

    /** Structured outputs are guaranteed (strict) only on these models. */
    private boolean strictJson() {
        return model.startsWith("openai/gpt-oss") || model.startsWith("qwen/");
    }

    @Override
    public Result complete(String system, String document, String task, int maxTokens, String jsonSchema) throws AiException {
        try {
            JSONObject body = new JSONObject();
            body.put("model", model);
            JSONArray messages = new JSONArray();
            messages.put(new JSONObject().put("role", "system").put("content", system));
            // Document first, task last: repeat questions about the same document share a cacheable prefix.
            String user = document == null || document.isEmpty() ? task : "<document>\n" + document + "\n</document>\n\n" + task;
            messages.put(new JSONObject().put("role", "user").put("content", user));
            body.put("messages", messages);
            body.put("max_completion_tokens", maxTokens);
            if (model.startsWith("openai/gpt-oss")) {
                body.put("reasoning_effort", "low");
                body.put("include_reasoning", false);
            }
            if (jsonSchema != null && !jsonSchema.isEmpty()) {
                if (strictJson()) {
                    body.put("response_format", new JSONObject().put("type", "json_schema").put("json_schema",
                            new JSONObject().put("name", "answer").put("strict", true).put("schema", new JSONObject(jsonSchema))));
                } else {
                    body.put("response_format", new JSONObject().put("type", "json_object"));
                    messages.getJSONObject(0).put("content", system + "\nReply with JSON only, matching this JSON Schema: " + jsonSchema);
                }
            }
            JSONObject res = post("chat/completions", body);
            JSONObject choice = res.getJSONArray("choices").getJSONObject(0);
            String text = choice.getJSONObject("message").optString("content", "").trim();
            if (text.isEmpty()) {
                if ("length".equals(choice.optString("finish_reason"))) throw new AiException("The answer was cut off. Try again, or use a shorter request.");
                throw new AiException("Groq returned an empty answer. Try again.");
            }
            JSONObject usage = res.optJSONObject("usage");
            long in = usage == null ? 0 : usage.optLong("prompt_tokens");
            long out = usage == null ? 0 : usage.optLong("completion_tokens");
            JSONObject details = usage == null ? null : usage.optJSONObject("prompt_tokens_details");
            long cached = details == null ? 0 : details.optLong("cached_tokens");
            return new Result(text, res.optString("model", model), Math.max(0, in - cached), out, cached);
        } catch (AiException e) {
            throw e;
        } catch (IOException e) {
            throw new AiException("Couldn't reach Groq. Check your connection.");
        } catch (Exception e) {
            throw new AiException("Groq request failed: " + e.getClass().getSimpleName());
        }
    }

    /** Streams a plain text answer (Server-Sent Events); any problem falls back to {@link #complete}. */
    @Override
    public Result completeStream(String system, String document, String task, int maxTokens, TextListener l) throws AiException {
        HttpURLConnection c = null;
        try {
            JSONObject body = new JSONObject();
            body.put("model", model);
            JSONArray messages = new JSONArray();
            messages.put(new JSONObject().put("role", "system").put("content", system));
            String user = document == null || document.isEmpty() ? task : "<document>\n" + document + "\n</document>\n\n" + task;
            messages.put(new JSONObject().put("role", "user").put("content", user));
            body.put("messages", messages);
            body.put("max_completion_tokens", maxTokens);
            if (model.startsWith("openai/gpt-oss")) {
                body.put("reasoning_effort", "low");
                body.put("include_reasoning", false);
            }
            body.put("stream", true);
            body.put("stream_options", new JSONObject().put("include_usage", true));
            c = (HttpURLConnection) new URL(BASE + "chat/completions").openConnection();
            c.setConnectTimeout(20000);
            c.setReadTimeout(180000);
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setRequestProperty("Authorization", "Bearer " + apiKey);
            c.setRequestProperty("Content-Type", "application/json");
            try (OutputStream os = c.getOutputStream()) {
                os.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            if (c.getResponseCode() >= 400) {
                c.disconnect();
                return complete(system, document, task, maxTokens, null); // its error handling (limits, keys…)
            }
            StringBuilder out = new StringBuilder();
            long in = 0, outTok = 0, cached = 0, last = 0;
            String finish = "", served = model;
            try (java.io.BufferedReader r = new java.io.BufferedReader(new java.io.InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8))) {
                for (String line; (line = r.readLine()) != null; ) {
                    if (!line.startsWith("data:")) continue;
                    String data = line.substring(5).trim();
                    if (data.equals("[DONE]")) break;
                    JSONObject o = new JSONObject(data);
                    served = o.optString("model", served);
                    JSONArray ch = o.optJSONArray("choices");
                    if (ch != null && ch.length() > 0) {
                        JSONObject d = ch.getJSONObject(0).optJSONObject("delta");
                        if (d != null && !d.isNull("content")) out.append(d.optString("content", ""));
                        if (!ch.getJSONObject(0).isNull("finish_reason")) finish = ch.getJSONObject(0).optString("finish_reason");
                    }
                    JSONObject u = o.optJSONObject("usage");
                    if (u == null && o.optJSONObject("x_groq") != null) u = o.getJSONObject("x_groq").optJSONObject("usage");
                    if (u != null) {
                        in = u.optLong("prompt_tokens");
                        outTok = u.optLong("completion_tokens");
                        JSONObject det = u.optJSONObject("prompt_tokens_details");
                        cached = det == null ? 0 : det.optLong("cached_tokens");
                    }
                    long now = System.currentTimeMillis();
                    if (now - last > 250 && out.length() > 0) { last = now; l.onText(out.toString()); }
                }
            }
            String text = out.toString().trim();
            if (text.isEmpty()) return complete(system, document, task, maxTokens, null);
            if ("length".equals(finish)) text += "\n\n_(The answer was cut off at the length limit. Tap Regenerate for a complete one.)_";
            l.onText(text);
            return new Result(text, served, Math.max(0, in - cached), outTok, cached);
        } catch (AiException e) {
            throw e;
        } catch (Exception e) {
            if (c != null) c.disconnect();
            return complete(system, document, task, maxTokens, null);
        }
    }

    /** Answers about an image (JPEG, base64) with Groq's vision model. */
    Result completeWithImage(String system, String task, String base64Jpeg, int maxTokens) throws AiException {
        try {
            JSONObject body = new JSONObject();
            body.put("model", "meta-llama/llama-4-scout-17b-16e-instruct");
            JSONArray messages = new JSONArray();
            messages.put(new JSONObject().put("role", "system").put("content", system));
            JSONArray content = new JSONArray()
                    .put(new JSONObject().put("type", "image_url").put("image_url", new JSONObject().put("url", "data:image/jpeg;base64," + base64Jpeg)))
                    .put(new JSONObject().put("type", "text").put("text", task));
            messages.put(new JSONObject().put("role", "user").put("content", content));
            body.put("messages", messages);
            body.put("max_completion_tokens", Math.min(maxTokens, 4000));
            JSONObject res = post("chat/completions", body);
            String text = res.getJSONArray("choices").getJSONObject(0).getJSONObject("message").optString("content", "").trim();
            if (text.isEmpty()) throw new AiException("Groq returned an empty answer. Try again.");
            JSONObject usage = res.optJSONObject("usage");
            return new Result(text, res.optString("model", "llama-4-scout"), usage == null ? 0 : usage.optLong("prompt_tokens"),
                    usage == null ? 0 : usage.optLong("completion_tokens"), 0);
        } catch (AiException e) {
            throw e;
        } catch (IOException e) {
            throw new AiException("Couldn't reach Groq. Check your connection.");
        } catch (Exception e) {
            throw new AiException("Groq image request failed: " + e.getClass().getSimpleName());
        }
    }

    /** Model ids this key can use (chat models only). */
    String listModels() throws AiException {
        try {
            JSONObject res = get("models");
            JSONArray data = res.optJSONArray("data");
            JSONArray out = new JSONArray();
            if (data != null) {
                for (int i = 0; i < data.length(); i++) {
                    JSONObject m = data.getJSONObject(i);
                    String id = m.optString("id");
                    if (id.contains("whisper") || id.contains("guard") || id.contains("orpheus") || id.contains("tts")) continue;
                    if (!m.optBoolean("active", true)) continue;
                    out.put(new JSONObject().put("id", id).put("context", m.optLong("context_window")));
                }
            }
            return out.toString();
        } catch (AiException e) {
            throw e;
        } catch (Exception e) {
            throw new AiException("Couldn't list Groq models.");
        }
    }

    private JSONObject get(String path) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(BASE + path).openConnection();
        c.setConnectTimeout(20000);
        c.setReadTimeout(30000);
        c.setRequestProperty("Authorization", "Bearer " + apiKey);
        return read(c);
    }

    private JSONObject post(String path, JSONObject body) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(BASE + path).openConnection();
        c.setConnectTimeout(20000);
        c.setReadTimeout(180000);
        c.setRequestMethod("POST");
        c.setDoOutput(true);
        c.setRequestProperty("Authorization", "Bearer " + apiKey);
        c.setRequestProperty("Content-Type", "application/json");
        try (OutputStream os = c.getOutputStream()) {
            os.write(body.toString().getBytes(StandardCharsets.UTF_8));
        }
        return read(c);
    }

    private JSONObject read(HttpURLConnection c) throws Exception {
        try {
            int code = c.getResponseCode();
            InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            String text = in == null ? "" : slurp(in);
            if (code < 400) return new JSONObject(text);
            String msg = "";
            try { msg = new JSONObject(text).getJSONObject("error").optString("message"); } catch (Exception ignored) { }
            Matcher m = LIMIT.matcher(msg);
            if ((code == 413 || code == 429) && m.find() && msg.toLowerCase().contains("per minute")) {
                throw new AiException("TOO_LARGE:" + m.group(1) + ":" + m.group(2));
            }
            if (code == 401) throw new AiException("Your Groq API key was rejected. Check it in Settings → AI.");
            if (code == 404) throw new AiException("This Groq model isn't available to your key. Pick another model in Settings → AI.");
            if (code == 429) {
                if (msg.toLowerCase().contains("per day")) throw new AiException("Groq's daily free limit is used up. It resets within a day, or add billing on console.groq.com.");
                throw new AiException("Groq's rate limit was reached. Wait a minute and try again.");
            }
            if (code == 400 && msg.contains("json")) throw new AiException("Groq couldn't produce the answer in the expected format. Try again.");
            throw new AiException("Groq returned an error (" + code + ")" + (msg.isEmpty() ? "." : ": " + msg));
        } finally {
            c.disconnect();
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
