// Audibrisk's shell: one home (search, Continue, Offline), a book page, the player and a quiet
// settings sheet. No tabs.
import { useEffect, useState } from 'preact/hooks';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { nav } from '../src/lib/nav.js';
import { Toaster, Guard } from '../src/components/common.jsx';
import * as player from '../src/lib/player.js';
import { Home, BookPage } from './screens.jsx';
import { MiniPlayer, FullPlayer } from './player.jsx';
import './update.js';

const ROUTES = { book: BookPage };

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
  const Screen = top ? ROUTES[top.name] : Home;
  return (
    <div class={'b-app' + (hasBook ? ' b-has-player' : '')}>
      <main class="b-page" key={top?.key || 'home'}>
        <Guard key={top?.key || 'home'}>{Screen && <Screen {...(top?.params || {})} />}</Guard>
      </main>
      {hasBook && route.overlay !== 'player' && <MiniPlayer />}
      {route.overlay === 'player' && <FullPlayer />}
      <Toaster />
    </div>
  );
}
