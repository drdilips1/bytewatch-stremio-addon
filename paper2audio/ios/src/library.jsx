// The home screen: the book being listened to (Continue listening, with Play), the library, a player bar
// while the iPhone reads, and Settings (voice, speed, appearance). Add a file (EPUB, PDF, text, web page)
// or paste text; tap a book to read and listen to it in the reader.
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import './library.css';
import { listBooks, putBook, deleteBook, getBook, percentOf } from './db.js';
import { importFile, fromText, fromWebPage, fromPhotos, fileFromBase64 } from './importers.js';
import {
  Speech, native, pickVoice, voiceName, rate, setRate, packs, watchDownloads, downloadPack,
  playBook, positionOf, chaptersOf, setSleep, pronounceSheet,
} from './speech.js';

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

function Continue({ book, reading, onPlayer }) {
  const here = reading && reading.uid === book.id;
  const pct = progressOf(book, reading);
  return (
    <section class="continue" onClick={() => onPlayer(book.id)}>
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
          else if (native) startBook(book.id).then(() => onPlayer(book.id));
          else open(book.id, true);
        }}
      >
        {here && reading.playing ? '❚❚' : '▶'}
      </button>
    </section>
  );
}

function MiniPlayer({ reading, books, onPlayer }) {
  if (!reading) return null;
  const b = (books || []).find((x) => x.id === reading.uid);
  return (
    <div class="player" onClick={() => b && onPlayer(b.id)}>
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

/** Paper to Audio's voice packs: downloaded or not, with live progress and a Download button. */
function VoicePacks() {
  const [list, setList] = useState([]);
  const [prog, setProg] = useState({});
  useEffect(() => {
    if (!native) return;
    const load = () => packs().then(setList).catch(() => {});
    load();
    return watchDownloads((d) => {
      setProg((p) => ({ ...p, [d.key]: d }));
      if (d.done) load();
    });
  }, []);
  if (!native || !list.length) return null;
  const names = { supertonic: 'Light voices (Supertonic)', pocket: 'Real readers', kokoro: 'More voices (Kokoro)' };
  return (
    <>
      <div class="k">Voice downloads</div>
      {list.map((p) => {
        const d = prog[p.key];
        const busy = (d && !d.done) || p.downloading;
        return (
          <div class="rowbtn" key={p.key}>
            <span>
              {names[p.key] || p.title}
              <br />
              <span class="muted small">
                {p.installed ? 'Downloaded · works offline' : busy ? d?.message || 'Downloading…' : d?.error || `${p.mb} MB, once`}
              </span>
            </span>
            {!p.installed && !busy && (
              <button
                class="primary"
                onClick={() => {
                  setProg((x) => ({ ...x, [p.key]: { progress: 0, message: 'Starting download…', done: false } }));
                  downloadPack(p.key).catch((e) => setProg((x) => ({ ...x, [p.key]: { done: true, error: e.message } })));
                }}
              >
                Download
              </button>
            )}
          </div>
        );
      })}
      <p class="muted small">Keep the app open while a download runs (the screen stays on by itself). Wi-Fi recommended.</p>
    </>
  );
}


/** How far into a book: where the iPhone is reading it, else where it was left, else the reader's own. */
function progressOf(book, reading) {
  const total = book.blocks?.length || book.paras || 0;
  const at = reading?.uid === book.id ? reading.para : positionOf(book.id);
  if (at != null && (reading?.total || total)) return Math.round((at * 100) / Math.max(1, (reading?.uid === book.id && reading.total) || total));
  return percentOf(book.id);
}

/** Starts reading a book here (no need to open the reader), where it was left. */
async function startBook(id, from) {
  const b = await getBook(id);
  if (!b) return;
  await putBook({ ...b, opened: Date.now() });
  await playBook(b, from).catch(() => {});
}

const SLEEPS = [
  [0, 'Off'],
  [15, '15 min'],
  [30, '30 min'],
  [45, '45 min'],
  [60, '1 hour'],
  [-1, 'End of chapter'],
];

/** The player: the book being listened to, with every control. */
function PlayerScreen({ id, reading, onClose }) {
  const [book, setBook] = useState(null);
  const [panel, setPanel] = useState(null); // 'chapters' | 'speed' | 'sleep'
  const [speed, setSpeed] = useState(rate());
  const [drag, setDrag] = useState(null);
  const [voice, setVoice] = useState(voiceName());
  useEffect(() => {
    getBook(id).then(setBook);
    const t = setInterval(() => setVoice(voiceName()), 800);
    return () => clearInterval(t);
  }, [id]);
  if (!book) return null;
  const here = reading && reading.uid === id;
  const total = book.blocks.length;
  const at = here ? reading.para : positionOf(id) ?? 0;
  const chapters = chaptersOf(book);
  const chapter = [...chapters].reverse().find((c) => c.para <= at);
  const now = book.blocks[Math.min(at, total - 1)]?.t || '';
  const go = (para) => {
    const p = Math.max(0, Math.min(total - 1, para));
    if (here) Speech.seek({ para: p }).catch(() => {});
    else playBook(book, p).catch(() => {});
  };
  const playPause = () => {
    if (here && reading.finished) return go(0);
    if (here) return (reading.playing ? Speech.pause() : Speech.resume()).catch(() => {});
    playBook(book).catch(() => {});
  };
  const sleepLabel = here && reading.sleep != null ? (reading.sleep === 'chapter' ? 'End of chapter' : `${Math.ceil(reading.sleep / 60)} min`) : 'Sleep';
  const pct = Math.round(((drag ?? at) * 100) / Math.max(1, total - 1));
  return (
    <div class="screen">
      <div class="screen-head">
        <button class="icon" aria-label="Close" onClick={onClose}>
          ⌄
        </button>
        <span class="muted small">{chapter?.title || 'Now playing'}</span>
        <button class="icon" aria-label="Read" onClick={() => open(id)}>
          📖
        </button>
      </div>
      <div class="screen-body">
        <Cover title={book.title} big />
        <h2 class="p-title">{book.title}</h2>
        {book.author && <p class="muted">{book.author}</p>}
        <p class="now-text">{now}</p>
        {here && reading.error && <p class="status err">{reading.error}</p>}
        <input
          class="seek"
          type="range"
          min="0"
          max={Math.max(0, total - 1)}
          value={drag ?? at}
          onInput={(e) => setDrag(+e.currentTarget.value)}
          onChange={(e) => {
            setDrag(null);
            go(+e.currentTarget.value);
          }}
        />
        <div class="seek-row muted small">
          <span>{pct}%</span>
          <span>{Math.round(((book.words || 0) * (100 - pct)) / 100 / 150 / Math.max(0.5, speed))} min left</span>
        </div>
        <div class="controls">
          <button class="round ghost big" aria-label="Previous paragraph" onClick={() => go(at - 1)}>
            ⏮
          </button>
          <button class="round huge" aria-label={here && reading.playing ? 'Pause' : 'Play'} onClick={playPause}>
            {here && reading.playing ? '❚❚' : '▶'}
          </button>
          <button class="round ghost big" aria-label="Next paragraph" onClick={() => go(at + 1)}>
            ⏭
          </button>
        </div>
        <div class="tools">
          <button onClick={() => setPanel(panel === 'speed' ? null : 'speed')}>{speed}×</button>
          <button onClick={() => pickVoice()}>{voice ? voice.split(' · ')[0].slice(0, 18) : 'Voice'}</button>
          <button onClick={() => setPanel(panel === 'sleep' ? null : 'sleep')}>⏾ {sleepLabel}</button>
          {chapters.length > 0 && <button onClick={() => setPanel(panel === 'chapters' ? null : 'chapters')}>☰ Chapters</button>}
        </div>
        {panel === 'speed' && (
          <div class="chips center-chips">
            {SPEEDS.map((v) => (
              <button
                class={v === speed ? 'on' : ''}
                onClick={() => {
                  setSpeed(v);
                  setRate(v);
                }}
              >
                {v}×
              </button>
            ))}
          </div>
        )}
        {panel === 'sleep' && (
          <div class="chips center-chips">
            {SLEEPS.map(([m, l]) => (
              <button
                onClick={() => {
                  setSleep(m).catch(() => {});
                  setPanel(null);
                }}
              >
                {l}
              </button>
            ))}
          </div>
        )}
        {panel === 'chapters' && (
          <ul class="chapters">
            {chapters.map((c) => (
              <li
                class={c === chapter ? 'on' : ''}
                onClick={() => {
                  go(c.para);
                  setPanel(null);
                }}
              >
                {c.title}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** What can be added: a file, a web page, photos of pages, or pasted text. */
function AddMenu({ onClose, onFile, onPhotos, onCamera, onLink, onPaste }) {
  const item = (icon, title, sub, f) => (
    <button
      class="rowbtn"
      onClick={() => {
        onClose();
        f();
      }}
    >
      <span>
        {icon} {title}
        <br />
        <span class="muted small">{sub}</span>
      </span>
      <span class="muted">›</span>
    </button>
  );
  return (
    <div class="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet">
        <div class="sheet-head">
          <h2>Add</h2>
          <button onClick={onClose}>Cancel</button>
        </div>
        {item('📚', 'A book or document', 'EPUB, PDF, text or web page file from Files', onFile)}
        {item('🔗', 'A web page', 'Paste or type its link', onLink)}
        {item('🖼', 'Photos of pages', 'Printed pages from your photos: the text is read out', onPhotos)}
        {item('📷', 'Take a photo', 'Photograph a printed page', onCamera)}
        {item('📋', 'Paste text', 'Any text to listen to', onPaste)}
      </div>
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

        <button class="rowbtn" onClick={() => pronounceSheet()}>
          <span>Pronunciations</span>
          <span class="muted">Fix how words are said ›</span>
        </button>

        <VoicePacks />

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
  const [adding, setAdding] = useState(false);
  const [player, setPlayer] = useState(null); // the book shown in the player
  const reading = useReading();
  const file = useRef();
  const photos = useRef();
  const camera = useRef();
  const refresh = () => listBooks().then(setBooks).catch((e) => setMsg(e.message));
  useEffect(() => void refresh(), []);

  // Files opened in the app from elsewhere (Files, Mail, Share → Paper to Audio): added to the library.
  useEffect(() => {
    if (!native) return;
    const take = () =>
      Speech.takeOpened()
        .then(({ files = [] }) => files.length && add(files.map((f) => fileFromBase64(f.name, f.data))))
        .catch(() => {});
    take();
    const h = Speech.addListener('opened', take);
    return () => h.then((x) => x.remove());
  }, []);

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

  async function addPhotos(files) {
    if (!files.length) return;
    setBusy(`Reading the text in ${files.length === 1 ? 'the photo' : `${files.length} photos`}…`);
    try {
      if (!native) throw new Error('Reading photos needs the iPhone app');
      await putBook(await fromPhotos(files, (a) => Speech.recognize(a)));
    } catch (e) {
      setMsg(e.message);
    }
    setBusy('');
    refresh();
  }

  async function addLink() {
    const link = prompt('Web page link', '');
    if (!link || !link.trim()) return;
    setBusy('Opening the page…');
    try {
      await putBook(await fromWebPage(link));
    } catch (e) {
      setMsg(`Couldn't open that page: ${e.message}`);
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
          <button class="add" onClick={() => setAdding(true)}>
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
        <input
          ref={photos}
          type="file"
          multiple
          accept="image/*"
          hidden
          onChange={(e) => {
            addPhotos([...e.target.files]);
            e.target.value = '';
          }}
        />
        <input
          ref={camera}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            addPhotos([...e.target.files]);
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

      {current && <Continue book={current} reading={reading} onPlayer={setPlayer} />}

      <div class="actions">
        <button onClick={() => file.current.click()}>Add a book or PDF</button>
        <button onClick={addLink}>Web page</button>
        <button onClick={() => photos.current.click()}>Photos of pages</button>
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
          const pct = progressOf(b, reading);
          return (
            <li key={b.id} onClick={() => (native ? setPlayer(b.id) : open(b.id))}>
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

      <MiniPlayer reading={reading} books={books} onPlayer={setPlayer} />
      {player && <PlayerScreen id={player} reading={reading} onClose={() => setPlayer(null)} />}
      {adding && (
        <AddMenu
          onClose={() => setAdding(false)}
          onFile={() => file.current.click()}
          onPhotos={() => photos.current.click()}
          onCamera={() => camera.current.click()}
          onLink={addLink}
          onPaste={() => setPaste('')}
        />
      )}
      {settings && <Settings onClose={() => setSettings(false)} />}
    </div>
  );
}

render(<Library />, document.getElementById('app'));
