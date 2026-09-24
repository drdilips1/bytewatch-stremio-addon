package org.research4life.portal;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.MutableContextWrapper;
import android.content.SharedPreferences;
import android.net.Uri;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Research4Life session state shared across screens: one long-lived WebView (so the portal's
 * in-page sign-in survives leaving and re-opening the browser) and the user's saved
 * credentials, encrypted with a key held in the Android Keystore.
 */
final class R4LSession {

    static final String PORTAL_URL = "https://portal.research4life.org/signin";
    static final String PROXY_PREFIX = "https://login.research4life.org/tacsgr1";

    private static final String KEY_ALIAS = "dermscholar_r4l";
    private static final String PREFS = "r4l";

    private static WebView webView;
    private static MutableContextWrapper contextWrapper;

    private R4LSession() {}

    // ------------------------------------------------------------------ shared WebView

    @SuppressLint("SetJavaScriptEnabled")
    static WebView obtain(Context activity) {
        if (webView == null) {
            contextWrapper = new MutableContextWrapper(activity);
            webView = new WebView(contextWrapper);
            WebSettings s = webView.getSettings();
            s.setJavaScriptEnabled(true);
            s.setDomStorageEnabled(true);
            s.setDatabaseEnabled(true);
            s.setLoadWithOverviewMode(true);
            s.setUseWideViewPort(true);
            s.setBuiltInZoomControls(true);
            s.setDisplayZoomControls(false);
            s.setSupportMultipleWindows(false);
            s.setJavaScriptCanOpenWindowsAutomatically(true);
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
            CookieManager cm = CookieManager.getInstance();
            cm.setAcceptCookie(true);
            cm.setAcceptThirdPartyCookies(webView, true);
            webView.addJavascriptInterface(new CredentialBridge(activity.getApplicationContext()), "DSR4L");
        } else {
            contextWrapper.setBaseContext(activity);
        }
        if (webView.getParent() instanceof ViewGroup) {
            ((ViewGroup) webView.getParent()).removeView(webView);
        }
        return webView;
    }

    /** True while the given screen is the one hosting the shared WebView. */
    static boolean isOwner(Context activity) {
        return webView != null && contextWrapper.getBaseContext() == activity;
    }

    /**
     * Detaches the WebView from a closing screen without destroying the session. Does nothing
     * if another screen has already taken the WebView over.
     */
    static void release(Context activity) {
        if (!isOwner(activity)) return;
        if (webView.getParent() instanceof ViewGroup) {
            ((ViewGroup) webView.getParent()).removeView(webView);
        }
        contextWrapper.setBaseContext(activity.getApplicationContext());
        CookieManager.getInstance().flush();
    }

    /** Receives credentials typed into Research4Life's own sign-in form. */
    private static final class CredentialBridge {
        private final Context app;
        private final android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());

        CredentialBridge(Context app) { this.app = app; }

        @android.webkit.JavascriptInterface
        public void credentials(String user, String pass) {
            if (user == null || pass == null || user.trim().isEmpty() || pass.isEmpty()) return;
            main.post(() -> {
                // Only trust calls made while an R4L or UpToDate page is showing.
                String url = webView == null ? null : webView.getUrl();
                if (url == null) return;
                String provider = providerFor(Uri.parse(url));
                if (provider == null) return;
                if (!user.trim().equals(username(app, provider)) || !pass.equals(password(app, provider))) {
                    saveCredentials(app, provider, user, pass);
                    String name = UTD.equals(provider) ? "UpToDate" : "Research4Life";
                    android.widget.Toast.makeText(app, name + " sign-in saved on this phone", android.widget.Toast.LENGTH_SHORT).show();
                }
            });
        }

        @android.webkit.JavascriptInterface
        public void status(String s) {
        }
    }

    // ------------------------------------------------------------------ URLs

    static boolean isR4LHost(String host) {
        return host != null && (host.equals("research4life.org") || host.endsWith(".research4life.org"));
    }

    /** Rewrites a publisher URL to go through the Research4Life access proxy. */
    static String proxied(String url) {
        Uri u = Uri.parse(url);
        String host = u.getHost();
        if (host == null || isR4LHost(host)) return url;
        String path = u.getEncodedPath() == null ? "/" : u.getEncodedPath();
        String query = u.getEncodedQuery() == null ? "" : "?" + u.getEncodedQuery();
        return PROXY_PREFIX + host.replace('.', '_') + path + query;
    }

    static String doiUrl(String doi) {
        return PROXY_PREFIX + "doi_org/" + doi;
    }

    // ------------------------------------------------------------------ credentials

    /** Saved-login providers: Research4Life and UpToDate. */
    static final String R4L = "r4l";
    static final String UTD = "utd";
    static final String UTD_HOME = "https://www.uptodate.com/contents/search";

    private static SharedPreferences prefs(Context ctx, String provider) {
        return ctx.getSharedPreferences(UTD.equals(provider) ? "utd" : PREFS, Context.MODE_PRIVATE);
    }

    static String username(Context ctx) { return username(ctx, R4L); }
    static boolean hasCredentials(Context ctx) { return hasCredentials(ctx, R4L); }
    static void saveCredentials(Context ctx, String user, String password) { saveCredentials(ctx, R4L, user, password); }
    static String password(Context ctx) { return password(ctx, R4L); }
    static void forget(Context ctx) { forget(ctx, R4L); }

    static String username(Context ctx, String provider) {
        return prefs(ctx, provider).getString("user", "");
    }

    static boolean hasCredentials(Context ctx, String provider) {
        return !username(ctx, provider).isEmpty() && prefs(ctx, provider).contains("pass");
    }

    static void saveCredentials(Context ctx, String provider, String user, String password) {
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, key());
            byte[] enc = c.doFinal(password.getBytes(StandardCharsets.UTF_8));
            prefs(ctx, provider).edit()
                    .putString("user", user.trim())
                    .putString("iv", Base64.encodeToString(c.getIV(), Base64.NO_WRAP))
                    .putString("pass", Base64.encodeToString(enc, Base64.NO_WRAP))
                    .apply();
        } catch (Exception ignored) {
            // Keystore unavailable: don't store the password in the clear.
        }
    }

    static String password(Context ctx, String provider) {
        SharedPreferences p = prefs(ctx, provider);
        String iv = p.getString("iv", null);
        String enc = p.getString("pass", null);
        if (iv == null || enc == null) return null;
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
            return new String(c.doFinal(Base64.decode(enc, Base64.NO_WRAP)), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        }
    }

    static void forget(Context ctx, String provider) {
        prefs(ctx, provider).edit().clear().apply();
    }

    /** Which saved login (if any) a page's sign-in form belongs to. */
    static String providerFor(Uri u) {
        String host = u.getHost();
        if (host == null) return null;
        if (isR4LHost(host)) return u.getPath() != null && u.getPath().startsWith("/tacsgr1") ? null : R4L;
        if (host.equals("uptodate.com") || host.endsWith(".uptodate.com") || host.endsWith("wolterskluwer.com")) return UTD;
        return null;
    }

    /** The sign-in helper for the page at {@code url}, with that provider's saved login. */
    static String signInScriptFor(Context ctx, String url, boolean autoSubmit) {
        String provider = url == null ? null : providerFor(Uri.parse(url));
        if (provider == null) return null;
        String pass = hasCredentials(ctx, provider) ? password(ctx, provider) : null;
        return signInScript(username(ctx, provider), pass, autoSubmit);
    }

    private static SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(KEY_ALIAS)) {
            return ((KeyStore.SecretKeyEntry) ks.getEntry(KEY_ALIAS, null)).getSecretKey();
        }
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        kg.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build());
        return kg.generateKey();
    }

    // ------------------------------------------------------------------ injected scripts

    static String jsString(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (char ch : s.toCharArray()) {
            switch (ch) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '<': b.append("\\u003c"); break;
                default:
                    if (ch < 0x20 || ch == 0x2028 || ch == 0x2029) b.append(String.format("\\u%04x", (int) ch));
                    else b.append(ch);
            }
        }
        return b.append('"').toString();
    }

    /**
     * Watches Research4Life pages for a sign-in form. Reports typed credentials to the app
     * and, when credentials are saved, fills and submits the form automatically.
     */
    static String signInScript(String user, String pass, boolean autoSubmit) {
        return "(function(){"
                + "if(window.__dsSignIn)return;window.__dsSignIn=1;"
                + "var U=" + (user == null ? "null" : jsString(user)) + ",P=" + (pass == null ? "null" : jsString(pass)) + ",AUTO=" + autoSubmit + ";"
                + "function vis(e){return e&&e.offsetParent!==null&&!e.disabled;}"
                + "function fields(){var pw=[].slice.call(document.querySelectorAll('input[type=password]')).filter(vis)[0];if(!pw)return null;"
                + "var scope=pw.form||document;var us=[].slice.call(scope.querySelectorAll('input')).filter(function(e){return vis(e)&&/^(text|email|tel|)$/i.test(e.getAttribute('type')||'')&&e!==pw;});"
                + "return {pw:pw,user:us[0]};}"
                + "function report(){var f=fields();if(f&&f.user&&f.user.value&&f.pw.value&&window.DSR4L)DSR4L.credentials(f.user.value,f.pw.value);}"
                + "document.addEventListener('submit',report,true);"
                + "document.addEventListener('click',function(e){if(e.target.closest&&e.target.closest('button,input[type=submit],[role=button]'))report();},true);"
                + "document.addEventListener('keydown',function(e){if(e.key==='Enter')report();},true);"
                + "if(!U||!P)return;"
                + "function set(el,v){var d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d.set.call(el,v);"
                + "el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}"
                + "var tries=0;var t=setInterval(function(){tries++;var f=fields();"
                + "if(f&&(f.user||window.__dsStep1||tries>6)){clearInterval(t);if(f.user)set(f.user,U);set(f.pw,P);if(window.DSR4L)DSR4L.status('signing-in');"
                + "if(!AUTO)return;setTimeout(function(){var form=f.pw.form;"
                + "var btn=(form&&form.querySelector('button[type=submit],input[type=submit],button:not([type])'))"
                + "||[].slice.call(document.querySelectorAll('button,input[type=submit]')).filter(vis).filter(function(b){return /sign\\s*in|log\\s*in|login|submit|continue/i.test(b.textContent||b.value||'');})[0];"
                + "if(btn)btn.click();else if(form){form.requestSubmit?form.requestSubmit():form.submit();}},500);}"
                + "else if(!f&&AUTO&&!window.__dsStep1){var u=[].slice.call(document.querySelectorAll('input[type=email],input[autocomplete=username],input[name*=user i],input[id*=user i],input[name*=email i]')).filter(vis)[0];"
                + "var nb=[].slice.call(document.querySelectorAll('button,input[type=submit]')).filter(vis).filter(function(b){return /continue|next|sign\\s*in|log\\s*in/i.test(b.textContent||b.value||'');})[0];"
                + "if(u&&nb&&!u.value){window.__dsStep1=1;set(u,U);setTimeout(function(){nb.click();},400);}}"
                + "if(tries>40)clearInterval(t);},400);"
                + "})();";
    }

    /** Collects likely PDF links on a publisher page, best first. */
    static final String FIND_PDF_SCRIPT = "(function(){"
            + "function abs(u){try{return new URL(u,location.href).href}catch(e){return null}}"
            + "var out=[];"
            + "[].forEach.call(document.querySelectorAll('meta[name=\"citation_pdf_url\"],meta[name=\"eprints.document_url\"]'),function(m){out.push(m.content);});"
            + "[].forEach.call(document.querySelectorAll('a[href]'),function(a){var h=a.getAttribute('href')||'';"
            + "var t=((a.textContent||'')+' '+(a.getAttribute('aria-label')||'')+' '+(a.title||'')).replace(/\\s+/g,' ');"
            + "if(/^(javascript|mailto):/i.test(h)||h==='#')return;"
            + "if(/\\.pdf(\\?|$)|\\/pdf(ft|direct)?(\\/|\\?|$)|\\/epdf\\/|\\/doi\\/pdf|pdf=render|download=true|\\/pdfft/i.test(h)"
            + "||/\\b(download|view|get|full[- ]?text)\\s*(the\\s*)?(article\\s*)?pdf\\b|^\\s*pdf\\s*$/i.test(t))out.push(h);});"
            + "var seen={},res=[];out.map(abs).forEach(function(u){if(u&&!seen[u]&&!/supplement|suppl_|\\/suppl\\//i.test(u)){seen[u]=1;res.push(u);}});"
            + "return JSON.stringify(res.slice(0,6));"
            + "})()";
}
