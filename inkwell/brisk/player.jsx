// Audibrisk's player: a slim bar at the bottom, and the full player — cover, title, narrator,
// chapter, progress with time left, back 15 / forward 30, speed and sleep timer. The rest
// (chapters, bookmarks, skip silence, volume boost) waits in the small "More" menu.
import { useEffect, useState } from 'preact/hooks';
import { toast } from '../src/components/common.jsx';
import { Cover, UpNext } from './screens.jsx';
import { Icon } from '../src/components/icons.jsx';
import { nav, useBackClose } from '../src/lib/nav.js';
import { fmtTime, fmtDuration } from '../src/lib/format.js';
import { bookmarks, settings, useStore, persisted } from '../src/lib/store.js';

// Dream mode: while the sleep timer runs, the player turns warm and dim (the shared player fades
// the sound out at the end). On unless you switch it off in the sleep timer.
export const dreamOn = persisted('briskDream', true);
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
      {s.playing || s.loading ? (
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
      ) : (
        // Nothing playing: put the strip away (your place is kept; the book waits under Continue).
        <button
          class="b-mini-btn b-mini-x"
          aria-label="Close the player"
          onClick={(e) => {
            e.stopPropagation();
            player.stop();
          }}
        >
          <Icon name="close" size={18} />
        </button>
      )}
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

const SPEEDS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.5, 1.75, 2, 2.25, 2.5, 3];
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
  const [sheet, setSheet] = useState(null); // 'speed' | 'sleep' | 'chapters' | 'more' | 'note'
  const [noteFor, setNoteFor] = useState(null); // the bookmark just made, for its note
  const dream = useStore(dreamOn) && !!(s.sleepUntil || s.sleepEndOfTrack);
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
    <div class={'b-player' + (dream ? ' b-dream' : '')} style={color && s.book.cover ? { '--b-tint': color } : null}>
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
      <Bedtime s={s} />
      {s.awayDays > 0 && <p class="b-p-away">Welcome back after {s.awayDays >= 60 ? `${Math.round(s.awayDays / 30)} months` : `${Math.round(s.awayDays / 7)} weeks`} — picking up where you left off</p>}
      {s.error && !s.book.offline && (
        // That copy won't play (e.g. Real-Debrid's "hoster_unavailable"): pick another, keeping your place.
        <button
          class="b-link"
          onClick={() => {
            const b = s.book;
            nav.closeOverlay();
            nav.push('book', { book: { uid: b.uid, source: b.source, title: b.title, author: b.author, narrator: b.narrator, cover: b.cover, duration: b.duration }, fresh: true });
          }}
        >
          Try another copy
        </button>
      )}
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
        <button class="b-big-play" aria-label={s.playing ? 'Pause' : 'Play'} onClick={() => (navigator.vibrate?.(10), player.toggle())}>
          {s.loading ? <span class="b-spin" /> : <Icon name={s.playing ? 'pause' : 'play'} size={32} />}
        </button>
        <button class="b-fwd" aria-label="Forward 30 seconds" onClick={() => player.skip(30)}>
          <Icon name="replay" size={30} />
          <small>30</small>
        </button>
      </div>
      <UpNext inPlayer />
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
      {sheet === 'more' && <MoreSheet s={s} close={() => setSheet(null)} open={(k, t) => (t && setTab(t), setSheet(k))} onMark={(bm) => (setNoteFor(bm), setSheet('note'))} />}
      {sheet === 'note' && noteFor && <NoteSheet uid={s.book.uid} bm={noteFor} close={() => setSheet(null)} />}
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
          <div class="b-set-row">
            <div>
              <b>Dream mode</b>
              <small>Warm, dim colours while the timer runs; the sound fades out at the end</small>
            </div>
            <button class={'b-switch' + (dreamOn.get() ? ' on' : '')} role="switch" aria-checked={dreamOn.get()} aria-label="Dream mode" onClick={() => dreamOn.set(!dreamOn.get())}>
              <i />
            </button>
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
/** The small menu: chapters, bookmarks, skip silence, skip credits and volume boost (kept for this book). */
function MoreSheet({ s, close, open, onMark }) {
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
            if (bm) onMark(bm); // then a line of your own, if you like
            else close();
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
      <div class="b-set-row">
        <div>
          <b>Skip credits</b>
          <small>Jumps over chapters named Opening / End Credits or Publisher’s intro</small>
        </div>
        <button class={'b-switch' + (st.skipCredits !== false ? ' on' : '')} role="switch" aria-checked={st.skipCredits !== false} aria-label="Skip credits" onClick={() => settings.patch({ skipCredits: st.skipCredits === false })}>
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

/** A note on the bookmark just made: a quote, a name to remember… (optional — Skip keeps it as is). */
function NoteSheet({ uid, bm, close }) {
  const [text, setText] = useState('');
  const save = () => {
    if (text.trim()) player.renameBookmark(uid, bm.createdAt, text.trim());
    toast(`Bookmarked at ${fmtTime(bm.global)}`);
    close();
  };
  return (
    <Sheet title={`Bookmark at ${fmtTime(bm.global)}`} close={save}>
      <p class="b-sheet-sub">Add a note — a quote, a name to remember, a thought. Tapping the bookmark brings you back to this second.</p>
      <input class="b-input" placeholder={bm.label} value={text} onInput={(e) => setText(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && save()} autofocus />
      <div class="b-upnext-actions">
        <button class="b-pill" onClick={() => (toast(`Bookmarked at ${fmtTime(bm.global)}`), close())}>
          Skip
        </button>
        <button class="b-pill b-pill-go" onClick={save}>
          Save note
        </button>
      </div>
    </Sheet>
  );
}

/**
 * Late at night (10 pm – 4 am) with no sleep timer: a small offer — "☾ Sleep in 30 min?". One tap
 * sets it (with Dream mode); × hides it for tonight.
 */
let bedtimeHidden = 0;
function Bedtime({ s }) {
  const [, redraw] = useState(0);
  const h = new Date().getHours();
  const late = h >= 22 || h < 4;
  if (!late || !s.playing || s.sleepUntil || s.sleepEndOfTrack || Date.now() - bedtimeHidden < 8 * 3600e3) return null;
  return (
    <div class="b-bedtime">
      <button
        class="b-pill"
        onClick={() => {
          player.setSleep(30);
          toast('Sleep in 30 minutes');
        }}
      >
        ☾ Sleep in 30 min?
      </button>
      <button class="b-job-x" aria-label="Not tonight" onClick={() => ((bedtimeHidden = Date.now()), redraw((n) => n + 1))}>
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
