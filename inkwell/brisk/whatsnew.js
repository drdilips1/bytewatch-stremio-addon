// "What's new": one card on Home after an update, in plain words, until you close it. Change
// EDITION (and the list) whenever there's something listeners should know about. A fresh install
// doesn't see it (everything is new then).
import { persisted } from '../src/lib/store.js';

export const EDITION = 1;
export const seenEdition = persisted('briskSeenEdition', 0);
export const NEWS = [
  'A new look: champagne for everything you press to play, and Midnight for dark mode.',
  'Roll the dice on Home for a whole new look — picture, colours and headings (nine to find).',
  'Now Playing glows in the colours of the cover.',
  'Search shows results at once, your own books first, with Audible’s ratings.',
  'Your library: sort by title, author or series, as a grid or a list.',
  'A copy that won’t play is swapped for another by itself — your place is kept.',
  'Press and hold a book: other copies, its page, or Find cover. × closes the player strip.',
  '“Ready to play now” on Home, and the next book of a series when one ends.',
  'Dream mode: start the sleep timer and the player turns warm and dim.',
  'Bookmarks can carry a note. Speeds from 0.5× to 3×.',
  'Want to listen and Finished in your library. Back up / Restore in Settings.',
  'Tap an author or narrator for their other books; a series shows all its books at a glance.',
  '“Finish by Thursday” on the Continue card, and a gentle “Sleep in 30 min?” late at night.',
];
