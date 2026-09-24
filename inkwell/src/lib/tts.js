// Ebook → audio. Two paths:
//  * Phone voice: Android's built-in text-to-speech reads the book aloud in the
//    reader (free, offline, quality depends on the installed voices).
//  * AI voices (OpenAI / Google Cloud / ElevenLabs, user's own API key): the
//    book is split into chapter-aligned sections that are synthesised on demand
//    (one section ahead), cached on the device and played through the normal
//    audiobook player — so chapters, speed, sleep timer and lock-screen
//    controls all work.
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { persisted } from './store.js';

export const ttsCfg = persisted('tts', {
  engine: 'openai', // default AI engine: openai | google | elevenlabs
  openaiKey: '',
  openaiModel: 'gpt-4o-mini-tts',
  openaiVoice: 'nova',
  googleKey: '',
  googleVoice: 'en-US-Chirp3-HD-Aoede',
  elevenKey: '',
  elevenVoice: '21m00Tcm4TlvDq8ikWAM',
  elevenVoiceName: 'Rachel',
  deviceVoice: -1,
  deviceRate: 1,
});

export const ENGINES = {
  openai: {
    name: 'OpenAI',
    keyField: 'openaiKey',
    keyUrl: 'https://platform.openai.com/api-keys',
    maxChars: 3800,
    voices: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'].map((v) => [v, v[0].toUpperCase() + v.slice(1)]),
    models: [
      ['gpt-4o-mini-tts', 'GPT-4o mini TTS (most natural)'],
      ['tts-1-hd', 'TTS-1 HD'],
      ['tts-1', 'TTS-1 (cheapest)'],
    ],
  },
  google: {
    name: 'Google Cloud',
    keyField: 'googleKey',
    keyUrl: 'https://console.cloud.google.com/apis/credentials',
    maxChars: 1500,
    voices: [
      ['en-US-Chirp3-HD-Aoede', 'Aoede (US, female, Chirp 3 HD)'],
      ['en-US-Chirp3-HD-Kore', 'Kore (US, female, Chirp 3 HD)'],
      ['en-US-Chirp3-HD-Charon', 'Charon (US, male, Chirp 3 HD)'],
      ['en-US-Chirp3-HD-Puck', 'Puck (US, male, Chirp 3 HD)'],
      ['en-GB-Chirp3-HD-Aoede', 'Aoede (UK, female, Chirp 3 HD)'],
      ['en-GB-Chirp3-HD-Charon', 'Charon (UK, male, Chirp 3 HD)'],
      ['en-IN-Chirp3-HD-Aoede', 'Aoede (India, female, Chirp 3 HD)'],
      ['en-IN-Chirp3-HD-Charon', 'Charon (India, male, Chirp 3 HD)'],
      ['en-US-Studio-O', 'Studio O (US, female)'],
      ['en-US-Neural2-D', 'Neural2 D (US, male)'],
    ],
  },
  elevenlabs: {
    name: 'ElevenLabs',
    keyField: 'elevenKey',
    keyUrl: 'https://elevenlabs.io/app/settings/api-keys',
    maxChars: 2500,
    voices: [['21m00Tcm4TlvDq8ikWAM', 'Rachel']],
  },
};

export const hasKey = (engine) => !!ttsCfg.get()[ENGINES[engine]?.keyField];
export const availableEngines = () => Object.keys(ENGINES).filter(hasKey);

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

function splitLong(text, max) {
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
export function sections(paras, max) {
  const out = [];
  let chapter = 'Opening';
  let part = 1;
  let buf = [];
  const flush = () => {
    const text = buf.join('\n\n').trim();
    if (text) out.push({ title: part > 1 ? `${chapter} · part ${part}` : chapter, text });
    if (text) part++;
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

// ---- synthesis ----------------------------------------------------------------
const native = Capacitor.isNativePlatform();

async function postBinary(url, headers, body) {
  if (native) {
    const r = await CapacitorHttp.request({ url, method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, data: body, responseType: 'blob', connectTimeout: 30000, readTimeout: 120000 });
    if (r.status >= 400) throw new Error(errText(r.data, r.status));
    return r.data; // base64
  }
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(errText(await res.text().catch(() => ''), res.status));
  const buf = new Uint8Array(await res.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

function errText(data, status) {
  let msg = '';
  try {
    const j = typeof data === 'string' ? JSON.parse(data.startsWith('{') ? data : atob(data)) : data;
    msg = j?.error?.message || j?.detail?.message || j?.detail || j?.message || '';
  } catch {}
  if (status === 401 || status === 403) return `The voice service rejected your API key${msg ? ` (${msg})` : ''}`;
  if (status === 429) return `Voice service rate limit or quota reached${msg ? ` (${msg})` : ''}`;
  return msg || `Voice service error (HTTP ${status})`;
}

/** Returns base64 MP3 for `text` using the configured engine. */
export async function synth(engine, text, opts = {}) {
  const c = { ...ttsCfg.get(), ...opts };
  if (engine === 'openai') {
    const body = { model: c.openaiModel, voice: c.openaiVoice, input: text, response_format: 'mp3' };
    if (c.openaiModel === 'gpt-4o-mini-tts') body.instructions = 'You are narrating an audiobook. Read warmly and clearly at a steady, natural pace, with expressive but restrained delivery.';
    return postBinary('https://api.openai.com/v1/audio/speech', { Authorization: `Bearer ${c.openaiKey.trim()}` }, body);
  }
  if (engine === 'google') {
    const lang = c.googleVoice.split('-').slice(0, 2).join('-');
    const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(c.googleKey.trim())}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { text }, voice: { languageCode: lang, name: c.googleVoice }, audioConfig: { audioEncoding: 'MP3' } }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.audioContent) throw new Error(errText(j, res.status));
    return j.audioContent;
  }
  if (engine === 'elevenlabs') {
    return postBinary(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(c.elevenVoice)}?output_format=mp3_44100_128`,
      { 'xi-api-key': c.elevenKey.trim() },
      { text, model_id: 'eleven_multilingual_v2' }
    );
  }
  throw new Error('Unknown voice engine');
}

export async function elevenVoices() {
  const res = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': ttsCfg.get().elevenKey.trim() } });
  if (!res.ok) throw new Error(errText(await res.text().catch(() => ''), res.status));
  const j = await res.json();
  return (j.voices || []).map((v) => [v.voice_id, `${v.name}${v.labels?.accent ? ` (${v.labels.accent})` : ''}`]);
}

// ---- caching ---------------------------------------------------------------------
const b64ToUrl = (b64) => URL.createObjectURL(new Blob([Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))], { type: 'audio/mpeg' }));
const safe = (s) => String(s).replace(/[^a-z0-9._-]+/gi, '_').slice(0, 80);

async function cachedFile(path) {
  try {
    await Filesystem.stat({ path, directory: Directory.Cache });
    return (await Filesystem.getUri({ path, directory: Directory.Cache })).uri;
  } catch {
    return null;
  }
}

/** Playable URL for one section: cached file when available, otherwise synthesised now. */
export async function sectionUrl(bookUid, engine, index, text) {
  const c = ttsCfg.get();
  const voice = engine === 'openai' ? `${c.openaiModel}-${c.openaiVoice}` : engine === 'google' ? c.googleVoice : c.elevenVoice;
  const path = `tts/${safe(bookUid)}/${safe(engine + '-' + voice)}/${index}.mp3`;
  if (native) {
    const hit = await cachedFile(path);
    if (hit) return hit;
  }
  const b64 = await synth(engine, text);
  if (!native) return b64ToUrl(b64);
  await Filesystem.writeFile({ path, data: b64, directory: Directory.Cache, recursive: true });
  return (await Filesystem.getUri({ path, directory: Directory.Cache })).uri;
}

export async function clearAudioCache() {
  try {
    await Filesystem.rmdir({ path: 'tts', directory: Directory.Cache, recursive: true });
  } catch {}
}

/** Build a playable "audiobook" from an ebook's text. */
export function buildAudiobook(book, paras, engine) {
  const secs = sections(paras, ENGINES[engine].maxChars);
  const uid = `tts:${book.uid}`;
  const inflight = new Map();
  const load = (i) => {
    if (!inflight.has(i)) {
      const p = sectionUrl(uid, engine, i, secs[i].text);
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
    narrator: `${ENGINES[engine].name} voice`,
    tracks: secs.map((s, i) => ({
      title: s.title,
      index: i,
      resolve: async () => {
        const url = await load(i);
        if (i + 1 < secs.length) load(i + 1).catch(() => {}); // prepare the next section while this one plays
        return url;
      },
    })),
  };
}
