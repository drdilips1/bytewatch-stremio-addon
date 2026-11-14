// The reader (../reader-web) asks "the app" for its book, voice and so on through window.P2AReader
// (on Android, the app answers). On iPhone this file answers instead: the book from the library on
// the phone, the iPhone's own voices, and Look up from a free dictionary.
// It must run before the reader's code, which reads window.P2AReader as it loads.
// Reading aloud is done by the iPhone itself (PaperSpeech, ios-plugins/speech): it keeps reading with the
// screen off and shows the book on the lock screen; the reader just follows it, as on Android.
import { getBook } from './db.js';
import { Speech, native, VOICE_KEY, VOICE_ID, sheet, pickVoice, whenVoiceChosen } from './speech.js';

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
      html += `<h2 id="c${i}" data-i="${i}">${esc(bl.t)}</h2>\n`;
      headings.push({ id: 'c' + i, text: bl.t, level: 2 });
    } else html += `<p data-i="${i}">${esc(bl.t)}</p>\n`;
  });
  return { uid: b.id, id: b.id, title: b.title, author: b.author || '', html, headings, at: 0 };
}

// ---- reading aloud by the iPhone (the reader's "InkwellReadAloud" calls, as the Android app answers them) ----

async function readAloud(method, a) {
  switch (method) {
    case 'start': {
      // The reader sends which book paragraph each of its elements is (idx); the words come from the book.
      const blocks = loaded?.blocks || (await getBook(bookId))?.blocks || [];
      const paras = a.paras?.length ? a.paras : (a.idx || []).map((i) => (i >= 0 && blocks[i] ? blocks[i].t : ''));
      return Speech.start({
        uid: a.uid || loaded?.id || bookId || '',
        title: a.title || loaded?.title || '',
        author: loaded?.author || '',
        paras,
        from: a.from || 0,
        rate: a.rate || 1,
        voice: localStorage.getItem(VOICE_ID) || '',
      });
    }
    case 'status':
      return Speech.status();
    case 'pause':
    case 'resume':
    case 'stop':
      return Speech[method]();
    case 'seek':
      return Speech.seek({ para: a.para || 0 });
    case 'setRate':
      return Speech.setRate({ rate: a.rate || 1 });
    default:
      return {}; // map, addParas: nothing to do (the page and the iPhone count paragraphs the same way)
  }
}

if (native) Speech.addListener('state', (st) => window.__p2aEvent?.('InkwellReadAloud', 'state', JSON.stringify(st)));

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
