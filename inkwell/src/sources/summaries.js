// Book summaries. StoryShots publishes its written summaries on its website
// (WordPress), so they can be read — and read aloud — inside the app. Blinkist
// has no public API, so we open the book in the Blinkist app/site where the
// user is signed in.
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { getJson, getText } from '../lib/http.js';
import { words, mainTitle } from '../lib/match.js';
import { stripHtml } from '../lib/format.js';

const SS = 'https://www.getstoryshots.com';

export async function openUrl(url) {
  if (Capacitor.isNativePlatform()) await Browser.open({ url });
  else window.open(url, '_blank');
}

// Blinkist has no public search page we can link to reliably, so find the book's
// Blinkist page through a site search (it opens in the Blinkist app if installed).
const siteSearch = (site, q) => `https://www.google.com/search?q=${encodeURIComponent(`site:${site} ${q}`)}`;
const query = (book) => `${mainTitle(book.title)} ${(book.author || '').split(',')[0]}`.trim();
export const blinkistUrl = (book) => siteSearch('blinkist.com', query(book));
export const storyshotsSearchUrl = (book) => siteSearch('getstoryshots.com', `${query(book)} summary`);
export const BLINKIST_LOGIN = 'https://www.blinkist.com/en/nc/login';
export const STORYSHOTS_HOME = 'https://www.getstoryshots.com/';

// Their site may turn away requests that don't look like a browser.
const BROWSER = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36',
  Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
};

// A summary post matches when most words of the book's title appear in the post title.
function sameBook(book, postTitle) {
  const t = words(mainTitle(book.title));
  const p = new Set(words(postTitle));
  return t.length > 0 && t.filter((w) => p.has(w)).length / t.length >= 0.75;
}

const cache = new Map();

/** The StoryShots summary for a book, or null. */
export function storyshots(book) {
  const key = mainTitle(book.title).toLowerCase();
  if (!cache.has(key)) {
    const p = findStoryShots(book).catch(() => {
      cache.delete(key);
      return null;
    });
    cache.set(key, p);
  }
  return cache.get(key);
}

const stub = (book, title, url, excerpt, api) => ({
  uid: 'ss:' + url,
  source: 'ss',
  kind: 'text',
  title,
  author: book.author || '',
  cover: book.cover || '',
  excerpt,
  link: url,
  api, // REST URL for the full text, when the site's API answered
});

const absolute = (href) => {
  try {
    return new URL(href, SS).href.replace(/^http:/, 'https:');
  } catch {
    return '';
  }
};

async function findStoryShots(book) {
  const q = mainTitle(book.title);
  // 1. WordPress search API: covers every post type (their summaries live under /books/).
  try {
    const hits = await getJson(`${SS}/wp-json/wp/v2/search?` + new URLSearchParams({ search: q, per_page: '10' }), { timeout: 15000, headers: BROWSER });
    const hit = (Array.isArray(hits) ? hits : []).find((x) => sameBook(book, stripHtml(x.title || '')));
    if (hit) return stub(book, stripHtml(hit.title), hit.url, '', hit._links?.self?.[0]?.href || '');
  } catch {}
  // 2. The site's own search page.
  const html = await getText(`${SS}/?s=${encodeURIComponent(q)}`, { timeout: 20000, headers: BROWSER });
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const links = [...doc.querySelectorAll('a[href]')]
    .map((a) => ({ url: absolute(a.getAttribute('href')), title: (a.textContent || a.getAttribute('title') || '').replace(/\s+/g, ' ').trim() }))
    .filter((l) => l.url.startsWith(SS) && !/[?#]|\/(category|tag|author|page)\//.test(l.url.slice(SS.length)) && l.url.length > SS.length + 3);
  const best = links.find((l) => sameBook(book, l.title)) || links.find((l) => sameBook(book, l.url.slice(SS.length).replace(/[-/]/g, ' ')));
  return best ? stub(book, best.title || q + ' summary', best.url, '', '') : null;
}

/** Summary text for the in-app reader: { html, headings }. */
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
  const post = { title: { rendered: title } };
  doc.querySelectorAll('script,style,link,meta,iframe,object,embed,form,button,input,noscript,svg,figure,.wp-block-buttons,.sharedaddy').forEach((n) => n.remove());
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
  h1.textContent = stripHtml(post?.title?.rendered || book.title);
  doc.body.prepend(h1);
  const headings = [...doc.body.querySelectorAll('h1,h2,h3')]
    .map((h, i) => {
      h.id ||= 'ss-h-' + i;
      return { id: h.id, text: h.textContent.replace(/\s+/g, ' ').trim(), level: +h.tagName[1] };
    })
    .filter((h) => h.text && h.text.length < 120);
  if (!doc.body.textContent.trim()) throw new Error('StoryShots returned an empty summary — open it on their site instead');
  return { html: doc.body.innerHTML, headings };
}
