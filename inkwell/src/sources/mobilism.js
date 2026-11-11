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
import { logError } from '../lib/report.js';

const Web = registerPlugin('InkwellWeb');
export const BASE = 'https://forum.mobilism.org';
export const FORUM = '124';
export const NAME = 'Mobilism Audiobooks';
export const ID = 'mobilism-audiobooks';
const MAX_TOPICS = 6; // candidates opened per search
const CONCURRENCY = 1; // one at a time, a moment apart: Mobilism answers 429 to bursts
const GAP = 700; // ms between topic pages
// Topics already opened (12 hours): the same search again — or the book page's second search
// (title, then title + author) — doesn't open them again.
const TOPIC_TTL = 12 * 3600e3;
const topicCache = new Map(); // id -> { at, r }
// "Too many requests": Mobilism is left alone for a minute.
let busyUntil = 0;
// The same search running twice at once (two screens asking): one request.
const inFlight = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
  // Cloudflare stops background requests with its browser check even when you're signed in
  // (the in-app browser opens the forum fine). Open the page the way a person would instead:
  // the check clears itself there, and its fresh pass serves the requests after it too.
  if (challenged(doc, r.text || '') || r.status === 403) {
    const v = await Web.pageVisit({ url: BASE + path, timeout: 25000 }).catch(() => null);
    if (v?.html && !v.check) return { status: v.status === 403 ? 200 : v.status || 200, doc: new DOMParser().parseFromString(v.html, 'text/html'), html: v.html, visited: true };
  }
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
  // phpBB marks topic links with .topictitle; some themes don't — then any topic link in
  // the page body (not the header / footer menus).
  let links = [...doc.querySelectorAll('a.topictitle')];
  if (!links.length) {
    const body = doc.querySelector('#page-body, #content, .forumbg, main') || doc.body;
    links = [...body.querySelectorAll('a[href*="viewtopic.php"]')].filter((a) => /[?&]t=\d+/.test(a.getAttribute('href') || '') && !/[?&]p=\d+/.test(a.getAttribute('href') || '') && clean(a.textContent).length > 4);
  }
  for (const a of links) {
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
  // Breadcrumb-like containers only, and only one shaped like a trail: it starts at the
  // board index and goes through forum links (a header menu listing forums isn't that).
  const boxes = [...doc.querySelectorAll('#nav-breadcrumbs, [class*="breadcrumb"], [id*="breadcrumb"], .navlinks, td.navlinks, p.breadcrumbs')];
  const trail = (b) => b.querySelector('a[href*="index.php"]') && b.querySelector('a[href*="viewforum.php"]');
  const box = boxes.find(trail) || null;
  if (!box) return [];
  return [...box.querySelectorAll('a')]
    .map((a) => ({ text: clean(a.textContent), f: forumId(a.getAttribute('href') || '') }))
    .filter((c) => c.text);
}

/**
 * True when the topic's trail reaches Audiobooks (forum 124) under eBooks — on Mobilism:
 * Home › Device-independent › eBooks › eBook Releases by Category › Audiobooks.
 */
export function inAudiobooks(crumbs) {
  const i = crumbs.findIndex((c) => /^audio\s?books?$/i.test(c.text) && c.f === FORUM);
  return i > 0 && crumbs.slice(0, i).some((c) => /^e-?books?$/i.test(c.text));
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

/**
 * Are you signed in? Resolves { signedIn, name, why } — read from the forum's own page in the
 * hidden browser (the one searches use), so it says what the search will see.
 */
export async function status() {
  if (!available()) return { signedIn: false, why: 'Android app only' };
  const { status: st, doc, html } = await page('/index.php');
  if (challenged(doc, html) || st === 403) return { signedIn: false, why: 'Mobilism is checking the browser — open Sign in once more' };
  const out = doc.querySelector('a[href*="mode=logout"]');
  if (!out) return { signedIn: false, why: 'Not signed in' };
  const name = clean(/\[\s*([^\]]+)\]/.exec(out.textContent || '')?.[1] || out.getAttribute('title') || '');
  return { signedIn: true, name };
}

/** Search forum 124 for `query`; resolves results in Audiohub's source-result format. */
export function search(query, wanted = '') {
  const key = `${clean(query)}|${clean(wanted)}`;
  if (inFlight.has(key)) return inFlight.get(key);
  const p = searchNow(query, wanted).finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

const busyError = () => fail('Mobilism is busy (too many requests) — try again in a minute');

async function searchNow(query, wanted = '') {
  if (!available()) throw fail('Mobilism works in the Android app only (it uses the in-app browser)');
  const q = clean(query);
  if (!q) return [];
  if (Date.now() < busyUntil) throw busyError();
  const path = `/search.php?keywords=${encodeURIComponent(q)}&fid%5B%5D=${FORUM}&sc=1&sr=topics&sf=titleonly`;
  let { status, doc, html } = await page(path);
  // The forum's search is heavy: Cloudflare gives up waiting (52x) while the rest of the site
  // opens fine. Ask once more after a moment before saying anything.
  if (status >= 520 && status <= 530) {
    await sleep(3000);
    ({ status, doc, html } = await page(path));
  }
  if (status === 429) {
    await sleep(4000);
    ({ status, doc, html } = await page(path));
    if (status === 429) {
      busyUntil = Date.now() + 60e3;
      logError('Mobilism', 'too many requests (429) on the search — paused for a minute');
      throw busyError();
    }
  }
  // What the forum answered, for Report a problem (no cookies, no page text).
  const seen = `HTTP ${status} · ${clean(doc.title).slice(0, 60)} · logout link: ${signedIn(doc) ? 'yes' : 'no'} · topics: ${doc.querySelectorAll('a.topictitle').length}`;
  if (challenged(doc, html) || status === 403) {
    logError('Mobilism', `browser check — ${seen}`);
    throw fail('Mobilism is checking the browser — Settings → Addons → Mobilism Audiobooks → Sign in, wait for the forum to open, then search again', { signin: true });
  }
  // The forum's search didn't answer in time (Cloudflare 52x), or the site is down (503…): not a sign-in problem.
  if (status >= 500) {
    const searchSlow = status >= 520 && status <= 530;
    logError('Mobilism', `${searchSlow ? 'search timed out' : 'site down'} — ${seen}`);
    throw fail(
      searchSlow
        ? `Mobilism's search didn't answer in time (HTTP ${status}) — the forum itself may open fine; try the search again in a minute`
        : `Mobilism is down right now (HTTP ${status}) — try again later`
    );
  }
  if (status === 302 || status === 401 || !signedIn(doc)) {
    logError('Mobilism', `not signed in — ${seen}`);
    throw needSignIn();
  }
  const topics = topicsOn(doc);
  if (!topics.length) {
    logError('Mobilism', `no topics on the results page — ${seen}`);
    return [];
  }
  // Closest titles first (ones sharing no word with the book are skipped), then opened one at a
  // time, a moment apart — or taken from the ones opened in the last hours.
  const w = new Set(words(wanted || q));
  const hits = (t) => words(t.title).filter((x) => w.has(x)).length;
  const picked = topics
    .filter((t) => hits(t) > 0)
    .sort((a, b) => hits(b) - hits(a))
    .slice(0, MAX_TOPICS);
  const notes = [];
  let opened = 0;
  let limited = false;
  const results = await pool(picked, CONCURRENCY, async (t) => {
    const c = topicCache.get(t.id);
    if (c && Date.now() - c.at < TOPIC_TTL) return c.r;
    if (limited || Date.now() < busyUntil) return null;
    if (opened++) await sleep(GAP);
    let p = await page(`/viewtopic.php?t=${t.id}`);
    if (p.status === 429) {
      await sleep(4000);
      p = await page(`/viewtopic.php?t=${t.id}`);
      if (p.status === 429) {
        limited = true;
        busyUntil = Date.now() + 60e3;
        if (notes.length < 3) notes.push(`t=${t.id} HTTP 429 — Mobilism asked to slow down, paused for a minute`);
        return null;
      }
    }
    const r = p.status === 200 ? topicResult(p.doc, t) : null;
    if (p.status === 200) topicCache.set(t.id, { at: Date.now(), r });
    // Why a topic was left out (for Report a problem): its status and the trail it showed.
    if (!r && notes.length < 3) notes.push(`t=${t.id} HTTP ${p.status} trail: ${breadcrumb(p.doc).map((c) => `${c.text}${c.f ? `(f=${c.f})` : ''}`).join(' › ') || 'none found'}`);
    return r;
  });
  const kept = results.filter(Boolean);
  if (kept.length < picked.length) logError('Mobilism', `${topics.length} topics, ${picked.length} opened, ${kept.length} kept — ${notes.join(' | ')}`);
  return kept;
}
