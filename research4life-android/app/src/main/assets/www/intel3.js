// DermScholar Intel, part 3: clinical summary cards, alerts, living guidelines, systematic review kit
// (PRISMA, meta-analysis, forest plot), private case library, drug monitoring protocols, laser guide,
// CME log, conference radar, author/institution network, library knowledge map, photo search and
// shareable reading lists. Builds on intel.js (window.DSI) and intel2.js.
(() => {
  'use strict';
  const D = window.DS;
  const I = window.DSI;
  const { $, esc, icon, md, sheet, closeSheet, toast, store, go, render, actions, ext, Native } = D;
  const view = $('#view');
  const { obj, S } = I;
  const uid = () => Math.random().toString(36).slice(2, 10);
  const OA = D.hasNative ? '/proxy/openalex/' : 'https://api.openalex.org/';
  const fmtDate = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const exportFile = (name, text, mime = 'text/plain') => (Native.exportText ? Native.exportText(name, text, mime) : D.copyText?.(text));
  const doiOf = (a) => (a.doi ? 'https://doi.org/' + a.doi : a.pmid ? 'https://pubmed.ncbi.nlm.nih.gov/' + a.pmid : '');
  const miniCard = (a, extra = '') => `<div class="card" role="button" tabindex="0" data-act="open" data-id="${esc(a.id)}">
    <p class="title main">${esc(a.title)}</p><div class="byline"><span>${esc(a.jAbbr || a.journal || '')}${a.year ? ' · ' + esc(a.year) : ''}</span>${extra}</div></div>`;

  // ================================================================ G2 + G3: clinical summary card, practice-changing flag
  const CLIN = obj({
    design: S.str, population: S.str, sampleSize: S.str, age: S.str, skinTypes: S.str,
    intervention: S.str, comparator: S.str, duration: S.str,
    primaryOutcome: S.str, results: S.str, adverseEvents: S.str, limitations: S.str,
    evidenceLevel: { type: 'string', enum: ['1 (SR/MA of RCTs)', '2 (RCT)', '3 (cohort / case-control)', '4 (case series)', '5 (expert opinion / mechanistic)'] },
    strength: S.strength,
    impact: { type: 'string', enum: ['practice-changing', 'incremental', 'confirmatory', 'hypothesis-generating', 'not applicable'] },
    impactWhy: S.str, bottomLine: S.str,
  });
  const IMPACT = { 'practice-changing': ['🔴', 'Practice-changing'], incremental: ['🟠', 'Incremental'], confirmatory: ['🟢', 'Confirmatory'], 'hypothesis-generating': ['🔵', 'Hypothesis-generating'], 'not applicable': ['⚪', 'Not a clinical study'] };
  const clinGet = (id) => store.get('clin', {})[id] || null;
  const clinSet = (id, c) => { const all = store.get('clin', {}); all[id] = c; const keys = Object.keys(all); if (keys.length > 300) delete all[keys[0]]; store.set('clin', all); };

  function clinHtml(c, label) {
    const [e, t] = IMPACT[c.impact] || IMPACT['not applicable'];
    const row = (k, v) => (v && !/^not (reported|applicable|stated)\.?$/i.test(v) ? `<span>${k}</span><b>${esc(v)}</b>` : '');
    return `<div class="panel clin"><div class="clin-flag ${esc(c.impact.split(' ')[0])}">${e} ${t}</div>
      <p class="clin-bl">${esc(c.bottomLine)}</p>
      <div class="kv">${row('Design', c.design)}${row('Population', c.population)}${row('N', c.sampleSize)}${row('Age', c.age)}${row('Skin types', c.skinTypes)}
        ${row('Intervention', c.intervention)}${row('Comparator', c.comparator)}${row('Duration', c.duration)}${row('Primary outcome', c.primaryOutcome)}
        ${row('Results', c.results)}${row('Adverse events', c.adverseEvents)}${row('Limitations', c.limitations)}${row('Evidence level', c.evidenceLevel)}${row('Strength', c.strength)}</div>
      ${c.impactWhy ? `<p class="small"><b>Why ${esc(t.toLowerCase())}:</b> ${esc(c.impactWhy)}</p>` : ''}
      <p class="muted small">AI extraction from the ${esc(label || 'paper')}. Check numbers against the paper before using them.</p></div>`;
  }
  async function renderClin(id) {
    id = decodeURIComponent(id || '');
    view.innerHTML = `${D.topbar('Clinical summary')}<div id="clin-out">${I.busyHtml ? I.busyHtml('Reading the paper…') : D.skeletons(3)}</div>`;
    const out = $('#clin-out');
    let a;
    try { a = await D.findArticle(id); } catch (e) { out.innerHTML = D.errorBox(e, false); return; }
    const head = miniCard(a);
    const have = clinGet(id);
    if (have) { out.innerHTML = head + clinHtml(have.c, have.label) + `<button class="btn small" data-act="clin-redo" data-id="${esc(id)}">${icon('refresh')}Redo</button>`; return; }
    if (!D.aiHasKey()) { out.innerHTML = head + I.keyCard(); return; }
    try {
      const src = await I.paperText(a);
      const c = D.aiJson(await D.ai('Extract a clinical summary card of this study for a practising dermatologist. Keep numbers, doses, device settings and effect sizes exactly as reported; write "not reported" when absent. '
        + 'Judge impact honestly: "practice-changing" only for well-powered, high-quality evidence that should change routine care; "incremental" for meaningful additions; "confirmatory" when it confirms what is known; "hypothesis-generating" for early or small studies.',
      { ...src, schema: CLIN, max: 3000 }));
      clinSet(id, { c, label: src.label, at: Date.now() });
      if (out.isConnected) out.innerHTML = head + clinHtml(c, src.label);
    } catch (e) { if (out.isConnected) out.innerHTML = head + I.aiErr(e); }
  }
  actions['clin-redo'] = (b) => { const all = store.get('clin', {}); delete all[b.dataset.id]; store.set('clin', all); render(); };

  const prevTools = ext.articleTools;
  ext.articleTools = (a) => {
    const c = clinGet(a.id);
    const flag = c ? `<span class="clin-flag small ${esc(c.c.impact.split(' ')[0])}">${IMPACT[c.c.impact]?.[0] || ''} ${IMPACT[c.c.impact]?.[1] || ''}</span>` : '';
    return (prevTools ? prevTools(a) : '') + `<div class="row wrap intel-paper">
      <button class="btn xs" data-act="clin-open" data-id="${esc(a.id)}">${icon('cards')}Clinical summary</button>${flag}
      <button class="btn xs" data-act="cme-quiz" data-id="${esc(a.id)}">${icon('school')}Quiz me</button></div>`;
  };
  actions['clin-open'] = (b) => go('clin/' + encodeURIComponent(b.dataset.id));

  // ================================================================ G4: alerts
  const DERM_Q = '(psoriasis OR dermatitis OR eczema OR vitiligo OR alopecia OR hidradenitis OR urticaria OR acne OR rosacea OR pemphigus OR pemphigoid OR prurigo OR melanoma OR "basal cell carcinoma" OR "actinic keratosis" OR "skin")';
  async function retractionCheck() {
    const papers = [...D.saved.values()].filter((a) => !a.imported && !a.utd && (a.doi || a.pmid));
    const hits = [];
    for (let i = 0; i < papers.length; i += 25) {
      const part = papers.slice(i, i + 25);
      const ids = part.map((a) => (a.doi ? `DOI:"${a.doi}"` : `EXT_ID:${a.pmid}`)).join(' OR ');
      try {
        const r = await D.epmcSearch(`(${ids}) AND (PUB_TYPE:"Retracted Publication" OR PUB_TYPE:"retracted publication")`, { size: 25 });
        hits.push(...r.results);
      } catch { /* try the rest */ }
    }
    return { checked: papers.length, hits };
  }
  async function fdaNew() {
    const from = I.daysAgo(120).replace(/-/g, '');
    const to = I.today().replace(/-/g, '');
    const terms = ['psoriasis', 'atopic+dermatitis', 'vitiligo', 'alopecia', 'hidradenitis', 'urticaria', 'acne', 'rosacea', 'prurigo', 'melanoma', 'basal+cell', 'actinic+keratosis', 'pemphigus'];
    const url = I.api('fda', `drug/label.json?search=effective_time:[${from}+TO+${to}]+AND+indications_and_usage:(${terms.map((t) => `"${t}"`).join('+')})&sort=effective_time:desc&limit=60`);
    const j = await D.getJSON(url);
    const seen = new Set();
    const out = [];
    for (const L of j.results || []) {
      const name = (L.openfda?.generic_name?.[0] || L.openfda?.brand_name?.[0] || '').toLowerCase();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const ind = String(L.indications_and_usage?.[0] || '').replace(/^\s*\d*\s*INDICATIONS? (AND|&) USAGE\s*/i, '').replace(/\s+/g, ' ');
      out.push({ name, brand: (L.openfda?.brand_name || []).join(', '), date: L.effective_time, ind: ind.slice(0, 220) });
    }
    return out.slice(0, 20);
  }
  async function guidelinesNew() {
    const q = `(PUB_TYPE:"Practice Guideline" OR TITLE:"guideline" OR TITLE:"guidelines" OR TITLE:"consensus statement" OR TITLE:"recommendations") AND ${D.DERM_FILTER} AND FIRST_PDATE:[${I.daysAgo(90)} TO ${I.today()}] NOT SRC:PPR`;
    return (await D.epmcSearch(q, { sort: 'P_PDATE_D desc', size: 25 })).results;
  }
  async function renderAlerts() {
    const seen = new Set(store.get('alertsSeen', []));
    view.innerHTML = `${D.topbar('Alerts')}
      <p class="muted small">Retractions among your saved papers, dermatology drug labels updated by the FDA, and new dermatology guidelines from the last 90 days.</p>
      <div class="section"><div class="section-h"><h3>🚫 Retractions in your library</h3></div><div id="al-ret">${D.skeletons(1)}</div></div>
      <div class="section"><div class="section-h"><h3>📋 New guidelines (90 days)</h3></div><div id="al-gl">${D.skeletons(2)}</div></div>
      <div class="section"><div class="section-h"><h3>💊 FDA label updates (120 days)</h3></div><div id="al-fda">${D.skeletons(2)}</div></div>`;
    const isNew = (k) => (seen.has(k) ? '' : '<span class="badge b-new">New</span>');
    const newKeys = [];
    const fill = (sel, html) => { const el = $(sel); if (el) el.innerHTML = html; };
    await Promise.all([
      retractionCheck().then(({ checked, hits }) => {
        hits.forEach((a) => newKeys.push('r:' + a.id));
        fill('#al-ret', hits.length ? hits.map((a) => miniCard(a, '<span class="badge b-retr">Retracted</span>' + isNew('r:' + a.id))).join('')
          : `<div class="panel small">${icon('check')} None of your ${checked} saved papers is marked retracted in Europe PMC.</div>`);
      }).catch((e) => fill('#al-ret', D.errorBox(e, false))),
      guidelinesNew().then((list) => {
        list.forEach((a) => newKeys.push('g:' + a.id));
        fill('#al-gl', list.map((a) => miniCard(a, isNew('g:' + a.id))).join('') || '<div class="muted small">No new guidelines found.</div>');
      }).catch((e) => fill('#al-gl', D.errorBox(e, false))),
      fdaNew().then((list) => {
        list.forEach((x) => newKeys.push('f:' + x.name + x.date));
        fill('#al-fda', list.map((x) => `<button class="card" data-act="al-drug" data-v="${esc(x.name)}"><p class="title main">${esc(x.name)}${x.brand ? ` <span class="muted">(${esc(x.brand)})</span>` : ''} ${isNew('f:' + x.name + x.date)}</p>
          <div class="byline"><span>Label effective ${esc(x.date.replace(/(\d{4})(\d\d)(\d\d)/, '$1-$2-$3'))}</span></div><p class="small muted">${esc(x.ind)}…</p></button>`).join('') || '<div class="muted small">No dermatology label updates found.</div>');
      }).catch((e) => fill('#al-fda', D.errorBox(e, false))),
    ]);
    store.set('alertsSeen', [...new Set([...seen, ...newKeys])].slice(-1500));
    store.set('alertsAt', Date.now());
  }
  actions['al-drug'] = (b) => go('drug?' + new URLSearchParams({ name: b.dataset.v }));

  // ================================================================ G5: living guideline dashboard
  async function renderLiving(_, p) {
    const dz = p.d || '';
    view.innerHTML = `${D.topbar('Living guidelines')}
      <p class="muted small">Every guideline and consensus statement for a disease, newest first, and what changed between them.</p>
      <form class="searchbox compact" data-form="living"><textarea name="q" rows="1" placeholder="Disease, e.g. hidradenitis suppurativa">${esc(dz)}</textarea><button class="go" type="submit">${icon('up')}</button></form>
      <div class="scroll-x" style="margin:8px 0">${I.DISEASES.map((d) => `<button class="chip ${d === dz ? 'on' : ''}" data-act="lv-pick" data-v="${esc(d)}">${esc(d)}</button>`).join('')}</div>
      <div id="lv-out">${dz ? D.skeletons(3) : '<div class="empty">' + icon('list') + '<b>Pick a disease</b></div>'}</div>`;
    if (!dz) return;
    const el = $('#lv-out');
    try {
      const q = `TITLE:"${dz.replace(/"/g, '')}" AND (PUB_TYPE:"Practice Guideline" OR TITLE:"guideline" OR TITLE:"guidelines" OR TITLE:"consensus" OR TITLE:"recommendations" OR TITLE:"position statement") NOT SRC:PPR`;
      const res = await D.epmcSearch(q, { sort: 'P_PDATE_D desc', size: 40 });
      const list = res.results;
      if (!list.length) { el.innerHTML = '<div class="empty"><b>No guidelines found</b></div>'; return; }
      const years = {};
      for (const a of list) (years[a.year || '—'] ||= []).push(a);
      el.innerHTML = `<button class="btn primary full" data-act="lv-diff" data-d="${esc(dz)}">${icon('spark')}What changed? (AI, cited)</button><div id="lv-diff"></div>
        <div class="timeline">${Object.keys(years).sort((x, y) => y.localeCompare(x)).map((y) => `<div class="tl-year"><b>${esc(y)}</b>${years[y].map((a) => miniCard(a)).join('')}</div>`).join('')}</div>`;
      actions['lv-diff'] = async () => {
        const box = $('#lv-diff');
        if (!D.aiHasKey()) { box.innerHTML = I.keyCard(); return; }
        const refs = list.slice(0, 18).map((a, i) => ({ kind: 'paper', a, type: D.studyType(a).label, n: i + 1 }));
        box.innerHTML = I.busyHtml ? I.busyHtml('Comparing guidelines…') : D.skeletons(2);
        try {
          const text = await D.ai(`These are guidelines and consensus statements on ${dz}, newest first. Write a "living guideline" briefing for a dermatologist: `
            + '1) current recommendations in brief (cite the newest sources), 2) what changed over time - new drugs, dropped or downgraded options, changed thresholds or algorithms - with years, '
            + '3) where guidelines from different societies or regions disagree, 4) what is likely to change next. Markdown with "## " headings.',
          { doc: I.packText(refs), system: I.CITE_SYSTEM, max: 4000, onPartial: (t) => { if (box.isConnected) box.innerHTML = `<div class="panel synth">${md(t)}<span class="typing">▍</span></div>`; } });
          if (box.isConnected) box.innerHTML = `<div class="panel synth">${I.citeHtml(md(text), I.newCtx(refs))}</div>`;
        } catch (e) { box.innerHTML = I.aiErr(e); }
      };
    } catch (e) { el.innerHTML = D.errorBox(e); }
  }
  actions['lv-pick'] = (b) => go('living?' + new URLSearchParams({ d: b.dataset.v }), { replace: true });
  document.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-form]');
    if (!f) return;
    const kind = f.dataset.form;
    const v = (f.q?.value || '').trim();
    const routes = { living: 'living?d=', network: 'network?q=', confs: 'confs?q=' };
    if (!routes[kind]) return;
    e.preventDefault();
    if (v) go(routes[kind] + encodeURIComponent(v), { replace: true });
  });

  // ================================================================ G7: systematic review kit
  // ---- statistics
  const erf = (x) => { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
  const pNorm = (z) => 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2)));
  const pChi = (q, df) => { if (df <= 0) return 1; const z = (Math.cbrt(q / df) - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df)); return 1 - 0.5 * (1 + erf(z / Math.SQRT2)); };
  const fmtP = (p) => (p < 0.001 ? '<0.001' : p.toFixed(3));
  const MEASURES = {
    or: { label: 'Odds ratio (events)', ratio: true, hint: 'Study, events A, total A, events B, total B', n: 4 },
    rr: { label: 'Risk ratio (events)', ratio: true, hint: 'Study, events A, total A, events B, total B', n: 4 },
    md: { label: 'Mean difference', ratio: false, hint: 'Study, mean A, SD A, n A, mean B, SD B, n B', n: 6 },
    smd: { label: 'Standardised mean difference (Hedges g)', ratio: false, hint: 'Study, mean A, SD A, n A, mean B, SD B, n B', n: 6 },
    gr: { label: 'Ratio with 95% CI (HR/OR/RR)', ratio: true, hint: 'Study, estimate, lower CI, upper CI', n: 3 },
    gd: { label: 'Difference with 95% CI', ratio: false, hint: 'Study, estimate, lower CI, upper CI', n: 3 },
  };
  function studyEffect(m, v) {
    if (m === 'or' || m === 'rr') {
      let [a, n1, c, n2] = v;
      let b = n1 - a, d = n2 - c;
      if ([a, b, c, d].some((x) => x === 0)) { a += 0.5; b += 0.5; c += 0.5; d += 0.5; n1 += 1; n2 += 1; }
      return m === 'or' ? { y: Math.log((a * d) / (b * c)), se: Math.sqrt(1 / a + 1 / b + 1 / c + 1 / d) }
        : { y: Math.log((a / n1) / (c / n2)), se: Math.sqrt(1 / a - 1 / n1 + 1 / c - 1 / n2) };
    }
    if (m === 'md' || m === 'smd') {
      const [m1, s1, n1, m2, s2, n2] = v;
      if (m === 'md') return { y: m1 - m2, se: Math.sqrt(s1 * s1 / n1 + s2 * s2 / n2) };
      const sp = Math.sqrt(((n1 - 1) * s1 * s1 + (n2 - 1) * s2 * s2) / (n1 + n2 - 2));
      const J = 1 - 3 / (4 * (n1 + n2) - 9);
      const g = J * (m1 - m2) / sp;
      return { y: g, se: Math.sqrt((n1 + n2) / (n1 * n2) + g * g / (2 * (n1 + n2))) };
    }
    const [e, lo, hi] = v;
    return m === 'gr' ? { y: Math.log(e), se: (Math.log(hi) - Math.log(lo)) / 3.92 } : { y: e, se: (hi - lo) / 3.92 };
  }
  function metaAnalyse(m, text) {
    const rows = [];
    const bad = [];
    for (const line of text.split('\n').map((x) => x.trim()).filter(Boolean)) {
      const parts = line.split(/[,;\t]/).map((x) => x.trim());
      const nums = parts.slice(1).map(Number);
      if (nums.length < MEASURES[m].n || nums.slice(0, MEASURES[m].n).some((x) => !Number.isFinite(x))) { bad.push(line); continue; }
      const e = studyEffect(m, nums);
      if (!Number.isFinite(e.y) || !(e.se > 0)) { bad.push(line); continue; }
      rows.push({ name: parts[0] || 'Study ' + (rows.length + 1), ...e });
    }
    if (rows.length < 2) return { rows, bad, error: 'Enter at least two valid studies.' };
    const w = rows.map((r) => 1 / (r.se * r.se));
    const sw = w.reduce((s, x) => s + x, 0);
    const fe = rows.reduce((s, r, i) => s + w[i] * r.y, 0) / sw;
    const feSe = Math.sqrt(1 / sw);
    const Q = rows.reduce((s, r, i) => s + w[i] * (r.y - fe) ** 2, 0);
    const df = rows.length - 1;
    const C = sw - w.reduce((s, x) => s + x * x, 0) / sw;
    const tau2 = Math.max(0, (Q - df) / C);
    const wr = rows.map((r) => 1 / (r.se * r.se + tau2));
    const swr = wr.reduce((s, x) => s + x, 0);
    const re = rows.reduce((s, r, i) => s + wr[i] * r.y, 0) / swr;
    const reSe = Math.sqrt(1 / swr);
    const I2 = Q > df ? ((Q - df) / Q) * 100 : 0;
    rows.forEach((r, i) => { r.wf = (w[i] / sw) * 100; r.wr = (wr[i] / swr) * 100; });
    return { rows, bad, fe: { y: fe, se: feSe, p: pNorm(fe / feSe) }, re: { y: re, se: reSe, p: pNorm(re / reSe) }, Q, df, pQ: pChi(Q, df), I2, tau2 };
  }
  function forestSvg(m, r, model) {
    const ratio = MEASURES[m].ratio;
    const tx = (y) => (ratio ? Math.exp(y) : y);
    const pool = r[model];
    const all = [...r.rows.map((x) => [x.y - 1.96 * x.se, x.y + 1.96 * x.se]), [pool.y - 1.96 * pool.se, pool.y + 1.96 * pool.se]].flat();
    let lo = Math.min(0, ...all), hi = Math.max(0, ...all);
    const pad = (hi - lo) * 0.08 || 0.5; lo -= pad; hi += pad;
    const W = 640, L = 170, R = 200, plotW = W - L - R, rowH = 26, top = 34;
    const H = top + (r.rows.length + 2) * rowH + 40;
    const X = (v) => L + ((v - lo) / (hi - lo)) * plotW;
    const f = (v) => (Math.abs(tx(v)) >= 100 ? tx(v).toFixed(0) : tx(v).toFixed(2));
    const wKey = model === 're' ? 'wr' : 'wf';
    const maxW = Math.max(...r.rows.map((x) => x[wKey]));
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="sans-serif" font-size="12"><rect width="${W}" height="${H}" fill="#fff"/>`;
    s += `<text x="8" y="20" font-weight="bold">Study</text><text x="${W - R + 10}" y="20" font-weight="bold">${ratio ? 'Ratio' : 'Diff'} [95% CI]</text><text x="${W - 46}" y="20" font-weight="bold">Wt %</text>`;
    r.rows.forEach((x, i) => {
      const y = top + i * rowH + rowH / 2;
      const a = x.y - 1.96 * x.se, b = x.y + 1.96 * x.se;
      const sz = 4 + 8 * Math.sqrt(x[wKey] / maxW);
      s += `<text x="8" y="${y + 4}">${esc(x.name.slice(0, 24))}</text><line x1="${X(a)}" x2="${X(b)}" y1="${y}" y2="${y}" stroke="#333"/>
        <rect x="${X(x.y) - sz / 2}" y="${y - sz / 2}" width="${sz}" height="${sz}" fill="#2563eb"/>
        <text x="${W - R + 10}" y="${y + 4}">${f(x.y)} [${f(a)}, ${f(b)}]</text><text x="${W - 46}" y="${y + 4}">${x[wKey].toFixed(1)}</text>`;
    });
    const py = top + (r.rows.length + 0.6) * rowH;
    const pa = pool.y - 1.96 * pool.se, pb = pool.y + 1.96 * pool.se;
    s += `<polygon points="${X(pa)},${py} ${X(pool.y)},${py - 8} ${X(pb)},${py} ${X(pool.y)},${py + 8}" fill="#e11d48"/>
      <text x="8" y="${py + 4}" font-weight="bold">${model === 're' ? 'Random effects' : 'Fixed effect'}</text><text x="${W - R + 10}" y="${py + 4}" font-weight="bold">${f(pool.y)} [${f(pa)}, ${f(pb)}]</text>`;
    const zx = X(0);
    const axisY = top + (r.rows.length + 1.4) * rowH;
    s += `<line x1="${zx}" x2="${zx}" y1="${top - 6}" y2="${axisY}" stroke="#999" stroke-dasharray="3,3"/><line x1="${L}" x2="${L + plotW}" y1="${axisY}" y2="${axisY}" stroke="#333"/>`;
    for (let k = 0; k <= 4; k++) { const v = lo + ((hi - lo) * k) / 4; s += `<text x="${X(v)}" y="${axisY + 16}" text-anchor="middle">${f(v)}</text>`; }
    s += `<text x="8" y="${H - 8}" fill="#555">Heterogeneity: I² = ${r.I2.toFixed(0)}%, τ² = ${r.tau2.toFixed(3)}, Q = ${r.Q.toFixed(2)} (df ${r.df}, p ${fmtP(r.pQ)}). Overall p ${fmtP(pool.p)}${ratio ? ' · log scale' : ''}</text></svg>`;
    return s;
  }
  function prismaSvg(v) {
    const n = (k) => (v[k] === '' || v[k] == null ? 'n = ?' : 'n = ' + v[k]);
    const box = (x, y, w, h, lines, fill = '#fff') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fill}" stroke="#334155"/>`
      + lines.map((l, i) => `<text x="${x + 10}" y="${y + 20 + i * 16}" font-size="12">${esc(l)}</text>`).join('');
    const arrow = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#334155" marker-end="url(#ar)"/>`;
    const reasons = String(v.reasons || '').split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 6);
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" font-family="sans-serif"><rect width="640" height="640" fill="#fff"/>
      <defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="#334155"/></marker></defs>
      <text x="320" y="22" text-anchor="middle" font-size="14" font-weight="bold">PRISMA 2020 flow diagram</text>`;
    s += box(20, 40, 280, 58, ['Records identified from:', `Databases (${n('db')})`, `Registers (${n('reg')})`], '#eff6ff');
    s += box(340, 40, 280, 58, ['Records removed before screening:', `Duplicates (${n('dup')})`, `Other reasons (${n('other')})`]);
    s += box(20, 140, 280, 40, ['Records screened', n('screened')]);
    s += box(340, 140, 280, 40, ['Records excluded', n('exScreen')]);
    s += box(20, 220, 280, 40, ['Reports sought for retrieval', n('sought')]);
    s += box(340, 220, 280, 40, ['Reports not retrieved', n('notRet')]);
    s += box(20, 300, 280, 40, ['Reports assessed for eligibility', n('assessed')]);
    s += box(340, 300, 280, Math.max(40, 26 + reasons.length * 16), ['Reports excluded:', ...reasons]);
    s += box(20, 420, 280, 58, ['Studies included in review', n('studies'), `Reports of included studies (${n('reports')})`], '#ecfdf5');
    s += arrow(160, 98, 160, 138) + arrow(300, 69, 338, 69) + arrow(160, 180, 160, 218) + arrow(300, 160, 338, 160)
      + arrow(160, 260, 160, 298) + arrow(300, 240, 338, 240) + arrow(160, 340, 160, 418) + arrow(300, 320, 338, 320);
    return s + '<text x="20" y="620" font-size="10" fill="#64748b">Page MJ, et al. BMJ 2021;372:n71. Made with DermScholar.</text></svg>';
  }
  const PRISMA_F = [['db', 'Records from databases'], ['reg', 'Records from registers'], ['dup', 'Duplicates removed'], ['other', 'Removed for other reasons'],
    ['screened', 'Records screened'], ['exScreen', 'Excluded at title/abstract'], ['sought', 'Reports sought'], ['notRet', 'Reports not retrieved'],
    ['assessed', 'Reports assessed (full text)'], ['studies', 'Studies included'], ['reports', 'Reports of included studies']];
  function renderSr(_, p) {
    const tab = p.t || 'prisma';
    view.innerHTML = `${D.topbar('Systematic review kit')}
      <div class="scroll-x">${[['prisma', '📐 PRISMA flow'], ['meta', '📊 Meta-analysis'], ['pico', '🧩 PICO table']].map(([k, l]) => `<button class="chip ${k === tab ? 'on' : ''}" data-act="sr-tab" data-t="${k}">${l}</button>`).join('')}</div>
      <div id="sr-body" class="section"></div>`;
    const body = $('#sr-body');
    if (tab === 'prisma') {
      const v = store.get('prisma', {});
      body.innerHTML = `<div class="grid2">${PRISMA_F.map(([k, l]) => `<label class="field">${l}<input type="number" inputmode="numeric" min="0" data-pr="${k}" value="${esc(v[k] ?? '')}"></label>`).join('')}</div>
        <label class="field">Reasons full texts were excluded (one per line, e.g. "Wrong population (n = 12)")<textarea data-pr="reasons" rows="3">${esc(v.reasons || '')}</textarea></label>
        <button class="btn small" data-act="pr-auto">${icon('spark')}Fill the arithmetic</button>
        <div id="pr-svg" class="panel svgbox">${prismaSvg(v)}</div>
        <button class="btn primary full" data-act="pr-export">${icon('download')}Export SVG</button>`;
      const read = () => { const o = {}; body.querySelectorAll('[data-pr]').forEach((i) => { o[i.dataset.pr] = i.value; }); return o; };
      body.addEventListener('input', () => { const o = read(); store.set('prisma', o); $('#pr-svg').innerHTML = prismaSvg(o); });
      actions['pr-auto'] = () => {
        const o = read();
        const N = (k) => Number(o[k]) || 0;
        if (o.screened === '' && (o.db || o.reg)) o.screened = String(N('db') + N('reg') - N('dup') - N('other'));
        if (o.sought === '' && o.screened !== '') o.sought = String(N('screened') - N('exScreen'));
        if (o.assessed === '' && o.sought !== '') o.assessed = String(N('sought') - N('notRet'));
        store.set('prisma', o); render();
      };
      actions['pr-export'] = () => exportFile('prisma-flow.svg', prismaSvg(read()), 'image/svg+xml');
    } else if (tab === 'meta') {
      const st = store.get('meta', { m: 'or', text: 'Smith 2019, 12, 50, 20, 52\nLee 2021, 8, 40, 15, 41\nKumar 2023, 30, 120, 44, 118' });
      body.innerHTML = `<label class="field">Effect measure<select id="ma-m">${Object.entries(MEASURES).map(([k, x]) => `<option value="${k}" ${k === st.m ? 'selected' : ''}>${x.label}</option>`).join('')}</select></label>
        <label class="field">One study per line: <span id="ma-hint">${esc(MEASURES[st.m].hint)}</span><textarea id="ma-text" rows="6">${esc(st.text)}</textarea></label>
        <div class="row"><button class="btn primary" data-act="ma-run">${icon('chart')}Analyse</button><button class="btn" data-act="ma-model">${st.model === 'fe' ? 'Fixed effect' : 'Random effects'}</button></div>
        <div id="ma-out"></div>`;
      const run = () => {
        const s = store.get('meta', st);
        const r = metaAnalyse(s.m, s.text);
        const out = $('#ma-out');
        if (r.error) { out.innerHTML = `<p class="small">${esc(r.error)}</p>${r.bad.length ? `<p class="muted small">Couldn't read: ${r.bad.map(esc).join(' · ')}</p>` : ''}`; return; }
        const model = s.model === 'fe' ? 'fe' : 're';
        const svg = forestSvg(s.m, r, model);
        const ratio = MEASURES[s.m].ratio;
        const t = (y) => (ratio ? Math.exp(y) : y).toFixed(2);
        const pool = r[model];
        out.innerHTML = `<div class="panel svgbox">${svg}</div>
          <div class="panel small"><b>${model === 're' ? 'Random effects (DerSimonian–Laird)' : 'Fixed effect (inverse variance)'}:</b> ${t(pool.y)} [95% CI ${t(pool.y - 1.96 * pool.se)} to ${t(pool.y + 1.96 * pool.se)}], p ${fmtP(pool.p)}.
          Heterogeneity I² ${r.I2.toFixed(0)}% (${r.I2 < 40 ? 'might not be important' : r.I2 < 60 ? 'moderate' : r.I2 < 75 ? 'substantial' : 'considerable'}), τ² ${r.tau2.toFixed(3)}, Q ${r.Q.toFixed(2)} on ${r.df} df, p ${fmtP(r.pQ)}.
          ${r.rows.length < 5 ? '<br>With fewer than 5 studies, τ² is imprecise; interpret random effects cautiously.' : ''}${r.bad.length ? `<br>Skipped: ${r.bad.map(esc).join(' · ')}` : ''}</div>
          <button class="btn full" data-act="ma-export">${icon('download')}Export forest plot (SVG)</button>`;
        actions['ma-export'] = () => exportFile('forest-plot.svg', svg, 'image/svg+xml');
      };
      $('#ma-m').onchange = (e) => { const s = { ...store.get('meta', st), m: e.target.value }; store.set('meta', s); $('#ma-hint').textContent = MEASURES[s.m].hint; };
      $('#ma-text').oninput = (e) => store.set('meta', { ...store.get('meta', st), text: e.target.value });
      actions['ma-run'] = run;
      actions['ma-model'] = () => { const s = store.get('meta', st); store.set('meta', { ...s, model: s.model === 'fe' ? 're' : 'fe' }); render(); };
      run();
    } else {
      body.innerHTML = `<p class="small">Build a PICO table and side-by-side comparison of up to six papers: tap <b>Compare</b> on each paper, then open the comparison.</p>
        <button class="btn primary full" data-act="intel-go" data-k="compare">${icon('chart')}Open comparison table</button>
        <p class="muted small" style="margin-top:12px">Tip: export your included papers from Library (RIS/BibTeX) for Rayyan, Covidence or Zotero screening.</p>`;
    }
  }
  actions['sr-tab'] = (b) => go('sr?t=' + b.dataset.t, { replace: true });

  // ================================================================ G8: private case library (this phone only)
  const CDB = (() => {
    let dbp = null;
    const open = () => (dbp ||= new Promise((res, rej) => {
      const r = indexedDB.open('dermscholar-cases', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('cases', { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
    const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction('cases', mode); const st = t.objectStore('cases'); const q = fn(st); t.oncomplete = () => res(q?.result); t.onerror = () => rej(t.error); }); };
    return {
      all: () => tx('readonly', (s) => s.getAll()).then((l) => (l || []).sort((a, b) => b.updated - a.updated)),
      get: (id) => tx('readonly', (s) => s.get(id)),
      put: (c) => tx('readwrite', (s) => s.put({ ...c, updated: Date.now() })),
      del: (id) => tx('readwrite', (s) => s.delete(id)),
    };
  })();
  function shrink(dataUrl, max = 1400) {
    return new Promise((res) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => res(dataUrl);
      img.src = dataUrl;
    });
  }
  async function renderCases() {
    view.innerHTML = `${D.topbar('My cases')}
      <div class="panel small">${icon('unlock')} Private: cases stay on this phone only. They are never synced or uploaded. Don't store names or identifiable details.</div>
      <button class="btn primary full" data-act="case-new">${icon('plus')}New case</button><div id="case-list" class="section">${D.skeletons(2)}</div>`;
    const list = await CDB.all().catch(() => []);
    $('#case-list').innerHTML = list.map((c) => {
      const ph = c.entries.find((e) => e.photo);
      return `<button class="case-card" data-act="case-open" data-id="${c.id}">${ph ? `<img src="${ph.photo}" alt="">` : `<span class="case-ph">${icon('camera')}</span>`}
        <span><b>${esc(c.title)}</b><small>${esc(c.dx || 'No diagnosis yet')} · ${c.entries.length} entries · ${fmtDate(c.updated)}</small></span></button>`;
    }).join('') || `<div class="empty">${icon('camera')}<b>No cases yet</b><div>Keep clinical photos, notes, follow-ups and linked papers together.</div></div>`;
    if (list.length) $('#case-list').insertAdjacentHTML('beforeend', `<button class="btn small" data-act="case-backup">${icon('download')}Back up all cases (JSON)</button>`);
    actions['case-backup'] = () => exportFile(`dermscholar-cases-${I.today()}.json`, JSON.stringify(list), 'application/json');
  }
  actions['case-new'] = () => {
    sheet(`<h3>New case</h3><input id="cs-t" placeholder="Short label, e.g. 34F annular plaques"><input id="cs-dx" placeholder="Working diagnosis (optional)" style="margin-top:8px">
      <button class="btn primary full" data-act="case-create" style="margin-top:8px">Create</button>`);
    actions['case-create'] = async () => {
      const t = $('#cs-t').value.trim();
      if (!t) { toast('Give it a label'); return; }
      const c = { id: uid(), title: t, dx: $('#cs-dx').value.trim(), entries: [], papers: [], created: Date.now() };
      await CDB.put(c); closeSheet(true); go('case/' + c.id);
    };
  };
  actions['case-open'] = (b) => go('case/' + b.dataset.id);
  async function renderCase(id) {
    const c = await CDB.get(id).catch(() => null);
    if (!c) { view.innerHTML = D.topbar('Case') + '<div class="empty"><b>Case not found</b></div>'; return; }
    const papers = c.papers.map((pid) => D.saved.get(pid)).filter(Boolean);
    view.innerHTML = `${D.topbar(c.title, { right: `<button class="icon-btn" data-act="case-menu" data-id="${id}" aria-label="More">${icon('dots')}</button>` })}
      <p class="small"><b>Diagnosis:</b> ${esc(c.dx || '—')}</p>
      <div class="row wrap"><button class="btn small primary" data-act="case-photo" data-id="${id}">${icon('camera')}Add photo</button>
        <button class="btn small" data-act="case-note" data-id="${id}">${icon('note')}Add note</button>
        <button class="btn small" data-act="case-link" data-id="${id}">${icon('link')}Link paper</button>
        ${c.dx ? `<button class="btn small" data-act="case-lit" data-q="${esc(c.dx)}">${icon('zoom')}Literature images</button>` : ''}</div>
      <div class="timeline section">${c.entries.slice().reverse().map((e, i) => `<div class="tl-entry"><small>${fmtDate(e.t)}</small>
        ${e.photo ? `<img class="case-img" src="${e.photo}" alt="" data-act="case-zoom" data-i="${c.entries.length - 1 - i}" data-id="${id}">` : ''}${e.note ? `<p>${esc(e.note)}</p>` : ''}</div>`).join('') || '<div class="muted small">No entries yet. Add a photo or note to start the timeline.</div>'}</div>
      ${papers.length ? `<div class="section"><div class="section-h"><h3>Linked papers</h3></div>${papers.map((a) => miniCard(a)).join('')}</div>` : ''}`;
  }
  const withCase = (fn) => async (b) => { const c = await CDB.get(b.dataset.id); if (!c) return; await fn(c, b); };
  actions['case-photo'] = withCase(async (c) => {
    try {
      const url = await shrink(await I.pickImage());
      const note = prompt('Note for this photo (optional, e.g. week 4 on methotrexate)') || '';
      c.entries.push({ t: Date.now(), photo: url, note });
      await CDB.put(c); render();
    } catch (e) { if (!/cancel/i.test(e.message)) toast(e.message); }
  });
  actions['case-note'] = withCase(async (c) => {
    sheet(`<h3>Add note</h3><textarea id="cs-note" rows="4" placeholder="Findings, treatment, response…"></textarea><button class="btn primary full" data-act="case-note-save" style="margin-top:8px">Save</button>`);
    actions['case-note-save'] = async () => { const v = $('#cs-note').value.trim(); if (!v) return; c.entries.push({ t: Date.now(), note: v }); await CDB.put(c); closeSheet(true); render(); };
  });
  actions['case-link'] = withCase(async (c) => {
    const opts = Object.fromEntries([...D.saved.values()].filter((a) => !a.utd).slice(0, 200).map((a) => [a.id, a.title.slice(0, 90)]));
    if (!Object.keys(opts).length) { toast('Save some papers to your library first'); return; }
    D.pickMany('Link saved papers', opts, c.papers, async (v) => { c.papers = v; await CDB.put(c); render(); });
  });
  actions['case-lit'] = (b) => go('images?' + new URLSearchParams({ q: b.dataset.q }));
  actions['case-zoom'] = withCase(async (c, b) => { const e = c.entries[Number(b.dataset.i)]; if (e?.photo && D.lightbox) D.lightbox(e.photo); });
  actions['case-menu'] = withCase(async (c) => {
    sheet(`<h3>Case</h3><button class="opt" data-act="case-edit" data-id="${c.id}">${icon('note')}<span>Edit label / diagnosis</span></button>
      <button class="opt" data-act="case-del" data-id="${c.id}">${icon('trash')}<span>Delete case</span></button>`);
  });
  actions['case-edit'] = withCase(async (c) => {
    sheet(`<h3>Edit case</h3><input id="cs-t" value="${esc(c.title)}"><input id="cs-dx" value="${esc(c.dx)}" placeholder="Diagnosis" style="margin-top:8px">
      <button class="btn primary full" data-act="case-edit-save" style="margin-top:8px">Save</button>`);
    actions['case-edit-save'] = async () => { c.title = $('#cs-t').value.trim() || c.title; c.dx = $('#cs-dx').value.trim(); await CDB.put(c); closeSheet(true); render(); };
  });
  actions['case-del'] = withCase(async (c) => { if (!confirm('Delete this case and its photos?')) return; await CDB.del(c.id); closeSheet(true); go('cases', { replace: true }); });

  // ================================================================ G9: drug monitoring protocols
  const PROTO = [
    { k: 'mtx', name: 'Methotrexate', dose: 'Once WEEKLY, usually 7.5–25 mg (oral or subcutaneous). Folic acid on other days. Never daily.',
      base: 'FBC, LFT (± PIIINP or transient elastography if liver risk), U&E/creatinine (eGFR), hepatitis B/C, HIV, pregnancy test; consider chest X-ray.',
      mon: 'FBC, LFT, U&E every 1–2 weeks until dose stable, then every 2–3 months. Repeat after any dose increase.',
      watch: 'Cytopenias, transaminases >3× upper limit, falling eGFR, cough/dyspnoea (pneumonitis), mouth ulcers.',
      ix: 'Trimethoprim / co-trimoxazole (marrow toxicity — avoid), NSAIDs, probenecid, penicillins, PPIs (raised levels), live vaccines, alcohol.',
      preg: 'Teratogenic: contraception during treatment and for months after stopping (check label/local guideline, often 3–6 months).' },
    { k: 'csa', name: 'Ciclosporin', dose: '2.5–5 mg/kg/day in two divided doses, short courses (ideally under 1 year).',
      base: 'Blood pressure ×2, creatinine ×2 (baseline average), U&E, LFT, fasting lipids, magnesium, uric acid, FBC, urinalysis; hepatitis B/C, HIV.',
      mon: 'BP and creatinine every 2 weeks for 3 months, then monthly. Lipids, Mg, K, LFT periodically.',
      watch: 'Creatinine >25% above baseline on two readings → reduce dose; persistent hypertension; gingival hyperplasia.',
      ix: 'CYP3A4: macrolides, azoles, diltiazem/verapamil, grapefruit (raise levels); rifampicin, carbamazepine, St John’s wort (lower); statins (myopathy); potassium-sparing drugs; live vaccines.',
      preg: 'Not teratogenic in transplant data but use only if clearly needed.' },
    { k: 'iso', name: 'Isotretinoin', dose: 'Commonly 0.5–1 mg/kg/day (low-dose regimens also used). Cumulative 120–150 mg/kg often targeted.',
      base: 'Pregnancy test (pregnancy prevention programme), LFT, fasting lipids; mood screen.',
      mon: 'Monthly pregnancy tests where required. LFT and lipids at ~1 month (and per local protocol). Ask about mood every visit.',
      watch: 'Mood change or suicidal thoughts, headache/visual change (intracranial hypertension), triglycerides >5–10 mmol/L (pancreatitis risk), raised ALT.',
      ix: 'Tetracyclines (intracranial hypertension — avoid), vitamin A supplements, methotrexate (hepatotoxicity).',
      preg: 'Highly teratogenic: pregnancy prevention programme; contraception from 1 month before to 1 month after.', calc: true },
    { k: 'aza', name: 'Azathioprine', dose: '1–2.5 mg/kg/day, guided by TPMT (± NUDT15) activity; absent TPMT activity → avoid.',
      base: 'TPMT activity, FBC, LFT, U&E, hepatitis B/C, HIV, varicella status; pregnancy test.',
      mon: 'FBC and LFT weekly for 4–8 weeks, then every 3 months (more often after dose change).',
      watch: 'Leucopenia, thrombocytopenia, hepatitis, pancreatitis, hypersensitivity; long-term skin cancer risk — sun protection.',
      ix: 'Allopurinol / febuxostat (severe marrow toxicity — avoid or reduce azathioprine to 25%), warfarin (reduced effect), ACE inhibitors, co-trimoxazole, live vaccines.',
      preg: 'Can be continued in pregnancy under specialist advice.' },
    { k: 'mmf', name: 'Mycophenolate mofetil', dose: 'Usually 1–1.5 g twice daily (2–3 g/day); start lower.',
      base: 'FBC, LFT, U&E, hepatitis B/C, HIV, pregnancy test.',
      mon: 'FBC weekly for 4 weeks, every 2 weeks for 2 months, then monthly in the first year; LFT and U&E periodically.',
      watch: 'Cytopenias, GI upset, infections, PML (rare); skin cancer — sun protection.',
      ix: 'Antacids, PPIs and cholestyramine (lower absorption), azathioprine (avoid combination), live vaccines.',
      preg: 'Teratogenic: two forms of contraception; stop at least 6 weeks before conception (check label).' },
    { k: 'dap', name: 'Dapsone', dose: 'Start 25–50 mg/day, usually up to 100 mg/day.',
      base: 'G6PD level, FBC, reticulocytes, LFT, U&E; consider HLA-B*13:01 in people of East/Southeast Asian ancestry.',
      mon: 'FBC weekly for 4 weeks, then every 2 weeks to 3 months, then every 3 months; LFT; methaemoglobin if symptomatic.',
      watch: 'Haemolysis, methaemoglobinaemia (cyanosis, breathlessness), agranulocytosis (first 3 months), DRESS/dapsone hypersensitivity, neuropathy.',
      ix: 'Trimethoprim (raised levels both ways), rifampicin (lower levels), probenecid, other oxidant drugs.',
      preg: 'Specialist advice; risk of neonatal haemolysis.' },
    { k: 'hcq', name: 'Hydroxychloroquine', dose: '≤5 mg/kg actual body weight/day (commonly 200–400 mg/day).',
      base: 'FBC, U&E/eGFR, LFT; baseline eye exam within the first year; consider ECG if cardiac risk.',
      mon: 'Annual retinal screening (SD-OCT and visual fields) after 5 years, or from 1 year with risk factors (dose >5 mg/kg, eGFR <60, tamoxifen).',
      watch: 'Retinopathy, QT prolongation, hypoglycaemia, neuromyopathy, skin hyperpigmentation.',
      ix: 'QT-prolonging drugs, antacids (separate by 4 h), digoxin, insulin/sulfonylureas, ciclosporin.',
      preg: 'Generally continued in pregnancy.' },
    { k: 'jak', name: 'Oral JAK inhibitors', dose: 'Per product (e.g. upadacitinib, abrocitinib, baricitinib, ritlecitinib, deucravacitinib [TYK2]).',
      base: 'FBC with differential, LFT, lipids, creatinine, TB screen (IGRA), hepatitis B/C, HIV, pregnancy test; review vaccines (consider recombinant zoster vaccine).',
      mon: 'FBC and LFT at 4–12 weeks then periodically; lipids at ~12 weeks; skin checks.',
      watch: 'Boxed warning (class): serious infections, mortality, malignancy, MACE and thrombosis — caution in age ≥65, smokers, CV or VTE risk. Acne, herpes zoster, CK rise.',
      ix: 'Strong CYP3A4 inhibitors/inducers (dose changes for several), live vaccines, other potent immunosuppressants.',
      preg: 'Avoid: contraception during and for a period after (check label).' },
    { k: 'bio', name: 'Biologics (general)', dose: 'Per product and indication.',
      base: 'TB screen (IGRA ± chest X-ray), hepatitis B (sAg, core Ab), hepatitis C, HIV, FBC, LFT; vaccines up to date (no live vaccines once started).',
      mon: 'Clinical review of response and infections; annual TB risk review; FBC/LFT per product.',
      watch: 'Serious infection, TB reactivation. Class issues: TNF inhibitors (demyelination, heart failure, lupus-like), IL-17 (candidiasis, IBD flare), dupilumab (conjunctivitis, facial redness), IL-23 (generally few).',
      ix: 'Live vaccines; combination with other biologics or JAK inhibitors.',
      preg: 'Varies: certolizumab has minimal placental transfer; plan with specialist.' },
  ];
  function isoCalc() {
    const v = store.get('isoCalc', { kg: '', mg: '', days: '', done: '' });
    return `<div class="panel" id="iso-box"><b>${icon('chart')} Isotretinoin cumulative dose</b>
      <div class="grid2"><label class="field">Weight (kg)<input type="number" data-iso="kg" value="${esc(v.kg)}"></label>
        <label class="field">Current daily dose (mg)<input type="number" data-iso="mg" value="${esc(v.mg)}"></label>
        <label class="field">Days on current dose<input type="number" data-iso="days" value="${esc(v.days)}"></label>
        <label class="field">Previous total (mg, optional)<input type="number" data-iso="done" value="${esc(v.done)}"></label></div><div id="iso-out"></div></div>`;
  }
  function isoUpdate() {
    const v = {};
    document.querySelectorAll('[data-iso]').forEach((i) => { v[i.dataset.iso] = i.value; });
    store.set('isoCalc', v);
    const kg = Number(v.kg), mg = Number(v.mg), days = Number(v.days) || 0, done = Number(v.done) || 0;
    const out = $('#iso-out');
    if (!out) return;
    if (!(kg > 0)) { out.innerHTML = ''; return; }
    const tot = done + mg * days;
    const per = tot / kg;
    const left = (t) => (mg > 0 ? Math.max(0, Math.ceil((t * kg - tot) / mg)) : '—');
    out.innerHTML = `<p class="small">Total so far <b>${tot.toLocaleString()} mg</b> = <b>${per.toFixed(1)} mg/kg</b>${mg > 0 ? ` · today’s dose ${(mg / kg).toFixed(2)} mg/kg/day` : ''}.<br>
      Days left at this dose to reach 120 mg/kg: <b>${left(120)}</b> · 150 mg/kg: <b>${left(150)}</b>.</p>
      <div class="bar"><span style="width:${Math.min(100, (per / 150) * 100)}%"></span></div>`;
  }
  function renderDrugs(_, p) {
    const k = p.k || '';
    const d = PROTO.find((x) => x.k === k);
    view.innerHTML = `${D.topbar('Drug protocols')}
      <div class="scroll-x" style="margin-bottom:8px">${PROTO.map((x) => `<button class="chip ${x.k === k ? 'on' : ''}" data-act="dp-pick" data-v="${x.k}">${esc(x.name)}</button>`).join('')}</div>
      ${d ? `<div class="panel proto"><h2>${esc(d.name)}</h2>
        <div class="kv"><span>Dosing</span><b>${esc(d.dose)}</b><span>Baseline</span><b>${esc(d.base)}</b><span>Monitoring</span><b>${esc(d.mon)}</b>
        <span>Act on</span><b>${esc(d.watch)}</b><span>Key interactions</span><b>${esc(d.ix)}</b><span>Pregnancy</span><b>${esc(d.preg)}</b></div></div>
        ${d.calc ? isoCalc() : ''}
        <button class="btn full" data-act="al-drug" data-v="${esc(d.k === 'jak' ? 'upadacitinib' : d.k === 'bio' ? 'dupilumab' : d.name.toLowerCase().replace('ciclosporin', 'cyclosporine'))}">${icon('chart')}Label, FAERS safety and trials</button>`
        : '<p class="small">Pick a drug for baseline tests, monitoring schedule, what to act on, key interactions and pregnancy notes.</p>'}
      <p class="muted small" style="margin-top:14px">Summary of commonly used dermatology protocols (BAD/AAD-style). Always check the current product label and your local guideline; doses and intervals vary by country and patient.</p>`;
    if (d?.calc) { $('#iso-box').addEventListener('input', isoUpdate); isoUpdate(); }
  }
  actions['dp-pick'] = (b) => go('drugs?k=' + b.dataset.v, { replace: true });

  // ================================================================ G10: laser and light reference
  const LASERS = [
    ['KTP', '532 nm', 'Oxyhaemoglobin, melanin', 'Telangiectasia, cherry angioma, lentigines', 'I–III; high PIH risk in IV–VI', 'vascular pigment'],
    ['Pulsed dye (PDL)', '585–595 nm', 'Oxyhaemoglobin', 'Port-wine stain, infantile haemangioma, rosacea erythema, red scars, warts', 'Best I–IV; caution V–VI', 'vascular scars'],
    ['Q-switched / pico Nd:YAG 532', '532 nm', 'Melanin, red ink', 'Lentigines, red/orange tattoo', 'I–III', 'pigment tattoo'],
    ['Q-switched ruby', '694 nm', 'Melanin, dark ink', 'Lentigines, naevus of Ota, black/blue/green tattoo', 'I–III', 'pigment tattoo'],
    ['Alexandrite', '755 nm', 'Melanin, dark ink', 'Hair removal, pigment, tattoo (pico/Q-switched)', 'I–IV', 'hair pigment tattoo'],
    ['Diode', '800–810 nm', 'Melanin', 'Hair removal', 'I–V (long pulse, cooling)', 'hair'],
    ['Nd:YAG', '1064 nm', 'Melanin (low), haemoglobin, water', 'Hair removal in dark skin, deep/leg veins, black tattoo, dermal pigment (naevus of Ota), laser toning', 'Safest for V–VI', 'hair vascular tattoo pigment'],
    ['Non-ablative fractional', '1540–1550 nm', 'Water', 'Acne scars, texture, striae', 'I–VI (lower density in V–VI)', 'scars resurfacing'],
    ['Thulium fractional', '1927 nm', 'Water', 'Epidermal pigment, melasma (adjunct), photodamage', 'Caution IV–VI', 'pigment resurfacing'],
    ['Er:YAG (ablative)', '2940 nm', 'Water', 'Resurfacing, scars, benign epidermal lesions', 'PIH risk in IV–VI', 'resurfacing scars'],
    ['CO₂ (ablative)', '10,600 nm', 'Water', 'Resurfacing, acne scars, rhinophyma, benign lesions', 'Higher PIH/hypopigmentation risk in IV–VI', 'resurfacing scars'],
    ['IPL (not a laser)', '500–1200 nm', 'Melanin, haemoglobin', 'Photoageing, rosacea, lentigines, hair', 'Avoid V–VI and tanned skin', 'vascular pigment hair'],
    ['Excimer', '308 nm', 'DNA / T-cells (UVB)', 'Localised psoriasis, vitiligo', 'All types', 'phototherapy'],
    ['PDT (red / blue light)', '630 / 417 nm', 'Protoporphyrin IX', 'Actinic keratoses, Bowen’s, superficial BCC', 'All types', 'oncology'],
  ];
  function renderLasers(_, p) {
    const f = p.f || '';
    const tags = { vascular: 'Vascular', pigment: 'Pigment', hair: 'Hair', tattoo: 'Tattoo', scars: 'Scars', resurfacing: 'Resurfacing', phototherapy: 'Phototherapy', oncology: 'Skin cancer' };
    const rows = LASERS.filter((l) => !f || l[5].split(' ').includes(f));
    view.innerHTML = `${D.topbar('Laser & light guide')}
      <div class="scroll-x" style="margin-bottom:8px"><button class="chip ${!f ? 'on' : ''}" data-act="ls-f" data-v="">All</button>${Object.entries(tags).map(([k, l]) => `<button class="chip ${k === f ? 'on' : ''}" data-act="ls-f" data-v="${k}">${l}</button>`).join('')}</div>
      ${rows.map((l) => `<div class="panel laser"><div class="laser-h"><b>${esc(l[0])}</b><span class="badge">${esc(l[1])}</span></div>
        <div class="kv"><span>Target</span><b>${esc(l[2])}</b><span>Uses</span><b>${esc(l[3])}</b><span>Skin type</span><b>${esc(l[4])}</b></div>
        <button class="btn xs" data-act="ls-ev" data-q="${esc(l[0].replace(/\(.*\)/, '').trim() + ' laser ' + l[3].split(',')[0])}">${icon('chart')}Evidence</button></div>`).join('')}
      <p class="muted small">Reference only: no device settings. Parameters depend on device, skin type and indication — follow the manufacturer, your training and test spots.</p>`;
  }
  actions['ls-f'] = (b) => go('lasers?f=' + b.dataset.v, { replace: true });
  actions['ls-ev'] = (b) => go(I.evHash(b.dataset.q));

  // ================================================================ G11: CME log
  const cmeList = () => store.get('cme', []);
  const cmeAdd = (e) => store.set('cme', [{ id: uid(), t: Date.now(), ...e }, ...cmeList()].slice(0, 3000));
  let reading = null;
  function cmeFlush() {
    if (!reading) return;
    const mins = Math.round((Date.now() - reading.t0) / 60000);
    if (mins < 2) return;
    const a = D.saved.get(reading.id) || D.cache.get(reading.id);
    if (!a?.title) return;
    const list = cmeList();
    const today0 = new Date().toDateString();
    const same = list.find((x) => x.paper === reading.id && new Date(x.t).toDateString() === today0 && x.kind === 'Reading');
    if (same) { same.mins = Math.min(240, same.mins + mins); store.set('cme', list); } else cmeAdd({ kind: 'Reading', paper: reading.id, title: a.title, source: [a.jAbbr || a.journal, a.year].filter(Boolean).join(' '), mins: Math.min(240, mins) });
  }
  function cmeTrack() {
    const h = location.hash.replace(/^#\/?/, '');
    const [name, ...rest] = h.split('?')[0].split('/');
    const id = decodeURIComponent(rest.join('/'));
    const now = Date.now();
    if (reading && (reading.id !== id || !['a', 'read', 'pdf'].includes(name))) { cmeFlush(); reading = null; }
    if (!reading && ['a', 'read', 'pdf'].includes(name) && id) reading = { id, t0: now };
  }
  window.addEventListener('hashchange', cmeTrack);
  document.addEventListener('visibilitychange', () => {
    if (!reading) return;
    if (document.hidden) { cmeFlush(); reading = { id: reading.id, t0: Date.now(), paused: true }; } else if (reading.paused) reading = { id: reading.id, t0: Date.now() };
  });
  function renderCme() {
    const list = cmeList();
    const year = new Date().getFullYear();
    const yr = list.filter((x) => new Date(x.t).getFullYear() === year);
    const hours = yr.reduce((s, x) => s + (x.mins || 0), 0) / 60;
    view.innerHTML = `${D.topbar('CME log')}
      <div class="stat-row"><div class="stat-tile"><b>${hours.toFixed(1)}</b><span>hours in ${year}</span></div><div class="stat-tile"><b>${yr.filter((x) => x.kind === 'Reading').length}</b><span>papers read</span></div><div class="stat-tile"><b>${yr.filter((x) => x.kind === 'Quiz').length}</b><span>quizzes</span></div></div>
      <div class="row"><button class="btn small" data-act="cme-add">${icon('plus')}Add activity</button><button class="btn small" data-act="cme-export">${icon('download')}Export CSV</button></div>
      <p class="muted small">Reading time is logged automatically when you spend 2+ minutes on a paper. Check your CME body's rules before claiming credit.</p>
      <div class="section">${list.slice(0, 150).map((x) => `<div class="cme-row"><span>${fmtDate(x.t)}</span><div><b>${esc(x.title)}</b><small>${esc(x.kind)}${x.source ? ' · ' + esc(x.source) : ''}${x.score != null ? ' · score ' + esc(x.score) : ''}</small></div><span>${x.mins || 0} min</span><button class="icon-btn" data-act="cme-del" data-id="${x.id}" aria-label="Delete">${icon('x')}</button></div>`).join('') || '<div class="empty"><b>Nothing logged yet</b></div>'}</div>`;
  }
  actions['cme-add'] = () => {
    sheet(`<h3>Add CME activity</h3><select id="cm-k"><option>Conference</option><option>Course / webinar</option><option>Journal club</option><option>Reading</option><option>Teaching</option><option>Other</option></select>
      <input id="cm-t" placeholder="Title" style="margin-top:8px"><input id="cm-h" type="number" step="0.25" placeholder="Hours" style="margin-top:8px">
      <button class="btn primary full" data-act="cme-save" style="margin-top:8px">Save</button>`);
    actions['cme-save'] = () => { const t = $('#cm-t').value.trim(); const h = Number($('#cm-h').value); if (!t || !(h > 0)) { toast('Add a title and hours'); return; } cmeAdd({ kind: $('#cm-k').value, title: t, mins: Math.round(h * 60) }); closeSheet(true); render(); };
  };
  actions['cme-del'] = (b) => { store.set('cme', cmeList().filter((x) => x.id !== b.dataset.id)); render(); };
  actions['cme-export'] = () => {
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    exportFile(`dermscholar-cme-${I.today()}.csv`, ['date,activity,title,source,minutes,score', ...cmeList().map((x) => [new Date(x.t).toISOString().slice(0, 10), x.kind, x.title, x.source || '', x.mins || 0, x.score ?? ''].map(cell).join(','))].join('\n'), 'text/csv');
  };
  const QUIZ = obj({ questions: { type: 'array', items: obj({ q: S.str, options: { type: 'array', items: S.str }, answer: { type: 'integer' }, why: S.str }) } });
  actions['cme-quiz'] = async (b) => {
    const id = b.dataset.id;
    if (!D.aiHasKey()) { toast('Add an AI key in Settings'); return; }
    sheet(`<h3>${icon('school')} Quiz</h3><div id="qz">${I.busyHtml ? I.busyHtml('Writing questions…') : 'Writing questions…'}</div>`);
    try {
      const a = await D.findArticle(id);
      const src = await I.paperText(a);
      const r = D.aiJson(await D.ai('Write 5 multiple-choice questions (4 options each, one correct, answer = index 0-3) that test the clinically important content of this paper: design, key results with numbers, safety, and how it applies to practice. Give a one-sentence explanation for each.', { ...src, schema: QUIZ, max: 2500 }));
      const qs = (r.questions || []).filter((x) => x.options?.length >= 2).slice(0, 5);
      const picked = {};
      const draw = () => {
        const el = $('#qz');
        if (!el) return;
        const doneN = Object.keys(picked).length;
        el.innerHTML = qs.map((x, i) => `<div class="quiz-q"><p><b>${i + 1}. ${esc(x.q)}</b></p>${x.options.map((o, j) => {
          const st = picked[i] == null ? '' : j === x.answer ? 'right' : picked[i] === j ? 'wrong' : '';
          return `<button class="opt ${st}" data-act="qz-pick" data-i="${i}" data-j="${j}" ${picked[i] != null ? 'disabled' : ''}>${esc(o)}</button>`;
        }).join('')}${picked[i] != null ? `<p class="small muted">${esc(x.why)}</p>` : ''}</div>`).join('')
          + (doneN === qs.length ? `<p><b>Score ${qs.filter((x, i) => picked[i] === x.answer).length}/${qs.length}</b> — logged to CME.</p>` : '');
      };
      actions['qz-pick'] = (bb) => {
        picked[bb.dataset.i] = Number(bb.dataset.j);
        if (Object.keys(picked).length === qs.length) cmeAdd({ kind: 'Quiz', paper: id, title: a.title, source: [a.jAbbr || a.journal, a.year].filter(Boolean).join(' '), mins: 10, score: `${qs.filter((x, i) => picked[i] === x.answer).length}/${qs.length}` });
        draw();
      };
      draw();
    } catch (e) { const el = $('#qz'); if (el) el.innerHTML = I.aiErr(e); }
  };

  // ================================================================ G12: conference radar
  const CONFS = [
    ['AAD Annual Meeting', 'American Academy of Dermatology · March', 'https://www.aad.org/member/meetings-education'],
    ['EADV Congress', 'European Academy of Dermatology and Venereology · autumn', 'https://eadv.org/congress/'],
    ['World Congress of Dermatology', 'ILDS · every 4 years (next 2027, Guadalajara)', 'https://www.ilds.org/world-congress-of-dermatology/'],
    ['SID Annual Meeting', 'Society for Investigative Dermatology', 'https://www.sidnet.org/'],
    ['ESDR Annual Meeting', 'European Society for Dermatological Research', 'https://www.esdr.org/'],
    ['BAD Annual Meeting', 'British Association of Dermatologists · July', 'https://www.bad.org.uk/'],
    ['DERMACON', 'IADVL national conference (India) · early year', 'https://iadvl.org/'],
    ['ASDS Annual Meeting', 'American Society for Dermatologic Surgery', 'https://www.asds.net/'],
    ['Maui Derm', 'Clinical updates meetings', 'https://mauiderm.com/'],
    ['Fall Clinical Dermatology', 'Clinical conference · October', 'https://www.fallclinical.com/'],
    ['IID / International Investigative Dermatology', 'Joint SID–ESDR–JSID meeting · every 5 years', 'https://www.sidnet.org/'],
  ];
  async function renderConfs(_, p) {
    const topic = p.q || '';
    view.innerHTML = `${D.topbar('Conference radar')}
      <div class="section"><div class="section-h"><h3>Meetings</h3></div>${CONFS.map(([n, s, u]) => `<button class="card" data-act="cf-open" data-u="${esc(u)}"><p class="title main">${esc(n)}</p><div class="byline"><span>${esc(s)}</span></div></button>`).join('')}</div>
      <div class="section"><div class="section-h"><h3>Meeting abstracts & late-breakers</h3></div>
        <form class="searchbox compact" data-form="confs"><textarea name="q" rows="1" placeholder="Topic, e.g. lebrikizumab">${esc(topic)}</textarea><button class="go" type="submit">${icon('up')}</button></form>
        <div id="cf-out">${topic ? D.skeletons(3) : '<p class="muted small">Searches indexed congress abstracts and late-breaking presentations from the last 2 years.</p>'}</div></div>`;
    if (!topic) return;
    try {
      const qq = `(${topic}) AND (PUB_TYPE:"Congress" OR TITLE_ABS:"late-breaking" OR TITLE_ABS:"annual meeting" OR TITLE_ABS:"congress" OR JOURNAL:"Suppl") AND PUB_YEAR:[${D.THIS_YEAR - 1} TO ${D.THIS_YEAR}]`;
      const res = await D.epmcSearch(qq, { sort: 'P_PDATE_D desc', size: 25 });
      $('#cf-out').innerHTML = res.results.map((a) => D.card(a)).join('') || '<div class="muted small">Nothing indexed yet; try the meeting websites above.</div>';
    } catch (e) { $('#cf-out').innerHTML = D.errorBox(e); }
  }
  actions['cf-open'] = (b) => I.openUrl(b.dataset.u);

  // ================================================================ G13: who's who (OpenAlex)
  const oaId = (u) => String(u || '').split('/').pop();
  async function renderNetwork(_, p) {
    const topic = p.q || '';
    const author = p.au || '';
    view.innerHTML = `${D.topbar("Who's who")}
      <form class="searchbox compact" data-form="network"><textarea name="q" rows="1" placeholder="Topic, e.g. hidradenitis suppurativa">${esc(topic)}</textarea><button class="go" type="submit">${icon('up')}</button></form>
      <div id="nw-out">${topic || author ? D.skeletons(3) : '<p class="muted small">Leading authors, institutions and countries on a topic over the last 5 years, and who collaborates with whom (OpenAlex).</p>'}</div>`;
    const el = $('#nw-out');
    const bars = (rows, act) => { const max = Math.max(...rows.map((r) => r.count), 1); return rows.map((r) => `<button class="nw-bar" ${act ? `data-act="${act}" data-v="${esc(oaId(r.key))}" data-n="${esc(r.key_display_name)}"` : ''}><span>${esc(r.key_display_name)}</span><i style="width:${(r.count / max) * 100}%"></i><b>${r.count}</b></button>`).join(''); };
    try {
      if (author) {
        const [au, co] = await Promise.all([
          D.getJSON(OA + 'authors/' + author),
          D.getJSON(OA + `works?filter=authorships.author.id:${author}&group_by=authorships.author.id&per_page=30`),
        ]);
        const inst = (au.last_known_institutions || []).map((x) => x.display_name).join(', ');
        el.innerHTML = `<div class="panel"><h2>${esc(au.display_name)}</h2><p class="small">${esc(inst)}</p>
          <div class="kv"><span>Works</span><b>${au.works_count}</b><span>Citations</span><b>${au.cited_by_count}</b><span>h-index</span><b>${au.summary_stats?.h_index ?? '—'}</b></div>
          <button class="btn small" data-act="nw-papers" data-n="${esc(au.display_name)}">${icon('search')}Their papers</button></div>
          <div class="section"><div class="section-h"><h3>Frequent co-authors</h3></div>${bars((co.group_by || []).filter((r) => oaId(r.key) !== author).slice(0, 15), 'nw-au')}</div>`;
        return;
      }
      const base = `works?search=${encodeURIComponent(topic)}&filter=from_publication_date:${D.THIS_YEAR - 5}-01-01`;
      const [au, ins, cn] = await Promise.all(['authorships.author.id', 'authorships.institutions.id', 'authorships.countries'].map((g) => D.getJSON(OA + base + '&group_by=' + g)));
      el.innerHTML = `<div class="section"><div class="section-h"><h3>Top authors</h3></div>${bars((au.group_by || []).slice(0, 15), 'nw-au')}</div>
        <div class="section"><div class="section-h"><h3>Top institutions</h3></div>${bars((ins.group_by || []).slice(0, 12))}</div>
        <div class="section"><div class="section-h"><h3>Countries</h3></div>${bars((cn.group_by || []).slice(0, 12))}</div>
        <p class="muted small">Paper counts from OpenAlex, last 5 years. Name disambiguation is automated and imperfect.</p>`;
    } catch (e) { el.innerHTML = D.errorBox(e); }
  }
  actions['nw-au'] = (b) => go('network?' + new URLSearchParams({ au: b.dataset.v }));
  actions['nw-papers'] = (b) => go(D.searchHash({ ...D.filtersFrom({}), q: `AUTH:"${b.dataset.n}"`, derm: false }));

  // ================================================================ G15: knowledge map of the library
  function renderGraph(_, p) {
    const papers = [...D.saved.values()].filter((a) => !a.utd && !a.imported);
    const norm = (t) => String(t).replace(/\*/g, '').trim().toLowerCase();
    const SKIP = /^(humans?|male|female|adult|aged|middle aged|young adult|adolescent|child|animals?|mice|retrospective studies|prospective studies|treatment outcome|cohort studies|risk factors|cross-sectional studies|surveys and questionnaires|follow-up studies|severity of illness index|time factors|skin|quality of life)$/i;
    const topics = new Map();
    const tagsOf = new Map();
    for (const a of papers) {
      const tags = [...new Set([...(a.mesh || []), ...(a.keywords || [])].map(norm).filter((t) => t && t.length > 2 && !SKIP.test(t)))].slice(0, 10);
      if (!tags.length) tags.push(norm(D.topicOf(a)));
      tagsOf.set(a.id, tags);
      for (const t of tags) (topics.get(t) || topics.set(t, []).get(t)).push(a.id);
    }
    const top = [...topics.entries()].filter(([, l]) => l.length > 1 || topics.size < 15).sort((x, y) => y[1].length - x[1].length).slice(0, 28);
    const sel = p.t || '';
    if (!top.length) { view.innerHTML = `${D.topbar('Knowledge map')}<div class="empty">${icon('globe')}<b>Save a few papers first</b><div>The map links your library by shared topics.</div></div>`; return; }
    const names = top.map(([t]) => t);
    const idx = new Map(names.map((t, i) => [t, i]));
    const edges = new Map();
    for (const tags of tagsOf.values()) {
      const ts = tags.filter((t) => idx.has(t));
      for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) { const k = [idx.get(ts[i]), idx.get(ts[j])].sort((a, b) => a - b).join('-'); edges.set(k, (edges.get(k) || 0) + 1); }
    }
    // Small force-directed layout.
    const W = 600, H = 520;
    const n = names.length;
    const pos = names.map((_, i) => ({ x: W / 2 + 180 * Math.cos((2 * Math.PI * i) / n), y: H / 2 + 180 * Math.sin((2 * Math.PI * i) / n), vx: 0, vy: 0 }));
    const E = [...edges.entries()].map(([k, w]) => { const [a, b] = k.split('-').map(Number); return { a, b, w }; });
    for (let it = 0; it < 260; it++) {
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y; const d2 = dx * dx + dy * dy + 0.01; const f = 2600 / d2;
        pos[i].vx += dx * f / Math.sqrt(d2); pos[i].vy += dy * f / Math.sqrt(d2); pos[j].vx -= dx * f / Math.sqrt(d2); pos[j].vy -= dy * f / Math.sqrt(d2);
      }
      for (const e of E) { const A = pos[e.a], B = pos[e.b]; const dx = B.x - A.x, dy = B.y - A.y; const f = 0.004 * Math.min(4, e.w); A.vx += dx * f; A.vy += dy * f; B.vx -= dx * f; B.vy -= dy * f; }
      for (const q of pos) { q.vx += (W / 2 - q.x) * 0.002; q.vy += (H / 2 - q.y) * 0.002; q.x = Math.max(40, Math.min(W - 40, q.x + q.vx * 0.5)); q.y = Math.max(24, Math.min(H - 24, q.y + q.vy * 0.5)); q.vx *= 0.6; q.vy *= 0.6; }
    }
    const maxC = Math.max(...top.map(([, l]) => l.length));
    const svg = `<svg viewBox="0 0 ${W} ${H}" class="kg">${E.map((e) => `<line x1="${pos[e.a].x}" y1="${pos[e.a].y}" x2="${pos[e.b].x}" y2="${pos[e.b].y}" stroke-width="${Math.min(5, e.w)}" class="kg-e ${sel && (names[e.a] === sel || names[e.b] === sel) ? 'on' : ''}"/>`).join('')}
      ${names.map((t, i) => { const r = 6 + 14 * Math.sqrt(top[i][1].length / maxC); return `<g class="kg-n ${t === sel ? 'on' : ''}" data-act="kg-pick" data-t="${esc(t)}"><circle cx="${pos[i].x}" cy="${pos[i].y}" r="${r}"/><text x="${pos[i].x}" y="${pos[i].y + r + 11}" text-anchor="middle">${esc(t.length > 22 ? t.slice(0, 20) + '…' : t)}</text></g>`; }).join('')}</svg>`;
    const list = sel ? (topics.get(sel) || []).map((id) => D.saved.get(id)).filter(Boolean) : [];
    const linked = sel ? [...edges.entries()].map(([k, w]) => { const [a, b] = k.split('-').map(Number); return names[a] === sel ? [names[b], w] : names[b] === sel ? [names[a], w] : null; }).filter(Boolean).sort((x, y) => y[1] - x[1]).slice(0, 8) : [];
    view.innerHTML = `${D.topbar('Knowledge map')}<p class="muted small">Your ${papers.length} saved papers, linked by shared MeSH terms and keywords. Tap a topic.</p>
      <div class="panel svgbox">${svg}</div>
      ${sel ? `<div class="section"><div class="section-h"><h3>${esc(sel)} · ${list.length} papers</h3><button data-act="kg-search" data-t="${esc(sel)}">Search more</button></div>
        ${linked.length ? `<div class="row wrap">${linked.map(([t, w]) => `<button class="chip" data-act="kg-pick" data-t="${esc(t)}">${esc(t)} · ${w}</button>`).join('')}</div>` : ''}
        ${list.map((a) => miniCard(a)).join('')}</div>` : ''}`;
  }
  actions['kg-pick'] = (b) => go('graph?' + new URLSearchParams({ t: b.dataset.t }), { replace: true });
  actions['kg-search'] = (b) => go(D.searchHash({ ...D.filtersFrom({}), q: b.dataset.t }));

  // ================================================================ G16: photo search
  function renderVisual() {
    view.innerHTML = `${D.topbar('Photo search')}
      <p class="small">Take or choose a clinical, dermoscopic or histology photo. AI describes what it sees, then DermScholar finds matching literature and images.</p>
      <div class="panel small">${icon('alert')} ${esc(I.EDU || 'Educational use only.')} Results are approximate: this is a literature search, not a diagnosis. Don't upload identifiable photos.</div>
      <button class="btn primary full" data-act="vs-pick">${icon('camera')}Choose photo</button><div id="vs-out" class="section"></div>`;
  }
  actions['vs-pick'] = async () => {
    if (!D.aiHasKey()) { $('#vs-out').innerHTML = I.keyCard(); return; }
    let url;
    try { url = await shrink(await I.pickImage(), 1200); } catch (e) { if (!/cancel/i.test(e.message)) toast(e.message); return; }
    const out = $('#vs-out');
    out.innerHTML = `<img class="case-img" src="${url}" alt="">${I.busyHtml ? I.busyHtml('Looking at the photo…') : D.skeletons(2)}`;
    try {
      const text = await I.aiImage('Describe the image in dermatological terms in 3-5 short bullet points (image type, morphology, colour, distribution or dermoscopic/histological pattern). Then list the 3 most likely diagnoses to search for. '
        + 'End with exactly one line: "SEARCH: term1; term2; term3" using short literature search phrases.', url,
      'You are a dermatology educator helping a clinician search the literature. Describe only what is visible; say when the quality limits interpretation. Markdown.');
      const terms = (text.match(/SEARCH:\s*(.+)/i)?.[1] || '').split(/[;,]/).map((x) => x.trim()).filter(Boolean).slice(0, 3);
      out.innerHTML = `<img class="case-img" src="${url}" alt=""><div class="panel synth">${md(text.replace(/SEARCH:.*$/im, ''))}</div>
        <div class="row wrap">${terms.map((t) => `<button class="chip" data-act="vs-term" data-q="${esc(t)}">${icon('search')}${esc(t)}</button><button class="chip" data-act="case-lit" data-q="${esc(t)}">${icon('camera')}Images</button>`).join('')}</div>
        <div id="vs-res">${terms.length ? D.skeletons(3) : ''}</div>`;
      if (terms[0]) {
        const res = await D.epmcSearch(D.buildQuery({ ...D.filtersFrom({}), q: terms[0], derm: true }), { size: 8 });
        const el = $('#vs-res');
        if (el) el.innerHTML = `<div class="section-h"><h3>Literature: ${esc(terms[0])}</h3></div>${res.results.map((a) => D.card(a)).join('')}`;
      }
    } catch (e) { out.innerHTML = I.aiErr(e); }
  };
  actions['vs-term'] = (b) => go(D.searchHash({ ...D.filtersFrom({}), q: b.dataset.q }));

  // ================================================================ G14: shareable reading lists
  const LIST_HEAD = 'DermScholar reading list';
  function listText(name, items) {
    return `${LIST_HEAD}: ${name}\n\n${items.map((a, i) => `${i + 1}. ${a.title} — ${[a.jAbbr || a.journal, a.year].filter(Boolean).join(' ')}\n   ${a.doi ? 'doi:' + a.doi : a.pmid ? 'PMID:' + a.pmid : ''}`).join('\n')}\n\nOpen in DermScholar: Tools → Reading lists → Import, and paste this message.`;
  }
  function renderShared() {
    const colls = D.collections;
    const all = [...D.saved.values()].filter((a) => !a.utd && !a.imported);
    view.innerHTML = `${D.topbar('Reading lists')}
      <p class="small">Share a collection as a message (WhatsApp, email, Telegram). Anyone with DermScholar can import it in one tap; others get normal DOI links.</p>
      <div class="section"><div class="section-h"><h3>Share a collection</h3></div>
        ${colls.map((c) => { const n = all.filter((a) => (a.collections || []).includes(c)).length; return `<button class="opt" data-act="rl-share" data-c="${esc(c)}" ${n ? '' : 'disabled'}>${icon('share')}<span>${esc(c)} · ${n} papers</span></button>`; }).join('')}
        <button class="opt" data-act="rl-share" data-c="">${icon('share')}<span>Whole library · ${all.length} papers</span></button></div>
      <div class="section"><div class="section-h"><h3>Import a list</h3></div>
        <textarea id="rl-in" rows="5" placeholder="Paste a shared reading list, or any text with DOIs / PMIDs"></textarea>
        <button class="btn primary full" data-act="rl-import" style="margin-top:8px">${icon('download')}Import</button><div id="rl-out"></div></div>`;
  }
  actions['rl-share'] = (b) => {
    const c = b.dataset.c;
    const items = [...D.saved.values()].filter((a) => !a.utd && !a.imported && (!c || (a.collections || []).includes(c))).slice(0, 150);
    const text = listText(c || 'My library', items);
    if (Native.share) Native.share(`${LIST_HEAD}: ${c || 'My library'}`, text); else D.copyText?.(text);
  };
  actions['rl-import'] = async () => {
    const text = $('#rl-in').value;
    const name = (text.match(new RegExp(LIST_HEAD + ':\\s*(.+)')) || [])[1]?.trim() || 'Imported ' + I.today();
    const dois = [...new Set([...text.matchAll(/\b(10\.\d{4,9}\/[^\s"<>,;]+[^\s"<>,;.)])/g)].map((m) => m[1].toLowerCase()))];
    const pmids = [...new Set([...text.matchAll(/PMID:?\s*(\d{5,9})/gi)].map((m) => m[1]))];
    const out = $('#rl-out');
    if (!dois.length && !pmids.length) { out.innerHTML = '<p class="small">No DOIs or PMIDs found in that text.</p>'; return; }
    out.innerHTML = D.skeletons(2);
    const found = [];
    const ids = [...dois.map((d) => `DOI:"${d}"`), ...pmids.map((p) => `EXT_ID:${p}`)];
    for (let i = 0; i < ids.length; i += 25) {
      try { found.push(...(await D.epmcSearch(`(${ids.slice(i, i + 25).join(' OR ')})`, { size: 25 })).results); } catch { /* skip batch */ }
    }
    const uniq = [...new Map(found.map((a) => [a.id, a])).values()];
    if (!uniq.length) { out.innerHTML = '<p class="small">Couldn\'t find those papers.</p>'; return; }
    D.addCollection(name);
    for (const a of uniq) {
      if (!D.saved.has(a.id)) await D.saveArticle(a);
      const s = D.saved.get(a.id);
      await D.updateSaved(a.id, { collections: [...new Set([...(s.collections || []), name])] });
    }
    out.innerHTML = `<div class="panel small">${icon('check')} Added ${uniq.length} paper${uniq.length > 1 ? 's' : ''}${uniq.length < dois.length + pmids.length ? ` (${dois.length + pmids.length - uniq.length} not found)` : ''} to the collection “${esc(name)}”.</div>${uniq.map((a) => miniCard(a)).join('')}`;
  };

  // ================================================================ hub: tools section on the Intel page and Library entry points
  const TOOLS = [
    ['alerts', '🚨', 'Alerts', 'Retractions · new guidelines · FDA labels'],
    ['living', '📈', 'Living guidelines', 'Disease by disease, what changed'],
    ['sr', '📐', 'Systematic review kit', 'PRISMA · meta-analysis · forest plot'],
    ['cases', '📷', 'My cases', 'Private photos · timeline · papers'],
    ['drugs', '🩺', 'Drug protocols', 'Monitoring · interactions · isotretinoin dose'],
    ['lasers', '🔦', 'Laser & light guide', 'Wavelength · target · skin type'],
    ['visual', '🔍', 'Photo search', 'Find literature from a photo'],
    ['cme', '🎓', 'CME log', 'Reading time · quizzes · export'],
    ['confs', '🗓️', 'Conference radar', 'Meetings · abstracts · late-breakers'],
    ['network', '🕸️', "Who's who", 'Top authors · institutions · co-authors'],
    ['graph', '🗺️', 'Knowledge map', 'Your library by topic'],
    ['shared', '🔗', 'Reading lists', 'Share and import collections'],
  ];
  const toolsHtml = () => `<div class="section"><div class="section-h"><h3>Clinical & research tools</h3></div><div class="intel-tiles">${TOOLS.map(([k, e, t, s]) => `<button class="intel-tile" data-act="intel-go" data-k="${k}"><span class="e">${e}</span><b>${esc(t)}</b><span>${esc(s)}</span></button>`).join('')}</div></div>`;
  const prevIntel = ext.routes.intel;
  const prevHome = ext.homeIntel;
  if (prevHome) ext.homeIntel = () => prevHome().replace(/<\/div>$/, '') + `<div class="intel-tiles" style="margin-top:10px">${TOOLS.slice(0, 4).map(([k, e, t, s]) => `<button class="intel-tile" data-act="intel-go" data-k="${k}"><span class="e">${e}</span><b>${esc(t)}</b><span>${esc(s)}</span></button>`).join('')}</div></div>`;

  Object.assign(ext.routes, {
    intel: (...a) => { prevIntel(...a); view.lastElementChild.insertAdjacentHTML('beforebegin', toolsHtml()); },
    clin: renderClin, alerts: renderAlerts, living: renderLiving, sr: renderSr, cases: renderCases, case: renderCase,
    drugs: renderDrugs, lasers: renderLasers, cme: renderCme, confs: renderConfs, network: renderNetwork, graph: renderGraph,
    visual: renderVisual, shared: renderShared,
  });
})();
