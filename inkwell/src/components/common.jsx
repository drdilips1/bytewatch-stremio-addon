import { useEffect, useState } from 'preact/hooks';
import { hashHue } from '../lib/format.js';
import { SOURCES, sourceOf } from '../sources/index.js';
import { Icon } from './icons.jsx';
import { nav } from '../lib/nav.js';
import { progress as progressStore, useStore } from '../lib/store.js';
import { useImage } from '../lib/image.js';
import { useMeta } from '../lib/meta.js';

export function Cover({ book, class: cls = '', eager }) {
  const { src, failed: proxyFailed } = useImage(book?.cover || '');
  const [failed, setFailed] = useState(!book?.cover);
  useEffect(() => setFailed(!book?.cover || proxyFailed), [book?.cover, proxyFailed]);
  const hue = hashHue(book?.title || '');
  return (
    <div class={'cover ' + cls} style={{ '--h': hue }}>
      <div class="cover-fallback">
        <span class="cover-title">{book?.title}</span>
        <span class="cover-author">{book?.author}</span>
      </div>
      {!failed && src && (
        <img
          src={src}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onError={() => setFailed(true)}
          onLoad={(e) => {
            // Open Library returns a 1x1 gif for missing covers.
            if (e.currentTarget.naturalWidth < 10) setFailed(true);
            else e.currentTarget.classList.add('loaded');
          }}
        />
      )}
    </div>
  );
}

export function SourceBadge({ uid, book }) {
  const key = sourceOf(uid);
  const s = SOURCES[key];
  const label = key === 'addon' ? book?.addonName || s.short : book?.via === 'lv' ? 'LibriVox' : s.short;
  return (
    <span class="badge" style={{ '--h': key === 'ia' && book?.via === 'lv' ? SOURCES.lv.hue : s.hue }}>
      {label}
    </span>
  );
}

// Debrid/addon items borrow cover + tidy title/author from metadata providers.
export function withMeta(book, meta) {
  if (!meta) return book;
  const cloudItem = book.source === 'tb' || book.source === 'rd';
  return {
    ...book,
    cover: book.cover || meta.cover || '',
    title: cloudItem && meta.title ? meta.title : book.title,
    author: (cloudItem && meta.author) || book.author || meta.author || '',
    rating: book.rating || meta.rating || 0,
    ratings: book.rating ? book.ratings : meta.ratings || 0,
  };
}

const fmtCount = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(n >= 1e4 ? 0 : 1) + 'k' : String(n));

export function BookCard({ book: raw, wide }) {
  const meta = useMeta(raw);
  const book = withMeta(raw, meta);
  const prog = useStore(progressStore)[book.uid];
  const pct = prog ? Math.round((prog.percent || 0) * 100) : 0;
  return (
    <button class={'book-card' + (wide ? ' wide' : '')} onClick={() => nav.push('book', { book })}>
      <div class="book-card-cover">
        <Cover book={book} />
        <span class="kind-dot" title={book.kind}>
          <Icon name={book.kind === 'text' ? 'book' : book.kind === 'discover' ? 'sparkle' : 'headphones'} size={13} />
        </span>
        {book.rank > 0 && <span class="rank-badge">#{book.rank}</span>}
        {book.fetching != null && <span class="fetch-badge">{Math.round((book.fetching || 0) * 100)}%</span>}
        {pct > 0 && (
          <div class="progress-mini">
            <div style={{ width: pct + '%' }} />
          </div>
        )}
      </div>
      <div class="book-card-title">{book.title}</div>
      <div class="book-card-author">{book.author || ' '}</div>
      {book.rating > 0 && (
        <div class="book-card-rating">
          <Icon name="star" size={11} /> {book.rating.toFixed(1)}
          {book.ratings > 0 && <span> · {fmtCount(book.ratings)}</span>}
        </div>
      )}
    </button>
  );
}

export function Row({ title, subtitle, load, items: given, icon, onMore, deps = [], showErrors = false, emptyText = '' }) {
  const [items, setItems] = useState(given || null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (given) return setItems(given);
    let alive = true;
    setItems(null);
    setError(null);
    load()
      .then((r) => alive && setItems(r))
      .catch((e) => alive && setError(e));
    return () => (alive = false);
  }, deps);
  // Integration rows (your server, cloud, shelves) show what went wrong instead of vanishing.
  if (showErrors && (error || (items && !items.length && emptyText))) {
    return (
      <section class="row">
        <header class="row-head">
          <div>
            <h2>
              {icon && <Icon name={icon} size={18} />} {title}
            </h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
        </header>
        <p class={'row-note' + (error ? ' bad' : '')}>{error ? `Couldn't load: ${error.message || error}` : emptyText}</p>
      </section>
    );
  }
  if (error || (items && !items.length)) return null;
  return (
    <section class="row">
      <header class={'row-head' + (onMore ? ' tappable' : '')} onClick={onMore}>
        <div>
          <h2>
            {icon && <Icon name={icon} size={18} />} {title}
          </h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {onMore && (
          <span class="link-btn see-all">
            See all{items ? ` ${items.length}` : ''} ›
          </span>
        )}
      </header>
      <div class="row-scroll">
        {items ? items.map((b) => <BookCard key={b.uid} book={b} />) : Array.from({ length: 6 }, (_, i) => <Skeleton key={i} />)}
      </div>
    </section>
  );
}

export function Grid({ items }) {
  return (
    <div class="grid">
      {items.map((b) => (
        <BookCard key={b.uid} book={b} />
      ))}
    </div>
  );
}

export function Skeleton() {
  return (
    <div class="book-card skeleton">
      <div class="book-card-cover shimmer" />
      <div class="line shimmer" />
      <div class="line short shimmer" />
    </div>
  );
}

export function TopBar({ title, back = true, right, transparent }) {
  return (
    <header class={'topbar' + (transparent ? ' transparent' : '')}>
      {back ? (
        <button class="icon-btn" onClick={() => nav.back()} aria-label="Back">
          <Icon name="back" />
        </button>
      ) : (
        <span />
      )}
      <h1>{title}</h1>
      <div class="topbar-right">{right}</div>
    </header>
  );
}

export function Empty({ icon = 'sparkle', title, children }) {
  return (
    <div class="empty">
      <div class="empty-icon">
        <Icon name={icon} size={34} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

let toastSet;
export function Toaster() {
  const [msg, setMsg] = useState(null);
  toastSet = setMsg;
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2600);
    return () => clearTimeout(t);
  }, [msg]);
  return msg ? <div class="toast">{msg.text || msg}</div> : null;
}
export const toast = (text) => toastSet?.({ text, t: Date.now() });
