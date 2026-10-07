package org.research4life.portal;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.util.Base64;
import android.webkit.HttpAuthHandler;

import androidx.webkit.ProxyConfig;
import androidx.webkit.ProxyController;
import androidx.webkit.WebViewFeature;

import java.net.InetSocketAddress;
import java.net.PasswordAuthentication;
import java.net.Proxy;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * The person's college proxy (EZproxy as an internet proxy: host and port, with a username and
 * password asked in a pop-up). The app's browsers use it for publisher sites, so journals the
 * college subscribes to open with its access, on mobile data or Wi-Fi; the pop-up is answered with
 * the saved login. Search, AI, Research4Life and UpToDate don't go through it.
 */
final class CollegeProxy {
    /** Saved-login provider id for the proxy's username and password (R4LSession). */
    static final String PX = "px";
    private static final String PREFS = "college_proxy";

    /** Sites that never go through the college proxy (they work anywhere, or have their own access). */
    private static final String[] BYPASS = {
            "*.ebi.ac.uk", "*.ncbi.nlm.nih.gov", "*.crossref.org", "*.openalex.org", "*.unpaywall.org", "*.semanticscholar.org",
            "*.research4life.org", "research4life.org", "*.who.int", "*.uptodate.com", "*.wolterskluwer.com",
            "*.googleapis.com", "*.google.com", "*.gstatic.com", "*.groq.com", "*.anthropic.com", "*.openai.com",
            "*.github.io", "github.com", "*.github.com", "*.githubusercontent.com", "*.myloft.xyz", "clinicaltrials.gov",
            "*.clinicaltrials.gov", "appassets.androidplatform.net",
    };

    private CollegeProxy() {
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static String host(Context ctx) {
        return prefs(ctx).getString("host", "").trim();
    }

    static int port(Context ctx) {
        return prefs(ctx).getInt("port", 0);
    }

    static boolean configured(Context ctx) {
        return !host(ctx).isEmpty() && port(ctx) > 0;
    }

    /** The app's browsers can be pointed at a proxy (Android System WebView 72+). */
    static boolean supported() {
        return WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE);
    }

    /** Get PDF can go through the college: set up, and the browsers can use it. */
    static boolean usable(Context ctx) {
        return configured(ctx) && supported();
    }

    static void save(Context ctx, String host, int port) {
        String h = host == null ? "" : host.trim().replaceFirst("^(?i)https?://", "").replaceAll("[/\\s].*$", "");
        prefs(ctx).edit().putString("host", h).putInt("port", h.isEmpty() ? 0 : port).apply();
        if (active) apply(ctx);
    }

    /**
     * Whether the app's browsers go through the proxy right now: only while Get PDF uses the
     * college route. Everything else (Research4Life, ClinicalKey, UpToDate, browsing) stays direct,
     * so those sign-ins aren't mistaken for the college's.
     */
    private static boolean active;

    /** Turns the proxy on or off for the app's browsers, then runs {@code then}. */
    static void use(Context ctx, boolean on, Runnable then) {
        final Context app = ctx.getApplicationContext();
        boolean want = on && usable(app);
        if (want == active) { if (then != null) then.run(); return; }
        active = want;
        apply(app, then);
    }

    /** At start: the login helper for the proxy's password, and the direct connection. */
    static void apply(Context ctx) {
        apply(ctx, null);
    }

    private static void apply(Context ctx, Runnable then) {
        final Context app = ctx.getApplicationContext();
        java.net.Authenticator.setDefault(new java.net.Authenticator() {
            @Override
            protected PasswordAuthentication getPasswordAuthentication() {
                if (getRequestorType() != RequestorType.PROXY || !configured(app) || !R4LSession.hasCredentials(app, PX)) return null;
                String pass = R4LSession.password(app, PX);
                return pass == null ? null : new PasswordAuthentication(R4LSession.username(app, PX), pass.toCharArray());
            }
        });
        if (!supported()) { if (then != null) then.run(); return; }
        android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());
        Runnable done = () -> { if (then != null) main.post(then); };
        try {
            if (active && configured(app)) {
                ProxyConfig.Builder b = new ProxyConfig.Builder().addProxyRule(host(app) + ":" + port(app));
                for (String rule : BYPASS) b.addBypassRule(rule);
                ProxyController.getInstance().setProxyOverride(b.build(), Runnable::run, done);
            } else {
                // Direct, even when a proxy is set in the phone's APN or Wi-Fi settings: Research4Life,
                // ClinicalKey and UpToDate must see this phone, not the college.
                ProxyController.getInstance().setProxyOverride(new ProxyConfig.Builder().addDirect().build(), Runnable::run, done);
            }
        } catch (Exception ignored) {
            // An address the browser can't use: stay direct.
            active = false;
            if (then != null) main.post(then);
        }
    }

    private static boolean bypassed(String host) {
        if (host == null) return true;
        String h = host.toLowerCase();
        for (String rule : BYPASS) {
            if (rule.startsWith("*.") ? h.endsWith(rule.substring(1)) : h.equals(rule)) return true;
        }
        return false;
    }

    /** The proxy for a download (PDFs saved outside the browser), or null to go direct. */
    static Proxy proxyFor(Context ctx, String url) {
        if (!active || !usable(ctx) || bypassed(Uri.parse(url).getHost())) return null;
        return new Proxy(Proxy.Type.HTTP, InetSocketAddress.createUnresolved(host(ctx), port(ctx)));
    }

    /** "Basic …" for the Proxy-Authorization header, or null without a saved login. */
    static String authHeader(Context ctx) {
        if (!R4LSession.hasCredentials(ctx, PX)) return null;
        String pass = R4LSession.password(ctx, PX);
        if (pass == null) return null;
        String raw = R4LSession.username(ctx, PX) + ":" + pass;
        return "Basic " + Base64.encodeToString(raw.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
    }

    private static final Map<String, long[]> answered = new HashMap<>();

    /**
     * The proxy's password pop-up in one of the app's browsers: answered with the saved login
     * (at most 3 times a minute, so a wrong password doesn't loop). False when it isn't the proxy's.
     */
    static boolean answer(Context ctx, HttpAuthHandler handler, String host) {
        if (!configured(ctx) || host == null || !R4LSession.hasCredentials(ctx, PX)) return false;
        String ph = host(ctx).toLowerCase();
        String h = host.toLowerCase();
        if (!h.equals(ph) && !h.startsWith(ph + ":")) return false;
        long now = System.currentTimeMillis();
        long[] a = answered.get(ph);
        if (a == null || now - a[1] > 60_000) { a = new long[]{0, now}; answered.put(ph, a); }
        if (++a[0] > 3) return false;
        String pass = R4LSession.password(ctx, PX);
        if (pass == null) return false;
        handler.proceed(R4LSession.username(ctx, PX), pass);
        return true;
    }
}
