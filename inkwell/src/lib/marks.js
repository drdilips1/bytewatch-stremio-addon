// Bookmarks across devices. Each device's list used to be added together on sync, so a bookmark
// you deleted came back a few seconds later from the cloud copy (GitHub #9). Deleted bookmarks are
// now remembered ("book uid|createdAt" → when) and synced too, and both lists drop them.

/** The key a deleted bookmark is remembered by. */
export const markKey = (uid, createdAt) => `${uid}|${createdAt}`;

const KEEP = 180 * 24 * 3600e3; // a deletion is remembered half a year, then forgotten

/** Deletions from two devices together (the later time of each), old ones dropped. */
export function mergeGone(local, remote, now = Date.now()) {
  const out = {};
  for (const src of [local || {}, remote || {}])
    for (const [k, t] of Object.entries(src)) if (typeof t === 'number' && now - t < KEEP && !(out[k] >= t)) out[k] = t;
  return out;
}

/** Two devices' bookmarks together (one of each, by when it was made), without deleted ones. */
export function mergeBookmarks(local, remote, gone = {}) {
  const out = {};
  for (const k of new Set([...Object.keys(local || {}), ...Object.keys(remote || {})])) {
    const seen = new Set();
    const list = [...(local?.[k] || []), ...(remote?.[k] || [])].filter((b) => b && !gone[markKey(k, b.createdAt)] && !seen.has(b.createdAt) && seen.add(b.createdAt));
    if (list.length || local?.[k]) out[k] = list.sort((a, b) => (a.global || 0) - (b.global || 0));
  }
  return out;
}
