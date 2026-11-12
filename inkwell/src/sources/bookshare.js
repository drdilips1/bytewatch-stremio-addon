// Bookshare (Audiohub+ only): your own Bookshare membership, used in the app's browser.
//
// You sign in once in the in-app browser; its cookies stay in the app. Searching opens
// Bookshare's search page in a hidden browser with your session and lists its books; a result
// opens the book's page in the in-app browser, where a download (EPUB 3 — zipped or not, or
// PDF) is saved straight into your Library and opens in the reader. Nothing about your
// account leaves the phone.
import { registerPlugin, Capacitor } from '@capacitor/core';
import { logError } from '../lib/report.js';

const Web = registerPlugin('InkwellWeb');
export const BASE = 'https://www.bookshare.org';
export const NAME = 'Bookshare';
export const ID = 'bookshare';

export const available = () => Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('InkwellWeb');

/** The record that makes it a source in Settings → Addons (searched in the browser, not fetched). */
export const addonRecord = () => ({
  kind: 'source',
  special: 'bookshare',
  url: '',
  manifest: { id: ID, name: NAME, version: '1.0.0', description: 'Accessible ebooks from your Bookshare membership, searched in your signed-in in-app browser', provides: ['source'], contentType: 'ebook', adapters: { source: {} } },
});

const fail = (message, extra = {}) => Object.assign(new Error(message), { final: true, ...extra });
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** Open Bookshare in the in-app browser (sign in there; downloads go to your Library). */
export const open = (url = BASE + '/') => Web.open({ url, title: NAME, books: true });
export const signIn = () => open(BASE + '/');

async function page(path, waitFor) {
  const r = await Web.pageVisit({ url: BASE + path, timeout: 25000, ...(waitFor ? { waitFor } : {}) }).catch((e) => {
    logError(NAME, `${path.split('?')[0]}: ${e?.message || 'didn’t answer'}`);
    throw fail(`${NAME}: ${e?.message || 'didn’t answer'} — try again in a moment`);
  });
  const html = r.html || '';
  return { status: r.status || 200, html, url: r.url || '', doc: new DOMParser().parseFromString(html, 'text/html') };
}

// Signed in: the page offers to sign out, or (menus often hide that link until opened) it
// shows member pages and no longer offers to log in.
const logoutOn = (doc, html) =>
  !!doc.querySelector('a[href*="logout" i], a[href*="signout" i], a[href*="sign-out" i], a[href*="log-out" i], form[action*="logout" i]') || /\b(sign|log) ?out\b/i.test(html);
const loginOn = (doc) =>
  [...doc.querySelectorAll('a, button')].some((el) => /^\s*(log ?in|sign ?in)\s*$/i.test(el.textContent || '') || /\/(login|signin|sign-in)\b/i.test(el.getAttribute('href') || ''));
const memberOn = (html) => /my bookshare|my account|reading lists?|download history|my history|my books/i.test(html);
const signedIn = (doc, html) => logoutOn(doc, html) || (!loginOn(doc) && memberOn(html));

/** { signedIn, why } — read from Bookshare's own page in the hidden browser. */
export async function status() {
  if (!available()) return { signedIn: false, why: 'Android app only' };
  const { status: st, doc, html, url } = await page('/', null);
  const ok = signedIn(doc, html);
  // For Report a problem: what the check saw (no page text, no cookies).
  logError(NAME, `sign-in check: ${ok ? 'signed in' : 'not signed in'} — HTTP ${st} · page “${clean(doc.title).slice(0, 60)}” · ${String(url).replace(/[?#].*$/, '')} · ${html.length} chars · log out: ${logoutOn(doc, html) ? 'yes' : 'no'} · log in: ${loginOn(doc) ? 'yes' : 'no'} · member words: ${memberOn(html) ? 'yes' : 'no'}`);
  return ok ? { signedIn: true } : { signedIn: false, why: 'Not signed in' };
}

/** A search page → [{ id, title, author, url, cover }] (links to /browse/book/<id>). */
export function booksOn(doc) {
  const out = [];
  const seen = new Set();
  for (const a of doc.querySelectorAll('a[href*="/browse/book/"]')) {
    const href = a.getAttribute('href') || '';
    const id = /\/browse\/book\/(\d+)/.exec(href)?.[1];
    const title = clean(a.textContent);
    if (!id || seen.has(id) || title.length < 2) continue;
    seen.add(id);
    // The result's own box: the closest ancestor with this one book link.
    let box = a;
    for (let el = a.parentElement; el && el !== doc.body; el = el.parentElement) {
      if (new Set([...el.querySelectorAll('a[href*="/browse/book/"]')].map((x) => /\/browse\/book\/(\d+)/.exec(x.getAttribute('href') || '')?.[1])).size > 1) break;
      box = el;
    }
    const author = clean([...box.querySelectorAll('a[href*="author" i], [class*="author" i]')].map((x) => x.textContent).find((t) => clean(t) && clean(t) !== title) || '').replace(/^by\s+/i, '');
    const img = box.querySelector('img[src]');
    out.push({ id, title, author, url: `${BASE}/browse/book/${id}`, cover: img ? new URL(img.getAttribute('src'), BASE + '/').href : '' });
  }
  return out;
}

/** Search your Bookshare (title, author…) → source results; each opens its page in the app. */
export async function search(query) {
  if (!available()) throw fail(`${NAME} works in the Android app only (it uses the in-app browser)`);
  const q = clean(query);
  if (!q) return [];
  const { status: st, doc, html, url } = await page(`/search?keyword=${encodeURIComponent(q)}`, '(?i)/browse/book/\\d+|no results|0 results|did not match');
  if (st >= 400) {
    logError(NAME, `HTTP ${st} on the search`);
    throw fail(`${NAME} answered HTTP ${st} — try again later`);
  }
  if (/\/login|sign.?in/i.test(url) && !doc.querySelector('a[href*="/browse/book/"]')) logError(NAME, `“${q}”: sent to sign in — ${String(url).replace(/[?#].*$/, '')} · page “${clean(doc.title).slice(0, 60)}”`);
  if (/\/login|sign.?in/i.test(url) && !doc.querySelector('a[href*="/browse/book/"]')) throw fail(`Sign in to ${NAME} first: Settings → Addons → ${NAME} → Sign in`, { signin: true });
  const books = booksOn(doc);
  // Every search, found or not, so a report shows what Bookshare answered.
  logError(NAME, `“${q}”: ${books.length} found — HTTP ${st} · page “${clean(doc.title).slice(0, 60)}” · ${String(url).replace(/[?#].*$/, '')} · ${html.length} chars · ${(html.match(/\/browse\/book\/\d+/g) || []).length} book links`);
  return books.map((b) => ({
    key: `${ID}:${b.id}`,
    addon: NAME,
    contentType: 'ebook',
    title: b.title,
    author: b.author,
    narrator: '',
    magnet: '',
    hash: '',
    size: 0,
    seeders: null,
    format: 'EPUB',
    cover: b.cover,
    cache: { any: false },
    link: b.url,
    inApp: true, // opens in the in-app browser, where you're signed in
    bookshare: true, // …and a download there is saved into your Library
    score: 1,
  }));
}

/**
 * One tap from a book page: find this book on Bookshare and get it — its page opens, EPUB 3
 * is chosen and downloaded by itself, it's saved to your Library and opens in the reader.
 * Resolves { title, background }, or throws when Bookshare hasn't got it.
 */
export async function getBook({ title = '', author = '' }, pick = (list) => list[0]) {
  let list = await search([title, author].filter(Boolean).join(' '));
  if (!list.length && author) list = await search(title);
  const hit = pick(list);
  if (!hit) throw fail(`“${title}” isn't on ${NAME} (or it's under another title — hold BS to search)`);
  return fetchBook(hit);
}
/** Bookshare's search page for this book, in the app (download from there to your Library). */
export const openSearch = (q) => open(`${BASE}/search?keyword=${encodeURIComponent(clean(q))}`);

/**
 * Get one Bookshare book in the background: a hidden browser opens its page (your session),
 * picks EPUB and presses Download; it's saved to your Library and opens in the reader. Only
 * when its page has no Download to press does the page open for you.
 */
export async function fetchBook(hit) {
  try {
    const r = await Web.bookshareGet({ url: hit.link });
    logError(NAME, `got “${hit.title}” in the background — ${r?.name || ''}${r?.via ? ` (${r.via})` : ''}`);
    return { title: hit.title, background: true };
  } catch (e) {
    const why = e?.message || '';
    logError(NAME, `get in the background: ${why}`);
    if (!/no-download|not implemented|is not a function/i.test(why)) throw fail(why);
    await Web.open({ url: hit.link, title: NAME, books: true, autoGet: true });
    return { title: hit.title, background: false };
  }
}
