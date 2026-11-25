// Whisper Notes: your own voice, kept at a moment of a book ("this is where it clicked for me"),
// given back when you reach that moment again. Recorded and kept on this phone only (the clips
// are in the browser's Cache Storage; the list of notes is a small persisted store) — not synced.
import { persisted } from './store.js';

/** uid → [{ id, global (book seconds), at (when recorded), secs (length), label }] */
export const whispers = persisted('whispers', {});
/** Play a note by itself when its moment comes (off: a "Play" banner shows instead). */
export const whisperAutoPlay = persisted('whisperAutoPlay', false);

const BOX = 'inkwell-whispers-v1';
const slot = (id) => `https://whispers.local/${id}`;
const mem = new Map(); // id → object URL, while the app runs

/**
 * The note to offer at book time `g`: one recorded within the last `ahead` seconds before g and
 * not yet offered in this listen (`done`: ids already given back). Notes are in time order.
 */
export function whisperAt(list, g, { ahead = 20, done = new Set() } = {}) {
  if (!Array.isArray(list) || !(g >= 0)) return null;
  return list.find((w) => !done.has(w.id) && g >= w.global - 1 && g <= w.global + ahead) || null;
}

/** Keep a recording: the clip in Cache Storage, the note in the list. Resolves the note. */
export async function saveWhisper(uid, global, blob, secs, label = '') {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  try {
    const c = await caches.open(BOX);
    await c.put(slot(id), new Response(blob, { headers: { 'Content-Type': blob.type || 'audio/webm' } }));
  } catch {
    throw new Error("Couldn't keep the recording on this phone");
  }
  const note = { id, global: Math.max(0, Math.round(global)), at: Date.now(), secs: Math.round(secs), ...(label ? { label } : {}) };
  whispers.set((all) => ({ ...all, [uid]: [...(all[uid] || []), note].sort((a, b) => a.global - b.global) }));
  return note;
}

/** A playable address for a note's clip ('' when it's gone). */
export async function whisperUrl(id) {
  if (mem.has(id)) return mem.get(id);
  try {
    const r = await (await caches.open(BOX)).match(slot(id));
    if (!r) return '';
    const url = URL.createObjectURL(await r.blob());
    mem.set(id, url);
    return url;
  } catch {
    return '';
  }
}

export async function deleteWhisper(uid, id) {
  whispers.set((all) => ({ ...all, [uid]: (all[uid] || []).filter((w) => w.id !== id) }));
  try {
    await (await caches.open(BOX)).delete(slot(id));
  } catch {}
}
