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
import android.widget.Toast;

import androidx.core.content.FileProvider;
import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

import java.io.File;
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
    private WebViewAssetLoader assetLoader;
    private final ExecutorService io = Executors.newFixedThreadPool(2);
    private final Handler main = new Handler(Looper.getMainLooper());

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        setContentView(webView);

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
    }

    private void openLink(String url, String key, String title) {
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
        startActivityForResult(i, REQUEST_PORTAL);
    }

    /** Opens the paper through Research4Life and saves its PDF. */
    private void fetchViaR4L(String key, String doi, String title) {
        Intent i = new Intent(this, PortalActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        i.putExtra(PortalActivity.EXTRA_FETCH, true);
        i.putExtra(PortalActivity.EXTRA_DOI, doi);
        i.putExtra(PortalActivity.EXTRA_KEY, key);
        i.putExtra(PortalActivity.EXTRA_TITLE, title);
        startActivityForResult(i, REQUEST_PORTAL);
    }

    private void openViewer(String key, String title) {
        Intent i = new Intent(this, PdfViewerActivity.class);
        i.putExtra(PdfViewerActivity.EXTRA_KEY, key);
        i.putExtra(PdfViewerActivity.EXTRA_TITLE, title);
        startActivity(i);
    }

    private void emit(JSONObject event) {
        String js = "window.App&&App.onNative(" + event + ")";
        main.post(() -> webView.evaluateJavascript(js, null));
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
                    main.post(() -> openViewer(key, title));
                } catch (Exception e) {
                    if (hasDoi) main.post(() -> fetchViaR4L(key, doi, title));
                    else emit(event("pdfFailed", "key", key, "message", "Couldn't download the free PDF."));
                }
            });
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
