// Libby / OverDrive: your public library's ebooks and audiobooks. The catalogue
// and availability come from OverDrive's public "thunder" API (the one the Libby
// web app uses); borrowing happens in Libby itself, signed in with your card.
import { getJson, qs } from '../lib/http.js';
import { persisted } from '../lib/store.js';
import { mainTitle, matches } from '../lib/match.js';

const THUNDER = 'https://thunder.api.overdrive.com/v2';

export const libby = persisted('libby', { key: '', name: '' });
export const connected = () => !!libby.get().key;

/** "nypl", "https://libbyapp.com/library/nypl" or a Libby page link → "nypl". */
export function parseLibrary(input) {
  const s = String(input || '').trim();
  const m = /libbyapp\.com\/(?:library|search|interview\/menu)\/([a-z0-9-]+)/i.exec(s) || /^([a-z0-9-]{2,40})$/i.exec(s);
  return m ? m[1].toLowerCase() : '';
}

export async function connect(input) {
  const key = parseLibrary(input);
  if (!key) throw new Error('Paste your library link from Libby (libbyapp.com/library/…) or its short name');
  let name = key;
  try {
    const d = await getJson(`${THUNDER}/libraries/${encodeURIComponent(key)}`, { fresh: true, timeout: 15000 });
    name = d?.name || d?.displayName || key;
  } catch (e) {
    if (e.status === 404) throw new Error(`Libby doesn't know a library called "${key}"`);
    throw e;
  }
  libby.set({ key, name });
  return name;
}
export const disconnect = () => libby.set({ key: '', name: '' });

const libbyUrl = (key, title, id) => `https://libbyapp.com/search/${key}/search/query-${encodeURIComponent(title)}/page-1${id ? `/${id}` : ''}`;
export const libraryHome = () => `https://libbyapp.com/library/${libby.get().key}`;

function toBook(it, key) {
  const covers = it.covers || {};
  const cover = covers.cover510Wide?.href || covers.cover300Wide?.href || covers.cover150Wide?.href || '';
  const format = it.type?.id === 'audiobook' ? 'audiobook' : it.type?.id === 'ebook' ? 'ebook' : it.type?.name || '';
  return {
    uid: `lb:${it.id}`,
    source: 'lb',
    kind: 'discover',
    title: it.title + (it.subtitle && it.title.length < 40 ? `: ${it.subtitle}` : ''),
    author: it.firstCreatorName || (it.creators || []).map((c) => c.name).slice(0, 2).join(', '),
    cover,
    year: (it.publishDate || '').slice(0, 4),
    description: (it.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    libby: {
      id: it.id,
      format,
      available: !!it.isAvailable,
      copies: it.availableCopies ?? null,
      owned: it.ownedCopies ?? null,
      holds: it.holdsCount ?? null,
      waitDays: it.estimatedWaitDays ?? null,
      link: libbyUrl(key, it.title, it.id),
    },
  };
}

/** Search your library's catalogue (audiobooks and ebooks). */
export async function search(term) {
  const { key } = libby.get();
  if (!key || !term.trim()) return [];
  const d = await getJson(`${THUNDER}/libraries/${key}/media?` + qs({ query: term, perPage: 24, page: 1 }), { timeout: 15000 });
  return (d?.items || []).filter((it) => it.title).map((it) => toBook(it, key));
}

/** Copies of this book at your library, audiobook first. */
export async function availability(book) {
  const t = mainTitle(book.title);
  const author = (book.author || '').split(',')[0].trim();
  const hits = await search(`${t} ${author.split(' ').pop() || ''}`.trim()).catch(() => []);
  return hits
    .filter((b) => matches(t, b.title))
    .sort((a, b) => (a.libby.format === 'audiobook' ? -1 : 0) - (b.libby.format === 'audiobook' ? -1 : 0) || Number(b.libby.available) - Number(a.libby.available));
}

export const details = async (book) => book;

export function describe(l) {
  if (!l) return '';
  if (l.available) return `Available now${l.copies != null && l.owned ? ` · ${l.copies} of ${l.owned} copies` : ''}`;
  const weeks = l.waitDays ? Math.max(1, Math.round(l.waitDays / 7)) : null;
  return `Waitlist${l.holds != null ? ` · ${l.holds} hold${l.holds === 1 ? '' : 's'}` : ''}${weeks ? ` · about ${weeks} week${weeks === 1 ? '' : 's'}` : ''}`;
}
