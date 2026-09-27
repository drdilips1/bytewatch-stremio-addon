// Document ingestion: turns text, Markdown, Word, EPUB, web pages and OCR'd pages into the
// reading model shared with the PDF reflow ({title, author, blocks, figures, docType}), which
// the reader, narrator and AI all work from. The original file is kept alongside.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (s) => String(s ?? '').replace(/­/g, '').replace(/[ \t ]+/g, ' ').trim();

// ------------------------------------------------------------------ model helpers

function newModel(title, extra = {}) {
  return { v: 1, title: clean(title) || 'Untitled', author: '', blocks: [{ type: 'title', text: clean(title) || 'Untitled' }], figures: [], ...extra };
}

/** Drops empty and duplicated paragraphs, joins words hyphenated across lines. */
export function tidy(model) {
  const seen = new Set();
  model.blocks = model.blocks.filter((b) => {
    if (b.type !== 'p' && b.type !== 'h') return true;
    const t = clean(b.text ?? b.html?.replace(/<[^>]+>/g, ''));
    if (!t) return false;
    if (b.type === 'p' && t.length > 60) {
      if (seen.has(t)) return false;
      seen.add(t);
    }
    return true;
  });
  for (const b of model.blocks) {
    if (b.type === 'p' && b.text) b.text = b.text.replace(/(\w)-\s+([a-z])/g, '$1$2');
  }
  return model;
}

/** Paper, book, article, lecture notes or plain document: drives narration style and study prompts. */
export function detectType(model, hint = '') {
  if (hint === 'epub') return 'book';
  if (hint === 'web') return 'article';
  const heads = model.blocks.filter((b) => b.type === 'h').map((b) => (b.text || '').toLowerCase());
  const text = model.blocks.slice(0, 60).map((b) => b.text || '').join(' ').toLowerCase();
  const paperish = ['abstract', 'introduction', 'methods', 'results', 'discussion', 'conclusion', 'references']
    .filter((k) => heads.some((h) => h.includes(k)) || text.includes(k + '\n')).length;
  if (paperish >= 3 || /\bdoi:?\s*10\.\d{4,}/.test(text)) return 'paper';
  if (heads.filter((h) => /^(chapter|part)\b/.test(h)).length >= 2) return 'book';
  if (/\b(lecture|learning objectives|lesson|module \d)/.test(text)) return 'notes';
  return 'document';
}

export function wordCount(model) {
  return model.blocks.reduce((n, b) => n + ((b.text ?? (b.html || '').replace(/<[^>]+>/g, ' ')).match(/\S+/g) || []).length, 0);
}

// ------------------------------------------------------------------ plain text & Markdown

export function fromText(text, { title = '', markdown = false } = {}) {
  const src = String(text).replace(/\r\n?/g, '\n');
  const lines = src.split('\n');
  const firstLine = lines.find((l) => l.trim())?.replace(/^#+\s*/, '').trim() || 'Pasted text';
  const m = newModel(title || firstLine.slice(0, 120));
  let para = [];
  let list = null;
  const flush = () => {
    if (para.length) m.blocks.push({ type: 'p', text: clean(para.join(' ')) });
    para = [];
    if (list) { m.blocks.push({ type: 'list', html: `<${list.tag}>${list.items.map((i) => `<li>${esc(i)}</li>`).join('')}</${list.tag}>` }); list = null; }
  };
  const isMd = markdown || /^#{1,6}\s|\n#{1,6}\s/.test(src);
  let skippedTitle = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const h = isMd && line.match(/^(#{1,6})\s+(.*)/);
    if (h) {
      flush();
      if (!skippedTitle && h[1].length === 1 && clean(h[2]) === m.title) { skippedTitle = true; continue; }
      m.blocks.push({ type: 'h', level: Math.min(4, h[1].length + 1), text: clean(h[2].replace(/[*_`]/g, '')) });
      continue;
    }
    const li = line.match(/^(?:[-*•]|(\d+)[.)])\s+(.*)/);
    if (li) {
      if (para.length) { m.blocks.push({ type: 'p', text: clean(para.join(' ')) }); para = []; }
      const tag = li[1] ? 'ol' : 'ul';
      if (!list || list.tag !== tag) { if (list) flush(); list = { tag, items: [] }; }
      list.items.push(clean(li[2].replace(/[*_`]/g, '')));
      continue;
    }
    if (list) flush();
    // Plain text: short standalone lines like "CHAPTER 3" or "Methods" become headings.
    if (!isMd && para.length === 0 && line.length < 70 && !/[.,;:]$/.test(line)
      && (/^(chapter|part|section)\s+\w+/i.test(line) || (line === line.toUpperCase() && /[A-Z]{3}/.test(line)))) {
      m.blocks.push({ type: 'h', level: 2, text: clean(line) });
      continue;
    }
    para.push(isMd ? line.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`/g, '') : line);
  }
  flush();
  return tidy(m);
}

// ------------------------------------------------------------------ HTML (web pages, EPUB chapters)

const DROP = 'script,style,noscript,template,nav,header,footer,aside,form,iframe,svg,button,select,input,textarea,'
  + '[role=navigation],[role=banner],[role=contentinfo],[aria-hidden=true],.ad,.ads,.advert,[class*=advert],[id*=advert],'
  + '[class*=cookie],[id*=cookie],[class*=newsletter],[class*=share],[class*=social],[class*=related],[class*=comment],'
  + '[class*=promo],[class*=subscribe],[class*=sidebar],[class*=breadcrumb],[class*=popup],[class*=modal]';

/** The element holding the article: the smallest one that still has most of the page's paragraph text. */
function mainContent(doc) {
  const scored = [];
  let best = 0;
  for (const el of doc.body.querySelectorAll('article, main, [role=main], section, div')) {
    let n = 0;
    for (const p of el.querySelectorAll('p')) n += p.textContent.trim().length;
    if (n > 0) scored.push([el, n]);
    best = Math.max(best, n);
  }
  if (!best) return doc.body;
  let pick = doc.body;
  let pickLen = Infinity;
  for (const [el, n] of scored) {
    const size = el.textContent.length;
    if (n >= best * 0.85 && size < pickLen) { pick = el; pickLen = size; }
  }
  return pick;
}

function htmlBlocks(root, m, base, { chapter = '' } = {}) {
  let added = 0;
  const push = (b) => { m.blocks.push(b); added++; };
  if (chapter) push({ type: 'h', level: 2, text: chapter });
  const inline = (el) => clean(el.textContent);
  const walk = (node) => {
    for (const el of node.children) {
      const t = el.tagName;
      if (/^H[1-6]$/.test(t)) {
        const text = inline(el);
        if (text && text !== m.title && text !== chapter) push({ type: 'h', level: Math.min(4, Math.max(2, +t[1])), text });
      } else if (t === 'P' || t === 'BLOCKQUOTE' || t === 'PRE' || t === 'DD') {
        const text = inline(el);
        if (text.length > 1) push({ type: 'p', text: t === 'BLOCKQUOTE' ? `“${text}”` : text, ...(t === 'BLOCKQUOTE' ? { quote: true } : {}) });
      } else if (t === 'UL' || t === 'OL') {
        const items = [...el.children].filter((li) => li.tagName === 'LI').map((li) => inline(li)).filter(Boolean);
        if (items.length) push({ type: 'list', html: `<${t.toLowerCase()}>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</${t.toLowerCase()}>` });
      } else if (t === 'TABLE') {
        const rows = [...el.querySelectorAll('tr')].map((tr) => '<tr>' + [...tr.children].map((c) => {
          const tag = c.tagName === 'TH' ? 'th' : 'td';
          return `<${tag}>${esc(inline(c))}</${tag}>`;
        }).join('') + '</tr>').join('');
        if (rows) {
          const id = `table-${m.figures.length + 1}`;
          const cap = el.querySelector('caption');
          m.figures.push({ id, kind: 'table', label: `Table ${m.figures.filter((f) => f.kind === 'table').length + 1}`, caption: cap ? inline(cap) : '', html: `<table>${rows}</table>` });
          push({ type: 'table', id });
        }
      } else if (t === 'FIGURE' || t === 'IMG') {
        const img = t === 'IMG' ? el : el.querySelector('img');
        let src = img?.getAttribute('src') || img?.getAttribute('data-src') || '';
        try { src = src ? new URL(src, base).href : ''; } catch { src = ''; }
        const cap = t === 'FIGURE' ? inline(el.querySelector('figcaption') || el) : clean(img?.getAttribute('alt'));
        if (/^https:\/\//.test(src)) {
          const id = `fig-${m.figures.length + 1}`;
          m.figures.push({ id, kind: 'fig', label: `Figure ${m.figures.filter((f) => f.kind === 'fig').length + 1}`, caption: cap, src });
          push({ type: 'fig', id });
        } else if (cap && t === 'FIGURE') push({ type: 'p', text: cap, small: true });
      } else if (el.children.length) {
        // Text sitting directly in a <div> counts as a paragraph.
        const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join(' ').trim();
        if (own.length > 40) push({ type: 'p', text: clean(el.textContent) });
        else walk(el);
      } else {
        const text = inline(el);
        if (text.length > 40) push({ type: 'p', text });
      }
    }
  };
  walk(root);
  return added;
}

export function fromHtml(html, { url = '', title = '' } = {}) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const meta = (sel) => doc.querySelector(sel)?.getAttribute('content')?.trim() || '';
  const t = title || meta('meta[property="og:title"]') || clean(doc.querySelector('h1')?.textContent) || clean(doc.title) || url;
  const m = newModel(t, { source: url });
  m.author = meta('meta[name=author]') || meta('meta[property="article:author"]') || clean(doc.querySelector('[rel=author], .byline, .author')?.textContent).slice(0, 80);
  m.site = meta('meta[property="og:site_name"]') || (url ? new URL(url).hostname.replace(/^www\./, '') : '');
  doc.querySelectorAll(DROP).forEach((el) => el.remove());
  htmlBlocks(mainContent(doc), m, url || location.href);
  if (m.blocks.length < 3) throw new Error('No readable article found on that page');
  return tidy(m);
}

// ------------------------------------------------------------------ ZIP (EPUB, DOCX)

async function unzip(buf) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid EPUB/Word file');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, { method, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  const read = async (name) => {
    const e = entries.get(name) || entries.get(decodeURIComponent(name));
    if (!e) return null;
    const start = e.local + 30 + dv.getUint16(e.local + 26, true) + dv.getUint16(e.local + 28, true);
    const data = u8.subarray(start, start + e.size);
    if (e.method === 0) return data;
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  };
  const text = async (name) => { const d = await read(name); return d ? new TextDecoder().decode(d) : null; };
  return { names: [...entries.keys()], read, text };
}

const byLocal = (root, name) => [...root.getElementsByTagName('*')].filter((e) => e.localName === name);

export async function fromDocx(buf, { name = '' } = {}) {
  const zip = await unzip(buf);
  const xml = await zip.text('word/document.xml');
  if (!xml) throw new Error('Not a Word (.docx) document');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const core = await zip.text('docProps/core.xml');
  const cdoc = core ? new DOMParser().parseFromString(core, 'application/xml') : null;
  const docTitle = cdoc ? clean(byLocal(cdoc, 'title')[0]?.textContent) : '';
  const m = newModel(docTitle || name.replace(/\.docx$/i, ''));
  m.author = cdoc ? clean(byLocal(cdoc, 'creator')[0]?.textContent) : '';
  const runText = (p) => {
    let out = '';
    for (const n of p.getElementsByTagName('*')) {
      if (n.localName === 't') out += n.textContent;
      else if (n.localName === 'tab') out += ' ';
      else if (n.localName === 'br') out += '\n';
    }
    return out;
  };
  const body = byLocal(doc, 'body')[0];
  let list = [];
  const flushList = () => { if (list.length) m.blocks.push({ type: 'list', html: `<ul>${list.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` }); list = []; };
  let first = true;
  for (const el of body.children) {
    if (el.localName === 'p') {
      const style = byLocal(el, 'pStyle')[0]?.getAttribute('w:val') || '';
      const text = clean(runText(el));
      if (!text) continue;
      const isList = byLocal(el, 'numPr').length > 0 || /List/i.test(style);
      if (isList) { list.push(text); continue; }
      flushList();
      const hm = style.match(/^Heading(\d)/i);
      if (/^Title$/i.test(style) || (first && !docTitle && text.length < 150 && hm)) {
        if (m.title === 'Untitled' || !docTitle) { m.title = text; m.blocks[0].text = text; }
      } else if (hm) {
        m.blocks.push({ type: 'h', level: Math.min(4, +hm[1] + 1), text });
      } else {
        m.blocks.push({ type: 'p', text });
      }
      first = false;
    } else if (el.localName === 'tbl') {
      flushList();
      const rows = byLocal(el, 'tr').map((tr) => '<tr>' + byLocal(tr, 'tc').map((tc) => `<td>${esc(clean(runText(tc)))}</td>`).join('') + '</tr>').join('');
      const id = `table-${m.figures.length + 1}`;
      m.figures.push({ id, kind: 'table', label: `Table ${m.figures.length + 1}`, caption: '', html: `<table>${rows}</table>` });
      m.blocks.push({ type: 'table', id });
    }
  }
  flushList();
  return tidy(m);
}

export async function fromEpub(buf, { name = '' } = {}) {
  const zip = await unzip(buf);
  const container = await zip.text('META-INF/container.xml');
  if (!container) throw new Error('Not an EPUB book');
  const opfPath = new DOMParser().parseFromString(container, 'application/xml').querySelector('rootfile')?.getAttribute('full-path');
  const opfText = opfPath && await zip.text(opfPath);
  if (!opfText) throw new Error('This EPUB has no table of contents');
  const opf = new DOMParser().parseFromString(opfText, 'application/xml');
  const baseDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const m = newModel(clean(byLocal(opf, 'title')[0]?.textContent) || name.replace(/\.epub$/i, ''));
  m.author = clean(byLocal(opf, 'creator')[0]?.textContent);
  const manifest = new Map(byLocal(opf, 'item').map((i) => [i.getAttribute('id'), i.getAttribute('href')]));
  const spine = byLocal(opf, 'itemref').map((r) => manifest.get(r.getAttribute('idref'))).filter(Boolean);
  let chapterNo = 0;
  for (const href of spine) {
    const path = (baseDir + href).replace(/[^/]+\/\.\.\//g, '').split('#')[0];
    const html = await zip.text(path);
    if (!html) continue;
    let doc = new DOMParser().parseFromString(html, 'application/xhtml+xml');
    if (doc.querySelector('parsererror') || !doc.body) doc = new DOMParser().parseFromString(html, 'text/html');
    if (!doc.body) continue;
    doc.querySelectorAll('script,style,nav').forEach((e) => e.remove());
    const words = (doc.body.textContent.match(/\S+/g) || []).length;
    if (words < 30) continue; // cover, copyright, blank pages
    const h = doc.body.querySelector('h1, h2, h3');
    const heading = clean(h?.textContent) || clean(doc.title) || `Chapter ${chapterNo + 1}`;
    if (h) h.remove();
    chapterNo++;
    htmlBlocks(doc.body, m, 'https://epub.invalid/', { chapter: heading });
  }
  // Images in books aren't carried over (they live inside the EPUB file).
  m.figures = m.figures.filter((f) => f.kind === 'table');
  m.blocks = m.blocks.filter((b) => b.type !== 'fig');
  return tidy(m);
}

// ------------------------------------------------------------------ OCR (photos, scanned PDFs)

/**
 * pages: ML Kit results [{w, h, blocks: [{lines: [{t, x, y, w, h}]}]}].
 * Rebuilds reading order (two columns when present), drops running headers/footers and page
 * numbers, and turns tall short lines into headings.
 */
export function fromOcr(pages, { title = '' } = {}) {
  const heights = [];
  pages.forEach((pg) => pg.blocks.forEach((b) => b.lines.forEach((l) => l.h && heights.push(l.h))));
  heights.sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)] || 20;
  // Lines that repeat at the top/bottom of pages are running headers or footers.
  const edgeCount = new Map();
  const edgeKey = (t) => t.toLowerCase().replace(/\d+/g, '#').trim();
  pages.forEach((pg) => {
    const seen = new Set();
    pg.blocks.forEach((b) => b.lines.forEach((l) => {
      if (l.y < pg.h * 0.08 || l.y + l.h > pg.h * 0.92) seen.add(edgeKey(l.t));
    }));
    seen.forEach((k) => edgeCount.set(k, (edgeCount.get(k) || 0) + 1));
  });
  const m = newModel(title || 'Scanned document', { ocr: true, pages: pages.length });
  let gotTitle = !!title;
  pages.forEach((pg, pi) => {
    const blocks = pg.blocks.map((b) => {
      const lines = b.lines.filter((l) => {
        const edge = l.y < pg.h * 0.08 || l.y + l.h > pg.h * 0.92;
        if (edge && /^\s*(page\s*)?\d{1,4}(\s*(of|\/)\s*\d+)?\s*$/i.test(l.t)) return false;
        if (edge && pages.length > 2 && (edgeCount.get(edgeKey(l.t)) || 0) >= Math.max(2, pages.length * 0.4)) return false;
        return true;
      });
      if (!lines.length) return null;
      const x = Math.min(...lines.map((l) => l.x ?? 0));
      const y = Math.min(...lines.map((l) => l.y ?? 0));
      const right = Math.max(...lines.map((l) => (l.x ?? 0) + (l.w ?? 0)));
      const h = lines.reduce((s, l) => s + (l.h || median), 0) / lines.length;
      return { lines, x, y, w: right - x, h };
    }).filter(Boolean);
    // Two columns: narrow blocks on both halves of the page.
    const narrow = blocks.filter((b) => b.w < pg.w * 0.55);
    const twoCol = narrow.filter((b) => b.x > pg.w * 0.45).length >= 2 && narrow.filter((b) => b.x + b.w < pg.w * 0.55).length >= 2;
    const col = (b) => (!twoCol || b.w >= pg.w * 0.55 ? -1 : b.x > pg.w * 0.45 ? 1 : 0);
    blocks.sort((a, b) => {
      const ca = col(a), cb = col(b);
      if (ca !== cb && ca >= 0 && cb >= 0) return ca - cb;
      return a.y - b.y || a.x - b.x;
    });
    for (const b of blocks) {
      const text = clean(b.lines.map((l) => l.t).join('\n').replace(/-\n(?=[a-z])/g, '').replace(/\n/g, ' '));
      if (!text) continue;
      const big = b.h > median * 1.35;
      if (!gotTitle && pi === 0 && big && text.length < 160) { m.title = text; m.blocks[0].text = text; gotTitle = true; continue; }
      if (big && b.lines.length <= 2 && text.length < 90 && !/[.,;]$/.test(text)) m.blocks.push({ type: 'h', level: b.h > median * 1.8 ? 2 : 3, text });
      else m.blocks.push({ type: 'p', text, page: pi + 1 });
    }
  });
  if (!gotTitle) {
    const first = m.blocks.find((b) => b.type === 'p');
    const t = first ? first.text.split(/(?<=[.!?])\s/)[0].slice(0, 80) : 'Scanned page';
    m.title = t; m.blocks[0].text = t;
  }
  return tidy(m);
}
