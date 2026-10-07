// DermScholar studio: turns anything the user reads into something they can listen to,
// question, study and remember. Import → Understand → Listen → Ask → Learn → Review.
// Builds on app.js through window.DS (see "shared with studio.js" there).
(() => {
  'use strict';
  const D = window.DS;
  const { $, $$, esc, icon, md, sheet, closeSheet, toast, store, db, go, render, actions, ext } = D;
  const docsMod = () => import('./docs.js');
  const Native = D.Native;

  const TYPES = { paper: 'Research paper', book: 'Book', article: 'Article', notes: 'Study material', document: 'Document' };
  const LEVELS = { beginner: 'Beginner', general: 'General', advanced: 'Advanced', expert: 'Expert' };
  const aiPrefs = Object.assign({ level: 'general', lang: 'Hindi' }, store.get('aiPrefs', {}));
  const saveAiPrefs = () => store.set('aiPrefs', aiPrefs);
  const LANGS = ['English', 'Hindi', 'Spanish', 'French', 'German', 'Arabic', 'Chinese', 'Japanese', 'Portuguese', 'Bengali', 'Tamil', 'Telugu', 'Marathi', 'Urdu', 'Russian', 'Italian', 'Korean'];
  const LANG_CODE = { English: 'en', Hindi: 'hi', Spanish: 'es', French: 'fr', German: 'de', Arabic: 'ar', Chinese: 'zh', Japanese: 'ja', Portuguese: 'pt', Bengali: 'bn', Tamil: 'ta', Telugu: 'te', Marathi: 'mr', Urdu: 'ur', Russian: 'ru', Italian: 'it', Korean: 'ko' };

  // ================================================================ helpers
  const routeFor = (a) => (a.doc ? 'doc/' : a.utd ? 'utd/' + encodeURIComponent(a.utdUrl || '') + '#' : D.pdfKeys.has(a.id) ? 'pdf/' : a.imported ? 'pdf/' : 'read/') + (a.utd ? '' : encodeURIComponent(a.id));
  const aiNeedsKey = (e) => e && e.message === 'NO_KEY';
  const plain = (mdText) => String(mdText).replace(/\[¶[^\]]*\]/g, '').replace(/\*\*|__/g, '').replace(/^#+\s*/gm, '').replace(/^[-*•]\s+/gm, '').trim();
  /** Markdown answer → lines to speak. */
  const speakLines = (mdText) => plain(mdText).split(/\n+/).map((t) => t.trim()).filter((t) => t.length > 1).map((t) => ({ t }));
  const estMinutes = (words) => Math.max(1, Math.round((words * 5.8) / ((D.speech?.CHARS_PER_SEC || 14.5) * 60)));
  const progressOf = (key) => {
    const p = store.get('ttspos.' + key, null);
    return p && p.n ? (p.done ? 1 : p.i / p.n) : 0;
  };
  function cover(title, sub = '', big = false) {
    const words = String(title).replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter((w) => w.length > 2).slice(0, 5).join(' ');
    return `<div class="dcover ${big ? 'big' : ''}" style="${D.coverStyle(title)}"><span>${esc(sub)}</span><b>${esc(words || title)}</b></div>`;
  }

  // ================================================================ documents: import
  let pendingOcr = {};
  let ocrSeq = 0;
  function ocr(kind, arg) {
    return new Promise((resolve, reject) => {
      const id = 'ocr' + (++ocrSeq);
      pendingOcr[id] = (evt) => (evt.error ? reject(new Error(evt.error)) : resolve(evt.result));
      if (kind === 'import') Native.ocrImport(id, arg); else Native.ocrPage(id, arg);
    });
  }
  ext.events.ocr = (evt) => { const f = pendingOcr[evt.id]; delete pendingOcr[evt.id]; if (f) f(evt); };

  function busy(title, msg) {
    sheet(`<div class="busy"><div class="spinner"></div><b>${esc(title)}</b><span id="busymsg">${esc(msg || '')}</span></div>`);
  }
  const busyMsg = (m) => { const e = $('#busymsg'); if (e) e.textContent = m; };

  /** Saves a parsed document to the library and offers to listen straight away. */
  async function addDocument(model, { key, kind = '', source = '', url = '', quiet = false } = {}) {
    const docs = await docsMod();
    model.docType = model.docType || docs.detectType(model, kind);
    model.key = key;
    model.kind = 'doc';
    model.words = docs.wordCount(model);
    model.added = Date.now();
    await db.putReflow(model);
    const entry = {
      id: key, doc: true, imported: true, title: model.title, authors: model.author || '', journal: model.site || TYPES[model.docType],
      docType: model.docType, source, sourceUrl: url || model.source || '', year: new Date().getFullYear(), types: [], abstract: '',
      savedAt: Date.now(), status: 'unread', collections: [], notes: '', words: model.words,
    };
    await db.put(entry);
    D.saved.set(key, entry);
    if (!quiet) offerListen(entry);
    return entry;
  }

  function offerListen(entry) {
    const mins = estMinutes(entry.words || 0);
    sheet(`<div class="offer">${cover(entry.title, TYPES[entry.docType] || 'Document', true)}
      <h3>${esc(entry.title)}</h3>
      <p class="muted small">${esc(TYPES[entry.docType] || 'Document')}${entry.authors ? ' · ' + esc(entry.authors) : ''} · about ${mins} min to listen</p>
      <button class="btn primary full big" data-act="offer-listen">${icon('play')}Listen now</button>
      <div class="row-btns"><button class="btn" data-act="offer-read">${icon('book')}Read</button>
        <button class="btn" data-act="offer-brief">${icon('spark')}Quick brief</button>
        <button class="btn" data-act="offer-pod">${icon('mic')}Podcast</button></div></div>`);
    actions['offer-listen'] = () => { closeSheet(true); go(routeFor(entry) + '?listen=1'); };
    actions['offer-read'] = () => { closeSheet(true); go(routeFor(entry)); };
    actions['offer-brief'] = () => { closeSheet(true); go(routeFor(entry) + '?ai=brief'); };
    actions['offer-pod'] = () => { closeSheet(true); go(routeFor(entry) + '?ai=discuss'); };
  }

  const MIME = {
    text: /^text\/(plain|x-markdown|markdown|csv)|^application\/(x-)?markdown/,
    html: /^text\/html|^application\/xhtml/,
    epub: /epub/,
    docx: /officedocument\.wordprocessingml|msword/,
    image: /^image\//,
  };

  let photoPages = null; // pages collected in a photo session
  async function onDocReceived(evt) {
    const { key, name = 'Document', mime = '' } = evt;
    const lower = name.toLowerCase();
    try {
      if (MIME.image.test(mime)) { await addPhotoPage(key); return; }
      busy('Preparing your document', name);
      const docs = await docsMod();
      const res = await fetch('/import/' + encodeURIComponent(key));
      if (!res.ok) throw new Error('The file could not be read');
      let model;
      let kind = '';
      if (MIME.epub.test(mime) || lower.endsWith('.epub')) { model = await docs.fromEpub(await res.arrayBuffer(), { name }); kind = 'epub'; }
      else if (MIME.docx.test(mime) || lower.endsWith('.docx')) model = await docs.fromDocx(await res.arrayBuffer(), { name });
      else if (MIME.html.test(mime) || /\.x?html?$/.test(lower)) { model = docs.fromHtml(await res.text(), { title: '' }); }
      else if (MIME.text.test(mime) || /\.(txt|md|markdown|text)$/.test(lower)) model = docs.fromText(await res.text(), { title: name.replace(/\.(txt|md|markdown|text)$/i, ''), markdown: /\.(md|markdown)$/i.test(lower) || /markdown/.test(mime) });
      else throw new Error(`${name} isn't a supported type. Try PDF, EPUB, Word (.docx), text, Markdown, a web page or a photo.`);
      if (model.blocks.length < 2) throw new Error('No readable text found in ' + name);
      closeSheet(true);
      await addDocument(model, { key, kind, source: name });
    } catch (e) {
      closeSheet(true);
      toast(e.message || 'Import failed');
    }
  }
  ext.events.docReceived = onDocReceived;

  async function addPhotoPage(key) {
    busy('Reading the page', 'Recognising text on this phone…');
    try {
      const page = await ocr('import', key);
      Native.deleteImport?.(key);
      const words = page.blocks.reduce((n, b) => n + b.lines.reduce((m, l) => m + (l.t.match(/\S+/g) || []).length, 0), 0);
      if (!words) throw new Error('No text found in that photo. Try again with the page flat and well lit.');
      photoPages = photoPages || [];
      photoPages.push(page);
      const n = photoPages.length;
      const preview = page.blocks.slice(0, 3).map((b) => b.lines.map((l) => l.t).join(' ')).join(' ').slice(0, 220);
      sheet(`<h3>Page ${n} recognised</h3><p class="muted small">${words} words${n > 1 ? ` · ${n} pages so far` : ''}</p>
        <blockquote class="quote-box">${esc(preview)}…</blockquote>
        <div class="row-btns"><button class="btn" data-act="photo-more">${icon('camera')}Add a page</button>
          <button class="btn" data-act="photo-gallery">${icon('upload')}From gallery</button></div>
        <button class="btn primary full" data-act="photo-done" style="margin-top:10px">${icon('check')}Done — make it listenable</button>
        <p class="muted small">Text recognition runs on this phone (Latin-script languages). You can fix mistakes after, or let AI tidy it.</p>`);
      actions['photo-more'] = () => { closeSheet(true); Native.takePhoto(); };
      actions['photo-gallery'] = () => { closeSheet(true); Native.pickDocument(true); };
      actions['photo-done'] = async () => {
        const docs = await docsMod();
        const pages = photoPages;
        photoPages = null;
        closeSheet(true);
        const model = docs.fromOcr(pages);
        await addDocument(model, { key: 'scan_' + Date.now(), kind: 'scan', source: 'Photo' });
      };
    } catch (e) {
      closeSheet(true);
      toast(e.message || 'Text recognition failed');
    }
  }

  // Web pages and shared links
  const pagePending = {};
  let pageSeq = 0;
  function fetchPage(url) {
    return new Promise((resolve, reject) => {
      const id = 'pg' + (++pageSeq);
      pagePending[id] = (evt) => (evt.error ? reject(new Error(evt.error)) : resolve(evt));
      Native.fetchPage(id, url);
    });
  }
  ext.events.pageFetched = (evt) => { const f = pagePending[evt.id]; delete pagePending[evt.id]; if (f) f(evt); };

  async function importUrl(url) {
    url = url.trim();
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    busy('Opening the page', url.replace(/^https?:\/\//, '').slice(0, 60));
    try {
      const r = await fetchPage(url);
      if (r.pdf) { closeSheet(true); await D.syncPdfs(); D.openReader(r.key); return; }
      busyMsg('Finding the article…');
      const docs = await docsMod();
      const html = await (await fetch('/import/' + encodeURIComponent(r.key))).text();
      const model = docs.fromHtml(html, { url: r.url || url });
      closeSheet(true);
      await addDocument(model, { key: r.key, kind: 'web', source: model.site || 'Web', url: r.url || url });
    } catch (e) {
      closeSheet(true);
      // A login-only link (MyLOFT, publisher, library proxy): open it in the in-app browser,
      // where signing in works and a PDF opened there is saved (to the waiting paper, if any).
      if (/ 40[13]\b/.test(e.message || '')) {
        const w = D.waitingPaper?.();
        toast('That page needs a sign-in: opening it here. Open the PDF and it is saved' + (w ? ' to your paper' : '') + '.');
        Native.openPortal(url, w?.id || '', w?.title || '');
        return;
      }
      toast(e.message || "Couldn't read that page");
    }
  }

  async function importText(text, title = '') {
    const docs = await docsMod();
    const model = docs.fromText(text, { title });
    if (model.blocks.length < 2) { toast('Paste a little more text'); return; }
    await addDocument(model, { key: 'text_' + Date.now(), source: 'Pasted text' });
  }

  // "Read anything": text or a link shared from another app.
  ext.events.sharedText = (evt) => {
    const text = String(evt.text || '').trim();
    const url = text.match(/https?:\/\/[^\s<>"]+/);
    // Links shared back from MyLOFT only open with its sign-in: straight to the in-app browser.
    const w = D.waitingPaper?.();
    // A paper is waiting for MyLOFT and MyLOFT sent back the article's link, not its PDF: that link
    // only opens inside MyLOFT (its sign-in lives there), so say what to do instead of opening it here.
    if (url && w && !/myloft/i.test(url[0]) && text.length < url[0].length + 200) {
      sheet(`<h3>MyLOFT sent the link, not the PDF</h3>
        <p class="small">The link only opens with access <b>inside MyLOFT</b>. In MyLOFT, open the article, tap <b>PDF</b> or <b>Download</b>, then <b>Share</b> the PDF file → <b>DermScholar</b>. It files itself under “${esc((w.title || '').slice(0, 70))}”.</p>
        <p class="small">If MyLOFT shows only the abstract, with no PDF or Download button, your library doesn't subscribe to this journal either: neither route has the PDF. Then ask the author for a copy (the paper's corresponding author email), or look for a free version later.</p>
        <button class="btn primary full" data-act="ml-back">Back to MyLOFT</button>
        <button class="btn full" data-act="ml-anyway" style="margin-top:8px">Open the link here anyway</button>`);
      actions['ml-back'] = () => { closeSheet(true); Native.openMyLoftApp?.(); };
      actions['ml-anyway'] = () => { closeSheet(true); importUrl(url[0]); };
      return;
    }
    if (url && /myloft/i.test(url[0])) {
      const open = () => Native.openPortal(url[0], w?.id || '', w?.title || '');
      // The first few times: explain the one-time MyLOFT sign-in in DermScholar's own browser.
      const shown = store.get('mlWebHint', 0);
      if (shown >= 3) { open(); return; }
      store.set('mlWebHint', shown + 1);
      sheet(`<h3>Opening the MyLOFT link</h3>
        <p class="small">If MyLOFT asks you to sign in, sign in <b>once</b> here (same login as the MyLOFT app). DermScholar remembers it, so MyLOFT links then open with your institution's access.</p>
        <p class="small">Then open the article's <b>PDF</b>: it is saved${w ? ` to “${esc((w.title || '').slice(0, 60))}”` : ' to your library'}.</p>
        <button class="btn primary full" data-act="ml-open">Open</button>`);
      actions['ml-open'] = () => { closeSheet(true); open(); };
      return;
    }
    if (url && text.length < url[0].length + 200) importUrl(url[0]);
    else importText(text, evt.subject || '');
  };

  function addDocSheet() {
    sheet(`<h3>Add something to listen to</h3>
      <div class="add-grid">
        <button class="add-opt" data-act="add-file">${icon('file')}<b>File</b><span>PDF, EPUB, Word, text, Markdown</span></button>
        <button class="add-opt" data-act="add-photo">${icon('camera')}<b>Photo of a page</b><span>Printed pages, handouts</span></button>
        <button class="add-opt" data-act="add-link">${icon('link')}<b>Web link</b><span>Articles and blog posts</span></button>
        <button class="add-opt" data-act="add-text">${icon('type')}<b>Paste text</b><span>Anything you copied</span></button>
      </div>
      <p class="muted small">Tip: in Chrome or any app, <b>Share → DermScholar</b> sends a page, text or file straight here.</p>`);
  }
  Object.assign(actions, {
    'add-doc': () => addDocSheet(),
    'add-file': () => { closeSheet(true); Native.pickDocument(false); },
    'add-photo': () => { closeSheet(true); photoPages = null; Native.takePhoto(); },
    'add-link': () => {
      sheet(`<h3>Listen to a web page</h3><input type="url" id="addurl" placeholder="https://…" autocomplete="off" inputmode="url">
        <button class="btn primary full" data-act="add-link-go" style="margin-top:10px">${icon('play')}Get the article</button>
        <p class="muted small">The article text is extracted without ads or menus and saved to your library.</p>`);
      setTimeout(() => $('#addurl')?.focus(), 50);
      actions['add-link-go'] = () => { const v = $('#addurl').value.trim(); if (v) importUrl(v); };
    },
    'add-text': () => {
      sheet(`<h3>Paste text</h3><input id="addtitle" placeholder="Title (optional)"><textarea id="addtext" rows="8" placeholder="Paste or type here…" style="margin-top:8px"></textarea>
        <button class="btn primary full" data-act="add-text-go" style="margin-top:10px">${icon('check')}Save and listen</button>`);
      setTimeout(() => $('#addtext')?.focus(), 50);
      actions['add-text-go'] = () => { const v = $('#addtext').value; if (v.trim().length < 20) { toast('Paste a little more text'); return; } closeSheet(true); importText(v, $('#addtitle').value.trim()); };
    },
    'go-notes': () => go('notes'),
  });

  // ================================================================ documents: reader
  ext.routes.doc = async (key) => {
    D.readerLoading && (document.querySelector('#view').innerHTML = D.readerTop(D.saved.get(key)?.title || 'Document') + D.readerLoading('Opening…'));
    const model = await db.getReflow(key).catch(() => null);
    if (!model) { document.querySelector('#view').innerHTML = D.topbar('Document') + D.errorBox(new Error('This document is no longer on this phone'), false); return; }
    if (D.current.name !== 'doc' || D.current.arg !== key) return;
    const a = D.saved.get(key);
    const endNote = `${TYPES[model.docType] || 'Document'}${a?.source ? ' · from ' + a.source : ''} · ${model.words || ''} words · the original is kept on this phone`;
    D.showReader(model, { key, title: a?.title || model.title, doc: true, endNote, sourceUrl: a?.sourceUrl });
  };

  /** Scanned PDFs: recognise text page by page, then show the mobile view. */
  async function ocrPdf(key) {
    const title = D.saved.get(key)?.title || 'PDF';
    busy('Recognising text', 'Preparing pages…');
    try {
      const mod = await import('./reflow.js');
      const docs = await docsMod();
      const pdf = await mod.openPdf('/pdf/' + encodeURIComponent(key));
      const pages = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        busyMsg(`Page ${n} of ${pdf.numPages}…`);
        const canvas = await mod.renderPage(pdf, n, 1100, 1.6);
        pages.push(await ocr('page', canvas.toDataURL('image/jpeg', 0.85)));
      }
      const model = docs.fromOcr(pages, { title: title === 'PDF' ? '' : title });
      Object.assign(model, { key, kind: 'pdf', v: D.REFLOW_V, ocr: true, scanned: false, pages: pdf.numPages });
      await db.putReflow(model);
      closeSheet(true);
      toast('Text recognised — ready to listen');
      render();
    } catch (e) {
      closeSheet(true);
      toast(e.message || 'Text recognition failed');
    }
  }

  ext.readerMenu = (opts, model) => {
    const k = opts.key;
    return `<button class="opt" data-act="hub-pod">${icon('mic')}Podcast: hear two hosts talk it through</button>
      <button class="opt" data-act="hub-open">${icon('spark')}AI: brief, ask, study</button>
      <button class="opt" data-act="study-open">${icon('school')}Study mode</button>
      ${opts.pdf ? `<button class="opt" data-act="rd-ocr">${icon('camera')}${model.ocr ? 'Recognise text again (OCR)' : 'Recognise text (for scanned PDFs)'}</button>` : ''}
      ${(opts.doc || opts.pdf) && model.blocks.filter((b) => b.type === 'h').length < 3 && (model.words || 0) > 1500 ? `<button class="opt" data-act="rd-titles">${icon('list')}Add section titles with AI</button>` : ''}
      ${model.ocr ? `<button class="opt" data-act="rd-tidy">${icon('spark')}Fix recognition errors with AI</button>` : ''}
      ${opts.sourceUrl ? `<button class="opt" data-act="rd-source">${icon('external')}Open the original page</button>` : ''}
      ${opts.doc ? `<button class="opt danger" data-act="rd-delete" data-k="${esc(k)}">${icon('trash')}Delete this document</button>` : ''}`;
  };
  Object.assign(actions, {
    'rd-ocr': () => { closeSheet(true); ocrPdf(D.reader.opts.key); },
    'rd-source': () => { closeSheet(true); window.open(D.reader.opts.sourceUrl, '_blank'); },
    'rd-titles': () => { closeSheet(true); aiSectionTitles(); },
    'rd-tidy': () => { closeSheet(true); aiTidyOcr(); },
    'rd-delete': async (b) => {
      const k = b.dataset.k;
      closeSheet(true);
      await db.del(k); await db.delReflow(k).catch(() => {});
      Native.deleteImport?.(k);
      D.saved.delete(k);
      setMarks(allMarks().filter((m) => m.key !== k));
      store.set('ttspos.' + k, null);
      toast('Document deleted from this phone');
      go('library', { replace: true });
    },
  });

  // ================================================================ reader: explain, highlights, notes
  const allMarks = () => store.get('marks', []);
  const setMarks = (l) => store.set('marks', l);
  function applyMarks(key) {
    const marks = allMarks().filter((m) => m.key === key);
    $$('#rd [data-b]').forEach((el) => {
      const ms = marks.filter((m) => String(m.b) === el.dataset.b);
      el.classList.toggle('hl', ms.some((m) => m.kind === 'highlight' || m.kind === 'note'));
      el.querySelector(':scope > .mk')?.remove();
      if (ms.some((m) => m.note || m.kind === 'ai')) el.insertAdjacentHTML('beforeend', `<button class="mk" data-act="mark-open" data-b="${el.dataset.b}" aria-label="Your note">${icon('note')}</button>`);
    });
  }

  let selTimer;
  ext.onReader = (model, opts) => {
    applyMarks(opts.key);
    const rd = $('#rd');
    if (!rd) return;
    // Long press on a paragraph: explain, highlight, note, listen from here.
    rd.addEventListener('contextmenu', (e) => {
      const el = e.target.closest('[data-b]');
      if (!el || e.target.closest('a')) return;
      e.preventDefault();
      paraSheet(el);
    });
    if (opts.pdf && model.scanned) {
      rd.insertAdjacentHTML('afterbegin', `<div class="banner">${icon('camera')}<div><b>This PDF is scanned</b><span>Recognise its text to read it here, listen and ask questions.</span></div><button class="btn xs primary" data-act="rd-ocr">Recognise</button></div>`);
    }
    if (D.current.params.ai) setTimeout(() => openHub(D.current.params.ai), 200);
  };
  // Selecting a sentence shows an Explain chip.
  document.addEventListener('selectionchange', () => {
    clearTimeout(selTimer);
    selTimer = setTimeout(() => {
      const sel = window.getSelection();
      const text = sel && String(sel).trim();
      const rd = $('#rd');
      let chip = $('#selchip');
      if (!text || text.length < 3 || !rd || !sel.anchorNode || !rd.contains(sel.anchorNode)) { chip?.remove(); return; }
      if (!chip) {
        document.body.insertAdjacentHTML('beforeend', `<button id="selchip" class="sel-chip" data-act="sel-explain">${icon('spark')}Explain</button>`);
        chip = $('#selchip');
      }
      chip.dataset.text = text.slice(0, 2000);
      const el = sel.anchorNode.parentElement?.closest('[data-b]');
      chip.dataset.b = el ? el.dataset.b : '';
    }, 250);
  });
  actions['sel-explain'] = (b) => {
    const el = b.dataset.b ? $(`#rd [data-b="${b.dataset.b}"]`) : null;
    const text = b.dataset.text;
    b.remove();
    window.getSelection()?.removeAllRanges();
    paraSheet(el, text);
  };

  const EXPLAIN = {
    simple: ['Simple', 'Explain this in simple, everyday words (as if to a curious 12-year-old), in a short paragraph.'],
    detailed: ['Detailed', 'Explain this in detail: what it says, the concepts behind it and why it matters here.'],
    expert: ['Expert', 'Explain this at expert level: mechanisms, nuances, how it fits the wider evidence, and caveats.'],
    example: ['Example', 'Give one or two concrete, real-world examples that make this clear.'],
    terms: ['Define terms', 'Define each technical term, abbreviation and drug or disease name in this passage, as "- **term**: definition" bullets.'],
    summary: ['Summarise', 'Summarise this passage in two or three sentences.'],
    translate: ['Translate', ''],
  };

  function contextFor(el) {
    const model = D.reader?.model;
    if (!model || !el) return '';
    const i = +el.dataset.b;
    const parts = [];
    for (let j = Math.max(0, i - 3); j <= Math.min(model.blocks.length - 1, i + 1); j++) {
      const b = model.blocks[j];
      const t = (b.text ?? (b.html || '').replace(/<[^>]+>/g, ' ')).trim();
      if (t) parts.push(`[¶${j}] ${t}`);
    }
    return parts.join('\n');
  }
  function paraSheet(el, selected) {
    const text = selected || (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
    if (!text) return;
    const key = D.reader?.opts.key;
    const b = el ? el.dataset.b : '';
    sheet(`<blockquote class="quote-box">${esc(text.length > 320 ? text.slice(0, 318) + '…' : text)}</blockquote>
      <label class="field" style="margin-top:6px">Explain with AI <span class="muted small">· ${esc(LEVELS[aiPrefs.level])} level</span></label>
      <div class="chips-wrap">${Object.entries(EXPLAIN).map(([k, [l]]) => `<button class="chip" data-act="ex-run" data-k="${k}">${k === 'translate' ? icon('translate') : icon('spark')}${l}${k === 'translate' ? ` · ${esc(aiPrefs.lang)}` : ''}</button>`).join('')}</div>
      <div id="exout"></div>
      <div class="row-btns wrap" style="margin-top:12px">
        ${el ? `<button class="btn xs" data-act="p-listen">${icon('play')}Listen from here</button>` : ''}
        ${el ? `<button class="btn xs" data-act="p-hl">${icon('highlight')}Highlight</button>` : ''}
        <button class="btn xs" data-act="p-note">${icon('note')}Note</button>
        <button class="btn xs" data-act="p-copy">${icon('file')}Copy</button>
        <button class="btn xs" data-act="p-share">${icon('share')}Share</button></div>`);
    $('.sheet').classList.add('tall');
    let lastAnswer = null;
    actions['ex-run'] = async (bt) => {
      const k = bt.dataset.k;
      if (k === 'translate' && !bt.dataset.lang) { pickLang((lang) => { bt.dataset.lang = lang; actions['ex-run'](bt); }); return; }
      const lang = bt.dataset.lang || aiPrefs.lang;
      const out = $('#exout');
      out.innerHTML = '<div class="ai-wait"><div class="spinner"></div>Thinking…</div>';
      const model = D.reader?.model;
      const task = `${model ? '' : `Context from the document "${D.reader?.opts.title || ''}":\n${contextFor(el)}\n\n`}Passage${b !== '' ? ` [¶${b}]` : ''}:\n"""${text}"""\n\n`
        + (k === 'translate' ? `Translate the passage into ${lang}. Give only the translation, keeping numbers and names.` : EXPLAIN[k][1])
        + ` Reader level: ${LEVELS[aiPrefs.level]}. Base it on the document; if you add general background, say so.`;
      try {
        const ans = await D.ai(task, model ? { docModel: model, focus: 'query', query: text, max: 3000 } : { max: 3000 });
        lastAnswer = { mode: k, text: ans, lang };
        out.innerHTML = `<div class="ai-body">${md(ans)}</div>
          <div class="row-btns"><button class="btn xs" data-act="ex-listen">${icon('audio')}Read aloud</button>
            <button class="btn xs" data-act="ex-save">${icon('bookmark')}Save to notes</button></div>`;
      } catch (e) {
        out.innerHTML = aiNeedsKey(e) ? keyPrompt() : `<p class="muted small">${esc(e.message)}</p>`;
      }
    };
    actions['ex-listen'] = () => {
      if (!lastAnswer) return;
      const lines = speakLines(lastAnswer.text);
      if (lastAnswer.mode === 'translate') {
        const v = voiceForLang(lastAnswer.lang);
        if (!v) toast(`No ${lastAnswer.lang} voice installed — reading with the default voice`);
        lines.forEach((l) => { l.voice = v || ''; });
      }
      D.ttsPlayScript(lastAnswer.mode === 'translate' ? `Translation (${lastAnswer.lang})` : 'Explanation', lines);
    };
    actions['ex-save'] = () => {
      if (!lastAnswer || !key) return;
      addMark({ key, b: b === '' ? null : +b, text, kind: 'ai', note: '', ai: { mode: EXPLAIN[lastAnswer.mode][0], answer: lastAnswer.text } });
      toast('Saved to My notes');
    };
    actions['p-listen'] = () => { closeSheet(true); D.ttsPlay(D.tts.els.indexOf(el) >= 0 ? D.tts.els.indexOf(el) : undefined).then(() => { const i = D.tts.els.indexOf(el); if (i >= 0) Native.ttsSeek(i); }); };
    actions['p-hl'] = () => { addMark({ key, b: +b, text, kind: 'highlight' }); closeSheet(true); applyMarks(key); toast('Highlighted'); };
    actions['p-note'] = () => noteSheet({ key, b: b === '' ? null : +b, text });
    actions['p-copy'] = () => D.copyText(text);
    actions['p-share'] = () => Native.share(D.reader?.opts.title || 'Passage', `“${text}”\n— ${D.reader?.opts.title || ''}`);
  }

  function pickLang(cb) {
    sheet(`<h3>Translate into</h3><div class="chips-wrap">${LANGS.map((l) => `<button class="chip ${aiPrefs.lang === l ? 'on' : ''}" data-act="lang-pick" data-v="${l}">${l}</button>`).join('')}</div>`);
    actions['lang-pick'] = (b) => { aiPrefs.lang = b.dataset.v; saveAiPrefs(); closeSheet(true); cb(b.dataset.v); };
  }
  function voiceForLang(lang) {
    const code = LANG_CODE[lang];
    const v = D.voiceList().filter((x) => String(x.lang || '').toLowerCase().startsWith(code));
    return v.find((x) => !x.network)?.name || v[0]?.name || '';
  }

  function addMark(m) {
    const doc = D.saved.get(m.key);
    const list = allMarks();
    list.unshift({ id: 'm' + Date.now(), t: Date.now(), docTitle: D.reader?.opts.title || doc?.title || '', route: location.hash.replace(/^#\/?/, '').split('?')[0], ...m });
    setMarks(list);
  }
  function noteSheet({ key, b, text, id }) {
    const existing = id ? allMarks().find((m) => m.id === id) : null;
    sheet(`<h3>${existing ? 'Edit note' : 'Add a note'}</h3>${text ? `<blockquote class="quote-box">${esc(text.slice(0, 240))}</blockquote>` : ''}
      <textarea id="notetext" rows="5" placeholder="Your note…">${esc(existing?.note || '')}</textarea>
      <button class="btn primary full" data-act="note-save" style="margin-top:10px">Save note</button>
      ${existing ? `<button class="btn full" data-act="note-del" style="margin-top:8px">${icon('trash')}Delete</button>` : ''}`);
    setTimeout(() => $('#notetext')?.focus(), 50);
    actions['note-save'] = () => {
      const v = $('#notetext').value.trim();
      if (existing) { setMarks(allMarks().map((m) => (m.id === id ? { ...m, note: v } : m))); }
      else if (v) addMark({ key, b, text, kind: 'note', note: v });
      closeSheet(true);
      if (D.reader?.opts.key === key) applyMarks(key);
      if (D.current.name === 'notes') render();
      toast('Note saved');
    };
    actions['note-del'] = () => { setMarks(allMarks().filter((m) => m.id !== id)); closeSheet(true); if (D.reader) applyMarks(D.reader.opts.key); if (D.current.name === 'notes') render(); };
  }
  actions['mark-open'] = (b) => {
    const key = D.reader?.opts.key;
    const ms = allMarks().filter((m) => m.key === key && String(m.b) === b.dataset.b);
    sheet(`<h3>Your notes here</h3>${ms.map((m) => `<div class="note-card">${m.note ? `<p>${esc(m.note)}</p>` : ''}
      ${m.ai ? `<div class="muted small">✦ AI · ${esc(m.ai.mode)}</div><div class="ai-body">${md(m.ai.answer)}</div>` : ''}
      <div class="row-btns"><button class="btn xs" data-act="note-edit" data-id="${m.id}">Edit</button><button class="btn xs" data-act="mark-del" data-id="${m.id}">${icon('trash')}Remove</button></div></div>`).join('')}`);
    actions['note-edit'] = (x) => { const m = allMarks().find((y) => y.id === x.dataset.id); noteSheet({ key, b: m.b, text: m.text, id: m.id }); };
    actions['mark-del'] = (x) => { setMarks(allMarks().filter((y) => y.id !== x.dataset.id)); closeSheet(true); applyMarks(key); };
  };

  // ================================================================ AI studio (per document)
  const aiStore = store.get('studio', {});
  const saveStudio = () => {
    const keys = Object.keys(aiStore);
    if (keys.length > 120) keys.sort((a, b) => (aiStore[a].t || 0) - (aiStore[b].t || 0)).slice(0, keys.length - 120).forEach((k) => delete aiStore[k]);
    store.set('studio', aiStore);
  };
  const entryFor = (key) => (aiStore[key] = aiStore[key] || { qa: [] });

  const provider = () => { try { return Native.aiProvider?.() || 'groq'; } catch { return 'groq'; } };
  function keyPrompt() {
    const p = provider();
    const info = {
      groq: ['Groq', 'AI features run on Groq with your own key. Create one free at <b>console.groq.com/keys</b> (it starts with gsk_).', 'gsk_…'],
      gemini: ['Gemini', 'Free key from <b>aistudio.google.com/apikey</b> (no card needed). Best for evidence maps over many papers.', 'Paste your Gemini key'],
      claude: ['Claude', 'AI features use your own Anthropic key. Create one at <b>console.anthropic.com</b> → API keys.', 'sk-ant-…'],
      openrouter: ['OpenRouter', 'Free key from <b>openrouter.ai</b> → Keys (no card needed; it starts with sk-or-). Answers when Groq and Gemini are busy: a free model first, then your credit if you add some.', 'sk-or-…'],
    }[p] || ['Groq', '', 'gsk_…'];
    return `<div class="key-prompt">${icon('spark')}<div><b>Add your ${info[0]} API key</b><span>${info[1]}</span></div>
      <input type="password" id="aikey" placeholder="${info[2]}" autocomplete="off"><button class="btn primary full" data-act="ai-savekey" style="margin-top:8px">Save key</button>
      <p class="muted small">Stored encrypted on this phone. Only the text you use AI on is sent to ${info[0]}.</p></div>`;
  }
  actions['ai-savekey'] = () => {
    // Pasted keys often carry spaces, line breaks, quotes or invisible characters; strip them all.
    const v = ($('#aikey')?.value || '').replace(/[\s\u200B-\u200D\u2060\uFEFF'"`“”‘’]/g, '');
    if (v.length < 20) { toast('That key looks too short — copy the whole key and paste it again'); return; }
    // Known prefixes pick the AI; anything else (e.g. Google's newer key formats) goes to the AI selected above.
    Native.aiSetKey(v, provider());
    ext.secretsChanged?.();
    toast(/^sk-or-/.test(v) && provider() !== 'openrouter' ? 'OpenRouter key saved · answers when Groq and Gemini are busy' : 'Key saved');
    if (hubState) drawHub(); else closeSheet(true);
    if (D.current.name === 'settings') render();
    if (/^gsk_/.test(v)) Native.aiListModels?.();
  };

  /** Where the AI's text comes from: the open reader, a stored model, or an abstract. */
  async function sourceFor(key, fallback) {
    if (D.reader && D.reader.opts.key === key) return { model: D.reader.model, text: '', type: D.reader.model.docType || 'paper', title: D.reader.opts.title };
    const model = await db.getReflow(key).catch(() => null);
    if (model) return { model, text: '', type: model.docType || 'paper', title: model.title };
    return fallback ? fallback() : null;
  }
  /** Options for D.ai() that send this source (whole, or excerpts when the account limit is small). */
  const docOpts = (src, extra = {}) => (src.model ? { docModel: src.model, ...extra } : { doc: src.text, ...extra });

  const TYPE_HINT = {
    paper: 'This is a research paper: distinguish background, methods, results and discussion, and give effect sizes, sample sizes and statistics.',
    book: 'This is a book: focus on its main ideas, arguments and chapter structure.',
    article: 'This is an article: focus on its main points and evidence.',
    notes: 'These are lecture or study notes: focus on the concepts to learn and explain them clearly.',
    document: '',
  };

  const TASKS = {
    brief: {
      label: 'Quick Brief', icon: 'play',
      prompt: (t) => `Write a Quick Brief of this document that takes 1–3 minutes to read aloud (250–400 words). ${TYPE_HINT[t]}
Use these "## " sections: What it's about · Main question · Main findings · Conclusions · Limitations. Keep key numbers. Cite passages as [¶n] after claims.`,
      max: 2500,
    },
    long: {
      label: '5-minute summary', icon: 'clock',
      prompt: (t) => `Write a detailed spoken summary of this document that takes about 5 minutes to read aloud (650–850 words). ${TYPE_HINT[t]}
Follow the document's own structure with "## " sections. Keep key numbers exact. Cite passages as [¶n] after claims.`,
      max: 5000,
    },
    takeaways: {
      label: 'Key takeaways', icon: 'bulb',
      prompt: (t) => `List the 7–12 most important takeaways of this document as "- " bullets: one sentence each, with the key number where there is one, and a [¶n] citation. ${TYPE_HINT[t]}`,
      max: 2500,
    },
  };

  let hubState = null; // {key, title, tab, fallback}
  function openHub(tab = 'brief', opts = {}) {
    const key = opts.key || D.reader?.opts.key;
    if (!key) { toast('Open a document first'); return; }
    hubState = { key, title: opts.title || D.reader?.opts.title || D.saved.get(key)?.title || 'Document', tab, fallback: opts.fallback, context: opts.context };
    drawHub();
    D.onSheetClose = () => { hubState = null; };
  }

  const TABS = [['brief', 'Brief'], ['discuss', 'Podcast'], ['ask', 'Ask'], ['long', '5-min'], ['takeaways', 'Takeaways'], ['study', 'Study']];
  function drawHub() {
    if (!hubState) return;
    const { key, title, tab } = hubState;
    const e = entryFor(key);
    let body = '';
    if (!D.aiHasKey()) body = keyPrompt();
    else if (TASKS[tab]) {
      const v = e[tab];
      body = v ? `<div class="ai-body">${md(v)}</div>
          <div class="row-btns"><button class="btn primary" data-act="hub-listen">${icon('play')}Listen</button>
            <button class="btn" data-act="hub-copy">${icon('file')}Copy</button><button class="btn" data-act="hub-redo">Regenerate</button></div>`
        : e['busy_' + tab] ? (e['partial_' + tab] ? `<div class="ai-body" id="hub-live">${md(e['partial_' + tab])}<span class="typing">▍</span></div>` : '<div class="ai-wait" id="hub-live"><div class="spinner"></div>Reading the document…</div>')
        : `<button class="btn primary full big" data-act="hub-gen">${icon(TASKS[tab].icon)}Create ${TASKS[tab].label}</button>`;
    } else if (tab === 'ask') {
      body = `${(e.qa || []).map((x) => `<div class="ai-q">${esc(x.q)}</div><div class="ai-body">${x.a ? md(x.a) : '<div class="ai-wait"><div class="spinner"></div>Thinking…</div>'}</div>`).join('')}
        ${(e.qa || []).length ? '' : `<div class="chips-wrap">${['What is this about?', 'What are the main findings?', 'What was the sample size?', 'What are the limitations?', 'Explain it like I\'m 10', 'What did the authors conclude?'].map((q) => `<button class="chip" data-act="hub-ask-q" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>`}
        <div class="ai-ask"><input id="hubq" placeholder="Ask this document…" enterkeyhint="send"><button class="btn primary sm" data-act="hub-ask">Ask</button></div>
        ${(e.qa || []).length ? '<button class="btn xs" data-act="hub-clear" style="margin-top:8px">Clear chat</button>' : ''}`;
    } else if (tab === 'study') {
      body = e.study ? `<p class="small">${e.study.flashcards.length} flashcards · ${e.study.mcqs.length} quiz questions · ${e.study.viva.length} viva questions · ${e.study.glossary.length} glossary terms · revision notes</p>
          <button class="btn primary full big" data-act="study-open">${icon('school')}Open Study mode</button>`
        : e.busy_study ? '<div class="ai-wait"><div class="spinner"></div>Writing flashcards, quiz and notes…</div>'
        : `<p class="small">Flashcards, a multiple-choice quiz ("Test me"), viva and short-answer questions, a glossary and revision notes — all from this document. Flashcards export to Anki.</p>
          <button class="btn primary full big" data-act="study-gen">${icon('school')}Create study set</button>`;
    } else if (tab === 'discuss') {
      body = podcastTab(key);
    }
    const html = `<h3>${icon('spark')} AI studio</h3><p class="muted small ai-title">${esc(title)}</p>
      <div class="hub-tabs">${TABS.map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-act="hub-tab" data-t="${k}">${l}</button>`).join('')}</div>
      <div id="hubbody">${body}</div>
      <p class="muted small">AI-generated from the document. Check important details against the source.</p>`;
    if ($('#hubwrap')) $('#hubwrap').innerHTML = html;
    else { sheet(`<div id="hubwrap">${html}</div>`); $('.sheet').classList.add('tall'); D.onSheetClose = () => { hubState = null; }; }
    $('#hubq')?.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') actions['hub-ask'](); });
  }

  async function runTask(tab) {
    const { key } = hubState;
    const e = entryFor(key);
    const src = await sourceFor(key, hubState.fallback);
    if (!src) { toast('No text to work from'); return; }
    e['busy_' + tab] = true;
    drawHub();
    try {
      // Show the answer while it's being written.
      const live = (t) => {
        e['partial_' + tab] = t;
        const box = $('#hub-live');
        if (box && hubState?.key === key && hubState.tab === tab) box.innerHTML = md(t) + '<span class="typing">▍</span>';
        else if (hubState?.key === key && hubState.tab === tab) drawHub();
      };
      const out = await D.ai(TASKS[tab].prompt(src.type), docOpts(src, { focus: 'summary', max: TASKS[tab].max, onPartial: live }));
      e[tab] = out; e.t = Date.now();
      saveStudio();
    } catch (err) {
      if (!aiNeedsKey(err)) toast(err.message);
    } finally {
      delete e['busy_' + tab];
      delete e['partial_' + tab];
      if (hubState?.key === key) drawHub();
    }
  }

  Object.assign(actions, {
    'ai-reader': () => openHub('brief'),
    'hub-open': () => { closeSheet(true); openHub('brief'); },
    'hub-pod': () => { closeSheet(true); openHub('discuss'); },
    'hub-tab': (b) => { hubState.tab = b.dataset.t; drawHub(); },
    'hub-gen': () => runTask(hubState.tab),
    'hub-redo': () => { delete entryFor(hubState.key)[hubState.tab]; runTask(hubState.tab); },
    'hub-copy': () => D.copyText(`${hubState.title}\n\n${plain(entryFor(hubState.key)[hubState.tab])}`),
    'hub-listen': () => { const t = hubState.tab; D.ttsPlayScript(TASKS[t].label, speakLines(entryFor(hubState.key)[t]), { title: hubState.title }); },
    'hub-ask-q': (b) => { $('#hubq').value = b.dataset.q; actions['hub-ask'](); },
    'hub-clear': () => { entryFor(hubState.key).qa = []; saveStudio(); drawHub(); },
    'hub-ask': async () => {
      const q = $('#hubq')?.value.trim();
      if (!q) return;
      const { key } = hubState;
      const e = entryFor(key);
      const src = await sourceFor(key, hubState.fallback);
      if (!src) return;
      const turn = { q, a: '' };
      const history = (e.qa || []).slice(-3).map((x) => `Q: ${x.q}\nA: ${plain(x.a)}`).join('\n\n');
      e.qa.push(turn);
      drawHub();
      $('.sheet').scrollTop = $('.sheet').scrollHeight;
      const where = hubState.context ? `\nThe reader is currently at this passage while listening:\n${hubState.context}\n` : '';
      try {
        turn.a = await D.ai(`${history ? 'Earlier in this conversation:\n' + history + '\n\n' : ''}${where}Question: ${q}\n\nAnswer from the document only, at a ${LEVELS[aiPrefs.level]} level. After each claim cite the supporting passage as [¶n]. If the document doesn't say, answer "The document doesn't say" and stop. If the user asks for an example or a simple explanation, you may add general background but say it's not from the document.`, docOpts(src, { focus: 'query', query: q + ' ' + (hubState.context || ''), max: 3000 }));
      } catch (err) {
        e.qa = e.qa.filter((x) => x !== turn);
        toast(aiNeedsKey(err) ? 'Add your Claude API key first' : err.message);
      }
      saveStudio();
      if (hubState?.key === key) { drawHub(); $('.sheet').scrollTop = $('.sheet').scrollHeight; }
    },
    'ai-article': (b) => {
      const a = D.saved.get(b.dataset.id) || D.cache.get(b.dataset.id);
      if (!a) return;
      const fallback = () => ({ text: [`# ${a.title}`, a.authors ? `Authors: ${a.authors}` : '', a.journal ? `Journal: ${a.journal} ${a.year || ''}` : '', a.abstract ? `[¶0] Abstract: ${D.stripTags(a.abstract)}` : ''].filter(Boolean).join('\n'), type: 'paper', truncated: false, title: a.title });
      openHub('brief', { key: a.id, title: a.title, fallback });
    },
  });

  // ---------------------------------------------------------------- Paper → Podcast (two voices, interruptible)
  const POD_SCHEMA = {
    type: 'object', additionalProperties: false, required: ['title', 'lines'],
    properties: {
      title: { type: 'string' },
      lines: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['speaker', 'topic', 'text'], properties: { speaker: { type: 'string', enum: ['Host', 'Expert'] }, topic: { type: 'string' }, text: { type: 'string' } } } },
    },
  };
  const ANS_SCHEMA = {
    type: 'object', additionalProperties: false, required: ['lines'],
    properties: { lines: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['speaker', 'text'], properties: { speaker: { type: 'string', enum: ['Host', 'Expert'] }, text: { type: 'string' } } } } },
  };
  // [label, spoken length, words, answer tokens]
  const POD_LENGTHS = { quick: ['Quick', '3–4 min', 550, 2400], standard: ['Standard', '8–10 min', 1300, 5000], deep: ['Deep dive', '15–20 min', 2600, 9000] };
  const podPrefs = Object.assign({ length: 'standard' }, store.get('podPrefs', {}));
  const POD_FOCUS = {
    paper: `Cover, in this order: why the study was done (the clinical question); how it was done in plain words (design, who was studied, sample size, comparator, follow-up); the main results with the actual numbers — say effect sizes the way people talk ("a hazard ratio of 0.80 — roughly a 20 percent lower risk") and explain what they mean; important secondary results and harms; the catch — the limitations the authors themselves point out, plus any obvious ones; and what it changes (or doesn't) in practice.`,
    book: 'Cover the big ideas, the main arguments and the most memorable examples, chapter by chapter.',
    article: 'Cover the main points, the evidence behind them and what to make of it.',
    notes: 'Teach the key concepts one by one, with examples, and check understanding along the way.',
    document: 'Cover the main points and why they matter.',
  };

  function podcastOf(key) {
    const e = entryFor(key);
    return e.podcast || (e.discussion ? { title: '', lines: e.discussion.lines, length: 'standard' } : null);
  }

  async function genPodcast(key, fallback, length = podPrefs.length) {
    const e = entryFor(key);
    const src = await sourceFor(key, fallback);
    if (!src) return false;
    // Small answer allowances (Groq free tier) can't fit a long episode in one go.
    const cap = D.aiMaxCap();
    if (cap < POD_LENGTHS[length][3] * 0.8 && length !== 'quick') { length = cap < POD_LENGTHS.standard[3] * 0.8 ? 'quick' : 'standard'; toast(`Making a ${POD_LENGTHS[length][0].toLowerCase()} episode to fit your AI account's limit`); }
    const [, mins, words, max] = POD_LENGTHS[length];
    e.busy_discuss = true;
    if (hubState) drawHub();
    try {
      const out = await D.ai(`Write the script of a two-person podcast episode about this ${TYPES[src.type]?.toLowerCase() || 'document'}, in the style of a smart, friendly audio overview made for clinicians and researchers.
Speakers: the Host (curious and sharp — asks exactly what a busy doctor would ask, and pushes back: "But what's the catch?") and the Expert (knows the field and explains clearly, attributing claims: "The authors themselves point out…").
Length: about ${words} words (${mins} spoken).
${POD_FOCUS[src.type] || POD_FOCUS.document}
Give every line a short "topic" naming its segment of the episode, for example "The question", "How they studied it", "What they found", "The catch", "What it means in practice", "Bottom line". Consecutive lines in the same segment share the same topic.
Make it sound like real conversation: short turns, natural reactions ("Wait — so…", "Right."), occasional quick recaps. Open with a one-line hook and the title (and authors if known); end with a crisp bottom line. Also give the episode a short "title".
Rules: stay faithful to the document and never invent numbers or results. If a speaker adds general background that isn't in the document, they say so ("outside this paper…"). No stage directions, sound effects, markdown or speaker names inside the text.`, docOpts(src, { focus: 'summary', schema: POD_SCHEMA, max }));
      const pod = D.aiJson(out);
      if (!pod.lines?.length) throw new Error('The podcast came back empty. Try again.');
      e.podcast = { title: pod.title || '', lines: pod.lines, length, t: Date.now() };
      delete e.discussion;
      store.set('podpos.' + key, null);
      saveStudio();
      return true;
    } catch (err) {
      if (!aiNeedsKey(err)) toast(err.message);
      return false;
    } finally {
      delete e.busy_discuss;
      if (hubState?.key === key) drawHub();
    }
  }

  function podcastLines(lines) {
    const [v1, v2] = discussionVoices();
    const distinct = v2 && v2 !== v1;
    return lines.map((l) => ({ t: l.text, speaker: l.speaker, topic: l.topic || '', voice: l.speaker === 'Host' ? v1 : v2, pitch: distinct ? 0 : (l.speaker === 'Host' ? 1.06 : 0.86) }));
  }

  function playPodcast(key, title, start) {
    const pod = podcastOf(key);
    if (!pod) return;
    const pos = store.get('podpos.' + key, null);
    const from = start ?? (pos && pos.i > 0 && pos.i < pod.lines.length - 1 ? pos.i : 0);
    if (start == null && from > 0) toast('Resuming the podcast');
    closeSheet(true);
    D.ttsPlayScript('Podcast', podcastLines(pod.lines), { title: title || D.saved.get(key)?.title || D.tts.title, start: from, meta: { podcast: key } });
    setTimeout(() => ext.openPlayer?.(), 350);
  }

  /** Podcast tab of the AI studio. */
  function podcastTab(key) {
    const e = entryFor(key);
    const pod = podcastOf(key);
    const lenSeg = `<div class="seg wide">${Object.entries(POD_LENGTHS).map(([k, [l, m]]) => `<button class="${podPrefs.length === k ? 'on' : ''}" data-act="pod-len" data-v="${k}">${l}<small style="display:block;font-weight:400">${m}</small></button>`).join('')}</div>`;
    if (e.busy_discuss) return '<div class="ai-wait"><div class="spinner"></div>Writing the episode — host, expert and the catch…</div>';
    if (!pod) {
      return `<div class="pod-hero">${icon('people')}<div><b>Turn this into a podcast</b><span>Two hosts talk it through — what was found, how, the catch and what it means in practice. Tap <b>Ask</b> any time to interrupt ("explain that hazard ratio"), then carry on listening.</span></div></div>
        <label class="field">Length</label>${lenSeg}
        <button class="btn primary full big" data-act="pod-gen" style="margin-top:12px">${icon('mic')}Make the podcast</button>
        <p class="muted small">Download a natural voice (Kokoro) in Listening settings for the best two-voice sound.</p>`;
    }
    const segs = [];
    pod.lines.forEach((l, i) => { if (l.topic && (!segs.length || segs[segs.length - 1].topic !== l.topic)) segs.push({ topic: l.topic, i }); });
    const pos = store.get('podpos.' + key, null);
    const words = pod.lines.reduce((n, l) => n + l.text.split(/\s+/).length, 0);
    return `<div class="ai-label">${icon('people')}AI podcast · generated by AI, not part of the document</div>
      ${pod.title ? `<h4 class="pod-title">${esc(pod.title)}</h4>` : ''}
      <p class="muted small center">${estMinutes(words)} min · ${pod.lines.length} turns · Host &amp; Expert</p>
      <button class="btn primary full big" data-act="pod-play">${icon('play')}${pos && pos.i > 0 && pos.i < pod.lines.length - 1 ? `Resume (${Math.round(100 * pos.i / pod.lines.length)}%)` : 'Play podcast'}</button>
      ${segs.length > 1 ? `<label class="field">Segments</label>${segs.map((g) => `<button class="opt" data-act="pod-from" data-i="${g.i}">${icon('play')}<span>${esc(g.topic)}</span></button>`).join('')}` : ''}
      <details class="qa"><summary>Transcript</summary><div class="script">${pod.lines.map((l, i) => `<p data-act="pod-from" data-i="${i}"><b>${esc(l.speaker)}:</b> ${esc(l.text)}</p>`).join('')}</div></details>
      <label class="field">Make a new version</label>${lenSeg}
      <button class="btn xs" data-act="pod-redo" style="margin-top:8px">Regenerate</button>`;
  }

  // ---- Interrupt: ask while listening, hear the answer, then carry on.
  let askWaiting = false;
  function askWhileListening() {
    const t = D.tts;
    if (!t.texts.length) return;
    Native.ttsPause();
    const isPod = !!t.script?.meta?.podcast;
    const heard = t.texts.slice(Math.max(0, t.index - 2), t.index + 1).join('\n');
    sheet(`<h3>${icon('mic')} Ask ${isPod ? 'the hosts' : 'about this'}</h3>
      <p class="muted small">Paused. Your answer plays next, then ${isPod ? 'the podcast' : 'reading'} carries on from here.</p>
      <blockquote class="quote-box">${esc(heard.length > 260 ? '…' + heard.slice(-258) : heard)}</blockquote>
      <div class="chips-wrap">${['Explain that', 'Explain that number', 'Give me an example', 'Why does that matter?', 'Is that a big effect?'].map((q) => `<button class="chip" data-act="ask-q" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      <div class="ai-ask"><button class="btn sm mic" data-act="ask-mic" aria-label="Ask by voice">${icon('mic')}</button><input id="askq" placeholder="Type or say your question…" enterkeyhint="send"><button class="btn primary sm" data-act="ask-go">Ask</button></div>
      <div id="askout"></div>
      <button class="btn xs" data-act="ask-cancel" style="margin-top:10px">${icon('play')}Never mind — keep listening</button>`);
    $('#askq').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') actions['ask-go'](); });
    actions['ask-q'] = (b) => { $('#askq').value = b.dataset.q; actions['ask-go'](); };
    actions['ask-mic'] = () => { askWaiting = true; Native.listen?.(); };
    actions['ask-cancel'] = () => { closeSheet(true); Native.ttsToggle(); };
    actions['ask-go'] = async () => {
      const q = $('#askq')?.value.trim();
      if (!q) return;
      $('#askout').innerHTML = '<div class="ai-wait"><div class="spinner"></div>Thinking…</div>';
      const key = isPod ? t.script.meta.podcast : t.key;
      const src = key ? await sourceFor(key, null) : null;
      try {
        const out = D.aiJson(await D.ai(`The listener paused ${isPod ? 'a podcast about this document' : 'while listening to this document'} and asked: "${q}"
They had just heard:
"""${heard}"""
Answer as a short spoken exchange of 1–3 turns, under 130 words in total. ${isPod ? 'The Expert answers clearly and concretely using the document (with the actual numbers where relevant); the Host may add a one-line plain-language recap, then hands back with something like "OK — back to the paper."' : 'Use only the Expert speaker, answering clearly and concretely using the document (with the actual numbers where relevant).'} If the document doesn't say, the Expert says so and gives general background, clearly labelled as such. Reader level: ${LEVELS[aiPrefs.level]}. Plain spoken text only.`,
          src ? docOpts(src, { focus: 'query', query: q + ' ' + heard, schema: ANS_SCHEMA, max: 1500 }) : { schema: ANS_SCHEMA, max: 1500 }));
        const answer = (out.lines || []).filter((l) => l.text);
        if (!answer.length) throw new Error('No answer came back. Try again.');
        closeSheet(true);
        const voices = isPod ? podcastLines(answer) : answer.map((l) => ({ t: l.text, speaker: 'Answer', voice: D.ttsPrefs.voice || '' }));
        const resume = isPod
          ? { label: t.script.label, lines: t.script.lines, title: t.script.title, index: t.index, meta: t.script.meta }
          : t.script ? { label: t.script.label, lines: t.script.lines, title: t.script.title, index: t.index, meta: t.script.meta } : { doc: true, index: t.index };
        D.ttsPlayScript('Your question', voices.map((l) => ({ ...l, topic: 'Your question: ' + q })), { title: t.title, meta: { resume } });
      } catch (err) {
        $('#askout').innerHTML = aiNeedsKey(err) ? keyPrompt() : `<p class="muted small">${esc(err.message)}</p>`;
      }
    };
  }
  ext.events.speech = (evt) => {
    if (!askWaiting) return;
    askWaiting = false;
    if (evt.text && $('#askq')) { $('#askq').value = evt.text; actions['ask-go'](); }
    else if (evt.error) toast(evt.error);
  };

  function discussionVoices() {
    const v1 = D.ttsPrefs.voice || '';
    if (v1.startsWith('neural:')) {
      // Natural voices: Kokoro has several speakers, so pair a contrasting one; otherwise use another downloaded voice.
      const m = v1.match(/^neural:([^#]+)#(\d+)/);
      if (m && m[1] === 'kokoro-en') {
        const female = [0, 1, 2, 3, 4, 7, 8].includes(+m[2]);
        return [v1, `neural:kokoro-en#${female ? 5 : 3}`];
      }
      let packs = [];
      try { packs = JSON.parse(Native.voiceCatalog?.() || '[]').filter((p) => p.installed); } catch { packs = []; }
      const other = packs.find((p) => m && p.id !== m[1] && p.lang === 'en');
      return [v1, other ? `neural:${other.id}#${other.id === 'kokoro-en' ? 5 : 0}` : v1];
    }
    const voices = D.voiceList().filter((v) => !v.network);
    let v2 = D.ttsPrefs.voice2 || '';
    if (!v2) {
      const base = voices.find((v) => v.name === v1) || voices[0];
      const same = voices.filter((v) => v.name !== v1 && (!base || v.lang === base.lang));
      v2 = (same[0] || voices.find((v) => v.name !== v1))?.name || '';
    }
    return [v1, v2];
  }
  Object.assign(actions, {
    'pod-len': (b) => { podPrefs.length = b.dataset.v; store.set('podPrefs', podPrefs); drawHub(); },
    'pod-gen': async () => { const k = hubState.key; if (await genPodcast(k, hubState.fallback) && hubState?.key === k) playPodcast(k, hubState.title); },
    'pod-redo': async () => { const k = hubState.key; if (await genPodcast(k, hubState.fallback) && hubState?.key === k) drawHub(); },
    'pod-play': () => playPodcast(hubState.key, hubState.title),
    'pod-from': (b) => playPodcast(hubState.key, hubState.title, +b.dataset.i),
    'pod-open': () => { closeSheet(true); openHub('discuss'); },
  });

  // ---------------------------------------------------------------- AI section titles, OCR tidy-up
  async function aiSectionTitles() {
    const model = D.reader?.model;
    const key = D.reader?.opts.key;
    if (!model) return;
    busy('Adding section titles', 'Reading the document…');
    try {
      const schema = { type: 'object', additionalProperties: false, required: ['sections'], properties: { sections: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['before', 'title'], properties: { before: { type: 'integer' }, title: { type: 'string' } } } } } };
      const out = D.aiJson(await D.ai('Split this document into sensible sections (roughly every 3–10 minutes of reading) and give each a short, specific, informative title (e.g. "Treatment outcomes and adverse effects", not "Section 2"). For each, give "before": the ¶ number of the first paragraph of that section.', { docModel: model, focus: 'summary', schema, max: 3000 }));
      const at = new Map(out.sections.filter((s) => model.blocks[s.before]).map((s) => [s.before, s.title]));
      const blocks = [];
      model.blocks.forEach((b, i) => { if (at.has(i)) blocks.push({ type: 'h', level: 2, text: at.get(i), ai: true }); blocks.push(b); });
      model.blocks = blocks;
      await db.putReflow(model);
      setMarks(allMarks().filter((m) => m.key !== key || m.kind !== 'highlight')); // paragraph numbers moved
      closeSheet(true);
      toast(`${at.size} section titles added (marked ✦)`);
      render();
    } catch (e) {
      closeSheet(true);
      toast(aiNeedsKey(e) ? 'Add your Claude API key in Settings → AI' : e.message);
    }
  }

  async function aiTidyOcr() {
    const model = D.reader?.model;
    if (!model) return;
    busy('Fixing recognition errors', 'This can take a minute for long documents…');
    try {
      const paras = model.blocks.map((b, i) => [i, b]).filter(([, b]) => b.type === 'p');
      const schema = { type: 'object', additionalProperties: false, required: ['fixes'], properties: { fixes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['n', 'text'], properties: { n: { type: 'integer' }, text: { type: 'string' } } } } } };
      for (let s = 0; s < paras.length; s += 40) {
        busyMsg(`Paragraphs ${s + 1}–${Math.min(paras.length, s + 40)} of ${paras.length}…`);
        const chunk = paras.slice(s, s + 40).map(([i, b]) => `[${i}] ${b.text}`).join('\n');
        const out = D.aiJson(await D.ai(`These paragraphs came from text recognition of a scanned page and may contain recognition errors (wrong letters, broken words, stray symbols, joined words). Return only the paragraphs that need fixing, corrected. Fix recognition errors only: never reword, summarise or change the meaning.\n\n${chunk}`, { schema, max: 8000 }));
        for (const f of out.fixes) if (model.blocks[f.n]?.type === 'p' && f.text) model.blocks[f.n].text = f.text;
      }
      await db.putReflow(model);
      closeSheet(true);
      toast('Recognition errors fixed');
      render();
    } catch (e) {
      closeSheet(true);
      toast(aiNeedsKey(e) ? 'Add your Claude API key in Settings → AI' : e.message);
    }
  }

  // ================================================================ Study mode
  const STUDY_SCHEMA = {
    type: 'object', additionalProperties: false,
    required: ['flashcards', 'mcqs', 'viva', 'short', 'glossary', 'notes'],
    properties: {
      flashcards: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['front', 'back'], properties: { front: { type: 'string' }, back: { type: 'string' } } } },
      mcqs: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['question', 'options', 'answer', 'explanation', 'source'], properties: { question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } }, answer: { type: 'integer' }, explanation: { type: 'string' }, source: { type: 'integer' } } } },
      viva: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['question', 'answer'], properties: { question: { type: 'string' }, answer: { type: 'string' } } } },
      short: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['question', 'answer'], properties: { question: { type: 'string' }, answer: { type: 'string' } } } },
      glossary: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['term', 'definition'], properties: { term: { type: 'string' }, definition: { type: 'string' } } } },
      notes: { type: 'string' },
    },
  };
  async function genStudy(key, fallback) {
    const e = entryFor(key);
    const src = await sourceFor(key, fallback);
    if (!src) return false;
    e.busy_study = true;
    if (hubState) drawHub();
    // Accounts with a small answer allowance (Groq free tier) get a smaller set that fits.
    const cap = D.aiMaxCap();
    const n = (k) => (cap < 6000 ? Math.max(3, Math.round(k * Math.max(0.35, cap / 8000))) : k);
    try {
      const out = await D.ai(`Create study material from this document, for a ${LEVELS[aiPrefs.level].toLowerCase()} learner. ${TYPE_HINT[src.type]}
- flashcards: ${n(15)} cards (front: a question or term; back: a short answer).
- mcqs: ${n(10)} multiple-choice questions, each with exactly 4 options, "answer" = index 0–3 of the correct option, a one-sentence explanation, and "source" = the ¶ number where the answer is.
- viva: ${n(6)} oral-exam questions with model answers.
- short: ${n(6)} short-answer questions with answers.
- glossary: up to ${n(15)} key terms with definitions.
- notes: revision notes in Markdown ("## " headings and "- " bullets, key numbers in **bold**).
Use only the document; vary difficulty.`, docOpts(src, { focus: 'summary', schema: STUDY_SCHEMA, max: 16000 }));
      e.study = D.aiJson(out);
      e.t = Date.now();
      saveStudio();
      return true;
    } catch (err) {
      toast(aiNeedsKey(err) ? 'Add your Claude API key in Settings → AI' : err.message);
      return false;
    } finally {
      delete e.busy_study;
      if (hubState?.key === key) drawHub();
    }
  }
  Object.assign(actions, {
    'study-gen': async () => { const k = hubState.key; if (await genStudy(k, hubState.fallback) && hubState?.key === k) drawHub(); },
    'study-open': () => { const k = hubState?.key || D.reader?.opts.key; closeSheet(true); if (k) go('study/' + encodeURIComponent(k)); },
  });

  ext.routes.study = async (key, params) => {
    const view = $('#view');
    const e = entryFor(key);
    const doc = D.saved.get(key);
    const title = doc?.title || D.reader?.opts.title || 'Study';
    const tab = params.t || 'cards';
    if (!e.study) {
      view.innerHTML = D.topbar('Study mode') + `<div class="empty">${icon('school')}<b>${esc(title)}</b>
        <div>Create flashcards, a quiz, viva questions, a glossary and revision notes from this document.</div>
        <div class="spacer"></div>${D.aiHasKey() ? `<button class="btn primary" data-act="study-make">${icon('spark')}Create study set</button>` : keyPrompt()}</div>`;
      actions['study-make'] = async () => { view.innerHTML = D.topbar('Study mode') + '<div class="ai-wait center" style="padding:40px"><div class="spinner"></div>Writing your study set…</div>'; await genStudy(key); render(); };
      return;
    }
    const s = e.study;
    const tabs = [['cards', 'Flashcards'], ['test', 'Test me'], ['viva', 'Viva'], ['short', 'Short answer'], ['glossary', 'Glossary'], ['notes', 'Notes']];
    const nav = (t) => go(`study/${encodeURIComponent(key)}?t=${t}`, { replace: true });
    let body = '';
    if (tab === 'cards') {
      const i = Math.min(+(params.i || 0), s.flashcards.length - 1);
      const c = s.flashcards[i];
      body = `<div class="fcard" data-act="flip" id="fcard"><div class="face front">${esc(c.front)}</div><div class="face back">${esc(c.back)}</div></div>
        <p class="muted small center">Card ${i + 1} of ${s.flashcards.length} · tap to flip</p>
        <div class="row-btns center"><button class="btn" data-act="fc-prev" ${i === 0 ? 'disabled' : ''}>${icon('back')}Previous</button>
          <button class="btn primary" data-act="fc-next" ${i >= s.flashcards.length - 1 ? 'disabled' : ''}>Next</button></div>
        <div class="row-btns center" style="margin-top:14px"><button class="btn xs" data-act="fc-anki">${icon('download')}Export to Anki</button>
          <button class="btn xs" data-act="fc-listen">${icon('audio')}Listen to cards</button></div>`;
      actions.flip = () => $('#fcard').classList.toggle('flipped');
      actions['fc-prev'] = () => go(`study/${encodeURIComponent(key)}?t=cards&i=${i - 1}`, { replace: true });
      actions['fc-next'] = () => go(`study/${encodeURIComponent(key)}?t=cards&i=${i + 1}`, { replace: true });
      actions['fc-anki'] = () => {
        const clean = (t) => String(t).replace(/[\t\n]/g, ' ');
        const tsv = '#separator:tab\n#html:false\n#tags:DermScholar\n' + s.flashcards.map((f) => `${clean(f.front)}\t${clean(f.back)}`).join('\n');
        Native.exportText(`${title.slice(0, 40)} - flashcards.txt`, tsv, 'text/plain');
      };
      actions['fc-listen'] = () => D.ttsPlayScript('Flashcards', s.flashcards.flatMap((f) => [{ t: 'Question. ' + f.front }, { t: 'Answer. ' + f.back }]), { title });
    } else if (tab === 'test') {
      const st = store.get('quiz.' + key, { i: 0, score: 0, answered: null });
      if (st.i >= s.mcqs.length) {
        body = `<div class="empty">${icon('check')}<b>You scored ${st.score} / ${s.mcqs.length}</b><div>${st.score >= s.mcqs.length * 0.8 ? 'Excellent — you know this well.' : st.score >= s.mcqs.length * 0.5 ? 'Good. Review the questions you missed.' : 'Worth another listen, then try again.'}</div>
          <div class="spacer"></div><button class="btn primary" data-act="q-restart">Try again</button></div>`;
      } else {
        const q = s.mcqs[st.i];
        body = `<p class="muted small">Question ${st.i + 1} of ${s.mcqs.length} · score ${st.score}</p><h3 class="quiz-q">${esc(q.question)}</h3>
          ${q.options.map((o, k) => `<button class="quiz-opt ${st.answered != null ? (k === q.answer ? 'right' : k === st.answered ? 'wrong' : '') : ''}" data-act="q-pick" data-k="${k}" ${st.answered != null ? 'disabled' : ''}>${'ABCD'[k]}. ${esc(o)}</button>`).join('')}
          ${st.answered != null ? `<div class="quiz-exp"><b>${st.answered === q.answer ? 'Correct.' : 'Not quite.'}</b> ${esc(q.explanation)}
            ${doc ? `<button class="src" data-act="q-src" data-b="${q.source}">¶${q.source}</button>` : ''}</div>
            <button class="btn primary full" data-act="q-next">${st.i + 1 < s.mcqs.length ? 'Next question' : 'See my score'}</button>` : ''}`;
      }
      const save = (x) => { store.set('quiz.' + key, x); render(); };
      actions['q-pick'] = (b) => { const k = +b.dataset.k; save({ ...st, answered: k, score: st.score + (k === s.mcqs[st.i].answer ? 1 : 0) }); };
      actions['q-next'] = () => save({ ...st, i: st.i + 1, answered: null });
      actions['q-restart'] = () => save({ i: 0, score: 0, answered: null });
      actions['q-src'] = (b) => go(`${doc ? routeFor(doc) : 'doc/' + key}?b=${b.dataset.b}`);
    } else if (tab === 'viva' || tab === 'short') {
      body = s[tab].map((x, i) => `<details class="qa"><summary>${i + 1}. ${esc(x.question)}</summary><p>${esc(x.answer)}</p></details>`).join('')
        + `<button class="btn xs" data-act="qa-listen" style="margin-top:10px">${icon('audio')}Listen: question, pause, answer</button>`;
      actions['qa-listen'] = () => D.ttsPlayScript(tab === 'viva' ? 'Viva practice' : 'Short answers', s[tab].flatMap((x) => [{ t: x.question }, { t: 'Take a moment to answer.' }, { t: 'Model answer. ' + x.answer }]), { title });
    } else if (tab === 'glossary') {
      body = `<div class="gloss">${s.glossary.map((g) => `<div><b>${esc(g.term)}</b><span>${esc(g.definition)}</span></div>`).join('')}</div>`;
    } else if (tab === 'notes') {
      body = `<div class="ai-body">${md(s.notes)}</div><div class="row-btns"><button class="btn xs" data-act="rn-listen">${icon('audio')}Listen</button><button class="btn xs" data-act="rn-copy">${icon('file')}Copy</button></div>`;
      actions['rn-listen'] = () => D.ttsPlayScript('Revision notes', speakLines(s.notes), { title });
      actions['rn-copy'] = () => D.copyText(plain(s.notes));
    }
    view.innerHTML = D.topbar('Study mode', { right: `<button class="icon-btn" data-act="study-redo" aria-label="Regenerate">${icon('spark')}</button>` })
      + `<p class="study-title">${esc(title)}</p><div class="scroll-x study-tabs">${tabs.map(([k, l]) => `<button class="chip ${tab === k ? 'on' : ''}" data-act="st-tab" data-v="${k}">${l}</button>`).join('')}</div>
      <div class="study-body">${body}</div>`;
    actions['st-tab'] = (b) => nav(b.dataset.v);
    actions['study-redo'] = async () => { delete e.study; saveStudio(); render(); };
  };

  // ================================================================ Player (full screen)
  function sleepLabel() {
    try {
      const st = JSON.parse(Native.ttsStatus());
      if (st.sleepMs > 0) return `${Math.ceil(st.sleepMs / 60000)} min`;
      if (st.stopAfter >= 0) return 'End of section';
    } catch { /* browser */ }
    return 'Sleep';
  }
  function openPlayer() {
    const t = D.tts;
    if (!t.texts.length) return;
    closePlayer();
    const doc = D.saved.get(t.key);
    document.body.insertAdjacentHTML('beforeend', `<div class="player" id="player" role="dialog" aria-label="Player">
      <div class="pl-top"><button class="icon-btn" data-act="pl-close" aria-label="Close player">${icon('back').replace('<svg', '<svg style="transform:rotate(-90deg)"')}</button>
        <span>${t.script ? 'AI audio' : 'Now playing'}</span><button class="icon-btn" data-act="tts-settings" aria-label="Voice and options">${icon('settings')}</button></div>
      ${cover(t.title, t.script ? 'AI · ' + t.script.label : (TYPES[doc?.docType] || (doc?.utd ? 'UpToDate' : 'Research paper')), true)}
      <div class="pl-title">${esc(t.title)}</div>
      <div class="pl-sec" id="plsec"></div>
      ${t.script ? `<div class="ai-label">${icon('spark')}${esc(t.script.label)} · generated by AI, not the original text</div>` : ''}
      <div class="pl-bar" id="plbar"><i id="plfill"></i></div>
      <div class="pl-times"><span id="pldone"></span><span id="plleft"></span></div>
      <div class="pl-ctrl">
        <button class="icon-btn" data-act="pl-prevsec" aria-label="Previous section">${icon('prev')}</button>
        <button class="icon-btn big" data-act="tts-back" aria-label="Back 15 seconds">${icon('back15')}</button>
        <button class="pl-play" data-act="tts-toggle" id="plplay" aria-label="Play or pause"></button>
        <button class="icon-btn big" data-act="tts-fwd" aria-label="Forward 30 seconds">${icon('fwd30')}</button>
        <button class="icon-btn" data-act="pl-nextsec" aria-label="Next section">${icon('next')}</button>
      </div>
      <div class="pl-tools">
        <button data-act="pl-speed"><b class="js-rate">${D.ttsPrefs.rate}×</b><span>Speed</span></button>
        <button data-act="pl-sleep">${icon('moon')}<span id="plsleep">${sleepLabel()}</span></button>
        <button data-act="pl-mark" ${t.script ? 'disabled' : ''}>${icon('bookmark')}<span>Bookmark</span></button>
        <button data-act="pl-explain">${icon('spark')}<span>Explain</span></button>
        <button data-act="pl-ask">${icon('chat')}<span>Ask</span></button>
      </div>
      <div class="pl-now" id="plnow"></div>
      <div class="pl-foot">
        <button class="btn xs" data-act="pl-chapters" ${t.heads.length ? '' : 'disabled'}>${icon('list')}Sections</button>
        <button class="btn xs" data-act="pl-marks">${icon('bookmarkFill')}Bookmarks</button>
        <button class="btn xs" data-act="pl-offline">${icon('download')}Offline</button>
      </div></div>`);
    document.body.classList.add('player-open');
    updatePlayer();
    $('#plbar').addEventListener('click', (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      const target = ((e.clientX - r.left) / r.width) * D.tts.cum[D.tts.cum.length - 1];
      let i = 0;
      while (i < D.tts.texts.length - 1 && D.tts.cum[i + 1] <= target) i++;
      Native.ttsSeek(i);
    });
  }
  function closePlayer() {
    $('#player')?.remove();
    document.body.classList.remove('player-open');
  }
  function updatePlayer() {
    if (!$('#player')) return;
    const t = D.tts;
    const sp = D.speech;
    const tm = D.ttsTimes();
    $('#plplay').innerHTML = icon(t.playing ? 'pause' : 'play');
    $('#plsec').textContent = t.script ? (t.secs[t.index] || '') : (t.secs[t.index] || '');
    $('#plfill').style.width = (tm.total ? (100 * tm.done) / tm.total : 0).toFixed(1) + '%';
    if (sp) { $('#pldone').textContent = sp.clock(tm.done); $('#plleft').textContent = '−' + sp.clock(tm.left); }
    const now = t.texts[t.index] || '';
    $('#plnow').textContent = now.length > 260 ? now.slice(0, 258) + '…' : now;
    const sl = $('#plsleep'); if (sl) sl.textContent = sleepLabel();
  }
  ext.openPlayer = openPlayer;
  ext.closePlayer = closePlayer;
  ext.onTtsUpdate = updatePlayer;



  Object.assign(actions, {
    'pl-close': () => closePlayer(),
    'pl-prevsec': () => Native.ttsSeek(D.prevSection(D.tts.index)),
    'pl-nextsec': () => Native.ttsSeek(D.nextSection(D.tts.index)),
    'pl-speed': () => {
      sheet(`<h3>Playback speed</h3><div class="rates">${D.RATES.map((r) => `<button class="${D.ttsPrefs.rate === r ? 'on' : ''}" data-act="pl-rate" data-v="${r}">${r}×</button>`).join('')}</div>`);
      actions['pl-rate'] = (b) => { D.ttsPrefs.rate = +b.dataset.v; D.saveTts(); Native.ttsRate(D.ttsPrefs.rate); $$('.js-rate, #ttsrate').forEach((e) => { e.textContent = D.ttsPrefs.rate + '×'; }); closeSheet(true); updatePlayer(); };
    },
    'pl-sleep': () => {
      sheet(`<h3>Sleep timer</h3>${[['0', 'Off'], ['5', '5 minutes'], ['10', '10 minutes'], ['15', '15 minutes'], ['30', '30 minutes'], ['45', '45 minutes'], ['60', '1 hour'], ['sec', 'End of this section']].map(([v, l]) => `<button class="opt" data-act="pl-sleep-set" data-v="${v}">${icon('moon')}${l}</button>`).join('')}`);
      actions['pl-sleep-set'] = (b) => {
        const v = b.dataset.v;
        Native.ttsSleep(v === 'sec' ? 0 : +v);
        Native.ttsStopAfter(v === 'sec' ? D.sectionEnd(D.tts.index) : -1);
        closeSheet(true);
        toast(v === '0' ? 'Sleep timer off' : v === 'sec' ? 'Will pause at the end of this section' : `Will pause in ${v} minutes`);
        setTimeout(updatePlayer, 100);
      };
    },
    'pl-mark': () => {
      const t = D.tts;
      const el = t.els[t.index];
      const words = (t.texts[t.index] || '').split(/\s+/).slice(0, 9).join(' ');
      const sec = t.secs[t.index] && t.secs[t.index] !== t.title ? t.secs[t.index] + ': ' : '';
      const list = store.get('bm.' + t.key, []);
      list.unshift({ id: 'b' + Date.now(), i: t.index, b: el?.dataset?.b ?? null, label: `${sec}${words}…`, t: Date.now() });
      store.set('bm.' + t.key, list);
      toast('Bookmarked');
    },
    'pl-marks': () => {
      const t = D.tts;
      const list = store.get('bm.' + t.key, []);
      sheet(`<h3>Bookmarks</h3>${list.length ? list.map((m) => `<div class="bm-row"><button class="opt" data-act="bm-go" data-i="${m.i}">${icon('bookmarkFill')}<span>${esc(m.label)}<small>${new Date(m.t).toLocaleDateString()}</small></span></button>
          <button class="icon-btn" data-act="bm-ai" data-id="${m.id}" aria-label="Suggest a title">${icon('spark')}</button>
          <button class="icon-btn" data-act="bm-del" data-id="${m.id}" aria-label="Delete">${icon('trash')}</button></div>`).join('')
        : '<p class="muted small">Tap Bookmark while listening to save your place with its context.</p>'}`);
      actions['bm-go'] = (b) => { closeSheet(true); Native.ttsSeek(+b.dataset.i); };
      actions['bm-del'] = (b) => { store.set('bm.' + t.key, list.filter((m) => m.id !== b.dataset.id)); actions['pl-marks'](); };
      actions['bm-ai'] = async (b) => {
        const m = list.find((x) => x.id === b.dataset.id);
        try {
          const title = await D.ai(`Give a short, specific title (max 8 words, no quotes) for a bookmark at this passage:\n"""${t.texts[m.i] || m.label}"""`, { max: 60, system: 'You write concise bookmark titles.' });
          m.label = title.replace(/^["'#\s]+|["'\s]+$/g, '');
          store.set('bm.' + t.key, list);
          actions['pl-marks']();
        } catch (e) { toast(aiNeedsKey(e) ? 'Add your Claude API key in Settings → AI' : e.message); }
      };
    },
    'pl-chapters': () => {
      const t = D.tts;
      sheet(`<h3>Sections</h3>${t.heads.map((h) => `<button class="opt ${D.sectionStart(t.index) === h ? 'on' : ''}" data-act="ch-go" data-i="${h}">${icon('list')}<span>${esc(t.secs[h] || t.texts[h])}<small>${D.speech ? D.speech.clock(t.cum[h] / ((D.speech.CHARS_PER_SEC) * D.ttsPrefs.rate)) : ''}</small></span></button>`).join('')}`);
      actions['ch-go'] = (b) => { closeSheet(true); Native.ttsSeek(+b.dataset.i); };
    },
    'pl-explain': () => {
      const t = D.tts;
      const el = t.els[t.index];
      if (el && $('#rd')?.contains(el)) paraSheet(el);
      else paraSheet(null, t.texts[t.index] || '');
    },
    'pl-ask': () => askWhileListening(),
    'pl-offline': () => {
      sheet(`<h3>Offline listening</h3><p class="small">Documents and their text are stored on this phone, and narration uses your phone's own voices, so listening works without internet (choose voices not marked "online" in Listening settings).</p>
        <p class="small">AI features — summaries, Ask, study sets and the AI Discussion — need internet the first time. Once created they are saved and work offline, including listening to them.</p>`);
    },
  });

  // ================================================================ home, library, notes, search
  ext.homeTop = () => {
    const last = store.get('lastListen', null);
    const lastDoc = last && (D.saved.get(last.key) || null);
    const docs = [...D.saved.values()].filter((a) => a.doc || a.imported).sort((a, b) => b.savedAt - a.savedAt).slice(0, 8);
    const cont = last && (lastDoc || last.route || last.podcast) ? (() => {
      const pp = last.podcast ? store.get('podpos.' + last.key, null) : null;
      const p = last.podcast ? (pp && pp.n ? pp.i / pp.n : 0) : progressOf(last.key);
      const mins = lastDoc?.words ? estMinutes(lastDoc.words) : 0;
      return `<button class="continue slim" data-act="home-continue"><span class="play-dot">${icon('play')}</span>
        <div class="body"><span class="eyebrow">Continue ${last.podcast ? 'podcast' : 'listening'} · ${Math.round(p * 100)}%${mins && !last.podcast ? ` · ${Math.max(1, Math.round(mins * (1 - p)))} min left` : ''}</span><b>${esc(last.title)}</b>
          <div class="prog"><i style="width:${Math.round(p * 100)}%"></i></div></div></button>`;
    })() : '';
    return `<div class="quick-row">
        <button class="quick-btn" data-act="add-doc"><span class="qi add">${icon('plus')}</span><span><b>Add document</b><small>PDF, Word, photo</small></span></button>
        <button class="quick-btn" data-act="tab" data-tab="library"><span class="qi lib">${icon('bookmark')}</span><span><b>Library</b><small>${D.saved.size} saved</small></span></button>
      </div>
      ${cont}
      ${docs.length ? `<div class="section"><div class="section-h"><h3>Recently added</h3><button data-act="tab" data-tab="library">Library</button></div>
        <div class="scroll-x shelf">${docs.map((a) => `<button class="shelf-item" data-act="shelf-open" data-id="${esc(a.id)}">${cover(a.title, TYPES[a.docType] || 'PDF')}
          <b>${esc(a.title)}</b><span>${a.words ? estMinutes(a.words) + ' min' : 'PDF'}${progressOf(a.id) ? ` · ${Math.round(progressOf(a.id) * 100)}%` : ''}</span></button>`).join('')}</div></div>` : ''}`;
  };
  Object.assign(actions, {
    'home-continue': () => {
      const last = store.get('lastListen', null);
      if (!last) return;
      if (last.podcast && podcastOf(last.key)) { playPodcast(last.key, last.title); return; }
      const a = D.saved.get(last.key);
      const route = a ? routeFor(a) : String(last.route || '').replace(/^#\/?/, '').split('?')[0];
      go(route + '?listen=1');
    },
    'shelf-open': (b) => { const a = D.saved.get(b.dataset.id); if (a) go(routeFor(a)); },
  });

  ext.cardExtra = (a) => {
    const p = progressOf(a.id);
    const bits = [];
    if (a.doc) bits.push(`<span class="badge">${esc(TYPES[a.docType] || 'Document')}</span>`);
    if (a.words) bits.push(`<span class="badge">${icon('clock')}${estMinutes(a.words)} min</span>`);
    if (p) bits.push(`<span class="badge b-oa">${icon('audio')}${Math.round(p * 100)}% listened</span>`);
    if (aiStore[a.id]?.brief) bits.push(`<span class="badge">${icon('spark')}Brief</span>`);
    if (aiStore[a.id]?.study) bits.push(`<span class="badge">${icon('school')}Study set</span>`);
    if (aiStore[a.id]?.podcast || aiStore[a.id]?.discussion) bits.push(`<span class="badge">${icon('mic')}Podcast</span>`);
    return bits.length ? `<div class="badges">${bits.join('')}</div>` : '';
  };

  ext.libraryTop = (p) => (p.q && p.q.length >= 2
    ? `<button class="find-all" data-act="find-all" data-q="${esc(p.q)}">${icon('search')}Search inside documents, notes and AI summaries for “${esc(p.q)}”</button>`
    : '');
  actions['find-all'] = (b) => go('find?q=' + encodeURIComponent(b.dataset.q));

  function snippetAround(text, q) {
    const i = text.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return '';
    const s = Math.max(0, i - 80);
    const out = (s ? '…' : '') + text.slice(s, i + q.length + 120) + (i + q.length + 120 < text.length ? '…' : '');
    return esc(out).replace(new RegExp(esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (m) => `<mark>${m}</mark>`);
  }
  ext.routes.find = async (_, params) => {
    const q = (params.q || '').trim();
    const view = $('#view');
    view.innerHTML = D.topbar('Search your library') + `<label class="search-inline">${icon('search')}<input id="fq" value="${esc(q)}" placeholder="Search everything you've saved"></label><div id="found"><div class="ai-wait"><div class="spinner"></div>Searching…</div></div>`;
    $('#fq').addEventListener('change', (e) => go('find?q=' + encodeURIComponent(e.target.value), { replace: true }));
    if (q.length < 2) { $('#found').innerHTML = ''; return; }
    const ql = q.toLowerCase();
    const models = await db.allReflow();
    const groups = [];
    for (const m of models) {
      const a = D.saved.get(m.key);
      if (!a) continue;
      const hits = [];
      m.blocks.forEach((b, i) => {
        if (hits.length >= 4) return;
        const t = b.text ?? (b.html || '').replace(/<[^>]+>/g, ' ');
        if (t && t.toLowerCase().includes(ql)) hits.push({ i, html: snippetAround(t, q) });
      });
      const titleHit = [a.title, a.authors].join(' ').toLowerCase().includes(ql);
      if (hits.length || titleHit) groups.push({ a, hits });
    }
    for (const a of D.saved.values()) {
      if (groups.some((g) => g.a.id === a.id)) continue;
      if ([a.title, a.authors, a.abstract, a.notes].join(' ').toLowerCase().includes(ql)) groups.push({ a, hits: [] });
    }
    const notes = allMarks().filter((m) => [m.text, m.note, m.ai?.answer].join(' ').toLowerCase().includes(ql));
    const aiHits = Object.entries(aiStore).filter(([, e]) => [e.brief, e.long, e.takeaways].join(' ').toLowerCase().includes(ql)).map(([k]) => k);
    $('#found').innerHTML = `${groups.length ? groups.map(({ a, hits }) => `<div class="card find-card"><p class="title main" data-act="find-open" data-id="${esc(a.id)}">${esc(a.title)}</p>
        ${hits.map((h) => `<button class="passage" data-act="find-open" data-id="${esc(a.id)}" data-b="${h.i}">${h.html}</button>`).join('')}
        ${aiHits.includes(a.id) ? `<span class="badge">${icon('spark')}Also in its AI summary</span>` : ''}</div>`).join('') : ''}
      ${notes.length ? `<div class="section-h"><h3>In your notes</h3></div>${notes.map((m) => `<button class="passage" data-act="note-go" data-id="${m.id}"><b>${esc(m.docTitle)}</b> ${snippetAround([m.note, m.text, m.ai?.answer].filter(Boolean).join(' — '), q) || esc(m.text.slice(0, 120))}</button>`).join('')}` : ''}
      ${!groups.length && !notes.length ? `<div class="empty">${icon('search')}<b>Nothing found for “${esc(q)}”</b><div>Search looks through titles, authors, the full text of documents on this phone, your notes and AI summaries.</div></div>` : ''}`;
    actions['find-open'] = (b) => { const a = D.saved.get(b.dataset.id); if (a) go(routeFor(a) + (b.dataset.b ? `?b=${b.dataset.b}` : '')); };
  };

  actions['note-go'] = (b) => {
    const m = allMarks().find((x) => x.id === b.dataset.id);
    if (!m) return;
    const a = D.saved.get(m.key);
    go((a ? routeFor(a) : m.route) + (m.b != null ? `?b=${m.b}` : ''));
  };
  ext.routes.notes = () => {
    const view = $('#view');
    const marks = allMarks();
    const byDoc = new Map();
    marks.forEach((m) => { if (!byDoc.has(m.key)) byDoc.set(m.key, []); byDoc.get(m.key).push(m); });
    view.innerHTML = D.topbar('My notes', { right: marks.length ? `<button class="icon-btn" data-act="notes-export" aria-label="Export">${icon('download')}</button>` : '' })
      + (marks.length ? `<div class="row-btns"><button class="btn small" data-act="notes-ai">${icon('spark')}Summarise my notes</button></div><div id="notesai"></div>
        ${[...byDoc.entries()].map(([, list]) => `<div class="section"><div class="section-h"><h3>${esc(list[0].docTitle)}</h3></div>
          ${list.map((m) => `<div class="note-card"><button class="passage" data-act="note-go" data-id="${m.id}">${m.kind === 'highlight' ? `<span class="hlmark">${esc(m.text.slice(0, 300))}</span>` : `<i>“${esc(m.text.slice(0, 200))}”</i>`}</button>
            ${m.note ? `<p>${esc(m.note)}</p>` : ''}${m.ai ? `<div class="muted small">✦ AI · ${esc(m.ai.mode)}</div><div class="ai-body">${md(m.ai.answer)}</div>` : ''}
            <div class="row-btns"><button class="btn xs" data-act="note-edit2" data-id="${m.id}">${icon('note')}${m.note ? 'Edit note' : 'Add note'}</button>
              <button class="btn xs" data-act="note-share" data-id="${m.id}">${icon('share')}Share</button>
              <button class="icon-btn" data-act="note-rm" data-id="${m.id}" aria-label="Delete">${icon('trash')}</button></div></div>`).join('')}</div>`).join('')}`
        : `<div class="empty">${icon('note')}<b>No notes yet</b><div>While reading, long-press a paragraph (or select text) to highlight it, add a note, or save an AI explanation. Everything collects here.</div></div>`);
    actions['note-edit2'] = (b) => { const m = allMarks().find((x) => x.id === b.dataset.id); noteSheet({ key: m.key, b: m.b, text: m.text, id: m.id }); };
    actions['note-rm'] = (b) => { setMarks(allMarks().filter((x) => x.id !== b.dataset.id)); render(); };
    actions['note-share'] = (b) => { const m = allMarks().find((x) => x.id === b.dataset.id); Native.share(m.docTitle, `“${m.text}”${m.note ? '\n\n' + m.note : ''}\n— ${m.docTitle}`); };
    const asText = () => [...byDoc.values()].map((list) => `# ${list[0].docTitle}\n` + list.map((m) => `- “${m.text.slice(0, 400)}”${m.note ? `\n  Note: ${m.note}` : ''}${m.ai ? `\n  AI (${m.ai.mode}): ${plain(m.ai.answer).slice(0, 600)}` : ''}`).join('\n')).join('\n\n');
    actions['notes-export'] = () => Native.exportText('My notes.md', asText(), 'text/markdown');
    actions['notes-ai'] = async () => {
      const out = $('#notesai');
      out.innerHTML = '<div class="ai-wait"><div class="spinner"></div>Reading your notes…</div>';
      try {
        const ans = await D.ai('Write a consolidated summary of these saved highlights and notes, grouped by theme (not by document), naming which document each point comes from. Finish with "## Open questions" if the notes raise any.', { doc: asText(), max: 4000 });
        out.innerHTML = `<div class="ai-body card">${md(ans)}</div>`;
      } catch (e) { out.innerHTML = aiNeedsKey(e) ? keyPrompt() : `<p class="muted small">${esc(e.message)}</p>`; }
    };
  };

  // ================================================================ settings
  // [id, name, note, [$ in, $ out per million tokens]]
  const MODELS = {
    groq: [
      ['openai/gpt-oss-120b', 'GPT-OSS 120B', 'Best quality on Groq (default)', [0.15, 0.6]],
      ['openai/gpt-oss-20b', 'GPT-OSS 20B', 'Fastest, lowest cost', [0.075, 0.3]],
      ['qwen/qwen3.8-27b', 'Qwen 3.8 27B', 'Alternative model', [0.8, 4]],
    ],
    gemini: [
      ['gemini-3.8-flash', 'Gemini 3.8 Flash', 'Free tier · takes whole evidence maps at once (default)', [0, 0]],
    ],
    openrouter: [
      ['openai/gpt-oss-120b:free', 'GPT-OSS 120B (free)', 'Free, then the paid version from your credit when busy (default)', [0, 0]],
      ['openai/gpt-oss-120b', 'GPT-OSS 120B (paid)', 'From your credit only: steadier at busy times', [0.15, 0.75]],
    ],
    claude: [
      ['claude-sonnet-5-5', 'Claude Sonnet 5.5', 'Best value for clinical answers (default)', [2, 10]],
      ['claude-opus-5-5', 'Claude Opus 5.5', 'Top quality, twice the cost', [4, 20]],
      ['claude-haiku-4-5', 'Claude Haiku 4.5', 'Fastest, lowest cost', [1, 5]],
    ],
  };
  const priceOf = (model) => (/^openrouter\//.test(model)
    ? MODELS.openrouter.find((x) => x[0] === String(model).slice(11))?.[3]
    : [...MODELS.groq, ...MODELS.gemini, ...MODELS.claude].find((x) => x[0] === model || String(model).startsWith(x[0]))?.[3]) || [0, 0];
  function usageLine() {
    let u = {};
    try { u = JSON.parse(Native.aiUsage?.() || '{}'); } catch { u = {}; }
    const month = new Date().toISOString().slice(0, 7);
    const m = u[month] || {};
    let cost = 0, calls = 0, tokens = 0;
    // On the free tiers (Groq, Gemini) only paid OpenRouter answers, from the credit, cost anything.
    const freeTier = provider() === 'groq' || provider() === 'gemini';
    for (const [model, row] of Object.entries(m)) {
      const price = freeTier && !/^openrouter\//.test(model) ? [0, 0] : priceOf(model);
      cost += (row[0] * price[0] + row[1] * price[1] + row[2] * price[0] * 0.5) / 1e6;
      calls += row[3];
      tokens += row[0] + row[1] + row[2];
    }
    const free = freeTier && cost === 0;
    // Which AI answered: requests per provider ("Groq 18 · Gemini 5"), so a Gemini fallback shows up here.
    const by = {};
    for (const [model, row] of Object.entries(m)) {
      const who = /^gemini/i.test(model) ? 'Gemini' : /^claude/i.test(model) ? 'Claude' : /^openrouter\//i.test(model) ? 'OpenRouter' : 'Groq';
      by[who] = (by[who] || 0) + row[3];
    }
    const split = Object.entries(by).map(([k, v]) => `${k} ${v}`).join(' · ');
    return calls ? `${split} requests this month · ${(tokens / 1000).toFixed(0)}k tokens · ${free ? 'free tier: no charge' : `about $${cost.toFixed(2)}`}` : 'No AI use this month';
  }
  ext.events.aiModels = (evt) => {
    if (evt.models) { store.set('groqModels', evt.models.map((m) => m.id)); if (D.current.name === 'settings') render(); }
  };
  ext.settingsSection = () => {
    const prov = provider();
    const has = (() => { try { return Native.aiHasKeyFor ? !!Native.aiHasKeyFor(prov) : D.aiHasKey(); } catch { return D.aiHasKey(); } })();
    const auto = (() => { try { return Native.aiAuto ? !!Native.aiAuto() : false; } catch { return false; } })();
    const keyFor = (p) => { try { return !!Native.aiHasKeyFor?.(p); } catch { return false; } };
    const model = (() => { try { return Native.aiModel?.() || MODELS[prov][0][0]; } catch { return MODELS[prov][0][0]; } })();
    let list = MODELS[prov];
    if (prov === 'groq') {
      const live = store.get('groqModels', null);
      if (live?.length) list = [...list.filter((x) => live.includes(x[0])), ...live.filter((id) => !list.some((x) => x[0] === id)).map((id) => [id, id, 'Available to your key', priceOf(id)])];
    }
    return `<div class="section"><div class="section-h"><h3>AI</h3></div>
      <div class="seg wide" style="margin-bottom:10px">${[['groq', 'Groq'], ['gemini', 'Gemini'], ['openrouter', 'OpenRouter'], ['claude', 'Claude']].map(([k, l]) => `<button class="${prov === k ? 'on' : ''}" data-act="set-provider" data-v="${k}">${l}</button>`).join('')}</div>
      <div class="acc-card"><div class="acc-ico ai ${prov}">${icon('spark')}</div>
        <div class="body"><b>${({ groq: 'Groq', gemini: 'Gemini (Google)', claude: 'Claude (Anthropic)', openrouter: 'OpenRouter' })[prov] || 'Groq'}</b><span>${has ? 'API key saved · ' + esc(usageLine()) : `Add your ${({ groq: 'Groq', gemini: 'Gemini', claude: 'Anthropic', openrouter: 'OpenRouter' })[prov] || 'Groq'} API key to use AI features`}</span></div>
        <button class="btn xs ${has ? '' : 'primary'}" data-act="set-aikey">${has ? 'Change' : 'Add key'}</button>
        ${has ? `<button class="icon-btn" data-act="ai-forget" aria-label="Remove key">${icon('trash')}</button>` : ''}</div>
      ${prov === 'gemini' ? '<p class="muted small">Gemini has a generous free tier (key from aistudio.google.com/apikey, no card): best for the evidence map, matrix and contradiction checks, which read dozens of abstracts at once.</p>' : ''}
      ${prov === 'openrouter' ? '<p class="muted small">OpenRouter is the back-up: it answers only when Groq and Gemini are busy or at their limit. Its free model allows 50 requests a day (1,000 once you have bought $10 of credit); when it is busy, the paid version answers from your credit. Without credit, nothing is ever charged.</p>' : ''}
      ${prov === 'groq' ? '<p class="muted small">Groq is very fast and has a free tier (about 8,000 tokens a minute, 200,000 a day). When a document is bigger than that, the app sends the most relevant parts — the answer says so.</p>' : ''}
      ${Native.aiAuto ? `<div class="acc-card"><div class="acc-ico">${icon('spark')}</div>
        <div class="body"><b>Use Groq + Gemini together</b><span>${auto ? 'On' : 'Off'} · Groq key ${keyFor('groq') ? '✓' : '—'} · Gemini key ${keyFor('gemini') ? '✓' : '—'} · OpenRouter key ${keyFor('openrouter') ? '✓' : '—'}. When one hits its free limit or is busy, the other answers; long documents go to Gemini first; OpenRouter answers when both are busy.</span></div>
        <button class="btn xs ${auto ? 'primary' : ''}" data-act="ai-auto">${auto ? 'On' : 'Off'}</button></div>
      <p class="muted small">Tip: save a key for each — tap Groq above and add its key, then tap Gemini and add its key. The selected one is used first.</p>` : ''}
      ${Native.aiTest ? '<button class="btn full" style="margin:8px 0" data-act="ai-test">Test AI connection</button><pre class="trail" id="ai-test-out" hidden></pre>' : ''}
      <label class="field">Model ${prov === 'groq' && has ? `<button class="linkish" data-act="groq-refresh">refresh list</button>` : ''}</label>
      ${list.map(([id, name, sub, p]) => `<button class="opt ${model === id ? 'on' : ''}" data-act="set-model" data-v="${esc(id)}">${icon('spark')}<span>${esc(name)}<small>${esc(sub)}${p[0] ? ` · $${p[0]}/$${p[1]} per million tokens in/out` : ''}</small></span>${model === id ? icon('check') : ''}</button>`).join('')}
      <label class="field">Explanation level</label>
      <div class="seg wide">${Object.entries(LEVELS).map(([k, l]) => `<button class="${aiPrefs.level === k ? 'on' : ''}" data-act="set-level" data-v="${k}">${l}</button>`).join('')}</div>
      <p class="muted small">Answers are saved on this phone and reused, so nothing is generated twice.</p></div>
      ${Native.openMyLoftApp ? `<div class="section"><div class="section-h"><h3>MyLOFT</h3></div>
        <div class="acc-card"><div class="acc-ico">${icon('key')}</div><div class="body"><b>Your institution's access</b><span>${Native.hasMyLoftApp?.() ? 'MyLOFT app found' : 'MyLOFT app not found yet: choose it from your apps'}. Papers come back by Share → DermScholar.</span></div>
          <button class="btn xs" data-act="myloft-open">Open</button><button class="btn xs" data-act="myloft-pick">Choose app</button></div></div>` : ''}
      <div class="section"><div class="section-h"><h3>Listening</h3></div>
        <div class="acc-card"><div class="acc-ico">${icon('audio')}</div><div class="body"><b>Voices, speed &amp; skipping</b><span>${String(D.ttsPrefs.voice || '').startsWith('neural:') ? 'Natural voice' : 'Phone voice'} · ${D.ttsPrefs.rate}× · skips ${Object.entries(D.ttsPrefs.skip).filter(([, v]) => v).length} kinds of content</span></div>
          <button class="btn xs" data-act="tts-settings-open">Open</button></div></div>
      <div class="section"><div class="section-h"><h3>Privacy</h3></div>
        <p class="small">Your documents, notes and audio positions stay on this phone in app-private storage; PDFs, imports and voice packs are deleted when you delete them. Nothing is uploaded unless you use an AI feature — then only that document's text goes to ${({ groq: 'Groq', gemini: 'Google (Gemini)', claude: 'Anthropic', openrouter: 'OpenRouter' })[prov] || 'Groq'} over an encrypted connection, under their API terms. Natural voices run entirely on the phone. Your API keys and logins are encrypted with the phone's keystore.</p></div>`;
  };
  Object.assign(actions, {
    'set-aikey': () => sheet(`<h3>${({ groq: 'Groq', gemini: 'Gemini', claude: 'Claude', openrouter: 'OpenRouter' })[provider()] || 'Groq'} API key</h3>${keyPrompt()}`),
    'set-provider': (b) => { Native.aiSetProvider?.(b.dataset.v); if (b.dataset.v === 'groq' && Native.aiHasKeyFor?.('groq')) Native.aiListModels?.(); render(); },
    'ai-auto': () => { Native.aiSetAuto?.(!Native.aiAuto?.()); render(); },
    'groq-refresh': () => { Native.aiListModels?.(); toast('Checking which models your key can use…'); },
    'ai-forget': () => { Native.aiSetKey('', provider()); toast('API key removed'); render(); },
    'set-model': (b) => { Native.aiSetModel?.(b.dataset.v); render(); },
    // iPhone/iPad and web: what each AI answers, or the exact error (Copy to send it).
    'ai-test': async (b) => {
      const out = $('#ai-test-out');
      b.disabled = true; b.textContent = 'Testing…';
      out.hidden = false; out.textContent = 'Asking each AI for one word…';
      try { out.textContent = await Native.aiTest(); } catch (e) { out.textContent = 'Test failed: ' + (e.message || e); }
      b.disabled = false; b.textContent = 'Test again';
      out.onclick = () => { D.copyText(out.textContent); };
    },
    'set-level': (b) => { aiPrefs.level = b.dataset.v; saveAiPrefs(); render(); },
  });
})();
