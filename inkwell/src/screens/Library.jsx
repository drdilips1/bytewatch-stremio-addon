import { useMemo, useState } from 'preact/hooks';
import { Grid, Empty } from '../components/common.jsx';
import { library, progress, useStore } from '../lib/store.js';
import { downloads } from '../lib/downloads.js';
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
  const items = useMemo(() => {
    const saved = Object.values(lib).sort((a, b) => b.addedAt - a.addedAt);
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
      default:
        return saved.filter((b) => b.kind === tab);
    }
  }, [lib, prog, tab, dls]);

  const stats = useMemo(() => {
    const vals = Object.values(prog);
    const seconds = vals.reduce((a, p) => a + (p.global || 0), 0);
    return { books: vals.length, hours: Math.round(seconds / 360) / 10, done: vals.filter((p) => p.finished).length };
  }, [prog]);

  return (
    <div class="screen library">
      <h1 class="screen-title">Library</h1>
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
      {items.length ? (
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
