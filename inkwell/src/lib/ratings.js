// Ratings and awards for a book page: Audible (stars and count), Goodreads (average
// rating), and awards named in the description (Audie Awards, AudioFile Earphones).
import { useEffect, useState } from 'preact/hooks';
import { getJson, qs } from './http.js';
import { persisted } from './store.js';
import { words, mainTitle } from './match.js';

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

// Every word of the book's main title in the candidate's title, and an author name in common.
const sameBook = (book, title, author) => {
  const want = words(mainTitle(book.title));
  const got = new Set(words(title));
  if (!want.length || want.some((w) => !got.has(w))) return false;
  const names = String(book.author || '')
    .split(/,|&|\band\b/)
    .flatMap((a) => {
      const w = words(a).filter((x) => x.length >= 3);
      return w.length ? [w[0], w[w.length - 1]] : [];
    });
  const have = words(author || '');
  return !names.length || names.some((n) => have.includes(n));
};

// Companion products that share the title (and have their own, different ratings).
const COMPANION = /\b(summary|summaries|workbook|study guide|analysis|companion|conversation starters|trivia|quiz|key takeaways|cliff ?notes|lesson plans?)\b/i;
const notCompanion = (book, title) => COMPANION.test(book.title || '') || !COMPANION.test(title || '');

// Few requests at a time: a screen of tiles shouldn't flood Audible or Goodreads.
let running = 0;
const waiting = [];
function limited(fn) {
  return new Promise((resolve, reject) => {
    const go = () => {
      running++;
      fn()
        .then(resolve, reject)
        .finally(() => {
          running--;
          waiting.length && waiting.shift()();
        });
    };
    running < 3 ? go() : waiting.push(go);
  });
}

/** Goodreads average rating via its search suggestions: { rating, count, url } or null. */
export const goodreads = (book) =>
  cached('gr2', book, () =>
    limited(async () => {
      const q = `${mainTitle(book.title)} ${String(book.author || '').split(',')[0]}`.trim();
      const list = await getJson('https://www.goodreads.com/book/auto_complete?' + qs({ format: 'json', q }), { timeout: 10000 });
      // The main edition: the matching entry with the most ratings.
      const hit = (Array.isArray(list) ? list : [])
        .filter((x) => sameBook(book, x.bookTitleBare || x.title || '', x.author?.name || '') && notCompanion(book, x.bookTitleBare || x.title))
        .sort((a, b) => (Number(b.ratingsCount) || 0) - (Number(a.ratingsCount) || 0))[0];
      const rating = Number(hit?.avgRating) || 0;
      return rating ? { rating, count: Number(hit.ratingsCount) || 0, url: hit.bookUrl ? `https://www.goodreads.com${hit.bookUrl.split('?')[0]}` : '', from: 'Goodreads' } : null;
    })
  );

/** Ratings come from Audible US (audible.com). */
export const MARKET = 'com';
const STORE_NAME = { in: 'Audible India', 'co.uk': 'Audible UK', 'com.au': 'Audible Australia', ca: 'Audible Canada', de: 'Audible Germany', com: 'Audible' };

async function audibleIn(market, book) {
  const d = await getJson(
    `https://api.audible.${market}/1.0/catalog/products?` +
      qs({ title: mainTitle(book.title), author: String(book.author || '').split(',')[0] || undefined, num_results: 10, products_sort_by: 'Relevance', response_groups: 'contributors,rating,product_attrs' }),
    { timeout: 10000 }
  );
  const best = (d?.products || [])
    .map((p) => {
      const r = p.rating?.overall_distribution || {};
      const part = (x) => Number(x?.display_average_rating || x?.average_rating) || 0;
      return { p, rating: Number(r.display_average_rating || r.average_rating) || 0, count: Number(r.num_ratings) || 0, story: part(p.rating?.story_distribution), narration: part(p.rating?.performance_distribution) };
    })
    .filter((x) => x.rating && sameBook(book, x.p.title || '', (x.p.authors || []).map((a) => a.name).join(' ')) && notCompanion(book, x.p.title))
    .sort((a, b) => b.count - a.count)[0];
  return best ? { rating: best.rating, count: best.count, story: best.story, narration: best.narration, url: `https://www.audible.${market}/pd/${best.p.asin}`, from: STORE_NAME[market] } : null;
}

/** Audible (audible.com) stars and rating count for a book: { rating, count, url } or null. */
export const audibleStars = (book) =>
  cached(`au4-${MARKET}`, book, () =>
    limited(() => audibleIn('com', book))
  );

/** The rating to show on a tile: Audible, else Goodreads. */
export const tileRating = (book) =>
  cached(`tile-${MARKET}`, book, async () => (await audibleStars(book)) || (await goodreads(book)));

/** Hook for tiles: { rating, count, url, from } once known. */
export function useTileRating(book) {
  const [r, setR] = useState(() => {
    const hit = book?.title ? cache.get()[`tile-${MARKET}:${keyFor(book)}`] : null;
    return hit?.v || null;
  });
  useEffect(() => {
    if (!book?.title || book.source === 'pod' || book.source === 'sum') return;
    let alive = true;
    tileRating(book).then((v) => alive && setR(v || null));
    return () => (alive = false);
  }, [book?.uid, book?.title]);
  return r;
}

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
    setR({ audible: null, goodreads: null });
    audibleStars(book).then((v) => alive && v && setR((x) => ({ ...x, audible: v })));
    goodreads(book).then((v) => alive && v && setR((x) => ({ ...x, goodreads: v })));
    return () => (alive = false);
  }, [book?.uid, book?.title]);
  return { ...r, awards: awardsFrom(book?.description) };
}
