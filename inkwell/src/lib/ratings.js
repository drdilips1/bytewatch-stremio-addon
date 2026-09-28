// Ratings and awards for a book page: Audible (stars and count), Goodreads (average
// rating), and awards named in the description (Audie Awards, AudioFile Earphones).
import { useEffect, useState } from 'preact/hooks';
import { getJson, qs } from './http.js';
import { persisted } from './store.js';
import { words, mainTitle } from './match.js';
import * as hcSrc from '../sources/hardcover.js';

const cache = persisted('ratingsCache', {}); // key -> { t, v }

// Server and torrent names carry extras: "Kelly Rimmer - The Things We Cannot Say",
// authors as "Rolf Dobelli/Eric Conger/…" (author/narrator). Look ratings up by the plain
// title and the first author.
const AUTHOR_SPLIT = /\s*(?:,|&|;|\/|\|\band\b)\s*/;
const firstAuthor = (a) => String(a || '').split(AUTHOR_SPLIT).map((x) => x.trim()).filter(Boolean)[0] || '';
function plainTitle(b) {
  let t = mainTitle(b?.title).replace(/\b(unabridged|abridged|audiobook|audio ?book)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  const au = new Set(words(firstAuthor(b?.author)));
  const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(t);
  if (m && au.size) {
    if (words(m[1]).length && words(m[1]).every((w) => au.has(w))) t = m[2]; // "Author - Title"
    else if (words(m[2]).length && words(m[2]).every((w) => au.has(w))) t = m[1]; // "Title - Author"
  }
  return t || String(b?.title || '');
}
const norm = (b) => ({ ...b, title: plainTitle(b), author: String(b?.author || '').split(AUTHOR_SPLIT).filter(Boolean).join(', ') });
const HIT_TTL = 30 * 864e5;
const MISS_TTL = 864e5;
const keyFor = (b) => `${words(plainTitle(b)).join(' ')}|${words(firstAuthor(b.author)).slice(-1)[0] || ''}`;

async function cached(kind, book, fn) {
  const key = `${kind}:${keyFor(book)}`;
  const hit = cache.get()[key];
  if (hit && Date.now() - hit.t < (hit.v ? HIT_TTL : MISS_TTL)) return hit.v;
  const v = await fn().catch(() => undefined);
  if (v === undefined) return undefined; // network trouble: not remembered, tried again next time
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
    .split(AUTHOR_SPLIT)
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
export const goodreads = (raw) => {
  const book = norm(raw);
  return cached('gr3', book, () =>
    limited(async () => {
      const q = `${book.title} ${firstAuthor(book.author)}`.trim();
      const list = await getJson('https://www.goodreads.com/book/auto_complete?' + qs({ format: 'json', q }), { timeout: 10000 });
      // The main edition: the matching entry with the most ratings.
      const hit = (Array.isArray(list) ? list : [])
        .filter((x) => sameBook(book, x.bookTitleBare || x.title || '', x.author?.name || '') && notCompanion(book, x.bookTitleBare || x.title))
        .sort((a, b) => (Number(b.ratingsCount) || 0) - (Number(a.ratingsCount) || 0))[0];
      const rating = Number(hit?.avgRating) || 0;
      return rating ? { rating, count: Number(hit.ratingsCount) || 0, url: hit.bookUrl ? `https://www.goodreads.com${hit.bookUrl.split('?')[0]}` : '', from: 'Goodreads' } : null;
    })
  );
};

/** Ratings come from Audible US (audible.com). */
export const MARKET = 'com';
const STORE_NAME = { in: 'Audible India', 'co.uk': 'Audible UK', 'com.au': 'Audible Australia', ca: 'Audible Canada', de: 'Audible Germany', com: 'Audible' };

async function audibleIn(market, book) {
  const run = (params) =>
    getJson(`https://api.audible.${market}/1.0/catalog/products?` + qs({ ...params, num_results: 10, products_sort_by: 'Relevance', response_groups: 'contributors,rating,product_attrs' }), { timeout: 12000 });
  const pick = (d) =>
    (d?.products || [])
      .map((p) => {
        const r = p.rating?.overall_distribution || {};
        const part = (x) => Number(x?.display_average_rating || x?.average_rating) || 0;
        return { p, rating: Number(r.display_average_rating || r.average_rating) || 0, count: Number(r.num_ratings) || 0, story: part(p.rating?.story_distribution), narration: part(p.rating?.performance_distribution) };
      })
      .filter((x) => x.rating && sameBook(book, x.p.title || '', (x.p.authors || []).map((a) => a.name).join(' ')) && notCompanion(book, x.p.title))
      .sort((a, b) => b.count - a.count)[0];
  const author = firstAuthor(book.author);
  let best = pick(await run({ title: book.title, author: author || undefined }));
  // Title + author found nothing (author spelt differently, co-authors…): try a keyword search.
  if (!best) best = pick(await run({ keywords: `${book.title} ${author}`.trim() }));
  return best ? { rating: best.rating, count: best.count, story: best.story, narration: best.narration, url: `https://www.audible.${market}/pd/${best.p.asin}`, from: STORE_NAME[market] } : null;
}

/** Audible (audible.com) stars and rating count for a book: { rating, count, url } or null. */
export const audibleStars = (raw) => {
  const book = norm(raw);
  return cached(`au5-${MARKET}`, book, () => limited(() => audibleIn('com', book)));
};

/** Hardcover's reader rating (needs your Hardcover token): the fallback when Audible and Goodreads have nothing. */
export const hardcoverStars = (raw) => {
  const book = norm(raw);
  if (!hcSrc.connected()) return Promise.resolve(null);
  return cached('hc1', book, () =>
    limited(async () => {
      const docs = await hcSrc.searchRated(`${book.title} ${firstAuthor(book.author)}`.trim());
      const hit = docs
        .filter((d) => Number(d.rating) > 0 && sameBook(book, d.title || '', (d.author_names || []).join(' ')) && notCompanion(book, d.title))
        .sort((a, b) => (Number(b.ratings_count) || 0) - (Number(a.ratings_count) || 0))[0];
      return hit ? { rating: Number(hit.rating), count: Number(hit.ratings_count) || 0, url: hit.slug ? `https://hardcover.app/books/${hit.slug}` : '', from: 'Hardcover' } : null;
    })
  );
};

const TILE = `tile3-${MARKET}`;
/** The rating to show on a tile: Audible, else Goodreads. Only a real "no rating" is remembered. */
export const tileRating = (book) =>
  cached(TILE, book, async () => {
    const a = await audibleStars(book);
    if (a) return a;
    const g = await goodreads(book);
    if (g) return g;
    const h = await hardcoverStars(book);
    if (h) return h;
    if (a === undefined || g === undefined || h === undefined) throw new Error('not reachable'); // ask again next time
    return null;
  });

/** Hook for tiles: { rating, count, url, from } once known. */
export function useTileRating(book) {
  const [r, setR] = useState(() => {
    const hit = book?.title ? cache.get()[`${TILE}:${keyFor(book)}`] : null;
    return hit?.v || null;
  });
  useEffect(() => {
    if (!book?.title || book.source === 'pod' || book.source === 'sum') return;
    let alive = true;
    let timer;
    const load = (tries) =>
      tileRating(book).then((v) => {
        if (!alive) return;
        if (v === undefined && tries > 0) timer = setTimeout(() => load(tries - 1), 15000); // couldn't reach: try again shortly
        else setR(v || null);
      });
    load(2);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
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
  const [r, setR] = useState({ audible: null, goodreads: null, hardcover: null });
  useEffect(() => {
    if (!book?.title) return;
    let alive = true;
    setR({ audible: null, goodreads: null, hardcover: null });
    const timers = [];
    // A service that couldn't be reached (undefined) is asked again a little later.
    const get = (fn, key, tries = 2) =>
      fn(book).then((v) => {
        if (!alive) return;
        if (v) setR((x) => ({ ...x, [key]: v }));
        else if (v === undefined && tries > 0) timers.push(setTimeout(() => get(fn, key, tries - 1), 8000));
      });
    get(audibleStars, 'audible');
    get(goodreads, 'goodreads');
    // Neither Audible nor Goodreads knows it: Hardcover's reader rating instead.
    Promise.all([audibleStars(book), goodreads(book)]).then(([a, g]) => !a && !g && get(hardcoverStars, 'hardcover'));
    return () => {
      alive = false;
      timers.forEach(clearTimeout);
    };
  }, [book?.uid, book?.title]);
  return { ...r, awards: awardsFrom(book?.description) };
}
