// "Come back to …": a book you were into but left (three weeks or more untouched, part-way through)
// offered again on Home, with the story so far and your bookmarks, so picking it up isn't daunting.
// Pure picking here; the card is in Home.jsx.
import { persisted } from './store.js';

const DAY = 864e5;
/** Books you said "not now" to: uid → when (asked again after 30 days). */
export const comeBackDismissed = persisted('comeBackDismissed', {});
/** A book opened from the card's "Story so far": the player opens its recap once it's up. */
export const wantRecap = persisted('wantRecap', '');

/**
 * The book to invite you back to, or null: unfinished, between 3% and 95% through, untouched for
 * `days` (default 21) but less than a year, not dismissed lately — the one you were most into
 * (furthest through), newest first on a tie. → { uid, book, percent, days }
 */
export function comeBackTo(prog, { now = Date.now(), days = 21, dismissed = {} } = {}) {
  const list = Object.entries(prog || {})
    .filter(([uid, p]) => {
      if (!p?.book || p.finished || p.book.source === 'pod' || p.kind === 'pod') return false;
      const pct = Number(p.percent) || 0;
      const away = now - (p.updatedAt || 0);
      if (pct < 0.03 || pct > 0.95 || away < days * DAY || away > 365 * DAY) return false;
      return !(dismissed[uid] && now - dismissed[uid] < 30 * DAY);
    })
    .map(([uid, p]) => ({ uid, book: p.book, percent: Number(p.percent) || 0, days: Math.floor((now - p.updatedAt) / DAY), at: p.updatedAt }))
    .sort((a, b) => b.percent - a.percent || b.at - a.at);
  return list[0] || null;
}

/** "3 weeks", "2 months" — how long you've been away. */
export function awayText(days) {
  if (days >= 60) return `${Math.round(days / 30)} months`;
  return `${Math.max(1, Math.round(days / 7))} weeks`;
}
