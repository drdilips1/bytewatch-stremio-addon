import * as qbit from './sources/qbit.js';
import { Tracker } from './screens/Tracker.jsx';
import { useEffect, useState } from 'preact/hooks';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Capacitor } from '@capacitor/core';
import { nav } from './lib/nav.js';
import { settings, useStore } from './lib/store.js';
import { applyTheme } from './lib/theme.js';
import { Icon } from './components/icons.jsx';
import { Toaster } from './components/common.jsx';
import { MiniPlayer, FullPlayer, usePlayer } from './components/player-ui.jsx';
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
import { cloud, hc, gr } from './sources/index.js';
import { toast } from './components/common.jsx';

const TABS = [
  ['home', 'Home', 'home'],
  ['discover', 'Discover', 'search'],
  ['podcasts', 'Podcasts', 'mic'],
  ['library', 'Library', 'library'],
  ['tracker', 'Tracker', 'download'],
  ['settings', 'Settings', 'settings'],
];
const ROOTS = { home: Home, discover: Discover, podcasts: Podcasts, library: Library, tracker: Tracker, settings: Settings };
const ROUTES = { book: Book, browse: Browse, reader: Reader, shelf: Shelf, podcast: Podcast };

export function App() {
  const [route, setRoute] = useState(nav.state());
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => {
    clearHttpCache();
    cloud.forget();
    hc.resetCache();
    if (gr.profileConnected()) gr.syncProfile().catch(() => {});
    setRefreshKey((k) => k + 1);
    toast('Refreshed');
  };
  const st = useStore(settings);
  const ps = usePlayer();

  useEffect(() => nav.subscribe(setRoute), []);
  useEffect(() => {
    // Hand new cloud audiobooks to the home server, if that's switched on.
    const go = () => qbit.autoForward().then((msg) => msg && toast(msg));
    const t = setTimeout(go, 4000);
    const onResume = () => document.visibilityState === 'visible' && go();
    document.addEventListener('visibilitychange', onResume);
    return () => (clearTimeout(t), document.removeEventListener('visibilitychange', onResume));
  }, []);
  useEffect(() => {
    applyTheme(st);
    if (Capacitor.isNativePlatform()) {
      StatusBar.setStyle({ style: st.mode === 'light' ? Style.Light : Style.Dark }).catch(() => {});
    }
  }, [st.mode, st.accent]);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const h = CapApp.addListener('backButton', () => {
      if (!nav.back()) CapApp.minimizeApp();
    });
    return () => h.then((x) => x.remove());
  }, []);

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
      <main key={(top?.key || route.tab) + ':' + refreshKey} class="page">
        <Screen {...(top?.params || {})} />
      </main>
      {!inReader && (
        <>
          <MiniPlayer />
          <nav class="tabbar">
            {TABS.map(([k, label, icon]) => (
              <button class={route.tab === k ? 'on' : ''} onClick={() => nav.tab(k)}>
                <Icon name={icon} size={22} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </>
      )}
      {route.overlay === 'player' && <FullPlayer />}
      <Toaster />
    </div>
  );
}
