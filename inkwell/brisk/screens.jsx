// Audibrisk's screens: Home (search, Continue, Offline), the book page and the settings sheet.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../src/components/icons.jsx';
import { toast } from '../src/components/common.jsx';
import { nav, useBackClose } from '../src/lib/nav.js';
import { useStore, progress } from '../src/lib/store.js';
import { debrid } from '../src/lib/store.js';
import { downloads, cancelDownload, canDownload } from '../src/lib/downloads.js';
import { fmtDuration } from '../src/lib/format.js';
import { metaFixes } from '../src/lib/meta.js';
import * as player from '../src/lib/player.js';
import * as bk from './books.js';
import { VERSION, checkUpdate } from './update.js';
import { Scene, rollScene, modeChoice } from './scenes.jsx';
import { copyFacts, thumb, placeOf } from './logic.js';
import * as phone from '../src/sources/local.js';

/** A cover, or a quiet typographic one when there's no picture. */
export function Cover({ book, class: cls = '', px = 0 }) {
  // Remember which picture failed, not just "failed": a better cover found later still shows.
  const [bad, setBad] = useState('');
  const src = book?.cover && book.cover !== bad ? thumb(book.cover, px) : '';
  return (
    <div class={'b-cover ' + cls}>
      {src ? (
        <img src={src} alt="" decoding="async" onError={() => setBad(book.cover)} />
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
    <div class="b-cont" onClick={() => onOpen(b)}>
      <Cover book={b} px={240} />
      <div class="b-cont-text">
        <b>{b.title}</b>
        <span>{String(b.author || '').split(',')[0]}</span>
        <i class="b-cont-bar">
          <em style={{ width: Math.round((b.percent || 0) * 100) + '%' }} />
        </i>
        <small>{leftOf(b)}</small>
      </div>
      <button class="b-cont-play" aria-label="Play">
        {opening ? <span class="b-spin" /> : <Icon name="play" size={20} />}
      </button>
    </div>
  );
}

/** A grid of books (Library, Downloads). */
function Grid({ items, onOpen, empty }) {
  // A big cloud library: the first 30 at once, the rest when asked (drawing hundreds is slow).
  const [all, setAll] = useState(false);
  const opening = useOpening();
  const dls = useStore(downloads);
  if (!items.length) return <p class="b-quiet">{empty}</p>;
  const shown = all ? items : items.slice(0, 30);
  return (
    <>
    <div class="b-grid">
      {shown.map((b) => (
        <button class="b-tile" onClick={() => onOpen(b)}>
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
      bk.searchBooks(term).then((r) => {
        if (term === q) setResults(r);
        setBusy(false);
      });
    }, 380);
  }, [q]);
  const cont = bk.continuing(allProgress).map(bk.withCover);
  const open = (b) => nav.push('book', { book: b });
  return (
    <div class={'b-home' + (q ? ' searching' : '')}>
      <Header onSettings={() => setSheet(true)} dice={!q} />
      {!q && (
        <div class="b-hero">
          <h1>
            Less app.
            <br />
            More listening.
          </h1>
          <svg class="b-swoosh" viewBox="0 0 200 12" aria-hidden="true">
            <path d="M2 10 C60 2 130 1 198 4" fill="none" stroke="var(--b-gold)" stroke-width="2.4" stroke-linecap="round" />
          </svg>
          <Scene />
        </div>
      )}
      <label class="b-search">
        <Icon name="search" size={20} />
        <input placeholder="Search audiobooks…" value={q} onInput={(e) => setQ(e.currentTarget.value)} enterkeyhint="search" autocomplete="off" />
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
          <span>Audibrisk streams through your TorBox or Real-Debrid — add your key once. Free LibriVox books play without one.</span>
          <em>Connect →</em>
        </button>
      )}
      {!q && <Jobs />}
      {results ? (
        // Scrolling the results puts the keyboard away, so the first tap on a book opens it.
        <div class="b-results" onTouchStart={() => document.activeElement?.blur?.()}>
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
                <small>{[b.narrator && `Read by ${b.narrator.split(',')[0]}`, b.duration && fmtDuration(b.duration)].filter(Boolean).join(' · ')}</small>
              </div>
            </button>
          ))}
        </div>
      ) : (
        cont.length > 0 && (
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
        )
      )}
      {sheet && <SettingsSheet close={() => setSheet(false)} />}
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

export function LibraryTab() {
  const cloudBooks = useStore(bk.cloudShelf).books;
  const allProgress = useStore(progress);
  const local = useStore(phone.localCfg);
  useStore(metaFixes);
  useStore(bk.covers);
  useEffect(() => {
    bk.refreshCloud();
    if (phone.connected()) phone.library().then((l) => bk.fillCovers(l)).catch(() => {});
  }, []);
  const phoneBooks = phone.connected() ? local.books.filter((b) => b.kind !== 'text').map((b) => bk.withCover({ ...b, cover: b.cover || '' })) : [];
  const cont = bk.continuing(allProgress).map(bk.withCover);
  const ids = new Set(cont.map((b) => b.uid));
  const mine = cloudBooks.filter((b) => !ids.has(b.uid)).map(bk.withCover);
  return (
    <div class="b-tab">
      <h1 class="b-title">Library</h1>
      {cont.length > 0 && (
        <section class="b-sec">
          <h2 class="b-label">Listening</h2>
          <Grid items={cont} onOpen={playIt} />
        </section>
      )}
      <section class="b-sec">
        <h2 class="b-label">In your {bk.providerName() || 'cloud'}</h2>
        <Grid items={mine} onOpen={playIt} empty={bk.provider() ? 'Audiobooks in your cloud show here.' : 'Connect TorBox or Real-Debrid in Settings to see your cloud.'} />
      </section>
      {phoneBooks.length > 0 && (
        <section class="b-sec">
          <h2 class="b-label">On this phone</h2>
          <Grid items={phoneBooks} onOpen={playIt} />
        </section>
      )}
    </div>
  );
}

export function DownloadsTab() {
  const dls = useStore(downloads);
  useStore(metaFixes);
  const off = bk.offline(dls).map(bk.withCover);
  return (
    <div class="b-tab">
      <h1 class="b-title">Downloads</h1>
      <p class="b-sub">Saved on this phone — they play without internet.</p>
      <Grid items={off} onOpen={playIt} empty={canDownload ? 'Tap Save on a book to keep it here for offline listening.' : 'Saving for offline works in the Android app.'} />
    </div>
  );
}

export function BookPage({ book }) {
  const [status, setStatus] = useState('');
  const [pct, setPct] = useState(null);
  const [err, setErr] = useState('');
  const [copies, setCopies] = useState(null);
  const [searching, setSearching] = useState(false);
  const [mine, setMine] = useState(null); // this book already in your TorBox / Real-Debrid
  const [more, setMore] = useState(false);
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
    if (free || !bk.provider() || link || local) return;
    let alive = true;
    bk.inMyCloud(book).then((m) => alive && setMine(m)).catch(() => {});
    setSearching(true);
    bk.findCopies(book, (l) => alive && setCopies(l))
      .then((l) => alive && setCopies(l))
      .finally(() => alive && setSearching(false));
    return () => (alive = false);
  }, [book.uid]);
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
  const onSave = async () => {
    if (await run(bk.save)()) toast('Saving for offline…');
  };
  const pick = async (r) => {
    bk.links.set((l) => {
      const next = { ...l };
      delete next[book.uid];
      return next;
    });
    if (await run(bk.play, [r])()) nav.openOverlay('player');
  };
  const savePct = saved?.total ? Math.round(((saved.done || 0) / saved.total) * 100) : 0;
  // One clear line about where this book will play from.
  const where = free
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
      <p class="b-by">{book.author}</p>
      <p class="b-facts">
        {[book.narrator && `Read by ${book.narrator.split(',')[0]}`, book.duration && fmtDuration(book.duration), book.year].filter(Boolean).join('  ·  ')}
      </p>
      {book.series && <p class="b-series">{book.series}</p>}
      <div class="b-actions">
        <button class="b-play" onClick={onPlay} disabled={!!status}>
          {status ? <span class="b-spin" /> : <Icon name="play" size={20} />}
          {status ? (pct != null ? `${Math.round(pct * 100)}%` : 'Opening') : link || (free && progress.get()[uid]) ? 'Resume' : 'Play'}
        </button>
        {canSave && (
          <button class="b-save" onClick={saved?.status === 'done' ? undefined : onSave} disabled={!!status || saved?.status === 'downloading'}>
            <Icon name={saved?.status === 'done' ? 'check' : 'download'} size={18} />
            {saved?.status === 'done' ? 'Saved' : saved?.status === 'downloading' ? `${savePct}%` : 'Save'}
          </button>
        )}
      </div>
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
      {!!copies?.length && !local && !free && <Copies copies={copies} provider={bk.provider()} onPick={pick} busy={!!status} />}
      {book.description && <p class={'b-desc' + (more ? ' open' : '')} onClick={() => setMore(!more)}>{book.description}</p>}
    </div>
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
      <input class="b-input" type="password" placeholder={which === 'torbox' ? 'TorBox API key' : 'Real-Debrid API token'} value={key} onInput={(e) => setKey(e.currentTarget.value)} autocomplete="off" />
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
  const [upd, setUpd] = useState('');
  const [scanning, setScanning] = useState(false);
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
        <ModeSwitch />
        <p class="b-sheet-sub">Connect TorBox, Real-Debrid or both. With both, a copy ready on either plays at once.</p>
        <ServiceRow which="torbox" />
        <ServiceRow which="realdebrid" />
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
        <div class="b-set-row">
          <div>
            <b>Audibrisk {VERSION}</b>
            <small>{upd || 'Covers and details are found by themselves.'}</small>
          </div>
          <button
            class="b-pill"
            onClick={() =>
              checkUpdate(true)
                .then((u) => setUpd(u.newer ? `Version ${u.version} — downloading` : 'You have the latest version'))
                .catch(() => setUpd('Couldn’t check right now'))
            }
          >
            Update
          </button>
        </div>
      </div>
    </div>
  );
}
