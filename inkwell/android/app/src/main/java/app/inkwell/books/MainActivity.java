package app.inkwell.books;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(InkwellPlayerPlugin.class);
        registerPlugin(InkwellTtsPlugin.class);
        registerPlugin(InkwellVoicesPlugin.class);
        registerPlugin(InkwellDownloadsPlugin.class);
        registerPlugin(InkwellTranscribePlugin.class);
        registerPlugin(InkwellWebPlugin.class);
        registerPlugin(InkwellUpdatePlugin.class);
        registerPlugin(InkwellReadAloudPlugin.class);
        registerPlugin(InkwellListenPlugin.class);
        registerPlugin(InkwellLocalPlugin.class);
        super.onCreate(savedInstanceState);
        keepAwakeInBackground();
        voice(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        voice(intent);
    }

    /**
     * The app's screen is a web page in its own process, which Android lowers (and can freeze)
     * once it isn't visible. The car (or a voice request) then asks a sleeping app to prepare a
     * book, and nothing happens until the app is opened. Keep that process as important as the
     * app itself — which, while playing or connected to the car, Android keeps running.
     */
    private void keepAwakeInBackground() {
        try {
            if (android.os.Build.VERSION.SDK_INT >= 26 && getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().setRendererPriorityPolicy(android.webkit.WebView.RENDERER_PRIORITY_IMPORTANT, false);
            }
        } catch (Exception ignored) {}
    }

    /**
     * The screen went off (or another app came up) while a book plays or the car is connected:
     * Android hides the app's page and slows it to a crawl, so after a minute or so the car's
     * picks, searches and the app's own steps (the next part, your place) stop being answered.
     * Tell the page it's still shown; Android sends "hidden" a moment after this, hence the
     * second go.
     */
    @Override
    public void onStop() {
        super.onStop();
        android.os.Handler h = new android.os.Handler(android.os.Looper.getMainLooper());
        Runnable keep = () -> {
            if (InkwellPlayerPlugin.wantsAwake()) InkwellPlayerPlugin.wake();
        };
        h.postDelayed(keep, 400);
        h.postDelayed(keep, 2000);
    }

    /** "Play … on Audiohub" from Google Assistant: hand the words to the player. */
    private void voice(Intent intent) {
        if (intent == null || !"android.media.action.MEDIA_PLAY_FROM_SEARCH".equals(intent.getAction())) return;
        String q = intent.getStringExtra(android.app.SearchManager.QUERY);
        InkwellPlayerPlugin.voicePlay(this, q == null ? "" : q);
        intent.setAction(Intent.ACTION_MAIN); // not again on rotation
    }
}
