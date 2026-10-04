package org.research4life.portal;

import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.core.JsonValue;
import com.anthropic.errors.AnthropicIoException;
import com.anthropic.errors.AnthropicServiceException;
import com.anthropic.errors.BadRequestException;
import com.anthropic.errors.PermissionDeniedException;
import com.anthropic.errors.RateLimitException;
import com.anthropic.errors.UnauthorizedException;
import com.anthropic.models.messages.CacheControlEphemeral;
import com.anthropic.models.messages.ContentBlock;
import com.anthropic.models.messages.ContentBlockParam;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.StopReason;
import com.anthropic.models.messages.TextBlockParam;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Claude, called with the user's own Anthropic API key. */
final class ClaudeProvider implements LlmProvider {

    static final String DEFAULT_MODEL = "claude-opus-5";
    private static final ObjectMapper JSON = new ObjectMapper();

    private final AnthropicClient client;
    private final String model;

    ClaudeProvider(String apiKey, String model) {
        this.model = model == null || model.isEmpty() ? DEFAULT_MODEL : model;
        client = AnthropicOkHttpClient.builder()
                .apiKey(apiKey)
                .timeout(Duration.ofMinutes(5))
                .build();
    }

    @Override
    public Result complete(String system, String document, String task, int maxTokens, String jsonSchema) throws AiException {
        List<ContentBlockParam> content = new ArrayList<>();
        if (document != null && !document.isEmpty()) {
            // The document goes first with a cache breakpoint: repeat questions about it reuse the cache.
            content.add(ContentBlockParam.ofText(TextBlockParam.builder()
                    .text(document)
                    .cacheControl(CacheControlEphemeral.builder().build())
                    .build()));
        }
        content.add(ContentBlockParam.ofText(TextBlockParam.builder().text(task).build()));

        MessageCreateParams.Builder b = MessageCreateParams.builder()
                .model(model)
                .maxTokens((long) maxTokens)
                .system(system)
                .addUserMessageOfBlockParams(content);

        Map<String, Object> outputConfig = new HashMap<>();
        // Haiku 4.5 doesn't take an effort setting; the newer models do.
        if (!model.startsWith("claude-haiku")) outputConfig.put("effort", "medium");
        if (jsonSchema != null && !jsonSchema.isEmpty()) {
            try {
                Map<String, Object> format = new HashMap<>();
                format.put("type", "json_schema");
                format.put("schema", JSON.readValue(jsonSchema, Map.class));
                outputConfig.put("format", format);
            } catch (Exception e) {
                throw new AiException("Internal error: bad answer format");
            }
        }
        if (!outputConfig.isEmpty()) b.putAdditionalBodyProperty("output_config", JsonValue.from(outputConfig));
        if (DEFAULT_MODEL.equals(model)) {
            // If Claude Opus 5 declines, the API retries on its recommended fallback model.
            b.putAdditionalHeader("anthropic-beta", "server-side-fallback-2026-07-01");
            b.putAdditionalBodyProperty("fallbacks", JsonValue.from("default"));
        }

        Message msg;
        try {
            msg = client.messages().create(b.build());
        } catch (UnauthorizedException e) {
            throw new AiException("Your Claude API key was rejected. Check it in Settings → AI.");
        } catch (PermissionDeniedException e) {
            throw new AiException("This API key can't use " + model + ". Pick another model in Settings → AI.");
        } catch (RateLimitException e) {
            throw new AiException("Claude is busy or your usage limit was reached. Try again in a minute.");
        } catch (BadRequestException e) {
            String m = e.getMessage() == null ? "" : e.getMessage().toLowerCase();
            if (m.contains("credit")) throw new AiException("Your Anthropic account is out of credit.");
            if (m.contains("too long") || m.contains("context")) throw new AiException("This document is too long for one request.");
            throw new AiException("Claude couldn't process this request (400).");
        } catch (AnthropicServiceException e) {
            throw new AiException("Claude returned an error (" + e.statusCode() + "). Try again.");
        } catch (AnthropicIoException e) {
            throw new AiException("Couldn't reach Claude. Check your connection.");
        }
        if (msg.stopReason().isPresent() && msg.stopReason().get().equals(StopReason.REFUSAL)) {
            throw new AiException("Claude declined this request.");
        }
        StringBuilder out = new StringBuilder();
        for (ContentBlock block : msg.content()) block.text().ifPresent(t -> out.append(t.text()));
        if (out.length() == 0) throw new AiException("Claude returned an empty answer. Try again.");
        long cached = msg.usage().cacheReadInputTokens().orElse(0L);
        return new Result(out.toString().trim(), msg.model().asString(), msg.usage().inputTokens(),
                msg.usage().outputTokens(), cached);
    }
}
