// Mobilism Audiobooks (Audiohub+ only): a browser-backed source, not an HTTP JSON addon.
//
// Everything runs inside the app's own hidden WebView (InkwellWebPlugin.trackerFetch), which
// shares the in-app browser's persistent cookies. You sign in once in the in-app browser
// (InkwellWebActivity); nothing — no cookie, no password, no session — leaves the phone or
// goes through the Cloudflare Worker.
//
// Search: forum 124 (eBooks » Audiobooks), topic titles only. Each candidate topic is opened
// (two at a time at most) and kept only if its own breadcrumb says eBooks » Audiobooks and
// links forum 124. Results carry the topic page as `link` and the post's external links
// (Rapidgator, Rosefile…) as `downloads` — file hosts, never presented as audio streams.
import { registerPlugin, Capacitor } from '@capacitor/core';
import { words } from '../lib/match.js';

const Web = registerPlugin('InkwellWeb');
export const BASE = 'https://forum.mobilism.org';
export const FORUM = '124';
export const NAME = 'Mobilism Audiobooks';
export const ID = 'mobilism-audiobooks';
const MAX_TOPICS = 8; // candidates opened per search
const CONCURRENCY = 2;
const PAGE_TIMEOUT = 30000;

/** Only on the Android app: the hidden browser and its cookies live there. */
export const available = () => Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('InkwellWeb');

/** The record that makes this a source in Settings → Addons (no URL: it isn't fetched as JSON). */
export const addonRecord = () => ({
  kind: 'source',
  special: 'mobilism',
  url: '',
  manifest: { id: ID, name: NAME, version: '1.0.0', description: 'Audiobook topics from Mobilism (forum 124), searched in your signed-in in-app browser', provides: ['source'], contentType: 'audiobook', adapters: { source: {} } },
});

const fail = (message, extra = {}) => Object.assign(new Error(message), { final: true, ...extra });

/** Open the forum's sign-in page in the in-app browser (cookies are kept by the app). */
export function signIn() {
  return Web.open({ url: `${BASE}/ucp.php?mode=login`, title: 'Mobilism — sign in' });
}

// One page through the hidden browser, with your session. { status, doc }.
async function page(path) {
  const r = await Promise.race([
    Web.trackerFetch({ base: BASE, path }),
    new Promise((_, no) => setTimeout(() => no(fail('Mobilism didn’t answer in time — try again in a moment', { timeout: true })), PAGE_TIMEOUT)),
  ]).catch((e) => {
    if (/timed out/i.test(e?.message || '')) throw fail('Mobilism didn’t answer in time — try again in a moment', { timeout: true });
    throw e;
  });
  const doc = new DOMParser().parseFromString(r.text || '', 'text/html');
  return { status: r.status, doc, html: r.text || '' };
}

// Signed in: phpBB shows a log-out link (ucp.php?mode=logout) only to members.
const signedIn = (doc) => !!doc.querySelector('a[href*="mode=logout"]');
// Cloudflare's "checking your browser" page instead of the forum.
const challenged = (doc, html) => /just a moment|cf-chl|challenge-platform/i.test(html) && !doc.querySelector('a.topictitle, #page-body, .forumbg');

function needSignIn() {
  return fail('Sign in to Mobilism first: Settings → Addons → Mobilism Audiobooks → Sign in', { signin: true });
}

const abs = (href) => {
  try {
    return new URL(href, BASE + '/').href;
  } catch {
    return '';
  }
};
const topicId = (href) => /[?&]t=(\d+)/.exec(href || '')?.[1] || '';
const forumId = (href) => /[?&]f=(\d+)/.exec(href || '')?.[1] || '';
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** Search results page → [{ id, title, url }] (topic links only, forum 124 ones first). */
export function topicsOn(doc) {
  const out = [];
  const seen = new Set();
  for (const a of doc.querySelectorAll('a.topictitle')) {
    const href = a.getAttribute('href') || '';
    const id = topicId(href);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, title: clean(a.textContent), url: `${BASE}/viewtopic.php?t=${id}`, forum: forumId(href) });
  }
  return out;
}

/**
 * The topic's own breadcrumb (the trail to this topic — not the site's header menu): its
 * forum links, in order, as [{ text, f }]. Only containers that are breadcrumbs are read.
 */
function breadcrumb(doc) {
  const box =
    doc.querySelector('#nav-breadcrumbs') ||
    doc.querySelector('.breadcrumbs .crumb')?.closest('.breadcrumbs') ||
    doc.querySelector('p.breadcrumbs, li.breadcrumbs, div.breadcrumbs, .navlinks, td.navlinks') ||
    null;
  if (!box) return [];
  return [...box.querySelectorAll('a')]
    .map((a) => ({ text: clean(a.textContent), f: forumId(a.getAttribute('href') || '') }))
    .filter((c) => c.text);
}

/** True when the trail ends … eBooks » Audiobooks, and the Audiobooks link is forum 124. */
export function inAudiobooks(crumbs) {
  const i = crumbs.findIndex((c) => /^audio\s?books?$/i.test(c.text));
  return i > 0 && crumbs[i].f === FORUM && /^e-?books?$/i.test(crumbs[i - 1].text);
}

const AUDIO = /\b(mp3|m4b|m4a|aac|audiobook|unabridged|narrated|read by)\b/i;
const EBOOK_ONLY = /\b(epub|pdf|mobi|azw3?|ebook)\b/i;
const FORMAT = /\b(m4b|m4a|mp3|aac|flac|opus)\b/i;
const HOST_SIZE = /(\d+(?:[.,]\d+)?)\s*(GB|MB)\b/i;

/** A topic page → one result (or null when it isn't an audiobook in forum 124). */
export function topicResult(doc, t) {
  if (!inAudiobooks(breadcrumb(doc))) return null;
  const post = doc.querySelector('.post .postbody .content, .postbody .content, .postbody') || doc.body;
  const text = clean(post?.textContent || '');
  const title = clean(doc.querySelector('h2.topic-title a, h2.topic-title, h2 a[href*="viewtopic"], h2')?.textContent) || t.title;
  // Audiobook releases only: say MP3 / M4B / audiobook somewhere, and not an ebook-only post.
  const fmt = (FORMAT.exec(`${title} ${text}`)?.[1] || '').toUpperCase();
  if (!AUDIO.test(`${title} ${text}`) && EBOOK_ONLY.test(title)) return null;
  const downloads = [...post.querySelectorAll('a.postlink')]
    .map((a) => ({ url: abs(a.getAttribute('href') || ''), host: (() => { try { return new URL(abs(a.getAttribute('href') || '')).hostname.replace(/^www\./, ''); } catch { return ''; } })() }))
    .filter((d) => /^https?:/i.test(d.url) && !d.url.startsWith(BASE));
  const author = clean(/(?:author|written by|by)\s*[:\-–]\s*([^\n|]{2,60}?)(?:\s{2,}|narrat|read by|format|publisher|genre|\||$)/i.exec(text)?.[1]) || clean(/ by ([^\[(|]{2,40})/i.exec(title)?.[1]);
  const narrator = clean(/(?:narrated by|narrator|read by)\s*[:\-–]?\s*([^\n|]{2,60}?)(?:\s{2,}|format|publisher|genre|length|\||$)/i.exec(text)?.[1]);
  const size = HOST_SIZE.exec(text);
  return {
    key: `${ID}:${t.id}`,
    addon: NAME,
    contentType: 'audiobook',
    title,
    author,
    narrator,
    magnet: '',
    hash: '',
    size: size ? Math.round(parseFloat(size[1].replace(',', '.')) * (size[2].toUpperCase() === 'GB' ? 1073741824 : 1048576)) : 0,
    seeders: null,
    format: fmt,
    language: '',
    date: '',
    cache: { any: false },
    link: t.url, // the topic page; its file-host links are in `downloads`
    description: text.slice(0, 600),
    downloads,
    inApp: true, // open in the in-app browser (your Mobilism session), not the system one
    score: 1,
  };
}

// Run `fn` over items, `n` at a time.
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]).catch(() => null);
      }
    })
  );
  return out;
}

/** Search forum 124 for `query`; resolves results in Audiohub's source-result format. */
export async function search(query, wanted = '') {
  if (!available()) throw fail('Mobilism works in the Android app only (it uses the in-app browser)');
  const q = clean(query);
  if (!q) return [];
  const path = `/search.php?keywords=${encodeURIComponent(q)}&fid%5B%5D=${FORUM}&sc=1&sr=topics&sf=titleonly`;
  const { status, doc, html } = await page(path);
  if (status === 302 || status === 401 || status === 403) throw needSignIn();
  if (challenged(doc, html)) throw fail('Mobilism is checking the browser — open it once (Settings → Addons → Mobilism Audiobooks → Sign in), then search again', { signin: true });
  if (!signedIn(doc)) throw needSignIn();
  const topics = topicsOn(doc);
  if (!topics.length) return [];
  // Closest titles first, then open them two at a time.
  const w = new Set(words(wanted || q));
  const hits = (t) => words(t.title).filter((x) => w.has(x)).length;
  const picked = topics.sort((a, b) => hits(b) - hits(a)).slice(0, MAX_TOPICS);
  const results = await pool(picked, CONCURRENCY, async (t) => {
    const p = await page(`/viewtopic.php?t=${t.id}`);
    return p.status === 200 ? topicResult(p.doc, t) : null;
  });
  return results.filter(Boolean);
}
