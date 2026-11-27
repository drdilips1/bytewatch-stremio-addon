// The series row: a copy that doesn't say its series still gets it from Audible's match — only
// when it's the same book.
import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/lib/store.js', () => ({ persisted: (k, v) => ({ get: () => v, set: () => {}, subscribe: () => () => {} }), library: { get: () => ({}) }, progress: { get: () => ({}) } }));
vi.mock('../src/lib/meta.js', () => ({ metaNow: () => null }));
vi.mock('../src/sources/catalogs.js', () => ({ audible: { find: vi.fn(), series: vi.fn() } }));
vi.mock('../src/lib/downloads.js', () => ({ downloads: { get: () => ({}) } }));
vi.mock('../src/sources/local.js', () => ({ localCfg: { get: () => ({ books: [] }) } }));
const { seriesFromMatch, parseSeries } = await import('../src/lib/series.js');

describe('series of a book', () => {
  it('takes the series from Audible only for the same book', () => {
    const book = { title: 'H.P. 6 - Harry Potter and the Half-Blood Prince', author: 'J.K. Rowling' };
    expect(seriesFromMatch({ title: 'Harry Potter and the Half-Blood Prince' }, { title: 'Harry Potter and the Half-Blood Prince, Book 6', series: 'Harry Potter #6' })).toEqual({ name: 'Harry Potter', n: 6 });
    expect(seriesFromMatch({ title: 'Dune' }, { title: 'Project Hail Mary', series: 'Something #1' })).toBe(null);
    expect(seriesFromMatch(book, { title: 'Harry Potter', series: '' })).toBe(null);
  });
  it('reads "Name #2" and "Name, Book 2"', () => {
    expect(parseSeries('The Stormlight Archive #2')).toEqual({ name: 'The Stormlight Archive', n: 2 });
    expect(parseSeries('Mistborn, Book 3')).toEqual({ name: 'Mistborn', n: 3 });
  });
});
