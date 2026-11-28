import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/lib/store.js', () => ({ persisted: (k, v) => ({ get: () => v, set() {}, subscribe() {} }), progress: { get: () => ({}) }, library: { get: () => ({}) } }));
vi.mock('../src/lib/downloads.js', () => ({ downloads: { get: () => ({}) } }));
vi.mock('../src/sources/local.js', () => ({ localCfg: { get: () => ({}) } }));
const { upNext } = await import('../src/lib/series.js');
import { lastPlayed } from '../src/lib/lastplayed.js';

const hp = (states) => states.map((state, i) => ({ book: { uid: 'b' + (i + 1), title: 'HP ' + (i + 1) }, state }));

describe('Up next in a series', () => {
  it('is the book after the one you are on, even with nothing finished', () => {
    // Book 1 at 89%, books 2 and 3 owned, 4 started: on book 1, next is book 2 (not book 1).
    expect(upNext(hp(['reading', 'have', 'have', 'reading', 'reading']), 0).book.uid).toBe('b2');
  });
  it('skips books you finished', () => {
    expect(upNext(hp(['reading', 'finished', '', '']), 0).book.uid).toBe('b3');
  });
  it('is nothing on the last book', () => {
    expect(upNext(hp(['finished', 'reading']), 1)).toBe(null);
  });
  it('off the series, is the first unfinished after the last finished', () => {
    expect(upNext(hp(['finished', 'finished', '', '']), -1).book.uid).toBe('b3');
  });
});

describe('Last played copy', () => {
  const prog = { tb: { updatedAt: 300 }, abs: { updatedAt: 100 }, page: { updatedAt: 200 } };
  it('picks the copy played most recently', () => {
    expect(lastPlayed(['abs', 'tb', 'rd'], prog)).toBe('tb');
  });
  it("is nothing when the page's own copy was played last", () => {
    expect(lastPlayed(['abs'], prog, 'page')).toBe(null);
  });
  it('is the other copy when it was played after this one', () => {
    expect(lastPlayed(['abs', 'tb'], prog, 'page')).toBe('tb');
  });
  it('is nothing when no copy was played', () => {
    expect(lastPlayed(['x', 'y'], prog)).toBe(null);
  });
});
