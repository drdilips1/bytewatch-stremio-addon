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

    @Override
    public void load() {
        instance = this;
    }

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

    /** A short message that shows over any screen (e.g. while the in-app browser is open). */
    @PluginMethod
    public void toast(PluginCall call) {
        String text = call.getString("text", "");
        getActivity().runOnUiThread(() -> Toast.makeText(getContext(), text, Toast.LENGTH_LONG).show());
        call.resolve();
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
        if (url == null) {
            call.reject("Missing url");
            return;
        }
        new Thread(() -> {
            try {
                String next = url;
                HttpURLConnection c = null;
                for (int hop = 0; hop < 6; hop++) {
                    c = (HttpURLConnection) new URL(next).openConnection();
                    c.setInstanceFollowRedirects(false);
                    c.setConnectTimeout(20000);
                    c.setReadTimeout(60000);
                    c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) Kathava");
                    int code = c.getResponseCode();
                    if (code >= 300 && code < 400 && c.getHeaderField("Location") != null) {
                        next = new URL(new URL(next), c.getHeaderField("Location")).toString();
                        c.disconnect();
                        continue;
                    }
                    if (code >= 400) throw new Exception("HTTP " + code);
                    break;
                }
                File dir = new File(getContext().getCacheDir(), "share");
                dir.mkdirs();
                File f = new File(dir, name);
                InputStream in = c.getInputStream();
                FileOutputStream out = new FileOutputStream(f);
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                out.close();
                in.close();
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType(mime);
                send.putExtra(Intent.EXTRA_STREAM, uri);
                send.putExtra(Intent.EXTRA_SUBJECT, name);
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                Intent chooser = Intent.createChooser(send, title);
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                getActivity().startActivity(chooser);
                call.resolve();
            } catch (Exception e) {
                call.reject("Couldn't get the ebook: " + e.getMessage());
            }
        }).start();
    }
}
