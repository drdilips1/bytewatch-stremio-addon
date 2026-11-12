package app.inkwell.books;

import android.content.Intent;
import android.net.Uri;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Opens a page in the in-app browser (InkwellWebActivity). */
@CapacitorPlugin(name = "InkwellWeb")
public class InkwellWebPlugin extends Plugin {

    private static InkwellWebPlugin instance;

    // Leaving the app: save cookies (a tracker's renewed sign-in) before Android may close it.
    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        try {
            android.webkit.CookieManager.getInstance().flush();
        } catch (Exception ignored) {}
    }

    @Override
    public void load() {
        instance = this;
        try {
            userAgent = android.webkit.WebSettings.getDefaultUserAgent(getContext());
        } catch (Exception ignored) {}
    }

    private static String userAgent = "Mozilla/5.0 (Linux; Android) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Mobile Safari/537.36";

    /** A .torrent or magnet caught in the in-app browser, handed to the app's JavaScript. */
    static void captured(JSObject data) {
        if (instance != null) instance.notifyListeners("captured", data, true);
    }

    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("Missing url");
            return;
        }
        Intent i = new Intent(getContext(), InkwellWebActivity.class);
        i.putExtra("url", url);
        i.putExtra("title", call.getString("title", ""));
        i.putExtra("capture", call.getBoolean("capture", false));
        i.putExtra("books", call.getBoolean("books", false));
        // qBittorrent settings, so captured downloads are sent from the browser screen itself.
        i.putExtra("qbit", call.getString("qbit", ""));
        getActivity().startActivity(i);
        call.resolve();
    }

    /** Hand a link to Android, so an installed app (e.g. Libby) opens it; otherwise the browser does. */
    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("Missing url");
            return;
        }
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("No app can open this link");
        }
    }

    /** Open another app by its package name; its Play Store page if it isn't installed. */
    @PluginMethod
    public void openApp(PluginCall call) {
        String pkg = call.getString("package");
        if (pkg == null || pkg.isEmpty()) {
            call.reject("Missing package");
            return;
        }
        JSObject ret = new JSObject();
        String name = call.getString("name", "");
        try {
            android.content.pm.PackageManager pm = getContext().getPackageManager();
            Intent launch = pm.getLaunchIntentForPackage(pkg);
            // Not under that id: look for an installed app with this name.
            if (launch == null && !name.isEmpty()) {
                Intent main = new Intent(Intent.ACTION_MAIN);
                main.addCategory(Intent.CATEGORY_LAUNCHER);
                for (android.content.pm.ResolveInfo ri : pm.queryIntentActivities(main, 0)) {
                    CharSequence label = ri.loadLabel(pm);
                    if (label != null && label.toString().toLowerCase().contains(name.toLowerCase())
                        && !ri.activityInfo.packageName.equals(getContext().getPackageName())) {
                        launch = new Intent(Intent.ACTION_MAIN);
                        launch.addCategory(Intent.CATEGORY_LAUNCHER);
                        launch.setClassName(ri.activityInfo.packageName, ri.activityInfo.name);
                        ret.put("package", ri.activityInfo.packageName);
                        break;
                    }
                }
            }
            if (launch != null) {
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(launch);
                ret.put("opened", "app");
                call.resolve(ret);
                return;
            }
        } catch (Exception ignored) {
        }
        try {
            Intent store = new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + pkg));
            store.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(store);
            ret.put("opened", "store");
            call.resolve(ret);
        } catch (Exception e) {
            try {
                Intent web = new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=" + pkg));
                web.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(web);
                ret.put("opened", "web");
                call.resolve(ret);
            } catch (Exception e2) {
                call.reject("Couldn't open the app");
            }
        }
    }

    /** A short message that shows over any screen (e.g. while the in-app browser is open). */
    @PluginMethod
    public void toast(PluginCall call) {
        String text = call.getString("text", "");
        getActivity().runOnUiThread(() -> Toast.makeText(getContext(), text, Toast.LENGTH_LONG).show());
        call.resolve();
    }

    /** Share plain text through Android's share sheet (e.g. a problem report into the Claude app). */
    @PluginMethod
    public void shareText(PluginCall call) {
        String text = call.getString("text", "");
        String title = call.getString("title", "Share");
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_TEXT, text);
        send.putExtra(Intent.EXTRA_SUBJECT, call.getString("subject", "Audiohub"));
        Intent chooser = Intent.createChooser(send, title);
        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getActivity().runOnUiThread(() -> {
            try {
                getContext().startActivity(chooser);
                call.resolve();
            } catch (Exception e) {
                call.reject("Could not open the share sheet: " + e.getMessage());
            }
        });
    }

    /**
     * Download a file (e.g. an EPUB) and open Android's share sheet for it —
     * pick Kindle ("Send to Kindle") or email it to your @kindle.com address.
     */
    @PluginMethod
    public void shareFile(PluginCall call) {
        String url = call.getString("url");
        String name = call.getString("name", "book.epub").replaceAll("[\\\\/:*?\"<>|]", " ").trim();
        String mime = call.getString("mime", "application/epub+zip");
        String title = call.getString("title", "Send to Kindle");
        // Optional: your Kindle's e-mail address — opens your e-mail app with the book attached.
        String email = call.getString("email", "");
        if (url == null) {
            call.reject("Missing url");
            return;
        }
        new Thread(() -> {
            try {
                File dir = new File(getContext().getCacheDir(), "share");
                //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
                File f = new File(dir, name);
                //noinspection ResultOfMethodCallIgnored
                f.delete();
                // Same downloader as updates: follows redirects, has timeouts, several connections.
                ParallelDownloader.fetch(url, f, 2, null);
                if (looksLikeWebPage(f)) {
                    //noinspection ResultOfMethodCallIgnored
                    f.delete();
                    throw new Exception("the link gave a web page instead of the ebook file — try opening it in the browser");
                }
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType(mime);
                send.putExtra(Intent.EXTRA_STREAM, uri);
                send.putExtra(Intent.EXTRA_SUBJECT, name);
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                if (email != null && !email.isEmpty()) {
                    // Only e-mail apps, addressed to the Kindle.
                    send.putExtra(Intent.EXTRA_EMAIL, new String[] { email });
                    send.putExtra(Intent.EXTRA_TEXT, "Sent from Audiohub");
                    send.setSelector(new Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:")));
                }
                Intent chooser = Intent.createChooser(send, title);
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                getActivity().runOnUiThread(() -> {
                    try {
                        getActivity().startActivity(chooser);
                        call.resolve();
                    } catch (Throwable t) {
                        call.reject("Couldn't open the share menu: " + t.getMessage());
                    }
                });
            } catch (Throwable e) {
                call.reject("Couldn't get the ebook: " + e.getMessage());
            }
        }).start();
    }

    /**
     * Download a file and e-mail it straight to Kindle addresses through Gmail (an app
     * password, see GmailSender) — no e-mail app or share menu.
     */
    @PluginMethod
    public void mailFile(PluginCall call) {
        String url = call.getString("url");
        String name = call.getString("name", "book.epub").replaceAll("[\\\\/:*?\"<>|]", " ").trim();
        String mime = call.getString("mime", "application/epub+zip");
        String from = call.getString("from", "");
        String password = call.getString("password", "");
        java.util.List<String> to = new java.util.ArrayList<>();
        try {
            com.getcapacitor.JSArray list = call.getArray("to");
            for (int i = 0; list != null && i < list.length(); i++) to.add(list.getString(i));
        } catch (Exception ignored) {
        }
        if (url == null || to.isEmpty() || from.isEmpty() || password.isEmpty()) {
            call.reject("Missing book, Kindle address or Gmail sender");
            return;
        }
        new Thread(() -> {
            File f = null;
            try {
                File dir = new File(getContext().getCacheDir(), "share");
                //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
                f = new File(dir, name);
                //noinspection ResultOfMethodCallIgnored
                f.delete();
                ParallelDownloader.fetch(url, f, 2, null);
                if (looksLikeWebPage(f)) throw new Exception("the link gave a web page instead of the ebook file");
                GmailSender.send(from, password, to, name.replaceAll("\\.[A-Za-z0-9]{2,5}$", ""), f, name, mime);
                call.resolve();
            } catch (Throwable e) {
                call.reject("Couldn't send it: " + e.getMessage());
            } finally {
                //noinspection ResultOfMethodCallIgnored
                if (f != null) f.delete();
            }
        }).start();
    }

    /** Share a picture made in the app (a quote card) with text, through the share sheet. */
    @PluginMethod
    public void shareImage(PluginCall call) {
        String data = call.getString("data");
        String name = call.getString("name", "audiohub-quote.jpg").replaceAll("[\\\\/:*?\"<>|]", " ").trim();
        String text = call.getString("text", "");
        String title = call.getString("title", "Share");
        if (data == null || data.isEmpty()) {
            call.reject("Missing picture");
            return;
        }
        try {
            File dir = new File(getContext().getCacheDir(), "share");
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
            File f = new File(dir, name);
            try (FileOutputStream out = new FileOutputStream(f)) {
                out.write(android.util.Base64.decode(data, android.util.Base64.DEFAULT));
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(call.getString("mime", "image/jpeg"));
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.putExtra(Intent.EXTRA_TEXT, text);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, title);
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().runOnUiThread(() -> {
                try {
                    getActivity().startActivity(chooser);
                    call.resolve();
                } catch (Throwable t) {
                    call.reject("Couldn't open the share menu: " + t.getMessage());
                }
            });
        } catch (Throwable e) {
            call.reject("Couldn't share it: " + e.getMessage());
        }
    }

    /**
     * Your notes and highlights, also kept as small files in the app's own storage: the web
     * storage has a hard limit of about 5 MB for everything, and once it is full new saves
     * fail. These files have no such limit (and go with the app's data, like the rest).
     */
    @PluginMethod
    public void keepWrite(PluginCall call) {
        String name = call.getString("name", "").replaceAll("[^A-Za-z0-9_-]", "");
        String text = call.getString("text");
        if (name.isEmpty() || text == null) {
            call.reject("Missing name or text");
            return;
        }
        try {
            File dir = new File(getContext().getFilesDir(), "keep");
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
            File tmp = new File(dir, name + ".tmp");
            try (FileOutputStream out = new FileOutputStream(tmp)) {
                out.write(text.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            }
            File f = new File(dir, name + ".json");
            if (!tmp.renameTo(f)) {
                //noinspection ResultOfMethodCallIgnored
                f.delete();
                if (!tmp.renameTo(f)) throw new java.io.IOException("rename failed");
            }
            call.resolve();
        } catch (Throwable e) {
            call.reject("Couldn't save: " + e.getMessage());
        }
    }

    @PluginMethod
    public void keepRead(PluginCall call) {
        String name = call.getString("name", "").replaceAll("[^A-Za-z0-9_-]", "");
        JSObject ret = new JSObject();
        File f = new File(new File(getContext().getFilesDir(), "keep"), name + ".json");
        if (name.isEmpty() || !f.exists()) {
            call.resolve(ret);
            return;
        }
        try {
            java.io.ByteArrayOutputStream buf = new java.io.ByteArrayOutputStream();
            try (java.io.FileInputStream in = new java.io.FileInputStream(f)) {
                byte[] b = new byte[16384];
                for (int n; (n = in.read(b)) > 0; ) buf.write(b, 0, n);
            }
            ret.put("text", buf.toString("UTF-8"));
            call.resolve(ret);
        } catch (Throwable e) {
            call.reject("Couldn't read: " + e.getMessage());
        }
    }

    /** Save a file from the web into the phone's Downloads folder (with a notification). */
    @PluginMethod
    public void saveToDownloads(PluginCall call) {
        String url = call.getString("url");
        String name = call.getString("name", "book").replaceAll("[\\\\/:*?\"<>|]", " ").trim();
        if (url == null) {
            call.reject("Missing url");
            return;
        }
        try {
            android.app.DownloadManager dm = (android.app.DownloadManager) getContext().getSystemService(android.content.Context.DOWNLOAD_SERVICE);
            android.app.DownloadManager.Request req = new android.app.DownloadManager.Request(Uri.parse(url));
            req.setTitle(name);
            req.setMimeType(call.getString("mime", "application/octet-stream"));
            req.setNotificationVisibility(android.app.DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            req.setDestinationInExternalPublicDir(android.os.Environment.DIRECTORY_DOWNLOADS, name);
            dm.enqueue(req);
            call.resolve();
        } catch (Throwable e) {
            call.reject("Couldn't save it: " + e.getMessage());
        }
    }

    /** A download that is really an HTML page (login, captcha, error) rather than the file. */
    private static boolean looksLikeWebPage(File f) {
        try (java.io.FileInputStream in = new java.io.FileInputStream(f)) {
            byte[] head = new byte[256];
            int n = in.read(head);
            if (n <= 0) return true;
            String s = new String(head, 0, n, java.nio.charset.StandardCharsets.ISO_8859_1).trim().toLowerCase(java.util.Locale.ROOT);
            return s.startsWith("<!doctype html") || s.startsWith("<html") || s.startsWith("<head");
        } catch (Exception e) {
            return false;
        }
    }

    // ---- Background tracker grab (no browser on screen) -------------------------------
    // Uses the sign-in from the in-app browser (its cookies), so the site sees you as usual.

    private static String siteCookie(String base) {
        try {
            String c = android.webkit.CookieManager.getInstance().getCookie(base);
            return c == null ? "" : c;
        } catch (Exception e) {
            return "";
        }
    }

    /** Keep cookies the site renews (it may rotate its session cookie on every answer). */
    private static void keepCookies(String base, HttpURLConnection c) {
        try {
            java.util.List<String> set = c.getHeaderFields().get("Set-Cookie");
            if (set == null) set = c.getHeaderFields().get("set-cookie");
            if (set == null) return;
            android.webkit.CookieManager cm = android.webkit.CookieManager.getInstance();
            for (String v : set) cm.setCookie(base, v);
            cm.flush();
        } catch (Exception ignored) {}
    }

    private static byte[] readAll(InputStream in) throws java.io.IOException {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        if (in == null) return out.toByteArray();
        byte[] b = new byte[8192];
        int n;
        while ((n = in.read(b)) > 0) out.write(b, 0, n);
        in.close();
        return out.toByteArray();
    }

    /** One request to the site with your cookies: { status, body bytes }. */
    private static Object[] siteRequest(String base, String url, String method, String json) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestMethod(method);
        c.setInstanceFollowRedirects(false);
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        c.setRequestProperty("Cookie", siteCookie(base));
        c.setRequestProperty("User-Agent", userAgent);
        c.setRequestProperty("Referer", base + "/");
        if (json != null) {
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            java.io.OutputStream o = c.getOutputStream();
            o.write(json.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            o.close();
        }
        int code = c.getResponseCode();
        keepCookies(base, c);
        byte[] body = readAll(code >= 400 ? c.getErrorStream() : c.getInputStream());
        return new Object[] { code, body };
    }

    /** Search the tracker's JSON search with your sign-in: resolves { status, text }. */
    @PluginMethod
    public void trackerSearch(PluginCall call) {
        String base = call.getString("base", "").replaceAll("/+$", "");
        String path = call.getString("path", "");
        String body = call.getString("body", null);
        new Thread(() -> {
            try {
                if (siteCookie(base).isEmpty()) {
                    call.reject("signin");
                    return;
                }
                Object[] r = siteRequest(base, base + path, body == null ? "GET" : "POST", body);
                JSObject out = new JSObject();
                out.put("status", (int) r[0]);
                out.put("text", new String((byte[]) r[1], java.nio.charset.StandardCharsets.UTF_8));
                call.resolve(out);
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
            }
        }).start();
    }

    /**
     * Get one .torrent with your sign-in (trying again when the site doesn't hand it over the
     * first time), optionally spending a freeleech wedge on it first, and send it to qBittorrent.
     * Resolves { sent, message, wedge, name, data }.
     */
    @PluginMethod
    public void trackerGrab(PluginCall call) {
        String base = call.getString("base", "").replaceAll("/+$", "");
        String download = call.getString("download", "");
        String wedge = call.getString("wedge", "");
        String name = call.getString("name", "download.torrent");
        String qbit = call.getString("qbit", "");
        boolean ebook = call.getBoolean("ebook", false);
        new Thread(() -> {
            JSObject out = new JSObject();
            try {
                if (siteCookie(base).isEmpty()) {
                    call.reject("signin");
                    return;
                }
                String wedgeNote = "";
                if (!wedge.isEmpty()) {
                    try {
                        Object[] w = siteRequest(base, base + wedge, "GET", null);
                        String t = new String((byte[]) w[1], java.nio.charset.StandardCharsets.UTF_8);
                        boolean ok = (int) w[0] < 400 && t.contains("\"success\":true");
                        wedgeNote = ok ? "used" : t.length() > 160 ? t.substring(0, 160) : t;
                    } catch (Exception e) {
                        wedgeNote = String.valueOf(e.getMessage());
                    }
                }
                out.put("wedge", wedgeNote);
                byte[] torrent = null;
                String why = "";
                for (int attempt = 0; attempt < 4 && torrent == null; attempt++) {
                    if (attempt > 0) Thread.sleep(1500L * attempt);
                    try {
                        Object[] r = siteRequest(base, base + download, "GET", null);
                        byte[] b = (byte[]) r[1];
                        int code = (int) r[0];
                        if (code >= 300 && code < 400) {
                            why = "the site asked to sign in again";
                            continue;
                        }
                        // A real .torrent is a bencoded dictionary: it starts with "d".
                        if (code < 400 && b.length > 40 && b[0] == 'd') torrent = b;
                        else why = "HTTP " + code + (b.length > 0 && b[0] == '<' ? " (a web page, not a .torrent)" : "");
                    } catch (Exception e) {
                        why = String.valueOf(e.getMessage());
                    }
                }
                if (torrent == null) {
                    out.put("sent", false);
                    out.put("message", "Couldn't get the .torrent after 4 tries — " + why);
                    call.resolve(out);
                    return;
                }
                boolean isEbook = ebook || InkwellWebActivity.torrentIsEbook(torrent);
                String result = InkwellWebActivity.sendToQbit(qbit, torrent, null, name, isEbook);
                boolean ok = result.startsWith("OK");
                out.put("sent", ok);
                out.put("message", ok ? result.substring(3) : result);
                out.put("name", name);
                out.put("data", android.util.Base64.encodeToString(torrent, android.util.Base64.NO_WRAP));
                call.resolve(out);
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
            }
        }).start();
    }

    // ---- The tracker through a hidden browser ------------------------------------------
    // Some connections reach the tracker only through the browser's own network stack (the
    // in-app browser loads it while a plain request can't connect). So searches, downloads
    // and wedges go through an invisible WebView on the tracker's site, with your sign-in.
    // One hidden browser per site (MAM, Mobilism, Anna's Archive…): a book page searches them
    // at the same time, and one shared browser hopping between sites cut the others' requests
    // off half-way (they failed or timed out).
    private static final class Ghost {
        android.webkit.WebView view;
        boolean loading = false;
        boolean ready = false;
        final java.util.List<Runnable> waiting = new java.util.ArrayList<>();
    }
    private static final java.util.Map<String, Ghost> ghosts = new java.util.HashMap<>();
    private static final java.util.Map<String, PluginCall> ghostCalls = new java.util.concurrent.ConcurrentHashMap<>();

    private class GhostBridge {
        @android.webkit.JavascriptInterface
        public void done(String id, int status, String text) {
            // The tracker may have renewed your sign-in cookie: save it now, so it isn't lost.
            android.webkit.CookieManager.getInstance().flush();
            PluginCall c = ghostCalls.remove(id);
            if (c == null) return;
            JSObject out = new JSObject();
            out.put("status", status);
            out.put("text", text == null ? "" : text);
            c.resolve(out);
        }

        @android.webkit.JavascriptInterface
        public void fail(String id, String message) {
            PluginCall c = ghostCalls.remove(id);
            if (c != null) c.reject(message == null ? "failed" : message);
        }
    }

    /** On the main thread: [base]'s hidden WebView, sitting on its site, then [then](view). */
    private void withGhost(String base, java.util.function.Consumer<android.webkit.WebView> then) {
        Ghost g = ghosts.get(base);
        if (g == null) {
            g = new Ghost();
            final Ghost me = g;
            g.view = new android.webkit.WebView(getContext());
            android.webkit.WebSettings ws = g.view.getSettings();
            ws.setJavaScriptEnabled(true);
            ws.setDomStorageEnabled(true);
            ws.setBlockNetworkImage(true);
            android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(g.view, true);
            g.view.addJavascriptInterface(new GhostBridge(), "AhGhost");
            // Sites that tie your sign-in to the browser (Mobilism, Anna's Archive: their session and
            // bot check) must see the same browser as the in-app one you signed in with — the same
            // user agent InkwellWebActivity uses. Other sites keep the WebView's own.
            String plain = android.webkit.WebSettings.getDefaultUserAgent(getContext());
            ws.setUserAgentString(base.contains("mobilism.org") || base.contains("annas-archive") ? plain.replace("; wv)", ")").replaceAll("Version/[\\d.]+ ", "") : plain);
            g.view.setWebViewClient(new android.webkit.WebViewClient() {
                @Override
                public void onPageFinished(android.webkit.WebView v, String url) {
                    if (!me.loading) return;
                    me.loading = false;
                    me.ready = true;
                    java.util.List<Runnable> run = new java.util.ArrayList<>(me.waiting);
                    me.waiting.clear();
                    for (Runnable r : run) r.run();
                }
            });
            ghosts.put(base, g);
        }
        final Ghost gh = g;
        if (gh.ready && !gh.loading) {
            then.accept(gh.view);
            return;
        }
        gh.waiting.add(() -> then.accept(gh.view));
        if (gh.loading) return;
        gh.loading = true;
        // A small page on the site, so requests from it carry the site's cookies.
        gh.view.loadUrl(base + "/robots.txt");
    }

    /** A site's hidden browser that never finished loading: start it afresh next time. */
    private static void resetGhost(String base) {
        Ghost g = ghosts.get(base);
        if (g == null) return;
        g.loading = false;
        g.ready = false;
    }

    // ---- A page visited like a person would (not a background request) ----------------------
    // Some sites' bot checks (DDoS-Guard on Anna's Archive) refuse background requests even with
    // your pass, and only let real page visits through. So: a hidden browser navigates to the page,
    // waits for it (and for a check page to solve itself and move on), then hands over the HTML.
    private static final java.util.Map<String, android.webkit.WebView> visitors = new java.util.HashMap<>();
    // One visit at a time per site (they share its hidden page): the rest wait their turn.
    private static final java.util.Map<String, java.util.ArrayDeque<Runnable>> visitQueue = new java.util.HashMap<>();
    private static final java.util.Set<String> visiting = new java.util.HashSet<>();

    private static void visitNext(String site) {
        visiting.remove(site);
        java.util.ArrayDeque<Runnable> q = visitQueue.get(site);
        Runnable next = q == null ? null : q.poll();
        if (next != null) {
            visiting.add(site);
            next.run();
        }
    }
    private static final java.util.regex.Pattern CHECK_PAGE = java.util.regex.Pattern.compile("(?i)ddos-guard|just a moment|checking your browser|challenge-platform|cf-chl|enable javascript and cookies");

    /** { url, timeout } → { status, html, text, title, url, check } (check: still a bot-check page). */
    @PluginMethod
    public void pageVisit(PluginCall call) {
        String url = call.getString("url", "");
        long timeout = call.getInt("timeout", 30000);
        // Optional: keep watching the page until this appears (a download link after a countdown).
        String waitForSrc = call.getString("waitFor", null);
        java.util.regex.Pattern waitFor = null;
        if (waitForSrc != null && !waitForSrc.isEmpty()) {
            try {
                waitFor = java.util.regex.Pattern.compile(waitForSrc);
            } catch (Exception e) {
                call.reject("Bad waitFor pattern");
                return;
            }
        }
        final java.util.regex.Pattern wantSeen = waitFor;
        String key;
        try {
            java.net.URL u = new java.net.URL(url);
            key = u.getProtocol() + "://" + u.getHost();
        } catch (Exception e) {
            call.reject("Bad address");
            return;
        }
        final String site = key;
        android.os.Handler ui = new android.os.Handler(android.os.Looper.getMainLooper());
        Runnable go = () -> {
            android.webkit.WebView v = visitors.get(site);
            if (v == null) {
                v = new android.webkit.WebView(getContext());
                android.webkit.WebSettings ws = v.getSettings();
                ws.setJavaScriptEnabled(true);
                ws.setDomStorageEnabled(true);
                ws.setBlockNetworkImage(true);
                String plain = android.webkit.WebSettings.getDefaultUserAgent(getContext());
                // The same browser as the in-app one (where you passed the check).
                ws.setUserAgentString(plain.replace("; wv)", ")").replaceAll("Version/[\\d.]+ ", ""));
                android.webkit.CookieManager.getInstance().setAcceptCookie(true);
                android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(v, true);
                visitors.put(site, v);
            }
            final android.webkit.WebView view = v;
            final long t0 = System.currentTimeMillis();
            final int[] status = { 200 };
            final boolean[] done = { false };
            final Runnable[] check = new Runnable[1];
            check[0] = () -> {
                if (done[0]) return;
                view.evaluateJavascript("(function(){try{return JSON.stringify({h:document.documentElement.outerHTML,t:document.body?document.body.innerText:'',ti:document.title,u:location.href});}catch(e){return '{}';}})()", value -> {
                    if (done[0]) return;
                    try {
                        org.json.JSONObject o = new org.json.JSONObject(new org.json.JSONTokener(value).nextValue().toString());
                        String html = o.optString("h");
                        boolean isCheck = CHECK_PAGE.matcher(html.length() > 20000 ? html.substring(0, 20000) : html).find() && html.length() < 60000;
                        // A check page solves itself and reloads: wait for the real page (up to the time limit).
                        // Asked to wait for something on the page (waitFor): keep looking until it's there.
                        boolean notYet = wantSeen != null && !wantSeen.matcher(html).find();
                        if ((isCheck || notYet) && System.currentTimeMillis() - t0 < timeout) {
                            ui.postDelayed(check[0], 1500);
                            return;
                        }
                        done[0] = true;
                        visitNext(site);
                        android.webkit.CookieManager.getInstance().flush();
                        JSObject r = new JSObject();
                        r.put("status", status[0]);
                        r.put("html", html);
                        r.put("text", o.optString("t"));
                        r.put("title", o.optString("ti"));
                        r.put("url", o.optString("u"));
                        r.put("check", isCheck);
                        call.resolve(r);
                    } catch (Exception e) {
                        if (System.currentTimeMillis() - t0 < timeout) ui.postDelayed(check[0], 1500);
                        else {
                            done[0] = true;
                            visitNext(site);
                            call.reject("Couldn't read the page");
                        }
                    }
                });
            };
            view.setWebViewClient(new android.webkit.WebViewClient() {
                @Override
                public void onPageStarted(android.webkit.WebView w, String u, android.graphics.Bitmap icon) {
                    status[0] = 200; // a check page reloading into the real one: its own status
                }

                @Override
                public void onPageFinished(android.webkit.WebView w, String u) {
                    ui.postDelayed(check[0], 400);
                }

                @Override
                public void onReceivedHttpError(android.webkit.WebView w, android.webkit.WebResourceRequest req, android.webkit.WebResourceResponse res) {
                    if (req.isForMainFrame()) status[0] = res.getStatusCode();
                }
            });
            view.loadUrl(url);
            ui.postDelayed(() -> {
                if (done[0]) return;
                check[0].run(); // time's up: whatever is there
                ui.postDelayed(() -> {
                    if (!done[0]) {
                        done[0] = true;
                        visitNext(site);
                        call.reject("The page didn't load in time");
                    }
                }, 4000);
            }, timeout + 1000);
        };
        ui.post(() -> {
            if (visiting.contains(site)) {
                visitQueue.computeIfAbsent(site, k -> new java.util.ArrayDeque<>()).add(go);
            } else {
                visiting.add(site);
                go.run();
            }
        });
    }

    /**
     * One request to the tracker from the hidden browser: { status, text } — text is the body,
     * or base64 when binary (a .torrent). A redirect (e.g. to the sign-in page) is status 302,
     * unless `follow` (then it's followed, as for a site that moved to another address).
     */
    @PluginMethod
    public void trackerFetch(PluginCall call) {
        String base = call.getString("base", "").replaceAll("/+$", "");
        String path = call.getString("path", "/");
        String method = call.getString("method", call.getString("body") == null ? "GET" : "POST");
        String body = call.getString("body", null);
        boolean binary = Boolean.TRUE.equals(call.getBoolean("binary", false));
        boolean follow = Boolean.TRUE.equals(call.getBoolean("follow", false));
        String id = java.util.UUID.randomUUID().toString();
        ghostCalls.put(id, call);
        String js = "(async()=>{try{const r=await fetch(" + org.json.JSONObject.quote(path) + ",{method:" + org.json.JSONObject.quote(method)
            + ",credentials:'include',redirect:'" + (follow ? "follow" : "manual") + "'"
            + (body != null ? ",headers:{'Content-Type':'application/json'},body:" + org.json.JSONObject.quote(body) : "")
            + "});const st=r.type==='opaqueredirect'?302:r.status;let out;"
            + (binary
                ? "const b=new Uint8Array(await r.arrayBuffer());let s='';for(let i=0;i<b.length;i+=32768)s+=String.fromCharCode.apply(null,b.subarray(i,i+32768));out=btoa(s);"
                : "out=await r.text();")
            + "AhGhost.done(" + org.json.JSONObject.quote(id) + ",st,out);}catch(e){AhGhost.fail(" + org.json.JSONObject.quote(id) + ",String(e&&e.message||e));}})();";
        android.os.Handler ui = new android.os.Handler(android.os.Looper.getMainLooper());
        ui.post(() -> {
            try {
                withGhost(base, v -> v.evaluateJavascript(js, null));
            } catch (Exception e) {
                PluginCall c = ghostCalls.remove(id);
                if (c != null) c.reject(String.valueOf(e.getMessage()));
            }
        });
        ui.postDelayed(() -> {
            PluginCall c = ghostCalls.remove(id);
            if (c != null) {
                resetGhost(base); // a page that never finished: load it afresh next time
                c.reject("Timed out reaching the tracker");
            }
        }, 45000);
    }

    /** Send a .torrent (base64) to qBittorrent with the app's settings: { sent, message }. */
    @PluginMethod
    public void qbitSend(PluginCall call) {
        String data = call.getString("data", "");
        String name = call.getString("name", "download.torrent");
        String qbit = call.getString("qbit", "");
        boolean ebook = Boolean.TRUE.equals(call.getBoolean("ebook", false));
        new Thread(() -> {
            try {
                byte[] torrent = android.util.Base64.decode(data, android.util.Base64.DEFAULT);
                boolean isEbook = ebook || InkwellWebActivity.torrentIsEbook(torrent);
                String result = InkwellWebActivity.sendToQbit(qbit, torrent, null, name, isEbook);
                JSObject out = new JSObject();
                boolean ok = result.startsWith("OK");
                out.put("sent", ok);
                out.put("message", ok ? result.substring(3) : result);
                call.resolve(out);
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
            }
        }).start();
    }

    /** Put a cookie (e.g. a tracker session you created) where the in-app and hidden browsers use it. */
    @PluginMethod
    public void setSiteCookie(PluginCall call) {
        String url = call.getString("url", "");
        String cookie = call.getString("cookie", "");
        new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> {
            try {
                android.webkit.CookieManager cm = android.webkit.CookieManager.getInstance();
                cm.setCookie(url, cookie);
                cm.flush();
                call.resolve();
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
            }
        });
    }
}
