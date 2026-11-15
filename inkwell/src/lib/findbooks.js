// "Find books in…": a photo of a cover, a barcode, a bookshelf, a screenshot, a shared web page
// or a pasted list → the books in it, each matched to a catalogue entry and marked where you
// have it. Pictures are read by your own AI service (Gemini / Claude); barcodes on the phone.
import { askAi, askAiImage, aiReady, canSeeImages, parseJson } from './ai.js';
import { getJson, getText, qs } from './http.js';
import { mainTitle, matches } from './match.js';
import { persisted, library, progress } from './store.js';
import { downloads } from './downloads.js';
import { localCfg } from '../sources/local.js';

/** Lists found and saved as shelves: [{ id, name, at, books: [book] }]. */
export const foundShelves = persisted('foundShelves', []);

/** A picture file → a JPEG data URL no bigger than `max` pixels a side (smaller to send). */
export function shrink(fileOrUrl, max = 1100) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => reject(new Error("Couldn't open that picture"));
    img.src = typeof fileOrUrl === 'string' ? fileOrUrl : URL.createObjectURL(fileOrUrl);
  });
}

/** The ISBN in a barcode photo (the phone's own reader), or ''. */
export async function barcodeIn(dataUrl) {
  if (typeof BarcodeDetector === 'undefined') return '';
  try {
    const det = new BarcodeDetector({ formats: ['ean_13', 'upc_a'] });
    const img = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const codes = await det.detect(img);
    const isbn = codes.map((c) => c.rawValue).find((v) => /^97[89]\d{10}$/.test(v) || /^\d{9}[\dX]$/.test(v));
    return isbn || '';
  } catch {
    return '';
  }
}

/** An ISBN → { title, author } (Google Books, else Open Library), or null. */
export async function bookForIsbn(isbn) {
  try {
    const g = await getJson('https://www.googleapis.com/books/v1/volumes?' + qs({ q: `isbn:${isbn}` }), { timeout: 10000 });
    const v = g?.items?.[0]?.volumeInfo;
    if (v?.title) return { title: v.title, author: (v.authors || []).join(', ') };
  } catch {}
  try {
    const o = await getJson(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`, { timeout: 10000 });
    const b = o?.[`ISBN:${isbn}`];
    if (b?.title) return { title: b.title, author: (b.authors || []).map((a) => a.name).join(', ') };
  } catch {}
  return null;
}

const tidy = (list) =>
  (Array.isArray(list) ? list : [])
    .map((b) => ({ title: String(b?.title || '').trim(), author: String(b?.author || '').trim() }))
    .filter((b) => b.title.length > 1)
    .filter((b, i, all) => all.findIndex((x) => mainTitle(x.title).toLowerCase() === mainTitle(b.title).toLowerCase()) === i)
    .slice(0, 40);

/** Books in a picture: one cover, a shelf of spines, or a screenshot of covers / a list. */
export async function booksInImage(dataUrl, mode = 'cover') {
  if (mode === 'barcode') {
    const isbn = await barcodeIn(dataUrl);
    if (isbn) {
      const b = await bookForIsbn(isbn);
      if (b) return { books: [b], how: `barcode ${isbn}` };
    }
    if (!canSeeImages()) throw new Error("Couldn't read the barcode — try again closer, or take the cover");
  }
  if (!canSeeImages()) throw new Error('Reading covers needs a Gemini or Claude key (Settings → AI) — or scan the barcode');
  const ask =
    mode === 'cover' || mode === 'barcode'
      ? 'This is a photo of a book (its cover, or its back with a barcode). Which book is it?'
      : mode === 'shelf'
        ? 'This is a photo of a bookshelf or a pile of books. List every book whose title you can read on the spines or covers.'
        : 'This is a screenshot or picture that shows books (covers, a list, a post). List every book shown or named in it.';
  const raw = await askAiImage(`${ask} Reply with JSON only: {"books":[{"title":"the book's title as published","author":"the author, if shown or known"}]}. Leave out anything you can't read with confidence.`, dataUrl, { json: true });
  return { books: tidy(parseJson(raw)?.books), how: mode };
}

const stripHtml = (h) =>
  String(h || '')
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

/** "1. Atomic Habits – James Clear" / "Atomic Habits by James Clear" lines (no AI needed). */
export function booksInList(text) {
  const out = [];
  for (let line of String(text || '').split(/\n+/)) {
    line = line.replace(/^\s*(\d+[.)]|[-*•])\s*/, '').trim();
    if (line.length < 3 || line.length > 160) continue;
    const m = /^(.+?)\s+(?:by|—|–|-|,)\s+(.+)$/i.exec(line);
    out.push(m ? { title: m[1].replace(/^["“]|["”]$/g, ''), author: m[2] } : { title: line, author: '' });
  }
  return tidy(out);
}

/** Books in a shared link or pasted text: the page's words read by the AI (or a plain list). */
export async function booksInText(input, subject = '') {
  const s = String(input || '').trim();
  const url = (s.match(/https?:\/\/\S+/) || [])[0];
  let name = subject || '';
  let text = s;
  if (url) {
    const html = await getText(url, { timeout: 20000 });
    name = name || (/<title[^>]*>([^<]{3,140})/i.exec(html)?.[1] || '').trim() || new URL(url).hostname;
    text = stripHtml(html);
  }
  if (!aiReady()) return { name: name || 'Pasted list', url, books: booksInList(s) };
  const raw = await askAi(
    `Below is the text of ${url ? 'a web page' : 'a message'}${name ? ` ("${name}")` : ''}. List every book it names or recommends (not films, podcasts or articles). Reply with JSON only: {"books":[{"title":"","author":""}]}.
"""${text.slice(0, 14000)}"""`,
    { json: true }
  );
  return { name: name || 'Pasted list', url, books: tidy(parseJson(raw)?.books) };
}

// Where you have a book: your phone, downloads, Library, played books (by title and author).
function yours(want) {
  const t = mainTitle(want.title);
  const sur = String(want.author || '').split(/[,&]/)[0].trim().split(/\s+/).pop()?.toLowerCase() || '';
  const fits = (b) => b && matches(t, `${b.title || ''} ${b.rawName || ''}`) && (!sur || !b.author || String(b.author).toLowerCase().includes(sur));
  const pool = [...(localCfg.get().books || []), ...Object.values(downloads.get()).filter((d) => d?.status === 'done').map((d) => d.book), ...Object.values(library.get()), ...Object.values(progress.get()).map((p) => p?.book)];
  return pool.filter(fits);
}
const PLACE = { abs: 'Audiobookshelf', tb: 'TorBox', rd: 'Real-Debrid', loc: 'phone' };

/**
 * Each found title matched to the catalogue (Audible) and marked: { want, book, mine, place,
 * sure }. `book` is a catalogue entry (for its page), or your own copy when that's all there is.
 */
export async function matchBooks(list, onEach = null) {
  const { audible } = await import('../sources/catalogs.js');
  const one = async (want, i) => {
    const mineList = yours(want);
    const mine = mineList.find((b) => b.kind !== 'text') || mineList[0] || null;
    let hit = null;
    // Yours already: your own copy is the match (no catalogue lookup needed).
    if (!mine)
      try {
        const found = await Promise.race([audible.search(`${mainTitle(want.title)} ${want.author || ''}`.trim()), new Promise((r) => setTimeout(() => r([]), 8000))]);
        hit = found.find((b) => matches(mainTitle(want.title), b.title)) || null;
      } catch {}
    const book = hit || mine || { uid: `want:${mainTitle(want.title).toLowerCase()}`, kind: 'discover', title: want.title, author: want.author };
    const m = { want, book, mine, place: mine ? PLACE[String(mine.source || mine.uid || '').split(':')[0]] || 'Library' : '', sure: !!hit || !!mine };
    onEach?.(i, m);
    return m;
  };
  // Eight at a time, each shown as soon as it's matched.
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(8, list.length) }, async () => {
      while (next < list.length) {
        const i = next++;
        out[i] = await one(list[i], i);
      }
    })
  );
  return out;
}
/** A found title before it's matched (shown at once while matching). */
export const pending = (want) => ({ want, book: { uid: `want:${mainTitle(want.title).toLowerCase()}`, kind: 'discover', title: want.title, author: want.author }, mine: null, place: '', sure: false, matching: true });

/** Keep a found list as a shelf in Library. */
export function saveShelf(name, books) {
  const id = `f${Date.now()}`;
  foundShelves.set((all) => [{ id, name: String(name || 'Found books').slice(0, 80), at: Date.now(), books: books.map(({ uid, source, kind, title, author, narrator, cover, year, duration, link }) => ({ uid, source, kind, title, author, narrator, cover, year, duration, link })) }, ...all].slice(0, 30));
  return id;
}
