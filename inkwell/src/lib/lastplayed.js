// Which copy of a book you played last, so the book page can mark it ("Last played") and you
// don't tap another copy that starts from the beginning. Pure: give it the copies' ids and the
// saved places (progress), keyed by copy id, each with `updatedAt`.

/**
 * The copy among `uids` you played most recently — or null when none was played, or when the
 * copy this page is about (`own`) was played after all of them (then Resume already plays it).
 */
export function lastPlayed(uids, progress, own = '') {
  let best = null;
  let at = 0;
  for (const uid of uids || []) {
    const t = uid && progress?.[uid]?.updatedAt;
    if (t > at) (best = uid), (at = t);
  }
  if (!best) return null;
  const mine = own && progress?.[own]?.updatedAt;
  return mine && mine >= at ? null : best;
}
