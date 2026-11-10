// Hearth's screens: Home, Library, a book's page, and Settings.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { BookCover, toast } from '../src/components/common.jsx';
import { Icon } from '../src/components/icons.jsx';
import { nav } from '../src/lib/nav.js';
import { progress, bookmarks, useStore } from '../src/lib/store.js';
import { fmtDuration, fmtTime } from '../src/lib/format.js';
import * as player from '../src/lib/player.js';
import { getDetails, localSrc } from '../src/sources/index.js';
import { AbsCard, DebridCard } from '../src/screens/Settings.jsx';
import { shelf, refresh, placeOf, isEbook, otherForm, copiesOf, oneEach, hidden, prefs, hide, unhide, isHidden } from './books.js';
import { checkUpdate, VERSION } from './update.js';
import { isCloudEbook, cloudReaderBook } from '../src/lib/epub.js';
import { findMissingCovers, coverNow } from '../src/lib/meta.js';
import { look, PALETTES, rollDice } from './theme.js';

const open = (book) => nav.push('book', { book });
export function play(book, opts) {
  nav.openOverlay('player');
  player.openAndPlay(book, getDetails, opts).catch((e) => toast(e.message));
}
// An ebook: straight into the reader when its file is known (phone, or opened before);
// else ask its place for the file (Audiobookshelf, TorBox, Real-Debrid) — EPUB, else PDF.
async function read(book) {
  if (book.ebookUrl || book.ebookFile || isCloudEbook(book)) return nav.push('reader', { book });
  try {
    const d = await getDetails(book);
    const list = d?.ebooks || [];
    const file = list.find((e) => e.format === 'EPUB') || list.find((e) => e.format === 'PDF');
    if (!file) return toast(list.length ? `Only ${list[0].format} here — it can't open in the reader` : 'No ebook file found for this book');
    nav.push('reader', { book: cloudReaderBook({ ...book, ...d, uid: book.uid }, file) });
  } catch (e) {
    toast(e.message);
  }
}
const pct = (p) => Math.round(Math.min(1, Math.max(0, Number(p?.percent) || 0)) * 100);
// An ebook opened from TorBox / Real-Debrid / the server keeps its place under "<id>#ebook".
const progOf = (prog, b) => prog[b.uid] || prog[`${b.uid.replace(/#ebook$/, '')}#ebook`];

function Tile({ book, sub }) {
  const titles = useStore(prefs).titles;
  return (
    <button class="h-tile" onClick={() => open(book)}>
      <BookCover book={book} class="h-cover" />
      {titles && <b>{book.title}</b>}
      {titles && <span>{sub ?? book.author}</span>}
      <i class="h-chip">
        <Icon name={isEbook(book) ? 'book' : 'headphones'} size={11} /> {placeOf(book)}
      </i>
    </button>
  );
}

function Search({ value, onInput }) {
  return (
    <label class="h-search">
      <Icon name="search" size={17} />
      <input value={value} placeholder="Search your books" onInput={(e) => onInput(e.currentTarget.value)} />
      {value && (
        <button aria-label="Clear" onClick={() => onInput('')}>
          <Icon name="close" size={15} />
        </button>
      )}
    </label>
  );
}

const matchQ = (q) => {
  const w = q.toLowerCase().split(/\s+/).filter(Boolean);
  return (b) => w.every((x) => `${b.title} ${b.author} ${b.narrator || ''}`.toLowerCase().includes(x));
};

function Grid({ books }) {
  if (!books.length) return <p class="h-empty">Nothing here.</p>;
  return (
    <div class="h-grid">
      {books.map((b) => (
        <Tile key={b.uid} book={b} />
      ))}
    </div>
  );
}

function Welcome() {
  return (
    <div class="h-welcome">
      <Icon name="flame" size={34} />
      <h2>Your books, in one place</h2>
      <p>Connect where they live — this phone, your Audiobookshelf, TorBox or Real-Debrid — and they all show up here.</p>
      <button class="h-btn" onClick={() => nav.tab('settings')}>
        Connect your books
      </button>
    </div>
  );
}

function DiceButton() {
  return (
    <button
      class="h-icon-btn h-dice"
      aria-label="Roll a new colour theme"
      onClick={(e) => {
        const p = rollDice();
        e.currentTarget.classList.remove('roll');
        void e.currentTarget.offsetWidth;
        e.currentTarget.classList.add('roll');
        toast(`${p.name}`);
      }}
    >
      🎲
    </button>
  );
}

/** "Find missing covers": looks each one up (Audible, Apple, Goodreads, Google Books, Open Library). */
function FindCovers({ books }) {
  const [st, setSt] = useState(null);
  const missing = books.filter((b) => !coverNow(b));
  if (!missing.length && !st) return null;
  const go = async () => {
    setSt({ done: 0, total: missing.length, found: 0 });
    const r = await findMissingCovers(missing, (done, total, found) => setSt({ done, total, found })).catch(() => null);
    setSt(null);
    toast(r ? `Found ${r.found} of ${r.total} covers` : 'Couldn’t look for covers right now');
  };
  return (
    <button class="h-btn h-btn-sm h-btn2" disabled={!!st} onClick={go}>
      {st ? <span class="spinner small" /> : <Icon name="covers" size={15} />}{' '}
      {st ? `Looking… ${st.done} of ${st.total} (${st.found} found)` : `Find ${missing.length} missing cover${missing.length === 1 ? '' : 's'}`}
    </button>
  );
}

// Home: what you're listening to on top, then every book in one grid you scroll down —
// filtered by All / In progress / New / Finished / Ebooks. No sideways rows.
const HOME_FILTERS = [
  ['all', 'All'],
  ['going', 'In progress'],
  ['new', 'New'],
  ['done', 'Finished'],
  ['text', 'Ebooks'],
];
export function Home() {
  const sh = useStore(shelf);
  const prog = useStore(progress);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const hid = useStore(hidden);
  const titles = useStore(prefs).titles;
  const all = useMemo(() => oneEach(sh.books), [sh.books, hid]);
  const byUid = useMemo(() => new Map(sh.books.map((b) => [b.uid, b])), [sh.books]);
  // What you're in the middle of, newest first (only books still in your library).
  const going = useMemo(
    () =>
      Object.entries(prog)
        .filter(([uid, p]) => p && !p.finished && pct(p) > 0 && (byUid.has(uid) || byUid.has(uid.replace(/#ebook$/, ''))))
        .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
        .map(([uid]) => byUid.get(uid) || byUid.get(uid.replace(/#ebook$/, '')))
        .filter((b, i, l) => l.indexOf(b) === i && !isHidden(b, hid)),
    [prog, byUid, hid],
  );
  const now = going.find((b) => !isEbook(b)) || going[0];
  const list = useMemo(() => {
    const state = (b) => {
      const p = progOf(prog, b);
      return p?.finished ? 'done' : pct(p) > 0 ? 'going' : 'new';
    };
    let l = [...all].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    // In progress: the ones you touched most recently first.
    if (filter === 'going') l = [...going];
    else if (filter === 'text') l = l.filter(isEbook);
    else if (filter !== 'all') l = l.filter((b) => state(b) === filter);
    if (q.trim()) l = l.filter(matchQ(q));
    return l;
  }, [all, going, prog, filter, q]);

  return (
    <div class="h-home">
      <h1 class="h-title">
        Hearth
        <DiceButton />
      </h1>
      <Search value={q} onInput={setQ} />
      {!sh.books.length ? (
        <Welcome />
      ) : (
        <>
          {now && !q.trim() && (
            <button class="h-continue" onClick={() => open(now)}>
              <BookCover book={now} class="h-cover" />
              <div>
                <small class="h-kicker">{isEbook(now) ? 'Continue reading' : 'Continue listening'}</small>
                <b>{now.title}</b>
                <span>{now.author}</span>
                <div class="h-bar">
                  <i style={{ width: pct(progOf(prog, now)) + '%' }} />
                </div>
                <small>
                  {pct(progOf(prog, now))}%{now.duration > 0 ? ` · ${fmtDuration(now.duration * (1 - pct(progOf(prog, now)) / 100))} left` : ''}
                </small>
              </div>
              <span
                class="h-play-sm"
                role="button"
                aria-label={isEbook(now) ? 'Read' : 'Play'}
                onClick={(e) => {
                  e.stopPropagation();
                  isEbook(now) ? read(now) : play(now);
                }}
              >
                <Icon name={isEbook(now) ? 'book' : 'play'} size={20} />
              </span>
            </button>
          )}
          <div class="h-chips">
            {HOME_FILTERS.map(([k, label]) => (
              <button class={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
                {label}
              </button>
            ))}
          </div>
          <p class="h-count">
            {list.length} {filter === 'text' ? 'ebook' : 'book'}
            {list.length === 1 ? '' : 's'}
            {filter === 'all' && !q.trim() ? '' : ` · ${all.length} in all`}
          </p>
          <div class="h-grid h-grid3">
            {list.map((b) => {
              const p = pct(progOf(prog, b));
              return (
                <button key={b.uid} class="h-tile" onClick={() => open(b)}>
                  <BookCover book={b} class="h-cover" />
                  {p > 0 && (
                    <div class="h-bar h-tile-bar">
                      <i style={{ width: p + '%' }} />
                    </div>
                  )}
                  {titles && <b>{b.title}</b>}
                  {titles && <span>{b.author}</span>}
                </button>
              );
            })}
          </div>
          {!list.length && <p class="h-empty">Nothing here.</p>}
        </>
      )}
    </div>
  );
}

const KINDS = [
  ['all', 'All'],
  ['audio', 'Audiobooks'],
  ['text', 'Ebooks'],
];
const SORTS = [
  ['recent', 'Recent'],
  ['title', 'Title'],
  ['author', 'Author'],
];

export function Library() {
  const sh = useStore(shelf);
  const hid = useStore(hidden);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('all');
  const [place, setPlace] = useState('');
  const [sort, setSort] = useState('recent');
  const [busy, setBusy] = useState(false);
  const places = [...new Set(sh.books.map(placeOf))];
  const list = useMemo(() => {
    let l = place ? sh.books.filter((b) => placeOf(b) === place && !isHidden(b, hid)) : oneEach(sh.books);
    if (kind !== 'all') l = l.filter((b) => b.kind === kind);
    if (q.trim()) l = l.filter(matchQ(q));
    const by = { recent: (a, b) => (b.addedAt || 0) - (a.addedAt || 0), title: (a, b) => a.title.localeCompare(b.title), author: (a, b) => (a.author || '').localeCompare(b.author || '') || a.title.localeCompare(b.title) };
    return [...l].sort(by[sort]);
  }, [sh.books, q, kind, place, sort, hid]);
  const again = async () => {
    setBusy(true);
    await refresh().catch(() => {});
    setBusy(false);
  };
  return (
    <div class="h-library">
      <h1 class="h-title">
        Library
        <button class="h-icon-btn" aria-label="Refresh" onClick={again}>
          {busy ? <span class="spinner small" /> : <Icon name="replay" size={19} />}
        </button>
      </h1>
      <Search value={q} onInput={setQ} />
      <div class="h-seg">
        {KINDS.map(([k, label]) => (
          <button class={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
            {label}
          </button>
        ))}
      </div>
      <div class="h-filters">
        {places.length > 1 && (
          <>
            <button class={!place ? 'on' : ''} onClick={() => setPlace('')}>
              Everywhere
            </button>
            {places.map((p) => (
              <button class={place === p ? 'on' : ''} onClick={() => setPlace(place === p ? '' : p)}>
                {p}
              </button>
            ))}
          </>
        )}
        <select value={sort} onChange={(e) => setSort(e.currentTarget.value)} aria-label="Sort">
          {SORTS.map(([k, label]) => (
            <option value={k}>{label}</option>
          ))}
        </select>
      </div>
      <div class="h-count-row">
        <p class="h-count">
          {list.length} book{list.length === 1 ? '' : 's'}
        </p>
        <FindCovers books={oneEach(sh.books)} />
      </div>
      {sh.books.length ? <Grid books={list} /> : <Welcome />}
    </div>
  );
}

// A book's chapters (its own chapter marks, else its files in order), with where each starts.
export function chapterList(d) {
  if (d?.chaptersMeta?.length) return d.chaptersMeta.map((c, i) => ({ title: c.title || `Chapter ${i + 1}`, start: c.start, end: c.end }));
  let t = 0;
  return (d?.tracks || []).map((x, i) => {
    const c = { title: x.title || `Part ${i + 1}`, start: t, end: x.duration > 0 ? t + x.duration : null, track: i };
    if (x.duration > 0) t += x.duration;
    return c;
  });
}

export function BookPage({ book }) {
  const sh = useStore(shelf);
  const p = progOf(useStore(progress), book);
  const marks = useStore(bookmarks)[book.uid] || [];
  const [ps, setPs] = useState(player.getState());
  const [info, setInfo] = useState(null);
  const [tab, setTab] = useState('chapters');
  useEffect(() => player.subscribe(setPs), []);
  const ebook = isEbook(book);
  // The audiobook's chapters and length, asked of its place when the page opens.
  useEffect(() => {
    if (ebook) return;
    let alive = true;
    getDetails(book)
      .then((d) => alive && setInfo(d))
      .catch(() => alive && setInfo({ failed: true }));
    return () => (alive = false);
  }, [book.uid]);
  const other = otherForm(book, sh.books);
  const copies = copiesOf(book, sh.books);
  const current = ps.book?.uid === book.uid;
  const percent = pct(p);
  const chapters = chapterList(current ? { chaptersMeta: ps.book.chaptersMeta, tracks: ps.tracks } : info);
  const length = book.duration || info?.duration || chapters.reduce((m, c) => Math.max(m, c.end || 0), 0);
  const nowAt = current ? player.globalTime() : null;
  const main = () => (ebook ? read(book) : current ? (player.toggle(), nav.openOverlay('player')) : play(book));
  const mainLabel = ebook ? (percent ? `Continue reading · ${percent}%` : 'Read') : current && ps.playing ? 'Pause' : percent ? 'Resume' : 'Play';
  const fromChapter = (c) => {
    if (current) {
      if (typeof c.track === 'number' && !ps.book.chaptersMeta?.length) player.jumpTo(c.track);
      else player.seekGlobal(c.start);
      nav.openOverlay('player');
    } else play(book, typeof c.track === 'number' ? { index: c.track, time: 0 } : { globalStart: c.start });
  };
  return (
    <div class="h-book">
      <button class="h-back" onClick={() => nav.back()}>
        <Icon name="back" size={18} /> Back
      </button>
      <BookCover book={book} class="h-cover h-big" />
      <h1>{book.title}</h1>
      <p class="h-by">
        {book.author}
        {book.narrator && book.narrator !== book.author ? ` · read by ${book.narrator}` : ''}
      </p>
      <p class="h-sub">
        {[length > 0 && fmtDuration(length), !ebook && chapters.length > 1 && `${chapters.length} chapters`, ebook && (book.format || 'Ebook'), placeOf(book)].filter(Boolean).join(' · ')}
      </p>
      <button class="h-btn" onClick={main}>
        <Icon name={ebook ? 'book' : current && ps.playing ? 'pause' : 'play'} size={18} /> {mainLabel}
      </button>
      {other && (
        <button class="h-btn h-btn2" onClick={() => (isEbook(other) ? read(other) : play(other))}>
          <Icon name={isEbook(other) ? 'book' : 'headphones'} size={18} /> {isEbook(other) ? 'Read the ebook' : 'Listen to the audiobook'}
        </button>
      )}
      {percent > 0 && (
        <div class="h-book-prog">
          <div class="h-bar">
            <i style={{ width: percent + '%' }} />
          </div>
          <small>
            {percent}% {ebook ? 'read' : 'listened'}
            {!ebook && length > 0 ? ` · ${fmtDuration(length * (1 - percent / 100))} left` : ''}
          </small>
        </div>
      )}
      {copies.length > 1 && (
        <div class="h-where">
          {copies.map((c) => (
            <button onClick={() => (ebook ? read(c) : play(c))}>
              <b>{ebook ? 'Ebook' : 'Audiobook'}</b>
              <span>
                {placeOf(c)}
                {c.format ? ` · ${c.format}` : ''} ›
              </span>
            </button>
          ))}
        </div>
      )}
      {!ebook && (
        <>
          <div class="h-tabs2">
            <button class={tab === 'chapters' ? 'on' : ''} onClick={() => setTab('chapters')}>
              Chapters{chapters.length ? ` · ${chapters.length}` : ''}
            </button>
            <button class={tab === 'marks' ? 'on' : ''} onClick={() => setTab('marks')}>
              Bookmarks · {marks.length}
            </button>
          </div>
          {tab === 'chapters' ? (
            <div class="h-chlist">
              {!info && !current && <p class="h-empty">Loading chapters…</p>}
              {info?.failed && !current && <p class="h-empty">Couldn’t reach where this book lives right now.</p>}
              {chapters.map((c, i) => {
                const on = nowAt != null && nowAt >= c.start && nowAt < (c.end ?? Infinity);
                return (
                  <button class={on ? 'on' : ''} onClick={() => fromChapter(c)}>
                    <i>{on ? <Icon name="chart" size={14} /> : i + 1}</i>
                    <span>{c.title}</span>
                    <small>{c.end ? fmtTime(c.end - c.start) : ''}</small>
                  </button>
                );
              })}
            </div>
          ) : (
            <div class="h-chlist">
              {!marks.length && <p class="h-empty">No bookmarks yet — tap Bookmark in the player.</p>}
              {marks.map((m) => (
                <button
                  onClick={() => {
                    if (current) {
                      player.playBookmark(m);
                      nav.openOverlay('player');
                    } else play(book, { globalStart: Math.max(0, (m.global ?? 0) - 30) });
                  }}
                >
                  <i>
                    <Icon name="bookmark" size={14} />
                  </i>
                  <span>{m.label}</span>
                  <small>{fmtTime(m.global ?? m.time)}</small>
                </button>
              ))}
            </div>
          )}
        </>
      )}
      <button
        class="h-remove"
        onClick={() => {
          if (!confirm(`Remove “${book.title}” from Hearth?\n\nIt's only hidden here — the files stay where they are. Settings → Removed books brings it back.`)) return;
          hide(book);
          toast('Removed from Hearth');
          nav.back();
        }}
      >
        <Icon name="trash" size={15} /> Remove from Hearth
      </button>
    </div>
  );
}

function PhoneCard() {
  const cfg = useStore(localSrc.localCfg);
  const [busy, setBusy] = useState('');
  const run = (k, f) => async () => {
    setBusy(k);
    try {
      await f();
      await refresh();
    } catch (e) {
      if (!/no folder chosen|cancelled/i.test(e?.message || '')) toast(e.message);
    } finally {
      setBusy('');
    }
  };
  if (!localSrc.available) return <p class="h-note">Books on this phone: in the Android app.</p>;
  return (
    <div>
      {cfg.folders.map((f) => (
        <div class="h-set-row">
          <span>{decodeURIComponent(String(f.name || f.uri || f).split(/[/:]/).pop() || 'Folder')}</span>
          <button class="h-link" onClick={() => (localSrc.removeFolder(f.uri || f), refresh())}>
            Remove
          </button>
        </div>
      ))}
      <div class="h-actions">
        <button class="h-btn h-btn-sm" disabled={!!busy} onClick={run('add', localSrc.addFolder)}>
          {busy === 'add' ? <span class="spinner small" /> : <Icon name="plus" size={15} />} {cfg.folders.length ? 'Add folder' : 'Choose folder'}
        </button>
        <button class="h-btn h-btn-sm h-btn2" disabled={!!busy} onClick={run('files', localSrc.pickBooks)}>
          {busy === 'files' ? <span class="spinner small" /> : <Icon name="book" size={15} />} Add EPUB / PDF
        </button>
        {cfg.folders.length > 0 && (
          <button class="h-btn h-btn-sm h-btn2" disabled={!!busy} onClick={run('scan', localSrc.rescan)}>
            {busy === 'scan' ? <span class="spinner small" /> : <Icon name="replay" size={15} />} Rescan
          </button>
        )}
      </div>
    </div>
  );
}

const MODES = [
  ['system', 'Like phone'],
  ['light', 'Light'],
  ['dark', 'Dark'],
];
function ShowTitles() {
  const p = useStore(prefs);
  return (
    <section class="h-card h-switch-row">
      <div>
        <h3>Titles under covers</h3>
        <p class="h-note">Off: just the covers (they carry the title).</p>
      </div>
      <input type="checkbox" class="switch" checked={!!p.titles} onChange={(e) => prefs.set((x) => ({ ...x, titles: e.currentTarget.checked }))} />
    </section>
  );
}

function Removed() {
  const h = useStore(hidden);
  const list = Object.entries(h).sort((a, b) => b[1].at - a[1].at);
  if (!list.length) return null;
  return (
    <Card title={`Removed books · ${list.length}`} sub="Hidden from Hearth — the files are where they were.">
      {list.map(([k, b]) => (
        <div class="h-set-row">
          <span>
            {b.title}
            {b.author ? <small class="h-muted"> · {b.author}</small> : null}
          </span>
          <button class="h-link" onClick={() => unhide(k)}>
            Bring back
          </button>
        </div>
      ))}
    </Card>
  );
}

function Appearance() {
  const l = useStore(look);
  return (
    <section class="h-card">
      <h3>Colours</h3>
      <div class="h-chips">
        {MODES.map(([k, label]) => (
          <button class={l.mode === k ? 'on' : ''} onClick={() => look.set((x) => ({ ...x, mode: k }))}>
            {label}
          </button>
        ))}
      </div>
      <div class="h-swatches">
        {PALETTES.map((p) => (
          <button class={l.palette === p.id ? 'on' : ''} onClick={() => look.set((x) => ({ ...x, palette: p.id }))} aria-label={p.name}>
            <i style={{ background: `linear-gradient(135deg, ${p.light[6]} 0 50%, ${p.dark[0]} 50%)`, '--a': p.dark[6] }} />
            <span>{p.name}</span>
          </button>
        ))}
        <button onClick={() => toast(rollDice().name)} aria-label="Surprise me">
          <i class="h-dice-sw">🎲</i>
          <span>Surprise</span>
        </button>
      </div>
    </section>
  );
}

function Card({ title, sub, children }) {
  return (
    <section class="h-card">
      <h3>{title}</h3>
      {sub && <p class="h-note">{sub}</p>}
      {children}
    </section>
  );
}

export function SettingsPage() {
  const sh = useStore(shelf);
  const [upd, setUpd] = useState(null);
  const counts = {};
  for (const b of sh.books) counts[placeOf(b)] = (counts[placeOf(b)] || 0) + 1;
  const count = (p) => (counts[p] ? `${counts[p]} book${counts[p] === 1 ? '' : 's'}` : '');
  const err = (k) => sh.errors?.[k] && <p class="h-err">Couldn’t reach it last time: {sh.errors[k]}</p>;
  return (
    <div class="h-settings">
      <h1 class="h-title">Settings</h1>
      <p class="h-group">Where your books are</p>
      <Card title="This phone" sub={count('Phone') || 'Folders with audiobooks or ebooks, and single EPUB / PDF files'}>
        <PhoneCard />
      </Card>
      <Card title="Audiobookshelf" sub={count('Server') || 'Your own server'}>
        {err('abs')}
        <AbsCard />
      </Card>
      <Card title="TorBox" sub={count('TorBox') || 'What’s in your TorBox account'}>
        {err('tb')}
        <DebridCard provider="torbox" label="TorBox" keyHint="torbox.app/settings" keyUrl="https://torbox.app/settings" />
      </Card>
      <Card title="Real-Debrid" sub={count('Real-Debrid') || 'What’s in your Real-Debrid account'}>
        {err('rd')}
        <DebridCard provider="realdebrid" label="Real-Debrid" keyHint="real-debrid.com/apitoken" keyUrl="https://real-debrid.com/apitoken" />
      </Card>
      <p class="h-group">Look</p>
      <Appearance />
      <ShowTitles />
      <Removed />
      <Card title="Covers" sub="Missing covers are looked up by themselves after each refresh; a book with none anywhere gets one made from its title.">
        <div class="h-actions">
          <FindCovers books={oneEach(sh.books)} />
        </div>
      </Card>
      <p class="h-group">About</p>
      <Card title={`Hearth ${VERSION}`} sub="Your books from this phone, your server and your cloud — nothing else.">
        <div class="h-actions">
          <button class="h-btn h-btn-sm h-btn2" onClick={() => checkUpdate(true).then(setUpd)}>
            <Icon name="download" size={15} /> Check for an update
          </button>
        </div>
        {upd && <p class="h-note">{upd.newer ? `Hearth ${upd.version} is ready — opening the download…` : 'You have the latest version.'}</p>}
      </Card>
    </div>
  );
}
