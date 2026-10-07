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
  const stubVoices = () => JSON.stringify([
    { id: 'kokoro-en', label: 'Studio voices (Kokoro)', desc: '11 very natural US and UK voices.', sizeMb: 103, lang: 'en', type: 'kokoro', installed: !!localStorage.getItem('ds.stub.voice.kokoro-en'),
      speakers: ['Default|female|US', 'Bella|female|US', 'Nicole|female|US', 'Sarah|female|US', 'Sky|female|US', 'Adam|male|US', 'Michael|male|US', 'Emma|female|UK', 'Isabella|female|UK', 'George|male|UK', 'Lewis|male|UK'].map((x) => { const [name, gender, accent] = x.split('|'); return { name, gender, accent }; }) },
    { id: 'piper-ryan', label: 'Ryan', desc: 'Warm US male narrator.', sizeMb: 34, lang: 'en', type: 'vits', installed: !!localStorage.getItem('ds.stub.voice.piper-ryan'), speakers: [] },
    { id: 'piper-priyamvada', label: 'Priyamvada (Hindi)', desc: 'Hindi female voice.', sizeMb: 21, lang: 'hi', type: 'vits', installed: false, speakers: [] }]);
  // In the browser: the web build's bridge (web.js) where it has one, else development stubs.
  const Native = hasNative ? window.Native : Object.assign({
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
    cancelFetch: () => {}, showFetchPage: () => {}, openPdfPages: () => toast('Needs the Android app'),
    r4lAccount: () => JSON.stringify({ user: localStorage.getItem('ds.r4lUser') || '', saved: !!localStorage.getItem('ds.r4lUser') }),
    r4lSetCredentials: (u) => localStorage.setItem('ds.r4lUser', u),
    r4lForget: () => localStorage.removeItem('ds.r4lUser'),
    account: (p) => JSON.stringify({ user: localStorage.getItem('ds.acc.' + p) || '', saved: !!localStorage.getItem('ds.acc.' + p) }),
    setCredentials: (p, u) => localStorage.setItem('ds.acc.' + p, u),
    forgetCredentials: (p) => localStorage.removeItem('ds.acc.' + p),
    utdSearch: (q) => setTimeout(() => App.onNative(window.__utdMock ? window.__utdMock('search', q) : { type: 'utdResults', state: 'error', message: 'UpToDate needs the Android app' }), 300),
    utdShowPage: () => {},
    setPendingPdf: () => {}, consumeReceived: () => '[]',
    pickDocument: () => toast('Needs the Android app'), takePhoto: () => toast('Needs the Android app'),
    fetchPage: (id) => setTimeout(() => App.onNative(window.__pageMock ? window.__pageMock(id) : { type: 'pageFetched', id, error: 'Needs the Android app' }), 200),
    ocrImport: (id) => setTimeout(() => App.onNative(window.__ocrMock ? { type: 'ocr', id, result: window.__ocrMock() } : { type: 'ocr', id, error: 'Needs the Android app' }), 200),
    ocrPage: (id) => setTimeout(() => App.onNative(window.__ocrMock ? { type: 'ocr', id, result: window.__ocrMock() } : { type: 'ocr', id, error: 'Needs the Android app' }), 200),
    deleteImport: () => {},
    listAccounts: (p) => JSON.stringify(JSON.parse(localStorage.getItem('ds.accs.' + p) || '[]')),
    setActiveAccount: (p, u) => localStorage.setItem('ds.accs.' + p, JSON.stringify(JSON.parse(localStorage.getItem('ds.accs.' + p) || '[]').map((a) => ({ ...a, active: a.user === u })))),
    removeAccount: (p, u) => localStorage.setItem('ds.accs.' + p, JSON.stringify(JSON.parse(localStorage.getItem('ds.accs.' + p) || '[]').filter((a) => a.user !== u))),
    ...(() => {
      let t = null, i = 0, n = 0;
      const tick = () => { App.onNative({ type: 'tts', state: 'playing', index: i, total: n }); t = setTimeout(() => { if (++i >= n) { App.onNative({ type: 'tts', state: 'ended', index: n - 1, total: n }); return; } tick(); }, 900); };
      return {
        ttsStart: (title, items, start) => { clearTimeout(t); n = JSON.parse(items).length; i = start; tick(); },
        ttsToggle: () => { if (t) { clearTimeout(t); t = null; App.onNative({ type: 'tts', state: 'paused', index: i, total: n }); } else tick(); },
        ttsSeek: (k) => { clearTimeout(t); i = k; tick(); }, ttsSkip: (d) => { clearTimeout(t); i = Math.max(0, Math.min(n - 1, i + d)); tick(); },
        ttsRate: () => {}, ttsVoice: () => {}, ttsPause: () => { clearTimeout(t); t = null; App.onNative({ type: 'tts', state: 'paused', index: i, total: n }); },
        listen: () => setTimeout(() => App.onNative(window.__speechMock ? { type: 'speech', text: window.__speechMock() } : { type: 'speech', error: 'Voice input needs the Android app' }), 200),
        ttsStop: () => { clearTimeout(t); t = null; App.onNative({ type: 'tts', state: 'stopped', index: i, total: n }); },
        aiHasKey: () => !!localStorage.getItem('ds.stub.aikey'),
        aiSetKey: (k) => (k ? localStorage.setItem('ds.stub.aikey', k) : localStorage.removeItem('ds.stub.aikey')),
        aiRun: (id, system, doc, task, max, schema) => setTimeout(() => {
          const fail = window.__aiFail && window.__aiFail(task, doc, max);
          if (fail) { App.onNative({ type: 'ai', id, state: 'error', message: fail }); return; }
          const text = window.__aiMock ? window.__aiMock(task, schema, doc) : 'AI needs the Android app';
          App.onNative({ type: 'ai', id, state: 'done', text });
        }, 300),
        aiModel: () => localStorage.getItem('ds.stub.model') || 'openai/gpt-oss-120b',
        aiProvider: () => localStorage.getItem('ds.stub.provider') || 'groq',
        aiSetProvider: (p) => localStorage.setItem('ds.stub.provider', p),
        aiHasKeyFor: () => !!localStorage.getItem('ds.stub.aikey'),
        aiListModels: () => setTimeout(() => App.onNative({ type: 'aiModels', models: [{ id: 'openai/gpt-oss-120b' }, { id: 'openai/gpt-oss-20b' }, { id: 'qwen/qwen3.8-27b' }] }), 100),
        aiSetModel: (m) => localStorage.setItem('ds.stub.model', m),
        aiUsage: () => JSON.stringify({ [new Date().toISOString().slice(0, 7)]: { 'claude-opus-5': [120000, 8000, 300000, 6] } }),
        ttsSleep: () => {}, ttsStopAfter: () => {}, ttsSubtitle: () => {}, ttsSleepLeft: () => 0,
        ttsPreview: () => {}, ttsEngine: () => {}, ttsWarm: () => {},
        ttsVoices: () => JSON.stringify({ ready: true, engines: [], voices: [{ name: 'en-us-x-sfg-local', locale: 'English (United States)', quality: 400, network: false }], neural: JSON.parse(stubVoices()) }),
        voiceCatalog: () => stubVoices(),
        voiceDownload: (id) => { let p = 0; const t = setInterval(() => { p += 25; if (p <= 100) App.onNative({ type: 'voiceProgress', id, pct: p, stage: p < 100 ? 'Downloading' : 'Unpacking' }); else { clearInterval(t); localStorage.setItem('ds.stub.voice.' + id, '1'); App.onNative({ type: 'voiceReady', id }); } }, 150); },
        voiceDelete: (id) => localStorage.removeItem('ds.stub.voice.' + id),
        ttsStatus: () => JSON.stringify({ playing: !!t, index: i, total: n }),
      };
    })(),
    utdTopic: (u) => setTimeout(() => App.onNative(window.__utdMock ? window.__utdMock('topic', u) : { type: 'utdTopic', state: 'error', message: 'UpToDate needs the Android app' }), 300),
    openUpToDateAt: (u) => window.open(u, '_blank'),
    openUpToDate: (q) => window.open('https://www.uptodate.com/contents/search' + (q ? '?search=' + encodeURIComponent(q) : ''), '_blank'),
  }, window.WebNative || {});
  function copyText(t) { navigator.clipboard?.writeText(t); toast('Copied'); }

  const EPMC = hasNative ? '/proxy/epmc/' : 'https://www.ebi.ac.uk/europepmc/webservices/rest/';
  const OPENALEX = hasNative ? '/proxy/openalex/' : 'https://api.openalex.org/';
  const PORTAL = 'https://portal.research4life.org/signin';

  // Title/abstract terms that keep results dermatological.
  const DERM_FILTER = '(TITLE_ABS:skin OR TITLE_ABS:cutaneous OR TITLE_ABS:dermatolog* OR TITLE_ABS:dermatitis OR TITLE_ABS:dermal OR TITLE_ABS:epiderm* OR TITLE_ABS:mucocutaneous)';
  // Queries already about skin disease don't need the filter.
  const DERM_WORDS = /\b(dermat\w*|skin|cutaneous|psoria\w*|eczema|vitiligo|acne|melasma|alopecia|urticaria|pemphig\w*|melanoma|hidradenitis|rosacea|lichen|tinea|dermatophyt\w*|scabies|lepros\w*|leprae|keloid|pigment\w*|nev(us|i)|naev\w*|mycosis fungoides|onychomycosis|wart|vulgaris|pruritus|itch|hyperhidrosis|keratos\w*|basal cell|squamous cell|seborrh\w*|intertrigo|impetigo|cellulitis|lupus|morphea|scleroderma|bullous|epidermolysis|ichthyosis|hair|nail|sunscreen|photoaging|isotretinoin|dupilumab|minoxidil)\b/i;

  const STOP = new Set('a an the of in on for to with and or is are was were be been does do did can could should would will what which who whom whose how why when where there any some this that these those than then vs versus compared comparison between among about into from by as at it its effect effects effective effectiveness efficacy role use using used study studies evidence patients patient people adults treatment treat treating therapy improve improves improvement reduce reduces better best whats thats theres new newer newest latest recent recently emerging novel update updates updated advances advance current insights insight overview know tell me explain explained understanding'.split(' '));
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
    refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 4v5h-5"/>',
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
    dots: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
    zoom: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M11 8v6M8 11h6"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/>',
    audio: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>',
    play: '<path d="M8 5v14l11-7z" fill="currentColor"/>',
    pause: '<path d="M7 5h3v14H7zM14 5h3v14h-3z" fill="currentColor"/>',
    prev: '<path d="M6 5v14M18 6l-9 6 9 6z"/>',
    next: '<path d="M18 5v14M6 6l9 6-9 6z"/>',
    back15: '<path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6"/><path d="M4 4v4.6h4.6"/><text x="12.2" y="15.6" font-size="7.5" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none">15</text>',
    fwd30: '<path d="M20 12a8 8 0 1 1-2.3-5.7L20 8.6"/><path d="M20 4v4.6h-4.6"/><text x="11.8" y="15.6" font-size="7.5" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none">30</text>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    type: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 10h8M8 13h5"/>',
    cards: '<rect x="3" y="7" width="13" height="13" rx="2"/><path d="M8 4h11a2 2 0 0 1 2 2v11"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    people: '<circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2 20c0-3.5 2.7-6 6-6s6 2.5 6 6M14 20c.3-2.8 1.8-5 4-5 2.3 0 4 2 4 5"/>',
    highlight: '<path d="m15 4 5 5-9 9H6v-5z"/><path d="M4 21h16"/>',
    translate: '<path d="M4 5h9M8.5 3v2c0 4-2 7-5 9M6 9c1.5 2.5 3.5 4 6 5"/><path d="m12 21 4.5-10 4.5 10M13.5 18h6"/>',
    school: '<path d="m2 9 10-5 10 5-10 5z"/><path d="M6 11v5c3 2.5 9 2.5 12 0v-5M22 9v6"/>',
  };
  const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`;
  const LOGO = '<svg class="brand-mark" viewBox="0 0 48 48" aria-hidden="true"><defs><linearGradient id="lg-bg" x1="6" y1="4" x2="42" y2="44" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#7C3AED"/><stop offset=".55" stop-color="#DB2777"/><stop offset="1" stop-color="#F59E0B"/></linearGradient><linearGradient id="lg-lens" x1="16" y1="11" x2="30" y2="31" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#0E7490"/><stop offset="1" stop-color="#134E4A"/></linearGradient></defs><circle cx="24" cy="24" r="22" fill="url(#lg-bg)"/><g transform="translate(2,0)"><path d="M20 34l5.5 8.5" stroke="#fff" stroke-width="5" stroke-linecap="round"/><path fill="#fff" d="M12 8h9.5a13 13 0 1 1 0 26H12z"/><path fill="url(#lg-lens)" d="M15.5 11.5h6a9.5 9.5 0 1 1 0 19h-6z"/><path fill="#F59E0B" d="M27.1 10.4a.95.95 0 1 1 0 1.9.95.95 0 1 1 0-1.9zM31.2 14.45a.95.95 0 1 1 0 1.9.95.95 0 1 1 0-1.9zM32.75 20.05a.95.95 0 1 1 0 1.9.95.95 0 1 1 0-1.9zM31.2 25.65a.95.95 0 1 1 0 1.9.95.95 0 1 1 0-1.9zM27.1 29.75a.95.95 0 1 1 0 1.9.95.95 0 1 1 0-1.9z"/><path fill="#fff" d="M16.8 16.8c2.2-.9 4.2-.7 5.6.6v8.4c-1.4-1.1-3.4-1.3-5.6-.6zM29.2 16.8c-2.2-.9-4.2-.7-5.6.6v8.4c1.4-1.1 3.4-1.3 5.6-.6z"/></g></svg>';

  // ---------------------------------------------------------------- local state
  // Extension points filled in by studio.js (import, player, AI studio, study, notes).
  const ext = { routes: {}, events: {} };
  const store = {
    get(k, d) { try { const v = localStorage.getItem('ds.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('ds.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };
  const settings = Object.assign({ derm: true, preprints: false, theme: 'system', sort: 'relevance', accent: 'ocean', bgLight: 'white', bgDark: 'graphite', showR4L: false, showUTD: false }, store.get('settings', {}));
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
          const req = indexedDB.open('dermscholar', 2);
          req.onupgradeneeded = () => {
            const d = req.result;
            if (!d.objectStoreNames.contains('articles')) d.createObjectStore('articles', { keyPath: 'id' });
            if (!d.objectStoreNames.contains('reflow')) d.createObjectStore('reflow', { keyPath: 'key' });
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch { resolve(null); }
      });
      return dbp;
    }
    async function tx(mode, fn, storeName = 'articles') {
      const d = await open();
      if (!d) { const r = fn(null); return r && typeof r === 'object' && 'result' in r ? r.result : r; }
      return new Promise((resolve, reject) => {
        const t = d.transaction(storeName, mode);
        const r = fn(t.objectStore(storeName));
        t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
        t.onerror = () => reject(t.error);
      });
    }
    return {
      async all() { return (await tx('readonly', (s) => (s ? s.getAll() : { result: [...mem.values()] }))) || []; },
      async get(id) { return tx('readonly', (s) => (s ? s.get(id) : { result: mem.get(id) })); },
      async put(o) { return tx('readwrite', (s) => (s ? s.put(o) : mem.set(o.id, o))); },
      async del(id) { return tx('readwrite', (s) => (s ? s.delete(id) : mem.delete(id))); },
      async getReflow(k) { return tx('readonly', (s) => (s ? s.get(k) : { result: mem.get('r:' + k) }), 'reflow'); },
      async putReflow(o) { return tx('readwrite', (s) => (s ? s.put(o) : mem.set('r:' + o.key, o)), 'reflow'); },
      async delReflow(k) { return tx('readwrite', (s) => (s ? s.delete(k) : mem.delete('r:' + k)), 'reflow'); },
      async allReflow() { return (await tx('readonly', (s) => (s ? s.getAll() : { result: [...mem.entries()].filter(([k]) => String(k).startsWith('r:')).map(([, v]) => v) }), 'reflow')) || []; },
    };
  })();

  let saved = new Map(); // id -> saved article
  let pdfKeys = new Set();
  const cache = new Map(); // id -> article seen in results
  const searchCache = new Map(); // route key -> {results, next, hit, broad}
  const jobs = new Map(); // article id -> {title, doi, state: running|saved|failed, message, canShow}
  let retryAfterPage = null; // paper to fetch again when the user comes back from "Show page"
  // A job that hears nothing for 2 minutes is stuck: say so and offer the page, never spin forever.
  setInterval(() => {
    let changed = false;
    for (const [k, j] of jobs) {
      if (j.state === 'running' && Date.now() - (j.at || Date.now()) > 120000) {
        jobs.set(k, { ...j, state: 'failed', canShow: true, message: `Stopped at “${j.message}”. Tap Show page to finish there; the app retries when you come back.` });
        changed = true;
      } else if (j.state === 'running' && !j.at) j.at = Date.now();
    }
    if (changed) { renderTray(); refreshCards(); }
  }, 10000);

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
      issn: jj.issn || (r.journalIssn || '').split(';')[0].trim(), essn: jj.essn || (r.journalIssn || '').split(';')[1]?.trim() || '',
      year: r.pubYear || '', date: r.firstPublicationDate || '', pubDate: j.dateOfPublication || '',
      volume: j.volume || r.journalVolume || '', issue: j.issue || r.issue || '', pages: r.pageInfo || '',
      citedBy: r.citedByCount || 0,
      oa: r.isOpenAccess === 'Y',
      inPMC: r.inPMC === 'Y' || !!r.pmcid,
      types: r.pubTypeList?.pubType || (r.pubType ? r.pubType.split(/;\s*/) : []),
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
    return text.replace(/\s+/g, ' ').trim().replace(/([.!?])\s+(?=[A-Z(\[])/g, '$1\n').split('\n').map((s) => s.trim()).filter((s) => s.length > 20);
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

  /**
   * Quality signals for a result: citations for its age, study size read from the abstract, and
   * whether it studied people, animals or cells (MeSH and abstract wording).
   */
  function quality(a) {
    if (a._q) return a._q;
    const age = Math.max(0.5, THIS_YEAR - (Number(a.year) || THIS_YEAR) + 0.5);
    const per = (a.citedBy || 0) / age;
    const cited = a.citedBy >= 500 || (per >= 60 && a.citedBy >= 30) ? 'Very highly cited' : a.citedBy >= 100 || (per >= 15 && a.citedBy >= 10) ? 'Highly cited' : '';
    const abs = stripTags(a.abstract || '').replace(/(\d),(\d{3})/g, '$1$2');
    let n = 0;
    const who = '(?:patients|participants|subjects|adults|children|adolescents|infants|individuals|women|men|people|persons|cases|volunteers|eyes|pregnancies|respondents|dermatologists)';
    for (const re of [new RegExp('\\b[nN]\\s*=\\s*(\\d{2,7})\\b', 'g'), new RegExp('\\b(\\d{2,7})\\s+(?:[a-z-]+\\s+){0,3}' + who + '\\b', 'gi')]) {
      for (const m of abs.matchAll(re)) { const v = Number(m[1]); if (v > n && v < 5e6 && !(v >= 1900 && v <= 2100)) n = v; }
    }
    const mesh = (a.mesh || []).join('|');
    const text = (a.title || '') + ' ' + abs;
    let pop = '';
    if (/\bHumans\b/.test(mesh)) pop = 'Human';
    else if (/\bAnimals\b|\bMice\b|\bRats\b/.test(mesh) || /\b(mice|murine|rats?|mouse model|zebrafish|porcine|canine)\b/i.test(text)) pop = 'Animal';
    else if (/\bin vitro\b|\bcell lines?\b|\bcultured (keratinocytes|fibroblasts|cells)\b/i.test(text) && !/\bpatients\b/i.test(text)) pop = 'In vitro';
    else if (n || /\bpatients\b|\bparticipants\b/i.test(text)) pop = 'Human';
    a._q = { cited, n: n >= 10 ? n : 0, pop: pop === 'Human' && !n && !/\bHumans\b/.test(mesh) ? '' : pop };
    return a._q;
  }

  function badgesFor(a, { compact = false } = {}) {
    const st = studyType(a);
    const b = [];
    if (st.label && st.label !== 'Study') b.push(`<span class="badge ${st.cls}">${esc(st.label)}</span>`);
    if (!a.imported) {
      const j = journalFor(a);
      if (j && j.top) b.push(`<span class="badge b-top">${icon('star')}Leading journal</span>`);
      const q = quality(a);
      if (q.cited) b.push(`<span class="badge b-cite">${icon('trend')}${q.cited}</span>`);
      if (q.n) b.push(`<span class="badge b-n">N = ${q.n.toLocaleString()}</span>`);
      if (q.pop) b.push(`<span class="badge b-pop ${q.pop === 'Human' ? '' : 'warn'}">${q.pop}</span>`);
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
  const T = (w) => '(' + w.map((x) => `TITLE_ABS:"${x}"`).join(' OR ') + ')';
  const DERM_X = {
    scalp: { g: 'Body site', label: 'Scalp & hair', q: T(['scalp', 'hair', 'alopecia']) },
    face: { g: 'Body site', label: 'Face', q: T(['face', 'facial']) },
    nails: { g: 'Body site', label: 'Nails', q: T(['nail', 'nails', 'onychomycosis']) },
    acral: { g: 'Body site', label: 'Hands & feet', q: T(['hand', 'hands', 'palmoplantar', 'foot', 'feet', 'acral']) },
    genital: { g: 'Body site', label: 'Genital', q: T(['genital', 'vulvar', 'penile', 'anogenital']) },
    oral: { g: 'Body site', label: 'Oral mucosa', q: T(['oral', 'mucosal', 'mucosa']) },
    soc: { g: 'Population', label: 'Skin of colour', q: T(['skin of color', 'skin of colour', 'Fitzpatrick', 'darker skin', 'phototype', 'African', 'Asian', 'Indian']) },
    peds: { g: 'Population', label: 'Paediatric', q: '(' + T(['children', 'pediatric', 'paediatric', 'infant', 'adolescent']) + ' OR MESH_HEADING:"Child")' },
    preg: { g: 'Population', label: 'Pregnancy', q: T(['pregnancy', 'pregnant', 'lactation']) },
    old: { g: 'Population', label: 'Elderly', q: '(' + T(['elderly', 'older adults', 'geriatric']) + ' OR MESH_HEADING:"Aged")' },
    high: { g: 'Evidence', label: 'High-level evidence only', q: '(PUB_TYPE:"Meta-Analysis" OR PUB_TYPE:"Systematic Review" OR PUB_TYPE:"Randomized Controlled Trial" OR PUB_TYPE:"Practice Guideline")' },
    laser: { g: 'Therapy', label: 'Laser & devices', q: T(['laser', 'IPL', 'intense pulsed light', 'radiofrequency', 'photodynamic', 'microneedling']) },
    bio: { g: 'Therapy', label: 'Biologics', q: T(['biologic', 'biologics', 'monoclonal antibody', 'dupilumab', 'secukinumab', 'ixekizumab', 'guselkumab', 'risankizumab', 'adalimumab', 'ustekinumab', 'omalizumab']) },
    jak: { g: 'Therapy', label: 'JAK inhibitors', q: T(['JAK inhibitor', 'Janus kinase', 'tofacitinib', 'baricitinib', 'upadacitinib', 'abrocitinib', 'ruxolitinib', 'ritlecitinib', 'deucravacitinib']) },
    retinoid: { g: 'Therapy', label: 'Retinoids', q: T(['retinoid', 'isotretinoin', 'acitretin', 'tretinoin', 'adapalene', 'tazarotene']) },
    systemic: { g: 'Therapy', label: 'Systemic immunosuppressants', q: T(['methotrexate', 'cyclosporine', 'ciclosporin', 'azathioprine', 'mycophenolate']) },
    topical: { g: 'Therapy', label: 'Topicals', q: T(['topical', 'cream', 'ointment']) },
    surgery: { g: 'Therapy', label: 'Surgery', q: T(['surgery', 'surgical', 'Mohs', 'excision', 'graft']) },
    cosmetic: { g: 'Therapy', label: 'Cosmetic', q: T(['cosmetic', 'aesthetic', 'botulinum', 'filler', 'chemical peel']) },
  };
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
    const words = q.replace(/[?!.,;]+/g, ' ').replace(/[“”]/g, '"').replace(/\b(what|that|it|there)['’]s\b/gi, '$1s').split(/\s+/).filter(Boolean);
    const kept = words.filter((w) => !STOP.has(w.toLowerCase()));
    if (!kept.length) return words.filter((w) => KEEP_WHEN_ALONE.has(w.toLowerCase()) || w.length > 2);
    return kept;
  }

  /**
   * A DOI, PMID, PMCID or a PubMed/doi.org link typed or pasted into search: the exact Europe PMC
   * query for that one paper (no filters), or null.
   */
  function idQuery(text) {
    const t = String(text || '').trim();
    const doi = t.match(/(?:doi\.org\/|doi:\s*)?(10\.\d{4,9}\/[^\s"<>]+)/i);
    if (doi) return `DOI:"${decodeURIComponent(doi[1]).replace(/[.,;)\]]+$/, '')}"`;
    const pmc = t.match(/\b(PMC\d{4,9})\b/i);
    if (pmc) return `PMCID:${pmc[1].toUpperCase()}`;
    const pm = t.match(/^(?:pmid:?\s*)?(\d{5,9})$/i) || t.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d{5,9})/i);
    if (pm) return `EXT_ID:${pm[1]} AND SRC:MED`;
    return null;
  }

  function buildQuery(f, { broad = false } = {}) {
    const raw = f.q.trim();
    const exact = idQuery(raw);
    if (exact) return exact;
    let core;
    if (isAdvanced(raw)) core = raw;
    else {
      const terms = keywordTerms(raw);
      core = broad ? terms.join(' OR ') : terms.join(' ');
    }
    const parts = [`(${core})`];
    if (f.derm && !DERM_WORDS.test(raw)) parts.push(DERM_FILTER);
    if (f.types.length) parts.push('(' + f.types.map((t) => TYPE_FILTERS[t].q).join(' OR ') + ')');
    const xg = {};
    for (const k of f.x || []) (xg[DERM_X[k].g] ||= []).push(DERM_X[k].q);
    for (const qs of Object.values(xg)) parts.push('(' + qs.join(' OR ') + ')');
    if (f.years !== 'any') parts.push(`PUB_YEAR:[${THIS_YEAR - Number(f.years) + 1} TO ${THIS_YEAR}]`);
    if (f.oa) parts.push('OPEN_ACCESS:y');
    let q = parts.join(' AND ');
    if (!f.preprints) q += ' NOT SRC:PPR';
    return q + ' ' + NOISE;
  }

  // ---------------------------------------------------------------- routing
  const view = $('#view');
  // How many in-app steps can be gone back: kept for the session, so a reload (after sync brings
  // something in) doesn't make Back forget the way.
  let depth = (() => { try { return +sessionStorage.getItem('ds.depth') || 0; } catch { return 0; } })();
  const setDepth = (n) => { depth = Math.max(0, n); try { sessionStorage.setItem('ds.depth', String(depth)); } catch { /* blocked */ } };
  let current = { name: '', params: {} };
  /** Where Back goes when there is no step to return to: the page above this one. */
  function parentOf(r) {
    if (r.name === 'ji') return 'j/' + encodeURIComponent(r.arg.split('/')[0]);
    if (r.name === 'j') return 'journals';
    const tab = TAB_OF[r.name];
    if (tab === 'intel' && r.name !== 'intel') return 'intel';
    if (tab === 'library' && r.name !== 'library') return 'library';
    if (r.name === 'a' || r.name === 'pdf' || r.name === 'read') return tabPlace.library && r.name !== 'a' ? 'library' : '';
    return '';
  }

  function parseHash() {
    const h = location.hash.replace(/^#\/?/, '');
    const [path, qs] = h.split('?');
    const seg = path.split('/').map(decodeURIComponent);
    return { name: seg[0] || 'home', arg: seg.slice(1).join('/'), params: Object.fromEntries(new URLSearchParams(qs || '')) };
  }
  function go(hash, { replace = false } = {}) {
    if (('#' + hash.replace(/^#/, '')) === location.hash) { render(); return; }
    if (replace) { location.replace('#' + hash.replace(/^#/, '')); return; }
    setDepth(depth + 1);
    location.hash = hash;
  }
  const searchHash = (f) => 'search?' + new URLSearchParams({
    q: f.q, derm: f.derm ? 1 : 0, types: f.types.join(','), ...(f.x?.length ? { x: f.x.join(',') } : {}), y: f.years, oa: f.oa ? 1 : 0, sort: f.sort, pp: f.preprints ? 1 : 0,
    ...(f.src === 'utd' ? { src: 'utd' } : {}),
  });
  const utdHash = (q) => 'search?' + new URLSearchParams({ q: q || '', src: 'utd' });

  window.addEventListener('hashchange', render);

  // ---------------------------------------------------------------- pull down to refresh
  // At the top of a list screen, pull down and let go to fetch it again (new papers, issues, feed).
  (() => {
    const NO_PULL = new Set(['read', 'pdf', 'doc', 'utd', 'study']);
    let y0 = null, dy = 0, bar = null;
    const reset = () => { y0 = null; dy = 0; if (bar) { bar.style.transform = ''; bar.classList.remove('ready', 'show'); } };
    document.addEventListener('touchstart', (e) => {
      if (window.scrollY > 0 || $('.sheet') || $('#lb') || NO_PULL.has(current.name) || e.touches.length !== 1) { y0 = null; return; }
      if (e.target.closest('textarea, input, .scroll-x')) { y0 = null; return; }
      y0 = e.touches[0].clientY;
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
      if (y0 == null) return;
      dy = e.touches[0].clientY - y0;
      if (dy <= 0 || window.scrollY > 0) { reset(); return; }
      if (!bar) { document.body.insertAdjacentHTML('beforeend', `<div id="ptr" class="ptr">${icon('refresh')}</div>`); bar = $('#ptr'); }
      bar.classList.add('show');
      bar.style.transform = `translate(-50%, ${Math.min(dy * 0.5, 70)}px) rotate(${Math.min(dy, 140) * 2}deg)`;
      bar.classList.toggle('ready', dy > 110);
    }, { passive: true });
    document.addEventListener('touchend', () => {
      if (y0 == null) return;
      const go = dy > 110;
      reset();
      if (!go) return;
      bar.classList.add('show', 'spin');
      searchCache.clear(); issueCache.clear(); crossrefCache.clear(); yearsPulled = Date.now();
      Promise.resolve(refreshPdfs()).then(() => loadSaved()).finally(() => { render(); setTimeout(() => bar?.classList.remove('show', 'spin'), 600); });
    }, { passive: true });
  })();

  const TAB_OF = { intel: 'intel', research: 'intel', project: 'intel', rp: 'intel', gaps: 'intel', compare: 'intel', drug: 'intel', images: 'intel', imgread: 'intel', alerts: 'intel', living: 'intel', sr: 'intel', cases: 'intel', case: 'intel', drugs: 'intel', lasers: 'intel', cme: 'intel', confs: 'intel', network: 'intel', graph: 'intel', visual: 'intel', clin: 'intel', shared: 'intel', ev: 'intel', trials: 'intel', guides: 'intel', today: 'intel', mlq: 'library', pyramid: 'search', meter: 'search', cites: 'intel', pipeline: 'intel', histo: 'intel', desk: 'intel', updates: 'intel', home: 'search', search: 'search', a: null, read: null, pdf: null, utd: null, doc: null, study: null, journals: 'journals', j: 'journals', ji: 'journals', library: 'library', notes: 'library', settings: null };

  const tabPlace = {};
  async function render() {
    closeSheet();
    closeDrawer();
    closeLightbox();
    document.body.classList.remove('reading');
    ext.closePlayer?.();
    // Outside the reader the mini player stays while something is playing.
    $$('.tts-on').forEach((e) => e.classList.remove('tts-on'));
    delete document.body.dataset.rtheme;
    ['--bg', '--card', '--line'].forEach((v) => document.body.style.removeProperty(v));
    applyTheme();
    const r = parseHash();
    current = r;
    const tab = TAB_OF[r.name];
    if (tab !== null && tab !== undefined) {
      $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
      // Each tab remembers where it was (a journal issue, a library filter…) for coming back.
      tabPlace[tab] = location.hash.replace(/^#\/?/, '');
    }
    window.scrollTo(0, 0);
    try {
      switch (r.name) {
        case 'search': return renderSearch(r.params);
        case 'a': return renderArticle(r.arg);
        case 'read': return renderReader(r.arg);
        case 'pdf': return renderPdfReader(r.arg);
        case 'utd': return renderUtdTopic(r.arg);
        case 'journals': return renderJournals();
        case 'j': return renderJournal(r.arg, r.params);
        case 'ji': return renderIssue(r.arg);
        case 'library': return renderLibrary(r.params);
        case 'settings': return renderSettings();
        default:
          if (ext.routes[r.name]) return ext.routes[r.name](r.arg, r.params);
          return renderHome();
      }
    } catch (e) {
      view.innerHTML = errorBox(e);
    }
  }

  function topbar(title, { back = true, right = '' } = {}) {
    return `<div class="topbar">${back ? `<button class="icon-btn" data-act="back" aria-label="Back">${icon('back')}</button>` : ''}<h1>${esc(title)}</h1>${right}</div>`;
  }
  function errorBox(e, retry = true) {
    // "Offline" only when the phone really is; a server that didn't answer says so (with why).
    const offline = !navigator.onLine;
    const net = !offline && /Failed to fetch|Load failed|Network|HTTP 5/.test(String(e?.message || e));
    return `<div class="empty">${icon(offline || net ? 'globe' : 'x')}<b>${offline ? "You're offline" : net ? "Couldn't reach the server" : 'Something went wrong'}</b>
      <div>${offline ? 'Search needs a connection. Your Library works offline.' : net ? 'The search or journal service didn\'t answer. Tap Try again; if it keeps happening, a VPN or a proxy in the phone\'s settings may be blocking it.' : esc(e?.message || e)}</div>
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
    const h = new Date().getHours();
    const greet = h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    const utd = account('utd');
    view.innerHTML = `
      <div class="home-top"><div class="brand">${LOGO}<span><b>DermScholar</b><small>${greet}</small></span></div>
        <button class="icon-btn" data-act="settings" aria-label="Settings">${icon('settings')}</button></div>
      <section class="hero-card">
        <h2>Search dermatology <em>evidence</em></h2>
        <p class="hero-sub">PubMed · Cochrane · guidelines · trials · DOI or PMID</p>
        ${searchBox()}
        <div class="scroll-x hero-chips">
          <button class="chip derm ${settings.derm ? 'on' : ''}" data-act="toggle-derm">${icon('leaf')}Dermatology focus</button>
          <button class="chip" data-act="quick" data-types="meta,sr">${icon('chart')}Meta-analyses</button>
          <button class="chip" data-act="quick" data-types="rct">${icon('check')}RCTs</button>
          <button class="chip" data-act="quick" data-types="guide">${icon('list')}Guidelines</button>
        </div>
      </section>
      ${ext.homeTop ? ext.homeTop() : ''}
      ${ext.homeIntel ? ext.homeIntel() : ''}

      <div class="stat-row">
        <button class="stat-tile" data-act="tab" data-tab="library"><b>${saved.size}</b><span>Saved</span></button>
        <button class="stat-tile" data-act="lib-offline"><b>${pdfKeys.size}</b><span>PDFs offline</span></button>
        <button class="stat-tile" data-act="tab" data-tab="journals"><b>${followed.length}</b><span>Following</span></button>
      </div>

      <div class="app-tiles">
        <button class="app-tile utd" data-act="utd-open"><span class="app-ico">${icon('book')}</span><b>UpToDate</b><span>${utd.saved ? (store.get('utdLoggedIn', false) ? 'Signed in · search in the app' : 'Login saved · tap to search') : 'Add your login'}</span></button>
        <button class="app-tile r4l" data-act="r4l-open"><span class="app-ico">${icon('key')}</span><b>Research4Life</b><span>${account('r4l').saved ? 'Access ready' : 'Add your login'}</span></button>
      </div>

      <div class="section">
        <div class="section-h"><h3>Try asking</h3></div>
        <div class="list-card">${EXAMPLES.map((q) => `<button class="example" data-act="ask" data-q="${esc(q)}">${icon('bulb')}<span>${esc(q)}</span></button>`).join('')}</div>
      </div>

      ${recent.length ? `<div class="section"><div class="section-h"><h3>Recent searches</h3><button data-act="clear-history">Clear</button></div>
        <div class="row wrap">${recent.slice(0, 8).map((q) => `<button class="chip" data-act="ask" data-q="${esc(q)}">${icon('clock')}${esc(q.length > 36 ? q.slice(0, 34) + '…' : q)}</button>`).join('')}</div></div>` : ''}

      <div class="section">
        <div class="section-h"><h3>Browse topics</h3></div>
        <div class="row wrap">${TOPICS.map((t) => `<button class="chip topic" data-act="topic" data-q="${esc(t)}"><i style="background:hsl(${hueFor(t)} 60% 50%)"></i>${esc(t)}</button>`).join('')}</div>
      </div>

      <div class="section">
        <div class="section-h"><h3>New in your journals</h3><button data-act="tab" data-tab="journals">Manage</button></div>
        ${followed.length ? `<div class="scroll-x covers" style="margin-bottom:12px">${followed.map(jcover).join('')}</div>` : ''}
        <div id="feed">${followed.length ? skeletons(3) : `<div class="muted small">Follow journals to see their latest articles here.</div>`}</div>
      </div>`;
    if (followed.length) loadFeed(followed);
    ext.afterHome?.();
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
      x: (p.x || '').split(',').filter((t) => DERM_X[t]),
      years: YEARS[p.y] ? p.y : 'any',
      oa: p.oa === '1',
      sort: SORTS[p.sort] ? p.sort : settings.sort,
      preprints: p.pp == null ? settings.preprints : p.pp === '1',
      src: p.src === 'utd' ? 'utd' : 'papers',
    };
  }

  function pdfAction(a) {
    if (a.imported) return '';
    if (jobs.get(a.id)?.state === 'running') return `<button class="btn xs" disabled><span class="spin"></span>Getting…</button>`;
    if (pdfKeys.has(a.id)) return `<button class="btn xs good" data-act="card-pdf" data-id="${esc(a.id)}">${icon('file')}Read PDF</button>
      <button class="btn xs" data-act="listen" data-id="${esc(a.id)}">${icon('audio')}Listen</button>`;
    if (!a.doi && !pdfSourceFor(a)) return '';
    return `<button class="btn xs primary" data-act="card-pdf" data-id="${esc(a.id)}">${icon('download')}Get PDF</button>`;
  }
  function cardActions(a) {
    const s = saved.has(a.id);
    return `<div class="card-actions">${pdfAction(a)}
      <button class="btn xs ${s ? 'good' : ''}" data-act="card-save" data-id="${esc(a.id)}">${icon(s ? 'bookmarkFill' : 'bookmark')}${s ? 'Saved' : 'Save'}</button>
      <button class="btn xs icon-only" data-act="card-share" data-id="${esc(a.id)}" aria-label="Share">${icon('share')}</button></div>`;
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

  const sourceTabs = (f) => `<div class="seg wide src-tabs">
      <button class="${f.src !== 'utd' ? 'on' : ''}" data-act="src" data-v="papers">${icon('search')}Papers</button>
      <button class="${f.src === 'utd' ? 'on' : ''}" data-act="src" data-v="utd">${icon('book')}UpToDate</button></div>`;

  async function renderSearch(p) {
    const f = filtersFrom(p);
    actions.src = (b) => go(b.dataset.v === 'utd' ? utdHash(f.q) : searchHash({ ...f, src: 'papers' }), { replace: true });
    if (f.src === 'utd') return renderUtdSearch(f);
    if (!f.q.trim()) return go('', { replace: true });
    const key = searchHash(f);
    view.innerHTML = `
      ${topbar('Search', { right: `<button class="icon-btn" data-act="home" aria-label="New search">${icon('plus')}</button>` })}
      <div class="spacer"></div>
      ${searchBox(f.q, true)}
      ${sourceTabs(f)}
      ${ext.searchTop ? ext.searchTop(f.q) : ''}
      ${ext.searchAnswer && !f.types.length && f.sort === 'relevance' ? '<div id="qa-answer"></div>' : ''}
      <div class="scroll-x">
        <button class="chip derm ${f.derm ? 'on' : ''}" data-act="f-derm">${icon('leaf')}Dermatology</button>
        <button class="chip ${f.types.length ? 'on' : ''}" data-act="f-types">${icon('filter')}${f.types.length ? f.types.map((t) => TYPE_FILTERS[t].label).join(', ') : 'Study type'}</button>
        <button class="chip ${f.x.length ? 'on' : ''}" data-act="f-x">${icon('leaf')}${f.x.length ? f.x.map((t) => DERM_X[t].label).join(', ') : 'Derm filters'}</button>
        <button class="chip ${f.years !== 'any' ? 'on' : ''}" data-act="f-years">${icon('calendar')}${esc(YEARS[f.years])}</button>
        <button class="chip ${f.oa ? 'on' : ''}" data-act="f-oa">${icon('unlock')}Open access</button>
        <button class="chip ${f.sort !== 'relevance' ? 'on' : ''}" data-act="f-sort">${icon('sort')}${esc(SORTS[f.sort].label)}</button>
      </div>
      <div id="results">${skeletons(5)}</div>`;
    const ta = $('.searchbox textarea');
    ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px';
    bindSearchChips(f);
    // A question gets its answer first (the current evidence, guidelines, references); papers below.
    if ($('#qa-answer')) ext.searchAnswer(f.q, $('#qa-answer'));

    let state = searchCache.get(key);
    if (!state) {
      try {
        let res = await epmcSearch(buildQuery(f), { sort: SORTS[f.sort].v });
        let broad = false;
        if (!idQuery(f.q) && res.hit < 5 && !isAdvanced(f.q) && keywordTerms(f.q).length > 1) {
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
    // A DOI / PMID that matches exactly one paper: open it straight away.
    if (idQuery(f.q) && state.results?.length === 1) {
      cache.set(state.results[0].id, state.results[0]);
      go('a/' + encodeURIComponent(state.results[0].id), { replace: true });
      return;
    }
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
    actions['f-x'] = () => pickMany('Derm filters (same group = any, groups combined)', Object.fromEntries(Object.entries(DERM_X).map(([k, v]) => [k, `${v.g}: ${v.label}`])), f.x, (v) => nav({ x: v }));
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
  /** The paper's record from Europe PMC, ignoring any saved copy. */
  async function fetchPaper(id) {
    const [src, ext] = id.split(/_(.+)/);
    const res = await epmcSearch(`EXT_ID:${ext} AND SRC:${src}`, { size: 1 });
    return res.results[0] || null;
  }
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

  const PROVIDERS = {
    r4l: { name: 'Research4Life', id: 'User ID', desc: 'Used by Get PDF to fetch paywalled papers in the background.' },
    utd: { name: 'UpToDate', id: 'Username', desc: 'Signs you in automatically whenever you open UpToDate.' },
    px: { name: 'College proxy', id: 'Username', desc: 'Your college EZproxy login (its password pop-up).' },
    spr: { name: 'Springer Nature Link', id: 'Email', desc: 'Your own Springer account: Get PDF tries Springer and BMC papers there first (then Research4Life).' },
  };
  function account(p) {
    try { return JSON.parse(Native.account ? Native.account(p) : p === 'r4l' ? Native.r4lAccount() : '{}'); } catch { return {}; }
  }
  const r4lAccount = () => account('r4l');
  // Get PDF sources that can be switched off in Settings (their logins stay saved).
  const srcOn = (k) => !store.get('srcOff', []).includes(k);
  function setSrc(k, on) {
    const off = new Set(store.get('srcOff', []));
    if (on) off.delete(k); else off.add(k);
    store.set('srcOff', [...off]);
    try { Native.setSourcesOff?.(JSON.stringify([...off])); } catch { /* old app */ }
  }
  try { Native.setSourcesOff?.(JSON.stringify(store.get('srcOff', []))); } catch { /* old app */ }
  const srcSwitch = (k) => `<label class="switch" title="Use for Get PDF"><input type="checkbox" data-src="${k}" ${srcOn(k) ? 'checked' : ''}><span></span></label>`;
  function collegeProxy() { try { return JSON.parse(Native.collegeProxy ? Native.collegeProxy() : '{}') || {}; } catch { return {}; } }

  /** Read the PDF if it's saved; otherwise fetch it (free copy first, then Research4Life). */
  async function getPdf(a, { skipAsk = false, route = '' } = {}) {
    if (pdfKeys.has(a.id)) { openReader(a.id); return; }
    if (jobs.get(a.id)?.state === 'running') { toast('Already getting this PDF'); return; }
    const free = pdfSourceFor(a);
    if (!free && !a.doi) {
      Native.copy(a.title);
      toast('No DOI for this paper. Title copied: paste it into Research4Life search.');
      Native.openPortal(PORTAL, a.id, a.title);
      return;
    }
    if (!free && !skipAsk && route !== 'college' && srcOn('r4l') && !r4lAccount().saved && !store.get('r4lAsked', false)) {
      r4lSignInSheet(() => getPdf(a, { skipAsk: true }));
      return;
    }
    if (!saved.has(a.id)) { await saveArticle(a); }
    // Elsevier journals (JAAD…): Research4Life gives the PDF through ClinicalKey, not ScienceDirect.
    const pii = ext.elsevierPii ? await ext.elsevierPii(a).catch(() => '') : '';
    // Journals Research4Life doesn't cover go straight to MyLOFT (learned from earlier tries).
    // Not Elsevier ones: those earlier tries went through ScienceDirect, before the ClinicalKey route.

    jobs.set(a.id, { title: a.title, doi: a.doi || '', state: 'running', message: free ? 'Downloading free PDF…' : 'Starting…', at: Date.now() });
    renderTray();
    refreshCards();
    if (route) Native.getPdf(a.id, a.doi || '', a.title, route === 'college' ? '' : free || '', pii || '', route);
    else if (pii) Native.getPdf(a.id, a.doi || '', a.title, free || '', pii);
    else Native.getPdf(a.id, a.doi || '', a.title, free || '');
  }

  const journalKey = (a) => (a.issn || a.essn || a.jAbbr || a.journal || '').toLowerCase();
  const notInR4L = () => store.get('notInR4L', []);
  function r4lSignInSheet(then) { signInSheet('r4l', then); }
  function signInSheet(provider, then) {
    const acc = account(provider);
    const P = PROVIDERS[provider];
    sheet(`<h3>${P.name} sign-in</h3>
      <p class="muted small" style="margin-top:-4px">${P.desc} Stored encrypted on this phone only.</p>
      <form data-form="r4l">
        <label class="field">${P.id}</label><input type="text" name="u" value="${esc(acc.user || '')}" autocomplete="username" autocapitalize="none">
        <label class="field">Password</label><input type="password" name="p" autocomplete="current-password">
        <div class="actions"><button type="button" class="btn" data-act="r4l-skip">${then ? 'Skip' : 'Cancel'}</button><button class="btn primary">Save</button></div>
      </form>`);
    const form = $('[data-form=r4l]');
    setTimeout(() => form.u.value ? form.p.focus() : form.u.focus(), 50);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const u = form.u.value.trim(); const p = form.p.value;
      if (!u || !p) { toast('Enter both user ID and password'); return; }
      if (Native.setCredentials) Native.setCredentials(provider, u, p); else Native.r4lSetCredentials(u, p);
      ext.secretsChanged?.();
      if (provider === 'utd') { store.set('utdLoggedIn', false); utdCache.clear(); }
      if (provider === 'r4l') store.set('r4lAsked', true);
      closeSheet(true);
      toast(`${P.name} sign-in saved`);
      if (then) then(); else render();
    });
    actions['r4l-skip'] = () => { store.set('r4lAsked', true); closeSheet(true); if (then) then(); };
  }

  async function renderArticle(id) {
    view.innerHTML = topbar('Paper') + skeletons(2);
    let a;
    try { a = await findArticle(id); } catch (e) { view.innerHTML = topbar('Paper') + errorBox(e); return; }
    if (current.name !== 'a' || current.arg !== id) return;
    if (a.imported) { location.replace('#pdf/' + encodeURIComponent(a.id)); return; }

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
            ? `<button class="btn good full big" data-act="open-pdf">${icon('file')}Read PDF<span class="sub">Saved on this phone</span></button>
               <button class="btn full" data-act="listen" data-id="${esc(a.id)}">${icon('audio')}Listen to this paper</button>`
            : pdfSrc || a.doi
              ? !srcOn('r4l') && collegeProxy().host && srcOn('px') ? '' : `<button class="btn primary full big" data-act="get-pdf">${icon('download')}Get PDF with R4L<span class="sub">${pdfSrc ? 'Free copy first, then your Research4Life access' : 'Through your Research4Life access'}</span></button>`
              : `<button class="btn full" data-act="r4l">${icon('key')}Find on Research4Life</button>`}
          ${!hasPdf && a.doi && collegeProxy().host && srcOn('px') ? `<button class="btn full big" data-act="get-pdf-college">${icon('key')}Get PDF with college proxy<span class="sub">Your college's subscriptions (${esc(collegeProxy().host)})</span></button>` : ''}
          ${!hasPdf && a.doi && actions.myloft && srcOn('myloft') ? `<button class="btn full big" data-act="myloft" data-id="${esc(a.id)}">${icon('key')}Get PDF via MyLOFT<span class="sub">Your institution's access</span></button>` : ''}
          <button class="btn ${s ? 'good' : ''}" data-act="save">${icon(s ? 'bookmarkFill' : 'bookmark')}${s ? 'Saved' : 'Save'}</button>
          ${canRead ? `<button class="btn" data-act="reader">${icon('book')}${s?.fullText ? 'Read offline' : 'Full text'}</button>` : ''}
          <button class="btn" data-act="ai-article" data-id="${esc(a.id)}">${icon('spark')}AI summary</button>
          <button class="btn" data-act="cite">${icon('quote')}Cite</button>
          <button class="btn" data-act="utd-search" data-q="${esc(topicOf(a))}">${icon('book')}UpToDate</button>
        </div>

        ${ext.articleTools ? ext.articleTools(a) : ''}

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
    ext.afterArticle?.(a);
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
    // With the college proxy offered beside it, this button is Research4Life only (the quick
    // Get PDF on paper cards still tries every way in turn).
    actions['get-pdf'] = () => getPdf(a, collegeProxy().host && srcOn('px') && srcOn('r4l') ? { route: 'r4l' } : {});
    actions['get-pdf-college'] = () => getPdf(a, { route: 'college' });
    // A PDF downloaded elsewhere (MyLOFT, email, browser): pick it and it's saved to this paper.
    actions['pdf-attach'] = async () => { if (!saved.has(a.id)) await saveArticle(a); Native.setPendingPdf?.(a.id, a.title); Native.importPdf(); };
    actions['open-pdf'] = () => openReader(a.id);
    actions.reader = () => go('read/' + encodeURIComponent(a.id));
    actions.publisher = async () => {
      if (!saved.has(a.id)) await saveArticle(a);
      // Elsevier (JAAD…): Research4Life gives the full text through ClinicalKey, not ScienceDirect.
      const pii = ext.elsevierPii ? await ext.elsevierPii(a).catch(() => '') : '';
      toast(pii ? 'Opening in ClinicalKey (your Research4Life sign-in)' : 'Opening through Research4Life (DOI link)');
      Native.openPortal(pii ? 'https://www.clinicalkey.com/#!/content/journal/1-s2.0-' + pii : R4L_PROXY + 'doi_org/' + a.doi, a.id, title);
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

  // ---------------------------------------------------------------- full text (JATS → reader model)
  async function fetchFullText(a) {
    const r = await fetch(`${EPMC}${a.pmcid}/fullTextXML`);
    if (!r.ok) throw new Error(r.status === 404 ? 'Full text is not available for this paper' : 'HTTP ' + r.status);
    const xml = new DOMParser().parseFromString(await r.text(), 'application/xml');
    if (xml.querySelector('parsererror')) throw new Error('Could not read the full text');
    return jatsToModel(xml, a.pmcid);
  }
  async function cacheFullText(a) {
    const model = await fetchFullText(a);
    await updateSaved(a.id, { fullText: model });
    return model;
  }

  /** Converts Europe PMC JATS XML into the reader's model: blocks plus figures/tables. */
  function jatsToModel(xml, pmcid) {
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
        else if (['fig', 'table-wrap', 'disp-formula', 'label'].includes(tag)) { /* handled elsewhere */ }
        else out += inline(n);
      });
      return out;
    };
    const tableHtml = (t) => {
      const rows = $$('tr', t).map((tr) => '<tr>' + Array.from(tr.children).map((c) => {
        const tag = c.localName === 'th' || c.parentNode?.localName === 'thead' ? 'th' : 'td';
        const span = ['colspan', 'rowspan'].map((k) => (c.getAttribute(k) ? ` ${k}="${Number(c.getAttribute(k)) || 1}"` : '')).join('');
        return `<${tag}${span}>${inline(c)}</${tag}>`;
      }).join('') + '</tr>').join('');
      return rows ? `<table>${rows}</table>` : '';
    };
    const blocks = [];
    const figures = [];
    const addFigure = (n) => {
      const kind = n.localName === 'table-wrap' ? 'table' : 'fig';
      const id = `${kind}-${figures.length + 1}`;
      const graphic = n.querySelector('graphic');
      const href = graphic && (graphic.getAttribute('xlink:href') || graphic.getAttributeNS('http://www.w3.org/1999/xlink', 'href'));
      const cap = $('caption', n);
      figures.push({
        id, kind,
        label: $('label', n)?.textContent.trim() || (kind === 'table' ? `Table ${figures.filter((f) => f.kind === 'table').length + 1}` : `Figure ${figures.filter((f) => f.kind === 'fig').length + 1}`),
        captionHtml: cap ? inline(cap) : '',
        src: href && pmcid ? `https://europepmc.org/articles/${pmcid}/bin/${href.replace(/\.(tif|tiff|gif|png|jpg)$/i, '')}.jpg` : '',
        html: kind === 'table' ? tableHtml(n) : '',
      });
      blocks.push({ type: kind, id });
    };
    const walk = (node, level) => {
      node.childNodes.forEach((n) => {
        if (n.nodeType !== 1) return;
        const tag = n.localName;
        if (tag === 'sec') walk(n, level + 1);
        else if (tag === 'title') blocks.push({ type: 'h', level: Math.min(level + 1, 4), html: inline(n) });
        else if (tag === 'p') {
          const html = inline(n).trim();
          if (html) blocks.push({ type: 'p', html });
          $$(':scope > fig, :scope > table-wrap', n).forEach(addFigure);
        }
        else if (tag === 'list') blocks.push({ type: 'list', html: `<ul>${$$(':scope > list-item', n).map((li) => `<li>${inline(li)}</li>`).join('')}</ul>` });
        else if (tag === 'fig' || tag === 'table-wrap') addFigure(n);
        else if (tag === 'fig-group' || tag === 'disp-quote' || tag === 'boxed-text') walk(n, level);
      });
    };
    const title = xml.querySelector('article-meta title-group article-title');
    if (title) blocks.push({ type: 'title', html: inline(title) });
    const abs = xml.querySelector('article-meta abstract');
    if (abs) { blocks.push({ type: 'h', level: 2, html: 'Abstract' }); walk(abs, 1); }
    const body = xml.querySelector('body');
    if (body) walk(body, 0);
    else blocks.push({ type: 'p', html: '<span class="muted">This paper has no full text body in Europe PMC.</span>' });
    const refs = $$('back ref-list ref', xml);
    if (refs.length) {
      blocks.push({ type: 'h', level: 2, html: 'References' });
      refs.forEach((r) => blocks.push({ type: 'ref', html: esc(r.textContent.replace(/\s+/g, ' ').trim()) }));
    }
    return { v: 2, kind: 'jats', title: title?.textContent || '', blocks, figures };
  }

  async function renderReader(id) {
    view.innerHTML = readerTop('Full text') + readerLoading('Loading full text…');
    let a;
    try { a = await findArticle(id); } catch (e) { view.innerHTML = topbar('Full text') + errorBox(e); return; }
    let model = saved.get(id)?.fullText;
    if (!model || typeof model !== 'object') {
      try { model = await fetchFullText(a); } catch (e) { view.innerHTML = topbar('Full text') + errorBox(e, false); return; }
      if (saved.has(id)) updateSaved(id, { fullText: model });
    }
    if (current.name !== 'read') return;
    showReader(model, { key: 'ft:' + id, title: a.title, article: a });
  }

  // ---------------------------------------------------------------- UpToDate, inside the app
  const UTD = 'https://www.uptodate.com';
  const utdWait = { search: null, topic: null };
  const utdCache = new Map();
  function utdCall(kind, arg) {
    return new Promise((resolve) => {
      if (utdWait[kind]) utdWait[kind]({ state: 'cancelled' });
      utdWait[kind] = resolve;
      if (kind === 'search') Native.utdSearch(arg); else Native.utdTopic(arg);
    });
  }
  const utdTopicHash = (url) => 'utd/' + encodeURIComponent(url);

  async function renderUtdSearch(f) {
    const q = f.q.trim();
    const acc = account('utd');
    view.innerHTML = `${topbar(q ? 'UpToDate' : 'UpToDate', { right: `<button class="icon-btn" data-act="utd-web" aria-label="Open website">${icon('external')}</button>` })}
      <div class="spacer"></div>
      ${searchBox(f.q, true).replace('Ask a research question…', 'Search UpToDate topics…')}
      ${sourceTabs(f)}
      <div id="results"></div>`;
    const ta = $('.searchbox textarea');
    ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px';
    actions['utd-web'] = () => Native.openUpToDateAt(UTD + '/contents/search' + (q ? '?search=' + encodeURIComponent(q) : ''));
    const el = $('#results');
    if (!acc.saved && !store.get('utdLoggedIn', false)) {
      el.innerHTML = utdLoginCard('Add your UpToDate login once, and UpToDate topics show up right here in the app.');
      bindUtdLogin(() => render());
      return;
    }
    if (!q) {
      const savedTopics = [...saved.values()].filter((a) => a.utd).sort((a, b) => b.savedAt - a.savedAt);
      el.innerHTML = `<div class="utd-hero">${icon('book')}<div><b>Search UpToDate</b><span>Topics open here in the app, in your reading style.</span></div></div>
        ${savedTopics.length ? `<div class="section"><div class="section-h"><h3>Saved topics</h3></div>${savedTopics.map(utdCard).join('')}</div>` : ''}`;
      return;
    }
    let res = utdCache.get(q);
    if (!res) {
      el.innerHTML = `<div class="meta-line"><span class="spin" style="vertical-align:-3px;margin-right:8px"></span><span id="utd-status">Searching UpToDate…</span></div>${skeletons(4)}`;
      res = await Promise.race([
        utdCall('search', q),
        new Promise((r) => setTimeout(() => r({ state: 'stuck', message: 'UpToDate did not respond. Tap Show page to see what it needs.' }), 75000)),
      ]);
      if (res.state === 'cancelled') return;
      if (res.state === 'results') { utdCache.set(q, res); addHistory(q); }
    }
    if (current.name !== 'search' || filtersFrom(current.params).src !== 'utd' || filtersFrom(current.params).q.trim() !== q) return;
    if (res.state === 'login' || res.state === 'stuck') {
      el.innerHTML = utdLoginCard(res.message || 'Sign in to UpToDate to see its results here.', true);
      bindUtdLogin(() => render());
      return;
    }
    if (res.state === 'empty' || (res.state === 'results' && !res.items?.length)) {
      el.innerHTML = `<div class="empty">${icon('book')}<b>No UpToDate topics found</b><div>Try a shorter search, like a diagnosis or drug name.</div></div>`;
      return;
    }
    if (res.state !== 'results') {
      el.innerHTML = `<div class="empty">${icon('alert')}<b>Couldn't load UpToDate</b><div>${esc(res.message || 'Please try again.')}</div>
        <div class="spacer"></div><button class="btn small" data-act="utd-retry">Try again</button></div>`;
      actions['utd-retry'] = () => { utdCache.delete(q); render(); };
      return;
    }
    el.innerHTML = `<div class="meta-line">${res.items.length} UpToDate results</div>${res.items.map((it) => utdCard(it)).join('')}`;
  }

  function utdCard(it) {
    const url = it.url || it.utdUrl;
    const isSaved = saved.has('utd:' + url);
    return `<div class="card utd-card" role="button" tabindex="0" data-act="utd-topic" data-url="${esc(url)}">
      <div class="badges" style="margin:0 0 8px"><span class="badge b-utd">${icon('book')}${esc(it.type || it.journal || 'Topic')}</span>${isSaved ? `<span class="badge b-saved">${icon('bookmarkFill')}Saved</span>` : ''}</div>
      <p class="title main">${esc(it.title)}</p>
      ${it.snippet ? `<p class="utd-snip">${esc(it.snippet)}</p>` : ''}</div>`;
  }

  function utdLoginCard(msg, fromBackground) {
    const acc = account('utd');
    return `<div class="utd-login">${icon('book')}<b>UpToDate</b><p>${esc(msg)}</p>
      <div class="row" style="gap:8px;justify-content:center;flex-wrap:wrap">
        ${fromBackground ? `<button class="btn small primary" data-act="utd-show">${icon('external')}Show page</button>` : ''}
        <button class="btn small ${fromBackground ? '' : 'primary'}" data-act="utd-add-login">${icon('key')}${acc.saved ? 'Update login' : 'Save my login'}</button>
        ${fromBackground ? '' : `<button class="btn small" data-act="utd-signin-web">Sign in on UpToDate</button>`}</div>
      <p class="muted small">${fromBackground ? 'Show page opens the exact page UpToDate stopped on. Sign in or tap through it, then come back — the app retries automatically.'
        : 'Stored encrypted on this phone; the app signs in for you in the background.'}</p></div>`;
  }
  function bindUtdLogin(then) {
    actions['utd-add-login'] = () => signInSheet('utd', () => { utdCache.clear(); then(); });
    actions['utd-signin-web'] = () => { utdCache.clear(); pendingUtdRetry = true; Native.openUpToDateAt(UTD + '/login'); };
    actions['utd-show'] = () => { utdCache.clear(); pendingUtdRetry = true; Native.utdShowPage ? Native.utdShowPage() : Native.openUpToDateAt(UTD + '/login'); };
  }
  let pendingUtdRetry = false;

  /** Turns the topic markup extracted from UpToDate into the reader's model. */
  function utdToModel(html, title, url) {
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    const inline = (node) => {
      let out = '';
      node.childNodes.forEach((n) => {
        if (n.nodeType === 3) { out += esc(n.nodeValue); return; }
        if (n.nodeType !== 1) return;
        const t = n.tagName;
        if (t === 'B' || t === 'STRONG') out += `<b>${inline(n)}</b>`;
        else if (t === 'I' || t === 'EM') out += `<i>${inline(n)}</i>`;
        else if (t === 'SUP' || t === 'SUB') out += `<${t.toLowerCase()}>${inline(n)}</${t.toLowerCase()}>`;
        else if (t === 'BR') out += '<br>';
        else if (t === 'A' && n.getAttribute('data-utd')) {
          const u = n.getAttribute('data-utd');
          if (/^https:\/\/([a-z]+\.)?uptodate\.com\//.test(u)) out += `<a class="utd-link" data-utd="${esc(u)}">${inline(n)}</a>`;
          else out += inline(n);
        } else if (t === 'IMG') { /* images become figures */ }
        else out += inline(n);
      });
      return out;
    };
    const tableHtml = (t) => '<table>' + [...t.querySelectorAll('tr')].map((tr) => '<tr>' + [...tr.children].map((c) => {
      const tag = c.tagName === 'TH' ? 'th' : 'td';
      const span = ['colspan', 'rowspan'].map((k) => (c.getAttribute(k) ? ` ${k}="${Number(c.getAttribute(k)) || 1}"` : '')).join('');
      return `<${tag}${span}>${inline(c)}</${tag}>`;
    }).join('') + '</tr>').join('') + '</table>';
    const blocks = [{ type: 'title', text: title }];
    const figures = [];
    const BLOCKY = 'P,DIV,UL,OL,TABLE,H2,H3,H4,BLOCKQUOTE,DL,IMG';
    const walk = (node) => {
      [...node.children].forEach((el) => {
        const t = el.tagName;
        if (/^H[2-4]$/.test(t)) {
          const text = el.textContent.replace(/\s+/g, ' ').trim();
          if (text && text !== title) blocks.push({ type: 'h', level: +t[1], text });
        } else if (t === 'TABLE') {
          const id = `table-${figures.length + 1}`;
          figures.push({ id, kind: 'table', label: `Table ${figures.filter((f) => f.kind === 'table').length + 1}`, caption: '', html: tableHtml(el) });
          blocks.push({ type: 'table', id });
        } else if (t === 'IMG') {
          const src = el.getAttribute('src') || '';
          // Site logos (Wolters Kluwer, UpToDate) sit above the text; real graphics come after it.
          const logo = /logo|wolters|kluwer|brand|sprite|icon|banner|masthead|header/i.test(src + ' ' + (el.getAttribute('alt') || ''));
          if (/^https:\/\//.test(src) && !logo && blocks.length > 1) {
            const id = `fig-${figures.length + 1}`;
            figures.push({ id, kind: 'fig', label: `Graphic ${figures.filter((f) => f.kind === 'fig').length + 1}`, caption: '', src });
            blocks.push({ type: 'fig', id });
          }
        } else if (t === 'UL' || t === 'OL') {
          const items = [...el.children].filter((li) => li.tagName === 'LI').map((li) => `<li>${inline(li)}</li>`).join('');
          if (items) blocks.push({ type: 'list', html: `<${t.toLowerCase()}>${items}</${t.toLowerCase()}>` });
        } else if (el.querySelector(BLOCKY.split(',').map((x) => ':scope > ' + x.toLowerCase()).join(','))) {
          walk(el);
        } else {
          const h = inline(el).replace(/^(\s|<br>)+|(\s|<br>)+$/g, '');
          if (h.replace(/<[^>]+>/g, '').trim()) blocks.push({ type: 'p', html: h });
        }
      });
    };
    walk(doc.body.firstElementChild);
    return { v: 1, kind: 'utd', title, url, blocks, figures };
  }

  async function renderUtdTopic(url) {
    const key = 'utd:' + url;
    const here = () => current.name === 'utd' && current.arg === url;
    const fail = (title, msg, withShow) => {
      if (!here()) return;
      view.innerHTML = topbar('UpToDate') + `<div class="empty">${icon('alert')}<b>${esc(title)}</b><div>${esc(msg || '')}</div>
        <div class="spacer"></div><div class="row" style="gap:8px;justify-content:center">
        <button class="btn small primary" data-act="utd-retry">Try again</button>
        ${withShow ? '<button class="btn small" data-act="utd-show">Show page</button>' : ''}</div></div>`;
      actions['utd-retry'] = async () => { await db.delReflow(key).catch(() => {}); render(); };
      bindUtdLogin(() => render());
    };
    view.innerHTML = readerTop('UpToDate') + readerLoading('Opening topic…') +
      '<div class="center hidden" id="utd-slow" style="margin-top:-40px"><button class="btn small" data-act="utd-show">Taking long? Show page</button></div>';
    bindUtdLogin(() => render());
    const slow = setTimeout(() => $('#utd-slow')?.classList.remove('hidden'), 15000);
    try {
      const PAYWALL = /to continue reading this (article|topic),? you must (sign|log) in/i;
      let model = await db.getReflow(key).catch(() => null);
      // A signed-out preview saved by an older version: throw it away and fetch the real topic.
      if (model && PAYWALL.test(JSON.stringify(model.blocks || []).slice(0, 400000))) { db.delReflow(key).catch(() => {}); model = null; }
      if (!model) {
        // Watchdog: never leave the spinner up if the background page never answers.
        const res = await Promise.race([
          utdCall('topic', url),
          new Promise((r) => setTimeout(() => r({ state: 'stuck', message: 'UpToDate did not respond. Tap Show page to see what it needs.' }), 75000)),
        ]);
        if (res.state === 'cancelled' || !here()) return;
        if (res.state === 'login') {
          view.innerHTML = topbar('UpToDate') + utdLoginCard(res.message || 'Sign in to UpToDate to read this topic here.', true);
          bindUtdLogin(() => render());
          return;
        }
        if (res.state !== 'ok' || !res.html) { fail("Couldn't open this topic", res.message, true); return; }
        if (PAYWALL.test(res.html)) {
          view.innerHTML = topbar('UpToDate') + utdLoginCard('UpToDate only showed the preview (not signed in). Check your UpToDate login in Settings, or tap Show page to sign in once.', true);
          bindUtdLogin(() => render());
          return;
        }
        model = { ...utdToModel(res.html, res.title || 'UpToDate topic', url), key };
        if (model.blocks.length < 3) { fail('This topic came back empty', 'UpToDate may have shown a notice instead of the topic.', true); return; }
        db.putReflow(model).catch(() => {});
      }
      if (here()) showReader(model, { key, title: model.title, utd: true, url });
    } catch (e) {
      fail("Couldn't show this topic", String(e && e.message || e), true);
    } finally {
      clearTimeout(slow);
    }
  }

  // ---------------------------------------------------------------- read aloud
  // Narration engine: builds the spoken paragraphs from the open document (cleaned by speech.js,
  // with the user's skip settings), tracks sections and time, remembers where each document was
  // left, and can also play AI-written scripts (summaries, the two-voice discussion).
  const ttsPrefs = Object.assign({ rate: 1, voice: '', voice2: '', mode: 'full', follow: true }, store.get('tts', {}));
  ttsPrefs.skip = Object.assign({ refs: true, appendix: true, acknowledgements: true, captions: true, citations: true }, ttsPrefs.skip || {});
  if (typeof ttsPrefs.captions === 'boolean') { ttsPrefs.skip.captions = !ttsPrefs.captions; delete ttsPrefs.captions; }
  if (typeof ttsPrefs.refs === 'boolean') { ttsPrefs.skip.refs = !ttsPrefs.refs; delete ttsPrefs.refs; }
  const saveTts = () => store.set('tts', ttsPrefs);
  const voiceDownloads = {}; // id -> {pct, stage} while a natural voice downloads
  function onVoiceEvent(evt) {
    if (evt.type === 'voiceProgress') {
      voiceDownloads[evt.id] = { pct: evt.pct, stage: evt.stage };
      const t = $('#vp-' + evt.id); if (t) t.textContent = `${evt.stage} ${evt.pct}%`;
      const bar = $('#vpb-' + evt.id); if (bar) bar.style.width = evt.pct + '%';
      return;
    }
    delete voiceDownloads[evt.id];
    if (evt.type === 'voiceReady') {
      if (!String(ttsPrefs.voice || '').startsWith('neural:')) {
        ttsPrefs.voice = `neural:${evt.id}#${evt.id === 'kokoro-en' ? 3 : 0}`;
        saveTts();
        if ($('#ttsbar')) Native.ttsVoice(ttsPrefs.voice);
      }
      toast('Natural voice ready — now reading with it');
    } else toast(evt.message || 'Voice download failed');
    if ($('#ttsvoices')) { const y = $('.sheet').scrollTop; ttsSheet(); $('.sheet').scrollTop = y; }
  }
  setTimeout(() => { try { Native.ttsWarm?.(ttsPrefs.engine || ''); } catch { /* browser */ } }, 2500);
  let speech = null;
  const speechReady = import('./speech.js').then((m) => { speech = m; return m; }).catch(() => null);
  const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
  let tts = { key: null, title: '', els: [], texts: [], secs: [], heads: [], cum: [0], playing: false, index: 0, script: null, active: false };
  const cps = () => (speech ? speech.CHARS_PER_SEC : 14.5) * (ttsPrefs.rate || 1);

  function spoken(text) {
    if (speech) return speech.speakable(text, { citations: !ttsPrefs.skip.citations });
    return text.replace(/\[\d+(?:[–,-]\d+)*\]/g, '');
  }

  /** Paragraphs to read, in order, with the element each one highlights and its section. */
  function ttsItems() {
    const rd = $('#rd');
    const out = { els: [], texts: [], secs: [], heads: [] };
    if (!rd) return out;
    let section = '';
    let skipLevel = 0; // inside a skipped section (references, appendix…) until a heading at this level or above
    const keyRe = /abstract|summary|conclusion|interpretation|key (finding|point|takeaway)|capsule|relevance|bottom line/i;
    const skipHeading = (t) => Object.entries(speech?.SKIPPABLE || {}).some(([k, v]) => v.heading && ttsPrefs.skip[k] && v.heading.test(t.trim()));
    $$('h1, h2, h3, h4, p, li, figcaption', rd).forEach((el) => {
      if (el.closest('.rd-refs')) { if (ttsPrefs.skip.refs) return; }
      if (el.tagName === 'FIGCAPTION') { if (ttsPrefs.skip.captions) return; }
      else if (el.closest('figure')) return;
      if (el.tagName === 'LI' && !el.closest('.rd-refs') && el.querySelector('p')) return;
      const isHead = /^H[1-4]$/.test(el.tagName);
      if (isHead && el.tagName !== 'H1') {
        const level = +el.tagName[1];
        if (skipLevel && level <= skipLevel) skipLevel = 0;
        if (!skipLevel && skipHeading(el.textContent)) { skipLevel = level; return; }
        section = el.textContent.trim();
      }
      if (skipLevel) return;
      if (ttsPrefs.mode === 'key' && el.tagName !== 'H1' && !keyRe.test(section) && !keyRe.test(el.textContent.slice(0, 40))) return;
      const clone = el.cloneNode(true);
      clone.querySelectorAll('sup, .rd-zoom, .rd-ai').forEach((x) => x.remove());
      let text = clone.textContent.replace(/\s+/g, ' ').trim();
      if (text.length < 2) return;
      text = spoken(text);
      if (isHead && !/[.!?:]$/.test(text)) text += '.';
      // Engines cap one utterance at ~4000 characters.
      const chunks = text.length > 3200 ? text.match(/[^.!?]{1,3000}[.!?]*\s*/g) || [text] : [text];
      chunks.forEach((c, ci) => {
        if (isHead && ci === 0) out.heads.push(out.texts.length);
        out.els.push(el); out.texts.push(c.trim()); out.secs.push(section || tts.title);
      });
    });
    return out;
  }

  function setItems(it) {
    tts.els = it.els; tts.texts = it.texts; tts.secs = it.secs; tts.heads = it.heads;
    tts.cum = [0];
    it.texts.forEach((t) => tts.cum.push(tts.cum[tts.cum.length - 1] + t.length));
  }

  function ttsAttach(opts) {
    tts.key = opts.key;
    tts.title = opts.title;
    tts.route = location.hash;
    actions['tts-open'] = () => { if ($('#ttsbar') && !tts.script) ext.openPlayer?.(); else ttsPlay(); };
    // While listening, tapping a paragraph reads from there.
    $('#rd')?.addEventListener('click', (e) => {
      if (!$('#ttsbar') || tts.script) return;
      const el = e.target.closest('p, h1, h2, h3, h4, li');
      if (!el || e.target.closest('a, figure, .rd-ai')) return;
      const i = tts.els.indexOf(el);
      if (i >= 0) Native.ttsSeek(i);
    });
    try {
      const st = JSON.parse(Native.ttsStatus());
      if (st.total && st.title === opts.title) { setItems(ttsItems()); tts.script = null; showTtsBar(st.playing, st.index); }
    } catch { /* not playing */ }
  }

  function firstVisible() {
    const i = tts.els.findIndex((el) => el.getBoundingClientRect().bottom > 80);
    return Math.max(0, i);
  }

  /** Reads the open document; with no start, resumes where it was left (or from the screen). */
  async function ttsPlay(start) {
    await speechReady;
    const it = ttsItems();
    if (!it.texts.length) { toast('Nothing to read here'); return; }
    tts.script = null;
    setItems(it);
    if (start == null) {
      const saved = store.get('ttspos.' + tts.key, null);
      if (saved && saved.i > 0 && saved.i < it.texts.length - 1 && saved.n === it.texts.length) { start = saved.i; toast('Resuming where you left off'); }
      else start = firstVisible();
    }
    start = Math.max(0, Math.min(start, it.texts.length - 1));
    tts.active = true;
    Native.ttsStart(tts.title, JSON.stringify(it.texts), start, ttsPrefs.rate, ttsPrefs.voice);
    store.set('lastListen', { key: tts.key, title: tts.title, route: tts.route || location.hash, t: Date.now() });
    showTtsBar(true, start);
  }

  /**
   * Plays AI-written audio (a spoken summary, the two-person discussion). lines: [{t, speaker?, voice?, pitch?}].
   * It is always labelled as AI-generated, never as the document's own text.
   */
  async function ttsPlayScript(label, lines, { title = tts.title, start = 0, meta = {} } = {}) {
    await speechReady;
    if (!lines.length) return;
    tts.script = { label, lines, title, meta };
    tts.title = title;
    tts.els = []; tts.texts = lines.map((l) => l.t);
    // Lines with topics (a podcast's segments) work as chapters; otherwise the speaker shows.
    tts.secs = lines.map((l) => l.topic || l.speaker || label);
    tts.heads = lines.map((l, i) => (l.topic && (i === 0 || lines[i - 1].topic !== l.topic) ? i : -1)).filter((i) => i >= 0);
    tts.cum = [0];
    lines.forEach((l) => tts.cum.push(tts.cum[tts.cum.length - 1] + l.t.length));
    tts.active = true;
    start = Math.max(0, Math.min(start, lines.length - 1));
    Native.ttsStart(`${title} · ${label}`, JSON.stringify(lines.map((l) => ({ t: spoken(l.t), voice: l.voice || '', pitch: l.pitch || 0 }))), start, ttsPrefs.rate, ttsPrefs.voice);
    if (meta.podcast) store.set('lastListen', { key: meta.podcast, title, podcast: true, route: location.hash, t: Date.now() });
    showTtsBar(true, start);
  }

  /** Index reached by moving `sec` seconds from the current paragraph (±). */
  function indexAfterSeconds(sec) {
    const target = tts.cum[tts.index] + sec * cps();
    if (sec < 0) {
      let i = tts.index;
      while (i > 0 && tts.cum[i] > target) i--;
      return Math.min(i, Math.max(0, tts.index - 1));
    }
    let i = tts.index;
    while (i < tts.texts.length - 1 && tts.cum[i + 1] <= target) i++;
    return Math.max(i, Math.min(tts.texts.length - 1, tts.index + 1));
  }
  const sectionStart = (i) => { let s = 0; for (const h of tts.heads) if (h <= i) s = h; return s; };
  const sectionEnd = (i) => { const n = tts.heads.find((h) => h > i); return (n == null ? tts.texts.length : n) - 1; };
  const nextSection = (i) => tts.heads.find((h) => h > i) ?? i;
  const prevSection = (i) => { const s = sectionStart(i); return i - s > 1 ? s : sectionStart(Math.max(0, s - 1)); };
  // Time spent inside the current paragraph/line, so the clock moves smoothly instead of only
  // jumping when the next line starts.
  const clk = { i: -1, t0: null, acc: 0 };
  function clockMark(playing, index) {
    const now = Date.now();
    if (index !== clk.i) { clk.i = index; clk.acc = 0; clk.t0 = playing ? now : null; }
    else if (playing && clk.t0 == null) clk.t0 = now;
    else if (!playing && clk.t0 != null) { clk.acc += (now - clk.t0) / 1000; clk.t0 = null; }
  }
  const inLine = (i) => {
    if (i !== clk.i || !tts.texts[i]) return 0;
    const len = (tts.cum[i + 1] - tts.cum[i]) / cps();
    return Math.min(len * 0.98, clk.acc + (clk.t0 != null ? (Date.now() - clk.t0) / 1000 : 0));
  };
  const ttsTimes = (i = tts.index) => {
    const total = tts.cum[tts.cum.length - 1] / cps();
    const done = tts.cum[Math.min(i, tts.texts.length)] / cps() + inLine(i);
    return { done, total, left: Math.max(0, total - done) };
  };

  function showTtsBar(playing, index) {
    if (!$('#ttsbar')) {
      document.body.insertAdjacentHTML('beforeend', `<div class="tts-bar" id="ttsbar">
        <button class="tts-play" data-act="tts-toggle" aria-label="Play or pause" id="ttsplay"></button>
        <button class="tts-info" data-act="tts-player" aria-label="Open player"><b id="ttssec"></b><span id="ttspos"></span></button>
        <button class="icon-btn" data-act="tts-back" aria-label="Back 15 seconds">${icon('back15')}</button>
        <button class="icon-btn" data-act="tts-fwd" aria-label="Forward 30 seconds">${icon('fwd30')}</button>
        <button class="chip tts-rate" data-act="tts-rate" id="ttsrate">${ttsPrefs.rate}×</button>
        <button class="icon-btn" data-act="tts-close" aria-label="Stop">${icon('x')}</button>
        <i class="tts-prog" id="ttsprog"></i></div>`);
      document.body.classList.add('tts-on-page');
    }
    updateTtsBar(playing, index);
  }
  const ttsActions = {
    'tts-toggle': () => Native.ttsToggle(),
    'tts-prev': () => Native.ttsSkip(-1),
    'tts-next': () => Native.ttsSkip(1),
    'tts-back': () => Native.ttsSeek(indexAfterSeconds(-15)),
    'tts-fwd': () => Native.ttsSeek(indexAfterSeconds(30)),
    'tts-close': () => { Native.ttsStop(); hideTtsBar(); },
    'tts-settings': () => ttsSheet(),
    'tts-player': () => ext.openPlayer?.(),
    'tts-rate': () => {
      ttsPrefs.rate = RATES[(RATES.indexOf(ttsPrefs.rate) + 1) % RATES.length] || 1;
      saveTts(); Native.ttsRate(ttsPrefs.rate);
      $$('.js-rate').forEach((e) => { e.textContent = ttsPrefs.rate + '×'; });
      const r = $('#ttsrate'); if (r) r.textContent = ttsPrefs.rate + '×';
    },
  };

  function hideTtsBar() {
    $('#ttsbar')?.remove();
    document.body.classList.remove('tts-on-page');
    $$('.tts-on').forEach((e) => e.classList.remove('tts-on'));
  }

  let lastSec = '';
  function drawClock() {
    const t = ttsTimes(tts.index);
    const pos = $('#ttspos');
    if (pos && speech) pos.textContent = `${speech.clock(t.done)} / ${speech.clock(t.total)} · ${speech.duration(t.left)} left`;
    const prog = $('#ttsprog');
    if (prog) prog.style.width = (t.total ? (100 * t.done) / t.total : 0).toFixed(1) + '%';
  }
  setInterval(() => { if (tts.active && tts.playing && !document.hidden) { drawClock(); ext.onTtsUpdate?.(); } }, 1000);
  function updateTtsBar(playing, index) {
    clockMark(playing, index);
    tts.playing = playing; tts.index = index;
    const btn = $('#ttsplay');
    if (btn) btn.innerHTML = icon(playing ? 'pause' : 'play');
    const sec = tts.script ? `AI · ${tts.script.label}` : (tts.secs[index] || tts.title);
    const s = $('#ttssec');
    if (s) s.textContent = tts.script ? `${tts.title} — ${tts.script.label}` : (sec === tts.title ? tts.title : sec);
    const t = ttsTimes(index);
    const pos = $('#ttspos');
    if (pos && speech) pos.textContent = `${speech.clock(t.done)} / ${speech.clock(t.total)} · ${speech.duration(t.left)} left`;
    const prog = $('#ttsprog');
    if (prog) prog.style.width = (t.total ? (100 * t.done) / t.total : 0).toFixed(1) + '%';
    if (sec !== lastSec) { lastSec = sec; try { Native.ttsSubtitle?.(tts.script ? 'AI-generated · ' + tts.script.label : sec); } catch { /* browser */ } }
    $$('.tts-on').forEach((e) => e.classList.remove('tts-on'));
    const el = tts.els[index];
    if (el && $('#rd')?.contains(el)) {
      el.classList.add('tts-on');
      if (ttsPrefs.follow && playing && !$('#player')) {
        const r = el.getBoundingClientRect();
        if (r.top < 90 || r.bottom > innerHeight - 130) window.scrollTo({ top: r.top + scrollY - innerHeight / 3, behavior: 'smooth' });
      }
    }
    if (!tts.script && tts.key && tts.texts.length) store.set('ttspos.' + tts.key, { i: index, n: tts.texts.length, t: Date.now() });
    if (tts.script?.meta?.podcast) store.set('podpos.' + tts.script.meta.podcast, { i: index, n: tts.texts.length, t: Date.now() });
    ext.onTtsUpdate?.();
  }

  function onTts(evt) {
    if (evt.state === 'voices') { if ($('#ttsvoices')) ttsSheet(); return; }
    if (evt.state === 'stopped') { tts.active = false; hideTtsBar(); ext.onTtsUpdate?.(); return; }
    if (evt.state === 'error') { tts.active = false; hideTtsBar(); toast('Text-to-speech isn’t available. Install or enable a voice in Android settings.'); return; }
    if (String(evt.state).startsWith('error:')) { updateTtsBar(false, evt.index); toast(evt.state.slice(6)); return; }
    if (evt.state === 'buffering') { const p = $('#ttspos'); if (p) p.textContent = 'Preparing the voice…'; return; }
    if (evt.state === 'ended' && tts.script?.meta?.resume) {
      // An answer to the listener's question has finished: carry on where they interrupted.
      const r = tts.script.meta.resume;
      toast('Back to where you were');
      if (r.doc) { ttsPlay(r.index); return; }
      ttsPlayScript(r.label, r.lines, { title: r.title, start: r.index, meta: r.meta || {} });
      return;
    }
    if (evt.state === 'ended') { updateTtsBar(false, evt.index); if (!tts.script && tts.key) store.set('ttspos.' + tts.key, { i: 0, n: tts.texts.length, t: Date.now(), done: true }); toast('Finished'); return; }
    if (evt.state === 'sleep') { updateTtsBar(false, evt.index); toast('Sleep timer — paused'); return; }
    if (!tts.active) return;
    if (!$('#ttsbar')) showTtsBar(evt.state === 'playing', evt.index);
    else updateTtsBar(evt.state === 'playing', evt.index);
  }

  function ttsSheet() {
    let info = { ready: false, voices: [], engines: [] };
    try { const r = JSON.parse(Native.ttsVoices()); info = Array.isArray(r) ? { ready: true, voices: r, engines: [] } : r; } catch { /* no engine */ }
    const voices = info.voices || [];
    const engines = info.engines || [];
    const vname = (v) => v.name.replace(/^[a-z]{2,3}[-_][a-z]{2}[-_]x[-_]/i, '').replace(/[-_]/g, ' ');
    const byLocale = {};
    voices.forEach((v) => { (byLocale[v.locale] = byLocale[v.locale] || []).push(v); });
    const voiceSelect = (id, val, none) => `<select id="${id}"><option value="">${none}</option>${Object.entries(byLocale).map(([loc, vs]) => `<optgroup label="${esc(loc)}">${vs.map((v) => `<option value="${esc(v.name)}" ${val === v.name ? 'selected' : ''}>${esc(vname(v))}${v.quality >= 400 ? ' · HQ' : ''}${v.network ? ' · online' : ''}</option>`).join('')}</optgroup>`).join('')}</select>`;
    const sw = (k, t, sub, on) => `<div class="setting"><div class="body"><b>${t}</b><span>${sub}</span></div>
      <label class="switch"><input type="checkbox" data-tts="${k}" ${on ? 'checked' : ''}><span></span></label></div>`;
    const S = speech?.SKIPPABLE || {};
    const packs = info.neural || [];
    const cur = ttsPrefs.voice || '';
    const neuralHtml = packs.length ? `<label class="field">Natural voices <span class="muted small">· AI voices that run on this phone, free and offline</span></label>
      <div class="nv-list">${packs.map((p) => {
        const dl = voiceDownloads[p.id];
        const sel = cur.startsWith('neural:' + p.id + '#');
        const speakers = p.speakers?.length ? p.speakers : [{ name: p.label.replace(/\s*\(.*\)/, ''), gender: '', accent: '' }];
        return `<div class="nv ${p.installed ? 'ok' : ''} ${sel ? 'on' : ''}"><div class="nv-h"><div><b>${esc(p.label)}${/hd/.test(p.id) ? ' <span class="hd-badge">Best quality</span>' : ''}</b><span>${esc(p.desc)}</span></div>
          ${p.installed ? `<button class="icon-btn" data-act="nv-del" data-id="${esc(p.id)}" aria-label="Delete voice">${icon('trash')}</button>`
            : dl ? `<span class="nv-pct" id="vp-${esc(p.id)}">${dl.stage || 'Downloading'} ${dl.pct || 0}%</span>`
            : `<button class="btn xs primary" data-act="nv-get" data-id="${esc(p.id)}">${icon('download')}${p.sizeMb} MB</button>`}</div>
          ${dl && !p.installed ? `<div class="prog"><i id="vpb-${esc(p.id)}" style="width:${dl.pct || 0}%"></i></div>` : ''}
          ${p.installed ? `<div class="chips-wrap">${speakers.map((sp, k) => {
            const v = `neural:${p.id}#${sp.sid ?? k}`;
            return `<button class="chip ${cur === v ? 'on' : ''}" data-act="nv-use" data-v="${esc(v)}">${cur === v ? icon('check') : ''}${esc(sp.name)}${sp.gender ? ` <small>${sp.gender === 'female' ? '♀' : '♂'} ${esc(sp.accent)}</small>` : ''}</button>`;
          }).join('')}</div>` : ''}</div>`;
      }).join('')}</div>
      ${cur.startsWith('neural:') ? `<button class="btn xs" data-act="nv-phone" style="margin-top:6px">Use the phone's own voice instead</button>` : ''}` : '';
    sheet(`<h3>Listening</h3>
      <label class="field" style="margin-top:0">What to read</label>
      <div class="seg wide"><button class="${ttsPrefs.mode === 'full' ? 'on' : ''}" data-act="tts-mode" data-v="full">Everything</button>
        <button class="${ttsPrefs.mode === 'key' ? 'on' : ''}" data-act="tts-mode" data-v="key">Abstract &amp; conclusions</button></div>
      <label class="field">Speed</label>
      <div class="rates">${RATES.map((r) => `<button class="${ttsPrefs.rate === r ? 'on' : ''}" data-act="tts-setrate" data-v="${r}">${r}×</button>`).join('')}</div>
      <div id="ttsvoices">
      ${neuralHtml}
      <label class="field">Phone voices</label>
      ${engines.length > 1 ? `<label class="field">Speech engine</label>
        <select id="ttsengine">${engines.map((e) => `<option value="${esc(e.name)}" ${info.engine === e.name ? 'selected' : ''}>${esc(e.label)}</option>`).join('')}</select>` : ''}
      <label class="field">Voice${voices.length ? ` <span class="muted small">(${voices.length})</span>` : ''}</label>
      ${voices.length ? `<div class="voice-row">${voiceSelect('ttsvoice', cur.startsWith('neural:') ? '' : ttsPrefs.voice, cur.startsWith('neural:') ? 'Phone default (not in use)' : 'Phone default')}
        <button class="btn ghost sm" data-act="tts-preview">Preview</button></div>
        <label class="field">Second voice <span class="muted small">(AI Discussion)</span></label>
        <div class="voice-row">${voiceSelect('ttsvoice2', ttsPrefs.voice2, 'Automatic')}<button class="btn ghost sm" data-act="tts-preview2">Preview</button></div>
        <p class="muted small">For more natural voices, pick the Google engine and install voices in Android Settings → Text-to-speech.</p>`
        : `<p class="muted small">${info.ready ? 'This engine has no installed voices. Install some in Android Settings → Text-to-speech.' : 'Loading voices…'}</p>`}
      </div>
      <label class="field">Skip while reading</label>
      ${Object.entries(S).map(([k, v]) => sw('skip.' + k, v.label, ttsPrefs.skip[k] ? 'Skipped' : 'Read aloud', ttsPrefs.skip[k])).join('')}
      ${sw('follow', 'Follow along', 'Scroll to the paragraph being read', ttsPrefs.follow)}`);
    $('.sheet').classList.add('tall');
    const restart = () => { if ($('#ttsbar') && !tts.script) ttsPlay(tts.index); };
    actions['tts-mode'] = (b) => { ttsPrefs.mode = b.dataset.v; saveTts(); if ($('#ttsbar') && !tts.script) { closeSheet(true); ttsPlay(0); } else ttsSheet(); };
    actions['tts-setrate'] = (b) => { ttsPrefs.rate = Number(b.dataset.v); saveTts(); Native.ttsRate(ttsPrefs.rate); $$('.js-rate, #ttsrate').forEach((e) => { e.textContent = ttsPrefs.rate + '×'; }); ttsSheet(); };
    $('#ttsvoice')?.addEventListener('change', (e) => { ttsPrefs.voice = e.target.value; saveTts(); if ($('#ttsbar')) Native.ttsVoice(ttsPrefs.voice); else Native.ttsPreview?.(ttsPrefs.voice); });
    $('#ttsvoice2')?.addEventListener('change', (e) => { ttsPrefs.voice2 = e.target.value; saveTts(); if (!$('#ttsbar')) Native.ttsPreview?.(ttsPrefs.voice2); });
    $('#ttsengine')?.addEventListener('change', (e) => { ttsPrefs.engine = e.target.value; ttsPrefs.voice = ''; ttsPrefs.voice2 = ''; saveTts(); Native.ttsEngine?.(ttsPrefs.engine); $('#ttsvoices').innerHTML = '<p class="muted small">Loading voices…</p>'; });
    actions['tts-preview'] = () => Native.ttsPreview?.($('#ttsvoice')?.value || '');
    const keepScroll = () => { const y = $('.sheet')?.scrollTop || 0; ttsSheet(); const sh = $('.sheet'); if (sh) sh.scrollTop = y; };
    actions['nv-get'] = (b) => { voiceDownloads[b.dataset.id] = { pct: 0, stage: 'Starting' }; Native.voiceDownload?.(b.dataset.id); keepScroll(); };
    actions['nv-use'] = (b) => {
      ttsPrefs.voice = b.dataset.v; saveTts();
      if ($('#ttsbar')) Native.ttsVoice(ttsPrefs.voice); else Native.ttsPreview?.(ttsPrefs.voice);
      keepScroll();
    };
    actions['nv-phone'] = () => { ttsPrefs.voice = ''; saveTts(); if ($('#ttsbar')) Native.ttsVoice(''); keepScroll(); };
    actions['nv-del'] = (b) => {
      const id = b.dataset.id;
      Native.voiceDelete?.(id);
      if ((ttsPrefs.voice || '').startsWith('neural:' + id + '#')) { ttsPrefs.voice = ''; saveTts(); if ($('#ttsbar')) Native.ttsVoice(''); }
      if ((ttsPrefs.voice2 || '').startsWith('neural:' + id + '#')) { ttsPrefs.voice2 = ''; saveTts(); }
      toast('Voice deleted');
      setTimeout(keepScroll, 300);
    };
    actions['tts-preview2'] = () => Native.ttsPreview?.($('#ttsvoice2')?.value || '');
    if (!info.ready) setTimeout(() => { if ($('#ttsvoices') && !voices.length) ttsSheet(); }, 1500);
    $$('[data-tts]').forEach((inp) => inp.addEventListener('change', () => {
      const k = inp.dataset.tts;
      if (k.startsWith('skip.')) ttsPrefs.skip[k.slice(5)] = inp.checked; else ttsPrefs[k] = inp.checked;
      saveTts();
      if (k !== 'follow') { restart(); ttsSheet(); }
    }));
  }

  /** Installed voices, for choosing the two speakers of an AI discussion. */
  function voiceList() {
    try { const r = JSON.parse(Native.ttsVoices()); return (Array.isArray(r) ? r : r.voices) || []; } catch { return []; }
  }

  // ---------------------------------------------------------------- AI core
  // Every AI feature goes through ai(): prompts are written here in the web app, the native
  // side only sends them to the configured provider (see LlmProvider.java).
  const aiPending = {};
  let aiSeq = 0;
  const aiHasKey = () => { try { return !!Native.aiHasKey?.(); } catch { return false; } };
  const AI_SYSTEM = 'You are a careful reading and study companion. Work only from the document you are given; '
    + 'if the answer is not in it, say so plainly instead of guessing. Keep numbers, doses and statistics exactly as written. '
    + 'Write in plain Markdown: short "## " headings, "- " bullets and **bold** for key facts. No tables and no preamble.';

  const aiPartial = {}; // request id -> callback(text so far), for answers shown while being written
  function aiRaw(task, { doc = '', system = AI_SYSTEM, schema = null, max = 8000, onPartial = null, fast = false } = {}) {
    return new Promise((resolve, reject) => {
      if (!aiHasKey()) { reject(new Error('NO_KEY')); return; }
      const id = 'ai' + (++aiSeq) + '_' + Date.now();
      const stream = onPartial && !schema && Native.aiRunStream;
      if (stream) aiPartial[id] = onPartial;
      // Never wait forever: long answers (deep dives, podcasts) take a minute or two, not five.
      const watchdog = setTimeout(() => {
        if (!aiPending[id]) return;
        delete aiPending[id];
        reject(new Error('The AI took too long to answer (over 5 minutes). Try again, or pick a shorter length.'));
      }, 300000);
      aiPending[id] = (evt) => { clearTimeout(watchdog); delete aiPartial[id]; if (evt.state === 'done') resolve(evt.text); else reject(new Error(evt.message || 'AI request failed')); };
      if (stream && fast && Native.aiRunStreamFast) Native.aiRunStreamFast(id, system, doc, task, max);
      else if (stream) Native.aiRunStream(id, system, doc, task, max);
      else Native.aiRun(id, system, doc, task, max, schema ? JSON.stringify(schema) : '');
    });
  }

  /** What this AI account can take per request (learned from "too large" answers), per model. */
  const aiLimitKey = () => { try { return 'aiLimit.' + (Native.aiProvider?.() || '') + '.' + (Native.aiModel?.() || ''); } catch { return 'aiLimit'; } };
  const aiMaxCap = () => store.get(aiLimitKey(), null)?.maxCap || Infinity;

  /**
   * Runs an AI task. Pass the document as docModel (preferred) or doc text. When the account's
   * per-minute limit is too small for the whole document (Groq's free tier), the most relevant
   * excerpts are sent instead: abstract/conclusions for summaries, matching paragraphs for questions.
   */
  async function ai(task, { doc = '', docModel = null, query = '', focus = 'summary', system = AI_SYSTEM, schema = null, max = 8000, onPartial = null, onWait = null, fast = false } = {}) {
    let waits = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      const lim = store.get(aiLimitKey(), null);
      const budget = lim?.chars || Infinity;
      const maxTok = Math.min(max, lim?.maxCap || max);
      let text = doc;
      let part = 1;
      if (docModel) {
        const t = modelText(docModel, { maxChars: budget === Infinity ? 700000 : budget, query, focus });
        text = t.text; part = t.fraction;
      } else if (budget !== Infinity && doc.length > budget) {
        text = doc.slice(0, budget); part = budget / doc.length;
      }
      const note = part < 0.995 ? `\n\n(Note: the full document is too long for this AI account's limit, so you are seeing selected excerpts — about ${Math.max(1, Math.round(part * 100))}% of the text. If the answer might be in the parts you can't see, say so.)` : '';
      try {
        let out = await aiRaw(task + note, { doc: text, system, schema, max: maxTok, onPartial, fast });
        // Structured answers occasionally come back as slightly broken JSON (an unescaped quote,
        // a cut-off list): ask once more for valid JSON before giving up.
        if (schema) {
          try { aiJson(out); } catch {
            out = await aiRaw(task + note + '\n\nIMPORTANT: reply with valid JSON only. Escape any double quotes inside strings as \\" and close every list and object.', { doc: text, system, schema, max: maxTok });
          }
        }
        ai.lastPartial = part;
        return out;
      } catch (e) {
        // A free per-minute limit (Groq, Gemini): wait out the minute and carry on, instead of failing.
        if (/limit (was reached|is reached)[\s\S]*wait a minute|rate limit was reached/i.test(String(e.message)) && !/daily free limit|per day/i.test(String(e.message)) && waits < 2) {
          waits++;
          attempt--;
          for (let s0 = 62; s0 > 0; s0--) { try { onWait?.(s0, String(e.message)); } catch { /* screen gone */ } await new Promise((r) => setTimeout(r, 1000)); }
          continue;
        }
        const m = String(e.message).match(/^TOO_LARGE:(\d+):(\d+)/);
        if (!m) throw e;
        const limit = +m[1], requested = +m[2];
        // The request counts input plus the answer's token allowance; keep room for both.
        const maxCap = Math.min(maxTok, Math.max(800, Math.floor(limit * 0.4)));
        const inputTok = Math.max(1, requested - maxTok);
        const charsPerTok = Math.max(2.5, (text.length + task.length + system.length) / inputTok);
        const chars = Math.max(1500, Math.floor((limit - maxCap - 700) * charsPerTok * 0.9 - task.length - system.length));
        store.set(aiLimitKey(), { chars, maxCap, limit });
      }
    }
    throw new Error("This is too large for your AI account's per-minute limit, even as excerpts. Try a shorter request, or a paid tier.");
  }
  function onAi(evt) {
    const cb = aiPending[evt.id];
    delete aiPending[evt.id];
    if (cb) cb(evt); else ext.onAiOther?.(evt);
  }
  /** Lenient JSON parse for structured answers. */
  function aiJson(text) {
    try { return JSON.parse(text); } catch { /* fall through */ }
    const m = String(text).replace(/```(?:json)?/gi, '').match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (m) {
      try { return JSON.parse(m[0]); } catch { /* try light repairs */ }
      // Light repairs: trailing commas, raw line breaks inside strings, curly quotes as delimiters.
      const fixed = m[0].replace(/,\s*([}\]])/g, '$1').replace(/[\u201c\u201d](\s*[:,}\]])/g, '"$1').replace(/([{,\[]\s*)[\u201c\u201d]/g, '$1"')
        .replace(/"(?:[^"\\]|\\.)*"/g, (str) => str.replace(/\n/g, '\\n').replace(/\t/g, '\\t'));
      try { return JSON.parse(fixed); } catch { /* give up below */ }
    }
    throw new Error('The AI answer came back in a broken format. Tap again to retry.');
  }

  /** Minimal Markdown (headings, bullets, bold, italics) plus [¶n] source links. */
  // MeSH "check tags" describe the study population, not its topic.
  const CHECK_TAGS = /^(humans?|animals?|female|male|adults?|aged|middle aged|young adult|adolescent|child|child, preschool|infant|infant, newborn|aged, 80 and over|mice|rats|retrospective studies|prospective studies|cohort studies|treatment outcome|case-control studies|cross-sectional studies|follow-up studies|risk factors|surveys and questionnaires)$/i;
  /** A short topic for a paper (first real MeSH term, keyword, or the title's main clause). */
  function topicOf(a) {
    const t = [...(a.mesh || []), ...(a.keywords || [])].find((x) => x && !CHECK_TAGS.test(String(x).replace(/\*/g, '').trim()));
    return String(t || (a.title || '').split(/[:.?]/)[0]).replace(/\*/g, '').trim().slice(0, 90);
  }
  function md(text) {
    // AI tables often put <br> inside a cell: a real line break, not the letters "<br>".
    const inline = (t) => esc(t).replace(/&lt;br\s*\/?&gt;/gi, '<br>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])_(.+?)_(?=[\s).,;:]|$)/g, '$1<i>$2</i>').replace(/(^|[\s(])\*(?!\s)(.+?)\*(?=[\s).,;:]|$)/g, '$1<i>$2</i>')
      .replace(/\[¶\s?(\d+)(?:\s*[-–,]\s*¶?\s?(\d+))*\]/g, (m0) => [...m0.matchAll(/\d+/g)].map((n) => `<button class="src" data-act="src-jump" data-b="${n[0]}">¶${n[0]}</button>`).join(''));
    let out = '', list = false, table = [];
    const cells = (l) => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    // Markdown tables become one card per row (label: value), readable on a phone.
    const flushTable = () => {
      if (!table.length) return;
      const rows = table.filter((l) => !/^\|?[\s:|-]+\|?$/.test(l)).map(cells);
      table = [];
      if (!rows.length) return;
      const [head, ...body] = rows.length > 1 ? rows : [[], ...rows];
      out += '<div class="md-table">' + body.map((r) => `<div class="md-row">${r.map((c, i) => c ? (i === 0
        ? `<div class="md-first">${inline(c)}</div>`
        : `<div class="md-cell">${head[i] ? `<span>${inline(head[i])}</span>` : ''}${inline(c)}</div>`) : '').join('')}</div>`).join('') + '</div>';
    };
    String(text).split('\n').forEach((raw) => {
      const line = raw.trim();
      if (line.startsWith('|')) { if (list) { out += '</ul>'; list = false; } table.push(line); return; }
      flushTable();
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) return;
      const li = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)/);
      if (li) { if (!list) { out += '<ul>'; list = true; } out += `<li>${inline(li[1])}</li>`; return; }
      if (list) { out += '</ul>'; list = false; }
      if (!line) return;
      const h = line.match(/^#{1,4}\s+(.*)/);
      out += h ? `<h4>${inline(h[1])}</h4>` : `<p>${inline(line)}</p>`;
    });
    flushTable();
    return out + (list ? '</ul>' : '');
  }

  /** Document text for the AI, each part tagged [¶n] with its block number so answers can cite it. */
  function modelText(model, { maxChars = 700000, query = '', focus = 'summary' } = {}) {
    const figs = new Map((model.figures || []).map((f) => [f.id, f]));
    const txt = (b) => (b.text ?? (b.html || '').replace(/<\/(li|p|tr)>/g, '\n').replace(/<\/t[dh]>/g, ' | ').replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ').trim();
    const parts = [];
    let section = '';
    let firstInSection = false;
    model.blocks.forEach((b, i) => {
      let s = '';
      let kind = 'p';
      if (b.type === 'title') { s = `# ${txt(b)}`; kind = 'title'; }
      else if (b.type === 'h') { s = `\n## ${txt(b)} [¶${i}]`; kind = 'h'; section = txt(b).toLowerCase(); firstInSection = true; }
      else if (b.type === 'p' || b.type === 'list') s = `[¶${i}] ${txt(b)}`;
      else if (b.type === 'ref') { s = `[¶${i}] ${txt(b)}`; kind = 'ref'; }
      else if ((b.type === 'fig' || b.type === 'table') && figs.has(b.id)) {
        const f = figs.get(b.id);
        s = `[¶${i}] ${f.label}: ${f.caption || ''}${f.html ? '\n' + txt({ html: f.html }) : ''}`;
        kind = 'fig';
      }
      if (!s) return;
      parts.push({ i, s, kind, section, first: kind !== 'h' && firstInSection });
      if (kind !== 'h') firstInSection = false;
    });
    const total = parts.reduce((n, p) => n + p.s.length + 1, 0);
    if (total <= maxChars) return { text: parts.map((p) => p.s).join('\n'), truncated: false, fraction: 1 };

    // Too long: keep the parts that matter most for this task, in document order.
    const words = (t) => (t.toLowerCase().match(/[a-z0-9α-ω]{4,}/g) || []).filter((w) => !/^(that|this|with|from|were|have|which|what|about|their|there|these|those|also|than|into|does|when|where|paper|study|document)$/.test(w));
    const qWords = new Set(words(query));
    const keyRe = /abstract|summary|conclusion|discussion|results|findings|key|interpretation|limitation|purpose|objective|introduction|background/;
    parts.forEach((p, n) => {
      let score = 1 - n / parts.length * 0.5; // earlier text slightly first
      if (p.kind === 'title' || p.kind === 'h') score += 10;
      if (p.kind === 'ref') score -= 5;
      if (focus === 'query' && qWords.size) {
        const w = words(p.s);
        const hits = w.filter((x) => qWords.has(x)).length;
        score += hits * 3 + (hits ? 2 : 0);
        if (/abstract|summary|conclusion/.test(p.section)) score += 1.5;
      } else {
        if (keyRe.test(p.section)) score += /abstract|summary|conclusion/.test(p.section) ? 5 : 2.5;
        if (p.first) score += 2;
        if (p.kind === 'fig') score += 0.5;
      }
      p.score = score;
    });
    const chosen = new Set();
    let used = 0;
    for (const p of [...parts].sort((a, b) => b.score - a.score)) {
      if (used + p.s.length + 1 > maxChars) continue;
      chosen.add(p.i); used += p.s.length + 1;
    }
    let out = '';
    let gap = false;
    for (const p of parts) {
      if (chosen.has(p.i)) { if (gap && out) out += '\n[…]\n'; out += p.s + '\n'; gap = false; } else gap = true;
    }
    return { text: out.trim(), truncated: true, fraction: used / total };
  }

  function jumpToBlock(i) {
    const el = $(`#rd [data-b="${i}"]`);
    if (!el) return false;
    closeSheet(true);
    ext.closePlayer?.();
    window.scrollTo({ top: el.getBoundingClientRect().top + scrollY - 90, behavior: 'smooth' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1600);
    return true;
  }
  ttsActions['src-jump'] = (b) => { if (!jumpToBlock(b.dataset.b)) toast('Open the document to see this passage'); };


  // ---------------------------------------------------------------- PDF → mobile reader
  const REFLOW_V = 7; // 7: symbol fonts (≥, ±), run-on reference lists split, broken-off headings rejoined, running heads, own DOI inside the references
  const openReader = (key) => go('pdf/' + encodeURIComponent(key));
  let pdfDoc = null; // pdf.js document for the open reader (original-pages mode)
  let readerState = null; // {model, opts} of the open reader

  async function renderPdfReader(key) {
    const s = saved.get(key);
    const title = s?.title || 'PDF';
    view.innerHTML = readerTop(title) + readerLoading('Opening PDF…');
    let model = await db.getReflow(key).catch(() => null);
    let reflowMod;
    try {
      reflowMod = await import('./reflow.js');
      if (!model || model.v !== REFLOW_V) {
        pdfDoc = await reflowMod.openPdf('/pdf/' + encodeURIComponent(key));
        model = await reflowMod.reflow(pdfDoc, (d, t) => {
          const el = $('#rdprog');
          if (el) el.textContent = `Reading page ${d} of ${t}…`;
        });
        if (s && !s.imported && !s.doc) model = reflowMod.trimToArticle(model, { title: s.title, doi: s.doi });
        model.v = REFLOW_V;
        model.key = key;
        model.kind = 'pdf';
        db.putReflow(model).catch(() => {});
      }
    } catch (e) {
      if (current.name === 'pdf') view.innerHTML = topbar(title) + `<div class="empty">${icon('file')}<b>Couldn't prepare the mobile view</b>
        <div>${esc(e.message || e)}</div><div class="spacer"></div><button class="btn small" data-act="rd-pages-native">Open original pages</button></div>`;
      actions['rd-pages-native'] = () => Native.openPdfPages(key, title);
      return;
    }
    if (current.name !== 'pdf' || current.arg !== key) return;
    showReader(model, { key, title: s?.title || model.title || title, pdf: true, reflowMod, startInPages: model.scanned });
  }

  const rprefs = Object.assign({ size: 18, font: 'serif', theme: 'auto', spacing: 'normal', fg: '#1f2933', bgc: '#fdfcf8', width: 'normal' }, store.get('reader', {}));
  // Reading themes: [background, text, label]. 'custom' uses the user's own colours.
  const RTHEMES = {
    light: ['#ffffff', '#1a1a1a', 'Light'], paper: ['#faf6ef', '#2b2620', 'Paper'], sepia: ['#f4ecd8', '#5b4636', 'Sepia'],
    mint: ['#eef7f2', '#1f3a2e', 'Mint'], rose: ['#fbf1f2', '#40262b', 'Rose'], dusk: ['#1e2430', '#d6dbe4', 'Dusk'],
    dark: ['#111317', '#d9dbe0', 'Dark'], black: ['#000000', '#c9c9c9', 'Black'],
  };
  const isDarkColor = (hex) => {
    const n = parseInt(String(hex).replace('#', ''), 16);
    if (Number.isNaN(n)) return false;
    return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) < 110;
  };
  const saveRprefs = () => store.set('reader', rprefs);

  function readerTop(title) {
    return `<div class="topbar rd-bar"><button class="icon-btn" data-act="back" aria-label="Back">${icon('back')}</button>
      <h1>${esc(title)}</h1>
      <button class="icon-btn" data-act="rd-drawer" aria-label="Contents and figures">${icon('list')}</button>
      <button class="icon-btn" data-act="ai-reader" aria-label="AI summary">${icon('spark')}</button>
      <button class="icon-btn" data-act="tts-open" aria-label="Listen">${icon('audio')}</button>
      <button class="icon-btn" data-act="rd-style" aria-label="Text settings"><span style="font:700 16px/1 var(--serif)">Aa</span></button>
      <button class="icon-btn" data-act="rd-more" aria-label="More">${icon('dots')}</button></div>
      <div class="rd-progress"><i id="rdbar"></i></div>`;
  }
  const readerLoading = (msg) => `<div class="rd-loading"><div class="spinner"></div><b>Preparing mobile view</b><span id="rdprog">${esc(msg)}</span></div>`;

  function figureHtml(f) {
    const cap = f.captionHtml ?? esc(f.caption || '');
    return `<figure class="rd-fig ${f.kind === 'table' ? 'is-table' : ''}" id="${esc(f.id)}" data-act="rd-fig" data-id="${esc(f.id)}">
      ${f.src ? `<img src="${f.src}" alt="${esc(f.label)}" loading="lazy">` : f.html ? `<div class="rd-tbl">${f.html}</div>` : ''}
      <figcaption><b>${esc(f.label)}</b>${cap ? ' ' + cap : ''}<span class="rd-zoom">${icon('zoom')}</span></figcaption></figure>`;
  }

  function blocksHtml(model) {
    let out = '';
    let refs = [];
    let h = 0;
    const figs = new Map(model.figures.map((f) => [f.id, f]));
    const flush = () => { if (refs.length) { out += `<ol class="rd-refs">${refs.join('')}</ol>`; refs = []; } };
    model.blocks.forEach((b, i) => {
      const inner = b.html ?? esc(b.text || '');
      const ai = b.ai ? ' <span class="rd-ai" title="Title written by AI">✦</span>' : '';
      if (b.type === 'ref') { refs.push(`<li data-b="${i}">${inner.replace(/^\s*(\[\d+\]|\d+\.)\s*/, '')}</li>`); return; }
      flush();
      if (b.type === 'title') out += `<h1 class="rd-title" data-b="${i}">${inner}</h1>`;
      else if (b.type === 'h') { const l = Math.min(Math.max(b.level || 3, 2), 4); out += `<h${l} class="rd-h" id="rh-${h++}" data-b="${i}">${inner}${ai}</h${l}>`; }
      else if (b.type === 'p') out += `<p data-b="${i}"${b.small ? ' class="rd-small"' : ''}${b.quote ? ' class="rd-quote"' : ''}>${inner}</p>`;
      else if (b.type === 'list') out += inner.replace(/^<(ul|ol)/, `<$1 data-b="${i}"`);
      else if ((b.type === 'fig' || b.type === 'table') && figs.has(b.id)) out += figureHtml(figs.get(b.id)).replace('<figure ', `<figure data-b="${i}" `);
    });
    flush();
    return out;
  }

  function applyReaderPrefs() {
    const el = $('.rd-page');
    if (!el) return;
    applyTheme();
    const appDark = document.documentElement.dataset.theme === 'dark';
    const key = rprefs.theme === 'auto' ? (appDark ? 'dark' : 'light') : rprefs.theme;
    const [bg, fg] = key === 'custom' ? [rprefs.bgc, rprefs.fg] : (RTHEMES[key] || RTHEMES.light);
    const dark = isDarkColor(bg);
    el.dataset.rtheme = key;
    el.dataset.font = rprefs.font;
    el.dataset.spacing = rprefs.spacing;
    el.dataset.width = rprefs.width;
    el.style.setProperty('--rsize', rprefs.size + 'px');
    el.style.setProperty('--rbg', bg);
    el.style.setProperty('--rfg', fg);
    el.style.setProperty('--rmuted', mixColor(fg, bg, 62));
    el.style.setProperty('--rline', mixColor(fg, bg, 14));
    el.style.setProperty('--rsoft', mixColor(fg, bg, 6));
    // The bars and panels follow the reading colours while reading.
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.body.dataset.rtheme = key;
    document.body.style.setProperty('--bg', bg);
    document.body.style.setProperty('--card', mixColor(fg, bg, 4));
    document.body.style.setProperty('--line', mixColor(fg, bg, 12));
  }
  // color-mix() worked out here: Safari before 16.2 (iPadOS 15) ignores it.
  function mixColor(a, b, pct) {
    const rgb = (h) => { const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(h).trim()); if (!m) return null;
      const x = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1]; return [0, 2, 4].map((k) => parseInt(x.slice(k, k + 2), 16)); };
    const A = rgb(a), B = rgb(b);
    if (!A || !B) return `color-mix(in srgb, ${a} ${pct}%, ${b})`;
    return '#' + A.map((v, k) => Math.round((v * pct + B[k] * (100 - pct)) / 100).toString(16).padStart(2, '0')).join('');
  }

  function showReader(model, opts) {
    const { key, title } = opts;
    readerState = { model, opts };
    const figs = model.figures || [];
    const tables = figs.filter((f) => f.kind === 'table');
    const images = figs.filter((f) => f.kind !== 'table');
    document.body.classList.add('reading');
    view.innerHTML = readerTop(title) + `<div class="rd-page">
      <article class="rd" id="rd">${blocksHtml(model)}</article>
      <div id="rdpages" class="hidden"></div>
      <div class="rd-end muted small">${opts.pdf ? `${model.pages || ''} pages · mobile view generated on this phone${model.ocr ? ' by text recognition' : ''}` : opts.doc ? esc(opts.endNote || 'Imported document · the original is kept on this phone') : opts.utd ? 'UpToDate topic' : 'Full text from Europe PMC'}
        ${opts.pdf ? '<br><button class="btn small" data-act="rd-toggle-pages" style="margin-top:12px">View original pages</button>' : ''}</div></div>`;
    applyReaderPrefs();

    // Reading position.
    const posKey = 'pos.' + key;
    const pos = store.get(posKey, 0);
    if (pos > 0) requestAnimationFrame(() => window.scrollTo(0, pos * (document.documentElement.scrollHeight - innerHeight)));
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        if (current.name !== 'pdf' && current.name !== 'read') { window.removeEventListener('scroll', onScroll); return; }
        const max = document.documentElement.scrollHeight - innerHeight;
        const ratio = max > 0 ? Math.min(1, scrollY / max) : 0;
        const bar = $('#rdbar');
        if (bar) bar.style.width = (ratio * 100).toFixed(1) + '%';
        store.set(posKey, ratio);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });

    const headings = $$('.rd-h', $('#rd'));
    actions['rd-drawer'] = () => openDrawer(headings, images, tables);
    actions['rd-fig'] = (b) => {
      const all = [...figs];
      lightbox(all, Math.max(0, all.findIndex((f) => f.id === b.dataset.id)));
    };
    actions['rd-goto'] = (b) => {
      closeDrawer();
      const el = document.getElementById(b.dataset.target);
      if (el) { window.scrollTo({ top: el.getBoundingClientRect().top + scrollY - 70 }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1200); }
    };
    actions['rd-style'] = () => styleSheet();
    actions['rd-toggle-pages'] = () => togglePages(opts);
    actions['rd-more'] = () => {
      sheet(`<h3>${esc(title.length > 70 ? title.slice(0, 68) + '…' : title)}</h3>
        ${opts.pdf ? `<button class="opt" data-act="rd-toggle-pages">${icon('file')}${$('#rdpages').classList.contains('hidden') ? 'Original page layout' : 'Mobile reading view'}</button>
        <button class="opt" data-act="rd-native">${icon('external')}Open in another PDF app</button>
        <button class="opt" data-act="rd-share">${icon('share')}Share PDF</button>
        <button class="opt" data-act="rd-remove-pdf">${icon('trash')}Remove this PDF (wrong file)</button>
        <button class="opt" data-act="rd-redo">${icon('spark')}Rebuild mobile view</button>` : ''}
        ${opts.article ? `<button class="opt" data-act="rd-paper">${icon('quote')}Paper details &amp; citation</button>` : ''}
        ${ext.readerMenu ? ext.readerMenu(opts, model) : ''}
        ${opts.utd ? `<button class="opt" data-act="utd-save">${icon(saved.has(key) ? 'bookmarkFill' : 'bookmark')}${saved.has(key) ? 'Saved — remove from library' : 'Save to library (offline)'}</button>
          <button class="opt" data-act="utd-refresh">${icon('spark')}Refresh from UpToDate</button>
          <button class="opt" data-act="utd-share">${icon('share')}Share link</button>
          <button class="opt" data-act="utd-open-web">${icon('external')}Open on UpToDate website</button>` : ''}`);
    };
    actions['utd-save'] = async () => {
      closeSheet();
      if (saved.has(key)) { await db.del(key); saved.delete(key); toast('Removed from library'); return; }
      const entry = { id: key, utd: true, utdUrl: opts.url, title, journal: 'UpToDate', jAbbr: 'UpToDate', year: '', types: [], abstract: '', authors: '', savedAt: Date.now(), status: 'unread', collections: [], notes: '' };
      await db.put(entry); saved.set(key, entry); toast('Saved — available offline');
    };
    actions['utd-refresh'] = async () => { closeSheet(); await db.delReflow(key).catch(() => {}); render(); };
    actions['utd-share'] = () => { closeSheet(); Native.share(title, `${title}\n${opts.url}`); };
    actions['utd-open-web'] = () => { closeSheet(); Native.openUpToDateAt(opts.url); };
    actions['rd-native'] = () => { closeSheet(); Native.openPdfPages(key, title); };
    actions['rd-share'] = () => { closeSheet(); Native.sharePdf(key, title); };
    // A wrong PDF (e.g. a site's own document) can go without losing the paper and its notes.
    actions['rd-remove-pdf'] = async () => {
      closeSheet();
      Native.deletePdf(key);
      pdfKeys.delete(key);
      await db.delReflow(key).catch(() => {});
      toast('PDF removed. The paper and its notes stay in your library.');
      history.length > 1 ? history.back() : go('library', { replace: true });
    };
    actions['rd-redo'] = async () => { closeSheet(); await db.delReflow(key).catch(() => {}); render(); };
    actions['rd-paper'] = () => { closeSheet(); go('a/' + encodeURIComponent(opts.article.id)); };
    if (opts.startInPages) togglePages(opts, true);
    ttsAttach(opts);
    ext.onReader?.(model, opts);
    if (current.params.listen === '1') setTimeout(() => ttsPlay(), 300);
    else if (current.params.b) setTimeout(() => jumpToBlock(current.params.b), 250);
  }

  async function togglePages(opts, scannedNote) {
    closeSheet(true);
    const pages = $('#rdpages');
    const rd = $('#rd');
    if (!pages.classList.contains('hidden')) { pages.classList.add('hidden'); rd.classList.remove('hidden'); window.scrollTo(0, 0); return; }
    rd.classList.add('hidden');
    pages.classList.remove('hidden');
    window.scrollTo(0, 0);
    if (pages.dataset.ready) return;
    pages.dataset.ready = '1';
    pages.innerHTML = (scannedNote ? '<div class="muted small center" style="padding:10px">This PDF is scanned, so it shows as pages.</div>' : '') + '<div class="rd-loading"><div class="spinner"></div></div>';
    try {
      const mod = opts.reflowMod || await import('./reflow.js');
      if (!pdfDoc) pdfDoc = await mod.openPdf('/pdf/' + encodeURIComponent(opts.key));
      const first = await pdfDoc.getPage(1);
      const vp = first.getViewport({ scale: 1 });
      pages.innerHTML = Array.from({ length: pdfDoc.numPages }, (_, i) =>
        `<div class="rd-pg" data-n="${i + 1}" style="aspect-ratio:${vp.width}/${vp.height}"><span>${i + 1}</span></div>`).join('');
      const io = new IntersectionObserver((entries) => {
        entries.forEach(async (en) => {
          if (!en.isIntersecting || en.target.dataset.done) return;
          en.target.dataset.done = '1';
          const c = await mod.renderPage(pdfDoc, +en.target.dataset.n, en.target.clientWidth);
          const img = new Image();
          img.src = c.toDataURL('image/jpeg', 0.9);
          img.dataset.act = 'rd-pagezoom';
          en.target.replaceChildren(img);
        });
      }, { rootMargin: '600px 0px' });
      $$('.rd-pg', pages).forEach((el) => io.observe(el));
      actions['rd-pagezoom'] = (img) => lightbox([{ id: 'p', kind: 'fig', src: img.src, label: 'Page ' + img.parentElement.dataset.n, caption: '' }], 0);
    } catch (e) {
      pages.innerHTML = errorBox(e, false);
    }
  }

  function styleSheet() {
    const seg = (name, opts, val) => `<div class="seg wide">${opts.map(([k, l]) => `<button class="${val === k ? 'on' : ''}" data-act="rs-${name}" data-v="${k}">${l}</button>`).join('')}</div>`;
    const themes = [['auto', null], ...Object.entries(RTHEMES), ['custom', [rprefs.bgc, rprefs.fg, 'Custom']]];
    sheet(`<h3>Reading settings</h3>
      <label class="field" style="margin-top:0">Text size</label>
      <div class="row" style="gap:10px"><button class="btn small" data-act="rs-size" data-v="-1" style="flex:1"><span style="font-size:13px">A−</span></button>
        <span style="min-width:44px;text-align:center;font-weight:600">${rprefs.size}</span>
        <button class="btn small" data-act="rs-size" data-v="1" style="flex:1"><span style="font-size:18px">A+</span></button></div>
      <label class="field">Colours</label>
      <div class="rthemes">${themes.map(([k, t]) => `<button class="rtheme ${rprefs.theme === k ? 'on' : ''}" data-act="rs-theme" data-v="${k}"
          style="${t ? `background:${t[0]};color:${t[1]}` : 'background:linear-gradient(135deg,#fff 50%,#111317 50%);color:#888'}"><span>Aa</span><small>${t ? t[2] : 'Auto'}</small></button>`).join('')}</div>
      ${rprefs.theme === 'custom' ? `<div class="custom-colors">
        <label>Text<input type="color" data-rc="fg" value="${esc(rprefs.fg)}"></label>
        <label>Background<input type="color" data-rc="bgc" value="${esc(rprefs.bgc)}"></label>
        <div class="presets">${[['#1f2933', '#fdfcf8'], ['#0b3d2e', '#f0f7f2'], ['#3b1f4a', '#f7f0fb'], ['#f5e6c8', '#23201a'], ['#9fe0c0', '#0e1a16'], ['#e8e8e8', '#1b1d2a']].map(([f, b]) => `<button class="preset" data-act="rs-preset" data-f="${f}" data-b="${b}" style="background:${b};color:${f}">Aa</button>`).join('')}</div></div>` : ''}
      <label class="field">Font</label>${seg('font', [['serif', 'Literata'], ['sans', 'Inter'], ['display', 'Fraunces'], ['classic', 'Georgia']], rprefs.font)}
      <label class="field">Line spacing</label>${seg('spacing', [['compact', 'Compact'], ['normal', 'Normal'], ['relaxed', 'Relaxed']], rprefs.spacing)}
      <label class="field">Margins</label>${seg('width', [['wide', 'Narrow'], ['normal', 'Normal'], ['narrow', 'Wide']], rprefs.width)}`);
    const set = (k, v) => { rprefs[k] = v; saveRprefs(); applyReaderPrefs(); styleSheet(); };
    actions['rs-size'] = (b) => set('size', Math.min(30, Math.max(13, rprefs.size + Number(b.dataset.v))));
    actions['rs-font'] = (b) => set('font', b.dataset.v);
    actions['rs-theme'] = (b) => set('theme', b.dataset.v);
    actions['rs-spacing'] = (b) => set('spacing', b.dataset.v);
    actions['rs-width'] = (b) => set('width', b.dataset.v);
    actions['rs-preset'] = (b) => { rprefs.fg = b.dataset.f; rprefs.bgc = b.dataset.b; set('theme', 'custom'); };
    $$('[data-rc]').forEach((inp) => inp.addEventListener('input', () => { rprefs[inp.dataset.rc] = inp.value; saveRprefs(); applyReaderPrefs(); }));
  }

  function openDrawer(headings, images, tables) {
    closeDrawer();
    const tab = store.get('drawerTab', 'toc');
    document.body.insertAdjacentHTML('beforeend', `<div class="drawer-bg" data-act="rd-close-drawer"></div>
      <aside class="drawer" id="drawer"><div class="drawer-head"><b>In this document</b><button class="icon-btn" data-act="rd-close-drawer">${icon('x')}</button></div>
      <div class="tabs drawer-tabs">
        <button data-act="rd-dtab" data-t="toc">Contents</button>
        <button data-act="rd-dtab" data-t="figs">Figures · ${images.length}</button>
        <button data-act="rd-dtab" data-t="tables">Tables · ${tables.length}</button></div>
      <div class="drawer-body" id="drawerbody"></div></aside>`);
    const draw = (t) => {
      store.set('drawerTab', t);
      $$('.drawer-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
      const body = $('#drawerbody');
      if (t === 'toc') {
        body.innerHTML = headings.length ? headings.map((h) => `<button class="toc-item lvl-${h.tagName[1]}" data-act="rd-goto" data-target="${h.id}">${esc(h.textContent)}</button>`).join('')
          : '<div class="empty small">No section headings found.</div>';
      } else {
        const list = t === 'figs' ? images : tables;
        body.innerHTML = list.length ? `<div class="thumbs ${t}">${list.map((f) => `<button class="thumb" data-act="rd-fig" data-id="${esc(f.id)}">
            ${f.src ? `<img src="${f.src}" alt="" loading="lazy">` : `<div class="thumb-tbl">${icon('list')}</div>`}
            <b>${esc(f.label)}</b><span>${esc(stripTags(f.captionHtml ?? f.caption ?? '').slice(0, 90))}</span></button>`).join('')}</div>
            <button class="opt" data-act="rd-goto-first" data-t="${t}">${icon('book')}Show ${t === 'figs' ? 'figures' : 'tables'} in the text</button>`
          : `<div class="empty small">No ${t === 'figs' ? 'figures' : 'tables'} found in this paper.</div>`;
      }
    };
    actions['rd-dtab'] = (b) => draw(b.dataset.t);
    actions['rd-close-drawer'] = () => closeDrawer();
    actions['rd-goto-first'] = (b) => {
      const f = (b.dataset.t === 'figs' ? images : tables)[0];
      if (f) actions['rd-goto']({ dataset: { target: f.id } });
    };
    draw(tab);
    requestAnimationFrame(() => $('#drawer')?.classList.add('open'));
  }
  function closeDrawer() { $$('.drawer, .drawer-bg').forEach((e) => e.remove()); }

  // Full-screen figure viewer with pinch-zoom, pan, double-tap and swipe.
  function lightbox(list, index) {
    closeLightbox();
    document.body.insertAdjacentHTML('beforeend', `<div class="lb" id="lb">
      <div class="lb-top"><span id="lbcount"></span><button class="icon-btn" data-act="lb-close" aria-label="Close">${icon('x')}</button></div>
      <div class="lb-stage" id="lbstage"><div class="lb-inner" id="lbinner"></div></div>
      <div class="lb-cap" id="lbcap"></div>
      ${list.length > 1 ? `<button class="lb-nav prev" data-act="lb-prev">${icon('back')}</button><button class="lb-nav next" data-act="lb-next">${icon('back')}</button>` : ''}</div>`);
    const stage = $('#lbstage'), inner = $('#lbinner');
    let i = index, scale = 1, tx = 0, ty = 0;
    const apply = () => { inner.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`; };
    const show = () => {
      const f = list[i];
      scale = 1; tx = 0; ty = 0; apply();
      inner.innerHTML = f.src ? `<img src="${f.src}" alt="">` : `<div class="rd-tbl lb-tbl">${f.html || ''}</div>`;
      $('#lbcount').textContent = list.length > 1 ? `${f.label} · ${i + 1} of ${list.length}` : f.label;
      $('#lbcap').innerHTML = `<b>${esc(f.label)}</b> ${f.captionHtml ?? esc(f.caption || '')}`;
    };
    actions['lb-close'] = () => closeLightbox();
    actions['lb-prev'] = () => { i = (i - 1 + list.length) % list.length; show(); };
    actions['lb-next'] = () => { i = (i + 1) % list.length; show(); };
    const pts = new Map();
    let start = null, lastTap = 0;
    stage.addEventListener('pointerdown', (e) => {
      stage.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const p = [...pts.values()];
      start = { scale, tx, ty, p: p.map((q) => ({ ...q })), t: Date.now() };
    });
    stage.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId) || !start) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const p = [...pts.values()];
      if (p.length >= 2 && start.p.length >= 2) {
        const d0 = Math.hypot(start.p[0].x - start.p[1].x, start.p[0].y - start.p[1].y);
        const d1 = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
        scale = Math.min(6, Math.max(1, start.scale * (d1 / (d0 || 1))));
        const m0 = { x: (start.p[0].x + start.p[1].x) / 2, y: (start.p[0].y + start.p[1].y) / 2 };
        const m1 = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
        tx = start.tx + (m1.x - m0.x); ty = start.ty + (m1.y - m0.y);
        apply();
      } else if (p.length === 1 && scale > 1) {
        tx = start.tx + (p[0].x - start.p[0].x); ty = start.ty + (p[0].y - start.p[0].y);
        apply();
      }
    });
    const end = (e) => {
      if (!pts.has(e.pointerId)) return;
      const q = pts.get(e.pointerId);
      pts.delete(e.pointerId);
      if (start && start.p.length === 1 && pts.size === 0) {
        const dx = q.x - start.p[0].x, dy = q.y - start.p[0].y;
        if (scale === 1 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && list.length > 1) {
          dx < 0 ? actions['lb-next']() : actions['lb-prev']();
        } else if (Math.abs(dx) < 8 && Math.abs(dy) < 8 && Date.now() - start.t < 250) {
          if (Date.now() - lastTap < 300) {
            if (scale > 1) { scale = 1; tx = 0; ty = 0; } else {
              const r = stage.getBoundingClientRect();
              scale = 2.5; tx = (r.width / 2 - (q.x - r.left)) * 1.5; ty = (r.height / 2 - (q.y - r.top)) * 1.5;
            }
            apply(); lastTap = 0;
          } else lastTap = Date.now();
        }
      }
      if (scale <= 1.02) { scale = 1; tx = 0; ty = 0; apply(); }
      const p = [...pts.values()];
      start = p.length ? { scale, tx, ty, p: p.map((x) => ({ ...x })), t: Date.now() } : null;
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    show();
  }
  function closeLightbox() { $('#lb')?.remove(); }

  // ---------------------------------------------------------------- journals
  const hueFor = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const colorFor = (s) => `hsl(${hueFor(s)} 45% 42%)`;
  const coverStyle = (s) => { const h = hueFor(s); return `background:linear-gradient(140deg,hsl(${h} 58% 46%),hsl(${(h + 38) % 360} 62% 28%))`; };
  const initials = (j) => j.abbr.replace(/[^A-Za-z ]/g, '').split(' ').filter((w) => w.length > 1 || /[A-Z]/.test(w)).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
  const journalHash = (j) => 'j/' + encodeURIComponent(j.custom ? 'issn:' + j.issn : j.abbr);

  function jrow(j) {
    const on = follows.includes(j.abbr);
    return `<div class="jrow"><div class="avatar" style="${coverStyle(j.abbr)}">${esc(initials(j))}</div>
      <button class="open" data-act="journal" data-abbr="${esc(j.abbr)}"><div class="name">${esc(j.name)}</div>
      <div class="sub">${esc(j.abbr)} · ${esc(j.publisher)}${j.oa ? ' · <span style="color:var(--good)">Open access</span>' : ''}</div></button>
      <button class="star ${on ? 'on' : ''}" data-act="follow" data-abbr="${esc(j.abbr)}" aria-label="Follow">${icon(on ? 'starFill' : 'star')}</button></div>`;
  }
  function jcover(j) {
    return `<button class="jcover" data-act="journal" data-abbr="${esc(j.abbr)}">
      <div class="jcover-art" style="${coverStyle(j.abbr)}"><span>${esc(initials(j))}</span><small>${esc(j.publisher)}</small></div>
      <b>${esc(j.abbr)}</b></button>`;
  }

  function renderJournals() {
    const followed = JOURNALS.filter((j) => follows.includes(j.abbr));
    view.innerHTML = `<div class="large-title"><h1>Journals</h1><span class="muted small">${JOURNALS.length} dermatology journals</span></div>
      <label class="search-inline">${icon('search')}<input id="jfilter" placeholder="Filter journals" autocomplete="off"></label>
      <div id="jlist">
        ${followed.length ? `<div class="section"><div class="section-h"><h3>Following</h3></div>
          <div class="scroll-x covers">${followed.map(jcover).join('')}</div></div>` : ''}
        ${JOURNAL_GROUPS.map((g) => `<div class="section"><div class="section-h"><h3>${esc(g)}</h3></div><div class="list-card">${JOURNALS.filter((j) => j.group === g).map(jrow).join('')}</div></div>`).join('')}
        <div class="section"><div class="section-h"><h3>Discover more</h3></div>
          <button class="btn full" data-act="discover" style="width:100%">${icon('globe')}Find other dermatology journals</button>
          <div id="discover" class="list-card" style="margin-top:10px"></div></div>
      </div>`;
    $('#jfilter').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      if (!q) { renderJournals(); return; }
      $('#jlist').innerHTML = `<div class="section"><div class="list-card">${JOURNALS.filter((j) => (j.name + ' ' + j.abbr + ' ' + j.publisher).toLowerCase().includes(q)).map(jrow).join('') || '<div class="empty"><b>No match</b></div>'}</div></div>`;
    });
    actions.discover = async (btn) => {
      btn.disabled = true;
      const el = $('#discover');
      el.innerHTML = skeletons(2);
      try {
        const j = await getJSON(`${OPENALEX}sources?search=dermatology&sort=cited_by_count:desc&per_page=50&select=display_name,issn_l,summary_stats,is_oa,works_count,host_organization_name`);
        const known = new Set(JOURNALS.map((x) => x.issn).filter(Boolean));
        const list = j.results.filter((s) => s.issn_l && !known.has(s.issn_l) && s.works_count > 200 && s.summary_stats?.['2yr_mean_citedness'] > 0);
        el.innerHTML = list.map((s) => `<div class="jrow"><div class="avatar" style="${coverStyle(s.display_name)}">${esc(s.display_name.replace(/[^A-Z]/g, '').slice(0, 3) || 'J')}</div>
          <button class="open" data-act="journal-issn" data-issn="${esc(s.issn_l)}" data-name="${esc(s.display_name)}"><div class="name">${esc(s.display_name)}</div>
          <div class="sub">${esc(s.host_organization_name || '')} · h-index ${s.summary_stats.h_index}${s.is_oa ? ' · Open access' : ''}</div></button></div>`).join('') || '<div class="muted small">Nothing new found.</div>';
      } catch (e) { el.innerHTML = errorBox(e, false); }
    };
    actions['journal-issn'] = (b) => go(`j/issn:${encodeURIComponent(b.dataset.issn)}?name=${encodeURIComponent(b.dataset.name)}`);
  }

  function journalFromArg(arg, params) {
    let j = journalByAbbr.get(arg.toLowerCase());
    if (!j && arg.startsWith('issn:')) {
      const issn = arg.slice(5);
      j = journalByIssn.get(issn) || { name: params.name || issn, abbr: params.name || issn, issn, publisher: '', custom: true };
    }
    return j;
  }

  // Crossref: publishers register every item (research letters, images, comments too) as soon as
  // it's out, weeks before PubMed / Europe PMC tag it with a volume and issue. Used to complete
  // issue lists and contents.
  const CROSSREF = hasNative ? '/proxy/crossref/' : 'https://api.crossref.org/';
  const crossrefCache = new Map();
  const crYear = (x) => ((x['published-print'] || x.published || {})['date-parts'] || [[0]])[0][0];
  async function crossrefYear(j, y) {
    if (!j.issn) return [];
    const key = `${j.issn}|${y}`;
    if (crossrefCache.has(key)) return crossrefCache.get(key);
    const run = crossrefFetch(j, y);
    crossrefCache.set(key, run);
    return run;
  }
  async function crossrefFetch(j, y) {
    const p = new URLSearchParams({ filter: `from-pub-date:${y - 1}-10-01,until-pub-date:${y}-12-31`, rows: '1000',
      select: 'DOI,title,volume,issue,page,author,published,published-print,type', mailto: 'app@dermscholar.app' });
    let items = [];
    try {
      const r = await Promise.race([getJSON(`${CROSSREF}journals/${encodeURIComponent(j.issn)}/works?${p}`),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000))]);
      items = (r.message?.items || []).filter((x) => x.volume && x.issue && x.title?.[0]);
    } catch { items = []; }
    return items;
  }

  // Issues come from Europe PMC's volume/issue tags on each article, one year at a time, topped up
  // from Crossref. Both are asked at once; Crossref (slow) gets a few seconds and otherwise fills
  // in afterwards (out.more). The issue list is also kept on the phone, so a journal opens at once
  // and refreshes in the background.
  const issueCache = new Map();
  const issueNum = (x) => { const n = parseInt(x, 10); return Number.isNaN(n) ? -1 : n; };
  const yearKey = (j, y) => `ds.jy.${j.issn || j.abbr}|${y}`;
  let yearsPulled = 0; // pull-to-refresh: kept lists show, but are fetched again
  const yearFresh = (y, t) => t > yearsPulled && Date.now() - t < (y >= THIS_YEAR - 1 ? 6 * 3600e3 : 14 * 86400e3);
  function storedYear(j, y) {
    try { const d = JSON.parse(localStorage.getItem(yearKey(j, y)) || 'null'); return d && Array.isArray(d.issues) ? d : null; } catch { return null; }
  }
  function storeYear(j, y, out) {
    try { localStorage.setItem(yearKey(j, y), JSON.stringify({ t: Date.now(), issues: out.issues, inPressN: out.inPress.length, total: out.total })); } catch { /* full */ }
  }
  function mergeYear(y, items, crItems) {
    const groups = new Map();
    const inPress = [];
    for (const r of items) {
      if (!r.journalVolume || !r.issue) { inPress.push(r); continue; }
      const k = `${r.journalVolume}|${r.issue}`;
      const g = groups.get(k) || { v: r.journalVolume, i: r.issue, count: 0, oa: 0 };
      g.count++;
      if (r.isOpenAccess === 'Y') g.oa++;
      groups.set(k, g);
    }
    // Issues PubMed hasn't filled in yet (or at all): count them from Crossref.
    const cr = new Map();
    for (const x of crItems) {
      if (crYear(x) !== +y) continue;
      const k = `${x.volume}|${x.issue}`;
      cr.set(k, (cr.get(k) || 0) + 1);
    }
    for (const [k, n] of cr) {
      const [v, i] = k.split('|');
      const g = groups.get(k) || { v, i, count: 0, oa: 0 };
      g.count = Math.max(g.count, n);
      groups.set(k, g);
    }
    const issues = [...groups.values()].sort((a, b) => issueNum(b.v) - issueNum(a.v) || issueNum(b.i) - issueNum(a.i) || String(a.i).localeCompare(String(b.i)));
    inPress.sort((a, b) => (b.firstPublicationDate || '').localeCompare(a.firstPublicationDate || ''));
    return { issues, inPress, total: items.length };
  }
  async function loadYear(j, y) {
    const key = `${j.abbr}|${y}`;
    if (issueCache.has(key)) return issueCache.get(key);
    const crP = crossrefYear(j, y);
    const q = `${journalQuery(j)} AND PUB_YEAR:${y} ${NOISE}`;
    const items = [];
    let cursor = '*';
    for (let page = 0; page < 3 && cursor; page++) {
      const p = new URLSearchParams({ query: q, format: 'json', resultType: 'lite', pageSize: 1000, cursorMark: cursor });
      const r = await getJSON(EPMC + 'search?' + p);
      items.push(...(r.resultList?.result || []));
      cursor = r.nextCursorMark && r.nextCursorMark !== cursor && items.length < r.hitCount ? r.nextCursorMark : null;
    }
    const crItems = await Promise.race([crP, new Promise((res) => setTimeout(() => res(null), 1500))]);
    const out = mergeYear(y, items, crItems || []);
    if (!crItems) {
      out.more = crP.then((cr) => {
        const full = mergeYear(y, items, cr);
        issueCache.set(key, full);
        storeYear(j, y, full);
        return full;
      });
    }
    issueCache.set(key, out);
    storeYear(j, y, out);
    return out;
  }
  const issueHash = (j, v, i) => `ji/${encodeURIComponent(j.custom ? 'issn:' + j.issn : j.abbr)}/${encodeURIComponent(v)}/${encodeURIComponent(i)}`;
  const issueLabel = (g) => (/^\d+$/.test(g.i) ? `Issue ${g.i}` : /^s\d*$|suppl/i.test(g.i) ? `Supplement ${g.i.replace(/^s|supplementary\s*/i, '')}`.trim() : `Issue ${g.i}`);

  async function renderJournal(arg, params) {
    const j = journalFromArg(arg, params);
    if (!j) return go('journals', { replace: true });
    const tab = params.t || 'issues';
    const on = follows.includes(j.abbr);
    const nav = (patch) => go(`j/${encodeURIComponent(arg)}?${new URLSearchParams(Object.fromEntries(Object.entries({ ...params, ...patch }).filter(([, v]) => v !== '' && v != null)))}`, { replace: true });
    view.innerHTML = `${topbar(j.abbr, { right: `<button class="icon-btn" data-act="j-share" aria-label="Share">${icon('share')}</button>` })}
      <section class="jhero">
        <div class="jhero-art" style="${coverStyle(j.abbr)}"><span>${esc(j.custom ? 'J' : initials(j))}</span></div>
        <div class="jhero-body"><h2>${esc(j.name)}</h2><div class="muted small">${esc(j.publisher)}${j.oa ? ' · Open access' : ''}</div>
          <div class="row" style="gap:8px;margin-top:10px">
            ${j.custom ? '' : `<button class="btn xs ${on ? 'good' : 'primary'}" data-act="follow" data-abbr="${esc(j.abbr)}" data-style="btn">${icon(on ? 'check' : 'plus')}${on ? 'Following' : 'Follow'}</button>`}
            <button class="btn xs" data-act="j-home">${icon('globe')}Website</button>
            <button class="btn xs" data-act="j-r4l">${icon('key')}R4L</button></div></div>
      </section>
      <div class="jstats" id="jstats">${['h-index', 'Cites / paper (2y)', 'Papers'].map((l) => `<div class="stat"><b>…</b><span>${l}</span></div>`).join('')}</div>
      <form class="search-inline" data-form="jsearch">${icon('search')}<input name="q" placeholder="Search in this journal" value="${esc(params.q || '')}" enterkeyhint="search"></form>
      <div class="tabs scroll-tabs">${[['issues', 'Issues'], ['latest', 'Latest'], ['press', 'In press'], ['cited', 'Most cited'], ['reviews', 'Reviews']].map(([k, l]) => `<button class="${tab === k && !params.q ? 'on' : ''}" data-act="jtab" data-t="${k}">${l}</button>`).join('')}</div>
      <div id="jarts">${skeletons(4)}</div>`;

    let homepage = null;
    actions.jtab = (b) => nav({ t: b.dataset.t, q: '' });
    actions['j-home'] = () => (homepage ? Native.openPortal(homepage, '', '') : toast('Website not known yet'));
    actions['j-r4l'] = () => { Native.copy(j.name); toast('Journal name copied — paste it into Research4Life'); Native.openPortal(PORTAL, '', ''); };
    actions['j-share'] = () => Native.share(j.name, `${j.name}${j.publisher ? ' (' + j.publisher + ')' : ''}${homepage ? '\n' + homepage : ''}${j.issn ? '\nISSN ' + j.issn : ''}\n\nShared from DermScholar`);
    $('[data-form=jsearch]').addEventListener('submit', (e) => { e.preventDefault(); nav({ q: e.target.q.value.trim() }); });

    const statsUrl = j.issn ? `${OPENALEX}sources/issn:${j.issn}` : `${OPENALEX}sources?search=${encodeURIComponent(j.name)}&per_page=1`;
    getJSON(statsUrl).then((d) => {
      const s = d.results ? d.results[0] : d;
      if (!s || !$('#jstats')) return;
      homepage = s.homepage_url;
      const v = [s.summary_stats?.h_index ?? '—', s.summary_stats?.['2yr_mean_citedness'] != null ? s.summary_stats['2yr_mean_citedness'].toFixed(2) : '—', fmt(s.works_count)];
      $$('#jstats b').forEach((b, i) => { b.textContent = v[i]; });
    }).catch(() => { $$('#jstats b').forEach((b) => { b.textContent = '—'; }); });

    const el = $('#jarts');
    if (tab === 'issues' && !params.q) return renderIssuesTab(j, params, nav, el);
    if (tab === 'press' && !params.q) {
      try {
        const [a, b] = await Promise.all([loadYear(j, THIS_YEAR), loadYear(j, THIS_YEAR - 1)]);
        const list = [...a.inPress, ...b.inPress].map(normalize);
        if (!el.isConnected) return;
        el.innerHTML = list.length ? `<div class="meta-line">${list.length} articles published online ahead of an issue</div>${list.slice(0, 60).map((x) => card(x, { compact: true })).join('')}`
          : '<div class="empty"><b>Nothing in press</b><div>All recent articles are already in issues.</div></div>';
      } catch (e) { el.innerHTML = errorBox(e); }
      return;
    }
    let q = journalQuery(j) + (params.q ? ` AND (${params.q})` : '');
    let sort = 'P_PDATE_D desc';
    if (tab === 'cited' && !params.q) { q += ` AND PUB_YEAR:[${THIS_YEAR - 2} TO ${THIS_YEAR}]`; sort = 'CITED desc'; }
    if (tab === 'reviews' && !params.q) q += ' AND (PUB_TYPE:"Review" OR PUB_TYPE:"Meta-Analysis" OR PUB_TYPE:"Systematic Review")';
    q += ' ' + NOISE;
    let next = '*';
    const load = async (btn) => {
      try {
        const res = await epmcSearch(q, { sort, cursor: next });
        next = res.next;
        if (!el.isConnected) return;
        if (btn) btn.remove(); else el.innerHTML = params.q ? `<div class="meta-line">${fmt(res.hit)} results for “${esc(params.q)}”</div>` : '';
        el.insertAdjacentHTML('beforeend', res.results.map((a) => card(a, { compact: true })).join('') || '<div class="empty"><b>No articles</b></div>');
        if (next) el.insertAdjacentHTML('beforeend', '<button class="more" data-act="jmore">Load more</button>');
      } catch (e) { if (el.isConnected) el.innerHTML = errorBox(e); }
    };
    actions.jmore = (b) => { b.disabled = true; b.textContent = 'Loading…'; load(b); };
    load();
  }

  async function renderIssuesTab(j, params, nav, el) {
    const years = Array.from({ length: 8 }, (_, k) => THIS_YEAR - k);
    const y = Number(params.y) || THIS_YEAR;
    const yearChips = `<div class="scroll-x" style="margin:8px -16px 12px">${years.map((yy) => `<button class="chip ${yy === y ? 'on' : ''}" data-act="jyear" data-y="${yy}">${yy}</button>`).join('')}</div>`;
    actions.jyear = (b) => nav({ y: b.dataset.y });
    actions['open-issue'] = (b) => go(issueHash(j, b.dataset.v, b.dataset.i));
    const paint = (data, current) => {
      if (!el.isConnected) return;
      const inPressN = data.inPress ? data.inPress.length : data.inPressN || 0;
      const tiles = data.issues.map((g) => `<button class="issue-tile" data-act="open-issue" data-v="${esc(g.v)}" data-i="${esc(g.i)}">
          <span class="issue-vol">Vol ${esc(g.v)}</span><b>${esc(issueLabel(g))}</b><span class="muted small">${g.count} articles${g.oa ? ` · ${g.oa} open` : ''}</span></button>`).join('');
      el.innerHTML = yearChips + (current ? `<button class="current-issue" data-act="open-issue" data-v="${esc(current.v)}" data-i="${esc(current.i)}" style="${coverStyle(j.abbr)}">
          <span class="ci-label">Current issue</span><b>Volume ${esc(current.v)} · ${esc(issueLabel(current))}</b>
          <span>${current.count} articles · open table of contents →</span></button>` : '') +
        (data.issues.length ? `<div class="section-h" style="margin-top:18px"><h3>${y} issues</h3><span class="muted small">${data.issues.length}</span></div><div class="issue-grid">${tiles}</div>`
          : `<div class="empty"><b>No issues found for ${y}</b><div>Europe PMC may not list issue numbers for this journal.</div></div>`) +
        (inPressN && y >= THIS_YEAR - 1 ? `<button class="btn full" style="width:100%;margin-top:14px" data-act="jtab" data-t="press">${icon('clock')}${inPressN} articles in press</button>` : '');
    };
    // Early in the year the newest issues may still be last year's.
    const currentOf = async (data, stored) => {
      if (y !== THIS_YEAR) return null;
      if (data.issues[0]) return data.issues[0];
      const prev = stored ? storedYear(j, THIS_YEAR - 1) : null;
      return (prev || (await loadYear(j, THIS_YEAR - 1))).issues[0] || null;
    };
    const kept = storedYear(j, y);
    if (kept) paint(kept, await currentOf(kept, true));
    else el.innerHTML = yearChips + skeletons(3);
    if (kept && yearFresh(y, kept.t)) return;
    try {
      const data = await loadYear(j, y);
      paint(data, await currentOf(data));
      if (data.more) data.more.then(async (full) => paint(full, await currentOf(full))).catch(() => {});
    } catch (e) { if (el.isConnected && !kept) el.innerHTML = yearChips + errorBox(e); }
  }

  const SECTION_ORDER = ['Systematic reviews & meta-analyses', 'Clinical trials', 'Original research', 'Reviews & guidelines', 'Case reports', 'Letters, comments & editorials'];
  function sectionOf(a) {
    const l = studyType(a).label;
    if (l === 'Meta-analysis' || l === 'Systematic review') return SECTION_ORDER[0];
    if (l === 'RCT' || l === 'Clinical trial') return SECTION_ORDER[1];
    if (l === 'Review' || l === 'Guideline') return SECTION_ORDER[3];
    if (l === 'Case report') return SECTION_ORDER[4];
    if (l === 'Commentary' || /^(letter|comment|editorial|reply|correspondence|research letter)/i.test(a.title)) return SECTION_ORDER[5];
    return SECTION_ORDER[2];
  }

  async function renderIssue(arg) {
    const [ja, v, i] = arg.split('/').map(decodeURIComponent);
    const j = journalFromArg(ja, {});
    if (!j) return go('journals', { replace: true });
    view.innerHTML = `${topbar(`${j.abbr} · Vol ${v}`, { right: `<button class="icon-btn" data-act="issue-share" aria-label="Share">${icon('share')}</button>` })}${skeletons(5)}`;
    const q = `${journalQuery(j)} AND VOLUME:"${v}" AND ISSUE:"${i}" ${NOISE}`;
    // The issue's year, if the issue list was opened before: start Crossref now, alongside Europe PMC.
    const knownYear = Array.from({ length: 8 }, (_, k) => THIS_YEAR - k)
      .find((y) => storedYear(j, y)?.issues.some((g) => String(g.v) === String(v) && String(g.i) === String(i)));
    if (j.issn && knownYear) crossrefYear(j, knownYear);
    const all = [];
    try {
      let cursor = '*';
      for (let n = 0; n < 4 && cursor; n++) {
        const res = await epmcSearch(q, { cursor, size: 100 });
        all.push(...res.results);
        cursor = res.next && all.length < res.hit ? res.next : null;
      }
    } catch (e) { view.innerHTML = topbar(j.abbr) + errorBox(e); return; }
    if (current.name !== 'ji') return;
    const firstPage = (a) => { const m = String(a.pages || '').match(/\d+/); return m ? +m[0] : 1e9; };
    all.sort((a, b) => firstPage(a) - firstPage(b));
    const date = all.find((a) => a.pubDate)?.pubDate || '';
    const bySection = new Map(SECTION_ORDER.map((s) => [s, []]));
    all.forEach((a) => bySection.get(sectionOf(a)).push(a));
    view.innerHTML = `${topbar(`${j.abbr} · Vol ${v}`, { right: `<button class="icon-btn" data-act="issue-share" aria-label="Share">${icon('share')}</button>` })}
      <section class="issue-hero" style="${coverStyle(j.abbr)}">
        <span class="ci-label">${esc(j.name)}</span>
        <h2>Volume ${esc(v)} · ${esc(issueLabel({ i }))}</h2>
        <span>${esc(date)}${date ? ' · ' : ''}<span id="issue-n">${all.length}</span> articles</span>
        <div class="row" style="gap:8px;margin-top:12px"><button class="btn xs glass" data-act="issue-share">${icon('share')}Share contents</button>
          <button class="btn xs glass" data-act="issue-toc">${icon('list')}Sections</button></div>
      </section>
      ${[...bySection.entries()].filter(([, l]) => l.length).map(([sec, list], k) => `<div class="section" id="sec-${k}"><div class="section-h"><h3>${esc(sec)}</h3><span class="muted small">${list.length}</span></div>
        ${list.map((a) => card(a, { compact: true })).join('')}</div>`).join('') || '<div class="empty" id="issue-none"><b>No articles listed</b></div>'}
      <div id="issue-extra"></div>`;
    const here = view.firstElementChild;
    // Items Crossref lists for this issue that Europe PMC doesn't have yet (Crossref is slow, so
    // they're added once it answers).
    if (j.issn) {
      (async () => {
        const years = all.length ? [+all[0].year] : knownYear ? [knownYear] : [THIS_YEAR, THIS_YEAR - 1];
        const have = new Set(all.map((a) => (a.doi || '').toLowerCase()).filter(Boolean));
        const extra = [];
        for (const items of await Promise.all(years.map((y) => crossrefYear(j, y)))) {
          for (const x of items) {
            if (String(x.volume) === String(v) && String(x.issue) === String(i) && !have.has(x.DOI.toLowerCase())) {
              have.add(x.DOI.toLowerCase());
              extra.push(x);
            }
          }
        }
        const box = $('#issue-extra');
        if (!extra.length || !box || view.firstElementChild !== here) return;
        $('#issue-none')?.remove();
        $('#issue-n').textContent = all.length + extra.length;
        box.innerHTML = `<div class="section"><div class="section-h"><h3>Also in this issue</h3><span class="muted small">${extra.length}</span></div>
        <p class="muted small" style="margin-top:-6px">Listed by the publisher; not in PubMed yet (or not indexed there, like images and comments).</p>
        ${extra.sort((a, b) => (parseInt(a.page, 10) || 1e9) - (parseInt(b.page, 10) || 1e9)).map((x) => `<div class="card" role="button" tabindex="0" data-act="cr-open" data-doi="${esc(x.DOI)}">
          <p class="title main">${esc(stripTags(x.title[0]))}</p>
          <div class="byline">${x.author?.length ? `<span>${esc(x.author[0].family || x.author[0].name || '')}${x.author.length > 1 ? ' et al.' : ''}</span>` : ''}<span class="${x.author?.length ? 'dot' : ''}">${esc(j.abbr)}${x.page ? ' · p. ' + esc(x.page) : ''}</span></div></div>`).join('')}</div>`;
      })().catch(() => {});
    }
    // Open it as a paper if Europe PMC knows the DOI; otherwise at the publisher (through Research4Life).
    actions['cr-open'] = async (b) => {
      const doi = b.dataset.doi;
      try {
        const r = await epmcSearch(`DOI:"${doi}"`, { size: 1 });
        if (r.results[0]) { cache.set(r.results[0].id, r.results[0]); go('a/' + encodeURIComponent(r.results[0].id)); return; }
      } catch { /* not indexed */ }
      Native.openPortal(R4L_PROXY + 'doi_org/' + doi, '', '');
    };
    actions['issue-share'] = () => {
      const lines = all.slice(0, 40).map((a) => `• ${a.title}${a.doi ? '\n  https://doi.org/' + a.doi : ''}`).join('\n');
      Native.share(`${j.abbr} Vol ${v} ${issueLabel({ i })}`, `${j.name}\nVolume ${v}, ${issueLabel({ i })}${date ? ' (' + date + ')' : ''}\n\n${lines}${all.length > 40 ? `\n…and ${all.length - 40} more` : ''}\n\nShared from DermScholar`);
    };
    actions['issue-toc'] = () => {
      const secs = [...bySection.entries()].map(([sec, l], k) => [sec, l.length, k]).filter(([, n]) => n);
      sheet(`<h3>Sections</h3>${secs.map(([sec, n, k]) => `<button class="opt" data-act="goto-sec" data-k="${k}">${icon('list')}${esc(sec)}<span class="chk muted">${n}</span></button>`).join('')}`);
      actions['goto-sec'] = (b) => { closeSheet(); const el = $('#sec-' + b.dataset.k); if (el) window.scrollTo({ top: el.getBoundingClientRect().top + scrollY - 70, behavior: 'smooth' }); };
    };
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
    if (filter === 'offline') items = items.filter((a) => pdfKeys.has(a.id) || a.fullText || a.doc);
    if (filter.startsWith('t-')) items = items.filter((a) => (a.docType || (a.utd ? 'document' : 'paper')) === filter.slice(2));
    if (coll) items = items.filter((a) => (a.collections || []).includes(coll));
    if (q) items = items.filter((a) => [a.title, a.authors, a.journal, a.notes, ...(a.keywords || [])].join(' ').toLowerCase().includes(q));
    const nav = (patch) => go('library?' + new URLSearchParams(Object.fromEntries(Object.entries({ f: filter, c: coll, q: p.q || '', ...patch }).filter(([, v]) => v))), { replace: true });

    view.innerHTML = `${topbar(`Library · ${saved.size}`, { back: false, right: `<button class="icon-btn" data-act="settings" aria-label="Settings">${icon('settings')}</button>` })}
      <label class="search-inline">${icon('search')}<input id="lq" placeholder="Search titles, notes, authors" value="${esc(p.q || '')}" autocomplete="off"></label>
      ${ext.libraryTop ? ext.libraryTop(p) : ''}
      <div class="scroll-x" style="margin-top:8px">
        ${[['all', 'All'], ['unread', 'To read'], ['read', 'Read'], ['offline', 'Offline'], ['pdf', 'PDFs'], ['t-paper', 'Papers'], ['t-book', 'Books'], ['t-article', 'Articles'], ['t-notes', 'Study material'], ['t-document', 'Documents']].map(([k, l]) => `<button class="chip ${filter === k ? 'on' : ''}" data-act="lf" data-v="${k}">${l}</button>`).join('')}
      </div>
      <div class="scroll-x" style="margin-top:8px">
        ${collections.map((c) => `<button class="chip ${coll === c ? 'on' : ''}" data-act="lc" data-v="${esc(c)}">${icon('folder')}${esc(c)}</button>`).join('')}
        <button class="chip" data-act="new-collection">${icon('plus')}Collection</button>
      </div>
      <div class="lib-tools">
        <button class="btn small primary" data-act="add-doc">${icon('plus')}Add document</button>
        <button class="btn small" data-act="go-notes">${icon('note')}My notes</button>
        <button class="btn small" data-act="export" ${saved.size ? '' : 'disabled'}>${icon('download')}Export</button>
        <button class="btn small" data-act="lib-clean" ${saved.size ? '' : 'disabled'}>${icon('trash')}Clean up</button>
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
    actions['lib-remove'] = (b) => {
      const a = saved.get(b.dataset.id);
      if (!a) return;
      sheet(`<h3>Remove from library?</h3><p class="muted">${esc(a.title)}</p>
        <p class="muted small">Its notes${pdfKeys.has(a.id) ? ' and offline PDF' : ''} are deleted too.</p>
        <div class="actions"><button class="btn" data-act="close-sheet">Cancel</button><button class="btn primary" data-act="lib-remove-ok">Remove</button></div>`);
      actions['lib-remove-ok'] = async () => { closeSheet(true); await removeFromLibrary([a.id]); toast('Removed from library'); render(); };
    };
    actions['lib-clean'] = () => {
      const all = [...saved.values()].filter((a) => !a.utd);
      const noPdf = all.filter((a) => !a.imported && !pdfKeys.has(a.id) && !a.fullText && !a.doc && !a.notes);
      const read = all.filter((a) => a.status === 'read');
      sheet(`<h3>Clean up the library</h3>
        <button class="opt" data-act="lib-clean-go" data-k="nopdf" ${noPdf.length ? '' : 'disabled'}>${icon('trash')}<span>Remove papers without a PDF<small>${noPdf.length} saved papers with no PDF, full text or notes</small></span></button>
        <button class="opt" data-act="lib-clean-go" data-k="read" ${read.length ? '' : 'disabled'}>${icon('check')}<span>Remove papers marked read<small>${read.length} paper${read.length === 1 ? "" : "s"}, with notes and PDFs</small></span></button>
        <p class="muted small">To remove one paper, tap the bin on its card.</p>`);
      actions['lib-clean-go'] = (bb) => {
        const list = bb.dataset.k === 'read' ? read : noPdf;
        sheet(`<h3>Remove ${list.length} paper${list.length === 1 ? '' : 's'}?</h3><p class="muted small">This can't be undone.</p>
          <div class="actions"><button class="btn" data-act="close-sheet">Cancel</button><button class="btn primary" data-act="lib-clean-ok">Remove</button></div>`);
        actions['lib-clean-ok'] = async () => { closeSheet(true); await removeFromLibrary(list.map((a) => a.id)); toast(`Removed ${list.length}`); render(); };
      };
    };
  }

  function libCard(a) {
    const st = { unread: '', reading: '<span class="badge b-review">Reading</span>', read: '<span class="badge">Read</span>' }[a.status] || '';
    if (a.utd) return utdCard(a);
    return `<div class="card" role="button" tabindex="0" data-act="${a.imported ? 'open-imported' : 'open'}" data-id="${esc(a.id)}">
      <p class="title main">${esc(a.title)}</p>
      <div class="byline"><span>${esc(a.jAbbr || a.journal || '')}${a.year ? ' · ' + esc(a.year) : ''}</span>
        ${a.notes ? `<span class="dot">${icon('note').replace('<svg', '<svg style="width:13px;height:13px;display:inline;vertical-align:-2px"')} notes</span>` : ''}</div>
      <div class="badges">${st}${badgesFor(a, { compact: true })}${a.fullText ? `<span class="badge b-review">${icon('book')}Full text offline</span>` : ''}
        ${(a.collections || []).map((c) => `<span class="badge">${esc(c)}</span>`).join('')}</div>
      ${ext.cardExtra ? ext.cardExtra(a) : ''}
      <div class="card-actions">${a.imported ? '' : pdfAction(a)}<button class="icon-btn lib-del" data-act="lib-remove" data-id="${esc(a.id)}" aria-label="Remove from library">${icon('trash')}</button></div></div>`;
  }
  /** Removes papers from the library with their notes and offline PDFs. */
  async function removeFromLibrary(ids) {
    for (const id of ids) {
      await db.del(id).catch(() => {});
      saved.delete(id);
      if (pdfKeys.has(id)) { Native.deletePdf(id); pdfKeys.delete(id); }
      jobs.delete(id);
    }
    renderTray();
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
  function ama(a) {
    const au = authorList(a);
    const names = au.length > 6 ? au.slice(0, 3).join(', ') + ', et al' : au.join(', ');
    return `${names ? names + '. ' : ''}${a.title}. ${a.jAbbr || a.journal}. ${a.year}${a.volume ? ';' + a.volume : ''}${a.issue ? '(' + a.issue + ')' : ''}${a.pages ? ':' + a.pages : ''}.${a.doi ? ' doi:' + a.doi : ''}`;
  }
  function harvard(a) {
    const au = authorList(a).map((n) => { const [last, ini = ''] = n.split(/\s+(?=[A-Z]+$)/); return `${last}, ${ini.split('').join('.')}${ini ? '.' : ''}`; });
    const names = au.length > 3 ? au[0] + ' et al.' : au.length > 1 ? au.slice(0, -1).join(', ') + ' and ' + au[au.length - 1] : au[0] || '';
    return `${names} (${a.year}) '${a.title}', ${a.journal}${a.volume ? ', ' + a.volume : ''}${a.issue ? '(' + a.issue + ')' : ''}${a.pages ? ', pp. ' + a.pages : ''}.${a.doi ? ' doi:' + a.doi + '.' : ''}`;
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
    const fmts = { Vancouver: vancouver(a), 'AMA / JAAD / JAMA Derm': ama(a), 'BJD / Harvard': harvard(a), APA: apa(a), BibTeX: bibtex(a), RIS: ris(a) };
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
      <button class="opt" data-act="exp" data-f="txt">${icon('quote')}Reference list (Vancouver)</button>
      <button class="opt" data-act="exp" data-f="ama">${icon('quote')}Reference list (AMA / JAAD)</button>
      <button class="opt" data-act="exp" data-f="harv">${icon('quote')}Reference list (BJD / Harvard)</button>`);
    const real = items.filter((a) => !a.imported);
    actions.exp = (b) => {
      const f = b.dataset.f;
      const out = {
        ris: [real.map(ris).join('\n\n'), 'application/x-research-info-systems'],
        bib: [real.map(bibtex).join('\n\n'), 'application/x-bibtex'],
        csv: [csv(real), 'text/csv'],
        txt: [real.map((a, i) => `${i + 1}. ${vancouver(a)}`).join('\n'), 'text/plain'],
        ama: [real.map((a, i) => `${i + 1}. ${ama(a)}`).join('\n'), 'text/plain'],
        harv: [real.map(harvard).sort().join('\n'), 'text/plain'],
      }[f];
      Native.exportText(`dermscholar-${stamp}.${{ ama: 'txt', harv: 'txt' }[f] || f}`, out[0], out[1]);
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
  const ACCENTS = { ocean: '#2563eb', teal: '#0d9488', violet: '#7c3aed', rose: '#e11d48', amber: '#d97706', forest: '#16a34a', indigo: '#4f46e5', slate: '#475569' };
  const BG_LIGHT = { white: ['#ffffff', 'White'], paper: ['#faf6ef', 'Paper'], mist: ['#f3f6fb', 'Mist'], mint: ['#f1faf6', 'Mint'], blush: ['#fdf4f5', 'Blush'] };
  const BG_DARK = { graphite: ['#0f1115', 'Graphite'], midnight: ['#0b1224', 'Midnight'], forest: ['#0c1512', 'Forest'], amoled: ['#000000', 'Black'] };

  function renderSettings() {
    const pdfCount = pdfKeys.size;
    const mb = (Number(Native.storageBytes()) / 1048576).toFixed(1);
    const sw = (k, title, sub) => `<div class="setting"><div class="body"><b>${title}</b><span>${sub}</span></div>
      <label class="switch"><input type="checkbox" data-set="${k}" ${settings[k] ? 'checked' : ''}><span></span></label></div>`;
    const accRow = (p) => {
      const acc = account(p);
      const P = PROVIDERS[p];
      return `<div class="acc-card"><div class="acc-ico ${p}">${icon(p === 'utd' ? 'book' : 'key')}</div>
        <div class="body"><b>${P.name}</b><span>${acc.saved ? 'Login saved: ' + esc(acc.user) + (p === 'utd' ? (store.get('utdLoggedIn', false) ? ' · signed in' : ' · not yet verified') : '') : 'Not saved'}</span></div>
        <button class="btn xs ${acc.saved ? '' : 'primary'}" data-act="acc-set" data-p="${p}">${acc.saved ? 'Change' : 'Add login'}</button>
        ${acc.saved ? `<button class="icon-btn" data-act="acc-forget" data-p="${p}" aria-label="Forget">${icon('trash')}</button>` : ''}${p === 'spr' ? srcSwitch('spr') : ''}</div>`;
    };
    const collegeRow = () => {
      const px = collegeProxy();
      const acc = account('px');
      return `<div class="acc-card"><div class="acc-ico px">${icon('key')}</div>
        <div class="body"><b>College proxy</b><span>${px.host ? esc(px.host) + ':' + px.port + (acc.saved ? ' · login ' + esc(acc.user) : ' · no login saved') : 'Not set — your college EZproxy (address, port, login)'}</span></div>
        <button class="btn xs ${px.host ? '' : 'primary'}" data-act="px-set">${px.host ? 'Change' : 'Add'}</button>
        ${px.host ? `<button class="icon-btn" data-act="px-forget" aria-label="Remove">${icon('trash')}</button>${srcSwitch('px')}` : ''}</div>`;
    };
    const myloftRow = () => `<div class="acc-card"><div class="acc-ico">${icon('key')}</div>
        <div class="body"><b>MyLOFT</b><span>${srcOn('myloft') ? 'Offered when the other sources don\'t have a paper' : 'Off: not offered'}</span></div>${srcSwitch('myloft')}</div>`;
    view.innerHTML = `${topbar('Settings')}
      <div class="section"><div class="section-h"><h3>Appearance</h3></div>
        <div class="panel">
          <label class="field" style="margin-top:0">Mode</label>
          <div class="seg wide">${['system', 'light', 'dark'].map((t) => `<button class="${settings.theme === t ? 'on' : ''}" data-act="theme" data-t="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>
          <label class="field">Accent colour</label>
          <div class="swatches">${Object.entries(ACCENTS).map(([k, c]) => `<button class="swatch ${settings.accent === k ? 'on' : ''}" data-act="accent" data-v="${k}" style="--sw:${c}" aria-label="${k}"></button>`).join('')}</div>
          <label class="field">Light background</label>
          <div class="swatches">${Object.entries(BG_LIGHT).map(([k, [c, l]]) => `<button class="bgswatch ${settings.bgLight === k ? 'on' : ''}" data-act="bg-light" data-v="${k}" style="--sw:${c}"><i></i>${l}</button>`).join('')}</div>
          <label class="field">Dark background</label>
          <div class="swatches">${Object.entries(BG_DARK).map(([k, [c, l]]) => `<button class="bgswatch dark ${settings.bgDark === k ? 'on' : ''}" data-act="bg-dark" data-v="${k}" style="--sw:${c}"><i></i>${l}</button>`).join('')}</div>
          <p class="muted small" style="margin:12px 0 0">Reading colours and fonts for papers are in the reader's <b>Aa</b> menu.</p>
        </div></div>
      <div class="section"><div class="section-h"><h3>Accounts</h3></div>
        ${r4lAccounts()}${accRow('utd')}${accRow('spr')}${collegeRow()}${myloftRow()}
        <p class="muted small">Switches: use a source for Get PDF or not. Switching off keeps its login.</p>
        <p class="muted small">Passwords are encrypted with this phone's keystore and only sent to the provider's own sign-in page.</p></div>
      ${ext.settingsSection ? ext.settingsSection() : ''}
      <div class="section"><div class="section-h"><h3>Bottom bar</h3></div>
        ${sw('showUTD', 'Show UpToDate tab', 'Quick access from anywhere in the app')}
        ${sw('showR4L', 'Show Research4Life tab', 'Get PDF works without it; hide it if you never browse R4L')}</div>
      <div class="section"><div class="section-h"><h3>Search &amp; PDFs</h3></div>
        ${sw('derm', 'Dermatology focus by default', 'Limit results to skin-related papers')}
        ${sw('preprints', 'Include preprints', 'Show papers that are not yet peer reviewed')}
        ${sw('autoOpen', 'Open PDFs when downloaded', 'Otherwise they just save, with an Open button')}
        <div class="setting"><div class="body"><b>Default sort</b><span>${esc(SORTS[settings.sort].label)}</span></div>
          <button class="btn small" data-act="set-sort">Change</button></div></div>
      <div class="section"><div class="section-h"><h3>Storage</h3></div>
        <div class="stats" style="margin-top:0"><div class="stat"><b>${saved.size}</b><span>Saved papers</span></div>
          <div class="stat"><b>${pdfCount}</b><span>Offline PDFs</span></div><div class="stat"><b>${mb} MB</b><span>PDF storage</span></div></div>
        <div class="spacer"></div>
        <button class="btn small" data-act="clear-history">Clear search history</button></div>
      <div class="section"><div class="section-h"><h3>About</h3></div>
        <p class="small muted">DermScholar ${esc(Native.version())}. Paper data from <b>Europe PMC</b> (PubMed, PMC and more); journal metrics from <b>OpenAlex</b>.
        "Key finding" is taken from each abstract's own conclusion. It is not a medical recommendation. Fonts: Inter, Literata, Fraunces (SIL OFL); PDF engine: pdf.js.</p></div>`;
    $$('[data-src]').forEach((el) => el.addEventListener('change', () => { setSrc(el.dataset.src, el.checked); ext.secretsChanged?.(); render(); }));
    $$('[data-set]').forEach((el) => el.addEventListener('change', () => { settings[el.dataset.set] = el.checked; saveSettings(); searchCache.clear(); applyNav(); }));
    actions['set-sort'] = () => pickOne('Default sort', Object.fromEntries(Object.entries(SORTS).map(([k, v]) => [k, v.label])), settings.sort, (v) => { settings.sort = v; saveSettings(); render(); });
    const keepScroll = (fn) => { const y = scrollY; fn(); saveSettings(); applyTheme(); render(); requestAnimationFrame(() => window.scrollTo(0, y)); };
    actions.theme = (b) => keepScroll(() => { settings.theme = b.dataset.t; });
    actions.accent = (b) => keepScroll(() => { settings.accent = b.dataset.v; });
    actions['bg-light'] = (b) => keepScroll(() => { settings.bgLight = b.dataset.v; if (settings.theme === 'dark') settings.theme = 'light'; });
    actions['bg-dark'] = (b) => keepScroll(() => { settings.bgDark = b.dataset.v; if (settings.theme === 'light') settings.theme = 'dark'; });
  }

  function r4lAccounts() {
    let list = [];
    try { list = JSON.parse(Native.listAccounts ? Native.listAccounts('r4l') : '[]'); } catch { list = []; }
    if (!list.length) { const a = account('r4l'); if (a.saved) list = [{ user: a.user, active: true }]; }
    return `<div class="acc-card acc-multi"><div class="acc-ico r4l">${icon('key')}</div>
      <div class="body"><b>Research4Life</b><span>${!srcOn('r4l') ? 'Off: Get PDF skips it (logins kept)' : list.length ? `${list.length} account${list.length > 1 ? 's' : ''} · Get PDF tries the others if one fails` : 'Not saved'}</span></div>
      <button class="btn xs primary" data-act="acc-add" data-p="r4l">${icon('plus')}Add</button>${srcSwitch('r4l')}</div>
      ${list.map((a) => `<div class="acc-sub"><span class="acc-dot ${a.active ? 'on' : ''}"></span><b>${esc(a.user)}</b>${a.active ? '<span class="badge b-oa">Active</span>' : `<button class="btn xs" data-act="acc-use" data-u="${esc(a.user)}">Use</button>`}
        <button class="icon-btn" data-act="acc-remove" data-u="${esc(a.user)}" aria-label="Remove">${icon('trash')}</button></div>`).join('')}`;
  }

  function applyTheme() {
    const dark = settings.theme === 'dark' || (settings.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    const root = document.documentElement;
    root.dataset.theme = dark ? 'dark' : 'light';
    root.dataset.accent = settings.accent;
    root.dataset.bg = dark ? settings.bgDark : settings.bgLight;
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
    ...ttsActions,
    back: () => App.back(),
    home: () => go(''),
    settings: () => go('settings'),
    retry: () => { searchCache.clear(); render(); },
    tab: (b) => switchTab(b.dataset.tab),
    'close-sheet': () => closeSheet(),
    open: (b) => go('a/' + encodeURIComponent(b.dataset.id)),
    'open-imported': (b) => (saved.get(b.dataset.id)?.doc ? go('doc/' + encodeURIComponent(b.dataset.id)) : openReader(b.dataset.id)),
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
    'card-share': (b) => {
      const a = saved.get(b.dataset.id) || cache.get(b.dataset.id);
      if (a) Native.share(a.title, `${a.title}\n${[a.jAbbr || a.journal, a.year].filter(Boolean).join(' ')}\n${doiUrl(a) || (a.pmid ? 'https://pubmed.ncbi.nlm.nih.gov/' + a.pmid : '')}`);
    },
    'r4l-account': () => signInSheet('r4l', null),
    'r4l-forget': () => { (Native.forgetCredentials ? Native.forgetCredentials('r4l') : Native.r4lForget()); toast('Research4Life sign-in removed'); render(); },
    'r4l-open': () => Native.openPortal(PORTAL, '', ''),
    'acc-set': (b) => signInSheet(b.dataset.p, null),
    // The college's EZproxy, used as an internet proxy (the address and port from the APN
    // settings, and the login its pop-up asks for): Get PDF tries the college's access first.
    'px-set': () => {
      const px = collegeProxy();
      const acc = account('px');
      sheet(`<h3>College proxy</h3>
        <p class="muted small" style="margin-top:-4px">Your college's EZproxy: the proxy address and port (as in your phone's APN settings) and the username and password its pop-up asks for. Get PDF then tries your college's access first, on mobile data or Wi-Fi. Stored on this device only.</p>
        <form data-form="px">
          <label class="field">Proxy address</label><input type="text" name="h" value="${esc(px.host || '')}" placeholder="ezproxy.yourcollege.edu" autocapitalize="none" autocomplete="off">
          <label class="field">Port</label><input type="number" name="port" value="${px.port || 8080}" inputmode="numeric">
          <label class="field">Username</label><input type="text" name="u" value="${esc(acc.user || '')}" autocomplete="username" autocapitalize="none">
          <label class="field">Password</label><input type="password" name="p" autocomplete="current-password" placeholder="${acc.saved ? '(saved — leave empty to keep)' : ''}">
          ${px.supported === false ? '<p class="small" style="color:var(--danger,#c33)">This phone\'s Android System WebView is too old to use a proxy: update it from the Play Store.</p>' : ''}
          ${px.ios16 ? '<p class="small muted">On this iPad/iPhone (before iOS 17) the app can\'t set the proxy itself: also set it in Settings → Wi-Fi → ⓘ → Configure Proxy → Manual. The app then answers the password pop-up by itself.</p>' : ''}
          <div class="actions"><button type="button" class="btn" data-act="px-cancel">Cancel</button><button class="btn primary">Save</button></div>
        </form>`);
      const form = $('[data-form=px]');
      actions['px-cancel'] = () => closeSheet(true);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const h = form.h.value.trim(); const port = parseInt(form.port.value, 10) || 0;
        const u = form.u.value.trim(); const p = form.p.value;
        if (!h || !port) { toast('Enter the proxy address and port'); return; }
        if (u && p) Native.setCredentials('px', u, p);
        else if (u && !acc.saved) { toast('Enter the password too'); return; }
        Native.setCollegeProxy?.(h, port);
        ext.secretsChanged?.();
        closeSheet(true);
        toast('College proxy saved');
        render();
      });
    },
    'px-forget': () => { Native.setCollegeProxy?.('', 0); Native.forgetCredentials('px'); toast('College proxy removed'); render(); },
    'acc-forget': (b) => { Native.forgetCredentials(b.dataset.p); ext.secretsChanged?.(); toast(`${PROVIDERS[b.dataset.p].name} sign-in removed`); render(); },
    'utd-open': () => go(utdHash('')),
    'acc-add': () => signInSheet('r4l', null),
    'acc-use': (b) => { Native.setActiveAccount('r4l', b.dataset.u); toast(`Using ${b.dataset.u} for Research4Life`); render(); },
    'acc-remove': (b) => { Native.removeAccount('r4l', b.dataset.u); toast('Account removed'); render(); },
    listen: (b) => {
      const id = b.dataset.id;
      if (pdfKeys.has(id)) go('pdf/' + encodeURIComponent(id) + '?listen=1');
      else go('read/' + encodeURIComponent(id) + '?listen=1');
    },
    'tts-settings-open': () => ttsSheet(),
    'utd-search': (b) => go(utdHash(b.dataset.q || '')),
    'utd-topic': (b) => go(utdTopicHash(b.dataset.url)),
    'lib-offline': () => go('library?f=offline'),
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
      $$(`[data-act=follow][data-abbr="${CSS.escape(abbr)}"]`).forEach((s) => {
        if (s.dataset.style === 'btn') { s.className = `btn xs ${on ? 'good' : 'primary'}`; s.innerHTML = `${icon(on ? 'check' : 'plus')}${on ? 'Following' : 'Follow'}`; return; }
        s.classList.toggle('on', on); s.innerHTML = icon(on ? 'starFill' : 'star');
      });
      toast(on ? 'Following — new articles appear on Search' : 'Unfollowed');
    },
  };

  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[data-utd]');
    if (link) {
      e.preventDefault();
      const u = link.dataset.utd;
      if (/\/contents\/image/i.test(u)) Native.openUpToDateAt(u); else go(utdTopicHash(u.split('#')[0]));
      return;
    }
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
  // Figures that can't load (offline, or blocked by the image host) collapse to their caption.
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (img.tagName !== 'IMG') return;
    if (img.closest('.rd-fig')) img.replaceWith(Object.assign(document.createElement('div'), { className: 'rd-noimg', textContent: 'Image available when online' }));
    else if (img.closest('.thumb')) img.replaceWith(Object.assign(document.createElement('div'), { className: 'thumb-tbl', textContent: '—' }));
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && e.target.matches('.searchbox textarea')) {
      e.preventDefault();
      e.target.form.requestSubmit();
    }
  });
  document.addEventListener('input', (e) => {
    if (e.target.matches('.searchbox textarea')) { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }
  });

  function applyNav() {
    $('#nav [data-tab=portal]')?.classList.toggle('hidden', !settings.showR4L);
    $('#nav [data-tab=utd]')?.classList.toggle('hidden', !settings.showUTD);
  }
  // Where each bottom tab was left: switching back returns there; tapping the tab you're on goes
  // to its main page (tabPlace is kept by render()).
  function switchTab(tab) {
    if (tab === 'portal') { Native.openPortal(PORTAL, '', ''); return; }
    if (tab === 'utd') { go(utdHash('')); return; }
    const target = { search: '', intel: 'intel', journals: 'journals', library: 'library' }[tab];
    if (parseHash().name === (target || 'home')) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    const here = TAB_OF[parseHash().name];
    const back = tabPlace[tab];
    go(here !== tab && back && back !== target ? back : target);
  }
  $$('#nav button').forEach((b) => {
    b.querySelector('[data-icon]').innerHTML = icon(b.querySelector('[data-icon]').dataset.icon);
    b.addEventListener('click', () => switchTab(b.dataset.tab));
  });

  // ---------------------------------------------------------------- download tray
  function renderTray() {
    let el = $('#tray');
    if (!jobs.size) { el?.remove(); return; }
    if (!el) { document.body.insertAdjacentHTML('beforeend', '<div id="tray" class="tray"></div>'); el = $('#tray'); }
    el.innerHTML = [...jobs.entries()].slice(-3).map(([key, j]) => {
      const t = esc(j.title.length > 70 ? j.title.slice(0, 68) + '…' : j.title);
      if (j.state === 'running') {
        return `<div class="tray-row"><span class="spin"></span><div class="tray-body"><b>${t}</b><span>${esc(j.message)}</span></div>
          <button class="icon-btn" data-act="tray-cancel" data-id="${esc(key)}" aria-label="Cancel">${icon('x')}</button></div>`;
      }
      if (j.state === 'saved') {
        return `<div class="tray-row ok">${icon('check')}<div class="tray-body"><b>${t}</b><span>PDF saved to your library</span></div>
          <button class="btn xs primary" data-act="tray-open" data-id="${esc(key)}">Open</button>
          <button class="icon-btn" data-act="tray-dismiss" data-id="${esc(key)}" aria-label="Dismiss">${icon('x')}</button></div>`;
      }
      return `<div class="tray-row bad">${icon('alert')}<div class="tray-body"><b>${t}</b><span>${esc(j.message)}</span></div>
        ${j.canShow && actions.myloft ? `<button class="btn xs primary" data-act="tray-myloft" data-id="${esc(key)}">MyLOFT</button>` : ''}
        ${j.canShow ? `<button class="btn xs" data-act="tray-show" data-id="${esc(key)}">Show page</button>` : ''}
        ${j.state === 'failed' && Native.fetchTrail ? `<button class="btn xs" data-act="tray-trail" data-id="${esc(key)}">Details</button>` : ''}
        <button class="icon-btn" data-act="tray-dismiss" data-id="${esc(key)}" aria-label="Dismiss">${icon('x')}</button></div>`;
    }).join('');
  }
  Object.assign(actions, {
    'tray-open': (b) => { jobs.delete(b.dataset.id); renderTray(); openReader(b.dataset.id); },
    'tray-dismiss': (b) => { jobs.delete(b.dataset.id); renderTray(); refreshCards(); },
    // Where Get PDF went, page by page, to copy and send when it fails.
    'tray-trail': (b) => {
      let t = '';
      try { t = Native.fetchTrail(b.dataset.id) || ''; } catch { /* old app */ }
      const text = `Get PDF: ${saved.get(b.dataset.id)?.title || b.dataset.id}\n${jobs.get(b.dataset.id)?.message || ''}\n\nPages:\n${t || '(none recorded)'}`;
      sheet(`<h3>Where Get PDF went</h3><pre class="trail">${esc(text)}</pre>
        <button class="btn primary full" data-act="trail-copy">${icon('file')}Copy</button>`);
      actions['trail-copy'] = () => { Native.copy(text); closeSheet(); };
    },
    'tray-cancel': (b) => { Native.cancelFetch(b.dataset.id); jobs.delete(b.dataset.id); renderTray(); refreshCards(); },
    // Research4Life couldn't get it: hand the paper to MyLOFT (title/DOI copied, PDF comes back by Share).
    'tray-myloft': (b) => { jobs.delete(b.dataset.id); renderTray(); refreshCards(); actions.myloft?.(b); },
    'tray-show': (b) => {
      const j = jobs.get(b.dataset.id);
      jobs.delete(b.dataset.id); renderTray(); refreshCards();
      // After signing in on the page, coming back retries the paper by itself.
      retryAfterPage = b.dataset.id;
      Native.showFetchPage(b.dataset.id, j?.doi || '', j?.title || '');
    },
  });

  // ---------------------------------------------------------------- native bridge
  window.App = {
    back() {
      if ($('.sheet')) { closeSheet(); return true; }
      if ($('#lb')) { closeLightbox(); return true; }
      if ($('#drawer')) { closeDrawer(); return true; }
      const name = parseHash().name;
      if (depth > 0) {
        setDepth(depth - 1);
        const was = location.hash;
        window.history.back();
        // No step there after all (the app was restarted): the page above instead.
        setTimeout(() => { if (location.hash === was) { const up = parentOf(parseHash()); setDepth(0); location.replace('#/' + (up || '')); } }, 400);
        return true;
      }
      const up = parentOf(parseHash());
      if (up) { location.replace('#/' + up); return true; }
      if (name !== 'home') { location.replace('#/'); return true; }
      return false;
    },
    async onResume() {
      if (pendingUtdRetry) { pendingUtdRetry = false; if (['search', 'utd'].includes(current.name)) render(); }
      const before = pdfKeys.size;
      const added = await syncPdfs();
      const retry = retryAfterPage;
      retryAfterPage = null;
      if (retry && !pdfKeys.has(retry)) {
        const a = saved.get(retry);
        if (a?.doi) { toast('Trying the PDF again with your sign-in…'); getPdf(a, { skipAsk: true }); }
      }
      let cleared = false;
      for (const [k, j] of jobs) if (j.state === 'failed' && pdfKeys.has(k)) { jobs.delete(k); cleared = true; }
      if (cleared) renderTray();
      if (added || pdfKeys.size !== before) {
        if (added) toast(`${added} PDF${added > 1 ? 's' : ''} added to your library`);
        if (current.name === 'library' && added) render(); else refreshCards();
      }
    },
    async onNative(evt) {
      if (evt.type === 'pdfReceived' || evt.type === 'pdfImported') {
        await syncPdfs();
        pdfKeys.add(evt.key);
        // Read the PDF's own DOI/title and file it under the right paper (MyLOFT queue, papers
        // waiting for a PDF, or a new library entry), whatever order PDFs come back in.
        if (ext.identifyPdf) {
          try {
            const k = await ext.identifyPdf(evt);
            if (k && k !== evt.key) {
              const old = evt.key;
              pdfKeys.delete(old);
              if (saved.get(old)?.imported) { await db.del(old).catch(() => {}); saved.delete(old); }
              evt = { ...evt, key: k, attached: true, title: saved.get(k)?.title || evt.title };
              await syncPdfs();
              pdfKeys.add(k);
            }
          } catch { /* keep it where it landed */ }
        }
        // A PDF attached to a paper (MyLOFT, Add PDF from phone…) that wasn't saved yet: save the
        // full paper (title, journal, abstract), not just a bare "imported PDF" entry.
        const s0 = saved.get(evt.key);
        if ((!s0 || s0.imported) && /^[A-Z]{3}_/.test(evt.key)) {
          try {
            const a = cache.get(evt.key) || await fetchPaper(evt.key);
            if (a) {
              const entry = { ...a, savedAt: s0?.savedAt || Date.now(), status: 'unread', collections: [], notes: '' };
              await db.put(entry);
              saved.set(entry.id, entry);
            }
          } catch { /* keep the basic entry */ }
        }
        if (current.name === 'library') render();
        if (jobs.has(evt.key)) { jobs.delete(evt.key); renderTray(); }
        toast(evt.attached ? `PDF saved to “${(evt.title || '').slice(0, 50)}”` : 'PDF added to your library');
        openReader(evt.key);
        return;
      }
      if (evt.type === 'tts') { onTts(evt); return; }
      if (evt.type === 'voiceProgress' || evt.type === 'voiceReady' || evt.type === 'voiceError') { onVoiceEvent(evt); return; }
      if (evt.type === 'aiPartial') { try { aiPartial[evt.id]?.(evt.text); } catch { /* screen changed */ } return; }
      if (evt.type === 'ai') { onAi(evt); return; }
      if (evt.type === 'utdResults' || evt.type === 'utdTopic') {
        const k = evt.type === 'utdResults' ? 'search' : 'topic';
        const f = utdWait[k];
        utdWait[k] = null;
        if (f) f(evt);
        if (evt.state === 'results' || evt.state === 'ok' || evt.state === 'empty') store.set('utdLoggedIn', true);
        if (evt.state === 'login') store.set('utdLoggedIn', false);
        return;
      }
      if (evt.type === 'utdStatus') {
        const el = $('#utd-status') || $('#rdprog');
        if (el) el.textContent = evt.message;
        return;
      }
      if (evt.type === 'fetchDone') {
        // iPhone app: its browser closed without a PDF — no row left behind.
        if (jobs.get(evt.key)?.state === 'running') { jobs.delete(evt.key); renderTray(); refreshCards(); }
        return;
      }
      if (evt.type === 'fetchStatus') {
        const j = jobs.get(evt.key);
        if (j) { j.state = 'running'; j.message = evt.message; j.at = Date.now(); renderTray(); }
      } else if (evt.type === 'pdfSaved') {
        // Make sure it is this paper (a site's home page once gave the DOI Foundation's trademark PDF).
        const paper = saved.get(evt.key);
        if (paper && !paper.imported && ext.checkPdf && !(await ext.checkPdf(evt.key, paper))) {
          Native.deletePdf(evt.key);
          pdfKeys.delete(evt.key);
          const j0 = jobs.get(evt.key) || { title: paper.title };
          jobs.set(evt.key, { ...j0, state: 'failed', canShow: true, message: 'The PDF that came back was a different document, not this paper, so it wasn\'t saved. Tap Show page to get it yourself, or try MyLOFT.' });
          renderTray();
          refreshCards();
          return;
        }
        pdfKeys.add(evt.key);
        const j = jobs.get(evt.key) || { title: saved.get(evt.key)?.title || 'PDF' };
        jobs.set(evt.key, { ...j, state: 'saved', message: 'Saved to your library' });
        renderTray();
        refreshCards();
        if (settings.autoOpen && !['pdf', 'read'].includes(current.name)) openReader(evt.key);
        setTimeout(() => { if (jobs.get(evt.key)?.state === 'saved') { jobs.delete(evt.key); renderTray(); } }, 12000);
      } else if (evt.type === 'fetchFailed' || evt.type === 'pdfFailed') {
        const j = jobs.get(evt.key) || { title: saved.get(evt.key)?.title || 'PDF' };
        jobs.set(evt.key, { ...j, state: 'failed', message: evt.message, canShow: !!evt.canShow });
        renderTray();
        refreshCards();
        if (evt.notInR4L && actions.myloft) {
          // Not in Research4Life: remember the journal and offer MyLOFT right away.
          const a = saved.get(evt.key);
          const k = a && !/^10\.1016\//.test(a.doi || '') && journalKey(a);
          if (k && !notInR4L().includes(k)) store.set('notInR4L', [...notInR4L(), k].slice(-300));
          // The tray offers MyLOFT; it is not opened by itself (the owner picks R4L or MyLOFT).
        }
      } else if (ext.events[evt.type]) {
        ext.events[evt.type](evt);
      }
    },
  };

  // ---------------------------------------------------------------- shared with studio.js
  window.DS = {
    Native, ext, $, $$, esc, icon, md, sheet, closeSheet, toast, store, db, go, render, actions, settings, saveSettings,
    epmcSearch, buildQuery, studyType, card, badgesFor, keywordTerms, journalQuery, getJSON, findArticle, pickOne, pickMany,
    topicOf, loadSaved, account, waitingPaper: () => { const w = store.get('myloftWaiting', null); return w && Date.now() - w.t < 24 * 3600e3 ? w : null; }, getPdf, searchHash, filtersFrom, skeletons, shortAuthors, NOISE, DERM_FILTER, DERM_WORDS, TYPE_FILTERS, THIS_YEAR, hasNative,
    topbar, errorBox, coverStyle, hueFor, saveArticle, openReader, showReader, readerTop, readerLoading, lightbox,
    ttsPlay, ttsPlayScript, ttsSheet, ttsPrefs, saveTts, ttsTimes, indexAfterSeconds, sectionStart, sectionEnd, nextSection, prevSection,
    voiceList, RATES, ai, aiJson, aiHasKey, aiMaxCap, modelText, jumpToBlock, copyText, syncPdfs, refreshPdfs, stripTags,
    speechReady, REFLOW_V, updateSaved, DERM_X, quality,
    addCollection: (n) => { if (n && !collections.includes(n)) { collections.push(n); store.set('collections', collections); } }, get collections() { return collections; },
    get tts() { return tts; }, get speech() { return speech; }, get saved() { return saved; }, get cache() { return cache; },
    get current() { return current; }, get reader() { return readerState; }, get pdfKeys() { return pdfKeys; },
    set onSheetClose(f) { onSheetClose = f; },
  };

  // ---------------------------------------------------------------- start
  applyTheme();
  applyNav();
  (async () => {
    try { await loadSaved(); await syncPdfs(); } catch { /* library unavailable */ }
    // Papers whose PDF arrived before they were saved show as bare "imported" entries: fill in
    // their details in the background (title, journal, abstract), once.
    setTimeout(async () => {
      for (const s0 of [...saved.values()].filter((x) => x.imported && /^[A-Z]{3}_/.test(x.id)).slice(0, 20)) {
        try {
          const a = await fetchPaper(s0.id);
          if (a) { const e = { ...a, savedAt: s0.savedAt, status: s0.status || 'unread', collections: s0.collections || [], notes: s0.notes || '' }; await db.put(e); saved.set(e.id, e); }
        } catch { /* offline: try next start */ }
      }
    }, 4000);
    render();
    try {
      const r = Native.consumeReceived && Native.consumeReceived();
      const list = r ? JSON.parse(r) : [];
      for (const e of Array.isArray(list) ? list : [list]) await App.onNative(e);
    } catch { /* nothing shared */ }
  })();
})();
