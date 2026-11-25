// The Time Machine: search everything you've heard and kept, across all your books, and go back to
// that moment — a line you heard, a bookmark and its note, a highlight, an idea you saved.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { TopBar, Cover, toast } from '../components/common.jsx';
import { Icon } from '../components/icons.jsx';
import { useStore, bookmarks, progress, library, highlights } from '../lib/store.js';
import { ideas } from '../lib/askbook.js';
import { allHeard } from '../lib/heardarchive.js';
import { searchMoments } from '../lib/timemachine.js';
import { fmtTime } from '../lib/format.js';
import { nav } from '../lib/nav.js';
import * as player from '../lib/player.js';
import { getDetails } from '../sources/index.js';

const KIND = { heard: ['headphones', 'Heard'], bookmark: ['bookmark', 'Bookmark'], highlight: ['book', 'Highlight'], idea: ['pin', 'Saved idea'] };

export function TimeMachine() {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [heard, setHeard] = useState(null);
  const marks = useStore(bookmarks);
  const prog = useStore(progress);
  const lib = useStore(library);
  const hl = useStore(highlights);
  const saved = useStore(ideas);
  useEffect(() => {
    allHeard().then(setHeard);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  // The books bookmarks belong to (their uid only): from progress or the library.
  const books = useMemo(() => {
    const m = {};
    for (const [uid, p] of Object.entries(prog)) if (p?.book) m[uid] = p.book;
    for (const [uid, b] of Object.entries(lib)) m[uid] = m[uid] || b;
    return m;
  }, [prog, lib]);
  const results = useMemo(() => (term.length < 2 ? [] : searchMoments(term, { heard: heard || [], bookmarks: marks, books, highlights: hl, ideas: saved })), [term, heard, marks, books, hl, saved]);
  const go = (m) => {
    const b = m.book?.uid ? books[m.book.uid] || m.book : null;
    if (m.kind === 'highlight' || b?.kind === 'text') return b ? nav.push('reader', { book: b }) : nav.push('notes');
    if (m.kind === 'idea' || !b) return toast(m.text);
    const opts = m.global != null ? { globalStart: m.global } : { index: m.track || 0, time: m.time || 0 };
    nav.openOverlay('player');
    // The book that's open already: just go to that moment.
    if (player.getState().book?.uid === b.uid) return player.playAt(m.global != null ? m.global : player.trackOffset(m.track || 0) + (m.time || 0));
    player.openAndPlay(b, getDetails, opts);
  };
  const heardCount = (heard || []).reduce((n, p) => n + p.lines.length, 0);
  return (
    <div class="screen tm-screen">
      <TopBar title="Time Machine" ask={false} />
      <div class="search-box">
        <Icon name="search" size={20} />
        <input autoFocus value={q} placeholder="A word, a name, a line you remember…" onInput={(e) => setQ(e.currentTarget.value)} enterkeyhint="search" />
      </div>
      {term.length < 2 ? (
        <p class="muted pad">
          Searches everything you've heard with Text on{heard ? ` (${heardCount.toLocaleString()} lines so far)` : ''}, your bookmarks and their notes, highlights and saved ideas — in all your books. Tap a result to go back to that moment.
        </p>
      ) : !results.length ? (
        <p class="muted pad">Nothing found for “{term}”.</p>
      ) : (
        <div class="tm-list">
          {results.map((m) => (
            <button class="tm-row" onClick={() => go(m)}>
              <Cover book={m.book} class="tm-cover" />
              <span class="tm-text">
                <small>
                  <Icon name={KIND[m.kind][0]} size={12} /> {KIND[m.kind][1]} · {m.book?.title || ''}
                  {m.kind !== 'idea' && (m.global != null || m.time != null) ? ` · ${m.global != null ? fmtTime(m.global) : `part ${(m.track || 0) + 1}, ${fmtTime(m.time || 0)}`}` : ''}
                </small>
                <span>{m.text}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
