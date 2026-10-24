import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Grid, Empty, Cover, toast, AskButton } from '../components/common.jsx';
import { Icon } from '../components/icons.jsx';
import { library, progress, useStore, forgetBook, persisted, clearPodcastHistory } from '../lib/store.js';
import { localSrc } from '../sources/index.js';
import { fmtDuration } from '../lib/format.js';
import { metaNow } from '../lib/meta.js';
import { seriesOf } from '../lib/series.js';
import { oneEach } from '../lib/works.js';
import { downloads, removeDownload } from '../lib/downloads.js';
import { forgetEbook, savedEbooks } from '../lib/epub.js';
import { nav } from '../lib/nav.js';
import { podcasts } from '../sources/podcasts.js';
import { ShowGrid } from './Podcasts.jsx';
import { EbookSearchBox, EbookSearchResults } from '../components/ebook-search.jsx';

const TABS = [
  ['progress', 'Continue'],
  ['audio', 'Audiobooks'],
  ['text', 'Ebooks'],
  ['podcasts', 'Podcasts'],
  ['finished', 'Finished'],
];
// Inside Audiobooks / Ebooks: where the books are.
const WHERE = [
  ['all', 'All'],
  ['phone', 'On this phone'],
  ['downloaded', 'Downloaded'],
  ['saved', 'Saved'],
];

const SORTS = [
  ['recent', 'Recent'],
  ['title', 'Title'],
  ['author', 'Author'],
  ['length', 'Length'],
  ['series', 'Series'],
];
const surname = (name) => String(name).split(',')[0].trim().split(/\s+/).pop() || '';
const libView = persisted('libraryView', { list: false, sort: 'recent', tab: 'progress', where: 'all' });
const lengthOf = (b) => b.duration || metaNow(b)?.runtime || b.size || 0;
// Phone and cloud books often get their author from the online lookup.
const authorOf = (b) => metaNow(b)?.author || b.author || '';
const titleOf = (b) => (b.source === 'loc' && metaNow(b)?.title) || b.title || '';
const SORTERS = {
  title: (a, b) => titleOf(a).localeCompare(titleOf(b), undefined, { numeric: true }),
  // By surname; books with no known author go last.
  author: (a, b) => {
    const x = surname(authorOf(a));
    const y = surname(authorOf(b));
    if (!x !== !y) return x ? -1 : 1;
    return x.localeCompare(y) || SORTERS.title(a, b);
  },
  length: (a, b) => lengthOf(b) - lengthOf(a),
};

export function Library() {
  const view = useStore(libView);
  const local = useStore(localSrc.localCfg);
  const lib = useStore(library);
  const prog = useStore(progress);
  const dls = useStore(downloads);
  const pods = useStore(podcasts);
  const kept = useStore(savedEbooks);
  const tab = TABS.some(([k]) => k === view.tab) ? view.tab : 'progress';
  const where = view.where || 'all';
  const setTab = (t) => libView.set((v) => ({ ...v, tab: t, where: 'all' }));
  const setWhere = (w) => libView.set((v) => ({ ...v, where: w }));
  const [editing, setEditing] = useState(false);
  const [ebookQ, setEbookQ] = useState('');
  const findingEbook = tab === 'text' && ebookQ.trim().length > 1;
  const [editShown, setEditShown] = useState(60);
  const last = useRef([]);
  // Every group of books, once per change.
  const groups = useMemo(() => {
    // Defensive: skip anything malformed rather than failing the whole screen.
    const ok = (b) => b && typeof b === 'object' && typeof b.uid === 'string';
    const saved = Object.values(lib || {}).filter((b) => ok(b) && !/^lbl?:/.test(b.uid) && b.source !== 'pod').sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    const started = Object.values(prog || {}).filter((p) => p && ok(p.book)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const phone = (local.books || []).filter(ok);
    const downloaded = Object.values(dls || {})
      .filter((d) => d && ok(d.book) && d.status !== 'cancelled')
      .map((d) => d.book);
    const kindOf = (b) => (b.kind === 'text' ? 'text' : 'audio');
    const unique = (list) => {
      const seen = new Set();
      return list.filter((b) => !seen.has(b.uid) && seen.add(b.uid));
    };
    const byKind = (k) => {
      const pick = (list) => list.filter((b) => kindOf(b) === k && b.source !== 'pod');
      const sub = {
        saved: pick(saved),
        phone: pick(phone),
        // Ebooks: the ones kept on the phone after opening them in the app.
        downloaded: k === 'audio' ? pick(downloaded) : Object.values(kept || {}).map((x) => x.book).filter(ok),
      };
      // Every copy of a book (phone, download, server, cloud) shows once.
      sub.all = oneEach(unique([...pick(started.map((p) => p.book)), ...sub.saved, ...sub.downloaded, ...sub.phone]));
      return sub;
    };
    return {
      progress: started.filter((p) => !p.finished).map((p) => p.book),
      finished: started.filter((p) => p.finished).map((p) => p.book),
      // Episodes you've started and not finished.
      podcasts: started.filter((p) => !p.finished && p.book.source === 'pod').map((p) => p.book),
      audio: byKind('audio'),
      text: byKind('text'),
    };
  }, [lib, prog, dls, local, kept]);
  const subs = tab === 'audio' || tab === 'text' ? groups[tab] : null;
  const fresh = subs ? subs[where] || subs.all : groups[tab];
  // Phone books are listed once a folder has been scanned.
  useEffect(() => {
    if ((tab === 'audio' || tab === 'text') && localSrc.connected() && !local.scannedAt) localSrc.rescan().catch(() => {});
  }, [tab]);
  const sorted = useMemo(() => (view.sort !== 'recent' && SORTERS[view.sort] ? [...fresh].sort(SORTERS[view.sort]) : fresh), [fresh, view.sort]);
  // Position saves (every few seconds while playing) give new objects for one book at
  // most: keep the same list when nothing else changed, so the grid isn't redone.
  const items = sorted.length === last.current.length && sorted.every((b, i) => b === last.current[i]) ? last.current : (last.current = sorted);

  const stats = useMemo(() => {
    const vals = Object.values(prog || {}).filter((p) => p && typeof p === 'object');
    const seconds = vals.reduce((a, p) => a + (p.global || 0), 0);
    return { books: vals.length, hours: Math.round(seconds / 360) / 10, done: vals.filter((p) => p.finished).length };
  }, [prog]);

  return (
    <div class="screen library">
      <div class="library-head">
        <h1 class="screen-title">Library</h1>
        <div class="library-head-actions">
          <button class="icon-btn glass" onClick={() => nav.push('notes')} aria-label="Notes and bookmarks">
            <Icon name="bookmark" size={19} />
          </button>
          <button class="icon-btn glass" onClick={() => nav.push('stats')} aria-label="Listening stats">
            <Icon name="chart" size={20} />
          </button>
          <button class={'pill small' + (editing ? ' active' : '')} onClick={() => setEditing(!editing)}>
            {editing ? 'Done' : 'Edit'}
          </button>
          <AskButton />
        </div>
      </div>
      <button class="stats" onClick={() => nav.push('stats')} aria-label="Listening stats">
        <div>
          <b>{stats.books}</b>
          <span>started</span>
        </div>
        <div>
          <b>{stats.hours}</b>
          <span>hours listened</span>
        </div>
        <div>
          <b>{stats.done}</b>
          <span>finished</span>
        </div>
      </button>
      <div class="segmented scroll">
        {TABS.map(([k, label]) => (
          <button class={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {subs && (
        <div class="lib-where">
          {WHERE.filter(([k]) => k === 'all' || (subs[k].length && !(k === 'saved' && subs.saved.length === subs.all.length)) || (k === 'phone' && localSrc.available)).map(([k, label]) => (
            <button class={'pill small' + (where === k ? ' active' : '')} onClick={() => setWhere(k)}>
              {label} <span class="lib-count">{subs[k].length}</span>
            </button>
          ))}
        </div>
      )}
      {tab === 'text' && <EbookSearchBox q={ebookQ} setQ={setEbookQ} />}
      {findingEbook ? (
        <EbookSearchResults q={ebookQ} />
      ) : (
        <>
      {subs && where === 'phone' && items.length > 0 && <PhoneManage />}
      {subs && where === 'downloaded' && (
        <button class="btn ghost-wide lib-manage" onClick={() => nav.push('downloads')}>
          <Icon name="download" size={16} /> Manage downloads
        </button>
      )}
      {tab !== 'podcasts' && items.length > 1 && (
        <div class="lib-tools">
          <div class="lib-sort">
            {SORTS.map(([k, label]) => (
              <button class={'pill small' + (view.sort === k ? ' active' : '')} onClick={() => libView.set((v) => ({ ...v, sort: k }))}>
                {label}
              </button>
            ))}
          </div>
          <button class="icon-btn" aria-label={view.list ? 'Show as grid' : 'Show as list'} onClick={() => libView.set((v) => ({ ...v, list: !v.list }))}>
            <Icon name={view.list ? 'grid' : 'list'} size={20} />
          </button>
        </div>
      )}
      {subs && where === 'phone' && !items.length ? (
        <PhoneEmpty />
      ) : tab === 'podcasts' ? (
        <div class="lib-pods">
          {items.length > 0 && (
            <>
              <div class="lib-pod-head">
                <h3 class="section-label pad">Episodes in progress</h3>
                <button
                  class="link-btn"
                  onClick={() => confirm('Clear podcast history? Episodes you haven’t finished lose their place and leave this list and Home.') && (clearPodcastHistory(), toast('Podcast history cleared'))}
                >
                  Clear history
                </button>
              </div>
              <Grid items={items} />
            </>
          )}
          <h3 class="section-label pad">Your shows</h3>
          {pods.subs.length ? (
            <div class="pad">
              <ShowGrid shows={pods.subs} />
            </div>
          ) : (
            <Empty icon="mic" title="No shows yet">
              Follow podcasts from the{' '}
              <a href="#" onClick={(e) => (e.preventDefault(), nav.tab('podcasts'))}>
                Podcasts tab
              </a>
              .
            </Empty>
          )}
        </div>
      ) : items.length && editing && !(subs && where === 'phone') ? (
        <div class="lib-edit">
          {items.slice(0, editShown).map((b) => (
            <div class="lib-edit-row">
              <Cover book={b} />
              <div>
                <b>{b.title}</b>
                <small>{b.author}</small>
              </div>
              <button class="icon-btn" aria-label={`Remove ${b.title}`} onClick={() => remove(b, subs ? where : tab)}>
                <Icon name="trash" size={18} />
              </button>
            </div>
          ))}
          {items.length > editShown && (
            <button class="btn ghost-wide" onClick={() => setEditShown(editShown + 60)}>
              Show more ({items.length - editShown})
            </button>
          )}
        </div>
      ) : items.length ? (
        view.sort === 'series' ? <SeriesGroups items={items} /> : view.list ? <ListView items={items} prog={prog} /> : <Grid items={items} />
      ) : (
        <Empty icon="library" title="Your shelf is empty">
          Tap the heart on any book to save it, or{' '}
          <a href="#" onClick={(e) => (e.preventDefault(), nav.tab('discover'))}>
            discover something new
          </a>
          .
        </Empty>
      )}
        </>
      )}
      <div class="footer-space" />
    </div>
  );
}

/** One row per book: cover, title, author and how far you are. */
function ListView({ items, prog }) {
  const [count, setCount] = useState(80);
  return (
    <div class="lib-list">
      {items.slice(0, count).map((b) => {
        const p = prog?.[b.uid];
        const pct = p && !p.finished ? Math.round((p.percent || 0) * 100) : 0;
        return (
          <button class="lib-row" onClick={() => nav.push(b.kind === 'text' && /#ebook$/.test(b.uid) ? 'reader' : 'book', { book: b })}>
            <Cover book={b} />
            <div>
              <b>{b.title}</b>
              <small>
                {b.author}
                {b.duration ? ` · ${fmtDuration(b.duration)}` : ''}
                {p?.finished ? ' · Finished' : pct ? ` · ${pct}%` : ''}
              </small>
              {pct > 0 && (
                <div class="progress-bar">
                  <div style={{ width: pct + '%' }} />
                </div>
              )}
            </div>
          </button>
        );
      })}
      {items.length > count && (
        <button class="btn ghost-wide" onClick={() => setCount(count + 80)}>
          Show more ({items.length - count})
        </button>
      )}
    </div>
  );
}

/** Run a phone-books action with a busy flag and a short result toast. */
function usePhoneRun() {
  const [busy, setBusy] = useState('');
  const run = (label, fn) => async () => {
    setBusy(label);
    try {
      const r = await fn();
      if (typeof r === 'number') toast(r ? `${r} book${r > 1 ? 's' : ''} added` : 'Nothing added');
      else if (Array.isArray(r)) toast(`${r.length} book${r.length === 1 ? '' : 's'} found`);
    } catch (e) {
      if (!/no folder chosen|cancelled/i.test(e.message)) toast(e.message);
    } finally {
      setBusy('');
    }
  };
  return [busy, run];
}

/** Choose folder / Add EPUB or PDF files / Rescan. */
function PhoneButtons({ busy, run }) {
  const cfg = useStore(localSrc.localCfg);
  return (
    <div class="phone-actions">
      <button class="btn primary" disabled={!!busy} onClick={run('add', localSrc.addFolder)}>
        {busy === 'add' ? <span class="spinner" /> : <Icon name="plus" size={16} />} {cfg.folders.length ? 'Add folder' : 'Choose folder'}
      </button>
      <button class="btn secondary" disabled={!!busy} onClick={run('files', localSrc.pickBooks)}>
        {busy === 'files' ? <span class="spinner" /> : <Icon name="book" size={16} />} Add EPUB / PDF
      </button>
      {cfg.folders.length > 0 && (
        <button class="btn secondary" disabled={!!busy} onClick={run('scan', localSrc.rescan)}>
          {busy === 'scan' ? <span class="spinner" /> : <Icon name="shuffle" size={16} />} Rescan
        </button>
      )}
    </div>
  );
}

/** "On this phone" with books: the folders it reads (with counts), add / remove / rescan. */
function PhoneManage() {
  const cfg = useStore(localSrc.localCfg);
  const [open, setOpen] = useState(false);
  const [busy, run] = usePhoneRun();
  const count = (list) => {
    const eb = list.filter((b) => b.kind === 'text').length;
    const au = list.length - eb;
    return [au && `${au} audiobook${au > 1 ? 's' : ''}`, eb && `${eb} ebook${eb > 1 ? 's' : ''}`].filter(Boolean).join(' · ') || 'No books yet';
  };
  const added = cfg.imported || [];
  return (
    <div class="phone-manage">
      <button class="btn ghost-wide lib-manage" onClick={() => setOpen(!open)}>
        <Icon name="library" size={16} /> Folders & files
        <small>
          {cfg.folders.length} folder{cfg.folders.length === 1 ? '' : 's'}
          {added.length ? ` · ${added.length} added` : ''}
        </small>
        <Icon name="down" size={16} />
      </button>
      {open && (
        <div class="phone-panel">
          {cfg.folders.map((f) => (
            <div class="set-row">
              <div>
                <b>{decodeURIComponent(f.name)}</b>
                <small>{count(cfg.books.filter((b) => b.folder === f.uri))}</small>
              </div>
              <button class="pill small" onClick={() => confirm(`Stop reading “${decodeURIComponent(f.name)}”? The files stay on the phone.`) && localSrc.removeFolder(f.uri)}>
                Remove
              </button>
            </div>
          ))}
          {added.length > 0 && (
            <div class="set-row">
              <div>
                <b>Added files</b>
                <small>{count(added)} · opened with or shared to Audiohub</small>
              </div>
            </div>
          )}
          <PhoneButtons busy={busy} run={run} />
        </div>
      )}
    </div>
  );
}

/** "On this phone" before a folder is chosen (or when it has no books). */
function PhoneEmpty() {
  const [busy, run] = usePhoneRun();
  if (!localSrc.available)
    return (
      <Empty icon="library" title="Books on your phone">
        Audiobooks and ebooks (EPUB, PDF) already on the phone show here in the Android app.
      </Empty>
    );
  return (
    <Empty icon="library" title={localSrc.connected() ? 'No books found' : 'Books on your phone'}>
      {localSrc.connected()
        ? 'Nothing playable in your chosen folders yet.'
        : 'Choose the folder where your audiobooks and ebooks are (e.g. Audiobooks or Books), or add single EPUB / PDF files. They play and open straight from the phone, no internet needed.'}
      <PhoneButtons busy={busy} run={run} />
    </Empty>
  );
}

/** Remove a book from the library: saved copy, reading/listening history and, for ebooks, the file kept on the phone. */
async function remove(book, tab) {
  if (tab === 'downloaded') {
    if (book.kind === 'text') {
      await forgetEbook(book.uid);
      return toast('Removed from this phone');
    }
    await removeDownload(book.uid).catch(() => {});
    return toast('Download removed');
  }
  forgetBook(book.uid);
  if (book.kind === 'text') forgetEbook(book.uid);
  if (book.imported) await localSrc.removeImported(book.uid);
  toast(`Removed "${book.title}"`);
}

/** Library sorted by series: each series in reading order, then books in no series. */
function SeriesGroups({ items }) {
  const groups = new Map();
  const loose = [];
  for (const b of items) {
    const s = seriesOf(b);
    if (!s?.name) {
      loose.push(b);
      continue;
    }
    const k = s.name.toLowerCase();
    if (!groups.has(k)) groups.set(k, { name: s.name, books: [] });
    groups.get(k).books.push({ b, n: s.n });
  }
  const list = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      {list.map((g) => (
        <section class="lib-series">
          <h3 class="section-label pad">
            {g.name} <small>{g.books.length} book{g.books.length > 1 ? 's' : ''}</small>
          </h3>
          <Grid items={g.books.sort((x, y) => (x.n ?? 1e9) - (y.n ?? 1e9)).map((x) => x.b)} />
        </section>
      ))}
      {loose.length > 0 && (
        <section class="lib-series">
          <h3 class="section-label pad">{list.length ? 'Not in a series' : 'No series found yet'}</h3>
          <Grid items={loose} />
        </section>
      )}
    </>
  );
}
