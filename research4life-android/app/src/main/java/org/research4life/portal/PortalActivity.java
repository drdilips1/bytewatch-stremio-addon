package org.research4life.portal;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;

import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Research4Life browser. In browse mode it is a normal in-app browser that keeps the R4L
 * session alive between visits. In fetch mode it opens a paper through the R4L access proxy,
 * signs in with the saved account when asked, finds the PDF link and saves it to the library.
 */
public class PortalActivity extends Activity {

    static final String EXTRA_URL = "url";
    static final String EXTRA_KEY = "key";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_DOI = "doi";
    static final String EXTRA_FETCH = "fetch";

    private static final int REQUEST_FILE_CHOOSER = 1;
    private static final int MAX_PDF_ATTEMPTS = 4;
    private static final int MAX_SIGNIN_PAGES = 4;
    private static final long FETCH_TIMEOUT_MS = 75_000;

    /** The screen currently hosting the shared WebView, for the JS bridge. */
    private static volatile PortalActivity current;
    private static boolean bridgeAdded;

    private WebView webView;
    private ProgressBar progressBar;
    private TextView titleView;
    private TextView hint;
    private LinearLayout banner;
    private TextView bannerText;
    private ProgressBar bannerSpinner;
    private TextView bannerAction;
    private ValueCallback<Uri[]> filePathCallback;

    private String articleKey;
    private String articleTitle;
    private String doi;
    private boolean fetching;
    private boolean saving;
    private int pdfAttempts;
    private int signInPages;
    private int reloadsAfterSignIn;
    private int pageToken;
    private final Set<String> tried = new HashSet<>();
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable timeout = () -> {
        if (fetching && !saving) {
            setBanner("Couldn't find the PDF automatically. Tap the PDF link on the page and it will be saved.", false, "Retry");
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = R4LSession.obtain(this);
        current = this;
        if (!bridgeAdded) {
            webView.addJavascriptInterface(new Bridge(), "DSR4L");
            bridgeAdded = true;
        }
        buildUi();
        attachClients();
        handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent in) {
        articleKey = in.getStringExtra(EXTRA_KEY);
        articleTitle = in.getStringExtra(EXTRA_TITLE);
        doi = in.getStringExtra(EXTRA_DOI);
        fetching = in.getBooleanExtra(EXTRA_FETCH, false) && doi != null && !doi.isEmpty();
        saving = false;
        main.removeCallbacks(timeout);
        hideBanner();
        updateHint();

        String url = in.getStringExtra(EXTRA_URL);
        if (fetching) {
            startFetch();
        } else if (url != null) {
            webView.loadUrl(url);
        } else if (webView.getUrl() == null) {
            webView.loadUrl(R4LSession.PORTAL_URL);
        } else {
            titleView.setText(webView.getTitle());
        }
    }

    // ------------------------------------------------------------------ fetch flow

    private void startFetch() {
        tried.clear();
        pdfAttempts = 0;
        signInPages = 0;
        reloadsAfterSignIn = 0;
        saving = false;
        setBanner(R4LSession.hasCredentials(this)
                ? "Opening the paper through Research4Life…"
                : "Opening the paper through Research4Life. Sign in once if asked — the app remembers it.", true, "Cancel");
        main.removeCallbacks(timeout);
        main.postDelayed(timeout, FETCH_TIMEOUT_MS);
        webView.loadUrl(R4LSession.doiUrl(doi));
    }

    /** A page asking for credentials (the gateway's redirect hops under /tacgw/ are not). */
    private static boolean isSignInPage(Uri u) {
        String p = u.getPath() == null ? "" : u.getPath().toLowerCase();
        return !p.startsWith("/tacgw/") && (p.contains("signin") || p.contains("login"));
    }

    private static boolean isProxiedContent(Uri u) {
        return R4LSession.isR4LHost(u.getHost()) && u.getPath() != null && u.getPath().startsWith("/tacsgr1");
    }

    private void onPageLoaded(String url) {
        Uri u = Uri.parse(url);
        boolean r4l = R4LSession.isR4LHost(u.getHost());

        if (r4l && !isProxiedContent(u)) {
            // Gateway or portal page: help with sign-in.
            boolean auto = true;
            if (fetching && isSignInPage(u)) {
                signInPages++;
                if (signInPages > MAX_SIGNIN_PAGES) {
                    auto = false;
                    setBanner("Automatic sign-in didn't work. Please sign in on the page; the app will continue.", false, "Retry");
                } else if (R4LSession.hasCredentials(this)) {
                    setBanner("Signing in to Research4Life…", true, "Cancel");
                } else {
                    setBanner("Sign in to Research4Life below. The app will remember it and continue.", false, "Cancel");
                }
            }
            String pass = R4LSession.hasCredentials(this) ? R4LSession.password(this) : null;
            webView.evaluateJavascript(R4LSession.signInScript(R4LSession.username(this), pass, auto), null);

            // After signing in, the portal may land on its home page instead of the paper.
            if (fetching && !isSignInPage(u) && u.getHost().startsWith("portal.") && signInPages > 0
                    && reloadsAfterSignIn < 2) {
                reloadsAfterSignIn++;
                setBanner("Signed in. Opening the paper…", true, "Cancel");
                main.postDelayed(() -> webView.loadUrl(R4LSession.doiUrl(doi)), 1200);
            }
            return;
        }

        if (fetching && !saving) {
            setBanner("Looking for the PDF…", true, "Cancel");
            final int token = pageToken;
            // Give client-side redirects a moment before scanning the page.
            main.postDelayed(() -> { if (token == pageToken) findPdf(url); }, 2000);
        }
    }

    private void findPdf(String pageUrl) {
        webView.evaluateJavascript(R4LSession.FIND_PDF_SCRIPT, value -> {
            String next = null;
            try {
                // evaluateJavascript returns the JSON string itself JSON-encoded.
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
                    setBanner("No PDF link found on this page. If you have access, tap the PDF link and it will be saved.", false, "Retry");
                }
                return;
            }
            if (++pdfAttempts > MAX_PDF_ATTEMPTS) {
                setBanner("Couldn't reach the PDF automatically. Tap the PDF link on the page and it will be saved.", false, "Retry");
                return;
            }
            tried.add(next);
            setBanner("Opening the PDF…", true, "Cancel");
            webView.loadUrl(next);
        });
    }

    /** Publisher-specific tweaks that turn viewer links into direct PDF links. */
    private static String fixPdfUrl(String url) {
        if (url.contains("wiley")) {
            url = url.replace("/doi/epdf/", "/doi/pdfdirect/").replace("/doi/pdf/", "/doi/pdfdirect/");
        }
        if (url.contains("tandfonline") || url.contains("sagepub")) {
            url = url.replace("/doi/epdf/", "/doi/pdf/");
        }
        return url;
    }

    private void onDownload(String url, String userAgent, String contentDisposition, String mimeType) {
        if (url.startsWith("blob:") || url.startsWith("data:")) {
            Toast.makeText(this, "This file can't be downloaded in the app", Toast.LENGTH_SHORT).show();
            return;
        }
        String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
        boolean isPdf = "application/pdf".equalsIgnoreCase(mimeType)
                || "application/octet-stream".equalsIgnoreCase(mimeType)
                || fileName.toLowerCase().endsWith(".pdf")
                || url.toLowerCase().contains("pdf");
        if (isPdf) {
            savePdf(url, userAgent, fileName);
        } else {
            saveToDownloads(url, userAgent, mimeType, fileName);
        }
    }

    private void savePdf(String url, String userAgent, String fileName) {
        if (saving) return;
        saving = true;
        main.removeCallbacks(timeout);
        String key = articleKey != null ? articleKey : "r4l_" + System.currentTimeMillis();
        String title = articleTitle != null ? articleTitle : fileName.replaceAll("(?i)\\.pdf$", "");
        setBanner("Saving PDF to your library…", true, null);
        io.execute(() -> {
            try {
                PdfStore.download(this, key, url, title, userAgent);
                main.post(() -> {
                    setResult(RESULT_OK);
                    Toast.makeText(this, "Saved to your library", Toast.LENGTH_SHORT).show();
                    Intent i = new Intent(this, PdfViewerActivity.class);
                    i.putExtra(PdfViewerActivity.EXTRA_KEY, key);
                    i.putExtra(PdfViewerActivity.EXTRA_TITLE, title);
                    startActivity(i);
                    if (fetching) {
                        finish();
                    } else {
                        hideBanner();
                        saving = false;
                    }
                });
            } catch (Exception e) {
                String msg = "NOT_PDF".equals(e.getMessage())
                        ? "That link opened a page, not a PDF. Your access may not include this journal."
                        : "Couldn't save the PDF: " + e.getMessage();
                main.post(() -> {
                    saving = false;
                    setBanner(msg, false, "Retry");
                });
            }
        });
    }

    private void saveToDownloads(String url, String userAgent, String mimeType, String fileName) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            } catch (ActivityNotFoundException ignored) {
            }
            return;
        }
        try {
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setMimeType(mimeType);
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null) request.addRequestHeader("Cookie", cookie);
            request.addRequestHeader("User-Agent", userAgent);
            request.setTitle(fileName);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
            ((DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE)).enqueue(request);
            Toast.makeText(this, "Downloading " + fileName, Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            Toast.makeText(this, "Download failed", Toast.LENGTH_SHORT).show();
        }
    }

    // ------------------------------------------------------------------ JS bridge

    /** Called from injected scripts. Only trusts calls made while on a Research4Life page. */
    private static final class Bridge {
        @JavascriptInterface
        public void credentials(String user, String pass) {
            PortalActivity a = current;
            if (a == null || user == null || pass == null || user.isEmpty() || pass.isEmpty()) return;
            a.main.post(() -> {
                String url = a.webView.getUrl();
                if (url == null) return;
                Uri u = Uri.parse(url);
                if (!R4LSession.isR4LHost(u.getHost()) || isProxiedContent(u)) return;
                boolean changed = !user.trim().equals(R4LSession.username(a)) || !pass.equals(R4LSession.password(a));
                if (changed) {
                    R4LSession.saveCredentials(a, user, pass);
                    Toast.makeText(a, "Research4Life sign-in saved on this phone", Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public void status(String s) {
            // Reserved for progress reporting from injected scripts.
        }
    }

    // ------------------------------------------------------------------ UI

    private void attachClients() {
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request.getUrl());
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                pageToken++;
                progressBar.setVisibility(View.VISIBLE);
                titleView.setText(Uri.parse(url).getHost());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progressBar.setVisibility(View.GONE);
                String t = view.getTitle();
                if (t != null && !t.isEmpty() && !t.startsWith("http")) titleView.setText(t);
                CookieManager.getInstance().flush();
                onPageLoaded(url);
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progressBar.setProgress(newProgress);
                progressBar.setVisibility(newProgress < 100 ? View.VISIBLE : View.GONE);
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), REQUEST_FILE_CHOOSER);
                } catch (ActivityNotFoundException e) {
                    filePathCallback = null;
                    return false;
                }
                return true;
            }
        });
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, length) ->
                onDownload(url, userAgent, contentDisposition, mimeType));
    }

    private int dp(int v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }

    private boolean isNight() {
        return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    private TextView headerButton(String label, View.OnClickListener onClick, int fg) {
        TextView b = new TextView(this);
        b.setText(label);
        b.setTextColor(fg);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setPadding(dp(12), dp(8), dp(12), dp(8));
        b.setGravity(Gravity.CENTER);
        b.setOnClickListener(onClick);
        TypedValue tv = new TypedValue();
        getTheme().resolveAttribute(android.R.attr.selectableItemBackgroundBorderless, tv, true);
        b.setBackgroundResource(tv.resourceId);
        return b;
    }

    private void buildUi() {
        boolean night = isNight();
        int bg = night ? Color.parseColor("#16181D") : Color.WHITE;
        int fg = night ? Color.parseColor("#E6E8EB") : Color.parseColor("#111827");
        int accent = night ? Color.parseColor("#60A5FA") : Color.parseColor("#2563EB");

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(bg);

        LinearLayout bar = new LinearLayout(this);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(4), dp(4), dp(4), dp(4));
        bar.setBackgroundColor(bg);
        bar.setElevation(dp(2));
        bar.addView(headerButton("✕", v -> finish(), fg));

        LinearLayout titles = new LinearLayout(this);
        titles.setOrientation(LinearLayout.VERTICAL);
        titleView = new TextView(this);
        titleView.setTextColor(fg);
        titleView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        titleView.setSingleLine(true);
        titleView.setEllipsize(TextUtils.TruncateAt.END);
        titleView.setText("Research4Life");
        hint = new TextView(this);
        hint.setTextColor(Color.parseColor("#6B7280"));
        hint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        hint.setSingleLine(true);
        hint.setEllipsize(TextUtils.TruncateAt.END);
        titles.addView(titleView);
        titles.addView(hint);
        bar.addView(titles, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        bar.addView(headerButton("R4L", v -> webView.loadUrl(R4LSession.PORTAL_URL), accent));
        bar.addView(headerButton("↻", v -> webView.reload(), fg));
        bar.addView(headerButton("⇱", v -> {
            String url = webView.getUrl();
            if (url == null) return;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            } catch (ActivityNotFoundException ignored) {
            }
        }, fg));
        root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(56)));

        banner = new LinearLayout(this);
        banner.setGravity(Gravity.CENTER_VERTICAL);
        banner.setPadding(dp(14), dp(10), dp(8), dp(10));
        banner.setBackgroundColor(night ? Color.parseColor("#172338") : Color.parseColor("#EAF1FF"));
        bannerSpinner = new ProgressBar(this, null, android.R.attr.progressBarStyleSmall);
        banner.addView(bannerSpinner, new LinearLayout.LayoutParams(dp(20), dp(20)));
        bannerText = new TextView(this);
        bannerText.setTextColor(night ? Color.parseColor("#93C5FD") : Color.parseColor("#1D4ED8"));
        bannerText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13.5f);
        bannerText.setPadding(dp(10), 0, dp(6), 0);
        banner.addView(bannerText, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        bannerAction = headerButton("", v -> onBannerAction(), accent);
        banner.addView(bannerAction);
        banner.setVisibility(View.GONE);
        root.addView(banner, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        FrameLayout frame = new FrameLayout(this);
        frame.addView(webView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(100);
        FrameLayout.LayoutParams plp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(4));
        plp.gravity = Gravity.TOP;
        frame.addView(progressBar, plp);
        root.addView(frame, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);
    }

    private void updateHint() {
        hint.setText(R4LSession.hasCredentials(this)
                ? "Research4Life: " + R4LSession.username(this) + " · PDFs save to your library"
                : "PDFs you open here save to your library");
    }

    private void setBanner(String text, boolean busy, String action) {
        banner.setVisibility(View.VISIBLE);
        bannerText.setText(text);
        bannerSpinner.setVisibility(busy ? View.VISIBLE : View.GONE);
        bannerAction.setVisibility(action == null ? View.GONE : View.VISIBLE);
        bannerAction.setText(action == null ? "" : action);
    }

    private void hideBanner() {
        banner.setVisibility(View.GONE);
    }

    private void onBannerAction() {
        String a = bannerAction.getText().toString();
        if ("Retry".equals(a) && fetching) {
            startFetch();
        } else if ("Cancel".equals(a)) {
            fetching = false;
            main.removeCallbacks(timeout);
            hideBanner();
        } else {
            hideBanner();
        }
    }

    /** Keeps http(s) pages in the app; hands other schemes (mailto:, tel:, intent:) to the system. */
    private boolean handleUrl(Uri uri) {
        String scheme = uri.getScheme();
        if ("http".equals(scheme) || "https".equals(scheme)) return false;
        try {
            Intent intent = "intent".equals(scheme)
                    ? Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME)
                    : new Intent(Intent.ACTION_VIEW, uri);
            startActivity(intent);
        } catch (Exception e) {
            Toast.makeText(this, "No app can open this link", Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQUEST_FILE_CHOOSER) {
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                filePathCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack() && !fetching) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onDestroy() {
        main.removeCallbacksAndMessages(null);
        io.shutdown();
        if (current == this) {
            current = null;
            // Detach, but keep the session (and its signed-in pages) for next time.
            webView.setWebViewClient(new WebViewClient());
            webView.setWebChromeClient(null);
            webView.setDownloadListener(null);
            if (fetching) webView.stopLoading();
            R4LSession.release(this);
        }
        super.onDestroy();
    }
}
