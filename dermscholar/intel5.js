// DermScholar Intel, part 5: Deep review (SciSpace S1 / Consensus C5). Searches widely, has the
// AI screen a few hundred abstracts against the question, then writes a structured, referenced
// literature review (search strategy and counts, themes, evidence table, agreements and
// disagreements, gaps), exportable to Word or slides.
(() => {
  'use strict';
  const D = window.DS;
  const I = window.DSI;
  const { $, $$, esc, icon, md, store, go, actions, ext, toast, render } = D;
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
      I.remember('review', question, 'review?' + new URLSearchParams({ q: question }), { keys: [ck] });
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


  // ================================================================ Diagnose from picture
  // Clinical, dermoscopy, trichoscopy, nail, histopathology, KOH or other smears, Wood's lamp: up to
  // 12 pictures of one case (e.g. clinical + dermoscopy + histology) are sent to the AI together
  // (joined into one labelled grid where the app can only send one picture), read together with the clinical details, and answered as a structured differential that
  // links to the evidence, published images and case reports.
  const DX_KINDS = {
    clinical: ['Clinical', 'a clinical photograph: describe the primary lesion, colour, surface, border, configuration, distribution and site'],
    dermoscopy: ['Dermoscopy', 'a dermoscopy image: name the dermoscopic structures, colours, vessels and global pattern (use standard terminology, e.g. pigment network, dots/globules, blue-white veil, arborizing vessels)'],
    tricho: ['Trichoscopy', 'a trichoscopy image: hair shafts, follicular openings, perifollicular and interfollicular signs (e.g. exclamation-mark hairs, yellow dots, perifollicular scale)'],
    nail: ['Nail', 'a nail or onychoscopy image: nail plate, bed, folds, colour, pitting, onycholysis, longitudinal bands and their features'],
    histo: ['Histopathology', 'a histopathology slide: stain if recognisable, magnification, architecture, epidermis, dermis and subcutis, infiltrate (type and pattern), and any organisms or deposits'],
    koh: ['KOH / smear', 'a microscopy preparation (KOH mount, Tzanck smear, Gram or other stain, skin scraping for scabies, slit-skin smear, fungal culture): name the preparation if recognisable and describe hyphae, spores, cells, organisms, mites or eggs seen'],
    woods: ["Wood's lamp", "a Wood's lamp image: the fluorescence colour, its distribution and what it suggests (e.g. coral-red erythrasma, yellow-green Microsporum, enhanced vitiligo)"],
    other: ['Other', 'a dermatology-related image (patch test, culture plate, investigation, figure)'],
  };
  const LIKE = { high: ['strong', 'High', 9], moderate: ['moderate', 'Moderate', 6], low: ['limited', 'Low', 3] };
  const likeHtml = (l) => {
    const [cls, word, n] = LIKE[l] || LIKE.low;
    return `<span class="strength s-${cls}" title="${word} likelihood"><span class="meter">${Array.from({ length: 10 }, (_, i) => `<i${i < n ? ' class="on"' : ''}></i>`).join('')}</span><em>${word}</em></span>`;
  };
  const DX_MAX = 12;
  let dxPics = [];     // [{ url, kind }]
  let dxKind = 'clinical';
  let dxShown = null;  // the last answer, kept when you come back to the screen
  const dxRecent = () => store.get('dx.recent', []);

  /** Joins the pictures into one image (a grid of up to 4 per row), each labelled with its number and type. */
  function collage(pics) {
    if (pics.length === 1) return Promise.resolve(pics[0].url);
    return Promise.all(pics.map((p) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = p.url; })))
      .then((imgs) => {
        const cells = imgs.map((im, i) => (im ? { im, i } : null)).filter(Boolean);
        const cols = Math.min(4, Math.ceil(Math.sqrt(cells.length)));
        const rows = Math.ceil(cells.length / cols);
        const CW = Math.round(2400 / cols), CH = Math.round(CW * 0.8), GAP = 10, BAR = 40;
        const c = document.createElement('canvas');
        c.width = cols * CW + GAP * (cols - 1); c.height = rows * (CH + BAR) + GAP * (rows - 1);
        const g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        cells.forEach(({ im, i }, n) => {
          const x0 = (n % cols) * (CW + GAP), y0 = Math.floor(n / cols) * (CH + BAR + GAP);
          const k = Math.min(CW / im.width, CH / im.height);
          const w = im.width * k, h = im.height * k;
          g.drawImage(im, x0 + (CW - w) / 2, y0 + BAR + (CH - h) / 2, w, h);
          g.fillStyle = '#111'; g.font = 'bold 28px sans-serif';
          g.fillText(`${i + 1}. ${DX_KINDS[pics[i].kind]?.[0] || 'Image'}`, x0 + 8, y0 + 30);
        });
        return c.toDataURL('image/jpeg', 0.85);
      });
  }
  const thumb = (url) => I.shrink(url, 220);
  // Kinds whose photos are checked for blur, light and glare (microscopy and Wood's lamp are dark or soft by nature).
  const DX_CHECK = new Set(['clinical', 'dermoscopy', 'tricho', 'nail']);
  /** Sharpness, light and glare, measured on the phone on a small copy of the photo; null when it looks fine (same check as Lesionaut). */
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

  function renderDx(_, p = {}) {
    if (p.at) {
      const old = dxRecent().find((x) => String(x.at) === String(p.at)) || I.history().find((x) => x.kind === 'dx' && x.data && String(x.data.at) === String(p.at))?.data;
      if (old && dxShown?.at !== old.at) { dxShown = old; dxPics = []; }
    }
    view.innerHTML = `${D.topbar('Diagnose from picture')}
      <p class="small">Add up to 12 pictures of one case (e.g. clinical, dermoscopy and histology together). Use photos taken with consent, without faces or other identifying features.</p>
      <div class="row wrap" id="dx-kinds">${Object.entries(DX_KINDS).map(([k, [l]]) => `<button class="chip ${k === dxKind ? 'on' : ''}" data-act="dx-kind" data-v="${k}">${esc(l)}</button>`).join('')}</div>
      <div id="dx-pics" class="dx-pics"></div>
      <textarea id="dx-ctx" class="dx-ctx" rows="2" placeholder="Clinical details (optional): age, sex, site, duration, symptoms, stain or magnification" style="margin-top:8px">${esc(store.get('dx.ctx', ''))}</textarea>
      <button class="btn primary full dx-go" data-act="dx-go">${icon('search')}Diagnose</button>
      <div id="dx-out"></div>
      <div id="dx-recent"></div>`;
    paintPics();
    if (dxJob) dxJob.seen = dxJob.state !== 'running' ? true : dxJob.seen;
    dxBar();
    if (dxJob?.state === 'running') $('#dx-out').innerHTML = busyDx();
    else if (dxJob?.state === 'error' && !dxShown) { $('#dx-out').innerHTML = I.aiErr(new Error(dxJob.message)); dxJob = null; paintRecent(); }
    else if (dxShown) showDx(dxShown); else paintRecent();
  }
  function paintPics() {
    const el = $('#dx-pics');
    if (!el) return;
    const tips = dxPics.map((p, i) => (p.q ? `<li><b>${i + 1}. ${esc(p.q)}:</b> ${esc(p.qTip)}</li>` : '')).join('');
    el.innerHTML = dxPics.map((p, i) => `<div class="dx-pic${p.q ? ' dx-warnpic' : ''}"><img src="${p.url}" alt="">${p.q ? `<em class="dx-q">${esc(p.q)}</em>` : ''}<small>${i + 1}. ${esc(DX_KINDS[p.kind][0])}</small><button class="dx-x" data-act="dx-del" data-i="${i}" aria-label="Remove">×</button></div>`).join('')
      + (dxPics.length < DX_MAX ? `<button class="dx-add" data-act="dx-pick">${icon('camera')}<span>${dxPics.length ? 'Add another' : 'Add picture'}<br><small>${esc(DX_KINDS[dxKind][0])}</small></span></button>` : '')
      + (tips ? `<ul class="dx-tips small">${tips}<li class="muted">You can still diagnose; a retake usually reads better.</li></ul>` : '');
  }
  function paintRecent() {
    const el = $('#dx-recent');
    const list = dxRecent();
    if (!el || !list.length) return;
    el.innerHTML = `<div class="section"><div class="section-h"><h3>Recent</h3><button data-act="dx-clear">Clear</button></div>
      ${list.map((r, i) => `<button class="dx-row" data-act="dx-old" data-i="${i}"><img src="${r.thumb}" alt=""><span><b>${esc(r.r.diagnosis || 'Picture')}</b><small>${esc(r.kinds)} · ${new Date(r.at).toLocaleDateString()}</small></span></button>`).join('')}</div>`;
  }
  actions['dx-kind'] = (b) => { dxKind = b.dataset.v; $$('[data-act=dx-kind]').forEach((x) => x.classList.toggle('on', x === b)); paintPics(); };
  actions['dx-pick'] = async () => {
    let urls;
    try { urls = await I.pickImages(DX_MAX - dxPics.length); } catch (e) { if (!/cancel/i.test(e.message || '')) toast(e.message || 'Couldn\'t open the photos'); return; }
    for (const u of urls.slice(0, DX_MAX - dxPics.length)) {
      const pic = { url: await I.shrink(u, 1400), kind: dxKind };
      if (DX_CHECK.has(dxKind)) { const q = await photoCheck(u); if (q) { pic.q = q.label; pic.qTip = q.tip; } }
      dxPics.push(pic);
    }
    dxShown = null;
    paintPics();
  };
  actions['dx-del'] = (b) => { dxPics.splice(+b.dataset.i, 1); paintPics(); };
  actions['dx-clear'] = () => { store.set('dx.recent', []); $('#dx-recent').innerHTML = ''; };
  actions['dx-old'] = (b) => { const r = dxRecent()[+b.dataset.i]; if (r) { dxShown = r; showDx(r); window.scrollTo(0, 0); } };

  // ---- The reading runs in the background: leave the screen and a bar above the tabs shows it,
  // then "ready · Open"; the result is also in History.
  let dxJob = null; // { state: 'running' | 'done' | 'error', entry, message, seen }
  const onDx = () => D.current.name === 'dx';
  const busyDx = () => I.busyHtml('Reading the pictures… this can take a minute or two. You can leave this screen and keep using the app: a bar shows when it is ready, and it is saved in History.');
  function dxBar() {
    let el = document.getElementById('dx-bar');
    const show = dxJob && !onDx() && !dxJob.seen;
    if (!show) { el?.remove(); return; }
    if (!el) { el = document.createElement('button'); el.id = 'dx-bar'; el.className = 'rv-bar dx-bar'; el.dataset.act = 'dx-bar'; document.body.appendChild(el); }
    el.innerHTML = dxJob.state === 'running' ? '<span class="spin"></span>🩺 Reading your pictures…'
      : dxJob.state === 'done' ? `🩺 Diagnosis ready: ${esc((dxJob.entry.r.diagnosis || 'see result').slice(0, 40))} · <b>Open</b>` : '🩺 Diagnosis didn\'t finish · <b>Open</b>';
  }
  actions['dx-bar'] = () => { if (!dxJob) return; go(dxJob.entry ? 'dx?' + new URLSearchParams({ at: dxJob.entry.at }) : 'dx'); };
  window.addEventListener('hashchange', () => setTimeout(dxBar, 50));
  actions['dx-go'] = async () => {
    const out = $('#dx-out');
    if (!dxPics.length) { toast('Add a picture first'); return; }
    if (!D.aiHasKey()) { out.innerHTML = I.keyCard(); return; }
    if (dxJob?.state === 'running') { toast('Still reading the last pictures'); return; }
    const ctx = $('#dx-ctx').value.trim();
    store.set('dx.ctx', ctx);
    const pics = dxPics.slice();
    dxShown = null;
    dxJob = { state: 'running' };
    out.innerHTML = busyDx();
    $('#dx-recent').innerHTML = '';
    const job = dxJob;
    try {
      const image = await collage(pics);
      const many = pics.length > 1 && D.Native?.aiRunImages ? pics.map((p) => p.url) : null;
      const what = pics.map((p, i) => `${pics.length > 1 ? `Picture ${i + 1}${many ? '' : ` (labelled "${i + 1}. ${DX_KINDS[p.kind][0]}")`} is ` : 'The picture is '}${DX_KINDS[p.kind][1]}.`).join('\n');
      const dxTask = `${what}
${ctx ? 'Clinical details: ' + ctx : 'No clinical details were given.'}

Work like an experienced dermatologist and dermatopathologist: first describe exactly what is visible, then reason from those findings (and the clinical details) to a diagnosis. Consider common conditions before rare ones, and name serious ones that must not be missed. If the pictures are of different types, use them together.
Answer only as JSON:
{"imageType": "what each picture is (preparation, stain, magnification if visible)",
 "quality": "good | adequate | poor, with what limits reading it",
 "findings": ["6-10 precise findings in standard dermatological / dermoscopic / histological terms"],
 "diagnosis": "the single most likely diagnosis",
 "likelihood": "high | moderate | low",
 "why": "2-3 sentences linking the key findings to that diagnosis",
 "differentials": [{"name": "", "likelihood": "high | moderate | low", "for": "findings that support it", "against": "findings against it or what is missing"}],
 "mustNotMiss": ["serious diagnoses to exclude, if any"],
 "nextSteps": ["the tests or views that would confirm it (biopsy site, stain, IHC, culture, KOH, dermoscopy, labs)"],
 "pearl": "one teaching point that separates the top two possibilities"}
Give 3-5 differentials. Base everything on what is visible; say so plainly when a picture can't show something.`;
      const dxSys = 'You are an expert dermatologist and dermatopathologist reviewing images for a fellow clinician. Be precise, use standard terminology, and never invent findings that are not visible. This supports, and does not replace, clinical examination and histopathology.';
      const text = await ((many && I.aiImages(dxTask, many, dxSys)) || I.aiImage(dxTask, image, dxSys));
      const r = D.aiJson(text);
      const entry = { r, at: Date.now(), kinds: pics.map((p) => DX_KINDS[p.kind][0]).join(' + '), thumb: await thumb(pics[0].url), ctx };
      store.set('dx.recent', [entry, ...dxRecent()].slice(0, 20));
      I.remember('dx', `${r.diagnosis || 'Picture'} · ${entry.kinds}`, 'dx?' + new URLSearchParams({ at: entry.at }), { thumb: entry.thumb });
      dxShown = { ...entry, image };
      Object.assign(job, { state: 'done', entry, seen: onDx() });
      if (onDx()) showDx(dxShown); else toast(`Diagnosis ready: ${r.diagnosis || 'see result'}`);
    } catch (e) {
      Object.assign(job, { state: 'error', message: e.message, seen: onDx() });
      const o = $('#dx-out');
      if (o) o.innerHTML = I.aiErr(e);
    }
    dxBar();
  };

  function showDx(e) {
    const out = $('#dx-out');
    if (!out) return;
    const r = e.r || {};
    const list = (a) => (Array.isArray(a) ? a : []).filter(Boolean);
    const dx = r.diagnosis || '';
    out.innerHTML = `${e.image ? '' : `<img class="dx-thumb" src="${e.thumb}" alt="">`}
      <div class="panel synth dx-card">
        <div class="label">${icon('search')}Most likely</div>
        <h2 class="dx-name">${esc(dx || 'No clear diagnosis')}</h2>
        <div>${likeHtml(r.likelihood)}</div>
        ${r.why ? `<p>${esc(r.why)}</p>` : ''}
        ${list(r.findings).length ? `<h4>What the picture shows</h4><ul>${list(r.findings).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        ${r.imageType || r.quality ? `<p class="muted small">${esc([r.imageType, r.quality && 'Quality: ' + r.quality].filter(Boolean).join(' · '))}</p>` : ''}
      </div>
      ${list(r.differentials).length ? `<div class="section"><div class="section-h"><h3>Differential diagnosis</h3></div>
        <div class="matrix-wrap"><table class="matrix"><thead><tr><th>Diagnosis</th><th>Likelihood</th><th>For</th><th>Against</th></tr></thead>
        <tbody>${list(r.differentials).map((x) => `<tr data-act="dx-pickdx" data-q="${esc(x.name)}"><td><b>${esc(x.name)}</b></td><td>${likeHtml(x.likelihood)}</td><td>${esc(x.for || '')}</td><td>${esc(x.against || '')}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
      ${list(r.mustNotMiss).length ? `<div class="panel small dx-warn">${icon('alert')} <b>Don't miss:</b> ${list(r.mustNotMiss).map(esc).join(' · ')}</div>` : ''}
      ${list(r.nextSteps).length ? `<div class="section"><div class="section-h"><h3>To confirm</h3></div><ul>${list(r.nextSteps).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${r.pearl ? `<div class="panel small dx-tip">${icon('bulb')} ${esc(r.pearl)}</div>` : ''}
      ${dx ? `<button class="btn ${r.likelihood === 'high' ? '' : 'primary'} full dx-go" data-act="dx-compare">${icon('chart')}Compare with reference pictures</button>
        <p class="muted small">Puts published pictures of the top diagnoses beside yours and asks the AI which matches best (about 30 seconds).</p>` : ''}
      <div id="dx-cmp"></div>
      ${dx ? `<div class="section"><div class="section-h"><h3>Ask about this case</h3></div>
        <div id="dx-thread"></div>
        <form class="qa-follow" data-form="dx-ask"><textarea name="f" rows="1" placeholder="e.g. Which stain would confirm it? How would you treat it?"></textarea><button class="go" type="submit">${icon('up')}</button></form>
        <div class="row wrap" id="dx-sugg">${['What would confirm it?', `How is ${dx} treated?`, 'Which features argue against it?'].map((q) => `<button class="chip" data-act="dx-sugg" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div></div>` : ''}
      ${dx ? `<div class="section"><div class="section-h"><h3>Learn more</h3></div><div class="scroll-x">${[dx, ...list(r.differentials).map((x) => x.name)].filter((v, i, a) => v && a.indexOf(v) === i).slice(0, 5).map((t, i) => `<button class="chip ${i === 0 ? 'on' : ''}" data-act="dx-pickdx" data-q="${esc(t)}">${esc(t)}</button>`).join('')}</div><div id="dx-more"></div></div>` : ''}
      <p class="muted small">${esc(I.EDU)}</p>`;
    if (dx) moreOn(dx);
    if (e.cmp) showCmp(e.cmp, null, null);
    paintThread(e);
  }
  // ---- Follow-up questions on a case: with the pictures while they are open, else from the findings.
  /** A kept case's copy in History follows its new follow-ups and comparison. */
  function syncKept(e) {
    const all = I.history();
    const x = all.find((y) => y.kind === 'dx' && y.kept && y.data && y.data.at === e.at);
    if (!x) return;
    const { image, ...rest } = e;
    x.data = rest;
    store.set(I.HIST, all);
  }
  function paintThread(e) {
    const box = $('#dx-thread');
    if (!box) return;
    box.innerHTML = (e.thread || []).map((t) => `<div class="panel explain" style="margin-top:8px"><p class="ex-head">${icon('search')} ${esc(t.q)}</p><div class="synth">${md(t.a)}</div></div>`).join('');
  }
  async function askDx(q) {
    const e = dxShown;
    const box = $('#dx-thread');
    if (!e || !box || !q) return;
    const r = e.r || {};
    box.insertAdjacentHTML('beforeend', `<div class="panel explain" style="margin-top:8px"><p class="ex-head">${icon('search')} ${esc(q)}</p><div class="synth dx-ans">${I.busyHtml('Thinking…')}</div></div>`);
    const out = box.lastElementChild.querySelector('.dx-ans');
    const caseText = `Case: ${e.kinds}${e.ctx ? '; clinical details: ' + e.ctx : ''}.
Reading of the pictures: most likely ${r.diagnosis || 'unclear'} (${r.likelihood || ''}); findings: ${(r.findings || []).join('; ')}; differentials: ${(r.differentials || []).map((x) => x.name).join(', ')}.${e.cmp ? ` After comparing with reference pictures: ${e.cmp.best} — ${e.cmp.verdict || ''}` : ''}
Earlier questions: ${(e.thread || []).slice(-3).map((t) => `Q: ${t.q} A: ${String(t.a).slice(0, 400)}`).join(' | ') || 'none'}.

Question: ${q}

Answer for a dermatologist in under 250 words, practical and specific, Markdown. If the question needs something the pictures can't show, say so.`;
    const sys = 'You are an expert dermatologist and dermatopathologist discussing a case with a colleague. Be precise and use standard terminology; never invent findings.';
    try {
      const a = e.image ? await I.aiImage(caseText, e.image, sys) : await D.ai(caseText + '\n(The pictures are not available now; answer from the reading above.)', { system: sys, max: 1500 });
      e.thread = [...(e.thread || []), { q, a }];
      const all = dxRecent(); const k = all.findIndex((x) => x.at === e.at);
      if (k >= 0) { all[k].thread = e.thread; store.set('dx.recent', all); }
      syncKept(e);
      out.innerHTML = md(a);
    } catch (err) { out.innerHTML = I.aiErr(err); }
  }
  actions['dx-sugg'] = (b) => askDx(b.dataset.q);
  document.addEventListener('submit', (ev) => {
    const f = ev.target.closest('[data-form=dx-ask]');
    if (!f) return;
    ev.preventDefault();
    const q = f.f.value.trim();
    f.f.value = '';
    askDx(q);
  });
  // ---- Compare with references: the top diagnoses' published pictures beside yours, one AI judgement.
  // Pictures from other sites can only be drawn into one image when fetched through the app
  // (Android /proxy/, iPhone /proxy?u=); in the web app Wikimedia's allow it, Open-i's don't.
  const viaApp = (u) => {
    if (D.hasNative) {
      if (u.startsWith('https://openi.nlm.nih.gov/')) return '/proxy/openiimg/' + u.slice(26);
      if (u.startsWith('https://upload.wikimedia.org/')) return '/proxy/wmup/' + u.slice(29);
      return u;
    }
    return window.DSNative ? '/proxy?u=' + encodeURIComponent(u) : u;
  };
  async function loadImg(u) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 12000);
    try {
      const res = await fetch(viaApp(u), { signal: ctl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      if (!/^image\//.test(blob.type) && blob.size < 2000) throw new Error('Not a picture');
      const url = URL.createObjectURL(blob);
      return await new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => bad(new Error('Bad picture')); im.src = url; });
    } finally { clearTimeout(t); }
  }
  /** Up to two reference pictures of a diagnosis that load (bigger Commons thumbnails than the grid's). */
  async function refsFor(name, suffix) {
    const list = await I.pics(name + suffix, 8).catch(() => []);
    const got = [];
    for (const m of list) {
      if (got.length >= 2) break;
      const u = m.source.startsWith('Wikimedia') ? String(m.thumb).replace(/\/320px-/, '/640px-') : m.src;
      try { got.push({ im: await loadImg(u), m }); } catch { /* next one */ }
    }
    return got;
  }
  function board(mine, rows) {
    const W = 1800, PAD = 10, LBL = 46, H0 = 560, H = 380;
    const c = document.createElement('canvas');
    c.width = W; c.height = LBL + H0 + rows.length * (LBL + H + PAD) + PAD;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#111'; g.font = 'bold 32px sans-serif';
    const fit = (im, x, y, w, h) => { const k = Math.min(w / im.width, h / im.height); g.drawImage(im, x, y, im.width * k, im.height * k); };
    g.fillText("YOUR PICTURE", PAD, 34);
    fit(mine, PAD, LBL, W - 2 * PAD, H0);
    let y = LBL + H0 + PAD;
    rows.forEach((r, i) => {
      g.fillStyle = '#111';
      g.fillText(`${String.fromCharCode(65 + i)}. REFERENCE: ${r.name}`.slice(0, 80), PAD, y + 34);
      const w = (W - PAD * (r.refs.length + 1)) / Math.max(1, r.refs.length);
      r.refs.forEach((x, j) => fit(x.im, PAD + j * (w + PAD), y + LBL, w, H));
      y += LBL + H + PAD;
    });
    return c.toDataURL('image/jpeg', 0.85);
  }
  const CMP_SAME = { high: 'Close match', moderate: 'Partial match', low: 'Poor match' };
  actions['dx-compare'] = async () => {
    const e = dxShown;
    const box = $('#dx-cmp');
    if (!e || !box) return;
    if (!e.image) { box.innerHTML = '<p class="muted small">Add the pictures again and tap Diagnose to compare them with references.</p>'; return; }
    const r = e.r || {};
    const names = [r.diagnosis, ...(r.differentials || []).map((x) => x.name)].filter((v, i, a) => v && a.findIndex((y) => y.toLowerCase() === v.toLowerCase()) === i).slice(0, 3);
    const suffix = /Histo/.test(e.kinds) ? ' histopathology' : /Dermoscopy/.test(e.kinds) ? ' dermoscopy' : /Tricho/.test(e.kinds) ? ' trichoscopy' : /KOH/.test(e.kinds) ? ' microscopy' : '';
    box.innerHTML = I.busyHtml('Finding reference pictures…');
    try {
      const rows = (await Promise.all(names.map(async (name) => ({ name, refs: await refsFor(name, suffix) })))).filter((x) => x.refs.length);
      if (!rows.length) { box.innerHTML = '<p class="muted small">No reference pictures could be loaded for these diagnoses, so the first answer stands. Try the Leeds slides or DermNet.</p>'; return; }
      const mine = await new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = bad; im.src = e.image; });
      const image = board(mine, rows);
      box.innerHTML = `<img class="dx-board" src="${image}" alt="" data-act="vs-big" data-src="${image}">${I.busyHtml('Comparing your picture with the references…')}`;
      const text = await I.aiImage(`The top of this image is a clinician's picture (${e.kinds})${e.ctx ? '; clinical details: ' + e.ctx : ''}. Below it are published reference pictures, one row per candidate diagnosis: ${rows.map((x, i) => `${String.fromCharCode(65 + i)} = ${x.name}`).join(', ')}.
The first reading was: most likely ${r.diagnosis || 'unclear'}; findings: ${(r.findings || []).slice(0, 8).join('; ')}.
Compare the clinician's picture with each reference row feature by feature (pattern, architecture, cells or structures, colours). References differ in magnification, stain and quality, and may show a different stage, so judge diagnostic features, not overall look; say when a reference is unhelpful.
Answer only as JSON: {"best": "the diagnosis the clinician's picture matches best", "likelihood": "high | moderate | low", "rows": [{"name": "", "similarity": "high | moderate | low", "shared": ["features shared with the clinician's picture"], "different": ["features that differ"]}], "verdict": "2-3 sentences: which fits best and why, and whether this changes the first reading", "caveat": "one line on the limits of this comparison"}`, image,
      'You are an expert dermatologist and dermatopathologist comparing a case with reference images for a fellow clinician. Be precise, use standard terminology, and never invent findings that are not visible.');
      const v = D.aiJson(text);
      e.cmp = v;
      const all = dxRecent(); const k = all.findIndex((x) => x.at === e.at);
      if (k >= 0) { all[k].cmp = v; store.set('dx.recent', all); }
      syncKept(e);
      showCmp(v, image, rows);
    } catch (err) { box.innerHTML = I.aiErr(err); }
  };
  function showCmp(v, image, rows) {
    const box = $('#dx-cmp');
    if (!box) return;
    const list = (a) => (Array.isArray(a) ? a : []).filter(Boolean);
    const changed = dxShown?.r?.diagnosis && v.best && v.best.toLowerCase() !== dxShown.r.diagnosis.toLowerCase();
    box.innerHTML = `${image ? `<img class="dx-board" src="${image}" alt="" data-act="vs-big" data-src="${image}">` : ''}
      <div class="panel synth dx-card"><div class="label">${icon('chart')}After comparing with references</div>
        <h2 class="dx-name">${esc(v.best || '—')}</h2><div>${likeHtml(v.likelihood)}</div>
        ${changed ? `<p class="small dx-changed">Differs from the first reading (${esc(dxShown.r.diagnosis)}).</p>` : ''}
        ${v.verdict ? `<p>${esc(v.verdict)}</p>` : ''}
        ${list(v.rows).map((x) => `<h4>${esc(x.name)} · ${esc(CMP_SAME[x.similarity] || x.similarity || '')}</h4>
          ${list(x.shared).length ? `<p class="small"><b>Shared:</b> ${list(x.shared).map(esc).join('; ')}</p>` : ''}
          ${list(x.different).length ? `<p class="small"><b>Different:</b> ${list(x.different).map(esc).join('; ')}</p>` : ''}`).join('')}
        ${v.caveat ? `<p class="muted small">${esc(v.caveat)}</p>` : ''}
        ${rows ? `<p class="muted small">References: ${rows.map((x, i) => `${String.fromCharCode(65 + i)}. ${esc(x.name)} (${x.refs.map((y) => esc(y.m.source.split(' · ')[0])).join(', ')})`).join(' · ')}</p>` : ''}
      </div>`;
  }

  async function moreOn(dx) {
    const box = $('#dx-more');
    if (!box) return;
    box.innerHTML = `<div class="row wrap" style="margin:6px 0">
        <button class="btn small" data-act="ask" data-q="${esc(`How is ${dx} diagnosed and managed?`)}">${icon('chart')}Evidence answer</button>
        <button class="btn small" data-act="ev-from-search" data-q="${esc(`diagnosis and treatment of ${dx}`)}">${icon('list')}Evidence map</button>
        <button class="btn small" data-act="dx-cases" data-q="${esc(dx)}">${icon('book')}Case reports</button>
        <button class="btn small" data-act="ev-dermnet" data-q="${esc(dx)}">${icon('globe')}DermNet</button>
        ${/Histo/.test(dxShown?.kinds || '') ? `<button class="btn small" data-act="po-open" data-q="${esc(dx)}">${icon('globe')}Pathology Outlines</button><button class="btn small" data-act="leeds-open">${icon('globe')}Leeds virtual slides</button><button class="btn small" data-act="pp-open">${icon('globe')}PathPresenter slides</button>` : ''}</div>
      <div id="dx-imgs">${D.skeletons(1)}</div>`;
    const kind = dxShown?.kinds || '';
    const suffix = /Histo/.test(kind) ? ' histopathology' : /Dermoscopy|Tricho/.test(kind) ? ' dermoscopy' : '';
    const imgs = await I.pics(dx + suffix, 10).catch(() => []);
    const el = $('#dx-imgs');
    if (el) el.innerHTML = imgs.length ? `<small class="muted">Published images: ${esc(dx + suffix)} · Open-i and Wikimedia Commons</small><div class="hs-thumbs big">${imgs.map((m) => `<img src="${esc(m.thumb)}" alt="" data-act="vs-big" data-src="${esc(m.src)}">`).join('')}</div>` : '<p class="muted small">No open-access images found.</p>';
  }
  actions['dx-cases'] = (b) => go(D.searchHash(D.filtersFrom({ q: `${b.dataset.q} case report` })));
  actions['dx-pickdx'] = (b) => { $$('[data-act=dx-pickdx].chip').forEach((x) => x.classList.toggle('on', x.dataset.q === b.dataset.q)); moreOn(b.dataset.q); };


  // ================================================================ History (#history)
  // Every question asked and answer written (search answers, evidence maps, desk, consensus meter,
  // deep reviews, picture diagnoses, image learning), newest first; tapping one opens its saved answer.
  const KINDS = {
    answer: ['💬', 'Search answer'], ev: ['🧬', 'Evidence map'], desk: ['🧠', 'AI research desk'], meter: ['📊', 'Consensus meter'],
    review: ['📑', 'Deep review'], dx: ['🩺', 'Diagnosis'], img: ['🖼️', 'Image learning'],
  };
  let histKind = '';
  const when = (t) => {
    const d = new Date(t), now = new Date();
    const days = Math.floor((new Date(now.toDateString()) - new Date(d.toDateString())) / 864e5);
    return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : days < 7 ? 'This week' : days < 31 ? 'This month' : 'Earlier';
  };
  const DAY = 864e5;
  const ageDays = (x) => (Date.now() - x.at) / DAY;
  // Not kept and within 10 days of expiring / already expired (the question stays listed; opening it asks again).
  const expiring = (x) => !x.kept && ageDays(x) >= I.KEEP_DAYS - 10 && ageDays(x) < I.KEEP_DAYS;
  const expired = (x) => !x.kept && ageDays(x) >= I.KEEP_DAYS;
  const histRow = (x) => {
    const [e, label] = KINDS[x.kind] || ['•', ''];
    const note = x.kept ? ' · ☆ Kept' : expired(x) ? ' · answer expired, tap to ask again' : expiring(x) ? ` · expires in ${Math.max(1, Math.ceil(I.KEEP_DAYS - ageDays(x)))} days` : '';
    return `<div class="hist-row ${expired(x) ? 'old' : ''}"><button class="hist-open" data-act="hist-open" data-r="${esc(x.route)}">${x.thumb ? `<img src="${x.thumb}" alt="">` : `<span class="hist-e">${e}</span>`}
      <span><b>${esc(x.title)}</b><small>${esc(label)} · ${new Date(x.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${note}</small></span></button>
      <button class="hist-keep ${x.kept ? 'on' : ''}" data-act="hist-keep" data-r="${esc(x.route)}" aria-label="${x.kept ? 'Kept' : 'Keep'}" title="${x.kept ? 'Kept: never expires' : 'Keep: never expires'}">${x.kept ? '★' : '☆'}</button>
      <button class="hist-x" data-act="hist-del" data-r="${esc(x.route)}" aria-label="Remove">×</button></div>`;
  };
  const warnHtml = () => {
    const n = I.history().filter(expiring).length;
    return n ? `<div class="panel small hist-warn">⏳ <b>${n} answer${n > 1 ? 's' : ''} will expire within 10 days.</b> Tap ☆ on the ones you want to keep; kept answers never expire.</div>` : '';
  };
  actions['hist-keep'] = (b) => {
    const all = I.history();
    const x = all.find((y) => y.route === b.dataset.r);
    if (!x) return;
    x.kept = !x.kept;
    // Picture readings live in their own short lists: a kept one is copied into History itself.
    if (x.kept && x.kind === 'dx') x.data = dxRecent().find((y) => String(y.at) === new URLSearchParams(x.route.split('?')[1]).get('at')) || x.data;
    if (x.kept && x.kind === 'img') x.data = store.get('imgl.recent', []).find((y) => String(y.at) === new URLSearchParams(x.route.split('?')[1]).get('at')) || x.data;
    if (!x.kept) delete x.data;
    store.set(I.HIST, all);
    toast(x.kept ? 'Kept: this answer won\'t expire' : 'No longer kept');
    if (D.current.name === 'history') paintHistory(); else render();
  };
  function renderHistory() {
    const all = I.history();
    view.innerHTML = `${D.topbar('History')}
      <input id="hist-q" class="dx-ctx" placeholder="Search your questions" value="">
      <div class="scroll-x" style="margin:8px 0"><button class="chip ${histKind ? '' : 'on'}" data-act="hist-kind" data-v="">All</button><button class="chip ${histKind === 'kept' ? 'on' : ''}" data-act="hist-kind" data-v="kept">★ Kept</button>${Object.entries(KINDS).filter(([k]) => all.some((x) => x.kind === k)).map(([k, [e, l]]) => `<button class="chip ${histKind === k ? 'on' : ''}" data-act="hist-kind" data-v="${k}">${e} ${esc(l)}</button>`).join('')}</div>
      ${warnHtml()}
      <div id="hist-list"></div>
      ${all.length ? '<button class="btn xs" data-act="hist-clear" style="margin-top:12px">Clear history</button>' : ''}
      <p class="muted small">Answers are kept on this phone for ${I.KEEP_DAYS} days, and the oldest go first if the app's storage fills up; you are told 10 days before. ★ Kept answers stay until you remove them. Questions stay listed after their answer expires; opening one asks again.</p>`;
    paintHistory();
    $('#hist-q').addEventListener('input', paintHistory);
  }
  function paintHistory() {
    const el = $('#hist-list');
    if (!el) return;
    const q = ($('#hist-q')?.value || '').toLowerCase().trim();
    const list = I.history().filter((x) => (!histKind || (histKind === 'kept' ? x.kept : x.kind === histKind)) && (!q || x.title.toLowerCase().includes(q)));
    if (!list.length) { el.innerHTML = '<div class="empty"><b>Nothing here yet</b><div>Questions you ask and answers the AI writes appear here.</div></div>'; return; }
    let last = '';
    el.innerHTML = list.map((x) => { const w = when(x.at); const h = w !== last ? `<h4 class="hist-h">${w}</h4>` : ''; last = w; return h + histRow(x); }).join('');
  }
  actions['hist-kind'] = (b) => { histKind = b.dataset.v; $$('[data-act=hist-kind]').forEach((x) => x.classList.toggle('on', x === b)); paintHistory(); };
  actions['hist-open'] = (b) => go(b.dataset.r);
  actions['hist-del'] = (b) => { store.set(I.HIST, I.history().filter((x) => x.route !== b.dataset.r)); if (D.current.name === 'history') paintHistory(); else render(); };
  actions['hist-clear'] = () => { if (confirm('Clear the history list? Saved answers stay until they expire.')) { store.set(I.HIST, []); renderHistory(); } };
  // The first screen: the three latest, with the full list a tap away.
  ext.homeRecent = () => {
    const list = I.history().slice(0, 3);
    return list.length ? `<div class="section"><div class="section-h"><h3>Recent answers</h3><button data-act="go-history">See all</button></div>
      ${warnHtml()}<div class="list-card hist-card">${list.map(histRow).join('')}</div></div>` : '';
  };
  actions['go-history'] = () => go('history');

  // ================================================================ Weekly digest (Monday)
  // New papers of the last 7 days from the journals you follow and the questions you watch,
  // ranked by the AI into a 5-minute brief you can read or listen to. One per week, kept.
  const weekStart = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; };
  const weekKey = () => weekStart().toISOString().slice(0, 10);
  const DIGEST = I.obj({ headline: I.S.str, items: { type: 'array', items: I.obj({ cite: { type: 'integer' }, theme: I.S.str, summary: I.S.str, why: I.S.str }) }, close: I.S.str });
  async function renderDigest() {
    const wk = weekKey();
    view.innerHTML = `${D.topbar('Weekly digest')}<p class="muted small">Week of ${new Date(wk).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}: new papers from the journals you follow and the questions you watch, ranked into a 5-minute brief.</p><div id="dg">${D.skeletons(4)}</div>`;
    store.set('digest.seen', wk);
    const el = $('#dg');
    const follows = (store.get('follows', []) || []);
    const jr = (window.JOURNALS || []).filter((j) => follows.includes(j.abbr));
    const watches = store.get('watches', []).slice(0, 4);
    if (!jr.length && !watches.length) { el.innerHTML = '<div class="empty"><b>Nothing to follow yet</b><div>Follow journals on the Journals tab, or tap ★ on an Evidence Map to watch a question. The digest is made from them.</div></div>'; return; }
    const range = `FIRST_PDATE:[${I.daysAgo(7)} TO ${I.today()}] AND HAS_ABSTRACT:y ${D.NOISE}`;
    const asks = [];
    if (jr.length) asks.push(I.epmc({ query: '(' + jr.map(D.journalQuery).join(' OR ') + ') AND ' + range, sort: 'FIRST_PDATE_D desc' }, 40).then((r) => r.results.map((a) => ({ a, from: a.jAbbr || a.journal }))).catch(() => []));
    for (const w of watches) asks.push(I.epmc({ query: `(${(D.keywordTerms ? D.keywordTerms(w.q) : w.q.split(/\s+/)).map((t) => t.replace(/["“”()[\]{}:]/g, '')).filter((t) => t && !/^(and|or|not)$/i.test(t)).join(' AND ')}) AND ${range}`, sort: 'CITED desc' }, 6).then((r) => r.results.map((a) => ({ a, from: '★ ' + w.q }))).catch(() => []));
    const seen = new Set();
    const pool = (await Promise.all(asks)).flat().filter(({ a }) => !seen.has(a.id) && seen.add(a.id)).slice(0, 45);
    if (D.current.name !== 'digest') return;
    const refs = pool.map(({ a }, i) => ({ kind: 'paper', a, type: D.studyType(a).label, n: i + 1 }));
    const list = `<div class="section"><div class="section-h"><h3>All new papers this week (${pool.length})</h3></div>${pool.map(({ a }) => D.card(a, { compact: true })).join('')}</div>`;
    if (!pool.length) { el.innerHTML = '<div class="empty"><b>No new papers this week yet</b><div>Your journals and questions had nothing new with an abstract in the last 7 days.</div></div>'; return; }
    if (I.needKey()) { el.innerHTML = I.keyCard() + list; return; }
    const ck = 'digest.' + wk + '.' + follows.slice().sort().join(',') + '.' + watches.map((w) => w.q).join('|');
    let dg = I.cacheGet(ck);
    if (!dg) {
      el.innerHTML = I.busyHtml('Reading this week\'s papers and choosing what matters…') + list;
      try {
        dg = await I.aiJsonCall('Write a weekly digest for a practising dermatologist from these new papers. Choose the 5-7 that matter most for practice or research (strong designs, practice-changing, new treatments, safety signals; skip minor case reports unless striking). '
          + 'headline: one sentence on the week. For each item: cite (its number), theme (2-4 words, e.g. "Psoriasis · biologics"), summary (2-3 sentences: what they did and found, with key numbers), why (one sentence: why it matters in practice). close: one sentence to finish. Together about 5 minutes to read aloud.', refs, DIGEST, 4000);
        I.cacheSet(ck, dg);
      } catch (e) { if (D.current.name === 'digest') el.innerHTML = I.aiErr(e) + list; return; }
    }
    if (D.current.name !== 'digest') return;
    const items = (dg.items || []).map((x) => ({ ...x, r: refs.find((r) => r.n === x.cite) })).filter((x) => x.r);
    el.innerHTML = `<div class="panel digest-head"><p class="digest-hl">${esc(dg.headline || '')}</p>
        <button class="btn primary small" data-act="dg-listen">${icon('audio')}Listen · about 5 min</button></div>
      ${items.map((x) => `<div class="panel today"><div class="label">${esc(x.theme || '')}</div><b>${esc(x.r.a.title)}</b>
        <div class="muted small">${esc(pool[x.cite - 1]?.from || '')} · ${esc(x.r.type)}</div><p>${esc(x.summary)}</p><p class="small muted">${esc(x.why)}</p>
        <div class="row wrap"><button class="btn xs" data-act="open" data-id="${esc(x.r.a.id)}">${icon('file')}Paper</button></div></div>`).join('')}
      ${dg.close ? `<p class="muted small">${esc(dg.close)}</p>` : ''}` + list;
    actions['dg-listen'] = () => {
      const lines = [{ t: 'Your DermScholar weekly digest. ' + (dg.headline || '') }];
      items.forEach((x, i) => { lines.push({ t: `${i + 1}. ${x.r.a.title}.` }); lines.push({ t: x.summary }); lines.push({ t: x.why }); });
      if (dg.close) lines.push({ t: dg.close });
      D.ttsPlayScript?.('Weekly digest', lines, { title: 'Weekly digest' });
    };
  }
  // Home: a card from Monday to Wednesday until this week's digest is opened (always on the Intel tab).
  const homeTop0 = ext.homeTop;
  ext.homeTop = () => {
    const day = new Date().getDay();
    const show = (day >= 1 && day <= 3) && store.get('digest.seen', '') !== weekKey() && ((store.get('follows', []) || []).length || store.get('watches', []).length);
    return (show ? `<button class="digest-card" data-act="intel-go" data-k="digest"><span class="e">📰</span><span><b>Your weekly digest is ready</b><small>This week's papers from your journals and questions · 5 minutes</small></span><span class="badge b-oa">New</span></button>` : '')
      + (homeTop0 ? homeTop0() : '');
  };
  I.TILES.splice(2, 0, ['digest', '📰', 'Weekly digest', 'Your journals and questions this week · 5 min']);
  ext.routes.digest = renderDigest;

  // On the Intel tab, beside the evidence map.
  I.TILES.splice(2, 0, ['review', '📑', 'Deep review', 'Screens 100+ papers · structured, referenced review']);
  I.TILES.splice(1, 0, ['dx', '🩺', 'Diagnose from picture', 'Clinical · dermoscopy · histology · KOH · Wood\'s lamp']);
  I.TILES.splice(1, 0, ['history', '🕘', 'History', 'Every question and answer, kept 90 days']);
  Object.assign(ext.routes, { review: renderReview, dx: renderDx, history: renderHistory });
})();
