// DermScholar Intel: the intelligence layer above the sources. One dermatology question becomes an
// Evidence Map (guidelines → systematic reviews → RCTs → observational → case reports → trials → latest),
// a citation-first AI synthesis with evidence strength, an evidence matrix, a contradiction check,
// "what changed since I last looked", specialised AI modes, a clinical trial radar, guidelines,
// Today in Dermatology and a full-text finder (Open Access, PMC, Research4Life, MyLOFT, publisher).
// Every AI statement carries numbered citations that open the exact papers behind it.
(() => {
  'use strict';
  const D = window.DS;
  const { $, $$, esc, icon, md, sheet, closeSheet, toast, store, go, render, actions, ext, Native } = D;
  const view = $('#view');

  // ================================================================ sources
  const DIRECT = {
    ctgov: 'https://clinicaltrials.gov/api/v2/', unpaywall: 'https://api.unpaywall.org/v2/',
    pubmed: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/', crossref: 'https://api.crossref.org/',
    openi: 'https://openi.nlm.nih.gov/api/', fda: 'https://api.fda.gov/', rxnav: 'https://rxnav.nlm.nih.gov/REST/', commons: 'https://commons.wikimedia.org/w/',
  };
  const api = (up, path) => (D.hasNative ? `/proxy/${up}/` : DIRECT[up]) + path;
  const today = () => new Date().toISOString().slice(0, 10);
  const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const openUrl = (u) => (Native.openPortal ? Native.openPortal(u, '', '') : window.open(u, '_blank'));

  /** A dermatology question as a Europe PMC query, optionally narrowed. */
  function q(question, { types = [], extra = '', years = 'any', sort = '', treat = true } = {}) {
    // The planned search (synonyms, the terms papers use) when there is one, else the question's words.
    const core = planCore(question);
    // The skin filter applies to planned searches too, unless they are already about skin disease.
    let s = D.buildQuery({ q: core || question, derm: true, types, years, oa: false, preprints: false });
    if (extra) s = `(${s}) AND ${extra}`;
    // Treatment questions get treatment papers, not side-effect reports (unless safety is asked).
    if (treat && isTreatmentQ(question)) s = `(${s}) AND ${TREAT}`;
    return { query: s, sort };
  }
  const TREAT = '((TITLE_ABS:treatment OR TITLE_ABS:therapy OR TITLE_ABS:therapies OR TITLE_ABS:efficacy OR TITLE_ABS:management OR TITLE_ABS:treated) NOT TITLE:"adverse" NOT TITLE:"side effect" NOT TITLE:"side effects" NOT TITLE:"safety" NOT TITLE:"induced" NOT TITLE:"toxicity" NOT TITLE:"pharmacovigilance" NOT TITLE:"associated with")';
  const isTreatmentQ = (x) => /\b(treat|treatment|treating|therap|management|manage|best (drug|option)|first[- ]line|second[- ]line|efficacy|options? for|how to (treat|manage))/i.test(x) && !/\b(side effects?|adverse|safety|toxicit|risk of|induced|complication)/i.test(x);
  const GUIDE = '(PUB_TYPE:"Guideline" OR PUB_TYPE:"Practice Guideline" OR TITLE:guideline* OR TITLE:"consensus statement" OR TITLE:"expert consensus" OR TITLE:recommendations)';
  const OBS = '(TITLE_ABS:cohort OR TITLE_ABS:"case-control" OR TITLE_ABS:"cross-sectional" OR TITLE_ABS:registry OR TITLE_ABS:"real-world")';
  const COCHRANE = 'JOURNAL:"Cochrane Database Syst Rev"';
  const SAFETY = '(TITLE_ABS:"adverse event*" OR TITLE_ABS:safety OR TITLE_ABS:pharmacovigilance OR TITLE_ABS:"boxed warning" OR TITLE_ABS:"adverse drug reaction*")';

  // ================================================================ search plan (shared)
  // A question's own words miss most papers: "inheritance in psoriasis" finds a gene-variant
  // preprint, while the answer is in papers on heritability, twins, HLA-C*06:02 and GWAS. Like
  // Consensus, the AI first turns the question into Boolean searches with the terms papers use.
  // The Evidence Map, the Consensus meter and search all use the same plan, so they agree.
  const PLAN_SYSTEM = 'You are an expert medical librarian who builds PubMed/Europe PMC searches for dermatology questions.';
  const plans = new Map();
  const planKey = (question) => 'plan2.' + question.toLowerCase().replace(/\s+/g, ' ').trim();
  const YESNO_Q = /^(does|do|did|is|are|was|were|can|could|should|will|would|has|have|had|may|might)\b/i;
  /** One term as a title/abstract condition (a trailing * matches word endings). */
  function absTerm(t) {
    const v = String(t || '').replace(/["()[\]{}:]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!v || /^(and|or|not)$/i.test(v)) return '';
    if (/^[\w-]+\*$/.test(v)) return `TITLE_ABS:${v}`;
    return `TITLE_ABS:"${v.replace(/\*+$/, '')}"`;
  }
  /** Concept groups → "(a OR b) AND (c OR d)": every group must appear in the title or abstract. */
  function groupsQuery(groups) {
    const parts = (groups || []).map((g) => (Array.isArray(g) ? g : [g]).map(absTerm).filter(Boolean)).filter((g) => g.length)
      .map((g) => (g.length > 1 ? `(${g.join(' OR ')})` : g[0]));
    return parts.length ? parts.join(' AND ') : '';
  }
  const planCore = (question) => (plans.get(planKey(question)) || cacheGet(planKey(question)))?.searches?.[0]?.query || '';
  // Built on first use: the schema helpers (obj, S) are defined further down.
  let planSchema = null;
  const PLAN = () => planSchema || (planSchema = obj({
    yesno: S.str, topic: S.str,
    searches: { type: 'array', items: obj({ label: S.str, groups: { type: 'array', items: { type: 'array', items: S.str } } }) },
  }));
  /**
   * The search plan for a question: {yesno, topic, searches: [{label, query}]}. Cached for a week;
   * without an AI key it falls back to the question's own words.
   */
  async function planSearch(question) {
    const k = planKey(question);
    if (plans.has(k)) return plans.get(k);
    let plan = cacheGet(k);
    if (!plan && D.aiHasKey()) {
      try {
        const r = D.aiJson(await D.ai(`QUESTION: ${question}\n\n`
          + 'Turn this question into literature searches. Return:\n'
          + '- yesno: the question as one clear yes/no question (e.g. "Role of inheritance in psoriasis?" → "Does inheritance play a role in psoriasis?"), or "" if it cannot be answered yes or no (e.g. "What are the treatment options for vitiligo?").\n'
          + '- topic: a 3-6 word label.\n'
          + '- searches: 2 to 4 searches. Each search is a list of concept groups that must ALL appear in a paper\'s title or abstract. Each group lists 1-10 alternative terms: synonyms, the words papers actually use, British and US spellings, key genes, drugs, tests or scores; a trailing * matches word endings (heritab*, twin*). Usually 2 groups per search, never more than 3. '
          + 'The first search is the broad core one: the condition (with its variants) AND the main concept with all its synonyms. The others cover distinct angles a good review would search. '
          + 'Never use generic words like role, effect, impact, evidence, patients, study, association as a group. '
          + 'Each search has a label: its terms in a few plain words, e.g. "psoriasis heritability, twins, family history" (never "core" or "angle").\n'
          + 'Example for "Role of inheritance in psoriasis?": core [["psoriasis","psoriatic"],["inheritance","heritab*","familial","family history","genetic*","twin*","susceptibility loci"]]; '
          + 'angles [["psoriasis"],["twin*","concordance"]], [["psoriasis"],["GWAS","genome-wide association","HLA-C","HLA-Cw6","PSORS1"]].',
          { system: PLAN_SYSTEM, schema: PLAN(), max: 1500 }));
        const searches = (r.searches || []).map((x) => ({ label: String(x.label || '').slice(0, 90), query: groupsQuery(x.groups) })).filter((x) => x.query).slice(0, 4);
        if (searches.length) {
          plan = { yesno: String(r.yesno || '').trim(), topic: String(r.topic || '').trim(), searches, ai: true };
          cacheSet(k, plan);
        }
      } catch { /* use the question's own words */ }
    }
    if (!plan) {
      const words = D.keywordTerms(question);
      let core = words.map(absTerm).filter(Boolean).join(' AND ');
      if (!D.DERM_WORDS.test(question)) core = `(${core}) AND ${D.DERM_FILTER}`;
      plan = { yesno: YESNO_Q.test(question.trim()) ? question.trim() : '', topic: question, searches: [{ label: words.join(' '), query: core }], ai: false };
    }
    plans.set(k, plan);
    return plan;
  }

  /**
   * The papers that answer a question, shared by the Consensus meter and quick answers: every
   * planned search (most relevant, plus the most cited for the core one), merged and ranked by
   * relevance, study design and citations. onStep({label, hit}) reports each search as it lands.
   */
  async function evidencePool(question, { size = 20, onStep = null, noCase = true } = {}) {
    const plan = await planSearch(question);
    const score = new Map();
    const papers = new Map();
    const add = (list, w) => list.forEach((a, i) => {
      if (!a.abstract) return;
      papers.set(a.id, a);
      score.set(a.id, (score.get(a.id) || 0) + w / (1 + i / 6));
    });
    const steps = await Promise.all(plan.searches.map(async (sp, i) => {
      const skin = D.DERM_WORDS.test(sp.query) ? '' : ` AND ${D.DERM_FILTER}`;
      const base = `(${sp.query})${skin} AND HAS_ABSTRACT:y NOT SRC:PPR${noCase ? ' NOT PUB_TYPE:"Case Reports"' : ''} ${D.NOISE}`;
      const [rel, cited] = await Promise.all([epmc({ query: base }, 30), i === 0 ? epmc({ query: base, sort: 'CITED desc' }, 15) : Promise.resolve(null)]);
      add(rel.results || [], i === 0 ? 1.2 : 1);
      if (cited) add(cited.results || [], 0.8);
      const step = { label: sp.label, query: sp.query, hit: rel.hit || 0 };
      onStep?.(step);
      return step;
    }));
    // Dermatology journals first: the same trial reported in JAAD outranks a general journal's mention.
    const rank = (a) => (score.get(a.id) || 0) * (1 + 0.12 * (D.studyType(a).rank || 0)) * (D.dermJournal(a) ? 1.35 : 1) + Math.log10(1 + (a.citedBy || 0)) * 0.15;
    const list = [...papers.values()].sort((x, y) => rank(y) - rank(x));
    return { plan, steps, total: papers.size, retrieved: steps.reduce((n, x) => n + x.hit, 0), papers: list.slice(0, size) };
  }

  /** An abstract short enough that 20 fit one AI request (free Groq): its opening and its conclusions. */
  function absShort(a, max = 900) {
    const t = D.stripTags(a.abstract || '');
    return t.length <= max ? t : `${t.slice(0, Math.round(max * 0.3))} … ${t.slice(-Math.round(max * 0.7))}`;
  }

  /** The search steps as Consensus shows them: each planned search with how many papers matched. */
  function stepsHtml(steps, { read = 0, done = false, retrieved = 0, eligible = 0 } = {}) {
    const n = (v) => (v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : String(v));
    const tot = done && retrieved ? `<div class="ev-tot"><div><b>${n(retrieved)}</b><span>Retrieved</span></div><div><b>${n(eligible)}</b><span>Eligible</span></div><div><b>${read}</b><span>Included</span></div></div>` : '';
    return `<div class="panel ev-steps">${tot}${steps.map((x) => `<div class="ev-step">${icon('search')}<span>${esc(x.label)}</span><b>${n(x.hit)}</b></div>`).join('')}
      ${read ? `<div class="ev-step">${icon('book')}<span>${done ? 'Read' : 'Reading'} the most relevant abstracts</span><b>${read}</b></div>` : ''}</div>`;
  }

  /** The evidence buckets of the Evidence Map, best evidence first. */
  const BUCKETS = [
    { key: 'guide', label: 'Guidelines & consensus', emoji: '📋', build: (x) => q(x, { extra: GUIDE }), size: 6, ai: 4 },
    { key: 'cited', label: 'Most cited papers', emoji: '⭐', build: (x) => q(x, { sort: 'CITED desc' }), size: 6, ai: 5 },
    { key: 'sr', label: 'Systematic reviews & meta-analyses', emoji: '📚', build: (x) => q(x, { types: ['meta', 'sr'] }), size: 8, ai: 7 },
    { key: 'cochrane', label: 'Cochrane reviews', emoji: '🟦', build: (x) => q(x, { extra: COCHRANE }), size: 4, ai: 2 },
    { key: 'rct', label: 'Randomized controlled trials', emoji: '🎯', build: (x) => q(x, { types: ['rct'] }), size: 10, ai: 9 },
    { key: 'obs', label: 'Observational studies', emoji: '🔍', build: (x) => q(x, { extra: OBS }), size: 6, ai: 4 },
    { key: 'case', label: 'Case series & reports', emoji: '🧾', build: (x) => q(x, { types: ['case'] }), size: 4, ai: 2 },
    { key: 'recent', label: 'Latest publications', emoji: '🆕', build: (x) => q(x, { years: 2, sort: 'P_PDATE_D desc' }), size: 6, ai: 4 },
  ];

  async function epmc(spec, size) {
    try {
      return await D.epmcSearch(spec.query, { sort: spec.sort, size });
    } catch (e) {
      return { hit: 0, results: [], error: e.message };
    }
  }

  // ---- ClinicalTrials.gov (v2)
  function trialOf(s) {
    const p = s.protocolSection || {};
    const id = p.identificationModule || {}, st = p.statusModule || {}, de = p.designModule || {};
    const arms = p.armsInterventionsModule || {}, sp = p.sponsorCollaboratorsModule || {};
    return {
      nct: id.nctId, title: id.briefTitle || id.officialTitle || '',
      status: (st.overallStatus || '').replace(/_/g, ' ').toLowerCase(),
      phase: (de.phases || []).map((x) => x.replace('PHASE', 'Phase ').replace('EARLY_', 'Early ').replace('NA', 'N/A')).join(', '),
      n: de.enrollmentInfo?.count || 0,
      conditions: p.conditionsModule?.conditions || [],
      interventions: (arms.interventions || []).map((i) => `${i.name}${i.type ? ' (' + i.type.toLowerCase() + ')' : ''}`),
      sponsor: sp.leadSponsor?.name || '',
      start: st.startDateStruct?.date || '', updated: st.lastUpdatePostDateStruct?.date || '',
      completion: st.primaryCompletionDateStruct?.date || '',
    };
  }
  async function trials(term, { status = '', phase = '', itype = '', since = '', size = 12 } = {}) {
    const p = new URLSearchParams({ 'query.term': term, pageSize: String(size), format: 'json', sort: 'LastUpdatePostDate:desc' });
    if (status) p.set('filter.overallStatus', status);
    const adv = [];
    if (phase) adv.push(`AREA[Phase](${phase})`);
    if (itype) adv.push(`AREA[InterventionType]${itype}`);
    if (since) adv.push(`AREA[LastUpdatePostDate]RANGE[${since},MAX]`);
    if (adv.length) p.set('filter.advanced', adv.join(' AND '));
    try {
      const j = await D.getJSON(api('ctgov', 'studies?' + p));
      return { total: j.totalCount ?? (j.studies || []).length, list: (j.studies || []).map(trialOf) };
    } catch (e) {
      return { total: 0, list: [], error: e.message };
    }
  }
  const trialTerm = (question) => D.keywordTerms(question).filter((w) => w.length > 2).slice(0, 6).join(' ');

  // ================================================================ evidence pack (what the AI may cite)
  /** Gathers the Evidence Map for a question: Europe PMC buckets in parallel, plus ongoing trials. */
  async function gather(question, { onStep = null } = {}) {
    const key = 'evmap.' + question.toLowerCase().trim();
    const hit = mem.get(key);
    if (hit && Date.now() - hit.at < 30 * 60e3) return hit;
    const plan = await planSearch(question);
    const [pool, buckets, tr] = await Promise.all([
      evidencePool(question, { size: 15, noCase: false, onStep }),
      Promise.all(BUCKETS.map(async (b) => ({ ...b, res: await epmc(b.build(question), b.size) }))),
      trials(trialTerm(question), { size: 8 }),
    ]);
    const out = { question, plan, pool, buckets, trials: tr, at: Date.now() };
    mem.set(key, out);
    return out;
  }
  const mem = new Map();

  /** Numbered references for the AI: each paper once, best evidence first. */
  function refsFrom(map) {
    const refs = [];
    const seen = new Set();
    // The most relevant papers first: the same ones the Consensus meter reads.
    for (const a of map.pool?.papers || []) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      refs.push({ kind: 'paper', a, type: D.studyType(a).label, bucket: 'Most relevant' });
    }
    for (const b of map.buckets) {
      for (const a of b.res.results.slice(0, b.ai)) {
        if (seen.has(a.id)) continue;
        seen.add(a.id);
        refs.push({ kind: 'paper', a, type: D.studyType(a).label, bucket: b.label });
      }
    }
    for (const t of map.trials.list.slice(0, 6)) refs.push({ kind: 'trial', t, type: 'Registered trial' });
    return refs.map((r, i) => ({ ...r, n: i + 1 }));
  }
  /**
   * The strongest {@code n} sources (guidelines, meta-analyses, RCTs first; then more relevant and
   * newer), kept in their numbered order so citations still point at the full list. Written answers
   * read these: the rest are mostly small or repeated studies that rarely change the answer, and
   * the AI reads 24 sources carefully where it skims 60.
   */
  function bestRefs(refs, n = 24) {
    if (refs.length <= n) return refs;
    const len = refs.length;
    const score = (r, i) => (r.kind === 'trial' ? 9 : D.studyType(r.a).rank * 2 + ((+r.a.year || 0) >= D.THIS_YEAR - 3 ? 1.5 : 0) + (D.dermJournal(r.a) ? 2 : 0)) + (1 - i / len) * 3;
    const ranked = refs.map((r, i) => ({ r, s: score(r, i) })).sort((x, y) => y.s - x.s);
    const out = [];
    let trials = 0;
    for (const { r } of ranked) {
      if (out.length >= n) break;
      if (r.kind === 'trial' && ++trials > 3) continue;
      out.push(r);
    }
    return out.sort((x, y) => x.n - y.n);
  }
  // Papers reporting no effect, harm or disagreement (they are often smaller and ranked lower).
  const DISSENT = /\bno (significant|difference|benefit|association|improvement|evidence)|not (significantly|associated|superior|effective|supported)|did not|failed to|ineffective|conflicting|inconsistent|controvers|lack of (efficacy|effect|benefit)|\bworse\b|\bharm/i;
  /** For the contradiction check: the strongest sources plus those that disagree, about 30. */
  function balancedRefs(refs, n = 30) {
    if (refs.length <= n) return refs;
    const top = bestRefs(refs, n - 10);
    const rest = refs.filter((r) => !top.includes(r));
    const against = rest.filter((r) => r.kind === 'paper' && DISSENT.test(`${r.a.title} ${D.stripTags(r.a.abstract || '')}`)).slice(0, 10);
    const fill = bestRefs(rest.filter((r) => !against.includes(r)), n - top.length - against.length);
    return [...top, ...against, ...fill].sort((x, y) => x.n - y.n);
  }
  const basedOn = (used, all) => (used.length < all.length ? `<p class="muted small">Based on the ${used.length} strongest of ${all.length} sources.</p>` : '');

  function packText(refs, { abstract = 1100 } = {}) {
    return refs.map((r) => {
      if (r.kind === 'trial') {
        const t = r.t;
        return `[${r.n}] REGISTERED TRIAL ${t.nct} · ${t.phase || 'phase n/a'} · ${t.status} · N=${t.n || '?'} · ${t.title}. Interventions: ${t.interventions.join('; ')}. Conditions: ${t.conditions.join('; ')}.`;
      }
      const a = r.a;
      const abs = D.stripTags(a.abstract || '').slice(0, abstract);
      return `[${r.n}] ${r.type.toUpperCase()} · ${a.jAbbr || a.journal} ${a.year} · ${a.title}. ${abs}`;
    }).join('\n\n');
  }

  /**
   * Completeness: a search finds some papers, not all of medicine. An answer that drops a standard
   * treatment because no paper in this batch mentions it (isotretinoin in acne) is wrong for a clinician.
   */
  const STANDARD = 'Completeness matters as much as citations. For management, treatment or diagnosis questions, never leave out an established, '
    + 'guideline-recommended mainstay just because the provided sources do not mention it (for example isotretinoin for severe, nodular or scarring acne, '
    + 'or acne not responding to oral antibiotics). Put it in its proper place, marked "(established practice; not in the sources found)", with no citation number, '
    + 'and never invent study results, numbers or references for it.';
  const CITE_SYSTEM = 'You are a meticulous dermatology evidence analyst. Use ONLY the numbered sources provided. '
    + 'Every factual claim must cite its sources with their numbers, like [3] or [2, 5]. Never write "studies show" without citations. '
    + 'Keep numbers, doses and effect sizes exactly as reported. Rate evidence strength honestly from study designs and consistency: '
    + 'strong (consistent RCTs or high-quality meta-analyses/guidelines), moderate, limited, very limited, conflicting. '
    + 'If the sources do not answer something, say so. ' + STANDARD;

  // ---- JSON schemas (strict: every property required, no extras)
  const S = {
    str: { type: 'string' }, ints: { type: 'array', items: { type: 'integer' } },
    strength: { type: 'string', enum: ['strong', 'moderate', 'limited', 'very limited', 'conflicting'] },
  };
  const obj = (props) => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props });
  const SYNTH = obj({
    bottomLine: S.str, strength: S.strength,
    sections: { type: 'array', items: obj({ heading: S.str, points: { type: 'array', items: obj({ text: S.str, cites: S.ints, strength: S.strength }) } }) },
    controversies: { type: 'array', items: obj({ text: S.str, cites: S.ints }) },
    gaps: { type: 'array', items: S.str },
    mustRead: S.ints,
  });
  const MATRIX = obj({
    title: S.str,
    rows: { type: 'array', items: obj({
      option: S.str, evidence: { type: 'string', enum: ['High', 'Moderate', 'Low', 'Very low', 'Emerging'] },
      population: S.str, response: S.str, safety: S.str, followup: S.str, cites: S.ints,
      n: S.str, endpoints: S.str, effect: S.str, ci: S.str, limitations: S.str,
    }) },
  });
  const CONTRA = obj({
    claim: S.str,
    forEvidence: { type: 'array', items: obj({ cite: { type: 'integer' }, point: S.str }) },
    againstEvidence: { type: 'array', items: obj({ cite: { type: 'integer' }, point: S.str }) },
    reasons: { type: 'array', items: obj({ reason: S.str, explanation: S.str }) },
    assessment: S.str, strength: S.strength,
  });

  // ================================================================ citations UI
  const contexts = new Map(); // ctx id -> refs
  let ctxSeq = 0;
  function newCtx(refs) {
    const id = 'c' + (++ctxSeq);
    contexts.set(id, refs);
    return id;
  }
  /** Markdown with [n] citations turned into buttons that show the sources. */
  function citeHtml(html, ctx) {
    return html.replace(/\[(\d+(?:\s*[,–-]\s*\d+)*)\]/g, (m0, list) => citeBtns([...list.matchAll(/\d+/g)].map((x) => Number(x[0])), ctx));
  }
  /** A citation as Consensus shows it: first author and year ("Capon 2017"), or the trial ID. */
  function citeLabel(n, ctx) {
    const r = (contexts.get(ctx) || []).find((x) => x.n === Number(n));
    if (!r) return String(n);
    if (r.kind === 'trial') return r.t.nct || String(n);
    const first = String(r.a.authors || '').split(',')[0].trim().split(/\s+/)[0] || (r.a.jAbbr || 'Study');
    return `${first} ${r.a.year || ''}`.trim();
  }
  const citeBtns = (cites, ctx) => {
    if (!cites?.length) return '';
    const labels = cites.map((n) => citeLabel(n, ctx));
    const shown = labels.length > 2 ? `${labels.slice(0, 2).join(', ')} +${labels.length - 2}` : labels.join(', ');
    return `<button class="cite" data-act="cite-show" data-ctx="${ctx}" data-n="${cites.join(',')}">${esc(shown)}</button>`;
  };
  // ================================================================ Word and PowerPoint export
  // A report is {title, subtitle, blocks: [{h} | {p} | {ul: []} | {table: {columns, rows, caption}}]} with
  // [n] citations; exports turn them into (Author Year) and add the cited papers as references.
  const loaded = {};
  const loadScript = (src) => loaded[src] || (loaded[src] = new Promise((res, rej) => {
    const el = document.createElement('script');
    el.src = src; el.onload = res; el.onerror = () => { delete loaded[src]; rej(new Error('Couldn\'t load the export tool')); };
    document.head.appendChild(el);
  }));
  /** "[2, 5]" → "(Capon 2017; Dand 2020)", remembering which references were cited. */
  function plainCites(text, ctx, used) {
    return String(text || '').replace(/\s*\[(\d+(?:\s*[,–-]\s*\d+)*)\]/g, (m0, list) => {
      const nums = [...list.matchAll(/\d+/g)].map((x) => Number(x[0]));
      nums.forEach((n) => used.add(n));
      return ` (${nums.map((n) => citeLabel(n, ctx)).join('; ')})`;
    });
  }
  function refLine(r) {
    if (r.kind === 'trial') return `${r.t.title}. ClinicalTrials.gov ${r.t.nct}${r.t.status ? ' (' + r.t.status + ')' : ''}.`;
    const a = r.a;
    const au = String(a.authors || '').split(',').map((x) => x.trim()).filter(Boolean);
    return `${au.length > 3 ? au.slice(0, 3).join(', ') + ', et al' : au.join(', ')}. ${a.title}. ${a.jAbbr || a.journal || ''} ${a.year || ''}${a.doi ? '. doi:' + a.doi : a.pmid ? '. PMID ' + a.pmid : ''}.`;
  }
  /** Plain text report with citations resolved, and the reference list in citation order. */
  function resolveReport(rep, ctx) {
    const used = new Set();
    const pc = (t) => plainCites(t, ctx, used);
    const blocks = rep.blocks.map((b) => (b.p != null ? { p: pc(b.p) } : b.ul ? { ul: b.ul.map(pc) } : b.table ? { table: { ...b.table, rows: b.table.rows.map((row) => row.map(pc)) } } : b));
    const all = contexts.get(ctx) || [];
    const refs = [...used].map((n) => all.find((x) => x.n === n)).filter(Boolean)
      .sort((x, y) => citeLabel(x.n, ctx).localeCompare(citeLabel(y.n, ctx))).map((r) => `${citeLabel(r.n, ctx)}. ${refLine(r)}`);
    return { ...rep, blocks, refs };
  }
  const fileName = (title, ext) => `${String(title).replace(/[^\w\s-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'DermScholar'}.${ext}`;
  const MIME = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
  function deliver(name, b64, mime) {
    if (Native.exportFile) Native.exportFile(name, b64, mime);
    else { const a = document.createElement('a'); a.href = `data:${mime};base64,${b64}`; a.download = name; a.click(); }
  }
  async function exportWord(rep0, ctx) {
    await loadScript('vendor/office/docx.min.js');
    const { Document, Packer, Paragraph, HeadingLevel, TextRun, Table, TableRow, TableCell, WidthType } = window.docx;
    const rep = resolveReport(rep0, ctx);
    const children = [new Paragraph({ text: rep.title, heading: HeadingLevel.TITLE })];
    if (rep.subtitle) children.push(new Paragraph({ children: [new TextRun({ text: rep.subtitle, italics: true, color: '666666' })] }));
    for (const b of rep.blocks) {
      if (b.h) children.push(new Paragraph({ text: b.h, heading: HeadingLevel.HEADING_2, spacing: { before: 240 } }));
      else if (b.p != null) children.push(new Paragraph({ children: [new TextRun(b.p)], spacing: { after: 120 } }));
      else if (b.ul) b.ul.forEach((t) => children.push(new Paragraph({ text: t, bullet: { level: 0 } })));
      else if (b.table) {
        const cell = (t, bold) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: String(t), bold })] })] });
        children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ tableHeader: true, children: b.table.columns.map((c) => cell(c, true)) }), ...b.table.rows.map((r) => new TableRow({ children: b.table.columns.map((_, i) => cell(r[i] ?? '', false)) }))] }));
        if (b.table.caption) children.push(new Paragraph({ children: [new TextRun({ text: b.table.caption, italics: true, size: 18 })] }));
      }
    }
    if (rep.refs.length) {
      children.push(new Paragraph({ text: 'References', heading: HeadingLevel.HEADING_2, spacing: { before: 240 } }));
      rep.refs.forEach((t) => children.push(new Paragraph({ children: [new TextRun({ text: t, size: 18 })], spacing: { after: 80 } })));
    }
    children.push(new Paragraph({ children: [new TextRun({ text: 'Made with DermScholar. AI-written from paper abstracts: check key numbers in the papers.', italics: true, size: 16, color: '888888' })], spacing: { before: 240 } }));
    const doc = new Document({ creator: 'DermScholar', title: rep.title, sections: [{ children }] });
    deliver(fileName(rep.title, 'docx'), await Packer.toBase64String(doc), MIME.docx);
  }
  async function exportSlides(rep0, ctx) {
    await loadScript('vendor/office/pptxgen.bundle.js');
    const rep = resolveReport(rep0, ctx);
    const pptx = new window.PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.title = rep.title;
    const ACC = '7C3AED';
    const head = (sl, t) => { sl.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: ACC } }); sl.addText(t, { x: 0.6, y: 0.35, w: 12.1, h: 0.8, fontSize: 26, bold: true, color: '1F2937', fit: 'shrink' }); };
    const foot = (sl) => sl.addText('DermScholar · AI-written from paper abstracts: check key numbers', { x: 0.6, y: 7.0, w: 12.1, h: 0.3, fontSize: 9, color: '9CA3AF' });
    const t = pptx.addSlide();
    t.background = { color: 'F5F3FF' };
    t.addText(rep.title, { x: 0.8, y: 2.3, w: 11.7, h: 1.6, fontSize: 36, bold: true, color: '1F2937', fit: 'shrink' });
    if (rep.subtitle) t.addText(rep.subtitle, { x: 0.8, y: 4.0, w: 11.7, h: 1.2, fontSize: 18, color: '4B5563', fit: 'shrink' });
    t.addText('DermScholar', { x: 0.8, y: 6.4, w: 6, h: 0.4, fontSize: 12, color: ACC, bold: true });
    // One slide per section (text split over slides when long; tables on their own slide).
    let cur = null;
    const flush = () => {
      if (!cur || !cur.lines.length) return;
      for (let i = 0; i < cur.lines.length; i += 5) {
        const sl = pptx.addSlide();
        head(sl, cur.h + (i ? ' (cont.)' : ''));
        sl.addText(cur.lines.slice(i, i + 5).map((x) => ({ text: x, options: { bullet: true, breakLine: true, paraSpaceAfter: 8 } })), { x: 0.6, y: 1.3, w: 12.1, h: 5.5, fontSize: 18, color: '1F2937', valign: 'top', fit: 'shrink' });
        foot(sl);
      }
      cur.lines = [];
    };
    for (const b of rep.blocks) {
      if (b.h) { flush(); cur = { h: b.h, lines: [] }; continue; }
      cur = cur || { h: rep.title, lines: [] };
      if (b.p != null) cur.lines.push(b.p);
      else if (b.ul) cur.lines.push(...b.ul);
      else if (b.table) {
        flush();
        const sl = pptx.addSlide();
        head(sl, b.table.caption || cur.h);
        const hdr = b.table.columns.map((c) => ({ text: c, options: { bold: true, color: 'FFFFFF', fill: { color: ACC } } }));
        sl.addTable([hdr, ...b.table.rows.map((r) => b.table.columns.map((_, i) => ({ text: String(r[i] ?? '') })))], { x: 0.6, y: 1.3, w: 12.1, fontSize: 13, color: '1F2937', border: { type: 'solid', color: 'E5E7EB', pt: 0.75 }, autoPage: true, autoPageRepeatHeader: true });
        foot(sl);
      }
    }
    flush();
    for (let i = 0; i < rep.refs.length; i += 7) {
      const sl = pptx.addSlide();
      head(sl, 'References' + (i ? ' (cont.)' : ''));
      sl.addText(rep.refs.slice(i, i + 7).map((x) => ({ text: x, options: { breakLine: true, paraSpaceAfter: 6 } })), { x: 0.6, y: 1.3, w: 12.1, h: 5.5, fontSize: 12, color: '374151', valign: 'top', fit: 'shrink' });
    }
    deliver(fileName(rep.title, 'pptx'), await pptx.write({ outputType: 'base64' }), MIME.pptx);
  }
  /** Word and Slides buttons for a report built on demand by make(). */
  function exportBtns(id) { return `<button class="btn xs" data-act="ex-word" data-id="${id}">${icon('download')}Word</button> <button class="btn xs" data-act="ex-slides" data-id="${id}">${icon('download')}Slides</button>`; }
  const reports = new Map();
  /** Registers a report for the export buttons; returns the id to pass to exportBtns. */
  function offerExport(make, ctx) { const id = 'r' + (reports.size + 1) + '_' + Date.now(); reports.set(id, { make, ctx }); return id; }
  async function runExport(kind, id) {
    const r = reports.get(id);
    if (!r) return;
    toast(kind === 'word' ? 'Making the Word document…' : 'Making the slides…');
    try { await (kind === 'word' ? exportWord : exportSlides)(r.make(), r.ctx); } catch (e) { toast(e.message || 'Export failed'); }
  }
  actions['ex-word'] = (b) => runExport('word', b.dataset.id);
  actions['ex-slides'] = (b) => runExport('slides', b.dataset.id);

  const STRENGTH = {
    strong: ['🟢', 'Strong'], moderate: ['🟡', 'Moderate'], limited: ['🟠', 'Limited'],
    'very limited': ['🔴', 'Very limited'], conflicting: ['⚫', 'Conflicting'],
  };
  const strength = (s) => { const x = STRENGTH[s] || STRENGTH.limited; return `<span class="strength s-${esc(String(s).replace(' ', '-'))}">${x[0]} ${x[1]}</span>`; };

  function refRow(r) {
    if (r.kind === 'trial') {
      const t = r.t;
      return `<div class="ref"><div class="ref-n">${r.n}</div><div class="ref-b"><span class="tag">Trial · ${esc(t.phase || 'n/a')} · ${esc(t.status)}</span>
        <b>${esc(t.title)}</b><span class="muted small">${esc(t.nct)}${t.n ? ' · N=' + t.n : ''}${t.sponsor ? ' · ' + esc(t.sponsor) : ''}</span>
        <button class="btn xs" data-act="open-trial" data-nct="${esc(t.nct)}">${icon('external')}ClinicalTrials.gov</button></div></div>`;
    }
    const a = r.a;
    return `<div class="ref"><div class="ref-n">${r.n}</div><div class="ref-b"><span class="tag">${esc(r.type)}</span>
      <b>${esc(a.title)}</b><span class="muted small">${esc(D.shortAuthors(a.authors || ''))} · ${esc(a.jAbbr || a.journal)} ${esc(a.year)}${a.citedBy ? ' · ' + a.citedBy + ' citations' : ''}</span>
      ${r.quote ? `<p class="small ref-quote">“${esc(r.quote)}”</p>` : a.finding ? `<p class="small">${esc(a.finding)}</p>` : ''}
      <button class="btn xs" data-act="open" data-id="${esc(a.id)}">${icon('file')}Open paper</button></div></div>`;
  }
  actions['cite-show'] = (b) => {
    const refs = contexts.get(b.dataset.ctx) || [];
    const nums = b.dataset.n.split(',').map(Number);
    const list = refs.filter((r) => nums.includes(r.n));
    sheet(`<h3>Why did the AI say this?</h3><p class="muted small">The statement is based on ${list.length === 1 ? 'this source' : 'these sources'}:</p>
      ${list.map(refRow).join('') || '<p class="muted">Source not found.</p>'}`);
  };
  /** The sources an answer cites (all of them if it cited none), listed under the answer, each tappable. */
  function sourcesList(text, refs) {
    const cited = new Set([...String(text).matchAll(/\[(\d+(?:\s*[,–-]\s*\d+)*)\]/g)].flatMap((m) => [...m[1].matchAll(/\d+/g)].map((x) => +x[0])));
    const list = cited.size ? refs.filter((r) => cited.has(r.n)) : refs.slice(0, 12);
    if (!list.length) return '';
    return `<h4>Sources${cited.size ? '' : ' read for this answer'}</h4><div class="src-list">${list.map((r) => r.kind === 'trial'
      ? `<button class="src-row" data-act="open-trial" data-nct="${esc(r.t.nct)}"><b>${r.n}</b><span>${esc(r.t.title)}<small>${esc(r.t.nct)} · trial</small></span></button>`
      : `<button class="src-row" data-act="open" data-id="${esc(r.a.id)}"><b>${r.n}</b><span>${esc(r.a.title)}<small>${esc(r.a.jAbbr || r.a.journal)} ${esc(r.a.year)} · ${esc(r.type)}</small></span></button>`).join('')}</div>`;
  }
  actions['open-trial'] = (b) => openUrl('https://clinicaltrials.gov/study/' + b.dataset.nct);
  actions['refs-all'] = (b) => {
    const refs = contexts.get(b.dataset.ctx) || [];
    sheet(`<h3>All sources (${refs.length})</h3>${refs.map(refRow).join('')}`);
  };

  // ================================================================ AI helpers
  const needKey = () => !D.aiHasKey();
  function keyCard() {
    return `<div class="panel"><b>${icon('spark')} Add a free AI key</b><p class="small">The AI synthesis, matrix and contradiction check need an AI key.
      <b>Gemini</b> (free, aistudio.google.com/apikey) reads the most papers at once; <b>Groq</b> (free, console.groq.com/keys) is fastest.</p>
      <button class="btn primary" data-act="settings">Open Settings → AI</button></div>`;
  }
  const aiErr = (e) => `<div class="panel"><b>The AI didn't answer</b><p class="small">${esc(e.message === 'NO_KEY' ? 'Add an AI key in Settings → AI.' : e.message)}</p></div>`;
  async function aiJsonCall(task, refs, schema, max = 6000) {
    const text = await D.ai(task, { doc: packText(refs), system: CITE_SYSTEM, schema, max });
    return D.aiJson(text);
  }
  const cacheGet = (k) => { const v = store.get('intel.' + k, null); return v && Date.now() - v.at < 7 * 864e5 ? v.data : null; };
  const cacheSet = (k, data) => store.set('intel.' + k, { at: Date.now(), data });

  // ================================================================ Evidence Map screen (#ev?q=)
  function evHash(question) { return 'ev?' + new URLSearchParams({ q: question }); }

  async function renderEvidence(_, p) {
    const question = (p.q || '').trim();
    if (!question) { go('intel', { replace: true }); return; }
    const watched = watches().some((w) => w.q.toLowerCase() === question.toLowerCase());
    view.innerHTML = `${D.topbar('Evidence Map', { right: `<button class="icon-btn" data-act="ev-watch" aria-label="Watch">${icon(watched ? 'starFill' : 'star')}</button>` })}
      <div class="ev-q"><span class="muted small">Question</span><h2>${esc(question)}</h2>
        <div class="muted small">Europe PMC (all of PubMed/MEDLINE, PMC, Cochrane) · ClinicalTrials.gov · OpenAlex citations</div>
        <div class="row wrap" style="margin-top:8px">
          <button class="chip" data-act="ev-utd" data-q="${esc(question)}">${icon('book')}UpToDate</button>
          <button class="chip" data-act="ev-r4l">${icon('key')}Research4Life</button>
          <button class="chip" data-act="cm-open" data-q="${esc(question)}">📊 Consensus meter</button>
          <button class="chip" data-act="ev-papers" data-q="${esc(question)}">${icon('search')}All papers</button>
          <button class="chip" data-act="ev-dermnet" data-q="${esc(question)}">${icon('globe')}DermNet</button>
          <button class="chip" data-act="ev-ictrp" data-q="${esc(question)}">${icon('globe')}WHO ICTRP</button>
        </div></div>
      <div id="ev-steps"></div>
      <div id="ev-ai"></div>
      <div id="ev-map">${D.skeletons(4)}</div>`;
    actions['ev-watch'] = () => { toggleWatch(question); render(); };
    let map;
    const steps = [];
    $('#ev-ai').innerHTML = busyHtml('Planning the searches…');
    try {
      map = await gather(question, { onStep: (st) => { steps.push(st); if (D.current.name === 'ev' && $('#ev-ai')) $('#ev-ai').innerHTML = stepsHtml(steps) + busyHtml('Searching…'); } });
    } catch (e) {
      $('#ev-map').innerHTML = D.errorBox(e);
      return;
    }
    if (D.current.name !== 'ev') return;
    const refs = refsFrom(map);
    const ctx = newCtx(refs);
    const total = map.buckets.reduce((s, b) => s + (b.res.hit || 0), 0);
    if (map.pool?.steps?.length) $('#ev-steps').innerHTML = stepsHtml(map.pool.steps, { read: refs.length, done: true, retrieved: map.pool.retrieved, eligible: map.pool.total });
    $('#ev-map').innerHTML = `
      <div class="ev-summary">${map.buckets.map((b) => `<div><b>${b.res.hit > 999 ? Math.round(b.res.hit / 100) / 10 + 'k' : b.res.hit}</b><span>${b.emoji} ${esc(b.label.split(' ')[0])}</span></div>`).join('')}
        <div><b>${map.trials.total || 0}</b><span>🧪 Trials</span></div></div>
      ${map.buckets.map((b) => bucketHtml(b, question)).join('')}
      <div class="section"><div class="section-h"><h3>🧪 Clinical trials</h3><button data-act="go-trials" data-q="${esc(trialTerm(question))}">Trial radar</button></div>
        ${map.trials.list.length ? map.trials.list.slice(0, 5).map(trialCard).join('') : `<div class="muted small">${map.trials.error ? 'ClinicalTrials.gov didn\'t answer.' : 'No registered trials found.'}</div>`}</div>
      <p class="muted small" style="margin-top:18px">${total.toLocaleString()} matching records. The AI reads the top ${refs.length} sources, numbered below.</p>
      <button class="btn full" data-act="refs-all" data-ctx="${ctx}">${icon('list')}All ${refs.length} numbered sources</button>`;
    actions['go-trials'] = (b) => go('trials?' + new URLSearchParams({ q: b.dataset.q }));
    drawAi(question, refs, ctx);
  }

  function bucketHtml(b, question) {
    const list = b.res.results.slice(0, 3);
    return `<div class="section ev-bucket"><div class="section-h"><h3>${b.emoji} ${esc(b.label)} <span class="count">${b.res.hit || 0}</span></h3>
      ${b.res.hit > 3 ? `<button data-act="ev-more" data-b="${b.key}" data-q="${esc(question)}">See all</button>` : ''}</div>
      ${list.length ? list.map((a) => D.card(a, { compact: true })).join('') : `<div class="muted small">${b.res.error ? 'Couldn\'t load: ' + esc(b.res.error) : 'None found.'}</div>`}</div>`;
  }
  function trialCard(t) {
    const live = /recruiting|active|enrolling|not yet/.test(t.status);
    return `<div class="card trial" data-act="open-trial" data-nct="${esc(t.nct)}">
      <div class="badges"><span class="badge ${live ? 'b-rct' : ''}">${esc(t.status || 'status n/a')}</span>${t.phase ? `<span class="badge">${esc(t.phase)}</span>` : ''}${t.n ? `<span class="badge">N=${t.n}</span>` : ''}</div>
      <p class="title main">${esc(t.title)}</p>
      <div class="byline"><span>${esc(t.nct)}</span>${t.sponsor ? `<span class="dot">${esc(t.sponsor)}</span>` : ''}${t.updated ? `<span class="dot">updated ${esc(t.updated)}</span>` : ''}</div>
      ${t.interventions.length ? `<p class="small muted">${esc(t.interventions.slice(0, 4).join(' · '))}</p>` : ''}</div>`;
  }
  actions['ev-more'] = (b) => {
    const bk = BUCKETS.find((x) => x.key === b.dataset.b);
    const types = { sr: ['meta', 'sr'], rct: ['rct'], case: ['case'], guide: ['guide'] }[bk.key] || [];
    go(D.searchHash(D.filtersFrom({ q: b.dataset.q, types: types.join(','), sort: bk.key === 'recent' ? 'newest' : 'relevance' })));
  };
  actions['ev-papers'] = (b) => go(D.searchHash(D.filtersFrom({ q: b.dataset.q })));
  actions['ev-utd'] = (b) => go('search?' + new URLSearchParams({ q: b.dataset.q, src: 'utd' }));
  actions['ev-r4l'] = () => Native.openPortal('https://portal.research4life.org/signin', '', '');
  actions['ev-dermnet'] = (b) => openUrl('https://dermnetnz.org/search?q=' + encodeURIComponent(b.dataset.q));
  actions['ev-ictrp'] = (b) => openUrl('https://trialsearch.who.int/?SearchAll=' + encodeURIComponent(trialTerm(b.dataset.q)));

  /** The AI panel: synthesis first, then matrix / contradictions / listen on request. */
  function drawAi(question, refs, ctx) {
    const el = $('#ev-ai');
    if (!el) return;
    if (needKey()) { el.innerHTML = keyCard(); return; }
    el.innerHTML = `<div class="ai-tools scroll-x">
        <button class="chip on" data-act="ev-tool" data-t="synth">${icon('spark')}AI synthesis</button>
        <button class="chip" data-act="ev-tool" data-t="matrix">${icon('chart')}Evidence matrix</button>
        <button class="chip" data-act="ev-tool" data-t="contra">${icon('alert')}Contradictions</button>
        <button class="chip" data-act="ev-tool" data-t="listen">${icon('audio')}Listen</button></div>
      <div id="ev-out"></div>`;
    actions['ev-tool'] = (b) => {
      $$('.ai-tools .chip').forEach((c) => c.classList.toggle('on', c === b));
      const t = b.dataset.t;
      if (t === 'synth') synth(question, refs, ctx);
      if (t === 'matrix') matrix(question, refs, ctx);
      if (t === 'contra') contra(question, refs, ctx);
      if (t === 'listen') listen(question, refs);
    };
    synth(question, refs, ctx);
  }
  const busyHtml = (msg) => `<div class="panel busy-inline"><span class="spin"></span>${esc(msg)}</div>`;

  /** The synthesis as an exportable report (Word, slides). */
  function synthReport(question, r) {
    const st = (x) => (STRENGTH[x] ? ` (${STRENGTH[x][1].toLowerCase()} evidence)` : '');
    const withCites = (t, cites) => t + (cites?.length && !/\[\d/.test(t) ? ` [${cites.join(', ')}]` : '');
    const blocks = [{ h: 'Bottom line' }, { p: r.bottomLine + st(r.strength) }];
    for (const x of r.sections || []) blocks.push({ h: x.heading }, { ul: (x.points || []).map((pt) => withCites(pt.text, pt.cites) + st(pt.strength)) });
    if (r.controversies?.length) blocks.push({ h: 'Where the evidence disagrees' }, { ul: r.controversies.map((c) => withCites(c.text, c.cites)) });
    if (r.gaps?.length) blocks.push({ h: 'Unanswered questions' }, { ul: r.gaps });
    return { title: question, subtitle: `Evidence synthesis · ${new Date().toLocaleDateString()}`, blocks };
  }

  async function synth(question, refs, ctx) {
    const out = $('#ev-out');
    const ck = 'synth3.' + question.toLowerCase();
    let r = cacheGet(ck);
    const use = bestRefs(refs);
    if (!r) {
      out.innerHTML = busyHtml(`Reading the ${use.length} strongest sources…`);
      try {
        r = await aiJsonCall(
          `Question: ${question}\n\nWrite a citation-first evidence synthesis for a dermatologist. The bottom line answers the question directly in one or two sentences. `
          + 'For management or treatment questions the bottom line names the overall approach by severity, including every established mainstay '
          + '(e.g. for acne: topical retinoids and benzoyl peroxide, oral antibiotics, hormonal therapy, and isotretinoin for severe, scarring or resistant acne), '
          + 'even ones the sources found do not cover; it must never read as if a standard option does not exist. '
          + 'Choose sections that fit the question. Treatment questions: "What the guidelines say", "What the strongest evidence shows", "Efficacy in numbers", "Safety", "Ongoing trials and what is coming", "What has changed recently". '
          + 'Cause, risk, genetics, epidemiology or mechanism questions: "Key findings", "How strong the evidence is" (twin, family, cohort, genetic or meta-analytic data with numbers), "Mechanisms", "Clinical relevance", "Open questions". '
          + 'Skip any section the sources don\'t cover; never write a point only to say a source type is missing. '
          + 'Rate strength by what the sources show about the question: many consistent studies stating the same established fact is strong, even without trials. '
          + 'If few sources address the question directly, say "the papers found address this only partly" rather than calling the evidence very limited. '
          + 'Each point: one or two sentences with citations and its own evidence strength. Then list controversies (where sources disagree), research gaps, and the 3-5 sources most worth reading.',
          use, SYNTH);
        cacheSet(ck, r);
      } catch (e) { out.innerHTML = aiErr(e); return; }
    }
    if (!$('#ev-out')) return;
    out.innerHTML = `<div class="panel synth">
      <div class="label">${icon('spark')}Bottom line ${strength(r.strength)}</div><p class="bottom">${citeHtml(esc(r.bottomLine), ctx)}</p>
      ${(r.sections || []).map((s) => `<h4>${esc(s.heading)}</h4><ul>${(s.points || []).map((p) => `<li>${citeHtml(esc(p.text), ctx)} ${citeBtns(p.cites, ctx)} ${strength(p.strength)}</li>`).join('')}</ul>`).join('')}
      ${r.controversies?.length ? `<h4>⚔️ Where the evidence disagrees</h4><ul>${r.controversies.map((c) => `<li>${esc(c.text)} ${citeBtns(c.cites, ctx)}</li>`).join('')}</ul>` : ''}
      ${r.gaps?.length ? `<h4>🕳️ Unanswered questions</h4><ul>${r.gaps.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>` : ''}
      ${r.mustRead?.length ? `<h4>📌 Read first</h4><div class="row wrap">${r.mustRead.map((n) => citeBtns([n], ctx)).join('')}</div>` : ''}
      <p class="muted small">Tap a number to see the exact sources. AI can misread abstracts: check key numbers in the papers.</p>${basedOn(use, refs)}
      <div class="row wrap" style="gap:6px"><button class="btn xs" data-act="ev-redo">${icon('spark')}Redo</button> ${exportBtns(offerExport(() => synthReport(question, r), ctx))}</div></div>`;
    actions['ev-redo'] = () => { store.set('intel.' + ck, null); synth(question, refs, ctx); };
  }

  async function matrix(question, refs, ctx) {
    const out = $('#ev-out');
    const ck = 'matrix2.' + question.toLowerCase();
    let r = cacheGet(ck);
    if (!r) {
      out.innerHTML = busyHtml('Building the evidence matrix…');
      try {
        r = await aiJsonCall(`Question: ${question}\n\nBuild an evidence matrix: one row per treatment/option/exposure studied in the sources (up to 10, strongest evidence first). `
          + 'evidence = High/Moderate/Low/Very low/Emerging; population; response (e.g. "↑↑ PASI-75 62% vs 12%" or "?"); safety (key signals or "—"); followup; '
          + 'cites; and from the cited studies: n (patients), endpoints, effect (effect size), ci (confidence interval or "not reported"), limitations.', refs, MATRIX, 7000);
        cacheSet(ck, r);
      } catch (e) { out.innerHTML = aiErr(e); return; }
    }
    if (!$('#ev-out')) return;
    const rows = r.rows || [];
    window.__evMatrix = { rows, ctx };
    out.innerHTML = `<div class="panel"><div class="label">${icon('chart')}${esc(r.title || 'Evidence matrix')}</div>
      <div class="matrix-wrap"><table class="matrix"><thead><tr><th>Option</th><th>Evidence</th><th>Population</th><th>Response</th><th>Safety</th><th>Follow-up</th></tr></thead>
      <tbody>${rows.map((x, i) => `<tr data-act="mx-row" data-i="${i}"><td><b>${esc(x.option)}</b></td><td><span class="ev-lv lv-${esc(x.evidence.replace(' ', '-'))}">${esc(x.evidence)}</span></td>
        <td>${esc(x.population)}</td><td>${esc(x.response)}</td><td>${esc(x.safety)}</td><td>${esc(x.followup)}</td></tr>`).join('')}</tbody></table></div>
      <p class="muted small">Tap a row for patient numbers, endpoints, effect sizes, confidence intervals, limitations and the studies. Based on all ${refs.length} sources.</p></div>`;
  }
  actions['mx-row'] = (b) => {
    const { rows, ctx } = window.__evMatrix || {};
    const x = rows?.[+b.dataset.i];
    if (!x) return;
    const refs = (contexts.get(ctx) || []).filter((r) => x.cites.includes(r.n));
    sheet(`<h3>${esc(x.option)}</h3>
      <div class="kv"><span>Evidence</span><b>${esc(x.evidence)}</b><span>Patients</span><b>${esc(x.n)}</b><span>Endpoints</span><b>${esc(x.endpoints)}</b>
      <span>Effect</span><b>${esc(x.effect)}</b><span>95% CI</span><b>${esc(x.ci)}</b><span>Follow-up</span><b>${esc(x.followup)}</b><span>Safety</span><b>${esc(x.safety)}</b></div>
      <p class="small"><b>Limitations:</b> ${esc(x.limitations)}</p><h4>Supporting studies</h4>${refs.map(refRow).join('') || '<p class="muted">None cited.</p>'}`);
  };

  async function contra(question, refs, ctx) {
    const out = $('#ev-out');
    const ck = 'contra2.' + question.toLowerCase();
    let r = cacheGet(ck);
    const use = balancedRefs(refs);
    if (!r) {
      out.innerHTML = busyHtml('Looking for disagreements…');
      try {
        r = await aiJsonCall(`Question: ${question}\n\nContradiction check. State the main claim being tested. List the evidence FOR it and the evidence AGAINST it or limiting it (each with one citation number and a one-sentence point). `
          + 'Then explain WHY the studies disagree (different populations, doses, endpoints, follow-up, sample sizes, designs, bias, statistics). Finish with an honest overall assessment and evidence strength.', use, CONTRA);
        cacheSet(ck, r);
      } catch (e) { out.innerHTML = aiErr(e); return; }
    }
    if (!$('#ev-out')) return;
    out.innerHTML = `<div class="panel"><div class="label">${icon('alert')}Claim tested</div><p class="bottom">${esc(r.claim)}</p>
      <div class="contra"><div><h4>✅ Evidence for</h4><ul>${(r.forEvidence || []).map((x) => `<li>${esc(x.point)} ${citeBtns([x.cite], ctx)}</li>`).join('') || '<li class="muted">None in the sources.</li>'}</ul></div>
      <div><h4>⚠️ Against / limitations</h4><ul>${(r.againstEvidence || []).map((x) => `<li>${esc(x.point)} ${citeBtns([x.cite], ctx)}</li>`).join('') || '<li class="muted">None in the sources.</li>'}</ul></div></div>
      ${r.reasons?.length ? `<h4>Why do the studies disagree?</h4><ul>${r.reasons.map((x) => `<li><b>${esc(x.reason)}:</b> ${esc(x.explanation)}</li>`).join('')}</ul>` : ''}
      <div class="label" style="margin-top:12px">AI evidence assessment ${strength(r.strength)}</div><p>${esc(r.assessment)}</p>
      ${use.length < refs.length ? `<p class="muted small">Based on ${use.length} of ${refs.length} sources: the strongest, plus those reporting no effect or disagreeing.</p>` : ''}</div>`;
  }

  async function listen(question, refs) {
    const out = $('#ev-out');
    out.innerHTML = busyHtml('Writing a spoken briefing…');
    const use = bestRefs(refs);
    const wrap = (h) => `<div class="label">${icon('audio')}Research briefing</div>${h}`;
    try {
      const text = await D.ai(`Question: ${question}\n\nWrite a 3-minute spoken research briefing for a dermatologist: what is known, how strong it is, where studies disagree, what is coming in trials, and the bottom line. `
        + 'Plain spoken prose, no citations in brackets, no Markdown. Mention study types and years naturally ("a 2024 meta-analysis found…").', { doc: packText(use, { abstract: 700 }), system: CITE_SYSTEM, max: 2500, onPartial: D.live(out, { cls: 'panel', wrap }) });
      const lines = text.split(/\n+/).map((t) => t.trim()).filter((t) => t.length > 1).map((t) => ({ t }));
      out.innerHTML = `<div class="panel">${wrap(md(text))}${basedOn(use, refs)}</div>`;
      D.ttsPlayScript?.('Briefing', lines, { title: 'Briefing: ' + question.slice(0, 60) });
    } catch (e) { out.innerHTML = aiErr(e); }
  }

  // ================================================================ What changed since I last looked (#updates)
  const watches = () => store.get('watches', []);
  function toggleWatch(question) {
    const list = watches();
    const i = list.findIndex((w) => w.q.toLowerCase() === question.toLowerCase());
    if (i >= 0) { list.splice(i, 1); toast('No longer watching'); } else { list.push({ q: question, since: today() }); toast('Watching: you\'ll see what changes'); }
    store.set('watches', list);
  }

  async function changesFor(w) {
    const since = w.since || daysAgo(30);
    const range = `FIRST_PDATE:[${since} TO ${today()}]`;
    const kinds = [
      { key: 'rct', emoji: '🆕', label: 'new RCTs', spec: q(w.q, { types: ['rct'], extra: range }) },
      { key: 'sr', emoji: '📚', label: 'new systematic reviews', spec: q(w.q, { types: ['meta', 'sr'], extra: range }) },
      { key: 'guide', emoji: '📋', label: 'guideline updates', spec: q(w.q, { extra: `${GUIDE} AND ${range}` }) },
      { key: 'safety', emoji: '⚠️', label: 'safety reports', spec: q(w.q, { extra: `${SAFETY} AND ${range}`, treat: false }) },
      { key: 'other', emoji: '📄', label: 'other new papers', spec: q(w.q, { extra: range, sort: 'P_PDATE_D desc' }) },
    ];
    const [res, tr] = await Promise.all([
      Promise.all(kinds.map(async (k) => ({ ...k, res: await epmc(k.spec, 6) }))),
      trials(trialTerm(w.q), { since, size: 6 }),
    ]);
    return { w, since, kinds: res, trials: tr };
  }

  async function renderUpdates() {
    const list = watches();
    view.innerHTML = `${D.topbar('What changed?')}
      <p class="muted small">New evidence since you last looked, for the questions you watch (★ on any Evidence Map).</p>
      <div id="upd">${list.length ? D.skeletons(3) : '<div class="empty">' + icon('star') + '<b>Nothing watched yet</b><div>Open an Evidence Map and tap ★ to watch a question.</div></div>'}</div>`;
    if (!list.length) return;
    const all = await Promise.all(list.map(changesFor));
    if (D.current.name !== 'updates') return;
    $('#upd').innerHTML = all.map((c, i) => {
      const counts = c.kinds.map((k) => k.res.hit ? `<span>${k.emoji} ${k.res.hit} ${esc(k.label)}</span>` : '').join('') +
        (c.trials.total ? `<span>🧪 ${c.trials.total} new/updated trials</span>` : '');
      return `<div class="panel upd"><div class="section-h"><h3>${esc(c.w.q)}</h3></div>
        <div class="muted small">Since ${esc(c.since)}</div><div class="upd-counts">${counts || '<span class="muted">Nothing new</span>'}</div>
        <div class="row wrap"><button class="btn xs primary" data-act="upd-matters" data-i="${i}">${icon('spark')}What actually matters?</button>
        <button class="btn xs" data-act="upd-open" data-q="${esc(c.w.q)}">Evidence map</button>
        <button class="btn xs" data-act="upd-seen" data-i="${i}">${icon('check')}Mark as seen</button></div><div id="upd-ai-${i}"></div></div>`;
    }).join('');
    actions['upd-open'] = (b) => go(evHash(b.dataset.q));
    actions['upd-seen'] = (b) => {
      const l = watches();
      if (l[+b.dataset.i]) l[+b.dataset.i].since = today();
      store.set('watches', l);
      toast('Marked as seen');
      render();
    };
    actions['upd-matters'] = async (b) => {
      const c = all[+b.dataset.i];
      const el = $('#upd-ai-' + b.dataset.i);
      if (needKey()) { el.innerHTML = keyCard(); return; }
      const refs = [];
      for (const k of c.kinds) for (const a of k.res.results.slice(0, 5)) if (!refs.some((r) => r.a?.id === a.id)) refs.push({ kind: 'paper', a, type: D.studyType(a).label });
      for (const t of c.trials.list.slice(0, 5)) refs.push({ kind: 'trial', t, type: 'Registered trial' });
      refs.forEach((r, i) => { r.n = i + 1; });
      if (!refs.length) { el.innerHTML = '<p class="muted small">Nothing new to weigh.</p>'; return; }
      const ctx = newCtx(refs);
      el.innerHTML = busyHtml('Weighing what is new…');
      try {
        const text = await D.ai(`Question being followed: ${c.w.q}\n\nThese sources are NEW since ${c.since}. What actually matters for a dermatologist? `
          + 'Rank the 3-6 most clinically or research-relevant developments (practice-changing results, safety signals, guideline changes, important new trials), each with citations, '
          + 'and say briefly what is NOT worth attention. Markdown bullets, every claim cited like [2].', { doc: packText(refs), system: CITE_SYSTEM, max: 2500, onPartial: D.live(el, { wrap: (h) => citeHtml(h, ctx) }) });
        el.innerHTML = `<div class="synth">${citeHtml(md(text), ctx)}</div>`;
      } catch (e) { el.innerHTML = aiErr(e); }
    };
  }

  // ================================================================ AI modes (#desk?mode=)
  const MODES = {
    research: { emoji: '🔬', label: 'Research AI', hint: 'Find RCTs of JAK inhibitors in vitiligo', search: true,
      task: 'Find and list the studies that answer the request, grouped by design (RCTs, reviews, observational). For each: what it studied, N, main result, with its citation. End with what is missing.' },
    clinical: { emoji: '🩺', label: 'Clinical Evidence AI', hint: 'Current treatment options for severe atopic dermatitis', search: true,
      task: 'Answer as a clinical evidence summary for a practising dermatologist: first-line, second-line and advanced options, what the guidelines recommend, efficacy numbers, safety and monitoring, special populations. Cite every claim and give an evidence strength for each recommendation.' },
    literature: { emoji: '📚', label: 'Literature AI', hint: 'Summarize the last five years of biologics in psoriasis', search: true, recent: true,
      task: 'Write a structured literature review of the sources: themes, key findings with numbers, how the field has moved, disagreements and gaps. Cite every claim.' },
    design: { emoji: '🧪', label: 'Research Design AI', hint: 'Design a study comparing treatment A vs B in melasma',
      task: 'Help design the study: research question (PICO), the best feasible design and why, population and inclusion/exclusion criteria, randomization/blinding, primary and secondary outcomes with validated scales, sample size reasoning with assumptions, statistical plan, ethics, and pitfalls. Use dermatology-standard outcome measures.' },
    stats: { emoji: '📊', label: 'Statistics AI', hint: 'Which test for comparing PASI change between 3 groups?',
      task: 'Act as a biostatistician: choose the right analysis, explain why, its assumptions and how to check them, alternatives if assumptions fail, how to report it (effect size, CI), and sample R or SPSS steps if useful.' },
    manuscript: { emoji: '✍️', label: 'Manuscript AI', hint: 'Paste results and ask: turn these into a Results section',
      task: 'Write publication-quality text in the style of top dermatology journals (JAAD, BJD). Keep every number exactly as given, do not invent data, follow CONSORT/STROBE/PRISMA reporting where relevant, and mark anything that needs the author\'s input in [square brackets].' },
    reviewer: { emoji: '🔎', label: 'Reviewer AI', hint: 'Paste your manuscript or abstract to find weaknesses',
      task: 'Review as a demanding peer reviewer for a top dermatology journal: major issues, minor issues, methods and statistics problems, missing analyses, overstated conclusions, reporting-guideline gaps, and concrete fixes. Be specific and constructive.' },
    club: { emoji: '🧠', label: 'Journal Club AI', hint: 'Pick a saved paper, or paste a DOI / PMID',
      task: 'Journal club analysis: PICO → study design and methodology → risk of bias (by domain) → statistics (appropriate? effect sizes and CIs) → results → clinical relevance → limitations → 5 discussion questions for residents. Cite paragraphs where useful.' },
  };

  function renderDesk(_, p) {
    const mode = MODES[p.mode] ? p.mode : 'clinical';
    const m = MODES[mode];
    view.innerHTML = `${D.topbar('AI research desk')}
      <div class="scroll-x" style="margin:8px 0 12px">${Object.entries(MODES).map(([k, x]) => `<button class="chip ${k === mode ? 'on' : ''}" data-act="desk-mode" data-v="${k}">${x.emoji} ${esc(x.label.replace(' AI', ''))}</button>`).join('')}</div>
      <div class="panel"><b>${m.emoji} ${esc(m.label)}</b><p class="muted small">${esc(m.task.split('.')[0])}.</p>
        ${mode === 'club' ? clubPicker() : ''}
        <textarea id="desk-in" rows="${['manuscript', 'reviewer', 'stats', 'design'].includes(mode) ? 7 : 3}" placeholder="${esc(m.hint)}">${esc(p.q || '')}</textarea>
        <button class="btn primary full" data-act="desk-go" style="margin-top:8px">${icon('spark')}Ask</button></div>
      <div id="desk-out"></div>`;
    actions['desk-mode'] = (b) => go('desk?' + new URLSearchParams({ mode: b.dataset.v }), { replace: true });
    actions['desk-go'] = () => runDesk(mode, $('#desk-in').value.trim());
    if (p.q && p.run) runDesk(mode, p.q);
  }
  function clubPicker() {
    const list = [...D.saved.values()].filter((a) => !a.doc).slice(0, 30);
    return list.length ? `<label class="field">Saved paper</label><select id="desk-paper"><option value="">— or paste a DOI / PMID / title below —</option>
      ${list.map((a) => `<option value="${esc(a.id)}">${esc(a.title.slice(0, 90))}</option>`).join('')}</select>` : '';
  }
  async function paperText(a) {
    // Full text when saved offline (PDF reflow or open-access full text), else the abstract.
    try {
      const model = await D.db.getReflow(a.id);
      if (model && model.blocks?.length) return { docModel: model, label: 'full text' };
    } catch { /* not saved */ }
    return { doc: `${a.title}\n${a.authors}\n${a.journal} ${a.year}\n\n${D.stripTags(a.abstract || '')}`, label: 'abstract only' };
  }
  async function resolvePaper(input) {
    const pick = $('#desk-paper')?.value;
    if (pick) return D.findArticle(pick);
    const doi = input.match(/10\.\d{4,9}\/\S+/)?.[0];
    const pmid = input.match(/^\d{6,9}$/)?.[0];
    const spec = doi ? `DOI:"${doi}"` : pmid ? `EXT_ID:${pmid} AND SRC:MED` : `TITLE:"${input.replace(/"/g, '')}"`;
    const r = await D.epmcSearch(spec, { size: 1 });
    if (!r.results.length) throw new Error('Paper not found. Paste its DOI or PMID.');
    return r.results[0];
  }
  async function runDesk(mode, input) {
    const m = MODES[mode];
    const out = $('#desk-out');
    if (needKey()) { out.innerHTML = keyCard(); return; }
    if (!input && !(mode === 'club' && $('#desk-paper')?.value)) { toast('Type your request first'); return; }
    try {
      if (m.search) {
        out.innerHTML = busyHtml('Searching the literature…');
        const map = await gather(input);
        let refs = refsFrom(map);
        if (m.recent) refs = refs.filter((r) => r.kind === 'trial' || +r.a.year >= D.THIS_YEAR - 5).map((r, i) => ({ ...r, n: i + 1 }));
        // The strongest 24: enough for a cited answer, small enough to start writing in seconds and
        // fit the free AI limits (49 sources made it wait, or never start).
        const found = refs.length;
        refs = bestRefs(refs).map((r, i) => ({ ...r, n: i + 1 }));
        const ctx = newCtx(refs);
        out.innerHTML = busyHtml(`Reading ${refs.length} sources…`);
        const text = await D.ai(`Request: ${input}\n\n${m.task}`, { doc: packText(refs), system: CITE_SYSTEM + ' Write Markdown with "## " headings and "- " bullets. If you use a table, put the source numbers like [3] in every row.', max: 3500, fast: true,
          onPartial: (t) => { if (out.isConnected) out.innerHTML = `<div class="panel synth">${citeHtml(md(t), ctx)}<span class="typing">▍</span></div>`; } });
        out.innerHTML = `<div class="panel synth">${citeHtml(md(text), ctx)}${sourcesList(text, refs)}${found > refs.length ? `<p class="muted small">Based on the ${refs.length} strongest of ${found} sources.</p>` : ''}<button class="btn xs" data-act="refs-all" data-ctx="${ctx}">${icon('list')}All ${refs.length} sources read</button></div>`;
        return;
      }
      if (mode === 'club') {
        out.innerHTML = busyHtml('Reading the paper…');
        const a = await resolvePaper(input);
        const src = await paperText(a);
        const text = await D.ai(`${m.task}${input && !$('#desk-paper')?.value ? '' : input ? '\n\nAlso: ' + input : ''}`, { ...src, max: 6000, onPartial: (t) => { if (out.isConnected) out.innerHTML = `<div class="panel synth">${md(t)}<span class="typing">▍</span></div>`; } });
        out.innerHTML = `<div class="panel synth"><div class="label">${icon('school')}${esc(a.title)} <span class="muted small">(${src.label})</span></div>${md(text)}
          <button class="btn xs" data-act="open" data-id="${esc(a.id)}">${icon('file')}Open paper</button></div>`;
        return;
      }
      out.innerHTML = busyHtml('Thinking…');
      const text = await D.ai(`${m.task}\n\nUser's material / request:\n\n${input}`, {
        system: 'You are an expert dermatology researcher, biostatistician and medical writer. Be precise and practical. Never invent data or references. Markdown with "## " headings and "- " bullets.',
        max: 6000, onPartial: (t) => { if (out.isConnected) out.innerHTML = `<div class="panel synth">${md(t)}<span class="typing">▍</span></div>`; },
      });
      out.innerHTML = `<div class="panel synth">${md(text)}<button class="btn xs" data-act="desk-copy">${icon('quote')}Copy</button></div>`;
      actions['desk-copy'] = () => D.copyText(text);
    } catch (e) { out.innerHTML = aiErr(e); }
  }

  // ================================================================ Clinical Trial Radar (#trials)
  const DISEASES = ['Psoriasis', 'Atopic dermatitis', 'Vitiligo', 'Hidradenitis suppurativa', 'Alopecia areata', 'Androgenetic alopecia', 'Acne', 'Rosacea', 'Melanoma',
    'Basal cell carcinoma', 'Squamous cell carcinoma skin', 'Chronic urticaria', 'Pemphigus', 'Bullous pemphigoid', 'Prurigo nodularis', 'Melasma', 'Lichen planus', 'Cutaneous lupus', 'Scleroderma', 'Epidermolysis bullosa'];
  const PHASES = { '': 'Any phase', PHASE1: 'Phase 1', PHASE2: 'Phase 2', PHASE3: 'Phase 3', PHASE4: 'Phase 4' };
  const STATUSES = { '': 'Any status', RECRUITING: 'Recruiting', 'ACTIVE_NOT_RECRUITING': 'Active', 'NOT_YET_RECRUITING': 'Not yet recruiting', COMPLETED: 'Completed', TERMINATED: 'Terminated' };
  const ITYPES = { '': 'Any intervention', DRUG: 'Drug', BIOLOGICAL: 'Biologic', DEVICE: 'Device', PROCEDURE: 'Procedure', GENETIC: 'Gene/cell therapy', BEHAVIORAL: 'Behavioural' };
  const EXTRA_TERMS = { jak: 'JAK inhibitor', biologic: 'monoclonal antibody', topical: 'topical', cell: 'cell therapy' };

  async function renderTrials(_, p) {
    const f = { q: p.q || 'Psoriasis', phase: p.phase || '', status: p.status ?? 'RECRUITING', itype: p.itype || '', extra: p.extra || '' };
    const nav = (patch) => go('trials?' + new URLSearchParams({ ...f, ...patch }), { replace: true });
    view.innerHTML = `${D.topbar('Trial radar')}
      <p class="muted small">Dermatology trials from ClinicalTrials.gov, newest updates first. WHO ICTRP adds other registries.</p>
      <div class="scroll-x">${DISEASES.map((d) => `<button class="chip ${d === f.q ? 'on' : ''}" data-act="tr-q" data-v="${esc(d)}">${esc(d)}</button>`).join('')}</div>
      <div class="scroll-x" style="margin-top:8px">
        <button class="chip ${f.phase ? 'on' : ''}" data-act="tr-phase">${icon('filter')}${esc(PHASES[f.phase])}</button>
        <button class="chip ${f.status ? 'on' : ''}" data-act="tr-status">${icon('clock')}${esc(STATUSES[f.status] || 'Any status')}</button>
        <button class="chip ${f.itype ? 'on' : ''}" data-act="tr-itype">${icon('spark')}${esc(ITYPES[f.itype])}</button>
        <button class="chip ${f.extra ? 'on' : ''}" data-act="tr-extra">${icon('bulb')}${esc(f.extra ? EXTRA_TERMS[f.extra] : 'Drug class')}</button>
        <button class="chip" data-act="ev-ictrp" data-q="${esc(f.q)}">${icon('globe')}WHO ICTRP</button></div>
      <div id="tr-list">${D.skeletons(4)}</div>`;
    actions['tr-q'] = (b) => nav({ q: b.dataset.v });
    actions['tr-phase'] = () => D.pickOne('Phase', PHASES, f.phase, (v) => nav({ phase: v }));
    actions['tr-status'] = () => D.pickOne('Status', STATUSES, f.status, (v) => nav({ status: v }));
    actions['tr-itype'] = () => D.pickOne('Intervention', ITYPES, f.itype, (v) => nav({ itype: v }));
    actions['tr-extra'] = () => D.pickOne('Drug class', { '': 'Any', ...EXTRA_TERMS }, f.extra, (v) => nav({ extra: v }));
    const r = await trials([f.q, EXTRA_TERMS[f.extra] || ''].join(' ').trim(), { status: f.status, phase: f.phase, itype: f.itype, size: 25 });
    if (D.current.name !== 'trials') return;
    $('#tr-list').innerHTML = r.error ? D.errorBox(new Error('ClinicalTrials.gov: ' + r.error))
      : `<p class="muted small">${r.total || r.list.length} trials</p>${r.list.map(trialCard).join('') || '<div class="empty"><b>No trials match</b></div>'}`;
  }

  // ================================================================ Guidelines (#guides)
  const SOCIETIES = [
    ['American Academy of Dermatology (AAD)', 'https://www.aad.org/member/clinical-quality/guidelines'],
    ['British Association of Dermatologists (BAD)', 'https://www.bad.org.uk/guidelines-and-standards/clinical-guidelines/'],
    ['European Dermatology Forum / EuroGuiDerm (EADV)', 'https://www.guidelines.edf.one/'],
    ['EADV', 'https://eadv.org/'],
    ['Indian Association of Dermatologists (IADVL)', 'https://iadvl.org/'],
    ['NICE: skin conditions', 'https://www.nice.org.uk/guidance/conditions-and-diseases/skin-conditions'],
    ['Cochrane Skin', 'https://skin.cochrane.org/'],
    ['National Psoriasis Foundation', 'https://www.psoriasis.org/'],
    ['British Society for Medical Dermatology', 'https://www.bsmd.org.uk/'],
    ['DermNet (education & images)', 'https://dermnetnz.org/'],
  ];
  async function renderGuides(_, p) {
    const topic = p.q || '';
    view.innerHTML = `${D.topbar('Guidelines')}
      <form class="searchbox compact" data-form="guides"><textarea name="q" rows="1" placeholder="Topic, e.g. hidradenitis suppurativa">${esc(topic)}</textarea>
        <button class="go" type="submit">${icon('up')}</button></form>
      <div id="g-list">${topic ? D.skeletons(3) : ''}</div>
      <div class="section"><div class="section-h"><h3>Society guidelines</h3></div>
        <div class="list-card">${SOCIETIES.map(([n, u]) => `<button class="example" data-act="g-open" data-u="${esc(u)}">${icon('external')}<span>${esc(n)}</span></button>`).join('')}</div>
        <p class="muted small">Societies don't offer a way for apps to read their guideline pages, so they open in the in-app browser. Published guidelines are also found above, from journals.</p></div>`;
    actions['g-open'] = (b) => openUrl(b.dataset.u);
    if (!topic) return;
    const r = await epmc(q(topic, { extra: GUIDE, sort: 'P_PDATE_D desc' }), 20);
    if (D.current.name !== 'guides') return;
    $('#g-list').innerHTML = `<div class="section-h"><h3>Published guidelines & consensus (${r.hit})</h3></div>${r.results.map((a) => D.card(a)).join('') || '<div class="muted small">None found.</div>'}`;
  }
  document.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-form=guides]');
    if (!form) return;
    e.preventDefault();
    go('guides?' + new URLSearchParams({ q: form.q.value.trim() }), { replace: true });
  });

  // ================================================================ Today in Dermatology (#today)
  const TODAY = obj({ picks: { type: 'array', items: obj({ category: S.str, cite: { type: 'integer' }, why: S.str, summary: S.str }) } });
  const CATS = ['🔥 Most important', '🧪 Most interesting', '⚠️ Most controversial', '💊 Most clinically relevant', '🤯 Most surprising'];

  async function renderToday() {
    view.innerHTML = `${D.topbar('Today in Dermatology')}<p class="muted small">New papers from leading dermatology journals in the last two weeks.</p><div id="td">${D.skeletons(4)}</div>`;
    const top = (window.JOURNALS || []).filter((j) => j.top || /Leading|Research/.test(j.group)).slice(0, 16);
    const jq = '(' + top.map(D.journalQuery).join(' OR ') + ')';
    const r = await epmc({ query: `${jq} AND FIRST_PDATE:[${daysAgo(14)} TO ${today()}] AND HAS_ABSTRACT:y ${D.NOISE}`, sort: 'P_PDATE_D desc' }, 40);
    if (D.current.name !== 'today') return;
    const papers = r.results;
    const refs = papers.map((a, i) => ({ kind: 'paper', a, type: D.studyType(a).label, n: i + 1 }));
    const ctx = newCtx(refs);
    const el = $('#td');
    const list = `<div class="section"><div class="section-h"><h3>All new papers (${papers.length})</h3></div>${papers.map((a) => D.card(a, { compact: true })).join('')}</div>`;
    if (needKey() || !papers.length) { el.innerHTML = (papers.length ? keyCard() : '') + list; return; }
    const ck = 'today.' + today();
    let picks = cacheGet(ck);
    el.innerHTML = busyHtml('Choosing the 5 papers worth knowing…') + list;
    if (!picks) {
      try {
        picks = (await aiJsonCall(`From these new dermatology papers choose exactly five, one per category: ${CATS.join(', ')}. `
          + 'For each: category (exactly as given), cite (its number), why (one sentence), summary (a 30-second summary: what they did, what they found with key numbers, why it matters).', refs, TODAY, 3000)).picks;
        cacheSet(ck, picks);
      } catch (e) { el.innerHTML = aiErr(e) + list; return; }
    }
    if (D.current.name !== 'today') return;
    el.innerHTML = picks.map((x, i) => {
      const r0 = refs.find((r) => r.n === x.cite);
      if (!r0) return '';
      return `<div class="panel today"><div class="label">${esc(x.category)}</div><b>${esc(r0.a.title)}</b>
        <div class="muted small">${esc(r0.a.jAbbr || r0.a.journal)} · ${esc(r0.type)}</div><p>${esc(x.summary)}</p><p class="small muted">${esc(x.why)}</p>
        <div class="row wrap"><button class="btn xs" data-act="td-more" data-i="${i}" data-l="2">⏱ 2-minute</button>
        <button class="btn xs" data-act="td-more" data-i="${i}" data-l="deep">🎓 Deep dive</button>
        <button class="btn xs" data-act="open" data-id="${esc(r0.a.id)}">${icon('file')}Paper</button></div><div id="td-x-${i}"></div></div>`;
    }).join('') + list;
    actions['td-more'] = async (b) => {
      const x = picks[+b.dataset.i];
      const r0 = refs.find((r) => r.n === x.cite);
      const out = $('#td-x-' + b.dataset.i);
      out.innerHTML = busyHtml('Writing…');
      try {
        const src = await paperText(r0.a);
        const ask = b.dataset.l === 'deep'
          ? 'Professor-level deep dive for dermatologists: background, methods critique, results with numbers, risk of bias, how it fits the existing evidence, clinical implications, and open questions.'
          : 'A 2-minute summary (about 300 words): question, design, main results with numbers, limitations, and what it means in practice.';
        if (b.dataset.l === 'deep') out.innerHTML = busyHtml('Writing the deep dive… this can take a minute');
        const text = await D.ai(ask + (src.label === 'abstract only' ? ' (Only the abstract is available; say so where it limits the analysis.)' : ''),
          { ...src, max: b.dataset.l === 'deep' ? 7000 : 3500, onPartial: (t) => { if (out.isConnected) out.innerHTML = `<div class="synth">${md(t)}<span class="typing">▍</span></div>`; } });
        out.innerHTML = `<div class="synth">${md(text)}</div><button class="btn xs" data-act="td-listen" data-i="${b.dataset.i}">${icon('audio')}Listen</button>`;
        actions['td-listen'] = () => D.ttsPlayScript?.('Today', text.replace(/[#*_]/g, '').split(/\n+/).filter((t) => t.trim().length > 1).map((t) => ({ t: t.trim() })), { title: r0.a.title.slice(0, 60) });
      } catch (e) { out.innerHTML = aiErr(e); }
    };
  }

  // ================================================================ Full-text finder + MyLOFT (paper page)
  ext.articleExtra = (a) => `<div class="panel where" id="where"><div class="label">${icon('unlock')}Where to read the full text</div><div id="where-list" class="muted small">Checking…</div></div>`;
  ext.articleTools = (a) => `<div class="row wrap intel-paper"><button class="btn xs" data-act="paper-club" data-id="${esc(a.id)}">${icon('school')}Journal club</button>
    <button class="btn xs" data-act="paper-ev" data-q="${esc(D.topicOf(a))}">${icon('chart')}Evidence map for this topic</button></div>`;
  actions['paper-club'] = (b) => go('desk?' + new URLSearchParams({ mode: 'club', q: b.dataset.id }));
  actions['paper-ev'] = (b) => go(evHash(b.dataset.q));

  ext.afterArticle = async (a) => {
    const el = $('#where-list');
    if (!el) return;
    const rows = [];
    const add = (name, sub, act, extra = '') => rows.push(`<button class="opt" data-act="${act}" data-id="${esc(a.id)}" ${extra}>${icon('unlock')}<span>${esc(name)}<small>${esc(sub)}</small></span></button>`);
    // Shown at once, in this order: on the phone, Research4Life, MyLOFT, free copies, then the publisher.
    if (D.pdfKeys.has(a.id)) add('On this phone', 'PDF saved in your library', 'open-pdf');
    if (a.doi) {
      add('Research4Life', D.account('r4l').saved ? 'Get PDF with your Research4Life login' : 'Add your Research4Life login, then Get PDF', 'get-pdf');
      add('MyLOFT (your institution)', Native.hasMyLoftApp?.() ? 'Open in the MyLOFT app, share the PDF back' : 'Choose your MyLOFT app once, then share the PDF back', 'myloft');
    }
    const oaLink = (a.links || []).find((l) => /OA|F/.test(l.code || '') && /pdf/i.test(l.style || ''));
    if (a.pmcid) add('PubMed Central', 'Free full text · read in the app', 'reader');
    else if (a.oa || oaLink) add('Open access', 'Free copy · Get PDF saves it', 'get-pdf');
    const publisher = () => { if (a.doi) add('Publisher website', 'via doi.org', 'where-url', `data-u="https://doi.org/${esc(a.doi)}"`); };
    const show = (note = '') => { if (el.isConnected) el.innerHTML = (rows.join('') || 'No full-text source found.') + note; };
    if (!a.doi || a.pmcid || a.oa) { publisher(); show(); return; }
    show('<div class="muted small" id="where-more">Checking for free copies…</div>');
    // Free-copy lookup (Unpaywall): never longer than 6 seconds.
    const up = await Promise.race([
      D.getJSON(api('unpaywall', encodeURIComponent(a.doi) + '?email=unpaywall@dermscholar.app')).catch(() => null),
      new Promise((r) => setTimeout(() => r(null), 6000)),
    ]);
    const best = up?.best_oa_location;
    if (best) add(best.host_type === 'repository' ? (best.version === 'publishedVersion' ? 'Repository copy' : 'Author manuscript') : 'Free at the publisher',
      `${best.host_type === 'repository' ? (best.repository_institution || 'Repository') : (up.publisher || 'Publisher')} · ${best.version === 'publishedVersion' ? 'published version' : best.version === 'acceptedVersion' ? 'accepted manuscript' : 'preprint'}`,
      'where-url', `data-u="${esc(best.url_for_pdf || best.url)}"`);
    publisher();
    show();
  };
  actions['where-url'] = (b) => openUrl(b.dataset.u);

  actions.myloft = async (b) => {
    const a = b.dataset.id ? await D.findArticle(b.dataset.id).catch(() => null) : null;
    if (a) {
      // Save the paper now, so the PDF that comes back lands on a paper that's in the Library.
      if (!D.saved.has(a.id)) await D.saveArticle(a).catch(() => {});
      Native.setPendingPdf?.(a.id, a.title);
      store.set('myloftWaiting', { id: a.id, title: a.title, t: Date.now() });
      mlqAdd(a);
      // After the first time, one tap: straight to MyLOFT, no sheet.
      if (!b.sheet && Native.hasMyLoftApp?.() && Native.sendToMyLoft && store.get('myloftUsed', false)) { sendToMyLoft(a); return; }
      D.copyText(a.doi ? `${a.title} doi:${a.doi}` : a.title);
    }
    const has = Native.hasMyLoftApp?.();
    sheet(`<h3>Get it through MyLOFT</h3>${b.notInR4L ? '<p class="small"><b>This journal isn\'t in your Research4Life access.</b></p>' : ''}
      <p class="small">MyLOFT gives you your institution's subscriptions. Its website only works inside its own app, so DermScholar hands the paper over:</p>
      <ol class="steps"><li>${a ? 'Tap <b>Send to MyLOFT</b>: the paper is saved in MyLOFT (title and DOI are also copied).' : 'Find your paper in MyLOFT.'} Open it there.</li>
      <li>In MyLOFT, tap <b>Share</b> (or <b>Open with</b>) → <b>DermScholar</b>. No Share button? Tap <b>Download</b> in MyLOFT, come back here and tap <b>I downloaded it</b>.</li>
      <li>The PDF is saved ${a ? 'to this paper' : 'to your library'} and opens in the reader, ready for AI and listening.</li></ol>
      ${has || !Native.listApps ? `<button class="btn primary full" data-act="myloft-go">${icon('external')}${has ? (a ? 'Send to MyLOFT' : 'Open the MyLOFT app') : 'Get the MyLOFT app'}</button>` : ''}
      ${Native.listApps ? `<button class="btn ${has ? '' : 'primary '}full" style="margin-top:8px" data-act="myloft-pick">${icon('list')}${has ? 'Not the right app? Choose MyLOFT' : 'Choose MyLOFT from your apps'}</button>` : ''}
      ${!has && Native.listApps ? '<button class="btn full" style="margin-top:8px" data-act="myloft-go">Get MyLOFT from the Play Store</button>' : ''}
      ${a && /^10\.1016\//.test(a.doi || '') && has ? `<button class="btn full" style="margin-top:8px" data-act="myloft-publisher">${icon('external')}Send the publisher link instead</button>` : ''}
      ${a ? `<button class="btn full" style="margin-top:8px" data-act="myloft-file">${icon('file')}I downloaded it: pick the PDF</button>` : ''}
      ${a ? `<button class="btn full" style="margin-top:8px" data-act="mlq-later">${icon('clock')}Later: keep it in the MyLOFT queue</button>` : ''}
      ${b.r4lAnyway && a ? `<button class="btn full" style="margin-top:8px" data-act="myloft-r4l">Try Research4Life anyway</button>` : ''}`);
    // The paper stays marked as waiting for its PDF, so the picked file is saved to it.
    actions['myloft-file'] = () => { closeSheet(true); if (a) Native.setPendingPdf?.(a.id, a.title); Native.importPdf?.(); };
    // Sending the paper's link into MyLOFT (like Share → MyLOFT) saves it there with your institution's access.
    // Elsevier papers (JAAD, BJD's Elsevier titles…) go via ClinicalKey, which gives a PDF link.
    actions['myloft-go'] = async () => {
      closeSheet(true);
      if (!a || !Native.sendToMyLoft) { Native.openMyLoftApp?.(); return; }
      sendToMyLoft(a);
    };
    actions['mlq-later'] = () => { closeSheet(true); toast('In your MyLOFT queue (Library)'); };
    actions['myloft-publisher'] = () => { closeSheet(true); Native.sendToMyLoft?.(a.doi ? `https://doi.org/${a.doi}` : a.title, a.title); };
    actions['myloft-r4l'] = () => { closeSheet(true); if (a) D.getPdf(a, { skipAsk: true }); };
  };

  // ---------------------------------------------------------------- MyLOFT queue + automatic filing
  const mlq = () => store.get('mlQueue', []).filter((x) => !D.pdfKeys.has(x.id));
  function mlqAdd(a) {
    const list = mlq().filter((x) => x.id !== a.id);
    store.set('mlQueue', [{ id: a.id, title: a.title, doi: a.doi || '', t: Date.now() }, ...list].slice(0, 60));
  }
  const mlqDrop = (id) => store.set('mlQueue', mlq().filter((x) => x.id !== id));
  async function sendToMyLoft(a) {
    Native.setPendingPdf?.(a.id, a.title);
    store.set('myloftWaiting', { id: a.id, title: a.title, t: Date.now() });
    store.set('myloftUsed', true);
    mlqAdd(a);
    D.copyText(a.doi ? `${a.title} doi:${a.doi}` : a.title);
    const ck = await clinicalKeyUrl(a).catch(() => null);
    Native.sendToMyLoft(ck || (a.doi ? `https://doi.org/${a.doi}` : a.title), a.title);
    // The iPhone app copies the link and opens MyLOFT: say what to do there.
    toast(Native.myloftHint || 'Sent to MyLOFT. Download it there, then Share → DermScholar: it files itself.');
  }

  /** DOIs and text from the first pages of a stored PDF. */
  async function pdfIds(key) {
    const R = await import('./reflow.js');
    const doc = await R.openPdf('/pdf/' + encodeURIComponent(key));
    let text = '';
    for (let n = 1; n <= Math.min(2, doc.numPages); n++) {
      const tc = await (await doc.getPage(n)).getTextContent();
      text += tc.items.map((i) => i.str).join(' ') + '\n';
    }
    try { doc.destroy(); } catch { /* ignore */ }
    const dois = [...new Set([...text.matchAll(/10\.\d{4,9}\/[^\s"<>]+/g)].map((m) => m[0].replace(/[.,;)\]]+$/, '').toLowerCase()))];
    return { text: text.toLowerCase(), dois };
  }
  const tWords = (t) => [...new Set(String(t || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 3))];
  // Some publishers' PDFs (Oxford, Silverchair) place each letter separately, so their text comes
  // out as "e f f i c a c y": words are also looked for with the spaces taken out.
  const titleIn = (title, text) => {
    const w = tWords(title);
    if (w.length < 3) return 0;
    const flat = text.replace(/[^\p{L}\p{N}]+/gu, ' ');
    const tight = text.replace(/[^\p{L}\p{N}]+/gu, '');
    return w.filter((x) => flat.includes(x) || tight.includes(x.replace(/[^\p{L}\p{N}]+/gu, ''))).length / w.length;
  };

  /**
   * Whether a downloaded PDF is this paper: its DOI or most of its title appear in the first pages.
   * Scanned PDFs without text pass (they can't be checked).
   */
  ext.checkPdf = async (key, paper) => {
    try {
      const { text, dois } = await pdfIds(key);
      if (text.replace(/\s+/g, '').length < 60) return true;
      if (paper.doi && dois.includes(paper.doi.toLowerCase())) return true;
      const squash = (x) => String(x).toLowerCase().replace(/[^a-z0-9]+/g, '');
      if (paper.doi && squash(text).includes(squash(paper.doi))) return true;
      return titleIn(paper.title, text) >= 0.6;
    } catch { return true; }
  };

  ext.identifyPdf = async (evt) => {
    const { text, dois } = await pdfIds(evt.key);
    const waiting = D.waitingPaper();
    const queue = mlq();
    const lacking = [...D.saved.values()].filter((x) => x.doi && !x.imported && !x.doc && !D.pdfKeys.has(x.id));
    const pool = [...new Map([...(waiting ? [D.saved.get(waiting.id) || waiting] : []), ...queue, ...lacking].filter(Boolean).map((x) => [x.id, x])).values()];
    const score = (c) => {
      const byDoi = c.doi && dois.includes(c.doi.toLowerCase());
      const t = titleIn(c.title, text);
      return byDoi ? 2 + t : t >= 0.85 ? t : 0;
    };
    let best = null, bestS = 0;
    for (const c of pool) { const sc = score(c); if (sc > bestS) { best = c; bestS = sc; } }
    let target = best?.id;
    // Nothing waiting matches: look the PDF's DOI up and add the paper to the library.
    if (!target && !evt.attached && dois.length) {
      for (const d of dois.slice(0, 4)) {
        const res = await D.epmcSearch(`DOI:"${d}"`, { size: 1 }).catch(() => null);
        const a = res?.results?.[0];
        if (a && titleIn(a.title, text) >= 0.7) {
          if (!D.saved.has(a.id)) await D.saveArticle(a);
          target = a.id;
          break;
        }
      }
    }
    const final = target && target !== evt.key && !D.pdfKeys.has(target) && (!evt.attached || bestS >= 2)
      && Native.renamePdf?.(evt.key, target, D.saved.get(target)?.title || evt.title) ? target : evt.key;
    mlqDrop(final);
    if (waiting?.id === final) store.set('myloftWaiting', null);
    return final;
  };

  async function renderMlq() {
    const list = mlq();
    view.innerHTML = `${D.topbar('MyLOFT queue')}
      <p class="small">Papers to fetch through MyLOFT. Send them (each opens in MyLOFT), download the PDFs there, then share each one to DermScholar in any order: each PDF finds its own paper by its DOI and title.</p>
      <div class="row wrap"><button class="btn small" data-act="myloft-file-any">${icon('file')}Pick downloaded PDF</button><button class="btn small" data-act="myloft-open">${icon('external')}Open MyLOFT</button><button class="btn small" data-act="myloft-pick">${icon('list')}Choose app</button></div>
      <div class="section">${list.map((x) => `<div class="mlq-row"><div><b>${esc(x.title)}</b><small>${x.doi ? 'doi:' + esc(x.doi) : ''}</small></div>
        <button class="btn xs primary" data-act="mlq-send" data-id="${esc(x.id)}">${icon('external')}Send</button>
        <button class="icon-btn" data-act="mlq-del" data-id="${esc(x.id)}" aria-label="Remove">${icon('x')}</button></div>`).join('') || `<div class="empty">${icon('check')}<b>Queue empty</b><div>Papers whose journal isn't in Research4Life land here.</div></div>`}</div>`;
  }
  actions['mlq-send'] = async (b) => { const a = await D.findArticle(b.dataset.id).catch(() => null); if (a) sendToMyLoft(a); };
  actions['mlq-del'] = (b) => { mlqDrop(b.dataset.id); render(); };
  actions['mlq-open'] = () => go('mlq');
  actions['myloft-file-any'] = () => Native.importPdf?.();
  const prevLibTop = ext.libraryTop;
  ext.libraryTop = (p) => {
    const n = mlq().length;
    return (n ? `<button class="mlq-banner" data-act="mlq-open">${icon('clock')}<span><b>MyLOFT queue · ${n}</b><small>Papers waiting for their PDF</small></span>${icon('next')}</button>` : '') + (prevLibTop ? prevLibTop(p) : '');
  };

  // Pick the installed MyLOFT app once (its name differs between phones); remembered from then on.
  actions['myloft-pick'] = () => {
    let apps = [];
    try { apps = JSON.parse(Native.listApps() || '[]'); } catch { apps = []; }
    apps.sort((x, y) => (/loft/i.test(y.label) - /loft/i.test(x.label)) || x.label.localeCompare(y.label));
    const rows = (f) => apps.filter((x) => !f || (x.label + ' ' + x.pkg).toLowerCase().includes(f.toLowerCase()))
      .map((x) => `<button class="opt" data-act="myloft-set" data-pkg="${esc(x.pkg)}">${icon('external')}<span>${esc(x.label)}<small>${esc(x.pkg)}</small></span></button>`).join('') || '<p class="muted small">No app matches.</p>';
    sheet(`<h3>Which app is MyLOFT?</h3><input type="search" id="app-filter" placeholder="Type to filter, e.g. loft"><div id="app-list">${rows('')}</div>`);
    $('#app-filter')?.addEventListener('input', (e) => { $('#app-list').innerHTML = rows(e.target.value); });
    actions['myloft-set'] = (b) => { Native.setMyLoftApp(b.dataset.pkg); closeSheet(true); toast('Saved. Opening it…'); Native.openMyLoftApp?.(); };
  };
  actions['myloft-open'] = () => Native.openMyLoftApp?.();

  /**
   * The ClinicalKey page for an Elsevier paper (DOI 10.1016/…): ClinicalKey addresses journal
   * articles by Elsevier's article ID (PII), which Crossref lists. Falls back to a title search.
   */
  async function clinicalKeyUrl(a) {
    if (!/^10\.1016\//.test(a.doi || '')) return null;
    const pii = await elsevierPii(a);
    return pii ? `https://www.clinicalkey.com/#!/content/journal/1-s2.0-${pii}`
      : `https://www.clinicalkey.com/#!/search/${encodeURIComponent(a.title)}`;
  }

  /** Elsevier's article ID (PII, "S0190…") for a 10.1016 DOI, from Crossref; '' if unknown. */
  async function elsevierPii(a) {
    if (!/^10\.1016\//.test(a.doi || '')) return '';
    // Europe PMC's record often has Elsevier's own link with the ID (…/pii/S0190962224001234).
    let pii = ((a.links || []).map((l) => (l.url || '').match(/pii\/(S?[0-9X]{15,17})/i)).find(Boolean) || [])[1] || '';
    if (!pii) try {
      const m = (await D.getJSON(api('crossref', 'works/' + encodeURIComponent(a.doi)))).message || {};
      pii = (m['alternative-id'] || []).find((x) => /^S?\d{4}/i.test(x)) || '';
      if (!pii) pii = ((m.link || []).map((l) => (l.URL || '').match(/PII:([^?&/]+)/)).find(Boolean) || [])[1] || '';
    } catch { /* offline or not in Crossref */ }
    pii = pii.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    if (pii && !pii.startsWith('S')) pii = 'S' + pii;
    return pii;
  }
  // Get PDF sends Elsevier papers through ClinicalKey in Research4Life (app.js getPdf).
  ext.elsevierPii = elsevierPii;

  // ================================================================ Intel hub (#intel) and home
  const TILES = [
    ['today', '🔥', 'Today', 'New evidence worth knowing'],
    ['ev', '🧬', 'Evidence map', 'Guidelines → reviews → RCTs → trials'],
    ['updates', '🔔', 'What changed?', 'New since you last looked'],
    ['desk', '🧠', 'AI research desk', 'Research · clinical · stats · manuscript · reviewer · journal club'],
    ['trials', '🧪', 'Trial radar', 'ClinicalTrials.gov · WHO ICTRP'],
    ['guides', '📋', 'Guidelines', 'AAD · BAD · EADV · NICE · Cochrane'],
    ['library', '📚', 'Library', 'Saved papers · PDFs · MyLOFT'],
    ['images', '🖼️', 'Images', 'DermNet clinical images'],
  ];
  function tilesHtml() {
    const n = watches().length;
    return `<div class="intel-tiles">${TILES.map(([k, e, t, s]) => `<button class="intel-tile" data-act="intel-go" data-k="${k}"><span class="e">${e}</span><b>${esc(t)}</b><span>${esc(k === 'updates' && n ? `${n} question${n > 1 ? 's' : ''} watched` : s)}</span></button>`).join('')}</div>`;
  }
  actions['intel-go'] = (b) => {
    const k = b.dataset.k;
    if (k === 'ev') { askSheet(); return; }
    if (k === 'images' && !ext.routes.images) { sheet(`<h3>Images</h3><p class="small">Search DermNet's clinical images (opens in the app's browser).</p><input id="img-q" placeholder="e.g. lichen planus pigmentosus"><button class="btn primary full" data-act="img-go" style="margin-top:8px">Search images</button>`); actions['img-go'] = () => { const v = $('#img-q').value.trim(); if (v) { closeSheet(true); openUrl('https://dermnetnz.org/search?q=' + encodeURIComponent(v)); } }; return; }
    go(k);
  };
  function askSheet(prefill = '') {
    sheet(`<h3>🧬 Ask any dermatology question</h3><textarea id="ev-qin" rows="3" placeholder="What is the current evidence for biologics in severe hidradenitis suppurativa after adalimumab failure?">${esc(prefill)}</textarea>
      <button class="btn primary full" data-act="ev-ask" style="margin-top:8px">${icon('chart')}Build the evidence map</button>`);
    actions['ev-ask'] = () => { const v = $('#ev-qin').value.trim(); if (v) { closeSheet(true); go(evHash(v)); } };
  }

  function renderIntel() {
    view.innerHTML = `<div class="home-top"><div class="brand"><span><b>Derm Intelligence</b><small>Evidence, AI and research tools</small></span></div></div>
      <form class="searchbox" data-form="intel"><textarea name="q" rows="2" placeholder="Ask any dermatology question…">${''}</textarea><button class="go" type="submit">${icon('up')}</button></form>
      <p class="muted small" style="margin:6px 4px 14px">Best evidence, where it came from, how strong it is, what's controversial, what changed.</p>
      ${tilesHtml()}
      ${watches().length ? `<div class="section"><div class="section-h"><h3>Watched questions</h3><button data-act="intel-go" data-k="updates">What changed?</button></div>
        <div class="row wrap">${watches().map((w) => `<button class="chip" data-act="upd-open" data-q="${esc(w.q)}">${icon('star')}${esc(w.q.length > 40 ? w.q.slice(0, 38) + '…' : w.q)}</button>`).join('')}</div></div>` : ''}
      <p class="muted small" style="margin-top:20px">Sources: Europe PMC (all of PubMed/MEDLINE, PMC and Cochrane), ClinicalTrials.gov, OpenAlex, Unpaywall, plus your Research4Life, UpToDate and MyLOFT access.</p>`;
    actions['upd-open'] = (b) => go(evHash(b.dataset.q));
  }
  document.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-form=intel]');
    if (!form) return;
    e.preventDefault();
    const v = form.q.value.trim();
    if (v) go(evHash(v));
  });

  ext.homeIntel = () => `<div class="section"><div class="section-h"><h3>Derm intelligence</h3><button data-act="tab-intel">All</button></div>${tilesHtml()}</div>`;
  actions['tab-intel'] = () => go('intel');
  ext.searchTop = (question) => (question && !/["():]|\b(AND|OR|NOT)\b/.test(question)
    ? `<button class="ev-banner" data-act="ev-from-search" data-q="${esc(question)}">${icon('chart')}<span><b>Evidence map for this question</b><small>Guidelines → reviews → RCTs → trials, with a cited AI synthesis</small></span></button>` : '');
  actions['ev-from-search'] = (b) => go(evHash(b.dataset.q));

  Object.assign(ext.routes, {
    intel: renderIntel, ev: renderEvidence, updates: renderUpdates, desk: renderDesk,
    trials: renderTrials, guides: renderGuides, today: renderToday, mlq: renderMlq,
  });

  // Shared with intel2.js (research workspace, drugs, images).
  window.DSI = {
    api, q, epmc, trials, trialOf, trialTerm, gather, refsFrom, packText, bestRefs, basedOn, newCtx, contexts, citeHtml, citeBtns, strength, refRow, trialCard,
    keyCard, aiErr, busyHtml, aiJsonCall, cacheGet, cacheSet, obj, S, CITE_SYSTEM, paperText, openUrl, evHash, today, daysAgo, TILES, DISEASES,
    needKey, GUIDE, STANDARD, SAFETY, TREAT, isTreatmentQ, planSearch, evidencePool, stepsHtml, absShort, exportBtns, offerExport, STRENGTH,
  };
})();
