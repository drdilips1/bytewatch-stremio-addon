// StoryShots: does it have a summary of this book? Their public website lists every
// summary, so the app looks the book up there and shows a small "S" on the cover;
// tapping it opens the summary in the StoryShots app (or their site), where you're
// signed in with your own account.
import { useEffect, useState } from 'preact/hooks';
import { getJson, getText } from '../lib/http.js';
import { words, mainTitle } from '../lib/match.js';
import { stripHtml } from '../lib/format.js';
import { persisted } from '../lib/store.js';
import { openExternal } from './summaries.js';

const SS = 'https://www.getstoryshots.com';
const BROWSER = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36',
  Accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
};

/** Settings → Appearance: show the badge on covers. */
export const ssBadges = persisted('storyshotsBadges', true);

// title|author -> { u: summary page ('' = none), t: when checked }
const found = persisted('storyshotsFound', {});
const FOUND_FOR = 30 * 86400e3;
const MISSING_FOR = 7 * 86400e3;

const lastName = (a) => words(String(a || '').split(/,|&|\band\b/)[0]).slice(-1)[0] || '';
const keyFor = (b) => `${words(mainTitle(b?.title)).join(' ')}|${lastName(b?.author)}`;

// The post is this book's summary: every word of the title is in it, and it either
// starts with the title or names the author ("Educated" alone is too common a word).
function sameBook(book, postTitle) {
  const t = words(mainTitle(book.title));
  const p = words(postTitle);
  if (!t.length || !t.every((w) => p.includes(w))) return false;
  const starts = t.every((w, i) => p[i] === w);
  const au = lastName(book.author);
  return starts || (au && p.includes(au));
}

/** The summary page already known for a book: url, '' (none), or undefined (not checked yet). */
export function knownStoryShots(book) {
  const hit = found.get()[keyFor(book)];
  if (!hit || Date.now() - hit.t > (hit.u ? FOUND_FOR : MISSING_FOR)) return undefined;
  return hit.u;
}

// A few lookups at a time, so a Home screen full of covers doesn't flood their site.
const inflight = new Map();
const queue = [];
let running = 0;
function pump() {
  while (running < 2 && queue.length) {
    const job = queue.shift();
    running++;
    job().finally(() => {
      running--;
      pump();
    });
  }
}

/** Look the book up on StoryShots: resolves to the summary page, '' when there's none, or null when unreachable. */
export function checkStoryShots(book) {
  const k = keyFor(book);
  if (!k.split('|')[0]) return Promise.resolve('');
  const known = knownStoryShots(book);
  if (known !== undefined) return Promise.resolve(known);
  if (!inflight.has(k)) {
    const p = new Promise((resolve) => {
      queue.push(async () => {
        try {
          const hits = await getJson(`${SS}/wp-json/wp/v2/search?` + new URLSearchParams({ search: mainTitle(book.title), per_page: '10' }), { timeout: 15000, headers: BROWSER });
          const hit = (Array.isArray(hits) ? hits : []).find((x) => String(x.url || '').startsWith(SS) && sameBook(book, stripHtml(x.title || '')));
          const u = hit ? hit.url : '';
          const a = hit?._links?.self?.[0]?.href || '';
          found.set((all) => {
            const next = { ...all, [k]: { u, a, t: Date.now() } };
            const keys = Object.keys(next);
            // Keep the newest 1500 lookups.
            if (keys.length > 1500) keys.sort((a, b) => next[a].t - next[b].t).slice(0, keys.length - 1500).forEach((x) => delete next[x]);
            return next;
          });
          resolve(u);
        } catch {
          resolve(null);
        } finally {
          inflight.delete(k);
        }
      });
      pump();
    });
    inflight.set(k, p);
  }
  return inflight.get(k);
}

/** Hook: the StoryShots summary page for a book, or '' while unknown / when there's none. */
export function useStoryShots(book, { always = false } = {}) {
  const on = always || ssBadges.get();
  const [u, setU] = useState(() => (on && book?.title ? knownStoryShots(book) || '' : ''));
  useEffect(() => {
    if (!on || !book?.title || ['pod', 'sum'].includes(book.source)) return setU('');
    const known = knownStoryShots(book);
    if (known !== undefined) return setU(known);
    let alive = true;
    checkStoryShots(book).then((v) => alive && setU(v || ''));
    return () => {
      alive = false;
    };
  }, [book?.uid, book?.title, on]);
  return u;
}

export const openStoryShots = (url) => openExternal(url || SS);

// ---- "Listen here": their written summary in the reader, read by our voices -----
let chooserSet = null;
/** Tap on an S: ask whether to listen here or open StoryShots. */
export const chooseStoryShots = (book, url) => (chooserSet ? chooserSet({ book, url }) : openStoryShots(url));
export const registerChooser = (fn) => (chooserSet = fn);

/** A reader "book" for a book's StoryShots summary. */
export function storyShotsBook(book, url) {
  const hit = found.get()[keyFor(book)] || {};
  return {
    uid: 'ss:' + url,
    source: 'ss',
    kind: 'text',
    title: `${mainTitle(book.title)} · StoryShots summary`,
    author: book.author || '',
    cover: book.cover || '',
    link: url,
    api: hit.u === url ? hit.a || '' : '',
  };
}

/** Summary text for the in-app reader: { html, headings, title }. */
export async function loadStoryShots(book) {
  let title = book.title;
  let body = '';
  if (book.api) {
    try {
      const post = await getJson(book.api + (book.api.includes('?') ? '&' : '?') + '_fields=title,content', { timeout: 20000, headers: BROWSER });
      title = stripHtml(post?.title?.rendered || title);
      body = post?.content?.rendered || '';
    } catch {}
  }
  if (!body) {
    const page = new DOMParser().parseFromString(await getText(book.link, { timeout: 25000, headers: BROWSER }), 'text/html');
    const main = page.querySelector('.entry-content, article .content, article, main') || page.body;
    body = main.innerHTML;
    title = page.querySelector('h1')?.textContent?.trim() || title;
  }
  const doc = new DOMParser().parseFromString(body, 'text/html');
  doc.querySelectorAll('script,style,link,meta,iframe,object,embed,form,button,input,noscript,svg,figure,audio,video,.wp-block-buttons,.sharedaddy').forEach((n) => n.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase();
      if (n.startsWith('on') || n === 'style' || n === 'class' || n === 'id' || n.startsWith('data-')) el.removeAttribute(a.name);
      if ((n === 'href' || n === 'src') && /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
    }
    if (el.tagName === 'A') el.setAttribute('target', '_blank');
    if (el.tagName === 'IMG') el.remove();
  });
  const h1 = doc.createElement('h1');
  h1.textContent = stripHtml(title || book.title);
  doc.body.prepend(h1);
  const headings = [...doc.body.querySelectorAll('h1,h2,h3')]
    .map((h, i) => {
      h.id ||= 'ss-h-' + i;
      return { id: h.id, text: h.textContent.replace(/\s+/g, ' ').trim(), level: +h.tagName[1] };
    })
    .filter((h) => h.text && h.text.length < 120);
  if (!doc.body.textContent.trim()) throw new Error('StoryShots returned an empty summary — open it in StoryShots instead');
  return { html: doc.body.innerHTML, headings, title: h1.textContent };
}
