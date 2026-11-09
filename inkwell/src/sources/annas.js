// Anna's Archive (Audiohub+, Android): ebooks searched in the app's hidden browser — the same
// cookies and browser as the in-app browser, where you pass the site's bot check (and sign in
// if you like) yourself. Nothing goes through a server. With your membership's secret key
// (Settings, kept on this phone), its fast downloads give Read / Save in the app; without it,
// a result opens its page in the in-app browser.
import { registerPlugin, Capacitor } from '@capacitor/core';
import { persisted } from '../lib/store.js';
import { logError } from '../lib/report.js';
import { hrefsIn, libgenByMd5 } from '../lib/libgendirect.js';

const Web = registerPlugin('InkwellWeb');
export const NAME = "Anna's Archive";
export const ID = 'annas-archive';
// Its address changes now and then (mirrors): set in Settings.
export const annas = persisted('annas', { base: 'https://annas-archive.pk', key: '' });
const DEFAULT_BASE = 'https://annas-archive.pk';
/** "annas-archive.li", " https://annas-archive.li/search?q=x " → "https://annas-archive.li" (the site's address only). */
export function normBase(v) {
  let t = String(v || '').trim().replace(/\s+/g, '');
  if (!t) return DEFAULT_BASE;
  if (!/^https?:\/\//i.test(t)) t = 'https://' + t.replace(/^\/+/, '');
  try {
    const u = new URL(t);
    return /\./.test(u.hostname) ? `${u.protocol}//${u.host}` : DEFAULT_BASE;
  } catch {
    return DEFAULT_BASE;
  }
}
const base = () => normBase(annas.get().base);
export const hasKey = () => !!String(annas.get().key || '').trim();

export const available = () => Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('InkwellWeb');

export const addonRecord = () => ({
  kind: 'source',
  special: 'annas',
  url: '',
  manifest: { id: ID, name: NAME, version: '1.0.0', description: 'Ebooks from Anna’s Archive, searched in your in-app browser', provides: ['source'], contentType: 'ebook', adapters: { source: {} } },
});

const fail = (message, extra = {}) => Object.assign(new Error(message), { final: true, ...extra });
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const PAGE_TIMEOUT = 30000;
let busyUntil = 0; // "too many requests": left alone for a minute

/** Open the site in the in-app browser: pass the bot check (and sign in with your key, if you like). */
export function signIn() {
  return Web.open({ url: `${base()}/account/`, title: NAME });
}

// One page, visited in the hidden browser as a person would (the site's bot check refuses
// background requests): it waits for the page — and for a check page to solve itself — then
// reads it. { status, html, text (the page's words: JSON answers come as text), doc, check }.
async function page(path) {
  const r = await Web.pageVisit({ url: base() + path, timeout: 25000 }).catch((e) => {
    throw fail(`${NAME}: ${e?.message || 'didn’t answer'} — try again in a moment`);
  });
  const html = r.html || '';
  return { status: r.status || 200, html, text: r.text || '', check: !!r.check, title: r.title || '', doc: new DOMParser().parseFromString(html, 'text/html') };
}

// DDoS-Guard / Cloudflare's "checking your browser" instead of the site.
const challenged = (html) => /ddos-guard|just a moment|checking your browser|challenge-platform|cf-chl/i.test(html) && !/\/md5\/[a-f0-9]{32}/i.test(html);

/**
 * { ok, signedIn, key, why }: can the hidden browser use the site, are you signed in there,
 * and does your secret key work (asked of the members' download service with a dummy book)?
 */
export async function status() {
  if (!available()) return { ok: false, why: 'Android app only' };
  const { status: st, html, doc, check } = await page('/account/');
  if (check || challenged(html)) return { ok: false, why: 'The site is checking the browser — tap Open, wait for it to load' };
  if (st >= 400) return { ok: false, why: `The site answered HTTP ${st} — check the address` };
  // Signed in: the account page shows a log-out button / form and your account id; signed out,
  // it shows the box to enter your secret key.
  const out = !!doc.querySelector('form[action*="logout"], a[href*="logout"], button[name*="logout"]') || /\/account\/logout|account id|your account/i.test(html);
  const loginBox = !!doc.querySelector('input[name="key"]');
  const signedIn = out || (!loginBox && /secret key/i.test(html));
  let key = null; // true / false / null (no key, or couldn't tell)
  if (hasKey()) {
    try {
      const k = encodeURIComponent(String(annas.get().key).trim());
      const r = await page(`/dyn/api/fast_download.json?md5=00000000000000000000000000000000&key=${k}`);
      const t = String(r.text || r.html || '');
      if (/invalid secret key|not a member|no membership|key.*invalid/i.test(t)) key = false;
      else if (/md5|record|not found|download_url|downloads_left/i.test(t)) key = true;
    } catch {}
  }
  return { ok: true, signedIn, key };
}

const FORMATS = /\b(epub|pdf|mobi|azw3|fb2|djvu|cbz|cbr|txt|docx?|rtf|lit)\b/i;
const SIZE = /(\d+(?:[.,]\d+)?)\s?(KB|MB|GB)\b/i;
const FORMAT_ONLY = new RegExp(`^\\.?${FORMATS.source.replace(/\\b/g, '')}$`, 'i');
/**
 * The file type from the facts line ("English [en] · EPUB · 1.7MB · 2005 · …"): the part that is
 * only a type wins — a word like "txt" or "lit" elsewhere in the text (a file path, a title) doesn't.
 */
export function formatIn(facts) {
  const parts = String(facts || '').split(/\s*[·•|,]\s*/).map((x) => x.trim());
  const only = parts.find((x) => FORMAT_ONLY.test(x));
  if (only) return only.replace(/^\./, '').toUpperCase();
  const all = [...String(facts || '').matchAll(new RegExp(FORMATS.source, 'gi'))].map((m) => m[1].toUpperCase());
  return all.find((f) => f === 'EPUB' || f === 'PDF') || all[0] || '';
}
const LANG = /\b([A-Z][a-zA-Z]+(?:\s[A-Z][a-z]+)?)\s\[([a-z]{2,3})\]/;
const toBytes = (m) => (m ? Math.round(parseFloat(m[1].replace(',', '.')) * { KB: 1024, MB: 1048576, GB: 1073741824 }[m[2].toUpperCase()]) : 0);

/**
 * The search results page → results. Some results come inside HTML comments (shown as you
 * scroll); those are read too. One result per book file (/md5/<hash>).
 */
export function parseResults(html, siteBase = base()) {
  const doc = new DOMParser().parseFromString(String(html || '').replace(/<!--|-->/g, ''), 'text/html');
  const byHash = new Map();
  for (const a of doc.querySelectorAll('a[href*="/md5/"]')) {
    const hash = /\/md5\/([a-f0-9]{32})/i.exec(a.getAttribute('href') || '')?.[1]?.toLowerCase();
    if (!hash) continue;
    if (!byHash.has(hash)) byHash.set(hash, []);
    byHash.get(hash).push(a);
  }
  const out = [];
  for (const [hash, links] of byHash) {
    // The result's own box: the widest ancestor holding links to this file only.
    let box = links[0];
    for (let el = links[0].parentElement; el && el !== doc.body; el = el.parentElement) {
      const others = [...el.querySelectorAll('a[href*="/md5/"]')].some((x) => !(x.getAttribute('href') || '').toLowerCase().includes(hash));
      if (others) break;
      box = el;
    }
    const text = clean(box.textContent);
    const title = clean(
      [...links, ...box.querySelectorAll('h3')]
        .map((x) => clean(x.textContent))
        .filter((t) => t.length > 1 && !FORMATS.test(t.split(' ')[0] || ''))
        .sort((a, b) => b.length - a.length)[0] || ''
    ).slice(0, 300);
    if (!title) continue;
    const authorEl = box.querySelector('a[href*="/search?q="] .icon-\\[mdi--user-edit\\]')?.parentElement || box.querySelector('[class*="user-edit"]')?.parentElement || box.querySelector('.italic');
    const author = clean(authorEl?.textContent || '').slice(0, 150);
    // The facts line: "English [en] · EPUB · 1.2MB · 2019 · 📘 Book (non-fiction) · …"
    const facts = [...box.querySelectorAll('div, span')].map((x) => clean(x.textContent)).find((t) => FORMATS.test(t) && SIZE.test(t) && t.length < 400) || text;
    const format = formatIn(facts);
    if (!format) continue;
    const img = box.querySelector('img[src]');
    out.push({
      key: `${ID}:${hash}`,
      addon: NAME,
      contentType: 'ebook',
      title,
      author,
      narrator: '',
      magnet: '',
      hash: '',
      aaMd5: hash,
      size: toBytes(SIZE.exec(facts)),
      seeders: null,
      format,
      language: LANG.exec(facts)?.[2] || '',
      date: /\b(19|20)\d\d\b/.exec(facts)?.[0] || '',
      cover: img ? new URL(img.getAttribute('src'), siteBase + '/').href : '',
      cache: { any: false },
      link: `${siteBase}/md5/${hash}`,
      inApp: true, // its page opens in the in-app browser (your session there)
      score: 1,
    });
    if (out.length >= 30) break;
  }
  return out;
}

/** Search for ebooks. */
export async function search(query) {
  if (!available()) throw fail(`${NAME} works in the Android app only (it uses the in-app browser)`);
  const q = clean(query);
  if (!q) return [];
  if (Date.now() < busyUntil) throw fail(`${NAME} is busy (too many requests) — try again in a minute`);
  const { status: st, html, check, title } = await page(`/search?q=${encodeURIComponent(q)}`);
  if (st === 429) {
    busyUntil = Date.now() + 60e3;
    throw fail(`${NAME} is busy (too many requests) — try again in a minute`);
  }
  if (check || challenged(html)) {
    logError(NAME, `browser check didn't clear in 25 s — HTTP ${st} · page “${clean(title).slice(0, 60)}”`);
    throw fail(`${NAME} is checking the browser — Settings → Addons → ${NAME} → Open, wait for the site to load, then search again`, { signin: true });
  }
  if (st >= 400) {
    logError(NAME, `HTTP ${st} on the search`);
    throw fail(`${NAME} answered HTTP ${st} — check its address in Settings → Addons`);
  }
  const results = parseResults(html);
  if (results.length) {
    const n = {};
    for (const x of results) n[x.format] = (n[x.format] || 0) + 1;
    logError(NAME, `“${q}”: ${results.length} found — ${Object.entries(n).map(([f, c]) => `${f} ${c}`).join(', ')}`);
  }
  const links = (html.match(/\/md5\/[a-f0-9]{32}/gi) || []).length;
  if (!results.length) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const title = clean(doc.title).slice(0, 60);
    logError(NAME, `“${q}”: HTTP ${st} · page “${title || 'no title'}” · ${html.length} chars · ${links} book links, 0 read${links ? ' (the page layout may have changed)' : ''}`);
  }
  return results;
}

/**
 * A direct file link for a book (members: your secret key's fast downloads). Asked through
 * the hidden browser, as the site expects.
 */
export async function fastLink(md5) {
  const key = String(annas.get().key || '').trim();
  if (!key) throw new Error(`Add your ${NAME} secret key (Settings → Addons) to read in the app — or open its page`);
  const { status: st, html, text } = await page(`/dyn/api/fast_download.json?md5=${encodeURIComponent(md5)}&key=${encodeURIComponent(key)}`);
  let j = null;
  try {
    j = JSON.parse(text || html);
  } catch {}
  if (j?.download_url) return j.download_url;
  const why = j?.error || (challenged(html) ? 'the site is checking the browser — open it once in Settings' : `HTTP ${st}`);
  logError(NAME, `fast download: ${why}`);
  throw new Error(`${NAME}: ${why}`);
}

// ---- Free copies (no membership) ----------------------------------------------------------
// The website's own free routes, followed in the hidden browser: the same book's LibGen copy
// (fast — many of Anna's books are LibGen's files, under the same MD5), else a slow partner
// server, waiting out its countdown for the download link.
const FILE_EXT = /\.(epub|pdf|mobi|azw3?|fb2|djvu|cbz|cbr|txt)(\?|#|$)/i;
// The slow server's link, once the countdown is over: "Download now", or the file's address itself.
const SLOW_READY = '(?i)download now|href="https?://[^"]+\\.(epub|pdf|mobi|azw3|fb2|djvu)';
let freeNote = () => {};
/** Who shows "Getting the free copy…" while it works (the app's toast). */
export const onFreeNote = (f) => (freeNote = f || (() => {}));

const visit = (url, timeout, waitFor) => Web.pageVisit({ url, timeout, ...(waitFor ? { waitFor } : {}) });
/** The download link on a slow-server page, once it shows ('' while the countdown runs). */
export function slowLinkIn(html, at) {
  const own = (() => {
    try {
      return new URL(at).host;
    } catch {
      return '';
    }
  })();
  const links = hrefsIn(html, at).filter((l) => /^https?:/i.test(l.href));
  const now = links.find((l) => /download now/i.test(l.text) && !l.href.includes('/slow_download/'));
  if (now) return now.href;
  const file = links.find((l) => FILE_EXT.test(new URL(l.href).pathname) && new URL(l.href).host !== own);
  return file ? file.href : '';
}

/** A free download link for a book (no membership): its LibGen copy, else a slow partner server. */
export async function freeLink(md5) {
  const h = String(md5 || '').toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(h)) throw new Error(`${NAME}: not a book id`);
  freeNote('Getting the free copy…');
  // The book's own page lists its LibGen copies and the slow servers.
  let lg = [];
  let slow = [];
  try {
    const p = await page(`/md5/${h}`);
    const links = hrefsIn(p.html, base() + '/');
    lg = links.filter((l) => /ads\.php/i.test(l.href) && l.href.toLowerCase().includes(h)).map((l) => l.href);
    slow = links.filter((l) => /\/slow_download\//i.test(l.href)).map((l) => l.href);
  } catch {}
  const viaLibgen = await libgenByMd5(h, lg);
  if (viaLibgen) return viaLibgen;
  const servers = (slow.length ? slow : [0, 1, 2].map((i) => `${base()}/slow_download/${h}/0/${i}`)).slice(0, 3);
  for (const u of servers) {
    freeNote('Waiting for Anna’s free server — up to a minute…');
    const r = await visit(u, 75000, SLOW_READY).catch(() => null);
    if (!r) continue;
    const link = slowLinkIn(r.html, r.url || u);
    if (link) return link;
    logError(NAME, `slow download: no link on “${clean(r.title).slice(0, 50)}” (HTTP ${r.status || '?'})`);
  }
  throw new Error(`${NAME}: no free copy answered right now — try again later, or open its page`);
}

/** Members' fast link when your key works, else the free routes. */
export async function downloadLink(md5) {
  if (hasKey()) {
    try {
      return await fastLink(md5);
    } catch (e) {
      logError(NAME, `fast download didn't work, trying the free copy — ${e.message}`);
    }
  }
  return freeLink(md5);
}

