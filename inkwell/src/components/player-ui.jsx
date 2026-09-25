import { BgImage } from './bg-image.jsx';
import { loadImage } from '../lib/image.js';
import { useEffect, useRef, useState } from 'preact/hooks';
import * as player from '../lib/player.js';
import { Cover, toast } from './common.jsx';
import { Icon, SkipIcon } from './icons.jsx';
import { fmtTime } from '../lib/format.js';
import { coverColor } from '../lib/color.js';
import { nav } from '../lib/nav.js';
import { bookmarks, settings, useStore } from '../lib/store.js';
import { TranscriptView } from './transcript-view.jsx';
import { transcriptCfg, stopTranscript } from '../lib/transcript.js';

export function usePlayer() {
  const [s, setS] = useState(player.getState());
  useEffect(() => player.subscribe(setS), []);
  return s;
}

export function useCoverColor(book) {
  const st = useStore(settings);
  const [c, setC] = useState(null);
  useEffect(() => {
    if (!book || !st.dynamicColor) return setC(null);
    let alive = true;
    loadImage(book.cover)
      .catch(() => '')
      .then((src) => coverColor(src, book.title))
      .then((col) => alive && setC(col));
    return () => (alive = false);
  }, [book?.cover, st.dynamicColor]);
  return c;
}

const prepPct = (st) => Math.max(0, Math.min(100, Math.round((st.progress || 0) * 100)));
const prepLabel = (st) => `${st.provider === 'realdebrid' ? 'Real-Debrid' : 'TorBox'} is downloading · ${prepPct(st)}%`;

function PrepBar({ st }) {
  const pct = prepPct(st);
  return (
    <div class="prep">
      <div class="prep-head">
        <span>{st.provider === 'realdebrid' ? 'Real-Debrid' : 'TorBox'} is still downloading this</span>
        <b>{pct}%</b>
      </div>
      <div class="prep-track">
        <div style={{ width: Math.max(pct, 2) + '%' }} />
      </div>
      <small>{st.state && !/download/i.test(st.state) ? `Status: ${st.state.replace(/_/g, ' ')} · ` : ''}Playback starts by itself when it's done — you can leave this screen.</small>
    </div>
  );
}

export function MiniPlayer() {
  const s = usePlayer();
  const color = useCoverColor(s.book);
  if (!s.book) return null;
  const pct = s.duration ? (s.time / s.duration) * 100 : 0;
  return (
    <div class="mini-player" style={color ? { '--dyn': color } : null} onClick={() => nav.openOverlay('player')}>
      <div class="mini-progress" style={{ width: pct + '%' }} />
      <Cover book={s.book} class="mini-cover" />
      <div class="mini-meta">
        <div class="mini-title">{s.book.title}</div>
        <div class="mini-sub">
          {s.preparing ? <span class="prep-text">{prepLabel(s.preparing)}</span> : s.error ? <span class="err">{s.error}</span> : s.tracks[s.index]?.title || s.book.author}
        </div>
      </div>
      <button
        class="icon-btn"
        aria-label="Back"
        onClick={(e) => {
          e.stopPropagation();
          player.skip(-settings.get().skipBack);
        }}
      >
        <SkipIcon seconds={settings.get().skipBack} size={26} />
      </button>
      <button
        class="play-btn small"
        aria-label={s.playing ? 'Pause' : 'Play'}
        onClick={(e) => {
          e.stopPropagation();
          player.toggle();
        }}
      >
        {s.loading ? <span class="spinner" /> : <Icon name={s.playing ? 'pause' : 'play'} size={20} />}
      </button>
      <button
        class="icon-btn mini-close"
        aria-label="Close player"
        onClick={(e) => {
          e.stopPropagation();
          player.stop();
        }}
      >
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}

const SPEEDS = [0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const SLEEP = [5, 10, 15, 30, 45, 60, 90];

export function FullPlayer() {
  const s = usePlayer();
  const st = useStore(settings);
  const bms = useStore(bookmarks)[s.book?.uid] || [];
  const color = useCoverColor(s.book);
  const [sheet, setSheet] = useState(null); // 'chapters' | 'speed' | 'sleep' | 'bookmarks'
  const [scrub, setScrub] = useState(null);
  const [, tick] = useState(0);
  const [drag, setDrag] = useState(0);
  const touch = useRef(null);
  useEffect(() => {
    if (!s.sleepUntil) return;
    const iv = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(iv);
  }, [s.sleepUntil]);
  if (!s.book) return null;
  const dur = s.duration || s.tracks[s.index]?.duration || 0;
  const t = scrub ?? s.time;
  const chapters = player.chapters();
  const g = player.globalTime();
  const total = player.totalDuration();
  const showText = useStore(transcriptCfg).open;
  const sleepLeft = s.sleepUntil ? Math.max(0, (s.sleepUntil - Date.now()) / 1000) : 0;

  return (
    <div
      class="full-player"
      style={{ ...(color ? { '--dyn': color } : {}), transform: drag ? `translateY(${drag}px)` : undefined, transition: drag ? 'none' : undefined }}
      onTouchStart={(e) => {
        if (e.target.closest('input,.sheet,.transcript')) return;
        touch.current = e.touches[0].clientY;
      }}
      onTouchMove={(e) => {
        if (touch.current == null) return;
        setDrag(Math.max(0, e.touches[0].clientY - touch.current));
      }}
      onTouchEnd={() => {
        if (touch.current == null) return;
        touch.current = null;
        if (drag > 120) nav.closeOverlay();
        setDrag(0);
      }}
    >
      <div class="fp-bg">
        {s.book.cover && <BgImage url={s.book.cover} />}
      </div>
      <header class="fp-top">
        <button class="icon-btn" onClick={() => nav.closeOverlay()} aria-label="Close player">
          <Icon name="down" />
        </button>
        <div class="fp-top-title">
          <small>Now playing</small>
          <span>{s.book.title}</span>
        </div>
        <button
          class="icon-btn"
          onClick={() => {
            nav.closeOverlay();
            nav.push('book', { book: s.book });
          }}
          aria-label="Details"
        >
          <Icon name="list" />
        </button>
      </header>

      {showText ? (
        <TranscriptView s={s} />
      ) : (
        <div class={'fp-art' + (s.playing ? ' playing' : '')}>
          <Cover book={s.book} eager />
        </div>
      )}

      <div class="fp-meta">
        <h2>{s.tracks[s.index]?.title || s.book.title}</h2>
        <p>
          {s.book.author}
          {s.tracks.length > 1 && ` · Part ${s.index + 1} of ${s.tracks.length}`}
        </p>
        {s.preparing && <PrepBar st={s.preparing} />}
        {s.error && !s.preparing && <p class="err">{s.error}</p>}
      </div>

      <div class="fp-scrub">
        <input
          type="range"
          min="0"
          max={dur || 1}
          step="0.5"
          value={t}
          style={{ '--pct': (dur ? (t / dur) * 100 : 0) + '%' }}
          onInput={(e) => setScrub(+e.currentTarget.value)}
          onChange={(e) => {
            player.seek(+e.currentTarget.value);
            setScrub(null);
          }}
        />
        <div class="fp-times">
          <span>{fmtTime(t)}</span>
          {total > dur + 1 && <span class="fp-total">{Math.round((g / total) * 100)}% of book · {fmtTime(total - g)} left</span>}
          <span>-{fmtTime(Math.max(0, dur - t))}</span>
        </div>
      </div>

      <div class="fp-controls">
        <button class="icon-btn lg" onClick={() => player.prev()} aria-label="Previous">
          <Icon name="prev" size={24} />
        </button>
        <button class="icon-btn lg" onClick={() => player.skip(-st.skipBack)} aria-label={`Back ${st.skipBack}s`}>
          <SkipIcon seconds={st.skipBack} size={36} />
        </button>
        <button class="play-btn big" onClick={() => player.toggle()} aria-label={s.playing ? 'Pause' : 'Play'}>
          {s.loading ? <span class="spinner" /> : <Icon name={s.playing ? 'pause' : 'play'} size={34} />}
        </button>
        <button class="icon-btn lg" onClick={() => player.skip(st.skipForward)} aria-label={`Forward ${st.skipForward}s`}>
          <SkipIcon seconds={st.skipForward} forward size={36} />
        </button>
        <button class="icon-btn lg" onClick={() => player.next()} aria-label="Next">
          <Icon name="next" size={24} />
        </button>
      </div>

      <div class="fp-actions">
        <button class="chip-btn" onClick={() => setSheet('speed')}>
          <b>{s.rate}×</b> Speed
        </button>
        <button class={'chip-btn' + (s.sleepUntil || s.sleepEndOfTrack ? ' active' : '')} onClick={() => setSheet('sleep')}>
          <Icon name="moon" size={16} /> {s.sleepUntil ? fmtTime(sleepLeft) : s.sleepEndOfTrack ? 'End of part' : 'Sleep'}
        </button>
        <button
          class={'chip-btn' + (showText ? ' active' : '')}
          onClick={() => {
            if (showText) stopTranscript();
            transcriptCfg.set({ open: !showText });
          }}
          aria-label="Transcript"
        >
          <Icon name="text" size={16} /> Text
        </button>
        <button class="chip-btn" onClick={() => setSheet('chapters')}>
          <Icon name="list" size={16} /> {chapters.length}
        </button>
        <button
          class="chip-btn"
          onClick={() => {
            player.addBookmark();
            toast('Bookmark added');
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setSheet('bookmarks');
          }}
        >
          <Icon name="bookmark" size={16} /> {bms.length || ''}
        </button>
        {bms.length > 0 && (
          <button class="chip-btn" onClick={() => setSheet('bookmarks')}>
            Marks
          </button>
        )}
        <button
          class="chip-btn"
          aria-label="Stop playback"
          onClick={() => {
            nav.closeOverlay();
            player.stop();
          }}
        >
          <Icon name="close" size={16} />
        </button>
      </div>

      {sheet && (
        <div class="sheet-backdrop" onClick={() => setSheet(null)}>
          <div class="sheet" onClick={(e) => e.stopPropagation()}>
            <div class="sheet-handle" />
            {sheet === 'speed' && (
              <>
                <h3>Playback speed</h3>
                <div class="speed-grid">
                  {SPEEDS.map((r) => (
                    <button class={'pill' + (r === s.rate ? ' active' : '')} onClick={() => player.setRate(r)}>
                      {r}×
                    </button>
                  ))}
                </div>
                <input type="range" min="0.5" max="3" step="0.05" value={s.rate} style={{ '--pct': ((s.rate - 0.5) / 2.5) * 100 + '%' }} onInput={(e) => player.setRate(+(+e.currentTarget.value).toFixed(2))} />
              </>
            )}
            {sheet === 'sleep' && (
              <>
                <h3>Sleep timer</h3>
                <div class="speed-grid">
                  {SLEEP.map((m) => (
                    <button
                      class="pill"
                      onClick={() => {
                        player.setSleep(m);
                        setSheet(null);
                        toast(`Sleeping in ${m} minutes`);
                      }}
                    >
                      {m} min
                    </button>
                  ))}
                  <button
                    class={'pill' + (s.sleepEndOfTrack ? ' active' : '')}
                    onClick={() => {
                      player.setSleep('track');
                      setSheet(null);
                    }}
                  >
                    End of part
                  </button>
                  {(s.sleepUntil || s.sleepEndOfTrack) && (
                    <button
                      class="pill danger"
                      onClick={() => {
                        player.setSleep(null);
                        setSheet(null);
                      }}
                    >
                      Turn off
                    </button>
                  )}
                </div>
              </>
            )}
            {sheet === 'chapters' && (
              <>
                <h3>Chapters</h3>
                <ol class="chapter-list">
                  {chapters.map((c, i) => {
                    const active = g >= c.start && g < (c.end || Infinity) - 0.01;
                    return (
                      <li class={active ? 'active' : ''}>
                        <button
                          onClick={() => {
                            if (c.track != null) player.jumpTo(c.track);
                            else player.seekGlobal(c.start);
                            setSheet(null);
                          }}
                        >
                          <span class="ch-num">{i + 1}</span>
                          <span class="ch-title">{c.title}</span>
                          <span class="ch-time">{c.end ? fmtTime(c.end - c.start) : ''}</span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </>
            )}
            {sheet === 'bookmarks' && (
              <>
                <h3>Bookmarks</h3>
                <ol class="chapter-list">
                  {bms.map((b, i) => (
                    <li>
                      <button
                        onClick={() => {
                          player.jumpTo(b.track, b.time);
                          setSheet(null);
                        }}
                      >
                        <span class="ch-num">
                          <Icon name="bookmark" size={14} />
                        </span>
                        <span class="ch-title">{b.label}</span>
                        <span class="ch-time">{fmtTime(b.time)}</span>
                      </button>
                      <button
                        class="icon-btn"
                        aria-label="Delete bookmark"
                        onClick={() => bookmarks.set((all) => ({ ...all, [s.book.uid]: bms.filter((_, k) => k !== i) }))}
                      >
                        <Icon name="trash" size={16} />
                      </button>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function Waveform({ playing }) {
  const ref = useRef();
  return (
    <span ref={ref} class={'eq' + (playing ? ' on' : '')}>
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}
