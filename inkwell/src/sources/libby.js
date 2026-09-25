// Libby / OverDrive: your public library's ebooks and audiobooks. The catalogue
// and availability come from OverDrive's public "thunder" API (the one the Libby
// web app uses); borrowing happens in Libby itself, signed in with your card.
import { getJson, qs } from '../lib/http.js';
import { persisted } from '../lib/store.js';
import { mainTitle, matches } from '../lib/match.js';

const THUNDER = 'https://thunder.api.overdrive.com/v2';

export const libby = persisted('libby', { key: '', name: '' });
export const connected = () => !!libby.get().key;

/** "nypl", "https://libbyapp.com/library/nypl" or a Libby page link → "nypl". */
export function parseLibrary(input) {
  const s = String(input || '').trim();
  const m = /libbyapp\.com\/(?:library|search|interview\/menu)\/([a-z0-9-]+)/i.exec(s) || /^([a-z0-9-]{2,40})$/i.exec(s);
  return m ? m[1].toLowerCase() : '';
}

export async function connect(input) {
  const key = parseLibrary(input);
  if (!key) throw new Error('Paste your library link from Libby (libbyapp.com/library/…) or its short name');
  let name = key;
  try {
    const d = await getJson(`${THUNDER}/libraries/${encodeURIComponent(key)}`, { fresh: true, timeout: 15000 });
    name = d?.name || d?.displayName || key;
  } catch (e) {
    if (e.status === 404) throw new Error(`Libby doesn't know a library called "${key}"`);
    throw e;
  }
  libby.set({ key, name });
  return name;
}
export const disconnect = () => libby.set({ key: '', name: '' });

const libbyUrl = (key, title, id) => `https://libbyapp.com/search/${key}/search/query-${encodeURIComponent(title)}/page-1${id ? `/${id}` : ''}`;
export const libraryHome = () => `https://libbyapp.com/library/${libby.get().key}`;

function toBook(it, key) {
  const covers = it.covers || {};
  const cover = covers.cover510Wide?.href || covers.cover300Wide?.href || covers.cover150Wide?.href || '';
  const format = it.type?.id === 'audiobook' ? 'audiobook' : it.type?.id === 'ebook' ? 'ebook' : it.type?.name || '';
  return {
    uid: `lb:${it.id}`,
    source: 'lb',
    kind: 'discover',
    title: it.title + (it.subtitle && it.title.length < 40 ? `: ${it.subtitle}` : ''),
    author: it.firstCreatorName || (it.creators || []).map((c) => c.name).slice(0, 2).join(', '),
    cover,
    year: (it.publishDate || '').slice(0, 4),
    description: (it.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    libby: {
      id: it.id,
      format,
      available: !!it.isAvailable,
      copies: it.availableCopies ?? null,
      owned: it.ownedCopies ?? null,
      holds: it.holdsCount ?? null,
      waitDays: it.estimatedWaitDays ?? null,
      link: libbyUrl(key, it.title, it.id),
    },
  };
}

/** Search your library's catalogue (audiobooks and ebooks). */
export async function search(term) {
  const { key } = libby.get();
  if (!key || !term.trim()) return [];
  const d = await getJson(`${THUNDER}/libraries/${key}/media?` + qs({ query: term, perPage: 24, page: 1 }), { timeout: 15000 });
  return (d?.items || []).filter((it) => it.title).map((it) => toBook(it, key));
}

/** Copies of this book at your library, audiobook first. */
export async function availability(book) {
  const t = mainTitle(book.title);
  const author = (book.author || '').split(',')[0].trim();
  const hits = await search(`${t} ${author.split(' ').pop() || ''}`.trim()).catch(() => []);
  return hits
    .filter((b) => matches(t, b.title))
    .sort((a, b) => (a.libby.format === 'audiobook' ? -1 : 0) - (b.libby.format === 'audiobook' ? -1 : 0) || Number(b.libby.available) - Number(a.libby.available));
}

export const details = async (book) => book;

export function describe(l) {
  if (!l) return '';
  if (l.available) return `Available now${l.copies != null && l.owned ? ` · ${l.copies} of ${l.owned} copies` : ''}`;
  const weeks = l.waitDays ? Math.max(1, Math.round(l.waitDays / 7)) : null;
  return `Waitlist${l.holds != null ? ` · ${l.holds} hold${l.holds === 1 ? '' : 's'}` : ''}${weeks ? ` · about ${weeks} week${weeks === 1 ? '' : 's'}` : ''}`;
}

// ---------------------------------------------------------------------------
// Your Libby account, linked with Libby's "Copy To Another Device" code.
// This uses Libby's own (unofficial) app interface, like other open-source
// Libby clients: it can list your loans and holds, borrow / place holds, and
// open a borrowed audiobook's parts for the in-app player.
import { sendJson, getText as fetchText } from '../lib/http.js';
import { Capacitor, CapacitorCookies } from '@capacitor/core';

const SENTRY = 'https://sentry.libbyapp.com';
export const libbyAccount = persisted('libbyAccount', { identity: '', cards: [], loans: [], holds: [], syncedAt: 0 });
export const signedIn = () => !!libbyAccount.get().identity;

const auth = (identity = libbyAccount.get().identity) => ({ Authorization: `Bearer ${identity}`, Accept: 'application/json' });

async function sentry(path, { method = 'GET', body, identity } = {}) {
  const url = `${SENTRY}/${path}`;
  try {
    return method === 'GET' ? await getJson(url, { headers: auth(identity), fresh: true, timeout: 20000 }) : await sendJson(url, method, body, auth(identity));
  } catch (e) {
    if (e.status === 401 || e.status === 403) throw new Error('Libby signed this device out — copy a new code from Libby and sign in again');
    throw e;
  }
}

async function newChip(identity) {
  const r = await sendJson(`${SENTRY}/chip?client=dewey`, 'POST', undefined, identity ? auth(identity) : { Accept: 'application/json' });
  if (!r?.identity) throw new Error("Libby didn't answer — try again");
  return r.identity;
}

/** Link this app with the 8-digit code from Libby → Menu → Copy To Another Device. */
export async function signInWithCode(code) {
  const c = String(code || '').replace(/\D/g, '');
  if (c.length !== 8) throw new Error('Enter the 8-digit code Libby shows under "Copy To Another Device"');
  const first = await newChip();
  const r = await sendJson(`${SENTRY}/chip/clone/code`, 'POST', { code: c }, auth(first));
  if (r && r.result && !/cloned/i.test(r.result)) throw new Error(`Libby said: ${r.result}`);
  const identity = await newChip(first);
  libbyAccount.set({ identity, cards: [], loans: [], holds: [], syncedAt: 0 });
  const s = await syncAccount();
  // Use the first card's library for catalogue search if none is set yet.
  const card = s.cards[0];
  if (card && !libby.get().key) libby.set({ key: card.advantageKey, name: card.library?.name || card.cardName || card.advantageKey });
  return s.cards.map((c) => c.library?.name || c.cardName).join(', ') || 'Libby';
}

export function signOut() {
  libbyAccount.set({ identity: '', cards: [], loans: [], holds: [], syncedAt: 0 });
}

/** Cards, loans and holds. */
export async function syncAccount() {
  const d = await sentry('chip/sync');
  const next = { ...libbyAccount.get(), cards: d.cards || [], loans: d.loans || [], holds: d.holds || [], syncedAt: Date.now() };
  libbyAccount.set(next);
  return next;
}

const coverOf = (it) => it.covers?.cover510Wide?.href || it.covers?.cover300Wide?.href || it.covers?.cover150Wide?.href || '';
const formatOf = (it) => (it.type?.id === 'audiobook' ? 'audiobook' : it.type?.id === 'ebook' ? 'ebook' : it.type?.id || '');

/** Loans as shelf items (audiobooks play in the app; other formats open Libby). */
export function loanBooks() {
  return (libbyAccount.get().loans || []).map((l) => ({
    uid: `lbl:${l.cardId}:${l.id}`,
    source: 'lbl',
    kind: formatOf(l) === 'audiobook' ? 'audio' : 'discover',
    title: l.title,
    author: l.firstCreatorName || '',
    cover: coverOf(l),
    libbyLoan: { cardId: l.cardId, titleId: l.id, format: formatOf(l), due: l.expireDate || l.expires || '' },
  }));
}

export const holdBooks = () =>
  (libbyAccount.get().holds || []).map((h) => ({
    uid: `lb:${h.id}`,
    source: 'lb',
    kind: 'discover',
    title: h.title,
    author: h.firstCreatorName || '',
    cover: coverOf(h),
    libbyHold: { position: h.holdListPosition, ready: !!h.isAvailable, wait: h.estimatedWaitDays },
  }));

function cardFor(key) {
  const cards = libbyAccount.get().cards || [];
  return cards.find((c) => c.advantageKey === key) || cards[0];
}

export function loanFor(titleId) {
  return (libbyAccount.get().loans || []).find((l) => String(l.id) === String(titleId));
}

/** Borrow a title that's available now. */
export async function borrow(titleId, format) {
  const card = cardFor(libby.get().key);
  if (!card) throw new Error('Sign in to Libby first (Settings → Libby)');
  const pref = card.lendingPeriods?.[format === 'audiobook' ? 'audiobook' : 'book']?.preference || [14, 'days'];
  await sentry(`card/${card.cardId}/loan/${titleId}`, { method: 'POST', body: { period: pref[0], units: pref[1] || 'days', lucky_day: null, title_format: format === 'audiobook' ? 'audiobook' : 'ebook' } });
  await syncAccount();
  return `Borrowed with ${card.library?.name || 'your card'}`;
}

/** Join the waitlist. */
export async function placeHold(titleId) {
  const card = cardFor(libby.get().key);
  if (!card) throw new Error('Sign in to Libby first (Settings → Libby)');
  await sentry(`card/${card.cardId}/hold/${titleId}`, { method: 'POST', body: { days_to_suspend: 0, email_address: '' } });
  await syncAccount();
  return 'Hold placed — Libby will tell you when it is ready';
}

async function cookieHeader(url) {
  if (!Capacitor.isNativePlatform()) return '';
  try {
    const c = await CapacitorCookies.getCookies({ url });
    return Object.entries(c || {})
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  } catch {
    return '';
  }
}

/** A borrowed audiobook as a playable book: parts, chapters and the cookie the audio host needs. */
export async function openLoan(book) {
  const { cardId, titleId, format } = book.libbyLoan || {};
  if (format !== 'audiobook') throw new Error('Open this one in the Libby app');
  if (!Capacitor.isNativePlatform()) throw new Error('Libby audiobooks play in the Android app — or open it in Libby');
  const r = await sentry(`open/audiobook/card/${cardId}/title/${titleId}`);
  const web = r?.urls?.web;
  const ob = r?.urls?.openbook;
  if (!web || !ob) throw new Error("Libby didn't return this audiobook — try opening it in Libby once");
  await fetchText(web, { fresh: true, timeout: 20000 }).catch(() => {}); // sets the audio host's session cookie
  const book2 = await getJson(ob, { fresh: true, timeout: 20000 });
  const cookie = await cookieHeader(web);
  const headers = cookie ? { Cookie: cookie } : {};
  let offset = 0;
  const spine = book2.spine || [];
  const tracks = spine.map((s, i) => {
    const t = { title: `Part ${i + 1}`, url: new URL(s.path, web).href, duration: s['audio-duration'] || 0, offset, index: i, headers };
    offset += t.duration;
    return t;
  });
  // Table of contents: "part.mp3#123" → part index + seconds.
  const flat = [];
  const walk = (items) => (items || []).forEach((n) => (flat.push(n), walk(n.contents)));
  walk(book2.nav?.toc);
  const chaptersMeta = flat
    .map((n) => {
      const [p, sec] = String(n.path || '').split('#');
      const i = spine.findIndex((s) => s.path === p || s.path.split('?')[0] === p.split('?')[0]);
      return i < 0 ? null : { title: n.title, start: tracks[i].offset + (+sec || 0) };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start)
    .map((c, i, all) => ({ ...c, end: all[i + 1]?.start ?? offset }));
  if (!tracks.length) throw new Error('This audiobook has no playable parts');
  return {
    ...book,
    title: book2.title?.main || book.title,
    author: (book2.creator || []).filter((c) => /author/i.test(c.role || 'author')).map((c) => c.name).join(', ') || book.author,
    narrator: (book2.creator || []).filter((c) => /narrator/i.test(c.role || '')).map((c) => c.name).join(', '),
    description: (book2.description?.full || book2.description?.short || '').replace(/<[^>]+>/g, ' ').trim(),
    duration: offset,
    tracks,
    chaptersMeta: chaptersMeta.length ? chaptersMeta : undefined,
  };
}

export const loanSource = { details: openLoan };
