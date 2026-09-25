// Live transcript: the audiobook's words scroll along as it plays. Speech is
// recognised on the phone (sherpa-onnx; models downloaded once in the app),
// a little ahead of the playback position.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { persisted } from './store.js';
import { installedIds, download as downloadPackage, remove as removePackage, builtinAvailable } from './voices.js';
import * as player from './player.js';
import { isHindi } from '../screens/hindi.js';

const T = registerPlugin('InkwellTranscribe');
export const transcriptAvailable = Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('InkwellTranscribe') && builtinAvailable;

const ASR = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/';

/** Speech-recognition models you can download in the app. */
export const MODELS = [
  {
    id: 'asr-moonshine-tiny-en',
    name: 'English',
    what: 'Moonshine · fast and accurate for English audiobooks',
    size: '≈ 100 MB',
    type: 'moonshine',
    url: ASR + 'sherpa-onnx-moonshine-tiny-en-int8.tar.bz2',
    languages: ['en'],
  },
  {
    id: 'asr-whisper-base',
    name: 'Hindi + 90 languages',
    what: 'Whisper base · हिंदी and other languages · slower',
    size: '≈ 200–300 MB',
    type: 'whisper',
    url: ASR + 'sherpa-onnx-whisper-base.tar.bz2',
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

export async function installedModels() {
  if (!transcriptAvailable) return [];
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
      language: m.type === 'whisper' ? lang : 'en',
      start: at,
      ahead: 90,
    });
  } catch (e) {
    set({ status: 'error', error: e.message });
  }
}

/**
 * Keep the transcript in step with the player. Called on every player update
 * while the transcript is on screen.
 */
export function follow(ps) {
  if (!transcriptAvailable || !ps.book) return;
  const key = `${ps.book.uid}#${ps.index}`;
  if (key !== state.key) {
    stopTranscript();
    set({ key, segments: [], status: 'idle', error: '' });
    return startJob(ps, Math.max(0, ps.time - 2));
  }
  if (state.status === 'no-model' || state.status === 'loading' || state.status === 'error') return;
  if (state.status === 'waiting' || state.status === 'idle') return startJob(ps, Math.max(0, ps.time - 2));
  const lastEnd = state.segments.length ? state.segments[state.segments.length - 1].end : jobStart;
  // A jump backwards before where we started, or far past what's transcribed: start over from here.
  if (ps.time < jobStart - 1 || (ps.time > lastEnd + 45 && ps.time > jobStart + 45)) return startJob(ps, Math.max(0, ps.time - 2));
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
