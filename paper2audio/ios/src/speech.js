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
    #p2a-sheet .s{background:var(--surface,#1c1d22);color:var(--text,#f1ece8);width:100%;max-height:75vh;overflow:auto;
      border-radius:22px 22px 0 0;padding:18px 18px calc(env(safe-area-inset-bottom) + 18px);font:16px/1.45 -apple-system,sans-serif}
    #p2a-sheet h3{margin:0 0 4px;font-size:20px}#p2a-sheet .m{opacity:.7;font-size:14px;margin:0 0 12px}
    #p2a-sheet button.v{display:block;width:100%;text-align:left;background:transparent;color:inherit;border:0;
      border-radius:12px;padding:12px;font:inherit}#p2a-sheet button.v.on{background:rgba(255,122,61,.2)}
    #p2a-sheet .k{font-size:12px;opacity:.6;text-transform:uppercase;letter-spacing:.06em;margin:16px 0 2px}
    #p2a-sheet .dlbtn{background:rgba(109,140,255,.18);font-weight:600;margin:4px 0}
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

// ---- Paper to Audio's own voices (made on the phone) and the iPhone's voices ----

const GROUPS = [
  { key: 'supertonic', pack: 'supertonic', title: 'Light voices · Supertonic', note: 'Natural, quick to start, easy on battery' },
  { key: 'readers', pack: 'pocket', title: 'Real readers', note: 'Recorded by real people · uses more battery' },
  { key: 'kokoro', pack: 'kokoro', title: 'More voices · Kokoro', note: 'English, US, British and Indian accents' },
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

/** The voice list: Paper to Audio's voices (by group, each downloaded once) and the iPhone's own voices. */
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
    for (const g of GROUPS) {
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
