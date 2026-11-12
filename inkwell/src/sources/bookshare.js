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
    throw fail(`${NAME}: ${e?.message || 'didn’t answer'} — try again in a moment`);
  });
  const html = r.html || '';
  return { status: r.status || 200, html, url: r.url || '', doc: new DOMParser().parseFromString(html, 'text/html') };
}

// Signed in: the page offers to sign out (and no longer to log in).
const signedIn = (doc, html) => /sign ?out|log ?out/i.test(html) && !!doc.querySelector('a[href*="logout" i], a[href*="signout" i], button[name*="logout" i], form[action*="logout" i]');

/** { signedIn, why } — read from Bookshare's own page in the hidden browser. */
export async function status() {
  if (!available()) return { signedIn: false, why: 'Android app only' };
  const { doc, html } = await page('/', null);
  return signedIn(doc, html) ? { signedIn: true } : { signedIn: false, why: 'Not signed in' };
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
  if (/\/login|sign.?in/i.test(url) && !doc.querySelector('a[href*="/browse/book/"]')) throw fail(`Sign in to ${NAME} first: Settings → Addons → ${NAME} → Sign in`, { signin: true });
  const books = booksOn(doc);
  if (!books.length) logError(NAME, `“${q}”: HTTP ${st} · page “${clean(doc.title).slice(0, 60)}” · ${html.length} chars · 0 books read`);
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
