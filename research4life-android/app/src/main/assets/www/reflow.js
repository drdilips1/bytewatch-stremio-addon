// Turns a journal PDF into a mobile reading layout: one column of headings and paragraphs,
// with figures and tables cropped from the page as images.
import * as pdfjs from './vendor/pdfjs/pdf.min.js';

const BASE = new URL('./vendor/pdfjs/', import.meta.url).href;
pdfjs.GlobalWorkerOptions.workerSrc = BASE + 'pdf.worker.min.js';

const CAPTION = /^(fig(ure)?|table|tab|scheme|chart|box)\.?\s*([0-9]+|[ivxlc]+)\b/i;
const FIG_CAPTION = /^(fig(ure)?|scheme|chart)\.?\s*([0-9]+|[ivxlc]+)\b/i;
const TABLE_CAPTION = /^(table|tab)\.?\s*([0-9]+|[ivxlc]+)\b/i;
const SECTION_WORDS = /^(abstract|introduction|background|methods?|materials and methods|patients and methods|results|discussion|conclusions?|limitations|references|acknowledg(e)?ments?|funding|conflicts? of interest|disclosures?|summary|case reports?|case presentation|capsule summary|key points|study design|statistical analysis)\b/i;

export function openPdf(url) {
  return pdfjs.getDocument({
    url,
    standardFontDataUrl: BASE + 'standard_fonts/',
    cMapUrl: BASE + 'cmaps/',
    cMapPacked: true,
    isEvalSupported: false,
  }).promise;
}

/** Renders page `n` to a canvas at the given CSS width. */
export async function renderPage(doc, n, cssWidth, ratio = window.devicePixelRatio || 2) {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: (cssWidth / base.width) * ratio });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  return canvas;
}

// ------------------------------------------------------------------ geometry helpers

const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

/** Bounding boxes (PDF units, y up) of the raster images drawn on a page. */
async function imageBoxes(page) {
  const ops = await page.getOperatorList();
  const OPS = pdfjs.OPS;
  const boxes = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = mul(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin && args?.[0]) { stack.push(ctm); ctm = mul(ctm, args[0]); }
    else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm;
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject || fn === OPS.paintJpegXObject) {
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]]);
      const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
      const b = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
      if (b.x1 - b.x0 > 40 && b.y1 - b.y0 > 40) boxes.push(b);
    }
  }
  // Merge overlapping or touching boxes (multi-panel figures).
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < boxes.length && !merged; i++) {
      for (let j = i + 1; j < boxes.length && !merged; j++) {
        const a = boxes[i], b = boxes[j];
        if (a.x0 - 6 < b.x1 && b.x0 - 6 < a.x1 && a.y0 - 6 < b.y1 && b.y0 - 6 < a.y1) {
          boxes[i] = { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
          boxes.splice(j, 1);
          merged = true;
        }
      }
    }
  }
  return boxes;
}

// ------------------------------------------------------------------ text layout

function fontInfo(page, name) {
  try {
    if (page.commonObjs.has(name)) {
      const f = page.commonObjs.get(name);
      const n = (f?.name || '') + ' ' + (f?.loadedName || '');
      return { bold: !!f?.bold || /bold|black|heavy|semibold|demi/i.test(n), italic: !!f?.italic || /italic|oblique/i.test(n) };
    }
  } catch { /* font not loaded */ }
  return { bold: false, italic: false };
}

/**
 * Where a page's columns meet: the widest strip in the middle half of the page that (almost)
 * no text crosses. Columns aren't always equal (a narrow side column, a wide main one), so
 * the middle of the page isn't good enough. Returns null for single-column pages.
 */
function findGutter(items, width) {
  const B = 3;
  const n = Math.ceil(width / B) + 1;
  const cov = new Array(n).fill(0);
  let chars = 0;
  for (const it of items) {
    const len = it.s.length;
    chars += len;
    for (let b = Math.max(0, Math.floor(it.x / B)); b <= Math.min(n - 1, Math.floor((it.x + it.w) / B)); b++) cov[b] += len;
  }
  if (!chars) return null;
  // Text crossing a real gutter is only titles and full-width parts: allow a little.
  const limit = chars * 0.04;
  let best = null;
  let run = null;
  for (let b = Math.floor(width * 0.22 / B); b <= Math.ceil(width * 0.78 / B); b++) {
    if (cov[b] <= limit) {
      if (!run) run = { a: b, z: b, sum: 0 };
      run.z = b;
      run.sum += cov[b];
    } else if (run) {
      if (!best || run.z - run.a > best.z - best.a || (run.z - run.a === best.z - best.a && run.sum < best.sum)) best = run;
      run = null;
    }
  }
  if (run && (!best || run.z - run.a > best.z - best.a)) best = run;
  if (!best || (best.z - best.a + 1) * B < 6) return null;
  const g = ((best.a + best.z + 1) / 2) * B;
  // Both sides must carry real text (not a margin note).
  const left = items.filter((it) => it.x + it.w <= g + 2).reduce((k, it) => k + it.s.length, 0);
  const right = items.filter((it) => it.x >= g - 2).reduce((k, it) => k + it.s.length, 0);
  return left > chars * 0.15 && right > chars * 0.15 ? g : null;
}

/**
 * Author manuscripts number every line in the margin. Those numbers are bare digits sitting left
 * (or right) of the text block; drop them so they don't mix into headings and paragraphs.
 */
function stripLineNumbers(items) {
  const isNum = (it) => /^\d{1,4}$/.test(it.s.trim());
  const text = items.filter((it) => !isNum(it));
  if (text.length < 10) return items;
  const xs = text.map((it) => it.x).sort((a, b) => a - b);
  const ends = text.map((it) => it.x + it.w).sort((a, b) => a - b);
  const L = xs[Math.floor(xs.length * 0.03)];
  const R = ends[Math.ceil(ends.length * 0.97) - 1];
  const margin = items.filter((it) => isNum(it) && (it.x + it.w < L - 0.5 || it.x > R + 0.5));
  if (margin.length < 6) return items;
  const drop = new Set(margin);
  return items.filter((it) => !drop.has(it));
}

/**
 * Superscripts (affiliation marks, citation numbers, "K17^hi") sit above the baseline in a
 * smaller font, so they would form lines of their own. Move each onto its neighbour's baseline
 * and write it with superscript characters.
 */
const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '–': '⁻', '(': '⁽', ')': '⁾', '*': '*', ',': ',', '†': '†', '‡': '‡', '§': '§', '¶': '¶', '#': '#', ' ': '',
  a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', f: 'ᶠ', g: 'ᵍ', h: 'ʰ', i: 'ⁱ', j: 'ʲ', k: 'ᵏ', l: 'ˡ', m: 'ᵐ', n: 'ⁿ', o: 'ᵒ', p: 'ᵖ', r: 'ʳ', s: 'ˢ', t: 'ᵗ', u: 'ᵘ', v: 'ᵛ', w: 'ʷ', x: 'ˣ', y: 'ʸ', z: 'ᶻ' };
function markSuperscripts(items) {
  for (const s of items) {
    const t = s.s.trim();
    if (!t || t.length > 12 || !/^[\d\s,*†‡§¶#+\-–()a-z]+$/.test(t)) continue;
    if (/[a-z]/.test(t) && (t.length > 3 || /\d/.test(t))) continue;
    let best = null, bestD = Infinity;
    for (const b of items) {
      if (b === s || b.sup || b.h < s.h * 1.1) continue;
      const rise = s.y - b.y;
      if (rise < b.h * 0.12 || rise > b.h * 0.8) continue;
      const after = s.x - (b.x + b.w); // mark right after a word
      const before = b.x - (s.x + s.w); // mark right before a word ("¹Department of …")
      const d = Math.min(after > -b.h * 0.3 ? Math.abs(after) : Infinity, before > -b.h * 0.3 ? Math.abs(before) : Infinity);
      if (d < b.h * 0.9 && d < bestD) { best = b; bestD = d; }
    }
    if (!best) continue;
    s.y = best.y;
    s.h = best.h;
    s.sup = true;
    const conv = [...t].map((c) => SUP[c]);
    s.s = conv.every((c) => c != null) ? conv.join('') : t;
  }
  return items;
}

function buildLines(items, gutter = null) {
  items.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  // Never join text across the gutter, however close the two columns sit.
  const crosses = (l, it) => gutter != null && l.x1 <= gutter + 2 && it.x >= gutter - 2 && l.x0 < gutter;
  for (const it of items) {
    const line = lines.find((l) => Math.abs(l.y - it.y) < Math.max(l.h, it.h) * 0.45 && it.x > l.x1 - it.h * 0.6 && it.x - l.x1 < it.h * 2.5 && !crosses(l, it));
    if (line) {
      line.items.push(it);
      line.x1 = Math.max(line.x1, it.x + it.w);
      line.h = Math.max(line.h, it.h);
    } else {
      lines.push({ y: it.y, h: it.h, x0: it.x, x1: it.x + it.w, items: [it] });
    }
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    let text = '';
    let prev = null;
    for (const it of l.items) {
      if (prev && !it.sup && it.x - (prev.x + prev.w) > it.h * 0.18 && !/\s$/.test(text) && !/^\s/.test(it.s)) text += ' ';
      text += it.s;
      prev = it;
    }
    l.text = text.replace(/\s+/g, ' ').trim();
    const chars = l.items.reduce((n, it) => n + it.s.length, 0) || 1;
    l.size = l.items.reduce((n, it) => n + it.h * it.s.length, 0) / chars;
    l.bold = l.items.filter((it) => it.bold).reduce((n, it) => n + it.s.length, 0) / chars > 0.6;
    l.italic = l.items.filter((it) => it.italic).reduce((n, it) => n + it.s.length, 0) / chars > 0.6;
    // Wide gaps between pieces suggest a table row.
    let gaps = 0;
    for (let i = 1; i < l.items.length; i++) if (l.items[i].x - (l.items[i - 1].x + l.items[i - 1].w) > l.h * 1.6) gaps++;
    l.cells = gaps;
  }
  return lines.filter((l) => l.text);
}

/** Splits lines that straddle the gutter of a two-column page and tags each line's column. */
function assignColumns(lines, width, gutter = null) {
  const mid = gutter ?? width / 2;
  const total = lines.reduce((n, l) => n + l.text.length, 0) || 1;
  const crossing = lines.filter((l) => l.x0 < mid - 12 && l.x1 > mid + 12).reduce((n, l) => n + l.text.length, 0);
  const twoCol = (gutter != null || crossing / total < 0.35) && lines.filter((l) => l.x0 > mid - 5).length > 5;
  for (const l of lines) {
    if (!twoCol) l.col = 0;
    else if (l.x1 <= mid + 8) l.col = 1;
    else if (l.x0 >= mid - 8) l.col = 2;
    else l.col = 0; // full width
  }
  return twoCol;
}

/** Reading order: full-width lines split the page into bands; each band is left column then right. */
function readingOrder(lines) {
  lines.sort((a, b) => b.y - a.y);
  const out = [];
  let left = [], right = [];
  const flush = () => { out.push(...left, ...right); left = []; right = []; };
  for (const l of lines) {
    if (l.col === 0) { flush(); out.push(l); } else (l.col === 1 ? left : right).push(l);
  }
  flush();
  return out;
}

// ------------------------------------------------------------------ main entry

/**
 * Parses the PDF into {title, blocks, figures}. `onProgress(done, total)` is called per page.
 * Block types: title, h, p, fig, table, ref.
 */
export async function reflow(doc, onProgress = () => {}) {
  const pages = [];
  const sizeHist = new Map();
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const imgs = await imageBoxes(page);
    const tc = await page.getTextContent();
    const items = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const [a, b, c, d, e, f] = it.transform;
      const h = Math.hypot(c, d) || it.height || 10;
      if (Math.abs(b) > Math.abs(a) * 0.5) continue; // rotated text (margins, watermarks)
      const fi = fontInfo(page, it.fontName);
      items.push({ s: it.str, x: e, y: f, w: it.width, h, bold: fi.bold, italic: fi.italic });
      const k = Math.round(h * 2) / 2;
      sizeHist.set(k, (sizeHist.get(k) || 0) + it.str.length);
    }
    const clean = markSuperscripts(stripLineNumbers(items));
    const gutter = findGutter(clean, vp.width);
    pages.push({ n, page, vp, gutter, lines: buildLines(clean, gutter), imgs });
    onProgress(n, doc.numPages);
  }
  // Running heads and footers: margin lines whose text (ignoring numbers) repeats across pages,
  // plus bare page numbers.
  const norm = (t) => t.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
  const inMargin = (l, vp) => l.y > vp.height * 0.93 || l.y < vp.height * 0.06;
  const marginCount = new Map();
  for (const pg of pages) {
    for (const t of new Set(pg.lines.filter((l) => inMargin(l, pg.vp)).map((l) => norm(l.text)))) marginCount.set(t, (marginCount.get(t) || 0) + 1);
  }
  for (const pg of pages) {
    pg.lines = pg.lines.filter((l) => !(inMargin(l, pg.vp) && (/^(page\s*)?\d+(\s*of\s*\d+)?$/i.test(l.text) || (pages.length > 1 && marginCount.get(norm(l.text)) > 1))));
    pg.twoCol = assignColumns(pg.lines, pg.vp.width, pg.gutter);
    // Usual distance between lines (double-spaced manuscripts are twice the font size).
    const gaps = [];
    for (const c of [0, 1, 2]) {
      const ls = pg.lines.filter((l) => l.col === c).sort((a, b) => b.y - a.y);
      for (let i = 1; i < ls.length; i++) { const d = ls[i - 1].y - ls[i].y; if (d > ls[i].h * 0.5 && d < ls[i].h * 4) gaps.push(d / ls[i].h); }
    }
    gaps.sort((a, b) => a - b);
    pg.lead = gaps.length > 8 ? gaps[Math.floor(gaps.length / 2)] : 1.2;
  }
  const body = [...sizeHist.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 10;
  const maxSize = Math.max(...pages.flatMap((p) => p.lines.map((l) => l.size)), body);

  const blocks = [];
  const figures = [];
  let para = null;
  let prevLine = null;
  let title = '';
  const pushPara = () => { if (para && para.text.trim()) blocks.push(para); para = null; };
  const isHeading = (l) => {
    if (l.text.length > 120 || l.cells >= 2) return false;
    if (SECTION_WORDS.test(l.text) && l.text.length < 60 && (l.bold || l.size > body * 1.05 || l.text === l.text.toUpperCase())) return true;
    if (l.size >= body * 1.18 && l.text.length < 110) return true;
    if (l.bold && l.text.length < 80 && !/[.,;]$/.test(l.text) && !CAPTION.test(l.text)) return true;
    if (l.italic && l.text.length < 60 && /^[A-Z]/.test(l.text) && !/[.,;:]$/.test(l.text) && !CAPTION.test(l.text) && l.size >= body * 0.97) return true;
    return /^[A-Z][A-Z &\-,]{3,40}$/.test(l.text) && l.size >= body * 0.95;
  };

  for (const pg of pages) {
    const { page, vp, imgs } = pg;
    const mid = pg.gutter ?? vp.width / 2;
    const colOf = (b) => (!pg.twoCol ? 0 : b.x1 <= mid + 8 ? 1 : b.x0 >= mid - 8 ? 2 : 0);

    // Figure regions: images, plus the text-free space above a "Fig N" caption (vector charts).
    const regions = imgs.map((b) => ({ ...b, kind: 'fig', col: colOf(b) }));
    const lines = pg.lines;
    for (const cap of lines.filter((l) => FIG_CAPTION.test(l.text))) {
      const inCol = lines.filter((l) => (l.col === cap.col || l.col === 0 || cap.col === 0) && l.y > cap.y + cap.h);
      const above = inCol.sort((a, b) => a.y - b.y)[0];
      const top = above ? above.y - above.h * 0.3 : vp.height * 0.95;
      const bottom = cap.y + cap.h * 1.1;
      if (top - bottom > 60 && !regions.some((r) => r.y0 < top && r.y1 > bottom && r.x0 < cap.x1 && r.x1 > cap.x0)) {
        const x0 = cap.col === 2 ? mid : 20, x1 = cap.col === 1 ? mid : vp.width - 20;
        regions.push({ x0, x1, y0: bottom, y1: top, kind: 'fig', col: cap.col });
      }
    }
    // Table regions: from a "Table N" caption down through grid-like or short lines.
    const tableLines = new Set();
    for (let i = 0; i < lines.length; i++) {
      const cap = lines[i];
      if (!TABLE_CAPTION.test(cap.text)) continue;
      const below = lines.filter((l) => l !== cap && l.y < cap.y && (cap.col === 0 || l.col === cap.col || l.col === 0)).sort((a, b) => b.y - a.y);
      const colW = cap.col === 0 ? vp.width - 60 : mid - 40;
      const rows = [];
      let lastY = cap.y;
      for (const l of below) {
        const gridish = l.cells >= 1 || l.x1 - l.x0 < colW * 0.62 || l.size < body * 0.93;
        if (!gridish || lastY - l.y > l.h * 3.2) break;
        rows.push(l);
        lastY = l.y;
      }
      if (rows.length >= 2) {
        rows.forEach((r) => tableLines.add(r));
        const x0 = Math.min(...rows.map((r) => r.x0)), x1 = Math.max(...rows.map((r) => r.x1));
        regions.push({ x0: x0 - 4, x1: x1 + 4, y0: rows[rows.length - 1].y - rows[rows.length - 1].h * 0.6, y1: rows[0].y + rows[0].h * 1.2, kind: 'table', col: cap.col, cap });
      }
    }

    // Text inside a figure is part of the image; table text is replaced by the crop.
    const inside = (l, r) => l.y > r.y0 - 2 && l.y < r.y1 + 2 && l.x0 >= r.x0 - 4 && l.x1 <= r.x1 + 4;
    const textLines = lines.filter((l) => !tableLines.has(l) && !regions.some((r) => r.kind === 'fig' && inside(l, r) && !CAPTION.test(l.text)));

    // Crop regions from a rendered page.
    let canvas = null;
    const scale = 2.2;
    for (const r of regions) {
      if (!canvas) {
        const v = page.getViewport({ scale });
        canvas = document.createElement('canvas');
        canvas.width = Math.floor(v.width); canvas.height = Math.floor(v.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: v }).promise;
      }
      const pad = 4;
      const sx = Math.max(0, (r.x0 - pad) * scale), sy = Math.max(0, (vp.height - r.y1 - pad) * scale);
      const sw = Math.min(canvas.width - sx, (r.x1 - r.x0 + pad * 2) * scale), sh = Math.min(canvas.height - sy, (r.y1 - r.y0 + pad * 2) * scale);
      if (sw < 20 || sh < 20) continue;
      const c = document.createElement('canvas');
      c.width = sw; c.height = sh;
      c.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
      r.src = c.toDataURL(r.kind === 'table' ? 'image/png' : 'image/jpeg', 0.86);
      r.w = Math.round(sw); r.h = Math.round(sh);
      r.page = pg.n;
    }

    // Merge figure/table regions into the line stream as placeholders, then order.
    const stream = [...textLines, ...regions.filter((r) => r.src).map((r) => ({
      region: r, y: r.kind === 'table' ? (r.cap ? r.cap.y - 0.01 : r.y1) : r.y1, x0: r.x0, x1: r.x1, col: r.col, text: '', h: 0, size: 0,
    }))];
    const ordered = readingOrder(stream);

    for (const l of ordered) {
      if (l.region) {
        pushPara();
        const r = l.region;
        const id = `${r.kind}-${figures.length + 1}`;
        const fig = { id, kind: r.kind, src: r.src, w: r.w, h: r.h, page: r.page, label: '', caption: '' };
        figures.push(fig);
        blocks.push({ type: r.kind, id });
        prevLine = null;
        continue;
      }
      const t = l.text;
      const bigTitle = pg.n === 1 && l.size >= maxSize * 0.92 && l.size > body * 1.25 && blocks.filter((b) => b.type !== 'title').length < 6;
      // Manuscripts set the title in bold body-size type above everything else.
      const msTitle = pg.n === 1 && l.bold && t.length < 220 && !/\.$/.test(t) && !SECTION_WORDS.test(t) && (!blocks.length || (blocks.length && blocks.every((b) => b.type === 'title')));
      if (bigTitle || msTitle) {
        pushPara();
        const last = blocks[blocks.length - 1];
        if (last && last.type === 'title') last.text += ' ' + t; else blocks.push({ type: 'title', text: t });
        title = (title ? title + ' ' : '') + t;
        prevLine = l;
        continue;
      }
      if (CAPTION.test(t)) {
        pushPara();
        para = { type: 'caption', text: t, kind: TABLE_CAPTION.test(t) ? 'table' : 'fig', page: pg.n, size: l.size };
        prevLine = l;
        continue;
      }
      if (para && para.type === 'caption') {
        // Caption continues while the font stays small and lines stay close.
        if (l.size < body * 0.97 && prevLine && Math.abs(prevLine.y - l.y) < l.h * 2.2 && !isHeading(l)) {
          para.text = joinText(para.text, t);
          prevLine = l;
          continue;
        }
        pushPara();
      }
      if (isHeading(l)) {
        pushPara();
        const last = blocks[blocks.length - 1];
        if (last && last.type === 'h' && prevLine && prevLine.y - l.y < l.h * 1.8 && last.text.length < 80) last.text += ' ' + t;
        else blocks.push({ type: 'h', text: t, level: l.size >= body * 1.35 ? 2 : l.italic && !l.bold ? 4 : 3 });
        prevLine = l;
        continue;
      }
      const continues = para && para.type === 'p' && !/[.:?!]["”)]?$/.test(para.text) && /^[a-z(]/.test(t) && Math.abs(l.size - para.size) < body * 0.12;
      const listItem = /^(\[\d{1,3}\]|\d{1,3}\.)\s/.test(t) && prevLine && /[.\])]$/.test(prevLine.text);
      const newPara = listItem || !continues && (!para || !prevLine ||
        (prevLine.col === l.col && prevLine.y - l.y > Math.max(prevLine.h, l.h) * Math.max(1.75, pg.lead * 1.4)) ||
        /^[¹²³⁴⁵⁶⁷⁸⁹⁰*†‡§¶]/.test(t) ||
        Math.abs(l.size - para.size) > body * 0.12 ||
        (prevLine.col === l.col && l.x0 - prevLine.x0 > l.h * 0.8 && /[.:?!]["”)]?$/.test(prevLine.text)) ||
        (prevLine.col !== l.col && /[.:?!]["”)]?$/.test(para.text) && /^[A-Z0-9“"(]/.test(t) && l.x0 - colLeft(ordered, l) > l.h * 0.8));
      if (newPara) {
        pushPara();
        para = { type: 'p', text: t, size: l.size, small: l.size < body * 0.93 };
      } else {
        para.text = joinText(para.text, t);
      }
      prevLine = l;
    }
    if (para && para.type !== 'p') pushPara();
    // Free the page's memory.
    page.cleanup();
  }
  pushPara();

  // Link each caption to the closest figure/table block of its kind (tables: usually after the
  // caption; figures: usually before it).
  const byId = new Map(figures.map((f) => [f.id, f]));
  blocks.forEach((b, i) => {
    if (b.type !== 'caption') return;
    const order = b.kind === 'table' ? [1, -1, 2, -2, 3, -3] : [-1, 1, -2, 2, -3, 3];
    for (const d of order) {
      const o = blocks[i + d];
      const f = o && byId.get(o.id);
      if (f && f.kind === b.kind && !f.claimed && f.page === b.page) { f.claimed = true; b.fig = f.id; return; }
    }
    for (const d of order) {
      const o = blocks[i + d];
      const f = o && byId.get(o.id);
      if (f && !f.claimed && f.page === b.page) { f.claimed = true; b.fig = f.id; return; }
    }
  });
  // Captions → figure labels; drop caption blocks that were attached.
  for (const b of blocks) {
    if (b.type === 'caption' && b.fig) {
      const f = figures.find((x) => x.id === b.fig);
      const m = b.text.match(CAPTION);
      f.label = m ? m[0].replace(/\.$/, '') : '';
      f.caption = b.text.slice(m ? m[0].length : 0).replace(/^[.:\s]+/, '');
      b.type = 'skip';
    }
  }
  // Figures that never got a caption and are small are likely logos.
  const keep = new Set(figures.filter((f) => f.caption || f.w * f.h > 250 * 250).map((f) => f.id));
  let figN = 0, tabN = 0;
  for (const f of figures) {
    if (!keep.has(f.id)) continue;
    if (!f.label) f.label = f.kind === 'table' ? `Table ${++tabN}` : `Figure ${++figN}`;
  }
  const out = blocks.filter((b) => b.type !== 'skip' && (!(b.type === 'fig' || b.type === 'table') || keep.has(b.id)));
  // Unattached captions become plain small paragraphs.
  out.forEach((b) => { if (b.type === 'caption') { b.type = 'p'; b.small = true; } });
  // Paragraphs after a References heading are the reference list.
  let inRefs = false;
  for (const b of out) {
    if (b.type === 'h') inRefs = /^references|^bibliography|^literature cited/i.test(b.text);
    else if (inRefs && b.type === 'p') b.type = 'ref';
  }
  const chars = out.reduce((n, b) => n + (b.text ? b.text.length : 0), 0);
  return {
    title: title || '',
    blocks: out,
    figures: figures.filter((f) => keep.has(f.id)),
    pages: doc.numPages,
    scanned: chars < 400 * doc.numPages * 0.25,
  };
}

function colLeft(lines, l) {
  const same = lines.filter((x) => x.col === l.col && !x.region);
  return same.length ? Math.min(...same.map((x) => x.x0)) : l.x0;
}

function joinText(a, b) {
  if (/[A-Za-z]-$/.test(a) && /^[a-z]/.test(b)) return a.slice(0, -1) + b;
  return a + ' ' + b;
}
