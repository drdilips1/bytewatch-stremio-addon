package org.research4life.portal;

/**
 * A large language model the app can ask about a document. Prompts live in the web app, so
 * switching provider means adding one implementation of this interface.
 */
interface LlmProvider {
    /** Why a request couldn't get through, in plain words (shown in the error, so the cause is visible). */
    static String netWhy(Exception e) {
        if (e instanceof java.net.UnknownHostException) return "the phone couldn't look up its address (DNS)";
        if (e instanceof java.net.SocketTimeoutException) return "it timed out (slow or interrupted connection)";
        if (e instanceof javax.net.ssl.SSLException) return "the secure connection failed (a network filter or the phone's date and time)";
        if (e instanceof java.net.ConnectException) return "the connection was refused";
        String m = e.getMessage();
        return e.getClass().getSimpleName() + (m == null || m.isEmpty() ? "" : ": " + (m.length() > 120 ? m.substring(0, 120) + "…" : m));
    }


    final class Result {
        final String text;
        final String model;
        final long inputTokens;
        final long outputTokens;
        final long cachedTokens;

        Result(String text, String model, long inputTokens, long outputTokens, long cachedTokens) {
            this.text = text;
            this.model = model;
            this.inputTokens = inputTokens;
            this.outputTokens = outputTokens;
            this.cachedTokens = cachedTokens;
        }
    }

    final class AiException extends Exception {
        AiException(String message) { super(message); }
    }

    /**
     * @param system     standing instructions
     * @param document   the document text (sent first and cached, so follow-up questions are cheap); may be empty
     * @param task       what to do with it
     * @param maxTokens  output cap
     * @param jsonSchema JSON Schema the answer must follow, or null for Markdown text
     */
    Result complete(String system, String document, String task, int maxTokens, String jsonSchema) throws AiException;

    /** Receives the answer so far while it is being written. */
    interface TextListener { void onText(String soFar); }

    /**
     * Like {@link #complete} for plain text answers, reporting the text as it arrives so it can be
     * shown while still being written. Providers without streaming answer in one go.
     */
    default Result completeStream(String system, String document, String task, int maxTokens, TextListener l) throws AiException {
        Result r = complete(system, document, task, maxTokens, null);
        l.onText(r.text);
        return r;
    }
}
