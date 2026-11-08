package app.inkwell.books;

import android.content.Context;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.annotation.OptIn;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.session.LibraryResult;
import androidx.media3.session.MediaLibraryService;
import androidx.media3.session.MediaSession;
import com.google.common.collect.ImmutableList;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.common.util.concurrent.SettableFuture;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Android Auto: what the car shows and plays.
 *
 * Lists: Now playing (the loaded book, part by part), Continue listening, Recently played and
 * Downloaded. Tap a book, say "play … on Audiohub", or search in the car, and it plays where
 * you left off.
 *
 * How a book starts: with the app running, the app prepares it (as when you tap Play on the
 * phone — streaming links, your place, chapters). With the app closed, a downloaded book plays
 * straight from its files on the phone; a streaming one asks you to open the app once.
 */
@OptIn(markerClass = UnstableApi.class)
public class CarLibrary implements MediaLibraryService.MediaLibrarySession.Callback {

    private static final String ROOT = "root";
    private static final String NOW = "now";
    private static final String PART = "part:";
    private static final String BOOK = "book:";
    private static final String[][] SHELVES = { { "continue", "Continue listening" }, { "recent", "Recently played" }, { "downloaded", "Downloaded" } };

    private final Context context;

    // A book the app is preparing for the car: completed when it has loaded (see loaded()).
    @Nullable
    private static SettableFuture<MediaSession.MediaItemsWithStartPosition> pending;
    // Which book that is (null: a spoken search — whatever the app starts).
    @Nullable
    private static String pendingId = null;
    // The session will set the items it gets back from that: the app already did — skip it.
    // Only for a few seconds: a stale flag would swallow the next pick (a part tapped in the car).
    private static long skipUntil = 0;
    static boolean takeSkip() {
        boolean skip = System.currentTimeMillis() < skipUntil;
        skipUntil = 0;
        return skip;
    }
    private static void skipNext() {
        skipUntil = System.currentTimeMillis() + 5000;
    }
    // A book playing from the car without the app (its id, for saving the place it reaches).
    @Nullable
    static String carBook = null;
    // Saved stream links start at the part you were on: add this to the player's part number.
    static int carTrackOffset = 0;

    CarLibrary(Context context) {
        this.context = context.getApplicationContext();
    }

    // ------------------------------------------------------------------ items

    private static MediaItem folder(String id, String title) {
        return new MediaItem.Builder()
            .setMediaId(id)
            .setMediaMetadata(new MediaMetadata.Builder().setTitle(title).setIsBrowsable(true).setIsPlayable(false).setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_AUDIO_BOOKS).build())
            .build();
    }

    private static MediaItem bookItem(JSONObject o) {
        MediaMetadata.Builder m = new MediaMetadata.Builder()
            .setTitle(o.optString("title", "Audiobook"))
            .setArtist(o.optString("author", ""))
            .setIsBrowsable(false)
            .setIsPlayable(true)
            .setMediaType(MediaMetadata.MEDIA_TYPE_AUDIO_BOOK);
        String art = o.optString("artwork", "");
        if (art.startsWith("http")) m.setArtworkUri(Uri.parse(art));
        return new MediaItem.Builder().setMediaId(BOOK + o.optString("id")).setMediaMetadata(m.build()).build();
    }

    /** The parts loaded in the player, as items the car can list. */
    private static List<MediaItem> parts(Player p) {
        List<MediaItem> out = new ArrayList<>();
        for (int i = 0; i < p.getMediaItemCount(); i++) {
            MediaMetadata m = p.getMediaItemAt(i).mediaMetadata;
            CharSequence title = m.title != null && m.title.length() > 0 ? m.title : "Part " + (i + 1);
            out.add(new MediaItem.Builder()
                .setMediaId(PART + i)
                .setMediaMetadata(m.buildUpon().setTitle(title).setIsBrowsable(false).setIsPlayable(true).setMediaType(MediaMetadata.MEDIA_TYPE_AUDIO_BOOK_CHAPTER).build())
                .build());
        }
        return out;
    }

    private List<MediaItem> shelf(String name) {
        List<MediaItem> out = new ArrayList<>();
        JSONArray a = CarCatalog.list(context, name);
        for (int i = 0; i < a.length() && out.size() < 30; i++) {
            JSONObject o = a.optJSONObject(i);
            if (o != null && !o.optString("id").isEmpty()) out.add(bookItem(o));
        }
        if (out.isEmpty()) {
            String empty = name.equals("downloaded") ? "No downloaded books yet" : "Books you play show here";
            out.add(new MediaItem.Builder()
                .setMediaId("empty:" + name)
                .setMediaMetadata(new MediaMetadata.Builder().setTitle(empty).setIsBrowsable(false).setIsPlayable(false).build())
                .build());
        }
        return out;
    }

    private List<MediaItem> root(Player p) {
        List<MediaItem> out = new ArrayList<>();
        if (p.getMediaItemCount() > 0) out.add(folder(NOW, "Now playing"));
        for (String[] s : SHELVES) out.add(folder(s[0], s[1]));
        return out;
    }

    // ---------------------------------------------------------------- browse

    @NonNull
    @Override
    public ListenableFuture<LibraryResult<MediaItem>> onGetLibraryRoot(@NonNull MediaLibraryService.MediaLibrarySession session, @NonNull MediaSession.ControllerInfo browser, @Nullable MediaLibraryService.LibraryParams params) {
        return Futures.immediateFuture(LibraryResult.ofItem(folder(ROOT, "Audiohub"), params));
    }

    @NonNull
    @Override
    public ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> onGetChildren(@NonNull MediaLibraryService.MediaLibrarySession session, @NonNull MediaSession.ControllerInfo browser, @NonNull String parentId, int page, int pageSize, @Nullable MediaLibraryService.LibraryParams params) {
        List<MediaItem> list;
        if (ROOT.equals(parentId)) list = root(session.getPlayer());
        else if (NOW.equals(parentId)) list = parts(session.getPlayer());
        else list = shelf(parentId);
        return Futures.immediateFuture(LibraryResult.ofItemList(list, params));
    }

    @NonNull
    @Override
    public ListenableFuture<LibraryResult<MediaItem>> onGetItem(@NonNull MediaLibraryService.MediaLibrarySession session, @NonNull MediaSession.ControllerInfo browser, @NonNull String mediaId) {
        if (mediaId.startsWith(BOOK)) {
            JSONObject o = CarCatalog.find(context, mediaId.substring(BOOK.length()));
            if (o != null) return Futures.immediateFuture(LibraryResult.ofItem(bookItem(o), null));
        }
        for (MediaItem it : parts(session.getPlayer())) if (it.mediaId.equals(mediaId)) return Futures.immediateFuture(LibraryResult.ofItem(it, null));
        return Futures.immediateFuture(LibraryResult.ofError(LibraryResult.RESULT_ERROR_BAD_VALUE));
    }

    // ---------------------------------------------------------------- search

    @NonNull
    @Override
    public ListenableFuture<LibraryResult<Void>> onSearch(@NonNull MediaLibraryService.MediaLibrarySession session, @NonNull MediaSession.ControllerInfo browser, @NonNull String query, @Nullable MediaLibraryService.LibraryParams params) {
        session.notifySearchResultChanged(browser, query, matches(query).size(), params);
        return Futures.immediateFuture(LibraryResult.ofVoid());
    }

    @NonNull
    @Override
    public ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> onGetSearchResult(@NonNull MediaLibraryService.MediaLibrarySession session, @NonNull MediaSession.ControllerInfo browser, @NonNull String query, int page, int pageSize, @Nullable MediaLibraryService.LibraryParams params) {
        return Futures.immediateFuture(LibraryResult.ofItemList(matches(query), params));
    }

    /** Your books whose title or author has a word of the query. */
    private List<MediaItem> matches(String query) {
        List<MediaItem> out = new ArrayList<>();
        List<String> seen = new ArrayList<>();
        String[] words = String.valueOf(query).toLowerCase().split("[^\\p{L}\\p{N}]+");
        for (String[] s : SHELVES) {
            JSONArray a = CarCatalog.list(context, s[0]);
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.optJSONObject(i);
                if (o == null || seen.contains(o.optString("id"))) continue;
                String hay = (o.optString("title") + " " + o.optString("author")).toLowerCase();
                for (String w : words) {
                    if (w.length() > 1 && hay.contains(w)) {
                        out.add(bookItem(o));
                        seen.add(o.optString("id"));
                        break;
                    }
                }
            }
        }
        return out;
    }

    // ------------------------------------------------------------------ play

    /**
     * The car picked something: a part of the book that's loaded, a book from a list, or a
     * spoken / typed search ("play Atomic Habits on Audiohub").
     */
    @NonNull
    @Override
    public ListenableFuture<MediaSession.MediaItemsWithStartPosition> onSetMediaItems(@NonNull MediaSession session, @NonNull MediaSession.ControllerInfo controller, @NonNull List<MediaItem> mediaItems, int startIndex, long startPositionMs) {
        Player p = session.getPlayer();
        MediaItem want = mediaItems.isEmpty() ? null : mediaItems.get(0);
        String id = want == null ? "" : want.mediaId;
        if (id.startsWith(PART)) return Futures.immediateFuture(samePart(p, id));
        JSONObject book = null;
        if (id.startsWith(BOOK)) book = CarCatalog.find(context, id.substring(BOOK.length()));
        else if (want != null && want.requestMetadata.searchQuery != null) book = CarCatalog.search(context, want.requestMetadata.searchQuery);
        else if (id.isEmpty()) book = CarCatalog.search(context, "");
        // Said in the car and not in the lists: the app (when running) looks wider — your Library.
        if (book == null && want != null && want.requestMetadata.searchQuery != null && InkwellPlayerPlugin.isRunning()) {
            CarCatalog.log(context, "voice in the car: “" + want.requestMetadata.searchQuery + "” — the app is looking in your library");
            ListenableFuture<MediaSession.MediaItemsWithStartPosition> f = waitForApp(want.requestMetadata.searchQuery, null, p);
            InkwellPlayerPlugin.voicePlay(context, want.requestMetadata.searchQuery);
            return f;
        }
        if (book == null) {
            CarCatalog.log(context, "picked something that isn't one of your books (" + (id.isEmpty() && want != null ? "search: " + want.requestMetadata.searchQuery : id) + ")");
            return Futures.immediateFailedFuture(new IllegalArgumentException("Not one of your books"));
        }
        return start(p, book);
    }

    /** "Play" pressed in the car with nothing chosen: the book you were last listening to. */
    @NonNull
    @Override
    public ListenableFuture<MediaSession.MediaItemsWithStartPosition> onPlaybackResumption(@NonNull MediaSession session, @NonNull MediaSession.ControllerInfo controller) {
        Player p = session.getPlayer();
        if (p.getMediaItemCount() > 0) return Futures.immediateFuture(samePart(p, PART + p.getCurrentMediaItemIndex()));
        JSONObject book = CarCatalog.search(context, "");
        if (book == null) return Futures.immediateFailedFuture(new IllegalStateException("Nothing to resume"));
        return start(p, book);
    }

    private static MediaSession.MediaItemsWithStartPosition samePart(Player p, String id) {
        List<MediaItem> loaded = new ArrayList<>();
        for (int i = 0; i < p.getMediaItemCount(); i++) loaded.add(p.getMediaItemAt(i));
        int pick = p.getCurrentMediaItemIndex();
        try {
            pick = Integer.parseInt(id.substring(PART.length()));
        } catch (Exception ignored) {}
        if (pick < 0 || pick >= loaded.size()) pick = Math.max(0, p.getCurrentMediaItemIndex());
        long at = pick == p.getCurrentMediaItemIndex() ? p.getCurrentPosition() : C.TIME_UNSET;
        return new MediaSession.MediaItemsWithStartPosition(loaded, pick, at);
    }

    private ListenableFuture<MediaSession.MediaItemsWithStartPosition> start(Player p, JSONObject book) {
        String id = book.optString("id");
        // The app is running: it prepares the book (links, your place), then we play what it loaded.
        String title = book.optString("title", id);
        // Already the book in the player (most often: the top of Continue listening): just play
        // it from where it is — nothing to prepare.
        if (InkwellPlayerPlugin.isRunning() && id.equals(InkwellPlayerPlugin.currentBookId) && p.getMediaItemCount() > 0) {
            CarCatalog.log(context, "picked “" + title + "” — already loaded, playing");
            skipNext();
            return Futures.immediateFuture(samePart(p, PART + p.getCurrentMediaItemIndex()));
        }
        if (InkwellPlayerPlugin.isRunning()) {
            ListenableFuture<MediaSession.MediaItemsWithStartPosition> f = waitForApp(title, id, p);
            if (InkwellPlayerPlugin.carPlay(id)) {
                CarCatalog.log(context, "picked “" + title + "” — the app is preparing it");
                return f;
            }
            cancelPending();
        }
        // The app is closed: a downloaded book plays from its files on the phone; else from the
        // stream links saved when it last played in the app (they may have expired).
        JSONArray parts = book.optJSONArray("parts");
        boolean saved = false;
        int offset = 0; // the book's part number of the first saved link
        int track0 = book.optInt("track", 0);
        if (parts == null || parts.length() == 0) {
            JSONObject st = book.optJSONObject("stream");
            JSONArray sp = st != null ? st.optJSONArray("parts") : null;
            if (sp != null && sp.length() > 0) {
                parts = new JSONArray();
                int first = -1;
                for (int i = 0; i < sp.length(); i++) {
                    JSONObject x = sp.optJSONObject(i);
                    if (x == null) continue;
                    // From the part you were on, onwards (earlier parts aren't needed to resume).
                    if (x.optInt("i", i) < track0) continue;
                    if (first < 0) first = x.optInt("i", i);
                    parts.put(x);
                }
                if (parts.length() > 0) {
                    saved = true;
                    offset = first;
                    PlaybackService.carHeaders = st.optJSONObject("headers");
                    // Positions count from the first saved part now.
                    track0 = first == book.optInt("track", 0) ? 0 : -1;
                }
            }
        }
        if (parts == null || parts.length() == 0) {
            CarCatalog.log(context, "picked “" + title + "” with the app closed — not downloaded and no saved links yet, so it needs the app once");
            return Futures.immediateFailedFuture(new IllegalStateException("Open Audiohub on your phone once to stream this book"));
        }
        List<MediaItem> items = new ArrayList<>();
        for (int i = 0; i < parts.length(); i++) {
            JSONObject t = parts.optJSONObject(i);
            if (t == null || t.optString("url").isEmpty()) continue;
            MediaMetadata.Builder m = new MediaMetadata.Builder()
                .setTitle(t.optString("title", "Part " + (i + 1)))
                .setArtist(book.optString("author", ""))
                .setAlbumTitle(book.optString("title", ""));
            String art = book.optString("artwork", "");
            if (art.startsWith("http")) m.setArtworkUri(Uri.parse(art));
            items.add(new MediaItem.Builder().setMediaId(PART + i).setUri(t.optString("url")).setMediaMetadata(m.build()).build());
        }
        if (items.isEmpty()) return Futures.immediateFailedFuture(new IllegalStateException("This book's files weren't found"));
        int track = saved ? 0 : Math.max(0, Math.min(items.size() - 1, book.optInt("track", 0)));
        long at = saved && track0 < 0 ? 0 : (long) (book.optDouble("time", 0) * 1000);
        carBook = id;
        carTrackOffset = saved ? offset : 0;
        if (!saved) PlaybackService.carHeaders = null;
        CarCatalog.touch(context, id, book.optInt("track", 0), book.optDouble("time", 0));
        CarCatalog.log(context, "picked “" + title + "” with the app closed — " + (saved ? "playing from its saved stream links (" + items.size() + " parts)" : "playing its downloaded files (" + items.size() + " parts)"));
        return Futures.immediateFuture(new MediaSession.MediaItemsWithStartPosition(items, track, at));
    }

    /**
     * Until the app has started the book (it calls loaded()). A slow start (a torrent being
     * fetched, the phone's screen off for a while) doesn't fail the car: after 40 s it shows
     * what the player has, and the book takes over there as soon as the app has it.
     */
    private ListenableFuture<MediaSession.MediaItemsWithStartPosition> waitForApp(String title, @Nullable String id, Player p) {
        if (pending != null) pending.setException(new IllegalStateException("Another book was picked"));
        SettableFuture<MediaSession.MediaItemsWithStartPosition> f = SettableFuture.create();
        pending = f;
        pendingId = id;
        final long t0 = System.currentTimeMillis();
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            if (pending != f) return;
            pending = null;
            pendingId = null;
            if (p.getMediaItemCount() > 0) {
                CarCatalog.log(context, "“" + title + "” is taking long (" + (System.currentTimeMillis() - t0) / 1000 + " s) — the car shows the player meanwhile");
                skipNext();
                f.set(samePart(p, PART + p.getCurrentMediaItemIndex()));
            } else {
                CarCatalog.log(context, "“" + title + "” didn't start within 40 s");
                f.setException(new IllegalStateException("The book didn't load in time"));
            }
        }, 40000);
        return f;
    }

    private static void cancelPending() {
        SettableFuture<MediaSession.MediaItemsWithStartPosition> f = pending;
        pending = null;
        pendingId = null;
        if (f != null) f.setException(new IllegalStateException("Cancelled"));
    }

    /**
     * The app loaded a book (bookId: which one; null when unknown): if it's the one the car asked
     * for, play exactly that there. Another book loading meanwhile (the app restoring the last
     * one, say) doesn't count.
     */
    static void loaded(Player p, @Nullable String bookId) {
        SettableFuture<MediaSession.MediaItemsWithStartPosition> f = pending;
        if (f == null) return;
        if (pendingId != null && bookId != null && !pendingId.equals(bookId)) return;
        pending = null;
        pendingId = null;
        carBook = null;
        skipNext();
        f.set(samePart(p, PART + p.getCurrentMediaItemIndex()));
    }
}
