// Ratings and awards for a book page: Audible (stars and count), Goodreads (average
// rating), and awards named in the description (Audie Awards, AudioFile Earphones).
import { useEffect, useState } from 'preact/hooks';
import { getJson, qs } from './http.js';
import { persisted } from './store.js';
import { words, mainTitle } from './match.js';
import { audible } from '../sources/catalogs.js';

const cache = persisted('ratingsCache', {}); // key -> { t, v }
const HIT_TTL = 30 * 864e5;
const MISS_TTL = 864e5;
const keyFor = (b) => `${words(mainTitle(b.title)).join(' ')}|${words(String(b.author || '').split(',')[0]).slice(-1)[0] || ''}`;

async function cached(kind, book, fn) {
  const key = `${kind}:${keyFor(book)}`;
  const hit = cache.get()[key];
  if (hit && Date.now() - hit.t < (hit.v ? HIT_TTL : MISS_TTL)) return hit.v;
  const v = await fn().catch(() => undefined);
  if (v === undefined) return null; // network trouble: try again next time
  cache.set((c) => {
    const next = { ...c, [key]: { t: Date.now(), v } };
    const keys = Object.keys(next);
    if (keys.length > 800) keys.sort((a, b) => next[a].t - next[b].t).slice(0, keys.length - 800).forEach((k) => delete next[k]);
    return next;
  });
  return v;
}

const sameBook = (book, title, author) => {
  const want = words(mainTitle(book.title));
  const got = new Set(words(title));
  if (!want.length || want.filter((w) => got.has(w)).length / want.length < 0.8) return false;
  const surnames = String(book.author || '').split(/,|&|\band\b/).map((a) => words(a).slice(-1)[0]).filter(Boolean);
  const have = words(author || '');
  return !surnames.length || surnames.some((n) => have.includes(n));
};

/** Goodreads average rating via its search suggestions: { rating, count, url } or null. */
export const goodreads = (book) =>
  cached('gr', book, async () => {
    const q = `${mainTitle(book.title)} ${String(book.author || '').split(',')[0]}`.trim();
    const list = await getJson('https://www.goodreads.com/book/auto_complete?' + qs({ format: 'json', q }), { timeout: 10000 });
    const hit = (Array.isArray(list) ? list : []).find((x) => sameBook(book, x.bookTitleBare || x.title || '', x.author?.name || ''));
    const rating = Number(hit?.avgRating) || 0;
    return rating ? { rating, count: Number(hit.ratingsCount) || 0, url: hit.bookUrl ? `https://www.goodreads.com${hit.bookUrl}` : '' } : null;
  });

/** Audible stars for a book that came from elsewhere: { rating, count } or null. */
export const audibleStars = (book) =>
  cached('au', book, async () => {
    const p = await audible.find(mainTitle(book.title), String(book.author || '').split(',')[0]);
    return p && p.rating && sameBook(book, p.title, p.author) ? { rating: p.rating, count: p.ratings || 0 } : null;
  });

/** Awards the description mentions: Audie Awards (winner / finalist, with year) and AudioFile's Earphones Award. */
export function awardsFrom(text) {
  const t = String(text || '');
  const out = [];
  const audie = /(winner|won|finalist|nominee|nominated)[^.]{0,60}?(\b(19|20)\d{2}\b)?[^.]{0,30}?audie/i.exec(t) || /audie[^.]{0,60}?(winner|finalist|nominee)/i.exec(t);
  if (audie || /\baudie award/i.test(t)) {
    const year = (/(19|20)\d{2}(?=[^.]{0,40}audie)|audie[^.]{0,40}?((19|20)\d{2})/i.exec(t) || [])[0]?.match(/(19|20)\d{2}/)?.[0] || '';
    const finalist = /finalist|nominee|nominated/i.test(audie?.[0] || '') && !/winner|won/i.test(audie?.[0] || '');
    out.push({ kind: 'audie', label: `Audie ${finalist ? 'finalist' : 'Award'}${year ? ` ${year}` : ''}` });
  }
  if (/earphones award/i.test(t)) out.push({ kind: 'earphones', label: 'AudioFile Earphones' });
  if (/audiofile (magazine )?best of/i.test(t)) out.push({ kind: 'earphones', label: 'AudioFile Best of' });
  return out;
}

/** Hook: { audible, goodreads, awards } for a book page (each filled in when known). */
export function useRatings(book) {
  const [r, setR] = useState({ audible: null, goodreads: null });
  useEffect(() => {
    if (!book?.title) return;
    let alive = true;
    setR({ audible: book.rating ? { rating: book.rating, count: book.ratings || 0 } : null, goodreads: null });
    if (!book.rating) audibleStars(book).then((v) => alive && v && setR((x) => ({ ...x, audible: v })));
    goodreads(book).then((v) => alive && v && setR((x) => ({ ...x, goodreads: v })));
    return () => (alive = false);
  }, [book?.uid, book?.title, book?.rating]);
  return { ...r, awards: awardsFrom(book?.description) };
}
