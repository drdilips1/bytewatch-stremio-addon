import { useEffect, useState } from 'preact/hooks';
import { hashHue } from '../lib/format.js';
import { SOURCES, sourceOf } from '../sources/index.js';
import { Icon } from './icons.jsx';
import { nav } from '../lib/nav.js';
import { progress as progressStore, useStore } from '../lib/store.js';

export function Cover({ book, class: cls = '', eager }) {
  const [failed, setFailed] = useState(!book?.cover);
  useEffect(() => setFailed(!book?.cover), [book?.cover]);
  const hue = hashHue(book?.title || '');
  return (
    <div class={'cover ' + cls} style={{ '--h': hue }}>
      <div class="cover-fallback">
        <span class="cover-title">{book?.title}</span>
        <span class="cover-author">{book?.author}</span>
      </div>
      {!failed && (
        <img
          src={book.cover}
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

export function BookCard({ book, wide }) {
  const prog = useStore(progressStore)[book.uid];
  const pct = prog ? Math.round((prog.percent || 0) * 100) : 0;
  return (
    <button class={'book-card' + (wide ? ' wide' : '')} onClick={() => nav.push('book', { book })}>
      <div class="book-card-cover">
        <Cover book={book} />
        <span class="kind-dot" title={book.kind}>
          <Icon name={book.kind === 'text' ? 'book' : book.kind === 'discover' ? 'sparkle' : 'headphones'} size={13} />
        </span>
        {pct > 0 && (
          <div class="progress-mini">
            <div style={{ width: pct + '%' }} />
          </div>
        )}
      </div>
      <div class="book-card-title">{book.title}</div>
      <div class="book-card-author">{book.author || ' '}</div>
    </button>
  );
}

export function Row({ title, subtitle, load, items: given, icon, onMore, deps = [] }) {
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
  if (error || (items && !items.length)) return null;
  return (
    <section class="row">
      <header class="row-head">
        <div>
          <h2>
            {icon && <Icon name={icon} size={18} />} {title}
          </h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {onMore && (
          <button class="link-btn" onClick={onMore}>
            See all
          </button>
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
