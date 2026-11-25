// Listener Challenges: this month's goals from the listening log.
import { describe, it, expect } from 'vitest';
import { challenges, bestStreak } from '../src/lib/challenges.js';

const now = new Date(2026, 10, 25, 12); // 25 Nov 2026
const day = (d, m = 11) => `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
describe('challenges', () => {
  it('counts hours, finished books, the best run of days and new authors', () => {
    const days = {};
    for (let d = 10; d <= 17; d++) days[day(d)] = { s: 3600, b: { a: 3600 } }; // 8 days in a row, 8 h
    days[day(20)] = { s: 120, b: { b: 120 } }; // 2 minutes: not a listening day
    days[day(3, 10)] = { s: 5000, b: { a: 5000 } }; // October, author A
    const log = { days, books: { a: { author: 'Frank Herbert' }, b: { author: 'Ursula Le Guin' } } };
    const prog = { a: { finished: true, updatedAt: new Date(2026, 10, 18).getTime(), book: {} }, c: { finished: true, updatedAt: new Date(2026, 9, 1).getTime(), book: {} } };
    const [hours, finish, streak, author] = challenges(log, prog, now);
    expect(hours.text).toBe('8.0 of 10 hours');
    expect(hours.done).toBeCloseTo(0.8);
    expect(finish.text).toBe('1 of 2 finished');
    expect(streak.done).toBe(1);
    expect(author.done).toBe(1); // Le Guin is new this month; Herbert was heard in October
  });
  it('a run of days needs 5 minutes each', () => {
    expect(bestStreak({ [day(1)]: { s: 400 }, [day(2)]: { s: 200 }, [day(3)]: { s: 400 }, [day(4)]: { s: 400 } }, now)).toBe(2);
  });
});
