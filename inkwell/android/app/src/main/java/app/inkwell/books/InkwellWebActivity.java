package app.inkwell.books;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import android.util.Base64;
import android.webkit.URLUtil;
import androidx.appcompat.app.AppCompatActivity;
import com.getcapacitor.JSObject;
import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * A small browser inside the app for services without an API (StoryShots,
 * your tracker site): sign in once and the session is kept (cookies persist),
 * and the user never leaves the app. In "capture" mode, .torrent downloads and
 * magnet links are handed to the app (which sends them to the home server).
 */
public class InkwellWebActivity extends AppCompatActivity {

    private WebView web;
    private TextView title;
    private ProgressBar bar;
    /** A strip under the top bar saying what happened to the last download (a toast is easy to miss). */
    private TextView note;
    private final android.os.Handler ui = new android.os.Handler(android.os.Looper.getMainLooper());
    /** Mobile view (page fits the phone) unless the user picks desktop view; remembered. */
    private boolean desktopView = false;
    /** The download being fetched through the page itself (fallback), and its one-time key. */
    private volatile String pendingNonce = null;
    private volatile String pendingName = "";
    /** One tap from a book page (Bookshare): pick EPUB 3 and press Download by itself, then close. */
    private boolean autoGet = false;
    private boolean autoClicked = false;
    static final String AUTO_GET_JS = "(function(){try{"
        + "var t=function(e){return ((e&&(e.innerText||e.textContent||e.value))||'').trim();};"
        + "var sels=[].slice.call(document.querySelectorAll('select'));"
        + "for(var i=0;i<sels.length;i++){var s=sels[i];var os=[].slice.call(s.options);"
        + "var o=os.filter(function(x){return /epub\\s*3/i.test(x.text);})[0]||os.filter(function(x){return /epub/i.test(x.text);})[0];"
        + "if(o){s.value=o.value;s.dispatchEvent(new Event('input',{bubbles:true}));s.dispatchEvent(new Event('change',{bubbles:true}));}}"
        + "var rs=[].slice.call(document.querySelectorAll('input[type=radio],input[type=checkbox]'));"
        + "for(var j=0;j<rs.length;j++){var r=rs[j];var l=r.closest('label')||(r.id&&document.querySelector('label[for=\"'+r.id+'\"]'));"
        + "if(/epub/i.test(t(l)+' '+(r.value||''))){if(!r.checked)r.click();break;}}"
        + "var bs=[].slice.call(document.querySelectorAll('button,a,input[type=submit],input[type=button]'));"
        + "var epubLink=bs.filter(function(b){return /download/i.test(t(b))&&/epub/i.test(t(b)+' '+(b.getAttribute('href')||''));})[0];"
        + "var ok=function(b){return !b.disabled&&!/history|help|how|app/i.test(t(b));};"
        + "var b=epubLink||bs.filter(function(b){return /^download$/i.test(t(b))&&ok(b);})[0]||bs.filter(function(b){return /^download\\b/i.test(t(b))&&ok(b);})[0];"
        + "if(b){b.click();return 'clicked';}return 'none';"
        + "}catch(e){return 'error';}})()";

    private void tryAutoGet(int attempt) {
        if (autoClicked || web == null) return;
        web.evaluateJavascript(AUTO_GET_JS, v -> {
            if (v != null && v.contains("clicked")) {
                autoClicked = true;
                showNote("Downloading the EPUB…", 0);
            } else if (attempt < 8) {
                ui.postDelayed(() -> tryAutoGet(attempt + 1), 1200); // the page may still be filling in
            } else {
                showNote("Choose EPUB 3 and tap Download — it goes to your Library", 0);
            }
        });
    }

    private final Runnable hideNote = () -> {
        if (note != null) note.setVisibility(View.GONE);
    };

    private int dp(int v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        String url = getIntent().getStringExtra("url");
        String heading = getIntent().getStringExtra("title");
        boolean capture = getIntent().getBooleanExtra("capture", false);
        autoGet = getIntent().getBooleanExtra("autoGet", false);
        if (autoGet) ui.postDelayed(() -> showNote("Getting the EPUB from Bookshare…", 0), 300);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#0f0d1a"));

        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(Gravity.CENTER_VERTICAL);
        top.setPadding(dp(4), dp(28), dp(12), dp(6));
        ImageButton close = new ImageButton(this);
        close.setImageResource(android.R.drawable.ic_menu_close_clear_cancel);
        close.setBackgroundColor(Color.TRANSPARENT);
        close.setColorFilter(Color.WHITE);
        close.setContentDescription("Close");
        close.setOnClickListener(v -> finish());
        top.addView(close, new LinearLayout.LayoutParams(dp(48), dp(48)));
        title = new TextView(this);
        title.setTextColor(Color.WHITE);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setSingleLine(true);
        title.setText(heading != null ? heading : "");
        top.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        // Copy this page's address, e.g. a search results page to use as the tracker's search address.
        TextView copy = new TextView(this);
        copy.setText("Copy link");
        copy.setTextColor(Color.WHITE);
        copy.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        copy.setGravity(android.view.Gravity.CENTER);
        copy.setPadding(dp(12), 0, dp(12), 0);
        copy.setContentDescription("Copy page address");
        copy.setOnClickListener(v -> {
            String u = web != null ? web.getUrl() : null;
            if (u == null || u.isEmpty()) return;
            android.content.ClipboardManager cm = (android.content.ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
            if (cm != null) cm.setPrimaryClip(android.content.ClipData.newPlainText("Page address", u));
            android.widget.Toast.makeText(this, "Page address copied", android.widget.Toast.LENGTH_SHORT).show();
        });
        top.addView(copy, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(48)));
        // Mobile / desktop view of the page (remembered).
        desktopView = getSharedPreferences("inkwell_web", MODE_PRIVATE).getBoolean("desktop", false);
        TextView view = new TextView(this);
        view.setText(desktopView ? "Mobile view" : "Desktop view");
        view.setTextColor(Color.WHITE);
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        view.setGravity(android.view.Gravity.CENTER);
        view.setPadding(dp(8), 0, dp(8), 0);
        view.setOnClickListener(v -> {
            desktopView = !desktopView;
            getSharedPreferences("inkwell_web", MODE_PRIVATE).edit().putBoolean("desktop", desktopView).apply();
            view.setText(desktopView ? "Mobile view" : "Desktop view");
            applyViewMode();
            if (web != null) web.reload();
        });
        top.addView(view, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(48)));
        root.addView(top);

        bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)));
        note = new TextView(this);
        note.setTextColor(Color.WHITE);
        note.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        note.setPadding(dp(16), dp(10), dp(16), dp(10));
        note.setVisibility(View.GONE);
        note.setOnClickListener(v -> note.setVisibility(View.GONE));
        root.addView(note, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        web = new WebView(this);
        root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        applyViewMode();
        // Pinch to zoom (small print on tracker pages), without the old +/- buttons.
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        // Look like regular Chrome so sign-in pages (incl. Google) accept the browser.
        s.setUserAgentString(s.getUserAgentString().replace("; wv)", ")").replaceAll("Version/[\\d.]+ ", ""));
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, true);

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int p) {
                bar.setProgress(p);
                bar.setVisibility(p >= 100 ? View.INVISIBLE : View.VISIBLE);
            }

            @Override
            public void onReceivedTitle(WebView view, String t) {
                if (heading == null || heading.isEmpty()) title.setText(t);
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                String scheme = u.getScheme() == null ? "" : u.getScheme();
                if (scheme.equals("http") || scheme.equals("https")) return false; // stay inside
                if (capture && scheme.equals("magnet")) {
                    String magnet = u.toString();
                    showNote("Sending to your home server…", 0);
                    new Thread(() -> {
                        String dn = Uri.parse(magnet).getQueryParameter("dn");
                        String result = sendToQbit(null, magnet, "", looksLikeEbook(dn == null ? "" : dn));
                        JSObject d = new JSObject();
                        d.put("type", "magnet");
                        d.put("url", magnet);
                        d.put("sent", result.startsWith("OK"));
                        d.put("message", result.startsWith("OK") ? result.substring(3) : result);
                        InkwellWebPlugin.captured(d);
                        report(result);
                    }).start();
                    return true;
                }
                try {
                    // intent:// and app links (e.g. "open in app") go to the installed app.
                    Intent i = scheme.equals("intent") ? Intent.parseUri(u.toString(), Intent.URI_INTENT_SCHEME) : new Intent(Intent.ACTION_VIEW, u);
                    startActivity(i);
                } catch (Exception ignored) {}
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String u) {
                CookieManager.getInstance().flush();
                if (autoGet && !autoClicked) tryAutoGet(0);
            }
        });
        if (capture) {
            String ua = s.getUserAgentString();
            web.setDownloadListener((dlUrl, userAgent, disposition, mime, length) -> {
                String name = URLUtil.guessFileName(dlUrl, disposition, mime);
                // Trackers often send .torrent files as a plain "download" (octet-stream, download.php…);
                // the file itself is checked once it arrives.
                String lower = dlUrl.toLowerCase();
                boolean torrent = (mime != null && (mime.contains("bittorrent") || mime.contains("octet-stream")))
                    || name.toLowerCase().endsWith(".torrent") || lower.contains(".torrent") || lower.contains("download");
                if (!torrent) {
                    Toast.makeText(this, "Only .torrent files can be sent to your home server", Toast.LENGTH_SHORT).show();
                    return;
                }
                showNote("Getting the .torrent…", 0);
                String referer = web.getUrl();
                String agent = userAgent != null ? userAgent : ua;
                new Thread(() -> {
                    try {
                        deliver(fetchTorrent(dlUrl, agent, referer), name);
                    } catch (Exception e) {
                        // Last resort: fetch it from inside the page, exactly as your tap would.
                        fetchInPage(dlUrl, name);
                    }
                }).start();
            });
            web.addJavascriptInterface(new CaptureBridge(), "AudiohubCapture");
        }
        // "books" mode (Bookshare): a book you download here is saved into Audiohub's library and
        // opens in the reader — an EPUB or PDF, or the one inside a zipped download.
        if (!capture && getIntent().getBooleanExtra("books", false)) {
            String ua = s.getUserAgentString();
            web.setDownloadListener((dlUrl, userAgent, disposition, mime, length) -> {
                String name = URLUtil.guessFileName(dlUrl, disposition, mime);
                showNote("Saving the book…", 0);
                String referer = web.getUrl();
                String agent = userAgent != null ? userAgent : ua;
                new Thread(() -> {
                    try {
                        saveBook(fetchBytes(dlUrl, agent, referer, false), name);
                    } catch (Exception e) {
                        report("Couldn't save the book: " + e.getMessage());
                    }
                }).start();
            });
        }
        if (state != null) web.restoreState(state);
        else if (url != null) web.loadUrl(url);
    }

    /** Keep a downloaded book in the app (files/books) and hand it to the library. */
    private void saveBook(byte[] bytes, String name) throws Exception {
        JSObject o = storeBook(this, bytes, name);
        InkwellLocalPlugin.arrived(o);
        report("OK Saved to your Library — " + o.getString("name"));
        // From the book page's one tap: close, so the book opens in the reader behind.
        if (autoGet) ui.postDelayed(this::finish, 900);
    }

    /** An EPUB / PDF (or the one inside a zipped download) kept in files/books: { path, name, format, size }. */
    static JSObject storeBook(android.content.Context ctx, byte[] bytes, String name) throws Exception {
        String lower = name.toLowerCase(java.util.Locale.ROOT);
        boolean zip = bytes.length > 4 && bytes[0] == 'P' && bytes[1] == 'K';
        // An EPUB is itself a zip: it has "mimetype" + "application/epub+zip" at the start.
        boolean epub = zip && new String(bytes, 0, Math.min(bytes.length, 120), StandardCharsets.ISO_8859_1).contains("application/epub+zip");
        boolean pdf = bytes.length > 4 && bytes[0] == '%' && bytes[1] == 'P' && bytes[2] == 'D' && bytes[3] == 'F';
        if (zip && !epub) {
            // A package: the EPUB (or PDF) inside it.
            byte[] inner = null;
            String innerName = null;
            try (java.util.zip.ZipInputStream z = new java.util.zip.ZipInputStream(new java.io.ByteArrayInputStream(bytes))) {
                java.util.zip.ZipEntry e;
                while ((e = z.getNextEntry()) != null) {
                    String n = e.getName().toLowerCase(java.util.Locale.ROOT);
                    if (e.isDirectory() || !(n.endsWith(".epub") || n.endsWith(".pdf"))) continue;
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    byte[] b = new byte[1 << 16];
                    int k;
                    while ((k = z.read(b)) > 0) out.write(b, 0, k);
                    inner = out.toByteArray();
                    innerName = e.getName().replaceAll(".*/", "");
                    if (n.endsWith(".epub")) break; // EPUB first
                }
            }
            if (inner == null) throw new Exception("there's no EPUB or PDF in this download — choose EPUB 3 as the format and download again");
            bytes = inner;
            name = innerName;
            lower = name.toLowerCase(java.util.Locale.ROOT);
            epub = lower.endsWith(".epub");
            pdf = lower.endsWith(".pdf");
        }
        if (!epub && !pdf) {
            if (lower.endsWith(".epub")) epub = true;
            else if (lower.endsWith(".pdf")) pdf = true;
            else throw new Exception("this isn't an EPUB or PDF — choose EPUB 3 as the format");
        }
        if (epub && !lower.endsWith(".epub")) name = name.replaceAll("\\.[A-Za-z0-9]{1,5}$", "") + ".epub";
        if (pdf && !lower.endsWith(".pdf")) name = name.replaceAll("\\.[A-Za-z0-9]{1,5}$", "") + ".pdf";
        java.io.File dir = new java.io.File(ctx.getFilesDir(), "books");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        java.io.File out = new java.io.File(dir, name.replaceAll("[\\/:*?\"<>|]+", " ").trim());
        try (OutputStream os = new java.io.FileOutputStream(out)) {
            os.write(bytes);
        }
        JSObject o = new JSObject();
        o.put("path", out.getAbsolutePath());
        o.put("name", name);
        o.put("format", pdf ? "PDF" : "EPUB");
        o.put("size", out.length());
        return o;
    }

    private void applyViewMode() {
        if (web == null) return;
        WebSettings ws = web.getSettings();
        ws.setUseWideViewPort(desktopView);
        ws.setLoadWithOverviewMode(desktopView);
    }

    /**
     * Download the .torrent with the page's sign-in cookies: follows redirects (also
     * http↔https, which Android doesn't do by itself) and tries up to 3 times, since
     * a tracker sometimes answers the first request with a page instead of the file.
     */
    private byte[] fetchTorrent(String dlUrl, String ua, String referer) throws Exception {
        return fetchBytes(dlUrl, ua, referer, true);
    }

    private byte[] fetchBytes(String dlUrl, String ua, String referer, boolean torrent) throws Exception {
        Exception last = new Exception("couldn't download it");
        for (int attempt = 0; attempt < 3; attempt++) {
            try {
                String u = dlUrl;
                for (int hop = 0; hop < 6; hop++) {
                    HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
                    c.setInstanceFollowRedirects(false);
                    c.setConnectTimeout(15000);
                    c.setReadTimeout(30000);
                    String cookie = CookieManager.getInstance().getCookie(u);
                    if (cookie != null) c.setRequestProperty("Cookie", cookie);
                    c.setRequestProperty("User-Agent", ua);
                    c.setRequestProperty("Accept", torrent ? "application/x-bittorrent,application/octet-stream,*/*" : "application/epub+zip,application/zip,application/pdf,application/octet-stream,*/*");
                    if (referer != null) c.setRequestProperty("Referer", referer);
                    int code = c.getResponseCode();
                    for (Map.Entry<String, List<String>> h : c.getHeaderFields().entrySet()) {
                        if (h.getKey() == null || !h.getKey().equalsIgnoreCase("Set-Cookie")) continue;
                        for (String sc : h.getValue()) CookieManager.getInstance().setCookie(u, sc);
                    }
                    if (code >= 300 && code < 400) {
                        String loc = c.getHeaderField("Location");
                        c.disconnect();
                        if (loc == null) throw new Exception("HTTP " + code);
                        u = new URL(new URL(u), loc).toString();
                        continue;
                    }
                    if (code >= 400) throw new Exception("HTTP " + code);
                    InputStream in = c.getInputStream();
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    byte[] buf = new byte[16384];
                    int n;
                    long cap = torrent ? 20_000_000L : 150_000_000L;
                    while ((n = in.read(buf)) > 0 && out.size() < cap) out.write(buf, 0, n);
                    in.close();
                    byte[] bytes = out.toByteArray();
                    if (!torrent) {
                        if (bytes.length > 0 && bytes[0] == '<') throw new Exception("the site sent a web page, not the book — is it ready? Try Download again in a moment");
                        return bytes;
                    }
                    if (bytes.length == 0 || bytes[0] != 'd') throw new Exception("the site sent a web page, not a .torrent — are you signed in?");
                    return bytes;
                }
                throw new Exception("too many redirects");
            } catch (Exception e) {
                last = e;
                if (attempt < 2) {
                    showNote(torrent ? "Getting the .torrent… (trying again)" : "Saving the book… (trying again)", 0);
                    try {
                        Thread.sleep(1200L * (attempt + 1));
                    } catch (InterruptedException ignored) {
                    }
                }
            }
        }
        throw last;
    }

    /** Fetch the .torrent from inside the page (its own cookies and checks), then hand it over. */
    private void fetchInPage(String dlUrl, String name) {
        String nonce = java.util.UUID.randomUUID().toString();
        pendingNonce = nonce;
        pendingName = name;
        String js = "(function(){var N=" + JSONObject.quote(nonce) + ";fetch(" + JSONObject.quote(dlUrl) + ",{credentials:'include'})"
            + ".then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.arrayBuffer();})"
            + ".then(function(b){var u=new Uint8Array(b);if(!u.length||u[0]!==100)throw new Error('the site sent a web page, not a .torrent — are you signed in?');"
            + "var s='';for(var i=0;i<u.length;i+=32768)s+=String.fromCharCode.apply(null,u.subarray(i,i+32768));AudiohubCapture.got(N,btoa(s));})"
            + ".catch(function(e){AudiohubCapture.failed(N,String(e&&e.message||e));});})()";
        runOnUiThread(() -> web.evaluateJavascript(js, null));
    }

    /** Receives the page-fetched .torrent; only for the request we just made (one-time key). */
    private class CaptureBridge {
        @JavascriptInterface
        public void got(String nonce, String b64) {
            if (nonce == null || !nonce.equals(pendingNonce)) return;
            pendingNonce = null;
            String name = pendingName;
            new Thread(() -> {
                try {
                    deliver(Base64.decode(b64, Base64.DEFAULT), name);
                } catch (Exception e) {
                    report("Couldn't get the .torrent: " + e.getMessage());
                }
            }).start();
        }

        @JavascriptInterface
        public void failed(String nonce, String message) {
            if (nonce == null || !nonce.equals(pendingNonce)) return;
            pendingNonce = null;
            report("Couldn't get the .torrent: " + message + " — tap Download again");
        }
    }

    /** Send the .torrent to qBittorrent and tell the app. */
    private void deliver(byte[] bytes, String name) {
        showNote("Sending to your home server…", 0);
        String result = sendToQbit(bytes, null, name, torrentIsEbook(bytes));
        JSObject d = new JSObject();
        d.put("type", "torrent");
        d.put("name", name);
        d.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
        d.put("sent", result.startsWith("OK"));
        d.put("message", result.startsWith("OK") ? result.substring(3) : result);
        InkwellWebPlugin.captured(d);
        report(result);
    }

    private void toast(String text) {
        runOnUiThread(() -> Toast.makeText(this, text, Toast.LENGTH_LONG).show());
    }

    /** Show [text] in the strip; hide it after [ms] (0 = keep until replaced or tapped). */
    private void showNote(String text, int ms) {
        runOnUiThread(() -> {
            ui.removeCallbacks(hideNote);
            boolean bad = text.startsWith("Couldn't") || text.startsWith("qBittorrent") || text.startsWith("Set up");
            note.setBackgroundColor(Color.parseColor(bad ? "#7f1d1d" : "#27233a"));
            note.setText(text);
            note.setVisibility(View.VISIBLE);
            if (ms > 0) ui.postDelayed(hideNote, ms);
        });
    }

    /** The outcome of a send: success fades after a while, a problem stays until tapped. */
    private void report(String result) {
        boolean ok = result.startsWith("OK");
        String text = ok ? "✓ " + result.substring(3) : result;
        showNote(text, ok ? 8000 : 0);
        toast(text);
    }

    private static final java.util.regex.Pattern AUDIO = java.util.regex.Pattern.compile("\\.(m4b|m4a|mp3|flac|aac|ogg|opus|wma|aax)\\b");
    private static final java.util.regex.Pattern EBOOK = java.util.regex.Pattern.compile("\\.(epub|pdf|mobi|azw3?|kfx|fb2|djvu|cbz|cbr)\\b|\\b(epub|ebook|e-book)\\b");

    /** A torrent whose files are books to read (no audio files in it). */
    static boolean torrentIsEbook(byte[] torrent) {
        String t = new String(torrent, StandardCharsets.ISO_8859_1).toLowerCase(java.util.Locale.ROOT);
        return !AUDIO.matcher(t).find() && EBOOK.matcher(t).find();
    }

    static boolean looksLikeEbook(String name) {
        String t = name.toLowerCase(java.util.Locale.ROOT);
        return !AUDIO.matcher(t).find() && !t.contains("audiobook") && EBOOK.matcher(t).find();
    }

    private static String enc(String v) {
        try {
            return URLEncoder.encode(v, "UTF-8");
        } catch (Exception e) {
            return v;
        }
    }

    /**
     * Send a .torrent (bytes) or a magnet to the user's qBittorrent Web UI, using
     * the settings the app passed in. Returns "OK <message>" or an error message.
     */
    private String sendToQbit(byte[] torrent, String magnet, String name, boolean ebook) {
        return sendToQbit(getIntent().getStringExtra("qbit"), torrent, magnet, name, ebook);
    }

    /** The same, with the app's qBittorrent settings (JSON) passed in — also used by background grabs. */
    static String sendToQbit(String raw, byte[] torrent, String magnet, String name, boolean ebook) {
        try {
            if (raw == null || raw.isEmpty()) return "Set up your home server in Audiohub first";
            JSONObject q = new JSONObject(raw);
            String base = q.optString("url").replaceAll("/+$", "");
            if (!base.matches("(?i)^https?://.*")) base = "http://" + base;
            String apiKey = q.optString("apiKey").trim();
            String cookie = null;
            if (apiKey.isEmpty() && !(q.optString("username").isEmpty() && q.optString("password").isEmpty())) {
                HttpURLConnection c = (HttpURLConnection) new URL(base + "/api/v2/auth/login").openConnection();
                c.setRequestMethod("POST");
                c.setDoOutput(true);
                c.setConnectTimeout(15000);
                c.setReadTimeout(20000);
                c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
                c.setRequestProperty("Referer", base + "/");
                c.setRequestProperty("Origin", base);
                OutputStream o = c.getOutputStream();
                o.write(("username=" + enc(q.optString("username")) + "&password=" + enc(q.optString("password"))).getBytes(StandardCharsets.UTF_8));
                o.close();
                int code = c.getResponseCode();
                if (code == 401 || code == 403) return "qBittorrent rejected the login";
                Map<String, List<String>> h = c.getHeaderFields();
                for (Map.Entry<String, List<String>> e : h.entrySet()) {
                    if (e.getKey() == null || !e.getKey().equalsIgnoreCase("Set-Cookie")) continue;
                    for (String v : e.getValue()) {
                        String kv = v.split(";")[0];
                        if (kv.startsWith("SID=") || kv.startsWith("QBT_SID")) cookie = kv;
                    }
                }
            }
            String boundary = "----kathava" + System.nanoTime();
            ByteArrayOutputStream body = new ByteArrayOutputStream();
            java.util.function.BiConsumer<String, String> field = (k, v) -> {
                if (v == null || v.isEmpty()) return;
                String part = "--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + k + "\"\r\n\r\n" + v + "\r\n";
                body.write(part.getBytes(StandardCharsets.UTF_8), 0, part.getBytes(StandardCharsets.UTF_8).length);
            };
            if (torrent != null) {
                String head = "--" + boundary + "\r\nContent-Disposition: form-data; name=\"torrents\"; filename=\"" + (name == null || name.isEmpty() ? "download.torrent" : name.replace("\"", "")) + "\"\r\nContent-Type: application/x-bittorrent\r\n\r\n";
                body.write(head.getBytes(StandardCharsets.UTF_8));
                body.write(torrent);
                body.write("\r\n".getBytes(StandardCharsets.UTF_8));
            } else {
                String m = magnet;
                JSONArray trackers = q.optJSONArray("trackers");
                if (trackers != null) for (int i = 0; i < trackers.length(); i++) {
                    String t = trackers.optString(i);
                    if (!m.contains(enc(t)) && !m.contains(t)) m += "&tr=" + enc(t);
                }
                field.accept("urls", m);
            }
            // Ebooks go to their own folder when one is set, not the audiobook folder.
            String ebookPath = q.optString("ebookPath").trim();
            boolean toEbooks = ebook && !ebookPath.isEmpty();
            String save = toEbooks ? ebookPath : q.optString("savePath");
            field.accept("savepath", save);
            if (!save.isEmpty()) field.accept("autoTMM", "false");
            field.accept("category", q.optString("category"));
            field.accept("tags", "kathava");
            body.write(("--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));

            HttpURLConnection c = (HttpURLConnection) new URL(base + "/api/v2/torrents/add").openConnection();
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
            c.setRequestProperty("Referer", base + "/");
            c.setRequestProperty("Origin", base);
            if (!apiKey.isEmpty()) c.setRequestProperty("Authorization", "Bearer " + apiKey);
            else if (cookie != null) c.setRequestProperty("Cookie", cookie);
            OutputStream o = c.getOutputStream();
            body.writeTo(o);
            o.close();
            int code = c.getResponseCode();
            String text = "";
            try {
                InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
                if (in != null) {
                    ByteArrayOutputStream r = new ByteArrayOutputStream();
                    byte[] b = new byte[4096];
                    int n;
                    while ((n = in.read(b)) > 0) r.write(b, 0, n);
                    text = r.toString("UTF-8");
                }
            } catch (Exception ignored) {}
            String label = (name != null && !name.isEmpty() ? name.replaceAll("(?i)\\.torrent$", "") : "it") + (toEbooks ? " (ebooks folder)" : "");
            if (code == 409) return "OK Already in qBittorrent — " + label;
            if (code == 401 || code == 403) return "qBittorrent refused the request (HTTP " + code + ") — check the API key or login in Audiohub";
            if (code >= 400) return "qBittorrent: HTTP " + code;
            // 5.2.3+: a JSON summary ({"success_count":1,"failure_count":0,…}); older: "Ok." / "Fails."
            try {
                JSONObject j = new JSONObject(text);
                if (j.has("success_count")) {
                    if (j.optInt("success_count") > 0) return "OK Sent to qBittorrent — " + label;
                    if (j.optInt("failure_count") > 0) return "qBittorrent didn't add " + label + " — check the save folder and that the drive is connected";
                    return "OK Already in qBittorrent — " + label;
                }
            } catch (Exception ignored) {}
            if (text.trim().equalsIgnoreCase("Fails.")) return "qBittorrent didn't add " + label + " — check the save folder and that the drive is connected";
            return "OK Sent to qBittorrent — " + label;
        } catch (Exception e) {
            return "Couldn't reach qBittorrent: " + e.getMessage();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush(); // your sign-in, kept even if Android closes the app
    }

    @Override
    protected void onDestroy() {
        CookieManager.getInstance().flush();
        web.destroy();
        super.onDestroy();
    }
}
