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

/** A cover, or a quiet typographic one when there's no picture. */
export function Cover({ book, class: cls = '' }) {
  const [bad, setBad] = useState(false);
  const src = !bad && book?.cover;
  return (
    <div class={'b-cover ' + cls}>
      {src ? (
        <img src={src} alt="" loading="lazy" onError={() => setBad(true)} />
      ) : (
        <div class="b-cover-blank">
          <b>{book?.title}</b>
          <small>{String(book?.author || '').split(',')[0]}</small>
        </div>
      )}
    </div>
  );
}

/** Headphones with a small sound wave: the mark. */
export const Logo = () => (
  <svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true">
    <path d="M8 28v-4a16 16 0 0 1 32 0v4" fill="none" stroke="#4a3b2c" stroke-width="3.2" stroke-linecap="round" />
    <rect x="5" y="26" width="8" height="14" rx="4" fill="#4a3b2c" />
    <rect x="35" y="26" width="8" height="14" rx="4" fill="#4a3b2c" />
    <g stroke="#4a3b2c" stroke-width="2.2" stroke-linecap="round">
      <path d="M18 31v4" /><path d="M21 28v10" /><path d="M24 25v16" /><path d="M27 28v10" /><path d="M30 31v4" />
    </g>
  </svg>
);

function Header({ onSettings }) {
  return (
    <header class="b-head">
      <div class="b-mark">
        <Logo />
        <span class="b-word">
          Audi<em>Brisk</em>
        </span>
      </div>
      <button class="b-icon" aria-label="Settings" onClick={onSettings}>
        <Icon name="settings" size={21} />
      </button>
    </header>
  );
}

/** A misty lake at sunrise: hills, a low sun, a sailboat and three birds (drawn, so it works offline). */
const Scene = () => (
  <svg class="b-scene" viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient id="bs-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#f6efe4" stop-opacity="0" />
        <stop offset="0.5" stop-color="#f3e6d3" />
        <stop offset="1" stop-color="#efdfc8" />
      </linearGradient>
      <radialGradient id="bs-sun" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#fbeed6" />
        <stop offset="1" stop-color="#f5dcb5" />
      </radialGradient>
      <linearGradient id="bs-water" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#e9dcc8" />
        <stop offset="1" stop-color="#f6efe4" />
      </linearGradient>
      <linearGradient id="bs-mist" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#f3e8d8" stop-opacity="0" />
        <stop offset="0.55" stop-color="#f1e5d3" stop-opacity="0.85" />
        <stop offset="1" stop-color="#ece0cc" stop-opacity="0" />
      </linearGradient>
      <linearGradient id="bs-glow" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#f7e3bf" stop-opacity="0.9" />
        <stop offset="1" stop-color="#f7e3bf" stop-opacity="0" />
      </linearGradient>
    </defs>
    <rect width="400" height="260" fill="url(#bs-sky)" />
    <circle cx="232" cy="122" r="30" fill="url(#bs-sun)" />
    <path d="M0 118 C40 100 80 104 120 112 C170 122 200 98 250 96 C300 94 340 80 400 72 V160 H0 Z" fill="#cfc2ae" opacity="0.55" />
    <path d="M0 136 C50 120 90 126 140 132 C190 138 230 112 280 116 C330 120 360 104 400 100 V160 H0 Z" fill="#b8ad99" opacity="0.6" />
    <path d="M0 150 C30 142 60 146 90 144 C120 141 150 148 180 146 C230 142 260 150 300 146 C340 142 370 146 400 142 V162 H0 Z" fill="#8f927b" opacity="0.55" />
    <rect y="160" width="400" height="100" fill="url(#bs-water)" />
    <rect y="146" width="400" height="30" fill="url(#bs-mist)" />
    <rect x="214" y="160" width="36" height="80" fill="url(#bs-glow)" opacity="0.7" />
    <g opacity="0.85">
      <path d="M314 116 L314 154" stroke="#6b5d4c" stroke-width="1.2" />
      <path d="M314 116 L332 150 L314 150 Z" fill="#f4ece0" stroke="#d9cbb6" stroke-width="0.6" />
      <path d="M313 122 L300 150 L313 150 Z" fill="#ece1d1" />
      <path d="M296 154 L334 154 L329 159 L301 159 Z" fill="#7a6b58" />
      <path d="M314 162 L314 186" stroke="#7a6b58" stroke-width="0.8" opacity="0.35" />
    </g>
    <g fill="none" stroke="#7d7062" stroke-width="1.3" stroke-linecap="round" opacity="0.8">
      <path d="M318 52 q4 -4 8 0 q4 -4 8 0" />
      <path d="M340 40 q3 -3 6 0 q3 -3 6 0" />
      <path d="M332 64 q3 -3 6 0 q3 -3 6 0" />
    </g>
  </svg>
);

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
  return (
    <div class="b-cont" onClick={() => onOpen(b)}>
      <Cover book={b} />
      <div class="b-cont-text">
        <b>{b.title}</b>
        <span>{String(b.author || '').split(',')[0]}</span>
        <i class="b-cont-bar">
          <em style={{ width: Math.round((b.percent || 0) * 100) + '%' }} />
        </i>
        <small>{leftOf(b)}</small>
      </div>
      <button class="b-cont-play" aria-label="Play">
        <Icon name="play" size={20} />
      </button>
    </div>
  );
}

/** A grid of books (Library, Downloads). */
function Grid({ items, onOpen, empty }) {
  if (!items.length) return <p class="b-quiet">{empty}</p>;
  return (
    <div class="b-grid">
      {items.map((b) => (
        <button class="b-tile" onClick={() => onOpen(b)}>
          <div class="b-tile-art">
            <Cover book={b} />
            {b.percent > 0 && (
              <i class="b-tile-bar">
                <b style={{ width: Math.round(b.percent * 100) + '%' }} />
              </i>
            )}
            {b.dl && b.dl.status !== 'done' && <em class="b-tile-tag">{b.dl.total ? Math.round(((b.dl.done || 0) / b.dl.total) * 100) : 0}%</em>}
          </div>
          <span>{b.title}</span>
          <small>{String(b.author || '').split(',')[0]}</small>
        </button>
      ))}
    </div>
  );
}

const playIt = (b) =>
  bk
    .resume(b)
    .then(() => nav.openOverlay('player'))
    .catch((e) => toast(e.message));

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
      <Header onSettings={() => setSheet(true)} />
      {!q && (
        <div class="b-hero">
          <h1>
            Less app.
            <br />
            More listening.
          </h1>
          <svg class="b-swoosh" viewBox="0 0 200 12" aria-hidden="true">
            <path d="M2 10 C60 2 130 1 198 4" fill="none" stroke="#c9a15c" stroke-width="2.4" stroke-linecap="round" />
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
          <span>Audibrisk streams through your TorBox or Real-Debrid. Add your key once — that’s the only setting.</span>
          <em>Connect →</em>
        </button>
      )}
      {results ? (
        <div class="b-results">
          {!results.length && !busy && <p class="b-empty">Nothing found for “{q}”.</p>}
          {results.map((b) => (
            <button class="b-result" onClick={() => open(b)}>
              <Cover book={b} />
              <div>
                <b>{b.title}</b>
                <span>{b.author}</span>
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

export function LibraryTab() {
  const cloudBooks = useStore(bk.cloudShelf).books;
  const allProgress = useStore(progress);
  useStore(metaFixes);
  useEffect(() => {
    bk.refreshCloud();
  }, []);
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
  const [err, setErr] = useState('');
  const [copies, setCopies] = useState(null);
  const [more, setMore] = useState(false);
  const dls = useStore(downloads);
  const ps = player.getState();
  const link = bk.linkOf(book);
  const saved = link ? dls[link.uid] : null;
  useEffect(() => {
    // Look for copies as soon as the page opens, so Play starts at once.
    if (!bk.provider() || link) return;
    let alive = true;
    bk.findCopies(book, (l) => alive && setCopies(l)).then((l) => alive && setCopies(l));
    return () => (alive = false);
  }, [book.uid]);
  const run = (fn) => async () => {
    setErr('');
    setStatus('Getting ready…');
    try {
      await fn(book, (t) => setStatus(t), copies?.length ? copies : null);
      setStatus('');
      return true;
    } catch (e) {
      setStatus('');
      setErr(e.message || String(e));
      return false;
    }
  };
  const onPlay = async () => {
    if (ps.book && link && ps.book.uid === link.uid) return nav.openOverlay('player');
    if (await run(bk.play)()) nav.openOverlay('player');
  };
  const onSave = async () => {
    if (await run(bk.save)()) toast('Saving for offline…');
  };
  const pct = saved?.total ? Math.round(((saved.done || 0) / saved.total) * 100) : 0;
  const found = copies == null ? (bk.provider() && !link ? 'Looking for copies…' : '') : copies.length ? `${copies.length} cop${copies.length === 1 ? 'y' : 'ies'} found${copies.some((c) => c.cache?.any) ? ' · ready to stream' : ''}` : 'No audio copy found yet';
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
          {status ? 'Opening' : link ? 'Resume' : 'Play'}
        </button>
        {canDownload && (
          <button class="b-save" onClick={saved?.status === 'done' ? undefined : onSave} disabled={!!status || saved?.status === 'downloading'}>
            <Icon name={saved?.status === 'done' ? 'check' : 'download'} size={18} />
            {saved?.status === 'done' ? 'Saved' : saved?.status === 'downloading' ? `${pct}%` : 'Save'}
          </button>
        )}
      </div>
      {(status || err || found) && <p class={'b-status' + (err ? ' err' : '')}>{err || status || found}</p>}
      {saved?.status === 'downloading' && (
        <button class="b-link" onClick={() => cancelDownload(link.uid)}>
          Stop saving
        </button>
      )}
      {book.description && <p class={'b-desc' + (more ? ' open' : '')} onClick={() => setMore(!more)}>{book.description}</p>}
      {!!copies?.length && <Copies copies={copies} book={book} onStatus={setStatus} onErr={setErr} />}
    </div>
  );
}

/** The copies found, folded away: for choosing another one by hand. */
function Copies({ copies, book, onStatus, onErr }) {
  const [open, setOpen] = useState(false);
  const pick = async (r) => {
    onErr('');
    onStatus('Getting ready…');
    try {
      bk.links.set((l) => {
        const next = { ...l };
        delete next[book.uid];
        return next;
      });
      await bk.play(book, onStatus, [r]);
      onStatus('');
      nav.openOverlay('player');
    } catch (e) {
      onStatus('');
      onErr(e.message);
    }
  };
  return (
    <div class="b-copies">
      <button class="b-link" onClick={() => setOpen(!open)}>
        {open ? 'Hide copies' : 'Choose another copy'}
      </button>
      {open &&
        copies.slice(0, 12).map((r) => (
          <button class="b-copy" onClick={() => pick(r)}>
            <span>{r.title}</span>
            <small>{[r.cache?.any && 'Ready', r.format, r.size && fmtSize(r.size), r.seeders ? `${r.seeders} seeds` : ''].filter(Boolean).join(' · ')}</small>
          </button>
        ))}
    </div>
  );
}
const fmtSize = (n) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`);

function SettingsSheet({ close }) {
  useBackClose(true, close);
  useStore(debrid);
  const [which, setWhich] = useState(bk.provider() || 'torbox');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [upd, setUpd] = useState('');
  const connected = bk.provider();
  const save = async () => {
    setBusy(true);
    try {
      await bk.connect(which, key);
      toast(`${bk.providerName()} connected`);
      setKey('');
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="b-sheet-bg" onClick={close}>
      <div class="b-sheet" onClick={(e) => e.stopPropagation()}>
        <h3>Settings</h3>
        {connected ? (
          <div class="b-set-row">
            <div>
              <b>{bk.providerName()}</b>
              <small>Connected — books stream through it</small>
            </div>
            <button class="b-pill" onClick={() => bk.disconnect()}>
              Disconnect
            </button>
          </div>
        ) : (
          <>
            <p class="b-sheet-sub">Choose your debrid service and paste its API key.</p>
            <div class="b-seg">
              <button class={which === 'torbox' ? 'on' : ''} onClick={() => setWhich('torbox')}>
                TorBox
              </button>
              <button class={which === 'realdebrid' ? 'on' : ''} onClick={() => setWhich('realdebrid')}>
                Real-Debrid
              </button>
            </div>
            <input class="b-input" type="password" placeholder={which === 'torbox' ? 'TorBox API key' : 'Real-Debrid API token'} value={key} onInput={(e) => setKey(e.currentTarget.value)} autocomplete="off" />
            <button class="b-play wide" disabled={busy || !key.trim()} onClick={save}>
              {busy ? <span class="b-spin" /> : null} Connect
            </button>
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
