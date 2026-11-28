import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/lib/store.js', () => ({ persisted: (k, v) => ({ get: () => v, set() {}, subscribe() {} }), progress: { get: () => ({}) }, library: { get: () => ({}) } }));
vi.mock('../src/lib/downloads.js', () => ({ downloads: { get: () => ({}) } }));
vi.mock('../src/sources/local.js', () => ({ localCfg: { get: () => ({}) } }));
const { upNext } = await import('../src/lib/series.js');
import { lastOfWork, copyFor } from '../src/lib/lastplayed.js';

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
  const same = (b) => /sapiens/i.test(b.title || '');
  const prog = {
    'tb:1': { updatedAt: 300, book: { title: 'Sapiens' } },
    'abs:9': { updatedAt: 100, book: { title: 'Sapiens: A Brief History' } },
    'abs:7': { updatedAt: 900, book: { title: 'Homo Deus' } },
  };
  it('is your most recent place in this book, under any copy', () => {
    expect(lastOfWork(prog, same)).toEqual({ uid: 'tb:1', at: 300 });
  });
  it('is nothing when you never played it', () => {
    expect(lastOfWork(prog, () => false)).toBe(null);
  });
  it('finds the copy by its id', () => {
    expect(copyFor(['abs:9', 'tb:1', 'rd:2'], 'tb:1')).toBe('tb:1');
  });
  it('finds it by where it is when its id changed and only one copy is from there', () => {
    expect(copyFor(['abs:9', 'tb:5'], 'tb:1')).toBe('tb:5');
  });
  it('guesses nothing when two copies are from there', () => {
    expect(copyFor(['tb:5', 'tb:6'], 'tb:1')).toBe(null);
  });
});
