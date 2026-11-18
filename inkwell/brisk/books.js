// Audibrisk's brain: the audio sources (installed once, quietly), finding the best copy of a book,
// getting it ready on your debrid service, and remembering which copy each book played from.
import { persisted, addons, progress } from '../src/lib/store.js';
import { debrid } from '../src/lib/store.js';
import { audible } from '../src/sources/catalogs.js';
import { getDetails } from '../src/sources/index.js';
import * as cloud from '../src/sources/debrid.js';
import { searchSources, sureMatches } from '../src/sources/sourceaddons.js';
import { downloads, downloadBook, canDownload } from '../src/lib/downloads.js';
import * as player from '../src/lib/player.js';
import bundle from './audio-sources.json';

/** The audio-only sources, added the first time (and any new ones after an update). */
export function installSources() {
  try {
    const have = new Set(addons.get().map((a) => a.manifest?.id));
    const add = bundle.addons.filter((m) => !have.has(m.id));
    if (add.length) addons.set((list) => [...list, ...add.map((manifest) => ({ kind: 'source', url: '', manifest }))]);
  } catch {}
}

// ---- your debrid service (one at a time) ----------------------------------------------------
export const provider = () => (cloud.tbConnected() ? 'torbox' : cloud.rdConnected() ? 'realdebrid' : '');
export const providerName = () => ({ torbox: 'TorBox', realdebrid: 'Real-Debrid' })[provider()] || '';
export async function connect(which, key) {
  key = String(key || '').trim();
  if (!key) throw new Error('Paste your API key');
  const ok = await cloud.verify(which, key).catch((e) => {
    throw new Error(e?.message || 'That key didn’t work');
  });
  if (ok === false) throw new Error('That key didn’t work');
  debrid.set((d) => ({ ...d, torbox: which === 'torbox' ? key : '', realdebrid: which === 'realdebrid' ? key : '' }));
}
export const disconnect = () => debrid.set((d) => ({ ...d, torbox: '', realdebrid: '' }));

// ---- search ----------------------------------------------------------------------------------
const cache = new Map();
export async function searchBooks(term) {
  const q = term.trim();
  if (!q) return [];
  if (cache.has(q)) return cache.get(q);
  const list = (await audible.search(q).catch(() => [])).filter((b) => b.title);
  cache.set(q, list);
  return list;
}

// ---- copies ------------------------------------------------------------------------------------
const AUDIO = /\b(m4b|m4a|mp3|aac|flac|opus|audiobook|unabridged)\b/i;
const EBOOK = /\b(epub|pdf|mobi|azw3?)\b/i;
const rank = (r) =>
  (r.cache?.any ? 1000 : 0) + (/\bm4b\b/i.test(`${r.format} ${r.title}`) ? 40 : 0) + (AUDIO.test(`${r.format} ${r.title}`) ? 20 : 0) + Math.min(30, (r.seeders || 0) / 3) + (r.score || 0) * 10;

/** Every copy of this book the sources found, best first (instantly ready ones on top). */
export function findCopies(book, onUpdate) {
  const all = new Map();
  const params = { title: book.title, author: String(book.author || '').split(',')[0], query: `${book.title} ${String(book.author || '').split(',')[0]}`.trim() };
  const list = () =>
    sureMatches([...all.values()].flat(), book.title, book.author)
      .filter((r) => (r.hash || r.magnet) && !EBOOK.test(`${r.format || ''}`) && r.contentType !== 'ebook')
      .sort((a, b) => rank(b) - rank(a));
  return searchSources(params, (name, results) => {
    all.set(name, results || []);
    onUpdate?.(list());
  }).then(list);
}

// Which copy each book played from (Audible id → the debrid book), so it opens again at once.
export const links = persisted('briskLinks', {}); // uid -> { uid, title, author, cover, source }
const summary = (d) => ({ uid: d.uid, source: d.source, title: d.title, author: d.author, cover: d.cover, narrator: d.narrator || '' });

/** The playable book for a copy: put on your debrid service, then its parts listed. */
async function ready(book, r, onStatus) {
  const stub = await cloud.prepareMagnet(provider(), r, (text, pct) => onStatus?.(text, pct));
  const d = await getDetails({ ...stub, title: book.title, author: book.author, narrator: book.narrator, cover: book.cover, description: book.description });
  return { ...d, title: book.title, author: book.author || d.author, cover: book.cover || d.cover, narrator: book.narrator || d.narrator };
}

/** Details for this book, ready to play: the copy it played from before, else the best one found. */
export async function prepare(book, onStatus, copies = null) {
  if (!provider()) throw Object.assign(new Error('Connect TorBox or Real-Debrid first'), { needKey: true });
  const known = links.get()[book.uid];
  if (known) {
    try {
      return await getDetails(known);
    } catch {}
  }
  onStatus?.('Looking for the audiobook…');
  const list = copies || (await findCopies(book));
  if (!list.length) throw new Error('No audio copy found for this book');
  let lastErr = null;
  // Ready-to-stream copies first (up to three), then the best of the rest.
  const tries = [...list.filter((r) => r.cache?.any).slice(0, 3), ...list.filter((r) => !r.cache?.any).slice(0, 1)];
  for (const r of tries) {
    try {
      onStatus?.(r.cache?.any ? `Opening on ${providerName()}…` : `${providerName()} is fetching it…`);
      const d = await ready(book, r, onStatus);
      links.set((l) => ({ ...l, [book.uid]: summary(d) }));
      return d;
    } catch (e) {
      lastErr = e;
      if (e.pending) throw new Error(`${providerName()} is downloading it (${Math.round((e.pending.progress || 0) * 100)}%) — try again in a few minutes`);
    }
  }
  throw lastErr || new Error('Couldn’t open this book');
}

export async function play(book, onStatus, copies) {
  const d = await prepare(book, onStatus, copies);
  player.playBook(d, { exact: true });
  return d;
}

export async function save(book, onStatus, copies) {
  if (!canDownload) throw new Error('Saving for offline works in the Android app');
  const d = await prepare(book, onStatus, copies);
  downloadBook(d).catch(() => {});
  return d;
}

/** The debrid book this one plays from, if it's known. */
export const linkOf = (book) => links.get()[book?.uid] || null;
export const savedOf = (book) => {
  const l = linkOf(book);
  return l ? downloads.get()[l.uid] : null;
};

/** Books you're in the middle of, most recent first. */
export function continuing(all = progress.get()) {
  return Object.entries(all)
    .filter(([, p]) => p?.book?.title && p.kind !== 'text' && !p.finished && !p.hidden && (p.percent || 0) > 0.002)
    .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
    .slice(0, 12)
    .map(([uid, p]) => ({ ...p.book, uid, percent: p.percent || 0 }));
}

/** Books saved on this phone. */
export const offline = (all = downloads.get()) =>
  Object.values(all)
    .filter((d) => d?.book && (d.status === 'done' || d.status === 'downloading' || d.status === 'paused'))
    .map((d) => ({ ...d.book, dl: d }));

/** Resume a book from Continue / Offline (its own debrid or phone copy). */
export async function resume(b) {
  const d = b.dl?.status === 'done' ? b.dl.book : await getDetails({ uid: b.uid, source: b.source, title: b.title, author: b.author, cover: b.cover });
  player.playBook({ ...d, title: b.title || d.title, author: b.author || d.author, cover: b.cover || d.cover });
}
