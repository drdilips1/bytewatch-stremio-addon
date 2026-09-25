import { useEffect, useRef, useState } from 'preact/hooks';
import { TopBar, Grid, Skeleton, Empty } from '../components/common.jsx';
import { Icon } from '../components/icons.jsx';
import { useStore } from '../lib/store.js';
import * as lb from '../sources/libby.js';

const FORMATS = [
  ['audiobook', 'Audiobooks'],
  ['ebook', 'Ebooks'],
  ['all', 'All'],
];

/** Your libraries in Libby: search and browse the whole catalogue, plus your loans and holds. */
export function LibbyBrowse({ tab: initialTab = 'catalogue' }) {
  const acct = useStore(lb.libbyAccount);
  useStore(lb.libby);
  const libs = lb.libraries();
  const [tab, setTab] = useState(initialTab);
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [format, setFormat] = useState('audiobook');
  const [available, setAvailable] = useState(false);
  const [key, setKey] = useState('');
  const [items, setItems] = useState(null);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const gen = useRef(0);

  // Search as you type (debounced).
  useEffect(() => {
    const t = setTimeout(() => setQ(query), 600);
    return () => clearTimeout(t);
  }, [query]);

  const load = async (p) => {
    const g = ++gen.current;
    setLoading(true);
    setError(null);
    try {
      const r = await lb.catalogue({ query: q, format, available, key, page: p });
      if (g !== gen.current) return;
      setItems((cur) => (p === 1 ? r.items : [...(cur || []), ...r.items.filter((b) => !(cur || []).some((c) => c.uid === b.uid))]));
      setMore(r.more);
      setPage(p);
    } catch (e) {
      if (g === gen.current) setError(e);
    } finally {
      if (g === gen.current) setLoading(false);
    }
  };
  useEffect(() => {
    if (tab !== 'catalogue') return;
    setItems(null);
    load(1);
  }, [q, format, available, key, tab, libs.map((l) => l.key).join()]);

  const loans = lb.loanBooks();
  const holds = lb.holdBooks();
  const signedIn = !!acct.identity;

  return (
    <div class="screen shelf libby-browse">
      <TopBar title={libs.length === 1 ? libs[0].name : 'Your libraries'} />
      <div class="segmented">
        <button class={tab === 'catalogue' ? 'on' : ''} onClick={() => setTab('catalogue')}>
          Catalogue
        </button>
        <button class={tab === 'loans' ? 'on' : ''} onClick={() => setTab('loans')}>
          Loans{signedIn ? ` · ${loans.length}` : ''}
        </button>
        <button class={tab === 'holds' ? 'on' : ''} onClick={() => setTab('holds')}>
          Holds{signedIn ? ` · ${holds.length}` : ''}
        </button>
      </div>

      {tab === 'catalogue' ? (
        <>
          <div class="search-box small">
            <Icon name="search" size={18} />
            <input value={query} placeholder="Search the catalogue…" onInput={(e) => setQuery(e.currentTarget.value)} />
          </div>
          <div class="chips pad libby-filters">
            {FORMATS.map(([k, label]) => (
              <button class={'pill small' + (format === k ? ' active' : '')} onClick={() => setFormat(k)}>
                {label}
              </button>
            ))}
            <button class={'pill small' + (available ? ' active' : '')} onClick={() => setAvailable(!available)}>
              Available now
            </button>
          </div>
          {libs.length > 1 && (
            <div class="chips pad libby-filters">
              <button class={'pill small' + (!key ? ' active' : '')} onClick={() => setKey('')}>
                All libraries
              </button>
              {libs.map((l) => (
                <button class={'pill small' + (key === l.key ? ' active' : '')} onClick={() => setKey(l.key)}>
                  {l.name}
                </button>
              ))}
            </div>
          )}
          {!libs.length ? (
            <Empty icon="library" title="No library yet">
              Add one in Settings → Libby.
            </Empty>
          ) : error && !items?.length ? (
            <p class="row-note bad">Couldn't load: {error.message}</p>
          ) : !items ? (
            <div class="grid">{Array.from({ length: 9 }, () => <Skeleton />)}</div>
          ) : items.length ? (
            <>
              <Grid items={items} />
              {more && (
                <div class="pad center">
                  <button class="btn" disabled={loading} onClick={() => load(page + 1)}>
                    {loading ? <span class="spinner small" /> : 'Load more'}
                  </button>
                </div>
              )}
            </>
          ) : (
            <Empty icon="search" title="Nothing found">
              {available ? 'Try without “Available now”.' : 'Try another search.'}
            </Empty>
          )}
        </>
      ) : !signedIn ? (
        <Empty icon="library" title="Sign in to Libby to see these">
          Settings → Libby → Get code, then enter the code in Libby on your phone (Menu → Copy To Another Device).
        </Empty>
      ) : (tab === 'loans' ? loans : holds).length ? (
        <Grid items={tab === 'loans' ? loans : holds} />
      ) : (
        <Empty icon="library" title={tab === 'loans' ? 'No loans' : 'No holds'}>
          {tab === 'loans' ? 'Borrow something from the catalogue.' : 'Place a hold on a title that has a waitlist.'}
        </Empty>
      )}
      <div class="footer-space" />
    </div>
  );
}
