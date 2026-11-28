import * as qbit from './sources/qbit.js';
import { Ask } from './screens/Ask.jsx';
import { Stats } from './screens/Stats.jsx';
import { TimeMachine } from './screens/TimeMachine.jsx';
import { Tidy } from './screens/Tidy.jsx';
import { Person } from './screens/Person.jsx';
import { FindBooks } from './screens/FindBooks.jsx';
// A link, a list or a picture shared to the app from another app: Find books in it.
window.addEventListener('inkwell-find', (e) => import('./lib/nav.js').then(({ nav }) => nav.push('find', { ...e.detail, at: Date.now() })));
import { Notes } from './screens/Notes.jsx';
import { Downloads } from './screens/Downloads.jsx';
import { onIncoming } from './sources/local.js';

// An EPUB / PDF opened with (or shared to) Audiohub from another app: straight into the reader.
onIncoming((book, error) => (book ? setTimeout(() => nav.push('reader', { book }), 300) : error && toast(error)));
import { DriveMode, openDrive } from './components/drive-mode.jsx';
import { SceneHost, openScene } from './components/scene-cmd.jsx';
import { useEffect, useRef, useState } from 'preact/hooks';
import { memo } from 'preact/compat';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Capacitor } from '@capacitor/core';
import { nav } from './lib/nav.js';
import { settings, useStore } from './lib/store.js';
import { applyTheme, onThemeApplied } from './lib/theme.js';
import { Icon } from './components/icons.jsx';
import { Toaster, Guard } from './components/common.jsx';
import { StoryShotsSheet } from './components/ss-sheet.jsx';
import { UpdatePrompt } from './components/update.jsx';
import { MiniPlayer, FullPlayer, usePlayerBasics } from './components/player-ui.jsx';
import * as player from './lib/player.js';
import { logError } from './lib/report.js';
import { Home } from './screens/Home.jsx';
import { Discover } from './screens/Discover.jsx';
import { Library } from './screens/Library.jsx';
import { Settings } from './screens/Settings.jsx';
import { Book } from './screens/Book.jsx';
import { Browse } from './screens/Browse.jsx';
import { Reader } from './screens/Reader.jsx';
import { Shelf } from './screens/Shelf.jsx';
import { Podcasts, Podcast } from './screens/Podcasts.jsx';
import { PullToRefresh } from './components/pull-refresh.jsx';
import { clearHttpCache } from './lib/http.js';
import { cloud, hc } from './sources/index.js';
import { toast } from './components/common.jsx';
import { KindleChooser } from './components/kindle-chooser.jsx';
import { WhatsNew } from './components/whats-new.jsx';
import { SharedQuoteSheet, ShareQuoteSheet } from './components/shared-quote.jsx';
import { BookActionsSheet } from './components/book-actions.jsx';
import { parseQuoteLink, openSharedQuote } from './lib/quoteshare.js';
import { swipeTab, keepsSwipe } from './lib/swipetabs.js';

const TABS = [
  ['home', 'Home', 'home'],
  ['discover', 'Discover', 'search'],
  ['podcasts', 'Podcasts', 'podcast'],
  ['library', 'Library', 'library'],
  ['settings', 'Settings', 'settings'],
];
const ROOTS = { home: Home, discover: Discover, podcasts: Podcasts, library: Library, tracker: Settings, settings: Settings }; // tracker: the old tab, now in Settings
// Playback errors go in the problem-report log (Settings → Report a problem).
let lastPlayerError = '';
player.subscribe((s) => {
  if (s.error && s.error !== lastPlayerError) logError('player', `${s.error}${s.book?.title ? ` — “${s.book.title}”` : ''}`);
  lastPlayerError = s.error || '';
});

// App shortcuts (long-press the icon, Google Assistant) and the home-screen widget:
// app.inkwell.books://drive, ://ask, ://scene (Play a scene, listening) and ://drivescene.
function openShortcut(url) {
  // A shared quote (audiohub://q/… or its web link): show it.
  const quote = parseQuoteLink(url);
  if (quote) return setTimeout(() => openSharedQuote(quote), 300);
  const m = /^app\.inkwell\.books:\/\/(drivescene|drive|ask|scene)/.exec(url || '');
  if (!m) return;
  if (m[1] === 'scene') return setTimeout(() => openScene(true), 400);
  setTimeout(() => openDrive(m[1] === 'ask' ? true : m[1] === 'drivescene' ? 'scene' : false), 300);
}
if (Capacitor.isNativePlatform()) {
  CapApp.addListener('appUrlOpen', ({ url }) => openShortcut(url));
  CapApp.getLaunchUrl()
    .then((r) => openShortcut(r?.url))
    .catch(() => {});
}

// New podcast episodes for shows set to download by themselves (on Wi-Fi), soon after opening.
setTimeout(() => import('./lib/podauto.js').then((m) => m.autoDownload()).catch(() => {}), 20000);
// (Keeping inactive cloud books ready — cloud.keepReady — is switched off for now: see player.js REVIVE.)

// A kept-alive tab: redraws only when its own data changes, not on every tab switch.
const KeptTab = memo(function KeptTab({ Root }) {
  return (
    <Guard fallback={(e, retry) => <ScreenError error={e} retry={retry} />}>
      <Root />
    </Guard>
  );
});

const ROUTES = { book: Book, browse: Browse, reader: Reader, shelf: Shelf, podcast: Podcast, ask: Ask, stats: Stats, timemachine: TimeMachine, notes: Notes, downloads: Downloads, tidy: Tidy, person: Person, find: FindBooks };

export function App() {
  const [route, setRoute] = useState(nav.state());
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => {
    clearHttpCache();
    cloud.forget();
    hc.resetCache();
    setRefreshKey((k) => k + 1);
    toast('Refreshed');
  };
  const st = useStore(settings);
  // Only whether a book is loaded: not every second of playback (that redrew the whole screen).
  const ps = usePlayerBasics();
  // Tabs you've opened stay alive (hidden) so switching back is instant.
  const visited = useRef(new Set());
  visited.current.add(route.tab);

  useEffect(() => nav.subscribe(setRoute), []);
  useEffect(() => {
    // Hand new cloud audiobooks to the home server, if that's switched on.
    const go = () => qbit.autoForward().then((msg) => msg && toast(msg));
    const t = setTimeout(go, 4000);
    const onResume = () => document.visibilityState === 'visible' && go();
    document.addEventListener('visibilitychange', onResume);
    // Also every 5 minutes while the app is open (auto-send runs at most every 3).
    const iv = setInterval(() => document.visibilityState === 'visible' && go(), 5 * 60e3);
    return () => (clearTimeout(t), clearInterval(iv), document.removeEventListener('visibilitychange', onResume));
  }, []);
  useEffect(() => {
    if (Capacitor.isNativePlatform()) onThemeApplied((light) => StatusBar.setStyle({ style: light ? Style.Light : Style.Dark }).catch(() => {}));
    applyTheme(st);
  }, [st.mode, st.accent, st.palette, st.paletteLight, st.paletteDark, st.finish]);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const h = CapApp.addListener('backButton', () => {
      if (!nav.back()) CapApp.minimizeApp();
    });
    return () => h.then((x) => x.remove());
  }, []);

  // Swipe left / right on a tab's own screen to move between the tabs.
  const swipe = useRef(null);
  const routeNow = useRef(route);
  useEffect(() => {
    const start = (e) => {
      const t = e.touches?.[0];
      swipe.current = null;
      if (!t || e.touches.length > 1 || document.querySelector('.sheet-backdrop, .full-player')) return;
      if (keepsSwipe(e.target, t.clientX, window.innerWidth)) return;
      swipe.current = { x: t.clientX, y: t.clientY, at: Date.now(), lx: t.clientX, ly: t.clientY };
    };
    // Where the finger is now: Android's web view can cancel the touch (not end it) once it
    // decides the move is its own, and a cancel carries no position.
    const move = (e) => {
      const t = e.touches?.[0];
      if (swipe.current && t) (swipe.current.lx = t.clientX), (swipe.current.ly = t.clientY);
    };
    const end = (e) => {
      const s0 = swipe.current;
      swipe.current = null;
      const c = e.changedTouches?.[0];
      const t = c && e.type === 'touchend' ? c : s0 && { clientX: s0.lx, clientY: s0.ly };
      if (!s0 || !t) return;
      const tabs = TABS.map(([k]) => k).filter((k) => k !== 'podcasts' || settings.get().podcastsTab !== false);
      const cur = routeNow.current;
      if (cur.top || cur.overlay) return;
      const to = swipeTab(tabs, cur.tab, t.clientX - s0.x, t.clientY - s0.y, Date.now() - s0.at);
      if (to) nav.tab(to);
    };
    const opts = { passive: true };
    document.addEventListener('touchstart', start, opts);
    document.addEventListener('touchmove', move, opts);
    document.addEventListener('touchend', end, opts);
    document.addEventListener('touchcancel', end, opts);
    return () => {
      document.removeEventListener('touchstart', start);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', end);
      document.removeEventListener('touchcancel', end);
    };
  }, []);
  routeNow.current = route;

  const top = route.top;
  const Screen = top ? ROUTES[top.name] : ROOTS[route.tab];
  const inReader = top?.name === 'reader';

  return (
    <div class={'app' + (ps.book ? ' has-player' : '')}>
      <div class="ambient" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <PullToRefresh onRefresh={refresh} enabled={!route.overlay && (!top || top.name === 'shelf' || top.name === 'book' || top.name === 'browse')} />
      {[...visited.current].map((k) => {
        const Root = ROOTS[k];
        const shown = !top && k === route.tab;
        return (
          <main key={k + ':' + refreshKey} class="page" style={shown ? null : { display: 'none' }}>
            <KeptTab Root={Root} />
          </main>
        );
      })}
      {top && (
        <main key={top.key + ':' + refreshKey} class="page">
          <Guard key={top.key + ':' + refreshKey} fallback={(e, retry) => <ScreenError error={e} retry={retry} />}>
            <Screen {...(top.params || {})} />
          </Guard>
        </main>
      )}
      {!inReader && (
        <>
          <MiniPlayer />
          <nav class="tabbar">
            {TABS.filter(([k]) => k !== 'podcasts' || st.podcastsTab !== false).map(([k, label, icon]) => (
              <button class={route.tab === k ? 'on' : ''} onClick={() => nav.tab(k)}>
                <Icon name={icon} size={22} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </>
      )}
      {route.overlay === 'player' && <FullPlayer />}
      {route.overlay === 'drive' && <DriveMode />}
      <SceneHost />
      <UpdatePrompt />
      <StoryShotsSheet />
      <KindleChooser />
      <WhatsNew />
      <SharedQuoteSheet />
      <ShareQuoteSheet />
      <BookActionsSheet />
      <Toaster />
    </div>
  );
}

/** Shown instead of a screen that failed, with the error so it can be reported. */
function ScreenError({ error, retry }) {
  const text = `${error?.message || error}\n${String(error?.stack || '').split('\n').slice(0, 6).join('\n')}`;
  return (
    <div class="screen screen-error">
      <h2>This screen hit a problem</h2>
      <p class="muted">The rest of the app still works. Please send this to the developer:</p>
      <pre>{text}</pre>
      <div class="chips">
        <button class="pill" onClick={() => navigator.clipboard?.writeText(text).then(() => toast('Copied'), () => toast('Long-press the text to copy'))}>
          Copy
        </button>
        <button class="pill ghost" onClick={retry}>
          Try again
        </button>
      </div>
    </div>
  );
}
