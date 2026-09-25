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

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Research4Life browser, shown only when the user asks for it (the R4L tab, or "Show page"
 * when a background fetch needs help). It shares the fetcher's WebView, so the R4L session
 * carries over, and any PDF opened here is saved to the library.
 */
public class PortalActivity extends Activity {

    static final String EXTRA_URL = "url";
    static final String EXTRA_KEY = "key";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_PROVIDER = "provider";

    private static final int REQUEST_FILE_CHOOSER = 1;

    private WebView webView;
    private ProgressBar progressBar;
    private TextView titleView;
    private TextView hint;
    private TextView homeButton;
    private ValueCallback<Uri[]> filePathCallback;
    private String articleKey;
    private String articleTitle;
    private boolean saving;
    private String provider = R4LSession.R4L;
    private String lastSignInUrl;
    private int signInRepeats;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        PdfFetcher.get(this).suspend();
        webView = R4LSession.obtain(this);
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
        String p = in.getStringExtra(EXTRA_PROVIDER);
        provider = R4LSession.UTD.equals(p) || R4LSession.MYLOFT.equals(p) ? p : R4LSession.R4L;
        boolean myloft = R4LSession.MYLOFT.equals(provider);
        homeButton.setText(R4LSession.UTD.equals(provider) ? "UTD" : myloft ? "MyLoft" : "R4L");
        String name = R4LSession.UTD.equals(provider) ? "UpToDate" : myloft ? "MyLoft" : "Research4Life";
        hint.setText(articleKey != null
                ? (myloft ? "Find the paper in MyLoft · its PDF saves to this paper" : "PDFs you open here save to this paper")
                : myloft ? "MyLoft · PDFs you download save to your library"
                : R4LSession.hasCredentials(this, provider)
                    ? name + ": login saved for " + R4LSession.username(this, provider)
                    : name + " · your sign-in is remembered");
        String url = in.getStringExtra(EXTRA_URL);
        if (url != null) {
            webView.loadUrl(url);
        } else if (webView.getUrl() == null) {
            webView.loadUrl(homeUrl());
        } else {
            titleView.setText(webView.getTitle());
            onPageLoaded(webView.getUrl());
        }
    }

    private String homeUrl() {
        if (R4LSession.MYLOFT.equals(provider)) return R4LSession.MYLOFT_HOME;
        return R4LSession.UTD.equals(provider) ? R4LSession.UTD_HOME : R4LSession.PORTAL_URL;
    }

    private void onPageLoaded(String url) {
        if (url == null) return;
        // Stop auto-submitting if the same sign-in page keeps coming back (wrong password).
        String path = Uri.parse(url).getPath();
        boolean loginPage = path != null && path.toLowerCase().matches(".*(login|signin|sign-in).*");
        if (loginPage && url.equals(lastSignInUrl)) signInRepeats++;
        else if (loginPage) { lastSignInUrl = url; signInRepeats = 0; }
        String js = R4LSession.signInScriptFor(this, url, signInRepeats < 2);
        if (js != null) webView.evaluateJavascript(js, null);
        if (loginPage && signInRepeats == 2) {
            Toast.makeText(this, "Sign-in didn't go through. Check your saved password in Settings.", Toast.LENGTH_LONG).show();
        }
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
        if (isPdf) savePdf(url, userAgent, fileName);
        else saveToDownloads(url, userAgent, mimeType, fileName);
    }

    private void savePdf(String url, String userAgent, String fileName) {
        if (saving) return;
        saving = true;
        String key = articleKey != null ? articleKey : "r4l_" + System.currentTimeMillis();
        String title = articleTitle != null ? articleTitle : fileName.replaceAll("(?i)\\.pdf$", "");
        Toast.makeText(this, "Saving PDF to your library…", Toast.LENGTH_SHORT).show();
        io.execute(() -> {
            try {
                PdfStore.download(this, key, url, title, userAgent);
                main.post(() -> {
                    saving = false;
                    setResult(RESULT_OK, new Intent().putExtra(EXTRA_KEY, key));
                    Toast.makeText(this, "Saved to your library", Toast.LENGTH_SHORT).show();
                    if (articleKey != null) finish();
                });
            } catch (Exception e) {
                String msg = "NOT_PDF".equals(e.getMessage())
                        ? "That link opened a page, not a PDF."
                        : "Couldn't save the PDF: " + e.getMessage();
                main.post(() -> {
                    saving = false;
                    Toast.makeText(this, msg, Toast.LENGTH_LONG).show();
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

    private void attachClients() {
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request.getUrl());
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
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
        boolean night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
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
        homeButton = headerButton("R4L", v -> webView.loadUrl(homeUrl()), accent);
        bar.addView(homeButton);
        bar.addView(headerButton("↻", v -> webView.reload(), fg));
        root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(56)));

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
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
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
        if (R4LSession.isOwner(this)) {
            webView.setWebViewClient(new WebViewClient());
            webView.setWebChromeClient(null);
            webView.setDownloadListener(null);
            R4LSession.release(this);
        }
        super.onDestroy();
    }
}
