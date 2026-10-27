// The book: its text as the app has it (one block per paragraph, headings for chapters),
// so the paragraphs read aloud are the app's own and the highlight follows the voice.
import { App } from '../shims/capacitor.js';
let book = null;
export const gb = { loadText: () => (book ||= App.book()) };
