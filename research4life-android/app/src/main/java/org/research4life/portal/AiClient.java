package org.research4life.portal;

import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.core.JsonValue;
import com.anthropic.errors.AnthropicIoException;
import com.anthropic.errors.AnthropicServiceException;
import com.anthropic.errors.PermissionDeniedException;
import com.anthropic.errors.RateLimitException;
import com.anthropic.errors.UnauthorizedException;
import com.anthropic.models.messages.ContentBlock;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.OutputConfig;
import com.anthropic.models.messages.StopReason;

import java.time.Duration;

/**
 * Summaries and questions about a paper, answered by Claude with the user's own API key.
 * Only the text shown in the app (abstract, or full text when available) is sent.
 */
final class AiClient {

    static final String MODEL = "claude-opus-5";

    static final class AiException extends Exception {
        AiException(String message) { super(message); }
    }

    private static final String SYSTEM = "You are a research assistant for a dermatologist reading the medical literature. "
            + "Work only from the paper text you are given; if something is not in it, say so rather than guessing. "
            + "Keep numbers exact (effect sizes, confidence intervals, p values, sample sizes). "
            + "Write in plain Markdown: short '## ' headings, '- ' bullets and **bold** for key figures. No tables, no preamble.";

    private static final String SUMMARY_TASK = "Summarise this paper for a busy dermatologist. Use these sections:\n"
            + "## Bottom line\n(two or three sentences)\n"
            + "## Study design\n(type of study, setting, population, sample size, intervention/comparator, follow-up)\n"
            + "## Key findings\n(bullets with the main results and their numbers)\n"
            + "## Clinical relevance\n(what it changes or doesn't change in practice)\n"
            + "## Limitations\n(bullets)\n"
            + "If only the abstract is available, start with the line '_Based on the abstract only._'";

    private final AnthropicClient client;

    AiClient(String apiKey) {
        client = AnthropicOkHttpClient.builder()
                .apiKey(apiKey)
                .timeout(Duration.ofMinutes(3))
                .build();
    }

    /** question == null → structured summary; otherwise an answer to the question from the paper. */
    String ask(String title, String paperText, String question) throws AiException {
        String task = question == null || question.trim().isEmpty() ? SUMMARY_TASK
                : "Answer this question about the paper, citing the relevant part of the text: " + question.trim();
        String user = "<paper>\n<title>" + title + "</title>\n" + paperText + "\n</paper>\n\n" + task;
        MessageCreateParams params = MessageCreateParams.builder()
                .model(MODEL)
                .maxTokens(8000L)
                .system(SYSTEM)
                .outputConfig(OutputConfig.builder().effort(OutputConfig.Effort.MEDIUM).build())
                .addUserMessage(user)
                // If Claude Opus 5 declines, let the API retry on its recommended fallback model.
                .putAdditionalHeader("anthropic-beta", "server-side-fallback-2026-07-01")
                .putAdditionalBodyProperty("fallbacks", JsonValue.from("default"))
                .build();
        Message msg;
        try {
            msg = client.messages().create(params);
        } catch (UnauthorizedException e) {
            throw new AiException("Your Claude API key was rejected. Check it in Settings → AI summaries.");
        } catch (PermissionDeniedException e) {
            throw new AiException("This API key can't use " + MODEL + ". Check your Claude Console account.");
        } catch (RateLimitException e) {
            throw new AiException("Claude is busy or your usage limit was reached. Try again in a minute.");
        } catch (AnthropicServiceException e) {
            throw new AiException("Claude returned an error (" + e.statusCode() + "). Try again.");
        } catch (AnthropicIoException e) {
            throw new AiException("Couldn't reach Claude. Check your connection.");
        }
        if (msg.stopReason().isPresent() && msg.stopReason().get().equals(StopReason.REFUSAL)) {
            throw new AiException("Claude declined to summarise this text.");
        }
        StringBuilder out = new StringBuilder();
        for (ContentBlock block : msg.content()) {
            block.text().ifPresent(t -> out.append(t.text()));
        }
        if (out.length() == 0) throw new AiException("Claude returned an empty answer. Try again.");
        return out.toString().trim();
    }
}
