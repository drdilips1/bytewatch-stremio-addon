// Hearth's shell: three tabs (Home, Library, Settings), a book page, the reader, and the player.
import { useEffect, useState } from 'preact/hooks';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { nav } from '../src/lib/nav.js';
import { Toaster, Guard } from '../src/components/common.jsx';
import { Icon } from '../src/components/icons.jsx';
import { Reader } from '../src/screens/Reader.jsx';
import * as player from '../src/lib/player.js';
import { Home, Library, BookPage, SettingsPage } from './screens.jsx';
import { MiniPlayer, FullPlayer } from './player.jsx';
import { refresh } from './books.js';
import { applyLook } from './theme.js';

const TABS = [
  ['home', 'Home', 'home'],
  ['library', 'Library', 'library'],
  ['settings', 'Settings', 'settings'],
];
const ROOTS = { home: Home, library: Library, settings: SettingsPage };
const ROUTES = { book: BookPage, reader: Reader };

export function App() {
  const [route, setRoute] = useState(nav.state());
  const [hasBook, setHasBook] = useState(!!player.getState().book);
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

  const top = route.top;
  const inReader = top?.name === 'reader';
  const Screen = top ? ROUTES[top.name] : ROOTS[route.tab];
  return (
    <div class={'h-app' + (hasBook && !inReader ? ' h-has-player' : '')}>
      <main class={inReader ? '' : 'h-page'} key={top?.key || route.tab}>
        <Guard key={top?.key || route.tab}>{Screen && <Screen {...(top?.params || {})} />}</Guard>
      </main>
      {!inReader && hasBook && route.overlay !== 'player' && <MiniPlayer />}
      {!inReader && (
        <nav class="h-tabs">
          {TABS.map(([k, label, icon]) => (
            <button class={route.tab === k && !top ? 'on' : ''} onClick={() => nav.tab(k)}>
              <Icon name={icon} size={22} />
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
