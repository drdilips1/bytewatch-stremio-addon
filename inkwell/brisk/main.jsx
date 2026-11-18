// Audibrisk: search a book, then play it — streamed through your TorBox or Real-Debrid, or saved
// for offline. Covers and details come by themselves; the only setting is your debrid key.
import { render } from 'preact';
import './brisk.css';
import { aiOff } from '../src/lib/ai.js';
import { settings } from '../src/lib/store.js';
import { installSources } from './books.js';
import { App } from './app.jsx';

try {
  aiOff.set(true);
  const s = settings.get();
  if (!s.briskV) settings.set({ ...s, briskV: 1, voiceOff: true, skipCredits: true });
} catch {}
installSources();

render(<App />, document.getElementById('app'));
