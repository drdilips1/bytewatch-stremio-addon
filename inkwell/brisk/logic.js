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
      lv: { key: 'free', label: 'Free' },
      ia: { key: 'free', label: 'Free' },
    }[src] || null
  );
}
