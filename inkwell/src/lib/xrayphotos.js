// Photos in X-Ray. Real people: their Wikipedia photo, the way author and narrator photos are
// found. Characters: Wikipedia almost never has a free picture of one (film stills aren't free,
// so its API leaves them out — the first version found next to none), so the book's fan wiki on
// Fandom comes first: "Paul Atreides" on dune.fandom.com, "Tyrion Lannister" on awoiaf. Then
// Wikipedia; otherwise the initials in the person's colour. Never AI-made faces. Found once per
// book and name, kept on this phone (misses too, for a month).
import { getJson, qs } from './http.js';
import { persisted } from './store.js';
import { mainTitle } from './match.js';

const kept = persisted('xrayPhotos', {}, { delay: 1500 }); // key → { url, page, t }
const MONTH = 30 * 864e5;
const words = (s) => String(s || '').toLowerCase().replace(/\([^)]*\)/g, ' ').match(/\p{L}+/gu) || [];

/**
 * The right page among Wikipedia's results, or null. Its title must be this name (every word of
 * the shorter one in the longer, the surname included); a character's page must say it's a
 * character / fictional, a real person's must not.
 */
export function pickPage(pages, name, kind = 'fictional') {
  const want = words(name).filter((w) => w.length > 1);
  if (!want.length) return null;
  const surname = want[want.length - 1];
  for (const p of pages || []) {
    if (!p?.thumbnail?.source) continue;
    const got = words(p.title);
    const [a, b] = want.length <= got.length ? [want, got] : [got, want];
    if (!a.length || !a.every((w) => b.includes(w)) || !got.includes(surname)) continue;
    const said = `${p.description || ''} ${p.title || ''}`.toLowerCase();
    const isCharacter = /\bcharacter\b|\bfictional\b|\bprotagonist\b|\bantagonist\b/.test(said);
    if (kind === 'real' ? !isCharacter : isCharacter) return { url: p.thumbnail.source, page: p.title };
  }
  return null;
}

/** A fandom.com subdomain as the AI gave it ("Dune", "dune.fandom.com") → "dune", or "" if it isn't one. */
export function wikiName(w) {
  const s = String(w || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\.fandom\.com.*$/, '');
  return /^[a-z0-9][a-z0-9-]{1,40}$/.test(s) ? s : '';
}

/**
 * On a fan wiki every page is about the book's world, so the name alone decides — but a page with
 * something in brackets is about something else of that name: "Harry Potter (book series)" gave
 * Harry a photo of the box set. Best first: the exact name, then "(character)", then a page whose
 * title holds the name (a longer full name, a gallery). Other bracketed pages are never taken.
 */
export function pickFandom(pages, name) {
  const want = words(name).filter((w) => w.length > 1);
  if (!want.length) return null;
  let best = null;
  for (const p of pages || []) {
    const url = p?.thumbnail?.source;
    if (!url) continue;
    const title = String(p.title || '');
    const bracket = (title.match(/\(([^)]*)\)/) || [])[1] || '';
    if (bracket && !/character/i.test(bracket)) continue;
    const got = words(title.split('/')[0]);
    const [a, b] = want.length <= got.length ? [want, got] : [got, want];
    if (!a.length || !a.every((w) => b.includes(w)) || !got.includes(want[want.length - 1])) continue;
    // A page about someone else named after them ("Hermione Granger's mother", "Harry Potter's
    // wand", "Potter family") is never their photo.
    if (/['’]s\b/i.test(title.split('/')[0]) || /\b(mother|father|parents?|wife|husband|son|daughter|sister|brother|family|children|wand|house|home|room|ghost|portrait|statue|grave|patronus|boggart|timeline|relationship|appearances?|quotes?)\b/i.test(title.split('/')[0])) continue;
    const exact = got.length === want.length && !title.includes('/');
    const rank = exact && !bracket ? 0 : exact ? 1 : 2;
    if (!best || rank < best.rank) best = { rank, url, page: title };
    if (rank === 0) break;
  }
  return best && { url: best.url, page: best.page };
}

/** Fan wikis to try for a book: the one the X-Ray named, else a guess from its series or title. */
export function wikisFor(book, wiki) {
  const slug = (s) => wikiName(mainTitle(String(s || '')).replace(/[^\p{L}\p{N}]+/gu, ''));
  return [...new Set([wikiName(wiki), slug(book?.series), slug(book?.title)].filter(Boolean))].slice(0, 2);
}

async function fromFandom(x, book, wiki) {
  for (const w of wikisFor(book, wiki)) {
    const api = `https://${w}.fandom.com/api.php?`;
    const base = { action: 'query', format: 'json', origin: '*', prop: 'pageimages', piprop: 'thumbnail', pithumbsize: 300 };
    // The person's own page by name first (redirects followed: "Hermione" → "Hermione Granger"),
    // then a search — a search for "Harry Potter" puts the book series first.
    for (const ask of [{ titles: `${x.name}|${x.name} (character)`, redirects: 1 }, { generator: 'search', gsrsearch: x.name, gsrlimit: 5 }]) {
      try {
        const d = await getJson(api + qs({ ...base, ...ask }), { timeout: 8000 });
        const pages = Object.values(d?.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
        const hit = pickFandom(pages, x.name);
        if (hit) return { ...hit, from: 'Fandom' };
      } catch {}
    }
  }
  return null;
}

/** A photo for someone in a book's X-Ray: { url, page, from } or null (from what's kept when it can). */
export async function photoFor(x, book, wiki = '') {
  const key = `v4|${mainTitle(book?.title || '').toLowerCase()}|${String(x.name).toLowerCase()}`;
  const hit = kept.get()[key];
  if (hit && Date.now() - hit.t < MONTH) return hit.url ? hit : null;
  let found = x.kind === 'real' ? null : await fromFandom(x, book, wiki);
  if (!found) try {
    const search = x.kind === 'real' ? x.name : `${x.name} ${mainTitle(book?.title || '')} character`;
    const d = await getJson('https://en.wikipedia.org/w/api.php?' + qs({ action: 'query', format: 'json', origin: '*', generator: 'search', gsrsearch: search, gsrlimit: 6, prop: 'pageimages|description', piprop: 'thumbnail', pithumbsize: 300 }), { timeout: 10000 });
    const pages = Object.values(d?.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
    found = pickPage(pages, x.name, x.kind === 'real' ? 'real' : 'fictional');
    if (found) found.from = 'Wikipedia';
  } catch {
    return null; // not reachable now: asked again next time, nothing kept
  }
  kept.set((all) => {
    const next = { ...all, [key]: { ...(found || { url: '' }), t: Date.now() } };
    const keys = Object.keys(next);
    if (keys.length > 600) keys.sort((a, b) => next[a].t - next[b].t).slice(0, keys.length - 600).forEach((k) => delete next[k]);
    return next;
  });
  return found;
}
