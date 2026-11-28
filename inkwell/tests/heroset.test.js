import { describe, it, expect } from 'vitest';
import { heroWindow } from '../src/lib/heroset.js';

const pool = Array.from({ length: 12 }, (_, i) => ({ uid: 'b' + i }));
const ids = (l) => l.map((b) => b.uid).join(',');
describe("Home carousel's five books", () => {
  it('shows five at a time', () => {
    expect(heroWindow(pool, 0)).toHaveLength(5);
  });
  it('brings the next five after each full turn', () => {
    expect(ids(heroWindow(pool, 0))).toBe('b0,b1,b2,b3,b4');
    expect(ids(heroWindow(pool, 1))).toBe('b5,b6,b7,b8,b9');
  });
  it('wraps round to the start of the mix', () => {
    expect(ids(heroWindow(pool, 2))).toBe('b10,b11,b0,b1,b2');
  });
  it('shows all when there are five or fewer', () => {
    expect(heroWindow(pool.slice(0, 3), 4)).toHaveLength(3);
  });
});
