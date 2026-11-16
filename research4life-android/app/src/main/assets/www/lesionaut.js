// Lesionaut: a dermatology diagnostic copilot built from DermScholar's screens (lesionaut.html sets
// window.LESIONAUT). A case holds the history and any mix of evidence (clinical photographs,
// dermoscopy, H&E, DIF, KOH and other microscopy, laboratory reports); the AI reads all of it
// together and returns a ranked differential with the evidence for and against each diagnosis, an
// evidence matrix, must-not-miss conditions, the next best investigations and the questions that
// would help. Each assessment is kept, so the case shows how the diagnosis evolved.
// Cases and pictures stay on this device (IndexedDB), never in the account sync.
(() => {
  'use strict';
  if (!window.LESIONAUT) return;
  const D = window.DS;
  const I = window.DSI;
  const { $, $$, esc, icon, md, go, actions, ext, toast, render, sheet, closeSheet } = D;
  const view = $('#view');

  const MAX_PICS = 10;
  const SEND_PX = 1024; // big enough for histology detail, small enough to be quick
  const KINDS = {
    clinical: ['Clinical', 'Clinical photograph'],
    dermoscopy: ['Dermoscopy', 'Dermoscopic image'],
    he: ['H&E', 'Histopathology (H&E or special stain)'],
    dif: ['DIF', 'Direct immunofluorescence'],
    micro: ['KOH / smear', 'KOH mount, Tzanck, Gram or other microscopy'],
    lab: ['Lab report', 'Laboratory report (read it and interpret the values)'],
    other: ['Other', 'Other image'],
  };
  const STRENGTH = { strong: ['Strong consideration', 'lx-strong'], consider: ['Consider', 'lx-consider'], alternative: ['Alternative', 'lx-alt'], unlikely: ['Less likely', 'lx-unlikely'] };
  const VERDICT = { supports: ['✓', 'Supports', 'lx-v-yes'], against: ['✗', 'Against', 'lx-v-no'], nonspecific: ['~', 'Nonspecific', 'lx-v-mid'], neutral: ['–', 'Not informative', 'lx-v-na'] };

  // ---- Storage: one record per case, pictures included (this phone only).
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
      all: () => tx('readonly', (s) => s.getAll()).then((l) => (l || []).sort((a, b) => b.updated - a.updated)),
      get: (id) => tx('readonly', (s) => s.get(id)),
      put: (c) => { c.updated = Date.now(); return tx('readwrite', (s) => s.put(c)); },
      del: (id) => tx('readwrite', (s) => s.delete(id)),
    };
  })();
  const blank = () => ({ id: 'c' + Date.now().toString(36), created: Date.now(), updated: Date.now(), title: '', pt: {}, pics: [], answers: [], assessments: [], thread: [], final: { dx: '', note: '' } });
  const titleOf = (c) => c.title || (c.final?.dx ? c.final.dx : c.assessments.length ? 'Case: ' + (latest(c)?.r?.differentials?.[0]?.name || 'assessed') : 'New case');
  const latest = (c) => c.assessments[c.assessments.length - 1];
  const fmt = (t) => new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const list = (x) => (Array.isArray(x) ? x.filter(Boolean) : []);

  // ---- Navigation: Cases, New case, Settings.
  Object.assign(ext.tabs ||= {}, { cases: '', newcase: 'lxnew', lxsettings: 'settings' });
  Object.assign(ext.tabOf ||= {}, { home: 'cases', lxcase: 'cases', lxnew: 'newcase', settings: 'lxsettings' });

  // ================================================================ Cases list
  async function renderHome() {
    view.innerHTML = `<div class="home-top"><div class="brand"><span class="lx-logo">${icon('camera')}</span><span><b>Lesionaut</b><small>Dermatology diagnostic copilot</small></span></div>
        <button class="icon-btn" data-act="settings" aria-label="Settings">${icon('settings')}</button></div>
      <section class="hero-card lx-hero"><span class="hero-eyebrow">Clinicopathological correlation</span>
        <h2>Start a <em>case</em></h2>
        <p class="hero-sub">Clinical · dermoscopy · H&E · DIF · KOH · lab reports, read together</p>
        <button class="btn primary full" data-act="lx-new">${icon('plus')}New case</button></section>
      ${I.needKey() ? I.keyCard() : ''}
      <div class="section"><div class="section-h"><h3>Cases</h3></div><div id="lx-list">${I.busyHtml('Loading…')}</div></div>
      <p class="muted small lx-disc">Decision support for clinicians, not a validated diagnostic device. Cases and pictures stay on this phone.</p>`;
    let cases = await DB.all().catch(() => []);
    // A case opened and left empty is not kept.
    const empty = (c) => !c.pics.length && !c.assessments.length && !c.title && !Object.values(c.pt).some(Boolean) && Date.now() - c.created > 60000;
    cases.filter(empty).forEach((c) => DB.del(c.id).catch(() => {}));
    cases = cases.filter((c) => !empty(c));
    const el = $('#lx-list');
    if (!el) return;
    el.innerHTML = cases.length ? cases.map((c) => {
      const a = latest(c);
      const top = a?.r?.differentials?.[0];
      const kinds = [...new Set(c.pics.map((p) => KINDS[p.kind]?.[0]))].join(' · ');
      return `<button class="lx-row" data-act="lx-open" data-id="${esc(c.id)}">
        ${c.pics[0] ? `<img src="${c.pics[0].url}" alt="">` : `<span class="lx-noimg">${icon('camera')}</span>`}
        <span><b>${esc(titleOf(c))}</b><small>${esc([kinds || 'No pictures yet', c.final?.dx ? 'Final: ' + c.final.dx : top ? 'Leading: ' + top.name : 'Not assessed'].join(' · '))}</small>
        <small class="muted">${fmt(c.updated)}${jobs[c.id]?.state === 'running' ? ' · assessing…' : ''}</small></span></button>`;
    }).join('') : `<div class="empty">${icon('camera')}<b>No cases yet</b><div>Tap New case, add the history and pictures (up to ${MAX_PICS}), then Assess.</div></div>`;
  }
  actions['lx-new'] = () => go('lxnew');
  actions['lx-open'] = (b) => go('lxcase/' + b.dataset.id);
  async function newCase() {
    const c = blank();
    await DB.put(c);
    go('lxcase/' + c.id, { replace: true });
  }

  // ================================================================ The case workspace
  let cur = null; // the case on screen
  let addKind = 'clinical';
  let shownIdx = -1; // which assessment is on screen (-1: the latest)
  const save = () => (cur ? DB.put(cur).catch(() => toast('Couldn\'t save the case (storage full?)')) : null);
  let saveT = 0;
  const saveSoon = () => { clearTimeout(saveT); saveT = setTimeout(save, 600); };

  const PT = [
    ['age', 'Age', 'e.g. 34'], ['sex', 'Sex', 'F / M'], ['site', 'Site and distribution', 'e.g. extensor forearms, symmetric'],
    ['duration', 'Duration and course', 'e.g. 3 months, progressive'], ['symptoms', 'Symptoms', 'itch, pain, burning, systemic'],
    ['history', 'History and examination', 'onset, morphology, mucosa, nails, hair, past history, family history'],
    ['meds', 'Medicines', 'current and recent, with start dates'], ['treated', 'Treatment so far and response', ''],
    ['labs', 'Investigations (typed)', 'e.g. ANA 1:320 speckled, ESR 40, KOH negative'], ['phototype', 'Skin phototype', 'I–VI'],
  ];

  async function renderCase(id) {
    const c = await DB.get(id).catch(() => null);
    if (!c) { view.innerHTML = `${D.topbar('Case')}<div class="empty">${icon('x')}<b>Case not found</b></div>`; return; }
    if (!cur || cur.id !== c.id) shownIdx = -1;
    cur = c;
    const job = jobs[c.id];
    view.innerHTML = `${D.topbar('Case', { right: `<button class="icon-btn" data-act="lx-more" aria-label="More">${icon('dots')}</button>` })}
      <input class="lx-title" id="lx-title" value="${esc(c.title)}" placeholder="${esc(titleOf(c))}" aria-label="Case title">
      <details class="panel lx-pt" ${c.assessments.length ? '' : 'open'}><summary><b>History and examination</b><span class="muted small">${esc(ptLine(c) || 'Add what you know: it changes the differential')}</span></summary>
        <div class="lx-grid">${PT.map(([k, l, ph]) => `<label class="lx-f ${['history', 'treated', 'labs', 'site'].includes(k) ? 'wide' : ''}"><span>${l}</span>${['history', 'treated', 'labs'].includes(k)
          ? `<textarea data-pt="${k}" rows="2" placeholder="${esc(ph)}">${esc(c.pt[k] || '')}</textarea>`
          : `<input data-pt="${k}" value="${esc(c.pt[k] || '')}" placeholder="${esc(ph)}">`}</label>`).join('')}</div></details>
      <div class="section"><div class="section-h"><h3>Evidence</h3><span class="muted small" id="lx-count">${c.pics.length}/${MAX_PICS} pictures</span></div>
        <div class="scroll-x" id="lx-kinds">${Object.entries(KINDS).map(([k, [l]]) => `<button class="chip ${k === addKind ? 'on' : ''}" data-act="lx-kind" data-k="${k}">${esc(l)}</button>`).join('')}</div>
        <div class="lx-pics" id="lx-pics"></div></div>
      ${c.answers.length ? `<div class="panel lx-answers"><b>Your answers</b>${c.answers.map((x, i) => `<p class="small"><b>${esc(x.q)}</b> ${esc(x.a)} <button class="linkish" data-act="lx-ans-del" data-i="${i}">remove</button></p>`).join('')}</div>` : ''}
      <button class="btn primary full lx-go" data-act="lx-assess" ${job?.state === 'running' ? 'disabled' : ''}>${icon('spark')}${c.assessments.length ? 'Re-assess with all the evidence' : 'Assess case'}</button>
      <div id="lx-out"></div>
      <div id="lx-evo"></div>
      <div id="lx-thread"></div>
      <div class="section"><div class="section-h"><h3>Final diagnosis</h3></div>
        <div class="panel"><input id="lx-final" class="lx-input" value="${esc(c.final?.dx || '')}" placeholder="The diagnosis you settle on">
        <textarea id="lx-final-note" class="lx-input" rows="2" placeholder="Basis, biopsy result, follow-up (optional)">${esc(c.final?.note || '')}</textarea></div></div>
      <p class="muted small lx-disc">AI suggestions to support your judgement, not a diagnosis. They can be wrong, especially with poor pictures or little history. No probabilities are given because none are validated.</p>`;
    paintPics();
    paintOut();
    $('#lx-title').addEventListener('input', (e) => { cur.title = e.target.value.trim(); saveSoon(); });
    $$('[data-pt]').forEach((el) => el.addEventListener('input', () => { cur.pt[el.dataset.pt] = el.value.trim(); saveSoon(); }));
    $('#lx-final').addEventListener('input', (e) => { cur.final.dx = e.target.value.trim(); saveSoon(); });
    $('#lx-final-note').addEventListener('input', (e) => { cur.final.note = e.target.value.trim(); saveSoon(); });
  }
  const ptLine = (c) => [c.pt.age && c.pt.age + ' y', c.pt.sex, c.pt.site, c.pt.duration].filter(Boolean).join(' · ');

  function paintPics() {
    const el = $('#lx-pics');
    if (!el || !cur) return;
    el.innerHTML = cur.pics.map((p, i) => `<div class="lx-pic"><img src="${p.url}" alt="" data-act="lx-zoom" data-i="${i}">
        <small><b>${i + 1}.</b> ${esc(KINDS[p.kind]?.[0] || p.kind)}${p.note ? ' · ' + esc(p.note) : ''}</small>
        <button class="lx-x" data-act="lx-pic-del" data-i="${i}" aria-label="Remove">×</button>
        <button class="lx-note" data-act="lx-pic-note" data-i="${i}" aria-label="Note">${icon('note')}</button></div>`).join('')
      + (cur.pics.length < MAX_PICS ? `<button class="lx-add" data-act="lx-pick">${icon('camera')}<span>Add ${esc(KINDS[addKind][0])}<br><small>${cur.pics.length ? 'more pictures' : 'one or several'}</small></span></button>` : '');
  }
  actions['lx-kind'] = (b) => { addKind = b.dataset.k; $$('[data-act=lx-kind]').forEach((x) => x.classList.toggle('on', x === b)); paintPics(); };
  actions['lx-pick'] = async () => {
    const room = MAX_PICS - cur.pics.length;
    let urls;
    try { urls = await I.pickImages(room); } catch (e) { if (!/cancel/i.test(e.message || '')) toast(e.message || 'Couldn\'t open the photos'); return; }
    const c = cur;
    for (const u of urls.slice(0, room)) c.pics.push({ url: await I.shrink(u, SEND_PX), kind: addKind, note: '', at: Date.now() });
    if (urls.length > room) toast(`${MAX_PICS} pictures at most: the first ${room} were added`);
    await DB.put(c);
    if (cur === c) { paintPics(); const h = $('#lx-count'); if (h) h.textContent = `${c.pics.length}/${MAX_PICS} pictures`; }
  };
  actions['lx-pic-del'] = async (b) => { cur.pics.splice(+b.dataset.i, 1); await save(); paintPics(); const h = $('#lx-count'); if (h) h.textContent = `${cur.pics.length}/${MAX_PICS} pictures`; };
  actions['lx-pic-note'] = (b) => {
    const p = cur.pics[+b.dataset.i];
    sheet(`<h3>Picture ${+b.dataset.i + 1}: ${esc(KINDS[p.kind]?.[1] || '')}</h3>
      <form data-form="lx-note"><label class="field">Type</label><div class="row wrap">${Object.entries(KINDS).map(([k, [l]]) => `<button type="button" class="chip ${k === p.kind ? 'on' : ''}" data-act="lx-note-kind" data-k="${k}">${esc(l)}</button>`).join('')}</div>
      <label class="field">Note (site, stain, magnification, what to look at)</label><input name="n" value="${esc(p.note || '')}" placeholder="e.g. edge of plaque, ×400, PAS">
      <div class="actions"><button type="button" class="btn" data-act="close-sheet">Cancel</button><button class="btn primary">Save</button></div></form>`);
    let kind = p.kind;
    actions['lx-note-kind'] = (x) => { kind = x.dataset.k; $$('[data-act=lx-note-kind]').forEach((y) => y.classList.toggle('on', y === x)); };
    $('[data-form=lx-note]').addEventListener('submit', async (e) => { e.preventDefault(); p.note = e.target.n.value.trim(); p.kind = kind; closeSheet(true); await save(); paintPics(); });
  };
  actions['lx-zoom'] = (b) => D.lightbox(cur.pics.map((p, i) => ({ src: p.url, label: `${i + 1}. ${KINDS[p.kind]?.[0] || ''}`, caption: p.note || '' })), +b.dataset.i);
  actions['lx-ans-del'] = async (b) => { cur.answers.splice(+b.dataset.i, 1); await save(); render(); };
  actions['lx-more'] = () => sheet(`<h3>${esc(titleOf(cur))}</h3>
      <button class="btn full" data-act="lx-export">${icon('share')}Share a summary (text, no pictures)</button>
      <div class="spacer"></div><button class="btn full danger" data-act="lx-delete">${icon('trash')}Delete this case</button>`);
  actions['lx-delete'] = async () => { if (!confirm('Delete this case and its pictures from this phone?')) return; closeSheet(true); await DB.del(cur.id); cur = null; go('', { replace: true }); };
  actions['lx-export'] = () => { closeSheet(true); D.Native.share(titleOf(cur), summaryText(cur)); };

  // ================================================================ The AI reading
  const SYSTEM = `You are Lesionaut, a diagnostic copilot for dermatologists. You think like an experienced clinical dermatologist, dermoscopist, dermatopathologist and immunodermatologist working together, and you correlate every piece of evidence (history, clinical photographs, dermoscopy, histopathology, immunofluorescence, microscopy, laboratory results) instead of reading each in isolation.
Rules:
- Describe what is actually visible before interpreting it; never invent findings that are not in the pictures or the history.
- Correlate: say where sources agree, and point out contradictions explicitly.
- Rank the differential by how well each diagnosis explains ALL the evidence. Give supporting findings, findings against, and characteristic features that are missing.
- Always include dangerous conditions that must not be missed when they are reasonable.
- Do not force a diagnosis. When the evidence is insufficient or the pictures are poor, say so and say what would settle it.
- Never give numeric probabilities or percentages; use the strength words in the schema.
- Consider skin of colour (erythema may look violaceous or brown; pigmentary change is common).
- For histology, name the reaction pattern first (e.g. interface, psoriasiform, spongiotic, granulomatous, vasculitis, panniculitis, bullous), then the specific clues.
- For laboratory reports, read the values and interpret them in dermatological context, not just high/low.
- Be concise and clinical. This is decision support for a clinician, not advice to a patient.`;

  const SCHEMA_TEXT = `Reply with JSON only (no Markdown), exactly this shape:
{
 "summary": "2-4 sentences: the integrated clinicopathological assessment",
 "changed": "what changed compared with the previous assessment and why ('' if none was given)",
 "sufficiency": "adequate | limited | insufficient",
 "uncertainty": "what limits confidence (picture quality, missing history or tests, conflicting findings)",
 "pattern": "the clinical, dermoscopic and/or histological pattern in a few words",
 "pictures": [{"n": 1, "quality": "good | adequate | poor", "observations": ["what is visible"], "retake": "advice to retake, or ''"}],
 "differentials": [{"name": "diagnosis", "strength": "strong | consider | alternative | unlikely", "reasoning": "one or two sentences", "supporting": ["finding (source)"], "against": ["finding (source)"], "missing": ["expected feature not seen"]}],
 "matrix": [{"finding": "key finding", "source": "clinical | dermoscopy | histology | DIF | lab | history", "verdicts": ["supports | against | nonspecific | neutral, one per differential, in the same order"]}],
 "mustNotMiss": [{"name": "condition", "why": "why it needs excluding"}],
 "tests": [{"test": "investigation", "why": "what it distinguishes", "ifPositive": "what a positive result means", "ifNegative": "what a negative result means"}],
 "questions": ["short questions for the patient or examination findings that would change the differential"]
}
Give 3-6 differentials (most likely first), 5-10 matrix rows covering the most discriminating findings, at most 4 tests (most useful first) and at most 6 questions.`;

  function caseText(c, prev) {
    const pt = PT.map(([k, l]) => (c.pt[k] ? `${l}: ${c.pt[k]}` : '')).filter(Boolean).join('\n') || 'No history given.';
    const pics = c.pics.map((p, i) => `Picture ${i + 1}: ${KINDS[p.kind]?.[1] || p.kind}${p.note ? ' — ' + p.note : ''}`).join('\n') || 'No pictures.';
    const ans = c.answers.length ? '\nAnswers to earlier questions:\n' + c.answers.map((x) => `- ${x.q} → ${x.a}`).join('\n') : '';
    const was = prev ? `\nPrevious assessment (${fmt(prev.at)}, from ${prev.n} pictures): ${list(prev.r.differentials).map((d) => `${d.name} (${d.strength})`).join('; ')}. Summary: ${prev.r.summary || ''}\nExplain in "changed" how the new evidence changes this, if it does.` : '';
    return `CASE\n${pt}${ans}\n\nPICTURES (in the order attached)\n${pics}${was}`;
  }

  /** All pictures in one image (labelled tiles) for an app that can send only one. */
  async function collage(pics) {
    const imgs = await Promise.all(pics.map((p) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = p.url; })));
    const cols = pics.length <= 1 ? 1 : pics.length <= 4 ? 2 : 3;
    const rows = Math.ceil(pics.length / cols);
    const T = Math.round(Math.min(1024, 2048 / cols));
    const cv = document.createElement('canvas');
    cv.width = cols * T; cv.height = rows * T;
    const g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
    imgs.forEach((im, i) => {
      if (!im) return;
      const x = (i % cols) * T, y = Math.floor(i / cols) * T;
      const k = Math.min(T / im.width, T / im.height);
      g.drawImage(im, x + (T - im.width * k) / 2, y + (T - im.height * k) / 2, im.width * k, im.height * k);
      g.fillStyle = 'rgba(0,0,0,.65)'; g.fillRect(x, y, 64, 40);
      g.fillStyle = '#fff'; g.font = 'bold 26px sans-serif'; g.fillText(String(i + 1), x + 12, y + 30);
    });
    return cv.toDataURL('image/jpeg', 0.85);
  }

  const jobs = {}; // caseId → { state: 'running' | 'done' | 'error', message, started }
  actions['lx-assess'] = () => {
    if (I.needKey()) { toast('Add an AI key in Settings → AI first'); D.go('settings'); return; }
    if (!cur.pics.length && !Object.values(cur.pt).some(Boolean)) { toast('Add pictures or some history first'); return; }
    assess(cur);
  };
  async function assess(c) {
    if (jobs[c.id]?.state === 'running') return;
    const job = jobs[c.id] = { state: 'running', started: Date.now() };
    shownIdx = -1;
    paintOut();
    const btn = $('.lx-go'); if (btn) btn.disabled = true;
    tick();
    const prev = latest(c);
    const task = caseText(c, prev) + '\n\n' + SCHEMA_TEXT;
    try {
      const urls = c.pics.map((p) => p.url);
      let text;
      if (!urls.length) text = await D.ai(task, { system: SYSTEM, max: 4000 });
      else {
        const many = urls.length > 1 ? I.aiImages(task, urls, SYSTEM, 4000) : null;
        text = many ? await many : await I.aiImage(urls.length > 1 ? task + '\n(The pictures are tiles in one image, numbered in their corners.)' : task, urls.length > 1 ? await collage(c.pics) : urls[0], SYSTEM);
      }
      const r = D.aiJson(text);
      if (!r || !Array.isArray(r.differentials)) throw new Error('The AI answer came back incomplete. Tap Re-assess to try again.');
      // Read the case again before saving: the history may have been edited meanwhile.
      const fresh = (await DB.get(c.id)) || c;
      fresh.assessments.push({ at: Date.now(), n: urls.length, kinds: [...new Set(c.pics.map((p) => p.kind))], r, secs: Math.round((Date.now() - job.started) / 1000) });
      await DB.put(fresh);
      if (cur?.id === c.id) cur = fresh;
      job.state = 'done';
      I.remember?.('lesionaut', 'Case: ' + (r.differentials[0]?.name || titleOf(fresh)), 'lxcase/' + c.id);
    } catch (e) {
      job.state = 'error';
      job.message = e.message === 'NO_KEY' ? 'Add an AI key in Settings → AI.' : e.message || String(e);
    }
    if (D.current.name === 'lxcase' && D.current.arg === c.id) { render(); window.scrollTo(0, 0); setTimeout(() => $('#lx-out')?.scrollIntoView({ behavior: 'smooth' }), 80); } else if (job.state === 'done') toast('Lesionaut: assessment ready · open the case');
    else toast('Lesionaut: the assessment didn\'t finish');
  }
  function tick() {
    const j = cur && jobs[cur.id];
    const el = $('#lx-wait');
    if (!j || j.state !== 'running' || !el) return;
    const s = Math.round((Date.now() - j.started) / 1000);
    el.textContent = `${s} s`;
    setTimeout(tick, 1000);
  }

  // ---- The answer on screen
  function paintOut() {
    const out = $('#lx-out');
    if (!out || !cur) return;
    const j = jobs[cur.id];
    const evo = $('#lx-evo');
    if (j?.state === 'running') {
      out.innerHTML = `<div class="panel busy-inline lx-busy"><span class="spin"></span><span>Reading ${cur.pics.length} picture${cur.pics.length === 1 ? '' : 's'} with the history… <b id="lx-wait"></b><br><small class="muted">Usually 20–60 seconds. You can leave this screen: it keeps going and the case shows the result.</small></span></div>`;
      if (evo) evo.innerHTML = '';
      return;
    }
    const err = j?.state === 'error' ? `<div class="panel"><b>The assessment didn't finish</b><p class="small">${esc(j.message)}</p></div>` : '';
    const idx = shownIdx >= 0 && shownIdx < cur.assessments.length ? shownIdx : cur.assessments.length - 1;
    const a = cur.assessments[idx];
    out.innerHTML = err + (a ? assessmentHtml(a, idx) : '');
    if (evo) evo.innerHTML = evolutionHtml(idx);
    paintThread();
  }

  function assessmentHtml(a, idx) {
    const r = a.r;
    const dx = list(r.differentials);
    const isLatest = idx === cur.assessments.length - 1;
    const suff = { adequate: '', limited: 'Limited evidence', insufficient: 'Insufficient evidence' }[r.sufficiency] || '';
    const pics = list(r.pictures).filter((p) => p && (p.retake || p.quality === 'poor'));
    const head = dx.slice(0, 4);
    return `<div class="section lx-result"><div class="section-h"><h3>${isLatest ? 'Assessment' : 'Earlier assessment'}</h3><span class="muted small">${fmt(a.at)} · ${a.n} picture${a.n === 1 ? '' : 's'}${a.secs ? ' · ' + a.secs + ' s' : ''}</span></div>
      ${!isLatest ? `<button class="btn xs" data-act="lx-show" data-i="-1">Back to the latest</button>` : ''}
      <div class="panel lx-summary">${r.pattern ? `<span class="tag">${esc(r.pattern)}</span>` : ''}<p>${esc(r.summary || '')}</p>
        ${r.changed ? `<p class="small lx-changed"><b>What changed:</b> ${esc(r.changed)}</p>` : ''}
        ${suff || r.uncertainty ? `<p class="small lx-unc">${suff ? `<b>${suff}.</b> ` : ''}${esc(r.uncertainty || '')}</p>` : ''}</div>
      ${pics.length ? `<div class="panel lx-retake"><b>${icon('camera')} Picture quality</b>${pics.map((p) => `<p class="small"><b>Picture ${esc(p.n)}</b> (${esc(p.quality || '')}): ${esc(p.retake || 'poor quality limits reading it')}</p>`).join('')}</div>` : ''}
      <div class="section-h"><h3>Ranked differential</h3></div>
      ${dx.map((d, i) => `<details class="lx-dx" ${i === 0 ? 'open' : ''}><summary><span class="lx-n">${i + 1}</span><span class="lx-dxn"><b>${esc(d.name)}</b><span class="lx-st ${(STRENGTH[d.strength] || STRENGTH.consider)[1]}">${(STRENGTH[d.strength] || STRENGTH.consider)[0]}</span></span></summary>
        <p class="small">${esc(d.reasoning || '')}</p>
        ${list(d.supporting).length ? `<p class="small lx-for"><b>For:</b> ${list(d.supporting).map(esc).join(' · ')}</p>` : ''}
        ${list(d.against).length ? `<p class="small lx-against"><b>Against:</b> ${list(d.against).map(esc).join(' · ')}</p>` : ''}
        ${list(d.missing).length ? `<p class="small lx-missing"><b>Missing:</b> ${list(d.missing).map(esc).join(' · ')}</p>` : ''}
        ${isLatest ? `<button class="btn xs" data-act="lx-ask" data-q="${esc(`What finding would make ${d.name} unlikely, and how would I look for it in this case?`)}">What would rule it out?</button>` : ''}</details>`).join('')}
      ${list(r.matrix).length && head.length ? `<div class="section-h"><h3>Evidence matrix</h3></div>
        <div class="lx-matrix-wrap"><table class="lx-matrix"><thead><tr><th>Finding</th>${head.map((d, i) => `<th title="${esc(d.name)}">${i + 1}. ${esc(short(d.name))}</th>`).join('')}</tr></thead>
        <tbody>${list(r.matrix).map((m) => `<tr><td>${esc(m.finding)}${m.source ? `<small>${esc(m.source)}</small>` : ''}</td>${head.map((_, i) => { const v = VERDICT[String(list(m.verdicts)[i] || 'neutral').toLowerCase()] || VERDICT.neutral; return `<td class="${v[2]}" title="${v[1]}">${v[0]}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>
        <p class="muted small">✓ supports · ✗ against · ~ nonspecific · – not informative</p>` : ''}
      ${list(r.mustNotMiss).length ? `<div class="panel lx-mnm"><b>${icon('alert')} Must not miss</b>${list(r.mustNotMiss).map((m) => `<p class="small"><b>${esc(m.name)}:</b> ${esc(m.why)}</p>`).join('')}</div>` : ''}
      ${list(r.tests).length ? `<div class="section-h"><h3>Next best investigations</h3></div>${list(r.tests).map((t, i) => `<div class="panel lx-test"><b>${i + 1}. ${esc(t.test)}</b><p class="small">${esc(t.why || '')}</p>
        ${t.ifPositive ? `<p class="small"><b>If positive:</b> ${esc(t.ifPositive)}</p>` : ''}${t.ifNegative ? `<p class="small"><b>If negative:</b> ${esc(t.ifNegative)}</p>` : ''}</div>`).join('')}` : ''}
      ${isLatest && list(r.questions).length ? `<div class="section-h"><h3>Questions that would help</h3></div>
        <div class="panel lx-qs">${list(r.questions).map((q, i) => `<div class="lx-q"><span class="small">${esc(q)}</span><input data-q="${i}" placeholder="Answer (optional)"></div>`).join('')}
        <button class="btn small primary" data-act="lx-answers">${icon('spark')}Add answers and re-assess</button></div>` : ''}
      ${isLatest ? `<div class="row wrap lx-acts"><button class="btn small" data-act="lx-ask" data-q="${esc(`What finding would make the leading diagnosis (${dx[0]?.name || ''}) unlikely? Argue against it as a sceptical consultant and say what to check.`)}">${icon('alert')}Argue against the leading diagnosis</button>
        <button class="btn small" data-act="lx-ask-open">${icon('chat')}Ask about this case</button></div>` : ''}</div>`;
  }
  const short = (n) => String(n).replace(/\(.*?\)/g, '').trim().split(/\s+/).slice(0, 3).join(' ');
  actions['lx-show'] = (b) => { shownIdx = +b.dataset.i; paintOut(); $('#lx-out')?.scrollIntoView({ behavior: 'smooth' }); };
  actions['lx-answers'] = async () => {
    const qs = list(latest(cur)?.r?.questions);
    let n = 0;
    $$('.lx-q input').forEach((el) => { const a = el.value.trim(); if (a) { cur.answers.push({ q: qs[+el.dataset.q], a }); n++; } });
    if (!n) { toast('Type at least one answer'); return; }
    await save();
    assess(cur);
    render();
  };

  function evolutionHtml(idx) {
    if (!cur || cur.assessments.length < 2) return '';
    return `<div class="section"><div class="section-h"><h3>How the diagnosis evolved</h3></div><div class="lx-evo">${cur.assessments.map((a, i) => {
      const dx = list(a.r.differentials).slice(0, 3);
      return `<button class="lx-evo-row ${i === idx ? 'on' : ''}" data-act="lx-show" data-i="${i}"><span class="lx-evo-dot"></span><span><b>${fmt(a.at)}</b> · ${a.n} picture${a.n === 1 ? '' : 's'}${a.kinds?.length ? ' (' + a.kinds.map((k) => KINDS[k]?.[0] || k).join(', ') + ')' : ''}
        <small>${dx.map((d) => `${esc(d.name)} <i>${esc((STRENGTH[d.strength] || STRENGTH.consider)[0].toLowerCase())}</i>`).join(' → ')}</small></span></button>`;
    }).join('')}</div></div>`;
  }

  // ---- Questions about the case (text: quick, from the reading and the history)
  function paintThread() {
    const el = $('#lx-thread');
    if (!el || !cur) return;
    el.innerHTML = cur.thread.length ? `<div class="section"><div class="section-h"><h3>Discussion</h3></div>${cur.thread.map((t) => `<div class="panel lx-turn"><p class="ex-head">${icon('chat')} ${esc(t.q)}</p><div class="qa-a">${t.a == null ? '<span class="spin"></span>' : md(t.a)}</div></div>`).join('')}</div>` : '';
  }
  actions['lx-ask-open'] = () => {
    sheet(`<h3>Ask about this case</h3><form data-form="lx-ask"><textarea name="q" rows="3" placeholder="e.g. Could this be a drug reaction? Which biopsy site is best? Is DIF needed?"></textarea>
      <div class="actions"><button type="button" class="btn" data-act="close-sheet">Cancel</button><button class="btn primary">Ask</button></div></form>`);
    $('[data-form=lx-ask]').addEventListener('submit', (e) => { e.preventDefault(); const q = e.target.q.value.trim(); if (!q) return; closeSheet(true); ask(q); });
  };
  actions['lx-ask'] = (b) => ask(b.dataset.q);
  async function ask(q) {
    const c = cur;
    const a = latest(c);
    const turn = { q, a: null, at: Date.now() };
    c.thread.push(turn);
    paintThread();
    $('#lx-thread')?.lastElementChild?.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const reading = a ? JSON.stringify({ summary: a.r.summary, pattern: a.r.pattern, differentials: a.r.differentials, pictures: a.r.pictures, tests: a.r.tests }) : 'Not assessed yet.';
    const earlier = c.thread.slice(0, -1).slice(-4).map((t) => `Q: ${t.q}\nA: ${String(t.a || '').slice(0, 600)}`).join('\n');
    try {
      turn.a = await D.ai(`${caseText(c, null)}\n\nThe latest AI reading of the pictures and history:\n${reading}${earlier ? '\n\nEarlier discussion:\n' + earlier : ''}\n\nThe clinician asks: ${q}\nAnswer directly and concisely (Markdown, short paragraphs or bullets). Base it on the findings above; say when the pictures or history can't answer it.`, { system: SYSTEM, max: 1800, fast: true });
    } catch (e) {
      turn.a = '_The AI didn\'t answer: ' + (e.message === 'NO_KEY' ? 'add an AI key in Settings → AI' : e.message) + '_';
    }
    const fresh = (await DB.get(c.id)) || c;
    fresh.thread = c.thread;
    await DB.put(fresh);
    if (cur?.id === c.id) { cur.thread = c.thread; paintThread(); }
  }

  function summaryText(c) {
    const a = latest(c);
    const r = a?.r || {};
    return [`Lesionaut case: ${titleOf(c)}`, ptLine(c), c.pt.history, c.pics.length ? `Evidence: ${c.pics.map((p, i) => `${i + 1}. ${KINDS[p.kind]?.[0]}${p.note ? ' (' + p.note + ')' : ''}`).join('; ')}` : '',
      r.summary ? '\nAssessment: ' + r.summary : '', list(r.differentials).length ? 'Differential: ' + list(r.differentials).map((d, i) => `${i + 1}. ${d.name} (${(STRENGTH[d.strength] || STRENGTH.consider)[0].toLowerCase()})`).join('; ') : '',
      list(r.tests).length ? 'Suggested investigations: ' + list(r.tests).map((t) => t.test).join('; ') : '', c.final?.dx ? '\nFinal diagnosis: ' + c.final.dx + (c.final.note ? ' (' + c.final.note + ')' : '') : '',
      '\nAI-assisted decision support, reviewed by the clinician.'].filter(Boolean).join('\n');
  }

  Object.assign(ext.routes, { lxhome: renderHome, lxnew: newCase, lxcase: renderCase });
})();
