// Audibrisk's brain: the audio sources (installed once, quietly), finding the best copy of a book,
// getting it ready on your debrid service, and remembering which copy each book played from.
import { persisted, addons, progress } from '../src/lib/store.js';
import { debrid } from '../src/lib/store.js';
import { audible } from '../src/sources/catalogs.js';
import { getDetails } from '../src/sources/index.js';
import * as cloud from '../src/sources/debrid.js';
import { searchSources, sureMatches } from '../src/sources/sourceaddons.js';
import { searchTitle, matches } from '../src/lib/match.js';
import { downloads, downloadBook, canDownload } from '../src/lib/downloads.js';
import * as player from '../src/lib/player.js';
import bundle from './audio-sources.json';
import { getJson, qs } from '../src/lib/http.js';
import { findMissingCovers, coverNow } from '../src/lib/meta.js';

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
const ARCHIVE = /\b(rar|zip|7z|iso)\b/i;
const AUDIO_FILE = /\.(mp3|m4b|m4a|aac|flac|ogg|oga|opus|wav|wma|mka)$/i;
const ARCHIVE_FILE = /\.(rar|r\d\d|zip|7z|iso)$/i;
const rank = (r) =>
  (r.cache?.any ? 1000 : 0) + (/\bm4b\b/i.test(`${r.format} ${r.title}`) ? 40 : 0) + (AUDIO.test(`${r.format} ${r.title}`) ? 20 : 0) + Math.min(30, (r.seeders || 0) / 3) + (r.score || 0) * 10;

/** Every copy of this book the sources found, best first (instantly ready ones on top). */
export function findCopies(book, onUpdate) {
  // The catalogue's title tidied for torrent sites: no "(Full-Cast Edition)" / subtitle, plain apostrophes.
  const title = searchTitle(book.title).replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
  const author = String(book.author || '').split(',')[0].trim();
  const surname = author.split(/\s+/).pop() || '';
  const all = new Map();
  const list = () => {
    const found = [...all.values()].flat().filter((r) => (r.hash || r.magnet) && !EBOOK.test(`${r.format || ''}`) && !ARCHIVE.test(`${r.format || ''} ${r.title || ''}`) && r.contentType !== 'ebook');
    let sure = sureMatches(found, title, author);
    // Nothing certain: results whose name has the whole title still count (author missing from the name).
    if (!sure.length) sure = found.filter((r) => matches(title, `${r.title} ${r.author || ''}`));
    const seen = new Set();
    return sure.filter((r) => !seen.has(r.hash || r.magnet) && seen.add(r.hash || r.magnet)).sort((a, b) => rank(b) - rank(a));
  };
  const run = (params, key) =>
    searchSources(params, (name, results) => {
      all.set(key + name, results || []);
      onUpdate?.(list());
    });
  return run({ title, author, query: `${title} ${surname}`.trim() }, 'a:')
    .then(() => (list().length ? null : run({ title, query: title }, 'b:')))
    .then(list);
}

// Which copy each book played from (Audible id → the debrid book), so it opens again at once.
export const links = persisted('briskLinks', {}); // uid -> { uid, title, author, cover, source }
const summary = (d) => ({ uid: d.uid, source: d.source, title: d.title, author: d.author, cover: d.cover, narrator: d.narrator || '' });

/** The playable book for a copy: put on your debrid service, then its parts listed. */
async function ready(book, r, onStatus) {
  const stub = await cloud.prepareMagnet(provider(), r, (text, pct) => onStatus?.(text, pct));
  const d = await getDetails({ ...stub, title: book.title, author: book.author, narrator: book.narrator, cover: book.cover, description: book.description });
  if (!d?.tracks?.length && !d?.resolveTracks) throw new Error('That copy has no playable audio files');
  return { ...d, title: book.title, author: book.author || d.author, cover: book.cover || d.cover, narrator: book.narrator || d.narrator };
}

/**
 * What TorBox already holds for these copies, with their files: hash -> 'audio' (playable files
 * inside) | 'archive' (only RAR / ZIP — can't stream) | absent (not ready there yet).
 */
async function inspect(list) {
  if (provider() !== 'torbox') return {};
  const hashes = [...new Set(list.map((r) => String(r.hash || '').toLowerCase()).filter(Boolean))].slice(0, 40);
  if (!hashes.length) return {};
  try {
    const r = await getJson('https://api.torbox.app/v1/api/torrents/checkcached?' + qs({ hash: hashes.join(','), format: 'list', list_files: 'true' }), {
      headers: { Authorization: `Bearer ${debrid.get().torbox}` },
      fresh: true,
      timeout: 15000,
    });
    const out = {};
    const items = Array.isArray(r?.data) ? r.data : Object.entries(r?.data || {}).map(([hash, v]) => ({ hash, ...v }));
    for (const it of items) {
      const names = (it.files || []).map((f) => String(f.name || f.short_name || ''));
      out[String(it.hash).toLowerCase()] = names.some((n) => AUDIO_FILE.test(n)) ? 'audio' : names.some((n) => ARCHIVE_FILE.test(n)) ? 'archive' : names.length ? 'other' : 'audio';
    }
    return out;
  } catch {
    return {};
  }
}

/** Errors that mean "this copy is no good, try the next one". */
const wrongCopy = (e) => /no playable audio|ebook, not an audiobook|no magnet|could not fetch|hasn.t listed|has no/i.test(e?.message || '');

/** Details for this book, ready to play: the copy it played from before, your own cloud copy, else the best one found. */
export async function prepare(book, onStatus, copies = null) {
  if (!provider()) throw Object.assign(new Error('Connect TorBox or Real-Debrid first'), { needKey: true });
  const known = links.get()[book.uid];
  if (known) {
    try {
      return await getDetails(known);
    } catch {}
  }
  // Already in your TorBox / Real-Debrid: that copy, at once (not when you picked a copy by hand).
  if (!(copies && copies.length === 1)) {
    const mine = await inMyCloud(book).catch(() => null);
    if (mine) {
      try {
        onStatus?.(`Opening from your ${providerName()}…`);
        const d = await getDetails(mine);
        if (d?.tracks?.length || d?.resolveTracks) {
          const out = { ...d, title: book.title, author: book.author || d.author, cover: book.cover || d.cover, narrator: book.narrator || d.narrator };
          links.set((l) => ({ ...l, [book.uid]: summary(out) }));
          return out;
        }
      } catch {}
    }
  }
  onStatus?.('Looking for the audiobook…');
  const list = copies || (await findCopies(book));
  if (!list.length) throw new Error('No audio copy found for this book');
  // Look inside the copies TorBox already has: playable audio first, archives (RAR / ZIP) never.
  const seen = await inspect(list);
  const h = (r) => String(r.hash || '').toLowerCase();
  const ok = list.filter((r) => seen[h(r)] !== 'archive' && seen[h(r)] !== 'other');
  if (!ok.length) throw new Error('Only archive (RAR / ZIP) copies found — nothing that can stream');
  const tries = [...ok.filter((r) => seen[h(r)] === 'audio'), ...ok.filter((r) => !seen[h(r)] && r.cache?.any), ...ok.filter((r) => !seen[h(r)] && !r.cache?.any).slice(0, 3)].slice(0, copies?.length === 1 ? 1 : 8);
  let lastErr = null;
  let pending = null;
  for (const [i, r] of tries.entries()) {
    try {
      onStatus?.(seen[h(r)] === 'audio' || r.cache?.any ? `Opening on ${providerName()}…` : `Trying copy ${i + 1}…`);
      const d = await ready(book, r, onStatus);
      links.set((l) => ({ ...l, [book.uid]: summary(d) }));
      return d;
    } catch (e) {
      lastErr = e;
      if (e.pending) pending ||= e.pending;
      else if (!wrongCopy(e)) break;
    }
  }
  if (pending) throw new Error(`${providerName()} is downloading it (${Math.round((pending.progress || 0) * 100)}%) — try again in a few minutes`);
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

// ---- your own cloud ----------------------------------------------------------------------------
export const cloudShelf = persisted('briskCloud', { books: [], at: 0 }); // the audiobooks in your debrid, kept for a quick start
let cloudRun = null;
/** The audiobooks already in your TorBox / Real-Debrid (refreshed in the background). */
export function refreshCloud() {
  if (cloudRun || !provider()) return cloudRun || Promise.resolve(cloudShelf.get().books);
  cloudRun = (provider() === 'torbox' ? cloud.torboxLibrary() : cloud.realdebridLibrary())
    .then((list) => {
      const books = (list || []).filter((b) => b?.uid && b.title && b.kind !== 'text' && !b.fetching).map((b) => ({ uid: b.uid, source: b.source, title: b.title, author: b.author || '', narrator: b.narrator || '', cover: b.cover || '', duration: b.duration || 0, addedAt: b.addedAt || 0 }));
      cloudShelf.set({ books, at: Date.now() });
      // Real covers for the ones without (looked up once, quietly).
      setTimeout(() => findMissingCovers(books.filter((b) => !coverNow(b)).slice(0, 40)).catch(() => {}), 1500);
      return books;
    })
    .catch(() => cloudShelf.get().books)
    .finally(() => (cloudRun = null));
  return cloudRun;
}
export const withCover = (b) => ({ ...b, cover: coverNow(b) || b.cover || '' });

/** This book in your own cloud, if it's there. */
export async function inMyCloud(book) {
  const t = searchTitle(book.title);
  let list = cloudShelf.get().books;
  if (!list.length || Date.now() - cloudShelf.get().at > 10 * 60e3) list = await refreshCloud();
  const sn = String(book.author || '').split(',')[0].trim().split(/\s+/).pop()?.toLowerCase() || '';
  const hits = list.filter((b) => matches(t, `${b.title} ${b.author || ''}`));
  return hits.find((b) => !sn || `${b.title} ${b.author}`.toLowerCase().includes(sn)) || hits[0] || null;
}
