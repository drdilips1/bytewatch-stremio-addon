// Every book you have, from each place it lives, in one list — kept on the phone so Hearth
// opens with your library at once, then refreshed from each place in the background.
import { persisted } from '../src/lib/store.js';
import { localSrc, absSrc, cloud } from '../src/sources/index.js';
import { mainTitle } from '../src/lib/match.js';

export const shelf = persisted('hearthShelf', { books: [], at: 0, errors: {} });
export const PLACE = { loc: 'Phone', abs: 'Server', tb: 'TorBox', rd: 'Real-Debrid' };
export const placeOf = (b) => PLACE[String(b?.uid || '').split(':')[0]] || PLACE[b?.source] || 'Phone';
export const isEbook = (b) => b?.kind === 'text';

// Everything the place gave (phone and server ebooks need their file's address), tidied.
const slim = (b, src) => ({
  ...b,
  uid: b.uid,
  source: b.source || src,
  kind: b.kind === 'text' ? 'text' : 'audio',
  title: b.title || 'Untitled',
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
    if (localStorage.getItem('hearth:demo')) return Promise.resolve();
  } catch {}
  const places = [
    ['loc', () => localSrc.library()],
    ['abs', () => absSrc.all()],
    ['tb', () => cloud.torboxLibrary()],
    ['rd', () => cloud.realdebridLibrary()],
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
      const books = [];
      const errors = {};
      for (const r of res) {
        // A place that didn't answer (your server off, no internet): its books aren't shown —
        // they wouldn't play. They come back with the next refresh that reaches it.
        const list = r.list ?? [];
        if (r.error) errors[r.k] = r.error;
        books.push(...list);
      }
      const seen = new Set();
      shelf.set({ books: books.filter((b) => !seen.has(b.uid) && seen.add(b.uid)), at: Date.now(), errors });
    })
    .finally(() => (running = null));
  return running;
}

const key = (b) => `${mainTitle(b?.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${String(b?.author || '').toLowerCase().split(/[ ,&]+/).filter(Boolean).pop() || ''}`;
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
export function oneEach(books) {
  const out = new Map();
  const rank = { abs: 0, loc: 1, tb: 2, rd: 3 };
  for (const b of books) {
    const k = key(b) + '|' + b.kind;
    const cur = out.get(k);
    if (!cur || (rank[b.source] ?? 9) < (rank[cur.source] ?? 9)) out.set(k, b);
  }
  return [...out.values()];
}
