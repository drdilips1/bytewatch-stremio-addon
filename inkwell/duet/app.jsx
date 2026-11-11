// Duet's shell: Library, Read-along and Settings; the book page, the reader and the player — on
// a soft glow taken from the book you're listening to.
import { useEffect, useState } from 'preact/hooks';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { nav } from '../src/lib/nav.js';
import { Toaster, Guard } from '../src/components/common.jsx';
import { Icon } from '../src/components/icons.jsx';
import { Reader } from '../src/screens/Reader.jsx';
import { useStore } from '../src/lib/store.js';
import * as player from '../src/lib/player.js';
import { useCoverColor } from '../src/components/player-ui.jsx';
import { Home, Library, BookPage, SettingsPage, GroupPage, ReadAlongPage, Welcome, welcomeDone } from './screens.jsx';
import { MiniPlayer, FullPlayer } from './player.jsx';
import { refresh, shelf } from './books.js';
import { applyLook } from './theme.js';

const TABS = [
  ['home', 'Library', 'library'],
  ['library', 'Read-along', 'sparkle'],
  ['settings', 'Settings', 'settings'],
];
const ROOTS = { home: Home, library: ReadAlongPage, settings: SettingsPage };
const ROUTES = { book: BookPage, reader: Reader, group: GroupPage, all: Library };

// The glow behind every screen: the colours of the book that's playing (or Duet's own).
function Glow() {
  const [book, setBook] = useState(player.getState().book);
  useEffect(() => player.subscribe((s) => setBook((b) => (b?.uid === s.book?.uid ? b : s.book))), []);
  const c = useCoverColor(book);
  return <div class="d-glow" aria-hidden="true" style={c ? { '--g1': c } : null} />;
}

export function App() {
  const [route, setRoute] = useState(nav.state());
  const [hasBook, setHasBook] = useState(!!player.getState().book);
  const sh = useStore(shelf);
  const seen = useStore(welcomeDone);
  useEffect(() => applyLook(), []);
  useEffect(() => nav.subscribe(setRoute), []);
  useEffect(() => player.subscribe((s) => setHasBook(!!s.book)), []);
  useEffect(() => {
    refresh();
    const again = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', again);
    return () => document.removeEventListener('visibilitychange', again);
  }, []);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const h = CapApp.addListener('backButton', () => {
      if (!nav.back()) CapApp.minimizeApp();
    });
    return () => h.then((x) => x.remove());
  }, []);

  // The first open: Duet introduces itself until there are books (or you look around first).
  if (!seen && !sh.books.length) return <Welcome />;

  const top = route.top;
  const inReader = top?.name === 'reader';
  const Screen = top ? ROUTES[top.name] : ROOTS[route.tab];
  return (
    <div class={'h-app' + (hasBook && !inReader ? ' h-has-player' : '')}>
      {!inReader && <Glow />}
      <main class={inReader ? '' : 'h-page d-in'} key={top?.key || route.tab}>
        <Guard key={top?.key || route.tab}>{Screen && <Screen {...(top?.params || {})} />}</Guard>
      </main>
      {!inReader && hasBook && route.overlay !== 'player' && <MiniPlayer />}
      {!inReader && (
        <nav class="h-tabs d-tabs">
          {TABS.map(([k, label, icon]) => (
            <button class={route.tab === k && !top ? 'on' : ''} onClick={() => nav.tab(k)}>
              <Icon name={icon} size={21} />
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
