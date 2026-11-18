// Audibrisk's shell: three tabs (Home, Library, Downloads), a book page, the player and a quiet
// settings sheet.
import { useEffect, useState } from 'preact/hooks';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { nav } from '../src/lib/nav.js';
import { Toaster, Guard } from '../src/components/common.jsx';
import * as player from '../src/lib/player.js';
import { Home, BookPage, LibraryTab, DownloadsTab } from './screens.jsx';
import { Icon } from '../src/components/icons.jsx';
import { MiniPlayer, FullPlayer } from './player.jsx';
import './update.js';

const ROUTES = { book: BookPage };
const ROOTS = { home: Home, library: LibraryTab, downloads: DownloadsTab };
const TABS = [
  ['home', 'Home', 'home'],
  ['library', 'Library', 'library'],
  ['downloads', 'Downloads', 'download'],
];

export function App() {
  const [route, setRoute] = useState(nav.state());
  const [hasBook, setHasBook] = useState(!!player.getState().book);
  useEffect(() => nav.subscribe(setRoute), []);
  useEffect(() => player.subscribe((s) => setHasBook(!!s.book)), []);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const h = CapApp.addListener('backButton', () => {
      if (!nav.back()) CapApp.minimizeApp();
    });
    return () => h.then((x) => x.remove());
  }, []);
  const top = route.top;
  const Screen = top ? ROUTES[top.name] : ROOTS[route.tab] || Home;
  return (
    <div class={'b-app' + (hasBook ? ' b-has-player' : '') + (top ? '' : ' b-has-tabs')}>
      <main class="b-page" key={top?.key || route.tab}>
        <Guard key={top?.key || route.tab}>{Screen && <Screen {...(top?.params || {})} />}</Guard>
      </main>
      {hasBook && route.overlay !== 'player' && <MiniPlayer />}
      {!top && (
        <nav class="b-tabs">
          {TABS.map(([k, label, icon]) => (
            <button class={route.tab === k ? 'on' : ''} onClick={() => nav.tab(k)}>
              <Icon name={icon} size={23} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      )}
      {route.overlay === 'player' && <FullPlayer />}
      <Toaster />
    </div>
  );
}
