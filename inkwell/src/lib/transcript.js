// Live transcript: the audiobook's words scroll along as it plays. Speech is
// recognised on the phone (sherpa-onnx; models downloaded once in the app),
// a little ahead of the playback position.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { persisted } from './store.js';
import { getText } from './http.js';
import { installedIds, download as downloadPackage, remove as removePackage, builtinAvailable } from './voices.js';
import * as player from './player.js';
import { isHindi } from '../screens/hindi.js';

const T = registerPlugin('InkwellTranscribe');
// iPhone: the same plugin name, built on Apple's own speech recognition (no download).
const IOS = Capacitor.getPlatform() === 'ios' && Capacitor.isPluginAvailable('InkwellTranscribe');
export const transcriptAvailable = IOS || (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('InkwellTranscribe') && builtinAvailable);
const APPLE = { id: 'apple-speech', name: 'Apple speech recognition', type: 'apple', languages: ['*'] };

// Repacked from sherpa-onnx's releases (.github/workflows/asr-models.yml): only the files the
// app uses, as .tar.gz, which unpacks far faster on the phone than the original .tar.bz2.
const ASR = 'https://github.com/drdilips1/bytewatch-stremio-addon/releases/download/asr-models/';

/** Speech-recognition models you can download in the app. */
export const MODELS = [
  {
    id: 'asr-moonshine-tiny-en',
    name: 'English',
    what: 'Moonshine · fast and accurate for English audiobooks',
    size: '≈ 100 MB',
    type: 'moonshine',
    url: ASR + 'asr-moonshine-tiny-en-int8.tar.gz',
    languages: ['en'],
  },
  {
    id: 'asr-whisper-base',
    name: 'Hindi + 90 languages',
    what: 'Whisper base · हिंदी and other languages · slower',
    size: '≈ 95 MB',
    type: 'whisper',
    url: ASR + 'asr-whisper-base-int8.tar.gz',
    languages: ['*'],
  },
];

export const transcriptCfg = persisted('transcript', { open: false });

const state = { key: '', segments: [], status: 'idle', error: '', model: null };
const subs = new Set();
const emit = () => subs.forEach((f) => f({ ...state, segments: state.segments }));
export const subscribeTranscript = (f) => (subs.add(f), f({ ...state }), () => subs.delete(f));
const set = (p) => (Object.assign(state, p), emit());

let job = '';
let jobStart = 0;
let installed = null;

// Transcribed lines are kept per book part (last few parts, across restarts),
// so leaving the screen or the app doesn't lose them.
const saved = persisted('transcriptCache', { order: [], parts: {} });
let saveTimer = null;
function remember() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const { key, segments } = state;
    if (!key || !segments.length) return;
    saved.set((c) => {
      const order = [key, ...c.order.filter((k) => k !== key)].slice(0, 4);
      const parts = {};
      for (const k of order) parts[k] = k === key ? segments.slice(-2500) : c.parts[k];
      return { order, parts };
    });
  }, 3000);
}

/** End of the run of transcribed lines (gaps under 20s) that covers time t, or null. */
function coveredUntil(t) {
  const segs = state.segments;
  let i = segs.findIndex((x) => x.end >= t - 1);
  if (i < 0 || segs[i].start > t + 5) return null;
  let end = segs[i].end;
  while (i + 1 < segs.length && segs[i + 1].start - end < 20) end = Math.max(end, segs[++i].end);
  return end;
}

export async function installedModels() {
  if (!transcriptAvailable) return [];
  if (IOS) return (installed = [APPLE]);
  const ids = await installedIds();
  installed = MODELS.filter((m) => ids.includes(m.id));
  return installed;
}

export function downloadModel(m, onProgress) {
  return downloadPackage(m, onProgress).then(() => (installed = null));
}
export const removeModel = (m) => removePackage(m.id).then(() => (installed = null));

function languageOf(book) {
  return book && isHindi(book) ? 'hi' : 'en';
}

function pickModel(list, lang) {
  return list.find((m) => m.languages.includes(lang)) || list.find((m) => m.languages.includes('*')) || null;
}

if (transcriptAvailable) {
  T.addListener('segment', (e) => {
    if (e.job !== job) return;
    const segs = state.segments;
    // Keep segments sorted by start time.
    let i = segs.length;
    while (i > 0 && segs[i - 1].start > e.start) i--;
    segs.splice(i, 0, { start: e.start, end: e.end, text: e.text });
    set({ segments: segs.slice(), status: 'running' });
    remember();
  });
  T.addListener('status', (e) => {
    if (e.job !== job) return;
    set({ status: e.state === 'error' ? 'error' : e.state, error: e.message || '' });
  });
}

async function startJob(ps, at) {
  const t = ps.tracks[ps.index];
  const list = installed || (await installedModels());
  const lang = languageOf(ps.book);
  const m = pickModel(list, lang);
  if (!m) return set({ status: 'no-model', model: null });
  if (!t?.url) return set({ status: 'waiting' });
  job = `${state.key}@${Math.round(at)}-${Date.now()}`;
  jobStart = at;
  // Drop what the new job will produce again.
  set({ segments: state.segments.filter((s) => s.end <= at + 0.5), status: 'loading', error: '', model: m });
  try {
    await T.start({
      job,
      url: t.url,
      headers: t.headers || {},
      model: m.id,
      type: m.type,
      language: m.type === 'whisper' || m.type === 'apple' ? lang : 'en',
      start: at,
      ahead: 90,
      duration: t.duration || ps.duration || 0,
    });
  } catch (e) {
    set({ status: 'error', error: e.message });
  }
}

// ---- the publisher's own transcript (podcast episodes that ship one) ----------
// Timed lines straight from the feed: no speech recognition needed.
const clock = (t) => String(t).trim().replace(',', '.').split(':').reduce((a, x) => a * 60 + Number(x || 0), 0);
// Some publishers time every word: join them into readable lines.
function joinShort(segs) {
  const out = [];
  for (const g of segs) {
    const last = out[out.length - 1];
    if (last && last.text.length < 140 && !/[.!?]["')\]]?$/.test(last.text) && g.start - last.end < 2 && last.speaker === g.speaker) {
      last.text += ' ' + g.text;
      last.end = g.end;
    } else out.push({ ...g });
  }
  return out;
}
export function parsePublished(text, type = '') {
  const t = String(text || '').replace(/\r/g, '');
  if (/json/.test(type) || /^\s*[{[]/.test(t)) {
    try {
      const j = JSON.parse(t);
      const segs = (j.segments || j || [])
        .map((g) => ({ start: Number(g.startTime) || 0, end: Number(g.endTime) || Number(g.startTime) || 0, text: String(g.body || '').trim(), speaker: g.speaker || '' }))
        .filter((g) => g.text);
      if (segs.length) return joinShort(segs);
    } catch {}
  }
  if (/-->/.test(t)) {
    const segs = [];
    for (const block of t.split(/\n{2,}/)) {
      const lines = block.split('\n');
      const k = lines.findIndex((l) => l.includes('-->'));
      if (k < 0) continue;
      const [a, b] = lines[k].split('-->');
      const words = lines
        .slice(k + 1)
        .join(' ')
        .replace(/<v\s+([^>]+)>/g, '$1: ')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (words) segs.push({ start: clock(a), end: clock(b.split(/\s/).filter(Boolean)[0]), text: words, speaker: '' });
    }
    if (segs.length) return joinShort(segs);
  }
  // Plain text or a web page: untimed paragraphs.
  const plainText = /<[a-z][\s\S]*>/i.test(t) ? new DOMParser().parseFromString(t, 'text/html').body.innerText || '' : t;
  return plainText
    .split(/\n\s*\n|\n(?=[A-Z][\w ]{0,30}:)/)
    .map((x) => x.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((text) => ({ start: null, end: null, text }));
}

const failedTranscripts = new Set();
function followPublished(ps) {
  const key = `${ps.book.uid}#pub`;
  if (key === state.key || failedTranscripts.has(ps.book.transcript.url)) return;
  stopTranscript();
  const { url, type } = ps.book.transcript;
  set({ key, segments: [], status: 'loading', error: '', published: true });
  getText(url, { timeout: 20000 })
    .then((txt) => {
      if (state.key !== key) return;
      const segments = parsePublished(txt, type);
      if (!segments.length) throw new Error('The transcript was empty');
      set({ segments, status: 'done' });
    })
    .catch((e) => {
      failedTranscripts.add(url);
      if (state.key !== key) return;
      // Couldn't get it: recognise the speech on the phone instead, where possible.
      if (transcriptAvailable && transcriptCfg.get().open) {
        set({ key: '', published: false });
        follow({ ...ps, book: { ...ps.book, transcript: null } });
      } else set({ status: 'error', error: `Couldn't load the transcript (${e.message})` });
    });
}

/**
 * Keep the transcript in step with the player. Called on every player update
 * while the transcript is on screen.
 */
export function follow(ps) {
  if (!ps.book) return;
  if (ps.book.transcript?.url && !failedTranscripts.has(ps.book.transcript.url)) return followPublished(ps);
  if (!transcriptAvailable) return;
  if (state.published) set({ published: false });
  const key = `${ps.book.uid}#${ps.index}`;
  const from = () => {
    const c = coveredUntil(ps.time);
    return c != null ? Math.max(0, c - 1) : Math.max(0, ps.time - 2);
  };
  if (key !== state.key) {
    stopTranscript();
    set({ key, segments: (saved.get().parts[key] || []).slice(), status: 'idle', error: '' });
    return startJob(ps, from());
  }
  if (state.status === 'no-model' || state.status === 'loading' || state.status === 'error') return;
  if (state.status === 'waiting' || state.status === 'idle') return startJob(ps, from());
  const segs = state.segments;
  const frontier = segs.reduce((m, x) => (x.start >= jobStart - 1 ? Math.max(m, x.end) : m), jobStart);
  const covered = coveredUntil(ps.time);
  // Jumped somewhere this job won't reach soon (and that isn't transcribed yet): start from there.
  const behind = ps.time < jobStart - 1 && (covered == null || covered < jobStart - 1);
  // (On iPhone the transcriber catches up with the listener by itself.)
  const ahead = !IOS && ps.time > frontier + 45 && state.status !== 'done';
  if (behind || ahead) return startJob(ps, from());
  T.position({ pos: ps.time }).catch(() => {});
}

export function stopTranscript() {
  if (!transcriptAvailable) return;
  job = '';
  T.stop().catch(() => {});
}

/** Forget the current model choice (after downloading or removing one). */
export function restartTranscript() {
  installed = null;
  stopTranscript();
  set({ key: '', segments: [], status: 'idle' });
  const ps = player.getState();
  if (ps.book) follow(ps);
}

// Keep transcribing while the Text view is switched on, even with the player
// screen closed (e.g. moving on to the next part).
{
  let last = 0;
  player.subscribe((ps) => {
    if (!ps.book) return;
    // The publisher's transcript is one small download: fetch it for every such
    // episode (Ask AI uses it too). Speech recognition only runs with Text open.
    if (ps.book.transcript?.url && !failedTranscripts.has(ps.book.transcript.url)) return followPublished(ps);
    if (!transcriptCfg.get().open || !transcriptAvailable) return;
    const now = Date.now();
    if (now - last < 1000 && ps.index === player.getState().index && `${ps.book.uid}#${ps.index}` === state.key) return;
    last = now;
    follow(ps);
  });
}

/**
 * What you've heard of this book so far (from the live transcript, if it ran):
 * earlier parts in full, the current part up to `time`. Keeps the last maxChars.
 */
export function heardText(bookUid, index, time, maxChars = 14000) {
  // The publisher's transcript: what was said up to now (untimed: all of it).
  if (state.key === `${bookUid}#pub` && state.segments.length) {
    const all = state.segments.filter((s) => s.start == null || s.start <= time).map((s) => s.text).join(' ');
    return all.length > maxChars ? '…' + all.slice(-maxChars) : all;
  }
  const parts = saved.get().parts || {};
  const chunks = [];
  for (let i = 0; i <= index; i++) {
    const key = `${bookUid}#${i}`;
    const segs = key === state.key && state.segments.length ? state.segments : parts[key] || [];
    const upto = i < index ? segs : segs.filter((s) => s.start <= time);
    if (upto.length) chunks.push(upto.map((s) => s.text).join(' '));
  }
  const all = chunks.join('\n\n');
  return all.length > maxChars ? '…' + all.slice(-maxChars) : all;
}
