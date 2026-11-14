// The Library as a bookcase: each book a spine in its cover's colour, thicker for longer
// books. Finished books lean; the one you're listening to has a light edge.
import { useEffect, useState } from 'preact/hooks';
import { coverColor } from '../lib/color.js';
import { hashHue } from '../lib/format.js';
import { mainTitle } from '../lib/match.js';
import { nav } from '../lib/nav.js';
import * as player from '../lib/player.js';
import { longPress } from './book-actions.jsx';
import { BookCover } from './common.jsx';
import { metaNow } from '../lib/meta.js';

function Spine({ b, p, now, face }) {
  const cover = metaNow(b)?.cover || b.cover;
  const [col, setCol] = useState(`hsl(${hashHue(b.title || b.uid || '')} 45% 38%)`);
  useEffect(() => {
    let alive = true;
    if (cover && !face) coverColor(cover, b.title).then((c) => alive && c && setCol(c));
    return () => (alive = false);
  }, [cover, face]);
  const hours = (Number(b.duration) || p?.total || 0) / 3600;
  const w = Math.round(Math.max(24, Math.min(46, 22 + hours * 1.6)));
  const h = 150 + (hashHue(b.uid || b.title || '') % 36);
  const done = !!p?.finished;
  const open = () => (b.kind === 'text' && !String(b.uid).startsWith('lbl') ? nav.push('reader', { book: b }) : nav.push('book', { book: b }));
  // Facing out: the cover itself.
  if (face)
    return (
      <span class={'spine-slot face' + (done ? ' lean' : '')}>
        <button class={'face-book' + (now ? ' now' : '')} aria-label={`${b.title}${done ? ' (finished)' : ''}`} {...longPress(() => b)} onClick={open}>
          <BookCover book={b} />
        </button>
      </span>
    );
  return (
    <span class={'spine-slot' + (done ? ' lean' : '')}>
      <button
        class={'spine' + (now ? ' now' : '')}
        style={{ width: `${w}px`, height: `${h}px`, '--sc': col }}
        aria-label={`${b.title}${done ? ' (finished)' : ''}`}
        {...longPress(() => b)}
        onClick={open}
      >
        <span>{mainTitle(b.title || b.rawName || '')}</span>
      </button>
    </span>
  );
}

export function SpineShelf({ items, prog }) {
  const [count, setCount] = useState(90);
  const nowUid = player.getState().book?.uid;
  let shown = 0;
  return (
    <>
      <div class="bookcase">
        {items.slice(0, count).map((b, i) => {
          const p = prog?.[b.uid];
          // Facing out (like a bookshop shelf): the one playing, up to three you're in the middle
          // of, and every fourth book otherwise — the rest stand as spines.
          const going = p && !p.finished && (p.global || 0) > 60 && b.uid !== nowUid && shown++ < 3;
          const face = b.uid === nowUid || going || i % 4 === 0;
          return <Spine key={b.uid} b={b} p={p} now={b.uid === nowUid} face={face} />;
        })}
      </div>
      {items.length > count && (
        <button class="btn ghost-wide" onClick={() => setCount(count + 120)}>
          Show more ({items.length - count})
        </button>
      )}
    </>
  );
}
