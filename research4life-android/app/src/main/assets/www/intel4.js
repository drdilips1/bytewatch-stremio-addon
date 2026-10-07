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
  // The image viewer takes a list of {src, label, caption} and a position.
  const zoom = (src, label = 'Image', caption = '') => D.lightbox?.([{ id: 'z', kind: 'fig', src, label, caption }], 0);
  // Each screen remembers its latest request; slower earlier responses are dropped.
  const seq = {};
  const ticket = (k) => { seq[k] = (seq[k] || 0) + 1; const n = seq[k]; return () => seq[k] === n; };

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
    const live = ticket('pyr');
    const res = await Promise.all(TIERS.map(([, , , tq]) => D.epmcSearch(`(${base}) AND ${tq}`, { size: 5, sort: f.sort === 'newest' ? 'P_PDATE_D desc' : f.sort === 'cited' ? 'CITED desc' : '' }).catch(() => ({ hit: 0, results: [] }))));
    const el = $('#pyr');
    if (!el || !live()) return;
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
    const live = ticket('pl');
    const since = new Date(Date.now() - 730 * 864e5).toISOString().slice(0, 10);
    const fill = (sel, r, empty) => { const el = $(sel); if (el && live()) el.innerHTML = r.list.map(I.trialCard).join('') + (r.total > r.list.length ? `<p class="muted small">${r.list.length} of ${r.total}</p>` : '') || `<p class="muted small">${empty}</p>`; };
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
    actions['hs-zoom'] = () => zoom(url, 'Your slide');
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
      if (main.src === new URL(m.thumb, location.href).href && b === main) { zoom(m.src, dx, `${m.caption || ''} · ${m.source}`); return; }
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
        const live = ticket('vs');
        const box = $('#vs-res');
        if (!box) return;
        box.innerHTML = D.skeletons(3);
        const f0 = { ...D.filtersFrom({}), q: dx, derm: true };
        const [cases, best] = await Promise.all([
          D.epmcSearch(`(${D.buildQuery(f0)}) AND (PUB_TYPE:"Case Reports" OR TITLE:"case report" OR TITLE:"case series")`, { size: 5 }).catch(() => ({ results: [] })),
          D.epmcSearch(`(${D.buildQuery(f0)}) AND (PUB_TYPE:"Practice Guideline" OR PUB_TYPE:"Systematic Review" OR PUB_TYPE:"Meta-Analysis" OR PUB_TYPE:"Randomized Controlled Trial") AND ${I.TREAT}`, { size: 4 }).catch(() => ({ results: [] })),
        ]);
        if (!$('#vs-res') || !live()) return;
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
  actions['vs-big'] = (b) => zoom(b.dataset.src, 'Published image');

  // ================================================================ C1: consensus meter (yes/no questions)
  const YESNO = /^(does|do|did|is|are|was|were|can|could|should|will|would|has|have|had|may|might)\b/i;
  const VERDICT = obj({ summary: S.str, items: { type: 'array', items: obj({ n: { type: 'integer' }, answer: { type: 'string', enum: ['yes', 'possibly', 'mixed', 'no', 'not relevant'] }, finding: S.str }) } });
  const ANS = { yes: ['Yes', '#16a34a'], possibly: ['Possibly', '#65a30d'], mixed: ['Mixed', '#d97706'], no: ['No', '#dc2626'] };
  const weightOf = (a) => {
    const t = D.studyType(a).label || '';
    const w = /meta|systematic/i.test(t) ? 3 : /guideline|consensus/i.test(t) ? 3 : /RCT|randomi/i.test(t) ? 2.5 : /cohort|case-control|observational|trial/i.test(t) ? 1.5 : /case/i.test(t) ? 0.5 : 1;
    const q = D.quality ? D.quality(a) : {};
    return w * (q.cited ? 1.2 : 1) * (q.pop && q.pop !== 'Human' ? 0.5 : 1);
  };
  async function renderMeter(_, p) {
    const question = (p.q || '').trim();
    const pick = p.a || '';
    view.innerHTML = `${D.topbar('Consensus meter')}<p class="small"><b>${esc(question)}</b></p><div id="cm">${D.skeletons(3)}</div>`;
    const el = $('#cm');
    if (!question) { el.innerHTML = '<div class="empty"><b>Ask a yes/no question</b></div>'; return; }
    if (!D.aiHasKey()) { el.innerHTML = I.keyCard(); return; }
    const live = ticket('cm');
    const key = 'meter6.' + question.toLowerCase();
    let data = I.cacheGet(key);
    if (!data) {
      try {
        // The same planned searches and papers as the Evidence Map (intel.js evidencePool), so
        // both screens read the same evidence; the 20 most relevant studies with abstracts.
        const steps = [];
        if (live()) el.innerHTML = I.busyHtml('Planning the searches…');
        const pool = await I.evidencePool(question, { size: 20, onStep: (st) => { steps.push(st); if (live()) el.innerHTML = I.stepsHtml(steps) + I.busyHtml('Searching…'); } });
        const yesno = pool.plan.yesno || (YESNO.test(question) ? question : '');
        if (!yesno) {
          if (live()) el.innerHTML = `<div class="empty">${icon('chart')}<b>This question isn't a yes/no one</b><div>The Evidence map answers it, from the same papers.</div></div>
            <button class="btn primary full" data-act="ev-from-search" data-q="${esc(question)}">${icon('chart')}Open the evidence map</button>`;
          return;
        }
        const papers = pool.papers;
        if (!papers.length) { if (live()) el.innerHTML = '<div class="empty"><b>No studies with abstracts found</b></div>'; return; }
        if (live()) el.innerHTML = I.stepsHtml(pool.steps, { read: papers.length }) + I.busyHtml(`Reading ${papers.length} studies…`);
        const doc = papers.map((a, i) => `[${i + 1}] ${D.studyType(a).label || 'Study'} · ${a.jAbbr || a.journal} ${a.year} · ${a.title}. ${I.absShort(a)}`).join('\n\n');
        const r = D.aiJson(await D.ai(`QUESTION: ${yesno}\nFor each numbered paper, say what THAT PAPER says about the question, from its findings or its own statements and conclusions (a review stating the answer as established counts):\n`
          + '- "yes": the paper supports or states yes (including "X is a well-established …", "X is classified as …").\n'
          + '- "possibly": the paper leans yes but hedges ("may", "suggests", "partly", "has features of", small or preliminary data).\n'
          + '- "mixed": it reports evidence both ways, or the answer depends on subgroup/definition.\n'
          + '- "no": it supports or states no.\n'
          + '- "not relevant": it does not address the question at all.\n'
          + 'Do not downgrade a clear statement to "possibly" just because the paper is a review or doesn\'t test it directly. '
          + 'Judge each paper against the question as asked: when the question is general (e.g. diet) and a paper finds no effect for one specific factor (e.g. chocolate) while others matter, that is "mixed" or "possibly", not "no"; use "no" only when the paper concludes the answer to the question itself is no. '
          + 'Give the key finding or statement in under 20 words with numbers if reported. Every paper must get an item. Then one or two sentences answering the question from the relevant papers, leading with the majority answer and the key numbers. Never count or mention papers that are not relevant. n is the paper number.',
          { doc, system: 'You are a meticulous dermatology evidence analyst. Classify each paper by what its abstract says about the question.', schema: VERDICT, max: 4000 }));
        data = { yesno, steps: pool.steps, retrieved: pool.retrieved, eligible: pool.total, summary: r.summary || '', rows: (r.items || []).filter((x) => papers[x.n - 1]).map((x) => ({ ...x, a: papers[x.n - 1] })) };
        I.cacheSet(key, data);
      } catch (e) { if (live()) el.innerHTML = I.aiErr(e); return; }
    }
    if (!live()) return;
    const rel = data.rows.filter((x) => ANS[x.answer]);
    const tot = rel.reduce((s0, x) => s0 + weightOf(x.a), 0) || 1;
    const share = Object.fromEntries(Object.keys(ANS).map((k) => [k, rel.filter((x) => x.answer === k).reduce((s0, x) => s0 + weightOf(x.a), 0) / tot]));
    const count = (k) => rel.filter((x) => x.answer === k).length;
    const shown = (pick ? rel.filter((x) => x.answer === pick) : rel).slice().sort((x, y) => weightOf(y.a) - weightOf(x.a));
    el.innerHTML = `${data.yesno && data.yesno.toLowerCase() !== question.toLowerCase() ? `<p class="muted small" style="margin:-4px 0 8px">Answering: <b>${esc(data.yesno)}</b></p>` : ''}
      <div id="cm-head"></div>
      ${data.steps?.length ? I.stepsHtml(data.steps, { read: data.rows.length, done: true, retrieved: data.retrieved, eligible: data.eligible }) : ''}
      <div class="panel meter">
        <div class="meter-bar">${Object.entries(ANS).map(([k, [l, c]]) => share[k] ? `<button style="width:${(share[k] * 100).toFixed(1)}%;background:${c}" data-act="cm-pick" data-a="${k}" class="${pick && pick !== k ? 'dim' : ''}" aria-label="${l}">${share[k] > 0.08 ? count(k) : ''}</button>` : '').join('')}</div>
        <div class="meter-legend">${Object.entries(ANS).map(([k, [l, c]]) => `<button data-act="cm-pick" data-a="${k}" class="${pick === k ? 'on' : ''}"><i style="background:${c}"></i>${l} <b>${Math.round(share[k] * 100)}%</b> <small>(${count(k)})</small></button>`).join('')}</div>
        <p class="small" id="cm-sum" style="margin:10px 0 0">${esc(data.summary)}</p>
        <p class="muted small">${rel.length} relevant of ${data.rows.length} studies read. Weighted by design (meta-analyses and RCTs count more, animal/lab studies less) and citations. AI-read from abstracts: check key papers.</p></div>
      ${pick ? '' : '<div id="cm-ex"></div>'}
      <div class="section"><div class="section-h"><h3>${pick ? esc(ANS[pick][0]) + ' · ' + shown.length : 'Studies, strongest first'}</h3>${pick ? '<button data-act="cm-pick" data-a="">Show all</button>' : ''}</div>
        ${shown.map((x) => `<div class="cm-row"><span class="cm-ans" style="background:${ANS[x.answer][1]}">${ANS[x.answer][0]}</span><p class="small"><b>${esc(x.finding)}</b></p>${D.card(x.a)}</div>`).join('')}</div>
      <button class="btn full" data-act="ev-from-search" data-q="${esc(question)}">${icon('chart')}Full evidence map</button>`;
    actions['cm-pick'] = (b) => go('meter?' + new URLSearchParams({ ...p, a: b.dataset.a === pick ? '' : b.dataset.a }), { replace: true });
    if (!pick) explain(question, data, live);
  }

  // The explanation under the meter, as Consensus writes it: a one-line answer, short sections
  // with author-year citations, a table where it helps, and an evidence-strength table. Written
  // from the same papers the meter read.
  const EXPLAIN = () => obj({
    headline: S.str,
    sections: { type: 'array', items: obj({ heading: S.str, paragraphs: { type: 'array', items: S.str },
      table: obj({ caption: S.str, columns: { type: 'array', items: S.str }, rows: { type: 'array', items: { type: 'array', items: S.str } } }) }) },
    claims: { type: 'array', items: obj({ strength: { type: 'string', enum: ['strong', 'moderate', 'limited'] }, claim: S.str, cites: S.ints }) },
  });
  /** The meter and its explanation as an exportable report (Word, slides). */
  function explainReport(question, data, r) {
    const rel = data.rows.filter((x) => ANS[x.answer]);
    const tot = rel.reduce((s0, x) => s0 + weightOf(x.a), 0) || 1;
    const meter = Object.entries(ANS).map(([k, [l]]) => `${l} ${Math.round(rel.filter((x) => x.answer === k).reduce((s0, x) => s0 + weightOf(x.a), 0) / tot * 100)}%`).join(' · ');
    const blocks = [{ h: 'Answer' }, { p: r.headline }, { p: `Consensus meter: ${meter} (${rel.length} relevant studies of ${data.rows.length} read).` }];
    for (const x of r.sections || []) {
      blocks.push({ h: x.heading });
      (x.paragraphs || []).forEach((t) => blocks.push({ p: t }));
      if (x.table?.columns?.length && x.table.rows?.length) blocks.push({ table: x.table });
    }
    if (r.claims?.length) blocks.push({ h: 'Evidence strength' }, { table: { caption: '', columns: ['Strength', 'Claim'], rows: r.claims.map((c) => [(I.STRENGTH[c.strength] || ['', c.strength])[1], c.claim + (c.cites?.length ? ` [${c.cites.join(', ')}]` : '')]) } });
    return { title: data.yesno || question, subtitle: `Evidence summary · ${new Date().toLocaleDateString()}`, blocks };
  }

  async function explain(question, data, live) {
    const el = $('#cm-ex');
    if (!el) return;
    const rows = data.rows.filter((x) => ANS[x.answer]).sort((x, y) => x.n - y.n);
    if (rows.length < 2) return;
    const refs = rows.map((x) => ({ kind: 'paper', a: x.a, type: D.studyType(x.a).label, n: x.n }));
    const ctx = I.newCtx(refs);
    const key = 'explain3.' + question.toLowerCase();
    let r = I.cacheGet(key);
    if (!r) {
      el.innerHTML = I.busyHtml('Writing the explanation…');
      actions['cm-ex-redo'] = () => { store.set('intel.' + key, null); explain(question, data, live); };
      try {
        const doc = rows.map((x) => `[${x.n}] ${D.studyType(x.a).label || 'Study'} · ${x.a.authors ? x.a.authors.split(',')[0] + ' et al.' : ''} ${x.a.jAbbr || x.a.journal} ${x.a.year} · ${x.a.title}. ${I.absShort(x.a, 1000)}`).join('\n\n');
        r = D.aiJson(await D.ai(`QUESTION: ${data.yesno || question}\n\n`
          + 'Explain the answer for a dermatologist, like a concise review, using only these papers:\n'
          + '- headline: one sentence that answers the question directly, with the key number if there is one (e.g. "Genetic inheritance strongly influences psoriasis risk, explaining about 60-70% of susceptibility.").\n'
          + '- sections: 3 to 5, with headings that fit the question (e.g. "Genetic basis", "Twin and family studies", "Mechanisms", "Clinical implications"). Each has 1 or 2 short paragraphs of 2-3 sentences; every claim cites its papers like [3] or [2, 5]. Keep numbers exactly as reported.\n'
          + '- table: in at most two sections, a compact table when it makes things clearer (e.g. genes or loci with their role, or study, design, N and result), cells may cite [n]; otherwise caption "", columns [] and rows [].\n'
          + '- claims: 3 to 5 key claims with their evidence strength (strong: consistent across several good studies; moderate; limited) and the papers that support them.',
          { doc, system: 'You are a careful dermatology evidence writer. Every claim must be supported by the numbered papers and cite them; never add facts that are not in them.', schema: EXPLAIN(), max: 5000 }));
        I.cacheSet(key, r);
      } catch (e) {
        if (live() && $('#cm-ex')) $('#cm-ex').innerHTML = I.aiErr(e) + `<button class="btn xs" data-act="cm-ex-redo" style="margin-top:6px">${icon('spark')}Try again</button>`;
        return;
      }
    }
    if (!live() || !$('#cm-ex')) return;
    const cite = (t) => I.citeHtml(esc(t), ctx);
    const table = (t) => (t && t.columns?.length && t.rows?.length ? `<div class="ex-table"><table><thead><tr>${t.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${t.rows.map((row) => `<tr>${row.map((c) => `<td>${cite(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>${t.caption ? `<p class="muted small">${esc(t.caption)}</p>` : ''}</div>` : '');
    if ($('#cm-head') && r.headline) { $('#cm-head').innerHTML = `<p class="cm-headline">${cite(r.headline)}</p>`; $('#cm-sum')?.remove(); }
    $('#cm-ex').innerHTML = `<div class="panel explain">
        <p class="ex-head">${cite(r.headline || '')}</p>
        ${(r.sections || []).map((x) => `<h4>${esc(x.heading)}</h4>${(x.paragraphs || []).map((t) => `<p>${cite(t)}</p>`).join('')}${table(x.table)}`).join('')}
        ${r.claims?.length ? `<h4>Evidence strength</h4><div class="ex-table"><table><thead><tr><th>Strength</th><th>Claim</th></tr></thead><tbody>
          ${r.claims.map((c) => `<tr><td>${I.strength(c.strength)}</td><td>${cite(c.claim)} ${I.citeBtns(c.cites, ctx)}</td></tr>`).join('')}</tbody></table></div>` : ''}
        <p class="muted small">Written by AI from the ${rows.length} relevant studies above. Tap a reference to see the paper; check key numbers in the papers.</p>
        <div class="row wrap" style="gap:6px"><button class="btn xs" data-act="cm-ex-redo">${icon('spark')}Redo</button> ${I.exportBtns(I.offerExport(() => explainReport(question, data, r), ctx))}</div></div>`;
    actions['cm-ex-redo'] = () => { store.set('intel.' + key, null); explain(question, data, live); };
  }
  // ================================================================ answer first (search)
  // A question on the main search ("treatment options for melasma") is answered before the list
  // of papers: current guidelines and the best studies, as a short cited review with tables.
  const ANSWER = () => obj({
    headline: S.str,
    sections: EXPLAIN().properties.sections,
    guidelines: { type: 'array', items: obj({ text: S.str, cites: S.ints }) },
    claims: EXPLAIN().properties.claims,
    quotes: { type: 'array', items: obj({ n: { type: 'integer' }, quote: S.str }) },
    followups: { type: 'array', items: S.str },
  });
  const answerable = (x) => !!x && x.trim().split(/\s+/).length >= 2 && !/["():]|\b(AND|OR|NOT)\b/.test(x) && !/^(10\.\d|pmid|pmc\d|\d{5,9}$)/i.test(x.trim());
  async function searchAnswer(question, el) {
    if (!answerable(question)) { el.remove(); return; }
    if (!D.aiHasKey()) { el.innerHTML = ''; return; }
    const live = () => el.isConnected;
    const key = 'answer5.' + question.toLowerCase().trim();
    // The answer is written as it comes (like Consensus): searches first (a second or two), then
    // the cited answer streams in; quotes and follow-up suggestions come at its end.
    const splitTail = (t) => { const i = t.search(/\n\s*\**QUOTES:?\**/i); return i < 0 ? { body: t, tail: '' } : { body: t.slice(0, i), tail: t.slice(i) }; };
    const parseTail = (tail) => {
      const quotes = [...tail.matchAll(/\[(\d+)\]\s*[“"](.+?)[”"]/g)].map((m) => ({ n: +m[1], quote: m[2] }));
      const fi = tail.search(/FOLLOW-?UPS:?/i);
      const followups = fi < 0 ? [] : tail.slice(fi).split('\n').slice(1).map((l) => l.replace(/^\s*[-*\d.)]+\s*/, '').trim()).filter((l) => l.length > 8).slice(0, 4);
      return { quotes, followups };
    };
    // The direct answer (first line) large, as Consensus shows it.
    const lead = (html) => html.replace(/<p>/, '<p class="qa-lead">');
    // Retrieved · Eligible · Included, counting up (as Consensus shows them), then each step.
    const big = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'K' : Number(n).toLocaleString());
    const stepsHtml = (steps) => {
      if (!steps) return '';
      const rows = Array.isArray(steps) ? steps : steps.rows || [];
      const tot = Array.isArray(steps) ? null : steps;
      const num = (v) => (v == null ? '<span class="qa-num">…</span>' : `<span class="qa-num" data-to="${v}">0</span>`);
      return `<div class="qa-stats">${tot ? `<div><b>${num(tot.retrieved)}</b><span>Retrieved</span></div><div><b>${num(tot.eligible)}</b><span>Eligible</span></div><div><b>${num(tot.included)}</b><span>Included</span></div>` : ''}</div>
        <div class="muted small qa-steps" style="margin:0 0 8px">${rows.map((x) => `<div>${icon(x.read ? 'book' : 'search')} ${esc(x.label)}${x.hit != null ? ` · <b class="qa-num" data-to="${x.hit}">0</b>` : ''}</div>`).join('')}</div>`;
    };
    // The numbers roll up to their value in about a second.
    const rollUp = () => {
      el.querySelectorAll('.qa-num[data-to]').forEach((n) => {
        const to = +n.dataset.to;
        delete n.dataset.to;
        const t0 = performance.now();
        const tick = (t) => {
          const k = Math.min(1, (t - t0) / 1100);
          n.textContent = big(Math.round(to * (1 - Math.pow(1 - k, 3))));
          if (k < 1 && n.isConnected) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    };
    const frame = (note, steps, inner) => `<div class="panel explain qa">
        <div class="section-h" style="margin:0 0 4px"><h3>${icon('spark')}Answer</h3><span class="muted small qa-note">${note}</span></div>
        ${stepsHtml(steps)}<div class="qa-body">${inner}</div></div>`;
    const render = (text, refs, steps) => {
      if (!live()) return;
      const { body, tail } = splitTail(text);
      const { quotes, followups } = parseTail(tail);
      for (const q of quotes) { const x = refs.find((y) => y.n === q.n); if (x) x.quote = q.quote; }
      const ctx = I.newCtx(refs);
      el.innerHTML = frame(`${refs.length} sources`, steps, lead(I.citeHtml(D.md(body), ctx))).replace(/<\/div>$/, '') + `
        <details class="qa-refs"><summary>References (${refs.length})</summary>${refs.map(I.refRow).join('')}</details>
        <p class="muted small">AI-written from these papers' abstracts (guidelines first). Tap a citation to see its paper; check key numbers in the papers.</p>
        <div class="row wrap" style="gap:6px"><button class="btn xs" data-act="qa-redo">${icon('spark')}Redo</button>
          <button class="btn xs" data-act="ev-from-search" data-q="${esc(question)}">${icon('chart')}Full evidence map</button></div></div>
        <div class="qa-thread"></div>
        <div class="qa-sugg-box"></div>
        <form class="qa-follow" style="display:flex;gap:8px;margin-top:10px"><input name="f" placeholder="Ask a follow-up…" autocomplete="off" style="flex:1"><button class="btn primary">Ask</button></form>`;
      el.querySelectorAll('.qa-num[data-to]').forEach((n) => { n.textContent = big(+n.dataset.to); });
      actions['qa-redo'] = () => { store.set('intel.' + key, null); searchAnswer(question, el); };
      followUps(question, { text: body, followups }, refs, el);
      actions['qa-sugg'] = (b) => { const f = el.querySelector('.qa-follow'); if (!f) return; f.f.value = b.dataset.q; f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event('submit', { cancelable: true })); };
    };
    const kept = I.cacheGet(key);
    if (kept && kept.text && kept.refs) { render(kept.text, kept.refs, kept.steps); return; }

    const yr = new Date().getFullYear();
    el.innerHTML = frame('searching…', { retrieved: null, eligible: null, included: null, rows: [{ label: question }, { label: 'Guidelines and consensus statements, last 6 years' }] }, I.busyHtml('Searching the literature…'));
    // Shaped by what is asked: treatment options only for treatment questions.
    const shape = /\b(treat|treatment|therap|management|manage|drug|dose|regimen|first[- ]line|second[- ]line|options? for)/i.test(question)
      ? 'For treatment: sections such as "First-line", "Second-line / refractory", "Procedures and devices", "Maintenance", "Special situations", and a table (treatment | evidence | key result | notes).'
      : /\b(dermoscop|dermatoscop|trichoscop|onychoscop|capillaroscop)/i.test(question)
        ? 'For dermoscopy: one section per condition with its dermoscopic features, and a table comparing them (condition | structures | vessels | colours | clues). No treatment.'
        : 'Use the sections the question needs (e.g. criteria, features, differentials, investigations, causes, prognosis), with a table where it helps. No treatment section unless asked.';
    try {
      // "New", "latest", "recent", "emerging"…: the last few years only, so the answer is about what is new.
      const recent = /\b(new|newer|newest|latest|recent|recently|emerging|novel|upcoming|update[sd]?|advances?|current trends?|20[2-3]\d)\b/i.test(question);
      const relQuery = `(${I.q(question).query}) AND HAS_ABSTRACT:y NOT SRC:PPR NOT PUB_TYPE:"Case Reports"${recent ? ` AND PUB_YEAR:[${yr - 4} TO ${yr}]` : ''}`;
      const [rel, guides] = await Promise.all([
        I.epmc({ ...I.q(question), query: relQuery }, 14).catch(() => ({ results: [] })),
        I.epmc(I.q(question, { extra: `${I.GUIDE} AND PUB_YEAR:[${yr - 6} TO ${yr}]` }), 5).catch(() => ({ results: [] })),
      ]);
      const seen = new Set();
      const eligible = [...(guides.results || []), ...(rel.results || [])].filter((a) => a.abstract && !seen.has(a.id) && seen.add(a.id));
      const papers = eligible.slice(0, 14);
      const steps = { retrieved: (rel.hit || 0) + (guides.hit || 0), eligible: eligible.length, included: papers.length,
        rows: [{ label: question, hit: rel.hit || 0 }, { label: 'Guidelines and consensus statements, last 6 years', hit: guides.hit || 0 }, { label: 'Read abstracts', hit: papers.length, read: true }] };
      if (papers.length < 2) { if (live()) el.innerHTML = frame('', steps, '<p class="muted small">Not enough papers found to answer this from the literature. Try other words.</p>'); return; }
      const refs = papers.map((a, i) => ({ kind: 'paper', a, type: D.studyType(a).label, n: i + 1 }));
      const ctx = I.newCtx(refs);
      if (live()) { el.innerHTML = frame(`reading ${refs.length} papers…`, steps, I.busyHtml('Writing the answer…')); rollUp(); }
      const doc = refs.map((x) => `[${x.n}] ${x.type || 'Study'} · ${x.a.authors ? x.a.authors.split(',')[0] + ' et al.' : ''} ${x.a.jAbbr || x.a.journal} ${x.a.year} · ${x.a.title}. ${I.absShort(x.a, 600)}`).join('\n\n');
      const text = await D.ai(`QUESTION: ${question}\n\n`
        + 'Answer exactly this question for a dermatologist, like a short up-to-date review, using only these papers (guidelines and consensus statements first; prefer the newest guidance and strongest evidence). '
        + 'The first line must answer the question as asked, including its qualifiers (new, in children, in pregnancy, refractory, first-line…), not a general statement about the topic. '
        + (recent ? 'The question asks what is NEW: lead with the treatments, tests or findings from recent years (name them, with what the newest studies show), and mention the established standard only briefly as context. ' : '')
        + 'Write Markdown:\n'
        + '1. First line: the direct answer in one plain sentence (what to do / what it is), with only its key phrase in **bold** (e.g. "Order an **extended myositis panel** covering the dermatomyositis-specific and overlap antibodies.").\n'
        + '2. A short paragraph (2-3 sentences) explaining it, with the key terms in **bold**.\n'
        + '3. 2 to 4 "## " sections with headings that fit the question, short paragraphs or bullets, and one compact Markdown table where it helps. ' + shape + '\n'
        + '4. If the papers include guidelines or consensus statements: "## Current guidelines" with what they recommend.\n'
        + 'Every claim cites its papers like [3] or [2, 5]; keep numbers exactly as reported; never add facts not in the papers; say plainly where evidence is limited. About 300-450 words. No preamble.\n'
        + 'Then, after the answer, exactly these two blocks:\nQUOTES:\n[n] "the one sentence from paper n\'s abstract that best supports the answer" (for the 5-8 papers you cite most)\nFOLLOWUPS:\n- three short follow-up questions a dermatologist would likely ask next',
        { doc, system: 'You are a careful dermatology evidence writer. Every claim must be supported by the numbered papers and cite them; never add facts that are not in them.', max: 2200, fast: true,
          onPartial: (t) => {
            if (!live()) return;
            const b = el.querySelector('.qa-body');
            if (b) b.innerHTML = lead(I.citeHtml(D.md(splitTail(t).body), ctx));
          } });
      I.cacheSet(key, { text, refs, steps });
      render(text, refs, steps);
    } catch (e) {
      actions['qa-redo'] = () => searchAnswer(question, el);
      if (live()) el.innerHTML = I.aiErr(e) + `<button class="btn xs" data-act="qa-redo" style="margin-top:6px">${icon('spark')}Try again</button>`;
    }
  }
  ext.searchAnswer = searchAnswer;

  /**
   * Follow-up questions under the answer: each is answered from the same papers plus a few found
   * for the follow-up itself, knowing the earlier answer; the thread is kept with the answer.
   */
  function followUps(question, r, refs, el) {
    const tkey = 'thread1.' + question.toLowerCase().trim();
    const thread = I.cacheGet(tkey) || [];
    let all = refs.slice();
    for (const t of thread) for (const x of t.added || []) if (!all.some((y) => y.n === x.n)) all.push(x);
    const box = el.querySelector('.qa-thread');
    const form = el.querySelector('.qa-follow');
    if (!box || !form) return;
    const turnHtml = (t, body) => `<div class="panel explain" style="margin-top:10px"><p class="ex-head">${icon('search')} ${esc(t.q)}</p><div class="qa-a">${body}</div></div>`;
    const answerHtml = (text) => I.citeHtml(D.md(text), I.newCtx(all));
    box.innerHTML = thread.map((t) => turnHtml(t, answerHtml(t.a))).join('');
    // Related questions just above the box: from the answer, then from the latest follow-up.
    const suggBox = el.querySelector('.qa-sugg-box');
    const paintSugg = (list) => {
      // The first suggestion waits in the box (tap Ask to ask it), as Consensus does.
      if (list?.length) { form.f.placeholder = list[0]; form.f.dataset.sugg = list[0]; } else { form.f.placeholder = 'Ask a follow-up…'; form.f.dataset.sugg = ''; }
      if (!suggBox) return;
      suggBox.innerHTML = list?.length ? `<p class="muted small" style="margin:12px 0 6px">Related questions</p><div class="qa-sugg">${list.slice(0, 4).map((f) => `<button class="chip" data-act="qa-sugg" data-q="${esc(f)}" style="text-align:left;white-space:normal">${icon('search')}${esc(f)}</button>`).join('')}</div>` : '';
    };
    paintSugg(thread.length && thread[thread.length - 1].sugg?.length ? thread[thread.length - 1].sugg : r.followups);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const q2 = form.f.value.trim() || (form.f.dataset.sugg || '');
      if (!q2) return;
      form.f.value = '';
      box.insertAdjacentHTML('beforeend', turnHtml({ q: q2 }, I.busyHtml('Answering…')));
      const out = box.lastElementChild.querySelector('.qa-a');
      try {
        // A few papers on the follow-up itself, added to the numbered list.
        const more = await I.epmc(I.q(`${q2} ${question}`.slice(0, 300)), 8).catch(() => ({ results: [] }));
        const added = [];
        for (const a of more.results || []) {
          if (!a.abstract || all.some((x) => x.a?.id === a.id) || added.length >= 6) continue;
          added.push({ kind: 'paper', a, type: D.studyType(a).label, n: all.length + added.length + 1 });
        }
        all = all.concat(added);
        const doc = all.map((x) => `[${x.n}] ${x.type || 'Study'} · ${x.a.authors ? x.a.authors.split(',')[0] + ' et al.' : ''} ${x.a.jAbbr || x.a.journal} ${x.a.year} · ${x.a.title}. ${I.absShort(x.a, 500)}`).join('\n\n');
        const earlier = [r.text ? `Earlier answer: ${String(r.text).slice(0, 1500)}` : `Earlier answer: ${r.headline || ''}`, ...(r.sections || []).map((x) => `${x.heading}: ${(x.paragraphs || []).join(' ').slice(0, 300)}`),
          ...thread.slice(-3).map((t) => `Follow-up "${t.q}": ${String(t.a).slice(0, 500)}`)].join('\n');
        const text = await D.ai(`ORIGINAL QUESTION: ${question}\n${earlier}\n\nFOLLOW-UP QUESTION: ${q2}\n\n`
          + 'Answer the follow-up for a dermatologist in under 250 words, using the numbered papers and citing them like [3] or [2, 5]. '
          + 'Answer exactly what is asked; a table if comparing options. If the papers don\'t cover it, say so plainly, then give what is generally known, marked as not from these papers. Markdown, no preamble.\n'
          + 'After the answer, exactly:\nFOLLOWUPS:\n- three short questions a dermatologist would likely ask next, following on from this follow-up',
          { doc, system: 'You are a careful dermatology evidence writer. Cite the numbered papers for every claim taken from them; never invent studies or numbers.', max: 1500,
            fast: true, onPartial: (t) => { if (out.isConnected) out.innerHTML = answerHtml(t.split(/\n\s*\**FOLLOW-?UPS:?/i)[0]); } });
        const [ans, tail = ''] = text.split(/\n\s*\**FOLLOW-?UPS:?\**/i);
        const sugg = tail.split('\n').map((l) => l.replace(/^\s*[-*\d.)]+\s*/, '').trim()).filter((l) => l.length > 8).slice(0, 4);
        if (out.isConnected) out.innerHTML = answerHtml(ans);
        if (sugg.length) paintSugg(sugg);
        thread.push({ q: q2, a: ans, added, sugg });
        I.cacheSet(tkey, thread);
      } catch (err) {
        if (out.isConnected) out.innerHTML = I.aiErr(err);
      }
    });
  }

  const prevTop2 = ext.searchTop;
  // Any real question gets the meter (it rephrases "Role of X in Y?" as a yes/no question itself).
  const askable = (x) => !!x && (YESNO.test(x.trim()) || /\?\s*$/.test(x) || x.trim().split(/\s+/).length >= 3) && !/^(10\.\d|pmc\d|\d{5,}$)/i.test(x.trim());
  ext.searchTop = (question) => (prevTop2 ? prevTop2(question) : '') + (askable(question)
    ? `<button class="chip pyr-chip" data-act="cm-open" data-q="${esc(question)}">📊 Consensus meter</button>` : '');
  actions['cm-open'] = (b) => go('meter?' + new URLSearchParams({ ...(D.current.params || {}), q: b.dataset.q, a: '' }));

  // ================================================================ tools, routes
  I.TOOLS.splice(0, 0,
    ['pipeline', '🧬', 'Pipeline tracker', 'Phase 3 readouts · running · next wave'],
    ['histo', '🔬', 'Histology side by side', 'Your slide vs published · features to find']);
  Object.assign(ext.routes, { meter: renderMeter, pyramid: renderPyramid, cites: renderCites, pipeline: renderPipeline, histo: renderHisto });
})();
