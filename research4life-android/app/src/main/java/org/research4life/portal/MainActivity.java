package org.research4life.portal;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.database.Cursor;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.core.content.FileProvider;
import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Hosts the bundled research app (assets/www) and exposes native storage to it. */
public class MainActivity extends Activity {

    static final String APP_HOST = "appassets.androidplatform.net";
    private static final String APP_URL = "https://" + APP_HOST + "/assets/www/index.html";
    private static final int REQUEST_IMPORT = 10;
    private static final int REQUEST_PORTAL = 11;

    private WebView webView;
    private FrameLayout fetchLayer;
    private PdfFetcher fetcher;
    private Narrator narrator;
    private static final String AI = "claude";
    private AiClient aiClient;
    private volatile String receivedAtStart;
    private UtdClient utd;
    private WebViewAssetLoader assetLoader;
    private final ExecutorService io = Executors.newFixedThreadPool(2);
    private final Handler main = new Handler(Looper.getMainLooper());

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // The app UI sits on top; the Research4Life fetcher's WebView runs underneath, unseen.
        fetchLayer = new FrameLayout(this);
        webView = new WebView(this);
        fetchLayer.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(fetchLayer);
        utd = new UtdClient(this, fetchLayer);
        utd.setStatusListener(m -> emit(event("utdStatus", "message", m)));
        fetcher = PdfFetcher.get(this);
        fetcher.setListener(new PdfFetcher.Listener() {
            @Override
            public void onStatus(String key, String stage, String message) {
                emit(event("fetchStatus", "key", key, "stage", stage, "message", message));
            }

            @Override
            public void onSaved(String key, String title) {
                emit(event("pdfSaved", "key", key));
            }

            @Override
            public void onFailed(String key, String message, boolean canShowPage) {
                emit(event("fetchFailed", "key", key, "message", message, "canShow", canShowPage));
            }
        });

        assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(100);

        webView.addJavascriptInterface(new Bridge(), "Native");
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (APP_HOST.equals(uri.getHost()) && uri.getPath() != null
                        && uri.getPath().startsWith(ApiProxy.PREFIX)) {
                    return ApiProxy.handle(uri);
                }
                if (APP_HOST.equals(uri.getHost()) && uri.getPath() != null && uri.getPath().startsWith("/pdf/")) {
                    return servePdf(uri.getLastPathSegment());
                }
                return assetLoader.shouldInterceptRequest(uri);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (APP_HOST.equals(uri.getHost())) return false;
                openLink(uri.toString(), null, null);
                return true;
            }
        });

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(APP_URL);
        }
        narrator = Narrator.get(this);
        narrator.setListener((state, index, total) -> emit(event("tts", "state", state, "index", index, "total", total)));
        receivePdf(getIntent(), false);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        receivePdf(intent, true);
    }

    /**
     * A PDF shared or opened into the app ("Share → DermScholar", "Open with"). If the user just
     * tapped "Try MyLoft" on a paper, the PDF is saved to that paper; otherwise it's imported.
     */
    private void receivePdf(Intent intent, boolean appRunning) {
        if (intent == null) return;
        Uri uri = null;
        if (Intent.ACTION_VIEW.equals(intent.getAction())) uri = intent.getData();
        else if (Intent.ACTION_SEND.equals(intent.getAction())) uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (uri == null) return;
        final Uri src = uri;
        android.content.SharedPreferences hp = getSharedPreferences("handoff", MODE_PRIVATE);
        String pendingKey = hp.getString("key", null);
        boolean fresh = System.currentTimeMillis() - hp.getLong("time", 0) < 2 * 60 * 60 * 1000L;
        String key = pendingKey != null && fresh ? pendingKey : "import_" + System.currentTimeMillis();
        String title = pendingKey != null && fresh ? hp.getString("title", "") : displayName(src);
        boolean attached = pendingKey != null && fresh;
        intent.setAction(null); // don't import twice on rotation
        io.execute(() -> {
            try {
                PdfStore.importFrom(this, src, key, title);
                if (attached) hp.edit().clear().apply();
                JSONObject ev = event("pdfReceived", "key", key, "title", title, "attached", attached);
                if (appRunning) emit(ev); else receivedAtStart = ev.toString();
            } catch (Exception e) {
                toast("Couldn't import that PDF");
            }
        });
    }

    private void openLink(String url, String key, String title) {
        openLink(url, key, title, R4LSession.R4L);
    }

    private void openLink(String url, String key, String title, String provider) {
        Uri uri = Uri.parse(url);
        String scheme = uri.getScheme();
        if (!"http".equals(scheme) && !"https".equals(scheme)) {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (ActivityNotFoundException e) {
                toast("No app can open this link");
            }
            return;
        }
        Intent i = new Intent(this, PortalActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        i.putExtra(PortalActivity.EXTRA_URL, url);
        if (key != null) i.putExtra(PortalActivity.EXTRA_KEY, key);
        if (title != null) i.putExtra(PortalActivity.EXTRA_TITLE, title);
        i.putExtra(PortalActivity.EXTRA_PROVIDER, provider);
        startActivityForResult(i, REQUEST_PORTAL);
    }

    /** Gets the paper's PDF through Research4Life in the background. */
    private void fetchViaR4L(String key, String doi, String title) {
        fetcher.enqueue(key, doi, title);
    }

    /** Streams a library PDF to the in-app reader (same origin, so pdf.js can read it). */
    private WebResourceResponse servePdf(String key) {
        try {
            if (key == null || !PdfStore.has(this, key)) throw new IOException("missing");
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-store");
            return new WebResourceResponse("application/pdf", null, 200, "OK", headers,
                    new FileInputStream(PdfStore.file(this, key)));
        } catch (IOException e) {
            return new WebResourceResponse("text/plain", "UTF-8", 404, "Not found", new HashMap<>(),
                    new ByteArrayInputStream(new byte[0]));
        }
    }

    private void openViewer(String key, String title) {
        Intent i = new Intent(this, PdfViewerActivity.class);
        i.putExtra(PdfViewerActivity.EXTRA_KEY, key);
        i.putExtra(PdfViewerActivity.EXTRA_TITLE, title);
        startActivity(i);
    }

    private void emitRaw(String type, JSONObject payload) {
        try {
            payload.put("type", type);
        } catch (Exception ignored) {
        }
        emit(payload);
    }

    private void emit(JSONObject event) {
        String js = "window.App&&App.onNative(" + event + ")";
        main.post(() -> webView.evaluateJavascript(js, null));
    }

    /** MyLoft's app, found by package name or label (its package id isn't something we control). */
    private Intent myLoftLaunchIntent() {
        try {
            android.content.pm.PackageManager pm = getPackageManager();
            Intent q = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
            for (android.content.pm.ResolveInfo r : pm.queryIntentActivities(q, 0)) {
                String pkg = r.activityInfo.packageName;
                CharSequence label = r.loadLabel(pm);
                if (pkg.equals(getPackageName())) continue;
                if (pkg.toLowerCase(java.util.Locale.ROOT).contains("myloft")
                        || (label != null && label.toString().toLowerCase(java.util.Locale.ROOT).contains("myloft"))) {
                    Intent i = pm.getLaunchIntentForPackage(pkg);
                    if (i != null) return i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                }
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    private void toast(String msg) {
        main.post(() -> Toast.makeText(this, msg, Toast.LENGTH_SHORT).show());
    }

    private static JSONObject event(String type, Object... kv) {
        JSONObject o = new JSONObject();
        try {
            o.put("type", type);
            for (int i = 0; i + 1 < kv.length; i += 2) o.put((String) kv[i], kv[i + 1]);
        } catch (Exception ignored) {
        }
        return o;
    }

    /** Methods callable from the web app as window.Native.*. */
    private class Bridge {

        @JavascriptInterface
        public String listPdfs() {
            return PdfStore.list(MainActivity.this).toString();
        }

        @JavascriptInterface
        public boolean hasPdf(String key) {
            return PdfStore.has(MainActivity.this, key);
        }

        @JavascriptInterface
        public long storageBytes() {
            return PdfStore.totalBytes(MainActivity.this);
        }

        @JavascriptInterface
        public void downloadPdf(String key, String url, String title) {
            String ua = WebSettings.getDefaultUserAgent(MainActivity.this);
            io.execute(() -> {
                try {
                    PdfStore.download(MainActivity.this, key, url, title, ua);
                    emit(event("pdfSaved", "key", key));
                } catch (Exception e) {
                    String reason = "NOT_PDF".equals(e.getMessage())
                            ? "The link opened a web page, not a PDF. Try Research4Life access."
                            : "Download failed: " + e.getMessage();
                    emit(event("pdfFailed", "key", key, "message", reason));
                }
            });
        }

        /**
         * One-tap PDF: tries a free copy first, then Research4Life access via the paper's DOI.
         * Opens the reader when done.
         */
        @JavascriptInterface
        public void getPdf(String key, String doi, String title, String freeUrl) {
            boolean hasDoi = doi != null && !doi.isEmpty();
            if (freeUrl == null || freeUrl.isEmpty()) {
                if (hasDoi) main.post(() -> fetchViaR4L(key, doi, title));
                else emit(event("pdfFailed", "key", key, "message", "This paper has no DOI, so it can't be fetched automatically."));
                return;
            }
            String ua = WebSettings.getDefaultUserAgent(MainActivity.this);
            io.execute(() -> {
                try {
                    PdfStore.download(MainActivity.this, key, freeUrl, title, ua);
                    emit(event("pdfSaved", "key", key));
                } catch (Exception e) {
                    if (hasDoi) main.post(() -> fetchViaR4L(key, doi, title));
                    else emit(event("pdfFailed", "key", key, "message", "Couldn't download the free PDF."));
                }
            });
        }

        @JavascriptInterface
        public String account(String provider) {
            try {
                JSONObject o = new JSONObject();
                o.put("user", R4LSession.username(MainActivity.this, provider));
                o.put("saved", R4LSession.hasCredentials(MainActivity.this, provider));
                return o.toString();
            } catch (Exception e) {
                return "{}";
            }
        }

        @JavascriptInterface
        public void setCredentials(String provider, String user, String pass) {
            if (user == null || pass == null || user.trim().isEmpty() || pass.isEmpty()) return;
            R4LSession.saveCredentials(MainActivity.this, provider, user, pass);
        }

        @JavascriptInterface
        public void forgetCredentials(String provider) {
            R4LSession.forget(MainActivity.this, provider);
        }

        /** Searches UpToDate in the background; results arrive as a utdResults event. */
        @JavascriptInterface
        public void utdSearch(String query) {
            main.post(() -> utd.search(query, r -> emitRaw("utdResults", r)));
        }

        /** Loads an UpToDate topic in the background; its content arrives as a utdTopic event. */
        @JavascriptInterface
        public void utdTopic(String url) {
            main.post(() -> utd.topic(url, r -> emitRaw("utdTopic", r)));
        }

        /** Opens MyLoft in the in-app browser; a PDF downloaded there is saved to this paper. */
        @JavascriptInterface
        public void openMyLoft(String key, String title) {
            main.post(() -> openLink(R4LSession.MYLOFT_HOME, key == null || key.isEmpty() ? null : key,
                    title == null || title.isEmpty() ? null : title, R4LSession.MYLOFT));
        }

        @JavascriptInterface
        public boolean hasMyLoftApp() {
            return myLoftLaunchIntent() != null;
        }

        /** Opens the installed MyLoft app; a PDF shared back from it saves to the pending paper. */
        @JavascriptInterface
        public boolean openMyLoftApp() {
            Intent i = myLoftLaunchIntent();
            if (i == null) return false;
            main.post(() -> {
                try {
                    startActivity(i);
                } catch (Exception e) {
                    toast("Couldn't open the MyLoft app");
                }
            });
            return true;
        }

        /** Shows where the background UpToDate page stopped, so the user can see what it needs. */
        @JavascriptInterface
        public void utdShowPage() {
            main.post(() -> openLink(utd.currentUrl(), null, null, R4LSession.UTD));
        }

        /** Shows an UpToDate page in the visible browser (sign-in, graphics). */
        @JavascriptInterface
        public void openUpToDateAt(String url) {
            main.post(() -> openLink(url, null, null, R4LSession.UTD));
        }

        /** Opens UpToDate (signed in automatically when a login is saved), optionally searching. */
        @JavascriptInterface
        public void openUpToDate(String query) {
            String url = query == null || query.trim().isEmpty()
                    ? R4LSession.UTD_HOME
                    : R4LSession.UTD_HOME + "?search=" + Uri.encode(query.trim());
            main.post(() -> openLink(url, null, null, R4LSession.UTD));
        }

        /** Remembers the paper the user is fetching via MyLoft, so a PDF shared back is saved to it. */
        @JavascriptInterface
        public void setPendingPdf(String key, String title) {
            getSharedPreferences("handoff", MODE_PRIVATE).edit()
                    .putString("key", key).putString("title", title).putLong("time", System.currentTimeMillis()).apply();
        }

        /** A PDF that arrived while the app was starting up (JSON event or ""). */
        @JavascriptInterface
        public String consumeReceived() {
            String r = receivedAtStart;
            receivedAtStart = null;
            return r == null ? "" : r;
        }

        @JavascriptInterface
        public String listAccounts(String provider) {
            return R4LSession.listAccounts(MainActivity.this, provider);
        }

        @JavascriptInterface
        public void setActiveAccount(String provider, String user) {
            if (R4LSession.setActive(MainActivity.this, provider, user) && R4LSession.R4L.equals(provider)) {
                main.post(() -> R4LSession.signOut(R4LSession.R4L_ORIGINS));
            }
        }

        @JavascriptInterface
        public void removeAccount(String provider, String user) {
            R4LSession.removeAccount(MainActivity.this, provider, user);
        }

        @JavascriptInterface
        public void myloftSignOut() {
            main.post(() -> R4LSession.signOut(R4LSession.MYLOFT_ORIGINS));
        }

        // ---- AI summaries (Claude, with the user's own API key)

        @JavascriptInterface
        public boolean aiHasKey() {
            return R4LSession.hasCredentials(MainActivity.this, AI);
        }

        @JavascriptInterface
        public void aiSetKey(String key) {
            String k = key == null ? "" : key.trim();
            synchronized (MainActivity.this) { aiClient = null; }
            if (k.isEmpty()) R4LSession.forget(MainActivity.this, AI);
            else R4LSession.saveCredentials(MainActivity.this, AI, "api", k);
        }

        @JavascriptInterface
        public void aiAsk(String id, String title, String text, String question) {
            io.execute(() -> {
                try {
                    AiClient c;
                    synchronized (MainActivity.this) {
                        if (aiClient == null) {
                            String key = R4LSession.password(MainActivity.this, AI);
                            if (key == null || key.isEmpty()) throw new AiClient.AiException("Add your Claude API key in Settings → AI summaries.");
                            aiClient = new AiClient(key);
                        }
                        c = aiClient;
                    }
                    String answer = c.ask(title, text, question);
                    emit(event("ai", "id", id, "state", "done", "text", answer));
                } catch (AiClient.AiException e) {
                    emit(event("ai", "id", id, "state", "error", "message", e.getMessage()));
                } catch (Exception e) {
                    emit(event("ai", "id", id, "state", "error", "message", "Summary failed: " + e.getClass().getSimpleName()));
                }
            });
        }

        // ---- read aloud

        @JavascriptInterface
        public void ttsStart(String title, String itemsJson, int start, float rate, String voice) {
            main.post(() -> {
                if (android.os.Build.VERSION.SDK_INT >= 33
                        && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 21);
                }
                try {
                    narrator.start(title, new org.json.JSONArray(itemsJson), start, rate, 1f, voice);
                } catch (Exception e) {
                    toast("Couldn't start reading");
                }
            });
        }

        @JavascriptInterface public void ttsToggle() { main.post(() -> narrator.toggle()); }
        @JavascriptInterface public void ttsPause() { main.post(() -> narrator.pause()); }
        @JavascriptInterface public void ttsSeek(int i) { main.post(() -> narrator.seek(i)); }
        @JavascriptInterface public void ttsSkip(int d) { main.post(() -> narrator.skip(d)); }
        @JavascriptInterface public void ttsRate(float r) { main.post(() -> narrator.setRate(r)); }
        @JavascriptInterface public void ttsVoice(String v) { main.post(() -> narrator.setVoice(v)); }
        @JavascriptInterface public void ttsStop() { main.post(() -> narrator.stop()); }
        @JavascriptInterface public String ttsVoices() { return narrator.voices(); }
        @JavascriptInterface public void ttsEngine(String e) { main.post(() -> narrator.setEngine(e)); }
        @JavascriptInterface public void ttsPreview(String v) { main.post(() -> narrator.preview(v)); }
        @JavascriptInterface public void ttsWarm(String e) { narrator.warm(e); }

        @JavascriptInterface
        public String ttsStatus() {
            try {
                return new JSONObject().put("playing", narrator.isPlaying()).put("index", narrator.index())
                        .put("total", narrator.total()).put("title", narrator.title()).toString();
            } catch (Exception e) {
                return "{}";
            }
        }

        @JavascriptInterface
        public String r4lAccount() {
            try {
                JSONObject o = new JSONObject();
                o.put("user", R4LSession.username(MainActivity.this));
                o.put("saved", R4LSession.hasCredentials(MainActivity.this));
                return o.toString();
            } catch (Exception e) {
                return "{}";
            }
        }

        @JavascriptInterface
        public void r4lSetCredentials(String user, String pass) {
            if (user == null || pass == null || user.trim().isEmpty() || pass.isEmpty()) return;
            R4LSession.saveCredentials(MainActivity.this, user, pass);
        }

        @JavascriptInterface
        public void r4lForget() {
            R4LSession.forget(MainActivity.this);
        }

        @JavascriptInterface
        public void cancelFetch(String key) {
            main.post(() -> fetcher.cancel(key));
        }

        /** Shows the Research4Life page where a background fetch stopped. */
        @JavascriptInterface
        public void showFetchPage(String key, String doi, String title) {
            main.post(() -> {
                String url = fetcher.lastUrl(key);
                if (url == null && doi != null && !doi.isEmpty()) url = R4LSession.doiUrl(doi);
                openLink(url != null ? url : R4LSession.PORTAL_URL, key, title);
            });
        }

        /** The original page layout, rendered natively. */
        @JavascriptInterface
        public void openPdfPages(String key, String title) {
            main.post(() -> {
                if (PdfStore.has(MainActivity.this, key)) openViewer(key, title);
            });
        }

        @JavascriptInterface
        public void openPdf(String key, String title) {
            main.post(() -> {
                if (!PdfStore.has(MainActivity.this, key)) {
                    toast("PDF not found");
                    return;
                }
                Intent i = new Intent(MainActivity.this, PdfViewerActivity.class);
                i.putExtra(PdfViewerActivity.EXTRA_KEY, key);
                i.putExtra(PdfViewerActivity.EXTRA_TITLE, title);
                startActivity(i);
            });
        }

        @JavascriptInterface
        public void deletePdf(String key) {
            PdfStore.delete(MainActivity.this, key);
        }

        @JavascriptInterface
        public void openPortal(String url, String key, String title) {
            main.post(() -> openLink(url, key.isEmpty() ? null : key, title.isEmpty() ? null : title));
        }

        @JavascriptInterface
        public void importPdf() {
            main.post(() -> {
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("application/pdf");
                try {
                    startActivityForResult(i, REQUEST_IMPORT);
                } catch (ActivityNotFoundException e) {
                    toast("No file picker available");
                }
            });
        }

        @JavascriptInterface
        public void share(String title, String text) {
            main.post(() -> {
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType("text/plain");
                i.putExtra(Intent.EXTRA_SUBJECT, title);
                i.putExtra(Intent.EXTRA_TEXT, text);
                startActivity(Intent.createChooser(i, "Share"));
            });
        }

        @JavascriptInterface
        public void sharePdf(String key, String title) {
            main.post(() -> {
                if (!PdfStore.has(MainActivity.this, key)) return;
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType("application/pdf");
                i.putExtra(Intent.EXTRA_SUBJECT, title);
                i.putExtra(Intent.EXTRA_STREAM, PdfStore.shareUri(MainActivity.this, key));
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                startActivity(Intent.createChooser(i, "Share PDF"));
            });
        }

        @JavascriptInterface
        public void exportText(String fileName, String content, String mime) {
            io.execute(() -> {
                try {
                    File dir = new File(getCacheDir(), "export");
                    dir.mkdirs();
                    File f = new File(dir, fileName.replaceAll("[^A-Za-z0-9_.-]", "_"));
                    try (Writer w = new OutputStreamWriter(new FileOutputStream(f), StandardCharsets.UTF_8)) {
                        w.write(content);
                    }
                    Uri uri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".files", f);
                    main.post(() -> {
                        Intent i = new Intent(Intent.ACTION_SEND);
                        i.setType(mime);
                        i.putExtra(Intent.EXTRA_STREAM, uri);
                        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        startActivity(Intent.createChooser(i, "Export library"));
                    });
                } catch (Exception e) {
                    toast("Export failed");
                }
            });
        }

        @JavascriptInterface
        public void copy(String text) {
            main.post(() -> {
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                cm.setPrimaryClip(ClipData.newPlainText("citation", text));
                Toast.makeText(MainActivity.this, "Copied", Toast.LENGTH_SHORT).show();
            });
        }

        @JavascriptInterface
        public void toast(String msg) {
            MainActivity.this.toast(msg);
        }

        @JavascriptInterface
        public String version() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "";
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_IMPORT && resultCode == RESULT_OK && data != null && data.getData() != null) {
            Uri uri = data.getData();
            String name = displayName(uri);
            String key = "import_" + System.currentTimeMillis();
            io.execute(() -> {
                try {
                    PdfStore.importFrom(this, uri, key, name);
                    emit(event("pdfImported", "key", key, "title", name));
                } catch (Exception e) {
                    toast("Import failed");
                }
            });
        }
    }

    private String displayName(Uri uri) {
        try (Cursor c = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                String n = c.getString(0);
                if (n != null) return n.replaceAll("(?i)\\.pdf$", "");
            }
        } catch (Exception ignored) {
        }
        return "Imported PDF";
    }

    @Override
    protected void onResume() {
        super.onResume();
        fetcher.attach(this, fetchLayer);
        if (webView != null) webView.evaluateJavascript("window.App&&App.onResume()", null);
    }

    @Override
    public void onBackPressed() {
        webView.evaluateJavascript("window.App?App.back():false", value -> {
            if (!"true".equals(value)) finish();
        });
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        io.shutdown();
        super.onDestroy();
    }
}
