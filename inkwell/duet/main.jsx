// Duet: your own audiobooks and ebooks (this phone, your Audiobookshelf) in one beautiful
// library, with a player and read-along. No sources, no AI.
import { render } from 'preact';
import '../src/styles.css';
import './duet.css';
import { aiOff } from '../src/lib/ai.js';
import { settings } from '../src/lib/store.js';
import '../src/lib/keep.js';
import '../src/lib/car.js';
import { App } from './app.jsx';

try {
  aiOff.set(true); // nothing AI anywhere (the shared reader hides its AI actions)
  const s = settings.get();
  if (!s.duetV) settings.set({ ...s, duetV: 1, mode: 'light', dynamicColor: true, voiceOff: true });
} catch {}

render(<App />, document.getElementById('app'));
