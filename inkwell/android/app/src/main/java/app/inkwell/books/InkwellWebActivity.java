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
                    JSObject d = new JSObject();
                    d.put("type", "magnet");
                    d.put("url", u.toString());
                    InkwellWebPlugin.captured(d);
                    Toast.makeText(InkwellWebActivity.this, "Sending to your home server…", Toast.LENGTH_SHORT).show();
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
                        JSObject d = new JSObject();
                        d.put("type", "torrent");
                        d.put("name", name);
                        d.put("data", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
                        InkwellWebPlugin.captured(d);
                    } catch (Exception e) {
                        runOnUiThread(() -> Toast.makeText(this, "Couldn't download the .torrent: " + e.getMessage(), Toast.LENGTH_LONG).show());
                    }
                }).start();
            });
        }
        if (state != null) web.restoreState(state);
        else if (url != null) web.loadUrl(url);
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
