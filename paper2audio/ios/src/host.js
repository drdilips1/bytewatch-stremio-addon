// The reader (../reader-web) asks "the app" for its book, voice and so on through window.P2AReader
// (on Android, the app answers). On iPhone this file answers instead: the book from the library on
// the phone, the iPhone's own voices, and Look up from a free dictionary.
// It must run before the reader's code, which reads window.P2AReader as it loads.
// Reading aloud is done by the iPhone itself (PaperSpeech, ios-plugins/speech): it keeps reading with the
// screen off and shows the book on the lock screen; the reader just follows it, as on Android.
import { getBook } from './db.js';
import { Capacitor as Cap, registerPlugin } from '@capacitor/core/dist/index.js';

const Speech = registerPlugin('PaperSpeech');
const native = Cap.isNativePlatform() && Cap.isPluginAvailable('PaperSpeech');
const VOICE_ID = 'p2a:iosVoiceId';
let loaded = null; // the book as stored (its blocks: what each paragraph says)

const bookId = new URLSearchParams(location.search).get('id');
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const VOICE_KEY = 'p2a:iosVoice';

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

// ---- small sheets over the reader (voice list, word meanings) ----

function sheet(title, build) {
  document.getElementById('p2a-sheet')?.remove();
  const wrap = document.createElement('div');
  wrap.id = 'p2a-sheet';
  wrap.innerHTML = `<style>
    #p2a-sheet{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.45);display:flex;align-items:flex-end}
    #p2a-sheet .s{background:var(--surface,#1c1d22);color:var(--text,#f1ece8);width:100%;max-height:75vh;overflow:auto;
      border-radius:22px 22px 0 0;padding:18px 18px calc(env(safe-area-inset-bottom) + 18px);font:16px/1.45 -apple-system,sans-serif}
    #p2a-sheet h3{margin:0 0 4px;font-size:20px}#p2a-sheet .m{opacity:.7;font-size:14px;margin:0 0 12px}
    #p2a-sheet button.v{display:block;width:100%;text-align:left;background:transparent;color:inherit;border:0;
      border-radius:12px;padding:12px;font:inherit}#p2a-sheet button.v.on{background:rgba(255,122,61,.2)}
    #p2a-sheet .k{font-size:12px;opacity:.6;text-transform:uppercase;letter-spacing:.06em;margin:14px 0 4px}
  </style><div class="s"><h3></h3><div class="b"></div></div>`;
  wrap.querySelector('h3').textContent = title;
  wrap.onclick = (e) => e.target === wrap && wrap.remove();
  build(wrap.querySelector('.b'), () => wrap.remove());
  document.body.appendChild(wrap);
}

function voicesNow() {
  return new Promise((resolve) => {
    const list = speechSynthesis.getVoices();
    if (list.length) return resolve(list);
    speechSynthesis.addEventListener('voiceschanged', () => resolve(speechSynthesis.getVoices()), { once: true });
    setTimeout(() => resolve(speechSynthesis.getVoices()), 1500);
  });
}

const natural = (v) => /enhanced|premium|neural/i.test(v.name + ' ' + v.voiceURI);

async function chooseVoice(name, id = '') {
  localStorage.setItem(VOICE_KEY, name);
  localStorage.setItem(VOICE_ID, id || name);
  if (native) Speech.setVoice({ voice: id || name }).catch(() => {});
  // The reader's own voice setting (its read-aloud uses the iPhone voice of that name).
  const { ttsCfg } = await import('../../reader-web/src/lib/tts.js');
  ttsCfg.patch({ mode: 'system', voice: name });
  window.__p2aEvent?.('P2AReader', 'voice', JSON.stringify({ name }));
}

async function pickVoice() {
  if (native) return pickNativeVoice();
  const all = await voicesNow();
  const lang = (navigator.language || 'en').slice(0, 2);
  const mine = all.filter((v) => v.lang.startsWith(lang) || v.lang.startsWith('en'));
  const list = (mine.length ? mine : all).sort((a, b) => natural(b) - natural(a) || a.name.localeCompare(b.name));
  const current = localStorage.getItem(VOICE_KEY) || '';
  sheet('Choose a voice', (box, close) => {
    const p = document.createElement('p');
    p.className = 'm';
    p.textContent = 'Tap a voice to hear it. More natural voices: Settings → Accessibility → Spoken Content → Voices → English → download an Enhanced or Premium voice.';
    box.appendChild(p);
    let group = '';
    for (const v of list) {
      const g = natural(v) ? 'Natural (downloaded)' : 'Standard';
      if (g !== group) {
        group = g;
        const k = document.createElement('div');
        k.className = 'k';
        k.textContent = g;
        box.appendChild(k);
      }
      const b = document.createElement('button');
      b.className = 'v' + (v.name === current ? ' on' : '');
      b.textContent = `${v.name} · ${v.lang}`;
      b.onclick = () => {
        chooseVoice(v.name);
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance('This is how I sound reading your book.');
        u.voice = v;
        speechSynthesis.speak(u);
        box.querySelectorAll('.v').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        setTimeout(close, 400);
      };
      box.appendChild(b);
    }
  });
}

/** The iPhone's voice list (with each voice's quality), from the iPhone itself. */
async function pickNativeVoice() {
  const { voices = [] } = await Speech.voices().catch(() => ({}));
  const lang = (navigator.language || 'en').slice(0, 2);
  const rank = { premium: 2, enhanced: 1, default: 0 };
  const mine = voices.filter((v) => v.lang.startsWith(lang) || v.lang.startsWith('en'));
  const list = (mine.length ? mine : voices).sort((a, b) => rank[b.quality] - rank[a.quality] || a.name.localeCompare(b.name));
  const current = localStorage.getItem(VOICE_ID) || '';
  const label = { premium: 'Premium (most natural)', enhanced: 'Enhanced (natural)', default: 'Standard' };
  sheet('Choose a voice', (box, close) => {
    const p = document.createElement('p');
    p.className = 'm';
    p.textContent = 'Tap a voice to choose it. More natural voices: Settings → Accessibility → Spoken Content → Voices → English → download an Enhanced or Premium voice.';
    box.appendChild(p);
    let group = '';
    for (const v of list) {
      if (v.quality !== group) {
        group = v.quality;
        const k = document.createElement('div');
        k.className = 'k';
        k.textContent = label[group] || group;
        box.appendChild(k);
      }
      const b = document.createElement('button');
      b.className = 'v' + (v.id === current ? ' on' : '');
      b.textContent = `${v.name} · ${v.lang}`;
      b.onclick = () => {
        chooseVoice(v.name, v.id);
        box.querySelectorAll('.v').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        setTimeout(close, 300);
      };
      box.appendChild(b);
    }
  });
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
