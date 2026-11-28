import { describe, it, expect } from 'vitest';
import { paddedBox } from '../src/lib/image.js';

// A 64×64 sample: l, r, t, b are the first / last columns and rows that aren't plain.
describe('trimming padding off a square cover picture', () => {
  it('trims even bars on the left and right (a tall cover padded to a square)', () => {
    const f = paddedBox(10, 53, 0, 63, 64, 64);
    expect(f).toBeTruthy();
    expect(f.w).toBeCloseTo(44 / 64);
  });
  it("doesn't cut a cream cover's thin top line (a strip at the top only)", () => {
    expect(paddedBox(0, 63, 6, 63, 64, 64)).toBe(null);
  });
  it('trims even bars at the top and bottom', () => {
    expect(paddedBox(0, 63, 9, 54, 64, 64)).toBeTruthy();
  });
  it('leaves a picture with nothing worth trimming', () => {
    expect(paddedBox(0, 63, 1, 62, 64, 64)).toBe(null);
  });
});
