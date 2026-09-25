// Book summaries. StoryShots publishes its written summaries on its website
// (WordPress), so they can be read — and read aloud — inside the app. Blinkist
// has no public API, so we open the book in the Blinkist app/site where the
// user is signed in.
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { getJson } from '../lib/http.js';
import { words, mainTitle } from '../lib/match.js';
import { stripHtml } from '../lib/format.js';

const SS = 'https://www.getstoryshots.com';

export async function openUrl(url) {
  if (Capacitor.isNativePlatform()) await Browser.open({ url });
  else window.open(url, '_blank');
}

export const blinkistUrl = (book) => `https://www.blinkist.com/en/search?query=${encodeURIComponent(`${mainTitle(book.title)} ${(book.author || '').split(',')[0]}`.trim())}`;
export const storyshotsSearchUrl = (book) => `${SS}/?s=${encodeURIComponent(mainTitle(book.title))}`;

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
    const p = getJson(`${SS}/wp-json/wp/v2/posts?` + new URLSearchParams({ search: mainTitle(book.title), per_page: '6', _fields: 'id,title,link,excerpt' }), { timeout: 15000 })
      .then((posts) => {
        const post = (Array.isArray(posts) ? posts : []).find((x) => sameBook(book, stripHtml(x.title?.rendered || '')));
        if (!post) return null;
        return {
          uid: 'ss:' + post.id,
          source: 'ss',
          kind: 'text',
          title: stripHtml(post.title.rendered),
          author: book.author || '',
          cover: book.cover || '',
          excerpt: stripHtml(post.excerpt?.rendered || '').replace(/\s*\[…\]\s*$/, '…'),
          link: post.link,
        };
      })
      .catch(() => {
        cache.delete(key);
        return null;
      });
    cache.set(key, p);
  }
  return cache.get(key);
}

/** Summary text for the in-app reader: { html, headings }. */
export async function loadStoryShots(book) {
  const post = await getJson(`${SS}/wp-json/wp/v2/posts/${book.uid.slice(3)}?_fields=title,content,link`, { timeout: 20000 });
  const doc = new DOMParser().parseFromString(post?.content?.rendered || '', 'text/html');
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
