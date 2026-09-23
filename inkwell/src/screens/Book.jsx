import { useEffect, useState } from 'preact/hooks';
import { Cover, SourceBadge, Row, toast } from '../components/common.jsx';
import { Icon } from '../components/icons.jsx';
import { getDetails, findEditions, ia, sourceOf } from '../sources/index.js';
import { library, progress, toggleLibrary, useStore } from '../lib/store.js';
import { fmtDuration, fmtTime } from '../lib/format.js';
import { nav } from '../lib/nav.js';
import * as player from '../lib/player.js';
import { usePlayer, useCoverColor } from '../components/player-ui.jsx';

export function Book({ book: initial }) {
  const [book, setBook] = useState(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [editions, setEditions] = useState(null);
  const saved = !!useStore(library)[initial.uid];
  const prog = useStore(progress)[initial.uid];
  const ps = usePlayer();
  const color = useCoverColor(book);
  const isCurrent = ps.book?.uid === book.uid;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getDetails(initial)
      .then((d) => alive && setBook(d))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    if (initial.kind === 'discover') findEditions(initial).then((e) => alive && setEditions(e));
    return () => (alive = false);
  }, [initial.uid]);

  const listen = (opts) => {
    if (isCurrent && !opts) return player.toggle();
    nav.openOverlay('player');
    player.playBook(book, opts);
  };
  const canListen = book.kind === 'audio';
  const canRead = book.kind === 'text' && book.readUrl;
  const tracks = book.tracks || [];
  const pct = prog ? Math.round((prog.percent || 0) * 100) : 0;
  const authorKey = (book.author || '').split(',')[0].trim();

  return (
    <div class="screen book" style={color ? { '--dyn': color } : null}>
      <div class="book-hero">
        <div class="book-hero-bg">{book.cover && <img src={book.cover} alt="" />}</div>
        <header class="topbar transparent">
          <button class="icon-btn glass" onClick={() => nav.back()} aria-label="Back">
            <Icon name="back" />
          </button>
          <span />
          <button
            class={'icon-btn glass' + (saved ? ' liked' : '')}
            aria-label={saved ? 'Remove from library' : 'Save to library'}
            onClick={() => {
              toggleLibrary(book);
              toast(saved ? 'Removed from library' : 'Saved to library');
            }}
          >
            <Icon name="heart" fill={saved} />
          </button>
        </header>
        <div class="book-hero-content">
          <Cover book={book} class="book-cover" eager />
          <h1>{book.title}</h1>
          {book.author && <p class="book-author">{book.author}</p>}
          <div class="book-meta">
            <SourceBadge uid={book.uid} book={book} />
            {book.year && <span>{book.year}</span>}
            {book.duration > 0 && <span>{fmtDuration(book.duration)}</span>}
            {tracks.length > 1 && <span>{tracks.length} parts</span>}
            {book.narrator && <span>Narrated by {book.narrator}</span>}
            {book.language && <span>{book.language}</span>}
          </div>
        </div>
      </div>

      <div class="book-actions">
        {canListen && (
          <button class="btn primary big" disabled={loading && !book.tracks} onClick={() => listen()}>
            {loading && !isCurrent ? <span class="spinner" /> : <Icon name={isCurrent && ps.playing ? 'pause' : 'play'} size={18} />}
            {isCurrent && ps.playing ? 'Pause' : pct > 0 && !prog.finished ? `Resume · ${pct}%` : 'Listen now'}
          </button>
        )}
        {canRead && (
          <button class="btn primary big" onClick={() => nav.push('reader', { book })}>
            <Icon name="book" size={18} /> {pct > 0 ? `Continue reading · ${pct}%` : 'Read now'}
          </button>
        )}
        {book.link && (
          <a class="btn ghost" href={book.link} target="_blank" rel="noopener">
            <Icon name="external" size={16} />
          </a>
        )}
      </div>
      {pct > 0 && (
        <div class="progress-bar book-progress">
          <div style={{ width: pct + '%' }} />
        </div>
      )}

      {error && <p class="err pad">Couldn't load details: {error}</p>}

      {book.description && (
        <section class="pad">
          <p class={'description' + (expanded ? ' open' : '')} onClick={() => setExpanded(!expanded)}>
            {book.description}
          </p>
          {book.description.length > 280 && (
            <button class="link-btn" onClick={() => setExpanded(!expanded)}>
              {expanded ? 'Show less' : 'Read more'}
            </button>
          )}
        </section>
      )}

      {book.subjects?.length > 0 && (
        <div class="chips pad">
          {book.subjects.slice(0, 8).map((s) => (
            <span class="pill small">{s}</span>
          ))}
        </div>
      )}

      {book.kind === 'discover' && (
        <section class="pad">
          <h3 class="section-label">Free editions</h3>
          {!editions ? (
            <p class="muted">Searching audio and ebook sources…</p>
          ) : editions.audio.length + editions.text.length === 0 ? (
            <p class="muted">No free edition found — this title may still be under copyright. Try an addon or your Audiobookshelf server.</p>
          ) : null}
        </section>
      )}
      {editions?.audio?.length > 0 && <Row title="Listen" subtitle="Audiobook editions" icon="headphones" items={editions.audio} />}
      {editions?.text?.length > 0 && <Row title="Read" subtitle="Ebook editions" icon="book" items={editions.text} />}

      {tracks.length > 0 && (
        <section class="pad">
          <h3 class="section-label">
            {tracks.length} {tracks.length === 1 ? 'part' : 'parts'}
          </h3>
          <ol class="chapter-list flat">
            {tracks.map((t, i) => {
              const active = isCurrent && ps.index === i;
              const done = prog && (prog.track > i || prog.finished);
              return (
                <li class={(active ? 'active ' : '') + (done ? 'done' : '')}>
                  <button onClick={() => listen({ index: i, time: 0 })}>
                    <span class="ch-num">{active && ps.playing ? <span class="eq on"><i /><i /><i /></span> : done ? <Icon name="check" size={14} /> : i + 1}</span>
                    <span class="ch-title">{t.title}</span>
                    <span class="ch-time">{t.duration ? fmtTime(t.duration) : ''}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {authorKey && sourceOf(book.uid) === 'ia' && (
        <Row
          title={`More from ${authorKey}`}
          icon="sparkle"
          load={() => ia.query(`creator:("${authorKey.replace(/"/g, '')}")`, { rows: 15 }).then((r) => r.filter((b) => b.uid !== book.uid))}
          deps={[book.uid, authorKey]}
        />
      )}
      <div class="footer-space" />
    </div>
  );
}
