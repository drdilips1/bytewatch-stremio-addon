// Project Gutenberg's human-read audiobooks (about 660, read by volunteers; free in the US public
// domain). Found through the Gutendex catalogue (books that have audio files); a book's parts
// come from its MP3 folder on gutenberg.org. Plays straight from Gutenberg.
import { getJson, getText, qs } from '../lib/http.js';

const API = 'https://gutendex.com/books/?';

function toBook(b) {
  const authors = (b.authors || []).map((a) => a.name.split(', ').reverse().join(' '));
  return {
    uid: 'gba:' + b.id,
    source: 'gba',
    kind: 'audio',
    title: String(b.title || '').replace(/\s*[;:]\s*$/, '').replace(/\s*\(?(audio|human-read)( book)?\)?\s*$/i, ''),
    author: authors.join(', '),
    cover: b.formats?.['image/jpeg'] || '',
    language: (b.languages || [])[0] || '',
    subjects: [...(b.bookshelves || []), ...(b.subjects || [])].slice(0, 8),
    downloads: b.download_count,
  };
}

/** Audiobooks only (Gutendex: books with audio files), with the usual filters. */
export async function list(params = {}) {
  const data = await getJson(API + qs({ mime_type: 'audio', ...params }));
  return (data.results || []).filter((b) => Object.keys(b.formats || {}).some((k) => k.startsWith('audio/'))).map(toBook);
}
export const search = (term) => (term.trim() ? list({ search: term.trim() }) : Promise.resolve([]));

/** The MP3 links on a Gutenberg folder page (its file listing), in part order. */
export function mp3Links(html, base) {
  const out = [];
  for (const m of String(html || '').matchAll(/href="([^"?#]+\.mp3)"/gi)) {
    try {
      const u = new URL(m[1], base).href;
      if (!out.includes(u)) out.push(u);
    } catch {}
  }
  return out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export async function details(book) {
  const id = book.uid.slice(4);
  const b = await getJson(`https://gutendex.com/books/${id}`);
  const f = b.formats || {};
  const name = (u) => decodeURIComponent(u.split('/').pop()).replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ');
  let urls = [];
  // One whole-book file (M4B) when there is one; else every MP3 in the book's folder.
  const whole = Object.entries(f).find(([k, v]) => k.startsWith('audio/mp4') && /\.m4b$/i.test(v))?.[1];
  if (whole) urls = [whole];
  else {
    const one = Object.entries(f).find(([k]) => k.startsWith('audio/mpeg'))?.[1];
    if (one) {
      const folder = one.replace(/[^/]+$/, '');
      urls = mp3Links(await getText(folder).catch(() => ''), folder);
      if (!urls.length) urls = [one];
    }
  }
  if (!urls.length) throw new Error('No audio files listed for this Gutenberg audiobook');
  return {
    ...book,
    ...toBook(b),
    description: (b.summaries || [])[0] || '',
    tracks: urls.map((url, i) => ({ title: name(url), url, index: i })),
    link: `https://www.gutenberg.org/ebooks/${id}`,
  };
}
