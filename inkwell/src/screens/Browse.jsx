import { useEffect, useState } from 'preact/hooks';
import { TopBar, Grid, Skeleton, Empty } from '../components/common.jsx';
import { ia, gb, ol, enabled } from '../sources/index.js';
import { settings } from '../lib/store.js';

const TABS = [
  ['listen', 'Listen'],
  ['read', 'Read'],
  ['discover', 'Discover'],
];

export function Browse({ genre }) {
  const [tab, setTab] = useState(enabled('ia') ? 'listen' : 'read');
  const [items, setItems] = useState(null);
  useEffect(() => {
    setItems(null);
    const lang = settings.get().language;
    const job =
      tab === 'listen'
        ? genre.ia.startsWith('collection:')
          ? ia.query(genre.ia, { rows: 40 })
          : ia.query(`collection:librivoxaudio AND subject:(${genre.ia})`, { rows: 40 })
        : tab === 'read'
          ? gb.byTopic(genre.gb, lang)
          : ol.subject(genre.ol);
    job.then(setItems).catch(() => setItems([]));
  }, [tab, genre]);
  return (
    <div class="screen" style={{ '--h': genre.hue }}>
      <TopBar title={genre.name} />
      <div class="genre-banner">
        <h2>{genre.name}</h2>
        <p>Free to listen and read — public domain classics and more.</p>
      </div>
      <div class="segmented">
        {TABS.map(([k, label]) => (
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
        <Empty title="Nothing here yet">Try another tab or genre.</Empty>
      )}
      <div class="footer-space" />
    </div>
  );
}
