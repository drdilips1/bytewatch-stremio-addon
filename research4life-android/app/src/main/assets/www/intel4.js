// DermScholar Intel, part 4 (from the "DermaSynth" brief): evidence pyramid of any search,
// citation graph of a paper, dermatology pipeline tracker, histopathology side-by-side, and a
// richer photo → literature search (similar published images, case reports, treatment, mechanism).
(() => {
  'use strict';
  const D = window.DS;
  const I = window.DSI;
  const { $, esc, icon, md, toast, store, go, render, actions, ext } = D;
  const view = $('#view');
  const { obj, S } = I;
  const OA = D.hasNative ? '/proxy/openalex/' : 'https://api.openalex.org/';
  const miniCard = I.miniCard;

  // ================================================================ M2: evidence pyramid
  const TIERS = [
    ['gl', '📋', 'Guidelines & consensus', '(PUB_TYPE:"Practice Guideline" OR PUB_TYPE:"Guideline" OR TITLE:"consensus" OR TITLE:"guideline" OR TITLE:"guidelines")'],
    ['sr', '🧮', 'Systematic reviews & meta-analyses', '(PUB_TYPE:"Systematic Review" OR PUB_TYPE:"Meta-Analysis")'],
    ['rct', '🎯', 'Randomised controlled trials', '(PUB_TYPE:"Randomized Controlled Trial")'],
    ['obs', '👥', 'Cohort, case-control & other trials', '((PUB_TYPE:"Clinical Trial" OR PUB_TYPE:"Observational Study" OR TITLE_ABS:"cohort" OR TITLE_ABS:"case-control" OR TITLE_ABS:"cross-sectional") NOT PUB_TYPE:"Randomized Controlled Trial" NOT PUB_TYPE:"Meta-Analysis" NOT PUB_TYPE:"Systematic Review")'],
    ['case', '🔎', 'Case reports & series', '(PUB_TYPE:"Case Reports" OR TITLE:"case report" OR TITLE:"case series")'],
    ['op', '💬', 'Narrative reviews & opinion', '((PUB_TYPE:"Review" OR PUB_TYPE:"Editorial" OR PUB_TYPE:"Comment" OR PUB_TYPE:"Letter") NOT PUB_TYPE:"Systematic Review" NOT PUB_TYPE:"Meta-Analysis")'],
  ];
  const COLORS = ['#7c3aed', '#2563eb', '#0d9488', '#16a34a', '#d97706', '#64748b'];
  async function renderPyramid(_, p) {
    const f = D.filtersFrom(p);
    const open = p.t || '';
    view.innerHTML = `${D.topbar('Evidence pyramid')}
      <p class="small"><b>${esc(f.q)}</b></p>
      <p class="muted small">Everything Europe PMC has for this search, sorted by level of evidence. Tap a level to see its best papers.</p>
      <div id="pyr">${D.skeletons(3)}</div>`;
    const base = D.buildQuery(f);
    const res = await Promise.all(TIERS.map(([, , , tq]) => D.epmcSearch(`(${base}) AND ${tq}`, { size: 5, sort: f.sort === 'newest' ? 'P_PDATE_D desc' : f.sort === 'cited' ? 'CITED desc' : '' }).catch(() => ({ hit: 0, results: [] }))));
    const el = $('#pyr');
    if (!el) return;
    const counts = res.map((r) => r.hit || 0);
    // Pyramid: narrow at the top (strongest evidence), wide at the bottom.
    const W = 320, rowH = 38;
    const svg = `<svg viewBox="0 0 ${W} ${TIERS.length * rowH}" class="pyr-svg" role="img" aria-label="Evidence pyramid">${TIERS.map(([k, e], i) => {
      const top = 40 + i * ((W - 60) / TIERS.length), bot = 40 + (i + 1) * ((W - 60) / TIERS.length);
      const y0 = i * rowH, y1 = y0 + rowH - 3;
      return `<g data-act="pyr-tier" data-t="${k}" class="${open === k ? 'on' : ''}"><polygon points="${(W - top) / 2},${y0} ${(W + top) / 2},${y0} ${(W + bot) / 2},${y1} ${(W - bot) / 2},${y1}" fill="${COLORS[i]}" opacity="${open && open !== k ? 0.45 : 0.92}"/>
        <text x="${W / 2}" y="${y0 + rowH / 2 + 4}" text-anchor="middle" fill="#fff" font-size="13" font-weight="700">${e} ${counts[i].toLocaleString()}</text></g>`;
    }).join('')}</svg>`;
    el.innerHTML = `<div class="panel pyr">${svg}</div>
      ${TIERS.map(([k, e, label], i) => `<div class="pyr-row ${open === k ? 'open' : ''}"><button class="pyr-h" data-act="pyr-tier" data-t="${k}"><i style="background:${COLORS[i]}"></i><b>${e} ${esc(label)}</b><span>${counts[i].toLocaleString()}</span></button>
        ${open === k ? (res[i].results.map((a) => D.card(a)).join('') || '<p class="muted small">None.</p>') + (counts[i] > 5 ? `<button class="btn small full" data-act="pyr-all" data-t="${k}">${icon('search')}All ${counts[i].toLocaleString()}</button>` : '') : ''}</div>`).join('')}
      <button class="btn full" data-act="ev-from-search" data-q="${esc(f.q)}" style="margin-top:12px">${icon('chart')}Evidence map with AI synthesis</button>`;
    actions['pyr-tier'] = (b) => go('pyramid?' + new URLSearchParams({ ...p, t: open === b.dataset.t ? '' : b.dataset.t }), { replace: true });
    actions['pyr-all'] = (b) => { const t = TIERS.find((x) => x[0] === b.dataset.t); go(D.searchHash({ ...f, derm: false, q: `(${base}) AND ${t[3]}` })); };
  }
  const prevSearchTop = ext.searchTop;
  ext.searchTop = (question) => {
    const prev = prevSearchTop ? prevSearchTop(question) : '';
    if (!question || /^(10\.\d|pmid|pmc\d|\d{5,9}$)/i.test(question.trim())) return prev;
    return prev + `<button class="chip pyr-chip" data-act="pyr-open" data-q="${esc(question)}">🔺 Evidence pyramid</button>`;
  };
  actions['pyr-open'] = (b) => {
    const cur = D.current.params || {};
    go('pyramid?' + new URLSearchParams({ ...cur, q: b.dataset.q }));
  };

  // ================================================================ M5: citation graph
  const STANCE = obj({ items: { type: 'array', items: obj({ n: { type: 'integer' }, stance: { type: 'string', enum: ['supports', 'extends', 'contradicts', 'mentions'] }, why: S.str }) } });
  const STANCE_UI = { supports: ['🟢', 'Supports'], extends: ['🔵', 'Extends'], contradicts: ['🔴', 'Contradicts'], mentions: ['⚪', 'Mentions'] };
  const absText = (inv) => {
    if (!inv) return '';
    const words = [];
    for (const [w, pos] of Object.entries(inv)) for (const i of pos) words[i] = w;
    return words.filter(Boolean).join(' ');
  };
  const oaW = (w) => ({ id: String(w.id || '').split('/').pop(), title: w.title || w.display_name || '', year: w.publication_year, doi: (w.doi || '').replace(/^https?:\/\/doi\.org\//, ''), cites: w.cited_by_count || 0, abs: absText(w.abstract_inverted_index), venue: w.primary_location?.source?.display_name || '' });
  async function renderCites(id) {
    id = decodeURIComponent(id || '');
    view.innerHTML = `${D.topbar('Citation graph')}<div id="cg">${D.skeletons(3)}</div>`;
    const el = $('#cg');
    let a;
    try { a = await D.findArticle(id); } catch (e) { el.innerHTML = D.errorBox(e, false); return; }
    if (!a.doi) { el.innerHTML = miniCard(a) + '<p class="small">This paper has no DOI, so its citations can\'t be traced.</p>'; return; }
    try {
      const sel = 'id,title,publication_year,doi,cited_by_count,abstract_inverted_index,primary_location';
      const w = await D.getJSON(OA + 'works/doi:' + encodeURIComponent(a.doi));
      const wid = String(w.id).split('/').pop();
      const [citing, top, refs] = await Promise.all([
        D.getJSON(OA + `works?filter=cites:${wid}&sort=publication_year:desc&per_page=40&select=${sel}`),
        D.getJSON(OA + `works?filter=cites:${wid}&sort=cited_by_count:desc&per_page=10&select=${sel}`),
        (w.referenced_works || []).length ? D.getJSON(OA + `works?filter=openalex_id:${w.referenced_works.slice(0, 40).map((u) => u.split('/').pop()).join('|')}&sort=cited_by_count:desc&per_page=12&select=${sel}`) : Promise.resolve({ results: [] }),
      ]);
      const recent = (citing.results || []).map(oaW);
      const landmark = (top.results || []).map(oaW);
      const built = (refs.results || []).map(oaW);
      const byYear = (w.counts_by_year || []).slice().sort((x, y) => x.year - y.year);
      const maxC = Math.max(1, ...byYear.map((x) => x.cited_by_count));
      const chart = byYear.length ? `<div class="cg-years">${byYear.map((x) => `<div><i style="height:${Math.max(3, (x.cited_by_count / maxC) * 80)}px"></i><b>${x.cited_by_count}</b><span>${String(x.year).slice(2)}</span></div>`).join('')}</div>` : '';
      // Node graph: built-on papers (left) → this paper (centre) → most influential citing papers (right).
      const L = built.slice(0, 6), R = landmark.slice(0, 6);
      const H = Math.max(L.length, R.length, 1) * 46 + 20, Wd = 340, cx = Wd / 2, cy = H / 2;
      const ny = (i, n) => 20 + (i + 0.5) * ((H - 40) / Math.max(n, 1));
      const node = (x, y, r, cls, label, act, did) => `<g class="cg-n ${cls}" ${act ? `data-act="${act}" data-doi="${esc(did)}"` : ''}><circle cx="${x}" cy="${y}" r="${r}"/><text x="${x}" y="${y + r + 11}" text-anchor="middle">${esc(label)}</text></g>`;
      const graph = `<svg viewBox="0 0 ${Wd} ${H + 14}" class="cg-svg">${L.map((x, i) => `<line x1="40" y1="${ny(i, L.length)}" x2="${cx}" y2="${cy}"/>`).join('')}${R.map((x, i) => `<line x1="${cx}" y1="${cy}" x2="${Wd - 40}" y2="${ny(i, R.length)}"/>`).join('')}
        ${L.map((x, i) => node(40, ny(i, L.length), 5 + Math.min(9, Math.log10(x.cites + 1) * 3), 'ref', `${(x.title.split(/\s+/)[0] || '').slice(0, 10)} ${x.year || ''}`, 'cg-open', x.doi)).join('')}
        ${node(cx, cy, 16, 'me', `This paper · ${a.year}`, '', '')}
        ${R.map((x, i) => node(Wd - 40, ny(i, R.length), 5 + Math.min(9, Math.log10(x.cites + 1) * 3), 'cit', `${(x.title.split(/\s+/)[0] || '').slice(0, 10)} ${x.year || ''}`, 'cg-open', x.doi)).join('')}</svg>`;
      const row = (x, extra = '') => `<button class="card" data-act="cg-open" data-doi="${esc(x.doi)}"><p class="title main">${esc(x.title)}</p><div class="byline"><span>${esc(x.venue || '')}${x.year ? ' · ' + x.year : ''} · cited ${x.cites}</span>${extra}</div></button>`;
      el.innerHTML = `${miniCard(a)}
        <div class="stat-row"><div class="stat-tile"><b>${(w.cited_by_count || 0).toLocaleString()}</b><span>citations</span></div><div class="stat-tile"><b>${(w.referenced_works || []).length}</b><span>references</span></div><div class="stat-tile"><b>${w.fwci != null ? Number(w.fwci).toFixed(1) : '—'}</b><span>field-weighted impact</span></div></div>
        <div class="panel svgbox">${graph}<p class="muted small center">Left: papers it built on · Right: most influential papers citing it</p></div>
        ${chart ? `<div class="section"><div class="section-h"><h3>Citations per year</h3></div>${chart}</div>` : ''}
        <div class="section"><div class="section-h"><h3>What came after</h3>${recent.length && D.aiHasKey() ? '<button data-act="cg-stance">AI: supports or contradicts?</button>' : ''}</div><div id="cg-recent">${recent.map((x, i) => row(x, `<span class="cg-st" data-i="${i}"></span>`)).join('') || '<p class="muted small">No citing papers indexed yet.</p>'}</div></div>
        ${landmark.length ? `<div class="section"><div class="section-h"><h3>Most influential citing papers</h3></div>${landmark.map((x) => row(x)).join('')}</div>` : ''}
        ${built.length ? `<div class="section"><div class="section-h"><h3>Built on (most cited references)</h3></div>${built.map((x) => row(x)).join('')}</div>` : ''}
        <p class="muted small">Citation data from OpenAlex.</p>`;
      actions['cg-stance'] = async (b) => {
        b.disabled = true; b.textContent = 'Reading abstracts…';
        const list = recent.slice(0, 25);
        try {
          const doc = `ORIGINAL PAPER: ${a.title}. ${D.stripTags(a.abstract || '').slice(0, 1500)}\n\nCITING PAPERS:\n` + list.map((x, i) => `[${i + 1}] ${x.year} ${x.title}. ${x.abs.slice(0, 600)}`).join('\n\n');
          const r = D.aiJson(await D.ai('For each citing paper, judge from its title and abstract how it relates to the ORIGINAL PAPER: supports (confirms its findings), extends (builds on it, new population/indication/mechanism), contradicts (finds otherwise or raises safety/efficacy doubts), or mentions (only cites it in passing). One short reason each. n is the citing paper number.', { doc, schema: STANCE, max: 3000 }));
          const counts = {};
          for (const it of r.items || []) {
            const s = STANCE_UI[it.stance];
            const slot = document.querySelector(`.cg-st[data-i="${it.n - 1}"]`);
            if (s && slot) { slot.innerHTML = `<span class="badge st-${it.stance}" title="${esc(it.why)}">${s[0]} ${s[1]}</span>`; counts[it.stance] = (counts[it.stance] || 0) + 1; }
          }
          b.textContent = Object.entries(counts).map(([k, n]) => `${STANCE_UI[k][0]} ${n}`).join('  ') || 'Done';
        } catch (e) { b.textContent = 'AI failed'; toast(e.message); }
      };
    } catch (e) { el.innerHTML = miniCard(a) + D.errorBox(e); }
  }
  actions['cg-open'] = (b) => { if (b.dataset.doi) go(D.searchHash({ ...D.filtersFrom({}), q: b.dataset.doi, derm: false })); };
  const prevTools = ext.articleTools;
  ext.articleTools = (a) => (prevTools ? prevTools(a) : '') + (a.doi ? `<div class="row wrap intel-paper"><button class="btn xs" data-act="cg-go" data-id="${esc(a.id)}">${icon('trend')}Citation graph</button></div>` : '');
  actions['cg-go'] = (b) => go('cites/' + encodeURIComponent(b.dataset.id));

  // ================================================================ M4: pipeline tracker
  const CLASSES = {
    il17: ['IL-17 / IL-17R', 'secukinumab OR ixekizumab OR brodalumab OR bimekizumab OR sonelokimab OR izokibep OR IL-17'],
    il23: ['IL-23 / IL-12/23', 'guselkumab OR risankizumab OR tildrakizumab OR mirikizumab OR ustekinumab OR icotrokinra OR IL-23'],
    th2: ['IL-4/IL-13/IL-31/TSLP/OX40', 'dupilumab OR tralokinumab OR lebrikizumab OR nemolizumab OR amlitelimab OR rocatinlimab OR tezepelumab OR IL-13 OR OX40'],
    jak: ['Oral JAK / TYK2', 'upadacitinib OR abrocitinib OR baricitinib OR ritlecitinib OR deuruxolitinib OR deucravacitinib OR povorcitinib OR TYK2 OR JAK inhibitor'],
    topical: ['Topical JAK / PDE4 / AhR', 'ruxolitinib cream OR delgocitinib OR roflumilast OR crisaborole OR tapinarof OR topical JAK'],
    other: ['Other emerging', 'BTK inhibitor OR remibrutinib OR KIT inhibitor OR barzolvolimab OR spesolimab OR IL-36 OR MRGPRX2 OR complement'],
  };
  const DERM_COND = 'psoriasis OR atopic dermatitis OR hidradenitis OR vitiligo OR alopecia areata OR urticaria OR prurigo OR pemphigus OR pemphigoid OR acne OR rosacea OR palmoplantar OR lichen';
  async function ctgov(params) {
    const get = (pp) => D.getJSON(I.api('ctgov', 'studies?' + new URLSearchParams({ format: 'json', pageSize: '20', ...pp })));
    let j;
    try { j = await get(params); } catch (e) { const { sort, ...rest } = params; if (!sort) throw e; j = await get(rest); }
    return { total: j.totalCount ?? (j.studies || []).length, list: (j.studies || []).map(I.trialOf) };
  }
  async function renderPipeline(_, p) {
    const c = CLASSES[p.c] ? p.c : 'jak';
    view.innerHTML = `${D.topbar('Pipeline tracker')}
      <div class="scroll-x" style="margin-bottom:8px">${Object.entries(CLASSES).map(([k, [l]]) => `<button class="chip ${k === c ? 'on' : ''}" data-act="pl-c" data-v="${k}">${esc(l)}</button>`).join('')}</div>
      <div class="section"><div class="section-h"><h3>🏁 Phase 3 readouts (completed, last 2 years)</h3></div><div id="pl-done">${D.skeletons(2)}</div></div>
      <div class="section"><div class="section-h"><h3>🚀 Phase 3 running now</h3></div><div id="pl-live">${D.skeletons(2)}</div></div>
      <div class="section"><div class="section-h"><h3>🧪 Phase 2: next wave</h3></div><div id="pl-p2">${D.skeletons(2)}</div></div>
      <div class="row wrap"><button class="btn small" data-act="intel-go" data-k="alerts">${icon('alert')}FDA label updates</button><button class="btn small" data-act="pl-ev" data-q="${esc(CLASSES[c][0])} dermatology">${icon('chart')}Published evidence</button></div>
      <p class="muted small">From ClinicalTrials.gov, dermatology conditions only. EMA decisions aren't available through an open API.</p>`;
    const [, terms] = CLASSES[c];
    const since = new Date(Date.now() - 730 * 864e5).toISOString().slice(0, 10);
    const fill = (sel, r, empty) => { const el = $(sel); if (el) el.innerHTML = r.list.map(I.trialCard).join('') + (r.total > r.list.length ? `<p class="muted small">${r.list.length} of ${r.total}</p>` : '') || `<p class="muted small">${empty}</p>`; };
    const base = { 'query.cond': DERM_COND, 'query.intr': terms };
    await Promise.all([
      ctgov({ ...base, 'filter.overallStatus': 'COMPLETED', 'filter.advanced': `AREA[Phase](PHASE3) AND AREA[CompletionDate]RANGE[${since},MAX]`, sort: 'CompletionDate:desc' }).then((r) => fill('#pl-done', r, 'No completed phase 3 trials in the last 2 years.')).catch((e) => fill('#pl-done', { list: [], total: 0 }, e.message)),
      ctgov({ ...base, 'filter.overallStatus': 'RECRUITING|ACTIVE_NOT_RECRUITING|NOT_YET_RECRUITING|ENROLLING_BY_INVITATION', 'filter.advanced': 'AREA[Phase](PHASE3)', sort: 'LastUpdatePostDate:desc' }).then((r) => fill('#pl-live', r, 'None running.')).catch((e) => fill('#pl-live', { list: [], total: 0 }, e.message)),
      ctgov({ ...base, 'filter.overallStatus': 'RECRUITING|ACTIVE_NOT_RECRUITING|NOT_YET_RECRUITING|COMPLETED', 'filter.advanced': `AREA[Phase](PHASE2) AND AREA[LastUpdatePostDate]RANGE[${since},MAX]`, sort: 'LastUpdatePostDate:desc', pageSize: '12' }).then((r) => fill('#pl-p2', r, 'None found.')).catch((e) => fill('#pl-p2', { list: [], total: 0 }, e.message)),
    ]);
  }
  actions['pl-c'] = (b) => go('pipeline?c=' + b.dataset.v, { replace: true });
  actions['pl-ev'] = (b) => go(I.evHash(b.dataset.q));

  // ================================================================ M3: histopathology side by side
  const HISTO = obj({ diagnosis: S.str, features: { type: 'array', items: obj({ feature: S.str, visible: { type: 'string', enum: ['yes', 'possibly', 'not seen'] }, note: S.str }) }, differentials: { type: 'array', items: S.str }, caveat: S.str });
  function renderHisto(_, p) {
    const dx = p.dx || '';
    view.innerHTML = `${D.topbar('Histology side by side')}
      <p class="small">Put your slide (or a photo of it) next to published histology of a diagnosis. The AI lists the features to look for and which it can see.</p>
      <input id="hs-dx" placeholder="Diagnosis to compare with, e.g. psoriasis (optional)" value="${esc(dx)}">
      <button class="btn primary full" data-act="hs-pick" style="margin-top:8px">${icon('camera')}Choose slide photo</button>
      <div class="panel small" style="margin-top:10px">${icon('alert')} ${esc(I.EDU || 'Educational use only.')}</div>
      <div id="hs-out"></div>`;
  }
  actions['hs-pick'] = async () => {
    let url;
    try { url = await I.shrink(await I.pickImage(), 1400); } catch (e) { if (!/cancel/i.test(e.message)) toast(e.message); return; }
    const out = $('#hs-out');
    let dx = ($('#hs-dx')?.value || '').trim();
    out.innerHTML = `<div class="hs-grid"><div><small>Your slide</small><img src="${url}" alt="" data-act="hs-zoom"></div><div id="hs-lit"><small>Published</small>${D.skeletons(1)}</div></div><div id="hs-ai">${D.aiHasKey() ? (I.busyHtml ? I.busyHtml('Looking at the slide…') : '') : I.keyCard()}</div>`;
    actions['hs-zoom'] = () => D.lightbox?.(url);
    let r = null;
    if (D.aiHasKey()) {
      try {
        r = D.aiJson(await I.aiImage(`${dx ? `Compare this histology image with the typical histopathology of ${dx}.` : 'Suggest the most likely histopathological diagnosis for this image.'} List the key diagnostic histological features of that diagnosis (6-10, e.g. "Munro microabscesses", "parakeratosis", "basaloid islands with peripheral palisading") and for each say whether it is visible here (yes / possibly / not seen) with a short note. Then 3-5 differentials and one caveat about image limits. Answer as JSON: {"diagnosis","features":[{"feature","visible","note"}],"differentials":[],"caveat"}.`, url,
          'You are a dermatopathology educator teaching a clinician. Describe only what is visible; say when magnification, stain or image quality limits interpretation. Reply with JSON only.'));
        if (!dx) dx = r.diagnosis || '';
      } catch (e) { const el = $('#hs-ai'); if (el) el.innerHTML = I.aiErr(e); }
    }
    if (r) {
      const el = $('#hs-ai');
      const V = { yes: '✅', possibly: '🟡', 'not seen': '⚪' };
      if (el) el.innerHTML = `<div class="panel"><b>${esc(r.diagnosis)}: features to look for</b>
        ${(r.features || []).map((f) => `<div class="hs-f"><span>${V[f.visible] || '⚪'}</span><div><b>${esc(f.feature)}</b><small>${esc(f.note)}</small></div></div>`).join('')}
        ${r.differentials?.length ? `<p class="small"><b>Differentials:</b> ${r.differentials.map(esc).join(' · ')}</p>` : ''}
        <p class="muted small">${esc(r.caveat || '')}</p></div>`;
    }
    const lit = $('#hs-lit');
    if (!dx) { if (lit) lit.innerHTML = '<small>Published</small><p class="muted small">Enter a diagnosis to see published histology.</p>'; return; }
    const imgs = (await I.openI(`${dx} histopathology`)).slice(0, 12);
    if (!lit) return;
    lit.innerHTML = `<small>Published: ${esc(dx)}</small>${imgs.length ? `<img src="${esc(imgs[0].thumb)}" alt="" data-act="hs-big" data-i="0"><div class="hs-thumbs">${imgs.map((m, i) => `<img src="${esc(m.thumb)}" alt="" data-act="hs-big" data-i="${i}">`).join('')}</div><p class="muted small" id="hs-cap">${esc((imgs[0].caption || '').slice(0, 220))}</p>` : '<p class="muted small">No open-access histology found.</p>'}`;
    actions['hs-big'] = (b) => {
      const m = imgs[Number(b.dataset.i)];
      const main = lit.querySelector('img');
      if (main.src === new URL(m.thumb, location.href).href && b === main) { D.lightbox?.(m.src); return; }
      main.src = m.thumb; main.dataset.i = b.dataset.i;
      $('#hs-cap').textContent = (m.caption || '').slice(0, 220) + ' · ' + m.source;
    };
  };

  // ================================================================ M1: photo search, richer results
  actions['vs-pick'] = async () => {
    if (!D.aiHasKey()) { $('#vs-out').innerHTML = I.keyCard(); return; }
    let url;
    try { url = await I.shrink(await I.pickImage(), 1200); } catch (e) { if (!/cancel/i.test(e.message)) toast(e.message); return; }
    const out = $('#vs-out');
    out.innerHTML = `<img class="case-img" src="${url}" alt="">${I.busyHtml ? I.busyHtml('Looking at the photo…') : D.skeletons(2)}`;
    try {
      const text = await I.aiImage('Describe the image in dermatological terms in 3-5 short bullet points (image type, morphology, colour, distribution or dermoscopic/histological pattern). Then list the 3 most likely diagnoses. '
        + 'End with exactly one line: "SEARCH: diagnosis1; diagnosis2; diagnosis3" using short literature search phrases (diagnosis names only).', url,
      'You are a dermatology educator helping a clinician search the literature. Describe only what is visible; say when the quality limits interpretation. Markdown.');
      const terms = (text.match(/SEARCH:\s*(.+)/i)?.[1] || '').split(/[;,]/).map((x) => x.trim()).filter(Boolean).slice(0, 3);
      const t0 = terms[0] || '';
      out.innerHTML = `<div class="hs-grid"><div><small>Your photo</small><img src="${url}" alt=""></div><div id="vs-imgs"><small>Published images${t0 ? ': ' + esc(t0) : ''}</small>${t0 ? D.skeletons(1) : ''}</div></div>
        <div class="panel synth">${md(text.replace(/SEARCH:.*$/im, ''))}</div>
        <div class="scroll-x">${terms.map((t, i) => `<button class="chip ${i === 0 ? 'on' : ''}" data-act="vs-dx" data-q="${esc(t)}">${esc(t)}</button>`).join('')}</div>
        <div id="vs-res"></div>`;
      const load = async (dx) => {
        const box = $('#vs-res');
        if (!box) return;
        box.innerHTML = D.skeletons(3);
        const f0 = { ...D.filtersFrom({}), q: dx, derm: true };
        const [cases, best] = await Promise.all([
          D.epmcSearch(`(${D.buildQuery(f0)}) AND (PUB_TYPE:"Case Reports" OR TITLE:"case report" OR TITLE:"case series")`, { size: 5 }).catch(() => ({ results: [] })),
          D.epmcSearch(`(${D.buildQuery(f0)}) AND (PUB_TYPE:"Practice Guideline" OR PUB_TYPE:"Systematic Review" OR PUB_TYPE:"Meta-Analysis" OR PUB_TYPE:"Randomized Controlled Trial")`, { size: 4 }).catch(() => ({ results: [] })),
        ]);
        if (!$('#vs-res')) return;
        box.innerHTML = `<div class="section"><div class="section-h"><h3>🔎 Similar case reports</h3></div>${cases.results.map((a) => D.card(a)).join('') || '<p class="muted small">None found.</p>'}</div>
          <div class="section"><div class="section-h"><h3>💊 Treatment evidence</h3><button data-act="ev-from-search" data-q="${esc('treatment of ' + dx)}">Evidence map</button></div>${best.results.map((a) => D.card(a)).join('') || '<p class="muted small">None found.</p>'}</div>
          <div class="row wrap"><button class="btn small" data-act="ev-from-search" data-q="${esc('pathogenesis and immunology of ' + dx)}">${icon('bulb')}Mechanism / pathway</button>
            <button class="btn small" data-act="pyr-open" data-q="${esc(dx)}">🔺 Evidence pyramid</button><button class="btn small" data-act="case-lit" data-q="${esc(dx)}">${icon('camera')}More images</button></div>`;
      };
      actions['vs-dx'] = (b) => { document.querySelectorAll('[data-act=vs-dx]').forEach((x) => x.classList.toggle('on', x === b)); load(b.dataset.q); };
      if (t0) {
        load(t0);
        const imgs = (await I.openI(t0)).slice(0, 8);
        const box = $('#vs-imgs');
        if (box) box.innerHTML = `<small>Published images: ${esc(t0)}</small>${imgs.length ? `<div class="hs-thumbs big">${imgs.map((m) => `<img src="${esc(m.thumb)}" alt="" data-act="vs-big" data-src="${esc(m.src)}">`).join('')}</div>` : '<p class="muted small">No open-access images found.</p>'}`;
      }
    } catch (e) { out.innerHTML = I.aiErr(e); }
  };
  actions['vs-big'] = (b) => D.lightbox?.(b.dataset.src);

  // ================================================================ tools, routes
  I.TOOLS.splice(0, 0,
    ['pipeline', '🧬', 'Pipeline tracker', 'Phase 3 readouts · running · next wave'],
    ['histo', '🔬', 'Histology side by side', 'Your slide vs published · features to find']);
  Object.assign(ext.routes, { pyramid: renderPyramid, cites: renderCites, pipeline: renderPipeline, histo: renderHisto });
})();
