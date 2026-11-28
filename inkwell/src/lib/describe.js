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
