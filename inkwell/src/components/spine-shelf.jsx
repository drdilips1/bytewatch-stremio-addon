// The Library as a bookcase: each book a spine in its cover's colour, thicker for longer
// books. Finished books lean; the one you're listening to has a light edge.
import { useEffect, useState } from 'preact/hooks';
import { coverColor } from '../lib/color.js';
import { hashHue } from '../lib/format.js';
import { mainTitle } from '../lib/match.js';
import { nav } from '../lib/nav.js';
import * as player from '../lib/player.js';
import { longPress } from './book-actions.jsx';

function Spine({ b, p, now }) {
  const [col, setCol] = useState(`hsl(${hashHue(b.title || b.uid || '')} 45% 38%)`);
  useEffect(() => {
    let alive = true;
    if (b.cover) coverColor(b.cover, b.title).then((c) => alive && c && setCol(c));
    return () => (alive = false);
  }, [b.cover]);
  const hours = (Number(b.duration) || p?.total || 0) / 3600;
  const w = Math.round(Math.max(24, Math.min(46, 22 + hours * 1.6)));
  const h = 150 + (hashHue(b.uid || b.title || '') % 36);
  const done = !!p?.finished;
  const open = () => (b.kind === 'text' && !String(b.uid).startsWith('lbl') ? nav.push('reader', { book: b }) : nav.push('book', { book: b }));
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
  return (
    <>
      <div class="bookcase">
        {items.slice(0, count).map((b) => (
          <Spine key={b.uid} b={b} p={prog?.[b.uid]} now={b.uid === nowUid} />
        ))}
      </div>
      {items.length > count && (
        <button class="btn ghost-wide" onClick={() => setCount(count + 120)}>
          Show more ({items.length - count})
        </button>
      )}
    </>
  );
}
