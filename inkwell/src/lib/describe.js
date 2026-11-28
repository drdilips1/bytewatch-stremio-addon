// A cloud copy's stand-in ("1 audio file in your TorBox torrents.") isn't a description of the
// book: the book page uses the found details (Audible…) instead, else Goodreads, else nothing.
const STANDIN = /^\s*\d+\s+(audio|ebook)\s+files?\s+in\s+your\s/i;

export const isStandIn = (text) => STANDIN.test(String(text || ''));

/** The book's own description, or the found details' when its own is only a stand-in. */
export function ownDescription(book, found) {
  const d = String(book?.description || '');
  if (d && !isStandIn(d)) return d;
  const f = String(found?.description || '');
  return f && !isStandIn(f) ? f : '';
}

/**
 * A description without the publisher's shouting at the top ("OVER TEN MILLION COPIES SOLD",
 * "#1 INTERNATIONAL BESTSELLER", "NEW YORK TIMES BESTSELLER") and without empty lines between
 * paragraphs — it starts with what the book is about.
 */
export function tidyDescription(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').map((l) => l.trim());
  const shouting = (l) => l.length < 90 && /[A-Z]{3}/.test(l) && l === l.toUpperCase() && !/[a-z]/.test(l);
  while (lines.length && (!lines[0] || shouting(lines[0]))) lines.shift();
  return lines.filter(Boolean).join('\n').trim() || String(text || '').trim();
}

/**
 * Where "Source: Audible" (the book's details) links to: the book's own Audible page when its id is
 * known, else a search for it on that site.
 */
export function sourceLink(source, { asin = '', title = '', author = '', market = '' } = {}) {
  const q = encodeURIComponent([title, String(author || '').split(',')[0]].filter(Boolean).join(' '));
  const s = String(source || '').toLowerCase();
  const audible = `https://www.audible.${market === 'in' ? 'in' : 'com'}`;
  if (s.includes('audible')) return asin ? `${audible}/pd/${asin}` : `${audible}/search?keywords=${q}`;
  if (s.includes('apple')) return `https://books.apple.com/search?term=${q}`;
  if (s.includes('google')) return `https://www.google.com/search?tbm=bks&q=${q}`;
  if (s.includes('goodreads')) return `https://www.goodreads.com/search?q=${q}`;
  if (s.includes('open library')) return `https://openlibrary.org/search?q=${q}`;
  return '';
}
