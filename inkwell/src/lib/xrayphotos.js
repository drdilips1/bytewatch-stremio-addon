// Photos in X-Ray, the way author and narrator photos are found: Wikipedia's own page images
// (only pictures Wikipedia may show freely). Real people get their page's photo; a fictional
// character only when Wikipedia has a page for that character (a book or film / TV adaptation)
// with a free picture — otherwise the portrait stays the initials in the person's colour. Never
// AI-made faces. Found once per book and name, kept on this phone (misses too, for a month).
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

/** A photo for someone in a book's X-Ray: { url, page } or null (from what's kept when it can). */
export async function photoFor(x, book) {
  const key = `${mainTitle(book?.title || '').toLowerCase()}|${String(x.name).toLowerCase()}`;
  const hit = kept.get()[key];
  if (hit && Date.now() - hit.t < MONTH) return hit.url ? hit : null;
  let found = null;
  try {
    const search = x.kind === 'real' ? x.name : `${x.name} ${mainTitle(book?.title || '')} character`;
    const d = await getJson('https://en.wikipedia.org/w/api.php?' + qs({ action: 'query', format: 'json', origin: '*', generator: 'search', gsrsearch: search, gsrlimit: 6, prop: 'pageimages|description', piprop: 'thumbnail', pithumbsize: 300 }), { timeout: 10000 });
    const pages = Object.values(d?.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
    found = pickPage(pages, x.name, x.kind === 'real' ? 'real' : 'fictional');
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
