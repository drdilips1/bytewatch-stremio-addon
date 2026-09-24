'use strict';
/* Pinch-zoom, Edit Images (pictures already in the PDF), image replace/crop, Find & Replace, OCR. */

// ------------------------------------------------------------------ gesture cancel (2nd finger)
const activePointers = new Set();

function cancelGesture() {
  const g = gesture;
  gesture = null;
  if (!g) return;
  if (g.kind === 'create') { S.temp = null; renderLayer(g.p); }
  if ((g.kind === 'move' || g.kind === 'resize') && g.moved) {
    Object.keys(g.a).forEach(k => { delete g.a[k]; });
    Object.assign(g.a, g.orig);
    S.undo.pop();
    updateUndoButtons();
    renderLayer(g.p);
  }
}

// ------------------------------------------------------------------ pinch-zoom
const pinch = { on: false };

function touchDist(t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); }
function touchMid(t) { return [(t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2]; }

function pinchStart(e) {
  if (e.touches.length !== 2 || !S.pages.length) return;
  e.preventDefault();
  cancelGesture();
  const viewer = $('#viewer');
  const vr = viewer.getBoundingClientRect();
  const mid = touchMid(e.touches);
  pinch.on = true;
  pinch.d0 = touchDist(e.touches);
  pinch.mid0 = mid;
  pinch.scale = 1;
  pinch.mid = mid;
  pinch.zoom0 = S.zoom;
  // Content point (in #pages coordinates) under the fingers.
  pinch.cx = viewer.scrollLeft + mid[0] - vr.left;
  pinch.cy = viewer.scrollTop + mid[1] - vr.top;
  const pg = $('#pages');
  pg.classList.add('pinching');
  pg.style.transformOrigin = `${pinch.cx}px ${pinch.cy}px`;
}

function pinchMove(e) {
  if (!pinch.on) return;
  e.preventDefault();
  if (e.touches.length < 2) return;
  const z = Math.max(0.5, Math.min(5, pinch.zoom0 * touchDist(e.touches) / pinch.d0));
  pinch.scale = z / pinch.zoom0;
  pinch.mid = touchMid(e.touches);
  const dx = pinch.mid[0] - pinch.mid0[0], dy = pinch.mid[1] - pinch.mid0[1];
  $('#pages').style.transform = `translate(${dx}px, ${dy}px) scale(${pinch.scale})`;
}

function pinchEnd(e) {
  if (!pinch.on || e.touches.length >= 2) return;
  pinch.on = false;
  const pg = $('#pages');
  pg.style.transform = '';
  pg.classList.remove('pinching');
  if (Math.abs(pinch.scale - 1) < 0.03) return;
  const viewer = $('#viewer');
  const editing = S.editing ? { pageId: S.editing.pageId, id: S.editing.id } : null;
  finishEditing();
  S.zoom = pinch.zoom0 * pinch.scale;
  layoutPages();
  renderAllLayers();
  const vr = viewer.getBoundingClientRect();
  viewer.scrollLeft = pinch.cx * pinch.scale - (pinch.mid[0] - vr.left);
  viewer.scrollTop = pinch.cy * pinch.scale - (pinch.mid[1] - vr.top);
  if (editing) {
    // Carry on typing in the same box.
    const p = pageById(editing.pageId);
    const a = annotById(p, editing.id);
    if (a) startEditing(p, a, false);
  }
}

// ------------------------------------------------------------------ Edit Images: pictures inside the PDF
const imageItemCache = new Map(); // "src:idx:r0" -> items (F0 points)

async function getImageItems(p) {
  if (p.src === null) return [];
  const key = p.src + ':' + p.idx + ':' + p.r0;
  if (imageItemCache.has(key)) return imageItemCache.get(key);
  const page = await S.sources[p.src].pdf.getPage(p.idx + 1);
  const ops = await page.getOperatorList();
  const OPS = pdfjsLib.OPS, U = pdfjsLib.Util;
  const vp = page.getViewport({ scale: 1, rotation: p.r0 });
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const items = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i], args = ops.argsArray[i];
    if (fn === OPS.save) stack.push(ctm.slice());
    else if (fn === OPS.restore) ctm = stack.pop() || ctm;
    else if (fn === OPS.transform) ctm = U.transform(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm.slice());
      if (args && Array.isArray(args[0]) && args[0].length === 6) ctm = U.transform(ctm, args[0]);
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm;
    else if (fn === OPS.paintImageXObject) {
      const m = U.transform(vp.transform, ctm);
      if (Math.abs(m[1]) > 0.01 || Math.abs(m[2]) > 0.01) continue; // rotated/skewed pictures are left alone
      const w = Math.abs(m[0]), h = Math.abs(m[3]);
      if (w < 6 || h < 6) continue;
      items.push({
        key: 'i' + i, objId: args[0], pw: args[1], ph: args[2],
        x: Math.min(m[4], m[4] + m[0]), y: Math.min(m[5], m[5] + m[3]), w, h,
        flipX: m[0] < 0, flipY: m[3] > 0
      });
    }
  }
  imageItemCache.set(key, items);
  return items;
}

function renderImageItems(p, el, layer, g) {
  const key = p.src + ':' + p.idx + ':' + p.r0;
  if (p.src === null) return;
  if (!imageItemCache.has(key)) {
    getImageItems(p).then(() => { if (S.tool === 'editimage') renderLayer(p); }).catch(() => {});
    return;
  }
  const taken = new Set(p.annots.filter(a => a.srcImage).map(a => a.srcImage.key));
  for (const it of imageItemCache.get(key)) {
    if (taken.has(it.key)) continue;
    const d = document.createElement('div');
    d.className = 'imgitem';
    d.dataset.item = it.key;
    Object.assign(d.style, { left: it.x * g.k + 'px', top: it.y * g.k + 'px', width: it.w * g.k + 'px', height: it.h * g.k + 'px' });
    layer.appendChild(d);
  }
}

function waitForObj(page, objId, ms) {
  return new Promise(resolve => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(null); } }, ms);
    try {
      page.objs.get(objId, data => { if (!done) { done = true; clearTimeout(t); resolve(data); } });
    } catch (e) { resolve(null); }
  });
}

async function imageObjToCanvas(o, flipX, flipY) {
  // Keep canvases under ~15 MP (iOS limit); big scans are scaled down.
  const k = Math.min(1, Math.sqrt(15e6 / (o.width * o.height)));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(o.width * k));
  c.height = Math.max(1, Math.round(o.height * k));
  const ctx = c.getContext('2d');
  let hasAlpha = false;
  if (o.bitmap) {
    ctx.drawImage(o.bitmap, 0, 0, c.width, c.height);
  } else if (o.data) {
    const K = pdfjsLib.ImageKind;
    const id = new ImageData(o.width, o.height);
    const d = id.data, src = o.data, n = o.width * o.height;
    if (o.kind === K.RGBA_32BPP) {
      d.set(src.subarray(0, n * 4));
      for (let i = 3; i < n * 4; i += 4) if (src[i] < 255) { hasAlpha = true; break; }
    } else if (o.kind === K.RGB_24BPP) {
      for (let i = 0, j = 0; i < n; i++, j += 3) { d[i * 4] = src[j]; d[i * 4 + 1] = src[j + 1]; d[i * 4 + 2] = src[j + 2]; d[i * 4 + 3] = 255; }
    } else if (o.kind === K.GRAYSCALE_1BPP) {
      const rowBytes = (o.width + 7) >> 3;
      for (let y = 0; y < o.height; y++) {
        for (let x = 0; x < o.width; x++) {
          const bit = (src[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
          const v = bit ? 255 : 0, i = (y * o.width + x) * 4;
          d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
        }
      }
    } else return null;
    if (k === 1) ctx.putImageData(id, 0, 0);
    else {
      const bmp = await createImageBitmap(id);
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      if (bmp.close) bmp.close();
    }
  } else return null;
  if (flipX || flipY) {
    const f = document.createElement('canvas');
    f.width = c.width; f.height = c.height;
    const fx = f.getContext('2d');
    fx.translate(flipX ? c.width : 0, flipY ? c.height : 0);
    fx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    fx.drawImage(c, 0, 0);
    return { canvas: f, hasAlpha };
  }
  return { canvas: c, hasAlpha };
}

async function extractPdfImage(p, key) {
  busy(true, 'Picking up picture…');
  try {
    const items = await getImageItems(p);
    const it = items.find(x => x.key === key);
    if (!it) return;
    const page = await S.sources[p.src].pdf.getPage(p.idx + 1);
    let o = await waitForObj(page, it.objId, 1500);
    if (!o) {
      // Images are decoded during rendering: render once off-screen, then retry.
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      await page.render({ canvasContext: c.getContext('2d'), viewport: page.getViewport({ scale: 64 / Math.max(page.view[2], page.view[3]) }) }).promise;
      o = await waitForObj(page, it.objId, 3000);
    }
    const conv = o && await imageObjToCanvas(o, it.flipX, it.flipY);
    if (!conv) { toast('This picture type cannot be picked up'); return; }
    const mime = conv.hasAlpha ? 'image/png' : 'image/jpeg';
    const url = conv.canvas.toDataURL(mime, 0.92);
    const imgId = uid();
    S.images[imgId] = { url, w: conv.canvas.width, h: conv.canvas.height, mime };
    checkpoint();
    const a = {
      id: uid(), type: 'image', imgId, x: it.x, y: it.y, w: it.w, h: it.h,
      cover: { x: it.x - 0.5, y: it.y - 0.5, w: it.w + 1, h: it.h + 1 },
      srcImage: { key: it.key, w: it.pw, h: it.ph }
    };
    p.annots.push(a);
    S.selected = { pageId: p.id, id: a.id };
    renderLayer(p);
    updatePropbar();
  } catch (e) {
    console.error(e);
    toast('Could not pick up picture: ' + (e.message || e));
  } finally {
    busy(false);
  }
}

// ------------------------------------------------------------------ replace / crop an image annotation
function selectedImage() {
  if (!S.selected) return null;
  const p = pageById(S.selected.pageId);
  const a = annotById(p, S.selected.id);
  return a && a.type === 'image' ? { p, a } : null;
}

async function replaceSelectedImage(file) {
  const sel = selectedImage();
  if (!sel) return;
  try {
    const id = await importImage(file);
    const im = S.images[id];
    const { a, p } = sel;
    checkpoint();
    // Fit the new picture inside the old box, centred.
    const k = Math.min(a.w / im.w, a.h / im.h);
    const w = im.w * k, h = im.h * k;
    a.x += (a.w - w) / 2; a.y += (a.h - h) / 2; a.w = w; a.h = h;
    a.imgId = id;
    renderLayer(p);
  } catch (e) {
    toast('Could not load image');
  }
}

const crop = { l: 0, t: 0, r: 1, b: 1 };

function openCrop() {
  const sel = selectedImage();
  if (!sel) return;
  const im = S.images[sel.a.imgId];
  if (!im) return;
  Object.assign(crop, { l: 0, t: 0, r: 1, b: 1 });
  $('#cropImg').src = im.url;
  $('#cropModal').hidden = false;
  $('#cropImg').onload = drawCropRect;
  if ($('#cropImg').complete) drawCropRect();
}

function drawCropRect() {
  const img = $('#cropImg');
  const w = img.clientWidth, h = img.clientHeight;
  Object.assign($('#cropRect').style, {
    left: crop.l * w + 'px', top: crop.t * h + 'px', width: (crop.r - crop.l) * w + 'px', height: (crop.b - crop.t) * h + 'px'
  });
}

function initCrop() {
  const rect = $('#cropRect');
  let drag = null;
  rect.addEventListener('pointerdown', e => {
    e.preventDefault();
    rect.setPointerCapture(e.pointerId);
    drag = { h: e.target.dataset.h || 'move', x: e.clientX, y: e.clientY, c: Object.assign({}, crop) };
  });
  rect.addEventListener('pointermove', e => {
    if (!drag) return;
    const img = $('#cropImg');
    const dx = (e.clientX - drag.x) / img.clientWidth, dy = (e.clientY - drag.y) / img.clientHeight;
    const c = drag.c, min = 0.03;
    if (drag.h === 'move') {
      const w = c.r - c.l, h = c.b - c.t;
      crop.l = Math.max(0, Math.min(1 - w, c.l + dx)); crop.r = crop.l + w;
      crop.t = Math.max(0, Math.min(1 - h, c.t + dy)); crop.b = crop.t + h;
    } else {
      if (drag.h.includes('w')) crop.l = Math.max(0, Math.min(c.r - min, c.l + dx));
      if (drag.h.includes('e')) crop.r = Math.min(1, Math.max(c.l + min, c.r + dx));
      if (drag.h.includes('n')) crop.t = Math.max(0, Math.min(c.b - min, c.t + dy));
      if (drag.h.includes('s')) crop.b = Math.min(1, Math.max(c.t + min, c.b + dy));
    }
    drawCropRect();
  });
  const end = () => { drag = null; };
  rect.addEventListener('pointerup', end);
  rect.addEventListener('pointercancel', end);
  $('#cropReset').onclick = () => { Object.assign(crop, { l: 0, t: 0, r: 1, b: 1 }); drawCropRect(); };
  $('#cropCancel').onclick = () => { $('#cropModal').hidden = true; };
  $('#cropApply').onclick = applyCrop;
}

async function applyCrop() {
  $('#cropModal').hidden = true;
  const sel = selectedImage();
  if (!sel) return;
  if (crop.l <= 0.001 && crop.t <= 0.001 && crop.r >= 0.999 && crop.b >= 0.999) return;
  const { a, p } = sel;
  const im = S.images[a.imgId];
  const img = await loadImage(im.url);
  const sx = Math.round(crop.l * im.w), sy = Math.round(crop.t * im.h);
  const sw = Math.max(1, Math.round((crop.r - crop.l) * im.w)), sh = Math.max(1, Math.round((crop.b - crop.t) * im.h));
  const c = document.createElement('canvas');
  c.width = sw; c.height = sh;
  c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  const id = uid();
  S.images[id] = { url: c.toDataURL(im.mime, 0.92), w: sw, h: sh, mime: im.mime };
  checkpoint();
  const bx = a.x, by = a.y, bw = a.w, bh = a.h;
  a.x = bx + crop.l * bw; a.y = by + crop.t * bh;
  a.w = (crop.r - crop.l) * bw; a.h = (crop.b - crop.t) * bh;
  a.imgId = id;
  renderLayer(p);
  updatePropbar();
}

// ------------------------------------------------------------------ Find & Replace (fix typos)
function findRegex(q, matchCase, wholeWord) {
  let src = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (wholeWord) src = `(?<![\\p{L}\\p{N}])${src}(?![\\p{L}\\p{N}])`;
  return new RegExp(src, 'gu' + (matchCase ? '' : 'i'));
}

// Every piece of text the user can change: text annotations and untouched original blocks.
async function searchTargets() {
  const out = [];
  for (const p of S.pages) {
    for (const a of p.annots) if (a.type === 'text' && a.text) out.push({ p, a, text: a.text });
    const replaced = new Set(p.annots.filter(a => a.srcBlock !== undefined).map(a => a.srcBlock));
    for (const b of await getTextBlocks(p)) if (!replaced.has(b.key)) out.push({ p, b, text: b.text });
  }
  return out;
}

function openFind() {
  showOptions('Find & replace', `<div class="opt-form">
    <input type="text" id="fFind" placeholder="Find (e.g. a typo)" autocomplete="off">
    <input type="text" id="fRepl" placeholder="Replace with" autocomplete="off">
    <label class="check"><input type="checkbox" id="fCase"> Match case</label>
    <label class="check"><input type="checkbox" id="fWord" checked> Whole words only</label>
    <div style="display:flex;gap:8px">
      <button class="chip" id="fGo"><span data-icon="find"></span>Find</button>
      <button class="chip primary" id="fAll">Replace all</button>
    </div>
    <div id="fResults" class="opt-note"></div>
    <div class="opt-note">Tip: while typing in a text box, the keyboard's spell-check suggestions also fix typos.</div>
  </div>`);
  setTimeout(() => $('#fFind').focus(), 50);
  $('#fGo').onclick = doFind;
  $('#fAll').onclick = doReplaceAll;
  $('#fFind').onkeydown = e => { if (e.key === 'Enter') doFind(); };
}

async function doFind() {
  const q = $('#fFind').value;
  if (!q) return;
  busy(true, 'Searching…');
  let targets;
  try { targets = await searchTargets(); } finally { busy(false); }
  const re = findRegex(q, $('#fCase').checked, $('#fWord').checked);
  const hits = [];
  for (const t of targets) {
    re.lastIndex = 0;
    const n = (t.text.match(re) || []).length;
    if (n) hits.push(Object.assign({ n }, t));
  }
  const total = hits.reduce((s, h) => s + h.n, 0);
  const box = $('#fResults');
  if (!total) { box.textContent = 'No matches.'; return; }
  box.innerHTML = `<b>${total} match${total > 1 ? 'es' : ''}</b>` + hits.slice(0, 30).map((h, i) => {
    const pi = S.pages.indexOf(h.p) + 1;
    const line = h.text.split('\n').find(l => { re.lastIndex = 0; return re.test(l); }) || h.text;
    return `<button class="opt" data-hit="${i}"><span><b>Page ${pi}</b><span class="d">${line.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])).slice(0, 90)}</span></span></button>`;
  }).join('');
  box.querySelectorAll('[data-hit]').forEach(b => {
    b.onclick = () => { closeOptions(); showHit(hits[+b.dataset.hit]); };
  });
}

function showHit(h) {
  scrollToPage(h.p);
  const r = h.a ? annotBBox(h.a) : { x: h.b.x, y: h.b.top, w: h.b.w, h: h.b.h };
  const el = pageEls.get(h.p.id);
  if (!el) return;
  const k = el._scale;
  const mark = document.createElement('div');
  mark.className = 'textitem find-hit';
  Object.assign(mark.style, { left: (r.x - 2) * k + 'px', top: (r.y - 2) * k + 'px', width: (r.w + 4) * k + 'px', height: (r.h + 4) * k + 'px', pointerEvents: 'none' });
  el.querySelector('.layer').appendChild(mark);
  const layerTop = el.offsetTop + r.y * k;
  $('#viewer').scrollTop = Math.max(0, layerTop - 120);
  setTimeout(() => mark.remove(), 3000);
}

async function doReplaceAll() {
  const q = $('#fFind').value;
  if (!q) return;
  const repl = $('#fRepl').value;
  busy(true, 'Replacing…');
  try {
    finishEditing();
    const targets = await searchTargets();
    const re = findRegex(q, $('#fCase').checked, $('#fWord').checked);
    let count = 0, first = true;
    const touched = new Set();
    for (const t of targets) {
      re.lastIndex = 0;
      const n = (t.text.match(re) || []).length;
      if (!n) continue;
      if (first) { checkpoint(); first = false; }
      re.lastIndex = 0;
      const next = t.text.replace(re, () => repl);
      if (t.a) t.a.text = next;
      else t.p.annots.push(blockAnnotation(t.b, next));
      count += n;
      touched.add(t.p);
    }
    touched.forEach(p => renderLayer(p));
    $('#fResults').textContent = count ? `Replaced ${count} match${count > 1 ? 'es' : ''}.` : 'No matches.';
    if (count) toast(`Replaced ${count} match${count > 1 ? 'es' : ''}`);
  } finally {
    busy(false);
  }
}

// ------------------------------------------------------------------ OCR (offline, tesseract.js)
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = res;
    s.onerror = () => rej(new Error('failed to load ' + src));
    document.head.appendChild(s);
  });
}

function openOcr() {
  const cur = currentPage();
  const hasText = [];
  showOptions('OCR – recognise text', `<div class="opt-form">
    <div class="opt-note">Reads text in scanned pages and photos (offline). Afterwards the text can be
      searched, copied, converted to Word/Text, and changed with <b>Edit Text</b>.</div>
    <label class="prop-label">Language</label>
    <select id="ocrLang">
      <option value="eng">English</option>
      <option value="hin">Hindi (हिन्दी)</option>
      <option value="eng+hin">English + Hindi</option>
    </select>
    <div class="opt-list">
      ${optButton('page', 'ocr', 'This page', 'Page ' + (S.pages.indexOf(cur) + 1))}
      ${optButton('all', 'ocr', 'All pages', S.pages.length + ' page(s) – can take a while')}
    </div>
  </div>`);
  try { $('#ocrLang').value = localStorage.getItem('ocrLang') || 'eng'; } catch (e) { /* ignore */ }
  if (!hasBridge && navigator.serviceWorker && navigator.serviceWorker.controller) {
    const note = document.createElement('div');
    note.className = 'opt-form';
    note.innerHTML = '<div class="opt-note" id="ocrOffline">Checking offline OCR…</div>';
    $('#optBody').appendChild(note);
    ocrCached().then(ok => {
      const box = $('#ocrOffline');
      if (!box) return;
      if (ok) { box.textContent = '✓ OCR works offline on this device.'; return; }
      box.innerHTML = 'OCR needs a one-time download (about 16 MB) to work offline. <button class="chip" id="ocrDl">Download now</button>';
      $('#ocrDl').onclick = downloadOcr;
    });
  }
  bindOptions({
    page: () => runOcr([cur]),
    all: () => runOcr(S.pages.slice())
  });
  return hasText;
}

const OCR_FILES = ['lib/tesseract/tesseract.min.js', 'lib/tesseract/worker.min.js',
  'lib/tesseract/core/tesseract-core-lstm.wasm.js', 'lib/tesseract/core/tesseract-core-simd-lstm.wasm.js',
  'lib/tesseract/core/tesseract-core-relaxedsimd-lstm.wasm.js',
  'lib/tesseract/lang/eng.traineddata.gz', 'lib/tesseract/lang/hin.traineddata.gz'];

async function ocrCached() {
  for (const f of OCR_FILES) if (!(await caches.match(new URL(f, location.href).href))) return false;
  return true;
}

// Fetch the OCR engine once so the offline cache (sw.js) keeps it.
async function downloadOcr() {
  try {
    let n = 0;
    for (const f of OCR_FILES) {
      busy(true, `Downloading OCR… ${Math.round(n++ / OCR_FILES.length * 100)}%`);
      const res = await fetch(f);
      if (!res.ok) throw new Error(res.status + ' ' + f);
      await res.arrayBuffer();
    }
    const box = $('#ocrOffline');
    if (box) box.textContent = '✓ OCR works offline on this device.';
    toast('OCR is ready for offline use');
  } catch (e) {
    toast('Download failed – check your internet connection', 4000);
  } finally {
    busy(false);
  }
}

// Page as an image in its frame orientation, including pictures added as annotations.
async function renderFrameCanvas(p, maxSide) {
  const { W, H } = frameSize(p);
  const k = Math.min(4.2, maxSide / Math.max(W, H));
  const c = document.createElement('canvas');
  c.width = Math.round(W * k);
  c.height = Math.round(H * k);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  if (p.src !== null) {
    const page = await S.sources[p.src].pdf.getPage(p.idx + 1);
    await page.render({ canvasContext: ctx, viewport: page.getViewport({ scale: c.width / W, rotation: p.r0 }) }).promise;
  }
  for (const a of p.annots) {
    if (a.type === 'image' && S.images[a.imgId]) {
      try { ctx.drawImage(await loadImage(S.images[a.imgId].url), a.x * k, a.y * k, a.w * k, a.h * k); } catch (e) { /* ignore */ }
    }
  }
  return { canvas: c, k };
}

function ocrLinesToItems(data, k) {
  const items = [];
  let j = 0;
  for (const blk of data.blocks || []) {
    for (const para of blk.paragraphs || []) {
      for (const line of para.lines || []) {
        const text = (line.text || '').replace(/\s+/g, ' ').trim();
        if (!text || line.confidence < 35) continue;
        const b = line.bbox;
        const bh = b.y1 - b.y0;
        const bl = line.baseline;
        const basePx = bl && bl.has_baseline !== false && bl.y0 ? (bl.y0 + bl.y1) / 2 : b.y1 - bh * 0.2;
        const rh = line.rowAttributes && line.rowAttributes.row_height;
        const sizePx = Math.max(bh * 0.6, Math.min(bh * 1.1, rh || bh / 1.15));
        // Split the line where words are far apart (table columns, "label ....... value"),
        // so each column becomes its own editable block.
        const words = (line.words || []).filter(w => w.text && w.text.trim()).sort((a, b) => a.bbox.x0 - b.bbox.x0);
        const groups = [];
        for (const w of words) {
          const g = groups[groups.length - 1];
          if (g && w.bbox.x0 - g.x1 < sizePx * 1.2) { g.text += ' ' + w.text.trim(); g.x1 = w.bbox.x1; }
          else groups.push({ text: w.text.trim(), x0: w.bbox.x0, x1: w.bbox.x1 });
        }
        if (!groups.length) groups.push({ text, x0: b.x0, x1: b.x1 });
        for (const g of groups) {
          items.push({ key: 'o' + (j++), str: g.text, x: g.x0 / k, base: basePx / k, size: sizePx / k, w: (g.x1 - g.x0) / k, font: 'Helvetica', bold: false, italic: false });
        }
      }
    }
  }
  return items;
}

async function runOcr(pages) {
  const lang = $('#ocrLang').value;
  try { localStorage.setItem('ocrLang', lang); } catch (e) { /* ignore */ }
  closeOptions();
  finishEditing();
  let worker = null, cancelled = false;
  busy(true, 'Starting OCR…', () => {
    cancelled = true;
    if (worker) worker.terminate().catch(() => {});
    busy(false);
    toast('OCR cancelled');
  });
  const withTimeout = (promise, ms, msg) => Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
  try {
    if (!window.Tesseract) await loadScript('lib/tesseract/tesseract.min.js');
    const abs = path => new URL(path, location.href).href;
    let pageNo = 0;
    worker = await withTimeout(Tesseract.createWorker(lang.split('+'), 1, {
      workerPath: abs('lib/tesseract/worker.min.js'),
      corePath: abs('lib/tesseract/core'),
      langPath: abs('lib/tesseract/lang'),
      workerBlobURL: false,
      cacheMethod: 'none',
      gzip: true,
      logger: m => {
        if (cancelled) return;
        if (m.status === 'recognizing text') busy(true, `Reading page ${pageNo} of ${pages.length}… ${Math.round(m.progress * 100)}%`);
      }
    }), 60000, 'the OCR engine did not start on this device (it needs a recent browser/WebView and ~200 MB free memory)');
    if (cancelled) return;
    let lines = 0, first = true;
    for (const p of pages) {
      if (cancelled) return;
      pageNo++;
      busy(true, `Reading page ${pageNo} of ${pages.length}…`);
      const { canvas, k } = await renderFrameCanvas(p, 2600);
      const { data } = await withTimeout(worker.recognize(canvas, {}, { blocks: true, text: false }), 180000, 'reading the page took too long');
      if (cancelled) return;
      canvas.width = canvas.height = 0;
      const items = ocrLinesToItems(data, k);
      if (first) { checkpoint(); first = false; }
      p.ocr = items;
      lines += items.length;
    }
    blockCache.clear();
    if (!lines) { toast('No text was recognised', 4000); return; }
    setTool('edittext');
    renderAllLayers();
    toast(`Recognised ${lines} line(s). Tap a block to edit it; Save keeps the text searchable.`, 5000);
  } catch (e) {
    console.error(e);
    if (cancelled) return;
    const offline = !hasBridge && /failed to load|fetch|network/i.test(String(e && (e.message || e)));
    toast(offline ? 'OCR is not downloaded yet: connect to the internet once, then use OCR (or its "Download now" button).' : 'OCR failed: ' + (e.message || e), 7000);
  } finally {
    if (worker) worker.terminate().catch(() => {});
    if (!cancelled) busy(false);
  }
}

// Edit Text on a page without real text (scans, or "Print to PDF" files whose letters were
// turned into shapes): offer OCR instead of showing nothing.
async function offerOcrIfNoText() {
  const p = currentPage();
  if (!p || p.ocr) return;
  let blocks;
  try { blocks = await getTextBlocks(p); } catch (e) { return; }
  if (blocks.length || S.tool !== 'edittext' || offerOcrIfNoText.asked === p.id) return;
  offerOcrIfNoText.asked = p.id;
  const ok = await dialog({
    title: 'No editable text on this page',
    body: 'This page is a scan, or its letters were saved as shapes (common with “Print to PDF”). ' +
      'Recognise the text with OCR so you can edit it?',
    ok: 'Run OCR'
  });
  if (ok) openOcr();
}

// ------------------------------------------------------------------ wiring
(function initEdit2() {
  const viewer = $('#viewer');
  viewer.addEventListener('touchstart', pinchStart, { passive: false });
  viewer.addEventListener('touchmove', pinchMove, { passive: false });
  viewer.addEventListener('touchend', pinchEnd);
  viewer.addEventListener('touchcancel', pinchEnd);

  // A second finger cancels whatever the first one started (drawing, dragging).
  const pagesEl = $('#pages');
  pagesEl.addEventListener('pointerdown', e => {
    activePointers.add(e.pointerId);
    if (activePointers.size > 1 || pinch.on) { cancelGesture(); e.stopImmediatePropagation(); }
  }, true);
  const drop = e => { activePointers.delete(e.pointerId); };
  pagesEl.addEventListener('pointerup', drop, true);
  pagesEl.addEventListener('pointercancel', drop, true);
  pagesEl.addEventListener('pointermove', e => { if (pinch.on) e.stopImmediatePropagation(); }, true);

  initCrop();
  $('#propCropImg').onclick = openCrop;
  $('#propReplaceImg').onclick = () => pickFile('#fileReplaceImg');
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  inp.id = 'fileReplaceImg';
  inp.hidden = true;
  inp.onchange = () => { if (inp.files[0]) replaceSelectedImage(inp.files[0]); };
  document.body.appendChild(inp);
})();
