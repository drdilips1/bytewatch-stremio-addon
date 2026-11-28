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
