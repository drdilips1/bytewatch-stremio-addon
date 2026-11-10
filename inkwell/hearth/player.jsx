// Hearth's player: a small bar above the tabs, and the full player (cover, chapter, time,
// back 15 / forward 30, speed, sleep timer, chapters, bookmark).
import { useEffect, useState } from 'preact/hooks';
import { BookCover, toast } from '../src/components/common.jsx';
import { Icon } from '../src/components/icons.jsx';
import { nav, useBackClose } from '../src/lib/nav.js';
import { fmtTime } from '../src/lib/format.js';
import * as player from '../src/lib/player.js';
import { useCoverColor } from '../src/components/player-ui.jsx';

function usePlayer() {
  const [s, setS] = useState(player.getState());
  useEffect(() => player.subscribe(setS), []);
  return s;
}

const chapterNow = (s) => {
  const list = player.chapters();
  const g = player.globalTime();
  return list.find((c) => g >= c.start && g < (c.end ?? Infinity)) || list[s.index] || null;
};

export function MiniPlayer() {
  const s = usePlayer();
  if (!s.book) return null;
  const total = player.totalDuration();
  const done = total > 0 ? Math.min(100, (player.globalTime() / total) * 100) : 0;
  return (
    <div class="h-mini" onClick={() => nav.openOverlay('player')}>
      <BookCover book={s.book} class="h-cover" />
      <div class="h-mini-text">
        <b>{s.book.title}</b>
        <span>{s.loading ? s.phase || 'Opening…' : chapterNow(s)?.title || s.book.author}</span>
      </div>
      <button
        class="h-mini-btn"
        aria-label={s.playing ? 'Pause' : 'Play'}
        onClick={(e) => {
          e.stopPropagation();
          player.toggle();
        }}
      >
        {s.loading ? <span class="spinner small" /> : <Icon name={s.playing ? 'pause' : 'play'} size={22} />}
      </button>
      <i class="h-mini-bar" style={{ width: done + '%' }} />
    </div>
  );
}

const SPEEDS = [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.5, 1.75, 2];
const SLEEPS = [
  [10, '10 minutes'],
  [20, '20 minutes'],
  [30, '30 minutes'],
  [45, '45 minutes'],
  [60, '1 hour'],
  ['track', 'End of chapter'],
];

function Sheet({ title, close, children }) {
  useBackClose(true, close);
  return (
    <div class="h-sheet-bg" onClick={close}>
      <div class="h-sheet" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

export function FullPlayer() {
  const s = usePlayer();
  const color = useCoverColor(s.book);
  const [sheet, setSheet] = useState(null); // 'speed' | 'sleep' | 'chapters'
  const [drag, setDrag] = useState(null);
  if (!s.book) return null;
  const ch = chapterNow(s);
  // The bar follows the chapter you're in (or the part, for books without chapters).
  const start = ch?.start ?? player.trackOffset(s.index);
  const end = ch?.end ?? start + (s.duration || 0);
  const len = Math.max(1, end - start);
  const at = Math.max(0, Math.min(len, (drag ?? player.globalTime()) - start));
  const sleeping = s.sleepUntil ? `${Math.max(1, Math.round((s.sleepUntil - Date.now()) / 60e3))}m` : s.sleepEndOfTrack ? 'Chapter' : '';
  const chapters = sheet === 'chapters' ? player.chapters() : [];
  return (
    <div class="h-player" style={color ? { '--h-tint': color } : null}>
      <button class="h-grab" aria-label="Close player" onClick={() => nav.closeOverlay()}>
        <Icon name="down" size={22} />
      </button>
      <BookCover book={s.book} class="h-cover h-player-cover" />
      <h2>{s.book.title}</h2>
      <p class="h-p-author">{s.book.author}</p>
      <p class="h-p-ch">{s.loading ? s.phase || 'Opening the book…' : ch?.title || ''}</p>
      {s.error && <p class="h-p-err">{s.error}</p>}
      <input
        class="h-scrub"
        type="range"
        min="0"
        max={len}
        step="1"
        value={at}
        style={{ '--p': (at / len) * 100 + '%' }}
        onInput={(e) => setDrag(start + Number(e.currentTarget.value))}
        onChange={(e) => {
          player.seekGlobal(start + Number(e.currentTarget.value));
          setDrag(null);
        }}
      />
      <div class="h-times">
        <span>{fmtTime(at)}</span>
        <span>−{fmtTime(len - at)}</span>
      </div>
      <div class="h-ctl">
        <button aria-label="Back 15 seconds" onClick={() => player.skip(-15)}>
          <Icon name="replay" size={30} />
          <small>15</small>
        </button>
        <button class="h-big-play" aria-label={s.playing ? 'Pause' : 'Play'} onClick={() => player.toggle()}>
          {s.loading ? <span class="spinner" /> : <Icon name={s.playing ? 'pause' : 'play'} size={32} />}
        </button>
        <button class="h-fwd" aria-label="Forward 30 seconds" onClick={() => player.skip(30)}>
          <Icon name="replay" size={30} />
          <small>30</small>
        </button>
      </div>
      <div class="h-extra">
        <button onClick={() => setSheet('speed')}>
          <b>{s.rate}×</b>Speed
        </button>
        <button onClick={() => setSheet('sleep')}>
          <b>{sleeping || <Icon name="moon" size={19} />}</b>Sleep
        </button>
        <button onClick={() => setSheet('chapters')}>
          <b>
            <Icon name="list" size={19} />
          </b>
          Chapters
        </button>
        <button
          onClick={() => {
            const bm = player.addBookmark();
            if (bm) toast(`Bookmarked at ${fmtTime(bm.global)}`);
          }}
        >
          <b>
            <Icon name="bookmark" size={19} />
          </b>
          Bookmark
        </button>
      </div>
      {sheet === 'speed' && (
        <Sheet title="Speed" close={() => setSheet(null)}>
          <div class="h-pills">
            {SPEEDS.map((r) => (
              <button class={s.rate === r ? 'on' : ''} onClick={() => (player.setRate(r), setSheet(null))}>
                {r}×
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {sheet === 'sleep' && (
        <Sheet title="Sleep timer" close={() => setSheet(null)}>
          <div class="h-list">
            {SLEEPS.map(([m, label]) => (
              <button onClick={() => (player.setSleep(m), setSheet(null), toast(`Sleep: ${label.toLowerCase()}`))}>{label}</button>
            ))}
            {(s.sleepUntil || s.sleepEndOfTrack) && <button onClick={() => (player.setSleep(null), setSheet(null))}>Turn off</button>}
          </div>
        </Sheet>
      )}
      {sheet === 'chapters' && (
        <Sheet title="Chapters" close={() => setSheet(null)}>
          <div class="h-list h-chapters">
            {chapters.map((c, i) => (
              <button
                class={c === ch || (ch && c.start === ch.start) ? 'on' : ''}
                onClick={() => {
                  if (typeof c.track === 'number' && !s.book.chaptersMeta?.length) player.jumpTo(c.track);
                  else player.seekGlobal(c.start);
                  setSheet(null);
                }}
              >
                <span>{c.title || `Chapter ${i + 1}`}</span>
                <small>{fmtTime(c.start)}</small>
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}
