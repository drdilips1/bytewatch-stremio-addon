// Everything you've heard, kept for the Time Machine search: each book part's recognised lines
// (from Text / Live text), saved on this phone in Cache Storage as they come. The transcript's own
// cache keeps only the last few parts; this keeps them all (small: text only), not synced.
const BOX = 'inkwell-heard-v1';
const slot = (uid, track) => `https://heard.local/${encodeURIComponent(uid)}/${track}`;

/** Keep a part's lines: { book (summary), track, lines: [{ s (seconds into the part), t }] }. */
export async function archivePart(book, track, segments) {
  if (!book?.uid || !Number.isInteger(track) || !segments?.length) return;
  const lines = segments.filter((x) => x?.text && x.start != null).map((x) => ({ s: Math.round(x.start), t: String(x.text) }));
  if (!lines.length) return;
  try {
    const c = await caches.open(BOX);
    const { uid, title, author, cover, source, kind } = book;
    await c.put(slot(uid, track), new Response(JSON.stringify({ book: { uid, title, author, cover, source, kind }, track, lines, at: Date.now() }), { headers: { 'Content-Type': 'application/json' } }));
  } catch {}
}

/** Every archived part: [{ book, track, lines, at }]. */
export async function allHeard() {
  try {
    const c = await caches.open(BOX);
    const keys = await c.keys();
    const out = [];
    for (const k of keys) {
      const r = await c.match(k);
      const d = r ? await r.json().catch(() => null) : null;
      if (d?.book && Array.isArray(d.lines)) out.push(d);
    }
    return out;
  } catch {
    return [];
  }
}
