// Audibrisk's player: a slim bar at the bottom, and the full player — cover, title, narrator,
// chapter, progress with time left, back 15 / forward 30, speed and sleep timer. The rest
// (chapters, bookmarks, skip silence, volume boost) waits in the small "More" menu.
import { useEffect, useState } from 'preact/hooks';
import { toast } from '../src/components/common.jsx';
import { Cover } from './screens.jsx';
import { Icon } from '../src/components/icons.jsx';
import { nav, useBackClose } from '../src/lib/nav.js';
import { fmtTime, fmtDuration } from '../src/lib/format.js';
import { bookmarks, settings, useStore } from '../src/lib/store.js';
import * as player from '../src/lib/player.js';
import { useCoverColor } from '../src/components/player-ui.jsx';
import { backAfterInterruption } from './logic.js';

// 5 seconds back after a call or a notification sound took the audio, even a short one, once.
// (The shared player already does it after longer breaks; this never doubles it.)
let cut = null;
player.subscribe((s) => {
  if (s.interrupted && cut == null) cut = player.globalTime();
  else if (!s.interrupted && s.playing && cut != null) {
    const before = cut;
    cut = null;
    setTimeout(() => {
      const back = backAfterInterruption(before, player.globalTime());
      if (back) player.seekGlobal(Math.max(0, player.globalTime() - back));
    }, 400);
  } else if (!s.interrupted && !s.playing && cut != null && !s.book) cut = null;
});

const leftInBook = () => Math.max(0, player.totalDuration() - player.globalTime());

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
    <div class="b-mini" onClick={() => nav.openOverlay('player')}>
      <Cover book={s.book} px={120} />
      <div class="b-mini-text">
        <b>{s.book.title}</b>
        <span>{s.loading ? s.phase || 'Opening…' : [chapterNow(s)?.title, player.totalDuration() > 0 && `${fmtDuration(leftInBook())} left`].filter(Boolean).join(' · ') || s.book.author}</span>
      </div>
      <button
        class="b-mini-btn"
        aria-label="Back 15 seconds"
        onClick={(e) => {
          e.stopPropagation();
          player.skip(-15);
        }}
      >
        <Icon name="replay" size={20} />
      </button>
      <button
        class="b-mini-btn"
        aria-label={s.playing ? 'Pause' : 'Play'}
        onClick={(e) => {
          e.stopPropagation();
          player.toggle();
        }}
      >
        {s.loading ? <span class="b-spin small" /> : <Icon name={s.playing ? 'pause' : 'play'} size={22} />}
      </button>
      <i class="b-mini-bar" style={{ width: done + '%' }} />
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
    <div class="b-sheet-bg" onClick={close}>
      <div class="b-sheet" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

export function FullPlayer() {
  const s = usePlayer();
  const color = useCoverColor(s.book);
  const [sheet, setSheet] = useState(null); // 'speed' | 'sleep' | 'chapters' | 'more'
  const [drag, setDrag] = useState(null);
  const [tab, setTab] = useState('chapters');
  if (!s.book) return null;
  const ch = chapterNow(s);
  const all = player.chapters();
  const chIndex = ch ? all.findIndex((c) => c.start === ch.start) : -1;
  const left = Math.max(0, player.totalDuration() - player.globalTime());
  const marks = bookmarks.get()[s.book?.uid] || [];
  // The bar follows the chapter you're in (or the part, for books without chapters).
  const start = ch?.start ?? player.trackOffset(s.index);
  const end = ch?.end ?? start + (s.duration || 0);
  const len = Math.max(1, end - start);
  const at = Math.max(0, Math.min(len, (drag ?? player.globalTime()) - start));
  const sleeping = s.sleepUntil ? `${Math.max(1, Math.round((s.sleepUntil - Date.now()) / 60e3))}m` : s.sleepEndOfTrack ? 'Chapter' : '';
  return (
    <div class="b-player" style={color ? { '--b-tint': color } : null}>
      <div class="b-p-top">
        <button class="b-grab" aria-label="Close player" onClick={() => nav.closeOverlay()}>
          <Icon name="down" size={22} />
        </button>
        <small>{all.length > 1 && chIndex >= 0 ? `Chapter ${chIndex + 1} of ${all.length}` : ''}</small>
        <span class="b-grab-pad" />
      </div>
      <Cover book={s.book} class="b-player-cover" />
      <h2>{s.book.title}</h2>
      <p class="b-p-author">{s.book.author}</p>
      <p class="b-p-ch">{s.loading ? s.phase || 'Opening the book…' : ch?.title || ''}</p>
      {s.error && <p class="b-p-err">{s.error}</p>}
      <input
        class="b-scrub"
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
      <div class="b-times">
        <span>{fmtTime(at)}</span>
        <span>−{fmtTime(len - at)}</span>
      </div>
      {player.totalDuration() > 0 && (
        <p class="b-p-left">
          {all.length > 1 && chIndex >= 0 ? `Chapter ${chIndex + 1} of ${all.length} · ` : ''}
          {fmtDuration(left)} left in the book
        </p>
      )}
      <div class="b-ctl">
        <button aria-label="Back 15 seconds" onClick={() => player.skip(-15)}>
          <Icon name="replay" size={30} />
          <small>15</small>
        </button>
        <button class="b-big-play" aria-label={s.playing ? 'Pause' : 'Play'} onClick={() => player.toggle()}>
          {s.loading ? <span class="b-spin" /> : <Icon name={s.playing ? 'pause' : 'play'} size={32} />}
        </button>
        <button class="b-fwd" aria-label="Forward 30 seconds" onClick={() => player.skip(30)}>
          <Icon name="replay" size={30} />
          <small>30</small>
        </button>
      </div>
      <div class="b-extra">
        <button onClick={() => setSheet('speed')}>
          <b>{s.rate}×</b>Speed
        </button>
        <button onClick={() => setSheet('sleep')}>
          <b>{sleeping || <Icon name="moon" size={19} />}</b>Sleep
        </button>
        <button onClick={() => setSheet('more')}>
          <b>
            <Icon name="dots" size={19} />
          </b>
          More
        </button>
      </div>
      {sheet === 'more' && <MoreSheet s={s} close={() => setSheet(null)} open={(k, t) => (t && setTab(t), setSheet(k))} />}
      {sheet === 'speed' && (
        <Sheet title="Speed" close={() => setSheet(null)}>
          <div class="b-pills">
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
          <div class="b-list">
            {SLEEPS.map(([m, label]) => (
              <button onClick={() => (player.setSleep(m), setSheet(null), toast(`Sleep: ${label.toLowerCase()}`))}>{label}</button>
            ))}
            {(s.sleepUntil || s.sleepEndOfTrack) && <button onClick={() => (player.setSleep(null), setSheet(null))}>Turn off</button>}
          </div>
        </Sheet>
      )}
      {sheet === 'chapters' && (
        <Sheet title={s.book.title} close={() => setSheet(null)}>
          <p class="b-sheet-sub">
            {chIndex >= 0 && all.length > 1 ? `Chapter ${chIndex + 1} of ${all.length} · ` : ''}
            {fmtDuration(left)} left
          </p>
          <div class="b-seg">
            <button class={tab === 'chapters' ? 'on' : ''} onClick={() => setTab('chapters')}>
              Chapters · {all.length}
            </button>
            <button class={tab === 'marks' ? 'on' : ''} onClick={() => setTab('marks')}>
              Bookmarks · {marks.length}
            </button>
          </div>
          {tab === 'chapters' ? (
            <div class="b-chlist">
              {all.length <= 1 && <p class="b-empty">This book has no chapter marks — it's one long file.</p>}
              {all.length > 1 &&
                all.map((c, i) => {
                  const on = i === chIndex;
                  const done = on && c.end ? Math.min(100, ((player.globalTime() - c.start) / (c.end - c.start)) * 100) : 0;
                  return (
                    <button
                      class={on ? 'on' : ''}
                      onClick={() => {
                        if (typeof c.track === 'number' && !s.book.chaptersMeta?.length) player.jumpTo(c.track);
                        else player.seekGlobal(c.start);
                        setSheet(null);
                      }}
                    >
                      <i>{on ? <Icon name="chart" size={14} /> : i + 1}</i>
                      <span>
                        {c.title || `Chapter ${i + 1}`}
                        {on && (
                          <em class="b-bar">
                            <b style={{ width: done + '%' }} />
                          </em>
                        )}
                      </span>
                      <small>{c.end ? fmtTime(c.end - c.start) : fmtTime(c.start)}</small>
                    </button>
                  );
                })}
            </div>
          ) : (
            <div class="b-chlist">
              {!marks.length && <p class="b-empty">No bookmarks yet.</p>}
              {marks.map((m) => (
                <button onClick={() => (player.playBookmark(m), setSheet(null))}>
                  <i>
                    <Icon name="bookmark" size={14} />
                  </i>
                  <span>{m.label}</span>
                  <small>{fmtTime(m.global ?? m.time)}</small>
                </button>
              ))}
            </div>
          )}
        </Sheet>
      )}
    </div>
  );
}

const BOOSTS = [
  [0, 'Off'],
  [3, 'Low'],
  [6, 'Medium'],
  [10, 'High'],
];
/** The small menu: chapters, bookmarks, skip silence and volume boost (kept for this book). */
function MoreSheet({ s, close, open }) {
  const st = useStore(settings);
  useStore(player.bookPrefs);
  const boost = player.bookPrefs.get()[s.book.uid]?.boost ?? st.boost ?? 0;
  return (
    <Sheet title="More" close={close}>
      <div class="b-list">
        <button onClick={() => open('chapters', 'chapters')}>
          <Icon name="list" size={18} /> Chapters
        </button>
        <button onClick={() => open('chapters', 'marks')}>
          <Icon name="bookmark" size={18} /> Bookmarks
        </button>
        <button
          onClick={() => {
            const bm = player.addBookmark();
            if (bm) toast(`Bookmarked at ${fmtTime(bm.global)}`);
            close();
          }}
        >
          <Icon name="plus" size={18} /> Bookmark this moment
        </button>
      </div>
      <div class="b-set-row">
        <div>
          <b>Skip silence</b>
          <small>Cuts the quiet gaps between sentences</small>
        </div>
        <button class={'b-switch' + (st.skipSilence ? ' on' : '')} role="switch" aria-checked={!!st.skipSilence} aria-label="Skip silence" onClick={() => player.setAudio({ skipSilence: !st.skipSilence })}>
          <i />
        </button>
      </div>
      <div class="b-set-row b-col">
        <div>
          <b>Volume boost</b>
          <small>Makes quiet recordings louder (kept for this book)</small>
        </div>
        <div class="b-pills">
          {BOOSTS.map(([db, label]) => (
            <button class={boost === db ? 'on' : ''} onClick={() => player.setAudio({ boost: db })}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
