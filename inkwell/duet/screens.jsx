// Duet's screens: Home, Library, a book's page, and Settings.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { BookCover, toast } from '../src/components/common.jsx';
import { Icon } from '../src/components/icons.jsx';
import { nav, useBackClose } from '../src/lib/nav.js';
import { progress, bookmarks, useStore, persisted } from '../src/lib/store.js';
import { fmtDuration, fmtTime } from '../src/lib/format.js';
import * as player from '../src/lib/player.js';
import { getDetails, localSrc } from '../src/sources/index.js';
import { AbsCard } from '../src/screens/Settings.jsx';
import { useRatings } from '../src/lib/ratings.js';
import { addUpNext, upNext } from '../src/lib/upnext.js';
import { summarize } from '../src/lib/store.js';
import { OwnCoverButton } from '../src/components/fix-details.jsx';
import { SpeechModel } from '../src/components/follow-audio.jsx';
import { fillAuthors, shelf, refresh, placeOf, isEbook, otherForm, copiesOf, oneEach, hidden, prefs, hide, unhide, isHidden, authorsOf, seriesGroups } from './books.js';
import { downloads, canDownload, downloadBook, removeDownload, cancelDownload, fmtBytes } from '../src/lib/downloads.js';
import { abs } from '../src/lib/store.js';
import { checkUpdate, VERSION } from './update.js';
import { isCloudEbook, cloudReaderBook } from '../src/lib/epub.js';
import { findMissingCovers, coverNow, searchCovers, searchTitle, setFix, fixFor } from '../src/lib/meta.js';
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

// Press and hold a cover: its menu (details, play next, Up next, cover, finished, remove…).
// "Select more" there starts choosing several — tap more to add or drop them.
function useSelect() {
  const [sel, setSel] = useState(() => new Map()); // uid -> book
  const [menu, setMenu] = useState(null); // the book whose menu is open
  const press = useRef({ t: 0, x: 0, y: 0, fired: false });
  const active = sel.size > 0;
  const toggle = (b) =>
    setSel((m) => {
      const n = new Map(m);
      n.has(b.uid) ? n.delete(b.uid) : n.set(b.uid, b);
      return n;
    });
  const clear = () => setSel(new Map());
  useBackClose(active, clear);
  const cancel = () => clearTimeout(press.current.t);
  const bind = (b) => ({
    class: 'h-tile' + (sel.has(b.uid) ? ' picked' : '') + (active ? ' picking' : ''),
    onContextMenu: (e) => e.preventDefault(),
    onPointerDown: (e) => {
      press.current = { ...press.current, x: e.clientX, y: e.clientY, fired: false };
      cancel();
      press.current.t = setTimeout(() => {
        press.current.fired = true;
        navigator.vibrate?.(12);
        active ? toggle(b) : setMenu(b);
      }, 480);
    },
    onPointerMove: (e) => Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 10 && cancel(),
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onClick: () => {
      if (press.current.fired) return (press.current.fired = false);
      active ? toggle(b) : open(b);
    },
  });
  return { sel, active, clear, bind, toggle, menu, setMenu };
}

function SelectBar({ s }) {
  const menu = s.menu && <BookMenu book={s.menu} close={() => s.setMenu(null)} selectMore={() => (s.toggle(s.menu), s.setMenu(null))} />;
  if (!s.active) return menu || null;
  const remove = () => {
    const n = s.sel.size;
    if (!confirm(`Remove ${n} book${n === 1 ? '' : 's'} from Duet?\n\nOnly hidden here — the files stay where they are. Settings → Removed books brings them back.`)) return;
    for (const b of s.sel.values()) hide(b);
    s.clear();
    toast(`Removed ${n} book${n === 1 ? '' : 's'}`);
  };
  const queue = () => {
    let n = 0;
    for (const b of s.sel.values()) if (!isEbook(b) && addUpNext(b)) n++;
    s.clear();
    toast(n ? `${n} added to Up next` : 'Already in Up next');
  };
  return (
    <div class="h-selbar">
      <button class="h-icon-btn" aria-label="Cancel" onClick={s.clear}>
        <Icon name="close" size={18} />
      </button>
      <b>{s.sel.size} selected</b>
      <button class="h-btn h-btn-sm h-btn2" onClick={queue}>
        <Icon name="list" size={15} /> Up next
      </button>
      <button class="h-btn h-btn-sm h-danger" onClick={remove}>
        <Icon name="trash" size={15} /> Remove
      </button>
    </div>
  );
}

const fmtK = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? Math.round(n / 1000) + 'k' : String(n));
function Stars({ book }) {
  const { goodreads, audible } = useRatings(book);
  const r = goodreads || audible;
  if (!r) return null;
  return (
    <div class="d-stars">
      ★ {r.rating.toFixed(goodreads ? 2 : 1)}
      {r.count > 0 ? ` · ${fmtK(r.count)} ratings` : ''} · {goodreads ? 'Goodreads' : 'Audible'}
    </div>
  );
}

function setDone(book, finished) {
  progress.set((all) => ({
    ...all,
    [book.uid]: {
      ...(all[book.uid] || { book: summarize(book), kind: book.kind }),
      ...(finished ? { finished: true, percent: 1 } : { finished: false, percent: 0, track: 0, time: 0 }),
      hidden: false,
      updatedAt: Date.now(),
    },
  }));
}
function playNext(book) {
  addUpNext(book);
  upNext.set((l) => {
    const i = l.findIndex((x) => x.id === book.uid);
    return i <= 0 ? l : [l[i], ...l.slice(0, i), ...l.slice(i + 1)];
  });
}

// Sheets open over the whole app (the page is a layer under the tabs and the player).
const Layer = ({ children }) => createPortal(children, document.body);

/** Press and hold a book: everything you can do with it, in one sheet. */
function BookMenu({ book, close, selectMore }) {
  const prog = useStore(progress);
  const sh = useStore(shelf);
  const [covers, setCovers] = useState(false);
  useBackClose(true, close);
  const p = progOf(prog, book);
  const done = !!p?.finished;
  const percent = pct(p);
  const ebook = isEbook(book);
  const other = otherForm(book, sh.books);
  const playing = player.getState().book?.uid === book.uid;
  const act = (f) => () => (close(), f());
  if (covers) return <CoverPicker book={book} close={close} />;
  return (
    <Layer>
      <div class="h-sheet-bg" onClick={close}>
        <div class="h-sheet" onClick={(e) => e.stopPropagation()}>
          <div class="d-menu-head">
            <BookCover book={book} class="h-cover" />
            <div>
              <b>{book.title}</b>
              <span>{[book.author, percent ? `${percent}%` : done ? 'Finished' : '', placeOf(book)].filter(Boolean).join(' · ')}</span>
              <Stars book={book} />
            </div>
          </div>
          <div class="d-menu">
            <button onClick={act(() => (ebook ? read(book) : play(book)))}>
              <Icon name={ebook ? 'book' : 'play'} size={19} /> {ebook ? (percent ? 'Continue reading' : 'Read') : percent ? 'Resume' : 'Play'}
            </button>
            {other && (
              <button onClick={act(() => (isEbook(other) ? read(other) : play(other)))}>
                <Icon name={isEbook(other) ? 'book' : 'headphones'} size={19} /> {isEbook(other) ? 'Read the ebook' : 'Listen to the audiobook'}
              </button>
            )}
            {!ebook && !playing && (
              <button onClick={act(() => (playNext(book), toast(`Plays next: ${book.title}`)))}>
                <Icon name="next" size={19} /> Play next
              </button>
            )}
            {!ebook && !playing && (
              <button onClick={act(() => toast(addUpNext(book) ? `Added to Up next` : 'Already in Up next'))}>
                <Icon name="list" size={19} /> Add to Up next
              </button>
            )}
            <button onClick={act(() => open(book))}>
              <Icon name="info" size={19} /> Book details
            </button>
            <button onClick={() => setCovers(true)}>
              <Icon name="covers" size={19} /> Change cover
            </button>
            <button onClick={act(() => (setDone(book, !done), toast(done ? 'Marked as not finished' : 'Marked as finished')))}>
              <Icon name="check" size={19} /> {done ? 'Mark as not finished' : 'Mark as finished'}
            </button>
            {percent > 0 && !done && (
              <button onClick={act(() => confirm(`Start “${book.title}” from the beginning?`) && (setDone(book, false), toast('Progress reset')))}>
                <Icon name="replay" size={19} /> Start over
              </button>
            )}
            <button onClick={selectMore}>
              <Icon name="grid" size={19} /> Select more books
            </button>
            <button
              class="danger"
              onClick={act(() => {
                if (!confirm(`Remove “${book.title}” from Duet?\n\nOnly hidden here — the files stay where they are. Settings → Removed books brings it back.`)) return;
                hide(book);
                toast('Removed');
              })}
            >
              <Icon name="trash" size={19} /> Remove from Duet
            </button>
          </div>
        </div>
      </div>
    </Layer>
  );
}

/** Change a book's cover: covers found for it in several places — tap one — or your own picture. */
function CoverPicker({ book, close }) {
  const [q, setQ] = useState(() => [searchTitle(book.title), String(book.author || '').split(',')[0]].filter(Boolean).join(' '));
  const [list, setList] = useState(null);
  useBackClose(true, close);
  const go = async (term = q) => {
    setList(null);
    setList(await searchCovers(term).catch(() => []));
  };
  useEffect(() => void go(), []);
  const pick = (m) => {
    setFix(book.uid, { ...(fixFor(book.uid) || {}), cover: m.cover, ...(book.author ? {} : { author: m.author }) });
    if (book.source === 'loc') localSrc.setCover?.(book.uid, m.cover);
    fillAuthors();
    toast('Cover changed');
    close();
  };
  return (
    <Layer>
      <div class="h-sheet-bg" onClick={close}>
        <div class="h-sheet" onClick={(e) => e.stopPropagation()}>
          <h3>Choose a cover</h3>
          <form class="d-cover-q" onSubmit={(e) => (e.preventDefault(), go())}>
            <input value={q} onInput={(e) => setQ(e.currentTarget.value)} placeholder="Title and author" />
            <button class="h-btn h-btn-sm" type="submit">
              <Icon name="search" size={15} />
            </button>
          </form>
          {!list && (
            <p class="h-empty">
              <span class="spinner small" /> Looking in Audible, Apple, Goodreads, Google Books, Open Library…
            </p>
          )}
          {list && !list.length && <p class="h-empty">Nothing found — try fewer words, or just the title.</p>}
          {list?.length > 0 && (
            <div class="d-covers">
              {list.map((m) => (
                <button onClick={() => pick(m)}>
                  <img src={m.cover} loading="lazy" alt="" />
                  {m.from}
                </button>
              ))}
            </div>
          )}
          <div class="h-actions">
            <OwnCoverButton book={book} onDone={close} label="Use a picture from this phone" />
          </div>
        </div>
      </div>
    </Layer>
  );
}

function Tile({ book, sub, bind }) {
  const titles = useStore(prefs).titles;
  return (
    <button {...(bind ? bind(book) : { class: 'h-tile', onClick: () => open(book) })}>
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

function Grid({ books, bind }) {
  if (!books.length) return <p class="h-empty">Nothing here.</p>;
  return (
    <div class="h-grid">
      {books.map((b) => (
        <Tile key={b.uid} book={b} bind={bind} />
      ))}
    </div>
  );
}

// The first open: Duet introduces itself — sound bars breathing, lines of text filling in as if
// read — and asks for one thing: where your books are.
export const welcomeDone = persisted('duetWelcomed', false);
export function Welcome() {
  const [busy, setBusy] = useState(false);
  const phone = async () => {
    setBusy(true);
    try {
      await localSrc.addFolder();
      await refresh();
      welcomeDone.set(true);
    } catch (e) {
      if (!/no folder chosen|cancelled/i.test(e?.message || '')) toast(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="d-welcome">
      <div class="d-glow" aria-hidden="true" />
      <div class="d-logo" aria-hidden="true">
        <div class="d-wave">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <i style={{ animationDelay: `${-(i * 0.37) % 1.6}s` }} />
          ))}
        </div>
        <div class="d-lines">
          <b style={{ width: '190px' }} />
          <b style={{ width: '150px' }} />
          <b style={{ width: '170px' }} />
        </div>
      </div>
      <h1>Duet</h1>
      <p>
        Your audiobooks and ebooks, together.
        <br />
        Listen, read along, never lose your place.
      </p>
      <div class="d-cta">
        <button class="d-btn-grad" disabled={busy} onClick={phone}>
          {busy ? <span class="spinner small" /> : null} Add books from this phone
        </button>
        <button class="d-btn-glass" onClick={() => (welcomeDone.set(true), nav.tab('settings'))}>
          Connect Audiobookshelf
        </button>
        <button class="d-skip" onClick={() => welcomeDone.set(true)}>
          Look around first
        </button>
        <small>Your files stay yours. No account needed.</small>
      </div>
    </div>
  );
}

function Empty() {
  return (
    <div class="h-welcome">
      <Icon name="headphones" size={34} />
      <h2>Bring your books in</h2>
      <p>Add a folder from this phone, or connect your Audiobookshelf server — they all show up here, together.</p>
      <button class="h-btn d-btn-grad" onClick={() => nav.tab('settings')}>
        Add books
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

/** Up next on Home, when something is lined up: plays after the book you're on ends. */
function UpNextRow() {
  const list = useStore(upNext);
  if (!list.length) return null;
  return (
    <div class="d-upnext">
      <small class="h-kicker">Up next</small>
      {list.map((x, i) => (
        <div class="d-upnext-row">
          <BookCover book={x.book} class="h-cover" />
          <span>
            <b>{x.book.title}</b>
            <em>{i === 0 ? 'Plays next' : `${i + 1} in line`}</em>
          </span>
          <button class="h-icon-btn" aria-label="Take off Up next" onClick={() => upNext.set((l) => l.filter((y) => y.id !== x.id))}>
            <Icon name="close" size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}

const HOME_SORTS = [
  ['played', 'Recently played'],
  ['title', 'Title'],
  ['author', 'Author'],
  ['added', 'Recently added'],
  ['length', 'Length'],
];
function SortMenu() {
  const p = useStore(prefs);
  const [open, setOpen] = useState(false);
  useBackClose(open, () => setOpen(false));
  const set = (patch) => (prefs.set((x) => ({ ...x, ...patch })), setOpen(false));
  return (
    <div class="h-sort">
      <button class="h-icon-btn" aria-label="Sort and view" onClick={() => setOpen(!open)}>
        <Icon name="list" size={18} />
      </button>
      {open && (
        <>
          <div class="h-menu-bg" onClick={() => setOpen(false)} />
          <div class="h-menu">
            {HOME_SORTS.map(([k, label]) => (
              <button onClick={() => set({ sort: k })}>
                {label}
                {p.sort === k && <Icon name="check" size={16} />}
              </button>
            ))}
            <hr />
            <button onClick={() => set({ onlySaved: !p.onlySaved })}>
              Saved on phone only
              {p.onlySaved && <Icon name="check" size={16} />}
            </button>
            <hr />
            {[
              ['grid', 'Grid'],
              ['list', 'List'],
            ].map(([k, label]) => (
              <button onClick={() => set({ view: k })}>
                {label}
                {(p.view || 'grid') === k && <Icon name="check" size={16} />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
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
  const [view, setView] = useState('books');
  const hid = useStore(hidden);
  const pr = useStore(prefs);
  const dls = useStore(downloads);
  const titles = pr.titles;
  const pick = useSelect();
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
    [prog, byUid, hid]
  );
  const now = going.find((b) => !isEbook(b)) || going[0];
  const list = useMemo(() => {
    const state = (b) => {
      const p = progOf(prog, b);
      return p?.finished ? 'done' : pct(p) > 0 ? 'going' : 'new';
    };
    const played = (b) => progOf(prog, b)?.updatedAt || 0;
    const by = {
      played: (a, b) => played(b) - played(a) || (b.addedAt || 0) - (a.addedAt || 0),
      title: (a, b) => a.title.localeCompare(b.title),
      author: (a, b) => (a.author || '').localeCompare(b.author || '') || a.title.localeCompare(b.title),
      added: (a, b) => (b.addedAt || 0) - (a.addedAt || 0),
      length: (a, b) => (b.duration || 0) - (a.duration || 0),
    };
    let l = [...all].sort(by[pr.sort] || by.played);
    // In progress: the ones you touched most recently first.
    if (filter === 'going') l = [...going];
    else if (filter === 'text') l = l.filter(isEbook);
    // An ebook whose audiobook is here too folds into it (that pair is the read-along).
    if (filter !== 'text') l = l.filter((b) => !isEbook(b) || !otherForm(b, sh.books));
    else if (filter !== 'all') l = l.filter((b) => state(b) === filter);
    if (pr.onlySaved) l = l.filter((b) => dls[b.uid]?.status === 'done' || b.source === 'loc');
    if (q.trim()) l = l.filter(matchQ(q));
    return l;
  }, [all, going, prog, filter, q, pr.sort, pr.onlySaved, dls, sh.books]);

  return (
    <div class="h-home">
      <h1 class="h-title">
        Duet
        <DiceButton />
      </h1>
      <div class="h-tabs2 h-lib-tabs">
        {[
          ['books', 'Books'],
          ['authors', 'Authors'],
          ['series', 'Series'],
        ].map(([k, label]) => (
          <button class={view === k ? 'on' : ''} onClick={() => setView(k)}>
            {label}
          </button>
        ))}
      </div>
      <Search value={q} onInput={setQ} />
      {!sh.books.length ? (
        <Empty />
      ) : view !== 'books' ? (
        <Groups kind={view} books={all} q={q} />
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
                  {!isEbook(now) && otherForm(now, sh.books) && <em class="d-ra-tag">✦ Read-along</em>}
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
          <UpNextRow />
          <div class="h-chips">
            {HOME_FILTERS.map(([k, label]) => (
              <button class={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
                {label}
              </button>
            ))}
          </div>
          <div class="h-count-row h-home-count">
            <p class="h-count">
              {list.length} {filter === 'text' ? 'ebook' : 'book'}
              {list.length === 1 ? '' : 's'}
              {filter === 'all' && !q.trim() ? '' : ` · ${all.length} in all`}
            </p>
            <SortMenu />
          </div>
          <div class={pr.view === 'list' ? 'h-listview' : 'h-grid h-grid3'}>
            {list.map((b) => {
              const p = pct(progOf(prog, b));
              return (
                <button key={b.uid} {...pick.bind(b)}>
                  <BookCover book={b} class="h-cover" />
                  <span class="d-badge">{dls[b.uid]?.status === 'done' ? 'SAVED' : placeOf(b).toUpperCase()}</span>
                  {!isEbook(b) && otherForm(b, sh.books) && (
                    <span class="d-sync" title="Read-along ready">
                      ✦
                    </span>
                  )}
                  {p > 0 && (
                    <div class="h-bar h-tile-bar">
                      <i style={{ width: p + '%' }} />
                    </div>
                  )}
                  {(titles || pr.view === 'list') && <b>{b.title}</b>}
                  {(titles || pr.view === 'list') && (
                    <span>
                      {b.author}
                      {pr.view === 'list' && b.duration > 0 ? ` · ${fmtDuration(b.duration)}` : ''}
                      {pr.view === 'list' && p > 0 ? ` · ${p}%` : ''}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {!list.length && <p class="h-empty">Nothing here.</p>}
          <SelectBar s={pick} />
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

function Groups({ kind, books, q }) {
  const groups = (kind === 'authors' ? authorsOf(books) : seriesGroups(books)).filter((g) => !q.trim() || g.name.toLowerCase().includes(q.trim().toLowerCase()));
  if (!groups.length) return <p class="h-empty">{kind === 'series' ? 'No series found yet — series come from your server and the books’ details.' : 'Nothing here.'}</p>;
  return (
    <div class="h-groups">
      <p class="h-count">
        {groups.length} {kind === 'authors' ? 'author' : 'series'}
        {groups.length === 1 || kind === 'series' ? '' : 's'}
      </p>
      {groups.map((g) => (
        <button
          class="h-group-row"
          onClick={() => nav.push('group', { title: g.name, sub: `${g.books.length} book${g.books.length === 1 ? '' : 's'}${kind === 'series' ? ' · in order' : ''}`, books: g.books })}
        >
          <div class="h-stack">
            {g.books.slice(0, 3).map((b) => (
              <BookCover book={b} class="h-cover" />
            ))}
          </div>
          <div>
            <b>{g.name}</b>
            <span>
              {g.books.length} book{g.books.length === 1 ? '' : 's'}
            </span>
          </div>
          <Icon name="next" size={16} />
        </button>
      ))}
    </div>
  );
}

/** Read-along: the books you have both ways — audiobook and ebook — ready to listen with the text. */
export function ReadAlongPage() {
  const sh = useStore(shelf);
  const hid = useStore(hidden);
  const pairs = useMemo(() => {
    const books = oneEach(sh.books).filter((b) => !isEbook(b));
    return books.map((b) => ({ audio: b, ebook: otherForm(b, sh.books) })).filter((x) => x.ebook);
  }, [sh.books, hid]);
  return (
    <div class="d-readalong">
      <h1 class="h-title">Read-along</h1>
      <div class="d-ra-hero">
        <div class="d-ra-icon">✦</div>
        <div>
          <b>Listen and read at once</b>
          <span>When you have a book as both audiobook and ebook, Duet lights up the sentence being read — and you can switch between reading and listening at the same spot.</span>
        </div>
      </div>
      <p class="h-count">
        {pairs.length} book{pairs.length === 1 ? '' : 's'} ready for read-along
      </p>
      {pairs.length ? (
        <div class="h-grid h-grid3">
          {pairs.map(({ audio }) => (
            <button class="h-tile" onClick={() => open(audio)}>
              <BookCover book={audio} class="h-cover" />
              <span class="d-sync">✦</span>
              <b>{audio.title}</b>
              <span>{audio.author}</span>
            </button>
          ))}
        </div>
      ) : (
        <p class="h-empty">None yet — add the EPUB of an audiobook you have (same title), on this phone or your server, and it shows up here.</p>
      )}
    </div>
  );
}

export function Library() {
  const sh = useStore(shelf);
  const hid = useStore(hidden);
  const pick = useSelect();
  const [view, setView] = useState('books');
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
    const by = {
      recent: (a, b) => (b.addedAt || 0) - (a.addedAt || 0),
      title: (a, b) => a.title.localeCompare(b.title),
      author: (a, b) => (a.author || '').localeCompare(b.author || '') || a.title.localeCompare(b.title),
    };
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
      <div class="h-tabs2 h-lib-tabs">
        {[
          ['books', 'Books'],
          ['authors', 'Authors'],
          ['series', 'Series'],
        ].map(([k, label]) => (
          <button class={view === k ? 'on' : ''} onClick={() => setView(k)}>
            {label}
          </button>
        ))}
      </div>
      <Search value={q} onInput={setQ} />
      {view !== 'books' ? (
        <Groups kind={view} books={oneEach(sh.books)} q={q} />
      ) : (
        <>
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
          {sh.books.length ? <Grid books={list} bind={pick.bind} /> : <Empty />}
          <SelectBar s={pick} />
        </>
      )}
    </div>
  );
}

/** Save an audiobook on the phone (plays offline — in the car, on a flight, with the server off). */
function SaveToPhone({ book, info }) {
  const d = useStore(downloads)[book.uid];
  const [busy, setBusy] = useState(false);
  if (!canDownload || isEbook(book) || book.source === 'loc') return null;
  if (d?.status === 'done')
    return (
      <div class="h-saved">
        <Icon name="check" size={15} /> Saved on this phone{d.bytes ? ` · ${fmtBytes(d.bytes)}` : ''}
        <button class="h-link" onClick={() => confirm('Remove the saved copy from this phone? The book stays in your library.') && removeDownload(book.uid)}>
          Remove
        </button>
      </div>
    );
  if (d?.status === 'downloading')
    return (
      <div class="h-saved">
        <span class="spinner small" /> Saving… {d.done || 0} of {d.total || '?'} part{d.total === 1 ? '' : 's'}
        <button class="h-link" onClick={() => cancelDownload(book.uid)}>
          Stop
        </button>
      </div>
    );
  const go = async () => {
    setBusy(true);
    try {
      const details = info?.tracks?.length ? info : await getDetails(book);
      downloadBook(details).catch((e) => toast(e.message));
      toast('Saving to this phone — you can leave this page');
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button class="h-btn h-btn2" disabled={busy} onClick={go}>
      {busy ? <span class="spinner small" /> : <Icon name="download" size={18} />} {d?.status === 'error' ? 'Try saving again' : 'Save to phone'}
    </button>
  );
}

/** A group of books (an author, a series): one grid. */
export function GroupPage({ title, sub, books }) {
  const pick = useSelect();
  return (
    <div class="h-group-page">
      <button class="h-back" onClick={() => nav.back()}>
        <Icon name="back" size={18} /> Back
      </button>
      <h1 class="h-title">{title}</h1>
      {sub && <p class="h-count">{sub}</p>}
      <Grid books={books} bind={pick.bind} />
      <SelectBar s={pick} />
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
  const [covers, setCovers] = useState(false);
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
      <Stars book={book} />
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
      <SaveToPhone book={book} info={info} />
      <button class="h-link d-cover-link" onClick={() => setCovers(true)}>
        <Icon name="covers" size={14} /> Change cover
      </button>
      {covers && <CoverPicker book={book} close={() => setCovers(false)} />}
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
          <span>
            {decodeURIComponent(
              String(f.name || f.uri || f)
                .split(/[/:]/)
                .pop() || 'Folder'
            )}
          </span>
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
// Your connections in one code, to set up another phone (your wife's) without typing keys.
// It holds your sign-ins: send it only to someone you'd give them to.
const CODE = 'DUET1:';
function ShareSetup() {
  const [paste, setPaste] = useState(null);
  const make = () => {
    const a = abs.get();
    const data = { abs: { server: a.server, altServer: a.altServer, token: a.token, refreshToken: a.refreshToken, username: a.username, libraryId: a.libraryId, ebookLibraryId: a.ebookLibraryId } };
    return CODE + btoa(unescape(encodeURIComponent(JSON.stringify(data))));
  };
  const share = async () => {
    const code = make();
    const text = `Duet setup (Settings → Share setup → Paste a setup code):\n${code}`;
    try {
      if (navigator.share) await navigator.share({ text });
      else (await navigator.clipboard.writeText(code), toast('Setup code copied'));
    } catch {}
  };
  const apply = async () => {
    try {
      const raw = String(paste || '')
        .trim()
        .split(/\s+/)
        .find((w) => w.startsWith(CODE));
      if (!raw) throw new Error('No Duet setup code found in what you pasted');
      const data = JSON.parse(decodeURIComponent(escape(atob(raw.slice(CODE.length)))));
      if (data.abs?.server) abs.set((x) => ({ ...x, ...data.abs }));
      setPaste(null);
      toast('Set up — loading your books');
      await refresh();
    } catch (e) {
      toast(e.message || 'That code didn’t work');
    }
  };
  const has = !!abs.get().token;
  return (
    <Card title="Share setup" sub="Set up another phone without typing your server details. The code holds your sign-ins — send it only to someone you'd give them to.">
      <div class="h-actions">
        {has && (
          <button class="h-btn h-btn-sm" onClick={share}>
            <Icon name="upload" size={15} /> Share my setup
          </button>
        )}
        <button class="h-btn h-btn-sm h-btn2" onClick={() => setPaste(paste == null ? '' : null)}>
          <Icon name="download" size={15} /> Paste a setup code
        </button>
      </div>
      {paste != null && (
        <div class="h-paste">
          <textarea rows={3} value={paste} placeholder="Paste the message or code here" onInput={(e) => setPaste(e.currentTarget.value)} />
          <button class="h-btn h-btn-sm" disabled={!paste.trim()} onClick={apply}>
            Use this setup
          </button>
        </div>
      )}
    </Card>
  );
}

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
    <Card title={`Removed books · ${list.length}`} sub="Hidden from Duet — the files are where they were.">
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
        <AbsCard upload={false} />
      </Card>
      <ShareSetup />
      <p class="h-group">Read-along</p>
      <Card title="Speech model" sub="Read-along follows the narrator by listening on this phone — download the model once (Wi-Fi recommended); it works offline after that.">
        <SpeechModel />
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
      <Card title={`Duet ${VERSION}`} sub="Your audiobooks and ebooks — on this phone and your own server. Nothing leaves your phone except to your server.">
        <div class="h-actions">
          <button class="h-btn h-btn-sm h-btn2" onClick={() => checkUpdate(true).then(setUpd)}>
            <Icon name="download" size={15} /> Check for an update
          </button>
        </div>
        {upd && <p class="h-note">{upd.newer ? `Duet ${upd.version} is ready — opening the download…` : 'You have the latest version.'}</p>}
      </Card>
    </div>
  );
}
