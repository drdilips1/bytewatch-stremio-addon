// Shared by the library and the reader: the iPhone's reading engine (PaperSpeech), the voice list,
// the reading speed, and small sheets for choosing them.
import { Capacitor as Cap, registerPlugin } from '@capacitor/core/dist/index.js';

export const Speech = registerPlugin('PaperSpeech');
export const native = Cap.isNativePlatform() && Cap.isPluginAvailable('PaperSpeech');
export const VOICE_KEY = 'p2a:iosVoice';
export const VOICE_ID = 'p2a:iosVoiceId';

/** The reader's voice settings (its store "inkwell:voice"), read and changed from outside the reader too. */
function readerVoice() {
  try {
    return JSON.parse(localStorage.getItem('inkwell:voice') || '{}');
  } catch {
    return {};
  }
}
function patchReaderVoice(patch) {
  localStorage.setItem('inkwell:voice', JSON.stringify({ ...readerVoice(), ...patch }));
}

export const voiceName = () => localStorage.getItem(VOICE_KEY) || '';
export const rate = () => readerVoice().rate || 1;

/** Reading speed (1 = normal), for the reader and the iPhone's engine. */
export function setRate(r) {
  patchReaderVoice({ rate: r });
  if (native) Speech.setRate({ rate: r }).catch(() => {});
}

// ---- small sheets over the reader (voice list, word meanings) ----

export function sheet(title, build) {
  document.getElementById('p2a-sheet')?.remove();
  const wrap = document.createElement('div');
  wrap.id = 'p2a-sheet';
  wrap.innerHTML = `<style>
    #p2a-sheet{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.45);display:flex;align-items:flex-end}
    #p2a-sheet .s{background:var(--card,var(--surface,#171b22));color:var(--text,#f3eee4);width:100%;max-height:85vh;overflow:auto;
      border-radius:22px 22px 0 0;padding:18px 18px calc(env(safe-area-inset-bottom) + 18px);font:16px/1.45 -apple-system,sans-serif}
    #p2a-sheet h3{margin:0 0 4px;font-size:20px}#p2a-sheet .m{opacity:.7;font-size:14px;margin:0 0 12px}
    #p2a-sheet button.v{display:block;width:100%;text-align:left;background:transparent;color:inherit;border:0;
      border-radius:12px;padding:12px;font:inherit}#p2a-sheet button.v.on{background:color-mix(in srgb,var(--accent,#7c9bff) 18%,transparent);color:var(--accent,#7c9bff);font-weight:600}
    #p2a-sheet .cards{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:8px 0 6px}
    #p2a-sheet .cards button{text-align:left;border-radius:18px;padding:14px;font:inherit;color:inherit;background:transparent;border:1.5px solid var(--card2,#262c38)}
    #p2a-sheet .cards button.on{border-color:var(--accent,#7c9bff);background:color-mix(in srgb,var(--accent,#7c9bff) 10%,transparent)}
    #p2a-sheet .cards b{display:block;font-size:16px;margin-bottom:4px}#p2a-sheet .cards span{display:block;font-size:12.5px;opacity:.75}
    #p2a-sheet .k{font-size:12px;opacity:.6;text-transform:uppercase;letter-spacing:.06em;margin:16px 0 2px}
    #p2a-sheet .dlbtn{background:color-mix(in srgb,var(--accent,#7c9bff) 18%,transparent);font-weight:600;margin:4px 0}
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

let onChosen = null;
/** Called after a voice is chosen (the reader updates its own copy of the setting). */
export const whenVoiceChosen = (f) => (onChosen = f);

function chooseVoice(name, id = '') {
  localStorage.setItem(VOICE_KEY, name);
  localStorage.setItem(VOICE_ID, id || name);
  if (native) Speech.setVoice({ voice: id || name }).catch(() => {});
  // The reader's own voice setting (its read-aloud uses the iPhone voice of that name).
  patchReaderVoice({ mode: 'system', voice: name });
  onChosen?.(name);
}

export async function pickVoice() {
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

// ---- Narrato's own voices (made on the phone) and the iPhone's voices ----

const GROUPS = [
  { key: 'supertonic', pack: 'supertonic', title: 'Light voices · Supertonic · 31 languages', note: 'Natural, quick to start, easy on battery' },
  { key: 'readers', pack: 'pocket', title: 'Real readers · Narrato voices', note: 'Recorded by real people · uses more battery' },
  { key: 'kokoro', pack: 'kokoro', title: 'More voices · Kokoro · English · medium battery', note: 'English, US, British and Indian accents' },
];

const downloads = {}; // pack key -> { progress, message, done, error }
const downloadWatchers = new Set();
if (native)
  Speech.addListener('download', (d) => {
    downloads[d.key] = d;
    downloadWatchers.forEach((f) => f(d));
    // The first voice pack downloaded becomes the voice, if none was chosen yet.
    if (d.done && !d.error && !localStorage.getItem(VOICE_ID)) {
      const first = { supertonic: ['super:F2', 'Supertonic female 2'], kokoro: ['kokoro:af_heart', 'Heart'], pocket: ['clone:emma', 'Emma'] }[d.key];
      if (first) chooseVoice(first[1], first[0]);
    }
  });

/** Download progress for any pack, for screens that show it. */
export const watchDownloads = (f) => (downloadWatchers.add(f), () => downloadWatchers.delete(f));
export const downloadPack = (key) => Speech.downloadPack({ key });
export const packs = () => (native ? Speech.packs().then((r) => r.packs || []) : Promise.resolve([]));

/** The voice list: Narrato's voices (by group, each downloaded once) and the iPhone's own voices. */
async function pickNativeVoice() {
  const { voices = [], neural = [], packs: packList = [] } = await Speech.voices().catch(() => ({}));
  const packOf = Object.fromEntries(packList.map((p) => [p.key, p]));
  const lang = (navigator.language || 'en').slice(0, 2);
  const rank = { premium: 2, enhanced: 1, default: 0 };
  const mine = voices.filter((v) => v.lang.startsWith(lang) || v.lang.startsWith('en'));
  const apple = (mine.length ? mine : voices).sort((a, b) => rank[b.quality] - rank[a.quality] || a.name.localeCompare(b.name));
  const current = localStorage.getItem(VOICE_ID) || '';
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  let stop = () => {};
  sheet('Choose a voice', (box, close) => {
    const done = () => {
      stop();
      close();
    };
    const pick = (name, id, b) => {
      chooseVoice(name, id);
      box.querySelectorAll('.v').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      setTimeout(done, 300);
    };
    const status = {}; // pack key -> the line showing its download
    // As on Android: two cards (Real readers, Light voices) choose which of the two lists shows; Kokoro and the
    // iPhone's own voices come below.
    const TAB_KEY = 'narrato:voiceTab';
    const tab = localStorage.getItem(TAB_KEY) || (current.startsWith('super:') ? 'supertonic' : 'readers');
    const cards = el('div', 'cards');
    for (const [k, title, lines] of [
      ['readers', 'Real readers', ['Recorded by real people', 'Offline after one download', 'Uses more battery']],
      ['supertonic', 'Light voices', ['Natural, quick to start', 'Offline after one download', 'Easy on battery']],
    ]) {
      const c = el('button', k === tab ? 'on' : '');
      c.appendChild(el('b', null, title));
      for (const l of lines) c.appendChild(el('span', null, l));
      c.onclick = () => {
        localStorage.setItem(TAB_KEY, k);
        stop();
        close();
        pickNativeVoice();
      };
      cards.appendChild(c);
    }
    box.appendChild(cards);
    const shown = [GROUPS.find((g) => g.key === tab), GROUPS.find((g) => g.key === 'kokoro')];
    for (const g of shown) {
      const pack = packOf[g.pack] || { installed: false, mb: 0, title: g.title };
      box.appendChild(el('div', 'k', g.title));
      box.appendChild(el('p', 'm', g.note));
      const line = el('div', 'dl');
      status[g.pack] = line;
      const show = () => {
        const d = downloads[g.pack];
        line.innerHTML = '';
        if (pack.installed || (d?.done && !d.error)) {
          pack.installed = true;
          return;
        }
        if (d && !d.done) {
          line.appendChild(el('p', 'm', d.message || `Downloading… ${d.progress || 0}%`));
          return;
        }
        if (d?.error) line.appendChild(el('p', 'm', d.error));
        const b = el('button', 'v dlbtn', `⬇  Download these voices · ${pack.mb} MB, once · then offline`);
        b.onclick = () => {
          downloads[g.pack] = { progress: 0, message: 'Starting download…', done: false };
          show();
          downloadPack(g.pack).catch((e) => {
            downloads[g.pack] = { done: true, error: e.message };
            show();
          });
        };
        line.appendChild(b);
      };
      show();
      box.appendChild(line);
      for (const v of neural.filter((x) => x.group === g.key)) {
        const b = el('button', 'v' + (v.id === current ? ' on' : ''), v.detail ? `${v.name} · ${v.detail}` : v.name);
        b.onclick = () => {
          if (!pack.installed) {
            line.querySelector('.dlbtn')?.click();
            return;
          }
          pick(v.name, v.id, b);
        };
        box.appendChild(b);
      }
    }
    stop = watchDownloads((d) => {
      const line = status[d.key];
      if (!line) return;
      const pack = packOf[d.key];
      line.innerHTML = '';
      if (d.done && !d.error) {
        if (pack) pack.installed = true;
        line.appendChild(el('p', 'm', 'Downloaded: tap a voice to choose it.'));
      } else line.appendChild(el('p', 'm', d.error || d.message || `Downloading… ${d.progress}%`));
    });
    box.appendChild(el('div', 'k', "iPhone's own voices"));
    box.appendChild(el('p', 'm', 'Lightest on battery. More natural ones: Settings → Accessibility → Spoken Content → Voices → English (Enhanced or Premium).'));
    for (const v of apple) {
      const q = { premium: ' · Premium', enhanced: ' · Enhanced' }[v.quality] || '';
      const b = el('button', 'v' + (v.id === current ? ' on' : ''), `${v.name}${q} · ${v.lang}`);
      b.onclick = () => pick(v.name, v.id, b);
      box.appendChild(b);
    }
  });
}

// ---- Where each book was left, starting a book from the home screen, sleep timer ----

const POS_KEY = 'p2a:pos';
const positions = () => {
  try {
    return JSON.parse(localStorage.getItem(POS_KEY) || '{}');
  } catch {
    return {};
  }
};
/** The paragraph a book was left at (as the iPhone last read it). */
export const positionOf = (uid) => positions()[uid] ?? null;
if (native)
  Speech.addListener('state', (st) => {
    if (!st?.uid || st.para == null) return;
    const all = positions();
    if (all[st.uid] === st.para) return;
    all[st.uid] = st.para;
    localStorage.setItem(POS_KEY, JSON.stringify(all));
  });

/** The listener's pronunciations ("Nguyen" → "Win"), used by every voice. */
const PRON_KEY = 'p2a:pronounce';
export function pronunciations() {
  try {
    return JSON.parse(localStorage.getItem(PRON_KEY) || '{}');
  } catch {
    return {};
  }
}
export function setPronunciation(word, say) {
  const all = pronunciations();
  if (say) all[word] = say;
  else delete all[word];
  localStorage.setItem(PRON_KEY, JSON.stringify(all));
}

/** Whether the reader skips the contents, copyright pages and index (its own setting; on by default). */
export function skipsFrontMatter() {
  try {
    return JSON.parse(localStorage.getItem('inkwell:settings') || '{}').skipFrontMatter !== false;
  } catch {
    return true;
  }
}

/** The chapters of a stored book: each heading block. */
export const chaptersOf = (book) => (book?.blocks || []).map((b, i) => (b.h ? { para: i, title: b.t.slice(0, 80) } : null)).filter(Boolean);

/** Reads [book] aloud from paragraph [from] (else where it was left), without opening the reader. */
export function playBook(book, from) {
  const skip = skipsFrontMatter();
  const paras = book.blocks.map((b) => (skip && b.s ? '' : b.t));
  let at = from ?? positionOf(book.id) ?? 0;
  // A new book starts after the contents and copyright pages.
  if (from == null && positionOf(book.id) == null && skip) at = Math.max(0, paras.findIndex((t) => t));
  return Speech.start({
    uid: book.id,
    title: book.title,
    author: book.author || '',
    paras,
    from: Math.min(at, Math.max(0, paras.length - 1)),
    rate: rate(),
    voice: localStorage.getItem(VOICE_ID) || '',
    chapters: chaptersOf(book),
    pronounce: pronunciations(),
    lang: 'en',
  });
}

/** Sleep timer: minutes, -1 for the end of the chapter, 0 off (kept by the iPhone, so it works with the screen off). */
export const setSleep = (minutes) => Speech.sleep({ minutes });

/** "Fix how a word is said": the word as written, and how to say it. */
export function pronounceSheet(word0 = '') {
  const word = String(word0).trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  sheet(word ? `Say “${word}” as…` : 'Pronunciations', (box, close) => {
    const el = (tag, cls, text) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    };
    const input = (ph, value) => {
      const i = el('input');
      i.placeholder = ph;
      i.value = value || '';
      i.style.cssText = 'width:100%;font:inherit;padding:12px;border-radius:12px;border:1px solid rgba(127,127,127,.4);background:transparent;color:inherit;margin:6px 0';
      return i;
    };
    const w = input('Word as written (e.g. Nguyen)', word);
    const say = input('Say it as (e.g. Win)', pronunciations()[word] || '');
    box.appendChild(el('p', 'm', 'Every voice will say it this way, in every book.'));
    box.appendChild(w);
    box.appendChild(say);
    const save = el('button', 'v dlbtn', 'Save');
    save.onclick = () => {
      if (w.value.trim() && say.value.trim()) setPronunciation(w.value.trim(), say.value.trim());
      close();
    };
    box.appendChild(save);
    const list = Object.entries(pronunciations());
    if (list.length) {
      box.appendChild(el('div', 'k', 'Your pronunciations'));
      for (const [k, v] of list) {
        const b = el('button', 'v', `${k}  →  ${v}   ✕`);
        b.onclick = () => {
          setPronunciation(k, '');
          b.remove();
        };
        box.appendChild(b);
      }
    }
    setTimeout(() => (word ? say : w).focus(), 100);
  });
}
