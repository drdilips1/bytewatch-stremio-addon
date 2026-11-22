// A cloud copy that has gone inactive, brought back. TorBox lets old torrents go inactive (and
// Real-Debrid lets some die): the book was playing yesterday, today its files won't come. The
// same torrent added again is usually ready at once (still cached there), so the app does that by
// itself and carries on at the same point. Pure: the checks and the bookkeeping.

/** TorBox's entry for a torrent → is it gone (missing, inactive, expired, failed)? */
export function tbGone(item) {
  if (!item) return true;
  const state = String(item.download_state || '').toLowerCase();
  if (/inactive|expired|missing|error|failed|stalled/.test(state)) return true;
  if (item.active === false && !item.download_present) return true;
  // Finished once, but its files are no longer on TorBox.
  return !!item.download_finished && item.download_present === false;
}

/** Real-Debrid's torrent info (null when it's gone, 404) → dead? */
export function rdGone(info) {
  if (!info) return true;
  return /dead|error|virus|magnet_error/i.test(String(info.status || ''));
}

/**
 * Your place in the book follows it to its new entry (TorBox gives the re-added torrent a new
 * id, so a new uid): Continue keeps showing it, at the same point.
 */
export function moveProgress(all, fromUid, toUid) {
  const p = all?.[fromUid];
  if (!p || !toUid || fromUid === toUid) return all;
  const next = { ...all, [toUid]: { ...p, book: p.book ? { ...p.book, uid: toUid } : p.book } };
  delete next[fromUid];
  return next;
}

/**
 * Which cloud entries to bring back before you press play: books you're partway through
 * (listened in the last 60 days, not finished) whose torrent is gone. → [{ uid, hash, title }]
 * `entries`: [{ uid, hash, title, gone }] from your TorBox / Real-Debrid lists.
 */
export function toKeepReady(entries, prog, now = Date.now()) {
  return (entries || []).filter((e) => {
    const p = prog?.[e.uid];
    return e.gone && /^[a-f0-9]{40}$/.test(String(e.hash || '')) && p && !p.finished && now - (p.updatedAt || 0) < 60 * 864e5;
  });
}
