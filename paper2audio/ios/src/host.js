// The reader (../reader-web) asks "the app" for its book, voice and so on through window.P2AReader
// (on Android, the app answers). On iPhone this file answers instead: the book from the library on
// the phone, the iPhone's own voices, and Look up from a free dictionary.
// It must run before the reader's code, which reads window.P2AReader as it loads.
// Reading aloud is done by the iPhone itself (PaperSpeech, ios-plugins/speech): it keeps reading with the
// screen off and shows the book on the lock screen; the reader just follows it, as on Android.
import { getBook } from './db.js';
import { Speech, native, VOICE_KEY, VOICE_ID, sheet, pickVoice, whenVoiceChosen, pronunciations, pronounceSheet, chaptersOf } from './speech.js';

let loaded = null; // the book as stored (its blocks: what each paragraph says)

const bookId = new URLSearchParams(location.search).get('id');
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// A voice chosen here: the reader's in-memory setting and its voice line follow.
whenVoiceChosen(async (name) => {
  const { ttsCfg } = await import('../../reader-web/src/lib/tts.js');
  ttsCfg.patch({ mode: 'system', voice: name });
  window.__p2aEvent?.('P2AReader', 'voice', JSON.stringify({ name }));
});

// Opened from the home screen's Play: start reading as soon as the book is shown.
if (new URLSearchParams(location.search).get('play') === '1') {
  let tries = 0;
  const t = setInterval(() => {
    const b = document.querySelector('button[aria-label="Read aloud"]');
    if (b || ++tries > 40) {
      clearInterval(t);
      b?.click();
    }
  }, 250);
}

async function theBook() {
  const b = bookId && (await getBook(bookId));
  if (!b) throw new Error('This book is no longer in the library');
  loaded = b;
  let html = '';
  const headings = [];
  b.blocks.forEach((bl, i) => {
    if (bl.h) {
      html += `<h2 id="c${i}" data-i="${i}"${bl.s ? ' data-skip' : ''}>${esc(bl.t)}</h2>\n`;
      headings.push({ id: 'c' + i, text: bl.t, level: 2 });
    } else html += `<p data-i="${i}"${bl.s ? ' data-skip' : ''}>${esc(bl.t)}</p>\n`;
  });
  return { uid: b.id, id: b.id, title: b.title, author: b.author || '', html, headings, at: 0 };
}

// ---- reading aloud by the iPhone (the reader's "InkwellReadAloud" calls, as the Android app answers them) ----

// The iPhone counts in the book's own paragraphs (so the home screen's player, saved places and the reader
// agree); the reader counts its elements, which leave out the skipped contents and index. idx: element → paragraph.
let idxMap = null;
const toBook = (el) => (idxMap && idxMap[el] >= 0 ? idxMap[el] : el);
function toElement(para) {
  if (!idxMap) return para;
  const i = idxMap.indexOf(para);
  if (i >= 0) return i;
  const next = idxMap.findIndex((b) => b > para);
  return next >= 0 ? next : Math.max(0, idxMap.length - 1);
}
const forReader = (st) => (st && st.para != null ? { ...st, para: toElement(st.para) } : st);

async function readAloud(method, a) {
  switch (method) {
    case 'start': {
      const blocks = loaded?.blocks || (await getBook(bookId))?.blocks || [];
      let paras;
      let from = a.from || 0;
      if (a.paras?.length) {
        // A translation: what to say comes from the reader, counted as it counts.
        idxMap = null;
        paras = a.paras;
      } else {
        // The book's paragraphs, the ones the reader left out (skipped) silent.
        idxMap = a.idx || null;
        const shown = new Set((a.idx || []).filter((i) => i >= 0));
        paras = blocks.map((b, i) => (shown.has(i) ? b.t : ''));
        from = toBook(from);
      }
      return Speech.start({
        uid: a.uid || loaded?.id || bookId || '',
        title: a.title || loaded?.title || '',
        author: loaded?.author || '',
        paras,
        from,
        rate: a.rate || 1,
        voice: localStorage.getItem(VOICE_ID) || '',
        chapters: chaptersOf(loaded),
        pronounce: pronunciations(),
        lang: 'en',
      });
    }
    case 'status':
      return forReader(await Speech.status());
    case 'pause':
    case 'resume':
    case 'stop':
      return Speech[method]();
    case 'seek':
      return Speech.seek({ para: toBook(a.para || 0) });
    case 'map':
      idxMap = a.idx || null;
      return {};
    case 'setRate':
      return Speech.setRate({ rate: a.rate || 1 });
    default:
      return {}; // addParas: nothing to do
  }
}

if (native) Speech.addListener('state', (st) => window.__p2aEvent?.('InkwellReadAloud', 'state', JSON.stringify(forReader(st))));

async function lookUp(raw) {
  const word = String(raw || '').trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').replace(/['’]s$/, '');
  if (!word) return;
  let entries = null;
  let failed = false;
  try {
    const r = await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word.toLowerCase()));
    if (r.ok) entries = await r.json();
    else if (r.status !== 404) failed = true;
  } catch {
    failed = true;
  }
  sheet(word, (box) => {
    const add = (cls, text) => {
      const el = document.createElement(cls === 'k' ? 'div' : 'p');
      if (cls) el.className = cls;
      el.textContent = text;
      box.appendChild(el);
    };
    if (!Array.isArray(entries) || !entries.length) {
      add('m', failed ? 'The dictionary isn’t answering (no internet?). Please try again.' : 'No meaning found.');
      return;
    }
    const ph = entries[0].phonetic || entries[0].phonetics?.find((p) => p.text)?.text;
    if (ph) add('m', ph);
    let shown = 0;
    for (const e of entries)
      for (const m of e.meanings || []) {
        if (shown >= 6) break;
        add('k', m.partOfSpeech || '');
        for (const d of (m.definitions || []).slice(0, 2)) {
          add('', d.definition);
          if (d.example) add('m', `“${d.example}”`);
          shown++;
        }
      }
  });
}

// ---- the calls ----

async function handle(plugin, method, args) {
  if (plugin === 'InkwellReadAloud') return readAloud(method, args);
  switch (method) {
    case 'book':
      return theBook();
    case 'close':
      // Leaving the reader: the iPhone keeps reading (the reader follows it again when reopened).
      if (!native) speechSynthesis.cancel();
      location.href = 'index.html';
      return {};
    case 'voice':
      return { name: localStorage.getItem(VOICE_KEY) || '' };
    case 'pickVoice':
      pickVoice();
      return {};
    case 'lookup':
      lookUp(args.word);
      return {};
    case 'pronounce':
      pronounceSheet(args.word);
      return {};
    default:
      throw new Error('Not available on iPhone yet');
  }
}

window.P2AReader = {
  plugins: () => JSON.stringify(native ? ['P2AReader', 'InkwellReadAloud'] : ['P2AReader']),
  call(id, plugin, method, json) {
    let args = {};
    try {
      args = JSON.parse(json || '{}');
    } catch {}
    handle(plugin, method, args).then(
      (r) => window.__p2aDone?.(id, JSON.stringify(r ?? {})),
      (e) => window.__p2aDone?.(id, JSON.stringify({ __error: e.message || String(e) }))
    );
  },
};
