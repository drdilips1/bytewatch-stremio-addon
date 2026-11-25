// The Time Machine: one search across everything you've heard and kept — heard lines (all books),
// bookmarks and their notes, highlights, saved ideas — each result a moment you can go back to.
// Pure: give it the sources, get the moments, best first.

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

/** A few words around the first hit, for showing (…what was said around it…). */
export function snippet(text, words, room = 90) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const i = words.length ? norm(t).indexOf(words[0]) : -1;
  if (i < 0 || t.length <= room) return t.length > room ? t.slice(0, room - 1) + '…' : t;
  const from = Math.max(0, i - Math.floor(room / 3));
  return (from > 0 ? '…' : '') + t.slice(from, from + room).trim() + (from + room < t.length ? '…' : '');
}

/**
 * query → [{ kind: 'heard' | 'bookmark' | 'highlight' | 'idea', book, text, track?, time?, global?, at? }]
 * sources: { heard: [{ book, track, lines: [{ s, t }] }], bookmarks: { uid: [bm] }, books: { uid: book },
 *            highlights: { uid: [h] }, ideas: [{ text, title, where, at }] }
 * Every word must be there; your own notes and highlights rank above heard lines, newer first.
 */
export function searchMoments(query, src = {}, limit = 60) {
  const words = norm(query).split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return [];
  const has = (...parts) => {
    const t = norm(parts.join(' '));
    return words.every((w) => t.includes(w));
  };
  const out = [];
  for (const [uid, list] of Object.entries(src.bookmarks || {}))
    for (const bm of list || [])
      if (has(bm.label, bm.note)) out.push({ kind: 'bookmark', rank: 3, book: src.books?.[uid] || { uid, title: 'A book' }, text: [bm.note, bm.label].filter(Boolean).join(' — '), track: bm.track, time: bm.time, global: bm.global, at: bm.createdAt || 0 });
  for (const list of Object.values(src.highlights || {}))
    for (const h of list || []) if (has(h.text, h.note)) out.push({ kind: 'highlight', rank: 3, book: h.book || {}, text: h.note ? `${h.text} — ${h.note}` : h.text, at: h.at || 0 });
  for (const c of src.ideas || []) if (has(c.text, c.title)) out.push({ kind: 'idea', rank: 2, book: { title: c.title || '' }, text: c.text, at: c.at || 0 });
  for (const part of src.heard || [])
    for (const l of part.lines || []) if (has(l.t)) out.push({ kind: 'heard', rank: 1, book: part.book, text: l.t, track: part.track, time: l.s, at: part.at || 0 });
  return out
    .sort((a, b) => b.rank - a.rank || b.at - a.at || (a.track ?? 0) - (b.track ?? 0) || (a.time ?? 0) - (b.time ?? 0))
    .slice(0, limit)
    .map(({ rank, ...m }) => ({ ...m, text: snippet(m.text, words) }));
}
