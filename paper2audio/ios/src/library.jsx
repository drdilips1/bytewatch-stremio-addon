// The home screen: the book being listened to (Continue listening, with Play), the library, a player bar
// while the iPhone reads, and Settings (voice, speed, appearance). Add a file (EPUB, PDF, text, web page)
// or paste text; tap a book to read and listen to it in the reader.
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import './library.css';
import { listBooks, putBook, deleteBook, getBook, percentOf } from './db.js';
import { importFile, fromText } from './importers.js';
import { Speech, native, pickVoice, voiceName, rate, setRate } from './speech.js';

const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';
const SPEEDS = [0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

const minutes = (words) => {
  const m = Math.max(1, Math.round(words / 150)); // about 150 words a minute
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

function open(id, play = false) {
  getBook(id)
    .then((b) => b && putBook({ ...b, opened: Date.now() }))
    .finally(() => (location.href = `reader.html?id=${encodeURIComponent(id)}${play ? '&play=1' : ''}`));
}

// ---- appearance (the home screen; the reader has its own themes) ----
const THEME_KEY = 'p2a:iosTheme';
function applyTheme(t = localStorage.getItem(THEME_KEY) || 'system') {
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}
applyTheme();

/** What the iPhone is reading now (updates as it reads, and when the app comes back to the front). */
function useReading() {
  const [st, setSt] = useState(null);
  useEffect(() => {
    if (!native) return;
    const load = () => Speech.status().then(setSt).catch(() => {});
    load();
    const h = Speech.addListener('state', setSt);
    const vis = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', vis);
    return () => {
      h.then((x) => x.remove());
      document.removeEventListener('visibilitychange', vis);
    };
  }, []);
  return st?.active ? st : null;
}

function Cover({ title, big }) {
  return <div class={'cover' + (big ? ' big' : '')}>{(title?.[0] || '?').toUpperCase()}</div>;
}

function Continue({ book, reading }) {
  const here = reading && reading.uid === book.id;
  const pct = percentOf(book.id);
  return (
    <section class="continue" onClick={() => open(book.id)}>
      <Cover title={book.title} big />
      <div class="info">
        <span class="label">{here ? (reading.playing ? 'Listening now' : 'Paused') : 'Continue listening'}</span>
        <b>{book.title}</b>
        {book.author && <span>{book.author}</span>}
        <div class="bar">
          <i style={{ width: pct + '%' }} />
        </div>
        <span class="muted">{pct ? `${pct}% · ` : ''}{minutes(book.words)}</span>
      </div>
      <button
        class="play"
        aria-label={here && reading.playing ? 'Pause' : 'Play'}
        onClick={(e) => {
          e.stopPropagation();
          if (here) (reading.playing ? Speech.pause() : Speech.resume()).catch(() => {});
          else open(book.id, true);
        }}
      >
        {here && reading.playing ? '❚❚' : '▶'}
      </button>
    </section>
  );
}

function Player({ reading, books }) {
  if (!reading) return null;
  const b = (books || []).find((x) => x.id === reading.uid);
  return (
    <div class="player" onClick={() => b && open(b.id)}>
      <Cover title={b?.title} />
      <div class="info">
        <b>{b?.title || 'Reading'}</b>
        <span class="muted">{reading.finished ? 'Finished' : reading.playing ? 'Reading aloud' : 'Paused'}</span>
      </div>
      <button
        class="round"
        aria-label={reading.playing ? 'Pause' : 'Play'}
        onClick={(e) => {
          e.stopPropagation();
          (reading.playing ? Speech.pause() : Speech.resume()).catch(() => {});
        }}
      >
        {reading.playing ? '❚❚' : '▶'}
      </button>
      <button
        class="round ghost"
        aria-label="Stop"
        onClick={(e) => {
          e.stopPropagation();
          Speech.stop().catch(() => {});
        }}
      >
        ■
      </button>
    </div>
  );
}

function Settings({ onClose }) {
  const [speed, setSpeed] = useState(rate());
  const [voice, setVoice] = useState(voiceName());
  const [theme, setTheme] = useState(localStorage.getItem(THEME_KEY) || 'system');
  const [help, setHelp] = useState(false);
  useEffect(() => {
    // The voice sheet closes by itself after a choice: show the new name when it does.
    const t = setInterval(() => setVoice(voiceName()), 700);
    return () => clearInterval(t);
  }, []);
  return (
    <div class="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet">
        <div class="sheet-head">
          <h2>Settings</h2>
          <button onClick={onClose}>Done</button>
        </div>

        <div class="k">Voice</div>
        <button class="rowbtn" onClick={() => pickVoice()}>
          <span>Reading voice</span>
          <span class="muted">{voice || 'iPhone default'} ›</span>
        </button>
        <button class="rowbtn" onClick={() => setHelp(!help)}>
          <span>Get more natural voices</span>
          <span class="muted">{help ? '⌃' : '›'}</span>
        </button>
        {help && (
          <p class="muted small">
            On the iPhone: <b>Settings → Accessibility → Spoken Content → Voices → English</b>, then download a voice marked <b>Enhanced</b> or <b>Premium</b> (Ava,
            Zoe, Evan, Nathan…). They're free, work offline and are light on battery. Then choose it above.
          </p>
        )}

        <div class="k">Reading speed</div>
        <div class="chips">
          {SPEEDS.map((s) => (
            <button
              class={s === speed ? 'on' : ''}
              onClick={() => {
                setSpeed(s);
                setRate(s);
              }}
            >
              {s}×
            </button>
          ))}
        </div>

        <div class="k">Appearance</div>
        <div class="chips">
          {[
            ['system', 'System'],
            ['light', 'Light'],
            ['dark', 'Dark'],
          ].map(([v, l]) => (
            <button
              class={v === theme ? 'on' : ''}
              onClick={() => {
                setTheme(v);
                localStorage.setItem(THEME_KEY, v);
                applyTheme(v);
              }}
            >
              {l}
            </button>
          ))}
        </div>
        <p class="muted small">Fonts, sizes and reading colours are in each book: the T button.</p>

        <div class="k">About</div>
        <p class="muted small">
          Paper to Audio for iPhone{VERSION ? ` · ${VERSION}` : ''}. Your books stay on this iPhone; reading aloud uses the iPhone's own voices and works offline (Look up needs
          the internet). Keeps reading with the screen off; use the lock screen or headphones to pause.
        </p>
      </div>
    </div>
  );
}

function Library() {
  const [books, setBooks] = useState(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [paste, setPaste] = useState(null);
  const [settings, setSettings] = useState(false);
  const reading = useReading();
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
    if (reading?.uid === b.id) await Speech.stop().catch(() => {});
    await deleteBook(b.id);
    refresh();
  }

  // The book on the Continue card: the one being read, else the one opened last.
  const current = (books || []).find((b) => b.id === reading?.uid) || (books || []).find((b) => b.opened);
  const rest = (books || []).filter((b) => b !== current);

  return (
    <div class={'lib' + (reading ? ' with-player' : '')}>
      <header>
        <h1>
          Paper to Audio<span class="dot">.</span>
        </h1>
        <div class="head-actions">
          <button class="icon" aria-label="Settings" onClick={() => setSettings(true)}>
            ⚙
          </button>
          <button class="add" onClick={() => file.current.click()}>
            ＋ Add
          </button>
        </div>
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

      {busy && <p class="status">{busy}</p>}
      {msg && (
        <p class="status err" onClick={() => setMsg('')}>
          {msg}
        </p>
      )}

      {current && <Continue book={current} reading={reading} />}

      <div class="actions">
        <button onClick={() => file.current.click()}>Add a book or PDF</button>
        <button onClick={() => setPaste('')}>Paste text</button>
      </div>

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
          <p>
            <b>Your library is empty.</b>
          </p>
          <p>Tap ＋ Add to choose a book (EPUB), PDF, text or web page file from Files, or paste text.</p>
          <p>Tip: download a natural voice first: ⚙ Settings → Get more natural voices.</p>
        </div>
      )}

      {rest.length > 0 && <h3 class="section">Library</h3>}
      <ul class="books">
        {rest.map((b) => {
          const pct = percentOf(b.id);
          return (
            <li key={b.id} onClick={() => open(b.id)}>
              <Cover title={b.title} />
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
      {current && (
        <p class="muted small center">
          <button
            class="link"
            onClick={() => remove(current)}
          >
            Remove “{current.title}” from the library
          </button>
        </p>
      )}

      <Player reading={reading} books={books} />
      {settings && <Settings onClose={() => setSettings(false)} />}
    </div>
  );
}

render(<Library />, document.getElementById('app'));
