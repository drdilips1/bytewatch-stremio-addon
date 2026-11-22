// Audibrisk's brain: the audio sources (installed once, quietly), finding the best copy of a book,
// getting it ready on your debrid service, and remembering which copy each book played from.
import { persisted, addons, progress } from '../src/lib/store.js';
import { debrid } from '../src/lib/store.js';
import { audible } from '../src/sources/catalogs.js';
import { getDetails } from '../src/sources/index.js';
import * as cloud from '../src/sources/debrid.js';
import { moreConnected, moreLibrary } from '../src/sources/moredebrid.js';
import * as addonStore from '../src/sources/addons.js';
import { searchSources, sureMatches } from '../src/sources/sourceaddons.js';
import { searchTitle, matches } from '../src/lib/match.js';
import { downloads, downloadBook, canDownload } from '../src/lib/downloads.js';
import * as player from '../src/lib/player.js';
import bundle from './audio-sources.json';
import { getJson, qs } from '../src/lib/http.js';
import { coverNow, lookup } from '../src/lib/meta.js';
import * as librivox from '../src/sources/librivox.js';
import * as phone from '../src/sources/local.js';
import { samePhoneBook } from '../src/lib/match.js';
import { registerPlugin } from '@capacitor/core';
import { toast } from '../src/components/common.jsx';
import { rankResults, fitsWords, syncSources, mixFree, deepSearchFor } from './logic.js';

const Web = registerPlugin('InkwellWeb');
// Opening a book never waits for a details lookup (covers, descriptions): what's known already is
// enough to play, and the shared lookup queue stays free.
const FAST = { fast: true };

/**
 * The audio-only sources, kept the same as the bundle on every start: new ones added, changed ones
 * replaced, and old ones dropped by themselves (e.g. the old EXTto and RuTracker sources give way to
 * the public AudiobookBay and Knaben at sources.booksources.workers.dev after an update).
 */
export function installSources(list = addons.get()) {
  try {
    // Deep Search set for the service you connected (Real-Debrid or TorBox).
    const mine = { ...bundle, addons: bundle.addons.map((m) => deepSearchFor(m, provider())) };
    const next = syncSources(list, mine);
    if (next !== list) addons.set(next);
  } catch {}
}

// ---- sources: all searched by themselves; Settings → Sources can turn one off or add your own ----
export const sourcesOff = persisted('briskSourcesOff', {}); // addon id -> true
const isSource = (a) => a?.kind === 'source' || a?.manifest?.provides?.includes?.('source');
/** Every source, built in or yours: { id, name, own, on }. */
export const sourceList = () =>
  addons
    .get()
    .filter(isSource)
    .map((a) => ({ id: a.manifest.id, name: a.manifest.name, own: !bundle.addons.some((m) => m.id === a.manifest.id), on: !sourcesOff.get()[a.manifest.id] }));
/** The names of the sources switched on (what a search asks). */
const sourcesOn = () => sourceList().filter((x) => x.on).map((x) => x.name);
export const toggleSource = (id) => sourcesOff.set((o) => ({ ...o, [id]: !o[id] }));
/** Add a source from its link (a source addon or a collection of them). */
export async function addSource(url) {
  const before = new Set(addons.get().map((a) => a.manifest?.id));
  await addonStore.install(url);
  const fresh = addons.get().filter((a) => !before.has(a.manifest?.id));
  // Catalogue-only addons don't find audiobook copies: not kept.
  fresh.filter((a) => !isSource(a)).forEach((a) => addonStore.uninstall(a.manifest.id));
  const added = fresh.filter(isSource);
  if (!added.length) throw new Error('That link has no audiobook sources Audibrisk can use');
  return added.length;
}
export const removeSource = (id) => addonStore.uninstall(id);

// ---- your debrid services (TorBox, Real-Debrid, or both) -------------------------------------
const NAMES = { torbox: 'TorBox', realdebrid: 'Real-Debrid', alldebrid: 'AllDebrid', premiumize: 'Premiumize' };
export const SERVICES = Object.keys(NAMES);
const SOURCE = { torbox: 'tb', realdebrid: 'rd', alldebrid: 'ad', premiumize: 'pm' }; // the id prefix of its books
/** The service a cloud book lives in ('tb:…' → 'torbox'). */
export const serviceOf = (book) => Object.keys(SOURCE).find((k) => SOURCE[k] === (book?.source || String(book?.uid || '').split(':')[0])) || 'torbox';
const isOn = (p) => (p === 'torbox' ? cloud.tbConnected() : p === 'realdebrid' ? cloud.rdConnected() : moreConnected(p));
/** Every service you connected, TorBox first. */
export const providers = () => SERVICES.filter(isOn);
export const provider = () => providers()[0] || '';
export const nameOf = (p) => NAMES[p] || '';
export const providerName = () => providers().map(nameOf).join(' & ');
export async function connect(which, key) {
  key = String(key || '').trim();
  if (!key) throw new Error('Paste your API key');
  const ok = await cloud.verify(which, key).catch((e) => {
    throw new Error(e?.message || 'That key didn’t work');
  });
  if (ok === false) throw new Error('That key didn’t work');
  debrid.set((d) => ({ ...d, [which]: key }));
  cloudShelf.set({ books: cloudShelf.get().books, at: 0 });
  cache.clear();
  installSources();
}
export const disconnect = (which) => {
  debrid.set((d) => ({ ...d, [which]: '' }));
  cache.clear();
  installSources();
  cloudShelf.set({ books: cloudShelf.get().books.filter((b) => b.source !== SOURCE[which]), at: 0 });
};

// ---- search ----------------------------------------------------------------------------------
const cache = new Map();
/**
 * Audible's listings (its relevance search and its best sellers for the same words, so "everyday"
 * finds The Design of Everyday Things), the word itself in the title first; plus free LibriVox
 * recordings: two of them inside the top 10, all of them first when no debrid is connected.
 */
export async function searchBooks(term) {
  const q = term.trim();
  if (!q) return [];
  if (cache.has(q)) return cache.get(q);
  const [rel, best, free] = await Promise.all([audible.search(q).catch(() => []), audible.genre(q).catch(() => []), freeBooks(q)]);
  const paid = rankResults([...rel, ...best.slice(0, 16)].filter((b) => b.title), q).slice(0, 30);
  const out = mixFree(paid, free, { hasDebrid: !!provider() });
  cache.set(q, out);
  return out;
}

/**
 * LibriVox's volunteer-read public-domain audiobooks that fit what you typed: every word in the
 * title or author ("pride prejudice" finds Pride and Prejudice by Jane Austen, not other books by a
 * "Prejudice"). They play and save straight from LibriVox / Internet Archive, no debrid needed.
 */
export async function freeBooks(q) {
  const list = await librivox.search(q).catch(() => []);
  return list
    .filter((b) => b.title && fitsWords(b, q))
    .slice(0, 8)
    .map((b) => ({ ...b, free: true }));
}
/** A free LibriVox book: plays from its own files, no debrid and no copies to look for. */
export const isFree = (book) => !!book?.free || book?.via === 'lv' || /^(lv|ia):/.test(book?.uid || '');

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
    searchSources(
      params,
      (name, results) => {
        all.set(key + name, results || []);
        onUpdate?.(list());
      },
      sourcesOn()
    );
  return run({ title, author, query: `${title} ${surname}`.trim() }, 'a:')
    .then(() => (list().length ? null : run({ title, query: title }, 'b:')))
    .then(list);
}

// Which copy each book played from (Audible id → the debrid book), so it opens again at once.
export const links = persisted('briskLinks', {}); // uid -> { uid, title, author, cover, source }
const summary = (d) => ({ uid: d.uid, source: d.source, title: d.title, author: d.author, cover: d.cover, narrator: d.narrator || '' });

/** The playable book for a copy: put on your debrid service, then its parts listed. */
async function ready(book, r, onStatus, via = provider()) {
  const stub = await cloud.prepareMagnet(via, r, (text, pct) => onStatus?.(text, pct));
  const d = await getDetails({ ...stub, title: book.title, author: book.author, narrator: book.narrator, cover: book.cover, description: book.description }, FAST);
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
  if (isFree(book)) {
    onStatus?.('Opening from LibriVox…');
    const d = await getDetails(book, FAST);
    if (!d?.tracks?.length) throw new Error('This LibriVox recording has no playable files');
    return { ...d, title: book.title || d.title, author: book.author || d.author, cover: book.cover || d.cover };
  }
  // Already on the phone (your own folder or saved here): that, without downloading again.
  if (!(copies && copies.length === 1)) {
    const local = onPhone(book);
    if (local) {
      try {
        if (local.dl) return { ...local.dl.book, title: book.title || local.dl.book.title, cover: book.cover || local.dl.book.cover };
        const d = await getDetails(local, FAST);
        if (d?.tracks?.length) return { ...d, title: book.title || d.title, author: book.author || d.author, cover: book.cover || d.cover };
      } catch {}
    }
  }
  if (!provider()) throw Object.assign(new Error('Connect TorBox or Real-Debrid first'), { needKey: true });
  const known = links.get()[book.uid];
  if (known) {
    try {
      return await getDetails(known, FAST);
    } catch {}
  }
  // Already in your TorBox / Real-Debrid: that copy, at once (not when you picked a copy by hand).
  if (!(copies && copies.length === 1)) {
    const mine = await inMyCloud(book).catch(() => null);
    if (mine) {
      try {
        onStatus?.(`Opening from your ${nameOf(serviceOf(mine))}…`);
        const d = await getDetails(mine, FAST);
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
    // The service that has it ready, when you connected both.
    const other = providers().find((p) => p !== provider() && r.cache?.[p] && !r.cache?.[provider()]);
    const via = other || provider();
    try {
      onStatus?.(seen[h(r)] === 'audio' || r.cache?.any ? `Opening on ${nameOf(via)}…` : `Trying copy ${i + 1}…`, null);
      const d = await ready(book, r, onStatus, via);
      links.set((l) => ({ ...l, [book.uid]: summary(d) }));
      return d;
    } catch (e) {
      lastErr = e;
      if (e.pending) pending ||= { ...e.pending, copy: r };
      else if (!wrongCopy(e)) break;
    }
  }
  if (pending) {
    // Still downloading on your service: carried on in the background, with a note when it's ready.
    watch(book, pending);
    throw Object.assign(new Error(`${nameOf(pending.provider)} is getting it ready (${Math.round((pending.progress || 0) * 100)}%). You can leave this page — Home shows the progress and you'll be told when it's ready to play.`), { pending: true });
  }
  throw lastErr || new Error('Couldn’t open this book');
}

/** Play a book; `percent` carries your place over when you switch to another copy. */
export async function play(book, onStatus, copies, { percent } = {}) {
  busy.now++;
  const d = await prepare(book, onStatus, copies).finally(() => busy.now--);
  player.playBook(d, { exact: true, ...(percent > 0.002 ? { percent } : {}) });
  return d;
}

export async function save(book, onStatus, copies) {
  if (!canDownload) throw new Error('Saving for offline works in the Android app');
  const local = onPhone(book);
  if (local) throw new Error(local.dl ? 'Already saved on this phone' : 'Already in your folder on this phone — Play uses it');
  const d = await prepare(book, onStatus, copies);
  downloadBook(d).catch(() => {});
  return d;
}

// ---- getting ready in the background ------------------------------------------------------------
// A copy your service is still downloading: checked every 20 s, its % shown on Home and the book
// page, and a "Ready to play" note when it's done — even after you left the page.
export const jobs = persisted('briskJobs', {}); // book uid -> { book, copy, provider, progress, state: 'fetching' | 'ready' | 'failed', error, at }
const slim = (b) => ({ uid: b.uid, source: b.source, title: b.title, author: b.author || '', narrator: b.narrator || '', cover: b.cover || '', duration: b.duration || 0 });
function watch(book, pending) {
  const c = pending.copy || {};
  jobs.set((all) => ({ ...all, [book.uid]: { book: slim(book), copy: { hash: c.hash || pending.hash, magnet: c.magnet || '', title: c.title || '' }, provider: pending.provider, progress: pending.progress || 0, state: 'fetching', at: Date.now() } }));
  startWatching();
}
export const dismissJob = (uid) =>
  jobs.set((all) => {
    const next = { ...all };
    delete next[uid];
    return next;
  });
let timer = 0;
let checking = false;
export function startWatching() {
  if (timer) return;
  timer = setInterval(checkJobs, 20000);
  setTimeout(checkJobs, 4000);
}
async function checkJobs() {
  const open = Object.entries(jobs.get()).filter(([, j]) => j.state === 'fetching');
  if (!open.length) {
    clearInterval(timer);
    timer = 0;
    return;
  }
  if (checking) return;
  checking = true;
  try {
    for (const [uid, j] of open) {
      const put = (patch) => jobs.set((all) => (all[uid] ? { ...all, [uid]: { ...all[uid], ...patch } } : all));
      try {
        const d = await ready(j.book, j.copy, (t, pct) => typeof pct === 'number' && pct < 1 && put({ progress: pct }), j.provider);
        links.set((l) => ({ ...l, [uid]: summary(d) }));
        put({ state: 'ready', progress: 1, at: Date.now() });
        const note = `Ready to play: ${j.book.title}`;
        toast(note, 6000);
        if (document.hidden) Web.toast?.({ text: note }).catch(() => {});
      } catch (e) {
        if (e.pending) put({ progress: e.pending.progress || 0 });
        else if (wrongCopy(e)) put({ state: 'failed', error: e.message });
      }
    }
  } finally {
    checking = false;
  }
}

/** The debrid book this one plays from, if it's known. */
export const linkOf = (book) => links.get()[book?.uid] || null;
/** The id this book plays and saves under: its own for a free LibriVox book, else its debrid copy's. */
export const playUid = (book) => (isFree(book) ? book.uid : linkOf(book)?.uid || '');
export const savedOf = (book) => downloads.get()[playUid(book)] || null;

/** Books you're in the middle of, most recent first. */
export function continuing(all = progress.get()) {
  return Object.entries(all)
    .filter(([, p]) => p?.book?.title && p.kind !== 'text' && !p.finished && !p.hidden && (p.percent || 0) > 0.002)
    .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
    .slice(0, 12)
    .map(([uid, p]) => ({ ...p.book, uid, percent: p.percent || 0 }));
}

/**
 * This book already on the phone: saved by Audibrisk, or in a folder you added (Settings →
 * Folder on this phone). The folder copy counts when its name starts with the book's title and
 * the author fits ("12 Rules for Life An Antidote to Chaos" yes, "Beyond Order: 12 More Rules" no).
 */
export function onPhone(book, all = downloads.get()) {
  if (!book?.title) return null;
  const mine = Object.values(all).find((d) => d?.status === 'done' && d.book && (d.uid === playUid(book) || samePhoneBook(book, d.book)));
  if (mine) return { ...mine.book, dl: mine };
  if (!phone.connected()) return null;
  return phone.localCfg.get().books.find((b) => b.kind !== 'text' && b.files?.length && samePhoneBook(book, b)) || null;
}

/** Books saved on this phone. */
export const offline = (all = downloads.get()) =>
  Object.values(all)
    .filter((d) => d?.book && (d.status === 'done' || d.status === 'downloading' || d.status === 'paused'))
    .map((d) => ({ ...d.book, dl: d }));

/** Resume a book from Continue / Offline (its own debrid or phone copy). */
export async function resume(b) {
  const d = b.dl?.status === 'done' ? b.dl.book : await getDetails({ uid: b.uid, source: b.source, title: b.title, author: b.author, cover: b.cover }, FAST);
  player.playBook({ ...d, title: b.title || d.title, author: b.author || d.author, cover: b.cover || d.cover });
}

// ---- your own cloud ----------------------------------------------------------------------------
export const cloudShelf = persisted('briskCloud', { books: [], at: 0 }); // the audiobooks in your debrid, kept for a quick start
let cloudRun = null;
/** The audiobooks already in your TorBox / Real-Debrid (refreshed in the background). */
export function refreshCloud(force = false) {
  if (cloudRun || !provider()) return cloudRun || Promise.resolve(cloudShelf.get().books);
  // Fetched lately: what we have (a big library re-read on every tab switch made the app sluggish).
  if (!force && cloudShelf.get().at && Date.now() - cloudShelf.get().at < 5 * 60e3) return Promise.resolve(cloudShelf.get().books);
  const lib = (p) => (p === 'torbox' ? cloud.torboxLibrary() : p === 'realdebrid' ? cloud.realdebridLibrary() : moreLibrary(p));
  cloudRun = Promise.all(providers().map((p) => lib(p).catch(() => [])))
    .then((lists) => lists.flat())
    .then((list) => {
      const books = (list || []).filter((b) => b?.uid && b.title && b.kind !== 'text' && !b.fetching).map((b) => ({ uid: b.uid, source: b.source, title: b.title, author: b.author || '', narrator: b.narrator || '', cover: b.cover || '', duration: b.duration || 0, addedAt: b.addedAt || 0 }));
      cloudShelf.set({ books, at: Date.now() });
      // Real covers for the ones without (looked up once, quietly).
      fillCovers(books);
      return books;
    })
    .catch(() => cloudShelf.get().books)
    .finally(() => (cloudRun = null));
  return cloudRun;
}
export const withCover = (b) => ({ ...b, cover: coverNow(b) || covers.get()[b.uid] || b.cover || '' });

// Covers for cloud and phone books, found quietly in the background: one at a time, a few seconds
// apart, at most 24 a session, and saved together — so taps and Play never wait behind them.
// (v1.0.6 looked up every book at once and froze the app for minutes on a big cloud library.)
export const covers = persisted('briskCovers', {}, { delay: 3000 }); // uid -> cover found
const tried = new Set();
const waiting = [];
let filling = false;
export const busy = { now: 0 }; // > 0 while a book is opening: covers wait
export function fillCovers(books) {
  for (const b of books) {
    if (tried.size + waiting.length >= 24) break;
    if (!b?.uid || tried.has(b.uid) || waiting.some((w) => w.uid === b.uid) || coverNow(b) || covers.get()[b.uid]) continue;
    waiting.push(b);
  }
  if (filling || !waiting.length) return;
  filling = true;
  const found = {};
  const flush = () => Object.keys(found).length && covers.set((c) => ({ ...c, ...found }));
  const step = async () => {
    if (busy.now > 0) return setTimeout(step, 3000);
    const b = waiting.shift();
    if (!b) {
      flush();
      filling = false;
      return;
    }
    tried.add(b.uid);
    const m = await lookup(b).catch(() => null);
    if (m?.cover) found[b.uid] = m.cover;
    // Shown a few at a time, not one redraw per cover.
    if (Object.keys(found).length >= 4) {
      flush();
      for (const k of Object.keys(found)) delete found[k];
    }
    setTimeout(step, 2500);
  };
  setTimeout(step, 6000);
}

/** This book in your own cloud, if it's there. */
export async function inMyCloud(book) {
  const t = searchTitle(book.title);
  // What we know now; refreshed in the background (Play never waits for your whole library).
  let list = cloudShelf.get().books;
  if (!cloudShelf.get().at) list = await refreshCloud();
  else if (Date.now() - cloudShelf.get().at > 10 * 60e3) refreshCloud();
  const sn = String(book.author || '').split(',')[0].trim().split(/\s+/).pop()?.toLowerCase() || '';
  const hits = list.filter((b) => matches(t, `${b.title} ${b.author || ''}`));
  return hits.find((b) => !sn || `${b.title} ${b.author}`.toLowerCase().includes(sn)) || hits[0] || null;
}
