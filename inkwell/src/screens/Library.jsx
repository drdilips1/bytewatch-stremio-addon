import { useMemo, useState } from 'preact/hooks';
import { Grid, Empty, Cover, toast } from '../components/common.jsx';
import { Icon } from '../components/icons.jsx';
import { library, progress, useStore } from '../lib/store.js';
import { downloads, removeDownload } from '../lib/downloads.js';
import { forgetEbook } from '../lib/epub.js';
import { nav } from '../lib/nav.js';

const TABS = [
  ['progress', 'In progress'],
  ['saved', 'Saved'],
  ['audio', 'Audiobooks'],
  ['text', 'Ebooks'],
  ['downloaded', 'Downloaded'],
  ['finished', 'Finished'],
];

export function Library() {
  const lib = useStore(library);
  const prog = useStore(progress);
  const dls = useStore(downloads);
  const [tab, setTab] = useState('progress');
  const [editing, setEditing] = useState(false);
  const items = useMemo(() => {
    const saved = Object.values(lib).filter((b) => !/^lbl?:/.test(b.uid || '')).sort((a, b) => b.addedAt - a.addedAt);
    const started = Object.values(prog).filter((p) => p.book).sort((a, b) => b.updatedAt - a.updatedAt);
    switch (tab) {
      case 'progress':
        return started.filter((p) => !p.finished).map((p) => p.book);
      case 'finished':
        return started.filter((p) => p.finished).map((p) => p.book);
      case 'saved':
        return saved;
      case 'downloaded':
        return Object.values(dls)
          .filter((d) => d.book && d.status !== 'cancelled')
          .map((d) => d.book);
      default: {
        // Audiobooks / Ebooks: everything saved or started of that kind.
        const seen = new Set();
        return [...saved, ...started.map((p) => p.book)].filter((b) => b.kind === tab && !seen.has(b.uid) && seen.add(b.uid));
      }
    }
  }, [lib, prog, tab, dls]);

  const stats = useMemo(() => {
    const vals = Object.values(prog);
    const seconds = vals.reduce((a, p) => a + (p.global || 0), 0);
    return { books: vals.length, hours: Math.round(seconds / 360) / 10, done: vals.filter((p) => p.finished).length };
  }, [prog]);

  return (
    <div class="screen library">
      <div class="library-head">
        <h1 class="screen-title">Library</h1>
        <button class={'pill small' + (editing ? ' active' : '')} onClick={() => setEditing(!editing)}>
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>
      <div class="stats">
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
      </div>
      <div class="segmented scroll">
        {TABS.map(([k, label]) => (
          <button class={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {items.length && editing ? (
        <div class="lib-edit">
          {items.map((b) => (
            <div class="lib-edit-row">
              <Cover book={b} />
              <div>
                <b>{b.title}</b>
                <small>{b.author}</small>
              </div>
              <button class="icon-btn" aria-label={`Remove ${b.title}`} onClick={() => remove(b, tab)}>
                <Icon name="trash" size={18} />
              </button>
            </div>
          ))}
        </div>
      ) : items.length ? (
        <Grid items={items} />
      ) : (
        <Empty icon="library" title="Your shelf is empty">
          Tap the heart on any book to save it, or{' '}
          <a href="#" onClick={(e) => (e.preventDefault(), nav.tab('discover'))}>
            discover something new
          </a>
          .
        </Empty>
      )}
      <div class="footer-space" />
    </div>
  );
}

/** Remove a book from the library: saved copy, reading/listening history and, for ebooks, the file kept on the phone. */
async function remove(book, tab) {
  if (tab === 'downloaded') {
    await removeDownload(book.uid).catch(() => {});
    return toast('Download removed');
  }
  library.set((lib) => {
    const next = { ...lib };
    delete next[book.uid];
    return next;
  });
  progress.set((all) => {
    const next = { ...all };
    delete next[book.uid];
    return next;
  });
  if (book.kind === 'text') forgetEbook(book.uid);
  toast(`Removed "${book.title}"`);
}
