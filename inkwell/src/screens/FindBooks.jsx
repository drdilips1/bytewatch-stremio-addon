// "Find books in…": take a photo (a cover, a barcode, a shelf), pick a screenshot, or paste a
// link or a list — the books in it, where you have each, and one tap to listen, read or save.
import { useEffect, useRef, useState } from 'preact/hooks';
import { TopBar, Cover, toast } from '../components/common.jsx';
import { Icon } from '../components/icons.jsx';
import { nav } from '../lib/nav.js';
import * as player from '../lib/player.js';
import { getDetails } from '../sources/index.js';
import { toggleLibrary } from '../lib/store.js';
import { toggleReadLater } from '../lib/readlists.js';
import { addUpNext } from '../lib/upnext.js';
import { canSeeImages } from '../lib/ai.js';
import { shrink, booksInImage, booksInText, matchBooks, saveShelf, pending } from '../lib/findbooks.js';

const note = (msg) => import('../lib/report.js').then((r) => r.logError('Find books', msg)).catch(() => {});

const MODES = [
  ['cover', 'Cover'],
  ['barcode', 'Barcode'],
  ['shelf', 'Shelf'],
];

async function listen(m) {
  const b = m.mine;
  if (!b) return nav.push('book', { book: m.book });
  if (b.kind === 'text') return nav.push('reader', { book: b });
  const d = await getDetails(b, { fast: true });
  nav.openOverlay('player');
  player.playBook(d, { exact: true });
}

/** One book found (a cover or a barcode): is this it, and where to carry on. */
function OneBook({ m, again }) {
  const [page, setPage] = useState('');
  const [pages, setPages] = useState('');
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
        <button class="btn primary" onClick={() => listen(m).catch((e) => toast(e.message))}>
          <Icon name={m.mine?.kind === 'text' ? 'book' : 'headphones'} size={16} /> {m.mine ? (m.mine.kind === 'text' ? 'Read' : 'Listen') : 'Where to get it'}
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
        <button class="pill small" onClick={() => (saveShelf(name, list.map((m) => m.book)), toast('Saved as a shelf in Library'))}>
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
          <button class="pill small" onClick={() => listen(m).catch((e) => toast(e.message))}>
            {m.mine ? (m.mine.kind === 'text' ? 'Read' : 'Listen') : 'Get'}
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

export function FindBooks({ text = '', subject = '', image = '', mode: startMode = 'cover' }) {
  const [mode, setMode] = useState(startMode);
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null); // { one } | { name, url, list }
  const [paste, setPaste] = useState('');
  const [secs, setSecs] = useState(0);
  const run = useRef(0); // the latest search (a cancelled one is ignored when it answers)
  useEffect(() => {
    if (!busy) return setSecs(0);
    const t0 = Date.now();
    const iv = setInterval(() => setSecs(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [!!busy]);
  const cam = useRef(null);
  const gallery = useRef(null);

  const runImage = async (src, m) => {
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
        setResult({ one: (await matchBooks(books))[0] });
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
    if (image) runImage(image, 'shot');
    else if (text) runText(text, subject);
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
            <b>{mode === 'barcode' ? 'Photo of the barcode' : mode === 'shelf' ? 'Photo of a bookshelf' : 'Photo of the cover'}</b>
            <small>{mode === 'barcode' ? 'Read on the phone — no AI needed' : canSeeImages() ? 'Read by your AI service' : 'Needs a Gemini or Claude key (Settings → AI)'}</small>
          </button>
          <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => file(e, mode)} />
          <button class="btn ghost-wide" onClick={() => gallery.current?.click()}>
            <Icon name="image" size={16} /> A screenshot or picture from your gallery
          </button>
          <input ref={gallery} type="file" accept="image/*" hidden onChange={(e) => file(e, mode === 'barcode' ? 'barcode' : 'shot')} />
          <div class="fb-paste">
            <textarea placeholder="Paste a link to a page with books, or a list (one book a line)" value={paste} onInput={(e) => setPaste(e.currentTarget.value)} />
            <button class="btn primary" disabled={paste.trim().length < 3} onClick={() => runText(paste)}>
              Find the books
            </button>
          </div>
          <p class="muted small">Tip: in Chrome, Instagram or any app, tap Share → Audiohub+ on a page or a picture.</p>
        </div>
      )}
    </div>
  );
}
