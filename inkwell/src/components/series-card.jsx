import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Cover } from './common.jsx';
import { useStore, library, progress } from '../lib/store.js';
import { nav } from '../lib/nav.js';
import { mainTitle, matches } from '../lib/match.js';
import { seriesOf, seriesBooks, statusIn, upNext, findSeries } from '../lib/series.js';
import { usePlayerBasics } from './player-ui.jsx';

const LABEL = { finished: '✓ Finished', have: 'You have it', reading: '' };

/**
 * The book's series on its page: "Book 2 of The Stormlight Archive", every book in
 * order with where you are, and what's next. Missing volumes are easy to spot.
 */
export function SeriesCard({ book }) {
  // From the book's details at once; else found (Audible, by title) — the details' own lookup
  // can finish after the page opens, and some copies never say their series.
  const [s, setS] = useState(() => seriesOf(book));
  useEffect(() => {
    let alive = true;
    const own = seriesOf(book);
    setS(own);
    if (!own?.name) findSeries(book).then((x) => alive && x && setS(x)).catch(() => {});
    return () => (alive = false);
  }, [book.uid, book.series, book.title]);
  const [books, setBooks] = useState(null);
  useStore(progress);
  useStore(library);
  useEffect(() => {
    setBooks(null);
    if (!s?.name) return;
    let alive = true;
    seriesBooks(s.name, book.author)
      .then((b) => alive && setBooks(b))
      .catch(() => alive && setBooks([]));
    return () => (alive = false);
  }, [s?.name, book.author]);
  const list = useMemo(() => (books ? statusIn(books) : []), [books]);
  const ps = usePlayerBasics();
  const row = useRef(null);
  const here = list.findIndex((x) => matches(mainTitle(book.title), x.book.title));
  // The book playing now, when it's one of these; else the one this page is about.
  const playingAt = ps.book ? list.findIndex((x) => matches(mainTitle(ps.book.title || ''), x.book.title)) : -1;
  const lit = playingAt >= 0 ? playingAt : here;
  const next = upNext(list, lit);
  // The lit book in view (book 9 of 14 isn't off the right edge).
  useEffect(() => {
    const el = row.current?.children?.[lit];
    if (el && row.current) row.current.scrollLeft = Math.max(0, el.offsetLeft - row.current.offsetLeft - 24);
  }, [lit, list.length]);
  if (!s?.name || (books && books.length < 2)) return null;
  const label = (x, i) =>
    i === playingAt && ps.playing ? `▶ ${x.pct ?? ''}${x.pct != null ? '%' : 'Playing'}` : x === next ? 'Up next' : x.state === 'reading' ? `${x.pct}%` : i === here ? 'This book' : LABEL[x.state] || 'Not yet';
  return (
    <section class="series-card">
      <div class="series-head">
        <span class="series-name">{s.name}</span>
        <small>{s.n != null ? `Book ${s.n} of ${books ? list.length : '…'}` : books ? `${list.length} books` : 'Looking up…'}</small>
      </div>
      {list.length > 0 && (
        <div class="series-row" ref={row}>
          {list.map((x, i) => (
            <button class={'series-item' + (i === here ? ' here' : '') + (i === lit ? ' lit' : '') + (x === next ? ' next' : '') + (x.state ? ' ' + x.state : '')} onClick={() => i !== here && nav.push('book', { book: x.book })}>
              <Cover book={x.book} />
              <span class="series-num">{x.book.seriesN != null ? `#${x.book.seriesN}` : '·'}</span>
              <small>{label(x, i)}</small>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
