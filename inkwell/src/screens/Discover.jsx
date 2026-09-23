import { useEffect, useRef, useState } from 'preact/hooks';
import { Grid, Empty, Skeleton } from '../components/common.jsx';
import { Icon } from '../components/icons.jsx';
import { searchAll, SOURCES } from '../sources/index.js';
import { persisted, useStore } from '../lib/store.js';
import { GenreChips } from './Home.jsx';

const recent = persisted('recentSearches', []);
const FILTERS = [
  ['all', 'All'],
  ['audio', 'Listen'],
  ['text', 'Read'],
  ['discover', 'Discover'],
];

export function Discover() {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [results, setResults] = useState({});
  const [pending, setPending] = useState(0);
  const [filter, setFilter] = useState('all');
  const history = useStore(recent);
  const inputRef = useRef();

  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 450);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (term.length < 2) return setResults({});
    let alive = true;
    setResults({});
    setPending(1);
    searchAll(term, (src, items, err) => {
      if (!alive) return;
      setResults((r) => ({ ...r, [src]: { items, err } }));
    }).then(() => alive && setPending(0));
    return () => (alive = false);
  }, [term]);

  const commit = () => {
    if (term.length < 2) return;
    recent.set((h) => [term, ...h.filter((x) => x.toLowerCase() !== term.toLowerCase())].slice(0, 8));
  };

  const groups = Object.entries(results)
    .map(([src, r]) => [src, r.items.filter((b) => filter === 'all' || b.kind === filter)])
    .filter(([, items]) => items.length);
  const total = groups.reduce((a, [, i]) => a + i.length, 0);

  return (
    <div class="screen discover">
      <h1 class="screen-title">Discover</h1>
      <div class="search-box">
        <Icon name="search" size={20} />
        <input
          ref={inputRef}
          value={q}
          placeholder="Titles, authors, subjects…"
          onInput={(e) => setQ(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && (commit(), e.currentTarget.blur())}
          onBlur={commit}
          enterkeyhint="search"
        />
        {q && (
          <button class="icon-btn" onClick={() => (setQ(''), inputRef.current?.focus())} aria-label="Clear">
            <Icon name="close" size={18} />
          </button>
        )}
      </div>

      {term.length < 2 ? (
        <>
          {history.length > 0 && (
            <section class="recent">
              <h3>Recent</h3>
              <div class="chips">
                {history.map((h) => (
                  <button class="pill" onClick={() => setQ(h)}>
                    {h}
                  </button>
                ))}
                <button class="pill ghost" onClick={() => recent.set([])}>
                  Clear
                </button>
              </div>
            </section>
          )}
          <h3 class="section-label">Browse genres</h3>
          <div class="genre-grid">
            <GenreChips />
          </div>
          <h3 class="section-label">Sources</h3>
          <div class="source-cards">
            {Object.entries(SOURCES).map(([k, s]) => (
              <div class="source-card" style={{ '--h': s.hue }}>
                <b>{s.name}</b>
                <span>{s.blurb}</span>
                <em>{s.kind}</em>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <div class="segmented">
            {FILTERS.map(([k, label]) => (
              <button class={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
                {label}
              </button>
            ))}
          </div>
          {pending > 0 && !total && <div class="grid">{Array.from({ length: 6 }, () => <Skeleton />)}</div>}
          {groups.map(([src, items]) => (
            <section class="result-group">
              <h3 class="section-label" style={{ '--h': SOURCES[src].hue }}>
                <span class="dot" /> {SOURCES[src].name} <small>{items.length}</small>
              </h3>
              <Grid items={items} />
            </section>
          ))}
          {!pending && !total && (
            <Empty icon="search" title="No matches">
              Nothing found for “{term}”. Try an author's surname or a shorter title.
            </Empty>
          )}
        </>
      )}
      <div class="footer-space" />
    </div>
  );
}
