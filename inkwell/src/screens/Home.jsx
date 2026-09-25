import { BgImage } from '../components/bg-image.jsx';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Row, BookCard, withMeta } from '../components/common.jsx';
import { useMeta } from '../lib/meta.js';
import { Icon } from '../components/icons.jsx';
import { ia, gb, ol, absSrc, addonSrc, cloud, hc, gr, enabled, sourceOrder, sourceRank } from '../sources/index.js';
import { Fragment } from 'preact';
import { progress, settings, addons, abs, debrid, hardcover, goodreads, useStore, persisted } from '../lib/store.js';
import { greeting, fmtDuration } from '../lib/format.js';
import { nav } from '../lib/nav.js';
import { GENRES } from './genres.js';
import { HINDI_ALL } from './hindi.js';
import { audible } from '../sources/catalogs.js';
import { waitlist, cancel, playNow } from '../lib/waitlist.js';
import { toast, Cover } from '../components/common.jsx';
import { getDetails } from '../sources/index.js';
import * as player from '../lib/player.js';

// Picks for the banner: the user's own services first; free classics only as a fallback.
// Shows the last banner instantly, then merges each service as it answers
// (a slow service never holds the others back).
const heroCache = persisted('heroCache', { items: [] });

function heroSources() {
  const list = [];
  if (absSrc.connected() && enabled('abs')) list.push([() => absSrc.inProgress(), 'Continue on your server', 'abs'], [() => absSrc.recent(), 'New on your server', 'abs']);
  if (cloud.tbConnected() && enabled('tb')) list.push([() => cloud.torboxLibrary(), 'In your TorBox', 'tb']);
  if (cloud.rdConnected() && enabled('rd')) list.push([() => cloud.realdebridLibrary(), 'In your Real-Debrid', 'rd']);
  if (hc.connected() && enabled('hc')) list.push([() => hc.shelf(hc.STATUS.reading), 'Reading on Hardcover', 'hc'], [() => hc.shelf(hc.STATUS.want), 'On your Want to Read', 'hc']);
  return list.sort((a, b) => sourceRank(a[2]) - sourceRank(b[2]));
}

function roundRobin(groups) {
  const picks = [];
  const seen = new Set();
  for (let i = 0; picks.length < 8 && groups.some((g) => g && g[i]); i++) {
    for (const g of groups) {
      const b = g && g[i];
      if (b && !seen.has(b.uid) && picks.length < 8) {
        seen.add(b.uid);
        picks.push(b);
      }
    }
  }
  return picks;
}

function HeroSlide({ book: raw, index, count, onDot }) {
  const meta = useMeta(raw);
  const b = withMeta(raw, meta);
  const playable = b.kind === 'audio';
  const touch = useRef(null);
  const swiped = useRef(false);
  return (
    <div
      class="hero"
      onTouchStart={(e) => {
        touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        swiped.current = false;
      }}
      onTouchEnd={(e) => {
        const t = touch.current;
        if (!t) return;
        const dx = e.changedTouches[0].clientX - t.x;
        const dy = e.changedTouches[0].clientY - t.y;
        if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
          swiped.current = true;
          onDot((index + (dx < 0 ? 1 : count - 1)) % count);
        }
      }}
      onClick={() => !swiped.current && nav.push('book', { book: b })}
    >
      <div class="hero-bg" key={b.uid}>
        {b.cover && <BgImage url={b.cover} />}
      </div>
      <div class="hero-body">
        <span class="hero-tag">
          <Icon name={raw.source === 'hc' ? 'book' : raw.source === 'abs' ? 'server' : raw.source === 'ia' ? 'flame' : 'download'} size={14} /> {raw.heroTag}
        </span>
        <h2>{b.title}</h2>
        <p>{b.author}</p>
        <div class="hero-actions">
          <button
            class="btn primary"
            onClick={async (e) => {
              e.stopPropagation();
              if (!playable) return nav.push('book', { book: b });
              nav.openOverlay('player');
              player.openAndPlay(b, getDetails);
            }}
          >
            <Icon name={playable ? 'play' : 'search'} size={16} /> {playable ? 'Listen' : 'Find it'}
          </button>
          <div class="dots">
            {Array.from({ length: count }, (_, k) => (
              <span
                class={k === index ? 'on' : ''}
                onClick={(e) => {
                  e.stopPropagation();
                  onDot(k);
                }}
              />
            ))}
          </div>
        </div>
      </div>
      <div class="hero-cover" key={'c' + b.uid}>
        <Cover book={b} eager />
      </div>
    </div>
  );
}

function Hero() {
  const [items, setItems] = useState(() => (heroCache.get().items.length ? heroCache.get().items : null));
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(0);
  useEffect(() => {
    const sources = heroSources();
    const groups = new Array(sources.length).fill(null);
    let alive = true;
    let pending = sources.length;
    const publish = () => {
      const picks = roundRobin(groups);
      if (!alive) return;
      if (picks.length) {
        setItems(picks);
        heroCache.set({ items: picks });
      } else if (!pending) {
        // Nothing connected (or everything failed): free classics as a fallback.
        enabled('ia') ? ia.popular().then((r) => alive && setItems(r.slice(0, 6).map((x) => ({ ...x, heroTag: 'Most loved free audiobook' })))).catch(() => alive && setItems([])) : setItems([]);
      }
    };
    if (!sources.length) return publish(), () => (alive = false);
    sources.forEach(([load, tag], k) => {
      // A slow service stops blocking the free fallback after 8s, but its books still join the banner when they arrive.
      let settled = false;
      const settle = () => {
        if (settled) return publish();
        settled = true;
        pending--;
        publish();
      };
      setTimeout(settle, 8000);
      Promise.resolve()
        .then(load)
        .then((r) => (groups[k] = (r || []).map((x) => ({ ...x, heroTag: tag }))))
        .catch(() => {})
        .finally(settle);
    });
    return () => (alive = false);
  }, []);
  useEffect(() => {
    if (!items?.length) return;
    const t = setInterval(() => setI((x) => (x + 1) % items.length), 7000);
    return () => clearInterval(t);
  }, [items, paused]);
  if (!items) return <div class="hero shimmer" />;
  if (!items.length) return null;
  return (
    <HeroSlide
      book={items[i % items.length]}
      index={i % items.length}
      count={items.length}
      onDot={(k) => {
        setI(k);
        setPaused((p) => p + 1); // restart the auto-advance timer after a manual swipe
      }}
    />
  );
}

function ContinueRow() {
  const prog = useStore(progress);
  const items = useMemo(
    () =>
      Object.entries(prog)
        .filter(([, p]) => !p.finished && p.book)
        .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
        .slice(0, 12),
    [prog]
  );
  if (!items.length) return null;
  return (
    <section class="row">
      <header class="row-head">
        <div>
          <h2>
            <Icon name="headphones" size={18} /> Continue
          </h2>
          <p>Pick up where you left off</p>
        </div>
      </header>
      <div class="row-scroll continue">
        {items.map(([uid, p]) => (
          <button
            class="continue-card"
            onClick={async () => {
              if (p.kind === 'text') return nav.push('reader', { book: p.book });
              nav.openOverlay('player');
              player.openAndPlay(p.book, getDetails);
            }}
          >
            <Cover book={p.book} />
            <div class="continue-meta">
              <b>{p.book.title}</b>
              <span>{p.kind === 'text' ? 'Reading' : p.total ? `${fmtDuration(p.total - p.global)} left` : 'Listening'}</span>
              <div class="progress-bar">
                <div style={{ width: Math.round((p.percent || 0) * 100) + '%' }} />
              </div>
            </div>
            <span class="continue-play">
              <Icon name={p.kind === 'text' ? 'book' : 'play'} size={16} />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function WaitingRow() {
  const list = useStore(waitlist);
  if (!list.length) return null;
  return (
    <section class="row">
      <header class="row-head">
        <div>
          <h2>
            <Icon name="download" size={18} /> Downloading for you
          </h2>
          <p>Plays automatically when your debrid service finishes</p>
        </div>
      </header>
      <div class="wait-list">
        {list.map((w) => (
          <div class={'wait-item' + (w.ready ? ' ready' : '')}>
            <Cover book={{ title: w.bookTitle || w.title, author: w.author, cover: w.cover }} class="wait-cover" />
            <div class="wait-meta">
              <b>{w.bookTitle || w.title}</b>
              <span>
                {w.ready ? 'Ready to play' : `${Math.round((w.progress || 0) * 100)}%${w.state ? ` · ${w.state}` : ''}`} · {w.provider === 'torbox' ? 'TorBox' : 'Real-Debrid'}
              </span>
              <div class="progress-bar">
                <div style={{ width: (w.ready ? 100 : Math.round((w.progress || 0) * 100)) + '%' }} />
              </div>
            </div>
            {w.ready ? (
              <button class="continue-play" aria-label="Play" onClick={() => playNow(w).catch((e) => toast(e.message))}>
                <Icon name="play" size={16} />
              </button>
            ) : (
              <button class="icon-btn" aria-label="Stop waiting" onClick={() => cancel(w.hash)}>
                <Icon name="close" size={18} />
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export function GenreChips() {
  return (
    <div class="genre-scroll">
      {enabled('hi') && (
        <button class="genre-chip hindi-chip" lang="hi" style={{ '--h': HINDI_ALL.hue }} onClick={() => nav.push('browse', { genre: HINDI_ALL })}>
          हिंदी
        </button>
      )}
      {GENRES.map((g) => (
        <button class="genre-chip" style={{ '--h': g.hue }} onClick={() => nav.push('browse', { genre: g })}>
          {g.name}
        </button>
      ))}
    </div>
  );
}

export function Home() {
  const st = useStore(settings);
  const addonList = useStore(addons);
  const absCfg = useStore(abs);
  const deb = useStore(debrid);
  const hcCfg = useStore(hardcover);
  const grData = useStore(goodreads);
  const [addonRows, setAddonRows] = useState([]);
  useEffect(() => {
    if (!enabled('addon')) return setAddonRows([]);
    addonSrc.catalogRows().then(setAddonRows).catch(() => setAddonRows([]));
  }, [addonList, st.sources]);

  const blocks = {
    // Hindi section: only when switched on in Settings → Sources, in the user's chosen place.
    hi: enabled('hi') && (
      <Row
        title="हिंदी ऑडियोबुक"
        subtitle="Top Hindi audiobooks · Audible India"
        icon="headphones"
        load={() => audible.hindi('')}
        deps={[]}
        onMore={() => nav.push('browse', { genre: HINDI_ALL })}
      />
    ),
    abs: absSrc.connected() && enabled('abs') && (
        <>
          <Row title="On your server" subtitle="Audiobookshelf · in progress" icon="server" load={absSrc.inProgress} deps={[absCfg.token]} showErrors />
          <Row title="Recently added" subtitle="Audiobookshelf" icon="server" load={absSrc.recent} deps={[absCfg.token, absCfg.libraryId]} onMore={() => nav.push('shelf', { title: 'Audiobookshelf', subtitle: 'Your whole library', load: absSrc.all })} showErrors emptyText="Your Audiobookshelf library looks empty." />
        </>
      ),
    tb: cloud.tbConnected() && enabled('tb') && <Row title="Your TorBox" subtitle="Audiobooks in your cloud" icon="download" load={cloud.torboxLibrary} deps={[deb.torbox]} onMore={() => nav.push('shelf', { title: 'Your TorBox', subtitle: 'Audiobooks in your TorBox cloud', load: cloud.torboxLibrary })} showErrors emptyText="No audiobooks in your TorBox yet." />,
    rd: cloud.rdConnected() && enabled('rd') && <Row title="Your Real-Debrid" subtitle="Audiobooks in your cloud" icon="download" load={cloud.realdebridLibrary} deps={[deb.realdebrid]} onMore={() => nav.push('shelf', { title: 'Your Real-Debrid', subtitle: 'Audiobooks in your Real-Debrid cloud', load: cloud.realdebridLibrary })} showErrors emptyText="No audiobooks in your Real-Debrid yet." />,
    hc: hc.connected() && enabled('hc') && (
        <>
          <Row title="Currently reading" subtitle="Hardcover" icon="book" load={() => hc.shelf(hc.STATUS.reading)} deps={[hcCfg.token]} onMore={() => nav.push('shelf', { title: 'Currently reading', subtitle: 'Hardcover', load: () => hc.shelf(hc.STATUS.reading) })} showErrors emptyText="Nothing on your Hardcover Currently Reading shelf." />
          <Row title="Want to read" subtitle="Hardcover" icon="heart" load={() => hc.shelf(hc.STATUS.want)} deps={[hcCfg.token]} onMore={() => nav.push('shelf', { title: 'Want to read', subtitle: 'Hardcover', load: () => hc.shelf(hc.STATUS.want) })} showErrors emptyText="Nothing on your Hardcover Want to Read shelf." />
          <Row title="Read" subtitle="Hardcover" icon="check" load={() => hc.shelf(hc.STATUS.read)} deps={[hcCfg.token]} onMore={() => nav.push('shelf', { title: 'Read', subtitle: 'Hardcover', load: () => hc.shelf(hc.STATUS.read) })} />
        </>
      ),
    gr: enabled('gr') && grData.books.length > 0 && (
        <>
          <Row title="Currently reading" subtitle="Goodreads" icon="book" items={gr.shelf('currently-reading')} onMore={() => nav.push('shelf', { title: 'Currently reading', subtitle: 'Goodreads', load: async () => gr.shelf('currently-reading') })} />
          <Row title="Read" subtitle="Goodreads" icon="check" items={gr.shelf('read').slice(0, 40)} />
          <Row title="Want to read" subtitle="Goodreads" icon="heart" items={gr.shelf('to-read').slice(0, 40)} onMore={() => nav.push('shelf', { title: 'Want to read', subtitle: 'Goodreads', load: async () => gr.shelf('to-read') })} />
        </>
      ),
    gb: enabled('gb') && <Row title="Classics to read" subtitle="Project Gutenberg · most downloaded" icon="book" load={() => gb.popular(st.language)} deps={[st.language]} />,
    ol: enabled('ol') && <Row title="Trending this week" subtitle="Open Library readers" icon="flame" load={() => ol.trending('weekly')} deps={[]} />,
    addon: addonRows.map((r) => (
        <Row key={r.key} title={r.title} subtitle={r.subtitle} icon="puzzle" load={r.load} deps={[r.key]} />
      )),
    ia: enabled('ia') && (
        <>
          <Row title="Most listened" subtitle="LibriVox via Internet Archive" icon="headphones" load={ia.popular} deps={[]} />
          <Row title="Fresh recordings" subtitle="Newest LibriVox releases" icon="sparkle" load={ia.newest} deps={[]} />
          <Row title="Old‑time radio" subtitle="Golden-age drama & mystery" icon="headphones" load={() => ia.query('collection:oldtimeradio', { rows: 24 })} deps={[]} />
        </>
      ),
  };
  return (
    <div class="screen home">
      <header class="home-head">
        <div>
          <p class="eyebrow">{greeting()}</p>
          <h1 class="brand brand-wordmark">Kathava</h1>
        </div>
        <button class="icon-btn glass" onClick={() => nav.tab('discover')} aria-label="Search">
          <Icon name="search" />
        </button>
      </header>

      <Hero />
      <WaitingRow />
      <ContinueRow />
      <GenreChips />

      {sourceOrder().map((k) => (
        <Fragment key={k}>{blocks[k]}</Fragment>
      ))}
      <div class="footer-space" />
    </div>
  );
}

export { BookCard };
