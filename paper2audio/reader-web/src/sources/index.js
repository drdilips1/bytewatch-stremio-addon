// The book: its text as the app has it (one block per paragraph, headings for chapters),
// so the paragraphs read aloud are the app's own and the highlight follows the voice.
import { App } from '../shims/capacitor.js';
let book = null;
// A long book's text comes as a file (htmlUrl): one message with all of it was more than the app's memory.
const load = async () => {
  const b = await App.book();
  if (b.html == null && b.htmlUrl) b.html = await (await fetch(b.htmlUrl)).text();
  return b;
};
export const gb = { loadText: () => (book ||= load()) };
