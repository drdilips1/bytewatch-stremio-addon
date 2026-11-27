// Narrato's home screen, as on Android: the greeting, the book being listened to (Now listening, with
// Resume), the library, a player bar while the iPhone reads, and the tabs Home · Library · Voices · Settings.
// Add a file (EPUB, PDF, text, web page), a web page by its link, photos of pages, or pasted text; tap a book
// to read and listen to it in the reader.
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import './library.css';
import { listBooks, putBook, deleteBook, getBook, percentOf } from './db.js';
import { importFile, fromText, fromWebPage, fromPhotos, fileFromBase64 } from './importers.js';
import { MEDICAL_KEY, medicalMode } from './spoken.js';
import {
  Speech, native, pickVoice, voiceName, rate, setRate, packs, watchDownloads, downloadPack,
  playBook, positionOf, pronounceSheet,
} from './speech.js';

const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';
const SPEEDS = [0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const PRIVACY_URL = 'https://drdilips1.github.io/bytewatch-stremio-addon/privacy.html';
const NAME_KEY = 'narrato:name';

const minutes = (words, speed = 1) => {
  const m = Math.max(1, Math.round(words / 150 / Math.max(0.5, speed))); // about 150 words a minute
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

function greeting() {
  const h = new Date().getHours();
  return h >= 5 && h < 12 ? 'Good morning' : h >= 12 && h < 17 ? 'Good afternoon' : 'Good evening';
}

function open(id, play = false) {
  getBook(id)
    .then((b) => b && putBook({ ...b, opened: Date.now() }))
    .finally(() => (location.href = `reader.html?id=${encodeURIComponent(id)}${play ? '&play=1' : ''}`));
}

// ---- appearance (the home screen; the reader has its own themes): Pearl by day, Midnight by night ----
const THEME_KEY = 'p2a:iosTheme';
function applyTheme(t = localStorage.getItem(THEME_KEY) || 'system') {
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}
applyTheme();

// ---- icons (stroke, in the text colour) ----
const Icon = ({ d, size = 22, fill }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'}
    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {[].concat(d).map((p) => <path d={p} />)}
  </svg>
);
const I = {
  play: 'M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z',
  pause: ['M7 5h3.5v14H7z', 'M13.5 5H17v14h-3.5z'],
  plus: ['M12 5v14', 'M5 12h14'],
  home: 'M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1z',
  list: ['M8 6h12', 'M8 12h12', 'M8 18h12', 'M4 6h.01', 'M4 12h.01', 'M4 18h.01'],
  voice: ['M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z', 'M5 11a7 7 0 0 0 14 0', 'M12 18v3'],
  gear: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.8 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3.1 14H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 20.9 10H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
  headphones: ['M4 14v-2a8 8 0 0 1 16 0v2', 'M4 14h3v6H5a1 1 0 0 1-1-1z', 'M20 14h-3v6h2a1 1 0 0 0 1-1z'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  down: 'M6 9l6 6 6-6',
  book: ['M4 6.5C6.5 5 9.5 5 12 6.5 14.5 5 17.5 5 20 6.5V19c-2.5-1.5-5.5-1.5-8 0-2.5-1.5-5.5-1.5-8 0z', 'M12 6.5V19'],
  prev: ['M6 6v12', 'M18 6l-9 6 9 6z'],
  next: ['M18 6v12', 'M6 6l9 6-9 6z'],
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  doc: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5'],
  paste: ['M9 4h6v3H9z', 'M9 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-3'],
  link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
  camera: ['M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z', 'M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
  image: ['M4 5h16v14H4z', 'M4 16l5-5 4 4 3-3 4 4', 'M15 9h.01'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13'],
};

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

/** A book's cover: its picture when the book has one, else its title on a deep colour (as on Android). */
const SHADES = ['#34485E', '#5B2E2E', '#24463F', '#4A3D63', '#5A4A2E', '#2E4A5B'];
function Cover({ book, size = 'small' }) {
  if (book?.cover) return <img class={'cover ' + size} src={book.cover} alt="" />;
  const t = book?.title || '?';
  let h = 0;
  for (const c of t) h = (h * 31 + c.charCodeAt(0)) | 0;
  return (
    <div class={'cover ' + size} style={{ background: `linear-gradient(150deg, ${SHADES[Math.abs(h) % SHADES.length]}, #10141C)` }}>
      <span>{t}</span>
    </div>
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

/** The book being listened to, on a card with a wash of the theme's colour (Narrato's Now listening card). */
function Hero({ book, reading }) {
  const here = reading && reading.uid === book.id;
  const playing = here && reading.playing;
  const pct = progressOf(book, reading);
  const left = Math.round(((book.words || 0) * (100 - pct)) / 100);
  const voice = voiceName();
  return (
    <section class="hero">
      <div class="hero-top" onClick={() => open(book.id)}>
        <Cover book={book} size="big" />
        <div class="hero-text">
          <span class="label">{here ? 'NOW LISTENING' : 'CONTINUE'}</span>
          <b class="serif">{book.title}</b>
          <span class="muted">{[book.author, voice && voice.split(' · ')[0]].filter(Boolean).join(' · ')}</span>
        </div>
      </div>
      <div class="bar">
        <i style={{ width: pct + '%' }} />
      </div>
      <div class="meta muted">
        <span>{pct}%</span>
        <span>{minutes(left, rate())} left</span>
      </div>
      <div class="hero-buttons">
        <button
          class="primary wide"
          onClick={() => {
            if (here) (reading.playing ? Speech.pause() : Speech.resume()).catch(() => {});
            else if (native) startBook(book.id);
            else open(book.id, true);
          }}
        >
          <Icon d={playing ? I.pause : I.play} fill size={20} />
          {playing ? 'Pause' : 'Resume'}
        </button>
        <button class="circle" aria-label="Open the book and its player" onClick={() => open(book.id)}>
          <Icon d={I.headphones} />
        </button>
      </div>
    </section>
  );
}

function MiniPlayer({ reading, books }) {
  if (!reading) return null;
  const b = (books || []).find((x) => x.id === reading.uid);
  const pct = b ? progressOf(b, reading) : 0;
  const voice = voiceName();
  return (
    <div class="mini" onClick={() => b && open(b.id)}>
      <Cover book={b} size="tiny" />
      <div class="mini-text">
        <b>{b?.title || 'Reading'}</b>
        <span class="muted">
          {[reading.finished ? 'Finished' : reading.playing ? 'Playing' : 'Paused', voice && voice.split(' · ')[0], `${pct}%`].filter(Boolean).join(' · ')}
        </span>
      </div>
      <button
        class="circle plain"
        aria-label={reading.playing ? 'Pause' : 'Play'}
        onClick={(e) => {
          e.stopPropagation();
          (reading.playing ? Speech.pause() : Speech.resume()).catch(() => {});
        }}
      >
        <Icon d={reading.playing ? I.pause : I.play} fill />
      </button>
    </div>
  );
}

/** Narrato's voice packs: downloaded or not, with live progress and a Download button. */
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
          <div class="row-item" key={p.key}>
            <span class="row-text">
              {names[p.key] || p.title}
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

/** A bottom sheet with Narrato's rows (icon in a circle, title, a line under it). */
function Sheet({ title, subtitle, onClose, children }) {
  return (
    <div class="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet">
        <div class="grab" />
        <h2>{title}</h2>
        {subtitle && <p class="muted sub">{subtitle}</p>}
        <div class="sheet-body">{children}</div>
      </div>
    </div>
  );
}

function Row({ icon, title, sub, onClick }) {
  return (
    <button class="row" onClick={onClick}>
      <span class="row-icon">
        <Icon d={icon} size={20} />
      </span>
      <span class="row-text">
        {title}
        {sub && <span class="muted small">{sub}</span>}
      </span>
    </button>
  );
}

/** Add something to listen to (Narrato's Add menu). */
function AddMenu({ onClose, onFile, onPhotos, onCamera, onLink, onPaste }) {
  const go = (f) => () => {
    onClose();
    f();
  };
  return (
    <Sheet title="Add something to listen to" onClose={onClose}>
      <Row icon={I.doc} title="Book or document" sub="PDF, EPUB or text file" onClick={go(onFile)} />
      <Row icon={I.paste} title="Paste text" sub="From the clipboard, or type it" onClick={go(onPaste)} />
      <Row icon={I.link} title="Web page" sub="An article or blog post, by its link" onClick={go(onLink)} />
      <Row icon={I.camera} title="Photo of a page" sub="Take a picture; the text is read from it" onClick={go(onCamera)} />
      <Row icon={I.image} title="Photos or screenshots" sub="Choose images that have text" onClick={go(onPhotos)} />
    </Sheet>
  );
}

/** A book's menu (long-press, or its ⋯ button). */
function BookMenu({ book, onClose, onRemove }) {
  return (
    <Sheet title={book.title} subtitle={book.author} onClose={onClose}>
      <Row icon={I.book} title="Read and listen" sub="Continue where you left off" onClick={() => open(book.id)} />
      <Row
        icon={I.trash}
        title="Delete"
        sub="Remove it from your library"
        onClick={() => {
          onClose();
          onRemove(book);
        }}
      />
    </Sheet>
  );
}

/** Settings: Narrato's menu, with the iPhone's speed, pronunciations and voice downloads. */
function Settings({ onClose, onName }) {
  const [speed, setSpeed] = useState(rate());
  const [theme, setTheme] = useState(localStorage.getItem(THEME_KEY) || 'system');
  const [medical, setMedical] = useState(medicalMode());
  const [about, setAbout] = useState(false);
  const name = localStorage.getItem(NAME_KEY) || '';
  return (
    <Sheet title="Narrato" subtitle={`Version ${VERSION || '1.0'} · free, unlimited, no ads`} onClose={onClose}>
      <div class="k">Theme</div>
      <div class="chips">
        {[
          ['system', 'System'],
          ['light', 'Pearl'],
          ['dark', 'Midnight'],
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

      <div class="k">Medical articles</div>
      <div class="chips">
        {[
          ['auto', 'Automatic'],
          ['on', 'Always'],
          ['off', 'Never'],
        ].map(([v, l]) => (
          <button
            class={v === medical ? 'on' : ''}
            onClick={() => {
              setMedical(v);
              localStorage.setItem(MEDICAL_KEY, v);
            }}
          >
            {l}
          </button>
        ))}
      </div>
      <p class="muted small">Doses, units, lab names and clinical shorthand read in full; Automatic does it in medical documents.</p>

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

      <div class="k">You</div>
      <Row
        icon={I.voice}
        title="Your name"
        sub={name ? `Greeted as ${name}` : 'For the greeting on the first screen'}
        onClick={() => {
          const n = prompt('Your name (for the greeting)', name);
          if (n == null) return;
          if (n.trim()) localStorage.setItem(NAME_KEY, n.trim().slice(0, 30));
          else localStorage.removeItem(NAME_KEY);
          onName();
          onClose();
        }}
      />
      <Row icon={I.paste} title="Pronunciations" sub="Fix how words are said" onClick={() => pronounceSheet()} />

      <VoicePacks />

      <div class="k">Privacy</div>
      <Row icon={I.doc} title="Privacy policy" sub="What the app stores and shares" onClick={() => (location.href = PRIVACY_URL)} />
      <Row icon={I.book} title="About and credits" sub="The voices and libraries in this app" onClick={() => setAbout(!about)} />
      {about && (
        <p class="muted small">
          Narrato{VERSION ? ` ${VERSION}` : ''}. Listen to books, documents and web pages, as much as you like. Free, with no ads. Your books stay on this
          iPhone; the voices run on the iPhone and work offline (Look up needs the internet). Voices: Supertonic (Supertone), Kokoro (Apache 2.0), through
          sherpa-onnx (Apache 2.0). PDF reading: pdf.js (Apache 2.0).
        </p>
      )}
    </Sheet>
  );
}

function Library() {
  const [books, setBooks] = useState(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [paste, setPaste] = useState(null);
  const [settings, setSettings] = useState(false);
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState(null); // the book whose menu is open
  const [tab, setTab] = useState('home'); // 'home' | 'library'
  const [, setNameTick] = useState(0);
  const reading = useReading();
  const file = useRef();
  const photos = useRef();
  const camera = useRef();
  const refresh = () => listBooks().then(setBooks).catch((e) => setMsg(e.message));
  useEffect(() => {
    refresh();
    // Back from Files or another app: the library is read again (iOS may have closed its storage meanwhile).
    const back = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, []);

  // Files opened in the app from elsewhere (Files, Mail, Share → Narrato): added to the library.
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
    if (!confirm(`Delete “${b.title}” from the library?`)) return;
    if (reading?.uid === b.id) await Speech.stop().catch(() => {});
    await deleteBook(b.id);
    refresh();
  }

  // The book on the Now listening card: the one being read, else the one opened last.
  const all = [...(books || [])].sort((a, b) => (b.opened || 0) - (a.opened || 0));
  const current = all.find((b) => b.id === reading?.uid) || all.find((b) => b.opened) || all[0];
  const name = localStorage.getItem(NAME_KEY);

  return (
    <div class={'lib' + (reading ? ' with-player' : '')}>
      <header>
        <img class="logo" src="./icon-1024.png" alt="" />
        <h1 class="serif">
          Narrato<span class="dot">.</span>
        </h1>
        <button class="primary add" onClick={() => setAdding(true)}>
          <Icon d={I.plus} size={20} /> Add
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

      {paste != null && (
        <div class="card">
          <textarea placeholder="Paste or type the text to listen to" value={paste} onInput={(e) => setPaste(e.target.value)} autofocus />
          <div class="row-buttons">
            <button onClick={() => setPaste(null)}>Cancel</button>
            <button class="primary" disabled={!paste.trim()} onClick={savePaste}>
              Add to library
            </button>
          </div>
        </div>
      )}

      {books && !books.length && !busy && (
        <div class="empty">
          <p class="serif big">Your library is empty.</p>
          <p class="muted">Tap + Add to choose a book (EPUB), PDF, text or web page, or paste text.</p>
          <p class="muted">Tip: download a natural voice first, in Voices below.</p>
        </div>
      )}

      {books && books.length > 0 && tab === 'home' && (
        <>
          <h2 class="greet serif">{name ? `${greeting()}, ${name}` : greeting()}</h2>
          <p class="muted tagline">A little time for listening.</p>
          {current && <Hero book={current} reading={reading} />}
          <h3 class="section serif">Your library</h3>
        </>
      )}
      {books && books.length > 0 && tab === 'library' && (
        <>
          <h2 class="greet serif">Your library</h2>
          <p class="muted tagline">{books.length === 1 ? '1 book' : `${books.length} books`}</p>
        </>
      )}

      <ul class="books">
        {all.map((b) => {
          const pct = progressOf(b, reading);
          let timer;
          return (
            <li
              key={b.id}
              onClick={() => open(b.id)}
              onTouchStart={() => (timer = setTimeout(() => setMenu(b), 550))}
              onTouchEnd={() => clearTimeout(timer)}
              onTouchMove={() => clearTimeout(timer)}
            >
              <Cover book={b} />
              <div class="info">
                <b>{b.title}</b>
                {b.author && <span class="muted">{b.author}</span>}
                <span class="muted small">{minutes(b.words)}</span>
                <div class="bar-row">
                  <div class="bar">
                    <i style={{ width: pct + '%' }} />
                  </div>
                  <span class="muted small">{pct ? pct + '%' : 'New'}</span>
                </div>
              </div>
              <button
                class="circle plain"
                aria-label="More"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenu(b);
                }}
              >
                <Icon d={I.more} />
              </button>
            </li>
          );
        })}
      </ul>

      <MiniPlayer reading={reading} books={books} />

      <nav class="tabs" aria-label="Main">
        {[
          ['home', I.home, 'Home', () => (tab === 'home' ? scrollTo({ top: 0, behavior: 'smooth' }) : (setTab('home'), scrollTo(0, 0)))],
          ['library', I.list, 'Library', () => (setTab('library'), scrollTo(0, 0))],
          ['voices', I.voice, 'Voices', () => pickVoice()],
          ['settings', I.gear, 'Settings', () => setSettings(true)],
        ].map(([k, icon, label, f]) => (
          <button class={'tab' + (k === tab ? ' on' : '')} aria-current={k === tab ? 'page' : undefined} onClick={f}>
            <Icon d={icon} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

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
      {menu && <BookMenu book={menu} onClose={() => setMenu(null)} onRemove={remove} />}
      {settings && <Settings onClose={() => setSettings(false)} onName={() => setNameTick((n) => n + 1)} />}
    </div>
  );
}

render(<Library />, document.getElementById('app'));
