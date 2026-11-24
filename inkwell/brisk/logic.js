// Audibrisk's small rules with no screen, player or network in them — tested in brisk.test.js.

const low = (s) => String(s || '').toLowerCase();
const wordsOf = (s) => low(s).replace(/[’‘']/g, '').split(/[^a-z0-9]+/).filter(Boolean);

/**
 * Search results in the order a listener means them. Typing "everyday" should bring
 * "The Design of Everyday Things" (the word itself, anywhere in the title) above
 * "Everything Is Tuberculosis" (only starts like it). Then whole words in the author's name,
 * then the rest, each group keeping the catalogue's own order. Duplicates (same id) once.
 */
export function rankResults(list, term) {
  const want = wordsOf(term);
  if (!want.length) return list;
  const seen = new Set();
  const score = (b) => {
    const t = wordsOf(b.title);
    const all = new Set([...t, ...wordsOf(b.author), ...wordsOf(b.series)]);
    const last = want[want.length - 1];
    // The last word may still be half typed ("design of every"): a word starting with it counts.
    const has = (w, set, i) => set.has(w) || (i === want.length - 1 && [...set].some((x) => x.startsWith(last) && last.length >= 3));
    const inTitle = want.every((w, i) => has(w, new Set(t), i));
    const whole = want.every((w) => new Set(t).has(w));
    const anywhere = want.every((w, i) => has(w, all, i));
    return (whole ? 3 : 0) + (inTitle ? 2 : 0) + (anywhere ? 1 : 0);
  };
  return list
    .filter((b) => {
      const k = b.uid || `${b.title}|${b.author}`;
      return !seen.has(k) && seen.add(k);
    })
    .map((b, i) => ({ b, i, s: score(b) }))
    .sort((x, y) => y.s - x.s || x.i - y.i)
    .map((x) => x.b);
}

/** Free LibriVox books that fit what you typed: every word in the title or author. */
export function fitsWords(book, term) {
  const have = low(`${book.title} ${book.author}`);
  return low(term).split(/\s+/).filter(Boolean).every((w) => have.includes(w));
}

/**
 * The sources kept the same as the bundle: new ones added, changed ones replaced, retired ones
 * dropped (the old EXTto / RuTracker / personal-worker sources give way to the public ones).
 * Returns the same list when nothing changed, so nothing is saved needlessly.
 */
export function syncSources(list, bundle) {
  const gone = new Set(bundle.retired || []);
  const ours = new Map(bundle.addons.map((m) => [m.id, m]));
  const out = list.filter((a) => !gone.has(a.manifest?.id)).map((a) => (ours.has(a.manifest?.id) ? { ...a, manifest: ours.get(a.manifest.id) } : a));
  const have = new Set(out.map((a) => a.manifest?.id));
  for (const m of bundle.addons) if (!have.has(m.id)) out.push({ kind: 'source', url: '', manifest: m });
  const same = out.length === list.length && out.every((a, i) => JSON.stringify(a.manifest) === JSON.stringify(list[i].manifest));
  return same ? list : out;
}

/** "153 MB", "1.2 GB". */
export const fmtSize = (n) => (!n ? '' : n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`);

/**
 * What a copy's little box says: ready at once, or how many share it, its size and format.
 * No site names — "Instant · 153 MB · M4B" or "42 seeds · 1.2 GB · MP3".
 */
export function copyFacts(r, provider = '') {
  const instant = !!(r.cache?.any || r.mine || (provider && r.cache?.[provider]));
  const fmt = (/\b(m4b|m4a|mp3|flac|opus|aac)\b/i.exec(`${r.format || ''} ${r.title || ''}`) || [])[1];
  return {
    instant,
    line: [instant ? 'Instant' : r.seeders ? `${r.seeders} seed${r.seeders === 1 ? '' : 's'}` : 'No seeds listed', fmtSize(r.size || r.sizeBytes), fmt && fmt.toUpperCase()].filter(Boolean).join(' · '),
  };
}

/**
 * How much to go back after the audio was taken away (a call, a notification sound): 5 s, once,
 * unless the player already went back by itself. `before` is where it stopped, `now` where it
 * carries on (seconds into the book).
 */
export function backAfterInterruption(before, now) {
  if (before == null || now == null) return 0;
  if (now < before - 2) return 0; // already went back
  if (Math.abs(now - before) > 4) return 0; // you moved it yourself meanwhile
  return 5;
}

/**
 * A smaller picture for a small cover: Audible and Apple serve any size, so a 60-px thumbnail
 * loads a 160-px image instead of the 500-px one (much quicker on mobile data).
 * "…/I/51abc._SL500_.jpg" → "…/I/51abc._SL160_.jpg"; "…/600x600bb.jpg" → "…/160x160bb.jpg".
 */
export function thumb(url, px) {
  if (!url || !px) return url || '';
  const u = String(url);
  if (/media-amazon\.com|ssl-images-amazon\.com/.test(u)) {
    return /\._S[LX]\d+_\./.test(u) ? u.replace(/\._S[LX]\d+_\./, `._SL${px}_.`) : u.replace(/\.(jpe?g|png)(\?|$)/i, `._SL${px}_.$1$2`);
  }
  if (/mzstatic\.com/.test(u)) return u.replace(/\/\d+x\d+(bb|cc)?\.(jpe?g|png|webp)/i, `/${px}x${px}bb.$2`);
  return u;
}

/**
 * Where a book in the Library plays from, for the small label on its cover: saved on this
 * phone wins (it plays offline), then a phone folder, your TorBox, your Real-Debrid, or free LibriVox.
 */
export function placeOf(book, saved = false) {
  if (saved || book?.dl?.status === 'done') return { key: 'saved', label: 'Saved' };
  const src = book?.source || String(book?.uid || '').split(':')[0];
  return (
    {
      loc: { key: 'phone', label: 'Phone' },
      tb: { key: 'tb', label: 'TorBox' },
      rd: { key: 'rd', label: 'Real-Debrid' },
      ad: { key: 'ad', label: 'AllDebrid' },
      pm: { key: 'pm', label: 'Premiumize' },
      lv: { key: 'free', label: 'Free' },
      ia: { key: 'free', label: 'Free' },
    }[src] || null
  );
}

/** Is version a newer than b? Compared as numbers: "1.0.12" is newer than "1.0.9". */
export function newer(a, b) {
  const x = String(a).split('.').map(Number);
  const y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

/**
 * Free LibriVox books among the paid listings: a couple of them inside the top 10 (3rd and 7th),
 * the rest at the end — so "pride and prejudice" shows the free recording near the top, not under
 * thirty paid editions. With no debrid connected, free books come first (they're all that plays).
 */
export function mixFree(paid, free, { hasDebrid = true } = {}) {
  if (!hasDebrid) return [...free, ...paid];
  const out = [...paid];
  const top = free.slice(0, 2);
  [2, 6].forEach((at, i) => top[i] && out.splice(Math.min(at, out.length), 0, top[i]));
  return [...out, ...free.slice(2)];
}

/**
 * Deep Search asks for copies ready on the service you use: Real-Debrid when that's yours (and
 * TorBox isn't connected), TorBox otherwise (Ink & Echo knows only these two; AllDebrid /
 * Premiumize users get TorBox's list, which still finds the copies).
 */
export function deepSearchFor(manifest, service) {
  const req = manifest?.adapters?.source?.request;
  if (!req?.url || !/inkandecho/.test(req.url)) return manifest;
  const u = new URL(req.url);
  if (service === 'realdebrid') {
    u.searchParams.set('debrid', 'realdebrid');
    u.searchParams.delete('torboxTier');
  } else {
    u.searchParams.set('debrid', 'torbox');
    if (!u.searchParams.has('torboxTier')) u.searchParams.set('torboxTier', 'standard');
  }
  const url = u.toString();
  if (url === req.url) return manifest;
  return { ...manifest, debrid: service === 'realdebrid' ? 'realdebrid' : 'torbox', adapters: { ...manifest.adapters, source: { ...manifest.adapters.source, request: { ...req, url } } } };
}

/**
 * The copies to try after one failed: not the ones already tried, ready-on-your-service ones
 * first (they start at once), then the rest in their found order; at most `max`.
 */
export function rescueOrder(copies, tried = new Set(), max = 4) {
  const key = (r) => String(r.hash || r.magnet || r.title || '').toLowerCase();
  const left = copies.filter((r) => key(r) && !tried.has(key(r)));
  return [...left.filter((r) => r.cache?.any), ...left.filter((r) => !r.cache?.any)].slice(0, max);
}
export const copyKey = (r) => String(r?.hash || r?.magnet || r?.title || '').toLowerCase();

// ---- chapter names for books split into many files -----------------------------------------
/** A file name that says nothing: "Track 01", "02", "Part 3", "Disc 1 - 04", "The Hobbit 07". */
export function genericPart(title, bookTitle = '') {
  let t = String(title || '').toLowerCase().replace(/\.[a-z0-9]{2,4}$/, '');
  const bt = String(bookTitle || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim();
  t = t.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (bt && t.startsWith(bt)) t = t.slice(bt.length).trim();
  return /^((track|part|pt|chapter|ch|cd|disc|disk|file|section)\s*)?\d{1,3}(\s*(of\s*)?\d{0,3})?$/.test(t) || /^(cd|disc|disk)\s*\d+\s*(track\s*)?\d+$/.test(t) || t === '';
}

/**
 * The published chapters (Audible's list: [{ title, lengthMs }]) put on a book whose files have
 * meaningless names. Same count → each file gets its chapter's name. Otherwise, when every file's
 * length is known and the whole matches within 8% → chapter marks by time (another edition, whose
 * length differs, gets nothing rather than marks in the wrong places).
 */
export function applyChapters(details, chapters) {
  const tracks = details?.tracks || [];
  if (tracks.length < 2 || !chapters?.length || details.chaptersMeta?.length) return details;
  if (!tracks.every((t) => genericPart(t.title, details.title))) return details;
  if (chapters.length === tracks.length) return { ...details, tracks: tracks.map((t, i) => ({ ...t, title: chapters[i].title || t.title })) };
  const total = tracks.reduce((a, t) => a + (t.duration || 0), 0);
  const published = chapters.reduce((a, c) => a + (c.lengthMs || 0), 0) / 1000;
  if (!tracks.every((t) => t.duration > 0) || !published || Math.abs(1 - total / published) > 0.08) return details;
  const k = total / published;
  let at = 0;
  const chaptersMeta = chapters.map((c, i) => {
    const start = at * k;
    at += (c.lengthMs || 0) / 1000;
    return { title: c.title || `Chapter ${i + 1}`, start, end: at * k, published: true };
  });
  return { ...details, chaptersMeta };
}

// ---- the next book of a series ---------------------------------------------------------------
/** "The Expanse #3" → { name: 'The Expanse', n: 3 } (or null). */
export function seriesOf(text) {
  const m = /^(.*?)\s*(?:#|book\s+|,\s*book\s+)(\d+(?:\.\d+)?)\s*$/i.exec(String(text || '').trim());
  return m ? { name: m[1].trim(), n: parseFloat(m[2]) } : null;
}
/** The next one after number n, in a series list (each with seriesN), or null. */
export function nextInSeries(list, n) {
  return (list || []).filter((b) => b.seriesN > n).sort((a, b) => a.seriesN - b.seriesN)[0] || null;
}

// ---- remembering which copies and sources worked ----------------------------------------------
/** Extra points for a copy (and its source) by how it went before: played → up, failed → down. */
export function healthBonus(copy = {}, source = {}) {
  const c = Math.min(90, (copy.ok || 0) * 30) - (copy.fail || 0) * 150;
  const s = Math.max(-40, Math.min(20, ((source.ok || 0) - (source.fail || 0) * 2) * 2));
  return c + s;
}

/** Audible's rating as one small line: "★ 4.8 · 120k" ("" when it has none). */
export function fmtRating(b) {
  const r = Number(b?.rating) || 0;
  if (!r) return '';
  const n = Number(b?.ratings) || 0;
  const count = n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : n ? String(n) : '';
  return `★ ${r.toFixed(1)}${count ? ` · ${count}` : ''}`;
}

/** Books of yours (cloud, phone, saved) that fit what you typed — shown first in search. */
export function libraryMatches(books, term, max = 4) {
  const seen = new Set();
  return (books || []).filter((b) => b?.title && fitsWords(b, term) && !seen.has(b.uid) && seen.add(b.uid)).slice(0, max);
}
