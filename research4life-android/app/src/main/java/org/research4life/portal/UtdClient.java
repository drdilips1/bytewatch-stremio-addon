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

    interface StatusListener {
        void onStatus(String message);
    }

    static final String BASE = "https://www.uptodate.com";
    private static final long POLL_MS = 700;
    private static final long TIMEOUT_MS = 60_000;
    private static final int MAX_LOGINS = 2;

    private final Context app;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final WebView webView;
    private StatusListener status;
    private int token;
    private String kind;          // "search" or "topic"
    private String target;        // URL of the current request
    private String request;       // query or URL, echoed back to the app
    private Callback callback;
    private long started;
    private int logins;
    private boolean returnedToTarget;
    private int continueClicks;
    private long lastProgress;
    private String lastPayload;
    private int stableCount;
    private int lastLength = -1;
    private String topicUrl;       // the topic as linked (print view is tried first)
    private boolean triedFullPage;
    private long stageStarted;
    private long lastReport;
    private final Runnable hardTimeout = () -> {
        if (callback == null) return;
        webView.stopLoading();
        String title = webView.getTitle();
        finish(result("stuck", "UpToDate is taking too long" + (title == null || title.isEmpty() ? "" : " (stopped at “" + title + "”)")
                + ". Tap Show page to see what it needs, or try again."));
    };

    @SuppressLint("SetJavaScriptEnabled")
    UtdClient(Context activity, FrameLayout host) {
        app = activity.getApplicationContext();
        webView = new WebView(activity);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        CookieManager.getInstance().setAcceptCookie(true);
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

    void setStatusListener(StatusListener l) {
        status = l;
    }

    /** Where the background page currently is (for "Show page"). */
    String currentUrl() {
        String u = webView.getUrl();
        return u != null ? u : BASE + "/contents/search";
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
        topicUrl = url;
        triedFullPage = false;
        // The print view is plain text: quicker to load and to read than the full interactive page.
        String path = u.getPath() == null ? "" : u.getPath();
        String print = path.endsWith("/print") ? url : u.buildUpon().path(path.replaceAll("/+$", "") + "/print").build().toString();
        start("topic", print, url, cb);
    }

    private void start(String kind, String url, String request, Callback cb) {
        token++;
        this.kind = kind;
        this.target = url;
        this.request = request;
        this.callback = cb;
        this.started = System.currentTimeMillis();
        this.lastProgress = started;
        this.logins = 0;
        this.returnedToTarget = false;
        this.continueClicks = 0;
        this.lastPayload = null;
        this.stableCount = 0;
        this.lastLength = -1;
        this.stageStarted = started;
        this.lastReport = started;
        report("search".equals(kind) ? "Searching UpToDate…" : "Opening topic…");
        webView.stopLoading();
        webView.loadUrl(url);
        final int t = token;
        main.removeCallbacks(hardTimeout);
        main.postDelayed(hardTimeout, TIMEOUT_MS);
        main.postDelayed(() -> poll(t), 1500);
    }

    /** Falls back from the print view to the full topic page. */
    private void tryFullPage() {
        triedFullPage = true;
        target = topicUrl;
        stageStarted = System.currentTimeMillis();
        lastPayload = null;
        stableCount = 0;
        lastLength = -1;
        report("Loading the full topic page…");
        webView.loadUrl(topicUrl);
    }

    private void report(String message) {
        if (status != null) status.onStatus(message);
    }

    static boolean isLoginUrl(String url) {
        if (url == null) return false;
        Uri u = Uri.parse(url);
        String p = u.getPath() == null ? "" : u.getPath().toLowerCase();
        String h = u.getHost() == null ? "" : u.getHost().toLowerCase();
        return p.matches(".*(login|signin|sign-in|logon|authorize|oauth).*")
                || h.startsWith("login.") || h.startsWith("auth.") || h.startsWith("id.") || h.contains("wolterskluwer");
    }

    /** True when the page is the request we made (UpToDate's home page is also /contents/search). */
    private boolean atTarget(String url) {
        if (url == null) return false;
        Uri u = Uri.parse(url), t = Uri.parse(target);
        if (!String.valueOf(u.getPath()).equals(String.valueOf(t.getPath()))) return false;
        return !"search".equals(kind) || u.getQueryParameter("search") != null;
    }

    private void onPage(String url) {
        if (callback == null || url == null) return;
        if (isLoginUrl(url)) {
            signIn();
            return;
        }
        // Signed in, but UpToDate usually lands on its home page: go back to the request.
        if (logins > 0 && !returnedToTarget && !atTarget(url)) {
            returnedToTarget = true;
            report("search".equals(kind) ? "Signed in. Searching…" : "Signed in. Opening topic…");
            webView.loadUrl(target);
        }
    }

    private void signIn() {
        if (!R4LSession.hasCredentials(app, R4LSession.UTD)) {
            finish(result("login", "Sign in to UpToDate once to see its results here."));
            return;
        }
        if (logins >= MAX_LOGINS) {
            finish(result("login", "UpToDate didn't accept the saved login. Check it in Settings, or tap Show page to sign in once."));
            return;
        }
        logins++;
        lastProgress = System.currentTimeMillis();
        report("Signing in to UpToDate…");
        String js = R4LSession.signInScript(R4LSession.username(app, R4LSession.UTD),
                R4LSession.password(app, R4LSession.UTD), true);
        // A fresh guard each attempt, so a second try on the same page still runs.
        webView.evaluateJavascript("window.__dsSignIn=0;window.__dsStep1=0;" + js, null);
    }

    private void poll(int t) {
        if (t != token || callback == null) return;
        long now = System.currentTimeMillis();
        if ("topic".equals(kind) && !triedFullPage && now - stageStarted > 12_000) {
            tryFullPage();
        }
        if (now - lastReport > 5000) {
            lastReport = now;
            report(("search".equals(kind) ? "Searching UpToDate… " : "Loading topic… ") + ((now - started) / 1000) + "s");
        }
        webView.evaluateJavascript("search".equals(kind) ? SEARCH_SCRIPT : TOPIC_SCRIPT, value -> {
            if (t != token || callback == null) return;
            try {
                String json = new org.json.JSONArray("[" + value + "]").getString(0);
                JSONObject o = new JSONObject(json);
                String state = o.optString("state");
                if ("login".equals(state)) {
                    // A sign-in form on the page (possibly a pop-up, not a /login address).
                    if (System.currentTimeMillis() - lastProgress > 6000 || logins == 0) signIn();
                } else if ("ok".equals(state) && "topic".equals(kind) && !triedFullPage && o.optString("html").length() < 3000) {
                    // Too little for a topic: the print view probably isn't available; wait for the fallback.
                } else if ("results".equals(state) || "ok".equals(state) || "empty".equals(state)) {
                    // Settled once the content stops growing (pages may keep changing in small ways).
                    int len = json.length();
                    if (len <= lastLength || json.equals(lastPayload)) stableCount++;
                    else stableCount = 0;
                    lastLength = Math.max(lastLength, len);
                    lastPayload = json;
                    if (stableCount >= 1 && (logins == 0 || atTarget(webView.getUrl()))) {
                        finish(o);
                        return;
                    }
                } else if (System.currentTimeMillis() - lastProgress > 8000 && continueClicks < 2) {
                    // Nothing recognisable yet: an interstitial ("Continue", "Accept", other session) may be waiting.
                    continueClicks++;
                    lastProgress = System.currentTimeMillis();
                    webView.evaluateJavascript(CONTINUE_SCRIPT, v -> {
                        if (v != null && v.contains("clicked")) report("Continuing past an UpToDate notice…");
                    });
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
        main.removeCallbacks(hardTimeout);
        try {
            o.put("kind", kind);
            o.put("request", request);
            if (!o.has("url")) o.put("url", webView.getUrl());
        } catch (Exception ignored) {
        }
        if (cb != null) cb.onResult(o);
    }

    /** Taps an obvious "continue" style button on an UpToDate notice page. */
    static final String CONTINUE_SCRIPT = "(function(){"
            + "if(document.querySelector('input[type=password]'))return 'login';"
            + "if(!/uptodate|wolterskluwer/i.test(location.hostname))return 'none';"
            + "var b=[].slice.call(document.querySelectorAll('button,a,input[type=submit]')).filter(function(e){return e.offsetParent!==null;})"
            + ".filter(function(e){return /^\\s*(continue|accept|i accept|agree|i agree|proceed|ok|got it|log out other|sign out other|end other session|continue to uptodate)\\b/i.test(e.textContent||e.value||'');})[0];"
            + "if(b){b.click();return 'clicked';}return 'none';"
            + "})()";

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
            + "var cands=[].slice.call(document.querySelectorAll('#topicContent,#topicText,[id*=topicText],[class*=topicText],[class*=topic-text],[class*=topicContent],[class*=print],article,main,[role=main]'));"
            + "var root=null,best=0;cands.forEach(function(c){var n=(c.textContent||'').length;if(n>best){best=n;root=c;}});"
            + "if((!root||best<150)&&document.body&&(document.body.textContent||'').length>600){root=document.body;best=root.textContent.length;}"
            + "if(!root||best<150)return JSON.stringify({state:'waiting'});"
            + "var keep={H1:'h2',H2:'h2',H3:'h3',H4:'h4',H5:'h4',H6:'h4',P:'p',UL:'ul',OL:'ol',LI:'li',TABLE:'table',THEAD:'thead',TBODY:'tbody',TR:'tr',TH:'th',TD:'td',B:'b',STRONG:'b',I:'i',EM:'i',SUP:'sup',SUB:'sub',BR:'br',A:'a',IMG:'img',DIV:'div',SECTION:'div',BLOCKQUOTE:'blockquote',DL:'dl',DT:'dt',DD:'dd'};"
            + "var drop=/^(SCRIPT|STYLE|NOSCRIPT|BUTTON|INPUT|SELECT|TEXTAREA|FORM|NAV|HEADER|FOOTER|SVG|IFRAME|CANVAS|VIDEO|AUDIO|TEMPLATE|DIALOG)$/;"
            + "var out=[],size=0,MAX=1800000;"
            + "function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}"
            + "function walk(n){if(size>MAX)return '';if(n.nodeType===3){size+=n.nodeValue.length;return esc(n.nodeValue);}if(n.nodeType!==1)return '';"
            + "var tn=n.tagName.toUpperCase();if(drop.test(tn))return '';"
            + "if(n.hidden||n.getAttribute('aria-hidden')==='true'||(n.style&&n.style.display==='none'))return '';"
            + "var inner='';for(var c=n.firstChild;c;c=c.nextSibling)inner+=walk(c);"
            + "var tag=keep[tn];if(!tag)return inner;"
            + "if(tag==='img'){var src=n.getAttribute('src')||n.getAttribute('data-src')||'';if(!src||/^data:/.test(src))return '';try{src=new URL(src,location.href).href;}catch(e){return '';}return '<img src=\"'+esc(src)+'\">';}"
            + "if(tag==='a'){var h=n.getAttribute('href')||'';var u;try{u=new URL(h,location.href);}catch(e){return inner;}"
            + "if(/uptodate\\.com$/.test(u.hostname)&&/\\/contents\\//.test(u.pathname)){u.pathname=u.pathname.replace(/\\/print$/,'');return '<a data-utd=\"'+esc(u.href)+'\">'+inner+'</a>';}return inner;}"
            + "if(tag==='div')return inner.trim()?'<p>'+inner+'</p>':'';"
            + "if(tag==='br')return '<br>';"
            + "var attrs='';if(tag==='td'||tag==='th'){['colspan','rowspan'].forEach(function(k){var v=n.getAttribute(k);if(v)attrs+=' '+k+'=\"'+(parseInt(v,10)||1)+'\"';});}"
            + "return '<'+tag+attrs+'>'+inner+'</'+tag+'>';}"
            + "var html=walk(root).replace(/<p>\\s*<\\/p>/g,'');"
            + "var h1=document.querySelector('h1');"
            + "var title=((h1&&h1.textContent)||document.title||'').replace(/\\s*-\\s*UpToDate\\s*$/i,'').replace(/\\s+/g,' ').trim();"
            + "return JSON.stringify({state:'ok',title:title,html:html,url:location.href.split('#')[0].replace(/\\/print(\\?|$)/,'$1')});"
            + "})()";
}
