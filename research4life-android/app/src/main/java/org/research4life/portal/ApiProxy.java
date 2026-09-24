package org.research4life.portal;

import android.net.Uri;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * Same-origin proxy for the literature APIs, so the bundled web app can call services that
 * don't send CORS headers. Only the fixed upstream hosts below are reachable.
 */
final class ApiProxy {

    static final String PREFIX = "/proxy/";
    private static final Map<String, String> UPSTREAMS = new HashMap<>();

    static {
        UPSTREAMS.put("epmc", "https://www.ebi.ac.uk/europepmc/webservices/rest/");
        UPSTREAMS.put("openalex", "https://api.openalex.org/");
    }

    private ApiProxy() {}

    static WebResourceResponse handle(Uri uri) {
        String rest = uri.getEncodedPath().substring(PREFIX.length());
        int slash = rest.indexOf('/');
        String base = slash > 0 ? UPSTREAMS.get(rest.substring(0, slash)) : null;
        if (base == null) return error(404, "Unknown upstream");
        String target = base + rest.substring(slash + 1)
                + (uri.getEncodedQuery() != null ? "?" + uri.getEncodedQuery() : "");

        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(target).openConnection();
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            conn.setRequestProperty("Accept", "application/json, application/xml;q=0.9, */*;q=0.8");
            conn.setRequestProperty("User-Agent", "DermScholar/2.0 (Android)");
            int code = conn.getResponseCode();
            // WebResourceResponse rejects 3xx codes; unresolved redirects count as errors.
            if (code >= 300 && code < 400) return error(502, "Unexpected redirect");
            InputStream in = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            byte[] body = in == null ? new byte[0] : readAll(in);
            String type = conn.getContentType();
            String mime = type == null ? "application/octet-stream" : type.split(";")[0].trim();
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-store");
            return new WebResourceResponse(mime, "UTF-8", code, code >= 400 ? "Error" : "OK",
                    headers, new ByteArrayInputStream(body));
        } catch (IOException e) {
            return error(502, "Network error: " + e.getMessage());
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static byte[] readAll(InputStream in) throws IOException {
        try (InputStream is = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[16384];
            int n;
            while ((n = is.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }

    private static WebResourceResponse error(int code, String message) {
        return new WebResourceResponse("text/plain", "UTF-8", code, "Error",
                new HashMap<>(), new ByteArrayInputStream(message.getBytes(StandardCharsets.UTF_8)));
    }
}
