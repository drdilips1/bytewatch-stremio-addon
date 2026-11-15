// "Find books in…": take a photo (a cover, a barcode, a shelf), pick a screenshot, or paste a
// link or a list — the books in it, where you have each, and one tap to listen, read or save.
import { useEffect, useRef, useState } from 'preact/hooks';
import { useStore, settings } from '../lib/store.js';
import { TopBar, Cover, toast } from '../components/common.jsx';
import { Icon } from '../components/icons.jsx';
import { nav } from '../lib/nav.js';
import * as player from '../lib/player.js';
import { getDetails } from '../sources/index.js';
import { toggleLibrary } from '../lib/store.js';
import { toggleReadLater } from '../lib/readlists.js';
import { addUpNext } from '../lib/upnext.js';
import { canSeeImages } from '../lib/ai.js';
import { shrink, booksInImage, booksInText, matchBooks, saveShelf, pending, pageInImage } from '../lib/findbooks.js';

const note = (msg) => import('../lib/report.js').then((r) => r.logError('Find books', msg)).catch(() => {});

const MODES = [
  ['cover', 'Cover'],
  ['barcode', 'Barcode'],
  ['shelf', 'Shelf'],
  ['page', 'Page'],
];

/** Find a copy (phone, Audiobookshelf, TorBox / Real-Debrid — or the best one from your sources) and play it. */
async function playIt(want, step) {
  const { playScene } = await import('../lib/voicecmd.js');
  const r = await playScene('', step, want);
  nav.openOverlay('player');
  return r;
}

async function listen(m) {
  const b = m.mine;
  if (!b) return nav.push('book', { book: m.book });
  if (b.kind === 'text') return nav.push('reader', { book: b });
  const d = await getDetails(b, { fast: true });
  nav.openOverlay('player');
  player.playBook(d, { exact: true });
}

/** Not yours: found wherever it is and played (or sent home, or its page with the ebooks). */
async function getIt(m, step) {
  const { getAndPlay } = await import('../lib/getplay.js');
  const r = await getAndPlay({ title: m.want.title || m.book.title, author: m.want.author || m.book.author || '' }, step);
  if (r.playing) return;
  if (r.none) nav.push('book', { book: m.book });
  toast(r.message);
}

/** One book found (a cover or a barcode): is this it, and where to carry on. */
function OneBook({ m, again }) {
  const [page, setPage] = useState('');
  const [pages, setPages] = useState('');
  // One book found: it plays by itself in a moment (Stop to just look).
  const [left, setLeft] = useState(() => (m.auto && settings.get().findAutoPlay !== false ? 3 : -1));
  const [status, setStatus] = useState('');
  useEffect(() => {
    if (left < 0) return;
    if (left > 0) {
      const t = setTimeout(() => setLeft(left - 1), 1000);
      return () => clearTimeout(t);
    }
    m.auto = false; // not again when coming back to this screen
    setLeft(-1);
    setStatus(m.mine ? `Opening ${m.book.title} · ${m.place}…` : `Looking for ${m.book.title}…`);
    // Yours (phone, server, TorBox / Real-Debrid): that copy plays. Else found and fetched.
    const job = m.mine ? listen(m) : getIt(m, setStatus);
    job
      .then(() => (setStatus(''), note(`auto-play “${m.book.title}”: playing (${m.mine ? m.place : 'from sources'})`)))
      .catch((e) => (setStatus(''), toast(e.message), note(`auto-play “${m.book.title}” failed (${m.mine ? m.place : 'not yours'}): ${e.message}`)));
  }, [left]);
  const stop = () => ((m.auto = false), setLeft(-1));
  const go = async () => {
    const p = Number(page);
    const n = Number(pages);
    if (!(p > 0 && n > p)) return toast('Type the page you’re on and the book’s last page number');
    if (!m.mine) return toast('You don’t have this one yet — open it to get a copy');
    try {
      if (m.mine.kind === 'text') return nav.push('reader', { book: m.mine, percent: p / n });
      const d = await getDetails(m.mine, { fast: true });
      nav.openOverlay('player');
      await player.playBook(d, { exact: true, percent: p / n });
      toast(`▶ From about page ${p}`);
    } catch (e) {
      toast(e.message);
    }
  };
  return (
    <div class="fb-one">
      {(left > 0 || status) && (
        <div class="fb-auto">
          <span class="spinner" />
          <b>{status || `Playing in ${left}…`}</b>
          {left > 0 && (
            <button class="pill small" onClick={stop}>
              Stop
            </button>
          )}
        </div>
      )}
      <small class="fb-label">Is this it?</small>
      <div class="fb-match">
        <Cover book={m.book} />
        <span>
          <b>{m.book.title}</b>
          <small>{[m.book.author, m.book.year].filter(Boolean).join(' · ')}</small>
          {m.mine ? <em class="fb-badge yours">✓ Yours · {m.place}</em> : <em class="fb-badge find">Not yours yet</em>}
        </span>
      </div>
      <div class="fb-actions">
        <button
          class="btn primary"
          disabled={!!status}
          onClick={() => {
            stop();
            if (m.mine) return listen(m).catch((e) => toast(e.message));
            setStatus(`Looking for ${m.book.title}…`);
            getIt(m, setStatus)
              .catch((e) => toast(e.message))
              .finally(() => setStatus(''));
          }}
        >
          <Icon name={m.mine?.kind === 'text' ? 'book' : 'headphones'} size={16} /> {m.mine ? (m.mine.kind === 'text' ? 'Read' : 'Listen') : 'Find & play'}
        </button>
        <button class="btn secondary" onClick={() => nav.push('book', { book: m.book })}>
          Book page
        </button>
      </div>
      {m.mine && (
        <div class="fb-page">
          <span>
            <b>I’m on page</b>
            <small>Start where your paper book is</small>
          </span>
          <input inputmode="numeric" placeholder="143" value={page} onInput={(e) => setPage(e.currentTarget.value)} />
          <small>of</small>
          <input inputmode="numeric" placeholder="320" value={pages} onInput={(e) => setPages(e.currentTarget.value)} />
          <button class="pill small on" onClick={go}>
            Go
          </button>
        </div>
      )}
      <div class="fb-quick">
        <button class="pill small" onClick={() => (toggleReadLater(m.book), toast('Read later updated'))}>
          ＋ Read later
        </button>
        <button class="pill small" onClick={again}>
          Not it? Try again
        </button>
        <button
          class="pill small"
          onClick={() =>
            import('./Discover.jsx').then((d) => {
              nav.tab('discover');
              d.openSearch(`${m.want.title} ${m.want.author || ''}`.trim());
            })
          }
        >
          Search
        </button>
      </div>
    </div>
  );
}

/** Many books (a shelf, a screenshot, a page, a list). */
function ManyBooks({ name, url, list }) {
  const [ticked, setTicked] = useState(() => new Set());
  const [onlyUnsure, setOnlyUnsure] = useState(false);
  const yoursN = list.filter((m) => m.mine).length;
  const unsure = list.filter((m) => !m.sure && !m.matching).length;
  const shown = onlyUnsure ? list.filter((m) => !m.sure) : list;
  const picked = list.filter((m) => ticked.has(m.book.uid));
  const all = (fn, msg) => (picked.forEach((m) => fn(m.book)), toast(`${msg} · ${picked.length}`));
  return (
    <div class="fb-many">
      <div class="fb-src">
        <Icon name={url ? 'link' : 'search'} size={18} />
        <span>
          <b>{name}</b>
          <small>
            {list.length} book{list.length === 1 ? '' : 's'} found{url ? ` · ${new URL(url).hostname}` : ''}
          </small>
        </span>
        <button class="pill small" onClick={() => (saveShelf(name, list.map((m) => m.book)), toast('Saved — see Library → Found'))}>
          Save as shelf
        </button>
      </div>
      <div class="fb-chips">
        <span class="fb-badge yours">{yoursN} yours</span>
        <span class="fb-badge find">{list.length - yoursN} to find</span>
        {unsure > 0 && (
          <button class={'fb-badge' + (onlyUnsure ? ' on' : '')} onClick={() => setOnlyUnsure(!onlyUnsure)}>
            {unsure} unclear ›
          </button>
        )}
      </div>
      {shown.map((m) => (
        <div class="fb-row">
          <input
            type="checkbox"
            checked={ticked.has(m.book.uid)}
            onChange={() => setTicked((t) => (t.has(m.book.uid) ? (t.delete(m.book.uid), new Set(t)) : new Set(t.add(m.book.uid))))}
          />
          <button class="fb-row-main" onClick={() => nav.push('book', { book: m.book })}>
            <Cover book={m.book} />
            <span>
              <b>{m.book.title}</b>
              <small>{m.book.author || m.want.author}</small>
              {m.matching ? <em class="fb-badge">Matching…</em> : m.mine ? <em class="fb-badge yours">✓ Yours · {m.place}</em> : m.sure ? <em class="fb-badge find">Find it</em> : <em class="fb-badge">Unclear — “{m.want.title}”</em>}
            </span>
          </button>
          <button class="pill small" onClick={() => (m.mine ? listen(m) : (toast(`Looking for ${m.book.title}…`), getIt(m, () => {}))).catch((e) => toast(e.message))}>
            {m.mine ? (m.mine.kind === 'text' ? 'Read' : 'Listen') : 'Get & play'}
          </button>
        </div>
      ))}
      {picked.length > 0 && (
        <div class="fb-bar">
          <small>{picked.length} ticked</small>
          <div>
            <button class="btn primary" onClick={() => all(toggleReadLater, 'Read later')}>
              ＋ Read later
            </button>
            <button class="btn secondary" onClick={() => all(toggleLibrary, 'Library')}>
              Library
            </button>
            <button class="btn secondary" onClick={() => all((b) => addUpNext(b), 'Up next')}>
              Up next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// What each open Find books screen found, kept while it's in the back stack: open a book,
// come back, and the list is still there (no reading the page again).
const visits = new Map();
function visitFor(key) {
  if (!visits.has(key)) {
    let v = { busy: '', result: null, started: false, run: 0 };
    const subs = new Set();
    visits.set(key, {
      get: () => v,
      set(next) {
        v = { ...v, ...(typeof next === 'function' ? next(v) : next) };
        subs.forEach((f) => f(v));
      },
      subscribe(f) {
        subs.add(f);
        return () => subs.delete(f);
      },
    });
    while (visits.size > 6) visits.delete(visits.keys().next().value);
  }
  return visits.get(key);
}

export function FindBooks({ text = '', subject = '', image = '', mode: startMode = 'cover' }) {
  const [visitKey] = useState(() => nav.state().top?.key ?? Math.random());
  const visit = visitFor(visitKey);
  const { busy, result } = useStore(visit);
  const setBusy = (b) => visit.set({ busy: b });
  const setResult = (r) => visit.set((v) => ({ result: typeof r === 'function' ? r(v.result) : r }));
  // The latest search (a cancelled one is ignored when it answers).
  const run = { get current() { return visit.get().run; }, set current(n) { visit.set({ run: n }); } };
  const [mode, setMode] = useState(startMode);
  const [paste, setPaste] = useState('');
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (!busy) return setSecs(0);
    const t0 = Date.now();
    const iv = setInterval(() => setSecs(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [!!busy]);
  const cam = useRef(null);
  const gallery = useRef(null);

  const runImage = async (src, m) => {
    if (m === 'page') return runPage(src);
    setResult(null);
    const my = ++run.current;
    const t0 = Date.now();
    setBusy(m === 'barcode' ? 'Reading the barcode…' : m === 'shelf' ? 'Reading the spines…' : m === 'shot' ? 'Finding the books in the picture…' : 'Reading the cover…');
    try {
      const data = await shrink(src);
      // Never left waiting: the picture is read within 45 s, else say so (and why, in Report a problem).
      const { books } = await Promise.race([booksInImage(data, m), new Promise((_, no) => setTimeout(() => no(new Error('Reading the picture took too long — try again, or a closer / smaller picture')), 45000))]);
      if (my !== run.current) return;
      note(`picture (${m}, ${Math.round(data.length / 1024)} KB) read in ${Math.round((Date.now() - t0) / 1000)} s — ${books.length} book(s)`);
      if (!books.length) throw new Error('No book found in that picture — try closer, or the barcode');
      const single = books.length === 1 && (m === 'cover' || m === 'barcode');
      const name = m === 'shelf' ? 'Your shelf photo' : 'Books in the picture';
      if (single) {
        setBusy('Finding it…');
        setResult({ one: { ...(await matchBooks(books))[0], auto: true } });
      } else {
        // The titles at once; each fills in as it's matched.
        setBusy('');
        setResult({ name, list: books.map(pending) });
        await matchBooks(books, (i, mm) => setResult((r) => (r?.list ? { ...r, list: r.list.map((x, k) => (k === i ? mm : x)) } : r)));
      }
    } catch (e) {
      if (my === run.current) {
        toast(e.message);
        note(`picture (${m}) failed after ${Math.round((Date.now() - t0) / 1000)} s: ${e.message}`);
      }
    }
    if (my === run.current) setBusy('');
  };
  // A page: which book and which line, then that audiobook plays from there.
  const runPage = async (src) => {
    setResult(null);
    const my = ++run.current;
    const t0 = Date.now();
    setBusy('Reading the page…');
    try {
      const data = await shrink(src, 1500);
      const cur = player.getState().book;
      const pg = await Promise.race([pageInImage(data, cur), new Promise((_, no) => setTimeout(() => no(new Error('Reading the page took too long — try again')), 45000))]);
      if (my !== run.current) return;
      const title = pg.title || cur?.title || '';
      if (!title) throw new Error("Couldn't tell which book this page is from — play the book first, then take the page again");
      note(`page read in ${Math.round((Date.now() - t0) / 1000)} s — ${title}: “${pg.quote.slice(0, 60)}…”`);
      const r = await playIt({ action: 'play_scene', title, author: pg.author || (title === cur?.title ? cur?.author : '') || '', quote: pg.quote, keywords: pg.keywords, chapter: pg.chapter, chapterTitle: pg.chapterTitle, scene: 'the page you took', anySource: true }, (t) => my === run.current && setBusy(t));
      if (my !== run.current) return;
      toast(r?.notFound ? r.scene : `▶ ${r?.book?.title || title} · from your page${r?.where ? ` (${r.where})` : ''}`);
    } catch (e) {
      if (my === run.current) {
        toast(e.message);
        note(`page failed after ${Math.round((Date.now() - t0) / 1000)} s: ${e.message}`);
      }
    }
    if (my === run.current) setBusy('');
  };
  const runText = async (t, subj = '') => {
    setResult(null);
    setBusy(/https?:\/\//.test(t) ? 'Reading the page…' : 'Reading the list…');
    const my = ++run.current;
    try {
      const { name, url, books } = await Promise.race([booksInText(t, subj), new Promise((_, no) => setTimeout(() => no(new Error('That page took too long to read — try again, or paste the list')), 45000))]);
      if (my !== run.current) return;
      if (!books.length) throw new Error('No books found there');
      setBusy('');
      setResult({ name, url, list: books.map(pending) });
      await matchBooks(books, (i, mm) => setResult((r) => (r?.list ? { ...r, list: r.list.map((x, k) => (k === i ? mm : x)) } : r)));
    } catch (e) {
      toast(e.message);
    }
    setBusy('');
  };
  useEffect(() => {
    if (visit.get().started) return; // back from a book page: keep what was found
    if (!image && !text) return;
    visit.set({ started: true });
    if (image) runImage(image, 'shot');
    else runText(text, subject);
  }, [image, text]);

  const file = (e, m) => {
    const f = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (f) runImage(f, m);
  };

  return (
    <div class="screen findbooks">
      <TopBar title="Find books" ask={false} />
      {busy ? (
        <div class="fb-busy">
          <span class="spinner" />
          <b>{busy}</b>
          {secs > 2 && <small class="muted">{secs} s</small>}
          {secs > 8 && (
            <button class="pill small" onClick={() => (run.current++, setBusy(''))}>
              Cancel
            </button>
          )}
        </div>
      ) : result?.one ? (
        <OneBook m={result.one} again={() => setResult(null)} />
      ) : result?.list ? (
        <ManyBooks name={result.name} url={result.url} list={result.list} />
      ) : (
        <div class="fb-start">
          <div class="fb-modes">
            {MODES.map(([k, label]) => (
              <button class={'pill small' + (mode === k ? ' on' : '')} onClick={() => setMode(k)}>
                {label}
              </button>
            ))}
          </div>
          <button class="fb-cam" onClick={() => cam.current?.click()}>
            <Icon name="camera" size={34} />
            <b>{mode === 'barcode' ? 'Photo of the barcode' : mode === 'shelf' ? 'Photo of a bookshelf' : mode === 'page' ? 'Photo of the page you’re on' : 'Photo of the cover'}</b>
            <small>{mode === 'barcode' ? 'Read on the phone — no AI needed' : !canSeeImages() ? 'Needs a Gemini or Claude key (Settings → AI)' : mode === 'page' ? 'The audiobook plays from that page — point at a line to start there' : 'Read by your AI service'}</small>
          </button>
          <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => file(e, mode)} />
          <button class="btn ghost-wide" onClick={() => gallery.current?.click()}>
            <Icon name="image" size={16} /> A screenshot or picture from your gallery
          </button>
          <input ref={gallery} type="file" accept="image/*" hidden onChange={(e) => file(e, mode === 'barcode' || mode === 'page' ? mode : 'shot')} />
          <div class="fb-paste">
            <textarea placeholder="Paste a link to a page with books, or a list (one book a line)" value={paste} onInput={(e) => setPaste(e.currentTarget.value)} />
            <button class="btn primary" disabled={paste.trim().length < 3} onClick={() => runText(paste)}>
              Find the books
            </button>
          </div>
          <AutoPlayToggle />
          <p class="muted small">Tip: in Chrome, Instagram or any app, tap Share → Audiohub+ on a page or a picture.</p>
        </div>
      )}
    </div>
  );
}

function AutoPlayToggle() {
  const on = useStore(settings).findAutoPlay !== false;
  return (
    <label class="fb-toggle">
      <input type="checkbox" checked={on} onChange={() => settings.set((v) => ({ ...v, findAutoPlay: !on }))} />
      <span>Play at once when it finds one book (a cover or a barcode)</span>
    </label>
  );
}
