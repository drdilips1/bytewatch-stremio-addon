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
        root.addView(top);

        bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)));

        web = new WebView(this);
        root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
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
                    Toast.makeText(InkwellWebActivity.this, "Sending to your home server…", Toast.LENGTH_SHORT).show();
                    new Thread(() -> {
                        String result = sendToQbit(null, magnet, "");
                        JSObject d = new JSObject();
                        d.put("type", "magnet");
                        d.put("url", magnet);
                        d.put("sent", result.startsWith("OK"));
                        InkwellWebPlugin.captured(d);
                        toast(result.startsWith("OK") ? result.substring(3) : result);
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
            }
        });
        if (capture) {
            String ua = s.getUserAgentString();
            web.setDownloadListener((dlUrl, userAgent, disposition, mime, length) -> {
                String name = URLUtil.guessFileName(dlUrl, disposition, mime);
                boolean torrent = (mime != null && mime.contains("bittorrent")) || name.toLowerCase().endsWith(".torrent") || dlUrl.toLowerCase().contains(".torrent");
                if (!torrent) {
                    Toast.makeText(this, "Only .torrent files can be sent to your home server", Toast.LENGTH_SHORT).show();
                    return;
                }
                Toast.makeText(this, "Sending to your home server…", Toast.LENGTH_SHORT).show();
                String cookie = CookieManager.getInstance().getCookie(dlUrl);
                String referer = web.getUrl();
                new Thread(() -> {
                    try {
                        HttpURLConnection c = (HttpURLConnection) new URL(dlUrl).openConnection();
                        c.setInstanceFollowRedirects(true);
                        c.setConnectTimeout(20000);
                        c.setReadTimeout(30000);
                        if (cookie != null) c.setRequestProperty("Cookie", cookie);
                        c.setRequestProperty("User-Agent", userAgent != null ? userAgent : ua);
                        if (referer != null) c.setRequestProperty("Referer", referer);
                        int code = c.getResponseCode();
                        if (code >= 400) throw new Exception("HTTP " + code);
                        InputStream in = c.getInputStream();
                        ByteArrayOutputStream out = new ByteArrayOutputStream();
                        byte[] buf = new byte[16384];
                        int n;
                        while ((n = in.read(buf)) > 0 && out.size() < 20_000_000) out.write(buf, 0, n);
                        in.close();
                        byte[] bytes = out.toByteArray();
                        String result = sendToQbit(bytes, null, name);
                        JSObject d = new JSObject();
                        d.put("type", "torrent");
                        d.put("name", name);
                        d.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
                        d.put("sent", result.startsWith("OK"));
                        InkwellWebPlugin.captured(d);
                        toast(result.startsWith("OK") ? result.substring(3) : result);
                    } catch (Exception e) {
                        runOnUiThread(() -> Toast.makeText(this, "Couldn't download the .torrent: " + e.getMessage(), Toast.LENGTH_LONG).show());
                    }
                }).start();
            });
        }
        if (state != null) web.restoreState(state);
        else if (url != null) web.loadUrl(url);
    }

    private void toast(String text) {
        runOnUiThread(() -> Toast.makeText(this, text, Toast.LENGTH_LONG).show());
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
    private String sendToQbit(byte[] torrent, String magnet, String name) {
        try {
            String raw = getIntent().getStringExtra("qbit");
            if (raw == null || raw.isEmpty()) return "Set up your home server in Kathava first";
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
            String save = q.optString("savePath");
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
            String label = name != null && !name.isEmpty() ? name.replaceAll("(?i)\\.torrent$", "") : "it";
            if (code == 409) return "OK Already in qBittorrent — " + label;
            if (code == 401 || code == 403) return "qBittorrent refused the request (HTTP " + code + ") — check the API key or login in Kathava";
            if (code >= 400) return "qBittorrent: HTTP " + code;
            if (text.toLowerCase().contains("fail")) return "qBittorrent didn't add " + label + " — check the save folder and that the drive is connected";
            try {
                JSONObject j = new JSONObject(text);
                if (j.has("success_count") && j.optInt("success_count") == 0) return "OK Already in qBittorrent — " + label;
            } catch (Exception ignored) {}
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
    protected void onDestroy() {
        CookieManager.getInstance().flush();
        web.destroy();
        super.onDestroy();
    }
}
