// Ebook → audio with FREE voices only: whatever text-to-speech engines are
// installed on the phone (Google Speech Services, Samsung, or free neural
// engines like HayaiTTS / SherpaTTS with Kokoro & Piper voices).
//
//  * Listen: the book is split into chapter-aligned sections, each rendered to
//    a WAV file on the phone (one section ahead) and played in the audiobook
//    player — chapters, speed, sleep timer and lock-screen controls all work.
//  * Read along: the reader speaks paragraph by paragraph with highlighting.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { persisted } from './store.js';

const Native = registerPlugin('InkwellTts');
export const nativeTts = Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('InkwellTts');

export const ttsCfg = persisted('voice', {
  mode: 'builtin', // 'builtin' = voices downloaded in the app, 'system' = phone TTS engine
  builtinId: '', // e.g. 'kokoro-en-v0_19'
  speaker: 0,
  engine: '', // system: '' = phone default
  voice: '', // system: '' = engine default
  rate: 1,
});

import { builtinAvailable, render, playableUrl, Voices } from './voices.js';

export const usingBuiltin = () => builtinAvailable && ttsCfg.get().mode === 'builtin' && !!ttsCfg.get().builtinId;

/** Free engines worth installing for natural voices. */
export const RECOMMENDED = [
  {
    name: 'HayaiTTS',
    what: 'Kokoro & Piper neural voices — very natural, offline',
    url: 'https://github.com/HayaiApp/HayaiTTS',
    pkgHint: /hayai/i,
  },
  {
    name: 'SherpaTTS',
    what: 'Piper neural voices — natural, offline (on F-Droid)',
    url: 'https://f-droid.org/packages/org.woheller69.ttsengine/',
    pkgHint: /woheller|sherpa/i,
  },
  {
    name: 'Speech Services by Google',
    what: 'Google voices — download a high-quality voice in its settings',
    url: 'https://play.google.com/store/apps/details?id=com.google.android.tts',
    pkgHint: /com\.google\.android\.tts/,
  },
];

// ---- engines & voices -------------------------------------------------------
export async function engines() {
  if (!nativeTts) return { engines: [{ name: '', label: 'Browser voice' }], defaultEngine: '' };
  return Native.getEngines();
}

export async function voices(engine = ttsCfg.get().engine) {
  if (!nativeTts) {
    const list = (window.speechSynthesis?.getVoices() || []).map((v) => ({ name: v.name, lang: v.lang, langLabel: v.lang, quality: 300, network: !v.localService }));
    return { voices: list, defaultVoice: '' };
  }
  const r = await Native.getVoices({ engine });
  // Most natural first: high quality, then the phone's language.
  const lang = (navigator.language || 'en').slice(0, 2);
  r.voices.sort((a, b) => Number(b.lang.startsWith(lang)) - Number(a.lang.startsWith(lang)) || b.quality - a.quality || a.name.localeCompare(b.name));
  return r;
}

export const qualityLabel = (q) => (q >= 500 ? 'Very high' : q >= 400 ? 'High' : q >= 300 ? 'Normal' : 'Low');

/** Speak a short text now (preview / read along). Resolves when finished. */
let clip = null;
let clipN = 0;
export let stopGen = 0;
export async function speak(text, opts = {}) {
  const c = { ...ttsCfg.get(), ...opts };
  if (builtinAvailable && c.mode === 'builtin' && c.builtinId) {
    const uri = await render(c.builtinId, c.speaker, text, `voice-audio/speak/${Date.now()}-${clipN++ % 8}.wav`);
    return new Promise((resolve, reject) => {
      clip?.pause();
      clip = new Audio(playableUrl(uri));
      clip.playbackRate = c.rate || 1;
      clip.onended = () => resolve();
      clip.onerror = () => reject(new Error('Could not play the voice clip'));
      clip.play().catch(reject);
      clip._reject = reject;
    });
  }
  if (nativeTts) return Native.speak({ text, engine: c.engine, voice: c.voice, rate: c.rate });
  return new Promise((resolve, reject) => {
    const synth = window.speechSynthesis;
    if (!synth) return reject(new Error('No voices available'));
    const u = new SpeechSynthesisUtterance(text);
    const v = synth.getVoices().find((x) => x.name === c.voice);
    if (v) u.voice = v;
    u.rate = c.rate;
    u.onend = () => resolve();
    u.onerror = (e) => (e.error === 'interrupted' || e.error === 'canceled' ? reject(new Error('stopped')) : reject(new Error(e.error)));
    synth.speak(u);
  });
}

/** Built-in voice: render text to a clip ahead of time; resolves the file URI. */
export const canPrepare = () => builtinAvailable && ttsCfg.get().mode === 'builtin' && !!ttsCfg.get().builtinId;
let prepChain = Promise.resolve();
export function prepareClip(text) {
  const c = ttsCfg.get();
  const path = `voice-audio/speak/${Date.now()}-${clipN++ % 16}.wav`;
  // The voice engine renders one clip at a time: queue the requests.
  const job = prepChain.catch(() => {}).then(() => render(c.builtinId, c.speaker, text, path));
  prepChain = job;
  return job;
}

/** Play a prepared clip; resolves when it ends (with a safety timeout if the end is never reported). */
export function playClip(uri, words = 20) {
  const c = ttsCfg.get();
  return new Promise((resolve, reject) => {
    clip?.pause();
    const a = new Audio(playableUrl(uri));
    clip = a;
    a.playbackRate = c.rate || 1;
    let guard = null;
    const done = () => {
      clearTimeout(guard);
      resolve();
    };
    const arm = () => {
      clearTimeout(guard);
      const secs = isFinite(a.duration) && a.duration > 0 ? a.duration / (c.rate || 1) : words / 2;
      guard = setTimeout(done, (secs + 6) * 1000);
    };
    a.onloadedmetadata = arm;
    a.onended = done;
    a.onerror = () => {
      clearTimeout(guard);
      reject(new Error('Could not play the voice clip'));
    };
    a._reject = (e) => {
      clearTimeout(guard);
      reject(e);
    };
    arm();
    a.play().catch((e) => {
      clearTimeout(guard);
      reject(e);
    });
  });
}

export function stopSpeaking() {
  if (clip) {
    clip.pause();
    clip._reject?.(new Error('stopped'));
    clip = null;
  }
  stopGen++;
  if (nativeTts) return Native.stop().catch(() => {});
  window.speechSynthesis?.cancel();
}

export const clearAudioCache = () =>
  Promise.all([nativeTts ? Native.clearCache().catch(() => {}) : null, builtinAvailable ? Voices.clearCache().catch(() => {}) : null]);

// ---- text preparation ------------------------------------------------------
/** Paragraphs from the sanitized reader HTML, tagged with chapter headings. */
export function paragraphs(html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const out = [];
  const walk = (el) => {
    for (const n of el.children) {
      const tag = n.tagName;
      if (/^H[1-4]$/.test(tag)) {
        const t = n.textContent.replace(/\s+/g, ' ').trim();
        if (t) out.push({ heading: true, text: t });
      } else if (tag === 'P' || tag === 'BLOCKQUOTE' || tag === 'LI' || tag === 'PRE') {
        const t = n.textContent.replace(/\s+/g, ' ').trim();
        if (t) out.push({ heading: false, text: t });
      } else if (n.children.length) walk(n);
      else {
        const t = n.textContent.replace(/\s+/g, ' ').trim();
        if (t.length > 40) out.push({ heading: false, text: t });
      }
    }
  };
  walk(doc.body.firstChild);
  return out;
}

export function splitLong(text, max) {
  if (text.length <= max) return [text];
  const parts = [];
  let cur = '';
  for (const s of text.match(/[^.!?…]+[.!?…]+["'”’)]*\s*|.+$/g) || [text]) {
    if ((cur + s).length > max && cur) {
      parts.push(cur.trim());
      cur = '';
    }
    if (s.length > max) for (let i = 0; i < s.length; i += max) parts.push(s.slice(i, i + max));
    else cur += s;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/** Chapter-aligned sections of at most `max` characters. */
export function sections(paras, max = 3000) {
  const out = [];
  let chapter = 'Opening';
  let part = 1;
  let buf = [];
  const flush = () => {
    const text = buf.join('\n\n').trim();
    if (text) {
      out.push({ title: part > 1 ? `${chapter} · part ${part}` : chapter, text });
      part++;
    }
    buf = [];
  };
  for (const p of paras) {
    if (p.heading) {
      flush();
      chapter = p.text.length > 70 ? p.text.slice(0, 67) + '…' : p.text;
      part = 1;
      buf.push(p.text + '.');
      continue;
    }
    for (const piece of splitLong(p.text, max)) {
      if (buf.join('\n\n').length + piece.length + 2 > max) flush();
      buf.push(piece);
    }
  }
  flush();
  return out;
}

export function estimate(paras) {
  const chars = paras.reduce((a, p) => a + p.text.length, 0);
  return { chars, minutes: Math.round(chars / 900) };
}

// ---- audiobook ---------------------------------------------------------------
const safe = (s) => String(s).replace(/[^a-z0-9._-]+/gi, '_').slice(0, 80);

/** Build a playable audiobook from an ebook's text using the chosen free voice. */
export function buildAudiobook(book, paras) {
  const c = ttsCfg.get();
  const builtin = usingBuiltin();
  if (!builtin && !nativeTts) throw new Error('Listening as an audiobook works in the Android app — use Read along here');
  // Smaller sections with built-in voices so the first audio is ready quickly.
  const secs = sections(paras, builtin ? 1500 : 3000);
  // Built-in voices: make the very first section short so playback starts within seconds.
  if (builtin && secs.length && secs[0].text.length > 400) {
    const [first, ...rest] = splitLong(secs[0].text, 350);
    secs.splice(0, 1, { title: secs[0].title, text: first }, { title: `${secs[0].title} ·`, text: rest.join(' ') });
  }
  const uid = `tts:${book.uid}`;
  const voiceKey = builtin ? `${c.builtinId}-${c.speaker}` : `${c.engine || 'default'}-${c.voice || 'default'}`;
  const folder = `${builtin ? 'voice-audio' : 'tts'}/${safe(book.uid)}/${safe(voiceKey)}`;
  const inflight = new Map();
  // Render sections one at a time (the voice engine handles one job at a time).
  let chain = Promise.resolve();
  const render1 = (i) => {
    if (!inflight.has(i)) {
      const job = () =>
        builtin
          ? render(c.builtinId, c.speaker, secs[i].text, `${folder}/${i}.wav`)
          : Native.synthesize({ text: secs[i].text, engine: c.engine, voice: c.voice, rate: 1, path: `${folder}/${i}.wav` }).then((r) => r.uri);
      const p = (chain = chain.catch(() => {}).then(job));
      p.catch(() => inflight.delete(i));
      inflight.set(i, p);
    }
    return inflight.get(i);
  };
  return {
    ...book,
    uid,
    source: 'tts',
    kind: 'audio',
    narrator: builtin ? 'Built-in voice' : 'Phone voice',
    tracks: secs.map((s, i) => ({
      title: s.title,
      index: i,
      resolve: async () => {
        const url = await render1(i);
        // Prepare the next two sections while this one plays.
        for (let k = 1; k <= 3; k++) if (i + k < secs.length) render1(i + k).catch(() => {});
        return url;
      },
    })),
  };
}
