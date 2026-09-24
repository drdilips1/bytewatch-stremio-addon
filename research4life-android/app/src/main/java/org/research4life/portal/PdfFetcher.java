package org.research4life.portal;

import android.app.Activity;
import android.content.Context;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONArray;

import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Gets paywalled PDFs through Research4Life without showing the website: runs the shared
 * R4L WebView out of sight (behind the app's own UI), signs in with the saved account,
 * follows the publisher's PDF link and saves the file to the library. One paper at a time.
 */
final class PdfFetcher {

    interface Listener {
        void onStatus(String key, String stage, String message);
        void onSaved(String key, String title);
        void onFailed(String key, String message, boolean canShowPage);
    }

    private static final int MAX_PDF_ATTEMPTS = 4;
    private static final int MAX_SIGNIN_PAGES = 3;
    private static final long JOB_TIMEOUT_MS = 90_000;

    private static PdfFetcher instance;

    static PdfFetcher get(Context ctx) {
        if (instance == null) instance = new PdfFetcher(ctx.getApplicationContext());
        return instance;
    }

    private static final class Job {
        final String key, doi, title;
        Job(String key, String doi, String title) { this.key = key; this.doi = doi; this.title = title; }
    }

    private final Context app;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final ArrayDeque<Job> queue = new ArrayDeque<>();
    private final Map<String, String> lastUrls = new HashMap<>();
    private final Set<String> tried = new HashSet<>();
    private Listener listener;
    private WebView webView;
    private ViewGroup host;
    private Job job;
    private boolean saving;
    private int pdfAttempts, signInPages, reloadsAfterSignIn, pageToken;

    private final Runnable timeout = () -> {
        if (job != null && !saving) fail("Research4Life needs your help with this one (sign-in or a publisher page). Tap Show page.", true);
    };

    private PdfFetcher(Context app) {
        this.app = app;
    }

    void setListener(Listener l) {
        listener = l;
    }

    /** Places the shared WebView, invisible to the user, behind the given activity's UI. */
    void attach(Activity activity, FrameLayout container) {
        if (webView != null && webView.getParent() == container && host == container) {
            if (job == null) next();
            return;
        }
        webView = R4LSession.obtain(activity);
        host = container;
        container.addView(webView, 0, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        if (job == null) next();
    }

    /** The browser screen is taking the WebView; put the running job back in the queue. */
    void suspend() {
        main.removeCallbacks(timeout);
        if (job != null && !saving) {
            queue.addFirst(job);
            status("queued", "Waiting…");
            job = null;
        }
        host = null;
    }

    boolean isAttached() {
        return host != null && webView != null && webView.getParent() == host;
    }

    void enqueue(String key, String doi, String title) {
        if (job != null && job.key.equals(key)) return;
        for (Job j : queue) if (j.key.equals(key)) return;
        queue.addLast(new Job(key, doi, title));
        if (job == null) next(); else status("queued", "Waiting in queue…");
    }

    void cancel(String key) {
        queue.removeIf(j -> j.key.equals(key));
        if (job != null && job.key.equals(key) && !saving) {
            main.removeCallbacks(timeout);
            webView.stopLoading();
            job = null;
            next();
        }
    }

    String lastUrl(String key) {
        return lastUrls.get(key);
    }

    // ------------------------------------------------------------------ job flow

    private void next() {
        if (job != null || !isAttached()) return;
        job = queue.pollFirst();
        if (job == null) return;
        tried.clear();
        saving = false;
        pdfAttempts = 0;
        signInPages = 0;
        reloadsAfterSignIn = 0;
        attachClients();
        status("opening", "Opening the paper through Research4Life…");
        main.removeCallbacks(timeout);
        main.postDelayed(timeout, JOB_TIMEOUT_MS);
        webView.loadUrl(R4LSession.doiUrl(job.doi));
    }

    private void attachClients() {
        webView.setWebChromeClient(null);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String s = request.getUrl().getScheme();
                return !"http".equals(s) && !"https".equals(s);
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                pageToken++;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                CookieManager.getInstance().flush();
                if (job != null) lastUrls.put(job.key, url);
                onPageLoaded(url);
            }
        });
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, length) -> {
            if (job == null || saving) return;
            String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
            save(url, userAgent != null ? userAgent : webView.getSettings().getUserAgentString(), name);
        });
    }

    private static boolean isSignInPage(Uri u) {
        String p = u.getPath() == null ? "" : u.getPath().toLowerCase();
        return !p.startsWith("/tacgw/") && (p.contains("signin") || p.contains("login"));
    }

    static boolean isProxiedContent(Uri u) {
        return R4LSession.isR4LHost(u.getHost()) && u.getPath() != null && u.getPath().startsWith("/tacsgr1");
    }

    private void onPageLoaded(String url) {
        if (job == null || saving) return;
        Uri u = Uri.parse(url);
        if (R4LSession.isR4LHost(u.getHost()) && !isProxiedContent(u)) {
            if (isSignInPage(u)) {
                signInPages++;
                if (!R4LSession.hasCredentials(app)) {
                    fail("Save your Research4Life sign-in in Settings, or tap Show page to sign in once.", true);
                    return;
                }
                if (signInPages > MAX_SIGNIN_PAGES) {
                    fail("Research4Life sign-in didn't go through. Check your saved ID and password, or tap Show page.", true);
                    return;
                }
                status("signing-in", "Signing in to Research4Life…");
            }
            String pass = R4LSession.hasCredentials(app) ? R4LSession.password(app) : null;
            webView.evaluateJavascript(R4LSession.signInScript(R4LSession.username(app), pass, true), null);
            if (!isSignInPage(u) && u.getHost() != null && u.getHost().startsWith("portal.")
                    && signInPages > 0 && reloadsAfterSignIn < 2) {
                reloadsAfterSignIn++;
                status("opening", "Signed in. Opening the paper…");
                main.postDelayed(() -> { if (job != null) webView.loadUrl(R4LSession.doiUrl(job.doi)); }, 1200);
            }
            return;
        }
        status("finding", "Looking for the PDF…");
        final int token = pageToken;
        main.postDelayed(() -> { if (token == pageToken && job != null && !saving) findPdf(url); }, 2000);
    }

    private void findPdf(String pageUrl) {
        webView.evaluateJavascript(R4LSession.FIND_PDF_SCRIPT, value -> {
            if (job == null || saving) return;
            String next = null;
            try {
                JSONArray arr = new JSONArray(new JSONArray("[" + value + "]").getString(0));
                boolean viaProxy = isProxiedContent(Uri.parse(pageUrl));
                for (int i = 0; i < arr.length() && next == null; i++) {
                    String c = fixPdfUrl(arr.getString(i));
                    if (viaProxy) c = R4LSession.proxied(c);
                    if (!tried.contains(c) && !c.equals(pageUrl)) next = c;
                }
            } catch (Exception ignored) {
            }
            if (next == null) {
                if (pdfAttempts == 0) {
                    fail("No PDF link on the publisher page. Your access may not include this journal — tap Show page to check.", true);
                }
                return;
            }
            if (++pdfAttempts > MAX_PDF_ATTEMPTS) {
                fail("Couldn't reach the PDF automatically. Tap Show page to open it yourself.", true);
                return;
            }
            tried.add(next);
            status("downloading", "Downloading the PDF…");
            webView.loadUrl(next);
        });
    }

    static String fixPdfUrl(String url) {
        if (url.contains("wiley")) {
            url = url.replace("/doi/epdf/", "/doi/pdfdirect/").replace("/doi/pdf/", "/doi/pdfdirect/");
        }
        if (url.contains("tandfonline") || url.contains("sagepub")) {
            url = url.replace("/doi/epdf/", "/doi/pdf/");
        }
        return url;
    }

    private void save(String url, String userAgent, String fileName) {
        final Job j = job;
        saving = true;
        main.removeCallbacks(timeout);
        status("downloading", "Saving the PDF…");
        io.execute(() -> {
            try {
                PdfStore.download(app, j.key, url, j.title != null ? j.title : fileName, userAgent);
                main.post(() -> {
                    if (listener != null) listener.onSaved(j.key, j.title);
                    finishJob();
                });
            } catch (Exception e) {
                main.post(() -> {
                    saving = false;
                    if (job != j) return;
                    if ("NOT_PDF".equals(e.getMessage())) {
                        // The link led to another page; keep looking from there.
                        status("finding", "Looking for the PDF…");
                        main.postDelayed(() -> { if (job == j && !saving) findPdf(webView.getUrl()); }, 1500);
                    } else {
                        fail("Download failed: " + e.getMessage(), true);
                    }
                });
            }
        });
    }

    private void status(String stage, String message) {
        if (listener != null && job != null) listener.onStatus(job.key, stage, message);
        else if (listener != null && "queued".equals(stage) && !queue.isEmpty()) listener.onStatus(queue.peekFirst().key, stage, message);
    }

    private void fail(String message, boolean canShow) {
        main.removeCallbacks(timeout);
        Job j = job;
        job = null;
        saving = false;
        if (listener != null && j != null) listener.onFailed(j.key, message, canShow);
        next();
    }

    private void finishJob() {
        job = null;
        saving = false;
        next();
    }
}
