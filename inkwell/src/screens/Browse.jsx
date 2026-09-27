import { useEffect, useState } from 'preact/hooks';
import { TopBar, Grid, Skeleton, Empty, Row } from '../components/common.jsx';
import { ia, absSrc, cloud, hc, enabled } from '../sources/index.js';
import { audible } from '../sources/catalogs.js';
import { lookup } from '../lib/meta.js';
import { library } from '../lib/store.js';
import { nav } from '../lib/nav.js';
import { HINDI_GENRES, isHindi } from './hindi.js';
import { SourceResults } from '../components/source-results.jsx';
import { sourceAddons } from '../sources/sourceaddons.js';

const TABS = [
  ['yours', 'For you'],
  ['best', 'Bestsellers'],
  ['trend', 'Trending'],
  ['top', 'Best of'],
];
const THIS_YEAR = new Date().getFullYear();
const YEARS = [THIS_YEAR, THIS_YEAR - 1, THIS_YEAR - 2, THIS_YEAR - 3, THIS_YEAR - 4, 'all'];
const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** For you: your own books in the genre, then Audible's popular, well-rated titles you don't have. */
async function forYou(genre, connected) {
  const [mine, pool] = await Promise.all([connected ? yours(genre).catch(() => []) : [], audible.pool(genre.au || genre.name).catch(() => [])]);
  const have = new Set([...mine, ...Object.values(library.get() || {})].map((b) => norm(b?.title)));
  const score = (b) => (b.rating || 4) * Math.log10((b.ratings || 0) + 10) + (b.released > Date.now() - 730 * 864e5 ? 1.5 : 0);
  const picks = pool.filter((b) => !have.has(norm(b.title))).sort((a, b) => score(b) - score(a)).slice(0, 36).map(({ rank, ...b }) => b);
  return { mine, picks };
}

const HINDI_TABS = [
  ['yours', 'आपकी किताबें'],
  ['sources', 'सोर्सेज़'],
  ['best', 'और सुझाव'],
  ['listen', 'मुफ़्त ऑडियो'],
];

const within = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);

/** Books from the user's own services that fit a genre. */
async function yours(genre) {
  const fits = (b) => (genre.hindi ? isHindi(b) : true);
  const hits = (list) => list.filter((b) => fits(b) && ((b.genres || []).some((g) => genre.match.test(g)) || genre.match.test(b.title)));
  const safe = (p) => within(p.catch(() => []), 12000).then((r) => r || []);
  const [server, shelves, tb, rd] = await Promise.all([
    absSrc.connected() && enabled('abs') ? safe(absSrc.all()) : [],
    hc.connected() && enabled('hc') ? safe(hc.allShelves()) : [],
    cloud.tbConnected() && enabled('tb') ? safe(cloud.torboxLibrary()) : [],
    cloud.rdConnected() && enabled('rd') ? safe(cloud.realdebridLibrary()) : [],
  ]);
  // Debrid files have no genres of their own: borrow them from metadata lookups (cached).
  const files = [...tb, ...rd].slice(0, 80);
  const metas = await within(Promise.all(files.map((b) => lookup(b).catch(() => null))), 20000);
  const cloudHits = files
    .map((b, i) => ({ ...b, genres: metas?.[i]?.genres || [], cover: b.cover || metas?.[i]?.cover || '', title: metas?.[i]?.title || b.title, author: metas?.[i]?.author || b.author }))
    .filter((b) => fits(b) && (b.genres.some((g) => genre.match.test(g)) || (genre.hindi && genre.match.test(b.title))));
  const seen = new Set();
  return [...hits(server), ...cloudHits, ...hits(shelves)].filter((b) => !seen.has(b.uid) && seen.add(b.uid));
}

export function Browse({ genre }) {
  const connected = absSrc.connected() || hc.connected() || cloud.tbConnected() || cloud.rdConnected();
  const [tab, setTab] = useState(genre.hindi && sourceAddons().length ? 'sources' : genre.hindi && !connected ? 'best' : 'yours');
  const [items, setItems] = useState(null);
  const [year, setYear] = useState(THIS_YEAR - 1);
  useEffect(() => {
    setItems(null);
    if (tab === 'sources') return;
    const job = genre.hindi
      ? tab === 'yours'
        ? yours(genre)
        : tab === 'best'
          ? audible.hindi(genre.au).then((r) => (genre.en === 'Hindi' && r.length > 14 ? r.slice(10) : r)) // hub: Top Shows row has the first ten
          : ia.hindi(genre.ia)
      : tab === 'yours'
        ? forYou(genre, connected)
        : tab === 'best'
          ? audible.genre(genre.au || genre.name)
          : tab === 'trend'
            ? audible.trending(genre.au || genre.name)
            : audible.bestOf(genre.au || genre.name, year);
    let alive = true;
    job.then((r) => alive && setItems(r)).catch(() => alive && setItems([]));
    return () => (alive = false);
  }, [tab, genre, year]);
  return (
    <div class="screen" style={{ '--h': genre.hue }}>
      <TopBar title={genre.name} />
      <div class="genre-banner">
        <h2>{genre.name}</h2>
        {genre.en && genre.en !== 'Hindi' && <small class="genre-en">{genre.en}</small>}
        <p>
          {genre.hindi
            ? tab === 'yours'
              ? 'Hindi books from your server, debrid libraries and Hardcover shelves.'
              : tab === 'sources'
                ? 'Hindi audiobooks found by your source addons — Play or add to TorBox / Real-Debrid.'
                : tab === 'best'
                ? 'Top Hindi audiobooks on Audible India — open one to find it in your sources.'
                : 'Free Hindi recordings on Internet Archive.'
            : tab === 'yours'
            ? connected
              ? "Your books in this genre, then popular, well-rated picks from Audible you don't have yet."
              : "Popular, well-rated picks from Audible — open one to find it in your debrid or addons."
            : tab === 'best'
              ? 'Top audiobooks — open one to find it in your debrid or addons.'
              : tab === 'trend'
                ? 'Popular new releases from the last year and a half.'
                : `The best-rated popular titles${year === 'all' ? ' of all time' : ` released in ${year}`}.`}
        </p>
      </div>
      {genre.en === 'Hindi' && enabled('au') && (
        <Row title="टॉप शोज़" subtitle="Top Hindi audiobooks right now · Audible India" icon="flame" load={() => audible.hindi('').then((r) => r.slice(0, 10))} deps={[]} />
      )}
      {genre.hindi && (
        <div class="genre-scroll hindi-cats" lang="hi">
          {HINDI_GENRES.filter((g) => g.name !== genre.name).map((g) => (
            <button class="genre-chip" style={{ '--h': g.hue }} onClick={() => nav.push('browse', { genre: g })}>
              {g.name}
            </button>
          ))}
        </div>
      )}
      <div class="segmented scroll">
        {(genre.hindi ? HINDI_TABS : TABS).filter(([k]) => (k !== 'yours' || connected || !genre.hindi) && (k !== 'sources' || sourceAddons().length > 0)).map(([k, label]) => (
          <button class={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'top' && !genre.hindi && (
        <div class="chips year-chips">
          {YEARS.map((y) => (
            <button class={'pill small' + (year === y ? ' active' : '')} onClick={() => setYear(y)}>
              {y === 'all' ? 'All time' : y}
            </button>
          ))}
        </div>
      )}
      {tab === 'sources' ? (
        <SourceResults query={`hindi ${genre.en === 'Hindi' ? 'audiobook' : genre.en}`} heading={false} />
      ) : items === null ? (
        <div class="grid">{Array.from({ length: 9 }, () => <Skeleton />)}</div>
      ) : items.mine ? (
        items.mine.length || items.picks.length ? (
          <>
            {items.mine.length > 0 && (
              <>
                <h3 class="section-label pad">In your collection</h3>
                <Grid items={items.mine} />
              </>
            )}
            {items.picks.length > 0 && (
              <>
                <h3 class="section-label pad">Recommended for you</h3>
                <Grid items={items.picks} />
              </>
            )}
          </>
        ) : (
          <Empty title="Nothing here yet">Try Bestsellers or another genre.</Empty>
        )
      ) : items.length ? (
        <Grid items={items} />
      ) : (
        <Empty title="Nothing here yet">
          {tab === 'yours' ? `None of your books are tagged with this genre yet. Try ${genre.hindi ? 'Audible India' : 'Bestsellers'}.` : 'Try another tab or genre.'}
        </Empty>
      )}
      <div class="footer-space" />
    </div>
  );
}
