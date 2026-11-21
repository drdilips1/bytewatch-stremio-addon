// Library's front page: the book you're on, then a row per shelf (in progress, read later,
// found, audiobooks, ebooks, podcasts, finished) — "See all" opens that shelf with its filters.
import { useState } from 'preact/hooks';
import { BookCard, Empty } from './common.jsx';
import { GlassCard } from './glass-card.jsx';
import { Icon } from './icons.jsx';
import { nav } from '../lib/nav.js';
import { useStore, progress } from '../lib/store.js';
import { aiOff } from '../lib/ai.js';
import * as player from '../lib/player.js';
import { getDetails } from '../sources/index.js';


function Shelf({ title, count, items, onAll }) {
  if (!items.length) return null;
  return (
    <section class="lh-row">
      <header class="lh-head">
        <h3>
          {title} {count > 0 && <small>{count}</small>}
        </h3>
        <button class="lh-all" onClick={onAll}>
          See all
        </button>
      </header>
      <div class="row-scroll">
        {items.slice(0, 15).map((b) => (
          <BookCard key={b.uid} book={b} />
        ))}
      </div>
    </section>
  );
}

/** The book you're on: the frosted-glass card (tap it to carry on). */
function ContinueCard({ book }) {
  const p = useStore(progress)[book.uid];
  const go = () => {
    if (book.kind === 'text') return nav.push('reader', { book });
    nav.openOverlay('player');
    player.openAndPlay(book, getDetails);
  };
  return <GlassCard book={book} prog={p || { percent: 0 }} onPlay={go} />;
}

export function LibraryHome({ groups, shelves, stats, libby, openTab }) {
  const inProgress = groups.progress.filter((b) => b.source !== 'pod');
  const [top, ...rest] = inProgress;
  const seen = new Set();
  const found = shelves.flatMap((s) => s.books).filter((b) => b?.uid && !seen.has(b.uid) && seen.add(b.uid));
  const empty = !inProgress.length && !groups.audio.all.length && !groups.text.all.length && !groups.later.length && !groups.finished.length;
  return (
    <div class="lib-home">
      <button class="lh-stats" onClick={() => nav.push('stats')}>
        {stats.books} started · {stats.hours} h listened · {stats.done} finished ›
      </button>
      {top && <ContinueCard book={top} />}
      <Shelf title="In progress" count={inProgress.length} items={rest} onAll={() => openTab('progress')} />
      <Shelf title="Read later" count={groups.later.length} items={groups.later} onAll={() => openTab('later')} />
      <Shelf title="Found" count={found.length} items={found} onAll={() => openTab('found')} />
      <Shelf title="Audiobooks" count={groups.audio.all.length} items={groups.audio.all} onAll={() => openTab('audio')} />
      <Shelf title="Ebooks" count={groups.text.all.length} items={groups.text.all} onAll={() => openTab('text')} />
      <Shelf title="Podcast episodes" count={groups.podcasts.length} items={groups.podcasts} onAll={() => openTab('podcasts')} />
      <Shelf title="Finished" count={groups.finished.length} items={groups.finished} onAll={() => openTab('finished')} />
      <div class="lh-links">
        {!groups.podcasts.length && (
          <button class="pill small" onClick={() => openTab('podcasts')}>
            <Icon name="mic" size={14} /> Your podcasts
          </button>
        )}
        {libby && (
          <button class="pill small" onClick={() => openTab('libby')}>
            <Icon name="library" size={14} /> Libby
          </button>
        )}
      </div>
      {empty && (
        <Empty icon="library" title="Your shelf is empty">
          Tap the heart on any book to save it, or{' '}
          <a href="#" onClick={(e) => (e.preventDefault(), nav.tab('discover'))}>
            discover something new
          </a>
          .
        </Empty>
      )}
    </div>
  );
}

/** ⋯: the less-used tools (notes, tidy up, stats, edit, ask, find books). */
export function LibMenu({ editing, setEditing, canEdit }) {
  const [open, setOpen] = useState(false);
  const off = useStore(aiOff);
  const go = (fn) => () => (setOpen(false), fn());
  return (
    <div class="lib-menu">
      <button class={'icon-btn glass' + (open ? ' active' : '')} aria-label="More" onClick={() => setOpen(!open)}>
        <Icon name="dots" size={20} />
      </button>
      {open && (
        <>
          <div class="lib-menu-back" onClick={() => setOpen(false)} />
          <div class="lib-menu-list" role="menu">
            <button onClick={go(() => nav.push('notes'))}>
              <Icon name="bookmark" size={17} /> Notes and bookmarks
            </button>
            <button onClick={go(() => nav.push('tidy'))}>
              <Icon name="wand" size={17} /> Tidy up (covers, duplicates…)
            </button>
            <button onClick={go(() => nav.push('stats'))}>
              <Icon name="chart" size={17} /> Listening stats
            </button>
            <button onClick={go(() => nav.push('find'))}>
              <Icon name="camera" size={17} /> Find books in a photo or page
            </button>
            {!off && (
              <button onClick={go(() => nav.push('ask', {}))}>
                <Icon name="ai" size={17} /> Ask AI about your books
              </button>
            )}
            {canEdit && (
              <button onClick={go(() => setEditing(!editing))}>
                <Icon name="trash" size={17} /> {editing ? 'Done removing' : 'Remove books…'}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
