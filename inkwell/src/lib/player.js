// Global audio engine: multi-track books, chapters, speed, sleep timer,
// bookmarks, progress persistence and lock-screen / notification controls.
import { MediaSession } from '@capgo/capacitor-media-session';
import { progress, bookmarks, settings, summarize } from './store.js';
import { syncProgress } from '../sources/audiobookshelf.js';

const audio = new Audio();
audio.preload = 'auto';

const state = {
  book: null,
  tracks: [],
  index: 0,
  playing: false,
  loading: false,
  time: 0,
  duration: 0,
  rate: settings.get().speed || 1,
  error: null,
  sleepUntil: null, // timestamp
  sleepEndOfTrack: false,
};

const subs = new Set();
let emitQueued = false;
function emit() {
  if (emitQueued) return;
  emitQueued = true;
  requestAnimationFrame(() => {
    emitQueued = false;
    const snap = { ...state };
    subs.forEach((f) => f(snap));
  });
}
export const subscribe = (f) => (subs.add(f), f({ ...state }), () => subs.delete(f));
export const getState = () => ({ ...state });

function set(p) {
  Object.assign(state, p);
  emit();
}

// --- time helpers (global position across tracks) ---------------------------
function trackOffset(i) {
  const t = state.tracks[i];
  if (t && typeof t.offset === 'number') return t.offset;
  let o = 0;
  for (let k = 0; k < i; k++) o += state.tracks[k]?.duration || 0;
  return o;
}
export function totalDuration() {
  return state.tracks.reduce((a, t) => a + (t.duration || 0), 0) || state.duration;
}
export function globalTime() {
  return trackOffset(state.index) + state.time;
}
export function chapters() {
  if (state.book?.chaptersMeta?.length) return state.book.chaptersMeta;
  return state.tracks.map((t, i) => ({ title: t.title, start: trackOffset(i), end: trackOffset(i) + (t.duration || 0), track: i }));
}

// --- loading ----------------------------------------------------------------
let loadToken = 0;
async function loadTrack(i, startAt = 0, autoplay = true) {
  const token = ++loadToken;
  const t = state.tracks[i];
  if (!t) return;
  set({ index: i, loading: true, error: null, time: startAt, duration: t.duration || 0 });
  try {
    let url = t.url;
    if (!url && t.resolve) {
      url = await t.resolve();
      t.url = url;
    }
    if (token !== loadToken) return;
    if (!url) throw new Error('No playable stream for this part');
    audio.src = url;
    audio.playbackRate = state.rate;
    const seekOnce = () => {
      if (startAt > 0) audio.currentTime = startAt;
      audio.removeEventListener('loadedmetadata', seekOnce);
    };
    audio.addEventListener('loadedmetadata', seekOnce);
    updateMetadata();
    if (autoplay) await audio.play();
  } catch (e) {
    if (token !== loadToken) return;
    if (e.name === 'AbortError') return;
    set({ loading: false, playing: false, error: e.message || 'Playback failed' });
  }
}

/**
 * Start a book. `details` comes from sources.getDetails(); tracks may need a
 * playback session (Audiobookshelf, addon streams) which is resolved here.
 */
export async function playBook(details, { index, time, globalStart } = {}) {
  set({ loading: true, error: null, book: details });
  try {
    let tracks = details.tracks;
    let serverStart = 0;
    if (!tracks?.length && details.resolveTracks) {
      const r = await details.resolveTracks();
      tracks = r.tracks;
      serverStart = r.startTime || 0;
    }
    if (!tracks?.length) throw new Error('No audio tracks found for this title');
    set({ book: details, tracks, playing: false });
    const saved = progress.get()[details.uid];
    const resume = saved && !saved.finished;
    let i = index ?? (resume ? saved.track : 0) ?? 0;
    let t = time ?? (resume ? saved.time : 0);
    const g = globalStart ?? (index == null && time == null && !saved && serverStart ? serverStart : null);
    if (g != null) ({ i, t } = locate(g));
    // Gentle rewind when resuming after a break.
    if (resume && index == null && time == null && Date.now() - saved.updatedAt > 5 * 60e3) t = Math.max(0, t - 10);
    await loadTrack(Math.min(i, tracks.length - 1), t);
  } catch (e) {
    set({ loading: false, error: e.message || String(e) });
  }
}

function locate(g) {
  for (let i = state.tracks.length - 1; i >= 0; i--) {
    const o = trackOffset(i);
    if (g >= o) return { i, t: g - o };
  }
  return { i: 0, t: 0 };
}

// --- controls ---------------------------------------------------------------
export function toggle() {
  if (!state.book) return;
  if (audio.paused) audio.play().catch((e) => set({ error: e.message }));
  else audio.pause();
}
export const pause = () => audio.pause();
export function seek(t) {
  if (!isFinite(t)) return;
  audio.currentTime = Math.max(0, Math.min(t, (audio.duration || state.duration || t) - 0.25));
  set({ time: audio.currentTime });
}
export function seekGlobal(g) {
  const { i, t } = locate(g);
  if (i === state.index) seek(t);
  else loadTrack(i, t, !audio.paused || state.playing);
}
export function skip(delta) {
  const t = audio.currentTime + delta;
  if (t < 0 && state.index > 0) {
    const prev = state.tracks[state.index - 1];
    return loadTrack(state.index - 1, Math.max(0, (prev.duration || 0) + t));
  }
  if (audio.duration && t > audio.duration && state.index < state.tracks.length - 1) return loadTrack(state.index + 1, 0);
  seek(t);
}
export function next() {
  if (state.index < state.tracks.length - 1) loadTrack(state.index + 1, 0);
}
export function prev() {
  if (audio.currentTime > 5 || state.index === 0) seek(0);
  else loadTrack(state.index - 1, 0);
}
export function jumpTo(i, t = 0) {
  loadTrack(i, t);
}
export function setRate(r) {
  audio.playbackRate = r;
  set({ rate: r });
  settings.patch({ speed: r });
}
export function setSleep(mode) {
  if (mode === 'track') set({ sleepUntil: null, sleepEndOfTrack: true });
  else if (!mode) set({ sleepUntil: null, sleepEndOfTrack: false });
  else set({ sleepUntil: Date.now() + mode * 60e3, sleepEndOfTrack: false });
}
export function stop() {
  saveProgress(true);
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  set({ book: null, tracks: [], playing: false, time: 0, duration: 0, sleepUntil: null, sleepEndOfTrack: false });
  MediaSession.setPlaybackState({ playbackState: 'none' }).catch(() => {});
}

export function addBookmark(label) {
  if (!state.book) return;
  const uid = state.book.uid;
  const bm = { track: state.index, time: audio.currentTime, global: globalTime(), label: label || `${state.tracks[state.index]?.title || 'Bookmark'}`, createdAt: Date.now() };
  bookmarks.set((all) => ({ ...all, [uid]: [...(all[uid] || []), bm].sort((a, b) => a.global - b.global) }));
  return bm;
}

// --- progress ---------------------------------------------------------------
let lastSave = 0;
function saveProgress(force = false) {
  if (!state.book || !state.tracks.length) return;
  const now = Date.now();
  if (!force && now - lastSave < 4000) return;
  lastSave = now;
  const total = totalDuration();
  const g = globalTime();
  const finished = state.index === state.tracks.length - 1 && audio.duration && audio.currentTime >= audio.duration - 2;
  const uid = state.book.uid;
  progress.set((p) => ({
    ...p,
    [uid]: {
      kind: 'audio',
      track: state.index,
      time: audio.currentTime || 0,
      global: g,
      total,
      percent: total ? Math.min(1, g / total) : 0,
      finished: !!finished,
      updatedAt: now,
      book: summarize(state.book),
    },
  }));
  if (uid.startsWith('abs:')) syncProgress(uid, g, total, !!finished);
}

// --- audio element events ---------------------------------------------------
audio.addEventListener('playing', () => {
  set({ playing: true, loading: false, error: null });
  MediaSession.setPlaybackState({ playbackState: 'playing' }).catch(() => {});
});
audio.addEventListener('pause', () => {
  set({ playing: false });
  saveProgress(true);
  MediaSession.setPlaybackState({ playbackState: 'paused' }).catch(() => {});
});
audio.addEventListener('waiting', () => set({ loading: true }));
audio.addEventListener('canplay', () => set({ loading: false }));
audio.addEventListener('loadedmetadata', () => {
  const t = state.tracks[state.index];
  if (t && isFinite(audio.duration)) t.duration = audio.duration;
  set({ duration: audio.duration || 0 });
});
audio.addEventListener('timeupdate', () => {
  set({ time: audio.currentTime });
  saveProgress();
  if (state.sleepUntil && Date.now() >= state.sleepUntil) {
    fadeOutAndPause();
  }
  if (Math.floor(audio.currentTime) % 5 === 0) updatePosition();
});
audio.addEventListener('ended', () => {
  if (state.sleepEndOfTrack) {
    set({ sleepEndOfTrack: false });
    saveProgress(true);
    return;
  }
  if (state.index < state.tracks.length - 1) loadTrack(state.index + 1, 0);
  else {
    set({ playing: false });
    saveProgress(true);
  }
});
audio.addEventListener('error', () => {
  if (!audio.getAttribute('src')) return;
  set({ loading: false, playing: false, error: 'Could not load this audio stream' });
});

function fadeOutAndPause() {
  set({ sleepUntil: null });
  const start = audio.volume;
  let step = 0;
  const iv = setInterval(() => {
    step++;
    audio.volume = Math.max(0, start * (1 - step / 20));
    if (step >= 20) {
      clearInterval(iv);
      audio.pause();
      audio.volume = start;
    }
  }, 150);
}

// --- system media controls ----------------------------------------------------
function updateMetadata() {
  const b = state.book;
  if (!b) return;
  MediaSession.setMetadata({
    title: state.tracks[state.index]?.title || b.title,
    artist: b.author || '',
    album: b.title,
    artwork: b.cover ? [{ src: b.cover, sizes: '512x512', type: 'image/jpeg' }] : [],
  }).catch(() => {});
}
function updatePosition() {
  if (!audio.duration || !isFinite(audio.duration)) return;
  MediaSession.setPositionState({ duration: audio.duration, position: Math.min(audio.currentTime, audio.duration), playbackRate: audio.playbackRate }).catch(() => {});
}

const handlers = {
  play: () => audio.play(),
  pause: () => audio.pause(),
  seekbackward: () => skip(-(settings.get().skipBack || 15)),
  seekforward: () => skip(settings.get().skipForward || 30),
  previoustrack: () => prev(),
  nexttrack: () => next(),
  seekto: (d) => d?.seekTime != null && seek(d.seekTime),
  stop: () => stop(),
};
for (const [action, fn] of Object.entries(handlers)) {
  MediaSession.setActionHandler({ action }, fn).catch(() => {});
}

document.addEventListener('visibilitychange', () => saveProgress(true));
