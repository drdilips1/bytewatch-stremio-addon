// LibGen straight from the phone, in the hidden browser: for when the LibGen worker can't reach
// its mirrors (HTTP 502), and for Anna's Archive books that are LibGen's files (same MD5).
// file.php?id=… → the book's MD5 → ads.php?md5=… → its keyed get.php link (the file itself).
import { Capacitor, registerPlugin } from '@capacitor/core';

const Web = registerPlugin('InkwellWeb');
export const LIBGEN_MIRRORS = ['https://libgen.li', 'https://libgen.gl', 'https://libgen.vg', 'https://libgen.la', 'https://libgen.bz', 'https://libgen.gs'];
export const canDirect = () => Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('InkwellWeb');

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const unent = (t) => String(t || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
/** Every link on a page: { href (full address), text }. */
export const hrefsIn = (html, at) =>
  [...String(html || '').matchAll(/<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => {
    try {
      return { href: new URL(unent(m[2]), at).href, text: clean(unent(m[3].replace(/<[^>]+>/g, ' '))) };
    } catch {
      return { href: '', text: '' };
    }
  });

const visit = (url, timeout = 15000) => Web.pageVisit({ url, timeout });
/** The keyed get.php link on a LibGen download page ('' when there isn't one). */
export const getLinkIn = (html, at) => hrefsIn(html, at).find((l) => /get\.php\?/i.test(l.href) && /[?&]md5=/i.test(l.href) && /[?&]key=/i.test(l.href))?.href || '';

/** The file's link for a book's MD5, from whichever LibGen mirror answers ('' if none). */
export async function libgenByMd5(md5, firstTry = []) {
  if (!canDirect()) return '';
  const h = String(md5 || '').toLowerCase();
  const tries = [...new Set([...firstTry, ...LIBGEN_MIRRORS.map((m) => `${m}/ads.php?md5=${h}`)])].slice(0, 5);
  for (const u of tries) {
    const r = await visit(u).catch(() => null);
    if (!r || (r.status || 200) >= 400) continue;
    const get = getLinkIn(r.html, r.url || u);
    if (get) return get;
  }
  return '';
}

/** The file's link for a LibGen file id (what the LibGen worker's /download?id=… is for). */
export async function libgenById(id) {
  if (!canDirect() || !/^\d+$/.test(String(id || ''))) return '';
  for (const m of LIBGEN_MIRRORS.slice(0, 4)) {
    const r = await visit(`${m}/file.php?id=${id}`).catch(() => null);
    if (!r || (r.status || 200) >= 400) continue;
    const md5 = /(?:ads\.php|get\.php)[^"'<>]*[?&]md5=([a-f0-9]{32})/i.exec(r.html || '')?.[1] || /\bmd5\b[^a-f0-9]{0,40}([a-f0-9]{32})/i.exec(r.text || r.html || '')?.[1];
    if (md5) return libgenByMd5(md5, [`${m}/ads.php?md5=${md5.toLowerCase()}`]);
  }
  return '';
}

/** A LibGen worker download link ("…/download?id=123") → its file id, else ''. */
export const workerFileId = (url) => (/\/download\?(?:[^#]*&)?id=(\d+)/.exec(String(url || '')) || [])[1] || '';
