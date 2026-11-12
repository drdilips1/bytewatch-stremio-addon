// The library: the books on this iPhone. Add a file (EPUB, PDF, text, web page) or paste text;
// tap a book to read and listen to it in the reader.
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import './library.css';
import { listBooks, putBook, deleteBook, getBook, percentOf } from './db.js';
import { importFile, fromText } from './importers.js';

const minutes = (words) => {
  const m = Math.max(1, Math.round(words / 150)); // about 150 words a minute
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

function open(id) {
  getBook(id).then((b) => b && putBook({ ...b, opened: Date.now() })).finally(() => (location.href = `reader.html?id=${encodeURIComponent(id)}`));
}

function Library() {
  const [books, setBooks] = useState(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [paste, setPaste] = useState(null);
  const [tips, setTips] = useState(false);
  const file = useRef();
  const refresh = () => listBooks().then(setBooks).catch((e) => setMsg(e.message));
  useEffect(() => void refresh(), []);

  async function add(files) {
    for (const f of files) {
      setBusy(`Opening “${f.name}”…`);
      try {
        await putBook(await importFile(f));
      } catch (e) {
        setMsg(`Couldn't add “${f.name}”: ${e.message}`);
      }
    }
    setBusy('');
    refresh();
  }

  async function savePaste() {
    try {
      await putBook(fromText(paste));
      setPaste(null);
      refresh();
    } catch (e) {
      setMsg(e.message);
    }
  }

  async function remove(b) {
    if (!confirm(`Remove “${b.title}” from the library?`)) return;
    await deleteBook(b.id);
    refresh();
  }

  return (
    <div class="lib">
      <header>
        <h1>
          Paper to Audio<span class="dot">.</span>
        </h1>
        <button class="add" onClick={() => file.current.click()}>
          ＋ Add
        </button>
        <input
          ref={file}
          type="file"
          multiple
          accept=".epub,.pdf,.txt,.md,.html,.htm,application/epub+zip,application/pdf,text/plain,text/html"
          hidden
          onChange={(e) => {
            add([...e.target.files]);
            e.target.value = '';
          }}
        />
      </header>

      <div class="actions">
        <button onClick={() => setPaste('')}>Paste text</button>
        <button onClick={() => setTips(!tips)}>Better voices</button>
      </div>

      {tips && (
        <div class="card tip">
          <b>Natural voices, free and offline</b>
          <p>
            The iPhone has very natural voices you can download once: <b>Settings → Accessibility → Spoken Content → Voices → English</b>, then pick a voice marked
            <b> Enhanced</b> or <b>Premium</b> (for example Ava, Zoe, Evan or Nathan) and download it.
          </p>
          <p>Then in a book: the voice button → choose it.</p>
        </div>
      )}

      {busy && <p class="status">{busy}</p>}
      {msg && (
        <p class="status err" onClick={() => setMsg('')}>
          {msg}
        </p>
      )}

      {paste != null && (
        <div class="card">
          <textarea placeholder="Paste or type the text to listen to" value={paste} onInput={(e) => setPaste(e.target.value)} autofocus />
          <div class="row">
            <button onClick={() => setPaste(null)}>Cancel</button>
            <button class="primary" disabled={!paste.trim()} onClick={savePaste}>
              Add to library
            </button>
          </div>
        </div>
      )}

      {books && !books.length && !busy && (
        <div class="empty">
          <p>Your library is empty.</p>
          <p>Tap ＋ Add to choose a book (EPUB), PDF, text or web page file from Files, or paste text.</p>
        </div>
      )}

      <ul class="books">
        {(books || []).map((b) => {
          const pct = percentOf(b.id);
          return (
            <li key={b.id} onClick={() => open(b.id)}>
              <div class="cover">{(b.title[0] || '?').toUpperCase()}</div>
              <div class="info">
                <b>{b.title}</b>
                {b.author && <span>{b.author}</span>}
                <span class="muted">{minutes(b.words)}</span>
                <div class="bar">
                  <i style={{ width: pct + '%' }} />
                </div>
              </div>
              <span class="pct">{pct ? pct + '%' : 'New'}</span>
              <button
                class="more"
                aria-label="Remove"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(b);
                }}
              >
                ✕
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

render(<Library />, document.getElementById('app'));
