package app.inkwell.books;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * In-app updates: downloads the new APK itself (with progress) and opens
 * Android's installer — instead of a browser download that can stall.
 */
@CapacitorPlugin(name = "InkwellUpdate")
public class InkwellUpdatePlugin extends Plugin {

    private volatile boolean busy = false;

    private File apkFile() {
        File dir = new File(getContext().getCacheDir(), "update");
        dir.mkdirs();
        return new File(dir, "kathava-update.apk");
    }

    /** Can this app install APKs yet (Android 8+ asks once per app)? */
    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject r = new JSObject();
        r.put("allowed", Build.VERSION.SDK_INT < 26 || getContext().getPackageManager().canRequestPackageInstalls());
        call.resolve(r);
    }

    /** Open the "Install unknown apps" setting for Kathava. */
    @PluginMethod
    public void allowInstall(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Couldn't open the setting: " + e.getMessage());
        }
    }

    /** Download the APK (events: "progress" {pct, done, total}), then resolve. */
    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("Missing url");
            return;
        }
        if (busy) {
            call.reject("Already downloading");
            return;
        }
        busy = true;
        new Thread(() -> {
            File out = apkFile();
            File part = new File(out.getPath() + ".part");
            try {
                String next = url;
                HttpURLConnection c = null;
                // Follow redirects by hand (GitHub → its file host changes host).
                for (int hop = 0; hop < 6; hop++) {
                    c = (HttpURLConnection) new URL(next).openConnection();
                    c.setInstanceFollowRedirects(false);
                    c.setConnectTimeout(20000);
                    c.setReadTimeout(30000);
                    c.setRequestProperty("User-Agent", "Kathava");
                    int code = c.getResponseCode();
                    if (code >= 300 && code < 400 && c.getHeaderField("Location") != null) {
                        next = new URL(new URL(next), c.getHeaderField("Location")).toString();
                        c.disconnect();
                        continue;
                    }
                    if (code >= 400) throw new Exception("HTTP " + code);
                    break;
                }
                long total = c.getContentLengthLong();
                InputStream in = c.getInputStream();
                FileOutputStream fo = new FileOutputStream(part);
                byte[] buf = new byte[65536];
                long done = 0;
                int n;
                int lastPct = -1;
                while ((n = in.read(buf)) > 0) {
                    fo.write(buf, 0, n);
                    done += n;
                    int pct = total > 0 ? (int) (done * 100 / total) : -1;
                    if (pct != lastPct) {
                        lastPct = pct;
                        JSObject p = new JSObject();
                        p.put("pct", pct);
                        p.put("done", done);
                        p.put("total", total);
                        notifyListeners("progress", p);
                    }
                }
                fo.close();
                in.close();
                if (total > 0 && done < total) throw new Exception("Download was cut short");
                if (out.exists()) out.delete();
                if (!part.renameTo(out)) throw new Exception("Couldn't save the update");
                JSObject r = new JSObject();
                r.put("path", out.getPath());
                r.put("size", done);
                call.resolve(r);
            } catch (Exception e) {
                part.delete();
                call.reject("Update download failed: " + e.getMessage());
            } finally {
                busy = false;
            }
        }).start();
    }

    /** Open Android's installer for the downloaded APK. */
    @PluginMethod
    public void install(PluginCall call) {
        File f = apkFile();
        if (!f.exists()) {
            call.reject("Download the update first");
            return;
        }
        if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
            call.reject("NEEDS_PERMISSION");
            return;
        }
        try {
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Couldn't open the installer: " + e.getMessage());
        }
    }
}
