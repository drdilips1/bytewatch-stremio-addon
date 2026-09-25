import { useEffect, useState } from 'preact/hooks';
import { TopBar, Grid, Skeleton, Empty, Row } from '../components/common.jsx';
import { ia, gb, ol, absSrc, cloud, hc, enabled } from '../sources/index.js';
import { audible } from '../sources/catalogs.js';
import { lookup } from '../lib/meta.js';
import { settings } from '../lib/store.js';
import { nav } from '../lib/nav.js';
import { HINDI_GENRES, isHindi } from './hindi.js';

const TABS = [
  ['yours', 'For you'],
  ['best', 'Bestsellers'],
  ['listen', 'Free audio'],
  ['read', 'Free ebooks'],
];

const HINDI_TABS = [
  ['yours', 'आपकी किताबें'],
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
  const [tab, setTab] = useState(connected ? 'yours' : 'best');
  const [items, setItems] = useState(null);
  useEffect(() => {
    setItems(null);
    const lang = settings.get().language;
    const job = genre.hindi
      ? tab === 'yours'
        ? yours(genre)
        : tab === 'best'
          ? audible.hindi(genre.au).then((r) => (genre.en === 'Hindi' && r.length > 14 ? r.slice(10) : r)) // hub: Top Shows row has the first ten
          : ia.hindi(genre.ia)
      : tab === 'yours'
        ? yours(genre)
        : tab === 'best'
          ? audible.genre(genre.name)
          : tab === 'listen'
            ? genre.ia.startsWith('collection:')
              ? ia.query(genre.ia, { rows: 40 })
              : ia.query(`collection:librivoxaudio AND subject:(${genre.ia})`, { rows: 40 })
            : gb.byTopic(genre.gb, lang).catch(() => ol.subject(genre.ol));
    let alive = true;
    job.then((r) => alive && setItems(r)).catch(() => alive && setItems([]));
    return () => (alive = false);
  }, [tab, genre]);
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
              : tab === 'best'
                ? 'Top Hindi audiobooks on Audible India — open one to find it in your sources.'
                : 'Free Hindi recordings on Internet Archive.'
            : tab === 'yours'
            ? 'From your server, debrid libraries and Hardcover shelves.'
            : tab === 'best'
              ? 'Top audiobooks — open one to find it in your debrid or addons.'
              : 'Free public-domain classics.'}
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
        {(genre.hindi ? HINDI_TABS : TABS).filter(([k]) => k !== 'yours' || connected).map(([k, label]) => (
          <button class={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {items === null ? (
        <div class="grid">{Array.from({ length: 9 }, () => <Skeleton />)}</div>
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
