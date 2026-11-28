// Which copy of a book you played last, so the book page can mark it ("Last played") and you
// don't tap another copy that starts from the beginning. Pure: give it the saved places
// (progress: copy id → { updatedAt, book }) and a test for "is this the same book".

/** Your most recent place in this book, under whichever copy: { uid, at } or null. */
export function lastOfWork(progress, same) {
  let best = null;
  for (const [uid, p] of Object.entries(progress || {})) {
    const at = p?.updatedAt || 0;
    if (at && (!best || at > best.at) && same(p.book || {}, uid)) best = { uid, at };
  }
  return best;
}

/**
 * Which of `uids` is that copy: the same id; else, when only one of them comes from the same
 * place (both "tb:…" — TorBox ids change when an item is added again), that one; else null.
 */
export function copyFor(uids, uid) {
  if (!uid) return null;
  const list = (uids || []).filter(Boolean);
  if (list.includes(uid)) return uid;
  const from = uid.split(':')[0];
  const alike = list.filter((u) => u.split(':')[0] === from);
  return alike.length === 1 ? alike[0] : null;
}
