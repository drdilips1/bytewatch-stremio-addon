'use strict';
/*
 * Offline PDF editor.
 *  - pdf.js renders pages; pdf-lib writes the edited PDF.
 *  - Every page has a "frame" (F0): the page as originally displayed (its own
 *    /Rotate applied), measured in PDF points with y pointing down. All
 *    annotations are stored in F0 points, so user rotation (ru) never moves them.
 */

pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
const {
  PDFDocument, StandardFonts, rgb, degrees, LineCapStyle, BlendMode,
  pushGraphicsState, popGraphicsState, concatTransformationMatrix,
  PDFTextField, PDFCheckBox, PDFDropdown, PDFOptionList, PDFRadioGroup
} = PDFLib;

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const hasBridge = typeof window.AndroidBridge !== 'undefined';
const TEXT_ASC = 0.94;   // baseline offset (× font size) inside a 1.2 line box
const LINE_H = 1.2;

// ------------------------------------------------------------------ state
const S = {
  name: 'document.pdf',
  sources: [],          // {bytes: Uint8Array, pdf: PDFDocumentProxy, name}
  pages: [],            // {id, src, idx, view:[x0,y0,x1,y1], r0, ru, annots:[]}
  images: {},           // id -> {url, w, h, mime}
  zoom: 1,
  tool: 'select',
  selected: null,       // {pageId, id}
  editing: null,        // {pageId, id, isNew}
  temp: null,           // {pageId, annot} while drawing
  dirty: false,
  undo: [],
  redo: []
};

const TOOL_DEFAULTS = {
  text: { color: '#000000', size: 14, font: 'Helvetica', bold: false, italic: false, bg: false },
  edittext: { color: '#000000', size: 12, font: 'Helvetica', bold: false, italic: false, bg: false },
  date: { color: '#000000', size: 12, font: 'Helvetica', bold: false, italic: false, bg: false },
  draw: { color: '#1a3fb8', width: 2 },
  highlight: { color: '#ffeb3b', width: 14 },
  whiteout: { color: '#ffffff' },
  rect: { color: '#d93025', width: 2, fill: false },
  ellipse: { color: '#d93025', width: 2, fill: false },
  line: { color: '#d93025', width: 2 },
  arrow: { color: '#d93025', width: 2 },
  check: { color: '#188038', size: 18 },
  cross: { color: '#d93025', size: 18 }
};
const PALETTE = ['#000000', '#5f6368', '#ffffff', '#d93025', '#f29900', '#ffeb3b', '#188038', '#1a73e8', '#1a3fb8', '#9334e6'];

// Fonts. The three PDF standard fonts need no embedding; the others are bundled
// TTFs (lib/fonts) used both on screen (@font-face) and embedded into the PDF.
const FONTS = {
  Helvetica: { label: 'Sans (Helvetica)', css: 'Helvetica, Arial, "Liberation Sans", Roboto, sans-serif', std: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'] },
  Times: { label: 'Serif (Times)', css: '"Times New Roman", Times, "Liberation Serif", "Noto Serif", serif', std: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'] },
  Courier: { label: 'Mono (Courier)', css: '"Courier New", Courier, "Liberation Mono", monospace', std: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'] },
  Roboto: { label: 'Roboto', files: ['Roboto_400Regular', 'Roboto_700Bold', 'Roboto_400Regular_Italic', 'Roboto_700Bold_Italic'] },
  OpenSans: { label: 'Open Sans', files: ['OpenSans_400Regular', 'OpenSans_700Bold', 'OpenSans_400Regular_Italic', 'OpenSans_700Bold_Italic'] },
  Lato: { label: 'Lato', files: ['Lato_400Regular', 'Lato_700Bold', 'Lato_400Regular_Italic', 'Lato_700Bold_Italic'] },
  Dancing: { label: 'Handwriting', files: ['DancingScript_400Regular', 'DancingScript_700Bold', null, null] },
  Devanagari: { label: 'हिन्दी (Devanagari)', files: ['NotoSansDevanagari_400Regular', 'NotoSansDevanagari_700Bold', null, null] }
};
for (const [k, f] of Object.entries(FONTS)) if (f.files) f.css = `"PE-${k}", ${k === 'Dancing' ? 'cursive' : 'sans-serif'}`;
const CSS_FONTS = Object.fromEntries(Object.entries(FONTS).map(([k, f]) => [k, f.css]));

// Index into FONTS[x].files / .std for a style; custom fonts without an italic file
// use the upright file and a synthetic slant.
function fontVariant(a) { return (a.bold ? 1 : 0) + (a.italic ? 2 : 0); }

function installFontFaces() {
  const css = [];
  for (const [k, f] of Object.entries(FONTS)) {
    if (!f.files) continue;
    f.files.forEach((file, i) => {
      if (!file) return;
      css.push(`@font-face{font-family:"PE-${k}";src:url("lib/fonts/${file}.ttf") format("truetype");` +
        `font-weight:${i & 1 ? 700 : 400};font-style:${i & 2 ? 'italic' : 'normal'};font-display:block}`);
    });
  }
  const st = document.createElement('style');
  st.textContent = css.join('\n');
  document.head.appendChild(st);
  // Load them up front so text measurement uses the real metrics.
  const loads = [];
  for (const [k, f] of Object.entries(FONTS)) {
    if (!f.files) continue;
    f.files.forEach((file, i) => { if (file) loads.push(document.fonts.load(`${i & 2 ? 'italic ' : ''}${i & 1 ? 'bold ' : ''}20px "PE-${k}"`)); });
  }
  Promise.all(loads).then(() => { if (S.pages.length) renderAllLayers(); }).catch(() => {});
}

let uidCounter = 1;
const uid = () => 'a' + (Date.now() % 1e8).toString(36) + (uidCounter++).toString(36);

// ------------------------------------------------------------------ helpers
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, ms);
}

// Full-screen progress overlay. Pass onCancel to show a Cancel button (kept until busy(false)).
function busy(on, text, onCancel) {
  $('#busy').hidden = !on;
  if (text) $('#busyText').textContent = text;
  if (!on) busy.cancel = null;
  else if (onCancel) busy.cancel = onCancel;
  $('#busyCancel').hidden = !busy.cancel;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function frameSize(p) {
  const w = p.view[2] - p.view[0], h = p.view[3] - p.view[1];
  return p.r0 % 180 === 0 ? { W: w, H: h } : { W: h, H: w };
}

function displaySize(p) {
  const { W, H } = frameSize(p);
  return p.ru % 180 === 0 ? { W, H } : { W: H, H: W };
}

function pageById(id) { return S.pages.find(p => p.id === id); }
function annotById(p, id) { return p && p.annots.find(a => a.id === id); }

function readFileAsArrayBuffer(file) {
  return file.arrayBuffer ? file.arrayBuffer() : new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsArrayBuffer(file);
  });
}

function readFileAsDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}

function loadImage(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('Unsupported image'));
    img.src = url;
  });
}

function dataUrlToBytes(url) {
  const b64 = url.slice(url.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  }
  return btoa(s);
}

// ------------------------------------------------------------------ dialogs
function dialog({ title, body = '', input = null, ok = 'OK', cancel = 'Cancel', onOk = null }) {
  return new Promise(resolve => {
    $('#dlgTitle').textContent = title;
    $('#dlgBody').textContent = body;
    const inp = $('#dlgInput');
    inp.hidden = input === null;
    if (input !== null) { inp.value = input.value || ''; inp.type = input.type || 'text'; }
    $('#dlgOk').textContent = ok;
    $('#dlgCancel').textContent = cancel;
    $('#dlgCancel').hidden = cancel === null;
    $('#dialog').hidden = false;
    if (input !== null) setTimeout(() => { inp.focus(); inp.select(); }, 50);
    const done = v => {
      $('#dialog').hidden = true;
      $('#dlgOk').onclick = $('#dlgCancel').onclick = null;
      dialog.cancel = null;
      resolve(v);
    };
    dialog.cancel = () => done(null);
    $('#dlgOk').onclick = () => { if (onOk) onOk(); done(input !== null ? inp.value : true); };
    $('#dlgCancel').onclick = () => done(null);
    inp.onkeydown = e => { if (e.key === 'Enter') $('#dlgOk').click(); };
  });
}

// ------------------------------------------------------------------ history
function checkpoint() {
  S.undo.push(JSON.stringify(S.pages));
  if (S.undo.length > 60) S.undo.shift();
  S.redo = [];
  S.dirty = true;
  updateUndoButtons();
}

function undo() {
  finishEditing();
  if (!S.undo.length) return;
  S.redo.push(JSON.stringify(S.pages));
  S.pages = JSON.parse(S.undo.pop());
  S.selected = null;
  S.dirty = true;
  afterStructureChange();
}

function redo() {
  finishEditing();
  if (!S.redo.length) return;
  S.undo.push(JSON.stringify(S.pages));
  S.pages = JSON.parse(S.redo.pop());
  S.selected = null;
  S.dirty = true;
  afterStructureChange();
}

function updateUndoButtons() {
  $('#btnUndo').disabled = !S.undo.length;
  $('#btnRedo').disabled = !S.redo.length;
}

// ------------------------------------------------------------------ loading documents
async function loadPdfJs(bytes) {
  const task = pdfjsLib.getDocument({
    data: bytes.slice(),
    cMapUrl: 'lib/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: 'lib/standard_fonts/',
    fontExtraProperties: true,
    isEvalSupported: false
  });
  let password = '';
  task.onPassword = async (update, reason) => {
    const pw = await dialog({
      title: 'Password required',
      body: reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD ? 'Wrong password, try again.' : 'This PDF is password protected.',
      input: { type: 'password' }
    });
    if (pw === null) task.destroy(); else update(password = pw);
  };
  const pdf = await task.promise;
  pdf._password = password;
  return pdf;
}

// pdf-lib copy of a source, decrypting it with the password used to open it.
function libLoad(si) {
  const src = S.sources[si];
  return PDFDocument.load(src.bytes, { updateMetadata: false, password: src.pdf._password || '' });
}

async function addSource(bytes, name) {
  const pdf = await loadPdfJs(bytes);
  const si = S.sources.length;
  S.sources.push({ bytes, pdf, name, lib: undefined });
  const pages = [];
  for (let i = 0; i < pdf.numPages; i++) {
    const pg = await pdf.getPage(i + 1);
    pages.push({ id: uid(), src: si, idx: i, view: pg.view.slice(), r0: pg.rotate % 360, ru: 0, annots: [] });
  }
  return pages;
}

function resetDoc() {
  S.sources.forEach(s => { try { s.pdf.destroy(); } catch (e) { /* ignore */ } });
  S.sources = [];
  S.pages = [];
  S.images = {};
  S.undo = [];
  S.redo = [];
  S.selected = null;
  S.editing = null;
  S.dirty = false;
  S.zoom = 1;
  textItemCache.clear();
  $('#pages').innerHTML = '';
  updateUndoButtons();
}

let pendingAction = null; // run after the next PDF opens (home screen tools)

async function openPdf(bytes, name) {
  busy(true, 'Opening…');
  try {
    const src = new Uint8Array(bytes);
    resetDoc();
    const pages = await addSource(src, name);
    S.pages = pages;
    S.name = name || 'document.pdf';
    showDocument();
    if (pendingAction) { const a = pendingAction; pendingAction = null; setTimeout(a, 50); }
  } catch (e) {
    pendingAction = null;
    console.error(e);
    if (!S.pages.length) showHome();
    if (e && e.name !== 'AbortException') toast('Could not open PDF: ' + (e.message || e));
  } finally {
    busy(false);
  }
}

async function appendPdfs(files) {
  busy(true, 'Adding PDF…');
  try {
    finishEditing();
    const newPages = [];
    for (const f of files) {
      const bytes = new Uint8Array(await readFileAsArrayBuffer(f));
      newPages.push(...await addSource(bytes, f.name));
    }
    checkpoint();
    if (!S.pages.length) S.name = files[0].name;
    S.pages.push(...newPages);
    showDocument();
    toast(`Added ${newPages.length} page(s)`);
  } catch (e) {
    toast('Could not add PDF: ' + (e.message || e));
  } finally {
    busy(false);
  }
}

async function importImage(file) {
  let url = await readFileAsDataURL(file);
  let img = await loadImage(url);
  let mime = file.type;
  const MAX = 2400;
  if ((mime !== 'image/png' && mime !== 'image/jpeg') || img.naturalWidth > MAX || img.naturalHeight > MAX) {
    const k = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    const ctx = c.getContext('2d');
    if (mime !== 'image/png') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
    ctx.drawImage(img, 0, 0, c.width, c.height);
    mime = mime === 'image/png' ? 'image/png' : 'image/jpeg';
    url = c.toDataURL(mime, 0.9);
    img = await loadImage(url);
  }
  const id = uid();
  S.images[id] = { url, w: img.naturalWidth, h: img.naturalHeight, mime };
  return id;
}

async function imagesAsPages(files, newDoc) {
  busy(true, 'Adding images…');
  try {
    finishEditing();
    if (newDoc) resetDoc();
    const pages = [];
    for (const f of files) {
      const imgId = await importImage(f);
      const im = S.images[imgId];
      const W = im.w > im.h ? 842 : 595;
      const H = Math.round(W * im.h / im.w);
      pages.push({ id: uid(), src: null, idx: 0, view: [0, 0, W, H], r0: 0, ru: 0,
        annots: [{ id: uid(), type: 'image', imgId, x: 0, y: 0, w: W, h: H }] });
    }
    if (newDoc) {
      S.name = 'images.pdf';
      S.pages = pages;
      S.dirty = true;
    } else {
      checkpoint();
      S.pages.push(...pages);
    }
    showDocument();
  } catch (e) {
    toast('Could not add images: ' + (e.message || e));
  } finally {
    busy(false);
  }
}

function newBlankDoc() {
  resetDoc();
  S.name = 'new.pdf';
  S.pages = [blankPage(595, 842)];
  S.dirty = true;
  showDocument();
}

function blankPage(W, H) {
  return { id: uid(), src: null, idx: 0, view: [0, 0, W, H], r0: 0, ru: 0, annots: [] };
}

// ------------------------------------------------------------------ screens
function showHome() {
  document.body.classList.remove('reading', 'night');
  $('#readBar').hidden = true;
  $('#home').hidden = false;
  $('#viewer').hidden = true;
  $('#toolbar').hidden = true;
  $('#propbar').hidden = true;
  $('#docTitle').textContent = 'PDF Editor';
  ['#btnUndo', '#btnRedo', '#btnPages', '#btnSave'].forEach(s => { $(s).style.visibility = 'hidden'; });
}

function showDocument() {
  $('#home').hidden = true;
  $('#viewer').hidden = false;
  $('#toolbar').hidden = false;
  $('#docTitle').textContent = S.name;
  ['#btnUndo', '#btnRedo', '#btnPages', '#btnSave'].forEach(s => { $(s).style.visibility = ''; });
  afterStructureChange();
}

async function closeDocument() {
  if (S.dirty) {
    const ok = await dialog({ title: 'Discard changes?', body: 'You have unsaved changes.', ok: 'Discard' });
    if (!ok) return;
  }
  resetDoc();
  showHome();
}

// ------------------------------------------------------------------ page layout & rendering
const pageEls = new Map();        // page id -> element
let renderQueue = [];
let rendering = false;

const io = new IntersectionObserver(entries => {
  for (const en of entries) {
    const el = en.target;
    el._visible = en.isIntersecting;
    if (en.isIntersecting) queueRender(el);
  }
}, { root: $('#viewer'), rootMargin: '600px 0px' });

function baseWidth() {
  const vw = $('#viewer').clientWidth || window.innerWidth;
  return Math.min(vw - 16, 1000);
}

function afterStructureChange() {
  layoutPages();
  renderAllLayers();
  updateUndoButtons();
  updatePropbar();
  $('#docTitle').textContent = S.name;
}

function layoutPages() {
  const container = $('#pages');
  const bw = baseWidth() * S.zoom;
  const keep = new Set();
  S.pages.forEach((p, i) => {
    keep.add(p.id);
    let el = pageEls.get(p.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'page';
      el.dataset.id = p.id;
      el.innerHTML = '<canvas class="render"></canvas><div class="layer"></div><div class="pnum"></div>';
      pageEls.set(p.id, el);
      io.observe(el);
    }
    const d = displaySize(p);
    const cssW = Math.round(bw);
    const cssH = Math.round(bw * d.H / d.W);
    el.style.width = cssW + 'px';
    el.style.height = cssH + 'px';
    el._scale = cssW / d.W;
    el.querySelector('.pnum').textContent = (i + 1) + ' / ' + S.pages.length;
    const key = [p.src, p.idx, p.r0, p.ru, cssW].join(':');
    if (el._key !== key) {
      el._key = key;
      el._rendered = false;
      if (el._visible) queueRender(el);
    }
    if (container.children[i] !== el) container.insertBefore(el, container.children[i] || null);
  });
  for (const [id, el] of pageEls) {
    if (!keep.has(id)) {
      io.unobserve(el);
      el.remove();
      pageEls.delete(id);
    }
  }
}

function queueRender(el) {
  if (el._rendered || renderQueue.includes(el)) return;
  renderQueue.push(el);
  pumpRender();
}

async function pumpRender() {
  if (rendering) return;
  rendering = true;
  while (renderQueue.length) {
    const el = renderQueue.shift();
    if (!el.isConnected || el._rendered || !el._visible) continue;
    try { await renderPageCanvas(el); } catch (e) { console.warn('render failed', e); }
  }
  rendering = false;
  releaseFarCanvases();
}

async function renderPageCanvas(el) {
  const p = pageById(el.dataset.id);
  if (!p) return;
  const key = el._key;
  const canvas = el.querySelector('canvas.render');
  const cssW = parseFloat(el.style.width), cssH = parseFloat(el.style.height);
  let dpr = Math.min(window.devicePixelRatio || 1, 3);
  const maxPx = 12e6;
  if (cssW * cssH * dpr * dpr > maxPx) dpr = Math.sqrt(maxPx / (cssW * cssH));
  const off = document.createElement('canvas');
  off.width = Math.round(cssW * dpr);
  off.height = Math.round(cssH * dpr);
  const ctx = off.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, off.width, off.height);
  if (p.src !== null && S.sources[p.src]) {
    const page = await S.sources[p.src].pdf.getPage(p.idx + 1);
    const d = displaySize(p);
    const viewport = page.getViewport({ scale: off.width / d.W, rotation: (p.r0 + p.ru) % 360 });
    await page.render({ canvasContext: ctx, viewport }).promise;
  }
  if (el._key !== key) return; // layout changed meanwhile
  canvas.width = off.width;
  canvas.height = off.height;
  canvas.getContext('2d').drawImage(off, 0, 0);
  el._rendered = true;
}

function releaseFarCanvases() {
  // Free memory of pages far outside the viewport.
  const viewer = $('#viewer');
  const top = viewer.scrollTop, h = viewer.clientHeight;
  for (const el of pageEls.values()) {
    if (!el._rendered) continue;
    const y = el.offsetTop;
    if (y + el.offsetHeight < top - 3 * h || y > top + 4 * h) {
      const c = el.querySelector('canvas.render');
      c.width = c.height = 0;
      el._rendered = false;
    }
  }
}

function currentPage() {
  const viewer = $('#viewer');
  const vr = viewer.getBoundingClientRect();
  let best = null, bestArea = -1;
  for (const p of S.pages) {
    const el = pageEls.get(p.id);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    const vis = Math.max(0, Math.min(r.bottom, vr.bottom) - Math.max(r.top, vr.top));
    if (vis > bestArea) { bestArea = vis; best = p; }
  }
  return best || S.pages[0];
}

function scrollToPage(p) {
  const el = pageEls.get(p.id);
  if (el) $('#viewer').scrollTop = el.offsetTop - 8;
}

function setZoom(z) {
  const viewer = $('#viewer');
  const ratio = viewer.scrollTop / Math.max(1, viewer.scrollHeight);
  finishEditing();
  S.zoom = Math.max(0.5, Math.min(4, z));
  layoutPages();
  renderAllLayers();
  viewer.scrollTop = ratio * viewer.scrollHeight;
  toast(Math.round(S.zoom * 100) + '%', 900);
}

// ------------------------------------------------------------------ annotation layer
function layerGeom(p, el) {
  const { W, H } = frameSize(p);
  const k = el._scale;
  return { W, H, k, lw: W * k, lh: H * k };
}

function fontCss(a, k) {
  return `${a.italic ? 'italic ' : ''}${a.bold ? 'bold ' : ''}${(a.size * k).toFixed(2)}px ${CSS_FONTS[a.font] || CSS_FONTS.Helvetica}`;
}

// Line pitch (× size) and baseline offset (× size) of a text annotation.
function lineH(a) { return a.lh || LINE_H; }
function textAsc(a) { return TEXT_ASC + (lineH(a) - LINE_H) / 2; }

const measureCtx = document.createElement('canvas').getContext('2d');
function textWidth(a, str) {
  measureCtx.font = fontCss(a, 100 / a.size);  // measure at 100px, scale down
  return measureCtx.measureText(str).width * a.size / 100;
}

// Visual lines: the typed lines, word-wrapped to the box width when it has one.
function layoutLines(a) {
  const paras = (a.text || '').split('\n');
  if (!a.w) return paras;
  const out = [];
  for (const para of paras) {
    const words = para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const next = line + w;
      if (line && !/^\s+$/.test(w) && textWidth(a, next) > a.w) {
        out.push(line.replace(/\s+$/, ''));
        line = w;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

function measureText(a) {
  const lines = layoutLines(a);
  let w = 0;
  for (const l of lines) w = Math.max(w, textWidth(a, l));
  return { w: a.w ? Math.max(a.w, w) : Math.max(w, a.size * 0.3), h: lines.length * a.size * lineH(a), lines };
}

function annotBBox(a) {
  switch (a.type) {
    case 'text': { const m = measureText(a); return { x: a.x, y: a.y, w: m.w, h: m.h }; }
    case 'image': case 'rect': case 'ellipse': case 'whiteout':
      return { x: a.x, y: a.y, w: a.w, h: a.h };
    case 'line': case 'arrow': {
      const pad = a.width / 2 + 2;
      return { x: Math.min(a.x1, a.x2) - pad, y: Math.min(a.y1, a.y2) - pad,
        w: Math.abs(a.x2 - a.x1) + 2 * pad, h: Math.abs(a.y2 - a.y1) + 2 * pad };
    }
    case 'ink': {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of a.points) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      const pad = a.width / 2;
      return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
    }
  }
  return { x: 0, y: 0, w: 0, h: 0 };
}

function inkPath(points) {
  if (!points.length) return '';
  let d = `M${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}`;
  if (points.length === 1) return d + `L${(points[0][0] + 0.01).toFixed(2)} ${points[0][1].toFixed(2)}`;
  for (let i = 1; i < points.length; i++) d += `L${points[i][0].toFixed(2)} ${points[i][1].toFixed(2)}`;
  return d;
}

function arrowHead(a) {
  const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
  const len = Math.max(8, a.width * 4);
  const s = Math.PI / 7;
  return [
    [a.x2 - len * Math.cos(ang - s), a.y2 - len * Math.sin(ang - s)],
    [a.x2 - len * Math.cos(ang + s), a.y2 - len * Math.sin(ang + s)]
  ];
}

const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

function renderAllLayers() {
  for (const p of S.pages) renderLayer(p);
}

function renderLayer(p) {
  const el = pageEls.get(p.id);
  if (!el) return;
  const layer = el.querySelector('.layer');
  const g = layerGeom(p, el);
  layer.style.width = g.lw + 'px';
  layer.style.height = g.lh + 'px';
  layer.style.transform = `rotate(${p.ru}deg) translate(${-g.lw / 2}px, ${-g.lh / 2}px)`;
  layer.innerHTML = '';

  const svg = svgEl('svg', { class: 'vec', viewBox: `0 0 ${g.W} ${g.H}`, preserveAspectRatio: 'none' });
  const hitW = 18 / g.k;
  const list = p.annots.slice();
  if (S.temp && S.temp.pageId === p.id) list.push(S.temp.annot);

  // Covers (original text/images that were replaced) go under every other annotation.
  for (const a of list) {
    if (!a.cover) continue;
    const c = document.createElement('div');
    c.className = 'annot cover';
    c.dataset.id = a.id;
    Object.assign(c.style, { left: a.cover.x * g.k + 'px', top: a.cover.y * g.k + 'px', width: a.cover.w * g.k + 'px', height: a.cover.h * g.k + 'px' });
    layer.appendChild(c);
  }
  layer.appendChild(svg);

  for (const a of list) {
    switch (a.type) {
      case 'text': {
        const t = document.createElement('div');
        t.className = 'annot text';
        t.dataset.id = a.id;
        t.spellcheck = true;
        t.textContent = a.w ? measureText(a).lines.join('\n') : a.text;
        Object.assign(t.style, { left: a.x * g.k + 'px', top: a.y * g.k + 'px', font: fontCss(a, g.k), lineHeight: lineH(a), color: a.color, background: a.bg ? '#fff' : 'transparent' });
        if (a.w) t.style.width = a.w * g.k + 'px';
        if (a.italic && FONTS[a.font] && FONTS[a.font].files && !FONTS[a.font].files[fontVariant(a)]) t.style.fontSynthesis = 'style';
        layer.appendChild(t);
        break;
      }
      case 'image': {
        const im = S.images[a.imgId];
        const d = document.createElement('div');
        d.className = 'annot img';
        d.dataset.id = a.id;
        Object.assign(d.style, { left: a.x * g.k + 'px', top: a.y * g.k + 'px', width: a.w * g.k + 'px', height: a.h * g.k + 'px', backgroundImage: im ? `url("${im.url}")` : '' });
        layer.appendChild(d);
        break;
      }
      case 'whiteout':
        svg.appendChild(svgEl('rect', { x: a.x, y: a.y, width: a.w, height: a.h, fill: a.color }));
        svg.appendChild(svgEl('rect', { x: a.x, y: a.y, width: a.w, height: a.h, class: 'hitfill', 'data-id': a.id }));
        break;
      case 'rect':
        svg.appendChild(svgEl('rect', { x: a.x, y: a.y, width: a.w, height: a.h, fill: a.fill ? a.color : 'none', stroke: a.color, 'stroke-width': a.width }));
        svg.appendChild(svgEl('rect', { x: a.x, y: a.y, width: a.w, height: a.h, class: a.fill ? 'hitfill' : 'hit', 'stroke-width': hitW, 'data-id': a.id }));
        break;
      case 'ellipse': {
        const at = { cx: a.x + a.w / 2, cy: a.y + a.h / 2, rx: Math.abs(a.w / 2), ry: Math.abs(a.h / 2) };
        svg.appendChild(svgEl('ellipse', Object.assign({ fill: a.fill ? a.color : 'none', stroke: a.color, 'stroke-width': a.width }, at)));
        svg.appendChild(svgEl('ellipse', Object.assign({ class: a.fill ? 'hitfill' : 'hit', 'stroke-width': hitW, 'data-id': a.id }, at)));
        break;
      }
      case 'line': case 'arrow': {
        let d = `M${a.x1} ${a.y1}L${a.x2} ${a.y2}`;
        if (a.type === 'arrow') { const [h1, h2] = arrowHead(a); d += `M${h1[0]} ${h1[1]}L${a.x2} ${a.y2}L${h2[0]} ${h2[1]}`; }
        svg.appendChild(svgEl('path', { d, fill: 'none', stroke: a.color, 'stroke-width': a.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
        svg.appendChild(svgEl('path', { d, class: 'hit', 'stroke-width': hitW, 'data-id': a.id }));
        break;
      }
      case 'ink': {
        const d = inkPath(a.points);
        const attrs = { d, fill: 'none', stroke: a.color, 'stroke-width': a.width, 'stroke-linecap': a.highlight ? 'butt' : 'round', 'stroke-linejoin': 'round' };
        if (a.opacity < 1) attrs.opacity = a.opacity;
        if (a.highlight) attrs.style = 'mix-blend-mode: multiply';
        svg.appendChild(svgEl('path', attrs));
        svg.appendChild(svgEl('path', { d, class: 'hit', 'stroke-width': Math.max(hitW, a.width), 'data-id': a.id }));
        break;
      }
    }
  }
  // (svg was added above: vector annotations sit under text/images so whiteout can be typed over.)

  if (S.tool === 'edittext') renderTextItems(p, el, layer, g);
  if (S.tool === 'editimage') renderImageItems(p, el, layer, g);

  if (S.selected && S.selected.pageId === p.id && !(S.editing && S.editing.id === S.selected.id)) {
    const a = annotById(p, S.selected.id);
    if (a) {
      const b = annotBBox(a);
      const box = document.createElement('div');
      box.className = 'selbox';
      Object.assign(box.style, { left: (b.x * g.k - 3) + 'px', top: (b.y * g.k - 3) + 'px', width: (b.w * g.k + 6) + 'px', height: (b.h * g.k + 6) + 'px' });
      box.innerHTML = '<div class="mover"></div><div class="handle"></div>';
      layer.appendChild(box);
    }
  }
}

// ------------------------------------------------------------------ existing-text detection (Edit Text)
const textItemCache = new Map(); // "src:idx" -> text fragments (F0 points)
const blockCache = new Map();    // page id -> text blocks

async function pdfTextItems(p) {
  if (p.src === null) return [];
  const key = p.src + ':' + p.idx;
  if (textItemCache.has(key)) return textItemCache.get(key);
  const page = await S.sources[p.src].pdf.getPage(p.idx + 1);
  const vp = page.getViewport({ scale: 1, rotation: p.r0 });
  const tc = await page.getTextContent();
  const items = [];
  tc.items.forEach((it, i) => {
    if (!it.str || !it.str.trim()) return;
    const tx = pdfjsLib.Util.transform(vp.transform, it.transform);
    if (Math.abs(tx[1]) > 0.01 || Math.abs(tx[2]) > 0.01) return; // skip rotated/skewed text
    const size = Math.abs(tx[3]) || Math.hypot(tx[2], tx[3]);
    if (size < 1) return;
    const style = tc.styles[it.fontName] || {};
    let font = 'Helvetica';
    const fam = (style.fontFamily || '').toLowerCase();
    if (fam.includes('monospace')) font = 'Courier';
    else if (fam.includes('serif') && !fam.includes('sans')) font = 'Times';
    let bold = false, italic = false;
    try {
      if (page.commonObjs.has(it.fontName)) {
        const f = page.commonObjs.get(it.fontName);
        const nm = (f && f.name) || '';
        bold = /bold|black|heavy|semibold|demi/i.test(nm);
        italic = /italic|oblique/i.test(nm);
        if (/courier|mono/i.test(nm)) font = 'Courier';
        else if (/times|serif|roman|georgia|garamond|cambria|book/i.test(nm) && !/sans/i.test(nm)) font = 'Times';
      }
    } catch (e) { /* font not loaded yet */ }
    const width = it.width * (vp.scale || 1);
    items.push({ key: i, str: it.str, x: tx[4], base: tx[5], size, w: width, font, bold, italic });
  });
  textItemCache.set(key, items);
  return items;
}

// All text fragments of a page: the PDF's own text plus OCR results.
async function getTextItems(p) {
  const items = await pdfTextItems(p);
  return p.ocr && p.ocr.length ? items.concat(p.ocr) : items;
}

// Group fragments into lines, then lines into paragraph blocks, so Edit Text
// works on whole paragraphs instead of individual words.
function groupBlocks(items) {
  const frags = items.slice().sort((a, b) => a.base - b.base || a.x - b.x);
  const lines = [];
  for (const f of frags) {
    let line = null;
    for (let i = lines.length - 1; i >= 0 && i >= lines.length - 6; i--) {
      const L = lines[i];
      const gap = f.x - (L.x + L.w);
      if (Math.abs(L.base - f.base) < Math.min(L.size, f.size) * 0.35 &&
          Math.abs(L.size - f.size) < Math.max(L.size, f.size) * 0.3 &&
          gap > -L.size * 0.5 && gap < Math.max(L.size, f.size) * 1.6) { line = L; break; }
    }
    if (line) {
      const gap = f.x - (line.x + line.w);
      const sep = gap > line.size * 0.12 && !/\s$/.test(line.str) && !/^\s/.test(f.str) ? ' ' : '';
      line.str += sep + f.str;
      line.w = Math.max(line.w, f.x + f.w - line.x);
      line.keys.push(f.key);
    } else {
      lines.push({ str: f.str, x: f.x, base: f.base, size: f.size, w: f.w, font: f.font, bold: f.bold, italic: f.italic, keys: [f.key] });
    }
  }
  lines.forEach(l => { l.str = l.str.replace(/\s+$/, ''); });
  lines.sort((a, b) => a.base - b.base || a.x - b.x);
  const blocks = [];
  for (const l of lines) {
    let blk = null;
    for (const b of blocks) {
      const last = b.lines[b.lines.length - 1];
      const pitch = l.base - last.base;
      const overlap = Math.min(b.x + b.w, l.x + l.w) - Math.max(b.x, l.x);
      if (pitch > l.size * 0.8 && pitch < Math.max(l.size, last.size) * 2.1 &&
          Math.abs(l.size - last.size) < Math.max(l.size, last.size) * 0.25 &&
          (overlap > 0 || Math.abs(l.x - b.x) < l.size * 2) &&
          (!b.pitch || Math.abs(pitch - b.pitch) < l.size * 0.45)) { blk = b; if (!b.pitch) b.pitch = pitch; break; }
    }
    if (blk) {
      blk.lines.push(l);
      const right = Math.max(blk.x + blk.w, l.x + l.w);
      blk.x = Math.min(blk.x, l.x);
      blk.w = right - blk.x;
    } else blocks.push({ lines: [l], x: l.x, w: l.w, pitch: 0 });
  }
  return blocks.map((b, i) => {
    const first = b.lines[0], last = b.lines[b.lines.length - 1];
    const size = first.size;
    return {
      key: 'b' + i + ':' + first.keys[0],
      text: b.lines.map(l => l.str).join('\n'),
      x: b.x, w: b.w, size, base: first.base,
      lh: b.lines.length > 1 ? b.pitch / size : LINE_H,
      top: first.base - size * 0.92,
      h: last.base + size * 0.24 - (first.base - size * 0.92),
      font: first.font, bold: first.bold, italic: first.italic
    };
  });
}

async function getTextBlocks(p) {
  const cacheKey = p.id + ':' + (p.ocr ? p.ocr.length : 0);
  if (blockCache.has(cacheKey)) return blockCache.get(cacheKey);
  const blocks = groupBlocks(await getTextItems(p));
  blockCache.set(cacheKey, blocks);
  return blocks;
}

function cachedBlocks(p) { return blockCache.get(p.id + ':' + (p.ocr ? p.ocr.length : 0)); }

function renderTextItems(p, el, layer, g) {
  const blocks = cachedBlocks(p);
  if (!blocks) {
    getTextBlocks(p).then(() => { if (S.tool === 'edittext') renderLayer(p); }).catch(() => {});
    return;
  }
  const replaced = new Set(p.annots.filter(a => a.srcBlock !== undefined).map(a => a.srcBlock));
  for (const b of blocks) {
    if (replaced.has(b.key)) continue;
    const d = document.createElement('div');
    d.className = 'textitem';
    d.dataset.item = b.key;
    Object.assign(d.style, {
      left: (b.x - 1) * g.k + 'px', top: b.top * g.k + 'px',
      width: (Math.max(b.w, 2) + 2) * g.k + 'px', height: b.h * g.k + 'px'
    });
    layer.appendChild(d);
  }
}

// Turn an original text block into an editable text annotation that covers it.
function blockAnnotation(b, text) {
  const size = Math.round(b.size * 2) / 2;
  const a = {
    id: uid(), type: 'text', text: text === undefined ? b.text : text,
    x: b.x, y: 0, size, lh: Math.round(b.lh * 100) / 100,
    font: b.font, bold: b.bold, italic: b.italic, color: '#000000', bg: false,
    cover: { x: b.x - 1, y: b.top, w: b.w + 2, h: b.h },
    srcBlock: b.key
  };
  a.y = b.base - size * textAsc(a);
  // Wrap at (a little more than) the original width, so longer edits flow onto new lines.
  const natural = measureText(Object.assign({}, a, { text: b.text })).w;
  a.w = Math.ceil(Math.max(b.w, natural) * 1.04 + 2);
  return a;
}

async function replaceTextBlock(p, key, clientX, clientY) {
  const blocks = await getTextBlocks(p);
  const b = blocks.find(x => x.key === key);
  if (!b) return;
  checkpoint();
  const a = blockAnnotation(b);
  p.annots.push(a);
  S.selected = { pageId: p.id, id: a.id };
  renderLayer(p);
  startEditing(p, a, false, clientX, clientY);
}

// ------------------------------------------------------------------ text editing
function startEditing(p, a, isNew, clientX, clientY) {
  const el = pageEls.get(p.id);
  const t = el && el.querySelector(`.annot.text[data-id="${a.id}"]`);
  if (!t) return;
  S.editing = { pageId: p.id, id: a.id, isNew };
  S.selected = { pageId: p.id, id: a.id };
  const sb = el.querySelector('.selbox');
  if (sb) sb.remove();
  // Edit the typed text; the browser wraps it inside the box while typing.
  t.textContent = a.text;
  if (a.w) t.style.whiteSpace = 'pre-wrap';
  t.contentEditable = 'true';
  t.focus();
  // Put the caret where the user tapped (or at the end).
  let range = null;
  if (clientX !== undefined && document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(clientX, clientY);
    if (r && t.contains(r.startContainer)) range = r;
  }
  if (!range) {
    range = document.createRange();
    range.selectNodeContents(t);
    range.collapse(false);
  }
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  updatePropbar();
  setTimeout(() => t.scrollIntoView({ block: 'center', behavior: 'smooth' }), 350);
}

function finishEditing() {
  if (!S.editing) return;
  const { pageId, id, isNew } = S.editing;
  S.editing = null;
  const p = pageById(pageId);
  const a = annotById(p, id);
  const el = pageEls.get(pageId);
  const t = el && el.querySelector(`.annot.text[data-id="${id}"]`);
  if (a && t) {
    let text = t.innerText.replace(/ /g, ' ').replace(/\n+$/, '');
    if (text !== a.text) {
      if (!isNew) checkpoint();
      a.text = text;
    }
    if (!a.text && !a.cover) {
      p.annots = p.annots.filter(x => x !== a);
      if (isNew) { S.undo.pop(); updateUndoButtons(); }
      S.selected = null;
    }
  }
  if (document.activeElement) document.activeElement.blur();
  if (p) renderLayer(p);
  updatePropbar();
}

// ------------------------------------------------------------------ pointer interaction
function toFrame(p, el, clientX, clientY) {
  const r = el.getBoundingClientRect();
  const cx = clientX - (r.left + r.width / 2);
  const cy = clientY - (r.top + r.height / 2);
  const th = p.ru * Math.PI / 180;
  const x = cx * Math.cos(th) + cy * Math.sin(th);
  const y = -cx * Math.sin(th) + cy * Math.cos(th);
  const g = layerGeom(p, el);
  return [(x + g.lw / 2) / g.k, (y + g.lh / 2) / g.k];
}

const DRAG_TOOLS = ['draw', 'highlight', 'whiteout', 'rect', 'ellipse', 'line', 'arrow'];
let gesture = null;

function onPointerDown(e) {
  if (e.button > 0) return;
  const pageEl = e.target.closest('.page');
  if (!pageEl) return;
  const p = pageById(pageEl.dataset.id);
  if (!p) return;
  const target = e.target;

  if (S.editing) {
    if (target.closest('[contenteditable="true"]')) return; // caret moves inside the editor
    // Finish on lift, so a pinch (whose first finger lands here) keeps the box open.
    gesture = { kind: 'finishedit', pointerId: e.pointerId };
    return;
  }

  const pt = toFrame(p, pageEl, e.clientX, e.clientY);
  const hitId = target.dataset && target.dataset.id;
  const onSel = S.selected && S.selected.pageId === p.id;

  // Selection handles work in every tool.
  if (onSel && target.classList.contains('handle')) {
    const a = annotById(p, S.selected.id);
    gesture = { kind: 'resize', p, el: pageEl, a, start: pt, orig: JSON.parse(JSON.stringify(a)), bbox: annotBBox(a), moved: false };
  } else if (onSel && target.classList.contains('mover')) {
    const a = annotById(p, S.selected.id);
    gesture = { kind: 'move', p, el: pageEl, a, start: pt, orig: JSON.parse(JSON.stringify(a)), moved: false, tapSelected: true };
  } else if (S.tool === 'editimage' && !hitId) {
    const item = target.closest('.imgitem');
    gesture = item ? { kind: 'editimg', p, key: item.dataset.item } : { kind: 'deselect', p };
  } else if (S.tool === 'select' || ((S.tool === 'text' || S.tool === 'edittext' || S.tool === 'editimage') && hitId)) {
    if (hitId) {
      const a = annotById(p, hitId);
      if ((S.tool === 'text' || S.tool === 'edittext') && a.type === 'text') {
        gesture = { kind: 'edit', p, a };
      } else {
        S.selected = { pageId: p.id, id: hitId };
        renderLayer(p);
        updatePropbar();
        gesture = { kind: 'move', p, el: pageEl, a, start: pt, orig: JSON.parse(JSON.stringify(a)), moved: false };
      }
    } else {
      gesture = { kind: 'deselect', p };
    }
  } else if (S.tool === 'text') {
    gesture = { kind: 'newtext', p, pt };
  } else if (S.tool === 'edittext') {
    const item = target.closest('.textitem');
    gesture = item ? { kind: 'edititem', p, key: item.dataset.item } : { kind: 'hint' };
  } else if (S.tool === 'check' || S.tool === 'cross' || S.tool === 'date') {
    gesture = { kind: 'stamp', p, pt };
  } else if (DRAG_TOOLS.includes(S.tool)) {
    const pr = TOOL_DEFAULTS[S.tool];
    let a;
    if (S.tool === 'draw' || S.tool === 'highlight') {
      a = { id: uid(), type: 'ink', points: [pt], color: pr.color, width: pr.width, opacity: S.tool === 'highlight' ? 0.4 : 1, highlight: S.tool === 'highlight' };
    } else if (S.tool === 'line' || S.tool === 'arrow') {
      a = { id: uid(), type: S.tool, x1: pt[0], y1: pt[1], x2: pt[0], y2: pt[1], color: pr.color, width: pr.width };
    } else {
      a = { id: uid(), type: S.tool, x: pt[0], y: pt[1], w: 0, h: 0, color: pr.color, width: pr.width || 0, fill: !!pr.fill };
    }
    S.temp = { pageId: p.id, annot: a };
    gesture = { kind: 'create', p, el: pageEl, a, start: pt };
    if (S.selected) { S.selected = null; updatePropbar(); }
  } else {
    return;
  }
  // Taps that open a text box must not be followed by the compatibility mousedown,
  // which would move focus away from the box (and close the keyboard).
  if (['newtext', 'edit', 'edititem'].includes(gesture.kind) || (gesture.kind === 'move' && gesture.tapSelected && gesture.a.type === 'text')) e.preventDefault();
  try { pageEl.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  gesture.pointerId = e.pointerId;
  gesture.clientStart = [e.clientX, e.clientY];
}

function onPointerMove(e) {
  if (!gesture || gesture.pointerId !== e.pointerId) return;
  const g = gesture;
  if (g.kind === 'move' || g.kind === 'resize' || g.kind === 'create') {
    const pt = toFrame(g.p, g.el, e.clientX, e.clientY);
    const dx = pt[0] - g.start[0], dy = pt[1] - g.start[1];
    const dist = Math.hypot(e.clientX - g.clientStart[0], e.clientY - g.clientStart[1]);
    if (g.kind === 'create') {
      updateCreate(g, pt);
      renderLayer(g.p);
      return;
    }
    if (!g.moved && dist < 5) return;
    if (!g.moved) { checkpoint(); g.moved = true; }
    if (g.kind === 'move') applyMove(g.a, g.orig, dx, dy);
    else applyResize(g.a, g.orig, g.bbox, dx, dy);
    renderLayer(g.p);
  }
}

function onPointerUp(e) {
  if (!gesture || gesture.pointerId !== e.pointerId) return;
  const g = gesture;
  gesture = null;
  const cancelled = e.type === 'pointercancel';
  switch (g.kind) {
    case 'finishedit':
      if (!cancelled) finishEditing();
      break;
    case 'deselect':
      if (S.selected) { S.selected = null; renderLayer(g.p); updatePropbar(); }
      break;
    case 'move':
      if (!g.moved && g.tapSelected && g.a.type === 'text' && !cancelled) startEditing(g.p, g.a, false, e.clientX, e.clientY);
      break;
    case 'edit':
      if (!cancelled) startEditing(g.p, g.a, false, e.clientX, e.clientY);
      break;
    case 'newtext': {
      if (cancelled) break;
      const pr = TOOL_DEFAULTS.text;
      checkpoint();
      const a = { id: uid(), type: 'text', text: '', x: g.pt[0], y: g.pt[1] - pr.size * 0.6, size: pr.size, font: pr.font, bold: pr.bold, italic: pr.italic, color: pr.color, bg: pr.bg };
      g.p.annots.push(a);
      S.selected = { pageId: g.p.id, id: a.id };
      renderLayer(g.p);
      startEditing(g.p, a, true);
      break;
    }
    case 'edititem':
      if (!cancelled) replaceTextBlock(g.p, g.key, e.clientX, e.clientY);
      break;
    case 'hint':
      toast('Tap on highlighted text to edit it');
      break;
    case 'editimg':
      if (!cancelled) extractPdfImage(g.p, g.key);
      break;
    case 'stamp':
      if (!cancelled) addStamp(g.p, g.pt);
      break;
    case 'create': {
      S.temp = null;
      if (cancelled) { renderLayer(g.p); break; }
      const a = finalizeCreate(g);
      if (a) {
        checkpoint();
        g.p.annots.push(a);
        if (a.type !== 'ink') S.selected = { pageId: g.p.id, id: a.id };
      }
      renderLayer(g.p);
      updatePropbar();
      break;
    }
  }
}

function updateCreate(g, pt) {
  const a = g.a;
  if (a.type === 'ink') {
    const last = a.points[a.points.length - 1];
    if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) * pageEls.get(g.p.id)._scale >= 1.5) a.points.push(pt);
  } else if (a.type === 'line' || a.type === 'arrow') {
    a.x2 = pt[0]; a.y2 = pt[1];
  } else {
    a.x = Math.min(g.start[0], pt[0]);
    a.y = Math.min(g.start[1], pt[1]);
    a.w = Math.abs(pt[0] - g.start[0]);
    a.h = Math.abs(pt[1] - g.start[1]);
  }
}

function finalizeCreate(g) {
  const a = g.a;
  const k = pageEls.get(g.p.id)._scale;
  if (a.type === 'ink') {
    if (a.highlight && a.points.length > 2) {
      // Straighten near-horizontal highlighter strokes, like a real marker on a text line.
      const ys = a.points.map(q => q[1]);
      const spread = Math.max(...ys) - Math.min(...ys);
      if (spread < a.width * 0.9) {
        const y = ys.reduce((s, v) => s + v, 0) / ys.length;
        const xs = a.points.map(q => q[0]);
        a.points = [[Math.min(...xs), y], [Math.max(...xs), y]];
      }
    }
    return a;
  }
  if (a.type === 'line' || a.type === 'arrow') {
    if (Math.hypot(a.x2 - a.x1, a.y2 - a.y1) * k < 8) { a.x2 = a.x1 + 80; a.y2 = a.y1; }
    return a;
  }
  if (a.w * k < 8 || a.h * k < 8) {
    const dw = a.type === 'whiteout' ? 100 : 80, dh = a.type === 'whiteout' ? 20 : 50;
    a.x = g.start[0] - dw / 2; a.y = g.start[1] - dh / 2; a.w = dw; a.h = dh;
  }
  return a;
}

function applyMove(a, o, dx, dy) {
  if (a.type === 'ink') a.points = o.points.map(([x, y]) => [x + dx, y + dy]);
  else if (a.type === 'line' || a.type === 'arrow') { a.x1 = o.x1 + dx; a.y1 = o.y1 + dy; a.x2 = o.x2 + dx; a.y2 = o.y2 + dy; }
  else {
    a.x = o.x + dx; a.y = o.y + dy;
    if (o.cover) a.cover = Object.assign({}, o.cover); // original text stays covered where it was
  }
}

function applyResize(a, o, b, dx, dy) {
  const minS = 4;
  let sx = Math.max(minS, b.w + dx) / Math.max(b.w, 0.01);
  let sy = Math.max(minS, b.h + dy) / Math.max(b.h, 0.01);
  if (a.type === 'image') { const s = Math.max(sx, sy); sx = sy = s; }
  switch (a.type) {
    case 'text':
      // Dragging the handle sets the box width; the text re-wraps inside it.
      a.w = Math.max(o.size * 2, b.w + dx);
      break;
    case 'image': case 'rect': case 'ellipse': case 'whiteout':
      a.w = Math.max(minS, o.w * sx); a.h = Math.max(minS, o.h * sy);
      break;
    case 'ink':
      a.points = o.points.map(([x, y]) => [b.x + (x - b.x) * sx, b.y + (y - b.y) * sy]);
      break;
    case 'line': case 'arrow':
      a.x1 = b.x + (o.x1 - b.x) * sx; a.y1 = b.y + (o.y1 - b.y) * sy;
      a.x2 = b.x + (o.x2 - b.x) * sx; a.y2 = b.y + (o.y2 - b.y) * sy;
      break;
  }
}

function addStamp(p, pt) {
  const pr = TOOL_DEFAULTS[S.tool];
  let a;
  if (S.tool === 'date') {
    const d = new Date();
    const text = [String(d.getDate()).padStart(2, '0'), String(d.getMonth() + 1).padStart(2, '0'), d.getFullYear()].join('/');
    a = { id: uid(), type: 'text', text, x: pt[0], y: pt[1] - pr.size * 0.6, size: pr.size, font: pr.font, bold: pr.bold, italic: pr.italic, color: pr.color, bg: pr.bg };
  } else {
    const s = pr.size;
    const pts = S.tool === 'check'
      ? [[-0.5, 0], [-0.15, 0.35], [0.5, -0.4]]
      : null;
    if (pts) {
      a = { id: uid(), type: 'ink', points: pts.map(([x, y]) => [pt[0] + x * s, pt[1] + y * s]), color: pr.color, width: Math.max(1.5, s / 8), opacity: 1 };
    } else {
      // A cross is two strokes: store it as an ink path that jumps via a hidden-length segment.
      a = { id: uid(), type: 'ink', points: [[pt[0] - s / 2, pt[1] - s / 2], [pt[0] + s / 2, pt[1] + s / 2]], color: pr.color, width: Math.max(1.5, s / 8), opacity: 1, cross: true };
      a.points2 = [[pt[0] + s / 2, pt[1] - s / 2], [pt[0] - s / 2, pt[1] + s / 2]];
      a = crossToInk(a);
    }
  }
  checkpoint();
  p.annots.push(a);
  S.selected = { pageId: p.id, id: a.id };
  renderLayer(p);
  updatePropbar();
}

// A cross drawn as a single polyline: \ then back to center then /
function crossToInk(a) {
  const [p1, p2] = a.points, [q1, q2] = a.points2;
  const c = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
  return { id: a.id, type: 'ink', points: [p1, c, p2, c, q1, c, q2], color: a.color, width: a.width, opacity: 1 };
}

// ------------------------------------------------------------------ inserting images / signatures
function placeImage(imgId, widthFrac) {
  const p = currentPage();
  if (!p) return;
  const im = S.images[imgId];
  const { W, H } = frameSize(p);
  let w = Math.min(W * widthFrac, im.w);
  let h = w * im.h / im.w;
  if (h > H * 0.8) { h = H * 0.8; w = h * im.w / im.h; }
  // Center in the visible part of the page.
  const el = pageEls.get(p.id);
  const vr = $('#viewer').getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const cy = (Math.max(r.top, vr.top) + Math.min(r.bottom, vr.bottom)) / 2;
  const c = toFrame(p, el, r.left + r.width / 2, cy);
  const a = { id: uid(), type: 'image', imgId, x: Math.max(0, c[0] - w / 2), y: Math.max(0, Math.min(H - h, c[1] - h / 2)), w, h };
  checkpoint();
  p.annots.push(a);
  setTool('select');
  S.selected = { pageId: p.id, id: a.id };
  renderLayer(p);
  updatePropbar();
}

// ------------------------------------------------------------------ tools & properties
function setTool(tool) {
  finishEditing();
  const prevEdit = S.tool === 'edittext' || S.tool === 'editimage';
  S.tool = tool;
  document.body.classList.forEach(c => { if (c.startsWith('tool-')) document.body.classList.remove(c); });
  document.body.classList.add('tool-' + tool);
  if (typeof showToolTab === 'function') showToolTab(toolTab(tool));
  $$('#toolbar .tool[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
  if (tool === 'edittext' || tool === 'editimage' || prevEdit) renderAllLayers();
  if (tool === 'edittext') { toast('Tap a highlighted block, then tap where you want to type'); offerOcrIfNoText(); }
  if (tool === 'editimage') toast('Tap a picture in the PDF to move, resize, crop or replace it');
  updatePropbar();
}

function propTarget() {
  if (S.selected) {
    const a = annotById(pageById(S.selected.pageId), S.selected.id);
    if (a) return { kind: 'annot', a };
  }
  if (TOOL_DEFAULTS[S.tool]) return { kind: 'tool', a: TOOL_DEFAULTS[S.tool] };
  return null;
}

function annotKind(a) {
  if (a.type === 'text') return 'text';
  if (a.type === 'image') return 'image';
  if (a.type === 'whiteout') return 'whiteout';
  if (a.type === 'rect' || a.type === 'ellipse') return 'shape';
  return 'stroke';
}

function updatePropbar() {
  updatePropbarInner();
  // The page area only shrinks while the properties bar is actually shown.
  document.body.classList.toggle('has-prop', !$('#propbar').hidden && !$('#toolbar').hidden);
}

function rotateCurrentPage() {
  const p = currentPage();
  if (!p) return;
  finishEditing();
  checkpoint();
  p.ru = (p.ru + 90) % 360;
  afterStructureChange();
  scrollToPage(p);
}

function updatePropbarInner() {
  const bar = $('#propbar');
  if (!S.pages.length) { bar.hidden = true; return; }
  const t = propTarget();
  bar.hidden = false;
  const isAnnot = t && t.kind === 'annot';
  $('#propSelWrap').hidden = !isAnnot || !!S.editing;
  $('#propDoneWrap').hidden = !S.editing;
  if (!t) {
    $('#propColors').hidden = $('#propSizeWrap').hidden = $('#propFontWrap').hidden = $('#propFillWrap').hidden = true;
    if (!isAnnot) bar.hidden = true;
    return;
  }
  const a = t.a;
  const kind = t.kind === 'annot' ? annotKind(a) :
    ({ text: 'text', edittext: 'text', date: 'text', whiteout: 'whiteout', rect: 'shape', ellipse: 'shape', check: 'stamp', cross: 'stamp' }[S.tool] || 'stroke');
  $('#propColors').hidden = kind === 'image';
  if (kind === 'image') { $('#propSizeWrap').hidden = $('#propFontWrap').hidden = true; }
  $('#propFontWrap').hidden = kind !== 'text';
  $('#propFillWrap').hidden = kind !== 'shape';
  $('#propImgWrap').hidden = kind !== 'image' || t.kind !== 'annot';
  const sw = $('#propSizeWrap');
  const size = $('#propSize');
  if (kind === 'text' || kind === 'stamp') {
    sw.hidden = false;
    $('#propSizeLabel').textContent = 'Size';
    size.min = 4; size.max = kind === 'stamp' ? 80 : 96; size.step = 0.5;
    size.value = a.size; $('#propSizeVal').textContent = a.size;
  } else if (kind === 'stroke' || kind === 'shape') {
    sw.hidden = false;
    $('#propSizeLabel').textContent = 'Width';
    size.min = 0.5; size.max = a.highlight || S.tool === 'highlight' ? 40 : 20; size.step = 0.5;
    size.value = a.width; $('#propSizeVal').textContent = a.width;
  } else sw.hidden = true;
  if (kind === 'text') {
    $('#propFont').value = a.font || 'Helvetica';
    $('#propBold').classList.toggle('on', !!a.bold);
    $('#propItalic').classList.toggle('on', !!a.italic);
    $('#propBg').classList.toggle('on', !!a.bg);
  }
  if (kind === 'shape') $('#propFill').classList.toggle('on', !!a.fill);
  $$('#propColors .swatch').forEach(s => s.classList.toggle('on', s.dataset.color === (a.color || '').toLowerCase()));
}

function setProp(key, value) {
  const t = propTarget();
  if (!t) return;
  if (t.kind === 'annot') {
    const p = pageById(S.selected.pageId);
    if (S.editing && S.editing.id === t.a.id) {
      t.a[key] = value;
      const el = pageEls.get(p.id).querySelector(`.annot.text[data-id="${t.a.id}"]`);
      if (el) {
        el.style.font = fontCss(t.a, pageEls.get(p.id)._scale);
        el.style.lineHeight = lineH(t.a);
        if (t.a.w) el.style.width = t.a.w * pageEls.get(p.id)._scale + 'px';
        el.style.color = t.a.color;
        el.style.background = t.a.bg ? '#fff' : 'transparent';
      }
    } else {
      checkpoint();
      t.a[key] = value;
      renderLayer(p);
    }
  } else {
    t.a[key] = value;
  }
  // Keep new annotations of this tool consistent with what the user just picked.
  if (t.kind === 'annot' && TOOL_DEFAULTS[S.tool] && key in TOOL_DEFAULTS[S.tool] && S.tool !== 'select') TOOL_DEFAULTS[S.tool][key] = value;
  updatePropbar();
}

function deleteSelected() {
  if (!S.selected) return;
  const p = pageById(S.selected.pageId);
  finishEditing();
  if (!S.selected) return;
  checkpoint();
  p.annots = p.annots.filter(a => a.id !== S.selected.id);
  S.selected = null;
  renderLayer(p);
  updatePropbar();
}

function duplicateSelected() {
  if (!S.selected) return;
  const p = pageById(S.selected.pageId);
  const a = annotById(p, S.selected.id);
  if (!a) return;
  checkpoint();
  const c = JSON.parse(JSON.stringify(a));
  c.id = uid();
  delete c.cover;
  delete c.srcBlock;
  delete c.srcImage;
  applyMove(c, JSON.parse(JSON.stringify(c)), 12, 12);
  p.annots.push(c);
  S.selected = { pageId: p.id, id: c.id };
  renderLayer(p);
  updatePropbar();
}

// ------------------------------------------------------------------ signature pad
const sig = { color: '#000000', strokes: [], drawing: null };

function openSignature() {
  finishEditing();
  const c = $('#sigPad');
  $('#signModal').hidden = false;
  const r = c.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  c.width = r.width * dpr;
  c.height = r.height * dpr;
  sig.strokes = [];
  drawSig();
  renderSavedSigs();
}

function drawSig() {
  const c = $('#sigPad');
  const ctx = c.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.lineCap = ctx.lineJoin = 'round';
  for (const s of sig.strokes) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (s.pts.length === 1) ctx.lineTo(s.pts[0][0] + 0.1, s.pts[0][1]);
    ctx.stroke();
  }
}

function sigPoint(e) {
  const r = $('#sigPad').getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

function exportSignature() {
  if (!sig.strokes.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of sig.strokes) for (const [x, y] of s.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const pad = 4, k = 3;
  const c = document.createElement('canvas');
  c.width = Math.ceil((x1 - x0 + 2 * pad) * k);
  c.height = Math.ceil((y1 - y0 + 2 * pad) * k);
  const ctx = c.getContext('2d');
  ctx.scale(k, k);
  ctx.translate(pad - x0, pad - y0);
  ctx.lineCap = ctx.lineJoin = 'round';
  for (const s of sig.strokes) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (s.pts.length === 1) ctx.lineTo(s.pts[0][0] + 0.1, s.pts[0][1]);
    ctx.stroke();
  }
  return c.toDataURL('image/png');
}

function savedSigs() {
  try { return JSON.parse(localStorage.getItem('signatures') || '[]'); } catch (e) { return []; }
}

function storeSigs(list) {
  try { localStorage.setItem('signatures', JSON.stringify(list.slice(0, 6))); } catch (e) { /* storage full */ }
  if (typeof settingsChanged === 'function') settingsChanged();
}

function renderSavedSigs() {
  const box = $('#savedSigs');
  box.innerHTML = '';
  savedSigs().forEach((url, i) => {
    const d = document.createElement('button');
    d.className = 'saved-sig';
    d.style.backgroundImage = `url("${url}")`;
    d.innerHTML = '<span class="x">✕</span>';
    d.onclick = async e => {
      if (e.target.classList.contains('x')) {
        const l = savedSigs(); l.splice(i, 1); storeSigs(l); renderSavedSigs();
        return;
      }
      await useSignatureUrl(url);
    };
    box.appendChild(d);
  });
}

async function useSignatureUrl(url) {
  $('#signModal').hidden = true;
  const img = await loadImage(url);
  const id = uid();
  S.images[id] = { url, w: img.naturalWidth, h: img.naturalHeight, mime: 'image/png' };
  placeImage(id, 0.35);
}

// ------------------------------------------------------------------ pages panel
const pgSel = new Set();
const thumbIO = new IntersectionObserver(entries => {
  for (const en of entries) if (en.isIntersecting) renderThumb(en.target);
}, { root: $('#thumbs'), rootMargin: '300px' });

function openPagesPanel() {
  finishEditing();
  pgSel.clear();
  $('#pagesPanel').hidden = false;
  buildThumbs();
}

function buildThumbs() {
  const box = $('#thumbs');
  thumbIO.disconnect();
  box.innerHTML = '';
  S.pages.forEach((p, i) => {
    const t = document.createElement('div');
    t.className = 'thumb' + (pgSel.has(p.id) ? ' sel' : '');
    t.dataset.id = p.id;
    t.innerHTML = `<div class="tbox"><canvas></canvas></div><div class="tnum">${i + 1}</div><div class="tcheck"></div>`;
    t.onclick = () => {
      if (pgSel.has(p.id)) pgSel.delete(p.id); else pgSel.add(p.id);
      t.classList.toggle('sel', pgSel.has(p.id));
      updatePgActions();
    };
    t.querySelector('.tnum').onclick = e => {
      e.stopPropagation();
      $('#pagesPanel').hidden = true;
      scrollToPage(p);
    };
    box.appendChild(t);
    thumbIO.observe(t);
  });
  $('#pagesCount').textContent = `(${S.pages.length})`;
  updatePgActions();
}

async function renderThumb(t) {
  if (t._done) return;
  t._done = true;
  const p = pageById(t.dataset.id);
  if (!p) return;
  const c = t.querySelector('canvas');
  const d = displaySize(p);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = 100 * dpr;
  c.width = W;
  c.height = Math.round(W * d.H / d.W);
  c.style.width = '100px';
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  if (p.src !== null) {
    try {
      const page = await S.sources[p.src].pdf.getPage(p.idx + 1);
      await page.render({ canvasContext: ctx, viewport: page.getViewport({ scale: W / d.W, rotation: (p.r0 + p.ru) % 360 }) }).promise;
    } catch (e) { /* ignore */ }
  }
  // Show image pages / images roughly.
  const k = W / d.W;
  ctx.save();
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(p.ru * Math.PI / 180);
  const f = frameSize(p);
  ctx.translate(-f.W * k / 2, -f.H * k / 2);
  for (const a of p.annots) {
    if (a.type === 'image' && S.images[a.imgId]) {
      try { ctx.drawImage(await loadImage(S.images[a.imgId].url), a.x * k, a.y * k, a.w * k, a.h * k); } catch (e) { /* ignore */ }
    }
  }
  ctx.restore();
}

function updatePgActions() {
  const n = pgSel.size;
  $$('#pagesPanel [data-pg]').forEach(b => { b.disabled = n === 0 && b.dataset.pg !== 'blank'; });
  $('#pgSelectAll').textContent = n === S.pages.length ? 'Select none' : 'Select all';
}

async function pageAction(action) {
  const selIdx = S.pages.map((p, i) => (pgSel.has(p.id) ? i : -1)).filter(i => i >= 0);
  if (action === 'extract') {
    const pages = selIdx.map(i => S.pages[i]);
    const base = S.name.replace(/\.pdf$/i, '');
    await exportAndSave(pages, `${base}_pages.pdf`, 'save', true);
    return;
  }
  if (action === 'delete' && selIdx.length === S.pages.length) {
    toast('Cannot delete every page');
    return;
  }
  checkpoint();
  switch (action) {
    case 'rotl': case 'rotr':
      for (const i of selIdx) S.pages[i].ru = (S.pages[i].ru + (action === 'rotr' ? 90 : 270)) % 360;
      break;
    case 'left':
      for (let i = 1; i < S.pages.length; i++) {
        if (pgSel.has(S.pages[i].id) && !pgSel.has(S.pages[i - 1].id)) [S.pages[i - 1], S.pages[i]] = [S.pages[i], S.pages[i - 1]];
      }
      break;
    case 'right':
      for (let i = S.pages.length - 2; i >= 0; i--) {
        if (pgSel.has(S.pages[i].id) && !pgSel.has(S.pages[i + 1].id)) [S.pages[i + 1], S.pages[i]] = [S.pages[i], S.pages[i + 1]];
      }
      break;
    case 'dup':
      for (let j = selIdx.length - 1; j >= 0; j--) {
        const c = JSON.parse(JSON.stringify(S.pages[selIdx[j]]));
        c.id = uid();
        c.annots.forEach(a => { a.id = uid(); });
        S.pages.splice(selIdx[j] + 1, 0, c);
      }
      break;
    case 'blank': {
      const at = selIdx.length ? selIdx[selIdx.length - 1] : S.pages.length - 1;
      const ref = S.pages[at];
      const f = ref ? displaySize(ref) : { W: 595, H: 842 };
      S.pages.splice(at + 1, 0, blankPage(f.W, f.H));
      break;
    }
    case 'delete':
      S.pages = S.pages.filter(p => !pgSel.has(p.id));
      pgSel.clear();
      break;
  }
  S.selected = null;
  afterStructureChange();
  buildThumbs();
}

// ------------------------------------------------------------------ forms
const formState = { fields: [] };

async function openFormsPanel() {
  finishEditing();
  busy(true, 'Reading form…');
  const list = $('#formsList');
  list.innerHTML = '';
  formState.fields = [];
  try {
    const usedSrc = [...new Set(S.pages.filter(p => p.src !== null).map(p => p.src))];
    for (const si of usedSrc) {
      let doc;
      try { doc = await libLoad(si); } catch (e) { continue; }
      const form = doc.getForm();
      for (const f of form.getFields()) {
        const name = f.getName();
        let type = null, value = null, options = null, multiline = false;
        try {
          if (f instanceof PDFTextField) { type = 'text'; value = f.getText() || ''; multiline = f.isMultiline(); }
          else if (f instanceof PDFCheckBox) { type = 'check'; value = f.isChecked(); }
          else if (f instanceof PDFDropdown || f instanceof PDFOptionList) { type = 'select'; options = f.getOptions(); value = f.getSelected()[0] || ''; }
          else if (f instanceof PDFRadioGroup) { type = 'radio'; options = f.getOptions(); value = f.getSelected() || ''; }
        } catch (e) { type = null; }
        if (!type || f.isReadOnly()) continue;
        formState.fields.push({ si, name, type, value, options, multiline });
      }
    }
  } finally {
    busy(false);
  }
  if (!formState.fields.length) {
    list.innerHTML = '<p class="muted">No fillable form fields found in this PDF.<br><br>Use <b>Add Text</b>, <b>Tick</b>, <b>Date</b> and <b>Sign</b> to fill it in anywhere on the page.</p>';
  }
  formState.fields.forEach((f, i) => {
    const d = document.createElement('div');
    d.className = 'field';
    const label = document.createElement('label');
    label.className = 'fname';
    label.textContent = f.name;
    d.appendChild(label);
    let inp;
    if (f.type === 'text') {
      inp = document.createElement(f.multiline ? 'textarea' : 'input');
      if (!f.multiline) inp.type = 'text';
      inp.value = f.value;
      inp.oninput = () => { f.value = inp.value; };
    } else if (f.type === 'check') {
      const l = document.createElement('label');
      l.className = 'check';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = f.value;
      cb.onchange = () => { f.value = cb.checked; };
      l.appendChild(cb);
      l.appendChild(document.createTextNode(' Checked'));
      inp = l;
    } else if (f.type === 'select') {
      inp = document.createElement('select');
      ['', ...f.options].forEach(o => { const op = document.createElement('option'); op.value = op.textContent = o; inp.appendChild(op); });
      inp.value = f.value;
      inp.onchange = () => { f.value = inp.value; };
    } else {
      inp = document.createElement('div');
      inp.className = 'radios';
      f.options.forEach(o => {
        const l = document.createElement('label');
        const r = document.createElement('input');
        r.type = 'radio'; r.name = 'rg' + i; r.checked = f.value === o;
        r.onchange = () => { f.value = o; };
        l.appendChild(r);
        l.appendChild(document.createTextNode(o));
        inp.appendChild(l);
      });
    }
    d.appendChild(inp);
    list.appendChild(d);
  });
  $('#formsApply').hidden = !formState.fields.length;
  $('#formsPanel').hidden = false;
}

async function applyForms() {
  busy(true, 'Filling form…');
  try {
    const flatten = $('#formsFlatten').checked;
    const bySrc = {};
    formState.fields.forEach(f => { (bySrc[f.si] = bySrc[f.si] || []).push(f); });
    let failed = 0;
    for (const si of Object.keys(bySrc).map(Number)) {
      const doc = await libLoad(si);
      const form = doc.getForm();
      for (const f of bySrc[si]) {
        try {
          if (f.type === 'text') form.getTextField(f.name).setText(f.value);
          else if (f.type === 'check') { const c = form.getCheckBox(f.name); f.value ? c.check() : c.uncheck(); }
          else if (f.type === 'select') { const fld = form.getField(f.name); if (f.value) fld.select(f.value); else if (fld.clear) fld.clear(); }
          else if (f.type === 'radio') { if (f.value) form.getRadioGroup(f.name).select(f.value); }
        } catch (e) { failed++; }
      }
      try { form.updateFieldAppearances(); } catch (e) { /* non-latin text: keep values */ }
      if (flatten) { try { form.flatten(); } catch (e) { failed++; } }
      const bytes = await doc.save();
      const src = S.sources[si];
      try { src.pdf.destroy(); } catch (e) { /* ignore */ }
      src.bytes = bytes;
      src.pdf = await loadPdfJs(bytes);
      textItemCache.forEach((v, k) => { if (k.startsWith(si + ':')) textItemCache.delete(k); });
      blockCache.clear();
      imageItemCache.clear();
    }
    for (const el of pageEls.values()) { el._key = null; }
    S.dirty = true;
    $('#formsPanel').hidden = true;
    layoutPages();
    toast(failed ? `Form updated (${failed} field(s) could not be set)` : 'Form updated');
  } catch (e) {
    toast('Form error: ' + (e.message || e));
  } finally {
    busy(false);
  }
}

// ------------------------------------------------------------------ export
function frameMatrix(view, r0, H) {
  const [x0, y0, x1, y1] = view;
  const bl = { 0: [x0, y0], 90: [x1, y0], 180: [x1, y1], 270: [x0, y1] }[r0] || [x0, y0];
  const t = r0 * Math.PI / 180;
  const c = Math.round(Math.cos(t)), s = Math.round(Math.sin(t));
  return [c, s, -s, c, bl[0], bl[1]];
}

async function rasterizeTextAnnot(a) {
  const m = measureText(a);
  const k = 4;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(m.w * k));
  c.height = Math.max(1, Math.ceil(m.h * k));
  const ctx = c.getContext('2d');
  ctx.font = fontCss(a, k);
  ctx.fillStyle = a.color;
  ctx.textBaseline = 'alphabetic';
  m.lines.forEach((l, i) => ctx.fillText(l, 0, (i * lineH(a) + textAsc(a)) * a.size * k));
  return { png: dataUrlToBytes(c.toDataURL('image/png')), w: m.w, h: m.h };
}

// Scripts that need shaping (Devanagari, Arabic, Thai, ...): drawn as images, since
// PDF text output here has no shaping engine. Everything else is real, selectable text.
const COMPLEX_SCRIPT = /[\u0590-\u08FF\u0900-\u0DFF\u0E00-\u0FFF\u1000-\u109F\u1780-\u17FF]/;
const fontFiles = {};
async function fontFile(file) {
  if (!fontFiles[file]) {
    const bytes = new Uint8Array(await (await fetch('lib/fonts/' + file + '.ttf')).arrayBuffer());
    fontFiles[file] = { bytes, fk: fontkit.create(bytes) };
  }
  return fontFiles[file];
}

// Picks a PDF font able to show `text` in the annotation's style.
// Returns {font, skew} or null when the text must be drawn as an image.
async function pdfFontFor(out, fonts, a, text, allowComplex) {
  if (!allowComplex && COMPLEX_SCRIPT.test(text)) return null;
  const v = fontVariant(a);
  const def = FONTS[a.font] || FONTS.Helvetica;
  const plain = text.replace(/\n/g, '');
  if (def.std) {
    const key = def.std[v];
    if (!fonts[key]) fonts[key] = await out.embedFont(StandardFonts[key]);
    try { fonts[key].encodeText(plain); return { font: fonts[key] }; } catch (e) { /* not WinAnsi: try a Unicode font */ }
  }
  const candidates = def.files ? [a.font, 'Roboto', 'Devanagari'] : ['Roboto', 'Devanagari'];
  for (const fam of candidates) {
    const files = FONTS[fam].files;
    const file = files[v] || files[v & 1];
    const ff = await fontFile(file);
    let ok = true;
    for (const ch of plain) if (ch.trim() && !ff.fk.hasGlyphForCodePoint(ch.codePointAt(0))) { ok = false; break; }
    if (!ok) continue;
    if (!fonts.__fontkit) { out.registerFontkit(fontkit); fonts.__fontkit = true; }
    if (!fonts[file]) fonts[file] = await out.embedFont(ff.bytes, { subset: true });
    return { font: fonts[file], skew: v & 2 && !files[v] ? degrees(12) : undefined };
  }
  return null;
}

// Removes the original picture behind an "Edit Images" annotation from the page by pointing
// its resource name at a transparent 1×1 image (page-local, other pages keep it).
// Returns the ids of annotations whose original was removed (they need no white cover).
async function removeReplacedImages(out, page, p, fonts) {
  const done = new Set();
  const want = p.annots.filter(a => a.srcImage);
  if (!want.length) return done;
  const { PDFName, PDFDict, PDFRawStream } = PDFLib;
  const res = page.node.Resources();
  const xo = res && res.lookupMaybe(PDFName.of('XObject'), PDFDict);
  if (!xo) return done;
  let newXo = null;
  for (const a of want) {
    const hits = xo.keys().filter(k => {
      const obj = out.context.lookup(xo.get(k));
      if (!(obj && obj.dict) || String(obj.dict.get(PDFName.of('Subtype'))) !== '/Image') return false;
      const w = obj.dict.lookup(PDFName.of('Width')), h = obj.dict.lookup(PDFName.of('Height'));
      return w && h && w.asNumber() === a.srcImage.w && h.asNumber() === a.srcImage.h;
    });
    if (hits.length !== 1) continue;
    if (!fonts.__blankImg) {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      fonts.__blankImg = (await out.embedPng(dataUrlToBytes(c.toDataURL('image/png')))).ref;
    }
    if (!newXo) {
      newXo = xo.clone(out.context);
      const newRes = res.clone(out.context);
      newRes.set(PDFName.of('XObject'), newXo);
      page.node.set(PDFName.of('Resources'), newRes);
    }
    newXo.set(hits[0], fonts.__blankImg);
    done.add(a.id);
  }
  return done;
}

async function drawAnnotations(out, page, p, view, r0, fonts, imgCache, canEditResources) {
  const { W, H } = frameSize({ view, r0 });
  const visible = p.annots.filter(a => !(a.type === 'text' && !a.text && !a.cover));
  if (!visible.length && !(p.ocr && p.ocr.length)) return;
  const removed = canEditResources ? await removeReplacedImages(out, page, p, fonts) : new Set();
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...frameMatrix(view, r0, H)));
  const Y = y => H - y;
  // Invisible OCR text, so scanned pages become searchable/selectable.
  for (const it of p.ocr || []) {
    const f = await pdfFontFor(out, fonts, { font: 'Helvetica' }, it.str, true);
    if (!f) continue;
    const natural = f.font.widthOfTextAtSize(it.str, it.size) || 1;
    const size = Math.max(1, Math.min(it.size * 2, it.size * it.w / natural));
    page.drawText(it.str, { x: it.x, y: Y(it.base), size, font: f.font, renderMode: 3 });
  }
  const getImage = async id => {
    if (!imgCache[id]) {
      const im = S.images[id];
      if (!im) return null;
      const bytes = dataUrlToBytes(im.url);
      imgCache[id] = im.mime === 'image/png' ? await out.embedPng(bytes) : await out.embedJpg(bytes);
    }
    return imgCache[id];
  };
  const white = rgb(1, 1, 1);
  // White covers over replaced originals go under everything the user added.
  for (const a of visible) {
    if (a.cover && !removed.has(a.id)) page.drawRectangle({ x: a.cover.x, y: Y(a.cover.y + a.cover.h), width: a.cover.w, height: a.cover.h, color: white });
  }
  for (const a of visible) {
    const color = a.color ? hexToRgb(a.color) : rgb(0, 0, 0);
    switch (a.type) {
      case 'text': {
        if (!a.text) break;
        const m = measureText(a);
        const f = await pdfFontFor(out, fonts, a, a.text, false);
        const lines = m.lines, pitch = lineH(a) * a.size;
        if (a.bg) {
          let w = a.w || 0;
          if (f && !a.w) lines.forEach(l => { w = Math.max(w, f.font.widthOfTextAtSize(l, a.size)); });
          else if (!a.w) w = m.w;
          page.drawRectangle({ x: a.x - 1, y: Y(a.y + lines.length * pitch), width: w + 2, height: lines.length * pitch, color: white });
        }
        if (f) {
          lines.forEach((l, i) => {
            if (l) page.drawText(l, { x: a.x, y: Y(a.y + i * pitch + textAsc(a) * a.size), size: a.size, font: f.font, color, xSkew: f.skew });
          });
        } else {
          const r = await rasterizeTextAnnot(a);
          const img = await out.embedPng(r.png);
          page.drawImage(img, { x: a.x, y: Y(a.y + r.h), width: r.w, height: r.h });
        }
        break;
      }
      case 'image': {
        const img = await getImage(a.imgId);
        if (img) page.drawImage(img, { x: a.x, y: Y(a.y + a.h), width: a.w, height: a.h });
        break;
      }
      case 'whiteout':
        page.drawRectangle({ x: a.x, y: Y(a.y + a.h), width: a.w, height: a.h, color });
        break;
      case 'rect':
        page.drawRectangle(Object.assign({ x: a.x, y: Y(a.y + a.h), width: a.w, height: a.h, borderColor: color, borderWidth: a.width }, a.fill ? { color } : {}));
        break;
      case 'ellipse':
        page.drawEllipse(Object.assign({ x: a.x + a.w / 2, y: Y(a.y + a.h / 2), xScale: a.w / 2, yScale: a.h / 2, borderColor: color, borderWidth: a.width }, a.fill ? { color } : {}));
        break;
      case 'line': case 'arrow': {
        const opt = { thickness: a.width, color, lineCap: LineCapStyle.Round };
        page.drawLine(Object.assign({ start: { x: a.x1, y: Y(a.y1) }, end: { x: a.x2, y: Y(a.y2) } }, opt));
        if (a.type === 'arrow') {
          for (const h of arrowHead(a)) page.drawLine(Object.assign({ start: { x: h[0], y: Y(h[1]) }, end: { x: a.x2, y: Y(a.y2) } }, opt));
        }
        break;
      }
      case 'ink': {
        const opt = { x: 0, y: H, borderColor: color, borderWidth: a.width, borderLineCap: a.highlight ? LineCapStyle.Butt : LineCapStyle.Round };
        if (a.opacity < 1) opt.borderOpacity = a.opacity;
        if (a.highlight) opt.blendMode = BlendMode.Multiply;
        page.drawSvgPath(inkPath(a.points), opt);
        break;
      }
    }
  }
  page.pushOperators(popGraphicsState());
}

async function rasterizePage(out, p) {
  // Fallback for encrypted sources pdf-lib cannot rewrite: embed a high-res image of the page.
  const pg = await S.sources[p.src].pdf.getPage(p.idx + 1);
  const { W, H } = frameSize(p);
  const scale = Math.min(2.5, Math.sqrt(15e6 / (W * H)));
  const c = document.createElement('canvas');
  c.width = Math.round(W * scale);
  c.height = Math.round(H * scale);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  await pg.render({ canvasContext: ctx, viewport: pg.getViewport({ scale: c.width / W, rotation: p.r0 }) }).promise;
  const img = await out.embedJpg(dataUrlToBytes(c.toDataURL('image/jpeg', 0.92)));
  const page = out.addPage([W, H]);
  page.drawImage(img, { x: 0, y: 0, width: W, height: H });
  return page;
}

// Empty the base document's page tree so pages can be re-added in the new order.
// Kept pages get their inherited attributes (MediaBox, Resources, ...) copied onto
// themselves first, because the tree they inherited them from is being replaced.
function resetPageTree(out, baseOrig, used) {
  const { PDFName, PDFNumber } = PDFLib;
  const INHERITED = ['Resources', 'MediaBox', 'CropBox', 'Rotate'];
  baseOrig.forEach((pg, idx) => {
    if (!used.has(idx)) return;
    for (const k of INHERITED) {
      const name = PDFName.of(k);
      if (!pg.node.get(name)) {
        const v = pg.node.getInheritableAttribute(name);
        if (v) pg.node.set(name, v);
      }
    }
  });
  const rootRef = out.catalog.get(PDFName.of('Pages'));
  const root = out.context.lookup(rootRef);
  root.set(PDFName.of('Kids'), out.context.obj([]));
  root.set(PDFName.of('Count'), PDFNumber.of(0));
  out.pageCount = 0;
  out.pageCache.invalidate();
}

async function buildPdf(pages, fresh) {
  // Load pdf-lib copies of every source we need; encrypted ones get rasterized.
  const libs = {};
  let rasterized = 0;
  for (const si of new Set(pages.filter(p => p.src !== null).map(p => p.src))) {
    try { libs[si] = await libLoad(si); } catch (e) { console.warn('pdf-lib load failed', e); libs[si] = null; }
  }
  const baseSrc = fresh ? -1 : (pages.find(p => p.src !== null && libs[p.src]) || {}).src;
  let out;
  if (baseSrc !== undefined && baseSrc >= 0) out = libs[baseSrc];
  else out = await PDFDocument.create();

  // Plan: which pdf-lib page object backs each entry. Copies must happen before
  // the base document's page tree is emptied.
  const baseOrig = baseSrc >= 0 ? out.getPages() : [];
  const used = new Set();
  const plan = new Array(pages.length);
  const copyReq = {}; // si -> [{i, idx}]
  pages.forEach((p, i) => {
    if (p.src === null) { plan[i] = { blank: true }; return; }
    if (!libs[p.src]) { plan[i] = { raster: true }; return; }
    if (p.src === baseSrc && !used.has(p.idx)) { used.add(p.idx); plan[i] = { page: baseOrig[p.idx] }; return; }
    (copyReq[p.src] = copyReq[p.src] || []).push({ i, idx: p.idx });
  });
  for (const si of Object.keys(copyReq)) {
    const req = copyReq[si];
    const copied = await out.copyPages(libs[si], req.map(r => r.idx));
    req.forEach((r, j) => { plan[r.i] = { page: copied[j] }; });
  }
  resetPageTree(out, baseOrig, used);

  const fonts = {}, imgCache = {};
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    let page, view = p.view, r0 = p.r0;
    if (plan[i].blank) {
      const { W, H } = frameSize(p);
      page = out.addPage([W, H]);
      view = [0, 0, W, H]; r0 = 0;
    } else if (plan[i].raster) {
      page = await rasterizePage(out, p);
      const { W, H } = frameSize(p);
      view = [0, 0, W, H]; r0 = 0;
      rasterized++;
    } else {
      page = out.addPage(plan[i].page);
    }
    await drawAnnotations(out, page, p, view, r0, fonts, imgCache, !plan[i].raster);
    page.setRotation(degrees((r0 + p.ru) % 360));
  }
  out.setProducer('PDF Editor (offline)');
  out.setModificationDate(new Date());
  const bytes = await out.save({ useObjectStreams: true });
  return { bytes, rasterized };
}

let saveMode = null;
window.onNativeSaved = (ok, msg) => {
  busy(false);
  if (ok && saveMode === 'save') S.dirty = false;
  if (msg) toast(msg);
  saveMode = null;
};

async function exportAndSave(pages, name, mode, fresh) {
  finishEditing();
  busy(true, 'Building PDF…');
  try {
    const { bytes, rasterized } = await buildPdf(pages, fresh);
    if (rasterized) toast(`${rasterized} protected page(s) were saved as images`, 4000);
    await saveBytes(bytes, name, mode, !fresh && mode === 'save');
  } catch (e) {
    console.error(e);
    busy(false);
    toast('Save failed: ' + (e.message || e), 5000);
  }
}

// Hands a finished file to Android (save dialog / share sheet / print) or downloads it in a browser.
async function saveBytes(bytes, name, mode, marksClean) {
  if (hasBridge) {
    busy(true, mode === 'print' ? 'Preparing to print…' : 'Saving…');
    saveMode = marksClean ? 'save' : 'other';
    if (!AndroidBridge.beginFile(name)) throw new Error('storage unavailable');
    const CH = 3 * 256 * 1024;
    for (let i = 0; i < bytes.length; i += CH) {
      if (!AndroidBridge.appendChunk(bytesToBase64(bytes.subarray(i, i + CH)))) throw new Error('write failed');
    }
    AndroidBridge.finishFile(mode);
    // busy is cleared by onNativeSaved
  } else if (canShareFiles(name)) {
    // iPhone / iPad / Android browsers: hand the file to the system share sheet
    // (Save to Files, AirDrop, Print, Mail…). share() needs a fresh tap, hence the prompt.
    const ext = name.split('.').pop().toLowerCase();
    const file = new File([bytes], name, { type: MIME_BY_EXT[ext] || 'application/octet-stream' });
    busy(false);
    window.__lastSaved = bytes;
    window.__lastSavedName = name;
    await dialog({
      title: 'File ready',
      body: `${name} · ${fmtSize(bytes.length)}\nChoose “Save to Files”${mode === 'print' ? ' or “Print”' : ''} in the next screen.`,
      ok: mode === 'print' ? 'Print / Share' : 'Save / Share',
      onOk: () => {
        navigator.share({ files: [file], title: name })
          .then(() => { if (marksClean) S.dirty = false; })
          .catch(err => { if (err && err.name !== 'AbortError') downloadBytes(bytes, name); });
      }
    });
  } else {
    const ext = name.split('.').pop().toLowerCase();
    const url = URL.createObjectURL(new Blob([bytes], { type: MIME_BY_EXT[ext] || 'application/octet-stream' }));
    if (mode === 'print') {
      const w = window.open(url);
      if (w) w.addEventListener('load', () => w.print());
    } else {
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    if (marksClean) S.dirty = false;
    busy(false);
    window.__lastSaved = bytes; // used by automated tests
    window.__lastSavedName = name;
  }
}

function canShareFiles(name) {
  if (!navigator.canShare || !(navigator.maxTouchPoints > 0)) return false;
  try { return navigator.canShare({ files: [new File([new Uint8Array(1)], name, { type: 'application/pdf' })] }); } catch (e) { return false; }
}

function downloadBytes(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes]));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const MIME_BY_EXT = {
  pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png', zip: 'application/zip', txt: 'text/plain',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};

function outName() {
  return S.name.toLowerCase().endsWith('.pdf') ? S.name : S.name + '.pdf';
}

// ------------------------------------------------------------------ incoming files (Android "Open with")
window.openIncoming = async name => {
  if (S.pages.length && S.dirty) {
    const ok = await dialog({ title: 'Open ' + name + '?', body: 'Unsaved changes to the current document will be lost.', ok: 'Open' });
    if (!ok) return;
  }
  try {
    const res = await fetch('/incoming.pdf?t=' + Date.now());
    const buf = await res.arrayBuffer();
    await openPdf(buf, name);
  } catch (e) {
    toast('Could not open file: ' + (e.message || e));
  }
};

window.onAndroidBack = () => {
  if (!$('#dialog').hidden) { dialog.cancel && dialog.cancel(); return true; }
  if (!$('#signModal').hidden) { $('#signModal').hidden = true; return true; }
  if (!$('#optModal').hidden) { $('#optModal').hidden = true; return true; }
  if (!$('#cropModal').hidden) { $('#cropModal').hidden = true; return true; }
  if (document.body.classList.contains('reading')) { exitReading(); return true; }
  if (!$('#menu').hidden) { toggleMenu(false); return true; }
  if (!$('#pagesPanel').hidden) { $('#pagesPanel').hidden = true; return true; }
  if (!$('#formsPanel').hidden) { $('#formsPanel').hidden = true; return true; }
  if (S.editing) { finishEditing(); return true; }
  if (S.selected) { S.selected = null; renderAllLayers(); updatePropbar(); return true; }
  if (S.pages.length) { closeDocument(); return true; }
  return false;
};

// ------------------------------------------------------------------ wiring
function toggleMenu(on) {
  $('#menu').hidden = !on;
  $('#menuBackdrop').hidden = !on;
}

function pickFile(sel) {
  const inp = $(sel);
  inp.value = '';
  inp.click();
}

async function menuAction(m) {
  toggleMenu(false);
  const needDoc = ['cloudsave', 'merge', 'blankpage', 'pages', 'forms', 'save', 'share', 'rename', 'close', 'convert', 'compress', 'protect', 'read', 'print', 'find', 'ocr'];
  if (needDoc.includes(m) && !S.pages.length) { toast('Open a PDF first'); return; }
  switch (m) {
    case 'open':
      if (S.dirty) {
        const ok = await dialog({ title: 'Open another PDF?', body: 'Unsaved changes will be lost.', ok: 'Continue' });
        if (!ok) return;
      }
      pickFile('#filePdf');
      break;
    case 'merge': pickFile('#fileMerge'); break;
    case 'images': pickFile('#fileImagesPages'); break;
    case 'blankpage': {
      finishEditing();
      checkpoint();
      const cp = currentPage();
      const i = S.pages.indexOf(cp);
      const f = displaySize(cp);
      const np = blankPage(f.W, f.H);
      S.pages.splice(i + 1, 0, np);
      afterStructureChange();
      scrollToPage(np);
      break;
    }
    case 'pages': openPagesPanel(); break;
    case 'forms': openFormsPanel(); break;
    case 'save': exportAndSave(S.pages, outName(), 'save'); break;
    case 'share': exportAndSave(S.pages, outName(), 'share'); break;
    case 'rename': {
      const n = await dialog({ title: 'File name', input: { value: S.name } });
      if (n && n.trim()) { S.name = n.trim(); if (!/\.pdf$/i.test(S.name)) S.name += '.pdf'; $('#docTitle').textContent = S.name; }
      break;
    }
    case 'close': closeDocument(); break;
    case 'convert': openConvert(); break;
    case 'settings': openSettings(); break;
    case 'account': openAccount(); break;
    case 'cloudsave': saveToCloud(); break;
    case 'find': openFind(); break;
    case 'ocr': openOcr(); break;
    case 'compress': openCompress(); break;
    case 'protect': openProtect(); break;
    case 'read': enterReading(); break;
    case 'print': printDoc(); break;
  }
}

function init() {
  applyIcons();
  installFontFaces();
  const fsel = $('#propFont');
  for (const [k, f] of Object.entries(FONTS)) {
    const o = document.createElement('option');
    o.value = k;
    o.textContent = f.label;
    o.style.fontFamily = f.css;
    fsel.appendChild(o);
  }

  // palette
  const pc = $('#propColors');
  PALETTE.forEach(c => {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.dataset.color = c;
    b.style.background = c;
    b.onclick = () => setProp('color', c);
    pc.appendChild(b);
  });
  $('#propSize').oninput = e => {
    const v = parseFloat(e.target.value);
    $('#propSizeVal').textContent = v;
    const t = propTarget();
    if (!t) return;
    const key = ('size' in t.a) ? 'size' : 'width';
    // Slider drags produce many events: only checkpoint once per drag.
    if (t.kind === 'annot' && !(S.editing && S.editing.id === t.a.id)) {
      if (!e.target._drag) { checkpoint(); e.target._drag = true; }
      t.a[key] = v;
      renderLayer(pageById(S.selected.pageId));
    } else setProp(key, v);
  };
  $('#propSize').onchange = e => { e.target._drag = false; updatePropbar(); };
  $('#propFont').onchange = e => setProp('font', e.target.value);
  $('#propBold').onclick = () => { const t = propTarget(); if (t) setProp('bold', !t.a.bold); };
  $('#propItalic').onclick = () => { const t = propTarget(); if (t) setProp('italic', !t.a.italic); };
  $('#propBg').onclick = () => { const t = propTarget(); if (t) setProp('bg', !t.a.bg); };
  $('#propFill').onclick = () => { const t = propTarget(); if (t) setProp('fill', !t.a.fill); };
  $('#propDelete').onclick = deleteSelected;
  $('#propDone').onclick = () => { finishEditing(); S.selected = null; renderAllLayers(); updatePropbar(); };
  // Tapping anywhere outside the text being edited (gaps, margins, bars) ends editing.
  document.addEventListener('pointerdown', e => {
    if (!S.editing) return;
    const t = e.target;
    if (t.closest('[contenteditable="true"]') || t.closest('.page') || t.closest('#propbar') || t.closest('.modal')) return;
    finishEditing();
  }, true);
  $('#propDup').onclick = duplicateSelected;
  // Keep focus in the text being edited when tapping property controls.
  $('#propbar').addEventListener('mousedown', e => { if (S.editing && e.target.tagName !== 'SELECT' && e.target.tagName !== 'INPUT') e.preventDefault(); });

  // toolbar
  $$('#toolbar .tool').forEach(b => {
    b.onclick = () => {
      if (b.dataset.tool) { setTool(b.dataset.tool); return; }
      switch (b.dataset.action) {
        case 'image': pickFile('#fileImage'); break;
        case 'sign': openSignature(); break;
        case 'forms': openFormsPanel(); break;
        case 'read': enterReading(); break;
        case 'find': openFind(); break;
        case 'ocr': openOcr(); break;
        case 'zoomin': setZoom(S.zoom * 1.25); break;
        case 'zoomfit': setZoom(1); break;
        case 'organize': openPagesPanel(); break;
        case 'rotatepage': rotateCurrentPage(); break;
        case 'blankpage': menuAction('blankpage'); break;
        case 'merge': pickFile('#fileMerge'); break;
        case 'imagepages': pickFile('#fileImagesPages'); break;
        case 'settings': openSettings(); break;
        case 'zoomout': setZoom(S.zoom / 1.25); break;
      }
    };
  });

  // top bar
  $('#btnMenu').onclick = () => toggleMenu(true);
  $('#menuBackdrop').onclick = () => toggleMenu(false);
  $$('#menu [data-menu]').forEach(b => { b.onclick = () => menuAction(b.dataset.menu); });
  $('#btnUndo').onclick = undo;
  $('#btnRedo').onclick = redo;
  $('#btnPages').onclick = openPagesPanel;
  $('#btnSave').onclick = () => exportAndSave(S.pages, outName(), 'save');

  // home
  $('#homeOpen').onclick = () => pickFile('#filePdf');
  $$('[data-home]').forEach(b => { b.onclick = () => homeTool(b.dataset.home); });

  // file inputs
  $('#filePdf').onchange = async e => {
    const f = e.target.files[0];
    if (f) await openPdf(await readFileAsArrayBuffer(f), f.name);
  };
  $('#fileMerge').onchange = e => { if (e.target.files.length) appendPdfs(Array.from(e.target.files)); };
  $('#fileImagesPages').onchange = e => {
    const files = Array.from(e.target.files);
    const newDoc = !S.pages.length;
    if (files.length) imagesAsPages(files, newDoc);
  };
  $('#fileImage').onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    try { placeImage(await importImage(f), 0.5); } catch (err) { toast('Could not load image'); }
  };

  // sheets
  $$('[data-close]').forEach(b => { b.onclick = () => { $('#' + b.dataset.close).hidden = true; }; });
  $$('#pagesPanel [data-pg]').forEach(b => { b.onclick = () => pageAction(b.dataset.pg); });
  $('#pgSelectAll').onclick = () => {
    if (pgSel.size === S.pages.length) pgSel.clear(); else S.pages.forEach(p => pgSel.add(p.id));
    $$('#thumbs .thumb').forEach(t => t.classList.toggle('sel', pgSel.has(t.dataset.id)));
    updatePgActions();
  };
  $('#formsApply').onclick = applyForms;

  // signature pad
  const pad = $('#sigPad');
  pad.addEventListener('pointerdown', e => {
    pad.setPointerCapture(e.pointerId);
    sig.drawing = { color: sig.color, pts: [sigPoint(e)] };
    sig.strokes.push(sig.drawing);
    drawSig();
  });
  pad.addEventListener('pointermove', e => { if (sig.drawing) { sig.drawing.pts.push(sigPoint(e)); drawSig(); } });
  const endSig = () => { sig.drawing = null; };
  pad.addEventListener('pointerup', endSig);
  pad.addEventListener('pointercancel', endSig);
  $$('[data-sigcolor]').forEach(b => { b.onclick = () => { sig.color = b.dataset.sigcolor; sig.strokes.forEach(s => { s.color = sig.color; }); drawSig(); }; });
  $('#sigClear').onclick = () => { sig.strokes = []; drawSig(); };
  $('#sigCancel').onclick = () => { $('#signModal').hidden = true; };
  $('#sigUse').onclick = async () => {
    const url = exportSignature();
    if (!url) { toast('Draw your signature first'); return; }
    const list = savedSigs();
    list.unshift(url);
    storeSigs(list);
    await useSignatureUrl(url);
  };

  // page interaction
  const pagesEl = $('#pages');
  pagesEl.addEventListener('pointerdown', onPointerDown);
  pagesEl.addEventListener('pointermove', onPointerMove);
  pagesEl.addEventListener('pointerup', onPointerUp);
  pagesEl.addEventListener('pointercancel', onPointerUp);
  // Stop the page from scrolling while drawing or dragging an annotation.
  pagesEl.addEventListener('touchstart', e => {
    if (e.touches.length > 1) return;
    const t = e.target;
    if (t.closest('[contenteditable="true"]')) return;
    const onAnnot = t.closest('.selbox') || (t.dataset && t.dataset.id);
    if (DRAG_TOOLS.includes(S.tool) || (onAnnot && (S.tool === 'select' || t.closest('.selbox')))) e.preventDefault();
  }, { passive: false });

  let resizeT;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => { if (S.pages.length && !S.editing) { layoutPages(); renderAllLayers(); } }, 200);
  });
  $('#viewer').addEventListener('scroll', () => {
    clearTimeout(releaseFarCanvases._t);
    releaseFarCanvases._t = setTimeout(releaseFarCanvases, 400);
  }, { passive: true });

  setTool('select');
  showHome();
  initWeb();
}

// Web / home-screen app (iPhone etc.): offline cache, platform hints, no browser zoom.
function initWeb() {
  if (hasBridge) return;
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  $('#homeTip').textContent = standalone ? 'Works offline. Your files never leave this device.'
    : ios ? 'Install: tap the Share button ⬆ in Safari, then “Add to Home Screen”. Works offline.'
      : 'Install: open the browser menu and choose “Install app” / “Add to Home screen”.';
  // Safari ignores user-scalable=no; stop its page zoom so the app's own pinch-zoom is used.
  ['gesturestart', 'gesturechange'].forEach(t => document.addEventListener(t, e => e.preventDefault(), { passive: false }));
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('offline cache unavailable', err));
  }
}

init();
