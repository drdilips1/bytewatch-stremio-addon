// DermScholar Intel, part 2: the research workspace. Paper → Research Project, Research Gap Radar,
// paper comparison, drug intelligence, dermatology image search with differential-diagnosis and
// histopathology learning modes, and My Research notebooks. Builds on intel.js (window.DSI).
(() => {
  // ---------------------------------------------------------------- approved uses at a glance (from the FDA label, no AI)
  const DERM = /dermatitis|eczema|psoria|vitiligo|alopecia|hidradenitis|urticaria|acne|rosacea|pemphig|lupus|melanoma|basal cell|squamous cell|skin|prurigo|itch|pruritus|scleroderma|dermatomyositis|keratos|hyperhidrosis|wart|herpes|zoster|onychomycosis|tinea|scabies|mastocytosis|lichen/i;
  function indications(text) {
    const t = String(text || '').replace(/^\s*\d*\s*INDICATIONS? (AND|&) USAGE\s*/i, '').replace(/\(\s*\d+(\.\d+)*\s*\)/g, ' ').replace(/\s+/g, ' ');
    const out = [];
    for (const raw of t.split(/(?<=\.)\s+(?=[A-Z])/)) {
      if (/^limitations? of use/i.test(raw) || !/indicated/i.test(raw)) continue;
      let x = raw.replace(/^.*?\bindicated\s+(for\s+(the\s+)?(treatment|management|prevention|reduction)\s+of\s+|for\s+(use\s+)?(in\s+)?|as\s+|in\s+)/i, '').replace(/\.$/, '').trim();
      if (!x) continue;
      const m = x.match(/^(.*?)\s+with\s+(.*?)(?:\s+(who|whose|that|when|in whom|after|and who)\s+(.*))?$/i);
      const who = m ? m[1] : '';
      const cond = m ? m[2] : x;
      const rest = m && m[4] ? (m[3] + ' ' + m[4]) : '';
      out.push({ cond: cond.replace(/^(the\s+)/i, ''), who: who.replace(/^(the\s+)?treatment of\s+/i, ''), rest, derm: DERM.test(cond) && !/arthritis/i.test(cond) });
    }
    return out.sort((a, b) => b.derm - a.derm);
  }
  function glance(text) {
    const list = indications(text);
    if (!list.length) return '';
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    const short = (s, n) => (s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '…' : s);
    return `<div class="panel glance"><div class="label">${icon('check')}Approved uses at a glance <span class="muted small">FDA label</span></div>
      ${list.map((x) => `<div class="glance-row${x.derm ? ' derm' : ''}"><b>${esc(cap(short(x.cond, 110)))}</b>
        <span>${esc([x.who && cap(short(x.who, 70)), x.rest && short(x.rest, 120)].filter(Boolean).join(' · '))}</span></div>`).join('')}</div>`;
  }

  'use strict';
  const D = window.DS;
  const I = window.DSI;
  const { $, $$, esc, icon, md, sheet, closeSheet, toast, store, go, render, actions, ext, Native } = D;
  const view = $('#view');
  const { obj, S } = I;
  const uid = () => Math.random().toString(36).slice(2, 10);

  // ================================================================ image AI (vision)
  const imgWait = {};
  let imgSeq = 0;
  ext.events.imagePicked = (evt) => { const f = imgWait[evt.id]; delete imgWait[evt.id]; if (f) f(evt); };
  function pickImage() {
    return new Promise((resolve, reject) => {
      if (!Native.pickImage) {
        // Browser fallback (development): a file input.
        const inp = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
        inp.onchange = () => { const f = inp.files[0]; if (!f) return reject(new Error('cancelled')); const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(f); };
        inp.click();
        return;
      }
      const id = 'img' + (++imgSeq);
      imgWait[id] = (evt) => (evt.error ? reject(new Error(evt.error)) : resolve(evt.dataUrl));
      Native.pickImage(id);
    });
  }
  const aiImgWait = {};
  ext.onAiOther = (evt) => { const f = aiImgWait[evt.id]; delete aiImgWait[evt.id]; if (f) f(evt); };
  function aiImage(task, dataUrl, system) {
    return new Promise((resolve, reject) => {
      if (!D.aiHasKey()) { reject(new Error('NO_KEY')); return; }
      if (!Native.aiRunImage) {
        const text = window.__aiMock ? window.__aiMock(task, null, '') : 'Image AI needs the Android app';
        setTimeout(() => resolve(text), 200);
        return;
      }
      const id = 'vis' + (++imgSeq) + '_' + Date.now();
      aiImgWait[id] = (evt) => (evt.state === 'done' ? resolve(evt.text) : reject(new Error(evt.message || 'AI request failed')));
      Native.aiRunImage(id, system, task, dataUrl, 3500);
    });
  }
  const EDU = 'Educational use only: this is a learning aid for clinicians, not a diagnosis. Diagnosis needs clinical examination and, where appropriate, histopathology.';

  // ================================================================ My Research notebooks
  const projects = () => store.get('projects', []);
  const saveProjects = (list) => store.set('projects', list);
  const project = (id) => projects().find((p) => p.id === id);
  function updateProject(id, fn) {
    const list = projects();
    const p = list.find((x) => x.id === id);
    if (!p) return null;
    fn(p);
    p.updated = Date.now();
    saveProjects(list);
    return p;
  }
  function newProject(title, extra = {}) {
    const p = { id: uid(), title: title || 'Untitled project', question: '', papers: [], quotes: [], notes: [], questions: [], tables: [], trials: [], protocol: '', manuscript: '', created: Date.now(), updated: Date.now(), ...extra };
    saveProjects([p, ...projects()]);
    return p;
  }

  function renderResearch() {
    const list = projects();
    view.innerHTML = `${D.topbar('My research')}
      <p class="muted small">Projects keep papers, quotes, tables, AI notes, research questions, protocol, manuscript and trials together. The project AI reads all of it.</p>
      <button class="btn primary full" data-act="proj-new">${icon('plus')}New project</button>
      <div class="section">${list.map((p) => `<button class="proj-card" data-act="proj-open" data-id="${p.id}"><b>${esc(p.title)}</b>
        <span>${p.papers.length} papers · ${p.notes.length} notes · ${p.questions.length} questions${p.trials.length ? ' · ' + p.trials.length + ' trials' : ''}</span>
        <small>Updated ${new Date(p.updated).toLocaleDateString()}</small></button>`).join('') || '<div class="empty">' + icon('folder') + '<b>No projects yet</b><div>Start one here, or with “Research project” on any paper.</div></div>'}</div>`;
  }
  actions['proj-new'] = () => {
    sheet(`<h3>New research project</h3><input id="pj-title" placeholder="e.g. Oral minoxidil in female pattern hair loss"><textarea id="pj-q" rows="3" placeholder="Research question (optional)"></textarea>
      <button class="btn primary full" data-act="proj-create" style="margin-top:8px">Create</button>`);
  };
  actions['proj-create'] = () => {
    const t = $('#pj-title').value.trim();
    if (!t) { toast('Give it a title'); return; }
    const p = newProject(t, { question: $('#pj-q').value.trim() });
    closeSheet(true);
    go('project/' + p.id);
  };
  actions['proj-open'] = (b) => go('project/' + b.dataset.id);

  const TABS = [['papers', '📄 Papers'], ['quotes', '🔖 Quotes'], ['tables', '📊 Tables'], ['notes', '🧠 AI notes'], ['questions', '🔬 Questions'],
    ['protocol', '📋 Protocol'], ['refs', '📚 References'], ['manuscript', '✍️ Manuscript'], ['trials', '🧪 Trials']];

  async function renderProject(id, p) {
    const pj = project(id);
    if (!pj) { view.innerHTML = D.topbar('Project') + '<div class="empty"><b>Project not found</b></div>'; return; }
    const tab = p.tab || 'papers';
    view.innerHTML = `${D.topbar(pj.title, { right: `<button class="icon-btn" data-act="proj-menu" data-id="${id}" aria-label="More">${icon('dots')}</button>` })}
      ${pj.question ? `<p class="small"><b>Question:</b> ${esc(pj.question)}</p>` : ''}
      <div class="panel"><b>${icon('spark')} Ask the project AI</b><textarea id="pj-ask" rows="2" placeholder="e.g. What do my papers say about relapse after stopping?"></textarea>
        <button class="btn primary full" data-act="proj-ask" data-id="${id}" style="margin-top:6px">Ask</button><div id="pj-out"></div></div>
      <div class="scroll-x">${TABS.map(([k, l]) => `<button class="chip ${k === tab ? 'on' : ''}" data-act="proj-tab" data-id="${id}" data-t="${k}">${l}</button>`).join('')}</div>
      <div id="pj-tab" class="section">${D.skeletons(2)}</div>`;
    drawProjectTab(pj, tab);
  }
  actions['proj-tab'] = (b) => go(`project/${b.dataset.id}?tab=${b.dataset.t}`, { replace: true });
  actions['proj-menu'] = (b) => {
    const id = b.dataset.id;
    sheet(`<h3>Project</h3><button class="opt" data-act="proj-rename" data-id="${id}">${icon('note')}<span>Rename / edit question</span></button>
      <button class="opt" data-act="proj-export" data-id="${id}">${icon('upload')}<span>Export as text</span></button>
      <button class="opt" data-act="proj-delete" data-id="${id}">${icon('trash')}<span>Delete project</span></button>`);
  };
  actions['proj-rename'] = (b) => {
    const pj = project(b.dataset.id);
    sheet(`<h3>Edit project</h3><input id="pj-title" value="${esc(pj.title)}"><textarea id="pj-q" rows="3">${esc(pj.question)}</textarea>
      <button class="btn primary full" data-act="proj-rename-save" data-id="${pj.id}" style="margin-top:8px">Save</button>`);
  };
  actions['proj-rename-save'] = (b) => { updateProject(b.dataset.id, (p) => { p.title = $('#pj-title').value.trim() || p.title; p.question = $('#pj-q').value.trim(); }); closeSheet(true); render(); };
  actions['proj-delete'] = (b) => { saveProjects(projects().filter((p) => p.id !== b.dataset.id)); closeSheet(true); go('research', { replace: true }); };
  actions['proj-export'] = async (b) => {
    const pj = project(b.dataset.id);
    const papers = await Promise.all(pj.papers.map((pid) => D.findArticle(pid).catch(() => null)));
    const txt = [`# ${pj.title}`, pj.question && `Question: ${pj.question}`,
      '## Papers', ...papers.filter(Boolean).map((a, i) => `${i + 1}. ${a.authors} ${a.title}. ${a.journal} ${a.year}.${a.doi ? ' doi:' + a.doi : ''}`),
      '## Quotes', ...pj.quotes.map((x) => `> ${x.text} (${x.src || ''})`),
      '## Notes', ...pj.notes.map((x) => x.text), '## Research questions', ...pj.questions.map((x) => '- ' + (x.question || x)),
      '## Protocol', pj.protocol, '## Manuscript', pj.manuscript, '## Trials', ...pj.trials.map((t) => `- ${t}`)].filter((x) => x !== undefined && x !== '').join('\n\n');
    Native.exportText(pj.title.replace(/[^\w ]+/g, '').slice(0, 40) + '.md', txt);
  };

  async function drawProjectTab(pj, tab) {
    const el = $('#pj-tab');
    const id = pj.id;
    const textArea = (field, ph) => `<textarea id="pj-field" rows="12" placeholder="${esc(ph)}">${esc(pj[field] || '')}</textarea>
      <div class="row wrap" style="margin-top:6px"><button class="btn xs primary" data-act="pj-save-field" data-id="${id}" data-f="${field}">Save</button>
      <button class="btn xs" data-act="pj-ai-field" data-id="${id}" data-f="${field}">${icon('spark')}Draft with AI from the project</button></div>`;
    if (tab === 'papers') {
      const papers = await Promise.all(pj.papers.map((pid) => D.findArticle(pid).catch(() => null)));
      el.innerHTML = `<div class="row wrap"><button class="btn xs" data-act="pj-add-saved" data-id="${id}">${icon('plus')}Add saved papers</button>
        ${pj.papers.length > 1 ? `<button class="btn xs" data-act="pj-compare" data-id="${id}">${icon('chart')}Compare</button>` : ''}
        ${pj.question ? `<button class="btn xs" data-act="pj-gaps" data-id="${id}">${icon('bulb')}Find research gaps</button>` : ''}</div>
        ${papers.filter(Boolean).map((a) => D.card(a, { compact: true }) + `<button class="btn xs" data-act="pj-rm-paper" data-id="${id}" data-p="${esc(a.id)}">${icon('x')}Remove</button>`).join('') || '<p class="muted small">No papers yet. Use “Add to project” on any paper.</p>'}`;
    } else if (tab === 'quotes') {
      el.innerHTML = `<textarea id="pj-new" rows="2" placeholder="Paste a quote"></textarea><input id="pj-src" placeholder="Source (paper, page)">
        <button class="btn xs primary" data-act="pj-add-item" data-id="${id}" data-f="quotes" style="margin-top:6px">Add quote</button>
        ${pj.quotes.map((x, i) => `<blockquote class="pj-item">${esc(x.text)}<small>${esc(x.src || '')}</small><button class="icon-btn" data-act="pj-rm-item" data-id="${id}" data-f="quotes" data-i="${i}">${icon('x')}</button></blockquote>`).join('')}`;
    } else if (tab === 'notes') {
      el.innerHTML = `<textarea id="pj-new" rows="3" placeholder="A note"></textarea><button class="btn xs primary" data-act="pj-add-item" data-id="${id}" data-f="notes" style="margin-top:6px">Add note</button>
        ${pj.notes.map((x, i) => `<div class="pj-item">${md(x.text)}<small>${x.ai ? 'AI note · ' : ''}${new Date(x.at).toLocaleDateString()}</small><button class="icon-btn" data-act="pj-rm-item" data-id="${id}" data-f="notes" data-i="${i}">${icon('x')}</button></div>`).join('')}`;
    } else if (tab === 'tables') {
      el.innerHTML = `${pj.tables.map((t, i) => `<div class="pj-item"><b>${esc(t.title)}</b>${t.html}<button class="icon-btn" data-act="pj-rm-item" data-id="${id}" data-f="tables" data-i="${i}">${icon('x')}</button></div>`).join('') || '<p class="muted small">Comparison tables and evidence matrices you save appear here.</p>'}`;
    } else if (tab === 'questions') {
      el.innerHTML = `<textarea id="pj-new" rows="2" placeholder="A research question"></textarea><button class="btn xs primary" data-act="pj-add-item" data-id="${id}" data-f="questions" style="margin-top:6px">Add</button>
        ${pj.questions.map((x, i) => `<div class="pj-item"><b>${esc(x.question || x)}</b>${x.design ? `<small>${esc(x.design)}</small>` : ''}<button class="icon-btn" data-act="pj-rm-item" data-id="${id}" data-f="questions" data-i="${i}">${icon('x')}</button></div>`).join('')}`;
    } else if (tab === 'protocol') {
      el.innerHTML = textArea('protocol', 'Background, objectives, design, population, outcomes, sample size, statistics, ethics…');
    } else if (tab === 'manuscript') {
      el.innerHTML = textArea('manuscript', 'Title, abstract, introduction, methods, results, discussion…');
    } else if (tab === 'refs') {
      const papers = (await Promise.all(pj.papers.map((pid) => D.findArticle(pid).catch(() => null)))).filter(Boolean);
      const refs = papers.map((a, i) => `${i + 1}. ${D.shortAuthors(a.authors || '')}. ${a.title}. ${a.jAbbr || a.journal}. ${a.year}${a.volume ? ';' + a.volume : ''}${a.issue ? '(' + a.issue + ')' : ''}${a.pages ? ':' + a.pages : ''}.${a.doi ? ' doi:' + a.doi : ''}`);
      el.innerHTML = refs.length ? `<ol class="pj-refs">${refs.map((r) => `<li>${esc(r.replace(/^\d+\. /, ''))}</li>`).join('')}</ol><button class="btn xs" data-act="pj-copy-refs">${icon('quote')}Copy (Vancouver)</button>` : '<p class="muted small">Add papers to build the reference list.</p>';
      actions['pj-copy-refs'] = () => D.copyText(refs.join('\n'));
    } else if (tab === 'trials') {
      el.innerHTML = `<input id="pj-new" placeholder="NCT number, e.g. NCT05123456"><button class="btn xs primary" data-act="pj-add-item" data-id="${id}" data-f="trials" style="margin-top:6px">Add trial</button>
        ${pj.trials.map((t, i) => `<div class="pj-item"><b>${esc(t)}</b><button class="btn xs" data-act="open-trial" data-nct="${esc(t)}">${icon('external')}Open</button><button class="icon-btn" data-act="pj-rm-item" data-id="${id}" data-f="trials" data-i="${i}">${icon('x')}</button></div>`).join('')}`;
    }
  }
  actions['pj-add-item'] = (b) => {
    const v = $('#pj-new')?.value.trim();
    if (!v) return;
    const f = b.dataset.f;
    updateProject(b.dataset.id, (p) => {
      if (f === 'quotes') p.quotes.unshift({ text: v, src: $('#pj-src')?.value.trim() || '' });
      else if (f === 'notes') p.notes.unshift({ text: v, at: Date.now() });
      else if (f === 'questions') p.questions.unshift({ question: v });
      else if (f === 'trials') p.trials.unshift(v.toUpperCase().match(/NCT\d{8}/)?.[0] || v);
    });
    render();
  };
  actions['pj-rm-item'] = (b) => { updateProject(b.dataset.id, (p) => p[b.dataset.f].splice(+b.dataset.i, 1)); render(); };
  actions['pj-rm-paper'] = (b) => { updateProject(b.dataset.id, (p) => { p.papers = p.papers.filter((x) => x !== b.dataset.p); }); render(); };
  actions['pj-save-field'] = (b) => { updateProject(b.dataset.id, (p) => { p[b.dataset.f] = $('#pj-field').value; }); toast('Saved'); };
  actions['pj-add-saved'] = (b) => {
    const pj = project(b.dataset.id);
    const opts = Object.fromEntries([...D.saved.values()].filter((a) => !a.doc && !a.utd).slice(0, 60).map((a) => [a.id, a.title.slice(0, 80)]));
    if (!Object.keys(opts).length) { toast('Save some papers first'); return; }
    D.pickMany('Add saved papers', opts, pj.papers, (ids) => { updateProject(pj.id, (p) => { p.papers = [...new Set(ids)]; }); render(); });
  };
  actions['pj-compare'] = (b) => go('compare?' + new URLSearchParams({ ids: project(b.dataset.id).papers.slice(0, 6).join(','), project: b.dataset.id }));
  actions['pj-gaps'] = (b) => go('gaps?' + new URLSearchParams({ q: project(b.dataset.id).question, project: b.dataset.id }));

  /** Everything in the project, as the AI's document. */
  async function projectText(pj) {
    const papers = (await Promise.all(pj.papers.map((pid) => D.findArticle(pid).catch(() => null)))).filter(Boolean);
    return [`PROJECT: ${pj.title}`, pj.question && `RESEARCH QUESTION: ${pj.question}`,
      ...papers.map((a, i) => `[P${i + 1}] ${D.studyType(a).label} · ${a.jAbbr || a.journal} ${a.year} · ${a.title}. ${D.stripTags(a.abstract || '').slice(0, 1500)}`),
      pj.quotes.length && 'QUOTES:\n' + pj.quotes.map((x) => `"${x.text}" (${x.src})`).join('\n'),
      pj.notes.length && 'NOTES:\n' + pj.notes.map((x) => x.text).join('\n---\n'),
      pj.questions.length && 'RESEARCH QUESTIONS:\n' + pj.questions.map((x) => '- ' + (x.question || x)).join('\n'),
      pj.protocol && 'PROTOCOL DRAFT:\n' + pj.protocol, pj.manuscript && 'MANUSCRIPT DRAFT:\n' + pj.manuscript,
      pj.trials.length && 'TRIALS: ' + pj.trials.join(', ')].filter(Boolean).join('\n\n');
  }
  const PROJECT_SYSTEM = 'You are the research assistant for one dermatology research project. Use the project material (papers [P1], [P2]…, quotes, notes, drafts). '
    + 'Cite papers as [P1]. Never invent data or references; say when something needs a source the project does not have. Markdown with "## " headings and "- " bullets.';
  actions['proj-ask'] = async (b) => {
    const pj = project(b.dataset.id);
    const qtext = $('#pj-ask').value.trim();
    const out = $('#pj-out');
    if (!qtext) return;
    if (I.needKey()) { out.innerHTML = I.keyCard(); return; }
    out.innerHTML = I.busyHtml('Reading the project…');
    try {
      const text = await D.ai(qtext, { doc: await projectText(pj), system: PROJECT_SYSTEM, max: 4000 });
      out.innerHTML = `<div class="synth">${md(text)}</div><button class="btn xs" data-act="pj-keep" data-id="${pj.id}">${icon('note')}Keep as AI note</button>`;
      actions['pj-keep'] = () => { updateProject(pj.id, (p) => p.notes.unshift({ text: `**Q: ${qtext}**\n${text}`, at: Date.now(), ai: true })); toast('Saved to AI notes'); };
    } catch (e) { out.innerHTML = I.aiErr(e); }
  };
  actions['pj-ai-field'] = async (b) => {
    const pj = project(b.dataset.id);
    const f = b.dataset.f;
    if (I.needKey()) { toast('Add an AI key in Settings → AI'); return; }
    const box = $('#pj-field');
    box.value = 'Writing…';
    try {
      const task = f === 'protocol'
        ? 'Draft a study protocol for this project: background and rationale (cite [P1]…), objectives, design, setting, population and eligibility, interventions, outcomes with validated dermatology scales, sample size reasoning with stated assumptions, statistical analysis plan, ethics, limitations. Mark anything the investigator must decide in [square brackets].'
        : 'Draft a manuscript skeleton for this project in the style of a top dermatology journal: title, structured abstract, introduction (cite [P1]…), methods, results placeholders (never invent numbers: use [n=?] style placeholders), discussion, limitations, conclusion.';
      box.value = await D.ai(task, { doc: await projectText(pj), system: PROJECT_SYSTEM, max: 7000 });
    } catch (e) { box.value = 'AI error: ' + e.message; }
  };

  /** "Add to project" from a paper. */
  function addToProjectSheet(paperId, title) {
    const list = projects();
    sheet(`<h3>Add to a research project</h3>${list.map((p) => `<button class="opt" data-act="pj-add-paper" data-id="${p.id}" data-p="${esc(paperId)}">${icon('folder')}<span>${esc(p.title)}<small>${p.papers.length} papers</small></span></button>`).join('')}
      <button class="opt" data-act="pj-add-paper-new" data-p="${esc(paperId)}" data-t="${esc(title.slice(0, 80))}">${icon('plus')}<span>New project from this paper</span></button>`);
  }
  actions['pj-add-paper'] = (b) => { updateProject(b.dataset.id, (p) => { if (!p.papers.includes(b.dataset.p)) p.papers.push(b.dataset.p); }); closeSheet(true); toast('Added to the project'); };
  actions['pj-add-paper-new'] = (b) => { const p = newProject(b.dataset.t, { papers: [b.dataset.p] }); closeSheet(true); go('project/' + p.id); };

  // ================================================================ Paper → Research Project (#rp/<paperId>)
  const RP = obj({
    question: S.str, design: S.str,
    pico: obj({ population: S.str, intervention: S.str, comparator: S.str, outcomes: S.str }),
    sampleSize: S.str, statistics: S.str, limitations: { type: 'array', items: S.str }, topic: S.str,
  });
  const GAPS = obj({
    gaps: { type: 'array', items: obj({ category: { type: 'string', enum: ['Population not studied', 'Missing long-term follow-up', 'No head-to-head comparison', 'Inconsistent outcome measures', 'Conflicting evidence', 'Other'] }, gap: S.str, why: S.str, cites: S.ints }) },
    questions: { type: 'array', items: obj({ question: S.str, design: S.str, feasibility: S.str }) },
  });

  async function renderRP(paperId) {
    view.innerHTML = D.topbar('Research project') + I.busyHtml('Reading the paper…');
    let a;
    try { a = await D.findArticle(paperId); } catch (e) { view.innerHTML = D.topbar('Research project') + D.errorBox(e); return; }
    if (I.needKey()) { view.innerHTML = D.topbar('Research project') + I.keyCard(); return; }
    const ck = 'rp.' + paperId;
    let rp = I.cacheGet(ck);
    try {
      if (!rp) {
        const src = await I.paperText(a);
        rp = D.aiJson(await D.ai('Extract this study as a research project: research question, study design, PICO (population, intervention, comparator, outcomes), '
          + 'sample size and its assumptions (or "not reported"), statistical plan, main limitations, and a short topic phrase (4-8 words) to search the wider literature.',
        { ...src, schema: RP, max: 2500 }));
        I.cacheSet(ck, rp);
      }
    } catch (e) { view.innerHTML = D.topbar('Research project') + I.aiErr(e); return; }
    if (D.current.name !== 'rp') return;
    view.innerHTML = `${D.topbar('Research project')}
      <p class="small muted">${esc(a.title)}</p>
      <div class="panel"><div class="label">${icon('school')}The study</div>
        <div class="kv"><span>Question</span><b>${esc(rp.question)}</b><span>Design</span><b>${esc(rp.design)}</b>
        <span>Population</span><b>${esc(rp.pico.population)}</b><span>Intervention</span><b>${esc(rp.pico.intervention)}</b>
        <span>Comparator</span><b>${esc(rp.pico.comparator)}</b><span>Outcomes</span><b>${esc(rp.pico.outcomes)}</b>
        <span>Sample size</span><b>${esc(rp.sampleSize)}</b><span>Statistics</span><b>${esc(rp.statistics)}</b></div>
        ${rp.limitations?.length ? `<h4>Limitations</h4><ul>${rp.limitations.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>
      <button class="btn primary full" data-act="rp-gaps">${icon('bulb')}What hasn't been answered yet?</button>
      <div id="rp-gaps"></div>`;
    actions['rp-gaps'] = () => gapsFor(rp.topic || rp.question, $('#rp-gaps'), { paper: a, rp });
  }

  /** Searches the literature around a topic and finds research gaps and new questions. */
  async function gapsFor(topic, el, { paper = null, rp = null, projectId = '' } = {}) {
    el.innerHTML = I.busyHtml('Searching the literature for gaps…');
    try {
      const map = await I.gather(topic);
      const refs = I.refsFrom(map);
      const ctx = I.newCtx(refs);
      const r = await I.aiJsonCall(`Topic: ${topic}${rp ? `\nStarting study: ${rp.question} (${rp.design}); PICO: ${JSON.stringify(rp.pico)}` : ''}\n\n`
        + 'Identify research gaps from these sources: populations inadequately studied, missing long-term follow-up, missing head-to-head comparisons, inconsistent outcome measures, conflicting evidence. '
        + 'Each gap with its category, a one-sentence description, why it matters, and the citations showing it. Then propose 5 feasible new research questions, each with a suitable design and a feasibility note (e.g. a single-centre RCT in India).',
      refs, GAPS, 5000);
      el.innerHTML = `<div class="panel synth"><div class="label">${icon('bulb')}Research gaps</div>
        <ul>${r.gaps.map((g) => `<li><span class="tag">${esc(g.category)}</span> <b>${esc(g.gap)}</b> ${I.citeBtns(g.cites, ctx)}<br><span class="small muted">${esc(g.why)}</span></li>`).join('')}</ul>
        <h4>New research questions</h4><ol>${r.questions.map((x, i) => `<li><b>${esc(x.question)}</b><br><span class="small">${esc(x.design)} · ${esc(x.feasibility)}</span>
          <button class="btn xs" data-act="gap-keep" data-i="${i}">${icon('plus')}To a project</button></li>`).join('')}</ol>
        <button class="btn xs" data-act="refs-all" data-ctx="${ctx}">${icon('list')}${refs.length} sources</button></div>`;
      actions['gap-keep'] = (b) => {
        const x = r.questions[+b.dataset.i];
        const list = projects();
        const into = (pid) => { updateProject(pid, (p) => p.questions.unshift({ question: x.question, design: x.design })); closeSheet(true); toast('Added to the project'); };
        if (projectId) { into(projectId); return; }
        sheet(`<h3>Add the question to…</h3>${list.map((p) => `<button class="opt" data-act="gk-into" data-id="${p.id}">${icon('folder')}<span>${esc(p.title)}</span></button>`).join('')}
          <button class="opt" data-act="gk-new">${icon('plus')}<span>New project</span></button>`);
        actions['gk-into'] = (bb) => into(bb.dataset.id);
        actions['gk-new'] = () => { const p = newProject(x.question.slice(0, 80), { question: x.question, questions: [{ question: x.question, design: x.design }], papers: paper ? [paper.id] : [] }); closeSheet(true); go('project/' + p.id); };
      };
    } catch (e) { el.innerHTML = I.aiErr(e); }
  }

  // ================================================================ Research Gap Radar (#gaps)
  const RADAR = obj({
    items: { type: 'array', items: obj({ kind: { type: 'string', enum: ['hot', 'gap', 'controversial', 'emerging', 'neglected'] }, title: S.str, detail: S.str, cites: S.ints }) },
  });
  const KINDS = { hot: '🔥 Hot', gap: '🕳️ Evidence gaps', controversial: '⚔️ Controversial', emerging: '🧪 Emerging', neglected: '💀 Neglected' };

  async function renderGaps(_, p) {
    const topic = p.q || '';
    view.innerHTML = `${D.topbar('Research opportunities')}
      <form class="searchbox compact" data-form="gaps"><textarea name="q" rows="1" placeholder="Topic, or leave empty for all of dermatology">${esc(topic)}</textarea><button class="go" type="submit">${icon('up')}</button></form>
      <div class="scroll-x" style="margin:8px 0">${I.DISEASES.slice(0, 14).map((d) => `<button class="chip ${d === topic ? 'on' : ''}" data-act="gaps-topic" data-v="${esc(d)}">${esc(d)}</button>`).join('')}</div>
      <button class="btn full" data-act="gaps-top20">${icon('bulb')}Top 20 unanswered dermatology questions in ${D.THIS_YEAR}</button>
      <div id="gaps-out" class="section"></div>`;
    actions['gaps-topic'] = (b) => go('gaps?' + new URLSearchParams({ q: b.dataset.v }), { replace: true });
    actions['gaps-top20'] = () => top20();
    if (topic) radar(topic, p.project || '');
  }
  document.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-form=gaps]');
    if (!f) return;
    e.preventDefault();
    go('gaps?' + new URLSearchParams({ q: f.q.value.trim() }), { replace: true });
  });

  /** Publications per year (growth signals what's hot). */
  async function trend(topic) {
    const years = Array.from({ length: 6 }, (_, i) => D.THIS_YEAR - 5 + i);
    const counts = await Promise.all(years.map(async (y) => (await I.epmc(I.q(topic, { extra: `PUB_YEAR:${y}` }), 1)).hit || 0));
    return years.map((y, i) => ({ y, n: counts[i] }));
  }

  async function radar(topic, projectId) {
    const el = $('#gaps-out');
    if (I.needKey()) { el.innerHTML = I.keyCard(); return; }
    el.innerHTML = I.busyHtml('Mapping the research landscape…');
    try {
      const [tr, reviews, recent, trialsRes] = await Promise.all([
        trend(topic),
        I.epmc(I.q(topic, { types: ['meta', 'sr'], years: 5 }), 15),
        I.epmc(I.q(topic, { years: 2, sort: 'P_PDATE_D desc' }), 12),
        I.trials(I.trialTerm(topic), { size: 10 }),
      ]);
      const refs = [];
      for (const a of [...reviews.results, ...recent.results]) if (!refs.some((r) => r.a?.id === a.id)) refs.push({ kind: 'paper', a, type: D.studyType(a).label });
      for (const t of trialsRes.list) refs.push({ kind: 'trial', t, type: 'Registered trial' });
      refs.forEach((r, i) => { r.n = i + 1; });
      const ctx = I.newCtx(refs);
      const ck = 'radar.' + topic.toLowerCase();
      let r = I.cacheGet(ck);
      if (!r) {
        r = await I.aiJsonCall(`Topic: ${topic}\nPublications per year: ${tr.map((x) => `${x.y}: ${x.n}`).join(', ')}\n\n`
          + 'Build a research-opportunity radar from these sources: hot (rapidly growing areas), gap (important clinical questions with insufficient evidence; reviews often say "further research is needed"), '
          + 'controversial (conflicting conclusions), emerging (new drugs, devices, technologies in trials), neglected (important problems with surprisingly little research). '
          + '3-5 items per kind, each with a title, one-sentence detail and citations.', refs, RADAR, 5000);
        I.cacheSet(ck, r);
      }
      const max = Math.max(1, ...tr.map((x) => x.n));
      el.innerHTML = `<div class="panel"><div class="label">${icon('trend')}Publications per year</div>
        <div class="bars">${tr.map((x) => `<div><i style="height:${Math.round((x.n / max) * 60) + 4}px"></i><span>${String(x.y).slice(2)}</span><small>${x.n}</small></div>`).join('')}</div></div>
        ${Object.entries(KINDS).map(([k, label]) => {
          const items = r.items.filter((x) => x.kind === k);
          return items.length ? `<div class="panel synth"><div class="label">${label}</div><ul>${items.map((x) => `<li><b>${esc(x.title)}</b> ${I.citeBtns(x.cites, ctx)}<br><span class="small">${esc(x.detail)}</span></li>`).join('')}</ul></div>` : '';
        }).join('')}
        <button class="btn full" data-act="gaps-deep">${icon('bulb')}Turn gaps into research questions</button><div id="gaps-deep"></div>`;
      actions['gaps-deep'] = () => gapsFor(topic, $('#gaps-deep'), { projectId });
    } catch (e) { el.innerHTML = I.aiErr(e); }
  }

  async function top20() {
    const el = $('#gaps-out');
    if (I.needKey()) { el.innerHTML = I.keyCard(); return; }
    const ck = 'top20.' + D.THIS_YEAR + '.' + new Date().getMonth();
    let text = I.cacheGet(ck);
    el.innerHTML = I.busyHtml('Reading recent dermatology reviews…');
    try {
      const r = await I.epmc({ query: `(${D.DERM_FILTER}) AND (PUB_TYPE:"Systematic Review" OR PUB_TYPE:"Meta-Analysis") AND PUB_YEAR:[${D.THIS_YEAR - 1} TO ${D.THIS_YEAR}] AND (ABSTRACT:"further research" OR ABSTRACT:"further studies" OR ABSTRACT:"evidence is limited" OR ABSTRACT:"low certainty" OR ABSTRACT:"well-designed") ${D.NOISE}`, sort: 'CITED desc' }, 40);
      const refs = r.results.map((a, i) => ({ kind: 'paper', a, type: D.studyType(a).label, n: i + 1 }));
      const ctx = I.newCtx(refs);
      if (!text) {
        text = await D.ai(`From these recent dermatology systematic reviews and meta-analyses, list the top 20 unanswered dermatology research questions in ${D.THIS_YEAR}, `
          + 'ranked by clinical importance. For each: the question in bold, why it is unanswered (one sentence), and citations like [3]. Numbered Markdown list.', { doc: I.packText(refs, { abstract: 900 }), system: I.CITE_SYSTEM, max: 6000 });
        I.cacheSet(ck, text);
      }
      el.innerHTML = `<div class="panel synth">${I.citeHtml(md(text), ctx)}<button class="btn xs" data-act="refs-all" data-ctx="${ctx}">${icon('list')}${refs.length} sources</button></div>`;
    } catch (e) { el.innerHTML = I.aiErr(e); }
  }

  // ================================================================ Paper comparison (#compare)
  const CMP = obj({
    studies: { type: 'array', items: obj({ cite: { type: 'integer' }, design: S.str, n: S.str, population: S.str, intervention: S.str, comparator: S.str, followup: S.str, endpoint: S.str, result: S.str, bias: S.str }) },
    why: { type: 'array', items: obj({ factor: S.str, explanation: S.str }) },
    verdict: S.str,
  });
  const compareList = () => store.get('compare', []);
  actions['cmp-add'] = (b) => {
    const l = compareList();
    if (!l.includes(b.dataset.id)) l.push(b.dataset.id);
    store.set('compare', l.slice(-8));
    toast(`${l.length} paper${l.length > 1 ? 's' : ''} to compare${l.length > 1 ? ' · open Intel → Compare' : ''}`);
  };

  async function renderCompare(_, p) {
    const ids = (p.ids ? p.ids.split(',') : compareList()).filter(Boolean);
    view.innerHTML = `${D.topbar('Compare papers')}<div id="cmp">${D.skeletons(2)}</div>`;
    const papers = (await Promise.all(ids.map((id) => D.findArticle(id).catch(() => null)))).filter(Boolean);
    const el = $('#cmp');
    if (papers.length < 2) {
      el.innerHTML = `<div class="empty">${icon('chart')}<b>Pick at least two papers</b><div>Use “Compare” on papers, or add saved papers here.</div></div>
        <button class="btn full" data-act="cmp-pick">${icon('plus')}Choose saved papers</button>`;
      actions['cmp-pick'] = () => {
        const opts = Object.fromEntries([...D.saved.values()].filter((a) => !a.doc && !a.utd).slice(0, 60).map((a) => [a.id, a.title.slice(0, 80)]));
        D.pickMany('Papers to compare', opts, ids, (sel) => { store.set('compare', sel); render(); });
      };
      return;
    }
    el.innerHTML = papers.map((a, i) => `<div class="small"><b>${i + 1}.</b> ${esc(a.title)} <span class="muted">(${esc(a.jAbbr || a.journal)} ${esc(a.year)})</span></div>`).join('')
      + `<div class="row wrap" style="margin:8px 0"><button class="btn xs" data-act="cmp-clear">${icon('x')}Clear list</button></div><div id="cmp-out">${I.busyHtml('Comparing…')}</div>`;
    actions['cmp-clear'] = () => { store.set('compare', []); go('compare', { replace: true }); };
    if (I.needKey()) { $('#cmp-out').innerHTML = I.keyCard(); return; }
    const refs = papers.map((a, i) => ({ kind: 'paper', a, type: D.studyType(a).label, n: i + 1 }));
    const ctx = I.newCtx(refs);
    try {
      const docs = await Promise.all(papers.map(I.paperText));
      const doc = papers.map((a, i) => `[${i + 1}] ${refs[i].type} · ${a.title} · ${a.jAbbr || a.journal} ${a.year}\n${(docs[i].doc || D.stripTags(a.abstract || '')).slice(0, 6000)}`).join('\n\n');
      const r = D.aiJson(await D.ai('Compare these studies side by side: design, N, population, intervention, comparator, follow-up, primary endpoint, main result (with numbers), risk of bias (low/moderate/high with the reason). '
        + 'Then explain why they reach different conclusions (population, design, dose, endpoint, follow-up, statistics, bias) and give an overall verdict.', { doc, system: I.CITE_SYSTEM, schema: CMP, max: 5000 }));
      const rows = [['Design', 'design'], ['N', 'n'], ['Population', 'population'], ['Intervention', 'intervention'], ['Comparator', 'comparator'], ['Follow-up', 'followup'], ['Endpoint', 'endpoint'], ['Result', 'result'], ['Bias', 'bias']];
      const tableHtml = `<div class="matrix-wrap"><table class="matrix"><thead><tr><th></th>${r.studies.map((s) => `<th>Study ${s.cite}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(([l, k]) => `<tr><td><b>${l}</b></td>${r.studies.map((s) => `<td>${esc(s[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      $('#cmp-out').innerHTML = `<div class="panel">${tableHtml}</div>
        <div class="panel synth"><div class="label">${icon('alert')}Why do they differ?</div><ul>${r.why.map((x) => `<li><b>${esc(x.factor)}:</b> ${esc(x.explanation)}</li>`).join('')}</ul>
        <div class="label" style="margin-top:10px">Verdict</div><p>${I.citeHtml(esc(r.verdict), ctx)}</p></div>
        ${p.project ? `<button class="btn xs" data-act="cmp-save">${icon('plus')}Save table to the project</button>` : ''}`;
      actions['cmp-save'] = () => { updateProject(p.project, (pj) => pj.tables.unshift({ title: 'Comparison: ' + papers.map((a) => a.title.slice(0, 30)).join(' vs '), html: tableHtml })); toast('Saved to the project'); };
    } catch (e) { $('#cmp-out').innerHTML = I.aiErr(e); }
  }

  // ================================================================ Drug intelligence (#drug?name=)
  const DRUGS = ['Upadacitinib', 'Abrocitinib', 'Baricitinib', 'Ritlecitinib', 'Dupilumab', 'Tralokinumab', 'Lebrikizumab', 'Nemolizumab', 'Secukinumab', 'Bimekizumab',
    'Ixekizumab', 'Guselkumab', 'Risankizumab', 'Tildrakizumab', 'Adalimumab', 'Ustekinumab', 'Deucravacitinib', 'Apremilast', 'Spesolimab', 'Omalizumab', 'Ruxolitinib', 'Isotretinoin', 'Methotrexate', 'Minoxidil', 'Spironolactone'];

  async function renderDrug(_, p) {
    const name = (p.name || '').trim();
    view.innerHTML = `${D.topbar('Drug intelligence')}
      <form class="searchbox compact" data-form="drug"><textarea name="q" rows="1" placeholder="Drug name, e.g. upadacitinib">${esc(name)}</textarea><button class="go" type="submit">${icon('up')}</button></form>
      <div class="scroll-x" style="margin:8px 0">${DRUGS.map((d) => `<button class="chip ${d.toLowerCase() === name.toLowerCase() ? 'on' : ''}" data-act="drug-pick" data-v="${d}">${d}</button>`).join('')}</div>
      <div id="drug-out"></div>`;
    actions['drug-pick'] = (b) => go('drug?' + new URLSearchParams({ name: b.dataset.v }), { replace: true });
    if (name) drugDossier(name);
  }
  document.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-form=drug]');
    if (!f) return;
    e.preventDefault();
    go('drug?' + new URLSearchParams({ name: f.q.value.trim() }), { replace: true });
  });

  const fdaGet = async (path) => { try { return await D.getJSON(I.api('fda', path)); } catch { return null; } };
  const first = (x) => (Array.isArray(x) ? x[0] : x) || '';
  async function drugDossier(name) {
    const el = $('#drug-out');
    el.innerHTML = I.busyHtml('Gathering the label, safety reports, trials and evidence…');
    const g = encodeURIComponent(`"${name.toLowerCase()}"`);
    const [label, faers, rx, rcts, reviews, guides, latest, tr] = await Promise.all([
      fdaGet(`drug/label.json?search=openfda.generic_name:${g}+openfda.brand_name:${g}&limit=1`),
      fdaGet(`drug/event.json?search=patient.drug.openfda.generic_name:${g}&count=patient.reaction.reactionmeddrapt.exact&limit=12`),
      (async () => { try { return await D.getJSON(I.api('rxnav', 'rxcui.json?name=' + encodeURIComponent(name))); } catch { return null; } })(),
      I.epmc(I.q(name, { types: ['rct'] }), 8),
      I.epmc(I.q(name, { types: ['meta', 'sr'] }), 6),
      I.epmc(I.q(name, { extra: I.GUIDE }), 4),
      I.epmc(I.q(name, { years: 1, sort: 'P_PDATE_D desc' }), 6),
      I.trials(name, { size: 10 }),
    ]);
    if (D.current.name !== 'drug') return;
    const L = label?.results?.[0] || null;
    const sec = (k) => D.stripTags(first(L?.[k]));
    const fdaSections = L ? [
      ['Indications', sec('indications_and_usage')], ['Mechanism', sec('mechanism_of_action')], ['Boxed warning', sec('boxed_warning')],
      ['Warnings', sec('warnings_and_cautions') || sec('warnings')], ['Pregnancy & lactation', sec('pregnancy') || sec('use_in_specific_populations')],
      ['Interactions', sec('drug_interactions')], ['Dosing', sec('dosage_and_administration')], ['Adverse reactions', sec('adverse_reactions')],
    ].filter(([, v]) => v) : [];
    const reactions = faers?.results || [];
    const refs = [];
    if (L) refs.push({ kind: 'label', n: 0, type: 'FDA label', label: L });
    for (const a of [...guides.results, ...reviews.results, ...rcts.results, ...latest.results]) if (!refs.some((r) => r.a?.id === a.id)) refs.push({ kind: 'paper', a, type: D.studyType(a).label });
    for (const t of tr.list) refs.push({ kind: 'trial', t, type: 'Registered trial' });
    refs.forEach((r, i) => { r.n = i + 1; });
    const ctx = I.newCtx(refs.filter((r) => r.kind !== 'label'));
    const brand = (L?.openfda?.brand_name || []).join(', ');
    el.innerHTML = `<div class="panel"><div class="label">${icon('spark')}${esc(name)}</div>
        <div class="kv"><span>Brand</span><b>${esc(brand || '—')}</b><span>FDA label</span><b>${L ? 'Yes · updated ' + esc(String(L.effective_time || '').replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')) : 'Not found (may not be US-approved)'}</b>
        <span>RxNorm</span><b>${esc(rx?.idGroup?.rxnormId?.[0] || '—')}</b><span>Route</span><b>${esc((L?.openfda?.route || []).join(', ') || '—')}</b>
        <span>Trials</span><b>${tr.total || 0} registered</b></div></div>
      ${glance(sec('indications_and_usage'))}
      <div id="drug-ai"></div>
      ${reactions.length ? `<div class="panel"><div class="label">${icon('alert')}FDA adverse-event reports (FAERS)</div>
        <div class="faers">${reactions.map((r) => `<div><span>${esc(r.term.toLowerCase())}</span><i style="width:${Math.round((r.count / reactions[0].count) * 100)}%"></i><small>${r.count.toLocaleString()}</small></div>`).join('')}</div>
        <p class="muted small">Spontaneous reports: they show what was reported, not how often it happens or whether the drug caused it.</p></div>` : ''}
      ${fdaSections.length ? '<h4 style="margin:14px 0 6px">Full FDA label</h4>' : ''}
      ${fdaSections.map(([t, v]) => `<details class="panel"><summary><b>${esc(t)}</b> <span class="muted small">FDA label</span></summary><p class="small">${esc(v.slice(0, 2500))}${v.length > 2500 ? '…' : ''}</p></details>`).join('')}
      <div class="section"><div class="section-h"><h3>📋 Guidelines</h3></div>${guides.results.map((a) => D.card(a, { compact: true })).join('') || '<p class="muted small">None found.</p>'}</div>
      <div class="section"><div class="section-h"><h3>🎯 RCTs (${rcts.hit})</h3></div>${rcts.results.slice(0, 4).map((a) => D.card(a, { compact: true })).join('')}</div>
      <div class="section"><div class="section-h"><h3>🧪 Trials</h3></div>${tr.list.slice(0, 5).map(I.trialCard).join('') || '<p class="muted small">None found.</p>'}</div>
      <div class="section"><div class="section-h"><h3>🆕 Latest</h3></div>${latest.results.slice(0, 4).map((a) => D.card(a, { compact: true })).join('')}</div>`;
    const ai = $('#drug-ai');
    if (I.needKey()) { ai.innerHTML = I.keyCard(); return; }
    ai.innerHTML = I.busyHtml('Writing the dossier…');
    const ck = 'drug.' + name.toLowerCase();
    let text = I.cacheGet(ck);
    try {
      if (!text) {
        const labelText = fdaSections.map(([t, v]) => `${t.toUpperCase()}: ${v.slice(0, 1800)}`).join('\n');
        const doc = (labelText ? `[L] FDA LABEL (${name})\n${labelText}\n\n` : '') + (reactions.length ? `[F] FAERS top reported reactions: ${reactions.map((r) => `${r.term} (${r.count})`).join(', ')}\n\n` : '')
          + I.packText(refs.filter((r) => r.kind !== 'label'), { abstract: 700 });
        text = await D.ai(`Write a dermatology drug dossier for ${name}: mechanism; regulatory status and approved indications (dermatology first); dermatology trial evidence with numbers; comparative effectiveness; `
          + 'safety signals (label warnings and FAERS, with the FAERS caveat); pregnancy and lactation; monitoring; important interactions; what guidelines say; latest developments and ongoing trials. '
          + 'Cite the label as [L], FAERS as [F] and papers/trials by number like [3]. Markdown with "## " headings.', { doc, system: I.CITE_SYSTEM.replace('numbered sources', 'numbered sources, the FDA label [L] and FAERS [F]'), max: 6000 });
        I.cacheSet(ck, text);
      }
      ai.innerHTML = `<div class="panel synth">${I.citeHtml(md(text), ctx)}<p class="muted small">Label from openFDA (US). Always check your local prescribing information.</p></div>`;
    } catch (e) { ai.innerHTML = I.aiErr(e); }
  }

  // ================================================================ Images (#images?q=&kind=)
  const IMG_KINDS = { clinical: 'Clinical', dermoscopy: 'Dermoscopy', histo: 'Histopathology' };
  async function openI(query) {
    try {
      const j = await D.getJSON(I.api('openi', 'search?' + new URLSearchParams({ query, m: '1', n: '24', it: 'g,ph,mc' })));
      return (j.list || []).map((x) => ({
        src: 'https://openi.nlm.nih.gov' + (x.imgLarge || x.imgThumbLarge || x.imgThumb),
        thumb: 'https://openi.nlm.nih.gov' + (x.imgThumb || x.imgThumbLarge || x.imgLarge),
        caption: D.stripTags(x.image?.caption || x.title || ''), source: 'Open-i (NLM) · ' + (x.journal_title || x.pmcid || 'PMC open access'),
        license: x.license || 'Open-access article figure', pmcid: x.pmcid || '',
      }));
    } catch { return []; }
  }
  async function commons(query) {
    try {
      const p = new URLSearchParams({ action: 'query', generator: 'search', gsrsearch: `filetype:bitmap ${query}`, gsrnamespace: '6', gsrlimit: '20', prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '320', format: 'json', origin: '*' });
      const j = await D.getJSON(I.api('commons', 'api.php?' + p));
      return Object.values(j.query?.pages || {}).map((pg) => {
        const ii = pg.imageinfo?.[0] || {};
        const meta = ii.extmetadata || {};
        return { src: ii.url, thumb: ii.thumburl || ii.url, caption: D.stripTags(meta.ImageDescription?.value || pg.title.replace(/^File:/, '')).slice(0, 300),
          source: 'Wikimedia Commons', license: D.stripTags(meta.LicenseShortName?.value || ''), page: ii.descriptionurl };
      }).filter((x) => x.src);
    } catch { return []; }
  }

  async function renderImages(_, p) {
    const query = (p.q || '').trim();
    const kind = IMG_KINDS[p.kind] ? p.kind : 'clinical';
    view.innerHTML = `${D.topbar('Dermatology images')}
      <form class="searchbox compact" data-form="images"><textarea name="q" rows="1" placeholder="e.g. lichen planus pigmentosus">${esc(query)}</textarea><button class="go" type="submit">${icon('up')}</button></form>
      <div class="seg wide" style="margin:8px 0">${Object.entries(IMG_KINDS).map(([k, l]) => `<button class="${k === kind ? 'on' : ''}" data-act="img-kind" data-v="${k}">${l}</button>`).join('')}</div>
      <div class="row wrap"><button class="btn xs" data-act="img-ddx" ${query ? '' : 'disabled'}>${icon('school')}What looks similar?</button>
        <button class="btn xs" data-act="img-upload">${icon('camera')}My image: histopathology / clinical learning</button>
        ${query ? `<button class="btn xs" data-act="ev-dermnet" data-q="${esc(query)}">${icon('globe')}DermNet</button>` : ''}</div>
      <p class="muted small">${esc(EDU)}</p>
      <div id="img-ddx"></div><div id="img-grid">${query ? D.skeletons(2) : ''}</div>`;
    actions['img-kind'] = (b) => go('images?' + new URLSearchParams({ q: query, kind: b.dataset.v }), { replace: true });
    actions['img-ddx'] = () => ddx(query);
    actions['img-upload'] = () => uploadMode();
    if (!query) return;
    const suffix = { clinical: 'skin clinical', dermoscopy: 'dermoscopy', histo: 'histopathology' }[kind];
    // Each source shows its pictures as soon as it answers (8-second limit each); repeat searches are instant.
    const key = kind + '|' + query.toLowerCase();
    const all = [];
    window.__imgs = all;
    let pending = 2;
    const draw = () => {
      const grid = $('#img-grid');
      if (!grid || D.current.name !== 'images') return;
      grid.innerHTML = all.length ? `<div class="img-grid">${all.map((x, i) => `<button class="img-cell" data-act="img-open" data-i="${i}"><img loading="lazy" decoding="async" src="${esc(x.thumb)}" alt=""><span>${esc(x.source.split(' · ')[0])}</span></button>`).join('')}</div>
        ${pending ? '<p class="muted small">Loading more…</p>' : '<p class="muted small">Images from NLM Open-i (figures of open-access articles) and Wikimedia Commons, with their licences. Tap for the caption and source.</p>'}`
        : pending ? D.skeletons(2) : '<div class="empty"><b>No images found</b><div>Try DermNet, or other words.</div></div>';
    };
    const cached = imgCache.get(key);
    if (cached) { all.push(...cached); pending = 0; draw(); return; }
    const limit = (p) => Promise.race([p, new Promise((r) => setTimeout(() => r([]), 8000))]);
    const add = (list) => { all.push(...list); pending--; draw(); if (!pending && all.length) imgCache.set(key, all.slice()); };
    limit(commons(`${query} ${kind === 'histo' ? 'histopathology' : kind === 'dermoscopy' ? 'dermoscopy' : ''}`)).then(add);
    limit(openI(`${query} ${suffix}`)).then(add);
  }
  const imgCache = new Map();
  document.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-form=images]');
    if (!f) return;
    e.preventDefault();
    const kind = new URLSearchParams(location.hash.split('?')[1] || '').get('kind') || 'clinical';
    go('images?' + new URLSearchParams({ q: f.q.value.trim(), kind }), { replace: true });
  });
  actions['img-open'] = (b) => {
    const list = (window.__imgs || []).map((x) => ({ src: x.src, label: x.source, caption: `${x.caption}${x.license ? ' · Licence: ' + x.license : ''}` }));
    D.lightbox(list, +b.dataset.i);
  };

  const DDX = obj({
    condition: S.str,
    differentials: { type: 'array', items: obj({ name: S.str, clinical: S.str, dermoscopy: S.str, histopathology: S.str, distinguisher: S.str }) },
    pearls: { type: 'array', items: S.str },
  });
  async function ddx(query) {
    const el = $('#img-ddx');
    if (I.needKey()) { el.innerHTML = I.keyCard(); return; }
    el.innerHTML = I.busyHtml('Building the differential…');
    try {
      const reviews = await I.epmc(I.q(query + ' differential diagnosis', { types: ['review'] }), 6);
      const refs = reviews.results.map((a, i) => ({ kind: 'paper', a, type: D.studyType(a).label, n: i + 1 }));
      const ctx = I.newCtx(refs);
      const r = I.cacheGet('ddx.' + query.toLowerCase()) || D.aiJson(await D.ai(`Teaching differential diagnosis for: ${query}. List the conditions that can look similar (up to 8). For each: distinguishing clinical features, dermoscopic differences, `
        + 'histopathological differences and the single best distinguishing clue. Add 3-5 clinical pearls. Use the reviews provided where relevant (cite like [2]) and standard dermatology knowledge otherwise.',
      { doc: I.packText(refs, { abstract: 800 }), system: 'You are a dermatology educator. ' + EDU, schema: DDX, max: 5000 }));
      I.cacheSet('ddx.' + query.toLowerCase(), r);
      el.innerHTML = `<div class="panel synth"><div class="label">${icon('school')}Looks like ${esc(r.condition || query)}?</div>
        <div class="matrix-wrap"><table class="matrix"><thead><tr><th>Condition</th><th>Clinical</th><th>Dermoscopy</th><th>Histopathology</th><th>Key clue</th></tr></thead>
        <tbody>${r.differentials.map((x) => `<tr data-act="img-search" data-v="${esc(x.name)}"><td><b>${esc(x.name)}</b></td><td>${I.citeHtml(esc(x.clinical), ctx)}</td><td>${esc(x.dermoscopy)}</td><td>${esc(x.histopathology)}</td><td>${esc(x.distinguisher)}</td></tr>`).join('')}</tbody></table></div>
        ${r.pearls?.length ? `<h4>Pearls</h4><ul>${r.pearls.map((x) => `<li>${I.citeHtml(esc(x), ctx)}</li>`).join('')}</ul>` : ''}
        <p class="muted small">Tap a row to see its images. ${esc(EDU)}</p></div>`;
    } catch (e) { el.innerHTML = I.aiErr(e); }
  }
  actions['img-search'] = (b) => go('images?' + new URLSearchParams({ q: b.dataset.v, kind: 'clinical' }));

  /** Upload a clinical, dermoscopy or histopathology image for an educational, evidence-linked walkthrough. */
  function uploadMode() {
    sheet(`<h3>Image learning mode</h3><p class="small">Choose a photo of a histopathology slide, a paper figure, a dermoscopy image or a clinical photo (with the patient's consent and no identifying features).</p>
      <div class="seg wide">${Object.entries(IMG_KINDS).map(([k, l], i) => `<button class="${i === 2 ? 'on' : ''}" data-act="up-kind" data-v="${k}">${l}</button>`).join('')}</div>
      <input id="up-ctx" placeholder="Clinical context (optional), e.g. 45F, itchy violaceous papules on wrists" style="margin-top:8px">
      <button class="btn primary full" data-act="up-pick" style="margin-top:8px">${icon('camera')}Choose the image</button>
      <p class="muted small">${esc(EDU)}</p>`);
    let kind = 'histo';
    actions['up-kind'] = (b) => { kind = b.dataset.v; $$('[data-act=up-kind]').forEach((x) => x.classList.toggle('on', x === b)); };
    actions['up-pick'] = async () => {
      const context = $('#up-ctx').value.trim();
      let dataUrl;
      try { dataUrl = await pickImage(); } catch { return; }
      closeSheet(true);
      go('imgread');
      setTimeout(() => readImage(dataUrl, kind, context), 50);
    };
  }
  async function readImage(dataUrl, kind, context) {
    view.innerHTML = `${D.topbar('Image learning mode')}<img class="up-img" src="${dataUrl}" alt=""><div id="up-out">${I.busyHtml('Looking at the image…')}</div>`;
    const steps = kind === 'histo'
      ? 'Organize as: Clinical diagnosis to consider → Histological findings (describe what is visible: epidermis, dermis, infiltrate, pattern) → Differential diagnosis → Immunohistochemistry / special stains that would help → What to read.'
      : kind === 'dermoscopy'
        ? 'Organize as: Dermoscopic structures and pattern visible → Most likely diagnoses → Differential diagnosis with distinguishing dermoscopic features → What would confirm it (biopsy, histopathology) → What to read.'
        : 'Organize as: Morphology (primary lesion, colour, distribution, configuration) → Differential diagnosis with distinguishing features → What would confirm it (dermoscopy, biopsy, tests) → What to read.';
    try {
      const text = await aiImage(`${steps}${context ? '\nClinical context given: ' + context : ''}\nEnd with a short line of 3-5 search phrases for the literature, starting "SEARCH:".`, dataUrl,
        `You are a dermatology and dermatopathology educator teaching a clinician. Describe only what is visible and say when the image quality limits interpretation. ${EDU} Markdown with "## " headings.`);
      const search = (text.match(/SEARCH:\s*(.+)/i)?.[1] || '').split(/[;,]/).map((x) => x.trim()).filter(Boolean).slice(0, 5);
      $('#up-out').innerHTML = `<div class="panel synth">${md(text.replace(/SEARCH:.*$/im, ''))}<p class="muted small">${esc(EDU)}</p></div>
        ${search.length ? `<div class="section"><div class="section-h"><h3>Key references</h3></div><div class="row wrap">${search.map((s) => `<button class="chip" data-act="ev-from-search" data-q="${esc(s)}">${icon('chart')}${esc(s)}</button>`).join('')}</div></div>` : ''}`;
    } catch (e) { $('#up-out').innerHTML = I.aiErr(e); }
  }

  // ================================================================ hooks into intel.js and the paper page
  I.TILES.splice(4, 0,
    ['drug', '💊', 'Drug intelligence', 'Label · FAERS safety · trials · evidence'],
    ['gaps', '🔭', 'Research gaps', 'Hot · gaps · controversial · emerging · neglected'],
    ['research', '🧠', 'My research', 'Projects · notes · protocol · manuscript'],
    ['compare', '⚖️', 'Compare papers', 'Side by side, and why they differ']);
  const img = I.TILES.find((t) => t[0] === 'images');
  if (img) img[3] = 'Clinical · dermoscopy · histopathology';

  const prevExtra = ext.articleExtra;
  ext.articleExtra = (a) => (prevExtra ? prevExtra(a) : '') + `<div class="row wrap intel-paper">
    <button class="btn xs" data-act="paper-rp" data-id="${esc(a.id)}">${icon('bulb')}Build research project</button>
    <button class="btn xs" data-act="paper-proj" data-id="${esc(a.id)}" data-t="${esc(a.title.slice(0, 80))}">${icon('folder')}Add to project</button>
    <button class="btn xs" data-act="cmp-add" data-id="${esc(a.id)}">${icon('chart')}Compare</button></div>`;
  actions['paper-rp'] = (b) => go('rp/' + encodeURIComponent(b.dataset.id));
  actions['paper-proj'] = (b) => addToProjectSheet(b.dataset.id, b.dataset.t);

  Object.assign(ext.routes, {
    research: renderResearch, project: renderProject, rp: renderRP, gaps: renderGaps, compare: renderCompare,
    drug: renderDrug, images: renderImages, imgread: () => {},
  });
})();
