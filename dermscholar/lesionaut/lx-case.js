// Lesionaut cases: the home screen, the case list and the case workspace (Evidence · Assessment ·
// Work-up · Notes), the correlation engine, the specialist debate, the rare-disease detective,
// the treatment assistant, notes and letters, visit comparison and the annotation studio.
(() => {
  'use strict';
  const L = window.LX;
  const { $, $$, esc, icon, store, toast, sheet, closeSheet, md, go, render, bar, actions, routes, DB, list, fmt, fmtDay } = L;
  const view = () => $('#view');

  const MAX = 12;
  const KINDS = {
    clinical: ['Clinical', 'Clinical photograph'], dermoscopy: ['Dermoscopy', 'Dermoscopic image'], he: ['H&E', 'Histopathology (H&E or special stain)'],
    dif: ['DIF', 'Direct immunofluorescence'], micro: ['KOH / smear', 'KOH mount, Tzanck, Gram or other microscopy'], lab: ['Lab report', 'Laboratory report: read and interpret the values'], other: ['Other', 'Other image'],
  };
  const STR = { strong: 'Strong consideration', consider: 'Consider', alternative: 'Alternative', unlikely: 'Less likely' };
  const VER = { supports: ['✓', 'v-yes'], against: ['✗', 'v-no'], nonspecific: ['~', 'v-mid'], neutral: ['–', 'v-na'] };
  const PT = [
    ['age', 'Age', 'e.g. 34', 0], ['sex', 'Sex', 'F / M', 0], ['phototype', 'Skin phototype', 'I–VI', 0], ['duration', 'Duration and course', 'e.g. 3 months, progressive', 0],
    ['site', 'Site and distribution', 'e.g. extensor forearms, symmetric', 1], ['symptoms', 'Symptoms', 'itch, pain, burning, systemic symptoms', 1],
    ['history', 'History and examination', 'morphology, mucosa, nails, hair, past and family history', 2], ['meds', 'Medicines', 'current and recent, with start dates', 1],
    ['treated', 'Treatment so far and response', '', 2], ['labs', 'Investigations (typed)', 'e.g. ANA 1:320 speckled, ESR 40, KOH negative', 2],
    ['biopsy', 'Biopsy / histopathology report', 'findings and the reported diagnosis', 2],
  ];
  const TRI = { urgent: 'Urgent: today', soon: 'See soon', routine: 'Routine' };
  const triOf = (r) => { const l = String(r?.triage?.level || r?.triage || '').toLowerCase(); return TRI[l] ? l : ''; };
  const triBadge = (r) => { const l = triOf(r); return l ? `<span class="tri ${l}">${TRI[l]}</span>` : ''; };
  const titleOf = (c) => c.title || c.final?.dx || (c.assessments.length ? list(last(c)?.r?.differentials)[0]?.name || 'Assessed case' : 'New case');
  const last = (c) => c.assessments[c.assessments.length - 1];
  const ptLine = (c) => [c.patient, c.pt.age && c.pt.age + ' y', c.pt.sex, c.pt.site].filter(Boolean).join(' · ');
  const keyErr = L.keyErr;
  /** The pictures as sent to the AI: clinical photos with eyes (or faces) hidden, per Settings. */
  const aiUrls = (pics) => Promise.all(pics.map((p) => (p.kind === 'clinical' ? L.hideFaces(p.url) : p.url)));

  // ================================================================ Home
  routes.home = async () => {
    const h = new Date().getHours();
    const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    view().innerHTML = `<div class="brandrow">${L.MARK}<span><b>Lesionaut</b><small>${greet}</small></span><button class="ib" data-act="go" data-to="settings" aria-label="Settings">${icon('settings')}</button></div>
      <section class="hero"><div class="eyebrow">Dermatology diagnostic copilot</div>
        <h2>Correlate every clue</h2><p>Clinical, dermoscopy, histology, immunofluorescence and labs, read together into a ranked, explained differential.</p>
        <div class="row"><button class="btn gold" data-act="new-case">${icon('plus')}New case</button><button class="btn light" data-act="new-case" data-cam="1">${icon('camera')}Photograph</button></div></section>
      ${L.hasKey() ? '' : `<div class="note warn" style="margin-top:14px"><b>Add an AI key to start.</b> Settings → AI. Gemini (free) reads pictures best; you can also bring your keys from your DermScholar account.</div>`}
      <div class="tiles">
        <button class="tile" data-act="go" data-to="teach"><span class="ti">${icon('graduation')}</span><b>Teach me this slide</b><span>Structured teaching from one H&E or dermoscopy image</span></button>
        <button class="tile g" data-act="go" data-to="detective"><span class="ti">${icon('detective')}</span><b>Rare case detective</b><span>When nothing fits: uncommon diagnoses and case reports</span></button>
        <button class="tile g" data-act="go" data-to="explore"><span class="ti">${icon('layers')}</span><b>Pattern library</b><span>Reaction patterns and their differentials</span></button>
        <button class="tile" data-act="go" data-to="tools"><span class="ti">${icon('tools')}</span><b>Scores & calculators</b><span>PASI, EASI, SCORAD, SALT, UAS7, DLQI…</span></button>
      </div>
      <div class="sec"><div class="sec-h"><h3>Recent cases</h3><button data-act="go" data-to="cases">All cases</button></div><div class="card list" id="recent"><div class="busy"><span class="spin"></span>Loading…</div></div></div>
      <p class="disc">Decision support for clinicians. It can be wrong; the diagnosis is yours. Cases and pictures stay on this device.</p>`;
    const cs = (await DB.all().catch(() => [])).slice(0, 4);
    $('#recent').innerHTML = cs.length ? cs.map(row).join('') : `<div class="empty">${icon('cases')}<b>No cases yet</b>Tap New case, add history and pictures, then Assess.</div>`;
  };
  const row = (c) => {
    const a = last(c), top = list(a?.r?.differentials)[0];
    const kinds = [...new Set(c.pics.map((p) => KINDS[p.kind]?.[0]))].join(', ');
    return `<button class="li" data-act="go" data-to="case/${esc(c.id)}">${c.pics[0] ? `<img src="${c.pics[0].url}" alt="">` : `<span class="ph">${icon('image')}</span>`}
      <span><b>${esc(titleOf(c))}</b><small>${esc([ptLine(c), kinds].filter(Boolean).join(' · ') || 'No evidence yet')}</small>
      <small>${!c.final?.dx && triOf(a?.r) && triOf(a?.r) !== 'routine' ? triBadge(a.r) + ' ' : ''}${c.final?.dx ? '✓ Final: ' + esc(c.final.dx) : top ? 'Leading: ' + esc(top.name) : 'Not assessed'} · ${fmtDay(c.updated)}</small></span></button>`;
  };

  // ================================================================ Case list
  routes.cases = async (_, params) => {
    const q = (params.q || '').toLowerCase();
    view().innerHTML = `${bar('Cases', { back: false, right: `<button class="ib" data-act="new-case" aria-label="New case">${icon('plus')}</button>` })}
      <form class="search" data-form="cq">${icon('search')}<input name="q" value="${esc(params.q || '')}" placeholder="Search diagnosis, patient, site" enterkeyhint="search"></form>
      <div class="sec"><div class="card list" id="clist"><div class="busy"><span class="spin"></span>Loading…</div></div></div>`;
    $('[data-form=cq]').addEventListener('submit', (e) => { e.preventDefault(); go('cases?q=' + encodeURIComponent(e.target.q.value.trim()), { replace: true }); });
    let cs = await DB.all().catch(() => []);
    const blank = (c) => !c.pics.length && !c.assessments.length && !c.title && !c.patient && !Object.values(c.pt).some(Boolean) && Date.now() - c.created > 60000;
    cs.filter(blank).forEach((c) => DB.del(c.id).catch(() => {}));
    cs = cs.filter((c) => !blank(c));
    if (q) cs = cs.filter((c) => JSON.stringify([titleOf(c), c.patient, c.pt, c.final, list(last(c)?.r?.differentials).map((d) => d.name)]).toLowerCase().includes(q));
    // Visits of the same patient sit together.
    const groups = new Map();
    for (const c of cs) { const k = c.patient ? 'p:' + c.patient.toLowerCase() : 'c:' + c.id; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); }
    $('#clist').innerHTML = cs.length ? [...groups.values()].map((g) => (g.length > 1 ? `<div class="tiny muted" style="padding:8px 2px 0">${esc(g[0].patient)} · ${g.length} visits</div>` : '') + g.map(row).join('')).join('')
      : `<div class="empty">${icon('cases')}<b>${q ? 'No matching cases' : 'No cases yet'}</b></div>`;
  };
  actions['new-case'] = async (b) => {
    const c = L.norm({ id: 'c' + Date.now().toString(36), created: Date.now(), updated: Date.now() });
    await DB.put(c);
    go('case/' + c.id);
    if (b?.dataset.cam) setTimeout(() => addPics('clinical', true), 400);
  };

  // ================================================================ Case workspace
  let c = null;          // the case on screen
  let tab = 'evidence';
  let addKind = 'clinical';
  let shown = -1;        // which assessment is on screen (-1 = latest)
  let saveT = 0;
  const save = () => (c ? DB.put(c).catch(() => toast('Couldn\'t save (storage full?)')) : null);
  const saveSoon = () => { clearTimeout(saveT); saveT = setTimeout(save, 500); };
  const fresh = async (id) => (await DB.get(id)) || c;

  routes.case = async (arg) => {
    const [id, sub, i] = arg.split('/');
    const got = await DB.get(id).catch(() => null);
    if (!got) { view().innerHTML = `${bar('Case')}<div class="empty">${icon('alert')}<b>Case not found</b></div>`; return; }
    if (!c || c.id !== got.id) { shown = -1; tab = got.assessments.length ? 'assessment' : 'evidence'; }
    c = got;
    if (sub === 'annotate') { studio(+i); return; }
    paint();
  };
  function paint() {
    const running = Object.entries(L.jobs).filter(([k, j]) => j.state === 'running' && j.caseId === c.id).map(([k]) => k.split(':')[0]);
    view().innerHTML = `${bar('Case', { right: `<button class="ib" data-act="case-menu" aria-label="More">${icon('dots')}</button>` })}
      <div class="casehead">${c.pics[0] ? `<img class="ph" src="${c.pics[0].url}" alt="">` : `<span class="ph">${icon('image')}</span>`}
        <div style="flex:1;min-width:0"><input id="c-title" value="${esc(c.title)}" placeholder="${esc(titleOf(c))}" aria-label="Case title">
        <small>${esc([c.patient && '👤 ' + c.patient, c.visitOf ? 'Follow-up visit' : '', 'Started ' + fmtDay(c.created)].filter(Boolean).join(' · '))}</small></div></div>
      <div class="seg">${[['evidence', 'Evidence'], ['assessment', 'Assessment'], ['workup', 'Work-up'], ['notes', 'Notes']].map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-act="ctab" data-t="${k}">${l}${running.some((r) => (k === 'assessment' && /assess|debate/.test(r)) || (k === 'workup' && /rare|treat|compare|drug/.test(r)) || (k === 'notes' && /doc/.test(r))) ? ' •' : ''}</button>`).join('')}</div>
      <div id="ctab"></div>`;
    $('#c-title').addEventListener('input', (e) => { c.title = e.target.value.trim(); saveSoon(); });
    ({ evidence: tabEvidence, assessment: tabAssessment, workup: tabWorkup, notes: tabNotes })[tab]();
  }
  actions.ctab = (b) => { tab = b.dataset.t; paint(); };
  const box = () => $('#ctab');
  const isRunning = (k) => L.jobs[k + ':' + c.id]?.state === 'running';
  const jobError = (k) => { const j = L.jobs[k + ':' + c.id]; return j?.state === 'error' ? `<div class="note bad" style="margin-bottom:10px"><b>Didn't finish:</b> ${esc(j.message)}</div>` : ''; };
  const busy = (msg) => `<div class="card busy"><span class="spin"></span><span>${msg}<br><small class="muted">${L.canKeepAlive() ? 'You can leave the app: a notification keeps it going, and the answer will be here.' : 'Keep Lesionaut open until it finishes: the browser pauses pages in the background.'}</small></span></div>`;

  // ---- Evidence
  function tabEvidence() {
    box().innerHTML = `<div class="card scan"><b>${icon('doc')} Reports and case papers</b>
        <p class="small muted" style="margin:4px 0 10px">Photograph or upload lab or biopsy reports, prescriptions, referral notes or old case papers (photos or PDFs). The AI reads them and fills in the case; you check it.</p>
        <div class="row"><button class="btn sm pri" data-act="scan-cam" ${isRunning('scan') ? 'disabled' : ''}>${icon('camera')}Photograph</button><button class="btn sm" data-act="scan-pick" ${isRunning('scan') ? 'disabled' : ''}>${icon('doc')}Photos or PDFs</button></div>
        ${isRunning('scan') ? '<div style="margin-top:10px">' + busy('Reading the documents…') + '</div>' : ''}${jobError('scan')}
        ${c.scan?.r && !isRunning('scan') ? `<p class="small" style="margin:10px 0 0">${list(c.scan.r.docs).map((d) => `<b>${esc(d.type || 'Document')}</b>${d.summary ? ': ' + esc(d.summary) : ''}`).join(' · ') || 'Documents read.'} <button class="btn sm ghost" data-act="scan-review">Check what was read</button></p>` : ''}
        ${c.papers.length ? `<div class="papers">${c.papers.map((p, i) => `<img src="${p.url}" alt="" data-act="paper-zoom" data-i="${i}">`).join('')}</div>` : ''}</div>
      <details class="card fold" style="margin-top:10px"><summary><span><b>Typed details (optional)</b><br><small class="muted">${esc(ptLine(c) || 'Patient label, history, medicines, labs: edit or add by hand')}</small></span><span class="chev">${icon('chev')}</span></summary>
        <div class="grid2" style="margin-top:12px"><label class="f wide">Patient label (initials or ID, to link visits)<input data-k="patient" value="${esc(c.patient)}" placeholder="e.g. RK-0412"></label>
        ${PT.map(([k, l, ph, w]) => `<label class="f ${w ? 'wide' : ''}">${l}${w === 2 ? `<textarea data-pt="${k}" rows="2" placeholder="${esc(ph)}">${esc(c.pt[k] || '')}</textarea>` : `<input data-pt="${k}" value="${esc(c.pt[k] || '')}" placeholder="${esc(ph)}">`}</label>`).join('')}</div></details>
      <div class="sec"><div class="sec-h"><h3>Evidence · ${c.pics.length}/${MAX}</h3></div>
        <div class="chips">${Object.entries(KINDS).map(([k, [l]]) => `<button class="chip ${k === addKind ? 'on' : ''}" data-act="kind" data-k="${k}">${esc(l)}</button>`).join('')}</div>
        <div class="guide" id="guide"></div><div class="pics" id="pics"></div></div>
      ${c.answers.length ? `<div class="card"><h4>Your answers</h4>${c.answers.map((x, i) => `<p class="small"><b>${esc(x.q)}</b> ${esc(x.a)} <button class="btn sm ghost" data-act="ans-del" data-i="${i}">Remove</button></p>`).join('')}</div>` : ''}
      <button class="btn pri full" style="margin-top:16px" data-act="assess" ${isRunning('assess') ? 'disabled' : ''}>${icon('spark')}${isRunning('assess') ? 'Assessing…' : c.assessments.length ? 'Re-assess with all the evidence' : 'Assess case'}</button>
      <p class="disc">Leave out names and faces: the pictures and history go to the AI you chose when you assess.</p>`;
    $$('[data-pt]').forEach((el) => el.addEventListener('input', () => { c.pt[el.dataset.pt] = el.value.trim(); saveSoon(); }));
    $('[data-k=patient]').addEventListener('input', (e) => { c.patient = e.target.value.trim(); saveSoon(); });
    paintPics();
  }
  /** The next shot worth taking, from what the case already has. */
  function guideText() {
    const cl = c.pics.filter((p) => p.kind === 'clinical').length, ds = c.pics.some((p) => p.kind === 'dermoscopy');
    const tip = 'Daylight, no flash, plain background; a ruler or coin shows size.';
    if (!cl) return 'Start with an <b>overview</b> of the whole area, so the distribution shows. ' + tip;
    if (cl === 1) return 'Now a <b>close-up</b> of one typical lesion, a hand-span away and in focus. Then its <b>edge</b>.';
    if (!ds) return 'Add <b>dermoscopy</b> if you have it, and other affected sites (nails, mouth, scalp).';
    return 'Good set. Add histology, DIF or reports when you have them.';
  }
  function paintPics() {
    const el = $('#pics'); if (!el) return;
    const g = $('#guide'); if (g) g.innerHTML = icon('camera') + '<span>' + guideText() + '</span>';
    el.innerHTML = c.pics.map((p, i) => `<div class="pic"><img src="${p.url}" alt="" data-act="zoom" data-i="${i}">${p.q ? `<span class="qbad">${esc(p.q)}</span>` : ''}<span class="lab"><b>${i + 1}</b> ${esc(KINDS[p.kind]?.[0] || p.kind)}${p.note ? ' · ' + esc(p.note) : ''}</span>
        <button class="pm" data-act="pic-menu" data-i="${i}" aria-label="Picture options">${icon('dots')}</button></div>`).join('')
      + (c.pics.length < MAX ? `<button class="addpic" data-act="add-gallery">${icon('image')}Add ${esc(KINDS[addKind][0])}<small class="muted">from gallery</small></button>
        <button class="addpic" data-act="add-camera">${icon('camera')}Take photo<small class="muted">${esc(KINDS[addKind][0])}</small></button>` : '');
  }
  actions.kind = (b) => { addKind = b.dataset.k; $$('[data-act=kind]').forEach((x) => x.classList.toggle('on', x === b)); paintPics(); };
  actions['add-gallery'] = () => addPics(addKind, false);
  actions['add-camera'] = () => addPics(addKind, true);
  async function addPics(kind, cam) {
    const room = MAX - c.pics.length;
    if (room <= 0) { toast(`${MAX} pictures at most`); return; }
    let urls;
    try { urls = cam ? await L.camera() : await L.pickImages(room); } catch (e) { if (!/cancel/i.test(e.message || '')) toast(e.message); return; }
    const k = c;
    const added = [];
    for (const u of urls.slice(0, room)) {
      const p = { url: await L.shrink(u, 1024), kind, note: '', at: Date.now() };
      // Only photos are checked (slides and reports look different).
      if (kind === 'clinical' || kind === 'dermoscopy') { const q = await photoCheck(u); if (q) { p.q = q.label; p.qTip = q.tip; } }
      k.pics.push(p); added.push(p);
    }
    if (urls.length > room) toast(`${MAX} pictures at most: the first ${room} were added`);
    await DB.put(k);
    if (c === k && tab === 'evidence') paint();
    const bad = added.find((p) => p.q);
    if (bad && c === k) {
      const i = k.pics.indexOf(bad);
      sheet(`<h3>${icon('camera')} Picture ${i + 1} looks ${esc(bad.q)}</h3><p class="small">${esc(bad.qTip)}</p>
        <div class="acts"><button class="btn" data-act="q-keep" data-i="${i}">Keep it</button><button class="btn pri" data-act="q-retake" data-i="${i}">${icon('camera')}Retake</button></div>`);
    }
  }
  actions['q-keep'] = async (b) => { const p = c.pics[+b.dataset.i]; if (p) { delete p.q; delete p.qTip; } closeSheet(); await save(); paint(); };
  actions['q-retake'] = async (b) => {
    const i = +b.dataset.i, old = c.pics[i]; closeSheet();
    let urls; try { urls = await L.camera(); } catch (e) { if (!/cancel/i.test(e.message || '')) toast(e.message); return; }
    const p = { ...old, url: await L.shrink(urls[0], 1024), at: Date.now() }; delete p.q; delete p.qTip;
    const q = await photoCheck(urls[0]); if (q) { p.q = q.label; p.qTip = q.tip; }
    c.pics[i] = p; await save(); paint();
    if (q) toast(`Still looks ${q.label}: keep it or try once more`);
  };
  /** Sharpness, light and glare, measured on a small copy of the photo; null when it looks fine. */
  function photoCheck(url) {
    return new Promise((res) => {
      const img = new Image();
      img.onload = () => {
        try {
          if (Math.max(img.width, img.height) < 480) { res({ label: 'too small', tip: 'It has very few pixels. Use the camera directly, or a larger copy.' }); return; }
          const W = 320, k = W / Math.max(img.width, img.height), w = Math.round(img.width * k), h = Math.round(img.height * k);
          const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
          const g = cv.getContext('2d'); g.drawImage(img, 0, 0, w, h);
          const d = g.getImageData(0, 0, w, h).data, Y = new Float32Array(w * h);
          let sum = 0, hot = 0, dark = 0;
          for (let i = 0; i < w * h; i++) { const y = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; Y[i] = y; sum += y; if (y > 250) hot++; if (y < 18) dark++; }
          const mean = sum / (w * h);
          // Variance of the Laplacian over the middle of the picture: low = blurred.
          let n = 0, m1 = 0, m2 = 0;
          for (let y = Math.round(h * 0.15); y < h * 0.85; y++) for (let x = Math.round(w * 0.15); x < w * 0.85; x++) {
            const i = y * w + x, v = 4 * Y[i] - Y[i - 1] - Y[i + 1] - Y[i - w] - Y[i + w];
            n++; m1 += v; m2 += v * v;
          }
          const lap = n ? m2 / n - (m1 / n) ** 2 : 999;
          if (mean < 45 || dark / (w * h) > 0.5) res({ label: 'too dark', tip: 'Move to daylight or turn on more light (no flash, it causes glare).' });
          else if (hot / (w * h) > 0.08) res({ label: 'shiny', tip: 'There is glare. Tilt the phone slightly, turn off the flash, or use cross-polarised dermoscopy.' });
          else if (lap < 18) res({ label: 'blurred', tip: 'Hold steady, tap the lesion to focus, and keep a hand-span away.' });
          else res(null);
        } catch { res(null); }
      };
      img.onerror = () => res(null);
      img.src = url;
    });
  }
  actions.zoom = (b) => L.lightbox(c.pics.map((p, i) => ({ src: p.url, label: `${i + 1}. ${KINDS[p.kind]?.[0] || ''}`, caption: p.note })), +b.dataset.i);
  actions['pic-menu'] = (b) => {
    const i = +b.dataset.i, p = c.pics[i];
    sheet(`<h3>Picture ${i + 1}</h3><label class="f">Type</label><div class="chips" style="flex-wrap:wrap">${Object.entries(KINDS).map(([k, [l]]) => `<button class="chip ${k === p.kind ? 'on' : ''}" data-act="pic-kind" data-k="${k}" data-i="${i}">${esc(l)}</button>`).join('')}</div>
      <label class="f" style="margin-top:10px">Note (site, stain, magnification, what to look at)<input id="pic-note" value="${esc(p.note || '')}" placeholder="e.g. edge of plaque, ×400, PAS"></label>
      <div class="row wrap" style="margin-top:14px"><button class="btn sm" data-act="go" data-to="case/${c.id}/annotate/${i}">${icon('pen')}Annotate</button>
      <button class="btn sm danger" data-act="pic-del" data-i="${i}">${icon('trash')}Remove</button><span style="flex:1"></span><button class="btn sm pri" data-act="pic-save" data-i="${i}">Save</button></div>`);
  };
  actions['pic-kind'] = (b) => { c.pics[+b.dataset.i].kind = b.dataset.k; $$('[data-act=pic-kind]').forEach((x) => x.classList.toggle('on', x === b)); };
  actions['pic-save'] = async (b) => { c.pics[+b.dataset.i].note = $('#pic-note').value.trim(); closeSheet(); await save(); paint(); };
  actions['pic-del'] = async (b) => { c.pics.splice(+b.dataset.i, 1); closeSheet(); await save(); paint(); };
  actions['ans-del'] = async (b) => { c.answers.splice(+b.dataset.i, 1); await save(); paint(); };

  // ---- Documents → case: reports, prescriptions and case papers read by the AI (L3)
  const SCAN_TASK = `These are photos or scans of medical documents for ONE dermatology patient: lab reports, biopsy or histopathology reports, prescriptions, referral notes or old case papers (some may be handwritten). Read them carefully and extract what they say.
Reply with JSON only, exactly this shape:
{"docs":[{"n":1,"type":"lab report | biopsy report | prescription | referral note | case paper | other","date":"","summary":"one short line"}],
"fields":{"age":"","sex":"","phototype":"","duration":"duration and course","site":"site and distribution","symptoms":"","history":"history and examination findings","meds":"current and recent medicines with doses and dates","treated":"treatment so far and the response","labs":"laboratory values with units and dates, abnormal ones first","biopsy":"histopathology / DIF findings and the reported diagnosis"},
"unclear":["anything that couldn't be read"]}
Leave a field "" when the documents don't say it; never guess. Leave out names, phone numbers and addresses.`;
  const SCAN_FIELDS = PT.filter(([k]) => k !== 'patient');
  actions['scan-cam'] = () => scanFrom(true);
  actions['scan-pick'] = () => scanFrom(false);
  actions['paper-zoom'] = (b) => L.lightbox(c.papers.map((p, i) => ({ src: p.url, label: 'Document page ' + (i + 1) })), +b.dataset.i);
  async function scanFrom(cam) {
    let raw;
    try { raw = cam ? await L.camera() : await L.pickFiles(12); } catch (e) { if (!/cancel/i.test(e.message || '')) toast(e.message); return; }
    const k = c;
    const urls = [];
    for (const u of raw.slice(0, 12)) urls.push(await L.shrink(u, 1600, 0.85));
    k.papers.push(...urls.map((url) => ({ url, at: Date.now() })));
    await DB.put(k);
    L.runJob('scan:' + k.id, 'Reading the documents', k.id, async () => {
      const r = L.json(await L.aiPics(SCAN_TASK, urls, { system: 'You read medical documents accurately for a dermatologist. You copy values exactly as written and never invent anything.', max: 6000 }));
      const f = await fresh(k.id);
      // Several reads (e.g. one photo at a time) add up.
      const was = f.scan?.r && !f.scan.applied ? f.scan.r : null;
      if (was) {
        r.docs = [...list(was.docs), ...list(r.docs)];
        r.unclear = [...list(was.unclear), ...list(r.unclear)];
        for (const [key] of SCAN_FIELDS) { const a = String(was.fields?.[key] || ''), b = String(r.fields?.[key] || ''); r.fields = r.fields || {}; r.fields[key] = a && b && a !== b ? a + '\n' + b : a || b; }
      }
      f.scan = { at: Date.now(), r, applied: false };
      await DB.put(f);
      if (c?.id === f.id) c = f;
    }).then(() => { if (c?.id === k.id && L.cur.name === 'case') scanReview(); }).catch(() => {});
    paint();
  }
  actions['scan-review'] = () => scanReview();
  function scanReview() {
    const r = c.scan?.r; if (!r) return;
    const found = SCAN_FIELDS.filter(([k]) => String(r.fields?.[k] || '').trim());
    const merged = (k) => { const now = (c.pt[k] || '').trim(), got = String(r.fields[k]).trim(); return !now || now === got ? got : now.includes(got) ? now : now + '\n' + got; };
    sheet(`<h3>What the documents say</h3>
      ${list(r.docs).length ? `<p class="small muted" style="margin-top:0">${list(r.docs).map((d) => `${esc(d.type || 'Document')}${d.date ? ' (' + esc(d.date) + ')' : ''}`).join(' · ')}</p>` : ''}
      ${found.length ? `<div class="ext">${found.map(([k, l]) => `<label class="f"><span><input type="checkbox" data-use="${k}" checked> ${esc(l)}${c.pt[k] && c.pt[k] !== r.fields[k] ? ' <small>(added to what you had)</small>' : ''}</span><textarea data-ext="${k}" rows="${String(r.fields[k]).length > 60 ? 3 : 1}">${esc(merged(k))}</textarea></label>`).join('')}</div>`
        : '<div class="note">Nothing usable was found in these pages. Try a sharper, closer photo of each page.</div>'}
      ${list(r.unclear).length ? `<p class="small muted"><b>Couldn't read:</b> ${list(r.unclear).map(esc).join(' · ')}</p>` : ''}
      <div class="acts"><button class="btn" data-act="close-sheet">Later</button>${found.length ? `<button class="btn" data-act="scan-apply">Fill the case</button><button class="btn pri" data-act="scan-apply" data-go="1">${icon('spark')}Fill and assess</button>` : ''}</div>`);
  }
  actions['scan-apply'] = async (b) => {
    $$('[data-ext]').forEach((el) => { if ($(`[data-use="${el.dataset.ext}"]`)?.checked) c.pt[el.dataset.ext] = el.value.trim(); });
    c.scan.applied = true;
    closeSheet(); await save();
    if (b.dataset.go) actions.assess(); else { toast('Case filled from the documents'); paint(); }
  };

  // ---- The correlation engine
  const SYSTEM = `You are Lesionaut, a diagnostic copilot for dermatologists. You think like an experienced clinical dermatologist, dermoscopist, dermatopathologist and immunodermatologist working together, and you correlate every piece of evidence (history, clinical photographs, dermoscopy, histopathology, immunofluorescence, microscopy, laboratory results) instead of reading each in isolation.
Rules: describe what is actually visible before interpreting; never invent findings. Say where sources agree and point out contradictions. Rank diagnoses by how well each explains ALL the evidence, with supporting findings, findings against and missing characteristic features. Include dangerous conditions that must not be missed. Lesionaut is picture-first: read the photographs as an expert would and commit to the most likely diagnosis from the image alone. Missing history, laboratory results or histology is normal and is never a reason to withhold, hedge or downgrade a diagnosis, nor a "limitation"; what would refine it goes in one short optional line. Call the evidence insufficient only when the picture itself can't be read (blurred, too far, glare, too dark), and then give one short line of retake advice. Never give numeric probabilities. Consider skin of colour. For histology name the reaction pattern first. Interpret laboratory values in dermatological context. In India also consider leprosy, tuberculosis, deep fungal infections and drug reactions where relevant. Be concise and clinical: this is decision support for a clinician.`;
  const SCHEMA = `Reply with JSON only (no Markdown), exactly this shape:
{"summary":"2-4 sentences: what the pictures show and the most likely diagnosis, stated plainly","changed":"what changed compared with the previous assessment ('' if none)","sufficiency":"readable | unreadable (unreadable ONLY if the pictures themselves can't be read)","refine":"one short optional line: the history or test that would refine it ('' if nothing needed)","pattern":"the clinical, dermoscopic and/or histological pattern in a few words",
"triage":{"level":"routine | soon | urgent","why":"one short line"},
"pictures":[{"n":1,"quality":"good | adequate | poor","observations":["what is visible"],"retake":"only if this picture can't be read: one short line such as 'closer, in focus, daylight'; otherwise ''"}],
"differentials":[{"name":"diagnosis","strength":"strong | consider | alternative | unlikely","reasoning":"one or two sentences","supporting":["finding (source)"],"against":["finding (source)"],"missing":["expected feature not seen"]}],
"matrix":[{"finding":"key finding","source":"clinical | dermoscopy | histology | DIF | lab | history","verdicts":["supports | against | nonspecific | neutral, one per differential, same order"]}],
"mustNotMiss":[{"name":"condition","why":"why it needs excluding"}],
"tests":[{"test":"investigation","why":"what it distinguishes","ifPositive":"meaning","ifNegative":"meaning","limits":"false negatives or caveats"}],
"questions":["short questions or examination findings that would change the differential"]}
Give 3-6 differentials (most likely first; the first is your committed diagnosis), 5-8 matrix rows with the most discriminating findings, at most 5 tests (most useful first) and at most 5 questions. Triage: "urgent" = needs care today (e.g. SJS/TEN, DRESS, erythroderma, eczema herpeticum, necrotising soft-tissue infection, purpura fulminans or meningococcaemia, extensive pemphigus, angioedema with airway signs, suspected rapidly growing or ulcerated melanoma); "soon" = within 1-2 weeks (suspected skin cancer, active vasculitis, new blistering disease, severe flare); otherwise "routine". Never list absent history, labs or histology under "against" or "missing". Keep every string short so the JSON stays complete.`;
  function caseText(k, prev) {
    const pt = PT.map(([key, l]) => (k.pt[key] ? `${l}: ${k.pt[key]}` : '')).filter(Boolean).join('\n') || 'No history given.';
    const pics = k.pics.map((p, i) => `Picture ${i + 1}: ${KINDS[p.kind]?.[1] || p.kind}${p.note ? ' — ' + p.note : ''}`).join('\n') || 'No pictures.';
    const docs = k.scan?.r && k.scan.applied && list(k.scan.r.docs).length ? '\nDocuments read into this case: ' + list(k.scan.r.docs).map((d) => `${d.type || 'document'}${d.summary ? ' — ' + d.summary : ''}`).join('; ') : '';
    const drug = k.drug && list(k.drug.drugs).length ? `\nDrug-reaction check: ${list(k.drug.drugs).slice(0, 4).map((x) => `${x.name} — ${x.verdict}${x.latency ? ', latency ' + x.latency : ''}`).join('; ')}` : '';
    const ans = k.answers.length ? '\nAnswers to earlier questions:\n' + k.answers.map((x) => `- ${x.q} → ${x.a}`).join('\n') : '';
    const was = prev ? `\nPrevious assessment (${fmt(prev.at)}): ${list(prev.r.differentials).map((d) => `${d.name} (${d.strength})`).join('; ')}. ${prev.r.summary || ''}` : '';
    return `CASE\n${pt}${k.pt.onset ? '\nRash onset: ' + k.pt.onset : ''}${docs}${drug}${ans}\n\nPICTURES (in the order attached)\n${pics}${was}`;
  }
  const reading = (k) => { const a = last(k); return a ? JSON.stringify({ summary: a.r.summary, pattern: a.r.pattern, differentials: list(a.r.differentials).map((d) => ({ name: d.name, strength: d.strength, supporting: d.supporting, against: d.against })), tests: list(a.r.tests).map((t) => t.test) }) : 'Not assessed yet.'; };

  actions.assess = () => {
    if (!L.hasKey()) { toast('Add an AI key in Settings first'); go('settings'); return; }
    if (!c.pics.length && !Object.values(c.pt).some(Boolean)) { toast('Add pictures or some history first'); return; }
    const k = c;
    tab = 'assessment'; shown = -1;
    L.runJob('assess:' + k.id, 'Assessing the case', k.id, (j) => assessRun(k, j)).catch(() => {});
    paint();
  };
  // Pending assessments by case, so an answer that arrives after Android rebuilt the screen is still used.
  const PEND = 'pendingAssess';
  const setPending = (id, v) => { const all = store.get(PEND, {}); if (v) all[id] = v; else delete all[id]; store.set(PEND, all); };
  const visible = () => new Promise((res) => { if (!document.hidden) { res(); return; } const f = () => { if (!document.hidden) { document.removeEventListener('visibilitychange', f); res(); } }; document.addEventListener('visibilitychange', f); });
  const QUICK = `Give a FAST first look only. Reply with JSON only: {"leading":"the most likely diagnosis","summary":"one sentence: the key visible findings","triage":"routine | soon | urgent","alt":["2-3 alternatives"]}`;
  async function assessRun(k, j) {
    const t0 = Date.now(), urls = await aiUrls(k.pics), task = caseText(k, last(k)) + '\n\n' + SCHEMA;
    // A short answer in seconds, shown until the full reading arrives.
    if (store.get('quickLook', true)) Promise.all(urls.slice(0, 2).map((u) => L.shrink(u, 512, 0.75))).then((small) => L.aiPics(caseText(k, null) + '\n\n' + QUICK, small, { system: SYSTEM, max: 900 })).then(L.json).then((q) => {
      if (j.state !== 'running' || !q?.leading) return;
      j.quick = q;
      if (c?.id === k.id && tab === 'assessment' && L.cur.name === 'case') paint();
    }).catch(() => {});
    const meta = { at: t0, n: k.pics.length, kinds: [...new Set(k.pics.map((p) => p.kind))] };
    const ask = async (extra = '') => {
      const reqId = 'keep_as_' + k.id + '_' + Date.now();
      setPending(k.id, { ...meta, reqId });
      return L.aiPics(task + extra, urls, { system: SYSTEM, max: 8000, reqId });
    };
    try {
      let text;
      try { text = await ask(); } catch (e) {
        // Cut off while the app was in the background: once more, now that it is open again.
        if (!j.hidden || e.message === 'NO_KEY') throw e;
        await visible(); j.hidden = false; text = await ask();
      }
      let r;
      try { r = L.json(text); } catch { r = null; }
      if (!Array.isArray(r?.differentials)) r = L.json(await ask('\n\nYour previous answer was not complete, valid JSON. Reply again with compact, valid JSON only, keeping every list and string short.'));
      if (!Array.isArray(r?.differentials)) throw new Error('The AI answer came back incomplete. Try again.');
      await keepAssessment(k.id, r, meta, Math.round((Date.now() - t0) / 1000));
    } finally { setPending(k.id, null); }
  }
  async function keepAssessment(id, r, meta, secs) {
    const f = await fresh(id);
    if (!f) return;
    f.assessments.push({ at: Date.now(), n: meta.n, kinds: meta.kinds, r, secs });
    await DB.put(f);
    if (c?.id === f.id) c = f;
  }
  // After a rebuilt screen: collect answers the phone kept, or wait a little for one still coming.
  const waitingKept = {};
  function finishKept(id, p, e) {
    delete waitingKept[p.reqId];
    setPending(id, null);
    const j = L.jobs['assess:' + id] || (L.jobs['assess:' + id] = { label: 'Assessing the case', caseId: id });
    let r = null;
    if (e?.state === 'done') { try { r = L.json(e.text); } catch { r = null; } }
    const ok = Array.isArray(r?.differentials);
    (ok ? keepAssessment(id, r, p, Math.round((Date.now() - p.at) / 1000)) : Promise.resolve()).then(() => {
      j.state = ok ? 'done' : 'error';
      if (!ok) j.message = e?.message || (e ? 'The AI answer came back in a broken format. Tap Assess again.' : 'Stopped when the app was closed. Tap Assess again.');
      if (L.cur.name === 'case' && L.cur.arg.split('/')[0] === id) { j.seen = true; render(); } else if (ok) toast('Assessment ready');
      L.jobBar();
    });
  }
  function recoverAssess() {
    for (const [id, p] of Object.entries(store.get(PEND, {}))) {
      if (L.jobs['assess:' + id]?.state === 'running' || waitingKept[p.reqId]) continue;
      let got = '';
      try { got = L.N.aiTake?.(p.reqId) || ''; } catch { /* old app */ }
      if (got) { try { finishKept(id, p, JSON.parse(got)); } catch { finishKept(id, p, null); } continue; }
      if (L.N.aiTake && Date.now() - p.at < 5 * 60000) {
        waitingKept[p.reqId] = { id, p };
        L.jobs['assess:' + id] = { label: 'Assessing the case', state: 'running', caseId: id, started: p.at };
        const poll = setInterval(() => {
          if (!waitingKept[p.reqId]) { clearInterval(poll); return; }
          let g = ''; try { g = L.N.aiTake(p.reqId) || ''; } catch { /* below */ }
          if (g) { clearInterval(poll); try { finishKept(id, p, JSON.parse(g)); } catch { finishKept(id, p, null); } }
          else if (Date.now() - p.at > 5 * 60000) { clearInterval(poll); finishKept(id, p, null); }
        }, 4000);
      } else finishKept(id, p, null);
    }
  }
  L.on('ai', (e) => { const w = waitingKept[e.id]; if (w) { try { L.N.aiTake?.(e.id); } catch { /* old app */ } finishKept(w.id, w.p, e); } });
  recoverAssess();

  // ---- Assessment tab
  function tabAssessment() {
    if (isRunning('assess')) {
      const q = L.jobs['assess:' + c.id]?.quick;
      box().innerHTML = (q ? `<div class="card quick" style="margin-bottom:10px"><div class="row wrap"><span class="tag">First look</span>${triBadge({ triage: q.triage })}</div><b class="dxq">${esc(q.leading)}</b><p class="small">${esc(q.summary || '')}</p>${list(q.alt).length ? `<p class="tiny muted">Also: ${list(q.alt).map(esc).join(' · ')}</p>` : ''}</div>` : '')
        + busy(q ? 'Writing the full reading: differential, evidence matrix, tests…' : `Reading ${c.pics.length} picture${c.pics.length === 1 ? '' : 's'} with the history…`);
      return;
    }
    const idx = shown >= 0 && shown < c.assessments.length ? shown : c.assessments.length - 1;
    const a = c.assessments[idx];
    if (!a) { box().innerHTML = jobError('assess') + `<div class="empty">${icon('spark')}<b>Not assessed yet</b>Add evidence on the Evidence tab, then tap Assess.</div><button class="btn pri full" data-act="assess">${icon('spark')}Assess case</button>`; return; }
    const r = a.r, dx = list(r.differentials), head = dx.slice(0, 4), latest = idx === c.assessments.length - 1;
    const poor = list(r.pictures).filter((p) => p && p.retake && p.quality === 'poor');
    box().innerHTML = jobError('assess') + `
      ${!latest ? `<div class="note" style="margin-bottom:10px">Earlier assessment from ${fmt(a.at)}. <button class="btn sm" data-act="show" data-i="-1">Back to the latest</button></div>` : ''}
      <div class="card summary"><div class="row wrap">${triBadge(r)}${r.pattern ? `<span class="tag">${esc(r.pattern)}</span>` : ''}</div>${r.triage?.why && triOf(r) !== 'routine' ? `<p class="tri-why">${esc(oneLine(r.triage.why))}</p>` : ''}<p>${esc(r.summary || '')}</p>
        ${r.changed ? `<p class="small"><b>What changed:</b> ${esc(r.changed)}</p>` : ''}
        ${r.sufficiency === 'unreadable' ? `<div class="note warn" style="margin-top:10px"><b>The pictures are hard to read.</b> ${esc(oneLine(poor.map((p) => p.retake).filter(Boolean)[0] || 'Retake closer, in focus, in daylight.'))}</div>` : ''}
        ${r.refine || r.uncertainty ? `<p class="refine"><b>Would refine:</b> ${esc(oneLine(r.refine || r.uncertainty))}</p>` : ''}
        <p class="tiny muted">${fmt(a.at)} · ${a.n} picture${a.n === 1 ? '' : 's'}${a.secs ? ' · ' + a.secs + ' s' : ''}</p></div>
      ${poor.length && r.sufficiency !== 'unreadable' ? `<p class="refine">${icon('camera')} <b>Retake</b> picture ${poor.slice(0, 2).map((p) => `${esc(p.n)}: ${esc(oneLine(p.retake || 'closer and in focus'))}`).join('; ')}</p>` : ''}
      <div class="sec"><div class="sec-h"><h3>Ranked differential</h3></div>
      ${dx.map((d, i) => `<details class="dx ${i === 0 ? 'lead' : ''}" ${i === 0 ? 'open' : ''}><summary><span class="n">${i + 1}</span><span class="t"><b>${esc(d.name)}</b><span class="st ${esc(d.strength)}">${STR[d.strength] || 'Consider'}</span></span></summary>
        <div class="body"><p>${esc(d.reasoning || '')}</p>
        ${list(d.supporting).length ? `<p><span class="k-for">For</span> ${list(d.supporting).map(esc).join(' · ')}</p>` : ''}
        ${list(d.against).length ? `<p><span class="k-against">Against</span> ${list(d.against).map(esc).join(' · ')}</p>` : ''}
        ${list(d.missing).length ? `<p><span class="k-miss">Missing</span> ${list(d.missing).map(esc).join(' · ')}</p>` : ''}
        ${latest ? `<div class="row wrap" style="margin-top:8px"><button class="btn sm" data-act="ask" data-q="${esc(`What finding would make ${d.name} unlikely in this case, and how would I check for it?`)}">What would rule it out?</button><button class="btn sm" data-act="treat-for" data-dx="${esc(d.name)}">${icon('pill')}Treatment</button></div>` : ''}</div></details>`).join('')}</div>
      ${list(r.matrix).length && head.length ? `<div class="sec"><div class="sec-h"><h3>Evidence matrix</h3></div><div class="mx-wrap"><table class="mx"><thead><tr><th>Finding</th>${head.map((d, i) => `<th>${i + 1}. ${esc(String(d.name).replace(/\(.*?\)/g, '').split(/\s+/).slice(0, 3).join(' '))}</th>`).join('')}</tr></thead><tbody>
        ${list(r.matrix).map((m) => `<tr><td>${esc(m.finding)}${m.source ? `<small>${esc(m.source)}</small>` : ''}</td>${head.map((_, i) => { const v = VER[String(list(m.verdicts)[i] || 'neutral').toLowerCase()] || VER.neutral; return `<td class="${v[1]}">${v[0]}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>
        <p class="tiny muted">✓ supports · ✗ against · ~ nonspecific · – not informative</p></div>` : ''}
      ${list(r.mustNotMiss).length ? `<div class="note bad" style="margin-top:12px"><b>${icon('alert')} Must not miss</b>${list(r.mustNotMiss).map((m) => `<p class="small" style="margin:6px 0 0"><b>${esc(m.name)}:</b> ${esc(m.why)}</p>`).join('')}</div>` : ''}
      ${latest && list(r.questions).length ? `<div class="sec"><div class="sec-h"><h3>Optional: answers that would refine it</h3></div><div class="card">${list(r.questions).map((q, i) => `<div class="qrow"><span class="small">${esc(q)}</span><input class="in" data-q="${i}" placeholder="Answer (optional)"></div>`).join('')}
        <button class="btn sm pri" data-act="answers">${icon('spark')}Add answers and re-assess</button></div></div>` : ''}
      ${latest ? `<div class="sec"><div class="sec-h"><h3>Challenge the reading</h3></div><div class="row wrap">
        <button class="btn sm" data-act="debate">${icon('people')}Specialist debate</button>
        <button class="btn sm" data-act="ask" data-q="${esc(`Argue against the leading diagnosis (${dx[0]?.name || ''}) as a sceptical consultant. Which findings fit poorly, what else explains them, and what should I check?`)}">${icon('alert')}Argue against the leader</button>
        <button class="btn sm" data-act="ask-open">${icon('chat')}Ask about this case</button></div></div>` : ''}
      <div id="debate"></div><div id="thread"></div>
      ${c.assessments.length > 1 ? `<div class="sec"><div class="sec-h"><h3>How the diagnosis evolved</h3></div><div class="card evo">${c.assessments.map((x, i) => `<button class="${i === idx ? 'on' : ''}" data-act="show" data-i="${i}"><b>${fmt(x.at)}</b> · ${x.n} picture${x.n === 1 ? '' : 's'}${x.kinds?.length ? ' (' + x.kinds.map((k) => KINDS[k]?.[0] || k).join(', ') + ')' : ''}<small>${list(x.r.differentials).slice(0, 3).map((d) => `${esc(d.name)} — ${esc((STR[d.strength] || '').toLowerCase())}`).join(' → ')}</small></button>`).join('')}</div></div>` : ''}`;
    paintDebate(); paintThread();
  }
  /** The first sentence, at most ~140 characters: advice stays one short line. */
  const oneLine = (t) => { const x = (/^[^.;]*[.;]?/.exec(String(t || '').trim()) || [''])[0].trim(); return x.length > 140 ? x.slice(0, 137) + '…' : x; };
  actions.show = (b) => { shown = +b.dataset.i; paint(); };
  actions.answers = async () => {
    const qs = list(last(c)?.r?.questions); let n = 0;
    $$('.qrow input').forEach((el) => { const v = el.value.trim(); if (v) { c.answers.push({ q: qs[+el.dataset.q], a: v }); n++; } });
    if (!n) { toast('Type at least one answer'); return; }
    await save();
    actions.assess();
  };

  // ---- Specialist debate: three readings, then a reconciler
  const ROLES = [
    ['Clinical dermatologist', 'Focus on morphology, distribution, history and the clinical photographs; use the other evidence only as it bears on the clinical picture.'],
    ['Dermatopathologist', 'Focus on histopathology, immunofluorescence and microscopy (reaction pattern first, then specific clues). If no slides are given, say what biopsy and stains you would want and reason from the rest.'],
    ['Dermoscopist', 'Focus on dermoscopic structures, vessels, pigment and scale. If no dermoscopy is given, say what dermoscopy would add and reason from the clinical pictures.'],
  ];
  actions.debate = () => {
    const k = c;
    L.runJob('debate:' + k.id, 'Specialist debate', k.id, async () => {
      const views = await Promise.all(ROLES.map(async ([role, focus]) => L.aiPics(`${caseText(k, null)}\n\nYou are the ${role} on a case conference. ${focus}\nReply with JSON only: {"view":"2-3 sentences","differentials":[{"name":"","strength":"strong | consider | alternative | unlikely","key":"the decisive finding for you"}],"wouldWant":"the one extra piece of evidence you want most"}`,
        await aiUrls(k.pics), { system: SYSTEM, max: 3000 }).then(L.json).catch((e) => ({ view: 'No answer: ' + keyErr(e), differentials: [] }))));
      const rec = L.json(await L.ai(`Three specialists reviewed the same dermatology case.\n${ROLES.map(([r], i) => `${r}: ${JSON.stringify(views[i])}`).join('\n')}\n\nAct as the chair of the case conference. Reply with JSON only: {"agreements":["..."],"disagreements":[{"topic":"","positions":"who thinks what and why"}],"reconciled":[{"name":"","strength":"strong | consider | alternative | unlikely","why":""}],"resolve":["the evidence that would settle the disagreements, most useful first"]}`, { system: SYSTEM, max: 3000 }));
      const f = await fresh(k.id);
      f.debate = { at: Date.now(), views, rec };
      await DB.put(f);
      if (c?.id === f.id) c = f;
    }).catch(() => {});
    paintDebate();
  };
  function paintDebate() {
    const el = $('#debate'); if (!el) return;
    if (isRunning('debate')) { el.innerHTML = '<div class="sec">' + busy('Three specialists are reading the case…') + '</div>'; return; }
    const d = c.debate;
    el.innerHTML = jobError('debate') + (!d ? '' : `<div class="sec"><div class="sec-h"><h3>Specialist debate · ${fmt(d.at)}</h3></div><div class="panel3">
      ${ROLES.map(([r], i) => { const v = d.views[i] || {}; return `<div class="card role r${i + 1}"><h4>${r}</h4><p class="small">${esc(v.view || '')}</p><p class="small">${list(v.differentials).map((x) => `<b>${esc(x.name)}</b> <span class="st ${esc(x.strength)}">${STR[x.strength] || ''}</span>${x.key ? ` — ${esc(x.key)}` : ''}`).join('<br>')}</p>${v.wouldWant ? `<p class="tiny muted">Would want: ${esc(v.wouldWant)}</p>` : ''}</div>`; }).join('')}
      <div class="card"><h4>Chair's reconciliation</h4>
        ${list(d.rec?.agreements).length ? `<p class="small"><span class="k-for">Agree</span> ${list(d.rec.agreements).map(esc).join(' · ')}</p>` : ''}
        ${list(d.rec?.disagreements).map((x) => `<p class="small"><span class="k-against">Disagree</span> <b>${esc(x.topic)}:</b> ${esc(x.positions)}</p>`).join('')}
        ${list(d.rec?.reconciled).length ? `<ol class="small">${list(d.rec.reconciled).map((x) => `<li><b>${esc(x.name)}</b> <span class="st ${esc(x.strength)}">${STR[x.strength] || ''}</span> — ${esc(x.why)}</li>`).join('')}</ol>` : ''}
        ${list(d.rec?.resolve).length ? `<p class="small"><span class="k-miss">To settle it</span> ${list(d.rec.resolve).map(esc).join(' · ')}</p>` : ''}</div></div></div>`);
  }

  // ---- Discussion
  function paintThread() {
    const el = $('#thread'); if (!el) return;
    el.innerHTML = c.thread.length ? `<div class="sec"><div class="sec-h"><h3>Discussion</h3></div>${c.thread.map((t) => `<div class="card"><p class="small"><b>${icon('chat')} ${esc(t.q)}</b></p>${t.a == null ? (t.live ? `<div class="live">${md(t.live)}</div>` : '<div class="live"><div class="busy"><span class="spin"></span>Thinking…</div></div>') : md(t.a)}</div>`).join('')}</div>` : '';
  }
  actions['ask-open'] = () => {
    sheet(`<h3>Ask about this case</h3><textarea id="askq" class="in" rows="3" placeholder="e.g. Could this be a drug reaction? Best biopsy site? Is DIF needed?"></textarea><div class="acts"><button class="btn" data-act="close-sheet">Cancel</button><button class="btn pri" data-act="ask-send">Ask</button></div>`);
    setTimeout(() => $('#askq')?.focus(), 100);
  };
  actions['ask-send'] = () => { const q = $('#askq').value.trim(); if (!q) return; closeSheet(); ask(q); };
  actions.ask = (b) => ask(b.dataset.q);
  async function ask(q) {
    const k = c, turn = { q, a: null, at: Date.now() };
    k.thread.push(turn);
    paintThread();
    $('#thread')?.lastElementChild?.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const earlier = k.thread.slice(0, -1).slice(-4).map((t) => `Q: ${t.q}\nA: ${String(t.a || '').slice(0, 600)}`).join('\n');
    const live = (t) => { turn.live = t; if (c?.id === k.id) { const el = $('#thread .card:last-child .live'); if (el) el.innerHTML = md(t); else paintThread(); } };
    try { turn.a = await L.aiStream(`${caseText(k, null)}\n\nLatest reading: ${reading(k)}${earlier ? '\n\nEarlier discussion:\n' + earlier : ''}\n\nThe clinician asks: ${q}\nAnswer directly and concisely in Markdown. Say when the pictures or history can't answer it.`, { system: SYSTEM, max: 2500, onText: live }); } catch (e) { turn.a = '_No answer: ' + keyErr(e) + '_'; }
    const f = await fresh(k.id); f.thread = k.thread; await DB.put(f);
    if (c?.id === k.id) { c.thread = k.thread; paintThread(); }
  }

  // ---- Work-up: investigations, treatment, rare-disease detective, case reports, visit comparison
  function tabWorkup() {
    const a = last(c), dx = list(a?.r?.differentials);
    const tests = list(a?.r?.tests);
    box().innerHTML = `
      <div class="sec" style="margin-top:0"><div class="sec-h"><h3>Investigation planner</h3></div>
        ${tests.length ? tests.map((t, i) => `<div class="card"><h4>${i + 1}. ${esc(t.test)}</h4><p class="small">${esc(t.why || '')}</p>${t.ifPositive ? `<p class="small"><span class="k-for">If positive</span> ${esc(t.ifPositive)}</p>` : ''}${t.ifNegative ? `<p class="small"><span class="k-against">If negative</span> ${esc(t.ifNegative)}</p>` : ''}${t.limits ? `<p class="small"><span class="k-miss">Caveat</span> ${esc(t.limits)}</p>` : ''}</div>`).join('')
          : `<div class="note">Assess the case first: the investigations most useful for separating the leading diagnoses appear here.</div>`}
        ${dx.length > 1 ? `<button class="btn sm" style="margin-top:8px" data-act="ask" data-q="${esc(`Which single investigation best distinguishes ${dx[0].name} from ${dx[1].name} in this case? Expected result in each, and its limitations.`)}">${icon('search')}Best test to separate the top two</button>` : ''}</div>
      <div class="sec"><div class="sec-h"><h3>Treatment assistant</h3></div>${jobError('treat')}
        <div class="card"><p class="small muted" style="margin-top:0">Evidence-oriented options for the diagnosis you choose, adjusted to this patient.</p>
        <div class="chips" style="flex-wrap:wrap">${[...new Set([c.final?.dx, ...dx.slice(0, 4).map((d) => d.name)].filter(Boolean))].map((n) => `<button class="chip" data-act="treat-for" data-dx="${esc(n)}">${esc(n)}</button>`).join('') || '<span class="small muted">Assess the case or set a final diagnosis first.</span>'}</div></div>
        ${isRunning('treat') ? `<div class="card" id="treat-live">${busy('Writing the treatment summary…')}</div>` : ''}
        ${Object.entries(c.treat || {}).map(([n, t]) => `<details class="card fold"><summary><b>${esc(n)}</b><span class="chev">${icon('chev')}</span></summary>${md(t.text)}<p class="tiny muted">${fmt(t.at)} · check doses against current guidelines and the product information.</p>
          <button class="btn sm" data-act="open" data-url="https://europepmc.org/search?query=${encodeURIComponent(`"${n}" AND (PUB_TYPE:"guideline" OR guideline)`)}">${icon('link')}Find guidelines</button></details>`).join('')}</div>
      <div class="sec"><div class="sec-h"><h3>Drug-reaction check</h3></div>${jobError('drug')}
        <div class="card"><p class="small muted" style="margin-top:0">Each medicine against the rash onset: latency, how often it causes this reaction, and a suggested ALDEN (SJS/TEN) or Naranjo score.</p>
        <div class="row wrap"><label class="f" style="flex:1;min-width:150px">Rash started on<input type="date" id="rash-onset" value="${esc(c.pt.onset || '')}"></label>
        <button class="btn sm pri" data-act="drug" ${isRunning('drug') ? 'disabled' : ''}>${icon('pill')}Check the medicines</button></div>
        ${c.pt.meds ? `<p class="tiny muted">Medicines: ${esc(c.pt.meds.slice(0, 160))}</p>` : '<p class="tiny muted">Add medicines with their start dates on the Evidence tab (or read them from a prescription).</p>'}
        <div class="row wrap" style="margin-top:6px"><button class="chip" data-act="go" data-to="tool/alden">ALDEN calculator</button><button class="chip" data-act="go" data-to="tool/naranjo">Naranjo calculator</button></div></div>
        ${isRunning('drug') ? busy('Weighing each medicine…') : c.drug ? drugHtml(c.drug) : ''}</div>
      <div class="sec"><div class="sec-h"><h3>Rare-disease detective</h3></div>${jobError('rare')}
        ${isRunning('rare') ? busy('Looking beyond the common diagnoses…') : c.rare ? rareHtml(c.rare) : `<div class="card"><p class="small" style="margin-top:0">When the case doesn't fit: key clues, contradictions, uncommon diagnoses worth considering, and published case reports.</p><button class="btn sm pri" data-act="rare">${icon('detective')}Investigate</button></div>`}
        ${c.rare && !isRunning('rare') ? `<button class="btn sm" style="margin-top:8px" data-act="rare">${icon('refresh')}Investigate again</button>` : ''}</div>
      <div class="sec"><div class="sec-h"><h3>Follow-up</h3></div>${jobError('compare')}
        <div class="card"><p class="small" style="margin-top:0">${c.patient ? `Visits are linked by the patient label <b>${esc(c.patient)}</b>.` : 'Add a patient label on the Evidence tab to link visits.'}</p>
        <div class="row wrap"><button class="btn sm" data-act="new-visit">${icon('plus')}New visit for this patient</button>${c.visitOf ? `<button class="btn sm" data-act="compare">${icon('compare')}Compare with the previous visit</button>` : ''}</div></div>
        ${isRunning('compare') ? busy('Comparing the visits…') : c.compare ? `<div class="card">${md(c.compare.text)}<p class="tiny muted">${fmt(c.compare.at)}</p></div>` : ''}</div>`;
  }
  const DRUG_TASK = `Assess each medicine as a possible cause of this skin reaction. Use the rash onset date and the medicine start/stop dates where given. Reply with JSON only:
{"pattern":"the reaction pattern if drug-induced (e.g. SJS/TEN, DRESS, AGEP, fixed drug eruption, exanthem, urticaria, lichenoid, photosensitive)","drugs":[{"name":"","latency":"time from start to onset, or 'unknown'","notoriety":"strongly associated | associated | suspected | unknown | not suspected","alden":"estimated ALDEN score (number) if SJS/TEN is possible, else ''","naranjo":"estimated Naranjo score (number)","verdict":"very probable | probable | possible | unlikely | very unlikely","why":"one line"}],"advice":"one or two lines: which medicine to stop first and what to monitor"}
Most likely culprit first. Never invent dates; say 'unknown'.`;
  actions.drug = () => {
    const k = c, onset = $('#rash-onset')?.value || '';
    if (onset !== (k.pt.onset || '')) { k.pt.onset = onset; save(); }
    if (!k.pt.meds && !k.pt.history) { toast('Add the medicines first (Evidence tab)'); return; }
    tab = 'workup';
    L.runJob('drug:' + k.id, 'Drug-reaction check', k.id, async () => {
      const r = L.json(await L.ai(`${caseText(k, null)}\nRash onset: ${onset || 'not given'}\nLatest reading: ${reading(k)}\n\n${DRUG_TASK}`, { system: SYSTEM, max: 3000 }));
      if (!Array.isArray(r?.drugs)) throw new Error('The AI answer came back incomplete. Try again.');
      const f = await fresh(k.id); f.drug = { ...r, at: Date.now() }; await DB.put(f); if (c?.id === f.id) c = f;
    }).catch(() => {});
    paint();
  };
  const VERD = { 'very probable': 'bad', probable: 'bad', possible: 'warn', unlikely: 'ok', 'very unlikely': 'ok' };
  function drugHtml(d) {
    return `<div class="card" style="margin-top:8px">${d.pattern ? `<span class="tag">${esc(d.pattern)}</span>` : ''}
      ${list(d.drugs).map((x) => `<div style="padding:8px 0;border-bottom:1px solid var(--line)"><b>${esc(x.name)}</b> <span class="tri ${VERD[String(x.verdict).toLowerCase()] === 'bad' ? 'urgent' : VERD[String(x.verdict).toLowerCase()] === 'warn' ? 'soon' : 'routine'}" style="animation:none">${esc(x.verdict || '')}</span>
        <div class="small muted">${esc([x.latency && 'Latency ' + x.latency, x.notoriety, x.alden !== '' && x.alden != null ? 'ALDEN ≈ ' + x.alden : '', x.naranjo !== '' && x.naranjo != null ? 'Naranjo ≈ ' + x.naranjo : ''].filter(Boolean).join(' · '))}</div>
        ${x.why ? `<div class="small">${esc(x.why)}</div>` : ''}</div>`).join('')}
      ${d.advice ? `<p class="small"><span class="k-miss">Advice</span> ${esc(d.advice)}</p>` : ''}<p class="tiny muted">${fmt(d.at)} · AI estimates: confirm the scores with the calculators.</p></div>`;
  }
  actions['treat-for'] = (b) => {
    const n = b.dataset.dx, k = c;
    tab = 'workup';
    L.runJob('treat:' + k.id, 'Treatment summary', k.id, async () => {
      const text = await L.aiStream(`${caseText(k, null)}\n\nDiagnosis to treat: ${n}\n\nWrite a concise, evidence-oriented treatment summary for a dermatologist, adjusted to this patient (age, sex, pregnancy potential, comorbidities and medicines if known). Use Markdown headings:\n## First line\n## Alternatives and second line\n## Doses and duration (typical adult doses; paediatric notes)\n## Contraindications and interactions\n## Monitoring\n## Pregnancy and lactation\n## If it fails\n## Maintenance and recurrence\n## Why the first line is preferred\nName guideline bodies (e.g. BAD, AAD, EADV, IADVL) only when sure; never invent citations or numbers. Flag anything needing specialist or systemic work-up.`, { system: SYSTEM, max: 4000, onText: (t) => { const el = $('#treat-live'); if (el && c?.id === k.id) el.innerHTML = `<h4>${esc(n)}</h4>` + md(t); } });
      const f = await fresh(k.id); f.treat = { ...(f.treat || {}), [n]: { text, at: Date.now() } }; await DB.put(f); if (c?.id === f.id) c = f;
    }).catch(() => {});
    paint();
  };

  // Rare-disease detective (also used by the stand-alone screen in lx-explore.js)
  const RARE_TASK = `Act as a rare-disease detective in dermatology. The common diagnoses may not explain this case. Reply with JSON only:
{"keyClues":["the most discriminating clues"],"contradictions":["findings that don't fit the leading diagnoses"],"uncommon":[{"name":"diagnosis","why":"why it deserves consideration","fits":["matching findings"],"against":["findings against"],"test":"how to confirm or exclude"}],"categories":["e.g. genodermatosis, drug reaction, infection, metabolic, autoinflammatory"],"searchTerms":["2-3 short PubMed search phrases for similar case reports"]}
Give 4-7 uncommon diagnoses, only where the evidence warrants them; include treatable mimics.`;
  async function rareRun(text, urls) {
    const r = L.json(await L.aiPics(text + "\n\n" + RARE_TASK, urls, { system: SYSTEM, max: 6000 }));
    r.reports = [];
    for (const t of list(r.searchTerms).slice(0, 2)) {
      try { r.reports.push(...await epmc(`(${t}) AND PUB_TYPE:"case reports"`, 4)); } catch { /* offline: no reports */ }
    }
    const seen = new Set(); r.reports = r.reports.filter((x) => !seen.has(x.id) && seen.add(x.id));
    return r;
  }
  function rareHtml(r) {
    return `<div class="card">${list(r.keyClues).length ? `<p class="small" style="margin-top:0"><span class="k-for">Key clues</span> ${list(r.keyClues).map(esc).join(' · ')}</p>` : ''}
      ${list(r.contradictions).length ? `<p class="small"><span class="k-against">Doesn't fit</span> ${list(r.contradictions).map(esc).join(' · ')}</p>` : ''}
      ${list(r.categories).length ? `<p class="small"><span class="k-miss">Think about</span> ${list(r.categories).map(esc).join(' · ')}</p>` : ''}</div>
      ${list(r.uncommon).map((u) => `<details class="dx"><summary><span class="n">?</span><span class="t"><b>${esc(u.name)}</b><span class="small muted">${esc(u.why || '')}</span></span></summary><div class="body">
        ${list(u.fits).length ? `<p><span class="k-for">Fits</span> ${list(u.fits).map(esc).join(' · ')}</p>` : ''}${list(u.against).length ? `<p><span class="k-against">Against</span> ${list(u.against).map(esc).join(' · ')}</p>` : ''}${u.test ? `<p><span class="k-miss">Confirm</span> ${esc(u.test)}</p>` : ''}</div></details>`).join('')}
      ${list(r.reports).length ? `<div class="card"><h4>Similar published case reports</h4>${reportsHtml(r.reports)}</div>` : ''}`;
  }
  actions.rare = () => {
    const k = c; tab = 'workup';
    L.runJob('rare:' + k.id, 'Rare-disease detective', k.id, async () => {
      const r = await rareRun(`${caseText(k, null)}\nLatest reading: ${reading(k)}`, await aiUrls(k.pics));
      const f = await fresh(k.id); f.rare = { ...r, at: Date.now() }; await DB.put(f); if (c?.id === f.id) c = f;
    }).catch(() => {});
    paint();
  };

  // Europe PMC (PubMed and more): free, no key
  async function epmc(query, n = 8) {
    const u = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json&pageSize=${n}&resultType=lite&sort=RELEVANCE`;
    const res = await fetch(u);
    if (!res.ok) throw new Error('Europe PMC didn\'t answer');
    const j = await res.json();
    return list(j.resultList?.result).map((x) => ({ id: x.id, title: x.title, by: x.authorString, journal: x.journalTitle, year: x.pubYear, url: x.pmid ? `https://europepmc.org/article/MED/${x.pmid}` : x.doi ? `https://doi.org/${x.doi}` : `https://europepmc.org/article/${x.source}/${x.id}` }));
  }
  const reportsHtml = (rs) => rs.map((x) => `<button class="li" data-act="open" data-url="${esc(x.url)}"><span><b style="white-space:normal">${esc(x.title)}</b><small>${esc([x.by && String(x.by).split(',').slice(0, 2).join(','), x.journal, x.year].filter(Boolean).join(' · '))}</small></span>${icon('link')}</button>`).join('');

  actions['new-visit'] = async () => {
    const v = L.norm({ id: 'c' + Date.now().toString(36), created: Date.now(), updated: Date.now(), patient: c.patient || 'Patient ' + fmtDay(c.created), visitOf: c.id, title: '', pt: { ...c.pt, treated: [c.pt.treated, c.final?.dx ? `Previous visit diagnosis: ${c.final.dx}` : ''].filter(Boolean).join('\n') } });
    if (!c.patient) { c.patient = v.patient; await save(); }
    await DB.put(v);
    toast('New visit: add today\'s pictures');
    go('case/' + v.id);
  };
  actions.compare = async () => {
    const k = c, prev = await DB.get(k.visitOf);
    if (!prev) { toast('The previous visit was deleted'); return; }
    const pick = (x) => x.pics.filter((p) => p.kind === 'clinical' || p.kind === 'dermoscopy').slice(0, 4);
    const a = pick(prev), b = pick(k);
    if (!a.length || !b.length) { toast('Both visits need clinical or dermoscopy pictures'); return; }
    tab = 'workup';
    L.runJob('compare:' + k.id, 'Comparing visits', k.id, async () => {
      const text = await L.aiPics(`Pictures 1-${a.length} are from the earlier visit (${fmtDay(prev.created)}); pictures ${a.length + 1}-${a.length + b.length} are from today (${fmtDay(k.created)}). Treatment between visits: ${k.pt.treated || prev.pt.treated || 'not stated'}. Diagnosis: ${prev.final?.dx || list(last(prev)?.r?.differentials)[0]?.name || 'not set'}.
Compare like with like (same site where possible). In Markdown: ## Overall change (improved / unchanged / worse, in one line) ## What changed (erythema, scale, induration, size, borders, colour, new lesions, pigment) ## Estimated activity (state if a score like PASI/EASI/VASI could be estimated, as a rough guide only) ## Suggestions. Say when angle, lighting or site differ too much to compare.`, await aiUrls([...a, ...b]), { system: SYSTEM, max: 1800 });
      const f = await fresh(k.id); f.compare = { text, at: Date.now() }; await DB.put(f); if (c?.id === f.id) c = f;
    }).catch(() => {});
    paint();
  };

  // ---- Notes: final diagnosis, SOAP, referral, case presentation, MCQs
  const DOCS = {
    soap: ['SOAP note', 'Write a concise SOAP note for the clinical record (Subjective, Objective incl. described morphology and investigations, Assessment with differential, Plan). Use only facts given; mark assumptions.'],
    referral: ['Referral letter', 'Write a short referral letter to a colleague (e.g. dermatopathology, rheumatology, or a tertiary dermatology unit as appropriate): reason for referral, summary, investigations so far, differential, specific question. Leave [placeholders] for names.'],
    presentation: ['Case presentation', 'Write a case presentation outline for a clinical meeting: title slide, history, examination, investigations, differential with discussion, diagnosis, teaching points, 3 references to look up (as search phrases, not invented citations).'],
    mcq: ['Teaching MCQs', 'Write 5 single-best-answer MCQs for dermatology residents based on this case (clinicopathological correlation, investigations, management), each with 5 options, the answer and a one-paragraph explanation.'],
    patient: ['Patient explanation', 'Write a short, plain-language explanation for the patient of the likely condition, the tests planned and what to expect. Kind, clear, no jargon, no certainty beyond the evidence.'],
  };
  function tabNotes() {
    box().innerHTML = `<div class="sec" style="margin-top:0"><div class="sec-h"><h3>Final diagnosis</h3></div><div class="card">
        <input id="fdx" class="in" value="${esc(c.final?.dx || '')}" placeholder="The diagnosis you settle on">
        <textarea id="fnote" class="in" rows="2" style="margin-top:8px" placeholder="Basis, biopsy result, follow-up (optional)">${esc(c.final?.note || '')}</textarea></div></div>
      <div class="sec"><div class="sec-h"><h3>Write</h3></div>${jobError('doc')}<div class="row wrap">${Object.entries(DOCS).map(([k, [l]]) => `<button class="btn sm" data-act="doc" data-k="${k}">${icon('note')}${l}</button>`).join('')}</div>
        ${isRunning('doc') ? busy('Writing…') : ''}
        ${Object.entries(c.docs || {}).map(([k, d]) => `<details class="card fold"><summary><b>${esc(DOCS[k]?.[0] || k)}</b><span class="tiny muted">${fmt(d.at)}</span><span class="chev">${icon('chev')}</span></summary>${md(d.text)}<div class="row" style="margin-top:8px"><button class="btn sm" data-act="doc-share" data-k="${k}">${icon('share')}Share</button><button class="btn sm" data-act="doc-copy" data-k="${k}">Copy</button></div></details>`).join('')}</div>
      <div class="sec"><div class="sec-h"><h3>Scores</h3></div><div class="row wrap">${[['pasi', 'PASI'], ['easi', 'EASI'], ['scorad', 'SCORAD'], ['salt', 'SALT'], ['vasi', 'VASI'], ['uas7', 'UAS7'], ['dlqi', 'DLQI'], ['gags', 'GAGS']].map(([k, l]) => `<button class="chip" data-act="go" data-to="tool/${k}">${l}</button>`).join('')}</div></div>`;
    $('#fdx').addEventListener('input', (e) => { c.final.dx = e.target.value.trim(); saveSoon(); });
    $('#fnote').addEventListener('input', (e) => { c.final.note = e.target.value.trim(); saveSoon(); });
  }
  actions.doc = (b) => {
    const kind = b.dataset.k, k = c;
    L.runJob('doc:' + k.id, DOCS[kind][0], k.id, async () => {
      const text = await L.ai(`${caseText(k, null)}\nLatest reading: ${reading(k)}\nFinal diagnosis: ${k.final?.dx || 'not yet set'} ${k.final?.note || ''}\n\n${DOCS[kind][1]}\nMarkdown.`, { system: SYSTEM, max: 2500 });
      const f = await fresh(k.id); f.docs = { ...(f.docs || {}), [kind]: { text, at: Date.now() } }; await DB.put(f); if (c?.id === f.id) c = f;
    }).catch(() => {});
    paint();
  };
  actions['doc-share'] = (b) => share(DOCS[b.dataset.k][0], c.docs[b.dataset.k].text);
  actions['doc-copy'] = (b) => { const t = c.docs[b.dataset.k].text; if (L.N.copy) L.N.copy(t); else navigator.clipboard?.writeText(t); toast('Copied'); };
  const share = (title, text) => { if (L.N.share) L.N.share(title, text); else if (navigator.share) navigator.share({ title, text }).catch(() => {}); else { navigator.clipboard?.writeText(text); toast('Copied'); } };

  actions['case-menu'] = () => sheet(`<h3>${esc(titleOf(c))}</h3>
    <button class="btn full" data-act="case-share">${icon('share')}Share a summary (text, no pictures)</button><div style="height:8px"></div>
    <button class="btn full" data-act="new-visit">${icon('plus')}New visit for this patient</button><div style="height:8px"></div>
    <button class="btn full" data-act="case-star">${icon('star')}${c.star ? 'Unmark ★ keep' : '★ Keep (pin in History)'}</button><div style="height:8px"></div>
    <button class="btn full danger" data-act="case-del">${icon('trash')}Delete this case</button>`);
  actions['case-star'] = async () => { c.star = !c.star; closeSheet(); await save(); toast(c.star ? '★ Kept' : 'Unmarked'); };
  actions['case-del'] = async () => { if (!confirm('Delete this case and its pictures from this device?')) return; closeSheet(); await DB.del(c.id); c = null; go('cases', { replace: true }); };
  actions['case-share'] = () => {
    closeSheet();
    const a = last(c), r = a?.r || {};
    share('Lesionaut case', [`Case: ${titleOf(c)}`, ptLine(c), c.pt.history, c.pics.length ? 'Evidence: ' + c.pics.map((p, i) => `${i + 1}. ${KINDS[p.kind]?.[0]}${p.note ? ' (' + p.note + ')' : ''}`).join('; ') : '',
      r.summary ? '\nAssessment: ' + r.summary : '', list(r.differentials).length ? 'Differential: ' + list(r.differentials).map((d, i) => `${i + 1}. ${d.name} (${(STR[d.strength] || '').toLowerCase()})`).join('; ') : '',
      list(r.tests).length ? 'Investigations: ' + list(r.tests).map((t) => t.test).join('; ') : '', c.final?.dx ? '\nFinal diagnosis: ' + c.final.dx : '', '\nAI-assisted decision support (Lesionaut), reviewed by the clinician.'].filter(Boolean).join('\n'));
  };

  // ================================================================ Annotation studio
  function studio(i) {
    const p = c.pics[i];
    if (!p) { go('case/' + c.id, { replace: true }); return; }
    paint();
    const COLORS = ['#f43f5e', '#facc15', '#22d3ee', '#ffffff', '#111827'];
    let tool = 'arrow', color = COLORS[0];
    const shapes = [];
    document.body.insertAdjacentHTML('beforeend', `<div class="studio"><div class="tools">
      <button data-st="close">${icon('x')}</button>${[['arrow', 'Arrow'], ['circle', 'Circle'], ['pen', 'Pen'], ['text', 'Label'], ['biopsy', 'Biopsy site'], ['blur', 'Hide (blur)']].map(([k, l]) => `<button data-tool="${k}" class="${k === tool ? 'on' : ''}">${l}</button>`).join('')}
      ${COLORS.map((x) => `<button class="sw" data-col="${x}" style="background:${x}"></button>`).join('')}<button data-st="undo">Undo</button><button data-st="save" class="on">Save</button></div>
      <div class="canvas-wrap"><canvas></canvas></div></div>`);
    const root = $('.studio'), cv = root.querySelector('canvas'), g = cv.getContext('2d');
    const img = new Image();
    img.onload = () => { cv.width = img.width; cv.height = img.height; draw(); };
    img.src = p.url;
    const lw = () => Math.max(3, Math.round(cv.width / 220));
    function shape(s) {
      g.strokeStyle = g.fillStyle = s.color; g.lineWidth = lw(); g.lineCap = g.lineJoin = 'round';
      if (s.t === 'blur') { const x = Math.min(s.x1, s.x2), y = Math.min(s.y1, s.y2); L.pixelate(g, Math.round(x), Math.round(y), Math.round(Math.abs(s.x2 - s.x1)), Math.round(Math.abs(s.y2 - s.y1)), Math.max(8, Math.round(cv.width / 60))); return; }
      if (s.t === 'pen') { g.beginPath(); s.pts.forEach(([x, y], j) => (j ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); }
      else if (s.t === 'circle') { g.beginPath(); g.ellipse((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2, Math.abs(s.x2 - s.x1) / 2 || 1, Math.abs(s.y2 - s.y1) / 2 || 1, 0, 0, Math.PI * 2); g.stroke(); }
      else if (s.t === 'arrow') {
        const a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1), h = lw() * 5;
        g.beginPath(); g.moveTo(s.x1, s.y1); g.lineTo(s.x2, s.y2); g.stroke();
        g.beginPath(); g.moveTo(s.x2, s.y2); g.lineTo(s.x2 - h * Math.cos(a - 0.45), s.y2 - h * Math.sin(a - 0.45)); g.lineTo(s.x2 - h * Math.cos(a + 0.45), s.y2 - h * Math.sin(a + 0.45)); g.closePath(); g.fill();
      } else if (s.t === 'text' || s.t === 'biopsy') {
        const fs = Math.max(18, Math.round(cv.width / 28));
        if (s.t === 'biopsy') { g.beginPath(); g.arc(s.x1, s.y1, fs * 0.55, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.moveTo(s.x1 - fs * 0.3, s.y1); g.lineTo(s.x1 + fs * 0.3, s.y1); g.moveTo(s.x1, s.y1 - fs * 0.3); g.lineTo(s.x1, s.y1 + fs * 0.3); g.stroke(); }
        g.font = `700 ${fs}px sans-serif`; g.lineWidth = Math.max(3, fs / 6); g.strokeStyle = 'rgba(0,0,0,.65)';
        const tx = s.t === 'biopsy' ? s.x1 + fs * 0.8 : s.x1, ty = s.t === 'biopsy' ? s.y1 + fs * 0.35 : s.y1;
        g.strokeText(s.text, tx, ty); g.fillStyle = s.color; g.fillText(s.text, tx, ty);
      }
    }
    function draw() { g.drawImage(img, 0, 0); shapes.forEach(shape); }
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
    let live = null;
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      const [x, y] = pos(e);
      if (tool === 'text' || tool === 'biopsy') {
        const t = prompt(tool === 'biopsy' ? 'Label for the biopsy site' : 'Label', tool === 'biopsy' ? 'Biopsy' : '');
        if (t) { shapes.push({ t: tool, x1: x, y1: y, text: t, color }); draw(); }
        return;
      }
      live = tool === 'pen' ? { t: 'pen', pts: [[x, y]], color } : { t: tool, x1: x, y1: y, x2: x, y2: y, color };
      shapes.push(live);
    });
    cv.addEventListener('pointermove', (e) => { if (!live) return; const [x, y] = pos(e); if (live.t === 'pen') live.pts.push([x, y]); else { live.x2 = x; live.y2 = y; } draw(); });
    cv.addEventListener('pointerup', () => { live = null; });
    root.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.tool) { tool = b.dataset.tool; root.querySelectorAll('[data-tool]').forEach((x) => x.classList.toggle('on', x === b)); }
      else if (b.dataset.col) color = b.dataset.col;
      else if (b.dataset.st === 'undo') { shapes.pop(); draw(); }
      else if (b.dataset.st === 'close') { root.remove(); history.back(); }
      else if (b.dataset.st === 'save') {
        if (!shapes.length) { root.remove(); history.back(); return; }
        const url = cv.toDataURL('image/jpeg', 0.88);
        const choice = confirm('Save as a new picture? (Cancel replaces the original)');
        if (choice) c.pics.splice(i + 1, 0, { ...p, url, note: (p.note ? p.note + ' · ' : '') + 'annotated', at: Date.now() }); else c.pics[i] = { ...p, url };
        await save(); root.remove(); toast('Annotation saved'); history.back();
      }
    });
  }

  Object.assign(L, { KINDS, SYSTEM, rareRun, rareHtml, epmc, reportsHtml, share, titleOf, ptLine, last });
})();
