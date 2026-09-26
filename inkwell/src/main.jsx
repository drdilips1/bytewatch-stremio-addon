import { render } from 'preact';
import { App } from './app.jsx';
import './styles.css';
import { settings } from './lib/store.js';

// New look (v2): move everyone onto the pastel Lavender accent once; later choices stick.
try {
  if ((settings.get().themeV || 0) < 2) settings.set((s) => ({ ...s, accent: 'lavender', themeV: 2 }));
} catch {}

// Libby was removed: forget its saved sign-in and library links.
try {
  ['inkwell:libby', 'inkwell:libbyAccount'].forEach((k) => localStorage.removeItem(k));
} catch {}

// Gemini and Mistral were replaced by Groq / OpenRouter: drop their old keys.
try {
  const a = JSON.parse(localStorage.getItem('inkwell:ai') || 'null');
  if (a && ('geminiKey' in a || 'model' in a || 'mistralKey' in a)) {
    delete a.geminiKey;
    delete a.mistralKey;
    delete a.model;
    localStorage.setItem('inkwell:ai', JSON.stringify(a));
  }
} catch {}

render(<App />, document.getElementById('app'));
