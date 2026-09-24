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

const TABS = [
  ['home', 'Home', 'home'],
  ['discover', 'Discover', 'search'],
  ['library', 'Library', 'library'],
  ['settings', 'Settings', 'settings'],
];
const ROOTS = { home: Home, discover: Discover, library: Library, settings: Settings };
const ROUTES = { book: Book, browse: Browse, reader: Reader, shelf: Shelf };

export function App() {
  const [route, setRoute] = useState(nav.state());
  const st = useStore(settings);
  const ps = usePlayer();

  useEffect(() => nav.subscribe(setRoute), []);
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
      <main key={top?.key || route.tab} class="page">
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
