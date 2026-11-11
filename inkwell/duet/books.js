// Every book you have, from each place it lives, in one list — kept on the phone so Duet
// opens with your library at once, then refreshed from each place in the background.
import { persisted } from '../src/lib/store.js';
import { localSrc, absSrc } from '../src/sources/index.js';
import { mainTitle } from '../src/lib/match.js';
import { findMissingCovers, coverNow } from '../src/lib/meta.js';
import { downloads } from '../src/lib/downloads.js';
import { seriesOf } from '../src/lib/series.js';

// Books still without a cover: looked up by themselves after each refresh (Audible, Apple,
// Goodreads, Google Books, Open Library). One that isn't found isn't asked again for a week.
const coverTried = persisted('duetCoverTried', {}); // uid -> when
let coverRun = null;
export function autoCovers() {
  if (coverRun) return coverRun;
  const tried = coverTried.get();
  const week = 7 * 864e5;
  const todo = oneEach(shelf.get().books).filter((b) => !coverNow(b) && !(Date.now() - (tried[b.uid] || 0) < week)).slice(0, 60);
  if (!todo.length) return Promise.resolve();
  coverRun = findMissingCovers(todo)
    .catch(() => {})
    .then(() => {
      const now = Date.now();
      coverTried.set((t) => {
        const next = { ...t };
        for (const b of todo) if (!coverNow(b)) next[b.uid] = now;
        return next;
      });
    })
    .finally(() => (coverRun = null));
  return coverRun;
}

export const shelf = persisted('duetShelf', { books: [], at: 0, errors: {} });
// Books you removed from Duet (by title and author, so every copy goes): only hidden here —
// the files stay where they are. Settings lists them to bring back.
export const hidden = persisted('duetHidden', {}); // key -> { title, author, at }
export const prefs = persisted('duetPrefs', { titles: false, sort: 'played', view: 'grid' }); // titles under covers; Home's sort and view
export const PLACE = { loc: 'Phone', abs: 'Server' };
export const placeOf = (b) => PLACE[String(b?.uid || '').split(':')[0]] || PLACE[b?.source] || 'Phone';
export const isEbook = (b) => b?.kind === 'text';

// Everything the place gave (phone and server ebooks need their file's address), tidied.
const slim = (b, src) => ({
  ...b,
  uid: b.uid,
  source: b.source || src,
  kind: b.kind === 'text' ? 'text' : 'audio',
  title: String(b.title || 'Untitled').replace(/^[\s\-–—_.,:;]+/, '') || 'Untitled', // file names: "- A Court of…"
  author: b.author || '',
  narrator: b.narrator || '',
  cover: b.cover || '',
  duration: Number(b.duration) || 0,
  format: b.format || b.ebookFormat || '',
  addedAt: Number(b.addedAt) || 0,
  ...(b.ebookFormat ? { ebookFormat: b.ebookFormat } : {}),
  ...(b.ebookName ? { ebookName: b.ebookName } : {}),
  ...(b.hash ? { hash: b.hash } : {}),
  ...(b.series ? { series: b.series } : {}),
});

let running = null;
/** Ask every connected place for its books again (one refresh at a time). */
export function refresh() {
  if (running) return running;
  // Screenshots / demos: keep the sample library that was put in place.
  try {
    if (localStorage.getItem('duet:demo')) return Promise.resolve();
  } catch {}
  const places = [
    ['loc', () => localSrc.library()],
    ['abs', () => absSrc.all()],
  ];
  running = Promise.all(
    places.map(([k, f]) =>
      Promise.resolve()
        .then(f)
        .then((list) => ({ k, list: (list || []).filter((b) => b?.uid && b.title && !b.fetching).map((b) => slim(b, k)) }))
        .catch((e) => ({ k, list: null, error: e?.message || 'failed' })),
    ),
  )
    .then((res) => {
      const old = shelf.get();
      const books = [];
      const errors = {};
      for (const r of res) {
        // A place that didn't answer (your server off, no internet): its books aren't shown —
        // they wouldn't play. They come back with the next refresh that reaches it.
        // Books saved on the phone stay: they play without it.
        const saved = downloads.get();
        const list = r.list ?? old.books.filter((b) => (b.source === r.k || b.uid.startsWith(r.k + ':')) && saved[b.uid]?.status === 'done');
        if (r.error) errors[r.k] = r.error;
        books.push(...list);
      }
      const seen = new Set();
      shelf.set({ books: books.filter((b) => !seen.has(b.uid) && seen.add(b.uid)), at: Date.now(), errors });
      // Real covers for the ones without, a little later (the library shows first).
      setTimeout(autoCovers, 4000);
    })
    .finally(() => (running = null));
  return running;
}

export const key = (b) => `${mainTitle(b?.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${String(b?.author || '').toLowerCase().split(/[ ,&]+/).filter(Boolean).pop() || ''}`;
/** The same book in its other form (the ebook of an audiobook, or the other way round). */
export function otherForm(book, books = shelf.get().books) {
  const k = key(book);
  return books.find((b) => b.uid !== book.uid && b.kind !== book.kind && key(b) === k) || null;
}
/** Every copy of the book in this form (it can live in more than one place). */
export function copiesOf(book, books = shelf.get().books) {
  const k = key(book);
  return books.filter((b) => b.kind === book.kind && key(b) === k);
}
/** One entry per book in each form (the same book on the server and in TorBox shows once). */
export const isHidden = (b, h = hidden.get()) => !!h[key(b)];
export function hide(b) {
  hidden.set((h) => ({ ...h, [key(b)]: { title: b.title, author: b.author || '', at: Date.now() } }));
}
export function unhide(k) {
  hidden.set((h) => {
    const next = { ...h };
    delete next[k];
    return next;
  });
}
export function oneEach(books) {
  const hid = hidden.get();
  books = books.filter((b) => !hid[key(b)]);
  const out = new Map();
  const rank = { loc: 0, abs: 1 };
  for (const b of books) {
    const k = key(b) + '|' + b.kind;
    const cur = out.get(k);
    if (!cur || (rank[b.source] ?? 9) < (rank[cur.source] ?? 9)) out.set(k, b);
  }
  return [...out.values()];
}

/** Authors, most books first: [{ name, books }]. */
export function authorsOf(books) {
  const m = new Map();
  for (const b of books) {
    const name = String(b.author || 'Unknown author').split(/,|&| and /)[0].trim() || 'Unknown author';
    const k = name.toLowerCase();
    if (!m.has(k)) m.set(k, { name, books: [] });
    m.get(k).books.push(b);
  }
  return [...m.values()].sort((a, b) => b.books.length - a.books.length || a.name.localeCompare(b.name));
}

/** Series, in reading order inside each: [{ name, books }] (books with a known series only). */
export function seriesGroups(books) {
  const m = new Map();
  for (const b of books) {
    const s = seriesOf(b);
    if (!s?.name) continue;
    const k = s.name.toLowerCase();
    if (!m.has(k)) m.set(k, { name: s.name, books: [] });
    m.get(k).books.push({ ...b, seriesN: s.n });
  }
  for (const g of m.values()) g.books.sort((a, b) => (a.seriesN ?? 999) - (b.seriesN ?? 999) || a.title.localeCompare(b.title));
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
}
