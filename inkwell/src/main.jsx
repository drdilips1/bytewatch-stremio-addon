import { render } from 'preact';
import { App } from './app.jsx';
import './styles.css';

// Libby was removed: forget its saved sign-in and library links.
try {
  ['inkwell:libby', 'inkwell:libbyAccount'].forEach((k) => localStorage.removeItem(k));
} catch {}

render(<App />, document.getElementById('app'));
