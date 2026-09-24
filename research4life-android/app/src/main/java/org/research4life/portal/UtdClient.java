package org.research4life.portal;

import android.annotation.SuppressLint;
import android.content.Context;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONObject;

/**
 * Reads UpToDate inside the app: a hidden WebView (sharing the app's cookies, so the user's
 * UpToDate session applies) loads the search or topic page, signs in with the saved login when
 * asked, and hands the rendered content back as JSON for the app to display in its own UI.
 */
final class UtdClient {

    interface Callback {
        void onResult(JSONObject result);
    }

    static final String BASE = "https://www.uptodate.com";
    private static final long POLL_MS = 700;
    private static final long TIMEOUT_MS = 30_000;

    private final Context app;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final WebView webView;
    private int token;
    private String kind;          // "search" or "topic"
    private String target;        // URL of the current request
    private String request;       // query or URL, echoed back to the app
    private Callback callback;
    private long started;
    private int logins;
    private String lastPayload;
    private int stablePolls;

    @SuppressLint("SetJavaScriptEnabled")
    UtdClient(Context activity, FrameLayout host) {
        app = activity.getApplicationContext();
        webView = new WebView(activity);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadsImagesAutomatically(false); // text only in the background; images load in the reader
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                String sc = req.getUrl().getScheme();
                return !"http".equals(sc) && !"https".equals(sc);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                CookieManager.getInstance().flush();
                onPage(url);
            }
        });
        host.addView(webView, 0, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    void search(String query, Callback cb) {
        start("search", BASE + "/contents/search?search=" + Uri.encode(query)
                + "&sp=0&searchType=PLAIN_TEXT&source=USER_INPUT&searchControl=TOP_PULLDOWN&autoComplete=false", query, cb);
    }

    void topic(String url, Callback cb) {
        Uri u = Uri.parse(url);
        String host = u.getHost();
        if (host == null || !(host.equals("uptodate.com") || host.endsWith(".uptodate.com"))) {
            cb.onResult(result("error", "Not an UpToDate link"));
            return;
        }
        start("topic", url, url, cb);
    }

    private void start(String kind, String url, String request, Callback cb) {
        token++;
        this.kind = kind;
        this.target = url;
        this.request = request;
        this.callback = cb;
        this.started = System.currentTimeMillis();
        this.logins = 0;
        this.lastPayload = null;
        this.stablePolls = 0;
        webView.stopLoading();
        webView.loadUrl(url);
        final int t = token;
        main.postDelayed(() -> poll(t), 1500);
    }

    private static boolean isLoginUrl(String url) {
        String p = Uri.parse(url).getPath();
        return p != null && p.toLowerCase().matches(".*(login|signin|sign-in|logout).*");
    }

    private void onPage(String url) {
        if (callback == null || url == null) return;
        if (isLoginUrl(url)) {
            if (!R4LSession.hasCredentials(app, R4LSession.UTD) || logins >= 2) {
                finish(result("login", R4LSession.hasCredentials(app, R4LSession.UTD)
                        ? "UpToDate didn't accept the saved login. Sign in once to continue."
                        : "Sign in to UpToDate once to see its results here."));
                return;
            }
            logins++;
            String js = R4LSession.signInScript(R4LSession.username(app, R4LSession.UTD),
                    R4LSession.password(app, R4LSession.UTD), true);
            webView.evaluateJavascript(js, null);
            return;
        }
        // Signed in, but UpToDate may land on its home page instead of the request.
        if (logins > 0 && !url.startsWith(target) && !url.contains("/contents/")) {
            logins += 10; // only retry once
            webView.loadUrl(target);
        }
    }

    private void poll(int t) {
        if (t != token || callback == null) return;
        if (System.currentTimeMillis() - started > TIMEOUT_MS) {
            finish(result("error", "UpToDate took too long to respond. Check your connection and try again."));
            return;
        }
        String url = webView.getUrl();
        if (url != null && isLoginUrl(url)) {
            main.postDelayed(() -> poll(t), POLL_MS);
            return;
        }
        webView.evaluateJavascript("search".equals(kind) ? SEARCH_SCRIPT : TOPIC_SCRIPT, value -> {
            if (t != token || callback == null) return;
            try {
                String json = new org.json.JSONArray("[" + value + "]").getString(0);
                JSONObject o = new JSONObject(json);
                String state = o.optString("state");
                if ("login".equals(state)) {
                    onPage(BASE + "/login");
                } else if ("results".equals(state) || "ok".equals(state) || "empty".equals(state)) {
                    // Wait until the page stops changing (results render progressively).
                    if (json.equals(lastPayload) && ++stablePolls >= 1) {
                        finish(o);
                        return;
                    }
                    lastPayload = json;
                }
            } catch (Exception ignored) {
                // Page not ready yet.
            }
            main.postDelayed(() -> poll(t), POLL_MS);
        });
    }

    private void finish(JSONObject o) {
        Callback cb = callback;
        callback = null;
        token++;
        try {
            o.put("kind", kind);
            o.put("request", request);
            if (!o.has("url")) o.put("url", webView.getUrl());
        } catch (Exception ignored) {
        }
        if (cb != null) cb.onResult(o);
    }

    private static JSONObject result(String state, String message) {
        JSONObject o = new JSONObject();
        try {
            o.put("state", state);
            o.put("message", message);
        } catch (Exception ignored) {
        }
        return o;
    }

    // ------------------------------------------------------------------ page readers

    /** Topic links from the search results area (not the site's header or menus). */
    static final String SEARCH_SCRIPT = "(function(){"
            + "if(document.querySelector('input[type=password]'))return JSON.stringify({state:'login'});"
            + "var bad=/\\/contents\\/(search|table-of-contents|image|calculator|whats-new|practice-changing|patient-education$|index)/i;"
            + "var links=[].slice.call(document.querySelectorAll('a[href*=\"/contents/\"]')).filter(function(a){"
            + "var h=a.getAttribute('href')||'';if(bad.test(h))return false;if(a.closest('header,nav,footer,[role=navigation],[class*=header],[class*=footer],[class*=menu]'))return false;"
            + "return (a.textContent||'').trim().length>3;});"
            + "var seen={},items=[];"
            + "links.forEach(function(a){var u;try{u=new URL(a.getAttribute('href'),location.href);}catch(e){return;}"
            + "var key=u.pathname;if(seen[key])return;seen[key]=1;u.hash='';"
            + "var box=a.closest('li,article,[class*=result],[class*=Result]')||a.parentElement;"
            + "var t=(a.textContent||'').replace(/\\s+/g,' ').trim();"
            + "var sn=box?(box.textContent||'').replace(/\\s+/g,' ').replace(t,'').trim():'';if(sn.length>280)sn=sn.slice(0,280)+'…';"
            + "var type=/patient|beyond-the-basics|the-basics/i.test(u.pathname)?'Patient education':/drug-information|drug information/i.test(u.pathname+' '+t)?'Drug information':'Topic';"
            + "if(items.length<30)items.push({title:t,url:u.href,snippet:sn,type:type});});"
            + "if(items.length)return JSON.stringify({state:'results',items:items,count:items.length});"
            + "var txt=(document.body&&document.body.innerText)||'';"
            + "if(document.readyState==='complete'&&/no results|did not match|0 results/i.test(txt))return JSON.stringify({state:'empty',items:[]});"
            + "return JSON.stringify({state:'waiting'});"
            + "})()";

    /** The topic's article text, reduced to simple markup the app can restyle. */
    static final String TOPIC_SCRIPT = "(function(){"
            + "if(document.querySelector('input[type=password]'))return JSON.stringify({state:'login'});"
            + "var cands=[].slice.call(document.querySelectorAll('#topicText,#topicContent,[id*=topicText],[class*=topicText],[class*=topic-text],[class*=topicContent],article,main,[role=main]'));"
            + "var root=null,best=0;cands.forEach(function(c){var n=(c.innerText||'').length;if(n>best){best=n;root=c;}});"
            + "if(!root||best<150)return JSON.stringify({state:'waiting'});"
            + "var keep={H1:'h2',H2:'h2',H3:'h3',H4:'h4',H5:'h4',P:'p',UL:'ul',OL:'ol',LI:'li',TABLE:'table',THEAD:'thead',TBODY:'tbody',TR:'tr',TH:'th',TD:'td',B:'b',STRONG:'b',I:'i',EM:'i',SUP:'sup',SUB:'sub',BR:'br',A:'a',IMG:'img',DIV:'div',SPAN:'span',BLOCKQUOTE:'blockquote',DL:'dl',DT:'dt',DD:'dd'};"
            + "var drop=/^(SCRIPT|STYLE|NOSCRIPT|BUTTON|INPUT|SELECT|TEXTAREA|FORM|NAV|HEADER|FOOTER|SVG|IFRAME|CANVAS|VIDEO|AUDIO)$/;"
            + "function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}"
            + "function walk(n){if(n.nodeType===3)return esc(n.nodeValue);if(n.nodeType!==1)return '';"
            + "if(drop.test(n.tagName.toUpperCase()))return '';var st=getComputedStyle(n);if(st.display==='none'||st.visibility==='hidden')return '';"
            + "var inner='';for(var c=n.firstChild;c;c=c.nextSibling)inner+=walk(c);"
            + "var tag=keep[n.tagName];if(!tag)return inner;"
            + "if(tag==='img'){var src=n.currentSrc||n.getAttribute('src')||n.getAttribute('data-src')||'';if(!src)return '';try{src=new URL(src,location.href).href;}catch(e){return '';}return '<img src=\"'+esc(src)+'\">';}"
            + "if(tag==='a'){var h=n.getAttribute('href')||'';var u;try{u=new URL(h,location.href);}catch(e){return inner;}"
            + "if(/uptodate\\.com$/.test(u.hostname)&&/\\/contents\\//.test(u.pathname)){u.hash=/image/i.test(u.pathname)?'':u.hash;return '<a data-utd=\"'+esc(u.href)+'\">'+inner+'</a>';}return inner;}"
            + "if(tag==='div'||tag==='span'){if(tag==='div'&&/block|flex|list-item/.test(st.display))return '<p>'+inner+'</p>';return inner;}"
            + "if(tag==='br')return '<br>';"
            + "var attrs='';if(tag==='td'||tag==='th'){['colspan','rowspan'].forEach(function(k){var v=n.getAttribute(k);if(v)attrs+=' '+k+'=\"'+(parseInt(v,10)||1)+'\"';});}"
            + "return '<'+tag+attrs+'>'+inner+'</'+tag+'>';}"
            + "var html=walk(root).replace(/<p>\\s*<\\/p>/g,'').replace(/<p>(\\s*<p>)+/g,'<p>').replace(/(<\\/p>\\s*)+<\\/p>/g,'</p>');"
            + "var h1=document.querySelector('h1');"
            + "var title=(h1&&h1.innerText||document.title||'').replace(/\\s*-\\s*UpToDate\\s*$/i,'').trim();"
            + "return JSON.stringify({state:'ok',title:title,html:html,url:location.href.split('#')[0]});"
            + "})()";
}
