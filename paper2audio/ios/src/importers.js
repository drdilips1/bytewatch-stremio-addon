// Turns a file (EPUB, PDF, text, web page) or pasted text into a book: its title, author and
// blocks ({ t: text, h: true for a heading }), one block per paragraph as the reader shows them.
import JSZip from 'jszip';

const clean = (s) => s.replace(/­/g, '').replace(/\s+/g, ' ').trim();
const newId = () => 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const baseName = (name) => name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Untitled';

function book(title, author, blocks) {
  blocks = blocks.filter((b) => b.t && /[\p{L}\p{N}]/u.test(b.t));
  if (!blocks.length) throw new Error('No readable text found in it');
  const words = blocks.reduce((n, b) => n + b.t.split(' ').length, 0);
  return { id: newId(), title: clean(title) || 'Untitled', author: clean(author || ''), blocks, words, added: Date.now() };
}

// ---- web pages and EPUB chapters: one block per paragraph ----

const BLOCK = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'LI', 'BLOCKQUOTE', 'PRE', 'DT', 'DD', 'TD', 'TH', 'FIGCAPTION', 'ASIDE', 'HEADER', 'FOOTER', 'MAIN', 'BODY', 'UL', 'OL', 'DL', 'TABLE', 'TBODY', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'CENTER']);
const HEADING = /^H[1-6]$/;
const SKIP = new Set(['SCRIPT', 'STYLE', 'NAV', 'NOSCRIPT', 'SVG', 'HEAD', 'TEMPLATE', 'BUTTON', 'FORM']);

/** The paragraphs of an HTML document, in order (the innermost blocks that hold text). */
export function blocksOf(doc) {
  const out = [];
  const walk = (el) => {
    for (const node of el.children) {
      const tag = node.tagName.toUpperCase();
      if (SKIP.has(tag)) continue;
      if (!BLOCK.has(tag)) continue; // inline text is taken with its block
      const hasBlockChild = [...node.children].some((c) => BLOCK.has(c.tagName.toUpperCase()));
      if (hasBlockChild && !HEADING.test(tag)) {
        // Text written directly in this block, between its inner blocks, comes first.
        const own = clean([...node.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join(' '));
        if (own) out.push({ t: own });
        walk(node);
        continue;
      }
      const t = clean(node.textContent || '');
      if (t) out.push(HEADING.test(tag) ? { t, h: true } : { t });
    }
  };
  if (doc.body) walk(doc.body);
  return out;
}

function parseHtml(text, type = 'text/html') {
  let doc = new DOMParser().parseFromString(text, type);
  if (type !== 'text/html' && doc.getElementsByTagName('parsererror').length) doc = new DOMParser().parseFromString(text, 'text/html');
  return doc;
}

// ---- EPUB ----

async function fromEpub(data, name) {
  const zip = await JSZip.loadAsync(data);
  const read = (path) => zip.file(path)?.async('string');
  const container = await read('META-INF/container.xml');
  if (!container) throw new Error('This EPUB is damaged (no container)');
  const opfPath = parseHtml(container, 'application/xml').querySelector('rootfile')?.getAttribute('full-path');
  const opfText = opfPath && (await read(opfPath));
  if (!opfText) throw new Error('This EPUB is damaged (no package)');
  const opf = parseHtml(opfText, 'application/xml');
  const dir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const meta = (tag) => clean(opf.getElementsByTagName('dc:' + tag)[0]?.textContent || opf.getElementsByTagName(tag)[0]?.textContent || '');
  const items = {};
  for (const it of opf.getElementsByTagName('item')) items[it.getAttribute('id')] = it.getAttribute('href');
  const blocks = [];
  for (const ref of opf.getElementsByTagName('itemref')) {
    if (ref.getAttribute('linear') === 'no') continue;
    const href = items[ref.getAttribute('idref')];
    if (!href) continue;
    const path = decodeURIComponent(new URL(href, 'https://x/' + dir).pathname.slice(1));
    const html = await read(path);
    if (!html) continue;
    blocks.push(...blocksOf(parseHtml(html, 'application/xhtml+xml')));
  }
  return book(meta('title') || baseName(name), meta('creator'), blocks);
}

// ---- PDF ----

async function fromPdf(data, name) {
  const pdfjs = await import('pdfjs-dist/build/pdf.min.js');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.js?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise;
  const info = (await pdf.getMetadata().catch(() => null))?.info || {};
  const blocks = [];
  let para = '';
  const flush = () => {
    if (para.trim()) blocks.push({ t: clean(para) });
    para = '';
  };
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    // Lines: the text pieces grouped by their height on the page.
    const lines = [];
    for (const it of content.items) {
      if (!('str' in it)) continue;
      const y = Math.round(it.transform[5]);
      const h = Math.abs(it.transform[3]) || 10;
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.y - y) < h * 0.5) last.text += (last.text.endsWith(' ') || it.str.startsWith(' ') ? '' : ' ') + it.str;
      else lines.push({ y, h, text: it.str });
    }
    const real = lines.map((l) => ({ ...l, text: l.text.trim() })).filter((l) => l.text && !/^\d{1,4}$/.test(l.text)); // no page numbers
    const gaps = real.slice(1).map((l, i) => real[i].y - l.y).filter((g) => g > 0).sort((a, b) => a - b);
    // The usual gap between lines of a paragraph: the smaller gaps (headings and paragraph breaks are bigger).
    const usual = gaps[Math.floor(gaps.length / 4)] || 14;
    real.forEach((l, i) => {
      const gap = i ? real[i - 1].y - l.y : 0;
      // A bigger gap than usual (or a jump up to a new column) starts a new paragraph.
      if (i && (gap > usual * 1.45 || gap < 0)) flush();
      if (para.endsWith('-') && /^[a-z]/.test(l.text)) para = para.slice(0, -1) + l.text;
      else para += (para ? ' ' : '') + l.text;
    });
    // A page that ends a sentence ends its paragraph too.
    if (/[.!?:”"]$/.test(para)) flush();
    page.cleanup();
  }
  flush();
  if (!blocks.length) throw new Error('This PDF has no text (it may be scanned pages)');
  return book(info.Title || baseName(name), info.Author, blocks);
}

// ---- plain text ----

export function fromText(text, title) {
  const norm = text.replace(/\r\n?/g, '\n');
  const parts = /\n\s*\n/.test(norm) ? norm.split(/\n\s*\n/) : norm.split('\n');
  const first = clean(parts.find((p) => clean(p)) || '');
  const name = title || (first.length <= 60 ? first : first.slice(0, 57).replace(/\s+\S*$/, '') + '…');
  return book(name, '', parts.map((p) => ({ t: clean(p) })));
}

/** A file the listener picked: its book (throws with a plain reason if it can't be read). */
export async function importFile(file) {
  const name = file.name || 'Untitled';
  const ext = (name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase();
  if (ext === 'epub' || file.type === 'application/epub+zip') return fromEpub(await file.arrayBuffer(), name);
  if (ext === 'pdf' || file.type === 'application/pdf') return fromPdf(await file.arrayBuffer(), name);
  if (['html', 'htm', 'xhtml'].includes(ext)) {
    const doc = parseHtml(await file.text());
    return book(doc.title || baseName(name), '', blocksOf(doc));
  }
  if (['txt', 'md', 'text', ''].includes(ext) || file.type.startsWith('text/')) return fromText(await file.text(), baseName(name));
  throw new Error('This app reads EPUB, PDF, text and web page files');
}
