// Hearth: the books you already have — on the phone, your Audiobookshelf, TorBox and
// Real-Debrid — in one calm library, with a plain player and reader. No sources, no AI.
import { render } from 'preact';
import '../src/styles.css';
import './hearth.css';
import { aiOff } from '../src/lib/ai.js';
import { settings } from '../src/lib/store.js';
import '../src/lib/keep.js';
import '../src/lib/car.js';
import { App } from './app.jsx';

try {
  aiOff.set(true); // nothing AI anywhere (the shared reader hides its AI actions)
  const s = settings.get();
  if (!s.hearthV) settings.set({ ...s, hearthV: 1, mode: 'light', dynamicColor: true, voiceOff: true });
} catch {}

render(<App />, document.getElementById('app'));
