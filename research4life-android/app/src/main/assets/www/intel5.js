// DermScholar Intel, part 5: Deep review (SciSpace S1 / Consensus C5). Searches widely, has the
// AI screen a few hundred abstracts against the question, then writes a structured, referenced
// literature review (search strategy and counts, themes, evidence table, agreements and
// disagreements, gaps), exportable to Word or slides.
(() => {
  'use strict';
  const D = window.DS;
  const I = window.DSI;
  const { $, esc, icon, md, store, go, actions, ext } = D;
  const view = $('#view');

  const SCREEN = { type: 'object', additionalProperties: false, required: ['include'], properties: { include: { type: 'array', items: { type: 'integer' } } } };
  const PER_SEARCH = 60;   // records fetched per planned search
  const TO_SCREEN = 160;   // abstracts the AI screens (the most relevant)
  const BATCH = 20;        // abstracts per screening request
  const TO_WRITE = 28;     // included studies the review is written from (the strongest)
  // One review at a time, kept running when you leave the screen; a bar above the tabs shows its
  // progress elsewhere in the app and turns into "ready — Open" when it is done.
  let job = null; // { question, st, text, done, error }
  const onPage = (q) => D.current.name === 'review' && (D.current.params?.q || '').trim().toLowerCase() === q.toLowerCase();
  function bar() {
    let el = document.getElementById('rv-bar');
    const show = job && !onPage(job.question) && (!job.done || !job.seen);
    if (!show) { el?.remove(); return; }
    if (!el) { el = document.createElement('button'); el.id = 'rv-bar'; el.className = 'rv-bar'; el.dataset.act = 'rv-bar'; document.body.appendChild(el); }
    const c = job.st?.c;
    el.innerHTML = job.error ? `📑 Deep review stopped · <b>Open</b>`
      : job.done ? `📑 Deep review ready · <b>Open</b>`
        : `<span class="spin"></span>📑 Deep review · ${c?.screened ? `screened ${c.screened}` : 'searching'}${job.text ? ' · writing' : ''}…`;
  }
  actions['rv-bar'] = () => { if (job) go('review?' + new URLSearchParams({ q: job.question })); };
  const recent = () => store.get('reviews.recent', []);
  function remember(q) { store.set('reviews.recent', [q, ...recent().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 12)); }

  const slim = (a) => ({ id: a.id, title: a.title, authors: a.authors, journal: a.journal, jAbbr: a.jAbbr, year: a.year, doi: a.doi, types: a.types, abstract: D.stripTags(a.abstract || '').slice(0, 700) });
  const firstAuthor = (a) => (a.authors ? a.authors.split(',')[0].trim() + (a.authors.includes(',') ? ' et al.' : '') : 'Anonymous');
  const refLine = (r) => `${firstAuthor(r.a)} ${r.a.title} ${r.a.jAbbr || r.a.journal || ''} ${r.a.year || ''}.${r.a.doi ? ' doi:' + r.a.doi : ''}`;

  async function renderReview(_, p) {
    const q0 = (p.q || '').trim();
    view.innerHTML = `${D.topbar('Deep review')}
      <form class="searchbox compact" data-form="review"><textarea name="q" rows="2" placeholder="e.g. Efficacy and safety of JAK inhibitors in vitiligo">${esc(q0)}</textarea><button class="go" type="submit">${icon('up')}</button></form>
      <p class="muted small">Searches widely, screens up to ${TO_SCREEN} abstracts against your question, then writes a structured literature review with an evidence table and references. Takes a minute or two.</p>
      <div id="rv-steps"></div><div id="rv-out"></div>
      ${!q0 && recent().length ? `<div class="section"><div class="section-h"><h3>Your reviews</h3></div><div class="list-card">${recent().map((q) => `<button class="example" data-act="rv-open" data-q="${esc(q)}">${icon('file')}<span>${esc(q)}</span></button>`).join('')}</div></div>` : ''}`;
    actions['rv-open'] = (b) => go('review?' + new URLSearchParams({ q: b.dataset.q }));
    bar();
    if (!q0) return;
    if (job && job.question.toLowerCase() === q0.toLowerCase()) {
      job.seen = true;
      if (job.done && job.result) { show(q0, job.result); return; }
      if (job.error) { $('#rv-out').innerHTML = I.aiErr(job.error); job = null; return; }
      paintJob();
      return;
    }
    run(q0);
  }
  /** Redraws the running review's progress (and its answer so far) when its screen is open. */
  function paintJob() {
    bar();
    if (!job || !onPage(job.question)) return;
    const stepsEl = $('#rv-steps');
    const out = $('#rv-out');
    if (stepsEl && job.st) stepsEl.innerHTML = stepsHtml(job.st);
    if (out) out.innerHTML = job.text ? `<div class="panel synth review">${I.citeHtml(md(job.text), job.ctx)}<span class="typing">▍</span></div>` : I.busyHtml(job.status || 'Working…');
  }
  document.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-form=review]');
    if (!f) return;
    e.preventDefault();
    const v = f.q.value.trim();
    if (v) go('review?' + new URLSearchParams({ q: v }), { replace: true });
  });

  function counts(c) {
    const box = (n, l) => `<div><b>${n}</b><span>${l}</span></div>`;
    return `<div class="ev-tot">${box(c.retrieved, 'Retrieved')}${box(c.unique, 'Unique')}${box(c.screened, 'Screened')}${box(c.included, 'Included')}</div>`;
  }
  function stepsHtml(st) {
    return `<div class="panel ev-steps">${counts(st.c)}${st.lines.map((x) => `<div class="ev-step">${icon(x.done ? 'check' : 'search')}<span>${esc(x.label)}</span><b>${esc(String(x.n ?? ''))}</b></div>`).join('')}</div>`;
  }

  async function run(question) {
    const out0 = $('#rv-out');
    if (I.needKey()) { out0.innerHTML = I.keyCard(); return; }
    const ck = 'review1.' + question.toLowerCase();
    const cached = I.cacheGet(ck);
    if (cached) { show(question, cached); return; }
    if (job && !job.done && !job.error) { out0.innerHTML = `<div class="panel">A review is already running: <b>${esc(job.question)}</b>. It continues in the background; start this one when it is ready.</div>`; return; }

    const st = { c: { retrieved: 0, unique: 0, screened: 0, included: 0 }, lines: [] };
    const my = job = { question, st, text: '', seen: true };
    const live = () => job === my;
    const paint = () => paintJob();
    // Status text for the screen (when open); the work goes on either way.
    const out = { set innerHTML(h) { const m = /class="spin"><\/span>([^<]*)/.exec(h); my.status = m ? m[1] : my.status; if (onPage(question)) { const o = $('#rv-out'); if (o) o.innerHTML = h; } bar(); } };
    remember(question);
    out.innerHTML = I.busyHtml('Planning the searches…');
    try {
      // 1. Search: every planned search, plus guidelines and systematic reviews on the core one.
      const plan = await I.planSearch(question);
      const filters = ` AND HAS_ABSTRACT:y NOT SRC:PPR NOT PUB_TYPE:"Case Reports" ${D.NOISE}`;
      const skin = () => ''; // planned searches already name the condition (see intel.js q())
      const specs = plan.searches.map((sp) => ({ label: sp.label, query: `(${sp.query})${skin(sp.query)}${filters}`, size: PER_SEARCH }));
      if (plan.searches[0]) {
        const core = plan.searches[0].query;
        specs.push({ label: 'Guidelines and consensus', query: `(${core})${skin(core)} AND ${I.GUIDE}${filters}`, size: 15 });
        specs.push({ label: 'Systematic reviews and meta-analyses', query: `(${core})${skin(core)} AND (PUB_TYPE:"Systematic Review" OR PUB_TYPE:"Meta-Analysis" OR TITLE:"meta-analysis" OR TITLE:"systematic review")${filters}`, size: 25 });
      }
      out.innerHTML = I.busyHtml('Searching…');
      const score = new Map();
      const papers = new Map();
      await Promise.all(specs.map(async (sp, i) => {
        const line = { label: sp.label, n: '…' };
        st.lines.push(line);
        paint();
        const r = await I.epmc({ query: sp.query }, sp.size);
        line.n = r.hit || 0;
        line.done = true;
        st.c.retrieved += r.hit || 0;
        (r.results || []).forEach((a, k) => {
          if (!a.abstract) return;
          papers.set(a.id, a);
          score.set(a.id, (score.get(a.id) || 0) + (i === 0 ? 1.2 : 1) / (1 + k / 8));
        });
        st.c.unique = papers.size;
        paint();
      }));
      if (!live()) return;
      if (papers.size < 3) throw new Error('Too few papers found. Try broader words, or a shorter question.');

      // 2. Screen: the most relevant abstracts, in batches, against the question.
      const rank = (a) => (score.get(a.id) || 0) * (1 + 0.12 * (D.studyType(a).rank || 0)) * (D.keyJournal(a) ? 1.25 : 1) + Math.log10(1 + (a.citedBy || 0)) * 0.35;
      const pool = [...papers.values()].sort((x, y) => rank(y) - rank(x)).slice(0, TO_SCREEN);
      const screenLine = { label: 'AI screening abstracts against the question', n: `0/${pool.length}` };
      st.lines.push(screenLine);
      paint();
      const included = [];
      for (let i = 0; i < pool.length; i += BATCH) {
        if (!live()) return;
        const batch = pool.slice(i, i + BATCH);
        out.innerHTML = I.busyHtml(`Screening abstracts ${i + 1}–${i + batch.length} of ${pool.length}…`);
        const doc = batch.map((a, k) => `[${k + 1}] ${D.studyType(a).label} · ${a.year} · ${a.title}. ${I.absShort(a, 320)}`).join('\n\n');
        let keep;
        try {
          const r = D.aiJson(await D.ai(`QUESTION: ${question}\n\nScreen these abstracts for a literature review on the question. Include a paper only if it reports data, a review or guidance that bears directly on the question (any design). `
            + 'Exclude papers about a different condition, population or intervention, and ones that mention the topic only in passing. Return the numbers of the papers to include.',
          { doc, system: 'You are a systematic reviewer screening titles and abstracts. Be inclusive of relevant evidence, strict about relevance.', schema: SCREEN, max: 600 }));
          keep = (r.include || []).filter((n) => n >= 1 && n <= batch.length).map((n) => batch[n - 1]);
        } catch {
          // A failed batch keeps its most relevant half rather than stopping the review.
          keep = batch.slice(0, Math.ceil(batch.length / 2));
        }
        included.push(...keep);
        st.c.screened = Math.min(pool.length, i + batch.length);
        st.c.included = included.length;
        screenLine.n = `${st.c.screened}/${pool.length}`;
        paint();
      }
      screenLine.done = true;
      paint();
      if (included.length < 2) throw new Error('Almost nothing passed screening: the papers found don\'t address this question directly. Try rephrasing it.');

      // 3. Write from the strongest included studies.
      const all = included.map((a, i) => ({ kind: 'paper', a, type: D.studyType(a).label, n: i + 1 }));
      const use = I.bestRefs(all, TO_WRITE).map((r, i) => ({ ...r, n: i + 1 }));
      const ctx = I.newCtx(use);
      st.lines.push({ label: `Writing the review from the strongest ${use.length} included studies`, n: use.length, done: false });
      paint();
      const doc = use.map((r) => `[${r.n}] ${r.type} · ${firstAuthor(r.a)} ${r.a.jAbbr || r.a.journal} ${r.a.year} · ${r.a.title}. ${I.absShort(r.a, 420)}`).join('\n\n');
      out.innerHTML = I.busyHtml('Writing the review…');
      const text = await D.ai(`REVIEW QUESTION: ${question}\n\nWrite a structured literature review for dermatologists from the numbered studies. Use exactly these Markdown sections:\n`
        + '## Summary — 4-6 sentences answering the question directly, with the overall strength of evidence.\n'
        + '## Themes — 3 to 6 "### " subsections grouping the findings (e.g. efficacy, safety, special populations, mechanisms), each a short paragraph with citations and key numbers.\n'
        + '## Evidence table — a Markdown table with columns Study | Design | N | Population | Key finding, one row per important study (up to 15), Study as "First author Year [n]".\n'
        + '## Where studies agree and disagree — bullets, with reasons for disagreement (populations, doses, endpoints, follow-up, design).\n'
        + '## Gaps and future research — bullets.\n'
        + '## Conclusion — 2-3 sentences for practice.\n'
        + 'Cite every claim from the studies like [3] or [2, 5]; keep numbers exactly as reported; never invent studies or numbers. No preamble, no reference list (it is added separately).',
      { doc, system: I.CITE_SYSTEM, max: 5000, onPartial: (t) => { my.text = t; my.ctx = ctx; paintJob(); } });
      const result = { question, text, counts: { ...st.c, cited: use.length }, searches: specs.map((sp, i) => ({ label: sp.label, hit: st.lines[i]?.n || 0 })), refs: use.map((r) => ({ n: r.n, type: r.type, a: slim(r.a) })), at: Date.now() };
      I.cacheSet(ck, result);
      my.done = true;
      my.result = result;
      if (onPage(question)) { my.seen = true; show(question, result); } else my.seen = false;
      bar();
    } catch (e) {
      my.error = e;
      my.done = true;
      if (onPage(question)) { $('#rv-out').innerHTML = I.aiErr(e); job = null; } else my.seen = false;
      bar();
    }
  }
  // Keep the bar right as you move around the app.
  window.addEventListener('hashchange', () => setTimeout(bar, 50));

  function strategyMd(r) {
    const c = r.counts;
    return `## Search strategy\nEurope PMC (PubMed/MEDLINE, PMC, Cochrane), searched ${new Date(r.at).toLocaleDateString()}, records with abstracts, no case reports or preprints.\n`
      + r.searches.map((s) => `- ${s.label}: ${s.hit} records`).join('\n')
      + `\n\n${c.retrieved} records retrieved · ${c.unique} unique with abstracts · ${c.screened} screened by AI against the question · ${c.included} included · the strongest ${c.cited} cited below.\n`;
  }
  const refsMd = (r) => '## References\n' + r.refs.map((x) => `${x.n}. ${refLine(x)}`).join('\n');

  function show(question, r) {
    const stepsEl = $('#rv-steps');
    const out = $('#rv-out');
    if (!out) return;
    const refs = r.refs.map((x) => ({ kind: 'paper', a: x.a, type: x.type, n: x.n }));
    const ctx = I.newCtx(refs);
    if (stepsEl) stepsEl.innerHTML = `<div class="panel ev-steps">${counts(r.counts)}</div>`;
    const id = I.offerExport(() => toReport(question, r), ctx);
    out.innerHTML = `<div class="panel synth review">${md(strategyMd(r))}${I.citeHtml(md(r.text), ctx)}
      <h2>References</h2><ol class="rv-refs">${r.refs.map((x) => `<li><button class="linkish" data-act="open" data-id="${esc(x.a.id)}">${esc(refLine(x))}</button></li>`).join('')}</ol>
      <p class="muted small">AI screening and writing can misjudge an abstract: check key numbers in the papers.</p>
      <div class="row wrap" style="gap:6px">${I.exportBtns(id)} <button class="btn xs" data-act="rv-copy">${icon('quote')}Copy</button> <button class="btn xs" data-act="rv-redo">${icon('spark')}Redo</button></div></div>`;
    actions['rv-copy'] = () => D.copyText(`# ${question}\n\n${strategyMd(r)}\n${r.text}\n\n${refsMd(r)}`);
    actions['rv-redo'] = () => { store.set('intel.review1.' + question.toLowerCase(), null); run(question); };
  }

  /** The review as an exportable report: Markdown headings, bullets, tables and paragraphs → blocks. */
  function toReport(question, r) {
    const blocks = [];
    let ul = null;
    let table = null;
    const flush = () => { if (ul) blocks.push({ ul }); if (table) blocks.push({ table }); ul = null; table = null; };
    const clean = (t) => t.replace(/\*\*(.+?)\*\*/g, '$1').replace(/(^|\s)_(.+?)_(?=\s|$)/g, '$1$2').trim();
    for (const line of `${strategyMd(r)}\n${r.text}`.split('\n')) {
      const t = line.trim();
      if (!t) { flush(); continue; }
      if (/^#{2,4}\s/.test(t)) { flush(); blocks.push({ h: clean(t.replace(/^#+\s*/, '')) }); continue; }
      if (/^\|/.test(t)) {
        const cells = t.replace(/^\||\|$/g, '').split('|').map((x) => clean(x));
        if (cells.every((x) => /^:?-{2,}:?$/.test(x))) continue;
        if (!table) { if (ul) { blocks.push({ ul }); ul = null; } table = { caption: '', columns: cells, rows: [] }; } else table.rows.push(cells);
        continue;
      }
      if (/^[-*•]\s+/.test(t)) { if (table) { blocks.push({ table }); table = null; } (ul ||= []).push(clean(t.replace(/^[-*•]\s+/, ''))); continue; }
      flush();
      blocks.push({ p: clean(t) });
    }
    flush();
    blocks.push({ h: 'References' }, { ul: r.refs.map((x) => `[${x.n}] ${refLine(x)}`) });
    return { title: question, subtitle: `Literature review · ${new Date(r.at).toLocaleDateString()}`, blocks };
  }

  // On the Intel tab, beside the evidence map.
  I.TILES.splice(2, 0, ['review', '📑', 'Deep review', 'Screens 100+ papers · structured, referenced review']);
  Object.assign(ext.routes, { review: renderReview });
})();
