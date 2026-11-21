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

// Where a copy is: your services by name; a book from a catalogue by the catalogue's name.
const WHERE = { loc: 'On this phone', abs: 'Audiobookshelf', tb: 'TorBox', rd: 'Real-Debrid', ad: 'AllDebrid', pm: 'Premiumize', dl: 'Debrid-Link', url: 'Link', au: 'Audible', it: 'Apple Books', gbk: 'Google Books', lb: 'Libby', lbl: 'Libby', hc: 'Hardcover', gr: 'Goodreads' };
const whereOf = (b) => (b?.source === 'addon' && b.addonName) || WHERE[String(b?.source || b?.uid || '').split(':')[0]] || '';
// The first name, and how many more ("Neil Gaiman +2" for a full cast).
const first = (names) => {
  const all = String(names || '').split(/,|&|;/).map((n) => n.trim()).filter(Boolean);
  return all.length > 1 ? `${all[0]} +${all.length - 1}` : all[0] || '';
};
const firstOnly = (names) => String(names || '').split(/,|&|;/)[0].trim();

/**
 * book: the book; prog: its progress (percent, total, global) for a book you're on;
 * rating: { rating } when known (else looked up from Goodreads' cache); onPlay: a tap on the
 * card; small: the size for rows and grids (icon and value only, the whole card one tap);
 * rootProps: more handlers for the card (press and hold); children: extra pieces on top.
 */
export function GlassCard({ book, prog = null, rating = null, onPlay, small = false, rootProps = null, children }) {
  const local = useLocalCover(book);
  const meta = useMeta(book);
  // Rows: tidy title / author / cover from the lookup (as the old cards did); the big card only what you fixed.
  const b = withMeta(local ? { ...book, cover: local } : book, small ? meta : meta?.fixed ? meta : null);
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
    if (small) return setStars(0); // rows pass the rating they found (no lookup per card here)
    let alive = true;
    setStars(0);
    import('../lib/ratings.js')
      .then((r) => r.goodreads(b))
      .then((g) => alive && g?.rating && setStars(Number(g.rating)))
      .catch(() => {});
    return () => (alive = false);
  }, [b.uid, b.title, rating?.rating]);

  const ebook = b.kind === 'text' || /#ebook$/.test(b.uid || '');
  const author = first(b.author);
  const narrator = ebook ? '' : first(b.narrator || meta?.narrator);
  const length = ebook ? 0 : Number(b.duration) || Number(meta?.runtime) || Number(prog?.total) || 0;
  const format = String(b.format || '').toUpperCase() || (ebook ? 'Ebook' : '');
  const where = whereOf(b);
  const pct = prog ? Math.round((prog.percent || 0) * 100) : 0;
  // Time left, short enough for the panel ("16h", "2h 14m", "45m").
  const rest = prog?.total ? Math.max(0, prog.total - (prog.global || 0)) : 0;
  const left = rest >= 36000 ? `${Math.round(rest / 3600)}h` : rest > 0 ? fmtDuration(rest) : '';
  const lengthLine = [length && fmtDuration(length), format].filter(Boolean).join(' · ');
  const person = (e, name, role) => (e.stopPropagation(), nav.push('person', { name, role }));
  const panel = (icon, label, value, onClick) =>
    value && (
      <div class={'gc-pill' + (onClick && !small ? ' tap' : '')} role={onClick && !small ? 'button' : undefined} onClick={small ? undefined : onClick}>
        <Icon name={icon} size={small ? 13 : 18} />
        <div>
          {!small && <small>{label}</small>}
          <b>{value}</b>
        </div>
      </div>
    );
  return (
    <div class={'glass-card' + (small ? ' small' : '') + (light ? ' light' : '')} style={tint ? { '--tint': tint } : null} onClick={onPlay} {...(rootProps || {})}>
      {b.cover && <div class="gc-bg" style={{ backgroundImage: `url("${b.cover}")` }} />}
      <div class="gc-cover">
        <Cover book={b} eager={!small} />
      </div>
      {/* Author, narrator, length (or where you are), and where it is — all on the right. */}
      <div class="gc-pills">
        {panel('user', 'Author', author, author && ((e) => person(e, firstOnly(b.author), 'author')))}
        {panel('mic', 'Narrator', narrator, narrator && ((e) => person(e, firstOnly(b.narrator || meta?.narrator), 'narrator')))}
        {prog && pct > 0 ? (
          <div class="gc-pill">
            <Icon name={ebook ? 'book' : 'play'} size={small ? 13 : 18} />
            <div class="gc-where">
              <small>{left ? `${pct}% · ${left} left` : `${pct}%`}</small>
              <div class="gc-bar">
                <i style={{ width: `${pct}%` }} />
              </div>
            </div>
          </div>
        ) : (
          panel('clock', 'Length', lengthLine)
        )}
        {panel('cloud', 'From', where)}
      </div>
      <div class="gc-strip">
        <b>{b.title}</b>
        {stars > 0 && <span class="gc-rate">★ {stars.toFixed(1)}</span>}
      </div>
      {children}
    </div>
  );
}
