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
    private static final int REQUEST_IMPORT_PDF = 12;
    private static final int REQUEST_CAMERA = 13;
    private static final int REQUEST_SPEECH = 14;
    private static final int REQUEST_IMAGE_AI = 15;
    /** Which web request asked for an image (pickImage). */
    private String pendingImageId;
    private Uri cameraUri;

    private WebView webView;
    private FrameLayout fetchLayer;
    private PdfFetcher fetcher;
    private Narrator narrator;
    private LlmProvider llm;
    private String llmModel;
    /** Things shared into the app before the web app was ready to hear about them. */
    private final java.util.List<String> startEvents = java.util.Collections.synchronizedList(new java.util.ArrayList<>());
    private volatile boolean webReady;
    private UtdClient utd;
    private WebViewAssetLoader assetLoader;
    private final ExecutorService io = Executors.newFixedThreadPool(2);
    private final Handler main = new Handler(Looper.getMainLooper());

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        CollegeProxy.apply(this);
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
                // "NOT_IN_R4L:" marks journals Research4Life doesn't cover: the app offers MyLOFT straight away.
                boolean notCovered = message != null && message.startsWith(PdfFetcher.NOT_COVERED);
                emit(event("fetchFailed", "key", key, "message", notCovered ? message.substring(PdfFetcher.NOT_COVERED.length()) : message,
                        "canShow", canShowPage, "notInR4L", notCovered));
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
            public void onReceivedHttpAuthRequest(WebView view, android.webkit.HttpAuthHandler handler, String host, String realm) {
                // The college proxy's password pop-up: answered with the saved login.
                if (!CollegeProxy.answer(view.getContext(), handler, host)) super.onReceivedHttpAuthRequest(view, handler, host, realm);
            }

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
                if (APP_HOST.equals(uri.getHost()) && uri.getPath() != null && uri.getPath().startsWith(DocInbox.PREFIX)) {
                    return DocInbox.serve(MainActivity.this, uri.getLastPathSegment());
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
        receiveIntent(getIntent(), false);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        receiveIntent(intent, true);
    }

    /**
     * Anything shared or opened into the app ("Share → DermScholar", "Open with"): PDFs go to the
     * PDF library (or to the paper the user marked as waiting for its PDF); other documents and
     * images go to the import inbox; shared text or a link is handed to the web app to read.
     */
    private void receiveIntent(Intent intent, boolean appRunning) {
        if (intent == null) return;
        String action = intent.getAction();
        Uri uri = null;
        if (Intent.ACTION_VIEW.equals(action)) uri = intent.getData();
        if (uri != null && "dermscholar".equals(uri.getScheme())) {
            // Back from Google sign-in in the browser (dermscholar://auth#access_token=…).
            intent.setAction(null);
            deliver(event("authRedirect", "url", uri.toString()), appRunning);
            return;
        }
        if (Intent.ACTION_SEND.equals(action)) uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (uri == null && Intent.ACTION_SEND.equals(action)) {
            CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            if (text != null && text.length() > 0) {
                String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
                intent.setAction(null);
                deliver(event("sharedText", "text", text.toString(), "subject", subject == null ? "" : subject), appRunning);
            }
            return;
        }
        if (uri == null) return;
        intent.setAction(null); // don't import twice on rotation
        handleIncoming(uri, intent.getType(), appRunning);
    }

    private void handleIncoming(Uri src, String typeHint, boolean appRunning) {
        io.execute(() -> {
            String name = DocInbox.displayName(this, src);
            String mime = DocInbox.mimeOf(this, src, name, typeHint);
            try {
                if (mime.equals("application/pdf") || name.toLowerCase(java.util.Locale.ROOT).endsWith(".pdf")) {
                    android.content.SharedPreferences hp = getSharedPreferences("handoff", MODE_PRIVATE);
                    String pendingKey = hp.getString("key", null);
                    boolean attached = pendingKey != null && System.currentTimeMillis() - hp.getLong("time", 0) < 2 * 60 * 60 * 1000L;
                    String key = attached ? pendingKey : "import_" + System.currentTimeMillis();
                    String title = attached ? hp.getString("title", "") : name.replaceAll("(?i)\\.pdf$", "");
                    PdfStore.importFrom(this, src, key, title);
                    if (attached) hp.edit().clear().apply();
                    deliver(event("pdfReceived", "key", key, "title", title, "attached", attached), appRunning);
                } else {
                    String key = "doc_" + System.currentTimeMillis();
                    DocInbox.copy(this, src, key);
                    DocInbox.remember(this, key, mime);
                    deliver(event("docReceived", "key", key, "name", name, "mime", mime), appRunning);
                }
            } catch (Exception e) {
                toast("Couldn't import " + name + (e.getMessage() != null ? ": " + e.getMessage() : ""));
            }
        });
    }

    /** Sends an event to the web app now, or keeps it until the web app asks (cold start). */
    private void deliver(JSONObject ev, boolean appRunning) {
        if (appRunning && webReady) emit(ev);
        else startEvents.add(ev.toString());
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
    /** The way picked for the next Get PDF ("r4l": Research4Life only), or null for every way in turn. */
    private String pdfRoute;

    private void fetchViaR4L(String key, String doi, String title, String pii) {
        String route = pdfRoute;
        pdfRoute = null;
        fetcher.enqueue(key, doi, title, pii, route);
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

    private synchronized void recordUsage(String model, LlmProvider.Result r) {
        android.content.SharedPreferences ap = getSharedPreferences("ai", MODE_PRIVATE);
        try {
            JSONObject all = new JSONObject(ap.getString("usage", "{}"));
            String month = new java.text.SimpleDateFormat("yyyy-MM", java.util.Locale.ROOT).format(new java.util.Date());
            JSONObject m = all.optJSONObject(month);
            if (m == null) { m = new JSONObject(); all.put(month, m); }
            org.json.JSONArray row = m.optJSONArray(model);
            if (row == null) row = new org.json.JSONArray("[0,0,0,0]");
            row.put(0, row.optLong(0) + r.inputTokens);
            row.put(1, row.optLong(1) + r.outputTokens);
            row.put(2, row.optLong(2) + r.cachedTokens);
            row.put(3, row.optLong(3) + 1);
            m.put(model, row);
            ap.edit().putString("usage", all.toString()).apply();
        } catch (Exception ignored) {
        }
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
    /** MyLOFT's app, found by package name or label (its package id isn't something we control). */
    private Intent myLoftLaunchIntent() {
        try {
            android.content.pm.PackageManager pm = getPackageManager();
            // The app the user picked ("Choose MyLOFT from your apps") wins.
            String chosen = getSharedPreferences("myloft", MODE_PRIVATE).getString("pkg", null);
            if (chosen != null) {
                Intent c = pm.getLaunchIntentForPackage(chosen);
                if (c != null) return c.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            }
            Intent q = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
            for (android.content.pm.ResolveInfo r : pm.queryIntentActivities(q, 0)) {
                String pkg = r.activityInfo.packageName;
                CharSequence label = r.loadLabel(pm);
                if (pkg.equals(getPackageName())) continue;
                String l = label == null ? "" : label.toString().toLowerCase(java.util.Locale.ROOT).replace(" ", "");
                String pk = pkg.toLowerCase(java.util.Locale.ROOT);
                if (pk.contains("myloft") || pk.contains("eclat") || l.contains("myloft") || l.contains("libraryonfingertips")) {
                    Intent i = pm.getLaunchIntentForPackage(pkg);
                    if (i != null) return i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                }
            }
        } catch (Exception ignored) {
        }
        return null;
    }

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
            getPdf(key, doi, title, freeUrl, "");
        }

        /** Same, with the Elsevier article ID (PII) when known: those go through ClinicalKey first. */
        /** Get PDF one way only, as picked on the paper's page: "college" (the college proxy) or "r4l". */
        @JavascriptInterface
        public void getPdf(String key, String doi, String title, String freeUrl, String pii, String route) {
            if ("college".equals(route)) {
                if (doi == null || doi.isEmpty()) { emit(event("pdfFailed", "key", key, "message", "This paper has no DOI, so it can't be fetched through the proxy.")); return; }
                if (!CollegeProxy.usable(MainActivity.this)) { emit(event("pdfFailed", "key", key, "message", "Set up your college proxy first: Settings → Accounts → College proxy.")); return; }
                main.post(() -> fetcher.enqueue(key, doi, title, pii, "college"));
                return;
            }
            pdfRoute = route;
            getPdf(key, doi, title, freeUrl, pii);
        }

        @JavascriptInterface
        public void getPdf(String key, String doi, String title, String freeUrl, String pii) {
            boolean hasDoi = doi != null && !doi.isEmpty();
            if (freeUrl == null || freeUrl.isEmpty()) {
                if (hasDoi) main.post(() -> fetchViaR4L(key, doi, title, pii));
                else emit(event("pdfFailed", "key", key, "message", "This paper has no DOI, so it can't be fetched automatically."));
                return;
            }
            String ua = WebSettings.getDefaultUserAgent(MainActivity.this);
            io.execute(() -> {
                try {
                    PdfStore.download(MainActivity.this, key, freeUrl, title, ua);
                    emit(event("pdfSaved", "key", key));
                } catch (Exception e) {
                    if (hasDoi) main.post(() -> fetchViaR4L(key, doi, title, pii));
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

        /** Logins and AI keys for the encrypted account sync (sync.js encrypts them before upload). */
        private final String[] SECRET_PROVIDERS = {R4LSession.R4L, R4LSession.UTD, R4LSession.SPR, CollegeProxy.PX, "groq", "gemini", "claude", "openrouter"};

        @JavascriptInterface
        public String exportSecrets() {
            try {
                JSONObject creds = new JSONObject();
                for (String p : SECRET_PROVIDERS) {
                    JSONObject o = R4LSession.exportProvider(MainActivity.this, p);
                    if (o.getJSONArray("accounts").length() > 0) creds.put(p, o);
                }
                JSONObject out = new JSONObject().put("creds", creds);
                if (CollegeProxy.configured(MainActivity.this)) out.put("px", new JSONObject().put("host", CollegeProxy.host(MainActivity.this)).put("port", CollegeProxy.port(MainActivity.this)));
                out.put("ai", new JSONObject().put("provider", provider()).put("auto", aiAuto()));
                return out.toString();
            } catch (Exception e) {
                return "{}";
            }
        }

        @JavascriptInterface
        public void importSecrets(String json) {
            try {
                JSONObject o = new JSONObject(json);
                JSONObject creds = o.optJSONObject("creds");
                boolean hadAi = aiHasKey();
                if (creds != null) for (String p : SECRET_PROVIDERS) R4LSession.importProvider(MainActivity.this, p, creds.optJSONObject(p));
                JSONObject px = o.optJSONObject("px");
                if (px != null && !CollegeProxy.configured(MainActivity.this) && !px.optString("host").isEmpty()) {
                    main.post(() -> CollegeProxy.save(MainActivity.this, px.optString("host"), px.optInt("port")));
                }
                JSONObject ai = o.optJSONObject("ai");
                if (ai != null && !hadAi) {
                    if (!ai.optString("provider").isEmpty()) aiSetProvider(ai.optString("provider"));
                    aiSetAuto(ai.optBoolean("auto", true));
                }
                synchronized (MainActivity.this) { llm = null; }
            } catch (Exception ignored) {
            }
        }

        /** Get PDF sources switched off in Settings: ["r4l","spr","px","myloft"]. */
        @JavascriptInterface
        public void setSourcesOff(String json) {
            getSharedPreferences("sources", MODE_PRIVATE).edit().putString("off", json == null ? "[]" : json).apply();
        }

        /** The college proxy (host and port; its login is the "px" credentials). */
        @JavascriptInterface
        public String collegeProxy() {
            try {
                return new JSONObject().put("host", CollegeProxy.host(MainActivity.this)).put("port", CollegeProxy.port(MainActivity.this))
                        .put("supported", CollegeProxy.supported()).toString();
            } catch (Exception e) {
                return "{}";
            }
        }

        @JavascriptInterface
        public void setCollegeProxy(String host, int port) {
            main.post(() -> CollegeProxy.save(MainActivity.this, host, port));
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

        /** Remembers the paper the user is fetching, so a PDF shared back to the app is saved to it. */
        /**
         * Lets the user pick a photo (gallery or camera roll) for image questions; answers with an
         * "imagePicked" event {id, dataUrl} (a JPEG at most 1280 px) or {id, error}.
         */
        @JavascriptInterface
        public void pickImage(String id) {
            main.post(() -> {
                pendingImageId = id;
                // The system photo picker (Android 13+), else the gallery: some phones' file picker
                // shows photos greyed out for "open document".
                Intent i = android.os.Build.VERSION.SDK_INT >= 33
                        ? new Intent("android.provider.action.PICK_IMAGES").setType("image/*")
                        : new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*");
                try {
                    startActivityForResult(i, REQUEST_IMAGE_AI);
                } catch (ActivityNotFoundException e) {
                    try {
                        startActivityForResult(new Intent(Intent.ACTION_GET_CONTENT).setType("image/*"), REQUEST_IMAGE_AI);
                    } catch (ActivityNotFoundException e2) {
                        emit(event("imagePicked", "id", id, "error", "No photo picker on this phone"));
                    }
                }
            });
        }

        /** An AI question about an image (data URL); answers with an "ai" event like aiRun. */
        @JavascriptInterface
        public void aiRunImage(String id, String system, String task, String dataUrl, int maxTokens) {
            io.execute(() -> {
                LlmProvider.AiException first = null;
                StringBuilder also = new StringBuilder();
                try {
                    String b64 = dataUrl == null ? "" : dataUrl.substring(dataUrl.indexOf(',') + 1);
                    for (String prov : aiOrder(0, true)) {
                        try {
                            String key = R4LSession.password(MainActivity.this, prov);
                            if (key == null || key.isEmpty()) throw new LlmProvider.AiException("Add your " + label(prov) + " API key in Settings → AI.");
                            LlmProvider.Result r;
                            if ("gemini".equals(prov)) r = new GeminiProvider(key, modelFor("gemini")).completeWithImage(system, task, b64, maxTokens);
                            else if ("groq".equals(prov)) r = new GroqProvider(key, null).completeWithImage(system, task, b64, maxTokens);
                            else if ("openrouter".equals(prov)) r = GroqProvider.openRouter(key, null).completeWithImage(system, task, b64, maxTokens);
                            else continue;
                            recordUsage(r.model, r);
                            emit(event("ai", "id", id, "state", "done", "text", r.text, "model", r.model));
                            return;
                        } catch (LlmProvider.AiException e) {
                            if (first == null) first = e; else also.append(" · ").append(label(prov)).append(": ").append(e.getMessage());
                        }
                    }
                    throw first != null ? withOthers(first, also) : new LlmProvider.AiException("Image questions work with Gemini, Groq or OpenRouter. Add a key in Settings → AI.");
                } catch (LlmProvider.AiException e) {
                    emit(event("ai", "id", id, "state", "error", "message", e.getMessage()));
                } catch (Exception e) {
                    emit(event("ai", "id", id, "state", "error", "message", "Image request failed: " + e.getClass().getSimpleName()));
                }
            });
        }

        /** Whether the MyLOFT app is installed (institutional access goes through it). */
        @JavascriptInterface
        public boolean hasMyLoftApp() {
            return myLoftLaunchIntent() != null;
        }

        /**
         * Opens the MyLOFT app (or its Play Store page). MyLOFT's website only works in its own app,
         * so the PDF comes back by Share / Open with → DermScholar, saved to the pending paper.
         */
        @JavascriptInterface
        public void openMyLoftApp() {
            main.post(() -> {
                Intent i = myLoftLaunchIntent();
                try {
                    if (i != null) {
                        getSharedPreferences("myloft", MODE_PRIVATE).edit().putLong("lastOpen", System.currentTimeMillis()).apply();
                        startActivity(i);
                    } else {
                        try {
                            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("market://search?q=MyLOFT")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                        } catch (Exception e) {
                            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/search?q=MyLOFT&c=apps")));
                        }
                    }
                } catch (Exception e) {
                    toast("Couldn't open MyLOFT");
                }
            });
        }

        /** Opens a page in the phone's browser (Google sign-in can't run inside an app's WebView). */
        @JavascriptInterface
        public void openBrowser(String url) {
            main.post(() -> {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                } catch (Exception e) {
                    toast("No browser found");
                }
            });
        }

        // ---- in-app updates (see Updater)

        /** Checks for a newer build; answers with an "update" event {state: available|none|error, name, current}. */
        @JavascriptInterface
        public void updateCheck() {
            io.execute(() -> {
                try {
                    org.json.JSONObject r = Updater.latest();
                    long code = r.optLong("versionCode");
                    emit(event("update", "state", code > Updater.currentCode(MainActivity.this) ? "available" : "none",
                            "name", r.optString("versionName"), "code", code, "current", version()));
                } catch (Exception e) {
                    emit(event("update", "state", "error", "message", "Couldn't check for updates. Try again later."));
                }
            });
        }

        /** Downloads the newest build and opens the installer; progress as "update" events {state: downloading, pct}. */
        @JavascriptInterface
        public void updateInstall() {
            io.execute(() -> {
                try {
                    java.io.File apk = Updater.download(MainActivity.this, pct -> emit(event("update", "state", "downloading", "pct", pct)));
                    main.post(() -> {
                        String r = Updater.install(MainActivity.this, apk);
                        emit(event("update", "state", "permission".equals(r) ? "permission" : "installing"));
                    });
                } catch (Exception e) {
                    emit(event("update", "state", "error", "message", "The update didn't download: " + (e.getMessage() == null ? "network error" : e.getMessage())));
                }
            });
        }

        /** Installed apps (label + package), for choosing the MyLOFT app by hand. */
        @JavascriptInterface
        public String listApps() {
            org.json.JSONArray out = new org.json.JSONArray();
            try {
                android.content.pm.PackageManager pm = getPackageManager();
                Intent q = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
                java.util.List<android.content.pm.ResolveInfo> all = pm.queryIntentActivities(q, 0);
                java.util.Set<String> seen = new java.util.HashSet<>();
                for (android.content.pm.ResolveInfo r : all) {
                    String pkg = r.activityInfo.packageName;
                    if (pkg.equals(getPackageName()) || !seen.add(pkg)) continue;
                    out.put(new org.json.JSONObject().put("pkg", pkg).put("label", String.valueOf(r.loadLabel(pm))));
                }
            } catch (Exception ignored) {
            }
            return out.toString();
        }

        /** Shares the paper's link into the MyLOFT app (it saves it with the institution's access). */
        @JavascriptInterface
        public void sendToMyLoft(String text, String title) {
            main.post(() -> {
                Intent app = myLoftLaunchIntent();
                Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain")
                        .putExtra(Intent.EXTRA_TEXT, text).putExtra(Intent.EXTRA_SUBJECT, title == null ? "" : title)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    if (app != null && app.getComponent() != null) {
                        send.setPackage(app.getComponent().getPackageName());
                        // MyLOFT asks to log in again when an article arrives while it is closed; opened
                        // normally first, it restores its sign-in. So after a while away: open it, then send.
                        android.content.SharedPreferences mp = getSharedPreferences("myloft", MODE_PRIVATE);
                        long now = System.currentTimeMillis();
                        boolean cold = now - mp.getLong("lastOpen", 0) > 20 * 60 * 1000L;
                        mp.edit().putLong("lastOpen", now).apply();
                        if (cold) {
                            startActivity(app);
                            main.postDelayed(() -> {
                                try { startActivity(send); } catch (Exception ignored) { }
                            }, 3500);
                        } else {
                            startActivity(send);
                        }
                    } else {
                        startActivity(Intent.createChooser(send, "Send to MyLOFT").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                    }
                } catch (Exception e) {
                    // MyLOFT doesn't take shares this way: open it instead (the title and DOI are copied).
                    Intent i = myLoftLaunchIntent();
                    if (i != null) startActivity(i); else toast("Couldn't open MyLOFT");
                }
            });
        }

        @JavascriptInterface
        public void setMyLoftApp(String pkg) {
            getSharedPreferences("myloft", MODE_PRIVATE).edit().putString("pkg", pkg == null || pkg.isEmpty() ? null : pkg).apply();
        }

        @JavascriptInterface
        public void setPendingPdf(String key, String title) {
            getSharedPreferences("handoff", MODE_PRIVATE).edit()
                    .putString("key", key).putString("title", title).putLong("time", System.currentTimeMillis()).apply();
        }

        /** Things shared into the app while it was starting (JSON array of events). */
        @JavascriptInterface
        public String consumeReceived() {
            webReady = true;
            org.json.JSONArray out = new org.json.JSONArray();
            synchronized (startEvents) {
                for (String e : startEvents) {
                    try { out.put(new JSONObject(e)); } catch (Exception ignored) { }
                }
                startEvents.clear();
            }
            return out.toString();
        }

        // ---- documents: import, web pages, OCR

        @JavascriptInterface
        public void pickDocument(boolean imagesOnly) {
            main.post(() -> {
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                if (imagesOnly) {
                    i.setType("image/*");
                } else {
                    i.setType("*/*");
                    i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                            "application/pdf", "application/epub+zip",
                            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                            "text/plain", "text/markdown", "text/x-markdown", "text/html", "image/*",
                            "application/octet-stream"});
                }
                try {
                    startActivityForResult(i, REQUEST_IMPORT);
                } catch (ActivityNotFoundException e) {
                    toast("No file picker available");
                }
            });
        }

        @JavascriptInterface
        public void takePhoto() {
            main.post(() -> {
                try {
                    File dir = new File(getCacheDir(), "camera");
                    dir.mkdirs();
                    File f = new File(dir, "page.jpg");
                    cameraUri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".files", f);
                    Intent i = new Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE);
                    i.putExtra(android.provider.MediaStore.EXTRA_OUTPUT, cameraUri);
                    i.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivityForResult(i, REQUEST_CAMERA);
                } catch (Exception e) {
                    toast("No camera app available");
                }
            });
        }

        /** Downloads a web page (or a PDF link) for the reader; answers with a "pageFetched" event. */
        @JavascriptInterface
        public void fetchPage(String id, String url) {
            io.execute(() -> {
                String key = "web_" + System.currentTimeMillis();
                try {
                    String type = DocInbox.fetch(MainActivity.this, url, key);
                    if (type.toLowerCase(java.util.Locale.ROOT).contains("pdf")) {
                        File f = DocInbox.file(MainActivity.this, key);
                        PdfStore.importFrom(MainActivity.this, Uri.fromFile(f), key, url.replaceAll(".*/", "").replaceAll("(?i)\\.pdf.*$", ""));
                        DocInbox.delete(MainActivity.this, key);
                        emit(event("pageFetched", "id", id, "key", key, "pdf", true));
                    } else {
                        emit(event("pageFetched", "id", id, "key", key, "url", DocInbox.finalUrl(MainActivity.this, key), "type", type));
                    }
                } catch (Exception e) {
                    emit(event("pageFetched", "id", id, "error", e.getMessage() == null ? "Couldn't open that page" : e.getMessage()));
                }
            });
        }

        /** Text recognition on an imported image; answers with an "ocr" event. */
        @JavascriptInterface
        public void ocrImport(String id, String key) {
            io.execute(() -> {
                try {
                    JSONObject r = Ocr.recognize(MainActivity.this, DocInbox.file(MainActivity.this, key));
                    emit(event("ocr", "id", id, "result", r));
                } catch (Throwable e) {
                    emit(event("ocr", "id", id, "error", "Text recognition failed: " + e.getMessage()));
                }
            });
        }

        /** Text recognition on a page image rendered by the web app (data: URL). */
        @JavascriptInterface
        public void ocrPage(String id, String dataUrl) {
            io.execute(() -> {
                try {
                    String b64 = dataUrl.substring(dataUrl.indexOf(',') + 1);
                    byte[] bytes = android.util.Base64.decode(b64, android.util.Base64.DEFAULT);
                    emit(event("ocr", "id", id, "result", Ocr.recognize(bytes)));
                } catch (Throwable e) {
                    emit(event("ocr", "id", id, "error", "Text recognition failed: " + e.getMessage()));
                }
            });
        }

        @JavascriptInterface
        public void deleteImport(String key) {
            DocInbox.delete(MainActivity.this, key);
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

        // ---- AI (Groq or Claude, with the user's own API key)

        private String provider() {
            return getSharedPreferences("ai", MODE_PRIVATE).getString("provider", "groq");
        }

        private String defaultModel(String provider) {
            return "claude".equals(provider) ? ClaudeProvider.DEFAULT_MODEL
                    : "gemini".equals(provider) ? GeminiProvider.DEFAULT_MODEL
                    : "openrouter".equals(provider) ? GroqProvider.OPENROUTER_MODEL : GroqProvider.DEFAULT_MODEL;
        }

        private String known(String p) {
            return "claude".equals(p) || "gemini".equals(p) || "openrouter".equals(p) ? p : "groq";
        }

        /**
         * The first AI's error, plus why the fallback AIs failed too (so a Gemini problem behind a
         * Groq limit is visible). "TOO_LARGE:" errors stay as they are: the web app reads them.
         */
        private LlmProvider.AiException withOthers(LlmProvider.AiException first, StringBuilder also) {
            if (also.length() == 0 || first.getMessage() == null || first.getMessage().startsWith("TOO_LARGE:")) return first;
            return new LlmProvider.AiException(first.getMessage() + also);
        }

        private String label(String p) {
            return "claude".equals(p) ? "Claude" : "gemini".equals(p) ? "Gemini" : "openrouter".equals(p) ? "OpenRouter" : "Groq";
        }

        @JavascriptInterface
        public String aiProvider() {
            return provider();
        }

        @JavascriptInterface
        public void aiSetProvider(String p) {
            getSharedPreferences("ai", MODE_PRIVATE).edit().putString("provider", known(p)).apply();
            synchronized (MainActivity.this) { llm = null; }
        }

        @JavascriptInterface
        public boolean aiHasKey() {
            if (R4LSession.hasCredentials(MainActivity.this, provider())) return true;
            return aiAuto() && (R4LSession.hasCredentials(MainActivity.this, "groq") || R4LSession.hasCredentials(MainActivity.this, "gemini")
                    || R4LSession.hasCredentials(MainActivity.this, "openrouter"));
        }

        /** The last 4 characters of the saved key (as AI Studio and the consoles show them), or "". */
        @JavascriptInterface
        public String aiKeyTail(String p) {
            String k = R4LSession.password(MainActivity.this, known(p));
            return k == null || k.length() < 8 ? "" : k.substring(k.length() - 4);
        }

        @JavascriptInterface
        public boolean aiHasKeyFor(String p) {
            return R4LSession.hasCredentials(MainActivity.this, known(p));
        }

        /** Saves a key for the provider it belongs to (gsk_… Groq, sk-ant-… Claude) and makes that provider active. */
        @JavascriptInterface
        public void aiSetKey(String key) { aiSetKey(key, provider()); }

        @JavascriptInterface
        public void aiSetKey(String key, String selected) {
            String k = key == null ? "" : key.replaceAll("[\\s\\u200B-\\u200D\\u2060\\uFEFF\"']", "");
            synchronized (MainActivity.this) { llm = null; }
            if (k.isEmpty()) { R4LSession.forget(MainActivity.this, provider()); return; }
            String p = k.startsWith("sk-ant-") ? "claude" : k.startsWith("sk-or-") ? "openrouter" : k.startsWith("gsk_") ? "groq" : k.startsWith("AIza") ? "gemini"
                    : known(selected == null || selected.isEmpty() ? provider() : selected);
            R4LSession.saveCredentials(MainActivity.this, p, "api", k);
            // OpenRouter is the back-up after the free Groq and Gemini: they stay selected (choosing
            // its tab to add the key selected it).
            boolean groq = R4LSession.hasCredentials(MainActivity.this, "groq");
            boolean backup = "openrouter".equals(p) && aiAuto() && (groq || R4LSession.hasCredentials(MainActivity.this, "gemini"));
            aiSetProvider(backup ? (groq ? "groq" : "gemini") : p);
        }

        @JavascriptInterface
        public String aiModel() {
            String p = provider();
            return getSharedPreferences("ai", MODE_PRIVATE).getString("model." + p, defaultModel(p));
        }

        @JavascriptInterface
        public void aiSetModel(String model) {
            getSharedPreferences("ai", MODE_PRIVATE).edit().putString("model." + provider(), model).apply();
            synchronized (MainActivity.this) { llm = null; }
        }

        /** Models the Groq key can use; answers with an "aiModels" event. */
        @JavascriptInterface
        public void aiListModels() {
            io.execute(() -> {
                try {
                    String key = R4LSession.password(MainActivity.this, "groq");
                    if (key == null || key.isEmpty()) throw new LlmProvider.AiException("No Groq key");
                    emit(event("aiModels", "models", new org.json.JSONArray(new GroqProvider(key, null).listModels())));
                } catch (Exception e) {
                    emit(event("aiModels", "error", e.getMessage()));
                }
            });
        }

        /** Tokens used per month and model, for the usage panel: {"2026-09": {"model": [in, out, cached, calls]}}. */
        @JavascriptInterface
        public String aiUsage() {
            return getSharedPreferences("ai", MODE_PRIVATE).getString("usage", "{}");
        }

        /**
         * Runs one AI task (prompts are written by the web app). Answers with an "ai" event
         * {id, state: done|error, text|message}.
         */
        /**
         * Like aiRun for plain text answers, but the text is shown while it is being written:
         * "aiPartial" events {id, text} as it arrives, then the usual "ai" event.
         */
        @JavascriptInterface
        public void aiRunStream(String id, String system, String document, String task, int maxTokens) {
            streamWith(id, system, document, task, maxTokens, false);
        }

        /** The same, quickest AI first (Groq when its key is saved): for answers someone is waiting on. */
        @JavascriptInterface
        public void aiRunStreamFast(String id, String system, String document, String task, int maxTokens) {
            streamWith(id, system, document, task, maxTokens, true);
        }

        private void streamWith(String id, String system, String document, String task, int maxTokens, boolean fast) {
            io.execute(() -> {
                LlmProvider.AiException first = null;
                StringBuilder also = new StringBuilder();
                try {
                    java.util.List<String> order = aiOrder(document == null ? 0 : document.length(), false);
                    if (fast && R4LSession.hasCredentials(MainActivity.this, "groq")) { order.remove("groq"); order.add(0, "groq"); }
                    for (String prov : order) {
                        try {
                            LlmProvider.Result r = llmFor(prov).completeStream(system, document, task, maxTokens,
                                    soFar -> emit(event("aiPartial", "id", id, "text", soFar)));
                            recordUsage(r.model, r);
                            emit(event("ai", "id", id, "state", "done", "text", r.text, "model", r.model,
                                    "fallback", first == null ? "" : label(prov)));
                            return;
                        } catch (LlmProvider.AiException e) {
                            if ("Cancelled".equals(e.getMessage())) throw e;
                            if (first == null) first = e; else also.append(" · ").append(label(prov)).append(": ").append(e.getMessage());
                        }
                    }
                    throw first != null ? withOthers(first, also) : new LlmProvider.AiException("Add your " + label(provider()) + " API key in Settings → AI.");
                } catch (LlmProvider.AiException e) {
                    emit(event("ai", "id", id, "state", "error", "message", e.getMessage()));
                } catch (Exception e) {
                    emit(event("ai", "id", id, "state", "error", "message", "AI request failed: " + e.getClass().getSimpleName()));
                }
            });
        }

        /** Whether DermScholar may use Groq and Gemini together (on by default). */
        @JavascriptInterface
        public boolean aiAuto() {
            return getSharedPreferences("ai", MODE_PRIVATE).getBoolean("auto", true);
        }

        @JavascriptInterface
        public void aiSetAuto(boolean on) {
            getSharedPreferences("ai", MODE_PRIVATE).edit().putBoolean("auto", on).apply();
        }

        /**
         * Which AIs to try, in order. The chosen one goes first; with auto on, the other free AI
         * (Groq or Gemini) with a key is the fallback, long documents go to Gemini first (its free
         * tier takes far bigger inputs), and OpenRouter (free model, then credit) comes after both.
         */
        private java.util.List<String> aiOrder(int docChars, boolean imageOnly) {
            java.util.List<String> order = new java.util.ArrayList<>();
            String chosen = provider();
            if (!imageOnly || !"claude".equals(chosen)) order.add(chosen);
            if (aiAuto()) {
                for (String p : new String[]{"groq", "gemini", "openrouter"}) {
                    if (!order.contains(p) && R4LSession.hasCredentials(MainActivity.this, p)) order.add(p);
                }
                if (docChars > 60000 && order.remove("gemini") && R4LSession.hasCredentials(MainActivity.this, "gemini")) order.add(0, "gemini");
            }
            return order;
        }

        private String modelFor(String p) {
            return getSharedPreferences("ai", MODE_PRIVATE).getString("model." + p, defaultModel(p));
        }

        private final java.util.Map<String, LlmProvider> llms = new java.util.HashMap<>();

        private LlmProvider llmFor(String prov) throws LlmProvider.AiException {
            String key = R4LSession.password(MainActivity.this, prov);
            if (key == null || key.isEmpty()) throw new LlmProvider.AiException("Add your " + label(prov) + " API key in Settings → AI.");
            String model = modelFor(prov);
            String tag = prov + "|" + model + "|" + key.hashCode();
            synchronized (MainActivity.this) {
                if (llm == null) llms.clear();  // a key, model or provider change resets the cache
                LlmProvider p = llms.get(tag);
                if (p == null) {
                    p = "claude".equals(prov) ? new ClaudeProvider(key, model)
                            : "gemini".equals(prov) ? new GeminiProvider(key, model)
                            : "openrouter".equals(prov) ? GroqProvider.openRouter(key, model) : new GroqProvider(key, model);
                    llms.put(tag, p);
                    llm = p;
                    llmModel = tag;
                }
                return p;
            }
        }

        /**
         * Runs one AI task (prompts are written by the web app). Answers with an "ai" event
         * {id, state: done|error, text|message}. When the first AI fails (free limit, busy,
         * too long…) the next one in {@link #aiOrder} answers instead.
         */
        @JavascriptInterface
        public void aiRun(String id, String system, String document, String task, int maxTokens, String jsonSchema) {
            io.execute(() -> {
                LlmProvider.AiException first = null;
                StringBuilder also = new StringBuilder();
                try {
                    for (String prov : aiOrder(document == null ? 0 : document.length(), false)) {
                        try {
                            LlmProvider.Result r = llmFor(prov).complete(system, document, task, maxTokens,
                                    jsonSchema == null || jsonSchema.isEmpty() ? null : jsonSchema);
                            recordUsage(r.model, r);
                            emit(event("ai", "id", id, "state", "done", "text", r.text, "model", r.model,
                                    "fallback", first == null ? "" : label(prov)));
                            return;
                        } catch (LlmProvider.AiException e) {
                            if ("Cancelled".equals(e.getMessage())) throw e;
                            if (first == null) first = e; else also.append(" · ").append(label(prov)).append(": ").append(e.getMessage());
                        }
                    }
                    throw first != null ? withOthers(first, also) : new LlmProvider.AiException("Add your " + label(provider()) + " API key in Settings → AI.");
                } catch (LlmProvider.AiException e) {
                    emit(event("ai", "id", id, "state", "error", "message", e.getMessage()));
                } catch (Exception e) {
                    emit(event("ai", "id", id, "state", "error", "message", "AI request failed: " + e.getClass().getSimpleName()));
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

        /** Asks a question by voice (Android's speech recognizer); answers with a "speech" event. */
        @JavascriptInterface
        public void listen() {
            main.post(() -> {
                Intent i = new Intent(android.speech.RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                i.putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE_MODEL, android.speech.RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                i.putExtra(android.speech.RecognizerIntent.EXTRA_PROMPT, "Ask about what you just heard");
                try {
                    startActivityForResult(i, REQUEST_SPEECH);
                } catch (ActivityNotFoundException e) {
                    emit(event("speech", "error", "Voice input isn't available on this phone"));
                }
            });
        }

        // ---- natural (neural) voices
        private final java.util.Set<String> downloading = java.util.Collections.synchronizedSet(new java.util.HashSet<>());

        @JavascriptInterface
        public void voiceDownload(String id) {
            if (!downloading.add(id)) return;
            new Thread(() -> {
                try {
                    final long[] last = {0};
                    VoiceStore.download(MainActivity.this, id, (pct, stage) -> {
                        long now = System.currentTimeMillis();
                        if (now - last[0] < 400 && pct < 100) return;
                        last[0] = now;
                        emit(event("voiceProgress", "id", id, "pct", pct, "stage", stage));
                    });
                    emit(event("voiceReady", "id", id));
                } catch (Throwable e) {
                    emit(event("voiceError", "id", id, "message", e.getMessage() == null ? "Download failed" : e.getMessage()));
                } finally {
                    downloading.remove(id);
                }
            }, "voice-download").start();
        }

        @JavascriptInterface
        public void voiceDelete(String id) {
            io.execute(() -> VoiceStore.delete(MainActivity.this, id));
        }

        @JavascriptInterface
        public String voiceCatalog() {
            return VoiceStore.catalog(MainActivity.this).toString();
        }

        @JavascriptInterface
        public long voiceCacheBytes() {
            return NeuralEngine.cacheBytes(MainActivity.this);
        }

        @JavascriptInterface
        public void voiceClearCache() {
            io.execute(() -> NeuralEngine.clearCache(MainActivity.this));
        }
        @JavascriptInterface public void ttsSleep(int minutes) { main.post(() -> narrator.sleepIn(minutes)); }
        @JavascriptInterface public void ttsStopAfter(int index) { main.post(() -> narrator.stopAfter(index)); }
        @JavascriptInterface public void ttsSubtitle(String s) { main.post(() -> narrator.setSubtitle(s)); }
        @JavascriptInterface public long ttsSleepLeft() { return narrator.sleepRemainingMs(); }

        @JavascriptInterface
        public String ttsStatus() {
            try {
                return new JSONObject().put("playing", narrator.isPlaying()).put("index", narrator.index())
                        .put("total", narrator.total()).put("title", narrator.title())
                        .put("sleepMs", narrator.sleepRemainingMs()).put("stopAfter", narrator.stopAfterIndex()).toString();
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

        /** The pages Get PDF went through for a paper (Details button in the tray). */
        @JavascriptInterface
        public String fetchTrail(String key) {
            return fetcher.trail(key);
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
        public boolean renamePdf(String from, String to, String title) {
            return PdfStore.rename(MainActivity.this, from, to, title);
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
                    startActivityForResult(i, REQUEST_IMPORT_PDF);
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

        /** Shares a generated file (Word, PowerPoint) given as base64: save to Files/Drive, WhatsApp, email… */
        @JavascriptInterface
        public void exportFile(String fileName, String base64, String mime) {
            io.execute(() -> {
                try {
                    File dir = new File(getCacheDir(), "export");
                    dir.mkdirs();
                    File f = new File(dir, fileName.replaceAll("[^A-Za-z0-9_. -]", "_"));
                    try (FileOutputStream out = new FileOutputStream(f)) {
                        out.write(android.util.Base64.decode(base64, android.util.Base64.DEFAULT));
                    }
                    Uri uri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".files", f);
                    main.post(() -> {
                        Intent i = new Intent(Intent.ACTION_SEND);
                        i.setType(mime);
                        i.putExtra(Intent.EXTRA_STREAM, uri);
                        i.putExtra(Intent.EXTRA_SUBJECT, f.getName());
                        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        startActivity(Intent.createChooser(i, "Save or share " + f.getName()));
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
        if ((requestCode == REQUEST_IMPORT || requestCode == REQUEST_IMPORT_PDF)
                && resultCode == RESULT_OK && data != null && data.getData() != null) {
            handleIncoming(data.getData(), data.getType(), true);
        } else if (requestCode == REQUEST_SPEECH) {
            java.util.ArrayList<String> heard = resultCode == RESULT_OK && data != null
                    ? data.getStringArrayListExtra(android.speech.RecognizerIntent.EXTRA_RESULTS) : null;
            if (heard != null && !heard.isEmpty()) emit(event("speech", "text", heard.get(0)));
            else emit(event("speech", "error", ""));
        } else if (requestCode == REQUEST_CAMERA && resultCode == RESULT_OK && cameraUri != null) {
            handleIncoming(cameraUri, "image/jpeg", true);
        } else if (requestCode == REQUEST_IMAGE_AI) {
            String id = pendingImageId;
            pendingImageId = null;
            if (id == null) return;
            if (resultCode != RESULT_OK || data == null || data.getData() == null) {
                emit(event("imagePicked", "id", id, "error", "cancelled"));
                return;
            }
            Uri uri = data.getData();
            io.execute(() -> {
                try {
                    emit(event("imagePicked", "id", id, "dataUrl", imageDataUrl(uri)));
                } catch (Exception e) {
                    emit(event("imagePicked", "id", id, "error", "Couldn't read that image"));
                }
            });
        }
    }

    /** A picked image as a JPEG data URL, scaled so its longer side is at most 1280 px. */
    private String imageDataUrl(Uri uri) throws java.io.IOException {
        android.graphics.BitmapFactory.Options bounds = new android.graphics.BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        try (java.io.InputStream in = getContentResolver().openInputStream(uri)) {
            android.graphics.BitmapFactory.decodeStream(in, null, bounds);
        }
        int sample = 1;
        while (Math.max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 1280) sample *= 2;
        android.graphics.BitmapFactory.Options opts = new android.graphics.BitmapFactory.Options();
        opts.inSampleSize = sample;
        android.graphics.Bitmap bmp;
        try (java.io.InputStream in = getContentResolver().openInputStream(uri)) {
            bmp = android.graphics.BitmapFactory.decodeStream(in, null, opts);
        }
        if (bmp == null) throw new java.io.IOException("not an image");
        float scale = 1280f / Math.max(bmp.getWidth(), bmp.getHeight());
        if (scale < 1f) {
            android.graphics.Bitmap s = android.graphics.Bitmap.createScaledBitmap(bmp, Math.round(bmp.getWidth() * scale), Math.round(bmp.getHeight() * scale), true);
            if (s != bmp) bmp.recycle();
            bmp = s;
        }
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        bmp.compress(android.graphics.Bitmap.CompressFormat.JPEG, 85, out);
        bmp.recycle();
        return "data:image/jpeg;base64," + android.util.Base64.encodeToString(out.toByteArray(), android.util.Base64.NO_WRAP);
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
