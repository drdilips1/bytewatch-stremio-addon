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
    let mine = mineList.find((b) => b.kind !== 'text') || mineList[0] || null;
    let hit = null;
    // Yours already: your own copy is the match (no catalogue lookup needed). Else the catalogue,
    // and at the same time your Audiobookshelf and TorBox / Real-Debrid (a book on the server
    // you never opened in the app is yours too).
    if (!mine) {
      const late = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));
      const [found, owned] = await Promise.all([
        Promise.race([audible.search(`${mainTitle(want.title)} ${want.author || ''}`.trim()).catch(() => []), late(8000, [])]),
        Promise.race([
          import('../sources/index.js').then((m) => m.findOwned({ title: want.title, author: want.author || '' })).catch(() => null),
          late(9000, null),
        ]),
      ]);
      hit = (found || []).find((b) => matches(mainTitle(want.title), b.title)) || null;
      const theirs = [...(owned?.server || []), ...(owned?.cloud || [])];
      mine = theirs.find((b) => b.kind !== 'text') || theirs[0] || null;
    }
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

/**
 * A photo of a page (paper or a screen): which book, and the words to start from — a line
 * that's marked (a finger, a pen, a highlight) or else the first full sentence on the page.
 * { title, author, quote, keywords, chapter, chapterTitle }
 */
export async function pageInImage(dataUrl, hint = null) {
  if (!canSeeImages()) throw new Error('Reading a page needs a Gemini or Claude key (Settings → AI)');
  const now = hint?.title ? ` The listener is in the middle of "${hint.title}"${hint.author ? ` by ${hint.author}` : ''} — it's likely this book, but say so only if the page fits it.` : '';
  const raw = await askAiImage(
    `This is a photo of a page of a book (printed, or on a screen).${now} Work out which book it is from the running header, the names and the story, and copy the words to start listening from: the line that is marked (pointed at with a finger, underlined, highlighted or circled), or if none is marked, the first full sentence at the top of the page. Copy those words exactly as printed, about 25 to 40 words. Reply with JSON only: {"title":"the book's title as published, or empty if you can't tell","author":"","quote":"the exact words","keywords":["5 to 8 unusual words or names from this page"],"chapter":0,"chapterTitle":"the chapter heading if one shows on the page, else empty"}`,
    dataUrl,
    { json: true }
  );
  const j = parseJson(raw) || {};
  const quote = String(j.quote || '').replace(/\s+/g, ' ').trim();
  if (quote.split(' ').length < 6) throw new Error("Couldn't read the words on that page — try again, closer and straight on");
  return {
    title: String(j.title || '').trim(),
    author: String(j.author || '').trim(),
    quote,
    keywords: (Array.isArray(j.keywords) ? j.keywords : []).map(String).filter(Boolean).slice(0, 10),
    chapter: Number(j.chapter) || 0,
    chapterTitle: String(j.chapterTitle || '').trim(),
  };
}

/**
 * Which book a passage is from, by its exact words (Google Books searches inside books):
 * { title, author } or null. For a page the AI couldn't name.
 */
export async function bookForQuote(quote) {
  const ws = String(quote || '').replace(/[“”"]/g, '').split(/\s+/).filter(Boolean);
  for (const n of [9, 6]) {
    if (ws.length < n) continue;
    const phrase = ws.slice(1, 1 + n).join(' '); // the first word is often cut off mid-line
    try {
      const d = await getJson('https://www.googleapis.com/books/v1/volumes?' + qs({ q: `"${phrase}"`, maxResults: 5, printType: 'books' }), { timeout: 10000 });
      const v = (d?.items || []).map((x) => x.volumeInfo || {}).find((v) => v.title && !/summary|study guide|analysis|workbook|sparknotes|cliffsnotes/i.test(`${v.title} ${v.subtitle || ''}`));
      if (v) return { title: v.title, author: (v.authors || [])[0] || '' };
    } catch {}
  }
  return null;
}
