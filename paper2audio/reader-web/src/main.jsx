// Audiohub's reader, on its own, for Paper to Audio and Narrato: the book comes from the app.
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import './styles.css';
import { Reader } from './screens/Reader.jsx';
import { Toaster } from './components/common.jsx';
import { applyTheme } from './lib/theme.js';
import { nav } from './lib/nav.js';
import { settings, progress, useStore } from './lib/store.js';
import { ttsCfg } from './lib/tts.js';
import { App as Native } from './shims/capacitor.js';
import { gb } from './sources/index.js';

// The phone's Back: what the reader has open closes first, then the reader itself.
window.__p2aBack = () => {
  if (!nav.back()) Native.close().catch(() => {});
};

function Main() {
  const st = useStore(settings);
  const [book, setBook] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => applyTheme(st), [st.mode, st.accent, st.palette, st.paletteLight, st.paletteDark]);
  useEffect(() => {
    gb.loadText()
      .then((b) => {
        // The book's place in the reader: where it was left, or else where it's being listened to.
        setBook({ ...b, at: progress.get()[b.uid] ? null : b.at });
        // The reading speed shown is the app's (the player's speed).
        if (b.rate) ttsCfg.patch({ rate: b.rate });
        nav.push('reader');
      })
      .catch((e) => setError(e.message));
    // Leaving the reader (its back arrow): back to the app.
    return nav.subscribe((s) => !s.top && Native.close().catch(() => {}));
  }, []);
  return (
    <>
      {book ? <Reader book={book} at={book.at} /> : error ? <p class="muted pad-s">{error}</p> : null}
      <Toaster />
    </>
  );
}

render(<Main />, document.getElementById('app'));
