// The frosted-glass book card (Continue listening on Home, the top of a book page).
// The whole cover on the left, never cropped (covers are square or tall, the card is wide);
// behind the glass the same cover, blurred, so each card takes its book's own colours.
// On the right, glass panels with the real names — Author, Narrator, Duration, and Format
// (or where you are in it, for a book you're listening to). A dark strip at the bottom has the
// title and the ★ rating. On a pale cover the glass darkens, so the white text stays readable.
import { useEffect, useState } from 'preact/hooks';
import { Cover, withMeta } from './common.jsx';
import { Icon } from './icons.jsx';
import { useCoverColor } from './player-ui.jsx';
import { useLocalCover } from '../sources/local.js';
import { useMeta } from '../lib/meta.js';
import { coverLight } from '../lib/color.js';
import { fmtDuration } from '../lib/format.js';
import { nav } from '../lib/nav.js';

// Where a copy plays from, for a book whose file type isn't known.
const WHERE = { loc: 'On this phone', abs: 'Audiobookshelf', tb: 'TorBox', rd: 'Real-Debrid', url: 'Link' };
const whereOf = (b) => WHERE[String(b?.source || b?.uid || '').split(':')[0]] || '';
// The first name, and how many more ("Neil Gaiman +2" for a full cast).
const first = (names) => {
  const all = String(names || '').split(/,|&|;/).map((n) => n.trim()).filter(Boolean);
  return all.length > 1 ? `${all[0]} +${all.length - 1}` : all[0] || '';
};
const firstOnly = (names) => String(names || '').split(/,|&|;/)[0].trim();

/**
 * book: the book; prog: its progress (percent, total, global) for a book you're on;
 * rating: { rating } when known (else looked up from Goodreads' cache); onPlay: a tap on the
 * cover or the strip; children: extra pieces on top (the Continue ✕).
 */
export function GlassCard({ book, prog = null, rating = null, onPlay, children }) {
  const local = useLocalCover(book);
  const meta = useMeta(book);
  const b = withMeta(local ? { ...book, cover: local } : book, meta?.fixed ? meta : null);
  const tint = useCoverColor(b);
  const [light, setLight] = useState(false);
  useEffect(() => {
    let alive = true;
    coverLight(b.cover).then((l) => alive && setLight(l > 0.62));
    return () => (alive = false);
  }, [b.cover]);
  const [stars, setStars] = useState(0);
  useEffect(() => {
    if (rating?.rating || b.rating) return setStars(Number(rating?.rating || b.rating) || 0);
    let alive = true;
    setStars(0);
    import('../lib/ratings.js')
      .then((r) => r.goodreads(b))
      .then((g) => alive && g?.rating && setStars(Number(g.rating)))
      .catch(() => {});
    return () => (alive = false);
  }, [b.uid, b.title, rating?.rating]);

  const author = first(b.author);
  const narrator = first(b.narrator || meta?.narrator);
  const length = Number(b.duration) || Number(prog?.total) || 0;
  const format = String(b.format || '').toUpperCase() || whereOf(b);
  const pct = prog ? Math.round((prog.percent || 0) * 100) : 0;
  const left = prog?.total ? fmtDuration(Math.max(0, prog.total - (prog.global || 0))) : '';
  const person = (e, name, role) => (e.stopPropagation(), nav.push('person', { name, role }));
  const panel = (icon, label, value, onClick) =>
    value && (
      <div class={'gc-pill' + (onClick ? ' tap' : '')} role={onClick ? 'button' : undefined} onClick={onClick}>
        <Icon name={icon} size={18} />
        <div>
          <small>{label}</small>
          <b>{value}</b>
        </div>
      </div>
    );
  return (
    <div class={'glass-card' + (light ? ' light' : '')} style={tint ? { '--tint': tint } : null} onClick={onPlay}>
      {b.cover && <div class="gc-bg" style={{ backgroundImage: `url("${b.cover}")` }} />}
      <div class="gc-cover">
        <Cover book={b} eager />
      </div>
      <div class="gc-pills">
        {panel('user', 'Author', author, author && ((e) => person(e, firstOnly(b.author), 'author')))}
        {panel('mic', 'Narrator', narrator, narrator && ((e) => person(e, firstOnly(b.narrator || meta?.narrator), 'narrator')))}
        {panel('clock', 'Duration', length && fmtDuration(length))}
        {prog ? (
          <div class="gc-pill">
            <Icon name={b.kind === 'text' ? 'book' : 'play'} size={18} />
            <div class="gc-where">
              <small>{left ? `${pct}% · ${left} left` : `${pct}%`}</small>
              <div class="gc-bar">
                <i style={{ width: `${pct}%` }} />
              </div>
            </div>
          </div>
        ) : (
          panel('bookmark', 'Format', format)
        )}
      </div>
      <div class="gc-strip">
        <div>
          <b>{b.title}</b>
          {prog && whereOf(b) && <em>{whereOf(b)}</em>}
        </div>
        {stars > 0 && <span class="gc-rate">★ {stars.toFixed(1)}</span>}
      </div>
      {children}
    </div>
  );
}
