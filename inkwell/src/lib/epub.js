// EPUB → reader HTML: unzip in the app, follow the spine (reading order) and
// turn the chapters into one sanitized document with inline images, in the
// same { html, headings } shape the reader uses for Gutenberg books.
import { unzip, strFromU8 } from 'fflate';
import { details as cloudDetails } from '../sources/debrid.js';
import { getBytes } from './http.js';

const IMG_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };

// Resolve "../Images/a.jpg" against "OEBPS/Text/ch1.xhtml".
function join(base, rel) {
  const parts = base.split('/').slice(0, -1);
  for (const seg of decodeURIComponent(rel.split('#')[0]).split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

const parseXml = (text) => new DOMParser().parseFromString(text, 'application/xml');

// Presentational attributes that squeeze or shift the text in the reader.
const DROP_ATTRS = /^(on|style$|class$|epub:|xmlns|width$|height$|align$|valign$|border$|cellpadding$|cellspacing$|bgcolor$|color$|face$|size$|dir$|xml:)/;
const nextFrame = () => new Promise((r) => setTimeout(r, 0));

/** Unzip without blocking the app (fflate unpacks in a background worker). */
const unzipAsync = (bytes) =>
  new Promise((resolve, reject) =>
    unzip(bytes, (err, files) => (err ? reject(new Error("This file isn't a readable EPUB")) : resolve(files)))
  );

/**
 * Returns { html, headings, title, author, urls }. `bytes` is the EPUB file
 * (Uint8Array). Works in small steps so a big book never freezes the app.
 */
export async function epubToHtml(bytes) {
  const files = await unzipAsync(bytes);
  const text = (path) => (files[path] ? strFromU8(files[path]) : '');
  const container = parseXml(text('META-INF/container.xml'));
  const opfPath = container.querySelector('rootfile')?.getAttribute('full-path') || Object.keys(files).find((f) => f.endsWith('.opf'));
  if (!opfPath || !files[opfPath]) throw new Error("This EPUB has no table of contents (OPF) — it can't be read in the app");
  if (files['META-INF/encryption.xml'] && /EncryptedData/.test(text('META-INF/encryption.xml')) && !/font/i.test(text('META-INF/encryption.xml')))
    throw new Error('This EPUB is DRM-protected, so it can only be opened in the store app it came from');
  const opf = parseXml(text(opfPath));
  const manifest = {};
  opf.querySelectorAll('manifest > item').forEach((it) => (manifest[it.getAttribute('id')] = { href: join(opfPath, it.getAttribute('href') || ''), type: it.getAttribute('media-type') || '' }));
  const order = [...opf.querySelectorAll('spine > itemref')].map((r) => manifest[r.getAttribute('idref')]).filter((m) => m && /html/.test(m.type) && files[m.href]);
  if (!order.length) throw new Error('This EPUB has no readable chapters');

  const urls = new Map(); // image path -> blob URL
  const imageUrl = (path) => {
    if (!files[path]) return '';
    if (!urls.has(path)) urls.set(path, URL.createObjectURL(new Blob([files[path]], { type: IMG_TYPES[path.split('.').pop().toLowerCase()] || 'image/*' })));
    return urls.get(path);
  };

  const out = document.createElement('div');
  for (let ci = 0; ci < order.length; ci++) {
    const m = order[ci];
    if (ci % 4 === 3) await nextFrame(); // let the app breathe between chapters
    const raw = text(m.href);
    let doc = new DOMParser().parseFromString(raw, 'application/xhtml+xml');
    if (doc.querySelector('parsererror') || !doc.body) doc = new DOMParser().parseFromString(raw, 'text/html');
    const body = doc.body || doc.documentElement;
    body.querySelectorAll('script,style,link,meta,iframe,object,embed,form').forEach((n) => n.remove());
    body.querySelectorAll('*').forEach((el) => {
      const tag = el.tagName.toLowerCase();
      if (tag === 'img' || tag === 'image') {
        const src = el.getAttribute('src') || el.getAttribute('href') || el.getAttribute('xlink:href') || '';
        const img = document.createElement('img');
        const u = src && !/^[a-z]+:/i.test(src) ? imageUrl(join(m.href, src)) : '';
        if (!u) return el.remove();
        img.src = u;
        img.loading = 'lazy';
        img.alt = el.getAttribute('alt') || '';
        el.replaceWith(img);
        return;
      }
      if (tag === 'font' || tag === 'center' || tag === 'big' || tag === 'small') {
        el.replaceWith(...el.childNodes); // keep the text, drop the old formatting tag
        return;
      }
      for (const a of [...el.attributes]) {
        const n = a.name.toLowerCase();
        if (DROP_ATTRS.test(n)) el.removeAttribute(a.name);
        if ((n === 'href' || n === 'src') && /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
      }
      if (tag === 'a') {
        const href = el.getAttribute('href') || '';
        if (/^https?:/i.test(href)) el.setAttribute('target', '_blank');
        else el.removeAttribute('href'); // internal links: the reader scrolls instead
      }
    });
    // svg wrappers left empty after image replacement
    body.querySelectorAll('svg').forEach((s) => !s.querySelector('img') && !s.textContent.trim() && s.remove());
    const section = document.createElement('section');
    section.className = 'chapter';
    section.id = 'iw-c-' + ci;
    section.innerHTML = body.innerHTML;
    out.appendChild(section);
  }
  const headings = [...out.querySelectorAll('h1,h2,h3')]
    .map((h, i) => {
      h.id ||= 'iw-h-' + i;
      return { id: h.id, text: h.textContent.replace(/\s+/g, ' ').trim(), level: +h.tagName[1] };
    })
    .filter((h) => h.text && h.text.length < 120);
  const meta = (sel) => opf.getElementsByTagName(sel)[0]?.textContent?.trim() || '';
  return { html: out.innerHTML, headings, title: meta('dc:title'), author: meta('dc:creator'), urls: [...urls.values()] };
}

// ---- ebooks in your TorBox / Real-Debrid -------------------------------------

/** Reader UIDs for cloud ebooks look like "tb:t:123#ebook" (kept apart from the item's audio progress). */
export const isCloudEbook = (book) => /^(tb|rd|src):/.test(book?.uid || '') && book.uid.endsWith('#ebook');

// ---- direct ebook links from source addons (e.g. Bookracy) -------------------

const EBOOK_FORMATS = /^(epub|pdf|mobi|azw3?|fb2|djvu|cbz|cbr|txt)$/i;
const EBOOK_EXT = /\.(epub|pdf|mobi|azw3?|fb2|djvu|cbz|cbr|txt)(?:$|[?#&])/i;

// Short stable id for a link, so reading progress survives app restarts.
function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const safeDecode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** The ebook file behind a source result's direct link, or null when it isn't an ebook. */
export function directEbookFile(r) {
  const link = r?.link || '';
  if (!/^https?:/i.test(link)) return null;
  const given = String(r.format || '').trim();
  const fmt = (EBOOK_FORMATS.test(given) ? given : EBOOK_EXT.exec(safeDecode(link))?.[1] || '').toUpperCase();
  if (!fmt) return null;
  const name = `${String(r.title || 'Book').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 90)}.${fmt.toLowerCase()}`;
  return { name, format: fmt, size: r.size || 0, resolve: async () => link };
}

/** The book to open in the reader for a source result's direct EPUB link. */
export const directReaderBook = (r, file, book) => ({
  uid: `src:${hashStr(r.link)}#ebook`,
  source: 'src',
  kind: 'text',
  title: book?.title || r.title,
  author: book?.author || r.author || '',
  cover: book?.cover || '',
  ebookName: file.name,
  ebookFormat: file.format,
  ebookUrl: r.link,
  ebookFile: file,
});

/** The book to open in the reader for one ebook file of a cloud item. */
export const cloudReaderBook = (book, file) => ({
  uid: `${book.uid.replace(/#ebook$/, '')}#ebook`,
  source: book.source,
  kind: 'text',
  title: book.title,
  author: book.author,
  cover: book.cover,
  ebookName: file.name,
  ebookFile: file,
});

// Parsed books kept in memory: only the last two (big books hold a lot of text and images).
const docs = new Map();
function remember(uid, doc) {
  docs.delete(uid);
  docs.set(uid, doc);
  while (docs.size > 2) {
    const [old, d] = docs.entries().next().value;
    docs.delete(old);
    (d.urls || []).forEach((u) => URL.revokeObjectURL(u));
  }
  return doc;
}

// Downloaded EPUBs are kept on the phone (the app's cache storage), so reopening,
// Listen and Read aloud don't download them again and work offline.
const CACHE = 'kathava-ebooks';
const cacheKey = (uid) => `https://kathava.local/ebook/${encodeURIComponent(uid)}`;
async function cachedBytes(uid) {
  try {
    const hit = await (await caches.open(CACHE)).match(cacheKey(uid));
    return hit ? new Uint8Array(await hit.arrayBuffer()) : null;
  } catch {
    return null;
  }
}
async function keepBytes(uid, bytes) {
  try {
    await (await caches.open(CACHE)).put(cacheKey(uid), new Response(bytes, { headers: { 'Content-Type': 'application/epub+zip' } }));
  } catch {}
}
export async function forgetEbook(uid) {
  docs.delete(uid);
  try {
    await (await caches.open(CACHE)).delete(cacheKey(uid));
  } catch {}
}

const loading = new Map(); // uid -> promise, so Read + Listen share one download

export function loadCloudEbook(book) {
  if (docs.has(book.uid)) return Promise.resolve(docs.get(book.uid));
  if (!loading.has(book.uid)) loading.set(book.uid, loadEbook(book).finally(() => loading.delete(book.uid)));
  return loading.get(book.uid);
}

async function loadEbook(book) {
  const saved = await cachedBytes(book.uid);
  if (saved) return remember(book.uid, await epubToHtml(saved));
  let file = book.ebookFile;
  // Direct links (reopened from Continue): the saved link is all we need.
  if (!file && book.ebookUrl) file = { name: book.ebookName || 'book.epub', format: book.ebookFormat || 'EPUB', resolve: async () => book.ebookUrl };
  if (!file) {
    const d = await cloudDetails({ ...book, uid: book.uid.replace(/#ebook$/, ''), kind: 'text' });
    const list = d.ebooks || [];
    file = list.find((e) => e.name === book.ebookName) || list.find((e) => e.format === 'EPUB') || list[0];
  }
  if (!file) throw new Error('This ebook is no longer in your cloud');
  if (file.format !== 'EPUB') throw new Error(`${file.format} files can't be opened in the reader — use Send to Kindle / Open in another app on the book page`);
  const bytes = await getBytes(await file.resolve());
  const doc = await epubToHtml(bytes); // throws before caching if it isn't a readable EPUB
  keepBytes(book.uid, bytes);
  return remember(book.uid, doc);
}
