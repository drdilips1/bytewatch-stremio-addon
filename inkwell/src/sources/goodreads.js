// Goodreads closed its public API, so shelves come from the library export:
// goodreads.com → My Books → Import and export → Export library (CSV).
import { goodreads } from '../lib/store.js';
import { getJson, qs } from '../lib/http.js';

export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') row.push(field), (field = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field), rows.push(row), (row = []), (field = '');
    } else field += c;
  }
  if (field || row.length) row.push(field), rows.push(row);
  return rows.filter((r) => r.some((x) => x.trim()));
}

const isbn = (v) => String(v || '').replace(/[^0-9Xx]/g, '');

export function importCsv(text) {
  const [head, ...rows] = parseCsv(text);
  const col = (name) => head.findIndex((h) => h.trim().toLowerCase() === name);
  const iTitle = col('title'), iAuthor = col('author'), iShelf = col('exclusive shelf'), iId = col('book id');
  const iIsbn = col('isbn13'), iIsbn10 = col('isbn'), iYear = col('original publication year'), iRating = col('my rating');
  if (iTitle < 0 || iShelf < 0) throw new Error('This does not look like a Goodreads library export (CSV)');
  const books = rows
    .map((r) => {
      const code = isbn(r[iIsbn]) || isbn(r[iIsbn10]);
      return {
        uid: 'gr:' + (r[iId] || r[iTitle]),
        source: 'gr',
        kind: 'discover',
        title: r[iTitle].replace(/\s*\([^)]*#\d+[^)]*\)\s*$/, '').trim(),
        author: r[iAuthor] || '',
        shelf: r[iShelf] || 'read',
        rating: +r[iRating] || 0,
        isbn: code,
        year: r[iYear] || '',
        cover: code ? `https://covers.openlibrary.org/b/isbn/${code}-L.jpg?default=false` : '',
      };
    })
    .filter((b) => b.title);
  goodreads.set({ books, importedAt: Date.now() });
  return books.length;
}

export const shelf = (name) => goodreads.get().books.filter((b) => b.shelf === name);
export const shelves = () => [...new Set(goodreads.get().books.map((b) => b.shelf))];

// Enrich with Open Library's description + cover.
export async function details(book) {
  try {
    const d = await getJson('https://openlibrary.org/search.json?' + qs({ title: book.title, author: book.author, limit: 1, fields: 'key,cover_i' }));
    const doc = d.docs?.[0];
    if (!doc) return book;
    const w = await getJson(`https://openlibrary.org${doc.key}.json`);
    const desc = typeof w.description === 'string' ? w.description : w.description?.value || '';
    return {
      ...book,
      description: desc,
      cover: book.cover || (doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : ''),
      link: `https://www.goodreads.com/book/show/${book.uid.slice(3)}`,
    };
  } catch {
    return book;
  }
}
