package com.selfuse.pdfeditor;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.print.PrintManager;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Hosts the offline HTML/JS PDF editor (assets/www) in a WebView and bridges
 * file open / save / share to Android. No network access is used.
 */
public class MainActivity extends Activity {

    static final String HOST = "app.local";
    static final String BASE_URL = "https://" + HOST + "/";

    private static final int REQ_FILE_CHOOSER = 1;
    private static final int REQ_SAVE_DOCUMENT = 2;

    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private boolean pageReady = false;
    private String pendingIncomingName;

    private File pendingSaveFile;
    private FileOutputStream pendingSaveStream;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#EEF0F3"));
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setTextZoom(100);

        webView.addJavascriptInterface(new Bridge(), "AndroidBridge");
        webView.setWebViewClient(new LocalClient());
        webView.setWebChromeClient(new ChromeClient());

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(BASE_URL + "index.html");
        }
        handleIntent(getIntent());
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleIntent(intent);
    }

    @Override
    public void onBackPressed() {
        webView.evaluateJavascript("window.onAndroidBack ? window.onAndroidBack() : false",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        if (!"true".equals(value)) {
                            MainActivity.super.onBackPressed();
                        }
                    }
                });
    }

    @Override
    protected void onDestroy() {
        closeSaveStream();
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }

    // ---------------------------------------------------------------- incoming PDFs

    private void handleIntent(Intent intent) {
        if (intent == null) return;
        Uri uri = null;
        String action = intent.getAction();
        if (Intent.ACTION_VIEW.equals(action) || Intent.ACTION_EDIT.equals(action)) {
            uri = intent.getData();
        } else if (Intent.ACTION_SEND.equals(action)) {
            uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        }
        if (uri == null) return;
        final Uri src = uri;
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    final String name = queryName(src);
                    copyUriToFile(src, incomingFile());
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            deliverIncoming(name);
                        }
                    });
                } catch (final Exception e) {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            toast("Could not open file: " + e.getMessage());
                        }
                    });
                }
            }
        }).start();
        // Prevent re-opening on configuration change.
        intent.setAction(Intent.ACTION_MAIN);
    }

    private void deliverIncoming(String name) {
        if (!pageReady) {
            pendingIncomingName = name;
            return;
        }
        webView.evaluateJavascript("window.openIncoming && window.openIncoming("
                + JSONObject.quote(name) + ")", null);
    }

    private File incomingFile() {
        return new File(getCacheDir(), "incoming.pdf");
    }

    private String queryName(Uri uri) {
        String name = null;
        if ("content".equals(uri.getScheme())) {
            try (Cursor c = getContentResolver().query(uri,
                    new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                if (c != null && c.moveToFirst()) name = c.getString(0);
            } catch (Exception ignored) {
            }
        }
        if (name == null) name = uri.getLastPathSegment();
        if (name == null || name.isEmpty()) name = "document.pdf";
        return name;
    }

    private void copyUriToFile(Uri uri, File dest) throws IOException {
        try (InputStream in = getContentResolver().openInputStream(uri);
             OutputStream out = new FileOutputStream(dest)) {
            if (in == null) throw new IOException("cannot read");
            copy(in, out);
        }
    }

    private static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
    }

    // ---------------------------------------------------------------- save / share

    private void closeSaveStream() {
        if (pendingSaveStream != null) {
            try {
                pendingSaveStream.close();
            } catch (IOException ignored) {
            }
            pendingSaveStream = null;
        }
    }

    private void notifyJs(String fn, boolean ok, String msg) {
        final String js = "window." + fn + " && window." + fn + "("
                + ok + "," + JSONObject.quote(msg == null ? "" : msg) + ")";
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                webView.evaluateJavascript(js, null);
            }
        });
    }

    static String mimeFor(String name) {
        String n = name.toLowerCase();
        if (n.endsWith(".pdf")) return "application/pdf";
        if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".zip")) return "application/zip";
        if (n.endsWith(".txt")) return "text/plain";
        if (n.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        return "application/octet-stream";
    }

    private void printFile(final String name) {
        final File file = new File(getCacheDir(), "print.pdf");
        if (!pendingSaveFile.renameTo(file)) {
            notifyJs("onNativeSaved", false, "Could not prepare file");
            return;
        }
        PrintManager pm = (PrintManager) getSystemService(PRINT_SERVICE);
        if (pm == null) {
            notifyJs("onNativeSaved", false, "Printing is not available");
            return;
        }
        pm.print(name, new PrintDocumentAdapter() {
            @Override
            public void onLayout(PrintAttributes oldAttributes, PrintAttributes newAttributes,
                                 CancellationSignal cancel, LayoutResultCallback callback, Bundle extras) {
                if (cancel.isCanceled()) {
                    callback.onLayoutCancelled();
                    return;
                }
                callback.onLayoutFinished(new PrintDocumentInfo.Builder(name)
                        .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT).build(), true);
            }

            @Override
            public void onWrite(PageRange[] pages, ParcelFileDescriptor destination,
                                CancellationSignal cancel, WriteResultCallback callback) {
                try (InputStream in = new FileInputStream(file);
                     OutputStream out = new FileOutputStream(destination.getFileDescriptor())) {
                    copy(in, out);
                    callback.onWriteFinished(new PageRange[]{PageRange.ALL_PAGES});
                } catch (IOException e) {
                    callback.onWriteFailed(e.getMessage());
                }
            }
        }, null);
        notifyJs("onNativeSaved", true, "");
    }

    private void finishSave(String name, String mode) {
        if ("print".equals(mode)) {
            printFile(name);
        } else if ("share".equals(mode)) {
            File shareDir = new File(getCacheDir(), "share");
            shareDir.mkdirs();
            File[] old = shareDir.listFiles();
            if (old != null) for (File f : old) f.delete();
            File target = new File(shareDir, name);
            if (!pendingSaveFile.renameTo(target)) {
                notifyJs("onNativeSaved", false, "Could not prepare file");
                return;
            }
            Uri uri = Uri.parse("content://" + getPackageName() + ".share/" + Uri.encode(name));
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mimeFor(name));
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.setClipData(ClipData.newRawUri(name, uri));
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(Intent.createChooser(send, "Share " + name));
            notifyJs("onNativeSaved", true, "");
        } else {
            Intent create = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            create.addCategory(Intent.CATEGORY_OPENABLE);
            create.setType(mimeFor(name));
            create.putExtra(Intent.EXTRA_TITLE, name);
            try {
                startActivityForResult(create, REQ_SAVE_DOCUMENT);
            } catch (ActivityNotFoundException e) {
                notifyJs("onNativeSaved", false, "No file manager available");
            }
        }
    }

    private void writeSavedDocument(final Uri dest) {
        final File src = pendingSaveFile;
        new Thread(new Runnable() {
            @Override
            public void run() {
                try (InputStream in = new FileInputStream(src);
                     OutputStream out = getContentResolver().openOutputStream(dest, "wt")) {
                    if (out == null) throw new IOException("cannot write");
                    copy(in, out);
                    notifyJs("onNativeSaved", true, "Saved");
                } catch (Exception e) {
                    notifyJs("onNativeSaved", false, "Save failed: " + e.getMessage());
                } finally {
                    src.delete();
                }
            }
        }).start();
    }

    // ---------------------------------------------------------------- activity results

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE_CHOOSER) {
            if (fileCallback == null) return;
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    ClipData clip = data.getClipData();
                    result = new Uri[clip.getItemCount()];
                    for (int i = 0; i < clip.getItemCount(); i++) result[i] = clip.getItemAt(i).getUri();
                } else if (data.getData() != null) {
                    result = new Uri[]{data.getData()};
                }
            }
            fileCallback.onReceiveValue(result);
            fileCallback = null;
        } else if (requestCode == REQ_SAVE_DOCUMENT) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                writeSavedDocument(data.getData());
            } else {
                notifyJs("onNativeSaved", false, "Save cancelled");
            }
        }
    }

    private void toast(String msg) {
        Toast.makeText(this, msg, Toast.LENGTH_LONG).show();
    }

    // ---------------------------------------------------------------- JS bridge

    private class Bridge {
        private String saveName;

        @JavascriptInterface
        public boolean beginFile(String name) {
            closeSaveStream();
            try {
                saveName = sanitize(name);
                pendingSaveFile = new File(getCacheDir(), "pending-save.bin");
                pendingSaveStream = new FileOutputStream(pendingSaveFile);
                return true;
            } catch (IOException e) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean appendChunk(String base64) {
            if (pendingSaveStream == null) return false;
            try {
                pendingSaveStream.write(Base64.decode(base64, Base64.DEFAULT));
                return true;
            } catch (Exception e) {
                closeSaveStream();
                return false;
            }
        }

        /** mode: "save" (pick location) or "share". */
        @JavascriptInterface
        public void finishFile(final String mode) {
            closeSaveStream();
            final String name = saveName;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    finishSave(name, mode);
                }
            });
        }

        @JavascriptInterface
        public void toast(final String msg) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    MainActivity.this.toast(msg);
                }
            });
        }

        private String sanitize(String name) {
            if (name == null || name.trim().isEmpty()) name = "document.pdf";
            name = name.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
            return name;
        }
    }

    // ---------------------------------------------------------------- WebView plumbing

    private static final Map<String, String> MIME = new HashMap<>();

    static {
        MIME.put("html", "text/html");
        MIME.put("js", "application/javascript");
        MIME.put("mjs", "application/javascript");
        MIME.put("css", "text/css");
        MIME.put("json", "application/json");
        MIME.put("svg", "image/svg+xml");
        MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg");
        MIME.put("pdf", "application/pdf");
        MIME.put("bcmap", "application/octet-stream");
        MIME.put("pfb", "application/octet-stream");
        MIME.put("ttf", "font/ttf");
        MIME.put("txt", "text/plain");
    }

    private class LocalClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (!HOST.equals(url.getHost())) {
                // Fully offline: block everything else.
                return new WebResourceResponse("text/plain", "utf-8", 403, "Blocked",
                        new HashMap<>(), null);
            }
            String path = url.getPath();
            if (path == null || path.equals("/")) path = "/index.html";
            try {
                InputStream in;
                if (path.equals("/incoming.pdf")) {
                    in = new FileInputStream(incomingFile());
                } else {
                    if (path.contains("..")) throw new IOException("bad path");
                    in = getAssets().open("www" + path);
                }
                String ext = path.substring(path.lastIndexOf('.') + 1).toLowerCase();
                String mime = MIME.containsKey(ext) ? MIME.get(ext) : "application/octet-stream";
                Map<String, String> headers = new HashMap<>();
                headers.put("Access-Control-Allow-Origin", "*");
                headers.put("Cache-Control", "no-cache");
                return new WebResourceResponse(mime, mime.startsWith("text") || mime.endsWith("javascript") ? "utf-8" : null,
                        200, "OK", headers, in);
            } catch (IOException e) {
                return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                        new HashMap<>(), null);
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return !HOST.equals(request.getUrl().getHost());
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            pageReady = true;
            if (pendingIncomingName != null) {
                String n = pendingIncomingName;
                pendingIncomingName = null;
                deliverIncoming(n);
            }
        }
    }

    private class ChromeClient extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                         FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            String[] types = params.getAcceptTypes();
            String type = (types != null && types.length > 0 && !types[0].isEmpty()) ? types[0] : "*/*";
            if (type.startsWith(".")) type = "*/*";
            intent.setType(type);
            if (types != null && types.length > 1) {
                intent.putExtra(Intent.EXTRA_MIME_TYPES, types);
                intent.setType("*/*");
            }
            if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            }
            try {
                startActivityForResult(intent, REQ_FILE_CHOOSER);
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                return false;
            }
            return true;
        }
    }
}
