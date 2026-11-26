// Audibrisk's screens: Home (search, Continue, Offline), the book page and the settings sheet.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../src/components/icons.jsx';
import { toast } from '../src/components/common.jsx';
import { nav, useBackClose } from '../src/lib/nav.js';
import { useStore, progress, addons } from '../src/lib/store.js';
import { debrid } from '../src/lib/store.js';
import { downloads, cancelDownload, canDownload } from '../src/lib/downloads.js';
import { fmtDuration } from '../src/lib/format.js';
import { metaFixes } from '../src/lib/meta.js';
import * as player from '../src/lib/player.js';
import * as bk from './books.js';
import { VERSION, checkUpdate, installUpdate, updState, newer, isIphone } from './update.js';
import { Scene, rollScene, modeChoice, diceAll } from './scenes.jsx';
import { copyFacts, thumb, placeOf, fmtRating, libraryMatches, sortBooks, reportUrl, listeningLine, makeBackup, readBackup, finishText, awayText, seriesOf } from './logic.js';
import { summary as listenSummary, finishGuess } from '../src/lib/stats.js';
import { audible } from '../src/sources/catalogs.js';
import { bookmarks } from '../src/lib/store.js';
import { EDITION, NEWS, seenEdition } from './whatsnew.js';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { persisted } from '../src/lib/store.js';
import { searchCovers, setFix, fixFor } from '../src/lib/meta.js';
import { searchTitle } from '../src/lib/match.js';
import * as phone from '../src/sources/local.js';

/** A cover, or a quiet typographic one when there's no picture. */
export function Cover({ book, class: cls = '', px = 0 }) {
  // Remember which picture failed, not just "failed": a better cover found later still shows.
  const [bad, setBad] = useState('');
  const src = book?.cover && book.cover !== bad ? thumb(book.cover, px) : '';
  return (
    <div class={'b-cover ' + cls}>
      {src ? (
        <img src={src} alt="" decoding="async" onLoad={(e) => e.currentTarget.classList.add('in')} onError={() => setBad(book.cover)} />
      ) : (
        <div class="b-cover-blank">
          <b>{book?.title}</b>
          <small>{String(book?.author || '').split(',')[0]}</small>
        </div>
      )}
    </div>
  );
}

/** The mark: a play button with speed lines — press it and it plays. */
export const Logo = () => (
  <svg class="b-logo" viewBox="0 0 48 48" width="38" height="38" aria-hidden="true">
    <path d="M18 12.5 C18 10.6 20 9.5 21.6 10.5 L38 21.5 C39.5 22.5 39.5 24.6 38 25.6 L21.6 36.6 C20 37.6 18 36.5 18 34.6 Z" fill="currentColor" />
    <g stroke="currentColor" stroke-width="3" stroke-linecap="round">
      <path d="M5 18 h8" /><path d="M3 24 h10" /><path d="M5 30 h8" />
    </g>
  </svg>
);

function Header({ onSettings, dice }) {
  return (
    <header class="b-head">
      <div class="b-mark">
        <Logo />
        <span class="b-word">
          Audi<em>Brisk</em>
        </span>
      </div>
      <span class="b-head-btns">
        {dice && (
          <button class="b-icon" aria-label="Another picture" onClick={rollScene}>
            <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <rect x="4" y="4" width="16" height="16" rx="4" />
              <g fill="currentColor" stroke="none">
                <circle cx="9" cy="9" r="1.4" /><circle cx="15" cy="15" r="1.4" /><circle cx="15" cy="9" r="1.4" /><circle cx="9" cy="15" r="1.4" />
              </g>
            </svg>
          </button>
        )}
        <button class="b-icon" aria-label="Settings" onClick={onSettings}>
          <Icon name="settings" size={21} />
        </button>
      </span>
    </header>
  );
}

const leftOf = (b) => {
  const total = Number(b.duration) || 0;
  if (!total) return `${Math.round((b.percent || 0) * 100)}% listened`;
  const s = Math.max(0, total * (1 - (b.percent || 0)));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return `${h ? `${h}h ` : ''}${m}m left`;
};

/** One book you're listening to: cover, title, progress, time left, play. */
function ContinueCard({ b, onOpen }) {
  const opening = useOpening() === b.uid;
  return (
    <div class="b-cont" onClick={() => onOpen(b)} {...holdProps(b)}>
      <Cover book={b} px={240} />
      <div class="b-cont-text">
        <b>{b.title}</b>
        <span>{String(b.author || '').split(',')[0]}</span>
        <i class="b-cont-bar">
          <em style={{ width: Math.round((b.percent || 0) * 100) + '%' }} />
        </i>
        <small>{leftOf(b)}</small>
        <ContNote b={b} />
      </div>
      <button class="b-cont-play" aria-label="Play">
        {opening ? <span class="b-spin" /> : <Icon name="play" size={20} />}
      </button>
    </div>
  );
}

/** Under a book you're listening to: when you'll likely finish, or — back after a while — where you were. */
function ContNote({ b }) {
  const p = progress.get()[b.uid];
  const marks = bookmarks.get()[b.uid] || [];
  const note = [...marks].sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0)).find((m) => m.label && !/^(track|part|chapter)?\s*\d+$/i.test(m.label))?.label || '';
  const away = awayText(p, note);
  let line = away;
  if (!line) {
    try {
      line = finishText(finishGuess(b.uid)?.days);
    } catch {}
  }
  return line ? <em class={'b-cont-note' + (away ? ' away' : '')}>{line}</em> : null;
}

/** A grid of books (Library, Downloads). */
function Grid({ items, onOpen, empty, list = false }) {
  // A big cloud library: the first 30 at once, the rest when asked (drawing hundreds is slow).
  const [all, setAll] = useState(false);
  const opening = useOpening();
  const dls = useStore(downloads);
  if (!items.length) return <p class="b-quiet">{empty}</p>;
  const shown = all ? items : items.slice(0, 30);
  if (list)
    return (
      <>
        <div class="b-list-books">
          {shown.map((b) => {
            const at = placeOf(b, dls[b.uid]?.status === 'done');
            return (
              <button class="b-result" onClick={() => onOpen(b)} {...holdProps(b)}>
                <div class="b-tile-art">
                  <Cover book={b} px={160} />
                  {opening === b.uid && (
                    <span class="b-tile-wait">
                      <span class="b-spin small" />
                    </span>
                  )}
                </div>
                <div>
                  <b>{b.title}</b>
                  <span>{String(b.author || '').split(',')[0]}</span>
                  <small>{[at?.label, b.percent > 0.002 && `${Math.round(b.percent * 100)}%`].filter(Boolean).join(' · ')}</small>
                </div>
              </button>
            );
          })}
        </div>
        {items.length > 30 && !all && (
          <button class="b-link" onClick={() => setAll(true)}>
            Show all {items.length}
          </button>
        )}
      </>
    );
  return (
    <>
    <div class="b-grid">
      {shown.map((b) => (
        <button class="b-tile" onClick={() => onOpen(b)} {...holdProps(b)}>
          <div class="b-tile-art">
            <Cover book={b} px={320} />
            {opening === b.uid && (
              <span class="b-tile-wait">
                <span class="b-spin" />
              </span>
            )}
            {b.percent > 0 && (
              <i class="b-tile-bar">
                <b style={{ width: Math.round(b.percent * 100) + '%' }} />
              </i>
            )}
            {(() => {
              const at = placeOf(b, dls[b.uid]?.status === 'done');
              return at && <em class={'b-tile-src ' + at.key}>{at.label}</em>;
            })()}
            {b.dl && b.dl.status !== 'done' && <em class="b-tile-tag">{b.dl.total ? Math.round(((b.dl.done || 0) / b.dl.total) * 100) : 0}%</em>}
          </div>
          <span>{b.title}</span>
          <small>{String(b.author || '').split(',')[0]}</small>
        </button>
      ))}
    </div>
    {items.length > 30 && !all && (
      <button class="b-link" onClick={() => setAll(true)}>
        Show all {items.length}
      </button>
    )}
    </>
  );
}

// The book being opened from a grid or card: its tile shows a spinner at once, so a tap never
// feels ignored while TorBox / Real-Debrid lists its files.
let openingNow = '';
const openingSubs = new Set();
const setOpening = (uid) => ((openingNow = uid), openingSubs.forEach((f) => f(uid)));
function useOpening() {
  const [v, setV] = useState(openingNow);
  useEffect(() => (openingSubs.add(setV), () => openingSubs.delete(setV)), []);
  return v;
}
// Press and hold a book (library or Continue): a small menu — Play, Find other copies, Book page.
let heldAt = 0;
let holdNow = null;
const holdSubs = new Set();
const setHold = (b) => ((holdNow = b), holdSubs.forEach((f) => f(b)));
function useHoldBook() {
  const [v, setV] = useState(holdNow);
  useEffect(() => (holdSubs.add(setV), () => holdSubs.delete(setV)), []);
  return v;
}
/** Handlers for an element: hold half a second → the menu (a tap still plays). */
const holdProps = (b) => {
  let t = 0;
  let x = 0;
  let y = 0;
  return {
    onPointerDown: (e) => {
      x = e.clientX;
      y = e.clientY;
      clearTimeout(t);
      t = setTimeout(() => {
        heldAt = Date.now();
        navigator.vibrate?.(15);
        setHold(b);
      }, 480);
    },
    onPointerMove: (e) => Math.abs(e.clientX - x) + Math.abs(e.clientY - y) > 12 && clearTimeout(t),
    onPointerUp: () => clearTimeout(t),
    onPointerCancel: () => clearTimeout(t),
    onClickCapture: (e) => {
      if (Date.now() - heldAt < 900) e.stopPropagation(), e.preventDefault();
    },
    onContextMenu: (e) => e.preventDefault(),
  };
};
// "Find cover": covers from Audible, Apple, Google Books and Open Library — tap one to keep it.
let pickNow = null;
const pickSubs = new Set();
const setPickCover = (b) => ((pickNow = b), pickSubs.forEach((f) => f(b)));
function CoverSheet() {
  const [b, setB] = useState(pickNow);
  const [list, setList] = useState(null);
  useEffect(() => (pickSubs.add(setB), () => pickSubs.delete(setB)), []);
  const close = () => setPickCover(null);
  useBackClose(!!b, close);
  useEffect(() => {
    if (!b) return setList(null);
    let alive = true;
    setList(null);
    const term = `${searchTitle(b.title)} ${String(b.author || '').split(',')[0]}`.trim();
    searchCovers(term)
      .then((all) => {
        const seen = new Set();
        alive && setList(all.filter((m) => m?.cover && !seen.has(m.cover) && seen.add(m.cover)).slice(0, 18));
      })
      .catch(() => alive && setList([]));
    return () => (alive = false);
  }, [b?.uid]);
  if (!b) return null;
  const keep = (cover) => {
    setFix(b.uid, { ...(fixFor(b.uid) || {}), cover });
    toast('Cover changed');
    close();
  };
  return (
    <div class="b-sheet-bg" onClick={close}>
      <div class="b-sheet" onClick={(e) => e.stopPropagation()}>
        <h3>Cover for {b.title}</h3>
        {list == null ? (
          <p class="b-sheet-sub">
            <span class="b-spin small" /> Looking for covers…
          </p>
        ) : !list.length ? (
          <p class="b-sheet-sub">No covers found for this title.</p>
        ) : (
          <div class="b-cover-pick">
            {list.map((m) => (
              <button onClick={() => keep(m.cover)}>
                <Cover book={{ title: m.title, author: m.author, cover: m.cover }} px={240} />
                <small>{m.from}</small>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Your own books that fit the search, first (plays at once, with where it plays from). */
function MineInSearch({ q }) {
  const cloud = useStore(bk.cloudShelf).books;
  const dls = useStore(downloads);
  const local = useStore(phone.localCfg);
  const mine = libraryMatches([...bk.offline(dls), ...cloud, ...(phone.connected() ? local.books.filter((b) => b.kind !== 'text') : [])], q).map(bk.withCover);
  if (!mine.length) return null;
  return (
    <div class="b-mine">
      <small class="b-label">In your library</small>
      {mine.map((b) => {
        const at = placeOf(b, dls[b.uid]?.status === 'done');
        return (
          <button class="b-result" onClick={() => playIt(b)} {...holdProps(b)}>
            <Cover book={b} px={160} />
            <div>
              <b>{b.title}</b>
              <span>{String(b.author || '').split(',')[0]}</span>
              <small>{at ? `Plays from ${at.label}` : ''}</small>
            </div>
          </button>
        );
      })}
      <small class="b-label">Everything else</small>
    </div>
  );
}

function HoldSheet() {
  const b = useHoldBook();
  const close = () => setHold(null);
  useBackClose(!!b, close);
  if (!b) return null;
  const go = (fn) => () => (close(), fn());
  return (
    <div class="b-sheet-bg" onClick={close}>
      <div class="b-sheet" onClick={(e) => e.stopPropagation()}>
        <h3>{b.title}</h3>
        <div class="b-list">
          <button onClick={go(() => playIt(b))}>
            <Icon name="play" size={18} /> Play
          </button>
          {bk.provider() && !bk.isFree(b) && (
            <button onClick={go(() => nav.push('book', { book: b, fresh: true }))}>
              <Icon name="search" size={18} /> Find other copies
            </button>
          )}
          <button onClick={go(() => nav.push('book', { book: b }))}>
            <Icon name="book" size={18} /> Book page
          </button>
          <button onClick={go(() => setPickCover(b))}>
            <Icon name="image" size={18} /> Find cover
          </button>
          <button onClick={go(() => toast(bk.toggleWant(b) ? 'Added to Want to listen' : 'Removed from Want to listen'))}>
            <Icon name="heart" size={18} /> {bk.isWanted(b) ? 'Remove from Want to listen' : 'Want to listen'}
          </button>
        </div>
      </div>
    </div>
  );
}

const playIt = (b) => {
  if (openingNow === b.uid) return;
  // Already the book in the player: straight to it.
  if (player.getState().book?.uid === b.uid) return nav.openOverlay('player');
  setOpening(b.uid);
  bk.busy.now++;
  return bk
    .resume(b)
    .then(() => nav.openOverlay('player'))
    .catch((e) => toast(e.message))
    .finally(() => (bk.busy.now--, setOpening('')));
};

export function Home() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [all, setAll] = useState(false);
  const allProgress = useStore(progress);
  useStore(debrid);
  useStore(metaFixes);
  const timer = useRef(0);
  useEffect(() => {
    bk.refreshCloud();
  }, [bk.provider()]);
  useEffect(() => {
    clearTimeout(timer.current);
    if (!q.trim()) return setResults(null);
    setBusy(true);
    timer.current = setTimeout(() => {
      const term = q;
      bk.searchBooks(term, (first) => term === q && setResults(first)).then((r) => {
        if (term === q) setResults(r);
        setBusy(false);
      });
    }, 250);
  }, [q]);
  const cont = bk.continuing(allProgress).map(bk.withCover);
  const open = (b) => nav.push('book', { book: b });
  // The book you'll most likely tap: its copy fetched ahead, so it starts at once.
  useEffect(() => {
    const t = setTimeout(() => cont[0] && bk.prewarm(cont[0]), 2500);
    return () => clearTimeout(t);
  }, [cont[0]?.uid]);
  return (
    <div class={'b-home' + (q ? ' searching' : '')}>
      <Header onSettings={() => setSheet(true)} dice={!q} />
      {!q && (
        <div class="b-hero">
          <p class="b-hello">{greeting()}</p>
          <ListeningLine />
          <h1>What shall we listen to?</h1>
          <svg class="b-swoosh" viewBox="0 0 200 12" aria-hidden="true">
            <path d="M2 10 C60 2 130 1 198 4" fill="none" stroke="var(--b-gold)" stroke-width="2.4" stroke-linecap="round" />
          </svg>
          <Scene />
        </div>
      )}
      <label class="b-search">
        <Icon name="search" size={20} />
        <input placeholder="Books, authors, narrators…" value={q} onInput={(e) => setQ(e.currentTarget.value)} enterkeyhint="search" autocomplete="off" />
        {busy && <span class="b-spin small" />}
        {q && !busy && (
          <button aria-label="Clear" onClick={() => setQ('')}>
            <Icon name="close" size={16} />
          </button>
        )}
      </label>
      {!bk.provider() && !q && (
        <button class="b-welcome" onClick={() => setSheet(true)}>
          <b>Connect your debrid</b>
          <span>Add TorBox, Real-Debrid, AllDebrid or Premiumize once — then search, tap Play, and the app does the rest. Free LibriVox books play without one.</span>
          <em>Connect →</em>
        </button>
      )}
      {!q && <WhatsNew />}
      {!q && <UpNext />}
      {!q && <Jobs />}
      {results ? (
        // Scrolling the results puts the keyboard away, so the first tap on a book opens it.
        <div class="b-results" onTouchStart={() => document.activeElement?.blur?.()}>
          <MineInSearch q={q} />
          {!results.length && !busy && <p class="b-empty">Nothing found for “{q}”.</p>}
          {results.map((b) => (
            <button class="b-result" onClick={() => open(b)}>
              <Cover book={b} px={160} />
              <div>
                <b>{b.title}</b>
                <span>
                  {b.free && <em class="b-free">Free</em>}
                  {b.author}
                </span>
                <small>{[fmtRating(b), b.narrator && `Read by ${b.narrator.split(',')[0]}`, b.duration && fmtDuration(b.duration)].filter(Boolean).join(' · ')}</small>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <>
        {cont.length > 0 && (
          <section class="b-sec">
            <div class="b-sec-head">
              <h2>Continue Listening</h2>
              {cont.length > 1 && (
                <button onClick={() => setAll(!all)}>
                  {all ? 'Less' : 'See All'} <Icon name={all ? 'up' : 'chevron'} size={16} />
                </button>
              )}
            </div>
            {(all ? cont : cont.slice(0, 1)).map((b) => (
              <ContinueCard b={b} onOpen={playIt} />
            ))}
          </section>
        )}
        <ReadyNow />
        <YourLibrary skip={cont} />
        </>
      )}
      {sheet && <SettingsSheet close={() => setSheet(false)} />}
      <HoldSheet />
      <CoverSheet />
    </div>
  );
}

/** Books your TorBox / Real-Debrid is still getting ready: their %, then "Ready to play". */
function Jobs() {
  const all = useStore(bk.jobs);
  const list = Object.entries(all).sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
  if (!list.length) return null;
  return (
    <section class="b-sec b-jobs">
      {list.map(([uid, j]) => (
        <div class={'b-job ' + j.state}>
          <Cover book={bk.withCover(j.book)} px={160} />
          <div class="b-job-text" onClick={() => nav.push('book', { book: j.book })}>
            <b>{j.book.title}</b>
            <small>{j.state === 'ready' ? 'Ready to play' : j.state === 'failed' ? j.error || 'That copy didn’t work — try another' : `${bk.nameOf(j.provider)} is getting it ready · ${Math.round((j.progress || 0) * 100)}%`}</small>
            {j.state === 'fetching' && (
              <i class="b-cont-bar">
                <em style={{ width: Math.max(3, Math.round((j.progress || 0) * 100)) + '%' }} />
              </i>
            )}
          </div>
          {j.state === 'ready' ? (
            <button
              class="b-cont-play"
              aria-label="Play"
              onClick={() =>
                bk
                  .play(j.book)
                  .then(() => (bk.dismissJob(uid), nav.openOverlay('player')))
                  .catch((e) => toast(e.message))
              }
            >
              <Icon name="play" size={20} />
            </button>
          ) : (
            <button class="b-job-x" aria-label="Hide" onClick={() => bk.dismissJob(uid)}>
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
      ))}
    </section>
  );
}

/**
 * When a book ends: the next one of its series — play it, or get it ready for later.
 * (Shown on Home and in the player.)
 */
export function UpNext({ inPlayer = false }) {
  const u = useStore(bk.upNext);
  const [busy, setBusy] = useState('');
  if (!u?.next) return null;
  if (inPlayer && player.getState().book?.uid !== u.from.uid) return null;
  const n = u.next;
  const play = () => {
    setBusy('play');
    bk.play(n, null)
      .then(() => (bk.upNext.set(null), nav.openOverlay('player')))
      .catch((e) => (toast(e.message), nav.push('book', { book: n })))
      .finally(() => setBusy(''));
  };
  const ready = () => {
    setBusy('ready');
    bk.getReady(n)
      .then((r) => toast(r === 'ready' ? `${n.title} is ready to play` : `Getting ${n.title} ready — Home shows its progress`))
      .catch((e) => toast(e.message))
      .finally(() => setBusy(''));
  };
  return (
    <section class={'b-sec b-upnext' + (inPlayer ? ' in-player' : '')}>
      <small class="b-label">Finished {u.from.title} · next in the series</small>
      <div class="b-upnext-card">
        <div class="b-upnext-top" onClick={() => nav.push('book', { book: n })}>
          <Cover book={n} px={160} />
          <div class="b-job-text">
            <b>{n.title}</b>
            <small>{[n.series, String(n.author || '').split(',')[0]].filter(Boolean).join(' · ')}</small>
          </div>
          {!inPlayer && (
            <button
              class="b-job-x"
              aria-label="Hide"
              onClick={(e) => {
                e.stopPropagation();
                bk.upNext.set(null);
              }}
            >
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
        <div class="b-upnext-actions">
          <button class="b-pill" disabled={!!busy} onClick={ready}>
            {busy === 'ready' ? <span class="b-spin small" /> : 'Get ready'}
          </button>
          <button class="b-pill b-pill-go" disabled={!!busy} onClick={play}>
            {busy === 'play' ? <span class="b-spin small" /> : '▶ Play'}
          </button>
        </div>
      </div>
    </section>
  );
}

/** Popular books your service already has ready: tap one and it plays. */
function ReadyNow() {
  const r = useStore(bk.readyNow);
  const opening = useOpening();
  const books = r.service === bk.provider() ? r.books : [];
  if (books.length < 2) return null;
  return (
    <section class="b-sec">
      <div class="b-sec-head">
        <h2>Ready to play now</h2>
      </div>
      <div class="b-row">
        {books.map((b) => (
          <button class="b-row-item" onClick={() => playIt(b)} {...holdProps(b)}>
            <div class="b-tile-art">
              <Cover book={b} px={240} />
              <em class="b-tile-src instant">⚡ Instant</em>
              {opening === b.uid && (
                <span class="b-tile-wait">
                  <span class="b-spin" />
                </span>
              )}
            </div>
            <span>{b.title}</span>
            <small>{String(b.author || '').split(',')[0]}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

/** After an update: what's new, in plain words, until you close it. */
function WhatsNew() {
  const seen = useStore(seenEdition);
  if (seen >= EDITION) return null;
  return (
    <section class="b-sec b-news">
      <div class="b-news-card">
        <div class="b-news-head">
          <b>What’s new in Audibrisk</b>
          <button class="b-job-x" aria-label="Close" onClick={() => seenEdition.set(EDITION)}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <ul>
          {NEWS.map((n) => (
            <li>{n}</li>
          ))}
        </ul>
        <button class="b-pill b-pill-go" onClick={() => seenEdition.set(EDITION)}>
          Got it
        </button>
      </div>
    </section>
  );
}

/**
 * Back up / Restore: your places, bookmarks, library choices and settings in one file — for a new
 * phone or after reinstalling. Debrid keys are never in it (you add those again).
 */
function BackupRow() {
  const [busy, setBusy] = useState('');
  const fileRef = useRef(null);
  const backup = async () => {
    setBusy('save');
    try {
      const text = makeBackup((k) => localStorage.getItem('inkwell:' + k));
      const name = `audibrisk-backup-${new Date().toISOString().slice(0, 10)}.json`;
      if (phone.available) await phone.saveTextFile({ name, text, mime: 'application/json' });
      else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        a.download = name;
        a.click();
      }
      toast('Backup saved');
    } catch (e) {
      if (!/cancel/i.test(e?.message || '')) toast(e?.message || 'Couldn’t save the backup');
    } finally {
      setBusy('');
    }
  };
  const restore = async (e) => {
    const f = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!f) return;
    try {
      const entries = readBackup(await f.text());
      setBusy('restore');
      const put = () => entries.forEach(([k, v]) => localStorage.setItem('inkwell:' + k, v));
      // Written, then again after the app's own pending saves (up to 3 s), then a fresh start.
      put();
      setTimeout(() => (put(), location.reload()), 3500);
    } catch (err) {
      toast(err.message);
    }
  };
  return (
    <div class="b-set-row">
      <div>
        <b>Back up / Restore</b>
        <small>{busy === 'restore' ? 'Restoring — the app restarts in a moment…' : 'Your places, bookmarks and choices in one file (no keys)'}</small>
      </div>
      <span class="b-row-btns">
        <button class="b-pill" disabled={!!busy} onClick={backup}>
          {busy === 'save' ? <span class="b-spin small" /> : 'Back up'}
        </button>
        <button class="b-pill" disabled={!!busy} onClick={() => fileRef.current?.click()}>
          Restore
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" style="display:none" onChange={restore} />
      </span>
    </div>
  );
}

/** "Report a problem": a ready-filled note on the public repository (nothing private in it). */
function reportProblem() {
  const s = player.getState();
  const book = s.error && s.book ? s.book : bk.lastProblem.book || s.book;
  const url = reportUrl({
    version: VERSION,
    platform: `${Capacitor.getPlatform()} · ${(/Android [\d.]+|iPhone OS [\d_]+/.exec(navigator.userAgent) || [''])[0].replace(/_/g, '.')}`,
    services: bk.providers().map(bk.nameOf),
    book: book && { title: book.title, author: book.author, source: book.source },
    error: s.error || bk.lastProblem.text,
  });
  Browser.open({ url }).catch(() => window.open(url, '_blank'));
}

/** A quiet line: hours this month, books finished. No streaks, no pressure. */
function ListeningLine() {
  useStore(progress);
  let line = '';
  try {
    const st = listenSummary('listen');
    line = listeningLine(st.month, st.finishedAll);
  } catch {}
  return line ? <p class="b-listened">{line}</p> : null;
}

/** "Good morning" / afternoon / evening / night, by the phone's clock. */
const greeting = (h = new Date().getHours()) => (h >= 5 && h < 12 ? 'Good morning' : h >= 12 && h < 17 ? 'Good afternoon' : h >= 17 && h < 22 ? 'Good evening' : 'Good night');

/**
 * Your library, on Home: every book you have — in your debrid clouds, in your phone folder and
 * saved here — in one grid, each cover labelled with where it plays from. Little filters appear
 * when there's more than one kind. (No separate tabs: one screen does it all.)
 */
// How you like your library: grid or list, and its order (kept on the phone).
const libView = persisted('briskLibView', { list: false, sort: 'recent' });
function YourLibrary({ skip = [] }) {
  const cloudBooks = useStore(bk.cloudShelf).books;
  const local = useStore(phone.localCfg);
  const dls = useStore(downloads);
  const [only, setOnly] = useState('all');
  useStore(metaFixes);
  useStore(bk.covers);
  useEffect(() => {
    bk.refreshCloud();
    if (phone.connected()) phone.library().then((l) => bk.fillCovers(l)).catch(() => {});
  }, [bk.provider()]);
  const ids = new Set(skip.map((b) => b.uid));
  const seen = new Set();
  const items = [...bk.offline(dls), ...cloudBooks, ...(phone.connected() ? local.books.filter((b) => b.kind !== 'text') : [])]
    .filter((b) => b?.uid && !ids.has(b.uid) && !seen.has(b.uid) && seen.add(b.uid))
    .map(bk.withCover);
  const wanted = Object.values(useStore(bk.want)).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).map(bk.withCover);
  const finished = bk.finishedBooks(useStore(progress)).map(bk.withCover);
  const kinds = [...new Set(items.map((b) => placeOf(b, dls[b.uid]?.status === 'done')?.key).filter(Boolean))];
  // Two lists of your own beside where books play from: what you want to hear, and what you finished.
  const lists = [wanted.length && 'want', finished.length && 'finished'].filter(Boolean);
  const LABEL = { saved: 'Saved', phone: 'Phone', tb: 'TorBox', rd: 'Real-Debrid', ad: 'AllDebrid', pm: 'Premiumize', free: 'Free', want: 'Want to listen', finished: 'Finished' };
  const view = useStore(libView);
  const shown = sortBooks(only === 'want' ? wanted : only === 'finished' ? finished : only === 'all' ? items : items.filter((b) => placeOf(b, dls[b.uid]?.status === 'done')?.key === only), view.sort);
  if (!items.length && !wanted.length && !finished.length && !bk.provider() && !phone.connected()) return null;
  return (
    <section class="b-sec">
      <div class="b-sec-head">
        <h2>Your library</h2>
        {items.length > 1 && (
          <div class="b-lib-tools">
            <label class="b-sort">
              <select value={view.sort} onChange={(e) => libView.set({ ...libView.get(), sort: e.currentTarget.value })} aria-label="Sort">
                <option value="recent">Recent</option>
                <option value="title">Title</option>
                <option value="author">Author</option>
                <option value="series">Series</option>
              </select>
            </label>
            <button class="b-icon b-icon-sm" aria-label={view.list ? 'Show as grid' : 'Show as list'} onClick={() => libView.set({ ...libView.get(), list: !view.list })}>
              <Icon name={view.list ? 'grid' : 'list'} size={17} />
            </button>
          </div>
        )}
      </div>
      {(kinds.length > 1 || lists.length > 0) && (
        <div class="b-chips">
          {['all', ...lists, ...(kinds.length > 1 ? kinds : [])].map((k) => (
            <button class={only === k ? 'on' : ''} onClick={() => setOnly(k)}>
              {k === 'all' ? 'All' : LABEL[k] || k}
            </button>
          ))}
        </div>
      )}
      <Grid items={shown} list={view.list} onOpen={playIt} empty={bk.provider() ? 'Books in your cloud, your phone folder and the ones you save show here.' : 'Connect a debrid service in Settings to see your cloud.'} />
    </section>
  );
}

export function BookPage({ book, fresh = false }) {
  const [status, setStatus] = useState('');
  const [pct, setPct] = useState(null);
  const [err, setErr] = useState('');
  const [copies, setCopies] = useState(null);
  const [searching, setSearching] = useState(false);
  const [mine, setMine] = useState(null); // this book already in your TorBox / Real-Debrid
  const [more, setMore] = useState(false);
  // Looking for other copies even though this book already plays from one (its copy failed, or
  // you'd like another): from the player's "Try another copy", a long press, or the link below.
  const [want, setWant] = useState(fresh);
  const dls = useStore(downloads);
  const job = useStore(bk.jobs)[book.uid];
  useStore(phone.localCfg);
  const ps = player.getState();
  const link = bk.linkOf(book);
  const free = bk.isFree(book);
  const uid = bk.playUid(book);
  const saved = uid ? dls[uid] : null;
  const local = bk.onPhone(book, dls);
  useEffect(() => {
    // Look for copies as soon as the page opens, so Play starts at once (free LibriVox books need none).
    if (link && !want) bk.prewarm(book); // Play starts at once
    if (free || !bk.provider() || ((link || local) && !want)) return;
    let alive = true;
    if (!want) bk.inMyCloud(book).then((m) => alive && setMine(m)).catch(() => {});
    setSearching(true);
    bk.findCopies(book, (l) => alive && setCopies(l))
      .then((l) => alive && setCopies(l))
      .finally(() => alive && setSearching(false));
    return () => (alive = false);
  }, [book.uid, want]);
  const status1 = (t, p) => {
    setStatus(t);
    setPct(typeof p === 'number' && p > 0 && p < 1 ? p : null);
  };
  const run = (fn, list) => async () => {
    setErr('');
    status1('Getting ready…');
    try {
      await fn(book, status1, list || (copies?.length ? copies : null));
      status1('');
      return true;
    } catch (e) {
      status1('');
      setErr(e.message || String(e));
      return false;
    }
  };
  const onPlay = async () => {
    if (ps.book && uid && ps.book.uid === uid) return nav.openOverlay('player');
    if (await run(bk.play)()) nav.openOverlay('player');
  };
  // On your service now, to play later at once (the next of a series, a long trip…).
  const onReady = async () => {
    setErr('');
    status1('Getting ready…');
    try {
      const r = await bk.getReady(book, status1);
      status1('');
      toast(r === 'ready' ? 'Ready to play — it starts at once' : 'Getting it ready — Home shows its progress');
    } catch (e) {
      status1('');
      setErr(e.message || String(e));
    }
  };
  const onSave = async () => {
    if (await run(bk.save)()) toast('Saving for offline…');
  };
  const pick = async (r) => {
    // Your place in the copy you were listening to comes along (same point, or same percent).
    const was = progress.get()[uid || book.uid]?.percent || progress.get()[book.uid]?.percent || 0;
    bk.links.set((l) => {
      const next = { ...l };
      delete next[book.uid];
      return next;
    });
    setErr('');
    status1('Getting ready…');
    try {
      await bk.play(book, status1, [r], { percent: was });
      status1('');
      nav.openOverlay('player');
    } catch (e) {
      status1('');
      setErr(e.message || String(e));
    }
  };
  const savePct = saved?.total ? Math.round(((saved.done || 0) / saved.total) * 100) : 0;
  // One clear line about where this book will play from.
  const where = want && !copies?.length && searching
    ? 'Looking for other copies…'
    : want && copies?.length
      ? `${copies.length} other cop${copies.length === 1 ? 'y' : 'ies'} — tap one to play it${searching ? ' · still looking…' : ''}`
      : want && copies && !searching
        ? 'No other audio copy found'
        : free
    ? 'Free from LibriVox · no debrid needed'
    : local
      ? local.dl
        ? 'Saved on this phone · plays offline'
        : 'In your folder on this phone · plays from there'
      : job?.state === 'fetching'
        ? `${bk.nameOf(job.provider)} is getting it ready · ${Math.round((job.progress || 0) * 100)}% — you can leave this page`
        : job?.state === 'ready'
          ? 'Ready to play'
          : link
            ? 'Plays from the copy you used before'
            : mine
              ? `In your ${bk.nameOf(mine.source === 'rd' ? 'realdebrid' : 'torbox')} · ready to play`
              : !bk.provider()
                ? 'Connect TorBox or Real-Debrid in Settings to play this'
                : searching && !copies?.length
                  ? 'Looking for copies…'
                  : copies?.length
                    ? `${copies.length} cop${copies.length === 1 ? 'y' : 'ies'} found${copies.some((c) => c.cache?.any) ? ' · instant ones first' : ''}${searching ? ' · still looking…' : ''}`
                    : 'No audio copy found';
  const canSave = canDownload && !local;
  return (
    <div class="b-book">
      <div class="b-book-bg" style={book.cover ? { backgroundImage: `url("${book.cover}")` } : null} />
      <div class="b-book-top">
        <button class="b-icon" aria-label="Back" onClick={() => nav.back()}>
          <Icon name="back" size={20} />
        </button>
      </div>
      <Cover book={book} class="b-book-cover" />
      <h1>{book.title}</h1>
      <p class="b-by">
        {book.author ? (
          <button class="b-name" onClick={() => nav.push('people', { name: String(book.author).split(',')[0].trim(), kind: 'author' })}>
            {book.author}
          </button>
        ) : null}
      </p>
      <p class="b-facts">
        {book.narrator && (
          <button class="b-name small" onClick={() => nav.push('people', { name: book.narrator.split(',')[0].trim(), kind: 'narrator' })}>
            Read by {book.narrator.split(',')[0]}
          </button>
        )}
        {[book.narrator && ' ', book.duration && fmtDuration(book.duration), book.year].filter(Boolean).join('  ·  ')}
      </p>
      {book.series && <p class="b-series">{book.series}</p>}
      {book.series && <SeriesStrip book={book} />}
      {fmtRating(book) && <p class="b-rating">{fmtRating(book)} ratings on Audible</p>}
      <div class="b-actions">
        <button class="b-play" onClick={onPlay} disabled={!!status}>
          {status ? <span class="b-spin" /> : <Icon name="play" size={20} />}
          {status ? (pct != null ? `${Math.round(pct * 100)}%` : 'Opening') : link || (free && progress.get()[uid]) ? 'Resume' : 'Play'}
        </button>
        {!free && !local && !link && !mine && bk.provider() && !job && (
          <button class="b-save" onClick={onReady} disabled={!!status}>
            <Icon name="cloud" size={18} /> Get ready
          </button>
        )}
        {canSave && (
          <button class="b-save" onClick={saved?.status === 'done' ? undefined : onSave} disabled={!!status || saved?.status === 'downloading'}>
            <Icon name={saved?.status === 'done' ? 'check' : 'download'} size={18} />
            {saved?.status === 'done' ? 'Saved' : saved?.status === 'downloading' ? `${savePct}%` : 'Save'}
          </button>
        )}
      </div>
      <WantButton book={book} />
      {pct != null && (
        <i class="b-cont-bar b-book-bar">
          <em style={{ width: Math.round(pct * 100) + '%' }} />
        </i>
      )}
      <p class={'b-status' + (err ? ' err' : '')}>{err || status || where}</p>
      {saved?.status === 'downloading' && (
        <button class="b-link" onClick={() => cancelDownload(uid)}>
          Stop saving
        </button>
      )}
      {!!copies?.length && (!local || want) && !free && <Copies copies={copies} provider={bk.provider()} onPick={pick} busy={!!status} />}
      {!want && !free && bk.provider() && (link || local || mine) && (
        <button class="b-link" onClick={() => setWant(true)}>
          Find other copies
        </button>
      )}
      {book.description && <p class={'b-desc' + (more ? ' open' : '')} onClick={() => setMore(!more)}>{book.description}</p>}
    </div>
  );
}

/**
 * The series at a glance: its books as small numbered covers — the ones you finished ticked,
 * this one marked; tap another to open it.
 */
const seriesCache = new Map();
function SeriesStrip({ book }) {
  const s = seriesOf(book.series);
  const [list, setList] = useState(() => (s ? seriesCache.get(s.name) : null) || null);
  useEffect(() => {
    if (!s || list) return;
    let alive = true;
    audible
      .series(s.name, String(book.author || '').split(',')[0])
      .then((l) => (seriesCache.set(s.name, l), alive && setList(l)))
      .catch(() => {});
    return () => (alive = false);
  }, [book.uid]);
  if (!s || !list || list.length < 2) return null;
  const done = bk.finishedBooks();
  const isDone = (b) => done.some((f) => bk.sameBook(b, f));
  return (
    <div class="b-series-strip">
      {list.slice(0, 20).map((b) => {
        const here = b.uid === book.uid || b.seriesN === s.n;
        return (
          <button class={'b-ser' + (here ? ' here' : '')} onClick={() => !here && nav.push('book', { book: b })} aria-label={b.title}>
            <Cover book={b} px={160} />
            <small>
              {isDone(b) ? '✓ ' : ''}#{b.seriesN ?? '?'}
            </small>
          </button>
        );
      })}
    </div>
  );
}

/** An author's or narrator's other books (from Audible), to find the next one. */
export function PeoplePage({ name, kind = 'author' }) {
  const [list, setList] = useState(null);
  useEffect(() => {
    let alive = true;
    (kind === 'narrator' ? audible.byNarrator(name) : audible.byAuthor(name))
      .then((l) => alive && setList(l.filter((b) => b.title)))
      .catch(() => alive && setList([]));
    return () => (alive = false);
  }, [name, kind]);
  return (
    <div class="b-tab">
      <div class="b-book-top">
        <button class="b-icon" aria-label="Back" onClick={() => nav.back()}>
          <Icon name="back" size={20} />
        </button>
      </div>
      <p class="b-hello">{kind === 'narrator' ? 'Read by' : 'Books by'}</p>
      <h1 class="b-title">{name}</h1>
      {list == null ? (
        <p class="b-quiet">
          <span class="b-spin small" />
        </p>
      ) : !list.length ? (
        <p class="b-quiet">Nothing found right now.</p>
      ) : (
        <div class="b-results">
          {list.map((b) => (
            <button class="b-result" onClick={() => nav.push('book', { book: b })}>
              <Cover book={b} px={160} />
              <div>
                <b>{b.title}</b>
                <span>{b.series || String(b.author || '').split(',')[0]}</span>
                <small>{[fmtRating(b), b.duration && fmtDuration(b.duration)].filter(Boolean).join(' · ')}</small>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** ♡ Want to listen: kept in your library to come back to. */
function WantButton({ book }) {
  useStore(bk.want);
  const on = bk.isWanted(book);
  return (
    <button class={'b-link b-want' + (on ? ' on' : '')} onClick={() => toast(bk.toggleWant(book) ? 'Added to Want to listen' : 'Removed from Want to listen')}>
      {on ? '♥ In Want to listen' : '♡ Want to listen'}
    </button>
  );
}

/**
 * The copies found, as small boxes: instant (ready on your service) or seeds, size and format.
 * Tap one to play exactly that copy. No site names — they don't help you choose.
 */
function Copies({ copies, provider, onPick, busy }) {
  const [all, setAll] = useState(false);
  const shown = all ? copies.slice(0, 24) : copies.slice(0, 6);
  return (
    <div class="b-copies">
      <h2 class="b-label">Copies</h2>
      <div class="b-copy-grid">
        {shown.map((r) => {
          const f = copyFacts(r, provider);
          return (
            <button class={'b-copy' + (f.instant ? ' instant' : '')} onClick={() => onPick(r)} disabled={busy}>
              <b>{f.instant ? '⚡ Instant' : r.seeders ? `${r.seeders} seeds` : 'Not ready yet'}</b>
              <small>{f.line.split(' · ').slice(1).join(' · ') || ' '}</small>
            </button>
          );
        })}
      </div>
      {copies.length > 6 && (
        <button class="b-link" onClick={() => setAll(!all)}>
          {all ? 'Fewer copies' : `All ${Math.min(24, copies.length)} copies`}
        </button>
      )}
    </div>
  );
}

/** This version, and the newest: check, then download (with its %) and install, in the app. */
function UpdateRow() {
  const u = useStore(updState);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = u.latest && VERSION !== 'dev' && newer(u.latest, VERSION);
  const check = async () => {
    setBusy(true);
    try {
      const r = await checkUpdate();
      setNote(r.iphone ? 'On iPhone, new versions come through AltStore' : r.none ? 'No public release yet' : r.newer ? '' : 'You have the latest version');
    } catch {
      setNote('Couldn’t check right now');
    } finally {
      setBusy(false);
    }
  };
  const line =
    u.phase === 'downloading'
      ? `Downloading ${u.latest} · ${u.pct}%`
      : u.phase === 'permission'
        ? 'Allow installs from Audibrisk, then come back — it carries on by itself'
        : u.phase === 'installing'
          ? 'Opening the installer…'
          : u.phase === 'error'
            ? u.error
            : ready
              ? `Version ${u.latest} is ready`
              : note || (isIphone ? 'New versions come through AltStore' : 'Covers and details are found by themselves.');
  return (
    <div class="b-set-row">
      <div>
        <b>Audibrisk {VERSION}</b>
        <small>{line}</small>
        {u.phase === 'downloading' && (
          <i class="b-cont-bar">
            <em style={{ width: Math.max(3, u.pct) + '%' }} />
          </i>
        )}
      </div>
      <button class="b-pill" disabled={busy || u.phase === 'downloading'} onClick={ready ? installUpdate : check}>
        {busy ? <span class="b-spin small" /> : ready ? (u.phase === 'error' ? 'Try again' : 'Update now') : 'Check'}
      </button>
    </div>
  );
}

/** Light, dark, or as the phone is set. (The dice on Home changes the picture and its colours.) */
function ModeSwitch() {
  const mode = useStore(modeChoice);
  return (
    <div class="b-seg b-modes">
      {[
        ['auto', 'Auto'],
        ['light', 'Light'],
        ['dark', 'Dark'],
      ].map(([k, label]) => (
        <button class={mode === k ? 'on' : ''} onClick={() => modeChoice.set(k)}>
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * Sources, tucked away: every source is searched by itself, so most people never open this.
 * Turn one off, or paste a link to add your own.
 */
function Sources() {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  useStore(bk.sourcesOff);
  useStore(addons);
  const list = bk.sourceList();
  const add = async () => {
    setBusy(true);
    try {
      const n = await bk.addSource(link.trim());
      toast(`${n} source${n > 1 ? 's' : ''} added`);
      setLink('');
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div class="b-set-row">
        <div>
          <b>Sources</b>
          <small>{list.filter((x) => x.on).length} of {list.length} searched — all by themselves</small>
        </div>
        <button class="b-pill" onClick={() => setOpen(!open)}>
          {open ? 'Done' : 'Manage'}
        </button>
      </div>
      {open && (
        <div class="b-sources">
          {list.map((x) => (
            <div class="b-src-row">
              <span>{x.name}</span>
              {x.own && (
                <button class="b-link" onClick={() => bk.removeSource(x.id)}>
                  Remove
                </button>
              )}
              <button class={'b-switch' + (x.on ? ' on' : '')} role="switch" aria-checked={x.on} aria-label={x.name} onClick={() => bk.toggleSource(x.id)}>
                <i />
              </button>
            </div>
          ))}
          <div class="b-set-key">
            <input class="b-input" placeholder="Paste a source link" value={link} onInput={(e) => setLink(e.currentTarget.value)} autocomplete="off" />
            <button class="b-pill" disabled={busy || !link.trim()} onClick={add}>
              {busy ? <span class="b-spin small" /> : 'Add'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** What the dice on Home changes: the whole look, or just the picture (keeping champagne). */
function DiceChoice() {
  const all = useStore(diceAll);
  return (
    <div class="b-set-row">
      <div>
        <b>The dice changes</b>
        <small>{all ? 'Picture, colours and headings — a new look each roll' : 'Only the picture — colours stay champagne'}</small>
      </div>
      <div class="b-seg b-seg-sm">
        <button class={all ? 'on' : ''} onClick={() => diceAll.set(true)}>
          Everything
        </button>
        <button class={!all ? 'on' : ''} onClick={() => diceAll.set(false)}>
          Picture
        </button>
      </div>
    </div>
  );
}

/** One debrid service: connected (with Disconnect), or a box for its key. */
function ServiceRow({ which }) {
  useStore(debrid);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const on = bk.providers().includes(which);
  const name = bk.nameOf(which);
  const save = async () => {
    setBusy(true);
    try {
      await bk.connect(which, key);
      toast(`${name} connected`);
      setKey('');
      bk.refreshCloud(true);
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  };
  if (on)
    return (
      <div class="b-set-row">
        <div>
          <b>{name}</b>
          <small>Connected</small>
        </div>
        <button class="b-pill" onClick={() => bk.disconnect(which)}>
          Disconnect
        </button>
      </div>
    );
  return (
    <div class="b-set-key">
      <input class="b-input" type="password" placeholder={`${name} ${which === 'realdebrid' ? 'API token' : 'API key'}`} value={key} onInput={(e) => setKey(e.currentTarget.value)} autocomplete="off" />
      <button class="b-pill" disabled={busy || !key.trim()} onClick={save}>
        {busy ? <span class="b-spin small" /> : 'Connect'}
      </button>
    </div>
  );
}

function SettingsSheet({ close }) {
  useBackClose(true, close);
  useStore(debrid);
  const local = useStore(phone.localCfg);
  const [scanning, setScanning] = useState(false);
  const [more, setMore] = useState(false);
  const addFolder = async () => {
    setScanning(true);
    try {
      const books = await phone.addFolder();
      toast(`${books?.length || 0} audiobooks found on this phone`);
      bk.fillCovers(books || []);
    } catch (e) {
      if (!/cancel/i.test(e?.message || '')) toast(e.message);
    } finally {
      setScanning(false);
    }
  };
  return (
    <div class="b-sheet-bg" onClick={close}>
      <div class="b-sheet" onClick={(e) => e.stopPropagation()}>
        <h3>Settings</h3>
        <h4 class="b-sheet-h">Appearance</h4>
        <ModeSwitch />
        <DiceChoice />
        <h4 class="b-sheet-h">Listening services</h4>
        <p class="b-sheet-sub">Connect one service or several. A copy ready on any of them plays at once.</p>
        <ServiceRow which="torbox" />
        <ServiceRow which="realdebrid" />
        {more || bk.providers().some((p) => p === 'alldebrid' || p === 'premiumize') ? (
          <>
            <ServiceRow which="alldebrid" />
            <ServiceRow which="premiumize" />
          </>
        ) : (
          <button class="b-link" onClick={() => setMore(true)}>
            AllDebrid or Premiumize?
          </button>
        )}
        {phone.available && (
          <>
            <h4 class="b-sheet-h">Folder on this phone</h4>
            <p class="b-sheet-sub">Audiobooks already on your phone play from there, so you never download them again.</p>
            {local.folders.map((f) => (
              <div class="b-set-row">
                <div>
                  <b>{f.name}</b>
                  <small>{local.books.filter((b) => b.folder === f.uri && b.kind !== 'text').length} audiobooks</small>
                </div>
                <button class="b-pill" onClick={() => phone.removeFolder(f.uri)}>
                  Remove
                </button>
              </div>
            ))}
            <div class="b-set-row">
              <button class="b-pill" disabled={scanning} onClick={addFolder}>
                {scanning ? <span class="b-spin small" /> : local.folders.length ? 'Add another folder' : 'Choose a folder'}
              </button>
              {local.folders.length > 0 && (
                <button class="b-pill" disabled={scanning} onClick={() => (setScanning(true), phone.rescan().finally(() => setScanning(false)))}>
                  Look again
                </button>
              )}
            </div>
          </>
        )}
        <Sources />
        <h4 class="b-sheet-h">About</h4>
        <UpdateRow />
        <BackupRow />
        <div class="b-set-row">
          <div>
            <b>Report a problem</b>
            <small>Opens a ready-filled note on GitHub — no keys or private details in it</small>
          </div>
          <button class="b-pill" onClick={reportProblem}>
            Report
          </button>
        </div>
      </div>
    </div>
  );
}
