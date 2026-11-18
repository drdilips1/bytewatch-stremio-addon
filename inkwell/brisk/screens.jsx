// Audibrisk's screens: Home (search, Continue, Offline), the book page and the settings sheet.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../src/components/icons.jsx';
import { toast } from '../src/components/common.jsx';
import { nav, useBackClose } from '../src/lib/nav.js';
import { useStore, progress } from '../src/lib/store.js';
import { debrid } from '../src/lib/store.js';
import { downloads, cancelDownload, canDownload } from '../src/lib/downloads.js';
import { fmtDuration } from '../src/lib/format.js';
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

function Header({ onSettings }) {
  return (
    <header class="b-head">
      <div class="b-mark">
        <span class="b-mark-a">A</span>
        <span class="b-word">Audibrisk</span>
      </div>
      <button class="b-icon" aria-label="Settings" onClick={onSettings}>
        <Icon name="settings" size={20} />
      </button>
    </header>
  );
}

function Row({ title, items, onOpen, small }) {
  if (!items.length) return null;
  return (
    <section class="b-sec">
      <h2>{title}</h2>
      <div class="b-shelf">
        {items.map((b) => (
          <button class={'b-tile' + (small ? ' small' : '')} onClick={() => onOpen(b)}>
            <Cover book={b} />
            {b.percent > 0 && (
              <i class="b-tile-bar">
                <b style={{ width: Math.round(b.percent * 100) + '%' }} />
              </i>
            )}
            {b.dl && b.dl.status !== 'done' && <em class="b-tile-tag">{b.dl.total ? Math.round(((b.dl.done || 0) / b.dl.total) * 100) : 0}%</em>}
            <span>{b.title}</span>
            <small>{String(b.author || '').split(',')[0]}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

export function Home() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState(false);
  const allProgress = useStore(progress);
  const dls = useStore(downloads);
  useStore(debrid);
  const timer = useRef(0);
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
  const cont = bk.continuing(allProgress);
  const off = bk.offline(dls);
  const open = (b) => nav.push('book', { book: b });
  const play = (b) =>
    bk
      .resume(b)
      .then(() => nav.openOverlay('player'))
      .catch((e) => toast(e.message));
  return (
    <div class="b-home">
      <Header onSettings={() => setSheet(true)} />
      <h1 class="b-hello">{q ? 'Search' : greeting()}</h1>
      <label class="b-search">
        <Icon name="search" size={18} />
        <input placeholder="A title, an author…" value={q} onInput={(e) => setQ(e.currentTarget.value)} enterkeyhint="search" autocomplete="off" />
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
        <>
          <Row title="Continue" items={cont} onOpen={play} />
          <Row title="On this phone" items={off} onOpen={play} small />
          {!cont.length && !off.length && bk.provider() && <p class="b-quiet">Search for any audiobook above — it plays in a moment.</p>}
        </>
      )}
      {sheet && <SettingsSheet close={() => setSheet(false)} />}
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
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
