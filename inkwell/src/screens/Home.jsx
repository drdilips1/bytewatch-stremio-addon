import { useEffect, useMemo, useState } from 'preact/hooks';
import { Row, Cover, BookCard } from '../components/common.jsx';
import { Icon } from '../components/icons.jsx';
import { ia, gb, ol, absSrc, addonSrc, cloud, hc, gr, enabled } from '../sources/index.js';
import { progress, settings, addons, abs, debrid, hardcover, goodreads, useStore } from '../lib/store.js';
import { greeting, fmtDuration } from '../lib/format.js';
import { nav } from '../lib/nav.js';
import { GENRES } from './genres.js';
import { getDetails } from '../sources/index.js';
import * as player from '../lib/player.js';

function Hero() {
  const [items, setItems] = useState(null);
  const [i, setI] = useState(0);
  useEffect(() => {
    ia.popular().then((r) => setItems(r.slice(0, 6))).catch(() => setItems([]));
  }, []);
  useEffect(() => {
    if (!items?.length) return;
    const t = setInterval(() => setI((x) => (x + 1) % items.length), 6000);
    return () => clearInterval(t);
  }, [items]);
  if (!items) return <div class="hero shimmer" />;
  if (!items.length) return null;
  const b = items[i];
  return (
    <div class="hero" onClick={() => nav.push('book', { book: b })}>
      <div class="hero-bg" key={b.uid}>
        <img src={b.cover} alt="" />
      </div>
      <div class="hero-body">
        <span class="hero-tag">
          <Icon name="flame" size={14} /> Most loved audiobook
        </span>
        <h2>{b.title}</h2>
        <p>{b.author}</p>
        <div class="hero-actions">
          <button
            class="btn primary"
            onClick={async (e) => {
              e.stopPropagation();
              nav.openOverlay('player');
              player.playBook(await getDetails(b));
            }}
          >
            <Icon name="play" size={16} /> Listen free
          </button>
          <div class="dots">
            {items.map((_, k) => (
              <span class={k === i ? 'on' : ''} />
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
              player.playBook(await getDetails(p.book));
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

export function GenreChips() {
  return (
    <div class="genre-scroll">
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

  return (
    <div class="screen home">
      <header class="home-head">
        <div>
          <p class="eyebrow">{greeting()}</p>
          <h1 class="brand">
            Ink<span>well</span>
          </h1>
        </div>
        <button class="icon-btn glass" onClick={() => nav.tab('discover')} aria-label="Search">
          <Icon name="search" />
        </button>
      </header>

      {enabled('ia') && <Hero />}
      <ContinueRow />
      <GenreChips />

      {absSrc.connected() && enabled('abs') && (
        <>
          <Row title="On your server" subtitle="Audiobookshelf · in progress" icon="server" load={absSrc.inProgress} deps={[absCfg.token]} />
          <Row title="Recently added" subtitle="Audiobookshelf" icon="server" load={absSrc.recent} deps={[absCfg.token, absCfg.libraryId]} />
        </>
      )}
      {cloud.tbConnected() && enabled('tb') && <Row title="Your TorBox" subtitle="Audiobooks in your cloud" icon="download" load={cloud.torboxLibrary} deps={[deb.torbox]} />}
      {cloud.rdConnected() && enabled('rd') && <Row title="Your Real-Debrid" subtitle="Audiobooks in your cloud" icon="download" load={cloud.realdebridLibrary} deps={[deb.realdebrid]} />}
      {hc.connected() && enabled('hc') && (
        <>
          <Row title="Currently reading" subtitle="Hardcover" icon="book" load={() => hc.shelf(hc.STATUS.reading)} deps={[hcCfg.token]} />
          <Row title="Want to read" subtitle="Hardcover" icon="heart" load={() => hc.shelf(hc.STATUS.want)} deps={[hcCfg.token]} />
        </>
      )}
      {enabled('gr') && grData.books.length > 0 && (
        <>
          <Row title="Currently reading" subtitle="Goodreads" icon="book" items={gr.shelf('currently-reading')} />
          <Row title="Want to read" subtitle="Goodreads" icon="heart" items={gr.shelf('to-read').slice(0, 40)} />
        </>
      )}
      {enabled('ia') && <Row title="Most listened" subtitle="LibriVox via Internet Archive" icon="headphones" load={ia.popular} deps={[]} />}
      {enabled('gb') && <Row title="Classics to read" subtitle="Project Gutenberg · most downloaded" icon="book" load={() => gb.popular(st.language)} deps={[st.language]} />}
      {enabled('ol') && <Row title="Trending this week" subtitle="Open Library readers" icon="flame" load={() => ol.trending('weekly')} deps={[]} />}
      {enabled('ia') && <Row title="Fresh recordings" subtitle="Newest LibriVox releases" icon="sparkle" load={ia.newest} deps={[]} />}
      {addonRows.map((r) => (
        <Row key={r.key} title={r.title} subtitle={r.subtitle} icon="puzzle" load={r.load} deps={[r.key]} />
      ))}
      {enabled('ia') && <Row title="Old‑time radio" subtitle="Golden-age drama & mystery" icon="headphones" load={() => ia.query('collection:oldtimeradio', { rows: 24 })} deps={[]} />}
      <div class="footer-space" />
    </div>
  );
}

export { BookCard };
