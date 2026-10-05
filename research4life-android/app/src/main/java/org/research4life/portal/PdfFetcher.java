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
    /** Failure prefix for papers outside Research4Life's coverage (the proxy sent us to the plain publisher site). */
    static final String NOT_COVERED = "NOT_IN_R4L:";
    private static final int MAX_SIGNIN_PAGES = 3;
    private static final long JOB_TIMEOUT_MS = 90_000;

    private static PdfFetcher instance;

    static PdfFetcher get(Context ctx) {
        if (instance == null) instance = new PdfFetcher(ctx.getApplicationContext());
        return instance;
    }

    private static final class Job {
        final String key, doi, title;
        /** Elsevier article ID: Research4Life gives Elsevier PDFs (JAAD…) through ClinicalKey, not ScienceDirect. */
        final String pii;
        boolean viaClinicalKey;
        /** ClinicalKey was tried and gave no PDF (usually: not signed in to ClinicalKey yet). */
        boolean clinicalKeyFailed;
        /** Whether the article link was already reopened after landing on a site's bare home page. */
        boolean reopened;
        int accountTries;
        Job(String key, String doi, String title, String pii) {
            this.key = key; this.doi = doi; this.title = title;
            this.pii = pii == null ? "" : pii;
            viaClinicalKey = !this.pii.isEmpty();
        }
        String startUrl() { return viaClinicalKey ? R4LSession.clinicalKeyUrl(pii) : R4LSession.doiUrl(doi); }
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
    private int pdfAttempts, signInPages, reloadsAfterSignIn, pageToken, challengeWaits;

    /** Publisher security checks ("Just a moment…", "verify you are human") that must finish first. */
    static final String CHALLENGE_SCRIPT = "(function(){var t=(document.title||'')+' '+((document.body&&document.body.innerText)||'').slice(0,600);"
            + "return (/just a moment|security verification|checking your browser|verify you are (a )?human|attention required|are you a robot|captcha/i.test(t)"
            + "||document.querySelector('#challenge-form,#challenge-running,[name=cf-turnstile-response],iframe[src*=challenges],script[src*=challenge-platform]'))?'check':'no';})()";

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

    void enqueue(String key, String doi, String title, String pii) {
        if (job != null && job.key.equals(key)) return;
        for (Job j : queue) if (j.key.equals(key)) return;
        queue.addLast(new Job(key, doi, title, pii));
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
        challengeWaits = 0;
        attachClients();
        status("opening", job.viaClinicalKey ? "Opening the paper in ClinicalKey…" : "Opening the paper through Research4Life…");
        main.removeCallbacks(timeout);
        main.postDelayed(timeout, JOB_TIMEOUT_MS);
        webView.loadUrl(job.startUrl());
    }

    private void attachClients() {
        webView.setWebChromeClient(null);
        webView.getSettings().setUserAgentString(null);
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
                main.postDelayed(() -> { if (job != null) webView.loadUrl(job.startUrl()); }, 1200);
            }
            return;
        }
        // Research4Life sometimes lands on the site's bare home page (doi.org's, ClinicalKey's) instead
        // of the article: reopen the article link once; never take PDFs from such a page.
        String path = u.getPath() == null ? "/" : u.getPath();
        if (isProxiedContent(u) && path.matches("/tacsgr1[^/]*/?") && (u.getQuery() == null || u.getQuery().isEmpty())
                && !(job.viaClinicalKey && url.contains("#!/content"))) {
            if (!job.reopened) {
                job.reopened = true;
                status("opening", "Opening the article again…");
                webView.loadUrl(job.startUrl());
            } else {
                fail("Research4Life opened the site's home page instead of the article. Tap Show page to open it yourself, or try MyLOFT.", true);
            }
            return;
        }
        status("finding", "Looking for the PDF…");
        final int token = pageToken;
        // ClinicalKey's page builds itself (and its session) with scripts: give it longer.
        main.postDelayed(() -> { if (token == pageToken && job != null && !saving) findPdf(url); }, job.viaClinicalKey ? 6000 : 2000);
    }

    private void findPdf(String pageUrl) {
        webView.evaluateJavascript(R4LSession.FIND_PDF_SCRIPT, value -> {
            if (job == null || saving) return;
            String next = null;
            // ClinicalKey's own PDF address for the article comes first.
            if (job.viaClinicalKey) {
                String ck = R4LSession.clinicalKeyPdfUrl(job.pii);
                if (!tried.contains(ck)) next = ck;
            }
            try {
                JSONArray arr = new JSONArray(new JSONArray("[" + value + "]").getString(0));
                boolean viaProxy = isProxiedContent(Uri.parse(pageUrl));
                // doi.org only forwards to articles: any PDF on its own pages is never the paper.
                if (pageUrl != null && pageUrl.contains("/tacsgr1doi_org")) arr = new JSONArray();
                for (int i = 0; i < arr.length() && next == null; i++) {
                    String c = fixPdfUrl(arr.getString(i));
                    if (viaProxy) c = R4LSession.proxied(c);
                    if (!tried.contains(c) && !c.equals(pageUrl)) next = c;
                }
            } catch (Exception ignored) {
            }
            if (next == null) {
                // ClinicalKey showed a page instead of the PDF: go straight to the usual route.
                if (job.viaClinicalKey && pdfAttempts > 0) { failNow("ClinicalKey didn't give the PDF.", true); return; }
                if (pdfAttempts == 0) { waitOrFail(pageUrl); return; }
                // Every PDF link was tried and none gave a PDF: say so soon, instead of waiting out the timeout.
                final Job j = job;
                main.postDelayed(() -> {
                    if (job == j && !saving) fail("The PDF link opened a page, not the PDF: your Research4Life account may not include this journal (try your other account or MyLOFT), or the site wants a tap: tap Show page.", true);
                }, 10_000);
                return;
            }
            if (++pdfAttempts > MAX_PDF_ATTEMPTS) {
                fail("Couldn't reach the PDF automatically. Tap Show page to open it yourself.", true);
                return;
            }
            tried.add(next);
            status("downloading", "Downloading the PDF…");
            webView.loadUrl(next);
            // A link that neither downloads nor opens a page: look again after 20 s (next link or a clear failure).
            final Job jl = job;
            final int attempt = pdfAttempts;
            main.postDelayed(() -> { if (job == jl && !saving && pdfAttempts == attempt) findPdf(webView.getUrl()); }, 20_000);
        });
    }

    /**
     * No PDF link yet. If the publisher is still running its security check, wait for it
     * (it usually passes by itself in a few seconds); otherwise the journal isn't accessible.
     */
    private void waitOrFail(String pageUrl) {
        final Job j = job;
        // Research4Life only keeps you on its proxy for journals it covers; anything else is
        // sent to the publisher's own site (where a "security verification" page is common).
        Uri pu = pageUrl == null ? null : Uri.parse(pageUrl);
        if (pu != null && !isProxiedContent(pu) && !R4LSession.isR4LHost(pu.getHost())) {
            failNow(NOT_COVERED + "This journal isn't in your Research4Life access (" + pu.getHost() + "). Get it through MyLOFT.", true);
            return;
        }
        final int token = pageToken;
        webView.evaluateJavascript(CHALLENGE_SCRIPT, v -> {
            if (job != j || saving) return;
            if (v != null && v.contains("check")) {
                if (++challengeWaits <= 12) {
                    status("finding", "Passing the publisher's security check…");
                    main.removeCallbacks(timeout);
                    main.postDelayed(timeout, JOB_TIMEOUT_MS);
                    // A passed check loads the article (onPageLoaded takes over); otherwise look again.
                    main.postDelayed(() -> { if (job == j && !saving && token == pageToken) findPdf(webView.getUrl()); }, 2500);
                } else {
                    fail("The publisher wants you to confirm you're human. Tap Show page, tick the box once, and the PDF saves — or try MyLOFT.", true);
                }
                return;
            }
            fail("Not available through your Research4Life access. Try MyLOFT, or tap Show page to check.", true);
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

    /** Adds where the page stopped ("the page shows: …") to a failure, so it can be fixed. */
    private void fail(String message, boolean canShow) {
        if (webView == null || job == null || saving) { failNow(message, canShow); return; }
        main.removeCallbacks(timeout);
        final Job j = job;
        webView.evaluateJavascript(UtdClient.HINT_SCRIPT, v -> {
            if (job != j) return;
            String where = v == null || "null".equals(v) ? "" : v.replaceAll("^\"|\"$", "");
            failNow(where.isEmpty() ? message : message + " (The page shows: “" + where + "”)", canShow);
        });
    }

    private void failNow(String message, boolean canShow) {
        main.removeCallbacks(timeout);
        Job j = job;
        job = null;
        saving = false;
        // ClinicalKey didn't give the PDF: try the usual Research4Life route (ScienceDirect) once.
        if (j != null && j.viaClinicalKey) {
            j.viaClinicalKey = false;
            j.clinicalKeyFailed = true;
            queue.addFirst(j);
            if (listener != null) listener.onStatus(j.key, "opening", "ClinicalKey didn't give the PDF. Trying the publisher through Research4Life…");
            main.postDelayed(this::next, 500);
            return;
        }
        // With several Research4Life accounts saved, try the paper again with the next one.
        int accounts = R4LSession.accountCount(app, R4LSession.R4L);
        String nextUser = R4LSession.nextAccount(app, R4LSession.R4L);
        if (j != null && nextUser != null && j.accountTries < accounts - 1) {
            j.accountTries++;
            R4LSession.setActive(app, R4LSession.R4L, nextUser);
            R4LSession.signOut(R4LSession.R4L_ORIGINS);
            queue.addFirst(j);
            if (listener != null) listener.onStatus(j.key, "opening", "Trying your other Research4Life account (" + nextUser + ")…");
            main.postDelayed(this::next, 800);
            return;
        }
        if (j != null && j.clinicalKeyFailed && !message.startsWith(NOT_COVERED)) {
            message = "ClinicalKey didn't give the PDF: sign in to ClinicalKey once through Research4Life (R4L → ClinicalKey) in the app, then try again. " + message;
        }
        if (listener != null && j != null) listener.onFailed(j.key, message, canShow);
        next();
    }

    private void finishJob() {
        job = null;
        saving = false;
        next();
    }
}
