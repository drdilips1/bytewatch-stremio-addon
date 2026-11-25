// "Come back to …" on Home: which book is offered again.
import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/lib/store.js', () => ({ persisted: (k, v) => ({ get: () => v, set: () => {}, subscribe: () => () => {} }) }));
const { comeBackTo, awayText } = await import('../src/lib/resurrect.js');

const DAY = 864e5;
const now = 400 * DAY;
const p = (pct, daysAgo, extra = {}) => ({ percent: pct, updatedAt: now - daysAgo * DAY, book: { title: 't', source: 'tb' }, ...extra });

describe('comeBackTo', () => {
  it('offers the unfinished book you were furthest into, left 3+ weeks ago', () => {
    const r = comeBackTo({ a: p(0.2, 30), b: p(0.6, 25), c: p(0.8, 5), d: p(0.5, 40, { finished: true }), e: p(0.01, 30), f: p(0.98, 30) }, { now });
    expect(r.uid).toBe('b');
    expect(r.days).toBe(25);
  });
  it('not after a year, not podcasts, not right after "not now"', () => {
    expect(comeBackTo({ a: p(0.5, 400) }, { now })).toBe(null);
    expect(comeBackTo({ a: p(0.5, 30, { book: { source: 'pod' } }) }, { now })).toBe(null);
    expect(comeBackTo({ a: p(0.5, 30) }, { now, dismissed: { a: now - 2 * DAY } })).toBe(null);
    expect(comeBackTo({ a: p(0.5, 30) }, { now, dismissed: { a: now - 40 * DAY } })?.uid).toBe('a');
  });
  it('says how long', () => {
    expect(awayText(22)).toBe('3 weeks');
    expect(awayText(75)).toBe('3 months');
  });
});
