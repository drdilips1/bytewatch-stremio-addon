// "What's new": one card on Home after an update, in plain words, until you close it. Change
// EDITION (and the list) whenever there's something listeners should know about. A fresh install
// doesn't see it (everything is new then).
import { persisted } from '../src/lib/store.js';

export const EDITION = 2;
export const seenEdition = persisted('briskSeenEdition', 0);
export const NEWS = [
  'Your library shows three books across.',
  'Books without a picture get their own colour, so the shelf looks like a shelf.',
  'The book that’s playing always leads Continue listening.',
  'While a book is on, Home is slimmer: the picture steps aside so your books sit higher.',
  'A soft fade under the clock when you scroll, and “Searching…” while it looks.',
  'On a book page the copies fold into one line — tap it to choose one yourself.',
  'A clearer progress line on the player strip.',
];
