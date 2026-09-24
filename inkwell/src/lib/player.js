// Global audiobook player: multi-track books, chapters, speed, sleep timer,
// bookmarks, progress persistence and system media controls. Audio output is
// delegated to an engine (native Media3 on Android, <audio> on the web).
import { createEngine } from './engine.js';
import { progress, bookmarks, settings, summarize } from './store.js';
import { syncProgress } from '../sources/audiobookshelf.js';

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

// --- engine -----------------------------------------------------------------
const engine = createEngine({
  time(pos, dur) {
    const t = state.tracks[state.index];
    if (t && dur > 0) t.duration = dur;
    set({ time: pos, duration: dur || state.duration });
    saveProgress();
    if (state.sleepUntil && Date.now() >= state.sleepUntil) fadeOutAndPause();
  },
  playing(on) {
    set({ playing: on, ...(on ? { loading: false, error: null } : {}) });
    if (!on) saveProgress(true);
  },
  waiting: () => !state.loading && set({ loading: true }),
  ready: () => state.loading && set({ loading: false }),
  ended() {
    if (state.sleepEndOfTrack) {
      set({ sleepEndOfTrack: false, playing: false });
      saveProgress(true);
      return;
    }
    if (state.index < state.tracks.length - 1) loadTrack(state.index + 1, 0);
    else {
      set({ playing: false });
      saveProgress(true);
    }
  },
  error: (msg) => set({ loading: false, playing: false, error: msg }),
  remote(action) {
    const s = settings.get();
    if (action === 'next') skip(s.skipForward || 30);
    else if (action === 'previous') skip(-(s.skipBack || 15));
  },
});

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
    const b = state.book;
    await engine.load(url, {
      start: startAt,
      autoplay,
      rate: state.rate,
      headers: t.headers,
      meta: { title: t.title || b.title, artist: b.author || '', album: b.title, artwork: b.cover || '' },
    });
    if (!autoplay) set({ loading: false });
  } catch (e) {
    if (token !== loadToken || e?.name === 'AbortError') return;
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
    const g = globalStart ?? (index == null && time == null && !resume && serverStart ? serverStart : null);
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
  if (state.error) return loadTrack(state.index, state.time); // retry after a failure
  if (state.playing || !engine.paused) engine.pause();
  else Promise.resolve(engine.play()).catch((e) => set({ error: e.message }));
}
export const pause = () => engine.pause();
export function seek(t) {
  if (!isFinite(t)) return;
  const d = state.duration || engine.duration;
  const clamped = Math.max(0, d ? Math.min(t, d - 0.25) : t);
  engine.seek(clamped);
  set({ time: clamped });
}
export function seekGlobal(g) {
  const { i, t } = locate(g);
  if (i === state.index) seek(t);
  else loadTrack(i, t, state.playing);
}
export function skip(delta) {
  const t = state.time + delta;
  if (t < 0 && state.index > 0) {
    const prevTrack = state.tracks[state.index - 1];
    return loadTrack(state.index - 1, Math.max(0, (prevTrack.duration || 0) + t), state.playing);
  }
  const d = state.duration || engine.duration;
  if (d && t > d && state.index < state.tracks.length - 1) return loadTrack(state.index + 1, 0, state.playing);
  seek(t);
}
export function next() {
  if (state.index < state.tracks.length - 1) loadTrack(state.index + 1, 0);
}
export function prev() {
  if (state.time > 5 || state.index === 0) seek(0);
  else loadTrack(state.index - 1, 0);
}
export function jumpTo(i, t = 0) {
  loadTrack(i, t);
}
export function setRate(r) {
  engine.setRate(r);
  set({ rate: r });
  settings.patch({ speed: r });
}
export function setSleep(mode) {
  if (mode === 'track') set({ sleepUntil: null, sleepEndOfTrack: true });
  else if (!mode) set({ sleepUntil: null, sleepEndOfTrack: false });
  else set({ sleepUntil: Date.now() + mode * 60e3, sleepEndOfTrack: false });
}

/** Stop playback and dismiss the player completely. */
export function stop() {
  saveProgress(true);
  loadToken++;
  Promise.resolve(engine.stop()).catch(() => {});
  set({ book: null, tracks: [], playing: false, loading: false, error: null, time: 0, duration: 0, sleepUntil: null, sleepEndOfTrack: false });
}

export function addBookmark(label) {
  if (!state.book) return;
  const uid = state.book.uid;
  const bm = { track: state.index, time: state.time, global: globalTime(), label: label || `${state.tracks[state.index]?.title || 'Bookmark'}`, createdAt: Date.now() };
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
  const d = state.duration;
  const finished = state.index === state.tracks.length - 1 && d > 0 && state.time >= d - 2;
  const uid = state.book.uid;
  progress.set((p) => ({
    ...p,
    [uid]: {
      kind: 'audio',
      track: state.index,
      time: state.time || 0,
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

function fadeOutAndPause() {
  set({ sleepUntil: null });
  let step = 0;
  const iv = setInterval(() => {
    step++;
    engine.setVolume(Math.max(0, 1 - step / 20));
    if (step >= 20) {
      clearInterval(iv);
      engine.pause();
      engine.setVolume(1);
    }
  }, 150);
}

document.addEventListener('visibilitychange', () => saveProgress(true));
