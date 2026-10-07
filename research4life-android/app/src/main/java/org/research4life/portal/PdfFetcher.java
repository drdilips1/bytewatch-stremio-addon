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
    private static final int MAX_LOADS = 24;
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
        /** ClinicalKey's sign-in was renewed through Research4Life (once per paper). */
        boolean ckRenewed;
        /** The link renewing ClinicalKey's sign-in, while it's being opened. */
        String renewUrl;
        /** Whether the article link was already reopened after landing on a site's bare home page. */
        boolean reopened;
        /** Pages loaded for this paper, across retries and accounts: a cap stops endless back-and-forth. */
        int loads;
        int accountTries;
        /** Springer/BMC paper with the person's own Springer Nature Link login: tried there first. */
        boolean viaSpringer;
        /** Springer's sign-in page was opened for this paper. */
        boolean springerLogin;
        /** Through the college proxy: the publisher's own site, with the college's access. */
        boolean viaCollege;
        /** One way only, as picked on the paper's page ("college", "r4l"), or null for every way in turn. */
        String only;
        Job(String key, String doi, String title, String pii) {
            this.key = key; this.doi = doi; this.title = title;
            this.pii = pii == null ? "" : pii;
            viaClinicalKey = !this.pii.isEmpty();
        }
        String startUrl() {
            if (viaSpringer) return R4LSession.springerPdfUrl(doi);
            if (viaCollege) return "https://doi.org/" + doi;
            return viaClinicalKey ? R4LSession.clinicalKeyUrl(pii) : R4LSession.doiUrl(doi);
        }
    }

    private final Context app;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final ArrayDeque<Job> queue = new ArrayDeque<>();
    private final Map<String, String> lastUrls = new HashMap<>();
    private final Map<String, String> clinicalKeyPages = new HashMap<>();
    /** The pages each paper went through (for the Details button when Get PDF fails). */
    private final Map<String, java.util.List<String>> trails = new HashMap<>();
    private final Set<String> tried = new HashSet<>();
    private Listener listener;
    private WebView webView;
    private ViewGroup host;
    private Job job;
    private boolean saving;
    private int pdfAttempts, signInPages, reloadsAfterSignIn, pageToken, challengeWaits;
    /** The last address onPageLoaded handled (so a scripted page change isn't handled twice). */
    private String lastHandled;

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
        enqueue(key, doi, title, pii, null);
    }

    /** route: null tries every way in turn; "college" only the college proxy; "r4l" only Research4Life. */
    void enqueue(String key, String doi, String title, String pii, String route) {
        if (job != null && job.key.equals(key)) return;
        for (Job j : queue) if (j.key.equals(key)) return;
        trails.remove(key);
        Job nj = new Job(key, doi, title, pii);
        nj.only = route;
        nj.viaSpringer = route == null && nj.pii.isEmpty() && R4LSession.isSpringerDoi(doi) && R4LSession.hasCredentials(app, R4LSession.SPR);
        nj.viaCollege = "college".equals(route) || (route == null && !nj.viaSpringer && collegeRoute(doi));
        queue.addLast(nj);
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

    /** The pages a paper's Get PDF went through, newest last. */
    String trail(String key) {
        java.util.List<String> t = trails.get(key);
        return t == null ? "" : android.text.TextUtils.join("\n", t);
    }

    String lastUrl(String key) {
        // An Elsevier paper whose ClinicalKey try failed: Show page opens it in ClinicalKey, not ScienceDirect.
        String ck = clinicalKeyPages.get(key);
        return ck != null ? ck : lastUrls.get(key);
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
        lastHandled = null;
        attachClients();
        String who = R4LSession.username(app);
        status("opening", job.viaSpringer ? "Getting the PDF from Springer Nature Link…"
                : job.viaCollege ? "Opening the paper through your college proxy…"
                : job.viaClinicalKey ? "Opening the paper in ClinicalKey…"
                : "Opening the paper through Research4Life" + (who == null || who.isEmpty() ? "" : " (" + who + ")") + "…");
        main.removeCallbacks(timeout);
        main.postDelayed(timeout, JOB_TIMEOUT_MS);
        webView.loadUrl(job.startUrl());
    }

    private void attachClients() {
        webView.addJavascriptInterface(pageBridge, "DSPDF");
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
            public void onReceivedHttpAuthRequest(WebView view, android.webkit.HttpAuthHandler handler, String host, String realm) {
                // The college proxy's password pop-up: answered with the saved login.
                if (!CollegeProxy.answer(view.getContext(), handler, host)) super.onReceivedHttpAuthRequest(view, handler, host, realm);
            }

            @Override
            public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
                // Research4Life's portal changes pages with scripts (signing in, then its home page)
                // without a new page load: handle such a change like a loaded page.
                if (job == null || saving || url == null) return;
                Uri u = Uri.parse(url);
                if (!R4LSession.isR4LHost(u.getHost()) || isProxiedContent(u)) return;
                final Job j = job;
                final int token = pageToken;
                main.postDelayed(() -> {
                    if (job == j && !saving && token == pageToken && url.equals(view.getUrl()) && !url.equals(lastHandled)) onPageLoaded(url);
                }, 1500);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                CookieManager.getInstance().flush();
                if (job != null) {
                    lastUrls.put(job.key, url);
                    java.util.List<String> t = trails.get(job.key);
                    if (t == null) { t = new java.util.ArrayList<>(); trails.put(job.key, t); }
                    String line = (job.accountTries > 0 ? "[account " + (job.accountTries + 1) + "] " : "") + url;
                    if (t.isEmpty() || !t.get(t.size() - 1).equals(line)) t.add(line.length() > 220 ? line.substring(0, 220) + "…" : line);
                    while (t.size() > 30) t.remove(0);
                    // What the page showed (title and first words), for Details when Get PDF fails.
                    final java.util.List<String> tl = t;
                    view.evaluateJavascript("(document.title+' | '+(document.body?document.body.innerText:'')).replace(/\\s+/g,' ').trim().slice(0,160)", v -> {
                        if (v == null || v.equals("null") || v.length() < 6) return;
                        String said = v.replaceAll("^\"|\"$", "").replace("\\\"", "\"");
                        if (!said.equals(" | ") && tl.size() < 40) tl.add("   ↳ " + said);
                    });
                }
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
        lastHandled = url;
        Uri ru = Uri.parse(url);
        if (job.renewUrl != null && !R4LSession.isR4LHost(ru.getHost())) {
            // Renewing ClinicalKey: once ClinicalKey itself opens, go back to the paper.
            if (R4LSession.isClinicalKeyHost(ru.getHost())) {
                job.renewUrl = null;
                status("opening", "ClinicalKey renewed. Opening the paper…");
                final Job j = job;
                main.postDelayed(() -> { if (job == j && !saving) webView.loadUrl(j.startUrl()); }, 4000);
            }
            return;
        }
        if (job.viaSpringer && springerStep(url)) { job.loads++; return; }
        if (++job.loads > MAX_LOADS) {
            fail("Research4Life kept going between pages without reaching the PDF. Tap Show page to see where it stops, or use Get PDF via MyLOFT.", true);
            return;
        }
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
                status("signing-in", "Signing in to Research4Life as " + R4LSession.username(app) + "…");
            }
            String pass = R4LSession.hasCredentials(app) ? R4LSession.password(app) : null;
            webView.evaluateJavascript(R4LSession.signInScript(R4LSession.username(app), pass, true), null);
            if (!isSignInPage(u) && u.getHost() != null && u.getHost().startsWith("portal.")
                    && signInPages > 0 && reloadsAfterSignIn < 2) {
                reloadsAfterSignIn++;
                status("opening", "Signed in. Opening the paper…");
                main.postDelayed(() -> { if (job != null) webView.loadUrl(job.renewUrl != null ? job.renewUrl : job.startUrl()); }, 1200);
                return;
            }
            // Still on a Research4Life page after a while (a sign-in that went through without the
            // page changing, or its home page): open the paper again rather than waiting it out.
            final Job j = job;
            final int token = pageToken;
            main.postDelayed(() -> {
                if (job != j || saving || token != pageToken || reloadsAfterSignIn >= 3) return;
                Uri now = Uri.parse(String.valueOf(webView.getUrl()));
                if (!R4LSession.isR4LHost(now.getHost()) || isProxiedContent(now)) return;
                reloadsAfterSignIn++;
                if (isSignInPage(now) && signInPages >= MAX_SIGNIN_PAGES) {
                    fail("Research4Life sign-in didn't go through. Check your saved ID and password, or tap Show page.", true);
                    return;
                }
                status("opening", "Opening the paper through Research4Life again…");
                webView.loadUrl(j.renewUrl != null ? j.renewUrl : j.startUrl());
            }, 15_000);
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

    /**
     * The Springer Nature Link route (the person's own account): its sign-in page is filled in with
     * the saved login; a paper page (no access yet) leads to the sign-in once, coming back to the PDF.
     * Returns false to let the usual steps run (looking for the PDF on the page).
     */
    private boolean springerStep(String url) {
        Uri u = Uri.parse(url);
        if (job.loads > MAX_LOADS) return false;
        if (R4LSession.SPR.equals(R4LSession.providerFor(u))) {
            if (++signInPages > MAX_SIGNIN_PAGES) { failNow("Springer Nature Link sign-in didn't go through.", true); return true; }
            status("signing-in", "Signing in to Springer Nature Link as " + R4LSession.username(app, R4LSession.SPR) + "…");
            webView.evaluateJavascript(R4LSession.signInScript(R4LSession.username(app, R4LSession.SPR), R4LSession.password(app, R4LSession.SPR), true), null);
            return true;
        }
        if (!R4LSession.isSpringerHost(u.getHost())) return false;
        // A Springer page instead of the PDF: not signed in yet (sign in, then back to the PDF), or,
        // after signing in, a page on the way back: open the PDF again (once).
        if (!job.springerLogin) {
            job.springerLogin = true;
            status("signing-in", "Signing in to Springer Nature Link…");
            final Job j = job;
            main.postDelayed(() -> { if (job == j && !saving) webView.loadUrl(R4LSession.springerLoginUrl(j.startUrl())); }, 800);
            return true;
        }
        if (reloadsAfterSignIn < 1 && !url.contains("/content/pdf/")) {
            reloadsAfterSignIn++;
            status("opening", "Signed in. Getting the PDF from Springer Nature Link…");
            final Job j = job;
            main.postDelayed(() -> { if (job == j && !saving) webView.loadUrl(j.startUrl()); }, 1500);
            return true;
        }
        return false;
    }

    private boolean collegeRoute(String doi) {
        return doi != null && !doi.isEmpty() && CollegeProxy.usable(app);
    }

    private void findPdf(String pageUrl) {
        webView.evaluateJavascript(R4LSession.FIND_PDF_SCRIPT, value -> {
            if (job == null || saving) return;
            String next = null;
            // ClinicalKey's own PDF address for the article comes first.
            if (job.viaClinicalKey && !job.viaCollege) {
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
                if (job.viaClinicalKey && !job.viaCollege && pdfAttempts > 0) { failNow("ClinicalKey didn't give the PDF.", true); return; }
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

    /**
     * Through the college proxy the PDF is fetched by the page itself (the browser's connection
     * through the proxy, with its sign-in): a separate download can't pass the proxy's login.
     */
    private void save(String url, String userAgent, String fileName) {
        if (CollegeProxy.proxyFor(app, url) != null && webView != null) saveInPage(url, userAgent, fileName);
        else saveDirect(url, userAgent, fileName);
    }

    private final class PageBridge {
        String id;
        java.io.ByteArrayOutputStream buf;

        @android.webkit.JavascriptInterface
        public void chunk(String forId, String b64) {
            synchronized (this) {
                if (forId == null || !forId.equals(id) || buf == null || buf.size() > 80_000_000) return;
                byte[] b = android.util.Base64.decode(b64, android.util.Base64.DEFAULT);
                buf.write(b, 0, b.length);
            }
        }

        @android.webkit.JavascriptInterface
        public void end(String forId) {
            byte[] data;
            synchronized (this) {
                if (forId == null || !forId.equals(id) || buf == null) return;
                data = buf.toByteArray();
                id = null;
                buf = null;
            }
            main.post(() -> pageFetched(forId, data, null));
        }

        @android.webkit.JavascriptInterface
        public void error(String forId, String message) {
            synchronized (this) {
                if (forId == null || !forId.equals(id)) return;
                id = null;
                buf = null;
            }
            main.post(() -> pageFetched(forId, null, message));
        }
    }

    private final PageBridge pageBridge = new PageBridge();
    private String pageFetchId, pageFetchUrl, pageFetchUa, pageFetchName;

    private void saveInPage(String url, String userAgent, String fileName) {
        final Job j = job;
        saving = true;
        main.removeCallbacks(timeout);
        status("downloading", "Saving the PDF…");
        final String id = "p" + System.nanoTime();
        synchronized (pageBridge) {
            pageBridge.id = id;
            pageBridge.buf = new java.io.ByteArrayOutputStream();
        }
        pageFetchId = id;
        pageFetchUrl = url;
        pageFetchUa = userAgent;
        pageFetchName = fileName;
        String js = "(function(u,id){fetch(u,{credentials:'include'}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.arrayBuffer();})"
                + ".then(function(b){var a=new Uint8Array(b),C=393216;for(var i=0;i<a.length;i+=C){var s='',sub=a.subarray(i,i+C);"
                + "for(var k=0;k<sub.length;k+=8192)s+=String.fromCharCode.apply(null,sub.subarray(k,k+8192));DSPDF.chunk(id,btoa(s));}DSPDF.end(id);})"
                + ".catch(function(e){DSPDF.error(id,String(e&&e.message||e));});})(" + R4LSession.jsString(url) + "," + R4LSession.jsString(id) + ")";
        webView.evaluateJavascript(js, null);
        // No answer from the page (it navigated away): the usual download instead.
        main.postDelayed(() -> { if (job == j && id.equals(pageFetchId)) pageFetched(id, null, "timeout"); }, 90_000);
    }

    private void pageFetched(String id, byte[] data, String error) {
        if (!id.equals(pageFetchId) || job == null) return;
        pageFetchId = null;
        final Job j = job;
        if (data == null) {
            // The page couldn't fetch it (another site's file, or no answer): the usual download.
            saving = false;
            saveDirect(pageFetchUrl, pageFetchUa, pageFetchName);
            return;
        }
        io.execute(() -> {
            try {
                PdfStore.saveBytes(app, j.key, data, j.title != null ? j.title : pageFetchName, pageFetchUrl);
                main.post(() -> {
                    if (listener != null) listener.onSaved(j.key, j.title);
                    finishJob();
                });
            } catch (Exception e) {
                main.post(() -> {
                    saving = false;
                    if (job != j) return;
                    if ("NOT_PDF".equals(e.getMessage())) {
                        status("finding", "Looking for the PDF…");
                        main.postDelayed(() -> { if (job == j && !saving) findPdf(webView.getUrl()); }, 1500);
                    } else {
                        fail("Couldn't save the PDF: " + e.getMessage(), true);
                    }
                });
            }
        });
    }

    private void saveDirect(String url, String userAgent, String fileName) {
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
        // ClinicalKey gave no PDF: its sign-in has usually expired. Renew it through Research4Life
        // (the link learned when ClinicalKey was opened from Research4Life) and try once more.
        Job r = job;
        // Springer Nature Link didn't give the PDF (no access to this journal on that account):
        // the usual Research4Life route next.
        if (r != null && "college".equals(r.only)) {
            // Only the college proxy was asked for: say so, the other ways are on the paper's page.
            job = null;
            saving = false;
            if (listener != null) listener.onFailed(r.key, "Your college proxy didn't give the PDF (the college may not subscribe to this journal). "
                    + (message.startsWith(NOT_COVERED) ? "" : message + " ") + "Try Get PDF with R4L or MyLOFT.", canShow);
            next();
            return;
        }
        if (r != null && (r.viaSpringer || r.viaCollege)) {
            String from = r.viaSpringer ? "Springer Nature Link" : "Your college proxy";
            r.viaCollege = r.viaSpringer && collegeRoute(r.doi);
            r.viaSpringer = false;
            job = null;
            saving = false;
            queue.addFirst(r);
            if (listener != null) listener.onStatus(r.key, "opening", from + " didn't give the PDF. Trying "
                    + (r.viaCollege ? "your college proxy" : r.viaClinicalKey ? "ClinicalKey" : "Research4Life") + "…");
            main.postDelayed(this::next, 500);
            return;
        }
        String entry = R4LSession.clinicalKeyEntry(app);
        if (r != null && r.viaClinicalKey && !r.ckRenewed && entry != null && r.loads <= MAX_LOADS) {
            r.ckRenewed = true;
            r.renewUrl = entry;
            tried.clear();
            pdfAttempts = 0;
            signInPages = 0;
            reloadsAfterSignIn = 0;
            status("opening", "Renewing your ClinicalKey sign-in through Research4Life…");
            main.postDelayed(timeout, JOB_TIMEOUT_MS);
            webView.loadUrl(entry);
            return;
        }
        Job j = job;
        job = null;
        saving = false;
        // ClinicalKey didn't give the PDF: try the usual Research4Life route (ScienceDirect) once.
        if (j != null && j.viaClinicalKey && j.loads <= MAX_LOADS) {
            clinicalKeyPages.put(j.key, R4LSession.clinicalKeyUrl(j.pii));
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
        if (j != null && nextUser != null && j.accountTries < accounts - 1 && j.loads <= MAX_LOADS) {
            j.accountTries++;
            R4LSession.setActive(app, R4LSession.R4L, nextUser);
            R4LSession.signOut(R4LSession.R4L_ORIGINS);
            queue.addFirst(j);
            if (listener != null) listener.onStatus(j.key, "opening", "Trying your other Research4Life account (" + nextUser + ")…");
            main.postDelayed(this::next, 800);
            return;
        }
        if (j != null && j.clinicalKeyFailed) {
            // Elsevier journals come through ClinicalKey; ScienceDirect refusing them doesn't mean
            // Research4Life lacks the journal.
            message = message.startsWith(NOT_COVERED)
                    ? (R4LSession.clinicalKeyEntry(app) == null
                        ? "ClinicalKey didn't give the PDF: its sign-in has expired. Open ClinicalKey once from Research4Life in the app (a journal page → R4L → ClinicalKey): the app keeps that link and renews ClinicalKey by itself from then on. Or use MyLOFT."
                        : "ClinicalKey didn't give the PDF, even after renewing its sign-in through Research4Life. Tap Show page to see it in ClinicalKey, Details for what each page said, or use MyLOFT.")
                    : "ClinicalKey didn't give the PDF: sign in to ClinicalKey once through Research4Life (R4L → ClinicalKey) in the app, then try again. " + message;
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
