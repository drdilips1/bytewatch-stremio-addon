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
 * Also OpenRouter ({@link #openRouter}), which speaks the same protocol: its free models (":free")
 * are tried first, then the same model paid from the account's credit.
 */
final class GroqProvider implements LlmProvider {

    static final String DEFAULT_MODEL = "openai/gpt-oss-120b";
    static final String OPENROUTER_MODEL = "openai/gpt-oss-120b:free";
    private static final String GROQ_BASE = "https://api.groq.com/openai/v1/";
    private static final String OPENROUTER_BASE = "https://openrouter.ai/api/v1/";
    private static final Pattern LIMIT = Pattern.compile("Limit (\\d+), Requested (\\d+)");

    private final String apiKey;
    private final String model;
    private final boolean or;
    private final String base;
    private final String name;

    GroqProvider(String apiKey, String model) {
        this(apiKey, model, false);
    }

    private GroqProvider(String apiKey, String model, boolean openRouter) {
        this.apiKey = apiKey;
        this.or = openRouter;
        this.model = model == null || model.isEmpty() ? (openRouter ? OPENROUTER_MODEL : DEFAULT_MODEL) : model;
        this.base = openRouter ? OPENROUTER_BASE : GROQ_BASE;
        this.name = openRouter ? "OpenRouter" : "Groq";
    }

    static GroqProvider openRouter(String apiKey, String model) {
        return new GroqProvider(apiKey, model, true);
    }

    /** OpenRouter: when a free model is busy or at its daily limit, the same model paid from the credit. */
    private GroqProvider paidTwin(AiException e) {
        if (!or || !model.endsWith(":free")) return null;
        String m = e.getMessage() == null ? "" : e.getMessage();
        if (m.contains("rejected") || m.startsWith("TOO_LARGE")) return null;
        return new GroqProvider(apiKey, model.substring(0, model.length() - 5), true);
    }

    private static AiException both(AiException free, AiException paid) {
        return new AiException(free.getMessage() + " · Paid: " + paid.getMessage());
    }

    private void putCommon(JSONObject body, int maxTokens) throws Exception {
        // Low randomness and a fixed seed: asking again gives (nearly) the same evidence answer,
        // not a different one each time (the default temperature is 1).
        body.put("temperature", 0.2);
        body.put("seed", 7);
        if (or) {
            body.put("max_tokens", maxTokens);
            if (model.startsWith("openai/gpt-oss")) body.put("reasoning", new JSONObject().put("effort", "low").put("exclude", true));
        } else {
            body.put("max_completion_tokens", maxTokens);
            if (model.startsWith("openai/gpt-oss")) {
                body.put("reasoning_effort", "low");
                body.put("include_reasoning", false);
            }
        }
    }

    /** OpenRouter answers are recorded as "openrouter/…", so usage and costs aren't counted as Groq's. */
    private String tag(String served) {
        return or ? "openrouter/" + served : served;
    }

    private void headers(HttpURLConnection c) {
        c.setRequestProperty("Authorization", "Bearer " + apiKey);
        if (or) c.setRequestProperty("X-Title", "DermScholar");
    }

    /** Structured outputs are guaranteed (strict) only on these models (Groq; OpenRouter's hosts vary). */
    private boolean strictJson() {
        return !or && (model.startsWith("openai/gpt-oss") || model.startsWith("qwen/"));
    }

    @Override
    public Result complete(String system, String document, String task, int maxTokens, String jsonSchema) throws AiException {
        try {
            return completeOnce(system, document, task, maxTokens, jsonSchema);
        } catch (AiException e) {
            GroqProvider paid = paidTwin(e);
            if (paid == null) throw e;
            try { return paid.completeOnce(system, document, task, maxTokens, jsonSchema); } catch (AiException e2) { throw both(e, e2); }
        }
    }

    private Result completeOnce(String system, String document, String task, int maxTokens, String jsonSchema) throws AiException {
        try {
            JSONObject body = new JSONObject();
            body.put("model", model);
            JSONArray messages = new JSONArray();
            messages.put(new JSONObject().put("role", "system").put("content", system));
            // Document first, task last: repeat questions about the same document share a cacheable prefix.
            String user = document == null || document.isEmpty() ? task : "<document>\n" + document + "\n</document>\n\n" + task;
            messages.put(new JSONObject().put("role", "user").put("content", user));
            body.put("messages", messages);
            putCommon(body, maxTokens);
            if (jsonSchema != null && !jsonSchema.isEmpty()) {
                if (strictJson()) {
                    body.put("response_format", new JSONObject().put("type", "json_schema").put("json_schema",
                            new JSONObject().put("name", "answer").put("strict", true).put("schema", new JSONObject(jsonSchema))));
                } else {
                    if (!or) body.put("response_format", new JSONObject().put("type", "json_object"));
                    messages.getJSONObject(0).put("content", system + "\nReply with JSON only, matching this JSON Schema: " + jsonSchema);
                }
            }
            JSONObject res = post("chat/completions", body);
            JSONObject choice = res.getJSONArray("choices").getJSONObject(0);
            String text = choice.getJSONObject("message").optString("content", "").trim();
            if (text.isEmpty()) {
                if ("length".equals(choice.optString("finish_reason"))) throw new AiException("The answer was cut off. Try again, or use a shorter request.");
                throw new AiException(name + " returned an empty answer. Try again.");
            }
            JSONObject usage = res.optJSONObject("usage");
            long in = usage == null ? 0 : usage.optLong("prompt_tokens");
            long out = usage == null ? 0 : usage.optLong("completion_tokens");
            JSONObject details = usage == null ? null : usage.optJSONObject("prompt_tokens_details");
            long cached = details == null ? 0 : details.optLong("cached_tokens");
            return new Result(text, tag(res.optString("model", model)), Math.max(0, in - cached), out, cached);
        } catch (AiException e) {
            throw e;
        } catch (IOException e) {
            throw new AiException("Couldn't reach " + name + ". Check your connection.");
        } catch (Exception e) {
            throw new AiException(name + " request failed: " + e.getClass().getSimpleName());
        }
    }

    /** Streams a plain text answer (Server-Sent Events); any problem falls back to {@link #complete}. */
    @Override
    public Result completeStream(String system, String document, String task, int maxTokens, TextListener l) throws AiException {
        try {
            return streamOnce(system, document, task, maxTokens, l);
        } catch (AiException e) {
            GroqProvider paid = paidTwin(e);
            if (paid == null) throw e;
            try { return paid.streamOnce(system, document, task, maxTokens, l); } catch (AiException e2) { throw both(e, e2); }
        }
    }

    private Result streamOnce(String system, String document, String task, int maxTokens, TextListener l) throws AiException {
        HttpURLConnection c = null;
        try {
            JSONObject body = new JSONObject();
            body.put("model", model);
            JSONArray messages = new JSONArray();
            messages.put(new JSONObject().put("role", "system").put("content", system));
            String user = document == null || document.isEmpty() ? task : "<document>\n" + document + "\n</document>\n\n" + task;
            messages.put(new JSONObject().put("role", "user").put("content", user));
            body.put("messages", messages);
            putCommon(body, maxTokens);
            body.put("stream", true);
            body.put("stream_options", new JSONObject().put("include_usage", true));
            c = (HttpURLConnection) new URL(base + "chat/completions").openConnection(java.net.Proxy.NO_PROXY);
            c.setConnectTimeout(20000);
            c.setReadTimeout(180000);
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            headers(c);
            c.setRequestProperty("Content-Type", "application/json");
            try (OutputStream os = c.getOutputStream()) {
                os.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            if (c.getResponseCode() >= 400) {
                c.disconnect();
                return completeOnce(system, document, task, maxTokens, null); // its error handling (limits, keys…)
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
            if (text.isEmpty()) return completeOnce(system, document, task, maxTokens, null);
            if ("length".equals(finish)) text += "\n\n_(The answer was cut off at the length limit. Tap Regenerate for a complete one.)_";
            l.onText(text);
            return new Result(text, tag(served), Math.max(0, in - cached), outTok, cached);
        } catch (AiException e) {
            throw e;
        } catch (Exception e) {
            if (c != null) c.disconnect();
            return completeOnce(system, document, task, maxTokens, null);
        }
    }

    /** Answers about an image (JPEG, base64) with Groq's vision model. */
    /** The picture-reading model found for each service (models are retired; the one in use is looked up). */
    private static final java.util.Map<String, String> visionModel = new java.util.concurrent.ConcurrentHashMap<>();
    private static final Pattern GROQ_VISION = Pattern.compile("(?i)(llama-4|scout|maverick|vision|-vl\\b|vl-|llava|gemma-3|pixtral|qwen.*vl)");

    /** A model of this service that reads pictures: Groq by name; OpenRouter a free one by its listed input types. */
    private String findVisionModel() throws AiException {
        try {
            JSONObject res = get("models");
            JSONArray data = res.optJSONArray("data");
            String best = null;
            for (int i = 0; data != null && i < data.length(); i++) {
                JSONObject m = data.getJSONObject(i);
                String id = m.optString("id");
                if (or) {
                    JSONObject arch = m.optJSONObject("architecture");
                    JSONArray in = arch == null ? null : arch.optJSONArray("input_modalities");
                    boolean image = in != null && in.toString().contains("image");
                    JSONObject price = m.optJSONObject("pricing");
                    boolean free = id.endsWith(":free") || (price != null && "0".equals(price.optString("prompt")) && "0".equals(price.optString("completion")));
                    if (image && free) { best = id; if (id.contains("gemma") || id.contains("llama-4") || id.contains("qwen")) break; }
                } else if (m.optBoolean("active", true) && GROQ_VISION.matcher(id).find() && !id.contains("guard")) {
                    best = id;
                    if (id.contains("scout") || id.contains("maverick")) break;
                }
            }
            if (best == null) throw new AiException(name + " has no model that reads pictures for your key.");
            visionModel.put(base, best);
            return best;
        } catch (AiException e) {
            throw e;
        } catch (Exception e) {
            throw new AiException("Couldn't list " + name + " models.");
        }
    }

    Result completeWithImage(String system, String task, String base64Jpeg, int maxTokens) throws AiException {
        String model = visionModel.get(base);
        if (model == null) model = or ? findVisionModel() : "meta-llama/llama-4-scout-17b-16e-instruct";
        try {
            return imageOnce(model, system, task, base64Jpeg, maxTokens);
        } catch (AiException e) {
            String m = e.getMessage() == null ? "" : e.getMessage();
            // Retired or not offered to this key: find the current picture model and try it once.
            if (!m.contains("isn't available") && !m.contains("error (400)") && !m.contains("error (404)")) throw e;
            visionModel.remove(base);
            String next = findVisionModel();
            if (next.equals(model)) throw e;
            return imageOnce(next, system, task, base64Jpeg, maxTokens);
        }
    }

    private Result imageOnce(String visionId, String system, String task, String base64Jpeg, int maxTokens) throws AiException {
        try {
            JSONObject body = new JSONObject();
            body.put("model", visionId);
            JSONArray messages = new JSONArray();
            messages.put(new JSONObject().put("role", "system").put("content", system));
            JSONArray content = new JSONArray()
                    .put(new JSONObject().put("type", "image_url").put("image_url", new JSONObject().put("url", "data:image/jpeg;base64," + base64Jpeg)))
                    .put(new JSONObject().put("type", "text").put("text", task));
            messages.put(new JSONObject().put("role", "user").put("content", content));
            body.put("messages", messages);
            body.put(or ? "max_tokens" : "max_completion_tokens", Math.min(maxTokens, 4000));
            body.put("temperature", 0.2);
            JSONObject res = post("chat/completions", body);
            String text = res.getJSONArray("choices").getJSONObject(0).getJSONObject("message").optString("content", "").trim();
            if (text.isEmpty()) throw new AiException(name + " returned an empty answer. Try again.");
            visionModel.put(base, visionId);
            JSONObject usage = res.optJSONObject("usage");
            return new Result(text, tag(res.optString("model", visionId)), usage == null ? 0 : usage.optLong("prompt_tokens"),
                    usage == null ? 0 : usage.optLong("completion_tokens"), 0);
        } catch (AiException e) {
            throw e;
        } catch (IOException e) {
            throw new AiException("Couldn't reach " + name + ". Check your connection.");
        } catch (Exception e) {
            throw new AiException(name + " image request failed: " + e.getClass().getSimpleName());
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
        HttpURLConnection c = (HttpURLConnection) new URL(base + path).openConnection(java.net.Proxy.NO_PROXY);
        c.setConnectTimeout(20000);
        c.setReadTimeout(30000);
        headers(c);
        return read(c);
    }

    private JSONObject post(String path, JSONObject body) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(base + path).openConnection(java.net.Proxy.NO_PROXY);
        c.setConnectTimeout(20000);
        c.setReadTimeout(180000);
        c.setRequestMethod("POST");
        c.setDoOutput(true);
        headers(c);
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
            if (or) {
                if (code == 401) throw new AiException("Your OpenRouter API key was rejected. Check it in Settings → AI.");
                if (code == 402) throw new AiException("OpenRouter credit is used up. Add credit on openrouter.ai, or wait for the free limit to reset.");
                if (code == 429) throw new AiException(model.endsWith(":free") ? "OpenRouter's free model is busy or its daily limit is used up." : "OpenRouter is busy. Try again in a minute.");
                if (code == 404) throw new AiException("This OpenRouter model isn't available right now. Pick another model in Settings → AI.");
                throw new AiException("OpenRouter returned an error (" + code + ")" + (msg.isEmpty() ? "." : ": " + msg));
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
