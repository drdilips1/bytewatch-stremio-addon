// EPUB → reader HTML: unzip in the app, follow the spine (reading order) and
// turn the chapters into one sanitized document with inline images, in the
// same { html, headings } shape the reader uses for Gutenberg books.
import { unzipSync, strFromU8 } from 'fflate';
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

/** Returns { html, headings, title, author }. `bytes` is the EPUB file (Uint8Array). */
export function epubToHtml(bytes) {
  let files;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error("This file isn't a readable EPUB");
  }
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
  order.forEach((m, ci) => {
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
      for (const a of [...el.attributes]) {
        const n = a.name.toLowerCase();
        if (n.startsWith('on') || n === 'style' || n === 'class' || n.startsWith('epub:') || n === 'xmlns') el.removeAttribute(a.name);
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
  });
  const headings = [...out.querySelectorAll('h1,h2,h3')]
    .map((h, i) => {
      h.id ||= 'iw-h-' + i;
      return { id: h.id, text: h.textContent.replace(/\s+/g, ' ').trim(), level: +h.tagName[1] };
    })
    .filter((h) => h.text && h.text.length < 120);
  const meta = (sel) => opf.getElementsByTagName(sel)[0]?.textContent?.trim() || '';
  return { html: out.innerHTML, headings, title: meta('dc:title'), author: meta('dc:creator') };
}

// ---- ebooks in your TorBox / Real-Debrid -------------------------------------

/** Reader UIDs for cloud ebooks look like "tb:t:123#ebook" (kept apart from the item's audio progress). */
export const isCloudEbook = (book) => /^(tb|rd):/.test(book?.uid || '') && book.uid.endsWith('#ebook');

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

const docs = new Map(); // uid -> parsed document (this session)

export async function loadCloudEbook(book) {
  if (docs.has(book.uid)) return docs.get(book.uid);
  let file = book.ebookFile;
  if (!file) {
    const d = await cloudDetails({ ...book, uid: book.uid.replace(/#ebook$/, ''), kind: 'text' });
    const list = d.ebooks || [];
    file = list.find((e) => e.name === book.ebookName) || list.find((e) => e.format === 'EPUB') || list[0];
  }
  if (!file) throw new Error('This ebook is no longer in your cloud');
  if (file.format !== 'EPUB') throw new Error(`${file.format} files can't be opened in the reader — use Send to Kindle / Open in another app on the book page`);
  const doc = epubToHtml(await getBytes(await file.resolve()));
  docs.set(book.uid, doc);
  return doc;
}
