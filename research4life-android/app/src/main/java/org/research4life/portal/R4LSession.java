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
                // Only trust calls made while an R4L page (not proxied publisher content) is showing.
                String url = webView == null ? null : webView.getUrl();
                if (url == null) return;
                Uri u = Uri.parse(url);
                if (!isR4LHost(u.getHost()) || (u.getPath() != null && u.getPath().startsWith("/tacsgr1"))) return;
                if (!user.trim().equals(username(app)) || !pass.equals(password(app))) {
                    saveCredentials(app, user, pass);
                    android.widget.Toast.makeText(app, "Research4Life sign-in saved on this phone", android.widget.Toast.LENGTH_SHORT).show();
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

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static String username(Context ctx) {
        return prefs(ctx).getString("user", "");
    }

    static boolean hasCredentials(Context ctx) {
        return !username(ctx).isEmpty() && prefs(ctx).contains("pass");
    }

    static void saveCredentials(Context ctx, String user, String password) {
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, key());
            byte[] enc = c.doFinal(password.getBytes(StandardCharsets.UTF_8));
            prefs(ctx).edit()
                    .putString("user", user.trim())
                    .putString("iv", Base64.encodeToString(c.getIV(), Base64.NO_WRAP))
                    .putString("pass", Base64.encodeToString(enc, Base64.NO_WRAP))
                    .apply();
        } catch (Exception ignored) {
            // Keystore unavailable: don't store the password in the clear.
        }
    }

    static String password(Context ctx) {
        SharedPreferences p = prefs(ctx);
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

    static void forget(Context ctx) {
        prefs(ctx).edit().clear().apply();
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
                + "if(f&&f.user){clearInterval(t);set(f.user,U);set(f.pw,P);if(window.DSR4L)DSR4L.status('signing-in');"
                + "if(!AUTO)return;setTimeout(function(){var form=f.pw.form;"
                + "var btn=(form&&form.querySelector('button[type=submit],input[type=submit],button:not([type])'))"
                + "||[].slice.call(document.querySelectorAll('button,input[type=submit]')).filter(vis).filter(function(b){return /sign\\s*in|log\\s*in|login|submit|continue/i.test(b.textContent||b.value||'');})[0];"
                + "if(btn)btn.click();else if(form){form.requestSubmit?form.requestSubmit():form.submit();}},500);}"
                + "else if(tries>40)clearInterval(t);},400);"
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
