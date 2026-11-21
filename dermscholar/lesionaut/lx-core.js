// Lesionaut core: the app shell (router, bottom tabs, sheets, toasts), the phone bridge (the Android
// app's "Native", or web.js's WebNative in the browser), AI calls, pictures and case storage.
// The screens live in lx-case.js, lx-explore.js, lx-tools.js and lx-settings.js.
(() => {
  'use strict';
  const N = window.Native || window.WebNative || {};
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const view = () => $('#view');

  // ---- Small persistent settings (this device)
  const store = {
    get(k, d) { try { const v = localStorage.getItem('lx.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('lx.' + k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
  };

  // ---- Icons (24px, stroked)
  const P = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
    cases: '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M8 6V4h8v2"/><path d="M3 12h18"/>',
    explore: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
    tools: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 7h8M8 12h2M12 12h2M16 12h0M8 16h2M12 16h2M16 16h0"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    back: '<path d="M15 18l-6-6 6-6"/>', chev: '<path d="M9 18l6-6-6-6"/>', plus: '<path d="M12 5v14M5 12h14"/>', x: '<path d="M18 6L6 18M6 6l12 12"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>', image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>',
    dots: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
    pen: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/>', trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    share: '<path d="M12 3v13M7 8l5-5 5 5"/><path d="M5 13v7h14v-7"/>', chat: '<path d="M4 5h16v11H9l-5 4z"/>',
    alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h0"/>', check: '<path d="M5 12l5 5L20 7"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>', book: '<path d="M4 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4z"/><path d="M20 4h-6v16"/>',
    micro: '<path d="M9 3h4l-1 6"/><path d="M12 9a5 5 0 1 0 5 5"/><path d="M6 21h12M10 17h4"/>', people: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c1-4 4-6 7-6s6 2 7 6"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14c2 0 4 1.5 5 4"/>',
    detective: '<circle cx="10" cy="10" r="6"/><path d="M15 15l6 6"/><path d="M7.5 10a2.5 2.5 0 0 1 2.5-2.5"/>', pill: '<rect x="3" y="9" width="18" height="6" rx="3" transform="rotate(-35 12 12)"/><path d="M9.5 8.5l5 7"/>',
    note: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>', link: '<path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1"/><path d="M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>', layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    compare: '<rect x="3" y="5" width="8" height="14" rx="2"/><rect x="13" y="5" width="8" height="14" rx="2"/>', refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    graduation: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c2 2 10 2 12 0v-5"/>', grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  };
  const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`;
  const MARK = `<svg class="mark" viewBox="0 0 48 48" aria-hidden="true"><defs><linearGradient id="lxbg" x1="8" y1="4" x2="40" y2="46" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#0E7490"/><stop offset="1" stop-color="#0B2233"/></linearGradient><linearGradient id="lxgold" x1="10" y1="10" x2="38" y2="38" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#FDE9B0"/><stop offset="1" stop-color="#D9A84E"/></linearGradient></defs><rect width="48" height="48" rx="11" fill="url(#lxbg)"/><ellipse cx="24" cy="24" rx="19.5" ry="7" fill="none" stroke="url(#lxgold)" stroke-width="1.6" transform="rotate(-24 24 24)"/><circle cx="24" cy="24" r="11.2" fill="#F3E3D6" stroke="url(#lxgold)" stroke-width="2.4"/><path d="M20.2,20.6c1.6,-2 4.6,-2.4 6.6,-1c2,1.3 2.9,3.4 2.3,5.6c-0.5,2.1 -2.4,3.9 -4.7,4.3c-2.2,0.4 -4.6,-0.4 -5.6,-2.4c-1,-1.9 -0.3,-4.5 1.4,-6.5z" fill="#8A4B3A"/><circle cx="38.2" cy="11.2" r="1.5" fill="#FDE9B0"/></svg>`;

  // ---- Toast, sheet, lightbox
  let toastT = 0;
  function toast(m) {
    $('.toast')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="toast">${esc(m)}</div>`);
    clearTimeout(toastT);
    toastT = setTimeout(() => $('.toast')?.remove(), 2800);
  }
  function sheet(html) {
    closeSheet();
    document.body.insertAdjacentHTML('beforeend', `<div class="sheet-bg" data-act="close-sheet"></div><div class="sheet" role="dialog"><div class="grab"></div>${html}</div>`);
  }
  function closeSheet() { $$('.sheet, .sheet-bg').forEach((e) => e.remove()); }
  function lightbox(list, i = 0) {
    const show = () => {
      $('#lb')?.remove();
      const f = list[i];
      document.body.insertAdjacentHTML('beforeend', `<div class="lb" id="lb"><div class="lb-top"><span>${esc(f.label || '')}${list.length > 1 ? ` · ${i + 1} of ${list.length}` : ''}</span>
        ${list.length > 1 ? `<button class="ib" data-act="lb-prev">${icon('back')}</button><button class="ib" data-act="lb-next">${icon('chev')}</button>` : ''}<button class="ib" data-act="lb-close">${icon('x')}</button></div>
        <div class="stage"><img src="${f.src}" alt=""></div>${f.caption ? `<div class="small" style="color:#cfd8dc;padding:8px 14px 16px">${esc(f.caption)}</div>` : ''}</div>`);
    };
    actions['lb-close'] = () => $('#lb')?.remove();
    actions['lb-prev'] = () => { i = (i - 1 + list.length) % list.length; show(); };
    actions['lb-next'] = () => { i = (i + 1) % list.length; show(); };
    show();
  }

  // ---- Minimal Markdown (headings, lists, bold, italics, tables)
  function md(text) {
    const inl = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])\*(?!\s)(.+?)\*(?=[\s).,;:]|$)/g, '$1<i>$2</i>').replace(/(^|[\s(])_(.+?)_(?=[\s).,;:]|$)/g, '$1<i>$2</i>');
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    let out = '', list = '', table = [];
    const flushList = () => { if (list) { out += `</${list}>`; list = ''; } };
    const flushTable = () => {
      if (!table.length) return;
      const rows = table.filter((r) => !/^\s*\|?\s*:?-{2,}/.test(r)).map((r) => r.replace(/^\s*\||\|\s*$/g, '').split('|').map((c) => c.trim()));
      out += '<table>' + rows.map((r, i) => `<tr>${r.map((c) => `<${i ? 'td' : 'th'}>${inl(c)}</${i ? 'td' : 'th'}>`).join('')}</tr>`).join('') + '</table>';
      table = [];
    };
    for (const raw of lines) {
      const l = raw.trimEnd();
      if (/^\s*\|.*\|\s*$/.test(l)) { flushList(); table.push(l); continue; }
      flushTable();
      let m;
      if ((m = /^(#{1,4})\s+(.*)/.exec(l))) { flushList(); out += `<h${Math.min(4, m[1].length + 1)}>${inl(m[2])}</h${Math.min(4, m[1].length + 1)}>`; }
      else if ((m = /^\s*[-*•]\s+(.*)/.exec(l))) { if (list !== 'ul') { flushList(); out += '<ul>'; list = 'ul'; } out += `<li>${inl(m[1])}</li>`; }
      else if ((m = /^\s*\d+[.)]\s+(.*)/.exec(l))) { if (list !== 'ol') { flushList(); out += '<ol>'; list = 'ol'; } out += `<li>${inl(m[1])}</li>`; }
      else if (!l.trim()) flushList();
      else { flushList(); out += `<p>${inl(l)}</p>`; }
    }
    flushList(); flushTable();
    return `<div class="md">${out}</div>`;
  }

  // ---- The phone bridge: answers come back through App.onNative
  let seq = 0;
  const waits = {};
  const nid = (p) => p + (++seq) + '_' + Date.now();
  function wait(id, ms, onTimeout) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { if (waits[id]) { delete waits[id]; reject(new Error(onTimeout)); } }, ms);
      waits[id] = (e) => { clearTimeout(t); resolve(e); };
    });
  }
  const hasKey = () => { try { return !!N.aiHasKey?.(); } catch { return false; } };
  const keyErr = (e) => (e?.message === 'NO_KEY' ? 'Add an AI key in Settings first.' : e?.message || String(e));

  /** A text question to the AI (the saved keys, falling back between them). */
  async function ai(task, { system = '', max = 3000, doc = '' } = {}) {
    if (!hasKey()) throw new Error('NO_KEY');
    if (!N.aiRun) throw new Error('The AI needs the Lesionaut app or its web version.');
    const id = nid('ai');
    const p = wait(id, 240000, 'No AI answered within 4 minutes. Try again.');
    N.aiRun(id, system, doc, task, max, null);
    const e = await p;
    if (e.state !== 'done') throw new Error(e.message || 'The AI request failed.');
    return e.text || '';
  }
  /** One question about several pictures (data URLs). */
  async function aiPics(task, urls, { system = '', max = 4000 } = {}) {
    if (!hasKey()) throw new Error('NO_KEY');
    if (!urls.length) return ai(task, { system, max });
    const id = nid('vis');
    const p = wait(id, 240000, 'No AI answered about the pictures within 4 minutes. They may be busy: try again (Gemini and Claude read pictures best).');
    if (N.aiRunImages) N.aiRunImages(id, system, task, JSON.stringify(urls), max);
    else if (N.aiRunImage) N.aiRunImage(id, system, urls.length > 1 ? task + '\n(The pictures are numbered tiles in one image.)' : task, urls.length > 1 ? await collage(urls) : urls[0], max);
    else throw new Error('Pictures need the Lesionaut app or its web version.');
    const e = await p;
    if (e.state !== 'done') throw new Error(e.message || 'The AI request failed.');
    return e.text || '';
  }
  /** JSON from an AI answer, with light repairs. */
  function json(text) {
    try { return JSON.parse(text); } catch { /* below */ }
    const m = String(text).replace(/```(?:json)?/gi, '').match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (m) {
      try { return JSON.parse(m[0]); } catch { /* repairs */ }
      try { return JSON.parse(m[0].replace(/,\s*([}\]])/g, '$1').replace(/"(?:[^"\\]|\\.)*"/g, (s) => s.replace(/\n/g, '\\n'))); } catch { /* give up */ }
    }
    throw new Error('The AI answer came back in a broken format. Try again.');
  }

  // ---- Pictures
  function pickImages(max) {
    if (!N.pickImages) return Promise.reject(new Error('No photo picker here'));
    const id = nid('img');
    const p = wait(id, 600000, 'cancelled');
    N.pickImages(id, max);
    return p.then((e) => { if (e.error) throw new Error(e.error); return e.dataUrls?.length ? e.dataUrls : [e.dataUrl]; });
  }
  function camera() {
    if (N.captureImage) {
      const id = nid('cam');
      const p = wait(id, 900000, 'cancelled');
      N.captureImage(id);
      return p.then((e) => { if (e.error) throw new Error(e.error); return [e.dataUrl]; });
    }
    // The browser: the camera through a file input.
    return new Promise((resolve, reject) => {
      const inp = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
      inp.capture = 'environment';
      inp.style.display = 'none';
      inp.onchange = async () => {
        const f = inp.files?.[0]; inp.remove();
        if (!f) { reject(new Error('cancelled')); return; }
        const r = new FileReader(); r.onload = () => resolve([r.result]); r.onerror = () => reject(new Error('Couldn\'t read the photo')); r.readAsDataURL(f);
      };
      document.body.appendChild(inp); inp.click();
    });
  }
  function shrink(url, max = 1024, q = 0.84) {
    return new Promise((res) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', q));
      };
      img.onerror = () => res(url);
      img.src = url;
    });
  }
  async function collage(urls) {
    const imgs = await Promise.all(urls.map((u) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = u; })));
    const cols = urls.length <= 4 ? 2 : 3, rows = Math.ceil(urls.length / cols), T = Math.round(2048 / cols);
    const c = document.createElement('canvas'); c.width = cols * T; c.height = rows * T;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    imgs.forEach((im, i) => {
      if (!im) return;
      const x = (i % cols) * T, y = Math.floor(i / cols) * T, k = Math.min(T / im.width, T / im.height);
      g.drawImage(im, x + (T - im.width * k) / 2, y + (T - im.height * k) / 2, im.width * k, im.height * k);
      g.fillStyle = 'rgba(0,0,0,.65)'; g.fillRect(x, y, 60, 40); g.fillStyle = '#fff'; g.font = 'bold 26px sans-serif'; g.fillText(String(i + 1), x + 14, y + 30);
    });
    return c.toDataURL('image/jpeg', 0.85);
  }

  // ---- Cases (this device; IndexedDB)
  const DB = (() => {
    let dbp = null;
    const open = () => (dbp ||= new Promise((res, rej) => {
      const r = indexedDB.open('lesionaut', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('cases', { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
    const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction('cases', mode); const q = fn(t.objectStore('cases')); t.oncomplete = () => res(q?.result); t.onerror = () => rej(t.error); }); };
    return {
      all: () => tx('readonly', (s) => s.getAll()).then((l) => (l || []).map(norm).sort((a, b) => b.updated - a.updated)),
      get: (id) => tx('readonly', (s) => s.get(id)).then((c) => (c ? norm(c) : null)),
      put: (c) => { c.updated = Date.now(); return tx('readwrite', (s) => s.put(c)); },
      del: (id) => tx('readwrite', (s) => s.delete(id)),
    };
  })();
  /** Fills in fields added after a case was made. */
  function norm(c) {
    return Object.assign({ title: '', patient: '', visitOf: '', pt: {}, pics: [], answers: [], assessments: [], thread: [], final: { dx: '', note: '' }, docs: {}, debate: null, rare: null, treat: {}, compare: null }, c);
  }

  // ---- Background jobs: a bar shows them on other screens
  const jobs = {}; // key → { label, state, caseId, started, message }
  function jobBar() {
    const running = Object.values(jobs).filter((j) => j.state === 'running');
    const doneUnseen = Object.values(jobs).find((j) => j.state !== 'running' && !j.seen && !onCase(j.caseId));
    let el = $('#jobbar');
    if (!running.length && !doneUnseen) { el?.remove(); return; }
    if (!el) { el = document.createElement('button'); el.id = 'jobbar'; el.className = 'jobbar'; el.dataset.act = 'job-open'; document.body.appendChild(el); }
    const j = running.find((x) => !onCase(x.caseId)) || doneUnseen || running[0];
    if (onCase(j.caseId) && !doneUnseen) { el.remove(); return; }
    el.dataset.case = j.caseId || '';
    el.innerHTML = j.state === 'running' ? `<span class="spin"></span>${esc(j.label)}…` : `${j.state === 'done' ? '✓' : '!'} ${esc(j.label)} ${j.state === 'done' ? 'ready' : 'stopped'} · <b>Open</b>`;
  }
  const onCase = (id) => !!id && cur.name === 'case' && cur.arg.split('/')[0] === id;
  async function runJob(key, label, caseId, fn) {
    if (jobs[key]?.state === 'running') return null;
    const j = jobs[key] = { label, state: 'running', caseId, started: Date.now() };
    jobBar();
    try { const r = await fn(); j.state = 'done'; return r; } catch (e) { j.state = 'error'; j.message = keyErr(e); throw e; } finally {
      if (onCase(caseId)) { j.seen = true; render(); } else if (j.state === 'done') toast(`${label}: ready`);
      jobBar();
    }
  }

  // ---- Router and tabs
  const routes = {};
  const TAB = { home: 'home', cases: 'cases', case: 'cases', new: 'cases', explore: 'explore', pattern: 'explore', teach: 'explore', detective: 'explore', relations: 'explore', lit: 'explore', tools: 'tools', tool: 'tools', settings: 'settings' };
  let cur = { name: 'home', arg: '', params: {} };
  let depth = 0;
  function parse() {
    const h = location.hash.replace(/^#\/?/, '');
    const [path, qs] = h.split('?');
    const seg = path.split('/').map(decodeURIComponent);
    return { name: seg[0] || 'home', arg: seg.slice(1).join('/'), params: Object.fromEntries(new URLSearchParams(qs || '')) };
  }
  function go(hash, { replace = false } = {}) {
    hash = '#' + String(hash).replace(/^#/, '');
    if (hash === location.hash || (hash === '#' && !location.hash)) { render(); return; }
    if (replace) { location.replace(hash); return; }
    depth++;
    location.hash = hash;
  }
  async function render() {
    closeSheet();
    $('#lb')?.remove();
    const r = parse();
    cur = r;
    $$('nav.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === TAB[r.name]));
    window.scrollTo(0, 0);
    try { await (routes[r.name] || routes.home)(r.arg, r.params); } catch (e) { view().innerHTML = `<div class="empty">${icon('alert')}<b>Something went wrong</b>${esc(e.message || e)}</div>`; }
    jobBar();
  }
  const bar = (title, { back = true, right = '' } = {}) => `<div class="bar">${back ? `<button class="ib" data-act="back" aria-label="Back">${icon('back')}</button>` : ''}<h1>${esc(title)}</h1>${right}</div>`;

  // ---- Taps: data-act="name" runs actions[name](element, event)
  const actions = {};
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const f = actions[el.dataset.act];
    if (f) { e.preventDefault(); f(el, e); }
  });
  actions['close-sheet'] = () => closeSheet();
  actions.back = () => { if (depth > 0) { depth--; history.back(); } else go('', { replace: true }); };
  actions.go = (b) => go(b.dataset.to);
  actions['job-open'] = (b) => { if (b.dataset.case) go('case/' + b.dataset.case); };
  actions.open = (b) => openLink(b.dataset.url);
  function openLink(url) { if (N.openBrowser) N.openBrowser(url); else window.open(url, '_blank', 'noopener'); }

  // ---- Theme
  function applyTheme() {
    const t = store.get('theme', 'system');
    const dark = t === 'dark' || (t === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

  // ---- What the phone sends back
  const listeners = {};
  window.App = {
    onNative(e) {
      if (!e) return;
      if (e.id && waits[e.id] && (e.type === 'ai' || e.type === 'imagePicked')) { const f = waits[e.id]; delete waits[e.id]; f(e); return; }
      (listeners[e.type] || []).forEach((f) => f(e));
    },
    back() {
      if ($('.studio')) { $('.studio').remove(); actions.back(); return true; }
      if ($('#lb')) { $('#lb').remove(); return true; }
      if ($('.sheet')) { closeSheet(); return true; }
      if (cur.name !== 'home') { actions.back(); return true; }
      return false;
    },
    onResume() {},
  };
  const on = (type, f) => (listeners[type] ||= []).push(f);
  // web.js shows its messages through DS.toast.
  window.DS = window.DS || { toast };

  window.addEventListener('hashchange', render);
  function start() {
    applyTheme();
    $$('nav.tabs button').forEach((b) => {
      b.insertAdjacentHTML('afterbegin', icon(b.dataset.icon));
      b.addEventListener('click', () => { const to = { home: '', cases: 'cases', explore: 'explore', tools: 'tools', settings: 'settings' }[b.dataset.tab]; if (parse().name === (to || 'home')) window.scrollTo({ top: 0, behavior: 'smooth' }); else go(to); });
    });
    try { navigator.storage?.persist?.(); } catch { /* not offered */ }
    render();
  }

  const fmt = (t) => new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const fmtDay = (t) => new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  const list = (x) => (Array.isArray(x) ? x.filter(Boolean) : []);
  window.LX = { N, $, $$, esc, icon, MARK, store, toast, sheet, closeSheet, lightbox, md, ai, aiPics, json, hasKey, keyErr, pickImages, camera, shrink, DB, norm, jobs, runJob, jobBar,
    routes, actions, go, render, bar, on, openLink, applyTheme, start, fmt, fmtDay, list, get cur() { return cur; } };
})();
