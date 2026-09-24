/* DermScholar — evidence search, journals and an offline library for dermatology. */
(() => {
  'use strict';

  // ---------------------------------------------------------------- basics
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const stripTags = (s) => String(s ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  const fmt = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n ?? 0));
  const THIS_YEAR = new Date().getFullYear();

  const hasNative = typeof window.Native !== 'undefined';
  const Native = hasNative ? window.Native : {
    listPdfs: () => '[]', hasPdf: () => false, storageBytes: () => 0,
    downloadPdf: () => toast('PDF download needs the Android app'),
    openPdf: () => {}, deletePdf: () => {}, sharePdf: () => {},
    openPortal: (url) => window.open(url, '_blank'),
    importPdf: () => toast('Import needs the Android app'),
    share: (t, text) => navigator.share ? navigator.share({ title: t, text }) : copyText(text),
    exportText: (name, content) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([content]));
      a.download = name; a.click();
    },
    copy: (t) => copyText(t), toast: (m) => toast(m), version: () => 'web',
    getPdf: () => toast('PDF download needs the Android app'),
    r4lAccount: () => JSON.stringify({ user: localStorage.getItem('ds.r4lUser') || '', saved: !!localStorage.getItem('ds.r4lUser') }),
    r4lSetCredentials: (u) => localStorage.setItem('ds.r4lUser', u),
    r4lForget: () => localStorage.removeItem('ds.r4lUser'),
  };
  function copyText(t) { navigator.clipboard?.writeText(t); toast('Copied'); }

  const EPMC = hasNative ? '/proxy/epmc/' : 'https://www.ebi.ac.uk/europepmc/webservices/rest/';
  const OPENALEX = hasNative ? '/proxy/openalex/' : 'https://api.openalex.org/';
  const PORTAL = 'https://portal.research4life.org/signin';

  // Title/abstract terms that keep results dermatological.
  const DERM_FILTER = '(TITLE_ABS:skin OR TITLE_ABS:cutaneous OR TITLE_ABS:dermatolog* OR TITLE_ABS:dermatitis OR TITLE_ABS:dermal OR TITLE_ABS:epiderm* OR TITLE_ABS:mucocutaneous)';
  // Queries already about skin disease don't need the filter.
  const DERM_WORDS = /\b(dermat\w*|skin|cutaneous|psoria\w*|eczema|vitiligo|acne|melasma|alopecia|urticaria|pemphig\w*|melanoma|hidradenitis|rosacea|lichen|tinea|dermatophyt\w*|scabies|lepros\w*|leprae|keloid|pigment\w*|nev(us|i)|naev\w*|mycosis fungoides|onychomycosis|wart|vulgaris|pruritus|itch|hyperhidrosis|keratos\w*|basal cell|squamous cell|seborrh\w*|intertrigo|impetigo|cellulitis|lupus|morphea|scleroderma|bullous|epidermolysis|ichthyosis|hair|nail|sunscreen|photoaging|isotretinoin|dupilumab|minoxidil)\b/i;

  const STOP = new Set('a an the of in on for to with and or is are was were be been does do did can could should would will what which who whom whose how why when where there any some this that these those than then vs versus compared comparison between among about into from by as at it its effect effects effective effectiveness efficacy role use using used study studies evidence patients patient people adults treatment treat treating therapy improve improves improvement reduce reduces better best'.split(' '));
  const KEEP_WHEN_ALONE = new Set(['treatment', 'therapy', 'efficacy']);

  // ---------------------------------------------------------------- icons
  const P = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    journal: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/><path d="M9 8h6"/>',
    bookmark: '<path d="M6 4h12v17l-6-4-6 4z"/>',
    bookmarkFill: '<path d="M6 4h12v17l-6-4-6 4z" fill="currentColor"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/>',
    up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>',
    starFill: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z" fill="currentColor"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4"/>',
    quote: '<path d="M7 7h4v4c0 3-1.5 5-4 6M14 7h4v4c0 3-1.5 5-4 6"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
    book: '<path d="M3 5c3-1 6-1 9 1v14c-3-2-6-2-9-1zM21 5c-3-1-6-1-9 1v14c3-2 6-2 9-1z"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
    sort: '<path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"/>',
    calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
    leaf: '<path d="M5 19c0-8 6-14 15-14 0 9-6 15-14 15"/><path d="M5 19 13 11"/>',
    bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
    trend: '<path d="m3 17 6-6 4 4 8-8M15 7h6v6"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    note: '<path d="M4 4h16v12l-4 4H4z"/><path d="M16 20v-4h4M8 9h8M8 13h5"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  };
  const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`;
  const LOGO = '<svg class="brand-mark" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="22" fill="#1F4E79"/><path fill="#fff" d="M11 15c4-1.5 8-1.2 12 1v18c-3-2.2-8-2.5-12-1zM37 15c-4-1.5-8-1.2-12 1v18c3-2.2 8-2.5 12-1z"/><path fill="#F59E0B" d="M31 27a4 4 0 1 1 0 8 4 4 0 1 1 0-8zm0 2a2 2 0 1 0 0 4 2 2 0 1 0 0-4z"/><path fill="#F59E0B" d="m33.6 33.2 1.4-1.4 3.6 3.6-1.4 1.4z"/></svg>';

  // ---------------------------------------------------------------- local state
  const store = {
    get(k, d) { try { const v = localStorage.getItem('ds.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('ds.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };
  const settings = Object.assign({ derm: true, preprints: false, theme: 'system', sort: 'relevance' }, store.get('settings', {}));
  const saveSettings = () => store.set('settings', settings);
  let follows = store.get('follows', null);
  if (!follows) {
    follows = ['J Am Acad Dermatol', 'JAMA Dermatol', 'Br J Dermatol', 'Indian J Dermatol Venereol Leprol'];
    store.set('follows', follows);
  }
  let recent = store.get('history', []);
  let collections = store.get('collections', ['Thesis', 'Journal club']);

  // IndexedDB for saved articles (falls back to memory if unavailable).
  const db = (() => {
    let dbp = null;
    const mem = new Map();
    function open() {
      if (dbp) return dbp;
      dbp = new Promise((resolve) => {
        try {
          const req = indexedDB.open('dermscholar', 1);
          req.onupgradeneeded = () => req.result.createObjectStore('articles', { keyPath: 'id' });
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch { resolve(null); }
      });
      return dbp;
    }
    async function tx(mode, fn) {
      const d = await open();
      if (!d) { const r = fn(null); return r && typeof r === 'object' && 'result' in r ? r.result : r; }
      return new Promise((resolve, reject) => {
        const t = d.transaction('articles', mode);
        const r = fn(t.objectStore('articles'));
        t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
        t.onerror = () => reject(t.error);
      });
    }
    return {
      async all() { return (await tx('readonly', (s) => (s ? s.getAll() : { result: [...mem.values()] }))) || []; },
      async get(id) { return tx('readonly', (s) => (s ? s.get(id) : { result: mem.get(id) })); },
      async put(o) { return tx('readwrite', (s) => (s ? s.put(o) : mem.set(o.id, o))); },
      async del(id) { return tx('readwrite', (s) => (s ? s.delete(id) : mem.delete(id))); },
    };
  })();

  let saved = new Map(); // id -> saved article
  let pdfKeys = new Set();
  const cache = new Map(); // id -> article seen in results
  const searchCache = new Map(); // route key -> {results, next, hit, broad}

  function refreshPdfs() {
    try { pdfKeys = new Set(JSON.parse(Native.listPdfs()).map((p) => p.key)); } catch { pdfKeys = new Set(); }
  }

  async function loadSaved() {
    const all = await db.all();
    saved = new Map(all.map((a) => [a.id, a]));
  }

  // PDFs saved from the Research4Life browser or imported, not yet in the library.
  async function syncPdfs() {
    refreshPdfs();
    let list = [];
    try { list = JSON.parse(Native.listPdfs()); } catch { /* none */ }
    let added = 0;
    for (const p of list) {
      if (saved.has(p.key)) continue;
      const entry = {
        id: p.key, imported: true, title: p.title || 'Document', journal: p.source === 'import' ? 'Imported PDF' : 'Saved from Research4Life',
        year: new Date(p.added || Date.now()).getFullYear(), types: [], abstract: '', authors: '',
        savedAt: p.added || Date.now(), status: 'unread', collections: [], notes: '',
      };
      await db.put(entry);
      saved.set(entry.id, entry);
      added++;
    }
    return added;
  }

  // ---------------------------------------------------------------- API
  async function getJSON(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  function epmcSearch(query, { sort = '', cursor = '*', size = 20 } = {}) {
    const p = new URLSearchParams({ query, format: 'json', resultType: 'core', pageSize: size, cursorMark: cursor });
    if (sort) p.set('sort', sort);
    return getJSON(EPMC + 'search?' + p).then((j) => ({
      hit: j.hitCount || 0,
      next: j.nextCursorMark && j.nextCursorMark !== cursor ? j.nextCursorMark : null,
      results: (j.resultList?.result || []).map(normalize),
    }));
  }

  function normalize(r) {
    const j = r.journalInfo || {};
    const jj = j.journal || {};
    const a = {
      id: `${r.source}_${r.id}`,
      source: r.source, extId: r.id, pmid: r.pmid || '', pmcid: r.pmcid || '', doi: r.doi || '',
      title: stripTags(r.title || 'Untitled').replace(/\.$/, ''),
      authors: r.authorString || '',
      journal: jj.title || r.journalTitle || r.bookOrReportDetails?.publisher || (r.source === 'PPR' ? 'Preprint' : ''),
      jAbbr: jj.isoabbreviation || jj.medlineAbbreviation || r.journalTitle || '',
      issn: jj.issn || '', essn: jj.essn || '',
      year: r.pubYear || '', date: r.firstPublicationDate || '',
      volume: j.volume || '', issue: j.issue || '', pages: r.pageInfo || '',
      citedBy: r.citedByCount || 0,
      oa: r.isOpenAccess === 'Y',
      inPMC: r.inPMC === 'Y' || !!r.pmcid,
      types: r.pubTypeList?.pubType || [],
      abstract: r.abstractText || '',
      links: (r.fullTextUrlList?.fullTextUrl || []).map((u) => ({ style: u.documentStyle, site: u.site, url: u.url, code: u.availabilityCode })),
      keywords: r.keywordList?.keyword || [],
      mesh: (r.meshHeadingList?.meshHeading || []).map((m) => m.descriptorName).slice(0, 12),
      hasRefs: r.hasReferences === 'Y',
    };
    a.finding = keyFinding(a.abstract);
    cache.set(a.id, a);
    return a;
  }

  // ---------------------------------------------------------------- evidence helpers
  function studyType(a) {
    const t = (a.types || []).map((x) => x.toLowerCase());
    const ti = (a.title || '').toLowerCase();
    const has = (s) => t.some((x) => x.includes(s));
    if (a.imported) return { label: 'PDF', cls: '', rank: 0 };
    if (a.source === 'PPR') return { label: 'Preprint', cls: 'b-case', rank: 1 };
    if (has('meta-analysis') || /meta-analys[ie]s|network meta/.test(ti)) return { label: 'Meta-analysis', cls: 'b-meta', rank: 6 };
    if (has('systematic review') || /systematic review/.test(ti)) return { label: 'Systematic review', cls: 'b-meta', rank: 5 };
    if (has('guideline') || /guideline|consensus statement|recommendations/.test(ti)) return { label: 'Guideline', cls: 'b-review', rank: 5 };
    if (has('randomized controlled trial') || /randomi[sz]ed|placebo-controlled/.test(ti)) return { label: 'RCT', cls: 'b-rct', rank: 4 };
    if (has('clinical trial') || /\btrial\b|phase (i|ii|iii|1|2|3)\b/.test(ti)) return { label: 'Clinical trial', cls: 'b-rct', rank: 3 };
    if (has('observational') || /cohort|case-control|cross-sectional|registry|population-based|retrospective|prospective|nationwide/.test(ti)) return { label: 'Observational', cls: 'b-obs', rank: 2 };
    if (has('case reports') || /case report|a case of|case series/.test(ti)) return { label: 'Case report', cls: 'b-case', rank: 1 };
    if (has('review')) return { label: 'Review', cls: 'b-review', rank: 2 };
    if (/\bmice\b|murine|in vitro|\brats?\b|cell line|zebrafish/.test(ti)) return { label: 'Preclinical', cls: 'b-case', rank: 1 };
    if (has('letter') || has('comment') || has('editorial')) return { label: 'Commentary', cls: '', rank: 0 };
    return { label: 'Study', cls: '', rank: 1 };
  }

  function splitSentences(text) {
    return text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+(?=[A-Z(\[])/).map((s) => s.trim()).filter((s) => s.length > 20);
  }

  /** The abstract's conclusion, trimmed to one or two sentences. */
  function keyFinding(abstract) {
    if (!abstract) return '';
    const parts = abstract.split(/<h4>/i);
    let text = '';
    for (const part of parts) {
      const m = part.match(/^([^<]*)<\/h4>([\s\S]*)$/i);
      if (m && /conclusion|interpretation|implication|relevance|summary|significance/i.test(m[1])) { text = stripTags(m[2]); }
    }
    let sentences;
    if (text) {
      sentences = splitSentences(text);
    } else {
      const all = splitSentences(stripTags(abstract.replace(/<h4>[^<]*<\/h4>/gi, ' ')));
      const cue = /\b(conclu\w*|suggest\w*|indicat\w*|demonstrat\w*|found|showed|shows|associated|effective|improv\w*|reduc\w*|significant\w*|support\w*)\b/i;
      const idx = all.map((s, i) => (cue.test(s) ? i : -1)).filter((i) => i >= 0);
      const pick = idx.length ? idx[idx.length - 1] : all.length - 1;
      sentences = pick >= 0 ? [all[pick]] : [];
    }
    let out = sentences.slice(0, 2).join(' ');
    if (out.length > 340) out = sentences[0] || out;
    if (out.length > 340) out = out.slice(0, 330).replace(/\s\S*$/, '') + '…';
    return out.replace(/^(in conclusion|to conclude|overall|in summary|taken together)[,:]?\s*/i, '').replace(/^./, (c) => c.toUpperCase());
  }

  function badgesFor(a, { compact = false } = {}) {
    const st = studyType(a);
    const b = [];
    if (st.label && st.label !== 'Study') b.push(`<span class="badge ${st.cls}">${esc(st.label)}</span>`);
    if (!a.imported) {
      const j = journalFor(a);
      if (j && j.top) b.push(`<span class="badge b-top">${icon('star')}Leading journal</span>`);
      if (a.citedBy >= 100) b.push(`<span class="badge b-cite">${icon('trend')}Highly cited</span>`);
      if (a.oa) b.push(`<span class="badge b-oa">${icon('unlock')}Open access</span>`);
    }
    if (pdfKeys.has(a.id)) b.push(`<span class="badge b-oa">${icon('file')}PDF offline</span>`);
    if (!compact && saved.has(a.id)) b.push(`<span class="badge b-saved">${icon('bookmarkFill')}Saved</span>`);
    return b.join('');
  }

  const journalByAbbr = new Map(JOURNALS.map((j) => [j.abbr.toLowerCase(), j]));
  const journalByIssn = new Map(JOURNALS.filter((j) => j.issn).map((j) => [j.issn, j]));
  function journalFor(a) {
    return journalByIssn.get(a.issn) || journalByIssn.get(a.essn) || journalByAbbr.get((a.jAbbr || '').toLowerCase()) || null;
  }
  const journalQuery = (j) => (j.issn ? `(ISSN:"${j.issn}" OR JOURNAL:"${j.abbr}")` : `JOURNAL:"${j.abbr}"`);
  const NOISE = 'NOT PUB_TYPE:"Published Erratum" NOT PUB_TYPE:"Retraction of Publication"';

  // ---------------------------------------------------------------- query building
  const TYPE_FILTERS = {
    meta: { label: 'Meta-analysis', q: 'PUB_TYPE:"Meta-Analysis"' },
    sr: { label: 'Systematic review', q: 'PUB_TYPE:"Systematic Review"' },
    rct: { label: 'RCT', q: 'PUB_TYPE:"Randomized Controlled Trial"' },
    trial: { label: 'Clinical trial', q: 'PUB_TYPE:"Clinical Trial"' },
    guide: { label: 'Guideline', q: '(PUB_TYPE:"Guideline" OR PUB_TYPE:"Practice Guideline")' },
    review: { label: 'Review', q: 'PUB_TYPE:"Review"' },
    case: { label: 'Case report', q: 'PUB_TYPE:"Case Reports"' },
  };
  const SORTS = { relevance: { label: 'Most relevant', v: '' }, newest: { label: 'Newest', v: 'P_PDATE_D desc' }, cited: { label: 'Most cited', v: 'CITED desc' } };
  const YEARS = { any: 'Any time', 2: 'Last 2 years', 5: 'Last 5 years', 10: 'Last 10 years' };

  const isAdvanced = (q) => /["():]|\b(AND|OR|NOT)\b/.test(q);

  function keywordTerms(q) {
    const words = q.replace(/[?!.,;]+/g, ' ').replace(/[“”]/g, '"').split(/\s+/).filter(Boolean);
    const kept = words.filter((w) => !STOP.has(w.toLowerCase()));
    if (!kept.length) return words.filter((w) => KEEP_WHEN_ALONE.has(w.toLowerCase()) || w.length > 2);
    return kept;
  }

  function buildQuery(f, { broad = false } = {}) {
    const raw = f.q.trim();
    let core;
    if (isAdvanced(raw)) core = raw;
    else {
      const terms = keywordTerms(raw);
      core = broad ? terms.join(' OR ') : terms.join(' ');
    }
    const parts = [`(${core})`];
    if (f.derm && !DERM_WORDS.test(raw)) parts.push(DERM_FILTER);
    if (f.types.length) parts.push('(' + f.types.map((t) => TYPE_FILTERS[t].q).join(' OR ') + ')');
    if (f.years !== 'any') parts.push(`PUB_YEAR:[${THIS_YEAR - Number(f.years) + 1} TO ${THIS_YEAR}]`);
    if (f.oa) parts.push('OPEN_ACCESS:y');
    let q = parts.join(' AND ');
    if (!f.preprints) q += ' NOT SRC:PPR';
    return q + ' ' + NOISE;
  }

  // ---------------------------------------------------------------- routing
  const view = $('#view');
  let depth = 0;
  let current = { name: '', params: {} };

  function parseHash() {
    const h = location.hash.replace(/^#\/?/, '');
    const [path, qs] = h.split('?');
    const seg = path.split('/').map(decodeURIComponent);
    return { name: seg[0] || 'home', arg: seg.slice(1).join('/'), params: Object.fromEntries(new URLSearchParams(qs || '')) };
  }
  function go(hash, { replace = false } = {}) {
    if (('#' + hash.replace(/^#/, '')) === location.hash) { render(); return; }
    if (replace) { location.replace('#' + hash.replace(/^#/, '')); return; }
    depth++;
    location.hash = hash;
  }
  const searchHash = (f) => 'search?' + new URLSearchParams({
    q: f.q, derm: f.derm ? 1 : 0, types: f.types.join(','), y: f.years, oa: f.oa ? 1 : 0, sort: f.sort, pp: f.preprints ? 1 : 0,
  });

  window.addEventListener('hashchange', render);

  const TAB_OF = { home: 'search', search: 'search', a: null, read: null, journals: 'journals', j: 'journals', library: 'library', settings: null };

  async function render() {
    closeSheet();
    const r = parseHash();
    current = r;
    const tab = TAB_OF[r.name];
    if (tab !== null && tab !== undefined) {
      $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    }
    window.scrollTo(0, 0);
    try {
      switch (r.name) {
        case 'search': return renderSearch(r.params);
        case 'a': return renderArticle(r.arg);
        case 'read': return renderReader(r.arg);
        case 'journals': return renderJournals();
        case 'j': return renderJournal(r.arg, r.params);
        case 'library': return renderLibrary(r.params);
        case 'settings': return renderSettings();
        default: return renderHome();
      }
    } catch (e) {
      view.innerHTML = errorBox(e);
    }
  }

  function topbar(title, { back = true, right = '' } = {}) {
    return `<div class="topbar">${back ? `<button class="icon-btn" data-act="back" aria-label="Back">${icon('back')}</button>` : ''}<h1>${esc(title)}</h1>${right}</div>`;
  }
  function errorBox(e, retry = true) {
    const offline = !navigator.onLine || /Failed to fetch|Network|HTTP 5/.test(String(e?.message || e));
    return `<div class="empty">${icon(offline ? 'globe' : 'x')}<b>${offline ? "You're offline" : 'Something went wrong'}</b>
      <div>${offline ? 'Search needs a connection. Your Library works offline.' : esc(e?.message || e)}</div>
      ${retry ? '<div class="spacer"></div><button class="btn small" data-act="retry">Try again</button>' : ''}</div>`;
  }
  const skeletons = (n = 4) => Array.from({ length: n }, () => '<div class="skeleton"><i style="width:92%"></i><i style="width:80%"></i><i style="width:45%"></i></div>').join('');

  // ---------------------------------------------------------------- home
  function searchBox(value = '', compact = false) {
    return `<form class="searchbox ${compact ? 'compact' : ''}" data-form="search">
      <textarea name="q" rows="1" placeholder="Ask a research question…" enterkeyhint="search" autocomplete="off">${esc(value)}</textarea>
      <button class="go" type="submit" aria-label="Search">${icon('up')}</button></form>`;
  }

  function renderHome() {
    const followed = JOURNALS.filter((j) => follows.includes(j.abbr));
    view.innerHTML = `
      <div class="row" style="justify-content:flex-end;padding-top:8px"><button class="icon-btn" data-act="settings" aria-label="Settings">${icon('settings')}</button></div>
      <section class="hero" style="padding-top:12px">
        <div class="brand">${LOGO}DermScholar</div>
        <h2>Evidence-based answers from dermatology research</h2>
        <p>Search 40M+ papers, read the key findings, and keep what matters offline.</p>
      </section>
      ${searchBox()}
      <div class="scroll-x">
        <button class="chip derm ${settings.derm ? 'on' : ''}" data-act="toggle-derm">${icon('leaf')}Dermatology focus</button>
        <button class="chip" data-act="quick" data-types="meta,sr">${icon('chart')}Meta-analyses</button>
        <button class="chip" data-act="quick" data-types="rct">${icon('check')}RCTs</button>
        <button class="chip" data-act="quick" data-types="guide">${icon('list')}Guidelines</button>
      </div>

      <div class="section">
        <div class="section-h"><h3>Try asking</h3></div>
        ${EXAMPLES.map((q) => `<button class="example" data-act="ask" data-q="${esc(q)}">${icon('bulb')}<span>${esc(q)}</span></button>`).join('')}
      </div>

      ${recent.length ? `<div class="section"><div class="section-h"><h3>Recent searches</h3><button data-act="clear-history">Clear</button></div>
        <div class="row wrap">${recent.slice(0, 8).map((q) => `<button class="chip" data-act="ask" data-q="${esc(q)}">${icon('clock')}${esc(q.length > 36 ? q.slice(0, 34) + '…' : q)}</button>`).join('')}</div></div>` : ''}

      <div class="section">
        <div class="section-h"><h3>Browse topics</h3></div>
        <div class="row wrap">${TOPICS.map((t) => `<button class="chip" data-act="topic" data-q="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      </div>

      <div class="section">
        <div class="section-h"><h3>New in your journals</h3><button data-act="tab" data-tab="journals">Manage</button></div>
        <div id="feed">${followed.length ? skeletons(3) : `<div class="muted small">Follow journals to see their latest articles here.</div>`}</div>
      </div>`;
    if (followed.length) loadFeed(followed);
  }

  async function loadFeed(followed) {
    const el = $('#feed');
    try {
      const q = '(' + followed.map(journalQuery).join(' OR ') + ') AND HAS_ABSTRACT:y ' + NOISE;
      const res = await epmcSearch(q, { sort: 'P_PDATE_D desc', size: 8 });
      if (!el.isConnected) return;
      el.innerHTML = res.results.map((a) => card(a, { compact: true })).join('') ||
        '<div class="muted small">No recent articles.</div>';
    } catch (e) {
      if (el.isConnected) el.innerHTML = `<div class="muted small">Couldn't load the feed${navigator.onLine ? '' : ' (offline)'}.</div>`;
    }
  }

  // ---------------------------------------------------------------- search
  function filtersFrom(p) {
    return {
      q: p.q || '',
      derm: p.derm == null ? settings.derm : p.derm === '1',
      types: (p.types || '').split(',').filter((t) => TYPE_FILTERS[t]),
      years: YEARS[p.y] ? p.y : 'any',
      oa: p.oa === '1',
      sort: SORTS[p.sort] ? p.sort : settings.sort,
      preprints: p.pp == null ? settings.preprints : p.pp === '1',
    };
  }

  function pdfAction(a) {
    if (a.imported) return '';
    if (pdfKeys.has(a.id)) return `<button class="btn xs good" data-act="card-pdf" data-id="${esc(a.id)}">${icon('file')}Read PDF</button>`;
    if (!a.doi && !pdfSourceFor(a)) return '';
    return `<button class="btn xs primary" data-act="card-pdf" data-id="${esc(a.id)}">${icon('download')}Get PDF</button>`;
  }
  function cardActions(a) {
    const s = saved.has(a.id);
    return `<div class="card-actions">${pdfAction(a)}
      <button class="btn xs ${s ? 'good' : ''}" data-act="card-save" data-id="${esc(a.id)}">${icon(s ? 'bookmarkFill' : 'bookmark')}${s ? 'Saved' : 'Save'}</button></div>`;
  }

  function card(a, { compact = false } = {}) {
    const finding = !compact && a.finding;
    return `<div class="card" role="button" tabindex="0" data-act="open" data-id="${esc(a.id)}">
      ${finding ? `<p class="finding">${esc(a.finding)}</p>` : ''}
      <p class="title ${finding ? '' : 'main'}">${esc(a.title)}</p>
      <div class="byline">${a.authors ? `<span>${esc(shortAuthors(a.authors))}</span>` : ''}
        <span class="${a.authors ? 'dot' : ''}">${esc(a.jAbbr || a.journal)}${a.year ? ' · ' + esc(a.year) : ''}</span>
        ${a.citedBy ? `<span class="dot">${fmt(a.citedBy)} citations</span>` : ''}</div>
      <div class="badges">${badgesFor(a)}</div>${cardActions(a)}</div>`;
  }
  function refreshCards() {
    if (current.name === 'a') { render(); return; }
    $$('.card[data-id]').forEach((el) => {
      const a = saved.get(el.dataset.id) || cache.get(el.dataset.id);
      const row = el.querySelector('.card-actions');
      if (a && row && !a.imported) row.outerHTML = el.dataset.act === 'open' && current.name !== 'library' ? cardActions(a) : `<div class="card-actions">${pdfAction(a)}</div>`;
    });
  }

  function shortAuthors(s) {
    const list = s.replace(/\.$/, '').split(/,\s*/);
    return list.length > 2 ? `${list[0]} et al.` : list.join(', ');
  }

  async function renderSearch(p) {
    const f = filtersFrom(p);
    if (!f.q.trim()) return go('', { replace: true });
    const key = searchHash(f);
    view.innerHTML = `
      ${topbar('Results', { right: `<button class="icon-btn" data-act="home" aria-label="Home">${icon('search')}</button>` })}
      <div class="spacer"></div>
      ${searchBox(f.q, true)}
      <div class="scroll-x">
        <button class="chip derm ${f.derm ? 'on' : ''}" data-act="f-derm">${icon('leaf')}Dermatology</button>
        <button class="chip ${f.types.length ? 'on' : ''}" data-act="f-types">${icon('filter')}${f.types.length ? f.types.map((t) => TYPE_FILTERS[t].label).join(', ') : 'Study type'}</button>
        <button class="chip ${f.years !== 'any' ? 'on' : ''}" data-act="f-years">${icon('calendar')}${esc(YEARS[f.years])}</button>
        <button class="chip ${f.oa ? 'on' : ''}" data-act="f-oa">${icon('unlock')}Open access</button>
        <button class="chip ${f.sort !== 'relevance' ? 'on' : ''}" data-act="f-sort">${icon('sort')}${esc(SORTS[f.sort].label)}</button>
      </div>
      <div id="results">${skeletons(5)}</div>`;
    const ta = $('.searchbox textarea');
    ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px';
    bindSearchChips(f);

    let state = searchCache.get(key);
    if (!state) {
      try {
        let res = await epmcSearch(buildQuery(f), { sort: SORTS[f.sort].v });
        let broad = false;
        if (res.hit < 5 && !isAdvanced(f.q) && keywordTerms(f.q).length > 1) {
          const wide = await epmcSearch(buildQuery(f, { broad: true }), { sort: SORTS[f.sort].v });
          if (wide.hit > res.hit) { res = wide; broad = true; }
        }
        state = { ...res, broad, f };
        searchCache.set(key, state);
        addHistory(f.q);
      } catch (e) {
        if (current.name === 'search') $('#results').innerHTML = errorBox(e);
        return;
      }
    }
    if (current.name !== 'search' || searchHash(filtersFrom(current.params)) !== key) return;
    drawResults(state);
  }

  function drawResults(state) {
    const el = $('#results');
    if (!state.results.length) {
      el.innerHTML = `<div class="empty">${icon('search')}<b>No papers found</b><div>Try fewer words, or turn off some filters.</div></div>`;
      return;
    }
    el.innerHTML = `
      <div class="meta-line">${fmt(state.hit)} papers${state.broad ? ' · showing broader matches' : ''}</div>
      ${snapshot(state)}
      <div id="cards">${state.results.map((a) => card(a)).join('')}</div>
      ${state.next ? '<button class="more" data-act="more">Load more</button>' : ''}`;
  }

  function snapshot(state) {
    const rs = state.results;
    const groups = [
      { k: 'Meta-analysis / SR', c: 'var(--violet)', test: (s) => s.rank >= 5 && s.label !== 'Guideline' },
      { k: 'Trials', c: 'var(--good)', test: (s) => s.label === 'RCT' || s.label === 'Clinical trial' },
      { k: 'Observational', c: 'var(--warn)', test: (s) => s.label === 'Observational' },
      { k: 'Reviews & guidelines', c: 'var(--accent)', test: (s) => s.label === 'Review' || s.label === 'Guideline' },
      { k: 'Other', c: 'var(--line-strong)', test: () => true },
    ];
    const counts = groups.map(() => 0);
    rs.forEach((a) => { const s = studyType(a); counts[groups.findIndex((g) => g.test(s))]++; });
    const years = rs.map((a) => +a.year).filter(Boolean).sort((x, y) => x - y);
    const median = years.length ? years[Math.floor(years.length / 2)] : '—';
    const oaPct = Math.round((rs.filter((a) => a.oa).length / rs.length) * 100);
    const topJ = Object.entries(rs.reduce((m, a) => { const k = a.jAbbr || a.journal; if (k) m[k] = (m[k] || 0) + 1; return m; }, {}))
      .sort((x, y) => y[1] - x[1])[0];
    return `<div class="snapshot"><h4>${icon('chart')}Evidence snapshot <span class="muted small" style="font-weight:400">· top ${rs.length} results</span></h4>
      <div class="bar">${counts.map((n, i) => (n ? `<span style="width:${(n / rs.length) * 100}%;background:${groups[i].c}"></span>` : '')).join('')}</div>
      <div class="legend">${counts.map((n, i) => (n ? `<span><i style="background:${groups[i].c}"></i>${groups[i].k} ${n}</span>` : '')).join('')}</div>
      <div class="stats"><div class="stat"><b>${median}</b><span>Median year</span></div>
        <div class="stat"><b>${oaPct}%</b><span>Open access</span></div>
        <div class="stat"><b style="font-size:13px;line-height:1.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(topJ ? topJ[0] : '—')}</b><span>Top journal</span></div></div></div>`;
  }

  function bindSearchChips(f) {
    const nav = (patch) => go(searchHash({ ...f, ...patch }), { replace: true });
    actions['f-derm'] = () => nav({ derm: !f.derm });
    actions['f-oa'] = () => nav({ oa: !f.oa });
    actions['f-years'] = () => pickOne('Publication date', YEARS, f.years, (v) => nav({ years: v }));
    actions['f-sort'] = () => pickOne('Sort by', Object.fromEntries(Object.entries(SORTS).map(([k, v]) => [k, v.label])), f.sort, (v) => nav({ sort: v }));
    actions['f-types'] = () => pickMany('Study type', Object.fromEntries(Object.entries(TYPE_FILTERS).map(([k, v]) => [k, v.label])), f.types, (v) => nav({ types: v }));
    actions.more = async (btn) => {
      const key = searchHash(f);
      const state = searchCache.get(key);
      if (!state?.next) return;
      btn.disabled = true; btn.textContent = 'Loading…';
      try {
        const res = await epmcSearch(buildQuery(f, { broad: state.broad }), { sort: SORTS[f.sort].v, cursor: state.next });
        state.results.push(...res.results);
        state.next = res.next;
        $('#cards').insertAdjacentHTML('beforeend', res.results.map((a) => card(a)).join(''));
        if (!state.next) btn.remove(); else { btn.disabled = false; btn.textContent = 'Load more'; }
      } catch {
        btn.disabled = false; btn.textContent = 'Load more'; toast('Could not load more');
      }
    };
  }

  function addHistory(q) {
    recent = [q, ...recent.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 15);
    store.set('history', recent);
  }

  // ---------------------------------------------------------------- article
  async function findArticle(id) {
    if (saved.has(id)) return { ...cache.get(id), ...saved.get(id) };
    if (cache.has(id)) return cache.get(id);
    const [src, ext] = id.split(/_(.+)/);
    const res = await epmcSearch(`EXT_ID:${ext} AND SRC:${src}`, { size: 1 });
    if (!res.results.length) throw new Error('Article not found');
    return res.results[0];
  }

  function abstractHtml(abs) {
    if (!abs) return '<p class="muted">No abstract available.</p>';
    // Europe PMC abstracts use <h4> section headings and simple inline tags.
    const tmp = document.createElement('div');
    tmp.innerHTML = abs.replace(/<(?!\/?(h4|i|b|em|strong|sup|sub|br)\b)[^>]*>/gi, ' ');
    $$('*', tmp).forEach((el) => { [...el.attributes].forEach((at) => el.removeAttribute(at.name)); });
    const out = [];
    let para = [];
    const flush = () => { const t = para.join('').trim(); if (t) out.push(`<p>${t}</p>`); para = []; };
    tmp.childNodes.forEach((n) => {
      if (n.nodeName === 'H4') { flush(); out.push(`<h4>${esc(n.textContent)}</h4>`); }
      else para.push(n.nodeType === 3 ? esc(n.textContent) : n.outerHTML);
    });
    flush();
    return out.join('');
  }

  function pdfSourceFor(a) {
    const pdf = a.links?.find((l) => l.style === 'pdf' && (l.code === 'OA' || l.code === 'F'));
    if (pdf) return pdf.url;
    if (a.pmcid && a.oa) return `https://europepmc.org/articles/${a.pmcid}?pdf=render`;
    return null;
  }
  const doiUrl = (a) => (a.doi ? `https://doi.org/${a.doi}` : null);
  const R4L_PROXY = 'https://login.research4life.org/tacsgr1';

  function r4lAccount() {
    try { return JSON.parse(Native.r4lAccount ? Native.r4lAccount() : '{}'); } catch { return {}; }
  }

  /** Read the PDF if it's saved; otherwise fetch it (free copy first, then Research4Life). */
  async function getPdf(a, { skipAsk = false } = {}) {
    if (pdfKeys.has(a.id)) { Native.openPdf(a.id, a.title); return; }
    const free = pdfSourceFor(a);
    if (!free && !a.doi) {
      Native.copy(a.title);
      toast('No DOI for this paper. Title copied: paste it into Research4Life search.');
      Native.openPortal(PORTAL, a.id, a.title);
      return;
    }
    if (!free && !skipAsk && !r4lAccount().saved && !store.get('r4lAsked', false)) {
      r4lSignInSheet(() => getPdf(a, { skipAsk: true }));
      return;
    }
    if (!saved.has(a.id)) { await saveArticle(a); }
    toast(free ? 'Downloading free PDF…' : 'Getting PDF through Research4Life…');
    Native.getPdf(a.id, a.doi || '', a.title, free || '');
  }

  function r4lSignInSheet(then) {
    const acc = r4lAccount();
    sheet(`<h3>Research4Life sign-in</h3>
      <p class="muted small" style="margin-top:-4px">Save your Research4Life user ID and password once. The app then signs in for you whenever you tap
      <b>Get PDF</b>, so there's no website login each time. It's stored encrypted on this phone only.</p>
      <form data-form="r4l">
        <label class="field">User ID</label><input type="text" name="u" value="${esc(acc.user || '')}" autocomplete="username" autocapitalize="none">
        <label class="field">Password</label><input type="password" name="p" autocomplete="current-password">
        <div class="actions"><button type="button" class="btn" data-act="r4l-skip">${then ? 'Skip' : 'Cancel'}</button><button class="btn primary">Save</button></div>
      </form>`);
    const form = $('[data-form=r4l]');
    setTimeout(() => form.u.value ? form.p.focus() : form.u.focus(), 50);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const u = form.u.value.trim(); const p = form.p.value;
      if (!u || !p) { toast('Enter both user ID and password'); return; }
      Native.r4lSetCredentials(u, p);
      store.set('r4lAsked', true);
      closeSheet(true);
      toast('Research4Life sign-in saved');
      if (then) then(); else render();
    });
    actions['r4l-skip'] = () => { store.set('r4lAsked', true); closeSheet(true); if (then) then(); };
  }

  async function renderArticle(id) {
    view.innerHTML = topbar('Paper') + skeletons(2);
    let a;
    try { a = await findArticle(id); } catch (e) { view.innerHTML = topbar('Paper') + errorBox(e); return; }
    if (current.name !== 'a' || current.arg !== id) return;
    if (a.imported) { Native.openPdf(a.id, a.title); App.back(); return; }

    const s = saved.get(a.id);
    const j = journalFor(a);
    const hasPdf = pdfKeys.has(a.id);
    const pdfSrc = pdfSourceFor(a);
    const canRead = !!a.pmcid && (a.oa || a.inPMC);
    const authors = (a.authors || '').replace(/\.$/, '').split(/,\s*/).filter(Boolean);

    view.innerHTML = `
      ${topbar(a.jAbbr || 'Paper', { right: `<button class="icon-btn" data-act="share" aria-label="Share">${icon('share')}</button>` })}
      <article class="article">
        <div class="badges">${badgesFor(a, { compact: true })}</div>
        <h2>${esc(a.title)}</h2>
        ${authors.length ? `<p class="authors">${esc(authors.slice(0, 6).join(', '))}${authors.length > 6 ? ` <span class="muted">+${authors.length - 6} more</span>` : ''}</p>` : ''}
        <div class="journal-line">${j ? `<a href="#/j/${encodeURIComponent(j.abbr)}">${esc(a.journal)}</a>` : esc(a.journal)}
          ${a.year ? ' · ' + esc(a.year) : ''}${a.volume ? ` · ${esc(a.volume)}${a.issue ? '(' + esc(a.issue) + ')' : ''}` : ''}${a.pages ? ':' + esc(a.pages) : ''}
          ${a.citedBy ? ` · ${fmt(a.citedBy)} citations` : ''}</div>

        ${a.finding ? `<div class="keybox"><div class="label">${icon('spark')}Key finding</div><p>${esc(a.finding)}</p></div>` : ''}

        <div class="actions">
          ${hasPdf
            ? `<button class="btn good full big" data-act="open-pdf">${icon('file')}Read PDF<span class="sub">Saved on this phone</span></button>`
            : pdfSrc || a.doi
              ? `<button class="btn primary full big" data-act="get-pdf">${icon('download')}Get PDF now<span class="sub">${pdfSrc ? 'Free copy · saves to your library' : 'Through your Research4Life access'}</span></button>`
              : `<button class="btn full" data-act="r4l">${icon('key')}Find on Research4Life</button>`}
          <button class="btn ${s ? 'good' : ''}" data-act="save">${icon(s ? 'bookmarkFill' : 'bookmark')}${s ? 'Saved' : 'Save'}</button>
          ${canRead ? `<button class="btn" data-act="reader">${icon('book')}${s?.fullText ? 'Read offline' : 'Full text'}</button>` : ''}
          ${a.doi ? `<button class="btn" data-act="publisher">${icon('key')}Open via R4L</button>` : ''}
          <button class="btn" data-act="cite">${icon('quote')}Cite</button>
        </div>

        ${s ? libraryPanel(s) : ''}

        <div class="tabs" id="atabs">
          <button class="on" data-act="atab" data-t="abstract">Abstract</button>
          ${a.citedBy ? `<button data-act="atab" data-t="citations">Cited by ${fmt(a.citedBy)}</button>` : ''}
          ${a.hasRefs ? '<button data-act="atab" data-t="references">References</button>' : ''}
        </div>
        <div id="apane">
          <div class="abstract">${abstractHtml(a.abstract)}</div>
          ${[...a.keywords, ...a.mesh].length ? `<div class="section"><div class="section-h"><h3>Topics</h3></div><div class="row wrap">
            ${[...new Set([...a.mesh, ...a.keywords])].slice(0, 14).map((k) => `<button class="chip" data-act="ask" data-q="${esc(k)}">${esc(k)}</button>`).join('')}</div></div>` : ''}
          <div class="section small muted">${[a.pmid && `PMID ${esc(a.pmid)}`, a.pmcid && esc(a.pmcid), a.doi && `DOI ${esc(a.doi)}`].filter(Boolean).join(' · ')}
            ${a.pmid ? ` · <a href="https://pubmed.ncbi.nlm.nih.gov/${esc(a.pmid)}/">PubMed</a>` : ''}</div>
        </div>
      </article>`;

    bindArticle(a);
  }

  function libraryPanel(s) {
    return `<div class="panel">
      <div class="panel-head">
        <h3>In your library</h3>
        <div class="seg">${[['unread', 'To read'], ['reading', 'Reading'], ['read', 'Read']].map(([k, l]) => `<button class="${s.status === k ? 'on' : ''}" data-act="status" data-s="${k}">${l}</button>`).join('')}</div>
      </div>
      <div class="row wrap" style="margin-bottom:10px">
        ${(s.collections || []).map((c) => `<span class="chip on">${icon('folder')}${esc(c)}</span>`).join('')}
        <button class="chip" data-act="collections">${icon('plus')}${(s.collections || []).length ? 'Edit' : 'Add to collection'}</button>
      </div>
      <textarea class="notes" id="notes" placeholder="Your notes — key numbers, dosing, how you'd use this…">${esc(s.notes || '')}</textarea>
      <div class="muted small" style="margin-top:6px">Saved ${new Date(s.savedAt).toLocaleDateString()} · notes save automatically</div>
    </div>`;
  }

  function bindArticle(a) {
    const title = a.title;
    actions.save = async () => {
      if (saved.has(a.id)) {
        sheet(`<h3>Remove from library?</h3>
          <p class="muted">Notes${pdfKeys.has(a.id) ? ' and the offline PDF' : ''} for this paper will be deleted.</p>
          <div class="actions"><button class="btn" data-act="close-sheet">Cancel</button><button class="btn primary" data-act="unsave-confirm">Remove</button></div>`);
        actions['unsave-confirm'] = async () => {
          await db.del(a.id); saved.delete(a.id);
          if (pdfKeys.has(a.id)) { Native.deletePdf(a.id); pdfKeys.delete(a.id); }
          toast('Removed from library'); render();
        };
        return;
      }
      await saveArticle(a);
      toast('Saved to library');
      render();
      if (a.pmcid && (a.oa || a.inPMC)) cacheFullText(a).catch(() => {});
    };
    actions['get-pdf'] = () => getPdf(a);
    actions['open-pdf'] = () => Native.openPdf(a.id, title);
    actions.reader = () => go('read/' + encodeURIComponent(a.id));
    actions.publisher = async () => {
      if (!saved.has(a.id)) await saveArticle(a);
      Native.openPortal(R4L_PROXY + 'doi_org/' + a.doi, a.id, title);
    };
    actions.r4l = async () => {
      if (!saved.has(a.id)) await saveArticle(a);
      Native.copy(title);
      toast('Title copied — paste it into Research4Life search');
      Native.openPortal(PORTAL, a.id, title);
    };
    actions.cite = () => citeSheet([a]);
    actions.share = () => Native.share(title, `${title}\n${a.jAbbr} ${a.year}\n${doiUrl(a) || (a.pmid ? 'https://pubmed.ncbi.nlm.nih.gov/' + a.pmid : '')}`);
    actions.status = async (btn) => { await updateSaved(a.id, { status: btn.dataset.s }); $$('[data-act=status]').forEach((b) => b.classList.toggle('on', b === btn)); };
    actions.collections = () => collectionSheet(a.id);
    actions.atab = (btn) => {
      $$('#atabs button').forEach((b) => b.classList.toggle('on', b === btn));
      const t = btn.dataset.t;
      if (t === 'abstract') return renderArticle(a.id);
      loadLinks(a, t);
    };
    const notes = $('#notes');
    if (notes) {
      let timer;
      notes.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => updateSaved(a.id, { notes: notes.value }), 400); });
    }
  }

  async function saveArticle(a) {
    const entry = { ...a, savedAt: Date.now(), status: 'unread', collections: [], notes: '' };
    await db.put(entry);
    saved.set(a.id, entry);
  }
  async function updateSaved(id, patch) {
    const s = saved.get(id);
    if (!s) return;
    Object.assign(s, patch);
    await db.put(s);
  }

  async function loadLinks(a, kind) {
    const pane = $('#apane');
    pane.innerHTML = skeletons(3);
    try {
      const j = await getJSON(`${EPMC}${a.source}/${a.extId}/${kind}?format=json&pageSize=40`);
      const list = kind === 'citations' ? j.citationList?.citation || [] : j.referenceList?.reference || [];
      if (!pane.isConnected) return;
      pane.innerHTML = list.length ? list.map((c) => {
        const id = c.id && c.source ? `${c.source}_${c.id}` : '';
        const inner = `<div class="t">${esc(stripTags(c.title || c.unstructuredInfo || 'Untitled'))}</div>
          <div class="s">${esc(shortAuthors(c.authorString || ''))} · ${esc(c.journalAbbreviation || '')} ${esc(c.pubYear || '')}${c.citedByCount ? ` · ${fmt(c.citedByCount)} citations` : ''}</div>`;
        return id ? `<button class="mini" data-act="open" data-id="${esc(id)}">${inner}</button>` : `<div class="mini">${inner}</div>`;
      }).join('') + (j.hitCount > list.length ? `<div class="muted small center" style="padding:12px">Showing ${list.length} of ${fmt(j.hitCount)}</div>` : '')
        : '<div class="empty"><b>Nothing listed</b></div>';
    } catch (e) {
      if (pane.isConnected) pane.innerHTML = errorBox(e, false);
    }
  }

  // ---------------------------------------------------------------- full-text reader (JATS)
  async function fetchFullText(a) {
    const r = await fetch(`${EPMC}${a.pmcid}/fullTextXML`);
    if (!r.ok) throw new Error(r.status === 404 ? 'Full text is not available for this paper' : 'HTTP ' + r.status);
    const xml = new DOMParser().parseFromString(await r.text(), 'application/xml');
    if (xml.querySelector('parsererror')) throw new Error('Could not read the full text');
    return jatsToHtml(xml);
  }
  async function cacheFullText(a) {
    const html = await fetchFullText(a);
    await updateSaved(a.id, { fullText: html });
    return html;
  }

  function jatsToHtml(xml) {
    const inline = (node) => {
      let out = '';
      node.childNodes.forEach((n) => {
        if (n.nodeType === 3) { out += esc(n.nodeValue); return; }
        if (n.nodeType !== 1) return;
        const tag = n.localName;
        if (tag === 'italic') out += `<i>${inline(n)}</i>`;
        else if (tag === 'bold') out += `<b>${inline(n)}</b>`;
        else if (tag === 'sup' || tag === 'sub') out += `<${tag}>${inline(n)}</${tag}>`;
        else if (tag === 'xref') out += n.getAttribute('ref-type') === 'bibr' ? `<sup>${inline(n)}</sup>` : inline(n);
        else if (['fig', 'table-wrap', 'disp-formula'].includes(tag)) { /* handled as blocks */ }
        else out += inline(n);
      });
      return out;
    };
    const table = (t) => {
      const rows = $$('tr', t).map((tr) => '<tr>' + Array.from(tr.children).map((c) => {
        const tag = c.localName === 'th' ? 'th' : 'td';
        const span = ['colspan', 'rowspan'].map((k) => (c.getAttribute(k) ? ` ${k}="${Number(c.getAttribute(k)) || 1}"` : '')).join('');
        return `<${tag}${span}>${inline(c)}</${tag}>`;
      }).join('') + '</tr>').join('');
      return rows ? `<div class="tbl"><table>${rows}</table></div>` : '';
    };
    const block = (node, level) => {
      let out = '';
      node.childNodes.forEach((n) => {
        if (n.nodeType !== 1) return;
        const tag = n.localName;
        if (tag === 'sec') out += block(n, level + 1);
        else if (tag === 'title') out += `<h${Math.min(level + 2, 4)}>${inline(n)}</h${Math.min(level + 2, 4)}>`;
        else if (tag === 'p') {
          out += `<p>${inline(n)}</p>`;
          $$(':scope > fig, :scope > table-wrap', n).forEach((f) => { out += block({ childNodes: [f] }, level); });
        }
        else if (tag === 'list') out += `<ul>${$$(':scope > list-item', n).map((li) => `<li>${inline(li)}</li>`).join('')}</ul>`;
        else if (tag === 'fig' || tag === 'table-wrap') {
          const label = $('label', n)?.textContent || '';
          const cap = $('caption', n);
          out += `<figure><b>${esc(label)}</b> ${cap ? inline(cap) : ''}${tag === 'table-wrap' ? table(n) : ''}</figure>`;
        }
        else if (tag === 'disp-quote' || tag === 'boxed-text') out += block(n, level);
      });
      return out;
    };
    const title = xml.querySelector('article-meta title-group article-title');
    const body = xml.querySelector('body');
    const refs = $$('back ref-list ref', xml).map((r) => `<li>${esc(r.textContent.replace(/\s+/g, ' ').trim())}</li>`).join('');
    return `${title ? `<h2>${inline(title)}</h2>` : ''}${body ? block(body, 0) : '<p class="muted">This paper has no full text body in Europe PMC.</p>'}
      ${refs ? `<h3>References</h3><ol class="refs">${refs}</ol>` : ''}`;
  }

  async function renderReader(id) {
    view.innerHTML = topbar('Full text') + skeletons(3);
    let a;
    try { a = await findArticle(id); } catch (e) { view.innerHTML = topbar('Full text') + errorBox(e); return; }
    let html = saved.get(id)?.fullText;
    if (!html) {
      try { html = await fetchFullText(a); } catch (e) { view.innerHTML = topbar('Full text') + errorBox(e, false); return; }
      if (saved.has(id)) updateSaved(id, { fullText: html });
    }
    if (current.name !== 'read') return;
    view.innerHTML = `${topbar(a.jAbbr || 'Full text', { right: `<button class="icon-btn" data-act="reader-save" aria-label="Save">${icon(saved.has(id) ? 'bookmarkFill' : 'bookmark')}</button>` })}
      ${saved.has(id) ? '<div class="muted small" style="margin-top:10px">Available offline</div>' : ''}
      <div class="reader">${html}</div>`;
    actions['reader-save'] = async () => {
      if (saved.has(id)) return toast('Already in your library');
      await saveArticle(a); await updateSaved(id, { fullText: html });
      toast('Saved for offline reading'); render();
    };
  }

  // ---------------------------------------------------------------- journals
  const colorFor = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 45% 42%)`; };
  const initials = (j) => j.abbr.replace(/[^A-Za-z ]/g, '').split(' ').filter((w) => w.length > 1 || /[A-Z]/.test(w)).map((w) => w[0]).join('').slice(0, 3).toUpperCase();

  function jrow(j) {
    const on = follows.includes(j.abbr);
    return `<div class="jrow"><div class="avatar" style="background:${colorFor(j.abbr)}">${esc(initials(j))}</div>
      <button class="open" data-act="journal" data-abbr="${esc(j.abbr)}"><div class="name">${esc(j.name)}</div>
      <div class="sub">${esc(j.abbr)} · ${esc(j.publisher)}${j.oa ? ' · <span style="color:var(--good)">Open access</span>' : ''}</div></button>
      <button class="star ${on ? 'on' : ''}" data-act="follow" data-abbr="${esc(j.abbr)}" aria-label="Follow">${icon(on ? 'starFill' : 'star')}</button></div>`;
  }

  function renderJournals() {
    const followed = JOURNALS.filter((j) => follows.includes(j.abbr));
    view.innerHTML = `${topbar('Dermatology journals', { back: false })}
      <label class="search-inline">${icon('search')}<input id="jfilter" placeholder="Filter ${JOURNALS.length} journals" autocomplete="off"></label>
      <div id="jlist">
        ${followed.length ? `<div class="section"><div class="section-h"><h3>Following · ${followed.length}</h3></div>${followed.map(jrow).join('')}</div>` : ''}
        ${JOURNAL_GROUPS.map((g) => `<div class="section"><div class="section-h"><h3>${esc(g)}</h3></div>${JOURNALS.filter((j) => j.group === g).map(jrow).join('')}</div>`).join('')}
        <div class="section"><div class="section-h"><h3>Discover more</h3></div>
          <button class="btn full" data-act="discover" style="width:100%">${icon('globe')}Find other dermatology journals</button>
          <div id="discover"></div></div>
      </div>`;
    $('#jfilter').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      $('#jlist').innerHTML = q
        ? `<div class="section">${JOURNALS.filter((j) => (j.name + ' ' + j.abbr + ' ' + j.publisher).toLowerCase().includes(q)).map(jrow).join('') || '<div class="empty"><b>No match</b></div>'}</div>`
        : '';
      if (!q) renderJournals();
    });
    actions.discover = async (btn) => {
      btn.disabled = true;
      const el = $('#discover');
      el.innerHTML = skeletons(2);
      try {
        const j = await getJSON(`${OPENALEX}sources?search=dermatology&sort=cited_by_count:desc&per_page=50&select=display_name,issn_l,summary_stats,is_oa,works_count,host_organization_name`);
        const known = new Set(JOURNALS.map((x) => x.issn).filter(Boolean));
        const list = j.results.filter((s) => s.issn_l && !known.has(s.issn_l) && s.works_count > 200 && s.summary_stats?.['2yr_mean_citedness'] > 0);
        el.innerHTML = list.map((s) => `<div class="jrow"><div class="avatar" style="background:${colorFor(s.display_name)}">${esc(s.display_name.replace(/[^A-Z]/g, '').slice(0, 3) || 'J')}</div>
          <button class="open" data-act="journal-issn" data-issn="${esc(s.issn_l)}" data-name="${esc(s.display_name)}"><div class="name">${esc(s.display_name)}</div>
          <div class="sub">${esc(s.host_organization_name || '')} · h-index ${s.summary_stats.h_index}${s.is_oa ? ' · Open access' : ''}</div></button></div>`).join('') || '<div class="muted small">Nothing new found.</div>';
      } catch (e) { el.innerHTML = errorBox(e, false); }
    };
    actions['journal-issn'] = (b) => go(`j/issn:${encodeURIComponent(b.dataset.issn)}?name=${encodeURIComponent(b.dataset.name)}`);
  }

  async function renderJournal(arg, params) {
    let j = journalByAbbr.get(arg.toLowerCase());
    if (!j && arg.startsWith('issn:')) {
      const issn = arg.slice(5);
      j = journalByIssn.get(issn) || { name: params.name || issn, abbr: params.name || issn, issn, publisher: '', custom: true };
    }
    if (!j) return go('journals', { replace: true });
    const tab = params.t || 'latest';
    const on = follows.includes(j.abbr);
    view.innerHTML = `${topbar(j.abbr, { right: j.custom ? '' : `<button class="star ${on ? 'on' : ''}" data-act="follow" data-abbr="${esc(j.abbr)}">${icon(on ? 'starFill' : 'star')}</button>` })}
      <div class="row" style="gap:14px;margin-top:16px"><div class="avatar" style="width:52px;height:52px;background:${colorFor(j.abbr)}">${esc(j.custom ? 'J' : initials(j))}</div>
        <div><div style="font:600 18px/1.3 var(--serif)">${esc(j.name)}</div><div class="muted small">${esc(j.publisher)}${j.oa ? ' · Open access' : ''}</div></div></div>
      <div class="jstats" id="jstats">${['h-index', 'Cites / paper (2y)', 'Papers'].map((l) => `<div class="stat"><b>…</b><span>${l}</span></div>`).join('')}</div>
      <div class="row" style="gap:8px"><button class="btn small" data-act="j-home" style="flex:1">${icon('globe')}Website</button>
        <button class="btn small" data-act="j-r4l" style="flex:1">${icon('key')}Research4Life</button></div>
      <form class="search-inline" data-form="jsearch">${icon('search')}<input name="q" placeholder="Search in this journal" value="${esc(params.q || '')}" enterkeyhint="search"></form>
      <div class="tabs">${[['latest', 'Latest'], ['cited', 'Most cited · 3y'], ['reviews', 'Reviews & meta']].map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-act="jtab" data-t="${k}">${l}</button>`).join('')}</div>
      <div id="jarts">${skeletons(4)}</div>`;

    let homepage = null;
    actions.jtab = (b) => go(`j/${encodeURIComponent(arg)}?${new URLSearchParams({ ...params, t: b.dataset.t })}`, { replace: true });
    actions['j-home'] = () => (homepage ? Native.openPortal(homepage, '', '') : toast('Website not known yet'));
    actions['j-r4l'] = () => { Native.copy(j.name); toast('Journal name copied — paste it into Research4Life'); Native.openPortal(PORTAL, '', ''); };
    $('[data-form=jsearch]').addEventListener('submit', (e) => {
      e.preventDefault();
      go(`j/${encodeURIComponent(arg)}?${new URLSearchParams({ ...params, q: e.target.q.value.trim() })}`, { replace: true });
    });

    const statsUrl = j.issn ? `${OPENALEX}sources/issn:${j.issn}` : `${OPENALEX}sources?search=${encodeURIComponent(j.name)}&per_page=1`;
    getJSON(statsUrl).then((d) => {
      const s = d.results ? d.results[0] : d;
      if (!s || !$('#jstats')) return;
      homepage = s.homepage_url;
      const v = [s.summary_stats?.h_index ?? '—', s.summary_stats?.['2yr_mean_citedness'] != null ? s.summary_stats['2yr_mean_citedness'].toFixed(2) : '—', fmt(s.works_count)];
      $$('#jstats b').forEach((b, i) => { b.textContent = v[i]; });
    }).catch(() => { $$('#jstats b').forEach((b) => { b.textContent = '—'; }); });

    let q = journalQuery(j) + (params.q ? ` AND (${params.q})` : '');
    let sort = 'P_PDATE_D desc';
    if (tab === 'cited') { q += ` AND PUB_YEAR:[${THIS_YEAR - 2} TO ${THIS_YEAR}]`; sort = 'CITED desc'; }
    if (tab === 'reviews') q += ' AND (PUB_TYPE:"Review" OR PUB_TYPE:"Meta-Analysis" OR PUB_TYPE:"Systematic Review")';
    q += ' ' + NOISE;
    let next = '*';
    const load = async (btn) => {
      try {
        const res = await epmcSearch(q, { sort, cursor: next });
        next = res.next;
        const el = $('#jarts');
        if (!el) return;
        if (btn) btn.remove(); else el.innerHTML = '';
        el.insertAdjacentHTML('beforeend', res.results.map((a) => card(a, { compact: true })).join('') || '<div class="empty"><b>No articles</b></div>');
        if (next) el.insertAdjacentHTML('beforeend', '<button class="more" data-act="jmore">Load more</button>');
      } catch (e) { const el = $('#jarts'); if (el) el.innerHTML = errorBox(e); }
    };
    actions.jmore = (b) => { b.disabled = true; b.textContent = 'Loading…'; load(b); };
    load();
  }

  // ---------------------------------------------------------------- library
  function renderLibrary(p) {
    const filter = p.f || 'all';
    const coll = p.c || '';
    const q = (p.q || '').toLowerCase();
    let items = [...saved.values()].sort((x, y) => y.savedAt - x.savedAt);
    if (filter === 'unread') items = items.filter((a) => a.status !== 'read');
    if (filter === 'read') items = items.filter((a) => a.status === 'read');
    if (filter === 'pdf') items = items.filter((a) => pdfKeys.has(a.id));
    if (filter === 'offline') items = items.filter((a) => pdfKeys.has(a.id) || a.fullText);
    if (coll) items = items.filter((a) => (a.collections || []).includes(coll));
    if (q) items = items.filter((a) => [a.title, a.authors, a.journal, a.notes, ...(a.keywords || [])].join(' ').toLowerCase().includes(q));
    const nav = (patch) => go('library?' + new URLSearchParams(Object.fromEntries(Object.entries({ f: filter, c: coll, q: p.q || '', ...patch }).filter(([, v]) => v))), { replace: true });

    view.innerHTML = `${topbar(`Library · ${saved.size}`, { back: false, right: `<button class="icon-btn" data-act="settings" aria-label="Settings">${icon('settings')}</button>` })}
      <label class="search-inline">${icon('search')}<input id="lq" placeholder="Search titles, notes, authors" value="${esc(p.q || '')}" autocomplete="off"></label>
      <div class="scroll-x" style="margin-top:8px">
        ${[['all', 'All'], ['unread', 'To read'], ['read', 'Read'], ['offline', 'Offline'], ['pdf', 'PDFs']].map(([k, l]) => `<button class="chip ${filter === k ? 'on' : ''}" data-act="lf" data-v="${k}">${l}</button>`).join('')}
      </div>
      <div class="scroll-x" style="margin-top:8px">
        ${collections.map((c) => `<button class="chip ${coll === c ? 'on' : ''}" data-act="lc" data-v="${esc(c)}">${icon('folder')}${esc(c)}</button>`).join('')}
        <button class="chip" data-act="new-collection">${icon('plus')}Collection</button>
      </div>
      <div class="lib-tools">
        <button class="btn small" data-act="import">${icon('upload')}Import PDF</button>
        <button class="btn small" data-act="export" ${saved.size ? '' : 'disabled'}>${icon('download')}Export</button>
      </div>
      <div id="lib">${items.length ? items.map((a) => libCard(a)).join('') : `<div class="empty">${icon('bookmark')}<b>${saved.size ? 'Nothing matches' : 'Your library is empty'}</b>
        <div>${saved.size ? 'Try another filter.' : 'Save papers from search, or import PDFs you already have. Everything here works offline.'}</div></div>`}</div>`;

    let t;
    $('#lq').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => nav({ q: e.target.value }), 300); });
    if (p.q) { const i = $('#lq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
    actions.lf = (b) => nav({ f: b.dataset.v === 'all' ? '' : b.dataset.v });
    actions.lc = (b) => nav({ c: coll === b.dataset.v ? '' : b.dataset.v });
    actions.import = () => Native.importPdf();
    actions.export = () => exportSheet(items.length ? items : [...saved.values()]);
    actions['new-collection'] = () => newCollection(() => render());
  }

  function libCard(a) {
    const st = { unread: '', reading: '<span class="badge b-review">Reading</span>', read: '<span class="badge">Read</span>' }[a.status] || '';
    return `<div class="card" role="button" tabindex="0" data-act="${a.imported ? 'open-imported' : 'open'}" data-id="${esc(a.id)}">
      <p class="title main">${esc(a.title)}</p>
      <div class="byline"><span>${esc(a.jAbbr || a.journal || '')}${a.year ? ' · ' + esc(a.year) : ''}</span>
        ${a.notes ? `<span class="dot">${icon('note').replace('<svg', '<svg style="width:13px;height:13px;display:inline;vertical-align:-2px"')} notes</span>` : ''}</div>
      <div class="badges">${st}${badgesFor(a, { compact: true })}${a.fullText ? `<span class="badge b-review">${icon('book')}Full text offline</span>` : ''}
        ${(a.collections || []).map((c) => `<span class="badge">${esc(c)}</span>`).join('')}</div>
      ${a.imported ? '' : `<div class="card-actions">${pdfAction(a)}</div>`}</div>`;
  }

  // ---------------------------------------------------------------- citations & export
  const authorList = (a) => (a.authors || '').replace(/\.$/, '').split(/,\s*/).filter(Boolean);
  function vancouver(a) {
    const au = authorList(a);
    const names = au.length > 6 ? au.slice(0, 6).join(', ') + ', et al' : au.join(', ');
    return `${names ? names + '. ' : ''}${a.title}. ${a.jAbbr || a.journal}. ${a.year}${a.volume ? ';' + a.volume : ''}${a.issue ? '(' + a.issue + ')' : ''}${a.pages ? ':' + a.pages : ''}.${a.doi ? ' doi:' + a.doi : ''}${a.pmid ? ' PMID: ' + a.pmid + '.' : ''}`;
  }
  function apa(a) {
    const au = authorList(a).map((n) => { const [last, ini = ''] = n.split(/\s+(?=[A-Z]+$)/); return `${last}, ${ini.split('').join('. ')}${ini ? '.' : ''}`; });
    const names = au.length > 20 ? au.slice(0, 19).join(', ') + ', … ' + au[au.length - 1] : au.length > 1 ? au.slice(0, -1).join(', ') + ', & ' + au[au.length - 1] : au[0] || '';
    return `${names} (${a.year}). ${a.title}. ${a.journal}${a.volume ? ', ' + a.volume : ''}${a.issue ? '(' + a.issue + ')' : ''}${a.pages ? ', ' + a.pages : ''}.${a.doi ? ' https://doi.org/' + a.doi : ''}`;
  }
  function bibtex(a) {
    const key = ((authorList(a)[0] || 'anon').split(' ')[0] + a.year + (a.title.split(/\W+/).find((w) => w.length > 3) || '')).replace(/[^A-Za-z0-9]/g, '');
    const f = { title: `{${a.title}}`, author: authorList(a).join(' and '), journal: a.journal, year: a.year, volume: a.volume, number: a.issue, pages: a.pages, doi: a.doi, pmid: a.pmid };
    return `@article{${key},\n` + Object.entries(f).filter(([, v]) => v).map(([k, v]) => `  ${k} = {${String(v).replace(/[{}]/g, '')}}`).join(',\n') + '\n}';
  }
  function ris(a) {
    const l = ['TY  - JOUR', `TI  - ${a.title}`, ...authorList(a).map((n) => `AU  - ${n}`), `JO  - ${a.journal}`, `JA  - ${a.jAbbr || ''}`, `PY  - ${a.year}`];
    if (a.volume) l.push(`VL  - ${a.volume}`);
    if (a.issue) l.push(`IS  - ${a.issue}`);
    if (a.pages) l.push(`SP  - ${a.pages}`);
    if (a.doi) l.push(`DO  - ${a.doi}`);
    if (a.pmid) l.push(`AN  - ${a.pmid}`);
    if (a.abstract) l.push(`AB  - ${stripTags(a.abstract)}`);
    if (a.notes) l.push(`N1  - ${a.notes.replace(/\n/g, ' ')}`);
    return l.join('\n') + '\nER  - ';
  }
  function csv(items) {
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const cols = ['title', 'authors', 'journal', 'year', 'doi', 'pmid', 'status', 'notes'];
    return [cols.join(','), ...items.map((a) => cols.map((c) => cell(a[c])).join(','))].join('\n');
  }

  function citeSheet(items) {
    const a = items[0];
    const fmts = { Vancouver: vancouver(a), APA: apa(a), BibTeX: bibtex(a) };
    sheet(`<h3>Cite</h3>${Object.entries(fmts).map(([k, v]) => `<label class="field">${k}</label>
      <div class="panel" style="margin:0;font-size:13.5px;white-space:pre-wrap;word-break:break-word">${esc(v)}</div>
      <button class="btn small" style="margin-top:6px" data-act="copy-cite" data-f="${k}">${icon('quote')}Copy ${k}</button>`).join('')}`);
    actions['copy-cite'] = (b) => { Native.copy(fmts[b.dataset.f]); closeSheet(); };
  }

  function exportSheet(items) {
    const stamp = new Date().toISOString().slice(0, 10);
    sheet(`<h3>Export ${items.length} papers</h3>
      <button class="opt" data-act="exp" data-f="ris">${icon('file')}RIS — Zotero, Mendeley, EndNote</button>
      <button class="opt" data-act="exp" data-f="bib">${icon('file')}BibTeX</button>
      <button class="opt" data-act="exp" data-f="csv">${icon('list')}CSV spreadsheet</button>
      <button class="opt" data-act="exp" data-f="txt">${icon('quote')}Reference list (Vancouver)</button>`);
    const real = items.filter((a) => !a.imported);
    actions.exp = (b) => {
      const f = b.dataset.f;
      const out = {
        ris: [real.map(ris).join('\n\n'), 'application/x-research-info-systems'],
        bib: [real.map(bibtex).join('\n\n'), 'application/x-bibtex'],
        csv: [csv(real), 'text/csv'],
        txt: [real.map((a, i) => `${i + 1}. ${vancouver(a)}`).join('\n'), 'text/plain'],
      }[f];
      Native.exportText(`dermscholar-${stamp}.${f}`, out[0], out[1]);
      closeSheet();
    };
  }

  function collectionSheet(id) {
    const s = saved.get(id);
    const draw = () => sheet(`<h3>Collections</h3>
      ${collections.map((c) => `<button class="opt" data-act="toggle-coll" data-c="${esc(c)}">${icon('folder')}${esc(c)}${(s.collections || []).includes(c) ? `<span class="chk">${icon('check')}</span>` : ''}</button>`).join('')}
      <button class="opt" data-act="new-collection">${icon('plus')}New collection</button>`);
    actions['toggle-coll'] = async (b) => {
      const c = b.dataset.c;
      const set = new Set(s.collections || []);
      set.has(c) ? set.delete(c) : set.add(c);
      await updateSaved(id, { collections: [...set] });
      draw();
    };
    actions['new-collection'] = () => newCollection(draw);
    draw();
    onSheetClose = () => { if (current.name === 'a') render(); };
  }

  function newCollection(after) {
    sheet(`<h3>New collection</h3><form data-form="coll"><input type="text" name="n" placeholder="e.g. Psoriasis biologics" autocomplete="off">
      <div class="actions"><button type="button" class="btn" data-act="close-sheet">Cancel</button><button class="btn primary">Create</button></div></form>`);
    const input = $('.sheet input'); setTimeout(() => input.focus(), 50);
    $('[data-form=coll]').addEventListener('submit', (e) => {
      e.preventDefault();
      const n = input.value.trim();
      if (n && !collections.includes(n)) { collections.push(n); store.set('collections', collections); }
      after();
    });
  }

  // ---------------------------------------------------------------- settings
  function renderSettings() {
    const pdfCount = pdfKeys.size;
    const mb = (Number(Native.storageBytes()) / 1048576).toFixed(1);
    const sw = (k, title, sub) => `<div class="setting"><div class="body"><b>${title}</b><span>${sub}</span></div>
      <label class="switch"><input type="checkbox" data-set="${k}" ${settings[k] ? 'checked' : ''}><span></span></label></div>`;
    view.innerHTML = `${topbar('Settings')}
      <div class="section"><div class="section-h"><h3>Search</h3></div>
        ${sw('derm', 'Dermatology focus by default', 'Limit results to skin-related papers')}
        ${sw('preprints', 'Include preprints', 'Show papers that are not yet peer reviewed')}
        <div class="setting"><div class="body"><b>Default sort</b><span>${esc(SORTS[settings.sort].label)}</span></div>
          <button class="btn small" data-act="set-sort">Change</button></div></div>
      <div class="section"><div class="section-h"><h3>Research4Life</h3></div>
        ${(() => { const acc = r4lAccount(); return `<div class="setting"><div class="body"><b>${acc.saved ? 'Signed in as ' + esc(acc.user) : 'Not saved'}</b>
          <span>${acc.saved ? 'The app signs in for you when you tap Get PDF.' : 'Save your R4L sign-in so Get PDF works in one tap.'}</span></div>
          <button class="btn small" data-act="r4l-account">${acc.saved ? 'Change' : 'Save sign-in'}</button></div>
          <div class="row" style="gap:8px;margin-top:10px"><button class="btn small" data-act="r4l-open" style="flex:1">${icon('key')}Open Research4Life</button>
          ${acc.saved ? `<button class="btn small" data-act="r4l-forget" style="flex:1">${icon('trash')}Forget sign-in</button>` : ''}</div>`; })()}</div>
      <div class="section"><div class="section-h"><h3>Appearance</h3></div>
        <div class="seg">${['system', 'light', 'dark'].map((t) => `<button class="${settings.theme === t ? 'on' : ''}" data-act="theme" data-t="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div></div>
      <div class="section"><div class="section-h"><h3>Storage</h3></div>
        <div class="stats" style="margin-top:0"><div class="stat"><b>${saved.size}</b><span>Saved papers</span></div>
          <div class="stat"><b>${pdfCount}</b><span>Offline PDFs</span></div><div class="stat"><b>${mb} MB</b><span>PDF storage</span></div></div>
        <div class="spacer"></div>
        <button class="btn small" data-act="clear-history">Clear search history</button></div>
      <div class="section"><div class="section-h"><h3>About</h3></div>
        <p class="small muted">DermScholar ${esc(Native.version())}. Paper data from <b>Europe PMC</b> (PubMed, PMC and more); journal metrics from <b>OpenAlex</b>.
        "Key finding" is taken from each abstract's own conclusion. It is not a medical recommendation. Paywalled full text is available through your
        <b>Research4Life</b> sign-in.</p></div>`;
    $$('[data-set]').forEach((el) => el.addEventListener('change', () => { settings[el.dataset.set] = el.checked; saveSettings(); searchCache.clear(); }));
    actions['set-sort'] = () => pickOne('Default sort', Object.fromEntries(Object.entries(SORTS).map(([k, v]) => [k, v.label])), settings.sort, (v) => { settings.sort = v; saveSettings(); render(); });
    actions.theme = (b) => { settings.theme = b.dataset.t; saveSettings(); applyTheme(); render(); };
  }

  function applyTheme() {
    const dark = settings.theme === 'dark' || (settings.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

  // ---------------------------------------------------------------- sheets & toast
  let onSheetClose = null;
  function sheet(html) {
    closeSheet(true);
    document.body.insertAdjacentHTML('beforeend', `<div class="sheet-bg" data-act="close-sheet"></div><div class="sheet"><div class="grab"></div>${html}</div>`);
  }
  function closeSheet(silent) {
    const had = $('.sheet');
    $$('.sheet, .sheet-bg').forEach((e) => e.remove());
    if (had && !silent && onSheetClose) { const f = onSheetClose; onSheetClose = null; f(); }
  }
  function pickOne(title, options, value, cb) {
    sheet(`<h3>${esc(title)}</h3>${Object.entries(options).map(([k, l]) => `<button class="opt" data-act="pick" data-v="${esc(k)}">${esc(l)}${k === value ? `<span class="chk">${icon('check')}</span>` : ''}</button>`).join('')}`);
    actions.pick = (b) => { closeSheet(true); cb(b.dataset.v); };
  }
  function pickMany(title, options, values, cb) {
    const sel = new Set(values);
    const draw = () => sheet(`<h3>${esc(title)}</h3>${Object.entries(options).map(([k, l]) => `<button class="opt" data-act="pickm" data-v="${esc(k)}">${esc(l)}${sel.has(k) ? `<span class="chk">${icon('check')}</span>` : ''}</button>`).join('')}
      <div class="actions"><button class="btn" data-act="pickm-clear">Clear</button><button class="btn primary" data-act="pickm-done">Apply</button></div>`);
    actions.pickm = (b) => { sel.has(b.dataset.v) ? sel.delete(b.dataset.v) : sel.add(b.dataset.v); draw(); };
    actions['pickm-clear'] = () => { closeSheet(true); cb([]); };
    actions['pickm-done'] = () => { closeSheet(true); cb([...sel]); };
    draw();
  }
  let toastTimer;
  function toast(msg) {
    $('.toast')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="toast">${esc(msg)}</div>`);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('.toast')?.remove(), 2600);
  }

  // ---------------------------------------------------------------- global actions
  const actions = {
    back: () => App.back(),
    home: () => go(''),
    settings: () => go('settings'),
    retry: () => { searchCache.clear(); render(); },
    tab: (b) => switchTab(b.dataset.tab),
    'close-sheet': () => closeSheet(),
    open: (b) => go('a/' + encodeURIComponent(b.dataset.id)),
    'open-imported': (b) => { const a = saved.get(b.dataset.id); Native.openPdf(a.id, a.title); },
    'card-pdf': (b) => { const a = saved.get(b.dataset.id) || cache.get(b.dataset.id); if (a) getPdf(a); },
    'card-save': async (b) => {
      const id = b.dataset.id;
      if (saved.has(id)) { go('a/' + encodeURIComponent(id)); return; }
      const a = cache.get(id);
      if (!a) return;
      await saveArticle(a);
      b.classList.add('good');
      b.innerHTML = `${icon('bookmarkFill')}Saved`;
      toast('Saved to library');
      if (a.pmcid && (a.oa || a.inPMC)) cacheFullText(a).catch(() => {});
    },
    'r4l-account': () => r4lSignInSheet(null),
    'r4l-forget': () => { Native.r4lForget(); toast('Research4Life sign-in removed'); render(); },
    'r4l-open': () => Native.openPortal(PORTAL, '', ''),
    ask: (b) => go(searchHash(filtersFrom({ q: b.dataset.q }))),
    topic: (b) => go(searchHash({ ...filtersFrom({ q: b.dataset.q }), sort: 'newest', years: '2' })),
    quick: (b) => {
      const q = $('[data-form=search] textarea')?.value.trim();
      if (!q) { toast('Type a question first'); $('[data-form=search] textarea')?.focus(); return; }
      go(searchHash({ ...filtersFrom({ q }), types: b.dataset.types.split(',') }));
    },
    'toggle-derm': (b) => { settings.derm = !settings.derm; saveSettings(); b.classList.toggle('on', settings.derm); toast(settings.derm ? 'Dermatology focus on' : 'Searching all of medicine'); },
    'clear-history': () => { recent = []; store.set('history', []); render(); },
    journal: (b) => go('j/' + encodeURIComponent(b.dataset.abbr)),
    follow: (b) => {
      const abbr = b.dataset.abbr;
      follows = follows.includes(abbr) ? follows.filter((x) => x !== abbr) : [...follows, abbr];
      store.set('follows', follows);
      const on = follows.includes(abbr);
      $$(`[data-act=follow][data-abbr="${CSS.escape(abbr)}"]`).forEach((s) => { s.classList.toggle('on', on); s.innerHTML = icon(on ? 'starFill' : 'star'); });
      toast(on ? 'Following — new articles appear on Search' : 'Unfollowed');
    },
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const fn = actions[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el, e); }
  });
  document.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-form=search]');
    if (!form) return;
    e.preventDefault();
    const q = form.q.value.trim();
    if (q) go(searchHash(filtersFrom({ q, ...(current.name === 'search' ? { ...current.params, q } : {}) })));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && e.target.matches('.searchbox textarea')) {
      e.preventDefault();
      e.target.form.requestSubmit();
    }
  });
  document.addEventListener('input', (e) => {
    if (e.target.matches('.searchbox textarea')) { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }
  });

  function switchTab(tab) {
    if (tab === 'portal') { Native.openPortal(PORTAL, '', ''); return; }
    const target = { search: '', journals: 'journals', library: 'library' }[tab];
    if (parseHash().name === (target || 'home')) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    go(target);
  }
  $$('#nav button').forEach((b) => {
    b.querySelector('[data-icon]').innerHTML = icon(b.querySelector('[data-icon]').dataset.icon);
    b.addEventListener('click', () => switchTab(b.dataset.tab));
  });

  // ---------------------------------------------------------------- native bridge
  window.App = {
    back() {
      if ($('.sheet')) { closeSheet(); return true; }
      const name = parseHash().name;
      if (depth > 0) { depth--; window.history.back(); return true; }
      if (name !== 'home') { location.replace('#/'); return true; }
      return false;
    },
    async onResume() {
      const before = pdfKeys.size;
      const added = await syncPdfs();
      if (added || pdfKeys.size !== before) {
        if (added) toast(`${added} PDF${added > 1 ? 's' : ''} added to your library`);
        if (current.name === 'library' && added) render(); else refreshCards();
      }
    },
    async onNative(evt) {
      if (evt.type === 'pdfSaved') {
        pdfKeys.add(evt.key);
        toast('PDF saved to your library');
        if (['a', 'library', 'search', 'j', 'home'].includes(current.name)) refreshCards();
      } else if (evt.type === 'pdfFailed') {
        toast(evt.message);
      } else if (evt.type === 'pdfImported') {
        await syncPdfs();
        toast('PDF imported');
        if (current.name === 'library') render(); else go('library');
      }
    },
  };

  // ---------------------------------------------------------------- start
  applyTheme();
  (async () => {
    try { await loadSaved(); await syncPdfs(); } catch { /* library unavailable */ }
    render();
  })();
})();
