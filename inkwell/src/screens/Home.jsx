import { BgImage } from '../components/bg-image.jsx';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { Row, BookCard, withMeta } from '../components/common.jsx';
import { useMeta } from '../lib/meta.js';
import { Icon } from '../components/icons.jsx';
import { ia, gb, ol, absSrc, addonSrc, cloud, hc, gr, enabled } from '../sources/index.js';
import { progress, settings, addons, abs, debrid, hardcover, goodreads, useStore } from '../lib/store.js';
import { greeting, fmtDuration } from '../lib/format.js';
import { nav } from '../lib/nav.js';
import { GENRES } from './genres.js';
import { waitlist, cancel, playNow } from '../lib/waitlist.js';
import { toast, Cover } from '../components/common.jsx';
import { getDetails } from '../sources/index.js';
import * as player from '../lib/player.js';

// Picks for the banner: the user's own services first; free classics only as a fallback.
async function heroPicks() {
  const safe = (p, tag) => p.then((r) => r.map((b) => ({ ...b, heroTag: tag }))).catch(() => []);
  const groups = await Promise.all([
    absSrc.connected() && enabled('abs') ? safe(absSrc.inProgress(), 'Continue on your server') : [],
    cloud.tbConnected() && enabled('tb') ? safe(cloud.torboxLibrary(), 'In your TorBox') : [],
    cloud.rdConnected() && enabled('rd') ? safe(cloud.realdebridLibrary(), 'In your Real-Debrid') : [],
    hc.connected() && enabled('hc') ? safe(hc.shelf(hc.STATUS.reading), 'Reading on Hardcover') : [],
    hc.connected() && enabled('hc') ? safe(hc.shelf(hc.STATUS.want), 'On your Want to Read') : [],
    absSrc.connected() && enabled('abs') ? safe(absSrc.recent(), 'New on your server') : [],
  ]);
  // Round-robin across sources so every service shows up.
  const picks = [];
  const seen = new Set();
  for (let i = 0; picks.length < 8 && groups.some((g) => g[i]); i++) {
    for (const g of groups) {
      const b = g[i];
      if (b && !seen.has(b.uid) && picks.length < 8) {
        seen.add(b.uid);
        picks.push(b);
      }
    }
  }
  if (picks.length) return picks;
  return enabled('ia') ? safe(ia.popular(), 'Most loved free audiobook').then((r) => r.slice(0, 6)) : [];
}

function HeroSlide({ book: raw, index, count, onDot }) {
  const meta = useMeta(raw);
  const b = withMeta(raw, meta);
  const playable = b.kind === 'audio';
  return (
    <div class="hero" onClick={() => nav.push('book', { book: b })}>
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
              player.playBook(await getDetails(b));
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
  const [items, setItems] = useState(null);
  const [i, setI] = useState(0);
  useEffect(() => {
    heroPicks().then(setItems).catch(() => setItems([]));
  }, []);
  useEffect(() => {
    if (!items?.length) return;
    const t = setInterval(() => setI((x) => (x + 1) % items.length), 7000);
    return () => clearInterval(t);
  }, [items]);
  if (!items) return <div class="hero shimmer" />;
  if (!items.length) return null;
  return <HeroSlide book={items[i % items.length]} index={i % items.length} count={items.length} onDot={setI} />;
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

      <Hero />
      <WaitingRow />
      <ContinueRow />
      <GenreChips />

      {absSrc.connected() && enabled('abs') && (
        <>
          <Row title="On your server" subtitle="Audiobookshelf · in progress" icon="server" load={absSrc.inProgress} deps={[absCfg.token]} showErrors />
          <Row title="Recently added" subtitle="Audiobookshelf" icon="server" load={absSrc.recent} deps={[absCfg.token, absCfg.libraryId]} onMore={() => nav.push('shelf', { title: 'Audiobookshelf', subtitle: 'Your whole library', load: absSrc.all })} showErrors emptyText="Your Audiobookshelf library looks empty." />
        </>
      )}
      {cloud.tbConnected() && enabled('tb') && <Row title="Your TorBox" subtitle="Audiobooks in your cloud" icon="download" load={cloud.torboxLibrary} deps={[deb.torbox]} onMore={() => nav.push('shelf', { title: 'Your TorBox', subtitle: 'Audiobooks in your TorBox cloud', load: cloud.torboxLibrary })} showErrors emptyText="No audiobooks in your TorBox yet." />}
      {cloud.rdConnected() && enabled('rd') && <Row title="Your Real-Debrid" subtitle="Audiobooks in your cloud" icon="download" load={cloud.realdebridLibrary} deps={[deb.realdebrid]} onMore={() => nav.push('shelf', { title: 'Your Real-Debrid', subtitle: 'Audiobooks in your Real-Debrid cloud', load: cloud.realdebridLibrary })} showErrors emptyText="No audiobooks in your Real-Debrid yet." />}
      {hc.connected() && enabled('hc') && (
        <>
          <Row title="Currently reading" subtitle="Hardcover" icon="book" load={() => hc.shelf(hc.STATUS.reading)} deps={[hcCfg.token]} onMore={() => nav.push('shelf', { title: 'Currently reading', subtitle: 'Hardcover', load: () => hc.shelf(hc.STATUS.reading) })} showErrors emptyText="Nothing on your Hardcover Currently Reading shelf." />
          <Row title="Want to read" subtitle="Hardcover" icon="heart" load={() => hc.shelf(hc.STATUS.want)} deps={[hcCfg.token]} onMore={() => nav.push('shelf', { title: 'Want to read', subtitle: 'Hardcover', load: () => hc.shelf(hc.STATUS.want) })} showErrors emptyText="Nothing on your Hardcover Want to Read shelf." />
          <Row title="Read" subtitle="Hardcover" icon="check" load={() => hc.shelf(hc.STATUS.read)} deps={[hcCfg.token]} onMore={() => nav.push('shelf', { title: 'Read', subtitle: 'Hardcover', load: () => hc.shelf(hc.STATUS.read) })} />
        </>
      )}
      {enabled('gr') && grData.books.length > 0 && (
        <>
          <Row title="Currently reading" subtitle="Goodreads" icon="book" items={gr.shelf('currently-reading')} onMore={() => nav.push('shelf', { title: 'Currently reading', subtitle: 'Goodreads', load: async () => gr.shelf('currently-reading') })} />
          <Row title="Want to read" subtitle="Goodreads" icon="heart" items={gr.shelf('to-read').slice(0, 40)} onMore={() => nav.push('shelf', { title: 'Want to read', subtitle: 'Goodreads', load: async () => gr.shelf('to-read') })} />
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
