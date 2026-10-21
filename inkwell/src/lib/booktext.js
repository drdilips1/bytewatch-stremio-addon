// The book's own words for the live transcript. Speech recognition gets names and
// unusual words wrong; when the same book's ebook is on the phone (kept, in a phone
// folder, or in the audiobook's own folder), each recognised line is found in the
// ebook and its real words are shown instead — recognition only supplies the timing.
import { savedEbooks, loadCloudEbook, cloudReaderBook } from './epub.js';
import { localCfg } from '../sources/local.js';
import { mainTitle, matches } from './match.js';
import { paragraphs, listenParagraphs } from './tts.js';

const surname = (a) => String(a || '').split(',')[0].trim().split(/\s+/).pop()?.toLowerCase() || '';
const norm = (w) => w.toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}']/gu, '');

/** The ebook of this audiobook, if one is on hand. */
export function ebookFor(book) {
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
  const eb = ebookFor(book);
  if (!eb) return null;
  const doc = await loadCloudEbook(eb);
  const tokens = listenParagraphs(paragraphs(doc.html))
    .map((p) => p.text)
    .join(' ')
    .split(/\s+/)
    .filter(Boolean);
  const keys = tokens.map(norm);
  const index = new Map();
  for (let i = 0; i + 2 < keys.length; i++) {
    if (!keys[i] || !keys[i + 1] || !keys[i + 2]) continue;
    const k = `${keys[i]} ${keys[i + 1]} ${keys[i + 2]}`;
    const at = index.get(k);
    if (!at) index.set(k, [i]);
    else if (at.length < 40) at.push(i); // very common phrases tell us little
  }
  return { tokens, keys, index, title: eb.title };
}

/**
 * Where a recognised line is in the book: { from, to } word positions, or null.
 * `near`: where the previous line ended — searched first, the whole book after.
 */
export function locate(bt, text, near = null) {
  const seg = String(text || '').split(/\s+/).map(norm).filter(Boolean);
  if (seg.length < 3) return null;
  const vote = (lo, hi) => {
    const votes = new Map();
    const hits = [];
    for (let j = 0; j + 2 < seg.length; j++) {
      for (const p of bt.index.get(`${seg[j]} ${seg[j + 1]} ${seg[j + 2]}`) || []) {
        if (p < lo || p > hi) continue;
        hits.push([p, j]);
        votes.set(p - j, (votes.get(p - j) || 0) + 1);
      }
    }
    let best = null;
    let n = 0;
    for (const [off, c] of votes) if (c > n) (best = off), (n = c);
    // The line's ends, measured from the matches nearest each end (the book and the
    // recognised words rarely have the same number of words in between).
    const ok = hits.filter(([p, j]) => Math.abs(p - j - best) <= 8).sort((x, y) => x[1] - y[1]);
    const first = ok[0];
    const last = ok[ok.length - 1];
    return { best, n, from: first ? first[0] - first[1] : best, to: last ? last[0] + seg.length - last[1] : best + seg.length };
  };
  let r = near != null ? vote(near - 400, near + 4000) : { n: 0 };
  if (r.n < 2) r = vote(0, Infinity);
  // Need a few matching triples (more for a whole-book search), else it's a guess.
  const need = near != null ? 2 : Math.min(3, seg.length - 2);
  if (r.n < need || r.best == null) return null;
  const from = Math.max(0, r.from);
  return { from, to: Math.max(from + 1, Math.min(bt.tokens.length, r.to)) };
}
