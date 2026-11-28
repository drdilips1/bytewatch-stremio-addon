// Discover, browsing (nothing typed): five tabs — For you, Moods, Genres, Lists, Free classics — each section
// with the same head (icon, title, See all), covers on the card edge, equal-width chips.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { Row, Cover, Skeleton, Grid, cachedRow } from './common.jsx';
import { Icon } from './icons.jsx';
import { persisted, useStore, progress, settings } from '../lib/store.js';
import { nav } from '../lib/nav.js';
import { mainTitle, matches } from '../lib/match.js';
import { rankForYou, fitsHours, scoreBook } from '../lib/taste.js';
import { anchorBooks, tasteShelves } from '../lib/shelves.js';
import { seriesOf, seriesBooks, statusIn, nextIn } from '../lib/series.js';
import { fixFor } from '../lib/meta.js';
import { audible } from '../sources/catalogs.js';
import { absSrc } from '../sources/index.js';
import { localCfg } from '../sources/local.js';
import * as itunes from '../sources/itunes.js';
import { recommendedForYou, topicPool, tasteTopics, notOwned } from '../screens/Home.jsx';
import { GENRES } from '../screens/genres.js';

export const discTab = persisted('discoverTab', 'you');
const TABS = [
  ['you', 'For you'],
  ['moods', 'Moods'],
  ['genres', 'Genres'],
  ['lists', 'Lists'],
  ['free', 'Free'],
];

/** The section head used everywhere on Discover: icon, title, See all →, and a note under it. */
function Head({ icon, title, note, onMore, more = 'See all' }) {
  return (
    <>
      <div class="d-head">
        <span class="d-ico">
          <Icon name={icon} size={20} />
        </span>
        <h3>{title}</h3>
        {onMore && (
          <button class="d-more" onClick={onMore}>
            {more} <Icon name="arrow" size={15} />
          </button>
        )}
      </div>
      {note && <p class="d-note">{note}</p>}
    </>
  );
}

// ---- shared lists ---------------------------------------------------------------
const FICTION = /fiction|romance|fantasy|thriller|mystery|suspense|horror|teen|young adult|children|erotica|sci-fi|science fiction|litrpg|graphic novel|comics/i;
const isFiction = (b) => (b.genres || []).some((g) => FICTION.test(g));

export async function trending() {
  const now = Date.now();
  const all = notOwned(await topicPool());
  const fresh = all.filter((b) => b.released && b.released >= now - 548 * 864e5);
  return (fresh.length >= 8 ? fresh : all).slice(0, 30).map(({ rank, ...b }) => b);
}

// Each mood is a shelf: Audible best sellers for a few keywords, ranked for your taste, kept 12 hours.
const moodCache = persisted('moodShelves', {}, { delay: 2000 });
const KEEP = ['uid', 'source', 'kind', 'title', 'author', 'narrator', 'cover', 'duration', 'rating', 'ratings', 'genres', 'year', 'released', 'link', 'match', 'why'];
const slimBook = (b) => Object.fromEntries(KEEP.filter((k) => b[k] !== undefined && b[k] !== '').map((k) => [k, k === 'genres' ? b[k].slice(0, 6) : b[k]]));
const byRating = (a, b) => (b.rating || 0) * Math.log10((b.ratings || 0) + 10) - (a.rating || 0) * Math.log10((a.ratings || 0) + 10);
export const moodShelf = (keys, { hours, sort } = {}) => {
  const list = () => (typeof keys === 'function' ? keys() : keys);
  const fetchList = async () => {
    const lists = await Promise.all(list().map((k) => audible.genre(k).catch(() => [])));
    const seen = new Set();
    const all = [];
    for (let i = 0; i < 40; i++)
      for (const p of lists) {
        const b = p[i];
        if (b && !seen.has(b.uid)) seen.add(b.uid) && all.push(b);
      }
    let out = notOwned(all).filter((b) => fitsHours(b, hours));
    const ranked = rankForYou(out);
    out = ranked.length >= 8 ? ranked : out;
    if (sort) out = [...out].sort(sort);
    return out.slice(0, 60).map(({ rank, ...b }) => slimBook(b));
  };
  return async () => {
    const id = list().join('|') + (hours || '');
    const hit = moodCache.get()[id];
    const save = (items) => items.length && moodCache.set((c) => ({ ...c, [id]: { t: Date.now(), items } }));
    if (hit?.items?.length) {
      if (Date.now() - hit.t > 12 * 3600e3) fetchList().then(save).catch(() => {});
      return hit.items;
    }
    const items = await fetchList();
    save(items);
    return items;
  };
};
const tagged = (list) => list.map((b) => (b.match ? { ...b, tag: `${b.match}% match` } : b));

/** Books on your server or this phone you've never started, best match first. */
async function hiddenGems() {
  const prog = progress.get();
  const started = Object.values(prog).filter((p) => p?.book?.title);
  const have = [...(absSrc.connected() ? await absSrc.all().catch(() => []) : []), ...(localCfg.get().books || []).filter((b) => b.kind !== 'text')];
  const seen = new Set();
  const out = [];
  for (const b0 of have) {
    if (!b0?.title || prog[b0.uid]) continue;
    const fix = fixFor(b0.uid);
    const b = fix?.title ? { ...b0, title: fix.title, author: fix.author || b0.author } : b0;
    const t = mainTitle(b.title);
    const k = t.toLowerCase();
    if (!k || seen.has(k) || started.some((p) => matches(t, p.book.title))) continue;
    seen.add(k);
    out.push({ ...b, match: scoreBook(b).match });
  }
  return tagged(out.sort((a, b) => b.match - a.match).slice(0, 30));
}

const SHORT = [
  ['0-3', 'Under 3h'],
  ['3-5', '3–5h'],
  ['5-8', '5–8h'],
  ['8-', '8h+'],
];
const shortPick = persisted('discShort', '0-3');
function ShortListens() {
  const pick = useStore(shortPick);
  const label = SHORT.find((x) => x[0] === pick)?.[1] || '';
  const load = moodShelf(() => tasteTopics().map((g) => g.au || g.name), { hours: pick, sort: byRating });
  return (
    <section class="d-short">
      {/* The heading with its length chips under it; the covers right after (no note, no big buttons). */}
      <div class="d-shorthead">
        <h3>Short listens</h3>
        <button class="d-more" onClick={() => nav.push('shelf', { title: `Short listens · ${label}`, subtitle: 'Your topics, best rated first', load })}>
          More <Icon name="arrow" size={15} />
        </button>
      </div>
      <div class="d-minichips">
        {SHORT.map(([k, l]) => (
          <button class={pick === k ? 'on' : ''} onClick={() => shortPick.set(k)}>
            {l}
          </button>
        ))}
      </div>
      <Row key={pick} title="" load={async () => tagged(await load())} cacheKey={'discShort' + pick} deps={[pick]} />
    </section>
  );
}

/** Series you're in: the next book, with how far through the series you are. */
function ContinueSeries() {
  const [cards, setCards] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const mine = Object.values(progress.get())
        .filter((p) => p?.book?.title && p.book.kind !== 'text' && p.book.source !== 'pod')
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      const done = new Set();
      const out = [];
      for (const p of mine.slice(0, 25)) {
        const s = seriesOf(p.book);
        if (!s?.name || done.has(s.name.toLowerCase())) continue;
        done.add(s.name.toLowerCase());
        const books = await seriesBooks(s.name, p.book.author).catch(() => []);
        if (books.length < 2) continue;
        const list = statusIn(books);
        const next = nextIn(list);
        if (!next || next.state === 'reading') continue; // a book in progress is on Home already
        out.push({ name: s.name, next: next.book, n: list.indexOf(next) + 1, total: list.length, finished: list.filter((x) => x.state === 'finished').length });
        if (out.length >= 2) break;
      }
      if (alive) setCards(out);
    })();
    return () => (alive = false);
  }, []);
  if (!cards?.length) return null;
  return (
    <section class="d-sec">
      <Head icon="layers" title="Continue a series" />
      {cards.map((c) => (
        <button class="d-card d-series" onClick={() => nav.push('book', { book: c.next })}>
          <Cover book={c.next} />
          <div class="d-series-m">
            <b>{c.name}</b>
            <small>
              Next: {mainTitle(c.next.title)} · {c.n} of {c.total}
            </small>
            <div class="d-prog">
              <i style={{ width: `${Math.round((c.finished / c.total) * 100)}%` }} />
            </div>
          </div>
          <span class="d-play">
            <Icon name="play" size={18} solid />
          </span>
        </button>
      ))}
    </section>
  );
}

// ---- For you ----------------------------------------------------------------------
/** One strong pick from your taste, opened ready to play (the 🎲 by the tabs). */
async function surprise() {
  const list = (cachedRow('homeRec') || []).length ? cachedRow('homeRec') : await recommendedForYou();
  const top = (list || []).filter((b) => b?.title).slice(0, 15);
  if (top.length) nav.push('book', { book: top[Math.floor(Math.random() * top.length)] });
}

/**
 * For you: covers on the first screen. Each row shows last time's books at once (then fresh ones)
 * and only appears when it has books — no empty grey boxes, nothing important left at the bottom.
 */
function ForYou() {
  const enjoyed = useMemo(() => tasteShelves().find((sh) => sh.key.startsWith('enjoyed:')), []);
  const anchor = useMemo(() => anchorBooks(1)[0], []);
  return (
    <div class="d-rows">
      <Row title="Picked for you" icon="sparkle" load={recommendedForYou} cacheKey="discPicked" onMore={() => nav.push('shelf', { title: 'Picked for your taste', subtitle: 'Best matches for you', load: recommendedForYou })} />
      {enjoyed && anchor && (
        <Row title={`Because you enjoyed ${mainTitle(anchor.title)}`} icon="star" load={enjoyed.load} cacheKey={'discEnjoyed:' + anchor.uid} onMore={() => nav.push('shelf', { title: enjoyed.title, subtitle: enjoyed.subtitle, load: enjoyed.load })} />
      )}
      <ShortListens />
      <ContinueSeries />
      <Row title="Hidden gems you own" subtitle="On your server or this phone, never started" icon="gem" load={hiddenGems} cacheKey="discGems" onMore={() => nav.push('shelf', { title: 'Hidden gems you own', subtitle: 'Never started, best match first', load: hiddenGems })} />
    </div>
  );
}

// ---- Moods --------------------------------------------------------------------------
const MOODS = [
  ['mind', 'brain', 'Mind-bending', 'Big ideas', 265, ['popular science', 'big ideas']],
  ['calm', 'moon', 'Wind down', 'Calm, gentle', 205, ['cozy', 'nature writing', 'meditation']],
  ['rush', 'bolt', 'Can’t stop', 'Feel the rush', 8, ['thriller', 'science fiction']],
  ['grow', 'sprout', 'Inspiring', 'Be your best', 45, ['self development', 'personal success']],
  ['fun', 'smile', 'Funny', 'Laugh out loud', 330, ['humor', 'comedy memoir']],
  ['epic', 'map', 'Escape', 'Epic worlds', 150, ['epic fantasy', 'space opera']],
];
const LENGTHS = [
  ['', 'Any'],
  ['0-5', 'Under 5h'],
  ['5-12', '5–12h'],
  ['12-', '12h+'],
];
const KINDS = [
  ['', 'Both'],
  ['fic', 'Fiction'],
  ['non', 'Non-fiction'],
];
const moodPick = persisted('discMood', { mood: 'mind', hours: '', kind: '' });
function Moods() {
  const pick = useStore(moodPick);
  const set = (p) => moodPick.set((x) => ({ ...x, ...p }));
  const m = MOODS.find((x) => x[0] === pick.mood) || MOODS[0];
  const [items, setItems] = useState(null);
  useEffect(() => {
    let alive = true;
    setItems(null);
    moodShelf(m[5], { hours: pick.hours })()
      .then((r) => alive && setItems(r))
      .catch(() => alive && setItems([]));
    return () => (alive = false);
  }, [pick.mood, pick.hours]);
  const shown = items && tagged(items.filter((b) => (pick.kind === 'fic' ? isFiction(b) : pick.kind === 'non' ? !isFiction(b) : true)));
  return (
    <section class="d-sec d-compact">
      {/* One row of moods, one row of filters, and the books straight under them (before: six big
          tiles, then "How long?", then Fiction / Non-fiction — the books started two screens down). */}
      <div class="d-minichips d-scroll">
        {MOODS.map(([k, icon, title]) => (
          <button class={k === m[0] ? 'on' : ''} onClick={() => set({ mood: k })}>
            {MOOD_EMOJI[k]} {title}
          </button>
        ))}
      </div>
      <div class="d-minichips d-scroll">
        {LENGTHS.map(([k, l]) => (
          <button class={pick.hours === k ? 'on' : ''} onClick={() => set({ hours: k })}>
            {k ? l : 'Any length'}
          </button>
        ))}
        <span class="d-chipsep" />
        {KINDS.map(([k, l]) => (
          <button class={pick.kind === k ? 'on' : ''} onClick={() => set({ kind: k })}>
            {k ? l : 'All'}
          </button>
        ))}
      </div>
      <p class="d-hint">{m[3]} · best match first, not in your library</p>
      {!shown ? (
        <div class="grid">{Array.from({ length: 6 }, () => <Skeleton />)}</div>
      ) : shown.length ? (
        <Grid items={shown} />
      ) : (
        <p class="muted">Nothing for this mix — try another length or All.</p>
      )}
    </section>
  );
}
const MOOD_EMOJI = { mind: '🧠', calm: '🌙', rush: '⚡', grow: '🌱', fun: '😄', epic: '🗺️' };

// ---- Genres and Lists ----------------------------------------------------------------
const FAV_GENRES = [
  ['🧠', 'Psychology', 'Psychology & Human Behavior'],
  ['🧬', 'Science', 'Science & Biology'],
  ['🔭', 'Cosmos', 'Cosmos & Physics'],
  ['🏛', 'History', 'History & Civilization'],
  ['💰', 'Money', 'Money, Economics & Capitalism'],
  ['🕉', 'Spirituality', 'Spirituality & Consciousness'],
];
const genrePick = persisted('discGenre', 'Psychology & Human Behavior');
/** Genres: your favourites first, then every genre, as one row of chips — the books right under. */
function Genres() {
  const want = useStore(genrePick);
  const favs = FAV_GENRES.map(([icon, label, name]) => ({ icon, label, g: GENRES.find((x) => x.name === name) })).filter((x) => x.g);
  const rest = GENRES.filter((g) => !favs.some((f) => f.g.name === g.name)).map((g) => ({ icon: '', label: g.name.replace(/\u2011/g, '-'), g }));
  const all = [...favs, ...rest];
  const cur = all.find((x) => x.g.name === want) || all[0];
  const [items, setItems] = useState(null);
  useEffect(() => {
    let alive = true;
    setItems(null);
    moodShelf([cur.g.au || cur.g.ia?.split(' OR ')[0] || cur.g.name])()
      .then((r) => alive && setItems(r))
      .catch(() => alive && setItems([]));
    return () => (alive = false);
  }, [cur.g.name]);
  return (
    <section class="d-sec d-compact">
      <div class="d-minichips d-scroll">
        {all.map((x) => (
          <button class={x === cur ? 'on' : ''} onClick={() => genrePick.set(x.g.name)}>
            {x.icon ? `${x.icon} ` : ''}
            {x.label}
          </button>
        ))}
      </div>
      <p class="d-hint">
        Best match first ·{' '}
        <button class="link-btn" onClick={() => nav.push('browse', { genre: cur.g })}>
          everything in {cur.label} →
        </button>
      </p>
      {!items ? <div class="grid">{Array.from({ length: 6 }, () => <Skeleton />)}</div> : items.length ? <Grid items={tagged(items)} /> : <p class="muted">Nothing here right now — try another genre.</p>}
    </section>
  );
}

function Lists() {
  return (
    <section class="d-rows">
      <Row title="Trending this week" subtitle="Best sellers in your topics" icon="flame" cacheKey="discTrend" load={trending} deps={[]} onMore={() => nav.push('shelf', { title: 'Trending this week', subtitle: 'Best sellers in your topics', load: trending })} />
      <Row title="Top audiobooks" subtitle="Apple Books charts" icon="chart" cacheKey="itTop" load={() => itunes.top()} deps={[]} onMore={() => nav.push('shelf', { title: 'Top audiobooks', subtitle: 'Apple Books charts', load: () => itunes.top() })} />
      <Row title="New audiobooks" subtitle="Released this year" icon="sparkle" cacheKey="itNew" load={() => itunes.newest()} deps={[]} onMore={() => nav.push('shelf', { title: 'New audiobooks', subtitle: 'Released this year', load: () => itunes.newest() })} />
    </section>
  );
}

/** Tabs and the chosen tab's content. */
// ---- Free classics -----------------------------------------------------------------
const freeLook = persisted('freeClassics', { lang: 'en', genre: '', sort: 'popular' });
/**
 * Public-domain audiobooks to browse, free to stream: LibriVox's catalogue (on the Internet
 * Archive) and Project Gutenberg's human-read audiobooks — one list, each book once, with
 * where it plays from on each card. (Free catalogues stay out of search; this is their place.)
 */
// The last list you saw, so the tab opens on books at once while a fresh one loads.
const freeLast = persisted('freeLast', { key: '', items: [] });
function FreeClassics() {
  const f = useStore(freeLook);
  const key = `${f.lang}|${f.genre}|${f.sort}`;
  const last = freeLast.get();
  const [items, setItems] = useState(() => (last.key === key && last.items.length ? last.items : null));
  const [err, setErr] = useState('');
  const [why, setWhy] = useState(false);
  useEffect(() => {
    let live = true;
    const kept = freeLast.get();
    setItems(kept.key === key && kept.items.length ? kept.items : null);
    setErr('');
    Promise.all([import('../sources/archive.js'), import('../sources/gutenbergaudio.js'), import('../lib/freeclassics.js')]).then(async ([ia, gba, fc]) => {
      const code = fc.LANGS.find((x) => x[0] === f.lang)?.[3] || '';
      let lv = null;
      let gb = null;
      const show = () => {
        if (!live || (!lv && !gb)) return;
        const list = fc.mergeFree([['LibriVox', (lv || []).map((b) => ({ ...b, via: 'lv' }))], ['Gutenberg', gb || []]]);
        setItems(list);
        freeLast.set({ key, items: list.slice(0, 48) });
      };
      // LibriVox answers in a second or two; show it straight away and let Gutenberg (often 10 s or
      // more) join when it arrives, rather than waiting for the slower one before showing anything.
      const a = ia.query(fc.iaQuery(f.lang, f.genre), { sort: f.sort === 'new' ? 'addeddate desc' : 'downloads desc', rows: 48 }).then((r) => ((lv = r), show())).catch(() => {});
      const g = Promise.race([
        gba.list({ ...(code ? { languages: code } : {}), ...(f.genre ? { topic: f.genre } : {}), ...(f.sort === 'new' ? { sort: 'descending' } : {}) }),
        new Promise((_, no) => setTimeout(() => no(new Error('slow')), 12000)),
      ]).then((r) => ((gb = r), show())).catch(() => {});
      await Promise.all([a, g]);
      if (live && !lv && !gb) {
        setErr("LibriVox and Gutenberg aren't answering right now — try again in a minute");
        setItems((x) => x || []);
      }
    });
    return () => (live = false);
  }, [key]);
  const [LANGS, GENRES_FREE] = useFreeLists();
  const set = (patch) => freeLook.set({ ...f, ...patch });
  return (
    <section class="d-sec d-compact free-classics">
      <div class="d-freehead">
        <select class="d-select" value={f.lang} onChange={(e) => set({ lang: e.currentTarget.value })} aria-label="Language">
          {LANGS.map(([k, l]) => (
            <option value={k}>{l}</option>
          ))}
        </select>
        <button class="d-chip" onClick={() => set({ sort: f.sort === 'new' ? 'popular' : 'new' })}>
          {f.sort === 'new' ? 'Newest' : 'Most listened'} ⇅
        </button>
        <button class="d-info" aria-label="What are these?" onClick={() => setWhy(!why)}>
          ⓘ
        </button>
      </div>
      {why && <p class="d-hint">Public-domain audiobooks read by volunteers (LibriVox, Project Gutenberg) — free to listen, nothing to sign up for. Public domain in the US; a few may still be in copyright where you live.</p>}
      <div class="d-minichips d-scroll">
        {GENRES_FREE.map(([k, l]) => (
          <button class={f.genre === k ? 'on' : ''} onClick={() => set({ genre: k })}>
            {l}
          </button>
        ))}
      </div>
      {err && !items?.length ? <p class="muted pad-s">{err}</p> : !items ? <div class="grid">{Array.from({ length: 6 }, () => <Skeleton />)}</div> : items.length ? <Grid items={items} /> : <p class="muted pad-s">Nothing here with these choices — try another genre or language.</p>}
    </section>
  );
}
// The chip lists live in lib/freeclassics.js (loaded with the tab).
function useFreeLists() {
  const [l, setL] = useState([[['en', 'English']], [['', 'All']]]);
  useEffect(() => {
    import('../lib/freeclassics.js').then((m) => setL([m.LANGS.map(([k, n]) => [k, n]), m.GENRES]));
  }, []);
  return l;
}

export function DiscoverBrowse() {
  const tab = useStore(discTab);
  const [busy, setBusy] = useState(false);
  useStore(settings);
  return (
    <div class="disc2">
      <div class="d-tabs">
        {TABS.map(([k, l]) => (
          <button class={tab === k ? 'on' : ''} onClick={() => discTab.set(k)}>
            {l}
          </button>
        ))}
        <button class="d-dice" aria-label="Surprise me: one strong pick for you" title="Surprise me" disabled={busy} onClick={() => (setBusy(true), surprise().finally(() => setBusy(false)))}>
          {busy ? <span class="spinner small" /> : '🎲'}
        </button>
      </div>
      {tab === 'moods' ? <Moods /> : tab === 'genres' ? <Genres /> : tab === 'lists' ? <Lists /> : tab === 'free' ? <FreeClassics /> : <ForYou />}
    </div>
  );
}
