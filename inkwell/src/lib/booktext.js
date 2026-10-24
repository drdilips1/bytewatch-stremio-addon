// The book's own words for the live transcript. Speech recognition gets names and
// unusual words wrong; when the same book's ebook is on the phone (kept, in a phone
// folder, or in the audiobook's own folder), each recognised line is found in the
// ebook and its real words are shown instead — recognition only supplies the timing.
import { savedEbooks, loadCloudEbook, cloudReaderBook, directEbookFile, directReaderBook } from './epub.js';
import { localCfg } from '../sources/local.js';
import { mainTitle, matches } from './match.js';
import { persisted } from './store.js';
import { findOrder, autoEbook } from './findorder.js';

/** Ebooks you chose for an audiobook's transcript: audiobook uid -> ebook (book summary). */
export const ebookLinks = persisted('ebookLinks', {});
export const linkEbook = (audioUid, ebook) => ebookLinks.set((all) => ({ ...all, [audioUid]: ebook }));
import { paragraphs } from './tts.js';

const surname = (a) => String(a || '').split(',')[0].trim().split(/\s+/).pop()?.toLowerCase() || '';
const norm = (w) => w.toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}']/gu, '');

/** The ebook of this audiobook, if one is on hand. */
export function ebookFor(book) {
  const linked = ebookLinks.get()[book.uid];
  if (linked) return linked;
  const own = (book.ebooks || []).find((f) => f.format === 'EPUB');
  if (own) return cloudReaderBook(book, own);
  const t = mainTitle(book.title || '');
  if (!t) return null;
  const sn = surname(book.author);
  const same = (b) => b && matches(t, `${b.title || ''} ${b.ebookName || ''}`) && (!sn || !b.author || String(b.author).toLowerCase().includes(sn));
  const list = [...Object.values(savedEbooks.get()).map((x) => x?.book), ...(localCfg.get().books || []).filter((b) => b.kind === 'text')].filter(same);
  // EPUB first: a PDF's text is often broken up by page headers.
  return list.find((b) => (b.ebookFormat || b.format) !== 'PDF') || list[0] || null;
}

/** Load the ebook's words and an index of word triples → positions. */
export async function loadBookText(book) {
  const eb = ebookFor(book) || (autoEbook() ? await autoFindEbook(book) : null);
  if (!eb) return null;
  return textOfEbook(eb);
}

/** An ebook of yours (linked, kept, on the phone) with this title — one book of a series, say. */
export function ebookByTitle(title, author = '') {
  const t = mainTitle(title || '');
  if (!t) return null;
  const sn = surname(author);
  const same = (b) => b && matches(t, `${b.title || ''} ${b.ebookName || ''}`) && (!sn || !b.author || String(b.author).toLowerCase().includes(sn));
  const list = [...Object.values(ebookLinks.get()), ...Object.values(savedEbooks.get()).map((x) => x?.book), ...(localCfg.get().books || []).filter((b) => b.kind === 'text')].filter(same);
  return list.find((b) => (b.ebookFormat || b.format) !== 'PDF') || list[0] || null;
}

/** The words of one ebook, with the index used to find lines in it. */
export async function textOfEbook(eb) {
  const doc = await loadCloudEbook(eb);
  // Everything, title page and contents included: the narrator reads those too.
  const tokens = paragraphs(doc.html)
    .map((p) => p.text)
    .join(' ')
    .split(/\s+/)
    .filter(Boolean);
  const keys = tokens.map(norm);
  const index = new Map();
  // Word pairs too: a line with a couple of misheard words still has some pairs right.
  const pairs = new Map();
  for (let i = 0; i + 1 < keys.length; i++) {
    if (!keys[i] || !keys[i + 1]) continue;
    const k2 = `${keys[i]} ${keys[i + 1]}`;
    const at2 = pairs.get(k2);
    if (!at2) pairs.set(k2, [i]);
    else if (at2.length < 80) at2.push(i);
    if (!keys[i + 2]) continue;
    const k = `${k2} ${keys[i + 2]}`;
    const at = index.get(k);
    if (!at) index.set(k, [i]);
    else if (at.length < 40) at.push(i); // very common phrases tell us little
  }
  if (tokens.length < 50) throw new Error('No readable text in that ebook');
  return { tokens, keys, index, pairs, title: eb.title };
}

/**
 * Where a recognised line is in the book: { from, to } word positions, or null.
 * `near`: where the previous line ended — searched first, the whole book after.
 */
export function locate(bt, text, near = null, guess = null) {
  const seg = String(text || '').split(/\s+/).map(norm).filter(Boolean);
  if (seg.length < 2) return null;
  // Votes for where the line starts in the book, from matching word runs (n words long).
  const vote = (n, lo, hi) => {
    const map = n === 3 ? bt.index : bt.pairs;
    if (!map) return { n: 0 };
    const votes = new Map();
    const hits = [];
    for (let j = 0; j + n <= seg.length; j++) {
      for (const p of map.get(seg.slice(j, j + n).join(' ')) || []) {
        if (p < lo || p > hi) continue;
        hits.push([p, j]);
        // Nearby starts count together (a word missed or added shifts it by one or two).
        const off = p - j;
        votes.set(off, (votes.get(off) || 0) + 1);
      }
    }
    let best = null;
    let c = 0;
    for (const [off] of votes) {
      const v = (votes.get(off - 2) || 0) + (votes.get(off - 1) || 0) + votes.get(off) + (votes.get(off + 1) || 0) + (votes.get(off + 2) || 0);
      if (v > c || (v === c && best != null && Math.abs(off - (near ?? guess ?? off)) < Math.abs(best - (near ?? guess ?? best)))) (best = off), (c = v);
    }
    // The line's ends, measured from the matches nearest each end (the book and the
    // recognised words rarely have the same number of words in between).
    const ok = hits.filter(([p, j]) => Math.abs(p - j - best) <= 8).sort((x, y) => x[1] - y[1]);
    const first = ok[0];
    const last = ok[ok.length - 1];
    return { best, n: c, from: first ? first[0] - first[1] : best, to: last ? last[0] + seg.length - last[1] : best + seg.length };
  };
  const tries = [];
  // Just after the line before: word triples, then (closer in) word pairs.
  if (near != null) tries.push([3, near - 400, near + 4000, 2], [2, near - 60, near + 400, 3]);
  // Roughly where the audio is in the book (from how far in you are): a wider stretch.
  if (guess != null) {
    const span = Math.max(1500, Math.round(bt.tokens.length * 0.06));
    tries.push([3, guess - span, guess + span, 2], [2, guess - span, guess + span, 4]);
  }
  // Anywhere in the book: a few triples must agree, else it's a guess.
  tries.push([3, 0, Infinity, Math.min(3, Math.max(2, seg.length - 2))]);
  for (const [n, lo, hi, need] of tries) {
    if (seg.length < n + (n === 2 ? 1 : 0)) continue;
    const r = vote(n, lo, hi);
    if (r.n >= need && r.best != null) {
      const from = Math.max(0, r.from);
      return { from, to: Math.max(from + 1, Math.min(bt.tokens.length, r.to)) };
    }
  }
  return null;
}

/**
 * This book's ebook in your source results: direct EPUB links first (then PDF),
 * as [{ r, file, book }] ready to download and keep.
 */
export async function findEbookInSources(book) {
  const { searchSources } = await import('../sources/sourceaddons.js');
  const t = mainTitle(book.title || '');
  const sn = surname(book.author);
  const found = [];
  const take = (name, results) => {
    for (const r of results || []) {
      const file = !(r.magnet || r.hash) && directEbookFile(r);
      if (!file || (file.format !== 'EPUB' && file.format !== 'PDF')) continue;
      if (t && !matches(t, `${r.title || ''} ${file.name}`)) continue;
      if (found.some((x) => x.r.link === r.link)) continue;
      found.push({ r, file, source: name, book: directReaderBook(r, file, book) });
    }
  };
  // Two searches, like the main search box: the clean title (no "Unabridged" etc.) with
  // the author, and the plain words "title surname" — between them far more ebook links.
  await Promise.all([
    searchSources({ title: t, author: book.author || '', query: '' }, take),
    searchSources({ title: '', author: '', query: `${t} ${sn}`.trim() }, take),
  ]);
  return found.sort((a, b) => (a.file.format === 'EPUB' ? 0 : 1) - (b.file.format === 'EPUB' ? 0 : 1));
}

/** Ebooks already on the phone (saved, phone folders, added files): this book's first. */
export function ebooksOnHand(book) {
  const t = mainTitle(book.title || '');
  const seen = new Set();
  const all = [...Object.values(savedEbooks.get()).map((x) => x?.book), ...(localCfg.get().books || []).filter((b) => b.kind === 'text')].filter(
    (b) => b && !seen.has(b.uid) && seen.add(b.uid)
  );
  const hit = (b) => (t && matches(t, `${b.title || ''} ${b.ebookName || ''}`) ? 0 : 1);
  return all.sort((a, b) => hit(a) - hit(b));
}

/** Download a found ebook, keep it on the phone and use it for this audiobook's transcript. */
export async function keepFoundEbook(audioUid, hit) {
  await loadCloudEbook(hit.book);
  linkEbook(audioUid, hit.book);
}

// ---- Finding the ebook by itself -------------------------------------------------
// When an audiobook plays, its ebook is looked for in the order set in Settings (phone,
// sources, TorBox / Real-Debrid, Audiobookshelf by default), kept on the phone and
// attached to the transcript. Only what's ready: nothing new is added to a debrid service.
const tried = persisted('ebookTried', {}); // audiobook uid -> when nothing was found (looked again after a day)
const finding = new Map();

/** Find, keep and attach this audiobook's ebook; resolves the ebook (book summary) or null. */
export function autoFindEbook(book) {
  if (!book?.uid || book.source === 'pod' || book.kind === 'text') return Promise.resolve(null);
  const have = ebookFor(book);
  if (have) return Promise.resolve(have);
  if (Date.now() - (tried.get()[book.uid] || 0) < 86400e3) return Promise.resolve(null);
  if (!finding.has(book.uid))
    finding.set(
      book.uid,
      lookEverywhere(book)
        .then((eb) => {
          if (eb) linkEbook(book.uid, eb);
          else tried.set((all) => ({ ...Object.fromEntries(Object.entries(all).slice(-200)), [book.uid]: Date.now() }));
          return eb;
        })
        .catch(() => null)
        .finally(() => finding.delete(book.uid))
    );
  return finding.get(book.uid);
}

async function lookEverywhere(book) {
  const t = mainTitle(book.title || '');
  if (!t) return null;
  const sn = surname(book.author);
  const same = (b) => b && matches(t, `${b.title || ''} ${b.rawName || ''} ${b.ebookName || ''}`) && (!sn || !b.author || String(b.author).toLowerCase().includes(sn));
  const { getDetails, findOwned } = await import('../sources/index.js');
  let owned = null;
  const mine = async () => (owned ||= await findOwned({ title: book.title, author: book.author || '' }).catch(() => ({ server: [], cloud: [] })));
  // An EPUB (else a PDF) in a book of yours: kept on the phone for next time.
  const fromCopy = async (b) => {
    const d = await getDetails(b).catch(() => null);
    const files = d?.ebooks || [];
    const file = files.find((f) => f.format === 'EPUB') || files.find((f) => f.format === 'PDF');
    if (!file) return null;
    const rb = cloudReaderBook(d, file);
    await loadCloudEbook(rb);
    return rb;
  };
  for (const place of findOrder('ebook')) {
    try {
      if (place === 'local') {
        const eb = ebookFor(book);
        if (eb) return eb;
      } else if (place === 'sources') {
        const hits = await findEbookInSources(book);
        if (hits[0]) {
          await loadCloudEbook(hits[0].book);
          return hits[0].book;
        }
      } else if (place === 'debrid' || place === 'abs') {
        const o = await mine();
        for (const b of (place === 'abs' ? o.server : o.cloud).filter(same)) {
          const eb = await fromCopy(b);
          if (eb) return eb;
        }
      }
    } catch {}
  }
  return null;
}
