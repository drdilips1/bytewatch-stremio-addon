package app.inkwell.books;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONObject;

/**
 * TorBox for the car with the app closed: a part's address is torbox://kind/param/id/fileId,
 * turned into a fresh download link right when the player opens it (links expire, these don't).
 * Your TorBox key is handed over by the app and kept in the app's private storage.
 */
final class CarTorbox {
    private static final String PREFS = "inkwell_car_torbox";
    private static final Map<String, String[]> links = new HashMap<>(); // uri -> { link, time }
    private static final long KEEP_MS = 2L * 3600 * 1000;

    private CarTorbox() {}

    static void saveKey(Context c, String key) {
        SharedPreferences p = c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        p.edit().putString("key", key == null ? "" : key.trim()).apply();
        synchronized (links) {
            links.clear();
        }
    }

    static String key(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("key", "");
    }

    static boolean connected(Context c) {
        return !key(c).isEmpty();
    }

    /** torbox://kind/param/id/fileId for a part of a recipe from the app. */
    static String uriOf(JSONObject tb) {
        return "torbox://" + tb.optString("kind") + "/" + tb.optString("param") + "/" + tb.optString("id") + "/" + tb.opt("fileId");
    }

    /** The fresh download link for a torbox:// address (blocking: the player's loading thread). */
    static Uri resolve(Context c, Uri u) throws java.io.IOException {
        String k = u.toString();
        synchronized (links) {
            String[] hit = links.get(k);
            if (hit != null && System.currentTimeMillis() - Long.parseLong(hit[1]) < KEEP_MS) return Uri.parse(hit[0]);
        }
        String kind = u.getHost();
        java.util.List<String> seg = u.getPathSegments();
        if (kind == null || seg.size() < 3) throw new java.io.IOException("Bad TorBox address");
        String api = "https://api.torbox.app/v1/api/" + kind + "/requestdl?token=" + Uri.encode(key(c)) + "&" + Uri.encode(seg.get(0)) + "=" + Uri.encode(seg.get(1)) + "&file_id=" + Uri.encode(seg.get(2)) + "&redirect=false";
        HttpURLConnection con = (HttpURLConnection) new URL(api).openConnection();
        con.setConnectTimeout(15000);
        con.setReadTimeout(20000);
        con.setRequestProperty("User-Agent", "Inkwell/1.2 (Android)");
        int code = con.getResponseCode();
        StringBuilder sb = new StringBuilder();
        try (BufferedReader r = new BufferedReader(new InputStreamReader(code >= 400 ? con.getErrorStream() : con.getInputStream()))) {
            String line;
            while ((line = r.readLine()) != null) sb.append(line);
        } finally {
            con.disconnect();
        }
        String link;
        try {
            JSONObject o = new JSONObject(sb.toString());
            link = o.optString("data", "");
            if (link.isEmpty()) throw new java.io.IOException("TorBox: " + o.optString("detail", "no link (HTTP " + code + ")"));
        } catch (org.json.JSONException e) {
            throw new java.io.IOException("TorBox answered HTTP " + code);
        }
        synchronized (links) {
            links.put(k, new String[] { link, String.valueOf(System.currentTimeMillis()) });
        }
        return Uri.parse(link);
    }
}
