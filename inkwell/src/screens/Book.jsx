import { BgImage } from '../components/bg-image.jsx';
import { useEffect, useState } from 'preact/hooks';
import { Cover, SourceBadge, Row, toast } from '../components/common.jsx';
import { Icon } from '../components/icons.jsx';
import { getDetails, findEditions, ia, hc, sourceOf } from '../sources/index.js';
import { library, progress, toggleLibrary, useStore } from '../lib/store.js';
import { fmtDuration, fmtTime } from '../lib/format.js';
import { nav } from '../lib/nav.js';
import * as qb from '../sources/qbit.js';
import { canSendToKindle, sendToKindle } from '../lib/kindle.js';
import { openSearch } from './Discover.jsx';
import { mainTitle } from '../lib/match.js';
import { SourceResults } from '../components/source-results.jsx';
import { narrate, canNarrate } from '../sources/ttsbooks.js';
import { downloads, canDownload, downloadBook, cancelDownload, removeDownload, fmtBytes } from '../lib/downloads.js';
import { sourceAddons } from '../sources/sourceaddons.js';
import * as player from '../lib/player.js';
import { usePlayer, useCoverColor } from '../components/player-ui.jsx';
import { RelatedRows } from '../components/related.jsx';
import { storyshots, loadStoryShots, storyshotsSearchUrl, openUrl, openExternal, STORYSHOTS_HOME } from '../sources/summaries.js';

// Books you already have (cloud, server, addons) can still show other copies from source addons.
const OTHER_SOURCES = new Set(['tb', 'rd', 'abs', 'addon']);

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
  const [showParts, setShowParts] = useState(null);
  const [qbBusy, setQbBusy] = useState(false);
  const [kindleBusy, setKindleBusy] = useState(false);
  useStore(qb.qbitSent);
  const dl = useStore(downloads)[initial.uid];

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
  const partsOpen = showParts ?? tracks.length <= 5;
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
            {book.rating > 0 && (
              <span class="rating-chip">
                <Icon name="star" size={12} /> {book.rating.toFixed(1)}
                {book.ratings > 0 && ` · ${book.ratings.toLocaleString()} ratings`}
              </span>
            )}
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
        {canSendToKindle(book) && (
          <button
            class="btn secondary big kindle-btn"
            disabled={kindleBusy}
            onClick={async () => {
              setKindleBusy(true);
              try {
                await sendToKindle(book);
              } catch (e) {
                toast(e.message);
              } finally {
                setKindleBusy(false);
              }
            }}
          >
            {kindleBusy ? <span class="spinner" /> : <Icon name="upload" size={18} />} Send to Kindle
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
              if (!canNarrate()) return nav.push('reader', { book, readAloud: true });
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
      {canListen && canDownload && book.source !== 'tts' && (
        <div class="dl-row">
          {!dl || dl.status === 'error' ? (
            <button
              class="btn secondary"
              disabled={loading && !book.tracks && !book.resolveTracks}
              onClick={() => downloadBook(book).then(() => toast('Downloaded — plays offline now')).catch((e) => e.message !== 'cancelled' && toast(e.message))}
            >
              <Icon name="download" size={16} /> {dl?.status === 'error' ? 'Retry download' : 'Download for offline'}
            </button>
          ) : dl.status === 'done' ? (
            <>
              <span class="dl-done">
                <Icon name="check" size={16} /> Downloaded · {fmtBytes(dl.bytes)} · {dl.location || 'on this phone'}
              </span>
              <button class="link-btn" onClick={() => removeDownload(book.uid).then(() => toast('Download removed'))}>
                Remove
              </button>
            </>
          ) : (
            <>
              <div class="dl-progress">
                <span>
                  Downloading part {Math.min((dl.done || 0) + 1, dl.total || 1)} of {dl.total || '…'}
                  {dl.currentTotal > 0 ? ` · ${Math.round((dl.current / dl.currentTotal) * 100)}%` : ''}
                </span>
                <div class="progress-bar">
                  <div style={{ width: `${dl.total ? (((dl.done || 0) + (dl.currentTotal ? dl.current / dl.currentTotal : 0)) / dl.total) * 100 : 2}%` }} />
                </div>
              </div>
              <button class="link-btn" onClick={() => cancelDownload(book.uid)}>
                Cancel
              </button>
            </>
          )}
          {dl?.status === 'error' && <small class="err">{dl.error}</small>}
        </div>
      )}
      {book.hash && (book.source === 'tb' || book.source === 'rd') && qb.available && (
        <div class="pad qbit-send">
          <button
            class="pill"
            disabled={qbBusy}
            onClick={async () => {
              if (!qb.configured()) return toast('Set up your home server first (Settings → Home server)');
              setQbBusy(true);
              try {
                toast(await qb.send(book));
              } catch (e) {
                toast(e.message);
              } finally {
                setQbBusy(false);
              }
            }}
          >
            {qbBusy ? <span class="spinner small" /> : <Icon name="server" size={14} />} {qb.wasSent(book.hash) ? 'Sent to home server · send again' : 'Send to home server'}
          </button>
        </div>
      )}
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
      {((book.kind === 'audio' && OTHER_SOURCES.has(book.source)) || book.kind === 'text') && sourceAddons().length > 0 && !loading && (
        <section class="pad">
          <h3 class="section-label">
            <Icon name="puzzle" size={16} /> Other sources
          </h3>
          <SourceResults title={mainTitle(book.title)} author={(book.author || '').split(',')[0].trim()} book={book} heading={false} />
        </section>
      )}
      {editions?.audio?.length > 0 && <Row title="Free audiobooks" subtitle="LibriVox / Internet Archive" icon="headphones" items={editions.audio} />}
      {editions?.text?.length > 0 && <Row title="Free ebooks" subtitle="Project Gutenberg" icon="book" items={editions.text} />}

      {tracks.length > 0 && (
        <section class="pad">
          <button class="section-label parts-toggle" onClick={() => setShowParts(!partsOpen)}>
            <Icon name="library" size={16} /> {tracks.length} {tracks.length === 1 ? 'part' : 'parts'}
            {tracks.length > 5 && <Icon name={partsOpen ? 'up' : 'down'} size={16} />}
          </button>
          <ol class="chapter-list flat">
            {tracks.map((t, i) => {
              // Folded: only the part you're on (or the first) is listed.
              const here = isCurrent ? ps.index : prog?.track || 0;
              if (!partsOpen && i !== here) return null;
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
      {!loading && book.source !== 'ss' && <Summaries book={book} />}
      {!loading && <RelatedRows book={book} />}
      <div class="footer-space" />
    </div>
  );
}

/** StoryShots summary shown right here (with their narration when available). */
function Summaries({ book }) {
  const [ss, setSs] = useState(undefined); // undefined = loading, null = none
  const [doc, setDoc] = useState(null); // { html, audio } | { error }
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    setSs(undefined);
    setDoc(null);
    setOpen(false);
    storyshots(book).then((r) => {
      if (!alive) return;
      setSs(r);
      if (r) loadStoryShots(r).then((d) => alive && setDoc(d)).catch((e) => alive && setDoc({ error: e.message }));
    });
    return () => (alive = false);
  }, [book.uid]);

  const playOriginal = () => {
    nav.openOverlay('player');
    player.playBook({
      uid: 'ssa:' + ss.link,
      source: 'ss',
      kind: 'audio',
      title: doc.title || ss.title,
      author: book.author || '',
      cover: book.cover || '',
      tracks: doc.audio.map((url, i) => ({ title: doc.audio.length > 1 ? `Part ${i + 1}` : 'Summary', url, index: i })),
    });
  };

  return (
    <section class="pad summaries">
      <h3 class="section-label">
        <Icon name="text" size={16} /> Book summaries
      </h3>
      <div class="sum-card">
        <div class="sum-head">
          <b>StoryShots</b>
          {(ss === undefined || (ss && !doc)) && <span class="spinner small" />}
        </div>
        {ss && doc && !doc.error && (
          <>
            <div class={'sum-text reader-text' + (open ? ' open' : '')} dangerouslySetInnerHTML={{ __html: doc.html }} />
            <div class="sum-actions">
              <button class="pill" onClick={() => setOpen(!open)}>
                <Icon name="book" size={14} /> {open ? 'Show less' : 'Read full summary'}
              </button>
              {doc.audio?.length > 0 ? (
                <button class="pill" onClick={playOriginal}>
                  <Icon name="headphones" size={14} /> StoryShots audio
                </button>
              ) : (
                <button class="pill ghost" onClick={() => nav.push('reader', { book: ss, readAloud: true })}>
                  <Icon name="headphones" size={14} /> Listen (built-in voice)
                </button>
              )}
            </div>
          </>
        )}
        {ss && doc?.error && <p class="muted">{doc.error}</p>}
        {ss === null && <p class="muted">No StoryShots summary found for this title.</p>}
        {ss !== undefined && (
          <div class="sum-actions">
            <button class="pill ghost" onClick={() => openUrl(ss?.link || storyshotsSearchUrl(book), 'StoryShots')}>
              <Icon name="external" size={14} /> {ss ? 'Open on StoryShots' : 'Search StoryShots'}
            </button>
            <button class="pill ghost" onClick={() => openUrl(STORYSHOTS_HOME, 'StoryShots')}>
              Sign in
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

