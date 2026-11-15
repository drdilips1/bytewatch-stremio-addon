// Blinkist, with your own account: its own website and player, opened inside the app (the same
// in-app browser as the tracker — your sign-in is kept), never its paid text or audio pulled out.
// A "B" shows on books Blinkist has (looked up on the book's page, then remembered), the book
// page opens that summary in Blinkist, and Home has Blinkist's free book of the day.
import { useEffect, useState } from 'preact/hooks';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { getText } from '../lib/http.js';
import { persisted, useStore } from '../lib/store.js';
import { mainTitle, matches } from '../lib/match.js';

export const blinkist = persisted('blinkist', { on: false, signedIn: false });
const found = persisted('blinkistFound', {}, { delay: 2000 }); // book key -> { url, t } ('' = not on Blinkist)
const Web = registerPlugin('InkwellWeb');
const inApp = Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('InkwellWeb');

const BASE = 'https://www.blinkist.com';
export const DAILY = `${BASE}/en/nc/daily`;
const LOGIN = `${BASE}/en/nc/login`;
const DAY = 864e5;

/** Blinkist's own page, inside the app (signed in as you), else the browser. */
export async function openBlinkist(url = BASE + '/en/app') {
  if (inApp) return Web.open({ url, title: 'Blinkist' });
  const { openExternal } = await import('./summaries.js');
  return openExternal(url);
}
export function signInBlinkist() {
  blinkist.set((b) => ({ ...b, on: true, signedIn: true }));
  return openBlinkist(LOGIN);
}

const slug = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
const keyOf = (b) => `${slug(mainTitle(b?.title || ''))}|${slug(String(b?.author || '').split(/,|&/)[0])}`;
/** Blinkist's search for this book (always works, signed in or not). */
export const searchUrl = (b) => `${BASE}/en/search?query=${encodeURIComponent(`${mainTitle(b?.title || '')} ${String(b?.author || '').split(/,|&/)[0]}`.trim())}`;

/** Blinkist's page for this book, as far as is known now: url, '' (not there) or undefined (not looked up). */
export function knownBlinkist(book) {
  const hit = found.get()[keyOf(book)];
  if (!hit) return undefined;
  return Date.now() - hit.t < (hit.url ? 30 : 7) * DAY ? hit.url : undefined;
}

const looking = new Map();
/** Look Blinkist's page for the book up (its usual addresses), and remember the answer. */
export function lookUpBlinkist(book) {
  const k = keyOf(book);
  if (!book?.title || !k.split('|')[0]) return Promise.resolve('');
  const have = knownBlinkist(book);
  if (have !== undefined) return Promise.resolve(have);
  if (looking.has(k)) return looking.get(k);
  const t = mainTitle(book.title);
  const au = slug(String(book.author || '').split(/,|&/)[0]);
  const tries = [...new Set([`${slug(t)}-en`, au && `${slug(t)}-${au}-en`, `${slug(book.title)}-en`].filter(Boolean))];
  const job = (async () => {
    for (const s of tries) {
      try {
        const html = await getText(`${BASE}/en/books/${s}`, { timeout: 10000 });
        const title = (/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i.exec(html) || /<title>([^<]+)/i.exec(html) || [])[1] || '';
        if (title && matches(t, title)) return `${BASE}/en/books/${s}`;
      } catch {}
    }
    return '';
  })()
    .then((url) => {
      found.set((all) => ({ ...Object.fromEntries(Object.entries(all).slice(-800)), [k]: { url, t: Date.now() } }));
      return url;
    })
    .finally(() => looking.delete(k));
  looking.set(k, job);
  return job;
}

/** For a book page: { url, exact } once looked up (exact = Blinkist's own page; else its search). */
export function useBlinkist(book) {
  const cfg = useStore(blinkist);
  const [url, setUrl] = useState(() => knownBlinkist(book));
  useEffect(() => {
    if (!cfg.on || !book?.title) return;
    let alive = true;
    setUrl(knownBlinkist(book));
    lookUpBlinkist(book).then((u) => alive && setUrl(u));
    return () => (alive = false);
  }, [cfg.on, book?.uid, book?.title]);
  if (!cfg.on || !book?.title || book.source === 'pod') return null;
  return url ? { url, exact: true } : { url: searchUrl(book), exact: false, checking: url === undefined };
}

/** For a cover: has Blinkist got it (only what's already known — covers don't look anything up). */
export function useBlinkistBadge(book) {
  const cfg = useStore(blinkist);
  useStore(found);
  return cfg.on && !!knownBlinkist(book);
}

/** Blinkist's free book of the day: { title, url } (its name when the page can be read). */
const daily = persisted('blinkistDaily', { day: '', title: '' });
export async function freeDaily() {
  const today = new Date().toISOString().slice(0, 10);
  const d = daily.get();
  if (d.day === today) return { title: d.title, url: DAILY };
  let title = '';
  try {
    const html = await getText(DAILY, { timeout: 10000 });
    title = ((/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i.exec(html) || [])[1] || '').replace(/\s*[|–-]\s*Blinkist.*$/i, '').trim();
  } catch {}
  daily.set({ day: today, title });
  return { title, url: DAILY };
}
