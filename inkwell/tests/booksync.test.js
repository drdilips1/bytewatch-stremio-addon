// Following the book by the audio's time (transcript with the ebook attached).
import { describe, it, expect } from 'vitest';
const { wordAtTime } = await import('../src/lib/booksync.js');

// Lines found at 10 s → word 100, 20 s → word 125, 30 s → word 150 (2.5 words a second).
const pts = [[10, 100], [20, 125], [30, 150]];
describe('wordAtTime', () => {
  it('between two found lines: by how far along', () => {
    expect(wordAtTime(pts, 15, 1000)).toBe(113);
    expect(wordAtTime(pts, 25, 1000)).toBe(138);
  });
  it('after the last found line: at the reader’s pace', () => {
    expect(wordAtTime(pts, 40, 1000)).toBe(175);
  });
  it('before the first: back at the same pace, never below 0 or past the end', () => {
    expect(wordAtTime(pts, 0, 1000)).toBe(75);
    expect(wordAtTime(pts, -100, 1000)).toBe(0);
    expect(wordAtTime(pts, 10000, 1000)).toBe(999);
  });
});
