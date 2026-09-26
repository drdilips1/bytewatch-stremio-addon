// Libby / OverDrive: your public library's ebooks and audiobooks. The catalogue
// and availability come from OverDrive's public "thunder" API (the one the Libby
// web app uses); borrowing happens in Libby itself, signed in with your card.
import { getJson, qs } from '../lib/http.js';
import { persisted } from '../lib/store.js';
import { mainTitle, matches } from '../lib/match.js';

const THUNDER = 'https://thunder.api.overdrive.com/v2';

export const libby = persisted('libby', { key: '', name: '', links: [], skip: [] });
export const connected = () => libraries().length > 0;

/** Libraries added by link (the first one is `key`/`name`, the rest in `links`). */
export function linkedLibraries() {
  const { key, name, links = [] } = libby.get();
  return [...(key ? [{ key, name }] : []), ...links.filter((l) => l.key !== key)];
}

/** "nypl", "https://libbyapp.com/library/nypl" or a Libby page link → "nypl". */
export function parseLibrary(input) {
  const s = String(input || '').trim();
  const m = /libbyapp\.com\/(?:library|search|interview\/menu)\/([a-z0-9-]+)/i.exec(s) || /^([a-z0-9-]{2,40})$/i.exec(s);
  return m ? m[1].toLowerCase() : '';
}

/** Add a library by its Libby link or short name (you can add several). */
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
  libby.set((l) => {
    const skip = (l.skip || []).filter((k) => k !== key);
    if (!l.key || l.key === key) return { ...l, key, name, skip };
    return { ...l, skip, links: [...(l.links || []).filter((x) => x.key !== key), { key, name }] };
  });
  return name;
}

/** Remove a library added by link. */
export function removeLibrary(key) {
  libby.set((l) => {
    const links = (l.links || []).filter((x) => x.key !== key);
    if (l.key !== key) return { ...l, links };
    const [next, ...rest] = links;
    return { ...l, key: next?.key || '', name: next?.name || '', links: rest };
  });
}
export const disconnect = () => libby.set((l) => ({ ...l, key: '', name: '', links: [] }));

const libbyUrl = (key, title, id) => `https://libbyapp.com/search/${key}/search/query-${encodeURIComponent(title)}/page-1${id ? `/${id}` : ''}`;
export const libraryHome = () => `https://libbyapp.com/library/${libraries()[0]?.key || libby.get().key}`;

/**
 * Libraries to search: your Libby cards plus libraries added by link,
 * minus any switched off.
 */
export function libraries({ all = false } = {}) {
  const acct = libbyAccount.get();
  const skip = new Set(all ? [] : libby.get().skip || []);
  const seen = new Set();
  const list = [
    ...(acct.cards || []).map((c) => ({ key: c.advantageKey, name: c.library?.name || c.cardName || c.advantageKey, cardId: c.cardId, card: true })),
    ...linkedLibraries(),
  ].filter((l) => l.key && !seen.has(l.key) && seen.add(l.key));
  return list.filter((l) => !skip.has(l.key));
}
export const toggleLibrary = (key, on) =>
  libby.set((l) => ({ ...l, skip: on ? (l.skip || []).filter((k) => k !== key) : [...new Set([...(l.skip || []), key])] }));

function toBook(it, key, name = '') {
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
      key,
      library: name,
    },
  };
}

async function searchOne(lib, term, perPage = 24) {
  const d = await getJson(`${THUNDER}/libraries/${lib.key}/media?` + qs({ query: term, perPage, page: 1 }), { timeout: 15000 });
  return (d?.items || []).filter((it) => it.title).map((it) => toBook(it, lib.key, lib.name));
}

/** Search all your libraries' catalogues (audiobooks and ebooks). */
export async function search(term) {
  const libs = libraries();
  if (!libs.length || !term.trim()) return [];
  const per = await Promise.all(libs.map((l) => searchOne(l, term, libs.length > 1 ? 12 : 24).catch(() => [])));
  // One entry per title: prefer a library where it's available now.
  const best = new Map();
  for (const b of per.flat()) {
    const k = `${b.libby.format}|${b.title.toLowerCase()}|${b.author.toLowerCase()}`;
    const cur = best.get(k);
    if (!cur || (b.libby.available && !cur.libby.available)) best.set(k, b);
  }
  return [...best.values()];
}

const FORMATS = {
  audiobook: 'audiobook-overdrive,audiobook-mp3',
  ebook: 'ebook-overdrive,ebook-epub-adobe,ebook-epub-open,ebook-kindle,ebook-pdf-adobe',
};

/**
 * One page of the catalogue across your libraries (or one library):
 * a search, or the newest titles when the query is empty.
 */
export async function catalogue({ query = '', format = 'audiobook', available = false, key = '', page = 1 } = {}) {
  const libs = key ? libraries().filter((l) => l.key === key) : libraries();
  if (!libs.length) return { items: [], more: false };
  const per = await Promise.all(
    libs.map(async (l) => {
      const params = { perPage: 24, page, ...(query.trim() ? { query: query.trim() } : { sortBy: 'newlyadded' }), ...(FORMATS[format] ? { format: FORMATS[format] } : {}), ...(available ? { showOnlyAvailable: true } : {}) };
      const d = await getJson(`${THUNDER}/libraries/${l.key}/media?` + qs(params), { timeout: 20000 }).catch(() => null);
      const items = (d?.items || []).filter((it) => it.title).map((it) => toBook(it, l.key, l.name));
      return { items, more: (d?.items || []).length >= 24 };
    })
  );
  const seen = new Set();
  const items = per
    .flatMap((r) => r.items)
    .filter((b) => (format === 'all' || b.libby.format === format) && (!available || b.libby.available))
    .filter((b) => {
      const k = `${b.libby.format}|${b.title.toLowerCase()}|${b.author.toLowerCase()}`;
      return !seen.has(k) && seen.add(k);
    });
  return { items, more: per.some((r) => r.more) };
}

/**
 * Browse your library's catalogue without a search: newest audiobooks
 * (or ebooks), those you can borrow right now first.
 */
export async function browse(format = 'audiobook') {
  const libs = libraries();
  if (!libs.length) return [];
  const fmt = format === 'audiobook' ? 'audiobook-overdrive,audiobook-mp3' : 'ebook-overdrive,ebook-epub-adobe,ebook-epub-open,ebook-kindle';
  const per = await Promise.all(
    libs.slice(0, 4).map(async (l) => {
      const d = await getJson(`${THUNDER}/libraries/${l.key}/media?` + qs({ format: fmt, sortBy: 'newlyadded', perPage: 40, page: 1 }), { timeout: 15000 }).catch(() => null);
      return (d?.items || []).filter((it) => it.title).map((it) => toBook(it, l.key, l.name));
    })
  );
  const seen = new Set();
  const all = per.flat().filter((b) => {
    const k = b.title.toLowerCase();
    return !seen.has(k) && seen.add(k);
  });
  const wanted = all.filter((b) => b.libby.format === format);
  return (wanted.length ? wanted : all).sort((a, b) => Number(b.libby.available) - Number(a.libby.available));
}

/** Copies of this book at each of your libraries: available first, audiobook first. */
export async function availability(book) {
  const t = mainTitle(book.title);
  const author = (book.author || '').split(',')[0].trim();
  const q = `${t} ${author.split(' ').pop() || ''}`.trim();
  const per = await Promise.all(libraries().map((l) => searchOne(l, q).catch(() => [])));
  return per
    .flat()
    .filter((b) => matches(t, b.title))
    .sort((a, b) => Number(b.libby.available) - Number(a.libby.available) || (a.libby.format === 'audiobook' ? -1 : 0) - (b.libby.format === 'audiobook' ? -1 : 0));
}

export const details = async (book) => book;

export function describe(l) {
  if (!l) return '';
  if (l.available) return `Available now${l.copies != null && l.owned ? ` · ${l.copies} of ${l.owned} copies` : ''}`;
  const weeks = l.waitDays ? Math.max(1, Math.round(l.waitDays / 7)) : null;
  return `Waitlist${l.holds != null ? ` · ${l.holds} hold${l.holds === 1 ? '' : 's'}` : ''}${weeks ? ` · about ${weeks} week${weeks === 1 ? '' : 's'}` : ''}`;
}

// ---------------------------------------------------------------------------
// Your Libby account. This speaks Libby's own (unofficial) app interface the way
// open-source Libby clients do (odmpy, libbydl, libby-archiver): an identity
// "chip", linked library cards, loans and holds, borrowing, and opening a
// borrowed audiobook's parts for the in-app player.
//
// Key detail (from libby-archiver): the identity token carries your cards. After
// cards are added to a chip (code copy or card sign-in) the token must be
// re-minted with `v=<chip id>` — only then does Libby see them.
import { sendJson, getText as fetchText } from '../lib/http.js';
import { Capacitor } from '@capacitor/core';

// Everything goes through Libby's gateway: the older sentry-read.svc.overdrive.com
// host presents a certificate for another name, which phones rightly refuse.
const GATE = 'https://sentry.libbyapp.com';
const READ = GATE;
const CLIENT_VERSION = '22.1.1'; // Libby web client version baked into the chip
const MINT = `c=d%3A${CLIENT_VERSION}&s=0`;
const NATIVE = Capacitor.isNativePlatform();
// Browsers don't let pages set these; the Android app sends what the Libby web app sends.
const LIKE_LIBBY = NATIVE ? { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36', Origin: 'https://libbyapp.com' } : {};

export const libbyAccount = persisted('libbyAccount', { identity: '', chipId: '', cards: [], loans: [], holds: [], syncedAt: 0, mintedAt: 0 });
export const signedIn = () => !!libbyAccount.get().identity;

const auth = (identity) => ({ Accept: 'application/json', ...LIKE_LIBBY, ...(identity ? { Authorization: `Bearer ${identity}` } : {}) });

/** The claims inside an identity token (not verified — just read). */
export function tokenClaims(jwt) {
  try {
    let p = String(jwt).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    p += '='.repeat((4 - (p.length % 4)) % 4);
    const bin = atob(p);
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

async function call(method, base, path, { identity, body, timeout = 25000, headers = {} } = {}) {
  const url = `${base}/${path}`;
  try {
    return method === 'GET' ? await getJson(url, { headers: { ...auth(identity), ...headers }, fresh: true, timeout }) : await sendJson(url, method, body, { ...auth(identity), ...headers });
  } catch (e) {
    if (identity && e.status === 401) throw Object.assign(new Error('Libby signed this device out — sign in again in Settings → Libby'), { status: 401 });
    throw e;
  }
}

/** A new chip, or (with identity + chipId) a fresh token for the same chip that includes its cards. */
async function mint(identity, chipId) {
  const v = chipId ? `&v=${String(chipId).slice(0, 8)}` : '';
  // The web client's form first; the older client=dewey form (which Libby also accepts) as a fallback.
  const r = await call('POST', READ, `chip?${MINT}${v}`, { identity }).catch((e) => {
    if (e.status === 401) throw e;
    return call('POST', READ, `chip?client=dewey${v}`, { identity });
  });
  if (!r?.identity) throw new Error("Libby didn't answer — try again");
  return { identity: r.identity, chipId: r.chip?.id || tokenClaims(r.identity)?.chip?.id || chipId || '' };
}

const chipCards = (identity) => tokenClaims(identity)?.chip?.cards || [];

async function finish({ identity, chipId }) {
  const d = await call('GET', READ, 'chip/sync', { identity });
  if (!(d?.cards || []).length && !chipCards(identity).length) throw new Error("Libby linked this device, but no library cards came across");
  libbyAccount.set({ identity, chipId, cards: d.cards || [], loans: d.loans || [], holds: d.holds || [], syncedAt: Date.now(), mintedAt: Date.now() });
  if (!chipCards(identity).length) await ensureChip().catch(() => {});
  const card = (d.cards || [])[0];
  if (card && !libby.get().key) libby.set((l) => ({ ...l, key: card.advantageKey, name: card.library?.name || card.cardName || card.advantageKey }));
  return (d.cards || []).map((c) => c.library?.name || c.cardName).join(', ') || 'Libby';
}

/**
 * Libby only lets a token borrow and open books when the token itself lists your
 * cards ("missing_chip" otherwise). Re-mint until it does, trying each form Libby accepts.
 */
export async function ensureChip({ force = false } = {}) {
  const acct = libbyAccount.get();
  if (!acct.identity) throw new Error('Sign in to Libby first (Settings → Libby)');
  if (!force && chipCards(acct.identity).length) return acct.identity;
  const chipId = acct.chipId || tokenClaims(acct.identity)?.chip?.id || '';
  const v = chipId ? `&v=${String(chipId).slice(0, 8)}` : '';
  const forms = [`chip?${MINT}${v}`, `chip?client=dewey${v}`, `chip?${MINT}`, `chip?client=dewey`];
  let best = null;
  for (let round = 0; round < 2 && !best; round++) {
    for (const f of forms) {
      const r = await call('POST', READ, f, { identity: libbyAccount.get().identity }).catch(() => null);
      if (r?.identity && tokenClaims(r.identity)?.chip?.id === (chipId || tokenClaims(r.identity)?.chip?.id)) {
        if (chipCards(r.identity).length) {
          best = r.identity;
          break;
        }
      }
    }
    if (!best && round === 0) await new Promise((res) => setTimeout(res, 1500));
  }
  if (!best) throw new Error("Libby hasn't attached your cards to this device yet — in Settings → Libby tap Sign out, then sign in again");
  libbyAccount.set((a) => ({ ...a, identity: best, mintedAt: Date.now() }));
  return best;
}

/** Run a Libby action; if Libby says the token lacks cards, refresh it once and retry. */
async function withChip(fn) {
  await ensureChip().catch(() => {});
  try {
    return await fn(libbyAccount.get().identity);
  } catch (e) {
    if (!/missing_chip|403/.test(e.message)) throw e;
    await ensureChip({ force: true });
    return fn(libbyAccount.get().identity);
  }
}

/** Step-by-step check of the Libby sign-in, for troubleshooting (no borrowing). */
export async function diagnose() {
  const out = [];
  const say = (x) => out.push(x);
  const chipOf = (jwt) => tokenClaims(jwt)?.chip || null;
  const desc = (jwt) => {
    const c = chipOf(jwt);
    const exp = tokenClaims(jwt)?.exp;
    return c ? `chip ${String(c.id || '?').slice(0, 8)} · type ${c.prbn ?? '?'} · cards ${c.cards == null ? 'none' : c.cards.length} · account ${c.ag ? 'yes' : 'no'}${exp ? ` · expires ${new Date(exp * 1000).toLocaleDateString()}` : ''}` : 'unreadable token';
  };
  const err = (e) => `${e.status ? e.status + ' ' : ''}${e.message}`.slice(0, 160);
  const acct = libbyAccount.get();
  say(`App ${NATIVE ? 'Android' : 'web'} · client ${CLIENT_VERSION} · host ${new URL(GATE).host}`);
  if (!acct.identity) return say('Not signed in'), out;
  say(`Signed in via: ${acct.via || 'unknown (older version)'}`);
  say(`Saved sign-in: ${desc(acct.identity)} · saved chip id ${acct.chipId ? acct.chipId.slice(0, 8) : 'none'}`);
  const chipId = acct.chipId || chipOf(acct.identity)?.id || '';
  const v = chipId ? `&v=${String(chipId).slice(0, 8)}` : '';
  for (const f of [`chip?${MINT}${v}`, `chip?client=dewey${v}`, `chip?${MINT}`]) {
    try {
      const r = await call('POST', READ, f, { identity: acct.identity });
      say(`Refresh ${f.replace(/c=d%3A[\d.]+&s=0/, 'web')}: ${desc(r?.identity)}${r?.chip ? ` · reply chip cards ${r.chip.cards == null ? 'none' : r.chip.cards.length}` : ''}`);
    } catch (e) {
      say(`Refresh ${f.replace(/c=d%3A[\d.]+&s=0/, 'web')}: ✗ ${err(e)}`);
    }
  }
  let d = null;
  try {
    d = await call('GET', READ, 'chip/sync', { identity: acct.identity });
    say(`Sync: ${d?.result || '?'} · ${(d?.cards || []).length} cards · ${(d?.loans || []).length} loans · ${(d?.holds || []).length} holds`);
    for (const c of d?.cards || []) say(`  card ${c.cardId} · ${c.advantageKey} · ${c.library?.name || c.cardName || ''} · website ${c.library?.websiteId ?? c.websiteId ?? '?'}`);
    for (const c of tokenClaims(acct.identity)?.chip?.cards || []) say(`  in sign-in: ${JSON.stringify(c).slice(0, 90)}`);
  } catch (e) {
    say(`Sync: ✗ ${err(e)}`);
  }
  const loan = (d?.loans || []).find((l) => formatOf(l) === 'audiobook') || (d?.loans || [])[0];
  if (loan) {
    const card = (d?.cards || []).find((c) => String(c.cardId) === String(loan.cardId));
    const key = card?.advantageKey || '';
    const ws = await websiteFor(loan.cardId);
    const websiteId = ws.id;
    say(`Website id: ${websiteId || 'none'} (from ${ws.from})`);
    const codex = { codex: { title: { titleId: String(loan.id), slug: String(loan.id) }, loan: { psnKey: `${loan.cardId}-${loan.id}`, slug: `${loan.cardId}-${loan.id}` }, library: { key, name: card?.library?.name || key } }, 'dewey-url': 'https://libbyapp.com', spec: 'V31' };
    const t = encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(codex)))));
    const kind = formatOf(loan) === 'audiobook' ? 'audiobook' : 'book';
    say(`Opening "${String(loan.title).slice(0, 30)}" (${kind}):`);
    const variants = [
      ['as the app does', `open/${kind}/card/${loan.cardId}/title/${loan.id}?t=${t}&website_id=${websiteId}`, OPEN_HEADERS],
      ['without fetch headers', `open/${kind}/card/${loan.cardId}/title/${loan.id}?t=${t}&website_id=${websiteId}`, {}],
      ['plain', `open/${kind}/card/${loan.cardId}/title/${loan.id}`, {}],
    ];
    for (const [label, path, headers] of variants) {
      try {
        const r = await call('GET', GATE, path, { identity: acct.identity, timeout: 45000, headers });
        say(`  ${label}: ✓ ${r?.urls?.web ? 'got player link' : 'no player link'}${r?.message ? ' · message' : ''}`);
      } catch (e) {
        say(`  ${label}: ✗ ${err(e)}`);
      }
    }
    try {
      const p = await call('GET', GATE, `card/${loan.cardId}/loan/${loan.id}/periods`, { identity: acct.identity });
      say(`Loan periods: ✓ ${JSON.stringify(p?.preference || p?.options || p).slice(0, 60)}`);
    } catch (e) {
      say(`Loan periods: ✗ ${err(e)}`);
    }
  } else say('No loans to test opening with');
  return out;
}

/**
 * The library "website id" for a card, which Libby needs when opening a loan.
 * The sign-in token lists cards as [.., cardId, .., .., websiteId, library].
 */
async function websiteFor(cardId, identity = libbyAccount.get().identity) {
  const entry = (tokenClaims(identity)?.chip?.cards || []).find((c) => Array.isArray(c) && String(c[1]) === String(cardId));
  if (entry && entry[4] != null && entry[4] !== '') return { id: entry[4], from: 'sign-in' };
  const card = (libbyAccount.get().cards || []).find((c) => String(c.cardId) === String(cardId));
  const fromCard = card?.library?.websiteId ?? card?.websiteId;
  if (fromCard != null) return { id: fromCard, from: 'card' };
  const info = await libraryInfo(card?.advantageKey || libraries()[0]?.key || '').catch(() => null);
  return { id: info?.websiteId ?? '', from: 'catalogue' };
}

const OPEN_HEADERS = NATIVE ? { 'Sec-Fetch-Site': 'same-site', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty', Referer: 'https://libbyapp.com/' } : {};

/** Where a loan lives in the Libby app (for opening it there). */
export const libbyShelfUrl = () => 'https://libbyapp.com/shelf/loans/default';

/** For Settings: what the current sign-in token carries. */
export function tokenInfo() {
  const c = tokenClaims(libbyAccount.get().identity)?.chip;
  if (!c) return '';
  return `${(c.cards || []).length} card${(c.cards || []).length === 1 ? '' : 's'} in sign-in${c.prbn ? ` · type ${c.prbn}` : ''}`;
}

/** Libby's code expiry: a Unix time (s or ms), a date, or seconds from now. */
const expiryOf = (x) => {
  if (x == null || x === '') return Date.now() + 60e3;
  const n = +x;
  if (Number.isFinite(n)) {
    if (n > 1e12) return n;
    if (n > 1e9) return n * 1000;
    return Date.now() + Math.max(20, n) * 1000;
  }
  return Date.parse(x) || Date.now() + 60e3;
};
const pretty = (code) => String(code).padStart(8, '0').replace(/(\d{4})(\d{4})/, '$1 $2');

/**
 * Libby's "Display Setup Code" flow: this app shows a code, you enter it on the
 * phone that has your cards (Libby → Menu → Copy To Another Device). Then this
 * chip holds your cards; re-minting its token makes them visible.
 * Returns { done, cancel }; onCode({code, expires}) for each code shown.
 */
export function pairWithCode(onCode, onStatus = () => {}) {
  let cancelled = false;
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const done = (async () => {
    let chip = await mint();
    const getCode = async () => {
      const r = await call('GET', READ, 'chip/clone/code', { identity: chip.identity });
      if (!r?.code) throw new Error("Libby didn't give this device a code — try again");
      const expires = expiryOf(r.expiry);
      onCode({ code: pretty(r.code), expires });
      return expires;
    };
    let expires = await getCode();
    let fails = 0;
    let n = 0;
    const until = Date.now() + 10 * 60e3;
    while (!cancelled && Date.now() < until) {
      await sleep(3000);
      if (cancelled) break;
      n++;
      try {
        chip = await mint(chip.identity, chip.chipId);
        const cards = chipCards(chip.identity);
        if (cards.length) return await finish(chip).then((n) => (libbyAccount.set((a) => ({ ...a, via: 'code from this app' })), n));
        const d = await call('GET', READ, 'chip/sync', { identity: chip.identity });
        if ((d?.cards || []).length) return await finish(chip);
        onStatus(`Check ${n} · no cards yet (${d?.result || '…'})`);
        fails = 0;
      } catch (e) {
        onStatus(`Check ${n} · ${e.message}`);
        if (++fails >= 5) throw new Error(`Couldn't check with Libby: ${e.message}`);
      }
      if (Date.now() > expires) expires = await getCode().catch(() => Date.now() + 30e3);
    }
    if (!cancelled) throw new Error('Nothing came through from Libby — get a new code and try again');
    return '';
  })();
  return { done, cancel: () => (cancelled = true) };
}

/** The other direction: type the 8-digit code your Libby app shows. */
export async function signInWithCode(code) {
  const c = String(code || '').replace(/\D/g, '');
  if (c.length !== 8) throw new Error('Enter the 8-digit code Libby shows');
  const chip = await mint();
  await call('POST', READ, 'chip/clone/code', { identity: chip.identity, body: { code: c, role: 'secondary' } }).catch((e) => {
    throw new Error(e.status === 400 || e.status === 404 ? "Libby didn't accept that code — it may have expired" : `Libby: ${e.message}`);
  });
  const names = await finish(await mint(chip.identity, chip.chipId));
  libbyAccount.set((a) => ({ ...a, via: 'code from Libby' }));
  return names;
}

/** Library facts from OverDrive: its website id is what card sign-in needs. */
async function libraryInfo(key) {
  const d = await getJson(`${THUNDER}/libraries/${encodeURIComponent(key)}`, { timeout: 15000 });
  const websiteId = d?.websiteId ?? (Number.isFinite(+d?.id) ? d.id : undefined);
  if (!websiteId) throw new Error(`Couldn't find ${key}'s sign-in details`);
  return { websiteId, name: d?.name || key };
}

/**
 * Sign in with a library card number and PIN (no phone needed). Adds the card to
 * this device's Libby account; call again for more cards.
 */
export async function signInWithCard(input, cardNumber, pin = '') {
  const key = parseLibrary(input) || String(input || '').trim().toLowerCase();
  if (!key) throw new Error('Choose or paste the library first');
  if (!String(cardNumber || '').trim()) throw new Error('Enter your library card number');
  const { websiteId } = await libraryInfo(key);
  const forms = (await call('GET', READ, `auth/forms/${websiteId}`))?.forms || [];
  const form = forms.find((f) => f.ilsName === key) || forms.find((f) => f.ilsName) || null;
  if (!form) throw new Error("This library doesn't allow signing in here — use the code option instead");
  const body = { ils: form.ilsName, username: String(cardNumber).trim(), password: String(pin || '') };
  const link = async (identity) =>
    call('POST', READ, `auth/link/${websiteId}`, { identity, body }).catch((e) => {
      throw new Error(e.status === 401 || /credentials/i.test(e.message) ? 'The library rejected that card number or PIN' : `Libby: ${e.message}`);
    });

  const acct = libbyAccount.get();
  if (acct.identity) {
    // Already signed in: add this card to the same account.
    const chipId = acct.chipId || tokenClaims(acct.identity)?.chip?.id || '';
    await link(acct.identity);
    return finish(await mint(acct.identity, chipId));
  }
  // Like the Libby web app: link the card on one chip, then copy it to a second
  // chip with a setup code (only that kind of chip can open audiobooks).
  const primary = await mint();
  await link(primary.identity);
  const ready = await mint(primary.identity, primary.chipId).catch(() => primary);
  let why = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await call('GET', READ, 'chip/clone/code?role=primary', { identity: ready.identity });
      if (!r?.code) throw new Error('no setup code');
      const secondary = await mint();
      await call('POST', READ, 'chip/clone/code', { identity: secondary.identity, body: { code: String(r.code), role: 'secondary' } });
      const names = await finish(await mint(secondary.identity, secondary.chipId));
      libbyAccount.set((a) => ({ ...a, via: 'card → copied chip' }));
      return names;
    } catch (e) {
      why = e.message;
      await new Promise((res) => setTimeout(res, 1500));
    }
  }
  const names = await finish(ready);
  libbyAccount.set((a) => ({ ...a, via: `card only (copy failed: ${why})` }));
  return names;
}

export function signOut() {
  libbyAccount.set({ identity: '', chipId: '', cards: [], loans: [], holds: [], syncedAt: 0, mintedAt: 0 });
}

/** Cards, loans and holds (renewing the week-long sign-in every few days). */
export async function syncAccount() {
  const acct = libbyAccount.get();
  if (acct.identity && Date.now() - (acct.mintedAt || 0) > 2 * 86400e3) {
    const chipId = acct.chipId || tokenClaims(acct.identity)?.chip?.id || '';
    const fresh = await mint(acct.identity, chipId).catch(() => null);
    if (fresh) libbyAccount.set((a) => ({ ...a, identity: fresh.identity, chipId: fresh.chipId, mintedAt: Date.now() }));
  }
  const d = await call('GET', READ, 'chip/sync', { identity: libbyAccount.get().identity });
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
  return cards.find((c) => c.advantageKey === key) || (key ? null : cards[0]);
}

export function loanFor(titleId) {
  // Title ids are per library, so a loan matches on id (any card).
  return (libbyAccount.get().loans || []).find((l) => String(l.id) === String(titleId));
}

const reporting = () => ({ clientName: 'Dewey', clientVersion: CLIENT_VERSION, environment: 'charlie' });

/** Borrow a title that's available now. */
export async function borrow(titleId, format, key = libraries()[0]?.key) {
  const card = cardFor(key);
  if (!card) throw new Error(signedIn() ? "You don't have a card for this library — add it in Settings → Libby" : 'Sign in to Libby first (Settings → Libby)');
  const kind = format === 'audiobook' ? 'audiobook' : 'ebook';
  await withChip(async (identity) => {
    let pref = null;
    try {
      const p = await call('GET', GATE, `card/${card.cardId}/loan/${titleId}/periods`, { identity });
      pref = p?.preference || p?.options?.[p.options.length - 1] || null;
    } catch {}
    pref ||= card.lendingPeriods?.[kind === 'audiobook' ? 'audiobook' : 'book']?.preference || [14, 'days'];
    const bodies = [
      { period: pref[0], units: pref[1] || 'days', lucky_day: 0, title_format: kind, reporting_context: reporting() },
      { period: pref[0], units: pref[1] || 'days', lucky_day: null, title_format: kind },
      { period: 14, units: 'days', lucky_day: null, title_format: kind },
    ];
    let last;
    for (const body of bodies) {
      try {
        return await call('POST', GATE, `card/${card.cardId}/loan/${titleId}`, { identity, body });
      } catch (e) {
        last = e;
        if (e.status !== 400) throw e;
      }
    }
    throw new Error(`Libby wouldn't lend it (${last.message.replace(/^HTTP \d+ — /, '')}) — your card may be at its loan limit, or the library needs you to borrow this one in Libby`);
  });
  await syncAccount();
  return `Borrowed with your ${card.library?.name || ''} card`.replace('  ', ' ');
}

/** Join the waitlist. */
export async function placeHold(titleId, key = libraries()[0]?.key) {
  const card = cardFor(key);
  if (!card) throw new Error(signedIn() ? "You don't have a card for this library — add it in Settings → Libby" : 'Sign in to Libby first (Settings → Libby)');
  await withChip((identity) => call('POST', GATE, `card/${card.cardId}/hold/${titleId}`, { identity, body: { days_to_suspend: 0, email_address: '' } }));
  await syncAccount();
  return 'Hold placed — Libby will tell you when it is ready';
}

/** Give a loan back early. */
export async function returnLoan(cardId, titleId) {
  await call('DELETE', GATE, `card/${cardId}/loan/${titleId}`, { identity: libbyAccount.get().identity });
  await syncAccount();
  return 'Returned';
}

// ---- Opening a borrowed audiobook ------------------------------------------
// The listen page embeds the book's parts ("openbook") scrambled in window.eData;
// this reproduces the web player's decode (after libby-archiver's notes).

function parseStringArray(literal) {
  try {
    const j = JSON.parse(literal);
    if (Array.isArray(j) && j.every((x) => typeof x === 'string')) return j;
  } catch {}
  const out = [];
  let cur = '';
  let q = '';
  for (let i = 0; i < literal.length; i++) {
    const c = literal[i];
    if (!q) {
      if (c === '"' || c === "'") q = c;
      else if (!/[\s,\[\]]/.test(c)) throw new Error('Unexpected audiobook page format');
      continue;
    }
    if (c === q) {
      out.push(cur);
      cur = '';
      q = '';
    } else if (c === '\\') {
      const e = literal[++i];
      if (e === 'x') (cur += String.fromCharCode(parseInt(literal.slice(i + 1, i + 3), 16))), (i += 2);
      else if (e === 'u') (cur += String.fromCharCode(parseInt(literal.slice(i + 1, i + 5), 16))), (i += 4);
      else cur += { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' }[e] ?? e;
    } else cur += c;
  }
  return out;
}

export function decodeOpenbook(html, buid) {
  const m = html.match(/window\.eData\s*=\s*(\[[\s\S]*?\])\s*;\s*SPARK\.bifocalPath/);
  if (!m) throw new Error("Couldn't read this audiobook's parts (Libby changed its player)");
  const key = buid.split('').reverse().join('');
  const shifts = [...key].map((k) => parseFloat(k) || 0);
  const data = parseStringArray(m[1]).join('"');
  let out = '';
  for (let a = 0; a < data.length; a++) {
    let ch = data.charCodeAt(a);
    const d = shifts[a % shifts.length];
    if (d) {
      ch += (a + d) % 94;
      if (ch > 126) ch = (ch % 126) + 32;
    }
    out += String.fromCharCode(ch);
  }
  const bin = atob(out);
  const json = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  const doc = JSON.parse(json);
  if (!doc?.b) throw new Error("Couldn't read this audiobook's parts");
  return doc.b;
}

/** A borrowed audiobook as a playable book: its parts and chapters. */
export async function openLoan(book) {
  const { cardId, titleId, format } = book.libbyLoan || {};
  if (format !== 'audiobook') throw new Error('Open this one in the Libby app');
  if (!NATIVE) throw new Error('Libby audiobooks play in the Android app — or open it in Libby');
  const acct = libbyAccount.get();
  const card = (acct.cards || []).find((c) => String(c.cardId) === String(cardId));
  const libKey = card?.advantageKey || libraries()[0]?.key || '';
  const websiteId = (await websiteFor(cardId)).id;
  const codex = { codex: { title: { titleId: String(titleId), slug: String(titleId) }, loan: { psnKey: `${cardId}-${titleId}`, slug: `${cardId}-${titleId}` }, library: { key: libKey, name: card?.library?.name || libKey } }, 'dewey-url': 'https://libbyapp.com', spec: 'V31' };
  const t = encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(codex)))));
  const openPath = `open/audiobook/card/${cardId}/title/${titleId}?t=${t}&website_id=${websiteId}`;
  const passport = await withChip((identity) => call('GET', GATE, openPath, { identity, timeout: 45000, headers: OPEN_HEADERS }))
    .catch(async (e) => {
      // "whoa" is Libby asking us to slow down: pause, refresh the sign-in, try once more.
      if (!/whoa/i.test(e.message)) throw e;
      await new Promise((res) => setTimeout(res, 4000));
      const identity = await ensureChip({ force: true }).catch(() => libbyAccount.get().identity);
      return call('GET', GATE, openPath, { identity, timeout: 45000, headers: OPEN_HEADERS });
    })
    .catch((e) => {
      throw new Error(/whoa/i.test(e.message) ? 'Libby is refusing to open this book outside its own app right now ("whoa"). Use Open in Libby to listen, and try here again later.' : `Libby didn't open this audiobook: ${e.message}`);
    });
  const web = passport?.urls?.web;
  if (!web) throw new Error("Libby didn't open this audiobook — try again, or open it in Libby");
  const host = new URL(web).host;
  const buid = host.split('.')[0].replace(/^[^-]+-/, '');
  // The signed message sets the listen site's session cookie (kept by the app), then the player page.
  if (passport.message) await fetchText(web + '?' + passport.message, { timeout: 45000, headers: LIKE_LIBBY }).catch(() => {});
  const html = await fetchText(web + '?kathava=' + Date.now(), { timeout: 45000, headers: { ...LIKE_LIBBY, Accept: 'text/html' } }).catch((e) => {
    throw new Error(`Couldn't load Libby's player page: ${e.message}`);
  });
  const ob = decodeOpenbook(html, buid);
  const spine = ob.spine || [];
  const cmpts = ob['-odread-cmpt-params'] || [];
  const base = web.replace(/\/$/, '');
  let offset = 0;
  const tracks = spine.map((part, i) => {
    const cmpt = cmpts[part['-odread-spine-position'] ?? i] || '';
    const tr = { title: `Part ${i + 1}`, url: `${base}/${part.path}${cmpt ? '?' + cmpt : ''}`, duration: part['audio-duration'] || 0, offset, index: i };
    offset += tr.duration;
    return tr;
  });
  if (!tracks.length) throw new Error('This audiobook has no playable parts');
  // Table of contents: "part.mp3#123" → part index + seconds.
  const flat = [];
  const walk = (items) => (items || []).forEach((n) => (flat.push(n), walk(n.contents)));
  walk(ob.nav?.toc);
  const clean = (p) => decodeURIComponent(String(p || '').split('?')[0]);
  const chaptersMeta = flat
    .map((n) => {
      const [p, sec] = String(n.path || '').split('#');
      const i = spine.findIndex((s) => clean(s.path) === clean(p) || clean(s['-odread-original-path']) === clean(p));
      return i < 0 ? null : { title: n.title, start: tracks[i].offset + (+sec || 0) };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start)
    .map((c, i, all) => ({ ...c, end: all[i + 1]?.start ?? offset }));
  return {
    ...book,
    title: ob.title?.main || book.title,
    author: (ob.creator || []).filter((c) => /author/i.test(c.role || 'author')).map((c) => c.name).join(', ') || book.author,
    narrator: (ob.creator || []).filter((c) => /narrator/i.test(c.role || '')).map((c) => c.name).join(', '),
    description: (ob.description?.full || ob.description?.short || '').replace(/<[^>]+>/g, ' ').trim(),
    duration: offset,
    tracks,
    chaptersMeta: chaptersMeta.length ? chaptersMeta : undefined,
  };
}

export const loanSource = { details: openLoan };
