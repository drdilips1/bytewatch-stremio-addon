import { BgImage } from '../components/bg-image.jsx';
import { useEffect, useState } from 'preact/hooks';
import { Cover, SourceBadge, Row, toast } from '../components/common.jsx';
import { Icon } from '../components/icons.jsx';
import { getDetails, findEditions, ia, hc, sourceOf } from '../sources/index.js';
import { library, progress, toggleLibrary, useStore } from '../lib/store.js';
import { fmtDuration, fmtTime } from '../lib/format.js';
import { nav } from '../lib/nav.js';
import { openSearch } from './Discover.jsx';
import { mainTitle } from '../lib/match.js';
import { SourceResults } from '../components/source-results.jsx';
import { narrate, pickEngine } from '../sources/ttsbooks.js';
import { sourceAddons } from '../sources/sourceaddons.js';
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
  const [hcStatus, setHcStatus] = useState(null);
  const [listenBusy, setListenBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getDetails(initial)
      .then((d) => alive && setBook(d))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    if (initial.kind === 'discover') findEditions(initial).then((e) => alive && setEditions(e));
    if (hc.connected()) hc.knownStatus(initial).then((st) => alive && setHcStatus(st || 0)).catch(() => alive && setHcStatus(0));
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
        <div class="book-hero-bg">{book.cover && <BgImage url={book.cover} />}</div>
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
            {book.series && <span>{book.series}</span>}
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
            <Icon name="book" size={18} /> {pct > 0 ? `Continue · ${pct}%` : 'Read'}
          </button>
        )}
        {canRead && (
          <button
            class="btn secondary big"
            disabled={listenBusy}
            onClick={async () => {
              if (!pickEngine()) return nav.push('reader', { book, readAloud: true });
              setListenBusy(true);
              try {
                const audio = await narrate(book);
                nav.openOverlay('player');
                player.playBook(audio);
              } catch (e) {
                toast(e.message);
              } finally {
                setListenBusy(false);
              }
            }}
          >
            {listenBusy ? <span class="spinner" /> : <Icon name="headphones" size={18} />} Listen
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

      {book.metaSource && <p class="muted pad meta-credit">Details from {book.metaSource}</p>}
      {book.subjects?.length > 0 && (
        <div class="chips pad">
          {book.subjects.slice(0, 8).map((s) => (
            <span class="pill small">{s}</span>
          ))}
        </div>
      )}

      {hc.connected() && hcStatus !== null && (
        <section class="pad">
          <h3 class="section-label">Hardcover</h3>
          <div class="chips">
            {[
              [hc.STATUS.want, 'Want to read'],
              [hc.STATUS.reading, 'Reading'],
              [hc.STATUS.read, 'Read'],
            ].map(([code, label]) => (
              <button
                class={'pill small' + (hcStatus === code ? ' active' : '')}
                onClick={async () => {
                  try {
                    setHcStatus(await hc.setStatus(book, code));
                    toast(`Hardcover: ${label}`);
                  } catch (e) {
                    toast(e.message);
                  }
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
      )}

      {book.kind === 'discover' && (
        <section class="pad">
          <h3 class="section-label">Where to listen or read</h3>
          {!editions ? (
            <p class="muted">Searching your server, cloud, addons and free sources…</p>
          ) : ['server', 'cloud', 'addons', 'audio', 'text'].every((k) => !editions[k].length) && !sourceAddons().length ? (
            <>
              <p class="muted">
                Not found in {editions.searched.join(', ')}. Your TorBox and Real-Debrid search only covers files already in your account, so add the book there first (Settings → TorBox → add a magnet or link) or install an addon that searches for it.
              </p>
              <button class="btn ghost-wide" onClick={() => openSearch(mainTitle(book.title))}>
                <Icon name="search" size={16} /> Search everything for “{mainTitle(book.title)}”
              </button>
            </>
          ) : null}
        </section>
      )}
      {editions?.server?.length > 0 && <Row title="On your server" subtitle="Audiobookshelf" icon="server" items={editions.server} />}
      {editions?.cloud?.length > 0 && <Row title="In your cloud" subtitle="TorBox / Real-Debrid" icon="download" items={editions.cloud} />}
      {editions?.addons?.length > 0 && <Row title="From your addons" subtitle="Addon results" icon="puzzle" items={editions.addons} />}
      {book.kind === 'discover' && sourceAddons().length > 0 && (
        <SourceResults title={mainTitle(book.title)} author={(book.author || '').split(',')[0].trim()} book={book} />
      )}
      {editions?.audio?.length > 0 && <Row title="Free audiobooks" subtitle="LibriVox / Internet Archive" icon="headphones" items={editions.audio} />}
      {editions?.text?.length > 0 && <Row title="Free ebooks" subtitle="Project Gutenberg" icon="book" items={editions.text} />}

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
