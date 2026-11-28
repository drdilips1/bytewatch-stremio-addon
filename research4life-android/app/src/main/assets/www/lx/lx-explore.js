// Lesionaut Explore: the pattern library, "Teach me this slide", the stand-alone rare case
// detective, the disease relationship explorer and literature search (Europe PMC).
(() => {
  'use strict';
  const L = window.LX;
  const { $, $$, esc, icon, store, toast, md, go, bar, actions, routes, list } = L;
  const view = () => $('#view');
  const { PATTERNS } = window.LXDATA;

  routes.explore = (_, params) => {
    const g = params.g || 'all';
    const groups = ['all', ...new Set(PATTERNS.map((p) => p.g))];
    const shown = PATTERNS.filter((p) => g === 'all' || p.g === g);
    view().innerHTML = `${bar('Explore', { back: false })}
      <div class="tiles" style="margin-top:0">
        <button class="tile" data-act="go" data-to="teach"><span class="ti">${icon('graduation')}</span><b>Teach me this slide</b><span>Architecture, pattern, cells, clues, differentials, a quiz</span></button>
        <button class="tile g" data-act="go" data-to="detective"><span class="ti">${icon('detective')}</span><b>Rare case detective</b><span>"I can't explain this case"</span></button>
        <button class="tile g" data-act="go" data-to="relations"><span class="ti">${icon('layers')}</span><b>Disease relationships</b><span>Shared clinical, histological, immune, genetic features</span></button>
        <button class="tile" data-act="go" data-to="lit"><span class="ti">${icon('book')}</span><b>Literature</b><span>Case reports, guidelines, reviews</span></button>
      </div>
      <div class="sec"><div class="sec-h"><h3>Pattern library</h3></div>
        <div class="chips">${groups.map((x) => `<button class="chip ${x === g ? 'on' : ''}" data-act="go" data-to="explore?g=${esc(x)}">${x === 'all' ? 'All' : esc(x)}</button>`).join('')}</div>
        <div class="card list">${shown.map((p) => `<button class="li" data-act="go" data-to="pattern/${p.k}"><span class="ph">${icon(p.g === 'Histology' ? 'micro' : p.g === 'Dermoscopy' ? 'search' : 'image')}</span><span><b>${esc(p.name)}</b><small>${esc(p.g)} · ${esc(p.dx.slice(0, 3).map((d) => d[0]).join(', '))}…</small></span>${icon('chev')}</button>`).join('')}</div></div>`;
  };

  routes.pattern = (k) => {
    const p = PATTERNS.find((x) => x.k === k);
    if (!p) { go('explore', { replace: true }); return; }
    view().innerHTML = `${bar(p.name)}
      <span class="tag">${esc(p.g)}</span><p>${esc(p.what)}</p>
      <div class="sec"><div class="sec-h"><h3>Differential diagnosis</h3></div><div class="card">${p.dx.map(([n, w]) => `<div style="padding:8px 0;border-bottom:1px solid var(--line)"><b>${esc(n)}</b><div class="small muted">${esc(w)}</div></div>`).join('')}</div></div>
      <div class="sec"><div class="sec-h"><h3>Pearls</h3></div><div class="card"><ul class="small" style="margin:0;padding-left:18px">${p.clues.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div></div>
      <div class="sec"><div class="sec-h"><h3>Go deeper</h3></div><div class="row wrap">
        <button class="btn sm" data-act="pat-ai" data-k="${p.k}" data-m="table">${icon('grid')}Comparison table</button>
        <button class="btn sm" data-act="pat-ai" data-k="${p.k}" data-m="approach">${icon('micro')}Step-by-step approach</button>
        <button class="btn sm" data-act="pat-ai" data-k="${p.k}" data-m="quiz">${icon('graduation')}Quiz me</button></div><div id="pat-out" style="margin-top:10px"></div></div>`;
  };
  actions['pat-ai'] = async (b) => {
    const p = PATTERNS.find((x) => x.k === b.dataset.k);
    const ask = { table: `Make a comparison table (Markdown) of the main differentials of the ${p.g.toLowerCase()} pattern "${p.name}": columns for key clinical features, key histological or dermoscopic clues, special stains or tests, and pitfalls.`,
      approach: `Give a practical step-by-step approach for a resident facing the ${p.g.toLowerCase()} pattern "${p.name}": what to look at first, the branching questions, and when to order which test. Markdown.`,
      quiz: `Write 4 single-best-answer questions testing recognition and differentiation within the ${p.g.toLowerCase()} pattern "${p.name}", each with 5 options, the answer and a short explanation. Markdown.` }[b.dataset.m];
    const out = $('#pat-out');
    out.innerHTML = `<div class="card busy"><span class="spin"></span>Writing…</div>`;
    try {
      const text = await L.aiStream(ask, { system: L.SYSTEM, max: 4000, onText: (t) => { out.innerHTML = `<div class="card">${md(t)}</div>`; } });
      out.innerHTML = `<div class="card">${md(text)}</div>`;
      keep({ id: 'h' + Date.now().toString(36), kind: 'notes', title: `${p.name}: ${{ table: 'comparison table', approach: 'step-by-step approach', quiz: 'quiz' }[b.dataset.m]}`, sub: p.g + ' pattern', data: { text, link: 'pattern/' + p.k } });
    } catch (e) { out.innerHTML = `<div class="note bad">${esc(L.keyErr(e))}</div>`; }
  };

  // ---- Saved to History (lx-history.js): every session, search and answer, with its pictures
  const thumbOf = (url) => (url ? L.shrink(url, 240, 0.7) : Promise.resolve(''));
  const keep = (h) => L.DB.hist.put(h).catch(() => toast('Couldn\'t save to History (storage full?)'));
  L.keep = keep;

  // ---- Teach me this slide
  let teachPic = null, teachOut = '', teachId = '', teachCtx = '';
  routes.teach = (_, params) => {
    if (params.h && params.h !== teachId) { openTeach(params.h); return; }
    view().innerHTML = `${bar('Teach me this slide')}
      <p class="muted small" style="margin-top:0">One H&E, special stain, DIF or dermoscopy image. You get a structured teaching session: what to see, what it means, and how to tell it from look-alikes. Crop off printed captions or labels so they don't give the answer away.</p>
      ${teachPic ? `<div class="teach-pic"><img src="${teachPic}" alt="" data-act="teach-zoom"><button class="pm" data-act="teach-remove" aria-label="Remove picture">${icon('x')}</button></div>
        <div class="row wrap" style="margin-top:8px"><button class="btn sm" data-act="teach-pick">${icon('image')}Replace</button><button class="btn sm" data-act="teach-cam">${icon('camera')}Photograph</button><button class="btn sm" data-act="teach-crop">${icon('crop')}Crop</button></div>`
        : `<div class="pics"><button class="addpic" data-act="teach-pick">${icon('image')}Choose image</button><button class="addpic" data-act="teach-cam">${icon('camera')}Photograph</button></div>`}
      <label class="f" style="margin-top:12px">What is it (optional)<input id="teach-ctx" class="in" value="${esc(teachCtx || (teachPic ? '' : store.get('teachCtx', '')))}" placeholder="e.g. H&E ×100, skin biopsy from the forearm"></label>
      <div class="row" style="margin-top:12px"><button class="btn pri" data-act="teach-go" style="flex:1">${icon('graduation')}Teach me</button><button class="btn" data-act="teach-quiz">Quiz first</button></div>
      <div id="teach-out" style="margin-top:12px">${teachOut ? `<div class="card">${md(teachOut)}</div>` : ''}</div>`;
  };
  async function openTeach(id) {
    const h = await L.DB.hist.get(id).catch(() => null);
    if (!h) { go('teach', { replace: true }); return; }
    teachId = h.id; teachPic = h.data.pic; teachCtx = h.data.ctx || ''; teachOut = h.data.out || '';
    routes.teach('', {});
  }
  // A new or changed picture starts a new session: the old teaching goes (it's kept in History).
  const setTeach = async (urls) => { teachPic = await L.shrink(urls[0], 1280); teachOut = ''; teachId = ''; teachCtx = $('#teach-ctx')?.value.trim() || ''; routes.teach('', {}); };
  actions['teach-pick'] = () => L.pickImages(1).then(setTeach).catch((e) => { if (!/cancel/i.test(e.message)) toast(e.message); });
  actions['teach-cam'] = () => L.camera().then(setTeach).catch((e) => { if (!/cancel/i.test(e.message)) toast(e.message); });
  actions['teach-zoom'] = () => L.lightbox([{ src: teachPic, label: 'Slide' }]);
  actions['teach-remove'] = () => { teachPic = null; teachOut = ''; teachId = ''; routes.teach('', {}); };
  actions['teach-crop'] = async () => { const u = await L.crop(teachPic); if (u) await setTeach([u]); };
  async function teach(quiz) {
    if (!teachPic) { toast('Choose an image first'); return; }
    const ctx = $('#teach-ctx').value.trim(); store.set('teachCtx', ctx); teachCtx = ctx;
    const pic = teachPic;
    const out = $('#teach-out');
    out.innerHTML = `<div class="card busy"><span class="spin"></span>Studying the image…</div>`;
    const task = quiz
      ? `${ctx ? 'Context: ' + ctx + '\n' : ''}Act as a dermatopathology teacher. Don't reveal the diagnosis yet. Ask me 4 short questions that lead me through this image (architecture, reaction pattern, key cells, decisive clue), each followed by a hidden answer in the form "Answer: …" on its own line, then a final line "Diagnosis to consider: …". Markdown.`
      : `${ctx ? 'Context: ' + ctx + '\n' : ''}Teach me this image as an expert dermatopathologist / dermoscopist teaching a resident. Markdown with headings:\n## What we are looking at (type, stain, magnification, quality)\n## Architecture (low power)\n## Reaction pattern\n## Cells and infiltrate\n## The decisive clues\n## Differential diagnosis (table: diagnosis · for · against)\n## Pitfalls\n## What else I would want (stains, DIF, clinical information)\n## One question to test yourself (answer at the end)\nDescribe only what is visible; say when the image can't show something.`;
    try {
      const text = await L.aiPics(task, [pic], { system: L.SYSTEM, max: 5000 });
      if (pic !== teachPic) return; // the picture was replaced meanwhile
      teachOut = text; out.innerHTML = `<div class="card">${md(teachOut)}</div>`;
      teachId ||= 'h' + Date.now().toString(36);
      const head = (/Diagnosis to consider:\s*(.+)/i.exec(text) || /##\s*Differential[^\n]*\n[\s\S]*?\|\s*\**([^|*\n]{3,60})\**\s*\|/i.exec(text) || [])[1];
      keep({ id: teachId, kind: /dermoscop/i.test(ctx + text.slice(0, 400)) ? 'dermoscopy' : 'slide', title: (ctx || (head ? head.trim() : 'Slide')).slice(0, 90), sub: quiz ? 'Quiz' : 'Teaching', thumb: await thumbOf(pic), data: { pic, ctx, out: text, quiz } });
    } catch (e) { out.innerHTML = `<div class="note bad">${esc(L.keyErr(e))}</div>`; }
  }
  actions['teach-go'] = () => teach(false);
  actions['teach-quiz'] = () => teach(true);

  // ---- Rare case detective (stand-alone)
  let detPics = [], detOut = null;
  routes.detective = () => {
    view().innerHTML = `${bar('Rare case detective')}
      <p class="muted small" style="margin-top:0">"I can't explain this case." Describe it (and add pictures if you have them): you get the key clues, contradictions, uncommon diagnoses worth considering, how to confirm them, and similar published case reports.</p>
      <textarea id="det-text" class="in" rows="5" placeholder="Age, sex, morphology and distribution, course, systemic features, histology, labs, what has been excluded…">${esc(store.get('detText', ''))}</textarea>
      <div class="pics" style="margin-top:10px">${detPics.map((u, i) => `<div class="pic"><img src="${u}" alt=""><button class="pm" data-act="det-del" data-i="${i}">${icon('x')}</button></div>`).join('')}${detPics.length < 6 ? `<button class="addpic" data-act="det-pick">${icon('image')}Add pictures</button>` : ''}</div>
      <button class="btn pri full" style="margin-top:12px" data-act="det-go">${icon('detective')}Investigate</button>
      <div id="det-out" style="margin-top:12px">${detOut ? L.rareHtml(detOut) : ''}</div>`;
    $('#det-text').addEventListener('input', (e) => store.set('detText', e.target.value));
  };
  actions['det-pick'] = () => L.pickImages(6 - detPics.length).then(async (urls) => { for (const u of urls) detPics.push(await L.shrink(u, 1024)); routes.detective(); }).catch((e) => { if (!/cancel/i.test(e.message)) toast(e.message); });
  actions['det-del'] = (b) => { detPics.splice(+b.dataset.i, 1); routes.detective(); };
  actions['det-go'] = async () => {
    const text = $('#det-text').value.trim();
    if (!text && !detPics.length) { toast('Describe the case first'); return; }
    const out = $('#det-out');
    out.innerHTML = `<div class="card busy"><span class="spin"></span>Looking beyond the common diagnoses…</div>`;
    try {
      detOut = await L.rareRun('CASE\n' + (text || 'See pictures.'), await Promise.all(detPics.map((u) => L.hideFaces(u)))); out.innerHTML = L.rareHtml(detOut);
      keep({ id: 'h' + Date.now().toString(36), kind: 'detective', title: (text || 'Pictures only').slice(0, 90), sub: L.list(detOut.uncommon).slice(0, 3).map((u) => u.name).join(', '), thumb: await thumbOf(detPics[0]), data: { text, pics: [...detPics], out: detOut } });
    } catch (e) { out.innerHTML = `<div class="note bad">${esc(L.keyErr(e))}</div>`; }
  };

  // ---- Disease relationship explorer
  routes.relations = (_, params) => {
    const q = params.q || '';
    view().innerHTML = `${bar('Disease relationships')}
      <form class="search" data-form="rel">${icon('layers')}<input name="q" value="${esc(q)}" placeholder="A disease, e.g. lichen planopilaris" enterkeyhint="search"></form>
      <div id="rel-out" style="margin-top:12px"></div>`;
    $('[data-form=rel]').addEventListener('submit', (e) => { e.preventDefault(); const v = e.target.q.value.trim(); if (v) go('relations?q=' + encodeURIComponent(v), { replace: true }); });
    if (q) relations(q);
  };
  async function relations(q) {
    const out = $('#rel-out');
    out.innerHTML = `<div class="card busy"><span class="spin"></span>Mapping relationships…</div>`;
    try {
      const text = await L.aiStream(`Map the diseases related to "${q}" for a dermatologist. Markdown with headings:\n## Clinical look-alikes (and how to tell them apart)\n## Histological relatives (shared reaction pattern; distinguishing clues)\n## Immunological links (shared autoantibodies, pathways, associations)\n## Genetic or syndromic links\n## Overlap syndromes and associations to screen for\n## Treatments that cross over\nBe specific and concise; no invented citations.`, { system: L.SYSTEM, max: 4000, onText: (t) => { out.innerHTML = `<div class="card">${md(t)}</div>`; } });
      out.innerHTML = `<div class="card">${md(text)}</div>`;
      keep({ id: 'h' + Date.now().toString(36), kind: 'notes', title: `Relationships: ${q}`, sub: 'Disease relationships', data: { text, link: 'relations?q=' + encodeURIComponent(q) } });
    } catch (e) { out.innerHTML = `<div class="note bad">${esc(L.keyErr(e))}</div>`; }
  }

  // ---- Literature
  const LIT = { cases: ['Case reports', ' AND PUB_TYPE:"case reports"'], guide: ['Guidelines', ' AND (PUB_TYPE:"guideline" OR TITLE:guideline OR TITLE:consensus)'], reviews: ['Reviews', ' AND (PUB_TYPE:"review" OR PUB_TYPE:"systematic review")'], all: ['All', ''] };
  routes.lit = async (_, params) => {
    const q = params.q || '', f = LIT[params.f] ? params.f : 'cases';
    view().innerHTML = `${bar('Literature')}
      <form class="search" data-form="lit">${icon('search')}<input name="q" value="${esc(q)}" placeholder="e.g. annular lichen planus histology" enterkeyhint="search"></form>
      <div class="chips" style="margin-top:8px">${Object.entries(LIT).map(([k, [l]]) => `<button class="chip ${k === f ? 'on' : ''}" data-act="go" data-to="lit?q=${encodeURIComponent(q)}&f=${k}">${l}</button>`).join('')}</div>
      <div class="card list" id="lit-out" style="margin-top:8px">${q ? '<div class="busy"><span class="spin"></span>Searching Europe PMC…</div>' : '<div class="empty">' + icon('book') + '<b>Search PubMed and more</b>Free, through Europe PMC.</div>'}</div>`;
    $('[data-form=lit]').addEventListener('submit', (e) => { e.preventDefault(); go(`lit?q=${encodeURIComponent(e.target.q.value.trim())}&f=${f}`, { replace: true }); });
    if (!q) return;
    try {
      const rs = await L.epmc(`(${q})${LIT[f][1]}`, 20); $('#lit-out').innerHTML = rs.length ? L.reportsHtml(rs) : '<div class="empty"><b>Nothing found</b>Try fewer words.</div>';
      if (rs.length) keep({ id: 'lit-' + f + '-' + q.toLowerCase().slice(0, 80), at: Date.now(), kind: 'notes', title: `Literature: ${q}`, sub: `${LIT[f][0]} · ${rs.length} results`, data: { reports: rs, link: `lit?q=${encodeURIComponent(q)}&f=${f}` } });
    } catch (e) { $('#lit-out').innerHTML = `<div class="note bad">${esc(e.message)}</div>`; }
  };
})();
