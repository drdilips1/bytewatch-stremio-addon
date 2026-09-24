'use strict';
/* Whole-document tools: Convert, Compress, Protect/Unlock, Read, Print, plus the home-screen grid. */

// ------------------------------------------------------------------ home grid
function withDoc(fn) {
  if (S.pages.length) { fn(); return; }
  pendingAction = fn;
  pickFile('#filePdf');
}

function homeTool(key) {
  pendingAction = null;
  switch (key) {
    case 'edit': withDoc(() => setTool('edittext')); break;
    case 'annotate': withDoc(() => setTool('highlight')); break;
    case 'organize': withDoc(openPagesPanel); break;
    case 'sign': withDoc(openSignature); break;
    case 'ocr': withDoc(openOcr); break;
    case 'convert': openConvert(); break;
    case 'compress': withDoc(openCompress); break;
    case 'protect': withDoc(openProtect); break;
    case 'read': withDoc(enterReading); break;
    case 'print': withDoc(printDoc); break;
    case 'merge': pickFile('#fileMerge'); break;
    case 'images': pickFile('#fileImagesPages'); break;
    case 'blank': newBlankDoc(); break;
  }
}

function baseName() {
  return S.name.replace(/\.pdf$/i, '') || 'document';
}

function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

// ------------------------------------------------------------------ option sheet
function showOptions(title, html) {
  finishEditing();
  $('#optTitle').textContent = title;
  $('#optBody').innerHTML = html;
  applyIcons($('#optBody'));
  $('#optModal').hidden = false;
}

function closeOptions() { $('#optModal').hidden = true; }

function optButton(action, icon, title, desc) {
  return `<button class="opt" data-opt="${action}"><span data-icon="${icon}"></span><span><b>${title}</b><span class="d">${desc}</span></span></button>`;
}

function bindOptions(handlers) {
  $$('#optBody [data-opt]').forEach(b => {
    b.onclick = () => { const h = handlers[b.dataset.opt]; if (h) h(); };
  });
}

// The current document with all edits applied, opened in pdf.js.
async function renderedDoc() {
  const { bytes } = await buildPdf(S.pages, true);
  return loadPdfJs(bytes);
}

function canvasToBytes(canvas, type, quality) {
  return new Promise((res, rej) => canvas.toBlob(b => {
    if (!b) { rej(new Error('image encoding failed')); return; }
    b.arrayBuffer().then(buf => res(new Uint8Array(buf)), rej);
  }, type, quality));
}

async function renderPageToCanvas(pdf, n, dpi) {
  const page = await pdf.getPage(n);
  let scale = dpi / 72;
  const vp1 = page.getViewport({ scale: 1 });
  const maxPx = 15e6;  // iOS Safari refuses canvases above ~16.7 MP
  if (vp1.width * vp1.height * scale * scale > maxPx) scale = Math.sqrt(maxPx / (vp1.width * vp1.height));
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas');
  c.width = Math.round(vp.width);
  c.height = Math.round(vp.height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return { canvas: c, width: vp1.width, height: vp1.height };
}

// ------------------------------------------------------------------ Convert
function openConvert() {
  const hasDoc = S.pages.length > 0;
  showOptions('Convert', `<div class="opt-list">
    ${optButton('jpg', 'image', 'PDF to JPG', 'Each page as a JPG picture (several pages → ZIP)')}
    ${optButton('png', 'image', 'PDF to PNG', 'Lossless page images (several pages → ZIP)')}
    ${optButton('docx', 'convert', 'PDF to Word (.docx)', 'Editable text; pages without text are added as pictures')}
    ${optButton('txt', 'text', 'PDF to Text (.txt)', 'Plain text of every page')}
    ${optButton('img2pdf', 'blank', 'Images to PDF', hasDoc ? 'Add photos as new pages of this PDF' : 'Make a PDF from photos')}
  </div>`);
  const need = fn => () => { closeOptions(); withDoc(fn); };
  bindOptions({
    jpg: need(() => convertToImages('jpg')),
    png: need(() => convertToImages('png')),
    docx: need(convertToDocx),
    txt: need(convertToText),
    img2pdf: () => { closeOptions(); pickFile('#fileImagesPages'); }
  });
}

async function convertToImages(fmt) {
  busy(true, 'Converting…');
  try {
    const pdf = await renderedDoc();
    const files = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      busy(true, `Converting page ${i} of ${pdf.numPages}…`);
      const { canvas } = await renderPageToCanvas(pdf, i, 150);
      const data = await canvasToBytes(canvas, fmt === 'png' ? 'image/png' : 'image/jpeg', 0.9);
      files.push({ name: `${baseName()}_page${String(i).padStart(pdf.numPages >= 100 ? 3 : 2, '0')}.${fmt}`, data });
      canvas.width = canvas.height = 0;
    }
    pdf.destroy();
    if (files.length === 1) await saveBytes(files[0].data, files[0].name, 'save');
    else await saveBytes(makeZip(files), `${baseName()}_${fmt}.zip`, 'save');
  } catch (e) {
    busy(false);
    toast('Convert failed: ' + (e.message || e), 5000);
  }
}

// Areas where original text was whited out / replaced on an editor page, in frame points,
// plus the text the user typed there (which must be kept).
function coveredAreas(p) {
  const rects = [], typed = new Map(); // typed line -> how many times it may still appear
  if (!p) return { rects, typed };
  for (const a of p.annots) {
    if (a.type === 'whiteout') rects.push(a);
    if (a.type === 'text') {
      if (a.cover) rects.push(a.cover);
      (a.text || '').split('\n').forEach(l => { if (l.trim()) typed.set(l.trim(), (typed.get(l.trim()) || 0) + 1); });
    }
  }
  return { rects, typed };
}

// Text lines per page, with the largest font size seen on each line.
// `p` is the editor page it came from: text hidden under whiteout is dropped.
async function extractLines(pdf, n, p) {
  const page = await pdf.getPage(n);
  const tc = await page.getTextContent();
  const { rects, typed } = coveredAreas(p);
  const vp = p ? page.getViewport({ scale: 1, rotation: (page.rotate - p.ru + 360) % 360 }) : null;
  const hidden = it => {
    const t = it.str.trim();
    if (!rects.length || !t) return false;
    const tx = pdfjsLib.Util.transform(vp.transform, it.transform);
    const size = Math.hypot(tx[2], tx[3]);
    const x = tx[4] + it.width / 2, y = tx[5] - size * 0.35;
    if (!rects.some(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)) return false;
    // Covered: keep it only as the (single) copy of what the user typed there.
    const left = typed.get(t) || 0;
    if (left > 0) { typed.set(t, left - 1); return false; }
    return true;
  };
  const lines = [];
  let cur = { text: '', size: 0 };
  for (const it of tc.items) {
    if (it.str && !hidden(it)) {
      cur.text += it.str;
      cur.size = Math.max(cur.size, Math.hypot(it.transform[2], it.transform[3]));
    }
    if (it.hasEOL) { lines.push(cur); cur = { text: '', size: 0 }; }
  }
  if (cur.text) lines.push(cur);
  return lines.filter((l, i) => l.text.trim() || (i > 0 && lines[i - 1].text.trim()));
}

async function convertToText() {
  busy(true, 'Extracting text…');
  try {
    const pdf = await renderedDoc();
    let out = '';
    let any = false;
    for (let i = 1; i <= pdf.numPages; i++) {
      const lines = await extractLines(pdf, i, S.pages[i - 1]);
      if (lines.some(l => l.text.trim())) any = true;
      if (pdf.numPages > 1) out += (i > 1 ? '\n\n' : '') + `----- Page ${i} -----\n`;
      out += lines.map(l => l.text).join('\n');
    }
    pdf.destroy();
    if (!any) toast('No text found — this looks like a scanned PDF', 4000);
    await saveBytes(new TextEncoder().encode(out), baseName() + '.txt', 'save');
  } catch (e) {
    busy(false);
    toast('Convert failed: ' + (e.message || e), 5000);
  }
}

function xmlEsc(s) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    // XML 1.0 forbids most control characters.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

async function convertToDocx() {
  busy(true, 'Converting to Word…');
  try {
    const pdf = await renderedDoc();
    const body = [];
    const media = [];
    const PAGE_W = 11906, PAGE_H = 16838, MARGIN = 1134;   // A4 in twips, 2 cm margins
    const EMU_PER_TWIP = 635;
    const maxW = (PAGE_W - 2 * MARGIN) * EMU_PER_TWIP, maxH = (PAGE_H - 2 * MARGIN) * EMU_PER_TWIP;
    for (let i = 1; i <= pdf.numPages; i++) {
      busy(true, `Converting page ${i} of ${pdf.numPages}…`);
      if (i > 1) body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
      const lines = await extractLines(pdf, i, S.pages[i - 1]);
      if (lines.some(l => l.text.trim())) {
        for (const l of lines) {
          const sz = Math.max(12, Math.min(96, Math.round((l.size || 11) * 2)));
          body.push(`<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>` +
            (l.text ? `<w:r><w:rPr><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr><w:t xml:space="preserve">${xmlEsc(l.text)}</w:t></w:r>` : '') +
            `</w:p>`);
        }
      } else {
        // Scanned page: keep it as a picture so nothing is lost.
        const { canvas, width, height } = await renderPageToCanvas(pdf, i, 150);
        const data = await canvasToBytes(canvas, 'image/jpeg', 0.85);
        canvas.width = canvas.height = 0;
        const id = media.length + 1;
        media.push({ name: `word/media/image${id}.jpg`, data });
        let cx = maxW, cy = Math.round(maxW * height / width);
        if (cy > maxH) { cy = maxH; cx = Math.round(maxH * width / height); }
        body.push(`<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
          `<wp:docPr id="${id}" name="Page ${i}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
          `<pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="image${id}.jpg"/><pic:cNvPicPr/></pic:nvPicPr>` +
          `<pic:blipFill><a:blip r:embed="rImg${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
          `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
          `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`);
      }
    }
    pdf.destroy();
    const enc = s => new TextEncoder().encode(s);
    const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="${PAGE_W}" w:h="${PAGE_H}"/><w:pgMar w:top="${MARGIN}" w:right="${MARGIN}" w:bottom="${MARGIN}" w:left="${MARGIN}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>`;
    const files = [
      { name: '[Content_Types].xml', data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`) },
      { name: '_rels/.rels', data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`) },
      { name: 'word/_rels/document.xml.rels', data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${media.map((m, j) => `<Relationship Id="rImg${j + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${j + 1}.jpg"/>`).join('')}</Relationships>`) },
      { name: 'word/document.xml', data: enc(docXml) },
      ...media
    ];
    await saveBytes(makeZip(files), baseName() + '.docx', 'save');
  } catch (e) {
    busy(false);
    toast('Convert failed: ' + (e.message || e), 5000);
  }
}

// ------------------------------------------------------------------ ZIP (stored, no compression)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function makeZip(files) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  const d = new Date();
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, 0, true); lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, f.data.length, true); lh.setUint32(22, f.data.length, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, f.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true); ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, f.data.length, true); ch.setUint32(24, f.data.length, true);
    ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let pos = 0;
  for (const p of all) { out.set(p, pos); pos += p.length; }
  return out;
}

// ------------------------------------------------------------------ Compress
function openCompress() {
  showOptions('Compress PDF', `<div class="opt-list">
    ${optButton('medium', 'compress', 'Recommended', 'Shrinks photos/scans to ~150 dpi. Text stays sharp and selectable.')}
    ${optButton('high', 'compress', 'Strong', 'Smaller photos (~100 dpi, lower quality). Text stays selectable.')}
    ${optButton('extreme', 'compress', 'Extreme', 'Every page becomes a compact image. Smallest file, text no longer selectable.')}
  </div>`);
  bindOptions({
    medium: () => compressDoc({ maxDim: 1600, quality: 0.72 }),
    high: () => compressDoc({ maxDim: 1100, quality: 0.5 }),
    extreme: () => compressDoc({ raster: true, dpi: 96, quality: 0.55 })
  });
}

async function inflate(bytes) {
  const ds = new DecompressionStream('deflate');
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(buf);
}

// Undo PNG row predictors (PDF /Predictor >= 10) for 8-bit samples.
function unpredictPng(data, bpp, width) {
  const rowLen = bpp * width;
  const rows = Math.floor(data.length / (rowLen + 1));
  const out = new Uint8Array(rows * rowLen);
  for (let r = 0; r < rows; r++) {
    const type = data[r * (rowLen + 1)];
    const src = r * (rowLen + 1) + 1, dst = r * rowLen, prev = dst - rowLen;
    for (let i = 0; i < rowLen; i++) {
      const x = data[src + i];
      const a = i >= bpp ? out[dst + i - bpp] : 0;
      const b = r > 0 ? out[prev + i] : 0;
      const c = r > 0 && i >= bpp ? out[prev + i - bpp] : 0;
      let v;
      switch (type) {
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break; }
        default: v = x;
      }
      out[dst + i] = v & 255;
    }
  }
  return out;
}

function imageComponents(doc, csObj) {
  const { PDFName, PDFArray } = PDFLib;
  const cs = csObj instanceof PDFArray ? csObj : null;
  const name = csObj instanceof PDFName ? csObj.toString() : null;
  if (name === '/DeviceRGB' || name === '/CalRGB') return 3;
  if (name === '/DeviceGray' || name === '/CalGray') return 1;
  if (cs && cs.size() >= 2 && String(cs.get(0)) === '/ICCBased') {
    const icc = doc.context.lookup(cs.get(1));
    const n = icc && icc.dict && icc.dict.lookup(PDFName.of('N'));
    return n ? n.asNumber() : 0;
  }
  return 0;
}

async function recompressImages(doc, maxDim, quality) {
  const { PDFName, PDFArray, PDFRawStream } = PDFLib;
  const N = k => PDFName.of(k);
  let changed = 0;
  const objs = doc.context.enumerateIndirectObjects();
  for (const [ref, obj] of objs) {
    if (!(obj instanceof PDFRawStream)) continue;
    const d = obj.dict;
    if (String(d.get(N('Subtype'))) !== '/Image') continue;
    if (d.get(N('ImageMask')) && String(d.get(N('ImageMask'))) === 'true') continue;
    if (d.get(N('Decode'))) continue;
    let filter = d.lookup(N('Filter'));
    if (filter instanceof PDFArray) filter = filter.size() === 1 ? filter.get(0) : null;
    const fname = filter ? filter.toString() : '';
    const w = d.lookup(N('Width')).asNumber(), h = d.lookup(N('Height')).asNumber();
    const bpcObj = d.lookup(N('BitsPerComponent'));
    const bpc = bpcObj ? bpcObj.asNumber() : 8;
    const comps = imageComponents(doc, d.lookup(N('ColorSpace')));
    const raw = obj.contents;
    if (raw.length < 30000 || w * h > 40e6 || (comps !== 1 && comps !== 3)) continue;
    let source;
    try {
      if (fname === '/DCTDecode') {
        source = await createImageBitmap(new Blob([raw], { type: 'image/jpeg' }));
      } else if (fname === '/FlateDecode' && bpc === 8) {
        let px = await inflate(raw);
        const parms = d.lookup(N('DecodeParms'));
        const pred = parms && parms.lookup ? parms.lookup(N('Predictor')) : null;
        const predictor = pred ? pred.asNumber() : 1;
        if (predictor >= 10) px = unpredictPng(px, comps, w);
        else if (predictor !== 1) continue;
        if (px.length < w * h * comps) continue;
        const rgba = new ImageData(w, h);
        for (let i = 0, j = 0; i < w * h; i++, j += comps) {
          const o = i * 4;
          if (comps === 3) { rgba.data[o] = px[j]; rgba.data[o + 1] = px[j + 1]; rgba.data[o + 2] = px[j + 2]; }
          else { rgba.data[o] = rgba.data[o + 1] = rgba.data[o + 2] = px[j]; }
          rgba.data[o + 3] = 255;
        }
        source = await createImageBitmap(rgba);
      } else continue;
    } catch (e) { continue; }
    const k = Math.min(1, maxDim / Math.max(w, h));
    const nw = Math.max(1, Math.round(w * k)), nh = Math.max(1, Math.round(h * k));
    const c = document.createElement('canvas');
    c.width = nw; c.height = nh;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, nw, nh);
    ctx.drawImage(source, 0, 0, nw, nh);
    if (source.close) source.close();
    const jpg = await canvasToBytes(c, 'image/jpeg', quality);
    c.width = c.height = 0;
    if (jpg.length > raw.length * 0.9) continue;
    const nd = doc.context.obj({
      Type: 'XObject', Subtype: 'Image', Width: nw, Height: nh,
      ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode', Length: jpg.length
    });
    const smask = d.get(N('SMask'));
    if (smask) nd.set(N('SMask'), smask);
    doc.context.assign(ref, PDFRawStream.of(nd, jpg));
    changed++;
  }
  return changed;
}

async function compressDoc(opt) {
  closeOptions();
  finishEditing();
  busy(true, 'Compressing…');
  try {
    const { bytes } = await buildPdf(S.pages, false);
    let out;
    if (opt.raster) {
      const pdf = await loadPdfJs(bytes);
      const doc = await PDFDocument.create();
      for (let i = 1; i <= pdf.numPages; i++) {
        busy(true, `Compressing page ${i} of ${pdf.numPages}…`);
        const { canvas, width, height } = await renderPageToCanvas(pdf, i, opt.dpi);
        const img = await doc.embedJpg(await canvasToBytes(canvas, 'image/jpeg', opt.quality));
        canvas.width = canvas.height = 0;
        doc.addPage([width, height]).drawImage(img, { x: 0, y: 0, width, height });
      }
      pdf.destroy();
      out = await doc.save({ useObjectStreams: true });
    } else {
      const doc = await PDFDocument.load(bytes, { updateMetadata: false });
      await recompressImages(doc, opt.maxDim, opt.quality);
      out = await doc.save({ useObjectStreams: true });
    }
    busy(false);
    const orig = S.sources.length === 1 && S.pages.every(p => p.src === 0) ? S.sources[0].bytes.length : bytes.length;
    if (out.length >= orig * 0.98) {
      const ok = await dialog({
        title: 'Already compact',
        body: `This PDF is ${fmtSize(orig)} and can't be made much smaller with this level` +
          (opt.raster ? '.' : '. Try "Extreme" for scanned documents.'),
        ok: 'Save anyway'
      });
      if (!ok) return;
    } else {
      const pct = Math.round((1 - out.length / orig) * 100);
      const ok = await dialog({ title: 'Compressed', body: `${fmtSize(orig)} → ${fmtSize(out.length)} (${pct}% smaller)`, ok: 'Save' });
      if (!ok) return;
    }
    await saveBytes(out, baseName() + '_compressed.pdf', 'save');
  } catch (e) {
    console.error(e);
    busy(false);
    toast('Compress failed: ' + (e.message || e), 5000);
  }
}

// ------------------------------------------------------------------ Protect / Unlock
function openProtect() {
  const wasLocked = S.sources.some(s => s.pdf._password);
  showOptions('Protect PDF', `<div class="opt-form">
    <input type="password" id="pw1" placeholder="Password" autocomplete="new-password">
    <input type="password" id="pw2" placeholder="Repeat password" autocomplete="new-password">
    <label class="check"><input type="checkbox" id="pwShow"> Show password</label>
    <label class="check"><input type="checkbox" id="pwRestrict"> Also block editing &amp; copying (viewing and printing allowed)</label>
    <button class="chip primary" id="pwGo"><span data-icon="lock"></span>Protect &amp; save</button>
    <div class="opt-note">Uses AES-256 encryption. Anyone opening the file will need this password.</div>
    <hr style="border:0;border-top:1px solid var(--line);width:100%">
    <div class="opt-note">${wasLocked ? 'This PDF was password protected.' : 'Remove a password or editing/printing restrictions:'}</div>
    <button class="chip" id="pwUnlock"><span data-icon="open"></span>Save without password (unlock)</button>
  </div>`);
  $('#pwShow').onchange = e => { $('#pw1').type = $('#pw2').type = e.target.checked ? 'text' : 'password'; };
  $('#pwGo').onclick = () => {
    const a = $('#pw1').value, b = $('#pw2').value;
    if (!a) { toast('Enter a password'); return; }
    if (a !== b) { toast('Passwords do not match'); return; }
    protectDoc(a, $('#pwRestrict').checked);
  };
  $('#pwUnlock').onclick = () => {
    closeOptions();
    exportAndSave(S.pages, baseName() + '_unlocked.pdf', 'save');
  };
}

function randomPassword() {
  const a = new Uint8Array(18);
  crypto.getRandomValues(a);
  return Array.from(a, x => x.toString(16).padStart(2, '0')).join('');
}

async function protectDoc(password, restrict) {
  closeOptions();
  finishEditing();
  busy(true, 'Encrypting…');
  try {
    const { bytes } = await buildPdf(S.pages, false);
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    doc.encrypt({
      userPassword: password,
      ownerPassword: restrict ? randomPassword() : password,
      permissions: restrict
        ? { printing: 'highResolution', modifying: false, copying: false, annotating: false, fillingForms: true, contentAccessibility: true, documentAssembly: false }
        : { printing: 'highResolution', modifying: true, copying: true, annotating: true, fillingForms: true, contentAccessibility: true, documentAssembly: true }
    });
    const out = await doc.save();
    await saveBytes(out, baseName() + '_protected.pdf', 'save');
  } catch (e) {
    console.error(e);
    busy(false);
    toast('Protect failed: ' + (e.message || e), 5000);
  }
}

// ------------------------------------------------------------------ Read mode
function enterReading() {
  finishEditing();
  setTool('select');
  S.selected = null;
  document.body.classList.add('reading');
  $('#readBar').hidden = false;
  try { if (localStorage.getItem('night') === '1') document.body.classList.add('night'); } catch (e) { /* ignore */ }
  layoutPages();
  renderAllLayers();
  updateReadPage();
}

function exitReading() {
  document.body.classList.remove('reading', 'night');
  $('#readBar').hidden = true;
  layoutPages();
  renderAllLayers();
  updatePropbar();
}

function updateReadPage() {
  if (!document.body.classList.contains('reading')) return;
  const p = currentPage();
  $('#readPage').textContent = p ? `${S.pages.indexOf(p) + 1} / ${S.pages.length}` : '';
}

// ------------------------------------------------------------------ Print
async function printDoc() {
  finishEditing();
  busy(true, 'Preparing to print…');
  try {
    const { bytes } = await buildPdf(S.pages, false);
    await saveBytes(bytes, S.name.toLowerCase().endsWith('.pdf') ? S.name : S.name + '.pdf', 'print');
  } catch (e) {
    busy(false);
    toast('Print failed: ' + (e.message || e), 5000);
  }
}

// ------------------------------------------------------------------ wiring
(function initTools() {
  $('#optCancel').onclick = closeOptions;
  $('#readExit').onclick = exitReading;
  $('#readNight').onclick = () => {
    const on = document.body.classList.toggle('night');
    try { localStorage.setItem('night', on ? '1' : '0'); } catch (e) { /* ignore */ }
  };
  $('#readGoto').onclick = async () => {
    const v = await dialog({ title: 'Go to page', body: `1 – ${S.pages.length}`, input: { type: 'number', value: '' } });
    const n = parseInt(v, 10);
    if (n >= 1 && n <= S.pages.length) scrollToPage(S.pages[n - 1]);
  };
  $('#viewer').addEventListener('scroll', () => {
    clearTimeout(updateReadPage._t);
    updateReadPage._t = setTimeout(updateReadPage, 80);
  }, { passive: true });
  $('#homeOpen').addEventListener('click', () => { pendingAction = null; }, true);
})();
