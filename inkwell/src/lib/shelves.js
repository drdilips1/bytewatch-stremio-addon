// Shelves that explain themselves: instead of one "Recommended" row, a few rows each saying
// why — "Because you enjoyed X", "More from authors you love", "Narrators like the ones you
// love", "A little outside your comfort zone", and one for each book you asked "More like
// this" for. Built on the phone from your ratings, listening and picks (taste.js), with
// Audible's catalogue to find the books. Nothing about you leaves the phone.
import { persisted, progress } from './store.js';
import { mainTitle, words } from './match.js';
import { profile, myRatings, rankForYou, knownTitles, rateKey } from './taste.js';
import { audible } from '../sources/catalogs.js';
import { GENRES } from '../screens/genres.js';

// Books you asked for more like (press and hold → More like this): newest first.
export const moreLike = persisted('moreLike', []); // [{ key, title, author, uid, at }]
export function addMoreLike(b) {
  const key = rateKey(b);
  moreLike.set((l) => [{ key, title: mainTitle(b.title), author: b.author || '', uid: b.uid || '', at: Date.now() }, ...l.filter((x) => x.key !== key)].slice(0, 6));
}

const cap = (s) => String(s || '').replace(/^./, (c) => c.toUpperCase());
const shortGenre = (n) => String(n).split(/ & |, /)[0];
const tidy = (list, n = 18) => rankForYou(list).slice(0, n);
const firstAuthor = (a) => String(a || '').split(/,|&| and /)[0].trim();

/** The book of yours to build "Because you enjoyed…" on: loved / liked lately, else finished. */
export function anchorBooks(n = 2) {
  const rated = Object.values(myRatings.get())
    .filter((r) => r?.title && (r.verdict === 'love' || r.verdict === 'like'))
    .sort((a, b) => (b.verdict === 'love') - (a.verdict === 'love') || (b.updatedAt || 0) - (a.updatedAt || 0));
  const finished = Object.values(progress.get())
    .filter((p) => p?.book?.title && p.finished && p.book.kind !== 'text' && p.book.source !== 'pod')
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .map((p) => p.book);
  const seen = new Set();
  return [...rated, ...finished].filter((b) => {
    const k = words(mainTitle(b.title)).join(' ');
    return k && !seen.has(k) && seen.add(k);
  }).slice(0, n);
}

/** What a set of books has in common, in a few plain words (from their genres). */
function commonGround(books) {
  const count = new Map();
  for (const b of books) for (const g of GENRES) if ((b.genres || []).some((x) => g.match.test(x))) count.set(g.name, (count.get(g.name) || 0) + 1);
  const top = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n]) => shortGenre(n).toLowerCase());
  return top.length ? cap(top.join(' and ')) : '';
}

async function relatedTo(b) {
  const seed = await audible.find(mainTitle(b.title), firstAuthor(b.author)).catch(() => null);
  if (!seed) return { seed: null, list: [] };
  return { seed, list: await audible.related(seed.uid.slice(3)).catch(() => []) };
}

/**
 * The shelves for Home, each { key, title, subtitle, load } — `load` resolves the books (each
 * with match and a tag). Only shelves there's something to build from are listed.
 */
export function tasteShelves() {
  const p = profile();
  const out = [];
  // "More like this" asks first: the newest one or two.
  for (const m of moreLike.get().slice(0, 2))
    out.push({
      key: 'ml:' + m.key,
      title: `Because you liked ${m.title}`,
      subtitle: 'You asked for more like it',
      load: async () => tidy((await relatedTo(m)).list).map((b) => ({ ...b, tag: `${b.match}% match` })),
    });
  // Because you enjoyed…
  for (const a of anchorBooks(1))
    out.push({
      key: 'enjoyed:' + rateKey(a),
      title: `Because you enjoyed ${mainTitle(a.title)}`,
      subtitle: (() => {
        const why = commonGround([a]);
        return why ? `${why} — books its listeners went on to love` : 'Books its listeners went on to love';
      })(),
      load: async () => {
        const { list } = await relatedTo(a);
        return tidy(list).map((b) => ({ ...b, tag: `${b.match}% match` }));
      },
    });
  // Authors you love: their books you haven't heard.
  const authors = [...p.authors.entries()].filter(([, v]) => v.w >= 1.5).sort((a, b) => b[1].w - a[1].w).slice(0, 2);
  if (authors.length) {
    out.push({
      key: 'authors',
      title: 'More from authors you love',
      subtitle: authors.length === 1 ? `You loved ${authors[0][1].titles.length} of their books` : 'Their books you haven’t heard yet',
      load: async () => {
        // The author's full name: from a book of theirs you have.
        const full = (last) => {
          for (const r of [...Object.values(myRatings.get()), ...Object.values(progress.get()).map((x) => x?.book)])
            if (r?.author && words(firstAuthor(r.author)).pop() === last) return firstAuthor(r.author);
          return last;
        };
        const known = knownTitles();
        const lists = await Promise.all(authors.map(([last]) => audible.byAuthor(full(last)).catch(() => [])));
        const now = Date.now();
        const books = lists.flat().filter((b) => !known.has(words(mainTitle(b.title)).join(' ')));
        return tidy(books, 16).map((b) => ({ ...b, tag: b.released && now - b.released < 365 * 864e5 ? `New · ${new Date(b.released).getFullYear()}` : b.duration && b.duration < 7 * 3600 ? `Short · ${Math.round(b.duration / 3600)} h` : 'Not heard yet' }));
      },
    });
  }
  // Narrators you rated highly.
  const narrators = [...p.narrators.entries()].filter(([, v]) => v.w >= 0.8).sort((a, b) => b[1].w - a[1].w).slice(0, 2);
  if (narrators.length)
    out.push({
      key: 'narrators',
      title: 'Narrators like the ones you love',
      subtitle: `Read by ${narrators.map(([, v]) => v.name).join(' and ')}, whom you rated highly`,
      load: async () => {
        const lists = await Promise.all(narrators.map(([, v]) => audible.byNarrator(v.name).catch(() => [])));
        return tidy(lists.flat(), 16).map((b) => ({ ...b, tag: 'Your narrator' }));
      },
    });
  // A little outside your comfort zone: a topic you haven't tried (not one you turned away
  // from), its best-rated books — the ones that still fit what you like.
  const weight = (g) => {
    let w = 0;
    for (const [name, v] of p.genres) if (g.match.test(name)) w += v.w;
    return w;
  };
  const tried = GENRES.filter((g) => g.au).map((g) => [g, weight(g)]);
  const top = tried.filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]);
  const fresh = tried.filter(([, w]) => w === 0).map(([g]) => g);
  if (top.length >= 2 && fresh.length) {
    const g = fresh[new Date().getDate() % fresh.length];
    out.push({
      key: 'explore',
      title: 'A little outside your comfort zone',
      subtitle: `${shortGenre(g.name)} — highly rated, close to what you like`,
      load: async () =>
        tidy((await audible.pool(g.au || g.name).catch(() => [])).filter((b) => (b.rating || 0) >= 4.4 && (b.ratings || 0) >= 500), 12).map((b) => ({ ...b, tag: 'Explore' })),
    });
  }
  return out;
}
